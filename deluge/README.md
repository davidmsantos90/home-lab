# Deluge

BitTorrent client stack with web UI and torrent ports exposed locally.

## Dependencies

- Docker + Docker Compose v2
- Shared external `homelab` network
- Tailscale auth key

## Environment variables

Copy [`.env.example`](/Users/davsantos/github/misc/home-lab/deluge/.env.example) to `.env` and set:

- `TS_AUTHKEY`, `TZ`
- `HOME_LAB_DIR` (base dir for config/state/downloads)
- `DOWNLOADS_PATH` (optional override for downloads location)
- `SERVICEPORT` (default `8112`)

## Startup

```bash
cd deluge
cp .env.example .env
docker compose up -d
```

## Useful links

- https://dev.deluge-torrent.org/wiki/UserGuide
- https://github.com/linuxserver/docker-deluge
