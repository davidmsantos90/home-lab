# Pi-hole

Network-wide DNS sinkhole and ad blocker, exposed locally and on Tailnet via the host.

This instance is the **SECONDARY** in a two-instance Pi-hole setup: a
Proxmox-hosted **PRIMARY** (`<pihole-primary-ip>`) is the source of truth for DNS
records and Gravity lists, replicated here via Nebula Sync (see
[Pi-hole PRIMARY/SECONDARY sync (Nebula Sync)](#pi-hole-primarysecondary-sync-nebula-sync)).

## Dependencies

- Docker + Docker Compose v2
- Shared external `homelab` network
- Port 53 available on host

## Environment variables

Copy [`.env.example`](/Users/davsantos/github/misc/home-lab/pihole/.env.example) to `.env` and set:

- `TZ`
- `SERVICEPORT` / `ADMIN_PORT` if you need different local admin port mapping
- `IMAGE_URL` for pinning
- `NEBULA_SYNC_*` — see [Pi-hole PRIMARY/SECONDARY sync (Nebula Sync)](#pi-hole-primarysecondary-sync-nebula-sync) below

## Startup

```bash
cd pihole
cp .env.example .env
docker compose up -d
```

## Pi-hole PRIMARY/SECONDARY sync (Nebula Sync)

DNS is provided by two Pi-hole instances:

- **PRIMARY** — Proxmox-hosted Pi-hole (`<pihole-primary-ip>`); the source of truth
  for DNS records and Gravity lists (ad lists, groups, clients, domain lists)
- **SECONDARY** — this Raspberry Pi instance (`<pi-lan-ip>`); kept in sync
  from PRIMARY

DHCP stays on the router and is never synchronized. The Raspberry Pi instance
only ever *receives* configuration from Proxmox; edit DNS records and Gravity
lists on PRIMARY, not here.

Synchronization uses [Nebula Sync](https://github.com/lovelaze/nebula-sync), a
third-party tool for Pi-hole v6, preferred here over the older Gravity Sync
approach. It's included as the `nebula-sync` service in this stack's
`compose.yaml`.

### Setup

1. On **each** Pi-hole instance (PRIMARY and this SECONDARY), create an App
   Password: **Settings → Web Interface / API → App Password**. Store the
   PRIMARY's app password and this instance's app password — do not commit
   them to Git.
2. On this SECONDARY, `FTLCONF_webserver_api_app_sudo=true` is already set in
   `compose.yaml` — required so Nebula Sync can apply the synced
   configuration here.
3. Set in `.env`:
   - `NEBULA_SYNC_PRIMARY_URL` — PRIMARY's URL (e.g. `http://<pihole-primary-ip>`)
   - `NEBULA_SYNC_PRIMARY_PASSWORD` — PRIMARY's App Password
   - `NEBULA_SYNC_SECONDARY_PASSWORD` — this instance's App Password
   - `NEBULA_SYNC_CRON` — schedule (default: once daily at `05:00`)
4. `docker compose up -d nebula-sync`

### Selective sync policy

This deployment uses selective sync (`FULL_SYNC=false`) rather than a full
Teleporter import/export, so that instance-local settings aren't clobbered:

| Section | Synced | Not synced |
|---|---|---|
| Config | DNS, Resolver | DHCP, NTP, Database, Misc, Debug |
| Gravity | Groups, Ad lists (+ by group), Domain lists (+ by group), Clients (+ by group) | DHCP leases |

`RUN_GRAVITY=true` runs `pihole -g` on the SECONDARY after each sync so ad
lists take effect immediately.

### Manual/initial sync

The scheduled sync runs once a day. After making an important DNS change on
PRIMARY, trigger an immediate sync instead of waiting for the next scheduled
run:

```bash
docker compose run --rm nebula-sync nebula-sync run
```

Check the result:

```bash
docker logs nebula-sync-pihole --tail 50
```

## Useful links

- https://docs.pi-hole.net/
- https://github.com/lovelaze/nebula-sync
