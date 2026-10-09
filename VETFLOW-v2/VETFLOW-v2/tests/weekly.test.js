'use strict';
// Informe semanal en el mismo proceso, con el proveedor de email simulado (no sale nada a internet).
const test = require('node:test');
const assert = require('node:assert/strict');
if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL para correr las pruebas.');
  process.exit(1);
}
process.env.DATABASE_SSL = 'false';
process.env.EMAIL_PROVIDER = 'resend';
process.env.EMAIL_API_KEY = 'clave-falsa';
process.env.EMAIL_FROM = 'Patitas <avisos@patitas.com>';

const db = require('../server/db');
const settings = require('../server/settings');
const weekly = require('../server/weekly');

const sent = [];
const realFetch = global.fetch;
test.before(async () => {
  await db.migrate();
  await db.query('DELETE FROM report_log');
  global.fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const cfg = Object.assign({}, settings.DEFAULT_SETTINGS, { shopName: 'Patitas <&>', report: { enabled: true, weekday: 1, hour: 8, recipients: 'dueno@x.com, otro@x.com' } });
  await settings.saveSettings(cfg);
});
test.after(async () => {
  global.fetch = realFetch;
  await db.close();
});

// 2026-10-12 es lunes; 11:30 UTC = 08:30 en Buenos Aires.
const lunes8 = new Date('2026-10-12T11:30:00Z');

test('weeklyTick envía una sola vez en el día y la hora elegidos', async () => {
  assert.deepEqual(await weekly.weeklyTick(new Date('2026-10-12T10:30:00Z')), { sent: false, reason: 'no es el horario' }); // 07:30 AR
  assert.deepEqual(await weekly.weeklyTick(lunes8), { sent: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.resend.com/emails');
  assert.deepEqual(sent[0].body.to, ['dueno@x.com', 'otro@x.com']);
  assert.match(sent[0].body.subject, /^Patitas <&>: resumen de la semana del 05\/10\/2026 al 11\/10\/2026$/);
  assert.deepEqual(await weekly.weeklyTick(lunes8), { sent: false, reason: 'ya enviado' });
  assert.equal(sent.length, 1);
  assert.deepEqual(await weekly.weeklyTick(new Date('2026-10-13T12:00:00Z')), { sent: false, reason: 'no es el horario' }); // martes
  const log = await weekly.reportLog();
  assert.equal(log.items.length, 1);
  assert.equal(log.items[0].week, '2026-10-05');
  assert.equal(log.items[0].ok, true);
});

test('el HTML trae los títulos de las listas, el pie y escapa el texto', async () => {
  const html = sent[0].body.html;
  for (const t of ['Lo más vendido', 'Poco stock', 'Clientes que dejaron de venir', 'Informe automático del sistema de gestión. Se puede desactivar en Configuración.']) assert.ok(html.includes(t), t);
  assert.ok(html.includes('Patitas &lt;&amp;&gt;: resumen de la semana'));
  assert.ok(html.includes('Nada para mostrar.'));
});

test('un error del proveedor queda en el registro y se informa', async () => {
  await db.query('DELETE FROM report_log');
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ message: 'API key inválida' }) });
  await assert.rejects(() => weekly.weeklyTick(lunes8), /No se pudo enviar el informe: el servicio de email respondió 401: API key inválida/);
  const log = await weekly.reportLog();
  assert.equal(log.items[0].ok, false);
  assert.match(log.items[0].error, /401/);
});

test('lastWeek y lostClients', () => {
  assert.deepEqual(weekly.lastWeek('2026-10-12'), { from: '2026-10-05', to: '2026-10-11' });
  assert.deepEqual(weekly.lastWeek('2026-10-18'), { from: '2026-10-05', to: '2026-10-11' });
  const rows = [
    { name: 'A', purchases: 3, first: '2026-01-01', last: '2026-03-01' },
    { name: 'B', purchases: 1, first: '2026-01-01', last: '2026-01-01' },
    { name: 'C', purchases: 2, first: '2026-09-01', last: '2026-10-01' },
  ];
  const lost = weekly.lostClients(rows, '2026-10-12', 30);
  assert.deepEqual(lost.map((x) => x.name), ['A']);
});
