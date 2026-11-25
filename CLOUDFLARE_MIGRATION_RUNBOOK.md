# BudgetLens — Cloudflare Free-Tier Migration & Deployment Runbook

> **Target Architecture:** `UI = UI` (`dist/` `< 5 MB`), `Backend = Backend` (Cloudflare Worker + Hono `/api/v1/*` + 3 Free-Tier D1 SQLite databases).
> **Cost:** `\$0` on Cloudflare Workers & D1 Free Tier (no R2 or paid plan required).

---

## 1. Prerequisites on Any New / Permanent Cloudflare Account

1. **Authenticate `cf` CLI**
   ```bash
   npx cf auth login --force
   ```
2. **Register a `*.workers.dev` subdomain (one-time per account)**
   - In the Cloudflare Dashboard → **Workers & Pages** → **Overview** (onboarding), choose your `*.workers.dev` subdomain.
3. **Provision the 3 Free-Tier D1 Databases**
   ```bash
   npx cf d1 create budgetlens-budgets
   npx cf d1 create budgetlens-ledgers
   npx cf d1 create budgetlens-app
   ```
4. **Configure Local `.env` (never commit `.env` or UUIDs)**
   Copy `.env.example` → `.env` and fill in `D1_BUDGETS_ID`, `D1_LEDGERS_ID`, and `D1_APP_ID`.

---

## 2. Schema Migration & Bulk D1 Seeding

1. **Apply Schemas & Compact App Datasets Remotely**
   ```bash
   python scripts/seed_cloudflare_d1.py --remote-init
   ```
   This applies [worker/migrations/0001_init.sql](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/worker/migrations/0001_init.sql) and [worker/migrations/0002_tip_photos.sql](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/worker/migrations/0002_tip_photos.sql), seeds `year_statistics`, and uploads all `app_datasets` + `bill_act_diffs` into `budgetlens-app`.

2. **Export & Bulk-Import Budget Schedules (`1999–2026`) via `cf d1 import`**
   ```bash
   python scripts/seed_cloudflare_d1.py --export-sql
   ```
   This writes transaction-free `budgets_<year>.sql` files to `scratch/d1_sql_export/`. Import each file into `D1_BUDGETS_ID` using `cf d1 import <D1_BUDGETS_ID> --action init|ingest|poll` (splitting large years into ~15 MB chunks if `D1_RESET_DO` occurs).

3. **Local Development & Preview Parity**
   ```bash
   python scripts/seed_cloudflare_d1.py --local
   npm run cf:build
   node scripts/preview_local_worker.mjs
   ```

---

## 3. Build, Verify & Deploy

1. **Typechecks, Bundle Size (`< 5 MB`), & Tests**
   ```bash
   npx tsc -b
   npm run worker:typecheck
   npm run build:ui
   npm run cf:build
   npx vitest run --maxWorkers=2
   npx playwright test
   ```
2. **Deploy Worker + Static Assets to `*.workers.dev`**
   ```bash
   npx cf deploy --prebuilt --mode production
   ```
3. **Optional Separate UI Deployment (Vercel / Cloudflare Pages)**
   - Set `VITE_API_BASE_URL=https://<your-worker>.workers.dev` and deploy `npm run build:ui` (`dist/` `< 5 MB`).

---

## 4. Live Verification Smoke Checklist

- `GET https://<your-worker>.workers.dev/api/v1/health?deep=1` → `200`, `ok: true`, `bindings: { budgets: true, ledgers: true, app: true }`
- `GET https://<your-worker>.workers.dev/api/v1/projects?year=2025&limit=5` → `200`, live `2025` rows
- `POST https://<your-worker>.workers.dev/api/ai/query` (`{"question":"Find duplicate projects in 2025","mode":"duplicates"}`) → `200`, `groundingVerified: true`
- `PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=https://<your-worker>.workers.dev npx playwright test` → `4 passed` across `1440px`, `1024px`, `390px`, `360px`
