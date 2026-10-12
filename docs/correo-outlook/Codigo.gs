/* Correos de alertas de Control de Embarques desde el Outlook de CESANTONI (Microsoft Graph).
   Apps Script publicado como aplicación web. La página le manda cada alerta con el token de sesión de quien la generó;
   el script revisa que sea un usuario verificado, lee a quién va (lc_config/correos, campo «para») y la manda desde REMITENTE.
   Tope: 10,000 destinatarios al día (límite de Exchange por buzón); se cuenta aquí mismo.

   Propiedades del script (Configuración del proyecto › Propiedades del script):
     MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET  → de la aplicación registrada en Microsoft Entra (Mail.Send de aplicación)
     REMITENTE                                     → jroman@cesantoni.com.mx
     FIREBASE_API_KEY                              → AIzaSyAb2NEHLxzpW_MmuUavbYnALxjueL1aI84
     FIREBASE_PROYECTO                             → proveedores-cesantoni
   Publicar: Implementar › Nueva implementación › Aplicación web › Ejecutar como: yo · Acceso: Cualquier usuario. */
const P = PropertiesService.getScriptProperties();
const SITIO = 'https://logistica-cesantoni.github.io/';
const TIPOS = { checklist: 'Checklist pre-salida reprobado', sin_checklist: 'Salida a ruta sin checklist', capacidad: 'Sobrepeso en la unidad',
  parado: 'Folio parado', modificacion: 'Modificación de acopio' };

function doGet() { return salida_({ estado: 'ok', servicio: 'Correos de Control de Embarques' }); }

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    usuario_(req.idToken);                                  // solo usuarios con sesión y correo verificado
    const cfg = configuracion_(req.idToken);
    if (!cfg.activo) return salida_({ estado: 'no activado' });
    const alerta = req.alerta || {};
    const para = ((cfg.para || {})[alerta.tipo] || []).filter(function (c) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c); });
    if (!para.length) return salida_({ estado: 'sin destinatarios' });
    if (!reservar_(para.length, Number(cfg.tope_diario) || 10000)) return salida_({ estado: 'tope diario' });
    enviar_(para, armar_(alerta));
    return salida_({ estado: 'enviado', para: para.length });
  } catch (err) {
    return salida_({ estado: 'error', error: String(err && err.message || err).slice(0, 300) });
  }
}

function salida_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* Valida el token de Firebase de quien manda la alerta. */
function usuario_(idToken) {
  if (!idToken) throw new Error('Sin sesión');
  const r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + P.getProperty('FIREBASE_API_KEY'), {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true });
  const u = (JSON.parse(r.getContentText()).users || [])[0];
  if (r.getResponseCode() !== 200 || !u || !u.emailVerified) throw new Error('Sesión no válida');
  return u.email.toLowerCase();
}
/* Lee lc_config/correos con el mismo token (las reglas de Firestore deciden si lo puede leer). */
function configuracion_(idToken) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + P.getProperty('FIREBASE_PROYECTO') + '/databases/(default)/documents/lc_config/correos';
  const r = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + idToken }, muteHttpExceptions: true });
  if (r.getResponseCode() === 404) return {};
  if (r.getResponseCode() !== 200) throw new Error('No se pudo leer la configuración de correos (' + r.getResponseCode() + ')');
  return valor_({ mapValue: { fields: JSON.parse(r.getContentText()).fields || {} } });
}
function valor_(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(valor_);
  if ('mapValue' in v) { const o = {}; Object.keys(v.mapValue.fields || {}).forEach(function (k) { o[k] = valor_(v.mapValue.fields[k]); }); return o; }
  return null;
}

/* Contador del día (hora de México). */
function reservar_(n, tope) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const hoy = Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd'), clave = 'cuenta-' + hoy;
    const usados = Number(P.getProperty(clave) || 0);
    if (usados + n > Math.min(tope, 10000)) return false;
    P.setProperty(clave, String(usados + n));
    Object.keys(P.getProperties()).forEach(function (k) { if (k.indexOf('cuenta-') === 0 && k !== clave) P.deleteProperty(k); });
    return true;
  } finally { lock.releaseLock(); }
}

function token_() {
  const cache = CacheService.getScriptCache(), guardado = cache.get('graph');
  if (guardado) return guardado;
  const r = UrlFetchApp.fetch('https://login.microsoftonline.com/' + P.getProperty('MS_TENANT_ID') + '/oauth2/v2.0/token', {
    method: 'post', muteHttpExceptions: true, payload: { client_id: P.getProperty('MS_CLIENT_ID'), client_secret: P.getProperty('MS_CLIENT_SECRET'),
      scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' } });
  if (r.getResponseCode() !== 200) throw new Error('Microsoft no dio el token: ' + r.getContentText().slice(0, 200));
  const d = JSON.parse(r.getContentText());
  cache.put('graph', d.access_token, Math.max(60, d.expires_in - 120));
  return d.access_token;
}

function esc_(v) { return String(v === undefined || v === null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function armar_(a) {
  const titulo = TIPOS[a.tipo] || 'Alerta';
  return {
    subject: '[Control de Embarques] ' + titulo + (a.folio ? ' · Folio ' + a.folio : ''),
    html: '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#0D1114">' +
      '<p style="margin:0 0 8px;color:#B45309;font-weight:700">' + esc_(titulo) + '</p><p style="margin:0 0 12px">' + esc_(a.texto) + '</p>' +
      '<p style="margin:0;color:#5F666C;font-size:12px">' + esc_(a.fecha) + ' · ' + esc_(a.area) + (a.por ? ' (' + esc_(a.por) + ')' : '') + '</p>' +
      '<p style="margin:12px 0 0"><a href="' + SITIO + '">Abrir Control de Embarques</a></p></div>'
  };
}
/* Un mensaje con los destinatarios en copia oculta. Reintenta si Microsoft pide esperar (429). */
function enviar_(para, c) {
  const remitente = P.getProperty('REMITENTE');
  const cuerpo = JSON.stringify({ saveToSentItems: false, message: { subject: c.subject, body: { contentType: 'HTML', content: c.html },
    toRecipients: [{ emailAddress: { address: remitente } }], bccRecipients: para.map(function (x) { return { emailAddress: { address: x } }; }) } });
  for (var intento = 1; intento <= 4; intento++) {
    const r = UrlFetchApp.fetch('https://graph.microsoft.com/v1.0/users/' + encodeURIComponent(remitente) + '/sendMail', {
      method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + token_() }, payload: cuerpo, muteHttpExceptions: true });
    if (r.getResponseCode() === 202) return;
    if ((r.getResponseCode() === 429 || r.getResponseCode() >= 500) && intento < 4) { Utilities.sleep(Math.min(30, intento * 5) * 1000); continue; }
    throw new Error('Graph respondió ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  }
}
