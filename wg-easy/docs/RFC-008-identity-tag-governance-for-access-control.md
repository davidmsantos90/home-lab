# RFC-008 — Identity Tag Governance for Access Control

## Status

Proposed (not implemented)

## Problem

The current access-control model already avoids hardcoded IPs by using aliases
and named selectors, but source trust semantics are still mostly inferred from
peer names and manually curated groups. This creates two gaps:

1. **Identity semantics gap**: policy cannot reliably answer "who owns this
   peer/device?" or "is this source trusted/admin/guest?" as first-class data.
2. **Governance gap**: there is no formal rule for who is allowed to assign
   sensitive classifications (for example, `admin`, `trusted`, `infra`) to
   peers.

As the homelab grows, this increases risk of policy drift and accidental
over-permission.

## Goal

Add a lightweight identity/governance layer on top of the current alias-based
policy compiler so rules can target stable identity tags and ownership selectors
without requiring a full grants/app-capabilities model.

## Non-goals

- Replacing the existing rule model with full grants semantics.
- Requiring changes inside third-party applications.
- Rebuilding the current aliases/groups/services model from scratch.

## Proposed design

### 1) Add principals metadata

Introduce a new file, `principals.json`, as the source of truth for peer
identity metadata.

Example:

```json
{
  "peers": {
    "iphone": {
      "owner": "david",
      "tags": ["family", "mobile"]
    },
    "work-laptop": {
      "owner": "david",
      "tags": ["admin", "trusted"]
    }
  }
}
```

### 2) Extend selector semantics

Keep existing selectors and add identity selectors for rule `source` (and
optionally `destination`):

- `tag:<name>` (for example `tag:family`)
- `owner:<name>` (for example `owner:david`)

Compiler behavior:

- resolve `tag:*` and `owner:*` to concrete peer names from `principals.json`
- continue resolving peer names/groups/hosts/services exactly as today
- fail closed on unknown tags/owners (validation error)

### 3) Add tag governance (tag owners)

Introduce governance config in `principals.json`:

```json
{
  "tagOwners": {
    "admin": ["david"],
    "trusted": ["david"]
  }
}
```

On write operations (rule/group/service/principals updates), enforce:

- only allowed editors can assign restricted tags
- attempts by unauthorized actors fail validation

### 4) API surface

Extend access-control API with principals endpoints:

- `GET /api/principals`
- `PUT /api/principals`
- optional resource endpoints for peer identity metadata

The RFC-007 rules API remains intact; this RFC adds identity data consumed by
the same compiler.

## Validation rules

Minimum required checks:

- unknown peer in `principals.json` -> reject
- unknown tag/owner selector in policy -> reject
- duplicate/empty tags -> reject
- unauthorized restricted-tag assignment -> reject
- governance config references unknown owners -> reject

## Migration plan

### Phase 1 — additive

- introduce `principals.json` and parser/validation
- no rule syntax changes required yet
- compile output remains unchanged for existing policies

### Phase 2 — selector adoption

- allow `tag:*` and `owner:*` selectors in policy
- update docs/examples
- keep existing group-based selectors for backward compatibility

### Phase 3 — governance enforcement

- enforce `tagOwners` on mutating API paths
- add tests for unauthorized assignments

## Security considerations

- default to deny on unresolved identity selectors
- avoid implicit fallbacks from unknown `tag:*`/`owner:*` to literal peer names
- treat principals/governance files as policy-critical artifacts (same review
  rigor as policy rules)

## Operational impact

- low runtime cost (selector expansion during compile time)
- moderate authoring complexity increase
- substantial improvement in policy clarity and auditability

## Related

- [RFC-007 — Dynamic WireGuard Peer Access Control](./RFC-007-Dynamic-WireGuard-Peer-Access-Control.md)
- [RFC-005 — Per-Client Access Restriction](./RFC-005-per-client-access-restriction.md)
