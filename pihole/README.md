# Pi-hole

Network-wide DNS sinkhole and ad blocker, exposed locally and on Tailnet.

## Dependencies

- Docker + Docker Compose v2
- Shared external `homelab` network
- Tailscale auth key
- Port 53 available on host

## Environment variables

Copy [`.env.example`](/Users/davsantos/github/misc/home-lab/pihole/.env.example) to `.env` and set:

- `TS_AUTHKEY`, `TZ`
- `SERVICEPORT` / `ADMIN_PORT` if you need different local admin port mapping
- `IMAGE_URL` for pinning

## Startup

```bash
cd pihole
cp .env.example .env
docker compose up -d
```

## Useful links

- https://docs.pi-hole.net/
- https://tailscale.com/kb/1282/docker
