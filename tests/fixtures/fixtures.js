/* Test-only fixtures (invented, generic). NOT part of the app. */
/* ---------- invented fixture data (dates are relative to today) ---------- */
function fixture_add(iso, days) { return eng_iso(eng_day(iso) + days); }

function fixture_tables(today) {
  var P = function (d) { return fixture_add(today, d); };
  var T = {};
  T.Settings = default_settings_().map(function (r) { return r.key === 'usedForList' ? { key: r.key, value: 'Production;Plasmid retention;Quality control sample;Western blot;Retention sample', description: r.description } : r; });
  T.Sites = [
    { id: 'SITE-A', name: 'Site A', erpLocation: '100A', active: 'Y' },
    { id: 'SITE-B', name: 'Site B', erpLocation: '100B', active: 'Y' }
  ];
  T.Steps = [
    { step: 'Fermentation', code: 'FERM', occupancyDays: 4, outputAvailDays: 7, active: 'Y' },
    { step: 'IB preparation', code: 'IB', occupancyDays: 3, outputAvailDays: 2, active: 'Y' }
  ];
  T.StorageTypes = [
    { type: 'WH01', usable: 'Y', area: 'Warehouse', comment: 'Main warehouse' },
    { type: 'PSA1', usable: 'Y', area: 'PSA', comment: 'Production supply area' },
    { type: 'QI01', usable: 'N', area: 'Quality', comment: 'Quality inspection - not usable' }
  ];
  T.Products = [
    { product: 'PROD-A', description: 'Fixture product, 12 L fermentation + IB preparation', active: 'Y' },
    { product: 'PROD-B', description: 'Fixture product, 5 L fermentation', active: 'Y' }
  ];
  var R = [];
  function req(prod, step, usedFor, type, id, desc, qty, unit, flag) {
    R.push({ product: prod, step: step, usedFor: usedFor, type: type, itemId: id, description: desc, qty: qty, unit: unit, flag: flag, comment: '' });
  }
  var F = 'Fermentation', I = 'IB preparation', C = 'PROD-A';
  req(C, F, 'Production', 'Document', 'DOC-1001', 'Batch record fermentation', '', '', '');
  req(C, F, 'Production', 'Document', 'DOC-1002', 'Line clearance', '', '', '');
  req(C, F, 'Production', 'Document', 'DOC-1003', 'Sampling plan', '', '', '');
  req(C, F, 'Production', 'Material', '100101', 'Yeast extract', 0.8, 'KG', 'N');
  req(C, F, 'Production', 'Material', '100102', 'Sodium phosphate monobasic', 0.5, 'KG', 'N');
  req(C, F, 'Production', 'Material', '100103', 'Ammonia solution 25 %', 2.5, 'L', 'N');
  req(C, F, 'Production', 'Material', '200001', 'Feed solution (in-house stock solution)', 3, 'L', 'Y');
  req(C, F, 'Production', 'Material', '300001', 'Single-use bag 5 L', 2, 'ST', 'N');
  req(C, F, 'Production', 'Material', '300002', 'Sterile filter capsule', 1, 'ST', 'N');
  req(C, F, 'Production', 'Biological', 'WCB-FIXTURE', 'Working cell bank vial', 1, 'ST', 'N');
  req(C, F, 'Western blot', 'Biological', 'AB-PRIMARY', 'Primary antibody aliquot', 1, 'ALQ', 'N');
  req(C, F, 'Western blot', 'Biological', 'AB-SEC-RB', 'Secondary antibody aliquot', 1, 'ALQ', 'N');
  req(C, F, 'Retention sample', 'Material', '300003', 'Cryovial 2 mL', 4, 'ST', 'N');
  req(C, F, 'Production', 'Equipment', 'FERM-01', 'Fermenter 30 L', '', '', 'Y');
  req(C, F, 'Production', 'Equipment', 'LAF-01', 'Laminar flow cabinet', '', '', 'N');
  req(C, F, 'Production', 'Equipment', 'CENT-01', 'Harvest centrifuge', '', '', 'Y');
  req(C, F, 'Production', 'Equipment', 'FRZ-80-01', 'Freezer -80 C', '', '', 'N');
  req(C, F, 'Production', 'Output', '900001', 'Cell pellet FIXTURE-CYT', 3500, 'G', '');
  req(C, I, 'Production', 'Document', 'DOC-2001', 'Batch record IB preparation', '', '', '');
  req(C, I, 'Production', 'Material', '900001', 'Cell pellet FIXTURE-CYT (from fermentation)', 3500, 'G', 'N');
  req(C, I, 'Production', 'Material', '200002', 'Lysis buffer (in-house stock solution)', 10, 'L', 'Y');
  req(C, I, 'Production', 'Material', '300004', 'Depth filter', 2, 'ST', 'N');
  req(C, I, 'Production', 'Equipment', 'HOMOG-01', 'High-pressure homogenizer', '', '', 'Y');
  req(C, I, 'Production', 'Equipment', 'CENT-02', 'Floor centrifuge', '', '', 'Y');
  req(C, I, 'Production', 'Output', '900002', 'Inclusion body paste', 800, 'G', '');
  var E = 'PROD-B';
  req(E, F, 'Production', 'Document', 'DOC-3001', 'Batch record enzyme', '', '', '');
  req(E, F, 'Production', 'Material', '100101', 'Yeast extract', 0.3, 'KG', 'N');
  req(E, F, 'Production', 'Material', '100103', 'Ammonia solution 25 %', 1, 'L', 'N');
  req(E, F, 'Production', 'Equipment', 'FERM-02', 'Fermenter 10 L', '', '', 'Y');
  req(E, F, 'Production', 'Output', '900010', 'Cell pellet FIXTURE-ENZ', 900, 'G', '');
  T.Requirements = R;
  T.Recipes = [
    { parentId: '200001', parentDesc: 'Feed solution', yield: 5, yieldUnit: 'L', componentId: '100104', componentDesc: 'Glucose monohydrate', qty: 1.2, unit: 'KG', comment: '' },
    { parentId: '200001', parentDesc: 'Feed solution', yield: 5, yieldUnit: 'L', componentId: '100105', componentDesc: 'Magnesium sulfate', qty: 0.15, unit: 'KG', comment: '' },
    { parentId: '200001', parentDesc: 'Feed solution', yield: 5, yieldUnit: 'L', componentId: '100106', componentDesc: 'Trace element solution', qty: 0.05, unit: 'L', comment: '' },
    { parentId: '200002', parentDesc: 'Lysis buffer', yield: 20, yieldUnit: 'L', componentId: '100107', componentDesc: 'Tris base', qty: 0.24, unit: 'KG', comment: '' },
    { parentId: '200002', parentDesc: 'Lysis buffer', yield: 20, yieldUnit: 'L', componentId: '100108', componentDesc: 'Sodium chloride', qty: 1.2, unit: 'KG', comment: '' }
  ];
  var S = [];
  function st(site, id, bin, type, desc, cat, expDays, qty, unit) {
    S.push({ site: site, material: id, storageBin: bin, storageType: type, description: desc, batch: 'B' + id.slice(-4), stockCategory: cat,
             expiry: expDays === null ? '' : P(expDays), qty: qty, unit: unit });
  }
  var A = 'SITE-A', B = 'SITE-B';
  st(A, '100101', 'WH-01-01', 'WH01', 'Yeast extract', 'F1', 400, 6, 'KG');
  st(A, '100102', 'WH-01-02', 'WH01', 'Sodium phosphate monobasic', 'F1', 500, 4, 'KG');
  st(A, '100103', 'WH-01-03', 'WH01', 'Ammonia solution 25 %', 'F1', 300, 20, 'L');
  st(A, '100103', 'PSA-01', 'PSA1', 'Ammonia solution 25 %', 'F1', 300, 5, 'L');
  st(A, '100104', 'WH-02-01', 'WH01', 'Glucose monohydrate', 'F1', 600, 9, 'KG');
  st(A, '100105', 'WH-02-02', 'WH01', 'Magnesium sulfate', 'F1', 600, 3, 'KG');
  st(B, '100106', 'WH-02-03', 'WH01', 'Trace element solution', 'F1', 200, 2, 'L');
  st(A, '100107', 'WH-02-04', 'WH01', 'Tris base', 'F1', 700, 5, 'KG');
  st(A, '100108', 'WH-02-05', 'WH01', 'Sodium chloride', 'F1', 700, 25, 'KG');
  st(A, '300001', 'WH-03-01', 'WH01', 'Single-use bag 5 L', 'F1', 900, 4, 'ST');
  st(A, '300002', 'WH-03-02', 'WH01', 'Sterile filter capsule', 'F1', 900, 10, 'ST');
  st(A, '300003', 'WH-03-03', 'WH01', 'Cryovial 2 mL', 'F1', 900, 40, 'ST');
  st(A, '300004', 'WH-03-04', 'WH01', 'Depth filter', 'F1', 900, 6, 'ST');
  st(A, '200001', 'WH-04-01', 'WH01', 'Feed solution', 'F1', 20, 2, 'L');
  st(B, '100101', 'WH-01-01', 'WH01', 'Yeast extract', 'F1', 400, 3, 'KG');
  st(B, '100103', 'WH-01-03', 'WH01', 'Ammonia solution 25 %', 'F1', 300, 10, 'L');
  st(B, '300001', 'WH-03-01', 'WH01', 'Single-use bag 5 L', 'F1', 900, 20, 'ST');
  st(B, '300003', 'WH-03-03', 'WH01', 'Cryovial 2 mL', 'F1', 900, 100, 'ST');
  st(B, '200001', 'WH-04-01', 'WH01', 'Feed solution', 'F1', 200, 12, 'L');
  st(B, '100104', 'WH-02-01', 'WH01', 'Glucose monohydrate', 'F1', 600, 5, 'KG');
  st(A, '100102', 'QI-01', 'QI01', 'Sodium phosphate monobasic (in quality inspection)', 'Q3', 300, 50, 'KG');
  T.ErpStock = S;
  T.Documents = [
    { docId: 'DOC-1001', title: 'Batch record fermentation FIXTURE-CYT', version: '3', status: 'Effective', effectiveDue: P(-60) },
    { docId: 'DOC-1002', title: 'Line clearance', version: '2', status: 'Effective', effectiveDue: P(-60) },
    { docId: 'DOC-1003', title: 'Sampling plan', version: '1', status: 'Effective', effectiveDue: P(-60) },
    { docId: 'DOC-2001', title: 'Batch record IB preparation', version: '2', status: 'Effective', effectiveDue: P(-60) },
    { docId: 'DOC-3001', title: 'Batch record enzyme', version: '1', status: 'In review', effectiveDue: '' }
  ];
  T.Equipment = [
    { equipId: 'FERM-01', description: 'Fermenter 30 L', status: 'Released', due: P(300) },
    { equipId: 'FERM-02', description: 'Fermenter 10 L', status: 'Released', due: P(120) },
    { equipId: 'LAF-01', description: 'Laminar flow cabinet', status: 'Released', due: P(200) },
    { equipId: 'CENT-01', description: 'Harvest centrifuge', status: 'Released', due: P(180) },
    { equipId: 'CENT-02', description: 'Floor centrifuge', status: 'Released', due: P(180) },
    { equipId: 'FRZ-80-01', description: 'Freezer -80 C', status: 'Released', due: P(365) },
    { equipId: 'HOMOG-01', description: 'High-pressure homogenizer', status: 'Ready for use', due: P(150) }
  ];
  T.Holds = [];
  T.Bio = [
    { category: 'Cell line', itemId: 'WCB-FIXTURE', description: 'Working cell bank FIXTURE-CYT', lot: 'WCB-2026-01', site: A, storage: 'LN2 tank 1', qty: 6, unit: 'ST', status: 'Released', expiry: '' },
    { category: 'Antibody (primary)', itemId: 'AB-PRIMARY', description: 'Rabbit anti FIXTURE-CYT', lot: 'AB-LOT-7', site: A, storage: 'Freezer 2', qty: 3, unit: 'ALQ', status: 'Released', expiry: P(400) },
    { category: 'Antibody (secondary)', itemId: 'AB-SEC-RB', description: 'Goat anti-rabbit HRP', lot: 'SEC-LOT-2', site: A, storage: 'Freezer 2', qty: 30, unit: 'ALQ', status: 'Released', expiry: P(400) },
    { category: 'Antibody (primary)', itemId: 'AB-PRIMARY', description: 'Rabbit anti FIXTURE-CYT', lot: 'AB-LOT-7', site: B, storage: 'Freezer 1', qty: 20, unit: 'ALQ', status: 'Released', expiry: P(400) }
  ];
  T.Confirmed = []; T.Bulk = []; T.Report = []; T.Users = []; T.AuditLog = []; T.Meta = [];
  return T;
}

/** Same data as a db object (used by the tests). */
function fixture_db(today) {
  var T = fixture_tables(today), db = {};
  db.sites = T.Sites; db.steps = T.Steps; db.storageTypes = T.StorageTypes; db.products = T.Products;
  db.requirements = T.Requirements; db.recipes = T.Recipes; db.stock = T.ErpStock; db.documents = T.Documents;
  db.equipment = T.Equipment; db.holds = T.Holds; db.bio = T.Bio; db.confirmed = []; db.bulk = [];
  db.settings = {}; T.Settings.forEach(function (r) { db.settings[r.key] = r.value; });
  var now = today + 'T08:00:00.000Z';
  db.meta = { 'stock:SITE-A': now, 'stock:SITE-B': now, documents: now, equipment: now, bio: now };
  return db;
}



/** Test only: fills an empty database with the invented fixtures above. */
function test_seed_unused() {
  var today = Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd'), data = fixture_tables(today);
  Object.keys(data).forEach(function (name) { if (store_read(name).length === 0 || name === 'Settings') store_write(name, data[name]); });
  var now = new Date().toISOString();
  ['stock:SITE-A', 'stock:SITE-B', 'documents', 'equipment', 'bio'].forEach(function (k) { store_setKv('Meta', k, now); });
}
