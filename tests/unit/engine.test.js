const assert = require('assert');
const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = vm.createContext({ console });
['Engine.js', 'Defaults.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'core', f), 'utf8'), ctx, { filename: f }));
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'fixtures.js'), 'utf8'), ctx, { filename: 'fixtures.js' });
const srv = { ctx, run: (code) => vm.runInContext(code, ctx) };
const T = '2026-11-20';
const add = (d, n) => srv.run(`eng_iso(eng_day("${d}")+${n})`);
const fresh = () => srv.run(`fixture_db("${T}")`);
const calc = (db, p) => srv.ctx.eng_run(db, Object.assign({ product: 'PROD-A', step: 'Fermentation', site: 'SITE-A', n: 1, from: add(T, 10), to: add(T, 10) }, p), T);
const line = (b, item) => b.lines.find(l => l.item === item);
let pass = 0; const t = (name, fn) => { try { fn(); console.log('ok   ', name); pass++; } catch (e) { console.log('FAIL ', name, '\n     ', e.message); process.exitCode = 1; } };

t('1 single fermentation batch is READY, feed solution prepared, trace element taken over', () => {
  const r = calc(fresh(), {}), b = r.batches[0];
  assert.strictEqual(b.result, 'READY');
  const feed = line(b, '200001');
  assert.strictEqual(feed.status, 'PREPARE'); assert.strictEqual(feed.prep.preparations, 1);
  assert.strictEqual(feed.prep.components.find(c => c.item === '100106').status, 'TRANSFER');
  assert.strictEqual(line(b, '100103').toBook, 0, 'ammonia is in PSA');
  assert.strictEqual(line(b, '100101').toBook, 0.8, 'yeast must be booked to PSA');
  assert.strictEqual(b.summary.transfer, 1);
});
t('2 quality-inspection stock (Q3 / QI01) is not counted', () => {
  const db = fresh(); db.requirements.find(r => r.itemId === '100102').qty = 10;
  const l = line(calc(db, {}).batches[0], '100102');
  assert.strictEqual(l.status, 'MISSING', 'only 4 KG usable, QI stock must not help');
});
t('3 three batches share stock: bags run out and the third takes over from site B', () => {
  const r = calc(fresh(), { n: 3, from: add(T, 10), to: add(T, 60) });
  const s = r.batches.map(b => line(b, '300001').status);
  assert.strictEqual(JSON.stringify(s), JSON.stringify(['OK', 'OK', 'TRANSFER']));
});
t('4 fermenter double booking: batches 2 days apart', () => {
  const r = calc(fresh(), { n: 2, from: add(T, 10), to: add(T, 12) });
  assert.strictEqual(line(r.batches[1], 'FERM-01').status, 'EQUIPMENT BUSY');
  assert.strictEqual(r.batches[1].result, 'BLOCKED');
  assert.ok(/Equipment: 2/.test(r.batches[1].next) || /FERM-01/.test(r.batches[1].next));
});
t('5 equipment on hold / not released / calibration due', () => {
  let db = fresh(); db.equipment.find(e => e.equipId === 'FERM-01').status = 'On hold';
  let b = calc(db, {}).batches[0];
  assert.strictEqual(line(b, 'FERM-01').status, 'NOT RELEASED / DUE'); assert.strictEqual(b.result, 'BLOCKED');
  db = fresh(); db.equipment.find(e => e.equipId === 'FERM-01').due = add(T, 15);
  assert.strictEqual(line(calc(db, {}).batches[0], 'FERM-01').status, 'NOT RELEASED / DUE');
  db = fresh(); db.holds.push({ equipId: 'FERM-01', from: add(T, 11), until: add(T, 13), reason: 'maintenance' });
  b = calc(db, {}).batches[0];
  assert.strictEqual(line(b, 'FERM-01').status, 'EQUIPMENT BUSY'); assert.ok(/maintenance/.test(line(b, 'FERM-01').note));
  db = fresh(); db.requirements.find(r => r.itemId === 'LAF-01').flag = 'N'; db.holds.push({ equipId: 'LAF-01', from: add(T, 8), until: add(T, 11), reason: 'service' });
  assert.strictEqual(line(calc(db, {}).batches[0], 'LAF-01').status, 'EQUIPMENT BUSY', 'hold blocks even non-exclusive equipment');
});
t('6 document not effective and missing document', () => {
  const db = fresh(); db.documents.find(d => d.docId === 'DOC-1002').status = 'Draft'; db.documents = db.documents.filter(d => d.docId !== 'DOC-1003');
  const b = calc(db, {}).batches[0];
  assert.strictEqual(line(b, 'DOC-1002').status, 'NOT EFFECTIVE'); assert.strictEqual(line(b, 'DOC-1003').status, 'NOT IN LIST');
  assert.strictEqual(b.summary.docs, 2);
});
t('7 stock solution: no valid stock and component missing everywhere -> blocked', () => {
  const db = fresh(); db.stock = db.stock.filter(s => !(s.material === '200001')); db.stock = db.stock.filter(s => s.material !== '100106');
  const feed = line(calc(db, {}).batches[0], '200001');
  assert.strictEqual(feed.status, 'PREP: COMPONENT MISSING'); assert.strictEqual(feed.prep.preparations, 1);
});
t('8 stock solution: enough valid stock -> no preparation', () => {
  const db = fresh(); db.stock.find(s => s.material === '200001' && s.site === 'SITE-A').qty = 7;
  const feed = line(calc(db, {}).batches[0], '200001');
  assert.strictEqual(feed.status, 'OK'); assert.ok(!feed.prep);
});
t('9 expired stock is not counted at the batch start date', () => {
  const db = fresh(); // feed stock at site A expires day +20
  const feed = line(calc(db, { from: add(T, 30), to: add(T, 30) }).batches[0], '200001');
  assert.strictEqual(feed.prep.preparations, 1); assert.strictEqual(feed.short, 3);
});
t('10 whole preparations: 11 L missing of a 5 L preparation -> 3', () => {
  const db = fresh(); db.requirements.find(r => r.itemId === '200001').qty = 13; // 2 L in stock -> short 11
  const feed = line(calc(db, {}).batches[0], '200001');
  assert.strictEqual(feed.prep.preparations, 3);
  assert.strictEqual(feed.prep.components.find(c => c.item === '100104').need, 3.6);
});
t('11 unit mismatch', () => {
  const db = fresh(); db.requirements.find(r => r.itemId === '100101').unit = 'G';
  const b = calc(db, {}).batches[0];
  assert.strictEqual(line(b, '100101').status, 'UNIT MISMATCH'); assert.strictEqual(b.result, 'BLOCKED');
});
t('12 biological material per site, antibody aliquots shared between batches', () => {
  const r = calc(fresh(), { n: 4, from: add(T, 10), to: add(T, 80) });
  const s = r.batches.map(b => line(b, 'AB-PRIMARY').status);
  assert.strictEqual(JSON.stringify(s), JSON.stringify(['OK', 'OK', 'OK', 'TRANSFER']));
  assert.strictEqual(line(r.batches[3], 'AB-PRIMARY').transferFrom, 'SITE-B');
});
t('13 step All: IB preparation uses the expected pellet output of the fermentation', () => {
  const r = calc(fresh(), { step: 'All', stepOffset: 7 });
  assert.strictEqual(r.batches.length, 2);
  assert.strictEqual(line(r.batches[1], '900001').status, 'OK');
  const early = calc(fresh(), { step: 'All', stepOffset: 3 });
  assert.strictEqual(line(early.batches[1], '900001').status, 'MISSING', 'pellet not yet available after 3 days');
});
t('14 confirmed batch reserves stock and equipment for a new planned batch', () => {
  const db = fresh();
  db.confirmed.push({ id: 'C1', product: 'PROD-A', step: 'Fermentation', site: 'SITE-A', start: add(T, 11), status: 'Confirmed', archived: 'No' });
  const r = calc(db, {});
  assert.strictEqual(r.batches.length, 2); assert.strictEqual(r.batches[0].confirmed, true);
  assert.strictEqual(line(r.batches[1], 'FERM-01').status, 'EQUIPMENT BUSY');
  assert.strictEqual(line(r.batches[1], '300001').before, 2);
});
t('15 produced batch keeps reserving until ERP is updated and a NEW stock export is loaded', () => {
  const db = fresh();
  db.confirmed.push({ id: 'C1', product: 'PROD-A', step: 'Fermentation', site: 'SITE-A', start: add(T, 11), status: 'Produced', erpUpdated: 'Yes', bookingDate: T, completedAt: T + 'T10:00:00Z', archived: 'No' });
  db.meta['stock:SITE-A'] = T + 'T08:00:00Z';
  assert.strictEqual(calc(db, {}).batches.length, 2, 'export older than the ERP booking: still reserved');
  db.meta['stock:SITE-A'] = T + 'T11:00:00Z';
  assert.strictEqual(calc(db, {}).batches.length, 1, 'export loaded after the booking: released');
  db.confirmed[0].erpUpdated = 'No';
  assert.strictEqual(calc(db, {}).batches.length, 2, 'not booked in ERP: still reserved');
});
t('16 bulk storage lot counts as stock until booked in ERP', () => {
  const db = fresh(); db.requirements.find(r => r.itemId === '300002').qty = 30; // stock 10
  db.bulk.push({ lotId: 'L1', site: 'SITE-A', itemId: '300002', qty: 25, unit: 'ST', status: 'Stored', expiry: '', bookedInErp: 'No' });
  assert.strictEqual(line(calc(db, {}).batches[0], '300002').status, 'OK');
  db.bulk[0].bookedInErp = 'Yes';
  assert.notStrictEqual(line(calc(db, {}).batches[0], '300002').status, 'OK');
});
t('17 recommendations aggregate shortfalls and name the other site', () => {
  const r = calc(fresh(), { n: 3, from: add(T, 10), to: add(T, 60) });
  const rec = r.recommendations.find(x => x.item === '300001');
  assert.ok(rec && /Site B/.test(rec.text), JSON.stringify(rec));
});
t('18 a third site can be added and is used for take-over', () => {
  const db = fresh(); db.sites.push({ id: 'SITE-C', name: 'Site C', erpLocation: '', active: 'Y' });
  db.stock.push({ site: 'SITE-C', material: '300001', storageType: 'WH01', stockCategory: 'F1', expiry: '', qty: 500, unit: 'ST' });
  db.stock = db.stock.filter(s => !(s.site === 'SITE-B' && s.material === '300001'));
  const r = calc(db, { n: 3, from: add(T, 10), to: add(T, 60) });
  assert.strictEqual(line(r.batches[2], '300001').transferFrom, 'SITE-C');
});
t('19 freshness warnings', () => {
  const db = fresh(); db.meta['stock:SITE-A'] = add(T, -10) + 'T08:00:00Z';
  assert.ok(calc(db, {}).warnings.some(w => /older/.test(w)));
});
t('20 product without requirements', () => {
  assert.strictEqual(calc(fresh(), { product: 'PROD-B', step: 'IB preparation' }).batches[0].result, 'NO REQUIREMENTS');
});
console.log(pass + ' passed');
