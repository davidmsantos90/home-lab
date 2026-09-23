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
