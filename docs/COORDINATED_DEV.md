# Coordinated Cross-Surface Development

> **Standing rule.** Every dev/feature instruction is executed as a **coordinated change across
> all affected surfaces in one working session** — not on one surface in isolation. This is the
> default, not a special mode. Governed by [PARITY.md](./PARITY.md),
> [CONTRACTS.md](../CONTRACTS.md), and the [Definition of Done](./CROSS_SURFACE_DOD.md).

## The two projects (both live on this machine, both editable in one session)

| Project | Path | Surfaces |
|---|---|---|
| **pathway** (monorepo) | `/Users/mwicigi/Claude/Projects/pathway` | `@nuru/backend`, `@nuru/admin-web` (web portal), `@nuru/mobile`, `@nuru/shared`, OpenAPI |
| **pathwayforipad** | `/Users/mwicigi/Claude/Projects/iphone` | native SwiftUI iPad app (`ios-native/NuruPortal`) |

## Protocol — run for every dev instruction

**1 · Scope.** Decide which surfaces the instruction touches. Use the audience model:
admin features → **web + iPad**; member features → **mobile**; shared concerns (contract,
types, tokens, terminology) → ripple to **all**. Record the intended surface set up front
(state it back to the user). A surface that's intentionally untouched is **"N/A — reason"**.

**2 · Contract-first.** If the change touches the wire contract or data shapes:
backend (`packages/backend`) **first**, then update **OpenAPI**
(`packages/shared/src/openapi/openapi.yaml`) and **`@nuru/shared`** types, then the clients.
Pure presentation changes skip this. Never reimplement gating/scoring/money client-side.

**3 · Implement per surface** (fan out; the surfaces are independent files/repos):
- **Backend** — endpoint + migration + Vitest.
- **Web** — `packages/admin-web`.
- **Mobile** — `packages/mobile` (offline-safe).
- **iPad** — `ios-native/NuruPortal` in the other repo.
- **Tokens** — only from `packages/mobile/src/theme/tokens.ts`; the iPad theme derives from it.

**4 · Verify each affected surface (both projects must build):**
- Monorepo: `pnpm typecheck && pnpm lint && pnpm test` (backend boots embedded Postgres) and `pnpm openapi:lint` if the contract changed.
- iPad: `xcodebuild` simulator build, then signed device build; install on the iPad
  (device id `1BF53D62-FA87-5A56-8F98-1179256326A1`, bundle `org.nuruplace.portal`) when shipping.

**5 · Definition of Done** — fill the checklist in [CROSS_SURFACE_DOD.md](./CROSS_SURFACE_DOD.md);
every row ✅ or **N/A — reason**. Backward-compatible/additive API only.

**6 · Coordinated commits.** One ticket id. A branch in **each** repo that changed; commit per
repo; push branches; the PR descriptions cross-link (same ticket) and carry the DoD checklist.
Update [PARITY.md](./PARITY.md) in the same change.

## How this runs in practice

- Within one session I edit and build **both** repos (they're both on disk). For breadth I fan
  out parallel sub-agents per surface, each owning non-overlapping files, then integrate.
- The blast radius is always stated: which surfaces changed, which are N/A and why. A
  client-only change consuming an existing endpoint touches **one** surface; a contract change
  touches **all**.
- "Both projects run" means each **affected** surface is built/verified before it's called done
  — web/mobile/backend via the pnpm checks, iPad via xcodebuild (+ device install when shipping).

## Quick reference — verification commands

```bash
# Monorepo (web + mobile + backend + shared)
cd /Users/mwicigi/Claude/Projects/pathway
pnpm typecheck && pnpm lint && pnpm test
pnpm openapi:lint            # when the wire contract changed

# iPad (separate repo)
cd /Users/mwicigi/Claude/Projects/iphone/ios-native
xcodebuild -project NuruPortal.xcodeproj -scheme NuruPortal -configuration Debug \
  -destination 'platform=iOS Simulator,id=<ipad-sim-id>' \
  -derivedDataPath <scratch>/dd CODE_SIGNING_ALLOWED=NO build
```
