# RFC-007 — Dynamic WireGuard Peer Access Control

## Status

**CURRENT / IMPLEMENTED**

This RFC documents the access-control and VPN-infrastructure architecture that is
already working in the repository, and defines the next planned abstractions on
top of it.

---

## 1. Summary

The current WireGuard deployment uses `wg-easy` as the VPN gateway and applies
runtime firewall rules without requiring a `wg-easy` restart for normal policy
changes.

The implemented architecture separates:

- VPN infrastructure traffic;
- peer-to-peer access control;
- peer-to-LAN access control;
- NAT / NETMAP / MASQUERADE routing;
- policy synchronization / compilation;
- dynamic selector-set compilation for repeated peer/address matches.

The next planned evolution is a logical policy model with peer, host, and
service inventories, so administrators define intent in names rather than raw IP
and port tuples.

---

## 2. CURRENT / IMPLEMENTED

### 2.1 WireGuard topology

Implemented:

- WireGuard subnet: `10.8.0.0/24`
- WireGuard gateway/server: `10.8.0.1`
- Peers use `10.8.0.x` addresses
- Peers use `10.8.0.1` as DNS

This is the currently supported DNS endpoint for peers.

### 2.2 VPN infrastructure separation

Traffic is split into two logical filter paths:

```text
FORWARD
  ├── WG_INFRASTRUCTURE
  │     └── DNS -> Pi-hole
  └── WG_ACCESS_CONTROL
        ├── peer -> peer
        ├── peer -> LAN
        └── default DROP
```

DNS is treated as VPN infrastructure traffic, not as an ordinary peer ACL.

Implemented DNS path:

```text
WireGuard peer
  -> 10.8.0.1:53
  -> VPN infrastructure
  -> DNAT
  -> Pi-hole 172.28.0.2:5353
```

All DNS queries arriving on `wg0` are forwarded to Pi-hole.

Implemented behavior:

- UDP DNS is forwarded
- TCP DNS is forwarded
- no DNS payload inspection is used
- the previous STRING-matching approach has been removed

The following remain valid:

- `dig @10.8.0.1 google.com`
- `dig @10.8.0.1 nginx.pimlicoa.duckdns.org`
- `dig @10.8.0.1 google.com +tcp`
- `dig @10.8.0.1 nginx.pimlicoa.duckdns.org +tcp`

Pi-hole remains the actual resolver.

### 2.3 Anti-conflict translation

Implemented:

- `10.200.0.0/24` is the translated LAN address space
- `NETMAP` maps `10.200.0.0/24` to `192.168.1.0/24`
- example: `nginx.pimlicoa.duckdns.org -> 10.200.0.60 -> 192.168.1.60`

This translation layer stays independent from DNS and ACL semantics.

### 2.4 Internet routing and NAT

Implemented:

- Internet routing remains separate from DNS
- MASQUERADE remains independent
- peers retain Internet access while using `DNS = 10.8.0.1`

### 2.5 Dynamic access control

Implemented:

- peer-to-peer rules
- peer-to-LAN rules
- granular protocol/port rules
- deterministic rule priority
- default deny
- explicit REJECT
- DROP fallback
- dynamic application without restarting `wg-easy`
- ipset-backed selector sets when a rule matches multiple peers or addresses

Runtime model:

```text
logical policy
  -> policy compiler / synchronizer
  -> iptables runtime state
```

The logical policy is the source of truth.
iptables is generated runtime state.

Rules are applied idempotently so repeated synchronization does not create
duplicate runtime state.

REJECT vs DROP:

- REJECT: explicit intentional denial with immediate feedback
- DROP: default-deny / fallback behavior

Example:

- `phone -> Raspberry:22 = REJECT`
- unmatched traffic = DROP

### 2.6 Current peer name resolution

Peer names are already supported.

Example policy:

```json
{
  "source": "dams-s23",
  "destination": "mac-work",
  "action": "allow"
}
```

Current behavior:

- a manual synchronization mechanism resolves peer names to WireGuard IPs
- the policy layer uses logical peer names
- the synchronizer resolves them to runtime IPs before generating iptables

Example runtime mapping:

- `dams-s23 -> 10.8.0.4`
- `mac-work -> 10.8.0.2`

Existing IP-based rules remain supported.

### 2.7 Current implementation boundary

The repository currently implements:

- a manual sync tool for access-control rules
- persistent hook-based infrastructure rules
- `WG_INFRASTRUCTURE`
- `WG_ACCESS_CONTROL`
- DNS forwarding to Pi-hole
- peer-name resolution
- dynamic selector-set compilation

It does **not** yet implement:

- LAN host/resource inventories
- service catalogs
- automatic peer discovery
- a management UI

---

## 3. CURRENT POLICY MODEL

The current rule model supports:

- `source`
- `destination`
- `protocol`
- `port`
- `action`

and optionally:

- `source_group`
- `destination_group`
- wildcard selectors such as `*`

Allowed actions currently include:

- `allow`
- `deny`
- `drop`
- `reject`

The model is directional for new connections.

More specific rules must be evaluated before broader rules.

Examples:

- `phone -> Raspberry -> tcp/22 -> REJECT`
- `phone -> Raspberry -> ALL -> ALLOW`
- `phone -> Mac -> tcp/8022 -> ALLOW`
- `phone -> Mac -> ALL -> DENY`

The policy model, not manual iptables insertion order, defines the intended
priority.

---

## 4. FUTURE / PLANNED

### 4.1 LAN host / resource name resolution

Planned next step:

```json
{
  "source": "dams-s23",
  "destination": "raspberry",
  "protocol": "tcp",
  "port": 22,
  "action": "reject"
}
```

With inventory data such as:

```json
{
  "hosts": {
    "raspberry": {
      "address": "192.168.1.60"
    }
  }
}
```

The compiler would resolve `raspberry -> 192.168.1.60` before generating
iptables rules.

This is not required to be implemented now.
Existing IP-based rules must remain supported.

### 4.2 Service abstraction

Planned optional abstraction:

```json
{
  "source": "dams-s23",
  "destination": "raspberry",
  "service": "ssh",
  "action": "reject"
}
```

Example service catalog:

```json
{
  "services": {
    "ssh": {
      "protocol": "tcp",
      "port": 22
    },
    "sftp-phone": {
      "protocol": "tcp",
      "port": 8022
    },
    "https": {
      "protocol": "tcp",
      "port": 443
    }
  }
}
```

This is an abstraction on top of the existing protocol/port model, not a
replacement for it.

Direct protocol/port rules must remain supported.

### 4.3 Policy compiler improvements

The current manual synchronizer already handles peer-name resolution, rule
compilation, and deterministic runtime application for the implemented policy
model. The remaining compiler work is:

1. Resolve peer names to WireGuard IPs automatically from the wg-easy API.
2. Resolve host/resource names to LAN IPs.
3. Resolve optional service names to protocol/port definitions.
4. Validate references.
5. Validate policy syntax.
6. Preserve rule priority.
7. Generate deterministic iptables rules.
8. Apply changes incrementally.
9. Avoid duplicate rules.
10. Remove obsolete generated rules.
11. Avoid restarting `wg-easy`.
12. Keep infrastructure rules separate from access-control rules.

The same logical policy should produce deterministic runtime rules.

### 4.4 Automatic peer discovery

Planned `wg-easy` API integration:

- peer name
- WireGuard IP
- useful peer state information

Planned flow:

```text
wg-easy API
  -> peer inventory
  -> policy compiler
  -> iptables
```

Current manual peer-name-to-IP synchronization remains valid until this future
step is implemented.

### 4.5 Management UI

A future management UI should sit on top of the logical policy model:

```text
Management UI
  -> logical policy
  -> policy compiler
  -> iptables
```

The UI should show logical names wherever possible.
It should not implement networking logic itself.

---

## 5. ARCHITECTURAL PRINCIPLES

### 5.1 Policy as source of truth

The logical policy configuration is the source of truth.
iptables is generated runtime state.

Administrators should normally edit the logical policy, not generated iptables
rules. Manual iptables inspection remains useful for troubleshooting.

### 5.2 What the logical policy should express

The long-term model is:

```text
WHO -> CAN ACCESS -> WHAT -> USING WHICH SERVICE -> ACTION
```

not:

```text
source IP -> destination IP -> protocol -> port -> iptables rule
```

The compiler translates the logical policy into deterministic runtime rules.

The abstraction must preserve:

- granular access control
- deterministic priority
- default deny
- explicit reject
- dynamic rule updates
- no `wg-easy` restart
- separation of infrastructure and access-control traffic
- compatibility with existing NETMAP / MASQUERADE architecture

---

## 6. CURRENT VS FUTURE TABLE

| CURRENT / IMPLEMENTED | FUTURE / PLANNED |
| --- | --- |
| dynamic peer/LAN ACLs | LAN host/resource names |
| granular rules | service aliases |
| rule priority | automatic peer synchronization through wg-easy API |
| default deny | richer compiler validation |
| explicit REJECT | management UI |
| DROP fallback | policy editing through the UI |
| no wg-easy restart required | peer inventory UI |
| WG_INFRASTRUCTURE chain | service catalog UI |
| WG_ACCESS_CONTROL chain | compiler-managed host/service abstractions |
| DNS at `10.8.0.1` | automatic inventory reconciliation |
| Pi-hole forwarding | richer state reporting |
| NETMAP anti-conflict translation | policy import/export tooling |
| MASQUERADE | — |
| manual peer name -> IP synchronization | — |
| selector-set compilation with ipset | — |

---

## 7. VALIDATION

This RFC does not change the current networking configuration.

The documented architecture remains consistent with these working behaviors:

### DNS

- `dig @10.8.0.1 google.com`
- `dig @10.8.0.1 nginx.pimlicoa.duckdns.org`
- `dig @10.8.0.1 google.com +tcp`
- `dig @10.8.0.1 nginx.pimlicoa.duckdns.org +tcp`

### Local service

- `curl -vk https://nginx.pimlicoa.duckdns.org`

### Internet

- `ping 1.1.1.1`
- `curl -4 -I --max-time 10 https://www.google.com`

### Access control

- `phone -> Raspberry SSH = REJECT`
- `phone -> Mac SFTP = ALLOW`
- `phone -> Mac other traffic = DENY`
- `Mac -> phone = ALLOW`

---

## 8. IMPLEMENTATION NOTES

Current repository reality:

- the access-control layer is implemented as a manual sync tool plus runtime
  iptables manipulation;
- the compiler/synchronizer already resolves peer names;
- DNS infrastructure is separated from peer ACLs;
- host/resource names and service abstractions are not yet implemented;
- the management UI is still future work.

That means the RFC should treat the current system as a working baseline, not as
a fully complete policy platform.

---

## 9. Decision

Adopt the current dynamic firewall policy layer as the baseline and evolve it
toward a logical policy model.

The next architecture should preserve:

- granular per-peer control
- deterministic rule priority
- default deny
- explicit reject
- dynamic updates without `wg-easy` restart
- separation of infrastructure and access-control traffic
- compatibility with current DNS, NETMAP, and MASQUERADE behavior

The future UI and compiler layers should translate logical intent into
deterministic runtime iptables state.
