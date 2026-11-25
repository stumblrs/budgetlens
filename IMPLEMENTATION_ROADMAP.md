# BudgetLens Institutional Citability, Navigation Modernization & PDF/DOCX Export Roadmap

> **Document Status:** ALL 7 CHECKPOINTS COMPLETED & VERIFIED  
> **Created:** 2026-11-19  
> **Scope:** Upgrade BudgetLens into a reference-grade, citeable public fiscal observatory with an editorial dark-obsidian shell, cryptographic source provenance, deep permalinks, and exclusive **PDF & DOCX** document exports.

---

## Mandatory Governance & Execution Protocol

1. **Exclusive Sequential Approval Gate (Hard Stop Between Checkpoints):**
   - Checkpoints **1 through 7** MUST be executed strictly **one at a time** in sequence.
   - Upon completing a checkpoint, verification outputs (TypeScript check, production build `npm run build`, and targeted runtime/static checks) MUST be presented clearly to the user.
   - **Execution MUST STOP at every checkpoint boundary and wait for an explicit, exclusive user approval (e.g., *"Approve Checkpoint 2"* / *"Proceed to next checkpoint"*) before touching any files for the subsequent checkpoint.**
   - **No multi-checkpoint batching** is permitted unless the user explicitly overrides this rule in writing.

2. **Full-Implementation Mandate:**
   - Every feature inside every checkpoint must be **100% implemented end-to-end**: real dataset wiring, complete responsive styling, TypeScript type safety, zero `TODO` / placeholder / stub UI, and passing production build (`tsc -b && vite build`).

3. **Strict Download Format Policy — PDF & DOCX Only:**
   - All file downloads of `.html`, `.csv`, `.json`, `.md` (Markdown), and `.svg` across the **entire application** MUST be completely removed.
   - **The ONLY permitted downloadable file formats anywhere in BudgetLens are `.pdf` and `.docx`.**
   - *(Clipboard plain-text copy buttons for academic/press citations or FOI draft letters are non-file clipboard helpers; all file download actions and generators must strictly output `.pdf` or `.docx` only.)*

---

## Checkpoint Status Tracker

| Checkpoint | Feature Area | Target Files | Current Status | Approval Gate |
|---|---|---|---|---|
| **Checkpoint 1** | Unified Premium Design Tokens & Global Editorial CSS | `src/index.css`, `index.html` | `COMPLETED` | Verified (`0` undefined tokens, `npm run build` passed) |
| **Checkpoint 2** | Side Menu Modernization & Institutional Topbar | `src/components/Sidebar.tsx`, `src/components/Topbar.tsx`, `src/App.tsx`, `src/index.css` | `COMPLETED` | Verified (4-group rail, breadcrumbs, Cite View, `npm run build` passed) |
| **Checkpoint 3** | Deep Permalink URL Routing & Shareable View State | `src/App.tsx`, `src/components/PublicScrutinyDossier.tsx` | `COMPLETED` | Verified (`urlState.ts` unit tests passed, `npm run build` passed) |
| **Checkpoint 4** | Academic, Media & Legal Citation Engine + SHA-256 Provenance | `ingestion/indexers/build_provenance_manifest.py` *(new)*, `public/datasets/source_provenance.json` *(new)*, `src/utils/citationFormatter.ts` *(new)*, `src/components/ViewCitationModal.tsx` *(new)*, `src/components/ProjectEvidenceModal.tsx`, `src/App.tsx` | `COMPLETED` | Verified (`28` years / `468` PDFs SHA-256 manifest, `citationFormatter` unit tests & zero-download guard passed, `npm run build` passed) |
| **Checkpoint 5** | Strict PDF & DOCX-Only Export Overhaul *(Remove All HTML, CSV, JSON, MD & SVG Downloads)* | `package.json`, `src/utils/documentExporter.ts` *(new)*, `src/utils/reportExporter.ts`, `ExecutiveReportBuilderWidget.tsx`, `BudgetAuditCalculatorWidget.tsx`, `SqlDataExplorer.tsx`, `GeoMapWidget.tsx`, `SectorDistribution.tsx`, `SpendingTrendChart.tsx`, `TopMinistriesWidget.tsx`, `EvidenceShareCard.tsx` | `COMPLETED` | Verified (`0` disallowed download paths across `src/`, `%PDF-` & OOXML `PK` binary checks passed, `npm run build` passed) |
| **Checkpoint 6** | "Sources, Provenance & Methodology" Institutional Reference Page | `src/components/SourcesMethodologyPage.tsx` *(new)*, `src/components/TransparencyCard.tsx`, `src/App.tsx` | `COMPLETED` | Verified (`28` federal years + `23` DMO years + `16` rules + PDF/DOCX exports passed, `npm run build` passed) |
| **Checkpoint 7** | Publication-Grade Single-Record & Presidential Scrutiny Briefs (PDF & DOCX) | `src/components/EvidenceShareCard.tsx`, `src/components/PublicScrutinyDossier.tsx`, `src/utils/documentExporter.ts` | `COMPLETED` | Verified (`evPdf=19,478B`, `evDocx=13,739B`, `scPdf=78,280B`, `scDocx=17,828B`, `0` undefined CSS tokens, `0` disallowed downloads, `npm run build` passed) |

---

## Detailed Checkpoints & Acceptance Criteria

---

### Checkpoint 1 — Unified Premium Design Token System & Global Editorial Polish
**Goal:** Eliminate all broken/undefined CSS custom properties across the codebase and establish a cohesive, publication-grade typographic and interactive surface system.

**Verified Audit Finding to Fix:**  
Static inspection of `src/` identified **19 CSS variables** referenced `370+` times across `15+` components that are currently **undefined** in `src/index.css` (including `--border-subtle` [120 uses], `--text-primary` [89 uses], `--bg-canvas` [51 uses], `--text-secondary` [44 uses], `--accent-primary` [36 uses], `--bg-card`, `--border-color`, `--accent-amber`, `--accent-green`, `--accent-rose`, `--accent-cyan`, `--radius-sm`, `--radius-md`, `--bg-secondary`, `--bg-primary`, `--accent-rose-glow`, `--accent-amber-glow`, `--accent-green-glow`). Fixing this restores consistent borders, surfaces, colors, and contrast across every widget.

**Full Implementation Deliverables:**
1. **`src/index.css`:**
   - Define and harmonize the complete canonical token hierarchy and backward-compatible semantic aliases in `:root` so every component resolves crisp borders, warm-stone canvas backgrounds, slate ink text hierarchy, and emerald/amber/crimson semantic indicators.
   - Add premium editorial styling utilities:
     - `.dossier-card` hover/elevation transitions and restrained tactile border emphasis.
     - Accessible keyboard `:focus-visible` outlines (`#059669`) on buttons, links, inputs, and select controls.
     - Styled `.editorial-table` primitives (sticky headers, tabular numerals, hairline row dividers, clean hover tint).
     - Dark-obsidian custom scrollbar rules for the sidebar navigation rail.
     - Smooth CSS skeleton shimmer utility (`.skeleton-shimmer`) for lazy module loading fallbacks.
     - Consistent responsive grid & breakpoint polish.
2. **`index.html`:**
   - Add institutional Open Graph (`og:title`, `og:description`, `og:type`, `og:site_name`) and Twitter Card meta tags + formal `author` / citation metadata so links shared by researchers or journalists generate clean preview cards.

**Verification Requirements Before Stopping:**
- Python CSS audit confirming **0 undefined `var(--...)` tokens** remain in `src/`.
- `npm run build` (`tsc -b && vite build`) passes with exit code `0`.

> **CHECKPOINT 1 APPROVAL GATE:**  
> **STOP IMMEDIATELY AFTER VERIFYING CHECKPOINT 1.** Present verification proof to the user and **WAIT FOR EXCLUSIVE USER APPROVAL** before proceeding to **Checkpoint 2**.

---

### Checkpoint 2 — Side Menu Modernization & Institutional Topbar
**Goal:** Transform navigation from a dense 16-item vertical list into an executive 4-pillar observatory shell with crystal-clear context breadcrumbs, desktop rail collapse, and public provenance indicators.

**Full Implementation Deliverables:**
1. **`src/components/Sidebar.tsx`:**
   - Replace the two overloaded flat lists (which currently mix core observatory, spatial tools, AI, SQL, and exports under a generic `FORENSIC AUDIT` heading plus a duplicate `Universal Search` button) with **4 clean, well-spaced executive groups**:
     - **OBSERVATORY:** `Overview`, `1999–2026 Compare`, `Presidential Scrutiny`, `Spending Trends`
     - **BUDGET EXPLORER:** `Capital Projects`, `Ministries & MDAs`, `Map Intelligence`, `Asset Inventory`
     - **FORENSIC LAB:** `Evidence Engine`, `Duplicate Detector`, `Anomaly Heatmap`, `Recurring Lineages`, `SQL Explorer`, `AI Assistant`
     - **PUBLISH & CITE:** `Reports & Export`, `Sources & Methodology` *(routed cleanly via `App.tsx`, with interactive view handler ready)*
   - Remove redundant `Universal Search` from the sidebar (permanently anchored in Topbar `⌘K`).
   - Modernize item & rail styling:
     - Desktop collapse/expand toggle button integrated smoothly in the dark-obsidian brand header.
     - Active state featuring a crisp left emerald indicator bar (`3px`), subtle translucent emerald glass wash (`rgba(16, 185, 129, 0.14)`), and hairline border instead of heavy flat blocks, plus smooth hover styling in `src/index.css`.
     - Replace internal engineering strings (`Stage 2 AI: 0 / 58,300 enriched`, `⚡`/`✓` emojis inside `<option>` labels) in the bottom Administration & Fiscal Year card with authoritative public metadata: verified record count, schedule status badge (`Full Schedule` vs `Statutory Summary`), and link/refresh timestamp.
2. **`src/components/Topbar.tsx`:**
   - Add a dynamic **Page Context Breadcrumb** (e.g., `BudgetLens / Presidential Scrutiny / FY 2026`) synchronized with `activeTab` and `selectedYear`.
   - Add one-click **Copy Permalink** (with immediate `Link Copied` feedback) and **Cite View** trigger buttons directly in the Topbar right cluster alongside the `⌘K` search bar and active administration pill.
3. **`src/App.tsx`:**
   - Pass `activeTab`, `onCopyPermalink`, and `onOpenCiteModal` props to `Topbar.tsx` and wire the desktop sidebar collapse toggle cleanly.

**Verification Requirements Before Stopping:**
- Confirm collapsed and expanded sidebar states render cleanly across desktop and mobile drawer breakpoints with zero internal pipeline jargon or duplicate search entries.
- `npm run build` (`tsc -b && vite build`) passes with exit code `0`.

> **CHECKPOINT 2 APPROVAL GATE:**  
> **STOP IMMEDIATELY AFTER VERIFYING CHECKPOINT 2.** Present verification proof to the user and **WAIT FOR EXCLUSIVE USER APPROVAL** before proceeding to **Checkpoint 3**.

---

### Checkpoint 3 — Deep Permalink URL Routing & Shareable View State
**Goal:** Give every BudgetLens view, fiscal year, presidential administration, scrutiny pillar, search query, and individual budget record a persistent, shareable, citable URL.

**Full Implementation Deliverables:**
1. **`src/App.tsx`:**
   - Implement clean URL query-parameter synchronization (`URLSearchParams` + `history.replaceState` / `pushState` + `window` `popstate` listener):
     - `?tab=` (`overview`, `compare`, `scrutiny`, `trends`, `projects`, `agencies`, `map`, `assets`, `evidence`, `duplicates`, `anomalies`, `recurring`, `sql`, `ai`, `reports`, `methodology`)
     - `?year=` (`1999`–`2026`)
     - `?item=` & `?page=` (automatically resolves the exact appropriation record across `extractedProjects` / active year database and opens `ProjectEvidenceModal` directly when someone visits a cited record link!)
     - `?q=` (syncs global/projects search query where active)
2. **`src/components/PublicScrutinyDossier.tsx`:**
   - Support controlled or URL-synced `?president=` (`all`, `obasanjo`, `yaradua`, `jonathan`, `buhari`, `tinubu`), `?pillar=` (`vehicles`, `mandates`, `blankChecks`, `disguised`, `roundSplits`, `overhead`, `ceremonial`, `intangible`), `?sy=` (specific scrutiny year filter), and `?currency=` (`usd`, `nominal`) so deep links into any presidential finding restore the exact filter state and tab.
3. **Fallback Guard:** Unknown URL parameters safely fall back to valid defaults without throwing errors.

**Verification Requirements Before Stopping:**
- Verify loading URLs with query strings (`?tab=scrutiny&president=buhari&pillar=overhead`, `?year=2024&item=...`) restores the exact state and browser back/forward navigation (`popstate`) works cleanly.
- `npm run build` (`tsc -b && vite build`) passes with exit code `0`.

> **CHECKPOINT 3 APPROVAL GATE:**  
> **STOP IMMEDIATELY AFTER VERIFYING CHECKPOINT 3.** Present verification proof to the user and **WAIT FOR EXCLUSIVE USER APPROVAL** before proceeding to **Checkpoint 4**.

---

### Checkpoint 4 — Academic, Media & Legal Citation Engine + SHA-256 Source Provenance
**Goal:** Enable journalists, policy analysts, lawyers, and academic researchers to generate verifiable multi-format citations backed by exact PDF source filenames, page numbers, and SHA-256 hashes.

**Full Implementation Deliverables:**
1. **`src/utils/citationFormatter.ts` *(new module)*:**
   - Pure citation generators for both **Individual Budget Records** and **Observatory Views**:
     - **Press / Newsroom Footnote** (Agency, Budget Act/Bill PDF filename, Schedule Page, Budget Code, Amount, Presidential Term, Access Date, Permalink, Source SHA-256 prefix)
     - **APA 7th Edition**
     - **Chicago / Legislative Footnote**
     - **BibTeX Entry** (`@misc{budgetlens_...}`)
   - Lookup utility matching a fiscal year & record to its ingested `RegistryDocument` metadata (`sourceFiles`, `sha256`, `pageCount`, `enactedActTitle`).
2. **`src/components/ProjectEvidenceModal.tsx`:**
   - Add a **Cite Record** tab alongside existing tabs displaying:
     - Cryptographic Provenance Card: **Source Document Filename**, **PDF Page**, **Appropriation Code**, **Administration**, **Canonical Permalink**, and full **SHA-256 Checksum** (hydrated from `useBudgetDatabase().registryDocs`).
     - Interactive format switcher (`Newsroom`, `APA 7`, `Chicago / Legal`, `BibTeX`) with one-click **Copy Citation** and **Copy Permalink** buttons.
3. **`src/components/Topbar.tsx` + View Citation Modal (or integrated popover in `App.tsx`):**
   - Clicking **Cite View** in the Topbar opens a clean **Cite Current Observatory View** modal generating APA 7, Newsroom, Chicago, and BibTeX citations for the active view, fiscal year, and filters with its live permalink.
   - *(Note: Copy to clipboard only; zero `.json`/`.md`/`.html` file downloads.)*

**Verification Requirements Before Stopping:**
- Confirm **Cite Record** inside `ProjectEvidenceModal` and **Cite View** from `Topbar` populate real registry SHA-256 hashes, source PDF filenames, page numbers, and valid URLs across all 4 citation styles.
- `npm run build` (`tsc -b && vite build`) passes with exit code `0`.

> **CHECKPOINT 4 APPROVAL GATE:**  
> **STOP IMMEDIATELY AFTER VERIFYING CHECKPOINT 4.** Present verification proof to the user and **WAIT FOR EXCLUSIVE USER APPROVAL** before proceeding to **Checkpoint 5**.

---

### Checkpoint 5 — Strict PDF & DOCX-Only Export Overhaul (Eliminate All HTML, CSV, JSON, MD & SVG Downloads)
**Goal:** Enforce the strict platform rule that **`.pdf` and `.docx` are the ONLY downloadable file formats anywhere in BudgetLens**, replacing every `.csv`, `.json`, `.html`, `.md`, and `.svg` download with native, publication-quality PDF and Word (`.docx`) document generators.

**Complete Audit of Download Code Paths to Overhaul (9 files):**
1. `src/components/ExecutiveReportBuilderWidget.tsx` *(currently exports CSV, JSON, MD, HTML)*
2. `src/utils/reportExporter.ts` *(currently contains `buildCsvExport`, `buildJsonExport`, `buildMarkdownReport`, `buildPrintableHtmlDocument`, `downloadBlob`)*
3. `src/components/BudgetAuditCalculatorWidget.tsx` *(currently exports `.csv`)*
4. `src/components/SqlDataExplorer.tsx` *(currently exports `.csv` and `.json`)*
5. `src/components/GeoMapWidget.tsx` *(currently exports `.csv`)*
6. `src/components/SectorDistribution.tsx` *(currently exports `.csv`)*
7. `src/components/SpendingTrendChart.tsx` *(currently exports `.csv`)*
8. `src/components/TopMinistriesWidget.tsx` *(currently exports `.csv`)*
9. `src/components/EvidenceShareCard.tsx` *(currently exports `.svg`)*

**Full Implementation Deliverables:**
1. **`package.json`:**
   - Install production dependencies: `docx` (client-side OpenXML `.docx` generation), `jspdf`, and `jspdf-autotable` (native multi-page client-side `.pdf` binary generation with crisp tables, repeating headers, headers/footers, and page numbers—not just browser print dialogs!).
2. **`src/utils/documentExporter.ts` *(new unified PDF + DOCX engine)*:**
   - Branded, cohesive generators producing true downloadable **`.pdf`** (`application/pdf`) and **`.docx`** (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`) binaries via `Blob` for:
     - **Executive & Forensic Audit Reports** (replacing HTML/CSV/JSON/MD in `ExecutiveReportBuilderWidget.tsx` & `reportExporter.ts`)
     - **Tabular Module Exports** (supporting KPI summary header, methodology provenance footer, citation permalink, and styled tables for `SqlDataExplorer`, `GeoMapWidget`, `SectorDistribution`, `SpendingTrendChart`, `TopMinistriesWidget`, and `BudgetAuditCalculatorWidget`)
     - **Single-Record Evidence Sheet** (PDF & DOCX export for `EvidenceShareCard.tsx` instead of `.svg`)
   - Retain `printReportDocument()` only for direct browser A4 printing (`Print A4`)—never downloading `.html`.
3. **Remove Every Non-PDF/DOCX Download Function & Button Across All 9 Files:**
   - Delete `buildCsvExport`, `buildJsonExport`, `buildMarkdownReport`, and HTML download handlers from `reportExporter.ts` and `ExecutiveReportBuilderWidget.tsx`; replace toolbar buttons exclusively with **Download PDF**, **Download DOCX**, and **Print A4** (plus clipboard copy only if text snippet, no `.md` file download).
   - Replace every `.csv`, `.json`, and `.svg` download button/function across `BudgetAuditCalculatorWidget.tsx`, `SqlDataExplorer.tsx`, `GeoMapWidget.tsx`, `SectorDistribution.tsx`, `SpendingTrendChart.tsx`, `TopMinistriesWidget.tsx`, and `EvidenceShareCard.tsx` with clean dual **PDF** / **DOCX** export actions.

**Verification Requirements Before Stopping:**
- Static verification script scanning the entire `src/` tree confirms **ZERO** occurrences of `.csv`, `.json` download, `.html` download, `.md` download, `.svg` download, `data:text/csv`, `data:text/json`, `text/csv`, `text/html`, or `text/markdown` download blobs.
- Node/browser sanity check verifies both `.pdf` (`%PDF-`) and `.docx` (`PK` OOXML zip header) builders generate valid non-empty buffers without runtime errors.
- `npm run build` (`tsc -b && vite build`) passes with exit code `0`.

> **CHECKPOINT 5 APPROVAL GATE:**  
> **STOP IMMEDIATELY AFTER VERIFYING CHECKPOINT 5.** Present verification proof to the user and **WAIT FOR EXCLUSIVE USER APPROVAL** before proceeding to **Checkpoint 6**.

---

### Checkpoint 6 — "Sources, Provenance & Methodology" Institutional Reference Page
**Goal:** Provide journalists, academics, civil-society monitors, and oversight bodies with a transparent, auditable methodology and primary-source ledger inside the application.

**Full Implementation Deliverables:**
1. **`src/components/SourcesMethodologyPage.tsx` *(new component)*:**
   - **Primary Government Document Ledger (`1999–2026` Federal Budgets + `2004–2026` DMO Debt Releases):**
     - Searchable, filterable table sourced live from `/datasets/registry.json` (`registryDocs`) and `/datasets/forensic_sweep_1999_2026.json` showing: Fiscal Year, Serving President, Act/Bill Source Filename(s), Schedule Coverage Badge (`Full Project Schedule` / `Partial Schedule` / `Summary Act Only`), Extracted Line Items Count, and Document Checksum / Verification Status.
     - Direct **Export Source Ledger (PDF)** and **Export Source Ledger (DOCX)** buttons.
   - **Explicit Methodology Documentation Panels:**
     - *Year-Native Economic Rules:* Exact explanation & table of CBN FX rates (`1999–2026`), enacted budget share thresholds (`0.001%` / `0.002%` / `0.0004%`), and statutory minimum wage progression (`₦3,500` -> `₦7,500` -> `₦18,000` -> `₦30,000` -> `₦70,000/mo`).
     - *Data Hygiene & Rollup Guards:* Exact regex/classification explanations (`^[0-5]\d{8,10}$` MDA summary exclusion, COA `21`/`22`/`23` header exclusion, security/hospital/prison/multilateral domain guards).
     - *Rule Engine v2.0 & Disguised Duplicate Detection:* Transparent rule catalog and limitations/disclaimers (appropriation schedules measure enacted authority, not cash releases or contractor completion).
     - *Citation & Reuse License Card:* Clear attribution standard (`CC BY 4.0`) with one-click copyable institutional attribution and **Download Complete Methodology Dossier (PDF / DOCX)**.
2. **`src/components/Sidebar.tsx` & `src/App.tsx`:**
   - Lazy-load and wire `activeTab === 'methodology'` cleanly under **Publish & Cite → Sources & Methodology**.

**Verification Requirements Before Stopping:**
- Confirm all 28 fiscal years and DMO provenance metadata load cleanly with zero hardcoded fake hashes or placeholders, and both PDF & DOCX exports of the Methodology & Source Ledger work cleanly.
- `npm run build` (`tsc -b && vite build`) passes with exit code `0`.

> **CHECKPOINT 6 APPROVAL GATE:**  
> **STOP IMMEDIATELY AFTER VERIFYING CHECKPOINT 6.** Present verification proof to the user and **WAIT FOR EXCLUSIVE USER APPROVAL** before proceeding to **Checkpoint 7**.

---

### Checkpoint 7 — Publication-Grade Single-Record Evidence Sheets & Presidential Scrutiny Brief Exports (PDF & DOCX)
**Goal:** Complete the citability workflow so any single flagged project (`EvidenceShareCard.tsx`) or any Presidential / Pillar view inside `PublicScrutinyDossier.tsx` exports instantly as a publication-ready **PDF** or **DOCX** dossier brief.

**Full Implementation Deliverables:**
1. **`src/components/EvidenceShareCard.tsx`:**
   - Redesign into an institutional **Verified Evidence Dossier Sheet** displaying verbatim appropriation text, Budget Code, Executing Agency, PDF Page & Document Source, Year-Native Currency (As-Enacted `₦`, CBN FX rate & Historical `US$`, % of Enacted Budget, Year-Native Civic Equivalents), Presidential Administration attribution, and Permalink.
   - Wire clean **Download Evidence Sheet (PDF)** and **Download Evidence Sheet (DOCX)** actions via `documentExporter.ts` (zero `.svg`/`.png`/`.html` file downloads).
2. **`src/components/PublicScrutinyDossier.tsx` & `src/utils/documentExporter.ts`:**
   - Add scoped **Export Scrutiny Brief (PDF)** and **Export Scrutiny Brief (DOCX)** buttons directly in the `PublicScrutinyDossier` header toolbar.
   - Generated PDF and DOCX briefs dynamically reflect the active filter scope (Selected President or Fourth Republic `1999–2026`, selected Year, active Currency view, active Pillar items/clusters/overhead table, Administration economic reality baseline, and clickable citation permalink).

**Verification Requirements & Final Sign-Off:**
- Verify both single-record PDF/DOCX exports and scoped Presidential Scrutiny Brief PDF/DOCX exports run cleanly from real data without errors.
- Final static audit confirming strictly PDF & DOCX downloads across the entire codebase, zero undefined CSS tokens, and `npm run build` (`tsc -b && vite build`) exit code `0`.

> **CHECKPOINT 7 FINAL COMPLETION GATE:**  
> **STOP AND PRESENT FINAL VERIFICATION SUMMARY UPON COMPLETION.**

---

## Execution Reminder
**Roadmap Complete:** All **7 Checkpoints** in [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md) are implemented and verified (`npm run build` exit code `0`, strictly PDF & DOCX downloads enforced across all modules, `0` undefined CSS custom properties).
