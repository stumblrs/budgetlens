-- BudgetLens D1 Schema: budgetlens-app (Precomputed Summaries, Shards, Citizen Tips & Casebooks)
-- Note: Cloudflare D1 forbids explicit BEGIN TRANSACTION / COMMIT inside migration files.

CREATE TABLE IF NOT EXISTS app_datasets (
  dataset_key TEXT PRIMARY KEY,
  chunk_count INTEGER NOT NULL DEFAULT 1,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  payload_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_dataset_chunks (
  dataset_key TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  PRIMARY KEY (dataset_key, chunk_index)
);

CREATE TABLE IF NOT EXISTS bill_act_diffs (
  financial_year INTEGER PRIMARY KEY,
  summary_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bill_act_diff_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  financial_year INTEGER NOT NULL,
  mda_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  is_zip INTEGER NOT NULL DEFAULT 0,
  delta_naira INTEGER NOT NULL DEFAULT 0,
  item_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bad_year_status ON bill_act_diff_items(financial_year, status);

CREATE TABLE IF NOT EXISTS contractor_dossiers (
  contractor_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  contract_count INTEGER NOT NULL DEFAULT 0,
  total_awarded_naira INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contractor_awarded ON contractor_dossiers(total_awarded_naira DESC);

CREATE TABLE IF NOT EXISTS oaugf_findings (
  finding_id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  financial_year INTEGER,
  mda_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  amount_naira INTEGER NOT NULL DEFAULT 0,
  item_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oaugf_findings_year ON oaugf_findings(financial_year);
CREATE INDEX IF NOT EXISTS idx_oaugf_findings_mda ON oaugf_findings(mda_name);

CREATE TABLE IF NOT EXISTS citizen_tips (
  tip_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  financial_year INTEGER NOT NULL,
  project_code TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  lga TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  observation TEXT NOT NULL,
  reporter_alias TEXT NOT NULL DEFAULT 'Anonymous Citizen',
  photos_json TEXT NOT NULL DEFAULT '[]',
  corroborations INTEGER NOT NULL DEFAULT 0,
  moderation_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  moderation_note TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL,
  created_at_iso TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tips_created ON citizen_tips(created_at_iso DESC);
CREATE INDEX IF NOT EXISTS idx_tips_moderation ON citizen_tips(moderation_status);
CREATE INDEX IF NOT EXISTS idx_tips_project_year ON citizen_tips(project_id, financial_year);
CREATE INDEX IF NOT EXISTS idx_tips_state ON citizen_tips(state);

CREATE TABLE IF NOT EXISTS tip_rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  created_epoch REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_ip_epoch ON tip_rate_limits(ip_hash, created_epoch);

CREATE TABLE IF NOT EXISTS casebooks (
  casebook_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  share_token TEXT UNIQUE,
  payload_json TEXT NOT NULL,
  created_at_iso TEXT NOT NULL,
  updated_at_iso TEXT NOT NULL
);
