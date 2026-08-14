# Nginx Proxy Manager

Reverse proxy service for local domains and TLS management on the LAN.

## Dependencies

- Docker + Docker Compose v2
- Shared external `homelab` network (created by root [`compose.yaml`](/Users/davsantos/github/misc/home-lab/compose.yaml))

## Environment variables

Copy [`.env.example`](/Users/davsantos/github/misc/home-lab/nginx-proxy-manager/.env.example) to `.env` and set:

- `TZ`
- `PIHOLE_LAN_IP` (defaults to `192.168.1.60`) — Pi-hole's LAN IP, set as this
  container's primary DNS resolver so NPM proxy hosts can target Pi-hole
  "Local DNS Records" (e.g. `little-pi4.lan`) directly in the Forward
  Hostname/IP field, instead of Docker container names or raw IPs
- `DNS_FALLBACK` (defaults to `1.1.1.1`) — used only if Pi-hole is
  unreachable, so external DNS lookups (e.g. Let's Encrypt renewal) keep
  working during a Pi-hole outage
- `IMAGE_URL` if you want a pinned version

## Using local (Pi-hole) DNS names in proxy hosts

By default, a proxy host's "Forward Hostname/IP" can target a Docker
container/service name resolved via Docker's embedded DNS, since NPM shares
the `homelab` bridge network with the other application containers. With
`PIHOLE_LAN_IP` set (see above), you can instead use any name registered in
Pi-hole's **Local DNS Records** — useful if you want proxy host targets to
stay stable/readable even if the underlying container names change, or to
point at non-containerized LAN devices.

**If Pi-hole goes offline**: Docker container name resolution is unaffected,
since that's resolved locally by Docker's embedded DNS and never reaches
Pi-hole or the fallback server. `DNS_FALLBACK` only protects *external* DNS
lookups (e.g. Let's Encrypt) — proxy hosts using Pi-hole local DNS records
will still fail to resolve until Pi-hole comes back, since Pi-hole is their
only source of truth.

## Startup

```bash
cd nginx-proxy-manager
cp .env.example .env
docker compose up -d
```

## Useful links

- https://nginxproxymanager.com/guide/
