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

## Useful links

- https://immich.app/docs/install/docker-compose
- https://github.com/immich-app/immich
