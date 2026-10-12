/* Utilidades de pantalla. Todo el texto se inserta como texto (sin innerHTML). */
export function h(tag, attrs, ...hijos) {
  const el = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (v === null || v === undefined || v === false) return;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (['checked', 'disabled', 'selected', 'open'].includes(k)) el[k] = true;
    else el.setAttribute(k, v === true ? '' : v);
  });
  hijos.forEach((c) => add(el, c));
  return el;
}
function add(el, c) {
  if (c === null || c === undefined || c === false) return;
  if (Array.isArray(c)) { c.forEach((x) => add(el, x)); return; }
  el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
}
export function mount(el, ...hijos) { el.replaceChildren(); hijos.forEach((c) => add(el, c)); return el; }

export function toast(msg, mal) {
  const box = document.getElementById('avisos');
  const el = h('div', { class: 'toast' + (mal ? ' mal' : ''), role: mal ? 'alert' : 'status' }, msg);
  box.appendChild(el);
  setTimeout(() => el.remove(), mal ? 8000 : 4500);
}
export async function ocupado(btn, fn, texto) {
  const t = btn.textContent;
  btn.disabled = true; btn.textContent = texto || 'Guardando…';
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = t; }
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/* 'AAAA-MM-DDTHH:MM' o ISO → «12 oct 14:30». */
export function fecha(v, sinHora) {
  if (!v) return '';
  const d = /Z$|[+-]\d\d:\d\d$/.test(v) ? new Date(v) : new Date(v.length <= 10 ? v + 'T00:00' : v);
  if (isNaN(d)) return v;
  const base = d.getDate() + ' ' + MESES[d.getMonth()];
  return sinHora || v.length <= 10 ? base : base + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
export const kg = (n) => (Number(n) || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 }) + ' kg';
export const toneladas = (n) => ((Number(n) || 0) / 1000).toLocaleString('es-MX', { maximumFractionDigits: 1 }) + ' t';
export const pesos = (n) => (Number(n) || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

/* Diálogo modal; devuelve { cerrar }. */
export function modal(titulo, ...contenido) {
  const dlg = h('dialog', { class: 'modal' },
    h('div', { class: 'modal-cab' }, h('h2', null, titulo), h('button', { class: 'btn-x', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, '×')),
    h('div', { class: 'modal-cuerpo' }, contenido));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.appendChild(dlg);
  dlg.showModal();
  return { dlg, cerrar: () => dlg.close() };
}

/* Campo con etiqueta. */
let nCampo = 0;
export function campo(etiqueta, control, ayuda) {
  if (!control.id) control.id = 'c' + ++nCampo;
  const idAyuda = ayuda ? control.id + '-ayuda' : null;
  if (idAyuda) control.setAttribute('aria-describedby', idAyuda);
  return h('div', { class: 'campo' }, h('label', { class: 'etiqueta', for: control.id }, etiqueta), control, ayuda ? h('span', { class: 'ayuda', id: idAyuda }, ayuda) : null);
}
export function entrada(attrs) { return h('input', Object.assign({ class: 'entrada' }, attrs)); }
export function selector(opciones, valor, attrs) {
  return h('select', Object.assign({ class: 'entrada' }, attrs),
    opciones.map(([v, t, extra]) => h('option', Object.assign({ value: v, selected: String(v) === String(valor) }, extra || {}), t)));
}
export function logos(destino) {
  mount(destino,
    h('span', { class: 'marco marco-ces' }, h('img', { src: 'img/logo-cesantoni.png', alt: 'CESANTONI' })),
    h('span', { class: 'divisor', 'aria-hidden': 'true' }),
    h('span', { class: 'marco marco-somos' }, h('img', { src: 'img/logo-somos.png', alt: 'Somos Logística CESANTONI' })));
}

/* Leaflet 1.9.4 (vendor/leaflet) se carga solo cuando se abre Monitoreo o Última Milla. Los mosaicos vienen de OpenStreetMap. */
let leaflet = null;
export function cargarMapa() {
  if (leaflet) return leaflet;
  leaflet = new Promise((ok, mal) => {
    document.head.appendChild(h('link', { rel: 'stylesheet', href: 'vendor/leaflet/leaflet.css' }));
    const s = h('script', { src: 'vendor/leaflet/leaflet.js' });
    s.onload = () => ok(window.L); s.onerror = () => { leaflet = null; mal(new Error('No se pudo cargar el mapa.')); };
    document.head.appendChild(s);
  });
  return leaflet;
}
export function mapaEn(L, contenedor, centro) {
  const m = L.map(contenedor, { scrollWheelZoom: false }).setView([centro.lat, centro.lng], 6);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(m);
  return m;
}
/* «20.67, -103.35» o una liga larga de Google Maps → { lat, lng } (ver coordenadasDeLiga en reglas.js). */
export { coordenadasDeLiga as leerCoordenadas } from './reglas.js?v=18';
