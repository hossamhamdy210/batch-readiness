'use strict';
/* Deletes the database (all data, users and API keys). Use before handing a copy to somebody or to start from zero. Requires --yes. */
const fs = require('fs');
const loadConfig = require('../server/config');
const cfg = loadConfig();
if (!process.argv.includes('--yes')) { console.log('This deletes ALL data in ' + cfg.dbFile + '.\nRun again with --yes to confirm (make a backup first: npm run backup).'); process.exit(1); }
['', '-wal', '-shm', '-cache', '-cache-wal', '-cache-shm'].forEach((x) => { try { fs.unlinkSync(cfg.dbFile + x); } catch (e) { /* not there */ } });
console.log('Database removed. The next start creates an empty installation with a new setup code.');
