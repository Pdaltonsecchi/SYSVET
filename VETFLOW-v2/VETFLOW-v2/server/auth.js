'use strict';

const crypto = require('crypto');
const { promisify } = require('util');
const db = require('./db');
const U = require('./util');

const scrypt = promisify(crypto.scrypt);

const COOKIE = 'vet_session';
const MAX_AGE = 7 * 24 * 3600; // la sesión dura 7 días
const PROD = process.env.NODE_ENV === 'production';

let SECRET = process.env.SESSION_SECRET;
function secret() {
  if (!SECRET) {
    SECRET = crypto.randomBytes(32).toString('hex');
    console.warn('ADVERTENCIA: no hay SESSION_SECRET. Las sesiones se cierran cada vez que se reinicia el servidor.');
  }
  return SECRET;
}

/* ---------- contraseñas (scrypt con sal propia) ---------- */
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(pw, salt, 64);
  return 'scrypt$' + salt.toString('hex') + '$' + hash.toString('hex');
}
async function verifyPassword(pw, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const expected = Buffer.from(parts[2], 'hex');
    const hash = await scrypt(String(pw), Buffer.from(parts[1], 'hex'), 64);
    return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
  } catch (e) {
    return false;
  }
}
let dummy = null;
async function dummyHash() {
  if (!dummy) dummy = await hashPassword(crypto.randomBytes(8).toString('hex'));
  return dummy;
}

/* ---------- sesiones ---------- */
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + sig;
}
function verify(token) {
  if (typeof token !== 'string') return null;
  const i = token.indexOf('.');
  if (i < 1) return null;
  const body = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = crypto.createHmac('sha256', secret()).update(body).digest();
  let got;
  try {
    got = Buffer.from(sig, 'base64url');
  } catch (e) {
    return null;
  }
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p || !p.exp || p.exp < Date.now()) return null;
    return p;
  } catch (e) {
    return null;
  }
}
/** Huella corta de la contraseña: si la cambian, las sesiones anteriores dejan de servir. */
const pwTag = (user) => crypto.createHash('sha256').update(String(user.password_hash)).digest('hex').slice(0, 16);

function setSession(res, user) {
  const token = sign({ uid: user.id, ph: pwTag(user), exp: Date.now() + MAX_AGE * 1000 });
  let cookie = COOKIE + '=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + MAX_AGE;
  if (PROD) cookie += '; Secure';
  res.setHeader('Set-Cookie', cookie);
}
function clearSession(res) {
  let cookie = COOKIE + '=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
  if (PROD) cookie += '; Secure';
  res.setHeader('Set-Cookie', cookie);
}

async function currentUser(req) {
  const token = U.parseCookies(req.headers.cookie)[COOKIE];
  const p = verify(token);
  if (!p) return null;
  const r = await db.query('SELECT id, email, name, role, active, password_hash FROM users WHERE id = $1', [p.uid]);
  const u = r.rows[0];
  if (!u || !u.active || pwTag(u) !== p.ph) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

/* ---------- bloqueo de intentos de ingreso ---------- */
const fails = new Map();
function throttleCheck(key) {
  const f = fails.get(key);
  if (f && f.until && f.until > Date.now()) return Math.ceil((f.until - Date.now()) / 1000);
  return 0;
}
function throttleFail(key) {
  if (fails.size > 5000) {
    for (const [k, v] of fails) if (!v.until || v.until < Date.now()) fails.delete(k);
  }
  const f = fails.get(key) || { n: 0, until: 0 };
  if (f.until && f.until <= Date.now()) {
    f.n = 0;
    f.until = 0;
  }
  f.n += 1;
  if (f.n >= 5) f.until = Date.now() + 15 * 60 * 1000;
  fails.set(key, f);
}
function throttleOk(key) {
  fails.delete(key);
}

/* ---------- primer usuario administrador ---------- */
async function ensureAdmin() {
  const r = await db.query('SELECT COUNT(*) AS n FROM users');
  if (Number(r.rows[0].n) > 0) return;
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const pw = process.env.ADMIN_PASSWORD || '';
  if (!email || pw.length < 8) {
    console.warn('ATENCIÓN: todavía no hay usuarios. Definí ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 8 caracteres) y reiniciá el servidor.');
    return;
  }
  await db.query('INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4)', [
    email,
    'Administrador',
    await hashPassword(pw),
    'admin',
  ]);
  console.log('Se creó el usuario administrador:', email);
}

module.exports = {
  hashPassword, verifyPassword, dummyHash,
  setSession, clearSession, currentUser,
  throttleCheck, throttleFail, throttleOk,
  ensureAdmin,
};
