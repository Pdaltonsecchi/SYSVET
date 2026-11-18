'use strict';
// Etapa 3: origen web de clientes y mascotas, reporte de clientes que hace mucho no vienen, enlace de reseñas y
// turnos rechazados a la vista del cliente. Contra el servidor real con la base de prueba.
const test = require('node:test');
const assert = require('node:assert/strict');
if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL para correr las pruebas.');
  process.exit(1);
}
process.env.DATABASE_SSL = 'false';
const { ENV, startServer, client } = require('./helpers');
// La base se usa directo solo para poner fechas viejas (no hay otra forma de simular "hace 5 meses").
const db = require('../server/db');

let child;
const owner = client();
const staff = client();
const pub = (token) => ({
  call: (method, path, body) => client().call(method, '/public' + path, body, token ? { 'X-Cliente-Token': token } : {}),
});
const n8 = () => '4' + String(Math.floor(1000000 + Math.random() * 8999999));
const tel = () => '11 ' + n8();
const tag = String(Date.now()).slice(-6); // para reconocer los datos de esta corrida
let today = '';
const day = (offset) => {
  const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) + offset, 12));
  return d.toISOString().slice(0, 10);
};

// Cliente + mascota cargados por la veterinaria. Devuelve { clientId, petId }.
async function interno(apellido, phone) {
  const r = await owner.call('POST', '/patients', {
    name: 'Mascota ' + apellido, species: 'Perro', breed: '', sex: 'Macho', neutered: false, birth: '', weight: '', notes: '',
    client: { firstName: 'Cliente', lastName: apellido + ' ' + tag, phone: phone || tel(), email: '', address: '' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const p = (await owner.call('GET', '/patients/' + r.data.id)).data;
  return { clientId: p.clientId, petId: r.data.id };
}
// Cliente + mascota que se registran solos desde la página. Devuelve { clientId, petId, token }.
async function web(apellido) {
  const r = await pub().call('POST', '/register', { firstName: 'Web', lastName: apellido + ' ' + tag, phone: tel(), pet: { name: 'Mascota ' + apellido, species: 'Gato', sex: 'Hembra' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { clientId: r.data.client.id, petId: r.data.pets[0].id, token: r.data.token };
}
const antiguo = (clientId, dias) => db.query("UPDATE clients SET created_at = now() - ($2 || ' days')::interval WHERE id = $1", [clientId, String(dias)]);
const diagnostico = async (petId, offset) => {
  const r = await owner.call('POST', '/patients/' + petId + '/diagnoses', { date: day(offset), title: 'Control', notes: '' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
};
const inactivos = async (months) => (await owner.call('GET', '/reports/inactive-clients' + (months ? '?months=' + months : ''))).data;

test.before(async () => {
  child = await startServer();
  assert.equal((await owner.login(ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD)).status, 200);
  await owner.call('POST', '/users', { name: 'Ayudante E3', email: 'ayudante-e3@test.com', password: 'otra-clave-123', role: 'staff' });
  assert.equal((await staff.login('ayudante-e3@test.com', 'otra-clave-123')).status, 200);
  today = (await inactivos()).today;
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
});
test.after(async () => {
  if (child) child.kill();
  await db.close();
});

/* ---------- Pedido 1: creados desde la página web ---------- */
test('el alta desde la página marca cliente y mascota como "web"; el alta interna, como "sistema"', async () => {
  const w = await web('Origen');
  const i = await interno('Origen');
  const boot = (await owner.call('GET', '/bootstrap')).data;
  const cw = boot.clients.find((c) => c.id === w.clientId);
  const ci = boot.clients.find((c) => c.id === i.clientId);
  const pw = boot.patients.find((p) => p.id === w.petId);
  const pi = boot.patients.find((p) => p.id === i.petId);
  assert.equal(cw.source, 'web');
  assert.equal(pw.source, 'web');
  assert.equal(cw.webNew, true, 'cliente web sin visitas: resaltado');
  assert.equal(pw.webNew, true, 'mascota web sin visitas: resaltada');
  assert.equal(cw.createdOn, today);
  assert.equal(pw.createdOn, today);
  assert.equal(ci.source, 'sistema');
  assert.equal(pi.source, 'sistema');
  assert.equal(ci.webNew, false);
  assert.equal(pi.webNew, false);
  // Las fichas individuales traen lo mismo.
  assert.equal((await owner.call('GET', '/clients/' + w.clientId)).data.source, 'web');
  assert.equal((await owner.call('GET', '/patients/' + w.petId)).data.webNew, true);
  // Otra mascota agregada desde la página también queda marcada.
  const mas = await pub(w.token).call('POST', '/pets', { pet: { name: 'Segunda', species: 'Perro', sex: 'Macho' } });
  const segunda = mas.data.pets.find((p) => p.name === 'Segunda').id;
  assert.equal((await owner.call('GET', '/patients/' + segunda)).data.source, 'web');
  // Una mascota que la veterinaria le agrega a ese cliente es "sistema".
  const prop = await owner.call('POST', '/patients', { name: 'Tercera', species: 'Perro', breed: '', sex: 'Macho', neutered: false, birth: '', weight: '', notes: '', clientId: w.clientId });
  assert.equal(prop.status, 200, JSON.stringify(prop.data));
  assert.equal((await owner.call('GET', '/patients/' + prop.data.id)).data.source, 'sistema');
});

test('la etiqueta de origen queda, pero deja de resaltarse con la primera visita', async () => {
  const w = await web('Visita');
  // Un turno pendiente todavía no es una visita.
  const slots = (await pub().call('GET', '/slots?type=vacuna')).data.days;
  const pedido = await pub(w.token).call('POST', '/appointments', { type: 'vacuna', patientId: w.petId, date: slots[0].date, time: slots[0].times[0] });
  assert.equal(pedido.status, 200, JSON.stringify(pedido.data));
  assert.equal((await owner.call('GET', '/clients/' + w.clientId)).data.webNew, true);
  // Editar la ficha no saca la etiqueta ni el resaltado.
  const put = await owner.call('PUT', '/clients/' + w.clientId, { firstName: 'Web', lastName: 'Visita editado ' + tag, phone: tel(), email: '', address: 'Calle 1' });
  assert.equal(put.status, 200, JSON.stringify(put.data));
  let c = (await owner.call('GET', '/clients/' + w.clientId)).data;
  assert.equal(c.source, 'web');
  assert.equal(c.webNew, true);
  // Con una consulta cargada ya tuvo una visita.
  await diagnostico(w.petId, 0);
  c = (await owner.call('GET', '/clients/' + w.clientId)).data;
  const p = (await owner.call('GET', '/patients/' + w.petId)).data;
  assert.equal(c.source, 'web', 'el origen se mantiene');
  assert.equal(p.source, 'web');
  assert.equal(c.webNew, false, 'ya no se resalta');
  assert.equal(p.webNew, false);
});

/* ---------- Pedido 2: clientes que hace mucho no vienen ---------- */
test('reporte de inactivos: casos concretos', async () => {
  // A: vino ayer.
  const a = await interno('Activa');
  await antiguo(a.clientId, 400);
  await diagnostico(a.petId, -1);
  // B: última consulta hace 150 días (5 meses).
  const b = await interno('Cinco meses');
  await antiguo(b.clientId, 400);
  await diagnostico(b.petId, -150);
  // C: se anotó por la web hace 200 días y nunca vino.
  const c = await web('Nunca vino');
  await antiguo(c.clientId, 200);
  // D: inactivo hace 200 días, pero tiene un turno mañana.
  const d = await interno('Turno futuro');
  await antiguo(d.clientId, 400);
  await diagnostico(d.petId, -200);
  const turno = await owner.call('POST', '/appointments', { patientId: d.petId, title: 'Control', description: '', date: day(1), time: '10:00', type: 'consulta' });
  assert.equal(turno.status, 200, JSON.stringify(turno.data));
  // E: vacuna aplicada hace 200 días con próxima dosis a futuro: se la espera de vuelta.
  const e = await interno('Vacuna futura');
  await antiguo(e.clientId, 400);
  const vac = await owner.call('POST', '/patients/' + e.petId + '/vaccines', { name: 'Antirrábica', date: day(-200), next: day(165) });
  assert.equal(vac.status, 200, JSON.stringify(vac.data));
  // F: dos mascotas; la que vino ayer está eliminada. La otra vino hace 150 días.
  const f = await interno('Mascota eliminada');
  await antiguo(f.clientId, 400);
  await diagnostico(f.petId, -150);
  const f2 = await owner.call('POST', '/patients', { name: 'Borrada', species: 'Gato', breed: '', sex: 'Hembra', neutered: false, birth: '', weight: '', notes: '', clientId: f.clientId });
  await diagnostico(f2.data.id, -1);
  assert.equal((await owner.call('DELETE', '/patients/' + f2.data.id)).status, 200);
  // G: vacuna vencida (próxima dosis ya pasó): no se la excluye.
  const g = await interno('Vacuna vencida');
  await antiguo(g.clientId, 500);
  assert.equal((await owner.call('POST', '/patients/' + g.petId + '/vaccines', { name: 'Séxtuple', date: day(-420), next: day(-55) })).status, 200);

  const r = await inactivos();
  assert.equal(r.months, 4);
  assert.equal(r.days, 120);
  const ids = r.items.map((x) => x.id);
  assert.ok(!ids.includes(a.clientId), 'A (vino ayer) no aparece');
  assert.ok(!ids.includes(d.clientId), 'D (turno futuro) no aparece');
  assert.ok(!ids.includes(e.clientId), 'E (vacuna con próxima dosis a futuro) no aparece');

  const rb = r.items.find((x) => x.id === b.clientId);
  assert.ok(rb, 'B aparece');
  assert.equal(rb.lastDate, day(-150));
  assert.equal(rb.lastKind, 'consulta');
  assert.equal(rb.lastLabel, 'Consulta');
  assert.equal(rb.daysSince, 150);
  assert.equal(rb.monthsSince, 5);
  assert.equal(rb.source, 'sistema');
  assert.equal(rb.webNoVisit, false);
  assert.deepEqual(rb.pets.map((p) => p.id), [b.petId]);
  assert.ok(rb.phone && rb.name.includes('Cinco meses'));

  const rc = r.items.find((x) => x.id === c.clientId);
  assert.ok(rc, 'C aparece');
  assert.equal(rc.lastKind, 'alta', 'sin actividad: se toma el alta de la ficha');
  assert.equal(rc.lastDate, day(-200));
  assert.equal(rc.source, 'web');
  assert.equal(rc.webNoVisit, true, 'web y nunca vino: resaltado');
  assert.equal(rc.monthsSince, 6);

  const rf = r.items.find((x) => x.id === f.clientId);
  assert.ok(rf, 'F aparece: la actividad de una mascota eliminada no cuenta');
  assert.equal(rf.lastDate, day(-150));
  assert.deepEqual(rf.pets.map((p) => p.name), ['Mascota Mascota eliminada'], 'la mascota eliminada no se lista');

  const rg = r.items.find((x) => x.id === g.clientId);
  assert.ok(rg, 'G (vacuna vencida) aparece');
  assert.equal(rg.lastKind, 'vacuna');
  assert.equal(rg.lastDate, day(-420));

  // Del que más tiempo lleva al que menos.
  const fechas = r.items.map((x) => x.lastDate);
  assert.deepEqual(fechas, fechas.slice().sort());
  assert.ok(r.items.every((x) => x.daysSince > 120));

  // 6 y 12 meses.
  const r6 = await inactivos(6);
  assert.ok(!r6.items.some((x) => x.id === b.clientId), 'B (150 días) no llega a 6 meses');
  assert.ok(r6.items.some((x) => x.id === c.clientId), 'C (200 días) sí');
  const r12 = await inactivos(12);
  assert.ok(!r12.items.some((x) => x.id === c.clientId));
  assert.ok(r12.items.some((x) => x.id === g.clientId), 'G (420 días) pasa el año');
});

test('reporte de inactivos: solo administrador, período válido y no modifica nada', async () => {
  assert.equal((await staff.call('GET', '/reports/inactive-clients')).status, 403);
  assert.equal((await client().call('GET', '/reports/inactive-clients')).status, 401);
  const mal = await owner.call('GET', '/reports/inactive-clients?months=5');
  assert.equal(mal.status, 400);
  assert.match(mal.data.error, /4, 6 o 12 meses/);
  const antes = (await owner.call('GET', '/backups/current')).data.counts;
  await inactivos();
  await inactivos(12);
  assert.deepEqual((await owner.call('GET', '/backups/current')).data.counts, antes, 'pedir el reporte no crea ni borra registros');
});

/* ---------- Pedido 3: enlace para dejar una reseña ---------- */
test('el enlace de reseñas se guarda solo si es https y la página pública lo recibe', async () => {
  const cur = (await owner.call('GET', '/settings')).data;
  const base = (o) => { const b = Object.assign({}, cur, o); delete b.emailReady; return b; };
  const http = await owner.call('PUT', '/settings', base({ reviewUrl: 'http://g.page/r/abc/review' }));
  assert.equal(http.status, 400);
  assert.match(http.data.error, /reseña.*https/);
  assert.equal((await owner.call('PUT', '/settings', base({ reviewUrl: 'javascript:alert(1)' }))).status, 400);
  const ok = await owner.call('PUT', '/settings', base({ reviewUrl: 'https://g.page/r/prueba/review' }));
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.reviewUrl, 'https://g.page/r/prueba/review');
  assert.equal((await pub().call('GET', '/info')).data.reviewUrl, 'https://g.page/r/prueba/review');
  // Vacío: sin enlace (la página no pregunta nada).
  assert.equal((await owner.call('PUT', '/settings', base({ reviewUrl: '' }))).status, 200);
  assert.equal((await pub().call('GET', '/info')).data.reviewUrl, '');
});

/* ---------- Pedido 4: pendiente, confirmado y rechazado a la vista del cliente ---------- */
test('el cliente ve su turno pendiente, después confirmado, y un rechazo reciente con su explicación', async () => {
  const w = await web('Estados');
  const otro = await web('Otro');
  const slots = (await pub().call('GET', '/slots?type=vacuna')).data.days;
  const dia = slots[slots.length - 1];
  const pedir = (k) => pub(w.token).call('POST', '/appointments', { type: 'vacuna', patientId: w.petId, date: dia.date, time: dia.times[k] });

  const p1 = await pedir(1);
  assert.equal(p1.status, 200, JSON.stringify(p1.data));
  let me = (await pub(w.token).call('GET', '/me')).data;
  assert.equal(me.appointments.find((a) => a.id === p1.data.id).status, 'pendiente');

  // La veterinaria lo acepta: el cliente lo ve confirmado.
  assert.equal((await owner.call('POST', '/appointments/' + p1.data.id + '/status', { status: 'confirmado' })).status, 200);
  me = (await pub(w.token).call('GET', '/me')).data;
  assert.equal(me.appointments.find((a) => a.id === p1.data.id).status, 'confirmado');
  // Lo cancela para poder pedir otro ese día (una mascota, un turno por día).
  assert.equal((await pub(w.token).call('POST', '/appointments/' + p1.data.id + '/cancel', {})).status, 200);

  // Otro pedido, que la veterinaria rechaza: sigue a la vista, como rechazado y sin poder cancelarse.
  const p2 = await pedir(2);
  assert.equal(p2.status, 200, JSON.stringify(p2.data));
  assert.equal((await owner.call('POST', '/appointments/' + p2.data.id + '/status', { status: 'rechazado' })).status, 200);
  me = (await pub(w.token).call('GET', '/me')).data;
  const rech = me.appointments.find((a) => a.id === p2.data.id);
  assert.ok(rech, 'el rechazado sigue en la lista del cliente');
  assert.equal(rech.status, 'rechazado');
  assert.equal(rech.canCancel, false);
  assert.equal((await pub(w.token).call('POST', '/appointments/' + p2.data.id + '/cancel', {})).status, 404);
  assert.ok(!me.appointments.some((a) => a.id === p1.data.id), 'el cancelado no aparece');

  // Otro cliente no ve ese rechazo.
  const meOtro = (await pub(otro.token).call('GET', '/me')).data;
  assert.ok(!meOtro.appointments.some((a) => a.id === p2.data.id));
  assert.deepEqual(meOtro.appointments, []);

  // El rechazado no ocupa lugar: la misma mascota puede pedir otro horario ese mismo día.
  const p3 = await pedir(3);
  assert.equal(p3.status, 200, JSON.stringify(p3.data));

  // Pasados los días de aviso, el rechazo deja de mostrarse.
  await db.query("UPDATE appointments SET status_at = now() - interval '8 days' WHERE id = $1", [p2.data.id]);
  me = (await pub(w.token).call('GET', '/me')).data;
  assert.ok(!me.appointments.some((a) => a.id === p2.data.id), 'a los 8 días ya no se muestra');
  assert.ok(me.appointments.some((a) => a.id === p3.data.id && a.status === 'pendiente'));
  // Un turno que rechazó la veterinaria sobre algo cargado por ella no existe: solo se rechazan pedidos web pendientes.
});

/* ---------- copias de seguridad ---------- */
test('la copia de seguridad guarda el origen; una copia vieja se restaura como "sistema"', async () => {
  const exp = (await owner.call('GET', '/backup/export')).data.data;
  assert.ok(exp.clients.some((c) => c.source === 'web') && exp.clients.some((c) => c.source === 'sistema'));
  assert.ok(exp.patients.some((p) => p.source === 'web') && exp.patients.some((p) => p.source === 'sistema'));
  assert.ok(exp.appointments.some((a) => a.status_at), 'se guarda cuándo cambió el estado');
  const origen = (d) => [d.clients.map((c) => [c.id, c.source]), d.patients.map((p) => [p.id, p.source])];

  assert.equal((await owner.call('POST', '/restore', { data: exp })).status, 200);
  const igual = (await owner.call('GET', '/backup/export')).data.data;
  assert.deepEqual(origen(igual), origen(exp), 'restaurar la copia no cambia el origen');

  const vieja = JSON.parse(JSON.stringify(exp));
  vieja.clients.forEach((c) => delete c.source);
  vieja.patients.forEach((p) => delete p.source);
  vieja.appointments.forEach((a) => delete a.status_at);
  assert.equal((await owner.call('POST', '/restore', { data: vieja })).status, 200);
  const despues = (await owner.call('GET', '/backup/export')).data.data;
  assert.ok(despues.clients.every((c) => c.source === 'sistema') && despues.patients.every((p) => p.source === 'sistema'));
  // Se deja la base como estaba antes de esta prueba.
  assert.equal((await owner.call('POST', '/restore', { data: exp })).status, 200);
});

/* ---------- arreglos de la revisión independiente ---------- */
test('cliente creado al migrar fichas viejas: sin actividad, cuenta la fecha de su mascota más vieja', async () => {
  const m = await interno('Migrado');
  // La mascota es de hace 2 años; el cliente se creó "hoy" (como los que creó la migración de clientes).
  await db.query("UPDATE patients SET created_at = now() - interval '730 days' WHERE id = $1", [m.petId]);
  const r = await inactivos(12);
  const x = r.items.find((i) => i.id === m.clientId);
  assert.ok(x, 'aparece aunque la ficha del cliente sea nueva');
  assert.equal(x.lastKind, 'alta');
  assert.equal(x.lastDate, day(-730));
});

test('cliente con todas sus mascotas en la Papelera: aparece marcado', async () => {
  const t = await interno('Papelera');
  await antiguo(t.clientId, 300);
  await diagnostico(t.petId, -1);
  assert.equal((await owner.call('DELETE', '/patients/' + t.petId)).status, 200);
  const x = (await inactivos()).items.find((i) => i.id === t.clientId);
  assert.ok(x);
  assert.equal(x.trashOnly, true);
  assert.deepEqual(x.pets, []);
  const b = (await inactivos()).items.find((i) => i.trashOnly === false);
  assert.ok(!b || b.trashOnly === false);
});

test('una consulta con fecha futura no cuenta como visita (ni en la ficha ni en el reporte)', async () => {
  const w = await web('Futuro');
  await db.query("INSERT INTO diagnoses (patient_id, on_date, title) VALUES ($1, $2, 'Cargada con fecha futura')", [w.petId, day(30)]);
  assert.equal((await owner.call('GET', '/patients/' + w.petId)).data.webNew, true);
  assert.equal((await owner.call('GET', '/clients/' + w.clientId)).data.webNew, true);
  const boot = (await owner.call('GET', '/bootstrap')).data;
  assert.equal(boot.patients.find((p) => p.id === w.petId).webNew, true, 'la lista coincide con la ficha');
  assert.equal(boot.clients.find((c) => c.id === w.clientId).webNew, true);
});

test('el período del reporte tiene que ser 4, 6 o 12 exactos', async () => {
  for (const m of ['4.0', '12 ', '', 'abc', '-4', '5']) {
    assert.equal((await owner.call('GET', '/reports/inactive-clients?months=' + encodeURIComponent(m))).status, 400, JSON.stringify(m));
  }
  assert.equal((await owner.call('GET', '/reports/inactive-clients')).status, 200, 'sin período: 4 meses');
});
