-- BudgetLens D1 Schema: budgetlens-app migration 0002 (EXIF-scrubbed Citizen Field Photos)
-- Note: Cloudflare D1 forbids explicit BEGIN TRANSACTION / COMMIT inside migration files.

CREATE TABLE IF NOT EXISTS tip_photos (
  filename TEXT PRIMARY KEY,
  tip_id TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  data_base64 TEXT NOT NULL,
  created_at_iso TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tip_photos_tip ON tip_photos(tip_id);
