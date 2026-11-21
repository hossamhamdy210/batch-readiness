'use strict';
const fs = require('fs');
const { runSapStock } = require('./sapOData');
const { runFileDrop } = require('./fileDrop');

/** Reads config/integrations.json (optional) and runs the configured connectors on their interval. Returns a stop function. */
function startIntegrations(rt, app, cfg, log) {
  if (!fs.existsSync(cfg.integrationsFile)) return null;
  let conf; try { conf = JSON.parse(fs.readFileSync(cfg.integrationsFile, 'utf8')); } catch (e) { log.error('integrations.json is not valid JSON: ' + e.message); return null; }
  const principal = { email: 'connector', name: 'connector', role: 'editor' };
  const ingest = app.locals.ingest;
  const timers = [];
  const failed = (name, e) => { log.error('connector ' + name + ' failed: ' + e.message); try { rt.transaction(() => { rt.ctx.integration_log(name, '', 'failed', 0, e.message); return { ok: true }; }); } catch (x) { /* */ } };
  (conf.sapOData || []).filter((c) => c.enabled !== false).forEach((c) => {
    let busy = false;
    const tick = async () => { if (busy) return; busy = true; try { const r = await runSapStock(c, ingest, { principal }); log.info('sap-odata ' + c.name + ': ' + (r.ok ? 'ok ' + JSON.stringify(r.imported) : r.error)); } catch (e) { failed('sap-odata:' + c.name, e); } finally { busy = false; } };
    timers.push(setInterval(tick, Math.max(1, c.everyMinutes || 60) * 60000)); setTimeout(tick, 5000).unref();
  });
  (conf.fileDrop || []).filter((c) => c.enabled !== false).forEach((c) => {
    const tick = () => { try { runFileDrop(c, ingest, { principal, log }); } catch (e) { failed('filedrop', e); } };
    timers.push(setInterval(tick, Math.max(1, c.everySeconds || 60) * 1000)); setTimeout(tick, 3000).unref();
  });
  timers.forEach((t) => t.unref());
  log.info('integrations started: ' + (conf.sapOData || []).length + ' OData, ' + (conf.fileDrop || []).length + ' folder');
  return () => timers.forEach(clearInterval);
}
module.exports = { startIntegrations };
