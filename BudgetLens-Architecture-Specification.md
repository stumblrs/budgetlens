# BudgetLens

## The Evidence Engine for Nigerian Budget Transparency
### Unified Technical Architecture & Product Design Specification (v1.0)

> **Search. Verify. Understand. Hold Government Accountable.**

---

## 1. Vision & Philosophy

BudgetLens exists to make government budget documents — starting with the Nigerian Federal Appropriation Bill, published as a ~7.5 MB PDF by the Budget Office of the Federation — searchable, understandable, and analyzable by ordinary citizens, journalists, researchers, civil-society organizations, and policymakers.

The single most important design decision behind the whole product is this:

> **Build an Evidence Engine, not an opinion engine.**

| ❌ Opinion Engine | ✅ Evidence Engine |
|---|---|
| "This is government irresponsibility." | "This budget item matches one or more predefined transparency rules. Here is the evidence." |
| Flags = accusations | Flags = reproducible, citable findings |
| AI decides | AI explains |

This distinction is what makes the platform credible, legally defensible, and hard to dismiss. Every conclusion the platform surfaces must be traceable back to an official government document, a specific page, and a specific rule.

**The user journey the entire product is built around:**

```
Question → Search → Evidence → Original Budget Page → AI Explanation
→ Historical Comparison → Download → Share
```

Everything revolves around answering a citizen's question — not showcasing analytics for their own sake.

---

## 2. Core Principles

### 2.1 Evidence over Opinion
Every statement on the platform must answer: *"What evidence supports this?"* Every flag carries:
- Original document + page number
- Budget code, ministry, allocation amount
- Rule(s) triggered + rule version
- Confidence level
- Comparable allocations

No unsupported claims are permitted anywhere in the UI or API.

### 2.2 Explainability
Every automated conclusion must be reproducible by a third party using only public information: the rule definition, the threshold, and the source page.

### 2.3 Neutrality
The system never says *"This is corruption."* It says *"This allocation matches transparency review criteria."* This single wording choice is applied everywhere — including renaming "Flagged" (technical/accusatory) to **"Evidence Items"** (neutral, mission-aligned) throughout the citizen-facing UI.

### 2.4 Transparency of Method
Every rule, threshold, and algorithm is documented and versioned publicly. Users can inspect *why* something was flagged, reproduce the analysis independently, and propose rule changes.

---

## 3. Product Structure: One Platform, Two Experiences

A key refinement made after the initial architecture was drafted: **the original spec was backend-first (rules, pipelines, APIs); the product must be citizen-first.** A citizen doesn't care about Meilisearch or a Rule Engine — they care about:

- Where is my state's money going?
- Why was this project flagged?
- Can I trust this evidence?
- How do I verify this myself?

This produces a deliberate split into two modes, sharing one backend and one Evidence Engine:

| | **Citizen Mode** | **Investigator Mode** (Pro) |
|---|---|---|
| Audience | General public | Journalists, NGOs, researchers |
| Feel | Google meets Bloomberg meets GitHub | Analytical workbench / BI tool |
| Scope | Federal budget · pilot states rolling out per §18.3 | Federal + all ingested states/LGAs |
| Sidebar | Dashboard, Search Budget, Projects, Ministries & Agencies, Evidence Engine, Interactive Map, Historical Comparison, Duplicate Detector, Recurring Projects, Take Action (§18.1), Reports, AI Assistant, Bookmarks, Saved Searches | Overview, Advanced Search, Rule Builder, Evidence Explorer, Duplicate Detector, Recurring Project Explorer, Anomaly Finder, Cross-Year Compare, Agency Network, Map Intelligence, Spending Trends, Data Explorer (SQL), Bulk Export |
| Key surfaces | KPI cards, sector doughnut, geographic map, top ministries, recent evidence feed, transparency card, AI assistant, quick actions | KPI cards (Total Allocations, Evidence Items, Duplicate Clusters, Anomalies Detected), spending anomaly heatmap, top spending anomalies table, duplicate clusters (top 5), investigations workspace (My Investigations / Shared / Starred / Trash), evidence graph |
| Terminology | "Evidence Items", "Recent Evidence", never "Flagged" | Can expose raw counts, severity tiers, rule IDs directly |
| Export | Share deep links | Bulk export (CSV/JSON/Excel), SQL Query Builder |

Notably, **"Data Explorer" is deliberately absent from the Citizen sidebar** — citizens don't think in terms of "data," they think "show me projects in Kano." Raw data access is an Investigator-mode capability.

### 3.1 Citizen Dashboard Layout

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ LOGO              Universal Search                    Year    Profile    │
├──────────────┬─────────────────────────────────────────────────────────┤
│              │ 2026 Federal Budget Dashboard                             │
│ Navigation   │ "Search, Analyze and Verify Government Spending."         │
│              ├─────────────────────────────────────────────────────────┤
│ Dashboard    │ Budget KPIs: Total ▲vs last yr | Items | Evidence Items   │
│              │ | MDAs — current year primary, prior year shown as delta  │
│ Search       ├─────────────────────────────┬───────────────────────────┤
│ Ministries   │ Budget by Sector (doughnut)  │ Geographic Distribution   │
│ Evidence     │                              │ (Nigeria map)             │
│ Projects     ├─────────────────────────────┼───────────────────────────┤
│ Map          │ Top Ministries               │ Budget Trends (line)      │
│ Trends       ├─────────────────────────────┼───────────────────────────┤
│ AI           │ Recent Evidence (cards)      │ AI Assistant              │
│ Compare      ├─────────────────────────────┼───────────────────────────┤
│ Reports      │ Transparency Score           │ Quick Actions             │
└──────────────┴─────────────────────────────────────────────────────────┘
     Footer: "Every conclusion is traceable to an official government
     document. The platform provides evidence — not accusations."
```

Reference implementation (see uploaded screenshots): total budget, total projects, evidence items, infrastructure vs. administrative split, sector doughnut, geo-political zone choropleth, top ministries by allocation, recent flagged/evidence projects with severity + page citation, multi-year spending trend line chart, and an "Evidence Engine Summary" panel (active rules, projects flagged, duplicate clusters, high-severity flags, evidence items).

### 3.2 Investigator Dashboard Layout

Reference implementation: total budget with YoY delta, total allocations, evidence items, duplicate clusters, anomalies detected (severity-tagged); sector doughnut with larger totals (all years/full dataset); a **spending anomaly heatmap over the Nigeria map**; a **Top Spending Anomalies** table (project, agency, amount, severity); an **Investigator Tools** rail (Rule Builder, Duplicate Detector, Cross-Year Compare, SQL Query Builder, Bulk Export, Evidence Graph); **Duplicate Clusters (Top 5)** table; spending trend analysis across budget/infrastructure/administrative/consultancy; **My Investigations** workspace (private/shared), and the same Evidence Engine Summary panel broken out by severity (High/Medium/Low) and entities indexed.

### 3.3 Global Search — the Centerpiece

Not a plain `Search...` box. Instead:

```
Search projects, ministries, locations or ask a question...
```

Examples the placeholder/autocomplete should support:
```
hospital in Kano
vehicle procurement
consultancy
road projects
Why was this flagged?
Show projects over ₦2B
Compare education 2025 vs 2026
```

The search bar is simultaneously: **search box + command palette + AI entry point.**

### 3.4 Transparency Card (Trust UI)

A persistent widget reminding users why they can trust the platform:

```
Transparency
✔ Source Verified
✔ SHA-256 Verified
✔ Rule-Based Analysis
✔ AI Explains
✔ AI Never Decides
[View Methodology]
```

Combined with a permanent green footer banner: *"Every conclusion is traceable to an official government document. The platform provides evidence — not accusations."*

### 3.5 "Why Was This Flagged?" Panel

The platform's signature UX feature. Instead of a verdict, a checklist of matched criteria:

```
Why flagged
✔ Large renovation
✔ Above historical average
✔ Similar project exists elsewhere
✔ Generic project description

Confidence: 82%
Evidence: Page 344, Budget Code XYZ
```

Every evidence item, everywhere in the product, includes a **"View Source"** link back to the exact PDF page.

---

## 4. High-Level System Architecture (Unified / Recommended)

Multiple architectural iterations are captured in the source material — a pure client-side/offline version, a pure backend/Postgres version, and a hybrid. **The recommended final architecture is the hybrid**, because it combines the scalability and analytical power of a backend with the cost-efficiency and resilience of static, CDN-served data for the 90–99% of traffic that is read-only.

```text
                         Government Budget PDF(s)
                                    │
                                    ▼
                     Document Ingestion / ETL Pipeline
                    (PDF extraction, OCR fallback, table
                     parsing, normalization, versioning)
                                    │
                                    ▼
                  PostgreSQL — Neon or Supabase (source of truth)
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                      ▼
       Full-Text Index         Rule Engine            Embedding Engine
      (Meilisearch/Tantivy)   (deterministic,        (vector search for
                                versioned rules)       duplicate detection)
              │                     │                      │
              └─────────────────────┼──────────────────────┘
                                    ▼
                            Evidence Objects
                        (first-class, precomputed,
                          stored — not computed on demand)
                                    │
                     ┌──────────────┴───────────────┐
                     ▼                               ▼
        Static Publishing Pipeline              Dynamic API
    (nightly job → versioned JSON/CDN)     (accounts, bookmarks,
                     │                       saved searches, admin,
                     ▼                       rule management, chat)
            Cloudflare CDN / R2 / Vercel
                     │                               │
                     └───────────────┬───────────────┘
                                     ▼
                        Next.js Progressive Web App
                                     │
                     ┌───────────────┴───────────────┐
                     ▼                               ▼
         Search, Filters, Charts, Maps,        Optional Local LLM
         PDF Viewer — works with NO AI          (WebLLM / Gemma 3 1B)
```

### 4.1 Why the database is not on the public read path

The key insight driving this design: **budget data is almost static.** It's imported once per fiscal year and essentially never changes. Treating it like a live transactional dataset wastes egress and money.

- 50,000 projects × ~800 bytes (JSON) ≈ 40 MB. Serving that in full to 1,000 users/day ≈ 40 GB/day — enough to blow through any free tier.
- Instead: publish versioned static datasets after each ingestion run, serve them from a CDN, and query the database only for **searches that need it** (returning tens of KB, not the whole dataset) and for **dynamic, per-user features**.

Static artifacts published per fiscal year:
```
/datasets/2026/projects.min.json
/datasets/2026/search-index.json
/datasets/2026/agencies.json
/datasets/2026/statistics.json
/datasets/2026/evidence.json
```

The PWA downloads only what it needs and caches it offline (service worker + IndexedDB). Local search runs against a prebuilt index (MiniSearch / FlexSearch / compressed Meilisearch export).

### 4.2 What the database (Neon/Supabase) IS for

| Keep in Postgres | Do NOT serve directly from Postgres on every page view |
|---|---|
| User accounts / auth | Full project list |
| Bookmarks, saved searches, followed ministries | Statistics recomputed per request |
| Collections, annotations, reports | Full record payload for search-result rows |
| Rule definitions + version history | |
| Budget ingestion + background jobs (BullMQ) | |
| Admin dashboard | |
| Analytics | |

**Supabase vs. Neon:** Neon is the leaner choice if the app is purely Next.js → Postgres → REST API (fast, cheap, branching databases, great with Prisma/Drizzle). Supabase is the better choice once the roadmap includes accounts, bookmarks, saved searches, following ministries, collections, and crowdsourced annotations, since it bundles Auth, Storage, Realtime, Edge Functions, and Row Level Security out of the box.

### 4.3 Data layering: current budget is primary, past budgets are context

BudgetLens ingests every fiscal year it can get its hands on, but **not all years are equal in the product**. The dataset is layered:

| Layer | Role | Where it shows up |
|---|---|---|
| **Current year (e.g. 2026)** | Primary / authoritative. Drives the default dashboard, default search scope, default KPIs, default evidence feed. | Homepage, Citizen Dashboard, Investigator Overview, default `/search` scope |
| **Prior years (2023–2025, etc.)** | Secondary / comparative context. Never the default view, always one click away. | "vs last year" deltas on KPI cards, Cross-Year Compare, Spending Trend charts, Recurring Project Detection (§9) |

Practically, this means:

- Every ingestion writes a `financial_year`-scoped partition. The current year is flagged `is_active_year: true` in the dataset registry, and all default API/UI queries implicitly filter to it unless a year or a comparison is explicitly requested.
- KPI cards on the dashboard show the current year's number **plus a small delta vs. the prior year** (e.g. `₦49.7T Federal Budget  ▲ +8.7% vs 2025`) — a comparison is visible everywhere at a glance without requiring a separate view.
- The **Compare Years** / **Cross-Year Compare** tool remains the place for deep side-by-side analysis, but lightweight comparisons surface passively on the main dashboard so people don't have to go looking for them.
- Historical years are stored at full fidelity (not summarized away) specifically so Recurring Project Detection (§9) and duplicate/anomaly rules can reference them — they're "extra information," not dead weight.

### 4.4 Egress & cost discipline (applies regardless of DB choice)

1. **Never `GET /projects`** (all rows). Always paginate/filter: `GET /search?q=hospital&limit=20`.
2. **Search results return thin objects** (`id, title, agency, amount`), not full records with description/history/evidence — fetch the fat object only on `GET /projects/{id}`.
3. **Precompute dashboards** via a nightly job that emits `statistics.json`; the homepage should not touch the database at all.
4. **Cache aggressively**: browser cache, service worker, CDN, Next.js static rendering, HTTP cache headers — after the first request most responses shouldn't hit the DB.
5. **Store every evidence object as a first-class, precomputed record** (not recalculated on demand), enabling powerful, cheap filtered queries like `/evidence?rule=HIGH_RENOVATION_COST`, `/evidence?state=Kaduna`, `/evidence?severity=high`.

---

## 5. Data Pipeline (ETL) — Local PDF Ingestion & Year Configuration

This is the part of the system that turns a downloaded/locally-supplied budget PDF into a queryable, year-aware dataset. It answers three things directly:

1. **How does a local PDF actually get extracted?** (§5.1)
2. **How does the system know which year is "current" vs. historical, and how do you configure that?** (§5.6)
3. **How does "year" propagate through the whole stack** so every API call, dashboard, and comparison knows which budget(s) it's looking at? (§5.8)

```text
Local PDF file (e.g. ./raw/2026/appropriation-bill.pdf)
        │
        ▼
1. File intake & fingerprint  (SHA-256, page count, file size)
        │
        ▼
2. Text-layer extraction       (pdfplumber / PyMuPDF)
        │
        ▼
3. Table extraction            (Camelot / Tabula, per-page)
        │
        ▼
   Text layer usable? ── No ──► 3b. OCR fallback (pdf2image + Tesseract)
        │ Yes                          │
        ▼◄─────────────────────────────┘
4. Row parsing → raw rows (agency, project, amount, page, raw text)
        │
        ▼
5. Normalization  (currency parsing, header-drift mapping, whitespace/
   encoding cleanup, sector/ministry taxonomy mapping)
        │
        ▼
6. Validation & reconciliation (row count sanity check, sub-totals vs.
   stated ministry totals, stated grand total vs. SUM(amount))
        │
        ▼
7. Write to Postgres, partitioned by financial_year
        │
        ▼
8. Index for search (Meilisearch) → Generate embeddings → Run Rule
   Engine (§7) → Cross-year lineage resolution (§9.3) → Evidence Objects
        │
        ▼
9. Publish static JSON snapshot for the year → CDN
        │
        ▼
10. Update Dataset Registry (§5.6) — mark this year's ingestion status
```

This still runs **once per ingestion, server-side** — not once per visitor (§4). The only thing that's new here versus the earlier high-level version of this diagram is that steps 1–6 are now concrete enough to actually build against.

### 5.1 Extraction tooling (why each tool is there)

| Stage | Tool | Why |
|---|---|---|
| Text extraction | `pdfplumber` or `PyMuPDF` (`fitz`) | Fast, reliable text-layer extraction with per-page/per-word coordinates — needed to keep page numbers accurate for citations |
| Table extraction | `camelot-py` (lattice + stream modes) or `tabula-py` | Nigerian appropriation bills are table-heavy; Camelot's lattice mode handles ruled tables, stream mode handles whitespace-aligned ones — try both, keep whichever yields more consistent column counts per page |
| Scanned/image pages | `pdf2image` + `Tesseract OCR` | Fallback only — triggered automatically when a page's extracted text is near-empty relative to its rendered content, which happens with scanned annexes or low-quality reproductions |
| Row → schema mapping | Custom normalization layer (§5.2) | Government PDFs are not structured data; every extracted row needs currency parsing (`₦2,830,000,000` → `2830000000`), whitespace/line-break cleanup, and column-header reconciliation |

Every extraction run logs, per page: extraction method used (text vs. OCR), row count found, and any parse warnings — this log is itself stored so a failed or low-confidence page is flagged for manual review rather than silently producing bad data.

### 5.2 Handling year-to-year format drift

Budget documents don't keep the exact same column layout, header wording, or table structure from one year to the next — a naive "the 2025 parser will work on 2026" assumption breaks quietly. The pipeline handles this with:

- **A per-year extraction profile**, not one hardcoded parser. Each year's ingestion run stores which column-header aliases it matched (e.g. `"Head"` vs. `"Budget Code"` vs. `"Sub-Head"` all map to `budget_code`), so drift is visible in the ingestion log rather than silently mis-mapped.
- **Fuzzy header matching** (Levenshtein/embedding similarity against a canonical header dictionary) so a renamed column doesn't cause the whole page to be dropped.
- **Reconciliation as a drift detector**: if step 6's totals don't reconcile within a small tolerance, that's the signal something in this year's layout changed and needs a human to look at the extraction profile before publishing — the platform never silently publishes a partially-broken year.

### 5.3 Budget Record Schema

```json
{
  "financial_year": 2026,
  "agency": "",
  "ministry": "",
  "department": "",
  "budget_code": "",
  "project_name": "",
  "description": "",
  "state": "",
  "lga": "",
  "sector": "",
  "amount": 0,
  "page": 0,
  "document_url": "",
  "source_document_id": "DOC-2026-01"
}
```

`source_document_id` is new versus the earlier draft of this schema — it's the foreign key into the Dataset Registry (§5.6), so every single record can answer "which exact source file, of which exact hash, did this come from?"

### 5.4 Evidence Object Schema

Evidence, not opinion, is the unit of storage:

```json
{
  "id": "EV-2026-004812",
  "rule": "HIGH_RENOVATION_COST",
  "project_id": "P-12893",
  "financial_year": 2026,
  "severity": "medium",
  "confidence": 0.97,
  "reason": "Renovation allocation exceeds threshold",
  "page": 441,
  "budget_code": "XYZ-123",
  "created_at": "2026-01-12T10:15:00Z",
  "rule_version": "1.3.0"
}
```

`financial_year` is now explicit on the evidence object too (not just inferable via `project_id`), since evidence needs to be filterable/queryable per-year directly (`/evidence?year=2026&severity=high`) without a join.

### 5.5 Immutability & Source Integrity

- No editing of government data; records are immutable once ingested.
- Every imported document is fingerprinted and versioned:
  - SHA-256 hash
  - Upload date
  - Source URL (or `local` if supplied as a local file, plus the original filename)
  - Version history

This preserves evidentiary integrity — a citation from BudgetLens should always be checkable against a byte-identical source file.

### 5.6 Dataset Registry & Year Configuration

This is the single source of truth for "which year is current" and "what has been ingested so far." It's a small Postgres table (also mirrored to a static `registry.json` for the frontend), **not** scattered config flags across the codebase:

```json
{
  "active_year": 2026,
  "documents": [
    {
      "financial_year": 2023,
      "status": "archived",
      "source_file": "2023-appropriation-bill.pdf",
      "source_type": "local_upload",
      "sha256": "a1b2c3...",
      "page_count": 612,
      "ingested_at": "2025-02-11T09:00:00Z",
      "reconciliation_passed": true,
      "extraction_profile": "profile-2023-v1"
    },
    { "financial_year": 2024, "status": "archived", "...": "..." },
    { "financial_year": 2025, "status": "archived", "...": "..." },
    {
      "financial_year": 2026,
      "status": "active",
      "source_file": "2026-appropriation-bill.pdf",
      "source_type": "local_upload",
      "sha256": "d4e5f6...",
      "page_count": 843,
      "ingested_at": "2026-01-12T08:30:00Z",
      "reconciliation_passed": true,
      "extraction_profile": "profile-2026-v1",
      "notes": "Active year — drives default dashboard, search, and KPIs"
    }
  ]
}
```

Rules this registry enforces:

- Exactly **one** year has `status: "active"` at a time. Every other ingested year is `"archived"` — fully queryable, but never the default.
- `reconciliation_passed: false` blocks a year from being promoted to `active` — you can't accidentally make a broken extraction the site's front page.
- Both a fetched official URL and a **locally supplied file** are first-class (`source_type: "official_url"` vs. `"local_upload"`) — the pipeline in §5.1–§5.2 doesn't care where the PDF came from, only that it's fingerprinted and logged the same way either way.

### 5.7 Ingestion workflow (local PDF → published year)

For a local PDF, the intended operator workflow is a single command (CLI, or the equivalent action in an admin panel):

```bash
budgetlens ingest \
  --file ./raw/2026/appropriation-bill.pdf \
  --year 2026 \
  --set-active
```

What that does, mapped back to the pipeline above:

1. Copies/fingerprints the file, creates its Dataset Registry entry as `status: "pending"`.
2. Runs extraction + normalization + validation (§5.1–§5.2).
3. If reconciliation fails → registry entry becomes `status: "failed"`, ingestion halts, nothing is published, and the operator gets the per-page warning log to fix the extraction profile.
4. If reconciliation passes → runs indexing, embeddings, rule engine, and cross-year lineage resolution against every prior `archived` year (§9.3).
5. Publishes the static JSON snapshot for that year.
6. Only if `--set-active` was passed: flips `active_year` to this year and demotes the previous active year to `archived` — a single atomic registry update, so the site is never in a state where two years are simultaneously "current" or where none is.

Ingesting a past year you don't yet have (say, backfilling 2022) uses the exact same command without `--set-active` — it becomes an archived, queryable year immediately usable by Cross-Year Compare and Recurring Project Detection, without touching what the site currently shows as "the budget."

### 5.8 Year-awareness across the stack

Once the registry exists, "year" becomes a first-class, explicit parameter everywhere rather than an assumption baked into the code:

| Layer | How it stays year-aware |
|---|---|
| Database | Every table that holds year-scoped data (`projects`, `evidence`, `search index rows`) carries `financial_year`; queries without an explicit year implicitly filter to `registry.active_year` |
| Static datasets | Path-namespaced per year (`/datasets/2026/...`, §4.1) — nothing overwrites a prior year's snapshot |
| API | Every list/detail endpoint accepts an optional `?year=` — omitted defaults to `active_year`; comparison endpoints (`/compare`, `/recurring`) take explicit multi-year ranges instead |
| Frontend | A global **year switcher** (already present in the Citizen dashboard header, per the reference screenshots — "2026 Federal Appropriation Bill … Change Year") reads the registry and re-scopes the whole app; switching years is a client-side re-fetch of that year's static dataset, not a different app |
| Admin | Registry status (`active` / `archived` / `pending` / `failed`) is visible and editable only through the ingestion workflow (§5.7) — never hand-edited in the database |

This is what makes §4.3 (current-year-primary, past-years-as-context) and §9 (cross-year lineage) actually implementable rather than just a stated intent: both features read from the same registry as their single source of truth for "what years exist and which one is current."

---

## 6. Search

The platform should feel like Google: instant results for terms like `hospital`, `Abuja`, `solar`, `Kaduna`, `consultancy`, `renovation`, `vehicle`, `education`.

- **Engine:** Meilisearch or Tantivy instead of SQL `LIKE` search.
- **Filters:** Ministry, Agency, Sector, Amount, State, LGA, Year, Flagged/Unflagged (labeled "Evidence Items" in Citizen Mode).
- **Client-side fallback:** a compressed static search index (MiniSearch/FlexSearch) lets search work fully offline in the PWA.

---

## 7. Rule Engine (the core value proposition)

**Principle: don't ask AI to invent corruption — build deterministic, versioned, publicly documented rules.** The rule engine is what makes findings reproducible and legally safe.

### 7.1 Rule schema

Every rule has: `ID`, `Name`, `Description`, `Logic`, `Severity`, `Category`, `Explanation Template`.

```
Rule 12
Name: High Renovation Cost
Trigger: Project contains "Renovation" AND Amount > ₦500M
Severity: Medium
Purpose: Encourage public review of unusually large renovation expenditures.
```

### 7.2 Example rules (deterministic, pseudocode)

```python
IF project contains "Purchase of vehicles" AND amount > ₦500M
THEN flag "High vehicle procurement"

IF description contains "renovation" AND amount > ₦1B
THEN flag "Large renovation expenditure"

IF project contains "training" AND amount > ₦300M
THEN flag "Large training allocation"

IF description contains "empowerment"
THEN flag "Requires implementation verification"

IF same project repeated 10+ times
THEN flag "Possible duplicate allocation"
```

Vehicle-related matching should use a term set (`vehicle`, `SUV`, `bus`, `pickup`) combined with an amount threshold, e.g. `amount > ₦1B`.

### 7.3 Rule categories

| Category | Examples |
|---|---|
| Procurement | Vehicle purchases, furniture, equipment, computers, generators, consultancies |
| Infrastructure | Roads, hospitals, schools, water, power, housing |
| Administrative Spending | Renovation, office maintenance, training, travel, monitoring, refreshments, entertainment |
| Potential Duplication (same year) | Same project appearing multiple times *within one budget*, across different agencies, similar wording |
| Recurring Allocation (cross year) | Same project reappearing across *multiple fiscal years* (see §9) — distinct from same-year duplication; matched via project-lineage resolution, not exact codes |
| Geographic Distribution | Over-concentration, under-representation, regional imbalance |
| Historical Comparison | Increase, decrease, repeated funding, dormant projects |

### 7.4 Transparency scoring (not "corrupt" labeling)

Instead of a binary corruption label, categorize with a lightweight semantic scoring:

```
✔ Infrastructure   ✔ School   ✔ Hospital
⚠ Renovation   ⚠ Consultancy   ⚠ Vehicles   ⚠ Capacity Building
⚠ Furniture   ⚠ Refreshments   ⚠ Miscellaneous   ⚠ Monitoring & Evaluation
```

---

## 8. Duplicate Detection & Similarity

Budgets often repeat near-identical projects under slightly different wording. Use embedding-based clustering (computed once, offline, during ingestion — not client-side):

```
"Provision of Solar Street Lights"
  ≈ "Solar street light installation"
  ≈ "Solar powered street lighting"
```

Clustered and surfaced as:

```
Possible Duplicate Cluster
14 Projects — Total Allocation: ₦12.4B
```

Related feature — **Similar Projects**: clicking a project like "SUV Purchase" shows "15 similar allocations, total ₦18.2B."

---

## 9. Historical Intelligence & Recurring Project Detection

Store every ingested fiscal year (2023–2027+) as its own versioned, immutable dataset. This layer serves two distinct purposes that are worth separating clearly, because they use different logic:

- **9.1 Cross-year comparison** — aggregate, ministry/sector-level trend analysis ("has education funding gone up or down?").
- **9.2 Recurring/reappearing project detection** — instance-level identity resolution ("is *this specific project* the same one that appeared in 2024 and 2025?"). This is the feature you're asking for, and it's genuinely different from same-year duplicate detection (§8), which clusters near-identical projects *within one budget*. Here we're linking a project to **itself across time**.

### 9.1 Cross-year comparison (aggregate trends)

Backed by simple, fast SQL once centralized:

```sql
SELECT ministry, SUM(amount)
FROM projects
WHERE year = 2026
GROUP BY ministry;
```

Enables: same-project funding trend over time, budget growth/decline by sector or ministry, and the "vs last year" deltas described in §4.3.

### 9.2 Why exact matching doesn't work

You can't reliably link a 2026 line item to its 2024/2025 predecessor by `budget_code` alone — codes are frequently reissued, reformatted, or reassigned to a different sub-head between fiscal years, and project titles get re-worded ("Construction of Primary Health Centre, Bida" one year, "PHC Construction — Bida LGA" the next). So project-lineage resolution needs the same tool already in the architecture for duplicate detection: **embeddings + rule-based constraints**, just applied *across* years instead of *within* one.

### 9.3 Project lineage model

Introduce a new entity that sits above individual yearly rows — a **canonical project lineage** that groups the same real-world project across multiple budget years:

```json
{
  "lineage_id": "LIN-000481",
  "canonical_title": "Construction of Primary Health Centre, Bida",
  "agency": "Federal Ministry of Health",
  "state": "Niger",
  "lga": "Bida",
  "instances": [
    { "year": 2024, "project_id": "P-08221", "budget_code": "H2024-3391", "amount": 1200000000, "page": 210 },
    { "year": 2025, "project_id": "P-11094", "budget_code": "H2025-2287", "amount": 1450000000, "page": 305 },
    { "year": 2026, "project_id": "P-14722", "budget_code": "H2026-0965", "amount": 1900000000, "page": 441 }
  ],
  "years_appeared": [2024, 2025, 2026],
  "cumulative_allocation": 4550000000,
  "match_confidence": 0.94
}
```

**Matching pipeline (runs during ingestion of each new year, not at query time):**

```text
New year's projects
        │
        ▼
Generate embeddings for (title + description)
        │
        ▼
Candidate search: prior years' lineages filtered by
  same agency + same state/LGA (± sector) — cheap pre-filter
        │
        ▼
Embedding similarity score against candidates
        │
        ▼
  score ≥ 0.90 ───► Auto-link to existing lineage
  0.75–0.90 ─────► Queue for human/investigator review
  < 0.75 ────────► New lineage created
        │
        ▼
Update lineage record (append instance, recompute cumulative_allocation)
```

The agency + location pre-filter keeps this cheap: you're never comparing a project against the entire historical corpus, only against plausible prior candidates from the same agency and place.

### 9.4 Recurring Allocation as a rule/evidence type

Once lineages exist, "reappearing project" becomes just another deterministic rule feeding the same Evidence Engine described in §7 — no separate subsystem, no special-casing in the UI:

```
Rule: RECURRING_ALLOCATION
IF   lineage.years_appeared.length >= 2
AND  no completion/closeout record exists for the project
THEN generate evidence:
  "Repeated Funding Across Budget Years"
  severity scales with years_appeared.length and cumulative growth
```

Evidence object example:

```json
{
  "id": "EV-2026-009213",
  "rule": "RECURRING_ALLOCATION",
  "lineage_id": "LIN-000481",
  "severity": "medium",
  "confidence": 0.94,
  "reason": "This project has appeared in 3 consecutive budgets (2024–2026) with cumulative allocations of ₦4.55B and no visible completion record.",
  "years_appeared": [2024, 2025, 2026],
  "page": 441,
  "budget_code": "H2026-0965",
  "rule_version": "1.0.0"
}
```

Severity heuristic (deterministic, documented publicly per §15):
- 2 years → low
- 3 consecutive years → medium
- 4+ years, or amount growing each year with no stated reason → high

### 9.5 Surfacing it in the UI

- **Dashboard widget ("Recurring Projects"):** a card alongside Recent Evidence — *"142 projects appear in 3+ consecutive budgets — ₦38.2B cumulative"* — linking to a filtered Evidence Explorer view.
- **Project Detail page:** add a **"Funding History"** block showing every year the lineage appeared, the amount each year, and a small sparkline — this sits next to the existing Historical Funding chart already specified for the project detail page.
- **Investigator Mode:** a dedicated **Recurring Project Explorer** (sibling to the existing Duplicate Detector and Cross-Year Compare tools) listing all lineages sorted by years-appeared or cumulative growth, with bulk export.
- Every recurring-allocation evidence item still follows the platform's core rule (§2.3): it's framed as *"meets repeated-funding review criteria,"* never as *"this project was never completed"* — the platform doesn't have completion data unless it later ingests implementation/audit reports (§16), so the wording stays strictly evidence-based.

#### 9.5.1 Mockup — "Recurring Projects" dashboard widget

```text
┌───────────────────────────────────────────────────────────┐
│ ⟲ Recurring projects                          View all →   │
├───────────────────────────────────────────────────────────┤
│  Projects        3+ years running        Cumulative        │
│    142                  58                  ₦38.2B         │
├───────────────────────────────────────────────────────────┤
│ Construction of Primary Health Centre, Bida     [Medium]    │
│ Federal Ministry of Health                                  │
│ (2024) (2025) (2026)                                        │
│ ₦4.55B cumulative                          View lineage →    │
├───────────────────────────────────────────────────────────┤
│ Solar street lighting installation, Kaduna        [High]    │
│ Rural Electrification Agency                                │
│ (2023) (2024) (2025) (2026)                                  │
│ ₦12.4B cumulative                          View lineage →    │
├───────────────────────────────────────────────────────────┤
│ Capacity building workshop, Enugu                  [Low]    │
│ Ministry of Agriculture                                      │
│ (2025) (2026)                                                │
│ ₦1.1B cumulative                           View lineage →    │
└───────────────────────────────────────────────────────────┘
```

Notes on this layout:
- The three top-line numbers are cheap, precomputed stats (§4.4) — not live queries.
- Year badges give an at-a-glance read of *how long* a project has been reappearing without opening the record.
- Severity tag (`Low` / `Medium` / `High`) comes directly from the deterministic heuristic in §9.4 — never a free-text AI judgment.
- "View lineage →" routes to `GET /projects/{id}/lineage` (§9.6).

#### 9.5.2 Mockup — "Funding History" project-detail block

```text
┌───────────────────────────────────────────────────────────┐
│ ⏱ Funding history                          [Medium severity]│
│ Appeared in 3 consecutive budgets · confidence 94%           │
├───────────────────────────────────────────────────────────┤
│ 2024  ██████████████░░░░░░░░  ₦1.20B                        │
│ 2025  █████████████████░░░░░  ₦1.45B                        │
│ 2026  ████████████████████████ ₦1.90B                       │
├───────────────────────────────────────────────────────────┤
│ 2024 · Budget code H2024-3391       Page 210 — view source   │
│ 2025 · Budget code H2025-2287       Page 305 — view source   │
│ 2026 · Budget code H2026-0965       Page 441 — view source   │
├───────────────────────────────────────────────────────────┤
│ Cumulative allocation ₦4.55B across 2024–2026. This meets    │
│ the platform's repeated-funding review criteria — it is not  │
│ evidence of wrongdoing.                                       │
└───────────────────────────────────────────────────────────┘
```

Notes on this layout:
- Bar length is proportional to that year's allocation relative to the largest year in the lineage — a quick visual read on whether funding is growing, flat, or shrinking year over year.
- Every year row keeps its own budget code and page citation — the "view source" promise (§2.1) holds at the per-year level, not just at the project level.
- The closing sentence is the fixed, neutral explanation template (§10.1/§2.3) — it never varies based on severity, only the badge does.

### 9.6 New API surface

```
GET /projects/{id}/lineage        → full cross-year history for one project
GET /recurring?min_years=2        → all lineages appearing in 2+ years
GET /recurring?min_years=3&sort=cumulative_desc
```

---

## 10. AI / LLM Layer

### 10.1 What the LLM is — and is not — responsible for

**The LLM never classifies corruption and is never part of the critical path.** The website must be 95–99% fully functional (search, filters, evidence, charts, maps, PDF viewing) with zero AI. The model's only job is turning already-computed, structured evidence into plain, citizen-friendly language.

LLM responsibilities:
- Explanation of a flagged item in plain English
- Summarization (e.g. of a ministry's profile)
- Comparison narration ("compare these two projects")
- Conversational Q&A over retrieved evidence (RAG)

Explicitly **not** LLM responsibilities:
- Deciding whether something is wrongdoing
- Generating flags/rules itself
- Answering from its own memory instead of retrieved records

Example transformation:

```json
Input:  {"project": "Office Renovation", "amount": "₦2.8B",
          "rules": ["High Renovation Cost", "Above Historical Average"],
          "comparables": 14}

Output: "This project was highlighted because its renovation allocation
is substantially higher than similar projects in the current and
previous budgets. This is not evidence of wrongdoing, but it meets the
platform's published review criteria."
```

### 10.2 Retrieval-Augmented Analysis (RAG)

Treat the budget as a knowledge base, not a single document to summarize blindly:

```text
Official Budget PDF → Extract tables + text → Chunk into sections
   ├──► Full-text search (Meilisearch)
   └──► Local embeddings → Vector DB (SQLite-Vec / LanceDB)
              → Retrieve relevant projects + historical context
              → Tiny local LLM generates explanation
```

This lets users ask natural questions such as:
- "Show all borehole projects above ₦500 million."
- "Which ministries spend the most on consultancy?"
- "Are there similar projects in different states?"
- "How does this allocation compare with 2025?"

Every AI answer must include citations (page numbers, budget codes) — the model answers from retrieved records, never from its own training data, which keeps it grounded and auditable.

### 10.3 Where inference runs: server intelligence vs. client intelligence

| Server-side (once, at ingestion) | Client-side (on demand, conversational) |
|---|---|
| Duplicate detection / clustering | "Explain this allocation" |
| Embedding generation | "Summarize this ministry" |
| Historical comparisons | "Compare these projects" |
| Rule matching | "Why was this flagged?" |
| Statistics precomputation | Free-form chat |

### 10.4 Local LLM strategy (progressive enhancement, not a hard dependency)

**The model is never shipped with the website.** It is downloaded once on first use (client fetches weights from a model repo such as Hugging Face, e.g. a Gemma 3 1B GGUF/MLC build), cached in IndexedDB/Cache Storage, and reused thereafter via WebGPU/CPU inference (WebLLM, ONNX Runtime Web, Transformers.js).

**Recommended model shortlist:**

| Model | RAM | Good for |
|---|---|---|
| Gemma 3 1B | ~1–2 GB | Best balance |
| Qwen 2.5 1.5B Instruct | ~2 GB | Excellent reasoning |
| SmolLM2 1.7B | ~1.5 GB | Very fast |
| Phi-3 Mini | ~3 GB | Strong explanations |

**UX pattern — AI is opt-in, not blocking:**

```
Website loads → Search / Filters / Evidence all work immediately
        │
        ▼
"Enable AI Assistant" (user opt-in)
        │
        ▼
Download ~780 MB once → cached forever → instant on future visits
```

**Progressive enhancement by device capability:**

```
Low-RAM phone   → Evidence Engine only, no AI
Laptop          → Gemma 3 1B
Powerful desktop → Gemma 4B (or larger, if supported)
```

Each device caches the model independently (same pattern as Spotify caching songs per-device) — this is expected and fine.

Decision flow:

```
PWA (search/rules/charts already work)
        │
   Browser supports WebGPU/AI?
      No ──────────► Evidence-only experience
      Yes
        │
   Model already cached?
      No ──► Download once ──► Cache locally
      Yes ─► Load from cache (≈2s)
```

---

## 11. API Design

```
GET /projects                  (?year= optional, defaults to active_year)
GET /projects/{id}
GET /projects/{id}/lineage      (cross-year history, §9.6)
GET /agencies
GET /agencies/{id}
GET /rules
GET /evidence            (filterable: ?rule=, ?agency=, ?state=, ?severity=, ?year=)
GET /search?q=&limit=&year=
GET /compare?years=2025,2026
GET /recurring?min_years=2      (§9.6)
GET /years                       (returns the Dataset Registry, §5.6)
GET /duplicates
GET /statistics?year=
POST /chat                (RAG-backed AI assistant)

Admin (authenticated only):
POST /admin/ingest         { file, year, set_active }   → triggers §5.7 workflow
GET  /admin/registry        full ingestion/reconciliation status per year
```

Design rules: paginate everything, return thin objects in list views, fetch full detail objects only per-record, prefer serving precomputed static JSON wherever the data doesn't change per-request, and treat `year` as an explicit query parameter everywhere rather than an implicit assumption (§5.8).

---

## 12. Technology Stack

**Frontend**
Next.js · TypeScript · React · TailwindCSS · PWA (Service Workers + IndexedDB) · PDF.js · TanStack Query · Zustand · MapLibre (interactive Nigeria map) · Chart.js/Recharts (trend, doughnut, heatmap visuals)

**Backend**
Node.js · NestJS · PostgreSQL (Neon or Supabase) · Redis · Meilisearch (or Tantivy) · SQLite-Vec or LanceDB (vector search) · BullMQ (background jobs)

**Ingestion / extraction (Python service, invoked by the pipeline in §5)**
pdfplumber / PyMuPDF (text extraction) · Camelot / Tabula (table extraction) · pdf2image + Tesseract OCR (scanned-page fallback) · a small CLI (`budgetlens ingest`, §5.7) wrapping the whole pipeline

**AI (client-side, optional)**
WebLLM · ONNX Runtime Web · Transformers.js · Gemma 3 1B / Qwen2.5 1.5B / SmolLM2 (quantized, browser-cached)

**Civic Impact Layer (§18)**
WhatsApp Business Cloud API (bot) · Twilio / Africa's Talking (SMS + USSD gateway) · `next-intl` / `react-i18next` (Hausa, Yoruba, Igbo, Pidgin localization) · `satori` + `sharp` (server-side shareable evidence-card image generation) · scheduled job (BullMQ cron) for the Civic Digest

**Static publishing / delivery**
Cloudflare CDN, Cloudflare R2, GitHub Pages, or Vercel static assets for versioned JSON datasets (`projects.min.json`, `search-index.json`, `agencies.json`, `statistics.json`, `evidence.json`)

**End-to-end pipeline summary**
```
Next.js → PWA → PDF.js → Node extraction → SQLite/Postgres → Meilisearch
→ Rule Engine → WebLLM → Tailwind → MapLibre → Chart.js
```

---

## 13. Offline Capability

The PWA caches, so citizens can search and review evidence with no connectivity:
- Search index
- Recently viewed projects
- Bookmarked evidence
- Downloaded PDF pages
- The AI model (if enabled)
- Rule definitions

---

## 14. Security & Data Integrity

- No editing of government-sourced data; all budget records are immutable once ingested.
- Every imported document carries a SHA-256 hash, upload date, source URL, and version history.
- Row-Level Security (if using Supabase) separates user data (bookmarks, saved searches, private investigations) from public evidence data.
- Admin ingestion and rule management are gated behind authenticated, audited workflows — never exposed to the public write path.

---

## 15. Trust & Governance

To sustain credibility, the platform publishes its own methodology:
- All analytical rules and their version history
- Threshold definitions
- Data extraction methodology
- Known limitations
- Change logs
- Source document archive

Any citizen should be able to inspect *why* an item was flagged, reproduce the analysis independently, and propose improvements to the rules — governance-by-transparency is itself a trust feature, not an afterthought.

---

## 16. Future Integrations

The architecture is designed to extend beyond a single budget document into cross-document verification:
- Budget implementation reports
- Procurement awards
- Auditor-General reports
- Debt reports
- Treasury releases
- Open Contracting Data Standard (OCDS) feeds
- National Bureau of Statistics datasets
- Procurement portals
- Freedom of Information (FOI) responses

---

## 17. Long-Term Vision

BudgetLens should mature from a budget search tool into a comprehensive public-accountability platform: any citizen asks a plain-language question, retrieves evidence from official records, understands how public funds are allocated over time, compares agencies, identifies unusual spending patterns using transparent rules, and navigates directly back to source documents — with AI acting only as an interpreter of evidence, never as the source of truth.

**The goal:** reduce the effort required to scrutinize public spending from *weeks of manual document review* to *seconds of searchable, explainable, verifiable analysis* — without sacrificing neutrality, transparency, or public trust.

---

## 18. Civic Impact Layer: From Evidence to Democratic Action

Everything built so far (§1–17) makes budget data **findable, explainable, and verifiable**. That's necessary, but on its own it mostly serves people who already have a laptop, stable data, English fluency, and the motivation to go looking. If the mission is to *awaken democratic consciousness* — not just serve existing civic-tech users — the platform needs a layer that turns evidence into reach, action, and sustained attention. This section adds that layer without compromising §2's core discipline: everything here still separates **verified evidence** from **citizen-submitted, unverified reports**, and never lets reach or engagement mechanics erode neutrality.

### 18.1 The Action Loop: don't let evidence dead-end

An evidence item that ends at "here's the source page" risks producing resignation instead of engagement. Three additions close the loop:

**Contact-Representative Bridge**
Every project/ministry links to the National Assembly member(s) with oversight responsibility (Senate/House committee mapped to that ministry, plus the constituency member for a project's state/LGA). Surfaces name, official contact channel, and a pre-filled (editable) message referencing the specific evidence item and its citation — so a citizen can act in under a minute instead of needing to know how NASS oversight works.

```
GET /projects/{id}/representatives
GET /evidence/{id}/representatives
```

**Public Hearing / Budget Defense Calendar**
Ministerial budget defense sessions before National Assembly committees are public. A simple calendar (`GET /hearings?ministry=`, `GET /hearings?upcoming=true`) surfaces when a given ministry's budget is actually being discussed, so awareness has a concrete moment to act on rather than just abstract knowledge.

**Citizen Tip Channel — structurally separate from Evidence**
A "Report something about this project" action lets citizens submit ground-truth observations ("this listed clinic was never built," "this road is not there"). This is stored as a **distinct entity type**, never merged into the Evidence Object model from §5.4:

```json
{
  "id": "TIP-2026-00231",
  "project_id": "P-14722",
  "type": "citizen_report",
  "status": "unverified",
  "submitted_at": "2026-03-02T11:00:00Z",
  "anonymous": true,
  "text": "..."
}
```

Displayed visually distinct from rule-based evidence (different card style, explicit "Unverified citizen report" label) — this preserves the "evidence not accusation" credibility that the whole platform depends on, while still giving ground-truth reports somewhere to go. Tips can optionally feed a moderation queue that promotes a pattern of tips into an investigator's manual research note, but never auto-promotes into Evidence.

### 18.2 Reach Beyond the Web: WhatsApp, SMS & USSD

The current design (PWA, WebGPU-optional local LLM, offline caching) still assumes a smartphone, a browser, and enough data to load the app at least once. For most of the intended audience in Nigeria, the highest-reach channel isn't the website at all.

```text
                     Same backend (§4), one new entry surface
                                    │
        ┌───────────────┬──────────┴──────────┬───────────────┐
        ▼               ▼                      ▼               ▼
   Web PWA        WhatsApp Bot            SMS Gateway        USSD Menu
  (existing)    (WhatsApp Business    (Twilio/Africa's      (feature-phone,
                 Cloud API)             Talking, etc.)        zero-data)
        │               │                      │               │
        └───────────────┴──────────┬───────────┴───────────────┘
                                    ▼
                     Same API (§11) — /search, /evidence, /statistics
```

- **WhatsApp bot** — dominant channel in Nigeria; supports a simple conversational flow ("send your LGA," "type a ministry name") against the same `/search` and `/statistics?year=` endpoints already specified. No new backend logic — just a new adapter.
- **SMS/USSD gateway** — for feature phones and no/low-data users. A constrained query set (e.g. reply `1` for your state's total allocation, `2` for a specific ministry) rather than free text, since SMS/USSD have no rich UI.
- **Data-saver web mode** — a stripped, text-only rendering path (already partially implied by the "works with zero AI" principle in §10.1; extend the same philosophy to "works with near-zero data").
- **Auto-generated printable flyers** — a one-page, per-LGA PDF ("Your LGA's 2026 Budget") generated from the same static dataset (§4.1), designed for physical distribution at town halls, churches, mosques, markets — reaching people the web/app funnel structurally cannot.

### 18.3 Multi-Jurisdiction Scope: State & LGA Budgets

The design so far is federal-only. But the spending citizens feel daily — primary healthcare, primary/secondary schools, local roads, water — is overwhelmingly **state and LGA** spending, not federal. Restricting the platform to the federal appropriation bill caps its relevance for most people's lived experience. The good news: the architecture built in §4–§9 (Dataset Registry, extraction pipeline, rule engine, lineage resolution) already generalizes to this — it just needs `jurisdiction` added as an explicit dimension now, rather than retrofitted later.

**Schema extension (Budget Record, §5.3):**
```json
{
  "financial_year": 2026,
  "jurisdiction_level": "state",
  "jurisdiction_name": "Kaduna",
  "agency": "...",
  "...": "..."
}
```

**Dataset Registry extension (§5.6):** the registry becomes keyed by `(jurisdiction, financial_year)` instead of just `financial_year` — each state (and eventually LGA) runs its own ingestion, its own extraction profile (state budgets are formatted even less consistently than the federal one), and its own active/archived status, independent of every other jurisdiction.

**Phased rollout** (this is a scope/resourcing reality, not an architecture limitation): Federal (existing) → a handful of pilot states with the most accessible/machine-readable budget publications → remaining states → LGA level where source documents exist at all. The extraction pipeline (§5.1–§5.2) was already designed to tolerate per-year format drift; the same fuzzy-header-matching and reconciliation approach is what makes 36+ independently-formatted state budgets tractable rather than 36 bespoke parsers.

**UI impact:** the year switcher described in §5.8 becomes a **jurisdiction + year switcher** ("Federal · 2026" / "Kaduna State · 2026"), and a citizen's default view can be set to their own state/LGA — directly relevant local spending, not just the abstract federal total.

### 18.4 Translating Numbers into Lived Terms

₦2.8B is hard to feel. Alongside the raw amount, evidence items and project cards can show a **relatable-equivalent conversion** — e.g. "≈ 1,400 average annual primary-school-teacher salaries" or "≈ 56 boreholes at typical cost." This must follow the exact same evidence discipline as the rule engine (§2, §7) or it becomes a new, unverifiable claim:

- Conversion baselines (average teacher salary, average borehole cost, average classroom-block cost, etc.) are sourced from cited, dated public references — not estimated by the AI layer.
- The conversion methodology is published and versioned, same as rule definitions (§15) — a citizen can see exactly which baseline number was used and where it came from.
- Displayed as a soft supplementary line ("≈ 1,400 teacher salaries"), never replacing the actual amount, and never used inside the deterministic rule engine itself — it's a comprehension aid, not an evidentiary input.

### 18.5 Language & Literacy Access

The explanation layer (§10) currently only outputs English. Given the audience:

- **Localized UI and explanation templates** in Hausa, Yoruba, Igbo, and Nigerian Pidgin, alongside English. Because §10.1 already keeps LLM output template-based ("This project was highlighted because...") rather than free-generated, localization stays low-risk — translate and version the templates, don't ask a model to freely explain evidence in four languages with four different chances to drift off the neutral framing.
- **A plain-language glossary** ("What is a budget line," "capital vs. recurrent expenditure," "what does MDA mean") linked contextually wherever those terms appear — budget literacy is itself an access barrier the platform can lower.
- WhatsApp/SMS bots (§18.2) support the same language set, since that's where reach is highest among exactly the audience least served by an English-only web app.

### 18.6 Shareable, Verifiable Evidence Cards

Information spreads in Nigeria primarily by being forwarded on WhatsApp — usually as a screenshot, which strips away sourcing and is trivially misquoted or altered. Counter this by making the *correct* way to share also the *easy* way to share: auto-generate a branded image card per evidence item (project name, amount, rule matched, severity, page citation, and a QR code linking back to `budgetlens.ng/evidence/EV-xxxx`). Built server-side at publish time (e.g. via `satori`/`sharp`) alongside the rest of the ingestion pipeline (§5), so every evidence item already has a shareable, source-linked artifact the moment it's created — virality stays tethered to verifiability instead of degrading into an untraceable screenshot.

### 18.7 Right of Reply

For a platform whose entire credibility rests on "evidence, not accusation" (§2.3), it should be structurally one-directional only until this is added. A **Response** object attaches to any Evidence Item, allowing a verified agency account (or, with clear labeling, a general public comment) to add context or clarification, displayed directly alongside the evidence — not hidden, not moderated away, just labeled by source:

```json
{
  "id": "RESP-2026-00042",
  "evidence_id": "EV-2026-004812",
  "author_type": "agency_verified",
  "author": "Federal Ministry of Works — Press Office",
  "text": "...",
  "submitted_at": "2026-02-01T10:00:00Z"
}
```

This is both a trust feature (demonstrates the platform isn't one-directional) and a practical safeguard against the platform becoming a target of "it's biased against us" delegitimization — the mechanism for reply already exists, in public, attached to the exact evidence in question.

### 18.8 Sustained Engagement: Civic Digest

Bookmarks and saved searches (§3) are passive — they only benefit people who already came looking. A periodic **Civic Digest** ("What changed in Kaduna State's budget this week," "3 new evidence items in your saved searches") pushed via email, SMS, or WhatsApp turns awareness from a one-time visit into an ongoing habit, using the exact same underlying data (nightly-computed statistics, §4.4) that already powers the dashboard — no new analytical logic, just a scheduled digest job and a subscription/delivery-channel preference per user.

### 18.9 New API surface (Civic Impact Layer)

```
GET  /projects/{id}/representatives
GET  /evidence/{id}/representatives
GET  /hearings?ministry=&upcoming=true
POST /tips                              (citizen_report, §18.1)
GET  /jurisdictions                     (federal, state, LGA registry, §18.3)
GET  /evidence/{id}/responses           (right of reply, §18.7)
POST /evidence/{id}/responses           (agency-verified only)
POST /digest/subscribe                  (§18.8)
GET  /evidence/{id}/card.png            (shareable image, §18.6)
```

---

## 19. Suggested Next Steps (Engineering Handoff)

This specification is a strong product/architecture foundation. To hand this directly to an engineering team, expand it into a full **Software Requirements Specification (SRS)** covering:

- Database ER diagrams
- Sequence diagrams for the ingestion pipeline and the RAG chat flow
- C4 architecture diagrams (context, container, component, code)
- A formal rule-engine DSL (so non-engineers can author/version rules safely)
- API contracts (OpenAPI 3.x)
- Deployment architecture (Docker/Kubernetes, or serverless equivalent)
- CI/CD workflows for ingestion pipeline + frontend deploys
- Observability (logging, tracing, alerting on ingestion failures)
- An AI governance framework (model versioning, prompt/response auditing, rollback plan if a model is deprecated)

---

## Appendix A — Design Language Cheat Sheet

| Say this ✅ | Not this ❌ |
|---|---|
| Evidence Items | Flagged / Flags |
| "Matches transparency review criteria" | "This is corruption" |
| Evidence Feed | Top Flagged Projects |
| Confidence: 82% | (unqualified accusation) |
| View Source / View Methodology | (unsourced claim) |

**Product identity in one line:** *Google (search-first) meets Bloomberg (clean financial visualization) meets GitHub (provenance, versioning, evidence links).*