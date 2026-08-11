# RFC-003 — WireGuard DNS via Pi-hole

## Status

Accepted

## Problem

WireGuard clients should use Pi-hole DNS when connected, including clients coming from overlapping private networks.

## Decision

Set WireGuard default DNS to a configurable value (`WG_VPN_DNS`) and apply it through wg-easy API bootstrap after startup.

For overlapping-network clients, `WG_VPN_DNS` should be the translated address of the Pi-hole endpoint (example: `10.200.0.60` for host `192.168.1.60`).

## Why API bootstrap

wg-easy v15 persists hook/user config in `/etc/wireguard/wg-easy.db`. Relying only on static compose env variables does not reliably update an existing setup. The bootstrap service provides reproducible fresh starts and drift correction.

## Implementation

- `wg-easy/compose.yaml`
  - `INIT_DNS: ${WG_VPN_DNS:-10.200.0.1,1.1.1.1}` (first-time setup)
  - one-shot `wg-easy-hooks-bootstrap` service
- `wg-easy/bootstrap-hooks.sh`
  - updates `POST_UP/POST_DOWN` hooks
  - updates `defaultDns` in wg-easy userconfig via API
- `wg-easy/.env.example`
  - `WG_VPN_DNS` and `WG_VPN_ALLOWED_IPS`

## Validation

1. `docker logs wg-easy-hooks-bootstrap` shows success.
2. New/recreated client config contains `DNS = <WG_VPN_DNS>`.
3. Connected client resolves domains through Pi-hole.

## Update (superseded default)

The original default of `WG_VPN_DNS=10.200.0.60` (Pi-hole's translated
address) pointed VPN clients directly at Pi-hole, which turned out to
**bypass** the per-domain DNS interception added later (see
[DNS_INTERCEPTION.md](/Users/davsantos/github/misc/home-lab/wg-easy/DNS_INTERCEPTION.md)):
queries only get rewritten (e.g. `nginx.pimlicoa.duckdns.org` →
`10.200.0.5`) if they first hit the VPN gateway (`10.200.0.1`), which
DNAT-redirects them to the `dnsmasq` sidecar before forwarding upstream to
Pi-hole. The default was corrected to `WG_VPN_DNS=10.200.0.1` so new
clients get interception-aware DNS out of the box, with Pi-hole still
reached transparently as dnsmasq's upstream resolver for everything else.

## Update (client-side DNS fallback)

`WG_VPN_DNS` now accepts a comma-separated list (mirroring
`WG_VPN_ALLOWED_IPS`'s existing pattern), pushed into wg-easy's
`defaultDns` as a JSON array instead of a single-value string. The default
is now `WG_VPN_DNS=10.200.0.1,1.1.1.1` — the gateway stays first (required
for interception), with a public resolver as a second entry so the client
still has working DNS if the gateway/dnsmasq/Pi-hole path is ever
unreachable.

Caveat: some OSes/clients may race multiple configured DNS servers rather
than strictly using the first one until it fails, so domain rewrites could
occasionally be skipped by a response from the fallback server even while
the gateway is up but briefly slow. This is an accepted trade-off for
resilience; omit the second entry (set `WG_VPN_DNS=10.200.0.1` only) if
strict interception guarantees matter more than fallback connectivity.

## Update (superseded default, again — RFC-006)

The default changed once more, from `WG_VPN_DNS=10.200.0.1,1.1.1.1` (the
gateway first) to `WG_VPN_DNS=10.200.0.60,1.1.1.1` (Pi-hole's translated
address first). This reverses the "superseded default" decision above, but
doesn't reintroduce the bug it fixed: that decision existed because the old
DNS DNAT rule matched purely on `-i wg0 --dport 53`, with no way to tell
`pimlicoa.duckdns.org` queries apart from anything else — pointing DNS
straight at Pi-hole skipped the rule entirely.

RFC-006 changes the DNS DNAT rule to match on the query's **content**
(an L7 string match on the domain's DNS wire-format bytes) instead of relying
on the client hitting a specific address. This means it still catches
`pimlicoa.duckdns.org` queries wherever they're sent, including straight to
Pi-hole's translated address — so pointing DNS there directly is safe again,
and has the added benefit of letting every *other* query bypass dnsmasq
entirely (preserving the client's real tunnel IP in Pi-hole's Query Log; see
RFC-006 for the full rationale).

## Related

- [RFC-006 — VPN Client DNS Identity Preservation](./RFC-006-vpn-client-dns-identity.md)

