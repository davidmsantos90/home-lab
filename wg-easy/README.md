# wg-easy

WireGuard VPN stack with:

- automatic DuckDNS updates
- overlap-subnet translation support
- DNS interception for VPN clients

## Dependencies

- Docker + Docker Compose v2
- Shared external `homelab` network
- DuckDNS token and domain
- Router port-forward for UDP `51820`

## Environment variables

Copy [`.env.example`](/Users/davsantos/github/misc/home-lab.worktrees/remove-tailscale-sidecars-simplify-network/wg-easy/.env.example) to `.env` and set:

- `DUCKDNS_TOKEN`
- `WG_EASY_HOST` (defaults to `pimlicoa.duckdns.org`)
- `WG_EASY_ADMIN_USERNAME`, `WG_EASY_ADMIN_PASSWORD`
- `TZ`
- `HOME_LAB_DIR`
- optional overlap/DNS settings (`HOME_LAN_SUBNET`, `WG_TRANSLATED_LAN_SUBNET`, `WG_VPN_DNS`, `WG_VPN_ALLOWED_IPS`, `WG_VPN_PERSISTENT_KEEPALIVE`)

## Startup

```bash
cd wg-easy
cp .env.example .env
docker compose up -d
```

The one-shot bootstrap service applies hook rules and default user config through the wg-easy API.

## UI and endpoint

- VPN endpoint: `${WG_EASY_HOST}:51820/udp`
- UI: `http://127.0.0.1:51821`

## Additional docs

- [HOOKS_SETUP.md](/Users/davsantos/github/misc/home-lab.worktrees/remove-tailscale-sidecars-simplify-network/wg-easy/HOOKS_SETUP.md)
- [DNS_INTERCEPTION.md](/Users/davsantos/github/misc/home-lab.worktrees/remove-tailscale-sidecars-simplify-network/wg-easy/DNS_INTERCEPTION.md)
- [docs/](/Users/davsantos/github/misc/home-lab.worktrees/remove-tailscale-sidecars-simplify-network/wg-easy/docs)
