'use strict';
// Turnos web: horarios libres y validaciones (lógica pura, sin base de datos).
const test = require('node:test');
const assert = require('node:assert/strict');
const booking = require('../server/booking');

// 2026-11-16 es lunes. Horario: 09:00 a 12:00 y 16:00 a 19:00. Domingo cerrado.
const HOURS = { 0: null, 1: [['09:00', '12:00'], ['16:00', '19:00']], 2: [['09:00', '19:00']], 3: null, 4: null, 5: null, 6: null };
const LUNES = '2026-11-16';

// Paso de cada tipo, como lo usa el servidor (consulta cada 20, vacuna cada 10).
const C = { duration: 20, step: booking.stepFor('consulta') };
const V = { duration: 10, step: booking.stepFor('vacuna') };

test('el paso depende del tipo: consulta cada 20 minutos, vacuna cada 10', () => {
  assert.equal(booking.stepFor('consulta'), 20);
  assert.equal(booking.stepFor('vacuna'), 10);
  assert.equal(booking.stepFor('cirugia'), booking.STEP_MIN, 'otro tipo: el paso general');
  const c = booking.freeSlots({ hours: HOURS, date: LUNES, busy: [], ...C });
  assert.deepEqual(c.slice(0, 4), ['09:00', '09:20', '09:40', '10:00']);
  assert.ok(c.every((t) => ['00', '20', '40'].includes(t.slice(3))), 'la consulta cae siempre en :00, :20 o :40');
  const v = booking.freeSlots({ hours: HOURS, date: LUNES, busy: [], ...V });
  assert.deepEqual(v.slice(0, 7), ['09:00', '09:10', '09:20', '09:30', '09:40', '09:50', '10:00']);
});

test('un hueco que deja un turno interno fuera del paso: la consulta se ofrece en el múltiplo de 20 siguiente y no pisa nada', () => {
  // Turnos de la veterinaria de 09:00 a 09:30 y de 10:05 a 10:35: queda libre de 09:30 a 10:05.
  const busy = [[540, 570], [605, 635]];
  const c = booking.freeSlots({ hours: HOURS, date: LUNES, busy, ...C });
  assert.ok(!c.includes('09:30'), '09:30 no es múltiplo de 20');
  assert.ok(c.includes('09:40'), '09:40 a 10:00 entra entero en el hueco');
  assert.ok(!c.includes('10:00'), '10:00 a 10:20 pisa el turno de las 10:05');
  assert.ok(!c.includes('10:20'), '10:20 queda dentro del turno de las 10:05');
  assert.ok(c.includes('10:40'), 'al terminar el turno (10:35) sigue el próximo múltiplo de 20');
  // Ningún horario ofrecido se superpone con un turno ocupado.
  for (const t of c) {
    const s = booking.toMin(t);
    assert.ok(!busy.some(([a, b]) => s < b && a < s + 20), t + ' pisa un turno');
  }
  const v = booking.freeSlots({ hours: HOURS, date: LUNES, busy, ...V });
  assert.ok(v.includes('09:30') && v.includes('09:50'), 'la vacuna usa el hueco de a 10 minutos');
  assert.ok(!v.includes('10:00'), '10:00 a 10:10 pisa el turno de las 10:05');
  // canBook valida con el mismo paso: lo que se ofrece es lo único que se acepta.
  assert.equal(booking.canBook({ hours: HOURS, date: LUNES, busy, time: '09:40', ...C }), true);
  assert.equal(booking.canBook({ hours: HOURS, date: LUNES, busy, time: '09:30', ...C }), false);
  assert.equal(booking.canBook({ hours: HOURS, date: LUNES, busy, time: '09:30', ...V }), true);
});

test('una franja que abre a una hora fuera del paso: la consulta empieza en el múltiplo de 20 siguiente', () => {
  const h = { 1: [['09:30', '11:00']] };
  assert.deepEqual(booking.freeSlots({ hours: h, date: LUNES, busy: [], ...C }), ['09:40', '10:00', '10:20', '10:40']);
  assert.equal(booking.freeSlots({ hours: h, date: LUNES, busy: [], ...V })[0], '09:30');
});

test('consulta (20 min) ofrece horarios que entran completos en la franja', () => {
  const s = booking.freeSlots({ hours: HOURS, date: LUNES, busy: [], ...C });
  assert.equal(s[0], '09:00');
  assert.equal(s[1], '09:20');
  assert.ok(s.includes('11:40'), '11:40 + 20 = 12:00, justo al cierre de la mañana');
  assert.equal(s.at(-1), '18:40'); // última de la tarde: 18:40 + 20 = 19:00
  assert.ok(s.includes('16:00'));
  assert.ok(!s.includes('12:00'), 'no ofrece horarios fuera de la franja');
});

test('un turno ocupado saca los horarios que se pisan con él', () => {
  // Turno de 10:00 a 10:30 (busy en minutos: 600..630)
  const s = booking.freeSlots({ hours: HOURS, date: LUNES, busy: [[600, 630]], ...V });
  assert.ok(s.includes('09:50'), '09:50 + 10 = 10:00: la vacuna entra justo antes');
  const c = booking.freeSlots({ hours: HOURS, date: LUNES, busy: [[600, 630]], ...C });
  assert.ok(!c.includes('10:00'));
  assert.ok(!c.includes('10:20'), '10:20 queda dentro del turno ocupado');
  assert.ok(c.includes('10:40'), 'el primer múltiplo de 20 después del turno sí queda libre');
  assert.ok(c.includes('09:40'), '09:40 + 20 = 10:00 justo antes del turno ocupado');
  assert.ok(!s.includes('10:20') && s.includes('10:30'), 'la vacuna arranca justo al terminar el turno');
});

test('vacuna (10 min) entra en huecos que la consulta no entraría', () => {
  const busy = [[540, 550], [560, 570]]; // 09:00-09:10 y 09:20-09:30
  const consulta = booking.freeSlots({ hours: HOURS, date: LUNES, busy, ...C });
  const vacuna = booking.freeSlots({ hours: HOURS, date: LUNES, busy, ...V });
  assert.ok(vacuna.includes('09:10'));
  assert.ok(!consulta.includes('09:10'));
});

test('día cerrado no ofrece horarios', () => {
  assert.deepEqual(booking.freeSlots({ hours: HOURS, date: '2026-11-15', duration: 20, busy: [] }), []); // domingo
});

test('si el día es hoy, no se ofrecen horarios que ya pasaron', () => {
  const s = booking.freeSlots({ hours: HOURS, date: LUNES, busy: [], nowMin: 10 * 60, ...C });
  assert.ok(!s.includes('09:00'));
  assert.ok(s.includes('10:00'));
});

test('canBook acepta solo horarios que aparecen en la lista libre', () => {
  const args = { hours: HOURS, date: LUNES, busy: [[600, 630]], ...C };
  assert.equal(booking.canBook({ ...args, time: '10:40:00' }), true);
  assert.equal(booking.canBook({ ...args, time: '10:30:00' }), false, 'la consulta no se acepta fuera de :00, :20, :40');
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
  assert.deepEqual(booking.freeSlots({ hours: old, date: LUNES, busy: [], ...C }), ['09:00', '09:20', '09:40']);
  assert.deepEqual(booking.freeSlots({ hours: old, date: LUNES, busy: [], duration: 20 }), ['09:00', '09:10', '09:20', '09:30', '09:40'], 'sin paso: el general de 10');
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

/* ---------- límites: no se vacían ni se inflan ---------- */
test('blocked y hit: se puede contar solo lo que falla, sin sumar al consultar', () => {
  const key = 'prueba-a:' + Math.random();
  assert.equal(booking.blocked(key, 2), false);
  booking.hit(key, 60000);
  assert.equal(booking.blocked(key, 2), false);
  booking.hit(key, 60000);
  assert.equal(booking.blocked(key, 2), true);
  assert.equal(booking.blocked(key, 2), true, 'consultar no cambia nada');
});

test('llenar un grupo de claves no toca los otros grupos ni deja afuera a los visitantes nuevos', () => {
  const g = 'prueba-b' + Math.floor(Math.random() * 1e9);
  const otro = 'prueba-c' + Math.floor(Math.random() * 1e9) + ':x';
  const total = 'prueba-e' + Math.floor(Math.random() * 1e9) + ':todos';
  assert.equal(booking.limit(otro, 1, 60000), true);
  for (let i = 0; i < 3; i++) booking.hit(total, 60000);
  for (let i = 0; i < 12000; i++) booking.limit(g + ':relleno-' + i, 1, 60000);
  assert.equal(booking.limit(otro, 1, 60000), false, 'el otro grupo conserva su cuenta');
  assert.equal(booking.blocked(total, 3), true, 'un tope total (una sola clave) nunca se pierde');
  // Con el grupo lleno, un visitante nuevo tiene su propia cuenta: no paga por lo que hicieron los demás.
  assert.equal(booking.limit(g + ':nueva-1', 2, 60000), true);
  assert.equal(booking.limit(g + ':nueva-1', 2, 60000), true);
  assert.equal(booking.limit(g + ':nueva-1', 2, 60000), false, 'y su tope se sigue aplicando');
});

test('unhit devuelve un intento anotado (el ingreso que al final salió bien)', () => {
  const key = 'prueba-f:' + Math.random();
  booking.hit(key, 60000);
  booking.hit(key, 60000);
  assert.equal(booking.blocked(key, 2), true);
  booking.unhit(key);
  assert.equal(booking.blocked(key, 2), false);
  booking.unhit(key);
  booking.unhit(key);
  booking.unhit('prueba-f:no-existe');
  booking.hit(key, 60000);
  assert.equal(booking.blocked(key, 1), true, 'nunca queda en negativo');
});

test('las claves larguísimas se recortan (no se puede inflar la memoria)', () => {
  const g = 'prueba-d' + Math.floor(Math.random() * 1e9) + ':';
  const largo = 'a'.repeat(64);
  assert.equal(booking.limit(g + largo + 'x'.repeat(20000), 1, 60000), true);
  assert.equal(booking.limit(g + largo + 'y'.repeat(20000), 1, 60000), false, 'misma clave una vez recortada');
});

test('la IP del visitante: CF-Connecting-IP primero, y nunca un texto que no sea una IP', () => {
  const U = require('../server/util');
  const req = (h) => ({ headers: h, socket: { remoteAddress: '10.0.0.9' } });
  assert.equal(U.clientIp(req({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4' })), '203.0.113.7');
  assert.equal(U.clientIp(req({ 'x-forwarded-for': '198.51.100.4, 10.0.0.1' })), '198.51.100.4');
  assert.equal(U.clientIp(req({ 'x-forwarded-for': 'cualquier cosa ' + 'x'.repeat(5000) })), '10.0.0.9');
  assert.equal(U.clientIp(req({})), '10.0.0.9');
  // IPv6: se cuenta el bloque /64 (una casa tiene millones de direcciones dentro de un mismo bloque).
  const v6 = (ip) => U.clientIp(req({ 'cf-connecting-ip': ip }));
  assert.equal(U.clientIp(req({ 'cf-connecting-ip': 'no-es-ip', 'x-forwarded-for': '2001:db8::1' })), '2001:db8:0:0::/64');
  assert.equal(v6('2001:0db8:00ab:0001:aaaa:bbbb:cccc:dddd'), v6('2001:db8:ab:1::9'));
  assert.notEqual(v6('2001:db8:ab:1::9'), v6('2001:db8:ab:2::9'));
  assert.equal(v6('::1'), '0:0:0:0::/64');
  assert.equal(v6('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(U.clientIp({ headers: {}, socket: { remoteAddress: '::ffff:127.0.0.1' } }), '127.0.0.1');
});
