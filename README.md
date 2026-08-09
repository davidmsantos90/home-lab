# Home Lab

Self-hosted services running in Docker with a simplified network layout:

- no Tailscale sidecars
- shared `homelab` network for inter-container routing
- `macvlan` retained for NPM LAN IP and host port conflict avoidance
- direct host port publishing for app services that don't need macvlan
- Nginx Proxy Manager (NPM) for domain-based routing and TLS
- wg-easy for WireGuard remote access

## Project structure

```text
home-lab/
├── compose.yaml               # Creates shared homelab + macvlan networks
├── nginx-proxy-manager/
├── pihole/
├── immich/
├── portainer/
├── deluge/
├── plex/
├── jellyfin/
└── wg-easy/
```

## Services and local ports

| Service | Port(s) |
|---|---|
| Pi-hole | `53/tcp+udp`, `8080` |
| Immich | `2283` |
| Portainer | `9000` |
| Deluge | `8112`, `58846`, `6881/tcp+udp` |
| Plex | `32400` |
| Jellyfin | `8096` |
| Nginx Proxy Manager | `192.168.1.5` (via macvlan) |
| wg-easy | `51820/udp`, `127.0.0.1:51821` |

## Prerequisites

- Docker + Docker Compose v2
- Router port-forward for `51820/udp` to this Docker host (for WireGuard)

## Quick start

1. Create the shared networks:

   ```bash
   docker compose up
   ```

2. Configure each service:

   ```bash
   cd <service>
   cp .env.example .env
   # edit .env
   docker compose up -d
   ```

3. Start `nginx-proxy-manager` first if you want to route all service domains through it.

## NPM upstream targets

Services are now reachable on the shared `homelab` network via their app container names:

| Service | Upstream host | Upstream port |
|---|---|---|
| Pi-hole admin | `app-pihole` | `80` |
| Immich | `app-immich-server` | `2283` |
| Portainer | `app-portainer` | `9000` |
| Deluge | `app-deluge` | `8112` |
| Plex | `app-plex` | `32400` |
| Jellyfin | `app-jellyfin` | `8096` |

For host-native services (not containerized), use the `homelab` bridge gateway `192.168.100.1`.

NPM keeps its dedicated LAN IP via macvlan, so it can own `80/443/81` without colliding with host-bound ports.

## WireGuard (wg-easy)

`wg-easy` provides remote access to LAN services. DuckDNS updates the public IP and wg-easy serves client configuration/profile management.

- Public endpoint: `pimlicoa.duckdns.org:51820/udp`
- UI: `http://127.0.0.1:51821` on the host

The stack keeps overlap-subnet translation and DNS interception logic documented in the [wg-easy/](/Users/davsantos/github/misc/home-lab.worktrees/remove-tailscale-sidecars-simplify-network/wg-easy) folder.

## Relocating service data (`HOME_LAB_DIR`)

Each service has `HOME_LAB_DIR` in `.env.example` so config/state volumes can be moved to another path (for example, external storage). Media/library paths (`PLEX_MEDIA_PATH`, `JELLYFIN_MEDIA_PATH`, `DOWNLOADS_PATH`, `UPLOAD_LOCATION`) remain independent.

## Service management helper

Use [lab.sh](/Users/davsantos/github/misc/home-lab.worktrees/remove-tailscale-sidecars-simplify-network/lab.sh):

```bash
./lab.sh status
./lab.sh start pihole
./lab.sh restart immich
./lab.sh update
```

## Syncing environment files to Raspberry Pi

Use [sync-env.sh](/Users/davsantos/github/misc/home-lab.worktrees/remove-tailscale-sidecars-simplify-network/sync-env.sh):

```bash
./sync-env.sh
```

## Secrets reminder

- `PIHOLE_WEBPASSWORD` in `pihole/.env`
- `DB_PASSWORD` in `immich/.env`
- `DUCKDNS_TOKEN` and `WG_EASY_ADMIN_PASSWORD` in `wg-easy/.env`

Do not commit `.env` files:

```bash
echo "**/.env" >> .gitignore
```
