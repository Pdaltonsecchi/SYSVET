'use strict';
// Turnos pedidos desde la página pública: horarios libres y validaciones. Funciones puras (sin base de datos),
// así se pueden probar sin levantar el servidor.
const U = require('./util');

// Desde la web solo se pueden pedir consultas y vacunas. Las cirugías las agenda la veterinaria.
const WEB_TYPES = ['consulta', 'vacuna'];
// Los horarios se ofrecen cada 10 minutos. Un turno ocupa su duración completa.
const STEP_MIN = 10;
// Turnos que ocupan lugar en la agenda (rechazados y cancelados no).
const BOOKABLE_STATUS = ['pendiente', 'confirmado'];
const DAYS_AHEAD = 14;

const toMin = (hhmm) => {
  const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number);
  return h * 60 + m;
};
const fromMin = (n) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');

function dayOfWeek(iso) {
  return new Date(iso + 'T12:00:00Z').getUTCDay();
}

/** Franjas [inicio, fin] en minutos para una fecha, según el horario de atención guardado. */
function rangesFor(hours, iso) {
  const v = hours && hours[dayOfWeek(iso)];
  if (!Array.isArray(v) || !v.length) return [];
  // El formato viejo (una sola franja ['09:00', '19:00']) también se acepta.
  const list = typeof v[0] === 'string' ? [v] : v;
  return list.map(([a, b]) => [toMin(a), toMin(b)]);
}

/** Tipo de turno pedido desde la web; cualquier otro valor se rechaza. */
function webType(v) {
  if (!WEB_TYPES.includes(v)) throw U.bad('Desde la página solo se pueden pedir consultas o vacunas.');
  return v;
}

/**
 * Horarios libres de un día. busy = [[inicioMin, finMin], ...] de los turnos ya tomados ese día.
 * nowMin (opcional) descarta los horarios que ya pasaron, cuando el día pedido es hoy.
 */
function freeSlots({ hours, date, duration, busy, nowMin }) {
  const out = [];
  for (const [a, b] of rangesFor(hours, date)) {
    for (let t = a; t + duration <= b; t += STEP_MIN) {
      if (nowMin != null && t < nowMin) continue;
      const end = t + duration;
      if (busy.some(([s, e]) => t < e && s < end)) continue;
      out.push(fromMin(t));
    }
  }
  return out;
}

/** Si un turno a esa hora entra dentro del horario de atención y no pisa otro. */
function canBook({ hours, date, time, duration, busy, nowMin }) {
  return freeSlots({ hours, date, duration, busy, nowMin }).includes(fromMin(toMin(time)));
}

/* ---------- límite de pedidos (en memoria, por proceso) ---------- */
const hits = new Map();
/** true si la clave todavía no superó `max` pedidos dentro de `windowMs`. */
function limit(key, max, windowMs) {
  const now = Date.now();
  if (hits.size > 10000) hits.clear();
  const h = hits.get(key) || { n: 0, t: now };
  if (now - h.t > windowMs) {
    h.n = 0;
    h.t = now;
  }
  h.n += 1;
  hits.set(key, h);
  return h.n <= max;
}

module.exports = {
  WEB_TYPES, BOOKABLE_STATUS, DAYS_AHEAD, STEP_MIN,
  toMin, fromMin, rangesFor, webType, freeSlots, canBook, limit,
};
