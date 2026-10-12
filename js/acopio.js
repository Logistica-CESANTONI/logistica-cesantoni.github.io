/* Formato de Acopio (.xlsx / .xlsm): lee las hojas Base, CB360 y Exhibición sin librerías, separa por cliente y destino,
   y calcula tarimas, resto de tarima y peso. Los títulos de columna se buscan por nombre (no por posición), así que el
   formato puede mover columnas. Todo lo calculado se muestra antes de crear los folios para corregirlo a mano. */
import { combinarFolios, tarimas, tipoUnidad, redondeo, norm, coordenadasDeLiga } from './reglas.js?v=18';
import { embalajeDe } from './embalajes.js?v=18';

export const HOJAS = [['BASE', 'Base'], ['CB360', 'CB360'], ['EXHIBICION', 'Exhibición']];

/* ---------------------------------------------------------------- lectura del archivo */
const dec = new TextDecoder();
const desc = (v) => String(v).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');

async function inflar(datos) {
  const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}
async function leerZip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fin = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error('El archivo no es un Excel (.xlsx o .xlsm) válido. Si es .xls antiguo, guárdalo como .xlsx.');
  const total = v.getUint16(fin + 10, true);
  let p = v.getUint32(fin + 16, true);
  const out = {};
  for (let n = 0; n < total; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('El archivo de Excel está dañado.');
    const metodo = v.getUint16(p + 10, true), tam = v.getUint32(p + 20, true);
    const largo = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), coment = v.getUint16(p + 32, true), local = v.getUint32(p + 42, true);
    const nombre = dec.decode(bytes.subarray(p + 46, p + 46 + largo));
    p += 46 + largo + extra + coment;
    if (!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(nombre)) continue;
    const inicio = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const datos = bytes.subarray(inicio, inicio + tam);
    if (metodo === 0) out[nombre] = datos.slice();
    else if (metodo === 8) out[nombre] = await inflar(datos);
    else throw new Error('El Excel usa una compresión no soportada.');
  }
  return out;
}
function textosCompartidos(xml) {
  return (xml.match(/<si>[\s\S]*?<\/si>/g) || []).map((si) =>
    desc((si.replace(/<rPh[\s\S]*?<\/rPh>/g, '').match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
}
const colNum = (letras) => [...letras].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
/* Hoja → matriz de filas (arreglo de valores; números como número). */
function filasDe(xml, compartidos) {
  const filas = [];
  (xml.match(/<c r="[A-Z]+\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []).forEach((c) => {
    const [, letras, num] = c.match(/r="([A-Z]+)(\d+)"/), t = (c.match(/ t="(\w+)"/) || [])[1];
    const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1], inline = (c.match(/<is>[\s\S]*?<\/is>/) || [])[0];
    let val = t === 's' ? compartidos[Number(v)] : inline ? desc(inline.replace(/<[^>]+>/g, '')) : v === undefined ? '' : desc(v);
    if ((t === undefined || t === 'n') && val !== '' && !isNaN(Number(val))) val = Number(val);
    if (t === 'b') val = v === '1';
    const f = Number(num) - 1;
    (filas[f] = filas[f] || [])[colNum(letras)] = val;
  });
  return filas.map((f) => f || []);
}
export async function leerLibro(bytes) {
  const a = await leerZip(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  if (!a['xl/workbook.xml']) throw new Error('El archivo no es un libro de Excel.');
  const libro = dec.decode(a['xl/workbook.xml']), rels = dec.decode(a['xl/_rels/workbook.xml.rels'] || new Uint8Array());
  const compartidos = a['xl/sharedStrings.xml'] ? textosCompartidos(dec.decode(a['xl/sharedStrings.xml'])) : [];
  const hojas = {};
  [...libro.matchAll(/<sheet\b[^>]*>/g)].forEach(([tag]) => {
    const nombre = desc((tag.match(/name="([^"]*)"/) || [])[1] || ''), rid = (tag.match(/r:id="([^"]+)"/) || [])[1];
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes('Id="' + rid + '"'));
    if (!rel) return;
    let destino = rel.match(/Target="([^"]+)"/)[1].replace(/^\/?xl\//, '').replace(/^\//, '');
    const ruta = 'xl/' + destino;
    if (a[ruta]) hojas[nombre] = filasDe(dec.decode(a[ruta]), compartidos);
  });
  return hojas;
}

/* ---------------------------------------------------------------- interpretación */
/* Cada columna se reconoce por su título. El orden importa: se prueba primero lo más específico. */
const COLUMNAS = [
  ['cajas_x_tarima', /^(CAJAS?|CJ|CJS)\s*(X|POR|\/)\s*(TARIMA|PALLET)/],
  ['m2_x_tarima', /^(M2|MTS2|METROS?( CUADRADOS)?)\s*(X|POR|\/)\s*(TARIMA|PALLET)/],
  ['peso_x_caja', /^(PESO|KG|KILOS)\s*(X|POR|\/)\s*(CAJA|CJ)/],
  ['folio', /^(FOLIO|PEDIDO|NO\.? ?PEDIDO|NUM\.? ?PEDIDO|ORDEN( DE VENTA)?|OV|REMISION|DOCUMENTO)\b/],
  ['cliente', /^(CLIENTE|NOMBRE( DEL)? CLIENTE|RAZON SOCIAL|DISTRIBUIDOR)\b/],
  ['destino', /^(DESTINO|CIUDAD( DESTINO)?|PLAZA|LUGAR DE ENTREGA|DIRECCION( DE ENTREGA)?|SUCURSAL|CONSIGNATARIO)\b/],
  ['tarimas', /^(TARIMAS?|PALLETS?|NO\.? ?TARIMAS|TOTAL TARIMAS)\b/],
  ['peso_ton', /^(PESO|PESO TOTAL|PESO BRUTO)?\s*\(?(TON|TONS|TONELADAS)\)?$/],
  ['peso', /^(PESO|PESO TOTAL|PESO BRUTO|KG|KILOS|KILOGRAMOS)\b/],
  ['cajas', /^(CAJAS?|CJS?|TOTAL CAJAS)\b/],
  ['m2', /^(M2|MTS2|METROS CUADRADOS)\b/]
];
function reconocer(titulo) {
  const t = norm(titulo).replace(/[.:]$/, '');
  if (!t) return null;
  const hit = COLUMNAS.find(([, re]) => re.test(t));
  return hit ? hit[0] : null;
}
/* Busca la fila de títulos (la primera, en las 40 de arriba, con cliente o destino y al menos otra columna conocida). */
function encabezado(filas) {
  for (let i = 0; i < Math.min(filas.length, 40); i++) {
    const mapa = {};
    (filas[i] || []).forEach((v, c) => { const k = reconocer(v); if (k && mapa[k] === undefined) mapa[k] = c; });
    const n = Object.keys(mapa).length;
    if ((mapa.cliente !== undefined || mapa.destino !== undefined) && n >= 2) return { fila: i, mapa };
  }
  return null;
}
const num = (v) => {
  if (typeof v === 'number') return v;
  const n = Number(String(v || '').replace(/[,\s]/g, '').replace(/kg$/i, ''));
  return isNaN(n) ? 0 : n;
};
const texto = (v) => String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();

function renglonesDe(filas, hoja) {
  const enc = encabezado(filas);
  if (!enc) return { renglones: [], aviso: 'No se encontraron los títulos (Cliente / Destino, Tarimas, Peso…) en la hoja ' + hoja + '.' };
  const m = enc.mapa, renglones = [];
  let ultimoCliente = '', ultimoDestino = '', ultimoFolio = '';
  for (let i = enc.fila + 1; i < filas.length; i++) {
    const f = filas[i] || [], g = (k) => (m[k] === undefined ? '' : f[m[k]]);
    const primera = norm(f.find((x) => texto(x)) || '');
    if (/^(TOTAL|TOTALES|SUBTOTAL|GRAN TOTAL)\b/.test(primera)) continue;
    // Celdas combinadas: el cliente o destino solo viene en la primera fila del grupo.
    const cliente = texto(g('cliente')) || ultimoCliente, destino = texto(g('destino')) || ultimoDestino;
    const folio = texto(g('folio')) || (texto(g('cliente')) ? '' : ultimoFolio);
    let peso = m.peso_ton !== undefined ? num(g('peso_ton')) * 1000 : num(g('peso'));
    if (!peso && m.peso_x_caja !== undefined) peso = num(g('cajas')) * num(g('peso_x_caja'));
    let tar = num(g('tarimas'));
    if (!tar && num(g('cajas_x_tarima')) > 0) tar = num(g('cajas')) / num(g('cajas_x_tarima'));
    if (!tar && num(g('m2_x_tarima')) > 0) tar = num(g('m2')) / num(g('m2_x_tarima'));
    if (!cliente && !destino) continue;
    if (!peso && !tar && !num(g('cajas')) && !num(g('m2'))) continue;
    ultimoCliente = cliente; ultimoDestino = destino; ultimoFolio = folio;
    renglones.push({ hoja, fila: i + 1, folio, cliente, destino, tarimas: tar, peso_kg: peso, cajas: num(g('cajas')), m2: num(g('m2')) });
  }
  return { renglones, aviso: renglones.length ? '' : 'La hoja ' + hoja + ' no tiene renglones con cantidades.' };
}

/* ---------------------------------------------------------------- Formato de Acopio CESANTONI (macro «Nueva Development»)
   Un archivo = un folio (celda junto a «Folio:» en Base o logistica). La hoja Base trae un renglón por partida con
   «Destino envío», «Nom Sucursal», «Destino» (ciudad), «Cliente», «Kg.», «Tarimas» y «Restos tarima - liso / deco» (cajas sueltas).
   CB360 y Exhibición suman su «Peso (kgs)»; los «Espacios» de Exhibición cuentan como tarimas. */
const hojaPor = (hojas, clave) => {
  const n = Object.keys(hojas);
  return n.find((x) => norm(x).replace(/\s/g, '') === clave) || null;
};
function valorJunto(filas, etiqueta, maxFilas, abajoPrimero) {
  for (let i = 0; i < Math.min(filas.length, maxFilas || 8); i++) {
    const f = filas[i] || [];
    for (let c = 0; c < f.length; c++) {
      if (norm(f[c]).replace(/:$/, '') !== etiqueta) continue;
      if (abajoPrimero && texto((filas[i + 1] || [])[c])) return texto(filas[i + 1][c]);
      for (let d = c + 1; d < f.length; d++) if (texto(f[d])) return texto(f[d]);
      const abajo = (filas[i + 1] || [])[c]; // a veces el valor queda en la fila de abajo
      if (texto(abajo)) return texto(abajo);
    }
  }
  return '';
}
function columnas(fila) { const m = {}; (fila || []).forEach((v, c) => { const k = norm(v); if (k && m[k] === undefined) m[k] = c; }); return m; }
function filaTitulos(filas, requeridos) {
  for (let i = 0; i < Math.min(filas.length, 30); i++) { const m = columnas(filas[i]); if (requeridos.every((r) => m[r] !== undefined)) return { fila: i, m }; }
  return null;
}
export function esFormatoCesantoni(hojas) {
  const b = hojaPor(hojas, 'BASE');
  return !!(b && filaTitulos(hojas[b], ['DESTINO ENVIO', 'KG.', 'TARIMAS']));
}
function interpretarCesantoni(hojas) {
  const avisos = [], base = hojas[hojaPor(hojas, 'BASE')], log = hojas[hojaPor(hojas, 'LOGISTICA')] || [];
  const folio = valorJunto(base, 'FOLIO') || valorJunto(log, 'FOLIO');
  // La clasificación (DD, C…) va debajo de su etiqueta.
  const clasificacion = valorJunto(base, 'CLASIFICACION', 8, true) || valorJunto(log, 'CLASIFICACION', 8, true);
  const toneladas = num(valorJunto(base, 'TONELAJE'));
  if (!folio) avisos.push('No se encontró el número de folio (celda junto a «Folio:» en la hoja Base). Escríbelo a mano.');
  const t = filaTitulos(base, ['DESTINO ENVIO', 'KG.', 'TARIMAS']), m = t.m;
  const g = (f, k) => (m[k] === undefined ? '' : f[m[k]]);
  const paradas = new Map(), clientes = new Set(), pedidos = new Set(), material = [];
  let partidas = 0, corregidas = 0;
  for (let i = t.fila + 1; i < base.length; i++) {
    const f = base[i] || [];
    const codigo = texto(g(f, 'DESTINO ENVIO')), kgs = num(g(f, 'KG.'));
    if (!codigo || /^TOTAL/.test(norm(f.find((x) => texto(x)) || ''))) continue;
    if (!kgs && !num(g(f, 'CANT ENVIADA')) && !num(g(f, 'CANTIDAD ENVIADA'))) continue;
    partidas++;
    const cliente = texto(g(f, 'CLIENTE')) || texto(g(f, 'NOMBRE VENTA'));
    if (cliente) clientes.add(cliente);
    if (texto(g(f, 'NUMERO ORDEN'))) pedidos.add(texto(g(f, 'NUMERO ORDEN')));
    if (!paradas.has(codigo)) {
      paradas.set(codigo, { codigo, venta: texto(g(f, 'VENTA')) || texto(g(f, 'NUMERO PRINCIPAL')), sucursal: texto(g(f, 'NOM SUCURSAL')) || cliente, ciudad: texto(g(f, 'DESTINO')) || texto(g(f, 'CD SUCURSAL')),
        tarimas: 0, restos_liso: 0, restos_deco: 0, peso_kg: 0, m2: 0, partidas: 0 });
    }
    const p = paradas.get(codigo);
    const prod = texto(g(f, 'PRODUCTO')) || [texto(g(f, 'DESCRIPCION 1')), texto(g(f, 'LINEA DESCRIPCION 2'))].filter(Boolean).join(' ');
    const sku = texto(g(f, '2º Nº ARTICULO')) || texto(g(f, '2O NO ARTICULO')), cantidad = num(g(f, 'CANT ENVIADA')) || num(g(f, 'CANTIDAD ENVIADA')), um = texto(g(f, 'UM'));
    // Tarimas completas y restos (cajas que no llenan tarima): cantidad ÷ cajas por tarima. Si una tarima lleva 20 cajas y piden 21,
    // es 1 tarima + 1 resto. Las cajas por tarima salen de «Factor Tarimas» del acopio o, si no viene, de Pesos y Embalajes.
    const emb = embalajeDe({ sku, producto: prod });
    const factor = num(g(f, 'FACTOR TARIMAS')) || (emb ? emb.cajas_tarima || emb.paquetes_tarima || 0 : 0);
    let tar = num(g(f, 'TARIMAS')), resto = num(g(f, 'RESTOS TARIMA - LISO')) + num(g(f, 'RESTOS TARIMA - DECO'));
    if (factor > 0 && cantidad > 0 && (!um || /^(CJ|CAJA|PQ|PAQ|SA|SACO)/i.test(um))) {
      const calcT = Math.floor(cantidad / factor + 1e-9), calcR = redondeo(cantidad - calcT * factor, 2);
      if (calcT !== tar || calcR !== resto) corregidas++;
      tar = calcT; resto = calcR;
    }
    const deco = /^DEC/i.test(texto(g(f, 'LIS/DEC'))) || (!texto(g(f, 'LIS/DEC')) && num(g(f, 'RESTOS TARIMA - DECO')) > 0);
    material.push({ destino: codigo, orden: texto(g(f, 'NUMERO ORDEN')), sku, producto: prod,
      formato: texto(g(f, 'FORMATO')), cantidad, um, cajas_tarima: factor || 0,
      tarimas: tar, restos: resto, kg: redondeo(kgs, 2), m2: redondeo(num(g(f, 'MTS')), 2),
      lote: texto(g(f, 'Nº LOTE /SERIE')), oc: texto(g(f, 'OC CLIENTE')) });
    p.tarimas += tar; if (deco) p.restos_deco += resto; else p.restos_liso += resto;
    p.peso_kg += kgs; p.m2 += num(g(f, 'MTS')); p.partidas++;
  }
  if (corregidas) avisos.push(corregidas + ' partida(s) con tarimas o restos distintos a los del acopio: se calcularon con las cajas por tarima (cantidad ÷ cajas por tarima). Revisa el material.');
  const lista = [...paradas.values()].map((p) => Object.assign(p, { peso_kg: redondeo(p.peso_kg, 2), m2: redondeo(p.m2, 2), tarimas: redondeo(p.tarimas, 2) }));
  if (!lista.length) avisos.push('La hoja Base no trae partidas con destino y kilos.');
  const pesoBase = lista.reduce((s, p) => s + p.peso_kg, 0);
  if (toneladas && Math.abs(toneladas * 1000 - pesoBase) > 1) avisos.push('El tonelaje del encabezado (' + toneladas.toFixed(3) + ' t) no coincide con la suma de kilos de Base (' + (pesoBase / 1000).toFixed(3) + ' t). Revisa el archivo.');
  // CB360 y Exhibición
  const hojas2 = [], extra = { peso_kg: 0, tarimas: 0 };
  [['CB360', 'CB360', ['PESO (KGS)']], ['EXHIBICION', 'Exhibición', ['PESO (KGS)']]].forEach(([clave, etiqueta, req]) => {
    const n = hojaPor(hojas, clave);
    if (!n) return;
    const tt = filaTitulos(hojas[n], req);
    if (!tt) return;
    let kgs = 0, esp = 0, filas = 0;
    for (let i = tt.fila + 1; i < hojas[n].length; i++) {
      const f = hojas[n][i] || [];
      if (/^TOTAL/.test(norm(f.find((x) => texto(x)) || ''))) continue;
      const k = num(f[tt.m['PESO (KGS)']]), e = tt.m.ESPACIOS === undefined ? 0 : num(f[tt.m.ESPACIOS]);
      if (!k && !e) continue;
      kgs += k; esp += e; filas++;
    }
    if (filas) { hojas2.push(etiqueta); extra.peso_kg += kgs; extra.tarimas += esp; }
  });
  const tarimasTot = lista.reduce((s, p) => s + p.tarimas, 0) + extra.tarimas;
  const restos = lista.reduce((s, p) => s + p.restos_liso + p.restos_deco, 0);
  const peso = redondeo(pesoBase + extra.peso_kg, 0);
  const grupo = {
    folio: combinarFolios([folio]) || '', cliente: [...clientes].join(' / '), destino: [...new Set(lista.map((p) => p.ciudad))].join(' / '),
    hojas: (lista.length ? ['Base'] : []).concat(hojas2), clasificacion, pedidos: [...pedidos],
    tarimas: redondeo(tarimasTot, 2), resto: restos, peso_kg: peso, tipo_unidad: tipoUnidad(peso), renglones: partidas,
    paradas: lista, extra, material, tipo_envio: 'NACIONAL'
  };
  return { grupos: lista.length || folio ? [grupo] : [], avisos };
}
/* Junta varios folios en un mismo embarque: «549/35298» (sin letra), paradas y totales sumados. */
export function combinar(grupos) {
  const paradas = [];
  grupos.forEach((g) => (g.paradas || []).forEach((p) => {
    const ya = paradas.find((x) => x.codigo === p.codigo);
    if (!ya) paradas.push(Object.assign({}, p));
    else ['tarimas', 'restos_liso', 'restos_deco', 'peso_kg', 'm2', 'partidas'].forEach((k) => { ya[k] = redondeo(ya[k] + p[k], 2); });
  }));
  const peso = redondeo(grupos.reduce((s, g) => s + (Number(g.peso_kg) || 0), 0), 0);
  const uni = (k) => [...new Set(grupos.flatMap((g) => String(g[k] || '').split(' / ')).filter(Boolean))].join(' / ');
  return {
    folio: combinarFolios(grupos.map((g) => g.folio)), cliente: uni('cliente'), destino: uni('destino'),
    hojas: [...new Set(grupos.flatMap((g) => g.hojas || []))], clasificacion: uni('clasificacion'),
    tarimas: redondeo(grupos.reduce((s, g) => s + (Number(g.tarimas) || 0), 0), 2), resto: grupos.reduce((s, g) => s + (Number(g.resto) || 0), 0),
    peso_kg: peso, tipo_unidad: tipoUnidad(peso), renglones: grupos.reduce((s, g) => s + (g.renglones || 0), 0), paradas,
    material: grupos.flatMap((g) => g.material || []), tipo_envio: grupos[0].tipo_envio || 'NACIONAL'
  };
}

/* ---------------------------------------------------------------- Cuadro de Envío (Última Milla)
   Una hoja con etiquetas («NO. DE FOLIO», «CALLE», «LINK DE GOOGLE MAPS»…) y el valor a su derecha. Las casillas
   (descarga manual, gran formato…) llegan como verdadero/falso. */
const ETIQUETAS_CUADRO = ['NO. DE FOLIO', 'NO. DE EMBARQUE', 'PAGO DE FLETE DIRECTO', 'NO. DE ORDEN', 'NO. DE FACTURA', 'GRAN FORMATO', 'NOMBRE DEL CLIENTE',
  'NOMBRE DE QUIEN RECIBE', 'TELEFONO PRINCIPAL', 'TELEFONO SECUNDARIO', 'CALLE', 'COLONIA', 'NO. INTERIOR', 'NO. EXTERIOR', 'CP', 'LOCALIDAD', 'MUNICIPIO',
  'LINK DE GOOGLE MAPS', 'OBSERVACIONES', 'TIPO DE DESCARGA', 'DESCARGA MANUAL', 'DESCARGA MONTACARGAS', 'DETALLES DE ENVIO', 'PESO (KG)', 'METROS', 'ADHESIVOS',
  'MATERIAL ALMACEN DISTINTO AL 2100', 'CUADRO DE ENVIO'];
export function esCuadroEnvio(hojas) { return !!hojaPor(hojas, 'CUADRODEENVIO'); }
function camposCuadro(filas) {
  const out = {};
  filas.forEach((f) => {
    (f || []).forEach((v, c) => {
      const k = norm(v).replace(/:$/, '');
      if (!ETIQUETAS_CUADRO.includes(k) || out[k] !== undefined) return;
      let val = '';
      for (let d = c + 1; d < f.length; d++) {
        if (f[d] === undefined || f[d] === null || f[d] === '') continue;
        if (ETIQUETAS_CUADRO.includes(norm(f[d]).replace(/:$/, ''))) break; // siguiente etiqueta: el campo quedó vacío
        val = f[d]; break;
      }
      out[k] = val;
    });
  });
  return out;
}
const si = (v) => v === true || v === 1 || /^(1|SI|SÍ|X|TRUE|VERDADERO)$/i.test(String(v).trim());
function interpretarCuadro(hojas) {
  const avisos = [], c = camposCuadro(hojas[hojaPor(hojas, 'CUADRODEENVIO')]);
  const folio = texto(c['NO. DE FOLIO']);
  if (!folio) avisos.push('No se encontró el número de folio (NO. DE FOLIO). Escríbelo a mano.');
  const maps = texto(c['LINK DE GOOGLE MAPS']), pos = coordenadasDeLiga(maps);
  const peso = redondeo(num(c['PESO (KG)']), 2);
  if (!peso) avisos.push('El cuadro no trae PESO (KG).');
  const descarga = si(c['DESCARGA MONTACARGAS']) ? 'MONTACARGAS' : si(c['DESCARGA MANUAL']) ? 'MANUAL' : '';
  const entrega = {
    recibe: texto(c['NOMBRE DE QUIEN RECIBE']), telefono: texto(c['TELEFONO PRINCIPAL']), telefono2: texto(c['TELEFONO SECUNDARIO']),
    calle: texto(c.CALLE), no_ext: texto(c['NO. EXTERIOR']), no_int: texto(c['NO. INTERIOR']), colonia: texto(c.COLONIA), cp: texto(c.CP),
    localidad: texto(c.LOCALIDAD), municipio: texto(c.MUNICIPIO), maps, observaciones: texto(c.OBSERVACIONES), descarga,
    embarque: texto(c['NO. DE EMBARQUE']), orden: texto(c['NO. DE ORDEN']), factura: texto(c['NO. DE FACTURA']),
    flete_directo: si(c['PAGO DE FLETE DIRECTO']), gran_formato: si(c['GRAN FORMATO']), adhesivos: si(c.ADHESIVOS),
    almacen_distinto: si(c['MATERIAL ALMACEN DISTINTO AL 2100'])
  };
  const lugar = entrega.localidad || entrega.municipio;
  return { avisos, grupos: [{
    tipo_envio: 'ULTIMA_MILLA', folio: combinarFolios([folio]) || '', cliente: texto(c['NOMBRE DEL CLIENTE']),
    destino: [lugar, entrega.municipio && entrega.municipio !== lugar ? entrega.municipio : ''].filter(Boolean).join(', '),
    hojas: ['Cuadro de Envío'], tarimas: 0, resto: 0, peso_kg: peso, m2: redondeo(num(c.METROS), 2), tipo_unidad: tipoUnidad(peso),
    entrega, lat: pos ? pos.lat : null, lng: pos ? pos.lng : null, renglones: 1
  }] };
}

/* Libro → { grupos: [...], avisos: [...] }. Con el Formato de Acopio CESANTONI sale un grupo (el folio del archivo);
   con otros formatos, un grupo por cliente + destino. */
export function interpretar(hojas) {
  if (esCuadroEnvio(hojas)) return interpretarCuadro(hojas);
  if (esFormatoCesantoni(hojas)) return interpretarCesantoni(hojas);
  const avisos = [], renglones = [];
  const nombres = Object.keys(hojas);
  HOJAS.forEach(([clave, etiqueta]) => {
    const nombre = nombres.find((n) => norm(n).replace(/\s/g, '') === clave) || nombres.find((n) => norm(n).replace(/\s/g, '').startsWith(clave));
    if (!nombre) { avisos.push('El archivo no trae la hoja ' + etiqueta + '.'); return; }
    const r = renglonesDe(hojas[nombre], etiqueta);
    if (r.aviso) avisos.push(r.aviso);
    renglones.push(...r.renglones);
  });
  const mapa = new Map();
  renglones.forEach((r) => {
    const k = norm(r.cliente) + '|' + norm(r.destino);
    if (!mapa.has(k)) mapa.set(k, { cliente: r.cliente, destino: r.destino, folios: [], hojas: {}, tarimas: 0, peso_kg: 0, renglones: 0 });
    const gr = mapa.get(k);
    if (r.folio) gr.folios.push(r.folio);
    gr.hojas[r.hoja] = (gr.hojas[r.hoja] || 0) + 1;
    gr.tarimas += r.tarimas; gr.peso_kg += r.peso_kg; gr.renglones++;
  });
  const grupos = [...mapa.values()].map((g) => {
    const t = tarimas(g.tarimas), peso = redondeo(g.peso_kg, 0);
    return {
      folio: combinarFolios(g.folios), cliente: g.cliente, destino: g.destino, hojas: Object.keys(g.hojas),
      // Otros formatos no traen cajas por tarima: las tarimas quedan con decimales y los restos (cajas) en 0.
      tarimas: t.total, tarimas_completas: t.completas, resto: 0, peso_kg: peso, tipo_unidad: tipoUnidad(peso), renglones: g.renglones
    };
  });
  if (!grupos.length && !avisos.length) avisos.push('No se encontró ningún pedido en el archivo.');
  return { grupos, avisos };
}

/* ---------------------------------------------------------------- Modificaciones
   Compara el folio guardado con el acopio nuevo: partidas nuevas, quitadas y con otra cantidad («se sube», «se baja»),
   y la diferencia de kilos, tarimas y restos. Una partida es el mismo producto (SKU), lote y destino de envío. */
export function compararFolio(antes, despues) {
  const llave = (m) => [m.destino, m.sku || m.producto, m.lote].join('|');
  const suma = (lista) => { const r = new Map(); (lista || []).forEach((m) => { const k = llave(m); const ya = r.get(k); if (ya) ya.cantidad += Number(m.cantidad) || 0; else r.set(k, Object.assign({}, m, { cantidad: Number(m.cantidad) || 0 })); }); return r; };
  const a = suma(antes.material), d = suma(despues.material), lineas = [];
  d.forEach((m, k) => {
    const x = a.get(k);
    if (!x) lineas.push({ tipo: 'nueva', producto: m.producto, sku: m.sku, um: m.um, antes: 0, despues: m.cantidad });
    else if (x.cantidad !== m.cantidad) lineas.push({ tipo: m.cantidad > x.cantidad ? 'sube' : 'baja', producto: m.producto, sku: m.sku, um: m.um, antes: x.cantidad, despues: m.cantidad });
  });
  a.forEach((m, k) => { if (!d.has(k)) lineas.push({ tipo: 'quitada', producto: m.producto, sku: m.sku, um: m.um, antes: m.cantidad, despues: 0 }); });
  const kg = [Number(antes.peso_kg) || 0, Number(despues.peso_kg) || 0], tar = [Number(antes.tarimas) || 0, Number(despues.tarimas) || 0], res = [Number(antes.resto) || 0, Number(despues.resto) || 0];
  const otros = [];
  if (String(antes.destino || '') !== String(despues.destino || '')) otros.push('destino: ' + (antes.destino || '—') + ' → ' + (despues.destino || '—'));
  if (String(antes.cliente || '') !== String(despues.cliente || '')) otros.push('cliente: ' + (antes.cliente || '—') + ' → ' + (despues.cliente || '—'));
  const igual = !lineas.length && Math.abs(kg[0] - kg[1]) < 0.5 && tar[0] === tar[1] && res[0] === res[1] && !otros.length;
  const signo = (n, u) => (n > 0 ? '+' : '') + (Math.round(n * 100) / 100).toLocaleString('es-MX') + u;
  const partes = [];
  const n = (t) => lineas.filter((l) => l.tipo === t).length;
  if (n('sube')) partes.push(n('sube') + ' se sube');
  if (n('baja')) partes.push(n('baja') + ' se baja');
  if (n('nueva')) partes.push(n('nueva') + ' nueva(s)');
  if (n('quitada')) partes.push(n('quitada') + ' quitada(s)');
  if (Math.abs(kg[1] - kg[0]) >= 0.5) partes.push(signo(kg[1] - kg[0], ' kg') + ' (' + kg[0].toLocaleString('es-MX') + ' → ' + kg[1].toLocaleString('es-MX') + ' kg)');
  if (tar[0] !== tar[1]) partes.push('tarimas ' + tar[0] + ' → ' + tar[1]);
  if (res[0] !== res[1]) partes.push('restos ' + res[0] + ' → ' + res[1] + ' cj');
  return { igual, lineas, kg, tarimas: tar, restos: res, otros, resumen: igual ? 'sin cambios' : partes.concat(otros).join(' · ') + (lineas.length ? ' · ' + lineas.slice(0, 8).map((l) => l.producto.slice(0, 40) + ' ' + l.antes + '→' + l.despues).join('; ') : '') };
}
