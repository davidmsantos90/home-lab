# RFC-005 — Per-Client Access Restriction

## Status

Proposed (not implemented)

## Problem

All WireGuard clients currently get equivalent network access. There's no
way to create a "restricted" client — for example, a guest device or a
lower-trust client that should only reach one or two specific services,
while normal clients keep full access to the homelab.

The wg-easy web UI lets you set a custom **Allowed IPs** value per client,
which looks like a per-client firewall/ACL control, but in this stack it does
not actually enforce a destination restriction server-side. This RFC
documents why, and proposes a design for real enforcement.

## Why the current tools don't solve this

### 1. WireGuard `AllowedIPs` is not a server-side destination ACL

A peer's `AllowedIPs` in WireGuard is used for two things:

- **Outgoing (encapsulation) routing**: which peer to encrypt a packet to,
  based on destination. This is what gets written into the client's own
  generated `.conf` file, and is what the client's OS uses to decide which
  traffic enters the tunnel at all.
- **Incoming (decapsulation) source check**: after decrypting a packet from
  a peer, the kernel verifies the packet's *source* address falls within
  that peer's configured `AllowedIPs` (anti-spoofing). This has nothing to
  do with the packet's destination.

Neither of these restricts what destinations the **server** will forward a
client's traffic to once it's decrypted. That's governed entirely by normal
IP forwarding (`net.ipv4.ip_forward`) and the `iptables FORWARD` chain.

[`bootstrap-hooks.sh`](../hooks/bootstrap-hooks.sh) installs:

```
iptables -A FORWARD -i wg0 -j ACCEPT
iptables -A FORWARD -o wg0 -j ACCEPT
```

This unconditionally accepts all traffic between `wg0` and the rest of the
network, for every client, regardless of that client's `AllowedIPs` setting.
So restricting a client's `AllowedIPs` in the UI only affects **well-behaved**
clients whose OS won't route non-included destinations into the tunnel in
the first place — it does not stop a client that (accidentally or
deliberately) sends traffic for a broader destination.

### 2. NPM Access Lists only cover traffic that goes through NPM

Nearly all homelab services are reverse-proxied through NPM at a single
translated address (`10.200.0.5`). NPM routes by HTTP `Host` header, not by
source IP/destination port, so a client with routable access to `10.200.0.5`
can reach every proxy host behind it unless each proxy host also has an NPM
**Access List** restricting by source IP.

Because no SNAT is applied between `wg0` and the `homelab` bridge (see the
DNAT/SNAT rules in [`bootstrap-hooks.sh`](../hooks/bootstrap-hooks.sh)), each
client's real WireGuard tunnel address (e.g. `10.8.0.5`) is preserved all the
way to NPM — so NPM Access Lists keyed on that address are a valid,
usable control **for anything routed through NPM by domain name**.

### 3. Direct-IP access bypasses NPM (and Access Lists) entirely

Because of the blanket `FORWARD` accept described above, nothing stops a
client from bypassing NPM altogether and hitting a service directly by its
translated/LAN IP and port (e.g. `10.200.0.32:32400` for Plex). NPM Access
Lists never see this traffic, since it never passes through NPM.

## Goal

Allow designating a client (by its WireGuard tunnel IP) as **restricted**,
with real server-side enforcement of exactly which destination(s) it may
reach — enforced even if the client's own config or behavior tries to route
more broadly.

## Proposed Design

### Configuration

Add an env var, e.g. `WG_RESTRICTED_CLIENTS`, holding a list of
`<client-ip>:<allowed-dest-cidr-or-ip>[,<allowed-dest-cidr-or-ip>...]`
entries, semicolon-separated. Example:

```
WG_RESTRICTED_CLIENTS=10.8.0.5:192.168.100.5/32;10.8.0.9:10.200.0.60/32,192.168.100.5/32
```

This says: the client at `10.8.0.5` may only reach NPM's real IP
(`192.168.100.5`); the client at `10.8.0.9` may reach Pi-hole's translated
address and NPM.

### Enforcement (PostUp/PostDown hooks)

For each entry, insert specific `FORWARD` rules **above** the existing
blanket accept, so they're evaluated first for that client's traffic:

```sh
# For each restricted client (source = their tunnel IP):
iptables -I FORWARD -s "$CLIENT_IP/32" -d "$ALLOWED_DEST" -j ACCEPT
# ... one ACCEPT per allowed destination ...
iptables -I FORWARD -s "$CLIENT_IP/32" -j DROP   # catch-all for this client, inserted last (so it ends up below the ACCEPTs for this source but still above the generic wg0 ACCEPT)
```

Insertion order matters: `iptables -I` inserts at the *top* of the chain, so
rules must be inserted in reverse (the catch-all `DROP` first, then each
`ACCEPT` above it) so the final chain order for that client is
`ACCEPT, ACCEPT, ..., DROP`, still above the generic
`FORWARD -i wg0 -j ACCEPT` rule that applies to all other (non-restricted)
clients.

`PostDown` must remove the same rules symmetrically (`-D` instead of `-I`),
matching the existing pattern used for the other PostUp/PostDown pairs in
[`bootstrap-hooks.sh`](../hooks/bootstrap-hooks.sh).

### Client IP stability

This design depends on a restricted client having a **stable** WireGuard
tunnel IP. wg-easy assigns addresses sequentially and persists them per
client, so once a client is created its tunnel IP does not change unless the
client is deleted and recreated — acceptable for this use case, but worth
calling out explicitly in the docs/UI so a client isn't accidentally
recreated (which would silently drop its restriction until
`WG_RESTRICTED_CLIENTS` is updated with the new IP).

### Bootstrap integration

Extend [`bootstrap-hooks.sh`](../hooks/bootstrap-hooks.sh) to:

1. Parse `WG_RESTRICTED_CLIENTS`.
2. Append the per-client `ACCEPT`/`DROP` rules to the existing generated
   `POST_UP`/`POST_DOWN` hook strings (same mechanism already used for the
   NETMAP/DNS/NPM DNAT rules), so they're persisted through the same
   wg-easy `userconfig` API bootstrap flow already in place.
3. Re-running the script (idempotently) should not duplicate rules — follow
   the existing pattern of fully regenerating the hook strings from scratch
   each run rather than trying to diff/patch live iptables state.

### Out of scope for v1

- UI integration inside wg-easy itself (this would live entirely in the
  compose/env/bootstrap layer, not in wg-easy's own database/UI).
- Per-service (rather than per-destination-IP) restriction when multiple
  services share the same IP behind NPM — for that, combine this with NPM
  Access Lists per proxy host as documented in
  [wg-easy/README.md](../README.md#restricting-a-clients-access-current-limitations).
- Dynamic reconfiguration without re-running the bootstrap script (a config
  change requires re-running `bootstrap-hooks.sh`, same as other hook
  changes today).

## Validation Plan (once implemented)

1. Create a client, note its assigned tunnel IP from the wg-easy UI.
2. Add it to `WG_RESTRICTED_CLIENTS` with a single allowed destination.
3. Re-run `bootstrap-hooks.sh`; confirm via
   `docker exec wg-easy iptables -S FORWARD` that the client's ACCEPT/DROP
   rules appear above the generic `wg0` ACCEPT rules.
4. From that client, confirm the allowed destination is reachable and a
   different LAN/translated IP is not (connection times out/is refused).
5. Confirm other (non-restricted) clients are unaffected.
6. Restart the `wg-easy` container/stack and re-verify the rules are still
   present (persistence through PostUp).

## Related

- [wg-easy/README.md — Restricting a client's access (current limitations)](../README.md#restricting-a-clients-access-current-limitations)
- [RFC-001 — WireGuard Remote Access](./RFC-001-wireguard-remote-access.md)
- [RFC-004 — Service Reachability over WireGuard](./RFC-004-wireguard-service-reachability.md)
