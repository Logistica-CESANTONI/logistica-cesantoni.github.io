/* Lógica del envío de alertas (sin Firebase ni red, para poder probarla).
   config (lc_config/correos): { activo, areas: { tipo: ['transporte', …] }, extra: { tipo: ['a@b.com', …] }, tope_diario }
   usuarios (lc_usuarios): [{ id: correo, area, activo }] */
const TIPOS = {
  checklist: 'Checklist pre-salida reprobado', sin_checklist: 'Salida a ruta sin checklist', capacidad: 'Sobrepeso en la unidad',
  parado: 'Folio parado', modificacion: 'Modificación de acopio'
};
const correoValido = (c) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(c || '').trim());

function destinatarios(config, usuarios, alerta, administrador) {
  const areas = new Set(((config.areas || {})[alerta.tipo]) || []);
  const lista = new Set();
  (usuarios || []).forEach((u) => { if (u.activo !== false && areas.has(u.area) && correoValido(u.id)) lista.add(u.id.trim().toLowerCase()); });
  if (areas.has('admin') && correoValido(administrador)) lista.add(administrador.toLowerCase());
  (((config.extra || {})[alerta.tipo]) || []).forEach((c) => { if (correoValido(c)) lista.add(String(c).trim().toLowerCase()); });
  return [...lista];
}

const esc = (v) => String(v === undefined || v === null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function armarCorreo(alerta, sitio) {
  const titulo = TIPOS[alerta.tipo] || 'Alerta';
  return {
    subject: '[Control de Embarques] ' + titulo + (alerta.folio ? ' · Folio ' + alerta.folio : ''),
    html: '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#0D1114">' +
      '<p style="margin:0 0 8px;color:#B45309;font-weight:700">' + esc(titulo) + '</p>' +
      '<p style="margin:0 0 12px">' + esc(alerta.texto) + '</p>' +
      '<p style="margin:0;color:#5F666C;font-size:12px">' + esc(alerta.fecha) + ' · ' + esc(alerta.area) + (alerta.por ? ' (' + esc(alerta.por) + ')' : '') + '</p>' +
      (sitio ? '<p style="margin:12px 0 0"><a href="' + esc(sitio) + '">Abrir Control de Embarques</a></p>' : '') + '</div>'
  };
}
/* ¿Cabe en el tope del día? (Exchange Online: 10,000 destinatarios por buzón al día.) */
const cabe = (usadosHoy, nuevos, tope) => usadosHoy + nuevos <= (Number(tope) || 10000);

module.exports = { TIPOS, destinatarios, armarCorreo, cabe };
