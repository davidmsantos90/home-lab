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

## Startup

```bash
cd portainer
cp .env.example .env
docker compose up -d
```

## Useful links

- https://docs.portainer.io/start/install-ce/server/docker/linux
- https://github.com/portainer/portainer
