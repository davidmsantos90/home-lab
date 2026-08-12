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
python3 wg-easy/access-control-sync.py --apply
```

Use `--policies` to point at a different policy file, or omit `--apply` for a dry run.
If `policies.json` does not exist yet, the dry run falls back to
`policies.json.example` so you can preview the rule mapping before creating
your own file.
