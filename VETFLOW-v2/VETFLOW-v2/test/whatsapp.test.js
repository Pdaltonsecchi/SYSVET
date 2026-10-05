'use strict';
// Pruebas del chatbot de WhatsApp. Usan una base de datos REAL de pruebas (se vacía al empezar):
//   TEST_DATABASE_URL=postgres://... DATABASE_SSL=false npm test
// Sin TEST_DATABASE_URL solo corren las pruebas de interpretación de texto.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const T = require('../server/whatsapp/text');

test('texto: fechas, horas, opciones y teléfonos', () => {
  const today = '2026-10-05'; // lunes
  assert.equal(T.parseDate('mañana', today), '2026-10-06');
  assert.equal(T.parseDate('el viernes', today), '2026-10-09');
  assert.equal(T.parseDate('lunes', today), '2026-10-12');
  assert.equal(T.parseDate('15/10', today), '2026-10-15');
  assert.equal(T.parseDate('1/3', today), '2027-03-01');
  assert.equal(T.parseDate('el 20 de octubre', today), '2026-10-20');
  assert.equal(T.parseDate('31/02', today), null);
  assert.equal(T.parseTime('martes 10:20'), '10:20');
  assert.equal(T.parseTime('a las 15'), '15:00');
  assert.equal(T.parseTime('hola'), null);
  assert.equal(T.parseChoice('2️⃣', 3), 2);
  assert.equal(T.parseChoice('opcion 3', 3), 3);
  assert.equal(T.parseChoice('5', 3), null);
  assert.equal(T.parseYesNo('Sí!'), 'yes');
  assert.equal(T.parseYesNo('no gracias'), 'no');
  assert.equal(T.parseYesNo('tal vez'), null);
  for (const raw of ['5491112345678', '+54 9 11 1234-5678', '011 15 1234 5678', '(011) 1234-5678', '1112345678']) assert.equal(T.canonPhone(raw), '1112345678', raw);
  assert.equal(T.canonPhone('1234'), null);
  assert.equal(T.waNumber('11 1234 5678'), '5491112345678');
});

const URL = process.env.TEST_DATABASE_URL;
test('chatbot de punta a punta', { skip: !URL && 'falta TEST_DATABASE_URL' }, async (t) => {
  process.env.DATABASE_URL = URL;
  process.env.WHATSAPP_RATE_LIMIT = '1000';
  const db = require('../server/db');
  const U = require('../server/util');
  const WS = require('../server/whatsapp/whatsappService');
  const W = require('../server/whatsapp');
  const clinic = require('../server/whatsapp/clinic');
  const reminders = require('../server/whatsapp/reminderService');
  const sessions = require('../server/whatsapp/sessionService');
  t.after(() => db.close());

  await db.migrate();
  await db.query('TRUNCATE chat_logs, chat_sessions, whatsapp_reminders, appointments, vaccines, patients, clients, clinic_settings, services RESTART IDENTITY CASCADE');
  const open = [['09:00', '19:00']];
  await clinic.saveClinic({
    address: 'Calle Principal 123, Buenos Aires', phone: '+54 11 4000-0000', vet: 'Dra. Pérez',
    hours: { 0: [], 1: open, 2: open, 3: open, 4: open, 5: open, 6: [['10:00', '14:00']] },
  });
  await db.query("INSERT INTO services (name, category, price) VALUES ('Consulta general','Consultas',1000),('Vacuna Séxtuple','Vacunas',500)");
  const cl = await db.query("INSERT INTO clients (first_name,last_name,phone,phone_norm) VALUES ('Juan','Pérez','11 2345-6789','1123456789') RETURNING id");
  const clientId = cl.rows[0].id;
  const today = T.nowAR().date;
  const pet = await db.query("INSERT INTO patients (name,species,sex,owner_name,client_id) VALUES ('Firulais','Perro','Macho','Juan Pérez',$1) RETURNING id", [clientId]);
  const petId = pet.rows[0].id;
  await db.query('INSERT INTO vaccines (patient_id,name,applied_on,next_on) VALUES ($1,$2,$3,$4)', [petId, 'Séxtuple', U.addDays(today, -300), U.addDays(today, 7)]);

  const sent = [];
  const send = async (to, text) => { sent.push({ to, text }); return 'wamid.out' + sent.length; };
  let n = 0;
  const say = async (from, text) => {
    sent.length = 0;
    await W.processMessage({ id: 'wamid.in' + ++n + Math.random(), from, name: 'Test', type: 'text', text }, send);
    return sent.map((s) => s.text).join('\n---\n');
  };
  const JUAN = '5491123456789';

  await t.test('saluda y muestra el menú', async () => {
    const r = await say(JUAN, 'Hola');
    assert.match(r, /Bienvenido a/);
    assert.match(r, /Sacar un turno/);
  });

  await t.test('informa dirección y horarios', async () => {
    const r = await say(JUAN, '¿Cuál es la dirección?');
    assert.match(r, /Calle Principal 123/);
    assert.match(r, /Lunes a Viernes: 09:00-19:00/);
    assert.match(r, /Sábado: 10:00-14:00/);
    assert.match(r, /Domingo: Cerrado/);
    assert.match(r, /4000-0000/);
    assert.match(await say(JUAN, 'aceptan tarjeta?'), /Tarjeta de crédito/);
    assert.match(await say(JUAN, 'que servicios tienen'), /Vacuna Séxtuple/);
  });

  await t.test('cliente existente saca turno de vacuna y queda en el calendario', async () => {
    let r = await say(JUAN, 'Quiero un turno para vacunar');
    assert.match(r, /próximos turnos disponibles/);
    r = await say(JUAN, '1');
    assert.match(r, /Mascota: Firulais/);
    assert.match(r, /Servicio: Vacunación/);
    r = await say(JUAN, 'sí');
    assert.match(r, /Número de turno: #(\d+)/);
    const id = Number(r.match(/#(\d+)/)[1]);
    const a = (await db.query('SELECT * FROM appointments WHERE id = $1', [id])).rows[0];
    assert.equal(a.patient_id, petId);
    assert.equal(a.appointment_type, 'vacuna');
    assert.equal(a.source, 'whatsapp');
    assert.equal(a.duration_min, 10);
  });

  await t.test('no ofrece horarios ocupados ni permite doble reserva', async () => {
    const S = require('../server/whatsapp/scheduleService');
    const row = (await db.query("SELECT to_char(appointment_date,'YYYY-MM-DD') AS d, left(appointment_time::text,5) AS t FROM appointments")).rows[0];
    assert.ok(!(await S.slotsForDate(row.d, 'vacuna')).includes(row.t));
    assert.equal(await S.book({ patientId: petId, type: 'vacuna', date: row.d, time: row.t }), null);
    // dos reservas simultáneas del mismo horario: solo una gana
    const free = (await S.slotsForDate(U.addDays(row.d, 1), 'consulta'))[0];
    const rs = await Promise.all([1, 2, 3].map(() => S.book({ patientId: petId, type: 'consulta', date: U.addDays(row.d, 1), time: free })));
    assert.equal(rs.filter(Boolean).length, 1);
    await db.query("DELETE FROM appointments WHERE appointment_type = 'consulta'");
    await say(JUAN, 'menu');
  });

  await t.test('reprograma y cancela', async () => {
    const before = (await db.query('SELECT id, appointment_date d, appointment_time t FROM appointments')).rows[0];
    let r = await say(JUAN, 'Necesito cambiar mi turno');
    assert.match(r, /Encontré tu turno/);
    assert.match(r, new RegExp('#' + before.id));
    r = await say(JUAN, 'viernes');
    assert.match(r, /Horarios disponibles para el viernes/);
    r = await say(JUAN, '1');
    assert.match(r, /Turno reprogramado/);
    const after = (await db.query('SELECT id, appointment_date d, appointment_time t FROM appointments WHERE id = $1', [before.id])).rows[0];
    assert.ok(after, 'conserva el número de turno');
    r = await say(JUAN, 'quiero cancelar el turno');
    assert.match(r, /motivo/);
    r = await say(JUAN, 'me surgió un viaje');
    assert.match(r, /cancelado/);
    assert.equal((await db.query('SELECT 1 FROM appointments')).rowCount, 0);
  });

  await t.test('consulta médica deriva al veterinario; urgencias avisan', async () => {
    let r = await say(JUAN, 'mi perro vomita desde ayer');
    assert.match(r, /Llamar al veterinario: \+54 11 4000-0000/);
    assert.match(r, /turno de consulta/);
    r = await say(JUAN, '2');
    assert.match(r, /no dudes/);
    assert.match(await say(JUAN, 'se envenenó mi gato'), /urgencia/);
    await say(JUAN, 'menu');
  });

  await t.test('historial de la mascota (solo para el dueño)', async () => {
    const r = await say(JUAN, 'cuando fue la ultima vacuna de Firulais');
    assert.match(r, /La última vacuna de Firulais fue el/);
    assert.match(r, /Tipo: Séxtuple/);
    assert.match(r, /vence pronto/);
    assert.match(r, /agendar el turno ahora/);
    await say(JUAN, '2');
    assert.match(await say('5491100000001', 'cuando fue la ultima vacuna de Firulais'), /No encontré tu número/);
  });

  await t.test('cliente nuevo: se registra al confirmar', async () => {
    const NEW = '5491199998888';
    await say(NEW, 'hola quiero agendar un turno');
    let r = await say(NEW, '1');
    assert.match(r, /nombre de tu perro\/gato/);
    r = await say(NEW, 'luna');
    assert.match(r, /perro o gato/);
    r = await say(NEW, 'gato');
    assert.match(r, /macho o hembra/);
    r = await say(NEW, 'hembra');
    assert.match(r, /nombre y apellido/);
    assert.equal((await db.query("SELECT 1 FROM clients WHERE phone_norm LIKE '%99998888'")).rowCount, 0);
    r = await say(NEW, 'Ana María López');
    assert.match(r, /dirección/);
    r = await say(NEW, 'no');
    assert.match(r, /próximos turnos/);
    r = await say(NEW, '2');
    assert.match(r, /Mascota: Luna/);
    assert.match(r, /Cliente: Ana María López/);
    r = await say(NEW, '1');
    assert.match(r, /Turno confirmado/);
    const c = (await db.query("SELECT first_name, last_name FROM clients WHERE phone_norm LIKE '%99998888'")).rows[0];
    assert.deepEqual(c, { first_name: 'Ana María', last_name: 'López' });
    const p = (await db.query("SELECT name, species, sex FROM patients WHERE name = 'Luna'")).rows[0];
    assert.deepEqual(p, { name: 'Luna', species: 'Gato', sex: 'Hembra' });
  });

  await t.test('mensajes repetidos por Meta no se procesan dos veces', async () => {
    sent.length = 0;
    const m = { id: 'wamid.dup', from: JUAN, type: 'text', text: 'hola' };
    await W.processMessage(m, send);
    const first = sent.length;
    await W.processMessage(m, send);
    assert.equal(sent.length, first);
  });

  await t.test('recordatorios de vacunas: 7 días antes y después del vencimiento, sin duplicar', async () => {
    await db.query('DELETE FROM appointments');
    await db.query('DELETE FROM whatsapp_reminders');
    await db.query('UPDATE vaccines SET next_on = $1', [U.addDays(today, 7)]);
    const out = [];
    const rsend = async (to, text) => { out.push({ to, text }); };
    await reminders.enqueue();
    await reminders.enqueue();
    // fuera de horario (9 a 20 h) el aviso queda pendiente, así que fuerzo la hora para la prueba
    await reminders.sendDue(rsend).catch(() => {});
    const row = (await db.query("SELECT status FROM whatsapp_reminders WHERE kind = 'vaccine_before'")).rows;
    assert.equal(row.length, 1);
    const hour = Number(new Date().toLocaleString('en-GB', { timeZone: U.TZ, hour: '2-digit', hour12: false }));
    if (hour >= 9 && hour <= 20) {
      assert.equal(out.length, 1);
      assert.match(out[0].text, /vence en 7 días/);
      assert.equal(out[0].to, JUAN);
      assert.match(await say(JUAN, '1'), /próximos turnos/);
      await say(JUAN, 'menu');
    } else assert.equal(row[0].status, 'pending');
    // vencida
    await db.query('UPDATE vaccines SET next_on = $1', [U.addDays(today, -3)]);
    await reminders.enqueue();
    assert.equal((await db.query("SELECT 1 FROM whatsapp_reminders WHERE kind = 'vaccine_after'")).rowCount, 1);
    // renovada: ya no corresponde avisar
    await db.query("INSERT INTO vaccines (patient_id,name,applied_on,next_on) VALUES ($1,'Séxtuple',$2,$3)", [petId, today, U.addDays(today, 365)]);
    await db.query("DELETE FROM whatsapp_reminders");
    await reminders.enqueue();
    assert.equal((await db.query('SELECT 1 FROM whatsapp_reminders')).rowCount, 0);
  });

  await t.test('recordatorio de turno 24 h: confirma asistencia', async () => {
    const soon = new Date(Date.now() + 23.5 * 3600 * 1000);
    const d = soon.toLocaleDateString('en-CA', { timeZone: U.TZ });
    const tm = soon.toLocaleTimeString('en-GB', { timeZone: U.TZ, hour: '2-digit', minute: '2-digit' });
    const ap = await db.query("INSERT INTO appointments (patient_id,title,appointment_date,appointment_time,appointment_type,duration_min) VALUES ($1,'Consulta',$2,$3,'consulta',20) RETURNING id", [petId, d, tm]);
    const out = [];
    await reminders.enqueue();
    await reminders.sendDue(async (to, text) => { out.push(text); });
    assert.equal(out.length, 1);
    assert.match(out[0], /Confirmás que vas a asistir/);
    assert.match(await say(JUAN, '1'), /Quedó confirmado/);
    assert.ok((await db.query('SELECT confirmed_at FROM appointments WHERE id = $1', [ap.rows[0].id])).rows[0].confirmed_at);
    await reminders.enqueue();
    assert.equal((await db.query("SELECT 1 FROM whatsapp_reminders WHERE kind = 'appt_2h'")).rowCount, 0);
  });

  await t.test('todo queda registrado en chat_logs', async () => {
    const r = await db.query("SELECT count(*)::int AS n FROM chat_logs WHERE direction = 'incoming'");
    assert.ok(r.rows[0].n > 20);
    const logs = await sessions.recentLogs(JUAN, 5);
    assert.ok(logs.length);
  });

  await t.test('límite de mensajes por número', async () => {
    const cfg = require('../server/whatsapp/config');
    cfg.rateLimitPerMin = 3;
    sent.length = 0;
    for (let i = 0; i < 6; i++) await W.processMessage({ id: 'wamid.rl' + i, from: '5491155550000', type: 'text', text: 'hola' }, send);
    assert.equal(sent.length, 3);
    cfg.rateLimitPerMin = 1000;
  });

  await t.test('la firma de Meta se valida', () => {
    const cfg = require('../server/whatsapp/config');
    const body = Buffer.from('{"a":1}');
    assert.equal(WS.verifySignature(body, 'sha256=00'), cfg.appSecret ? false : !cfg.prod);
    cfg.appSecret = 'secreto';
    const good = 'sha256=' + crypto.createHmac('sha256', 'secreto').update(body).digest('hex');
    assert.equal(WS.verifySignature(body, good), true);
    assert.equal(WS.verifySignature(body, 'sha256=' + '0'.repeat(64)), false);
    assert.equal(WS.verifySignature(body, undefined), false);
    cfg.appSecret = '';
  });
});
