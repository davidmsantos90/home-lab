# Home Lab

Self-hosted services running in Docker, each accessible via [Tailscale](https://tailscale.com/) on your Tailnet **and** locally on your LAN without Tailscale.

Follows the [ScaleTail](https://github.com/tailscale-dev/ScaleTail) sidecar pattern: every service gets a dedicated Tailscale container that handles Tailnet connectivity, and a shared `homelab` Docker network lets Nginx Proxy Manager route local traffic to all services.

## Project structure

```
home-lab/
├── compose.yaml               # Creates shared homelab network
├── nginx-proxy-manager/
│   ├── compose.yaml
│   └── .env
├── pihole/
│   ├── compose.yaml
│   └── .env
├── immich/
│   ├── compose.yaml
│   └── .env
├── portainer/
│   ├── compose.yaml
│   └── .env
├── deluge/
│   ├── compose.yaml
│   └── .env
├── plex/
│   ├── compose.yaml
│   └── .env
├── jellyfin/
│   ├── compose.yaml
│   ├── .env
│   └── README.md
```

## Services

| Service | Local port(s) | Tailnet URL |
|---|---|---|
| **Pi-hole** | `53` (DNS), `8080` (admin) | `https://pihole.<tailnet>.ts.net` |
| **Immich** | `2283` | `https://immich.<tailnet>.ts.net` |
| **Portainer** | `9000` | `https://portainer.<tailnet>.ts.net` |
| **Deluge** | `8112` (UI), `6881` (torrent) | `https://deluge.<tailnet>.ts.net` |
| **Plex** | `32400` | `https://plex.<tailnet>.ts.net` |
| **Jellyfin** | `8096` | `https://jellyfin.<tailnet>.ts.net` |
| **Nginx Proxy Manager** | `80`/`443`/`81` (host-published) | Tailscale IP + port `81` (run `tailscale ip -4` on host) |
| **wg-easy** | `51820/udp` (WireGuard) | `pimlicoa.duckdns.org:51820` |

## Prerequisites

- Docker + Docker Compose v2
- A [Tailscale](https://tailscale.com/) account

## Relocating a service's data (`HOME_LAB_DIR`)

Every service exposes a `HOME_LAB_DIR` environment variable (in its `.env.example`)
that sets the base directory for that service's persistent config/state
volumes (Tailscale state, app config, database data, etc). It defaults to
`.` — the service's own directory — so nothing changes unless you set it.

Set it in a service's `.env` to move its data elsewhere, e.g. an external
drive mounted at `/mnt/storage`:

```bash
# nginx-proxy-manager/.env
HOME_LAB_DIR=/mnt/storage/nginx-proxy-manager
```

Large media/library paths (`PLEX_MEDIA_PATH`, `JELLYFIN_MEDIA_PATH`,
`DOWNLOADS_PATH`, `UPLOAD_LOCATION`) are intentionally **not** covered by
`HOME_LAB_DIR` — they have their own dedicated variables since they're
often stored on separate, larger volumes than a service's config/state.

After changing `HOME_LAB_DIR` for a service that's already running, stop it,
move the existing data to the new location, then start it again:

```bash
cd <service>
docker compose down
mv ./ts /mnt/storage/<service>/ts   # and any other existing data dirs
# update HOME_LAB_DIR in .env
docker compose up -d
```

## Quick Start

### 1. Create the shared Docker networks

Run the root compose file once to create the `homelab` bridge network:

```bash
docker compose up
```

The `init` container prints a confirmation and exits. The network persists and is used by all services.

### 2. Get a Tailscale Auth Key

Go to [Tailscale Admin → Keys](https://login.tailscale.com/admin/settings/keys) and generate a **reusable** auth key. You'll add it to each service's `.env`.

### 3. Configure and start each service

Start **nginx-proxy-manager** first, then the rest in any order:

```bash
cd nginx-proxy-manager
# Edit .env — set TZ
docker compose up -d

# Then for each other service:
cd ../pihole   # (or immich, portainer, deluge, plex)
# Edit .env — at minimum set TS_AUTHKEY and TZ
docker compose up -d
```

### 4. Pi-hole: free up port 53 (Ubuntu/Debian only)

On systems using `systemd-resolved`, port 53 is occupied by default. Free it before starting Pi-hole:

```bash
# Disable the stub listener
sudo sed -i 's/#DNSStubListener=yes/DNSStubListener=no/' /etc/systemd/resolved.conf
sudo systemctl restart systemd-resolved

# Verify port 53 is free
sudo ss -tulnp | grep :53
```

### 5. WireGuard access with wg-easy

[`wg-easy/compose.yaml`](wg-easy/compose.yaml) provides WireGuard access for devices that cannot use Tailscale. Its DuckDNS companion updates `pimlicoa.duckdns.org` with the home connection's public IPv4 address, and wg-easy creates client profiles using that hostname.

1. In DuckDNS, confirm that the `pimlicoa` subdomain exists and copy its token.
2. Create the local environment file and set a long, unique admin password:

   ```bash
   cd wg-easy
   cp .env.example .env
   chmod 600 .env
   ```

   `WG_EASY_HOST` defaults to `pimlicoa.duckdns.org`, but you can change it in `.env` if you point DuckDNS somewhere else.

3. Forward **UDP 51820** on the router to this Docker host's LAN IP. Do not forward TCP 51821.
4. Start the stack:

   ```bash
   docker compose up -d
   ```

5. Open the admin UI at `http://127.0.0.1:51821` on the Docker host (or `http://10.200.0.9:51821` once connected via the VPN — see below), sign in with the credentials in `.env`, and create a client profile.

`wg-easy` attaches directly to `homelab` with its own pinned IP; the only public service is the authenticated WireGuard UDP endpoint. The web UI is not exposed publicly — it's reachable locally at `http://127.0.0.1:51821` on the host, and to already-connected VPN clients at `http://10.200.0.9:51821`. Keep `wg-easy/data/` backed up: it contains the server and client keys. After the first successful start, remove the `INIT_*` entries from [`wg-easy/compose.yaml`](wg-easy/compose.yaml) and restart the stack so the bootstrap password is no longer present in the running container configuration.

If you previously ran an older `wg-easy` compose with a different internal network label and get a Docker network label mismatch error, remove the stale network once and start again:

```bash
docker network rm wg_easy_internal || true
docker compose up -d
```

## How access works

Most services use the **Tailscale sidecar pattern**: the app container has no network stack of its own — it uses `network_mode: service:tailscale` to share the Tailscale container's network namespace. This means any port the app binds to (e.g. immich on `:2283`) is actually bound inside the Tailscale container.

```
┌──────────────────────────────────────────────────────┐
│  tailscale-immich container                          │
│  ├── tailscaled  ──────────────────→ Tailnet (HTTPS) │
│  └── [shared network namespace]  ──→ host ports      │
│                                                      │
│  app-immich-server (no own network stack)            │
│  └── listens on :2283  ──→ exits via tailscale-immich│
└──────────────────────────────────────────────────────┘
```

### Tailnet access

`TS_SERVE_CONFIG` instructs the Tailscale daemon to:
1. Accept HTTPS on port 443 on the Tailnet IP (automatic TLS cert, no firewall rules needed)
2. Reverse-proxy to `http://127.0.0.1:<port>` — localhost within the shared namespace

Result: any device on your Tailnet can reach `https://immich.<tailnet>.ts.net` directly.

### Local access

Because the Tailscale container has `ports:` bound to `0.0.0.0` on the host, you can access services **directly by IP+port** without Tailscale and without NPM:

| Service | Direct local URL |
|---|---|
| Pi-hole admin | `http://<host-ip>:8080/admin` |
| Immich | `http://<host-ip>:2283` |
| Portainer | `http://<host-ip>:9000` |
| Deluge | `http://<host-ip>:8112` |
| NPM admin | `http://192.168.1.60:81` |
| wg-easy admin | `http://127.0.0.1:51821` (host-local only) |

You can **also** route through NPM using your DuckDNS subdomains for a consistent URL across LAN and Tailnet (see NPM section below).

| Access method | Example | Needs Tailscale? | Needs NPM? |
|---|---|---|---|
| Direct IP + port | `http://192.168.1.10:2283` | ❌ | ❌ |
| Local domain via NPM | `https://immich.pimlicoa.duckdns.org` | ❌ | ✅ |
| Tailnet | `https://immich.<tailnet>.ts.net` | ✅ | ❌ |

> **Note**: `nginx-proxy-manager` and `wg-easy` are exceptions to the sidecar pattern above — neither runs a Tailscale sidecar. NPM attaches directly to `homelab` and publishes its ports directly on the host; wg-easy attaches directly to `homelab`. Reach NPM's admin UI over LAN (`http://192.168.1.60:81`) or through the wg-easy VPN (`http://10.200.0.60:81`); reach wg-easy's own admin UI locally (`http://127.0.0.1:51821`) or through its own VPN (`http://10.200.0.9:51821`).

## Nginx Proxy Manager

NPM publishes ports 80/443/81 directly on the host (`ports:` in its `compose.yaml`), so it's reachable at the Pi's own real LAN IP (`192.168.1.60`) without needing a dedicated network attachment. It is also on the `homelab` bridge to reach other services.

### NPM upstream targets

When adding proxy hosts in NPM, use the Tailscale container name as the upstream (reachable via the `homelab` Docker network):

| Service | Upstream host | Upstream port |
|---|---|---|
| Pi-hole admin | `tailscale-pihole` | `80` |
| Immich | `tailscale-immich` | `2283` |
| Portainer | `tailscale-portainer` | `9000` |
| Deluge | `tailscale-deluge` | `8112` |
| Plex | `tailscale-plex` | `32400` |
| Jellyfin | `tailscale-jellyfin` | `8096` |

For services running **on the host** (not yet in Docker), use the `homelab` bridge gateway instead — bridge containers can't reach the host's main LAN IP directly, but can always reach it via the bridge gateway:

| Service (on host) | NPM upstream host | NPM upstream port |
|---|---|---|
| Plex | `192.168.100.1` | `32400` |

The gateway is pinned to `192.168.100.1` by the subnet in `compose.yaml`. Once a service is migrated to Docker, switch its upstream to the container name.

### Consistent URLs across LAN and Tailnet

With Pi-hole as DNS for both LAN and Tailnet, you can use the same subdomain everywhere:

1. **Pi-hole** → Local DNS → DNS Records: add one A record pointing your domain to the Pi's real LAN IP:
   ```
   pimlicoa.duckdns.org → 192.168.1.60
   ```
2. Add CNAME records for each subdomain pointing to the root:
   ```
   immich.pimlicoa.duckdns.org    → pimlicoa.duckdns.org
   portainer.pimlicoa.duckdns.org → pimlicoa.duckdns.org
   pihole.pimlicoa.duckdns.org    → pimlicoa.duckdns.org
   deluge.pimlicoa.duckdns.org    → pimlicoa.duckdns.org
   npm.pimlicoa.duckdns.org       → pimlicoa.duckdns.org
   ```
3. **NPM**: add a proxy host for each subdomain, using the wildcard cert (`*.pimlicoa.duckdns.org`).

NPM default credentials (change on first login):
- **Email**: `admin@example.com`
- **Password**: `changeme`

## Network architecture

```
┌─────────────────────────────────────────────────┐
│  homelab bridge (192.168.100.0/24)              │
│  gateway: 192.168.100.1 (host)                  │
│                                                  │
│  nginx-proxy-manager (unpinned, dynamic IP)     │
│  wg-easy → 192.168.100.9                        │
│  tailscale-pihole, tailscale-immich,            │
│  tailscale-portainer, tailscale-deluge,         │
│  tailscale-plex (dynamic IPs, unpinned)         │
└─────────────────────────────────────────────────┘

nginx-proxy-manager also publishes ports 80/443/81 directly on the host,
reachable at the Pi's real LAN IP (192.168.1.60).
```

Each service's `compose.yaml` also defines a **private internal network** (e.g. `immich_internal`) for intra-service communication (immich ↔ postgres ↔ redis). Those containers are not reachable from outside.

### Accessing admin UIs over the wg-easy VPN

Connected VPN clients (`10.200.0.0/24`) reach NPM's admin UI via the generic
NETMAP subnet translation (same as any other real-LAN service, e.g.
`http://10.200.0.60:81` → `192.168.1.60:81`). wg-easy's own admin UI lives on
the `homelab` bridge — a different subnet entirely, unreachable via that
NETMAP rule — so it gets its own dedicated host-exception NAT rule applied
by `wg-easy/bootstrap-hooks.sh` (see the ordering note in that script — this
exception must come before the broad NETMAP subnet translation):

| Service           | Translated VPN IP | Real homelab-bridge IP | Port  |
|-------------------|--------------------|-------------------------|-------|
| wg-easy admin UI  | `10.200.0.9`       | `192.168.100.9`         | `51821` |

e.g. `http://10.200.0.9:51821` reaches wg-easy's own management UI while
connected to the VPN. This is only reachable by authenticated WireGuard
peers, never the public internet — no port is forwarded on the router for
`51821`, and `wg-easy`'s own `51821/tcp` port is bound to
`127.0.0.1:51821` on the host (see `wg-easy/compose.yaml`), not exposed
externally at all. Access relies entirely on being on the VPN and having
wg-easy's admin credentials (`WG_EASY_ADMIN_USERNAME`/`WG_EASY_ADMIN_PASSWORD`
in `wg-easy/.env`) — use a long, unique password.

## Migrating Deluge and Plex from host to Docker

Both services can be migrated without losing data by pointing Docker volumes at the existing host paths.

### Find your existing data

```bash
# Deluge config location
ls ~/.config/deluge/          # most common
ls /var/lib/deluged/          # if installed as a system service

# Deluge downloads
cat ~/.config/deluge/core.conf | grep download_location

# Plex metadata/config
ls "/var/lib/plexmediaserver/Library/Application Support/Plex Media Server/"
ls ~/.local/share/plex/        # alternative location
```

### Migrate Deluge

1. **Stop the host Deluge daemon**:
   ```bash
   sudo systemctl stop deluged deluge-web
   sudo systemctl disable deluged deluge-web
   ```

2. **Copy (not move) your existing config** into the location `deluge/compose.yaml`
   expects (`${HOME_LAB_DIR:-.}/config`, i.e. `deluge/config` by default):
   ```bash
   mkdir -p deluge/config
   cp -a ~/.config/deluge/. deluge/config/
   ```

3. **Set `DOWNLOADS_PATH`** in `deluge/.env` to your existing downloads directory
   (no copying needed — it's mounted directly):
   ```env
   DOWNLOADS_PATH=/home/pi/Downloads
   ```

4. **Start the Docker stack**:
   ```bash
   cd deluge
   docker compose up -d
   ```

5. Verify at `http://<host-ip>:8112` — all torrents, settings, and history should be intact.

### Migrate Plex

1. **Stop the host Plex service**:
   ```bash
   sudo systemctl stop plexmediaserver
   sudo systemctl disable plexmediaserver
   ```

2. **Get a Plex claim token** (valid for 4 minutes, only needed on first start):
   Visit https://plex.tv/claim and copy the token — not needed if you're copying
   an existing config (see next step), since server identity is preserved.

3. **Copy (not move) your existing config** into the location `plex/compose.yaml`
   expects (`${HOME_LAB_DIR:-.}/config`, i.e. `plex/config` by default):
   ```bash
   mkdir -p plex/config
   cp -a "/var/lib/plexmediaserver/Library/Application Support/Plex Media Server/." plex/config/
   ```

4. **Set `PLEX_MEDIA_PATH`** in `plex/.env` to your existing media directory
   (no copying needed — it's mounted directly). Mount the same parent directory
   Plex originally scanned from, so the container sees media at the same
   absolute path recorded in Plex's library database:
   ```env
   PLEX_MEDIA_PATH=/home/pi/media
   PLEX_CLAIM=claim-xxxxxxxxxxxxxxxxxxxx
   ```

5. **Start the Docker stack**:
   ```bash
   cd plex
   docker compose up -d
   ```

6. Verify at `http://<host-ip>:32400/web` — libraries, metadata, and watch history should all be present.

> **Note**: `PUID`/`PGID` (default `1000`) must match the owner of your existing config files. Check with `ls -la ~/.config/deluge` or `ls -la /var/lib/plexmediaserver`.

## Updating services

```bash
cd <service-name>
docker compose pull
docker compose up -d
```

## Troubleshooting

### Service unreachable after recreating a `tailscale` sidecar: "stale network namespace"

**Symptom**: A service (NPM, Plex, Immich, etc.) becomes completely unreachable
— from LAN, Tailnet, and VPN alike — even though:
- The app container shows `healthy` and has been running for a while.
- Its process is confirmed listening on the right port (e.g. `0.0.0.0:81`),
  and works perfectly via `curl 127.0.0.1:<port>` from inside the container.
- `iptables`, DNS, and the app's own config all look completely normal.
- Connection attempts get an immediate `Connection refused` (a TCP `RST`),
  not a timeout — even from other containers on the same Docker network, or
  from the Docker host itself.

**Root cause**: every service here runs a `tailscale-${SERVICE}` sidecar
container that owns the actual network attachments (the shared `homelab`
bridge, Tailscale), and the app container (`app-${SERVICE}`) joins
it via `network_mode: service:tailscale` — sharing its network namespace
instead of having its own.

`network_mode: service:X` binds to whatever container `X` *is* at the moment
the dependent container is created. If you later recreate the `tailscale`
sidecar on its own (e.g. `docker compose up -d --force-recreate tailscale`,
to apply a new `mac_address`, image update, etc.) **without** also recreating
the app container, Docker creates a brand-new network namespace for the new
sidecar — but the still-running app container keeps referencing the *old,
now-orphaned* namespace. It keeps working perfectly on its own loopback
(`127.0.0.1`), but it's no longer actually attached to any real network
anyone else can reach.

**Diagnosis** — confirm the two containers' network namespaces differ:

```bash
docker inspect app-<service> --format '{{.State.Pid}}' | xargs -I{} sudo readlink /proc/{}/ns/net
docker inspect tailscale-<service> --format '{{.State.Pid}}' | xargs -I{} sudo readlink /proc/{}/ns/net
```

If the two `net:[...]` values differ, this is the bug.

**Fix**: recreate the app container so it re-attaches to the current
sidecar's namespace:

```bash
./lab.sh fix-netns <service>
```

This checks every container in the service for a stale `network_mode:
container:X` reference and force-recreates the whole service if any are
found. You can also run it proactively any time as a health check — it's a
no-op (just prints "Network namespaces OK") if nothing is stale.

**Prevention**: never target a single container within a multi-container
service for recreation (e.g. raw `docker compose up -d --force-recreate
tailscale`). Prefer `./lab.sh restart <service>`, which tears down and
recreates *all* of the service's containers together, so this can't happen.
If you do need to touch just the sidecar (as we did to apply a pinned
`mac_address`), immediately follow up with `./lab.sh fix-netns <service>` (or
just `./lab.sh restart <service>`).

### VPN clients can't resolve any domain: dnsmasq DNAT points at `127.0.0.1`

**Symptom**: Connected to the wg-easy VPN (or full-tunnel), but *no* domain
resolves — not just `*.pimlicoa.duckdns.org`, but every domain, including
plain internet sites. Direct IP access (e.g. `curl http://10.200.0.60:81`)
still works fine; only DNS is broken.

**Root cause**: `wg-easy-hooks-bootstrap` (the container that automatically
configures wg-easy's `PostUp`/`PostDown` iptables rules on every
`docker compose up`) runs on the minimal `curlimages/curl` image, which has
**no Docker CLI or socket** — so its old method of finding dnsmasq's IP
(`docker inspect dnsmasq-wg-easy ...`) always failed silently inside that
container, permanently falling back to a hardcoded `127.0.0.1` (wg-easy's
own loopback — a dead end, since dnsmasq runs in a different container).
This bug was masked whenever the fix was applied by re-running
`sh bootstrap-hooks.sh` directly **on the host** (which does have a working
`docker` CLI), but reappeared every time the `wg-easy` stack was recreated
via `docker compose up`/`./lab.sh restart wg-easy` automatically re-running
the bootstrap container.

**Fix (superseded)**: `bootstrap-hooks.sh` initially resolved dnsmasq's IP via
`getent hosts dnsmasq-wg-easy` when running inside the bootstrap container
(using Docker's embedded DNS over the shared `wg_easy_internal` network,
which needs no extra tooling), falling back to `docker inspect` when run
manually on the host, and failing loudly instead of silently defaulting to
`127.0.0.1`. **This has since been superseded** by pinning dnsmasq to a
static IP (`172.28.0.2`) on `wg_easy_internal` — see the next section for
why runtime resolution turned out to be treating a symptom, not the root
cause.

**Diagnosis** — confirm the installed NAT rule points at the wrong IP:

```bash
docker exec wg-easy iptables -t nat -S | grep -E "5353|dport 53"
```

If you see `--to-destination 127.0.0.1:5353` instead of dnsmasq's actual
container IP (`docker inspect dnsmasq-wg-easy -f
'{{.NetworkSettings.Networks.wg_easy_bridge.IPAddress}}'`), this is the bug.

**Manual recovery** (if you hit this on an older checkout before pulling the
fix): re-run the hook on the host, then cycle wg-easy so the corrected rule
is actually installed (updating the API config alone does **not** reapply
`PostUp`/`PostDown` — only bringing the WireGuard interface down/up does):

```bash
cd wg-easy && sh bootstrap-hooks.sh
./lab.sh restart wg-easy
```

### Why wg-easy needed a hook-rerun + restart on *every* single start/restart

**Root cause (found later)**: `dnsmasq` had no pinned IP on `wg_easy_internal`
(the same "unpinned = dynamic Docker IPAM" bug already fixed once for the
`homelab` bridge). `PostUp`/`PostDown` embed dnsmasq's IP as a **literal
value** baked into wg-easy's persisted config (`wg-easy/data/`) — so any time
dnsmasq's IP happened to drift across a restart, the *already-saved* rules
went stale, forcing the whole hook-rerun + wg-easy-recreate dance just to
regenerate them with the new IP. This made every `./lab.sh restart wg-easy`
feel like a fragile, multi-step operation with configuration that could
seemingly "get lost" — really just the rules getting silently regenerated
against a moving target.

**Fix**: dnsmasq is now pinned to a static IP (`172.28.0.2`, on an explicit
`172.28.0.0/24` subnet added to `wg_easy_internal`). `bootstrap-hooks.sh` no
longer does any runtime IP resolution at all (removed the `getent`/`docker
inspect` logic entirely — one less thing that can silently fail). Since
wg-easy persists its config in the `data/` volume, and the embedded dnsmasq
IP can now never change, a plain restart is idempotent: it reloads the same
already-correct `PostUp`/`PostDown` without the hook needing to actually
change anything.

The hook itself is now also **idempotent-aware**: it fetches the
currently-stored hooks/userconfig via wg-easy's API first, and only POSTs an
update if the desired value actually differs (printing a
`BOOTSTRAP_RESULT=changed`/`unchanged` marker line). `run_bootstrap_hooks()`
in `lab.sh` waits for the hook to finish (`docker compose wait`), reads that
marker from its logs, and **only force-recreates wg-easy when the hook
reports a real change** — so an ordinary `./lab.sh start`/`restart` on an
already-configured install no longer force-recreates wg-easy at all; it just
confirms nothing needs to change and moves on.

Additionally, `wg-easy`'s `INIT_ALLOWED_IPS` (a native, officially-supported
wg-easy env var — see `INIT_DNS`, already in use) is now also set, so fresh
installs get correct client defaults (translated + real LAN subnets) from
their very first boot, without depending on the hook's `userconfig` API call
at all for that value. Note `INIT_*` vars only apply on a container's
*first ever* boot (per wg-easy's docs) — they can't retroactively fix an
already-initialized install; the hook's `userconfig` API call remains the
mechanism for that, and is still the only way to configure
`defaultPersistentKeepalive` (no `INIT_*` equivalent exists for it).

**A second, related pitfall**: `wg-easy-hooks-bootstrap` is a one-shot
container gated by `depends_on: condition: service_healthy` on `wg-easy`.
`docker compose up -d` can return before that health check actually passes,
leaving the hook container stuck in a `Created` (never-started) state —
silently skipping the whole `PostUp`/DNS-interception setup with no error at
all (`docker logs wg-easy-hooks-bootstrap` shows nothing). `./lab.sh start
<svc>` and `./lab.sh restart <svc>` now explicitly force-recreate any
`*-hooks-bootstrap` service after bringing a service up, so this can't
silently no-op — but if you ever invoke `docker compose up -d` directly
(bypassing `lab.sh`), check with:

```bash
docker ps -a --filter name=wg-easy-hooks-bootstrap --format 'table {{.Names}}\t{{.Status}}'
```

If `STATUS` shows `Created` (not `Exited (0)`), force it to actually run:

```bash
docker compose -f wg-easy/compose.yaml up -d --force-recreate wg-easy-hooks-bootstrap
```

**A third, related pitfall**: even when the hook container *does* run
successfully (as above), the rules it configures are only *saved* via the
API — as noted above, that alone does **not** reapply `PostUp`/`PostDown` to
the live WireGuard interface. `./lab.sh start <svc>`/`restart <svc>` now
automatically force-recreates the hook's target service too (`wg-easy`
itself) right after the hook finishes, so any rule change actually takes
effect without a separate manual step. If you ever run the hook container
manually/directly, remember to also cycle `wg-easy` afterward:

```bash
docker compose -f wg-easy/compose.yaml up -d --force-recreate wg-easy-hooks-bootstrap
docker compose -f wg-easy/compose.yaml up -d --force-recreate wg-easy
```

### Android VPN client can reach raw IPs but domains time out (client-side, not a bug)

If `curl`/browsing a raw translated IP (e.g. `http://10.200.0.60:81`) works over
the VPN but `*.pimlicoa.duckdns.org` domains time out, and `nslookup
<domain> 10.200.0.1` from the phone (e.g. via Termux) resolves correctly,
this is **not** a server-side bug — it's Android's **Private DNS**
("DNS-over-TLS") setting. When set to `Automatic`, Android opportunistically
tries DoT (port 853) against the VPN-supplied DNS server first; since
dnsmasq doesn't support DoT, Android stalls trying that before falling back
to plain DNS, often long enough to trigger a client/app-level timeout.

**Fix**: on the Android device, go to **Settings → Network & Internet →
Private DNS** and set it to **Off** (at least while connected to the VPN).

### VPN client's handshake never completes after deleting/recreating it in wg-easy

**Symptom**: A client's `.conf` looks structurally fine (correct
`Endpoint`, `AllowedIPs`, etc.), the WireGuard app shows the tunnel as
"active," but `wg show wg0` on the Pi never shows a handshake for it, and
`tcpdump` shows only one-sided traffic (the client's handshake-initiation
retries arrive, but wg-easy never responds).

**Root cause**: deleting a client in the wg-easy admin UI permanently
removes that peer's keypair from the server. If you then reuse an old,
locally-saved `.conf` file (or manually recreate the client and expect the
old file to still work), the `[Peer] PublicKey` in that file is the
**server's** public key — this doesn't change when you delete/recreate a
client, so an old `.conf` will usually still have the correct server key.
What *does* go stale is the **`[Interface] PrivateKey`**: each client's own
keypair is generated fresh by wg-easy every time a new client is created,
so an old client's private key has no matching peer entry on the server
after that client is deleted — the server silently drops every handshake
from a private key it doesn't recognize, with zero error or log output on
either side.

**Fix**: this can't be fixed by editing the client-side `.conf` at all —
you must download a **fresh config for the current client** from the
wg-easy admin UI (Client → Download), which is guaranteed to contain the
private key matching whatever peer entry wg-easy actually has server-side.
If you need customized `DNS`/`AllowedIPs`/`PersistentKeepalive` values,
re-apply those edits on top of the freshly downloaded file — every other
field (`PrivateKey`, `[Peer] PublicKey`, `PresharedKey`) must come from that
download unmodified.

## Syncing environment files to the Raspberry Pi

To copy every local `.env` file to the matching service directory on `pi@little-pi4`, run:

```bash
./sync-env.sh
```

The script preserves paths relative to this repository, creates the destination repository directory if necessary, and sets copied `.env` files to owner-read/write permissions on the Raspberry Pi. It does not delete remote files.

## Secrets reminder

- `PIHOLE_WEBPASSWORD` in `pihole/.env`
- `DB_PASSWORD` in `immich/.env`
- `TS_AUTHKEY` in every `.env` file that still runs a Tailscale sidecar (not `wg-easy/.env` or `nginx-proxy-manager/.env`)
- `DUCKDNS_TOKEN`, `WG_EASY_HOST`, and `WG_EASY_ADMIN_PASSWORD` in `wg-easy/.env`

Do **not** commit `.env` files to version control. Add them to `.gitignore`:

```bash
echo "**/.env" >> .gitignore
echo "**/ts/" >> .gitignore
```
