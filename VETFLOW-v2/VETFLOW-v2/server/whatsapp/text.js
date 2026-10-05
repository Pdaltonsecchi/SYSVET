'use strict';

const U = require('../util');

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Minúsculas, sin tildes ni signos, para comparar lo que escribe el cliente. */
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¿?¡!.,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const has = (n, words) => words.some((w) => new RegExp('(^| )' + w).test(n));

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const weekday = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();
/** "Martes 10 de octubre" */
function fmtDate(iso) {
  return cap(DAYS[weekday(iso)]) + ' ' + Number(iso.slice(8, 10)) + ' de ' + MONTHS[Number(iso.slice(5, 7)) - 1];
}
/** "10 de octubre de 2026" */
function fmtDateLong(iso) {
  return Number(iso.slice(8, 10)) + ' de ' + MONTHS[Number(iso.slice(5, 7)) - 1] + ' de ' + iso.slice(0, 4);
}
const fmtTime = (t) => String(t).slice(0, 5);

/** Ahora en Argentina: { date: 'AAAA-MM-DD', minutes: minutos desde las 00:00 }. */
function nowAR(d) {
  const s = (d || new Date()).toLocaleString('sv-SE', { timeZone: U.TZ }); // 'AAAA-MM-DD HH:MM:SS'
  return { date: s.slice(0, 10), minutes: Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16)) };
}
const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const fromMin = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

/** Entiende "hoy", "mañana", "el viernes", "15/10", "15 de octubre"... Devuelve 'AAAA-MM-DD' o null. */
function parseDate(text, today) {
  const n = norm(text);
  if (/(^| )pasado manana/.test(n)) return U.addDays(today, 2);
  if (/(^| )manana/.test(n)) return U.addDays(today, 1);
  if (/(^| )hoy/.test(n)) return today;
  for (let i = 0; i < 7; i++) {
    const name = norm(DAYS[i]);
    if (new RegExp('(^| )' + name + '( |$)').test(n)) {
      const diff = ((i - weekday(today) + 7) % 7) || 7; // el próximo, nunca hoy
      return U.addDays(today, diff);
    }
  }
  let m = n.match(/(^| )(\d{1,2}) de ([a-z]+)( de (\d{4}))?/);
  let d, mo, y;
  if (m && MONTHS.map(norm).includes(m[3])) {
    d = Number(m[2]);
    mo = MONTHS.map(norm).indexOf(m[3]) + 1;
    y = m[5] ? Number(m[5]) : null;
  } else {
    m = n.match(/(^| )(\d{1,2})[\/-](\d{1,2})([\/-](\d{2,4}))?( |$)/);
    if (!m) return null;
    d = Number(m[2]);
    mo = Number(m[3]);
    y = m[5] ? Number(m[5]) : null;
    if (y != null && y < 100) y += 2000;
  }
  const mk = (yy) => {
    const iso = String(yy) + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const dt = new Date(iso + 'T00:00:00Z');
    return !isNaN(dt) && dt.toISOString().slice(0, 10) === iso ? iso : null;
  };
  const cy = Number(today.slice(0, 4));
  if (y) return mk(y);
  const iso = mk(cy);
  if (iso && iso >= today) return iso;
  return mk(cy + 1);
}

/** "10:30", "10.30", "10hs", "a las 10" → 'HH:MM' (o null). */
function parseTime(text) {
  const n = norm(text);
  let m = n.match(/(^| )([01]?\d|2[0-3])[:h]([0-5]\d)( |$|hs)/);
  if (m) return String(m[2]).padStart(2, '0') + ':' + m[3];
  m = n.match(/(^| )(?:a )?las? ([01]?\d|2[0-3])( |$)/) || n.match(/(^| )([01]?\d|2[0-3]) ?(hs|h|horas)( |$)/);
  if (m) return String(m[2]).padStart(2, '0') + ':00';
  return null;
}

/** Elección de una opción numerada ("2", "2️⃣", "opcion 2"). Devuelve el número o null. */
function parseChoice(text, max) {
  const m = String(text).normalize('NFKD').replace(/️|⃣/g, '').match(/^\s*(?:opcion\s*)?(\d{1,2})\s*[.)]?\s*$/i);
  const k = m ? Number(m[1]) : null;
  return k && k <= max ? k : null;
}
const YES = ['si', 'sii', 'siii', 'dale', 'ok', 'okay', 'oka', 'claro', 'correcto', 'confirmo', 'confirmado', 'perfecto', 'va', 'listo', 'de una', 'por supuesto', 'es correcto', 'yes', 'si quiero', 'quiero', 'vale'];
const NO = ['no', 'nop', 'nono', 'negativo', 'ahora no', 'no gracias', 'no quiero', 'no puedo'];
/** 'yes' | 'no' | null */
function parseYesNo(text) {
  const n = norm(text);
  if (/^1$/.test(n)) return 'yes';
  if (/^2$/.test(n)) return 'no';
  if (YES.includes(n) || /^(si|dale|ok|claro|confirmo)( |$)/.test(n)) return 'yes';
  if (NO.includes(n) || /^no( |$)/.test(n)) return 'no';
  return null;
}

/** Normaliza un teléfono argentino a sus 10 dígitos nacionales (área + número) o null. Acepta 54 9, 0, 15, guiones, etc. */
function canonPhone(raw) {
  let n = String(raw || '').replace(/\D/g, '').replace(/^00/, '');
  if (n.startsWith('54')) {
    n = n.slice(2);
    if (n.startsWith('9')) n = n.slice(1);
  }
  n = n.replace(/^0/, '');
  if (n.length > 10) {
    for (const a of [2, 3, 4]) {
      if (n.slice(a, a + 2) === '15' && n.length - 2 === 10) {
        n = n.slice(0, a) + n.slice(a + 2);
        break;
      }
    }
  }
  return n.length === 10 ? n : null;
}
/** Número en formato WhatsApp (celular argentino): 549 + 10 dígitos. */
const waNumber = (raw) => {
  const c = canonPhone(raw);
  return c ? '549' + c : null;
};

module.exports = { DAYS, MONTHS, norm, has, cap, fmtDate, fmtDateLong, fmtTime, nowAR, toMin, fromMin, parseDate, parseTime, parseChoice, parseYesNo, canonPhone, waNumber, weekday };
