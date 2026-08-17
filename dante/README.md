# Dante SOCKS5 Proxy

SOCKS5 proxy server for routing traffic through a central proxy point. Access control is managed via network-based firewall rules (wg-easy) rather than username/password authentication, allowing transparent proxy usage in browsers like Chrome.

## Dependencies

- Docker + Docker Compose v2
- Shared external `homelab` network

## Environment variables

Copy [`.env.example`](/Users/davsantos/github/misc/home-lab/dante/.env.example) to `.env` and set:

- `TZ` (timezone, default `Etc/UTC`)
- `SERVICEPORT` (SOCKS5 listen port, default `1080`)
- `HOME_LAB_DIR` (base dir for config)

## Configuration

Copy [dante.conf.example](/Users/davsantos/github/misc/home-lab/dante/dante.conf.example) to `dante.conf` and customize for your network:

```bash
cp dante.conf.example dante.conf
```

Edit `dante.conf` to:
- Allow client connections from your network ranges (see `client pass` rules)
- Define which destinations are accessible through the proxy (see `socks pass` rules)

The example configuration allows connections from `192.168.1.0/24` and `10.8.0.0/24`. Update these to match your actual network topology.

**Access control:** No authentication is required at the proxy level. Instead, configure firewall rules in wg-easy to control which clients can access the proxy and which destinations are reachable through it.

## Startup

```bash
cd dante
cp .env.example .env
cp dante.conf.example dante.conf
# Edit dante.conf for your network configuration
docker compose up -d
```

## Usage

Configure your application to use:

- Host: this machine's LAN IP or Tailscale hostname
- Port: `SERVICEPORT` (default `1080`)
- Protocol: SOCKS5
- No authentication required

Example with `curl`:

```bash
curl --socks5 hostname:1080 https://example.com
```

Example in Chrome:
```bash
google-chrome --proxy-server="socks5://hostname:1080"
```

## Useful links

- https://www.inet.no/dante/ — Dante SOCKS server documentation
- https://www.inet.no/dante/doc/1.4.x/socksrc.html — Configuration reference
