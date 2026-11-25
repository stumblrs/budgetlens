# BudgetLens Phase 6 — Full Observatory 6-Ledger Unification & Polish Implementation Roadmap

> **Document Status:** `PLANNED — READY FOR PHASED EXECUTION`  
> **Created:** `2026-11-23`  
> **Source Input:** [OUR_SUGGESTIONS.md](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/OUR_SUGGESTIONS.md)  
> **Predecessors:** [PHASE4_DEEP_AUDIT_AND_INCRIMINATING_EVIDENCE_ROADMAP.md](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/PHASE4_DEEP_AUDIT_AND_INCRIMINATING_EVIDENCE_ROADMAP.md) (Completed) | [PHASE5_EVIDENCE_ENGINE_V3_ROADMAP.md](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/PHASE5_EVIDENCE_ENGINE_V3_ROADMAP.md) (Completed)  
> **Already Upgraded Baseline:** **Overview** (`?tab=overview`), **Presidential Scrutiny** (`?tab=scrutiny` — `₦24.57T` / `$37.03B`), **Evidence Engine v3.0** (`?tab=evidence` + `?tab=duplicates` + `ProjectEvidenceModal`), **Sources & Methodology** (`?tab=methodology`), and **OAuGF Negligences** (`?tab=oaugf`).  
> **Objective:** Unify all **11 remaining observatory tabs** onto the same 6-ledger forensic architecture — wiring **OAuGF Constitutional Audits (`7,028` findings / `36` reports)**, **Open Treasury Cash Forensics (`₦1.49T` personal/staff accounts & `₦2.44T` opaque/discretionary vouchers)**, **Red-Flag Convergence**, **Evidence Engine v3.0 (`22` rules / `49,679` findings across `559,391` records)**, and the refreshed **`₦24.57T` (`$37.03B`) Fourth Republic baseline** across every explorer, chart, export, and AI query, with strict checkpoint gates (`P6-CP-1` through `P6-CP-6`).

---

## 1. Mandatory Governance, Hygiene & Verification Rules

Every phase (`P6-S1` through `P6-S6`) MUST satisfy all six invariants before its checkpoint can be marked `COMPLETED`:

1. **100% Static-First Offline Serving (`public/datasets/`):**
   - Zero runtime dependency on `uvicorn` or live backend APIs for core data rendering. All 6-ledger payloads (`oaugf_audit_index.json`, `govspend_forensics.json`, `evidence_engine_all_years.json`, `red_flag_convergence_index.json`, `forensic_sweep_1999_2026.json`, `project_lifecycle_index.json`, `mda_integrity_scorecards.json`, `macro_credibility_tracker.json`, `bill_act_diffs/index.json`, `asset_inventory_index.json`) are already precomputed on disk.
2. **Zero Developer / CLI Strings in Public UI:**
   - Zero occurrences of `uvicorn`, `FastAPI`, `python -m`, or `.exe -m` anywhere in `src/**/*.tsx`.
3. **Strict Export Policy (PDF & DOCX Only):**
   - Every new or upgraded export must route exclusively through `triggerVerifiedDocumentDownload()` and `sanitizePdfText()` in [src/utils/documentExporter.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/documentExporter.ts) and be verified for `%PDF-` and OOXML `PK` binary headers in Vitest.
4. **Strict Grounded AI Public Hygiene:**
   - Never expose `.pdf`, `.json`, or `.csv` filenames or internal dataset jargon (`NOCOPO`, `GovSpend`, `MTEF/FSP`, `SQL/FTS5`, `Budget Implementation Report`) in AI answers or suggested follow-up prompts.
5. **No Double-Counting Across Fiscal Stages:**
   - Enacted Appropriation totals (`₦24.57T` / `$37.03B`), Legislative Bill-vs-Act deltas, Open Treasury cash vouchers (`₦47.53T`), and OAuGF post-mortem audit queries are always presented as **distinct, cross-referenced accountability layers**, never summed blindly into a single figure.
6. **Non-Destructive Checkpoint Integrity:**
   - Never delete or overwrite Stage-2 annual budget checkpoints (`ingestion/checkpoints_data/`) or `ingestion/ocr_cache/`.

---

## 2. Phased Implementation Plan & Checkpoints (`P6-CP-1` to `P6-CP-6`)

### Phase 6A (`Checkpoint P6-CP-1`): Statistical Forensics — Personal/Staff Accounts & Opaque Cash Vouchers (`?tab=forensics`)
- **Priority:** `Tier 1 (Item 1)`
- **Problem Statement:** The Cash Forensics sub-tab (`?tab=forensics&fsub=govspend`) in [StatisticalForensicsLab.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/StatisticalForensicsLab.tsx) currently surfaces December Rush, Threshold Splitting, and Benford's Law, but omits our newly indexed **`33,366` Opaque / Blank-Description & Discretionary Cash Vouchers (`₦2.44T`, including `₦1.41T` blank descriptions)** and **`10,851` Personal / Staff Bank Account beneficiaries (`₦1.49T`)**, as well as OAuGF audit cross-links for flagged MDAs.
- **Deliverables:**
  1. Extend `GovspendForensicsPayload` in [StatisticalForensicsLab.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/StatisticalForensicsLab.tsx) to consume `discretionaryAndOpaqueAudit` from `govspend_forensics.json` and personal-account beneficiary metrics from `govspend_beneficiary_risk.json` / `red_flag_convergence_index.json`.
  2. Add two dedicated interactive panels inside the Cash Forensics sub-tab:
     - **Personal / Staff Bank Account Disbursements (`₦1.49T` across `10,851` payees):** Top receiving individuals/staff payees, paying MDAs, voucher counts, and OAuGF cross-link badges.
     - **Opaque / Blank-Description & Discretionary Cash Vouchers (`₦2.44T` across `33,366` vouchers):** Category filter pills (`Opaque / Blank Description`, `Travel / Estacode / DTA`, `Honorarium / Sitting / Welfare`, `Refreshment / Meals`), top offending MDAs, and verbatim sample vouchers.
  3. Upgrade `exportGovspendForensicsPdf()` and `exportGovspendForensicsDocx()` in [documentExporter.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/documentExporter.ts) to include both new cash-forensics tables.
- **Target Files:**
  - [src/components/StatisticalForensicsLab.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/StatisticalForensicsLab.tsx)
  - [src/utils/documentExporter.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/documentExporter.ts)
  - [tests/unit/statisticalForensics.test.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/unit/statisticalForensics.test.ts)
- **Verification Gate (`P6-CP-1`):**
  - `npx tsc -b` passes with 0 errors.
  - `npx vitest run tests/unit/statisticalForensics.test.ts` passes (including `%PDF-` and OOXML `PK` binary verification for the upgraded GovSpend Forensics dossier).
  - Zero developer CLI strings in `src/**/*.tsx`.

---

### Phase 6B (`Checkpoint P6-CP-2`): Executive Reports v3.0 (`?tab=reports`) & Investigator Casebook 6-Ledger Pinning (`?tab=casebook`)
- **Priority:** `Tier 1 (Item 2)` + `Tier 2 (Item 11b)`
- **Problem Statement:** [ExecutiveReportBuilderWidget.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/ExecutiveReportBuilderWidget.tsx) still invokes legacy `applyRules(rawProjects)` without `crossLedgerContext` (missing all 6 cross-ledger rules) and lacks OAuGF Constitutional Audit, Bill-vs-Act Padding, Open Treasury Personal/Opaque Cash, and Red-Flag Convergence sections. Meanwhile, [CasebookStudioPage.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/CasebookStudioPage.tsx) only bundles basic budget pins without 6-ledger audit/cash metadata.
- **Deliverables:**
  1. Wire `loadEvidenceEngineAllYears()` (`crossLedgerContext`) into [ExecutiveReportBuilderWidget.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/ExecutiveReportBuilderWidget.tsx) so all `22` Evidence Engine v3.0 rules and `compoundRiskScore` rankings run live inside the Report Builder.
  2. Add a new **"6-Ledger Accountability & Audit Brief"** template to `ReportTemplate` in [reportExporter.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/reportExporter.ts) & [ExecutiveReportBuilderWidget.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/ExecutiveReportBuilderWidget.tsx) incorporating:
     - Active-year & 28-year Evidence Engine v3.0 findings (`22` rules),
     - OAuGF Constitutional Audit negligence summary (`7,028` queries / `675` recovery orders / `54` repeat directives),
     - Legislative Bill-vs-Act insertion totals,
     - Open Treasury personal-account (`₦1.49T`) & opaque voucher (`₦2.44T`) exposure, and
     - Top Red-Flag Convergent MDAs.
  3. Upgrade [CasebookStudioPage.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/CasebookStudioPage.tsx) and [CasebookContext.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/context/CasebookContext.tsx) so pinned items support 6-ledger provenance tags (`OAuGF Query`, `Treasury Cash`, `Bill Insertion`, `Compound Risk`) and render cleanly in `exportCasebookDossierPdf()` / `exportCasebookDossierDocx()`.
- **Target Files:**
  - [src/components/ExecutiveReportBuilderWidget.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/ExecutiveReportBuilderWidget.tsx)
  - [src/utils/reportExporter.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/reportExporter.ts)
  - [src/components/CasebookStudioPage.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/CasebookStudioPage.tsx)
  - [src/utils/documentExporter.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/documentExporter.ts)
  - [tests/unit/documentExporter.test.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/unit/documentExporter.test.ts), [tests/unit/casebookAndFoi.test.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/unit/casebookAndFoi.test.ts)
- **Verification Gate (`P6-CP-2`):**
  - `npx tsc -b` passes.
  - `npx vitest run tests/unit/documentExporter.test.ts tests/unit/casebookAndFoi.test.ts` passes with valid `%PDF-` and `PK` headers for the new 6-Ledger Executive Report template and Casebook dossiers.

---

### Phase 6C (`Checkpoint P6-CP-3`): 1999–2026 Presidential Compare (`?tab=compare`) & 28-Year Multi-Ledger Trends (`?tab=trends`)
- **Priority:** `Tier 1 (Item 3)` + `Tier 2 (Item 6)`
- **Problem Statement:** [HistoricalPresidentialCompare.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/HistoricalPresidentialCompare.tsx) compares administrations only on Enacted Budgets, DMO Debt, and BIR Macro Credibility — omitting OAuGF Constitutional Audit negligence, Bill-vs-Act Padding, Open Treasury December Rush, and Evidence Engine v3.0 hits. Additionally, `?tab=trends` ([SpendingTrendChart.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/SpendingTrendChart.tsx)) currently renders only a single chart card.
- **Deliverables:**
  1. Hydrate `forensic_sweep_1999_2026.json` (`presidents[i].crossLedgerProfile`) inside [HistoricalPresidentialCompare.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/HistoricalPresidentialCompare.tsx):
     - Add **OAuGF Audit Queries (`repeat / recovery`)**, **Legislative Bill→Act Insertions**, **Open Treasury Cash & Dec Rush Ratio**, and **Evidence Engine v3.0 Rule Hits** to both the **Presidential Term Cards** and the **Head-to-Head Comparator** (`leftId` vs `rightId`).
  2. Expand `?tab=trends` ([SpendingTrendChart.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/SpendingTrendChart.tsx) + a new companion `MultiLedgerTrendExplorer` section) into a **28-Year Multi-Ledger Trajectory Explorer (`1999–2026`)**:
     - Interactive overlay toggles for **Enacted Budget Envelope (`₦T`)**, **DMO Sovereign Debt (`₦T` / `$B`)**, **BIR Capital Execution vs. Debt Service Execution (%)**, **Evidence Engine v3.0 Flagged Spend (`₦T`)**, and **OAuGF Audit Findings per Year**.
- **Target Files:**
  - [src/components/HistoricalPresidentialCompare.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/HistoricalPresidentialCompare.tsx)
  - [src/components/SpendingTrendChart.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/SpendingTrendChart.tsx)
  - [src/App.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/App.tsx) (for `?tab=trends` layout)
- **Verification Gate (`P6-CP-3`):**
  - `npx tsc -b` passes.
  - `npx vitest run tests/unit/administrationDebt.test.ts` passes.
  - Verified accurate rendering of all 5 administrations (`1999–2026`) with zero NaN/undefined fallbacks for pre-2017 Bill Diff and pre-2018 Open Treasury eras.

---

### Phase 6D (`Checkpoint P6-CP-4`): Ministries & MDAs Convergence (`?tab=agencies`), Capital Projects Workbench (`?tab=projects`) & Execution/Contracts (`?tab=execution`)
- **Priority:** `Tier 1 (Items 4 & 5)` + `Tier 2 (Item 9)`
- **Problem Statement:**
  - [MdaIntegrityScorecardPanel.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/MdaIntegrityScorecardPanel.tsx) lacks Red-Flag Convergence badges (`3+` simultaneous independent flags), Open Treasury Personal/Opaque cash indicators, Evidence Engine v3.0 28-year rule hit counts, and Asset Lifespan repeat-buy indicators.
  - The **Capital Projects Directory** (`?tab=projects` in [App.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/App.tsx#L588-L771)) currently shows only `AI Enriched` badges with no Evidence Engine v3.0 compound risk scores, no cross-ledger filters, and no PDF/DOCX export.
  - [ExecutionProcurementExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/ExecutionProcurementExplorer.tsx) does not yet display Red-Flag Convergence badges on high-risk contractors and MDAs.
- **Deliverables:**
  1. **Ministries & MDAs ([MdaIntegrityScorecardPanel.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/MdaIntegrityScorecardPanel.tsx)):**
     - Join `red_flag_convergence_index.json` + `evidence_engine_all_years.json` (`topFlaggedMdasAllTime` & `crossLedgerContext.mdaProfilesByKey`).
     - Display **Red-Flag Convergence (`3+` Flags)** pills, **Personal/Opaque Treasury Cash** pills, **28-Year Evidence Engine Rule Hits**, and **Repeat Asset Lifespan** indicators on each MDA scorecard row & expanded drawer.
     - Add a **"High-Risk Convergent MDAs Only"** filter toggle and include convergence telemetry in `exportMdaScorecardBriefPdf()` / `Docx()`.
  2. **Capital Projects Workbench (`?tab=projects` in [App.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/App.tsx) / extracted `CapitalProjectsDirectory.tsx`):**
     - Map `compoundProjects` (`CompoundFlaggedProject`) by `id || projectCode` onto every row in the Capital Projects table.
     - Render inline **Compound Risk Score (`0–100`)** and **Cross-Ledger Badges** (`Paid on Paper`, `NASS Insertion`, `OAuGF-Indicted MDA`, `Zombie Lineage`).
     - Add quick investigative filter pills (`Flagged Only`, `Cross-Ledger Only`, `Paid on Paper`, `NASS Insertion`, `OAuGF-Indicted MDA`) and **1-click Export Filtered Projects (PDF / DOCX)** via `exportTabularDossierPdf()` / `Docx()`.
  3. **Execution & Contracts ([ExecutionProcurementExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/ExecutionProcurementExplorer.tsx)):**
     - Join `red_flag_convergence_index.json` onto Contractor Leaderboard and Procurement Risk tables so non-competitive awards & variation overruns immediately show **Multi-Ledger Convergence (`2+`/`3+` flags)** and **OAuGF procurement violation counts**.
- **Target Files:**
  - [src/components/MdaIntegrityScorecardPanel.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/MdaIntegrityScorecardPanel.tsx)
  - `src/components/CapitalProjectsDirectory.tsx` (new clean component extracted from [src/App.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/App.tsx))
  - [src/components/ExecutionProcurementExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/ExecutionProcurementExplorer.tsx)
  - [src/App.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/App.tsx)
  - [tests/unit/mdaScorecard.test.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/unit/mdaScorecard.test.ts)
- **Verification Gate (`P6-CP-4`):**
  - `npx tsc -b` passes.
  - `npx vitest run tests/unit/mdaScorecard.test.ts tests/unit/documentExporter.test.ts` passes.
  - Zero developer CLI strings in `src/**/*.tsx`.

---

### Phase 6E (`Checkpoint P6-CP-5`): Citizen Hub (`?tab=citizen`), Geo Map (`?tab=map`), Asset Inventory (`?tab=assets`), Recurring Lineages (`?tab=recurring`) & Bill-vs-Act Diff (`?tab=padding`)
- **Priority:** `Tier 2 (Items 7, 8 & 10)`
- **Problem Statement:** Five high-value citizen & investigative explorers are partially cross-linked but lack consistent Evidence Engine v3.0 compound risk badges, OAuGF MDA negligence badges, and complete PDF/DOCX export parity (specifically missing on Asset Inventory and Recurring Lineages).
- **Deliverables:**
  1. **Citizen Tax & Area ([CitizenAccountabilityHub.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/CitizenAccountabilityHub.tsx)):**
     - Enrich neighborhood project cards with **Evidence Engine v3.0 Compound Risk** & **Bill→Act Insertion** badges, plus a **"Local Accountability Summary"** card highlighting OAuGF-indicted MDAs and Paid-on-Paper projects in the user's selected State/LGA.
  2. **Geo & Anomaly Map ([GeoIntelligenceWorkspace.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/GeoIntelligenceWorkspace.tsx)):**
     - Add **OAuGF-Queried MDA Exposure** and **Bill→Act Zonal Insertion** indicators to the 37-State League Table and State Brief PDF/DOCX exports.
  3. **Asset Inventory ([AggregatedAssetsExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/AggregatedAssetsExplorer.tsx)):**
     - Cross-link Repeat-Procurement Alerts with **OAuGF Asset Management / Unvouched queries** and **Evidence Engine v3.0 `REPEAT_ASSET_LIFESPAN_VIOLATION` (`6,606` hits)**, and add **Export Physical Asset Ledger (PDF / DOCX)** buttons.
  4. **Recurring Lineages ([RecurringLineagesExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/RecurringLineagesExplorer.tsx)) & Bill vs. Act Diff ([BudgetPaddingDiffExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/BudgetPaddingDiffExplorer.tsx)):**
     - Add **OAuGF MDA Negligence** badges and **1-click Export Recurring Lineages Dossier (PDF / DOCX)** on `?tab=recurring`.
- **Target Files:**
  - [src/components/CitizenAccountabilityHub.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/CitizenAccountabilityHub.tsx)
  - [src/components/GeoIntelligenceWorkspace.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/GeoIntelligenceWorkspace.tsx)
  - [src/components/AggregatedAssetsExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/AggregatedAssetsExplorer.tsx)
  - [src/components/RecurringLineagesExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/RecurringLineagesExplorer.tsx)
  - [src/components/BudgetPaddingDiffExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/BudgetPaddingDiffExplorer.tsx)
  - [tests/unit/citizenAccountability.test.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/unit/citizenAccountability.test.ts), [tests/unit/geoIntelligence.test.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/unit/geoIntelligence.test.ts), [tests/unit/billActDiff.test.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/unit/billActDiff.test.ts)
- **Verification Gate (`P6-CP-5`):**
  - `npx tsc -b` passes.
  - `npx vitest run tests/unit/citizenAccountability.test.ts tests/unit/geoIntelligence.test.ts tests/unit/billActDiff.test.ts` passes.

---

### Phase 6F (`Checkpoint P6-CP-6`): Grounded AI Assistant 6-Ledger Unification (`?tab=ai`) & Full Regression Gate
- **Priority:** `Tier 2 (Item 11a)` + Final Release Gate
- **Problem Statement:** [aiForensicEngine.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/aiForensicEngine.ts) and [GroundedAiAssistantWidget.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/GroundedAiAssistantWidget.tsx) need to ingest our newest precomputed indices (`evidence_engine_all_years.json`, `red_flag_convergence_index.json`, and the refreshed `₦24.57T` / `$37.03B` `forensic_sweep_1999_2026.json` Presidential cross-ledger profiles) so natural-language Q&A always cites exact, up-to-date numbers across all 6 ledgers.
- **Deliverables:**
  1. Load `evidence_engine_all_years.json`, `red_flag_convergence_index.json`, and `forensic_sweep_1999_2026.json` (`headlineMetrics` + `presidents`) inside `loadSupplementalAiDatasets()` in [aiForensicEngine.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/aiForensicEngine.ts).
  2. Add grounded synthesis branches for:
     - **Evidence Engine v3.0 (`22` rules / `49,679` findings / `28,681` flagged projects)**,
     - **Red-Flag Convergence (multi-flag MDAs & contractors)**, and
     - **Presidential 6-Ledger Comparisons (`₦24.57T` / `$37.03B` enacted scrutiny + OAuGF queries + personal/opaque cash + DMO debt)**.
  3. Enforce `sanitizeAiPublicText()` across all new output blocks and starter prompts so zero `.pdf`/`.json`/`.csv` filenames or internal jargon (`NOCOPO`, `GovSpend`, `MTEF/FSP`, `SQL/FTS5`, `Budget Implementation Report`) ever appear in AI responses.
  4. Update [tests/unit/aiForensicEngine.test.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/unit/aiForensicEngine.test.ts) with assertions for 6-ledger answers and strict public-text hygiene.
- **Target Files:**
  - [src/utils/aiForensicEngine.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/aiForensicEngine.ts)
  - [src/components/GroundedAiAssistantWidget.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/GroundedAiAssistantWidget.tsx)
  - [tests/unit/aiForensicEngine.test.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/tests/unit/aiForensicEngine.test.ts)
- **Final Release Verification Gate (`P6-CP-6` — Run in One Command):**
  ```powershell
  .venv\Scripts\python.exe -m pytest tests/python/; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; $cliHits = Get-ChildItem -Path "src" -Filter "*.tsx" -Recurse | Select-String -Pattern "uvicorn|FastAPI|python -m|\.exe -m"; if ($cliHits) { $cliHits; throw "Developer CLI strings found in src/**/*.tsx" } else { "ZERO_UI_DEVELOPER_STRINGS_RECURSIVE" }; npx tsc -b; if ($LASTEXITCODE -eq 0) { npx vitest run }; if ($LASTEXITCODE -eq 0) { npm run build }
  ```

---

## 3. Master Execution & Checkpoint Tracking Matrix

| Phase | Checkpoint ID | Tabs Upgraded | Primary New 6-Ledger Data Surfaced | Export / Test Gate | Status |
|---|---|---|---|---|---|
| **Phase 6A** | `P6-CP-1` | `?tab=forensics` | `₦1.49T` Personal/Staff Accounts (`10,851` payees) + `₦2.44T` Opaque/Discretionary Vouchers (`33,366`) + OAuGF links (`vendor_network_index.json` + `evidence_engine_all_years.json`) | Upgraded GovSpend PDF/DOCX + `statisticalForensics.test.ts` | `COMPLETED` |
| **Phase 6B** | `P6-CP-2` | `?tab=reports`, `?tab=casebook` | Evidence Engine v3.0 (`22` rules) + 6-Ledger Audit Brief template + 6-Ledger Casebook pins | New 6-Ledger Brief PDF/DOCX + `documentExporter.test.ts` & `casebookAndFoi.test.ts` | `COMPLETED` |
| **Phase 6C** | `P6-CP-3` | `?tab=compare`, `?tab=trends` | Presidential `crossLedgerProfile` (OAuGF, Padding, Dec Rush, EE v3) + 28-Year Multi-Ledger Trajectory overlays | `tsc -b` + `administrationDebt.test.ts` | `COMPLETED` |
| **Phase 6D** | `P6-CP-4` | `?tab=agencies`, `?tab=projects`, `?tab=execution` | Red-Flag Convergence (`3+` flags), Compound Risk Scores (`0–100`), Paid-on-Paper / Insertion / OAuGF filters | Filtered Projects PDF/DOCX + MDA Scorecard PDF/DOCX + `mdaScorecard.test.ts` | `COMPLETED` |
| **Phase 6E** | `P6-CP-5` | `?tab=citizen`, `?tab=map`, `?tab=assets`, `?tab=recurring`, `?tab=padding` | Local OAuGF & Compound Risk badges, 37-State Zonal/OAuGF overlays, Asset & Lineage PDF/DOCX parity | Asset & Lineage PDF/DOCX + `citizenAccountability`, `geoIntelligence`, `billActDiff` tests | `COMPLETED` |
| **Phase 6F** | `P6-CP-6` | `?tab=ai` + Full Observatory | Grounded AI wired to `49,679` EE v3 findings, Convergence Index, and `₦24.57T` Presidential baseline | `aiForensicEngine.test.ts` + Full `pytest`, `tsc -b`, `vitest`, CLI-hygiene & `npm run build` | `COMPLETED` |
