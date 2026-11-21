'use strict';
/**
 * runtime.js - the platform adapter ("ports and adapters").
 *
 * The business logic in core/ is plain JavaScript that knows nothing about storage, crypto or HTTP. It is loaded into
 * one isolated scope and receives its platform through:
 *   - store_read / store_write / store_append / store_version / store_bump   (SQLite, see below)
 *   - port.hash / port.sha256 / port.uuid / port.today / port.cache / port.props
 *   - platform_emit(type, data)                                              (events -> webhooks)
 * Every write action runs in ONE database transaction: if the action fails, nothing is changed.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const { EventEmitter } = require('events');
const Database = require('better-sqlite3');

const CORE_DIR = path.join(__dirname, '..', 'core');
const CORE_FILES = ['Schema.js', 'Defaults.js', 'Engine.js', 'Auth.js', 'Sync.js', 'Api.js'];

function localDate(tz, d) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
  catch (e) { return d.toISOString().slice(0, 10); }
}

function createRuntime({ dbFile, timezone = 'UTC', logger = console, clock = () => new Date() } = {}) {
  if (!dbFile) throw new Error('dbFile is required');
  if (dbFile !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbFile)), { recursive: true });
  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL'); db.pragma('synchronous = NORMAL'); db.pragma('busy_timeout = 5000'); db.pragma('foreign_keys = ON');
  // second connection: sessions and login counters must survive a rolled-back transaction
  const cdb = new Database(dbFile === ':memory:' ? ':memory:' : dbFile + '-cache');   // separate file: sessions and lockout counters survive a rolled-back transaction and never contend with it
  if (dbFile !== ':memory:') { cdb.pragma('journal_mode = WAL'); cdb.pragma('busy_timeout = 5000'); }
  const events = new EventEmitter();
  let pending = [], lastVersion = 0;

  db.exec('CREATE TABLE IF NOT EXISTS props (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS table_versions (name TEXT PRIMARY KEY, version TEXT NOT NULL)');
  cdb.exec('CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT NOT NULL, exp INTEGER NOT NULL)');

  /* ---------- ports ---------- */
  const propGet = db.prepare('SELECT v FROM props WHERE k = ?'), propSet = db.prepare('INSERT OR REPLACE INTO props (k, v) VALUES (?, ?)'), propDel = db.prepare('DELETE FROM props WHERE k = ?');
  const cGet = cdb.prepare('SELECT v, exp FROM cache WHERE k = ?'), cPut = cdb.prepare('INSERT OR REPLACE INTO cache (k, v, exp) VALUES (?, ?, ?)'), cDel = cdb.prepare('DELETE FROM cache WHERE k = ?');
  const port = {
    uuid: () => crypto.randomUUID(),
    today: () => localDate(timezone, clock()),
    hash: (pw, salt) => crypto.scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 }).toString('base64'),
    sha256: (s) => crypto.createHash('sha256').update(String(s)).digest('base64'),
    props: {
      getProperty: (k) => { const r = propGet.get(k); return r ? r.v : null; },
      setProperty: (k, v) => { propSet.run(k, String(v)); },
      deleteProperty: (k) => { propDel.run(k); }
    },
    cache: {
      get: (k) => { const r = cGet.get(k); if (!r) return null; if (r.exp < Date.now()) { cDel.run(k); return null; } return r.v; },
      put: (k, v, ttlSeconds) => { cPut.run(k, String(v), Date.now() + (ttlSeconds || 600) * 1000); },
      remove: (k) => { cDel.run(k); }
    }
  };

  /* ---------- sandbox for the core ---------- */
  const sandbox = { Date, Math, JSON, Object, Array, String, Number, isFinite, parseInt, RegExp, Error, port };
  const ctx = vm.createContext(sandbox);
  sandbox.platform_emit = (type, data) => { pending.push({ type, data: JSON.parse(JSON.stringify(data)) }); };

  /* ---------- storage (SQLite): one SQL table per logical table ---------- */
  const stmts = {};
  const q = (n) => '"' + n + '"';
  function tableName(name) { return 't_' + name; }
  function migrate() {
    const SCHEMA = ctx.SCHEMA;
    Object.keys(SCHEMA).forEach((name) => {
      const cols = SCHEMA[name], t = q(tableName(name));
      db.exec('CREATE TABLE IF NOT EXISTS ' + t + ' (_id INTEGER PRIMARY KEY AUTOINCREMENT' + cols.map((c) => ', ' + q(c[0]) + (c[1] === 'n' ? ' REAL' : ' TEXT NOT NULL DEFAULT \'\'')).join('') + ')');
      const have = new Set(db.prepare('PRAGMA table_info(' + t + ')').all().map((r) => r.name));
      cols.forEach((c) => { if (!have.has(c[0])) db.exec('ALTER TABLE ' + t + ' ADD COLUMN ' + q(c[0]) + (c[1] === 'n' ? ' REAL' : ' TEXT NOT NULL DEFAULT \'\'')); });
    });
    db.exec('CREATE INDEX IF NOT EXISTS ix_stock_site ON t_ErpStock (site)');
    db.exec('CREATE INDEX IF NOT EXISTS ix_bio_site ON t_Bio (site)');
    db.exec('CREATE INDEX IF NOT EXISTS ix_users_email ON t_Users (email)');
  }
  function st(kind, name) {
    const key = kind + ':' + name;
    if (stmts[key]) return stmts[key];
    const cols = ctx.SCHEMA[name], t = q(tableName(name)), list = cols.map((c) => q(c[0])).join(',');
    if (kind === 'read') stmts[key] = db.prepare('SELECT ' + list + ' FROM ' + t + ' ORDER BY _id');
    else if (kind === 'del') stmts[key] = db.prepare('DELETE FROM ' + t);
    else if (kind === 'ins') stmts[key] = db.prepare('INSERT INTO ' + t + ' (' + list + ') VALUES (' + cols.map(() => '?').join(',') + ')');
    return stmts[key];
  }
  function schemaOf(name) { const s = ctx.SCHEMA[name]; if (!s) throw new Error('Unknown table ' + name); return s; }
  function toDb(v, t) {
    const x = ctx.store_cell_(v, t);
    return (t === 'n' && x === '') ? null : x;
  }
  const insertRows = db.transaction((name, rows, replace) => {
    const cols = schemaOf(name);
    if (replace) st('del', name).run();
    const ins = st('ins', name);
    for (let i = 0; i < rows.length; i++) { const o = rows[i]; ins.run(cols.map((c) => toDb(o[c[0]], c[1]))); }
  });
  function nextVersion() { lastVersion = Math.max(Date.now(), lastVersion + 1); return String(lastVersion); }

  sandbox.store_read = (name) => {
    const cols = schemaOf(name), rows = st('read', name).all();
    for (let c = 0; c < cols.length; c++) {
      if (cols[c][1] !== 'n') continue;
      const k = cols[c][0];
      for (let i = 0; i < rows.length; i++) if (rows[i][k] === null) rows[i][k] = '';
    }
    return rows;
  };
  sandbox.store_write = (name, rows) => { insertRows(name, rows, true); sandbox.store_bump(name); };
  sandbox.store_append = (name, rows) => { if (!rows.length) return; insertRows(name, rows, false); sandbox.store_bump(name); };
  sandbox.store_version = (name) => { const r = db.prepare('SELECT version FROM table_versions WHERE name = ?').get(name); return r ? r.version : '0'; };
  sandbox.store_bump = (name) => { db.prepare('INSERT OR REPLACE INTO table_versions (name, version) VALUES (?, ?)').run(name, nextVersion()); };

  /* ---------- load the core ---------- */
  CORE_FILES.forEach((f) => vm.runInContext(fs.readFileSync(path.join(CORE_DIR, f), 'utf8'), ctx, { filename: 'core/' + f }));
  migrate();

  /* ---------- helpers ---------- */
  const plain = (x) => (x === undefined ? null : JSON.parse(JSON.stringify(x)));
  function run(fn, isWrite) {
    if (!isWrite) { pending = []; return fn(); }
    db.exec('BEGIN IMMEDIATE');
    pending = [];
    let res;
    try {
      res = fn();
      if (res && res.ok) db.exec('COMMIT'); else db.exec('ROLLBACK');
    } catch (e) { if (db.inTransaction) db.exec('ROLLBACK'); pending = []; throw e; }
    if (res && res.ok && pending.length) { const list = pending; pending = []; setImmediate(() => events.emit('events', list)); }
    pending = [];
    return res;
  }
  function call(token, action, payload) {
    return plain(run(() => ctx.api(token, action, payload === undefined ? {} : payload), ctx.api_isWrite(action)));
  }
  function callAs(principal, action, payload) {
    return plain(run(() => ctx.api_asService(principal, action, payload === undefined ? {} : payload), ctx.api_isWrite(action)));
  }
  /** Run a function inside one transaction (for connectors): the function returns {ok:true,...} or {ok:false,error}. */
  function transaction(fn) { return plain(run(fn, true)); }
  function exec(code) { return plain(vm.runInContext(code, ctx)); }

  function setupCode() { return port.props.getProperty('SETUP_CODE'); }
  function ensureInitialized({ adminEmail, adminName, adminPassword } = {}) {
    run(() => {
      if (ctx.store_read('Settings').length === 0) ctx.store_write('Settings', ctx.default_settings_());
      if (ctx.store_read('Users').length === 0 && !port.props.getProperty('SETUP_CODE')) port.props.setProperty('SETUP_CODE', crypto.randomBytes(5).toString('hex').toUpperCase());
      return { ok: true };
    }, true);
    if (adminEmail && adminPassword && ctx.store_read('Users').length === 0) {
      const r = run(() => { try { ctx.auth_register({ email: adminEmail, name: adminName || 'Administrator', password: adminPassword, code: setupCode() }); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } }, true);
      if (!r.ok) throw new Error('Could not create the initial administrator: ' + r.error);
      logger.info && logger.info('initial administrator created: ' + adminEmail);
    }
  }
  function maintenance() {
    run(() => {
      for (const [t, keep] of [['t_AuditLog', 50000], ['t_IntegrationRuns', 5000]]) {
        db.prepare('DELETE FROM ' + t + ' WHERE _id <= (SELECT COALESCE(MAX(_id), 0) - ? FROM ' + t + ')').run(keep);
      }
      cdb.prepare('DELETE FROM cache WHERE exp < ?').run(Date.now());
      return { ok: true };
    }, true);
  }
  function backup(file) { fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true }); return db.backup(file); }
  function close() { try { cdb.close(); } catch (e) { /* */ } db.close(); }

  return { ctx, db, call, callAs, transaction, exec, events, ensureInitialized, setupCode, maintenance, backup, close, port,
           read: (n) => plain(sandbox.store_read(n)), kv: (n) => plain(ctx.store_kv(n)), keyPrincipal: (k) => plain(ctx.api_keyPrincipal(k)), today: port.today };
}
module.exports = { createRuntime };
