# BudgetLens Phase 8 — Pre-Migration Backend Hand-Off Specification

> **Status:** `FROZEN & SIGNED OFF AT P7-CP-6`  
> **Hand-Off Date:** `2026-11-24`  
> **Predecessor:** [PHASE7_DATA_HYGIENE_AND_PRESENTATION_HARDENING_ROADMAP.md](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/PHASE7_DATA_HYGIENE_AND_PRESENTATION_HARDENING_ROADMAP.md) (`Completed`)  
> **Live Static Corpus Audited:** `1,071.27 MB` across `284` files in `public/datasets/` + `572.41 MB` across `3` SQLite stores in `backend/data/`

---

## 1. Post-Phase-7 Corpus & SQLite Inventory

Every static artifact below was deterministically rebuilt and verified with zero residual `"TEST MINISTRY - NOCOPO"` primary-leaderboard leaks, zero `"10,250,000"` numeric MDA keys, and zero `Ä»` mojibake sequences before schema freeze:

| Payload Group | On-Disk Location | Measured Footprint | Record / Row Volume & Notes |
|---|---|---|---|
| **Year-Partitioned Appropriation JSONs & DB Exports** | `public/datasets/{1999..2026}/`, `public/datasets/db/{1999..2026}/` | `203.48 MB` (`56` files) + `602.46 MB` (`29` files) | `559,638` indexed records (`₦240.12T` nominal, `28` years `1999–2026`); coverage: `19` `FULL_SCHEDULE`, `3` `PARTIAL_SCHEDULE`, `6` `SUMMARY_ACT_ONLY` |
| **Client-Side AI & Search Monoliths** | `public/datasets/ai_knowledge_base.json`, `search_index_top.json`, `recurring_lineages.json` | `115.72 MB` + `1.38 MB` + `7.03 MB` | Primary mobile bandwidth bottleneck targeted for elimination (>95% reduction) via server-side FTS5 / PostgreSQL `tsvector` pagination |
| **Bill-vs-Act & Lifecycle Shards** | `bill_act_diffs/` (`8` files), `project_lifecycle/` (`64` shards + `0.66 MB` index) | `6.37 MB` + `82.76 MB` | `40,683` linked project lifecycles (`3,121` Paid-on-Paper, `20,674` legislative diffs, `3,107` NOCOPO awards) |
| **Contractor History & Procurement Risk** | `contractor_history/` (`64` shards), `contractors_leaderboard.json`, `procurement_risk_index.json`, `vendor_network_index.json`, `follow_the_money_links.json` | `28.89 MB` + `2.54 MB` + `0.29 MB` + `0.25 MB` + `0.37 MB` | `16,536` awarded OCDS releases (`82,140` planning rows excluded; `190` sandbox test rows & `25` kobo/decimal typos quarantined in `portalDataEntryAnomalies`); `9,511` normalized contractors (`15,309` contracts); `25,680` off-NOCOPO private vendors |
| **Open Treasury Cash Forensics & Execution** | `govspend_forensics.json`, `execution_tracker.json`, `macro_credibility_tracker.json` | `0.12 MB` + `0.22 MB` + `0.02 MB` | `467,763` valid Treasury vouchers (`₦47.53T`); `18` BIR/OAGF cycles (`2009–2026`) with FY `2013`/`2014 Q2`/`2015` integrity guards |
| **OAuGF Constitutional Audit & Cross-Ledger Convergence** | `oaugf_audit_index.json` + `oaugf_issues/` (`7` shards), `mda_integrity_scorecards.json`, `red_flag_convergence_index.json`, `evidence_engine_all_years.json`, `forensic_sweep_1999_2026.json`, `geo_intelligence_index.json`, `asset_inventory_index.json`, `statistical_forensics_1999_2026.json`, `source_provenance.json` | `1.81 MB` + `4.10 MB` + `0.35 MB` + `0.26 MB` + `2.38 MB` + `5.34 MB` + `0.62 MB` + `2.60 MB` + `0.39 MB` | `6,978` scrubbed OAuGF audit findings (`36` reports, `11,372` pages, Doc `41` flagged `SCANNED_IMAGE_BODY_PENDING_OCR`); `250/803` scored MDAs; `50,422` Evidence Engine v3.0 findings (`3,342` duplicate clusters); `468` source PDFs SHA-256 verified |
| **Existing FastAPI SQLite Backends** | [budgetlens_fts.sqlite](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/backend/data/budgetlens_fts.sqlite), [external_ledger_fts.sqlite](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/backend/data/external_ledger_fts.sqlite), [citizen_tips.sqlite](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/backend/data/citizen_tips.sqlite) | `225.16 MB` + `347.21 MB` + `0.04 MB` | `budget_records` (`559,325`), `nocopo_contracts` (`98,866`), `govspend_payments` (`467,763`), `policy_chunks` (`3,214`), `bir_ocr_chunks` (`1,247`), `oaugf_chunks` (`20,465`), `citizen_tips` (`WAL`) |

---

## 2. Frozen Phase 7 Pre-Migration Hygiene Guarantees

Backend ETL / DB ingestion MUST preserve every invariant established across `P7-CP-1` through `P7-CP-6`:

1. **Canonical Entity Foreign Keys (`entity_normalizer.py`):**
   - `is_valid_mda_name()` rejects purely numeric/currency strings (`"10,250,000"`).
   - `normalize_entity_name()` + `canonical_contractor_key()` repair `Ä»` / Windows-1252 mojibake, PDF typos (`UNIVERSITYOF`, `MANAGEMANT`, `HEADQURTERS`, `MINSITRY`), wrapped trailing connectors (`SCIENCE, TECHNOLOGY AND`), `MOD` variants, and corporate legal suffix aliases (`ADROIT LANDSTYLE LTD` / `ADROIT - LAND STYLE LTD`).
2. **Non-Destructive Quarantine Over Silent Deletion:**
   - Sandbox test entries (`TEST MINISTRY - NOCOPO`, `"test"` titles) and exact `100x`/`1,000x`/`10,000x` decimal-shift portal errors are excluded from headline KPIs and MDA risk rankings (`is_sandbox_or_test_procurement`, `classify_overrun_anomaly`) while remaining queryable in `procurement_quarantined_anomalies`.
   - Raw PDF drops, `ingestion/checkpoints_data/`, and `ingestion/ocr_cache/` remain strictly untouched.
3. **Payroll & Statutory Cash Separation:**
   - Open Treasury `IPPIS`, military/police Finance Corps allowances (`HQ NIGERIAN ARMY FINANCE CORPS`), `SAL` payroll tags, pensions, and `TSA` remittances (`is_payroll_or_statutory_voucher`) are isolated from commercial 7-day splitting alerts and short-string opaque voucher flags.
4. **Cross-Ledger & Macro Precision Guards:**
   - Word-boundary regex parent-family mapping (`classify_parent_ministry_families` + symmetric client TS helper) prevents `ICPC → LABOUR` (`ANTI_CORRUPTION` added) and `TRANSPORT ↔ SPORT` false links.
   - BIR macro invariants enforce `debt_service_subtotal >= max(domestic, foreign)` (`FY 2015`), explicit missing-column warnings (`FY 2013`), and partial-year nulling (`FY 2014 Q2`).
   - OAuGF indexing filters TOC dot-leader lines (`[.\u2026\u00b7]{4,}\s*\d+`), tracks `tocPagesSkippedCount`, diagnoses Doc `41` (`Annual Audit Report 2020`) as `SCANNED_IMAGE_BODY_PENDING_OCR`, and discloses `missingAnnualAuditYears` (`[2021, 2022]`).
   - Coverage metadata documents `SUMMARY_ACT_ONLY`, `PARTIAL_SCHEDULE`, partial Treasury calendar boundaries (`2018`, `2026`), and `>100%` roll-up vs. non-roll-up reconciliations (`coverage_audit.py` + `src/utils/displayText.ts`).
5. **Verbatim Provenance Separation:**
   - Normalized `mda_entities` / `contractor_entities` display names power visual summaries, charts, and tabular exports (`cleanEntityDisplayName()`), while raw source strings (`verbatim_project_name`, `pdf_page`, `source_filename`, `sha256_hash`) remain unaltered for dossier views and formal citations.

---

## 3. Target Phase 8 Relational Schema (PostgreSQL 16 + `tsvector` / SQLite Dev Parity)

Normalize the static JSON corpus into relational tables seeded directly from `backend/data/*.sqlite` and verified `public/datasets/` outputs:

| Relational Table / View | Primary Key & Foreign Keys | Core Columns & Indexes | Static Source Replaceable |
|---|---|---|---|
| `mda_entities` | `PK mda_key TEXT` | `canonical_name`, `parent_families TEXT[]`, `sector_taxonomy`, `oaugf_matched_count`; index on `canonical_name` | Eliminates per-file string normalization drift |
| `contractor_entities` | `PK contractor_key TEXT` | `display_name`, `bpp_contractor_id`, `cac_rc_number`, `contract_count`, `total_awarded_naira`, `govspend_paid_naira`, `first_year`, `last_year`; GIN trigram index on `display_name` | `contractors_leaderboard.json` + `contractor_history/*.json` (`31.43 MB`) |
| `fiscal_cycles` | `PK financial_year INT` | `president_id`, `coverage_tier`, `official_macro_total_naira`, `extracted_total_naira`, `extracted_ratio_pct`, `non_rollup_ratio_pct`, `over_100_pct_flag`, `extracted_breakdown_note`, `bir_is_partial_year`, `treasury_is_partial_year`, `primary_sha256` | `registry.json` + `coverage_audit.json` + `source_provenance.json` |
| `budget_line_items` | `PK id TEXT`, `FK financial_year`, `FK mda_key` | `project_code`, `verbatim_project_name`, `amount_naira`, `spending_type`, `is_rollup`, `sector`, `state_name`, `lga_name`, `pdf_page`, `source_filename`, `sha256_hash`, `forensic_flags JSONB`, `compound_risk_score`, `search_tsv TSVECTOR` | `public/datasets/{1999..2026}/`, `db/{1999..2026}/`, `ai_knowledge_base.json` (`921.66 MB` combined!) |
| `bill_act_diffs` | `PK diff_id TEXT`, `FK financial_year`, `FK mda_key` | `project_code`, `project_name`, `status` (`INSERTED`/`INFLATED`/`CUT`/`REMOVED`), `is_zip`, `proposed_naira`, `enacted_naira`, `delta_naira`, `bill_page`, `act_page` | `bill_act_diffs/*.json` (`6.37 MB`) |
| `bir_execution_reports` & `bir_mda_releases` | `PK financial_year` / `(financial_year, mda_key)` | `status`, `quarter_covered`, `is_partial_year`, `coverage_note`, `macro_warnings JSONB`, `appropriated_naira`, `released_naira`, `cash_backed_naira`, `utilized_naira`, `derived_from_components` | `execution_tracker.json`, `macro_credibility_tracker.json` |
| `nocopo_contracts` & `procurement_quarantine` | `PK ocid TEXT`, `FK mda_key`, `FK contractor_key` | `stage` (`planning`/`tender`/`award`/`contract`/`implementation`), `title`, `procurement_method`, `award_naira`, `paid_naira`, `budget_record_id`, `anomaly_type` (`PORTAL_TEST_RECORD`/`KOBO_SHIFT_100X`/`DECIMAL_SHIFT_*`) in quarantine view | Replaces inline filtering of `98,866` OCDS rows |
| `govspend_vouchers` | `PK payment_no TEXT`, `FK mda_key`, `FK contractor_key` | `payment_date`, `financial_year`, `payer_code`, `beneficiary_name`, `entity_category` (`PRIVATE_CORPORATE`/`STATUTORY_GOV_MDA`/`BANK_FINANCIAL`/`TAX_REVENUE_PENSION_PAYROLL`/`STAFF_OR_INDIVIDUAL`/`UNCLASSIFIED`), `is_payroll_or_statutory`, `amount_naira`, `description`, `search_tsv` | Existing `467,763`-row SQLite table migrated with taxonomy + payroll booleans |
| `oaugf_documents` & `oaugf_findings` | `PK doc_id TEXT` / `PK finding_id TEXT`, `FK mda_key` | `title`, `page_count`, `substantive_pages_count`, `extraction_status` (`INDEXED`/`SCANNED_IMAGE_BODY_PENDING_OCR`), `category`, `year`, `pdf_page`, `amount_naira`, `repeat_neglect`, `recovery_required`, `summary` | `oaugf_audit_index.json` + `oaugf_issues/*.json` (`5.91 MB`) |
| `mda_scorecards_mv` & `red_flag_convergence_mv` | Materialized views keyed on `mda_key` | Pre-aggregated 5-pillar scores (`active_weight_sum`, `grade`, `composite_score`) and 6-ledger convergence flags refreshed at end of ETL cascade | `mda_integrity_scorecards.json`, `red_flag_convergence_index.json` |
| `citizen_tips` & `casebooks` / `casebook_pins` | `PK tip_id`, `PK casebook_id`, `PK pin_id` | Existing `citizen_tips.sqlite` (`ip_hash`, EXIF-scrubbed image storage, moderation status) + relational `casebooks` & `casebook_pins` (migrating browser `localStorage` pins with `ledger_provenance JSONB`) | Persistent multi-device civic workspace storage |

---

## 4. Target API Endpoints & Mobile Transfer Budget (>95% Reduction)

Extend the existing FastAPI application in [backend/main.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/backend/main.py) (`search.py`, `ai.py`, `procurement.py`, `expenditures.py`, `tips.py`):

| Endpoint | Replaces Static Fetch | Query / Body Parameters | Expected Response & Payload Ceiling |
|---|---|---|---|
| `GET /api/years` & `GET /api/years/{year}/summary` | `registry.json` + full `2026/projects.min.json` eager download (`21.82 MB`) | `—` | `< 15 KB` overview KPIs, top 10 sectors, top 10 MDAs, and `fiscal_cycles` coverage metadata |
| `GET /api/projects` | `public/datasets/{year}/projects.min.json` (`0.53–21.82 MB` per year) | `year`, `mda_key`, `sector`, `state`, `q`, `flagged_only`, `cursor`/`page`, `limit<=100` | `< 60 KB` per paginated slice (`50` items + total count & filter facets) |
| `GET /api/projects/{id}/lifecycle` | `project_lifecycle/{00..63}.json` (`82.10 MB` shards) | `id` | `< 12 KB` 5-stage trace (`MTEF -> Bill Diff -> BIR -> NOCOPO -> GovSpend`) |
| `GET /api/mdas` & `GET /api/mdas/{mda_key}/scorecard` | `mda_integrity_scorecards.json` + `red_flag_convergence_index.json` | `grade`, `convergent_only`, `q`, `sort`, `limit`, `offset` | `< 45 KB` paginated scorecard directory + on-demand single-MDA 6-ledger dossier |
| `GET /api/forensics/{pillar}` | `evidence_engine_all_years.json`, `statistical_forensics_1999_2026.json`, `procurement_risk_index.json`, `govspend_forensics.json`, `oaugf_audit_index.json` | `year`, `sub_view`, `include_payroll` (default `false`), `include_quarantined` (default `false`), `q`, `limit`, `offset` | `< 50 KB` per sub-view instead of multi-MB preloaded blobs |
| `POST /api/ai/retrieve` (upgraded `/api/ai/query`) | `ai_knowledge_base.json` (`115.72 MB`) + `search_index_top.json` (`1.38 MB`) | `{ question, year, president, mode }` | `< 25 KB` server-side SQLite FTS5 / PostgreSQL `tsvector` chunk synthesis with deterministic SQL totals & zero client-side 115 MB JSON download |
| `GET/POST /api/casebooks` & `POST/DELETE /api/casebooks/{id}/pins` | Browser `localStorage` state | Auth / share token + pin metadata | Enables cross-device journalist/auditor sharing & server-side PDF/DOCX export hydration |
| Existing `/api/tips`, `/api/search`, `/api/procurement/*`, `/api/expenditures/*` | Already active in [backend/routers/](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/backend/routers/search.py) | Preserved with optional `include_payroll` / `include_quarantined` flags | Backwards-compatible drop-in upgrade with `Vite` dev/preview fallback support |

**Mobile Data Savings:** Initial mobile landing transfer drops from **~22–138 MB** (downloading `2026/projects.min.json` + `search_index_top.json` / `ai_knowledge_base.json` + shards) to **< 400 KB** (`>98%` payload reduction on 3G/LTE Android & iOS connections).

---

## 5. Migration Order & Phase 8 Operational Guardrails

1. **Migration Sequence (`Phase 8`):**
   - `P8-CP-1`: Provision PostgreSQL schema + Alembic migrations; write idempotent loader reading `public/datasets/` + `backend/data/*.sqlite` with row-count & Naira-sum reconciliation assertions (`559,638` records, `467,763` vouchers, `16,536` awarded contracts + `190` quarantined).
   - `P8-CP-2`: Implement paginated `/api/projects`, `/api/years/{year}/summary`, `/api/mdas`, and server-side `/api/ai/retrieve` endpoints in FastAPI with Redis/in-memory cache for read-heavy aggregations.
   - `P8-CP-3`: Switch frontend [budgetDatabaseEngine.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/services/budgetDatabaseEngine.ts) and explorer hooks from full-year JSON downloads to API-first with graceful static fallback for offline/PWA mode.
   - `P8-CP-4`: Add persisted `/api/casebooks` & moderated `/api/tips` workflows (preserving Pillow EXIF scrub, IP hash rate-limiting, and `triggerVerifiedDocumentDownload()` PDF/DOCX-only exports).
   - `P8-CP-5`: Run OCR backfill on pending scanned PDFs (`OAuGF Doc 41 Annual Audit Report 2020`, `658` scanned pages) and load extracted findings into `oaugf_findings` without altering raw PDFs.
2. **Non-Negotiable Production Invariants:**
   - **Export Policy:** Never expose raw `.csv`, `.json`, `.html`, or `.md` downloads in UI controls; all reports emit verified `%PDF-` or OOXML `PK` binaries routed through [documentExporter.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/documentExporter.ts).
   - **UI Purity:** Maintain zero developer/CLI strings in `src/**/*.tsx`.
   - **Telemetry Attribution:** Every API response serving totals (`Official Enacted Budget`, `BIR Released`, `NOCOPO Awarded`, `GovSpend Cash Paid`, `OAuGF Queried`) must return its distinct source layer tag and coverage tier (`FULL_SCHEDULE` / `PARTIAL_SCHEDULE` / `SUMMARY_ACT_ONLY`) so UI caveat badges remain authoritative.
