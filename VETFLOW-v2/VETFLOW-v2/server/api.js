'use strict';

const db = require('./db');
const auth = require('./auth');
const backup = require('./backup');
const U = require('./util');
const { HttpError } = U;

const routes = [];

/**
 * Registra una ruta. opts: { public: true } no pide sesión; { admin: true } solo administradores;
 * { limit: bytes } tamaño máximo de los datos que se reciben.
 */
function add(method, pattern, opts, fn) {
  if (typeof opts === 'function') {
    fn = opts;
    opts = {};
  }
  const names = [];
  const re = new RegExp(
    '^' +
      pattern.replace(/:([a-z]+)/g, (m, n) => {
        names.push(n);
        return '([^/]+)';
      }) +
      '$'
  );
  routes.push({ method, re, names, opts, fn });
}

function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try {
    return new URL(o).host === req.headers.host;
  } catch (e) {
    return false;
  }
}

async function dispatch(req, res, url) {
  let route = null;
  let match = null;
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(url.pathname);
    if (m) {
      route = r;
      match = m;
      break;
    }
  }
  if (!route) {
    if (routes.some((r) => r.re.test(url.pathname))) throw new HttpError(405, 'Método no permitido');
    throw new HttpError(404, 'No encontrado');
  }
  const params = {};
  try {
    route.names.forEach((n, i) => {
      params[n] = decodeURIComponent(match[i + 1]);
    });
  } catch (e) {
    throw U.bad('Dirección inválida');
  }
  const writes = req.method !== 'GET' && req.method !== 'HEAD';
  if (writes && !sameOrigin(req)) throw new HttpError(403, 'Origen no permitido');

  let user = null;
  if (!route.opts.public) {
    user = await auth.currentUser(req);
    if (!user) throw new HttpError(401, 'Necesitás iniciar sesión');
    if (route.opts.admin && user.role !== 'admin') throw new HttpError(403, 'No tenés permiso para hacer esto');
  }
  let body = {};
  if (writes && req.method !== 'DELETE') {
    const len = Number(req.headers['content-length'] || 0);
    if (len > 0 && !String(req.headers['content-type'] || '').includes('application/json')) {
      throw new HttpError(415, 'Formato no permitido');
    }
    body = await U.readBody(req, route.opts.limit || 1024 * 1024);
  }
  const ctx = { req, res, params, query: url.searchParams, body, user };
  const result = await route.fn(ctx);
  if (result === U.HANDLED) return;
  U.sendJson(res, 200, result === undefined ? { ok: true } : result);
}

/* ============================================================
   Datos comunes
   ============================================================ */
const PATIENT_COLS = 'id, name, species, breed, sex, neutered, birth, weight, owner_name, phone, email, notes';

const mapPatient = (r) => ({
  id: r.id,
  name: r.name,
  species: r.species,
  breed: r.breed,
  sex: r.sex,
  neutered: !!r.neutered,
  birth: r.birth || '',
  weight: r.weight == null ? '' : Number(r.weight),
  owner: r.owner_name,
  phone: r.phone,
  email: r.email,
  notes: r.notes,
});
const mapVaccine = (r) => ({ id: r.id, name: r.name, date: r.applied_on, next: r.next_on || '' });
const mapProduct = (r) => ({ id: r.id, name: r.name, category: r.category, stock: r.stock, min: r.min_stock, price: Number(r.price) });
// v2: productId (nullable) es el producto del stock que se descuenta al aplicar esta vacuna.
const mapService = (r) => ({ id: r.id, name: r.name, category: r.category, price: Number(r.price), productId: r.product_id || null });
const mapSupplier = (r) => ({ id: r.id, name: r.name, phone: r.phone, email: r.email, description: r.description });
const mapStudy = (r) => ({ id: r.id, date: r.on_date, title: r.title, notes: r.notes });
const mapAppointment = (r) => ({
  id: r.id,
  patientId: r.patient_id,
  patientName: r.patient_name,
  title: r.title,
  description: r.description,
  date: r.appointment_date,
  time: String(r.appointment_time).slice(0, 5),
  type: r.appointment_type,
});
const mapCash = (r) => ({
  id: r.id,
  date: r.on_date,
  type: r.kind,
  concept: r.concept,
  category: r.category,
  method: r.method,
  amount: Number(r.amount),
});

async function listPatients() {
  const [p, v] = await Promise.all([
    db.query('SELECT ' + PATIENT_COLS + ' FROM patients ORDER BY lower(name), id'),
    db.query('SELECT id, patient_id, name, applied_on, next_on FROM vaccines ORDER BY applied_on DESC, id DESC'),
  ]);
  const by = {};
  v.rows.forEach((x) => {
    (by[x.patient_id] = by[x.patient_id] || []).push(mapVaccine(x));
  });
  return p.rows.map((r) => Object.assign(mapPatient(r), { vaccines: by[r.id] || [] }));
}
async function listProducts() {
  const r = await db.query('SELECT id, name, category, stock, min_stock, price FROM products ORDER BY lower(name), id');
  return r.rows.map(mapProduct);
}
async function listServices() {
  const r = await db.query('SELECT id, name, category, price, product_id FROM services ORDER BY lower(name), id');
  return r.rows.map(mapService);
}

async function cashSummary() {
  const today = U.todayAR();
  const monthFrom = today.slice(0, 7) + '-01';
  const [rows, drawer] = await Promise.all([
    db.query('SELECT on_date, kind, method, amount FROM cash_movements WHERE on_date >= $1', [monthFrom]),
    db.query("SELECT COALESCE(SUM(CASE WHEN kind = 'in' THEN amount ELSE -amount END), 0) AS total FROM cash_movements WHERE method = 'Efectivo'"),
  ]);
  const m = { in: 0, out: 0, efe: 0, tra: 0, tar: 0, byMethod: {} };
  U.METHODS.forEach((x) => {
    m.byMethod[x] = 0;
  });
  const t = { in: 0, out: 0 };
  rows.rows.forEach((r) => {
    const a = Number(r.amount);
    if (r.kind === 'in') {
      m.in += a;
      m.byMethod[r.method] = (m.byMethod[r.method] || 0) + a;
      if (r.method === 'Efectivo') m.efe += a;
      else if (r.method === 'Transferencia') m.tra += a;
      else m.tar += a;
    } else {
      m.out += a;
    }
    if (r.method === 'Efectivo' && r.on_date === today) {
      if (r.kind === 'in') t.in += a;
      else t.out += a;
    }
  });
  ['in', 'out', 'efe', 'tra', 'tar'].forEach((k) => {
    m[k] = U.round2(m[k]);
  });
  Object.keys(m.byMethod).forEach((k) => {
    m.byMethod[k] = U.round2(m.byMethod[k]);
  });
  return {
    today,
    month: m,
    drawer: U.round2(Number(drawer.rows[0].total)),
    todayCash: { in: U.round2(t.in), out: U.round2(t.out) },
  };
}

async function mustExist(table, id, message) {
  const r = await db.query('SELECT id FROM ' + table + ' WHERE id = $1', [id]);
  if (!r.rows[0]) throw new HttpError(404, message);
}

/* ============================================================
   Sesión y usuarios
   ============================================================ */
function checkPassword(p) {
  if (typeof p !== 'string' || p.length < 8) throw U.bad('La contraseña debe tener al menos 8 caracteres');
  if (p.length > 200) throw U.bad('La contraseña es demasiado larga');
  return p;
}

add('POST', '/api/login', { public: true }, async (ctx) => {
  const email = U.reqStr(ctx.body.email, 'Email', 200).toLowerCase();
  const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  const key = U.clientIp(ctx.req) + '|' + email;
  const wait = auth.throttleCheck(key);
  if (wait > 0) throw new HttpError(429, 'Demasiados intentos. Probá de nuevo en ' + Math.ceil(wait / 60) + ' minutos.');
  const r = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  const u = r.rows[0];
  let ok = false;
  if (u) ok = await auth.verifyPassword(password, u.password_hash);
  else await auth.verifyPassword(password, await auth.dummyHash());
  if (!ok || !u.active) {
    auth.throttleFail(key);
    throw new HttpError(401, 'Email o contraseña incorrectos');
  }
  auth.throttleOk(key);
  auth.setSession(ctx.res, u);
  backup.ensureDaily().catch((e) => console.error('Copia diaria:', e.message));
  return { user: { id: u.id, name: u.name, email: u.email, role: u.role } };
});

add('POST', '/api/logout', { public: true }, async (ctx) => {
  auth.clearSession(ctx.res);
});

add('GET', '/api/me', async (ctx) => ({ user: ctx.user }));

add('POST', '/api/me/password', async (ctx) => {
  const r = await db.query('SELECT * FROM users WHERE id = $1', [ctx.user.id]);
  const u = r.rows[0];
  if (!(await auth.verifyPassword(String(ctx.body.current || ''), u.password_hash))) {
    throw U.bad('La contraseña actual no es correcta');
  }
  const hash = await auth.hashPassword(checkPassword(ctx.body.password));
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, u.id]);
  u.password_hash = hash;
  auth.setSession(ctx.res, u);
});

add('GET', '/api/users', { admin: true }, async () => {
  const r = await db.query('SELECT id, email, name, role, active FROM users ORDER BY lower(name), id');
  return { items: r.rows.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, active: !!u.active })) };
});

add('POST', '/api/users', { admin: true }, async (ctx) => {
  const b = ctx.body;
  const name = U.reqStr(b.name, 'Nombre', 100);
  const email = U.checkEmail(U.reqStr(b.email, 'Email', 150).toLowerCase());
  const pw = checkPassword(b.password);
  const role = U.oneOf(b.role, ['admin', 'staff'], 'Rol');
  try {
    await db.query('INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4)', [
      email,
      name,
      await auth.hashPassword(pw),
      role,
    ]);
  } catch (e) {
    if (e.code === '23505' || /UNIQUE/i.test(e.message)) throw new HttpError(409, 'Ya existe un usuario con ese email');
    throw e;
  }
});

add('PATCH', '/api/users/:id', { admin: true }, async (ctx) => {
  const id = U.idParam(ctx.params.id);
  const b = ctx.body;
  const cur = (await db.query('SELECT * FROM users WHERE id = $1', [id])).rows[0];
  if (!cur) throw new HttpError(404, 'No se encontró el usuario');
  const name = b.name !== undefined ? U.reqStr(b.name, 'Nombre', 100) : cur.name;
  const role = b.role !== undefined ? U.oneOf(b.role, ['admin', 'staff'], 'Rol') : cur.role;
  const active = b.active !== undefined ? !!b.active : !!cur.active;
  if (id === ctx.user.id && (role !== 'admin' || !active)) {
    throw U.bad('No podés quitarte el rol de administrador ni desactivarte a vos mismo');
  }
  if (cur.role === 'admin' && (role !== 'admin' || !active)) {
    const n = (await db.query("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = $1 AND id <> $2", [true, id])).rows[0].n;
    if (Number(n) < 1) throw U.bad('Tiene que quedar al menos un administrador activo');
  }
  let hash = cur.password_hash;
  if (b.password !== undefined && b.password !== '') hash = await auth.hashPassword(checkPassword(b.password));
  await db.query('UPDATE users SET name = $1, role = $2, active = $3, password_hash = $4 WHERE id = $5', [name, role, active, hash, id]);
});

/* ============================================================
   Arranque de la pantalla
   ============================================================ */
add('GET', '/api/bootstrap', async (ctx) => {
  const [patients, products, services] = await Promise.all([listPatients(), listProducts(), listServices()]);
  const out = { user: ctx.user, patients, products, services };
  if (ctx.user.role === 'admin') out.summary = await cashSummary();
  return out;
});

/* ============================================================
   Pacientes
   ============================================================ */
function patientInput(b) {
  return {
    name: U.reqStr(b.name, 'Nombre', 100),
    species: U.oneOf(b.species, ['Perro', 'Gato'], 'Especie'),
    breed: U.optStr(b.breed, 100),
    sex: U.oneOf(b.sex, ['Macho', 'Hembra'], 'Sexo'),
    neutered: !!b.neutered,
    birth: U.optDate(b.birth, 'Fecha de nacimiento'),
    weight: b.weight === '' || b.weight == null ? null : U.reqNum(b.weight, 'Peso', 0, 200),
    owner: U.reqStr(b.owner, 'Dueño', 150),
    phone: U.optStr(b.phone, 50),
    email: U.checkEmail(U.optStr(b.email, 150)),
    notes: U.optStr(b.notes, 1000),
  };
}
const patientParams = (p) => [p.name, p.species, p.breed, p.sex, p.neutered, p.birth, p.weight, p.owner, p.phone, p.email, p.notes];

add('POST', '/api/patients', async (ctx) => {
  const p = patientInput(ctx.body);
  const r = await db.query(
    'INSERT INTO patients (name, species, breed, sex, neutered, birth, weight, owner_name, phone, email, notes) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id',
    patientParams(p)
  );
  return { id: r.rows[0].id };
});

add('GET', '/api/patients/:id', async (ctx) => {
  const id = U.idParam(ctx.params.id);
  const r = await db.query('SELECT ' + PATIENT_COLS + ' FROM patients WHERE id = $1', [id]);
  if (!r.rows[0]) throw new HttpError(404, 'No se encontró el paciente');
  const [v, d, m, c, s] = await Promise.all([
    db.query('SELECT id, name, applied_on, next_on FROM vaccines WHERE patient_id = $1 ORDER BY applied_on DESC, id DESC', [id]),
    db.query('SELECT id, on_date, title, notes FROM diagnoses WHERE patient_id = $1 ORDER BY on_date DESC, id DESC', [id]),
    db.query('SELECT id, on_date, name, dose, duration FROM medications WHERE patient_id = $1 ORDER BY on_date DESC, id DESC', [id]),
    db.query('SELECT id, on_date, concept, amount, method FROM charges WHERE patient_id = $1 ORDER BY on_date DESC, id DESC', [id]),
    db.query('SELECT id, on_date, title, notes FROM complementary_studies WHERE patient_id = $1 ORDER BY on_date DESC, id DESC', [id]),
  ]);
  return Object.assign(mapPatient(r.rows[0]), {
    vaccines: v.rows.map(mapVaccine),
    diagnoses: d.rows.map((x) => ({ id: x.id, date: x.on_date, title: x.title, notes: x.notes })),
    meds: m.rows.map((x) => ({ id: x.id, date: x.on_date, name: x.name, dose: x.dose, duration: x.duration })),
    charges: c.rows.map((x) => ({ id: x.id, date: x.on_date, concept: x.concept, amount: Number(x.amount), method: x.method })),
    studies: s.rows.map(mapStudy), // v2: estudios complementarios (ecografía, radiografía, análisis, etc.)
  });
});

add('PUT', '/api/patients/:id', async (ctx) => {
  const id = U.idParam(ctx.params.id);
  const p = patientInput(ctx.body);
  const r = await db.query(
    'UPDATE patients SET name = $1, species = $2, breed = $3, sex = $4, neutered = $5, birth = $6, weight = $7, ' +
      'owner_name = $8, phone = $9, email = $10, notes = $11 WHERE id = $12 RETURNING id',
    patientParams(p).concat([id])
  );
  if (!r.rows[0]) throw new HttpError(404, 'No se encontró el paciente');
});

add('DELETE', '/api/patients/:id', { admin: true }, async (ctx) => {
  const id = U.idParam(ctx.params.id);
  await db.query('DELETE FROM patients WHERE id = $1', [id]);
});

// v2: si la vacuna se elige de la lista de precios (serviceId) y ese servicio tiene un producto
// de stock vinculado, se descuenta 1 unidad automáticamente. A diferencia del descuento por
// medicación, acá se permite que el stock quede en negativo (para dejar registrado que hay que
// reponer) y se avisa con "stockWarning" para que la pantalla muestre la alerta en rojo.
add('POST', '/api/patients/:id/vaccines', async (ctx) => {
  const id = U.idParam(ctx.params.id);
  const b = ctx.body;
  const name = U.reqStr(b.name, 'Vacuna', 100);
  const date = U.reqDate(b.date, 'Fecha de aplicación');
  const next = U.optDate(b.next, 'Próxima dosis');
  const serviceId = b.serviceId ? U.idParam(b.serviceId) : null;
  return db.tx(async (c) => {
    const pat = await c.query('SELECT name FROM patients WHERE id = $1', [id]);
    if (!pat.rows[0]) throw new HttpError(404, 'No se encontró el paciente');
    await c.query('INSERT INTO vaccines (patient_id, name, applied_on, next_on) VALUES ($1, $2, $3, $4)', [id, name, date, next]);
    let stockWarning = false;
    if (serviceId) {
      const svc = await c.query('SELECT product_id FROM services WHERE id = $1', [serviceId]);
      if (!svc.rows[0]) throw new HttpError(404, 'No se encontró el servicio de la lista de precios');
      if (svc.rows[0].product_id) {
        const r = await c.query('UPDATE products SET stock = stock - 1 WHERE id = $1 RETURNING name, stock', [svc.rows[0].product_id]);
        if (r.rows[0]) {
          await c.query(
            'INSERT INTO stock_movements (product_id, product_name, on_date, qty, reason, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
            [svc.rows[0].product_id, r.rows[0].name, date, -1, 'Vacuna aplicada a ' + pat.rows[0].name, ctx.user.id]
          );
          stockWarning = r.rows[0].stock <= 0;
        }
      }
    }
    return { ok: true, stockWarning };
  });
});
add('DELETE', '/api/vaccines/:id', async (ctx) => {
  await db.query('DELETE FROM vaccines WHERE id = $1', [U.idParam(ctx.params.id)]);
});

add('POST', '/api/patients/:id/diagnoses', async (ctx) => {
  const id = U.idParam(ctx.params.id);
  const b = ctx.body;
  const date = U.reqDate(b.date, 'Fecha');
  const title = U.reqStr(b.title, 'Diagnóstico', 200);
  const notes = U.optStr(b.notes, 3000);
  await mustExist('patients', id, 'No se encontró el paciente');
  await db.query('INSERT INTO diagnoses (patient_id, on_date, title, notes) VALUES ($1, $2, $3, $4)', [id, date, title, notes]);
});
add('DELETE', '/api/diagnoses/:id', async (ctx) => {
  await db.query('DELETE FROM diagnoses WHERE id = $1', [U.idParam(ctx.params.id)]);
});

// v2: estudios complementarios (ecografía, radiografía, análisis, etc.), igual que diagnósticos.
add('POST', '/api/patients/:id/studies', async (ctx) => {
  const id = U.idParam(ctx.params.id);
  const b = ctx.body;
  const date = U.reqDate(b.date, 'Fecha');
  const title = U.reqStr(b.title, 'Tipo de estudio', 200);
  const notes = U.optStr(b.notes, 3000);
  await mustExist('patients', id, 'No se encontró el paciente');
  await db.query('INSERT INTO complementary_studies (patient_id, on_date, title, notes) VALUES ($1, $2, $3, $4)', [id, date, title, notes]);
});
add('DELETE', '/api/studies/:id', async (ctx) => {
  await db.query('DELETE FROM complementary_studies WHERE id = $1', [U.idParam(ctx.params.id)]);
});

add('POST', '/api/patients/:id/medications', async (ctx) => {
  const id = U.idParam(ctx.params.id);
  const b = ctx.body;
  const date = U.reqDate(b.date, 'Fecha');
  const name = U.reqStr(b.name, 'Medicamento', 200);
  const dose = U.optStr(b.dose, 200);
  const duration = U.optStr(b.duration, 200);
  const productId = b.productId ? U.idParam(b.productId) : null;
  await mustExist('patients', id, 'No se encontró el paciente');
  return db.tx(async (c) => {
    await c.query('INSERT INTO medications (patient_id, on_date, name, dose, duration) VALUES ($1, $2, $3, $4, $5)', [id, date, name, dose, duration]);
    let deducted = false;
    if (productId) {
      const r = await c.query('UPDATE products SET stock = stock - 1 WHERE id = $1 AND stock >= 1 RETURNING name', [productId]);
      if (r.rows[0]) {
        deducted = true;
        await c.query('INSERT INTO stock_movements (product_id, product_name, on_date, qty, reason, created_by) VALUES ($1, $2, $3, $4, $5, $6)', [
          productId, r.rows[0].name, date, -1, 'Medicación', ctx.user.id,
        ]);
      }
    }
    return { ok: true, deducted };
  });
});
add('DELETE', '/api/medications/:id', async (ctx) => {
  await db.query('DELETE FROM medications WHERE id = $1', [U.idParam(ctx.params.id)]);
});

add('POST', '/api/patients/:id/charges', async (ctx) => {
  const id = U.idParam(ctx.params.id);
  const b = ctx.body;
  const serviceId = U.idParam(b.serviceId);
  const amount = U.money(b.amount, 'Monto');
  const method = U.oneOf(b.method, U.METHODS, 'Forma de pago');
  const date = U.reqDate(b.date, 'Fecha');
  const toCash = !!b.cash;
  return db.tx(async (c) => {
    const pat = await c.query('SELECT name FROM patients WHERE id = $1', [id]);
    if (!pat.rows[0]) throw new HttpError(404, 'No se encontró el paciente');
    const svc = await c.query('SELECT name FROM services WHERE id = $1', [serviceId]);
    if (!svc.rows[0]) throw new HttpError(404, 'No se encontró el servicio');
    let cashId = null;
    if (toCash) {
      const r = await c.query(
        'INSERT INTO cash_movements (on_date, kind, concept, category, method, amount, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [date, 'in', svc.rows[0].name + ' – ' + pat.rows[0].name, 'Servicios', method, amount, ctx.user.id]
      );
      cashId = r.rows[0].id;
    }
    await c.query('INSERT INTO charges (patient_id, on_date, concept, amount, method, cash_id) VALUES ($1, $2, $3, $4, $5, $6)', [
      id, date, svc.rows[0].name, amount, method, cashId,
    ]);
    return { ok: true };
  });
});

// Quitar un cobro también quita el ingreso que se había registrado en caja.
add('DELETE', '/api/charges/:id', { admin: true }, async (ctx) => {
  const id = U.idParam(ctx.params.id);
  await db.tx(async (c) => {
    const r = await c.query('SELECT cash_id FROM charges WHERE id = $1', [id]);
    if (!r.rows[0]) throw new HttpError(404, 'No se encontró el cobro');
    await c.query('DELETE FROM charges WHERE id = $1', [id]);
    if (r.rows[0].cash_id) await c.query('DELETE FROM cash_movements WHERE id = $1', [r.rows[0].cash_id]);
  });
});

/* ============================================================
   Stock (productos)
   ============================================================ */
add('POST', '/api/products', { admin: true }, async (ctx) => {
  const b = ctx.body;
  const name = U.reqStr(b.name, 'Nombre', 200);
  const category = U.oneOf(b.category, U.PROD_CATS, 'Categoría');
  const price = U.money(b.price, 'Precio de venta');
  const min = U.reqInt(b.min == null || b.min === '' ? 0 : b.min, 'Stock mínimo', 0, 100000);
  const stock = U.reqInt(b.stock == null || b.stock === '' ? 0 : b.stock, 'Stock inicial', 0, 100000);
  // v2: se carga precio unitario y el costo total se calcula solo (cantidad × unitario).
  const unitPrice = b.unitPrice == null || b.unitPrice === '' ? 0 : U.money(b.unitPrice, 'Precio unitario de compra');
  const cost = U.round2(unitPrice * stock);
  const method = stock > 0 && cost > 0 ? U.oneOf(b.method, U.METHODS, 'Forma de pago') : null;
  const today = U.todayAR();
  return db.tx(async (c) => {
    const r = await c.query('INSERT INTO products (name, category, stock, min_stock, price) VALUES ($1, $2, $3, $4, $5) RETURNING id', [
      name, category, stock, min, price,
    ]);
    const id = r.rows[0].id;
    if (stock > 0) {
      await c.query(
        'INSERT INTO stock_movements (product_id, product_name, on_date, qty, reason, created_by, unit_price) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, name, today, stock, 'Stock inicial', ctx.user.id, unitPrice]
      );
      if (cost > 0) {
        await c.query(
          'INSERT INTO cash_movements (on_date, kind, concept, category, method, amount, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [today, 'out', 'Compra de stock – ' + (stock > 1 ? stock + ' × ' : '') + name, 'Compra de stock', method, cost, ctx.user.id]
        );
      }
    }
    return { id };
  });
});

add('PUT', '/api/products/:id', { admin: true }, async (ctx) => {
  const id = U.idParam(ctx.params.id);
  const b = ctx.body;
  const r = await db.query('UPDATE products SET name = $1, category = $2, price = $3, min_stock = $4 WHERE id = $5 RETURNING id', [
    U.reqStr(b.name, 'Nombre', 200),
    U.oneOf(b.category, U.PROD_CATS, 'Categoría'),
    U.money(b.price, 'Precio de venta'),
    U.reqInt(b.min == null || b.min === '' ? 0 : b.min, 'Stock mínimo', 0, 100000),
    id,
  ]);
  if (!r.rows[0]) throw new HttpError(404, 'No se encontró el producto');
});

add('DELETE', '/api/products/:id', { admin: true }, async (ctx) => {
  await db.query('DELETE FROM products WHERE id = $1', [U.idParam(ctx.params.id)]);
});

// Llegó mercadería: suma al stock y, si se indica, registra el egreso en caja.
add('POST', '/api/products/:id/purchase', { admin: true }, async (ctx) => {
  const id = U.idParam(ctx.params.id);
  const b = ctx.body;
  const qty = U.reqInt(b.qty, 'Cantidad', 1, 100000);
  // v2: se carga precio unitario y el costo total (que va a caja) se calcula solo.
  const unitPrice = b.unitPrice == null || b.unitPrice === '' ? 0 : U.money(b.unitPrice, 'Precio unitario');
  const cost = U.round2(unitPrice * qty);
  const date = U.reqDate(b.date, 'Fecha');
  const toCash = !!b.cash && cost > 0;
  const method = toCash ? U.oneOf(b.method, U.METHODS, 'Forma de pago') : null;
  return db.tx(async (c) => {
    const r = await c.query('UPDATE products SET stock = stock + $1 WHERE id = $2 RETURNING name, stock', [qty, id]);
    if (!r.rows[0]) throw new HttpError(404, 'No se encontró el producto');
    const p = r.rows[0];
    await c.query(
      'INSERT INTO stock_movements (product_id, product_name, on_date, qty, reason, created_by, unit_price) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, p.name, date, qty, 'Compra', ctx.user.id, unitPrice]
    );
    if (toCash) {
      await c.query(
        'INSERT INTO cash_movements (on_date, kind, concept, category, method, amount, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [date, 'out', 'Compra de stock – ' + (qty > 1 ? qty + ' × ' : '') + p.name, 'Compra de stock', method, cost, ctx.user.id]
      );
    }
    return { ok: true, stock: p.stock, cost };
  });
});

// Corrección de stock (pérdidas, errores de carga). No toca la caja.
add('POST', '/api/products/:id/adjust', { admin: true }, async (ctx) => {
  const id = U.idParam(ctx.params.id);
  const delta = U.reqInt(ctx.body.delta, 'Cantidad', -100000, 100000);
  if (delta === 0) throw U.bad('La cantidad no puede ser cero');
  return db.tx(async (c) => {
    const r = await c.query('UPDATE products SET stock = stock + $1 WHERE id = $2 AND stock + $1 >= 0 RETURNING name, stock', [delta, id]);
    if (!r.rows[0]) {
      const e = await c.query('SELECT stock FROM products WHERE id = $1', [id]);
      if (!e.rows[0]) throw new HttpError(404, 'No se encontró el producto');
      throw new HttpError(409, 'El stock no puede quedar en negativo (hay ' + e.rows[0].stock + ')');
    }
    await c.query('INSERT INTO stock_movements (product_id, product_name, on_date, qty, reason, created_by) VALUES ($1, $2, $3, $4, $5, $6)', [
      id, r.rows[0].name, U.todayAR(), delta, 'Ajuste', ctx.user.id,
    ]);
    return { ok: true, stock: r.rows[0].stock };
  });
});

// Venta de mostrador: baja el stock y registra el ingreso en caja.
add('POST', '/api/products/:id/sell', async (ctx) => {
  const id = U.idParam(ctx.params.id);
  const qty = U.reqInt(ctx.body.qty, 'Cantidad', 1, 100000);
  const method = U.oneOf(ctx.body.method, U.METHODS, 'Forma de pago');
  const today = U.todayAR();
  return db.tx(async (c) => {
    const r = await c.query('UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING name, price, stock', [qty, id]);
    if (!r.rows[0]) {
      const e = await c.query('SELECT stock FROM products WHERE id = $1', [id]);
      if (!e.rows[0]) throw new HttpError(404, 'No se encontró el producto');
      throw new HttpError(409, 'Solo quedan ' + e.rows[0].stock + ' en stock');
    }
    const p = r.rows[0];
    const total = U.round2(Number(p.price) * qty);
    await c.query('INSERT INTO stock_movements (product_id, product_name, on_date, qty, reason, created_by) VALUES ($1, $2, $3, $4, $5, $6)', [
      id, p.name, today, -qty, 'Venta', ctx.user.id,
    ]);
    await c.query(
      'INSERT INTO cash_movements (on_date, kind, concept, category, method, amount, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [today, 'in', 'Venta – ' + (qty > 1 ? qty + ' × ' : '') + p.name, 'Venta de productos', method, total, ctx.user.id]
    );
    return { ok: true, total, stock: p.stock };
  });
});

// v2: historial de compras/ventas/ajustes de un producto (con precio unitario y total, cuando
// corresponde). Es información financiera, así que queda solo para el administrador.
add('GET', '/api/products/:id/movements', { admin: true }, async (ctx) => {
  const id = U.idParam(ctx.params.id);
  await mustExist('products', id, 'No se encontró el producto');
  const r = await db.query(
    'SELECT id, on_date, qty, reason, unit_price FROM stock_movements WHERE product_id = $1 ORDER BY on_date DESC, id DESC LIMIT 200',
    [id]
  );
  return { items: r.rows.map((x) => ({ id: x.id, date: x.on_date, qty: x.qty, reason: x.reason, unitPrice: Number(x.unit_price) })) };
});

/* ============================================================
   Lista de precios (servicios)
   ============================================================ */
// v2: productId (opcional) vincula un servicio de tipo "Vacunas" con el producto de stock que
// tiene que descontarse cada vez que se aplica esa vacuna a un paciente.
function serviceInput(b) {
  return [
    U.reqStr(b.name, 'Servicio', 200),
    U.oneOf(b.category, U.SERV_CATS, 'Categoría'),
    U.money(b.price, 'Precio'),
    b.productId ? U.idParam(b.productId) : null,
  ];
}
add('POST', '/api/services', { admin: true }, async (ctx) => {
  const params = serviceInput(ctx.body);
  if (params[3]) await mustExist('products', params[3], 'No se encontró el producto de stock elegido');
  const r = await db.query('INSERT INTO services (name, category, price, product_id) VALUES ($1, $2, $3, $4) RETURNING id', params);
  return { id: r.rows[0].id };
});
add('PUT', '/api/services/:id', { admin: true }, async (ctx) => {
  const id = U.idParam(ctx.params.id);
  const params = serviceInput(ctx.body);
  if (params[3]) await mustExist('products', params[3], 'No se encontró el producto de stock elegido');
  const r = await db.query('UPDATE services SET name = $1, category = $2, price = $3, product_id = $4 WHERE id = $5 RETURNING id', params.concat([id]));
  if (!r.rows[0]) throw new HttpError(404, 'No se encontró el servicio');
});
add('DELETE', '/api/services/:id', { admin: true }, async (ctx) => {
  await db.query('DELETE FROM services WHERE id = $1', [U.idParam(ctx.params.id)]);
});

/* ============================================================
   Caja (solo administradores)
   ============================================================ */
add('GET', '/api/cash', { admin: true }, async (ctx) => {
  const q = ctx.query;
  const today = U.todayAR();
  const where = [];
  const params = [];
  const p = (v) => {
    params.push(v);
    return '$' + params.length;
  };
  const period = q.get('period') || 'month';
  if (period === 'today') where.push('on_date = ' + p(today));
  else if (period === 'month') where.push('on_date >= ' + p(today.slice(0, 7) + '-01'));
  else if (period === 'prev') {
    where.push('on_date >= ' + p(U.monthStart(today, 1)));
    where.push('on_date < ' + p(today.slice(0, 7) + '-01'));
  }
  const type = q.get('type');
  if (type === 'in' || type === 'out') where.push('kind = ' + p(type));
  const group = q.get('group');
  if (group === 'Efectivo') where.push('method = ' + p('Efectivo'));
  else if (group === 'Transferencia') where.push('method = ' + p('Transferencia'));
  else if (group === 'Tarjeta') where.push("method IN ('Tarjeta de débito', 'Tarjeta de crédito')");
  const sql =
    'SELECT id, on_date, kind, concept, category, method, amount FROM cash_movements' +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY on_date DESC, id DESC LIMIT 500';
  const r = await db.query(sql, params);
  return { items: r.rows.map(mapCash), limited: r.rows.length === 500 };
});

add('GET', '/api/cash/summary', { admin: true }, async () => cashSummary());

add('POST', '/api/cash', { admin: true }, async (ctx) => {
  const b = ctx.body;
  const r = await db.query(
    'INSERT INTO cash_movements (on_date, kind, concept, category, method, amount, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    [
      U.reqDate(b.date, 'Fecha'),
      U.oneOf(b.type, ['in', 'out'], 'Tipo'),
      U.reqStr(b.concept, 'Concepto', 200),
      U.oneOf(b.category, U.CASH_CATS, 'Categoría'),
      U.oneOf(b.method, U.METHODS, 'Forma de pago'),
      U.money(b.amount, 'Monto'),
      ctx.user.id,
    ]
  );
  return { id: r.rows[0].id };
});

add('DELETE', '/api/cash/:id', { admin: true }, async (ctx) => {
  await db.query('DELETE FROM cash_movements WHERE id = $1', [U.idParam(ctx.params.id)]);
});

/* ============================================================
   Reportes (solo administradores)
   ============================================================ */
function reportDays(q) {
  const d = Number(q.get('days'));
  return [30, 90, 365].includes(d) ? d : 90;
}

add('GET', '/api/reports/monthly', { admin: true }, async () => {
  const today = U.todayAR();
  const r = await db.query('SELECT on_date, kind, method, amount FROM cash_movements WHERE on_date >= $1', [U.monthStart(today, 5)]);
  const months = [];
  const idx = {};
  for (let i = 5; i >= 0; i--) {
    const m = { ym: U.monthStart(today, i).slice(0, 7), in: 0, out: 0, efe: 0, tra: 0, tar: 0 };
    months.push(m);
    idx[m.ym] = m;
  }
  r.rows.forEach((x) => {
    const m = idx[String(x.on_date).slice(0, 7)];
    if (!m) return;
    const a = Number(x.amount);
    if (x.kind === 'in') {
      m.in += a;
      if (x.method === 'Efectivo') m.efe += a;
      else if (x.method === 'Transferencia') m.tra += a;
      else m.tar += a;
    } else {
      m.out += a;
    }
  });
  months.forEach((m) => {
    ['in', 'out', 'efe', 'tra', 'tar'].forEach((k) => {
      m[k] = U.round2(m[k]);
    });
  });
  return { months };
});

add('GET', '/api/reports/services', { admin: true }, async (ctx) => {
  const days = reportDays(ctx.query);
  const cutoff = U.addDays(U.todayAR(), -days);
  const r = await db.query(
    'SELECT concept, COUNT(*) AS n, SUM(amount) AS total FROM charges WHERE on_date >= $1 GROUP BY concept ORDER BY n DESC, total DESC',
    [cutoff]
  );
  return { days, items: r.rows.map((x) => ({ name: x.concept, n: Number(x.n), total: Number(x.total) })) };
});

add('GET', '/api/reports/products', { admin: true }, async (ctx) => {
  const days = reportDays(ctx.query);
  const cutoff = U.addDays(U.todayAR(), -days);
  const r = await db.query(
    'SELECT p.id, p.name, p.category, p.stock, COALESCE(SUM(-m.qty), 0) AS units ' +
      'FROM products p LEFT JOIN stock_movements m ON m.product_id = p.id AND m.qty < 0 ' +
      // v2: se agregan las bajas por "Vacuna aplicada a ..." (antes solo contaba ventas y medicación).
      "AND (m.reason IN ('Venta', 'Medicación') OR m.reason LIKE 'Vacuna aplicada a%') AND m.on_date >= $1 " +
      'GROUP BY p.id ORDER BY units DESC, lower(p.name)',
    [cutoff]
  );
  return { days, items: r.rows.map((x) => ({ id: x.id, name: x.name, category: x.category, stock: x.stock, units: Number(x.units) })) };
});

/* ============================================================
   Copias de seguridad (solo administradores)
   ============================================================ */
add('GET', '/api/backups', { admin: true }, async () => ({ items: await backup.list() }));

add('POST', '/api/backups', { admin: true }, async () => {
  await backup.snapshot('Copia manual', false);
});

add('DELETE', '/api/backups/:id', { admin: true }, async (ctx) => {
  await backup.remove(U.idParam(ctx.params.id));
});

add('POST', '/api/backups/:id/restore', { admin: true, limit: 1024 }, async (ctx) => {
  await backup.restore(await backup.load(U.idParam(ctx.params.id)));
});

add('GET', '/api/backup/export', { admin: true }, async (ctx) => {
  const body = JSON.stringify(await backup.exportAll());
  ctx.res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': 'attachment; filename="copia-veterinaria-' + U.todayAR() + '.json"',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  ctx.res.end(body);
  return U.HANDLED;
});

add('POST', '/api/restore', { admin: true, limit: 25 * 1024 * 1024 }, async (ctx) => {
  await backup.restore(ctx.body.data);
});

/* ============================================================
   v2 · Proveedores (ver a quién comprarle cada cosa)
   ============================================================ */
function supplierInput(b) {
  return [U.reqStr(b.name, 'Nombre', 200), U.optStr(b.phone, 50), U.checkEmail(U.optStr(b.email, 150)), U.optStr(b.description, 1000)];
}
// Cualquier usuario logueado puede CONSULTAR proveedores (por ejemplo, para llamar a uno);
// solo el administrador los da de alta, edita o elimina — mismo criterio que productos/servicios.
add('GET', '/api/suppliers', async () => {
  const r = await db.query('SELECT id, name, phone, email, description FROM suppliers ORDER BY lower(name), id');
  return { items: r.rows.map(mapSupplier) };
});
add('POST', '/api/suppliers', { admin: true }, async (ctx) => {
  const r = await db.query('INSERT INTO suppliers (name, phone, email, description) VALUES ($1, $2, $3, $4) RETURNING id', supplierInput(ctx.body));
  return { id: r.rows[0].id };
});
add('PUT', '/api/suppliers/:id', { admin: true }, async (ctx) => {
  const id = U.idParam(ctx.params.id);
  const r = await db.query(
    'UPDATE suppliers SET name = $1, phone = $2, email = $3, description = $4 WHERE id = $5 RETURNING id',
    supplierInput(ctx.body).concat([id])
  );
  if (!r.rows[0]) throw new HttpError(404, 'No se encontró el proveedor');
});
add('DELETE', '/api/suppliers/:id', { admin: true }, async (ctx) => {
  await db.query('DELETE FROM suppliers WHERE id = $1', [U.idParam(ctx.params.id)]);
});

/* ============================================================
   v2 · Calendario de turnos
   Abierto a cualquier usuario logueado (admin o ayudante): la agenda del día a día
   la maneja el mismo personal que atiende el mostrador, igual que las historias clínicas.
   ============================================================ */
function appointmentInput(b) {
  return {
    patientId: U.idParam(b.patientId),
    title: U.reqStr(b.title, 'Título', 150),
    description: U.optStr(b.description, 1000),
    date: U.reqDate(b.date, 'Fecha'),
    time: U.reqTime(b.time, 'Hora'),
    type: U.oneOf(b.type, U.APPT_TYPES, 'Tipo de turno'),
  };
}
add('GET', '/api/appointments', async (ctx) => {
  const from = U.reqDate(ctx.query.get('from') || '', 'Desde');
  const to = U.reqDate(ctx.query.get('to') || '', 'Hasta');
  if (to < from) throw U.bad('El rango de fechas no es válido');
  const r = await db.query(
    'SELECT a.id, a.patient_id, p.name AS patient_name, a.title, a.description, a.appointment_date, a.appointment_time, a.appointment_type ' +
      'FROM appointments a JOIN patients p ON p.id = a.patient_id ' +
      'WHERE a.appointment_date BETWEEN $1 AND $2 ORDER BY a.appointment_date, a.appointment_time, a.id',
    [from, to]
  );
  return { items: r.rows.map(mapAppointment) };
});
add('POST', '/api/appointments', async (ctx) => {
  const a = appointmentInput(ctx.body);
  await mustExist('patients', a.patientId, 'No se encontró el paciente');
  const r = await db.query(
    'INSERT INTO appointments (patient_id, title, description, appointment_date, appointment_time, appointment_type) ' +
      'VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [a.patientId, a.title, a.description, a.date, a.time, a.type]
  );
  return { id: r.rows[0].id };
});
add('PUT', '/api/appointments/:id', async (ctx) => {
  const id = U.idParam(ctx.params.id);
  const a = appointmentInput(ctx.body);
  await mustExist('patients', a.patientId, 'No se encontró el paciente');
  const r = await db.query(
    'UPDATE appointments SET patient_id = $1, title = $2, description = $3, appointment_date = $4, appointment_time = $5, appointment_type = $6 ' +
      'WHERE id = $7 RETURNING id',
    [a.patientId, a.title, a.description, a.date, a.time, a.type, id]
  );
  if (!r.rows[0]) throw new HttpError(404, 'No se encontró el turno');
});
add('DELETE', '/api/appointments/:id', async (ctx) => {
  await db.query('DELETE FROM appointments WHERE id = $1', [U.idParam(ctx.params.id)]);
});

module.exports = { dispatch };
