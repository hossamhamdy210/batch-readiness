# Architecture

## Layers
* **core/** - `Engine.js` (pure function `eng_run(db, params, today)`: rules and allocation), `Auth.js` (users, sessions), `Api.js` (single role-checked dispatcher `api(token, action, payload)`), `Sync.js` (bulk master-data load), `Schema.js` / `Defaults.js`.
  Loaded into a Node `vm` context so it stays platform-independent; it only calls `port.*`, `store_*` and `platform_emit`.
* **server/runtime.js** - the port: SQLite storage (better-sqlite3), scrypt hashing, timezone-aware "today", caches. One `BEGIN IMMEDIATE` transaction per write action; it commits only if the action returned `ok`, otherwise rolls back. Events are delivered after commit.
* **server/app.js** - Express: `/api/v1/rpc` for the browser, `/integration/v1/*` for machines, health endpoints, security headers (CSP), rate limits.
* **server/integrations/** - `mapping.js` (SAP names, number/date parsing, CSV), `sapOData.js`, `fileDrop.js`, `webhooks.js`, `scheduler.js`.
* **web/** - static HTML/JS/CSS client without build step.

## Decisions
* **SQLite, not a server database.** One process, one file, transactional, trivially backed up (`db.backup`). The write path is synchronous, which removes the lost-update problems the spreadsheet version needed locks for. A larger deployment can swap the store behind the same `store_*` interface.
* **Sessions and lock-out counters live in a separate cache file** so a rolled-back transaction (e.g. a failed login) cannot undo the failed-attempt counter.
* **API keys** are random, stored only as SHA-256 hashes, shown once, revocable; roles reader -> viewer, writer -> editor.
* **Replace semantics for imports** (per table, per site for stock and bio) match how ERP exports work; guards stop an empty or broken extract from wiping data.
* **Connectors fetch everything before writing anything**, so a failure on plant 2 never leaves plant 1 half-updated.
* **Credentials never in config files** - the connector config names environment variables.

## Known limits
* Single process, single writer (sufficient for the intended scale: tens of users, tens of thousands of stock rows).
* The browser client keeps its session token in `sessionStorage`; put the service behind HTTPS (see DEPLOYMENT).
* Not validated GMP software; no electronic signatures.
