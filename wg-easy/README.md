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
- `HOME_LAN_SUBNET` (home LAN, default `192.168.1.0/24`)
- `WG_TRANSLATED_LAN_SUBNET` (virtual non-overlapping LAN presented to clients, default `10.200.0.0/24`)
- `WG_ALLOWED_IPS` (client routed subnet, default `10.200.0.0/24`)

## Startup

```bash
cd wg-easy
cp .env.example .env
docker compose up -d
```

## Overlapping subnet strategy (RFC)

When a remote client is on a LAN that overlaps your home LAN (for example both are `192.168.1.0/24`), direct access to home-LAN IPs will fail due to client-side routing preference.

This stack applies a translation layer in `wg-overlap-fix`:

- Client targets virtual subnet `WG_TRANSLATED_LAN_SUBNET` (default `10.200.0.0/24`)
- Traffic is translated to `HOME_LAN_SUBNET` (default `192.168.1.0/24`) with NETMAP rules
- Return traffic is translated back to the virtual subnet

This keeps clients on a non-overlapping destination range without changing your home LAN.

## Useful links

- https://wg-easy.github.io/wg-easy/latest/
- https://www.duckdns.org/
- [RFC-001: WireGuard remote access strategy](/Users/davsantos/github/misc/home-lab/wg-easy/docs/RFC-001-wireguard-remote-access.md)
