'use strict';
const path = require('path');
const loadConfig = require('../server/config');
const { createRuntime } = require('../server/runtime');
const cfg = loadConfig();
const rt = createRuntime({ dbFile: cfg.dbFile, timezone: cfg.timezone });
const file = process.argv[2] || path.join(cfg.backupDir, 'manual-' + new Date().toISOString().replace(/[:.]/g, '-') + '.db');
rt.backup(file).then(() => { console.log('Backup written: ' + file); rt.close(); }).catch((e) => { console.error(e.message); process.exit(1); });
