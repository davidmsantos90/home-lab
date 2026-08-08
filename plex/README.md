# Plex

Self-hosted media server exposed locally and through Tailnet.

## Dependencies

- Docker + Docker Compose v2
- Shared external `homelab` network
- Tailscale auth key
- Optional Plex claim token for first setup

## Environment variables

Copy [`.env.example`](/Users/davsantos/github/misc/home-lab/plex/.env.example) to `.env` and set:

- `TS_AUTHKEY`, `TZ`
- `PLEX_CLAIM` (for first run)
- `HOME_LAB_DIR` (base dir for config/state; defaults to `.`)
- `PLEX_MEDIA_PATH` (your media library location — set this, no sensible default)

## Startup

```bash
cd plex
cp .env.example .env
docker compose up -d
```

## Useful links

- https://support.plex.tv/articles/200264746-quick-start-step-by-step-guides/
- https://github.com/linuxserver/docker-plex
