'use strict';
// Arreglos de la revisión QA del 20/11/2026. Se corren con:  DATABASE_URL=postgres://... npm test
//  A1: un pedido a "/%00" (byte nulo) ya no apaga el servidor.
//  A2: borrar en Caja el ingreso de un cobro también quita el cobro de la ficha (va a la Papelera y se restaura).
//  M3: todas las tablas tienen RLS (la Data API de Supabase no ve ninguna fila) y el servidor sigue viendo todo.
//  M1: un monto o peso escrito con coma y tres decimales ("2,575") se guarda como 2,58 y no como 2575.
//      Es de pantalla: necesita Playwright (no es dependencia del proyecto). Si no está, se saltea.
//      Con playwright-core y Edge/Chrome instalados: PW_CHANNEL=msedge (o chrome).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { startServer, client, ENV, PORT } = require('./helpers');

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL para correr las pruebas (una base de prueba, nunca la real).');
  process.exit(1);
}
const BASE = 'http://127.0.0.1:' + PORT;
const tag = String(Date.now()).slice(-6);
let server;
const owner = client();

test.before(async () => {
  server = await startServer();
  assert.equal((await owner.login(ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD)).status, 200);
});
test.after(() => server && server.kill());

test('A1: "/%00" responde 400 y el servidor sigue andando', async () => {
  for (const p of ['/%00', '/turnos.html%00', '/vendor/%00x.js', '/index.html%00']) {
    for (const method of ['GET', 'HEAD']) {
      const r = await fetch(BASE + p, { method });
      assert.equal(r.status, 400, method + ' ' + p);
    }
  }
  await new Promise((ok) => setTimeout(ok, 300));
  assert.equal(server.exitCode, null, 'el proceso del servidor no tiene que terminar');
  assert.equal((await fetch(BASE + '/healthz')).status, 200);
  assert.equal((await fetch(BASE + '/')).status, 200);
  assert.equal((await owner.call('GET', '/me')).status, 200);
});

test('M3: RLS activado en todas las tablas; un rol de la Data API no ve filas y el dueño de las tablas sí', async (t) => {
  const r = await owner.call('POST', '/patients', { name: 'RLS ' + tag, species: 'Perro', breed: '', sex: 'Macho', neutered: false, birth: '', weight: '', notes: '', client: { firstName: 'RLS', lastName: tag, phone: '', email: '', address: '' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } });
  await db.connect();
  try {
    const all = await db.query("SELECT c.relname, c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')");
    assert.ok(all.rows.length >= 20, 'tendrían que verse todas las tablas del sistema (' + all.rows.length + ')');
    assert.deepEqual(all.rows.filter((x) => !x.rls).map((x) => x.relname), [], 'tablas sin RLS');
    // El servidor (dueño de las tablas) sigue viendo todo: la mascota recién creada aparece.
    assert.ok((await owner.call('GET', '/bootstrap')).data.patients.some((p) => p.name === 'RLS ' + tag));

    // Simulación dentro de una transacción que se deshace: un rol como "anon" con permiso de lectura no ve filas,
    // y un rol que es dueño de la tabla sí (así se conecta el servidor en Supabase).
    await db.query('BEGIN');
    try {
      await db.query('CREATE ROLE qa_anon_prueba NOLOGIN');
      await db.query('CREATE ROLE qa_dueno_prueba NOLOGIN');
    } catch (e) {
      await db.query('ROLLBACK');
      t.skip('el usuario de la base de prueba no puede crear roles: ' + e.message);
      return;
    }
    try {
      await db.query('GRANT USAGE ON SCHEMA public TO qa_anon_prueba, qa_dueno_prueba');
      await db.query('GRANT SELECT ON clients, patients, cash_movements TO qa_anon_prueba');
      await db.query('ALTER TABLE patients OWNER TO qa_dueno_prueba');
      await db.query('SET LOCAL ROLE qa_anon_prueba');
      const anon = (await db.query('SELECT (SELECT COUNT(*) FROM clients) AS c, (SELECT COUNT(*) FROM patients) AS p, (SELECT COUNT(*) FROM cash_movements) AS m')).rows[0];
      assert.deepEqual([Number(anon.c), Number(anon.p), Number(anon.m)], [0, 0, 0], 'la Data API no tiene que ver filas');
      await db.query('RESET ROLE');
      await db.query('SET LOCAL ROLE qa_dueno_prueba');
      const own = (await db.query('SELECT COUNT(*) AS n FROM patients')).rows[0];
      assert.ok(Number(own.n) >= 1, 'el dueño de la tabla sigue viendo las filas');
    } finally {
      await db.query('ROLLBACK');
    }
  } finally {
    await db.end();
  }
});

test('A2: borrar en Caja el ingreso de un cobro quita el cobro de la ficha y se puede restaurar', async () => {
  const today = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const ok = async (m, p, b) => {
    const r = await owner.call(m, p, b);
    assert.equal(r.status, 200, m + ' ' + p + ' ' + JSON.stringify(r.data));
    return r.data;
  };
  const prod = (await ok('POST', '/products', { name: 'Pipeta A2 ' + tag, category: 'Antiparasitarios', price: 6000, stock: 10, min: 0 })).id;
  const drug = (await ok('POST', '/products', { name: 'Droga A2 ' + tag, category: 'Vacunas', price: 100, stock: 5, min: 0 })).id;
  const svc = (await ok('POST', '/services', { name: 'Consulta A2 ' + tag, category: 'Consultas', price: 8000 })).id;
  const vac = (await ok('POST', '/services', { name: 'Vacuna A2 ' + tag, category: 'Vacunas', price: 9000, productId: drug })).id;
  const pid = (await ok('POST', '/patients', { name: 'Caja ' + tag, species: 'Perro', breed: '', sex: 'Macho', neutered: false, birth: '', weight: '', notes: '', client: { firstName: 'Caja', lastName: tag, phone: '', email: '', address: '' } })).id;
  const ficha = () => ok('GET', '/patients/' + pid);
  const stock = async (id) => (await ok('GET', '/bootstrap')).products.find((p) => p.id === id).stock;
  const mine = async () => (await ok('GET', '/cash?period=month&type=all&group=all')).items.filter((x) => x.concept.includes('A2 ' + tag));
  const byStart = async (s) => (await mine()).find((x) => x.concept.startsWith(s));
  const trashed = async (id) => (await ok('GET', '/trash')).items.some((x) => x.kind === 'charge' && x.id === id);

  // Cobro de dos líneas (consulta + 2 pipetas): se borra en Caja solo el ingreso de las pipetas.
  await ok('POST', '/patients/' + pid + '/charges', { items: [{ type: 'service', id: svc, qty: 1 }, { type: 'product', id: prod, qty: 2 }], date: today, method: 'Efectivo', cash: true });
  assert.equal(await stock(prod), 8);
  const charge = (await ficha()).charges.find((c) => c.concept.startsWith('Pipeta'));
  const mov = await byStart('Pipeta');
  const del = await ok('DELETE', '/cash/' + mov.id);
  assert.deepEqual((await ficha()).charges.map((c) => c.concept), ['Consulta A2 ' + tag], 'el cobro se quita y la otra línea no se toca');
  assert.equal(mov.chargePatient, 'Caja ' + tag, 'la pantalla necesita saber que el ingreso es de un cobro');
  assert.equal(del.charges, 1);
  assert.equal(del.stockDelta, 2);
  assert.equal(await stock(prod), 10);
  assert.ok(await trashed(charge.id), 'el cobro queda en la Papelera');
  assert.equal((await mine()).length, 1);
  // Restaurar: vuelve el cobro, vuelve el ingreso y se descuenta otra vez el stock (una sola vez).
  await ok('POST', '/trash/charge/' + charge.id + '/restore', {});
  assert.equal(await stock(prod), 8);
  assert.equal((await ficha()).charges.length, 2);
  assert.equal((await byStart('Pipeta')).amount, 12000);
  assert.equal((await mine()).length, 2);
  // Y se puede volver a borrar desde Caja con el mismo resultado.
  await ok('DELETE', '/cash/' + (await byStart('Pipeta')).id);
  assert.equal(await stock(prod), 10);
  assert.equal((await ficha()).charges.length, 1);

  // Vacuna con "Cobrar ahora": borrar el ingreso quita el cobro; la vacuna aplicada y su stock quedan como estaban.
  await ok('POST', '/patients/' + pid + '/vaccines', { serviceId: vac, name: 'x', date: today, next: '', charge: { amount: 9000, method: 'Efectivo' } });
  assert.equal(await stock(drug), 4);
  await ok('DELETE', '/cash/' + (await byStart('Vacuna')).id);
  const f = await ficha();
  assert.equal(f.vaccines.length, 1);
  assert.ok(!f.charges.some((c) => c.concept.startsWith('Vacuna')));
  assert.equal(await stock(drug), 4);

  // Venta de mostrador con paciente: se quita el cobro y el stock vuelve una sola vez.
  await ok('POST', '/products/' + prod + '/sell', { qty: 3, method: 'Efectivo', patientId: pid });
  assert.equal(await stock(prod), 7);
  assert.equal((await ok('DELETE', '/cash/' + (await byStart('Venta')).id)).charges, 1);
  assert.equal(await stock(prod), 10);
  assert.equal((await ficha()).charges.length, 1);

  // Sin cobro vinculado (venta sin paciente y egreso manual): se borra como antes.
  await ok('POST', '/products/' + prod + '/sell', { qty: 1, method: 'Efectivo' });
  const anon = await byStart('Venta');
  assert.equal(anon.chargePatient, '');
  assert.equal((await ok('DELETE', '/cash/' + anon.id)).charges, 0);
  assert.equal(await stock(prod), 10);
  const man = (await ok('POST', '/cash', { type: 'out', date: today, amount: 50, concept: 'Gasto A2 ' + tag, category: 'Otros', method: 'Efectivo' })).id;
  assert.equal((await ok('DELETE', '/cash/' + man)).charges, 0);
  assert.equal((await owner.call('DELETE', '/cash/' + man)).status, 404);
});

let pw = null;
try {
  pw = require('playwright');
} catch (e) {
  try {
    pw = process.env.PW_CHANNEL ? require('playwright-core') : null;
  } catch (e2) {
    /* sin Playwright */
  }
}
const chromePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

test('M1: montos y pesos con coma y tres decimales se guardan bien desde la pantalla', { skip: !pw && 'Playwright no está instalado' }, async () => {
  // Datos de prueba por la API: un cliente con su mascota y un servicio.
  const pr = await owner.call('POST', '/patients', { name: 'Decimal ' + tag, species: 'Gato', breed: '', sex: 'Hembra', neutered: false, birth: '', weight: '', notes: '', client: { firstName: 'Decimal', lastName: tag, phone: '', email: '', address: '' } });
  const pid = pr.data.id;
  const sid = (await owner.call('POST', '/services', { name: 'Consulta decimal ' + tag, category: 'Consultas', price: 1000 })).data.id;
  const browser = await pw.chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : { executablePath: chromePath });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const closed = () => page.waitForSelector('dialog[open]', { state: 'detached' });
    await page.goto(BASE);
    await page.fill('#lemail', ENV.ADMIN_EMAIL);
    await page.fill('#lpass', ENV.ADMIN_PASSWORD);
    await page.click('#lbtn');
    await page.waitForSelector('#plist');

    // Ingreso de caja "2,575" → $2,58 (antes: $2.575)
    await page.click('#side [data-action="nav"][data-v="farmacia"]');
    await page.click('[data-action="tab"][data-v="caja"]');
    await page.click('[data-action="cash-in"]');
    await page.fill('dialog[open] [name="amount"]', '2,575');
    await page.fill('dialog[open] [name="concept"]', 'Decimal ' + tag);
    await page.click('dialog[open] [type="submit"]');
    await closed();
    // Y "1.500" sigue siendo mil quinientos.
    await page.click('[data-action="cash-in"]');
    await page.fill('dialog[open] [name="amount"]', '1.500');
    await page.fill('dialog[open] [name="concept"]', 'Miles ' + tag);
    await page.click('dialog[open] [type="submit"]');
    await closed();
    const cash = (await owner.call('GET', '/cash?period=month&type=all&group=all')).data.items;
    assert.equal(cash.find((x) => x.concept === 'Decimal ' + tag).amount, 2.58);
    assert.equal(cash.find((x) => x.concept === 'Miles ' + tag).amount, 1500);

    // Mascota: peso "4,355" → 4,36 kg (antes se rechazaba con "como máximo 150 kg") y cobro con precio "2,575".
    await page.click('#side [data-action="nav"][data-v="pacientes"]');
    await page.fill('#q', 'Decimal ' + tag);
    await page.click('#plist .pitem');
    await page.click('[data-action="add-weight"]');
    await page.fill('dialog[open] [name="kg"]', '4,355');
    await page.click('dialog[open] [type="submit"]');
    await closed();
    await page.click('[data-action="charge"]');
    if (!(await page.locator('dialog[open] .l-item').count())) await page.click('dialog[open] #addline');
    await page.locator('dialog[open] .l-item').first().selectOption('s' + sid);
    await page.locator('dialog[open] .l-price').first().fill('2,575');
    const cashBox = page.locator('dialog[open] [name="cash"]');
    if (await cashBox.isChecked()) await cashBox.uncheck();
    await page.click('dialog[open] [type="submit"]');
    await closed();
    const det = (await owner.call('GET', '/patients/' + pid)).data;
    assert.equal(det.weights[det.weights.length - 1].kg, 4.36);
    assert.equal(det.charges[0].amount, 2.58);
  } finally {
    await browser.close();
  }
});
