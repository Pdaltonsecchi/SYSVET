'use strict';

const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// Números y fechas como valores simples de JavaScript.
types.setTypeParser(1700, (v) => parseFloat(v)); // NUMERIC -> número
types.setTypeParser(1082, (v) => v); // DATE -> 'AAAA-MM-DD' (sin problemas de zona horaria)
types.setTypeParser(20, (v) => parseInt(v, 10)); // BIGINT (COUNT, SUM) -> número

/** Saca el parámetro sslmode de la dirección: la conexión segura se configura abajo. */
function cleanUrl(u) {
  return u
    .replace(/([?&])sslmode=[^&]*(&|$)/, (m, p1, p2) => (p2 === '&' ? p1 : ''))
    .replace(/[?&]$/, '');
}

const useSsl = process.env.DATABASE_SSL !== 'false';

const pool = new Pool({
  connectionString: cleanUrl(process.env.DATABASE_URL || ''),
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 20000,
});

pool.on('error', (e) => {
  console.error('Error en la conexión con la base de datos:', e.message);
});

function query(sql, params) {
  return pool.query(sql, params);
}

/** Ejecuta varias consultas como una sola operación: o se hacen todas, o no se hace ninguna. */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* la conexión ya estaba cerrada */
    }
    throw e;
  } finally {
    client.release();
  }
}

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
}

/** Después de restaurar una copia, los números automáticos (id) tienen que seguir desde el último. */
async function resetSequence(client, table) {
  await client.query(
    "SELECT setval(pg_get_serial_sequence('" + table + "','id'), " +
      'GREATEST((SELECT COALESCE(MAX(id),0) FROM ' + table + '),1), ' +
      '(SELECT COUNT(*)>0 FROM ' + table + '))'
  );
}

async function close() {
  await pool.end();
}

module.exports = { query, tx, migrate, resetSequence, close };
