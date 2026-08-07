# Deluge

BitTorrent client stack with web UI and torrent ports exposed locally.

## Dependencies

- Docker + Docker Compose v2
- Shared external `homelab` network
- Tailscale auth key

## Environment variables

Copy [`.env.example`](/Users/davsantos/github/misc/home-lab/deluge/.env.example) to `.env` and set:

- `TS_AUTHKEY`, `TZ`
- `DELUGE_CONFIG_PATH`, `DOWNLOADS_PATH`
- `SERVICEPORT` (default `8112`)
- `DNS_SERVER` (default `192.168.1.60`, your Pi-hole) / `DNS_SERVER_FALLBACK`
  (default `1.1.1.1`) — DNS used by the tailscale sidecar for its own external
  lookups; the fallback is only used if `DNS_SERVER` is unreachable

## Startup

```bash
cd deluge
cp .env.example .env
docker compose up -d
```

## Useful links

- https://dev.deluge-torrent.org/wiki/UserGuide
- https://github.com/linuxserver/docker-deluge
