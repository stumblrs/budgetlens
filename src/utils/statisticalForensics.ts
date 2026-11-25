export type BenfordConformityBand =
  | 'CLOSE_CONFORMITY'
  | 'ACCEPTABLE'
  | 'MARGINAL'
  | 'NON_CONFORMITY'
  | 'INSUFFICIENT_SAMPLE';

export type BenfordAuditRating =
  | 'HIGH_INTEGRITY'
  | 'MODERATE_RISK'
  | 'HIGH_ANOMALY_RISK'
  | 'INSUFFICIENT_SAMPLE';

export interface BenfordDigitBreakdown {
  digit: number;
  actualCount: number;
  actualPct: number;
  expectedPct: number;
  deviationPct: number;
  zScore: number;
  status: 'Normal' | 'Abnormally High' | 'Abnormally Low';
}

export interface BenfordFlaggedMda {
  mdaName: string;
  recordCount: number;
  mad: number;
  chiSquareStat: number;
  chiSquarePValue: number;
  conformityBand: BenfordConformityBand;
  topSuspiciousDigit: number;
  topDigitDeviationPct: number;
  totalAmountNaira: number;
}

export interface BenfordAnalysisResult {
  financialYear: number;
  validRecordCount: number;
  meanAbsoluteDeviation: number;
  chiSquareStat: number;
  chiSquarePValue: number;
  conformityBand: BenfordConformityBand;
  auditRating: BenfordAuditRating;
  benfordIntegrityScore: number;
  breakdown: BenfordDigitBreakdown[];
  flaggedMdas: BenfordFlaggedMda[];
}

export interface BenfordYearTrendPoint {
  financialYear: number;
  validRecordCount: number;
  meanAbsoluteDeviation: number;
  chiSquareStat: number;
  chiSquarePValue: number;
  conformityBand: BenfordConformityBand;
  auditRating: BenfordAuditRating;
  benfordIntegrityScore: number;
  coverageTier?: string;
}

export type VirementCategoryKey =
  | 'SERVICE_WIDE_VOTE'
  | 'SUPPLEMENTARY_VIREMENT'
  | 'CONTINGENCY_RESERVE'
  | 'SPECIAL_EMERGENCY';

export interface VirementRecordSummary {
  id: string;
  projectCode: string;
  projectName: string;
  agency: string;
  amount: number;
  page: number;
  financialYear: number;
  spendingType?: string;
  categoryKey: VirementCategoryKey;
  sourceFilename?: string;
}

export interface VirementCategorySummary {
  key: VirementCategoryKey;
  label: string;
  count: number;
  totalNaira: number;
}

export interface VirementAnalyticsResult {
  financialYear: number;
  virementRecordCount: number;
  totalNaira: number;
  totalNairaFormatted: string;
  categoryBreakdown: VirementCategorySummary[];
  records: VirementRecordSummary[];
  topRecords?: VirementRecordSummary[];
}

export interface DuplicateRingRecordSummary {
  id: string;
  projectCode: string;
  projectName?: string;
  agency: string;
  amount: number;
  page: number;
  financialYear: number;
  spendingType?: string;
  sourceFilename?: string;
}

export interface DuplicateRingCluster {
  clusterId: string;
  normalizedTitle: string;
  itemCount: number;
  totalNaira: number;
  totalNairaFormatted: string;
  mdasInvolved: string[];
  /** @deprecated Kept for backward compatibility; prefer `mdasInvolved`. */
  mdasIninvolved?: string[];
  isCrossMda: boolean;
  isBoilerplateOverhead: boolean;
  sampleRecords: DuplicateRingRecordSummary[];
}

export interface DuplicateRingsYearSummary {
  financialYear: number;
  totalRings: number;
  crossMdaRingsCount: number;
  boilerplateRingsCount: number;
  totalExposureNaira: number;
  topRings: DuplicateRingCluster[];
  boilerplateSampleRings?: DuplicateRingCluster[];
}

export interface PrematureReplacementRecordSummary {
  id: string;
  projectCode: string;
  projectName: string;
  agency: string;
  amount: number;
  page: number;
  financialYear: number;
  spendingType?: string;
  sourceFilename?: string;
}

export interface PrematureReplacementAlert {
  mdaName: string;
  normalizedMdaName?: string;
  assetCategory: string;
  assetCategoryLabel: string;
  recentAllocationsCount: number;
  totalSpentNaira: number;
  totalSpentFormatted: string;
  yearsActive: number[];
  minGapYears: number;
  antiquityLifespanYears: number;
  earliestAcquisitionYear: number;
  latestAcquisitionYear: number;
  activeInventoryTally: number;
  wasteRisk: 'HIGH' | 'MEDIUM';
  reason: string;
  sampleRecords: PrematureReplacementRecordSummary[];
}

export interface PrecomputedStatisticalForensics {
  generatedAt: string;
  yearsCovered: number[];
  summary: {
    totalRecordsAnalyzed: number;
    nonConformingYearsCount: number;
    marginalYearsCount: number;
    insufficientSampleYearsCount: number;
    totalPrematureAlerts: number;
    totalVirementExposureNaira: number;
    totalCrossMdaRings: number;
  };
  benfordTrend: BenfordYearTrendPoint[];
  prematureReplacementAlerts: PrematureReplacementAlert[];
  byYear: Record<
    string,
    {
      benford: BenfordAnalysisResult;
      virements: VirementAnalyticsResult;
      duplicateRings: DuplicateRingsYearSummary;
    }
  >;
}

export const ASSET_CATEGORY_META: Record<string, { label: string; lifespanYears: number }> = {
  vehicles_mobility: { label: 'Vehicles & Official Fleets', lifespanYears: 5 },
  office_tech: { label: 'ICT, Laptops & Office Equipment', lifespanYears: 4 },
  water_boreholes: { label: 'Boreholes & Water Supply Works', lifespanYears: 7 },
  power_utilities: { label: 'Generators, Solar & Power Grids', lifespanYears: 8 },
  healthcare: { label: 'Hospital & Medical Equipment', lifespanYears: 8 },
  education: { label: 'School Infrastructure & Learning Gear', lifespanYears: 10 },
  road_infrastructure: { label: 'Roads, Bridges & Heavy Civil Works', lifespanYears: 15 },
};

export const VIREMENT_CATEGORY_DEFS: Array<{
  key: VirementCategoryKey;
  label: string;
  keywords: string[];
}> = [
  {
    key: 'SERVICE_WIDE_VOTE',
    label: 'Service-Wide & Margin Votes',
    keywords: ['service wide', 'service-wide', 'margin for increase'],
  },
  {
    key: 'SUPPLEMENTARY_VIREMENT',
    label: 'Supplementary & Virement Lines',
    keywords: ['virement', 'reallocation', 'supplementary', 'off-budget', 'capital supplementation'],
  },
  {
    key: 'CONTINGENCY_RESERVE',
    label: 'Contingency & Unforeseen Reserves',
    keywords: ['contingency', 'unforeseen', 'reserve fund'],
  },
  {
    key: 'SPECIAL_EMERGENCY',
    label: 'Special & Emergency Interventions',
    keywords: ['special intervention', 'emergency injection', 'emergency intervention', 'emergency relief', 'emergency'],
  },
];

const BENFORD_EXPECTED_PROB: Record<number, number> = Object.fromEntries(
  Array.from({ length: 9 }, (_, i) => {
    const d = i + 1;
    return [d, Math.log10(1 + 1 / d)];
  })
);

const GENERIC_MDA_EXACT = new Set([
  '',
  'general federal',
  'unknown mda',
  'unknown',
  'federal government',
  'unspecified',
  'n/a',
  'na',
  'none',
  'federal mda',
  'ministry / mda',
  'total',
  'sub-total',
  'subtotal',
]);

const BOILERPLATE_OVERHEAD_RE =
  /(local travel|international travel|office stationeries|computer consumables|electricity charges|telephone charges|bank charges|postages & courier|publicity & advertisements|security services|cleaning & fumigation|maintenance of office|maintenance of motor|training - local|welfare packages|water rates|motor vehicle fuel cost|internet access charges|uniforms & other clothing|honorarium|refreshment & meals|drugs & medical supplies|miscellaneous)/i;

export const ROUTINE_CONSUMABLE_RE =
  /\b(stationer\w*|consumables?|maintenance|repairs?|fuelling|fuel|lubricants?|insurance|training|workshops?|seminars?|conferences?|consultanc\w*|internet|telephone|electricity|water rates?|cleaning|security services?|allowances?|honorari\w*|sitting|refreshments?|monitoring|evaluation|supervision|retainer\w*|subscriptions?|rent|hire|lease|printing|publicity|adverts?|advertisements?|audit fees?|drugs?\s*&\s*medical|bank charges|postages?|uniforms?)\b/i;

export const DURABLE_ACTION_RE =
  /\b(purchase|procurement|supply|acquisition|construction|rehabilitation|equipping|installation)\b/i;

export const DURABLE_CATEGORY_RULES: Array<{ key: string; pattern: RegExp }> = [
  {
    key: 'vehicles_mobility',
    pattern: /\b(suvs?|prado|land\s*cruiser|hilux|pick-?up|operational vehicles?|utility vehicles?|official vehicles?|staff bus(?:es)?|coaster bus(?:es)?|ambulance(?:s)?|patrol vehicles?)\b/i,
  },
  {
    key: 'office_tech',
    pattern: /\b(laptops?|desktops?|computers?|servers?|photocopiers?|printers?|scanners?|ict equipment|ict infrastructure)\b/i,
  },
  {
    key: 'power_utilities',
    pattern: /\b(generators?|generating sets?|transformers?|solar street\s*lights?|solar mini[- ]?grids?|inverters?)\b/i,
  },
  {
    key: 'water_boreholes',
    pattern: /\b(motorized boreholes?|solar boreholes?|boreholes?|water treatment plants?)\b/i,
  },
  {
    key: 'healthcare',
    pattern: /\b(medical equipment|diagnostic equipment|hospital equipment|mri|ct scan|x-ray|primary healthcare cent(?:re|er)s?)\b/i,
  },
];

export function extractLeadingDigit(amount: number): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const mantissa = String(amount).split(/[eE]/)[0];
  for (let i = 0; i < mantissa.length; i++) {
    const ch = mantissa[i];
    if (ch >= '1' && ch <= '9') {
      return Number(ch);
    }
  }
  return null;
}

/**
 * Exact survival function P(Chi2_8 >= chiSquare) for 8 degrees of freedom (df/2 = 4).
 */
export function chiSquarePValueDf8(chiSquare: number): number {
  if (!Number.isFinite(chiSquare) || chiSquare <= 0) return 1.0;
  const u = chiSquare / 2.0;
  if (u > 700) return 0.0;
  const poly = 1 + u + (u * u) / 2 + (u * u * u) / 6;
  const p = Math.exp(-u) * poly;
  return Math.max(0, Math.min(1, p));
}

export function classifyBenfordConformity(
  mad: number,
  validRecordCount: number
): { conformityBand: BenfordConformityBand; auditRating: BenfordAuditRating } {
  if (!Number.isFinite(validRecordCount) || validRecordCount < 30) {
    return { conformityBand: 'INSUFFICIENT_SAMPLE', auditRating: 'INSUFFICIENT_SAMPLE' };
  }
  if (mad <= 0.006) {
    return { conformityBand: 'CLOSE_CONFORMITY', auditRating: 'HIGH_INTEGRITY' };
  }
  if (mad <= 0.012) {
    return { conformityBand: 'ACCEPTABLE', auditRating: 'HIGH_INTEGRITY' };
  }
  if (mad <= 0.015) {
    return { conformityBand: 'MARGINAL', auditRating: 'MODERATE_RISK' };
  }
  return { conformityBand: 'NON_CONFORMITY', auditRating: 'HIGH_ANOMALY_RISK' };
}

export function isValidMdaName(name: string | null | undefined): boolean {
  if (!name || typeof name !== 'string') return false;
  const cleaned = name.replace(/\s+/g, ' ').trim();
  if (cleaned.length < 4 || cleaned.length > 90) return false;
  if (GENERIC_MDA_EXACT.has(cleaned.toLowerCase())) return false;
  if (/^[\d,.\s₦$+\-/()]+$/.test(cleaned)) return false;
  if (/^KM\s*\d+/i.test(cleaned)) return false;
  const upper = cleaned.toUpperCase();
  if (upper.includes('CONSTITUENCY IN ') || upper.includes('DESIGN, DEVELOPMENT AND PERFORMANCE')) {
    return false;
  }
  return /[A-Za-z]{3,}/.test(cleaned);
}

export function normalizeMdaClusterName(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*[-–]\s*HQTRS\.?$/i, '')
    .replace(/\s+HQTRS\.?$/i, '')
    .toUpperCase();
}

export function classifyVirementCategory(
  projectName: string,
  spendingType = ''
): VirementCategoryKey | null {
  const combined = `${projectName || ''} ${spendingType || ''}`.toLowerCase();
  for (const def of VIREMENT_CATEGORY_DEFS) {
    if (def.keywords.some((kw) => combined.includes(kw))) {
      return def.key;
    }
  }
  return null;
}

export function isBoilerplateOverheadTitle(title: string, spendingType = 'CAPITAL'): boolean {
  if ((spendingType || '').toUpperCase() !== 'CAPITAL') return true;
  return BOILERPLATE_OVERHEAD_RE.test(title || '');
}

export function computeBenfordFromAmounts(
  amounts: number[],
  financialYear: number,
  mdaPairs?: Array<{ mdaName: string; amount: number }>
): BenfordAnalysisResult {
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
  let validCount = 0;

  for (const amt of amounts) {
    const d = extractLeadingDigit(amt);
    if (d !== null) {
      counts[d] += 1;
      validCount += 1;
    }
  }

  let madSum = 0;
  let chi2 = 0;
  const breakdown: BenfordDigitBreakdown[] = [];

  for (let d = 1; d <= 9; d++) {
    const pe = BENFORD_EXPECTED_PROB[d];
    const actualCount = counts[d];
    const po = validCount > 0 ? actualCount / validCount : 0;
    const actualPct = po * 100;
    const expectedPct = pe * 100;
    const deviationPct = actualPct - expectedPct;

    let zScore = 0;
    if (validCount > 0) {
      madSum += Math.abs(po - pe);
      const expectedCount = validCount * pe;
      chi2 += ((actualCount - expectedCount) ** 2) / expectedCount;
      const sigma = Math.sqrt((pe * (1 - pe)) / validCount);
      const diff = po - pe;
      const absAdj = Math.max(0, Math.abs(diff) - 0.5 / validCount);
      zScore = sigma > 0 ? (absAdj / sigma) * (diff >= 0 ? 1 : -1) : 0;
    }

    let status: BenfordDigitBreakdown['status'] = 'Normal';
    if (validCount >= 30 && Math.abs(zScore) >= 1.96) {
      status = deviationPct > 0 ? 'Abnormally High' : 'Abnormally Low';
    }

    breakdown.push({
      digit: d,
      actualCount,
      actualPct: Number(actualPct.toFixed(2)),
      expectedPct: Number(expectedPct.toFixed(2)),
      deviationPct: Number(deviationPct.toFixed(2)),
      zScore: Number(zScore.toFixed(2)),
      status,
    });
  }

  const mad = validCount > 0 ? madSum / 9 : 0;
  const chiSquarePValue = validCount > 0 ? chiSquarePValueDf8(chi2) : 1;
  const { conformityBand, auditRating } = classifyBenfordConformity(mad, validCount);
  const benfordIntegrityScore =
    validCount < 30 ? 0 : Math.max(0, Math.min(100, Math.round(100 * Math.exp(-26 * mad))));

  const flaggedMdas: BenfordFlaggedMda[] = [];
  if (mdaPairs && mdaPairs.length > 0) {
    const byMda = new Map<string, number[]>();
    for (const pair of mdaPairs) {
      if (!isValidMdaName(pair.mdaName) || extractLeadingDigit(pair.amount) === null) continue;
      const cleanName = pair.mdaName.replace(/\s+/g, ' ').trim();
      const arr = byMda.get(cleanName);
      if (arr) arr.push(pair.amount);
      else byMda.set(cleanName, [pair.amount]);
    }

    byMda.forEach((mAmounts, mdaName) => {
      if (mAmounts.length < 50) return;
      const sub = computeBenfordFromAmounts(mAmounts, financialYear);
      const topDigitRow = sub.breakdown.reduce(
        (best, cur) => (Math.abs(cur.zScore) > Math.abs(best.zScore) ? cur : best),
        sub.breakdown[0]
      );
      flaggedMdas.push({
        mdaName,
        recordCount: sub.validRecordCount,
        mad: sub.meanAbsoluteDeviation,
        chiSquareStat: sub.chiSquareStat,
        chiSquarePValue: sub.chiSquarePValue,
        conformityBand: sub.conformityBand,
        topSuspiciousDigit: topDigitRow.digit,
        topDigitDeviationPct: topDigitRow.deviationPct,
        totalAmountNaira: Math.round(mAmounts.reduce((s, a) => s + a, 0)),
      });
    });

    flaggedMdas.sort((a, b) => b.mad - a.mad || b.totalAmountNaira - a.totalAmountNaira);
    if (flaggedMdas.length > 20) {
      flaggedMdas.length = 20;
    }
  }

  return {
    financialYear,
    validRecordCount: validCount,
    meanAbsoluteDeviation: Number(mad.toFixed(6)),
    chiSquareStat: Number(chi2.toFixed(3)),
    chiSquarePValue: Number(chiSquarePValue.toFixed(6)),
    conformityBand,
    auditRating,
    benfordIntegrityScore,
    breakdown,
    flaggedMdas,
  };
}
