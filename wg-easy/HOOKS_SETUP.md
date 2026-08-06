# WireGuard Easy - Hook Configuration with DNS Interception

This document provides the complete hook strings to configure in the wg-easy web UI for:
- **RFC-001**: Overlap subnet translation (10.200.0.0/24 ↔ 192.168.1.0/24)
- **RFC-002**: Dynamic egress interface detection for MASQUERADE
- **NPM Access**: DNAT/SNAT rules for overlapping VPN clients to reach NPM via 10.200.0.5
- **DNS Interception**: Redirect VPN client DNS queries to local dnsmasq proxy for domain rewriting

## Setup Instructions

### Automated (Recommended for fresh installs)
Run the bootstrap script which automatically resolves the dnsmasq container IP:
```bash
cd wg-easy
bash bootstrap-hooks.sh
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

Replace `DNSMASQ_IP` with the actual IP address from step 1 above.

```bash
DEFAULT_IF=$(ip route show default | cut -d' ' -f5 | head -n1); T=10.200.0.0/24; H=192.168.1.0/24; D=DNSMASQ_IP; iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o "$DEFAULT_IF" -j MASQUERADE; modprobe xt_NETMAP || true; iptables -t nat -A PREROUTING -i wg0 -p udp --dport 53 -j DNAT --to-destination "$D:5353"; iptables -t nat -A PREROUTING -i wg0 -p tcp --dport 53 -j DNAT --to-destination "$D:5353"; iptables -t nat -A POSTROUTING -d "$D/32" -p udp --dport 5353 -j MASQUERADE; iptables -t nat -A POSTROUTING -d "$D/32" -p tcp --dport 5353 -j MASQUERADE; iptables -t nat -A PREROUTING -d 10.200.0.5/32 -j DNAT --to 192.168.100.5; iptables -t nat -A POSTROUTING -s 192.168.100.5/32 -j SNAT --to 10.200.0.5; iptables -t nat -A PREROUTING -d "$T" -j NETMAP --to "$H"; iptables -t nat -A POSTROUTING -s "$H" -j NETMAP --to "$T"; iptables -A INPUT -p udp -m udp --dport 51820 -j ACCEPT; iptables -A FORWARD -i wg0 -j ACCEPT; iptables -A FORWARD -o wg0 -j ACCEPT;
```

## Post Down Hook

Replace `DNSMASQ_IP` with the actual IP address from step 1 above.

```bash
DEFAULT_IF=$(ip route show default | cut -d' ' -f5 | head -n1); T=10.200.0.0/24; H=192.168.1.0/24; D=DNSMASQ_IP; iptables -t nat -D POSTROUTING -s 10.8.0.0/24 -o "$DEFAULT_IF" -j MASQUERADE; iptables -t nat -D PREROUTING -i wg0 -p udp --dport 53 -j DNAT --to-destination "$D:5353"; iptables -t nat -D PREROUTING -i wg0 -p tcp --dport 53 -j DNAT --to-destination "$D:5353"; iptables -t nat -D POSTROUTING -d "$D/32" -p udp --dport 5353 -j MASQUERADE; iptables -t nat -D POSTROUTING -d "$D/32" -p tcp --dport 5353 -j MASQUERADE; iptables -t nat -D PREROUTING -d 10.200.0.5/32 -j DNAT --to 192.168.100.5; iptables -t nat -D POSTROUTING -s 192.168.100.5/32 -j SNAT --to 10.200.0.5; iptables -t nat -D PREROUTING -d "$T" -j NETMAP --to "$H"; iptables -t nat -D POSTROUTING -s "$H" -j NETMAP --to "$T"; iptables -D INPUT -p udp -m udp --dport 51820 -j ACCEPT; iptables -D FORWARD -i wg0 -j ACCEPT; iptables -D FORWARD -o wg0 -j ACCEPT;
```

## Hook Breakdown

The hooks execute these steps in order. **Rule order in the `nat` table is
critical**: once a packet matches a rule with a NAT target (DNAT, NETMAP,
REDIRECT, MASQUERADE), iptables stops evaluating further rules in that chain
for that packet. The translated subnet (`10.200.0.0/24`) includes the wg0
gateway address (`10.200.0.1`) that VPN clients use as their DNS server, so
the DNS interception rules **must be placed before** the NPM and NETMAP
rules — otherwise NETMAP would catch DNS traffic first and dnsmasq would
never see it.

### 1. RFC-002: Dynamic MASQUERADE
```bash
DEFAULT_IF=$(ip route show default | cut -d' ' -f5 | head -n1)
iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o "$DEFAULT_IF" -j MASQUERADE
```
Detects default network interface and applies MASQUERADE to VPN subnet traffic. Handles Internet-bound traffic.

### 2. Load NETMAP Kernel Module
```bash
modprobe xt_NETMAP || true
```
Loads the NETMAP module required for overlap subnet translation. Continues if already loaded.

### 3. DNS Interception (must run before NPM/NETMAP rules!)
```bash
# Route DNS queries from VPN clients to dnsmasq container
iptables -t nat -A PREROUTING -i wg0 -p udp --dport 53 -j DNAT --to-destination $D:5353
iptables -t nat -A PREROUTING -i wg0 -p tcp --dport 53 -j DNAT --to-destination $D:5353

# Masquerade return traffic from dnsmasq so it appears to come from wg-easy
iptables -t nat -A POSTROUTING -d $D/32 -p udp --dport 5353 -j MASQUERADE
iptables -t nat -A POSTROUTING -d $D/32 -p tcp --dport 5353 -j MASQUERADE
```

Where `$D` is the dnsmasq container IP on wg_easy_bridge network (e.g., 172.23.0.2).

**How it works**:
- PREROUTING DNAT: Rewrites destination of DNS queries from `wg0` to the dnsmasq container IP
- POSTROUTING MASQUERADE: Rewrites source of dnsmasq responses so VPN clients see replies from wg-easy, not from a different IP
- VPN clients receive translated DNS responses (e.g., `nginx.pimlicoa.duckdns.org` → `10.200.0.5`)

This approach uses DNAT instead of REDIRECT because dnsmasq runs in a separate container on the Docker network, not localhost inside wg-easy.

**Why this must come first**: The VPN client queries DNS at the wg0 gateway
address (`10.200.0.1`), which is inside the translated subnet
(`10.200.0.0/24`). If the NETMAP rule ran first, it would rewrite the
destination to `192.168.1.1` before the DNS-specific rule ever got a chance
to match — silently breaking DNS interception with no errors.

### 4. NPM-Specific DNAT/SNAT (must be before broad NETMAP rules!)
```bash
iptables -t nat -A PREROUTING -d 10.200.0.5/32 -j DNAT --to 192.168.100.5
iptables -t nat -A POSTROUTING -s 192.168.100.5/32 -j SNAT --to 10.200.0.5
```
Routes overlapping VPN clients to NPM via its static homelab IP (192.168.100.5). 
**Important**: These rules must come BEFORE the broad NETMAP rules so they match first.

### 5. RFC-001: Overlap Subnet Translation (NETMAP)
```bash
iptables -t nat -A PREROUTING -d 10.200.0.0/24 -j NETMAP --to 192.168.1.0/24
iptables -t nat -A POSTROUTING -s 192.168.1.0/24 -j NETMAP --to 10.200.0.0/24
```
Translates all traffic between VPN subnet (10.200.0.0/24) and home LAN (192.168.1.0/24).
- PREROUTING: Rewrites destination for incoming traffic
- POSTROUTING: Rewrites source for outgoing traffic

### 6. Input/Forward Filtering
```bash
iptables -A INPUT -p udp -m udp --dport 51820 -j ACCEPT
iptables -A FORWARD -i wg0 -j ACCEPT
iptables -A FORWARD -o wg0 -j ACCEPT
```
Accepts WireGuard traffic on port 51820 and allows forwarding through VPN tunnel.

## DNS Interception Details

- **dnsmasq proxy**: Runs in separate container on `wg_easy_internal` network
- **Listening address**: 127.0.0.1:5353 (internal, only accessible via iptables redirect)
- **Domain rewrite**: `nginx.pimlicoa.duckdns.org` → `10.200.0.5` (for VPN clients only)
- **Upstream DNS**: Forwards all other queries to Pi-hole at 10.200.0.60

**Result**: VPN clients get translated address for NPM, while LAN/Tailnet clients still resolve to physical addresses.

## Accessing Services from VPN

After hooks are applied:

1. **From overlapping network (192.168.1.0/24)**:
   - DNS resolves `nginx.pimlicoa.duckdns.org` → `10.200.0.5`
   - Clients route through VPN tunnel to 10.200.0.5
   - DNAT/SNAT rules translate to 192.168.100.5 (NPM's homelab IP)
   - NPM responds, SNAT translates back to 10.200.0.5
   - Connection succeeds ✓

2. **From LAN (192.168.1.0/24, non-VPN)**:
   - DNS still resolves to 192.168.1.5 (NPM's physical macvlan address)
   - Direct connection to 192.168.1.5 works as before ✓

3. **From Tailnet**:
   - Resolves via Pi-hole to 192.168.1.5 (no DNS interception for non-VPN)
   - Tailscale routes through encrypted tunnel
   - NPM's Tailscale sidecar responds with static homelab IP
   - Connection succeeds ✓

## Testing the Setup

After applying hooks and restarting wg-easy:

### From VPN Client (overlapping network):
```bash
# DNS should return translated address
nslookup nginx.pimlicoa.duckdns.org 10.200.0.60
# Result: 10.200.0.5

# DNS from local Pi-hole should also be intercepted
nslookup pi-hole.pimlicoa.duckdns.org
# (should use intercepted proxy and return 10.200.0.5)

# Access NPM UI
curl -I https://10.200.0.5
# Status: 200 OK
```

### Verify Rules Applied:
```bash
# Check DNAT/SNAT rules for NPM
docker exec wg-easy iptables -t nat -S | grep "10.200.0.5"

# Check NETMAP rules
docker exec wg-easy iptables -t nat -S | grep NETMAP

# Check DNS redirect rules
docker exec wg-easy iptables -t nat -S | grep 5353
```

### From LAN Client:
```bash
# DNS should still return physical address
nslookup nginx.pimlicoa.duckdns.org 10.200.0.60
# Result: 192.168.1.5 (not intercepted)

# Direct access to physical IP should work
curl -I https://192.168.1.5
# Status: 200 OK
```

## Troubleshooting

### DNS not being intercepted (VPN client still gets 192.168.1.5)
- Verify dnsmasq container is running: `docker ps | grep dnsmasq`
- Verify DNS redirect rules exist AND come first: `docker exec wg-easy iptables -t nat -S`
  (the DNAT rules for port 5353 must appear **above** the NETMAP/NPM rules — see
  "Rule order" note below)
- **Critical**: Check dnsmasq is listening on the container IP (not just localhost):
  ```bash
  docker exec dnsmasq-wg-easy netstat -tuln | grep 5353
  ```
  Should show `0.0.0.0:5353` or `:::5353`, NOT just `127.0.0.1:5353`
- Check dnsmasq config: `docker exec dnsmasq-wg-easy cat /etc/dnsmasq.conf`
  Must NOT have a `listen-address=127.0.0.1` line (just omit it)
- Verify VPN client DNS is set to VPN gateway (e.g., `10.200.0.1`), not directly to Pi-hole
- Check dnsmasq logs: `docker logs dnsmasq-wg-easy | tail -20`
- **Definitive test**: capture traffic directly on dnsmasq's interface to see if packets ever arrive:
  ```bash
  docker exec dnsmasq-wg-easy apk add --no-cache tcpdump
  docker exec dnsmasq-wg-easy timeout 30 tcpdump -i eth0 -n port 5353
  # then query DNS from the VPN client
  ```
  Zero packets captured = the DNAT redirect isn't reaching dnsmasq, almost
  always a rule-order issue (see [DNS_INTERCEPTION.md](./DNS_INTERCEPTION.md) for full diagnostic steps).

### Rule order (common pitfall)
The client's DNS queries target the wg0 gateway address (`10.200.0.1`), which
is inside the translated subnet (`10.200.0.0/24`). Because iptables `nat`
rules stop being evaluated for a packet once it matches a NAT target, if the
NETMAP rule is placed before the DNS interception rule, it silently claims
the packet first and dnsmasq never receives it — with no errors logged
anywhere. **Always place the DNS interception rules first** in PostUp/PostDown,
before the NPM and NETMAP rules (see the corrected hook strings above).

### NPM still unreachable from overlapping VPN clients
- Verify DNAT/SNAT rules: `docker exec wg-easy iptables -t nat -S | grep "10.200.0.5"`
- Ensure rules are in correct order (DNS rules, then NPM rules, then NETMAP): `docker exec wg-easy iptables -t nat -S`
- Check NPM's homelab IP: `docker exec tailscale-npm ip addr show` (should have 192.168.100.5)

### Performance issues / slow DNS
- Check dnsmasq cache size: `grep cache-size /path/to/wg-easy/dnsmasq.conf` (default: 150)
- Monitor dnsmasq: `docker logs -f dnsmasq-wg-easy`

## DNS Interception Setup Process

### Step 1: Ensure dnsmasq is listening on all interfaces
dnsmasq must listen on `0.0.0.0:5353` (all interfaces), not just `127.0.0.1`, because iptables DNAT redirects traffic to the container's network IP (e.g., `172.23.0.2`).

**File**: [dnsmasq.conf](./dnsmasq.conf)
```
port=5353
```
(No `listen-address` or `bind-interfaces` directive — dnsmasq listens on all interfaces by default. Note that `bind-interfaces=0` is not valid syntax and will cause dnsmasq to fail to start.)

### Step 2: Apply iptables DNAT rules (must be placed first, before NPM/NETMAP rules)
The bootstrap script applies DNS redirect rules in PostUp hook:
```bash
iptables -t nat -A PREROUTING -i wg0 -p udp --dport 53 -j DNAT --to-destination 172.23.0.2:5353
iptables -t nat -A PREROUTING -i wg0 -p tcp --dport 53 -j DNAT --to-destination 172.23.0.2:5353
```

These redirect DNS queries from VPN clients (via wg0) to dnsmasq container.

### Step 3: Configure dnsmasq domain rewrites
**File**: [dnsmasq.conf](./dnsmasq.conf)
```
address=/nginx.pimlicoa.duckdns.org/10.200.0.5
```

### Step 4: Set VPN client DNS to VPN gateway
**Important**: VPN client must use VPN gateway as DNS (e.g., `10.200.0.1`), NOT Pi-hole directly.

On your WireGuard config, set:
```
DNS = 10.200.0.1
```

This ensures queries go through wg0 where they can be intercepted.

### Step 5: Verify DNS interception
From VPN client:
```bash
nslookup nginx.pimlicoa.duckdns.org
# Expected: Server: 10.200.0.1, Address: 10.200.0.5
```

From LAN client (should NOT be intercepted):
```bash
nslookup nginx.pimlicoa.duckdns.org
# Expected: Server: 10.200.0.60, Address: 192.168.1.5
```

## Customization

To modify subnet ranges or DNS domains:

1. Update wg-easy `.env`:
   ```env
   HOME_LAN_SUBNET=192.168.1.0/24        # Your actual home LAN
   WG_TRANSLATED_LAN_SUBNET=10.200.0.0/24 # Virtual subnet for VPN clients
   ```

2. Update dnsmasq.conf for additional domain rewrites:
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
