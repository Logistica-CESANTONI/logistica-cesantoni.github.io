/* Ubicación de las unidades en ruta. Si la unidad tiene vehículo de Samsara y está configurado el puente (Cloud Function
   que guarda el token de Samsara; el token nunca va en esta página pública), se pide la ubicación real. Si falla por lo que
   sea (sin puente, sin internet, error, unidad sin vincular), se calcula una posición SIMULADA. La pantalla nunca queda vacía. */
import { km } from './ruta.js?v=18';

const VEL_SIM_KMH = 55;

export async function ubicacion({ puente, token, samsaraId, origen, destino, salida }) {
  if (puente && samsaraId) {
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 7000);
      const r = await fetch(puente + (puente.includes('?') ? '&' : '?') + 'vehiculo=' + encodeURIComponent(samsaraId), {
        headers: token ? { Authorization: 'Bearer ' + token } : {}, signal: ctl.signal
      });
      clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      if (typeof d.lat !== 'number' || typeof d.lng !== 'number') throw new Error('Respuesta sin coordenadas');
      return { fuente: 'real', lat: d.lat, lng: d.lng, velocidad: Math.round(Number(d.velocidad_kmh) || 0), hora: d.hora || new Date().toISOString(), lugar: d.lugar || '' };
    } catch (e) {
      return Object.assign(simulada(origen, destino, salida), { motivo: 'Samsara no respondió (' + (e.name === 'AbortError' ? 'tiempo agotado' : e.message) + ')' });
    }
  }
  return Object.assign(simulada(origen, destino, salida), { motivo: !samsaraId ? 'Unidad sin vehículo de Samsara vinculado' : 'Puente de Samsara sin configurar' });
}

/* Avanza en línea recta del origen al destino a 55 km/h desde la hora de salida. */
export function simulada(origen, destino, salida, ahora) {
  const t0 = salida ? new Date(salida).getTime() : Date.now(), t = ahora || Date.now();
  const horas = Math.max(0, (t - t0) / 3600000);
  if (!origen) return { fuente: 'simulado', lat: null, lng: null, velocidad: 0, hora: new Date(t).toISOString() };
  if (!destino || destino.lat === undefined || destino.lat === null) {
    return { fuente: 'simulado', lat: origen.lat, lng: origen.lng, velocidad: 0, hora: new Date(t).toISOString(), avance: 0 };
  }
  const total = km(origen, destino) || 0.001, avance = Math.min(1, (horas * VEL_SIM_KMH) / total);
  const vaiven = avance < 1 ? Math.sin(t / 60000) * 6 : 0;
  return {
    fuente: 'simulado',
    lat: origen.lat + (destino.lat - origen.lat) * avance,
    lng: origen.lng + (destino.lng - origen.lng) * avance,
    velocidad: avance < 1 ? Math.round(VEL_SIM_KMH + vaiven) : 0,
    hora: new Date(t).toISOString(),
    avance,
    faltan_km: Math.round(total * (1 - avance))
  };
}
