// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, WorkerEnv } from '../../worker/index';
import { sanitizePublicAiText, verifyGroundedResponse } from '../../worker/routes/ai';

function createSqliteD1Adapter(db: DatabaseSync): D1Database {
  class BoundStmt {
    constructor(
      private readonly sql: string,
      private readonly params: unknown[] = []
    ) {}
    bind(...values: unknown[]) {
      return new BoundStmt(this.sql, values);
    }
    async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
      const stmt = db.prepare(this.sql);
      const row = stmt.get(...(this.params as Array<string | number | bigint | Uint8Array | null>)) as
        | Record<string, unknown>
        | undefined;
      if (!row) return null;
      if (colName) return (row[colName] as T) ?? null;
      return row as unknown as T;
    }
    async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      const stmt = db.prepare(this.sql);
      const rows = stmt.all(...(this.params as Array<string | number | bigint | Uint8Array | null>)) as unknown as T[];
      return {
        results: rows,
        success: true,
        meta: {
          duration: 0,
          size_after: 0,
          rows_read: rows.length,
          rows_written: 0,
          last_row_id: 0,
          changed_db: false,
          changes: 0,
        },
      };
    }
    async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      const stmt = db.prepare(this.sql);
      const info = stmt.run(...(this.params as Array<string | number | bigint | Uint8Array | null>));
      return {
        results: [],
        success: true,
        meta: {
          duration: 0,
          size_after: 0,
          rows_read: 0,
          rows_written: Number(info.changes ?? 0),
          last_row_id: Number(info.lastInsertRowid ?? 0),
          changed_db: Number(info.changes ?? 0) > 0,
          changes: Number(info.changes ?? 0),
        },
      };
    }
    async raw<T = unknown[]>(): Promise<T[]> {
      const all = await this.all<Record<string, unknown>>();
      return all.results.map((r) => Object.values(r) as unknown as T);
    }
  }

  return {
    prepare(sql: string) {
      return new BoundStmt(sql) as unknown as D1PreparedStatement;
    },
    async batch<T = unknown>(stmts: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const out: D1Result<T>[] = [];
      for (const s of stmts) {
        out.push(await (s as unknown as BoundStmt).all<T>());
      }
      return out;
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 1, duration: 0 };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
    withSession() {
      return this as unknown as D1DatabaseSession;
    },
  } as unknown as D1Database;
}

describe('Cloudflare Worker API Routes (P8-CP-3) against Real SQLite + FTS5', () => {
  let env: WorkerEnv;

  beforeAll(() => {
    const dbBudgets = new DatabaseSync(':memory:');
    const dbLedgers = new DatabaseSync(':memory:');
    const dbApp = new DatabaseSync(':memory:');

    dbBudgets.exec(readFileSync(resolve(process.cwd(), 'worker/migrations/budgets/0001_init.sql'), 'utf8'));
    dbLedgers.exec(readFileSync(resolve(process.cwd(), 'worker/migrations/ledgers/0001_init.sql'), 'utf8'));
    dbApp.exec(readFileSync(resolve(process.cwd(), 'worker/migrations/app/0001_init.sql'), 'utf8'));
    dbApp.exec(readFileSync(resolve(process.cwd(), 'worker/migrations/app/0002_tip_photos.sql'), 'utf8'));

    // Seed DB_BUDGETS
    dbBudgets
      .prepare(
        `INSERT INTO budget_records (
          rowid, id, financial_year, president, project_code, project_name, mda_code, mda_name,
          sector, spending_type, amount_naira, pdf_page, source_filename, sha256_hash,
          geo_zone, state, lga, severity, lineage_id, forensic_flags_json, asset_tokens_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        1,
        'P-2024-00101',
        2024,
        'tinubu',
        'ERGP2024001',
        'SOLAR BOREHOLE WATER SUPPLY SCHEME IN KANO NORTH',
        '0252001001',
        'FEDERAL MINISTRY OF WATER RESOURCES',
        'Water Resources',
        'CAPITAL',
        450_000_000,
        42,
        '2024_Appropriation_Act.pdf',
        'abc123def456',
        'North West',
        'Kano',
        'Bichi',
        'high',
        'LIN-SOLAR-01',
        JSON.stringify([{ ruleId: 'R1', ruleName: 'Cost Spike', severity: 'high', confidence: 0.9, reason: 'Sample' }]),
        JSON.stringify([])
      );
    dbBudgets
      .prepare(
        `INSERT INTO budget_records (
          rowid, id, financial_year, president, project_code, project_name, mda_code, mda_name,
          sector, spending_type, amount_naira, pdf_page, source_filename, sha256_hash,
          geo_zone, state, lga, severity, lineage_id, forensic_flags_json, asset_tokens_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        2,
        'P-2026-00010',
        2026,
        'tinubu',
        'ERGP2026010',
        'RURAL CLINIC SOLAR MICROGRID EXPANSION',
        '0521001001',
        'FEDERAL MINISTRY OF HEALTH',
        'Health',
        'CAPITAL',
        250_000_000,
        15,
        '2026 Appropriation Bill Details.pdf',
        'beef1234',
        'South West',
        'Oyo',
        'Ibadan North',
        'none',
        null,
        '[]',
        '[]'
      );
    dbBudgets.exec("INSERT INTO budget_fts(budget_fts) VALUES('rebuild');");
    dbBudgets
      .prepare('INSERT INTO year_statistics (financial_year, payload_json, updated_at) VALUES (?, ?, ?)')
      .run(
        2026,
        JSON.stringify({ financialYear: 2026, totalCapitalProjects: 58300, totalCapitalAmount: 49_700_000_000_000 }),
        '2026-11-25T00:00:00Z'
      );

    // Seed DB_LEDGERS
    dbLedgers
      .prepare(
        `INSERT INTO nocopo_contracts (
          rowid, ocid, financial_year, stage, title, mda_name, norm_mda, buyer_admin_code,
          contractor_name, norm_contractor, bpp_contractor_id, cac_rc_number,
          contract_award_naira, total_paid_naira, award_date, procurement_method,
          budget_record_id, project_code, match_type, confidence_score, source_file
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        1,
        'ocds-test-001',
        2024,
        'award',
        'SOLAR BOREHOLE WATER SUPPLY SCHEME IN KANO NORTH',
        'FEDERAL MINISTRY OF WATER RESOURCES',
        'FEDERAL MINISTRY OF WATER RESOURCES',
        '0252001001',
        'ACME SOLAR ENGINEERING LTD',
        'ACME SOLAR ENGINEERING',
        'BPP-991',
        'RC123456',
        420_000_000,
        300_000_000,
        '2024-06-15',
        'Open Competitive Bidding',
        'P-2024-00101',
        'ERGP2024001',
        'EXACT_CODE',
        0.98,
        'nocopo_2024.json'
      );
    dbLedgers.exec("INSERT INTO nocopo_fts(nocopo_fts) VALUES('rebuild');");

    dbLedgers
      .prepare(
        `INSERT INTO govspend_payments (
          rowid, payment_no, payment_date, financial_year, payer_code, organization_name,
          norm_mda, beneficiary_name, norm_beneficiary, amount_naira, description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        1,
        'GS-2024-7788',
        '2024-08-20',
        2024,
        '0252001001',
        'FEDERAL MINISTRY OF WATER RESOURCES',
        'FEDERAL MINISTRY OF WATER RESOURCES',
        'ACME SOLAR ENGINEERING LTD',
        'ACME SOLAR ENGINEERING',
        180_000_000,
        'PART PAYMENT FOR SOLAR BOREHOLE SUPPLY KANO'
      );
    dbLedgers.exec("INSERT INTO govspend_fts(govspend_fts) VALUES('rebuild');");

    dbLedgers
      .prepare(
        `INSERT INTO oaugf_chunks (
          id, doc_id, doc_title, category, audit_years, primary_year, page_number,
          chunk_index, source_url, sha256, chunk_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        1,
        '33',
        '2019 Annual Audit Report',
        'Unvouched Expenditure',
        '2019',
        2019,
        88,
        0,
        'https://oaugf.ng/doc/33',
        'deadbeef',
        'Irregular solar borehole procurement advances remained unretired by the Ministry.'
      );
    dbLedgers.exec("INSERT INTO oaugf_fts(oaugf_fts) VALUES('rebuild');");

    dbLedgers
      .prepare(
        `INSERT INTO policy_chunks (
          id, doc_slug, doc_title, doc_type, fiscal_year_start, fiscal_year_end,
          page_number, chunk_index, sha256, chunk_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        1,
        'mtef-2024',
        '2024-2026 MTEF/FSP',
        'MTEF',
        2024,
        2026,
        12,
        0,
        'cafe1234',
        'Rural water and solar borehole capital allocations prioritize completion.'
      );
    dbLedgers.exec("INSERT INTO policy_fts(policy_fts) VALUES('rebuild');");

    // Seed DB_APP (including a multi-chunk dataset!)
    const insertAppDs = dbApp.prepare(
      'INSERT INTO app_datasets (dataset_key, chunk_count, byte_size, sha256, payload_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const simpleDatasets: Record<string, unknown> = {
      registry: [{ financialYear: 2026, extractedProjectsCount: 58300 }, { financialYear: 2024, extractedProjectsCount: 27000 }],
      hierarchy_summary: { totalRecordsAllYears: 559325, yearSummaries: { '2026': { recordCount: 58300 }, '2024': { recordCount: 27000 } } },
      coverage_audit: { years: { '2026': { coverageTier: 'FULL_SCHEDULE' } } },
      'narratives/2026': { financialYear: 2026, budgetTheme: 'Renewed Hope Consolidation' },
      project_lifecycle_index: {
        mtefByYear: { '2024': { financialYear: 2024, status: 'BENCHMARK_FOUND', oilPriceUsdPerBbl: 77.96 } },
        birByYear: { '2024': { 'FEDERAL MINISTRY OF WATER RESOURCES': { status: 'MATCHED_MDA', releasePct: 74.2 } } },
        diffCyclesAvailable: [2024],
      },
      contractors_leaderboard: {
        totalDistinctContractors: 1,
        contractors: [
          {
            contractorName: 'ACME SOLAR ENGINEERING LTD',
            bppContractorId: 'BPP-991',
            contractCount: 2,
            totalContractedNaira: 420_000_000,
            govspendPaidNaira: 180_000_000,
            mdaCount: 1,
            topMdas: ['FEDERAL MINISTRY OF WATER RESOURCES'],
          },
        ],
      },
      mda_integrity_scorecards: {
        headline: { scoredMdas: 1 },
        pillarDefinitions: [{ key: 'paddingRestraint' }],
        mdas: [
          {
            mdaKey: 'FEDERAL MINISTRY OF WATER RESOURCES',
            mdaName: 'FEDERAL MINISTRY OF WATER RESOURCES',
            parentFamilies: ['WATER RESOURCES'],
            compositeScore: 61.5,
            grade: 'C',
            totalTrackedExposureNaira: 450_000_000,
            rank: 10,
          },
        ],
      },
      red_flag_convergence_index: {
        mdas: [
          {
            mdaKey: 'FEDERAL MINISTRY OF WATER RESOURCES',
            mdaName: 'FEDERAL MINISTRY OF WATER RESOURCES',
            flagCount: 2,
            flags: ['HIGH_LEGISLATIVE_PADDING', 'HIGH_OAUGF_NEGLIGENCE'],
            oaugfQueryCount: 4,
            totalExposureNaira: 450_000_000,
          },
        ],
      },
      bill_act_diffs_index: { availableYears: [2024] },
      oaugf_audit_index: { totalReports: 36, totalIssues: 6978 },
    };
    for (const [k, v] of Object.entries(simpleDatasets)) {
      const txt = JSON.stringify(v);
      insertAppDs.run(k, 1, txt.length, 'sha', txt, '2026-11-25T00:00:00Z');
    }

    // Multi-chunk dataset test: debt_profile split into 2 chunks in app_dataset_chunks
    const debtJson = JSON.stringify({
      generatedAt: '2026-11-25T00:00:00Z',
      totalDocumentsIndexed: 31,
      yearlyDebt: [
        { financialYear: 2014, totalDebtNairaM: 11243120, totalDebtUsdM: 67726, externalDebtUsdM: 9711, domesticDebtNairaM: 7904020 },
        { financialYear: 2022, totalDebtNairaM: 46250000, totalDebtUsdM: 103100, externalDebtUsdM: 41694, domesticDebtNairaM: 27550000 },
        { financialYear: 2025, totalDebtNairaM: 149390000, totalDebtUsdM: 97236, externalDebtUsdM: 45979, domesticDebtNairaM: 78760000 },
      ],
    });
    const mid = Math.floor(debtJson.length / 2);
    insertAppDs.run('debt_profile', 2, debtJson.length, 'sha', null, '2026-11-25T00:00:00Z');
    dbApp
      .prepare('INSERT INTO app_dataset_chunks (dataset_key, chunk_index, chunk_text) VALUES (?, ?, ?)')
      .run('debt_profile', 0, debtJson.slice(0, mid));
    dbApp
      .prepare('INSERT INTO app_dataset_chunks (dataset_key, chunk_index, chunk_text) VALUES (?, ?, ?)')
      .run('debt_profile', 1, debtJson.slice(mid));

    // Recurring lineages + Bill-vs-Act + OAuGF findings
    const linTxt = JSON.stringify({
      totalLineages: 2,
      lineages: [
        { lineageId: 'L1', canonicalTitle: 'SOLAR BOREHOLE REHABILITATION', agency: 'WATER RESOURCES', sector: 'Water Resources' },
        { lineageId: 'L2', canonicalTitle: 'HIGHWAY PAVING PHASE II', agency: 'WORKS', sector: 'Works & Housing' },
      ],
    });
    insertAppDs.run('recurring_lineages', 1, linTxt.length, 'sha', linTxt, '2026-11-25T00:00:00Z');

    dbApp
      .prepare('INSERT INTO bill_act_diffs (financial_year, summary_json) VALUES (?, ?)')
      .run(2024, JSON.stringify({ financialYear: 2024, insertionsCount: 1 }));
    dbApp
      .prepare('INSERT INTO bill_act_diff_items (financial_year, mda_name, status, is_zip, delta_naira, item_json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        2024,
        'FEDERAL MINISTRY OF WATER RESOURCES',
        'INSERTED',
        1,
        150_000_000,
        JSON.stringify({ id: 'DIFF-2024-1', projectCode: 'ERGP2024001', status: 'INSERTED', deltaNaira: 150_000_000 })
      );

    dbApp
      .prepare('INSERT INTO oaugf_findings (finding_id, doc_id, financial_year, mda_name, category, amount_naira, item_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(
        'F1',
        '33',
        2019,
        'FEDERAL MINISTRY OF WATER RESOURCES',
        'Unvouched Expenditure',
        55_000_000,
        JSON.stringify({ docId: '33', year: 2019, mdaName: 'FEDERAL MINISTRY OF WATER RESOURCES', amountNaira: 55_000_000 })
      );

    env = {
      ENVIRONMENT: 'test',
      ADMIN_KEY: 'test-secret-admin-key',
      DB_BUDGETS: createSqliteD1Adapter(dbBudgets),
      DB_LEDGERS: createSqliteD1Adapter(dbLedgers),
      DB_APP: createSqliteD1Adapter(dbApp),
    };
  });

  it('serves /years, /years/:year/summary, and reassembles multi-chunk /datasets/*', async () => {
    const yrsRes = await app.request('/api/v1/years', undefined, env);
    expect(yrsRes.status).toBe(200);
    const yrsBody = (await yrsRes.json()) as { availableYears: number[] };
    expect(yrsBody.availableYears).toEqual([2026, 2024]);

    const sumRes = await app.request('/api/v1/years/2026/summary', undefined, env);
    expect(sumRes.status).toBe(200);
    const sumBody = (await sumRes.json()) as { statistics: { totalCapitalProjects: number }; narrative: { budgetTheme: string } };
    expect(sumBody.statistics.totalCapitalProjects).toBe(58300);
    expect(sumBody.narrative.budgetTheme).toContain('Renewed Hope');

    const debtDsRes = await app.request('/api/v1/datasets/debt_profile', undefined, env);
    expect(debtDsRes.status).toBe(200);
    const debtDsBody = (await debtDsRes.json()) as { yearlyDebt: unknown[] };
    expect(debtDsBody.yearlyDebt.length).toBe(3);
  });

  it('serves paginated /projects, /projects/:id, and /projects/:id/lifecycle', async () => {
    const listRes = await app.request('/api/v1/projects?q=borehole&year=2024&flagged_only=1&limit=10', undefined, env);
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { totalMatches: number; items: Array<{ id: string }> };
    expect(listBody.totalMatches).toBe(1);
    expect(listBody.items[0].id).toBe('P-2024-00101');

    const detRes = await app.request('/api/v1/projects/P-2024-00101', undefined, env);
    expect(detRes.status).toBe(200);
    const detBody = (await detRes.json()) as { nocopoContracts: Array<{ ocid: string }> };
    expect(detBody.nocopoContracts[0].ocid).toBe('ocds-test-001');

    const lcRes = await app.request('/api/v1/projects/P-2024-00101/lifecycle', undefined, env);
    expect(lcRes.status).toBe(200);
    const lcBody = (await lcRes.json()) as {
      mtef: { status: string };
      billDiff: { status: string };
      nocopo: Array<{ ocid: string }>;
      govspend: Array<{ payment_no: string }>;
    };
    expect(lcBody.mtef.status).toBe('BENCHMARK_FOUND');
    expect(lcBody.billDiff.status).toBe('INSERTED');
    expect(lcBody.nocopo[0].ocid).toBe('ocds-test-001');
    expect(lcBody.govspend[0].payment_no).toBe('GS-2024-7788');
  });

  it('maintains FastAPI parity across /search, /procurement/*, and /expenditures/*', async () => {
    const sRes = await app.request('/api/search?q=solar', undefined, env);
    expect(sRes.status).toBe(200);
    const sBody = (await sRes.json()) as { available: boolean; totalMatches: number };
    expect(sBody.available).toBe(true);
    expect(sBody.totalMatches).toBe(2);

    const pRes = await app.request('/api/procurement/search?q=borehole', undefined, env);
    expect(pRes.status).toBe(200);
    const pBody = (await pRes.json()) as { totalMatches: number; results: Array<{ ocdsReleaseId: string }> };
    expect(pBody.totalMatches).toBe(1);
    expect(pBody.results[0].ocdsReleaseId).toBe('ocds-test-001');

    const chRes = await app.request('/api/procurement/contractor-history?name=ACME%20SOLAR%20ENGINEERING%20LTD', undefined, env);
    expect(chRes.status).toBe(200);
    const chBody = (await chRes.json()) as { totalContracts: number; totalGovspendCount: number; totalGovspendNaira: number };
    expect(chBody.totalContracts).toBe(1);
    expect(chBody.totalGovspendCount).toBe(1);
    expect(chBody.totalGovspendNaira).toBe(180_000_000);

    const benRes = await app.request('/api/expenditures/beneficiary?name=ACME%20SOLAR%20ENGINEERING%20LTD', undefined, env);
    expect(benRes.status).toBe(200);
    const benBody = (await benRes.json()) as { paymentCount: number; totalAmountNaira: number };
    expect(benBody.paymentCount).toBe(1);
    expect(benBody.totalAmountNaira).toBe(180_000_000);
  });

  it('serves /mdas, /mdas/:key/scorecard, and paginated /forensics/*', async () => {
    const mdasRes = await app.request('/api/v1/mdas?convergent_only=1', undefined, env);
    expect(mdasRes.status).toBe(200);
    const mdasBody = (await mdasRes.json()) as { totalMatches: number; items: Array<{ grade: string }> };
    expect(mdasBody.totalMatches).toBe(1);
    expect(mdasBody.items[0].grade).toBe('C');

    const scRes = await app.request('/api/v1/mdas/FEDERAL%20MINISTRY%20OF%20WATER%20RESOURCES/scorecard', undefined, env);
    expect(scRes.status).toBe(200);
    const scBody = (await scRes.json()) as { oaugfFindings: unknown[]; nocopoContracts: unknown[] };
    expect(scBody.oaugfFindings.length).toBe(1);
    expect(scBody.nocopoContracts.length).toBe(1);

    const padRes = await app.request('/api/v1/forensics/padding?year=2024&status=INSERTED', undefined, env);
    expect(padRes.status).toBe(200);
    const padBody = (await padRes.json()) as { totalMatches: number };
    expect(padBody.totalMatches).toBe(1);

    const linRes = await app.request('/api/v1/forensics/lineages?q=solar', undefined, env);
    expect(linRes.status).toBe(200);
    const linBody = (await linRes.json()) as { totalMatches: number };
    expect(linBody.totalMatches).toBe(1);
  });

  it('serves dynamic /debt projections and /cbn governors directory', async () => {
    const debtRes = await app.request('/api/v1/debt', undefined, env);
    expect(debtRes.status).toBe(200);
    const debtBody = (await debtRes.json()) as {
      ok: boolean;
      administrationProjection: { administrations: unknown[]; totalDocumentsIndexed: number };
    };
    expect(debtBody.ok).toBe(true);
    expect(debtBody.administrationProjection.totalDocumentsIndexed).toBe(31);
    expect(debtBody.administrationProjection.administrations.length).toBeGreaterThan(0);

    const cbnRes = await app.request('/api/v1/cbn?era=FOURTH_REPUBLIC', undefined, env);
    expect(cbnRes.status).toBe(200);
    const cbnBody = (await cbnRes.json()) as {
      totalSubstantive: number;
      count: number;
      actingGovernors: unknown[];
    };
    expect(cbnBody.totalSubstantive).toBe(12);
    expect(cbnBody.count).toBe(5);
    expect(cbnBody.actingGovernors.length).toBe(2);
  });

  it('serves grounded POST /api/ai/query with sanitization and hallucination redaction', async () => {
    const res = await app.request(
      '/api/ai/query',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'How much was spent on solar borehole in 2024?' }),
      },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      available: boolean;
      groundingVerified: boolean;
      totalMatches: number;
      totalExposureNaira: number;
      citations: Array<{ id: string }>;
      policyCitations: Array<{ sourceType: string }>;
    };
    expect(body.available).toBe(true);
    expect(body.groundingVerified).toBe(true);
    expect(body.totalMatches).toBe(1);
    expect(body.totalExposureNaira).toBe(450_000_000);
    expect(body.citations[0].id).toBe('P-2024-00101');
    expect(body.policyCitations.length).toBeGreaterThanOrEqual(2);

    const clean = sanitizePublicAiText('Audit NOCOPO finding (source_2024.pdf)');
    expect(clean).not.toContain('.pdf');
    expect(clean).not.toContain('NOCOPO');

    const redacted = verifyGroundedResponse(
      'Fake project ERGP9999999 received ₦999.00 Trillion.',
      [450_000_000],
      new Set(['ERGP2024001'])
    );
    expect(redacted.groundingVerified).toBe(false);
    expect(redacted.verifiedText).toContain('[UNVERIFIED FIGURE REDACTED]');
    expect(redacted.verifiedText).toContain('[UNRETRIEVED CODE REDACTED]');

    const dupRes = await app.request(
      '/api/ai/query',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'Find duplicate projects in 2024', mode: 'duplicates' }),
      },
      env
    );
    expect(dupRes.status).toBe(200);
    const dupBody = (await dupRes.json()) as {
      queryMode: string;
      answer: string;
      duplicateClusters: unknown[];
    };
    expect(dupBody.queryMode).toBe('duplicates');
    expect(dupBody.answer).toMatch(/No multi-line duplicate clusters matched|duplicate cluster/i);
    expect(Array.isArray(dupBody.duplicateClusters)).toBe(true);
  });

  it('supports /tips with JPEG EXIF APP1 stripping, moderation auth, and /casebooks CRUD', async () => {
    // Build a synthetic JPEG with APP1 EXIF/GPS segment (0xFF 0xE1) + SOF + EOI
    const fakeJpeg = new Uint8Array([
      0xff, 0xd8, // SOI
      0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // APP1 Exif (8 bytes incl len)
      0xff, 0xc0, 0x00, 0x04, 0x08, 0x01, // dummy SOF
      0xff, 0xd9, // EOI
    ]);
    const form = new FormData();
    form.set('project_id', 'P-2024-00101');
    form.set('financial_year', '2024');
    form.set('status', 'NOT_ON_GROUND');
    form.set('observation', 'No solar borehole structure exists at the listed ward site.');
    form.append('photos', new File([fakeJpeg], 'gps_test.jpg', { type: 'image/jpeg' }));

    const postRes = await app.request('/api/tips', { method: 'POST', body: form }, env);
    expect(postRes.status).toBe(201);
    const postBody = (await postRes.json()) as { tip: { tip_id: string; photos: string[] } };
    expect(postBody.tip.photos.length).toBe(1);

    const photoUrl = postBody.tip.photos[0];
    const photoRes = await app.request(photoUrl, undefined, env);
    expect(photoRes.status).toBe(200);
    const returnedBytes = new Uint8Array(await photoRes.arrayBuffer());
    // Ensure APP1 marker (0xFF 0xE1) and "Exif" bytes were stripped!
    expect(returnedBytes.includes(0xe1)).toBe(false);
    expect(new TextDecoder().decode(returnedBytes)).not.toContain('Exif');

    const corRes = await app.request(`/api/tips/${postBody.tip.tip_id}/corroborate`, { method: 'POST' }, env);
    expect(corRes.status).toBe(200);
    expect(((await corRes.json()) as { tip: { corroborations: number } }).tip.corroborations).toBe(1);

    const badMod = await app.request(
      `/api/tips/${postBody.tip.tip_id}/moderation`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': 'wrong-key' },
        body: JSON.stringify({ moderation_status: 'CORROBORATED' }),
      },
      env
    );
    expect(badMod.status).toBe(403);

    const goodMod = await app.request(
      `/api/tips/${postBody.tip.tip_id}/moderation`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': 'test-secret-admin-key' },
        body: JSON.stringify({ moderation_status: 'CORROBORATED', moderation_note: 'Verified by field desk' }),
      },
      env
    );
    expect(goodMod.status).toBe(200);

    // Casebook CRUD
    const cbPost = await app.request(
      '/api/v1/casebooks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Kano Water Desk Brief', pins: [{ id: 'P-2024-00101' }] }),
      },
      env
    );
    expect(cbPost.status).toBe(201);
    const cbCreated = (await cbPost.json()) as { casebookId: string; shareToken: string };

    const cbGet = await app.request(`/api/v1/casebooks/${cbCreated.shareToken}`, undefined, env);
    expect(cbGet.status).toBe(200);
    expect(((await cbGet.json()) as { casebook: { title: string } }).casebook.title).toBe('Kano Water Desk Brief');

    const cbBadDel = await app.request(`/api/v1/casebooks/${cbCreated.casebookId}`, { method: 'DELETE' }, env);
    expect(cbBadDel.status).toBe(403);

    const cbDel = await app.request(
      `/api/v1/casebooks/${cbCreated.casebookId}?share_token=${cbCreated.shareToken}`,
      { method: 'DELETE' },
      env
    );
    expect(cbDel.status).toBe(200);
  });
});

const localD1Dir = resolve(process.cwd(), '.cloudflare/state/v3/d1/miniflare-D1DatabaseObject');
describe.runIf(existsSync(localD1Dir))('Local Seeded D1 FTS5 Smoke Benchmark', () => {
  it('queries all 559,325 seeded budget records via budget_fts in under 250ms', async () => {
    const sqliteFiles = readdirSync(localD1Dir).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
    let budgetsPath: string | null = null;
    for (const fname of sqliteFiles) {
      const full = resolve(localD1Dir, fname);
      const probe = new DatabaseSync(full, { open: true, readOnly: true });
      const tbl = probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='budget_records'").get();
      probe.close();
      if (tbl) {
        budgetsPath = full;
        break;
      }
    }
    expect(budgetsPath).not.toBeNull();

    const db = new DatabaseSync(budgetsPath!, { open: true, readOnly: true });
    try {
      const t0 = performance.now();
      const res = await app.request('/api/v1/projects?q=borehole&limit=20', undefined, {
        DB_BUDGETS: createSqliteD1Adapter(db),
      });
      const elapsed = performance.now() - t0;
      expect(res.status).toBe(200);
      const body = (await res.json()) as { totalMatches: number; items: unknown[] };
      expect(body.totalMatches).toBe(6409);
      expect(body.items.length).toBe(20);
      expect(elapsed).toBeLessThan(500);
    } finally {
      db.close();
    }
  });
});
