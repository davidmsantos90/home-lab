# WireGuard Easy - Hook Configuration with DNS Interception

This document provides the complete hook strings to configure in the wg-easy web UI for:
- **RFC-001**: Overlap subnet translation (10.200.0.0/24 ↔ 192.168.1.0/24)
- **RFC-002**: Dynamic egress interface detection for MASQUERADE
- **NPM Access**: DNAT/SNAT rules for overlapping VPN clients to reach NPM via 10.200.0.5
- **DNS Interception**: Redirect VPN client DNS queries to local dnsmasq proxy for domain rewriting

## Setup Instructions

1. Open wg-easy web UI at `https://pimlicoa.duckdns.org:51821`
2. Log in with admin credentials
3. Go to **Settings** → **WireGuard Hooks** (or similar configuration section)
4. Copy the **Post Up** hook string below into the Post Up field
5. Copy the **Post Down** hook string below into the Post Down field
6. Save and restart wg-easy

## Post Up Hook

```bash
DEFAULT_IF=$(ip route show default | cut -d' ' -f5 | head -n1); T=10.200.0.0/24; H=192.168.1.0/24; iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o "$DEFAULT_IF" -j MASQUERADE; modprobe xt_NETMAP || true; iptables -t nat -A PREROUTING -d 10.200.0.5/32 -j DNAT --to 192.168.100.5; iptables -t nat -A POSTROUTING -s 192.168.100.5/32 -j SNAT --to 10.200.0.5; iptables -t nat -A PREROUTING -d "$T" -j NETMAP --to "$H"; iptables -t nat -A POSTROUTING -s "$H" -j NETMAP --to "$T"; iptables -t nat -A PREROUTING -i wg0 -p udp --dport 53 -j REDIRECT --to-port 5353; iptables -t nat -A PREROUTING -i wg0 -p tcp --dport 53 -j REDIRECT --to-port 5353; iptables -A INPUT -p udp -m udp --dport 51820 -j ACCEPT; iptables -A FORWARD -i wg0 -j ACCEPT; iptables -A FORWARD -o wg0 -j ACCEPT;
```

## Post Down Hook

```bash
DEFAULT_IF=$(ip route show default | cut -d' ' -f5 | head -n1); T=10.200.0.0/24; H=192.168.1.0/24; iptables -t nat -D POSTROUTING -s 10.8.0.0/24 -o "$DEFAULT_IF" -j MASQUERADE; iptables -t nat -D PREROUTING -d 10.200.0.5/32 -j DNAT --to 192.168.100.5; iptables -t nat -D POSTROUTING -s 192.168.100.5/32 -j SNAT --to 10.200.0.5; iptables -t nat -D PREROUTING -d "$T" -j NETMAP --to "$H"; iptables -t nat -D POSTROUTING -s "$H" -j NETMAP --to "$T"; iptables -t nat -D PREROUTING -i wg0 -p udp --dport 53 -j REDIRECT --to-port 5353; iptables -t nat -D PREROUTING -i wg0 -p tcp --dport 53 -j REDIRECT --to-port 5353; iptables -D INPUT -p udp -m udp --dport 51820 -j ACCEPT; iptables -D FORWARD -i wg0 -j ACCEPT; iptables -D FORWARD -o wg0 -j ACCEPT;
```

## Hook Breakdown

The hooks execute these steps in order:

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

### 3. NPM-Specific DNAT/SNAT (Must be before NETMAP rules!)
```bash
iptables -t nat -A PREROUTING -d 10.200.0.5/32 -j DNAT --to 192.168.100.5
iptables -t nat -A POSTROUTING -s 192.168.100.5/32 -j SNAT --to 10.200.0.5
```
Routes overlapping VPN clients to NPM via its static homelab IP (192.168.100.5). 
**Important**: These rules must come BEFORE the broad NETMAP rules so they match first.

### 4. RFC-001: Overlap Subnet Translation (NETMAP)
```bash
iptables -t nat -A PREROUTING -d 10.200.0.0/24 -j NETMAP --to 192.168.1.0/24
iptables -t nat -A POSTROUTING -s 192.168.1.0/24 -j NETMAP --to 10.200.0.0/24
```
Translates all traffic between VPN subnet (10.200.0.0/24) and home LAN (192.168.1.0/24).
- PREROUTING: Rewrites destination for incoming traffic
- POSTROUTING: Rewrites source for outgoing traffic

### 5. DNS Interception (New!)
```bash
iptables -t nat -A PREROUTING -i wg0 -p udp --dport 53 -j REDIRECT --to-port 5353
iptables -t nat -A PREROUTING -i wg0 -p tcp --dport 53 -j REDIRECT --to-port 5353
```
Redirects all DNS queries (UDP and TCP port 53) from wg0 interface to local dnsmasq proxy on port 5353.
This allows VPN clients to receive translated DNS responses.

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
- Verify DNS redirect rules: `docker exec wg-easy iptables -t nat -S | grep "5353"`
- Check dnsmasq logs: `docker logs dnsmasq-wg-easy`

### NPM still unreachable from overlapping VPN clients
- Verify DNAT/SNAT rules: `docker exec wg-easy iptables -t nat -S | grep "10.200.0.5"`
- Ensure rules are in correct order (NPM rules before NETMAP): `docker exec wg-easy iptables -t nat -S`
- Check NPM's homelab IP: `docker exec tailscale-npm ip addr show` (should have 192.168.100.5)

### Performance issues / slow DNS
- Check dnsmasq cache size: `grep cache-size /path/to/wg-easy/dnsmasq.conf` (default: 150)
- Monitor dnsmasq: `docker logs -f dnsmasq-wg-easy`

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

3. Re-run bootstrap script or manually update hooks in web UI

## References

- RFC-001: Overlap subnet translation using NETMAP
- RFC-002: Dynamic egress interface detection
- RFC-003: DNS and service reachability over WireGuard
- RFC-004: (service-specific documentation)
