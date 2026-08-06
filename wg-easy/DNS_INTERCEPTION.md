# DNS Interception for VPN Clients

This document explains how DNS interception works in wg-easy and how to troubleshoot common issues.

## Architecture

```
VPN Client (macOS/Linux)
    ↓
    └─ Query: nginx.pimlicoa.duckdns.org on port 53
       (Configured DNS: 10.200.0.1 - VPN gateway)
    ↓
WireGuard Interface (wg0) on Raspberry Pi
    ↓
iptables DNAT Rule
    ├─ Matches: -i wg0 -p udp --dport 53
    └─ Action: DNAT --to-destination 172.23.0.2:5353 (dnsmasq container IP)
    ↓
dnsmasq Container (172.23.0.2)
    ├─ Listen: 0.0.0.0:5353 (all interfaces)
    ├─ Upstream: 10.200.0.60 (Pi-hole)
    └─ Rewrite Rule: nginx.pimlicoa.duckdns.org → 10.200.0.5
    ↓
Response: 10.200.0.5
    ↓
iptables MASQUERADE Rule
    ├─ Matches: -d 172.23.0.2/32 -p udp --dport 5353
    └─ Action: MASQUERADE (rewrites source to appear from wg-easy)
    ↓
VPN Client receives: 10.200.0.5
    └─ Routes through wg0 tunnel to 10.200.0.5 (NPM's homelab IP via DNAT)
```

## How It Works

### 1. VPN Client Configuration
The VPN client must be configured to use the **VPN gateway as DNS**, not Pi-hole directly:

```
# On WireGuard config (macOS, Linux, etc.)
DNS = 10.200.0.1
```

**Why?** Queries to the gateway IP (10.200.0.1) will route through wg0, where iptables can intercept them.

### 2. iptables DNAT Interception
When a VPN client queries DNS on the wg0 interface, iptables intercepts it:

```bash
# From bootstrap-hooks.sh PostUp
iptables -t nat -A PREROUTING -i wg0 -p udp --dport 53 -j DNAT --to-destination 172.23.0.2:5353
iptables -t nat -A PREROUTING -i wg0 -p tcp --dport 53 -j DNAT --to-destination 172.23.0.2:5353
```

This rule:
- Matches queries on wg0 interface on port 53
- Rewrites destination to dnsmasq container IP (172.23.0.2) on port 5353
- Preserves the original query so dnsmasq can answer it

**Rule order matters**: this DNAT rule must be placed **before** the NPM
DNAT/SNAT rules and the NETMAP rules in PREROUTING. The client's DNS queries
target the wg0 gateway address (`10.200.0.1`), which falls inside the
translated subnet (`10.200.0.0/24`). In iptables' `nat` table, a packet stops
being evaluated by further rules in the same chain once it matches a NAT
target. If NETMAP ran first, it would silently rewrite the destination to
`192.168.1.1` and the DNS interception rule below it would never run —
with no errors, making this very hard to spot.

### 3. dnsmasq Domain Rewriting
dnsmasq receives the redirected query and applies rewrite rules:

```bash
# From dnsmasq.conf
address=/nginx.pimlicoa.duckdns.org/10.200.0.5
server=10.200.0.60  # Upstream for other queries
```

For this example:
- Query for `nginx.pimlicoa.duckdns.org` → returns `10.200.0.5` (locally rewritten)
- Query for anything else → forwarded to Pi-hole (10.200.0.60)

### 4. MASQUERADE Return Traffic
Response traffic from dnsmasq needs to appear to come from wg-easy, not from dnsmasq:

```bash
# From bootstrap-hooks.sh PostUp
iptables -t nat -A POSTROUTING -d 172.23.0.2/32 -p udp --dport 5353 -j MASQUERADE
iptables -t nat -A POSTROUTING -d 172.23.0.2/32 -p tcp --dport 5353 -j MASQUERADE
```

This rule:
- Matches responses from dnsmasq to the client
- Rewrites source IP to appear from wg-easy (10.200.0.1)
- Makes the VPN client think the answer came from the VPN gateway

## Common Issues and Solutions

### Issue 1: "Still getting 192.168.1.5 from Pi-hole"

**Cause**: DNS query is going directly to Pi-hole (10.200.0.60), bypassing the VPN gateway and iptables rules.

**Solution**: 
1. Check VPN client DNS configuration:
   ```
   # Should be set to VPN gateway, NOT Pi-hole
   DNS = 10.200.0.1  # ✓ Correct
   DNS = 10.200.0.60 # ✗ Wrong - bypasses interception
   ```

2. Verify rules are applied:
   ```bash
   docker exec wg-easy iptables -t nat -S | grep 5353
   ```
   Should show DNS redirect rules.

### Issue 2: "dnsmasq not receiving queries" (0 packets on dnsmasq's interface)

**Cause A**: dnsmasq is listening only on localhost (127.0.0.1), but DNAT redirects to container IP (172.23.0.2).

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
since the client's DNS query targets the wg0 gateway IP (`10.200.0.1`),
which is inside the translated subnet (`10.200.0.0/24`). Once NETMAP claims
the packet, no further NAT rules in that chain apply and dnsmasq never
sees it. **Fix: DNS interception rules must be the first NAT rules applied
in PostUp**, before NPM DNAT/SNAT and before NETMAP.

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
above the NETMAP/NPM rules.

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
docker compose restart dnsmasq-wg-easy
```

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
   # Should show: address=/nginx.pimlicoa.duckdns.org/10.200.0.5
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

### From VPN Client (should be intercepted)
```bash
nslookup nginx.pimlicoa.duckdns.org
# Expected:
# Server: 10.200.0.1  (VPN gateway, not Pi-hole)
# Address: 10.200.0.5 (translated address, not 192.168.1.5)
```

### From LAN Client (should NOT be intercepted)
```bash
nslookup nginx.pimlicoa.duckdns.org
# Expected:
# Server: 10.200.0.60 (Pi-hole)
# Address: 192.168.1.5 (physical address)
```

### From Tailnet Client (should NOT be intercepted)
```bash
nslookup nginx.pimlicoa.duckdns.org
# Expected:
# Server: 10.200.0.60 (Pi-hole via Tailscale)
# Address: 192.168.1.5 (physical address routed via Tailscale)
```

## Adding More Domain Rewrites

To add more services to DNS interception, edit [dnsmasq.conf](./dnsmasq.conf):

```bash
# Add rewrite rules for additional services
address=/service1.pimlicoa.duckdns.org/10.200.0.X
address=/service2.pimlicoa.duckdns.org/10.200.0.Y
```

Then restart dnsmasq:
```bash
docker compose restart dnsmasq-wg-easy
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
they just need the **same** translated address as NPM itself
(`10.200.0.5`), exactly like `nginx.pimlicoa.duckdns.org`:

```bash
address=/plex.pimlicoa.duckdns.org/10.200.0.5
address=/deluge.pimlicoa.duckdns.org/10.200.0.5
address=/little-pi4.pimlicoa.duckdns.org/10.200.0.5
```

Only add a *new* translated IP (and matching DNAT/SNAT pair in
`bootstrap-hooks.sh`, following the same pattern used for NPM's
`10.200.0.5 ↔ 192.168.100.5` rule) if a client needs to reach a host-native
service **directly**, bypassing NPM — e.g. a Plex app doing local network
auto-discovery instead of using the reverse-proxy domain.

## Performance Considerations

- **DNS cache**: Default cache-size is 150 entries. Increase if you have many unique queries:
  ```
  cache-size=500
  ```

- **Upstream forwarding**: Queries not matched by rewrites are forwarded to Pi-hole (10.200.0.60)

- **Latency**: DNS interception adds ~1-2ms latency (DNAT redirect + dnsmasq processing)

## Security Notes

1. **dnsmasq listening on all interfaces**: While dnsmasq listens on `0.0.0.0:5353`, it's only accessible via iptables redirect. Direct queries to port 5353 won't work from outside the container network.

2. **Rewrite rules are specific**: Only explicitly configured domains are rewritten. Other queries go to Pi-hole unchanged.

3. **No logging of rewrites**: By default, dnsmasq logs all queries. Sensitive queries can be filtered using dnsmasq log facilities.

## References

- [dnsmasq documentation](http://www.thekelleys.org.uk/dnsmasq/docs/dnsmasq-man.html)
- [iptables DNAT and MASQUERADE](https://linux.die.net/man/8/iptables)
- RFC-001: Overlap subnet translation
- RFC-003: DNS reachability over WireGuard
