'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function checkEnv() {
  const problems = [];
  if (!process.env.DATABASE_URL) problems.push('Falta DATABASE_URL (la dirección de la base de datos).');
  if (PROD && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
    problems.push('Falta SESSION_SECRET o es muy corto (usá un texto al azar de al menos 32 caracteres).');
  }
  if (problems.length) {
    console.error('No se puede iniciar el sistema:\n - ' + problems.join('\n - '));
    process.exit(1);
  }
}
checkEnv();

// Recién ahora se cargan los módulos que necesitan las variables de entorno.
const db = require('./db');
const auth = require('./auth');
const api = require('./api');
const backup = require('./backup');
const U = require('./util');

// Las miniaturas y la vista previa de los adjuntos se cargan desde Supabase Storage (URLs firmadas):
// ese origen (y solo ese) se agrega a img-src.
const STORAGE_ORIGIN = (() => {
  try {
    return process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).origin : '';
  } catch (e) {
    return '';
  }
})();

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  // La cámara se habilita solo para esta misma página (lector de códigos de barras); micrófono y ubicación siguen bloqueados.
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src https://fonts.gstatic.com; img-src 'self' data:" + (STORAGE_ORIGIN ? ' ' + STORAGE_ORIGIN : '') + "; connect-src 'self'; " +
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  if (PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Método no permitido');
  }
  let pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  let file;
  try {
    file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
  } catch (e) {
    res.writeHead(400);
    return res.end();
  }
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('No encontrado');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': pathname.startsWith('/vendor/') ? 'public, max-age=86400' : 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch (e) {
    res.writeHead(400);
    return res.end();
  }

  // Chequeo de salud para el hosting.
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  // En internet, todo tiene que ir por HTTPS: si llega por http, se redirige.
  const proto = req.headers['x-forwarded-proto'];
  if (PROD && proto && proto !== 'https') {
    res.writeHead(301, { Location: 'https://' + req.headers.host + req.url });
    return res.end();
  }

  securityHeaders(res);

  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url);

  try {
    await api.dispatch(req, res, url);
  } catch (e) {
    const status = e.status && e.status < 500 ? e.status : 500;
    if (status === 500) console.error('Error interno en', req.method, url.pathname, '-', e.message);
    if (!res.headersSent) U.sendJson(res, status, { error: status === 500 ? 'Ocurrió un error interno. Probá de nuevo.' : e.message });
    else res.end();
  }
  console.log(req.method, url.pathname, res.statusCode, Date.now() - started + 'ms');
});

async function main() {
  await db.migrate();
  await auth.ensureAdmin();
  require('./storage').ensureBucket();
  backup.ensureDaily().catch((e) => console.error('Copia diaria:', e.message));
  setInterval(() => backup.ensureDaily().catch((e) => console.error('Copia diaria:', e.message)), 60 * 60 * 1000).unref();
  server.listen(PORT, '0.0.0.0', () => {
    console.log('Sistema de la veterinaria funcionando en el puerto ' + PORT + (PROD ? ' (modo producción)' : ' (modo prueba)'));
  });
}

main().catch((e) => {
  console.error('No se pudo iniciar el sistema:', e.message);
  process.exit(1);
});

function shutdown() {
  server.close(() => db.close().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
