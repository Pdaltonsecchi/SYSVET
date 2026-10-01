'use strict';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (message) => new HttpError(400, message);
const HANDLED = Symbol('handled');

const METHODS = ['Efectivo', 'Transferencia', 'Tarjeta de débito', 'Tarjeta de crédito'];
// v2: se suman 'Pulguicidas' y 'Antiparasitarios' a las categorías de producto.
const PROD_CATS = ['Medicamentos', 'Vacunas', 'Higiene', 'Pulguicidas', 'Antiparasitarios', 'Otros'];
const SERV_CATS = ['Consultas', 'Vacunas', 'Cirugías', 'Otros'];
const CASH_CATS = ['Servicios', 'Venta de productos', 'Compra de stock', 'Alquiler y servicios', 'Sueldos', 'Retiro de caja', 'Otros'];
// v2: tipos de turno del calendario, con su color de bloque (coherente en cualquier paleta del sistema).
const APPT_TYPES = ['consulta', 'vacuna', 'cirugia', 'otro'];
const APPT_LABELS = { consulta: 'Consulta', vacuna: 'Vacuna', cirugia: 'Cirugía', otro: 'Otro' };

const TZ = 'America/Argentina/Buenos_Aires';

/** Fecha de hoy en Argentina, como AAAA-MM-DD. */
function todayAR() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Primer día del mes de `iso`, retrocediendo `back` meses. */
function monthStart(iso, back) {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 - (back || 0);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}
/** Último día del mes de `iso`. */
function monthEnd(iso) {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
const round2 = (x) => Math.round(x * 100) / 100;

/* ---------- validaciones ---------- */
function reqStr(v, label, max) {
  if (typeof v !== 'string' || !v.trim()) throw bad('Falta completar: ' + label);
  const s = v.trim();
  if (s.length > (max || 200)) throw bad(label + ' es demasiado largo');
  return s;
}
function optStr(v, max) {
  if (v == null) return '';
  if (typeof v !== 'string') throw bad('Hay un dato inválido');
  const s = v.trim();
  if (s.length > (max || 500)) throw bad('Hay un texto demasiado largo');
  return s;
}
function reqDate(v, label) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad('Fecha inválida: ' + label);
  const d = new Date(v + 'T00:00:00Z');
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw bad('Fecha inválida: ' + label);
  return v;
}
function optDate(v, label) {
  return v == null || v === '' ? null : reqDate(v, label);
}
/** Fecha que no puede ser posterior a hoy (nacimiento, diagnóstico, aplicación, cobro, compra...). */
function pastDate(v, label) {
  reqDate(v, label);
  if (v > todayAR()) throw bad(label + ' no puede ser posterior a hoy');
  return v;
}
function optPastDate(v, label) {
  return v == null || v === '' ? null : pastDate(v, label);
}
/** Hora de un turno: acepta "HH:MM" o "HH:MM:SS" y siempre devuelve "HH:MM:SS". */
function reqTime(v, label) {
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(v)) throw bad('Hora inválida: ' + label);
  return v.length === 5 ? v + ':00' : v;
}
function reqNum(v, label, min, max) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !isFinite(n)) throw bad('Número inválido: ' + label);
  if (min != null && n < min) throw bad(label + ' no puede ser menor a ' + min);
  if (max != null && n > max) throw bad(label + ' es demasiado grande');
  return n;
}
function reqInt(v, label, min, max) {
  const n = reqNum(v, label, min, max);
  if (!Number.isInteger(n)) throw bad(label + ' tiene que ser un número entero');
  return n;
}
function money(v, label) {
  return round2(reqNum(v, label, 0, 1e9));
}
function oneOf(v, list, label) {
  if (!list.includes(v)) throw bad('Valor inválido: ' + label);
  return v;
}
function idParam(s) {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) throw bad('Identificador inválido');
  return n;
}
function checkEmail(s) {
  if (s && !/^\S+@\S+\.\S+$/.test(s)) throw bad('El email no parece válido');
  return s;
}

/* ---------- http ---------- */
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        tooBig = true;
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return reject(new HttpError(413, 'Los datos enviados son demasiado grandes'));
      if (!size) return resolve({});
      try {
        const b = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(b && typeof b === 'object' ? b : {});
      } catch (e) {
        reject(bad('Los datos enviados no son válidos'));
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 1) return;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  });
  return out;
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.socket.remoteAddress || 'desconocida';
}

module.exports = {
  HttpError, bad, HANDLED,
  METHODS, PROD_CATS, SERV_CATS, CASH_CATS, APPT_TYPES, APPT_LABELS,
  TZ, todayAR, addDays, monthStart, monthEnd, round2,
  reqStr, optStr, reqDate, optDate, pastDate, optPastDate, reqTime, reqNum, reqInt, money, oneOf, idParam, checkEmail,
  sendJson, readBody, parseCookies, clientIp,
};
