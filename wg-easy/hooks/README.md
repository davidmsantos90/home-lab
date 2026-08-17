# WireGuard Easy - Hook Configuration with DNS Interception

This document provides the complete hook strings to configure in the wg-easy web UI for:
- **RFC-001**: Overlap subnet translation (10.200.0.0/24 ↔ 192.168.1.0/24)
- **RFC-002**: Dynamic egress interface detection for MASQUERADE
- **wg-easy admin UI access**: DNAT/SNAT rule so VPN clients can reach wg-easy's own admin UI, which has no presence on the real home LAN
- **DNS Interception**: Redirect VPN client DNS queries to local dnsmasq proxy for domain rewriting

## Setup Instructions

### Automated (Recommended for fresh installs)
Run the bootstrap script which automatically resolves the dnsmasq container IP:
```bash
cd wg-easy/hooks
bash ./bootstrap-hooks.sh
```

This resolves `dnsmasq-wg-easy` container IP dynamically and applies rules with no manual work.

### Manual Setup (for existing installations)

1. First, get the dnsmasq container IP on the Raspberry Pi:
   ```bash
   docker inspect dnsmasq-wg-easy -f '{{.NetworkSettings.Networks.wg_easy_internal.IPAddress}}'
   ```

2. Open wg-easy web UI at `https://pimlicoa.duckdns.org:51821`

3. Log in with admin credentials

4. Go to **Settings** → **WireGuard Hooks** (or similar configuration section)

5. Copy the **Post Up** hook string (replace `DNSMASQ_IP` with the IP from step 1) into the Post Up field

6. Copy the **Post Down** hook string (replace `DNSMASQ_IP` with the IP from step 1) into the Post Down field

7. Save and restart wg-easy

## Post Up Hook

Replace `DNSMASQ_IP` with the actual IP address from step 1 above, `WG_EASY_ADMIN_HOMELAB_IP`/`WG_EASY_ADMIN_TRANSLATED_IP` with the values from `.env` (defaults: `192.168.100.9`/`10.200.0.9`), and `DNS_MATCH_HEX` with the DNS wire-format hex bytes for `WG_EASY_HOST` (RFC-006 — see `domain_to_wire_hex()` in [bootstrap-hooks.sh](./bootstrap-hooks.sh); for the default `pimlicoa.duckdns.org` this is `0870696d6c69636f61076475636b646e73036f726700`).

```bash
DEFAULT_IF=$(ip route show default | cut -d' ' -f5 | head -n1); T=10.200.0.0/24; H=192.168.1.0/24; D=DNSMASQ_IP; A=WG_EASY_ADMIN_HOMELAB_IP; AT=WG_EASY_ADMIN_TRANSLATED_IP; iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o "$DEFAULT_IF" -j MASQUERADE; modprobe xt_NETMAP || true; modprobe xt_string || true; iptables -t nat -A PREROUTING -i wg0 -p udp --dport 53 -m string --algo bm --hex-string "|DNS_MATCH_HEX|" --icase -j DNAT --to-destination "$D:5353"; iptables -t nat -A PREROUTING -i wg0 -p tcp --dport 53 -m string --algo bm --hex-string "|DNS_MATCH_HEX|" --icase -j DNAT --to-destination "$D:5353"; iptables -t nat -A POSTROUTING -d "$D/32" -p udp --dport 5353 -j MASQUERADE; iptables -t nat -A POSTROUTING -d "$D/32" -p tcp --dport 5353 -j MASQUERADE; iptables -t nat -A PREROUTING -d "$AT/32" -j DNAT --to "$A"; iptables -t nat -A POSTROUTING -s "$A/32" -j SNAT --to "$AT"; iptables -t nat -A PREROUTING -d "$T" -j NETMAP --to "$H"; iptables -t nat -A POSTROUTING -s "$H" -j NETMAP --to "$T"; iptables -A INPUT -p udp -m udp --dport 51820 -j ACCEPT; iptables -A FORWARD -i wg0 -j ACCEPT; iptables -A FORWARD -o wg0 -j ACCEPT;
```

## Post Down Hook

Replace the same placeholders as above.

```bash
DEFAULT_IF=$(ip route show default | cut -d' ' -f5 | head -n1); T=10.200.0.0/24; H=192.168.1.0/24; D=DNSMASQ_IP; A=WG_EASY_ADMIN_HOMELAB_IP; AT=WG_EASY_ADMIN_TRANSLATED_IP; iptables -t nat -D POSTROUTING -s 10.8.0.0/24 -o "$DEFAULT_IF" -j MASQUERADE; iptables -t nat -D PREROUTING -i wg0 -p udp --dport 53 -m string --algo bm --hex-string "|DNS_MATCH_HEX|" --icase -j DNAT --to-destination "$D:5353"; iptables -t nat -D PREROUTING -i wg0 -p tcp --dport 53 -m string --algo bm --hex-string "|DNS_MATCH_HEX|" --icase -j DNAT --to-destination "$D:5353"; iptables -t nat -D POSTROUTING -d "$D/32" -p udp --dport 5353 -j MASQUERADE; iptables -t nat -D POSTROUTING -d "$D/32" -p tcp --dport 5353 -j MASQUERADE; iptables -t nat -D PREROUTING -d "$AT/32" -j DNAT --to "$A"; iptables -t nat -D POSTROUTING -s "$A/32" -j SNAT --to "$AT"; iptables -t nat -D PREROUTING -d "$T" -j NETMAP --to "$H"; iptables -t nat -D POSTROUTING -s "$H" -j NETMAP --to "$T"; iptables -D INPUT -p udp -m udp --dport 51820 -j ACCEPT; iptables -D FORWARD -i wg0 -j ACCEPT; iptables -D FORWARD -o wg0 -j ACCEPT;
```

## Hook Breakdown

The hooks execute these steps in order. **Rule order in the `nat` table is
critical**: once a packet matches a rule with a NAT target (DNAT, NETMAP,
REDIRECT, MASQUERADE), iptables stops evaluating further rules in that chain
for that packet. The translated subnet (`10.200.0.0/24`) includes both the
wg0 gateway (`10.200.0.1`) and Pi-hole's translated address (`10.200.0.60`,
the address VPN clients now use as their DNS server), so the DNS
interception rules **must be placed before** the wg-easy-admin and NETMAP
rules — otherwise NETMAP would catch DNS traffic first and dnsmasq would
never see it.

### 1. RFC-002: Dynamic MASQUERADE
```bash
DEFAULT_IF=$(ip route show default | cut -d' ' -f5 | head -n1)
iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o "$DEFAULT_IF" -j MASQUERADE
```
Detects default network interface and applies MASQUERADE to VPN subnet traffic. Handles Internet-bound traffic.

### 2. Load NETMAP/string Kernel Modules
```bash
modprobe xt_NETMAP || true
modprobe xt_string || true
```
Loads the NETMAP module (overlap subnet translation) and the `xt_string` module (RFC-006's content-matched DNS interception, see below). Continues if already loaded.

### 3. DNS Interception (must run before wg-easy-admin/NETMAP rules!)
```bash
# Route only WG_EASY_HOST-domain DNS queries from VPN clients to dnsmasq container
iptables -t nat -A PREROUTING -i wg0 -p udp --dport 53 -m string --algo bm --hex-string "|$DNS_MATCH_HEX|" --icase -j DNAT --to-destination $D:5353
iptables -t nat -A PREROUTING -i wg0 -p tcp --dport 53 -m string --algo bm --hex-string "|$DNS_MATCH_HEX|" --icase -j DNAT --to-destination $D:5353

# Masquerade return traffic from dnsmasq so it appears to come from wg-easy
iptables -t nat -A POSTROUTING -d $D/32 -p udp --dport 5353 -j MASQUERADE
iptables -t nat -A POSTROUTING -d $D/32 -p tcp --dport 5353 -j MASQUERADE
```

Where `$D` is the dnsmasq container IP on wg_easy_bridge network (e.g., 172.28.0.2), and `$DNS_MATCH_HEX` is the DNS wire-format hex encoding of `WG_EASY_HOST` (RFC-006).

**How it works**:
- PREROUTING DNAT: only matches DNS packets whose payload contains `WG_EASY_HOST`'s wire-format bytes (any subdomain shares the same byte suffix), and rewrites their destination from `wg0` to the dnsmasq container IP. `--icase` guards against DNS 0x20-encoding (case randomization used by some resolvers as an anti-spoofing measure). Everything else isn't matched at all.
- POSTROUTING MASQUERADE: Rewrites source of dnsmasq responses so VPN clients see replies from wg-easy, not from a different IP
- VPN clients receive translated DNS responses (e.g., `nginx.pimlicoa.duckdns.org` → `10.200.0.60`, the translated form of the Pi's own real LAN IP) for the matched domain; every other query bypasses dnsmasq entirely and reaches Pi-hole directly via NETMAP below, preserving the client's real WireGuard tunnel IP in Pi-hole's Query Log.

This approach uses DNAT instead of REDIRECT because dnsmasq runs in a separate container on the Docker network, not localhost inside wg-easy.

**Why this must come first**: `WG_EASY_HOST`-domain queries can be sent to
either the wg0 gateway (`10.200.0.1`, legacy clients) or Pi-hole's
translated address (`10.200.0.60`, current default) — both fall inside the
translated subnet (`10.200.0.0/24`). If the NETMAP rule ran first, it would
rewrite the destination (e.g. to `192.168.1.60`) before the DNS-specific
rule ever got a chance to match — silently breaking the RFC-001 rewrite
with no errors.

### 4. wg-easy-admin DNAT/SNAT (must be before broad NETMAP rules!)
```bash
iptables -t nat -A PREROUTING -d 10.200.0.9/32 -j DNAT --to 192.168.100.9
iptables -t nat -A POSTROUTING -s 192.168.100.9/32 -j SNAT --to 10.200.0.9
```
Routes VPN clients to wg-easy's own admin UI via its static homelab IP
(`192.168.100.9`). This exception exists only for wg-easy itself: unlike NPM
and other host-bound services, wg-easy's admin UI has no presence at all on
the real home LAN (`192.168.1.0/24`), so the generic NETMAP rule below
can't reach it — it needs its own dedicated translation.
**Important**: This rule must come BEFORE the broad NETMAP rules so it matches first.

### 5. RFC-001: Overlap Subnet Translation (NETMAP)
```bash
iptables -t nat -A PREROUTING -d 10.200.0.0/24 -j NETMAP --to 192.168.1.0/24
iptables -t nat -A POSTROUTING -s 192.168.1.0/24 -j NETMAP --to 10.200.0.0/24
```
Translates all traffic between VPN subnet (10.200.0.0/24) and home LAN (192.168.1.0/24).
- PREROUTING: Rewrites destination for incoming traffic
- POSTROUTING: Rewrites source for outgoing traffic

This generic 1:1 mapping is what now routes VPN clients to NPM and any other
host-bound service (e.g. `10.200.0.60` → `192.168.1.60`, the Pi's own real
LAN IP) — no per-service NAT exception needed, unlike wg-easy's own admin UI above.

### 6. Input/Forward Filtering
```bash
iptables -A INPUT -p udp -m udp --dport 51820 -j ACCEPT
iptables -A FORWARD -i wg0 -j ACCEPT
iptables -A FORWARD -o wg0 -j ACCEPT
```
Accepts WireGuard traffic on port 51820 and allows forwarding through VPN tunnel.

## DNS Interception Details

- **dnsmasq proxy**: Runs in separate container on `wg_easy_internal` network
- **Listening address**: 0.0.0.0:5353 (internal, only accessible via iptables redirect)
- **Domain rewrite**: `nginx.pimlicoa.duckdns.org` → `10.200.0.60` (for VPN clients only — the translated form of the Pi's real LAN IP, since NPM is now reached there directly instead of via a dedicated macvlan/homelab address)
- **Scope (RFC-006)**: only queries matching `WG_EASY_HOST`'s domain content are redirected to dnsmasq at all — everything else bypasses it entirely, reaching Pi-hole directly via NETMAP and preserving the client's real WireGuard tunnel IP in Pi-hole's Query Log. dnsmasq's `server=` upstream line is now only a defensive fallback.

**Result**: VPN clients get a translated address that safely routes through the tunnel even if their own local network overlaps with the home LAN, while LAN clients still resolve to physical addresses — and non-`WG_EASY_HOST` queries retain the client's real identity in Pi-hole's log.

## Accessing Services from VPN

After hooks are applied:

1. **From overlapping network (192.168.1.0/24)**:
   - DNS resolves `nginx.pimlicoa.duckdns.org` → `10.200.0.60`
   - Clients route through VPN tunnel to 10.200.0.60
   - NETMAP rule translates to 192.168.1.60 (the Pi's own real LAN IP, where NPM now listens directly)
   - NPM responds, NETMAP translates the source back to 10.200.0.60
   - Connection succeeds ✓
   - NPM's admin UI is reachable the same way, at `10.200.0.60:81` (NETMAP
     translates the whole IP, not just proxy ports)

2. **From LAN (192.168.1.0/24, non-VPN)**:
   - DNS still resolves to 192.168.1.60 (the Pi's real LAN IP)
   - Direct connection to 192.168.1.60 works as before ✓

## Testing the Setup

After applying hooks and restarting wg-easy:

### From VPN Client (overlapping network):
```bash
# DNS should return translated address for WG_EASY_HOST domain
nslookup nginx.pimlicoa.duckdns.org 10.200.0.60
# Result: 10.200.0.60

# DNS from local Pi-hole should also be intercepted
nslookup pi-hole.pimlicoa.duckdns.org
# (should use intercepted proxy and return 10.200.0.60)

# Non-WG_EASY_HOST queries should bypass dnsmasq and reach Pi-hole directly,
# preserving the client's real tunnel IP in Pi-hole's Query Log (RFC-006)
nslookup example.com 10.200.0.60

# Access NPM UI
curl -I https://10.200.0.60
# Status: 200 OK
```

### Verify Rules Applied:
```bash
# Check the wg-easy-admin DNAT/SNAT rule
docker exec wg-easy iptables -t nat -S | grep "10.200.0.9"

# Check NETMAP rules
docker exec wg-easy iptables -t nat -S | grep NETMAP

# Check DNS redirect rules
docker exec wg-easy iptables -t nat -S | grep 5353
```

### From LAN Client:
```bash
# DNS should still return physical address
nslookup nginx.pimlicoa.duckdns.org 10.200.0.60
# Result: 192.168.1.60 (not intercepted)

# Direct access to physical IP should work
curl -I https://192.168.1.60
# Status: 200 OK
```

## Troubleshooting

### DNS not being intercepted (VPN client still gets 192.168.1.60)
- Verify dnsmasq container is running: `docker ps | grep dnsmasq`
- Verify DNS redirect rules exist AND come first: `docker exec wg-easy iptables -t nat -S`
  (the DNAT rules for port 5353 must appear **above** the wg-easy-admin/NETMAP rules — see
  "Rule order" note below), and must include the `-m string ... --hex-string ... --icase` content match
- **Critical**: Check dnsmasq is listening on the container IP (not just localhost):
  ```bash
  docker exec dnsmasq-wg-easy netstat -tuln | grep 5353
  ```
  Should show `0.0.0.0:5353` or `:::5353`, NOT just `127.0.0.1:5353`
- Check dnsmasq config: `docker exec dnsmasq-wg-easy cat /etc/dnsmasq.conf`
  Must NOT have a `listen-address=127.0.0.1` line (just omit it)
- Verify VPN client DNS is set to Pi-hole's translated address (e.g., `10.200.0.60`) — RFC-006 no longer requires pointing at the VPN gateway, since the interception rule matches on domain content rather than destination
- Check `xt_string` module loaded: `docker exec wg-easy lsmod | grep xt_string`
- Check dnsmasq logs: `docker logs dnsmasq-wg-easy | tail -20`
- **Definitive test**: capture traffic directly on dnsmasq's interface to see if packets ever arrive:
  ```bash
  docker exec dnsmasq-wg-easy apk add --no-cache tcpdump
  docker exec dnsmasq-wg-easy timeout 30 tcpdump -i eth0 -n port 5353
  # then query DNS from the VPN client
  ```
  Zero packets captured = the DNAT redirect isn't reaching dnsmasq, almost
  always a rule-order issue or missing content match (see [DNS Interception docs](../dns/README.md) for full diagnostic steps).

### Rule order (common pitfall)
`WG_EASY_HOST`-domain queries can be sent to either the wg0 gateway
(`10.200.0.1`, legacy clients) or Pi-hole's translated address
(`10.200.0.60`, current default) — both fall inside the translated subnet
(`10.200.0.0/24`). Because iptables `nat` rules stop being evaluated for a
packet once it matches a NAT target, if the NETMAP rule is placed before the
DNS interception rule, it silently claims the packet first and dnsmasq never
receives it — with no errors logged anywhere. **Always place the DNS
interception rules first** in PostUp/PostDown, before the wg-easy-admin and
NETMAP rules (see the corrected hook strings above).

### NPM still unreachable from overlapping VPN clients
- Verify DNS resolves to a translated address: `nslookup nginx.pimlicoa.duckdns.org 10.200.0.60` should return `10.200.0.60`, not `192.168.1.60`
- Verify NETMAP rules exist: `docker exec wg-easy iptables -t nat -S | grep NETMAP`
- Ensure rules are in correct order (DNS rules, then wg-easy-admin, then NETMAP): `docker exec wg-easy iptables -t nat -S`
- Check NPM is actually listening on the host's real LAN IP: `docker exec nginx-proxy-manager ip addr show` should show it bound via `ports:`, reachable at the host's own address (e.g. `192.168.1.60:81`)

### Performance issues / slow DNS
- Check dnsmasq cache size: `grep cache-size /path/to/HOME_LAB_DIR/dns/dnsmasq.conf` (default: 150)
- Monitor dnsmasq: `docker logs -f dnsmasq-wg-easy`

## DNS Interception Setup Process

### Step 1: Ensure dnsmasq is listening on all interfaces
dnsmasq must listen on `0.0.0.0:5353` (all interfaces), not just `127.0.0.1`, because iptables DNAT redirects traffic to the container's network IP (e.g., `172.28.0.2`).

**File**: [dnsmasq.conf.example](../dns/dnsmasq.conf.example)
```
port=5353
```
(No `listen-address` or `bind-interfaces` directive — dnsmasq listens on all interfaces by default. Note that `bind-interfaces=0` is not valid syntax and will cause dnsmasq to fail to start.)

### Step 2: Apply iptables DNAT rules (must be placed first, before wg-easy-admin/NETMAP rules)
The bootstrap script applies DNS redirect rules in PostUp hook, content-scoped
(RFC-006) so only queries for `WG_EASY_HOST` are redirected — everything else
bypasses dnsmasq entirely and preserves the client's real IP in Pi-hole's log:
```bash
iptables -t nat -A PREROUTING -i wg0 -p udp --dport 53 -m string --algo bm --hex-string "|0870696d6c69636f61076475636b646e73036f726700|" --icase -j DNAT --to-destination 172.28.0.2:5353
iptables -t nat -A PREROUTING -i wg0 -p tcp --dport 53 -m string --algo bm --hex-string "|0870696d6c69636f61076475636b646e73036f726700|" --icase -j DNAT --to-destination 172.28.0.2:5353
```

These redirect only `WG_EASY_HOST`-domain DNS queries from VPN clients (via wg0) to the dnsmasq container.

### Step 3: Configure dnsmasq domain rewrites
**File**: [dnsmasq.conf.example](../dns/dnsmasq.conf.example)
```
address=/pimlicoa.duckdns.org/10.200.0.60
```

### Step 4: Set VPN client DNS to Pi-hole's translated address
**Important**: VPN client should use Pi-hole's translated address as DNS
(e.g., `10.200.0.60`), not the VPN gateway. Since RFC-006, the interception
rule matches on DNS query content rather than destination address, so
pointing directly at Pi-hole means `WG_EASY_HOST` queries are still
intercepted and rewritten, while every other query is resolved by Pi-hole
directly — preserving the client's real tunnel IP in its Query Log.

On your WireGuard config, set:
```
DNS = 10.200.0.60
```

This ensures `WG_EASY_HOST` queries still get intercepted via wg0 (matched by
content, not destination), while all other DNS traffic goes straight to
Pi-hole without an extra hop.

### Step 5: Verify DNS interception
From VPN client:
```bash
nslookup nginx.pimlicoa.duckdns.org
# Expected: Server: 10.200.0.60, Address: 10.200.0.60 (intercepted/rewritten)

nslookup example.com
# Expected: resolved directly by Pi-hole, with the client's real tunnel IP
# preserved in Pi-hole's Query Log (not proxied through dnsmasq)
```

From LAN client (should NOT be intercepted):
```bash
nslookup nginx.pimlicoa.duckdns.org
# Expected: Server: 10.200.0.60, Address: 192.168.1.60
```

## Customization

To modify subnet ranges or DNS domains:

1. Update wg-easy `.env`:
   ```env
   HOME_LAN_SUBNET=192.168.1.0/24        # Your actual home LAN
   WG_TRANSLATED_LAN_SUBNET=10.200.0.0/24 # Virtual subnet for VPN clients
   ```

2. Update dnsmasq.conf.example for additional domain rewrites:
   ```
   address=/another-domain.pimlicoa.duckdns.org/10.200.0.X
   ```

3. Restart services:
   ```bash
   docker compose restart dnsmasq wg-easy
   ```

## References

- RFC-001: Overlap subnet translation using NETMAP
- RFC-002: Dynamic egress interface detection
- RFC-003: DNS and service reachability over WireGuard
- RFC-004: (service-specific documentation)
