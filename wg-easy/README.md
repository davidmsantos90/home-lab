# wg-easy

WireGuard VPN management stack with automatic DuckDNS updates and optional Tailnet-only UI access.

## Architecture

- **Dual-network design**: `wg-easy` and `tailscale` attach to both `wg_easy_internal` and `homelab` networks for interoperability
- **Dynamic egress interface (RFC-002)**: Automatically detects the correct outbound interface for NAT rules, preventing handshake failures when containers are on multiple networks
- **Tailscale Serve**: Private HTTPS access to the UI (no public exposure)
- **DuckDNS**: Dynamic DNS for the WireGuard UDP endpoint

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

## Validation

After startup, verify the dynamic egress interface is correctly configured:

```bash
# Check the default route and wg-easy interface
docker exec wg-easy ip route
docker exec wg-easy iptables -t nat -S

# The interface in the MASQUERADE rule must match the interface from `ip route show default`
```

Test VPN connectivity from a client:

```bash
# Should return the server's public IP, not the client's ISP IP
curl https://ifconfig.me
```

## Troubleshooting

**Symptom: Handshake succeeds but no Internet access**

The MASQUERADE rule is likely targeting the wrong interface (RFC-002 issue). Verify:

```bash
docker exec wg-easy ip route | grep default
docker exec wg-easy iptables -t nat -S | grep MASQUERADE
```

The interface in both commands must match.

## Useful links

- https://wg-easy.github.io/wg-easy/latest/
- https://www.duckdns.org/
- [RFC-002: Dynamic Egress Interface Detection](/Users/davsantos/github/misc/home-lab/wg-easy/docs/RFC-002-dynamic-egress-interface.md)
