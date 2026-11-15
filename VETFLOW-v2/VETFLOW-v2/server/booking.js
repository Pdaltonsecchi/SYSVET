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
/**
 * Clave del límite de intentos fallidos con un mismo número: la misma para todas las formas de escribirlo (con o sin
 * característica). Solo se usa cuando el ingreso falló, así que no puede dejar afuera a quien entra bien.
 */
const phoneLimitKey = (v) => phoneKey(v).slice(-8);

/* ---------- límite de pedidos (en memoria, por proceso) ---------- */
// Las claves tienen la forma "grupo:valor" (por ejemplo "ip:1.2.3.4"). Cada grupo tiene su propio mapa con tope de
// tamaño: llenar uno no borra los contadores de los demás. Si un grupo se llena, se saca el contador más viejo para
// hacer lugar: nunca se vacía todo de golpe y los visitantes nuevos no pagan por lo que hicieron otros.
// Los topes totales usan una sola clave por grupo, así que nunca se sacan.
const MAX_KEYS = 5000;
const MAX_KEY_LEN = 64;
const groups = new Map();
function slot(key, windowMs, create) {
  const now = Date.now();
  const k = String(key);
  const i = k.indexOf(':');
  const group = i > 0 ? k.slice(0, i) : 'general';
  let map = groups.get(group);
  if (!map) {
    if (!create) return null;
    map = new Map();
    groups.set(group, map);
  }
  const id = k.slice(i + 1, i + 1 + MAX_KEY_LEN);
  let h = map.get(id);
  if (h && now - h.t > h.w) {
    map.delete(id);
    h = null;
  }
  if (h || !create) return h;
  if (map.size >= MAX_KEYS) {
    for (const [kk, v] of map) if (now - v.t > v.w) map.delete(kk);
    // Sigue lleno: sale el más viejo (un Map recorre sus claves en el orden en que se agregaron).
    if (map.size >= MAX_KEYS) map.delete(map.keys().next().value);
  }
  h = { n: 0, t: now, w: windowMs };
  map.set(id, h);
  return h;
}
/** Suma un pedido a la clave (la ventana de tiempo arranca con el primero). */
function hit(key, windowMs) {
  slot(key, windowMs, true).n += 1;
}
/** Devuelve un pedido sumado con hit (por ejemplo, un intento de ingreso que al final salió bien). */
function unhit(key) {
  const h = slot(key, 0, false);
  if (h && h.n > 0) h.n -= 1;
}
/** true si la clave ya llegó a `max` dentro de su ventana. No suma nada. */
function blocked(key, max) {
  const h = slot(key, 0, false);
  return !!h && h.n >= max;
}
/** Suma un pedido y devuelve true si la clave todavía no superó `max` dentro de `windowMs`. */
function limit(key, max, windowMs) {
  const h = slot(key, windowMs, true);
  h.n += 1;
  return h.n <= max;
}

/* ---------- topes de uso de la página pública ---------- */
// Se pueden ajustar con variables de entorno (las pruebas automáticas los suben para no chocar con ellos).
const envInt = (name, def) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : def;
};
const LIMITS = {
  ipRequests: envInt('TURNOS_PEDIDOS_POR_IP', 120), // pedidos por IP cada 10 minutos
  failsPerIp: envInt('TURNOS_FALLOS_POR_IP', 20), // ingresos fallidos por IP por hora
  failsPerPhone: 10, // ingresos fallidos con el mismo teléfono cada 15 minutos
  failsGlobal: envInt('TURNOS_FALLOS_TOTAL', 60), // ingresos fallidos en total cada 15 minutos (frena el barrido de números)
  signupsPerIp: envInt('TURNOS_ALTAS_POR_IP', 5), // clientes nuevos por IP por hora
  signupsPerDay: envInt('TURNOS_ALTAS_POR_DIA', 20), // clientes nuevos por la web por día, en total
  petsPerClient: 10, // mascotas por cliente (más que eso, por teléfono)
  pendingPerClient: 3, // pedidos esperando confirmación por cliente
  pendingGlobal: envInt('TURNOS_PENDIENTES_TOTAL', 60), // pedidos web esperando confirmación, en total
};

module.exports = {
  WEB_TYPES, BOOKABLE_STATUS, DAYS_AHEAD, STEP_MIN,
  toMin, fromMin, rangesFor, webType, freeSlots, canBook, limit, hit, unhit, blocked, LIMITS,
  phoneKey, samePhone, phoneTail, phoneLimitKey,
};
