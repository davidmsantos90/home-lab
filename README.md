# Home Lab

Self-hosted services running in Docker, each accessible via [Tailscale](https://tailscale.com/) on your Tailnet **and** locally on your LAN without Tailscale.

Follows the [ScaleTail](https://github.com/tailscale-dev/ScaleTail) sidecar pattern: every service gets a dedicated Tailscale container that handles Tailnet connectivity, and a shared `homelab` Docker network lets Nginx Proxy Manager route local traffic to all services.

## Project structure

```
home-lab/
├── compose.yaml               # Creates shared homelab + macvlan networks
├── nginx-proxy-manager/
│   ├── compose.yaml
│   └── .env
├── pihole/
│   ├── compose.yaml
│   └── .env
├── immich/
│   ├── compose.yaml
│   └── .env
├── portainer/
│   ├── compose.yaml
│   └── .env
├── deluge/
│   ├── compose.yaml
│   └── .env
├── plex/
│   ├── compose.yaml
│   └── .env
├── jellyfin/
│   ├── compose.yaml
│   ├── .env
│   └── README.md
```

## Services

| Service | Local port(s) | Tailnet URL |
|---|---|---|
| **Pi-hole** | `53` (DNS), `8080` (admin) | `https://pihole.<tailnet>.ts.net` |
| **Immich** | `2283` | `https://immich.<tailnet>.ts.net` |
| **Portainer** | `9000` | `https://portainer.<tailnet>.ts.net` |
| **Deluge** | `8112` (UI), `6881` (torrent) | `https://deluge.<tailnet>.ts.net` |
| **Plex** | `32400` | `https://plex.<tailnet>.ts.net` |
| **Jellyfin** | `8096` | `https://jellyfin.<tailnet>.ts.net` |
| **Nginx Proxy Manager** | `192.168.1.5` (LAN IP via macvlan) | Tailscale IP + port `81` (run `tailscale ip -4` on host) |
| **wg-easy** | `51820/udp` (WireGuard) | `pimlicoa.duckdns.org:51820` |

## Prerequisites

- Docker + Docker Compose v2
- A [Tailscale](https://tailscale.com/) account

## Relocating a service's data (`HOME_LAB_DIR`)

Every service exposes a `HOME_LAB_DIR` environment variable (in its `.env.example`)
that sets the base directory for that service's persistent config/state
volumes (Tailscale state, app config, database data, etc). It defaults to
`.` — the service's own directory — so nothing changes unless you set it.

Set it in a service's `.env` to move its data elsewhere, e.g. an external
drive mounted at `/mnt/storage`:

```bash
# nginx-proxy-manager/.env
HOME_LAB_DIR=/mnt/storage/nginx-proxy-manager
```

Large media/library paths (`PLEX_MEDIA_PATH`, `JELLYFIN_MEDIA_PATH`,
`DOWNLOADS_PATH`, `UPLOAD_LOCATION`) are intentionally **not** covered by
`HOME_LAB_DIR` — they have their own dedicated variables since they're
often stored on separate, larger volumes than a service's config/state.

After changing `HOME_LAB_DIR` for a service that's already running, stop it,
move the existing data to the new location, then start it again:

```bash
cd <service>
docker compose down
mv ./ts /mnt/storage/<service>/ts   # and any other existing data dirs
# update HOME_LAB_DIR in .env
docker compose up -d
```

## Quick Start

### 1. Create the shared Docker networks

Run the root compose file once to create the `homelab` bridge and `macvlan` networks:

```bash
docker compose up
```

The `init` container prints a confirmation and exits. Both networks persist and are used by all services.

### 2. Get a Tailscale Auth Key

Go to [Tailscale Admin → Keys](https://login.tailscale.com/admin/settings/keys) and generate a **reusable** auth key. You'll add it to each service's `.env`.

### 3. Configure and start each service

Start **nginx-proxy-manager** first (it needs the macvlan network), then the rest in any order:

```bash
cd nginx-proxy-manager
# Edit .env — set TS_AUTHKEY, TZ, and verify NPM_IP matches your macvlan range
docker compose up -d

# Then for each other service:
cd ../pihole   # (or immich, portainer, deluge, plex)
# Edit .env — at minimum set TS_AUTHKEY and TZ
docker compose up -d
```

### 4. Pi-hole: free up port 53 (Ubuntu/Debian only)

On systems using `systemd-resolved`, port 53 is occupied by default. Free it before starting Pi-hole:

```bash
# Disable the stub listener
sudo sed -i 's/#DNSStubListener=yes/DNSStubListener=no/' /etc/systemd/resolved.conf
sudo systemctl restart systemd-resolved

# Verify port 53 is free
sudo ss -tulnp | grep :53
```

### 5. WireGuard access with wg-easy

[`wg-easy/compose.yaml`](wg-easy/compose.yaml) provides WireGuard access for devices that cannot use Tailscale. Its DuckDNS companion updates `pimlicoa.duckdns.org` with the home connection's public IPv4 address, and wg-easy creates client profiles using that hostname.

1. In DuckDNS, confirm that the `pimlicoa` subdomain exists and copy its token.
2. Create the local environment file and set a long, unique admin password:

   ```bash
   cd wg-easy
   cp .env.example .env
   chmod 600 .env
   ```

   `WG_EASY_HOST` defaults to `pimlicoa.duckdns.org`, but you can change it in `.env` if you point DuckDNS somewhere else.

3. Forward **UDP 51820** on the router to this Docker host's LAN IP. Do not forward TCP 51821.
4. Start the stack:

   ```bash
   docker compose up -d
   ```

5. Open `https://wg-easy.<tailnet>.ts.net` from a device on the Tailnet, sign in with the credentials in `.env`, and create a client profile. The service name can be changed in [`wg-easy/compose.yaml`](wg-easy/compose.yaml) by changing the Tailscale container `hostname`.

In this stack, `wg-easy` and `tailscale` run as independent containers (no shared network namespace), and both attach to `homelab`. Tailscale Serve proxies to `wg-easy` over Docker networking with Funnel disabled. The only public service is the authenticated WireGuard UDP endpoint. The web UI is also available locally at `http://127.0.0.1:51821` on the host when needed. Keep `wg-easy/data/` backed up: it contains the server and client keys. After the first successful start, remove the `INIT_*` entries from [`wg-easy/compose.yaml`](wg-easy/compose.yaml) and restart the stack so the bootstrap password is no longer present in the running container configuration.

If you previously ran an older `wg-easy` compose with a different internal network label and get a Docker network label mismatch error, remove the stale network once and start again:

```bash
docker network rm wg_easy_internal || true
docker compose up -d
```

## How access works

Most services use the **Tailscale sidecar pattern**: the app container has no network stack of its own — it uses `network_mode: service:tailscale` to share the Tailscale container's network namespace. This means any port the app binds to (e.g. immich on `:2283`) is actually bound inside the Tailscale container.

```
┌──────────────────────────────────────────────────────┐
│  tailscale-immich container                          │
│  ├── tailscaled  ──────────────────→ Tailnet (HTTPS) │
│  └── [shared network namespace]  ──→ host ports      │
│                                                      │
│  app-immich-server (no own network stack)            │
│  └── listens on :2283  ──→ exits via tailscale-immich│
└──────────────────────────────────────────────────────┘
```

### Tailnet access

`TS_SERVE_CONFIG` instructs the Tailscale daemon to:
1. Accept HTTPS on port 443 on the Tailnet IP (automatic TLS cert, no firewall rules needed)
2. Reverse-proxy to `http://127.0.0.1:<port>` — localhost within the shared namespace

Result: any device on your Tailnet can reach `https://immich.<tailnet>.ts.net` directly.

### Local access

Because the Tailscale container has `ports:` bound to `0.0.0.0` on the host, you can access services **directly by IP+port** without Tailscale and without NPM:

| Service | Direct local URL |
|---|---|
| Pi-hole admin | `http://<host-ip>:8080/admin` |
| Immich | `http://<host-ip>:2283` |
| Portainer | `http://<host-ip>:9000` |
| Deluge | `http://<host-ip>:8112` |
| NPM admin | `http://192.168.1.5:81` |

You can **also** route through NPM using your DuckDNS subdomains for a consistent URL across LAN and Tailnet (see NPM section below).

| Access method | Example | Needs Tailscale? | Needs NPM? |
|---|---|---|---|
| Direct IP + port | `http://192.168.1.10:2283` | ❌ | ❌ |
| Local domain via NPM | `https://immich.pimlicoa.duckdns.org` | ❌ | ✅ |
| Tailnet | `https://immich.<tailnet>.ts.net` | ✅ | ❌ |

## Nginx Proxy Manager

NPM lives on a **macvlan** network, giving it a dedicated LAN IP (`192.168.1.5`) so it can own ports 80/443 without conflicting with the host. It is also on the `homelab` bridge to reach other services.

> **Note on Tailscale Serve**: NPM's Tailscale sidecar intentionally has no `TS_SERVE_CONFIG` — Tailscale Serve would claim port 443, conflicting with NPM's own HTTPS listener. Access NPM's admin UI on the Tailnet via its raw Tailscale IP: `http://<tailscale-ip>:81` (run `tailscale ip -4` on the host).

### NPM upstream targets

When adding proxy hosts in NPM, use the Tailscale container name as the upstream (reachable via the `homelab` Docker network):

| Service | Upstream host | Upstream port |
|---|---|---|
| Pi-hole admin | `tailscale-pihole` | `80` |
| Immich | `tailscale-immich` | `2283` |
| Portainer | `tailscale-portainer` | `9000` |
| Deluge | `tailscale-deluge` | `8112` |
| Plex | `tailscale-plex` | `32400` |
| Jellyfin | `tailscale-jellyfin` | `8096` |

For services running **on the host** (not yet in Docker), use the `homelab` bridge gateway instead — macvlan containers can't reach the host's main LAN IP directly, but can always reach it via the bridge gateway:

| Service (on host) | NPM upstream host | NPM upstream port |
|---|---|---|
| Plex | `192.168.100.1` | `32400` |

The gateway is pinned to `192.168.100.1` by the subnet in `compose.yaml`. Once a service is migrated to Docker, switch its upstream to the container name.

### Consistent URLs across LAN and Tailnet

With Pi-hole as DNS for both LAN and Tailnet, you can use the same subdomain everywhere:

1. **Pi-hole** → Local DNS → DNS Records: add one A record pointing your domain to NPM's IP:
   ```
   pimlicoa.duckdns.org → 192.168.1.5
   ```
2. Add CNAME records for each subdomain pointing to the root:
   ```
   immich.pimlicoa.duckdns.org    → pimlicoa.duckdns.org
   portainer.pimlicoa.duckdns.org → pimlicoa.duckdns.org
   pihole.pimlicoa.duckdns.org    → pimlicoa.duckdns.org
   deluge.pimlicoa.duckdns.org    → pimlicoa.duckdns.org
   npm.pimlicoa.duckdns.org       → pimlicoa.duckdns.org
   ```
3. **NPM**: add a proxy host for each subdomain, using the wildcard cert (`*.pimlicoa.duckdns.org`).

NPM default credentials (change on first login):
- **Email**: `admin@example.com`
- **Password**: `changeme`

## Network architecture

```
┌─────────────────────────────────────────────────┐
│  homelab bridge (192.168.100.0/24)              │
│  gateway: 192.168.100.1 (host)                  │
│                                                  │
│  tailscale-pihole, tailscale-immich,            │
│  tailscale-portainer, tailscale-deluge,         │
│  tailscale-plex, tailscale-npm (NPM sidecar)    │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  macvlan (192.168.1.0/24, range .4-.7)          │
│  parent: eth0                                    │
│                                                  │
│  tailscale-npm → 192.168.1.5                    │
└─────────────────────────────────────────────────┘
```

Each service's `compose.yaml` also defines a **private internal network** (e.g. `immich_internal`) for intra-service communication (immich ↔ postgres ↔ redis). Those containers are not reachable from outside.

## Migrating Deluge and Plex from host to Docker

Both services can be migrated without losing data by pointing Docker volumes at the existing host paths.

### Find your existing data

```bash
# Deluge config location
ls ~/.config/deluge/          # most common
ls /var/lib/deluged/          # if installed as a system service

# Deluge downloads
cat ~/.config/deluge/core.conf | grep download_location

# Plex metadata/config
ls "/var/lib/plexmediaserver/Library/Application Support/Plex Media Server/"
ls ~/.local/share/plex/        # alternative location
```

### Migrate Deluge

1. **Stop the host Deluge daemon**:
   ```bash
   sudo systemctl stop deluged deluge-web
   sudo systemctl disable deluged deluge-web
   ```

2. **Copy (not move) your existing config** into the location `deluge/compose.yaml`
   expects (`${HOME_LAB_DIR:-.}/config`, i.e. `deluge/config` by default):
   ```bash
   mkdir -p deluge/config
   cp -a ~/.config/deluge/. deluge/config/
   ```

3. **Set `DOWNLOADS_PATH`** in `deluge/.env` to your existing downloads directory
   (no copying needed — it's mounted directly):
   ```env
   DOWNLOADS_PATH=/home/pi/Downloads
   ```

4. **Start the Docker stack**:
   ```bash
   cd deluge
   docker compose up -d
   ```

5. Verify at `http://<host-ip>:8112` — all torrents, settings, and history should be intact.

### Migrate Plex

1. **Stop the host Plex service**:
   ```bash
   sudo systemctl stop plexmediaserver
   sudo systemctl disable plexmediaserver
   ```

2. **Get a Plex claim token** (valid for 4 minutes, only needed on first start):
   Visit https://plex.tv/claim and copy the token — not needed if you're copying
   an existing config (see next step), since server identity is preserved.

3. **Copy (not move) your existing config** into the location `plex/compose.yaml`
   expects (`${HOME_LAB_DIR:-.}/config`, i.e. `plex/config` by default):
   ```bash
   mkdir -p plex/config
   cp -a "/var/lib/plexmediaserver/Library/Application Support/Plex Media Server/." plex/config/
   ```

4. **Set `PLEX_MEDIA_PATH`** in `plex/.env` to your existing media directory
   (no copying needed — it's mounted directly). Mount the same parent directory
   Plex originally scanned from, so the container sees media at the same
   absolute path recorded in Plex's library database:
   ```env
   PLEX_MEDIA_PATH=/home/pi/media
   PLEX_CLAIM=claim-xxxxxxxxxxxxxxxxxxxx
   ```

5. **Start the Docker stack**:
   ```bash
   cd plex
   docker compose up -d
   ```

6. Verify at `http://<host-ip>:32400/web` — libraries, metadata, and watch history should all be present.

> **Note**: `PUID`/`PGID` (default `1000`) must match the owner of your existing config files. Check with `ls -la ~/.config/deluge` or `ls -la /var/lib/plexmediaserver`.

## Updating services

```bash
cd <service-name>
docker compose pull
docker compose up -d
```

## Syncing environment files to the Raspberry Pi

To copy every local `.env` file to the matching service directory on `pi@little-pi4`, run:

```bash
./sync-env.sh
```

The script preserves paths relative to this repository, creates the destination repository directory if necessary, and sets copied `.env` files to owner-read/write permissions on the Raspberry Pi. It does not delete remote files.

## Secrets reminder

- `PIHOLE_WEBPASSWORD` in `pihole/.env`
- `DB_PASSWORD` in `immich/.env`
- `TS_AUTHKEY` in every `.env` file
- `DUCKDNS_TOKEN`, `TS_AUTHKEY`, `WG_EASY_HOST`, and `WG_EASY_ADMIN_PASSWORD` in `wg-easy/.env`

Do **not** commit `.env` files to version control. Add them to `.gitignore`:

```bash
echo "**/.env" >> .gitignore
echo "**/ts/" >> .gitignore
```
