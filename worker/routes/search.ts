import { Hono } from 'hono';
import {
  WorkerEnv,
  canonicalContractorKey,
  clampInt,
  loadAppDataset,
  normalizeEntityName,
  sanitizeFtsQuery,
} from '../lib/d1Helpers';

export const searchRouter = new Hono<{ Bindings: WorkerEnv }>();

searchRouter.get('/search', async (c) => {
  const t0 = Date.now();
  const q = (c.req.query('q') || '').slice(0, 200);
  const yearRaw = c.req.query('year');
  const president = (c.req.query('president') || '').trim();
  const severity = (c.req.query('severity') || '').trim();
  const sector = (c.req.query('sector') || '').trim();
  const limit = clampInt(c.req.query('limit'), 30, 1, 100);
  const offset = clampInt(c.req.query('offset'), 0, 0, 5000);

  const db = c.env?.DB_BUDGETS;
  if (!db) {
    const strict = c.req.query('strict') === '1';
    return c.json(
      {
        available: false,
        query: q,
        totalMatches: 0,
        elapsedMs: 0,
        results: [],
        facets: { years: [], severities: [] },
      },
      strict ? 503 : 200
    );
  }

  const ftsExpr = sanitizeFtsQuery(q);
  const whereClauses: string[] = [];
  const params: unknown[] = [];

  if (ftsExpr) {
    whereClauses.push('budget_fts MATCH ?');
    params.push(ftsExpr);
  }
  if (yearRaw) {
    const yr = Number.parseInt(yearRaw, 10);
    if (!Number.isFinite(yr) || yr < 1999 || yr > 2030) {
      return c.json({ ok: false, error: 'Invalid year query parameter' }, 400);
    }
    whereClauses.push('r.financial_year = ?');
    params.push(yr);
  }
  if (president && president.toUpperCase() !== 'ALL') {
    whereClauses.push('r.president = ?');
    params.push(president.toLowerCase());
  }
  if (severity && severity.toUpperCase() !== 'ALL') {
    whereClauses.push('r.severity = ?');
    params.push(severity.toLowerCase());
  }
  if (sector && sector.toUpperCase() !== 'ALL') {
    whereClauses.push('LOWER(r.sector) LIKE ?');
    params.push(`%${sector.toLowerCase()}%`);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const joinSql = ftsExpr
    ? 'FROM budget_fts f JOIN budget_records r ON r.rowid = f.rowid'
    : 'FROM budget_records r';
  const orderSql = ftsExpr
    ? 'ORDER BY bm25(budget_fts, 4.0, 2.0, 3.0, 1.0, 1.0), r.amount_naira DESC'
    : 'ORDER BY r.financial_year DESC, r.amount_naira DESC';

  const [rowsRes, totalRow, yearFacetsRes, sevFacetsRes] = await Promise.all([
    db
      .prepare(
        `
        SELECT
          r.id, r.financial_year, r.president, r.project_code,
          r.project_name, r.mda_name, r.sector, r.spending_type,
          r.amount_naira, r.pdf_page, r.source_filename, r.sha256_hash,
          r.state, r.severity
        ${joinSql}
        ${whereSql}
        ${orderSql}
        LIMIT ? OFFSET ?
        `
      )
      .bind(...params, limit, offset)
      .all<Record<string, unknown>>(),
    db
      .prepare(`SELECT COUNT(*) AS cnt ${joinSql} ${whereSql}`)
      .bind(...params)
      .first<{ cnt: number }>(),
    db
      .prepare(
        `
        SELECT r.financial_year AS year, COUNT(*) AS count
        ${joinSql}
        ${whereSql}
        GROUP BY r.financial_year
        ORDER BY count DESC
        LIMIT 8
        `
      )
      .bind(...params)
      .all<{ year: number; count: number }>(),
    db
      .prepare(
        `
        SELECT r.severity AS severity, COUNT(*) AS count
        ${joinSql}
        ${whereSql}
        GROUP BY r.severity
        ORDER BY count DESC
        `
      )
      .bind(...params)
      .all<{ severity: string; count: number }>(),
  ]);

  const rows = rowsRes.results || [];
  return c.json({
    available: true,
    query: q,
    sanitizedFtsQuery: ftsExpr,
    totalMatches: Number(totalRow?.cnt ?? rows.length),
    elapsedMs: Date.now() - t0,
    results: rows.map((r) => ({
      id: r.id,
      financialYear: r.financial_year,
      president: r.president,
      projectCode: r.project_code,
      projectName: r.project_name,
      agency: r.mda_name,
      sector: r.sector,
      projectType: r.spending_type,
      amount: r.amount_naira,
      page: r.pdf_page,
      sourceFilename: r.source_filename,
      sha256: r.sha256_hash,
      state: r.state,
      severity: r.severity,
    })),
    facets: {
      years: yearFacetsRes.results || [],
      severities: sevFacetsRes.results || [],
    },
  });
});

searchRouter.get('/procurement/search', async (c) => {
  const t0 = Date.now();
  const q = (c.req.query('q') || '').slice(0, 200);
  const yearRaw = c.req.query('year');
  const stage = (c.req.query('stage') || '').trim();
  const matchedOnly = ['1', 'true', 'yes'].includes(
    (c.req.query('matched_only') || '').toLowerCase()
  );
  const limit = clampInt(c.req.query('limit'), 30, 1, 100);
  const offset = clampInt(c.req.query('offset'), 0, 0, 5000);

  const db = c.env?.DB_LEDGERS;
  if (!db) {
    return c.json({ available: false, query: q, totalMatches: 0, elapsedMs: 0, results: [] });
  }

  const ftsExpr = sanitizeFtsQuery(q);
  const whereClauses: string[] = [];
  const params: unknown[] = [];

  if (ftsExpr) {
    whereClauses.push('nocopo_fts MATCH ?');
    params.push(ftsExpr);
  }
  if (yearRaw) {
    const yr = Number.parseInt(yearRaw, 10);
    if (!Number.isFinite(yr) || yr < 1999 || yr > 2030) {
      return c.json({ ok: false, error: 'Invalid year filter' }, 400);
    }
    whereClauses.push('c.financial_year = ?');
    params.push(yr);
  }
  if (stage && stage.toUpperCase() !== 'ALL') {
    whereClauses.push('c.stage = ?');
    params.push(stage.toLowerCase());
  }
  if (matchedOnly) {
    whereClauses.push("c.match_type != 'NO_PUBLIC_RECORD_FOUND'");
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const joinSql = ftsExpr
    ? 'FROM nocopo_fts f JOIN nocopo_contracts c ON c.rowid = f.rowid'
    : 'FROM nocopo_contracts c';
  const orderSql = ftsExpr
    ? 'ORDER BY bm25(nocopo_fts, 1.0, 4.0, 2.0, 3.0, 2.0, 3.0), c.contract_award_naira DESC'
    : 'ORDER BY c.contract_award_naira DESC, c.financial_year DESC';

  const [rowsRes, totalRow] = await Promise.all([
    db
      .prepare(
        `
        SELECT
          c.ocid, c.financial_year, c.stage, c.title, c.mda_name,
          c.buyer_admin_code, c.contractor_name, c.bpp_contractor_id,
          c.cac_rc_number, c.contract_award_naira, c.total_paid_naira,
          c.award_date, c.procurement_method, c.budget_record_id,
          c.project_code, c.match_type, c.confidence_score, c.source_file
        ${joinSql}
        ${whereSql}
        ${orderSql}
        LIMIT ? OFFSET ?
        `
      )
      .bind(...params, limit, offset)
      .all<Record<string, unknown>>(),
    db
      .prepare(`SELECT COUNT(*) AS cnt ${joinSql} ${whereSql}`)
      .bind(...params)
      .first<{ cnt: number }>(),
  ]);

  const rows = rowsRes.results || [];
  return c.json({
    available: true,
    query: q,
    totalMatches: Number(totalRow?.cnt ?? rows.length),
    elapsedMs: Date.now() - t0,
    results: rows.map((r) => ({
      ocdsReleaseId: r.ocid,
      financialYear: r.financial_year,
      stage: r.stage,
      budgetTitle: r.title,
      mdaName: r.mda_name,
      buyerAdminCode: r.buyer_admin_code,
      contractorName: r.contractor_name || null,
      bppContractorId: r.bpp_contractor_id || null,
      cacRcNumber: r.cac_rc_number || null,
      contractAwardNaira: r.contract_award_naira || null,
      totalPaidNaira: r.total_paid_naira || null,
      awardDate: r.award_date || null,
      procurementMethod: r.procurement_method || null,
      budgetRecordId: r.budget_record_id || '',
      projectCode: r.project_code || '',
      matchType: r.match_type,
      confidenceScore: r.confidence_score,
      sourceUrlOrFile: r.source_file,
    })),
  });
});

interface LeaderboardEntry {
  contractorName?: string;
  bppContractorId?: string;
  topMdas?: string[];
  contractCount?: number;
  totalContractedNaira?: number;
  govspendPaidNaira?: number;
  mdaCount?: number;
}

searchRouter.get('/procurement/contractors', async (c) => {
  const qLow = (c.req.query('q') || '').trim().toLowerCase();
  const sort = (c.req.query('sort') || 'amount').toLowerCase();
  const minAwards = clampInt(c.req.query('min_awards'), 1, 1, 500);
  const limit = clampInt(c.req.query('limit'), 50, 1, 200);
  const offset = clampInt(c.req.query('offset'), 0, 0, 50000);

  const data = await loadAppDataset<{
    contractors?: LeaderboardEntry[];
    totalDistinctContractors?: number;
    awardCoverageYears?: string;
    treasuryCoverageRange?: string;
    coverageNote?: string;
  }>(c.env?.DB_APP, 'contractors_leaderboard');

  if (!data) {
    return c.json({
      available: false,
      totalMatches: 0,
      totalDistinctContractors: 0,
      results: [],
    });
  }

  const filtered = (data.contractors || []).filter((entry) => {
    if (Number(entry.contractCount || 0) < minAwards) return false;
    if (!qLow) return true;
    const hay = [
      entry.contractorName || '',
      entry.bppContractorId || '',
      ...(entry.topMdas || []),
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(qLow);
  });

  filtered.sort((a, b) => {
    if (sort === 'count') {
      return (
        Number(b.contractCount || 0) - Number(a.contractCount || 0) ||
        Number(b.totalContractedNaira || 0) - Number(a.totalContractedNaira || 0)
      );
    }
    if (sort === 'govspend') {
      return (
        Number(b.govspendPaidNaira || 0) - Number(a.govspendPaidNaira || 0) ||
        Number(b.totalContractedNaira || 0) - Number(a.totalContractedNaira || 0)
      );
    }
    if (sort === 'mdas') {
      return (
        Number(b.mdaCount || 0) - Number(a.mdaCount || 0) ||
        Number(b.contractCount || 0) - Number(a.contractCount || 0)
      );
    }
    return (
      Number(b.totalContractedNaira || 0) - Number(a.totalContractedNaira || 0) ||
      Number(b.contractCount || 0) - Number(a.contractCount || 0)
    );
  });

  return c.json({
    available: true,
    totalMatches: filtered.length,
    totalDistinctContractors: data.totalDistinctContractors ?? 0,
    awardCoverageYears: data.awardCoverageYears ?? '2001–2026',
    treasuryCoverageRange: data.treasuryCoverageRange ?? '2018-09-01 to 2026-06-19',
    coverageNote: data.coverageNote ?? '',
    results: filtered.slice(offset, offset + limit),
  });
});

searchRouter.get('/procurement/contractor-history', async (c) => {
  const t0 = Date.now();
  const name = (c.req.query('name') || '').trim();
  if (name.length < 2) {
    return c.json({ ok: false, error: 'Query parameter "name" (min 2 chars) is required' }, 400);
  }
  const limit = clampInt(c.req.query('limit'), 100, 1, 500);
  const key = canonicalContractorKey(name);
  if (!key) {
    return c.json({
      available: false,
      contractorName: name,
      canonicalKey: '',
      contracts: [],
      payments: [],
    });
  }

  const candidates = [key, `M S ${key}`, `MS ${key}`, `MESSRS ${key}`];
  const dbLedgers = c.env?.DB_LEDGERS;
  if (dbLedgers) {
    const [cAgg, cRowsRes, gAgg, gRowsRes] = await Promise.all([
      dbLedgers
        .prepare(
          `
          SELECT COUNT(*) AS cnt,
                 COALESCE(SUM(contract_award_naira), 0) AS awarded,
                 COALESCE(SUM(total_paid_naira), 0) AS paid
          FROM nocopo_contracts
          WHERE norm_contractor IN (?, ?, ?, ?) AND contract_award_naira > 0
          `
        )
        .bind(...candidates)
        .first<{ cnt: number; awarded: number; paid: number }>(),
      dbLedgers
        .prepare(
          `
          SELECT ocid, financial_year, stage, title, mda_name, contractor_name,
                 bpp_contractor_id, contract_award_naira, total_paid_naira,
                 award_date, procurement_method, project_code, match_type
          FROM nocopo_contracts
          WHERE norm_contractor IN (?, ?, ?, ?) AND contract_award_naira > 0
          ORDER BY financial_year DESC, contract_award_naira DESC
          LIMIT ?
          `
        )
        .bind(...candidates, limit)
        .all<Record<string, unknown>>(),
      dbLedgers
        .prepare(
          `
          SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_naira), 0) AS amt
          FROM govspend_payments
          WHERE norm_beneficiary IN (?, ?, ?, ?) AND amount_naira > 0
          `
        )
        .bind(...candidates)
        .first<{ cnt: number; amt: number }>(),
      dbLedgers
        .prepare(
          `
          SELECT payment_no, payment_date, financial_year, payer_code,
                 organization_name, beneficiary_name, amount_naira, description
          FROM govspend_payments
          WHERE norm_beneficiary IN (?, ?, ?, ?) AND amount_naira > 0
          ORDER BY payment_date DESC, amount_naira DESC
          LIMIT ?
          `
        )
        .bind(...candidates, limit)
        .all<Record<string, unknown>>(),
    ]);

    const cRows = cRowsRes.results || [];
    const gRows = gRowsRes.results || [];
    if (cRows.length > 0 || gRows.length > 0 || !c.env?.DB_APP) {
      return c.json({
        available: true,
        contractorName: name,
        canonicalKey: key,
        totalContracts: Number(cAgg?.cnt ?? cRows.length),
        totalContractedNaira: Number(cAgg?.awarded ?? 0),
        totalNocopoDisbursedNaira: Number(cAgg?.paid ?? 0),
        contracts: cRows.map((r) => ({
          ocdsReleaseId: r.ocid,
          financialYear: Number(r.financial_year || 0),
          stage: r.stage || 'award',
          budgetTitle: r.title || '',
          mdaName: r.mda_name || '',
          contractorName: r.contractor_name || name,
          bppContractorId: r.bpp_contractor_id || null,
          contractAwardNaira: Number(r.contract_award_naira || 0),
          totalPaidNaira: Number(r.total_paid_naira || 0),
          awardDate: r.award_date || null,
          procurementMethod: r.procurement_method || null,
          projectCode: r.project_code || '',
          matchType: r.match_type || '',
        })),
        totalGovspendCount: Number(gAgg?.cnt ?? gRows.length),
        totalGovspendNaira: Number(gAgg?.amt ?? 0),
        payments: gRows.map((r) => ({
          paymentNo: r.payment_no || '',
          paymentDate: r.payment_date || '',
          financialYear: Number(r.financial_year || 0),
          payerCode: r.payer_code || '',
          organizationName: r.organization_name || '',
          beneficiaryName: r.beneficiary_name || '',
          amountNaira: Number(r.amount_naira || 0),
          description: r.description || '',
        })),
        elapsedMs: Date.now() - t0,
      });
    }
  }

  if (c.env?.DB_APP) {
    const dossier = await c.env.DB_APP.prepare(
      'SELECT contractor_key, payload_json FROM contractor_dossiers WHERE contractor_key IN (?, ?, ?, ?) OR contractor_key = ? LIMIT 1'
    )
      .bind(...candidates, name.toUpperCase())
      .first<{ contractor_key: string; payload_json: string }>();
    if (dossier?.payload_json) {
      const parsed = JSON.parse(dossier.payload_json) as {
        contracts?: Array<Record<string, unknown>>;
        payments?: Array<Record<string, unknown>>;
      };
      const contracts = (parsed.contracts || []).slice(0, limit);
      const payments = (parsed.payments || []).slice(0, limit);
      return c.json({
        available: true,
        contractorName: name,
        canonicalKey: dossier.contractor_key,
        totalContracts: (parsed.contracts || []).length,
        totalContractedNaira: (parsed.contracts || []).reduce(
          (s, item) => s + Number(item.contractAwardNaira || 0),
          0
        ),
        totalNocopoDisbursedNaira: (parsed.contracts || []).reduce(
          (s, item) => s + Number(item.totalPaidNaira || 0),
          0
        ),
        contracts,
        totalGovspendCount: (parsed.payments || []).length,
        totalGovspendNaira: (parsed.payments || []).reduce(
          (s, item) => s + Number(item.amountNaira || 0),
          0
        ),
        payments,
        elapsedMs: Date.now() - t0,
      });
    }
  }

  return c.json({
    available: false,
    contractorName: name,
    canonicalKey: key,
    contracts: [],
    payments: [],
    elapsedMs: Date.now() - t0,
  });
});

searchRouter.get('/expenditures/search', async (c) => {
  const t0 = Date.now();
  const q = (c.req.query('q') || '').slice(0, 200);
  const yearRaw = c.req.query('year');
  const mda = (c.req.query('mda') || '').trim();
  const minAmtRaw = c.req.query('min_amount');
  const limit = clampInt(c.req.query('limit'), 30, 1, 100);
  const offset = clampInt(c.req.query('offset'), 0, 0, 5000);

  const db = c.env?.DB_LEDGERS;
  if (!db) {
    return c.json({ available: false, query: q, totalMatches: 0, elapsedMs: 0, results: [] });
  }

  const ftsExpr = sanitizeFtsQuery(q);
  const whereClauses: string[] = [];
  const params: unknown[] = [];

  if (ftsExpr) {
    whereClauses.push('govspend_fts MATCH ?');
    params.push(ftsExpr);
  }
  if (yearRaw) {
    const yr = Number.parseInt(yearRaw, 10);
    if (!Number.isFinite(yr) || yr < 2018 || yr > 2030) {
      return c.json({ ok: false, error: 'Invalid year filter' }, 400);
    }
    whereClauses.push('g.financial_year = ?');
    params.push(yr);
  }
  if (mda) {
    whereClauses.push('LOWER(g.organization_name) LIKE ?');
    params.push(`%${mda.toLowerCase()}%`);
  }
  if (minAmtRaw) {
    const minAmt = Number.parseInt(minAmtRaw, 10);
    if (Number.isFinite(minAmt) && minAmt > 0) {
      whereClauses.push('g.amount_naira >= ?');
      params.push(minAmt);
    }
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const joinSql = ftsExpr
    ? 'FROM govspend_fts f JOIN govspend_payments g ON g.rowid = f.rowid'
    : 'FROM govspend_payments g';
  const orderSql = ftsExpr
    ? 'ORDER BY bm25(govspend_fts, 1.0, 2.0, 4.0, 2.5, 1.0), g.amount_naira DESC'
    : 'ORDER BY g.payment_date DESC, g.amount_naira DESC';

  const [rowsRes, totalRow] = await Promise.all([
    db
      .prepare(
        `
        SELECT g.payment_no, g.payment_date, g.financial_year, g.payer_code,
               g.organization_name, g.beneficiary_name, g.amount_naira, g.description
        ${joinSql}
        ${whereSql}
        ${orderSql}
        LIMIT ? OFFSET ?
        `
      )
      .bind(...params, limit, offset)
      .all<Record<string, unknown>>(),
    db
      .prepare(`SELECT COUNT(*) AS cnt ${joinSql} ${whereSql}`)
      .bind(...params)
      .first<{ cnt: number }>(),
  ]);

  const rows = rowsRes.results || [];
  return c.json({
    available: true,
    query: q,
    totalMatches: Number(totalRow?.cnt ?? rows.length),
    elapsedMs: Date.now() - t0,
    results: rows.map((r) => ({
      paymentNo: r.payment_no,
      paymentDate: r.payment_date,
      financialYear: r.financial_year,
      payerCode: r.payer_code,
      organizationName: r.organization_name,
      beneficiaryName: r.beneficiary_name,
      amountNaira: r.amount_naira,
      description: r.description,
    })),
  });
});

searchRouter.get('/expenditures/beneficiary', async (c) => {
  const t0 = Date.now();
  const name = (c.req.query('name') || '').trim();
  if (name.length < 2) {
    return c.json({ ok: false, error: 'Query parameter "name" (min 2 chars) is required' }, 400);
  }
  const limit = clampInt(c.req.query('limit'), 40, 1, 100);

  const db = c.env?.DB_LEDGERS;
  if (!db) {
    return c.json({
      available: false,
      name,
      paymentCount: 0,
      totalAmountNaira: 0,
      results: [],
    });
  }

  const normFull = normalizeEntityName(name);
  const normKey = canonicalContractorKey(name) || normFull;
  const candidates = Array.from(
    new Set([normKey, normFull, `M S ${normKey}`, `MS ${normKey}`, `MESSRS ${normKey}`].filter(Boolean))
  );
  const placeholders = candidates.map(() => '?').join(', ');

  const [agg, rowsRes] = await Promise.all([
    db
      .prepare(
        `
        SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_naira), 0) AS total_amt
        FROM govspend_payments
        WHERE norm_beneficiary IN (${placeholders})
        `
      )
      .bind(...candidates)
      .first<{ cnt: number; total_amt: number }>(),
    db
      .prepare(
        `
        SELECT payment_no, payment_date, financial_year, payer_code, organization_name,
               beneficiary_name, amount_naira, description
        FROM govspend_payments
        WHERE norm_beneficiary IN (${placeholders})
        ORDER BY payment_date DESC, amount_naira DESC
        LIMIT ?
        `
      )
      .bind(...candidates, limit)
      .all<Record<string, unknown>>(),
  ]);

  const rows = rowsRes.results || [];
  return c.json({
    available: true,
    name,
    normalizedName: normKey,
    paymentCount: Number(agg?.cnt ?? rows.length),
    totalAmountNaira: Number(agg?.total_amt ?? 0),
    elapsedMs: Date.now() - t0,
    results: rows.map((r) => ({
      paymentNo: r.payment_no,
      paymentDate: r.payment_date,
      financialYear: r.financial_year,
      payerCode: r.payer_code,
      organizationName: r.organization_name,
      beneficiaryName: r.beneficiary_name,
      amountNaira: r.amount_naira,
      description: r.description,
    })),
  });
});
