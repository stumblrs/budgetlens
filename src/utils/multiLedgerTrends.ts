/**
 * 28-Year Multi-Ledger Trajectory Builder & Presidential Cross-Ledger Formatters
 * (Phase 6 · Stage P6-C / Checkpoint P6-CP-3).
 *
 * Joins 5 official static datasets over FY 1999–2026:
 *   1. Enacted Federal Appropriations (`HISTORICAL_MACRO_DATA`)
 *   2. DMO Public Debt Stock (`debt_profile.json`)
 *   3. BIR Macro Credibility & Debt Service Execution (`macro_credibility_tracker.json`)
 *   4. Evidence Engine v3.0 Flagged Spend & Findings (`evidence_engine_all_years.json`)
 *   5. OAuGF Constitutional Audit Findings (`oaugf_audit_index.json`)
 */

import { getMacroForYear } from '../data/historicalMacroData';
import { getPresidentForYear } from '../data/presidentialTerms';
import type { DmoYearRow } from './administrationDebt';
import type { EvidenceEngineAllYearsPayload } from './evidenceEngineV3';
import type { MacroCredibilityTrackerPayload } from './mdaScorecard';

export interface MultiLedgerTrendPoint {
  year: number;
  presidentId: string;
  presidentName: string;
  shortName: string;
  party: string;
  accentColor: string;
  enactedBudgetTn: number;
  capitalBudgetTn: number;
  capitalSharePct: number;
  dmoDebtTn: number | null;
  dmoDebtUsdBn: number | null;
  birCapitalExecPct: number | null;
  birDebtServiceExecPct: number | null;
  birRevenueExecPct: number | null;
  birDebtOverrun: boolean;
  birIsPartialYear: boolean;
  eeFlaggedSpendTn: number;
  eeRuleFindingsCount: number;
  eeCrossLedgerFindingsCount: number;
  oaugfFindingsCount: number | null;
  oaugfReportsCount: number;
}

export interface PresidentCrossLedgerSummary {
  oaugf: {
    reportsCount: number;
    yearsAudited: number[];
    issuesCount: number;
    repeatNeglectCount: number;
    recoveryDirectiveCount: number;
    totalQueriedNaira: number;
    totalQueriedUsd: number;
  };
  legislativePadding: {
    cyclesCount: number;
    cyclesYears: number[];
    lineItemScheduleCyclesCount: number;
    insertionsCount: number;
    insertionsTotalNaira: number;
    insertionsTotalUsd: number;
    inflatedCount: number;
    inflatedTotalNaira: number;
    zipCount: number;
    zipTotalNaira: number;
  };
  openTreasury: {
    yearsCovered: number[];
    totalDisbursedNaira: number;
    decemberVoucherCount: number;
    decemberNaira: number;
    avgDecemberRushRatio: number | null;
  };
  evidenceEngineV3: {
    flaggedProjectsCount: number;
    totalRuleFindingsCount: number;
    crossLedgerFindingsCount: number;
    flaggedAmountNaira: number;
    duplicateClustersCount: number;
  };
}

export interface OaugfDocumentMeta {
  years?: number[];
  issueCount?: number;
}

export interface BuildMultiLedgerSeriesInput {
  debtRows?: DmoYearRow[] | null;
  macroCredibility?: MacroCredibilityTrackerPayload | null;
  evidenceAllYears?: EvidenceEngineAllYearsPayload | null;
  oaugfDocuments?: OaugfDocumentMeta[] | null;
  startYear?: number;
  endYear?: number;
}

function formatCompactNairaAscii(amt: number): string {
  if (!Number.isFinite(amt) || amt === 0) return '₦0';
  const abs = Math.abs(amt);
  if (abs >= 1e12) return `₦${(amt / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `₦${(amt / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `₦${(amt / 1e6).toFixed(1)}M`;
  return `₦${Math.round(amt).toLocaleString('en-US')}`;
}

/**
 * Formats Legislative Bill->Act insertion metrics safely across pre-2017 and post-2017 eras.
 */
export function formatPresidentialBillPadding(
  prof: PresidentCrossLedgerSummary | null | undefined
): string {
  if (!prof) return 'Loading...';
  const lp = prof.legislativePadding;
  if (!lp || lp.cyclesCount === 0) {
    return 'N/A (Pre-2017)';
  }
  const nairaLabel = formatCompactNairaAscii(lp.insertionsTotalNaira);
  return `${nairaLabel} (${lp.insertionsCount.toLocaleString('en-US')} ins.)`;
}

/**
 * Formats Open Treasury Cash & December Rush metrics safely across pre-2018 and post-2018 eras.
 */
export function formatPresidentialOpenTreasury(
  prof: PresidentCrossLedgerSummary | null | undefined
): string {
  if (!prof) return 'Loading...';
  const ot = prof.openTreasury;
  if (!ot || !Array.isArray(ot.yearsCovered) || ot.yearsCovered.length === 0) {
    return 'N/A (Pre-2018)';
  }
  const cashLabel = formatCompactNairaAscii(ot.totalDisbursedNaira);
  const rushLabel =
    typeof ot.avgDecemberRushRatio === 'number' && Number.isFinite(ot.avgDecemberRushRatio)
      ? ` · ${ot.avgDecemberRushRatio.toFixed(2)}x Dec`
      : '';
  return `${cashLabel}${rushLabel}`;
}

/**
 * Builds deterministic yearly cross-ledger trajectory rows (default 1999..2026)
 * without fabricating historical zeroes for uncovered DMO, BIR, or OAuGF eras.
 */
export function buildMultiLedgerYearSeries(
  input: BuildMultiLedgerSeriesInput
): MultiLedgerTrendPoint[] {
  const startYear = input.startYear ?? 1999;
  const endYear = input.endYear ?? 2026;

  const debtByYear = new Map<number, DmoYearRow>();
  for (const row of input.debtRows || []) {
    if (Number.isFinite(row.financialYear)) {
      debtByYear.set(row.financialYear, row);
    }
  }

  const birByYear = new Map(
    (input.macroCredibility?.yearlySeries || []).map((y) => [y.financialYear, y])
  );

  const eeByYear = new Map(
    (input.evidenceAllYears?.byYear || []).map((y) => [y.financialYear, y])
  );

  // Attribute each OAuGF audit report once to its latest audited year so multi-year reports are not double-counted
  const oaugfByYear = new Map<number, { findings: number; reports: number }>();
  for (const doc of input.oaugfDocuments || []) {
    const yrs = (doc.years || []).filter((y) => Number.isFinite(y));
    if (yrs.length === 0) continue;
    const targetYear = Math.max(...yrs);
    const prev = oaugfByYear.get(targetYear) || { findings: 0, reports: 0 };
    prev.findings += Number(doc.issueCount) || 0;
    prev.reports += 1;
    oaugfByYear.set(targetYear, prev);
  }

  const points: MultiLedgerTrendPoint[] = [];
  for (let yr = startYear; yr <= endYear; yr++) {
    const macro = getMacroForYear(yr);
    const pres = getPresidentForYear(yr);
    const debt = debtByYear.get(yr);
    const birRow = birByYear.get(yr);
    const eeRow = eeByYear.get(yr);
    const oaugfRow = oaugfByYear.get(yr);

    const enactedBudgetTn =
      macro.officialTotalBudget > 0 ? Number((macro.officialTotalBudget / 1e12).toFixed(3)) : 0;
    const capitalBudgetTn =
      macro.totalCapitalBudget > 0 ? Number((macro.totalCapitalBudget / 1e12).toFixed(3)) : 0;
    const capitalSharePct =
      macro.officialTotalBudget > 0
        ? Number(((macro.totalCapitalBudget / macro.officialTotalBudget) * 100).toFixed(1))
        : 0;

    const dmoDebtTn =
      typeof debt?.totalDebtNairaM === 'number' && Number.isFinite(debt.totalDebtNairaM)
        ? Number((debt.totalDebtNairaM / 1e6).toFixed(2))
        : null;
    const dmoDebtUsdBn =
      typeof debt?.totalDebtUsdM === 'number' && Number.isFinite(debt.totalDebtUsdM)
        ? Number((debt.totalDebtUsdM / 1e3).toFixed(2))
        : null;

    const birCapitalExecPct =
      typeof birRow?.bir?.capitalPerformancePct === 'number' &&
      Number.isFinite(birRow.bir.capitalPerformancePct)
        ? Number(birRow.bir.capitalPerformancePct.toFixed(1))
        : null;
    const birDebtServiceExecPct =
      typeof birRow?.bir?.debtServicePerformancePct === 'number' &&
      Number.isFinite(birRow.bir.debtServicePerformancePct)
        ? Number(birRow.bir.debtServicePerformancePct.toFixed(1))
        : null;
    const birRevenueExecPct =
      typeof birRow?.bir?.revenuePerformancePct === 'number' &&
      Number.isFinite(birRow.bir.revenuePerformancePct)
        ? Number(birRow.bir.revenuePerformancePct.toFixed(1))
        : null;

    const eeFlaggedSpendTn =
      typeof eeRow?.flaggedAmountNaira === 'number' && Number.isFinite(eeRow.flaggedAmountNaira)
        ? Number((eeRow.flaggedAmountNaira / 1e12).toFixed(3))
        : 0;

    points.push({
      year: yr,
      presidentId: pres.presidentId,
      presidentName: pres.presidentName,
      shortName: pres.presidentName.split(' ').slice(-1)[0],
      party: pres.party,
      accentColor: pres.accentColor,
      enactedBudgetTn,
      capitalBudgetTn,
      capitalSharePct,
      dmoDebtTn,
      dmoDebtUsdBn,
      birCapitalExecPct,
      birDebtServiceExecPct,
      birRevenueExecPct,
      birDebtOverrun: Boolean(birRow?.bir?.debtServiceOverrunFlag),
      birIsPartialYear: Boolean(birRow?.isPartialYearReport),
      eeFlaggedSpendTn,
      eeRuleFindingsCount: eeRow?.ruleFindingsCount || 0,
      eeCrossLedgerFindingsCount: eeRow?.crossLedgerFindingsCount || 0,
      oaugfFindingsCount: oaugfRow && oaugfRow.reports > 0 ? oaugfRow.findings : null,
      oaugfReportsCount: oaugfRow?.reports || 0,
    });
  }

  return points;
}
