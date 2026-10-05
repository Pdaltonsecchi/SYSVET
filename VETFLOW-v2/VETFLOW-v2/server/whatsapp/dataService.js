'use strict';

const db = require('../db');
const U = require('../util');
const T = require('./text');

const fullName = (f, l) => (String(f || '') + ' ' + String(l || '')).trim();

/** Cliente (dueño) dueño de este número de WhatsApp. Se compara el teléfono normalizado (con o sin 0, 15, +54 9). */
async function findClientByPhone(waFrom) {
  const canon = T.canonPhone(waFrom);
  if (!canon) return null;
  const r = await db.query("SELECT id, first_name, last_name, phone FROM clients WHERE phone_norm <> '' AND right(phone_norm, 8) = $1 ORDER BY id", [canon.slice(-8)]);
  const c = r.rows.find((x) => T.canonPhone(x.phone) === canon);
  return c ? { id: c.id, first: c.first_name, last: c.last_name, name: fullName(c.first_name, c.last_name), phone: c.phone } : null;
}

async function petsOfClient(clientId) {
  const r = await db.query('SELECT id, name, species FROM patients WHERE client_id = $1 AND deleted_at IS NULL ORDER BY id', [clientId]);
  return r.rows;
}

/** Datos de un paciente, solo si pertenece a ese cliente. */
async function petOfClient(patientId, clientId) {
  const r = await db.query('SELECT id, name, species FROM patients WHERE id = $1 AND client_id = $2 AND deleted_at IS NULL', [patientId, clientId]);
  return r.rows[0] || null;
}

/** Alta de cliente y/o mascota al confirmar un turno de alguien nuevo. Todo junto o nada. */
async function createPet(o) {
  return db.tx(async (c) => {
    let clientId = o.clientId;
    let ownerName;
    if (!clientId) {
      const ph = U.optPhone('+' + o.phone);
      const r = await c.query('INSERT INTO clients (first_name, last_name, phone, phone_norm, address) VALUES ($1,$2,$3,$4,$5) RETURNING id', [
        o.first, o.last, ph.phone, ph.norm, o.address || '',
      ]);
      clientId = r.rows[0].id;
      ownerName = fullName(o.first, o.last);
    } else {
      const r = await c.query('SELECT first_name, last_name FROM clients WHERE id = $1', [clientId]);
      ownerName = fullName(r.rows[0].first_name, r.rows[0].last_name);
    }
    const p = await c.query(
      "INSERT INTO patients (name, species, sex, owner_name, phone, email, notes, phone_norm, client_id) VALUES ($1,$2,$3,$4,'','','Alta por WhatsApp','',$5) RETURNING id",
      [o.petName, o.species, o.sex, ownerName, clientId]
    );
    return { clientId, patientId: p.rows[0].id };
  });
}

/** Historia resumida de una mascota para contestarle al dueño. */
async function petHistory(patientId) {
  const [v, d, m, w] = await Promise.all([
    db.query('SELECT name, applied_on, next_on FROM vaccines WHERE patient_id = $1 AND deleted_at IS NULL ORDER BY applied_on DESC, id DESC LIMIT 8', [patientId]),
    db.query('SELECT on_date, title FROM diagnoses WHERE patient_id = $1 AND deleted_at IS NULL ORDER BY on_date DESC, id DESC LIMIT 3', [patientId]),
    db.query('SELECT on_date, name, dose, duration FROM medications WHERE patient_id = $1 AND deleted_at IS NULL ORDER BY on_date DESC, id DESC LIMIT 5', [patientId]),
    db.query('SELECT fecha, kg FROM weights WHERE patient_id = $1 ORDER BY fecha DESC, id DESC LIMIT 3', [patientId]),
  ]);
  return { vaccines: v.rows, consults: d.rows, meds: m.rows, weights: w.rows };
}

module.exports = { fullName, findClientByPhone, petsOfClient, petOfClient, createPet, petHistory };
