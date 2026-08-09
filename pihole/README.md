# Pi-hole

Network-wide DNS sinkhole and ad blocker, exposed on your local network.

## Dependencies

- Docker + Docker Compose v2
- Shared external `homelab` network
- Port 53 available on host

## Environment variables

Copy [`.env.example`](/Users/davsantos/github/misc/home-lab/pihole/.env.example) to `.env` and set:

- `TZ`
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
