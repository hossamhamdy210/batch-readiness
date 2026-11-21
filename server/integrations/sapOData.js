'use strict';
/**
 * SAP OData V2 connector (pull). Reads stock per plant from an OData service (default: API_MATERIAL_STOCK_SRV / A_MatlStkInAcctMod),
 * maps rows with the shared mapping module and replaces the stock of the mapped sites in ONE transaction.
 * Credentials are read from environment variables named in the config; they never live in the config file.
 * NOTE: validated against a mock OData server only, not against a real SAP system.
 */
const SPECIAL_STOCK_FIELD = 'InventorySpecialStockType';

function makeAuth(cfg, env, fetchImpl) {
  const a = cfg.auth || { type: 'none' };
  let cached = null;
  return async function header() {
    if (a.type === 'basic') return { authorization: 'Basic ' + Buffer.from((env[a.userEnv] || '') + ':' + (env[a.passwordEnv] || '')).toString('base64') };
    if (a.type === 'bearer') return { authorization: 'Bearer ' + (env[a.tokenEnv] || '') };
    if (a.type === 'oauth-client-credentials') {
      if (!cached || cached.exp < Date.now() + 30000) {
        const body = new URLSearchParams({ grant_type: 'client_credentials' });
        const basic = Buffer.from((env[a.clientIdEnv] || '') + ':' + (env[a.clientSecretEnv] || '')).toString('base64');
        const r = await fetchImpl(a.tokenUrl, { method: 'POST', headers: { authorization: 'Basic ' + basic, 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(20000) });
        if (!r.ok) throw new Error('OAuth token request failed: HTTP ' + r.status);
        const j = await r.json();
        cached = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 300) * 1000 };
      }
      return { authorization: 'Bearer ' + cached.token };
    }
    return {};
  };
}

async function fetchAll(url, headers, fetchImpl, maxRows) {
  const out = []; let next = url, pages = 0;
  while (next) {
    if (++pages > 1000) throw new Error('Too many pages.');
    const r = await fetchImpl(next, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error('SAP responded HTTP ' + r.status + ' for ' + next.split('?')[0]);
    const j = await r.json();
    const d = j.d || j;
    const rows = d.results || d.value || [];
    out.push(...rows);
    if (out.length > maxRows) throw new Error('More than ' + maxRows + ' rows returned; narrow the plant/storage location filter.');
    next = d.__next || j['@odata.nextLink'] || '';
    if (next && !/^https?:/i.test(next)) next = new URL(next, url).toString();
  }
  return out;
}

/** cfg: {name, baseUrl, entity, auth, plants:{"1000":"SITE1"}, storageLocations:[], pageSize, fieldMap:{canonical:"SourceField"}, includeSpecialStock, maxRows} */
async function runSapStock(cfg, ingest, { env = process.env, fetchImpl = fetch, principal } = {}) {
  if (!cfg.plants || !Object.keys(cfg.plants).length) throw new Error('plants map is required (SAP plant -> site id).');
  const header = makeAuth(cfg, env, fetchImpl);
  const h = await header();
  const all = [];
  for (const plant of Object.keys(cfg.plants)) {
    let filter = "Plant eq '" + String(plant).replace(/'/g, "''") + "'";
    if (cfg.storageLocations && cfg.storageLocations.length) filter += ' and (' + cfg.storageLocations.map((s) => "StorageLocation eq '" + String(s).replace(/'/g, "''") + "'").join(' or ') + ')';
    const url = cfg.baseUrl.replace(/\/$/, '') + '/' + (cfg.entity || 'A_MatlStkInAcctMod') + '?$format=json&$top=' + (cfg.pageSize || 1000) + '&$filter=' + encodeURIComponent(filter);
    const rows = await fetchAll(url, h, fetchImpl, cfg.maxRows || 250000);
    rows.forEach((r) => { r.Plant = cfg.plants[plant]; all.push(r); });   // all plants fetched before anything is written
  }
  const records = cfg.includeSpecialStock ? all : all.filter((r) => !String(r[SPECIAL_STOCK_FIELD] || '').trim());
  const extra = {}; Object.entries(cfg.fieldMap || {}).forEach(([canon, src]) => { extra[canon] = [src]; });
  const sites = Object.values(cfg.plants);
  return ingest(principal, 'stock', records, { source: 'sap-odata:' + (cfg.name || 'stock'), extraAliases: extra, allowEmpty: !!cfg.allowEmpty, maxSkippedShare: cfg.maxSkippedShare === undefined ? 0.2 : cfg.maxSkippedShare, site: sites.length === 1 ? sites[0] : '' });
}
module.exports = { runSapStock, fetchAll };
