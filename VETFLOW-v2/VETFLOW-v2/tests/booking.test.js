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

/* ---------- teléfonos: la misma persona escribe su número de muchas formas ---------- */
test('phoneKey deja el número sin 0, 15, 54 ni 9', () => {
  for (const v of ['11 5555-1234', '011 5555-1234', '011 15 5555-1234', '+54 9 11 5555-1234', '+54 11 5555 1234', '0054 9 11 5555 1234', '(011) 15-5555-1234', '54 9 011 15 5555 1234']) {
    assert.equal(booking.phoneKey(v), '1155551234', v);
  }
  // Interior: característica de 3 y de 4 dígitos, con y sin 15.
  for (const v of ['351 555-1234', '0351 15 555-1234', '+54 9 351 555 1234']) assert.equal(booking.phoneKey(v), '3515551234', v);
  for (const v of ['2954 43-1234', '02954 15 43-1234', '+54 9 2954 431234']) assert.equal(booking.phoneKey(v), '2954431234', v);
  // Sin característica queda corto.
  assert.equal(booking.phoneKey('5555-1234'), '55551234');
  assert.equal(booking.phoneKey('15 5555-1234'), '55551234');
  assert.equal(booking.phoneKey(''), '');
  assert.equal(booking.phoneKey(null), '');
});

test('samePhone: 011 contra sin 0, con 15, con 54 9, con espacios y guiones', () => {
  const base = '11 5555-1234';
  for (const v of ['011 5555-1234', '011 15 5555-1234', '54 9 11 5555 1234', '+54 9 11 5555-1234', '11-5555-1234', '1155551234', ' 11  5555 1234 ']) {
    assert.equal(booking.samePhone(base, v), true, v);
    assert.equal(booking.samePhone(v, base), true, v + ' (al revés)');
  }
});

test('samePhone: número corto se compara por los últimos 8; con menos de 8, solo exacto', () => {
  assert.equal(booking.samePhone('5555-1234', '011 15 5555-1234'), true, 'guardado sin característica');
  assert.equal(booking.samePhone('11 5555-1234', '15 5555-1234'), true, 'ingresado sin característica');
  assert.equal(booking.samePhone('555-1234', '555 1234'), true, '7 dígitos iguales');
  assert.equal(booking.samePhone('555-1234', '0351 555-1234'), false, '7 dígitos contra uno completo: no alcanza');
  assert.equal(booking.samePhone('431234', '2954 431234'), false, '6 dígitos contra uno completo: no alcanza');
});

test('samePhone: números distintos no coinciden', () => {
  assert.equal(booking.samePhone('11 5555-1234', '11 5555-1235'), false);
  assert.equal(booking.samePhone('11 5555-1234', '351 555-1234'), false);
  // Misma terminación pero otra característica: con los dos números completos se comparan los 10 dígitos.
  assert.equal(booking.samePhone('11 5555-1234', '22 5555-1234'), false);
  assert.equal(booking.samePhone('', '11 5555-1234'), false);
  assert.equal(booking.samePhone('', ''), false);
});

test('phoneTail y phoneLimitKey: iguales para todas las formas de escribir un número', () => {
  const forms = ['11 5555-1234', '011 15 5555-1234', '+54 9 11 5555-1234', '0351 15 555-1234', '02954 15 43-1234'];
  for (const v of forms) assert.equal(booking.phoneTail(v), booking.phoneKey(v).slice(-6), v);
  assert.equal(booking.phoneLimitKey('011 15 5555-1234'), booking.phoneLimitKey('+54 9 11 5555-1234'));
});
