'use strict';
// Muchos pedidos mandados A LA VEZ: los topes de la página pública tienen que frenar igual que pedido por pedido.
// Usa los valores reales de los topes (sin las variables que los suben en las otras pruebas).
const test = require('node:test');
const assert = require('node:assert/strict');
if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL para correr las pruebas.');
  process.exit(1);
}
const { ENV, PORT, startServer } = require('./helpers');
for (const k of Object.keys(ENV)) if (k.startsWith('TURNOS_')) delete ENV[k];
for (const k of Object.keys(process.env)) if (k.startsWith('TURNOS_')) delete process.env[k];

let child;
const base = 'http://127.0.0.1:' + PORT;
async function call(path, body, ip) {
  const res = await fetch(base + '/api/public' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, 'X-Forwarded-For': ip }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const n8 = () => '4' + String(Math.floor(1000000 + Math.random() * 8999999));
const count = (res, status) => res.filter((r) => r.status === status).length;

test.before(async () => {
  child = await startServer();
});
test.after(() => child && child.kill());

test('40 ingresos fallidos a la vez desde una misma IP: pasan 20 y el resto se corta', async () => {
  const res = await Promise.all(Array.from({ length: 40 }, () => call('/login', { phone: '11 ' + n8() }, '198.51.100.77')));
  assert.equal(count(res, 404), 20, res.map((r) => r.status).join(','));
  assert.equal(count(res, 429), 20);
});

test('150 ingresos fallidos a la vez, cada uno desde otra IP: en total no se pueden probar más de 60 números', async () => {
  // La prueba anterior ya gastó 20 de los 60.
  const res = await Promise.all(Array.from({ length: 150 }, (_, i) => call('/login', { phone: '11 ' + n8() }, '203.0.' + Math.floor(i / 200) + '.' + (i % 200 + 1))));
  assert.equal(count(res, 404), 40, 'probados: ' + count(res, 404));
  assert.equal(count(res, 429), 110);
  const cerrado = res.find((r) => r.status === 429);
  assert.match(cerrado.data.error, /(Llamá a|Consultalo en) la veterinaria/);
});
