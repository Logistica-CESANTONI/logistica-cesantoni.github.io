# Control de Embarques · Somos Logística CESANTONI

| Liga | Para quién |
|---|---|
| https://logistica-cesantoni.github.io/ | Ventas, Operación, Transporte y Administrador (cada área con su contraseña) |
| https://logistica-cesantoni.github.io/pantalla.html | Pantalla del almacén: tablero público, sin contraseña y sin datos comerciales |

Controla el embarque desde que Ventas sube el pedido hasta que Transporte lo entrega. Es un sitio estático (HTML y JavaScript, sin
frameworks) publicado en GitHub Pages. Usa el proyecto de Firebase `proveedores-cesantoni` con **colecciones propias (`lc_`)**, separadas
de Proveedores (`pv_`) y de Movimientos (`sm_`). Nada se mezcla con esos sistemas.

## Puesta en marcha

1. **Reglas:** Firebase › Firestore Database › Reglas › pega **todo** `firestore.rules` del repositorio `proveedores-cesantoni.github.io`
   (rama `claude/anden-mini-erp-transport-p2601k`, bloque «Logística CESANTONI», colecciones `lc_`) › Publicar.
2. **Acceso:** Firebase › Authentication › Sign-in method › **Correo electrónico/contraseña** activado.
3. **Dominio:** Authentication › Settings › Authorized domains › `logistica-cesantoni.github.io`.
4. Entra con `jroman@cesantoni.com.mx` (siempre es Administrador; la primera vez «Crear mi contraseña») y en
   **Configuración › Usuarios** da de alta a cada persona con su correo y su área.

## Accesos

Cada persona entra con **su correo y su propia contraseña**. La primera vez usa «Crear mi contraseña» y confirma su correo con la liga
que le llega (remitente `noreply@proveedores-cesantoni.firebaseapp.com`); después ya no se mandan correos, así que no choca con el límite
diario del plan gratuito de Firebase. «Olvidé mi contraseña» manda una liga para cambiarla. Su área está en `lc_usuarios/{correo}`:

| Área | Ve |
|---|---|
| Ventas | Ventas + Alertas |
| Operación | Operación + Alertas |
| Transporte | Todo, igual que Administrador (salvo Usuarios) |
| Administrador | Todo, incluidos los Usuarios |

Las reglas de Firestore revisan en cada lectura y escritura que el correo esté verificado, dado de alta y activo, y su área. Dar de
baja a alguien le quita el acceso al momento. El historial y las alertas guardan el correo de quien hizo cada cambio. La sesión vence
a las 12 horas de entrar.

## Nacional y Última Milla

| | Nacional | Última Milla |
|---|---|---|
| Archivo | Formato de Acopio (macro) | Cuadro de Envío |
| Va a | Bodegas, sucursales y obras | Domicilio del cliente |
| Se guarda | Destinos de envío y **material partida por partida** (producto, SKU, lote, OC, cantidad, tarimas, restos, kg, m²) | Dirección, quién recibe, teléfonos, liga de Google Maps, descarga, observaciones, peso y metros |
| Ubicación | Catálogos › Destinos Nacionales (liga de Maps o lat, lng) | Del Cuadro de Envío; si la liga es corta, se abre y se pega la liga larga |
| Ruta | — | Última Milla (orden de entregas) |
| Flota | Unidades de **transportistas externos** | Unidades de **reparto propias** (y alguna contratada) |
| GPS | **Cuenta espejo** del transportista (Catálogos › Transportistas: plataforma, liga, usuario y contraseña) y, si la mandan, liga de rastreo del viaje; en Monitoreo la posición es ESTIMADA | **Samsara** (o simulado si falla) |
| Despacho (Transporte) | **Tarifa** negociada; **sin checklist** pre-salida | **Checklist** pre-salida de 8 puntos; unidad propia sin tarifa (automático), contratada con tarifa |

Cada partida del acopio se revisa contra **Pesos, Embalajes y Estibas (AN-GCT-13 Rev. 16)** y el embalaje de adhesivos
(`js/embalajes-datos.js`): formato, cajas por tarima, tarima, altura, estiba y rango de kilos esperado; marca las partidas fuera de rango.
Para una revisión nueva del documento se reemplazan las listas de ese archivo.

La Pantalla lee `lc_pantalla`, una copia pública de cada folio sin material, direcciones, teléfonos, tarifas ni nombres de clientes
de Última Milla. `lc_folios` ya solo lo leen las áreas con sesión.

## Catálogos de Nacional (importados)

En **Catálogos › Importar catálogos de Nacional** se suben los Excel de Logística:

- **Seguimiento Integral Logística** (hoja *Catalogos*): transportistas (razón social, teléfono, correos), clientes (customer service,
  cita, zona, gerentes, tipo de flete, días de crédito) y destinos (días de tránsito y tarifa por tonelada).
- **Fletes** (hoja *CATALOGOS*): tarifa y tarifa LP por destino, clasificación del cliente (Nacional, Exportación, Sin flete) y plazo
  de pago, correo e IVA del transportista.

Se guardan en Firebase (`lc_config/transportistas`, `tarifas`, `clientes`), no en este repositorio público. Las cuentas espejo
capturadas a mano se conservan al volver a importar. En el despacho Nacional se sugiere la tarifa: **tarifa por tonelada del destino ×
toneladas del folio** (con varias paradas, la del destino más caro). La tarifa que se usa es la «TARIFA LP» de Fletes; las razones sociales de Fletes se empatan por nombre, por correo o a mano («Unir con…») y se muestran los datos del cliente (aviso si pide cita o es Sin flete).

## Flujo de un folio

1. **Ventas** sube uno o varios Formatos de Acopio (macro de CESANTONI). Cada archivo es un folio (celda «Folio:» de Base) con su clasificación y sus destinos de envío (sucursal, ciudad, tarimas, restos en cajas, kilos); CB360 y Exhibición suman su peso. Folios que van en la misma unidad se juntan con «Juntar marcados». Otros formatos: las columnas se reconocen por su
   título (Pedido/Folio, Cliente, Destino/Ciudad, Tarimas, o Cajas y Cajas por tarima, Peso en kg o toneladas). Se separa por cliente y
   destino, se calculan tarimas, resto de tarima y peso, y se muestra todo para revisarlo antes de crear los folios como **Recibido**.
   Reglas fijas: folios combinados con «/» (nunca «Y») y sin letra pegada; SENCILLO hasta 40 t, FULL arriba de 40 t.
2. **Operación** cambia el estatus (Recibido → En preparación → Armado → Listo para transporte, o Parado/Incompleto; Parado exige
   motivo) y marca Factura, Carta Porte y Remisión. Sin los tres documentos, el servidor no deja pasar a Listo para transporte.
3. **Transporte** asigna unidad del catálogo (avisa si el peso excede la capacidad), operador, placas, cita, andén y tarifa; contesta el
   checklist pre-salida de 8 puntos y manda a ruta. Salir sin checklist o con checklist reprobado genera alerta.
4. **Monitoreo:** ubicación de las unidades en ruta, marcada **GPS REAL** o **SIMULADO**. Si Samsara falla por cualquier motivo, se
   simula el avance en línea recta del origen al destino; la pantalla nunca queda vacía.
5. **Última Milla:** orden de paradas para varios folios en un viaje (vecino más cercano + 2-opt, distancia en línea recta). Las
   coordenadas de cada destino se capturan una vez y se reutilizan. Es una aproximación; no usa Samsara ni se manda a otro sistema.
6. **Alertas:** checklist reprobado, salida sin checklist, sobrepeso y folio parado. El correo está **simulado**: se registra, no se envía.

## Modificaciones de acopio

Si Ventas vuelve a subir el acopio de un folio que ya existe (los «RE: … modificación»), el sistema lo compara con lo guardado y muestra
qué partidas **se suben, se bajan, entran o salen** y la diferencia de kilos, tarimas y restos. Si el folio está Recibido, En preparación,
Parado o Incompleto, se actualiza (versión 2, 3…) y queda en el historial; si ya tenía documentos, avisa a Operación para revisarlos.
Si ya está Armado o más adelante, **no se cambia**: se registra una alerta.

## Reprogramaciones e incidencias

- **Incidencia** (cualquier área, desde la ficha del folio): tipo y motivo según el catálogo del Seguimiento (facturación, material,
  documentos, embarque, transporte…) y comentario.
- **Reprogramar** (Transporte y Administrador, desde la ficha o el despacho): motivo y nueva cita; queda la cita anterior y la nueva.
- **Incidencias** (menú): por mes y tipo de envío, conteo por motivo y por transportista, y % de **entregas a tiempo** (entrega contra la
  cita, o contra salida + días de tránsito del catálogo si no hubo cita).

## GPS de Samsara

El token de Samsara no puede ir en esta página (es pública). `docs/samsara-puente/` trae una Cloud Function que guarda el token como
secreto, revisa que quien pregunta sea Transporte o Administrador y responde la ubicación. Necesita el plan Blaze de Firebase. Ya
publicada, se pega su URL en Configuración › GPS de Samsara y se pone el id de vehículo de Samsara en cada unidad del catálogo.
Mientras tanto, todo el Monitoreo funciona con datos simulados.

## Colecciones

`lc_folios` (+ `historial`), `lc_pantalla`, `lc_despachos`, `lc_unidades`, `lc_destinos`, `lc_rutas`, `lc_alertas`, `lc_incidencias`, `lc_usuarios` (correo → área),
`lc_config` (`general` = origen, `gps` = puente, `transportistas` = transportistas externos y su cuenta espejo).

## Pruebas

- `node --test tests/reglas.test.mjs`: reglas de negocio, lectura del Formato de Acopio (`python3 tests/acopio_ejemplo.py tests/acopio.xlsx`),
  ruta y GPS simulado.
- `tests/reglas-firestore.test.mjs`: reglas de Firestore en el emulador (usuarios por correo, permisos por área, tarifa, documentos, 12 horas).
- `tests/e2e.mjs`: recorrido completo en navegador (Playwright) contra el emulador, entrando con la liga al correo que guarda el emulador.

## Pendiente

- Instalar el envío de correos de alertas por **Outlook** (requisito: **10,000 correos por día**). El código está en
  `docs/correo-outlook/` (función `correoAlertas`, Microsoft Graph desde un buzón dedicado, tope diario de 10,000 destinatarios).
  Falta: plan Blaze de Firebase y que Sistemas registre la aplicación en Microsoft Entra (pasos en `docs/correo-outlook/LEEME.md`).
  Los destinatarios por tipo de alerta se eligen en Configuración › Correos de alertas.
- Puente de Samsara publicado (hoy el Monitoreo es simulado).
- Registro automático de folios desde el correo de Outlook (por definir: qué correos, modificaciones y desde qué fecha).
