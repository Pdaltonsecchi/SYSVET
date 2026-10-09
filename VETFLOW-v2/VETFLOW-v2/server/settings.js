'use strict';

const db = require('./db');
const U = require('./util');
const report = require('./report');

/* ---------- Configuración del negocio (una sola fila en `settings`, clave 'app') ---------- */
const toMin = (t) => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5));
// Horario comercial por día de la semana (0 = domingo). null = cerrado.
const DEFAULT_HOURS = { 0: null, 1: ['09:00', '19:00'], 2: ['09:00', '19:00'], 3: ['09:00', '19:00'], 4: ['09:00', '19:00'], 5: ['09:00', '19:00'], 6: ['09:00', '19:00'] };

const DEFAULT_SETTINGS = {
  shopName: '',
  address: '',
  phone: '',
  ticketText: '¡Gracias por tu compra!',
  ticketWidth: 80,
  hours: DEFAULT_HOURS,
  methods: U.METHODS.slice(),
  fixedCategories: ['Alquiler y servicios', 'Sueldos', 'Impuestos'],
  lowMargin: 10,
  lostDays: 30,
  defaultMinStock: 2,
  expiryDays: 30,
  fixedMonthly: 0,
  report: { enabled: false, weekday: 1, hour: 8, recipients: '' },
};

let cache = null;
function clearCache() {
  cache = null;
}
async function getSettings(q) {
  if (cache && Date.now() - cache.at < 30000) return cache.value;
  const r = await (q || db).query("SELECT value FROM settings WHERE key = 'app'");
  let saved = {};
  try {
    saved = r.rows[0] ? JSON.parse(r.rows[0].value) : {};
  } catch (e) {
    saved = {};
  }
  const value = Object.assign({}, DEFAULT_SETTINGS, saved, { report: Object.assign({}, DEFAULT_SETTINGS.report, saved.report || {}) });
  if (!value.shopName) value.shopName = process.env.CLINIC_NAME || 'SYSVET';
  cache = { at: Date.now(), value };
  return value;
}

/** Valida y normaliza el horario comercial que se guarda en la configuración. */
function checkHours(h) {
  const out = {};
  for (let d = 0; d < 7; d++) {
    const v = h && h[d];
    if (!v) {
      out[d] = null;
      continue;
    }
    if (!Array.isArray(v) || v.length !== 2) throw U.bad('El horario comercial no es válido.');
    const a = U.reqTime(v[0], 'Apertura').slice(0, 5);
    const b = U.reqTime(v[1], 'Cierre').slice(0, 5);
    if (toMin(b) <= toMin(a)) throw U.bad('En el horario comercial, el cierre tiene que ser después de la apertura.');
    out[d] = [a, b];
  }
  return out;
}

// El ayudante no necesita ver la configuración del informe por email ni los umbrales de ganancia.
function publicSettings(s, admin) {
  const out = { shopName: s.shopName, address: s.address, phone: s.phone, ticketText: s.ticketText, ticketWidth: s.ticketWidth, hours: s.hours, methods: s.methods, expiryDays: s.expiryDays, defaultMinStock: s.defaultMinStock };
  if (admin) Object.assign(out, { fixedCategories: s.fixedCategories, fixedMonthly: s.fixedMonthly, lowMargin: s.lowMargin, lostDays: s.lostDays, report: s.report, emailReady: report.configured() });
  return out;
}

const blank = (v) => v == null || v === '';

/** Valida el objeto completo de PUT /api/settings; devuelve el objeto a guardar. */
function validate(b, cur) {
  const rep = b.report && typeof b.report === 'object' ? b.report : {};
  const methods = Array.isArray(b.methods) ? b.methods.filter((m) => U.METHODS.includes(m)) : cur.methods;
  if (!methods.length) throw U.bad('Dejá habilitada al menos una forma de pago.');
  const fixed = Array.isArray(b.fixedCategories) ? b.fixedCategories.filter((c) => U.CASH_OUT_CATS.includes(c)) : cur.fixedCategories;
  const recipients = U.optStr(rep.recipients, 500)
    .split(/[,;\s]+/)
    .filter(Boolean);
  recipients.forEach((r) => U.checkEmail(r));
  const next = {
    shopName: U.reqStr(b.shopName, 'Nombre del negocio', 100),
    address: U.optStr(b.address, 200),
    phone: U.optPhone(b.phone).phone,
    ticketText: U.optStr(b.ticketText, 200),
    ticketWidth: U.oneOf(Number(b.ticketWidth || 80), [58, 80], 'Ancho del ticket'),
    hours: checkHours(b.hours || cur.hours),
    methods: U.METHODS.filter((m) => methods.includes(m)),
    fixedCategories: fixed,
    lowMargin: U.reqNum(blank(b.lowMargin) ? cur.lowMargin : b.lowMargin, 'Margen bajo', 0, 100),
    lostDays: U.reqInt(blank(b.lostDays) ? cur.lostDays : b.lostDays, 'Días sin comprar', 7, 365),
    defaultMinStock: U.reqNum(blank(b.defaultMinStock) ? cur.defaultMinStock : b.defaultMinStock, 'Stock mínimo sugerido', 0, 100000),
    expiryDays: U.reqInt(blank(b.expiryDays) ? cur.expiryDays : b.expiryDays, 'Días de aviso de vencimiento', 1, 365),
    fixedMonthly: U.money(blank(b.fixedMonthly) ? cur.fixedMonthly : b.fixedMonthly, 'Gastos fijos del mes'),
    report: {
      enabled: !!rep.enabled,
      weekday: U.reqInt(blank(rep.weekday) ? 1 : rep.weekday, 'Día del informe', 0, 6),
      hour: U.reqInt(blank(rep.hour) ? 8 : rep.hour, 'Hora del informe', 0, 23),
      recipients: recipients.join(', '),
    },
  };
  if (next.report.enabled && !recipients.length) throw U.bad('Para activar el informe semanal escribí al menos un email destinatario.');
  return next;
}

async function saveSettings(next) {
  await db.query(
    "INSERT INTO settings (key, value, updated_at) VALUES ('app', $1, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    [JSON.stringify(next)]
  );
  clearCache();
}

module.exports = { DEFAULT_SETTINGS, DEFAULT_HOURS, getSettings, clearCache, checkHours, publicSettings, validate, saveSettings };
