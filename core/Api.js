/**
 * Api.js - the single entry point of the application: api(token, action, payload).
 * Every action declares the minimum role and whether it writes (the runtime wraps writes in one database transaction).
 */
var EDIT_TABLES = {          // table -> minimum role to change it
  Products: 'editor', Requirements: 'editor', Recipes: 'editor', StorageTypes: 'editor',
  Documents: 'editor', Equipment: 'editor', Holds: 'editor', Bio: 'editor',
  Bulk: 'planner', Sites: 'admin', Steps: 'admin'
};
var READ_TABLES = ['Products', 'Requirements', 'Recipes', 'StorageTypes', 'Documents', 'Equipment', 'Holds', 'Bio',
                   'Bulk', 'Sites', 'Steps', 'Confirmed', 'Report', 'ErpStock'];
var IMPORT_TABLES = { ErpStock: 'site', Documents: null, Equipment: null, Bio: null };
var MAX_ROWS = { ErpStock: 250000, Requirements: 50000, Recipes: 50000, Documents: 50000, Equipment: 20000, Bio: 50000 };

function api(token, action, payload) {
  try {
    var h = API_ACTIONS[action];
    if (!h) throw new Error('Unknown action.');
    return api_exec(h, h.pub ? null : auth_user(token), payload, token);
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

/** Machine access (API keys): same actions and role checks, the caller is a service principal. */
function api_asService(principal, action, payload) {
  try {
    var h = API_ACTIONS[action];
    if (!h || h.pub) throw new Error('Unknown action.');
    return api_exec(h, principal, payload, null);
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

function api_exec(h, user, payload, token) {
  if (user && ROLE_RANK[user.role] < ROLE_RANK[h.role || 'viewer']) throw new Error('Your role (' + user.role + ') is not allowed to do this.');
  return { ok: true, data: h.fn(user, payload || {}, token) };
}
function api_isWrite(action) { return !!(API_ACTIONS[action] && API_ACTIONS[action].write); }
function api_emit(type, data) { if (typeof platform_emit === 'function') platform_emit(type, data); }

function api_today() { return port.today(); }

function api_init(user) {
  var S = store_kv('Settings');
  var lists = {
    docStatuses: S.acceptedDocStatuses, equipStatuses: S.acceptedEquipmentStatuses, bioStatuses: S.acceptedBioStatuses,
    bulkStatuses: S.acceptedBulkStatuses
  };
  return {
    user: auth_publicUser(user), appName: S.appName || 'Batch Readiness', today: api_today(),
    sites: store_read('Sites'), steps: store_read('Steps'),
    products: store_read('Products').filter(function (p) { return eng_yes(p.active, true); }),
    types: ['Material', 'Biological', 'Document', 'Equipment', 'Output'],
    usedFor: String(S.usedForList || 'Production').split(';').map(function (x) { return x.trim(); }).filter(Boolean),
    meta: store_kv('Meta'), lists: lists, maxUsers: S.maxUsers || '12'
  };
}

function api_calc(user, p) {
  var db = store_db();
  if (!p.product) throw new Error('Choose a product.');
  if (!p.site) throw new Error('Choose a site.');
  var res = eng_run(db, p, api_today());
  res.meta = db.meta;
  return res;
}

/* ---- tables ---- */
function api_tableGet(user, p) {
  var name = p.table;
  if (READ_TABLES.indexOf(name) < 0) throw new Error('Unknown table.');
  var rows = store_read(name);
  if (p.site && name === 'ErpStock') rows = rows.filter(function (r) { return r.site === p.site; });
  if (p.site && name === 'Bio') rows = rows.filter(function (r) { return r.site === p.site; });
  var total = rows.length, limit = p.limit || 0;
  if (limit && rows.length > limit) rows = rows.slice(0, limit);
  return { rows: rows, total: total, version: store_version(name) };
}

function api_tableSave(user, p) {
  var name = p.table, need = EDIT_TABLES[name];
  if (!need) throw new Error('This table cannot be edited here.');
  if (ROLE_RANK[user.role] < ROLE_RANK[need]) throw new Error('Your role is not allowed to change ' + name + '.');
  if (store_version(name) !== String(p.version)) throw new Error('Somebody else changed this table meanwhile. Reload and repeat your change.');
  var rows = p.rows || [];
  if (rows.length > (MAX_ROWS[name] || 5000)) throw new Error('Too many rows.');
  var cleaned = rows.filter(function (r) {
    return Object.keys(r).some(function (k) { return String(r[k] == null ? '' : r[k]).trim() !== ''; });
  });
  if (name === 'Sites') {
    var ids = {};
    cleaned.forEach(function (s) {
      s.id = String(s.id || '').trim();
      if (!s.id) throw new Error('Every site needs an ID.');
      if (ids[s.id.toLowerCase()]) throw new Error('Site ID ' + s.id + ' is used twice.');
      ids[s.id.toLowerCase()] = 1;
    });
    if (!cleaned.length) throw new Error('At least one site is needed.');
  }
  store_write(name, cleaned);
  store_log(user, 'save:' + name, cleaned.length + ' rows');
  return { version: store_version(name), count: cleaned.length };
}

/** Chunked import: first chunk may delete the old data (replace), later chunks append. */
function api_import(user, p) {
  var name = p.table;
  if (!(name in IMPORT_TABLES)) throw new Error('This table cannot be imported.');
  var rows = p.rows || [];
  var perSite = IMPORT_TABLES[name];
  var site = String(p.site || '').trim();
  if (name === 'ErpStock' || name === 'Bio') {
    if (!site) throw new Error('Choose the site of this export.');
    var known = store_read('Sites').some(function (s) { return s.id === site; });
    if (!known) throw new Error('Unknown site.');
  }
  var existing = [];
  if (p.first) {
    var all = store_read(name);
    if (name === 'ErpStock' || name === 'Bio') existing = all.filter(function (r) { return r.site !== site; });
  } else {
    existing = null;
  }
  rows.forEach(function (r) { if (name === 'ErpStock' || name === 'Bio') r.site = site; });
  if (p.first) {
    if (existing.length + rows.length > (MAX_ROWS[name] || 10000)) throw new Error('Too many rows (limit ' + (MAX_ROWS[name] || 10000) + ').');
    store_write(name, existing.concat(rows));
  } else {
    store_append(name, rows);
  }
  if (p.last) {
    var key = name === 'ErpStock' ? 'stock:' + site : (name === 'Bio' ? 'bio' : name.toLowerCase());
    if (name === 'Documents') key = 'documents';
    store_setKv('Meta', key, new Date().toISOString());
    if (name === 'Bio') store_setKv('Meta', 'bio:' + site, new Date().toISOString());
    store_log(user, 'import:' + name, (site ? site + ' ' : '') + (p.total || rows.length) + ' rows');
  }
  return { ok: true };
}

/* ---- campaign actions ---- */
function api_confirm(user, p) {
  var db = store_db();
  var res = eng_run(db, p, api_today());
  var planned = res.batches.filter(function (b) { return !b.confirmed; });
  if (!planned.length) throw new Error('Nothing to confirm.');
  var existing = {}; db.confirmed.forEach(function (c) { existing[c.id] = 1; });
  var rows = [], skippedBlocked = 0;
  planned.forEach(function (b) {
    if (b.result !== 'READY' && !p.includeBlocked) { skippedBlocked++; return; }
    if (existing[b.id]) throw new Error('Batch ' + b.id + ' is already confirmed.');
    rows.push({ id: b.id, product: b.product, step: b.step, site: b.site, start: b.start, status: 'Confirmed', poNo: '',
                producedQty: '', producedDate: '', erpUpdated: 'No', bookingDate: '', confirmedBy: user.email,
                confirmedAt: new Date().toISOString(), note: b.result === 'READY' ? '' : 'Confirmed although ' + b.result, archived: 'No', completedAt: '' });
  });
  if (!rows.length) throw new Error('No batch was confirmed: all are blocked. Tick "include blocked batches" to confirm anyway.');
  store_append('Confirmed', rows);
  store_log(user, 'confirm', rows.length + ' batch(es) ' + p.product);
  api_emit('campaign.confirmed', { product: p.product, batches: rows.map(function (r) { return { id: r.id, step: r.step, site: r.site, start: r.start }; }), by: user.email });
  return { confirmed: rows.length, skippedBlocked: skippedBlocked };
}

function api_confirmedUpdate(user, p) {
  var rows = store_read('Confirmed'), t = null;
  rows.forEach(function (r) { if (r.id === p.id) t = r; });
  if (!t) throw new Error('Batch not found.');
  if (p.action === 'po') { t.poNo = String(p.poNo || ''); }
  else if (p.action === 'cancel') { t.status = 'Cancelled'; }
  else if (p.action === 'reopen') { t.status = 'Confirmed'; t.archived = 'No'; }
  else if (p.action === 'complete') {
    if (String(t.status).toLowerCase() === 'cancelled') throw new Error('A cancelled batch cannot be completed.');
    t.status = 'Produced';
    t.producedQty = p.producedQty === '' ? '' : Number(p.producedQty);
    t.producedDate = p.producedDate || api_today();
    t.erpUpdated = eng_yes(p.erpUpdated) ? 'Yes' : 'No';
    t.bookingDate = p.bookingDate || '';
    t.completedAt = eng_yes(p.erpUpdated) ? new Date().toISOString() : '';
    if (eng_yes(p.erpUpdated) && !t.bookingDate) throw new Error('Enter the ERP booking date.');
    if (p.bulk && p.bulk.add) {
      var b = p.bulk;
      if (!b.itemId || !(Number(b.qty) > 0)) throw new Error('Bulk storage needs an item and a quantity.');
      store_append('Bulk', [{ lotId: b.lotId || ('LOT-' + t.id), site: t.site, itemId: b.itemId, description: b.description || '',
                              qty: Number(b.qty), unit: b.unit || '', freezer: b.freezer || '', status: 'Stored',
                              expiry: b.expiry || '', bookedInErp: 'No', sourceBatch: t.id, created: new Date().toISOString() }]);
    }
  } else throw new Error('Unknown action.');
  store_write('Confirmed', rows);
  store_log(user, 'batch:' + p.action, t.id);
  api_emit('batch.' + p.action, { id: t.id, product: t.product, step: t.step, site: t.site, status: t.status, producedQty: t.producedQty, producedDate: t.producedDate, by: user.email });
  return true;
}

function api_archive(user) {
  var db = store_db(), reserving = {};
  eng_reservingConfirmed(db).forEach(function (c) { reserving[c.id] = 1; });
  var reqIdx = {};
  db.requirements.forEach(function (r) {
    if (eng_norm(r.type) === 'output') reqIdx[eng_norm(r.product) + '|' + eng_norm(r.step)] = r;
  });
  var rows = db.confirmed, report = [], n = 0;
  rows.forEach(function (c) {
    if (String(c.status).toLowerCase() !== 'produced' || eng_yes(c.archived) || reserving[c.id]) return;
    var out = reqIdx[eng_norm(c.product) + '|' + eng_norm(c.step)];
    var planned = out ? eng_num(out.qty) : '';
    var produced = c.producedQty === '' ? '' : eng_num(c.producedQty);
    report.push({ id: c.id, product: c.product, step: c.step, site: c.site, plannedStart: c.start, producedDate: c.producedDate,
                  plannedQty: planned, producedQty: produced, unit: out ? out.unit : '',
                  variancePct: (planned && produced !== '') ? Math.round((produced - planned) / planned * 1000) / 10 : '',
                  poNo: c.poNo, confirmedBy: c.confirmedBy, archivedAt: new Date().toISOString() });
    c.archived = 'Yes'; n++;
  });
  if (n) { store_append('Report', report); store_write('Confirmed', rows); }
  store_log(user, 'archive', n + ' batch(es)');
  return { archived: n };
}

/* ---- users, settings, log ---- */
function api_users(user) { return auth_userRows().map(auth_publicUser); }
function api_userAdmin(user, p) { return auth_adminUpdate(user, p); }
function api_settingsGet() { return store_read('Settings'); }
function api_settingsSave(user, p) {
  var rows = (p.rows || []).map(function (r) { return { key: String(r.key), value: String(r.value == null ? '' : r.value), description: String(r.description || '') }; });
  store_write('Settings', rows);
  store_log(user, 'settings', rows.length + ' keys');
  return true;
}
function api_audit(user) { var r = store_read('AuditLog'); return r.slice(-300).reverse(); }

var API_ACTIONS = {
  authState:     { pub: true, fn: function () { return auth_state(); } },
  register:      { pub: true, write: true, fn: function (u, p) { return auth_register(p); } },
  login:         { pub: true, write: true, fn: function (u, p) { return auth_login(p); } },
  logout:        { fn: function (u, p, t) { auth_logout(t); return true; } },
  init:          { fn: api_init },
  calc:          { fn: api_calc },
  tableGet:      { fn: api_tableGet },
  tableSave:     { role: 'planner', write: true, fn: api_tableSave },
  importData:    { role: 'editor', write: true, fn: api_import },
  confirm:       { role: 'planner', write: true, fn: api_confirm },
  confirmedUpd:  { role: 'planner', write: true, fn: api_confirmedUpdate },
  archive:       { role: 'planner', write: true, fn: api_archive },
  changePw:      { write: true, fn: function (u, p) { return auth_changeOwnPassword(u, p); } },
  users:         { role: 'admin', fn: api_users },
  userAdmin:     { role: 'admin', write: true, fn: api_userAdmin },
  settingsGet:   { role: 'admin', fn: api_settingsGet },
  settingsSave:  { role: 'admin', write: true, fn: api_settingsSave },
  syncTable:     { role: 'editor', write: true, fn: function (u, p) { return api_syncTable(u, p); } },
  syncParams:    { role: 'admin', write: true, fn: function (u, p) { return api_syncParams(u, p); } },
  syncSchema:    { fn: function () { return api_syncSchema(); } },
  apiKeyList:    { role: 'admin', fn: function () { return api_apiKeyList(); } },
  apiKeyCreate:  { role: 'admin', write: true, fn: function (u, p) { return api_apiKeyCreate(u, p); } },
  apiKeyRevoke:  { role: 'admin', write: true, fn: function (u, p) { return api_apiKeyRevoke(u, p); } },
  integrationRuns: { role: 'admin', fn: function () { return store_read('IntegrationRuns').slice(-100).reverse(); } },
  resetOps:      { role: 'admin', write: true, fn: function (u, p) { return api_resetOps(u, p); } },
  audit:         { role: 'admin', fn: api_audit }
};

/** Administrator: empties the day-to-day data (confirmed batches, bulk lots, report archive). Master data, imports and users stay. */
function api_resetOps(user, p) {
  var map = { confirmed: 'Confirmed', bulk: 'Bulk', report: 'Report' }, done = [];
  if (String(p.confirm || '') !== 'RESET') throw new Error('Type RESET to confirm.');
  Object.keys(map).forEach(function (k) {
    if (p[k]) { var n = store_read(map[k]).length; store_write(map[k], []); done.push(map[k] + ': ' + n + ' rows removed'); }
  });
  if (!done.length) throw new Error('Nothing selected.');
  store_log(user, 'resetOps', done.join('; '));
  return { done: done };
}

/* ---- machine access: API keys (the key itself is shown once, only its hash is stored) ---- */
var KEY_ROLES = { reader: 'viewer', writer: 'editor' };

function api_apiKeyList() {
  return store_read('ApiKeys').map(function (k) { return { id: k.id, name: k.name, prefix: k.prefix, role: k.role, status: k.status, created: k.created, createdBy: k.createdBy, lastUsed: k.lastUsed }; });
}
function api_apiKeyCreate(user, p) {
  var name = String(p.name || '').trim(), role = String(p.role || '');
  if (!name || name.length > 60) throw new Error('Enter a name for the key (up to 60 characters).');
  if (!KEY_ROLES[role]) throw new Error('Role must be reader or writer.');
  var rows = store_read('ApiKeys');
  if (rows.filter(function (k) { return k.status === 'active'; }).length >= 50) throw new Error('Too many active keys (limit 50).');
  var raw = 'brk_' + port.uuid().replace(/-/g, '') + port.uuid().replace(/-/g, '').slice(0, 16);
  rows.push({ id: port.uuid().slice(0, 8), name: name, prefix: raw.slice(0, 10), hash: port.sha256(raw), role: role, status: 'active', created: new Date().toISOString(), createdBy: user.email, lastUsed: '' });
  store_write('ApiKeys', rows);
  store_log(user, 'apiKey:create', name + ' (' + role + ')');
  return { key: raw, id: rows[rows.length - 1].id };
}
function api_apiKeyRevoke(user, p) {
  var rows = store_read('ApiKeys'), t = null;
  rows.forEach(function (k) { if (k.id === p.id) t = k; });
  if (!t) throw new Error('Key not found.');
  t.status = 'revoked'; store_write('ApiKeys', rows);
  store_log(user, 'apiKey:revoke', t.name);
  return true;
}
/** Returns the service principal for a presented key, or null. Pure read. */
function api_keyPrincipal(raw) {
  if (!raw || String(raw).indexOf('brk_') !== 0) return null;
  var h = port.sha256(String(raw)), found = null;
  store_read('ApiKeys').forEach(function (k) { if (k.status === 'active' && k.hash === h) found = k; });
  return found ? { email: 'api:' + found.name, name: found.name, role: KEY_ROLES[found.role], keyId: found.id, lastUsed: found.lastUsed } : null;
}
function api_touchKey(id) {
  var rows = store_read('ApiKeys');
  rows.forEach(function (k) { if (k.id === id) k.lastUsed = new Date().toISOString(); });
  store_write('ApiKeys', rows);
}
function integration_log(source, site, status, rowsCount, message) {
  store_append('IntegrationRuns', [{ time: new Date().toISOString(), source: source, site: site || '', status: status, rows: rowsCount === undefined ? '' : rowsCount, message: String(message || '').slice(0, 500) }]);
}
/** One-shot replace of an import table (used by the integration endpoints and connectors). */
function api_replaceImport(principal, table, site, rows) {
  return api_import(principal, { table: table, site: site || '', rows: rows, first: true, last: true, total: rows.length });
}
