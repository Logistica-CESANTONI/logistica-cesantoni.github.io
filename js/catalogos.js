/* Importa los catálogos de Nacional desde los Excel de Logística:
   - «Seguimiento Integral Logística» (hoja Catalogos): transportistas, clientes y destinos (días de tránsito, tarifa por tonelada).
   - «Fletes» (hoja CATALOGOS): tarifa y tarifa LP por destino, clasificación del cliente y datos de pago del transportista.
   Las columnas se buscan por su título, así que el orden puede cambiar. Nada de esto se guarda en el sitio (es público):
   se guarda en Firebase, en lc_config, que solo leen Transporte y Administrador. */
import { norm } from './reglas.js?v=18';

const texto = (v) => { const t = String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim(); return /^#(N\/A|VALUE!|REF!|DIV\/0!|NAME\?)$/i.test(t) ? '' : t; };
const numero = (v) => { const t = String(v === undefined || v === null ? '' : v).replace(/[$,\s]/g, ''); if (!t) return null; const n = Number(t); return isNaN(n) ? null : n; };
const hoja = (hojas, clave) => { const n = Object.keys(hojas).find((x) => norm(x).replace(/\s/g, '') === clave); return n ? hojas[n] : null; };

/* Fila de títulos: la primera (en las 30 de arriba) que trae todos los títulos pedidos. Devuelve { fila, col(título, n) }. */
function titulos(filas, requeridos) {
  for (let i = 0; i < Math.min(filas.length, 30); i++) {
    const f = (filas[i] || []).map((v) => norm(v));
    if (!requeridos.every((r) => f.includes(norm(r)))) continue;
    // col('TARIFA', 2) = segunda columna con ese título, para títulos repetidos.
    const col = (t, n = 1) => { let k = 0; for (let c = 0; c < f.length; c++) if (f[c] === norm(t) && ++k === n) return c; return -1; };
    return { fila: i, col };
  }
  return null;
}
function filasDesde(filas, t, columnas, clave) {
  const idx = Object.fromEntries(Object.entries(columnas).map(([k, nombre]) => [k, t.col(...[].concat(nombre))]));
  const out = [];
  for (let i = t.fila + 1; i < filas.length; i++) {
    const f = filas[i] || [], r = {};
    Object.entries(idx).forEach(([k, c]) => { r[k] = c < 0 ? '' : f[c]; });
    if (texto(r[clave])) out.push(r);
  }
  return out;
}

export function desdeSeguimiento(hojas) {
  const filas = hoja(hojas, 'CATALOGOS');
  if (!filas) throw new Error('El archivo no trae la hoja «Catalogos» (Seguimiento Integral Logística).');
  const t = titulos(filas, ['TRANSPORTISTA', 'RAZON SOCIAL', 'CIUDAD', 'Num Cliente', 'Nombre Cliente']);
  if (!t) throw new Error('No encontré los títulos de la hoja Catalogos (TRANSPORTISTA, CIUDAD, Num Cliente…).');
  const transportistas = filasDesde(filas, t, { nombre: 'TRANSPORTISTA', razon_social: 'RAZON SOCIAL', telefono: 'TELEFONO', correo: 'CORREO', correo2: 'CORREO 2' }, 'nombre')
    .map((r) => ({ nombre: texto(r.nombre), razon_social: texto(r.razon_social), telefono: texto(r.telefono), correo: texto(r.correo), correo2: texto(r.correo2) }));
  const destinos = filasDesde(filas, t, { destino: 'CIUDAD', dias: 'DIAS', tarifa: 'TARIFA', estado: 'ESTADOS' }, 'destino')
    .map((r) => ({ destino: texto(r.destino), estado: texto(r.estado), dias: numero(texto(r.dias)), tarifa: numero(texto(r.tarifa)) }));
  const clientes = filasDesde(filas, t, { num: 'Num Cliente', nombre: 'Nombre Cliente', corporativo: 'Corporativo', customer: 'Customer Service', cita: 'Cita',
    gerente_regional: 'Gerente Regional', gerente_divisional: 'Gerente Divisional', zona: 'Zona', no_zona: 'No. Zona', tipo_flete: 'Tipo Flete',
    dias_credito: 'Dias Credito', observaciones: 'Observaciones' }, 'nombre')
    .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, texto(v)])));
  return { transportistas, destinos, clientes };
}

export function desdeFletes(hojas) {
  const filas = hoja(hojas, 'CATALOGOS');
  if (!filas) throw new Error('El archivo no trae la hoja «CATALOGOS» (Fletes).');
  const t = titulos(filas, ['DESTINO', 'TARIFA', 'NUM CLIENTE', 'RAZON SOCIAL TRANSPORTISTA']);
  if (!t) throw new Error('No encontré los títulos de la hoja CATALOGOS (DESTINO, TARIFA, NUM CLIENTE, RAZON SOCIAL TRANSPORTISTA…).');
  const destinos = filasDesde(filas, t, { destino: 'DESTINO', tarifa: 'TARIFA', tarifa_lp: 'TARIFA LP' }, 'destino')
    .map((r) => ({ destino: texto(r.destino), tarifa: numero(texto(r.tarifa)), tarifa_lp: numero(texto(r.tarifa_lp)) }));
  const clientes = filasDesde(filas, t, { num: 'NUM CLIENTE', nombre: 'NOMBRE CLIENTE', clasificacion: 'CLASIFICACION' }, 'nombre')
    .map((r) => ({ num: texto(r.num), nombre: texto(r.nombre), clasificacion: texto(r.clasificacion) }));
  const transportistas = filasDesde(filas, t, { razon_social: 'RAZON SOCIAL TRANSPORTISTA', plazo_pago: 'PLAZO PAGO', correo: 'CORREO', iva: 'Calculo IVA' }, 'razon_social')
    .map((r) => ({ razon_social: texto(r.razon_social), plazo_pago: numero(texto(r.plazo_pago)), correo: texto(r.correo), iva: numero(texto(r.iva)) }));
  return { destinos, clientes, transportistas };
}

/* Junta lo importado con lo que ya hay. A los transportistas les conserva la cuenta espejo capturada a mano. */
export function combinarCatalogos({ seguimiento, fletes, actuales }) {
  const porNombre = new Map();
  const llave = (x) => norm(x).replace(/[^A-Z0-9]/g, '');
  (actuales.transportistas || []).forEach((t) => porNombre.set(llave(t.nombre), Object.assign({}, t)));
  (seguimiento ? seguimiento.transportistas : []).forEach((t) => {
    const k = llave(t.nombre), ya = porNombre.get(k) || {};
    porNombre.set(k, Object.assign({}, ya, Object.fromEntries(Object.entries(t).filter(([, v]) => v !== '' && v !== null))));
  });
  // La razón social de Fletes a veces viene sin «S.A. de C.V.» o con otro orden: se compara sin sufijos y por inicio.
  const base = (x) => llave(String(x || '').replace(/\b(S\.?\s*A\.?|S\.?\s*DE\s*R\.?\s*L\.?|DE\s*C\.?\s*V\.?|S\.?\s*A\.?\s*P\.?\s*I\.?)\b/gi, '')
    .replace(/^\s*(AUTO\s*TRANSPORTES|AUTOTRANSPORTES|TRANSPORTES|TRANSPORTE|AUTO\s*EXPRESS|AUTOEXPRESS)\s+(EL\s+|LA\s+|LOS\s+)?/i, ''));
  const igual = (a, b) => { a = base(a); b = base(b); return a.length > 3 && b.length > 3 && (a === b || a.startsWith(b) || b.startsWith(a)); };
  // Palabras de un nombre sin artículos ni sufijos de sociedad; «EXPRES» = «EXPRESS».
  const palabras = (x) => norm(x).replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !['DE', 'DEL', 'LA', 'LOS', 'LAS', 'Y', 'SA', 'CV', 'RL', 'S', 'TRANSPORTES', 'TRANSPORTE'].includes(w)).map((w) => (w.length > 4 ? w.replace(/S+$/, '') : w));
  const contenido = (a, b, minimo = 3) => { const pa = palabras(a), pb = new Set(palabras(b)); return pa.length >= minimo && pa.every((w) => pb.has(w)); };
  const correos = (x) => String(x || '').toLowerCase().match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) || [];
  (fletes ? fletes.transportistas : []).forEach((f) => {
    const k = llave(f.razon_social);
    const deF = correos(f.correo);
    // Si la razón social no empata (persona física con otro nombre comercial), se busca por correo.
    const t = [...porNombre.values()].find((x) => (x.alias_fletes || []).some((a) => llave(a) === k))
      || [...porNombre.values()].find((x) => igual(x.razon_social, f.razon_social) || igual(x.nombre, f.razon_social))
      // Misma persona con un nombre de más o de menos («CARLOS DEL VILLAR ACUÑA» ⊂ «CARLOS ALEJANDRO DEL VILLAR ACUÑA»).
      || [...porNombre.values()].find((x) => contenido(f.razon_social, x.razon_social))
      // Correo que trae el nombre comercial («internacional.lopez@…» → TRANSPORTES LOPEZ INTERNACIONAL).
      || [...porNombre.values()].find((x) => deF.some((c) => contenido(c.split('@')[0].replace(/[._\d-]+/g, ' '), x.nombre, 2)))
      || (deF.length ? [...porNombre.values()].find((x) => correos([x.correo, x.correo2].join(' ')).some((c) => deF.includes(c))) : null);
    // Lo que no empata se queda como transportista con su razón social.
    const extra = { plazo_pago: f.plazo_pago, iva: f.iva, correo_pagos: f.correo };
    const mismaRazon = t && (igual(t.razon_social, f.razon_social) || igual(t.nombre, f.razon_social) || (t.alias_fletes || []).some((a) => llave(a) === k));
    if (t && mismaRazon) Object.assign(t, extra, (t.alias_fletes || []).some((a) => llave(a) === k) ? { razon_social_fletes: f.razon_social } : {});
    // Empatado por correo: solo completa lo que falte y anota con qué razón social viene en Fletes.
    else if (t) Object.assign(t, Object.fromEntries(Object.entries(extra).filter(([c]) => t[c] === undefined || t[c] === null || t[c] === '')), { razon_social_fletes: f.razon_social });
    else porNombre.set(k, Object.assign({ nombre: f.razon_social, razon_social: f.razon_social }, extra));
  });
  const transportistas = [...porNombre.values()].filter((t) => t.nombre).sort((a, b) => a.nombre.localeCompare(b.nombre));

  const destinos = new Map();
  (actuales.tarifas || []).forEach((d) => destinos.set(norm(d.destino), Object.assign({}, d)));
  (seguimiento ? seguimiento.destinos : []).forEach((d) => destinos.set(norm(d.destino), Object.assign(destinos.get(norm(d.destino)) || {}, d)));
  (fletes ? fletes.destinos : []).forEach((d) => {
    const ya = destinos.get(norm(d.destino)) || { destino: d.destino };
    // La tarifa que se usa es la «TARIFA LP» de Fletes; si no la trae, la del Seguimiento (o la «TARIFA» de Fletes).
    const tarifa = d.tarifa_lp || (ya.tarifa !== undefined && ya.tarifa !== null ? ya.tarifa : d.tarifa);
    destinos.set(norm(d.destino), Object.assign(ya, { tarifa_fletes: d.tarifa, tarifa_lp: d.tarifa_lp, tarifa }));
  });
  const tarifas = [...destinos.values()].sort((a, b) => a.destino.localeCompare(b.destino));

  const clientes = new Map();
  const llaveC = (c) => (texto(c.num) ? 'N' + texto(c.num) : 'X' + llave(c.nombre));
  (actuales.clientes || []).forEach((c) => clientes.set(llaveC(c), Object.assign({}, c)));
  (seguimiento ? seguimiento.clientes : []).forEach((c) => clientes.set(llaveC(c), Object.assign(clientes.get(llaveC(c)) || {}, c)));
  (fletes ? fletes.clientes : []).forEach((c) => {
    const k = llaveC(c);
    const ya = clientes.get(k) || [...clientes.values()].find((x) => llave(x.nombre) === llave(c.nombre));
    if (ya) Object.assign(ya, { clasificacion: c.clasificacion, num: ya.num || c.num });
    else clientes.set(k, Object.assign({}, c));
  });
  return { transportistas, tarifas, clientes: [...clientes.values()].sort((a, b) => a.nombre.localeCompare(b.nombre)) };
}

/* Une a mano un transportista que solo vino de Fletes (razón social) con su transportista del Seguimiento.
   La razón social queda como alias para que al volver a importar se empate sola. */
export function unirTransportista(lista, origen, destino) {
  const o = lista.find((t) => t.nombre === origen), d = lista.find((t) => t.nombre === destino);
  if (!o || !d || o === d) return lista;
  Object.assign(d, { alias_fletes: [...new Set((d.alias_fletes || []).concat([o.razon_social || o.nombre]))], razon_social_fletes: o.razon_social || o.nombre },
    Object.fromEntries(['plazo_pago', 'iva', 'correo_pagos', 'plataforma', 'url', 'usuario', 'clave', 'contacto'].filter((c) => (d[c] === undefined || d[c] === '' || d[c] === null) && o[c] !== undefined).map((c) => [c, o[c]])));
  return lista.filter((t) => t !== o);
}

/* Tarifa por tonelada de un destino (o del más caro de varios). */
export function tarifaPara(tarifas, lugares) {
  const k = (x) => norm(x).replace(/[^A-Z0-9]/g, ''); // «CD. JUAREZ» = «CD JUAREZ»
  const hallados = lugares.map((l) => (tarifas || []).find((t) => k(t.destino) === k(l))).filter(Boolean);
  if (!hallados.length) return null;
  return hallados.sort((a, b) => (Number(b.tarifa) || 0) - (Number(a.tarifa) || 0))[0];
}
/* Cliente por número (venta / destino de envío) o por nombre. */
export function clientePara(clientes, f) {
  const codigos = new Set((f.paradas || []).flatMap((p) => [p.codigo, p.venta]).filter(Boolean).map(String));
  return (clientes || []).find((c) => c.num && codigos.has(String(c.num)))
    || (clientes || []).find((c) => norm(c.nombre) && (norm(c.nombre) === norm(f.cliente) || norm(f.cliente).startsWith(norm(c.nombre)) || norm(c.nombre).startsWith(norm(f.cliente))));
}
