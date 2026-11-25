import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BookmarkPlus,
  Check,
  Download,
  FileSpreadsheet,
  GitCompare,
  Info,
  Search,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { useCasebook } from '../context/CasebookContext';
import { InfoHint } from './InfoHint';
import { ExpandableText } from './ExpandableText';
import { ContractorHistoryModal, type ContractorSummaryItem } from './ContractorHistoryModal';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  type BillActDiffIndex,
  type BillActDiffItem,
  type BillActYearDataset,
  filterBillActDiffItems,
  type LegislativeDiffStatus,
  type PaddingDiffFilter,
} from '../utils/billActDiff';
import { exportPaddingDiffDocx, exportPaddingDiffPdf } from '../utils/documentExporter';
import {
  buildCanonicalPermalink,
  readPaddingUrlState,
  syncUrlParams,
} from '../utils/urlState';
import {
  loadOaugfAuditIndex,
  lookupOaugfMdaFindings,
  type OaugfAuditIndexPayload,
} from '../utils/mdaScorecard';

interface BudgetPaddingDiffExplorerProps {
  selectedYear: number;
  onSelectYear?: (year: number) => void;
  onSelectProject?: (project: any) => void;
}

const STATUS_BADGE: Record<
  LegislativeDiffStatus,
  { label: string; bg: string; color: string; border: string }
> = {
  NASS_INSERTION: {
    label: 'NASS Insertion',
    bg: '#fef2f2',
    color: '#b91c1c',
    border: '#fecaca',
  },
  ALLOCATION_INFLATED: {
    label: 'Inflated',
    bg: '#fffbeb',
    color: '#b45309',
    border: '#fde68a',
  },
  ALLOCATION_CUT: {
    label: 'Cut',
    bg: '#eff6ff',
    color: '#1d4ed8',
    border: '#bfdbfe',
  },
  REMOVED_BY_NASS: {
    label: 'Removed',
    bg: '#f1f5f9',
    color: '#475569',
    border: '#cbd5e1',
  },
  UNCHANGED: {
    label: 'Unchanged',
    bg: '#ecfdf5',
    color: '#047857',
    border: '#a7f3d0',
  },
};

interface FtmContractorLink {
  contractorName: string;
  bppContractorId?: string | null;
  awardCount: number;
  awardedNaira: number;
  nocopoDisbursedNaira: number;
  mdaGovspendCount?: number;
  mdaGovspendPaidNaira?: number;
  totalGovspendCount?: number;
  totalGovspendPaidNaira?: number;
  nonCompetitiveCount: number;
  procurementMethods: string[];
  years: number[];
  leaderboardContractCount?: number;
  leaderboardTotalContractedNaira?: number;
  leaderboardFirstYear?: number | null;
  leaderboardLastYear?: number | null;
  leaderboardMdaCount?: number;
  leaderboardTopMdas?: string[];
}

interface FtmDiffLink {
  id: string;
  financialYear: number;
  diffStatus: string;
  executionStatus: 'CONTRACTED_AND_DISBURSED' | 'CONTRACTED_NO_DISBURSEMENT' | 'PLANNED_TENDER_ONLY';
  matchMethod: string;
  confidenceScore: number;
  awardedContractCount: number;
  planningCount: number;
  totalAwardedNaira: number;
  totalNocopoDisbursedNaira: number;
  matchedMdaGovspendPaidNaira: number;
  distinctContractorCount: number;
  nonCompetitiveCount: number;
  procurementMethods: string[];
  contractors: FtmContractorLink[];
}

interface FollowTheMoneyPayload {
  status: string;
  govspendScopeNote?: string;
  summary?: {
    diffMatchedAnyCount: number;
    diffMatchedAwardedCount: number;
    diffPositivePaddingAwardedCount: number;
    diffPositivePaddingAwardedNaira: number;
    diffTotalAwardedNaira: number;
    diffTotalNocopoDisbursedNaira: number;
    diffNonCompetitiveAwardCount: number;
    diffByCycle?: Record<
      string,
      {
        financialYear: number;
        awardedCount: number;
        awardedDisbursedCount: number;
        awardedUnpaidCount: number;
        plannedOnlyCount: number;
        positivePaddingAwardedCount: number;
        positivePaddingAwardedNaira: number;
        totalAwardedNaira: number;
        totalNocopoDisbursedNaira: number;
        nonCompetitiveAwardCount: number;
      }
    >;
  };
  diffLinksById?: Record<string, FtmDiffLink>;
}

function toContractorSummaryItem(c: FtmContractorLink): ContractorSummaryItem {
  return {
    contractorName: c.contractorName,
    bppContractorId: c.bppContractorId ?? undefined,
    contractCount: c.leaderboardContractCount ?? c.awardCount,
    totalContractedNaira: c.leaderboardTotalContractedNaira ?? c.awardedNaira,
    nocopoDisbursedNaira: c.nocopoDisbursedNaira,
    govspendPaymentCount: c.totalGovspendCount,
    govspendPaidNaira: c.totalGovspendPaidNaira,
    firstYear: c.leaderboardFirstYear ?? (c.years[0] ?? null),
    lastYear: c.leaderboardLastYear ?? (c.years[c.years.length - 1] ?? null),
    mdaCount: c.leaderboardMdaCount ?? 1,
    topMdas: c.leaderboardTopMdas ?? [],
  };
}

function formatNairaCompact(amt: number): string {
  const abs = Math.abs(amt || 0);
  const sign = amt < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}₦${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}₦${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}₦${(abs / 1e6).toFixed(2)}M`;
  return `${sign}₦${Math.round(abs).toLocaleString()}`;
}

export const BudgetPaddingDiffExplorer: React.FC<BudgetPaddingDiffExplorerProps> = ({
  selectedYear,
  onSelectYear,
  onSelectProject,
}) => {
  const { pinItem, isPinned } = useCasebook();
  const [indexData, setIndexData] = useState<BillActDiffIndex | null>(null);
  const [yearDataset, setYearDataset] = useState<BillActYearDataset | null>(null);
  const [ftmData, setFtmData] = useState<FollowTheMoneyPayload | null>(null);
  const [oaugfIndex, setOaugfIndex] = useState<OaugfAuditIndexPayload | null>(null);
  const [oaugfMdaOnly, setOaugfMdaOnly] = useState(false);
  const [selectedContractor, setSelectedContractor] = useState<ContractorSummaryItem | null>(null);
  const [activeCycleYear, setActiveCycleYear] = useState<number>(selectedYear);
  const [diffFilter, setDiffFilter] = useState<PaddingDiffFilter>(
    () => readPaddingUrlState().diffFilter
  );
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/datasets/bill_act_diffs/index.json', { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: BillActDiffIndex | null) => {
        if (!active || !data) return;
        setIndexData(data);
        const available = data.cycles.map((c) => c.financialYear);
        if (available.includes(selectedYear)) {
          setActiveCycleYear(selectedYear);
        } else if (available.length > 0) {
          setActiveCycleYear(available[available.length - 1]);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/datasets/follow_the_money_links.json', { cache: 'no-cache' })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
      loadOaugfAuditIndex(),
    ])
      .then(([data, oa]) => {
        if (!active) return;
        if (data) setFtmData(data as FollowTheMoneyPayload);
        if (oa) setOaugfIndex(oa);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!indexData) return;
    if (indexData.cycles.some((c) => c.financialYear === selectedYear)) {
      setActiveCycleYear(selectedYear);
    }
  }, [selectedYear, indexData]);

  useEffect(() => {
    if (!activeCycleYear) return;
    let active = true;
    setLoading(true);
    fetch(`/datasets/bill_act_diffs/${activeCycleYear}.json`, { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: BillActYearDataset | null) => {
        if (active && data) setYearDataset(data);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeCycleYear]);

  useEffect(() => {
    syncUrlParams({ tab: 'padding', diffFilter, year: activeCycleYear }, 'replace');
  }, [diffFilter, activeCycleYear]);

  useEffect(() => {
    const onPop = () => {
      setDiffFilter(readPaddingUrlState().diffFilter);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const diffLinksById = ftmData?.diffLinksById || {};

  const cycleContractedIds = useMemo(() => {
    const set = new Set<string>();
    if (!yearDataset?.items) return set;
    for (const item of yearDataset.items) {
      const link = diffLinksById[item.id];
      if (link && link.awardedContractCount > 0) {
        set.add(item.id);
      }
    }
    return set;
  }, [yearDataset, diffLinksById]);

  const activeCycleFtm = ftmData?.summary?.diffByCycle?.[String(activeCycleYear)];

  const baseFilteredItems = useMemo(() => {
    if (!yearDataset?.items) return [];
    return filterBillActDiffItems(yearDataset.items, diffFilter, query, cycleContractedIds);
  }, [yearDataset, diffFilter, query, cycleContractedIds]);

  const filteredItems = useMemo(() => {
    if (!oaugfMdaOnly) return baseFilteredItems;
    return baseFilteredItems.filter((item) => {
      const oa = lookupOaugfMdaFindings(oaugfIndex, item.mdaName);
      return Boolean(oa && oa.findingCount > 0);
    });
  }, [baseFilteredItems, oaugfMdaOnly, oaugfIndex]);

  const oaugfQueriedItemCount = useMemo(() => {
    if (!oaugfIndex) return 0;
    return baseFilteredItems.filter((item) => {
      const oa = lookupOaugfMdaFindings(oaugfIndex, item.mdaName);
      return Boolean(oa && oa.findingCount > 0);
    }).length;
  }, [baseFilteredItems, oaugfIndex]);

  const ITEMS_PER_PAGE = 35;
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pagedItems = filteredItems.slice(
    (safePage - 1) * ITEMS_PER_PAGE,
    safePage * ITEMS_PER_PAGE
  );

  useEffect(() => {
    setPage(1);
  }, [diffFilter, query, activeCycleYear, oaugfMdaOnly]);

  const handleExport = async (format: 'pdf' | 'docx') => {
    if (!yearDataset) return;
    setExportingFormat(format);
    try {
      const permalink = buildCanonicalPermalink({
        tab: 'padding',
        year: activeCycleYear,
        diffFilter,
      });
      const input = {
        summary: yearDataset,
        diffFilter,
        filteredItems,
        permalink,
      };
      if (format === 'pdf') {
        await exportPaddingDiffPdf(input);
      } else {
        await exportPaddingDiffDocx(input);
      }
    } finally {
      setExportingFormat(null);
    }
  };

  const handleOpenEvidence = (item: BillActDiffItem) => {
    onSelectProject?.({
      id: item.id,
      projectCode: item.projectCode,
      projectName: item.projectName,
      agency: item.mdaName,
      amount: item.enactedAmountNaira || item.proposedAmountNaira,
      page: item.actPage || item.billPage || 1,
      financialYear: item.financialYear,
      sourceFilename: item.actSourceFile || item.billSourceFile,
      sha256: item.actSha256 || item.billSha256,
    });
  };

  const chartData = useMemo(() => {
    if (!yearDataset?.topPaddedMdas) return [];
    return yearDataset.topPaddedMdas.slice(0, 10).map((m) => ({
      mdaName: m.mdaName.length > 26 ? `${m.mdaName.slice(0, 24)}…` : m.mdaName,
      insertionsBn: Number((m.insertionsNaira / 1e9).toFixed(2)),
      inflatedBn: Number((m.inflatedDeltaNaira / 1e9).toFixed(2)),
    }));
  }, [yearDataset]);

  const filterPills: Array<{ id: PaddingDiffFilter; label: string; count?: number }> = [
    { id: 'all', label: 'All Changes', count: yearDataset?.items?.length },
    { id: 'insertions', label: 'NASS Insertions', count: yearDataset?.insertionsCount },
    { id: 'inflated', label: 'Inflated Items', count: yearDataset?.inflatedCount },
    { id: 'cut', label: 'Cuts', count: yearDataset?.cutCount },
    { id: 'removed', label: 'Removed', count: yearDataset?.removedCount },
    { id: 'zip', label: 'ZIP / Constituency', count: yearDataset?.zipCount },
    { id: 'contracted', label: 'Contracted (NOCOPO)', count: cycleContractedIds.size },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Editorial Header & Cycle Selector */}
      <div className="dossier-card" style={{ padding: '1.35rem 1.5rem' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '1rem',
          }}
        >
          <div style={{ flex: '1 1 420px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.28rem', flexWrap: 'wrap' }}>
              <GitCompare size={14} style={{ color: 'var(--emerald-primary)' }} />
              <span
                className="font-mono"
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  letterSpacing: '0.07em',
                  textTransform: 'uppercase',
                  color: 'var(--emerald-primary)',
                }}
              >
                Executive Bill vs. Enacted Act · Legislative Diff Engine (2017–2025)
              </span>
            </div>
            <h1
              className="font-editorial"
              style={{ margin: 0, fontSize: '1.55rem', fontWeight: 600, color: 'var(--text-primary)' }}
            >
              National Assembly &ldquo;Budget Padding&rdquo; &amp; Legislative Delta Observatory
            </h1>
            <p style={{ margin: '0.28rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5, display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
              <span>
                Line-by-line comparison between the Executive Appropriation Bill proposed by the Presidency and the
                Enacted Appropriation Act passed by the National Assembly.
              </span>
              <InfoHint
                term="How Bill vs. Act Padding Works"
                meaning="Inserted = brand-new project added after the President's Bill. Inflated = existing project whose cost jumped. Cut = reduced or removed line."
                whyItMatters="Shows exactly what lawmakers added, inflated, or removed before signing the budget into law."
              />
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              disabled={!yearDataset || exportingFormat !== null}
              onClick={() => handleExport('pdf')}
              className="editorial-btn-primary"
            >
              <Download size={14} />
              {exportingFormat === 'pdf'
                ? 'Generating PDF...'
                : 'Export Legislative Padding Brief (PDF)'}
            </button>
            <button
              type="button"
              disabled={!yearDataset || exportingFormat !== null}
              onClick={() => handleExport('docx')}
              className="editorial-btn"
            >
              <FileSpreadsheet size={14} />
              {exportingFormat === 'docx'
                ? 'Generating DOCX...'
                : 'Export Legislative Padding Brief (DOCX)'}
            </button>
          </div>
        </div>

        {/* Cycle Year Pills */}
        {indexData && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.45rem',
              marginTop: '1rem',
              paddingTop: '0.9rem',
              borderTop: '1px solid var(--border-subtle)',
              alignItems: 'center',
            }}
          >
            <span className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700 }}>
              BILL+ACT CYCLES:
            </span>
            {indexData.cycles.map((c) => {
              const active = c.financialYear === activeCycleYear;
              return (
                <button
                  key={c.financialYear}
                  type="button"
                  onClick={() => {
                    setActiveCycleYear(c.financialYear);
                    onSelectYear?.(c.financialYear);
                  }}
                  className={active ? 'editorial-btn-primary' : 'editorial-btn'}
                  style={{ padding: '0.35rem 0.72rem', fontSize: '0.75rem' }}
                >
                  <span className="font-mono">FY {c.financialYear}</span>
                  <span
                    className="font-mono"
                    style={{
                      fontSize: '0.62rem',
                      opacity: 0.85,
                    }}
                  >
                    {c.comparisonScope === 'LINE_ITEM_SCHEDULE' ? 'Schedule' : 'Summary'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {yearDataset && (
        <>
          {/* Granularity Guard Callout */}
          {yearDataset.comparisonScope === 'SUMMARY_LEVEL_ONLY' && (
            <div
              className="dossier-card"
              style={{
                padding: '0.9rem 1.15rem',
                backgroundColor: '#fffbeb',
                borderColor: '#fde68a',
                display: 'flex',
                alignItems: 'center',
                gap: '0.7rem',
              }}
            >
              <Info size={18} color="#b45309" style={{ flexShrink: 0 }} />
              <div style={{ fontSize: '0.8rem', color: '#78350f' }}>
                <strong>Summary-Level Granularity Notice (FY {yearDataset.financialYear}):</strong>{' '}
                {yearDataset.comparisonNote}
              </div>
            </div>
          )}

          {/* 4-Metric KPI Comparison Bar */}
          <div className="grid-4-cols">
            <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                Executive Bill Proposed
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: '0.22rem' }}>
                {formatNairaCompact(yearDataset.billTotalNaira)}
              </div>
              <div className="font-mono" style={{ fontSize: '0.71rem', color: 'var(--text-muted)' }}>
                {yearDataset.billItemCount.toLocaleString()} lines · {yearDataset.billFiles[0]}
              </div>
            </div>

            <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                Enacted Act Passed
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: '0.22rem' }}>
                {formatNairaCompact(yearDataset.actTotalNaira)}
              </div>
              <div className="font-mono" style={{ fontSize: '0.71rem', color: 'var(--text-muted)' }}>
                {yearDataset.actItemCount.toLocaleString()} lines · {yearDataset.actFiles[0]}
              </div>
            </div>

            <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                NASS Insertions
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.4rem', fontWeight: 700, color: '#b91c1c', marginTop: '0.22rem' }}>
                {formatNairaCompact(yearDataset.insertionsTotalNaira)}
              </div>
              <div className="font-mono" style={{ fontSize: '0.71rem', color: 'var(--text-muted)' }}>
                {yearDataset.insertionsCount.toLocaleString()} new lines · {yearDataset.zipCount.toLocaleString()} ZIP
              </div>
            </div>

            <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                Net Legislative Delta
              </div>
              <div
                className="font-mono tabular-nums"
                style={{
                  fontSize: '1.4rem',
                  fontWeight: 700,
                  color: yearDataset.netDeltaNaira >= 0 ? '#b45309' : '#1d4ed8',
                  marginTop: '0.22rem',
                }}
              >
                {yearDataset.netDeltaNaira >= 0 ? '+' : ''}
                {formatNairaCompact(yearDataset.netDeltaNaira)}
              </div>
              <div className="font-mono" style={{ fontSize: '0.71rem', color: 'var(--text-muted)' }}>
                Inflated: +{formatNairaCompact(yearDataset.inflatedTotalNaira)} · Cuts: -{formatNairaCompact(yearDataset.cutTotalNaira)}
              </div>
            </div>
          </div>

          {/* Padded-to-Paid Cross-Link Summary */}
          {ftmData?.summary && (
            <div
              className="dossier-card"
              style={{
                padding: '0.95rem 1.2rem',
                backgroundColor: '#f8fafc',
                borderColor: '#cbd5e1',
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.85rem',
              }}
            >
              <div style={{ minWidth: '220px' }}>
                <div className="font-mono" style={{ fontSize: '0.68rem', fontWeight: 700, color: '#047857', textTransform: 'uppercase' }}>
                  Padded-to-Paid Cross-Link (FY {yearDataset.financialYear} &middot; NOCOPO + GovSpend)
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  Tracks legislative insertions &amp; inflated lines that converted into real public contract awards.
                </div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.2rem', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                    Contracted Diff Lines
                  </div>
                  <div className="font-mono tabular-nums" style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a' }}>
                    {(activeCycleFtm?.awardedCount ?? cycleContractedIds.size).toLocaleString()} ({formatNairaCompact(activeCycleFtm?.totalAwardedNaira ?? 0)})
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                    Inserted / Inflated Won
                  </div>
                  <div className="font-mono tabular-nums" style={{ fontSize: '1.05rem', fontWeight: 700, color: '#b91c1c' }}>
                    {(activeCycleFtm?.positivePaddingAwardedCount ?? 0).toLocaleString()} ({formatNairaCompact(activeCycleFtm?.positivePaddingAwardedNaira ?? 0)})
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                    Non-Competitive Awards
                  </div>
                  <div className="font-mono tabular-nums" style={{ fontSize: '1.05rem', fontWeight: 700, color: '#b45309' }}>
                    {(activeCycleFtm?.nonCompetitiveAwardCount ?? 0).toLocaleString()}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                    OAuGF-Queried MDAs
                  </div>
                  <div className="font-mono tabular-nums" style={{ fontSize: '1.05rem', fontWeight: 700, color: '#c2410c' }}>
                    {oaugfQueriedItemCount.toLocaleString('en-US')} lines
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                    All Cycles Contracted
                  </div>
                  <div className="font-mono tabular-nums" style={{ fontSize: '0.92rem', fontWeight: 700, color: '#047857' }}>
                    {ftmData.summary.diffMatchedAwardedCount.toLocaleString()} lines · {formatNairaCompact(ftmData.summary.diffTotalAwardedNaira)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Top Padded MDAs Recharts Visualization */}
          {chartData.length > 0 && (
            <div className="dossier-card" style={{ padding: '1.15rem 1.25rem' }}>
              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>
                Top Altered MDAs by Positive Legislative Delta (FY {yearDataset.financialYear}, ₦ Billions)
              </h3>
              <p style={{ margin: '0.2rem 0 0.8rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Stacked breakdown of newly inserted lines vs. upward inflations on existing Executive Bill items
              </p>
              <div style={{ width: '100%', height: '280px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 20, left: 20, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" unit="B" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="mdaName" width={190} tick={{ fontSize: 10.5 }} />
                    <Tooltip formatter={(val: any, name: any) => [`₦${Number(val).toLocaleString()}B`, String(name)]} />
                    <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
                    <Bar dataKey="insertionsBn" stackId="a" name="NASS Insertions (₦B)" fill="#dc2626" />
                    <Bar dataKey="inflatedBn" stackId="a" name="Inflated Delta (₦B)" fill="#d97706" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Filterable Line-Item Diff Table */}
          <div className="dossier-card" style={{ overflow: 'hidden' }}>
            <div
              style={{
                padding: '0.95rem 1.2rem',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.7rem',
              }}
            >
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                {filterPills.map((fp) => {
                  const active = diffFilter === fp.id;
                  return (
                    <button
                      key={fp.id}
                      type="button"
                      onClick={() => setDiffFilter(fp.id)}
                      className={active ? 'editorial-btn-primary' : 'editorial-btn'}
                      style={{ padding: '0.34rem 0.68rem', fontSize: '0.74rem' }}
                    >
                      <span>{fp.label}</span>
                      {typeof fp.count === 'number' && (
                        <span className="font-mono" style={{ fontSize: '0.66rem', opacity: 0.85 }}>
                          {fp.count.toLocaleString()}
                        </span>
                      )}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setOaugfMdaOnly((prev) => !prev)}
                  className={oaugfMdaOnly ? 'editorial-btn-primary' : 'editorial-btn'}
                  style={{
                    padding: '0.34rem 0.68rem',
                    fontSize: '0.74rem',
                    backgroundColor: oaugfMdaOnly ? '#c2410c' : undefined,
                    borderColor: oaugfMdaOnly ? '#c2410c' : undefined,
                  }}
                >
                  <span>OAuGF-Queried MDAs Only</span>
                  <span className="font-mono" style={{ fontSize: '0.66rem', opacity: 0.85 }}>
                    {oaugfQueriedItemCount.toLocaleString('en-US')}
                  </span>
                </button>
              </div>

              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Search project, MDA, or code..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  style={{
                    padding: '0.42rem 0.7rem 0.42rem 2rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.78rem',
                    width: '230px',
                  }}
                />
                <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)' }} />
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '0.65rem 1rem' }}>Status &amp; Flags</th>
                    <th style={{ padding: '0.65rem 1rem' }}>Code &amp; Line Item</th>
                    <th style={{ padding: '0.65rem 1rem' }}>Executing MDA</th>
                    <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Bill Proposed</th>
                    <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Act Enacted</th>
                    <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Delta</th>
                    <th style={{ padding: '0.65rem 1rem' }}>Procurement &amp; Cash</th>
                    <th style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>Pages (B&rarr;A)</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={8} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        Loading FY {activeCycleYear} legislative diff records...
                      </td>
                    </tr>
                  ) : pagedItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        No diff records matched the active filter.
                      </td>
                    </tr>
                  ) : (
                    pagedItems.map((item) => {
                      const badge = STATUS_BADGE[item.status] || STATUS_BADGE.UNCHANGED;
                      const ftm = diffLinksById[item.id];
                      return (
                        <tr
                          key={item.id}
                          onClick={() => handleOpenEvidence(item)}
                          style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                        >
                          <td style={{ padding: '0.62rem 1rem', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.22rem', alignItems: 'flex-start' }}>
                              <span
                                className="editorial-pill"
                                style={{
                                  backgroundColor: badge.bg,
                                  color: badge.color,
                                  borderColor: badge.border,
                                  fontSize: '0.68rem',
                                }}
                              >
                                {item.status === 'NASS_INSERTION' ? <ShieldAlert size={11} /> : item.status === 'ALLOCATION_INFLATED' ? <AlertTriangle size={11} /> : null}
                                {badge.label}
                              </span>
                              {item.isZonalIntervention && (
                                <span
                                  className="editorial-pill font-mono"
                                  style={{
                                    backgroundColor: '#f5f3ff',
                                    color: '#6d28d9',
                                    borderColor: '#ddd6fe',
                                    fontSize: '0.63rem',
                                  }}
                                >
                                  <Sparkles size={10} /> Zonal Intervention (ZIP)
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '0.62rem 1rem', maxWidth: '380px' }}>
                            <div className="font-mono" style={{ fontSize: '0.7rem', fontWeight: 700, color: '#059669' }}>
                              {item.projectCode || 'ERGP'} · {item.matchConfidence}
                            </div>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginTop: '0.1rem' }}>
                              <ExpandableText text={item.projectName} maxChars={160} />
                            </div>
                          </td>
                          <td style={{ padding: '0.62rem 1rem', color: 'var(--text-muted)' }}>
                            <div>{item.mdaName}</div>
                            {(() => {
                              const mdaOaugf = lookupOaugfMdaFindings(oaugfIndex, item.mdaName);
                              if (!mdaOaugf || mdaOaugf.findingCount === 0) return null;
                              return (
                                <span
                                  className="font-mono"
                                  title={`${mdaOaugf.findingCount} OAuGF audit queries (${mdaOaugf.repeatNeglectCount || 0} repeat, ${mdaOaugf.recoveryDirectiveCount || 0} recovery orders)`}
                                  style={{
                                    display: 'inline-block',
                                    marginTop: '0.2rem',
                                    fontSize: '0.61rem',
                                    fontWeight: 700,
                                    padding: '0.07rem 0.35rem',
                                    borderRadius: '4px',
                                    backgroundColor: '#fff7ed',
                                    color: '#c2410c',
                                    border: '1px solid #fed7aa',
                                  }}
                                >
                                  OAuGF MDA: {mdaOaugf.findingCount} Q
                                  {(mdaOaugf.repeatNeglectCount || 0) > 0
                                    ? ` · ${mdaOaugf.repeatNeglectCount} Repeat`
                                    : ''}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.62rem 1rem', textAlign: 'right' }}>
                            {formatNairaCompact(item.proposedAmountNaira)}
                          </td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.62rem 1rem', textAlign: 'right', fontWeight: 700 }}>
                            {formatNairaCompact(item.enactedAmountNaira)}
                          </td>
                          <td
                            className="font-mono tabular-nums"
                            style={{
                              padding: '0.62rem 1rem',
                              textAlign: 'right',
                              fontWeight: 700,
                              color: item.deltaNaira > 0 ? '#b91c1c' : item.deltaNaira < 0 ? '#1d4ed8' : '#047857',
                            }}
                          >
                            {item.deltaNaira > 0 ? '+' : ''}
                            {formatNairaCompact(item.deltaNaira)}
                            {item.deltaPct !== null && item.status !== 'UNCHANGED' ? (
                              <div style={{ fontSize: '0.65rem', opacity: 0.85 }}>
                                ({item.deltaPct > 0 ? '+' : ''}
                                {item.deltaPct}%)
                              </div>
                            ) : null}
                          </td>
                          <td style={{ padding: '0.62rem 1rem', minWidth: '210px', maxWidth: '270px' }}>
                            {!ftm ? (
                              <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>No NOCOPO match</span>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.24rem', alignItems: 'flex-start' }}>
                                <span
                                  className="editorial-pill"
                                  style={{
                                    fontSize: '0.64rem',
                                    backgroundColor:
                                      ftm.executionStatus === 'CONTRACTED_AND_DISBURSED'
                                        ? '#ecfdf5'
                                        : ftm.executionStatus === 'CONTRACTED_NO_DISBURSEMENT'
                                        ? '#fffbeb'
                                        : '#f1f5f9',
                                    color:
                                      ftm.executionStatus === 'CONTRACTED_AND_DISBURSED'
                                        ? '#047857'
                                        : ftm.executionStatus === 'CONTRACTED_NO_DISBURSEMENT'
                                        ? '#b45309'
                                        : '#475569',
                                    borderColor:
                                      ftm.executionStatus === 'CONTRACTED_AND_DISBURSED'
                                        ? '#a7f3d0'
                                        : ftm.executionStatus === 'CONTRACTED_NO_DISBURSEMENT'
                                        ? '#fde68a'
                                        : '#cbd5e1',
                                  }}
                                >
                                  {ftm.executionStatus === 'CONTRACTED_AND_DISBURSED'
                                    ? 'Contracted & Paid'
                                    : ftm.executionStatus === 'CONTRACTED_NO_DISBURSEMENT'
                                    ? 'Contracted · ₦0 Paid'
                                    : `Planned/Tender (${ftm.planningCount})`}
                                </span>
                                <div className="font-mono" style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                                  {ftm.matchMethod === 'EXACT_PROJECT_CODE'
                                    ? 'Exact Code'
                                    : `MDA+Title ${Math.round(ftm.confidenceScore * 100)}%`}
                                  {ftm.awardedContractCount > 0 && ` · Award ${formatNairaCompact(ftm.totalAwardedNaira)}`}
                                  {ftm.nonCompetitiveCount > 0 && ` · ${ftm.nonCompetitiveCount} Non-Open`}
                                </div>
                                {ftm.contractors.length > 0 ? (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                                    {ftm.contractors.slice(0, 2).map((c) => (
                                      <button
                                        key={c.contractorName}
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedContractor(toContractorSummaryItem(c));
                                        }}
                                        style={{
                                          fontSize: '0.66rem',
                                          padding: '0.12rem 0.4rem',
                                          borderRadius: '4px',
                                          border: '1px solid #bfdbfe',
                                          backgroundColor: '#eff6ff',
                                          color: '#1d4ed8',
                                          fontWeight: 600,
                                          cursor: 'pointer',
                                          textAlign: 'left',
                                        }}
                                        title="Click to inspect full contractor history"
                                      >
                                        {c.contractorName.length > 26
                                          ? `${c.contractorName.slice(0, 24)}…`
                                          : c.contractorName}
                                      </button>
                                    ))}
                                    {ftm.distinctContractorCount > 2 && (
                                      <span className="font-mono" style={{ fontSize: '0.64rem', color: 'var(--text-muted)', alignSelf: 'center' }}>
                                        +{ftm.distinctContractorCount - 2} more
                                      </span>
                                    )}
                                  </div>
                                ) : ftm.awardedContractCount > 0 ? (
                                  <span style={{ fontSize: '0.66rem', color: '#64748b' }}>
                                    Vendor undisclosed in award release
                                  </span>
                                ) : null}
                              </div>
                            )}
                          </td>
                          <td className="font-mono" style={{ padding: '0.62rem 1rem', textAlign: 'center', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                                {item.billPage ?? '—'} &rarr; {item.actPage ?? '—'}
                                <ArrowUpRight size={12} />
                              </span>
                              <button
                                type="button"
                                title="Pin diff to Investigator Casebook"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  pinItem({
                                    pinId: `padding_diff:${item.financialYear}:${item.id}`,
                                    kind: 'padding_diff',
                                    financialYear: item.financialYear,
                                    projectCode: item.projectCode,
                                    title: `[${item.status}] ${item.projectName}`,
                                    mdaName: item.mdaName,
                                    amountNaira: Math.abs(item.deltaNaira) || item.enactedAmountNaira,
                                    page: item.actPage || item.billPage || 1,
                                    sourceFilename: item.actSourceFile || item.billSourceFile,
                                    sha256: item.actSha256 || item.billSha256,
                                  });
                                }}
                                style={{
                                  background: 'none',
                                  border: '1px solid #cbd5e1',
                                  borderRadius: '4px',
                                  padding: '0.16rem 0.3rem',
                                  color: isPinned(`padding_diff:${item.financialYear}:${item.id}`) ? '#059669' : '#64748b',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                }}
                              >
                                {isPinned(`padding_diff:${item.financialYear}:${item.id}`) ? <Check size={11} /> : <BookmarkPlus size={11} />}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', backgroundColor: '#f8fafc', borderTop: '1px solid #e2e8f0', fontSize: '0.78rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>
                  Showing {(safePage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(safePage * ITEMS_PER_PAGE, filteredItems.length)} of {filteredItems.length.toLocaleString()} indexed diff items
                </span>
                <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="editorial-btn"
                  >
                    Previous
                  </button>
                  <span className="font-mono">
                    Page {safePage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="editorial-btn"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <ContractorHistoryModal
        contractor={selectedContractor}
        onClose={() => setSelectedContractor(null)}
      />
    </div>
  );
};
