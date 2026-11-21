'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRuntime } = require('../../server/runtime');
const { createApp } = require('../../server/app');
const { runSapStock } = require('../../server/integrations/sapOData');
const { runFileDrop } = require('../../server/integrations/fileDrop');
const { startWebhooks, sign } = require('../../server/integrations/webhooks');

const quiet = { info() {}, error() {} };
function setup() {
  const rt = createRuntime({ dbFile: ':memory:', logger: quiet }); rt.ensureInitialized({});
  const app = createApp(rt, { logger: quiet });
  rt.transaction(() => { const v = rt.ctx.store_version('Sites'); rt.ctx.store_write('Sites', rt.ctx.store_read('Sites').concat([{ id: 'SITE-A', name: 'A' }, { id: 'SITE-B', name: 'B' }])); return { ok: true }; });
  return { rt, app, ingest: app.locals.ingest, principal: { email: 'connector', name: 'connector', role: 'editor' } };
}
const stockCount = (rt, site) => rt.read('ErpStock').filter((r) => r.site === site).length;

function mockSap(handler) {
  return new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => resolve({ s, url: 'http://127.0.0.1:' + s.address().port })); });
}

test('SAP OData: paging, plant->site mapping, special stock excluded, basic auth', async () => {
  const { rt, ingest, principal } = setup();
  const seen = [];
  const sap = await mockSap((req, res) => {
    seen.push(req.headers.authorization);
    const u = new URL(req.url, 'http://x');
    const filter = u.searchParams.get('$filter');
    if (!/Plant eq '1000'/.test(filter)) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ d: { results: [] } })); }
    const base = 'http://' + req.headers.host + '/svc/A_MatlStkInAcctMod';
    if (!u.searchParams.get('$skip')) {
      res.end(JSON.stringify({ d: { results: [{ Material: '100101', Plant: '1000', StorageLocation: '0001', Batch: 'B1', InventoryStockType: '01', InventorySpecialStockType: '', MatlWrhsStkQtyInMatlBaseUnit: '12.500', MaterialBaseUnit: 'KG', ShelfLifeExpirationDate: '/Date(1798675200000)/' }], __next: base + '?' + u.searchParams.toString() + '&$skip=1' } }));
    } else {
      res.end(JSON.stringify({ d: { results: [{ Material: '100102', Plant: '1000', StorageLocation: '0001', Batch: 'B2', InventoryStockType: '01', InventorySpecialStockType: 'E', MatlWrhsStkQtyInMatlBaseUnit: '5', MaterialBaseUnit: 'KG' }, { Material: '100103', Plant: '1000', StorageLocation: '0002', Batch: 'B3', InventoryStockType: '01', InventorySpecialStockType: '', MatlWrhsStkQtyInMatlBaseUnit: '7', MaterialBaseUnit: 'KG', ShelfLifeExpirationDate: '00000000' }] } }));
    }
  });
  try {
    const r = await runSapStock({ name: 't', baseUrl: sap.url + '/svc', plants: { 1000: 'SITE-A' }, auth: { type: 'basic', userEnv: 'U', passwordEnv: 'P' } }, ingest, { principal, env: { U: 'user', P: 'pw' } });
    assert.ok(r.ok, JSON.stringify(r));
    const rows = rt.read('ErpStock').filter((x) => x.site === 'SITE-A');
    assert.deepStrictEqual(rows.map((x) => x.material).sort(), ['100101', '100103']);   // special stock 'E' excluded
    assert.strictEqual(rows.find((x) => x.material === '100101').qty, 12.5);
    assert.strictEqual(rows.find((x) => x.material === '100101').expiry, '2026-12-31');
    assert.strictEqual(rows.find((x) => x.material === '100103').expiry, '');
    assert.strictEqual(seen[0], 'Basic ' + Buffer.from('user:pw').toString('base64'));
  } finally { sap.s.close(); rt.close(); }
});

test('SAP OData: a failing second plant writes nothing (no partial import)', async () => {
  const { rt, ingest, principal } = setup();
  const sap = await mockSap((req, res) => {
    const f = new URL(req.url, 'http://x').searchParams.get('$filter');
    if (/2000/.test(f)) { res.writeHead(500); return res.end('boom'); }
    res.end(JSON.stringify({ d: { results: [{ Material: '1', Plant: '1000', StorageLocation: '1', Batch: 'x', MatlWrhsStkQtyInMatlBaseUnit: '1', MaterialBaseUnit: 'EA' }] } }));
  });
  try {
    await assert.rejects(runSapStock({ baseUrl: sap.url, plants: { 1000: 'SITE-A', 2000: 'SITE-B' }, auth: { type: 'none' } }, ingest, { principal }), /HTTP 500/);
    assert.strictEqual(stockCount(rt, 'SITE-A'), 0);
  } finally { sap.s.close(); rt.close(); }
});

test('guards: empty extract and mostly-unusable extract leave existing stock untouched', async () => {
  const { rt, ingest, principal } = setup();
  assert.ok(ingest(principal, 'stock', [{ material: 'M1', qty: 5 }], { site: 'SITE-A' }).ok);
  assert.strictEqual(ingest(principal, 'stock', [], { site: 'SITE-A' }).ok, false);
  const bad = [{ material: 'M1', qty: 'x' }, { material: 'M2', qty: 'y' }, { material: 'M3', qty: 1 }];
  assert.strictEqual(ingest(principal, 'stock', bad, { site: 'SITE-A', maxSkippedShare: 0.2 }).ok, false);
  assert.strictEqual(stockCount(rt, 'SITE-A'), 1);
  assert.ok(ingest(principal, 'stock', [], { site: 'SITE-A', allowEmpty: true }).ok);
  assert.strictEqual(stockCount(rt, 'SITE-A'), 0);
  rt.close();
});

test('file drop: imports stock_<SITE>.csv, moves bad files to failed/', () => {
  const { rt, ingest, principal } = setup();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drop-'));
  fs.writeFileSync(path.join(dir, 'stock_SITE-A.csv'), 'MATNR;CHARG;LGORT;MENGE;MEINS;VFDAT\n100101;B1;0001;1.234,5;KG;20271231\n');
  fs.writeFileSync(path.join(dir, 'stock_SITE-B.csv'), 'MATNR;MENGE\n100101;abc\n');
  const res = runFileDrop({ dir }, ingest, { principal, now: Date.now() + 10000 });
  assert.strictEqual(res.length, 2);
  assert.strictEqual(stockCount(rt, 'SITE-A'), 1);
  assert.strictEqual(stockCount(rt, 'SITE-B'), 0);
  assert.strictEqual(fs.readdirSync(path.join(dir, 'processed')).length, 1);
  assert.ok(fs.readdirSync(path.join(dir, 'failed')).some((f) => f.endsWith('.error.txt')));
  rt.close();
});

test('webhook: signed, filtered by event list', async () => {
  const { rt } = setup();
  const got = [];
  const recv = await mockSap((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { got.push({ h: req.headers, b }); res.end('ok'); }); });
  rt.transaction(() => { const rows = rt.ctx.store_read('Settings'); rows.forEach((r) => { if (r.key === 'webhookUrl') r.value = recv.url; if (r.key === 'webhookSecret') r.value = 's3cret'; if (r.key === 'webhookEvents') r.value = 'campaign.confirmed'; }); rt.ctx.store_write('Settings', rows); return { ok: true }; });
  startWebhooks(rt, quiet);
  rt.transaction(() => { rt.ctx.api_emit('batch.release', { id: 1 }); rt.ctx.api_emit('campaign.confirmed', { id: 2 }); return { ok: true }; });
  await new Promise((r) => setTimeout(r, 400));
  try {
    assert.strictEqual(got.length, 1);
    assert.strictEqual(got[0].h['x-br-event'], 'campaign.confirmed');
    assert.strictEqual(got[0].h['x-br-signature'], sign('s3cret', got[0].b));
    assert.strictEqual(JSON.parse(got[0].b).data.id, 2);
  } finally { recv.s.close(); rt.close(); }
});
