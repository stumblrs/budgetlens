# BudgetLens — Nigeria Civic Fiscal Observatory (1999–2026)

**BudgetLens** is an open-source civic fiscal intelligence and forensic auditing platform covering **28 Federal Appropriation Cycles (1999–2026)** across **559,325 indexed line items** in Nigeria. It combines deterministic forensic rule engines, statistical anomaly detection, Bill-vs-Act legislative diffing, full-text SQLite FTS5 search, citation-grounded hybrid RAG, persistent citizen field verification, and formal **PDF / DOCX** accountability exports.

---

## Core Capabilities

### 1. Multi-Decade Budget & Regional Intelligence
- **28-Year Historical Coverage (1999–2026):** Presidential term comparison (Obasanjo, Yar'Adua, Jonathan, Buhari, Tinubu) with nominal vs. real USD & inflation-adjusted views.
- **Geo-Political Zone & Constituency Mapping:** Interactive 6-zone choropleth map backed by Nigeria's **109 Senatorial Districts** and **360 Federal Constituencies** (`36` States + `FCT`) in [`src/data/constituenciesDirectory.ts`](src/data/constituenciesDirectory.ts).
- **Web Worker Forensic Processing:** Heavy rule scanning and duplicate detection run off the main UI thread via [`src/workers/forensicWorker.ts`](src/workers/forensicWorker.ts).

### 2. Investigative Forensics & Legislative Diff Engines
- **Statistical Forensics Lab (`?tab=forensics`):**
  - **Benford's Law First-Digit MAD** conformity checks per year and MDA.
  - **Premature Asset Replacement Alerts** (identifying repeated durable capital allocations such as SUVs/generators/furniture while excluding consumables).
  - **Cross-Year / Cross-MDA Duplicate Rings** across 28 years.
  - Precomputed index: `public/datasets/statistical_forensics_1999_2026.json` (`28` years, `559,325` rows, `150` durable capital alerts, `3,225` cross-MDA rings).
- **Bill vs. Act Budget Padding Diff (`?tab=padding`):**
  - 3-tier legislative diff engine comparing Executive Appropriation Bills vs. National Assembly Enacted Acts across 7 cycles (including full `LINE_ITEM_SCHEDULE` diffs for `2019`, `2021`, `2022`, and `2025`).
- **Execution & Procurement Bridge (`?tab=execution`):**
  - Tracks Budget Implementation Reports (BIR) Enacted vs. Capital Releases (including FY `2016` across `697` MDAs and FY `2023`) alongside an OCDS / BPP NOCOPO / CAC connector.

### 3. Official Record Dossier, Casebook & Strict PDF/DOCX Accountability Exports
- **Full-Tab Official Record Dossier (`?tab=record`):** Virtual schedule view with SHA-256 document provenance, presidential/macro context, multi-style citations (`Newsroom`, `Academic`, `Legal`, `BibTeX`), and single-record PDF/DOCX evidence sheets.
- **Investigator Casebook (`?tab=casebook`):** Persistent multi-year evidence basket drawer and studio for compiling pinned projects and exporting verified **PDF** (`%PDF-`) and **DOCX** (OOXML `PK`) investigative dossiers.
- **Formal FOI Act 2011 & MP Oversight Packets:** Auto-addressed using an MDA FOI desk directory (`src/data/foiDeskDirectory.ts`) and matched Federal Constituency / Senatorial District representatives.
- **Strict Download Policy:** Only `.pdf` and `.docx` downloads are permitted anywhere in `src/` (enforced in unit tests and CI).

### 4. Instant All-Year Search (`⌘K`), Grounded AI & Citizen Field Verification
- **All-28-Year FTS5 Search (`⌘K` / `Ctrl+K`):** Queries `backend/data/budgetlens_fts.sqlite` (`559,325` rows) via FastAPI `/api/search` with automatic fallback to static `public/datasets/search_index_top.json`.
- **Citation-Grounded Hybrid RAG & Forensic AI Assistant (`?tab=ai`):**
  - Connected across SQLite FTS5 (`1999–2026`), Statistical Forensics, Bill-vs-Act Padding Diffs, BIR Capital Releases, and Constituencies.
  - Dedicated **Duplicate Hunter** (catches exact & verb-swapped disguised rewordings) and **Similar Items** (token-Jaccard + synonym matching with `% match` scores).
  - Enforces `verify_grounded_response()` so numbers and project codes not present in retrieved source rows cannot be fabricated.
- **Plain-English Hints & Glossary (`? Guide`):** Inline `?` explainers (`InfoHint`) on technical forensic metrics and a searchable Plain-English Budget & Forensics Guide modal in the top bar.
- **Citizen Field Verification (`/api/tips`):**
  - Persistent SQLite WAL store (`backend/db.py`, `backend/routers/tips.py`).
  - Photo attachments (`<= 3` files, `<= 5 MB` each) undergo **magic-byte validation** (`JPEG`, `PNG`, `WEBP`) and **Pillow EXIF/GPS metadata scrubbing**.
  - Submitter IPs are SHA-256 hashed for rate limiting and **never exposed** in API responses.
  - Supports public corroboration (`POST /api/tips/{tip_id}/corroborate`) and `X-Admin-Key`-protected moderation (`PATCH /api/tips/{tip_id}/moderation`).
  - Every report displays the mandatory legal disclaimer: *"Citizen Field Observation (Unverified Independent Report — Subject to Corroboration & Official BPP/Contractor Right-of-Reply)"*.

---

## Project Structure

```text
buget_lens/
├── src/
│   ├── components/       # Observatory dashboards, Forensics Lab, Padding Diff, Casebook, Evidence Modal
│   ├── context/          # BudgetDatabaseContext (live registry polling) & CasebookContext
│   ├── data/             # Constituencies (109/360), FOI Desk Directory, Presidential & Macro tables
│   ├── services/         # Rule engine, duplicate detector, budget database engine
│   ├── utils/            # PDF/DOCX exporter, citation formatter, URL state, Gemma overlay guard
│   └── workers/          # Web Worker for off-thread forensic scans
├── backend/
│   ├── main.py           # FastAPI entrypoint (/api/health, /api/search, /api/ai, /api/tips)
│   ├── db.py             # SQLite WAL citizen tips & rate-limit schema/queries
│   ├── routers/          # search.py, ai.py, tips.py
│   └── requirements.txt
├── ingestion/            # Python PDF parsers, FTS5 builder, Statistical Forensics, Bill-Act Diff, BIR/NOCOPO
├── public/datasets/      # Normalized 1999-2026 JSON datasets, SHA-256 registry, diffs, forensics artifacts
├── tests/
│   ├── python/           # Pytest suite (ingestion, FTS5/AI grounding, forensics, diffs, tips EXIF/security)
│   ├── unit/             # Vitest suite (engines, exporters, constituencies, URL state)
│   └── e2e/              # Playwright Chromium smoke tests (responsive overflow, permalinks, PDF downloads)
└── .github/workflows/ci.yml
```

---

## How to Run the Application

### Prerequisites
- **Node.js** `20+` and `npm`
- **Python** `3.11+` (with `.venv` recommended)

### Option A: Full-Stack Mode (Recommended — UI + Search/AI/Citizen Tips API)
Run the FastAPI backend and Vite frontend in **two terminals**:

**Terminal 1 — FastAPI Backend (`http://127.0.0.1:8000`):**
```bash
python -m venv .venv
# Windows PowerShell:
.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate

pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --port 8000
```
- Interactive API docs: `http://127.0.0.1:8000/docs`
- Health check: `http://127.0.0.1:8000/api/health`

**Terminal 2 — Vite Frontend (`http://localhost:5173`):**
```bash
npm install
npm run dev
```

### Option B: Standalone Static Frontend Mode (No Python Server Needed)
```bash
npm install
npm run dev
```
Open `http://localhost:5173`. All 28-year dashboards, Statistical Forensics Lab, Padding Diff Explorer, Official Record Dossier, Casebook Studio, and PDF/DOCX exports run offline from `public/datasets/` and `search_index_top.json`.

### Option C: Production Build & Local Preview
```bash
npm run build
npm run preview -- --port 4173
```
Open `http://127.0.0.1:4173`. Keep `uvicorn backend.main:app --port 8000` running alongside preview if you want live `/api/search`, `/api/ai`, and `/api/tips`.

---

## Configuration & Environment Variables

### Frontend (`import.meta.env`)
| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | `http://127.0.0.1:8000` | Base URL for FastAPI `/api/search`, `/api/ai`, and `/api/tips` endpoints. |

### Backend (`backend/`)
| Variable | Default | Description |
|---|---|---|
| `BUDGETLENS_FTS_DB` | `backend/data/budgetlens_fts.sqlite` | Path to the SQLite FTS5 28-year search database. |
| `BUDGETLENS_TIPS_DB` | `backend/data/citizen_tips.sqlite` | Path to the SQLite WAL database storing citizen field verification tips. |
| `BUDGETLENS_TIPS_PHOTOS_DIR` | `backend/data/tip_photos` | Directory where EXIF/GPS-scrubbed tip photos are written. |
| `BUDGETLENS_ADMIN_KEY` | `dev-admin-key-change-me` | Required `X-Admin-Key` header value for `PATCH /api/tips/{tip_id}/moderation`. **Set a strong secret in production.** |
| `BUDGETLENS_IP_SALT` | `budgetlens-ng-field-tips-salt` | Salt used when SHA-256 hashing submitter IPs for rate limiting. |
| `BUDGETLENS_RATE_LIMIT_MAX` | `12` | Max citizen field tip submissions per hashed IP per 1-hour window. |

### End-to-End Testing (Playwright)
| Variable | Default | Description |
|---|---|---|
| `PLAYWRIGHT_BASE_URL` | `http://127.0.0.1:4173` | Target URL for Playwright smoke tests. |
| `PLAYWRIGHT_SKIP_WEBSERVER` | *(unset)* | Set to skip launching `npm run preview` automatically when targeting an already-running server. |

---

## Deep-Link Permalink Parameters

Navigate directly to any observatory view via query parameters:
- `/?tab=scrutiny&year=2025` — Public Scrutiny Dossier
- `/?tab=forensics&year=2025` — Statistical Forensics Lab (Benford MAD, Lifecycle Alerts, Duplicate Rings)
- `/?tab=padding&year=2025` — Bill vs. Act Budget Padding Diff Explorer
- `/?tab=execution&year=2023` — Execution Releases & Procurement Bridge
- `/?tab=casebook` — Investigator Casebook Studio
- `/?tab=record&year=2025&id=<record-id>` — Full-Tab Official Record Dossier

---

## Investigator Casebook How-To

1. **Pin evidence from any view:**
   - **Project Evidence Modal:** Open any line item and click **`Pin to Casebook`**.
   - **AI Assistant (`?tab=ai`):** Click **`Pin`** on any verbatim citation or similar-item card.
   - **Duplicate Clusters (`?tab=duplicates`):** Expand a cluster and click **`Pin Cluster to Casebook`**.
   - **Statistical Forensics (`?tab=forensics`):** Expand an alert and click **`Pin Alert to Casebook`**.
   - **Bill vs. Act Padding (`?tab=padding`):** Click the bookmark icon on the right side of any diff row.
2. **Review & annotate:** Click the **Casebook** button in the top bar to open the slide-over drawer, add quick notes, reorder pins, or switch casebooks.
3. **Organize multiple investigations:** Open **`/?tab=casebook`** (or click **Studio** in the drawer) to create/delete casebooks, add longer commentary and tags, and view cross-year exposure metrics.
4. **Export:** Click **`Export Casebook Dossier (PDF)`** or **`Export Casebook Dossier (DOCX)`** to download a publication-ready report. *(Casebooks are saved locally in your browser's `localStorage`.)*

---

## Ingestion & Index Builders

### Smart PDF Ingestion CLI (`ingestion/cli.py`)
```bash
python -m ingestion.cli --dry-run          # Discovery report only (no writes)
python -m ingestion.cli --skip-gemma       # Rule-engine-only extraction
python -m ingestion.cli --overnight        # Conservative/thermal-safe Stage-2 enrichment
python -m ingestion.cli --resume-only      # Finish partial checkpoints only
python -m ingestion.cli --force 2024       # Re-ingest a specific budget year
```

### Derived Dataset & Search Index Builders
Run builders from the repository root inside your Python environment when updating source PDFs or datasets:
- `python -m ingestion.indexers.statistical_forensics_builder` — Rebuilds `public/datasets/statistical_forensics_1999_2026.json`
- `python -m ingestion.indexers.bill_act_diff_builder` — Rebuilds `public/datasets/bill_act_diffs/`
- `python -m ingestion.indexers.fts_builder` — Rebuilds `backend/data/budgetlens_fts.sqlite` and `public/datasets/search_index_top.json`
- `python -m ingestion.parsers.bir_parser` — Rebuilds `public/datasets/execution_tracker.json`
- `python -m ingestion.parsers.nocopo_connector` — Rebuilds `public/datasets/procurement_links.json` from `procurement_data/`

---

## Testing & CI Verification

All checks below are automated in [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

```bash
# TypeScript & Production Build
npx tsc -b
npm run build

# Frontend Unit & Binary Export Tests (Vitest)
npx vitest run

# Backend & Ingestion Tests (Pytest)
pytest tests/python/ -v

# Browser E2E Smoke Suite (Playwright Chromium)
npx playwright install chromium
npx playwright test
```
