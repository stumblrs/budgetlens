# BudgetLens Phase 8 — Cloudflare Free-Tier Separation & Migration Plan

> **Document Status:** `P8-CP-4 COMPLETED`  
> **Created:** `2026-11-25`  
> **Target Runtime:** 100% Cloudflare Free Tier (`\$0` · No credit card required; R2 deferred until permanent account)  
> **Predecessor:** [PHASE8_BACKEND_HANDOFF_SPECIFICATION.md](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/PHASE8_BACKEND_HANDOFF_SPECIFICATION.md)

---

## 1. Core Architectural Rule: `UI = UI`, `Backend = Backend`

- **Frontend (Pure UI via Workers Static Assets):** Serves only the built Vite React SPA (`dist/` < 5 MB) plus static image assets (`public/governors/`, `public/presidents/`). **Zero `public/datasets/` JSON files**, zero in-browser SQLite/JSON scans, and zero eager multi-megabyte downloads.
- **Backend (Pure API via Cloudflare Worker + Hono):** Runs `/api/v1/*` routes using **Workers Cache** and **Workers Logs + Traces**, returning fast paginated slices (`< 50 KB` per view) so phones never freeze.
- **Databases (3 Free-Tier Cloudflare D1 Stores — all under the `500 MB`/DB free cap):**
  1. `budgetlens-budgets` (`DB_BUDGETS`, `~225 MB`): `559,325` budget records + `budget_fts` (`1999–2026`).
  2. `budgetlens-ledgers` (`DB_LEDGERS`, `~347 MB`): `98,866` NOCOPO contracts, `467,763` Open Treasury vouchers, `20,465` OAuGF chunks, `3,214` policy chunks, `1,247` BIR OCR chunks + FTS5 tables.
  3. `budgetlens-app` (`DB_APP`, `< 25 MB`): Compact precomputed summaries (`debt_profile`, MDA scorecards, red-flag convergence, Bill-vs-Act diffs, coverage metadata) plus mutable `citizen_tips` & `casebooks`.

---

## 2. Phase 8 Checkpoints (`P8-CP-1` → `P8-CP-5`)

| Checkpoint | Scope | Key Modules | Verification Gate | Status |
|---|---|---|---|---|
| **`P8-CP-1`** | Cloudflare `cf` CLI setup, GitHub `.gitignore` hardening, Worker + Hono `/api/v1/*` skeleton, `cloudflare.config.ts` | `worker/index.ts`, `cloudflare.config.ts`, `.env.example` | `tsc -p worker/tsconfig.json --noEmit`, `tsc -b`, `vitest run tests/unit/workerHealth.test.ts` | `COMPLETED` |
| **`P8-CP-2`** | Create D1 SQL migrations & idempotent local seed script from `backend/data/*.sqlite` + Phase 7 summaries | `worker/migrations/`, `scripts/seed_cloudflare_d1.py` | Local D1 migration + exact row-count parity assertions | `COMPLETED` |
| **`P8-CP-3`** | Implement paginated `/api/v1/*` endpoints (`years`, `projects`, `search`, `mdas`, `forensics`, `debt`, `cbn`, `ai`, `tips`, `casebooks`) | `worker/routes/*` | API contract & FTS5 query latency unit/integration tests | `COMPLETED` |
| **`P8-CP-4`** | Refactor UI to pure thin API calls, relocate `public/datasets/` to local `data_archive/` so `vite build` ships `< 5 MB` | `src/services/*`, UI explorers, `package.json` | `npm run build` `< 5 MB` assets + mobile Playwright `360px`/`390px` | `COMPLETED` |
| **`P8-CP-5`** | Live Free-Tier `cf deploy`, 4-viewport Playwright E2E, & `CLOUDFLARE_MIGRATION_RUNBOOK.md` | `cloudflare.config.ts`, E2E suite | Live `*.workers.dev` smoke + account migration dry run | `PLANNED` |

---

## 3. GitHub Repository Hygiene (`https://github.com/stumblrs/budgetlens`)

- **Committed:** Frontend UI (`src/`, `public/governors/`, `public/presidents/`), Python ingestion/backend code (`ingestion/`, `backend/`), Cloudflare Worker & D1 migrations (`worker/`, `cloudflare.config.ts`), unit/E2E tests (`tests/`), and roadmaps.
- **Excluded (`.gitignore`):** `public/datasets/` (`1.07 GB` incl. `115.72 MB` `ai_knowledge_base.json` exceeding GitHub's `100 MB` file cap), `data_archive/`, `backend/data/*.sqlite`, `ingestion/gemma-*.gguf`, `ingestion/checkpoints_data/`, `ingestion/ocr_cache/`, raw PDF directories, and `.env` / `.dev.vars` secrets.

---

## 4. Permanent Cloudflare Account Migration Checklist (After Testing Satisfied)

1. Connect the **same GitHub repository** (`stumblrs/budgetlens`) or run `cf auth login --force` with the permanent Cloudflare account.
2. Create the 3 D1 databases (`budgetlens-budgets`, `budgetlens-ledgers`, `budgetlens-app`) in the permanent account and populate `.env` / CI variables (never hardcoding IDs into committed code).
3. Run the `P8-CP-2` D1 migrations + repeatable local seed script (`scripts/seed_cloudflare_d1.py`) to populate all 559k+ records.
4. Run `cf deploy` and verify `/api/v1/health` + 4-viewport Playwright checks.
