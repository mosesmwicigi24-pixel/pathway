# Cross-Surface Definition of Done (PR checklist)

Paste this into every PR that touches a feature, on **both** repos (`pathway` and
`pathwayforipad`). A change is **done** only when each row is ✅ or an explicit **N/A — reason**.
See [PARITY.md](./PARITY.md) for the audience model and [CONTRACTS.md](../CONTRACTS.md) for the
endpoint map.

```md
### Cross-surface DoD  —  ticket: NURU-____

**Change summary:** <one line>

| Surface | Done means | Status |
|---|---|---|
| `@nuru/backend`     | endpoint + migration + Vitest pass               | ☐ / N/A: |
| **OpenAPI**         | `packages/shared/src/openapi/openapi.yaml` updated; `pnpm openapi:lint` ✅; route-conformance test ✅ | ☐ / N/A: |
| `@nuru/shared`      | types/enums/DTOs updated (no client redefines them) | ☐ / N/A: |
| **Web** (`admin-web`) | implemented + builds                            | ☐ / N/A: |
| **Mobile** (`mobile`) | implemented + builds (offline-safe)             | ☐ / N/A: |
| **iPad** (`pathwayforipad`) | implemented + sim & signed-device build clean | ☐ / N/A: |
| **Tokens**          | brand/spacing/type only from `tokens.ts` (no raw hex; iPad theme derived) | ☐ / N/A: |
| **Terminology**     | shared words (Cell not Cohort, …); glossary updated if new | ☐ / N/A: |
| **Backward-compat** | additive only — no field a deployed client reads was removed/renamed | ☐ |
| **PARITY.md**       | matrix row updated (and Drift register if intentional gap) | ☐ |
| **Linked PR**       | sibling PR in the other repo, same ticket id     | ☐ / N/A (single-repo) |
```

## Why "N/A" is allowed

The surfaces are **two products** (admin: web+iPad · member: mobile). A reconciliation screen
is admin-only; a prayer journal is member-only. "N/A — member-only" or "N/A — admin-only" is a
*decision*, recorded — not an accident. What we never allow is a surface silently falling
behind on a feature it *should* have.

## Guardrails this enforces (from the spec)

- Server-authoritative **gating / scoring / money** — clients display, never decide.
- **Idempotency** on offline-originated writes; replays are no-ops.
- **Hard-lock invariant** — no path returns higher-level content to a lower-level member.
- **Money path is PCI SAQ-A** — cards never touch the server; clients are read-only over the ledger.
- **RBAC + scoping** — enforced in the query layer, not the client.
