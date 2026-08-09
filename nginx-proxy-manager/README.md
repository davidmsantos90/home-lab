# Nginx Proxy Manager

Reverse proxy service for local domains and TLS management.

## Dependencies

- Docker + Docker Compose v2
- Shared external `homelab` and `macvlan` networks (created by root [`compose.yaml`](/Users/davsantos/github/misc/home-lab.worktrees/remove-tailscale-sidecars-simplify-network/compose.yaml))

## Environment variables

Copy [`.env.example`](/Users/davsantos/github/misc/home-lab.worktrees/remove-tailscale-sidecars-simplify-network/nginx-proxy-manager/.env.example) to `.env` and set:

- `TZ`
- `NPM_IP` (must be in your macvlan range and reserved in DHCP)
- `NPM_MAC` (pinned MAC for stable router ARP/IP-MAC binding)
- `PIHOLE_LAN_IP` (defaults to `192.168.1.60`)
- `DNS_FALLBACK` (defaults to `1.1.1.1`)
- `IMAGE_URL` if you want a pinned version

## Startup

```bash
cd nginx-proxy-manager
cp .env.example .env
docker compose up -d
```

## Notes

- This stack uses macvlan for LAN exposure and does not bind host ports `80/443/81`.
- On the shared `homelab` network, the container has static IP `192.168.100.5` for wg-easy NAT rules.

## Useful links

- https://nginxproxymanager.com/guide/
