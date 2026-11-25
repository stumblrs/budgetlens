# BudgetLens Phase 7 — Pre-Backend Data Hygiene & Presentation Hardening Roadmap

> **Document Status:** `COMPLETED — READY FOR PHASE 8 BACKEND SETUP`  
> **Created:** `2026-11-24`  
> **Predecessors:** [PHASE6_FULL_OBSERVATORY_6LEDGER_UNIFICATION_ROADMAP.md](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/PHASE6_FULL_OBSERVATORY_6LEDGER_UNIFICATION_ROADMAP.md) (`Completed`) | Mobile Native Shell & Reconciled Sector Distribution (`Completed`)  
> **Corpus Audited:** `1,070.31 MB` across [public/datasets/](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/public/datasets/coverage_audit.json) (including `115.7 MB` `ai_knowledge_base.json`, `559,391` indexed budget records across `1999–2026`, `467,763` Open Treasury vouchers, `16,726` awarded NOCOPO contracts, `250` scored MDAs, and `7,028` OAuGF Constitutional Audit findings)  
> **Objective:** Resolve verified cross-ledger data hygiene defects, payroll noise, parser edge cases, display-name inconsistencies, and mobile/desktop presentation edge cases **before** freezing canonical relational schemas and migrating the `1,070.31 MB` static corpus behind a real production backend (`Phase 8`), enforced with strict checkpoint gates (`P7-CP-1` through `P7-CP-6`).

---

## 1. Mandatory Governance, Data Integrity & Verification Rules

Every Phase 7 stage (`P7-CP-1` through `P7-CP-6`) MUST satisfy all six invariants before its checkpoint can be marked `COMPLETED`:

1. **Non-Destructive Quarantine Over Silent Deletion:**
   - Never delete or overwrite raw Stage-2 annual budget checkpoints (`ingestion/checkpoints_data/`), raw external source drops, or `ingestion/ocr_cache/`. Any flagged portal test entries or `100x`/`1,000x` decimal-shift outliers excluded from headline rankings MUST be preserved in auditable `quarantinedAnomalies` / `portalDataEntryAnomalies` arrays with explicit reason codes and counts.
2. **Preserve Cryptographic Verbatim Provenance:**
   - Display normalization (`cleanEntityDisplayName()`) MUST apply cleanly to visual charts, summary tables, and human-readable narratives while leaving verbatim source project descriptions, PDF page citations, and SHA-256 document digests intact in record dossiers (`ProjectEvidenceModal`, `BudgetRecordDossierPage`, `ViewCitationModal`).
3. **Zero Developer / CLI Strings in Public UI:**
   - Zero occurrences of `uvicorn`, `FastAPI`, `python -m`, or `.exe -m` anywhere in `src/**/*.tsx`.
4. **Strict Export Policy (PDF & DOCX Only):**
   - Every new or updated report export MUST route through `triggerVerifiedDocumentDownload()` and `sanitizePdfText()` in [src/utils/documentExporter.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/documentExporter.ts) and pass `%PDF-` and OOXML `PK` binary verification in Vitest. Zero CSV, JSON, HTML, or Markdown `Blob` downloads.
5. **No Double-Counting & Clear Coverage Disclosures:**
   - Maintain strict separation across fiscal accountability layers (Enacted Appropriation Schedules vs. Legislative Bill→Act Diffs vs. BIR Releases/Utilization vs. NOCOPO Contract Awards vs. Open Treasury Cash Vouchers vs. OAuGF Audit Queries) and explicitly disclose `SUMMARY_ACT_ONLY`, `PARTIAL_SCHEDULE`, and partial calendar/quarter windows (`2014 Q2` BIR; `2018` & `2026` Treasury).
6. **Locale & Reproducibility Guardrails:**
   - Always pass `'en-US'` to `.toLocaleString('en-US')` inside pure TypeScript formatters and unit tests, and execute Python builders deterministically so repeated runs yield stable counts and keys.

---

## 2. Phased Implementation Plan & Checkpoints (`P7-CP-1` to `P7-CP-6`)

### Phase 7A (`Checkpoint P7-CP-1`): Entity, Contractor & Mojibake Canonicalization
- **Priority:** `Critical — Relational Foreign Key Readiness`
- **Observed Data Evidence:**
  - **Numeric leak treated as an MDA:** `"10,250,000"` (`mdaKey: "10 250 000"`) currently ranks inside `topFlaggedMdasAllTime` in [evidence_engine_all_years.json](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/public/datasets/evidence_engine_all_years.json) with `108` flagged projects (`₦45.26B`).
  - **PDF line-wrap & trailing-hyphen fragmentation:** Ministries split across separate canonical keys, such as `FEDERAL MINISTRY OF SCIENCE, TECHNOLOGY AND` (`794` projects, `1` OAuGF query) vs. `FEDERAL MINISTRY OF SCIENCE, TECHNOLOGY AND INNOVATION` (`493` projects, `13` queries), `MINISTRY OF HUMANITARIAN AFFAIRS, DISASTER MANAGEMENT AND SOCIAL` vs. `...DEVELOPMENT`, `MINISTRY OF DEFENCE - MOD HQTRS` (`grade: N/A`, `954` personal/opaque hits) vs. `FEDERAL MINISTRY OF DEFENCE - MAIN MOD` (`grade: C`), and `FEDERAL MINISTRY OF WORKS` (`grade: D`, `0` OAuGF queries) vs. `FEDERAL MINISTRY OF WORKS AND HOUSING` (`grade: C`, `18` OAuGF queries).
  - **Contractor alias fragmentation:** `"ADROIT LANDSTYLE LTD"`, `"ADROIT LANDSTYLE"`, and `"ADROIT - LAND STYLE LTD"` appear as 3 separate entries inside `contractors` in [red_flag_convergence_index.json](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/public/datasets/red_flag_convergence_index.json) for the exact same `₦645.45M` Accident Investigation Bureau contract.
  - **UTF-8 mojibake & source typos:** `"HADEJIA-JAMAÄ»ARE RBDA"` (across BIR, NOCOPO, Scorecard, Convergence), `"FEDERAL UNIVERSITYOF GASHUA"`, `"NATIONAL EMERGENCY MANAGEMANT AGENCY"`, `"DEFENCE HEADQURTERS"`, and `"MINSITRY OF ENERGY"`.
- **Deliverables:**
  1. Harden [ingestion/parsers/entity_normalizer.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/parsers/entity_normalizer.py):
     - Add UTF-8/Windows-1252 mojibake repair (`Ä»` → `'`, smart-quote cleanup), typo normalizers (`UNIVERSITYOF` → `UNIVERSITY OF`, `MANAGEMANT` → `MANAGEMENT`, `HEADQURTERS` → `HEADQUARTERS`, `MINSITRY` → `MINISTRY`), trailing connector trimming (trailing `-`, `,`, `AND`, `OF`, `&` from wrapped PDF headings), and explicit numeric-only / currency-only MDA rejection (`is_valid_mda_name()` rejecting strings like `"10,250,000"`).
     - Add deterministic truncated-prefix & successor-ministry resolution table mapping `SCIENCE, TECHNOLOGY AND` → `SCIENCE TECHNOLOGY AND INNOVATION`, `DEFENCE MOD` → `DEFENCE`, etc.
     - Tighten contractor normalization (`normalize_entity_name()` / `canonical_contractor_key()`) to collapse legal-suffix & hyphenation variants (`ADROIT - LAND STYLE LTD`, `ADROIT LANDSTYLE LIMITED`, `ADROIT LANDSTYLE`) into a single canonical vendor key.
  2. Propagate updated helpers consistently across [project_lifecycle_builder.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/project_lifecycle_builder.py), [evidence_engine_indexer.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/evidence_engine_indexer.py), and [red_flag_convergence_builder.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/red_flag_convergence_builder.py).
  3. Add regression tests covering `"10,250,000"`, `ADROIT` variants, wrapped ministry names, and `"HADEJIA-JAMA'ARE RBDA"` inside [test_entity_normalizer.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/python/test_entity_normalizer.py).
- **Target Files:**
  - [ingestion/parsers/entity_normalizer.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/parsers/entity_normalizer.py)
  - [ingestion/indexers/project_lifecycle_builder.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/project_lifecycle_builder.py)
  - [ingestion/indexers/evidence_engine_indexer.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/evidence_engine_indexer.py)
  - [ingestion/indexers/red_flag_convergence_builder.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/red_flag_convergence_builder.py)
  - [tests/python/test_entity_normalizer.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/python/test_entity_normalizer.py)
- **Verification Gate (`P7-CP-1`):**
  - `.venv\Scripts\python.exe -m pytest tests/python/test_entity_normalizer.py tests/python/test_evidence_engine_indexer.py tests/python/test_red_flag_convergence.py` passes with 0 failures.

---

### Phase 7B (`Checkpoint P7-CP-2`): NOCOPO Sandbox Quarantine & Kobo-Shift (`100x`/`1,000x`) Isolation
- **Priority:** `Critical — Headline Metric Credibility`
- **Observed Data Evidence:**
  - Sandbox test MDA **`"TEST MINISTRY - NOCOPO"`** (`188` contracts, `₦72.85B` awarded, `₦32.82B` paid) appears as a live ranked agency inside [procurement_risk_index.json](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/public/datasets/procurement_risk_index.json).
  - The **#1 Top Overrun Contract** (`ocds-gyl66f-998768-000490`, FY 2020, `"Unspecified Federal MDA"`) has title **`"test"`** with `awardNaira: ₦28,000,000` and `paidNaira: ₦467,891,333,331` (`+1,670,940.48%`), contributing **`₦467.86B` (~49.8%)** of the entire `₦939.85B` headline overrun total.
  - Multiple top overrun rows exhibit exact **`100x` (`+9,900.0%`)** or **`1,000x` (`+99,900.0%`)** decimal/kobo entry errors on NOCOPO (e.g., `₦248.11M` → `₦24.81B` [`9,900.0%`], `₦230.70M` → `₦23.07B` [`9,900.0%`], `₦18.60M` → `₦18.60B` [`99,900.0%`], `₦145.66M` → `₦14.57B` [`9,900.0%`], `₦37.82M` → `₦3.78B` [`9,900.0%`]).
- **Deliverables:**
  1. Update [procurement_risk_builder.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/procurement_risk_builder.py):
     - Add deterministic `is_sandbox_or_test_procurement(mda_name, title, ocid)` filter to exclude test rows (`TEST MINISTRY`, exact `test` titles, dummy test OCIDs) from `headline`, `mdaRiskRanking`, `topOverrunContracts`, and `methodBreakdown`, logging counts under `headline.excludedTestRecordsCount` & `headline.excludedTestAwardedNaira`.
     - Add deterministic decimal/kobo-shift classifier (`classify_overrun_anomaly(award, paid)`) detecting exact `100x` (`ratio` near `100`, e.g. `|paid / award - 100| < 0.05` or `paid == award * 100`) and `1,000x` (`ratio` near `1000`) portal typos; route those into `portalDataEntryAnomalies` + `headline.koboShiftAnomalyCount` / `headline.koboShiftAnomalyDeltaNaira` instead of inflating genuine contract variation overruns.
  2. Apply the same sandbox-exclusion guard in [mda_scorecard_builder.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/mda_scorecard_builder.py) and [red_flag_convergence_builder.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/red_flag_convergence_builder.py) so `TEST MINISTRY - NOCOPO` cannot enter MDA Scorecards or Convergence rankings.
  3. Surface a clean *"Quarantined Portal Test / Kobo-Shift Entries"* disclosure pill & expandable inspection drawer inside [ExecutionProcurementExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/ExecutionProcurementExplorer.tsx) and update procurement brief builders in [documentExporter.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/documentExporter.ts).
- **Target Files:**
  - [ingestion/indexers/procurement_risk_builder.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/procurement_risk_builder.py)
  - [ingestion/indexers/mda_scorecard_builder.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/mda_scorecard_builder.py)
  - [ingestion/indexers/red_flag_convergence_builder.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/red_flag_convergence_builder.py)
  - [src/components/ExecutionProcurementExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/ExecutionProcurementExplorer.tsx)
  - [src/utils/documentExporter.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/documentExporter.ts)
  - [tests/python/test_procurement_risk.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/python/test_procurement_risk.py), [tests/unit/documentExporter.test.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/unit/documentExporter.test.ts)
- **Verification Gate (`P7-CP-2`):**
  - `.venv\Scripts\python.exe -m pytest tests/python/test_procurement_risk.py` passes.
  - `npx tsc -b; if ($LASTEXITCODE -eq 0) { npx vitest run tests/unit/documentExporter.test.ts }` passes with `%PDF-` and `PK` headers.

---

### Phase 7C (`Checkpoint P7-CP-3`): Open Treasury Cash Forensics — Payroll & Statutory Transfer Separation
- **Priority:** `High — Signal-to-Noise Clarity`
- **Observed Data Evidence:**
  - In [govspend_forensics.json](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/public/datasets/govspend_forensics.json), top entries in `topRolling7DayClusters` are predominantly routine monthly **`IPPIS TRANSACTION ACCOUNT`** police payroll runs and **`HQ NIGERIAN ARMY FINANCE CORPS`** non-regular allowance tranches rather than commercial contractor splitting.
  - Under `OPAQUE_BLANK_DESCRIPTION` (`< 12 chars`), legitimate abbreviated payroll strings like `"MAY 19 SAL"` (`₦9.15B`) and `"SEP 19 SAL"` (`₦8.74B`) are grouped beside genuinely uninformative disbursements like `"None"` (`₦8.97B` to `VISIBLE CONSTRUCTION LIMITED`) and `"43788"` (`₦9.0B` Excel serial date).
- **Deliverables:**
  1. Add deterministic `is_payroll_or_statutory_voucher(beneficiary, description)` detection in [govspend_forensics_builder.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/govspend_forensics_builder.py) matching `IPPIS`, `NEW IPPIS TRANSATION ACCOUNT`, `FINANCE CORPS` monthly salary/allowance codes (`SAL`, `PENSION`, `NHIS`, `TROOPS NON REG ALLCE`, `FAAC`, `STATUTORY ALLOCATION`).
  2. Emit separated rolling 7-day clusters (`topCommercialRolling7DayClusters` alongside `topRolling7DayClusters` or flagged boolean `isPayrollOrStatutory`), exempt obvious monthly payroll markers from short-string `< 12 char` blank-description alerts while preserving `None` / numeric-only (`43788`) / blank strings, and record headline counts of separated payroll vouchers.
  3. Update the `?fsub=govspend` panel in [StatisticalForensicsLab.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/StatisticalForensicsLab.tsx) to default rolling 7-day clusters & opaque vouchers to **`Commercial & Discretionary Only`** with a 1-click toggle (`Include IPPIS / Military Payroll`), and mirror the breakdown cleanly in GovSpend PDF/DOCX exports in [documentExporter.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/documentExporter.ts).
- **Target Files:**
  - [ingestion/indexers/govspend_forensics_builder.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/govspend_forensics_builder.py)
  - [src/components/StatisticalForensicsLab.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/StatisticalForensicsLab.tsx)
  - [src/utils/documentExporter.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/documentExporter.ts)
  - [tests/python/test_govspend_forensics.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/python/test_govspend_forensics.py), [tests/unit/statisticalForensics.test.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/unit/statisticalForensics.test.ts)
- **Verification Gate (`P7-CP-3`):**
  - `.venv\Scripts\python.exe -m pytest tests/python/test_govspend_forensics.py` passes.
  - `npx tsc -b; if ($LASTEXITCODE -eq 0) { npx vitest run tests/unit/statisticalForensics.test.ts }` passes.

---

### Phase 7D (`Checkpoint P7-CP-4`): Scorecard Parent-Family Precision, BIR Guards, OAuGF TOC/2020 Recovery & Extraction Ratio Audit
- **Priority:** `High — Cross-Ledger Accuracy`
- **Observed Data Evidence:**
  - **Scorecard parent-family false links** in [mda_integrity_scorecards.json](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/public/datasets/mda_integrity_scorecards.json): `ICPC` (`INDEPENDENT CORRUPT PRACTICES AND RELATED OFFENCES COMMISSION`) is assigned `parentFamilies: ["LABOUR"]` (inheriting Labour BIR scores from substring match), and `YOUTH AND SPORTS DEVELOPMENT` matched BIR label `"Housing Transportation"`.
  - **BIR macro anomalies** in [execution_tracker.json](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/public/datasets/execution_tracker.json): FY `2015` Debt Service Sub-Total shows `₦60.38B` actual (`6.33%`) directly beneath Domestic Debt Service of `₦996.80B` (`111.42%`) due to a missing leading digit / column splice; FY `2013` Overhead Cost shows `actualNaira: 0` (`0.0%`); FY `2014` covers `Q2` only (`utilizedNaira: 0`).
  - **OAuGF extractor gaps** in [oaugf_audit_index.json](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/public/datasets/oaugf_audit_index.json): doc ID `41` (`Annual Audit Report 2020`, `668` native pages) parsed `0` issues; NDDC `2013–2018` findings captured dot-leader Table of Contents lines (`"……………………………………………………………………9"`); `2021–2022` annual reports are absent from `yearsCovered`.
  - **>100% annual extraction ratios** in [coverage_audit.json](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/public/datasets/coverage_audit.json): `1999` (`194.2%`), `2018` (`113.2%`), `2019` (`111.2%`), and `2025` (`112.1%`) exceed `official_macro_total`.
- **Deliverables:**
  1. Tighten `classify_parent_ministry_families()` & BIR label token-boundary matching in [project_lifecycle_builder.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/project_lifecycle_builder.py) and [mda_scorecard_builder.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/mda_scorecard_builder.py) (word-boundary checks so `TRANSPORT` inside unrelated strings cannot trigger `SPORT`; `ANTI-CORRUPTION` agencies such as `ICPC`/`EFCC` never match `LABOUR`).
  2. Harden [bir_parser.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/parsers/bir_parser.py) with cross-check invariant `debt_service_subtotal >= max(domestic_debt, foreign_debt)` (falling back to `domestic + foreign` sum or flagging `macroIntegrityWarning` when corrupted), detect FY `2013` Overhead OCR/column omission cleanly, and verify FY `2014` partial `Q2` status metadata.
  3. Upgrade [oaugf_indexer.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/oaugf_indexer.py) to reject Table of Contents dot-leader lines (`re.search(r"[.\u2026]{5,}\s*\d+$", text)`), inspect doc `41` (`Annual Audit Report 2020`) heading syntax so its queries index cleanly, and suppress TOC false-positive excerpts.
  4. Audit `1999`, `2018`, `2019`, and `2025` extracted line items in [coverage_audit.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/coverage_audit.py) to distinguish Supplementary Appropriation Acts / multi-schedule sub-files (`extracted_breakdown_note`) vs. any summary roll-up overlap before relational DB loading.
- **Target Files:**
  - [ingestion/indexers/project_lifecycle_builder.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/project_lifecycle_builder.py)
  - [ingestion/indexers/mda_scorecard_builder.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/mda_scorecard_builder.py)
  - [ingestion/parsers/bir_parser.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/parsers/bir_parser.py)
  - [ingestion/indexers/oaugf_indexer.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/oaugf_indexer.py)
  - [ingestion/indexers/coverage_audit.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/coverage_audit.py)
  - [tests/python/test_mda_scorecard.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/python/test_mda_scorecard.py), [tests/python/test_oaugf_audit.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/python/test_oaugf_audit.py), [tests/python/test_execution_procurement.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/python/test_execution_procurement.py)
- **Verification Gate (`P7-CP-4`):**
  - `.venv\Scripts\python.exe -m pytest tests/python/test_mda_scorecard.py tests/python/test_oaugf_audit.py tests/python/test_execution_procurement.py` passes.

---

### Phase 7E (`Checkpoint P7-CP-5`): Shared Presentation Display Sanitizer, Coverage Caveat Badges & Mobile Chart Polish
- **Priority:** `Medium–High — UI Clarity & Mobile Polish`
- **Problem Statement:** UI components and PDF/DOCX tables still occasionally display trailing hyphens (`FEDERAL MINISTRY OF AGRICULTURE AND FOOD SECURITY -`), residual mojibake (`HADEJIA-JAMAÄ»ARE RBDA`), or lack immediate visual indicators when a selected year uses `SUMMARY_ACT_ONLY` (`2000–2003, 2005, 2007`), `PARTIAL_SCHEDULE` (`2011` at `23.9%`, `2015` at `29.3%`), or partial-year Treasury/BIR coverage (`2014` Q2, `2018`/`2026`). Additionally, the SVG network graph in [VendorCaptureNetworkView.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/VendorCaptureNetworkView.tsx) benefits from a mobile horizontal-scroll cue.
- **Deliverables:**
  1. Create [src/utils/displayText.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/displayText.ts) *(new file)* exporting:
     - `cleanEntityDisplayName(raw)` (strips dangling `-` / `,` suffixes, repairs mojibake quotes, collapses extra whitespace, keeps official citations verbatim elsewhere).
     - `getCoverageCaveatMeta(year, coverageAuditEntry?)` returning standardized civic caveat pills (`Full Schedule`, `Partial Schedule`, `Summary Act Only`, and partial-year Treasury/BIR disclaimers).
  2. Wire `cleanEntityDisplayName` & `getCoverageCaveatMeta` cleanly into [HeaderStats.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/HeaderStats.tsx), [Topbar.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/Topbar.tsx), [ExecutionProcurementExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/ExecutionProcurementExplorer.tsx), and tabular cells inside [documentExporter.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/documentExporter.ts).
  3. Add a subtle *"Swipe horizontally to inspect full capture graph"* mobile hint in [VendorCaptureNetworkView.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/VendorCaptureNetworkView.tsx) (`mobile-only-block` badge above the `minWidth: 720px` SVG scroll container).
  4. Add unit coverage in `tests/unit/displayText.test.ts` *(new file)* verifying mojibake cleanup, dangling hyphen trimming, `'en-US'` formatting invariants, and coverage caveat metadata.
- **Target Files:**
  - `src/utils/displayText.ts` *(new file)*
  - [src/components/HeaderStats.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/HeaderStats.tsx)
  - [src/components/Topbar.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/Topbar.tsx)
  - [src/components/ExecutionProcurementExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/ExecutionProcurementExplorer.tsx)
  - [src/components/VendorCaptureNetworkView.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/VendorCaptureNetworkView.tsx)
  - [src/utils/documentExporter.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/documentExporter.ts)
  - `tests/unit/displayText.test.ts` *(new file)*
- **Verification Gate (`P7-CP-5`):**
  - `npx tsc -b; if ($LASTEXITCODE -eq 0) { npx vitest run tests/unit/displayText.test.ts tests/unit/documentExporter.test.ts }` passes.

---

### Phase 7F (`Checkpoint P7-CP-6`): Full Index Rebuild Cascade, Multi-Viewport Playwright E2E Gate & Backend Readiness Sign-Off
- **Priority:** `Release Blocker Before Phase 8 Backend Setup`
- **Deliverables:**
  1. Run the deterministic Python cross-ledger rebuild cascade in dependency order against updated hygiene rules:
     - `procurement_risk_builder` → `govspend_forensics_builder` → `oaugf_indexer` → `project_lifecycle_builder` → `mda_scorecard_builder` → `red_flag_convergence_builder` → `evidence_engine_indexer` → [forensic_sweep.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/forensic_sweep.py) → [coverage_audit.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/coverage_audit.py) → [build_provenance_manifest.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/build_provenance_manifest.py).
     - Assert zero occurrences of `"TEST MINISTRY - NOCOPO"`, `"10,250,000"` MDA keys, or `"Ä»"` mojibake in primary UI leaderboards.
  2. Extend [tests/e2e/observatory.spec.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/e2e/observatory.spec.ts) to test **4 real viewports** (`1440x900` desktop, `1024x768` tablet, `390x844` iOS, and `360x800` Android):
     - Zero console/page errors and `scrollWidth <= clientWidth + 2` across core tabs (`overview`, `projects`, `citizen`, `agencies`, `forensics`, `ai`).
     - Mobile bottom navigation bar (`Overview`, `Projects`, `Citizen`, `Forensics`, `More`) visible and functional at `<= 768px`; search modal & fiscal year bottom-sheet open/close cleanly on mobile.
  3. Finalize the **Backend Preparation Hand-Off Specification** (mapping the `1,070.31 MB` static payload, including the `115.7 MB` `ai_knowledge_base.json`, into normalized DB tables, server-side search/AI endpoints, pagination, and persistent casebook/tips storage in `Phase 8`).
- **Final Release Verification Gate (`P7-CP-6` — Run Before Phase 8 Starts):**
  ```powershell
  .venv\Scripts\python.exe -m pytest tests/python/; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; $cliHits = Get-ChildItem -Path "src" -Filter "*.tsx" -Recurse | Select-String -Pattern "uvicorn|FastAPI|python -m|\.exe -m"; if ($cliHits) { $cliHits; throw "Developer CLI strings found in src/**/*.tsx" } else { "ZERO_UI_DEVELOPER_STRINGS_RECURSIVE" }; npx tsc -b; if ($LASTEXITCODE -eq 0) { npx vitest run }; if ($LASTEXITCODE -eq 0) { npm run build }
  ```
  Plus live Playwright verification against the production preview (`npx playwright test`).

---

## 3. Master Execution & Checkpoint Tracking Matrix

| Phase | Checkpoint ID | Primary Defect / Presentation Scope Fixed | Key Target Modules | Verification Gate | Status |
|---|---|---|---|---|---|
| **Phase 7A** | `P7-CP-1` | Numeric `"10,250,000"` MDA leak, wrapped ministry splits (`SCIENCE, TECHNOLOGY AND`, `MOD`), `ADROIT` vendor splits, `Ä»` mojibake & typos | `entity_normalizer.py`, `project_lifecycle_builder.py`, `evidence_engine_indexer.py`, `red_flag_convergence_builder.py` | `pytest` (`entity_normalizer`, `evidence_engine_indexer`, `red_flag_convergence`) | `COMPLETED` |
| **Phase 7B** | `P7-CP-2` | `"TEST MINISTRY - NOCOPO"` (`188` rows), `"test"` `#1` overrun (`₦467.86B` distortion), exact `100x`/`1,000x` kobo-shift isolation + UI quarantine pill | `procurement_risk_builder.py`, `mda_scorecard_builder.py`, `ExecutionProcurementExplorer.tsx`, `documentExporter.ts` | `pytest` (`procurement_risk`) + `tsc -b` + `vitest` (`documentExporter`) | `COMPLETED` |
| **Phase 7C** | `P7-CP-3` | Police `IPPIS` & Army payroll separated from vendor 7-day clusters & short-string blank vouchers + `?fsub=govspend` Commercial default toggle | `govspend_forensics_builder.py`, `StatisticalForensicsLab.tsx`, `documentExporter.ts` | `pytest` (`govspend_forensics`) + `tsc -b` + `vitest` (`statisticalForensics`) | `COMPLETED` |
| **Phase 7D** | `P7-CP-4` | `ICPC→LABOUR` & `SPORT/TRANSPORT` parent-family guards, `FY 2015` Debt Sub-Total & `FY 2013` BIR fix, OAuGF doc `41` (`2020`) & TOC dot-leader scrub, `>100%` coverage audit | `mda_scorecard_builder.py`, `bir_parser.py`, `oaugf_indexer.py`, `coverage_audit.py` | `pytest` (`mda_scorecard`, `oaugf_audit`, `execution_procurement`) | `COMPLETED` |
| **Phase 7E** | `P7-CP-5` | Shared `cleanEntityDisplayName` / `getCoverageCaveatMeta` helper, year coverage badges, PDF/DOCX display cleanup, mobile `VendorCaptureNetworkView` scroll hint | `src/utils/displayText.ts`, `HeaderStats.tsx`, `Topbar.tsx`, `ExecutionProcurementExplorer.tsx`, `VendorCaptureNetworkView.tsx` | `tsc -b` + `vitest` (`displayText`, `documentExporter`) | `COMPLETED` |
| **Phase 7F** | `P7-CP-6` | Full static JSON index rebuild cascade, 4-viewport Playwright E2E (`1440px`, `1024px`, `390px`, `360px`), backend schema hand-off sign-off | All indexers + `tests/e2e/observatory.spec.ts` | Full `pytest` + CLI-hygiene + `tsc -b` + `vitest run` + `npm run build` + `playwright test` | `COMPLETED` |

---

## 4. Phase 8 Backend Preparation Readiness Matrix (Exit Criteria)

All Phase 7 dataset and presentation hand-off criteria below are verified green at `P7-CP-6` and frozen in [PHASE8_BACKEND_HANDOFF_SPECIFICATION.md](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/PHASE8_BACKEND_HANDOFF_SPECIFICATION.md):

| Static Payload Group | Current Static Footprint | Phase 7 Pre-Backend Cleanup Requirement | Planned Phase 8 Backend Target |
|---|---|---|---|
| **Annual Budget Schedules & Shards** (`public/datasets/1999–2026/`) | Part of `1,070.31 MB` total corpus (`559,391` records) | Canonical `mdaKey` free of `"10,250,000"`, wrapped-prefix splits, and `1999`/`2018`/`2019`/`2025` roll-up ambiguity documented in `coverage_audit.json` | Relational `budget_line_items` + `mda_entities` tables with paginated `/api/projects` & `/api/sectors` queries |
| **Grounded AI Knowledge Index** (`ai_knowledge_base.json`) | `115.70 MB` (`search_index_top.json` `1.38 MB`) | Clean MDA & vendor foreign keys synchronized across `evidence_engine_all_years.json` & `forensic_sweep_1999_2026.json` | Server-side SQLite FTS5 / PostgreSQL `tsvector` + chunk retrieval endpoint (`/api/ai/retrieve`, `/api/search`) cutting client bundle/fetch weight by >95% on mobile |
| **External Forensics & Audit Ledgers** (`oaugf_audit_index.json`, `govspend_forensics.json`, `procurement_risk_index.json`, `mda_integrity_scorecards.json`, `red_flag_convergence_index.json`) | `~8.4 MB` aggregate precomputed indices | Zero NOCOPO test records, quarantined `100x`/`1,000x` kobo shifts, separated IPPIS payroll clusters, fixed BIR & OAuGF 2020/NDDC extractions | Indexed `oaugf_findings`, `nocopo_contracts`, `govspend_vouchers`, and materialized MDA scorecard / convergence views |
| **User-Generated Persistence** (Citizen Tips, Casebook Pins, Review Status) | Browser `localStorage` + optional FastAPI preview | Mobile drawer, bottom-sheet modals, and PWA manifest/SW verified on Android (`360px`) & iOS (`390px`) with zero horizontal overflow | Authenticated / moderated backend endpoints (`/api/tips`, `/api/casebooks`, `/api/dossiers/export`) backed by persistent storage |
