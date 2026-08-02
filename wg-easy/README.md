# wg-easy

WireGuard VPN management stack with automatic DuckDNS updates and optional Tailnet-only UI access.

## Dependencies

- Docker + Docker Compose v2
- Shared external `homelab` network
- DuckDNS token and domain
- Router port forward for UDP `51820`
- Tailscale auth key (for private Tailnet UI)

## Environment variables

Copy [`.env.example`](/Users/davsantos/github/misc/home-lab/wg-easy/.env.example) to `.env` and set:

- `DUCKDNS_TOKEN`
- `TS_AUTHKEY`
- `WG_EASY_HOST` (defaults to `pimlicoa.duckdns.org`)
- `WG_EASY_ADMIN_USERNAME`, `WG_EASY_ADMIN_PASSWORD`
- `TZ`

## Startup

```bash
cd wg-easy
cp .env.example .env
docker compose up -d
```

## Useful links

- https://wg-easy.github.io/wg-easy/latest/
- https://www.duckdns.org/
