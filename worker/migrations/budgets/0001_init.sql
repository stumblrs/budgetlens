-- BudgetLens D1 Schema: budgetlens-budgets (559k+ Federal Budget Line Items + FTS5 + Annual Stats)
-- Note: Cloudflare D1 forbids explicit BEGIN TRANSACTION / COMMIT inside migration files.

CREATE TABLE IF NOT EXISTS budget_records (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  financial_year INTEGER NOT NULL,
  president TEXT NOT NULL,
  project_code TEXT NOT NULL,
  project_name TEXT NOT NULL,
  mda_code TEXT NOT NULL DEFAULT '',
  mda_name TEXT NOT NULL,
  sector TEXT NOT NULL,
  spending_type TEXT NOT NULL,
  amount_naira INTEGER NOT NULL,
  pdf_page INTEGER NOT NULL,
  source_filename TEXT NOT NULL,
  sha256_hash TEXT NOT NULL,
  geo_zone TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,
  lga TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'none',
  lineage_id TEXT,
  forensic_flags_json TEXT NOT NULL DEFAULT '[]',
  asset_tokens_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_records_year_amt ON budget_records(financial_year, amount_naira DESC);
CREATE INDEX IF NOT EXISTS idx_records_mda_year ON budget_records(mda_name, financial_year);
CREATE INDEX IF NOT EXISTS idx_records_sector_year ON budget_records(sector, financial_year);
CREATE INDEX IF NOT EXISTS idx_records_state_year ON budget_records(state, financial_year);
CREATE INDEX IF NOT EXISTS idx_records_sev_amt ON budget_records(severity, amount_naira DESC);
CREATE INDEX IF NOT EXISTS idx_records_code ON budget_records(project_code);
CREATE INDEX IF NOT EXISTS idx_records_lineage ON budget_records(lineage_id);
CREATE INDEX IF NOT EXISTS idx_records_pres_amt ON budget_records(president, amount_naira DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS budget_fts USING fts5(
  project_name,
  mda_name,
  project_code,
  sector,
  state,
  content='budget_records',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TABLE IF NOT EXISTS year_statistics (
  financial_year INTEGER PRIMARY KEY,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
