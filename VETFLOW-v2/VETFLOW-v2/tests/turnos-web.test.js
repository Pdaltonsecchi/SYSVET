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
  assert.ok(turnos.some((a) => a.source === 'web'));
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
  // Se deja la base como estaba antes de esta prueba.
  assert.equal((await owner.call('POST', '/restore', { data: exp.data.data })).status, 200);
});

/* ---------- pedidos al mismo tiempo ---------- */
test('dos clientes piden el mismo horario a la vez: queda uno solo', async () => {
  const s = await pub().call('GET', '/slots?type=consulta');
  const day = s.data.days[s.data.days.length - 1];
  const time = day.times[Math.floor(day.times.length / 2)];
  // 8 pedidos simultáneos (4 de cada cliente) al mismo día y hora.
  const tries = [];
  for (let i = 0; i < 4; i++) {
    tries.push(pub(tokenA).call('POST', '/appointments', { type: 'consulta', patientId: petA, date: day.date, time }));
    tries.push(pub(tokenB).call('POST', '/appointments', { type: 'consulta', patientId: petB, date: day.date, time }));
  }
  const res = await Promise.all(tries);
  assert.equal(res.filter((r) => r.status === 200).length, 1, 'entró ' + res.map((r) => r.status).join(','));
  assert.ok(res.filter((r) => r.status !== 200).every((r) => r.status === 400 && /ya no está disponible/.test(r.data.error)));
  const agenda = await owner.call('GET', '/appointments?from=' + day.date + '&to=' + day.date);
  assert.equal(agenda.data.items.filter((a) => a.time === time).length, 1, 'en la agenda hay un solo turno a esa hora');
});

test('pedidos simultáneos que se pisan en parte (consulta 20 min y vacuna 10 min después): queda uno solo', async () => {
  const s = await pub().call('GET', '/slots?type=consulta');
  const day = s.data.days[s.data.days.length - 2];
  // Un horario de consulta cuyo horario siguiente (10 min después) también esté libre.
  const i = day.times.findIndex((t, k) => day.times[k + 1] && Number(day.times[k + 1].slice(3)) === (Number(t.slice(3)) + 10) % 60);
  assert.ok(i >= 0, 'hay dos horarios seguidos libres');
  const [r1, r2] = await Promise.all([
    pub(tokenA).call('POST', '/appointments', { type: 'consulta', patientId: petA, date: day.date, time: day.times[i] }),
    pub(tokenB).call('POST', '/appointments', { type: 'vacuna', patientId: petB, date: day.date, time: day.times[i + 1] }),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 400], JSON.stringify([r1.data, r2.data]));
});

test('dos altas simultáneas con el mismo teléfono: se crea una sola ficha', async () => {
  const n = local8();
  const forms = ['11 ' + tail4(n), '011 15 ' + tail4(n), '+54 9 11 ' + n, n, '11' + n, '011 ' + n];
  const res = await Promise.all(forms.map((phone, k) => pub().call('POST', '/register', { firstName: 'Hugo', lastName: 'Doble' + k, phone, pet: { name: 'Tom', species: 'Gato', sex: 'Macho' } })));
  assert.equal(res.filter((r) => r.status === 200).length, 1, res.map((r) => r.status).join(','));
  assert.ok(res.filter((r) => r.status !== 200).every((r) => r.status === 409));
  const login = await pub().call('POST', '/login', { phone: forms[0] });
  assert.equal(login.status, 200, 'una sola ficha: el ingreso no es ambiguo');
});

test('aceptar y cancelar el mismo pedido a la vez: gana uno solo y el otro recibe 404', async () => {
  const s = await pub().call('GET', '/slots?type=vacuna');
  const day = s.data.days[s.data.days.length - 3];
  const req = await pub(tokenA).call('POST', '/appointments', { type: 'vacuna', patientId: petA, date: day.date, time: day.times[0] });
  assert.equal(req.status, 200, JSON.stringify(req.data));
  const [acc, rej] = await Promise.all([
    owner.call('POST', '/appointments/' + req.data.id + '/status', { status: 'confirmado' }),
    owner.call('POST', '/appointments/' + req.data.id + '/status', { status: 'rechazado' }),
  ]);
  assert.deepEqual([acc.status, rej.status].sort(), [200, 404]);
});

/* ---------- topes y validaciones que salieron de la revisión de seguridad ---------- */
// Un cliente y una mascota nuevos, para que estas pruebas no dependan de lo que dejaron las anteriores.
async function clienteNuevo(nombre) {
  const r = await pub().call('POST', '/register', { firstName: nombre, lastName: 'Tope', phone: '11 ' + tail4(local8()), pet: { name: 'Uno', species: 'Perro', sex: 'Macho' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { token: r.data.token, id: r.data.client.id, pet: r.data.pets[0].id };
}
const diasLibres = async (type) => (await pub().call('GET', '/slots?type=' + type)).data.days;

test('una mascota no puede tener dos turnos el mismo día, y un cliente no pasa de 3 pedidos sin confirmar', async () => {
  const c = await clienteNuevo('Iris');
  const days = await diasLibres('vacuna');
  const pedir = (pet, d, k) => pub(c.token).call('POST', '/appointments', { type: 'vacuna', patientId: pet, date: days[d].date, time: days[d].times[k] });
  assert.equal((await pedir(c.pet, 0, 0)).status, 200);
  const mismoDia = await pedir(c.pet, 0, 2);
  assert.equal(mismoDia.status, 400);
  assert.match(mismoDia.data.error, /ya tiene un turno ese día/);
  assert.equal((await pedir(c.pet, 1, 0)).status, 200);
  assert.equal((await pedir(c.pet, 2, 0)).status, 200);
  const cuarto = await pedir(c.pet, 3, 0);
  assert.equal(cuarto.status, 400);
  assert.match(cuarto.data.error, /3 pedidos esperando confirmación/);
  // Con otra mascota tampoco: el tope es por cliente.
  const pets = await pub(c.token).call('POST', '/pets', { pet: { name: 'Dos', species: 'Gato', sex: 'Hembra' } });
  const otra = pets.data.pets.find((p) => p.name === 'Dos').id;
  assert.equal((await pedir(otra, 3, 0)).status, 400);
  // Cuando la veterinaria confirma uno, puede pedir otro.
  const me = await pub(c.token).call('GET', '/me');
  assert.equal((await owner.call('POST', '/appointments/' + me.data.appointments[0].id + '/status', { status: 'confirmado' })).status, 200);
  assert.equal((await pedir(otra, 3, 0)).status, 200);
});

test('un cliente no puede cargar más de 10 mascotas desde la página', async () => {
  const c = await clienteNuevo('Juan');
  for (let i = 2; i <= 10; i++) assert.equal((await pub(c.token).call('POST', '/pets', { pet: { name: 'Mascota ' + i, species: 'Perro', sex: 'Macho' } })).status, 200, 'mascota ' + i);
  const once = await pub(c.token).call('POST', '/pets', { pet: { name: 'Mascota 11', species: 'Perro', sex: 'Macho' } });
  assert.equal(once.status, 400);
  assert.match(once.data.error, /10 mascotas/);
});

test('lo que agendó la veterinaria no se cancela desde la página; lo pedido por la web sí', async () => {
  const c = await clienteNuevo('Karen');
  const days = await diasLibres('consulta');
  const cir = await owner.call('POST', '/appointments', { patientId: c.pet, title: 'Castración', description: '', date: days[1].date, time: '08:00', type: 'cirugia', duration: 90 });
  assert.equal(cir.status, 200, JSON.stringify(cir.data));
  const web = await pub(c.token).call('POST', '/appointments', { type: 'consulta', patientId: c.pet, date: days[2].date, time: days[2].times[0] });
  assert.equal(web.status, 200);
  const me = await pub(c.token).call('GET', '/me');
  assert.equal(me.data.appointments.find((a) => a.id === cir.data.id).canCancel, false);
  assert.equal(me.data.appointments.find((a) => a.id === web.data.id).canCancel, true);
  const no = await pub(c.token).call('POST', '/appointments/' + cir.data.id + '/cancel', {});
  assert.equal(no.status, 409);
  assert.match(no.data.error, /llamá a la veterinaria/);
  const agenda = await owner.call('GET', '/appointments?from=' + days[1].date + '&to=' + days[1].date);
  assert.ok(agenda.data.items.some((a) => a.id === cir.data.id), 'la cirugía sigue en la agenda');
  assert.equal((await pub(c.token).call('POST', '/appointments/' + web.data.id + '/cancel', {})).status, 200);
  // Otro cliente no puede cancelar ni enterarse de ese turno.
  assert.equal((await pub(tokenB).call('POST', '/appointments/' + cir.data.id + '/cancel', {})).status, 404);
});

test('horas con segundos y números de turno o mascota enormes dan error de validación, no un error interno', async () => {
  const c = await clienteNuevo('Leo');
  const days = await diasLibres('consulta');
  const seg = await pub(c.token).call('POST', '/appointments', { type: 'consulta', patientId: c.pet, date: days[0].date, time: days[0].times[0] + ':59' });
  assert.equal(seg.status, 400);
  for (const patientId of [1e20, 2147483648, -1, 1.5, 'abc', null, [c.pet, c.pet], { id: c.pet }]) {
    const r = await pub(c.token).call('POST', '/appointments', { type: 'consulta', patientId, date: days[0].date, time: days[0].times[0] });
    assert.equal(r.status, 400, JSON.stringify(patientId));
  }
  assert.equal((await pub(c.token).call('POST', '/appointments/99999999999/cancel', {})).status, 400);
  assert.equal((await owner.call('POST', '/appointments/99999999999/status', { status: 'confirmado' })).status, 400);
});

test('si la veterinaria cambia el teléfono del cliente, su sesión abierta deja de valer', async () => {
  const c = await clienteNuevo('Mara');
  assert.equal((await pub(c.token).call('GET', '/me')).status, 200);
  const nuevo = '11 ' + tail4(local8());
  const put = await owner.call('PUT', '/clients/' + c.id, { firstName: 'Mara', lastName: 'Tope', phone: nuevo, email: '', address: '' });
  assert.equal(put.status, 200, JSON.stringify(put.data));
  assert.equal((await pub(c.token).call('GET', '/me')).status, 401);
  assert.equal((await pub(c.token).call('POST', '/pets', { pet: { name: 'X', species: 'Perro', sex: 'Macho' } })).status, 401);
  assert.equal((await pub().call('POST', '/login', { phone: nuevo })).status, 200, 'con el número nuevo entra');
});

test('entrar bien con tu número nunca te bloquea (solo cuentan los intentos fallidos)', async () => {
  const n = local8();
  const reg = await pub().call('POST', '/register', { firstName: 'Nora', lastName: 'Tope', phone: '11 ' + tail4(n), pet: { name: 'Uno', species: 'Gato', sex: 'Hembra' } });
  assert.equal(reg.status, 200);
  for (let i = 0; i < 14; i++) assert.equal((await pub().call('POST', '/login', { phone: '011 15 ' + tail4(n) })).status, 200, 'ingreso ' + (i + 1));
});

test('el aviso de pedidos para aceptar cuenta los pendientes y pide sesión', async () => {
  assert.equal((await client().call('GET', '/appointments/pending')).status, 401);
  const antes = (await owner.call('GET', '/appointments/pending')).data;
  assert.ok(antes.count >= 1 && /^\d{4}-\d{2}-\d{2}$/.test(antes.first), JSON.stringify(antes));
  assert.equal((await owner.call('GET', '/bootstrap')).data.pendingWeb.count, antes.count);
  const c = await clienteNuevo('Olga');
  const days = await diasLibres('vacuna');
  const req = await pub(c.token).call('POST', '/appointments', { type: 'vacuna', patientId: c.pet, date: days[0].date, time: days[0].times[days[0].times.length - 1] });
  assert.equal(req.status, 200, JSON.stringify(req.data));
  assert.equal((await owner.call('GET', '/appointments/pending')).data.count, antes.count + 1);
  assert.equal((await owner.call('POST', '/appointments/' + req.data.id + '/status', { status: 'rechazado' })).status, 200);
  assert.equal((await owner.call('GET', '/appointments/pending')).data.count, antes.count);
});
