# Authentik

Open-source identity provider and single sign-on platform for self-hosted services.

## Dependencies

- Docker + Docker Compose v2
- Shared external `homelab` network
- A reverse proxy such as Nginx Proxy Manager or a trusted upstream TLS terminator

## Environment variables

Copy [`.env.example`](.env.example) to `.env` and set at least:

- `TZ`
- `AUTHENTIK_SECRET_KEY`
- `AUTHENTIK_POSTGRES_PASSWORD`
- `AUTHENTIK_HOST`
- `AUTHENTIK_PORT`

The default `AUTHENTIK_HOST` points to a DuckDNS-style hostname, which is the usual pattern in this repository.

## Startup

```bash
cd authentik
cp .env.example .env
chmod 600 .env
docker compose up -d
```

## Access

The UI is exposed on the internal Docker network at:

- `http://app-authentik-server:9000`
- `https://<your-host>:9443` (direct HTTPS; usually better behind NPM)

For the home-lab reverse proxy, use `app-authentik-server` as the upstream host on port `9000`.

## Useful links

- https://goauthentik.io/docs/install-config
- https://github.com/goauthentik/authentik
