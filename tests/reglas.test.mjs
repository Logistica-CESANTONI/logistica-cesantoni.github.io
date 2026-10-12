/* node --test tests/reglas.test.mjs  (necesita tests/acopio.xlsx: python3 tests/acopio_ejemplo.py tests/acopio.xlsx) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { combinarFolios, tipoUnidad, tarimas, idFolio, docsCompletos, revisarChecklist, excedeCapacidad, coordenadasDeLiga, esLigaCorta, puntualidad, destinatarios } from '../js/reglas.js';
import { revisarPartida, EMBALAJES } from '../js/embalajes.js';
import { desdeSeguimiento, desdeFletes, combinarCatalogos, tarifaPara, clientePara, unirTransportista } from '../js/catalogos.js';
import { leerLibro, interpretar, combinar, compararFolio } from '../js/acopio.js';
import { planear, km } from '../js/ruta.js';
import { simulada } from '../js/gps.js';

test('folios combinados con «/» y sin letra', () => {
  assert.equal(combinarFolios(['12345A']), '12345A');
  assert.equal(combinarFolios(['12345A', '12346B']), '12345/12346');
  assert.equal(combinarFolios(['30010 Y 30011']), '30010/30011');
  assert.equal(combinarFolios(['30010 y 30011B']), '30010/30011');
  assert.equal(combinarFolios(['22001', '22001']), '22001');
  assert.equal(idFolio('12345/12346'), '12345-12346');
});
test('SENCILLO hasta 40 t, FULL arriba', () => {
  assert.equal(tipoUnidad(40000), 'SENCILLO');
  assert.equal(tipoUnidad(40001), 'FULL');
  assert.equal(tipoUnidad(0), 'SENCILLO');
});
test('tarimas y resto', () => {
  assert.deepEqual(tarimas(4.5), { total: 4.5, completas: 4, resto: 0.5 });
  assert.deepEqual(tarimas(3), { total: 3, completas: 3, resto: 0 });
});
test('documentos, checklist y capacidad', () => {
  assert.equal(docsCompletos({ factura: true, carta_porte: true, remision: false }), false);
  assert.equal(docsCompletos({ factura: true, carta_porte: true, remision: true }), true);
  const todo = Object.fromEntries(['llantas', 'luces', 'frenos', 'espejos', 'cinturones', 'extintor', 'documentos', 'combustible'].map((k) => [k, 'ok']));
  assert.deepEqual(revisarChecklist(todo), { contestado: true, pasa: true, reprobados: [] });
  assert.equal(revisarChecklist({ ...todo, frenos: 'mal' }).pasa, false);
  assert.deepEqual(revisarChecklist({ ...todo, frenos: 'mal' }).reprobados, ['Frenos']);
  assert.equal(revisarChecklist({ llantas: 'ok' }).contestado, false);
  assert.equal(excedeCapacidad(30000, 28000), true);
  assert.equal(excedeCapacidad(30000, 0), false);
});
test('Formato de Acopio: hojas Base, CB360 y Exhibición', { skip: !existsSync(new URL('./acopio.xlsx', import.meta.url)) }, async () => {
  const hojas = await leerLibro(new Uint8Array(readFileSync(new URL('./acopio.xlsx', import.meta.url))));
  const { grupos, avisos } = interpretar(hojas);
  assert.deepEqual(avisos, []);
  const por = Object.fromEntries(grupos.map((g) => [g.cliente, g]));
  assert.equal(grupos.length, 4);
  // Home Depot: dos pedidos con letra → combinados sin letra; tarimas 120/48 + 60/40 = 4.0
  assert.equal(por['Home Depot'].folio, '12345/12346');
  assert.equal(por['Home Depot'].tarimas, 4);
  assert.equal(por['Home Depot'].peso_kg, 5700);
  assert.equal(por['Home Depot'].tipo_unidad, 'SENCILLO');
  // Interceramic: Base (8 + 2 tarimas, 42 t) + CB360 (2 tarimas, 1.5 t) → FULL; la fila TOTAL no cuenta
  assert.equal(por['Interceramic Norte'].folio, '22001');
  assert.equal(por['Interceramic Norte'].tarimas, 12);
  assert.equal(por['Interceramic Norte'].peso_kg, 43500);
  assert.equal(por['Interceramic Norte'].tipo_unidad, 'FULL');
  assert.deepEqual(por['Interceramic Norte'].hojas, ['Base', 'CB360']);
  assert.equal(por['Distribuidora Bajío'].folio, '30010/30011');
  assert.equal(por['Distribuidora Bajío'].tarimas, 3.5);
  // Exhibición en toneladas → kg
  assert.equal(por['Showroom Polanco'].peso_kg, 800);
  assert.equal(por['Showroom Polanco'].destino, 'CDMX');
  assert.equal(por['Showroom Polanco'].resto, 0);
});
test('ruta más corta (línea recta)', () => {
  const o = { lat: 0, lng: 0 };
  const p = [{ n: 'C', lat: 0, lng: 3 }, { n: 'A', lat: 0, lng: 1 }, { n: 'B', lat: 0, lng: 2 }];
  const r = planear(o, p, false);
  assert.deepEqual(r.orden.map((x) => x.n), ['A', 'B', 'C']);
  assert.ok(Math.abs(r.km - km(o, p[0])) < 0.01);
  // 2-opt corrige el cruce que deja el vecino más cercano
  const q = [{ n: 1, lat: 0, lng: 1 }, { n: 2, lat: 1, lng: 1 }, { n: 3, lat: 1, lng: 0 }, { n: 4, lat: 0, lng: 2.1 }];
  const r2 = planear(o, q, true);
  assert.equal(r2.tramos.length, 5);
});
test('GPS simulado avanza y llega', () => {
  const o = { lat: 20, lng: -103 }, d = { lat: 21, lng: -103 };
  const salida = new Date('2026-10-12T08:00:00Z').toISOString();
  const a = simulada(o, d, salida, Date.parse('2026-10-12T09:00:00Z'));
  assert.equal(a.fuente, 'simulado');
  assert.ok(a.lat > 20 && a.lat < 21 && a.velocidad > 0);
  const b = simulada(o, d, salida, Date.parse('2026-10-12T20:00:00Z'));
  assert.equal(b.lat, 21); assert.equal(b.velocidad, 0);
  assert.equal(simulada(o, null, salida).lat, 20);
});
test('Formato de Acopio CESANTONI: un folio por archivo, por destino de envío', async () => {
  const leer = async (n) => interpretar(await leerLibro(new Uint8Array(readFileSync(new URL(n, import.meta.url)))));
  const { grupos, avisos } = await leer('./acopio-cesantoni.xlsm');
  assert.deepEqual(avisos, []);
  assert.equal(grupos.length, 1);
  const g = grupos[0];
  assert.equal(g.folio, '7777A');
  assert.equal(g.clasificacion, 'C');
  assert.equal(g.cliente, 'CLIENTE PRUEBA SA DE CV');
  assert.equal(g.destino, 'LEON / QUERETARO');
  assert.deepEqual(g.paradas.map((p) => [p.codigo, p.sucursal, p.tarimas, p.restos_liso, p.restos_deco, p.peso_kg]),
    [['9001', 'PRUEBA Suc. LEON', 13, 3, 2, 26000], ['9002', 'PRUEBA Suc. QRO', 8, 0, 0, 15000]]);
  // Base (41 t) + Exhibición (500 kg, 1 espacio) → 41.5 t, FULL
  assert.equal(g.peso_kg, 41500);
  assert.equal(g.tarimas, 22);
  assert.equal(g.resto, 5);
  assert.equal(g.tipo_unidad, 'FULL');
  assert.deepEqual(g.hojas, ['Base', 'Exhibición']);
  assert.equal(g.material.length, 3);
  assert.equal(g.material[2].producto !== undefined, true);
  // Dos acopios en la misma unidad
  const g2 = (await leer('./acopio-cesantoni-2.xlsm')).grupos[0];
  const c = combinar([g, g2]);
  assert.equal(c.folio, '7777/8888');
  assert.equal(c.peso_kg, 83000);
  assert.equal(c.paradas.length, 2);
  assert.equal(c.paradas[0].tarimas, 26);
});
test('Cuadro de Envío (Última Milla)', async () => {
  const leer = async (n) => interpretar(await leerLibro(new Uint8Array(readFileSync(new URL(n, import.meta.url)))));
  const r = await leer('./cuadro-envio.xlsm');
  assert.deepEqual(r.avisos, []);
  const g = r.grupos[0];
  assert.equal(g.tipo_envio, 'ULTIMA_MILLA');
  assert.equal(g.folio, '9001');
  assert.equal(g.cliente, 'CLIENTE DE PRUEBA');
  assert.equal(g.destino, 'ZACATECAS');
  assert.equal(g.peso_kg, 615.56);
  assert.equal(g.m2, 36.96);
  assert.equal(g.entrega.descarga, 'MANUAL');
  assert.equal(g.entrega.no_ext, '10');
  assert.equal(g.entrega.no_int, '');          // vacío: no toma la etiqueta de al lado
  assert.equal(g.entrega.telefono2, '');
  assert.equal(g.entrega.gran_formato, false);
  assert.equal(g.lat, null);                    // liga corta: sin coordenadas
  const g2 = (await leer('./cuadro-envio-2.xlsm')).grupos[0];
  assert.deepEqual([g2.lat, g2.lng], [22.7472, -102.5182]);
});
test('Ligas de Google Maps', () => {
  assert.deepEqual(coordenadasDeLiga('https://www.google.com/maps/place/X/@22.6489,-102.9913,15z/data=!3d22.6478!4d-102.9902'), { lat: 22.6478, lng: -102.9902 });
  assert.deepEqual(coordenadasDeLiga('https://www.google.com/maps/@19.4326,-99.1332,14z'), { lat: 19.4326, lng: -99.1332 });
  assert.deepEqual(coordenadasDeLiga('https://maps.google.com/?q=22.64,-102.99'), { lat: 22.64, lng: -102.99 });
  assert.deepEqual(coordenadasDeLiga('20.67, -103.35'), { lat: 20.67, lng: -103.35 });
  assert.equal(coordenadasDeLiga('https://maps.app.goo.gl/TtiYoWf2PJQ1jwN49'), null);
  assert.equal(esLigaCorta('https://maps.app.goo.gl/TtiYoWf2PJQ1jwN49'), true);
});
test('Pesos y embalajes: formato por descripción y rango de kilos', () => {
  const r1 = revisarPartida({ producto: 'EMILIA MATE BONE CE 30*60 PRC RECT 1.44 MT2/48 CJ-TAR 20', cantidad: 336, um: 'CJ', kg: 10516.8 });
  assert.equal(r1.embalaje.formato, '30*60 RECT PRC');
  assert.equal(r1.tarimas_calc, 7);
  assert.equal(r1.fuera_de_rango, false);
  const r2 = revisarPartida({ producto: 'EMILIA MATE BONE CE 30*30 MALL A PRC RECT 0.527 MT2/90 CJ 026', cantidad: 3, um: 'CJ', kg: 34.68 });
  assert.equal(r2.embalaje.formato, '32.5*29.5 MALLA');
  assert.equal(r2.restos_calc, 3);
  assert.equal(revisarPartida({ producto: 'HARLOW CE 20*120 RECT 1.68 MT2/ 24 CJ-TAR 08', cantidad: 2, um: 'CJ', kg: 90 }).fuera_de_rango, true);
  assert.equal(revisarPartida({ sku: 'P061301635P3', producto: 'PEGAPISO', cantidad: 250 }).tarimas_calc, 2);
  assert.equal(EMBALAJES.length, 46);
});
test('Catálogos de Nacional (Seguimiento + Fletes)', async () => {
  const leer = async (n) => leerLibro(new Uint8Array(readFileSync(new URL(n, import.meta.url))));
  const seg = desdeSeguimiento(await leer('./seguimiento-ejemplo.xlsx')), fle = desdeFletes(await leer('./fletes-ejemplo.xlsx'));
  assert.equal(seg.transportistas.length, 2);
  assert.equal(seg.destinos.length, 4);
  assert.equal(seg.destinos.find((d) => d.destino === 'LEON').dias, null); // #N/A → vacío
  const r = combinarCatalogos({ seguimiento: seg, fletes: fle, actuales: { transportistas: [{ nombre: 'FLETES DEL BAJÍO', url: 'https://espejo', usuario: 'u' }] } });
  const fb = r.transportistas.find((t) => /BAJIO/i.test(t.razon_social || ''));
  assert.equal(fb.url, 'https://espejo');            // conserva la cuenta espejo
  assert.equal(fb.plazo_pago, 30);                   // razón social de Fletes sin «S.A. de C.V.» empata
  assert.equal(r.transportistas.find((t) => t.nombre === 'Transportes Ejemplo').plazo_pago, 60);
  const saltillo = r.tarifas.find((t) => t.destino === 'SALTILLO');
  assert.deepEqual([saltillo.tarifa, saltillo.tarifa_fletes, saltillo.dias], [530, 560, 1]);
  assert.equal(r.tarifas.find((t) => t.destino === 'LEON').tarifa, 260);          // se usa la Tarifa LP de Fletes
  assert.equal(fb.razon_social_fletes, 'MARIA PERSONA FISICA');                    // empata por correo
  assert.equal(r.transportistas.some((t) => t.nombre === 'MARIA PERSONA FISICA'), false);
  // Razón social con un nombre de menos, «EXPRES» = «EXPRESS» y nombre comercial en el correo
  const h = combinarCatalogos({ seguimiento: { transportistas: [
    { nombre: 'TRANSPORTES SOL', razon_social: 'PEDRO ALBERTO GOMEZ RUIZ', telefono: '1' },
    { nombre: 'TRANSPORTES TEX', razon_social: 'TERRESTRE EXPRESS DEL NORTE', telefono: '2' },
    { nombre: 'TRANSPORTES RIOS INTERNACIONAL', razon_social: 'ANA RIOS', telefono: '3' }], destinos: [], clientes: [] },
  fletes: { transportistas: [{ razon_social: 'PEDRO GOMEZ RUIZ', plazo_pago: 30 }, { razon_social: 'TERRESTRE EXPRES DEL NORTE', plazo_pago: 45 },
    { razon_social: 'ANA RIOS PEREZ', correo: 'internacional.rios@mail.example', plazo_pago: 60 }, { razon_social: 'OTRA PERSONA FISICA', plazo_pago: 15 }], destinos: [], clientes: [] }, actuales: {} });
  assert.deepEqual(h.transportistas.map((t) => [t.nombre, t.plazo_pago]), [['OTRA PERSONA FISICA', 15], ['TRANSPORTES RIOS INTERNACIONAL', 60], ['TRANSPORTES SOL', 30], ['TRANSPORTES TEX', 45]]);
  // Unir a mano y que al reimportar se empate solo
  const lista = [{ nombre: 'TRANSPORTES SOL' , telefono: '1' }, { nombre: 'PEDRO PERSONA', razon_social: 'PEDRO PERSONA', plazo_pago: 15 }];
  const unida = unirTransportista(lista, 'PEDRO PERSONA', 'TRANSPORTES SOL');
  assert.equal(unida.length, 1); assert.equal(unida[0].plazo_pago, 15);
  const re = combinarCatalogos({ seguimiento: null, fletes: { transportistas: [{ razon_social: 'PEDRO PERSONA', plazo_pago: 20 }], destinos: [], clientes: [] }, actuales: { transportistas: unida } });
  assert.equal(re.transportistas.length, 1); assert.equal(re.transportistas[0].plazo_pago, 20);
  assert.equal(r.clientes.find((c) => c.num === '9101').clasificacion, 'NACIONAL');
  assert.equal(r.clientes.find((c) => c.nombre === 'Showroom Polanco').clasificacion, 'SIN FLETE');
  assert.equal(tarifaPara(r.tarifas, ['Saltillo']).tarifa, 530);
  assert.equal(tarifaPara(r.tarifas, ['Saltillo', 'Monterrey.']).tarifa, 600); // varias paradas: la más cara; sin importar puntos
  assert.equal(clientePara(r.clientes, { cliente: 'Interceramic Norte', paradas: [] }).customer, 'ANA PRUEBA');
});
test('Restos: 21 cajas con 20 por tarima = 1 tarima + 1 resto', () => {
  const tit = ['Número orden', 'Destino envío', 'Producto', 'Cant enviada', 'UM', 'Kg.', 'Destino', 'Factor Tarimas', 'Tarimas', 'Restos tarima - liso', 'Restos tarima - deco', 'Lis/Dec', 'Cliente', 'Nom Sucursal'];
  const fila = (o) => tit.map((t) => (o[t] === undefined ? '' : o[t]));
  const base = [['FORMATO DE ACOPIO'], ['Folio:', 777], [], [], [], tit,
    fila({ 'Número orden': 1, 'Destino envío': 50, Producto: 'PISO PRUEBA 60*60 RECT 1.44 MT2/36 CJ', 'Cant enviada': 21, UM: 'CJ', 'Kg.': 630, Destino: 'LEON', 'Factor Tarimas': 20, Tarimas: 0, 'Restos tarima - liso': 0, 'Lis/Dec': 'Lis', Cliente: 'X', 'Nom Sucursal': 'X LEON' }),
    fila({ 'Número orden': 2, 'Destino envío': 50, Producto: 'DECORADO PRUEBA', 'Cant enviada': 7, UM: 'CJ', 'Kg.': 70, Destino: 'LEON', 'Factor Tarimas': 40, 'Lis/Dec': 'Dec', Cliente: 'X', 'Nom Sucursal': 'X LEON' }),
    fila({ 'Número orden': 3, 'Destino envío': 50, Producto: 'SIN FACTOR 80*80', 'Cant enviada': 5, UM: 'CJ', 'Kg.': 50, Destino: 'LEON', Tarimas: 1, 'Restos tarima - liso': 2, 'Lis/Dec': 'Lis', Cliente: 'X', 'Nom Sucursal': 'X LEON' })];
  const { grupos, avisos } = interpretar({ Base: base });
  const g = grupos[0];
  assert.deepEqual(g.material.map((m) => [m.tarimas, m.restos]), [[1, 1], [0, 7], [1, 2]]);
  assert.equal(g.tarimas, 2); assert.equal(g.resto, 10);
  assert.deepEqual([g.paradas[0].restos_liso, g.paradas[0].restos_deco], [3, 7]);
  assert.ok(avisos.some((a) => /se calcularon con las cajas por tarima/.test(a)));
});
test('Modificación de acopio: qué se sube, se baja, entra y sale', () => {
  const a = { peso_kg: 1000, tarimas: 2, resto: 1, destino: 'LEON', material: [{ destino: '1', sku: 'A', lote: 'x', producto: 'PISO A', cantidad: 40, um: 'CJ' }, { destino: '1', sku: 'B', lote: 'y', producto: 'PISO B', cantidad: 10, um: 'CJ' }] };
  const d = { peso_kg: 1300, tarimas: 3, resto: 1, destino: 'LEON', material: [{ destino: '1', sku: 'A', lote: 'x', producto: 'PISO A', cantidad: 60, um: 'CJ' }, { destino: '1', sku: 'C', lote: 'z', producto: 'PISO C', cantidad: 5, um: 'CJ' }] };
  const r = compararFolio(a, d);
  assert.equal(r.igual, false);
  assert.deepEqual(r.lineas.map((l) => [l.tipo, l.sku, l.antes, l.despues]), [['sube', 'A', 40, 60], ['nueva', 'C', 0, 5], ['quitada', 'B', 10, 0]]);
  assert.match(r.resumen, /\+300 kg/);
  assert.equal(compararFolio(a, a).igual, true);
});
test('Entrega a tiempo o tarde', () => {
  assert.equal(puntualidad({ estatus: 'ENTREGADO', cita: '2026-10-13T09:30', entregado: '2026-10-13T18:00:00' }), 'A tiempo');
  assert.equal(puntualidad({ estatus: 'ENTREGADO', cita: '2026-10-13T09:30', entregado: '2026-10-14T08:00:00' }), 'Tarde');
  assert.equal(puntualidad({ estatus: 'ENTREGADO', salida: '2026-10-10T08:00:00', entregado: '2026-10-12T10:00:00' }, 3), 'A tiempo');
  assert.equal(puntualidad({ estatus: 'ENTREGADO', entregado: '2026-10-12T10:00:00' }), null);
  assert.equal(puntualidad({ estatus: 'EN_RUTA', cita: '2026-10-13' }), null);
});
test('Correos de alertas: destinatarios por tipo', () => {
  const usuarios = [{ id: 'trafico@x.com', area: 'transporte' }, { id: 'baja@x.com', area: 'transporte', activo: false }, { id: 'opera@x.com', area: 'operacion' }];
  const config = { areas: { checklist: ['transporte', 'admin'] }, extra: { checklist: ['Jefe@x.com', 'no-es-correo'] } };
  assert.deepEqual(destinatarios(config, usuarios, 'checklist', 'jroman@cesantoni.com.mx'), ['trafico@x.com', 'jroman@cesantoni.com.mx', 'jefe@x.com']);
  assert.deepEqual(destinatarios(config, usuarios, 'parado', 'jroman@cesantoni.com.mx'), []);
});
