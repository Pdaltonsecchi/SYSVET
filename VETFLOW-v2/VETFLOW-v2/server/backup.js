'use strict';

const zlib = require('zlib');
const db = require('./db');
const U = require('./util');

// Tablas incluidas en las copias, en orden de dependencia (las de abajo dependen de las de arriba).
// No se incluyen los usuarios ni sus contraseñas.
const TABLES = [
  ['patients', ['id', 'name', 'species', 'breed', 'sex', 'neutered', 'birth', 'weight', 'owner_name', 'phone', 'email', 'notes']],
  // "products" y "stock_movements" van antes que vacunas, medicación y caja, que apuntan a ellos.
  ['products', ['id', 'name', 'category', 'stock', 'min_stock', 'price']],
  ['stock_movements', ['id', 'product_id', 'product_name', 'on_date', 'qty', 'reason', 'unit_price', 'voided']],
  ['vaccines', ['id', 'patient_id', 'name', 'applied_on', 'next_on', 'product_id', 'stock_qty', 'stock_movement_id']],
  ['diagnoses', ['id', 'patient_id', 'on_date', 'title', 'notes']],
  ['medications', ['id', 'patient_id', 'on_date', 'name', 'dose', 'duration', 'product_id', 'stock_qty', 'stock_movement_id']],
  ['services', ['id', 'name', 'category', 'price', 'product_id']],
  ['suppliers', ['id', 'name', 'phone', 'email', 'description']],
  ['complementary_studies', ['id', 'patient_id', 'on_date', 'title', 'notes']],
  ['appointments', ['id', 'patient_id', 'title', 'description', 'appointment_date', 'appointment_time', 'appointment_type']],
  ['cash_movements', ['id', 'on_date', 'kind', 'concept', 'category', 'method', 'amount', 'stock_movement_id']],
  ['charges', ['id', 'patient_id', 'on_date', 'concept', 'amount', 'method', 'cash_id']],
];

const KEEP_AUTO = 14;
const KEEP_MANUAL = 20;

// v2: tablas y columnas que no existían en la v1. Un backup exportado antes de la v2 no las
// tiene: se tratan como "sin datos" (tabla vacía) o con este valor por defecto, en vez de
// rechazar la restauración de una copia vieja.
const NEW_TABLES = new Set(['suppliers', 'complementary_studies', 'appointments']);
const COL_DEFAULTS = {
  stock_movements: { unit_price: 0, voided: false },
  vaccines: { stock_qty: 0 },
  medications: { stock_qty: 0 },
};

async function collect() {
  const out = {};
  for (const [table, cols] of TABLES) {
    const r = await db.query('SELECT ' + cols.join(', ') + ' FROM ' + table + ' ORDER BY id');
    out[table] = r.rows;
  }
  return out;
}

function countsOf(data) {
  const c = {};
  for (const [table] of TABLES) c[table] = (data[table] || []).length;
  return c;
}
const totalOf = (counts) => Object.keys(counts).reduce((n, k) => n + counts[k], 0);

/** Cuántos registros hay hoy en cada tabla (para comparar contra una copia antes de restaurar). */
async function currentCounts() {
  return countsOf(await collect());
}

async function prune(auto) {
  const keepN = auto ? KEEP_AUTO : KEEP_MANUAL;
  const keep = await db.query('SELECT id FROM backups WHERE auto = $1 ORDER BY id DESC LIMIT $2', [auto, keepN]);
  const ids = keep.rows.map((r) => r.id);
  if (!ids.length) return;
  const ph = ids.map((_, i) => '$' + (i + 2)).join(', ');
  await db.query('DELETE FROM backups WHERE auto = $1 AND id NOT IN (' + ph + ')', [auto].concat(ids));
}

/** Guarda una copia comprimida dentro de la propia base de datos. */
async function snapshot(label, auto) {
  const data = await collect();
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(data))).toString('base64');
  const r = await db.query('INSERT INTO backups (label, auto, counts, data) VALUES ($1, $2, $3, $4) RETURNING id', [
    label,
    !!auto,
    JSON.stringify(countsOf(data)),
    gz,
  ]);
  await prune(!!auto);
  return r.rows[0].id;
}

const REFRESH_AFTER_MS = 3 * 60 * 60 * 1000;

/**
 * Copia automática: una por día (hora de Argentina), siempre con los datos ACTUALES.
 * - Si todavía no hay copia de hoy, la crea.
 * - Si ya hay una de hoy pero tiene más de 3 horas (o quedó vacía) y los datos cambiaron, la
 *   actualiza. Antes la copia se hacía una sola vez, al primer arranque del día, y quedaba
 *   desactualizada (o vacía) para el resto del día.
 * - Nunca guarda una copia automática vacía: no tiene sentido y podría pisar una buena.
 */
async function ensureDaily() {
  const data = await collect();
  const counts = countsOf(data);
  if (totalOf(counts) === 0) {
    console.warn('Copia diaria: la base está vacía, no se guarda una copia automática.');
    return false;
  }
  const r = await db.query('SELECT id, created_at, counts FROM backups WHERE auto = $1 ORDER BY id DESC LIMIT 1', [true]);
  const last = r.rows[0];
  let sameDay = false;
  if (last) {
    const d = new Date(last.created_at);
    sameDay = !isNaN(d.getTime()) && d.toLocaleDateString('en-CA', { timeZone: U.TZ }) === U.todayAR();
  }
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(data))).toString('base64');
  if (!sameDay) {
    await db.query('INSERT INTO backups (label, auto, counts, data) VALUES ($1, $2, $3, $4)', ['Copia automática diaria', true, JSON.stringify(counts), gz]);
    await prune(true);
    return true;
  }
  let prev = {};
  try {
    prev = JSON.parse(last.counts);
  } catch (e) {
    /* sin detalle: se refresca igual */
  }
  const stale = Date.now() - new Date(last.created_at).getTime() > REFRESH_AFTER_MS || totalOf(prev) === 0;
  if (!stale || JSON.stringify(prev) === JSON.stringify(counts)) return false;
  await db.query('UPDATE backups SET created_at = now(), counts = $1, data = $2 WHERE id = $3', [JSON.stringify(counts), gz, last.id]);
  return true;
}

async function list() {
  const r = await db.query('SELECT id, created_at, label, auto, counts FROM backups ORDER BY id DESC');
  return r.rows.map((b) => {
    let counts = {};
    try {
      counts = JSON.parse(b.counts);
    } catch (e) {
      /* sin detalle */
    }
    return { id: b.id, createdAt: b.created_at, label: b.label, auto: !!b.auto, counts };
  });
}

async function load(id) {
  const r = await db.query('SELECT data FROM backups WHERE id = $1', [id]);
  if (!r.rows[0]) throw new U.HttpError(404, 'No se encontró esa copia');
  return JSON.parse(zlib.gunzipSync(Buffer.from(r.rows[0].data, 'base64')).toString('utf8'));
}

async function remove(id) {
  await db.query('DELETE FROM backups WHERE id = $1', [id]);
}

async function exportAll() {
  return { app: 'veterinaria-sistema', version: 1, exportedAt: new Date().toISOString(), data: await collect() };
}

function validate(d) {
  if (!d || typeof d !== 'object') throw U.bad('La copia no es válida');
  for (const [table] of TABLES) {
    if (d[table] === undefined && NEW_TABLES.has(table)) continue; // copia de una versión anterior sin esta sección
    if (!Array.isArray(d[table])) throw U.bad('La copia no es válida: falta la sección "' + table + '"');
    for (const row of d[table]) {
      if (!row || typeof row !== 'object' || !Number.isInteger(row.id)) {
        throw U.bad('La copia no es válida: hay datos dañados en "' + table + '"');
      }
    }
  }
}

/**
 * Reemplaza todos los datos por los de la copia. Antes guarda una copia de lo actual.
 * Todo ocurre en una sola operación: si algo falla, los datos quedan como estaban.
 */
async function restore(data, opts) {
  validate(data);
  // Una copia sin ningún registro borraría todo: se exige confirmación explícita.
  if (totalOf(countsOf(data)) === 0 && !(opts && opts.confirmEmpty)) {
    throw new U.HttpError(409, 'Esta copia está vacía: restaurarla borra todos los datos. Confirmá que es lo que querés.');
  }
  await snapshot('Antes de restaurar una copia', false);
  try {
    await db.tx(async (c) => {
      for (const [table] of TABLES.slice().reverse()) await c.query('DELETE FROM ' + table);
      for (const [table, cols] of TABLES) {
        const rows = data[table] || []; // tabla nueva ausente en una copia de una versión anterior
        const defaults = COL_DEFAULTS[table] || {};
        for (let i = 0; i < rows.length; i += 200) {
          const chunk = rows.slice(i, i + 200);
          const params = [];
          const values = chunk
            .map(
              (row) =>
                '(' +
                cols
                  .map((col) => {
                    const v = row[col];
                    params.push(v === undefined ? (defaults[col] !== undefined ? defaults[col] : null) : v);
                    return '$' + params.length;
                  })
                  .join(', ') +
                ')'
            )
            .join(', ');
          await c.query('INSERT INTO ' + table + ' (' + cols.join(', ') + ') VALUES ' + values, params);
        }
        await db.resetSequence(c, table);
      }
    });
  } catch (e) {
    console.error('Falló la restauración:', e.message);
    throw U.bad('No se pudo restaurar: la copia tiene datos dañados o incompatibles. Tus datos actuales no se tocaron.');
  }
}

module.exports = { currentCounts, snapshot, ensureDaily, list, load, remove, exportAll, restore };
