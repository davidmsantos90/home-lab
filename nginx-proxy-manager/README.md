# Nginx Proxy Manager

Reverse proxy service for local domains and TLS management on the LAN.

## Dependencies

- Docker + Docker Compose v2
- Shared external `homelab` and `macvlan` networks (created by root [`compose.yaml`](/Users/davsantos/github/misc/home-lab/compose.yaml))
- Tailscale auth key

## Environment variables

Copy [`.env.example`](/Users/davsantos/github/misc/home-lab/nginx-proxy-manager/.env.example) to `.env` and set:

- `TS_AUTHKEY`, `TZ`
- `NPM_IP` (must be in the configured macvlan range and reserved in DHCP)
- `PIHOLE_LAN_IP` (defaults to `192.168.1.60`) — Pi-hole's LAN IP, set as this
  container's DNS resolver so NPM proxy hosts can target Pi-hole "Local DNS
  Records" (e.g. `little-pi4.lan`) directly in the Forward Hostname/IP field,
  instead of Docker container names or raw IPs
- `IMAGE_URL` if you want a pinned version

## Using local (Pi-hole) DNS names in proxy hosts

By default, a proxy host's "Forward Hostname/IP" can target a Docker
container/service name (e.g. `tailscale-immich`) resolved via Docker's
embedded DNS, since NPM shares the `homelab` bridge network with every other
service's Tailscale sidecar. With `PIHOLE_LAN_IP` set (see above), you can
instead use any name registered in Pi-hole's **Local DNS Records** — useful
if you want proxy host targets to stay stable/readable even if the
underlying container names change, or to point at non-containerized LAN
devices.

**Caveat**: the Tailscale sidecar may manage its own `/etc/resolv.conf` if
DNS settings are pushed from your Tailnet admin console (MagicDNS), which
could override the `dns:` setting after startup. If local DNS names stop
resolving, check `docker exec tailscale-${SERVICE} cat /etc/resolv.conf`
inside the container to confirm Pi-hole's IP is still listed; disabling
DNS management for this Tailnet (or this device) if needed.

## Startup

```bash
cd nginx-proxy-manager
cp .env.example .env
docker compose up -d
```

## Useful links

- https://nginxproxymanager.com/guide/
- https://docs.docker.com/engine/network/drivers/macvlan/
