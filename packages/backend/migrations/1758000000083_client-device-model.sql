-- Capture the device model on registration (parity gap #2). Nullable, free-form
-- string (e.g. "iPhone 17 Pro Max", "Pixel 9", "iPad Pro 13"). Older clients omit
-- it, so it stays NULL until a model-aware client registers. Analytics treats a
-- non-null row as the signal that model capture is live (model_capture: true).

-- Up Migration

ALTER TABLE client_devices ADD COLUMN model VARCHAR(80);

-- Down Migration

ALTER TABLE client_devices DROP COLUMN IF EXISTS model;
