'use strict';
const test = require('node:test');
const assert = require('node:assert');
const m = require('../../server/integrations/mapping');

test('SAP and European number formats', () => {
  assert.strictEqual(m.parseNumber('1.234,56'), 1234.56);
  assert.strictEqual(m.parseNumber('1,234.56'), 1234.56);
  assert.strictEqual(m.parseNumber('12,5'), 12.5);
  assert.strictEqual(m.parseNumber('100-'), -100);
  assert.strictEqual(m.parseNumber('12.500'), 12.5);        // single dot = decimal point (OData style)
  assert.strictEqual(m.parseNumber('1.234.567'), 1234567);
  assert.strictEqual(m.parseNumber('abc'), null);
  assert.strictEqual(m.parseNumber(''), '');
});
test('dates: SAP, European, ISO, OData; ambiguous is refused', () => {
  assert.strictEqual(m.parseDate('20261231'), '2026-12-31');
  assert.strictEqual(m.parseDate('31.12.2026'), '2026-12-31');
  assert.strictEqual(m.parseDate('2026-12-31T10:00:00'), '2026-12-31');
  assert.strictEqual(m.parseDate('/Date(1798675200000)/'), '2026-12-31');
  assert.strictEqual(m.parseDate('00000000'), '');
  assert.strictEqual(m.parseDate('20261340'), null);
  assert.strictEqual(m.parseDate('03/04/2026'), null);
});
test('CSV: delimiter detection, quotes, BOM; mapping skips and reports unusable rows', () => {
  const recs = m.csvToRecords('﻿MATNR;MAKTX;MENGE\r\n100101;"Yeast; extract";1.234,5\r\n;x;1\r\n100102;Salt;abc\r\n');
  const r = m.mapRecords('stock', recs);
  assert.strictEqual(r.rows.length, 1);
  assert.strictEqual(r.rows[0].description, 'Yeast; extract');
  assert.strictEqual(r.rows[0].qty, 1234.5);
  assert.strictEqual(r.skipped, 2);
});
test('custom aliases extend the mapping', () => {
  const r = m.mapRecords('stock', [{ ZZMAT: 'A1', MENGE: '2' }], { extraAliases: { material: ['ZZMAT'] } });
  assert.strictEqual(r.rows[0].material, 'A1');
});
