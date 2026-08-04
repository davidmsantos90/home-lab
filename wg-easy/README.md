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
- `WG_VPN_DNS` (defaults to `10.200.0.60`) for new/updated WireGuard client DNS
- `WG_VPN_ALLOWED_IPS` (defaults to `10.200.0.0/24,192.168.1.0/24`) for new/updated client routes

### RFC-001 Overlap Subnet Translation (Optional)

For VPN clients connecting from overlapping private networks:

- `HOME_LAN_SUBNET` (default: `192.168.1.0/24`) — The real home LAN subnet
- `WG_TRANSLATED_LAN_SUBNET` (default: `10.200.0.0/24`) — Virtual subnet that represents home LAN resources to overlapping clients

When configured, overlapping clients keep their normal WireGuard tunnel IPs, but they access LAN resources through translated addresses inside `WG_TRANSLATED_LAN_SUBNET`. For example, a LAN host at `192.168.1.60` is reached as `10.200.0.60`.

### Important for wg-easy v15 hooks

`wg-easy` v15 stores WireGuard hooks in its internal DB (`/etc/wireguard/wg-easy.db`) and regenerates `wg0.conf` from that state. Because of this:

- Hook values persist across restarts
- Existing hooks can override new compose expectations
- Fresh starts should run a bootstrap step to set hooks (included in this stack)

## Startup

```bash
cd wg-easy
cp .env.example .env
docker compose up -d
```

The stack includes a one-shot bootstrap service ([bootstrap-hooks.sh](/Users/davsantos/github/misc/home-lab/wg-easy/bootstrap-hooks.sh)) that applies the working hooks through the wg-easy API after startup.

Check bootstrap result:

```bash
docker logs wg-easy-hooks-bootstrap
```

The bootstrap also updates wg-easy `userconfig` defaults:
- `defaultDns` <- `WG_VPN_DNS`
- `defaultAllowedIps` <- `WG_VPN_ALLOWED_IPS`

This ensures fresh starts pick up VPN DNS/routing defaults without manual UI edits.

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

### RFC-001 Overlap Subnet Validation

After configuring `HOME_LAN_SUBNET` and `WG_TRANSLATED_LAN_SUBNET`, verify the NETMAP rules:

```bash
# Check that NETMAP rules are installed
docker exec wg-easy iptables -t nat -S | grep NETMAP

# Expected output should show two NETMAP rules using your configured
# HOME_LAN_SUBNET and WG_TRANSLATED_LAN_SUBNET values.
```

To test from an overlapping network (e.g., another `192.168.1.0/24` LAN):
1. Ensure the client routes the translated subnet (`10.200.0.0/24`) through the tunnel
2. Connect the client from the overlapping network
3. Access LAN resources using translated addresses (for example `10.200.0.60` for `192.168.1.60`)
4. Verify: handshake succeeds, translated LAN resources are accessible, Internet remains reachable

### Working hook values (Admin -> Hooks)

Use these exact working values in `wg-easy` UI:

- **PreUp**: *(empty)*
- **PreDown**: *(empty)*

- **PostUp**

```sh
DEFAULT_IF=$(ip route show default | awk '{print $5}' | head -n1); T=${WG_TRANSLATED_LAN_SUBNET:-10.200.0.0/24}; H=${HOME_LAN_SUBNET:-192.168.1.0/24}; iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o "$DEFAULT_IF" -j MASQUERADE; modprobe xt_NETMAP || true; iptables -t nat -A PREROUTING -d "$T" -j NETMAP --to "$H"; iptables -t nat -A POSTROUTING -s "$H" -j NETMAP --to "$T"; iptables -A INPUT -p udp -m udp --dport 51820 -j ACCEPT; iptables -A FORWARD -i wg0 -j ACCEPT; iptables -A FORWARD -o wg0 -j ACCEPT;
```

- **PostDown**

```sh
DEFAULT_IF=$(ip route show default | awk '{print $5}' | head -n1); T=${WG_TRANSLATED_LAN_SUBNET:-10.200.0.0/24}; H=${HOME_LAN_SUBNET:-192.168.1.0/24}; iptables -t nat -D POSTROUTING -s 10.8.0.0/24 -o "$DEFAULT_IF" -j MASQUERADE; iptables -t nat -D PREROUTING -d "$T" -j NETMAP --to "$H"; iptables -t nat -D POSTROUTING -s "$H" -j NETMAP --to "$T"; iptables -D INPUT -p udp -m udp --dport 51820 -j ACCEPT; iptables -D FORWARD -i wg0 -j ACCEPT; iptables -D FORWARD -o wg0 -j ACCEPT;
```

Note: for this iptables build, `NETMAP` requires `--to` (not `--to-destination` / `--to-source`).

These values are also what the bootstrap service applies automatically on fresh starts.

### Hook backup/export

Run [backup-hooks.sh](/Users/davsantos/github/misc/home-lab/wg-easy/backup-hooks.sh) from [wg-easy/](/Users/davsantos/github/misc/home-lab/wg-easy):

```bash
./backup-hooks.sh
```

Custom target:

```bash
./backup-hooks.sh wg-easy ./data/backups
```

This exports:
- effective `PreUp/PostUp/PreDown/PostDown` from live `wg0.conf`
- current NAT table snapshot

## WireGuard access to other homelab services

From the compose files in this repository, WireGuard clients can reach services outside Tailnet when:
- the service is bound on the host (`0.0.0.0:<port>`) or has a reachable LAN/macvlan IP
- the relevant subnet/host is inside the client AllowedIPs

With the current stack:
- **Reachable over VPN**
  - Pi-hole DNS: `<vpn-view-of-host>:53/tcp,53/udp`
  - Pi-hole UI: `<vpn-view-of-host>:8080`
  - Immich: `<vpn-view-of-host>:2283`
  - Portainer: `<vpn-view-of-host>:9000`
  - Deluge: `<vpn-view-of-host>:8112`, torrent `6881/tcp+udp`
  - Plex: `<vpn-view-of-host>:32400`
  - Jellyfin: `<vpn-view-of-host>:8096`
  - NPM: `192.168.1.5` (or translated equivalent when overlapping)
- **Not intended over VPN**
  - wg-easy UI host bind is `127.0.0.1:51821` (Tailnet/local host only)

For overlapping clients, use translated addresses in `WG_TRANSLATED_LAN_SUBNET` (for example `192.168.1.60 -> 10.200.0.60`).

Important: if a client connected from a non-overlapping network (for example a
hotspot) can handshake but still cannot ping the normal WireGuard/LAN addresses,
fix that baseline path first. RFC-001 overlap validation depends on the vanilla
path already working.

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
