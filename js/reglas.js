/* Reglas de negocio que no dependen de la pantalla ni de Firebase (se prueban por separado en tests/reglas.test.mjs). */

export const ESTATUS = {
  RECIBIDO: { nombre: 'Recibido', color: 'azul' },
  EN_PREPARACION: { nombre: 'En preparación', color: 'azul' },
  ARMADO: { nombre: 'Armado', color: 'amarillo' },
  LISTO: { nombre: 'Listo para transporte', color: 'verde' },
  PARADO: { nombre: 'Parado', color: 'rojo' },
  INCOMPLETO: { nombre: 'Incompleto', color: 'rojo' },
  EN_RUTA: { nombre: 'En ruta', color: 'verde' },
  ENTREGADO: { nombre: 'Entregado', color: 'gris' }
};
/* Lo que puede elegir Operación; Transporte y Administrador además pasan a EN_RUTA y ENTREGADO. */
export const ESTATUS_OPERACION = ['RECIBIDO', 'EN_PREPARACION', 'ARMADO', 'LISTO', 'PARADO', 'INCOMPLETO'];
export const DOCUMENTOS = [['factura', 'Factura'], ['carta_porte', 'Carta Porte'], ['remision', 'Remisión']];
export const CHECKLIST = [
  ['llantas', 'Llantas'], ['luces', 'Luces'], ['frenos', 'Frenos'], ['espejos', 'Espejos'],
  ['cinturones', 'Cinturones'], ['extintor', 'Extintor'], ['documentos', 'Documentos del vehículo'], ['combustible', 'Combustible']
];
export const LIMITE_SENCILLO_KG = 40000;

export const docsCompletos = (docs) => DOCUMENTOS.every(([k]) => docs && docs[k] === true);
export const docsAvance = (docs) => DOCUMENTOS.filter(([k]) => docs && docs[k] === true).length;
/* SENCILLO hasta 40 toneladas (incluidas); FULL arriba de 40. */
export const tipoUnidad = (pesoKg) => (Number(pesoKg) > LIMITE_SENCILLO_KG ? 'FULL' : 'SENCILLO');

/* Folios: los combinados se separan con «/» (nunca con «Y») y no llevan letra pegada al número.
   Un folio solo conserva su letra (12345A). */
export function partesFolio(texto) {
  return String(texto || '').toUpperCase()
    .split(/\s*(?:\/|,|;|\+|&|\bY\b)\s*/)
    .map((s) => s.trim().replace(/\s+/g, ''))
    .filter(Boolean);
}
export function combinarFolios(lista) {
  const partes = [];
  [].concat(lista).forEach((x) => partesFolio(x).forEach((p) => partes.push(p)));
  const unicos = [...new Set(partes)];
  if (unicos.length <= 1) return unicos[0] || '';
  const sinLetra = unicos.map((p) => p.replace(/^([A-Z]*\d+)[A-Z]+$/, '$1'));
  return [...new Set(sinLetra)].join('/');
}
/* Id del documento en Firestore a partir del folio (la «/» no se permite en ids). */
export const idFolio = (folio) => String(folio).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');

/* Tarimas: completas y resto (fracción de tarima que no se llena). */
export function tarimas(total) {
  const t = Math.max(0, Number(total) || 0), completas = Math.floor(t + 1e-9);
  return { total: redondeo(t, 2), completas, resto: redondeo(t - completas, 2) };
}
export const redondeo = (n, d) => Math.round((Number(n) || 0) * 10 ** d) / 10 ** d;

/* La unidad aguanta el peso del folio? */
export function excedeCapacidad(pesoKg, capacidadKg) {
  return Number(capacidadKg) > 0 && Number(pesoKg) > Number(capacidadKg);
}

/* Revisión pre-salida: { llantas: 'ok' | 'mal' } → contestado completo y si pasa. */
export function revisarChecklist(resp) {
  const r = resp || {};
  const contestado = CHECKLIST.every(([k]) => r[k] === 'ok' || r[k] === 'mal');
  const reprobados = CHECKLIST.filter(([k]) => r[k] === 'mal').map(([, n]) => n);
  return { contestado, pasa: contestado && reprobados.length === 0, reprobados };
}

/* Coordenadas desde texto: «20.67, -103.35» o una liga larga de Google Maps (…/@20.67,-103.35,15z, …!3d20.67!4d-103.35,
   ?q=20.67,-103.35). Las ligas cortas (maps.app.goo.gl) no traen coordenadas: hay que abrirlas y copiar la liga larga. */
export function coordenadasDeLiga(t) {
  const s = decodeURIComponent(String(t || '')).replace(/\s+/g, ' ');
  const ok = (a, b) => { const lat = Number(a), lng = Number(b); return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng) ? { lat, lng } : null; };
  let m = s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (m) return ok(m[1], m[2]);
  m = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return ok(m[1], m[2]);
  m = s.match(/[?&](?:q|query|ll|destination|daddr|center)=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (m) return ok(m[1], m[2]);
  if (/^https?:/i.test(s.trim())) return null;
  m = s.match(/(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)/);
  return m ? ok(m[1], m[2]) : null;
}
export const esLigaCorta = (t) => /^(https?:\/\/)?(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(String(t || '').trim());

const norm = (s) => String(s === null || s === undefined ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
export { norm };

/* Motivos (del catálogo del Seguimiento Integral Logística). */
export const MOTIVOS_REPROGRAMACION = ['Falla mecánica', 'Cancelación de la transportadora', 'Demora de la transportadora', 'Cancelación de folio de embarque',
  'No se consiguió transporte', 'Cambio de fecha de recepción del cliente', 'Cambio de destino', 'Cita', 'Clima', 'Tráfico', 'Trámite de permiso', 'Otro'];
export const INCIDENCIAS = {
  'Facturación': ['Incidencia facturación', 'Error en facturación', 'Cancelación de factura', 'No se timbró factura', 'Firma de factura electrónica', 'Falta de factura electrónica',
    'Se pide refacturación', 'Complemento de factura', 'Precios en 0', 'Espera de factura'],
  'Orden / sistema': ['Negativo en orden', 'Orden bloqueada', 'Problemas con sistema', 'Folio duplicado', 'Falta de folio', 'Modificación de folio', 'Anticipo', 'Liberación de consigna'],
  'Material': ['Inexistencia', 'Agregado', 'Dan de alta material faltante', 'Cambio de calibre', 'Cambio de tono', 'Cambio de formato', 'Cambio de color', 'Cambio de lote',
    'Producto cambiado', 'Producto dañado', 'Producto incompleto', 'Falta de exhibición', 'Falta hoja de exhibición', 'Falta de material en hoja de revisión'],
  'Documentos': ['Incidencia carta porte', 'Falta carta porte transportista', 'Complemento carta porte', 'Error en documentos', 'Fecha errónea en documentos', 'Nombre erróneo',
    'Falta de salida', 'Falta salidas de consigna', 'Tardanza en traer papeles de carga'],
  'Embarque / carga': ['Incidencia embarque', 'Incidencia de carga', 'Pesos y dimensiones', 'Demora por app', 'Detenido por distribución', 'En espera de 17 puntos', 'Falta órdenes seguro'],
  'Transporte / entrega': ['Retraso', 'Falla', 'Enfermedad', 'Problemas con cita', 'Incumplimiento de transporte', 'Cliente no recibe', 'Negligencia', 'Confirmación de dirección',
    'Confirmación de tarifa', 'Cambio de destino'],
  'Otro': ['Otro']
};
/* ¿Se entregó a tiempo? Compara la entrega con la cita (o, sin cita, con la salida + días de tránsito). */
export function puntualidad(f, diasTransito) {
  if (f.estatus !== 'ENTREGADO' || !f.entregado) return null;
  let limite = f.cita ? new Date(f.cita.length <= 10 ? f.cita + 'T23:59' : f.cita) : null;
  if (!limite && f.salida && diasTransito) { limite = new Date(f.salida); limite.setDate(limite.getDate() + Number(diasTransito)); limite.setHours(23, 59, 0, 0); }
  if (!limite || isNaN(limite)) return null;
  // Margen del mismo día: si la cita era a las 9:00 y se entregó ese día, cuenta como a tiempo.
  const fin = new Date(limite); fin.setHours(23, 59, 59, 999);
  return new Date(f.entregado) <= fin ? 'A tiempo' : 'Tarde';
}

/* Correos de alertas: a quién va cada tipo (áreas elegidas + correos extra). usuarios = lc_usuarios [{ id: correo, area, activo }]. */
export const TIPOS_ALERTA = { checklist: 'Checklist pre-salida reprobado', sin_checklist: 'Salida a ruta sin checklist', capacidad: 'Sobrepeso en la unidad',
  parado: 'Folio parado', modificacion: 'Modificación de acopio' };
const esCorreo = (c) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(c || '').trim());
export function destinatarios(config, usuarios, tipo, administrador) {
  const areas = new Set(((config.areas || {})[tipo]) || []), lista = new Set();
  (usuarios || []).forEach((u) => { if (u.activo !== false && areas.has(u.area) && esCorreo(u.id)) lista.add(u.id.trim().toLowerCase()); });
  if (areas.has('admin') && esCorreo(administrador)) lista.add(administrador.toLowerCase());
  (((config.extra || {})[tipo]) || []).forEach((c) => { if (esCorreo(c)) lista.add(String(c).trim().toLowerCase()); });
  return [...lista];
}
