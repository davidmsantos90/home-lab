# RFC-004 — Service Reachability over WireGuard

## Status

Accepted

## Question

Which homelab services are reachable while connected through WireGuard?

## Answer

Based on repository compose files, services are reachable over WireGuard when they expose host ports or are reachable over LAN/bridge addresses, and client AllowedIPs include the route.

## Reachability Matrix

- Reachable via host/LAN endpoint:
  - Pi-hole DNS (`53/tcp+udp`) and admin (`8080`)
  - Immich (`2283`)
  - Portainer (`9000`)
  - Deluge (`8112`, `6881/tcp+udp`)
  - Plex (`32400`)
  - Jellyfin (`8096`)
- Reachable via NPM LAN and bridge IP:
  - Nginx Proxy Manager (`192.168.1.5` on macvlan LAN, `192.168.100.5` on `homelab`)
- Not intended over WireGuard:
  - wg-easy UI (`127.0.0.1:51821` host bind)

For overlapping remote LANs, reach LAN-backed services via translated addresses (`WG_TRANSLATED_LAN_SUBNET`).

## Operational Notes

1. This RFC describes network reachability, not app-level auth.
2. Existing clients may need profile regeneration to pick up updated DNS/AllowedIPs defaults.
3. Keep bootstrap logs as source of truth for applied defaults and hooks.
