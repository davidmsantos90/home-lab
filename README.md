# Home Lab

Self-hosted services running in Docker, each accessible via [Tailscale](https://tailscale.com/) on your Tailnet **and** locally on your LAN without Tailscale.

Follows the [ScaleTail](https://github.com/tailscale-dev/ScaleTail) sidecar pattern: every service gets a dedicated Tailscale container that handles Tailnet connectivity, and a shared `homelab` Docker network lets Nginx Proxy Manager route local traffic to all services.

## Services

| Service | Local port(s) | Tailnet URL |
|---|---|---|
| **Pi-hole** | `53` (DNS), `8080` (admin) | `https://pihole.<tailnet>.ts.net` |
| **Immich** | `2283` | `https://immich.<tailnet>.ts.net` |
| **Portainer** | `9000` | `https://portainer.<tailnet>.ts.net` |
| **Deluge** | `8112` (UI), `6881` (torrent) | `https://deluge.<tailnet>.ts.net` |
| **Plex** | `32400` | `https://plex.<tailnet>.ts.net` |
| **Nginx Proxy Manager** | `192.168.1.200` (LAN IP via macvlan) | `https://nginx-proxy-manager.<tailnet>.ts.net` |

## Prerequisites

- Docker + Docker Compose v2
- A [Tailscale](https://tailscale.com/) account

## Quick Start

### 1. Create the shared Docker network

Run the root compose file once to create the `homelab` bridge network:

```bash
docker compose up
```

The `init` container prints a confirmation and exits. The `homelab` network persists and is used by all services.

### 2. Get a Tailscale Auth Key

Go to [Tailscale Admin → Keys](https://login.tailscale.com/admin/settings/keys) and generate a **reusable** auth key. You'll add it to each service's `.env`.

### 3. Configure and start each service

For each service (start with **nginx-proxy-manager** first, then the rest):

```bash
cd services/<service-name>
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

## How access works

Every service uses the **Tailscale sidecar pattern**: the app container has no network stack of its own — it uses `network_mode: service:tailscale` to share the Tailscale container's network namespace. This means any port the app binds to (e.g. immich on `:2283`) is actually bound inside the Tailscale container.

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

### Local access — two options

Because the Tailscale container has `ports:` bound to `0.0.0.0` on the host, you can access services **directly by IP+port** without Tailscale and without NPM:

| Service | Direct local URL |
|---|---|
| Pi-hole admin | `http://<host-ip>:80/admin` |
| Immich | `http://<host-ip>:2283` |
| Portainer | `http://<host-ip>:9000` |
| Deluge | `http://<host-ip>:8112` |
| NPM admin | `http://<host-ip>:81` |

You can **also** route through NPM for nicer local domains (e.g. `http://immich.home`). NPM reaches services via the shared `homelab` Docker network using the Tailscale container name as the upstream hostname — because the app container shares that network namespace, it's reachable there too.

| Access method | Example | Needs Tailscale? | Needs NPM? |
|---|---|---|---|
| Direct IP + port | `http://192.168.1.10:2283` | ❌ | ❌ |
| Local domain via NPM | `http://immich.home` | ❌ | ✅ |
| Tailnet | `https://immich.yourtailnet.ts.net` | ✅ | ❌ |

## Nginx Proxy Manager — upstream targets

When adding proxy hosts in NPM, use the Tailscale container name as the upstream (reachable via the `homelab` Docker network):

| Service | Upstream host | Upstream port |
|---|---|---|
| Pi-hole admin | `tailscale-pihole` | `80` |
| Immich | `tailscale-immich` | `2283` |
| Portainer | `tailscale-portainer` | `9000` |
| Deluge | `tailscale-deluge` | `8112` |
| Plex | `tailscale-plex` | `32400` |

NPM default credentials (change on first login):
- **Email**: `admin@example.com`
- **Password**: `changeme`

### NPM → host machine (macvlan workaround)

Macvlan containers **cannot reach the host's IP directly** (kernel limitation). To proxy to services still running on the host (e.g. Deluge and Plex before migration), you need to create a macvlan bridge interface on the host itself.

A systemd unit is provided at `host/macvlan-host.service`. Install it once:

```bash
sudo cp host/macvlan-host.service /etc/systemd/system/
sudo systemctl enable --now macvlan-host.service
```

This gives the host a reachable alias IP (`192.168.1.201`) from inside the macvlan network. After this, use the following upstreams in NPM for host-running services:

| Service (on host) | NPM upstream host | NPM upstream port |
|---|---|---|
| Deluge (host) | `192.168.1.201` | `8112` |
| Plex (host) | `192.168.1.201` | `32400` |

Once you migrate a service to Docker, switch its upstream to the Tailscale container name (e.g. `tailscale-deluge:8112`) and the host IP is no longer needed for that service.

## Network architecture

Each service's `compose.yaml` defines two networks:
- A **private internal network** (e.g. `immich_internal`) for intra-service communication (immich ↔ postgres ↔ redis). App containers like postgres and redis only join this network — they are not reachable from outside.
- The shared **`homelab` external network** attached to the Tailscale sidecar, making the service reachable by NPM.

Because app containers use `network_mode: service:tailscale`, they share the Tailscale container's network namespace and are reachable at the Tailscale container's name on the `homelab` network.

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

# Plex media libraries — check Plex settings or:
cat "/var/lib/plexmediaserver/Library/Application Support/Plex Media Server/Preferences.xml"
```

### Migrate Deluge

1. **Stop the host Deluge daemon**:
   ```bash
   sudo systemctl stop deluged deluge-web
   sudo systemctl disable deluged deluge-web
   ```

2. **Update `services/deluge/.env`** with your actual paths:
   ```env
   DELUGE_CONFIG_PATH=/home/pi/.config/deluge
   DOWNLOADS_PATH=/home/pi/Downloads
   ```

3. **Start the Docker stack** — it mounts your existing config and downloads directly:
   ```bash
   cd services/deluge
   docker compose up -d
   ```

4. Verify at `http://<host-ip>:8112` — all torrents, settings, and history should be intact.

### Migrate Plex

1. **Stop the host Plex service**:
   ```bash
   sudo systemctl stop plexmediaserver
   sudo systemctl disable plexmediaserver
   ```

2. **Get a Plex claim token** (valid for 4 minutes, only needed on first start):
   Visit https://plex.tv/claim and copy the token.

3. **Update `services/plex/.env`** with your actual paths and claim token:
   ```env
   PLEX_CONFIG_PATH=/var/lib/plexmediaserver/Library/Application Support/Plex Media Server
   PLEX_MEDIA_PATH=/home/pi/media
   PLEX_CLAIM=claim-xxxxxxxxxxxxxxxxxxxx
   ```

4. **Start the Docker stack**:
   ```bash
   cd services/plex
   docker compose up -d
   ```

5. Verify at `http://<host-ip>:32400/web` — your libraries, metadata, and watch history should all be present since the config directory is reused directly.

> **Note**: The `PUID`/`PGID` in the compose (default `1000`) must match the owner of your existing config files. Check with `ls -la ~/.config/deluge` or `ls -la /var/lib/plexmediaserver`.

## Updating services

```bash
cd services/<service-name>
docker compose pull
docker compose up -d
```

## Secrets reminder

- `PIHOLE_WEBPASSWORD` in `services/pihole/.env`
- `DB_PASSWORD` in `services/immich/.env`
- `TS_AUTHKEY` in every `.env` file

Do **not** commit `.env` files to version control. Add them to `.gitignore`:

```bash
echo "services/**/.env" >> .gitignore
echo "services/**/ts/" >> .gitignore
```
