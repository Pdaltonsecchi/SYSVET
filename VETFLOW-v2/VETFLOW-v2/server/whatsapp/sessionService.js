'use strict';

const crypto = require('crypto');
const db = require('../db');
const cfg = require('./config');

/* ---------- cifrado opcional del texto guardado ---------- */
const KEY = cfg.logKey ? (/^[0-9a-f]{64}$/i.test(cfg.logKey) ? Buffer.from(cfg.logKey, 'hex') : crypto.createHash('sha256').update(cfg.logKey).digest()) : null;
function seal(text) {
  if (!KEY) return text;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return 'enc1:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
function unseal(text) {
  if (!text.startsWith('enc1:')) return text;
  if (!KEY) return '[cifrado]';
  try {
    const b = Buffer.from(text.slice(5), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch (e) {
    return '[no se pudo descifrar]';
  }
}

/* ---------- sesiones ---------- */
const mapSession = (r) => ({ id: r.id, phone: r.phone, clientId: r.client_id, state: r.state, context: r.context || {}, last: r.last_interaction });

/** La conversación del número (se crea si no existe). Pasadas 6 horas sin hablar, vuelve a empezar. */
async function getSession(phone) {
  const r = await db.query(
    'INSERT INTO chat_sessions (phone) VALUES ($1) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING *',
    [phone]
  );
  const s = mapSession(r.rows[0]);
  if (s.state !== 'idle' && Date.now() - new Date(s.last).getTime() > 6 * 3600 * 1000) {
    s.state = 'idle';
    s.context = {};
  }
  return s;
}
async function saveSession(s) {
  await db.query('UPDATE chat_sessions SET state = $2, context = $3::jsonb, client_id = $4, last_interaction = now() WHERE id = $1', [
    s.id, s.state, JSON.stringify(s.context || {}), s.clientId || null,
  ]);
}
/** Deja la conversación esperando una respuesta (lo usan los recordatorios). */
async function setState(phone, clientId, state, context) {
  await db.query(
    'INSERT INTO chat_sessions (phone, client_id, state, context) VALUES ($1, $2, $3, $4::jsonb) ' +
      'ON CONFLICT (phone) DO UPDATE SET client_id = EXCLUDED.client_id, state = EXCLUDED.state, context = EXCLUDED.context, last_interaction = now()',
    [phone, clientId || null, state, JSON.stringify(context || {})]
  );
}

/* ---------- registro de mensajes ---------- */
/** Guarda un mensaje. Devuelve false si ya estaba (Meta reenvía avisos): en ese caso no hay que procesarlo de nuevo. */
async function logMessage(s, direction, body, o) {
  o = o || {};
  const r = await db.query(
    'INSERT INTO chat_logs (session_id, client_id, phone, direction, msg_type, body, wa_message_id) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id',
    [s.id || null, s.clientId || null, s.phone, direction, o.type || 'text', seal(body), o.waId || null]
  );
  return r.rowCount > 0;
}
async function recentLogs(phone, limit) {
  const r = await db.query('SELECT direction, msg_type, body, created_at FROM chat_logs WHERE phone = $1 ORDER BY id DESC LIMIT $2', [phone, limit || 50]);
  return r.rows.map((x) => ({ ...x, body: unseal(x.body) }));
}

module.exports = { getSession, saveSession, setState, logMessage, recentLogs, seal, unseal };
