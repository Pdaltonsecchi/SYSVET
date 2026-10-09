'use strict';
// Utilidades de las pruebas: levantan el servidor real contra una base de prueba (DATABASE_URL) y hacen pedidos con cookie.
const { spawn } = require('child_process');

const PORT = 3400 + Math.floor(Math.random() * 400);
const ENV = {
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_SSL: 'false',
  SESSION_SECRET: 'x'.repeat(40),
  ADMIN_EMAIL: 'dueno@test.com',
  ADMIN_PASSWORD: 'clave-de-prueba-1',
  CRON_SECRET: 'secreto-cron',
  PORT: String(PORT),
};

function startServer() {
  const child = spawn(process.execPath, ['server/index.js'], { cwd: __dirname + '/..', env: Object.assign({}, process.env, ENV), stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('El servidor no arrancó')), 20000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('funcionando')) {
        clearTimeout(t);
        resolve(child);
      }
    });
    child.on('exit', (c) => reject(new Error('El servidor terminó con código ' + c)));
  });
}

function client() {
  let cookie = '';
  const base = 'http://127.0.0.1:' + PORT;
  async function call(method, path, body, headers) {
    const res = await fetch(base + '/api' + path, {
      method,
      headers: Object.assign({ cookie, 'Content-Type': 'application/json', Origin: base }, headers || {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      /* sin cuerpo */
    }
    return { status: res.status, data };
  }
  return { call, login: (email, password) => call('POST', '/login', { email, password }) };
}

module.exports = { ENV, PORT, startServer, client };
