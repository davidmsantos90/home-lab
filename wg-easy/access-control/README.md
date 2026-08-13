# RFC-007 access control

This directory holds the first manual implementation slice for RFC-007.

## Files

- `policies.json.example` — starter policy file
- `../access-control-sync.py` — manual sync tool

## Usage

1. Copy `policies.json.example` to `policies.json`
2. Edit the peers, groups, and rules
3. Run:

```bash
./lab.sh access-sync              # dry run
./lab.sh access-sync --apply      # apply rules
```

Use `--policies` to point at a different policy file, or omit `--apply` for a dry run.
If `policies.json` does not exist yet, the dry run falls back to
`policies.json.example` so you can preview the rule mapping before creating
your own file.

## Policy Format

### Selectors

In `source`, `source_group`, `destination`, and `destination_group` fields, you can use:

- **Peer name**: `"macbook"` — resolves to the peer's current WireGuard IP via the wg-easy API
- **Group name**: `"family"` — expands to all peers in that group (use in `source_group` or `destination_group`)
- **All peers**: `"*"` — expands to all active peers from the wg-easy API
- **IP/CIDR**: `"192.168.1.60"`, `"10.200.0.0/24"`, `"0.0.0.0/0"` — literal network addresses

### Rule Fields

- `source` or `source_group` — where traffic comes from
- `destination` or `destination_group` — where traffic goes to
- `protocol` — `"tcp"`, `"udp"`, or omit for both
- `port` — specific port number, or omit for all ports
- `action` — `"allow"` or `"deny"`

### Examples

```json
{
  "groups": {
    "family": ["iphone", "tablet"],
    "work": ["macbook"]
  },
  "rules": [
    { "source": "*", "destination": "10.8.0.1", "action": "allow" },
    { "source_group": "family", "destination": "192.168.1.60", "protocol": "tcp", "port": 443, "action": "allow" },
    { "source": "iphone", "destination": "macbook", "action": "deny" }
  ]
}
```

