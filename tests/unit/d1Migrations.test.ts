import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { app } from '../../worker/index';

const MIGRATION_SPECS = [
  {
    name: 'budgets',
    path: resolve(process.cwd(), 'worker/migrations/budgets/0001_init.sql'),
    requiredTables: ['budget_records', 'budget_fts', 'year_statistics'],
  },
  {
    name: 'ledgers',
    path: resolve(process.cwd(), 'worker/migrations/ledgers/0001_init.sql'),
    requiredTables: [
      'nocopo_contracts',
      'nocopo_fts',
      'govspend_payments',
      'govspend_fts',
      'oaugf_chunks',
      'oaugf_fts',
      'policy_chunks',
      'policy_fts',
      'bir_ocr_chunks',
      'bir_ocr_fts',
    ],
  },
  {
    name: 'app',
    path: resolve(process.cwd(), 'worker/migrations/app/0001_init.sql'),
    requiredTables: [
      'app_datasets',
      'app_dataset_chunks',
      'bill_act_diffs',
      'bill_act_diff_items',
      'contractor_dossiers',
      'oaugf_findings',
      'citizen_tips',
      'tip_rate_limits',
      'casebooks',
    ],
  },
  {
    name: 'app_0002_tip_photos',
    path: resolve(process.cwd(), 'worker/migrations/app/0002_tip_photos.sql'),
    requiredTables: ['tip_photos', 'idx_tip_photos_tip'],
  },
];

describe('Cloudflare D1 Migrations & Health Probe (P8-CP-2)', () => {
  it('defines transaction-free SQL migrations for all 3 D1 databases', () => {
    for (const spec of MIGRATION_SPECS) {
      expect(existsSync(spec.path), `${spec.name} migration missing`).toBe(true);
      const rawSql = readFileSync(spec.path, 'utf8');
      const executableSql = rawSql.replace(/^\s*--.*$/gm, '');
      expect(executableSql).not.toMatch(/\bBEGIN(?:\s+TRANSACTION)?\b\s*;/i);
      expect(executableSql).not.toMatch(/\bCOMMIT\b\s*;/i);
      for (const table of spec.requiredTables) {
        expect(rawSql, `${spec.name} missing table ${table}`).toContain(table);
      }
    }
  });

  it('returns D1 row counts on /api/v1/health?deep=1 when D1 bindings are present', async () => {
    const makeMockDb = (count: number) =>
      ({
        prepare: () => ({
          first: async <T,>() => ({ count }) as unknown as T,
        }),
      }) as unknown as D1Database;

    const res = await app.request(
      '/api/v1/health?deep=1',
      undefined,
      {
        ENVIRONMENT: 'test',
        DB_BUDGETS: makeMockDb(559325),
        DB_LEDGERS: makeMockDb(98866),
        DB_APP: makeMockDb(42),
      }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      bindings: Record<string, boolean>;
      counts?: Record<string, number | null>;
    };
    expect(body.ok).toBe(true);
    expect(body.bindings).toEqual({ budgets: true, ledgers: true, app: true });
    expect(body.counts).toEqual({
      budget_records: 559325,
      nocopo_contracts: 98866,
      app_datasets: 42,
    });
  });
});
