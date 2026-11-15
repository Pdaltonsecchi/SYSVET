'use strict';
// Turnos desde la página pública, de punta a punta contra el servidor real (con la base de prueba).
const test = require('node:test');
const assert = require('node:assert/strict');
if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL para correr las pruebas.');
  process.exit(1);
}
const { ENV, startServer, client } = require('./helpers');

let child;
const owner = client();
const phoneA = '11' + String(Math.floor(10000000 + Math.random() * 89999999));
const phoneB = '11' + String(Math.floor(10000000 + Math.random() * 89999999));
let tokenA = '';
let tokenB = '';
let petA = 0;
let petB = 0;

const pub = (token) => ({
  call: (method, path, body) => client().call(method, '/public' + path, body, token ? { 'X-Cliente-Token': token } : {}),
});

test.before(async () => {
  child = await startServer();
  const r = await owner.login(ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD);
  assert.equal(r.status, 200);
});
test.after(async () => {
  if (child) child.kill();
});

test('la información pública no pide sesión y solo ofrece consultas y vacunas', async () => {
  const r = await pub().call('GET', '/info');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.types.map((t) => t.value), ['consulta', 'vacuna']);
});

test('un teléfono no registrado da error, sin entrar', async () => {
  const r = await pub().call('POST', '/login', { phone: phoneA });
  assert.equal(r.status, 404);
  assert.match(r.data.error, /no está registrado/);
  assert.equal(r.data.token, undefined);
});

test('cliente nuevo: se guarda el cliente con su mascota y queda adentro', async () => {
  const r = await pub().call('POST', '/register', {
    firstName: 'Ana', lastName: 'Prueba', phone: phoneA, pet: { name: 'Luna', species: 'Gato', sex: 'Hembra' },
  });
  assert.equal(r.status, 200);
  assert.ok(r.data.token);
  assert.equal(r.data.client.firstName, 'Ana');
  assert.equal(r.data.pets.length, 1);
  tokenA = r.data.token;
  petA = r.data.pets[0].id;

  // Ahora el teléfono ya es cliente: entrar funciona y la alta repetida se rechaza.
  const again = await pub().call('POST', '/login', { phone: phoneA });
  assert.equal(again.status, 200);
  const dup = await pub().call('POST', '/register', { firstName: 'Otra', lastName: 'Persona', phone: phoneA, pet: { name: 'X', species: 'Perro', sex: 'Macho' } });
  assert.equal(dup.status, 409);
});

test('cliente B con su mascota, para probar que no ve ni usa las de otro', async () => {
  const r = await pub().call('POST', '/register', {
    firstName: 'Beto', lastName: 'Prueba', phone: phoneB, pet: { name: 'Toby', species: 'Perro', sex: 'Macho' },
  });
  assert.equal(r.status, 200);
  tokenB = r.data.token;
  petB = r.data.pets[0].id;
});

test('solo se ofrecen horarios libres, y cirugía no se puede pedir', async () => {
  const s = await pub().call('GET', '/slots?type=consulta');
  assert.equal(s.status, 200);
  assert.ok(s.data.days.length > 0);
  assert.ok(s.data.days[0].times.length > 0);
  const c = await pub().call('GET', '/slots?type=cirugia');
  assert.equal(c.status, 400);
});

test('pedir turno: queda pendiente, el horario se reserva y no se puede pedir dos veces', async () => {
  const s = await pub().call('GET', '/slots?type=consulta');
  const day = s.data.days[0];
  const time = day.times[0];
  const ok = await pub(tokenA).call('POST', '/appointments', { type: 'consulta', patientId: petA, date: day.date, time });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.status, 'pendiente');

  const s2 = await pub().call('GET', '/slots?type=consulta');
  const sameDay = s2.data.days.find((d) => d.date === day.date);
  assert.ok(!sameDay || !sameDay.times.includes(time), 'el horario ya no aparece libre');
  const dup = await pub(tokenB).call('POST', '/appointments', { type: 'consulta', patientId: petB, date: day.date, time });
  assert.equal(dup.status, 400);
});

test('un cliente no puede pedir un turno para la mascota de otro', async () => {
  const s = await pub().call('GET', '/slots?type=vacuna');
  const day = s.data.days[0];
  const r = await pub(tokenA).call('POST', '/appointments', { type: 'vacuna', patientId: petB, date: day.date, time: day.times[0] });
  assert.equal(r.status, 404);
});

test('la veterinaria ve el pedido como pendiente y, al aceptarlo, queda en la agenda', async () => {
  const me = await pub(tokenA).call('GET', '/me');
  const turno = me.data.appointments.find((a) => a.status === 'pendiente');
  assert.ok(turno, 'el cliente ve su turno pendiente');

  const agenda = await owner.call('GET', '/appointments?from=' + turno.date + '&to=' + turno.date);
  const item = agenda.data.items.find((a) => a.id === turno.id);
  assert.equal(item.status, 'pendiente');
  assert.equal(item.source, 'web');

  const acc = await owner.call('POST', '/appointments/' + turno.id + '/status', { status: 'confirmado' });
  assert.equal(acc.status, 200);
  const after = await owner.call('GET', '/appointments?from=' + turno.date + '&to=' + turno.date);
  assert.equal(after.data.items.find((a) => a.id === turno.id).status, 'confirmado');
});

test('la veterinaria rechaza un pedido: el horario vuelve a quedar libre', async () => {
  const s = await pub().call('GET', '/slots?type=vacuna');
  const day = s.data.days[0];
  const time = day.times[0];
  const req = await pub(tokenB).call('POST', '/appointments', { type: 'vacuna', patientId: petB, date: day.date, time });
  assert.equal(req.status, 200);

  const rej = await owner.call('POST', '/appointments/' + req.data.id + '/status', { status: 'rechazado' });
  assert.equal(rej.status, 200);

  const again = await pub().call('GET', '/slots?type=vacuna');
  const sameDay = again.data.days.find((d) => d.date === day.date);
  assert.ok(sameDay && sameDay.times.includes(time), 'el horario rechazado vuelve a estar libre');
  const meB = await pub(tokenB).call('GET', '/me');
  assert.ok(!meB.data.appointments.some((a) => a.id === req.data.id), 'el rechazado no aparece en los turnos del cliente');
});

test('el cliente cancela su turno y deja de aparecer', async () => {
  const me = await pub(tokenA).call('GET', '/me');
  const turno = me.data.appointments[0];
  const r = await pub(tokenA).call('POST', '/appointments/' + turno.id + '/cancel', {});
  assert.equal(r.status, 200);
  const after = await pub(tokenA).call('GET', '/me');
  assert.ok(!after.data.appointments.some((a) => a.id === turno.id));
});

test('sin token válido no se ven turnos y el teléfono mal escrito no entra', async () => {
  const r = await pub('token-falso').call('GET', '/me');
  assert.equal(r.status, 401);
  const bad = await pub().call('POST', '/login', { phone: '000' });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /al menos 6 dígitos/);
});

test('la ruta de la veterinaria para aceptar requiere sesión', async () => {
  const r = await pub().call('POST', '/../appointments/1/status', { status: 'confirmado' });
  assert.notEqual(r.status, 200);
  const direct = await client().call('POST', '/appointments/1/status', { status: 'confirmado' });
  assert.equal(direct.status, 401);
});

test('la veterinaria carga profesional, reseñas y Google Maps, y la página pública los muestra', async () => {
  const cur = await owner.call('GET', '/settings');
  assert.equal(cur.status, 200);
  const body = Object.assign({}, cur.data, {
    professionalName: 'Dra. Laura Prueba',
    mapsUrl: 'https://maps.app.goo.gl/ejemplo',
    reviews: [{ author: 'María P.', stars: 5, text: 'Muy buena atención con mi perro.' }],
  });
  delete body.emailReady;
  const put = await owner.call('PUT', '/settings', body);
  assert.equal(put.status, 200);

  const info = await pub().call('GET', '/info');
  assert.equal(info.data.professionalName, 'Dra. Laura Prueba');
  assert.equal(info.data.mapsUrl, 'https://maps.app.goo.gl/ejemplo');
  assert.equal(info.data.reviews[0].stars, 5);
  assert.ok(info.data.hours && info.data.methods.length > 0);
});

test('el enlace de Google Maps tiene que ser https y las estrellas de 1 a 5', async () => {
  const cur = await owner.call('GET', '/settings');
  const httpBody = Object.assign({}, cur.data, { mapsUrl: 'http://maps.ejemplo.com' });
  delete httpBody.emailReady;
  const r1 = await owner.call('PUT', '/settings', httpBody);
  assert.equal(r1.status, 400);
  assert.match(r1.data.error, /https/);

  const starsBody = Object.assign({}, cur.data, { reviews: [{ author: 'X', stars: 9, text: 'Hola' }] });
  delete starsBody.emailReady;
  const r2 = await owner.call('PUT', '/settings', starsBody);
  assert.equal(r2.status, 400);
});

/* ---------- teléfonos escritos de distintas formas ---------- */
// '11' + '4' + 7 cifras: un número de Buenos Aires que no empieza con 15.
const local8 = () => '4' + String(Math.floor(1000000 + Math.random() * 8999999));
const tail4 = (n) => n.slice(0, 4) + '-' + n.slice(4);

test('el mismo teléfono entra aunque se escriba con 011, 15, +54 9, espacios o guiones', async () => {
  const n = local8();
  const reg = await pub().call('POST', '/register', { firstName: 'Carla', lastName: 'Formas', phone: '11 ' + tail4(n), pet: { name: 'Mora', species: 'Perro', sex: 'Hembra' } });
  assert.equal(reg.status, 200, JSON.stringify(reg.data));
  const id = reg.data.client.id;
  for (const phone of ['011 ' + tail4(n), '011 15 ' + tail4(n), '+54 9 11 ' + n, '54 9 11 ' + n.slice(0, 4) + ' ' + n.slice(4), '11' + n, '15 ' + tail4(n), n]) {
    const r = await pub().call('POST', '/login', { phone });
    assert.equal(r.status, 200, phone + ': ' + JSON.stringify(r.data));
    assert.equal(r.data.client.id, id, phone);
  }
  // Otro número parecido no entra.
  const otro = await pub().call('POST', '/login', { phone: '11 ' + tail4(String(Number(n) + 1)) });
  assert.equal(otro.status, 404);
});

test('cliente nuevo: no se puede registrar un teléfono que ya está, aunque se escriba distinto', async () => {
  const n = local8();
  const a = await pub().call('POST', '/register', { firstName: 'Dani', lastName: 'Uno', phone: '011 15 ' + tail4(n), pet: { name: 'Roco', species: 'Perro', sex: 'Macho' } });
  assert.equal(a.status, 200);
  for (const phone of ['11 ' + tail4(n), '+54 9 11 ' + n, n]) {
    const dup = await pub().call('POST', '/register', { firstName: 'Dani', lastName: 'Dos', phone, pet: { name: 'Roco', species: 'Perro', sex: 'Macho' } });
    assert.equal(dup.status, 409, phone);
  }
});

test('un cliente guardado sin característica entra con el número completo', async () => {
  const n = local8();
  const c = await owner.call('POST', '/clients', { firstName: 'Elsa', lastName: 'Corta', phone: tail4(n) });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const r = await pub().call('POST', '/login', { phone: '011 15 ' + tail4(n) });
  assert.equal(r.status, 200);
  assert.equal(r.data.client.id, c.data.id);
});

test('teléfono en más de una ficha: no entra a ninguna y no devuelve datos', async () => {
  const n = local8();
  const c1 = await owner.call('POST', '/clients', { firstName: 'Fede', lastName: 'Repetido', phone: '11 ' + tail4(n) });
  const c2 = await owner.call('POST', '/clients', { firstName: 'Gabi', lastName: 'Repetida', phone: '011 15 ' + tail4(n) });
  assert.equal(c1.status, 200);
  assert.equal(c2.status, 200);
  for (const phone of ['11 ' + tail4(n), '+54 9 11 ' + n, n]) {
    const r = await pub().call('POST', '/login', { phone });
    assert.equal(r.status, 404, phone);
    assert.match(r.data.error, /Llamá a la veterinaria/);
    assert.deepEqual(Object.keys(r.data), ['error'], 'la respuesta no trae token, mascotas ni turnos');
  }
  // Tampoco se puede dar de alta como cliente nuevo con ese número.
  const reg = await pub().call('POST', '/register', { firstName: 'Otro', lastName: 'Más', phone: n, pet: { name: 'X', species: 'Gato', sex: 'Macho' } });
  assert.equal(reg.status, 409);
});

test('el límite de intentos por teléfono cuenta igual para todas las formas de escribirlo', async () => {
  const n = local8();
  const forms = ['11 ' + tail4(n), '011 15 ' + tail4(n), '+54 9 11 ' + n, n];
  for (let i = 0; i < 10; i++) assert.equal((await pub().call('POST', '/login', { phone: forms[i % forms.length] })).status, 404, 'intento ' + (i + 1));
  const r = await pub().call('POST', '/login', { phone: forms[0] });
  assert.equal(r.status, 429);
});

test('no se puede pedir un turno para más allá de los próximos 14 días', async () => {
  const lejos = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
  const r = await pub(tokenB).call('POST', '/appointments', { type: 'vacuna', patientId: petB, date: lejos, time: '10:00' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /próximos 14 días/);
});

test('la copia de seguridad guarda el estado de los turnos y al restaurarla no cambian', async () => {
  const exp = await owner.call('GET', '/backup/export');
  assert.equal(exp.status, 200);
  const turnos = exp.data.data.appointments;
  assert.ok(turnos.length >= 2);
  const estados = new Set(turnos.map((a) => a.status));
  for (const e of ['rechazado', 'cancelado']) assert.ok(estados.has(e), 'falta un turno ' + e + ' en la copia');
  assert.ok(turnos.every((a) => a.source === 'web'));
  const rechazado = turnos.find((a) => a.status === 'rechazado');

  const rest = await owner.call('POST', '/restore', { data: exp.data.data });
  assert.equal(rest.status, 200, JSON.stringify(rest.data));
  const after = (await owner.call('GET', '/backup/export')).data.data.appointments;
  assert.deepEqual(after.map((a) => [a.id, a.status, a.source]), turnos.map((a) => [a.id, a.status, a.source]));
  // El rechazado sigue sin ocupar la agenda de la veterinaria.
  const fecha = String(rechazado.appointment_date).slice(0, 10);
  const agenda = await owner.call('GET', '/appointments?from=' + fecha + '&to=' + fecha);
  assert.ok(!agenda.data.items.some((a) => a.id === rechazado.id));

  // Una copia vieja (sin estado ni origen) se restaura con los turnos como confirmados y de sistema.
  const vieja = JSON.parse(JSON.stringify(exp.data.data));
  vieja.appointments.forEach((a) => { delete a.status; delete a.source; });
  assert.equal((await owner.call('POST', '/restore', { data: vieja })).status, 200);
  const viejos = (await owner.call('GET', '/backup/export')).data.data.appointments;
  assert.ok(viejos.every((a) => a.status === 'confirmado' && a.source === 'sistema'));
});
