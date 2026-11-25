# BudgetLens — Outstanding Work & Known Gaps

> **Status as of 2026-11-20:** All 10 checkpoints in `PHASE2_IMPLEMENTATION_ROADMAP.md` are marked `COMPLETED`. The AI Assistant upgrade (Duplicate Hunter, Similar Items, multi-dataset feeds) is done. Last full run: `pytest` 19/19, `vitest` 48/48, `tsc -b` exit 0, `npm run build` exit 0, static audits OK, Playwright 3/3.
>
> This file lists what is still left: gaps, risks, and follow-ups found during the work. Nothing below is blocking the current build, but the **P0** items affect correctness or whether you can deploy.

---

## P0 — Correctness & Deployability

| # | Item | Why it matters | Where |
|---|---|---|---|
| 1 | ~~**Fix the wrong ingestion commands in the README.**~~ *(Fixed 2026-11-20: updated to `ingestion.indexers.*` and `ingestion.parsers.*`.)* | — | `README.md` |
| 2 | ~~**Stop the MP letter from naming a guessed constituency.**~~ *(Fixed 2026-11-20: `ccRepLine` now uses the matched constituency only when `matchedBy === 'lga_or_hint'`.)* | — | `src/components/ProjectEvidenceModal.tsx` |
| 3 | **Check the constituency directory against official INEC lists.** The 109/360 names and groupings were compiled by hand because `nigeria_lga_summary.json` didn't exist, and no official source has been checked. The counts pass the tests, but individual names and LGA groupings might not. | Public advocacy letters need accurate names. | `src/data/constituenciesDirectory.ts` |
| 4 | **Set up the repository so CI can run.** The project folder **is not a git repository** and has **no `.gitignore`**. `.github/workflows/ci.yml` has never run. Also, `backend/data/budgetlens_fts.sqlite` (≈225 MB) is over GitHub's 100 MB per-file limit. | Without this, CI can't run and the first push will fail. | Repo root |
| 5 | **Make CI pass without the large local files.** `test_live_fts_database_exists_and_queries_fast` needs the 225 MB SQLite file to exist. In CI, either build it first (`python -m ingestion.indexers.fts_builder`), fetch it as an artifact, or skip the test when the file is missing. | Otherwise the CI backend job fails. | `tests/python/test_search_ai.py`, `ci.yml` |
| 6 | **Replace the production security defaults.** `BUDGETLENS_ADMIN_KEY` defaults to `dev-admin-key-change-me`, `BUDGETLENS_IP_SALT` has a hard-coded default, and CORS is `allow_origins=["*"]`. | Anyone could moderate tips if this is deployed unchanged. | `backend/routers/tips.py`, `backend/main.py` |

---

## P1 — Data Coverage

| # | Item | Current state | Where |
|---|---|---|---|
| 7 | **Real procurement data (NOCOPO / BPP / CAC).** The connector exists, but `procurement_links.json` is `AWAITING_PROCUREMENT_DROP`. Real OCDS/CAC files need to go into `procurement_data/`. | No live contractor links yet | `ingestion/parsers/nocopo_connector.py` |
| 8 | **More execution years.** BIR release data covers FY **2016** and **2023** only. Add more Budget Office / OAGF reports to `bir_pdfs/<year>/`. | 2 of 28 years | `ingestion/parsers/bir_parser.py`, `public/datasets/execution_tracker.json` |
| 9 | **Summary-only and partial years.** The coverage tiers in `statistical_forensics_1999_2026.json` show `SUMMARY_ACT_ONLY` for **2000–2003, 2005, 2007** and `PARTIAL_SCHEDULE` for **2006, 2011, 2015**. These years need fuller schedule PDFs or OCR recovery. | Weaker line-item analysis for those years | `source_pdfs/`, ingestion |
| 10 | **Bill-vs-Act gaps.** `bill_act_diffs/index.json` has 7 cycles. **2017, 2020, 2023** are `SUMMARY_LEVEL_ONLY` (Bill and Act aren't at the same level of detail). **2018 and 2024** are not in the diff index at all. | Padding analysis is only reliable for 2019, 2021, 2022, 2025 | `ingestion/indexers/bill_act_diff_builder.py` |
| 11 | **Resume Gemma Stage-2 enrichment.** About 1,125 records have AI overlays. The background enrichment task (`task-540`) has been stopped since an earlier host restart, and every background task was stopped again by today's server restart. Restart with `python -m ingestion.cli --overnight --resume-only` (or `--stage2 --overnight`). | A tiny fraction of the ~559k rows is enriched | `ingestion/cli.py` |

---

## P1 — AI Assistant Follow-ups

| # | Item | Notes |
|---|---|---|
| 12 | ~~**Offline mode can't see the whole corpus.**~~ *(Fixed 2026-11-20: AI Assistant now shows a clear offline-scope notice when FastAPI is not running locally.)* | `src/components/GroundedAiAssistantWidget.tsx` |
| 13 | **Answers are template-based, not LLM-written.** Responses are built from deterministic templates plus the grounding check. No language model writes prose. If you want generated answers, add an LLM step that still goes through `verify_grounded_response()`. | `backend/routers/ai.py` |
| 14 | ~~**Tune duplicate and similarity scoring on real data.**~~ *(Fixed 2026-11-20: fixed `PROJECT_ROOT` in `backend/routers/search.py` (`parents[2]`) and verified live 559,325-row FTS5 queries for duplicates, `ERGP12234171` similarity, and `/api/health`.)* | `backend/routers/search.py`, `backend/routers/ai.py` |
| 15 | ~~**Add the AI Assistant upgrade to the docs.**~~ *(Fixed 2026-11-20: `README.md` updated with Duplicate Hunter, Similar Items, and `? Guide`.)* | `README.md` |

---

## P2 — Test & QA Gaps

| # | Item | Notes |
|---|---|---|
| 16 | ~~**The E2E download test can pass without testing anything.**~~ *(Fixed 2026-11-20: `observatory.spec.ts` now pins a padding item, opens Casebook Studio, and asserts both `.pdf` and `.docx` downloads unconditionally.)* | `tests/e2e/observatory.spec.ts` |
| 17 | **The E2E error filter hides backend failures.** Console errors mentioning `127.0.0.1:8000`, `Failed to fetch`, and `ERR_CONNECTION_REFUSED` are ignored. Add a second E2E run with the backend up. | `tests/e2e/observatory.spec.ts` |
| 18 | ~~**No browser test for the AI Assistant.**~~ *(Fixed 2026-11-20: `observatory.spec.ts` now drives Duplicate Hunter in `?tab=ai` and asserts results render.)* | `tests/e2e/observatory.spec.ts` |
| 19 | **Python version mismatch.** Local tests run on Python **3.14** (`.venv`), but CI uses **3.11**. CI has never run, so it's unknown whether tests pass there. | `ci.yml` |

---

## P3 — Maintenance & Hygiene

| # | Item | Notes |
|---|---|---|
| 20 | **`npm audit` reports 6 vulnerabilities** (1 moderate, 3 high, 2 critical) as of the `@playwright/test` install. Check them and upgrade where safe. | `package.json` |
| 21 | **npm allow-scripts warnings.** The `core-js` and `esbuild` install scripts aren't approved (`npm approve-scripts`). | — |
| 22 | **Pillow deprecation.** `Image.getdata()` will be removed in Pillow 14 (2027-10-15). Switch to `get_flattened_data()`. | `backend/routers/tips.py:107` |
| 23 | **Starlette TestClient deprecation.** The warning says to install `httpx2`. | Test deps |
| 24 | **Unused dependency.** `slowapi` is in `backend/requirements.txt` but isn't used; rate limiting is hand-written in `backend/db.py`. Either use it or remove it. | `backend/requirements.txt` |
| 25 | **Bundle size warning.** `vendor-pdf` is 626.67 kB, over Vite's 600 kB warning limit. Lazy-load `jspdf` only when exporting. | `vite.config.ts` |
| 26 | **Citizen tips are SQLite-only.** The roadmap mentioned PostgreSQL compatibility, but only SQLite (WAL) is implemented, and photos are saved to local disk. Multi-instance hosting would need Postgres plus object storage. | `backend/db.py`, `backend/routers/tips.py` |

---

## Suggested Order

1. P0 #1–#2 (quick code/doc fixes) → #4–#6 (repo, CI, secrets)
2. P0 #3 (INEC check) and P1 #15 (docs)
3. P2 #16–#18 (make E2E actually test downloads, pinning and the AI Assistant)
4. P1 data items (#7–#11) as source files become available
5. P3 maintenance
