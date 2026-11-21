'use strict';
const express = require('express');
const path = require('path');
const mapping = require('./integrations/mapping');

/** Tiny fixed-window rate limiter (per key, in memory). */
function limiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (v.reset < n) hits.delete(k); }, windowMs).unref();
  return (key) => {
    const n = Date.now(); let h = hits.get(key);
    if (!h || h.reset < n) { h = { count: 0, reset: n + windowMs }; hits.set(key, h); }
    return ++h.count <= max;
  };
}

function httpStatusFor(err) {
  if (/expired|sign in|not signed/i.test(err)) return 401;
  if (/not allowed/i.test(err)) return 403;
  if (/Unknown action/i.test(err)) return 404;
  return 400;
}

function createApp(rt, opts = {}) {
  const app = express();
  const webDir = opts.webDir || path.join(__dirname, '..', 'web');
  if (opts.trustProxy) app.set('trust proxy', opts.trustProxy);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'Cache-Control': 'no-store'
    });
    next();
  });

  const rpcLimit = limiter(opts.rpcPerMinute || 600, 60000);
  const authLimit = limiter(opts.authPerMinute || 30, 60000);
  const intLimit = limiter(opts.integrationPerMinute || 120, 60000);

  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.get('/readyz', (req, res) => { try { rt.db.prepare('SELECT 1').get(); res.json({ ok: true, time: new Date().toISOString() }); } catch (e) { res.status(503).json({ ok: false }); } });

  /* ---------- browser API ---------- */
  app.post('/api/v1/rpc', express.json({ limit: opts.rpcLimit || '25mb' }), (req, res) => {
    const { action, payload } = req.body || {};
    if (typeof action !== 'string') return res.status(400).json({ ok: false, error: 'Missing action.' });
    const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
    const token = m ? m[1] : null;
    if (!rpcLimit(req.ip)) return res.status(429).json({ ok: false, error: 'Too many requests.' });
    if (action === 'login' || action === 'register') if (!authLimit(req.ip)) return res.status(429).json({ ok: false, error: 'Too many sign-in attempts. Wait a minute.' });
    let out;
    try { out = rt.call(token, action, payload); } catch (e) { opts.logger && opts.logger.error && opts.logger.error(e); return res.status(500).json({ ok: false, error: 'Server error.' }); }
    if (out && out.ok === false) return res.status(httpStatusFor(String(out.error || ''))).json(out);
    res.json(out);
  });

  /* ---------- machine API (API keys) ---------- */
  const lastTouch = new Map();
  function keyAuth(minRole) {
    return (req, res, next) => {
      const m = /^Bearer (brk_.+)$/.exec(req.get('authorization') || '');
      if (!m) return res.status(401).json({ ok: false, error: 'API key required (Authorization: Bearer brk_...).' });
      if (!intLimit(req.ip)) return res.status(429).json({ ok: false, error: 'Too many requests.' });
      let p; try { p = rt.keyPrincipal(m[1]); } catch (e) { return res.status(500).json({ ok: false, error: 'Server error.' }); }
      if (!p) return res.status(401).json({ ok: false, error: 'Invalid or revoked API key.' });
      if (minRole === 'editor' && p.role !== 'editor') return res.status(403).json({ ok: false, error: 'This key is read-only.' });
      const n = Date.now();
      if (!lastTouch.has(p.keyId) || n - lastTouch.get(p.keyId) > 60000) { lastTouch.set(p.keyId, n); try { rt.transaction(() => { rt.ctx.api_touchKey(p.keyId); return { ok: true }; }); } catch (e) { /* non-critical */ } }
      req.principal = p; next();
    };
  }
  const big = express.json({ limit: opts.integrationLimit || '100mb' });
  const text = express.text({ type: ['text/csv', 'text/plain'], limit: opts.integrationLimit || '100mb' });

  /** Shared by the HTTP routes and the connectors. Returns {ok, imported[], skipped, warnings, unmapped}. */
  function ingest(principal, dataset, records, o = {}) {
    const def = mapping.DATASETS[dataset];
    if (!def) return { ok: false, error: 'Unknown dataset.' };
    const mapped = mapping.mapRecords(dataset, records, { extraAliases: o.extraAliases });
    const source = o.source || 'api';
    if (!mapped.rows.length && !o.allowEmpty) {
      const msg = records.length ? 'No usable rows (' + mapped.skipped + ' skipped); existing data was left untouched.' : 'Empty file; existing data was left untouched (send allowEmpty=true to clear).';
      rt.transaction(() => { rt.ctx.integration_log(source, o.site || '', 'rejected', 0, msg); return { ok: true }; });
      return { ok: false, error: msg, skipped: mapped.skipped, warnings: mapped.warnings, unmapped: mapped.unmapped };
    }
    if (!o.dryRun && o.maxSkippedShare !== undefined && records.length && mapped.skipped / records.length > o.maxSkippedShare) {
      const msg = mapped.skipped + ' of ' + records.length + ' rows unusable; nothing imported.';
      rt.transaction(() => { rt.ctx.integration_log(source, o.site || '', 'rejected', 0, msg); return { ok: true }; });
      return { ok: false, error: msg, skipped: mapped.skipped, warnings: mapped.warnings, unmapped: mapped.unmapped };
    }
    // group by site for per-site tables
    const groups = new Map();
    if (def.perSite) {
      mapped.rows.forEach((r) => { const s = r.site || o.site || ''; if (!groups.has(s)) groups.set(s, []); groups.get(s).push(r); });
      if (!mapped.rows.length && o.site) groups.set(o.site, []);
    } else groups.set('', mapped.rows);
    if (def.perSite && groups.has('')) return { ok: false, error: 'Rows have no site/plant. Provide ?site=<id> or a plant column.', warnings: mapped.warnings };
    if (o.dryRun) return { ok: true, dryRun: true, wouldImport: mapped.rows.length, sites: [...groups.keys()].filter(Boolean), skipped: mapped.skipped, warnings: mapped.warnings, unmapped: mapped.unmapped };
    const imported = [];
    const r = rt.transaction(() => {
      for (const [site, rows] of groups) {
        let res;
        try { res = rt.ctx.api_replaceImport(principal, def.table, site, rows); } catch (e) { return { ok: false, error: String(e.message || e) }; }
        if (!res || res.ok === false) return { ok: false, error: (res && res.error) || 'Import failed.' };
        imported.push({ site, rows: rows.length });
        rt.ctx.integration_log(source, site, 'ok', rows.length, mapped.skipped ? mapped.skipped + ' rows skipped' : '');
      }
      return { ok: true };
    });
    if (!r.ok) { try { rt.transaction(() => { rt.ctx.integration_log(source, o.site || '', 'failed', 0, r.error); return { ok: true }; }); } catch (e) { /* */ } return { ok: false, error: r.error }; }
    return { ok: true, imported, skipped: mapped.skipped, warnings: mapped.warnings, unmapped: mapped.unmapped };
  }

  function recordsFromReq(req) {
    if (Array.isArray(req.body)) return req.body;
    if (req.body && Array.isArray(req.body.rows)) return req.body.rows;
    if (typeof req.body === 'string') return mapping.csvToRecords(req.body, req.query.delimiter);
    return null;
  }
  const truthy = (v) => v === true || v === 'true' || v === '1';

  ['stock', 'documents', 'equipment', 'bio'].forEach((dataset) => {
    app.put('/integration/v1/' + dataset, keyAuth('editor'), big, text, (req, res) => {
      let records; try { records = recordsFromReq(req); } catch (e) { return res.status(400).json({ ok: false, error: 'Could not read the body: ' + e.message }); }
      if (!records) return res.status(400).json({ ok: false, error: 'Send JSON (an array or {rows:[...]}) or text/csv.' });
      const body = (req.body && !Array.isArray(req.body) && typeof req.body === 'object') ? req.body : {};
      const out = ingest(req.principal, dataset, records, {
        site: req.query.site || body.site || '', source: 'api:' + req.principal.name,
        allowEmpty: truthy(req.query.allowEmpty || body.allowEmpty), dryRun: truthy(req.query.dryRun || body.dryRun)
      });
      res.status(out.ok ? 200 : 422).json(out);
    });
  });

  app.put('/integration/v1/master/:table', keyAuth('editor'), big, (req, res) => {
    const rows = Array.isArray(req.body) ? req.body : (req.body && req.body.rows);
    if (!Array.isArray(rows)) return res.status(400).json({ ok: false, error: 'Send an array or {rows:[...]}.' });
    const out = rt.callAs(req.principal, 'syncTable', { table: req.params.table, rows });
    res.status(out.ok ? 200 : 422).json(out);
  });

  app.get('/integration/v1/readiness', keyAuth('viewer'), (req, res) => {
    const q = req.query;
    const payload = { product: q.product, site: q.site, n: q.batches === undefined ? undefined : Number(q.batches), from: q.from || q.startDate, to: q.to || q.from || q.startDate, step: q.step };
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
    const out = rt.callAs(req.principal, 'calc', payload);
    res.status(out.ok ? 200 : 422).json(out);
  });

  app.get('/integration/v1/runs', keyAuth('viewer'), (req, res) => res.json(rt.callAs(req.principal, 'integrationRuns', {})));

  /* ---------- static web client ---------- */
  app.use(express.static(webDir, { index: 'index.html', maxAge: 0, etag: true, setHeaders: (r) => r.set('Cache-Control', 'no-cache') }));
  const xlsx = path.join(__dirname, '..', 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js');
  app.get('/vendor/xlsx.js', (req, res) => res.sendFile(xlsx, { headers: { 'Cache-Control': 'public, max-age=86400' } }));

  app.use((err, req, res, next) => {   // body-parser errors etc.
    if (err && err.type === 'entity.too.large') return res.status(413).json({ ok: false, error: 'Payload too large.' });
    if (err && err.status && err.status < 500) return res.status(err.status).json({ ok: false, error: 'Bad request.' });
    opts.logger && opts.logger.error && opts.logger.error(err);
    res.status(500).json({ ok: false, error: 'Server error.' });
  });

  app.locals.ingest = ingest;
  return app;
}
module.exports = { createApp };
