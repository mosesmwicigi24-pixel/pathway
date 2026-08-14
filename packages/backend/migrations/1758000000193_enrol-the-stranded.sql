-- Migration 193 · Put the stranded on the pathway
-- ============================================================================
-- Audit, 2026-08-14. Twenty-eight members hold an account and no enrollment.
-- The longest has waited 42 days. They have no level, no module, no Pathway
-- tab worth opening — and the app told them "Level 1" the whole time, because
-- the profile screen falls back to `?? 1` when there is no enrollment to read.
--
-- This is not a leader forgetting. It is architectural:
--
--   * `POST /v1/me/onboarding` is the only self-service path that creates an
--     enrollment. `SELECT count(*) FROM audit_log WHERE action='user.onboarded'`
--     returns 0. It has never run in production, because no client calls it —
--     the only "onboarding" in either app is location sharing.
--   * All 47 existing enrollments came from `enrollment.start_set`, the portal's
--     admin action. So the pathway is reachable only if a human opens the portal
--     and sets a start level for you.
--   * Nothing lists who is waiting for that. The queue is invisible.
--
-- The correlation is exact: every member with a cell has an enrollment, every
-- member without one does not, 28/28 and 43/43. Yesterday's migration 190 gave
-- these same people a default congregation so the liturgy would compose for
-- them. That fixed what they READ and not what they ARE — the symptom, not the
-- fault. This is the other half.
--
-- Level 1 / active is the ordinary entry point and what the (never-called)
-- onboarding endpoint would have granted them. A leader can still raise anyone's
-- start level afterwards through the portal, exactly as before; enrollments
-- carries start_level and start_module_sequence for that. Nobody is skipped
-- ahead, and nobody is held back any longer.

-- Up Migration

INSERT INTO enrollments (user_id, current_level, state)
SELECT u.user_id, 1, 'active'
  FROM users u
 WHERE u.deleted_at IS NULL
   AND u.role = 'Student'
   AND NOT EXISTS (SELECT 1 FROM enrollments en WHERE en.user_id = u.user_id);

-- The nudge cadence reads this row; a member without one is invisible to it.
INSERT INTO notification_preferences (user_id)
SELECT u.user_id FROM users u
 WHERE u.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM notification_preferences np WHERE np.user_id = u.user_id)
ON CONFLICT DO NOTHING;

-- Down Migration
-- Deliberately empty. Reversing would strip members of a pathway they can by
-- then have walked — completed modules, reflections, a level score. A down
-- migration that destroys member progress is worse than one that declines to
-- act, and nothing here is structural: it is rows for people who should always
-- have had them.
