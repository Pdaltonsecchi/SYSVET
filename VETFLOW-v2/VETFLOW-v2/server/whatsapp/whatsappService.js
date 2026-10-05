'use strict';

const crypto = require('crypto');
const cfg = require('./config');

const configured = () => !!(cfg.accessToken && cfg.phoneId);
const MAX_TEXT = 4000;

/** Comprueba la firma que Meta agrega a cada aviso (X-Hub-Signature-256) para saber que realmente viene de WhatsApp. */
function verifySignature(rawBody, header) {
  if (!cfg.appSecret) return !cfg.prod; // en producción es obligatorio configurar WHATSAPP_APP_SECRET
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', cfg.appSecret).update(rawBody).digest();
  let got;
  try {
    got = Buffer.from(header.slice(7), 'hex');
  } catch (e) {
    return false;
  }
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

async function graph(body) {
  if (!configured()) throw new Error('WhatsApp no está configurado (faltan WHATSAPP_ACCESS_TOKEN y WHATSAPP_PHONE_ID)');
  const res = await fetch('https://graph.facebook.com/' + cfg.apiVersion + '/' + cfg.phoneId + '/messages', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + cfg.accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error('WhatsApp API ' + res.status + ': ' + ((data.error && data.error.message) || 'error desconocido'));
    e.status = res.status;
    throw e;
  }
  return data;
}

async function sendText(to, text) {
  const data = await graph({ to, type: 'text', text: { body: String(text).slice(0, MAX_TEXT), preview_url: false } });
  return data.messages && data.messages[0] ? data.messages[0].id : null;
}

async function sendTemplate(to, name, params) {
  const data = await graph({
    to,
    type: 'template',
    template: {
      name,
      language: { code: cfg.templateLang },
      components: [{ type: 'body', parameters: params.map((t) => ({ type: 'text', text: String(t) })) }],
    },
  });
  return data.messages && data.messages[0] ? data.messages[0].id : null;
}

/** Mensajes entrantes de un aviso de Meta: [{ id, from, name, type, text }]. Estados de entrega y otros eventos se ignoran. */
function extractMessages(payload) {
  const out = [];
  for (const entry of (payload && payload.entry) || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      const names = {};
      (v.contacts || []).forEach((c) => (names[c.wa_id] = c.profile && c.profile.name));
      for (const m of v.messages || []) {
        let text = '';
        if (m.type === 'text') text = (m.text && m.text.body) || '';
        else if (m.type === 'interactive' && m.interactive) {
          const r = m.interactive.button_reply || m.interactive.list_reply;
          text = (r && (r.title || r.id)) || '';
        } else if (m.type === 'button') text = (m.button && (m.button.text || m.button.payload)) || '';
        out.push({ id: m.id, from: m.from, name: names[m.from] || '', type: m.type, text: String(text) });
      }
    }
  }
  return out;
}

module.exports = { configured, verifySignature, sendText, sendTemplate, extractMessages };
