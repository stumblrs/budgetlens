import { Hono } from 'hono';
import {
  CACHE_PUBLIC_SHORT,
  WorkerEnv,
  clampInt,
  loadAppDataset,
} from '../lib/d1Helpers';

export const yearsRouter = new Hono<{ Bindings: WorkerEnv }>();

interface RegistryDocLike {
  financial_year?: number;
  financialYear?: number;
}

yearsRouter.get('/years', async (c) => {
  const dbApp = c.env?.DB_APP;
  if (!dbApp) {
    return c.json(
      { ok: false, available: false, error: 'DB_APP binding unavailable' },
      503
    );
  }

  const [registry, hierarchySummary, coverageAudit] = await Promise.all([
    loadAppDataset<unknown>(dbApp, 'registry'),
    loadAppDataset<{ yearSummaries?: Record<string, unknown> }>(
      dbApp,
      'hierarchy_summary'
    ),
    loadAppDataset<unknown>(dbApp, 'coverage_audit'),
  ]);

  const yearSet = new Set<number>();
  const docs: RegistryDocLike[] = Array.isArray(registry)
    ? (registry as RegistryDocLike[])
    : ((registry as { documents?: RegistryDocLike[] } | null)?.documents ?? []);
  for (const doc of docs) {
    const yr = Number(doc.financial_year ?? doc.financialYear);
    if (Number.isFinite(yr) && yr >= 1999) yearSet.add(yr);
  }
  if (hierarchySummary?.yearSummaries) {
    for (const key of Object.keys(hierarchySummary.yearSummaries)) {
      const yr = Number.parseInt(key, 10);
      if (Number.isFinite(yr) && yr >= 1999) yearSet.add(yr);
    }
  }

  const availableYears = Array.from(yearSet).sort((a, b) => b - a);
  c.header('Cache-Control', CACHE_PUBLIC_SHORT);
  return c.json({
    ok: true,
    available: true,
    availableYears,
    registry,
    hierarchySummary,
    coverageAudit,
  });
});

yearsRouter.get('/years/:year/summary', async (c) => {
  const year = Number.parseInt(c.req.param('year'), 10);
  if (!Number.isFinite(year) || year < 1999 || year > 2030) {
    return c.json({ ok: false, error: 'Invalid financial year (expected 1999–2030)' }, 400);
  }

  let statistics: unknown = null;
  if (c.env?.DB_BUDGETS) {
    const row = await c.env.DB_BUDGETS.prepare(
      'SELECT payload_json FROM year_statistics WHERE financial_year = ?'
    )
      .bind(year)
      .first<{ payload_json: string }>();
    if (row?.payload_json) {
      statistics = JSON.parse(row.payload_json);
    }
  }

  const narrative = await loadAppDataset<unknown>(
    c.env?.DB_APP,
    `narratives/${year}`
  );

  if (!statistics && !narrative) {
    return c.json(
      { ok: false, error: `No summary data found for financial year ${year}` },
      404
    );
  }

  c.header('Cache-Control', CACHE_PUBLIC_SHORT);
  return c.json({
    ok: true,
    financialYear: year,
    statistics,
    narrative,
  });
});

yearsRouter.get('/datasets/:key{.+}', async (c) => {
  const rawKey = (c.req.param('key') || '').replace(/^\/+/, '');
  if (!rawKey) {
    return c.json({ ok: false, error: 'Dataset key required' }, 400);
  }

  const statsMatch = rawKey.match(/^(\d{4})\/statistics(?:\.json)?$/);
  if (statsMatch) {
    const year = Number.parseInt(statsMatch[1], 10);
    if (!c.env?.DB_BUDGETS) {
      return c.json({ ok: false, error: 'DB_BUDGETS binding unavailable' }, 503);
    }
    const row = await c.env.DB_BUDGETS.prepare(
      'SELECT payload_json FROM year_statistics WHERE financial_year = ?'
    )
      .bind(year)
      .first<{ payload_json: string }>();
    if (!row?.payload_json) {
      return c.json({ ok: false, error: `Statistics not found for ${year}` }, 404);
    }
    c.header('Cache-Control', CACHE_PUBLIC_SHORT);
    return c.json(JSON.parse(row.payload_json));
  }

  const diffMatch = rawKey.match(/^bill_act_diffs\/(\d{4})(?:\.json)?$/);
  if (diffMatch) {
    const year = Number.parseInt(diffMatch[1], 10);
    if (!c.env?.DB_APP) {
      return c.json({ ok: false, error: 'DB_APP binding unavailable' }, 503);
    }
    const summaryRow = await c.env.DB_APP.prepare(
      'SELECT summary_json FROM bill_act_diffs WHERE financial_year = ?'
    )
      .bind(year)
      .first<{ summary_json: string }>();
    if (!summaryRow?.summary_json) {
      return c.json({ ok: false, error: `Bill vs Act diff not found for ${year}` }, 404);
    }
    const limit = clampInt(c.req.query('limit'), 5000, 1, 10000);
    const offset = clampInt(c.req.query('offset'), 0, 0, 100000);
    const itemRows = await c.env.DB_APP.prepare(
      'SELECT item_json FROM bill_act_diff_items WHERE financial_year = ? ORDER BY ABS(delta_naira) DESC LIMIT ? OFFSET ?'
    )
      .bind(year, limit, offset)
      .all<{ item_json: string }>();
    const combined = JSON.parse(summaryRow.summary_json) as Record<string, unknown>;
    combined.items = (itemRows.results || []).map((r) => JSON.parse(r.item_json));
    c.header('Cache-Control', CACHE_PUBLIC_SHORT);
    return c.json(combined);
  }

  if (!c.env?.DB_APP) {
    return c.json({ ok: false, error: 'DB_APP binding unavailable' }, 503);
  }

  let normalizedKey = rawKey.replace(/\.json$/i, '');
  if (normalizedKey === 'db/hierarchy_summary') normalizedKey = 'hierarchy_summary';
  if (normalizedKey === 'bill_act_diffs/index') normalizedKey = 'bill_act_diffs_index';

  const data = await loadAppDataset<unknown>(c.env.DB_APP, normalizedKey);
  if (data === null) {
    return c.json({ ok: false, error: `Dataset '${normalizedKey}' not found` }, 404);
  }

  c.header('Cache-Control', CACHE_PUBLIC_SHORT);
  return c.json(data);
});
