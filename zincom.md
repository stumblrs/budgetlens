## Part 1: What Is Not Fully Implemented Yet

### 1. Data & Ingestion Coverage Gaps ([registry.json](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/public/datasets/registry.json))
- **Stage-2 AI Enrichment is `< 0.2%` complete:** Only **1,045 of 558,815** records (`1999`: 60, `2006`: 116, `2009`: 869) are Stage-2 enriched (`task-540` is still running through 2009 with 1.5–2.5 min cooldowns); the other 25 years remain `STAGE1_RULE_VERIFIED` (`gemma_enriched_count: 0`).
- **Severe historical extraction shortfalls on specific years:**
  - `2000–2003`, `2005`, and `2007` contain **Summary Acts only** (`124–188` items, `8–10` pages), lacking MDA capital schedules.
  - **FY 2011** (`1,277` items / `₦109.77B` extracted vs. `~₦4.48T` enacted — `~2.4%` coverage), **FY 2015** (`₦1.02T` extracted vs. `~₦4.49T` enacted), and **FY 2006** (`502` items) have partial/scanned-PDF extraction gaps.
- **Provenance sync mismatch:** Full SHA-256 hashes exist in [source_provenance.json](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/public/datasets/source_provenance.json), but `registry.json` still has `"sha256": ""` for 27 of 28 years (only `2009` is populated). 

### 2. Frontend Stubs & Client-Only Limitations
- **Citizen Field Tip Channel has no backend ([ProjectEvidenceModal.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/ProjectEvidenceModal.tsx#L782-L834)):** Submitting a field tip only sets local React state (`setTipSubmitted(true)`); tips vanish on page refresh with no database, photo/GPS evidence upload, or public verification feed.
- **"View PDF Record" is a metadata card, not a real PDF page viewer ([ProjectEvidenceModal.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/ProjectEvidenceModal.tsx#L889-L954)):** It renders formatted JSON text rather than the actual source PDF page or highlighted page image.
- **SQL Data Explorer is a regex filter, not a real SQL engine ([SqlDataExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/SqlDataExplorer.tsx#L34-L77)):** It only parses `WHERE amount > N`, `LIKE '%...%'`, `ORDER BY amount ASC/DESC`, and `LIMIT N` on the **single active year** — `GROUP BY`, `SUM`/`COUNT`, `AND`/`OR`, agency/state filters, and cross-year queries do not execute.
- **Universal Search (`⌘K`) "All Years" only searches loaded years ([UniversalSearchModal.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/UniversalSearchModal.tsx#L101-L120)):** It cannot search all `558,815` records across `1999–2026` unless every year's JSON has been fetched into browser RAM.
- **AI Assistant is a deterministic heuristic router ([GroundedAiAssistantWidget.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/GroundedAiAssistantWidget.tsx)):** Operates via client-side keyword/regex matching over the active year rather than semantic search + LLM synthesis across all 28 years.
- **FOI & MP Letters are clipboard-only ([ProjectEvidenceModal.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/ProjectEvidenceModal.tsx#L728-L888)):** No formal **PDF / DOCX letterhead export** and no directory of official MDA FOI Desk contacts or constituency representatives.

### 3. Built-But-Hidden Forensic Engines ([BudgetDatabaseContext.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/context/BudgetDatabaseContext.tsx#L24-L29))
Four analytics methods are already exposed on `BudgetDatabaseContext` yet **unused anywhere in the UI**:
- `getBenfordAnalysis()` (Benford's Law digit-distribution fraud test)
- `getPrematureReplacementAlerts()` (assets rebought before lifecycle expiry)
- `getVirementAnalytics()` (cross-head budget shifting)
- `getDuplicateRingClusters()` (coordinated multi-agency duplication rings)

### 4. Engineering, Performance & Quality Debt
- **Zero automated test suite ([package.json](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/package.json)):** No Vitest unit tests, no Playwright UI/export E2E tests, and no CI regression guard.
- **Main-thread blocking & bundle bloat:**
  - [App.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/App.tsx#L88-L104) runs `applyRules()` and `detectDuplicates()` on the main thread over up to 58,300 items whenever the year switches.
  - Heavy modules (`GroundedAiAssistantWidget`, `GeoMapWidget`, `BudgetAuditCalculatorWidget`, `SpendingTrendChart`, `UniversalSearchModal`, `ProjectEvidenceModal`) are eagerly imported in [App.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/App.tsx#L1-L19), producing a **~594 kB** main chunk; [vite.config.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/vite.config.ts#L10-L14) also emits an empty `0.00 kB` `vendor-react` chunk.
- **Unused code & dependency:** `canvas-confetti` in `package.json` and 7 orphaned components in `src/components/` (`EvidenceEngineSummary.tsx`, `EvidenceFeed.tsx`, `FooterBanner.tsx`, `InvestigatorToolsRail.tsx`, `RecentInvestigationsWidget.tsx`, `RecurringProjectsWidget.tsx`, `TopSpendingAnomaliesWidget.tsx`).

---

## Part 2: Propositions to Elevate BudgetLens

### Tier 1 — High-Impact Investigative Differentiators (Biggest Leap in Credibility)
1. **Executive Bill vs. Enacted Act "Budget Padding" Diff Engine**
   - You **already hold both** `Appropriation Bill.pdf` and `Appropriation Act.pdf` for `2017, 2019, 2020, 2022, 2023, 2024, 2025` in [registry.json](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/public/datasets/registry.json).
   - Building a line-by-line diff between what the Presidency proposed and what the National Assembly passed exposes **exact legislative insertions, inflated allocations, and Zonal Intervention Projects (ZIP)** — one of the highest-value investigative journalism tools possible in Nigeria.
2. **Enacted vs. Actual Execution Tracker (Budget Implementation Reports + Open Treasury)**
   - Pair enacted appropriations with quarterly Budget Office **Budget Implementation Reports (BIR)** and **OAGF Open Treasury** cash-release data to show *Budgeted vs. Released vs. Cash-Backed %* per MDA — separating paper budgets from real money spent.
3. **True Primary-Source PDF Page Viewer (`pdfjs-dist` / Cropped Proof Images)**
   - Render the literal government PDF page (with the exact line item highlighted) inside `ProjectEvidenceModal` alongside the SHA-256 hash so journalists, researchers, and legal teams have court-ready visual verification.
4. **Statistical Forensics Lab (Surface Your Dormant Engines)**
   - Build a dedicated view wiring `getBenfordAnalysis()`, `getPrematureReplacementAlerts()`, `getVirementAnalytics()`, and `getDuplicateRingClusters()` into interactive charts (e.g., Benford first-digit deviation curves per ministry, 1–2 year vehicle/generator repurchase timelines, and agency duplication graphs).
5. **Procurement & Beneficial Ownership Bridge (NOCOPO / BPP / CAC)**
   - Cross-link budget codes (`ERGP...`) to Nigeria Open Contracting Portal (**NOCOPO**) contract awards and **CAC** corporate filings to trace a line item from **Appropriation → Tender → Contractor → Field Delivery**.

### Tier 2 — Turn Stubs Into Reference-Grade Investigator Tools
6. **Real Cross-Year SQL Workbench (DuckDB-Wasm over 1999–2026)**
   - Replace the regex stub in [SqlDataExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/SqlDataExplorer.tsx) with **DuckDB-Wasm** querying compressed Parquet/SQLite datasets of all `558,815` records, supporting real `GROUP BY`, `JOIN`, window functions, prebuilt investigative templates, and PDF/DOCX exports.
7. **Instant All-28-Year Full-Text Search (SQLite FTS5 API or Chunked Search Index)**
   - Upgrade `⌘K` search so querying `"Armoured SUV"`, `"Solar street light"`, or any town/LGA returns ranked hits across all `1999–2026` records in milliseconds.
8. **Investigator Casebook / Multi-Year Evidence Basket (Custom PDF & DOCX Dossier)**
   - Let users pin line items, duplicate clusters, lineages, and charts from *multiple years* into a named **Investigation Casebook**, add analyst notes, and export the entire curated dossier as a single publication-ready **PDF or DOCX** report.
9. **Persistent Citizen Field Verification & Formal FOI Packet Exporter**
   - Back the field tip channel with a real API/database (photo + timestamp/GPS + verification badges) and upgrade the FOI & MP Letter tabs to export formal, ready-to-sign **PDF & DOCX** FOI Act 2011 packets (with statutory 7-day countdown and official MDA FOI Desk addresses).

### Tier 3 — Data Completeness & Engineering Hardening
10. **OCR Recovery & Data Completeness Sprint (`2000–2007`, `2011`, `2015`)**
    - Recover missing MDA schedules for `2011` and `2015`, backfill `sha256` into `registry.json`, and batch/parallelize Stage-2 enrichment so high-priority flagged items get enriched first instead of sequential overhead lines.
11. **Performance, Hygiene & Automated QA Suite**
    - Move `applyRules` / `detectDuplicates` into a Web Worker (or precompute per year), lazy-load remaining heavy widgets to cut initial JS load by ~50%, clean up the 7 unused components + `canvas-confetti`, and add **Vitest + Playwright** tests covering rules, permalinks, responsive layout, and PDF/DOCX binary validity.

---

### Recommended Starting Order (Highest Value per Effort)
If you want maximum elevation quickly, I recommend tackling these **four** first:
1. **Bill vs. Act "Budget Padding" Diff Engine** *(uses PDFs you already own; unique headline feature)*
2. **Statistical Forensics Lab** *(unlocks Benford, Premature Replacement, Virement & Duplicate Rings already coded in `BudgetDatabaseContext`)*
3. **Real DuckDB-Wasm SQL + All-28-Year Instant Search** *(replaces two visible client-side limitations with true investigative firepower)*
4. **Investigator Casebook + Formal FOI PDF/DOCX Packets + Automated QA / Web Worker Performance Pass**

Let me know which of these propositions you want to pursue — if you'd like, we can draft a **Phase 2 Checkpoint Roadmap** (with the same strict exclusive approval gate per checkpoint and PDF/DOCX-only export policy) before writing any code.