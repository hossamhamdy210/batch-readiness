/* ============================== helpers ============================== */
var S = { token: null, user: null, init: null, view: 'planner', plan: null, params: null, sub: {} };
var $ = function (sel, root) { return (root || document).querySelector(sel); };
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function store(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { /* storage may be blocked */ } return null; }
function lstore(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* ignore */ } return null; }
var ROLE_RANK = { viewer: 1, planner: 2, editor: 3, admin: 4 };
function can(role) { return S.user && ROLE_RANK[S.user.role] >= ROLE_RANK[role]; }

async function call(action, payload) {
  var res, body;
  try {
    res = await fetch('/api/v1/rpc', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, S.token ? { authorization: 'Bearer ' + S.token } : {}), body: JSON.stringify({ action: action, payload: payload || {} }) });
    body = await res.json();
  } catch (e) { throw new Error('The server could not be reached. Check the connection and try again.'); }
  if (body && body.ok) return body.data;
  var msg = (body && body.error) || ('Server error (HTTP ' + res.status + ').');
  if (res.status === 401 && /expired|sign in/i.test(msg) && S.token) sessionLost();
  throw new Error(msg);
}
function sessionLost() { S.token = null; store('tok', null); renderLogin('Your session expired. Please sign in again.'); }

function toast(msg, err) {
  var t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  t.style.bottom = (16 + document.querySelectorAll('.toast').length * 52) + 'px';
  document.body.appendChild(t); setTimeout(function () { t.remove(); }, err ? 6000 : 3000);
}
function busy(btn, on) { if (!btn) return; btn.disabled = on; if (on) { btn.dataset.t = btn.innerHTML; btn.innerHTML = '<span class="spin"></span> ' + btn.dataset.t; } else if (btn.dataset.t) btn.innerHTML = btn.dataset.t; }
async function run(btn, fn) { busy(btn, true); try { return await fn(); } catch (e) { toast(e.message, true); } finally { busy(btn, false); } }

function modal(title, bodyHtml, buttons, opts) {
  var bg = document.createElement('div'); bg.className = 'modalbg';
  bg.innerHTML = '<div class="modal" style="' + ((opts && opts.width) ? 'max-width:' + opts.width : '') + '"><div class="head"><h2>' + esc(title) + '</h2><button class="btn ghost sm" data-x>Close</button></div><div class="body">' + bodyHtml + '</div><div class="foot"></div></div>';
  document.body.appendChild(bg);
  function close() { bg.remove(); }
  bg.querySelector('[data-x]').onclick = close;
  bg.addEventListener('mousedown', function (e) { if (e.target === bg) close(); });
  var foot = bg.querySelector('.foot');
  (buttons || []).forEach(function (b) {
    var el = document.createElement('button'); el.className = 'btn ' + (b.cls || ''); el.textContent = b.label;
    el.onclick = function () { b.fn(bg, close, el); }; foot.appendChild(el);
  });
  return { el: bg, close: close };
}

function pillClass(s) {
  s = String(s || '');
  if (s === 'OK' || s === 'READY' || s === 'Effective' || s === 'OUTPUT') return 'p-good';
  if (s === 'PREPARE' || s === 'TRANSFER') return 'p-info';
  if (s === 'NO REQUIREMENTS') return 'p-gray';
  return 'p-bad';
}
function pill(s, label) { return '<span class="pill ' + pillClass(s) + '">' + esc(label || s) + '</span>'; }
function num(v) { if (v === '' || v == null) return ''; var n = Number(v); return isFinite(n) ? String(Math.round(n * 1000) / 1000) : esc(v); }
function opt(list, sel, blank) {
  return (blank ? '<option value=""></option>' : '') + list.map(function (x) {
    var v = typeof x === 'object' ? x.v : x, l = typeof x === 'object' ? x.l : x;
    return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(l) + '</option>';
  }).join('');
}
function siteName(id) { var s = (S.init.sites || []).filter(function (x) { return x.id === id; })[0]; return s ? (s.name || s.id) : id; }
function siteOpts(sel) { return opt((S.init.sites || []).filter(function (s) { return String(s.active || 'Y').toUpperCase() !== 'N'; }).map(function (s) { return { v: s.id, l: s.name || s.id }; }), sel); }
function table(cols, rows, o) {
  o = o || {};
  var h = '<div class="tablewrap"' + (o.maxh ? ' style="max-height:' + o.maxh + 'px"' : '') + '><table><thead><tr>' + cols.map(function (c) { return '<th class="' + (c.num ? 'num' : '') + '">' + esc(c.h) + '</th>'; }).join('') + '</tr></thead><tbody>';
  if (!rows.length) h += '<tr><td colspan="' + cols.length + '" class="muted">' + esc(o.empty || 'Nothing to show.') + '</td></tr>';
  rows.forEach(function (r, i) {
    h += '<tr' + (o.click ? ' class="click" data-i="' + i + '"' : '') + '>' + cols.map(function (c) {
      var v = c.f ? c.f(r, i) : esc(r[c.k]);
      return '<td class="' + (c.num ? 'num' : '') + (c.nw ? ' nowrap' : '') + '">' + v + '</td>';
    }).join('') + '</tr>';
  });
  return h + '</tbody></table></div>';
}
function today() { return S.init ? S.init.today : new Date().toISOString().slice(0, 10); }
function addDays(iso, n) { var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function fmtTs(s) { return s ? String(s).replace('T', ' ').slice(0, 16) : '-'; }

/* ============================== login ============================== */
async function boot() {
  S.token = store('tok');
  if (S.token) {
    try { S.init = await call('init'); S.user = S.init.user; restoreView(); return renderShell(); } catch (e) { S.token = null; store('tok', null); }
  }
  renderLogin();
}

async function renderLogin(msg) {
  var st = { needsSetup: false, registrationOpen: true, appName: 'Batch Readiness' };
  try { st = await call('authState'); } catch (e) { msg = msg || e.message; }
  var mode = st.needsSetup ? 'register' : 'login';
  function draw() {
    $('#app').innerHTML = '<div class="login"><div class="card"><h1 style="color:var(--brand);margin-bottom:4px">' + esc(st.appName) + '</h1>' +
      '<p class="muted" style="margin:0 0 14px">Readiness check for production campaigns</p>' +
      (msg ? '<div class="banner err">' + esc(msg) + '</div>' : '') +
      (st.needsSetup ? '<div class="hint">First start: create the administrator account. You need the setup code from the Apps Script log (run <b>showSetupCode</b>).</div>' : '') +
      (st.needsSetup ? '' : '<div class="tabs"><button data-m="login" class="' + (mode === 'login' ? 'on' : '') + '">Sign in</button>' + (st.registrationOpen ? '<button data-m="register" class="' + (mode === 'register' ? 'on' : '') + '">Register</button>' : '') + '</div>') +
      '<form class="stack" id="lf">' +
      (mode === 'register' ? '<label class="f">Name<input name="name" autocomplete="name" required></label>' : '') +
      '<label class="f">E-mail<input name="email" type="email" autocomplete="username" required></label>' +
      '<label class="f">Password' + (mode === 'register' ? ' (at least 10 characters)' : '') + '<input name="password" type="password" autocomplete="' + (mode === 'register' ? 'new-password' : 'current-password') + '" required></label>' +
      (mode === 'register' && (st.needsSetup || st.needsInvite) ? '<label class="f">' + (st.needsSetup ? 'Setup code' : 'Invite code') + '<input name="code" required></label>' : '') +
      '<button class="btn" type="submit">' + (mode === 'login' ? 'Sign in' : 'Create account') + '</button></form>' +
      (mode === 'register' && !st.needsSetup ? '<p class="small muted">New accounts must be approved by an administrator before you can sign in.</p>' : '') +
      '</div></div>';
    document.querySelectorAll('.tabs button').forEach(function (b) { b.onclick = function () { mode = b.dataset.m; msg = ''; draw(); }; });
    $('#lf').onsubmit = async function (ev) {
      ev.preventDefault();
      var f = new FormData(ev.target), p = {}; f.forEach(function (v, k) { p[k] = v; });
      var btn = $('#lf button[type=submit]');
      busy(btn, true);
      try {
        if (mode === 'register') {
          var r = await call('register', p);
          if (r.pending) { mode = 'login'; msg = ''; draw(); $('#lf').insertAdjacentHTML('beforebegin', '<div class="banner ok">Account created. An administrator has to approve it before you can sign in.</div>'); return; }
        }
        var res = await call('login', { email: p.email, password: p.password });
        S.token = res.token; store('tok', res.token); S.user = res.user; S.init = await call('init'); renderShell();
      } catch (e) { msg = e.message; draw(); }
    };
  }
  draw();
}

/* ============================== shell ============================== */
var VIEWS = [
  { id: 'planner', label: 'Planner', role: 'viewer' }, { id: 'batches', label: 'Confirmed batches', role: 'viewer' },
  { id: 'bulk', label: 'Bulk storage', role: 'viewer' }, { id: 'report', label: 'Report', role: 'viewer' },
  { id: 'data', label: 'ERP & lists', role: 'viewer' }, { id: 'master', label: 'Master data', role: 'viewer' },
  { id: 'admin', label: 'Admin', role: 'admin' }
];
function renderShell() {
  var nav = VIEWS.filter(function (v) { return can(v.role); }).map(function (v) { return '<button data-v="' + v.id + '" class="' + (S.view === v.id ? 'on' : '') + '">' + v.label + '</button>'; }).join('');
  $('#app').innerHTML = '<header class="top"><div class="bar"><span class="brand">' + esc(S.init.appName) + '</span><nav>' + nav + '</nav>' +
    '<div class="who"><span>' + esc(S.user.name) + ' <span class="pill p-gray">' + esc(S.user.role) + '</span></span><button class="btn ghost sm" id="pw">Password</button><button class="btn ghost sm" id="out">Sign out</button></div></div></header><main id="view"></main>';
  document.querySelectorAll('nav button').forEach(function (b) { b.onclick = function () { S.view = b.dataset.v; renderShell(); }; });
  $('#out').onclick = async function () { try { await call('logout'); } catch (e) { /* ignore */ } S.token = null; store('tok', null); renderLogin(); };
  $('#pw').onclick = changePassword;
  var fn = { planner: viewPlanner, batches: viewBatches, bulk: viewBulk, report: viewReport, data: viewData, master: viewMaster, admin: viewAdmin }[S.view];
  var vw = $('#view');
  Promise.resolve().then(function () { return fn(vw); }).catch(function (e) {
    var m = (e && e.message) ? e.message : String(e);
    vw.innerHTML = '<div class="card"><div class="banner err">Could not load this page: ' + esc(m) + '</div><button class="btn" id="retry">Try again</button></div>';
    var rb = document.getElementById('retry'); if (rb) rb.onclick = renderShell;
  });
}
function changePassword() {
  var m = modal('Change password', '<div class="stack"><label class="f">Current password<input type="password" id="o"></label><label class="f">New password (at least 10 characters)<input type="password" id="n"></label></div>',
    [{ label: 'Change', fn: function (bg, close, btn) { run(btn, async function () { await call('changePw', { oldPassword: $('#o', bg).value, newPassword: $('#n', bg).value }); close(); toast('Password changed.'); }); } }], { width: '420px' });
}

/* ============================== planner ============================== */
function loadParams() {
  var d = { product: '', step: 'All', site: (S.init.sites[0] || {}).id || '', n: 1, from: addDays(today(), 14), to: addDays(today(), 14), stepOffset: 7 };
  try { var p = JSON.parse(lstore('params:' + S.user.email) || '{}'); Object.keys(p).forEach(function (k) { if (p[k] !== '' && p[k] != null) d[k] = p[k]; }); } catch (e) { /* ignore */ }
  if (d.from < today()) { d.from = addDays(today(), 14); d.to = d.from; }
  return d;
}
function viewPlanner(el) {
  S.params = S.params || loadParams();
  var p = S.params, steps = S.init.steps.filter(function (s) { return String(s.active || 'Y').toUpperCase() !== 'N'; });
  var firstRun = (!S.init.sites.length || !steps.length) ? '<div class="banner warn">First steps: add your sites and process steps under Admin, then enter products and requirements under Master data and import the ERP stock under ERP &amp; lists.</div>' : '';
  el.innerHTML = firstRun + '<div class="card"><h2>Plan a campaign</h2><div class="row">' +
    '<label class="f grow" style="min-width:220px">Product<input id="p_product" autocomplete="off" value="' + esc(p.product) + '" placeholder="Click to choose or type to search ..."></label>' +
    '<label class="f">Process step<select id="p_step"><option value="All">All steps (in sequence)</option>' + opt(steps.map(function (s) { return s.step; }), p.step) + '</select></label>' +
    '<label class="f">Site<select id="p_site">' + siteOpts(p.site) + '</select></label>' +
    '<label class="f">Batches<input id="p_n" type="number" min="1" max="50" value="' + esc(p.n) + '" style="width:80px"></label>' +
    '<label class="f">From<input id="p_from" type="date" value="' + esc(p.from) + '"></label>' +
    '<label class="f">To<input id="p_to" type="date" value="' + esc(p.to) + '"></label>' +
    '<label class="f" id="offwrap">Days between steps<input id="p_off" type="number" min="0" value="' + esc(p.stepOffset) + '" style="width:90px"></label>' +
    '<button class="btn" id="go">Check readiness</button></div>' +
    '<p class="small muted" style="margin:10px 0 0">Your inputs are private to you. Several batches are spread evenly between From and To. Confirmed batches of all users are included automatically.</p></div><div id="result"></div>';
  function read() {
    S.params = { product: $('#p_product').value.trim(), step: $('#p_step').value, site: $('#p_site').value, n: parseInt($('#p_n').value, 10) || 1, from: $('#p_from').value, to: $('#p_to').value || $('#p_from').value, stepOffset: parseInt($('#p_off').value, 10) || 0 };
    lstore('params:' + S.user.email, JSON.stringify(S.params)); return S.params;
  }
  function vis() { $('#offwrap').style.display = $('#p_step').value === 'All' ? '' : 'none'; }
  $('#p_step').onchange = vis; vis();
  $('#p_from').onchange = function () { if (!$('#p_to').value || $('#p_to').value < $('#p_from').value) $('#p_to').value = $('#p_from').value; };
  combo($('#p_product'), function () { return S.init.products.map(function (x) { return { v: x.product, d: x.description || '' }; }); });
  $('#go').onclick = function () { run($('#go'), async function () { S.plan = await call('calc', read()); drawResult(); }); };
  if (S.plan) drawResult();
}

function drawResult() {
  var R = S.plan, el = $('#result'); if (!el) return;
  var planned = R.batches.filter(function (b) { return !b.confirmed; }), conf = R.batches.length - planned.length;
  var ready = planned.filter(function (b) { return b.result === 'READY'; }).length;
  var h = '';
  R.warnings.forEach(function (w) { h += '<div class="banner">' + esc(w) + '</div>'; });
  h += '<div class="card"><div class="row" style="justify-content:space-between;margin-bottom:10px"><h2>Result</h2>' +
    (can('planner') && planned.length ? '<button class="btn" id="confirmBtn">Confirm campaign ...</button>' : '') + '</div>' +
    '<div class="stats"><div class="stat"><b>' + planned.length + '</b>planned batches</div><div class="stat"><b style="color:var(--good)">' + ready + '</b>ready</div>' +
    '<div class="stat"><b style="color:var(--bad)">' + (planned.length - ready) + '</b>blocked / no data</div><div class="stat"><b>' + conf + '</b>confirmed batches considered</div></div>';
  var cols = [
    { h: 'Batch', f: function (b) { return '<b>' + esc(b.id) + '</b>' + (b.confirmed ? ' <span class="pill p-gray">' + (b.produced ? 'produced, not booked' : 'confirmed') + '</span>' : ''); } },
    { h: 'Step', k: 'step' }, { h: 'Site', f: function (b) { return esc(siteName(b.site)); } }, { h: 'Start', k: 'start', nw: 1 },
    { h: 'Result', f: function (b) { return pill(b.result); } },
    { h: 'Materials', num: 1, f: function (b) { return b.summary.material || '-'; } }, { h: 'Documents', num: 1, f: function (b) { return b.summary.docs || '-'; } },
    { h: 'Equipment', num: 1, f: function (b) { return b.summary.equipment || '-'; } }, { h: 'Samples', num: 1, f: function (b) { return b.summary.sample || '-'; } },
    { h: 'To prepare', num: 1, f: function (b) { return b.summary.prepare || '-'; } }, { h: 'Take-over', num: 1, f: function (b) { return b.summary.transfer || '-'; } },
    { h: 'Book to PSA', num: 1, f: function (b) { return b.summary.psa || '-'; } },
    { h: 'Why / next action', f: function (b) { return esc(b.next); } }
  ];
  h += table(cols, R.batches, { click: 1, empty: 'No batches.' }) + '<p class="small muted" style="margin-top:8px">Click a batch to see every requirement line. "Materials / Documents / Equipment" count lines that block the batch.</p></div>';
  if (R.recommendations.length) {
    h += '<div class="card"><h2>Recommendations</h2>' + table([
      { h: 'Site', k: 'siteName' }, { h: 'Item', k: 'item' }, { h: 'Description', k: 'desc' }, { h: 'Short', num: 1, f: function (r) { return num(r.short) + ' ' + esc(r.unit); } },
      { h: 'Status', f: function (r) { return pill(r.status); } }, { h: 'Suggestion', k: 'text' }, { h: 'Batches', num: 1, k: 'batches' }], R.recommendations) + '</div>';
  }
  if (R.prepList.length) {
    h += '<div class="card"><h2>In-house preparations needed</h2>' + table([
      { h: 'Site', f: function (r) { return esc(siteName(r.site)); } }, { h: 'Stock solution', f: function (r) { return esc(r.item + ' ' + (r.desc || '')); } },
      { h: 'Preparations', num: 1, k: 'preparations' }, { h: 'Yield each', num: 1, f: function (r) { return num(r.yield) + ' ' + esc(r.unit); } },
      { h: 'Components', f: function (r) { return r.blocked ? pill('PREP: COMPONENT MISSING') : pill('OK'); } }, { h: 'For batches', f: function (r) { return esc(r.batches.join(', ')); } }], R.prepList) + '</div>';
  }
  el.innerHTML = h;
  el.querySelectorAll('tr.click').forEach(function (tr) { tr.onclick = function () { showBatch(R.batches[+tr.dataset.i]); }; });
  var cb = $('#confirmBtn'); if (cb) cb.onclick = confirmDialog;
}

function showBatch(b) {
  var body = '<div class="row" style="margin-bottom:10px">' + pill(b.result) + '<span class="muted">' + esc(b.step) + ' - ' + esc(siteName(b.site)) + ' - ' + esc(b.start) + ' to ' + esc(b.end) + '</span></div><div class="banner' + (b.result === 'READY' ? ' ok' : '') + '">' + esc(b.next) + '</div>' +
    '<label class="small"><input type="checkbox" id="onlyp"> show only problems</label><div id="lines"></div>';
  var m = modal(b.id, body, [], { width: '1200px' });
  function draw() {
    var only = $('#onlyp', m.el).checked;
    var lines = b.lines.filter(function (l) { return !only || (l.status !== 'OK' && l.status !== 'OUTPUT'); });
    var h = table([
      { h: '#', k: 'n' }, { h: 'Type', k: 'type' }, { h: 'Used for', k: 'usedFor' }, { h: 'Item', k: 'item', nw: 1 }, { h: 'Description', k: 'desc' },
      { h: 'Needed', num: 1, f: function (l) { return l.qty ? num(l.qty) + ' ' + esc(l.unit) : ''; } },
      { h: 'Free', num: 1, f: function (l) { return l.avail !== undefined ? num(l.avail) : ''; } },
      { h: 'Status', f: function (l) { return pill(l.status); } }, { h: 'Note', f: function (l) { return esc(l.note); } }], lines, { empty: 'No lines.' });
    lines.forEach(function (l) {
      if (!l.prep) return;
      h += '<h3 style="margin:14px 0 6px">Preparation of ' + esc(l.item) + ': ' + l.prep.preparations + ' x ' + num(l.prep.yield) + ' ' + esc(l.prep.unit) + '</h3>' + table([
        { h: 'Component', f: function (c) { return esc(c.item + ' ' + (c.desc || '')); } }, { h: 'Needed', num: 1, f: function (c) { return num(c.need) + ' ' + esc(c.unit); } },
        { h: 'Short', num: 1, f: function (c) { return c.short ? num(c.short) : '-'; } }, { h: 'Status', f: function (c) { return pill(c.status); } }, { h: 'Note', f: function (c) { return esc(c.note); } }], l.prep.components);
    });
    $('#lines', m.el).innerHTML = h;
  }
  $('#onlyp', m.el).onchange = draw; draw();
}

function confirmDialog() {
  var planned = S.plan.batches.filter(function (b) { return !b.confirmed; });
  var blocked = planned.filter(function (b) { return b.result !== 'READY'; }).length;
  var body = '<p>These batches will be reserved for everybody (material, documents and equipment windows).</p>' + table([{ h: 'Batch', k: 'id' }, { h: 'Start', k: 'start' }, { h: 'Result', f: function (b) { return pill(b.result); } }], planned) +
    (blocked ? '<p><label><input type="checkbox" id="incl"> Also confirm the ' + blocked + ' blocked batch(es)</label></p>' : '');
  modal('Confirm campaign', body, [{ label: 'Confirm', fn: function (bg, close, btn) {
    run(btn, async function () {
      var p = Object.assign({}, S.params, { includeBlocked: !!($('#incl', bg) && $('#incl', bg).checked) });
      var r = await call('confirm', p); close(); toast(r.confirmed + ' batch(es) confirmed.');
      S.plan = await call('calc', S.params); drawResult();
    });
  } }]);
}

/* ============================== confirmed batches ============================== */
async function viewBatches(el) {
  el.innerHTML = '<div class="card"><p class="muted"><span class="spin"></span> Loading ...</p></div>';
  var rows = (await call('tableGet', { table: 'Confirmed' })).rows;
  var f = S.sub.batches || 'open';
  var shown = rows.filter(function (r) { return f === 'all' || (f === 'open' ? (r.status !== 'Cancelled' && r.archived !== 'Yes') : r.archived === 'Yes'); });
  el.innerHTML = '<div class="card"><div class="row" style="justify-content:space-between"><h2>Confirmed batches</h2>' + (can('planner') ? '<button class="btn ghost" id="arch">Archive released batches</button>' : '') + '</div>' +
    '<div class="sub">' + ['open', 'archived', 'all'].map(function (x) { return '<button data-f="' + x + '" class="' + (f === x ? 'on' : '') + '">' + x + '</button>'; }).join('') + '</div>' +
    '<div class="hint">A produced batch keeps its reservation until you marked "ERP updated" and an ERP stock export was imported afterwards. Then it is released and can be archived into the report.</div>' +
    table([{ h: 'Batch', k: 'id' }, { h: 'Step', k: 'step' }, { h: 'Site', f: function (r) { return esc(siteName(r.site)); } }, { h: 'Start', k: 'start', nw: 1 },
      { h: 'Status', f: function (r) { return pill(r.status === 'Confirmed' ? 'PREPARE' : (r.status === 'Produced' ? 'OK' : 'BLOCKED'), r.status); } },
      { h: 'Process order', f: function (r, i) { return can('planner') ? '<input data-po="' + i + '" value="' + esc(r.poNo) + '" style="width:130px">' : esc(r.poNo); } },
      { h: 'Produced', f: function (r) { return r.status === 'Produced' ? num(r.producedQty) + ' (' + esc(r.producedDate) + ')' + (r.erpUpdated === 'Yes' ? ' ERP booked' : ' <span class="muted">ERP not booked</span>') : ''; } },
      { h: 'Confirmed by', k: 'confirmedBy' },
      { h: '', f: function (r, i) { if (!can('planner') || r.archived === 'Yes') return ''; return (r.status === 'Confirmed' ? '<button class="btn sm" data-c="' + i + '">Complete</button> <button class="btn ghost sm" data-x="' + i + '">Cancel</button>' : (r.status === 'Cancelled' ? '<button class="btn ghost sm" data-r="' + i + '">Reopen</button>' : '<button class="btn ghost sm" data-c="' + i + '">Edit result</button>')); } }], shown, { empty: 'No batches here.' }) + '</div>';
  el.querySelectorAll('.sub button').forEach(function (b) { b.onclick = function () { S.sub.batches = b.dataset.f; viewBatches(el); }; });
  el.querySelectorAll('[data-po]').forEach(function (i) { i.onchange = function () { var r = shown[+i.dataset.po]; call('confirmedUpd', { action: 'po', id: r.id, poNo: i.value }).then(function () { toast('Saved.'); }).catch(function (e) { toast(e.message, true); }); }; });
  el.querySelectorAll('[data-x]').forEach(function (b) { b.onclick = function () { if (!confirm('Cancel this batch? Its reservation is released.')) return; var r = shown[+b.dataset.x]; call('confirmedUpd', { action: 'cancel', id: r.id }).then(function () { viewBatches(el); }).catch(function (e) { toast(e.message, true); }); }; });
  el.querySelectorAll('[data-r]').forEach(function (b) { b.onclick = function () { var r = shown[+b.dataset.r]; call('confirmedUpd', { action: 'reopen', id: r.id }).then(function () { viewBatches(el); }).catch(function (e) { toast(e.message, true); }); }; });
  el.querySelectorAll('[data-c]').forEach(function (b) { b.onclick = function () { completeDialog(shown[+b.dataset.c], function () { viewBatches(el); }); }; });
  var a = $('#arch'); if (a) a.onclick = function () { run(a, async function () { var r = await call('archive'); toast(r.archived + ' batch(es) archived.'); viewBatches(el); }); };
}

async function completeDialog(r, done) {
  var reqs = [];
  try { reqs = (await call('tableGet', { table: 'Requirements' })).rows; } catch (e) { /* optional */ }
  var out = reqs.filter(function (x) { return x.product === r.product && x.step === r.step && String(x.type).toLowerCase() === 'output'; })[0] || {};
  var body = '<div class="row"><label class="f">Produced quantity' + (out.unit ? ' (' + esc(out.unit) + ')' : '') + '<input id="q" type="number" step="any" value="' + esc(r.producedQty) + '"></label>' +
    '<label class="f">Produced on<input id="d" type="date" value="' + esc(r.producedDate || today()) + '"></label>' +
    '<label class="f">ERP updated (materials booked to the process order)?<select id="u"><option>No</option><option' + (r.erpUpdated === 'Yes' ? ' selected' : '') + '>Yes</option></select></label>' +
    '<label class="f">ERP booking date<input id="b" type="date" value="' + esc(r.bookingDate || '') + '"></label></div>' +
    '<h3 style="margin:16px 0 6px"><label><input type="checkbox" id="addb"' + (out.itemId ? ' checked' : '') + '> Put the product into bulk storage</label></h3>' +
    '<div class="row"><label class="f">Item<input id="bi" value="' + esc(out.itemId || '') + '"></label><label class="f">Description<input id="bd" value="' + esc(out.description || '') + '"></label>' +
    '<label class="f">Quantity<input id="bq" type="number" step="any" value="' + esc(r.producedQty) + '" style="width:110px"></label><label class="f">Unit<input id="bu" value="' + esc(out.unit || '') + '" style="width:70px"></label>' +
    '<label class="f">Freezer / position<input id="bf" placeholder="e.g. -80 C, rack 2"></label><label class="f">Lot<input id="bl"></label><label class="f">Expiry<input id="be" type="date"></label></div>';
  var cm = modal('Complete ' + r.id, body, [{ label: 'Save', fn: function (bg, close, btn) {
    run(btn, async function () {
      var v = function (id) { return $('#' + id, bg).value; };
      await call('confirmedUpd', { action: 'complete', id: r.id, producedQty: v('q'), producedDate: v('d'), erpUpdated: v('u'), bookingDate: v('b'),
        bulk: { add: $('#addb', bg).checked && r.status !== 'Produced', itemId: v('bi'), description: v('bd'), qty: v('bq'), unit: v('bu'), freezer: v('bf'), lotId: v('bl'), expiry: v('be') } });
      close(); toast('Saved.'); done();
    });
  } }]);
  var qi = $('#q', cm.el), bi = $('#bq', cm.el), touched = !!bi.value;
  bi.oninput = function () { touched = true; };
  qi.oninput = function () { if (!touched) bi.value = qi.value; };
}

/* ============================== bulk / report ============================== */
async function viewBulk(el) {
  el.innerHTML = '<div class="card"><h2>Bulk storage (-80 C freezers)</h2><div class="hint">Pellets from fermentation are kept here for IB preparation only. While a lot is Stored, it counts as stock for that step. Once the lot is booked in SAP, tick "Booked in ERP" and the ERP export takes over. What IB preparation produces is the material for the downstream steps.</div><div id="g"></div></div>';
  var g = await call('tableGet', { table: 'Bulk' });
  gridEditor($('#g'), { table: 'Bulk', version: g.version, rows: g.rows, canEdit: can('planner'), cols: [
    { k: 'lotId', l: 'Lot' }, { k: 'site', l: 'Site', t: 'select', o: function () { return S.init.sites.map(function (s) { return s.id; }); } }, { k: 'itemId', l: 'Item' }, { k: 'description', l: 'Description' },
    { k: 'qty', l: 'Quantity', t: 'number' }, { k: 'unit', l: 'Unit' }, { k: 'freezer', l: 'Freezer / position' },
    { k: 'status', l: 'Status', t: 'select', o: function () { return ['Stored', 'Released', 'Consumed', 'Discarded']; } }, { k: 'expiry', l: 'Expiry', t: 'date' },
    { k: 'bookedInErp', l: 'Booked in ERP', t: 'select', o: function () { return ['No', 'Yes']; } }, { k: 'sourceBatch', l: 'Source batch' }], blank: { status: 'Stored', bookedInErp: 'No' } });
}
async function viewReport(el) {
  el.innerHTML = '<div class="card"><h2>Planned versus produced</h2><div id="g"><span class="spin"></span></div></div>';
  var rows = (await call('tableGet', { table: 'Report' })).rows;
  var tot = rows.length, withVar = rows.filter(function (r) { return r.variancePct !== ''; });
  var avg = withVar.length ? Math.round(withVar.reduce(function (a, r) { return a + Number(r.variancePct); }, 0) / withVar.length * 10) / 10 : null;
  $('#g').innerHTML = '<div class="stats"><div class="stat"><b>' + tot + '</b>archived batches</div><div class="stat"><b>' + (avg === null ? '-' : avg + ' %') + '</b>average deviation</div></div>' +
    table([{ h: 'Batch', k: 'id' }, { h: 'Step', k: 'step' }, { h: 'Site', f: function (r) { return esc(siteName(r.site)); } }, { h: 'Planned start', k: 'plannedStart', nw: 1 }, { h: 'Produced on', k: 'producedDate', nw: 1 },
      { h: 'Planned', num: 1, f: function (r) { return num(r.plannedQty) + ' ' + esc(r.unit); } }, { h: 'Produced', num: 1, f: function (r) { return num(r.producedQty) + ' ' + esc(r.unit); } },
      { h: 'Deviation', num: 1, f: function (r) { return r.variancePct === '' ? '' : (r.variancePct > 0 ? '+' : '') + r.variancePct + ' %'; } }, { h: 'Process order', k: 'poNo' }], rows, { empty: 'Nothing archived yet. Complete a batch, import a new ERP export, then archive it.' });
}

/* ============================== searchable dropdown (replaces the browser datalist) ============================== */
function combo(inp, getItems) {
  var box = document.createElement('div'); box.className = 'combo'; box.style.display = 'none';
  inp.parentNode.style.position = 'relative'; inp.parentNode.appendChild(box);
  var items = [], act = -1, typed = false;
  function render() {
    var q = typed ? inp.value.trim().toLowerCase() : '';
    items = getItems().filter(function (x) { return !q || (x.v + ' ' + x.d).toLowerCase().indexOf(q) >= 0; });
    act = Math.min(act, items.length - 1);
    box.innerHTML = items.length ? items.map(function (x, i) {
      return '<div class="opt' + (i === act ? ' on' : '') + '" data-i="' + i + '"><b>' + esc(x.v) + '</b>' + (x.d ? '<span class="muted small"> ' + esc(x.d) + '</span>' : '') + '</div>';
    }).join('') : '<div class="opt muted">No product found. Add it under Master data > Products.</div>';
    box.style.display = 'block';
    var on = box.querySelector('.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }
  function pick(i) { if (!items[i]) return; inp.value = items[i].v; box.style.display = 'none'; typed = false; inp.dispatchEvent(new Event('change', { bubbles: true })); }
  inp.addEventListener('focus', function () { typed = false; act = -1; render(); inp.select(); });
  inp.addEventListener('click', function () { if (box.style.display === 'none') { typed = false; render(); } });
  inp.addEventListener('input', function () { typed = true; act = 0; render(); });
  inp.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (box.style.display === 'none') { typed = false; render(); } act = Math.min(act + 1, items.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); act = Math.max(act - 1, 0); render(); }
    else if (e.key === 'Enter') { if (box.style.display !== 'none' && act >= 0) { e.preventDefault(); pick(act); } }
    else if (e.key === 'Escape' || e.key === 'Tab') { box.style.display = 'none'; }
  });
  box.addEventListener('mousedown', function (e) { e.preventDefault(); var o = e.target.closest('.opt'); if (o && o.dataset.i !== undefined) pick(+o.dataset.i); });
  inp.addEventListener('blur', function () { setTimeout(function () { box.style.display = 'none'; }, 120); });
}

/* ============================== generic grid editor ============================== */
function gridEditor(el, o) {
  var rows = o.rows, shownMax = 500;
  function draw() {
    var idx = []; rows.forEach(function (r, i) { if (!o.filter || o.filter(r)) idx.push(i); });
    var h = '<div class="row" style="margin-bottom:8px;justify-content:space-between"><span class="muted small">' + idx.length + ' row(s)' + (idx.length > shownMax ? ', showing the first ' + shownMax : '') + '</span>' +
      (o.canEdit ? '<span><button class="btn ghost sm" data-add>+ Add row</button> <button class="btn sm" data-save>Save changes</button></span>' : '') + '</div>';
    h += '<div class="tablewrap" style="max-height:62vh"><table><thead><tr>' + o.cols.map(function (c) { return '<th>' + esc(c.l) + '</th>'; }).join('') + (o.canEdit ? '<th></th>' : '') + '</tr></thead><tbody>';
    idx.slice(0, shownMax).forEach(function (i) {
      var r = rows[i];
      h += '<tr>' + o.cols.map(function (c) {
        var v = r[c.k] == null ? '' : r[c.k];
        if (!o.canEdit || c.ro) return '<td>' + esc(v) + '</td>';
        if (c.t === 'select') return '<td><select data-i="' + i + '" data-k="' + c.k + '">' + opt(c.o(), v, true) + '</select></td>';
        return '<td><input data-i="' + i + '" data-k="' + c.k + '" type="' + (c.t === 'number' ? 'number' : (c.t === 'date' ? 'date' : 'text')) + '"' + (c.t === 'number' ? ' step="any"' : '') + ' value="' + esc(v) + '"></td>';
      }).join('') + (o.canEdit ? '<td><button class="btn ghost sm" data-del="' + i + '" title="Delete row">x</button></td>' : '') + '</tr>';
    });
    if (!idx.length) h += '<tr><td colspan="' + (o.cols.length + 1) + '" class="muted">No rows.</td></tr>';
    el.innerHTML = h + '</tbody></table></div>';
    el.querySelectorAll('[data-k]').forEach(function (inp) { inp.onchange = function () { rows[+inp.dataset.i][inp.dataset.k] = inp.value; }; });
    el.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { rows.splice(+b.dataset.del, 1); draw(); }; });
    var add = el.querySelector('[data-add]'); if (add) add.onclick = function () { rows.push(Object.assign({}, o.blank || {}, o.newRow ? o.newRow() : {})); draw(); var last = el.querySelectorAll('tbody tr'); if (last.length) last[last.length - 1].scrollIntoView({ block: 'nearest' }); };
    var sv = el.querySelector('[data-save]'); if (sv) sv.onclick = function () {
      run(sv, async function () { var r = await call('tableSave', { table: o.table, rows: rows, version: o.version }); o.version = r.version; toast('Saved (' + r.count + ' rows).'); if (o.onSaved) o.onSaved(); });
    };
  }
  draw(); return { redraw: draw };
}

/* ============================== data (imports) ============================== */
var SPECS = {
  ErpStock: { label: 'ERP stock', perSite: true, fields: [
    { k: 'material', l: 'Material / item number', req: 1, al: ['material', 'materialnummer', 'produkt', 'product', 'item', 'itemid', 'itemnumber', 'artikel', 'partnumber', 'matnr'] },
    { k: 'storageBin', l: 'Storage bin', al: ['storagebin', 'lagerplatz', 'bin'] },
    { k: 'storageType', l: 'Storage type', al: ['storagetype', 'lagertyp', 'typ'] },
    { k: 'description', l: 'Description', al: ['description', 'produktkurzbeschreibung', 'produktbeschreibung', 'materialkurztext', 'materialdescription', 'name'] },
    { k: 'batch', l: 'Batch', al: ['batch', 'charge'] },
    { k: 'stockCategory', l: 'Stock category', req: 1, al: ['stockcategory', 'bestandsart', 'ba', 'stocktype', 'stockstatus'] },
    { k: 'expiry', l: 'Expiry date', date: 1, al: ['expiry', 'expirydate', 'verfallsdatum', 'verfallsdatummhd', 'mhd', 'expirationdate', 'bestbefore'] },
    { k: 'qty', l: 'Available quantity', req: 1, num: 1, al: ['availablequantity', 'verfügbaremengeame', 'verfügbaremenge', 'verfmngame', 'quantity', 'menge', 'qty', 'stockquantity'] },
    { k: 'unit', l: 'Base unit', req: 1, al: ['baseunit', 'basismengeneinheit', 'bme', 'unit', 'uom', 'me'] }] },
  Documents: { label: 'Documents', fields: [
    { k: 'docId', l: 'Document number', req: 1, al: ['documentnumber', 'documentid', 'docid', 'dokumentnummer', 'number', 'documentno', 'id', 'docnumber'] },
    { k: 'title', l: 'Title', al: ['title', 'titel', 'name', 'documenttitle', 'bezeichnung', 'description'] },
    { k: 'version', l: 'Version', al: ['version', 'ver', 'revision'] },
    { k: 'status', l: 'Status', req: 1, al: ['status', 'documentstatus', 'state'] },
    { k: 'effectiveDue', l: 'Effective date (valid from)', date: 1, al: ['effectivedate', 'effectivedateused', 'validfrom', 'gültigab', 'wirksamab', 'effectiveduedate', 'duedate', 'nextreviewdate', 'nextreview', 'expirydate', 'validuntil', 'effectiveuntil', 'periodicreviewdate'] }] },
  Equipment: { label: 'Equipment', fields: [
    { k: 'equipId', l: 'Equipment ID', req: 1, al: ['equipmentid', 'equipmentnumber', 'equipmentno', 'gerätenr', 'gerätenummer', 'assetid', 'tag', 'id'] },
    { k: 'description', l: 'Description', al: ['description', 'bezeichnung', 'name', 'model', 'modell'] },
    { k: 'status', l: 'Status', req: 1, al: ['status', 'equipmentstatus'] },
    { k: 'due', l: 'Next calibration / qualification due', date: 1, al: ['due', 'duedate', 'nextdue', 'nextcalibration', 'nextduedate', 'calibrationdue', 'nextqualification', 'fälligkeit'] }] },
  Bio: { label: 'Bio inventory', perSite: true, fields: [
    { k: 'category', l: 'Category', al: ['category', 'kategorie', 'type', 'art'] },
    { k: 'itemId', l: 'Item ID', req: 1, al: ['itemid', 'item', 'id', 'materialnumber', 'cgx', 'cgxnr'] },
    { k: 'description', l: 'Description', al: ['description', 'bezeichnung', 'name'] },
    { k: 'lot', l: 'Lot', al: ['lot', 'lotcharge', 'charge', 'batch'] },
    { k: 'storage', l: 'Storage location', al: ['storagelocation', 'storage', 'lagerort', 'freezer'] },
    { k: 'qty', l: 'Quantity', req: 1, num: 1, al: ['quantity', 'qty', 'menge', 'amount', 'count'] },
    { k: 'unit', l: 'Unit', al: ['unit', 'einheit', 'uom'] },
    { k: 'status', l: 'Status', req: 1, al: ['status'] },
    { k: 'expiry', l: 'Expiry / retest date', date: 1, al: ['expiry', 'expiryretestdate', 'retestdate', 'expirydate', 'verfallsdatum'] }] }
};
function normH(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9äöüß]/g, ''); }
function parseNum(v) {
  if (typeof v === 'number') return v;
  var s = String(v == null ? '' : v).trim().replace(/\s/g, ''); if (!s) return '';
  var neg = /-$/.test(s); if (neg) s = s.slice(0, -1);
  if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) { if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, ''); }
  else if (s.indexOf(',') >= 0) s = s.replace(',', '.');
  var n = Number(s); return isFinite(n) ? (neg ? -n : n) : '';
}
function parseDate(v) {
  if (v instanceof Date) { var d = new Date(v.getTime() + 12 * 3600e3); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  var s = String(v == null ? '' : v).trim(); if (!s) return '';
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(s); if (m) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s); if (m) { var a = +m[1], b = +m[2], y = m[3].length === 2 ? '20' + m[3] : m[3]; if (a > 12) return y + '-' + String(b).padStart(2, '0') + '-' + String(a).padStart(2, '0'); return y + '-' + String(a).padStart(2, '0') + '-' + String(b).padStart(2, '0'); }
  return '';
}
function parseCsv(text) {
  var first = text.split(/\r?\n/, 1)[0], best = ',', cnt = -1;
  [';', '\t', '|', ','].forEach(function (d) { var c = first.split(d).length; if (c > cnt) { cnt = c; best = d; } });
  var rows = [], row = [], cur = '', q = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === best) { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
function readFileRows(file) {
  return new Promise(function (resolve, reject) {
    var fr = new FileReader(), isText = /\.(csv|txt|tsv)$/i.test(file.name);
    fr.onerror = function () { reject(new Error('The file could not be read.')); };
    fr.onload = function () {
      try {
        if (isText) return resolve(parseCsv(String(fr.result)));
        if (typeof XLSX === 'undefined') return reject(new Error('The Excel reader could not be loaded. Save the file as CSV and try again.'));
        var wb = XLSX.read(fr.result, { type: 'array', cellDates: true });
        resolve(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }));
      } catch (e) { reject(new Error('Unreadable file: ' + e.message)); }
    };
    if (isText) fr.readAsText(file); else fr.readAsArrayBuffer(file);
  });
}
function importDialog(name, done) {
  var spec = SPECS[name];
  var body = '<div class="stack"><div class="hint">Choose the export file (.xlsx, .xls, .csv or .txt). The first sheet is read. Columns are matched by their header name - you can correct the match below. The old data of ' + (spec.perSite ? 'the chosen site' : 'this list') + ' is replaced.</div>' +
    '<div class="row">' + (spec.perSite ? '<label class="f">Site of this export<select id="isite">' + siteOpts('') + '</select></label>' : '') + '<label class="f">File<input type="file" id="ifile" accept=".xlsx,.xls,.csv,.txt,.tsv"></label></div><div id="imap"></div></div>';
  var data = null;
  var m = modal('Import ' + spec.label, body, [{ label: 'Import', fn: function (bg, close, btn) {
    if (!data) return toast('Choose a file first.', true);
    var map = {}; spec.fields.forEach(function (f) { map[f.k] = $('#m_' + f.k, bg).value; });
    var miss = spec.fields.filter(function (f) { return f.req && map[f.k] === ''; });
    if (miss.length) return toast('Please assign: ' + miss.map(function (f) { return f.l; }).join(', '), true);
    var rows = [];
    data.body.forEach(function (r) {
      var o = {}, any = false;
      spec.fields.forEach(function (f) {
        var v = map[f.k] === '' ? '' : r[+map[f.k]];
        o[f.k] = f.num ? parseNum(v) : (f.date ? parseDate(v) : String(v == null ? '' : v).trim());
        if (String(o[f.k]) !== '') any = true;
      });
      var key = spec.fields.filter(function (f) { return f.req; })[0].k;
      if (any && String(o[key]) !== '') rows.push(o);
    });
    if (!rows.length) return toast('No data rows found.', true);
    var site = spec.perSite ? $('#isite', bg).value : '';
    run(btn, async function () {
      var CH = 1500;
      for (var i = 0; i < rows.length; i += CH) {
        btn.firstChild && (btn.lastChild.textContent = ' ' + Math.min(i + CH, rows.length) + ' / ' + rows.length);
        await call('importData', { table: name, site: site, rows: rows.slice(i, i + CH), first: i === 0, last: i + CH >= rows.length, total: rows.length });
      }
      close(); toast(rows.length + ' rows imported.'); S.init = await call('init'); done();
    });
  } }], { width: '900px' });
  $('#ifile', m.el).onchange = async function (ev) {
    var f = ev.target.files[0]; if (!f) return;
    try {
      var all = await readFileRows(f);
      var hi = 0; for (var i = 0; i < Math.min(15, all.length); i++) { if (all[i].filter(function (x) { return String(x).trim() !== ''; }).length >= 3) { hi = i; break; } }
      var head = all[hi].map(function (x) { return String(x).trim(); });
      data = { head: head, body: all.slice(hi + 1) };
      var h = '<p class="muted small">' + data.body.length + ' data rows, header in row ' + (hi + 1) + '.</p><div class="tablewrap"><table><thead><tr><th>Field</th><th>Column in your file</th><th>First value</th></tr></thead><tbody>';
      spec.fields.forEach(function (fl) {
        var best = '';
        head.forEach(function (c, ci) { var n = normH(c); if (best === '' && fl.al.indexOf(n) >= 0) best = String(ci); });
        if (best === '') head.forEach(function (c, ci) { var n = normH(c); if (best === '' && n.length >= 5 && fl.al.some(function (a) { return a.length >= 5 && (n.indexOf(a) >= 0 || a.indexOf(n) >= 0); })) best = String(ci); });
        h += '<tr><td>' + esc(fl.l) + (fl.req ? ' *' : '') + '</td><td><select id="m_' + fl.k + '"><option value="">- none -</option>' + head.map(function (c, ci) { return '<option value="' + ci + '"' + (String(ci) === best ? ' selected' : '') + '>' + esc(c || '(column ' + (ci + 1) + ')') + '</option>'; }).join('') + '</select></td><td class="muted" id="s_' + fl.k + '"></td></tr>';
      });
      $('#imap', m.el).innerHTML = h + '</tbody></table></div>';
      spec.fields.forEach(function (fl) {
        var sel = $('#m_' + fl.k, m.el), up = function () { var v = sel.value === '' ? '' : (data.body[0] || [])[+sel.value]; $('#s_' + fl.k, m.el).textContent = v instanceof Date ? parseDate(v) : String(v == null ? '' : v); };
        sel.onchange = up; up();
      });
    } catch (e) { toast(e.message, true); }
  };
}

async function viewData(el) {
  var sets = [{ n: 'ErpStock', l: 'ERP stock', meta: function (s) { return S.init.meta['stock:' + s]; } }, { n: 'Documents', l: 'Documents', meta: function () { return S.init.meta.documents; } },
    { n: 'Equipment', l: 'Equipment', meta: function () { return S.init.meta.equipment; } }, { n: 'Holds', l: 'Equipment holds' }, { n: 'Bio', l: 'Bio inventory', meta: function () { return S.init.meta.bio; } }];
  var cur = S.sub.data || 'ErpStock', set = sets.filter(function (x) { return x.n === cur; })[0];
  var site = S.sub.dsite || (S.init.sites[0] || {}).id;
  var head = '<div class="card"><h2>ERP exports and lists</h2><div class="sub">' + sets.map(function (x) { return '<button data-s="' + x.n + '" class="' + (cur === x.n ? 'on' : '') + '">' + x.l + '</button>'; }).join('') + '</div><div id="dbody"><span class="spin"></span></div></div>';
  el.innerHTML = head;
  el.querySelectorAll('.sub button').forEach(function (b) { b.onclick = function () { S.sub.data = b.dataset.s; viewData(el); }; });
  var per = SPECS[cur] && SPECS[cur].perSite;
  var g = await call('tableGet', { table: cur, site: per ? site : undefined, limit: 300 });
  var body = '<div class="row" style="margin-bottom:10px;justify-content:space-between"><div class="row">' +
    (per ? '<label class="f">Site<select id="dsite">' + siteOpts(site) + '</select></label>' : '') +
    (set.meta ? '<span class="muted">Last import: <b>' + esc(fmtTs(set.meta(site))) + '</b></span>' : '') + '</div>' +
    (can('editor') && SPECS[cur] ? '<button class="btn" id="imp">Import file ...</button>' : '') + '</div>';
  if (cur === 'Holds') {
    body += '<div class="hint">Use equipment holds for equipment that is blocked by another process or maintenance. A batch whose time window overlaps a hold is blocked (EQUIPMENT BUSY).</div><div id="grid"></div>';
    $('#dbody').innerHTML = body;
    gridEditor($('#grid'), { table: 'Holds', version: g.version, rows: g.rows, canEdit: can('editor'), cols: [{ k: 'equipId', l: 'Equipment ID' }, { k: 'from', l: 'Blocked from', t: 'date' }, { k: 'until', l: 'Blocked until', t: 'date' }, { k: 'reason', l: 'Reason' }] });
    return;
  }
  var cols = SPECS[cur].fields.map(function (f) { return { h: f.l, k: f.k }; });
  if (per) cols.unshift({ h: 'Site', f: function (r) { return esc(siteName(r.site)); } });
  body += '<p class="muted small">' + g.total + ' row(s)' + (g.total > 300 ? ' - showing the first 300' : '') + '</p>' + table(cols, g.rows, { maxh: 520, empty: 'No data yet. Use "Import file ...".' });
  $('#dbody').innerHTML = body;
  var ds = $('#dsite'); if (ds) ds.onchange = function () { S.sub.dsite = ds.value; viewData(el); };
  var im = $('#imp'); if (im) im.onclick = function () { importDialog(cur, function () { viewData(el); }); };
}

/* ============================== master data ============================== */
async function viewMaster(el) {
  var tabs = [{ n: 'Requirements', l: 'Requirements' }, { n: 'Recipes', l: 'Stock-solution recipes' }, { n: 'Products', l: 'Products' }, { n: 'StorageTypes', l: 'Storage types' }];
  var cur = S.sub.master || 'Requirements';
  el.innerHTML = '<div class="card"><h2>Master data</h2><div class="sub">' + tabs.map(function (x) { return '<button data-s="' + x.n + '" class="' + (cur === x.n ? 'on' : '') + '">' + x.l + '</button>'; }).join('') + '</div><div id="mb"><span class="spin"></span></div></div>';
  el.querySelectorAll('.sub button').forEach(function (b) { b.onclick = function () { S.sub.master = b.dataset.s; viewMaster(el); }; });
  var g = await call('tableGet', { table: cur }), ed = can('editor'), mb = $('#mb');
  var steps = S.init.steps.map(function (s) { return s.step; });
  if (cur === 'Requirements') {
    var prods = {}; g.rows.forEach(function (r) { prods[r.product] = 1; }); S.init.products.forEach(function (p) { prods[p.product] = 1; });
    var sel = S.sub.rprod || Object.keys(prods).sort()[0] || '', selStep = S.sub.rstep || '';
    mb.innerHTML = '<div class="hint">One line per requirement of ONE batch of the product and process step. <b>Material</b> = ERP stock, <b>Biological</b> = bio inventory, <b>Document</b> / <b>Equipment</b> = item ID of the document / equipment, <b>Output</b> = expected product. Flag: for <b>Material</b> Y = prepared in-house (needs a recipe); for <b>Equipment</b> Y = exclusive use (only one batch at a time).</div>' +
      '<div class="row" style="margin-bottom:10px"><label class="f">Product<select id="rp">' + opt(Object.keys(prods).sort(), sel) + '</select></label><label class="f">Step<select id="rs"><option value="">all steps</option>' + opt(steps, selStep) + '</select></label></div><div id="grid"></div>';
    $('#rp').onchange = function () { S.sub.rprod = this.value; viewMaster(el); }; $('#rs').onchange = function () { S.sub.rstep = this.value; viewMaster(el); };
    gridEditor($('#grid'), { table: cur, version: g.version, rows: g.rows, canEdit: ed, filter: function (r) { return r.product === sel && (!selStep || r.step === selStep); },
      newRow: function () { return { product: sel, step: selStep || steps[0], usedFor: S.init.usedFor[0], type: 'Material', flag: 'N' }; },
      cols: [{ k: 'product', l: 'Product', t: 'select', o: function () { return Object.keys(prods).sort(); } }, { k: 'step', l: 'Step', t: 'select', o: function () { return steps; } }, { k: 'usedFor', l: 'Used for', t: 'select', o: function () { return S.init.usedFor; } },
        { k: 'type', l: 'Type', t: 'select', o: function () { return S.init.types; } }, { k: 'itemId', l: 'Item ID' }, { k: 'description', l: 'Description' }, { k: 'qty', l: 'Qty / batch', t: 'number' },
        { k: 'unit', l: 'Unit' }, { k: 'flag', l: 'Y/N', t: 'select', o: function () { return ['Y', 'N']; } }, { k: 'comment', l: 'Comment' }] });
  } else if (cur === 'Recipes') {
    mb.innerHTML = '<div class="hint">A recipe is the bill of material of ONE preparation of an in-house stock solution. Repeat the parent ID, description, yield and yield unit on every line; add one line per component with the quantity needed for one preparation. Use one line per chemical (add up repeated weighings).</div><div id="grid"></div>';
    gridEditor($('#grid'), { table: cur, version: g.version, rows: g.rows, canEdit: ed, cols: [{ k: 'parentId', l: 'Stock solution ID' }, { k: 'parentDesc', l: 'Description' }, { k: 'yield', l: 'Yield of one preparation', t: 'number' }, { k: 'yieldUnit', l: 'Yield unit' },
      { k: 'componentId', l: 'Component ID' }, { k: 'componentDesc', l: 'Component description' }, { k: 'qty', l: 'Qty per preparation', t: 'number' }, { k: 'unit', l: 'Unit' }, { k: 'comment', l: 'Comment' }] });
  } else if (cur === 'Products') {
    mb.innerHTML = '<div id="grid"></div>';
    gridEditor($('#grid'), { table: cur, version: g.version, rows: g.rows, canEdit: ed, blank: { active: 'Y' }, onSaved: async function () { S.init = await call('init'); }, cols: [{ k: 'product', l: 'Product' }, { k: 'description', l: 'Description' }, { k: 'active', l: 'Active', t: 'select', o: function () { return ['Y', 'N']; } }] });
  } else {
    mb.innerHTML = '<div class="hint">Which ERP storage types count as usable stock, and which belong to the production supply area (PSA, area name from Settings). Storage types that are not listed count as usable.</div><div id="grid"></div>';
    gridEditor($('#grid'), { table: cur, version: g.version, rows: g.rows, canEdit: ed, blank: { usable: 'Y' }, cols: [{ k: 'type', l: 'Storage type' }, { k: 'usable', l: 'Usable', t: 'select', o: function () { return ['Y', 'N']; } }, { k: 'area', l: 'Area (e.g. PSA, Warehouse)' }, { k: 'comment', l: 'Comment' }] });
  }
}

/* ============================== admin ============================== */
async function viewAdmin(el) {
  var cur = S.sub.admin || 'users';
  var tabs = [['users', 'Users'], ['sites', 'Sites'], ['steps', 'Process steps'], ['settings', 'Settings'], ['integrations', 'Integrations'], ['reset', 'Reset data'], ['audit', 'Audit log']];
  el.innerHTML = '<div class="card"><h2>Administration</h2><div class="sub">' + tabs.map(function (t) { return '<button data-s="' + t[0] + '" class="' + (cur === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div><div id="ab"><span class="spin"></span></div></div>';
  el.querySelectorAll('.sub button').forEach(function (b) { b.onclick = function () { S.sub.admin = b.dataset.s; viewAdmin(el); }; });
  var ab = $('#ab');
  if (cur === 'users') {
    var users = await call('users');
    ab.innerHTML = '<p class="muted small">' + users.filter(function (u) { return u.status !== 'disabled'; }).length + ' of ' + S.init.maxUsers + ' user places used. <b>viewer</b> can calculate; <b>planner</b> can also confirm and complete batches; <b>editor</b> can also import and edit master data; <b>admin</b> manages users and settings.</p>' +
      table([{ h: 'Name', k: 'name' }, { h: 'E-mail', k: 'email' }, { h: 'Role', f: function (u, i) { return '<select data-role="' + i + '">' + opt(['viewer', 'planner', 'editor', 'admin'], u.role) + '</select>'; } },
        { h: 'Status', f: function (u) { return pill(u.status === 'active' ? 'OK' : (u.status === 'pending' ? 'PREPARE' : 'BLOCKED'), u.status); } }, { h: 'Last login', f: function (u) { return esc(fmtTs(u.lastLogin)); } },
        { h: '', f: function (u, i) { return (u.status === 'pending' ? '<button class="btn sm" data-a="approve" data-i="' + i + '">Approve</button> ' : '') + (u.status === 'disabled' ? '<button class="btn ghost sm" data-a="enable" data-i="' + i + '">Enable</button> ' : (u.status === 'active' ? '<button class="btn ghost sm" data-a="disable" data-i="' + i + '">Disable</button> ' : '')) + '<button class="btn ghost sm" data-a="resetPassword" data-i="' + i + '">Reset password</button> <button class="btn danger sm" data-a="delete" data-i="' + i + '">Delete</button>'; } }], users);
    function act(a, u, extra) { return call('userAdmin', Object.assign({ email: u.email, action: a }, extra || {})).then(function () { toast('Done.'); viewAdmin(el); }).catch(function (e) { toast(e.message, true); }); }
    ab.querySelectorAll('[data-role]').forEach(function (s) { s.onchange = function () { act('role', users[+s.dataset.role], { role: s.value }); }; });
    ab.querySelectorAll('[data-a]').forEach(function (b) {
      b.onclick = function () {
        var u = users[+b.dataset.i], a = b.dataset.a;
        if (a === 'delete') { if (confirm('Delete ' + u.email + '?')) act('delete', u); }
        else if (a === 'resetPassword') { var pw = prompt('New temporary password for ' + u.email + ' (at least 10 characters):'); if (pw) act('resetPassword', u, { password: pw }); }
        else act(a, u, a === 'approve' ? { role: (ab.querySelector('[data-role="' + b.dataset.i + '"]') || {}).value } : {});
      };
    });
  } else if (cur === 'sites' || cur === 'steps') {
    var tn = cur === 'sites' ? 'Sites' : 'Steps', g = await call('tableGet', { table: tn });
    ab.innerHTML = (cur === 'sites' ? '<div class="hint">Add a row to add a site. The ID is used in all imports and cannot be changed later without re-importing. Set Active to N to hide a site.</div>' : '<div class="hint">Process steps in their production order. Occupancy days = how long a batch blocks exclusive equipment. Output available after = days after the batch start when its product is available for the next step.</div>') + '<div id="grid"></div>';
    gridEditor($('#grid'), { table: tn, version: g.version, rows: g.rows, canEdit: true, blank: { active: 'Y' }, onSaved: async function () { S.init = await call('init'); },
      cols: cur === 'sites' ? [{ k: 'id', l: 'Site ID' }, { k: 'name', l: 'Name' }, { k: 'erpLocation', l: 'ERP storage location (info)' }, { k: 'active', l: 'Active', t: 'select', o: function () { return ['Y', 'N']; } }]
        : [{ k: 'step', l: 'Step' }, { k: 'code', l: 'Short code' }, { k: 'occupancyDays', l: 'Occupancy days', t: 'number' }, { k: 'outputAvailDays', l: 'Output available after (days)', t: 'number' }, { k: 'active', l: 'Active', t: 'select', o: function () { return ['Y', 'N']; } }] });
  } else if (cur === 'integrations') {
    await renderIntegrations(ab);
  } else if (cur === 'reset') {
    ab.innerHTML = '<div class="hint">Use this after testing, to start the day-to-day data from zero. <b>Not touched:</b> users, sites, steps, settings, products, requirements, recipes, imported stock, documents, equipment and bio inventory. This cannot be undone (ask your server administrator for a backup first if unsure).</div>' +
      '<div style="margin:12px 0"><label style="display:block;margin:6px 0"><input type="checkbox" id="rs_c" checked> Confirmed and released batches</label>' +
      '<label style="display:block;margin:6px 0"><input type="checkbox" id="rs_b" checked> Bulk storage lots</label>' +
      '<label style="display:block;margin:6px 0"><input type="checkbox" id="rs_r" checked> Production report (archive)</label></div>' +
      '<div class="row"><label class="f">Type RESET to confirm<input id="rs_t" autocomplete="off" style="width:160px"></label><button class="btn" id="rs_go" style="background:var(--bad)">Delete selected data</button></div>';
    $('#rs_go').onclick = function () { var b = this; run(b, async function () {
      var r = await call('resetOps', { confirmed: $('#rs_c').checked, bulk: $('#rs_b').checked, report: $('#rs_r').checked, confirm: $('#rs_t').value.trim() });
      toast(r.done.join(' | ')); $('#rs_t').value = ''; S.plan = null; S.init = await call('init');
    }); };
  } else if (cur === 'settings') {
    var rows = await call('settingsGet');
    ab.innerHTML = '<div class="hint">Lists use ; as separator. Changes apply to the next calculation.</div><div id="grid"></div>';
    // settings have their own save action, so draw a small custom editor
    var h = '<div class="tablewrap"><table><thead><tr><th>Setting</th><th>Value</th><th>Meaning</th></tr></thead><tbody>' + rows.map(function (r, i) { return '<tr><td><b>' + esc(r.key) + '</b></td><td><input data-i="' + i + '" value="' + esc(r.value) + '"></td><td class="muted">' + esc(r.description) + '</td></tr>'; }).join('') + '</tbody></table></div><p><button class="btn" id="ssave">Save settings</button></p>';
    $('#grid').innerHTML = h;
    $('#ssave').onclick = function () { run($('#ssave'), async function () { $('#grid').querySelectorAll('input').forEach(function (i) { rows[+i.dataset.i].value = i.value; }); await call('settingsSave', { rows: rows }); S.init = await call('init'); toast('Settings saved.'); }); };
  } else {
    var log = await call('audit');
    ab.innerHTML = '<p class="muted small">Last 300 actions.</p>' + table([{ h: 'Time', f: function (r) { return esc(fmtTs(r.time)); }, nw: 1 }, { h: 'User', k: 'user' }, { h: 'Action', k: 'action' }, { h: 'Detail', k: 'detail' }], log, { maxh: 560 });
  }
}

/* ---- Admin > Integrations: API keys, connector runs, webhook ---- */
async function renderIntegrations(ab, newKey) {
  var keys = await call('apiKeyList'), runs = await call('integrationRuns'), set = await call('settingsGet');
  var setRows = set.rows || set;
  function sv(k) { var r = setRows.filter(function (x) { return x.key === k; })[0]; return r ? r.value : ''; }
  ab.innerHTML =
    '<div class="hint">Other systems (SAP, a data warehouse, scripts) send data to <code>/integration/v1/...</code> with an API key, and receive events through a webhook. See docs/SAP_INTEGRATION.md. A <b>writer</b> key can load data; a <b>reader</b> key can only read results.</div>' +
    '<h3 style="margin:14px 0 6px">API keys</h3>' +
    '<div class="row"><label class="f">Name<input id="kname" maxlength="60" placeholder="e.g. SAP nightly export"></label><label class="f">Access<select id="krole"><option value="writer">writer (load data)</option><option value="reader">reader (read only)</option></select></label><button class="btn" id="kadd">Create key</button></div>' +
    '<div id="knew">' + (newKey ? '<div class="hint" style="margin-top:10px"><b>Copy this key now - it is shown only once:</b><br><code id="kval" style="user-select:all;word-break:break-all">' + esc(newKey) + '</code></div>' : '') + '</div>' +
    table([{ h: 'Name', k: 'name' }, { h: 'Key starts with', k: 'prefix' }, { h: 'Access', k: 'role' }, { h: 'Status', k: 'status' }, { h: 'Last used', f: function (k) { return esc(fmtTs(k.lastUsed)); }, nw: 1 },
      { h: '', f: function (k, i) { return k.status === 'active' ? '<button class="btn ghost sm" data-rv="' + i + '">Revoke</button>' : ''; } }], keys, { maxh: 260 }) +
    '<h3 style="margin:18px 0 6px">Webhook</h3>' +
    '<div class="row"><label class="f grow">URL (https://...)<input id="whurl" value="' + esc(sv('webhookUrl')) + '"></label><label class="f">Secret (signs each call)<input id="whsec" type="password" autocomplete="off" value="' + esc(sv('webhookSecret')) + '"></label><label class="f">Events (empty = all)<input id="whev" placeholder="campaign.confirmed" value="' + esc(sv('webhookEvents')) + '"></label><button class="btn" id="whsave">Save</button></div>' +
    '<h3 style="margin:18px 0 6px">Recent integration runs</h3>' +
    table([{ h: 'Time', f: function (r) { return esc(fmtTs(r.time)); }, nw: 1 }, { h: 'Source', k: 'source' }, { h: 'Site', k: 'site' }, { h: 'Result', k: 'status' }, { h: 'Rows', k: 'rows' }, { h: 'Message', k: 'message' }], runs, { maxh: 320 });
  $('#kadd').onclick = function () { run($('#kadd'), async function () {
    var r = await call('apiKeyCreate', { name: $('#kname').value, role: $('#krole').value });
    toast('Key created.');
    return renderIntegrations(ab, r.key);
  }); };
  ab.querySelectorAll('[data-rv]').forEach(function (b) { b.onclick = function () { if (!confirm('Revoke this key? Systems using it stop working immediately.')) return; run(b, async function () { await call('apiKeyRevoke', { id: keys[+b.dataset.rv].id }); toast('Key revoked.'); viewAdmin($('#view') || ab.closest('main') || document.body); }); }; });
  $('#whsave').onclick = function () { run($('#whsave'), async function () {
    var m = { webhookUrl: $('#whurl').value.trim(), webhookSecret: $('#whsec').value, webhookEvents: $('#whev').value.trim() };
    setRows.forEach(function (r) { if (r.key in m) r.value = m[r.key]; });
    await call('settingsSave', { rows: setRows }); toast('Webhook settings saved.');
  }); };
}

/* remember the open tab (and its sub tab) over a browser refresh: URL hash + session storage */
function restoreView() {
  function apply(v, sb) {
    try {
      if (v && VIEWS.some(function (x) { return x.id === v && can(x.role); })) S.view = v;
      if (sb) { var o = typeof sb === 'string' ? JSON.parse(sb) : sb; if (o && typeof o === 'object') S.sub = o; }
    } catch (e) { /* ignore */ }
  }
  apply(store('view'), store('sub'));
  var h = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  if (h.get('v')) apply(h.get('v'), h.get('s'));
}
function rememberView() {
  if (!S.token) return;
  var sub = JSON.stringify(S.sub || {});
  store('view', S.view); store('sub', sub);
  try { history.replaceState(null, '', '#v=' + encodeURIComponent(S.view) + '&s=' + encodeURIComponent(sub)); } catch (e) { /* ignore */ }
}
document.addEventListener('click', function () { setTimeout(rememberView, 0); }, true);
document.addEventListener('change', function () { setTimeout(rememberView, 0); }, true);
window.addEventListener('pagehide', rememberView);
boot();
