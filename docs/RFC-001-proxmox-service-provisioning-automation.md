# RFC-001 — Proxmox Service Provisioning Automation

## Status

Proposed (not implemented)

## Problem

The repository now documents two deployment patterns for several services:

- Docker-based services running on the Raspberry Pi
- Proxmox-hosted LXCs for heavier workloads such as Jellyfin, Immich, and Deluge

Those Proxmox deployments are currently documented as manual procedures. They
are repeatable in principle, but not yet encoded as a safe, reusable workflow.
That creates a few problems:

1. Rebuilds and migrations are slower than they need to be.
2. Small operational details are easy to forget between recreations.
3. Validation is manual and inconsistent across services.
4. There is no agreed boundary between what should be automated and what should
   remain intentionally manual.

## Goal

Define a conservative automation model for Proxmox-hosted service provisioning
that is:

- shell-based
- idempotent
- split into host and guest phases
- explicit about validation
- safe around secrets, existing state, and interactive app setup

## Non-goals

- Automatically modifying Pi-hole DNS records.
- Automatically creating or mutating Nginx Proxy Manager configuration.
- Storing application secrets, passwords, or tokens in Git.
- Recreating or destroying working LXCs by default.
- Fully automating first-run application setup wizards.
- Automatically migrating YaRSS2 subscriptions until a reliable import path
  exists.

## Proposed design

### 1) Two-phase provisioning model

Provisioning should be split into two distinct phases.

#### Phase 1 — Proxmox host

This phase runs on the Proxmox host and is responsible for infrastructure:

- create or reuse the target LXC
- configure CPU, memory, root disk, and network bridge
- apply static IPv4, gateway, and DNS configuration
- enable required container features such as nesting when applicable
- attach bind mounts for media/download storage
- attach GPU devices for Jellyfin when required
- start the LXC

#### Phase 2 — inside the LXC

This phase runs inside the guest and is responsible for application/runtime
convergence:

- install packages and repositories
- clone or update this repository when applicable
- render `.env` files or service config from templates
- start or enable services
- run validation commands

### 2) Shell-first implementation

The initial implementation should prefer small POSIX shell scripts over heavier
tooling. The repository should eventually expose commands such as:

- `./scripts/provision-jellyfin.sh`
- `./scripts/provision-immich.sh`
- `./scripts/provision-deluge.sh`

Each script should be rerunnable and should converge existing state rather than
assuming a clean machine.

### 3) Centralized configuration inputs

Provisioning should use explicit per-service configuration files or env-style
inputs for values such as:

- CT ID
- hostname
- static IP/CIDR
- gateway
- DNS server
- bridge name
- CPU/RAM/disk sizing
- host bind-mount source paths
- guest mount target paths
- version pins where needed

These values should be separated from the provisioning logic so the scripts can
be reused without editing code.

### 4) Conservative convergence rules

Provisioning must prefer safe convergence over destructive recreation:

- if the LXC already exists, inspect and update it instead of deleting it
- if a service config already exists, back it up before replacing it
- if manual setup is still required, stop and print the next expected steps
- if validation fails, exit non-zero and show which stage failed

### 5) Explicit validation gates

Provisioning should not stop at "the process ran". It should validate the
service's expected runtime shape before declaring success.

Examples:

- service active under systemd or `docker compose ps`
- expected listening ports bound
- expected mount points present
- GPU device visibility for Jellyfin
- basic HTTP health checks where applicable
- for Deluge, at least one real download-path validation before treating the
  stack as fully proven

## Service-specific expectations

### Jellyfin

Target model:

- dedicated Debian 13 LXC
- native Jellyfin packages inside the guest
- Intel iGPU passthrough when available
- LAN access published through Pi-hosted NPM

Automation should:

- configure or verify GPU device passthrough
- detect the render group dynamically instead of hard-coding a GID
- install Jellyfin packages and enable the service
- validate `/dev/dri` visibility and HTTP reachability on port `8096`

Automation should not:

- auto-install optional themes/plugins
- run expensive media-analysis or transcoding workloads during normal
  provisioning

### Immich

Target model:

- dedicated Debian 13 LXC
- Docker Engine + Compose plugin inside the guest
- local Postgres data on guest storage
- uploads on appropriately sized storage

Automation should:

- enable LXC nesting where required
- install Docker and Compose
- create the guest-local `homelab` Docker network
- render `.env`
- run `docker compose up -d`
- validate the application and database containers

Automation should not:

- put Postgres data on a network share
- assume Docker container names are reachable from Pi-hosted NPM across hosts

### Deluge

Target model:

- dedicated Debian 13 LXC
- native `deluged` + `deluge-web` under systemd
- external downloads storage bind-mounted as `/downloads`
- optional YaRSS2 plugin installed from a Python-version-compatible egg

Automation should:

- provision or validate the `/downloads` bind mount
- install Deluge packages and converge the service configuration
- validate RPC on `58846` and WebUI on `8112`
- install the YaRSS2 egg when explicitly provided or built via
  [`build-yarss2.sh`](/Users/davsantos/github/misc/home-lab/deluge/build-yarss2.sh)

Automation should not:

- overwrite a working Deluge config without backup
- assume host paths and guest paths are identical
- automatically migrate YaRSS2 feeds/subscriptions until import reliability is
  understood

## Networking and proxying

Pi-hosted [Nginx Proxy Manager](/Users/davsantos/github/misc/home-lab/nginx-proxy-manager)
must treat Proxmox-hosted services as LAN endpoints, not as same-host Docker
services.

That means automation and docs should assume:

- NPM upstreams point to LXC LAN IPs or Pi-hole local DNS records
- the Docker `homelab` network is host-local and does not span the Pi and
  Proxmox host

## Repository layout

The likely future layout is:

```text
scripts/
  provision-jellyfin.sh
  provision-immich.sh
  provision-deluge.sh
config/
  jellyfin.proxmox.env.example
  immich.proxmox.env.example
  deluge.proxmox.env.example
```

The exact filenames can change, but the intent is to separate:

- reusable provisioning logic
- environment-specific values

## Migration plan

### Phase 1 — codify the contract

- document the automation model
- agree on script boundaries and non-goals
- identify the config inputs per service

### Phase 2 — Jellyfin first

Implement Jellyfin provisioning first because it has the clearest benefit and
the most specific hardware requirements.

### Phase 3 — Immich and Deluge

- add Immich guest-side Docker provisioning
- add Deluge native guest provisioning
- keep the scripts independent so each service can be managed separately

### Phase 4 — shared helpers

Extract shared shell helpers only after at least two service scripts prove the
same pattern is truly reusable.

## Security considerations

- Never store secrets in committed config files.
- Prefer explicit operator-supplied environment files for credentials.
- Fail closed when required config values are missing.
- Avoid destructive default behavior against existing LXCs and data mounts.
- Back up or require confirmation before replacing known-good state.

## Operational impact

- lower rebuild friction for Proxmox-hosted services
- more consistent validation after migrations or host changes
- less hidden tribal knowledge around GPU passthrough, bind mounts, and guest
  service setup
- moderate maintenance cost to keep shell automation aligned with real systems

## Related

- [README.md](/Users/davsantos/github/misc/home-lab/README.md)
- [deluge/README.md](/Users/davsantos/github/misc/home-lab/deluge/README.md)
- [immich/README.md](/Users/davsantos/github/misc/home-lab/immich/README.md)
- [jellyfin/README.md](/Users/davsantos/github/misc/home-lab/jellyfin/README.md)
