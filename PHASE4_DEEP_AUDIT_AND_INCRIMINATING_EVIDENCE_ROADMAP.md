# BudgetLens Phase 4 — All-Years OAuGF Recovery, Hidden Treasury Payouts & Multi-Layer Red-Flag Convergence Roadmap

> **Document Status:** `COMPLETED — ALL CHECKPOINTS (CP-1 TO CP-5) VERIFIED (2026-11-23)`  
> **Created:** `2026-11-23`  
> **Predecessors:** [IMPLEMENTATION_ROADMAP.md](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/IMPLEMENTATION_ROADMAP.md) (Phase 1) | [PHASE2_IMPLEMENTATION_ROADMAP.md](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/PHASE2_IMPLEMENTATION_ROADMAP.md) (Phase 2) | [PHASE3_CROSS_DATASET_INTELLIGENCE_ROADMAP.md](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/PHASE3_CROSS_DATASET_INTELLIGENCE_ROADMAP.md) (Phase 3 — Completed)  
> **Objective:** Unlock **every available fiscal and audit year (`1999–2026`)** and surface **every incriminating / high-scrutiny signal** sitting across our extracted OAuGF constitutional audit archive (`36` reports / `11,372` pages), Open Treasury payment ledger (`467,763` vouchers / `₦47.53T`), NOCOPO procurement database (`98,866` OCIDs), Bill-vs-Act legislative padding diffs, BIR execution reports, and recurring project lineages — with deterministic disk checkpoints after every stage.

---

## 1. Mandatory Governance & Checkpoint Rules

1. **Sequential Checkpoint Gate (Hard Stop or Approved Batching):**
   - Each stage (`P4-S1` through `P4-S5`) writes a deterministic checkpoint record into `ingestion/checkpoints_data/phase4_checkpoints.json` (recording timestamp, output SHA-256 digests, row counts, and verification status) while **never modifying or deleting existing Stage-2 budget checkpoints (`1999`–`2026`) or `ingestion/ocr_cache/`**.
2. **100% Static-First Serving (`public/datasets/`):**
   - Every new or upgraded dataset under `public/datasets/` must work offline without requiring `uvicorn`. Any detail payload exceeding `2.5 MB` is deterministically sharded so initial page loads stay fast on mobile and desktop.
3. **Zero Developer / CLI Strings in Public UI:**
   - Zero `uvicorn`, `FastAPI`, `python -m`, or `.exe -m` strings anywhere in `src/**/*.tsx`.
4. **Strict Download Policy (PDF & DOCX Only):**
   - Every new dossier export routes exclusively through `triggerVerifiedDocumentDownload()` + `sanitizePdfText()` in [src/utils/documentExporter.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/documentExporter.ts), verified for `%PDF-` and `PK` OOXML binary headers in Vitest.
5. **Strict Grounded AI Hygiene:**
   - Never expose `.pdf`, `.json`, or `.csv` filenames or internal dataset jargon (`NOCOPO`, `GovSpend`, `MTEF/FSP`, `SQL/FTS5`, `Budget Implementation Report`) in AI answers or follow-up suggestions.
6. **Zero Fabrication & Evidence-First Framing:**
   - Every surfaced irregularity must cite its exact official source (OAuGF report year & page, GovSpend voucher count/date/payer/description, NOCOPO OCID/stage, or Appropriation Act page) and clearly distinguish *verified public-record discrepancies / audit queries* from court convictions.

---

## 2. Verified Unexposed Signals Discovered on Disk (`2026-11-23` Audit)

Our live database probe across [ingestion/oaugf_extracted/](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/oaugf_extracted/index.json) and [backend/data/external_ledger_fts.sqlite](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/backend/data/external_ledger_fts.sqlite) confirmed **four major pools of incriminating / high-scrutiny evidence** that are already on disk but not yet fully extracted or surfaced:

| Discovery Area | Current State | Newly Discovered / Unexposed Volume on Disk | Target Stage |
|---|---|---|---|
| **1. Remaining 24 OAuGF Audit Reports (`1999–2022`)** | Only `12/36` reports using literal `"ISSUE N:"` headers (`3,385` findings) were parsed; `24/36` reports show `0` issues in the UI, and `5` reports lack year tags (`2009`, `2012`, `SMEDAN`, `Lake Chad`) | Multi-format section (`2.01`, `3.1.2`), numbered paragraph (`12. ...`), and tabular finding extraction (`COVID-19 Special Audit` NCDC `₦1.15B` off-portal spend, `1999 AGF Reports`, `2007–2014 Annual Reports`, `2016 Annual Report`, `2020 Consolidated Financial Statement`, `FERMA`, `NERC`, `Crude Oil Pre-Shipment 2016–2020`, `Affordable Housing`) unlocks **`6,824+` total audit findings across all substantive OAuGF reports (`1999–2024`)** | **`P4-S1`** |
| **2. `₦1.49T` Individual / Staff-Account Payouts & `₦1.26T` Unclassified Payees** | [VendorCaptureNetworkView.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/VendorCaptureNetworkView.tsx) currently surfaces only `PRIVATE_CORPORATE` Off-NOCOPO companies (`25,869` firms / `₦6.74T`) | **`10,851` `STAFF_OR_INDIVIDUAL` beneficiaries** received **`56,878` Treasury vouchers totaling `₦1,488.27B` (`₦1.49T`)**, including **`235` individuals receiving `>= ₦1B` each**; plus **`4,169` `UNCLASSIFIED` payees** (`29,725` vouchers / **`₦1,262.24B`** / `190 >= ₦1B`) — directly intersecting OAuGF warnings on *paying public funds/contractors through staff accounts* | **`P4-S2`** |
| **3. `₦2.44T` Opaque, Blank-Description & Self-Serving Treasury Vouchers** | [govspend_forensics.json](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/public/datasets/govspend_forensics.json) currently tracks only December Rush, Threshold Splitting, and Cash Benford MAD | Across `467,763` GovSpend vouchers: **`12,468` Vague/Blank Description vouchers (`< 12` chars) totaling `₦1,407.29B` (`₦1.41T`)**; **`5,045` Personal/Staff Advance, Imprest & Refund vouchers (`₦567.26B`)**; **`7,823` Consultancy, Legal & Sensitization vouchers (`₦229.97B`)**; **`1,602` SUV/Hilux/Motor Vehicle cash vouchers (`₦101.21B`)**; **`4,462` Estacode/Foreign Travel/DTA vouchers (`₦74.03B`)**; **`1,966` Welfare/Honorarium/Sitting Allowance vouchers (`₦59.72B`)** | **`P4-S3`** |
| **4. Multi-Layer Red-Flag Convergence Across All 6 Ledgers** | Each risk signal (`Padding`, `Non-Competitive`, `Overruns`, `>125% Treasury Overpayment`, `Zombie Lineages`, `OAuGF Queries`) is viewed in isolation | Cross-entity convergence scoring linking contractors & MDAs that trigger **`>= 3` independent forensic red flags simultaneously** (e.g., `>125%` Treasury payout excess like `CCECC +₦251.92B` or `JRB Constructions +₦87.84B` + non-competitive/variation overruns + OAuGF audit queries + padded budget line items) | **`P4-S4`** |

---

## 3. Complete Year Coverage Matrix (`1999–2026`)

| Data Layer | Years Available on Disk | Gap / Recovery Action in Phase 4 |
|---|---|---|
| **1. Federal Budgets (Acts & Schedules)** | All **`28` years (`1999–2026` consecutive)** | Already 100% indexed (`559,325` records) |
| **2. OAuGF Constitutional Audit Reports** | **`1999`, `2005`, `2007`, `2008`, `2009`, `2010`, `2011`, `2012`, `2013`, `2014`, `2016`, `2017`, `2018`, `2019`, `2020`, `2021–2022` (Special/Performance), `2023`, `2024`** *(Note: `2000`, `2002–2004`, `2015` are HTTP `404` broken links on upstream `oaugf.ng`)* | **`P4-S1`** recovers missing year tags (`2009`, `2012`, `2015` Lake Chad, `2018–2022` Performance Audits) and extracts findings from all `24` previously zero-issue reports (`6,824+` findings total) |
| **3. BIR Execution Reports** | All **`18` years (`2009–2026` consecutive)** | Already 100% indexed (`execution_tracker.json` + `1,247` `bir_ocr_fts` chunks) |
| **4. NOCOPO Contracts (BPP OCDS)** | **`2012–2026`** (`98,866` OCIDs; `16,726` awarded / `₦4.38T`) | Cross-linked into Multi-Layer Convergence (`P4-S4`) |
| **5. Open Treasury (GovSpend)** | **`2018-09-01` to `2026-06-19`** (`467,763` vouchers / `₦47.53T`) | Staff/Individual (`₦1.49T`) & Opaque/Discretionary (`₦2.44T`) forensic layers added in `P4-S2` & `P4-S3` |
| **6. Bill vs. Act Padding Cycles** | **`7` cycles (`2017`, `2019`, `2020`, `2021`, `2022`, `2023`, `2025`)** | Cross-linked into Multi-Layer Convergence (`P4-S4`) |

---

## 4. Phased Implementation Plan & Checkpoints (`P4-S1` through `P4-S5`)

### Stage `P4-S1` (`Checkpoint CP-1`): All-Years OAuGF Multi-Format Audit Recovery (`1999–2024`)
- **Objective:** Recover every audit finding across all `35` substantive OAuGF reports (`1999–2024`), fix missing year metadata on untagged reports (`2009`, `2012`, `2015`, `2016–2022` special audits), and shard full issue lists so the UI stays fast (`< 2.5 MB` per file).
- **Target Files:**
  - **Ingestion `[Update]`:** [ingestion/indexers/oaugf_indexer.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/oaugf_indexer.py)
  - **Datasets `[New/Update]`:** [public/datasets/oaugf_audit_index.json](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/public/datasets/oaugf_audit_index.json) (compact summary + top 500 findings `< 600 KB`) + sharded full findings `public/datasets/oaugf_issues/*.json` (by report year bucket so all **`6,800+` findings** load on demand, each `< 1.2 MB`)
  - **UI `[Update]`:** [src/components/OaugfNegligenceExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/OaugfNegligenceExplorer.tsx), [src/utils/mdaScorecard.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/mdaScorecard.ts)
  - **Tests `[Update]`:** [tests/python/test_oaugf_audit.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/python/test_oaugf_audit.py)
- **Technical Rules:**
  - Parse 4 distinct OAuGF document formats:
    1. `ISSUE N:` / `AUDIT QUERY N:` / `FINDING N:` (`2016–2024` Non-Compliance & NDDC reports)
    2. Numbered section headings `^\d+\.\d+(?:\.\d+)?\s+[A-Z]...` containing irregularity or Naira keywords (`2007–2016` Annual Reports, `FERMA`, `NERC`, `Budget Prep`)
    3. Numbered paragraph/table findings (`S/N | Findings | Risks | Recommendation` in `COVID-19 Special Audit`, `Crude Oil Pre-Shipment`, `Affordable Housing`)
    4. Narrative audit paragraphs in `1999 AGF Reports` (`id=30, 31, 32`) and `2020 Consolidated Financial Statement` (`id=41`)
  - Infer missing report years deterministically from title/cover page (`25-2009-annual-report` → `2009`, `28-2012-annual-report` → `2012`, Lake Chad → `2015`, SMEDAN → `2016`) and explicitly flag upstream `oaugf.ng` `404` years (`2000`, `2002–2004`, `2015`) in the coverage banner so citizens see complete transparency across `1999–2024`.
- **Checkpoint `CP-1` Gate:**
  - Verify `parsedAuditIssuesCount >= 6,500`, `>= 30/35` substantive reports with extracted findings, every static JSON file `< 2.5 MB`, and `pytest tests/python/test_oaugf_audit.py` passing.

---

### Stage `P4-S2` (`Checkpoint CP-2`): `₦1.49T` Personal / Staff-Account Payouts & `₦1.26T` Unclassified Beneficiaries Audit
- **Objective:** Expose the `10,851` `STAFF_OR_INDIVIDUAL` beneficiaries (`₦1.49T` across `56,878` vouchers; `235` individuals `>= ₦1B`) and `4,169` `UNCLASSIFIED` payees (`₦1.26T` across `29,725` vouchers; `190 >= ₦1B`) that received federal Treasury disbursements without public NOCOPO contracts.
- **Target Files:**
  - **Ingestion `[Update]`:** [ingestion/indexers/vendor_network_builder.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/vendor_network_builder.py)
  - **Dataset `[Update]`:** [public/datasets/vendor_network_index.json](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/public/datasets/vendor_network_index.json)
  - **UI & Exporters `[Update]`:** [src/components/VendorCaptureNetworkView.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/VendorCaptureNetworkView.tsx), [src/utils/vendorNetwork.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/vendorNetwork.ts), [src/utils/documentExporter.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/documentExporter.ts)
  - **Tests `[Update]`:** [tests/python/test_vendor_network.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/python/test_vendor_network.py), [tests/unit/vendorNetwork.test.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/unit/vendorNetwork.test.ts)
- **Technical Rules:**
  - Add `topStaffOrIndividualPayees` (top `100` personal/staff-named accounts with voucher counts, total Naira, paying MDAs, year span, sample descriptions, and sub-tag: `Contract/Supply via Individual`, `Cash Advance/Imprest`, `Travel/Estacode/DTA`, `Opaque/Blank Description`, or `Allowance/Other`) and `topUnclassifiedPayees` (top `60`) to `offNocopoAudit` in `vendor_network_index.json`.
  - Add a dedicated **"Staff / Personal Accounts (`₦1.49T`) & Unclassified (`₦1.26T`)"** sub-tab in `VendorCaptureNetworkView.tsx` with clear editorial disclosure and PDF/DOCX export support.
- **Checkpoint `CP-2` Gate:**
  - Verify `topStaffOrIndividualPayees` and `topUnclassifiedPayees` populate cleanly, `vendor_network_index.json < 500 KB`, and `pytest tests/python/test_vendor_network.py` + `vitest` pass.

---

### Stage `P4-S3` (`Checkpoint CP-3`): `₦2.44T` Opaque, Blank-Description & Discretionary Cash Forensics
- **Objective:** Surface the `33,366` high-risk discretionary and opaque Treasury vouchers (`₦2.44 Trillion`) inside [govspend_forensics.json](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/public/datasets/govspend_forensics.json) and [StatisticalForensicsLab.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/StatisticalForensicsLab.tsx).
- **Target Files:**
  - **Ingestion `[Update]`:** [ingestion/indexers/govspend_forensics_builder.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/govspend_forensics_builder.py)
  - **Dataset `[Update]`:** [public/datasets/govspend_forensics.json](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/public/datasets/govspend_forensics.json)
  - **UI & Exporters `[Update]`:** [src/components/StatisticalForensicsLab.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/StatisticalForensicsLab.tsx), [src/utils/documentExporter.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/documentExporter.ts)
  - **Tests `[Update]`:** [tests/python/test_govspend_forensics.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/python/test_govspend_forensics.py), [tests/unit/statisticalForensics.test.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/unit/statisticalForensics.test.ts)
- **Technical Rules:**
  - Add `discretionaryAndOpaqueAudit` to `govspend_forensics.json` covering all 6 verified categories:
    1. `OPAQUE_BLANK_DESCRIPTION` (`12,468` vouchers / `₦1,407.29B` where `len(trim(description)) < 12`)
    2. `STAFF_ADVANCE_IMPREST_REFUND` (`5,045` vouchers / `₦567.26B`)
    3. `CONSULTANCY_LEGAL_SENSITIZATION` (`7,823` vouchers / `₦229.97B`)
    4. `LUXURY_SUV_MOTOR_VEHICLES` (`1,602` vouchers / `₦101.21B`)
    5. `ESTACODE_FOREIGN_TRAVEL_DTA` (`4,462` vouchers / `₦74.03B`)
    6. `WELFARE_HONORARIUM_SITTING_REFRESHMENT` (`1,966` vouchers / `₦59.72B`)
  - For each category, precompute total vouchers, total Naira, top paying MDAs, and top `25` largest individual vouchers (date, payer MDA, beneficiary, amount, verbatim description).
  - Render an interactive **"Opaque & Discretionary Cash (`₦2.44T`)"** section inside `StatisticalForensicsLab.tsx` (`?fsub=govspend`) and include it in the GovSpend Forensics PDF/DOCX Dossier.
- **Checkpoint `CP-3` Gate:**
  - Verify all 6 categories in `govspend_forensics.json` (`< 400 KB`), `pytest tests/python/test_govspend_forensics.py`, and `vitest` pass.

---

### Stage `P4-S4` (`Checkpoint CP-4`): Multi-Layer Red-Flag Convergence Index ("Repeat Offenders Across All 6 Ledgers")
- **Objective:** Cross-link contractors and MDAs that simultaneously trigger red flags across multiple independent forensic ledgers so investigators and citizens can see **where all red flags converge**.
- **Target Files:**
  - **Ingestion `[New]`:** `ingestion/indexers/red_flag_convergence_builder.py`
  - **Dataset `[New]`:** `public/datasets/red_flag_convergence_index.json` (`< 500 KB`)
  - **UI & Exporters `[Update]`:** [src/components/OaugfNegligenceExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/OaugfNegligenceExplorer.tsx) (or dedicated convergence tab in [ExecutionProcurementExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/ExecutionProcurementExplorer.tsx) & [CitizenAccountabilityHub.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/CitizenAccountabilityHub.tsx)), [src/components/ContractorHistoryModal.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/ContractorHistoryModal.tsx), [src/utils/documentExporter.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/documentExporter.ts)
  - **Tests `[New]`:** `tests/python/test_red_flag_convergence.py`
- **Technical Rules:**
  - Score every canonical **Contractor** across 5 binary risk dimensions:
    1. `OVERPAID_GT_125_PCT` (GovSpend payouts `> 125%` of NOCOPO awards)
    2. `NON_COMPETITIVE_AWARDS` (Direct/Emergency/Selective procurement)
    3. `CONTRACT_VARIATION_OVERRUN` (`total_paid_naira > contract_award_naira`)
    4. `CAPTIVE_OR_MULTI_MDA_DOMINANCE` (`>= 40%` MDA share or `>= 5` MDAs)
    5. `PADDED_OR_ZOMBIE_LINEAGE_LINK` (won contract on a legislature-inserted diff item or vendor-switched recurring lineage)
  - Score every canonical **MDA** across 6 binary risk dimensions:
    1. `LOW_INTEGRITY_GRADE` (Composite Scorecard Grade `D` or `F`)
    2. `HIGH_OAUGF_NEGLIGENCE` (`>= 10` OAuGF audit queries or `>= 1` Repeat/Ignored query)
    3. `DECEMBER_RUSH_OR_SPLITTING` (`>= 2.5x` Dec rush or top 7-day threshold-splitting cluster)
    4. `OPAQUE_OR_STAFF_PAYOUTS` (high blank-description or `STAFF_OR_INDIVIDUAL` payout volume)
    5. `HIGH_NON_COMPETITIVE_OR_OVERRUN` (`>= 30%` non-competitive procurement share or variation overruns)
    6. `HIGH_LEGISLATIVE_PADDING` (top positive Bill-vs-Act insertion delta)
  - Surface **"Multi-Layer Convergence Dossiers"** for top contractors and MDAs triggering `>= 3` layers simultaneously, with 1-click PDF/DOCX export.
- **Checkpoint `CP-4` Gate:**
  - Verify `red_flag_convergence_index.json` builds deterministically, `pytest tests/python/test_red_flag_convergence.py`, and `vitest` pass.

---

### Stage `P4-S5` (`Checkpoint CP-5`): Unified Cascade, Grounded AI Upgrade & Final Verification Gate
- **Objective:** Register all Phase 4 builders in [ingestion/indexers/cascade.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/cascade.py) and [ingestion/indexers/build_provenance_manifest.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/build_provenance_manifest.py), teach Grounded AI ([backend/routers/ai.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/backend/routers/ai.py) & [src/utils/aiForensicEngine.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/aiForensicEngine.ts)) to answer queries on staff-account payouts, opaque/blank vouchers, all-years OAuGF findings (`1999–2024`), and multi-layer red-flag convergence, and pass the full regression suite.
- **Target Files:**
  - **Ingestion `[Update]`:** [ingestion/indexers/cascade.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/cascade.py), [ingestion/indexers/build_provenance_manifest.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/ingestion/indexers/build_provenance_manifest.py)
  - **AI `[Update]`:** [backend/routers/ai.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/backend/routers/ai.py), [src/utils/aiForensicEngine.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/aiForensicEngine.ts)
  - **Tests `[Update]`:** [tests/python/test_search_ai.py](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/python/test_search_ai.py), [tests/unit/aiForensicEngine.test.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/unit/aiForensicEngine.test.ts)
- **Checkpoint `CP-5` Gate:**
  - `.venv\Scripts\python.exe -m pytest tests/python/` (100% passing)
  - Recursive `src/**/*.tsx` check confirming `ZERO_UI_DEVELOPER_STRINGS_RECURSIVE`
  - `npx tsc -b; if ($LASTEXITCODE -eq 0) { npx vitest run }; if ($LASTEXITCODE -eq 0) { npm run build }` (exit `0`)

---

## 5. Master Checkpoint Tracker

| Checkpoint | Stage | Deliverable Title | Primary Outputs (`public/datasets/`) | Status |
|---|---|---|---|---|
| **`CP-1`** | **P4-S1** | All-Years OAuGF Multi-Format Audit Recovery (`1999–2024`, `7,028` findings across `30` substantive reports, `7` shards) | `oaugf_audit_index.json` + `oaugf_issues/*.json` | `COMPLETED` |
| **`CP-2`** | **P4-S2** | `₦1.49T` Personal / Staff-Account Payouts (`10,851` individuals / `235 >= ₦1B`) & `₦1.26T` Unclassified Payees Audit (`4,169` payees / `190 >= ₦1B`) | `vendor_network_index.json` (updated) | `COMPLETED` |
| **`CP-3`** | **P4-S3** | `₦2.44T` Opaque, Blank-Description & Discretionary Cash Forensics (`33,366` vouchers across `6` categories) | `govspend_forensics.json` (updated) | `COMPLETED` |
| **`CP-4`** | **P4-S4** | Multi-Layer Red-Flag Convergence Index (`29` convergent contractors / `₦583.04B`; `77` convergent MDAs / `27` at `>= 3` layers) | `red_flag_convergence_index.json` | `COMPLETED` |
| **`CP-5`** | **P4-S5** | Unified Cascade, Grounded AI Integration & Full Verification Gate (`70` pytest, `75` vitest, `0` UI CLI leaks, Vite prod build) | `source_provenance.json`, `phase4_checkpoints.json` | `COMPLETED` |
