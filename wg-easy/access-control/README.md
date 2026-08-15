# RFC-007 access control

This directory holds the first manual implementation slice for RFC-007.

## Files

- `aliases.json.example` — starter alias catalog for groups, hosts, and services
- `policies.json.example` — starter rules file
- `../access-control-sync.py` — manual sync tool

## Usage

1. Copy `aliases.json.example` to `aliases.json`
2. Copy `policies.json.example` to `policies.json`
3. Edit the aliases and rules
4. Run:

```bash
./lab.sh access-sync              # dry run
./lab.sh access-sync --apply      # apply rules
./lab.sh access-sync --serve      # read-only API for peer discovery / preview
```

Use `--policies` and `--aliases` to point at different files, or omit `--apply`
for a dry run.
If `policies.json` or `aliases.json` do not exist yet, the dry run falls back to
their corresponding `.example` files so you can preview the mapping before
creating your own files.

## API Mode

`--serve` starts a read-only HTTP API that exposes the live wg-easy peer
inventory plus the normalized alias/policy snapshot used by the compiler.

Default bind: `127.0.0.1:8787`

Endpoints:

- `/healthz`
- `/api/state`
- `/api/inventory` (alias: `/api/peers`)
- `/api/aliases`
- `/api/policies`

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

In `source`, `source_group`, `destination`, and `destination_group` fields, you can use:

- **Peer name**: `"macbook"` — resolves to the peer's current WireGuard IP via the wg-easy API
- **Group name**: `"family"` — expands to all peers in that group (use in `source_group` or `destination_group`)
- **Host alias**: `"raspberry"` — resolves through `aliases.json`
- **All peers**: `"*"` — expands to all active peers from the wg-easy API
- **IP/CIDR**: `"192.168.1.60"`, `"10.200.0.0/24"`, `"0.0.0.0/0"` — literal network addresses
- **Service alias**: use the `service` field, which resolves through `aliases.json`

### Rule Fields

- `source` or `source_group` — where traffic comes from
- `destination` or `destination_group` — where traffic goes to
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
  { "source_group": "family", "destination": "raspberry", "service": "ssh", "action": "reject", "comment": "Block SSH to Raspberry" },
  { "source": "iphone", "destination": "macbook", "action": "deny" },
  { "source": "macbook", "destination": "phone", "action": "allow" }
]
```
