/**
 * Schema.js - the data model and the storage-independent helpers.
 * The storage itself is a port: the runtime provides store_read(name), store_write(name, rows), store_append(name, rows),
 * store_version(name) and store_bump(name). Column types: s = text, n = number, d = date (yyyy-mm-dd text).
 */
var SCHEMA = {
  Settings:     [['key', 's'], ['value', 's'], ['description', 's']],
  Sites:        [['id', 's'], ['name', 's'], ['erpLocation', 's'], ['active', 's']],
  Steps:        [['step', 's'], ['code', 's'], ['occupancyDays', 'n'], ['outputAvailDays', 'n'], ['active', 's']],
  StorageTypes: [['type', 's'], ['usable', 's'], ['area', 's'], ['comment', 's']],
  Products:     [['product', 's'], ['description', 's'], ['active', 's']],
  Requirements: [['product', 's'], ['step', 's'], ['usedFor', 's'], ['type', 's'], ['itemId', 's'], ['description', 's'],
                 ['qty', 'n'], ['unit', 's'], ['flag', 's'], ['comment', 's']],
  Recipes:      [['parentId', 's'], ['parentDesc', 's'], ['yield', 'n'], ['yieldUnit', 's'], ['componentId', 's'],
                 ['componentDesc', 's'], ['qty', 'n'], ['unit', 's'], ['comment', 's']],
  ErpStock:     [['site', 's'], ['material', 's'], ['storageBin', 's'], ['storageType', 's'], ['description', 's'],
                 ['batch', 's'], ['stockCategory', 's'], ['expiry', 'd'], ['qty', 'n'], ['unit', 's']],
  Documents:    [['docId', 's'], ['title', 's'], ['version', 's'], ['status', 's'], ['effectiveDue', 'd']],
  Equipment:    [['equipId', 's'], ['description', 's'], ['status', 's'], ['due', 'd']],
  Holds:        [['equipId', 's'], ['from', 'd'], ['until', 'd'], ['reason', 's']],
  Bio:          [['category', 's'], ['itemId', 's'], ['description', 's'], ['lot', 's'], ['site', 's'], ['storage', 's'],
                 ['qty', 'n'], ['unit', 's'], ['status', 's'], ['expiry', 'd']],
  Confirmed:    [['id', 's'], ['product', 's'], ['step', 's'], ['site', 's'], ['start', 'd'], ['status', 's'], ['poNo', 's'],
                 ['producedQty', 'n'], ['producedDate', 'd'], ['erpUpdated', 's'], ['bookingDate', 'd'],
                 ['confirmedBy', 's'], ['confirmedAt', 's'], ['note', 's'], ['archived', 's'], ['completedAt', 's']],
  Bulk:         [['lotId', 's'], ['site', 's'], ['itemId', 's'], ['description', 's'], ['qty', 'n'], ['unit', 's'],
                 ['freezer', 's'], ['status', 's'], ['expiry', 'd'], ['bookedInErp', 's'], ['sourceBatch', 's'], ['created', 's']],
  Report:       [['id', 's'], ['product', 's'], ['step', 's'], ['site', 's'], ['plannedStart', 'd'], ['producedDate', 'd'],
                 ['plannedQty', 'n'], ['producedQty', 'n'], ['unit', 's'], ['variancePct', 'n'], ['poNo', 's'],
                 ['confirmedBy', 's'], ['archivedAt', 's']],
  Users:        [['email', 's'], ['name', 's'], ['role', 's'], ['status', 's'], ['salt', 's'], ['hash', 's'], ['created', 's'], ['lastLogin', 's']],
  AuditLog:     [['time', 's'], ['user', 's'], ['action', 's'], ['detail', 's']],
  Meta:         [['key', 's'], ['value', 's']],
  ApiKeys:      [['id', 's'], ['name', 's'], ['prefix', 's'], ['hash', 's'], ['role', 's'], ['status', 's'], ['created', 's'], ['createdBy', 's'], ['lastUsed', 's']],
  IntegrationRuns: [['time', 's'], ['source', 's'], ['site', 's'], ['status', 's'], ['rows', 'n'], ['message', 's']]
};

function store_date_(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v == null ? '' : v).trim();
}

function store_cell_(v, t) {
  if (v === null || v === undefined) return '';
  if (t === 'n') { if (v === '') return ''; var n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : ''; }
  if (t === 'd') return store_date_(v);
  return String(v);
}

/* ---- key/value helpers (Settings and Meta) ---- */
function store_kv(name) {
  var o = {};
  store_read(name).forEach(function (r) { o[r.key] = r.value; });
  return o;
}
function store_setKv(name, key, value) {
  var rows = store_read(name), found = false;
  rows.forEach(function (r) { if (r.key === key) { r.value = String(value); found = true; } });
  if (!found) { var o = { key: key }; o.value = String(value); rows.push(o); }
  store_write(name, rows);
}

/** Everything the engine needs, read once. */
function store_db() {
  var db = {
    sites: store_read('Sites'), steps: store_read('Steps'), settings: store_kv('Settings'),
    storageTypes: store_read('StorageTypes'), products: store_read('Products'),
    requirements: store_read('Requirements'), recipes: store_read('Recipes'), stock: store_read('ErpStock'),
    documents: store_read('Documents'), equipment: store_read('Equipment'), holds: store_read('Holds'),
    bio: store_read('Bio'), confirmed: store_read('Confirmed'), bulk: store_read('Bulk'), meta: store_kv('Meta')
  };
  return db;
}

function store_log(user, action, detail) {
  try {
    store_append('AuditLog', [{ time: new Date().toISOString(), user: user ? user.email : '-', action: action, detail: String(detail || '').slice(0, 500) }]);
  } catch (e) { /* never block the real action */ }
}
