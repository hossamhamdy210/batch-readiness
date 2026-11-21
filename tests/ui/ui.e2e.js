'use strict';
/* Browser test (Playwright). Run: npm run test:ui */
const assert = require('assert');
const { chromium } = require('playwright');
const { createRuntime } = require('../../server/runtime');
const { createApp } = require('../../server/app');
const { seed } = require('../../scripts/seed-demo');

(async () => {
  const quiet = { info() {}, error() {} };
  const rt = createRuntime({ dbFile: ':memory:', logger: quiet });
  rt.ensureInitialized({ adminEmail: 'admin@example.test', adminName: 'Ada Admin', adminPassword: 'Correct-Horse-9' });
  seed(rt);
  const app = createApp(rt, { logger: quiet });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  let failed = 0;
  const step = async (n, f) => { try { await f(); console.log('ok   ', n); } catch (e) { failed++; console.log('FAIL ', n, '\n     ', e.message.split('\n')[0]); await page.screenshot({ path: 'fail-' + n.replace(/\W+/g, '_') + '.png' }); } };

  await page.goto(base);
  await step('sign in', async () => {
    await page.fill('input[name=email]', 'admin@example.test'); await page.fill('input[name=password]', 'Correct-Horse-9');
    await page.click('button[type=submit]'); await page.waitForSelector('text=Plan a campaign');
  });
  await step('planner calculates a campaign', async () => {
    await page.fill('#p_product', 'DEMO-PRODUCT-A'); await page.selectOption('#p_site', 'SITE-A'); await page.fill('#p_n', '2');
    const d = (n) => { const x = new Date(); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    await page.fill('#p_from', d(10)); await page.fill('#p_to', d(40)); await page.click('#go');
    await page.waitForSelector('text=planned batches');
    assert.ok(await page.locator('#result tbody tr.click').count() >= 2);
  });
  await step('refresh keeps the open tab', async () => {
    await page.click('nav >> text=Admin'); await page.waitForSelector('text=Administration'); await page.reload();
    await page.waitForSelector('text=Administration');
  });
  await step('integrations tab: create key (shown once), revoke it', async () => {
    await page.click('.sub >> text=Integrations'); await page.waitForSelector('#kname');
    await page.fill('#kname', 'ui-test'); await page.click('#kadd'); await page.waitForSelector('#kval');
    const key = await page.textContent('#kval'); assert.ok(/^brk_[0-9a-f]{40,}$/.test(key.trim()), key);
    const r = await fetch(base + '/integration/v1/readiness?product=DEMO-PRODUCT-A&site=SITE-A&batches=1&from=' + new Date().toISOString().slice(0, 10), { headers: { authorization: 'Bearer ' + key.trim() } });
    assert.ok(r.status === 200 || r.status === 422, 'readiness status ' + r.status);
    await page.click('.sub >> text=Integrations'); await page.waitForSelector('[data-rv]'); await page.click('[data-rv]');
    await page.waitForSelector('text=revoked', { timeout: 5000 }).catch(() => {});
    const r2 = await fetch(base + '/integration/v1/runs', { headers: { authorization: 'Bearer ' + key.trim() } });
    assert.strictEqual(r2.status, 401);
  });
  await step('sign out and back to login', async () => { await page.click('#out'); await page.waitForSelector('input[name=email]'); });
  await step('no browser errors', async () => { assert.deepStrictEqual(errors, []); });
  await browser.close(); server.close(); rt.close();
  process.exit(failed ? 1 : 0);
})();
