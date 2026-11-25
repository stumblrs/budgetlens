-- BudgetLens D1 Schema: budgetlens-ledgers (NOCOPO, Open Treasury, OAuGF, Policy, BIR OCR + FTS5)
-- Note: Cloudflare D1 forbids explicit BEGIN TRANSACTION / COMMIT inside migration files.

CREATE TABLE IF NOT EXISTS nocopo_contracts (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  ocid TEXT NOT NULL UNIQUE,
  financial_year INTEGER,
  stage TEXT,
  title TEXT,
  mda_name TEXT,
  norm_mda TEXT,
  buyer_admin_code TEXT,
  contractor_name TEXT,
  norm_contractor TEXT,
  bpp_contractor_id TEXT,
  cac_rc_number TEXT,
  contract_award_naira INTEGER,
  total_paid_naira INTEGER,
  award_date TEXT,
  procurement_method TEXT,
  budget_record_id TEXT,
  project_code TEXT,
  match_type TEXT,
  confidence_score REAL,
  source_file TEXT
);

CREATE INDEX IF NOT EXISTS idx_nocopo_year ON nocopo_contracts(financial_year);
CREATE INDEX IF NOT EXISTS idx_nocopo_stage ON nocopo_contracts(stage);
CREATE INDEX IF NOT EXISTS idx_nocopo_norm_contractor ON nocopo_contracts(norm_contractor);
CREATE INDEX IF NOT EXISTS idx_nocopo_norm_mda ON nocopo_contracts(norm_mda);

CREATE VIRTUAL TABLE IF NOT EXISTS nocopo_fts USING fts5(
  ocid,
  title,
  mda_name,
  contractor_name,
  bpp_contractor_id,
  project_code,
  content='nocopo_contracts',
  content_rowid='rowid'
);

CREATE TABLE IF NOT EXISTS govspend_payments (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_no TEXT NOT NULL UNIQUE,
  payment_date TEXT,
  financial_year INTEGER,
  payer_code TEXT,
  organization_name TEXT,
  norm_mda TEXT,
  beneficiary_name TEXT,
  norm_beneficiary TEXT,
  amount_naira INTEGER,
  description TEXT
);

CREATE INDEX IF NOT EXISTS idx_govspend_year ON govspend_payments(financial_year);
CREATE INDEX IF NOT EXISTS idx_govspend_payer ON govspend_payments(payer_code);
CREATE INDEX IF NOT EXISTS idx_govspend_norm_ben ON govspend_payments(norm_beneficiary);
CREATE INDEX IF NOT EXISTS idx_govspend_norm_mda ON govspend_payments(norm_mda);

CREATE VIRTUAL TABLE IF NOT EXISTS govspend_fts USING fts5(
  payment_no,
  organization_name,
  beneficiary_name,
  description,
  payer_code,
  content='govspend_payments',
  content_rowid='rowid'
);

CREATE TABLE IF NOT EXISTS oaugf_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL,
  doc_title TEXT NOT NULL,
  category TEXT NOT NULL,
  audit_years TEXT NOT NULL,
  primary_year INTEGER,
  page_number INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  source_url TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  chunk_text TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oaugf_doc ON oaugf_chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_oaugf_year ON oaugf_chunks(primary_year);

CREATE VIRTUAL TABLE IF NOT EXISTS oaugf_fts USING fts5(
  doc_title,
  category,
  chunk_text,
  content='oaugf_chunks',
  content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TABLE IF NOT EXISTS policy_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_slug TEXT NOT NULL,
  doc_title TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  fiscal_year_start INTEGER,
  fiscal_year_end INTEGER,
  page_number INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  chunk_text TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_policy_slug ON policy_chunks(doc_slug);
CREATE INDEX IF NOT EXISTS idx_policy_type ON policy_chunks(doc_type);

CREATE VIRTUAL TABLE IF NOT EXISTS policy_fts USING fts5(
  doc_title,
  doc_type,
  chunk_text,
  content='policy_chunks',
  content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TABLE IF NOT EXISTS bir_ocr_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_file TEXT NOT NULL,
  financial_year INTEGER NOT NULL,
  page_number INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  chunk_text TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bir_ocr_year ON bir_ocr_chunks(financial_year);

CREATE VIRTUAL TABLE IF NOT EXISTS bir_ocr_fts USING fts5(
  doc_file,
  chunk_text,
  content='bir_ocr_chunks',
  content_rowid='id',
  tokenize='porter unicode61'
);
