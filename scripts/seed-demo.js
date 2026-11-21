'use strict';
/* Usage: npm run seed-demo   (OPTIONAL - only for a public demo copy. A real installation never runs this.)
   Fills an installation with invented data and creates a read-only visitor account. */
const fs = require('fs');
const path = require('path');
const loadConfig = require('../server/config');
const { createRuntime } = require('../server/runtime');

function seed(rt, { visitor = true } = {}) {
  rt.exec(fs.readFileSync(path.join(__dirname, '..', 'demo', 'demo-data.js'), 'utf8'));
  const names = ['Settings', 'Sites', 'Steps', 'StorageTypes', 'Products', 'Requirements', 'Recipes', 'ErpStock', 'Documents', 'Equipment', 'Holds', 'Bio'];
  const out = rt.transaction(() => {
    const data = rt.ctx.demo_tables(rt.today());
    names.forEach((n) => rt.ctx.store_write(n, data[n]));
    const now = new Date().toISOString();
    ['stock:SITE-A', 'stock:SITE-B', 'documents', 'equipment', 'bio'].forEach((k) => rt.ctx.store_setKv('Meta', k, now));
    if (visitor) {
      const email = 'visitor@demo.invalid', pw = 'Demo-Visitor-2026', salt = rt.ctx.auth_salt();
      const users = rt.ctx.store_read('Users').filter((u) => u.email !== email);
      users.push({ email, name: 'Demo visitor', role: 'viewer', status: 'active', salt, hash: rt.ctx.auth_hash(pw, salt), created: new Date().toISOString(), lastLogin: '' });
      rt.ctx.store_write('Users', users);
    }
    return { ok: true };
  });
  if (!out.ok) throw new Error('seed failed');
}
module.exports = { seed };
if (require.main === module) {
  const cfg = loadConfig();
  const rt = createRuntime({ dbFile: cfg.dbFile, timezone: cfg.timezone });
  seed(rt);
  console.log('Demo data loaded. Read-only visitor: visitor@demo.invalid / Demo-Visitor-2026');
  rt.close();
}
