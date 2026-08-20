# RFC-007 access control

This directory holds the first manual implementation slice for RFC-007.

## Files

- `aliases.json.example` — starter alias catalog for groups, hosts, and services
- `policies.json.example` — starter rules file
- `./sync.py` — manual sync tool

## Usage

1. Copy `aliases.json.example` to `aliases.json`
2. Copy `policies.json.example` to `policies.json`
3. Edit the aliases and rules
4. Run:

```bash
./lab.sh access-control-api       # dry run
./lab.sh access-control-api --apply
                                  # apply rules
./lab.sh access-control-api --serve
                                  # read-only API for peer discovery / preview
./lab.sh access-control-serve     # start the access-control API and UI container
```

### Container runtime (recommended)

The access-control API + UI bundle can run as a single containerized service
through the main lab script:

```bash
cd wg-easy/access-control
cp .env.example .env
./lab.sh access-control-serve
```

This image builds the UI with `npm ci` (never `npm install`) so the checked-in
`package-lock.json` is always respected.

The `access-control-api` and `access-control-ui` lab commands still run the
API sync tool and Vite dev server directly for local development.

Use `--policies` and `--aliases` to point at different files, or omit `--apply`
for a dry run.
If `policies.json` or `aliases.json` do not exist yet, the dry run falls back to
their corresponding `.example` files so you can preview the mapping before
creating your own files.

## API Mode

`./lab.sh access-control-api --serve` starts a read-only API-only server for the live
wg-easy peer inventory plus the normalized alias/policy snapshot used by the
compiler.

Default bind: `127.0.0.1:8787`

Endpoints:

- `/api/healthz`
- `/api/state`
- `/api/inventory`
- `/api/peers` (peer list)
- `/api/peers/{peerName}`
- `/api/aliases`
- `/api/policies`
- `/api/rules`
- `/api/rules/{ruleIndex}`
- `/api/groups`
- `/api/groups/{groupName}`
- `/api/services`
- `/api/services/{serviceName}`
- `/api/openapi.json`

Peers are read-only because they come from the live wg-easy inventory. Rules,
groups, and services are editable as individual resources through the new REST
endpoints above.

## UI Bundle

Build the UI from `wg-easy/access-control/ui/`, then serve the generated bundle
and the backend API together from `wg-easy/access-control/serve.py`.
If `policies.json` or `aliases.json` are missing, the server falls back to the
matching `.example` files for read-only startup.

Default bind: `0.0.0.0:8787`

Environment overrides:

- `ACCESS_CONTROL_HOST`
- `ACCESS_CONTROL_PORT`
- `ACCESS_CONTROL_UI_DIST_DIR`
- `ACCESS_CONTROL_CORS_ALLOWED_HOSTS` — comma-separated extra hostnames that may access the API cross-origin

This is the recommended runtime entrypoint. It serves the app at `/` and the
API exclusively under `/api/...`.

## Alias Format

### Groups

Groups expand peer names.

```json
{
  "groups": {
    "family": ["iphone", "tablet"],
    "work": {
      "members": ["macbook", "dams-s23"]
    }
  }
}
```

### Hosts

Hosts can be written as a plain IP string or an object.

```json
{
  "hosts": {
    "raspberry": "192.168.1.60",
    "nas": {
      "address": "192.168.1.10",
      "comment": "Storage server"
    }
  }
}
```

### Services

Services can be a single concrete match or a list of matches.
One service alias may expand to multiple concrete protocol/port rules.

```json
{
  "services": {
    "ssh": {
      "protocol": "tcp",
      "port": 22
    },
    "admin": {
      "entries": [
        { "protocol": "tcp", "port": 443 },
        { "protocol": "tcp", "port": 8443 }
      ]
    }
  }
}
```

## Rules Format

### Selectors

In `source` and `destination` fields, you can use:

- **Peer name**: `"macbook"` — resolves to the peer's current WireGuard IP via the wg-easy API
- **Group name**: `"family"` — expands to all peers in that group
- **Host alias**: `"raspberry"` — resolves through `aliases.json`
- **All peers**: `"*"` — expands to all active peers from the wg-easy API
- **IP/CIDR**: `"192.168.1.60"`, `"10.200.0.0/24"`, `"0.0.0.0/0"` — literal network addresses
- **Service alias**: use the `service` field, which resolves through `aliases.json`

### Rule Fields

- `source` — where traffic comes from
- `destination` — where traffic goes to
- `service` — one or more named service aliases
- `protocol` — `"tcp"`, `"udp"`, or omit for both
- `port` — specific port number, or omit for all ports
- `action` — `"allow"`, `"deny"`/`"drop"`, or `"reject"`
  - `deny`/`drop` silently drops packets
  - `reject` actively rejects packets (TCP uses reset for faster failures)
- `comment` — optional rule comment preserved in runtime firewall rules when supported
All access-control rules apply to NEW connections only; established and related
traffic is accepted by the firewall state rule before policy evaluation.
VPN infrastructure traffic (currently wg0 DNS forwarded to Pi-hole at
`DNSMASQ_IP:5353`) is handled outside `policies.json` in a dedicated
infrastructure chain, so peer policies do not need Docker-network destinations.

### Examples

```json
[
  { "source": ["family"], "destination": ["raspberry"], "service": ["ssh"], "action": "reject", "comment": "Block SSH to Raspberry" },
  { "source": ["iphone"], "destination": ["macbook"], "action": "deny" },
  { "source": ["macbook"], "destination": ["phone"], "action": "allow" }
]
```
