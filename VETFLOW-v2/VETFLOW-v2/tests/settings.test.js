'use strict';
// Pruebas de Configuración e informe semanal. Se corren con:  DATABASE_URL=postgres://... npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, ENV } = require('./helpers');

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL para correr las pruebas (una base de prueba, nunca la real).');
  process.exit(1);
}
let server;
const owner = client();
const staff = client();

test.before(async () => {
  server = await startServer();
  assert.equal((await owner.login(ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD)).status, 200);
  await owner.call('POST', '/users', { name: 'Ayudante', email: 'ayudante@test.com', password: 'otra-clave-123', role: 'staff' });
  assert.equal((await staff.login('ayudante@test.com', 'otra-clave-123')).status, 200);
});
test.after(() => server && server.kill());

const base = (o) => Object.assign({ shopName: 'Patitas', methods: ['Efectivo'], report: { enabled: false, hour: 8, recipients: '' } }, o || {});

test('permisos: el ayudante no puede guardar ni ver lo del dueño', async () => {
  assert.equal((await staff.call('PUT', '/settings', base())).status, 403);
  const g = await staff.call('GET', '/settings');
  assert.equal(g.status, 200);
  for (const k of ['fixedMonthly', 'fixedCategories', 'lowMargin', 'lostDays', 'report', 'emailReady']) assert.ok(!(k in g.data), k + ' no debería verlo el ayudante');
  assert.ok('shopName' in g.data && 'methods' in g.data && 'hours' in g.data);
  for (const p of ['/report/preview', '/report/log']) assert.equal((await staff.call('GET', p)).status, 403);
  assert.equal((await staff.call('POST', '/report/send', {})).status, 403);
  const b = await staff.call('GET', '/bootstrap');
  assert.ok(b.data.settings && !('report' in b.data.settings));
});

test('guardado completo: se lee de vuelta', async () => {
  const r = await owner.call('PUT', '/settings', base({ defaultMinStock: 5, expiryDays: 45, fixedMonthly: 300000, phone: '11 4444-5555', ticketWidth: 58 }));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const g = await owner.call('GET', '/settings');
  assert.equal(g.data.shopName, 'Patitas');
  assert.equal(g.data.defaultMinStock, 5);
  assert.equal(g.data.expiryDays, 45);
  assert.equal(g.data.fixedMonthly, 300000);
  assert.equal(g.data.ticketWidth, 58);
  assert.equal(g.data.emailReady, false);
  assert.deepEqual(g.data.methods, ['Efectivo']);
  assert.equal((await owner.call('GET', '/bootstrap')).data.clinic, 'Patitas');
});

test('validaciones con los mensajes exactos', async () => {
  let r = await owner.call('PUT', '/settings', base({ methods: [] }));
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'Dejá habilitada al menos una forma de pago.');
  r = await owner.call('PUT', '/settings', base({ report: { enabled: true, hour: 8, recipients: '' } }));
  assert.equal(r.data.error, 'Para activar el informe semanal escribí al menos un email destinatario.');
  r = await owner.call('PUT', '/settings', base({ hours: { 1: ['19:00', '09:00'] } }));
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'En el horario comercial, el cierre tiene que ser después de la apertura.');
  r = await owner.call('PUT', '/settings', base({ hours: { 1: 'x' } }));
  assert.equal(r.data.error, 'El horario comercial no es válido.');
  r = await owner.call('PUT', '/settings', base({ report: { enabled: false, hour: 8, recipients: 'no-es-un-email' } }));
  assert.equal(r.status, 400);
  r = await owner.call('PUT', '/settings', base({ shopName: '' }));
  assert.equal(r.status, 400);
  r = await owner.call('PUT', '/settings', base({ lostDays: 3 }));
  assert.equal(r.status, 400);
  r = await owner.call('PUT', '/settings', base({ expiryDays: 0 }));
  assert.equal(r.status, 400);
  r = await owner.call('PUT', '/settings', base({ lowMargin: 101 }));
  assert.equal(r.status, 400);
  r = await owner.call('PUT', '/settings', base({ ticketWidth: 70 }));
  assert.equal(r.status, 400);
  // Los destinatarios se normalizan: separados por coma, punto y coma o espacios.
  r = await owner.call('PUT', '/settings', base({ report: { enabled: true, hour: 9, recipients: 'a@x.com; b@y.com  c@z.com' } }));
  assert.equal(r.data.report.recipients, 'a@x.com, b@y.com, c@z.com');
});

test('cron externo: exige el secreto', async () => {
  const c = client();
  assert.equal((await c.call('POST', '/cron/weekly-report', {})).status, 403);
  const ok = await c.call('POST', '/cron/weekly-report', {}, { 'X-Cron-Secret': ENV.CRON_SECRET });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.sent, false);
});

test('envío manual sin email configurado: 503', async () => {
  const r = await owner.call('POST', '/report/send', {});
  assert.equal(r.status, 503);
  assert.match(r.data.error, /faltan EMAIL_PROVIDER, EMAIL_API_KEY y EMAIL_FROM/);
  const pv = await owner.call('GET', '/report/preview');
  assert.equal(pv.status, 200);
  assert.ok(pv.data.html.includes('Patitas'));
});
