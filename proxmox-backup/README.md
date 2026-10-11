# Proxmox Backup Server

Containerized Proxmox Backup Server (PBS) intended to run on the Raspberry Pi as the local backup target for Proxmox VE guests.

## Purpose

This service is not a replacement for the Proxmox VE host itself. It is a dedicated backup endpoint that keeps the PBS configuration and datastore on the Pi's local SSD instead of inside the Proxmox host.

This project is intended to follow the repository's existing service conventions:

- one directory per service
- Compose file and environment template in that folder
- persistent host paths for service state
- no secrets committed to the repository

## Dependencies

- Docker + Docker Compose v2
- Shared external `homelab` network
- A dedicated host directory for PBS config and backup datastore
- Existing Pi services must remain available while PBS is installed and running

## Environment variables

Copy [`.env.example`](.env.example) to `.env` and set:

- `TZ`
- `SERVICEPORT` (default `8007`)
- `IMAGE_URL` (pin to a stable upstream tag for production use)
- `HOME_LAB_DIR` (base path for persistent config and datastore)

The default `HOME_LAB_DIR=.` keeps the data in this folder, but for a Pi deployment it is preferable to point it at a durable SSD-backed path such as:

```bash
HOME_LAB_DIR=/home/pi/.home-lab/proxmox-backup
```

## Data layout

The Compose file mounts the following persistent paths:

- `${HOME_LAB_DIR}/config` for PBS configuration
- `${HOME_LAB_DIR}/datastore` for PBS backups

These must remain on the host filesystem and survive container recreation.

## Startup

```bash
cd proxmox-backup
cp .env.example .env
# edit .env with your TZ / HOME_LAB_DIR / image tag
docker compose up -d
```

## Security and operations notes

- Keep the web UI behind the intended management network only.
- Do not expose PBS publicly unless you have a deliberate reason and additional protection.
- Do not sync the PBS datastore directly to OneDrive; keep that as a separate project.
- Keep the datastore on the Pi SSD and do not treat it as a normal file share.
- Prefer a stable tag rather than `latest` in real deployments.

## Intended role in the backup architecture

This service fits the home-lab model below:

1. Proxmox VE schedules guest backups.
2. PBS receives those backups on the Pi.
3. The Pi keeps copies on local SSD storage.
4. Optional OneDrive sync can be added later as a separate encrypted archive workflow.

## Useful links

- https://github.com/dockur/proxmox-backup
- https://hub.docker.com/r/dockurr/proxmox-backup
