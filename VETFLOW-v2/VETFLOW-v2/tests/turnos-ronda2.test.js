'use strict';
// Página de turnos, ronda 2: horarios por tipo (consulta cada 20, vacuna cada 10), 90 días a la vista, mensaje de la
// veterinaria al confirmar, reseña después de una atención, cancelados a la vista del personal, nombre de la
// veterinaria en turnos.html y mensajes sin "llamá" cuando no hay teléfono cargado. Contra el servidor real.
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL para correr las pruebas.');
  process.exit(1);
}
process.env.DATABASE_SSL = 'false';
const { ENV, PORT, startServer, client } = require('./helpers');
// La base se usa directo solo para simular turnos pasados y cargar muchos turnos de golpe (prueba de rapidez).
const db = require('../server/db');

let child;
const owner = client();
const pub = (token) => ({
  call: (method, path, body) => client().call(method, '/public' + path, body, token ? { 'X-Cliente-Token': token } : {}),
});
const n8 = () => '4' + String(Math.floor(1000000 + Math.random() * 8999999));
const tel = () => '11 ' + n8();
const base = 'http://127.0.0.1:' + PORT;
let today = '';
let original = null; // configuración al empezar: se deja igual al terminar
const addDays = (iso, n) => {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + n, 12));
  return d.toISOString().slice(0, 10);
};
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

async function settingsWith(extra) {
  const cur = (await owner.call('GET', '/settings')).data;
  const body = Object.assign({}, cur, extra);
  delete body.emailReady;
  const r = await owner.call('PUT', '/settings', body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
async function clienteNuevo(nombre) {
  const r = await pub().call('POST', '/register', { firstName: nombre, lastName: 'Ronda2', phone: tel(), pet: { name: 'Mascota ' + nombre, species: 'Perro', sex: 'Macho' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { token: r.data.token, id: r.data.client.id, pet: r.data.pets[0].id };
}
const slots = async (type) => (await pub().call('GET', '/slots?type=' + type)).data;
// Deja la base sin los pedidos pendientes de esta prueba (el tope de 60 pendientes web es para toda la base).
const limpiar = (ids) => Promise.all(ids.map((id) => owner.call('POST', '/appointments/' + id + '/status', { status: 'rechazado' })));

test.before(async () => {
  child = await startServer();
  assert.equal((await owner.login(ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD)).status, 200);
  original = (await owner.call('GET', '/settings')).data;
  // Todos los días abiertos de 08:00 a 20:00: las pruebas no dependen del día ni de la hora en que se corren.
  const h = {};
  for (let d = 0; d < 7; d++) h[d] = [['08:00', '20:00']];
  await settingsWith({ hours: h, shopName: 'Veterinaria Ronda Dos', phone: '11 4444-5555' });
  const r = await db.query("SELECT to_char((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date, 'YYYY-MM-DD') AS d");
  today = r.rows[0].d;
});
test.after(async () => {
  if (original) {
    const body = Object.assign({}, original);
    delete body.emailReady;
    await owner.call('PUT', '/settings', body);
  }
  if (child) child.kill();
  await db.close();
});

/* ---------- A. horarios por tipo ---------- */
test('consulta cada 20 minutos y vacuna cada 10; el servidor solo acepta lo que ofrece', async () => {
  const c = await slots('consulta');
  const v = await slots('vacuna');
  assert.equal(c.step, 20);
  assert.equal(v.step, 10);
  for (const d of c.days) for (const t of d.times) assert.ok(['00', '20', '40'].includes(t.slice(3)), 'consulta a las ' + t);
  assert.ok(v.days.some((d) => d.times.some((t) => ['10', '30', '50'].includes(t.slice(3)))), 'la vacuna usa también :10, :30 y :50');

  const k = await clienteNuevo('Paso');
  const day = c.days[c.days.length - 1];
  const t = day.times.find((x) => x.slice(3) === '20');
  const fuera = toMin(t) - 10; // :10, que no es múltiplo de 20
  const hhmm = String(Math.floor(fuera / 60)).padStart(2, '0') + ':' + String(fuera % 60).padStart(2, '0');
  const mal = await pub(k.token).call('POST', '/appointments', { type: 'consulta', patientId: k.pet, date: day.date, time: hhmm });
  assert.equal(mal.status, 400);
  assert.match(mal.data.error, /ya no está disponible/);
  const bien = await pub(k.token).call('POST', '/appointments', { type: 'consulta', patientId: k.pet, date: day.date, time: t });
  assert.equal(bien.status, 200, JSON.stringify(bien.data));
  await limpiar([bien.data.id]);
});

test('un turno interno con un hueco fuera del paso: lo que se ofrece no pisa nada', async () => {
  const k = await clienteNuevo('Hueco');
  const date = addDays(today, 20);
  // Turnos de la veterinaria de 09:00 a 09:30 y de 10:05 a 10:35.
  const a1 = await owner.call('POST', '/appointments', { patientId: k.pet, title: 'Control', description: '', date, time: '09:00', type: 'otro', duration: 30 });
  const a2 = await owner.call('POST', '/appointments', { patientId: k.pet, title: 'Control 2', description: '', date, time: '10:05', type: 'otro', duration: 30 });
  assert.equal(a1.status, 200);
  assert.equal(a2.status, 200);
  try {
    const c = (await slots('consulta')).days.find((d) => d.date === date).times;
    assert.ok(c.includes('09:40') && !c.includes('09:30') && !c.includes('10:00') && !c.includes('10:20') && c.includes('10:40'), c.join(','));
    const v = (await slots('vacuna')).days.find((d) => d.date === date).times;
    assert.ok(v.includes('09:30') && v.includes('09:50') && !v.includes('10:00') && v.includes('10:40'), v.join(','));
    for (const [type, list, dur] of [['consulta', c, 20], ['vacuna', v, 10]]) {
      for (const t of list) {
        const s = toMin(t);
        assert.ok(!(s < 570 && 540 < s + dur) && !(s < 635 && 605 < s + dur), type + ' a las ' + t + ' pisa un turno interno');
      }
    }
  } finally {
    await owner.call('DELETE', '/appointments/' + a1.data.id);
    await owner.call('DELETE', '/appointments/' + a2.data.id);
  }
});

/* ---------- B. 90 días ---------- */
test('se ofrecen los próximos 90 días y se puede pedir un turno a más de dos meses', async () => {
  const c = await slots('vacuna');
  assert.equal(c.daysAhead, 90);
  assert.equal(c.lastDate, addDays(today, 89));
  const last = c.days[c.days.length - 1];
  assert.equal(last.date, addDays(today, 89), 'con todos los días abiertos, el último día ofrecido es hoy + 89');
  assert.ok(c.days.every((d) => d.date >= today && d.date <= c.lastDate));

  const k = await clienteNuevo('Lejos');
  const date = addDays(today, 75);
  const day = c.days.find((d) => d.date === date);
  const r = await pub(k.token).call('POST', '/appointments', { type: 'vacuna', patientId: k.pet, date, time: day.times[3] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const fuera = await pub(k.token).call('POST', '/appointments', { type: 'vacuna', patientId: k.pet, date: addDays(today, 90), time: '10:00' });
  assert.equal(fuera.status, 400);
  assert.match(fuera.data.error, /próximos 90 días/);
  await limpiar([r.data.id]);
});

test('con muchos turnos cargados, los horarios de 90 días siguen saliendo rápido y la respuesta va comprimida', async () => {
  const k = await clienteNuevo('Carga');
  // 1.800 turnos internos repartidos en los 90 días (20 por día).
  const ins = await db.query(
    "INSERT INTO appointments (patient_id, title, description, appointment_date, appointment_time, appointment_type, duration_min) " +
      "SELECT $1, 'Carga', '', ($2::date + d), make_time(8 + (n % 12), 0, 0), 'otro', 15 FROM generate_series(0, 89) d, generate_series(0, 19) n RETURNING id",
    [k.pet, today]
  );
  assert.equal(ins.rowCount, 1800);
  try {
    const times = [];
    let gz = 0;
    let raw = 0;
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      const res = await fetch(base + '/api/public/slots?type=vacuna', { headers: { 'Accept-Encoding': 'gzip' } });
      const body = Buffer.from(await res.arrayBuffer());
      times.push(Date.now() - t0);
      assert.equal(res.status, 200);
      // fetch descomprime solo; para medir lo que viaja se pide de nuevo con http, sin descomprimir.
      raw = body.length;
    }
    const http = require('http');
    gz = await new Promise((resolve, reject) => {
      http.get(base + '/api/public/slots?type=vacuna', { headers: { 'Accept-Encoding': 'gzip' } }, (res) => {
        assert.equal(res.headers['content-encoding'], 'gzip');
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          assert.ok(JSON.parse(zlib.gunzipSync(buf)).days.length > 0);
          resolve(buf.length);
        });
      }).on('error', reject);
    });
    const best = Math.min(...times);
    console.log('# horarios de 90 días con 1800 turnos: ' + times.join(', ') + ' ms; ' + raw + ' bytes sin comprimir, ' + gz + ' comprimido');
    assert.ok(best < 500, 'tarda ' + best + ' ms');
    assert.ok(gz < 15000, 'la respuesta comprimida pesa ' + gz + ' bytes');
  } finally {
    await db.query('DELETE FROM appointments WHERE patient_id = $1', [k.pet]);
  }
});

/* ---------- C. mensaje de la veterinaria al confirmar ---------- */
test('aceptar con mensaje: el cliente lo ve en su turno confirmado; sin mensaje no aparece nada', async () => {
  const a = await clienteNuevo('Msj');
  const b = await clienteNuevo('Otro');
  const v = (await slots('vacuna')).days;
  const d1 = v[5];
  const d2 = v[6];
  const pa = await pub(a.token).call('POST', '/appointments', { type: 'vacuna', patientId: a.pet, date: d1.date, time: d1.times[0] });
  const pb = await pub(b.token).call('POST', '/appointments', { type: 'vacuna', patientId: b.pet, date: d2.date, time: d2.times[0] });
  assert.equal(pa.status, 200);
  assert.equal(pb.status, 200);
  // Mientras está pendiente, no hay mensaje.
  assert.equal((await pub(a.token).call('GET', '/me')).data.appointments.find((x) => x.id === pa.data.id).message, '');

  const texto = 'Traer al perro en ayunas. <b>negrita</b> <img src=x onerror=alert(1)>';
  const ok = await owner.call('POST', '/appointments/' + pa.data.id + '/status', { status: 'confirmado', message: '  ' + texto + '  ' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.message, texto, 'se guarda sin espacios de más');
  assert.equal((await owner.call('POST', '/appointments/' + pb.data.id + '/status', { status: 'confirmado' })).status, 200);

  const meA = (await pub(a.token).call('GET', '/me')).data;
  const ta = meA.appointments.find((x) => x.id === pa.data.id);
  assert.equal(ta.status, 'confirmado');
  assert.equal(ta.message, texto, 'el texto llega tal cual (la página lo muestra como texto)');
  assert.equal(ta.duration, 10);
  const meB = (await pub(b.token).call('GET', '/me')).data;
  assert.equal(meB.appointments.find((x) => x.id === pb.data.id).message, '', 'aceptado sin mensaje: vacío');
  assert.ok(!JSON.stringify(meB).includes('ayunas'), 'un cliente no ve el mensaje de otro');
  assert.ok(!meB.appointments.some((x) => x.id === pa.data.id));

  // La veterinaria lo ve en el detalle del turno.
  const agenda = await owner.call('GET', '/appointments?from=' + d1.date + '&to=' + d1.date);
  assert.equal(agenda.data.items.find((x) => x.id === pa.data.id).clientMessage, texto);
  await owner.call('DELETE', '/appointments/' + pa.data.id);
  await owner.call('DELETE', '/appointments/' + pb.data.id);
});

test('el mensaje se valida: tipo y largo; al rechazar no se guarda; solo con sesión del personal', async () => {
  const a = await clienteNuevo('Valida');
  const v = (await slots('vacuna')).days;
  const p = await pub(a.token).call('POST', '/appointments', { type: 'vacuna', patientId: a.pet, date: v[7].date, time: v[7].times[1] });
  assert.equal(p.status, 200);
  const id = p.data.id;
  assert.equal((await owner.call('POST', '/appointments/' + id + '/status', { status: 'confirmado', message: 'x'.repeat(301) })).status, 400);
  assert.equal((await owner.call('POST', '/appointments/' + id + '/status', { status: 'confirmado', message: { a: 1 } })).status, 400);
  assert.equal((await owner.call('POST', '/appointments/' + id + '/status', { status: 'confirmado', message: ['x'] })).status, 400);
  // Sin sesión, o con la "sesión" de un cliente de la página, no se puede aceptar ni dejar mensaje.
  assert.equal((await client().call('POST', '/appointments/' + id + '/status', { status: 'confirmado', message: 'hola' })).status, 401);
  assert.equal((await client().call('POST', '/appointments/' + id + '/status', { status: 'confirmado', message: 'hola' }, { 'X-Cliente-Token': a.token })).status, 401);
  // Sigue pendiente después de los intentos fallidos.
  assert.equal((await pub(a.token).call('GET', '/me')).data.appointments.find((x) => x.id === id).status, 'pendiente');
  const rej = await owner.call('POST', '/appointments/' + id + '/status', { status: 'rechazado', message: 'no debería guardarse' });
  assert.equal(rej.status, 200);
  const r = await db.query('SELECT client_message FROM appointments WHERE id = $1', [id]);
  assert.equal(r.rows[0].client_message, '');
  const visto = (await pub(a.token).call('GET', '/me')).data.appointments.find((x) => x.id === id);
  assert.equal(visto.status, 'rechazado');
  assert.equal(visto.message, '');
  // Con 300 caracteres justos, sí.
  const p2 = await pub(a.token).call('POST', '/appointments', { type: 'vacuna', patientId: a.pet, date: v[8].date, time: v[8].times[1] });
  assert.equal((await owner.call('POST', '/appointments/' + p2.data.id + '/status', { status: 'confirmado', message: 'y'.repeat(300) })).status, 200);
  await owner.call('DELETE', '/appointments/' + p2.data.id);
});

test('ninguna ruta pública devuelve el mensaje ni datos internos de otro cliente', async () => {
  const a = await clienteNuevo('Priv');
  const v = (await slots('vacuna')).days;
  const p = await pub(a.token).call('POST', '/appointments', { type: 'vacuna', patientId: a.pet, date: v[9].date, time: v[9].times[2] });
  await owner.call('POST', '/appointments/' + p.data.id + '/status', { status: 'confirmado', message: 'SECRETO-' + p.data.id });
  const secreto = 'SECRETO-' + p.data.id;
  const otro = await clienteNuevo('Curioso');
  const respuestas = [
    await pub().call('GET', '/info'),
    await pub().call('GET', '/slots?type=vacuna'),
    await pub().call('GET', '/slots?type=consulta'),
    await pub(otro.token).call('GET', '/me'),
    await pub(otro.token).call('POST', '/appointments/' + p.data.id + '/cancel'),
    await pub().call('GET', '/me'),
  ];
  for (const r of respuestas) assert.ok(!JSON.stringify(r.data).includes(secreto), JSON.stringify(r.data).slice(0, 200));
  assert.equal(respuestas[4].status, 404, 'no puede cancelar el turno de otro');
  // Lo que ve el dueño del turno: solo lo suyo, sin título, descripción ni datos del personal.
  const mine = (await pub(a.token).call('GET', '/me')).data.appointments.find((x) => x.id === p.data.id);
  assert.deepEqual(Object.keys(mine).sort(), ['canCancel', 'date', 'duration', 'id', 'message', 'patientId', 'patientName', 'status', 'time', 'type', 'typeLabel']);
  await owner.call('DELETE', '/appointments/' + p.data.id);
});

/* ---------- E3. reseña después de una atención ---------- */
test('hadVisit: recién con un turno confirmado que ya pasó', async () => {
  const a = await clienteNuevo('Visita');
  assert.equal((await pub(a.token).call('GET', '/me')).data.hadVisit, false);
  // Un pendiente o un confirmado futuro todavía no es una atención.
  await db.query("INSERT INTO appointments (patient_id, title, description, appointment_date, appointment_time, appointment_type, duration_min, status, source) VALUES ($1, 'x', '', $2, '10:00', 'vacuna', 10, 'pendiente', 'web')", [a.pet, addDays(today, -3)]);
  await db.query("INSERT INTO appointments (patient_id, title, description, appointment_date, appointment_time, appointment_type, duration_min, status, source) VALUES ($1, 'x', '', $2, '10:00', 'vacuna', 10, 'confirmado', 'web')", [a.pet, addDays(today, 3)]);
  assert.equal((await pub(a.token).call('GET', '/me')).data.hadVisit, false);
  await db.query("INSERT INTO appointments (patient_id, title, description, appointment_date, appointment_time, appointment_type, duration_min, status, source) VALUES ($1, 'x', '', $2, '10:00', 'consulta', 20, 'confirmado', 'web')", [a.pet, addDays(today, -2)]);
  const me = (await pub(a.token).call('GET', '/me')).data;
  assert.equal(me.hadVisit, true);
  // Al entrar también viene.
  await db.query("DELETE FROM appointments WHERE patient_id = $1 AND status = 'pendiente'", [a.pet]);
});

/* ---------- E4. cancelados por el cliente ---------- */
test('una cancelación del cliente para hoy o mañana se ve en el resumen y en el calendario', async () => {
  const a = await clienteNuevo('Cancela');
  const manana = addDays(today, 1);
  const v = (await slots('vacuna')).days.find((d) => d.date === manana);
  const p = await pub(a.token).call('POST', '/appointments', { type: 'vacuna', patientId: a.pet, date: manana, time: v.times[v.times.length - 1] });
  assert.equal(p.status, 200);
  assert.equal((await owner.call('POST', '/appointments/' + p.data.id + '/status', { status: 'confirmado' })).status, 200);
  const antes = (await owner.call('GET', '/appointments/pending-summary')).data;
  assert.equal((await pub(a.token).call('POST', '/appointments/' + p.data.id + '/cancel')).status, 200);
  const despues = (await owner.call('GET', '/appointments/pending-summary')).data;
  assert.equal(despues.cancelled, antes.cancelled + 1);
  assert.ok(despues.cancelledFirst <= manana);
  assert.deepEqual((await owner.call('GET', '/bootstrap')).data.pendingWeb, despues);

  const con = (await owner.call('GET', '/appointments?from=' + manana + '&to=' + manana + '&cancelled=1')).data.items;
  assert.equal(con.find((x) => x.id === p.data.id).status, 'cancelado');
  const sin = (await owner.call('GET', '/appointments?from=' + manana + '&to=' + manana)).data.items;
  assert.ok(!sin.some((x) => x.id === p.data.id), 'sin el parámetro, la agenda de siempre (sin cancelados)');
  // El horario quedó libre.
  const v2 = (await slots('vacuna')).days.find((d) => d.date === manana);
  assert.ok(v2.times.includes(v.times[v.times.length - 1]));
  await owner.call('DELETE', '/appointments/' + p.data.id);
});

/* ---------- E2. nombre de la veterinaria en turnos.html ---------- */
test('turnos.html sale con el nombre, la vista previa al compartir y los datos para Google, bien escapados', async () => {
  const raro = 'Vet "Patitas" & Co </script><script>alert(1)</script>';
  await settingsWith({ shopName: raro, address: 'Calle <b>Falsa</b> 123', phone: '11 4444-5555' });
  try {
    const res = await fetch(base + '/turnos.html');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    const html = await res.text();
    assert.ok(!html.includes('<script>alert(1)'), 'el nombre no abre etiquetas');
    assert.ok(!html.includes('SYSVET'));
    assert.match(html, /<title>Vet &quot;Patitas&quot; &amp; Co &lt;\/script&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt; · Turnos online<\/title>/);
    assert.match(html, /<meta property="og:title" content="Vet &quot;Patitas&quot; &amp; Co [^"]*· Turnos online">/);
    assert.match(html, /<meta name="description" content="[^"]*Calle &lt;b&gt;Falsa&lt;\/b&gt; 123\.">/);
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(m, 'hay bloque JSON-LD');
    assert.ok(!/[<>]/.test(m[1]), 'el bloque no tiene < ni >');
    const ld = JSON.parse(m[1]);
    assert.equal(ld['@type'], 'LocalBusiness');
    assert.equal(ld.name, raro);
    assert.equal(ld.address, 'Calle <b>Falsa</b> 123');
    assert.equal(ld.telephone, '11 4444-5555');
    assert.ok(ld.openingHoursSpecification.length === 7 && ld.openingHoursSpecification[0].opens === '08:00');
    // Un solo <script> ejecutable: turnos.js (el JSON-LD es un bloque de datos).
    assert.equal((html.match(/<script(?![^>]*application\/ld\+json)[^>]*>/g) || []).length, 1);
    assert.equal((await pub().call('GET', '/info')).data.clinic, raro);
  } finally {
    await settingsWith({ shopName: 'Veterinaria Ronda Dos', address: '' });
  }
});

test('sin nombre cargado: "Veterinaria", nunca SYSVET, y sin datos para Google', async () => {
  // El nombre es obligatorio en Configuración: se simula una base nueva borrándolo de lo guardado.
  const r = await db.query("SELECT value FROM settings WHERE key = 'app'");
  const saved = JSON.parse(r.rows[0].value);
  const prev = saved.shopName;
  delete saved.shopName;
  await db.query("UPDATE settings SET value = $1 WHERE key = 'app'", [JSON.stringify(saved)]);
  // La configuración se guarda 30 segundos en memoria: se fuerza a releerla guardando algo que no cambia el nombre.
  const pagina = require('../server/pagina');
  try {
    const html = pagina.render('<title>x</title><meta name="description" content="x"></head>', { publicName: '', address: '', hours: {} });
    assert.match(html, /<title>Veterinaria · Turnos online<\/title>/);
    assert.ok(!html.includes('SYSVET'));
    assert.ok(!html.includes('ld+json'));
    const settings = require('../server/settings');
    settings.clearCache();
    const st = await settings.getSettings();
    assert.equal(st.publicName, process.env.CLINIC_NAME || '', 'sin nombre guardado, publicName queda vacío');
    assert.ok(!String(st.publicName).toUpperCase().includes('SYSVET'));
  } finally {
    saved.shopName = prev;
    await db.query("UPDATE settings SET value = $1 WHERE key = 'app'", [JSON.stringify(saved)]);
  }
});

/* ---------- E7. mensajes sin "llamá" cuando no hay teléfono ---------- */
test('sin teléfono cargado, ningún mensaje del ingreso ni de la cancelación dice "llamá"', async () => {
  const n = n8();
  // Mismo teléfono en dos fichas: el ingreso no entra a ninguna y pide ayuda a la veterinaria.
  await owner.call('POST', '/clients', { firstName: 'Doble', lastName: 'Uno', phone: '11 ' + n });
  await owner.call('POST', '/clients', { firstName: 'Doble', lastName: 'Dos', phone: '011 15 ' + n });
  const a = await clienteNuevo('Interno');
  const v = (await slots('consulta')).days;
  const cir = await owner.call('POST', '/appointments', { patientId: a.pet, title: 'Castración', description: '', date: v[4].date, time: '08:00', type: 'cirugia', duration: 60 });

  const conTel = await pub().call('POST', '/login', { phone: '11 ' + n });
  assert.match(conTel.data.error, /Llamá a la veterinaria/);
  assert.match((await pub(a.token).call('POST', '/appointments/' + cir.data.id + '/cancel')).data.error, /llamá a la veterinaria/);

  await settingsWith({ phone: '' });
  try {
    const nf = await pub().call('POST', '/login', { phone: tel() });
    assert.equal(nf.status, 404);
    assert.equal(nf.data.code, 'no-registrado');
    for (const r of [nf, await pub().call('POST', '/login', { phone: '11 ' + n }), await pub(a.token).call('POST', '/appointments/' + cir.data.id + '/cancel')]) {
      assert.doesNotMatch(r.data.error, /llam/i, r.data.error);
    }
    assert.equal((await pub().call('GET', '/info')).data.phone, '');
  } finally {
    await settingsWith({ phone: '11 4444-5555' });
    await owner.call('DELETE', '/appointments/' + cir.data.id);
  }
});

/* ---------- copias de seguridad ---------- */
test('la copia de seguridad guarda el mensaje; una copia vieja se restaura sin mensaje', async () => {
  const a = await clienteNuevo('Copia');
  const v = (await slots('vacuna')).days;
  const p = await pub(a.token).call('POST', '/appointments', { type: 'vacuna', patientId: a.pet, date: v[10].date, time: v[10].times[0] });
  await owner.call('POST', '/appointments/' + p.data.id + '/status', { status: 'confirmado', message: 'Traer la libreta.' });
  const exp = (await owner.call('GET', '/backup/export')).data.data;
  assert.equal(exp.appointments.find((x) => x.id === p.data.id).client_message, 'Traer la libreta.');
  assert.equal((await owner.call('POST', '/restore', { data: exp })).status, 200);
  const igual = (await owner.call('GET', '/backup/export')).data.data;
  assert.deepEqual(igual.appointments, exp.appointments, 'restaurar la copia no cambia los turnos');

  const vieja = JSON.parse(JSON.stringify(exp));
  vieja.appointments.forEach((x) => delete x.client_message);
  assert.equal((await owner.call('POST', '/restore', { data: vieja })).status, 200);
  const despues = (await owner.call('GET', '/backup/export')).data.data;
  assert.ok(despues.appointments.every((x) => x.client_message === ''));
  assert.equal((await owner.call('POST', '/restore', { data: exp })).status, 200);
  await owner.call('DELETE', '/appointments/' + p.data.id);
});

/* ---------- arreglos de la revisión de seguridad ---------- */
test('un "$" en el nombre de la veterinaria no rompe turnos.html', async () => {
  await settingsWith({ shopName: "Vet $'s $& $$ $`" });
  try {
    const html = await (await fetch(base + '/turnos.html')).text();
    assert.equal((html.match(/<body/g) || []).length, 1, 'la plantilla no se duplica');
    assert.equal((html.match(/<script src="turnos.js">/g) || []).length, 1);
    assert.match(html, /<title>Vet \$&#39;s \$&amp; \$\$ \$` · Turnos online<\/title>/);
  } finally {
    await settingsWith({ shopName: 'Veterinaria Ronda Dos' });
  }
});

test('si la veterinaria pasa un turno a otra mascota, el mensaje para el cliente se borra', async () => {
  const a = await clienteNuevo('DuenoA');
  const b = await clienteNuevo('DuenoB');
  const v = (await slots('vacuna')).days;
  const p = await pub(a.token).call('POST', '/appointments', { type: 'vacuna', patientId: a.pet, date: v[11].date, time: v[11].times[0] });
  await owner.call('POST', '/appointments/' + p.data.id + '/status', { status: 'confirmado', message: 'Dato privado de A' });
  const editar = (patientId, title) => owner.call('PUT', '/appointments/' + p.data.id, { patientId, title, description: '', date: v[11].date, time: v[11].times[0], type: 'vacuna', duration: 10 });
  assert.equal((await editar(a.pet, 'Vacuna (cambio de título)')).status, 200);
  assert.equal((await pub(a.token).call('GET', '/me')).data.appointments.find((x) => x.id === p.data.id).message, 'Dato privado de A', 'misma mascota: el mensaje queda');
  assert.equal((await editar(b.pet, 'Vacuna')).status, 200);
  const meB = (await pub(b.token).call('GET', '/me')).data;
  assert.ok(!JSON.stringify(meB).includes('Dato privado'), 'el otro cliente no recibe el mensaje');
  assert.equal(meB.appointments.find((x) => x.id === p.data.id).message, '');
  await owner.call('DELETE', '/appointments/' + p.data.id);
});

test('un mensaje con el carácter nulo da error de validación, no un error interno', async () => {
  const a = await clienteNuevo('Nulo');
  const v = (await slots('vacuna')).days;
  const p = await pub(a.token).call('POST', '/appointments', { type: 'vacuna', patientId: a.pet, date: v[12].date, time: v[12].times[0] });
  const r = await owner.call('POST', '/appointments/' + p.data.id + '/status', { status: 'confirmado', message: 'a' + String.fromCharCode(0) + 'b' });
  assert.equal(r.status, 400);
  await limpiar([p.data.id]);
});

test('hadVisit: un turno de las 23:50 recién cuenta cuando terminó (al día siguiente)', async () => {
  const a = await clienteNuevo('Noche');
  await db.query("INSERT INTO appointments (patient_id, title, description, appointment_date, appointment_time, appointment_type, duration_min, status, source) VALUES ($1, 'x', '', $2, '23:50', 'consulta', 20, 'confirmado', 'web')", [a.pet, today]);
  assert.equal((await pub(a.token).call('GET', '/me')).data.hadVisit, false, 'termina mañana a las 00:10');
  await db.query("UPDATE appointments SET appointment_date = $2 WHERE patient_id = $1", [a.pet, addDays(today, -1)]);
  assert.equal((await pub(a.token).call('GET', '/me')).data.hadVisit, true);
});
