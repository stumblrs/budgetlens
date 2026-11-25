import { Hono } from 'hono';
import {
  CACHE_PUBLIC_SHORT,
  WorkerEnv,
  clampInt,
  loadAppDataset,
  normalizeEntityName,
} from '../lib/d1Helpers';

export const mdasAndForensicsRouter = new Hono<{ Bindings: WorkerEnv }>();

interface MdaScorecardEntry {
  mdaKey?: string;
  mdaName?: string;
  parentFamilies?: string[];
  compositeScore?: number;
  grade?: string;
  totalTrackedExposureNaira?: number;
  rank?: number;
  [key: string]: unknown;
}

interface ConvergenceMdaEntry {
  mdaKey?: string;
  mdaName?: string;
  flagCount?: number;
  flags?: string[];
  flagDetails?: string[];
  oaugfQueryCount?: number;
  oaugfRepeatCount?: number;
  totalExposureNaira?: number;
  [key: string]: unknown;
}

mdasAndForensicsRouter.get('/mdas', async (c) => {
  const dbApp = c.env?.DB_APP;
  if (!dbApp) {
    return c.json(
      { ok: false, available: false, error: 'DB_APP binding unavailable' },
      503
    );
  }

  const [scorecardsData, convergenceData] = await Promise.all([
    loadAppDataset<{
      headline?: unknown;
      pillarDefinitions?: unknown[];
      mdas?: MdaScorecardEntry[];
    }>(dbApp, 'mda_integrity_scorecards'),
    loadAppDataset<{ mdas?: ConvergenceMdaEntry[] }>(
      dbApp,
      'red_flag_convergence_index'
    ),
  ]);

  if (!scorecardsData) {
    return c.json(
      { ok: false, available: false, error: 'mda_integrity_scorecards not seeded' },
      503
    );
  }

  const convMap = new Map<string, ConvergenceMdaEntry>();
  for (const cm of convergenceData?.mdas || []) {
    const key = normalizeEntityName(cm.mdaKey || cm.mdaName || '');
    if (key) convMap.set(key, cm);
  }

  const grade = (c.req.query('grade') || '').trim().toUpperCase();
  const convergentOnly = ['1', 'true', 'yes'].includes(
    (c.req.query('convergent_only') || '').toLowerCase()
  );
  const qLow = (c.req.query('q') || '').trim().toLowerCase();
  const sort = (c.req.query('sort') || 'score_asc').toLowerCase();
  const limit = clampInt(c.req.query('limit'), 50, 1, 200);
  const offset = clampInt(c.req.query('offset'), 0, 0, 50000);

  const enriched = (scorecardsData.mdas || []).map((m) => {
    const norm = normalizeEntityName(m.mdaKey || m.mdaName || '');
    const conv = norm ? convMap.get(norm) || null : null;
    return {
      ...m,
      convergence: conv,
    };
  });

  const filtered = enriched.filter((item) => {
    if (grade && grade !== 'ALL' && String(item.grade || '').toUpperCase() !== grade) {
      return false;
    }
    if (convergentOnly && (!item.convergence || Number(item.convergence.flagCount || 0) < 2)) {
      return false;
    }
    if (qLow) {
      const hay = [
        item.mdaName || '',
        item.mdaKey || '',
        ...(item.parentFamilies || []),
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(qLow)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (sort === 'score_desc') {
      return Number(b.compositeScore || 0) - Number(a.compositeScore || 0);
    }
    if (sort === 'flagged_desc' || sort === 'exposure_desc') {
      return (
        Number(b.totalTrackedExposureNaira || 0) -
        Number(a.totalTrackedExposureNaira || 0)
      );
    }
    if (sort === 'oaugf_desc') {
      return (
        Number(b.convergence?.oaugfQueryCount || 0) -
        Number(a.convergence?.oaugfQueryCount || 0)
      );
    }
    return Number(a.compositeScore || 0) - Number(b.compositeScore || 0);
  });

  c.header('Cache-Control', CACHE_PUBLIC_SHORT);
  return c.json({
    ok: true,
    available: true,
    totalMatches: filtered.length,
    limit,
    offset,
    headline: scorecardsData.headline ?? null,
    pillarDefinitions: scorecardsData.pillarDefinitions ?? [],
    items: filtered.slice(offset, offset + limit),
  });
});

mdasAndForensicsRouter.get('/mdas/:mdaKey/scorecard', async (c) => {
  const dbApp = c.env?.DB_APP;
  if (!dbApp) {
    return c.json({ ok: false, error: 'DB_APP binding unavailable' }, 503);
  }

  const rawParam = decodeURIComponent(c.req.param('mdaKey') || '').trim();
  const normParam = normalizeEntityName(rawParam);
  if (!normParam) {
    return c.json({ ok: false, error: 'Invalid MDA key' }, 400);
  }

  const [scorecardsData, convergenceData] = await Promise.all([
    loadAppDataset<{ mdas?: MdaScorecardEntry[] }>(dbApp, 'mda_integrity_scorecards'),
    loadAppDataset<{ mdas?: ConvergenceMdaEntry[] }>(dbApp, 'red_flag_convergence_index'),
  ]);

  const mda = (scorecardsData?.mdas || []).find((m) => {
    const mk = normalizeEntityName(m.mdaKey || m.mdaName || '');
    return mk === normParam || mk.includes(normParam);
  });

  if (!mda) {
    return c.json({ ok: false, error: `MDA '${rawParam}' not found` }, 404);
  }

  const canonical = normalizeEntityName(mda.mdaKey || mda.mdaName || rawParam);
  const convergence =
    (convergenceData?.mdas || []).find(
      (cm) => normalizeEntityName(cm.mdaKey || cm.mdaName || '') === canonical
    ) || null;

  const [findingsRes, nocopoRes] = await Promise.all([
    dbApp
      .prepare(
        'SELECT finding_id, doc_id, financial_year, mda_name, category, amount_naira, item_json FROM oaugf_findings WHERE UPPER(mda_name) LIKE ? ORDER BY amount_naira DESC LIMIT 25'
      )
      .bind(`%${canonical}%`)
      .all<{ item_json: string }>(),
    c.env?.DB_LEDGERS
      ? c.env.DB_LEDGERS.prepare(
          `
          SELECT ocid, financial_year, stage, title, contractor_name,
                 contract_award_naira, total_paid_naira, award_date, procurement_method
          FROM nocopo_contracts
          WHERE norm_mda = ?
          ORDER BY contract_award_naira DESC
          LIMIT 20
          `
        )
          .bind(canonical)
          .all<Record<string, unknown>>()
      : Promise.resolve({ results: [] as Record<string, unknown>[] }),
  ]);

  c.header('Cache-Control', CACHE_PUBLIC_SHORT);
  return c.json({
    ok: true,
    mda,
    convergence,
    oaugfFindings: (findingsRes.results || []).map((r) => JSON.parse(r.item_json)),
    nocopoContracts: nocopoRes.results || [],
  });
});

const PILLAR_DATASET_MAP: Record<string, string> = {
  'evidence-engine': 'evidence_engine_all_years',
  statistical: 'statistical_forensics_1999_2026',
  'procurement-risk': 'procurement_risk_index',
  govspend: 'govspend_forensics',
  'vendor-network': 'vendor_network_index',
  'follow-the-money': 'follow_the_money_links',
  geo: 'geo_intelligence_index',
  assets: 'asset_inventory_index',
};

mdasAndForensicsRouter.get('/forensics/:pillar', async (c) => {
  const dbApp = c.env?.DB_APP;
  if (!dbApp) {
    return c.json(
      { ok: false, available: false, error: 'DB_APP binding unavailable' },
      503
    );
  }

  const pillar = (c.req.param('pillar') || '').trim().toLowerCase();
  const limit = clampInt(c.req.query('limit'), 50, 1, 200);
  const offset = clampInt(c.req.query('offset'), 0, 0, 50000);

  if (pillar === 'padding') {
    const yearRaw = c.req.query('year');
    if (yearRaw) {
      const year = Number.parseInt(yearRaw, 10);
      if (!Number.isFinite(year) || year < 1999 || year > 2030) {
        return c.json({ ok: false, error: 'Invalid year parameter' }, 400);
      }
      const status = (c.req.query('status') || '').trim().toUpperCase();
      const summaryRow = await dbApp
        .prepare('SELECT summary_json FROM bill_act_diffs WHERE financial_year = ?')
        .bind(year)
        .first<{ summary_json: string }>();
      if (!summaryRow?.summary_json) {
        return c.json({ ok: false, error: `No padding diff for ${year}` }, 404);
      }

      const clauses = ['financial_year = ?'];
      const params: unknown[] = [year];
      if (status && status !== 'ALL') {
        clauses.push('UPPER(status) = ?');
        params.push(status);
      }
      const whereSql = `WHERE ${clauses.join(' AND ')}`;
      const [itemsRes, countRow] = await Promise.all([
        dbApp
          .prepare(
            `SELECT item_json FROM bill_act_diff_items ${whereSql} ORDER BY ABS(delta_naira) DESC LIMIT ? OFFSET ?`
          )
          .bind(...params, limit, offset)
          .all<{ item_json: string }>(),
        dbApp
          .prepare(`SELECT COUNT(*) AS cnt FROM bill_act_diff_items ${whereSql}`)
          .bind(...params)
          .first<{ cnt: number }>(),
      ]);

      c.header('Cache-Control', CACHE_PUBLIC_SHORT);
      return c.json({
        ok: true,
        pillar: 'padding',
        financialYear: year,
        summary: JSON.parse(summaryRow.summary_json),
        totalMatches: Number(countRow?.cnt ?? 0),
        limit,
        offset,
        items: (itemsRes.results || []).map((r) => JSON.parse(r.item_json)),
      });
    }

    const indexData = await loadAppDataset<unknown>(dbApp, 'bill_act_diffs_index');
    if (!indexData) {
      return c.json({ ok: false, error: 'bill_act_diffs_index not found' }, 404);
    }
    c.header('Cache-Control', CACHE_PUBLIC_SHORT);
    return c.json({ ok: true, pillar: 'padding', data: indexData });
  }

  if (pillar === 'oaugf') {
    const yearRaw = c.req.query('year');
    const mda = (c.req.query('mda') || '').trim();
    const category = (c.req.query('category') || '').trim();

    const clauses: string[] = [];
    const params: unknown[] = [];
    if (yearRaw) {
      const yr = Number.parseInt(yearRaw, 10);
      if (Number.isFinite(yr)) {
        clauses.push('financial_year = ?');
        params.push(yr);
      }
    }
    if (mda) {
      clauses.push('LOWER(mda_name) LIKE ?');
      params.push(`%${mda.toLowerCase()}%`);
    }
    if (category) {
      clauses.push('LOWER(category) LIKE ?');
      params.push(`%${category.toLowerCase()}%`);
    }
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const [indexData, itemsRes, countRow] = await Promise.all([
      loadAppDataset<unknown>(dbApp, 'oaugf_audit_index'),
      dbApp
        .prepare(
          `SELECT item_json FROM oaugf_findings ${whereSql} ORDER BY amount_naira DESC LIMIT ? OFFSET ?`
        )
        .bind(...params, limit, offset)
        .all<{ item_json: string }>(),
      dbApp
        .prepare(`SELECT COUNT(*) AS cnt FROM oaugf_findings ${whereSql}`)
        .bind(...params)
        .first<{ cnt: number }>(),
    ]);

    c.header('Cache-Control', CACHE_PUBLIC_SHORT);
    return c.json({
      ok: true,
      pillar: 'oaugf',
      index: indexData,
      totalMatches: Number(countRow?.cnt ?? 0),
      limit,
      offset,
      findings: (itemsRes.results || []).map((r) => JSON.parse(r.item_json)),
    });
  }

  if (pillar === 'lineages') {
    const lineagesData = await loadAppDataset<{
      generatedAt?: string;
      totalLineages?: number;
      lineages?: Array<Record<string, unknown>>;
    }>(dbApp, 'recurring_lineages');
    if (!lineagesData) {
      return c.json({ ok: false, error: 'recurring_lineages not found' }, 404);
    }
    const qLow = (c.req.query('q') || '').trim().toLowerCase();
    const sectorLow = (c.req.query('sector') || '').trim().toLowerCase();
    const filtered = (lineagesData.lineages || []).filter((item) => {
      if (sectorLow && !String(item.sector || '').toLowerCase().includes(sectorLow)) {
        return false;
      }
      if (qLow) {
        const hay = [
          item.canonicalTitle || item.canonical_title || '',
          item.agency || '',
          item.projectCode || item.project_code || '',
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(qLow)) return false;
      }
      return true;
    });

    c.header('Cache-Control', CACHE_PUBLIC_SHORT);
    return c.json({
      ok: true,
      pillar: 'lineages',
      totalLineages: lineagesData.totalLineages ?? filtered.length,
      totalMatches: filtered.length,
      limit,
      offset,
      lineages: filtered.slice(offset, offset + limit),
    });
  }

  const datasetKey = PILLAR_DATASET_MAP[pillar];
  if (!datasetKey) {
    return c.json({ ok: false, error: `Unknown forensics pillar '${pillar}'` }, 404);
  }

  const data = await loadAppDataset<unknown>(dbApp, datasetKey);
  if (!data) {
    return c.json({ ok: false, error: `Dataset '${datasetKey}' not found` }, 404);
  }

  c.header('Cache-Control', CACHE_PUBLIC_SHORT);
  return c.json({
    ok: true,
    pillar,
    data,
  });
});
