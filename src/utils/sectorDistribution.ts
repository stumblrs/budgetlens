import type { BudgetRecord } from '../services/budgetDatabaseEngine';
import {
  buildCompoundProjectLookup,
  findCompoundForProject,
  type CompoundFlaggedProject,
} from './ruleEngine';
import {
  formatConvergenceFlagLabel,
  getScoreGradeMeta,
  lookupMdaConvergence,
  lookupOaugfMdaFindings,
  matchMdaScorecardByName,
  type MdaScorecardEntry,
  type OaugfAuditIndexPayload,
  type RedFlagConvergencePayload,
} from './mdaScorecard';

export type DistributionDimension = 'sector' | 'mda';

export interface DistributionInputEntry {
  rank?: number;
  name: string;
  amount: number;
  sharePct?: number;
  projectCount?: number;
}

export interface GroupFlaggedSummary {
  projectCount: number;
  totalAmount: number;
  flaggedCount: number;
  flaggedAmount: number;
  compoundCount: number;
  maxRiskScore: number;
}

export interface MdaSliceAuditMeta {
  grade: string;
  compositeScore: number | null;
  gradeColor: string;
  gradeBg: string;
  gradeBorder: string;
  oaugfQueries: number;
  oaugfRepeatCount: number;
  convergenceFlagCount: number;
  convergenceLabels: string[];
}

export interface DistributionSlice {
  rank: number;
  name: string;
  fullName: string;
  shortLabel: string;
  amount: number;
  sharePct: number;
  projectCount?: number;
  color: string;
  isOther: boolean;
  otherEntityCount?: number;
  priorAmount: number | null;
  priorSharePct: number | null;
  yoyDeltaPct: number | null;
  shareShiftPts: number | null;
  flaggedCount: number;
  flaggedAmount: number;
  flaggedSharePct: number | null;
  compoundCount: number;
  mdaAudit?: MdaSliceAuditMeta | null;
}

export interface ReconciledDistributionSummary {
  slices: DistributionSlice[];
  allRankedEntries: DistributionSlice[];
  totalAmount: number;
  totalEntitiesCount: number;
  top3SharePct: number;
  priorTotalAmount: number | null;
  totalYoyDeltaPct: number | null;
}

export const OTHER_SLICE_COLOR = '#94a3b8';

export const SECTOR_COLOR_PALETTE: Record<string, string> = {
  'General Administration': '#334155',
  'Works & Housing': '#0284c7',
  'Defence & Security': '#dc2626',
  Education: '#16a34a',
  'Health & Social Welfare': '#0d9488',
  'Power & Energy': '#ea580c',
  'Agriculture & Water': '#65a30d',
  'Transport & Aviation': '#2563eb',
  'ICT & Science': '#7c3aed',
  'Finance & Economy': '#d97706',
  'Justice & Legislature': '#9333ea',
};

export const MDA_DISTINCT_COLORS: readonly string[] = [
  '#0f172a',
  '#2563eb',
  '#0284c7',
  '#059669',
  '#d97706',
  '#dc2626',
  '#7c3aed',
  '#0d9488',
];

const UPPER_ACRONYMS = new Set([
  'FCT',
  'ICT',
  'NIMC',
  'NDDC',
  'NYSC',
  'EFCC',
  'FRSC',
  'INEC',
  'NNPC',
  'UBEC',
  'TETFUND',
  'CBN',
  'FIRS',
  'NASS',
  'DSS',
  'ONSA',
  'PHCN',
  'NERC',
  'NPA',
  'FAAN',
  'NAMA',
  'NCAA',
  'FERMA',
  'BPP',
  'OAuGF',
  'MDA',
  'MDAs',
  'SGF',
]);

function smartTitleCase(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, idx) => {
      const bare = word.replace(/[^A-Za-z0-9]/g, '');
      const upperBare = bare.toUpperCase();
      if (UPPER_ACRONYMS.has(upperBare)) {
        return word.toUpperCase();
      }
      if (idx > 0 && /^(AND|OF|FOR|THE|IN|ON|TO|&)$/i.test(word)) {
        return word.toLowerCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

export function shortenEntityLabel(raw: string, maxLen = 28): string {
  let clean = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!clean) return 'Unknown Entity';

  clean = clean
    .replace(/^FEDERAL MINISTRY OF\s+/i, '')
    .replace(/^MINISTRY OF\s+/i, '')
    .replace(/^OFFICE OF THE SECRETARY TO THE GOVERNMENT OF THE FEDERATION\b/i, 'OSGF / SGF')
    .replace(/^OFFICE OF THE NATIONAL SECURITY ADVISER\b/i, 'ONSA (Security)')
    .replace(/^OFFICE OF THE HEAD OF THE CIVIL SERVICE OF THE FEDERATION\b/i, 'Head of Civil Service')
    .replace(/^OFFICE OF THE\s+/i, 'Office of ');

  const upperChars = (clean.match(/[A-Z]/g) || []).length;
  const letterChars = (clean.match(/[A-Za-z]/g) || []).length;
  if (letterChars > 0 && upperChars / letterChars > 0.72) {
    clean = smartTitleCase(clean);
  }

  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
}

export function normalizeGroupLookupKey(raw: string | null | undefined): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function resolveMdaGroupKey(record: BudgetRecord): string {
  const mda = record.mdaGovernanceTaxonomy?.mdaName;
  const rawSector = record.mdaGovernanceTaxonomy?.sector;
  if (mda && mda !== 'General Federal') return mda.trim();
  if (rawSector && rawSector !== 'Capital Infrastructure') return rawSector.trim();
  return 'General Federal Administration';
}

export function resolveSectorGroupKey(record: BudgetRecord): string {
  const rawSector = record.mdaGovernanceTaxonomy?.sector;
  return rawSector && rawSector.trim() ? rawSector.trim() : 'General Administration';
}

export function computeFlaggedExposureByGroup(
  records: BudgetRecord[] | null | undefined,
  compoundProjects: CompoundFlaggedProject[] | null | undefined,
  financialYear: number
): {
  bySector: Record<string, GroupFlaggedSummary>;
  byMda: Record<string, GroupFlaggedSummary>;
} {
  const bySector: Record<string, GroupFlaggedSummary> = {};
  const byMda: Record<string, GroupFlaggedSummary> = {};
  if (!records || records.length === 0) {
    return { bySector, byMda };
  }

  const lookup = buildCompoundProjectLookup(compoundProjects);

  const accumulate = (
    bucketMap: Record<string, GroupFlaggedSummary>,
    rawKey: string,
    amt: number,
    isFlagged: boolean,
    compound: CompoundFlaggedProject | null
  ) => {
    const k = normalizeGroupLookupKey(rawKey);
    if (!k) return;
    if (!bucketMap[k]) {
      bucketMap[k] = {
        projectCount: 0,
        totalAmount: 0,
        flaggedCount: 0,
        flaggedAmount: 0,
        compoundCount: 0,
        maxRiskScore: 0,
      };
    }
    const bucket = bucketMap[k];
    bucket.projectCount += 1;
    bucket.totalAmount += amt;
    if (isFlagged) {
      bucket.flaggedCount += 1;
      bucket.flaggedAmount += amt;
    }
    if (compound) {
      bucket.compoundCount += 1;
      if (compound.compoundRiskScore > bucket.maxRiskScore) {
        bucket.maxRiskScore = compound.compoundRiskScore;
      }
    }
  };

  for (const r of records) {
    const amt = Number(r.recordIdentity?.amountNaira) || 0;
    const compound = findCompoundForProject(lookup, financialYear, {
      id: r.recordIdentity?.id,
      projectCode: r.recordIdentity?.projectCode,
      projectName: r.recordIdentity?.verbatimProjectName,
      page: Number(r.sourceProvenance?.pdfPage ?? 1) || 1,
      amount: amt,
    });
    const isFlagged = compound !== null || (r.forensicEvidenceFlags?.length ?? 0) > 0;
    accumulate(bySector, resolveSectorGroupKey(r), amt, isFlagged, compound);
    accumulate(byMda, resolveMdaGroupKey(r), amt, isFlagged, compound);
  }

  return { bySector, byMda };
}

function buildMdaAuditMeta(
  mdaName: string,
  mdaScorecards?: MdaScorecardEntry[] | null,
  oaugfIndex?: OaugfAuditIndexPayload | null,
  convergenceIndex?: RedFlagConvergencePayload | null
): MdaSliceAuditMeta | null {
  const scorecard = matchMdaScorecardByName(mdaScorecards, mdaName);
  const oaugf = lookupOaugfMdaFindings(oaugfIndex, mdaName);
  const convergence = lookupMdaConvergence(convergenceIndex, mdaName, scorecard?.mdaKey);

  if (!scorecard && !oaugf && !convergence) {
    return null;
  }

  const gradeMeta = getScoreGradeMeta(scorecard?.compositeScore ?? convergence?.compositeScore ?? null);
  const convFlags = convergence?.flags || [];

  return {
    grade: scorecard?.grade || convergence?.grade || gradeMeta.grade,
    compositeScore: scorecard?.compositeScore ?? convergence?.compositeScore ?? null,
    gradeColor: gradeMeta.color,
    gradeBg: gradeMeta.bg,
    gradeBorder: gradeMeta.border,
    oaugfQueries: oaugf?.findingCount ?? convergence?.oaugfQueryCount ?? 0,
    oaugfRepeatCount: oaugf?.repeatNeglectCount ?? convergence?.oaugfRepeatCount ?? 0,
    convergenceFlagCount: convergence?.flagCount ?? 0,
    convergenceLabels: convFlags.map((flagId) => formatConvergenceFlagLabel(flagId)),
  };
}

export interface BuildSlicesParams {
  dimension: DistributionDimension;
  entries: DistributionInputEntry[];
  totalAmount: number;
  priorEntries?: DistributionInputEntry[] | null;
  priorTotalAmount?: number | null;
  maxVisibleSlices?: number;
  flaggedByGroup?: Record<string, GroupFlaggedSummary> | null;
  mdaScorecards?: MdaScorecardEntry[] | null;
  oaugfIndex?: OaugfAuditIndexPayload | null;
  convergenceIndex?: RedFlagConvergencePayload | null;
}

export function buildReconciledDonutSlices(
  params: BuildSlicesParams
): ReconciledDistributionSummary {
  const {
    dimension,
    entries,
    totalAmount,
    priorEntries,
    priorTotalAmount,
    maxVisibleSlices,
    flaggedByGroup,
    mdaScorecards,
    oaugfIndex,
    convergenceIndex,
  } = params;

  const sorted = (entries || [])
    .filter((e) => Number.isFinite(Number(e.amount)) && Number(e.amount) > 0 && String(e.name || '').trim())
    .map((e) => ({
      ...e,
      name: String(e.name).trim(),
      amount: Number(e.amount),
    }))
    .sort((a, b) => b.amount - a.amount);

  const entrySum = sorted.reduce((sum, e) => sum + e.amount, 0);
  const effectiveTotal = totalAmount > 0 ? totalAmount : entrySum;

  const priorValid = (priorEntries || [])
    .filter((e) => Number.isFinite(Number(e.amount)) && Number(e.amount) > 0 && String(e.name || '').trim())
    .map((e) => ({
      name: String(e.name).trim(),
      amount: Number(e.amount),
    }));
  const priorEntrySum = priorValid.reduce((sum, e) => sum + e.amount, 0);
  const effectivePriorTotal =
    priorTotalAmount !== null && priorTotalAmount !== undefined && priorTotalAmount > 0
      ? priorTotalAmount
      : priorEntrySum > 0
        ? priorEntrySum
        : null;

  const priorLookup = new Map<string, number>();
  for (const p of priorValid) {
    const key = normalizeGroupLookupKey(p.name);
    priorLookup.set(key, (priorLookup.get(key) || 0) + p.amount);
  }

  const pickColor = (name: string, index: number): string => {
    if (dimension === 'sector' && SECTOR_COLOR_PALETTE[name]) {
      return SECTOR_COLOR_PALETTE[name];
    }
    return MDA_DISTINCT_COLORS[index % MDA_DISTINCT_COLORS.length];
  };

  const allRankedEntries: DistributionSlice[] = sorted.map((entry, idx) => {
    const lookupKey = normalizeGroupLookupKey(entry.name);
    const sharePct = effectiveTotal > 0 ? (entry.amount / effectiveTotal) * 100 : 0;
    const priorAmt = priorLookup.has(lookupKey) ? priorLookup.get(lookupKey)! : null;
    const priorShare =
      priorAmt !== null && effectivePriorTotal && effectivePriorTotal > 0
        ? (priorAmt / effectivePriorTotal) * 100
        : null;
    const yoyDeltaPct =
      priorAmt !== null && priorAmt > 0 ? ((entry.amount - priorAmt) / priorAmt) * 100 : null;
    const shareShiftPts = priorShare !== null ? sharePct - priorShare : null;

    const flagStats = flaggedByGroup?.[lookupKey];
    const flaggedCount = flagStats?.flaggedCount ?? 0;
    const flaggedAmount = flagStats?.flaggedAmount ?? 0;
    const flaggedSharePct =
      entry.amount > 0 && flagStats ? Math.min(100, (flaggedAmount / entry.amount) * 100) : null;

    const mdaAudit =
      dimension === 'mda'
        ? buildMdaAuditMeta(entry.name, mdaScorecards, oaugfIndex, convergenceIndex)
        : null;

    return {
      rank: idx + 1,
      name: entry.name,
      fullName: entry.name,
      shortLabel: dimension === 'sector' ? entry.name : shortenEntityLabel(entry.name),
      amount: entry.amount,
      sharePct,
      projectCount: entry.projectCount ?? flagStats?.projectCount,
      color: pickColor(entry.name, idx),
      isOther: false,
      priorAmount: priorAmt,
      priorSharePct: priorShare,
      yoyDeltaPct,
      shareShiftPts,
      flaggedCount,
      flaggedAmount,
      flaggedSharePct,
      compoundCount: flagStats?.compoundCount ?? 0,
      mdaAudit,
    };
  });

  const visibleLimit = Math.max(1, maxVisibleSlices ?? (dimension === 'sector' ? 8 : 7));
  const topCandidates = allRankedEntries.slice(0, visibleLimit);
  const topSum = topCandidates.reduce((sum, item) => sum + item.amount, 0);
  const tailAmount = Math.max(0, effectiveTotal - topSum);
  const hasTailSlice =
    allRankedEntries.length > visibleLimit || (effectiveTotal > 0 && tailAmount >= 1);

  const slices: DistributionSlice[] = [...topCandidates];
  if (hasTailSlice && tailAmount > 0) {
    const tailEntries = allRankedEntries.slice(visibleLimit);
    const otherFlaggedCount = tailEntries.reduce((s, e) => s + e.flaggedCount, 0);
    const otherFlaggedAmount = tailEntries.reduce((s, e) => s + e.flaggedAmount, 0);
    const otherCompoundCount = tailEntries.reduce((s, e) => s + e.compoundCount, 0);
    const otherProjectCount = tailEntries.reduce((s, e) => s + (e.projectCount || 0), 0);
    const priorTopSum = topCandidates.reduce((s, e) => s + (e.priorAmount || 0), 0);
    const priorTailAmount =
      effectivePriorTotal !== null && effectivePriorTotal > 0
        ? Math.max(0, effectivePriorTotal - priorTopSum)
        : null;
    const otherSharePct = effectiveTotal > 0 ? (tailAmount / effectiveTotal) * 100 : 0;
    const priorOtherShare =
      priorTailAmount !== null && effectivePriorTotal && effectivePriorTotal > 0
        ? (priorTailAmount / effectivePriorTotal) * 100
        : null;
    const otherYoyDeltaPct =
      priorTailAmount !== null && priorTailAmount > 0
        ? ((tailAmount - priorTailAmount) / priorTailAmount) * 100
        : null;

    const remainingCount = Math.max(0, allRankedEntries.length - topCandidates.length);
    const tailLabel =
      remainingCount > 0
        ? `Other (${remainingCount.toLocaleString('en-US')} ${dimension === 'sector' ? 'Sectors' : 'MDAs'})`
        : `Other Remaining ${dimension === 'sector' ? 'Sectors' : 'MDAs'}`;

    slices.push({
      rank: topCandidates.length + 1,
      name: tailLabel,
      fullName: tailLabel,
      shortLabel: tailLabel,
      amount: tailAmount,
      sharePct: otherSharePct,
      projectCount: otherProjectCount > 0 ? otherProjectCount : undefined,
      color: OTHER_SLICE_COLOR,
      isOther: true,
      otherEntityCount: remainingCount > 0 ? remainingCount : undefined,
      priorAmount: priorTailAmount,
      priorSharePct: priorOtherShare,
      yoyDeltaPct: otherYoyDeltaPct,
      shareShiftPts: priorOtherShare !== null ? otherSharePct - priorOtherShare : null,
      flaggedCount: otherFlaggedCount,
      flaggedAmount: otherFlaggedAmount,
      flaggedSharePct:
        tailAmount > 0 && otherFlaggedAmount > 0
          ? Math.min(100, (otherFlaggedAmount / tailAmount) * 100)
          : null,
      compoundCount: otherCompoundCount,
      mdaAudit: null,
    });
  }

  const top3Sum = allRankedEntries.slice(0, 3).reduce((s, item) => s + item.amount, 0);
  const top3SharePct = effectiveTotal > 0 ? (top3Sum / effectiveTotal) * 100 : 0;
  const totalYoyDeltaPct =
    effectivePriorTotal !== null && effectivePriorTotal > 0 && effectiveTotal > 0
      ? ((effectiveTotal - effectivePriorTotal) / effectivePriorTotal) * 100
      : null;

  return {
    slices,
    allRankedEntries,
    totalAmount: effectiveTotal,
    totalEntitiesCount: allRankedEntries.length,
    top3SharePct,
    priorTotalAmount: effectivePriorTotal,
    totalYoyDeltaPct,
  };
}
