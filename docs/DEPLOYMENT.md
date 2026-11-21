# Deployment

## Docker (recommended)
```bash
cp .env.example .env     # optional: timezone, first admin, SAP credentials
docker compose up -d --build
docker compose logs app | grep "setup code"
```
Data lives in the `app-data` volume (`/data`): database, cache, `backups/`.

## Without Docker
Node 20+ and a C++ toolchain for `better-sqlite3` (prebuilt binaries usually suffice): `npm ci && npm start`.

## Configuration (environment)
| Variable | Default | Meaning |
|---|---|---|
| `PORT`, `HOST` | 8080, 0.0.0.0 | Listen address |
| `DATA_DIR` | `./data` | Database and backups |
| `APP_TIMEZONE` | UTC | Timezone that defines "today" (e.g. `Europe/Berlin`) |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy so client IPs (rate limits) are correct |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | - | Create the first administrator on the first start (otherwise use the setup code) |
| `BACKUP_KEEP` | 14 | Daily backups kept |
| `INTEGRATIONS_FILE` | `config/integrations.json` | Connector configuration |

## HTTPS
Terminate TLS in a reverse proxy (Caddy, nginx, a cloud load balancer) and set `TRUST_PROXY=1`. Example Caddyfile: `batch.example.com { reverse_proxy app:8080 }`.

## Backup and restore
Automatic: one online backup per day into `/data/backups`. Manual: `npm run backup`. Restore: stop the service, copy a backup over `batchreadiness.db`, start.
Copy the backups off the host regularly.

## Wipe / hand-over
`npm run wipe -- --yes` deletes the database; the next start is an empty installation with a new setup code.

## Health
`GET /healthz` (process up), `GET /readyz` (database reachable).
