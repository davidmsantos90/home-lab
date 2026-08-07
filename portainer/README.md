# Portainer

Web UI for Docker management, published on local network and Tailnet.

## Dependencies

- Docker + Docker Compose v2
- Shared external `homelab` network
- Tailscale auth key

## Environment variables

Copy [`.env.example`](/Users/davsantos/github/misc/home-lab/portainer/.env.example) to `.env` and set:

- `TS_AUTHKEY`, `TZ`
- `SERVICEPORT` (default `9000`)
- `DNS_SERVER` (default `192.168.1.60`, your Pi-hole) / `DNS_SERVER_FALLBACK`
  (default `1.1.1.1`) — DNS used by the tailscale sidecar for its own external
  lookups; the fallback is only used if `DNS_SERVER` is unreachable

## Startup

```bash
cd portainer
cp .env.example .env
docker compose up -d
```

## Useful links

- https://docs.portainer.io/start/install-ce/server/docker/linux
- https://github.com/portainer/portainer
