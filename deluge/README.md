# Deluge

BitTorrent client stack with web UI and torrent ports exposed locally.

## Dependencies

- Docker + Docker Compose v2
- Shared external `homelab` network
- Tailscale auth key

## Environment variables

Copy [`.env.example`](/Users/davsantos/github/misc/home-lab/deluge/.env.example) to `.env` and set:

- `TS_AUTHKEY`, `TZ`
- `HOME_LAB_DIR` (base dir for config/state/downloads)
- `DOWNLOADS_PATH` (optional override for downloads location)
- `SERVICEPORT` (default `8112`)
- `DAEMON_PORT` (default `58846`)

## Startup

```bash
cd deluge
cp .env.example .env
docker compose up -d
```

## Connecting a native client

The web UI (`SERVICEPORT`) is only one way to use Deluge — the daemon
(`deluged`, running inside the container) also accepts direct RPC
connections from native thin-client apps (Deluge GTK/console UI, mobile
apps, etc.), same as a locally-run instance would.

In the native app, choose "Connect to daemon" / add a host:
- Host: this machine's LAN IP or Tailscale hostname
- Port: `DAEMON_PORT` (default `58846` — **not** the web UI port)

Note: the daemon's login is separate from the web UI password. The web UI
password only protects the web UI itself; the daemon uses its own
username/password pairs stored in `/config/auth` inside the container. If
you've never used a native client with this instance before, you'll need
to check or set daemon credentials, e.g.:

```bash
docker exec -it app-deluge cat /config/auth
```

This lists `username:password:level` entries (a default `localclient` user
is created automatically). Use one of those, or add your own via that file
and restart the container.

## Useful links

- https://dev.deluge-torrent.org/wiki/UserGuide
- https://github.com/linuxserver/docker-deluge
