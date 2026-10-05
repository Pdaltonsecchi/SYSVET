'use strict';

const db = require('../db');
const U = require('../util');
const T = require('./text');

const KEY = 'clinic';

/** Datos del consultorio: lo guardado en la base (clinic_settings) y, como respaldo, variables de entorno. No se inventa nada. */
async function getClinic() {
  const r = await db.query('SELECT value FROM clinic_settings WHERE key = $1', [KEY]);
  const s = (r.rows[0] && r.rows[0].value) || {};
  return {
    name: s.name || process.env.CLINIC_NAME || 'SYSVET',
    address: s.address || process.env.CLINIC_ADDRESS || '',
    phone: s.phone || process.env.CLINIC_PHONE || '',
    vet: s.vet || process.env.CLINIC_VET || '',
    hours: s.hours || null, // { "0": [["10:00","14:00"]], "1": [["09:00","19:00"]], ... } (0 = domingo); día ausente o [] = cerrado
    payments: Array.isArray(s.payments) && s.payments.length ? s.payments : U.METHODS,
    services: Array.isArray(s.services) && s.services.length ? s.services : null, // null = lista de precios del sistema
  };
}

function cleanHours(h) {
  if (h == null) return null;
  if (typeof h !== 'object') throw U.bad('Los horarios no son válidos');
  const out = {};
  for (let d = 0; d < 7; d++) {
    const ranges = h[d] || h[String(d)] || [];
    if (!Array.isArray(ranges)) throw U.bad('Los horarios no son válidos');
    out[d] = ranges.map((rg) => {
      if (!Array.isArray(rg) || rg.length !== 2) throw U.bad('Cada franja horaria tiene que ser ["09:00","13:00"]');
      const a = U.reqTime(rg[0], 'Horario de apertura').slice(0, 5);
      const b = U.reqTime(rg[1], 'Horario de cierre').slice(0, 5);
      if (T.toMin(b) <= T.toMin(a)) throw U.bad('El cierre tiene que ser posterior a la apertura');
      return [a, b];
    });
  }
  return out;
}

async function saveClinic(b) {
  const s = {
    name: U.optStr(b.name, 100),
    address: U.optStr(b.address, 200),
    phone: U.optStr(b.phone, 50),
    vet: U.optStr(b.vet, 100),
    hours: cleanHours(b.hours),
    payments: Array.isArray(b.payments) ? b.payments.map((x) => U.reqStr(x, 'Medio de pago', 60)).slice(0, 12) : [],
    services: Array.isArray(b.services) ? b.services.map((x) => U.reqStr(x, 'Servicio', 80)).slice(0, 40) : [],
  };
  await db.query(
    'INSERT INTO clinic_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
    [KEY, JSON.stringify(s)]
  );
  return getClinic();
}

/** Nombres de servicios para informar: los cargados a mano o las categorías/servicios de la lista de precios. */
async function serviceNames(clinic) {
  if (clinic.services) return clinic.services;
  const r = await db.query('SELECT DISTINCT name FROM services ORDER BY name LIMIT 30');
  return r.rows.map((x) => x.name);
}

/** "Lunes a Viernes 09:00-19:00, Sábados 10:00-14:00, Domingos cerrado" a partir de la grilla por día. */
function hoursLines(hours) {
  if (!hours) return [];
  const label = (d) => T.cap(T.DAYS[d]);
  const fmt = (ranges) => (ranges && ranges.length ? ranges.map((r) => r[0] + '-' + r[1]).join(' y ') : 'Cerrado');
  const order = [1, 2, 3, 4, 5, 6, 0];
  const lines = [];
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && fmt(hours[order[j + 1]]) === fmt(hours[order[i]])) j++;
    lines.push((j > i ? label(order[i]) + ' a ' + label(order[j]) : label(order[i])) + ': ' + fmt(hours[order[i]]));
    i = j + 1;
  }
  return lines;
}

module.exports = { getClinic, saveClinic, serviceNames, hoursLines };
