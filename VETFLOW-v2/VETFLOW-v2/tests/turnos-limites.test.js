'use strict';
// Topes de la página pública de turnos con sus valores reales (sin las variables que los suben en las otras pruebas).
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
// Cada pedido dice de qué IP viene: así se prueba que el tope total no depende de la IP.
async function call(path, body, ip) {
  const res = await fetch(base + '/api/public' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, 'X-Forwarded-For': ip }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const n8 = () => '4' + String(Math.floor(1000000 + Math.random() * 8999999));
const alta = (ip, k) => call('/register', { firstName: 'Límite', lastName: 'Prueba ' + k, phone: '11 ' + n8(), pet: { name: 'Pipo', species: 'Perro', sex: 'Macho' } }, ip);

test.before(async () => {
  child = await startServer();
});
test.after(() => child && child.kill());

test('desde una misma IP: 5 clientes nuevos por hora', async () => {
  for (let i = 1; i <= 5; i++) assert.equal((await alta('198.51.100.1', i)).status, 200, 'alta ' + i);
  const sexta = await alta('198.51.100.1', 6);
  assert.equal(sexta.status, 429);
  assert.equal((await alta('198.51.100.2', 7)).status, 200, 'otra IP todavía puede');
});

test('desde una misma IP: 20 ingresos fallidos por hora', async () => {
  for (let i = 1; i <= 20; i++) assert.equal((await call('/login', { phone: '11 ' + n8() }, '198.51.100.50')).status, 404, 'intento ' + i);
  assert.equal((await call('/login', { phone: '11 ' + n8() }, '198.51.100.50')).status, 429);
});

test('probar números cambiando de IP: a los 60 ingresos fallidos en total se cierra el ingreso por un rato', async () => {
  // La prueba anterior ya sumó 20 fallidos: con 40 más, desde 40 IP distintas, se llega al tope total.
  for (let i = 1; i <= 40; i++) assert.equal((await call('/login', { phone: '11 ' + n8() }, '203.0.113.' + i)).status, 404, 'intento ' + i);
  const r = await call('/login', { phone: '11 ' + n8() }, '203.0.113.200');
  assert.equal(r.status, 429);
  assert.match(r.data.error, /Llamá a la veterinaria/);
  // El alta de cliente nuevo también queda cerrada: no sirve para seguir probando números.
  assert.equal((await alta('203.0.113.201', 99)).status, 429);
});
