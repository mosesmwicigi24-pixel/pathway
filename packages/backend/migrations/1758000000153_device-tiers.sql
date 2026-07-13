-- Congregational economics: a curated handset→tier lookup so device models
-- (already in client_devices) can be read as an AGGREGATE capacity proxy.
-- Ethics contract (leadership brief §4): tiers feed congregation-level
-- distributions and care signals only — never a per-member wealth label.
-- Matching is by ILIKE prefix pattern, longest pattern wins; unmatched
-- models report as 'unclassified' (honest, not guessed).

-- Up Migration
CREATE TABLE device_tiers (
  pattern TEXT PRIMARY KEY,               -- ILIKE pattern against client_devices.model
  tier    TEXT NOT NULL CHECK (tier IN ('entry','mid','premium')),
  note    TEXT
);

INSERT INTO device_tiers (pattern, tier, note) VALUES
  -- Entry / financed (pay-as-you-go or sub-KES-15k)
  ('M-KOPA%',   'entry',   'financed pay-as-you-go'),
  ('TECNO%',    'entry',   NULL),
  ('Infinix%',  'entry',   NULL),
  ('itel%',     'entry',   NULL),
  ('SM-A0%',    'entry',   'Samsung Galaxy A0x'),
  ('SM-A1%',    'entry',   'Samsung Galaxy A1x'),
  ('SM-A2%',    'entry',   'Samsung Galaxy A2x'),
  ('SM-A3%',    'entry',   'Samsung Galaxy A3x'),
  ('Nokia%',    'entry',   NULL),
  ('Vision%',   'entry',   'Safaricom Neon/Vision'),
  ('Neon%',     'entry',   'Safaricom Neon'),
  ('iPhone7%',  'entry',   'iPhone 6s/7-era identifiers'),
  ('iPhone8%',  'entry',   NULL),
  ('iPhone9%',  'entry',   NULL),
  ('iPhone10%', 'entry',   'iPhone 8/X-era'),
  -- Mid
  ('SM-A5%',    'mid',     'Samsung Galaxy A5x'),
  ('SM-A7%',    'mid',     NULL),
  ('SM-M%',     'mid',     'Samsung Galaxy M'),
  ('Redmi%',    'mid',     NULL),
  ('2%',        'mid',     'Xiaomi/Redmi numeric model codes (e.g. 24117RN76G)'),
  ('M2%',       'mid',     'Xiaomi legacy codes'),
  ('CPH%',      'mid',     'OPPO'),
  ('V2%',       'mid',     'vivo'),
  ('moto%',     'mid',     NULL),
  ('iPhone11%', 'mid',     'iPhone XR/XS-era'),
  ('iPhone12%', 'mid',     'iPhone 11-era'),
  ('iPhone13%', 'mid',     'iPhone 12/13-era'),
  ('iPhone14%', 'mid',     'iPhone 13/14-era'),
  -- Premium
  ('Pixel%',    'premium', NULL),
  ('SM-S9%',    'premium', 'Samsung Galaxy S ultra-class'),
  ('SM-S92%',   'premium', NULL),
  ('SM-N%',     'premium', 'Samsung Note'),
  ('SM-F%',     'premium', 'Samsung Fold/Flip'),
  ('iPhone15%', 'premium', 'iPhone 14 Pro-era identifiers'),
  ('iPhone16%', 'premium', 'iPhone 15/16-era'),
  ('iPhone17%', 'premium', 'iPhone 16/17-era'),
  ('iPhone18%', 'premium', 'iPhone 17-era'),
  ('iPhone %',  'premium', 'marketing-name strings (e.g. "iPhone 17 Pro Max")'),
  ('iPad%',     'premium', NULL),
  ('OnePlus%',  'premium', NULL);

-- Down Migration
DROP TABLE IF EXISTS device_tiers;
