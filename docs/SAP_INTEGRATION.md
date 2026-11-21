# SAP / ERP integration

Batch Readiness never writes to SAP. It **receives** stock, document, equipment and biological-inventory data and **reports** readiness.
Three ways in, one way out:

| Way | Direction | Use when |
|---|---|---|
| Folder drop (CSV) | SAP/ERP export -> app | A scheduled SAP report or job writes files; no network access from the app to SAP needed |
| REST push (`PUT /integration/v1/...`) | SAP/middleware -> app | SAP PI/PO, CPI/Integration Suite, a script or an ETL tool pushes data |
| OData pull (connector) | app -> SAP | You expose a read-only OData service and want the app to poll it |
| Webhook | app -> any system | Tell another system when a campaign is confirmed or a batch changes |

> **Status:** validated against mock OData servers, sample CSV files and a mock webhook receiver. **Not validated against a live SAP system.**
> Expect to adjust field names and authorizations with your SAP team. Do a first run with `dryRun=true` and compare row counts to a transaction report (for example the stock overview).

## 1. Data the tool needs
| Dataset | Key fields (SAP technical name in brackets) |
|---|---|
| stock | material (MATNR), storage type (LGTYP) or storage location (LGORT), bin (LGPLA), batch (CHARG), stock category (INSMK), expiry (VFDAT), quantity (MENGE / LABST), unit (MEINS), site/plant (WERKS) |
| documents | document number, version, status, effective date |
| equipment | equipment id (EQUNR), status, calibration / next due date |
| bio | item id, lot, site, storage, quantity, status, expiry |

Headers are matched case-insensitively, ignoring punctuation. Friendly names and the SAP technical names above are accepted; add your own with `extraAliases` in a connector config.

Parsing rules (rows that cannot be parsed are **skipped and reported**, never guessed):
* Numbers: `1.234,56`, `1,234.56`, `12,5`, trailing minus `100-`. A single dot is read as a decimal point (`12.500` = 12.5) - export with unambiguous numbers if your system uses dots as thousands separators.
* Dates: `YYYYMMDD`, `DD.MM.YYYY`, ISO `YYYY-MM-DD`, OData `/Date(ms)/`. `00000000` and `0000-00-00` mean "no date". Dates such as `03/04/2026` are rejected as ambiguous.

## 2. Folder drop
Configure a folder in `config/integrations.json` (`fileDrop`). Name files `stock_<SITE>.csv`, `documents.csv`, `equipment.csv`, `bio_<SITE>.csv` (`<SITE>` = site id in the app).
Imported files move to `processed/`, rejected files to `failed/` with a `.error.txt` explaining why. Files younger than 3 seconds are ignored (still being written).

## 3. REST push
```bash
curl -X PUT "https://batch.example.com/integration/v1/stock?site=SITE-A" \
  -H "Authorization: Bearer brk_..." -H "Content-Type: text/csv" --data-binary @stock.csv
```
* Query: `site` (when rows carry no plant column), `dryRun=true`, `allowEmpty=true`.
* A multi-plant file works when it has a plant/site column holding the app's site ids.
* Responses: `200` loaded (with `imported`, `skipped`, `warnings`, `unmapped` headers), `401` bad key, `403` read-only key, `422` rejected - **nothing was changed**.
* Create keys in *Admin > Integrations*: **writer** loads data, **reader** only reads. Keys are shown once.
* Master data: `PUT /integration/v1/master/Products|Requirements|Recipes|StorageTypes|Holds` with a JSON array.
* Result: `GET /integration/v1/readiness?product=...&site=...&batches=2&from=2026-12-01`.

## 4. SAP OData pull
Edit `config/integrations.json` (copy `integrations.example.json`):
```json
{ "sapOData": [ { "name": "stock-plant-1000", "enabled": true,
    "baseUrl": "https://sap.example.com/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV",
    "entity": "A_MatlStkInAcctMod",
    "auth": { "type": "basic", "userEnv": "SAP_USER", "passwordEnv": "SAP_PASSWORD" },
    "plants": { "1000": "SITE-A" }, "storageLocations": [], "everyMinutes": 60 } ] }
```
* Auth types: `basic`, `bearer` (token in an env var), `oauth-client-credentials` (`tokenUrl`, `clientIdEnv`, `clientSecretEnv`). **Credentials are read from environment variables**, never from the file.
* `plants` maps SAP plant -> site id. All plants are fetched before anything is written; if one fails, nothing changes.
* Special stock (`InventorySpecialStockType` set) is excluded unless `"includeSpecialStock": true`.
* `fieldMap` renames source fields: `{ "material": "ZZ_MATERIAL" }`.
* Paging follows `__next`. If more than 20% of the rows are unusable the run is rejected.
* Use a **dedicated technical SAP user with read-only authorization** for the stock service only.

**Things to confirm with your SAP team** (they differ between releases and landscapes):
1. The stock service and entity names exposed in your system; the default follows the standard material-stock API.
2. Expiry date and storage type/bin are usually **not** part of the plain stock entity (they come from batch master and warehouse management). If you need them, use a report export through the folder drop or REST push, or an additional service you expose.
3. Which stock categories count as usable - configure them in *Admin > Settings*.
4. Network path, certificates and rate limits for the OData service.

## 5. Webhooks
*Admin > Integrations*: URL, optional secret, optional event list (`campaign.confirmed`, `batch.<action>`; empty = all).
Each call is a JSON `POST` with headers `X-BR-Event` and, when a secret is set, `X-BR-Signature: sha256=<hex HMAC of the raw body>`. Verify the signature before trusting a call. Failed deliveries are retried (2 s, 10 s, 60 s) except for permanent client errors; failures appear in *Recent integration runs*.

## 6. Operations
Every run is logged (*Recent integration runs*, `GET /integration/v1/runs`). The log keeps the last 5,000 runs and 50,000 audit entries. Rate limit for machine calls: 120 per minute per client address.
