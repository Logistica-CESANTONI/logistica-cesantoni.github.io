/* Revisión de partidas contra Pesos, Embalajes y Estibas. La descripción del producto trae «1.68 MT2/ 24 CJ»:
   con los m² por caja y las cajas por tarima se busca el formato en la tabla. */
import { EMBALAJES, ADHESIVOS, REVISION } from './embalajes-datos.js?v=19';
export { EMBALAJES, ADHESIVOS, REVISION };

export function leerDescripcion(desc) {
  const t = String(desc || '').toUpperCase();
  const m2 = t.match(/(\d+(?:\.\d+)?)\s*M(?:T)?2\b/), cj = t.match(/\/\s*(\d+)\s*CJ/);
  return { m2_caja: m2 ? Number(m2[1]) : null, cajas_tarima: cj ? Number(cj[1]) : null };
}
/* Formato de la tabla para una partida; null si no se reconoce. */
export function embalajeDe(partida) {
  const sku = String(partida.sku || '').toUpperCase();
  const adh = ADHESIVOS.find((a) => a.sku.toUpperCase() === sku);
  if (adh) return { adhesivo: true, formato: adh.descripcion, paquetes_tarima: adh.paquetes_tarima };
  const d = leerDescripcion(partida.producto);
  if (!d.m2_caja) return null;
  const mismos = EMBALAJES.filter((e) => Math.abs(e.m2_caja - d.m2_caja) < 0.006 && (!d.cajas_tarima || e.cajas_tarima === d.cajas_tarima));
  if (!mismos.length) return null;
  // Varios formatos comparten m² y cajas (p. ej. 20*60 y 30*60 con 1.44 m² / 48 cj): se desempata por medida y acabado.
  const t = String(partida.producto || '').toUpperCase(), dim = (t.match(/(\d+(?:\.\d+)?)\s*\*\s*(\d+(?:\.\d+)?)/) || []).slice(1).join('*');
  const rasgos = [/\bPRC\b/, /\bRECT?\b/, /\bPUL(IDO)?\b/, /\bSG\b/, /\bMALLA?\b/];
  const puntos = (e) => {
    const f = e.formato.toUpperCase();
    let n = dim && f.startsWith(dim) ? 4 : 0;
    rasgos.forEach((r) => { if (r.test(t) === r.test(f)) n += 1; });
    if (/\(/.test(f) && !/(SODIMAC|HD|HOME DEPOT|EXPO)/.test(t)) n -= /\((SODIMAC|HD|HOME DEPOT|CLIENTE EXPO)/.test(f) ? 2 : 0;
    return n;
  };
  return mismos.slice().sort((a, b) => puntos(b) - puntos(a))[0];
}
/* Revisa cajas, tarimas y kilos de una partida en cajas (UM = CJ). */
export function revisarPartida(p) {
  const e = embalajeDe(p);
  if (!e) return { embalaje: null };
  if (e.adhesivo) return { embalaje: e, tarimas_calc: p.cantidad ? Math.floor(p.cantidad / e.paquetes_tarima) : null };
  const cajas = String(p.um || 'CJ').toUpperCase() === 'CJ' ? Number(p.cantidad) || 0 : 0;
  if (!cajas) return { embalaje: e };
  const kgMin = cajas * e.kg_caja_min, kgMax = cajas * e.kg_caja_max;
  const kg = Number(p.kg) || 0;
  return {
    embalaje: e, tarimas_calc: Math.floor(cajas / e.cajas_tarima), restos_calc: cajas % e.cajas_tarima,
    kg_min: Math.round(kgMin * 100) / 100, kg_max: Math.round(kgMax * 100) / 100,
    fuera_de_rango: kg > 0 && (kg < kgMin * 0.99 || kg > kgMax * 1.01)
  };
}
