import { Hono } from 'hono';
import {
  CACHE_PUBLIC_SHORT,
  WorkerEnv,
  canonicalContractorKey,
  clampInt,
  formatNairaShort,
  loadAppDataset,
  normalizeEntityName,
  sanitizeFtsQuery,
} from '../lib/d1Helpers';

export const projectsRouter = new Hono<{ Bindings: WorkerEnv }>();

interface BudgetRow {
  id: string;
  financial_year: number;
  president: string;
  project_code: string;
  project_name: string;
  mda_code: string;
  mda_name: string;
  sector: string;
  spending_type: string;
  amount_naira: number;
  pdf_page: number;
  source_filename: string;
  sha256_hash: string;
  geo_zone: string;
  state: string;
  lga: string;
  severity: string;
  lineage_id: string | null;
  forensic_flags_json: string;
  asset_tokens_json: string;
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toFlatProjectItem(r: BudgetRow) {
  return {
    id: r.id,
    financialYear: r.financial_year,
    president: r.president,
    projectCode: r.project_code,
    projectName: r.project_name,
    mdaCode: r.mda_code,
    agency: r.mda_name,
    sector: r.sector,
    spendingType: r.spending_type,
    amount: r.amount_naira,
    amountFormatted: formatNairaShort(r.amount_naira),
    page: r.pdf_page,
    sourceFilename: r.source_filename,
    sha256: r.sha256_hash,
    geoPoliticalZone: r.geo_zone,
    state: r.state,
    lga: r.lga,
    severity: r.severity,
    lineageId: r.lineage_id,
    forensicEvidenceFlags: safeJsonParse<unknown[]>(r.forensic_flags_json, []),
    assetTokens: safeJsonParse<unknown[]>(r.asset_tokens_json, []),
  };
}

function toNestedBudgetRecord(r: BudgetRow) {
  return {
    recordIdentity: {
      id: r.id,
      financialYear: r.financial_year,
      projectCode: r.project_code,
      verbatimProjectName: r.project_name,
      amountNaira: r.amount_naira,
      amountFormatted: formatNairaShort(r.amount_naira),
      spendingType: r.spending_type,
    },
    sourceProvenance: {
      documentId: `DOC-${r.financial_year}`,
      sourceFilename: r.source_filename,
      pdfPage: r.pdf_page,
      sha256Hash: r.sha256_hash,
    },
    geographicTaxonomy: {
      jurisdictionLevel: r.state === 'HQ / Federal Direct' ? 'FEDERAL' : 'STATE',
      geoPoliticalZone: r.geo_zone || 'HQ / Direct Federal',
      state: r.state,
      lga: r.lga || 'Unmapped LGA',
    },
    mdaGovernanceTaxonomy: {
      mdaCode: r.mda_code || '',
      mdaName: r.mda_name,
      sector: r.sector,
    },
    multiYearLineage: {
      lineageId: r.lineage_id,
      yearsAppeared: [r.financial_year],
      cumulativeSpendNaira: r.amount_naira,
      cumulativeSpendFormatted: formatNairaShort(r.amount_naira),
    },
    forensicEvidenceFlags: safeJsonParse<unknown[]>(r.forensic_flags_json, []),
    humanScaleEquivalents: {
      teacherSalaries: '',
      solarBoreholes: '',
      primaryHealthCentres: '',
    },
    assetTokens: safeJsonParse<unknown[]>(r.asset_tokens_json, []),
  };
}

projectsRouter.get('/projects', async (c) => {
  const db = c.env?.DB_BUDGETS;
  if (!db) {
    return c.json(
      { ok: false, available: false, error: 'DB_BUDGETS binding unavailable' },
      503
    );
  }

  const yearRaw = c.req.query('year');
  const pageRaw = c.req.query('page');
  const codeRaw = (c.req.query('code') || '').trim();
  const mda = (c.req.query('mda') || '').trim();
  const sector = (c.req.query('sector') || '').trim();
  const state = (c.req.query('state') || '').trim();
  const zone = (c.req.query('zone') || '').trim();
  const spendingType = (c.req.query('spending_type') || '').trim();
  const severity = (c.req.query('severity') || '').trim();
  const flaggedOnly = ['1', 'true', 'yes'].includes(
    (c.req.query('flagged_only') || '').toLowerCase()
  );
  const q = (c.req.query('q') || '').trim();
  const format = (c.req.query('format') || 'flat').toLowerCase();
  const sort = (c.req.query('sort') || 'amount_desc').toLowerCase();
  const limit = clampInt(c.req.query('limit'), 50, 1, 200);
  const offset = clampInt(c.req.query('offset'), 0, 0, 100000);

  const ftsExpr = sanitizeFtsQuery(q);
  const whereClauses: string[] = [];
  const params: unknown[] = [];

  if (ftsExpr) {
    whereClauses.push('budget_fts MATCH ?');
    params.push(ftsExpr);
  }
  if (yearRaw && yearRaw.toUpperCase() !== 'ALL') {
    const yr = Number.parseInt(yearRaw, 10);
    if (!Number.isFinite(yr) || yr < 1999 || yr > 2030) {
      return c.json({ ok: false, error: 'Invalid year filter' }, 400);
    }
    whereClauses.push('r.financial_year = ?');
    params.push(yr);
  }
  if (pageRaw) {
    const pg = Number.parseInt(pageRaw, 10);
    if (!Number.isFinite(pg) || pg < 1) {
      return c.json({ ok: false, error: 'Invalid page filter' }, 400);
    }
    whereClauses.push('r.pdf_page = ?');
    params.push(pg);
  }
  if (codeRaw) {
    whereClauses.push('LOWER(r.project_code) = ?');
    params.push(codeRaw.toLowerCase());
  }
  if (mda && mda.toUpperCase() !== 'ALL') {
    whereClauses.push('LOWER(r.mda_name) LIKE ?');
    params.push(`%${mda.toLowerCase()}%`);
  }
  if (sector && sector.toUpperCase() !== 'ALL') {
    whereClauses.push('LOWER(r.sector) LIKE ?');
    params.push(`%${sector.toLowerCase()}%`);
  }
  if (state && state.toUpperCase() !== 'ALL') {
    whereClauses.push('LOWER(r.state) LIKE ?');
    params.push(`%${state.toLowerCase()}%`);
  }
  if (zone && zone.toUpperCase() !== 'ALL') {
    whereClauses.push('LOWER(r.geo_zone) LIKE ?');
    params.push(`%${zone.toLowerCase()}%`);
  }
  if (spendingType && spendingType.toUpperCase() !== 'ALL') {
    whereClauses.push('UPPER(r.spending_type) = ?');
    params.push(spendingType.toUpperCase());
  }
  if (flaggedOnly) {
    whereClauses.push("r.severity != 'none'");
  } else if (severity && severity.toUpperCase() !== 'ALL') {
    whereClauses.push('LOWER(r.severity) = ?');
    params.push(severity.toLowerCase());
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const joinSql = ftsExpr
    ? 'FROM budget_fts f JOIN budget_records r ON r.rowid = f.rowid'
    : 'FROM budget_records r';

  let orderSql = ftsExpr
    ? 'ORDER BY bm25(budget_fts, 4.0, 2.0, 3.0, 1.0, 1.0), r.amount_naira DESC'
    : 'ORDER BY r.amount_naira DESC, r.financial_year DESC';
  if (sort === 'amount_asc') {
    orderSql = 'ORDER BY r.amount_naira ASC, r.rowid ASC';
  } else if (sort === 'page_asc') {
    orderSql = 'ORDER BY r.pdf_page ASC, r.amount_naira DESC';
  }

  const rowsRes = await db
    .prepare(
      `
      SELECT
        r.id, r.financial_year, r.president, r.project_code, r.project_name,
        r.mda_code, r.mda_name, r.sector, r.spending_type, r.amount_naira,
        r.pdf_page, r.source_filename, r.sha256_hash, r.geo_zone, r.state,
        r.lga, r.severity, r.lineage_id, r.forensic_flags_json, r.asset_tokens_json
      ${joinSql}
      ${whereSql}
      ${orderSql}
      LIMIT ? OFFSET ?
      `
    )
    .bind(...params, limit, offset)
    .all<BudgetRow>();

  const aggRow = await db
    .prepare(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(r.amount_naira), 0) AS total_amt ${joinSql} ${whereSql}`
    )
    .bind(...params)
    .first<{ cnt: number; total_amt: number }>();

  const rows = rowsRes.results || [];
  const items = rows.map((r) =>
    format === 'record' ? toNestedBudgetRecord(r) : toFlatProjectItem(r)
  );

  c.header('Cache-Control', CACHE_PUBLIC_SHORT);
  return c.json({
    ok: true,
    available: true,
    totalMatches: Number(aggRow?.cnt ?? rows.length),
    totalAmountNaira: Number(aggRow?.total_amt ?? 0),
    limit,
    offset,
    items,
  });
});

projectsRouter.get('/projects/:id', async (c) => {
  const db = c.env?.DB_BUDGETS;
  if (!db) {
    return c.json(
      { ok: false, available: false, error: 'DB_BUDGETS binding unavailable' },
      503
    );
  }

  const id = c.req.param('id').trim();
  const row = await db
    .prepare(
      `
      SELECT
        id, financial_year, president, project_code, project_name,
        mda_code, mda_name, sector, spending_type, amount_naira,
        pdf_page, source_filename, sha256_hash, geo_zone, state,
        lga, severity, lineage_id, forensic_flags_json, asset_tokens_json
      FROM budget_records
      WHERE id = ?
      `
    )
    .bind(id)
    .first<BudgetRow>();

  if (!row) {
    return c.json({ ok: false, error: `Project '${id}' not found` }, 404);
  }

  let nocopoContracts: unknown[] = [];
  if (c.env?.DB_LEDGERS) {
    const cRows = await c.env.DB_LEDGERS.prepare(
      `
      SELECT ocid, financial_year, stage, title, mda_name, contractor_name,
             bpp_contractor_id, contract_award_naira, total_paid_naira,
             award_date, procurement_method, project_code, match_type, confidence_score
      FROM nocopo_contracts
      WHERE budget_record_id = ? OR (project_code != '' AND project_code = ?)
      ORDER BY contract_award_naira DESC
      LIMIT 25
      `
    )
      .bind(row.id, row.project_code)
      .all<Record<string, unknown>>();
    nocopoContracts = cRows.results || [];
  }

  return c.json({
    ok: true,
    record: toNestedBudgetRecord(row),
    item: toFlatProjectItem(row),
    nocopoContracts,
  });
});

projectsRouter.get('/projects/:id/lifecycle', async (c) => {
  const id = c.req.param('id').trim();
  let row: BudgetRow | null = null;
  if (c.env?.DB_BUDGETS) {
    row = await c.env.DB_BUDGETS.prepare(
      `
      SELECT
        id, financial_year, president, project_code, project_name,
        mda_code, mda_name, sector, spending_type, amount_naira,
        pdf_page, source_filename, sha256_hash, geo_zone, state,
        lga, severity, lineage_id, forensic_flags_json, asset_tokens_json
      FROM budget_records
      WHERE id = ?
      `
    )
      .bind(id)
      .first<BudgetRow>();
  }

  const year = row?.financial_year ?? clampInt(c.req.query('year'), 0, 0, 2030);
  const projectCode = row?.project_code || (c.req.query('code') || '').trim();
  const mdaName = row?.mda_name || (c.req.query('mda') || '').trim();

  if (!row && year < 1999 && !projectCode) {
    return c.json({ ok: false, error: `Project '${id}' not found` }, 404);
  }

  const lifecycleIndex = await loadAppDataset<{
    mtefByYear?: Record<string, unknown>;
    birByYear?: Record<string, Record<string, unknown>>;
    diffCyclesAvailable?: number[];
  }>(c.env?.DB_APP, 'project_lifecycle_index');

  const mtef =
    lifecycleIndex?.mtefByYear?.[String(year)] || {
      financialYear: year,
      status: 'NO_MTEF_BENCHMARK',
    };

  let bir: unknown = { financialYear: year, status: 'NO_BIR_DATA' };
  const birYearMap = lifecycleIndex?.birByYear?.[String(year)];
  if (birYearMap && mdaName) {
    const normMda = normalizeEntityName(mdaName);
    const directHit =
      birYearMap[mdaName] ||
      birYearMap[normMda] ||
      Object.entries(birYearMap).find(([k]) =>
        normalizeEntityName(k).includes(normMda) ||
        normMda.includes(normalizeEntityName(k))
      )?.[1];
    if (directHit) bir = directHit;
  }

  let billDiff: unknown = {
    status: (lifecycleIndex?.diffCyclesAvailable || []).includes(year)
      ? 'NOT_IN_ALTERED_DIFF'
      : 'NO_BILL_DIFF_CYCLE',
    cycleAvailable: (lifecycleIndex?.diffCyclesAvailable || []).includes(year),
  };
  if (c.env?.DB_APP && year >= 1999) {
    const needle = projectCode && projectCode.length >= 4 ? projectCode : row?.project_name?.slice(0, 40) || '';
    if (needle) {
      const diffRow = await c.env.DB_APP.prepare(
        'SELECT item_json FROM bill_act_diff_items WHERE financial_year = ? AND item_json LIKE ? LIMIT 1'
      )
        .bind(year, `%${needle}%`)
        .first<{ item_json: string }>();
      if (diffRow?.item_json) {
        billDiff = safeJsonParse(diffRow.item_json, billDiff);
      }
    }
  }

  let nocopo: Array<Record<string, unknown>> = [];
  let govspend: Array<Record<string, unknown>> = [];
  if (c.env?.DB_LEDGERS) {
    const cRows = await c.env.DB_LEDGERS.prepare(
      `
      SELECT ocid, financial_year, stage, title, mda_name, contractor_name, norm_contractor,
             bpp_contractor_id, contract_award_naira, total_paid_naira,
             award_date, procurement_method, project_code, match_type
      FROM nocopo_contracts
      WHERE budget_record_id = ? OR (? != '' AND project_code = ?)
      ORDER BY contract_award_naira DESC
      LIMIT 20
      `
    )
      .bind(id, projectCode, projectCode)
      .all<Record<string, unknown>>();
    nocopo = cRows.results || [];

    const firstContractor = nocopo.find((n) => n.norm_contractor || n.contractor_name);
    if (firstContractor) {
      const cKey =
        String(firstContractor.norm_contractor || '') ||
        canonicalContractorKey(String(firstContractor.contractor_name || ''));
      if (cKey) {
        const gRows = await c.env.DB_LEDGERS.prepare(
          `
          SELECT payment_no, payment_date, financial_year, payer_code, organization_name,
                 beneficiary_name, amount_naira, description
          FROM govspend_payments
          WHERE norm_beneficiary = ? AND amount_naira > 0
          ORDER BY payment_date DESC, amount_naira DESC
          LIMIT 25
          `
        )
          .bind(cKey)
          .all<Record<string, unknown>>();
        govspend = gRows.results || [];
      }
    }
  }

  return c.json({
    ok: true,
    recordId: id,
    financialYear: year,
    projectCode,
    mtef,
    billDiff,
    bir,
    nocopo,
    govspend,
  });
});
