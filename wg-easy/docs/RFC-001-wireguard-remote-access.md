# RFC-001 — WireGuard Remote Access Strategy

**Status:** Draft

**Service:** wg-easy

**Last Updated:** 2026-04

---

# 1. Purpose

This RFC defines the long-term remote access strategy for the homelab.

WireGuard is intended to provide secure remote access for environments where Tailscale cannot be installed or executed (for example managed corporate laptops).

This document describes the current implementation, the problems discovered during testing, and the target architecture.

---

# 2. Current Architecture

Current deployment:

```
Internet
    │
DuckDNS
    │
Vodafone Router
    │
UDP 51820
    │
Raspberry Pi
    │
Docker Network (homelab)
    ├── wg-easy
    ├── Tailscale
    ├── Nginx Proxy Manager
    ├── Pi-hole
    ├── Deluge
    ├── Immich
    └── Other services
```

WireGuard and Tailscale are deployed as independent Docker services.

Both services communicate through the shared Docker network but **must not share the same network namespace**.

---

# 3. Current Status

Implemented:

- Docker deployment
- wg-easy v15
- DuckDNS integration
- Router port forwarding
- External connectivity
- Successful WireGuard handshakes
- Client configuration generation

Validated:

- VPN works correctly when the client network does not overlap with the home LAN.

Known limitation:

- Clients connected from another `192.168.1.0/24` network cannot reach homelab resources.

---

# 4. Root Cause Analysis

Testing confirmed that the VPN implementation is working correctly.

The issue is caused by overlapping private LANs.

Example:

Home LAN

```
192.168.1.0/24
```

Remote LAN

```
192.168.1.0/24
```

Modern operating systems always prefer the directly connected network.

As a consequence:

- WireGuard handshake succeeds.
- Encrypted traffic is exchanged.
- VPN tunnel is established.
- Traffic destined for the home LAN never reaches the tunnel.

Testing from a mobile hotspot confirmed that the VPN works correctly when the client network uses a different subnet.

---

# 5. Architecture Decisions

## ADR-001

Keep Tailscale and WireGuard as independent services.

Reason:

Independent lifecycle, simpler maintenance and easier troubleshooting.

---

## ADR-002

Do not renumber the home LAN.

Reason:

The LAN already contains multiple static IP assignments and service configurations.

Changing the subnet would create unnecessary maintenance overhead.

---

## ADR-003

Expose WireGuard through DuckDNS.

Reason:

Supports residential Internet connections with dynamic public IP addresses.

---

## ADR-004

The VPN solution must remain compatible with a future Proxmox migration.

---

# 6. Functional Requirements

The final implementation shall:

- preserve the existing LAN
- support overlapping client networks
- require no client-side routing changes
- support multiple VPN clients
- survive reboots
- work with Docker
- remain compatible with Proxmox
- require minimal maintenance
- keep Tailscale fully independent

---

# 7. Non-Goals

The implementation shall **not**:

- change the LAN subnet
- replace Tailscale
- expose additional Internet-facing services
- require manual routing on client devices
- introduce unnecessary complexity

---

# 8. Candidate Solutions

Possible implementation approaches include:

- nftables
- iptables NETMAP
- policy routing
- static routing
- other Linux NAT/routing techniques

The implementation has **not** been selected yet.

The preferred solution should prioritise:

- simplicity
- maintainability
- portability
- Docker compatibility
- Proxmox compatibility

---

# 9. Target Architecture

The preferred long-term architecture is:

```
Remote Client
       │
WireGuard
       │
Virtual VPN Network
   (example: 10.200.0.0/24)
       │
Address Translation / Routing
       │
Home LAN
(192.168.1.0/24)
```

Clients should never need to know the actual LAN subnet.

The translation layer should hide the internal network from VPN clients.

---

# 10. Open Questions

The following decisions remain open:

- Should nftables be preferred over iptables?
- Is NETMAP the simplest long-term solution?
- Which virtual subnet should be used?
- What is the cleanest migration path to Proxmox?

---

# 11. Lessons Learned

The implementation process produced the following findings:

- Successful WireGuard handshakes do not guarantee LAN reachability.
- Overlapping private networks are a client-side routing problem.
- Testing from a mobile hotspot is an effective way to isolate routing issues.
- Sharing a Docker network namespace with Tailscale was **not** the cause of the routing issue.
- Separating Tailscale and WireGuard into independent Docker services remains the preferred architecture.

---

# 12. Acceptance Criteria

The implementation is considered complete when:

- VPN clients can access the homelab from overlapping private networks.
- The home LAN remains `192.168.1.0/24`.
- Multiple clients can connect simultaneously.
- Configuration survives reboot.
- Docker deployment remains simple.
- Migration to Proxmox remains straightforward.

---

# 13. Copilot Implementation Guidelines

When implementing this RFC:

- Preserve the current Docker structure.
- Do not modify unrelated services.
- Prefer Linux-native networking solutions.
- Keep WireGuard and Tailscale independent.
- Minimise operational complexity.
- Document every architectural decision.
- Prefer maintainable solutions over clever solutions.

Do not modify the LAN addressing unless explicitly requested.

---

### DNS considerations

When using a translated LAN subnet (e.g. `10.200.0.0/24`), VPN clients should use the translated address of the DNS server (e.g. `10.200.0.53`) instead of its physical LAN address (`192.168.1.53`).

The translation layer must transparently forward DNS traffic to the real Pi-hole instance.

No additional Pi-hole configuration should be required for basic DNS resolution.