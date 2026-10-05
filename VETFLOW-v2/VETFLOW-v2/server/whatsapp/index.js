'use strict';

const U = require('../util');
const cfg = require('./config');
const WS = require('./whatsappService');
const sessions = require('./sessionService');
const bot = require('./botController');
const { M } = require('./messages');
const { getClinic } = require('./clinic');
const reminders = require('./reminderService');

/* ---------- límite de mensajes por número ---------- */
const hits = new Map();
function limited(phone) {
  const now = Date.now();
  const arr = (hits.get(phone) || []).filter((t) => now - t < 60000);
  arr.push(now);
  hits.set(phone, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 60000) hits.delete(k);
  return arr.length > cfg.rateLimitPerMin;
}

/* ---------- un mensaje a la vez por número (evita pisar el estado de la conversación) ---------- */
const queues = new Map();
function serial(phone, fn) {
  const prev = queues.get(phone) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(phone, next);
  next.finally(() => queues.get(phone) === next && queues.delete(phone)).catch(() => {});
  return next;
}

/** Procesa un mensaje entrante: lo registra, arma la respuesta y la envía. `send` se puede reemplazar (pruebas). */
async function processMessage(m, send) {
  send = send || WS.sendText;
  const phone = String(m.from || '').replace(/\D/g, '');
  if (!phone) return [];
  return serial(phone, async () => {
    if (limited(phone)) {
      console.warn('WhatsApp: demasiados mensajes de', phone, '(se ignora)');
      return [];
    }
    const s = await sessions.getSession(phone);
    const isNew = await sessions.logMessage(s, 'incoming', m.text || '[' + m.type + ']', { type: m.type, waId: m.id });
    if (!isNew) return []; // Meta lo reenvió: ya estaba procesado
    let replies;
    try {
      replies = m.type === 'text' || m.type === 'interactive' || m.type === 'button' ? await bot.handle(s, m.text, m.name) : [M.nonText()];
      await sessions.saveSession(s);
    } catch (e) {
      console.error('Error del bot con', phone, '-', e.message);
      replies = [M.dbError()];
    }
    for (const text of replies) {
      try {
        const waId = await send(phone, text);
        await sessions.logMessage(s, 'outgoing', text, { waId: waId || null });
      } catch (e) {
        console.error('No se pudo enviar el mensaje de WhatsApp a', phone, '-', e.message);
        await sessions.logMessage(s, 'outgoing', '[no enviado] ' + text, { type: 'error' }).catch(() => {});
        break;
      }
    }
    return replies;
  });
}

/** /webhook/whatsapp: verificación de Meta (GET) y mensajes entrantes (POST). */
async function handleWebhook(req, res, url) {
  const plain = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(body || '');
  };
  if (req.method === 'GET') {
    const ok = cfg.verifyToken && url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === cfg.verifyToken;
    return ok ? plain(200, url.searchParams.get('hub.challenge') || '') : plain(403, 'Forbidden');
  }
  if (req.method !== 'POST') return plain(405, 'Método no permitido');
  let raw;
  try {
    raw = await U.readRaw(req, 1024 * 1024);
  } catch (e) {
    return plain(413, 'Too large');
  }
  if (!WS.verifySignature(raw, req.headers['x-hub-signature-256'])) {
    console.warn('WhatsApp: aviso rechazado (firma inválida)');
    return plain(401, 'Invalid signature');
  }
  // Meta espera un 200 enseguida; las respuestas se arman después.
  plain(200, 'ok');
  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch (e) {
    return;
  }
  for (const m of WS.extractMessages(payload)) {
    processMessage(m).catch((e) => console.error('WhatsApp:', e.message));
  }
}

/** Para el panel del administrador: qué falta configurar. */
async function status() {
  const c = await getClinic();
  const missing = [];
  if (!WS.configured()) missing.push('WHATSAPP_ACCESS_TOKEN y WHATSAPP_PHONE_ID');
  if (!cfg.verifyToken) missing.push('WHATSAPP_VERIFY_TOKEN');
  if (!cfg.appSecret) missing.push('WHATSAPP_APP_SECRET');
  if (!c.hours) missing.push('horarios de atención (PUT /api/whatsapp/settings)');
  if (!c.address) missing.push('dirección');
  if (!c.phone) missing.push('teléfono');
  return { configured: WS.configured() && !!cfg.verifyToken, remindersEnabled: cfg.remindersEnabled, templates: cfg.templates, missing };
}

module.exports = { handleWebhook, processMessage, start: reminders.start, status };
