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
    await page.click('#side [data-action="nav"][data-v="configuracion"]');
    await page.waitForSelector('#cfgform');
    if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/config-1280.png', fullPage: true });

    // Validación en pantalla, sin llamar al servidor.
    await page.fill('[name="shopName"]', '');
    await page.click('.head [data-action="config-save"]');
    assert.equal(await page.textContent('#cfgerr'), 'Escribí el nombre de la veterinaria.');

    // Lunes con dos franjas (08:00–12:00 y 16:00–19:00) y sin tarjeta de crédito.
    await page.fill('[name="shopName"]', 'Patitas UI');
    const lunes = page.locator('.hday[data-day="1"]');
    await lunes.locator('.hopen').check();
    await lunes.locator('.hrange').first().locator('.hfrom').selectOption('08:00');
    await lunes.locator('.hrange').first().locator('.hto').selectOption('12:00');
    while ((await lunes.locator('.hrange').count()) > 1) await lunes.locator('.hrange').last().locator('[data-action="hr-del"]').click();
    await lunes.locator('[data-action="hr-add"]').click();
    await lunes.locator('.hrange').nth(1).locator('.hfrom').selectOption('16:00');
    await lunes.locator('.hrange').nth(1).locator('.hto').selectOption('19:00');
    await page.locator('#cfgpay input[value="Tarjeta de crédito"]').uncheck();
    await page.click('.head [data-action="config-save"]');
    await page.waitForFunction(() => document.querySelector('#toast').textContent === 'Configuración guardada');
    assert.equal(await page.title(), 'Patitas UI');
    assert.equal(await page.textContent('#shopname'), 'Patitas UI');
    const g = await owner.call('GET', '/settings');
    assert.deepEqual(g.data.hours[1], [['08:00', '12:00'], ['16:00', '19:00']]);
    assert.ok(!g.data.methods.includes('Tarjeta de crédito'));

    // Celular: sin scroll horizontal.
    await page.setViewportSize({ width: 390, height: 800 });
    if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/config-390.png', fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  } finally {
    await browser.close();
    server.kill();
  }
});
