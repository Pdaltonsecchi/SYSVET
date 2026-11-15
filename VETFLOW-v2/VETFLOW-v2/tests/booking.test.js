'use strict';
// Turnos web: horarios libres y validaciones (lógica pura, sin base de datos).
const test = require('node:test');
const assert = require('node:assert/strict');
const booking = require('../server/booking');

// 2026-11-16 es lunes. Horario: 09:00 a 12:00 y 16:00 a 19:00. Domingo cerrado.
const HOURS = { 0: null, 1: [['09:00', '12:00'], ['16:00', '19:00']], 2: [['09:00', '19:00']], 3: null, 4: null, 5: null, 6: null };
const LUNES = '2026-11-16';

test('consulta (20 min) ofrece horarios cada 10 min que entran completos en la franja', () => {
  const s = booking.freeSlots({ hours: HOURS, date: LUNES, duration: 20, busy: [] });
  assert.equal(s[0], '09:00');
  assert.equal(s[1], '09:10');
  assert.ok(s.includes('11:40'), '11:40 + 20 = 12:00, justo al cierre de la mañana');
  assert.equal(s.at(-1), '18:40'); // última de la tarde: 18:40 + 20 = 19:00
  assert.ok(s.includes('16:00'));
  assert.ok(!s.includes('12:00'), 'no ofrece horarios fuera de la franja');
});

test('un turno ocupado saca los horarios que se pisan con él', () => {
  // Turno de 10:00 a 10:30 (busy en minutos: 600..630)
  const s = booking.freeSlots({ hours: HOURS, date: LUNES, duration: 20, busy: [[600, 630]] });
  assert.ok(!s.includes('09:50'), '09:50 + 20 pisa 10:00');
  assert.ok(!s.includes('10:00'));
  assert.ok(!s.includes('10:20'), '10:20 queda dentro del turno ocupado');
  assert.ok(s.includes('10:30'), 'el horario que empieza al terminar el turno sí queda libre');
  assert.ok(s.includes('09:40'), '09:40 + 20 = 10:00 justo antes del turno ocupado');
});

test('vacuna (10 min) entra en huecos que la consulta no entraría', () => {
  const busy = [[540, 550], [560, 570]]; // 09:00-09:10 y 09:20-09:30
  const consulta = booking.freeSlots({ hours: HOURS, date: LUNES, duration: 20, busy });
  const vacuna = booking.freeSlots({ hours: HOURS, date: LUNES, duration: 10, busy });
  assert.ok(vacuna.includes('09:10'));
  assert.ok(!consulta.includes('09:10'));
});

test('día cerrado no ofrece horarios', () => {
  assert.deepEqual(booking.freeSlots({ hours: HOURS, date: '2026-11-15', duration: 20, busy: [] }), []); // domingo
});

test('si el día es hoy, no se ofrecen horarios que ya pasaron', () => {
  const s = booking.freeSlots({ hours: HOURS, date: LUNES, duration: 20, busy: [], nowMin: 10 * 60 });
  assert.ok(!s.includes('09:00'));
  assert.ok(s.includes('10:00'));
});

test('canBook acepta solo horarios que aparecen en la lista libre', () => {
  const args = { hours: HOURS, date: LUNES, duration: 20, busy: [[600, 630]] };
  assert.equal(booking.canBook({ ...args, time: '10:30:00' }), true);
  assert.equal(booking.canBook({ ...args, time: '10:10:00' }), false);
  assert.equal(booking.canBook({ ...args, time: '13:00:00' }), false, 'fuera de horario');
});

test('desde la web solo se pueden pedir consultas o vacunas', () => {
  assert.equal(booking.webType('consulta'), 'consulta');
  assert.equal(booking.webType('vacuna'), 'vacuna');
  assert.throws(() => booking.webType('cirugia'), /consultas o vacunas/);
  assert.throws(() => booking.webType('otro'), /consultas o vacunas/);
  assert.throws(() => booking.webType(undefined), /consultas o vacunas/);
});

test('el formato viejo de una sola franja también se acepta', () => {
  const old = { 1: ['09:00', '10:00'] };
  assert.deepEqual(booking.freeSlots({ hours: old, date: LUNES, duration: 20, busy: [] }), ['09:00', '09:10', '09:20', '09:30', '09:40']);
});

test('el límite de pedidos corta después de la cantidad permitida', () => {
  const key = 'test:' + Math.random();
  assert.equal(booking.limit(key, 2, 60000), true);
  assert.equal(booking.limit(key, 2, 60000), true);
  assert.equal(booking.limit(key, 2, 60000), false);
});
