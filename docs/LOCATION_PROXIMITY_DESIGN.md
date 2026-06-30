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

## 8. DECISIONS NEEDED (sign-off)
1. **Coarseness** — Option **A (geohash ~1.2 km, recommended)**, B (city/neighborhood), or C
   (rounded coords)?
2. **Minors** — **fully excluded (recommended)** or guardian-consent-gated (collected only with a
   guardian's explicit consent, still never shown to peers)?
3. **Who can see suggestions** — Admin + which leader roles (e.g. regional/national coaches)?
4. **Match radius** — default cluster radius (e.g. **3 km**)?
5. Confirm **suggestions only, leader-approved** (no auto-grouping) — yes?

## 9. Surfaces (once signed off)
- **Backend:** `member_location` table + opt-in/ingest endpoint + clustering + an admin
  suggestions endpoint (RBAC-gated). Migration + tests. (Contract-first.)
- **Mobile:** consent toggle + coarse-location send (needs a mobile release; uses the platform
  location API with foreground-only, coarse accuracy).
- **Web + iPad (admin):** a "Nearby / suggested pairings" view to review + approve. No raw
  coordinates shown.
- **Out of scope:** continuous tracking, movement history, precise coordinates, background
  location, any member-to-member location sharing.
