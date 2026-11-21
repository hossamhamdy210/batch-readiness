'use strict';
const fs = require('fs');
const path = require('path');
const mapping = require('./mapping');

/** Folder drop: stock_<SITE>.csv, documents.csv, equipment.csv, bio_<SITE>.csv (.csv, ; , tab or | delimited). Processed files move to processed/, rejected ones to failed/ with a .error.txt. */
const PATTERNS = [
  [/^stock_(.+)\.csv$/i, 'stock', true], [/^documents(?:_.*)?\.csv$/i, 'documents', false],
  [/^equipment(?:_.*)?\.csv$/i, 'equipment', false], [/^bio_(.+)\.csv$/i, 'bio', true]
];
function runFileDrop(cfg, ingest, { principal, now = Date.now(), minAgeMs = 3000, log } = {}) {
  const dir = path.resolve(cfg.dir);
  fs.mkdirSync(path.join(dir, 'processed'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'failed'), { recursive: true });
  const results = [];
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    let st; try { st = fs.statSync(full); } catch (e) { continue; }
    if (!st.isFile()) continue;
    const hit = PATTERNS.map(([re, ds, ps]) => [re.exec(f), ds, ps]).find((x) => x[0]);
    if (!hit) continue;
    if (now - st.mtimeMs < minAgeMs) continue;   // still being written
    const [m, dataset, perSite] = hit;
    const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
    let out;
    try {
      const records = mapping.csvToRecords(fs.readFileSync(full, 'utf8'));
      out = ingest(principal, dataset, records, { source: 'filedrop:' + f, site: perSite ? m[1] : '', maxSkippedShare: cfg.maxSkippedShare === undefined ? 0.2 : cfg.maxSkippedShare, allowEmpty: false });
    } catch (e) { out = { ok: false, error: e.message }; }
    const target = path.join(dir, out.ok ? 'processed' : 'failed', stamp + '_' + f);
    fs.renameSync(full, target);
    if (!out.ok) fs.writeFileSync(target + '.error.txt', String(out.error) + '\n' + (out.warnings || []).join('\n') + '\n');
    log && log.info && log.info('file drop ' + f + ': ' + (out.ok ? 'imported' : 'rejected - ' + out.error));
    results.push({ file: f, ok: out.ok, error: out.error });
  }
  return results;
}
module.exports = { runFileDrop };
