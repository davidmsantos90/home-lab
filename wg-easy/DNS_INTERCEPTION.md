# DNS Interception for VPN Clients

This document explains how DNS interception works in wg-easy and how to troubleshoot common issues.

## Architecture

> **RFC-006 update**: DNS interception now only redirects queries whose
> content matches `pimlicoa.duckdns.org` (or a subdomain) to dnsmasq.
> Everything else bypasses dnsmasq entirely, reaching Pi-hole directly via
> the existing NETMAP translation — this preserves the client's real
> WireGuard tunnel IP in Pi-hole's Query Log for the vast majority of
> traffic. See [RFC-006](./docs/RFC-006-vpn-client-dns-identity.md) for the
> full rationale and the tradeoffs of this approach.

```
VPN Client (macOS/Linux)
    ↓
    ├─ Query: nginx.pimlicoa.duckdns.org on port 53
    │  (Configured DNS: 10.200.0.60 - Pi-hole's translated address)
    ↓
WireGuard Interface (wg0) on Raspberry Pi
    ↓
iptables DNAT Rule (content-matched)
    ├─ Matches: -i wg0 -p udp --dport 53 -m string --hex-string <pimlicoa.duckdns.org wire bytes> --icase
    └─ Action: DNAT --to-destination 172.28.0.2:5353 (dnsmasq container IP)
    ↓
dnsmasq Container (172.28.0.2)
    ├─ Listen: 0.0.0.0:5353 (all interfaces)
    ├─ Upstream: 10.200.0.60 (Pi-hole, defensive fallback only)
    └─ Rewrite Rule: nginx.pimlicoa.duckdns.org → 10.200.0.60
    ↓
Response: 10.200.0.60
    ↓
iptables MASQUERADE Rule
    ├─ Matches: -d 172.28.0.2/32 -p udp --dport 5353
    └─ Action: MASQUERADE (rewrites source to appear from wg-easy)
    ↓
VPN Client receives: 10.200.0.60
    └─ Routes through wg0 tunnel to 10.200.0.60, NETMAP-translated to
       192.168.1.60 (the Pi's own real LAN IP, where NPM listens directly)
```

For **any other domain** (the vast majority of queries), the DNS DNAT rule
above simply doesn't match, so the packet falls through untouched to the
generic NETMAP rule:

```
VPN Client
    ↓
    └─ Query: example.com on port 53 (same configured DNS: 10.200.0.60)
    ↓
iptables DNAT Rule (content-matched) — doesn't match, falls through
    ↓
iptables NETMAP Rule
    ├─ Matches: -d 10.200.0.0/24 -j NETMAP --to 192.168.1.0/24
    └─ Action: rewrites destination only (10.200.0.60 → 192.168.1.60),
       source IP untouched
    ↓
Pi-hole (192.168.1.60) sees the query from the client's real tunnel IP
```

## How It Works

### 1. VPN Client Configuration
The VPN client is configured to use **Pi-hole's translated address** directly as DNS — not the VPN gateway:

```
# On WireGuard config (macOS, Linux, etc.)
DNS = 10.200.0.60
```

**Why not the gateway?** Historically (RFC-003) DNS had to point at the
gateway (`10.200.0.1`) because the old DNS DNAT rule matched purely on
`-i wg0 --dport 53`, with no awareness of destination or content — pointing
straight at Pi-hole bypassed it entirely, and no rewrite ever happened for
`pimlicoa.duckdns.org`. Since the rule now matches on **domain content**
instead (see below), it still catches those queries no matter which
address they're sent to — so DNS can point directly at Pi-hole, and every
other query benefits from not needing interception at all.

### 2. iptables DNAT Interception (content-scoped)
When a VPN client sends a DNS query on the wg0 interface, iptables only
intercepts it if the packet's payload contains `pimlicoa.duckdns.org`'s
DNS wire-format bytes:

```bash
# From bootstrap-hooks.sh PostUp (DNS_MATCH_HEX computed at bootstrap time
# from WG_EASY_HOST via domain_to_wire_hex())
iptables -t nat -A PREROUTING -i wg0 -p udp --dport 53 -m string --algo bm --hex-string "|0870696d6c69636f61076475636b646e73036f726700|" --icase -j DNAT --to-destination 172.28.0.2:5353
iptables -t nat -A PREROUTING -i wg0 -p tcp --dport 53 -m string --algo bm --hex-string "|0870696d6c69636f61076475636b646e73036f726700|" --icase -j DNAT --to-destination 172.28.0.2:5353
```

This rule:
- Matches DNS packets on the wg0 interface whose payload contains the wire
  encoding of `pimlicoa.duckdns.org` (length-prefixed labels ending in a
  zero byte — any subdomain shares the same byte suffix, so this one rule
  covers the whole domain).
- `--icase` makes the match case-insensitive, guarding against DNS
  0x20-encoding (some resolvers randomize query name case as an
  anti-spoofing measure) causing an occasional missed match.
- Only matched packets are redirected to dnsmasq (`172.28.0.2:5353`) —
  everything else is left completely alone by this rule.

**Rule order matters**: this DNAT rule must still be placed **before** the
wg-easy-admin exception rule and the NETMAP rules in PREROUTING, since both
`10.200.0.1` (the gateway) and `10.200.0.60` (Pi-hole's translated address,
now the configured DNS) fall inside the translated subnet
(`10.200.0.0/24`). In iptables' `nat` table, a packet stops being evaluated
by further rules in the same chain once it matches a NAT target — if
NETMAP ran first, a `pimlicoa.duckdns.org` query sent to `10.200.0.60`
would get silently rewritten to `192.168.1.60` before the DNS rule ever
saw it, and would never reach dnsmasq for rewriting.

### 3. dnsmasq Domain Rewriting
dnsmasq receives the redirected query and applies rewrite rules:

```bash
# From dnsmasq.conf
address=/pimlicoa.duckdns.org/10.200.0.60   # wildcard: covers all subdomains
server=10.200.0.60  # Defensive fallback only — see below
```

For this example:
- Query for `nginx.pimlicoa.duckdns.org` (or any other subdomain, e.g. `immich.`, `portainer.`) → returns `10.200.0.60` (locally rewritten)
- Since the PostUp rule now only ever redirects `pimlicoa.duckdns.org`
  queries to dnsmasq in the first place, the `server=` upstream line is a
  defensive fallback that should rarely (if ever) be exercised in practice.

### 4. MASQUERADE Return Traffic
Response traffic from dnsmasq needs to appear to come from wg-easy, not from dnsmasq:

```bash
# From bootstrap-hooks.sh PostUp
iptables -t nat -A POSTROUTING -d 172.28.0.2/32 -p udp --dport 5353 -j MASQUERADE
iptables -t nat -A POSTROUTING -d 172.28.0.2/32 -p tcp --dport 5353 -j MASQUERADE
```

This rule:
- Matches responses from dnsmasq to the client
- Rewrites source IP to appear from wg-easy (10.200.0.1)
- Makes the VPN client think the answer came from the VPN gateway

## Common Issues and Solutions

### Issue 1: "Getting 192.168.1.60 from Pi-hole instead of 10.200.0.60"

**Cause**: The query's payload didn't match the DNS interception rule's
domain content — either the client isn't querying a `pimlicoa.duckdns.org`
subdomain, or (rarely) DNS 0x20-encoding produced a case variant the
`--icase` flag didn't catch (check that `--icase` is actually present in
the installed rule — see below).

**Solution**:
1. Verify rules are applied and include the content match:
   ```bash
   docker exec wg-easy iptables -t nat -S | grep 5353
   ```
   Should show DNS redirect rules with `-m string ... --hex-string ... --icase`.

2. Confirm the client is actually querying a name under `pimlicoa.duckdns.org` — non-matching domains are expected to bypass dnsmasq entirely and resolve straight from Pi-hole (this is the intended RFC-006 behavior, not a bug).

### Issue 2: "dnsmasq not receiving queries" (0 packets on dnsmasq's interface)

**Cause A**: dnsmasq is listening only on localhost (127.0.0.1), but DNAT redirects to container IP (172.28.0.2).

**Solution**: Check dnsmasq.conf:
```bash
docker exec dnsmasq-wg-easy cat /etc/dnsmasq.conf
```

Should NOT have a `listen-address` line restricting it to `127.0.0.1`. Simply
omit `listen-address` entirely — dnsmasq listens on all interfaces by
default. (Note: `bind-interfaces=0` is **not valid dnsmasq syntax** and will
cause `extraneous parameter` errors — just leave the directive out.)

**Cause B (the sneaky one)**: A rule placed *before* the DNS DNAT rule in
PREROUTING is catching the packet first — most likely the NETMAP rule,
since a `pimlicoa.duckdns.org` query is typically sent to Pi-hole's
translated address (`10.200.0.60`), which is inside the translated subnet
(`10.200.0.0/24`). Once NETMAP claims the packet, no further NAT rules in
that chain apply and dnsmasq never sees it. **Fix: DNS interception rules
must be the first NAT rules applied in PostUp**, before the wg-easy-admin
exception and before NETMAP.

**Cause C**: The `xt_string` kernel module isn't loaded/available, so the
`-m string` match silently fails to apply (iptables itself would normally
error out loading the rule if the module load fails outright — check
`docker logs wg-easy-hooks-bootstrap` for `modprobe xt_string` errors, and
confirm the rule is actually present via `iptables -t nat -S`).

**How to confirm this is happening** (definitive diagnostic, avoids guessing):
```bash
# Temporarily install tcpdump in the dnsmasq container and watch for traffic
docker exec dnsmasq-wg-easy apk add --no-cache tcpdump
docker exec dnsmasq-wg-easy timeout 30 tcpdump -i eth0 -n port 5353
# Then, from the VPN client: nslookup nginx.pimlicoa.duckdns.org
```
If this shows **0 packets captured**, the DNAT redirect never reached
dnsmasq — check rule order in `iptables -t nat -S` output (list them with
`docker exec wg-easy iptables -t nat -S`) and confirm the DNS rules appear
above the NETMAP rules.

You can also confirm what's happening on the wg-easy side:
```bash
docker exec wg-easy apk add --no-cache tcpdump
docker exec wg-easy timeout 30 tcpdump -i wg0 -n port 53
```
This will show the query arriving on wg0 either way (tcpdump captures at the
device level, before PREROUTING NAT is applied), so seeing the query here
doesn't confirm interception — pair it with the dnsmasq-side capture above.

Verify dnsmasq is listening correctly:
```bash
docker exec dnsmasq-wg-easy netstat -tuln | grep 5353
# Should show: 0.0.0.0:5353 (not 127.0.0.1:5353)
```

If wrong, update [dnsmasq.conf](./dnsmasq.conf) and restart:
```bash
docker compose restart dnsmasq
# or, equivalently, using the container name directly:
docker restart dnsmasq-wg-easy
```
Note: `docker compose restart` takes the **service name** from
`compose.yaml` (`dnsmasq`), while `docker restart` takes the **container
name** (`dnsmasq-wg-easy`, set via `container_name:`) — don't mix the two,
e.g. `docker compose restart dnsmasq-wg-easy` fails with "service not
available" since there's no service literally named that.

### Issue 3: "Rules applied but DNS still not intercepted"

**Cause**: Multiple possible issues. Debug step by step.

**Diagnostic steps**:

1. Verify iptables rules exist:
   ```bash
   docker exec wg-easy iptables -t nat -S | grep -E "(DNAT.*5353|MASQUERADE.*172.23)"
   ```

2. Check dnsmasq is running and listening:
   ```bash
   docker ps | grep dnsmasq
   docker exec dnsmasq-wg-easy ps aux | grep dnsmasq
   docker exec dnsmasq-wg-easy netstat -tuln | grep 5353
   ```

3. Monitor dnsmasq for queries:
   ```bash
   docker logs -f dnsmasq-wg-easy
   # Then query from VPN client: nslookup nginx.pimlicoa.duckdns.org
   # Should see log entries like:
   # query[A] nginx.pimlicoa.duckdns.org from 172.23.0.1
   ```

4. Check dnsmasq config has rewrite rule:
   ```bash
   docker exec dnsmasq-wg-easy grep "address=" /etc/dnsmasq.conf
   # Should show: address=/pimlicoa.duckdns.org/10.200.0.60
   ```

### Issue 4: "Authentication fails when running bootstrap script"

**Cause**: Incorrect credentials or authentication payload issues.

**Solution**: 
1. Verify credentials are in `.env`:
   ```bash
   grep "WG_EASY_ADMIN" wg-easy/.env
   ```

2. Run bootstrap script without env vars to auto-load from .env:
   ```bash
   cd wg-easy
   bash bootstrap-hooks.sh
   ```

3. If still fails, manually test authentication:
   ```bash
   curl -X POST \
     -H "Content-Type: application/json" \
     --data '{"username":"admin","password":"admin","remember":true}' \
     http://localhost:51821/api/session
   ```

## Testing DNS Interception

### From VPN Client, `pimlicoa.duckdns.org` domain (should be intercepted/rewritten)
```bash
nslookup nginx.pimlicoa.duckdns.org
# Expected:
# Server: 10.200.0.60 (Pi-hole's translated address, as configured)
# Address: 10.200.0.60 (translated address, not 192.168.1.60 — dnsmasq rewrote it)
```

### From VPN Client, any other domain (should NOT be intercepted — reaches Pi-hole directly)
```bash
nslookup example.com
# Expected: resolves normally, unaffected by dnsmasq
# docker exec dnsmasq-wg-easy tail /var/log/dnsmasq.log should show NO entry for this query
# Pi-hole's Query Log should show the client's real WireGuard tunnel IP as the requester
```

### From LAN Client (should NOT be intercepted)
```bash
nslookup nginx.pimlicoa.duckdns.org
# Expected:
# Server: 10.200.0.60 (Pi-hole)
# Address: 192.168.1.60 (physical address)
```

### From Tailnet Client (should NOT be intercepted)
```bash
nslookup nginx.pimlicoa.duckdns.org
# Expected:
# Server: 10.200.0.60 (Pi-hole via Tailscale)
# Address: 192.168.1.60 (physical address routed via Tailscale)
```

## Adding More Domain Rewrites

Since every NPM proxy host under `pimlicoa.duckdns.org` shares the same
translated address (`10.200.0.60`), one wildcard rule in
[dnsmasq.conf](./dnsmasq.conf) covers the whole domain (and all its
subdomains) automatically:

```bash
address=/pimlicoa.duckdns.org/10.200.0.60
```

New NPM proxy hosts (e.g. adding another `*.pimlicoa.duckdns.org` service)
work immediately with no changes needed here. Only add a separate, more
specific `address=/service.pimlicoa.duckdns.org/10.200.0.X` line if a
particular subdomain needs to resolve somewhere other than NPM's translated
address — a more specific rule takes precedence over the wildcard.

Then restart dnsmasq:
```bash
docker compose restart dnsmasq
```

### Host-native services proxied through NPM (e.g. Plex, Deluge, little-pi4)

Services that run directly on the Pi's host, or on another LAN device, are
typically reached via an NPM proxy host that forwards over the `homelab`
bridge network (e.g. `http://192.168.100.1:32400` for Plex,
`http://192.168.100.1:8112` for Deluge, `http://192.168.100.1:9090` for
little-pi4 — where `192.168.100.1` is the `homelab` bridge gateway, i.e. the
host itself). That NPM → target hop happens entirely inside the Pi's network
stack and never crosses the WireGuard tunnel, so it is **not** affected by
the subnet overlap problem.

This means such domains don't need their own translated IP or NAT rules —
they're already covered by the same wildcard rewrite as any other
NPM-proxied domain, since they resolve to NPM's translated address
(`10.200.0.60`) too.

Only add a *new* translated IP (and matching dedicated DNAT/SNAT pair in
`bootstrap-hooks.sh`, following the same pattern used for the wg-easy admin
UI's `10.200.0.9 ↔ 192.168.100.9` rule) if a client needs to reach a
service that lives on the `homelab` bridge (a *different* subnet from the
home LAN, unreachable via the generic NETMAP rule) **directly** — e.g. a
Plex app doing local network auto-discovery instead of using the
reverse-proxy domain. Anything reachable at the Pi's own real LAN IP (like
NPM's host-published ports) is already covered by the generic
`10.200.0.0/24 ↔ 192.168.1.0/24` NETMAP translation with no dedicated rule
needed.

## Performance Considerations

- **DNS cache**: Default cache-size is 150 entries. Increase if you have many unique queries:
  ```
  cache-size=500
  ```

- **Upstream forwarding**: only exercised as a defensive fallback now — queries reaching dnsmasq at all should already be `pimlicoa.duckdns.org` matches, answered directly by the `address=` rewrite rule.

- **Latency**: DNS interception adds ~1-2ms latency (DNAT redirect + dnsmasq processing) — now only for `pimlicoa.duckdns.org` queries; everything else has no added latency at all.

## Security Notes

1. **dnsmasq listening on all interfaces**: While dnsmasq listens on `0.0.0.0:5353`, it's only accessible via iptables redirect. Direct queries to port 5353 won't work from outside the container network.

2. **Rewrite rules are specific**: Only explicitly configured domains are rewritten. Other queries go to Pi-hole unchanged.

3. **No logging of rewrites**: By default, dnsmasq logs all queries. Sensitive queries can be filtered using dnsmasq log facilities.

4. **Client identity preservation (RFC-006)**: since only `pimlicoa.duckdns.org` queries are proxied through dnsmasq, Pi-hole's Query Log now shows each client's real WireGuard tunnel IP for every other domain — previously all VPN client DNS traffic was funneled through dnsmasq's app-layer forwarding, and Pi-hole only ever saw dnsmasq's own source IP.

## References

- [dnsmasq documentation](http://www.thekelleys.org.uk/dnsmasq/docs/dnsmasq-man.html)
- [iptables DNAT and MASQUERADE](https://linux.die.net/man/8/iptables)
- [iptables string match extension](https://man7.org/linux/man-pages/man8/iptables-extensions.8.html)
- RFC-001: Overlap subnet translation
- RFC-003: DNS reachability over WireGuard
- RFC-006: VPN client DNS identity preservation
