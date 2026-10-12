/* Pantalla del almacén: tablero tipo aeropuerto, sin contraseña. Solo lee lc_pantalla, la copia pública de cada folio
   (sin tarifas, operador, placas, material, direcciones ni nombres de clientes de Última Milla).
   Se refresca cada 30 segundos y pasa de página sola si no caben todos los folios. */
import * as fb from './firebase-sdk.js?v=18';
import { ESTATUS } from './reglas.js?v=18';

const CFG = window.LC_CONFIG;
const app = fb.initializeApp(CFG.firebase, 'pantalla');
const db = fb.getFirestore(app);
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has('emu')) fb.connectFirestoreEmulator(db, '127.0.0.1', 8080);

const ORDEN = ['PARADO', 'INCOMPLETO', 'LISTO', 'ARMADO', 'EN_PREPARACION', 'RECIBIDO', 'EN_RUTA', 'ENTREGADO'];
const cuerpo = document.getElementById('filas'), reloj = document.getElementById('reloj'), estado = document.getElementById('estado'), pagina = document.getElementById('pagina');
let folios = [], pag = 0;

const td = (texto, clase) => { const c = document.createElement('td'); if (clase) c.className = clase; c.textContent = texto; return c; };
const dos = (n) => String(n).padStart(2, '0');
function hora(v) {
  if (!v) return '—';
  const d = new Date(v), hoy = new Date();
  if (isNaN(d)) return v;
  const hm = dos(d.getHours()) + ':' + dos(d.getMinutes());
  return d.toDateString() === hoy.toDateString() ? hm : dos(d.getDate()) + '/' + dos(d.getMonth() + 1) + ' ' + hm;
}

async function cargar() {
  try {
    const snap = await fb.getDocs(fb.collection(db, 'lc_pantalla'));
    const hace24 = Date.now() - 86400000;
    folios = snap.docs.map((d) => d.data())
      .filter((f) => f.estatus !== 'ENTREGADO' || Date.parse(f.entregado || f.actualizado || 0) > hace24)
      .sort((a, b) => ORDEN.indexOf(a.estatus) - ORDEN.indexOf(b.estatus) || String(a.cita || '9').localeCompare(String(b.cita || '9')));
    estado.textContent = 'Actualizado ' + dos(new Date().getHours()) + ':' + dos(new Date().getMinutes());
    estado.classList.remove('mal');
  } catch (e) {
    estado.textContent = 'Sin conexión — mostrando lo último';
    estado.classList.add('mal');
  }
  pintar();
}
function porPagina() {
  const alto = window.innerHeight - document.querySelector('.tablero thead').getBoundingClientRect().bottom - 60;
  return Math.max(4, Math.floor(alto / 62));
}
function pintar() {
  const n = porPagina(), paginas = Math.max(1, Math.ceil(folios.length / n));
  if (pag >= paginas) pag = 0;
  const vis = folios.slice(pag * n, pag * n + n);
  cuerpo.replaceChildren();
  if (!vis.length) {
    const tr = document.createElement('tr'), c = td('Sin folios activos', 'vacio'); c.colSpan = 10; tr.appendChild(c); cuerpo.appendChild(tr);
  }
  vis.forEach((f) => {
    const e = ESTATUS[f.estatus] || { nombre: f.estatus, color: 'gris' };
    const tr = document.createElement('tr');
    tr.className = 'c-' + e.color;
    const sem = document.createElement('td'); sem.className = 'sem'; const luz = document.createElement('span'); luz.className = 'luz ' + e.color; luz.setAttribute('aria-hidden', 'true'); sem.appendChild(luz);
    const n3 = Number(f.docs) || 0;
    tr.append(sem, td(f.folio, 'folio'), td(f.tipo_envio === 'ULTIMA_MILLA' ? 'ÚLT. MILLA' : 'NACIONAL', 'tipo ' + (f.tipo_envio === 'ULTIMA_MILLA' ? 'um' : 'nac')), td(f.cliente + (f.destino ? ' · ' + f.destino : ''), 'cliente'), td(f.transportista || '—'),
      td(f.tipo_unidad || '—'), td(hora(f.cita), 'cita'), td(f.anden || '—', 'anden'), td(n3 + '/3', 'docs d' + n3), td(e.nombre.toUpperCase(), 'est ' + e.color));
    cuerpo.appendChild(tr);
  });
  pagina.textContent = paginas > 1 ? 'Página ' + (pag + 1) + ' de ' + paginas : '';
}
const tic = () => { const d = new Date(); reloj.textContent = dos(d.getHours()) + ':' + dos(d.getMinutes()) + ':' + dos(d.getSeconds()); };
tic();
setInterval(tic, 1000);
setInterval(cargar, 30000);
setInterval(() => { pag++; pintar(); }, 12000);
window.addEventListener('resize', pintar);
cargar();
