import { fetchDataset } from '../services/apiClient';

export type MdaPillarKey =
  | 'paddingRestraint'
  | 'birCapitalExecution'
  | 'openBiddingShare'
  | 'vendorDiversification'
  | 'cashDiscipline';

export interface MdaPillarDefinition {
  key: MdaPillarKey;
  label: string;
  shortLabel: string;
  weight: number;
  sourceLabel: string;
  formula: string;
  minSampleRule: string;
}

export interface MdaPillarDetail {
  score: number | null;
  weight: number;
  status: 'SCORED' | 'NO_SOURCE_COVERAGE' | 'INSUFFICIENT_SAMPLE' | string;
  // Padding Restraint fields
  positivePaddingNaira?: number;
  insertionsNaira?: number;
  inflatedNaira?: number;
  cutNaira?: number;
  auditedEnactedNaira?: number;
  auditedProposedNaira?: number;
  paddingSharePct?: number;
  alteredItemCount?: number;
  cyclesCovered?: number[];
  // BIR Capital Execution fields
  avgReleasePct?: number | null;
  avgUtilizationPct?: number | null;
  yearsCovered?: number[];
  yearsCount?: number;
  matchScope?: string;
  matchedBirLabels?: string[];
  overspendYears?: number;
  // Open Bidding Share fields
  awardedCount?: number;
  methodKnownCount?: number;
  openBiddingCount?: number;
  nonCompetitiveCount?: number;
  minorQuotationCount?: number;
  totalAwardedNaira?: number;
  openBiddingCountSharePct?: number;
  openBiddingValueSharePct?: number;
  // Vendor Diversification fields
  hhiPoints?: number;
  distinctVendors?: number;
  topVendorName?: string;
  topVendorSharePct?: number;
  pricedAwardedCount?: number;
  // Cash Discipline fields
  voucherCount?: number;
  totalDisbursedNaira?: number;
  decRushRatio?: number | null;
  nearThresholdCount?: number;
  nearThresholdPct?: number;
  splitClusterCount?: number;
  splitVoucherCount?: number;
  splitVoucherPct?: number;
  decPenalty?: number;
  nearPenalty?: number;
  splitPenalty?: number;
}

export interface MdaScorecardEntry {
  rank: number;
  mdaKey: string;
  mdaName: string;
  parentFamilies: string[];
  compositeScore: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | 'F' | 'N/A' | string;
  metricsPresent: number;
  totalExpectedMetrics: number;
  activeWeightSum: number;
  coverageTier:
    | 'FULL_5_PILLAR'
    | 'STRONG_4_PILLAR'
    | 'PARTIAL_2_3_PILLAR'
    | 'SINGLE_PILLAR'
    | 'UNSCORED'
    | string;
  totalTrackedExposureNaira: number;
  pillars: Record<MdaPillarKey, MdaPillarDetail>;
}

export interface MdaIntegrityScorecardsPayload {
  generatedAt: string;
  status: string;
  formulaVersion: string;
  pillarDefinitions: MdaPillarDefinition[];
  headline: {
    totalCandidateMdas: number;
    totalScoredMdas: number;
    full5PillarCount: number;
    strong4PlusPillarCount: number;
    medianCompositeScore: number | null;
    meanCompositeScore: number | null;
    gradeDistribution: Record<string, number>;
    awardedContractsAnalyzed: number;
    planningContractsExcluded: number;
  };
  mdas: MdaScorecardEntry[];
}

export interface MacroCredibilityYearRow {
  financialYear: number;
  presidentId: string;
  presidentName: string;
  shortName: string;
  party: string;
  quarterCovered: string | null;
  reportPeriodLabel: string | null;
  isPartialYearReport: boolean;
  overallReleasePct: number | null;
  overallUtilizationPct: number | null;
  mtef: {
    oilPriceUsdPerBbl: number | null;
    oilProductionMbpd: number | null;
    exchangeRateNairaPerUsd: number | null;
    gdpGrowthPct: number | null;
    inflationPct: number | null;
    fxAssumptionSource: string;
    docTitle: string | null;
  };
  realized: {
    cbnFxRateNairaPerUsd: number | null;
    fxBasis: string;
    fxSlippagePct: number | null;
    totalDebtNairaM: number | null;
    totalDebtUsdM: number | null;
    dmoAsAt: string | null;
  };
  bir: {
    revenueBudgetNaira: number | null;
    revenueActualNaira: number | null;
    revenuePerformancePct: number | null;
    capitalBudgetNaira: number | null;
    capitalActualNaira: number | null;
    capitalPerformancePct: number | null;
    debtServiceBudgetNaira: number | null;
    debtServiceActualNaira: number | null;
    debtServicePerformancePct: number | null;
    debtServiceDerivedFromComponents: boolean;
    debtServiceOverrunFlag: boolean;
    debtServiceOverrunNaira: number;
    debtServiceToRevenuePct: number | null;
    capitalVsDebtServiceGapPct: number | null;
  };
}

export interface AdministrationCredibilityRow {
  presidentId: string;
  presidentName: string;
  shortName: string;
  party: string;
  tenureLabel: string;
  budgetYears: number[];
  birCoverageStatus: 'PRE_BIR_ERA_NO_SOURCE' | 'VERIFIED_BIR_SERIES' | string;
  birYearsCovered: number;
  birYearsList: number[];
  birCapitalYearsCount: number;
  birRevenueYearsCount: number;
  birDebtYearsCount: number;
  avgCapitalPerformancePct: number | null;
  avgRevenuePerformancePct: number | null;
  avgDebtServicePerformancePct: number | null;
  avgDebtServiceToRevenuePct: number | null;
  avgFxSlippagePct: number | null;
  debtServiceOverrunYears: number;
  debtServiceOverrunYearsList?: number[];
  totalDebtServiceOverrunNaira: number;
  dmoStartDebtNairaM: number | null;
  dmoEndDebtNairaM: number | null;
  dmoEndDebtUsdM: number | null;
  partialYearNotes: string[];
}

export interface MacroCredibilityTrackerPayload {
  generatedAt: string;
  status: string;
  headline: {
    birYearsCount: number;
    yearRange: string;
    meanCapitalPerformancePct: number | null;
    meanRevenuePerformancePct: number | null;
    meanDebtServicePerformancePct: number | null;
    debtServiceOverrunYearsCount: number;
    debtServiceOverrunYears: number[];
    cumulativeDebtServiceOverrunNaira: number;
    partialYearReports: Array<{ financialYear: number; label: string }>;
  };
  administrations: AdministrationCredibilityRow[];
  yearlySeries: MacroCredibilityYearRow[];
}

export interface ScoreGradeMeta {
  grade: 'A' | 'B' | 'C' | 'D' | 'F' | 'N/A';
  label: string;
  color: string;
  bg: string;
  border: string;
}

export function getScoreGradeMeta(score: number | null | undefined): ScoreGradeMeta {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return {
      grade: 'N/A',
      label: 'Uncovered',
      color: '#64748b',
      bg: '#f1f5f9',
      border: '#cbd5e1',
    };
  }
  if (score >= 80) {
    return {
      grade: 'A',
      label: 'High Integrity',
      color: '#047857',
      bg: '#ecfdf5',
      border: '#a7f3d0',
    };
  }
  if (score >= 65) {
    return {
      grade: 'B',
      label: 'Satisfactory',
      color: '#0284c7',
      bg: '#f0f9ff',
      border: '#bae6fd',
    };
  }
  if (score >= 50) {
    return {
      grade: 'C',
      label: 'Moderate Risk',
      color: '#b45309',
      bg: '#fffbeb',
      border: '#fde68a',
    };
  }
  if (score >= 35) {
    return {
      grade: 'D',
      label: 'Elevated Risk',
      color: '#c2410c',
      bg: '#fff7ed',
      border: '#fed7aa',
    };
  }
  return {
    grade: 'F',
    label: 'Critical Scrutiny',
    color: '#b91c1c',
    bg: '#fef2f2',
    border: '#fecaca',
  };
}

/**
 * Recompute composite score purely across pillars that have a non-null numeric score,
 * omitting missing dimensions from the active weight denominator (never scored as 0).
 */
export function computeActiveWeightedScore(
  pillars: Partial<Record<MdaPillarKey, { score: number | null; weight?: number }>>
): {
  compositeScore: number | null;
  metricsPresent: number;
  totalExpectedMetrics: number;
  activeWeightSum: number;
} {
  const keys: MdaPillarKey[] = [
    'paddingRestraint',
    'birCapitalExecution',
    'openBiddingShare',
    'vendorDiversification',
    'cashDiscipline',
  ];
  let weightedSum = 0;
  let activeWeightSum = 0;
  let metricsPresent = 0;

  for (const k of keys) {
    const p = pillars[k];
    if (!p || p.score === null || p.score === undefined || !Number.isFinite(p.score)) {
      continue;
    }
    const wt = typeof p.weight === 'number' && p.weight > 0 ? p.weight : 20;
    weightedSum += p.score * wt;
    activeWeightSum += wt;
    metricsPresent += 1;
  }

  return {
    compositeScore:
      activeWeightSum > 0 ? Number((weightedSum / activeWeightSum).toFixed(1)) : null,
    metricsPresent,
    totalExpectedMetrics: keys.length,
    activeWeightSum,
  };
}

export function normalizeMdaLookupKey(raw: string | null | undefined): string {
  let s = String(raw || '').toUpperCase().trim();
  if (!s) return '';
  s = s.replace(/&/g, ' AND ');
  s = s.replace(
    /(?:\s*-\s*HQTRS|\bHQTRS\b|\bHEADQUARTERS\b|\s*-\s*MAIN\s+MOD\b|\bMAIN\s+MOD\b|\s*-\s*MOD(?:\s+HQTRS)?\b|\bMOD\s+HQTRS\b)/gi,
    ' '
  );
  s = s.replace(/\bFED\.?\s+MIN\.?\s+OF\b/gi, 'FEDERAL MINISTRY OF');
  s = s.replace(/\bMIN\.?\s+OF\b/gi, 'MINISTRY OF');
  s = s.replace(/[^A-Z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(?:FEDERAL\s+MINISTRY\s+OF|FED\s+MINISTRY\s+OF|MINISTRY\s+OF|OFFICE\s+OF\s+THE|OFFICE\s+OF)\s+/i, '').trim();
  return s;
}

const MATCH_STOPWORDS = new Set([
  'FEDERAL',
  'MINISTRY',
  'MINISTRIES',
  'DEPARTMENT',
  'AGENCY',
  'OFFICE',
  'COMMISSION',
  'NATIONAL',
  'NIGERIA',
  'NIGERIAN',
  'HQTRS',
  'AND',
  'THE',
  'FOR',
  'OF',
]);

export function matchMdaScorecardByName(
  entries: MdaScorecardEntry[] | null | undefined,
  rawMdaName: string | null | undefined
): MdaScorecardEntry | null {
  if (!entries || entries.length === 0 || !rawMdaName) return null;
  const qKey = normalizeMdaLookupKey(rawMdaName);
  if (!qKey) return null;

  // 1. Exact coreKey or mdaName match
  const exact = entries.find(
    (e) => e.mdaKey === qKey || normalizeMdaLookupKey(e.mdaName) === qKey
  );
  if (exact) return exact;

  // 2. Prefix / substring match (handles PDF line wrapping truncations like "SCIENCE, TECHNOLOGY AND")
  const prefixCandidates = entries.filter(
    (e) =>
      qKey.length >= 8 &&
      (e.mdaKey.startsWith(qKey) ||
        qKey.startsWith(e.mdaKey) ||
        e.mdaKey.includes(qKey) ||
        (e.mdaKey.length >= 8 && qKey.includes(e.mdaKey)))
  );
  if (prefixCandidates.length > 0) {
    prefixCandidates.sort(
      (a, b) =>
        b.metricsPresent - a.metricsPresent ||
        b.totalTrackedExposureNaira - a.totalTrackedExposureNaira
    );
    return prefixCandidates[0];
  }

  // 3. Distinctive token Jaccard overlap
  const qTokens = new Set(
    qKey
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !MATCH_STOPWORDS.has(t))
  );
  if (qTokens.size === 0) return null;

  let best: MdaScorecardEntry | null = null;
  let bestScore = 0;

  for (const e of entries) {
    const eTokens = new Set(
      e.mdaKey
        .split(/\s+/)
        .filter((t) => t.length >= 3 && !MATCH_STOPWORDS.has(t))
    );
    if (eTokens.size === 0) continue;
    let overlap = 0;
    for (const t of qTokens) {
      if (eTokens.has(t)) overlap += 1;
    }
    if (overlap === 0) continue;
    const union = qTokens.size + eTokens.size - overlap;
    const ratio = overlap / Math.min(qTokens.size, eTokens.size);
    const jaccard = union > 0 ? overlap / union : 0;
    if (ratio >= 0.75 && jaccard > bestScore) {
      bestScore = jaccard;
      best = e;
    }
  }

  return bestScore >= 0.5 ? best : null;
}

export interface OaugfAuditFindingSample {
  docId?: string;
  docTitle: string;
  year: number | null;
  page: number;
  category: string;
  heading: string;
  amountNaira: number;
  mdaKey?: string | null;
  mdaName?: string | null;
  repeatNeglect?: boolean;
  recoveryRequired?: boolean;
  recommendation?: string;
  excerpt: string;
  sourceUrl: string;
}

export interface OaugfMdaAuditSummary {
  mdaKey: string;
  mdaName: string;
  findingCount: number;
  repeatNeglectCount?: number;
  recoveryDirectiveCount?: number;
  totalFlaggedNaira: number;
  reportYears: number[];
  categories: Record<string, number>;
  sampleFindings: OaugfAuditFindingSample[];
}

export interface OaugfAuditIndexPayload {
  generatedAt: string;
  status: string;
  headline: {
    reportsIndexed: number;
    reportsWithFindingsCount?: number;
    totalPages: number;
    totalChunks: number;
    yearsCovered: number[];
    parsedAuditIssuesCount: number;
    repeatNeglectCount?: number;
    recoveryDirectiveCount?: number;
    matchedMdasCount: number;
    categoryCounts: Record<string, number>;
    upstreamMissing404Count?: number;
  };
  upstreamMissing404Reports?: Array<{
    id: number;
    year: number;
    title: string;
    status: string;
  }>;
  shardFiles?: Array<{
    bucket: string;
    path: string;
    count: number;
  }>;
  documents: Array<{
    id: string;
    title: string;
    category: string;
    years: number[];
    publishedDate: string | null;
    pageCount: number;
    issueCount: number;
    sourceUrl: string;
  }>;
  byMda: Record<string, OaugfMdaAuditSummary>;
  topIssues: Array<
    OaugfAuditFindingSample & {
      docId: string;
      mdaKey: string | null;
      mdaName: string | null;
    }
  >;
  issues?: OaugfAuditFindingSample[];
}

let cachedScorecardsPromise: Promise<MdaIntegrityScorecardsPayload | null> | null = null;
let cachedMacroPromise: Promise<MacroCredibilityTrackerPayload | null> | null = null;
let cachedOaugfPromise: Promise<OaugfAuditIndexPayload | null> | null = null;

export function loadMdaIntegrityScorecards(): Promise<MdaIntegrityScorecardsPayload | null> {
  if (!cachedScorecardsPromise) {
    cachedScorecardsPromise = fetchDataset<MdaIntegrityScorecardsPayload>(
      'mda_integrity_scorecards'
    ).catch(() => null);
  }
  return cachedScorecardsPromise;
}

export function loadMacroCredibilityTracker(): Promise<MacroCredibilityTrackerPayload | null> {
  if (!cachedMacroPromise) {
    cachedMacroPromise = fetchDataset<MacroCredibilityTrackerPayload>(
      'macro_credibility_tracker'
    ).catch(() => null);
  }
  return cachedMacroPromise;
}

export function loadOaugfAuditIndex(): Promise<OaugfAuditIndexPayload | null> {
  if (!cachedOaugfPromise) {
    cachedOaugfPromise = fetchDataset<OaugfAuditIndexPayload>(
      'oaugf_audit_index'
    ).catch(() => null);
  }
  return cachedOaugfPromise;
}

export function lookupOaugfMdaFindings(
  index: OaugfAuditIndexPayload | null | undefined,
  rawMdaName: string | null | undefined
): OaugfMdaAuditSummary | null {
  if (!index?.byMda || !rawMdaName) return null;
  const qKey = normalizeMdaLookupKey(rawMdaName);
  if (!qKey) return null;
  if (index.byMda[qKey]) return index.byMda[qKey];
  for (const [key, summary] of Object.entries(index.byMda)) {
    if (qKey.length >= 8 && (key.includes(qKey) || qKey.includes(key))) {
      return summary;
    }
  }
  return null;
}

export interface RedFlagConvergenceMdaEntry {
  mdaKey: string;
  mdaName: string;
  flagCount: number;
  flags: string[];
  flagDetails: string[];
  compositeScore: number | null;
  grade: string;
  oaugfQueryCount: number;
  oaugfRepeatCount: number;
  totalExposureNaira: number;
}

export interface RedFlagConvergenceContractorEntry {
  contractorKey: string;
  contractorName: string;
  bppContractorId: string | null;
  flagCount: number;
  flags: string[];
  flagDetails: string[];
  totalExposureNaira: number;
  awardedNaira: number;
  govspendPaidNaira: number;
  excessOverAwardNaira: number;
  overrunDeltaNaira: number;
  nonCompetitiveNaira: number;
  mdasInvolved: string[];
}

export interface RedFlagConvergencePayload {
  generatedAt: string;
  status: string;
  headline: {
    convergentContractorCount: number;
    highRisk3PlusContractorCount: number;
    convergentContractorExposureNaira: number;
    convergentMdaCount: number;
    highRisk3PlusMdaCount: number;
  };
  contractors: RedFlagConvergenceContractorEntry[];
  mdas: RedFlagConvergenceMdaEntry[];
}

export interface OaugfProcurementViolationSummary {
  mdaKey: string;
  mdaName: string;
  totalQueries: number;
  repeatNeglectCount: number;
  recoveryDirectiveCount: number;
  procurementViolationCount: number;
  contractOverpaymentCount: number;
  totalFlaggedNaira: number;
}

let cachedConvergencePromise: Promise<RedFlagConvergencePayload | null> | null = null;

export function loadRedFlagConvergenceIndex(): Promise<RedFlagConvergencePayload | null> {
  if (!cachedConvergencePromise) {
    cachedConvergencePromise = fetchDataset<RedFlagConvergencePayload>('red_flag_convergence_index').catch(() => null);
  }
  return cachedConvergencePromise;
}

const CONVERGENCE_FLAG_LABELS: Record<string, string> = {
  OPAQUE_OR_STAFF_PAYOUTS: 'Personal / Opaque Cash',
  HIGH_OAUGF_NEGLIGENCE: 'OAuGF Audit Queries',
  DECEMBER_RUSH_OR_SPLITTING: 'December Rush / Splits',
  HIGH_LEGISLATIVE_PADDING: 'High Legislative Padding',
  HIGH_NON_COMPETITIVE_OR_OVERRUN: 'Non-Competitive / Overruns',
  LOW_INTEGRITY_GRADE: 'Low Scorecard Grade (D/F)',
  OVERPAID_GT_125_PCT: 'Treasury >125% of Award',
  NON_COMPETITIVE_PROCUREMENT: 'Non-Competitive Award',
  CONTRACT_VARIATION_OVERRUN: 'Payment Overrun',
  CAPTIVE_OR_MULTI_MDA_DOMINANCE: 'Captive / Multi-MDA Reach',
  PADDED_OR_ZOMBIE_LINEAGE_LINK: 'Padded / Repeat Lineage',
};

export function formatConvergenceFlagLabel(flagId: string): string {
  return CONVERGENCE_FLAG_LABELS[flagId] || flagId.replace(/_/g, ' ');
}

export function normalizeContractorLookupKey(raw: string | null | undefined): string {
  let s = String(raw || '').toUpperCase().trim();
  if (!s) return '';
  s = s.replace(/&/g, ' AND ');
  s = s.replace(/[^A-Z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
  const replacements: Array<[RegExp, string]> = [
    [/\bNIGERIA\b/g, 'NIG'],
    [/\bLIMITED\b/g, 'LTD'],
    [/\bINTERNATIONAL\b/g, 'INTL'],
    [/\bSERVICES\b/g, 'SVCS'],
    [/\bSERVICE\b/g, 'SVC'],
    [/\bCOMPANY\b/g, 'CO'],
  ];
  for (const [re, sub] of replacements) {
    s = s.replace(re, sub);
  }
  return s.replace(/\s+/g, ' ').trim();
}

export function lookupMdaConvergence(
  payload: RedFlagConvergencePayload | null | undefined,
  rawMdaName: string | null | undefined,
  rawMdaKey?: string | null
): RedFlagConvergenceMdaEntry | null {
  const mdas = payload?.mdas;
  if (!mdas || mdas.length === 0) return null;

  const keyDirect = String(rawMdaKey || '').toUpperCase().trim();
  const qKey = normalizeMdaLookupKey(rawMdaName) || normalizeMdaLookupKey(keyDirect);
  if (!qKey && !keyDirect) return null;

  // 1. Exact key or normalized name match
  const exact = mdas.find(
    (e) =>
      (keyDirect && e.mdaKey === keyDirect) ||
      (qKey && (e.mdaKey === qKey || normalizeMdaLookupKey(e.mdaName) === qKey))
  );
  if (exact) return exact;
  if (!qKey) return null;

  // 2. Prefix / substring fallback for slightly truncated names
  const prefixCandidates = mdas.filter(
    (e) =>
      qKey.length >= 8 &&
      (e.mdaKey.startsWith(qKey) ||
        qKey.startsWith(e.mdaKey) ||
        e.mdaKey.includes(qKey) ||
        (e.mdaKey.length >= 8 && qKey.includes(e.mdaKey)))
  );
  if (prefixCandidates.length > 0) {
    return [...prefixCandidates].sort(
      (a, b) => b.flagCount - a.flagCount || b.totalExposureNaira - a.totalExposureNaira
    )[0];
  }

  // 3. Token Jaccard overlap using shared stopwords
  const qTokens = new Set(
    qKey.split(/\s+/).filter((t) => t.length >= 3 && !MATCH_STOPWORDS.has(t))
  );
  if (qTokens.size === 0) return null;

  let best: RedFlagConvergenceMdaEntry | null = null;
  let bestScore = 0;
  for (const e of mdas) {
    const eTokens = new Set(
      e.mdaKey.split(/\s+/).filter((t) => t.length >= 3 && !MATCH_STOPWORDS.has(t))
    );
    if (eTokens.size === 0) continue;
    let overlap = 0;
    for (const t of qTokens) {
      if (eTokens.has(t)) overlap += 1;
    }
    if (overlap === 0) continue;
    const union = qTokens.size + eTokens.size - overlap;
    const ratio = overlap / Math.min(qTokens.size, eTokens.size);
    const jaccard = union > 0 ? overlap / union : 0;
    if (ratio >= 0.75 && jaccard > bestScore) {
      bestScore = jaccard;
      best = e;
    }
  }

  return bestScore >= 0.5 ? best : null;
}

export function lookupContractorConvergence(
  payload: RedFlagConvergencePayload | null | undefined,
  contractorName: string | null | undefined,
  bppContractorId?: string | null
): RedFlagConvergenceContractorEntry | null {
  const contractors = payload?.contractors;
  if (!contractors || contractors.length === 0) return null;

  const cleanBpp = String(bppContractorId || '').trim().toUpperCase();
  if (cleanBpp) {
    const byBpp = contractors.find(
      (c) => String(c.bppContractorId || '').trim().toUpperCase() === cleanBpp
    );
    if (byBpp) return byBpp;
  }

  const cKey = normalizeContractorLookupKey(contractorName);
  if (!cKey) return null;

  const exact = contractors.find(
    (c) => c.contractorKey === cKey || normalizeContractorLookupKey(c.contractorName) === cKey
  );
  if (exact) return exact;

  if (cKey.length >= 10) {
    const subMatches = contractors.filter(
      (c) =>
        c.contractorKey.length >= 10 &&
        (c.contractorKey.includes(cKey) || cKey.includes(c.contractorKey))
    );
    if (subMatches.length > 0) {
      return [...subMatches].sort(
        (a, b) => b.flagCount - a.flagCount || b.totalExposureNaira - a.totalExposureNaira
      )[0];
    }
  }

  return null;
}

export function lookupOaugfProcurementViolations(
  index: OaugfAuditIndexPayload | null | undefined,
  rawMdaName: string | null | undefined
): OaugfProcurementViolationSummary | null {
  const found = lookupOaugfMdaFindings(index, rawMdaName);
  if (!found || found.findingCount === 0) return null;
  const cats = found.categories || {};
  return {
    mdaKey: found.mdaKey,
    mdaName: found.mdaName,
    totalQueries: found.findingCount,
    repeatNeglectCount: found.repeatNeglectCount || 0,
    recoveryDirectiveCount: found.recoveryDirectiveCount || 0,
    procurementViolationCount: cats['Procurement & Due Process Violations'] || 0,
    contractOverpaymentCount: cats['Contract Overpayments & Abandoned Works'] || 0,
    totalFlaggedNaira: found.totalFlaggedNaira || 0,
  };
}

export interface OaugfAssetAuditSummary {
  mdaKey: string;
  mdaName: string;
  totalQueries: number;
  repeatNeglectCount: number;
  recoveryDirectiveCount: number;
  assetManagementCount: number;
  unvouchedCount: number;
  unretiredAdvanceCount: number;
  totalFlaggedNaira: number;
}

export function lookupOaugfAssetAndUnvouched(
  index: OaugfAuditIndexPayload | null | undefined,
  rawMdaName: string | null | undefined
): OaugfAssetAuditSummary | null {
  const found = lookupOaugfMdaFindings(index, rawMdaName);
  if (!found || found.findingCount === 0) return null;
  const cats = found.categories || {};
  return {
    mdaKey: found.mdaKey,
    mdaName: found.mdaName,
    totalQueries: found.findingCount,
    repeatNeglectCount: found.repeatNeglectCount || 0,
    recoveryDirectiveCount: found.recoveryDirectiveCount || 0,
    assetManagementCount: cats['Internal Control & Asset Management'] || 0,
    unvouchedCount: cats['Unvouched / Missing Payment Vouchers'] || 0,
    unretiredAdvanceCount: cats['Unretired Advances & Cash Irregularities'] || 0,
    totalFlaggedNaira: found.totalFlaggedNaira || 0,
  };
}
