'use strict';
const fs = require('fs');
const path = require('path');
const loadConfig = require('./config');
const { createRuntime } = require('./runtime');
const { createApp } = require('./app');

const cfg = loadConfig();
const log = { info: (...a) => console.log(new Date().toISOString(), ...a), error: (...a) => console.error(new Date().toISOString(), ...a) };
fs.mkdirSync(cfg.dataDir, { recursive: true });

const rt = createRuntime({ dbFile: cfg.dbFile, timezone: cfg.timezone, logger: log });
rt.ensureInitialized({ adminEmail: cfg.adminEmail, adminName: cfg.adminName, adminPassword: cfg.adminPassword });
if (!cfg.adminEmail) { const code = rt.setupCode(); if (code) log.info('First start: open the web page and register the administrator with setup code ' + code + ' (also: npm run setup-code)'); }

const app = createApp(rt, { trustProxy: cfg.trustProxy, logger: log });
const timers = [];
try {
  const { startIntegrations } = require('./integrations/scheduler');
  const stop = startIntegrations(rt, app, cfg, log); if (stop) timers.push(stop);
  const { startWebhooks } = require('./integrations/webhooks');
  startWebhooks(rt, log);
} catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }

function doBackup() {
  try {
    const f = path.join(cfg.backupDir, 'batchreadiness-' + new Date().toISOString().replace(/[:.]/g, '-') + '.db');
    rt.backup(f).then(() => {
      const files = fs.readdirSync(cfg.backupDir).filter((x) => x.endsWith('.db')).sort();
      files.slice(0, Math.max(0, files.length - cfg.backupKeep)).forEach((x) => fs.unlinkSync(path.join(cfg.backupDir, x)));
      log.info('backup written: ' + f);
    }).catch((e) => log.error('backup failed', e));
  } catch (e) { log.error('backup failed', e); }
}
timers.push(setInterval(() => rt.maintenance(), 6 * 3600 * 1000));
timers.push(setInterval(doBackup, 24 * 3600 * 1000));
timers.forEach((t) => t.unref && t.unref());
rt.maintenance();

const server = app.listen(cfg.port, cfg.host, () => log.info('Batch Readiness listening on http://' + cfg.host + ':' + cfg.port));
function shutdown() { log.info('shutting down'); server.close(() => { try { rt.close(); } catch (e) { /* */ } process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
