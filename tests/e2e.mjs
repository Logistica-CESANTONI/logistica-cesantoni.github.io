/* Recorrido completo en navegador contra el emulador de Firebase.
   1) firebase emulators:start --only auth,firestore   2) http-server -p 5500 .   3) node tests/e2e.mjs  */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:5500/', EMU = '?emu=1', P = 'proveedores-cesantoni';
const ACOPIO = process.env.ACOPIO || fileURLToPath(new URL('./acopio.xlsx', import.meta.url));
const ACOPIO_CES = process.env.ACOPIO_CES || fileURLToPath(new URL('./acopio-cesantoni.xlsm', import.meta.url));
const ACOPIO_CES2 = process.env.ACOPIO_CES2 || fileURLToPath(new URL('./acopio-cesantoni-2.xlsm', import.meta.url));
const CUADRO = process.env.CUADRO || fileURLToPath(new URL('./cuadro-envio.xlsm', import.meta.url));
const CUADRO2 = process.env.CUADRO2 || fileURLToPath(new URL('./cuadro-envio-2.xlsm', import.meta.url));
const SEGUIMIENTO = process.env.SEGUIMIENTO || fileURLToPath(new URL('./seguimiento-ejemplo.xlsx', import.meta.url));
const FLETES = process.env.FLETES || fileURLToPath(new URL('./fletes-ejemplo.xlsx', import.meta.url));
const ACOPIO_MOD1 = process.env.ACOPIO_MOD1 || fileURLToPath(new URL('./acopio-mod-1.xlsm', import.meta.url));
const ACOPIO_MOD2 = process.env.ACOPIO_MOD2 || fileURLToPath(new URL('./acopio-mod-2.xlsm', import.meta.url));
const SALIDA = process.env.CAPTURAS || '';
let ok = 0, mal = 0;
const check = (cond, nombre) => { if (cond) { ok++; console.log('  ✓ ' + nombre); } else { mal++; console.log('  ✗ ' + nombre); } };

await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${P}/databases/(default)/documents`, { method: 'DELETE' });
await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${P}/accounts`, { method: 'DELETE' });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errores = [];
page.on('pageerror', (e) => errores.push(e.message));
let respuestaPrompt = '';
page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(respuestaPrompt) : d.accept()));
const foto = async (n) => { if (SALIDA) await page.screenshot({ path: SALIDA + '/' + n + '.png', fullPage: true }); };
const toast = async () => (await page.locator('.toast').allTextContents()).join(' | ');
const esperarToast = async (texto) => { await page.locator('.toast', { hasText: texto }).first().waitFor({ timeout: 10000 }); };
/* Correo + contraseña personal. La primera vez se crea la cuenta y se verifica el correo con la liga que guarda el emulador. */
const CLAVE = 'Clave-Prueba-1';
async function crear(correo) {
  await page.goto(BASE + EMU);
  await page.getByRole('button', { name: 'Primera vez: crear mi contraseña' }).click();
  await page.locator('#correo').fill(correo);
  await page.locator('#clave').fill(CLAVE); await page.locator('#clave2').fill(CLAVE);
  await page.getByRole('button', { name: 'Crear mi contraseña' }).click();
  await page.getByRole('heading', { name: 'Confirma tu correo' }).waitFor();
  let c = null;
  for (let i = 0; i < 40 && !c; i++) { // el correo de confirmación se manda un instante después de crear la cuenta
    const r = await (await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${P}/oobCodes`)).json();
    c = (r.oobCodes || []).filter((x) => x.email === correo.toLowerCase() && x.requestType === 'VERIFY_EMAIL').pop();
    if (!c) await page.waitForTimeout(250);
  }
  await fetch(c.oobLink); // equivale a dar clic en la liga del correo
  await page.getByRole('button', { name: 'Ya lo confirmé' }).click();
}
async function entrar(correo) {
  await page.goto(BASE + EMU);
  await page.locator('#correo').fill(correo);
  await page.locator('#clave').fill(CLAVE);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.locator('#nav a').first().waitFor({ timeout: 20000 });
}
async function salir() { await page.getByRole('button', { name: 'Cerrar sesión' }).click(); await page.getByRole('button', { name: 'Entrar', exact: true }).waitFor(); }
async function ir(hash, titulo) { await page.goto(BASE + EMU + '#' + hash); await page.locator('main h1', { hasText: titulo }).waitFor(); await page.locator('main .tabla, main .unidades, main .alertas, main .tarjeta p.gris').first().waitFor(); }
const menu = async () => (await page.locator('#nav a b').allTextContents()).map((t) => t.replace(/\d+$/, '').trim());

console.log('Acceso por correo');
await crear('nadie@cesantoni.com.mx');
await page.getByText('no tiene un área asignada').waitFor();
check(true, 'correo sin área: no entra y lo explica');
await page.locator('#correo').fill('ventas@cesantoni.com.mx'); await page.locator('#clave').fill(CLAVE);
await page.getByRole('button', { name: 'Entrar', exact: true }).click();
await page.getByText('Correo o contraseña incorrectos').waitFor();
check(true, 'cuenta inexistente: pide crear contraseña');
await crear('JRoman@cesantoni.com.mx');
await page.locator('#nav a').first().waitFor({ timeout: 20000 });
check((await page.locator('.chip-area').textContent()) === 'Administrador', 'jroman@cesantoni.com.mx entra como Administrador');
check((await menu()).includes('Configuración'), 'Administrador ve Configuración');
await ir('config', 'Configuración');
for (const [c, n, a] of [['ventas@cesantoni.com.mx', 'Vendedor Uno', 'ventas'], ['opera@cesantoni.com.mx', 'Operador Uno', 'operacion'], ['Transporte@Cesantoni.com.mx', 'Trafico Uno', 'transporte']]) {
  await page.getByLabel('Correo nuevo').fill(c); await page.getByLabel('Nombre de la persona').fill(n); await page.getByLabel('Área', { exact: true }).selectOption(a);
  await page.getByRole('button', { name: 'Dar de alta' }).click();
  await page.locator('td', { hasText: c.toLowerCase() }).waitFor();
}
check(await page.locator('td', { hasText: 'transporte@cesantoni.com.mx' }).count() === 1, 'alta de usuarios con su área (correo en minúsculas)');
await page.locator('#correo-activo').check();
await page.getByLabel('Checklist reprobado · Transporte').check();
await page.getByLabel('Correos extra Folio parado').fill('jefe@cesantoni.com.mx, no-es-correo');
await page.getByRole('button', { name: 'Guardar correos' }).click();
await esperarToast('Correos de alertas guardados');
check(true, 'Configuración: destinatarios de los correos de alertas por tipo');
await salir();
for (const c of ['ventas@cesantoni.com.mx', 'opera@cesantoni.com.mx', 'transporte@cesantoni.com.mx']) { await crear(c); await page.locator('#nav a').first().waitFor({ timeout: 20000 }); await salir(); }
check(true, 'cada persona crea su contraseña y confirma su correo una sola vez');
await entrar('jroman@cesantoni.com.mx');

console.log('Transporte: catálogo de unidades');
await ir('catalogos', 'Catálogos');
// Catálogos de Nacional desde Excel (Seguimiento + Fletes, datos inventados)
await page.locator('#imp-seguimiento').setInputFiles(SEGUIMIENTO);
await page.locator('#imp-fletes').setInputFiles(FLETES);
await page.getByRole('button', { name: 'Leer archivos' }).click();
await page.getByText('Listo para guardar').waitFor();
await page.getByRole('button', { name: 'Guardar catálogos' }).click();
await esperarToast('Catálogos guardados');
await page.locator('summary', { hasText: 'Tarifas por destino (4)' }).waitFor();
check(true, 'importa transportistas, clientes y tarifas desde los Excel');
check(await page.locator('td', { hasText: 'En Fletes: MARIA PERSONA FISICA' }).count() === 1, 'razón social de Fletes empatada por correo');
// Transportista externo con su cuenta espejo
await page.locator('tr', { hasText: 'FLETES DEL BAJIO S.A. DE C.V.' }).getByRole('button', { name: 'Editar' }).click();
await page.getByLabel('Plataforma GPS').fill('Wialon');
await page.getByLabel('Liga de la cuenta espejo').fill('https://espejo.ejemplo.com/fletes');
await page.getByLabel('Usuario').fill('cesantoni'); await page.getByLabel('Contraseña').fill('espejo-123');
await page.getByRole('button', { name: 'Guardar' }).click();
await page.locator('td', { hasText: 'Wialon' }).waitFor();
check(true, 'transportista externo con cuenta espejo');
async function nuevaUnidad(servicio, transportista, nombre, cap, placas) {
  await page.getByRole('button', { name: '+ Nueva unidad' }).click();
  await page.getByLabel('Servicio').selectOption(servicio);
  await page.locator('.modal').getByLabel('Transportista').fill(transportista);
  await page.getByLabel('Unidad', { exact: true }).fill(nombre);
  await page.getByLabel('Capacidad (kg)').fill(String(cap));
  await page.getByLabel('Placas').fill(placas);
  await page.getByRole('button', { name: 'Guardar' }).click();
  await page.locator('td', { hasText: nombre }).waitFor();
}
await nuevaUnidad('NACIONAL', 'Fletes del Bajío', 'ECO-14', 30000, 'jal1234');
await nuevaUnidad('UM_PROPIA', 'CESANTONI', 'REPARTO-01', 3500, 'zac0001');
await nuevaUnidad('UM_CONTRATADA', 'Renta Express', 'RENTA-01', 3500, 'zac0002');
check(await page.locator('td', { hasText: 'JAL1234' }).count() === 1, 'unidad guardada con placas en mayúsculas');
check(await page.locator('h3', { hasText: 'Última Milla · reparto (Samsara) (2)' }).count() === 1 && await page.locator('h3', { hasText: 'Nacional · transportistas externos (1)' }).count() === 1, 'unidades separadas: Última Milla (propia y contratada) y Nacional');
await salir();

console.log('Ventas');
await entrar('ventas@cesantoni.com.mx');
check(JSON.stringify(await menu()) === JSON.stringify(['Ventas', 'Alertas', 'Pantalla ↗']), 'Ventas solo ve Ventas + Alertas (+ liga a Pantalla)');
await page.goto(BASE + EMU + '#transporte');
await page.waitForTimeout(800);
check(new URL(page.url()).hash === '#ventas', 'Ventas no puede abrir Transporte escribiendo la liga');
await page.locator('#acopio').setInputFiles(ACOPIO);
await page.getByRole('button', { name: /Crear 4 folio/ }).waitFor();
const filas = await page.locator('.tabla.compacta tbody tr').count();
check(filas === 4, 'el acopio se separó en 4 clientes/destinos');
const valores = await page.locator('.tabla.compacta tbody input[aria-label="folio"]').evaluateAll((els) => els.map((e) => e.value));
check(valores.includes('12345/12346') && valores.includes('30010/30011'), 'folios combinados con «/» y sin letra');
check(await page.locator('.tabla.compacta .tipo.full').count() === 1, 'Interceramic (43.5 t) marcado FULL');
await foto('01-ventas-revision');
await page.getByRole('button', { name: /Crear 4 folio/ }).click();
await esperarToast('4 folio(s) creados');
await page.locator('.tabla tbody tr', { hasText: '22001' }).first().waitFor();
check(await page.locator('.tabla tbody tr', { hasText: '22001' }).count() === 1, 'folios creados y listados');
const prohibido = await page.evaluate(async () => {
  const fb = await import('./js/firebase-sdk.js?v=' + document.querySelector('script[src*="app.js"]').src.split('?v=')[1]); const app = fb.getApps().find((a) => a.name === 'logistica');
  try { await fb.getDocs(fb.collection(fb.getFirestore(app), 'lc_despachos')); return 'leyó'; } catch (e) { return e.code; }
});
check(prohibido === 'permission-denied', 'Ventas pidiendo despachos (tarifas) directo al servidor: denegado');
// Subir el mismo archivo otra vez no duplica
await page.locator('#acopio').setInputFiles(ACOPIO);
await page.locator('.modificacion.igual').first().waitFor();
check(await page.locator('.modificacion.igual').count() === 4, 'volver a subir el mismo acopio: lo reconoce como folio existente sin cambios');
await page.getByRole('button', { name: /Modificar 4/ }).click();
await esperarToast('el acopio no cambió');
check(true, 'volver a subir el acopio no duplica folios');
// Formato de Acopio CESANTONI: dos archivos a la vez y juntarlos en un embarque
await page.locator('#acopio').setInputFiles([ACOPIO_CES, ACOPIO_CES2]);
await page.getByRole('button', { name: /Crear 2 folio/ }).waitFor();
const folios2 = await page.locator('.tabla.compacta tbody input[aria-label="folio"]').evaluateAll((els) => els.map((e) => e.value));
check(JSON.stringify(folios2) === JSON.stringify(['7777A', '8888']), 'formato CESANTONI: un folio por archivo (7777A y 8888)');
check(await page.locator('.paradas-t', { hasText: 'PRUEBA Suc. QRO' }).count() === 2, 'muestra el detalle por destino de envío');
await page.getByRole('button', { name: 'Juntar marcados en un embarque' }).click();
await page.getByRole('button', { name: /Crear 1 folio/ }).waitFor();
check((await page.locator('.tabla.compacta tbody input[aria-label="folio"]').inputValue()) === '7777/8888', 'juntados: folio 7777/8888 sin letra');
check(await page.locator('.tabla.compacta .tipo.full').count() === 1, 'embarque de 83 t marcado FULL');
await page.getByRole('button', { name: /Crear 1 folio/ }).click();
await esperarToast('1 folio(s) creados');
await page.locator('.tabla tbody tr', { hasText: '7777/8888' }).first().click();
await page.locator('.modal .paradas-t').waitFor();
check(await page.locator('.modal .paradas-t tbody tr').count() === 2, 'la ficha del folio muestra sus 2 destinos de envío');
check(await page.locator('.modal .material tbody tr').count() === 6, 'la ficha desglosa el material (6 partidas)');
await page.locator('.modal .historial li', { hasText: 'ventas@cesantoni.com.mx' }).first().waitFor();
check(true, 'el historial registra quién (correo), no solo el área');
await page.locator('.modal .btn-x').click();
// Modificación de acopio: el mismo folio con otra cantidad (7777A todavía no existe solo; se crea y luego se modifica)
await page.locator('#acopio').setInputFiles(ACOPIO_MOD1);
await page.getByRole('button', { name: /Crear 1 folio/ }).click();
await page.locator('.tabla tbody tr', { hasText: '6666' }).first().waitFor(); // lista ya recargada
await page.locator('#acopio').setInputFiles(ACOPIO_MOD2);
await page.locator('.modificacion.aplica').waitFor();
check(await page.locator('.modificacion .cambios li.sube', { hasText: '10 → 15' }).count() === 1, 'modificación: muestra «Se sube 10 → 15»');
await page.getByRole('button', { name: /Modificar 1/ }).click();
await esperarToast('modificado (versión 2)');
check(true, 'modificación aplicada (versión 2) sin duplicar el folio');
// Cuadros de Envío (Última Milla)
await page.locator('#acopio').setInputFiles([CUADRO, CUADRO2]);
await page.getByRole('button', { name: /Crear 2 folio/ }).waitFor();
check(await page.locator('.tabla.compacta .envio.um').count() === 2, 'Cuadro de Envío reconocido como Última Milla');
check(await page.locator('.tabla.compacta .entrega', { hasText: 'AV. DE PRUEBA No. 10' }).count() === 2, 'muestra dirección, teléfonos y descarga');
await page.getByRole('button', { name: /Crear 2 folio/ }).click();
await esperarToast('2 folio(s) creados');
await page.getByRole('button', { name: /Última Milla \(2\)/ }).click();
check(await page.locator('.tabla tbody tr.clic').count() === 2, 'filtro Última Milla en la lista de folios');
await page.getByRole('button', { name: /^Todos/ }).click();
await salir();

console.log('Operación');
await entrar('opera@cesantoni.com.mx');
check(JSON.stringify(await menu()) === JSON.stringify(['Operación', 'Alertas', 'Pantalla ↗']), 'Operación solo ve Operación + Alertas');
const fila = (f) => page.locator('.tabla tbody tr', { hasText: f });
const opcionListo = fila('22001').locator('select option[value="LISTO"]');
check(await opcionListo.isDisabled(), 'sin documentos, «Listo para transporte» está deshabilitado');
const forzado = await page.evaluate(async () => {
  const fb = await import('./js/firebase-sdk.js?v=' + document.querySelector('script[src*="app.js"]').src.split('?v=')[1]); const db = fb.getFirestore(fb.getApps().find((a) => a.name === 'logistica'));
  try { await fb.updateDoc(fb.doc(db, 'lc_folios', '22001'), { estatus: 'LISTO' }); return 'pasó'; } catch (e) { return e.code; }
});
check(forzado === 'permission-denied', 'forzar LISTO sin documentos directo al servidor: rechazado');
for (const d of ['Factura', 'Carta Porte']) { await fila('22001').getByLabel(d).check(); await page.waitForTimeout(700); }
check(await fila('22001').locator('select option[value="LISTO"]').isDisabled(), 'con 2/3 documentos sigue bloqueado');
await fila('22001').getByLabel('Remisión').check(); await page.waitForTimeout(700);
await fila('22001').locator('select').selectOption('LISTO');
await esperarToast('22001: Listo para transporte');
check(true, 'con 3/3 pasa a Listo para transporte');
await fila('40001').locator('select').selectOption('PARADO');
await fila('40001').getByRole('button', { name: 'Guardar' }).click();
check((await toast()).includes('motivo'), 'PARADO sin motivo: pide motivo');
await fila('40001').getByLabel('Motivo').fill('Falta exhibidor');
await fila('40001').getByRole('button', { name: 'Guardar' }).click();
await esperarToast('40001: Parado');
check(true, 'PARADO con motivo guardado');
// Incidencia registrada por Operación desde la ficha
await fila('30010/30011').locator('td').first().click();
await page.getByRole('button', { name: '+ Registrar incidencia' }).click();
await page.locator('#inc-categoria').selectOption('Material');
await page.locator('#inc-motivo').selectOption('Inexistencia');
await page.locator('#inc-detalle').fill('Faltan 3 cajas');
await page.getByRole('button', { name: 'Registrar', exact: true }).click();
await esperarToast('Incidencia registrada en 30010/30011');
check(true, 'Operación registra una incidencia en un folio');
check(await page.getByRole('button', { name: 'Reprogramar' }).count() === 0, 'Operación no puede reprogramar');
await page.locator('.tabla tbody tr').first().waitFor();
for (const d of ['Factura', 'Carta Porte', 'Remisión']) { await fila('12345/12346').getByLabel(d).check(); await page.waitForTimeout(600); }
await fila('12345/12346').locator('select').selectOption('LISTO');
await esperarToast('Listo para transporte');
await foto('02-operacion');
await salir();

console.log('Transporte');
await entrar('transporte@cesantoni.com.mx');
check((await menu()).length === 10, 'Transporte ve todo (igual que Administrador)');
await ir('transporte', 'Transporte');
await page.locator('.tabla tbody tr', { hasText: '22001' }).click();
await page.getByLabel('Unidad', { exact: true }).selectOption({ label: 'Fletes del Bajío · ECO-14 · SENCILLO · 30 t' });
check(await page.locator('.modal .aviso', { hasText: 'Excede' }).isVisible(), 'aviso: el peso excede la capacidad de la unidad');
check((await page.getByLabel('Placas').inputValue()) === 'JAL1234', 'placas tomadas del catálogo');
await page.getByLabel('Operador').fill('Juan Pérez');
await page.getByLabel('Fecha y hora de cita').fill('2026-10-13T09:30');
await page.getByLabel('Andén').fill('4');
await page.getByLabel('Tarifa negociada (MXN)').fill('18500');
check(await page.locator('.modal h3', { hasText: 'Checklist pre-salida' }).count() === 0, 'Nacional: el despacho no lleva checklist');
check(await page.locator('.modal .sugerencia', { hasText: 'Tarifa SALTILLO: $530.00 por tonelada' }).count() === 1, 'sugiere la tarifa por tonelada del destino');
await page.getByRole('button', { name: 'Usar $23,055.00' }).click();
check((await page.getByLabel('Tarifa negociada (MXN)').inputValue()) === '23055', 'tarifa = 43.5 t × $530');
check(await page.locator('.modal .cliente-cat', { hasText: 'ANA PRUEBA' }).count() === 1 && await page.locator('.modal .cliente-cat', { hasText: 'pide CITA' }).count() === 1, 'muestra customer service y aviso de cita del cliente');
await page.getByLabel('Tarifa negociada (MXN)').fill('18500'); // tarifa negociada distinta a la de catálogo
check(await page.locator('.modal .espejo a', { hasText: 'Cuenta espejo · Wialon' }).count() === 1, 'Nacional: el despacho muestra la cuenta espejo del transportista');
check(await page.locator('.modal select option', { hasText: 'REPARTO-01' }).count() === 0, 'Nacional: solo lista unidades de transportistas externos');
await foto('03-despacho');
await page.getByRole('button', { name: 'Guardar asignación' }).click();
await esperarToast('Asignación guardada');
const celdaTarifa = page.locator('.tabla tbody tr', { hasText: '22001' }).locator('td', { hasText: '$18,500.00' });
await celdaTarifa.waitFor({ timeout: 10000 }).catch(() => {});
check(await celdaTarifa.count() === 1, 'tarifa visible para Transporte');
await page.locator('.tabla tbody tr', { hasText: '22001' }).click();
await page.getByRole('button', { name: 'Reprogramar (con motivo)' }).click();
await page.locator('#rep-motivo').selectOption('Demora de la transportadora');
await page.locator('#rep-cita').fill('2026-10-14T10:00');
await page.getByRole('button', { name: 'Reprogramar', exact: true }).click();
await esperarToast('22001 reprogramado');
await page.locator('.tabla tbody tr', { hasText: '22001' }).locator('td', { hasText: '14 oct 10:00' }).waitFor();
check(true, 'Transporte reprograma con motivo y nueva cita');
await page.locator('.tabla tbody tr', { hasText: '22001' }).click();
await page.getByRole('button', { name: 'Salir a ruta (activar GPS)' }).click();
await esperarToast('en ruta');
check(true, 'Nacional sale a ruta sin checklist');
// Última Milla: tarifa opcional y checklist pre-salida
await page.getByRole('tab', { name: /^Última Milla/ }).click();
await page.getByRole('tab', { name: /^Todos/ }).click();
check(await page.locator('.tabla tbody tr', { hasText: '22001' }).count() === 0 && await page.locator('.tabla tbody tr', { hasText: '9001' }).count() === 1, 'Transporte separa Nacional y Última Milla');
await page.locator('.tabla tbody tr', { hasText: '9001' }).click();
check(await page.locator('.modal select option', { hasText: 'ECO-14' }).count() === 0, 'Última Milla: solo lista unidades de reparto');
await page.getByLabel('Unidad', { exact: true }).selectOption({ label: 'Renta Express · RENTA-01 · SENCILLO · 3.5 t' });
check(!(await page.getByLabel('No aplica tarifa').isChecked()), 'unidad contratada: sí lleva tarifa');
await page.getByLabel('Unidad', { exact: true }).selectOption({ label: 'CESANTONI · REPARTO-01 · SENCILLO · 3.5 t' });
check(await page.getByLabel('No aplica tarifa').isChecked(), 'unidad propia: «No aplica tarifa» automático');
await page.getByRole('button', { name: 'Guardar asignación' }).click();
await esperarToast('Asignación guardada');
await page.locator('.tabla tbody tr', { hasText: '9001' }).locator('td', { hasText: 'No aplica' }).waitFor();
check(true, 'Última Milla: «No aplica tarifa»');
await page.locator('.tabla tbody tr', { hasText: '9001' }).click();
for (const p of ['Llantas', 'Luces', 'Frenos', 'Espejos', 'Cinturones', 'Extintor', 'Documentos del vehículo', 'Combustible']) {
  await page.getByRole('radiogroup', { name: p }).getByText(p === 'Frenos' ? 'Falla' : 'Bien').click();
}
await page.getByRole('button', { name: 'Guardar checklist' }).click();
await esperarToast('Checklist reprobado');
check(true, 'checklist reprobado registra alerta');

console.log('Monitoreo, Última Milla, Alertas');
await ir('ruta', 'Última Milla');
check(await page.locator('.tabla tbody tr', { hasText: '30010/30011' }).count() === 0, 'Última Milla solo lista folios de Cuadro de Envío (no Nacionales)');
await page.locator('.tabla tbody tr', { hasText: '9001' }).getByRole('checkbox').check();
await page.locator('.tabla tbody tr', { hasText: '9002' }).getByRole('checkbox').check();
check(await page.locator('.tabla tbody tr', { hasText: '9002' }).getByText('✓ 22.74720').count() === 1, 'la liga larga del Cuadro de Envío ya trae la ubicación');
check(await page.locator('.tabla tbody tr', { hasText: '9001' }).getByRole('link', { name: 'Abrir liga ↗' }).count() === 1, 'liga corta: botón para abrirla');
await page.getByRole('button', { name: 'Calcular ruta más corta' }).click();
check((await toast()).includes('Falta la ubicación de: 9001'), 'pide la ubicación del folio con liga corta');
await page.getByLabel('Ubicación de 9001').fill('https://maps.app.goo.gl/EjemploCorto123'); await page.getByLabel('Ubicación de 9001').press('Tab');
await esperarToast('liga corta');
check(true, 'liga corta: explica cómo sacar la liga larga');
await page.getByLabel('Ubicación de 9001').fill('https://www.google.com/maps/place/Leon/@21.1250,-101.6860,14z/data=!3d21.1250!4d-101.6860'); await page.getByLabel('Ubicación de 9001').press('Tab');
await esperarToast('Ubicación guardada para 9001');
await page.getByRole('button', { name: 'Calcular ruta más corta' }).click();
await page.locator('.paradas').waitFor();
const orden = await page.locator('.paradas li').allTextContents();
check(orden.length === 2 && orden[0].includes('9001') && orden[1].includes('9002'), 'orden de paradas: León (9001) y luego Guadalupe (9002)');
check(await page.getByText('Aproximación (línea recta)').count() > 0, 'marcado como aproximación');
await page.getByRole('button', { name: 'Guardar ruta' }).click();
await esperarToast('Ruta guardada');
await foto('04-ultima-milla');
await ir('catalogos', 'Catálogos');
const ubLeon = page.getByLabel('Ubicación de PRUEBA Suc. LEON · LEON');
await ubLeon.fill('https://www.google.com/maps/place/Bodega/@21.1100,-101.6500,15z'); await ubLeon.press('Tab');
await esperarToast('Ubicación guardada para PRUEBA Suc. LEON · LEON');
check(true, 'destino Nacional: ubicación con liga de Google Maps en Catálogos');
check(await page.locator('td', { hasText: '30*60 RECT PRC' }).count() >= 1, 'Catálogos muestra Pesos y Embalajes');
await ir('monitoreo', 'Monitoreo');
await page.locator('.unidad').first().waitFor();
check(await page.locator('.unidad .fuente.sim', { hasText: 'ESTIMADO' }).count() === 1, 'Nacional en ruta: posición ESTIMADO (la real en la cuenta espejo)');
check(await page.locator('.unidad .espejo a', { hasText: 'Cuenta espejo' }).count() === 1, 'Monitoreo: botón a la cuenta espejo del transportista');
await foto('05-monitoreo');
await ir('alertas', 'Alertas');
await page.locator('.alertas li').first().waitFor();
const textos = (await page.locator('.alertas li').allTextContents()).join(' ');
check(!/SIN checklist/.test(textos) && /sobrepeso/.test(textos) && /reprobado en 9001/.test(textos) && /PARADO/.test(textos), 'alertas: sobrepeso, checklist reprobado (Última Milla) y parado; Nacional no genera alerta de checklist');
await foto('06-alertas');
const pass = await page.evaluate(async () => {
  const fb = await import('./js/firebase-sdk.js?v=' + document.querySelector('script[src*="app.js"]').src.split('?v=')[1]); const db = fb.getFirestore(fb.getApps().find((a) => a.name === 'logistica'));
  return (await fb.getDoc(fb.doc(db, 'lc_despachos', '22001'))).data().tarifa;
});
check(pass === 18500, 'tarifa guardada en el despacho (privado)');
await salir();

console.log('Pantalla (sin contraseña)');
const ctx2 = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const pan = await ctx2.newPage();
await pan.goto(BASE + 'pantalla.html' + EMU);
await pan.locator('#filas tr td.folio').first().waitFor();
const tab = await pan.locator('#filas').textContent();
check(tab.includes('22001') && tab.includes('EN RUTA') && tab.includes('PARADO'), 'tablero con folios y estatus');
check(!/18,?500|Juan Pérez|JAL1234/.test(await pan.content()), 'la Pantalla no muestra tarifa, operador ni placas');
check(!/CLIENTE DE PRUEBA|PERSONA DE PRUEBA|AV\. DE PRUEBA|000 000 0000/.test(await pan.content()) && tab.includes('ÚLT. MILLA'), 'Última Milla en Pantalla sin nombre, dirección ni teléfono del cliente');
check(await pan.locator('#filas tr.c-rojo').count() === 1, 'el folio parado sale en rojo');
if (SALIDA) await pan.screenshot({ path: SALIDA + '/07-pantalla.png' });

console.log('Entrega a tiempo e Incidencias');
await page.bringToFront();
await entrar('transporte@cesantoni.com.mx');
await ir('transporte', 'Transporte');
await page.getByRole('tab', { name: /^Nacional/ }).click();
// Entregar 22001 (cita 14 oct, entregado hoy → a tiempo) y revisar la vista de Incidencias
await page.getByRole('tab', { name: /^En ruta/ }).click();
await page.locator('.tabla tbody tr', { hasText: '22001' }).click();
await page.getByRole('button', { name: 'Marcar entregado' }).click();
await esperarToast('22001 entregado');
await ir('incidencias', 'Incidencias');
await page.locator('main select[aria-label="Mes"]').selectOption('todos');
const txtInc = await page.locator('main').innerText();
check(/Demora de la transportadora/.test(txtInc) && /Inexistencia/.test(txtInc), 'Incidencias: lista reprogramaciones e incidencias con su motivo');
check(/100%/.test(txtInc), 'Incidencias: % de entregas a tiempo');

await salir();

console.log('Borrar folio (Administrador)');
await entrar('ventas@cesantoni.com.mx');
await page.locator('.tabla tbody tr', { hasText: '30010/30011' }).first().click();
check(await page.getByRole('button', { name: 'Borrar folio' }).count() === 0, 'Ventas no ve el botón de borrar');
await page.locator('.modal .btn-x').click();
await salir();
await entrar('jroman@cesantoni.com.mx');
await ir('ventas', 'Ventas');
await page.locator('.tabla tbody tr', { hasText: '30010/30011' }).first().click();
respuestaPrompt = '999';
await page.getByRole('button', { name: 'Borrar folio' }).click();
await esperarToast('no coincide');
check(true, 'si el número no coincide, no borra');
respuestaPrompt = '30010/30011';
await page.getByRole('button', { name: 'Borrar folio' }).click();
await esperarToast('Folio 30010/30011 borrado');
await page.waitForTimeout(800);
check(await page.locator('.tabla tbody tr', { hasText: '30010/30011' }).count() === 0, 'Administrador borra el folio');
await pan.reload(); await pan.locator('#filas tr td.folio').first().waitFor();
check(!(await pan.locator('#filas').textContent()).includes('30010/30011'), 'el folio borrado desaparece de la Pantalla');
check(errores.length === 0, 'sin errores de JavaScript' + (errores.length ? ': ' + errores.join(' / ') : ''));
await browser.close();
console.log(`\n${ok} de ${ok + mal} correctas`);
process.exit(mal ? 1 : 0);
