# Mealie

Self-hosted recipe manager and meal planner using Mealie's recommended
single-container SQLite deployment.

## Dependencies

- Docker + Docker Compose v2
- Shared external `homelab` network (created by the root `compose.yaml`)
- A 64-bit host; Mealie does not support 32-bit ARM

## Environment variables

Copy `.env.example` to `.env` and review:

- `TZ`
- `BASE_URL` (the public URL used in notifications and authentication callbacks)
- `API_TOKEN` (an administrator token used by the optional food updater)
- `PUID` and `PGID` (the owner of the persistent data directory)
- `MEALIE_DATA_PATH` if data should live outside this directory
- `MEMORY_LIMIT` (defaults to Mealie's recommended `1G`)

`ALLOW_SIGNUP` defaults to `false`. Leave it disabled and invite users from an
administrator account.

This stack uses SQLite, which is suitable for roughly 1-20 users. Do not put
`MEALIE_DATA_PATH` on network-attached storage; use Mealie's PostgreSQL
deployment for NAS-backed data or workloads with many concurrent users.

## Startup

```bash
cd mealie
cp .env.example .env
docker compose up -d
```

Open `http://<host-ip>:9925` and sign in with Mealie's initial credentials:

- Username: `changeme@example.com`
- Password: `MyPassword`

Change the password immediately, then validate the deployment under
**Administration > Site Settings**.

## PT-PT food catalogue

`update_foods_pt_pt.py` restores the PT-PT aliases and common Portuguese foods
used by this deployment. It preserves existing food UUIDs, recipe references,
substitutions, labels, and household assignments, and is safe to run again.

Create an administrator token under **Profile > API Tokens**, add it to the
untracked `.env`, and preview the changes:

```bash
python3 update_foods_pt_pt.py
```

Apply them after reviewing the summary:

```bash
python3 update_foods_pt_pt.py --apply
```

If the current group has no foods, `--apply` first seeds Mealie's pinned
v3.27.0 PT-PT catalogue. The script then uses Mealie's matching v3.27.0 English
and PT-PT seed files to add authoritative aliases. Because Mealie's upstream
PT-PT catalogue is incomplete, remaining English names are translated and
cached in `.food-translations-pt-PT.json`; the cache is ignored by Git and can
be reused on subsequent runs. Curated PT-PT corrections cover ambiguous
culinary terms, and additional Portuguese staples are created under their
existing Mealie labels.

Python 3.9 or newer and outbound HTTPS access to GitHub and Google Translate
are required. The updater has no third-party Python package dependencies.

The script reports unresolved name collisions instead of merging or deleting
foods. Take a Mealie backup before the first `--apply` run.

## Reverse proxy

Configure Nginx Proxy Manager with:

| Field | Value |
|---|---|
| Domain | `mealie.pimlicoa.duckdns.org` |
| Scheme | `http` |
| Upstream host | `app-mealie` |
| Upstream port | `9000` |

Add a matching Pi-hole CNAME pointing the Mealie subdomain to
`pimlicoa.duckdns.org`.

## Backups and updates

Create backups from Mealie's administration UI and copy the resulting ZIP
files off this host. The mounted data directory alone is not an independent
backup.

The image is intentionally pinned. Before changing `IMAGE_URL`, read the
release notes and take a backup.

## Useful links

- https://mealie.io/documentation/getting-started/installation/installation-checklist/
- https://mealie.io/documentation/getting-started/installation/sqlite/
- https://github.com/mealie-recipes/mealie
