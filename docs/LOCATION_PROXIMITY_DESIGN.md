# Location → Proximity → Cell-Pairing — Privacy & Design (DRAFT for sign-off)

> **Status: NOT BUILT.** This is a design for review. Because location is sensitive personal
> data on a population that **includes minors**, nothing is built until the decisions in §8 are
> signed off. Parity gap #4. Designed privacy-first, data-minimizing, server-authoritative,
> human-in-the-loop.

## 1. Goal
Let members **opt in** to share a *coarse* location so leaders can **suggest grouping
geographically-near members into the same cell/group**. Suggestions only — a leader reviews and
approves; the system never auto-moves anyone, and never groups minors automatically.

## 2. Principles (non-negotiable)
- **Opt-in, default OFF.** No location is collected unless the member explicitly turns it on.
- **Data minimization.** Store the *coarsest* useful location, never precise coordinates, never
  movement history — only a single last-known coarse area, overwritten on update.
- **Minors protected.** Minors are excluded from proximity matching by default (see §8).
- **Server-authoritative + human-in-the-loop.** Pairing is a *suggestion* a leader approves.
- **RBAC.** Only specific admin/leader roles can see proximity suggestions; no member ever sees
  another member's location.
- **Revocable + deletable.** Opt-out or account deletion erases the stored location immediately.

## 3. What we collect (coarse only — pick one in §8)
| Option | What's stored | Precision | Privacy |
|---|---|---|---|
| **A — Geohash-6 (recommended)** | a 6-char geohash | ~1.2 km cell | Good: ~1 km bucket, not a point; clusters cleanly |
| B — Neighborhood/city label | free-text area or city | very coarse | Highest privacy, but weaker clustering |
| C — Rounded lat/lng (2 dp) | ~1.1 km rounded coords | ~1.1 km | Still point-like / re-identifiable; least preferred |

We compute proximity **server-side** and **never return raw coordinates/geohash to any client** —
only "these members are near each other (≈ within X km)".

## 4. Storage
New table `member_location`:
`user_id (PK, FK users)`, `geohash6` *or* `area_label`, `consent_at TIMESTAMPTZ`,
`updated_at TIMESTAMPTZ`. **One row per member, overwritten** (no trail). Cleared on opt-out /
delete. No background/continuous tracking — location is sent only when the member opts in and
occasionally refreshes (e.g. on app open while consent is on).

## 5. Consent & minors
- **Mobile:** an explicit opt-in toggle (Profile / onboarding) with plain-language explanation
  ("Help us connect you with believers near you"), default OFF, revocable. Sends coarse location
  only while ON.
- **Minors (`users.is_minor`):** by default **excluded entirely** — not collected, not matched,
  not shown. (Alternative: guardian-consent-gated — see §8.) A minor's location is *never* shown
  to other members or used in suggestions visible to peers.

## 6. Access (RBAC)
- A dedicated permission (e.g. `members:proximity`) gates the proximity-suggestions view.
- Only Admin / authorized leaders see **suggestions** (coarse "near each other" + approx distance).
- **No member-facing location UI** — members never see where others are.

## 7. Proximity → pairing (algorithm, server-side)
1. Candidate set = members who **opted in**, are **not minors** (per §8), and are
   **unassigned or movable** to a cell.
2. Cluster by geohash adjacency / haversine distance within a configurable radius (e.g. 3 km).
3. Emit **suggestions**: "N members near {coarse area} — consider a cell here," with the member
   list and approximate distances. **Never auto-create or auto-move.**
4. A leader **reviews + approves** in the admin UI (web + iPad) to form/assign the cell. Minors
   are never auto-grouped; any change to a minor follows existing guardian/consent rules.

## 8. DECISIONS — SIGNED OFF 2026-06-30
1. **Coarseness:** ✅ **Geohash-6 (~1.2 km).** Store a 6-char geohash; never return raw
   geohash/coords to any client — only "near each other (≈ within X km)".
2. **Minors:** ✅ **Guardian-consent-gated.** A minor's coarse location is collected **only after
   a guardian grants an explicit, location-specific consent** (see §8a). Never shown to peers;
   minors' pairing suggestions are visible **only to Admin** (not field/leader roles). Revoking
   the guardian consent (or the member opting out) erases the stored location immediately.
3. **Who sees suggestions:** Admin + senior leader roles (national/regional coaches) for adults;
   **minors → Admin only**. Gated by a new `members:proximity` permission.
4. **Match radius:** default **3 km** (configurable).
5. **Suggestions only, leader-approved** (no auto-grouping, minors never auto-grouped): ✅ yes.

### 8a. Guardian-consent-for-location (the minors path)
- Adds a **distinct consent type** (e.g. `location_sharing`) to the existing guardian-consent
  system — separate from general onboarding consent, separately grantable and **revocable**.
- A minor's location ingest is **rejected** unless an active `location_sharing` guardian consent
  exists for that member. No consent → no collection, even if the toggle is on.
- Audit: who granted/revoked, when. Revocation triggers immediate deletion of `member_location`.
- **Compliance flag for the owner:** collecting any minor location (even coarse, even with
  guardian consent) carries heightened data-protection obligations (e.g. Kenya DPA / COPPA-like
  rules). Confirm you're comfortable operating this; "fully excluded" remains a one-flag fallback
  if you'd rather not hold minor-location data at all.

## 9. Build plan (now that §8 is signed off)
1. **Backend (no mobile, safe):** `member_location` table; opt-in ingest endpoint (rejects
   minors lacking `location_sharing` consent); the `location_sharing` consent type + grant/revoke;
   geohash clustering + an RBAC-gated **suggestions** endpoint (adults to coaches+, minors to
   Admin only); migration + tests; OpenAPI. Deploy.
2. **Mobile (needs a release):** member opt-in toggle (default off) + guardian `location_sharing`
   consent UI; coarse foreground-only location send while consent is on.
3. **Web + iPad (admin):** a "Suggested pairings / nearby" review-and-approve view; no raw coords.

## 9. Surfaces (once signed off)
- **Backend:** `member_location` table + opt-in/ingest endpoint + clustering + an admin
  suggestions endpoint (RBAC-gated). Migration + tests. (Contract-first.)
- **Mobile:** consent toggle + coarse-location send (needs a mobile release; uses the platform
  location API with foreground-only, coarse accuracy).
- **Web + iPad (admin):** a "Nearby / suggested pairings" view to review + approve. No raw
  coordinates shown.
- **Out of scope:** continuous tracking, movement history, precise coordinates, background
  location, any member-to-member location sharing.
