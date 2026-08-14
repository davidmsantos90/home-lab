# Deluge

BitTorrent client stack with web UI and torrent ports exposed locally.

## Dependencies

- Docker + Docker Compose v2
- Shared external `homelab` network

## Environment variables

Copy [`.env.example`](/Users/davsantos/github/misc/home-lab/deluge/.env.example) to `.env` and set:

- `TZ`
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

## YaRSS2 plugin: Python 3.12 compatibility rebuild

This service migrated from a host-native Deluge install to this container.
The host install had the **YaRSS2** RSS-automation plugin configured
(`/config/plugins/YaRSS2-2.1.5-py3.9.egg`), but that prebuilt `.egg` targets
Python 3.9. This image (`lscr.io/linuxserver/deluge`) ships Python 3.12, and
Python eggs are built per-interpreter-version — Deluge silently fails to
load an egg built for the wrong Python version (no plugin, no obvious error
beyond a log line saying "Unable to instantiate plugin").

Rather than trust a third-party fork offering prebuilt eggs (rejected —
see [Why not the community WebUI fork](#why-not-the-community-webui-fork)
below), the plugin was rebuilt from its real upstream source, targeting
this image's actual Python version, with legacy vendored dependencies
replaced by modern pip-installed equivalents.

### Why not the community WebUI fork

A search turned up `TSA3000/deluge-yarss2-webui` on GitHub, advertising a
"security fix + WebUI" rewrite of YaRSS2 with prebuilt eggs per Python
version. It was **not used**: the repo was created in 2026, has very few
stars, and distributes prebuilt binary `.egg` files (arbitrary code that
runs inside the Deluge daemon) — a risk profile inconsistent with a
trustworthy source for a plugin with real upstream provenance. The
genuine upstream is `bendikro/deluge-yarss-plugin`
(https://bitbucket.org/bendikro/deluge-yarss-plugin), the same maintainer
credited even in that fork's own README.

### What was actually wrong (in order found)

1. **Wrong Python version.** The `py3.9` egg doesn't load under Python 3.12
   at all (`pkg_resources.DistributionNotFound`).
2. **Vendored `requests`/`urllib3`.** YaRSS2 bundles its own copies of
   several dependencies under `yarss2/include/` (see
   `yarss2/include/libraries.txt` in the source) so it doesn't need them
   pip-installed. Its vendored `urllib3` is old enough to depend on a
   bundled `six` compatibility shim (`urllib3.packages.six.moves`) that's
   broken/missing — `ModuleNotFoundError: No module named
   'urllib3.packages.six.moves'`.
3. **Vendored `dateutil`.** Once `requests`/`urllib3` were replaced with
   modern pip packages, the vendored `dateutil` (pulled in via YaRSS2's
   vendored `atoma`) failed the same way — old `dateutil` needs plain
   `six`, which isn't installed either (`ModuleNotFoundError: No module
   named 'six'`).
4. **`atoma.RSSChannel` API drift.** YaRSS2 also vendors a **custom fork**
   of `atoma` (not just an old version) that adds a `torrent`/
   `torrent_item` field to parsed RSS items — this is how it extracts
   magnet links/infohashes from torrent-tracker RSS feeds (ezRSS and
   xbnbt RSS extensions). This custom parsing logic doesn't exist in
   vanilla `atoma` from PyPI, so this vendored copy had to be **kept**,
   unlike the other vendored dependencies. Its own code assumed the
   upstream `atoma.RSSChannel` still had a `.version` attribute, which
   modern `atoma` dropped — `AttributeError: 'RSSChannel' object has no
   attribute 'version'` when fetching an Atom feed. Fixed by deleting the
   one dead line that wrote this unused field
   (`yarss2/rssfeed_handling.py`, `'version': atoma_result.version,` — it
   was never read anywhere else in the codebase).

### The fix: pip-installed deps + a stripped-down, patched rebuild

**1. Durable location for pip packages.** Rather than `pip install`
directly into the container's own site-packages (which lives in the
container's writable layer and would be wiped out on recreation/image
update), packages are installed into a directory under the already
persisted `/config` bind mount, added to `PYTHONPATH` via `compose.yaml`:

```yaml
- PYTHONPATH=/config/python-libs
```

Install (one-time, survives container recreation since it's under `/config`):

```bash
docker exec app-deluge python3 -m pip install --target=/config/python-libs \
  requests six python-dateutil defusedxml beautifulsoup4 soupsieve html5lib webencodings
```

(`atoma` is deliberately **not** pip-installed — see point 4 above; the
custom vendored fork inside the egg is kept instead, and must not be
shadowed by a vanilla pip `atoma`.)

**2. Rebuild the egg from real upstream source**, targeting this
container's actual Python version, keeping only the vendored `atoma`
(custom fork) and dropping every other vendored dependency (so plain
`import requests`/`dateutil`/etc. fall through to the pip packages above):

```bash
docker exec app-deluge sh -c "
set -e
cd /tmp
rm -rf yarss2-src yarss2-src.tar.gz
curl -sL https://bitbucket.org/bendikro/deluge-yarss-plugin/get/development.tar.gz -o yarss2-src.tar.gz
mkdir -p yarss2-src
tar xzf yarss2-src.tar.gz -C yarss2-src --strip-components=1
cd yarss2-src
sed -i \"/'version': atoma_result.version,/d\" yarss2/rssfeed_handling.py
rm -rf yarss2/include/requests yarss2/include/urllib3 yarss2/include/certifi \
       yarss2/include/dateutil yarss2/include/defusedxml yarss2/include/beautifulsoup \
       yarss2/include/soupsieve yarss2/include/html5lib yarss2/include/webencodings
python3 setup.py bdist_egg
ls -la dist/
"
```

**3. Install the new egg and restart:**

```bash
docker exec app-deluge sh -c "
cp /tmp/yarss2-src/dist/YaRSS2-2.1.5-py3.12.egg /config/plugins/
rm -f /config/plugins/YaRSS2-2.1.5-py3.9.egg
rm -rf /tmp/yarss2-src /tmp/yarss2-src.tar.gz
"
docker compose restart application
```

Both `/config/plugins` and `/config/python-libs` are under the bind-mounted
`/config` volume, so this rebuilt egg and the pip packages persist across
container recreation and image updates — no need to redo this after a
routine `docker compose pull && docker compose up -d`. It **would** need
redoing if the base image bumps its Python version again (e.g. 3.12 → 3.13),
since the egg is version-specific — re-run the same steps with the new
version's suffix if that happens.

### Known limitation: no Web UI configuration panel

This build only restores YaRSS2's **core** plugin (feed polling/downloading,
runs inside `deluged`) and its **GTK UI** plugin (native desktop client
only). It has no Web UI panel — that's not a regression from this rebuild,
the original `bendikro` codebase never shipped one (only the untrusted
fork mentioned above added that). Configure feeds/subscriptions via the
native Deluge GTK client connected to this container's daemon (see
[Connecting a native client](#connecting-a-native-client) above); the core
plugin polls and adds torrents regardless of which UI was used to
configure it.
