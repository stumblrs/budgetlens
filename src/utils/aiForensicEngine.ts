/**
 * Multi-Dataset Knowledge, Duplicate Cluster & Similar-Item Engine for BudgetLens AI.
 * Connects active-year records, 28-year precomputed statistical forensics, cross-year static
 * search index, Bill-vs-Act padding diffs, BIR execution releases, macro terms, and constituencies.
 */

import type { BudgetRecord } from '../services/budgetDatabaseEngine';
import type { DuplicateCluster } from './duplicateDetector';
import { detectDuplicates } from './duplicateDetector';
import { getPresidentForYear } from '../data/presidentialTerms';
import { getMacroForYear } from '../data/historicalMacroData';
import {
  TOTAL_FEDERAL_CONSTITUENCIES,
  TOTAL_SENATORIAL_DISTRICTS,
  lookupConstituency,
} from '../data/constituenciesDirectory';
import type { PrecomputedStatisticalForensics } from './statisticalForensics';
import { fetchDataset } from '../services/apiClient';

export type AiInvestigationMode =
  | 'all'
  | 'duplicates'
  | 'similar'
  | 'padding'
  | 'forensics'
  | 'execution'
  | 'scorecard'
  | 'procurement_risk'
  | 'cash_forensics'
  | 'vendor_capture'
  | 'follow_money'
  | 'oaugf_audit'
  | 'evidence_engine'
  | 'convergence'
  | 'presidential';

export interface AiCitationItem {
  id?: string;
  code: string;
  title: string;
  amount: string;
  amountNaira?: number;
  page: number;
  agency: string;
  year?: number;
  sector?: string;
  state?: string;
  similarityPct?: number;
  sharedTokens?: string[];
  gemmaReview?: Record<string, unknown> | null;
}

export interface AiDuplicateCluster {
  clusterId: string;
  canonicalTitle: string;
  matchType: string;
  patternType: string;
  count: number;
  totalAmountNaira: number;
  totalAmountFormatted: string;
  distinctAgencies: number;
  agencies: string[];
  years: number[];
  items: AiCitationItem[];
}

export interface SupplementalDatasetsBundle {
  paddingIndex: {
    cyclesCount: number;
    cycles: Array<{
      financialYear: number;
      comparisonScope: string;
      billItemCount: number;
      actItemCount: number;
      billTotalNaira: number;
      actTotalNaira: number;
      insertionsCount: number;
      insertionsTotalNaira: number;
      inflatedCount: number;
      inflatedTotalNaira: number;
      cutCount: number;
      cutTotalNaira: number;
      zipCount: number;
      zipTotalNaira: number;
      topPaddedMdas?: Array<{
        mdaName: string;
        insertionsNaira: number;
        inflatedDeltaNaira: number;
        totalPositivePaddingNaira: number;
      }>;
    }>;
  } | null;
  executionTracker: {
    verifiedYears: number[];
    years: Array<{
      financialYear: number;
      reportTitle: string;
      mdaCount: number;
      totalAppropriatedNaira: number;
      totalReleasedNaira: number | null;
      overallReleasePct: number;
      mdaBreakdown?: Array<{
        mdaName: string;
        appropriatedNaira: number;
        releasedNaira: number | null;
        releasePct: number;
        page: number;
      }>;
    }>;
  } | null;
  staticSearchRecords: Array<{
    id: string;
    financialYear: number;
    president?: string;
    projectCode: string;
    projectName: string;
    agency: string;
    sector: string;
    amount: number;
    page: number;
    state?: string;
  }>;
  mdaScorecards?: {
    headline?: {
      totalScoredMdas?: number;
      full5PillarCount?: number;
      strong4PlusPillarCount?: number;
      medianCompositeScore?: number;
      meanCompositeScore?: number;
    };
    mdas?: Array<{
      rank?: number;
      mdaName: string;
      compositeScore: number;
      grade: string;
      metricsPresent: number;
      totalTrackedExposureNaira: number;
    }>;
  } | null;
  macroCredibility?: {
    headline?: {
      birYearsCount?: number;
      yearRange?: string;
      meanCapitalPerformancePct?: number;
      meanRevenuePerformancePct?: number;
      meanDebtServicePerformancePct?: number;
      debtServiceOverrunYearsCount?: number;
      cumulativeDebtServiceOverrunNaira?: number;
    };
    yearlySeries?: Array<{
      financialYear: number;
      presidentName?: string;
      overallReleasePct?: number;
      bir?: {
        revenuePerformancePct?: number | null;
        capitalPerformancePct?: number | null;
        debtServicePerformancePct?: number | null;
        debtServiceOverrunNaira?: number | null;
      };
    }>;
  } | null;
  procurementRisk?: {
    headline?: {
      totalAwardedRows?: number;
      totalAwardedNaira?: number;
      planningExcludedCount?: number;
      nonCompetitiveCount?: number;
      nonCompetitiveAwardedNaira?: number;
      nonCompetitiveValueSharePct?: number;
      overrunCount?: number;
      overrunDeltaNaira?: number;
      zeroPaidCount?: number;
      zeroPaidAwardedNaira?: number;
    };
    topOverrunContracts?: Array<{
      title?: string;
      mdaName?: string;
      contractorName?: string;
      awardNaira?: number;
      paidNaira?: number;
      overrunDeltaNaira?: number;
      projectCode?: string;
    }>;
    topNonCompetitiveAwards?: Array<{
      title?: string;
      mdaName?: string;
      contractorName?: string;
      procurementMethod?: string;
      awardNaira?: number;
      projectCode?: string;
    }>;
  } | null;
  govspendForensics?: {
    headline?: {
      totalVouchers?: number;
      totalNaira?: number;
      december2019To2025Vouchers?: number;
      december2019To2025Naira?: number;
      decemberRushRatio2019To2025?: number;
      nearThresholdVoucherCount?: number;
      nearThresholdNaira?: number;
      rolling7DayClusterCount?: number;
      rolling7DayClusterNaira?: number;
      benford1DMad?: number;
      benford1DBand?: string;
      benford2DMad?: number;
    };
    decemberRush?: {
      topDecemberRushMdas?: Array<{
        organizationName?: string;
        decemberNaira?: number;
        decemberSharePct?: number;
        decemberRushRatio?: number;
      }>;
    };
    thresholdSplitting?: {
      topRolling7DayClusters?: Array<{
        startDate?: string;
        endDate?: string;
        organizationName?: string;
        beneficiaryName?: string;
        voucherCount?: number;
        totalNaira?: number;
      }>;
    };
  } | null;
  vendorNetwork?: {
    headline?: {
      captivePairCount?: number;
      captivePairAwardedNaira?: number;
      multiMdaContractorCount?: number;
      overpaid125Count?: number;
      overpaid125NocopoAwardedNaira?: number;
      overpaid125GovspendPaidNaira?: number;
      overpaid125ExcessNaira?: number;
      offNocopoPrivateCount?: number;
      offNocopoPrivatePaidNaira?: number;
      offNocopoPrivateBillionPlusCount?: number;
    };
    captivePairs?: Array<{
      mdaName?: string;
      contractorName?: string;
      shareOfMdaPct?: number;
      pairAwardedNaira?: number;
    }>;
    offNocopoAudit?: {
      topOffNocopoPrivateVendors?: Array<{
        beneficiaryName?: string;
        voucherCount?: number;
        totalPaidNaira?: number;
      }>;
    };
  } | null;
  followTheMoney?: {
    summary?: {
      diffMatchedAwardedCount?: number;
      diffTotalAwardedNaira?: number;
      diffTotalNocopoDisbursedNaira?: number;
      diffPositivePaddingAwardedCount?: number;
      diffPositivePaddingAwardedNaira?: number;
      diffNonCompetitiveAwardCount?: number;
      lineagesScanned?: number;
      lineageClassificationCounts?: Record<string, number>;
    };
  } | null;
  oaugfAudit?: {
    headline?: {
      reportsIndexed?: number;
      totalPages?: number;
      parsedAuditIssuesCount?: number;
      matchedMdasCount?: number;
      categoryCounts?: Record<string, number>;
    };
    byMda?: Record<
      string,
      {
        mdaName?: string;
        findingCount?: number;
        totalFlaggedNaira?: number;
        reportYears?: number[];
      }
    >;
  } | null;
  evidenceEngineAllYears?: {
    summary?: {
      yearsScanned?: number;
      firstYear?: number;
      lastYear?: number;
      totalRecordsScanned?: number;
      totalRulesCount?: number;
      textRulesCount?: number;
      crossLedgerRulesCount?: number;
      totalRuleFindings?: number;
      totalCrossLedgerFindings?: number;
      totalFlaggedProjects?: number;
      totalFlaggedNaira?: number;
      linkedPaidOnPaperCodesCount?: number;
      linkedBillInsertionCodesCount?: number;
      linkedZombieLineageCodesCount?: number;
      trackedMdaRiskProfilesCount?: number;
    };
    topFlaggedMdasAllTime?: Array<{
      mdaKey?: string;
      mdaName: string;
      flaggedProjectCount?: number;
      totalRuleFindings?: number;
      crossLedgerFindings?: number;
      flaggedAmountNaira?: number;
      oaugfIssues?: number;
      grade?: string;
      hasPersonalOrOpaquePayoutFlag?: boolean;
    }>;
    topCompoundProjectsAllTime?: Array<{
      id?: string;
      financialYear: number;
      projectCode: string;
      projectName: string;
      agency: string;
      amount: number;
      page: number;
      ruleCount: number;
      crossLedgerCount?: number;
      compoundRiskScore: number;
      paidOnPaper?: boolean;
      mdaOaugfIssues?: number;
      mdaGrade?: string;
    }>;
  } | null;
  redFlagConvergence?: {
    headline?: {
      convergentContractorCount?: number;
      highRisk3PlusContractorCount?: number;
      convergentContractorExposureNaira?: number;
      convergentMdaCount?: number;
      highRisk3PlusMdaCount?: number;
    };
    mdas?: Array<{
      mdaKey?: string;
      mdaName: string;
      flagCount: number;
      flags?: string[];
      flagDetails?: string[];
      grade?: string;
      oaugfQueryCount?: number;
      totalExposureNaira?: number;
    }>;
    contractors?: Array<{
      contractorKey?: string;
      contractorName: string;
      bppContractorId?: string | null;
      flagCount: number;
      flags?: string[];
      flagDetails?: string[];
      totalExposureNaira?: number;
      govspendPaidNaira?: number;
      awardedNaira?: number;
    }>;
  } | null;
  forensicSweep?: {
    headlineMetrics?: {
      uniqueFlaggedCapitalLines?: number;
      uniqueFlaggedCapitalExposure?: number;
      uniqueFlaggedCapitalUsd?: number;
      discretionaryOverheadExposure?: number;
      discretionaryOverheadUsd?: number;
      combinedScrutinyExposure?: number;
      combinedScrutinyUsd?: number;
      combinedScheduledBudgetSharePct?: number;
      crossLedgerTotals?: {
        oaugfReportsIndexed?: number;
        oaugfParsedIssuesCount?: number;
        oaugfRepeatNeglectCount?: number;
        oaugfRecoveryDirectiveCount?: number;
        oaugfTotalQueriedNaira?: number;
        billActCyclesCount?: number;
        billActInsertionsCount?: number;
        billActInsertionsNaira?: number;
        openTreasuryVouchersCount?: number;
        openTreasuryTotalNaira?: number;
        openTreasuryPersonalAccountBeneficiaries?: number;
        openTreasuryPersonalAccountNaira?: number;
        openTreasuryOpaqueDiscretionaryVouchers?: number;
        openTreasuryOpaqueDiscretionaryNaira?: number;
        nocopoAwardedContractsAnalyzed?: number;
        nocopoNonCompetitiveNaira?: number;
        nocopoVariationOverrunsNaira?: number;
        evidenceEngineV3RulesCount?: number;
        evidenceEngineV3TotalFindings?: number;
        evidenceEngineV3CrossLedgerFindings?: number;
        evidenceEngineV3FlaggedProjects?: number;
      };
    };
    presidents?: Array<{
      presidentId: string;
      presidentName: string;
      shortName?: string;
      tenureLabel?: string;
      combinedNominal?: number;
      combinedUsd?: number;
      crossLedgerProfile?: {
        oaugf?: {
          issuesCount?: number;
          repeatNeglectCount?: number;
          recoveryDirectiveCount?: number;
          totalQueriedNaira?: number;
        };
        legislativePadding?: {
          cyclesCount?: number;
          insertionsCount?: number;
          insertionsTotalNaira?: number;
        };
        macroAndDebt?: {
          birYearsCovered?: number;
          avgCapitalPerformancePct?: number | null;
          debtServiceOverrunYears?: number;
          dmoEndDebtNairaM?: number | null;
        };
        openTreasury?: {
          yearsCovered?: number[];
          totalDisbursedNaira?: number;
          avgDecemberRushRatio?: number | null;
        };
        evidenceEngineV3?: {
          flaggedProjectsCount?: number;
          totalRuleFindingsCount?: number;
          crossLedgerFindingsCount?: number;
          flaggedAmountNaira?: number;
        };
      };
    }>;
  } | null;
}

const SYNONYMS: Record<string, string> = {
  procurement: 'buy',
  purchase: 'buy',
  supply: 'buy',
  provision: 'buy',
  acquisition: 'buy',
  buying: 'buy',
  procuring: 'buy',
  construction: 'build',
  rehabilitation: 'build',
  renovation: 'build',
  upgrading: 'build',
  completion: 'build',
  remodelling: 'build',
  remodeling: 'build',
  repair: 'build',
  refurbishment: 'build',
  installation: 'build',
  erection: 'build',
  equipping: 'build',
  streetlights: 'streetlight',
  lights: 'light',
  vehicles: 'vehicle',
  motorcycles: 'motorcycle',
  tricycles: 'tricycle',
  boreholes: 'borehole',
  classrooms: 'classroom',
  transformers: 'transformer',
  machines: 'machine',
  programmes: 'programme',
  programs: 'programme',
  projects: 'project',
  locations: 'location',
  hospitals: 'hospital',
  clinics: 'clinic',
  roads: 'road',
  bridges: 'bridge',
  schools: 'school',
};

const STOP_AND_META = new Set([
  'of', 'the', 'in', 'for', 'and', 'or', 'to', 'from', 'at', 'on', 'by', 'with',
  'show', 'me', 'all', 'find', 'list', 'top', 'get', 'search', 'check', 'detect',
  'what', 'which', 'are', 'is', 'was', 'were', 'budget', 'nigeria', 'federal',
  'duplicate', 'duplicates', 'duplicated', 'duplication', 'similar', 'similarity',
  'resemble', 'resembling', 'related', 'repeated', 'repeat', 'repeats', 'recurring',
  'identical', 'disguised', 'reworded', 'rewording', 'cluster', 'clusters', 'ring',
  'rings', 'like', 'same', 'more', 'items', 'item', 'projects', 'project',
  'padding', 'padded', 'insertion', 'insertions', 'benford', 'mad', 'virement',
  'virements', 'premature', 'replacement', 'execution', 'released', 'releases',
  'anomaly', 'anomalies', 'flagged', 'year', 'years', 'scorecard', 'scorecards',
  'integrity', 'credibility', 'overrun', 'overruns', 'competitive', 'december',
  'rush', 'threshold', 'splitting', 'split', 'captive', 'hhi', 'herfindahl',
  'concentration', 'zombie', 'follow', 'unpaid', 'discrepancy', 'discrepancies',
  'overpaid', 'vendor', 'vendors', 'capture', 'lifecycle',
  'convergence', 'convergent', 'evidence', 'engine', 'presidential', 'president',
  'presidents', 'republic', 'fourth', 'compound', 'ledger', 'ledgers', 'rules', 'rule',
]);

let cachedBundle: SupplementalDatasetsBundle | null = null;

export function sanitizeAiPublicText(text: string): string {
  if (!text) return '';
  let out = text.replace(/\(\s*[^()\n]*?\b[A-Za-z0-9_./\\-]+\.(?:pdf|json|csv)\b[^()\n]*?\)/gi, '');
  out = out.replace(/["'`]?[A-Za-z0-9_./\\-]*\.(?:pdf|json|csv)\b["'`]?/gi, '');
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

export function fmtNairaCompact(n: number): string {
  const val = Math.round(n || 0);
  if (val >= 1e12) return `₦${(val / 1e12).toFixed(2)} Trillion`;
  if (val >= 1e9) return `₦${(val / 1e9).toFixed(2)} Billion`;
  if (val >= 1e6) return `₦${(val / 1e6).toFixed(2)} Million`;
  return `₦${val.toLocaleString('en-US')}`;
}

export function fmtUsdCompact(usd: number): string {
  const val = Number(usd || 0);
  if (!Number.isFinite(val)) return '$0';
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)} Billion`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(2)} Million`;
  return `$${Math.round(val).toLocaleString('en-US')}`;
}

export function resetSupplementalAiDatasetsCache(): void {
  cachedBundle = null;
}

export async function loadSupplementalAiDatasets(): Promise<SupplementalDatasetsBundle> {
  if (cachedBundle) return cachedBundle;
  const fetchJson = (url: string) => fetchDataset<any>(url).catch(() => null);
  const [
    paddingIndex,
    executionTracker,
    staticSearch,
    mdaScorecards,
    macroCredibility,
    procurementRisk,
    govspendForensics,
    vendorNetwork,
    followTheMoney,
    oaugfAudit,
    evidenceEngineAllYears,
    redFlagConvergence,
    forensicSweep,
  ] = await Promise.all([
    fetchJson('/datasets/bill_act_diffs/index.json'),
    fetchJson('/datasets/execution_tracker.json'),
    fetchJson('/datasets/search_index_top.json'),
    fetchJson('/datasets/mda_integrity_scorecards.json'),
    fetchJson('/datasets/macro_credibility_tracker.json'),
    fetchJson('/datasets/procurement_risk_index.json'),
    fetchJson('/datasets/govspend_forensics.json'),
    fetchJson('/datasets/vendor_network_index.json'),
    fetchJson('/datasets/follow_the_money_links.json'),
    fetchJson('/datasets/oaugf_audit_index.json'),
    fetchJson('/datasets/evidence_engine_all_years.json'),
    fetchJson('/datasets/red_flag_convergence_index.json'),
    fetchJson('/datasets/forensic_sweep_1999_2026.json'),
  ]);
  cachedBundle = {
    paddingIndex: paddingIndex || null,
    executionTracker: executionTracker || null,
    staticSearchRecords: Array.isArray(staticSearch?.records) ? staticSearch.records : [],
    mdaScorecards: mdaScorecards || null,
    macroCredibility: macroCredibility || null,
    procurementRisk: procurementRisk || null,
    govspendForensics: govspendForensics || null,
    vendorNetwork: vendorNetwork || null,
    followTheMoney: followTheMoney || null,
    oaugfAudit: oaugfAudit || null,
    evidenceEngineAllYears: evidenceEngineAllYears || null,
    redFlagConvergence: redFlagConvergence || null,
    forensicSweep: forensicSweep || null,
  };
  return cachedBundle;
}

export function extractTopicTokens(text: string): string[] {
  const cleaned = (text || '')
    .toLowerCase()
    .replace(/\b(1999|20[0-2]\d)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ');
  const out: string[] = [];
  for (const tok of cleaned.split(/\s+/)) {
    if (!tok || tok.length < 2) continue;
    const mapped = SYNONYMS[tok] || tok;
    if (STOP_AND_META.has(tok) || STOP_AND_META.has(mapped)) continue;
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out;
}

export function extractCodeFromQuery(text: string): string | null {
  const m = (text || '').match(/\b((?:ERGP|ZIP|P-\d{4}-)[A-Z0-9-]+)\b/i);
  return m ? m[1] : null;
}

export function detectAiModeFromQuery(
  query: string,
  explicitMode?: AiInvestigationMode
): AiInvestigationMode {
  if (explicitMode && explicitMode !== 'all') return explicitMode;
  const low = (query || '').toLowerCase();
  if (/\b(duplicat\w*|reword\w*|disguis\w*|cross[- ]mda|copy[- ]paste|repeat(?:ed|s|ing)?|clone[ds]?|rings?)\b/.test(low)) {
    return 'duplicates';
  }
  if (/\b(similar(?:\s+to)?|like\s+|related\s+to|resembl\w*|lookalike)\b/.test(low)) {
    return 'similar';
  }
  if (/\b(red[- ]flag\s+convergence|convergen(?:t|ce)|multi[- ]ledger\s+(?:red\s+)?flags?|simultaneous\s+flags?|3\+\s+flags?|high[- ]risk\s+convergent)\b/.test(low)) {
    return 'convergence';
  }
  if (/\b(evidence\s+engine|compound\s+risk|22\s+rules?|rule\s+findings?|cross[- ]ledger\s+rules?|flagged\s+projects?\s+(?:all[- ]time|across\s+28)|repeat\s+asset\s+lifespan)\b/.test(low)) {
    return 'evidence_engine';
  }
  if (/\b(presidential|fourth\s+republic|obasanjo|yar'?adua|jonathan|buhari|tinubu|compare\s+presidents?|administration(?:s)?\s+comparison|scrutiny\s+total)\b/.test(low)) {
    return 'presidential';
  }
  if (/\b(oaugf|auditor[- ]general|audit\s+quer(?:y|ies)|audit\s+findings?|unvouched|unretired\s+advances?|non[- ]compliance\s+report)\b/.test(low)) {
    return 'oaugf_audit';
  }
  if (/\b(follow\s+the\s+money|padded[- ]to[- ]paid|zombie\s+projects?|paid[- ]on[- ]paper|vendor[- ]switched|project\s+lifecycle|5[- ]stage)\b/.test(low)) {
    return 'follow_money';
  }
  if (/\b(padd\w*|bill[- ]vs[- ]act|insertions?|inflated|national\s+assembly\s+diff)\b/.test(low)) {
    return 'padding';
  }
  if (/\b(scorecard|integrity\s+score|mda\s+grade|mda\s+ranking|credibility|promise\s+vs\.?\s+reality|debt\s+service\s+overrun|macro\s+credibility|worst\s+mdas?|best\s+mdas?)\b/.test(low)) {
    return 'scorecard';
  }
  if (/\b(non[- ]competitive|direct\s+procurement|emergency\s+procurement|selective\s+tendering|variation\s+overrun|cost\s+overrun|contract\s+overrun|zero[- ]paid|unpaid\s+awards?|procurement\s+risk)\b/.test(low)) {
    return 'procurement_risk';
  }
  if (/\b(december\s+rush|year[- ]end\s+rush|threshold\s+splitting|split\s+payments?|rolling\s+7[- ]day|near[- ]threshold|cash\s+benford|treasury\s+benford|voucher\s+splitting)\b/.test(low)) {
    return 'cash_forensics';
  }
  if (/\b(vendor\s+capture|captive\s+pair|captive\s+vendor|\bhhi\b|herfindahl|contractor\s+concentration|off[- ]nocopo|off[- ]portal|unlisted\s+vendors?|multi[- ]mda\s+contractor|payout\s+discrepanc\w*|overpaid\s+contractor)\b/.test(low)) {
    return 'vendor_capture';
  }
  if (/\b(execution|bir\b|capital\s+releas\w*|cash[- ]backed|utiliz\w*|nocopo|procurement|ocds)\b/.test(low)) {
    return 'execution';
  }
  if (/\b(benford|\bmad\b|virement\w*|contingency|service[- ]wide|premature|replacement|lifespan)\b/.test(low)) {
    return 'forensics';
  }
  return 'all';
}

function recordToCitation(r: BudgetRecord): AiCitationItem {
  return {
    id: r.recordIdentity.id,
    code: r.recordIdentity.projectCode || 'ERGP',
    title: r.recordIdentity.verbatimProjectName,
    amount: r.recordIdentity.amountFormatted || fmtNairaCompact(r.recordIdentity.amountNaira),
    amountNaira: r.recordIdentity.amountNaira,
    page: r.sourceProvenance.pdfPage,
    agency: r.mdaGovernanceTaxonomy.mdaName,
    year: r.recordIdentity.financialYear,
    sector: r.mdaGovernanceTaxonomy.sector,
    state: r.geographicTaxonomy.state,
    gemmaReview: r.gemmaAnalyticalOverlay || null,
  };
}

function clusterToAiCluster(cl: DuplicateCluster): AiDuplicateCluster {
  const agencies = Array.from(
    new Set(cl.projects.map((p) => (p.agency || '').trim()).filter(Boolean))
  );
  return {
    clusterId: cl.id,
    canonicalTitle: cl.canonicalTitle,
    matchType: cl.matchType,
    patternType: cl.patternType,
    count: cl.count,
    totalAmountNaira: cl.totalAmount,
    totalAmountFormatted: fmtNairaCompact(cl.totalAmount),
    distinctAgencies: cl.distinctAgencies,
    agencies: agencies.slice(0, 5),
    years: [cl.financialYear],
    items: cl.projects.slice(0, 6).map((p) => ({
      id: p.id,
      code: p.projectCode || 'ERGP',
      title: p.projectName,
      amount: fmtNairaCompact(p.amount),
      amountNaira: p.amount,
      page: p.page,
      agency: p.agency || 'Federal MDA',
      year: cl.financialYear,
      sector: cl.sector,
      state: p.state,
    })),
  };
}

export function findDuplicateClustersForQuery(
  query: string,
  records: BudgetRecord[],
  statisticalForensics: PrecomputedStatisticalForensics | null,
  activeYear: number,
  scope: 'year' | 'all' = 'year'
): AiDuplicateCluster[] {
  const topicTokens = extractTopicTokens(query);

  const rawProjects = records.map((r) => ({
    id: r.recordIdentity.id,
    projectCode: r.recordIdentity.projectCode,
    projectName: r.recordIdentity.verbatimProjectName,
    financialYear: r.recordIdentity.financialYear,
    amount: r.recordIdentity.amountNaira,
    page: r.sourceProvenance.pdfPage,
    sector: r.mdaGovernanceTaxonomy.sector,
    agency: r.mdaGovernanceTaxonomy.mdaName,
    state: r.geographicTaxonomy.state,
  }));

  const detected = detectDuplicates(rawProjects).map(clusterToAiCluster);

  // Also group disguised action-verb swaps ("Construction of Solar Borehole" vs "Provision of Solar Boreholes")
  const verbNeutralBuckets = new Map<string, BudgetRecord[]>();
  for (const r of records) {
    const code = (r.recordIdentity.projectCode || '').trim();
    if (/^[0-5]\d{8,9}$/.test(code) || /^(21|22)\d{6}$/.test(code)) continue;
    const core = extractTopicTokens(r.recordIdentity.verbatimProjectName).filter(
      (t) => t !== 'build' && t !== 'buy' && t.length >= 3
    );
    const uniq = Array.from(new Set(core)).sort().slice(0, 14);
    if (uniq.length < 3) continue;
    const key = uniq.join(' ');
    const list = verbNeutralBuckets.get(key) || [];
    list.push(r);
    verbNeutralBuckets.set(key, list);
  }
  const verbNeutralClusters: AiDuplicateCluster[] = [];
  let vnIdx = 0;
  for (const [, items] of verbNeutralBuckets.entries()) {
    if (items.length < 2) continue;
    vnIdx++;
    const sortedItems = [...items].sort(
      (a, b) => b.recordIdentity.amountNaira - a.recordIdentity.amountNaira
    );
    const canonical = [...items].sort(
      (a, b) =>
        a.recordIdentity.verbatimProjectName.length -
        b.recordIdentity.verbatimProjectName.length
    )[0];
    const totalAmt = items.reduce((s, x) => s + x.recordIdentity.amountNaira, 0);
    const agencies = Array.from(
      new Set(items.map((x) => x.mdaGovernanceTaxonomy.mdaName).filter(Boolean))
    );
    const wordings = new Set(
      items.map((x) => x.recordIdentity.verbatimProjectName.toLowerCase().replace(/\s+/g, ' ').trim())
    );
    verbNeutralClusters.push({
      clusterId: `AI-VN-${vnIdx}`,
      canonicalTitle: canonical.recordIdentity.verbatimProjectName,
      matchType: wordings.size > 1 ? 'Disguised / Reworded' : 'Exact Wording',
      patternType: agencies.length > 1 ? 'Cross-MDA Duplicate' : 'Same-MDA Split',
      count: items.length,
      totalAmountNaira: totalAmt,
      totalAmountFormatted: fmtNairaCompact(totalAmt),
      distinctAgencies: Math.max(1, agencies.length),
      agencies: agencies.slice(0, 5),
      years: [canonical.recordIdentity.financialYear],
      items: sortedItems.slice(0, 6).map(recordToCitation),
    });
  }

  const ringYears =
    scope === 'all' && statisticalForensics?.yearsCovered
      ? [...statisticalForensics.yearsCovered].reverse().slice(0, 8)
      : [activeYear];

  const rings: AiDuplicateCluster[] = [];
  if (statisticalForensics?.byYear) {
    for (const yr of ringYears) {
      const topRings = statisticalForensics.byYear[String(yr)]?.duplicateRings?.topRings || [];
      for (const ring of topRings) {
        rings.push({
          clusterId: ring.clusterId,
          canonicalTitle: ring.normalizedTitle,
          matchType: 'Cross-MDA Precomputed Ring',
          patternType: ring.isCrossMda ? 'Cross-MDA Duplicate' : 'Same-MDA Split',
          count: ring.itemCount,
          totalAmountNaira: ring.totalNaira,
          totalAmountFormatted: ring.totalNairaFormatted || fmtNairaCompact(ring.totalNaira),
          distinctAgencies: (ring.mdasInvolved || []).length || 1,
          agencies: (ring.mdasInvolved || []).slice(0, 5),
          years: [yr],
          items: (ring.sampleRecords || []).slice(0, 6).map((s) => ({
            id: s.id,
            code: s.projectCode || 'ERGP',
            title: s.projectName || ring.normalizedTitle,
            amount: fmtNairaCompact(s.amount),
            amountNaira: s.amount,
            page: s.page,
            agency: s.agency,
            year: s.financialYear,
          })),
        });
      }
    }
  }

  const combined = [...detected, ...verbNeutralClusters, ...rings];
  const filtered =
    topicTokens.length > 0
      ? combined.filter((cl) => {
        const hay = `${cl.canonicalTitle} ${cl.agencies.join(' ')} ${cl.items
          .map((i) => `${i.title} ${i.sector || ''} ${i.state || ''}`)
          .join(' ')}`.toLowerCase();
        return topicTokens.some((tok) => hay.includes(tok));
      })
      : combined;

  // Deduplicate by normalized title + count
  const seen = new Set<string>();
  const unique: AiDuplicateCluster[] = [];
  for (const cl of filtered.sort((a, b) => b.totalAmountNaira - a.totalAmountNaira)) {
    const k = `${cl.canonicalTitle.toLowerCase().slice(0, 50)}::${cl.years.join(',')}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(cl);
    if (unique.length >= 8) break;
  }
  return unique;
}

export function findSimilarItemsForQuery(
  query: string,
  records: BudgetRecord[],
  staticSearchRecords: SupplementalDatasetsBundle['staticSearchRecords'],
  activeYear: number,
  scope: 'year' | 'all' = 'year'
): { anchor: AiCitationItem | null; similarItems: AiCitationItem[] } {
  const code = extractCodeFromQuery(query);
  const anchorRec = code
    ? records.find(
      (r) =>
        r.recordIdentity.projectCode?.toUpperCase() === code.toUpperCase() ||
        r.recordIdentity.id.toUpperCase() === code.toUpperCase()
    )
    : undefined;

  const anchorStatic =
    !anchorRec && code
      ? staticSearchRecords.find(
        (s) =>
          s.projectCode?.toUpperCase() === code.toUpperCase() ||
          s.id.toUpperCase() === code.toUpperCase()
      )
      : undefined;

  const anchorCitation: AiCitationItem | null = anchorRec
    ? recordToCitation(anchorRec)
    : anchorStatic
      ? {
        id: anchorStatic.id,
        code: anchorStatic.projectCode || 'ERGP',
        title: anchorStatic.projectName,
        amount: fmtNairaCompact(anchorStatic.amount),
        amountNaira: anchorStatic.amount,
        page: anchorStatic.page,
        agency: anchorStatic.agency,
        year: anchorStatic.financialYear,
        sector: anchorStatic.sector,
        state: anchorStatic.state,
      }
      : null;

  const anchorTitle = anchorCitation?.title || query;
  const anchorTokens = new Set(extractTopicTokens(anchorTitle));
  if (anchorTokens.size === 0) {
    return { anchor: anchorCitation, similarItems: [] };
  }

  const candidatePool: AiCitationItem[] = [];
  const seenIds = new Set<string>();

  for (const r of records) {
    if (anchorCitation?.id && r.recordIdentity.id === anchorCitation.id) continue;
    seenIds.add(r.recordIdentity.id);
    candidatePool.push(recordToCitation(r));
  }

  if (scope === 'all' || candidatePool.length === 0) {
    for (const s of staticSearchRecords) {
      if (anchorCitation?.id && s.id === anchorCitation.id) continue;
      if (seenIds.has(s.id)) continue;
      if (scope === 'year' && s.financialYear !== activeYear) continue;
      seenIds.add(s.id);
      candidatePool.push({
        id: s.id,
        code: s.projectCode || 'ERGP',
        title: s.projectName,
        amount: fmtNairaCompact(s.amount),
        amountNaira: s.amount,
        page: s.page,
        agency: s.agency,
        year: s.financialYear,
        sector: s.sector,
        state: s.state,
      });
    }
  }

  const anchorSector = (anchorCitation?.sector || '').toLowerCase();
  const anchorAgency = (anchorCitation?.agency || '').toLowerCase();
  const anchorState = (anchorCitation?.state || '').toLowerCase();

  const scored: Array<{ score: number; item: AiCitationItem }> = [];
  for (const cand of candidatePool) {
    const candTokens = new Set(extractTopicTokens(`${cand.title} ${cand.sector || ''} ${cand.state || ''}`));
    if (candTokens.size === 0) continue;
    const shared = Array.from(anchorTokens).filter((t) => candTokens.has(t));
    if (shared.length === 0) continue;

    const unionSize = new Set([...anchorTokens, ...candTokens]).size;
    const jaccard = shared.length / Math.max(1, unionSize);
    const coverage = shared.length / Math.max(1, anchorTokens.size);
    let affinity = 0;
    if (anchorSector && (cand.sector || '').toLowerCase() === anchorSector) affinity += 0.08;
    if (anchorAgency && (cand.agency || '').toLowerCase() === anchorAgency) affinity += 0.08;
    if (anchorState && (cand.state || '').toLowerCase() === anchorState) affinity += 0.06;

    const simPct = Math.min(99, Math.max(20, Math.round((0.55 * coverage + 0.45 * jaccard + affinity) * 100)));
    scored.push({
      score: simPct * 1e12 + (cand.amountNaira || 0),
      item: {
        ...cand,
        similarityPct: simPct,
        sharedTokens: shared.slice(0, 6),
      },
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return {
    anchor: anchorCitation,
    similarItems: scored.slice(0, 12).map((s) => s.item),
  };
}

export function buildMultiDatasetContextSummary(args: {
  query: string;
  mode: AiInvestigationMode;
  activeYear: number;
  statisticalForensics: PrecomputedStatisticalForensics | null;
  bundle: SupplementalDatasetsBundle | null;
}): { headline: string; bullets: string[]; extraLine: string } | null {
  const { query, mode, activeYear, statisticalForensics, bundle } = args;
  const yrMatch = query.match(/\b(1999|20[0-2]\d)\b/);
  const targetYear = yrMatch ? parseInt(yrMatch[1], 10) : activeYear;
  const bullets: string[] = [];

  if (mode === 'padding' && bundle?.paddingIndex?.cycles?.length) {
    const cycles = bundle.paddingIndex.cycles;
    const picked = cycles.find((c) => c.financialYear === targetYear) || cycles[cycles.length - 1];
    if (picked) {
      bullets.push(
        `FY ${picked.financialYear} (${picked.comparisonScope}): Enacted Act ${fmtNairaCompact(picked.actTotalNaira)} vs. Executive Bill ${fmtNairaCompact(picked.billTotalNaira)}.`
      );
      bullets.push(
        `Insertions: ${picked.insertionsCount.toLocaleString('en-US')} lines (${fmtNairaCompact(picked.insertionsTotalNaira)}) | Inflated: ${picked.inflatedCount.toLocaleString('en-US')} lines (${fmtNairaCompact(picked.inflatedTotalNaira)}) | Cut: ${picked.cutCount.toLocaleString('en-US')} (${fmtNairaCompact(picked.cutTotalNaira)}).`
      );
      if (picked.topPaddedMdas?.length) {
        const top = picked.topPaddedMdas[0];
        bullets.push(
          `Top padded MDA: ${top.mdaName} (${fmtNairaCompact(top.totalPositivePaddingNaira)} positive delta).`
        );
      }
      return {
        headline: sanitizeAiPublicText(`Bill vs. Act Legislative Padding Dossier (${bundle.paddingIndex.cyclesCount} cycles tracked)`),
        bullets: bullets.map(sanitizeAiPublicText),
        extraLine: sanitizeAiPublicText(`Zonal Intervention Projects in FY ${picked.financialYear}: ${picked.zipCount.toLocaleString('en-US')} items (${fmtNairaCompact(picked.zipTotalNaira)}).`),
      };
    }
  }

  if (mode === 'execution' && bundle?.executionTracker?.years?.length) {
    const yrs = bundle.executionTracker.years;
    const picked = yrs.find((y) => y.financialYear === targetYear) || yrs[0];
    if (picked) {
      bullets.push(
        `FY ${picked.financialYear}: ${picked.mdaCount.toLocaleString('en-US')} MDAs — Appropriated ${fmtNairaCompact(picked.totalAppropriatedNaira)} vs. Released ${picked.totalReleasedNaira != null ? fmtNairaCompact(picked.totalReleasedNaira) : 'N/A'} (${picked.overallReleasePct}% overall execution).`
      );
      for (const mda of (picked.mdaBreakdown || []).slice(0, 3)) {
        bullets.push(
          `${mda.mdaName}: ${fmtNairaCompact(mda.appropriatedNaira)} appropriated vs. ${mda.releasedNaira != null ? fmtNairaCompact(mda.releasedNaira) : 'N/A'} released (${mda.releasePct}%).`
        );
      }
      return {
        headline: sanitizeAiPublicText(`Capital Budget Releases (${yrs.map((y) => y.financialYear).join(', ')})`),
        bullets: bullets.map(sanitizeAiPublicText),
        extraLine: '',
      };
    }
  }

  if (mode === 'scorecard' && (bundle?.mdaScorecards?.mdas?.length || bundle?.macroCredibility?.headline)) {
    const sc = bundle?.mdaScorecards;
    const mc = bundle?.macroCredibility;
    if (sc?.headline && sc.mdas?.length) {
      bullets.push(
        `Scored MDAs: ${(sc.headline.totalScoredMdas || sc.mdas.length).toLocaleString('en-US')} agencies (${(sc.headline.full5PillarCount || 0).toLocaleString('en-US')} with all 5 pillars, median ${sc.headline.medianCompositeScore ?? 0}/100).`
      );
      const tokens = extractTopicTokens(query);
      const matched = tokens.length
        ? sc.mdas.filter((m) => tokens.some((t) => m.mdaName.toLowerCase().includes(t)))
        : [];
      for (const m of (matched.length ? matched : sc.mdas).slice(0, 3)) {
        bullets.push(
          `Rank #${m.rank ?? '-'} ${m.mdaName}: ${m.compositeScore}/100 (Grade ${m.grade}, ${m.metricsPresent}/5 pillars, exposure ${fmtNairaCompact(m.totalTrackedExposureNaira)}).`
        );
      }
    }
    let extra = '';
    if (mc?.headline) {
      extra = `Macro Credibility (${mc.headline.yearRange || '2009–2026'}): ${mc.headline.debtServiceOverrunYearsCount ?? 0} debt-service overrun years totaling ${fmtNairaCompact(mc.headline.cumulativeDebtServiceOverrunNaira || 0)} above budget.`;
    }
    return {
      headline: sanitizeAiPublicText('MDA Integrity Scorecards & Macro Credibility Summary'),
      bullets: bullets.map(sanitizeAiPublicText),
      extraLine: sanitizeAiPublicText(extra),
    };
  }

  if (mode === 'procurement_risk' && bundle?.procurementRisk?.headline) {
    const h = bundle.procurementRisk.headline;
    bullets.push(
      `Awarded Contracts Analyzed: ${(h.totalAwardedRows || 0).toLocaleString('en-US')} contracts (${fmtNairaCompact(h.totalAwardedNaira || 0)}); ${(h.planningExcludedCount || 0).toLocaleString('en-US')} uncontracted planning rows excluded.`
    );
    bullets.push(
      `Non-Competitive Share: ${(h.nonCompetitiveCount || 0).toLocaleString('en-US')} contracts (${fmtNairaCompact(h.nonCompetitiveAwardedNaira || 0)}, ${h.nonCompetitiveValueSharePct ?? 0}% of value).`
    );
    bullets.push(
      `Overruns & Unpaid Awards: ${(h.overrunCount || 0).toLocaleString('en-US')} over-disbursed (+${fmtNairaCompact(h.overrunDeltaNaira || 0)}) | ${(h.zeroPaidCount || 0).toLocaleString('en-US')} zero-paid awards (${fmtNairaCompact(h.zeroPaidAwardedNaira || 0)}).`
    );
    const topOv = bundle.procurementRisk.topOverrunContracts?.[0];
    if (topOv) {
      bullets.push(
        `Top Overrun: ${topOv.contractorName || 'Contractor'} via ${topOv.mdaName || 'Federal MDA'} — Awarded ${fmtNairaCompact(topOv.awardNaira || 0)}, Paid ${fmtNairaCompact(topOv.paidNaira || 0)}.`
      );
    }
    return {
      headline: sanitizeAiPublicText('Public Procurement Risk & Variation Overrun Monitor'),
      bullets: bullets.map(sanitizeAiPublicText),
      extraLine: '',
    };
  }

  if (mode === 'cash_forensics' && bundle?.govspendForensics?.headline) {
    const h = bundle.govspendForensics.headline;
    bullets.push(
      `Treasury Vouchers Analyzed: ${(h.totalVouchers || 0).toLocaleString('en-US')} payments totaling ${fmtNairaCompact(h.totalNaira || 0)}.`
    );
    bullets.push(
      `December Rush (2019–2025): ${(h.december2019To2025Vouchers || 0).toLocaleString('en-US')} vouchers (${fmtNairaCompact(h.december2019To2025Naira || 0)}, ${h.decemberRushRatio2019To2025 ?? 0}x monthly baseline).`
    );
    bullets.push(
      `Threshold Splitting & Cash Benford: ${(h.nearThresholdVoucherCount || 0).toLocaleString('en-US')} near-threshold payments (${fmtNairaCompact(h.nearThresholdNaira || 0)}), ${(h.rolling7DayClusterCount || 0).toLocaleString('en-US')} 7-day rolling splits (${fmtNairaCompact(h.rolling7DayClusterNaira || 0)}), 1D Benford MAD ${(h.benford1DMad ?? 0).toFixed(4)}.`
    );
    const topDec = bundle.govspendForensics.decemberRush?.topDecemberRushMdas?.[0];
    if (topDec) {
      bullets.push(
        `Top December Surge MDA: ${topDec.organizationName || 'Agency'} — ${fmtNairaCompact(topDec.decemberNaira || 0)} (${topDec.decemberSharePct ?? 0}% share).`
      );
    }
    return {
      headline: sanitizeAiPublicText('Federal Treasury Cash Forensics & Threshold Splitting'),
      bullets: bullets.map(sanitizeAiPublicText),
      extraLine: '',
    };
  }

  if (mode === 'vendor_capture' && bundle?.vendorNetwork?.headline) {
    const h = bundle.vendorNetwork.headline;
    bullets.push(
      `Captive Pairs & Multi-MDA Reach: ${(h.captivePairCount || 0).toLocaleString('en-US')} captive MDA-vendor pairs (${fmtNairaCompact(h.captivePairAwardedNaira || 0)}) and ${(h.multiMdaContractorCount || 0).toLocaleString('en-US')} contractors spanning 5+ ministries.`
    );
    bullets.push(
      `Award-vs-Treasury Discrepancy: ${(h.overpaid125Count || 0).toLocaleString('en-US')} firms paid ${fmtNairaCompact(h.overpaid125GovspendPaidNaira || 0)} vs. ${fmtNairaCompact(h.overpaid125NocopoAwardedNaira || 0)} in recorded contract awards.`
    );
    bullets.push(
      `Off-Portal Private Payees: ${(h.offNocopoPrivateCount || 0).toLocaleString('en-US')} private firms without public award records received ${fmtNairaCompact(h.offNocopoPrivatePaidNaira || 0)} (${(h.offNocopoPrivateBillionPlusCount || 0).toLocaleString('en-US')} >= ₦1.00 Billion).`
    );
    const topPair = bundle.vendorNetwork.captivePairs?.[0];
    if (topPair) {
      bullets.push(
        `Top Captive Pair: ${topPair.contractorName || 'Vendor'} at ${topPair.mdaName || 'MDA'} (${topPair.shareOfMdaPct ?? 0}% share, ${fmtNairaCompact(topPair.pairAwardedNaira || 0)}).`
      );
    }
    return {
      headline: sanitizeAiPublicText('Vendor Capture Network & Off-Portal Private Vendors Audit'),
      bullets: bullets.map(sanitizeAiPublicText),
      extraLine: '',
    };
  }

  if (mode === 'follow_money' && bundle?.followTheMoney?.summary) {
    const s = bundle.followTheMoney.summary;
    const lcc = s.lineageClassificationCounts || {};
    bullets.push(
      `Contracted Budget Changes: ${(s.diffMatchedAwardedCount || 0).toLocaleString('en-US')} items progressed to public awards (${fmtNairaCompact(s.diffTotalAwardedNaira || 0)} awarded, ${fmtNairaCompact(s.diffTotalNocopoDisbursedNaira || 0)} disbursed).`
    );
    bullets.push(
      `Legislature-Added Awarded Items: ${(s.diffPositivePaddingAwardedCount || 0).toLocaleString('en-US')} items (${fmtNairaCompact(s.diffPositivePaddingAwardedNaira || 0)}).`
    );
    bullets.push(
      `Zombie & Active Builds (${(s.lineagesScanned || 0).toLocaleString('en-US')} lineages): ${lcc.VENDOR_SWITCHED_REPEAT || 0} vendor-switched, ${lcc.ACTIVE_PHASED_BUILD || 0} active phased builds, ${lcc.AWARDED_UNPAID || 0} awarded unpaid.`
    );
    return {
      headline: sanitizeAiPublicText('Follow-the-Money Cross-Dataset Trace'),
      bullets: bullets.map(sanitizeAiPublicText),
      extraLine: '',
    };
  }

  if (mode === 'evidence_engine' && bundle?.evidenceEngineAllYears?.summary) {
    const s = bundle.evidenceEngineAllYears.summary;
    bullets.push(
      `Evidence Engine v3.0 (${s.yearsScanned ?? 28}-Year Coverage, ${s.firstYear ?? 1999}–${s.lastYear ?? 2026}): ${(s.totalRulesCount ?? 22).toLocaleString('en-US')} rules (${(s.textRulesCount ?? 16).toLocaleString('en-US')} text/domain + ${(s.crossLedgerRulesCount ?? 6).toLocaleString('en-US')} cross-ledger) generated ${(s.totalRuleFindings || 0).toLocaleString('en-US')} rule findings (${(s.totalCrossLedgerFindings || 0).toLocaleString('en-US')} cross-ledger) across ${(s.totalFlaggedProjects || 0).toLocaleString('en-US')} projects (${fmtNairaCompact(s.totalFlaggedNaira || 0)}).`
    );
    bullets.push(
      `Cross-Ledger Project Links: ${(s.linkedPaidOnPaperCodesCount || 0).toLocaleString('en-US')} Paid-on-Paper codes, ${(s.linkedBillInsertionCodesCount || 0).toLocaleString('en-US')} legislative insertion codes, ${(s.linkedZombieLineageCodesCount || 0).toLocaleString('en-US')} recurring lineage codes, and ${(s.trackedMdaRiskProfilesCount || 0).toLocaleString('en-US')} agency risk profiles.`
    );
    const tokens = extractTopicTokens(query);
    const mdas = bundle.evidenceEngineAllYears.topFlaggedMdasAllTime || [];
    const matchedMdas = tokens.length
      ? mdas.filter((m) => tokens.some((t) => m.mdaName.toLowerCase().includes(t)))
      : [];
    for (const m of (matchedMdas.length ? matchedMdas : mdas).slice(0, 2)) {
      bullets.push(
        `Top Flagged MDA — ${m.mdaName}: ${(m.flaggedProjectCount || 0).toLocaleString('en-US')} flagged items (${(m.totalRuleFindings || 0).toLocaleString('en-US')} rule hits, ${fmtNairaCompact(m.flaggedAmountNaira || 0)}, Grade ${m.grade || 'N/A'}, ${(m.oaugfIssues || 0).toLocaleString('en-US')} Auditor-General queries).`
      );
    }
    const topComp = bundle.evidenceEngineAllYears.topCompoundProjectsAllTime?.[0];
    if (topComp) {
      bullets.push(
        `Top Compound-Risk Project: [${topComp.projectCode || 'ERGP'}] ${topComp.projectName} (${topComp.agency}, FY ${topComp.financialYear}) — Risk ${topComp.compoundRiskScore}/100 across ${topComp.ruleCount} rules (${fmtNairaCompact(topComp.amount)}).`
      );
    }
    return {
      headline: sanitizeAiPublicText('28-Year Evidence Engine v3.0 Multi-Rule Summary (1999–2026)'),
      bullets: bullets.map(sanitizeAiPublicText),
      extraLine: sanitizeAiPublicText(
        'Compound risk scores highlight projects triggering multiple domain and cross-ledger accountability checks for formal audit inquiry.'
      ),
    };
  }

  if (mode === 'convergence' && bundle?.redFlagConvergence?.headline) {
    const h = bundle.redFlagConvergence.headline;
    bullets.push(
      `Convergent Federal Agencies: ${(h.convergentMdaCount || 0).toLocaleString('en-US')} agencies carry 2+ independent accountability flags, including ${(h.highRisk3PlusMdaCount || 0).toLocaleString('en-US')} high-risk agencies with 3+ simultaneous flags.`
    );
    bullets.push(
      `Convergent Contractors: ${(h.convergentContractorCount || 0).toLocaleString('en-US')} contractors carry 2+ flags (${(h.highRisk3PlusContractorCount || 0).toLocaleString('en-US')} with 3+ flags), totaling ${fmtNairaCompact(h.convergentContractorExposureNaira || 0)} combined exposure.`
    );
    const tokens = extractTopicTokens(query);
    const mdas = bundle.redFlagConvergence.mdas || [];
    const matchedMdas = tokens.length
      ? mdas.filter((m) => tokens.some((t) => m.mdaName.toLowerCase().includes(t)))
      : [];
    for (const m of (matchedMdas.length ? matchedMdas : mdas).slice(0, 2)) {
      const detail = m.flagDetails?.[0] ? ` — ${m.flagDetails[0]}` : '';
      bullets.push(
        `Agency Convergence — ${m.mdaName}: ${m.flagCount} flags (Grade ${m.grade || 'N/A'}, ${(m.oaugfQueryCount || 0).toLocaleString('en-US')} Auditor-General queries${detail}).`
      );
    }
    const ctrs = bundle.redFlagConvergence.contractors || [];
    const matchedCtrs = tokens.length
      ? ctrs.filter((c) => tokens.some((t) => c.contractorName.toLowerCase().includes(t)))
      : [];
    for (const c of (matchedCtrs.length ? matchedCtrs : ctrs).slice(0, 2)) {
      const detail = c.flagDetails?.[0] ? ` (${c.flagDetails[0]})` : '';
      bullets.push(
        `Contractor Convergence — ${c.contractorName}: ${c.flagCount} flags, exposure ${fmtNairaCompact(c.totalExposureNaira || 0)}${detail}.`
      );
    }
    return {
      headline: sanitizeAiPublicText('Multi-Ledger Red-Flag Convergence Index (MDAs & Contractors)'),
      bullets: bullets.map(sanitizeAiPublicText),
      extraLine: sanitizeAiPublicText(
        'Convergence joins integrity grades, legislative diffs, non-competitive procurement, December rushes, personal/opaque cash vouchers, and Auditor-General queries.'
      ),
    };
  }

  if (mode === 'presidential' && bundle?.forensicSweep?.headlineMetrics) {
    const hm = bundle.forensicSweep.headlineMetrics;
    const cl = hm.crossLedgerTotals;
    bullets.push(
      `Fourth Republic Enacted Scrutiny (1999–2026): ${fmtNairaCompact(hm.combinedScrutinyExposure || 0)} (${fmtUsdCompact(hm.combinedScrutinyUsd || 0)}, ${(hm.combinedScheduledBudgetSharePct ?? 0).toFixed(2)}% of scheduled federal budgets) across ${(hm.uniqueFlaggedCapitalLines || 0).toLocaleString('en-US')} capital items and ${fmtNairaCompact(hm.discretionaryOverheadExposure || 0)} discretionary overhead.`
    );
    if (cl) {
      bullets.push(
        `6-Ledger Context Totals (Separate Non-Additive Ledgers): ${(cl.oaugfParsedIssuesCount || 0).toLocaleString('en-US')} Auditor-General audit queries (${(cl.oaugfRecoveryDirectiveCount || 0).toLocaleString('en-US')} recovery orders), ${(cl.evidenceEngineV3TotalFindings || 0).toLocaleString('en-US')} Evidence Engine v3.0 rule hits across ${(cl.evidenceEngineV3FlaggedProjects || 0).toLocaleString('en-US')} projects, ${fmtNairaCompact(cl.openTreasuryPersonalAccountNaira || 0)} to ${(cl.openTreasuryPersonalAccountBeneficiaries || 0).toLocaleString('en-US')} personal/staff bank payees, and ${fmtNairaCompact(cl.openTreasuryOpaqueDiscretionaryNaira || 0)} opaque/discretionary vouchers.`
      );
    }
    const low = query.toLowerCase();
    const presList = bundle.forensicSweep.presidents || [];
    const explicitlyNamed = presList.filter((p) => {
      const pid = (p.presidentId || '').toLowerCase();
      const sName = (p.shortName || '').toLowerCase();
      return (
        (pid && low.includes(pid)) ||
        (sName && low.includes(sName.replace(/[^a-z]/g, ''))) ||
        (pid === 'yaradua' && /yar'?adua/.test(low))
      );
    });
    const toDisplay = explicitlyNamed.length > 0 ? explicitlyNamed : presList;
    for (const p of toDisplay.slice(0, 5)) {
      const cp = p.crossLedgerProfile;
      const oaugfTxt = cp?.oaugf
        ? `${(cp.oaugf.issuesCount || 0).toLocaleString('en-US')} Auditor-General queries (${(cp.oaugf.recoveryDirectiveCount || 0).toLocaleString('en-US')} recovery)`
        : 'N/A';
      const eeTxt = cp?.evidenceEngineV3
        ? `${(cp.evidenceEngineV3.totalRuleFindingsCount || 0).toLocaleString('en-US')} EE v3 hits`
        : 'N/A';
      const dmoM = cp?.macroAndDebt?.dmoEndDebtNairaM;
      const debtTxt =
        typeof dmoM === 'number' && Number.isFinite(dmoM)
          ? fmtNairaCompact(dmoM * 1e6)
          : 'N/A';
      const padTxt =
        cp?.legislativePadding && (cp.legislativePadding.cyclesCount || 0) > 0
          ? `${(cp.legislativePadding.insertionsCount || 0).toLocaleString('en-US')} Bill→Act insertions`
          : 'Pre-2017 (N/A)';
      bullets.push(
        `${p.presidentName} (${p.tenureLabel || p.presidentId}): Enacted scrutiny ${fmtNairaCompact(p.combinedNominal || 0)} (${fmtUsdCompact(p.combinedUsd || 0)}) | ${oaugfTxt} | ${eeTxt} | ${padTxt} | End Debt ${debtTxt}.`
      );
    }
    return {
      headline: sanitizeAiPublicText('Fourth Republic Presidential 6-Ledger Accountability Comparison (1999–2026)'),
      bullets: bullets.map(sanitizeAiPublicText),
      extraLine: sanitizeAiPublicText(
        'Each fiscal stage is reported on its own statutory base (pre-2017 legislative diffs and pre-2018 treasury vouchers marked N/A) and is never summed across stages.'
      ),
    };
  }

  if (mode === 'oaugf_audit' && bundle?.oaugfAudit?.headline) {
    const h = bundle.oaugfAudit.headline;
    bullets.push(
      `OAuGF Audit Archive: ${(h.reportsIndexed || 0).toLocaleString('en-US')} reports (${(h.totalPages || 0).toLocaleString('en-US')} pages, ${(h.parsedAuditIssuesCount || 0).toLocaleString('en-US')} parsed audit queries across ${(h.matchedMdasCount || 0).toLocaleString('en-US')} matched MDAs).`
    );
    const tokens = extractTopicTokens(query);
    const mdaValues = Object.values(bundle.oaugfAudit.byMda || {});
    const matched = tokens.length
      ? mdaValues.filter((m) => tokens.some((t) => (m.mdaName || '').toLowerCase().includes(t)))
      : [];
    for (const m of (matched.length ? matched : mdaValues).slice(0, 3)) {
      bullets.push(
        `${m.mdaName || 'Federal MDA'}: ${(m.findingCount || 0).toLocaleString('en-US')} audit queries (${(m.reportYears || []).slice(-4).join(', ') || 'Multiple years'}, referenced amounts ${fmtNairaCompact(m.totalFlaggedNaira || 0)}).`
      );
    }
    return {
      headline: sanitizeAiPublicText('Auditor-General Constitutional Audit Findings'),
      bullets: bullets.map(sanitizeAiPublicText),
      extraLine: '',
    };
  }

  if (mode === 'forensics' && statisticalForensics) {
    const byYr = statisticalForensics.byYear?.[String(targetYear)];
    if (byYr) {
      bullets.push(
        `FY ${targetYear} Benford's Law First-Digit Test: MAD ${byYr.benford.meanAbsoluteDeviation.toFixed(4)} (${byYr.benford.conformityBand}, score ${byYr.benford.benfordIntegrityScore}/100 across ${byYr.benford.validRecordCount.toLocaleString('en-US')} items).`
      );
      bullets.push(
        `FY ${targetYear} Virements / Service-Wide Votes: ${byYr.virements.virementRecordCount.toLocaleString('en-US')} items (${byYr.virements.totalNairaFormatted}).`
      );
      bullets.push(
        `FY ${targetYear} Duplicate Rings: ${byYr.duplicateRings.crossMdaRingsCount.toLocaleString('en-US')} cross-MDA rings (${fmtNairaCompact(byYr.duplicateRings.totalExposureNaira)}).`
      );
    }
    const topAlert = statisticalForensics.prematureReplacementAlerts?.[0];
    if (topAlert) {
      bullets.push(
        `Top Lifecycle Alert: ${topAlert.mdaName} (${topAlert.assetCategoryLabel}) — ${topAlert.recentAllocationsCount} allocations (${topAlert.totalSpentFormatted}) across ${topAlert.yearsActive.length} fiscal years.`
      );
    }
    return {
      headline: sanitizeAiPublicText(`28-Year Statistical Forensics Summary (${statisticalForensics.summary.totalRecordsAnalyzed.toLocaleString('en-US')} records analyzed)`),
      bullets: bullets.map(sanitizeAiPublicText),
      extraLine: sanitizeAiPublicText(`${statisticalForensics.summary.totalPrematureAlerts} durable lifecycle alerts & ${statisticalForensics.summary.totalCrossMdaRings.toLocaleString('en-US')} cross-MDA rings indexed.`),
    };
  }

  // Constituency / macro context mention if geographic query detected
  const pres = getPresidentForYear(targetYear);
  const macro = getMacroForYear(targetYear);
  const constMatch = lookupConstituency(undefined, query, query);
  if (macro) {
    return {
      headline: sanitizeAiPublicText(`FY ${targetYear} Fiscal Context — ${pres.presidentName} Administration`),
      bullets: [
        sanitizeAiPublicText(`CBN Official Rate: ₦${macro.fxNairaPerUsd}/USD | Inflation: ${macro.cpiInflationRate}% | National Assembly Coverage: ${TOTAL_SENATORIAL_DISTRICTS} Senatorial Districts & ${TOTAL_FEDERAL_CONSTITUENCIES} Federal Constituencies.`),
      ],
      extraLine: sanitizeAiPublicText(
        constMatch.federalConstituency
          ? `Constituency match: ${constMatch.federalConstituency} (${constMatch.senatorialDistrict})`
          : 'All 28 Appropriation Cycles (1999–2026) connected.'
      ),
    };
  }

  return null;
}
