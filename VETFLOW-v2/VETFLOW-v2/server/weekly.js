'use strict';

const db = require('./db');
const U = require('./util');
const report = require('./report');
const { getSettings } = require('./settings');
const { HttpError } = U;

/* ============================================================
   Informe semanal por email (semana anterior completa, de lunes a domingo)
   ============================================================ */
const fmtD = (d) => String(d).slice(8, 10) + '/' + String(d).slice(5, 7) + '/' + String(d).slice(0, 4);
const fmtMoney = (n) => '$ ' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const fmt$ = (n) => fmtMoney(U.round2(n));
function pctChange(cur, ref) {
  if (ref == null || Number(ref) === 0) return null;
  return Math.round(((Number(cur) - Number(ref)) / Math.abs(Number(ref))) * 1000) / 10;
}
const pctTxt = (p) => (p == null ? 'sin datos para comparar' : (p >= 0 ? '▲ ' : '▼ ') + Math.abs(p).toString().replace('.', ',') + ' %');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Semana anterior (lunes a domingo) respecto de `today`. */
function lastWeek(today) {
  const dow = new Date(today + 'T12:00:00Z').getUTCDay();
  const monday = U.addDays(today, -((dow + 6) % 7) - 7);
  return { from: monday, to: U.addDays(monday, 6) };
}

/** Clientes con al menos 2 compras en el último año que llevan más días sin venir que lo habitual (y que `minDays`). */
function lostClients(rows, today, minDays) {
  const day = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
  return rows
    .filter((r) => r.purchases >= 2)
    .map((r) => {
      const gap = day(r.first, r.last) / (r.purchases - 1);
      const since = day(r.last, today);
      const limit = Math.max(minDays, gap ? Math.round(gap * 2) : 0);
      return Object.assign({}, r, { daysSince: since, lost: since > limit });
    })
    .filter((r) => r.lost)
    .sort((a, b) => b.daysSince - a.daysSince);
}

// Ingresos de la semana = movimientos de caja de tipo ingreso, sin los aportes de capital (no son ventas).
async function totals(from, to) {
  const [i, e] = await Promise.all([
    db.query("SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM cash_movements WHERE kind = 'in' AND category <> 'Aporte de capital' AND on_date BETWEEN $1 AND $2", [from, to]),
    db.query("SELECT COALESCE(SUM(amount), 0) AS total FROM cash_movements WHERE kind = 'out' AND category <> 'Retiro de caja' AND on_date BETWEEN $1 AND $2", [from, to]),
  ]);
  const n = Number(i.rows[0].n);
  const total = U.round2(Number(i.rows[0].total));
  return { count: n, total, avg: n ? U.round2(total / n) : 0, expenses: U.round2(Number(e.rows[0].total)) };
}

async function buildWeekly(today) {
  const s = await getSettings();
  today = today || U.todayAR();
  const W = lastWeek(today);
  const prevFrom = U.addDays(W.from, -7);
  const [cur, prev, top, low, hist] = await Promise.all([
    totals(W.from, W.to),
    totals(prevFrom, U.addDays(W.from, -1)),
    // Lo más vendido: servicios cobrados y productos vendidos (sin lo anulado), por importe.
    db.query(
      "SELECT name, SUM(qty) AS qty, SUM(total) AS total FROM (" +
        "SELECT concept AS name, 1 AS qty, amount AS total FROM charges WHERE deleted_at IS NULL AND line_type = 'service' AND on_date BETWEEN $1 AND $2 " +
        "UNION ALL SELECT product_name AS name, -qty AS qty, -qty * unit_price AS total FROM stock_movements WHERE NOT voided AND reason = 'Venta' AND qty < 0 AND on_date BETWEEN $1 AND $2" +
        ') x GROUP BY name ORDER BY total DESC, name LIMIT 5',
      [W.from, W.to]
    ),
    db.query('SELECT name, stock, min_stock FROM products WHERE stock <= min_stock ORDER BY stock, lower(name) LIMIT 15'),
    db.query(
      "SELECT c.id, trim(c.first_name || ' ' || c.last_name) AS name, c.phone, COUNT(*) AS purchases, MIN(ch.on_date) AS first, MAX(ch.on_date) AS last " +
        'FROM charges ch JOIN patients p ON p.id = ch.patient_id JOIN clients c ON c.id = p.client_id WHERE ch.deleted_at IS NULL AND p.deleted_at IS NULL AND ch.on_date >= $1 GROUP BY c.id',
      [U.addDays(today, -365)]
    ),
  ]);
  const lost = lostClients(
    hist.rows.map((x) => ({ id: x.id, name: x.name, phone: x.phone, purchases: Number(x.purchases), first: x.first, last: x.last })),
    today,
    s.lostDays
  ).slice(0, 10);
  const li = (arr, f) => (arr.length ? '<ul>' + arr.map((x) => '<li>' + f(x) + '</li>').join('') + '</ul>' : '<p style="color:#6B7280">Nada para mostrar.</p>');
  const html =
    '<div style="font-family:Arial,sans-serif;color:#374151;max-width:640px">' +
    '<h1 style="font-size:20px">' + esc(s.shopName) + ': resumen de la semana</h1>' +
    '<p>Del ' + fmtD(W.from) + ' al ' + fmtD(W.to) + '.</p>' +
    '<table cellpadding="6" style="border-collapse:collapse">' +
    '<tr><td>Vendido</td><td><b>' + fmt$(cur.total) + '</b></td><td>' + pctTxt(pctChange(cur.total, prev.total)) + ' vs. semana anterior</td></tr>' +
    '<tr><td>Ventas</td><td><b>' + cur.count + '</b></td><td>Ticket promedio ' + fmt$(cur.avg) + '</td></tr>' +
    '<tr><td>Gastos y compras</td><td><b>' + fmt$(cur.expenses) + '</b></td><td></td></tr></table>' +
    '<h2 style="font-size:16px">Lo más vendido</h2>' + li(top.rows, (x) => esc(x.name) + ': ' + Number(x.qty) + ' (' + fmt$(Number(x.total)) + ')') +
    '<h2 style="font-size:16px">Poco stock</h2>' + li(low.rows, (x) => esc(x.name) + ': quedan ' + Number(x.stock)) +
    '<h2 style="font-size:16px">Clientes que dejaron de venir</h2>' + li(lost, (x) => esc(x.name) + ' (hace ' + x.daysSince + ' días' + (x.phone ? ', tel. ' + esc(x.phone) : '') + ')') +
    '<p style="color:#6B7280;font-size:12px">Informe automático del sistema de gestión. Se puede desactivar en Configuración.</p></div>';
  return { week: W.from, subject: s.shopName + ': resumen de la semana del ' + fmtD(W.from) + ' al ' + fmtD(W.to), html, recipients: s.report.recipients };
}

async function sendWeekly(manual, today) {
  const rep = await buildWeekly(today);
  const to = String(rep.recipients || '').split(/[,;\s]+/).filter(Boolean);
  if (!to.length) throw U.bad('Cargá al menos un email destinatario en Configuración → Informe semanal.');
  if (!report.configured()) throw new HttpError(503, 'El envío de emails no está configurado en el servidor (faltan EMAIL_PROVIDER, EMAIL_API_KEY y EMAIL_FROM en Render).', true);
  const week = manual ? 'manual ' + rep.week : rep.week;
  try {
    await report.send(to, rep.subject, rep.html);
    await db.query('INSERT INTO report_log (week, recipients, ok) VALUES ($1, $2, TRUE)', [week, to.join(', ')]);
  } catch (e) {
    await db.query('INSERT INTO report_log (week, recipients, ok, error) VALUES ($1, $2, FALSE, $3)', [week, to.join(', '), String(e.message).slice(0, 500)]);
    throw new HttpError(502, 'No se pudo enviar el informe: ' + e.message, true);
  }
  return { ok: true, to };
}

/** Se llama cada hora (y desde el cron externo): envía el informe si es el día y la hora configurados y no se envió esta semana. */
async function weeklyTick(now) {
  const s = await getSettings();
  if (!s.report.enabled || !report.configured()) return { sent: false, reason: 'desactivado' };
  now = now || new Date();
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(now.toLocaleString('en-US', { timeZone: U.TZ, weekday: 'short' }));
  const hour = Number(now.toLocaleString('en-US', { timeZone: U.TZ, hour: '2-digit', hourCycle: 'h23' }));
  if (dow !== s.report.weekday || hour < s.report.hour) return { sent: false, reason: 'no es el horario' };
  const today = now.toLocaleDateString('en-CA', { timeZone: U.TZ });
  const week = lastWeek(today).from;
  const done = await db.query('SELECT 1 FROM report_log WHERE week = $1 AND ok', [week]);
  if (done.rows[0]) return { sent: false, reason: 'ya enviado' };
  await sendWeekly(false, today);
  return { sent: true };
}

async function reportLog() {
  const r = await db.query('SELECT at, week, recipients, ok, error FROM report_log ORDER BY at DESC LIMIT 30');
  return { configured: report.configured(), items: r.rows.map((x) => ({ at: x.at, week: x.week, recipients: x.recipients, ok: !!x.ok, error: x.error })) };
}

module.exports = { lastWeek, lostClients, buildWeekly, sendWeekly, weeklyTick, reportLog };
