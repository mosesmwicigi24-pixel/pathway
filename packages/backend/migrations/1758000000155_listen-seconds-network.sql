-- C-layer close-out (leadership brief):
--   • radio_listeners.listen_seconds — real listening time, accumulated by the
--     EXISTING ~20s player heartbeat (elapsed-since-last-beat, capped at 60s so
--     a resumed session can't inflate).
--   • client_devices.network — wifi/cellular sampled at device registration,
--     the data-cost-burden signal for entry-tier members.

-- Up Migration
ALTER TABLE radio_listeners ADD COLUMN listen_seconds INT NOT NULL DEFAULT 0;
ALTER TABLE client_devices ADD COLUMN network VARCHAR(12);

-- Down Migration
ALTER TABLE client_devices DROP COLUMN IF EXISTS network;
ALTER TABLE radio_listeners DROP COLUMN IF EXISTS listen_seconds;
