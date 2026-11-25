import { Hono } from 'hono';
import {
  WorkerEnv,
  formatNairaShort,
  loadAppDataset,
  sanitizeFtsQuery,
} from '../lib/d1Helpers';

export const aiRouter = new Hono<{ Bindings: WorkerEnv }>();

const STOP_WORDS = new Set([
  'show', 'me', 'all', 'the', 'in', 'on', 'by', 'at', 'an', 'as', 'be', 'do', 'for',
  'of', 'and', 'or', 'to', 'from', 'across', 'duplicate', 'duplicates', 'duplicated',
  'repeated', 'identical', 'clone', 'clones', 'cluster', 'clusters',
  'compare', 'what', 'is', 'are', 'how', 'much', 'many', 'find', 'list', 'top',
  'highest', 'most', 'expensive', 'budget', 'projects', 'project', 'items', 'item',
  'spending', 'nigeria', 'federal', 'year', 'years', 'between', 'under', 'above',
  'with', 'about', 'any', 'give', 'tell', 'can', 'you', 'there', 'these', 'those',
  'this', 'that', 'into', 'some', 'selected', 'various', 'different', 'areas',
  'communities', 'phase', 'lot', 'batch', 'stage', 'ongoing', 'new', 'does', 'did',
  'has', 'have', 'was', 'were', 'could', 'would', 'should', 'please', 'contract',
  'contracts', 'contractor', 'contractors', 'award', 'awards', 'awarded', 'payment',
  'payments', 'paid', 'company', 'firm', 'know', 'check', 'debt', 'borrowed', 'spent',
]);

const PRESIDENT_KEYWORDS: Record<string, string> = {
  obasanjo: 'obasanjo',
  yaradua: 'yaradua',
  "yar'adua": 'yaradua',
  jonathan: 'jonathan',
  buhari: 'buhari',
  tinubu: 'tinubu',
};

const NAIRA_MENTION_RE =
  /(?:₦|NGN\s*)(\d[\d,]*(?:\.\d+)?)\s*(Trillion|Billion|Million|T|B|M)?/gi;
const PROJECT_CODE_RE = /\b((?:ERGP|ZIP|P-\d{4}-)[A-Z0-9-]+)\b/gi;
const FILENAME_PAREN_RE =
  /\(\s*[^()\n]*?\b[A-Za-z0-9_./\\-]+\.(?:pdf|json|csv)\b[^()\n]*?\)/gi;
const FILENAME_BARE_RE =
  /["'`]?[A-Za-z0-9_./\\-]*\.(?:pdf|json|csv)\b["'`]?/gi;

export function sanitizePublicAiText(text: string): string {
  if (!text) return '';
  let out = text.replace(FILENAME_PAREN_RE, '').replace(FILENAME_BARE_RE, '');
  out = out
    .replace(/\bNOCOPO\b/gi, 'public procurement')
    .replace(/\bGovSpend\b/gi, 'federal treasury')
    .replace(/\bMTEF\/FSP\b/gi, 'fiscal benchmark')
    .replace(/\bSQL\/FTS5\b/gi, 'fiscal index')
    .replace(/\bBudget Implementation Reports?\b/gi, 'capital execution report');
  return out
    .split('\n')
    .map((line) =>
      line
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\s+([,.;:!?])/g, '$1')
        .trimEnd()
    )
    .join('\n');
}

function parseNairaToken(numStr: string, unitStr: string): number {
  const val = Number.parseFloat(numStr.replace(/,/g, ''));
  const unit = (unitStr || '').trim().toLowerCase();
  if (unit.startsWith('trillion') || unit === 't') return val * 1e12;
  if (unit.startsWith('billion') || unit === 'b') return val * 1e9;
  if (unit.startsWith('million') || unit === 'm') return val * 1e6;
  return val;
}

export function verifyGroundedResponse(
  answerText: string,
  allowedAmounts: number[],
  allowedCodes: Set<string>
): {
  verifiedText: string;
  groundingVerified: boolean;
  rejectedFigures: string[];
  rejectedCodes: string[];
} {
  const rejectedFigures: string[] = [];
  const rejectedCodes: string[] = [];
  let verifiedText = answerText;

  for (const m of answerText.matchAll(NAIRA_MENTION_RE)) {
    const rawExpr = m[0];
    const parsedVal = parseNairaToken(m[1], m[2] || '');
    const isGrounded = allowedAmounts.some(
      (amt) =>
        (amt === 0 && parsedVal === 0) ||
        (amt > 0 && Math.abs(parsedVal - amt) / amt <= 0.02)
    );
    if (!isGrounded) {
      rejectedFigures.push(rawExpr);
      verifiedText = verifiedText.replace(rawExpr, '[UNVERIFIED FIGURE REDACTED]');
    }
  }

  const normAllowed = new Set(
    Array.from(allowedCodes)
      .filter(Boolean)
      .map((c) => c.toUpperCase())
  );
  for (const m of answerText.matchAll(PROJECT_CODE_RE)) {
    const code = m[1];
    if (!normAllowed.has(code.toUpperCase())) {
      rejectedCodes.push(code);
      verifiedText = verifiedText.replace(code, '[UNRETRIEVED CODE REDACTED]');
    }
  }

  return {
    verifiedText,
    groundingVerified: rejectedFigures.length === 0 && rejectedCodes.length === 0,
    rejectedFigures,
    rejectedCodes,
  };
}

function extractSearchKeywords(question: string): string {
  const tokens = (question || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  const filtered = tokens.filter(
    (t) =>
      t.length >= 3 &&
      !STOP_WORDS.has(t) &&
      !/^(1999|20[0-2]\d)$/.test(t) &&
      !(t in PRESIDENT_KEYWORDS)
  );
  return sanitizeFtsQuery(filtered.join(' '));
}

async function handleAiQuery(rawBody: unknown, env: WorkerEnv | undefined) {
  const t0 = Date.now();
  const body = (rawBody || {}) as {
    question?: unknown;
    financialYear?: unknown;
    president?: unknown;
    mode?: unknown;
    scope?: unknown;
  };
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (question.length < 2 || question.length > 400) {
    return {
      status: 400 as const,
      payload: { ok: false, error: 'Question must be between 2 and 400 characters.' },
    };
  }

  const dbBudgets = env?.DB_BUDGETS;
  if (!dbBudgets) {
    return {
      status: 503 as const,
      payload: { available: false, error: 'DB_BUDGETS binding unavailable' },
    };
  }

  const lower = question.toLowerCase();
  const yearMatches = lower.match(/\b(1999|20[0-2]\d)\b/g) || [];
  const explicitYear =
    typeof body.financialYear === 'number' &&
    body.financialYear >= 1999 &&
    body.financialYear <= 2030
      ? body.financialYear
      : null;
  const targetYear =
    explicitYear ?? (yearMatches.length === 1 ? Number.parseInt(yearMatches[0], 10) : null);

  let targetPres: string | null =
    typeof body.president === 'string' &&
    body.president.trim() &&
    body.president.toUpperCase() !== 'ALL'
      ? body.president.trim().toLowerCase()
      : null;
  if (!targetPres) {
    for (const [kw, canonical] of Object.entries(PRESIDENT_KEYWORDS)) {
      if (lower.includes(kw)) {
        targetPres = canonical;
        break;
      }
    }
  }

  const questionForFts =
    targetYear !== null ? question.replace(/\b(1999|20[0-2]\d)\b/g, ' ') : question;
  const ftsExpr = extractSearchKeywords(questionForFts);
  const requestedMode = typeof body.mode === 'string' ? body.mode.trim().toLowerCase() : '';
  const isDuplicateIntent =
    requestedMode === 'duplicates' ||
    /\b(duplicate|duplicates|duplicated|repeated|identical|clones?)\b/i.test(question);

  if (isDuplicateIntent) {
    const dupClauses: string[] = [];
    const dupParams: unknown[] = [];
    if (ftsExpr) {
      dupClauses.push('budget_fts MATCH ?');
      dupParams.push(ftsExpr);
    }
    if (targetYear !== null) {
      dupClauses.push('r.financial_year = ?');
      dupParams.push(targetYear);
    }
    if (targetPres) {
      dupClauses.push('r.president = ?');
      dupParams.push(targetPres);
    }
    const dupWhere = dupClauses.length > 0 ? `WHERE ${dupClauses.join(' AND ')}` : '';
    const dupJoin = ftsExpr
      ? 'FROM budget_fts f JOIN budget_records r ON r.rowid = f.rowid'
      : 'FROM budget_records r';

    const clusterGroupsRes = await dbBudgets
      .prepare(
        `
        SELECT r.project_name, r.mda_name, r.financial_year, r.amount_naira,
               COUNT(*) AS dup_count, SUM(r.amount_naira) AS sum_amt,
               GROUP_CONCAT(r.id, ',') AS row_ids
        ${dupJoin}
        ${dupWhere}
        GROUP BY r.project_name, r.mda_name, r.financial_year, r.amount_naira
        HAVING COUNT(*) >= 2
        ORDER BY sum_amt DESC
        LIMIT 12
        `
      )
      .bind(...dupParams)
      .all<{
        project_name: string;
        mda_name: string;
        financial_year: number;
        amount_naira: number;
        dup_count: number;
        sum_amt: number;
        row_ids: string;
      }>();

    const groups = clusterGroupsRes.results || [];
    const sampleIds = Array.from(
      new Set(
        groups.flatMap((g) => (g.row_ids || '').split(',').filter(Boolean).slice(0, 3))
      )
    ).slice(0, 36);

    const itemById = new Map<
      string,
      {
        id: string;
        code: string;
        title: string;
        amountNaira: number;
        amount: string;
        page: number;
        agency: string;
        year: number;
        sector: string;
        state: string;
        severity: string;
      }
    >();
    if (sampleIds.length > 0) {
      const idPh = sampleIds.map(() => '?').join(', ');
      const detailRes = await dbBudgets
        .prepare(
          `SELECT id, financial_year, project_code, project_name, mda_name, sector, amount_naira, pdf_page, state, severity
           FROM budget_records WHERE id IN (${idPh})`
        )
        .bind(...sampleIds)
        .all<{
          id: string;
          financial_year: number;
          project_code: string;
          project_name: string;
          mda_name: string;
          sector: string;
          amount_naira: number;
          pdf_page: number;
          state: string;
          severity: string;
        }>();
      for (const r of detailRes.results || []) {
        itemById.set(r.id, {
          id: r.id,
          code: r.project_code || 'ERGP',
          title: r.project_name,
          amountNaira: Number(r.amount_naira),
          amount: formatNairaShort(Number(r.amount_naira)),
          page: Number(r.pdf_page),
          agency: r.mda_name,
          year: Number(r.financial_year),
          sector: r.sector,
          state: r.state,
          severity: r.severity,
        });
      }
    }

    const duplicateClusters = groups.map((g, idx) => ({
      clusterId: `DUP-${g.financial_year}-${idx + 1}`,
      canonicalTitle: g.project_name,
      count: Number(g.dup_count),
      totalAmountNaira: Number(g.sum_amt),
      agency: g.mda_name,
      year: Number(g.financial_year),
      items: (g.row_ids || '')
        .split(',')
        .filter(Boolean)
        .map((id) => itemById.get(id))
        .filter((x): x is NonNullable<typeof x> => Boolean(x)),
    }));
    const dupCitations = duplicateClusters.flatMap((cl) => cl.items.slice(0, 2)).slice(0, 12);
    const totalClusterExposure = duplicateClusters.reduce(
      (s, cl) => s + cl.totalAmountNaira,
      0
    );
    const scopeLabel = targetYear ? `FY ${targetYear}` : '1999–2026 schedules';
    const dupAnswer =
      duplicateClusters.length > 0
        ? sanitizePublicAiText(
            `Found ${duplicateClusters.length.toLocaleString()} duplicate cluster(s) in ${scopeLabel} totaling ${formatNairaShort(totalClusterExposure)}.`
          )
        : `No multi-line duplicate clusters matched "${question}"${targetYear ? ` in FY ${targetYear}` : ''}.`;

    const allowedDupAmounts = [
      totalClusterExposure,
      ...duplicateClusters.map((cl) => cl.totalAmountNaira),
      ...dupCitations.map((c) => c.amountNaira),
    ];
    const allowedDupCodes = new Set<string>(
      dupCitations.flatMap((c) => [c.code, c.id])
    );
    const dupGate = verifyGroundedResponse(dupAnswer, allowedDupAmounts, allowedDupCodes);

    return {
      status: 200 as const,
      payload: {
        available: true,
        queryMode: 'duplicates',
        answer: dupGate.verifiedText,
        groundingVerified: dupGate.groundingVerified,
        rejectedFigures: dupGate.rejectedFigures,
        rejectedCodes: dupGate.rejectedCodes,
        citations: dupCitations,
        policyCitations: [],
        duplicateClusters,
        similarItems: [],
        yearBreakdown: [],
        totalMatches: duplicateClusters.length,
        totalExposureNaira: totalClusterExposure,
        datasetsConnected: {
          fts5Sql: true,
        },
        elapsedMs: Date.now() - t0,
      },
    };
  }

  const whereClauses: string[] = [];
  const params: unknown[] = [];

  if (ftsExpr) {
    whereClauses.push('budget_fts MATCH ?');
    params.push(ftsExpr);
  }
  if (targetYear !== null) {
    whereClauses.push('r.financial_year = ?');
    params.push(targetYear);
  }
  if (targetPres) {
    whereClauses.push('r.president = ?');
    params.push(targetPres);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const joinSql = ftsExpr
    ? 'FROM budget_fts f JOIN budget_records r ON r.rowid = f.rowid'
    : 'FROM budget_records r';

  const [aggRow, yearRowsRes, topRowsRes] = await Promise.all([
    dbBudgets
      .prepare(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(r.amount_naira), 0) AS total_amt ${joinSql} ${whereSql}`
      )
      .bind(...params)
      .first<{ cnt: number; total_amt: number }>(),
    dbBudgets
      .prepare(
        `
        SELECT r.financial_year AS year, COUNT(*) AS count, COALESCE(SUM(r.amount_naira), 0) AS total_amt
        ${joinSql}
        ${whereSql}
        GROUP BY r.financial_year
        ORDER BY r.financial_year DESC
        `
      )
      .bind(...params)
      .all<{ year: number; count: number; total_amt: number }>(),
    dbBudgets
      .prepare(
        `
        SELECT r.id, r.financial_year, r.president, r.project_code, r.project_name,
               r.mda_name, r.sector, r.amount_naira, r.pdf_page, r.source_filename,
               r.sha256_hash, r.state, r.severity
        ${joinSql}
        ${whereSql}
        ORDER BY r.amount_naira DESC
        LIMIT 12
        `
      )
      .bind(...params)
      .all<{
        id: string;
        financial_year: number;
        president: string;
        project_code: string;
        project_name: string;
        mda_name: string;
        sector: string;
        amount_naira: number;
        pdf_page: number;
        source_filename: string;
        sha256_hash: string;
        state: string;
        severity: string;
      }>(),
  ]);

  const totalMatches = Number(aggRow?.cnt ?? 0);
  const totalExposure = Number(aggRow?.total_amt ?? 0);
  const yearBreakdown = (yearRowsRes.results || []).map((r) => ({
    year: r.year,
    count: Number(r.count),
    totalNaira: Number(r.total_amt),
  }));
  const citations = (topRowsRes.results || []).map((r) => ({
    id: r.id,
    code: r.project_code || 'ERGP',
    title: r.project_name,
    amountNaira: Number(r.amount_naira),
    amount: formatNairaShort(Number(r.amount_naira)),
    page: Number(r.pdf_page),
    agency: r.mda_name,
    year: Number(r.financial_year),
    sector: r.sector,
    sourceFilename: r.source_filename,
    sha256: r.sha256_hash,
    state: r.state,
    severity: r.severity,
  }));

  const policyCitations: Array<{
    sourceType: string;
    title: string;
    page: number;
    year: number | null;
    excerpt: string;
  }> = [];
  const leadLines: string[] = [];
  const extraAllowedAmounts: number[] = [];

  if (env?.DB_LEDGERS && ftsExpr) {
    const [oaugfRes, policyRes, nocopoAgg, govAgg] = await Promise.all([
      env.DB_LEDGERS.prepare(
        `
        SELECT o.doc_title, o.primary_year, o.page_number, SUBSTR(o.chunk_text, 1, 240) AS excerpt
        FROM oaugf_fts f JOIN oaugf_chunks o ON o.id = f.rowid
        WHERE oaugf_fts MATCH ?
        LIMIT 3
        `
      )
        .bind(ftsExpr)
        .all<{ doc_title: string; primary_year: number | null; page_number: number; excerpt: string }>(),
      env.DB_LEDGERS.prepare(
        `
        SELECT p.doc_title, p.fiscal_year_start, p.page_number, SUBSTR(p.chunk_text, 1, 240) AS excerpt
        FROM policy_fts f JOIN policy_chunks p ON p.id = f.rowid
        WHERE policy_fts MATCH ?
        LIMIT 3
        `
      )
        .bind(ftsExpr)
        .all<{ doc_title: string; fiscal_year_start: number | null; page_number: number; excerpt: string }>(),
      env.DB_LEDGERS.prepare(
        `
        SELECT COUNT(*) AS cnt, COALESCE(SUM(c.contract_award_naira), 0) AS amt
        FROM nocopo_fts f JOIN nocopo_contracts c ON c.rowid = f.rowid
        WHERE nocopo_fts MATCH ?
        `
      )
        .bind(ftsExpr)
        .first<{ cnt: number; amt: number }>(),
      env.DB_LEDGERS.prepare(
        `
        SELECT COUNT(*) AS cnt, COALESCE(SUM(g.amount_naira), 0) AS amt
        FROM govspend_fts f JOIN govspend_payments g ON g.rowid = f.rowid
        WHERE govspend_fts MATCH ?
        `
      )
        .bind(ftsExpr)
        .first<{ cnt: number; amt: number }>(),
    ]);

    for (const o of oaugfRes.results || []) {
      policyCitations.push({
        sourceType: 'OAUGF_AUDIT',
        title: o.doc_title,
        page: Number(o.page_number),
        year: o.primary_year,
        excerpt: o.excerpt,
      });
    }
    for (const p of policyRes.results || []) {
      policyCitations.push({
        sourceType: 'POLICY_BENCHMARK',
        title: p.doc_title,
        page: Number(p.page_number),
        year: p.fiscal_year_start,
        excerpt: p.excerpt,
      });
    }
    if (Number(nocopoAgg?.cnt || 0) > 0) {
      extraAllowedAmounts.push(Number(nocopoAgg!.amt));
      leadLines.push(
        `Procurement Cross-Check: ${Number(nocopoAgg!.cnt).toLocaleString()} public contract awards totaling ${formatNairaShort(Number(nocopoAgg!.amt))}.`
      );
    }
    if (Number(govAgg?.cnt || 0) > 0) {
      extraAllowedAmounts.push(Number(govAgg!.amt));
      leadLines.push(
        `Federal Treasury Disbursements: ${Number(govAgg!.cnt).toLocaleString()} vouchers totaling ${formatNairaShort(Number(govAgg!.amt))}.`
      );
    }
  }

  const scopeDesc = targetYear
    ? `${targetYear}`
    : `${yearBreakdown.length} fiscal years (1999–2026)`;

  if (totalMatches > 0) {
    if (leadLines.length > 0) leadLines.push('');
    leadLines.push(
      `Found ${totalMatches.toLocaleString()} matching budget records across ${scopeDesc} totaling ${formatNairaShort(totalExposure)}.`
    );
    leadLines.push('');
    leadLines.push('Top Matching Items:');
    citations.slice(0, 5).forEach((cit, idx) => {
      leadLines.push(
        `${idx + 1}. ${cit.year} — ${cit.title} (${cit.agency}): ${cit.amount}`
      );
    });
  } else if (leadLines.length === 0) {
    leadLines.push(
      `No matching records were found for "${question}". Try a shorter keyword or a specific ministry or contractor name.`
    );
  }

  const rawAnswer = sanitizePublicAiText(leadLines.join('\n'));
  const allowedAmounts = [
    totalExposure,
    ...citations.map((cit) => cit.amountNaira),
    ...yearBreakdown.map((yb) => yb.totalNaira),
    ...extraAllowedAmounts,
  ];
  const allowedCodes = new Set<string>();
  for (const cit of citations) {
    allowedCodes.add(cit.code);
    allowedCodes.add(cit.id);
    for (const m of String(cit.title || '').matchAll(PROJECT_CODE_RE)) {
      allowedCodes.add(m[1]);
    }
  }
  const gate = verifyGroundedResponse(rawAnswer, allowedAmounts, allowedCodes);

  const hasApp = Boolean(env?.DB_APP);
  const debtLoaded = hasApp
    ? Boolean(await loadAppDataset<unknown>(env?.DB_APP, 'debt_profile'))
    : false;

  return {
    status: 200 as const,
    payload: {
      available: true,
      queryMode: typeof body.mode === 'string' && body.mode ? body.mode : 'hybrid_d1_fts5',
      answer: gate.verifiedText,
      groundingVerified: gate.groundingVerified,
      rejectedFigures: gate.rejectedFigures,
      rejectedCodes: gate.rejectedCodes,
      citations,
      policyCitations,
      duplicateClusters: [],
      similarItems: [],
      yearBreakdown,
      totalMatches,
      totalExposureNaira: totalExposure,
      datasetsConnected: {
        fts5Sql: true,
        oaugfAuditFts: Boolean(env?.DB_LEDGERS),
        nocopoContracts: Boolean(env?.DB_LEDGERS),
        govspendPayments: Boolean(env?.DB_LEDGERS),
        debtProfile: debtLoaded,
      },
      elapsedMs: Date.now() - t0,
    },
  };
}

aiRouter.post('/ai/query', async (c) => {
  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON request body' }, 400);
  }
  const result = await handleAiQuery(parsed, c.env);
  return c.json(result.payload, result.status);
});

aiRouter.post('/ai/retrieve', async (c) => {
  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON request body' }, 400);
  }
  const result = await handleAiQuery(parsed, c.env);
  return c.json(result.payload, result.status);
});
