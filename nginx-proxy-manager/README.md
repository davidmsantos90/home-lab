# Nginx Proxy Manager

Reverse proxy service for local domains and TLS management on the LAN.

## Dependencies

- Docker + Docker Compose v2
- Shared external `homelab` and `macvlan` networks (created by root [`compose.yaml`](/Users/davsantos/github/misc/home-lab/compose.yaml))
- Tailscale auth key

## Environment variables

Copy [`.env.example`](/Users/davsantos/github/misc/home-lab/nginx-proxy-manager/.env.example) to `.env` and set:

- `TS_AUTHKEY`, `TZ`
- `NPM_IP` (must be in the configured macvlan range and reserved in DHCP)
- `IMAGE_URL` if you want a pinned version

## Startup

```bash
cd nginx-proxy-manager
cp .env.example .env
docker compose up -d
```

## Useful links

- https://nginxproxymanager.com/guide/
- https://docs.docker.com/engine/network/drivers/macvlan/
