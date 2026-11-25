export type LegislativeDiffStatus =
  | 'NASS_INSERTION'
  | 'ALLOCATION_INFLATED'
  | 'ALLOCATION_CUT'
  | 'REMOVED_BY_NASS'
  | 'UNCHANGED';

export type MatchConfidence = 'EXACT_CODE' | 'EXACT_TITLE' | 'FUZZY_MDA_TITLE' | 'UNMATCHED';
export type ComparisonScope = 'LINE_ITEM_SCHEDULE' | 'SUMMARY_LEVEL_ONLY';
export type PaddingDiffFilter = 'all' | 'insertions' | 'inflated' | 'cut' | 'removed' | 'zip' | 'contracted';

export interface BillActDiffItem {
  id: string;
  financialYear: number;
  status: LegislativeDiffStatus;
  matchConfidence: MatchConfidence;
  isZonalIntervention: boolean;
  projectCode: string;
  projectName: string;
  mdaName: string;
  proposedAmountNaira: number;
  enactedAmountNaira: number;
  deltaNaira: number;
  deltaPct: number | null;
  billSourceFile: string;
  billPage: number | null;
  actSourceFile: string;
  actPage: number | null;
  billSha256: string;
  actSha256: string;
}

export interface TopPaddedMda {
  mdaName: string;
  insertionsNaira: number;
  inflatedDeltaNaira: number;
  cutDeltaNaira: number;
  alteredCount: number;
  totalPositivePaddingNaira: number;
}

export interface BillActYearSummary {
  financialYear: number;
  comparisonScope: ComparisonScope;
  comparisonNote: string;
  billFiles: string[];
  actFiles: string[];
  billSha256: string;
  actSha256: string;
  billItemCount: number;
  actItemCount: number;
  billTotalNaira: number;
  actTotalNaira: number;
  netDeltaNaira: number;
  insertionsCount: number;
  insertionsTotalNaira: number;
  inflatedCount: number;
  inflatedTotalNaira: number;
  cutCount: number;
  cutTotalNaira: number;
  removedCount: number;
  removedTotalNaira: number;
  unchangedCount: number;
  zipCount: number;
  zipTotalNaira: number;
  topPaddedMdas: TopPaddedMda[];
}

export interface BillActDiffIndex {
  generatedAt: string;
  cyclesCount: number;
  cycles: BillActYearSummary[];
}

export interface BillActYearDataset extends BillActYearSummary {
  items: BillActDiffItem[];
}

export function classifyDiffDelta(proposedAmountNaira: number, enactedAmountNaira: number): {
  status: LegislativeDiffStatus;
  deltaNaira: number;
  deltaPct: number | null;
} {
  const proposed = Math.max(0, Number(proposedAmountNaira) || 0);
  const enacted = Math.max(0, Number(enactedAmountNaira) || 0);
  const deltaNaira = enacted - proposed;

  if (proposed === 0 && enacted > 0) {
    return { status: 'NASS_INSERTION', deltaNaira, deltaPct: null };
  }
  if (proposed > 0 && enacted === 0) {
    return { status: 'REMOVED_BY_NASS', deltaNaira, deltaPct: -100 };
  }
  const deltaPct = proposed > 0 ? Number(((deltaNaira / proposed) * 100).toFixed(2)) : null;
  if (enacted > proposed) {
    return { status: 'ALLOCATION_INFLATED', deltaNaira, deltaPct };
  }
  if (enacted < proposed) {
    return { status: 'ALLOCATION_CUT', deltaNaira, deltaPct };
  }
  return { status: 'UNCHANGED', deltaNaira: 0, deltaPct: 0 };
}

export function isZonalInterventionItem(
  projectCode: string,
  projectName: string,
  sourceFile = ''
): boolean {
  const c = (projectCode || '').toUpperCase();
  const t = (projectName || '').toLowerCase();
  const s = (sourceFile || '').toLowerCase();
  return (
    s.includes('zonal intervention') ||
    c.startsWith('ZIP') ||
    c.startsWith('NASS') ||
    t.includes('zonal intervention') ||
    t.includes('constituency project') ||
    t.includes('(zip)')
  );
}

export function filterBillActDiffItems(
  items: BillActDiffItem[],
  diffFilter: PaddingDiffFilter,
  query = '',
  contractedIds?: Set<string>
): BillActDiffItem[] {
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    if (diffFilter === 'insertions' && item.status !== 'NASS_INSERTION') return false;
    if (diffFilter === 'inflated' && item.status !== 'ALLOCATION_INFLATED') return false;
    if (diffFilter === 'cut' && item.status !== 'ALLOCATION_CUT') return false;
    if (diffFilter === 'removed' && item.status !== 'REMOVED_BY_NASS') return false;
    if (diffFilter === 'zip' && !item.isZonalIntervention) return false;
    if (diffFilter === 'contracted' && (!contractedIds || !contractedIds.has(item.id))) return false;
    if (!q) return true;
    return (
      item.projectName.toLowerCase().includes(q) ||
      item.mdaName.toLowerCase().includes(q) ||
      item.projectCode.toLowerCase().includes(q)
    );
  });
}

export function isSummaryComparisonScope(scope: ComparisonScope): boolean {
  return scope === 'SUMMARY_LEVEL_ONLY';
}
