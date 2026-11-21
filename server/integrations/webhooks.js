'use strict';
const crypto = require('crypto');

/** Sends events (campaign.confirmed, batch.*) to the URL in Settings, signed with HMAC-SHA256 (header X-BR-Signature: sha256=<hex>). */
function sign(secret, body) { return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex'); }

function startWebhooks(rt, log, fetchImpl = fetch) {
  async function deliver(url, secret, evt) {
    const body = JSON.stringify({ id: crypto.randomUUID(), type: evt.type, time: new Date().toISOString(), data: evt.data });
    const headers = { 'content-type': 'application/json', 'user-agent': 'batch-readiness/2', 'x-br-event': evt.type };
    if (secret) headers['x-br-signature'] = sign(secret, body);
    const delays = [0, 2000, 10000, 60000];
    let last = '';
    for (let i = 0; i < delays.length; i++) {
      if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
      try {
        const res = await fetchImpl(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) });
        if (res.ok) return true;
        last = 'HTTP ' + res.status;
        if (res.status >= 400 && res.status < 500 && res.status !== 429) break;   // permanent: do not retry
      } catch (e) { last = e.message; }
    }
    log.error && log.error('webhook failed (' + evt.type + '): ' + last);
    try { rt.transaction(() => { rt.ctx.integration_log('webhook', '', 'failed', '', evt.type + ': ' + last); return { ok: true }; }); } catch (e) { /* */ }
    return false;
  }
  rt.events.on('events', (list) => {
    let s; try { s = rt.kv('Settings'); } catch (e) { return; }
    const url = String(s.webhookUrl || '').trim();
    if (!/^https?:\/\//i.test(url)) return;
    const only = String(s.webhookEvents || '').split(',').map((x) => x.trim()).filter(Boolean);
    list.filter((e) => !only.length || only.includes(e.type)).forEach((e) => { deliver(url, String(s.webhookSecret || ''), e).catch(() => {}); });
  });
}
module.exports = { startWebhooks, sign };
