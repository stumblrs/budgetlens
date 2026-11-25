# Budget Lens — Technical Audit, Calculation Remediation & 1999–2026 Presidential Comparison Specification

> **Document Purpose:** Comprehensive root-cause audit and implementation blueprint addressing:
> 1. Why ongoing/completed ingested data (`1999`–`2026`) is invisible on the webapp and how to enable **real-time progressive streaming** as each PDF or checkpoint finishes.
> 2. **Backend (Python ETL)** data-corruption bugs producing astronomical totals (`10^23` to `10^46`), 2×–10× record multiplication, IPSAS rollup double-counting, and record ID collisions.
> 3. **Frontend (React / TypeScript)** calculation flaws, fake multipliers, negative pre-2020 inflation factors, runtime crashes, and hardcoded `2023–2026` limits.
> 4. Architecture & UI/UX specification for **1999–Present Day Budget Comparison** — supporting Year-vs-Year, 4-Year Presidential Terms, President-vs-President head-to-head comparison, macroeconomic adjustments (CPI + USD), and cropped presidential portrait cards.

---

## 1. Executive Summary of Audit Findings

An end-to-end audit of `ingestion/`, `public/datasets/`, and `src/` uncovered **19 distinct defects** across four categories that either prevent ingested data from rendering or distort budget calculations:

| Category | Count | Impact on Budget Lens |
|---|---|---|
| **A. Live Ingestion & Webapp Sync Blockers** | **6** | `1999`–`2009` published data and `2010`–`2026` staged data never appear in the UI; webapp waits indefinitely for the entire multi-year Gemma run to finish before `registry.json` or `recurring_lineages.json` exist. |
| **B. PDF Parsing, Staging & Data Integrity Bugs** | **6** | Multi-column whitespace stripping inflates Naira totals to `₦1.25 × 10^23` (`2009`) and `₦7.7 × 10^46` (`2025`); staging re-appending multiplies record counts by 2×–10× (`1999`, `2001–2003`, `2026`); IPSAS summary rollups inflate totals 5×–7×; competing Bills/Repeals/Acts sum together. |
| **C. Frontend Calculation & Runtime Logic Bugs** | **8** | `HeaderStats` and `SpendingTrendChart` display hardcoded multipliers (`0.082`, `0.42`, `0.58`); `getAggregatedAssetsInventory()` computes negative inflation factors for pre-2020 years (`-6.2` in 1999); `SectorDistribution` collapses everything under `"Capital Infrastructure"`; `SqlDataExplorer` crashes on manual query execution; `InvestigatorHeatmapWidget` serves static hardcoded JSON. |
| **D. 1999–2026 Multi-Year & Presidential UX Gaps** | **1** | No workspace exists to compare budgets across `1999–2026` or aggregate spending by **4-Year Presidential Term** (Obasanjo, Yar'Adua, Jonathan, Buhari, Tinubu) with nominal/real/USD normalization and cropped presidential portraits. |

---

## 2. Why Ongoing Ingested Data Is Not Showing & How to Enable Live Streaming

At the time of audit, `public/datasets/` contains published folders for **`1999` through `2009`** (with `2009` paused at checkpoint record `700` of `Ministry of Works , Housing and Urban Development.pdf` in `ingestion/checkpoints_data/c0c45c9563cf.json`), while **`2010` through `2026`** sit in `ingestion/staging/{year}/raw_records.json` marked `STAGE1_COMPLETE` in `ingestion/ingestion_registry.json`. None of this appears on the webapp because of **6 architectural blockers**:

### 2.1 Blocker 1 — Frontend Hardcodes `2023–2026` and Defaults to `2026`
- **Root Cause & Locations:**
  - `src/main.tsx` (line 9): `<BudgetDatabaseProvider initialYear={2026}>` hardcodes initial boot year to `2026`.
  - `src/services/budgetDatabaseEngine.ts` (lines 86, 91–100): `activeYear = 2026`, and `initialize()` exclusively fetches `[2026, 2025, 2024, 2023]`, ignoring `1999–2022` (which are the exact years already processed!).
  - `src/components/Sidebar.tsx` (lines 409–430): The year selector `<select>` has only 4 hardcoded `<option>` tags (`2026`, `2025`, `2024`, `2023`) with hardcoded project counts. Years `1999–2009` cannot be selected at all.
  - `src/components/SpendingTrendChart.tsx` (line 34): `const years = [2023, 2024, 2025, 2026];`
  - `src/components/SqlDataExplorer.tsx` (line 127): `{[2026, 2025, 2024, 2023].map(...)}`
  - `src/components/BudgetAuditCalculatorWidget.tsx` (lines 46–168): Hardcoded `INITIAL_BUDGET_MAP` only defines `2023–2026` and `useEffect` restricts fetches to `if (year >= 2023 && year <= 2030)`.
- **Fix:**
  - Remove all hardcoded year arrays. On boot, `BudgetDatabaseEngine.initialize()` must fetch `/datasets/registry.json` first, discover every ingested year dynamically, set `activeYear` to the latest *actually published* year (or `registry.active_year`), and populate the Sidebar, SQL Explorer, Trend Chart, and Comparison views from `registry.documents`.

### 2.2 Blocker 2 — `CascadeEngine.run()` Only Executes After Every Pending File Completes
- **Root Cause & Location:**
  - `ingestion/cli.py` (lines 484–503): `CascadeEngine().run()` is placed **after** `for work_item in pending:`. While `run_file()` writes individual year folders, global manifests (`registry.json`, `ai_knowledge_base.json`, `recurring_lineages.json`, `macro_narratives_summary.json`) are **never created** until the entire multi-year queue finishes (which can take weeks with CPU-only Gemma inference).
  - Currently, `public/datasets/registry.json` and `public/datasets/recurring_lineages.json` **do not exist** on disk (`public/datasets/` only has `1999`–`2009` and `db/`).
- **Fix:**
  - Run `cascade.run()` (at minimum rebuilding `registry.json`, `hierarchy_summary.json`, and `recurring_lineages.json`) immediately after **every completed PDF file** inside `run_file()`, and optionally after every N-record checkpoint flush for large PDFs.
  - Add a fast `--sync-live` CLI command in `ingestion/cli.py` so global manifests can be regenerated anytime without touching Gemma.
  - Ensure `public/sw.js` (line 9) does not fail service worker installation if `/datasets/registry.json` is temporarily absent, and bypasses stale caching for `/datasets/*` JSON polling via `cache: 'no-store'` or timestamp query strings.

### 2.3 Blocker 3 — `hierarchy_summary.json` Is Never Generated by the Active Pipeline
- **Root Cause & Location:**
  - `src/services/budgetDatabaseEngine.ts` (lines 121–130) fetches `/datasets/db/hierarchy_summary.json` to power `HeaderStats`, `SpendingTrendChart`, and `getSummary()`.
  - `hierarchy_summary.json` was previously generated only by the legacy `scripts/build_hierarchical_db.py` (line 237), which itself hardcoded `years = [2023, 2024, 2025, 2026]`. Neither `DbBuilder` (`ingestion/indexers/db_builder.py`) nor `CascadeEngine` (`ingestion/indexers/cascade.py`) writes `hierarchy_summary.json`, so it is missing (`file does not exist`).
- **Fix:**
  - Add `_rebuild_hierarchy_summary()` directly inside `CascadeEngine.run()` (`ingestion/indexers/cascade.py`), scanning every numeric year directory under `public/datasets/` and atomically writing `public/datasets/db/hierarchy_summary.json` using `_atomic_write()`.

### 2.4 Blocker 4 — Stage 1 Staged Data (`2010–2026`) Is Invisible Until Stage 2 Finishes
- **Root Cause & Location:**
  - `ingestion/cli.py` (lines 226–233): When `--stage1` finishes extracting a PDF into `ingestion/staging/{year}/raw_records.json`, it marks `STAGE1_COMPLETE` and returns early **before** calling `db_builder.write_year_dataset()`.
  - Consequently, all `2010`–`2026` records already parsed in `ingestion/staging/` are completely invisible to the webapp until Gemma processes every record from `2009` onward.
- **Fix (Two-Tier Progressive Publishing):**
  1. **Immediate Stage 1 Publishing:** After Stage 1 writes to `ingestion/staging/{year}/raw_records.json`, immediately run `DbBuilder.write_year_dataset()` (using deterministic `AssetTokenizer`, `GeoTaxonomy`, `HumanEquivalents`, and `ForensicRules`) with `"enrichmentStatus": "STAGE1_RULE_VERIFIED"` and run `CascadeEngine.run()`. All years `1999–2026` become queryable immediately.
  2. **Progressive Stage 2 (Gemma) Streaming:** During Stage 2, at every checkpoint (and on file completion), merge newly completed `gemmaReview` objects into `public/datasets/{year}/projects.min.json` and `public/datasets/db/{year}/records.json`, update `"gemmaEnrichedCount"` in `statistics.json` / `registry.json`, and run `CascadeEngine._rebuild_registry()` + `_rebuild_hierarchy_summary()`.

### 2.5 Blocker 5 — JSON Schema Mismatches Between Python Outputs and React Consumers
Even when `CascadeEngine` and `DbBuilder` write their files, four schema mismatches break the React UI:

| File | What Python Currently Writes | What React Currently Expects | Fix Specification |
|---|---|---|---|
| `public/datasets/registry.json` | `cascade.py:112-121` writes an object `{ active_year, total_years, documents: [{ financial_year, project_count, total_budget, status }] }` (`snake_case`). | `App.tsx:27-30, 73` expects `RegistryYear[]` array with `{ financialYear, extractedProjectsCount }`. | Standardize `registry.json` schema (`{ activeYear, latestYear, earliestYear, generatedAt, documents: [{ financialYear, projectCount, totalBudget, pageCount, status, stage2ProgressPct, sourceFiles }] }`) and update `App.tsx` + `BudgetDatabaseEngine` to read the unified typed contract. |
| `public/datasets/recurring_lineages.json` | `cascade.py:258-278` writes `{ generatedAt, totalLineages, lineages: [{ projectCode, canonicalTitle, yearsAppeared, cumulativeAllocation, appearances }] }` (`camelCase`, wrapped object). | `App.tsx:79` & `RecurringLineagesExplorer.tsx:14-48` expect a top-level array (or `.lineages`) with `snake_case` keys (`lineage_id`, `project_code`, `canonical_title`, `years_appeared`, `cumulative_allocation`, `instances`, `match_confidence`). | Align `CascadeEngine._rebuild_lineages()` and `RecurringLineagesExplorer.tsx` on one explicit schema (including `lineageId`, `projectCode`, `canonicalTitle`, `yearsAppeared`, `cumulativeAllocation`, `matchConfidence`, `instances`, and normalized title fallback matching across years when `projectCode` changes per Architecture Spec §9.2). |
| `public/datasets/db/{year}/records.json` | `db_builder.py:140-173` omits the `multiYearLineage` property entirely. | `budgetDatabaseEngine.ts:302` accesses `r.multiYearLineage.lineageId` without optional chaining (`TypeError: Cannot read properties of undefined`). | Always populate `multiYearLineage` in `DbBuilder._build_records()` (default `{ lineageId: null, yearsAppeared: [year], cumulativeSpendNaira: amount, cumulativeSpendFormatted }`) AND use optional chaining (`r.multiYearLineage?.lineageId`) in `budgetDatabaseEngine.ts`. |
| `public/datasets/{year}/statistics.json` | `db_builder.py:61-71` omits `sectorDistribution`, `topMinistries`, and `zoneDistribution`. | `SectorDistribution.tsx:84`, `TopMinistriesWidget.tsx:47`, and `GeoMapWidget.tsx:113` read those fields as fallback when `records` are empty. | Compute and write `sectorDistribution`, `topMinistries`, `zoneDistribution`, and `enrichmentProgress` inside `DbBuilder.write_year_dataset()`. |

### 2.6 Blocker 6 — Live Polling & Hot-Reload Mechanism in React (`BudgetDatabaseContext`)
Currently `BudgetDatabaseEngine.loadYearRecords(year)` (`src/services/budgetDatabaseEngine.ts:132-135`) returns cached `this.recordsByYear.get(year)` forever once loaded, so even if files change on disk during ingestion, the UI never sees updates.
- **Fix:**
  1. Add `forceRefresh?: boolean` to `loadYearRecords(year, forceRefresh)` and append `?t=${Date.now()}` to `fetch()` calls when refreshing.
  2. Add a lightweight 15-second interval poll in `BudgetDatabaseContext.tsx` fetching `/datasets/registry.json?t=${Date.now()}` (`cache: 'no-store'`).
  3. Compare `registry.generatedAt` and per-year `ingestedAt` / `projectCount` / `gemmaEnrichedCount` against the previous snapshot. Whenever a year updates or a new year appears:
     - Re-fetch `hierarchy_summary.json` and the affected year's `statistics.json`, `projects.min.json`, and `records.json`.
     - Trigger React state updates so KPIs, charts, year dropdowns, and tables refresh seamlessly without reloading the page.
  4. Display a live status pill in `Sidebar.tsx` / `Topbar.tsx`: e.g., `● Live Sync: 28/28 Years Published · Stage 2 Enriching 2009`.

---

## 3. Critical PDF Parsing & Backend Calculation Bugs (`ingestion/`)

Even after fixing visibility, **the numbers currently on disk are mathematically corrupted by 6 severe ETL bugs**. Fixing these before publishing is mandatory for credible calculations:

### 3.1 Bug 1 — Multi-Column Whitespace Stripping Produces 20- to 47-Digit Astronomical Amounts
- **Location:** `ingestion/parsers/pdf_parser.py` (`PdfParser._clean_amount`, lines 18–28).
- **Observed Evidence on Disk:**
  - `public/datasets/2008/statistics.json` (line 5): `totalCapitalAmount: 218165700291050498305` (**₦218.17 Quintillion**).
  - `public/datasets/2009/statistics.json` (line 5): `totalCapitalAmount: 125323146012182072063375` (**₦125.32 Sextillion**), driven by `Ministry of Interior.pdf` (`4,679,408,907,896,371,795,105` in `ingestion_registry.json:397`).
  - `ingestion/ingestion_registry.json` (line 4940, `2023`): `totalAmount: 100176448086984233907273021218869152` (**35 digits**, `10^35`).
  - `ingestion/ingestion_registry.json` (line 5083, `2025`): `totalAmount: 76995368752742359532655532424586471854907340672` (**47 digits**, `10^46`).
- **Root Cause:**
  1. `cleaned = re.sub(r'[\s,=N=₦NGN]', '', text).replace('.00', '')` strips **all whitespace**, merging multiple adjacent numeric columns (e.g., `2024 Revised`, `2025 Proposed`, `2025 Passed`, or a project code + amount on the same line) into one giant concatenated integer.
  2. `.replace('.00', '')` fails for any kobo value ending in `.50`, `.25`, `.10`, etc., leaving `.50` in `cleaned`, causing `cleaned.isdigit()` to return `False` and silently dropping valid line items to `0`.
  3. Notice also `re.sub(r'[...=N=₦NGN]', ...)` treats `=N=₦NGN` as a character class, accidentally stripping uppercase `N` and `G` anywhere in the string.
- **Exact Fix:**
  ```python
  CURRENCY_TOKEN_RE = re.compile(
      r'(?:(?:=N=|₦|NGN)\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?'
  )

  @staticmethod
  def _clean_amount(text: str, financial_year: int | None = None) -> int:
      if not text:
          return 0
      s = text.strip()
      # Reject strings containing multiple separate numbers unless one is clearly the final column
      # Extract comma-grouped or decimal-terminated currency tokens
      matches = re.findall(
          r'(?:(?:=N=|₦|NGN)\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)',
          s
      )
      if not matches:
          return 0
      # If multiple tokens appear on a single line (e.g. code + amount or multi-column table),
      # avoid concatenating them; only parse if the line is an amount token or take the rightmost column
      if len(matches) > 1 and not re.search(r'[,\.]', s):
          return 0  # Spaced digits without punctuation are usually merged codes/years
      token = matches[-1].split('.')[0].replace(',', '')
      if not token.isdigit():
          return 0
      val = int(token)
      # Reject calendar years masquerading as amounts and physically impossible line items (> ₦10 Trillion single line)
      if financial_year and val == financial_year:
          return 0
      if val < 100 or val > 10_000_000_000_000:
          return 0
      return val
  ```
  Additionally, use PyMuPDF coordinate/word-block extraction (`page.get_text("blocks")` or `page.get_text("words")` / `pdfplumber` column boundaries) when multiple numbers share a single visual line so the **Appropriation / Passed Amount** column is isolated deterministically.

### 3.2 Bug 2 — IPSAS Account Hierarchy Rollup Multi-Counting (5×–7× Budget Inflation)
- **Location:** `ingestion/parsers/pdf_parser.py` (lines 73–171).
- **Observed Evidence on Disk (`ingestion/staging/2025/raw_records.json`, lines 12–80; `2024`, `2026`):**
  - Line 13: `projectCode: "111"`, `projectName: "PRESIDENCY"`, `amount: 356203221248` (Ministry total rollup).
  - Line 25: `projectCode: "111001001"`, `projectName: "STATE HOUSE - HQTRS"`, `amount: 2025` (the header year `2025` parsed as Naira!).
  - Line 37: `projectCode: "2"`, `projectName: "EXPENDITURE"`, `amount: 57111611995` (Agency total rollup).
  - Line 48: `projectCode: "21"`, `projectName: "PERSONNEL COST"`, `amount: 3497320200` (Category rollup).
  - Line 59: `projectCode: "2101"`, `projectName: "SALARY"`, `amount: 2345306769` (Sub-category rollup).
  - Line 70: `projectCode: "210101"`, `projectName: "SALARIES AND WAGES"`, `amount: 2345306769` (Line item).
  - In `2024` & `2026` (`raw_records.json` lines 26–78), Page 1 executive summary rows with `"0 0"` placeholders are extracted as `projectName: "0 0"` (e.g., `projectCode: "1"`, `amount: 271686295062`).
- **Root Cause:** Every hierarchy node in Nigeria's GIFMIS/IPSAS chart of accounts (`2` → `21` → `2101` → `210101` → `21010101`, `22`, `23`, plus MDA codes `111`, `111001001`) is treated equally as an additive capital project and summed into `totalCapitalAmount`. One ₦2.34B salary line gets counted 5+ times!
- **Exact Fix:**
  1. **IPSAS Hierarchy Classifier:**
     - `ERGP...`, `ZIP...`, `NASS...` or codes under `23*` (Capital Expenditure leaf items, 8+ digits or ERGP-prefixed) → `recordLevel: "LEAF_CAPITAL"`.
     - `21*` (8-digit leaf) → `recordLevel: "LEAF_PERSONNEL"`, `22*` (8-digit leaf) → `recordLevel: "LEAF_OVERHEAD"`.
     - Short economic rollups (`2`, `21`, `22`, `23`, `2101`, `210101`, `2202`, `2301`, etc. with `< 8` digits) and MDA header codes (`111`, `0111001001`, etc.) → `recordLevel: "ROLLUP_SUMMARY"` (stored as hierarchy metadata for reconciliation, **excluded** from `sum(amount)` leaf totals).
  2. **Garbage Row Filter:** Reject any row where `re.fullmatch(r'[\d\s\W]+', projectName)` (eliminates `"0 0"` rows) or `amount == financial_year` (eliminates `"STATE HOUSE - HQTRS": 2025`).

### 3.3 Bug 3 — Staging Lake Blind Re-Appending (2× to 10× Record Multiplication)
- **Location:** `ingestion/staging/staging_manager.py` (`save_raw_records`, lines 27–69) and `ingestion/cli.py` (lines 216–224).
- **Observed Evidence on Disk:**
  - `1999`: `ingestion_registry.json` records `2,026 + 39 = 2,065` items, yet `ingestion/staging/1999/raw_records.json` and `public/datasets/1999/statistics.json` contain **`20,416` records** (~10× duplication!).
  - `2001`: Registry `16` vs. `public/datasets/2001/statistics.json` `48` (**3×**).
  - `2002`: Registry `4` vs. `public/datasets/2002/statistics.json` `12` (**3×**).
  - `2003`: Registry `33` vs. `public/datasets/2003/statistics.json` `99` (**3×**).
  - `2026`: Registry `64,362 + 249 = 64,611` vs. `ingestion/staging/2026/raw_records.json` `129,222` (**exactly 2×**).
- **Root Cause:** `StagingManager.save_raw_records()` executes `combined = existing + records` unconditionally, even when `source_filename` is already in `sourceFiles`. Furthermore, `cli.py` re-parses the PDF and re-calls `save_raw_records()` during Stage 2 and after any resume/retry.
- **Exact Fix:**
  1. Add `"sourceFile": source_filename` and `"fileFingerprint": fingerprint` onto every raw record in `cli.py` / `PdfParser`.
  2. Make `StagingManager.save_raw_records()` **idempotent per source file**:
     ```python
     existing = [r for r in existing if r.get("sourceFile") != source_filename]
     combined = existing + records
     ```
  3. In `cli.py:run_file()`, if `work_item["status"] in (STATUS_STAGE1, STATUS_PARTIAL)` and staged records already exist for that file in `StagingManager`, **load from staging** instead of re-parsing and re-appending.

### 3.4 Bug 4 — Record ID Collisions Across Multi-PDF Years (`P-{year}-00001` Overwrites)
- **Location:** `ingestion/parsers/pdf_parser.py` (line 157) & `ingestion/indexers/db_builder.py` (line 54).
- **Observed Evidence on Disk (`public/datasets/db/1999/records.json`, lines 3–60):**
  - Record `P-1999-00001` is `"Travel & Transport"` from `Appropriation Act, 1999.pdf` (`amount: 29,151,550`).
  - Yet its `gemmaAnalyticalOverlay.normalization.normalizedTitle` (line 45) contains OCR text from `The Supplementary Appropriation Act, 1999.pdf` (`"Two NAIRA, FIF1Y KOilti..."`) because the second PDF in 1999 also started numbering at `P-1999-00001` and overwrote `gemma_reviews["P-1999-00001"]`!
  - In `2009` (40 separate MDA PDFs), up to 40 unrelated records collide on `P-2009-00001`.
- **Exact Fix:**
  - Include the short file fingerprint in every record ID: `P-{financial_year}-{fp_short[:6]}-{idx:05d}`.
  - Store `gemma_reviews` persistently per checkpoint in `staging/{year}/gemma_reviews_{fp_short}.json` so resuming a `PARTIAL` file (`2009` at record `700`) never loses the first `700` Gemma reviews when `write_year_dataset()` runs! *(Note: right now `cli.py` line 241 initializes `gemma_reviews = {}` empty on resume, losing reviews `0..resume_from-1`!)*

### 3.5 Bug 5 — Summing Competing Budget Versions Within the Same Year
- **Location:** `ingestion/scanner/discovery.py` & `ingestion/staging/staging_manager.py`.
- **Observed Evidence on Disk:**
  - `2008` includes `Appropriation Act 2008 (duplicate listing - verify against 5914).pdf` alongside `The Appropriation Act, 2008.pdf` and `Appropriation (Amendment) Act, 2008.pdf`.
  - `2024` combines `2024 Appropriation Bill.pdf` (proposal), `2024 APPROPRIATION ACT.pdf` (enacted), `2024 Repeal Bill.pdf`, and `2024 GOEs Budget (BIMMS).pdf` into the same cumulative total.
  - `2025` combines `2025 Appropriation Bill.pdf`, `2025 Appropriation ACT.pdf`, `2025 Appropriation ACT as Passed.pdf`, and `2025 Repeal Bill.pdf`.
- **Exact Fix:**
  - Extend `DiscoveryEngine.classify_document()` to assign a `document_role`:
    - `PRIMARY_ENACTED` (e.g., `Appropriation ACT as Passed`, `Appropriation Act`)
    - `SUPPLEMENTARY_OR_AMENDMENT` (e.g., `Supplementary Appropriation Act`, `Amendment Act`, `GOEs Budget`)
    - `REPEAL_OR_PROPOSAL_ARCHIVE` (e.g., `Executive Proposal`, `Appropriation Bill` when an `ACT` exists for that year, `Repeal Bill`)
    - `DUPLICATE_SKIP` (files containing `duplicate listing`)
    - `NARRATIVE` (speeches, MTEF, call circulars, implementation guidelines)
  - Only `PRIMARY_ENACTED` (falling back to `PROPOSAL` if no enacted act exists for that year) + non-overlapping `SUPPLEMENTARY_OR_AMENDMENT` files contribute to a year's official headline total.

### 3.6 Bug 6 — Zero-Record Extraction on Scanned / Schedule-Format Acts (`2007`, `2004 Act`, `2008 Act`, `2024 Act`)
- **Location:** `ingestion/parsers/pdf_parser.py` (lines 87–100).
- **Observed Evidence on Disk:** `public/datasets/2007/statistics.json` has `totalCapitalProjects: 0`, `totalCapitalAmount: 0`; `2004/The Appropriation Act, 2004.pdf`, `2008/The Appropriation Act, 2008.pdf`, `2024/2024 APPROPRIATION ACT.pdf`, and `2025/2025 Appropriation ACT.pdf` all extracted `0` records in `ingestion_registry.json`.
- **Root Cause:** Early-2000s Acts use `FIRST SCHEDULE` / `PART A` / `HEAD` formatting rather than `PROJECT NAME` / `ONGOING`, and some Acts (`2007`, `2024 APPROPRIATION ACT.pdf`) are image-scanned PDFs where `page.get_text("text")` returns empty strings.
- **Exact Fix:**
  - Add Schedule-format keywords (`SCHEDULE`, `PART A`, `PART B`, `HEAD`, `SUB-HEAD`, `RECURRENT EXPENDITURE`, `CAPITAL EXPENDITURE`) to `table_keywords`.
  - Detect low-text pages (`len(text.strip()) < 50` across >50% of pages) and automatically route through an OCR fallback (`pdfplumber` + `pytesseract`/`fitz` pixmap OCR) or flag the file explicitly as `OCR_REQUIRED` in the registry rather than silently marking `COMPLETE` with `0` records.

---

## 4. Frontend Calculation, Formula & UI/UX Bugs (`src/`)

### 4.1 Fake Hardcoded Multipliers in `HeaderStats.tsx`
- **Location:** `src/components/HeaderStats.tsx` (lines 134, 150, 166).
- **Bug:** Displays `Math.round(totalProjects * 0.082)` for **Evidence Items**, `Math.round(totalProjects * 0.42)` for **Infrastructure Projects**, and `Math.round(totalProjects * 0.15)` for **Administrative Spending** with hardcoded `"8.2%"`, `"42.0%"`, and `"15.0%"` labels—completely ignoring actual flagged counts and project classifications.
- **Fix:** Pass `evidenceItems` count, unique flagged project count, and real category tallies (Infrastructure vs. Administrative) computed from `records` into `HeaderStats`. Calculate exact dynamic percentages (`(flaggedProjects / totalProjects) * 100`).

### 4.2 Fake `42% / 58%` Split & Hardcoded `2023–2026` in `SpendingTrendChart.tsx`
- **Location:** `src/components/SpendingTrendChart.tsx` (lines 34–53).
- **Bug:**
  - Hardcodes `years = [2023, 2024, 2025, 2026]`.
  - Computes `infra = totalTrillion * 0.42` and `admin = totalTrillion * 0.58` for every single year, making the Capital vs. Recurrent chart a flat hardcoded line regardless of real data.
  - Falls back to hardcoded 2023–2026 numbers when a year is missing.
- **Fix:** Pull all ingested years (`1999–2026+`) from `summary.yearSummaries` / `registry`, compute real Capital vs. Recurrent amounts per year from `statistics.json` / `records`, and use the verified `1999–2026` CPI deflator table for `viewMode === 'real'`.

### 4.3 Negative Inflation Multiplier for Pre-2020 Years in `budgetDatabaseEngine.ts`
- **Location:** `src/services/budgetDatabaseEngine.ts` (`getAggregatedAssetsInventory()`, lines 615–622 & 675).
- **Bug:**
  ```ts
  const inflation = inflationMap[year] || (1.0 + (year - 2023) * 0.3);
  ```
  Because `inflationMap` only defines `2023–2028`, any year `< 2020` produces a **zero or negative inflation factor** (for `1999`: `1.0 + (1999 - 2023) * 0.3 = -6.2`; for `2020`: `0.1`; for `2019`: `-0.2`). Dividing `amount` by a negative unit price yields negative estimated unit counts, which `Math.max(1, ...)` then clamps to `1` for every project from `1999` to `2019`!
  - Similarly, `getRealTermsSpending()` (lines 429–438) only defines `2023–2026` exchange rates and CPI rates, falling back to `₦670/$` for `1999` (when actual CBN exchange rate was `₦92.34/$`)!
- **Fix:** Replace both maps with a unified `HISTORICAL_MACRO_DATA` table covering `1999` through `2026` (see Section 5.2), guaranteeing strictly positive, historically accurate price deflators and exchange rates for all years.

### 4.4 `SectorDistribution` Collapses All Records into One Slice
- **Location:** `ingestion/indexers/db_builder.py` (line 167) and `src/services/budgetDatabaseEngine.ts` (`getSectorDistribution`, line 165).
- **Bug:** `DbBuilder` hardcodes `"sector": "Capital Infrastructure"` on every record. Then `getSectorDistribution()` evaluates `r.mdaGovernanceTaxonomy.sector || r.mdaGovernanceTaxonomy.mdaName`. Because `"Capital Infrastructure"` is always truthy, 100% of records collapse into a single `"Capital Infrastructure"` slice (`100.0% Share`) instead of showing Ministries/Sectors!
- **Fix:**
  1. In `DbBuilder`, map each record's `agency` / `projectName` to an official Nigeria Budget Sector taxonomy (`Works & Housing`, `Power & Energy`, `Health & Social Welfare`, `Education`, `Defence & Security`, `Agriculture & Water Resources`, `Transport & Aviation`, `Finance & Economy`, `General Administration`)—or use `gemmaReview.category.primaryCategory` when available.
  2. In `budgetDatabaseEngine.ts:getSectorDistribution()`, aggregate by `mdaName` (or support a toggle between **By Ministry/MDA** and **By Functional Sector**).

### 4.5 `InvestigatorHeatmapWidget.tsx` Uses 100% Static Hardcoded State Data
- **Location:** `src/components/InvestigatorHeatmapWidget.tsx` (lines 24–62).
- **Bug:** Renders a static `STATE_ANOMALY_MAP` constant (`"Abia": "₦412.50 Billion"`, etc.) that never updates when `selectedYear` changes or when new years (`1999–2025`) are inspected.
- **Fix:** Compute state-level totals, project counts, top executing ministry, primary risk factor, and anomaly scores dynamically via `budgetDatabase.getStateDistribution(selectedYear)` and `applyRules()`.

### 4.6 `SqlDataExplorer.tsx` Runtime Crash on "Execute Query" & Pre-Built Queries
- **Location:** `src/components/SqlDataExplorer.tsx` (lines 14–24, 155, 186, 195).
- **Bug:** `useEffect` maps nested `BudgetRecord[]` into flat `{ id, financialYear, projectCode, projectName, amount, agency, state, page }` objects and passes `mapped` to `runQuery(mapped, query)`. However, the **"Execute Query"** button (line 155) and both quick-query buttons (lines 186, 195) pass raw `records` (`BudgetRecord[]`) directly to `runQuery(records, query)`. Inside `runQuery`, `p.projectName.toLowerCase()` crashes because `p.projectName` is `undefined` on `BudgetRecord` (it lives at `p.recordIdentity.verbatimProjectName`).
- **Fix:** Memoize `mappedRecords` with `useMemo` and pass `mappedRecords` everywhere (`runQuery(mappedRecords, ...)`), and populate the year `<select>` dynamically from `registry`.

### 4.7 `BudgetAuditCalculatorWidget.tsx` Falls Back to 2026 (`₦54.2T`) for Pre-2023 Years
- **Location:** `src/components/BudgetAuditCalculatorWidget.tsx` (lines 136, 171).
- **Bug:** Only fetches `statistics.json` if `year >= 2023 && year <= 2030`, and falls back to `INITIAL_BUDGET_MAP[2026]` (`₦54.20 Trillion`) for `1999–2022`. Viewing `1999` or `2005` displays `₦54.20 Trillion` in the Fiscal Audit Simulator!
- **Fix:** Remove the `year >= 2023` guard, merge fetched `statistics.json` with a historical `1999–2026` macro envelope table (Section 5.2), and dynamically compute proportions from ingested data when full pillar sub-breakdowns aren't in a legacy PDF.

### 4.8 Additional Calculation & UX Fixes (`duplicateDetector.ts`, `ruleEngine.ts`, `App.tsx`, `UniversalSearchModal.tsx`)
1. **`duplicateDetector.ts` (line 48):** Hardcodes `maxProjects = 15000`, silently skipping ~80% of projects in years with 60k+ records (`2023–2026`), and groups by first 4 words without distinguishing different states/LGAs (e.g., `"Construction of Primary Health..."` in 10 different LGAs gets falsely flagged as a duplicate). **Fix:** Remove the `15,000` cap, normalize full title + state/LGA, and run inside a memoized/chunked pass or Web Worker.
2. **`ruleEngine.ts` (line 271):** Hardcodes `agency: 'Federal Government of Nigeria'` instead of reading `p.agency`. **Fix:** Preserve `p.agency || 'Federal Government of Nigeria'`.
3. **`App.tsx` (lines 246, 347, 431):**
   - Citizen Projects table only slices `.slice(0, 40)` with no pagination or sorting (`amount`, `page`). Add pagination (`50` per page) and column sorting.
   - Citizen `compare` tab renders `<SpendingTrendChart />` while Investigator `compare` tab (`line 429`) renders `<RecurringLineagesExplorer />` — neither has a dedicated multi-year/presidential comparator! Route `compare` in both modes to the new **`HistoricalPresidentialCompare`** workstation.
4. **`UniversalSearchModal.tsx` (lines 188, 237, 282, 345):** Hardcodes `2026` and `2023–2026` in labels and sector filter counts (`p.financialYear === 2026`), and only searches the single currently loaded year (`extractedProjects`) instead of all ingested years in `BudgetDatabaseEngine`. **Fix:** Support searching across `"All Years (1999–2026)"` or `"Selected Year"`.

---

## 5. 1999–Present Day Multi-Year & Presidential Term Comparison Engine

To fulfill the requirement to **compare years, budgets, amounts, and 4-year presidential terms from 1999 to the present day (with president names and cropped portraits)**, the platform will add a first-class **`HistoricalPresidentialCompare`** workstation (`src/components/HistoricalPresidentialCompare.tsx`) backed by a dedicated dataset module (`src/data/presidentialTerms.ts`).

### 5.1 Presidential Tenure & 4-Year Term Registry (`src/data/presidentialTerms.ts`)
Nigeria's Fourth Republic (May 29, 1999 – Present) spans **5 Presidents** and **7 Constitutional 4-Year Terms**:

| Term ID | President Full Name | Party | Constitutional Tenure | Budget Years Covered | Portrait Asset Path | Notes |
|---|---|---|---|---|---|---|
| `OBJ-1` | **Olusegun Obasanjo** | PDP | May 29, 1999 – May 29, 2003 | `1999, 2000, 2001, 2002` | `/presidents/obasanjo.webp` | Return to democratic governance; includes 1999 Transition Supplementary Act. |
| `OBJ-2` | **Olusegun Obasanjo** | PDP | May 29, 2003 – May 29, 2007 | `2003, 2004, 2005, 2006` | `/presidents/obasanjo.webp` | Paris Club debt relief & NEEDS reform era; 2006 transition into 2007 Act. |
| `YAR-1` | **Umaru Musa Yar'Adua** *(with Goodluck Jonathan completing 2010)* | PDP | May 29, 2007 – May 5, 2010 *(Term: 2007–2011)* | `2007, 2008, 2009, 2010` | `/presidents/yaradua.webp` | 7-Point Agenda & Niger Delta Amnesty; Jonathan assumed Acting/Presidential authority in 2010. |
| `GEJ-1` | **Goodluck Ebele Jonathan** | PDP | May 29, 2011 – May 29, 2015 | `2011, 2012, 2013, 2014` | `/presidents/jonathan.webp` | Transformation Agenda & SURE-P; 2015 Appropriation Act passed May 2015 before handover. |
| `PMB-1` | **Muhammadu Buhari** | APC | May 29, 2015 – May 29, 2019 | `2015, 2016, 2017, 2018` | `/presidents/buhari.webp` | ERGP launch (`2017`) introducing standardized `ERGP...` project codes. *(2015 handover year toggleable).* |
| `PMB-2` | **Muhammadu Buhari** | APC | May 29, 2019 – May 29, 2023 | `2019, 2020, 2021, 2022` | `/presidents/buhari.webp` | Return to Jan–Dec budget cycle (`2020`), COVID-19 revised Act (`2020`), and `2023` Main Act (signed Jan 2023). |
| `BAT-1` | **Bola Ahmed Tinubu** | APC | May 29, 2023 – Present *(Term: 2023–2027)* | `2023*, 2024, 2025, 2026` | `/presidents/tinubu.webp` | Renewed Hope Agenda; 2023 Supplementary Act (`₦2.18T`), 2024–2026 Appropriation Acts. |

> **Transition-Year Attribution Rule (`2003`, `2007`, `2011`, `2015`, `2023`):**
> Because Nigerian budgets run Jan–Dec while presidential inaugurations happen on **May 29**, election/handover years have a documented attribution badge:
> - **Default Term Mapping (4 consecutive budget years per term):** `1999–2002`, `2003–2006`, `2007–2010`, `2011–2014`, `2015–2018`, `2019–2022`, `2023–2026` (7 clean 4-year blocks, 28 years total).
> - **Handover Year Note:** In `2023`, the Main Appropriation Act was enacted under Buhari (`Jan 2023`) while the `2023 Supplementary Appropriation Act` was enacted under Tinubu (`Nov 2023`). The UI provides a clear `"Attribution Mode"` toggle (`4-Year Term Window [1999–2002 ... 2023–2026]` vs. `Document Signatory Attribution`) and displays an info tooltip on handover years.

### 5.2 Historical Macroeconomic Benchmarks (`1999–2026`)
To avoid comparing raw nominal 1999 Naira directly against 2026 Naira (which creates a misleading >100× illusion due to inflation and Naira devaluation), the comparison engine normalizes every year and presidential term across **three metrics**:

1. **Nominal Naira (`₦`)**: Exact verbatim sum from official PDFs.
2. **Real (Inflation-Adjusted Constant 2026 Naira)**:
   $$\text{Real}_{2026}(y) = \text{Nominal}(y) \times \frac{\text{CPI}_{2026}}{\text{CPI}_{y}}$$
3. **USD Equivalent (`$`)**:
   $$\text{USD}(y) = \frac{\text{Nominal}(y)}{\text{FX\_Rate}_{y}}$$

Both `HISTORICAL_MACRO_DATA` (`1999–2026`) and `getAggregatedAssetsInventory()` inflation multipliers will reference one single shared constant table in `src/data/historicalMacroData.ts` (never producing negative values for `< 2020`). Each year entry will store:
- `year` (`1999..2026`)
- `termId` (`OBJ-1` .. `BAT-1`)
- `presidentName`
- `officialEnactedTotalNaira` (verified Federal Budget Act macro benchmark for reconciliation checks against extracted line items)
- `fxNairaPerUsd` (CBN annual average / budget benchmark rate, from `₦92.34/$1` in `1999` through `₦1,500–₦1,600/$1` in `2024–2026`)
- `cpiDeflatorTo2026` (cumulative CPI multiplier relative to 2026 = `1.0`, derived from NBS annual CPI series `1999–2026`)
- `assetInflationFrom2023` (positive scalar `> 0` for all `1999–2026`, e.g. `1999: 0.085` … `2023: 1.0` … `2026: 1.85`, replacing the broken linear formula `1.0 + (year - 2023) * 0.3`).

### 5.3 Cropped Presidential Portrait Assets & Component Design
- **Asset Storage (`public/presidents/`):**
  - Store high-resolution, square-cropped portraits (`256×256` WebP/PNG, centered on face via `object-fit: cover; object-position: center 20%`):
    - `public/presidents/obasanjo.webp`
    - `public/presidents/yaradua.webp`
    - `public/presidents/jonathan.webp`
    - `public/presidents/buhari.webp`
    - `public/presidents/tinubu.webp`
- **Reusable `<PresidentAvatar />` Component (`src/components/PresidentAvatar.tsx`):**
  - Renders a cleanly cropped circular portrait (`border: 2px solid`, party/term accent ring) with graceful initials fallback (`OO`, `UY`, `GJ`, `MB`, `BT`) if an image fails to load, plus hover tooltip showing full name, term dates, and party.

### 5.4 New Workstation: `HistoricalPresidentialCompare.tsx`
Accessible from both Citizen (`Compare Years`) and Investigator Pro (`Cross-Year Compare`), featuring **3 interactive sub-views** and a **Normalization Toggle (`Nominal ₦` | `Constant 2026 ₦ (Real)` | `USD $`)**:

1. **View A — 1999–Present Timeline & 4-Year Presidential Term Grid:**
   - **28-Year Stacked/Line Chart (`1999–2026`)**: Background shaded bands colored per Presidential Term with cropped portrait markers along the top axis.
   - **7 Presidential Term Summary Cards**: Each card displays:
     - Cropped President portrait + Name + Party badge + Term label (e.g., *Term 2 · 2003–2006*).
     - **4-Year Cumulative Budget** (Nominal, Real 2026 ₦, and USD `$`).
     - **4-Year Average Annual Budget** & **Term Growth (Year 1 → Year 4 %)**.
     - **Total Extracted Projects**, **Evidence Items Flagged**, and **Top Executing Ministry**.
     - Coverage indicator (e.g., `4 / 4 years ingested` vs. `3 / 4 years`).
2. **View B — President-vs-President (or Term-vs-Term) Head-to-Head Comparator:**
   - Two dropdown selectors (`Administration A` vs. `Administration B`, or `Full 8-Year Presidency A` vs. `Presidency B`).
   - Side-by-side cropped portrait hero headers with computed variance cards:
     - Cumulative Spend Delta (`+₦X` / `+Y%` nominal, real CPI-adjusted %, and USD %)
     - Capital Project Volume Delta
     - Average Project Allocation Size (`Total / Count`)
     - Year-by-Year overlaid bar chart (`Year 1, Year 2, Year 3, Year 4` of Term A vs. Term B).
     - Top 5 Ministries/Sectors shift comparison.
3. **View C — Custom Year-vs-Year & Multi-Year Comparator (`1999–2026`):**
   - Multi-select any 2 to 6 individual years (e.g. `1999` vs `2007` vs `2015` vs `2023` vs `2026`).
   - Displays each selected year's presiding President portrait & name, Total Extracted Budget, Official Enacted Envelope, Reconciliation Ratio, Project Count, Geo-Political Zone Allocation Comparison, and Top 5 Projects in each selected year.

---

## 6. Step-by-Step Implementation Roadmap (For Next Phase)

Once this document is reviewed and approved, execution should proceed in 3 clean phases:

### Phase 1: Pipeline Integrity, Re-Extraction & Live Streaming (`ingestion/`)
1. Fix `PdfParser._clean_amount()`, IPSAS hierarchy classification (`LEAF_CAPITAL`, `LEAF_PERSONNEL`, `LEAF_OVERHEAD`, `ROLLUP_SUMMARY`), `"0 0"` / year-number rejection, and Schedule/OCR handling in `ingestion/parsers/pdf_parser.py`.
2. Fix `StagingManager.save_raw_records()` idempotency (`sourceFile` replacement) in `ingestion/staging/staging_manager.py` and unique fingerprint-scoped record IDs.
3. Add `document_role` de-duplication in `ingestion/scanner/discovery.py` so competing Bills/Repeals/Duplicate listings do not double-count against Enacted Acts.
4. Persist partial Gemma reviews per checkpoint in `cli.py`, publish Stage 1 baseline datasets immediately (`STAGE1_RULE_VERIFIED`), and run `CascadeEngine.run()` (including `_rebuild_registry()`, `_rebuild_hierarchy_summary()`, and aligned `recurring_lineages.json`) after every file and checkpoint.
5. Re-extract/clean `ingestion/staging/` (`1999–2026`) and publish clean baseline datasets + cascade files so `public/datasets/` is immediately live and mathematically valid across `1999–2026` while Gemma continues Stage 2 enrichment.

### Phase 2: Frontend Dynamic Sync & Calculation Fixes (`src/`)
1. Update `public/sw.js` so `/datasets/*` JSON updates bypass stale cache.
2. Update `BudgetDatabaseEngine` and `BudgetDatabaseContext` to discover all years dynamically from `/datasets/registry.json`, poll every 15s for live ingestion updates, and add `forceRefresh`.
3. Create `src/data/historicalMacroData.ts` (`1999–2026` FX, CPI deflators, positive asset inflation factors, official enacted envelopes) to fix `getAggregatedAssetsInventory()` and `getRealTermsSpending()`.
4. Fix fake constants/crashes in `HeaderStats.tsx`, `SpendingTrendChart.tsx`, `SectorDistribution.tsx`, `InvestigatorHeatmapWidget.tsx`, `SqlDataExplorer.tsx`, `BudgetAuditCalculatorWidget.tsx`, `duplicateDetector.ts`, `ruleEngine.ts`, and `Sidebar.tsx`.

### Phase 3: 1999–2026 Presidential & Multi-Year Comparison Workstation (`src/` + `public/presidents/`)
1. Add cropped presidential portrait images under `public/presidents/` (`obasanjo`, `yaradua`, `jonathan`, `buhari`, `tinubu`) and `src/components/PresidentAvatar.tsx`.
2. Create `src/data/presidentialTerms.ts` with all 7 four-year terms (`1999–2002` through `2023–2026`).
3. Build `src/components/HistoricalPresidentialCompare.tsx` (Term Timeline, President-vs-President Head-to-Head, and Year-vs-Year Comparator with Nominal / CPI Real / USD toggles) and wire it into `App.tsx` and `Sidebar.tsx`.
4. Verify full TypeScript compilation (`npm run build`), Python pipeline tests (`python -m ingestion.cli --dry-run` / `--sync-live`), and live UI rendering across `1999–2026`.
