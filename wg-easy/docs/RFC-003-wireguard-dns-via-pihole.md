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
  - `INIT_DNS: ${WG_VPN_DNS:-10.200.0.60}` (first-time setup)
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

