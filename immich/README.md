# Immich

Self-hosted photo and video backup/management service with PostgreSQL and Redis.

## Dependencies

- Docker + Docker Compose v2
- Shared external `homelab` network (created by root [`compose.yaml`](/Users/davsantos/github/misc/home-lab/compose.yaml))

## Environment variables

Copy [`.env.example`](/Users/davsantos/github/misc/home-lab/immich/.env.example) to `.env` and set:

- `TZ`
- `DB_PASSWORD`
- Storage paths (`UPLOAD_LOCATION`, `DB_DATA_LOCATION`) as needed

## Startup

```bash
cd immich
cp .env.example .env
docker compose up -d
```

## Alternative deployment: Proxmox LXC

If Immich outgrows the Raspberry Pi, a good alternative is an unprivileged
Debian 13 LXC on Proxmox that runs Docker Compose inside the guest.

Known-good shape:

| Setting | Example |
|---|---|
| LXC ID | `102` |
| IPv4 | `192.168.1.72/24` |
| Gateway | `192.168.1.1` |
| DNS | `192.168.1.60` (Pi-hole) |
| Runtime | Docker Engine + Compose plugin inside the LXC |
| Immich version pin | `IMMICH_VERSION=v3` or another explicit release tag |

Notes for this layout:

- create the external Docker network inside the LXC as its own local network:
  `docker network create homelab`
- keep the Postgres data directory on the LXC disk; do not place the database
  on a network share
- place `UPLOAD_LOCATION` on storage sized for your photo/video library rather
  than on the small root filesystem
- Pi-hosted NPM must proxy to `immich.home.arpa:2283` or `192.168.1.72:2283`;
  it cannot reach this LXC via a Docker container name from another host

From inside the LXC, the service lifecycle stays the same as any other Docker
host:

```bash
git clone <repo-url> ~/home-lab
cd ~/home-lab/immich
cp .env.example .env
docker network create homelab || true
docker compose up -d
```

## Proxmox automation direction

For repeatable Proxmox installs, prefer a two-phase, idempotent flow:

1. On the Proxmox host, create or reuse the LXC with nesting enabled, static
   networking and any bind mounts needed for media storage.
2. Inside the LXC, install Docker/Compose, clone or update this repository,
   write `.env`, create the local `homelab` network, and start Immich.
3. Stop before any step that would require interactive secrets or automatic
   NPM/Pi-hole mutations.

Minimum validation after provisioning:

```bash
docker compose ps
docker compose logs --tail=100 application
docker compose logs --tail=100 database
curl -I http://127.0.0.1:2283
```

## Useful links

- https://immich.app/docs/install/docker-compose
- https://github.com/immich-app/immich
