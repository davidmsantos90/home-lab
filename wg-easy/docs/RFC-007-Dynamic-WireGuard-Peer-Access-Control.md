# RFC-007 — Dynamic WireGuard Peer Access Control

## Status

**In progress**

## Summary

This RFC proposes a dynamic access-control layer for the WireGuard VPN managed by `wg-easy`.

The goal is to allow granular control over which WireGuard peers can communicate with:

- other WireGuard peers;
- homelab services;
- LAN devices;
- specific ports/protocols;
- the Internet.

The solution must **not require restarting `wg-easy` or the WireGuard interface when access rules are changed**.

The proposed architecture separates:

1. WireGuard peer management;
2. routing;
3. NAT;
4. firewall policy;
5. future UI-based policy management.

---

## 1. Motivation

The current WireGuard deployment uses `wg-easy` as the central VPN gateway.

WireGuard peers are assigned addresses from:

```text
10.8.0.0/24
```

with the `wg-easy` gateway using:

```text
10.8.0.1
```

The current configuration uses a broad `MASQUERADE` rule for traffic from `10.8.0.0/24` leaving through `eth1`. This is required for some traffic paths, particularly Internet access, but hides the original peer IP from downstream services.

The proposed access-control layer allows policies such as:

```text
MacBook → Immich:443    ALLOW
MacBook → NAS:445       DENY
iPhone  → Immich:443    ALLOW
iPhone  → NAS:445       DENY
Tablet  → Immich:443    ALLOW
Tablet  → iPhone:*      DENY
```

---

## 2. Goals

The system MUST:

- support access control between WireGuard peers;
- support access control from peers to homelab services;
- support access control to specific IPs, ports and protocols;
- support both `ALLOW` and `DENY` policies;
- allow rules to be changed at runtime;
- avoid restarting `wg-easy` when policies change;
- preserve the existing WireGuard peer configuration;
- use the `wg-easy` API as the source of truth for active peers;
- allow policies to reference peers by identity rather than hardcoded IP addresses where practical;
- support group-based policies as a convenience;
- support fully granular per-peer policies;
- remain compatible with the existing NAT/routing architecture.

---

## 3. Non-Goals

This RFC does not propose replacing `wg-easy`.

It does not define:

- WireGuard key management;
- peer creation/deletion;
- VPN authentication;
- the Internet NAT architecture;
- the existing network-conflict `NETMAP` mechanism;
- replacement of the Vodafone router;
- replacement of the existing WireGuard configuration.

Those remain separate concerns.

---

## 4. Current Architecture

The current architecture is approximately:

```text
                         Internet
                            │
                            │
                       Vodafone Router
                            │
                       UDP 51820
                            │
                            ▼
                       wg-easy
                  ┌──────────────────┐
                  │                  │
                  │ wg0              │
                  │ 10.8.0.1/24      │
                  │                  │
                  │ eth1             │
                  │ 192.168.100.9    │
                  │                  │
                  └────────┬─────────┘
                           │
                    Homelab network
```

The `wg-easy` routing table currently contains:

```text
10.8.0.0/24       dev wg0
192.168.100.0/24  dev eth1
default           via 192.168.100.1
```

The WireGuard interface is:

```text
wg0
10.8.0.1/24
```

---

## 5. Existing NAT

The current `POSTROUTING` configuration contains:

```text
MASQUERADE  all  --  *  eth1  10.8.0.0/24  0.0.0.0/0
```

This means all traffic originating from the WireGuard subnet and leaving through `eth1` is masqueraded.

The existing configuration also contains network-conflict handling:

```text
NETMAP  all  --  *  *  192.168.1.0/24  0.0.0.0/0
       to:10.200.0.0/24
```

There is also an existing SNAT rule for another internal mapping.

These rules are outside the scope of the access-control layer, although the firewall implementation MUST take their behaviour into account.

---

## 6. Proposed Architecture

The proposed architecture introduces a separate **Peer Access Manager**.

```text
                       ┌──────────────────┐
                       │      wg-easy     │
                       │                  │
                       │ WireGuard + API  │
                       └────────┬─────────┘
                                │
                                │ peer information
                                ▼
                    ┌───────────────────────┐
                    │   Peer Access Manager │
                    │                       │
                    │ - peer discovery      │
                    │ - identities          │
                    │ - groups              │
                    │ - access policies     │
                    └──────────┬────────────┘
                               │
                               │ runtime updates
                               ▼
                    ┌───────────────────────┐
                    │ Firewall / nftables   │
                    │ or iptables + ipsets  │
                    └──────────┬────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
          Peer-to-peer      Homelab           Internet
```

The Peer Access Manager is **not responsible for managing WireGuard peers**.

Instead, it consumes peer information from the `wg-easy` API.

---

## 7. Peer Identity

Policies SHOULD reference a logical peer identity rather than directly referencing an IP address.

For example:

```yaml
peer:
  id: macbook
  wireguard_ip: 10.8.0.2
```

The policy can then reference:

```text
macbook
```

rather than:

```text
10.8.0.2
```

This allows the firewall layer to automatically update its implementation if the peer's address changes.

The `wg-easy` API remains the authoritative source for the current WireGuard IP.

---

## 8. Access Policy Model

The policy model SHOULD support the following dimensions:

```text
Source peer
Destination peer/service/IP
Protocol
Port
Action
```

For example:

```yaml
source: macbook
destination: immich
protocol: tcp
port: 443
action: allow
```

Another example:

```yaml
source: iphone
destination: nas
protocol: tcp
port: 445
action: deny
```

This allows policies to be significantly more granular than simple group membership.

---

## 9. Groups

Groups SHOULD be supported as an optional convenience mechanism.

For example:

```yaml
groups:
  admins:
    - macbook
    - desktop

  family:
    - iphone
    - tablet
```

A policy could then reference:

```yaml
source_group: family
destination: immich
protocol: tcp
port: 443
action: allow
```

Groups MUST NOT replace individual peer policies.

A peer SHOULD be able to have both:

- group-based permissions;
- peer-specific exceptions.

---

## 10. Example Policy

Consider the following peers:

```text
MacBook    10.8.0.2
iPhone     10.8.0.3
Tablet     10.8.0.4
```

and services:

```text
Immich     10.200.0.5:443
Pi-hole    10.200.0.1:53
NAS        10.200.0.10:445
```

Desired policy:

```text
MacBook:
  → Immich:443       ALLOW
  → Pi-hole:53       ALLOW
  → NAS:445          ALLOW
  → all peers        ALLOW

iPhone:
  → Immich:443       ALLOW
  → Pi-hole:53       ALLOW
  → NAS:445          DENY
  → MacBook:*        DENY

Tablet:
  → Immich:443       ALLOW
  → Pi-hole:53       DENY
  → NAS:445          DENY
  → other peers      DENY
```

This can be represented as:

```yaml
rules:
  - source: macbook
    destination: immich
    protocol: tcp
    port: 443
    action: allow

  - source: macbook
    destination: pihole
    protocol: udp
    port: 53
    action: allow

  - source: macbook
    destination: nas
    protocol: tcp
    port: 445
    action: allow

  - source: iphone
    destination: immich
    protocol: tcp
    port: 443
    action: allow

  - source: iphone
    destination: pihole
    protocol: udp
    port: 53
    action: allow

  - source: iphone
    destination: nas
    protocol: tcp
    port: 445
    action: deny

  - source: tablet
    destination: immich
    protocol: tcp
    port: 443
    action: allow
```

---

## 11. Runtime Firewall Implementation

The firewall configuration MUST be mutable without restarting `wg-easy`.

### 11.1 iptables + ipsets

Repeated policy targets can be represented using `ipset`.

For example:

```text
immich_allowed:
  10.8.0.2
  10.8.0.3
  10.8.0.4
```

A permanent firewall rule could then reference the set:

```bash
iptables -A FORWARD     -s 10.8.0.0/24     -d 10.200.0.5     -p tcp     --dport 443     -m set     --match-set immich_allowed src     -j ACCEPT
```

Adding a peer requires only:

```bash
ipset add immich_allowed 10.8.0.5
```

Removing it:

```bash
ipset del immich_allowed 10.8.0.5
```

No WireGuard restart is required.

### 11.2 nftables

`nftables` SHOULD be considered for the long-term implementation.

It provides a more structured way of expressing:

- peer-to-peer rules;
- IP sets;
- service sets;
- protocol/port restrictions;
- stateful connections;
- logging;
- dynamic updates.

The initial implementation MAY continue using `iptables + ipset` if this reduces complexity and risk.

---

## 12. Stateful Connections

The firewall MUST allow established and related traffic.

Conceptually:

```text
ESTABLISHED,RELATED → ACCEPT
```

This avoids requiring separate rules for response traffic.

Example:

```text
10.8.0.3 → Immich:443
```

is explicitly allowed, and the response:

```text
Immich → 10.8.0.3
```

is automatically permitted as part of the established connection.

---

## 13. Peer-to-Peer Communication

Peer-to-peer traffic MUST be treated as a separate access-control dimension.

For example:

```text
10.8.0.2 → 10.8.0.3:*  ALLOW
10.8.0.3 → 10.8.0.2:*  ALLOW
10.8.0.4 → 10.8.0.2:*  DENY
```

This traffic is forwarded through `wg-easy` and therefore can be controlled using its firewall.

---

## 14. NAT Separation

The firewall layer MUST remain separate from NAT.

The current broad MASQUERADE rule:

```text
10.8.0.0/24 → eth1 → MASQUERADE
```

should not be directly modified by the access-control UI.

If future work introduces exceptions to preserve peer identity for internal traffic, those rules SHOULD remain part of the dedicated NAT/routing layer.

Conceptually:

```text
Routing/NAT:
  - WireGuard routing
  - MASQUERADE
  - NETMAP
  - SNAT
  - internal NAT exceptions

Firewall:
  - peer permissions
  - service permissions
  - port restrictions
  - peer-to-peer policies
```

---

## 15. Hooks

Existing `wg-easy` hooks SHOULD continue to be used for **static infrastructure configuration**.

For example:

```text
hooks/
├── routing.sh
└── nat.sh
```

These can configure:

- forwarding;
- NAT;
- NETMAP;
- static routing;
- baseline firewall requirements.

However, peer-specific access rules MUST NOT be hardcoded into these hooks.

This avoids the need to restart `wg-easy` every time a peer is added or its permissions change.

---

## 16. Peer Synchronisation

The Peer Access Manager SHOULD periodically or event-driven query the `wg-easy` API.

When a new peer appears:

```text
wg-easy
   ↓
API
   ↓
Peer Access Manager
   ↓
new peer detected
   ↓
peer appears as "Unconfigured"
   ↓
administrator chooses policy
   ↓
firewall updated
```

When a peer is removed:

```text
wg-easy
   ↓
API
   ↓
Peer Access Manager
   ↓
peer removed
   ↓
firewall references cleaned up
```

The system SHOULD prevent stale IP addresses from remaining in firewall sets.

---

## 17. Future UI

A future web UI SHOULD expose the policy model without requiring direct firewall interaction.

Example:

```text
Peer: MacBook
IP: 10.8.0.2

Access Rules

Destination       Protocol    Port    Action
------------------------------------------------
Immich             TCP        443     ALLOW
Pi-hole            UDP        53      ALLOW
NAS                TCP        445     DENY
iPhone             ANY        ANY     ALLOW
Tablet             ANY        ANY     DENY
```

The UI SHOULD support:

- peer selection;
- destination selection;
- protocol selection;
- port selection;
- allow/deny;
- groups;
- peer-specific overrides;
- rule ordering/priority;
- active/inactive rules;
- basic connection logging.

---

## 18. Configuration Storage

The access policy SHOULD be stored separately from the WireGuard configuration.

For example:

```text
data/
├── wg-easy/
└── access-control/
    └── policies.yaml
```

The policy configuration SHOULD be version-controlled where appropriate.

The WireGuard private keys MUST NOT be stored in the access-control repository.

---

## 19. Security Considerations

The Peer Access Manager controls network-level access and therefore MUST be treated as a privileged component.

The manager SHOULD:

- run with the minimum required privileges;
- expose its UI only to trusted networks;
- require authentication;
- validate all policy changes;
- prevent arbitrary shell command execution;
- log policy changes;
- avoid exposing the firewall API directly to clients.

The `wg-easy` API credentials MUST NOT be exposed to the browser.

---

## 20. Failure Behaviour

If the Peer Access Manager stops running:

- existing firewall rules SHOULD remain active;
- WireGuard connectivity SHOULD continue;
- existing NAT/routing SHOULD continue;
- no automatic fail-open behaviour SHOULD occur.

The manager should therefore be responsible for **policy management**, not packet forwarding itself.

---

## 21. Design Principle

The core architectural principle is:

```text
WireGuard
    = connectivity + peer identity

Routing
    = where traffic goes

NAT
    = how source/destination addresses are translated

Firewall
    = who is allowed to communicate with whom

Peer Access Manager
    = manages firewall policy

Future UI
    = human-friendly interface to the policy
```

This separation allows each component to evolve independently.

---

## 22. Implementation Phases

### Phase 1 — Baseline

- Document current `wg-easy` routing/NAT.
- Keep existing hooks.
- Introduce a baseline firewall policy.
- Ensure peer-to-peer and peer-to-homelab forwarding is explicitly controlled.
- First implementation slice: a manual sync tool that reads policy JSON,
  resolves peer identities from the `wg-easy` API, and applies live iptables
  rules without restarting `wg-easy`.

### Phase 2 — Dynamic firewall sets

- Introduce `ipset` or `nftables` sets.
- Remove peer-specific firewall rules from startup hooks.
- Verify rules can be changed without restarting `wg-easy`.

### Phase 3 — Policy model

Implement a declarative policy format:

```yaml
source:
destination:
protocol:
port:
action:
```

Support both peer-specific and group-based rules.

### Phase 4 — Peer synchronisation

Integrate with the `wg-easy` API.

Automatically:

- discover peers;
- map peer identity → current WireGuard IP;
- detect additions/removals;
- update firewall sets.

This first implementation intentionally uses manual sync only; no polling or
event-driven loop is required yet.

### Phase 5 — Web UI

Implement a small management UI for:

- peers;
- groups;
- services;
- access rules;
- policy status;
- firewall synchronisation.

---

## 23. Example End State

The final architecture should look approximately like:

```text
                           Internet
                              │
                              │
                       Vodafone Router
                              │
                         UDP 51820
                              │
                              ▼
                     ┌─────────────────┐
                     │     wg-easy     │
                     │                 │
                     │ WireGuard       │
                     │ 10.8.0.0/24     │
                     │                 │
                     │ Routing + NAT   │
                     └────────┬────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │ Firewall             │
                    │                     │
                    │ Dynamic policies    │
                    │ ipsets / nftables   │
                    └─────────┬───────────┘
                              │
             ┌────────────────┼────────────────┐
             │                │                │
             ▼                ▼                ▼
          Peer ↔ Peer      Homelab          Internet


                         ┌───────────────┐
                         │ Peer Access   │
                         │ Manager       │
                         │               │
                         │ wg-easy API   │
                         │ Policy store  │
                         │ Runtime sync  │
                         └───────┬───────┘
                                 │
                                 ▼
                              Future UI
```

## Decision

Adopt a **dynamic firewall policy layer independent of `wg-easy` restarts**, with support for both **granular per-peer rules and group-based rules**.

The initial implementation may use `iptables + ipset` to minimise changes to the existing environment. `nftables` should remain the preferred candidate for a future, more sophisticated implementation.

The existing hooks remain responsible for static routing/NAT infrastructure, while peer-specific access policy is managed dynamically at runtime.

### Initial implementation slice

- `wg-easy/access-control-sync.py` — manual sync tool
- `wg-easy/access-control/policies.json.example` — starter policy file
- `lab.sh access-sync` — convenience entry point
