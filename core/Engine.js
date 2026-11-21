/**
 * Engine.js - the readiness logic. Pure JavaScript: no platform services are used here,
 * so it can be tested and reused anywhere (Node, browser).
 *
 * Input  : db     = { sites, steps, settings, storageTypes, products, requirements, recipes,
 *                     stock, documents, equipment, holds, bio, confirmed, bulk, meta }
 *          params = { product, step ('All' or a step name), site, n, from, to, stepOffset }
 *          today  = 'yyyy-mm-dd'
 * Output : { batches:[{... lines:[...]}], recommendations, prepList, warnings }
 */

/* ---------- small helpers ---------- */
function eng_norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
function eng_num(v, d) {
  if (v === null || v === undefined || v === '') return d === undefined ? 0 : d;
  var n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return isFinite(n) ? n : (d === undefined ? 0 : d);
}
function eng_list(s) {
  return String(s == null ? '' : s).split(/[;|]/).map(eng_norm).filter(function (x) { return x; });
}
function eng_yes(v, dflt) {
  var s = eng_norm(v);
  if (s === '') return dflt === undefined ? false : dflt;
  return s === 'y' || s === 'yes' || s === 'true' || s === '1' || s === 'ja';
}
function eng_day(s) {
  if (s === null || s === undefined || s === '') return null;
  if (typeof s === 'number') return Math.floor(s);
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) return null;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
}
function eng_iso(d) {
  if (d === null || d === undefined) return '';
  return new Date(d * 86400000).toISOString().slice(0, 10);
}
function eng_round(x) { return Math.round(x * 1e6) / 1e6; }

/* ---------- configuration ---------- */
function eng_cfg(db) {
  var S = db.settings || {};
  var occ = {}, outDays = {}, order = [], code = {};
  (db.steps || []).forEach(function (st) {
    if (!eng_yes(st.active, true)) return;
    var k = eng_norm(st.step);
    order.push(st.step);
    occ[k] = eng_num(st.occupancyDays, 3);
    outDays[k] = eng_num(st.outputAvailDays, 0);
    code[k] = String(st.code || st.step).trim();
  });
  var types = {};
  (db.storageTypes || []).forEach(function (t) {
    types[eng_norm(t.type)] = { usable: eng_yes(t.usable, true), area: String(t.area || '').trim() };
  });
  return {
    acceptDoc: eng_list(S.acceptedDocStatuses), acceptEq: eng_list(S.acceptedEquipmentStatuses),
    acceptBio: eng_list(S.acceptedBioStatuses), acceptBulk: eng_list(S.acceptedBulkStatuses),
    acceptCat: eng_list(S.acceptedStockCategories),
    buffer: eng_num(S.equipmentBufferDays, 14), maxAge: eng_num(S.exportMaxAgeDays, 3),
    psaArea: eng_norm(S.psaAreaName || 'PSA'),
    sampleFree: eng_list(S.productionUsedFor || 'Production'),
    occ: occ, outDays: outDays, stepOrder: order, stepCode: code, storageTypes: types
  };
}

/* ---------- indexes ---------- */
function eng_index(db, cfg) {
  var ix = { req: {}, stock: {}, bulk: {}, bio: {}, docs: {}, eq: {}, holds: {}, rec: {}, units: {} };
  (db.requirements || []).forEach(function (r) {
    if (!r.product || !r.step) return;
    var k = eng_norm(r.product) + '|' + eng_norm(r.step);
    (ix.req[k] = ix.req[k] || []).push(r);
  });
  (db.stock || []).forEach(function (r) {
    var item = eng_norm(r.material);
    if (!item) return;
    var site = eng_norm(r.site);
    var cat = eng_norm(r.stockCategory);
    var t = cfg.storageTypes[eng_norm(r.storageType)] || { usable: true, area: '' };
    var uk = site + '|' + item;
    (ix.units[uk] = ix.units[uk] || {})[eng_norm(r.unit)] = r.unit;
    (ix.units['*|' + item] = ix.units['*|' + item] || {})[eng_norm(r.unit)] = r.unit;
    if (cfg.acceptCat.length && cfg.acceptCat.indexOf(cat) < 0) return;
    if (!t.usable) return;
    (ix.stock[uk] = ix.stock[uk] || []).push({
      qty: eng_num(r.qty), exp: eng_day(r.expiry), psa: eng_norm(t.area) === cfg.psaArea, unit: r.unit
    });
  });
  (db.bulk || []).forEach(function (r) {
    if (eng_yes(r.bookedInErp)) return;
    if (cfg.acceptBulk.length && cfg.acceptBulk.indexOf(eng_norm(r.status)) < 0) return;
    var k = eng_norm(r.site) + '|' + eng_norm(r.itemId);
    (ix.bulk[k] = ix.bulk[k] || []).push({ qty: eng_num(r.qty), exp: eng_day(r.expiry), unit: r.unit });
  });
  (db.bio || []).forEach(function (r) {
    if (cfg.acceptBio.length && cfg.acceptBio.indexOf(eng_norm(r.status)) < 0) return;
    var k = eng_norm(r.site) + '|' + eng_norm(r.itemId);
    (ix.bio[k] = ix.bio[k] || []).push({ qty: eng_num(r.qty), exp: eng_day(r.expiry) });
  });
  (db.documents || []).forEach(function (r) {
    var k = eng_norm(r.docId);
    if (k) (ix.docs[k] = ix.docs[k] || []).push(r);
  });
  (db.equipment || []).forEach(function (r) {
    var k = eng_norm(r.equipId);
    if (k) (ix.eq[k] = ix.eq[k] || []).push(r);
  });
  (db.holds || []).forEach(function (r) {
    var k = eng_norm(r.equipId);
    var a = eng_day(r.from), b = eng_day(r.until);
    if (k && a !== null && b !== null) (ix.holds[k] = ix.holds[k] || []).push({ from: a, until: b, reason: r.reason });
  });
  (db.recipes || []).forEach(function (r) {
    var k = eng_norm(r.parentId);
    if (k) (ix.rec[k] = ix.rec[k] || []).push(r);
  });
  return ix;
}

/* ---------- confirmed batches that still reserve ---------- */
function eng_reservingConfirmed(db) {
  var out = [];
  (db.confirmed || []).forEach(function (c) {
    var st = eng_norm(c.status);
    if (st === 'cancelled' || eng_yes(c.archived)) return;
    if (st === 'produced' && eng_yes(c.erpUpdated)) {
      // released when an ERP stock export was loaded AFTER the user confirmed the booking in the ERP
      var loadTs = db.meta ? String(db.meta['stock:' + c.site] || '') : '';
      if (c.completedAt) { if (loadTs && loadTs > String(c.completedAt)) return; }
      else {
        var load = eng_day(loadTs.slice(0, 10)), booked = eng_day(c.bookingDate);
        if (load !== null && booked !== null && load >= booked) return;
      }
    }
    out.push(c);
  });
  return out;
}

/* ---------- build batch sequence ---------- */
function eng_batches(db, params, cfg) {
  var all = [];
  eng_reservingConfirmed(db).forEach(function (c) {
    all.push({
      id: c.id, product: c.product, step: c.step, site: c.site, start: eng_day(c.start),
      group: 0, confirmed: true, produced: eng_norm(c.status) === 'produced'
    });
  });
  all.sort(function (a, b) { return (a.start - b.start) || String(a.id).localeCompare(String(b.id)); });

  var planned = [];
  if (params && params.product && params.site) {
    var n = Math.max(1, Math.min(50, parseInt(params.n, 10) || 1));
    var from = eng_day(params.from), to = eng_day(params.to);
    if (from === null) throw new Error('Start date missing');
    if (to === null || to < from) to = from;
    var steps = (params.step && params.step !== 'All') ? [params.step] : cfg.stepOrder.slice();
    var offset = eng_num(params.stepOffset, 7);
    var seen = {};
    for (var i = 0; i < n; i++) {
      var base = n === 1 ? from : from + Math.round((to - from) * i / (n - 1));
      for (var k = 0; k < steps.length; k++) {
        var code = cfg.stepCode[eng_norm(steps[k])] || steps[k];
        var start = base + (params.step === 'All' || !params.step ? k * offset : 0);
        var id = params.product + ' ' + code + ' ' + eng_iso(start);
        if (seen[id]) { seen[id]++; id += ' #' + seen[id]; } else { seen[id] = 1; }
        planned.push({ id: id, product: params.product, step: steps[k], site: params.site, start: start, group: 1, seq: i + 1 });
      }
    }
    planned.sort(function (a, b) { return (a.start - b.start) || String(a.id).localeCompare(String(b.id)); });
  }
  return all.concat(planned);
}

/* ---------- stock lookup ---------- */
function eng_usable(ix, site, item, day, outputs) {
  var key = eng_norm(site) + '|' + eng_norm(item), total = 0, psa = 0;
  (ix.stock[key] || []).forEach(function (r) {
    if (r.exp !== null && r.exp < day) return;
    total += r.qty; if (r.psa) psa += r.qty;
  });
  (ix.bulk[key] || []).forEach(function (r) {
    if (r.exp !== null && r.exp < day) return;
    total += r.qty;
  });
  outputs.forEach(function (o) {
    if (o.key === key && o.avail <= day) total += o.qty;
  });
  return { total: total, psa: psa };
}
function eng_unitProblem(ix, site, item, unit) {
  var u = ix.units[eng_norm(site) + '|' + eng_norm(item)] || ix.units['*|' + eng_norm(item)];
  if (!u) return null;
  if (u[eng_norm(unit)]) return null;
  return Object.keys(u).map(function (k) { return u[k]; }).join('/');
}

/* ---------- main ---------- */
function eng_run(db, params, today) {
  var cfg = eng_cfg(db), ix = eng_index(db, cfg);
  var siteList = (db.sites || []).filter(function (s) { return eng_yes(s.active, true); });
  var siteName = {}; siteList.forEach(function (s) { siteName[eng_norm(s.id)] = s.name || s.id; });
  var batches = eng_batches(db, params, cfg);
  var cum = {}, cumPsa = {}, outputs = [], equipUse = {}, prepAgg = {};

  function otherBest(site, item, day, need) {
    var best = { avail: 0, site: '' };
    siteList.forEach(function (s) {
      if (eng_norm(s.id) === eng_norm(site)) return;
      var u = eng_usable(ix, s.id, item, day, outputs);
      var a = u.total - (cum[eng_norm(s.id) + '|' + eng_norm(item)] || 0);
      if (a > best.avail) best = { avail: a, site: s.id };
    });
    return best;
  }

  /* checks one material-like quantity; returns {short, status, ...} and updates the reservation maps */
  function checkQty(site, item, unit, need, day, withUnit) {
    var key = eng_norm(site) + '|' + eng_norm(item);
    var u = eng_usable(ix, site, item, day, outputs);
    var before = cum[key] || 0;
    cum[key] = before + need;
    var avail = u.total - before;
    var short = Math.max(0, Math.min(need, before + need - u.total));
    var res = { avail: eng_round(Math.max(0, avail)), before: eng_round(before), short: eng_round(short), status: 'OK', psaReady: 0 };
    var bad = withUnit ? eng_unitProblem(ix, site, item, unit) : null;
    if (bad) { res.status = 'UNIT MISMATCH'; res.note = 'Requirement unit ' + unit + ' but ERP stock unit ' + bad; return res; }
    var psaBefore = cumPsa[key] || 0;
    res.psaReady = eng_round(Math.max(0, Math.min(need - short, u.psa - psaBefore)));
    cumPsa[key] = psaBefore + res.psaReady;
    if (short > 1e-9) {
      var ob = otherBest(site, item, day, short);
      res.otherAvail = eng_round(ob.avail); res.otherSite = ob.site;
      if (ob.avail + 1e-9 >= short) {
        res.status = 'TRANSFER'; res.transferFrom = ob.site;
        var ok = eng_norm(ob.site) + '|' + eng_norm(item);
        cum[ok] = (cum[ok] || 0) + short;
        res.note = 'Take over ' + eng_round(short) + ' ' + unit + ' from ' + (siteName[eng_norm(ob.site)] || ob.site);
      } else {
        res.status = 'MISSING';
        res.note = 'Short by ' + eng_round(short) + ' ' + unit + (ob.avail > 0 ? ' (other sites only have ' + eng_round(ob.avail) + ')' : ' (no other site has it)');
      }
    }
    return res;
  }

  function doPrep(line, site, day, batch) {
    var recipe = ix.rec[eng_norm(line.item)];
    if (!recipe || !recipe.length) { line.status = 'NO RECIPE'; line.note = 'In-house item without recipe'; return; }
    var yieldQ = eng_num(recipe[0].yield), yUnit = recipe[0].yieldUnit;
    if (yieldQ <= 0) { line.status = 'NO YIELD'; line.note = 'Recipe has no yield'; return; }
    if (eng_norm(yUnit) !== eng_norm(line.unit)) { line.status = 'UNIT MISMATCH'; line.note = 'Recipe yield unit ' + yUnit + ' differs from requirement unit ' + line.unit; return; }
    var preps = Math.ceil(line.short / yieldQ - 1e-9);
    var comps = [], bad = false;
    recipe.forEach(function (c) {
      if (!c.componentId) return;
      var need = eng_round(preps * eng_num(c.qty));
      var r = checkQty(site, c.componentId, c.unit, need, day, true);
      var cs = r.status;
      if (cs === 'MISSING' || cs === 'UNIT MISMATCH') bad = true;
      comps.push({ item: c.componentId, desc: c.componentDesc, need: need, unit: c.unit, short: r.short, status: cs, note: r.note || '', from: r.transferFrom || '' });
    });
    line.prep = { preparations: preps, yield: yieldQ, unit: yUnit, produced: eng_round(preps * yieldQ), components: comps };
    line.status = bad ? 'PREP: COMPONENT MISSING' : 'PREPARE';
    line.note = preps + ' preparation(s) of ' + yieldQ + ' ' + yUnit + (bad ? ' - component missing' : '');
    var pk = eng_norm(site) + '|' + eng_norm(line.item);
    var agg = prepAgg[pk] = prepAgg[pk] || { site: site, item: line.item, desc: line.desc, unit: yUnit, preparations: 0, yield: yieldQ, batches: [], blocked: false };
    agg.preparations += preps; agg.batches.push(batch.id); if (bad) agg.blocked = true;
  }

  var out = { batches: [], recommendations: [], prepList: [], warnings: [], config: { buffer: cfg.buffer } };
  var recAgg = {};

  batches.forEach(function (b) {
    var lines = ix.req[eng_norm(b.product) + '|' + eng_norm(b.step)] || [];
    var occ = cfg.occ[eng_norm(b.step)];
    if (occ === undefined) occ = 3;
    var wStart = b.start, wEnd = b.start + occ;
    var res = [];
    lines.forEach(function (r, i) {
      var type = eng_norm(r.type);
      var L = {
        n: i + 1, type: r.type, usedFor: r.usedFor || '', item: String(r.itemId), desc: r.description || '',
        qty: eng_num(r.qty, 0), unit: r.unit || '', flag: eng_yes(r.flag) ? 'Y' : 'N', status: 'OK', note: '',
        sample: cfg.sampleFree.indexOf(eng_norm(r.usedFor || 'production')) < 0 && eng_norm(r.usedFor) !== ''
      };
      {
        if (type === 'material') {
          var q = checkQty(b.site, L.item, L.unit, L.qty, b.start, true);
          L.status = q.status; L.avail = q.avail; L.before = q.before; L.short = q.short; L.note = q.note || '';
          L.transferFrom = q.transferFrom || ''; L.otherAvail = q.otherAvail || 0; L.psaReady = q.psaReady;
          L.toBook = (q.status === 'OK') ? eng_round(L.qty - q.psaReady) : 0;
          if (q.short > 1e-9 && q.status !== 'UNIT MISMATCH' && L.flag === 'Y') {
            // in-house prepared: undo the shortage reservation of the finished item (it is made, not taken)
            if (q.status === 'TRANSFER') { var ok = eng_norm(q.transferFrom) + '|' + eng_norm(L.item); cum[ok] -= q.short; }
            cum[eng_norm(b.site) + '|' + eng_norm(L.item)] -= q.short; // the missing part is made, not taken from stock
            L.status = 'OK'; L.note = '';
            doPrep(L, b.site, b.start, b);
            L.toBook = 0;
          }
        } else if (type === 'biological') {
          var key = eng_norm(b.site) + '|' + eng_norm(L.item), tot = 0;
          (ix.bio[key] || []).forEach(function (x) { if (x.exp === null || x.exp >= b.start) tot += x.qty; });
          var before = cum['B|' + key] || 0; cum['B|' + key] = before + L.qty;
          var short = Math.max(0, Math.min(L.qty, before + L.qty - tot));
          L.avail = eng_round(Math.max(0, tot - before)); L.before = eng_round(before); L.short = eng_round(short);
          if (short > 1e-9) {
            var best = { avail: 0, site: '' };
            siteList.forEach(function (s) {
              if (eng_norm(s.id) === eng_norm(b.site)) return;
              var k2 = eng_norm(s.id) + '|' + eng_norm(L.item), t2 = 0;
              (ix.bio[k2] || []).forEach(function (x) { if (x.exp === null || x.exp >= b.start) t2 += x.qty; });
              var a2 = t2 - (cum['B|' + k2] || 0);
              if (a2 > best.avail) best = { avail: a2, site: s.id };
            });
            L.otherAvail = eng_round(best.avail);
            if (best.avail + 1e-9 >= short) {
              L.status = 'TRANSFER'; L.transferFrom = best.site;
              cum['B|' + eng_norm(best.site) + '|' + eng_norm(L.item)] = (cum['B|' + eng_norm(best.site) + '|' + eng_norm(L.item)] || 0) + short;
              L.note = 'Take over ' + eng_round(short) + ' from ' + (siteName[eng_norm(best.site)] || best.site);
            } else { L.status = 'MISSING'; L.note = 'Short by ' + eng_round(short); }
          }
        } else if (type === 'document') {
          var rows = ix.docs[eng_norm(L.item)];
          if (!rows) { L.status = 'NOT IN LIST'; L.note = 'Document not in the document list'; }
          else {
            var okRow = null;
            rows.forEach(function (d) { if (cfg.acceptDoc.indexOf(eng_norm(d.status)) >= 0 && (!okRow || String(d.version) > String(okRow.version))) okRow = d; });
            if (!okRow) { L.status = 'NOT EFFECTIVE'; L.note = 'Status "' + rows[0].status + '" (v' + rows[0].version + ')'; }
            else {
              var effFrom = eng_day(okRow.effectiveDue);
              L.note = 'v' + okRow.version + ' ' + okRow.status;
              if (effFrom !== null && effFrom > b.start) { L.status = 'NOT EFFECTIVE'; L.note += ' - effective only from ' + okRow.effectiveDue + ' (after start)'; }
            }
          }
        } else if (type === 'equipment') {
          var eqRows = ix.eq[eng_norm(L.item)];
          if (!eqRows) { L.status = 'NOT IN LIST'; L.note = 'Equipment not in the equipment list'; }
          else {
            var e = eqRows[0];
            var dueE = eng_day(e.due);
            if (cfg.acceptEq.indexOf(eng_norm(e.status)) < 0) { L.status = 'NOT RELEASED / DUE'; L.note = 'Status "' + e.status + '"'; }
            else if (dueE !== null && dueE < b.start + cfg.buffer) { L.status = 'NOT RELEASED / DUE'; L.note = 'Due ' + e.due + ' (needs ' + cfg.buffer + ' days buffer after start)'; }
            else {
              L.note = e.status + (e.due ? ', due ' + e.due : '');
              var hit = (ix.holds[eng_norm(L.item)] || []).filter(function (h) { return wStart < h.until + 1 && h.from < wEnd; })[0];
              if (hit) { L.status = 'EQUIPMENT BUSY'; L.note = 'On hold ' + eng_iso(hit.from) + ' to ' + eng_iso(hit.until) + (hit.reason ? ' (' + hit.reason + ')' : ''); }
              else if (L.flag === 'Y') {
                var clash = (equipUse[eng_norm(L.item)] || []).filter(function (u) { return wStart < u.end && u.start < wEnd; })[0];
                if (clash) { L.status = 'EQUIPMENT BUSY'; L.note = 'Occupied by ' + clash.batch + ' (' + eng_iso(clash.start) + ' to ' + eng_iso(clash.end - 1) + ')'; }
              }
            }
            L.holdFrom = '';
          }
          (equipUse[eng_norm(L.item)] = equipUse[eng_norm(L.item)] || []).push({ start: wStart, end: wEnd, batch: b.id });
        } else if (type === 'output') {
          L.status = 'OUTPUT';
          var avail = b.start + (cfg.outDays[eng_norm(b.step)] || 0);
          L.note = 'Expected ' + L.qty + ' ' + L.unit + ' available ' + eng_iso(avail);
          if (!b.produced) outputs.push({ key: eng_norm(b.site) + '|' + eng_norm(L.item), qty: L.qty, avail: avail });
        } else {
          L.status = 'CHECK TYPE'; L.note = 'Unknown type "' + r.type + '"';
        }
      }
      res.push(L);
    });

    // summary
    var S = { lines: res.length, material: 0, docs: 0, equipment: 0, sample: 0, prepare: 0, transfer: 0, psa: 0, eqIds: [] };
    res.forEach(function (L) {
      var t = eng_norm(L.type);
      var blocking = ['MISSING', 'UNIT MISMATCH', 'PREP: COMPONENT MISSING', 'NO RECIPE', 'NO YIELD', 'CHECK TYPE'].indexOf(L.status) >= 0;
      if ((t === 'material' || t === 'biological') && blocking) S.material++;
      if (t === 'document' && L.status !== 'OK') S.docs++;
      if (t === 'equipment' && L.status !== 'OK') { S.equipment++; S.eqIds.push(L.item); }
      if (L.sample && L.status !== 'OK' && L.status !== 'OUTPUT') S.sample++;
      if (L.status === 'PREPARE' || L.status === 'PREP: COMPONENT MISSING') S.prepare++;
      if (L.status === 'TRANSFER' || (L.prep && L.prep.components.some(function (c) { return c.status === 'TRANSFER'; }))) S.transfer++;
      if (L.toBook > 1e-9) S.psa++;
    });
    var result = S.lines === 0 ? 'NO REQUIREMENTS' : ((S.material + S.docs + S.equipment) > 0 ? 'BLOCKED' : 'READY');
    var next;
    if (result === 'NO REQUIREMENTS') next = 'Add requirements for this product and step';
    else if (result === 'BLOCKED') {
      var parts = [];
      if (S.material) parts.push('Materials/biological: ' + S.material);
      if (S.docs) parts.push('Documents: ' + S.docs);
      if (S.equipment) parts.push('Equipment: ' + S.equipment + ' (' + S.eqIds.join(', ') + ')');
      next = 'BLOCKED - ' + parts.join('; ');
    } else if (S.transfer) next = 'Ready - arrange take-over from other site';
    else if (S.psa) next = 'Ready - book material into PSA';
    else next = 'Ready for production';

    res.forEach(function (L) {
      if (b.confirmed) return;
      if (['OK', 'OUTPUT'].indexOf(L.status) >= 0) return;
      var t = eng_norm(L.type);
      if (t !== 'material' && t !== 'biological') return;
      var k = eng_norm(b.site) + '|' + eng_norm(L.item) + '|' + L.status;
      var a = recAgg[k] = recAgg[k] || { site: b.site, item: L.item, desc: L.desc, unit: L.unit, status: L.status, short: 0, from: L.transferFrom || '', other: L.otherAvail || 0, notes: {}, batches: [] };
      a.short += L.short || 0; a.batches.push(b.id); if (L.note) a.notes[L.note] = 1;
    });

    out.batches.push({
      id: b.id, product: b.product, step: b.step, site: b.site, start: eng_iso(b.start), end: eng_iso(wEnd - 1),
      group: b.group, confirmed: !!b.confirmed, produced: !!b.produced,
      summary: S, result: result, next: next, lines: res
    });
  });

  Object.keys(recAgg).forEach(function (k) {
    var a = recAgg[k], text;
    if (a.status === 'TRANSFER') text = 'Take over ' + eng_round(a.short) + ' ' + a.unit + ' from ' + (siteName[eng_norm(a.from)] || a.from);
    else if (a.status === 'MISSING') text = 'Not enough at any site - order / reduce campaign' + (a.other > 0 ? ' (other sites hold ' + a.other + ' ' + a.unit + ')' : '');
    else if (a.status === 'UNIT MISMATCH') text = Object.keys(a.notes)[0] || 'Check unit';
    else text = Object.keys(a.notes)[0] || a.status;
    out.recommendations.push({ site: a.site, siteName: siteName[eng_norm(a.site)] || a.site, item: a.item, desc: a.desc, unit: a.unit, status: a.status, short: eng_round(a.short), text: text, batches: a.batches.length });
  });
  Object.keys(prepAgg).forEach(function (k) { out.prepList.push(prepAgg[k]); });

  // data freshness warnings (only planned batches matter)
  if (params && params.site) {
    var load = db.meta ? db.meta['stock:' + params.site] : '';
    var td = eng_day(today);
    if (!load) out.warnings.push('No ERP stock has been imported for site ' + params.site + '.');
    else if (td !== null && td - eng_day(String(load).slice(0, 10)) > cfg.maxAge) out.warnings.push('ERP stock of ' + params.site + ' is older than ' + cfg.maxAge + ' days (' + String(load).slice(0, 10) + ').');
    ['documents', 'equipment', 'bio'].forEach(function (k) {
      if (!db.meta || !db.meta[k]) out.warnings.push('No ' + k + ' list has been imported yet.');
    });
    var f = eng_day(params.from);
    if (td !== null && f !== null && f < td) out.warnings.push('The start date is in the past.');
  }
  return out;
}
