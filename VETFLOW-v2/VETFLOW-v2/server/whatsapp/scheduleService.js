'use strict';

const db = require('../db');
const U = require('../util');
const T = require('./text');
const { getClinic } = require('./clinic');

const LEAD_MIN = 120; // el bot no ofrece turnos para dentro de menos de 2 horas
const HORIZON_DAYS = 28;
const LOCK_KEY = 7101; // candado para que dos clientes no tomen el mismo horario a la vez

const SERVICE_LABEL = { consulta: 'Consulta', vacuna: 'Vacunación' };
const startTs = "((a.appointment_date + a.appointment_time) AT TIME ZONE '" + U.TZ + "')";

async function busyOn(q, date, exceptId) {
  const r = await q.query(
    'SELECT appointment_time, duration_min FROM appointments WHERE appointment_date = $1 AND id <> $2',
    [date, exceptId || 0]
  );
  return r.rows.map((x) => {
    const s = T.toMin(String(x.appointment_time));
    return [s, s + x.duration_min];
  });
}

/** Horarios libres ('HH:MM') de un día para un tipo de turno, según el horario de atención y la agenda. */
async function slotsForDate(date, type, o) {
  o = o || {};
  const clinic = o.clinic || (await getClinic());
  if (!clinic.hours) return [];
  const ranges = clinic.hours[T.weekday(date)] || [];
  const dur = U.APPT_DURATIONS[type] || 30;
  const now = T.nowAR();
  if (date < now.date) return [];
  const busy = await busyOn(db, date, o.exceptId);
  const out = [];
  for (const [open, close] of ranges) {
    for (let s = T.toMin(open); s + dur <= T.toMin(close); s += dur) {
      if (date === now.date && s < now.minutes + LEAD_MIN) continue;
      if (busy.some(([a, b]) => s < b && a < s + dur)) continue;
      out.push(T.fromMin(s));
    }
  }
  return out;
}

/** Elige hasta `n` horarios repartidos a lo largo del día (primero, medio, último...). */
function spread(list, n) {
  if (list.length <= n) return list;
  const out = [];
  for (let i = 0; i < n; i++) out.push(list[Math.round((i * (list.length - 1)) / (n - 1))]);
  return out;
}

/** Próximos días con turnos libres: [{ date, slots:[...] }] (hasta `days` días, `perDay` horarios por día). */
async function nextSlots(type, from, o) {
  o = o || {};
  const clinic = await getClinic();
  const out = [];
  for (let i = 0; i < HORIZON_DAYS && out.length < (o.days || 3); i++) {
    const date = U.addDays(from, i);
    const free = await slotsForDate(date, type, { clinic, exceptId: o.exceptId });
    if (free.length) out.push({ date, slots: spread(free, o.perDay || 3), free });
  }
  return out;
}

/** Crea el turno si el horario sigue libre. Devuelve { id } o null si alguien lo tomó mientras tanto. */
async function book(o) {
  return db.tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
    const dur = U.APPT_DURATIONS[o.type] || 30;
    const s = T.toMin(o.time);
    if ((await busyOn(c, o.date)).some(([a, b]) => s < b && a < s + dur)) return null;
    const r = await c.query(
      'INSERT INTO appointments (patient_id, title, description, appointment_date, appointment_time, appointment_type, duration_min, source) ' +
        "VALUES ($1,$2,'Pedido por WhatsApp',$3,$4,$5,$6,'whatsapp') RETURNING id",
      [o.patientId, SERVICE_LABEL[o.type] || 'Turno', o.date, o.time + ':00', o.type, dur]
    );
    return { id: r.rows[0].id };
  });
}

/** Cambia fecha y hora del turno (conserva el número). Borra los avisos programados para que se generen de nuevo. */
async function reschedule(id, date, time) {
  return db.tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
    const cur = await c.query('SELECT appointment_type, duration_min FROM appointments WHERE id = $1 FOR UPDATE', [id]);
    if (!cur.rows[0]) return { error: 'missing' };
    const s = T.toMin(time);
    const dur = cur.rows[0].duration_min;
    if ((await busyOn(c, date, id)).some(([a, b]) => s < b && a < s + dur)) return { error: 'taken' };
    await c.query('UPDATE appointments SET appointment_date = $2, appointment_time = $3, confirmed_at = NULL WHERE id = $1', [id, date, time + ':00']);
    await c.query('DELETE FROM whatsapp_reminders WHERE appointment_id = $1', [id]);
    return { ok: true };
  });
}

async function cancel(id) {
  const r = await db.query('DELETE FROM appointments WHERE id = $1', [id]); // los avisos pendientes se borran en cascada
  return r.rowCount > 0;
}

async function confirm(id) {
  await db.query('UPDATE appointments SET confirmed_at = now() WHERE id = $1', [id]);
}

const mapAppt = (r) => ({
  id: r.id,
  patientId: r.patient_id,
  petName: r.pet_name,
  type: r.appointment_type,
  date: r.appointment_date,
  time: String(r.appointment_time).slice(0, 5),
  confirmed: !!r.confirmed_at,
});

/** Turnos futuros de un cliente (por sus mascotas), del más próximo al más lejano. */
async function upcomingForClient(clientId) {
  const now = T.nowAR();
  const r = await db.query(
    'SELECT a.id, a.patient_id, p.name AS pet_name, a.appointment_type, a.appointment_date, a.appointment_time, a.confirmed_at ' +
      'FROM appointments a JOIN patients p ON p.id = a.patient_id ' +
      'WHERE p.client_id = $1 AND p.deleted_at IS NULL AND (a.appointment_date, a.appointment_time) >= ($2::date, $3::time) ' +
      'ORDER BY a.appointment_date, a.appointment_time, a.id LIMIT 10',
    [clientId, now.date, T.fromMin(now.minutes) + ':00']
  );
  return r.rows.map(mapAppt);
}

/** Un turno puntual, solo si es del cliente indicado (así nadie ve ni toca turnos ajenos). */
async function getForClient(id, clientId) {
  const r = await db.query(
    'SELECT a.id, a.patient_id, p.name AS pet_name, a.appointment_type, a.appointment_date, a.appointment_time, a.confirmed_at ' +
      'FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.id = $1 AND p.client_id = $2 AND p.deleted_at IS NULL',
    [id, clientId]
  );
  return r.rows[0] ? mapAppt(r.rows[0]) : null;
}

module.exports = { SERVICE_LABEL, startTs, spread, slotsForDate, nextSlots, book, reschedule, cancel, confirm, upcomingForClient, getForClient };
