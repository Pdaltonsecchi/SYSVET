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

/* ---------- teléfonos ---------- */
/**
 * Forma comparable de un teléfono argentino: solo dígitos, sin 54, sin el 9 de celular, sin el 0 de la característica
 * y sin el 15. Así "011 15 5555-1234", "+54 9 11 5555-1234" y "11 5555 1234" dan todos "1155551234".
 * Un número escrito sin característica queda más corto (por ejemplo "55551234").
 */
function phoneKey(v) {
  let d = String(v == null ? '' : v).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length > 10 && d.startsWith('54')) d = d.slice(2);
  // Ninguna característica argentina empieza con 9: adelante de un número completo es el 9 de celular.
  if (d.length >= 11 && d.startsWith('9')) d = d.slice(1);
  d = d.replace(/^0+/, '');
  if (d.length === 12) {
    // característica (2, 3 o 4 dígitos) + 15 + número (8, 7 o 6 dígitos)
    if (d.startsWith('11') && d.slice(2, 4) === '15') d = '11' + d.slice(4);
    else if (d.slice(3, 5) === '15') d = d.slice(0, 3) + d.slice(5);
    else if (d.slice(4, 6) === '15') d = d.slice(0, 4) + d.slice(6);
  } else if (d.length >= 8 && d.length <= 10 && d.startsWith('15')) {
    // "15 5555-1234": celular escrito sin característica (ninguna característica empieza con 15).
    d = d.slice(2);
  }
  return d;
}
/**
 * Si dos teléfonos son el mismo. Con característica en los dos se comparan los últimos 10 dígitos; si a alguno le
 * falta la característica, los últimos 8. Con menos de 8 dígitos solo vale la coincidencia exacta, para no confundir
 * a un cliente con otro por unas pocas cifras.
 */
function samePhone(a, b) {
  const x = phoneKey(a);
  const y = phoneKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 10 && y.length >= 10) return x.slice(-10) === y.slice(-10);
  if (x.length >= 8 && y.length >= 8) return x.slice(-8) === y.slice(-8);
  return false;
}
/** Últimos 6 dígitos tal como se escribieron: sirven para buscar candidatos en la base (ver clients_phone_tail_idx). */
const phoneTail = (v) => String(v == null ? '' : v).replace(/\D/g, '').slice(-6);
/** Clave del límite de intentos: la misma para todas las formas de escribir un número. */
const phoneLimitKey = (v) => phoneKey(v).slice(-8);

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
  phoneKey, samePhone, phoneTail, phoneLimitKey,
};
