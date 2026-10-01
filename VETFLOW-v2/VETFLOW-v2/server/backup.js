'use strict';

const zlib = require('zlib');
const db = require('./db');
const U = require('./util');

// Tablas incluidas en las copias, en orden de dependencia (las de abajo dependen de las de arriba).
// No se incluyen los usuarios ni sus contraseñas.
const TABLES = [
  ['patients', ['id', 'name', 'species', 'breed', 'sex', 'neutered', 'birth', 'weight', 'owner_name', 'phone', 'email', 'notes']],
  ['vaccines', ['id', 'patient_id', 'name', 'applied_on', 'next_on']],
  ['diagnoses', ['id', 'patient_id', 'on_date', 'title', 'notes']],
  ['medications', ['id', 'patient_id', 'on_date', 'name', 'dose', 'duration']],
  // v2: "complementary_studies" es tabla nueva; "products" va antes de "services" porque
  // services.product_id depende de un producto ya existente al restaurar en orden.
  ['products', ['id', 'name', 'category', 'stock', 'min_stock', 'price']],
  ['services', ['id', 'name', 'category', 'price', 'product_id']],
  ['suppliers', ['id', 'name', 'phone', 'email', 'description']],
  ['complementary_studies', ['id', 'patient_id', 'on_date', 'title', 'notes']],
  ['appointments', ['id', 'patient_id', 'title', 'description', 'appointment_date', 'appointment_time', 'appointment_type']],
  ['cash_movements', ['id', 'on_date', 'kind', 'concept', 'category', 'method', 'amount']],
  ['charges', ['id', 'patient_id', 'on_date', 'concept', 'amount', 'method', 'cash_id']],
  ['stock_movements', ['id', 'product_id', 'product_name', 'on_date', 'qty', 'reason', 'unit_price']],
];

const KEEP_AUTO = 14;
const KEEP_MANUAL = 20;

// v2: tablas y columnas que no existían en la v1. Un backup exportado antes de la v2 no las
// tiene: se tratan como "sin datos" (tabla vacía) o con este valor por defecto, en vez de
// rechazar la restauración de una copia vieja.
const NEW_TABLES = new Set(['suppliers', 'complementary_studies', 'appointments']);
const COL_DEFAULTS = { stock_movements: { unit_price: 0 } };

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
  for (const [table] of TABLES) c[table] = data[table].length;
  return c;
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

/** Hace la copia automática si todavía no se hizo una hoy (hora de Argentina). */
async function ensureDaily() {
  const r = await db.query('SELECT created_at FROM backups WHERE auto = $1 ORDER BY id DESC LIMIT 1', [true]);
  if (r.rows[0]) {
    const d = new Date(r.rows[0].created_at);
    if (!isNaN(d.getTime()) && d.toLocaleDateString('en-CA', { timeZone: U.TZ || 'America/Argentina/Buenos_Aires' }) === U.todayAR()) {
      return false;
    }
  }
  await snapshot('Copia automática diaria', true);
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
async function restore(data) {
  validate(data);
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

module.exports = { snapshot, ensureDaily, list, load, remove, exportAll, restore };
