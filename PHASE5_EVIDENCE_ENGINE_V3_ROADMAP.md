# BudgetLens Phase 5 — Evidence Engine v3.0: Cross-Ledger Rules, 28-Year Historical Matrix & Compound Risk Intelligence Roadmap

> **Document Status:** `COMPLETED — ALL CHECKPOINTS (EE-CP-1 TO EE-CP-5) VERIFIED (2026-11-23)`  
> **Created:** `2026-11-23`  
> **Predecessors:** [IMPLEMENTATION_ROADMAP.md](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/IMPLEMENTATION_ROADMAP.md) (Phase 1) | [PHASE2_IMPLEMENTATION_ROADMAP.md](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/PHASE2_IMPLEMENTATION_ROADMAP.md) (Phase 2) | [PHASE3_CROSS_DATASET_INTELLIGENCE_ROADMAP.md](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/PHASE3_CROSS_DATASET_INTELLIGENCE_ROADMAP.md) (Phase 3) | [PHASE4_DEEP_AUDIT_AND_INCRIMINATING_EVIDENCE_ROADMAP.md](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/PHASE4_DEEP_AUDIT_AND_INCRIMINATING_EVIDENCE_ROADMAP.md) (Phase 4 — Completed)  
> **Objective:** Upgrade the BudgetLens **Evidence Engine (`?tab=evidence`, `?tab=duplicates`, and `ProjectEvidenceModal`)** from a single-year, text-only line-item scanner (`v2.0`, `16` text rules) into **Evidence Engine `v3.0`** — cross-joining all **`559,325` budget line items (`1999–2026`)** against our **6 forensic ledgers** (`7,028` OAuGF constitutional audit findings, `467,763` Open Treasury cash vouchers / `₦1.49T` personal-account payouts / `₦2.44T` opaque vouchers, `98,866` NOCOPO contracts, `20,673` Bill-vs-Act legislative padding diffs, `3,500` recurring multi-year lineages, and `252` MDA Integrity Scorecards), with deterministic disk checkpoints (`EE-CP-1` through `EE-CP-5`) after every stage.

---

## 1. Mandatory Governance & Checkpoint Rules

1. **Sequential Checkpoint Gate:**
   - Each stage (`P5-S1` through `P5-S5`) writes a deterministic checkpoint record into `ingestion/checkpoints_data/phase5_evidence_checkpoints.json` (recording timestamp, output SHA-256 digests, row counts, and verification status) while **never modifying or deleting existing Stage-2 budget checkpoints (`1999`–`2026`), `phase4_checkpoints.json`, or `ingestion/ocr_cache/`**.
2. **100% Static-First Serving (`public/datasets/`):**
   - Every new or upgraded dataset under `public/datasets/` must work offline without requiring `uvicorn`. Any static payload is capped under `2.5 MB` (target `< 600 KB`).
3. **Zero Developer / CLI Strings in Public UI:**
   - Zero `uvicorn`, `FastAPI`, `python -m`, or `.exe -m` strings anywhere in `src/**/*.tsx`.
4. **Strict Download Policy (PDF & DOCX Only):**
   - Every new Evidence Engine & Duplicate Cluster export routes exclusively through `triggerVerifiedDocumentDownload()` + `sanitizePdfText()` in [src/utils/documentExporter.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/documentExporter.ts), verified for `%PDF-` and `PK` OOXML binary headers in Vitest.
5. **Strict Grounded AI Hygiene:**
   - Never expose `.pdf`, `.json`, or `.csv` filenames or internal dataset jargon (`NOCOPO`, `GovSpend`, `MTEF/FSP`, `SQL/FTS5`, `Budget Implementation Report`) in AI answers or follow-up suggestions.
6. **Zero Fabrication & Evidence-First Framing:**
   - Every surfaced rule finding and compound flag must cite its exact official source (Appropriation Act year/page/code, OAuGF report year & issue count, Open Treasury voucher count/amount, NOCOPO contract count, or Bill-vs-Act insertion delta) and clearly distinguish *verified public-record discrepancies / audit queries* from court convictions.

---

## 2. Diagnostic Audit of Current Evidence Engine (`v2.0`) vs. Available Corpus (`v3.0`)

| Area | Current Evidence Engine (`v2.0`) | Gap Identified | Evidence Engine (`v3.0`) Upgrade |
|---|---|---|---|
| **1. Rule Matrix Scope** | `16` text/amount rules in [src/utils/ruleEngine.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/ruleEngine.ts) running only on `(projectName, amount, agency, projectCode)` of the active single year. | Zero awareness of whether a line item was inserted by the National Assembly, paid in cash, repeated across years, or budgeted by an OAuGF-indicted MDA. | **`22` Deterministic Rules (`16` text/domain rules + `6` Cross-Ledger Forensic Rules)** joining line items against Bill-vs-Act Padding, Paid-on-Paper Lifecycle, Recurring Zombie Lineages, OAuGF Indicted MDAs (`7,028` findings), Staff/Opaque Treasury Payout MDAs (`₦1.49T` / `₦2.44T`), and Repeat Asset Lifespan Alerts. |
| **2. Project Deduplication & Compound Scoring** | If 1 project triggers 4 rules, [RecentFlaggedProjects.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/RecentFlaggedProjects.tsx) renders 4 separate rows with no compound severity score, no Casebook pinning, and no PDF/DOCX export. | Investigators cannot rank projects where **multiple rules + multiple external ledgers converge** on a single line item, nor export the Evidence Engine ledger. | **Compound Project Risk View (`1` row per project with all triggered rule badges + cross-ledger pills)** alongside the "All Rule Findings" view, plus **1-click Casebook Pinning** and **PDF/DOCX Evidence Engine Dossier Export**. |
| **3. Multi-Year (`1999–2026`) Coverage** | Only scans the single currently selected year in browser memory (`projects.min.json`). | Cannot see 28-year rule trends (`1999–2026`), all-time top rule-triggering MDAs, presidential tenure comparisons, or all-time top compound-flagged line items without manually clicking 28 years one by one. | Precomputed **[public/datasets/evidence_engine_all_years.json](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/public/datasets/evidence_engine_all_years.json)** (`< 600 KB`) indexing all **`559,325` records across `28` years (`1999–2026`)** + interactive **"28-Year Historical Matrix (`1999–2026`)"** sub-tab inside `?tab=evidence`. |
| **4. Duplicate Detector (`?tab=duplicates`)** | [DuplicateClustersExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/DuplicateClustersExplorer.tsx) groups same-year repeated/reworded titles (`Exact Wording`, `Disguised Rewording`, `Cross-MDA Duplicate`, `Same-MDA Split`), with no execution/audit context or export. | Does not tell the user whether a duplicate/split cluster was **inserted during Bill-vs-Act markup**, **actually contracted/paid**, or executed by an MDA with **OAuGF contract-splitting queries** — and has no PDF/DOCX export. | Cross-ledger enrichment of duplicate clusters (`Paid on Paper`, `Bill Insertion`, `OAuGF Contract-Splitting MDA`, `MDA Grade D/F`) + **PDF/DOCX Duplicate & Split-Allocation Dossier Export**. |
| **5. Project Evidence Modal & FOI Packet** | [ProjectEvidenceModal.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/ProjectEvidenceModal.tsx) shows the 5-stage lifecycle (`MTEF -> Bill Diff -> BIR -> NOCOPO -> GovSpend`) and static 3-bullet "Why Flagged" checklist. | Does not show **Stage 6: OAuGF Constitutional Audit Record & 6-Ledger Convergence Profile** for the executing MDA, does not list the actual triggered Rule Engine v3.0 rules in "Why Flagged", and does not cite OAuGF/Lifecycle red flags in the generated **FOI Act 2011 Demand Letter**. | Adds **Stage 6: OAuGF Constitutional Audit & 6-Ledger Convergence Card**, live triggered Rule Engine v3.0 explanations in "Why Flagged", and auto-injects verified OAuGF / Paid-on-Paper / Padding citations into the **FOI Act 2011 Request** and **Legislative Oversight Letter**. |

---

## 3. Phased Implementation Plan & Checkpoints (`EE-CP-1` through `EE-CP-5`)

### Stage `P5-S1` (`Checkpoint EE-CP-1`): All-Years (`1999–2026`) Cross-Ledger Evidence Engine Builder (`evidence_engine_all_years.json`)
- **Objective:** Build a deterministic Python indexer that runs all **`22` Rule Engine v3.0 rules** (`16` text/unit-cost/mandate rules + `6` cross-ledger forensic rules) and the O(N) Duplicate Detector across all **`559,325` budget records (`1999–2026`)**, cross-joined against:
  1. `project_lifecycle_index.json` + shards (`20,673` Bill-vs-Act padding items & `3,096` Paid-on-Paper items)
  2. `recurring_lineages.json` + `follow_the_money_links.json` (`3,500` recurring multi-year lineages)
  3. `oaugf_audit_index.json` (`7,028` constitutional audit findings across `127` matched MDAs)
  4. `red_flag_convergence_index.json` (`77` multi-flag MDAs & `29` multi-flag contractors, including `STAFF_OR_INDIVIDUAL` personal-account payout MDAs and blank-description voucher MDAs)
  5. `asset_inventory_index.json` (`repeatAlerts` where an MDA re-procures vehicles/equipment inside statutory asset lifespan)
  6. `mda_integrity_scorecards.json` (`252` scored MDAs with Grades `A`–`F`)
- **The 6 New Cross-Ledger Rules Added in Rule Engine v3.0 (`22` Total Rules):**
  1. `LEGISLATIVE_INSERTION_ANOMALY` (`high` severity): Budget line item was newly inserted (`NEW_INSERTION`) or inflated `>= +100%` (`>= ₦100M` delta) between Executive Bill and Enacted Act.
  2. `PAID_ON_PAPER_HIGH_RISK` (`high` severity): Budget line item triggers `>= 1` forensic scrutiny rule **AND** has verified NOCOPO or Open Treasury cash disbursement (`DIRECT_PROJECT_PAID` or `VENDOR_MDA_PAID`) — highest priority for citizen physical site verification.
  3. `ZOMBIE_RECURRING_LINEAGE` (`high` severity): Line item belongs to a multi-year recurring lineage (`>= 3` budget cycles or `VENDOR_SWITCHED_REPEAT`) that keeps reappearing across annual budgets.
  4. `OAUGF_INDICTED_MDA_RISKY_SPEND` (`high` severity): High-value (`>= ₦100M`) capital or discretionary line item placed under an MDA with **`>= 10` OAuGF Constitutional Audit queries or `>= 1` Repeat/Ignored audit query**.
  5. `PERSONAL_OR_OPAQUE_PAYOUT_MDA_RISK` (`high` severity): Capital/discretionary allocation (`>= ₦100M`) under an MDA flagged for **`STAFF_OR_INDIVIDUAL` personal bank account disbursements (`₦1.49T` pool) or blank-description Treasury vouchers (`₦1.41T` pool)**.
  6. `REPEAT_ASSET_LIFESPAN_VIOLATION` (`medium` severity): Vehicle, generator, IT, or furniture procurement (`>= ₦50M`) by an MDA flagged in `asset_inventory_index.json` for repeat procurement within the asset's statutory usable lifespan.
- **Target Files:**
  - **Ingestion `[New]`:** `ingestion/indexers/evidence_engine_indexer.py`
  - **Checkpoint Helper `[New]`:** `ingestion/checkpoints/phase5_checkpoint.py` (`ingestion/checkpoints_data/phase5_evidence_checkpoints.json`)
  - **Dataset `[New]`:** `public/datasets/evidence_engine_all_years.json` (`< 650 KB`, containing:
    - `summary`: 28-year total records scanned, total rule findings, total deduplicated flagged projects, total flagged Naira, total duplicate clusters, cross-ledger hit counts
    - `rulesCatalog`: all `22` rules with 28-year hit count, 28-year Naira exposure, peak year, and top offending MDA
    - `byYear`: per-year (`1999–2026`) rule counts, Naira exposure, duplicate cluster counts, and cross-ledger counts
    - `topFlaggedMdasAllTime`: top `60` MDAs ranked by 28-year rule findings & compound risk exposure, pre-joined with OAuGF issue counts, Integrity Grade, and Personal/Opaque payout flags
    - `topCompoundProjectsAllTime`: top `120` highest-risk compound projects across `1999–2026` triggering `>= 3` rules/ledgers simultaneously
    - `activeYearCrossLedgerLookup`: compact lookup of project codes / normalized MDA risk profiles so the client-side Web Worker can apply all `6` cross-ledger rules live on any selected year (`1999–2026`) in `< 30 ms`)
  - **Tests `[New]`:** `tests/python/test_evidence_engine_indexer.py`
- **Checkpoint `EE-CP-1` Gate:**
  - Verify `evidence_engine_all_years.json` builds deterministically across all `28` years (`559,325` records), all `22` rules populate, file size `< 750 KB`, and `pytest tests/python/test_evidence_engine_indexer.py` passes.

---

### Stage `P5-S2` (`Checkpoint EE-CP-2`): Client-Side Rule Engine v3.0, Cross-Ledger Context & Compound Project Grouping
- **Objective:** Upgrade [src/utils/ruleEngine.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/ruleEngine.ts), [src/workers/forensicWorker.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/workers/forensicWorker.ts), and [src/services/forensicRunner.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/services/forensicRunner.ts) to v3.0 so every single-year scan (`1999–2026`) evaluates all **`22` rules** (both the `16` text/domain rules and the `6` cross-ledger forensic rules using the lightweight cross-ledger lookup) AND computes a deduplicated **`compoundProjects`** list (`CompoundFlaggedProject[]`) where each flagged project is scored across all triggered rules + external ledger badges.
- **Target Files:**
  - **Utils & Worker `[Update]`:** [src/utils/ruleEngine.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/ruleEngine.ts), [src/workers/forensicWorker.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/workers/forensicWorker.ts), [src/services/forensicRunner.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/services/forensicRunner.ts)
  - **Loader Utility `[New]`:** `src/utils/evidenceEngineV3.ts` (loads & caches `/datasets/evidence_engine_all_years.json` + builds `CrossLedgerRuleContext` for any fiscal year)
  - **Tests `[Update]`:** [tests/unit/forensicRunner.test.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/unit/forensicRunner.test.ts)
- **Technical Rules:**
  - Backwards-compatible: calling `applyRules(projects)` without a `CrossLedgerRuleContext` still runs all `16` v2.0 rules deterministically so existing unit tests remain 100% green; passing `CrossLedgerRuleContext` activates the `6` cross-ledger rules (`22` total) and attaches `crossLedgerBadges` (`paidOnPaper`, `billInsertionDeltaPct`, `recurringYearsCount`, `mdaOaugfIssuesCount`, `mdaIntegrityGrade`, `mdaStaffPayoutNaira`) to every `EvidenceItem` and `CompoundFlaggedProject`.
  - Compute `compoundRiskScore` (`0–100`) per deduplicated project based on number of triggered rules, severity weights, and cross-ledger convergence count.
- **Checkpoint `EE-CP-2` Gate:**
  - Verify `npx tsc -b` and `npx vitest run tests/unit/forensicRunner.test.ts` pass with zero regressions.

---

### Stage `P5-S3` (`Checkpoint EE-CP-3`): Evidence Engine v3.0 Workspace UI (`?tab=evidence`) & Verified PDF/DOCX Dossier Export
- **Objective:** Transform the `?tab=evidence` tab ([src/components/EvidenceEngineSummaryWidget.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/EvidenceEngineSummaryWidget.tsx) and [src/components/RecentFlaggedProjects.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/RecentFlaggedProjects.tsx)) into a 3-mode forensic workbench with **1-click Casebook Pinning** and **PDF/DOCX Evidence Engine Dossier Export**:
  1. **Mode 1 — Compound Multi-Flag Projects (`FY Selected`):** Deduplicated ranking of projects that trigger multiple rules + cross-ledger badges simultaneously (showing all triggered rule pills, `Paid on Paper` badge, `Bill Insertion` badge, `OAuGF Queries` badge, `MDA Grade`, and `Pin to Casebook`).
  2. **Mode 2 — All Rule Findings Ledger (`FY Selected`):** Filterable by any of the `22` rules, rule category (`Text & Mandate Rules` vs `Cross-Ledger Forensic Rules`), severity, or cross-ledger filter (`Paid on Paper Only`, `Legislative Insertions Only`, `OAuGF-Indicted MDAs Only`).
  3. **Mode 3 — 28-Year Historical Evidence Matrix (`1999–2026`):** Powered by `evidence_engine_all_years.json`, showing 28-year rule exposure across all `559,325` records, All-Time Top Rule-Triggering MDAs (`1999–2026`), and All-Time Top Compound-Flagged Projects (`1999–2026`) with 1-click year/project jump.
- **Target Files:**
  - **UI `[Update]`:** [src/components/EvidenceEngineSummaryWidget.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/EvidenceEngineSummaryWidget.tsx), [src/components/RecentFlaggedProjects.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/RecentFlaggedProjects.tsx), [src/App.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/App.tsx)
  - **Exporters `[Update]`:** [src/utils/documentExporter.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/documentExporter.ts) (add `exportEvidenceEngineDossierPdf()` and `exportEvidenceEngineDossierDocx()`)
  - **Tests `[Update]`:** [tests/unit/documentExporter.test.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/unit/documentExporter.test.ts)
- **Checkpoint `EE-CP-3` Gate:**
  - Verify `%PDF-` and OOXML `PK` binary headers for `exportEvidenceEngineDossierPdf` / `exportEvidenceEngineDossierDocx` in Vitest and zero developer CLI strings in `src/**/*.tsx`.

---

### Stage `P5-S4` (`Checkpoint EE-CP-4`): Duplicate Detector Cross-Ledger Reality Check (`?tab=duplicates`) & PDF/DOCX Export
- **Objective:** Upgrade [src/components/DuplicateClustersExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/DuplicateClustersExplorer.tsx) so investigators can immediately see which duplicate or split-allocation clusters intersect real cash, legislative insertions, or OAuGF contract-splitting queries:
  - Enrich each `DuplicateCluster` with cross-ledger indicators:
    - **`Paid on Paper` count:** How many items inside the duplicate cluster have verified NOCOPO/GovSpend cash payouts.
    - **`Legislative Insertion` count:** How many items in the cluster were inserted or padded during National Assembly Bill-vs-Act markup.
    - **`OAuGF Indicted MDA` badge:** Whether the agencies involved in the cluster have OAuGF constitutional audit findings (especially procurement/contract-splitting queries) or Grade `D`/`F` scorecards.
  - Add a **"High-Scrutiny Cross-Ledger Clusters"** quick-filter pill and **1-click PDF/DOCX Duplicate Cluster Dossier Export** (`exportDuplicateClustersDossierPdf` / `exportDuplicateClustersDossierDocx`).
- **Target Files:**
  - **UI `[Update]`:** [src/components/DuplicateClustersExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/DuplicateClustersExplorer.tsx)
  - **Exporters `[Update]`:** [src/utils/documentExporter.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/documentExporter.ts)
- **Checkpoint `EE-CP-4` Gate:**
  - Verify `DuplicateClustersExplorer.tsx` compiles cleanly, cross-ledger badges render accurately, and PDF/DOCX export tests pass.

---

### Stage `P5-S5` (`Checkpoint EE-CP-5`): Stage 6 OAuGF & 6-Ledger Convergence in `ProjectEvidenceModal`, Smarter FOI Letters, Cascade & Full Verification Gate
- **Objective:**
  1. Upgrade [src/components/ProjectEvidenceModal.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/ProjectEvidenceModal.tsx):
     - In **"Why Flagged (Matched Review Criteria)"**, dynamically list every Rule Engine v3.0 rule triggered by that project (with exact severity, rule ID, and forensic explanation) instead of only the 3 generic metadata bullets.
     - Add a **"Stage 6: Constitutional Audit (OAuGF) & 6-Ledger MDA Risk Profile"** card right below the 5-stage `ProjectLifecycleStepper`, showing the executing MDA's OAuGF audit query count, Naira queried, repeat/ignored findings, Composite Integrity Grade (`A`–`F`), and personal/staff bank account payout exposure (`₦1.49T` pool) with 1-click jump to `?tab=oaugf`.
     - Upgrade the **FOI Act 2011 Demand Letter** (`foiLetterText`) and **National Assembly Oversight Notice** (`repLetterText`) so that when a project triggers Rule Engine v3.0 rules, Paid-on-Paper status, Bill-vs-Act insertion, or OAuGF MDA queries, those exact verified public-record citations are automatically included in the legal demand letter.
  2. Register `evidence_engine` in [ingestion/indexers/cascade.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/cascade.py) (`--phase5` / `run_phase5()`), [ingestion/indexers/build_provenance_manifest.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/build_provenance_manifest.py), and [backend/routers/ai.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/backend/routers/ai.py) / [src/utils/aiForensicEngine.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/aiForensicEngine.ts).
  3. Run the full verification gate (`pytest`, UI hygiene scan, `tsc -b`, `vitest`, `npm run build`).
- **Target Files:**
  - **UI & AI `[Update]`:** [src/components/ProjectEvidenceModal.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/ProjectEvidenceModal.tsx), [src/utils/aiForensicEngine.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/aiForensicEngine.ts), [backend/routers/ai.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/backend/routers/ai.py)
  - **Ingestion `[Update]`:** [ingestion/indexers/cascade.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/cascade.py), [ingestion/indexers/build_provenance_manifest.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/build_provenance_manifest.py)
- **Checkpoint `EE-CP-5` Gate:**
  - `.venv\Scripts\python.exe -m pytest tests/python/` (100% passing)
  - Recursive `src/**/*.tsx` check confirming `ZERO_UI_DEVELOPER_STRINGS_RECURSIVE`
  - `npx tsc -b; if ($LASTEXITCODE -eq 0) { npx vitest run }; if ($LASTEXITCODE -eq 0) { npm run build }` (exit `0`)

---

## 4. Master Checkpoint Tracker (`phase5_evidence_checkpoints.json`)

| Checkpoint | Stage | Deliverable Title | Primary Outputs | Status |
|---|---|---|---|---|
| **`EE-CP-1`** | **P5-S1** | All-Years (`1999–2026`) Cross-Ledger Evidence Engine Builder (`559,391` records × `22` rules -> `46,255` findings / `27,859` cross-ledger / `27,082` flagged projects) | `public/datasets/evidence_engine_all_years.json` | `COMPLETED` |
| **`EE-CP-2`** | **P5-S2** | Client-Side Rule Engine v3.0 (`16` Text + `6` Cross-Ledger Rules) & Compound Project Scoring (`5/5` Vitest passed) | `src/utils/ruleEngine.ts`, `src/utils/evidenceEngineV3.ts`, `src/services/forensicRunner.ts` | `COMPLETED` |
| **`EE-CP-3`** | **P5-S3** | Evidence Engine v3.0 3-Mode Workbench (`?tab=evidence`), Casebook Pinning & PDF/DOCX Dossier (`6/6` Vitest passed) | `EvidenceEngineSummaryWidget.tsx`, `RecentFlaggedProjects.tsx`, `documentExporter.ts` | `COMPLETED` |
| **`EE-CP-4`** | **P5-S4** | Duplicate Detector Cross-Ledger Reality Check (`?tab=duplicates`) & PDF/DOCX Dossier Export (`6/6` Vitest passed) | `DuplicateClustersExplorer.tsx`, `documentExporter.ts` | `COMPLETED` |
| **`EE-CP-5`** | **P5-S5** | Stage 6 OAuGF & 6-Ledger Card + Smarter FOI Letters in `ProjectEvidenceModal`, Cascade & Full Verification Gate (`71` pytest, `77` vitest, `0` UI CLI leaks, Vite prod build) | `ProjectEvidenceModal.tsx`, `cascade.py`, `source_provenance.json`, `phase5_evidence_checkpoints.json` | `COMPLETED` |
