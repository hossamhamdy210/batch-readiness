'use strict';
const loadConfig = require('../server/config');
const { createRuntime } = require('../server/runtime');
const cfg = loadConfig();
const rt = createRuntime({ dbFile: cfg.dbFile, timezone: cfg.timezone });
const code = rt.setupCode();
console.log(code ? 'Setup code: ' + code : 'The first administrator already exists; no setup code is active.');
rt.close();
