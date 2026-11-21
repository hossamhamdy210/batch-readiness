/**
 * Sync.js - bulk loading of the master data (also used by the integration API). Master data can be maintained in Excel or an ERP
 * (requirements, recipes, storage types, holds, accepted statuses, step timing).
 * Stock, documents, equipment and bio inventory use the normal import (api_import).
 */
var SYNC_LIMITS = { Products: 5000, Requirements: 50000, Recipes: 50000, StorageTypes: 500, Holds: 20000 };
var SYNC_TYPES = ['Material', 'Biological', 'Document', 'Equipment', 'Output'];
var SYNC_SETTING_KEYS = ['acceptedDocStatuses', 'acceptedEquipmentStatuses', 'acceptedStockCategories', 'equipmentBufferDays', 'exportMaxAgeDays'];

function sync_blank_(r) {
  return !Object.keys(r).some(function (k) { return String(r[k] == null ? '' : r[k]).trim() !== ''; });
}
function sync_num_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var n = Number(String(v).replace(',', '.'));
  return isFinite(n) ? n : NaN;
}

/** Replace one master table with the rows read from the workbook (all or nothing). */
function api_syncTable(user, p) {
  var name = p.table;
  if (!(name in SYNC_LIMITS)) throw new Error('This table cannot be loaded from Excel.');
  var rows = (p.rows || []).filter(function (r) { return !sync_blank_(r); });
  if (rows.length > SYNC_LIMITS[name]) throw new Error('Too many rows for ' + name + ' (limit ' + SYNC_LIMITS[name] + ').');
  var errors = [];
  function bad(i, msg) { if (errors.length < 15) errors.push('row ' + (i + 2) + ': ' + msg); }

  if (name === 'Products') {
    /* Excel adds and updates products; products that only exist in the web app are kept. */
    var have = store_read('Products'), idx = {};
    have.forEach(function (x, i) { idx[String(x.product).toLowerCase()] = i; });
    var added = 0, updated = 0;
    rows.forEach(function (r, i) {
      var nm = String(r.product || '').trim();
      if (!nm) { bad(i, 'product name is empty'); return; }
      var k = nm.toLowerCase(), desc = String(r.description || '').trim();
      if (k in idx) { if (desc) have[idx[k]].description = desc; updated++; }
      else { idx[k] = have.length; have.push({ product: nm, description: desc, active: 'Y' }); added++; }
    });
    if (errors.length) throw new Error('Not loaded - ' + errors.length + ' problem(s) in Products: ' + errors.join('; '));
    store_write('Products', have);
    store_log(user, 'sync:Products', added + ' added, ' + updated + ' updated');
    return { count: rows.length, added: added, updated: updated, version: store_version('Products') };
  }
  if (name === 'Requirements') {
    var steps = store_read('Steps'), stepMap = {};
    steps.forEach(function (s) { stepMap[String(s.step).toLowerCase()] = s.step; });
    var typeMap = {}; SYNC_TYPES.forEach(function (t) { typeMap[t.toLowerCase()] = t; });
    rows.forEach(function (r, i) {
      r.product = String(r.product || '').trim(); r.itemId = String(r.itemId || '').trim();
      var st = stepMap[String(r.step || '').trim().toLowerCase()];
      if (!r.product) bad(i, 'product is empty');
      if (!st) bad(i, 'unknown process step "' + r.step + '" (add it under Admin > Process steps first)'); else r.step = st;
      var ty = typeMap[String(r.type || '').trim().toLowerCase()];
      if (!ty) bad(i, 'unknown type "' + r.type + '"'); else r.type = ty;
      if (!r.itemId) bad(i, 'item ID is empty');
      var q = sync_num_(r.qty);
      if (q !== q) bad(i, 'quantity "' + r.qty + '" is not a number'); else r.qty = q;
      if ((ty === 'Material' || ty === 'Biological') && q === '') bad(i, 'quantity is missing for ' + r.itemId);
      var f = String(r.flag || '').trim().toUpperCase().slice(0, 1);
      r.flag = (f === 'Y' || f === 'N') ? f : '';
      r.usedFor = String(r.usedFor || '').trim() || 'Production';
    });
  } else if (name === 'Recipes') {
    rows.forEach(function (r, i) {
      r.parentId = String(r.parentId || '').trim(); r.componentId = String(r.componentId || '').trim();
      if (!r.parentId) bad(i, 'stock solution ID is empty');
      if (!r.componentId) bad(i, 'component ID is empty');
      ['yield', 'qty'].forEach(function (k) {
        var q = sync_num_(r[k]);
        if (q !== q || q === '') bad(i, k + ' "' + r[k] + '" is not a number'); else r[k] = q;
      });
    });
  } else if (name === 'StorageTypes') {
    rows.forEach(function (r, i) {
      r.type = String(r.type || '').trim();
      if (!r.type) bad(i, 'storage type is empty');
      r.usable = String(r.usable || '').trim().toUpperCase().slice(0, 1) === 'Y' ? 'Y' : 'N';
    });
  } else if (name === 'Holds') {
    rows.forEach(function (r, i) {
      if (!String(r.equipId || '').trim()) bad(i, 'equipment ID is empty');
    });
  }
  if (errors.length) throw new Error('Not loaded - ' + errors.length + ' problem(s) in ' + name + ': ' + errors.join('; '));

  store_write(name, rows);
  if (name === 'Requirements') sync_afterRequirements_(rows);
  store_log(user, 'sync:' + name, rows.length + ' rows');
  return { count: rows.length, version: store_version(name) };
}

/** Products and the "Used for" list follow the requirements. */
function sync_afterRequirements_(rows) {
  var prods = store_read('Products'), have = {};
  prods.forEach(function (p) { have[p.product.toLowerCase()] = 1; });
  var added = false;
  rows.forEach(function (r) {
    if (!have[r.product.toLowerCase()]) { prods.push({ product: r.product, description: '', active: 'Y' }); have[r.product.toLowerCase()] = 1; added = true; }
  });
  if (added) store_write('Products', prods);
  var S = store_kv('Settings'), list = String(S.usedForList || 'Production').split(';').map(function (x) { return x.trim(); }).filter(Boolean), changed = false;
  rows.forEach(function (r) { if (list.indexOf(r.usedFor) < 0) { list.push(r.usedFor); changed = true; } });
  if (changed) store_setKv('Settings', 'usedForList', list.join(';'));
}

/** Accepted statuses, buffer days, export age and step timing (administrators only). */
function api_syncParams(user, p) {
  var settings = p.settings || {}, applied = [];
  var rows = store_read('Settings');
  SYNC_SETTING_KEYS.forEach(function (k) {
    if (settings[k] === undefined || settings[k] === null || String(settings[k]).trim() === '') return;
    var found = false;
    rows.forEach(function (r) { if (r.key === k) { r.value = String(settings[k]); found = true; } });
    if (!found) rows.push({ key: k, value: String(settings[k]), description: '' });
    applied.push(k);
  });
  if (applied.length) store_write('Settings', rows);
  var steps = store_read('Steps'), changedSteps = 0;
  (p.steps || []).forEach(function (u) {
    steps.forEach(function (s) {
      if (String(s.step).toLowerCase() !== String(u.step || '').toLowerCase()) return;
      var o = sync_num_(u.occupancyDays), a = sync_num_(u.outputAvailDays);
      if (o === o && o !== '') { s.occupancyDays = o; changedSteps++; }
      if (a === a && a !== '') { s.outputAvailDays = a; }
    });
  });
  if (changedSteps) store_write('Steps', steps);
  store_log(user, 'sync:params', applied.length + ' settings, ' + changedSteps + ' steps');
  return { settings: applied, steps: changedSteps };
}

/** Column names of every table (used for the backup export). */
function api_syncSchema() {
  var o = {};
  Object.keys(SCHEMA).forEach(function (n) { o[n] = SCHEMA[n].map(function (c) { return c[0]; }); });
  return o;
}
