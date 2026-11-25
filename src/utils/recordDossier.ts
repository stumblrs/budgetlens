import { getMacroForYear } from '../data/historicalMacroData';
import type { BudgetRecord } from '../services/budgetDatabaseEngine';
import { buildCanonicalPermalink } from './urlState';

export interface RecordDossierUrlTarget {
  year: number;
  item: string;
  page?: number | null;
}

export interface SiblingContextRow {
  record: BudgetRecord;
  isTarget: boolean;
}

export interface EconomicRealityMetrics {
  nominalNaira: number;
  fxRate: number;
  usdValue: number;
  formattedUsd: string;
  cpiDeflatorTo2026: number;
  constant2026Naira: number;
  officialTotalBudget: number;
  shareOfBudgetPct: number;
}

export function buildRecordDossierUrl(target: RecordDossierUrlTarget): string {
  const permalink = buildCanonicalPermalink({
    tab: 'record',
    year: target.year,
    item: target.item,
    page: target.page ?? null,
    q: null,
    fsub: null,
    diffFilter: null,
  });
  if (permalink) return permalink;
  const params = new URLSearchParams({
    tab: 'record',
    year: String(target.year),
    item: target.item,
  });
  if (target.page) params.set('page', String(target.page));
  return `?${params.toString()}`;
}

export function resolveTargetBudgetRecord(
  records: BudgetRecord[],
  opts: { item?: string | null; page?: number | null }
): BudgetRecord | undefined {
  if (!records || records.length === 0) return undefined;
  const normItem = (opts.item || '').trim().toLowerCase();
  if (!normItem) return undefined;

  if (opts.page !== null && opts.page !== undefined) {
    const byCodeAndPage = records.find(
      (r) =>
        r.recordIdentity.projectCode.trim().toLowerCase() === normItem &&
        Number(r.sourceProvenance?.pdfPage) === Number(opts.page)
    );
    if (byCodeAndPage) return byCodeAndPage;
  }

  return (
    records.find((r) => r.recordIdentity.id.trim().toLowerCase() === normItem) ||
    records.find((r) => r.recordIdentity.projectCode.trim().toLowerCase() === normItem)
  );
}

export function sliceSamePageSiblings(
  records: BudgetRecord[],
  opts: {
    targetId?: string;
    projectCode?: string;
    projectName?: string;
    page?: number;
    agency?: string;
  },
  maxRows = 25
): { scopeLabel: string; rows: SiblingContextRow[] } {
  if (!records || records.length === 0) {
    return { scopeLabel: 'No schedule context loaded', rows: [] };
  }

  const normCode = (opts.projectCode || '').trim().toLowerCase();
  const normName = (opts.projectName || '').trim().toLowerCase();
  const normAgency = (opts.agency || '').trim().toLowerCase();

  const isTargetRecord = (r: BudgetRecord): boolean => {
    if (opts.targetId && r.recordIdentity.id === opts.targetId) return true;
    if (
      normCode &&
      r.recordIdentity.projectCode.trim().toLowerCase() === normCode &&
      (!opts.page || Number(r.sourceProvenance?.pdfPage) === Number(opts.page))
    ) {
      return true;
    }
    if (normName && r.recordIdentity.verbatimProjectName.trim().toLowerCase() === normName) {
      return true;
    }
    return false;
  };

  let matching: BudgetRecord[] = [];
  let scopeLabel = '';

  if (opts.page && opts.page > 0) {
    matching = records.filter((r) => Number(r.sourceProvenance?.pdfPage) === Number(opts.page));
    scopeLabel = `Schedule Page ${opts.page} (${matching.length} line items)`;
  }

  if (matching.length <= 1 && normAgency) {
    const mdaRows = records.filter(
      (r) => r.mdaGovernanceTaxonomy.mdaName.trim().toLowerCase() === normAgency
    );
    if (mdaRows.length > matching.length) {
      matching = mdaRows;
      scopeLabel = `Same Executing MDA (${matching.length} line items)`;
    }
  }

  if (matching.length === 0) {
    return { scopeLabel: 'No sibling schedule rows found', rows: [] };
  }

  const targetIdx = matching.findIndex(isTargetRecord);
  let sliced = matching;
  if (matching.length > maxRows) {
    if (targetIdx >= 0) {
      const half = Math.floor(maxRows / 2);
      const start = Math.max(0, Math.min(matching.length - maxRows, targetIdx - half));
      sliced = matching.slice(start, start + maxRows);
    } else {
      sliced = matching.slice(0, maxRows);
    }
  }

  return {
    scopeLabel,
    rows: sliced.map((record) => ({
      record,
      isTarget: isTargetRecord(record),
    })),
  };
}

export function computeEconomicRealityMetrics(
  amountNaira: number,
  financialYear: number
): EconomicRealityMetrics {
  const macro = getMacroForYear(financialYear);
  const fxRate = macro.fxNairaPerUsd || 1500;
  const usdValue = amountNaira / fxRate;
  const formattedUsd =
    usdValue >= 100
      ? `$${Math.round(usdValue).toLocaleString('en-US')}`
      : `$${usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const cpiDeflatorTo2026 = macro.cpiDeflatorTo2026 || 1;
  const constant2026Naira = amountNaira * cpiDeflatorTo2026;
  const officialTotalBudget = macro.officialTotalBudget || 1;
  const shareOfBudgetPct = (amountNaira / officialTotalBudget) * 100;

  return {
    nominalNaira: amountNaira,
    fxRate,
    usdValue,
    formattedUsd,
    cpiDeflatorTo2026,
    constant2026Naira,
    officialTotalBudget,
    shareOfBudgetPct,
  };
}
