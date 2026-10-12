/* Envío real de las alertas por correo desde un buzón de Outlook (Microsoft 365) con Microsoft Graph.
   Cloud Function de Firebase (2.ª generación): se dispara al crear un documento en lc_alertas, decide los destinatarios
   (Configuración › Correos de alertas: áreas y correos extra por tipo de alerta), manda el correo y anota el resultado en la alerta
   (correo: enviado / sin destinatarios / tope diario / error).

   Límites de Exchange Online por buzón: 10,000 destinatarios al día y 30 mensajes por minuto. Se lleva un contador diario
   (lc_config_correo/AAAA-MM-DD) y si Microsoft responde 429 se reintenta respetando Retry-After.

   Requisitos (ver LEEME.md en esta carpeta): plan Blaze de Firebase; aplicación registrada en Microsoft Entra con permiso de
   aplicación Mail.Send y consentimiento de administrador, limitada al buzón remitente. */
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { destinatarios, armarCorreo, cabe } = require('./logica');

admin.initializeApp();
const TENANT = defineSecret('MS_TENANT_ID');
const CLIENTE = defineSecret('MS_CLIENT_ID');
const SECRETO = defineSecret('MS_CLIENT_SECRET');
const BUZON = defineString('BUZON_REMITENTE', { default: 'logistica-avisos@cesantoni.com.mx' });
const ADMINISTRADOR = 'jroman@cesantoni.com.mx';
const SITIO = 'https://logistica-cesantoni.github.io/';

let token = null, vence = 0;
async function tokenGraph() {
  if (token && Date.now() < vence - 60000) return token;
  const r = await fetch('https://login.microsoftonline.com/' + TENANT.value() + '/oauth2/v2.0/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENTE.value(), client_secret: SECRETO.value(), scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
  });
  if (!r.ok) throw new Error('Microsoft no dio el token: ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const d = await r.json();
  token = d.access_token; vence = Date.now() + d.expires_in * 1000;
  return token;
}
async function enviar(para, correo) {
  for (let intento = 1; intento <= 4; intento++) {
    const r = await fetch('https://graph.microsoft.com/v1.0/users/' + encodeURIComponent(BUZON.value()) + '/sendMail', {
      method: 'POST', headers: { Authorization: 'Bearer ' + (await tokenGraph()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ saveToSentItems: false, message: { subject: correo.subject, body: { contentType: 'HTML', content: correo.html },
        toRecipients: [{ emailAddress: { address: BUZON.value() } }], bccRecipients: para.map((address) => ({ emailAddress: { address } })) } })
    });
    if (r.status === 202) return;
    if ((r.status === 429 || r.status >= 500) && intento < 4) {
      const espera = Math.min(60, Number(r.headers.get('Retry-After')) || intento * 5);
      await new Promise((ok) => setTimeout(ok, espera * 1000));
      continue;
    }
    throw new Error('Graph respondió ' + r.status + ': ' + (await r.text()).slice(0, 300));
  }
}

exports.correoAlertas = onDocumentCreated({ document: 'lc_alertas/{id}', secrets: [TENANT, CLIENTE, SECRETO], region: 'us-central1', timeoutSeconds: 300 }, async (event) => {
  const alerta = event.data && event.data.data();
  if (!alerta) return;
  const db = admin.firestore(), ref = event.data.ref;
  const config = (await db.doc('lc_config/correos').get()).data() || {};
  if (!config.activo) { await ref.update({ correo: 'no activado' }); return; }
  const usuarios = (await db.collection('lc_usuarios').get()).docs.map((d) => Object.assign({ id: d.id }, d.data()));
  const para = destinatarios(config, usuarios, alerta, ADMINISTRADOR);
  if (!para.length) { await ref.update({ correo: 'sin destinatarios' }); return; }
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  const contador = db.doc('lc_config_correo/' + hoy);
  const reservado = await db.runTransaction(async (tx) => {
    const usados = ((await tx.get(contador)).data() || {}).destinatarios || 0;
    if (!cabe(usados, para.length, config.tope_diario)) return false;
    tx.set(contador, { destinatarios: usados + para.length, actualizado: new Date().toISOString() }, { merge: true });
    return true;
  });
  if (!reservado) { await ref.update({ correo: 'tope diario' }); return; }
  try {
    await enviar(para, armarCorreo(alerta, SITIO));
    await ref.update({ correo: 'enviado', correo_para: para.length, correo_fecha: new Date().toISOString() });
  } catch (e) {
    await ref.update({ correo: 'error', correo_error: String(e.message || e).slice(0, 300) });
  }
});
