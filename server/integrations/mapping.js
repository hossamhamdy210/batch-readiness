'use strict';
/**
 * mapping.js - turns exports from SAP or other systems into the rows the application stores.
 *  - accepts friendly names and SAP technical field names (MATNR, CHARG, MENGE, ...) in any case
 *  - parses SAP number formats ("1.234,56", "12,5", "100-") and dates (YYYYMMDD, DD.MM.YYYY, ISO, /Date(ms)/)
 *  - never guesses silently: unusable rows are skipped and reported
 */

const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

const DATASETS = {
  stock: { table: 'ErpStock', perSite: true, fields: {
    site:          { aliases: ['site', 'plant', 'werks', 'werk', 'location'], type: 's' },
    material:      { aliases: ['material', 'matnr', 'materialnumber', 'materialnr', 'materialnummer', 'itemnumber', 'itemid', 'item', 'article', 'artikel'], type: 's', required: true },
    storageBin:    { aliases: ['storagebin', 'lgpla', 'bin', 'lagerplatz'], type: 's' },
    storageType:   { aliases: ['storagetype', 'lgtyp', 'lagertyp', 'storagelocation', 'lgort', 'lagerort'], type: 's' },
    description:   { aliases: ['description', 'maktx', 'materialdescription', 'materialkurztext', 'text', 'name'], type: 's' },
    batch:         { aliases: ['batch', 'charg', 'charge', 'lot'], type: 's' },
    stockCategory: { aliases: ['stockcategory', 'category', 'bestandsart', 'insmk', 'stocktype', 'inventorystocktype'], type: 's' },
    expiry:        { aliases: ['expiry', 'expirydate', 'vfdat', 'mhd', 'shelflifeexpirationdate', 'bestbefore', 'expirationdate'], type: 'd' },
    qty:           { aliases: ['qty', 'quantity', 'menge', 'labst', 'available', 'availablequantity', 'verfuegbar', 'matlwrhsstkqtyinmatlbaseunit', 'stockquantity'], type: 'n', required: true },
    unit:          { aliases: ['unit', 'uom', 'meins', 'me', 'baseunit', 'basisme', 'materialbaseunit'], type: 's' }
  } },
  documents: { table: 'Documents', fields: {
    docId:        { aliases: ['docid', 'document', 'documentnumber', 'documentno', 'dokument', 'dokumentnummer', 'doknr', 'number', 'id'], type: 's', required: true },
    title:        { aliases: ['title', 'description', 'bezeichnung', 'dktxt', 'text', 'name'], type: 's' },
    version:      { aliases: ['version', 'vers', 'dokumentversion', 'dokvr', 'revision'], type: 's' },
    status:       { aliases: ['status', 'docstatus', 'documentstatus', 'dokumentstatus'], type: 's', required: true },
    effectiveDue: { aliases: ['effectivedue', 'effective', 'effectivefrom', 'effectivedate', 'validfrom', 'gueltigab', 'releasedate', 'due'], type: 'd' }
  } },
  equipment: { table: 'Equipment', fields: {
    equipId:     { aliases: ['equipid', 'equipment', 'equipmentid', 'equnr', 'geraet', 'assetid', 'id'], type: 's', required: true },
    description: { aliases: ['description', 'eqktx', 'bezeichnung', 'name', 'text'], type: 's' },
    status:      { aliases: ['status', 'systemstatus', 'stat'], type: 's', required: true },
    due:         { aliases: ['due', 'duedate', 'calibrationdue', 'calibrationduedate', 'nextcalibration', 'nextdue', 'validuntil', 'faellig'], type: 'd' }
  } },
  bio: { table: 'Bio', perSite: true, fields: {
    category:    { aliases: ['category', 'kategorie', 'type'], type: 's' },
    itemId:      { aliases: ['itemid', 'item', 'id', 'material', 'matnr'], type: 's', required: true },
    description: { aliases: ['description', 'text', 'name', 'bezeichnung'], type: 's' },
    lot:         { aliases: ['lot', 'batch', 'charg', 'charge'], type: 's' },
    site:        { aliases: ['site', 'plant', 'werks'], type: 's' },
    storage:     { aliases: ['storage', 'freezer', 'location', 'lagerort'], type: 's' },
    qty:         { aliases: ['qty', 'quantity', 'menge'], type: 'n', required: true },
    unit:        { aliases: ['unit', 'uom', 'meins'], type: 's' },
    status:      { aliases: ['status'], type: 's' },
    expiry:      { aliases: ['expiry', 'expirydate', 'vfdat', 'mhd'], type: 'd' }
  } }
};

function parseNumber(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v).replace(/[\s ']/g, '');
  if (s === '') return '';
  let neg = false;
  if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }          // SAP: trailing minus
  if (/^[-+]/.test(s)) { if (s[0] === '-') neg = !neg; s = s.slice(1); }
  if (!/^[0-9.,]+$/.test(s)) return null;
  const lastC = s.lastIndexOf(','), lastD = s.lastIndexOf('.');
  if (lastC >= 0 && lastD >= 0) {
    if (lastC > lastD) s = s.replace(/\./g, '').replace(',', '.');   // 1.234,56
    else s = s.replace(/,/g, '');                                    // 1,234.56
  } else if (lastC >= 0) {
    s = /^\d{1,3}(,\d{3}){2,}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');   // 1,234,567 vs 12,5
  } else if (lastD >= 0) {
    if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, '');                     // 1.234.567
  }
  const n = Number(s);
  return isFinite(n) ? (neg ? -n : n) : null;
}

function validYmd(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const pad = (n) => String(n).padStart(2, '0');
function parseDate(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (s === '' || /^0+$/.test(s) || s === '0000-00-00' || s === '00.00.0000') return '';   // SAP "no date"
  let m;
  if ((m = /^\/Date\((-?\d+)(?:[+-]\d+)?\)\/$/.exec(s))) return new Date(Number(m[1])).toISOString().slice(0, 10);   // OData v2
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return validYmd(+m[1], +m[2], +m[3]) ? m[1] + '-' + m[2] + '-' + m[3] : null;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s))) return validYmd(+m[1], +m[2], +m[3]) ? m[1] + '-' + m[2] + '-' + m[3] : null;
  if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s))) return validYmd(+m[3], +m[2], +m[1]) ? m[3] + '-' + pad(+m[2]) + '-' + pad(+m[1]) : null;
  if ((m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(s))) return validYmd(+m[1], +m[2], +m[3]) ? m[1] + '-' + m[2] + '-' + m[3] : null;
  return null;   // anything else (e.g. 03/04/2026) is ambiguous: refuse instead of guessing
}

/** Minimal RFC-4180 CSV parser (quotes, doubled quotes, CRLF). Delimiter is detected from the header line. */
function parseCsv(text, delimiter) {
  text = String(text).replace(/^﻿/, '');
  if (!delimiter) {
    const first = text.split(/\r?\n/, 1)[0] || '';
    const counts = { ';': 0, ',': 0, '\t': 0, '|': 0 };
    let inQ = false;
    for (const ch of first) { if (ch === '"') inQ = !inQ; else if (!inQ && ch in counts) counts[ch]++; }
    delimiter = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    if (!counts[delimiter]) delimiter = ',';
  }
  const rows = []; let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delimiter) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return rows;
}
function csvToRecords(text, delimiter) {
  const rows = parseCsv(text, delimiter);
  if (!rows.length) return [];
  const head = rows[0].map((h) => String(h).trim());
  return rows.slice(1).map((r) => { const o = {}; head.forEach((h, i) => { if (h) o[h] = r[i] === undefined ? '' : r[i]; }); return o; });
}

/**
 * records: array of plain objects with any header names. Returns { rows, skipped, warnings, unmapped }.
 * opts.extraAliases lets a deployment add its own column names: { material: ['zmatnr'] }.
 */
function mapRecords(dataset, records, opts = {}) {
  const def = DATASETS[dataset];
  if (!def) throw new Error('Unknown dataset ' + dataset);
  const extra = opts.extraAliases || {};
  const lookup = {};   // normalized header -> canonical field
  Object.keys(def.fields).forEach((canon) => {
    def.fields[canon].aliases.concat((extra[canon] || []).map(norm), [canon]).forEach((a) => { const k = norm(a); if (!(k in lookup)) lookup[k] = canon; });
  });
  const result = { rows: [], skipped: 0, warnings: [], unmapped: [] };
  const seenHeaders = new Set();
  const warn = (msg) => { if (result.warnings.length < 20) result.warnings.push(msg); };
  records.forEach((rec, idx) => {
    const out = {}, prio = {};
    Object.keys(rec).forEach((h) => {
      const canon = lookup[norm(h)];
      if (!canon) { if (!seenHeaders.has(h)) { seenHeaders.add(h); result.unmapped.push(h); } return; }
      const rank = def.fields[canon].aliases.indexOf(norm(h));
      if (canon in out && prio[canon] <= rank && String(out[canon]) !== '') return;   // keep the better-ranked column
      out[canon] = rec[h]; prio[canon] = rank < 0 ? 99 : rank;
    });
    const row = {}; let problem = '';
    Object.keys(def.fields).forEach((canon) => {
      if (problem) return;
      const f = def.fields[canon]; let v = out[canon];
      if (v === undefined || v === null) v = '';
      if (f.type === 'n') { const n = parseNumber(v); if (n === null) { problem = canon + ' "' + v + '" is not a number'; return; } v = n; }
      else if (f.type === 'd') { const d = parseDate(v); if (d === null) { problem = canon + ' "' + v + '" is not a recognised date'; return; } v = d; }
      else v = String(v).trim();
      if (f.required && v === '') { problem = canon + ' is empty'; return; }
      row[canon] = v;
    });
    if (problem) { result.skipped++; warn('row ' + (idx + 1) + ': ' + problem); } else result.rows.push(row);
  });
  return result;
}

module.exports = { DATASETS, norm, parseNumber, parseDate, parseCsv, csvToRecords, mapRecords };
