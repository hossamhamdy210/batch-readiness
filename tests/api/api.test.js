'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { createRuntime } = require('../../server/runtime');
const { createApp } = require('../../server/app');

async function boot() {
  const rt = createRuntime({ dbFile: ':memory:', timezone: 'UTC', logger: { info() {}, error() {} } });
  rt.ensureInitialized({});
  const app = createApp(rt, { logger: { info() {}, error() {} } });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const rpc = async (token, action, payload) => {
    const r = await fetch(base + '/api/v1/rpc', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify({ action, payload }) });
    return { status: r.status, body: await r.json() };
  };
  return { rt, app, server, base, rpc, close: () => { server.close(); rt.close(); } };
}

test('register, login, init, wrong password, auth required', async () => {
  const t = await boot();
  try {
    assert.strictEqual((await t.rpc(null, 'init', {})).status, 401);
    const reg = await t.rpc(null, 'register', { email: 'admin@example.test', name: 'Admin', password: 'Correct-Horse-9', code: t.rt.setupCode() });
    assert.ok(reg.body.ok, JSON.stringify(reg.body));
    const bad = await t.rpc(null, 'login', { email: 'admin@example.test', password: 'nope' });
    assert.ok(!bad.body.ok);
    const login = await t.rpc(null, 'login', { email: 'admin@example.test', password: 'Correct-Horse-9' });
    assert.ok(login.body.ok, JSON.stringify(login.body));
    const token = login.body.data.token;
    const init = await t.rpc(token, 'init', {});
    assert.strictEqual(init.status, 200);
    assert.ok(init.body.ok);
    assert.strictEqual((await t.rpc(token, 'nosuch', {})).status, 404);
  } finally { t.close(); }
});

test('API keys + integration import with SAP field names and safety guards', async () => {
  const t = await boot();
  try {
    await t.rpc(null, 'register', { email: 'a@example.test', name: 'A', password: 'Correct-Horse-9', code: t.rt.setupCode() });
    const token = (await t.rpc(null, 'login', { email: 'a@example.test', password: 'Correct-Horse-9' })).body.data.token;
    const sites = (await t.rpc(token, 'init', {})).body.data;
    // add a site through the generic table save
    const site = 'S1';
    const cur = (await t.rpc(token, 'tableGet', { table: 'Sites' })).body.data;
    const sv = await t.rpc(token, 'tableSave', { table: 'Sites', version: cur.version, rows: cur.rows.concat([{ id: site, name: 'Site One' }]) });
    assert.ok(sv.body.ok, JSON.stringify(sv.body));
    const key = (await t.rpc(token, 'apiKeyCreate', { name: 'sap', role: 'writer' })).body.data.key;
    const ro = (await t.rpc(token, 'apiKeyCreate', { name: 'ro', role: 'reader' })).body.data.key;
    const put = (k, path, body, type) => fetch(t.base + path, { method: 'PUT', headers: { authorization: 'Bearer ' + k, 'content-type': type || 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

    assert.strictEqual((await put('brk_bad', '/integration/v1/stock?site=S1', [])).status, 401);
    assert.strictEqual((await put(ro, '/integration/v1/stock?site=S1', [{}])).status, 403);

    const csv = 'MATNR;MAKTX;CHARG;LGORT;MENGE;MEINS;VFDAT;WERKS\n100101;Yeast;B1;0001;1.234,5;KG;20271231;S1\n100102;Salt;B2;0001;10;KG;20271231;S1\n';
    let r = await put(key, '/integration/v1/stock', csv, 'text/csv');
    let j = await r.json();
    assert.strictEqual(r.status, 200, JSON.stringify(j));
    assert.deepStrictEqual(j.imported, [{ site: 'S1', rows: 2 }]);
    let rows = (await t.rpc(token, 'tableGet', { table: 'ErpStock', site: 'S1' })).body.data.rows;
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows.find((x) => x.material === '100101').qty, 1234.5);

    // empty file must not wipe
    r = await put(key, '/integration/v1/stock?site=S1', 'MATNR;MENGE\n', 'text/csv');
    assert.strictEqual(r.status, 422);
    rows = (await t.rpc(token, 'tableGet', { table: 'ErpStock', site: 'S1' })).body.data.rows;
    assert.strictEqual(rows.length, 2);
    // dry run changes nothing
    r = await put(key, '/integration/v1/stock?site=S1&dryRun=true', [{ material: 'X', qty: 1 }]);
    assert.strictEqual((await r.json()).wouldImport, 1);
    assert.strictEqual((await t.rpc(token, 'tableGet', { table: 'ErpStock', site: 'S1' })).body.data.rows.length, 2);
    // unknown site refused
    r = await put(key, '/integration/v1/stock?site=NOPE', [{ material: 'X', qty: 1 }]);
    assert.strictEqual(r.status, 422);
    // revoked key stops working
    const list = (await t.rpc(token, 'apiKeyList', {})).body.data;
    await t.rpc(token, 'apiKeyRevoke', { id: list.find((k) => k.name === 'sap').id });
    assert.strictEqual((await put(key, '/integration/v1/stock?site=S1', [{ material: 'X', qty: 1 }])).status, 401);
    const runs = (await t.rpc(token, 'integrationRuns', {})).body.data;
    assert.ok(runs.length >= 2);
  } finally { t.close(); }
});

test('readiness endpoint answers with a reader key', async () => {
  const { seed } = require('../../scripts/seed-demo');
  const t = await boot();
  try {
    await t.rpc(null, 'register', { email: 'a@example.test', name: 'A', password: 'Correct-Horse-9', code: t.rt.setupCode() });
    seed(t.rt);
    const token = (await t.rpc(null, 'login', { email: 'a@example.test', password: 'Correct-Horse-9' })).body.data.token;
    const ro = (await t.rpc(token, 'apiKeyCreate', { name: 'ro', role: 'reader' })).body.data.key;
    const day = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
    const r = await fetch(t.base + '/integration/v1/readiness?product=DEMO-PRODUCT-A&site=SITE-A&batches=1&from=' + day, { headers: { authorization: 'Bearer ' + ro } });
    const j = await r.json();
    assert.strictEqual(r.status, 200, JSON.stringify(j));
    assert.ok(j.data.batches.length >= 1);
    assert.strictEqual((await fetch(t.base + '/integration/v1/readiness?site=SITE-A', { headers: { authorization: 'Bearer ' + ro } })).status, 422);
  } finally { t.close(); }
});
