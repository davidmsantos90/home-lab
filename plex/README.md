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
- `PLEX_CONFIG_PATH`, `PLEX_MEDIA_PATH`
- `DNS_SERVER` (default `192.168.1.60`, your Pi-hole) / `DNS_SERVER_FALLBACK`
  (default `1.1.1.1`) — DNS used by the tailscale sidecar for its own external
  lookups; the fallback is only used if `DNS_SERVER` is unreachable

## Startup

```bash
cd plex
cp .env.example .env
docker compose up -d
```

## Useful links

- https://support.plex.tv/articles/200264746-quick-start-step-by-step-guides/
- https://github.com/linuxserver/docker-plex
