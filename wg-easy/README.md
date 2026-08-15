# wg-easy

WireGuard VPN management stack with automatic DuckDNS updates.

## Architecture

- `wg-easy` attaches to both `wg_easy_internal` and `homelab` networks for interoperability
- **Dynamic egress interface (RFC-002)**: Automatically detects the correct outbound interface for NAT rules, preventing handshake failures when containers are on multiple networks
- **DuckDNS**: Dynamic DNS for the WireGuard UDP endpoint
- Admin UI is bound to `127.0.0.1:51821` on the host only (no public exposure), and is additionally reachable by authenticated VPN clients at a dedicated translated IP (see "Accessing admin UIs over the wg-easy VPN" in the root [README.md](/Users/davsantos/github/misc/home-lab/README.md))
- RFC-007's future management UI is planned as a React app using [hv-uikit-react](https://github.com/pentaho/hv-uikit-react)
- The access-control synchronizer can also serve a read-only API (`./lab.sh access-sync --serve`) with live peer discovery and policy preview data for future UI work

## Dependencies

- Docker + Docker Compose v2
- Shared external `homelab` network
- DuckDNS token and domain
- Router port forward for UDP `51820`

## Environment variables

Copy [`.env.example`](/Users/davsantos/github/misc/home-lab/wg-easy/.env.example) to `.env` and set:

- `DUCKDNS_TOKEN`
- `WG_EASY_HOST` (defaults to `pimlicoa.duckdns.org`)
- `WG_EASY_ADMIN_USERNAME`, `WG_EASY_ADMIN_PASSWORD`
- `TZ`
- `WG_VPN_DNS` (defaults to `10.8.0.1`) for new/updated WireGuard client DNS. Peers query the wg0 gateway, and wg-easy DNATs wg0 UDP/TCP port 53 to Pi-hole internally (`DNSMASQ_IP:5353`). `10.200.0.0/24` remains reserved for anti-conflict LAN translation, not as the peer DNS endpoint.
- `WG_VPN_ALLOWED_IPS` (defaults to `10.200.0.0/24,192.168.1.0/24`) for new/updated client routes
- `WG_VPN_PERSISTENT_KEEPALIVE` (defaults to `25`) seconds between client keepalive packets; prevents NAT/router mappings from expiring during idle periods (see [Troubleshooting](#troubleshooting))
- `HOME_LAB_DIR` (defaults to `.`) base directory for WireGuard config/keys — set this to move this stack's persistent data elsewhere, e.g. an external drive (see the root [README.md](/Users/davsantos/github/misc/home-lab/README.md#relocating-a-services-data-home_lab_dir))

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
- `defaultPersistentKeepalive` <- `WG_VPN_PERSISTENT_KEEPALIVE`

This ensures fresh starts pick up VPN DNS/routing defaults without manual UI edits.

> **Note:** `defaultPersistentKeepalive` only affects **newly created** clients —
> it's baked into each client's config when generated, not applied
> retroactively. Existing clients that were created before this default was
> set will keep `PersistentKeepalive = 0` (disabled) until you either:
> - Edit the client in the wg-easy web UI (Admin -> Clients -> client ->
>   "Persistent Keepalive") and set it to `25`, or
> - Delete and recreate the client (re-scan the QR code / re-download the
>   config on the device)

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

### NPM access via generic NETMAP

NPM no longer needs a dedicated NAT exception. Since removing the macvlan
network, NPM publishes its ports directly on the host and is reachable at
the Pi's own real LAN IP (`192.168.1.60`). The existing generic NETMAP rule
(`10.200.0.0/24 → 192.168.1.0/24`) already covers it — overlapping VPN
clients reach NPM at `10.200.0.60`, translated transparently to
`192.168.1.60`. Only the wg-easy admin UI needs its own dedicated exception
rule (see below), since it lives on the `homelab` bridge — a different
subnet entirely, unreachable via the home-LAN NETMAP rule.

```sh
iptables -t nat -A PREROUTING -d 10.200.0.9/32 -j DNAT --to 192.168.100.9
iptables -t nat -A POSTROUTING -s 192.168.100.9/32 -j SNAT --to 10.200.0.9
```

Why:
- `DNAT` rewrites the destination so wg-easy sends admin-UI traffic to the
  reachable `homelab` IP
- `SNAT` rewrites the reply so the VPN client still sees `10.200.0.9`
- this exception must run before the subnet-wide `NETMAP` rule, or the
  broader translation would claim `10.200.0.9` first (it's inside the
  translated subnet)

### DNS forwarding and local answer overrides

**Problem**: Services like NPM need different DNS responses for different client types:
- LAN clients: resolve to physical IP `192.168.1.60` (direct access)
- Tailnet clients: resolve to physical IP `192.168.1.60` (routed via Tailscale)
- VPN clients: need translated IP `10.200.0.60` (only reachable via NETMAP)

**Solution**: all VPN client DNS queries go to the wg0 gateway, which DNATs them
to dnsmasq/Pi-hole. dnsmasq then rewrites only the local homelab hostname
responses that need translated addresses for overlapping clients.

The setup includes:
- **dnsmasq service** in wg-easy compose: listens on `127.0.0.1:5353`, forwards upstream to Pi-hole
- **DNS DNAT rules** in PostUp hooks: redirect all wg0 port 53 traffic to `DNSMASQ_IP:5353`
- **dnsmasq.conf**: defines local answer overrides (e.g., `nginx.pimlicoa.duckdns.org` → `10.200.0.60`)

When a VPN client queries DNS:
1. DNS request hits port 53 on wg0
2. iptables DNAT sends it to `DNSMASQ_IP:5353` (dnsmasq)
3. dnsmasq checks its local overrides
4. If a match is found, it answers with the translated address
5. Otherwise dnsmasq forwards upstream to Pi-hole
6. VPN client receives the answer and routes accordingly

Configure local DNS overrides in [`dnsmasq.conf`](./dnsmasq.conf). A single
wildcard rule covers the whole domain (and all its subdomains), so any local
homelab host under it — current or future — is translated automatically:

```
address=/pimlicoa.duckdns.org/10.200.0.60
```

Only add a separate, more specific `address=/.../` line if some other
subdomain must resolve to a *different* address than the wildcard — for
example, if you later move a service to another machine/IP:

```
address=/pimlicoa.duckdns.org/10.200.0.60      # wildcard default
address=/immich.pimlicoa.duckdns.org/10.200.0.42   # override: immich moved elsewhere
```

dnsmasq always matches the most specific domain rule, regardless of line
order, so an explicit subdomain rule overrides the wildcard for that one
subdomain while everything else keeps using the default.

See [HOOKS_SETUP.md](./HOOKS_SETUP.md) for complete hook configuration including DNS forwarding.

## WireGuard access to other homelab services

From the compose files in this repository, WireGuard clients can reach services outside Tailnet when:
- the service is bound on the host (`0.0.0.0:<port>`) or has a reachable LAN IP
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
  - NPM: `192.168.1.60` (or translated equivalent when overlapping)
- **Not intended over VPN**
  - wg-easy UI host bind is `127.0.0.1:51821` (Tailnet/local host only)

For overlapping clients, use translated addresses in `WG_TRANSLATED_LAN_SUBNET` (for example `192.168.1.60 -> 10.200.0.60`).

Important: if a client connected from a non-overlapping network (for example a
hotspot) can handshake but still cannot ping the normal WireGuard/LAN addresses,
fix that baseline path first. RFC-001 overlap validation depends on the vanilla
path already working.

## Restricting a client's access (current limitations)

The wg-easy UI lets you set a custom **Allowed IPs** value per client, which
looks like a per-client firewall control, but in this stack it's weaker than
it appears:

- **AllowedIPs is not a server-side ACL.** It only controls (a) what routes
  are written into the client's own generated config, and (b) an anti-spoof
  check on the packet's *source* address. It does **not** restrict which
  *destinations* the server will forward a client's decrypted traffic to.
  Restricting a client's AllowedIPs to a single host only stops that
  client's own OS from routing elsewhere by default — a client who edits
  their own `.conf` to add broader routes is not blocked server-side, because
  [`bootstrap-hooks.sh`](./bootstrap-hooks.sh) installs a blanket
  `iptables -A FORWARD -i wg0 -j ACCEPT` (and the matching `-o wg0` rule) that
  accepts all wg0 traffic to any destination, for every client.
- **Almost everything goes through one IP.** Nearly all homelab services are
  reverse-proxied through NPM at a single translated address (`10.200.0.60`).
  NPM routes by HTTP `Host` header, not by source IP or destination port, so
  scoping a client's `AllowedIPs` down to `10.200.0.60/32` doesn't distinguish
  between individual services — a client that can reach NPM at all can reach
  every proxy host behind it (Plex, Immich, Portainer, etc.), unless NPM's own
  per-proxy-host **Access Lists** feature is also used to restrict by source
  IP (see below).
- **Direct-IP access bypasses NPM (and its Access Lists) entirely.** Because
  each client's real WireGuard tunnel address (e.g. `10.8.0.5`) is preserved
  all the way to NPM (no SNAT is applied on that path — see
  [`bootstrap-hooks.sh`](./bootstrap-hooks.sh)'s NAT rules), NPM Access Lists
  keyed on that address do work for anything routed *through* NPM by domain
  name. But nothing today stops a client from hitting a service directly by
  translated/LAN IP and port (e.g. `10.200.0.32:32400` for Plex), completely
  skipping NPM and any Access List configured there — because of the blanket
  `FORWARD` accept described above.

**Practical mitigations today:**

1. Use NPM **Access Lists** (Admin -> Access Lists) per proxy host to restrict
   *which domains* a given client IP may reach through NPM.
2. Treat WireGuard client `AllowedIPs` as advisory routing hints for
   well-behaved clients, not a security boundary.
3. Real per-client, per-destination enforcement requires server-side iptables
   rules scoped to each client's tunnel IP — this is not implemented yet.
   See [RFC-005](./docs/RFC-005-per-client-access-restriction.md) for the
   planned design.

## Troubleshooting

**Symptom: Handshake succeeds but no Internet access**

The MASQUERADE rule is likely targeting the wrong interface (RFC-002 issue). Verify:

```bash
docker exec wg-easy ip route | grep default
docker exec wg-easy iptables -t nat -S | grep MASQUERADE
```

The interface in both commands must match.

**Symptom: VPN client gets disconnected / stops reaching services after being idle (1-2 hours)**

Usually caused by a client's `PersistentKeepalive` being `0` (disabled), so a
NAT device (router, carrier-grade NAT, or the client's own OS) silently drops
the idle UDP mapping after a timeout — the tunnel goes stale until the client
manually reconnects. Fix by setting a keepalive:

- **New clients**: `WG_VPN_PERSISTENT_KEEPALIVE` (default `25`, applied
  automatically by the bootstrap script) already covers this
- **Existing clients created before this default was set**: edit the client
  in the wg-easy web UI (Admin -> Clients -> client -> "Persistent
  Keepalive" -> `25`), or delete and recreate the client to pick up the new
  default

## Useful links

- https://wg-easy.github.io/wg-easy/latest/
- https://www.duckdns.org/
- [RFC-002: Dynamic Egress Interface Detection](/Users/davsantos/github/misc/home-lab/wg-easy/docs/RFC-002-dynamic-egress-interface.md)
- [RFC-005: Per-Client Access Restriction (proposed)](/Users/davsantos/github/misc/home-lab/wg-easy/docs/RFC-005-per-client-access-restriction.md)
