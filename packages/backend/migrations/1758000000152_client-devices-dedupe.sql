-- The device census: registerDevice was a plain INSERT and clients call it on
-- every launch, so client_devices grew one row per launch and the analytics
-- version breakdown counted a member once per version they EVER ran. Collapse
-- to one row per (user, platform, model) — keeping the newest — and let
-- registration upsert from now on. `model` is NULLable, so the unique index
-- coalesces it ('' sentinel) rather than allowing infinite NULL duplicates.

-- Up Migration
DELETE FROM client_devices cd
 USING client_devices newer
 WHERE newer.user_id = cd.user_id
   AND newer.platform = cd.platform
   AND COALESCE(newer.model, '') = COALESCE(cd.model, '')
   AND newer.device_id <> cd.device_id
   AND (COALESCE(newer.last_seen_at, 'epoch'), newer.device_id) >
       (COALESCE(cd.last_seen_at, 'epoch'), cd.device_id);

CREATE UNIQUE INDEX client_devices_user_platform_model_key
  ON client_devices (user_id, platform, COALESCE(model, ''));

-- Down Migration
DROP INDEX IF EXISTS client_devices_user_platform_model_key;
