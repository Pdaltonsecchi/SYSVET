'use strict';

const db = require('../db');
const U = require('../util');
const T = require('./text');
const cfg = require('./config');
const WS = require('./whatsappService');
const sessions = require('./sessionService');
const { M } = require('./messages');
const { getClinic } = require('./clinic');
const { startTs } = require('./scheduleService');

const TICK_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;
// Los avisos de vacunas solo salen en horario razonable (9 a 20 h de Argentina). Los de turnos salen siempre.
const QUIET_SQL = "(kind LIKE 'appt%' OR extract(hour FROM now() AT TIME ZONE '" + U.TZ + "') BETWEEN 9 AND 20)";

/** Genera los avisos que corresponden ahora. Es seguro correrlo muchas veces: cada aviso tiene una clave única. */
async function enqueue() {
  const today = T.nowAR().date;
  // Vacunas: del día del vencimiento hasta 7 días antes, y hasta 30 días después de vencida. Se saltean las ya renovadas
  // (hay una aplicación posterior del mismo nombre) y las que ya tienen un turno de vacuna agendado.
  await db.query(
    `INSERT INTO whatsapp_reminders (kind, client_id, patient_id, vaccine_id, dedupe_key, scheduled_for)
     SELECT CASE WHEN v.next_on >= $1::date THEN 'vaccine_before' ELSE 'vaccine_after' END, p.client_id, p.id, v.id,
            CASE WHEN v.next_on >= $1::date THEN 'vb:' ELSE 'va:' END || v.id, now()
     FROM vaccines v JOIN patients p ON p.id = v.patient_id JOIN clients c ON c.id = p.client_id
     WHERE v.deleted_at IS NULL AND p.deleted_at IS NULL AND c.phone_norm <> '' AND v.next_on IS NOT NULL
       AND v.next_on BETWEEN $1::date - 30 AND $1::date + 7
       AND NOT EXISTS (SELECT 1 FROM vaccines v2 WHERE v2.patient_id = v.patient_id AND v2.deleted_at IS NULL AND lower(v2.name) = lower(v.name)
                       AND (v2.applied_on, v2.id) > (v.applied_on, v.id))
       AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.appointment_type = 'vacuna' AND a.appointment_date >= $1::date)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [today]
  );
  // Turnos: el aviso de 24 h sale en las 3 horas siguientes a "faltan 24 h" (un turno sacado con menos anticipación no lo recibe);
  // el de 2 h solo si el cliente todavía no confirmó.
  const apptSql = (kind, key, from, to, extra) =>
    `INSERT INTO whatsapp_reminders (kind, client_id, patient_id, appointment_id, dedupe_key, scheduled_for)
     SELECT '${kind}', p.client_id, p.id, a.id,
            '${key}:' || a.id || ':' || to_char(a.appointment_date, 'YYYYMMDD') || replace(left(a.appointment_time::text, 5), ':', ''), now()
     FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN clients c ON c.id = p.client_id
     WHERE p.deleted_at IS NULL AND c.phone_norm <> '' AND ${startTs} - interval '${from}' <= now() AND ${startTs} - interval '${to}' > now() ${extra}
     ON CONFLICT (dedupe_key) DO NOTHING`;
  await db.query(apptSql('appt_24h', 'a24', '24 hours', '21 hours', ''));
  await db.query(apptSql('appt_2h', 'a2', '2 hours', '30 minutes', 'AND a.confirmed_at IS NULL'));
}

async function finish(id, status, error) {
  await db.query('UPDATE whatsapp_reminders SET status = $2, last_error = $3, sent_at = CASE WHEN $2 = \'sent\' THEN now() ELSE sent_at END WHERE id = $1', [id, status, error || '']);
}

/** Texto, plantilla y estado de conversación de un aviso, o null si ya no corresponde enviarlo. */
async function build(rem) {
  const clinic = await getClinic();
  if (rem.kind.startsWith('vaccine')) {
    const r = await db.query(
      'SELECT v.name, v.next_on, v.deleted_at, p.id AS pid, p.name AS pet, p.species, p.deleted_at AS pdel, c.id AS cid, c.first_name, c.last_name, c.phone ' +
        'FROM vaccines v JOIN patients p ON p.id = v.patient_id JOIN clients c ON c.id = p.client_id WHERE v.id = $1',
      [rem.vaccine_id]
    );
    const v = r.rows[0];
    if (!v || v.deleted_at || v.pdel || !v.next_on) return null;
    const today = T.nowAR().date;
    const days = Math.round((new Date(v.next_on + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 86400000);
    const o = { owner: v.first_name, petName: v.pet, next: v.next_on, days: Math.max(days, 0) };
    const after = rem.kind === 'vaccine_after';
    return {
      phone: v.phone,
      clientId: v.cid,
      text: after ? M.vaccineAfter(o) : M.vaccineBefore(o),
      params: [v.first_name, v.pet, T.fmtDateLong(v.next_on)],
      state: 'vaccine_offer',
      context: { opts: 'yin', patientId: v.pid, petName: v.pet, species: v.species },
    };
  }
  const r = await db.query(
    'SELECT a.id, a.appointment_date, a.appointment_time, a.confirmed_at, p.name AS pet, c.id AS cid, c.first_name, c.last_name, c.phone ' +
      'FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN clients c ON c.id = p.client_id WHERE a.id = $1',
    [rem.appointment_id]
  );
  const a = r.rows[0];
  if (!a || (rem.kind === 'appt_2h' && a.confirmed_at)) return null;
  const time = String(a.appointment_time).slice(0, 5);
  return {
    phone: a.phone,
    clientId: a.cid,
    text: M.apptReminder(rem.kind, { owner: a.first_name, petName: a.pet, date: a.appointment_date, time, clinic }),
    params: [a.first_name, a.pet, T.fmtDate(a.appointment_date), time],
    state: 'appt_confirm',
    context: { apptId: a.id },
  };
}

async function sendOne(rem, send) {
  const b = await build(rem);
  if (!b) return finish(rem.id, 'cancelled', 'Ya no corresponde');
  const to = T.waNumber(b.phone);
  if (!to) return finish(rem.id, 'failed', 'El teléfono del cliente no es válido para WhatsApp');
  try {
    const tpl = cfg.templates[rem.kind];
    await (send ? send(to, b.text) : tpl ? WS.sendTemplate(to, tpl, b.params) : WS.sendText(to, b.text));
  } catch (e) {
    const last = rem.attempts >= MAX_ATTEMPTS;
    console.error('Aviso de WhatsApp #' + rem.id + ' (intento ' + rem.attempts + '):', e.message);
    if (last) return finish(rem.id, 'failed', e.message.slice(0, 300));
    return db.query("UPDATE whatsapp_reminders SET last_error = $2, scheduled_for = now() + ($3 || ' minutes')::interval WHERE id = $1", [rem.id, e.message.slice(0, 300), String(10 * rem.attempts)]);
  }
  await finish(rem.id, 'sent');
  // La respuesta del cliente ("1", "sí"...) se interpreta según el aviso que recibió.
  await sessions.setState(to, b.clientId, b.state, b.context);
  const s = await sessions.getSession(to);
  s.clientId = b.clientId;
  await sessions.logMessage(s, 'outgoing', b.text, { type: 'reminder' });
}

/** Envía los avisos pendientes que ya les toca. */
async function sendDue(send) {
  const r = await db.query(
    `UPDATE whatsapp_reminders SET attempts = attempts + 1 WHERE id IN (
       SELECT id FROM whatsapp_reminders WHERE status = 'pending' AND scheduled_for <= now() AND attempts < ${MAX_ATTEMPTS} AND ${QUIET_SQL}
       ORDER BY scheduled_for LIMIT 25 FOR UPDATE SKIP LOCKED) RETURNING *`
  );
  for (const rem of r.rows) {
    try {
      await sendOne(rem, send);
    } catch (e) {
      console.error('Aviso de WhatsApp #' + rem.id + ':', e.message);
    }
  }
  return r.rowCount;
}

let running = false;
async function tick(send) {
  if (running) return;
  running = true;
  try {
    await enqueue();
    await sendDue(send);
  } catch (e) {
    console.error('Recordatorios de WhatsApp:', e.message);
  } finally {
    running = false;
  }
}

function start() {
  if (!WS.configured() || !cfg.remindersEnabled) return;
  setTimeout(() => tick(), 30 * 1000).unref();
  setInterval(() => tick(), TICK_MS).unref();
  console.log('Recordatorios de WhatsApp activados (cada ' + TICK_MS / 60000 + ' minutos).');
}

module.exports = { enqueue, sendDue, tick, start };
