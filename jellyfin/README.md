# Jellyfin

Jellyfin is a free, open-source media server — a self-hosted alternative to Plex with no account required and no feature paywalls.

## Feature parity with Plex

| Feature | Plex | Jellyfin | Notes |
|---|---|---|---|
| Web UI | ✅ | ✅ | Jellyfin: `http://<host>:8096` |
| Mobile apps | ✅ | ✅ | iOS/Android apps available (free) |
| Desktop apps | ✅ | ✅ | |
| Hardware transcoding | ✅ (Plex Pass) | ✅ **free** | See hardware transcoding section below |
| Live TV / DVR | ✅ (Plex Pass) | ✅ **free** | Requires HDHomeRun or IPTV source |
| Offline sync / downloads | ✅ (Plex Pass) | ✅ **free** | Via Jellyfin mobile apps |
| Music library | ✅ | ✅ | |
| Photo library | ✅ | ✅ | |
| Multi-user with parental controls | ✅ | ✅ | |
| Watch history sync | ✅ | ✅ | |
| External metadata agents | Limited | ✅ | Via plugins (TMDB, TVDB, AniDB, etc.) |
| Lyrics | ❌ (3rd party) | ✅ | Built-in with LrcLib plugin |
| Tailnet access | ✅ | ✅ | Via Tailscale Serve (`https://jellyfin.<tailnet>.ts.net`) |
| No Plex account required | ❌ | ✅ | Fully local, no cloud dependency |

## Required changes for feature parity

### 1. Hardware transcoding (highly recommended)

Jellyfin supports hardware transcoding for free. Enable it in:
**Dashboard → Playback → Transcoding → Hardware acceleration**

Then uncomment the relevant block in `compose.yaml`:

**Intel Quick Sync (iGPU — most common on Pi or NUC):**
```yaml
devices:
  - /dev/dri:/dev/dri
```
Select **Intel QuickSync (QSV)** or **Video Acceleration API (VAAPI)** in Jellyfin settings.

**NVIDIA GPU:**
```yaml
runtime: nvidia
environment:
  - NVIDIA_VISIBLE_DEVICES=all
```
Requires the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) installed on the host.

Check available devices:
```bash
ls /dev/dri   # Intel/AMD
nvidia-smi    # NVIDIA
```

### 2. Plugins (extend functionality)

Install via **Dashboard → Plugins → Catalogue**. Recommended:

| Plugin | Purpose |
|---|---|
| **TMDB** | Movie/TV metadata (enabled by default) |
| **TVDB** | Alternative TV metadata |
| **AniDB / AniList** | Anime metadata |
| **Intro Skipper** | Auto-detect and skip intros |
| **Playback Reporting** | Watch statistics |
| **Jellyseerr** | Request management (separate container, like Overseerr for Plex) |

### 3. Jellyseerr — media requests (Plex Overseerr equivalent)

If you use Overseerr with Plex, use [Jellyseerr](https://github.com/Fallenbagel/jellyseerr) with Jellyfin. It is a separate service — add it as a new compose stack when needed.

### 4. Nginx Proxy Manager upstream

Add a proxy host in NPM:

| Field | Value |
|---|---|
| Domain | `jellyfin.pimlicoa.duckdns.org` |
| Scheme | `http` |
| Upstream host | `tailscale-jellyfin` |
| Upstream port | `8096` |
| SSL cert | `*.pimlicoa.duckdns.org` (wildcard) |

### 5. Pi-hole DNS record

Add a CNAME in Pi-hole → Local DNS → CNAME Records:
```
jellyfin.pimlicoa.duckdns.org → pimlicoa.duckdns.org
```

## First-run setup

1. Open `http://<host-ip>:8096` — the setup wizard runs automatically
2. Create an admin account (local only, no cloud account needed)
3. Add media libraries pointing at `/media` (already mounted from `JELLYFIN_MEDIA_PATH`)
4. Enable hardware transcoding (Dashboard → Playback → Transcoding)
5. Install desired plugins (Dashboard → Plugins → Catalogue)

## Migrating from Plex

There is no direct Plex-to-Jellyfin config migration. Jellyfin will re-scan your existing media files and fetch metadata fresh. Your media files are shared — just point `JELLYFIN_MEDIA_PATH` at the same directory as `PLEX_MEDIA_PATH`.

Watch history and ratings cannot be migrated automatically.
