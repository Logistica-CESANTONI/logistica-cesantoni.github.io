/* Acceso a Firebase (colecciones lc_). Las reglas de Firestore repiten cada permiso en el servidor:
   ocultar un botón aquí no es lo que protege los datos. */
import * as fb from './firebase-sdk.js?v=18';
import { ESTATUS_OPERACION, docsCompletos, idFolio } from './reglas.js?v=18';

const CFG = window.LC_CONFIG;
const params = new URLSearchParams(location.search);
const EMULADOR = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && params.has('emu');

const app = fb.initializeApp(CFG.firebase, 'logistica');
export const auth = fb.getAuth(app);
export const db = fb.getFirestore(app);
if (EMULADOR) { fb.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); fb.connectFirestoreEmulator(db, '127.0.0.1', 8080); }

const C = (n) => fb.collection(db, n);
const D = (n, id) => fb.doc(db, n, id);
const ahora = () => new Date().toISOString();
const lista = (snap) => snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));

/* ------------------------------------------------------------------ sesión
   Cada persona entra con su correo y su propia contraseña. La primera vez crea su contraseña y verifica su correo con un solo
   mensaje (después ya no se mandan correos). El área de cada persona vive en lc_usuarios/{correo} y la asigna el Administrador;
   el administrador principal está fijo en las reglas. Las reglas solo dan acceso a correos verificados. */
let sesion = null; // { uid, correo, nombre, area }
export const actual = () => sesion;
const LLAVE_INICIO = 'lc-inicio-sesion';
const guardar = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } };
const leer = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
export const correoNormal = (c) => String(c || '').trim().toLowerCase();
const correoValido = (c) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c);
const regreso = () => ({ url: location.origin + location.pathname + (EMULADOR ? '?emu=1' : '') });

export function vencida() {
  const t = Number(leer(LLAVE_INICIO) || 0);
  return !t || Date.now() - t > CFG.sesionHoras * 3600000;
}
async function areaDe(u) {
  const correo = correoNormal(u.email);
  if (correo === CFG.administrador) return { area: 'admin', nombre: 'Administrador' };
  const d = await fb.getDoc(D('lc_usuarios', correo));
  if (!d.exists() || d.data().activo === false) return null;
  return { area: d.data().area, nombre: d.data().nombre || '' };
}
/* fn(sesion | null, aviso, pendiente) — pendiente = 'verificar' cuando falta confirmar el correo. */
export function alCambiar(fn) {
  return fb.onAuthStateChanged(auth, async (u) => {
    if (!u) { sesion = null; fn(null); return; }
    const inicio = Date.parse((u.metadata && u.metadata.lastSignInTime) || '') || Number(leer(LLAVE_INICIO) || 0);
    if (inicio) guardar(LLAVE_INICIO, String(inicio));
    if (vencida()) { await salir(); fn(null, 'Tu sesión duró más de ' + CFG.sesionHoras + ' horas. Vuelve a entrar.'); return; }
    if (!u.emailVerified) { sesion = null; fn(null, '', 'verificar', u.email); return; }
    try {
      const a = await areaDe(u);
      if (!a) { const c = u.email; await salir(); fn(null, 'El correo ' + c + ' no tiene un área asignada. Pide al administrador que te dé de alta.'); return; }
      sesion = { uid: u.uid, correo: correoNormal(u.email), nombre: a.nombre, area: a.area };
      fn(sesion);
    } catch (e) { await salir(); fn(null, amigable(e)); }
  });
}
export async function entrar(correo, clave) {
  correo = correoNormal(correo);
  if (!correoValido(correo)) throw new Error('Escribe tu correo completo.');
  await fb.setPersistence(auth, fb.browserLocalPersistence);
  guardar(LLAVE_INICIO, String(Date.now()));
  await fb.signInWithEmailAndPassword(auth, correo, clave);
}
/* Primera vez: crea la cuenta y manda un solo correo para verificarla. */
export async function crearCuenta(correo, clave) {
  correo = correoNormal(correo);
  if (!correoValido(correo)) throw new Error('Escribe tu correo completo.');
  if (String(clave).length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
  await fb.setPersistence(auth, fb.browserLocalPersistence);
  guardar(LLAVE_INICIO, String(Date.now()));
  const { user } = await fb.createUserWithEmailAndPassword(auth, correo, clave);
  await fb.sendEmailVerification(user, regreso());
}
export async function reenviarVerificacion() { if (auth.currentUser) await fb.sendEmailVerification(auth.currentUser, regreso()); }
/* Después de dar clic en la liga de verificación: recarga el usuario y su token (las reglas leen email_verified del token). */
export async function yaVerifique() {
  const u = auth.currentUser;
  if (!u) return false;
  await fb.reload(u);
  if (!u.emailVerified) return false;
  await fb.getIdToken(u, true);
  location.reload();
  return true;
}
export async function olvide(correo) {
  correo = correoNormal(correo);
  if (!correoValido(correo)) throw new Error('Escribe tu correo arriba y vuelve a dar clic en «Olvidé mi contraseña».');
  await fb.sendPasswordResetEmail(auth, correo, regreso());
}
export async function salir() { guardar(LLAVE_INICIO, null); await fb.signOut(auth); }

/* Usuarios (solo Administrador). */
export async function usuarios() { return lista(await fb.getDocs(C('lc_usuarios'))).sort((a, b) => a.id.localeCompare(b.id)); }
export async function guardarUsuario(correo, datos) {
  correo = correoNormal(correo);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) throw new Error('Correo no válido.');
  await fb.setDoc(D('lc_usuarios', correo), { nombre: String(datos.nombre || '').trim(), area: datos.area, activo: datos.activo !== false, actualizado: ahora(), por: sesion.correo });
}
export async function borrarUsuario(correo) { await fb.deleteDoc(D('lc_usuarios', correoNormal(correo))); }

/* ------------------------------------------------------------------ folios */
export async function folios() { return lista(await fb.getDocs(C('lc_folios'))); }
export async function folio(id) { const s = await fb.getDoc(D('lc_folios', id)); return s.exists() ? Object.assign({ id }, s.data()) : null; }
/* Borra el folio con todo lo suyo: historial, despacho (tarifa, checklist) y su renglón en la Pantalla. Solo Administrador. */
export async function borrarFolio(f) {
  const hist = await fb.getDocs(fb.collection(db, 'lc_folios', f.id, 'historial'));
  const inc = await fb.getDocs(fb.query(C('lc_incidencias'), fb.where('folio_id', '==', f.id)));
  const docs = hist.docs.map((d) => d.ref).concat(inc.docs.map((d) => d.ref), [D('lc_despachos', f.id), D('lc_pantalla', f.id), D('lc_folios', f.id)]);
  for (let i = 0; i < docs.length; i += 450) {
    const b = fb.writeBatch(db);
    docs.slice(i, i + 450).forEach((r) => b.delete(r));
    await b.commit();
  }
}
export async function historial(id) {
  return lista(await fb.getDocs(fb.collection(db, 'lc_folios', id, 'historial'))).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}
function bitacora(b, id, texto) {
  b.set(fb.doc(fb.collection(db, 'lc_folios', id, 'historial')), { fecha: ahora(), area: sesion.area, por: sesion.correo, texto });
}

/* Pantalla del almacén: copia pública del folio en lc_pantalla, sin direcciones, teléfonos, material ni nombres de clientes
   de Última Milla (son personas). lc_folios ya no es público. Se reescribe en cada cambio del folio. */
export function publico(f) {
  const um = f.tipo_envio === 'ULTIMA_MILLA';
  return {
    folio: f.folio, tipo_envio: um ? 'ULTIMA_MILLA' : 'NACIONAL', cliente: um ? 'Última Milla' : f.cliente || '', destino: f.destino || '',
    transportista: f.transportista || '', tipo_unidad: f.tipo_unidad || '', cita: f.cita || '', anden: f.anden || '',
    docs: Object.values(f.docs || {}).filter((v) => v === true).length, estatus: f.estatus, entregado: f.entregado || '', actualizado: ahora()
  };
}
const espejo = (b, f, cambios) => b.set(D('lc_pantalla', f.id), publico(Object.assign({}, f, cambios)));
const txt = (v, n) => String(v === undefined || v === null ? '' : v).slice(0, n || 200);

/* Id del folio en Firestore: los de Última Milla usan UM-<folio> para no chocar con Nacional. */
export const idDe = (g) => (idFolio(g.folio) ? (g.tipo_envio === 'ULTIMA_MILLA' ? 'UM-' : '') + idFolio(g.folio) : '');
/* Contenido del acopio / cuadro (lo que puede cambiar con una modificación). */
function contenido(g) {
  const um = g.tipo_envio === 'ULTIMA_MILLA', e = g.entrega || {};
  return {
    tipo_envio: um ? 'ULTIMA_MILLA' : 'NACIONAL', m2: Number(g.m2) || 0,
    lat: typeof g.lat === 'number' ? g.lat : null, lng: typeof g.lng === 'number' ? g.lng : null,
    entrega: um ? { recibe: txt(e.recibe), telefono: txt(e.telefono, 40), telefono2: txt(e.telefono2, 40), calle: txt(e.calle), no_ext: txt(e.no_ext, 20),
      no_int: txt(e.no_int, 20), colonia: txt(e.colonia), cp: txt(e.cp, 10), localidad: txt(e.localidad), municipio: txt(e.municipio), maps: txt(e.maps, 500),
      observaciones: txt(e.observaciones, 1000), descarga: txt(e.descarga, 20), embarque: txt(e.embarque, 30), orden: txt(e.orden, 30), factura: txt(e.factura, 30),
      flete_directo: !!e.flete_directo, gran_formato: !!e.gran_formato, adhesivos: !!e.adhesivos, almacen_distinto: !!e.almacen_distinto } : null,
    material: (g.material || []).slice(0, 300).map((m) => ({ destino: txt(m.destino, 30), orden: txt(m.orden, 30), sku: txt(m.sku, 40), producto: txt(m.producto),
      formato: txt(m.formato, 60), cantidad: Number(m.cantidad) || 0, um: txt(m.um, 10), cajas_tarima: Number(m.cajas_tarima) || 0, tarimas: Number(m.tarimas) || 0, restos: Number(m.restos) || 0,
      kg: Number(m.kg) || 0, m2: Number(m.m2) || 0, lote: txt(m.lote, 30), oc: txt(m.oc, 60) })),
    cliente: g.cliente, destino: g.destino, hojas: g.hojas || [],
    tarimas: Number(g.tarimas) || 0, resto: Number(g.resto) || 0, peso_kg: Number(g.peso_kg) || 0, tipo_unidad: g.tipo_unidad,
    clasificacion: String(g.clasificacion || ''), paradas: (g.paradas || []).slice(0, 40).map((p) => ({
      codigo: String(p.codigo || ''), venta: String(p.venta || ''), sucursal: String(p.sucursal || ''), ciudad: String(p.ciudad || ''), tarimas: Number(p.tarimas) || 0,
      restos_liso: Number(p.restos_liso) || 0, restos_deco: Number(p.restos_deco) || 0, peso_kg: Number(p.peso_kg) || 0, m2: Number(p.m2) || 0 }))
  };
}

/* Alta de folios (Ventas). Si el folio ya existe no se toca (para cambiarlo está actualizarFolio). */
export async function crearFolios(grupos) {
  const creados = [], repetidos = [];
  for (const g of grupos) {
    const id = idDe(g);
    if (!id) throw new Error('Hay un pedido sin folio (' + g.cliente + ').');
    const ok = await fb.runTransaction(db, async (tx) => {
      const ref = D('lc_folios', id);
      if ((await tx.get(ref)).exists()) return false;
      const datos = Object.assign(contenido(g), {
        folio: g.folio, estatus: 'RECIBIDO', motivo: '', docs: { factura: false, carta_porte: false, remision: false },
        transportista: '', unidad: '', cita: '', anden: '', salida: '', entregado: '',
        creado: ahora(), actualizado: ahora(), creado_por: sesion.area, version: 1
      });
      tx.set(ref, datos);
      tx.set(D('lc_pantalla', id), publico(Object.assign({ id }, datos)));
      tx.set(fb.doc(fb.collection(db, 'lc_folios', id, 'historial')), { fecha: ahora(), area: sesion.area, por: sesion.correo, texto: 'Alta del folio (Recibido)' });
      return true;
    });
    (ok ? creados : repetidos).push(g.folio);
  }
  return { creados, repetidos };
}

/* Estatus en los que todavía se acepta una modificación del acopio (antes de armar). */
export const MODIFICABLE = ['RECIBIDO', 'EN_PREPARACION', 'PARADO', 'INCOMPLETO'];
/* Modificación de acopio: reemplaza el contenido del folio, sube la versión y deja en el historial qué cambió.
   Si ya está Armado o más adelante no se toca: solo se registra una alerta. resumen = texto del cambio. */
export async function actualizarFolio(f, g, resumen) {
  const b = fb.writeBatch(db);
  if (!MODIFICABLE.includes(f.estatus)) {
    alertaEn(b, 'modificacion', f, 'Llegó una modificación del acopio del folio ' + f.folio + ' pero ya está ' + f.estatus.replace('_', ' ') + ': no se aplicó. ' + resumen);
    bitacora(b, f.id, 'Modificación NO aplicada (folio ' + f.estatus.replace('_', ' ') + '): ' + resumen);
    await b.commit();
    return false;
  }
  const cambios = Object.assign(contenido(g), { actualizado: ahora(), modificado: ahora(), version: (Number(f.version) || 1) + 1 });
  b.update(D('lc_folios', f.id), cambios);
  espejo(b, f, cambios);
  bitacora(b, f.id, 'Modificación de acopio (versión ' + cambios.version + '): ' + resumen);
  // Si ya se habían entregado documentos, hay que revisarlos contra el material nuevo.
  if (Object.values(f.docs || {}).some(Boolean)) alertaEn(b, 'modificacion', f, 'El acopio del folio ' + f.folio + ' cambió: revisa factura, carta porte y remisión. ' + resumen);
  await b.commit();
  return true;
}

/* Operación: estatus, motivo y documentos. LISTO exige los tres documentos (también lo exige el servidor). */
export async function cambiarEstatus(f, estatus, motivo) {
  const permitido = ['transporte', 'admin'].includes(sesion.area) ? ESTATUS_OPERACION.concat(['EN_RUTA', 'ENTREGADO']) : ESTATUS_OPERACION;
  if (!permitido.includes(estatus)) throw new Error('Tu área no puede poner ese estatus.');
  if (['LISTO', 'EN_RUTA', 'ENTREGADO'].includes(estatus) && !docsCompletos(f.docs)) throw new Error('Faltan documentos: no puede pasar a Listo para transporte.');
  if (estatus === 'PARADO' && !String(motivo || '').trim()) throw new Error('Escribe el motivo por el que está parado.');
  const cambios = { estatus, motivo: estatus === 'PARADO' || estatus === 'INCOMPLETO' ? String(motivo || '').trim() : '', actualizado: ahora() };
  const b = fb.writeBatch(db);
  b.update(D('lc_folios', f.id), cambios);
  espejo(b, f, cambios);
  bitacora(b, f.id, 'Estatus: ' + estatus + (cambios.motivo ? ' — ' + cambios.motivo : ''));
  if (estatus === 'PARADO') alertaEn(b, 'parado', f, 'Folio ' + f.folio + ' PARADO: ' + cambios.motivo);
  await b.commit();
}
export async function marcarDocumento(f, clave, valor) {
  const b = fb.writeBatch(db);
  b.update(D('lc_folios', f.id), { ['docs.' + clave]: !!valor, actualizado: ahora() });
  espejo(b, f, { docs: Object.assign({}, f.docs, { [clave]: !!valor }) });
  bitacora(b, f.id, (valor ? 'Documento entregado: ' : 'Documento retirado: ') + clave.replace('_', ' '));
  await b.commit();
}

/* ------------------------------------------------------------------ transporte */
export async function despacho(id) { const s = await fb.getDoc(D('lc_despachos', id)); return s.exists() ? s.data() : {}; }
export async function despachos() { const r = {}; (await fb.getDocs(C('lc_despachos'))).docs.forEach((d) => { r[d.id] = d.data(); }); return r; }
/* Datos públicos (folio, se ven en la Pantalla) y privados (despacho: operador, placas, tarifa, checklist). */
export async function guardarDespacho(f, visible, privado, alertaTexto) {
  const publico = visible;
  const b = fb.writeBatch(db);
  b.update(D('lc_folios', f.id), Object.assign({}, publico, { actualizado: ahora() }));
  espejo(b, f, publico);
  b.set(D('lc_despachos', f.id), Object.assign({}, privado, { actualizado: ahora() }), { merge: true });
  bitacora(b, f.id, 'Asignación: ' + [publico.transportista, publico.unidad, publico.cita && 'cita ' + publico.cita.replace('T', ' '), publico.anden && 'andén ' + publico.anden].filter(Boolean).join(' · '));
  if (alertaTexto) alertaEn(b, 'capacidad', f, alertaTexto);
  await b.commit();
}
export async function guardarChecklist(f, respuestas, revision) {
  const b = fb.writeBatch(db);
  b.set(D('lc_despachos', f.id), { checklist: respuestas, checklist_fecha: ahora(), actualizado: ahora() }, { merge: true });
  bitacora(b, f.id, 'Checklist pre-salida: ' + (revision.pasa ? 'aprobado' : 'reprobado (' + revision.reprobados.join(', ') + ')'));
  if (!revision.pasa) alertaEn(b, 'checklist', f, 'Checklist pre-salida reprobado en ' + f.folio + ': ' + revision.reprobados.join(', '));
  await b.commit();
}
export async function salirARuta(f, revision) {
  const b = fb.writeBatch(db);
  b.update(D('lc_folios', f.id), { estatus: 'EN_RUTA', salida: ahora(), actualizado: ahora() });
  espejo(b, f, { estatus: 'EN_RUTA' });
  bitacora(b, f.id, 'Salió a ruta; monitoreo GPS activo');
  if (!revision) { /* Nacional: no lleva checklist */ } else if (!revision.contestado) alertaEn(b, 'sin_checklist', f, 'El folio ' + f.folio + ' salió a ruta SIN checklist pre-salida.');
  else if (!revision.pasa) alertaEn(b, 'checklist', f, 'El folio ' + f.folio + ' salió a ruta con checklist reprobado: ' + revision.reprobados.join(', '));
  await b.commit();
}
export async function entregar(f) {
  const b = fb.writeBatch(db);
  const cuando = ahora();
  b.update(D('lc_folios', f.id), { estatus: 'ENTREGADO', entregado: cuando, actualizado: cuando });
  espejo(b, f, { estatus: 'ENTREGADO', entregado: cuando });
  bitacora(b, f.id, 'Entregado');
  await b.commit();
}

/* Ubicación de entrega de un folio de Última Milla (coordenadas y, si la hay, la liga de Google Maps). */
export async function guardarUbicacion(f, pos, liga) {
  const cambios = { lat: pos.lat, lng: pos.lng, actualizado: ahora() };
  if (liga && f.entrega) cambios['entrega.maps'] = txt(liga, 500);
  await fb.updateDoc(D('lc_folios', f.id), cambios);
}

/* ------------------------------------------------------------------ reprogramaciones e incidencias (lc_incidencias) */
export async function incidencias() { return lista(await fb.getDocs(C('lc_incidencias'))).sort((a, b) => (a.fecha < b.fecha ? 1 : -1)); }
export async function incidenciasDe(f) { return lista(await fb.getDocs(fb.query(C('lc_incidencias'), fb.where('folio_id', '==', f.id)))).sort((a, b) => (a.fecha < b.fecha ? 1 : -1)); }
function registro(b, f, datos) {
  b.set(fb.doc(C('lc_incidencias')), Object.assign({ folio_id: f.id, folio: f.folio, tipo_envio: f.tipo_envio || 'NACIONAL', cliente: f.cliente || '',
    transportista: f.transportista || '', estatus: f.estatus, fecha: ahora(), area: sesion.area, por: sesion.correo }, datos));
}
/* Reprogramar (Transporte / Administrador): nueva cita, motivo y comentario. */
export async function reprogramar(f, citaNueva, motivo, detalle) {
  if (!motivo) throw new Error('Elige el motivo de la reprogramación.');
  const b = fb.writeBatch(db);
  registro(b, f, { tipo: 'REPROGRAMACION', motivo, detalle: txt(detalle, 500), cita_anterior: f.cita || '', cita_nueva: citaNueva || '' });
  if (citaNueva !== undefined && citaNueva !== f.cita) { b.update(D('lc_folios', f.id), { cita: citaNueva || '', actualizado: ahora() }); espejo(b, f, { cita: citaNueva || '' }); }
  bitacora(b, f.id, 'Reprogramado: ' + motivo + (citaNueva ? ' · nueva cita ' + citaNueva.replace('T', ' ') : '') + (detalle ? ' — ' + detalle : ''));
  await b.commit();
}
/* Incidencia (cualquier área): categoría, motivo y comentario. */
export async function registrarIncidencia(f, categoria, motivo, detalle) {
  if (!motivo) throw new Error('Elige la incidencia.');
  const b = fb.writeBatch(db);
  registro(b, f, { tipo: 'INCIDENCIA', categoria, motivo, detalle: txt(detalle, 500) });
  bitacora(b, f.id, 'Incidencia: ' + categoria + ' · ' + motivo + (detalle ? ' — ' + detalle : ''));
  await b.commit();
}

/* Catálogos (Transporte y Administrador). */
export async function catalogo(nombre) { return lista(await fb.getDocs(C('lc_' + nombre))); }
export async function guardarEn(nombre, id, datos) {
  const ref = id ? D('lc_' + nombre, id) : fb.doc(C('lc_' + nombre));
  await fb.setDoc(ref, Object.assign({}, datos, { actualizado: ahora() }));
  return ref.id;
}
export async function borrarDe(nombre, id) { await fb.deleteDoc(D('lc_' + nombre, id)); }
export async function config(id) { const s = await fb.getDoc(D('lc_config', id)); return s.exists() ? s.data() : {}; }
export async function guardarConfig(id, datos) { await fb.setDoc(D('lc_config', id), datos, { merge: true }); }

/* ------------------------------------------------------------------ alertas (el correo está simulado: solo se registra) */
function alertaEn(b, tipo, f, texto) {
  b.set(fb.doc(C('lc_alertas')), { tipo, folio: f ? f.folio : '', folio_id: f ? f.id : '', texto, fecha: ahora(), area: sesion.area, por: sesion.correo, leida: false, correo: 'pendiente' }); // la función correoAlertas lo manda desde Outlook y anota el resultado
}
export async function alertas() { return lista(await fb.getDocs(C('lc_alertas'))).sort((a, b) => (a.fecha < b.fecha ? 1 : -1)); }
export async function marcarLeida(id) { await fb.updateDoc(D('lc_alertas', id), { leida: true }); }

/* Token de Firebase para el puente de Samsara (la Cloud Function revisa el área). */
export async function tokenGps() { try { return auth.currentUser ? await auth.currentUser.getIdToken() : ''; } catch (e) { return ''; } }

export function amigable(e) {
  const c = (e && e.code) || '', m = String((e && e.message) || e || '');
  if (/wrong-password|invalid-credential|user-not-found|invalid-login/.test(c)) return 'Correo o contraseña incorrectos. Si es tu primera vez, usa «Crear mi contraseña».';
  if (/email-already-in-use/.test(c)) return 'Ese correo ya tiene contraseña. Entra con ella o usa «Olvidé mi contraseña».';
  if (/weak-password/.test(c)) return 'La contraseña es muy débil: usa al menos 8 caracteres.';
  if (/invalid-email/.test(c)) return 'Correo no válido.';
  if (/quota-exceeded/.test(c)) return 'Firebase llegó a su límite diario de correos. Intenta mañana o avisa al administrador.';
  if (/operation-not-allowed/.test(c)) return 'Falta activar «Correo electrónico/contraseña» en Firebase › Authentication.';
  if (/unauthorized-continue-uri|unauthorized-domain/.test(c)) return 'Falta agregar este sitio en Firebase › Authentication › Authorized domains.';
  if (/too-many-requests/.test(c)) return 'Demasiados intentos. Espera unos minutos.';
  if (/network|unavailable/.test(c)) return 'Sin conexión. Revisa tu internet y vuelve a intentar.';
  if (/permission-denied|PERMISSION_DENIED/.test(c + m)) {
    if (vencida()) return 'SESION: Tu sesión venció (' + CFG.sesionHoras + ' horas). Vuelve a entrar.';
    return 'Tu área no tiene permiso para esto (o falta un requisito, como los tres documentos).';
  }
  return m.replace(/^Firebase:\s*/, '');
}
