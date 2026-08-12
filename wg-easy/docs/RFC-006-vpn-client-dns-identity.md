# RFC-006 — VPN Client DNS Identity Preservation

## Status

Accepted

## Problem

Pi-hole's Query Log is one of the main ways to audit/observe what's
happening on the network — but for every VPN client, every single DNS
query showed up attributed to one fixed source: the `dnsmasq` sidecar
container's own IP, never the real client.

This is a side effect of RFC-001/RFC-003: the WireGuard interface's DNS
config points clients at a gateway/dnsmasq forwarder so that
`pimlicoa.duckdns.org` (and its subdomains) can be rewritten to a
translated address, avoiding a routing collision for clients whose own
local network overlaps with the home LAN's subnet (`192.168.1.0/24`). Since
every VPN client query was blindly redirected through this app-layer
forwarder regardless of what domain it was for, dnsmasq always
re-originated the query with its own source IP before forwarding it on to
Pi-hole — Pi-hole never saw the original client at all.

**Peer identity for actual service traffic** (NPM, Immich, Plex, etc.) was
already unaffected by this — NETMAP only rewrites destination addresses,
never source, so the client's real WireGuard tunnel IP survives all the way
to those services. This RFC is specifically about DNS.

## Options considered

1. **Bypass dnsmasq entirely.** Solves identity completely, but throws away
   the RFC-001 rewrite — breaks any overlapping-subnet client's access to
   `pimlicoa.duckdns.org` and everything behind it. Rejected outright.

2. **Manual log correlation.** dnsmasq's own log (`docker logs
   dnsmasq-wg-easy`) does show the real client IP per query, at the app
   layer, before it re-originates the request. In theory the two logs could
   be cross-referenced by timestamp. No architecture change, but not
   integrated into Pi-hole's UI, and fragile to do by hand. Considered a
   fallback if nothing better is viable, not a primary solution.

3. **Pi-hole-side per-client answers.** Pi-hole's Local DNS Records are
   global, not per-querier-subnet-aware, and dnsmasq's own
   `localise-queries` feature (which *can* return different answers based on
   the querier's subnet) doesn't help either: it needs the querier's subnet
   to match either the real LAN subnet or another subnet dnsmasq is
   configured to recognize, and VPN clients' real WireGuard tunnel subnet
   (`10.8.0.0/24`) is neither the real LAN subnet nor the translated subnet
   used for the RFC-001 rewrite — there's no subnet-based rule that could
   distinguish "give this client the translated answer" from "give this
   client the real one." Ruled out — doesn't actually work.

4. **Client-side split-DNS.** Push a WireGuard client config that only
   routes `pimlicoa.duckdns.org` queries through the tunnel/dnsmasq, letting
   everything else resolve via the client's normal system DNS — no
   server-side interception needed at all for non-matching domains.
   Technically the cleanest option where it's supported (e.g. Linux
   `systemd-resolved` via a `Domains=` directive), but this VPN exists
   specifically to support devices that **can't** use Tailscale, which in
   practice means a mix of platforms — Windows, macOS, iOS, Android — and
   per-domain DNS routing isn't consistently available (or user-configurable
   at all) across that mix. Rejected as the *primary* mechanism, since it
   would silently fail to preserve identity on exactly the platforms this
   whole VPN setup is meant to serve, but nothing prevents layering it on
   top for clients where it *is* supported.

5. **Narrow DNS interception scope with an L7 content match (chosen).** DNS
   names are wire-encoded as length-prefixed labels ending in a zero byte —
   e.g. `pimlicoa.duckdns.org` becomes
   `\x08pimlicoa\x07duckdns\x03org\x00`. Any subdomain shares this exact
   byte suffix. A single `iptables -m string` rule can match that suffix
   anywhere in the UDP/TCP payload, so only queries for that one domain (and
   its subdomains) get redirected to dnsmasq — every other query is left
   completely alone and reaches Pi-hole directly (once `WG_VPN_DNS` points
   at Pi-hole's translated address instead of the gateway), preserving the
   client's real tunnel IP for the vast majority of DNS traffic.

## Decision

Implement option 5. Concretely:

- `WG_VPN_DNS` now defaults to `10.200.0.60,1.1.1.1` (Pi-hole's translated
  address), not the wg0 gateway. See RFC-003's "superseded default, again"
  update for why this is now safe.
- `bootstrap-hooks.sh` computes the DNS wire-format hex bytes for
  `WG_EASY_HOST` (`domain_to_wire_hex()`) at bootstrap time, and adds
  `-m string --algo bm --hex-string "|<hex>|" --icase` to both DNS DNAT
  rules (UDP and TCP), scoping the redirect-to-dnsmasq behavior to just that
  domain.
- `--icase` (case-insensitive match) guards against DNS 0x20-encoding (some
  resolvers randomize query name case as an anti-spoofing measure), which
  would otherwise occasionally cause a same-domain query to slip through the
  match unrewritten.
- `dnsmasq.conf`'s `server=` upstream forward line is now only a defensive
  fallback — in normal operation, only `pimlicoa.duckdns.org` queries should
  ever reach dnsmasq at all, and those are always answered directly by the
  `address=` rewrite rule.

## Accepted tradeoffs

This is the best **available** option given the constraints, not a perfect
one:

- **DNS 0x20-encoding**: `--icase` covers the common case, but is a
  case-insensitive *byte* match — it can't perfectly replicate a resolver's
  exact randomization scheme in pathological edge cases. Low risk in
  practice for a single, mostly-static domain.
- **Kernel module dependency**: requires `xt_string` to be available on the
  Pi (`modprobe xt_string`, mirroring the existing `xt_NETMAP` dependency
  already relied on for the overlap-subnet fix). Not yet a problem in
  practice, but worth knowing if this is ever ported to a different host.
- **More fragile than a plain port-based rule**: matching on packet content
  is inherently more complex than matching on address/port headers alone,
  and needs to be kept in sync if `WG_EASY_HOST` ever changes (handled
  automatically, since the hex is derived from `WG_EASY_HOST` at bootstrap
  time — but still a more intricate rule to reason about than a bare DNAT).

## Independent of future work

This change is fully independent of both peer-to-peer client communication
(governed by client `AllowedIPs` and the `FORWARD` chain, not
`PREROUTING`/DNS matching) and per-peer ACLs (RFC-005, also governed by the
`FORWARD` chain). Neither is blocked by this change.

## Future improvement: transparent proxying (TPROXY)

The L7 content-match approach still loses identity for the one domain that
*must* go through dnsmasq (`pimlicoa.duckdns.org` and its subdomains) —
acceptable today since NPM's own access logs already show real client IPs
for anything reached through it, but not a complete fix for Pi-hole's Query
Log specifically.

A theoretically complete fix exists: instead of dnsmasq acting as a normal
forwarder (which necessarily re-originates a query under its own source
IP), a proxy could use Linux's `IP_TRANSPARENT` socket option plus policy
routing (`ip rule`/`ip route` with fwmarks) so its outbound query to
Pi-hole appears to originate from the *original* client's real IP. Pi-hole
would then log the true client for every query, including the home domain —
no domain-scoping needed at all.

This isn't implemented because it's a materially heavier lift than the
current approach:

- Stock `dnsmasq` doesn't support TPROXY — a different/custom proxy would be
  needed just for this.
- Requires mark-based policy routing (`iptables -t mangle`,
  `ip rule add fwmark ... lookup ...`, a dedicated local routing table to
  loop "spoofed-source" replies back correctly) — a new class of networking
  configuration not currently used anywhere in this stack.
- Higher risk of subtle failures (asymmetric routing / routing loops are
  the classic TPROXY failure mode), harder to debug than the current
  DNAT-based rules.

Worth revisiting if 100% DNS identity coverage (including the
`pimlicoa.duckdns.org` domain itself) becomes a real requirement rather than
a nice-to-have.

## Investigated and rejected: preserving identity for *all* LAN-bound traffic

Beyond the DNS-specific case above, a broader question came up: could VPN
clients' real tunnel IP (`10.8.0.x`, assigned per-peer by wg-easy) be
preserved for **all** LAN-bound traffic, not just DNS — i.e. stop
masquerading VPN clients to the Pi's own address entirely for `192.168.1.0/24`
destinations, so Pi-hole's Query Log (and any other LAN service's own logs)
would show each client's real, stable tunnel IP directly?

Mechanically this only requires excluding LAN-destined traffic from the
existing blanket MASQUERADE rule:

```
iptables -t nat -A POSTROUTING -s 10.8.0.0/24 ! -d 192.168.1.0/24 -o "$DEFAULT_IF" -j MASQUERADE
```

Internet-bound traffic keeps being masqueraded (required — the public
internet has no route back to RFC1918 space, nor should it), while
LAN-bound traffic would leave with its real `10.8.0.x` source intact.

This was rejected — not because it's technically wrong, but because it has a
hard external dependency that isn't satisfiable here: for a LAN device
(Pi-hole, or anything else) to actually reply to a `10.8.0.x` source, the
**router** needs a static route telling it `10.8.0.0/24` lives behind the
Pi's real LAN IP. Checked and confirmed: **the router in this setup does not
support static routes** (no routing-table page, only static ARP — a
same-segment IP↔MAC pinning feature, unrelated to cross-subnet routing).
Without that route, LAN replies to a masquerade-free client would simply be
undeliverable.

A parallel idea — giving each peer a dedicated, real LAN-routable identity
via a new `macvlan` network on the physical NIC (avoiding the need for a
router-side route, since a macvlan address is natively ARPable on the LAN) —
was also considered, but requires provisioning a new IP per peer as clients
are added/removed (wg-easy has no webhook/event mechanism for this,
confirmed via its source — only manual polling of `GET /api/client` would
work), materially more ongoing complexity than this fix is worth right now
given the router constraint above makes the *simpler* variant of this idea
already a non-starter.

**Status**: on hold. Revisit only if the router is ever replaced with one
that supports static routes, or if per-peer LAN identity becomes a hard
requirement significant enough to justify a macvlan-based peer-provisioning
script despite the added maintenance surface.

## Validation Plan

1. Confirm `docker exec wg-easy iptables -t nat -S | grep 5353` shows the
   DNS DNAT rules with `-m string ... --hex-string ... --icase`.
2. From a connected VPN client:
   - `nslookup nginx.pimlicoa.duckdns.org` resolves to the translated
     address (`10.200.0.60`), confirming interception still works.
   - `nslookup example.com` (or any non-`pimlicoa.duckdns.org` domain)
     resolves normally, and Pi-hole's Query Log shows the client's real
     WireGuard tunnel IP (e.g. `10.8.0.x`) as the requester, not dnsmasq's
     container IP.
3. Confirm existing clients still need their WireGuard config regenerated
   to pick up the new `WG_VPN_DNS` default — `bootstrap-hooks.sh`'s
   `defaultDns` update only affects newly created clients, same limitation
   as any other `userconfig` default change.

## Related

- [RFC-001 — WireGuard Remote Access](./RFC-001-wireguard-remote-access.md)
- [RFC-003 — WireGuard DNS via Pi-hole](./RFC-003-wireguard-dns-via-pihole.md)
- [RFC-005 — Per-Client Access Restriction](./RFC-005-per-client-access-restriction.md)
- [wg-easy/DNS_INTERCEPTION.md](../DNS_INTERCEPTION.md)
- [wg-easy/bootstrap-hooks.sh](../bootstrap-hooks.sh)
- [iptables string match extension](https://man7.org/linux/man-pages/man8/iptables-extensions.8.html)
