'use strict';
// Pantalla Configuración en un navegador real. Necesita Playwright (no es dependencia del proyecto): si no está, se saltea.
// Capturas opcionales: SHOTS=/ruta/carpeta
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, ENV, PORT } = require('./helpers');

let pw = null;
try {
  pw = require('playwright');
} catch (e) {
  /* sin Playwright */
}
const chromePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

test('pantalla Configuración', { skip: !pw && 'Playwright no está instalado' }, async () => {
  const server = await startServer();
  const browser = await pw.chromium.launch({ executablePath: chromePath });
  try {
    const owner = client();
    await owner.login(ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD);
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto('http://127.0.0.1:' + PORT);
    await page.fill('#lemail', ENV.ADMIN_EMAIL);
    await page.fill('#lpass', ENV.ADMIN_PASSWORD);
    await page.click('#lbtn');
    await page.click('[data-action="nav"][data-v="configuracion"]');
    await page.waitForSelector('#cfgform');
    if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/config-1280.png', fullPage: true });

    // Las casillas no se estiran a todo el ancho.
    const box = await page.locator('#cfg-fijos .checkgrid input').first().boundingBox();
    assert.ok(box.width < 30, 'la casilla mide ' + box.width);
    // La opción marcada se resalta (fondo distinto del de una desmarcada).
    const label = page.locator('.checkgrid .check', { hasText: 'Sueldos' });
    assert.equal(await label.locator('input').isChecked(), true);
    const bg = (l) => l.evaluate((el) => getComputedStyle(el).backgroundColor);
    const off = page.locator('.checkgrid .check', { hasText: 'Otros' }).first();
    assert.notEqual(await bg(label), await bg(off));

    // Validación en pantalla: sin llamar al servidor.
    await page.fill('[name="shopName"]', '');
    await page.click('[data-action="config-save"]');
    assert.equal(await page.textContent('#cfgerr'), 'Revisá los campos marcados.');

    // Guardar muestra el aviso.
    await page.fill('[name="shopName"]', 'Patitas UI');
    await page.click('[data-action="config-save"]');
    await page.waitForFunction(() => document.querySelector('#toast').textContent === 'Configuración guardada');
    assert.equal(await page.title(), 'Patitas UI');
    assert.equal(await page.textContent('#shopname'), 'Patitas UI');

    // Celular: una opción debajo de la otra.
    await page.setViewportSize({ width: 390, height: 800 });
    if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/config-390.png', fullPage: true });
    const a = await page.locator('#cfg-fijos .checkgrid .check').nth(0).boundingBox();
    const b = await page.locator('#cfg-fijos .checkgrid .check').nth(1).boundingBox();
    assert.ok(b.y > a.y, 'en celular las tarjetas van una debajo de la otra');
  } finally {
    await browser.close();
    server.kill();
  }
});
