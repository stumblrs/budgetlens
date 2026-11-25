import React, { useEffect, useMemo, useState } from 'react';
import { datasetUrl } from '../services/apiClient';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from 'recharts';
import {
  PieChart as PieChartIcon,
  Layers,
  Building2,
  X,
  ExternalLink,
  Info,
  ShieldAlert,
  TrendingUp,
  TrendingDown,
  Search,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import { useBudgetDatabase } from '../context/BudgetDatabaseContext';
import type { BudgetRecord } from '../services/budgetDatabaseEngine';
import { getMacroForYear } from '../data/historicalMacroData';
import { getPresidentForYear } from '../data/presidentialTerms';
import {
  loadSourceProvenance,
  resolveYearProvenance,
} from '../utils/citationFormatter';
import {
  exportTabularDossierDocx,
  exportTabularDossierPdf,
  type TabularDossierSpec,
} from '../utils/documentExporter';
import {
  loadMdaIntegrityScorecards,
  loadOaugfAuditIndex,
  loadRedFlagConvergenceIndex,
  type MdaIntegrityScorecardsPayload,
  type OaugfAuditIndexPayload,
  type RedFlagConvergencePayload,
} from '../utils/mdaScorecard';
import { formatNairaCompact, formatNairaExact } from '../utils/reportExporter';
import {
  buildCompoundProjectLookup,
  findCompoundForProject,
  type CompoundFlaggedProject,
} from '../utils/ruleEngine';
import {
  buildReconciledDonutSlices,
  computeFlaggedExposureByGroup,
  normalizeGroupLookupKey,
  resolveMdaGroupKey,
  resolveSectorGroupKey,
  type DistributionDimension,
  type DistributionInputEntry,
  type DistributionSlice,
} from '../utils/sectorDistribution';
import { buildCanonicalPermalink } from '../utils/urlState';

export interface SectorDistributionProps {
  financialYear: number;
  compoundProjects?: CompoundFlaggedProject[];
  onSelectProject?: (project: any) => void;
}

interface RawYearStats {
  totalProjects?: number;
  totalCapitalAmount?: number;
  sectorDistribution?: Record<string, number>;
  topMinistries?: Array<{ name: string; amount: number }>;
  verbatimMdaAllocations?: Array<{ name: string; amount: number }> | Record<string, number>;
}

function statsMapToEntries(
  mapOrArray: Record<string, number> | Array<{ name: string; amount: number }> | undefined
): DistributionInputEntry[] {
  if (!mapOrArray) return [];
  if (Array.isArray(mapOrArray)) {
    return mapOrArray
      .filter((item) => item && item.name && Number(item.amount) > 0)
      .map((item) => ({ name: String(item.name), amount: Number(item.amount) }));
  }
  return Object.entries(mapOrArray)
    .filter(([name, amount]) => name && Number(amount) > 0)
    .map(([name, amount]) => ({ name, amount: Number(amount) }));
}

function formatYoyBadge(yoyDeltaPct: number | null): string | null {
  if (yoyDeltaPct === null || !Number.isFinite(yoyDeltaPct)) return null;
  const sign = yoyDeltaPct >= 0 ? '+' : '';
  return `${sign}${yoyDeltaPct.toFixed(1)}%`;
}

function toModalProjectShape(record: BudgetRecord, fallbackYear: number): Record<string, unknown> {
  const idObj = record.recordIdentity;
  const provObj = record.sourceProvenance;
  const geoObj = record.geographicTaxonomy;
  const pageVal = Number(provObj?.pdfPage ?? 1) || 1;
  return {
    id: idObj?.id,
    projectCode: idObj?.projectCode,
    projectName: idObj?.verbatimProjectName || 'Untitled Budget Line Item',
    amount: Number(idObj?.amountNaira) || 0,
    agency: resolveMdaGroupKey(record),
    state: geoObj?.state,
    page: pageVal,
    financialYear: Number(idObj?.financialYear) || fallbackYear,
    sector: resolveSectorGroupKey(record),
    sourceFilename: provObj?.sourceFilename,
    sha256: provObj?.sha256Hash,
    sourceProvenance: record.sourceProvenance,
  };
}

export const SectorDistribution: React.FC<SectorDistributionProps> = ({
  financialYear,
  compoundProjects,
  onSelectProject,
}) => {
  const { records, activeYear, getSectorDistribution, getRecordsForYear } = useBudgetDatabase();

  const [dimension, setDimension] = useState<DistributionDimension>('sector');
  const [hoveredSlice, setHoveredSlice] = useState<DistributionSlice | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modalFocusName, setModalFocusName] = useState<string | null>(null);
  const [modalFocusIsOther, setModalFocusIsOther] = useState(false);
  const [modalSearch, setModalSearch] = useState('');
  const [showExplainer, setShowExplainer] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null);

  const [statsData, setStatsData] = useState<RawYearStats | null>(null);
  const [priorStatsData, setPriorStatsData] = useState<RawYearStats | null>(null);
  const [scorecardsPayload, setScorecardsPayload] = useState<MdaIntegrityScorecardsPayload | null>(null);
  const [oaugfIndex, setOaugfIndex] = useState<OaugfAuditIndexPayload | null>(null);
  const [convergenceIndex, setConvergenceIndex] = useState<RedFlagConvergencePayload | null>(null);

  // Load current & prior fiscal year statistics.json for full 11-sector continuity & YoY deltas
  useEffect(() => {
    let active = true;
    setStatsData(null);
    setPriorStatsData(null);
    setHoveredSlice(null);

    const loadStats = async (yr: number): Promise<RawYearStats | null> => {
      try {
        const res = await fetch(datasetUrl(`/datasets/${yr}/statistics.json`));
        if (!res.ok) return null;
        return (await res.json()) as RawYearStats;
      } catch {
        return null;
      }
    };

    Promise.all([loadStats(financialYear), loadStats(financialYear - 1)]).then(([curr, prev]) => {
      if (!active) return;
      setStatsData(curr);
      setPriorStatsData(prev);
    });

    return () => {
      active = false;
    };
  }, [financialYear]);

  // Lazily hydrate cached 6-ledger cross-reference indices once
  useEffect(() => {
    let active = true;
    Promise.all([
      loadMdaIntegrityScorecards(),
      loadOaugfAuditIndex(),
      loadRedFlagConvergenceIndex(),
    ]).then(([scorecards, oaugf, conv]) => {
      if (!active) return;
      setScorecardsPayload(scorecards);
      setOaugfIndex(oaugf);
      setConvergenceIndex(conv);
    });
    return () => {
      active = false;
    };
  }, []);

  const yearRecords = useMemo(
    () => getRecordsForYear(financialYear),
    [getRecordsForYear, financialYear, records]
  );

  const dbDist = useMemo(() => {
    if (yearRecords.length === 0) return null;
    if (activeYear === financialYear) {
      return getSectorDistribution();
    }
    return null;
  }, [yearRecords.length, activeYear, financialYear, getSectorDistribution]);

  const flaggedExposure = useMemo(
    () => computeFlaggedExposureByGroup(yearRecords, compoundProjects, financialYear),
    [yearRecords, compoundProjects, financialYear]
  );

  // Build consistent inputs for both 'sector' (11 canonical sectors) and 'mda' (all MDAs vs true tail)
  const sectorSummary = useMemo(() => {
    const statSectorEntries = statsMapToEntries(statsData?.sectorDistribution);
    const engineSectorEntries: DistributionInputEntry[] = (dbDist?.sectors || []).map((s: any) => ({
      rank: s.rank,
      name: s.name,
      amount: s.amount,
      sharePct: s.sharePct,
      projectCount: s.projectCount,
    }));

    const entries = statSectorEntries.length > 0 ? statSectorEntries : engineSectorEntries;
    const entrySum = entries.reduce((sum, e) => sum + e.amount, 0);
    const totalAmount =
      statsData?.totalCapitalAmount && statsData.totalCapitalAmount > 0
        ? statsData.totalCapitalAmount
        : dbDist?.totalAmount && dbDist.totalAmount > 0
          ? dbDist.totalAmount
          : entrySum;

    const priorEntries = statsMapToEntries(priorStatsData?.sectorDistribution);
    const priorEntrySum = priorEntries.reduce((sum, e) => sum + e.amount, 0);
    const priorTotalAmount =
      priorStatsData?.totalCapitalAmount && priorStatsData.totalCapitalAmount > 0
        ? priorStatsData.totalCapitalAmount
        : priorEntrySum > 0
          ? priorEntrySum
          : null;

    return buildReconciledDonutSlices({
      dimension: 'sector',
      entries,
      totalAmount,
      priorEntries,
      priorTotalAmount,
      maxVisibleSlices: 8,
      flaggedByGroup: flaggedExposure.bySector,
    });
  }, [statsData, priorStatsData, dbDist, flaggedExposure.bySector]);

  const mdaSummary = useMemo(() => {
    const engineAllMdas: DistributionInputEntry[] = (dbDist?.allMdas || dbDist?.topMdas || []).map(
      (m: any) => ({
        rank: m.rank,
        name: m.name,
        amount: m.amount,
        sharePct: m.sharePct,
        projectCount: m.projectCount,
      })
    );
    const statsVerbatimMdas = statsMapToEntries(statsData?.verbatimMdaAllocations);
    const statsTopMdas = statsMapToEntries(statsData?.topMinistries);

    const entries =
      engineAllMdas.length > 0
        ? engineAllMdas
        : statsVerbatimMdas.length > 0
          ? statsVerbatimMdas
          : statsTopMdas;

    const totalAmount =
      dbDist?.totalAmount && dbDist.totalAmount > 0
        ? dbDist.totalAmount
        : statsData?.totalCapitalAmount && statsData.totalCapitalAmount > 0
          ? statsData.totalCapitalAmount
          : entries.reduce((sum, e) => sum + e.amount, 0);

    const priorVerbatim = statsMapToEntries(priorStatsData?.verbatimMdaAllocations);
    const priorTop = statsMapToEntries(priorStatsData?.topMinistries);
    const priorEntries = priorVerbatim.length > 0 ? priorVerbatim : priorTop;
    const priorTotalAmount =
      priorStatsData?.totalCapitalAmount && priorStatsData.totalCapitalAmount > 0
        ? priorStatsData.totalCapitalAmount
        : priorEntries.length > 0
          ? priorEntries.reduce((sum, e) => sum + e.amount, 0)
          : null;

    return buildReconciledDonutSlices({
      dimension: 'mda',
      entries,
      totalAmount,
      priorEntries,
      priorTotalAmount,
      maxVisibleSlices: 7,
      flaggedByGroup: flaggedExposure.byMda,
      mdaScorecards: scorecardsPayload?.mdas,
      oaugfIndex,
      convergenceIndex,
    });
  }, [
    dbDist,
    statsData,
    priorStatsData,
    flaggedExposure.byMda,
    scorecardsPayload,
    oaugfIndex,
    convergenceIndex,
  ]);

  const activeSummary = dimension === 'sector' ? sectorSummary : mdaSummary;
  const maxSliceShare = useMemo(
    () => Math.max(1, ...activeSummary.slices.map((s) => s.sharePct)),
    [activeSummary.slices]
  );

  const macro = useMemo(() => getMacroForYear(financialYear), [financialYear]);
  const macroCoveragePct =
    macro.officialTotalBudget > 0 && activeSummary.totalAmount > 0
      ? (activeSummary.totalAmount / macro.officialTotalBudget) * 100
      : null;

  const focusedSlice = useMemo(() => {
    if (!drawerOpen || !modalFocusName) return null;
    if (modalFocusIsOther) {
      return activeSummary.slices.find((s) => s.isOther) || null;
    }
    return (
      activeSummary.allRankedEntries.find(
        (e) => normalizeGroupLookupKey(e.name) === normalizeGroupLookupKey(modalFocusName)
      ) || null
    );
  }, [drawerOpen, modalFocusName, modalFocusIsOther, activeSummary]);

  const visibleSliceNamesSet = useMemo(() => {
    const names = new Set<string>();
    for (const s of activeSummary.slices) {
      if (!s.isOther) names.add(normalizeGroupLookupKey(s.name));
    }
    return names;
  }, [activeSummary.slices]);

  // Line items shown when a slice is focused inside the inspection modal
  const focusedProjects = useMemo(() => {
    if (!focusedSlice || yearRecords.length === 0) return [];
    const targetNorm = normalizeGroupLookupKey(focusedSlice.name);
    const query = modalSearch.trim().toLowerCase();

    return yearRecords
      .filter((r) => {
        const groupKey =
          dimension === 'sector' ? resolveSectorGroupKey(r) : resolveMdaGroupKey(r);
        const normKey = normalizeGroupLookupKey(groupKey);
        const matchesSlice = focusedSlice.isOther
          ? !visibleSliceNamesSet.has(normKey)
          : normKey === targetNorm;
        if (!matchesSlice) return false;
        if (!query) return true;
        const idObj = r.recordIdentity;
        return (
          String(idObj?.verbatimProjectName || '').toLowerCase().includes(query) ||
          String(idObj?.projectCode || '').toLowerCase().includes(query) ||
          resolveMdaGroupKey(r).toLowerCase().includes(query)
        );
      })
      .sort((a, b) => (Number(b.recordIdentity?.amountNaira) || 0) - (Number(a.recordIdentity?.amountNaira) || 0));
  }, [focusedSlice, yearRecords, modalSearch, dimension, visibleSliceNamesSet]);

  const compoundLookup = useMemo(
    () => buildCompoundProjectLookup(compoundProjects),
    [compoundProjects]
  );

  const filteredAllRanked = useMemo(() => {
    const query = modalSearch.trim().toLowerCase();
    if (!query) return activeSummary.allRankedEntries;
    return activeSummary.allRankedEntries.filter(
      (entry) =>
        entry.name.toLowerCase().includes(query) ||
        entry.shortLabel.toLowerCase().includes(query) ||
        (entry.mdaAudit?.convergenceLabels.some((lbl) => lbl.toLowerCase().includes(query)) ?? false)
    );
  }, [activeSummary.allRankedEntries, modalSearch]);

  const openModalOverview = () => {
    setModalFocusName(null);
    setModalFocusIsOther(false);
    setModalSearch('');
    setDrawerOpen(true);
  };

  const openDrillDownForSlice = (slice: DistributionSlice) => {
    setModalFocusName(slice.name);
    setModalFocusIsOther(slice.isOther);
    setModalSearch('');
    setDrawerOpen(true);
  };

  const handleExport = async (format: 'pdf' | 'docx') => {
    if (exportingFormat) return;
    setExportingFormat(format);
    try {
      const pres = getPresidentForYear(financialYear);
      const manifest = await loadSourceProvenance();
      const prov = resolveYearProvenance(manifest, financialYear);
      const permalink =
        buildCanonicalPermalink({ tab: 'agencies', year: financialYear }) ||
        (typeof window !== 'undefined' ? window.location.href : undefined);

      const totalFlaggedNaira = sectorSummary.allRankedEntries.reduce(
        (s, e) => s + e.flaggedAmount,
        0
      );
      const overallFlagPct =
        sectorSummary.totalAmount > 0 ? (totalFlaggedNaira / sectorSummary.totalAmount) * 100 : 0;

      const spec: TabularDossierSpec = {
        filenameBase: `BudgetLens_Fiscal_Distribution_FY${financialYear}`,
        eyebrow: `BUDGETLENS FISCAL ALLOCATION DOSSIER · FY ${financialYear}`,
        title: `Sector & MDA Capital Distribution Audit — FY ${financialYear}`,
        subtitle: `100% Reconciled Extracted Schedule (${pres.presidentName} · ${pres.termLabel}) vs. Official Macro Envelope`,
        orientation: 'landscape',
        metadata: [
          { label: 'Administration', value: `${pres.presidentName} (${pres.termLabel})` },
          { label: 'Active Chart View', value: dimension === 'sector' ? 'Canonical Sectors (11)' : 'MDAs with Full Tail' },
          { label: 'Official Macro Budget', value: formatNairaCompact(macro.officialTotalBudget) },
          {
            label: 'Schedule Share of Macro',
            value: macroCoveragePct !== null ? `${macroCoveragePct.toFixed(1)}%` : 'N/A',
          },
        ],
        kpis: [
          {
            label: 'Extracted Schedule Total',
            value: formatNairaCompact(activeSummary.totalAmount),
            subtext: `${yearRecords.length.toLocaleString('en-US')} indexed line items`,
          },
          {
            label: 'YoY Schedule Change',
            value: formatYoyBadge(activeSummary.totalYoyDeltaPct) || 'Baseline Year',
            subtext: `vs. FY ${financialYear - 1}`,
          },
          {
            label: 'Top-3 Concentration',
            value: `${activeSummary.top3SharePct.toFixed(1)}%`,
            subtext: `Across ${activeSummary.totalEntitiesCount.toLocaleString('en-US')} entities`,
          },
          {
            label: 'Flagged Risk Exposure',
            value: `${overallFlagPct.toFixed(1)}%`,
            subtext: `${formatNairaCompact(totalFlaggedNaira)} rule/cross-ledger flagged`,
          },
        ],
        narrative: `This dossier reconciles 100% of extracted capital line items for FY ${financialYear} (${formatNairaExact(activeSummary.totalAmount)}) without tail truncation. Extracted capital schedules exclude statutory transfers, consolidated debt service, and pooled personnel overheads included in the official enacted budget (${formatNairaCompact(macro.officialTotalBudget)}).`,
        tables: [
          {
            heading: `1. Canonical Sector Distribution (FY ${financialYear} · 100% Reconciled)`,
            columns: ['Rank', 'Sector', 'Allocated (NGN)', 'Share %', `YoY vs FY${financialYear - 1}`, 'Flagged Exposure', 'Items'],
            rows: sectorSummary.allRankedEntries.map((s) => [
              s.rank,
              s.name,
              formatNairaExact(s.amount),
              `${s.sharePct.toFixed(2)}%`,
              formatYoyBadge(s.yoyDeltaPct) || 'N/A',
              s.flaggedAmount > 0 ? `${formatNairaCompact(s.flaggedAmount)} (${(s.flaggedSharePct || 0).toFixed(1)}%)` : '0%',
              s.projectCount ? s.projectCount.toLocaleString('en-US') : '-',
            ]),
            rightAlignColumns: [0, 2, 3, 4, 6],
          },
          {
            heading: `2. Top 40 Federal MDAs & Cross-Ledger Accountability Matrix (FY ${financialYear})`,
            columns: ['Rank', 'Agency / Ministry', 'Allocated (NGN)', 'Share %', 'YoY %', 'Grade', 'OAuGF Queries', 'Convergence Flags'],
            rows: mdaSummary.allRankedEntries.slice(0, 40).map((m) => [
              m.rank,
              m.name,
              formatNairaExact(m.amount),
              `${m.sharePct.toFixed(2)}%`,
              formatYoyBadge(m.yoyDeltaPct) || 'N/A',
              m.mdaAudit ? `${m.mdaAudit.grade}${m.mdaAudit.compositeScore !== null ? ` (${m.mdaAudit.compositeScore.toFixed(0)})` : ''}` : 'N/A',
              m.mdaAudit && m.mdaAudit.oaugfQueries > 0 ? m.mdaAudit.oaugfQueries.toLocaleString('en-US') : '0',
              m.mdaAudit && m.mdaAudit.convergenceLabels.length > 0
                ? m.mdaAudit.convergenceLabels.slice(0, 2).join('; ')
                : 'None Indexed',
            ]),
            rightAlignColumns: [0, 2, 3, 4, 6],
          },
        ],
        sourceFilename: prov.filename,
        sha256: prov.sha256,
        permalink,
      };

      if (format === 'pdf') {
        await exportTabularDossierPdf(spec);
      } else {
        await exportTabularDossierDocx(spec);
      }
    } finally {
      setExportingFormat(null);
    }
  };

  const centerTarget = hoveredSlice;
  const overallYoyText = formatYoyBadge(activeSummary.totalYoyDeltaPct);

  return (
    <div
      className="dossier-card"
      style={{
        padding: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: '0.85rem',
      }}
    >
      {/* Header & Dual-Mode Toggle */}
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: '0.6rem',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
              <PieChartIcon size={16} color="#0284c7" />
              <h3
                className="font-editorial"
                style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}
              >
                Fiscal Allocation Distribution
              </h3>
              <button
                type="button"
                onClick={() => setShowExplainer((v) => !v)}
                title="Compare Extracted Schedule vs. Official Enacted Budget"
                aria-label="Toggle methodology note"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.2rem',
                  fontSize: '0.66rem',
                  fontWeight: 600,
                  padding: '0.12rem 0.42rem',
                  borderRadius: '999px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: showExplainer ? '#eff6ff' : '#f8fafc',
                  color: showExplainer ? '#1d4ed8' : '#475569',
                  cursor: 'pointer',
                }}
              >
                <Info size={11} />
                Macro Note
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', marginTop: '0.22rem' }}>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                FY {financialYear} · {dimension === 'sector' ? 'Verbatim Sector Mix' : 'Agency & Tail Allocation'}
              </span>
              <span
                style={{
                  fontSize: '0.64rem',
                  fontWeight: 700,
                  padding: '0.1rem 0.45rem',
                  borderRadius: '4px',
                  backgroundColor: yearRecords.length > 0 ? '#ecfdf5' : '#f1f5f9',
                  color: yearRecords.length > 0 ? '#047857' : '#475569',
                  border: `1px solid ${yearRecords.length > 0 ? '#a7f3d0' : '#cbd5e1'}`,
                }}
              >
                {yearRecords.length > 0 ? 'Extracted Schedule · 100% Reconciled' : 'Summary Index · 100% Reconciled'}
              </span>
            </div>
          </div>

          {/* By Sector / By Top MDAs Toggle */}
          <div
            role="group"
            aria-label="Distribution Grouping"
            style={{
              display: 'inline-flex',
              backgroundColor: 'var(--bg-canvas)',
              borderRadius: '7px',
              padding: '0.18rem',
              border: '1px solid var(--border-subtle)',
              gap: '0.15rem',
            }}
          >
            <button
              type="button"
              onClick={() => {
                setDimension('sector');
                setHoveredSlice(null);
              }}
              aria-pressed={dimension === 'sector'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem',
                fontSize: '0.7rem',
                fontWeight: 600,
                padding: '0.26rem 0.55rem',
                borderRadius: '5px',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: dimension === 'sector' ? '#0f172a' : 'transparent',
                color: dimension === 'sector' ? '#ffffff' : 'var(--text-secondary)',
              }}
            >
              <Layers size={11} />
              By Sector
            </button>
            <button
              type="button"
              onClick={() => {
                setDimension('mda');
                setHoveredSlice(null);
              }}
              aria-pressed={dimension === 'mda'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem',
                fontSize: '0.7rem',
                fontWeight: 600,
                padding: '0.26rem 0.55rem',
                borderRadius: '5px',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: dimension === 'mda' ? '#0f172a' : 'transparent',
                color: dimension === 'mda' ? '#ffffff' : 'var(--text-secondary)',
              }}
            >
              <Building2 size={11} />
              By Top MDAs
            </button>
          </div>
        </div>

        {/* Macro vs. Extracted Explainer */}
        {showExplainer && (
          <div
            style={{
              marginTop: '0.65rem',
              padding: '0.65rem 0.8rem',
              backgroundColor: '#f8fafc',
              borderRadius: '7px',
              border: '1px solid #e2e8f0',
              fontSize: '0.74rem',
              color: '#334155',
              lineHeight: 1.48,
            }}
          >
            <strong style={{ color: '#0f172a' }}>Reconciled Methodology (Zero Tail Truncation):</strong>{' '}
            Every pie angle sums to 100.0% of the FY {financialYear} extracted capital schedule (
            {formatNairaCompact(activeSummary.totalAmount)}), with the “Other” slice capturing all remaining
            ranked entities beyond the top slices. Official macro enacted spending ({formatNairaCompact(macro.officialTotalBudget)}
            {macroCoveragePct !== null ? ` — extracted share: ${macroCoveragePct.toFixed(1)}%` : ''}) also
            includes debt service, statutory transfers, and pooled personnel costs recorded outside project schedules.
          </div>
        )}
      </div>

      {/* Main Donut + Interactive Legend */}
      {activeSummary.slices.length === 0 ? (
        <div
          style={{
            padding: '2.25rem 1rem',
            textAlign: 'center',
            fontSize: '0.8rem',
            color: 'var(--text-muted)',
            backgroundColor: '#f8fafc',
            borderRadius: '8px',
            border: '1px dashed var(--border-subtle)',
          }}
        >
          No granular allocation distribution records indexed for FY {financialYear}.
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '0.95rem',
          }}
        >
          {/* Donut Chart + Center KPI Overlay */}
          <div
            style={{
              flex: '0 0 212px',
              margin: '0 auto',
              position: 'relative',
              height: '214px',
            }}
          >
            <ResponsiveContainer width="100%" height={214}>
              <PieChart>
                <Pie
                  data={activeSummary.slices}
                  dataKey="amount"
                  nameKey="shortLabel"
                  cx="50%"
                  cy="50%"
                  innerRadius={62}
                  outerRadius={88}
                  paddingAngle={1.6}
                  isAnimationActive={false}
                  onMouseEnter={(_, idx) => setHoveredSlice(activeSummary.slices[idx] || null)}
                  onMouseLeave={() => setHoveredSlice(null)}
                  onClick={(_, idx) => {
                    const target = activeSummary.slices[idx];
                    if (target) openDrillDownForSlice(target);
                  }}
                >
                  {activeSummary.slices.map((entry) => {
                    const isHovered = hoveredSlice?.name === entry.name;
                    const dimmed = Boolean(hoveredSlice && !isHovered);
                    return (
                      <Cell
                        key={entry.name}
                        fill={entry.color}
                        fillOpacity={dimmed ? 0.35 : 1}
                        stroke={isHovered ? '#0f172a' : '#ffffff'}
                        strokeWidth={isHovered ? 2.4 : 1.4}
                        style={{ cursor: 'pointer', transition: 'fill-opacity 0.15s ease' }}
                      />
                    );
                  })}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const s = payload[0]?.payload as DistributionSlice | undefined;
                    if (!s) return null;
                    const yoyText = formatYoyBadge(s.yoyDeltaPct);
                    return (
                      <div
                        style={{
                          backgroundColor: '#0f172a',
                          color: '#f8fafc',
                          padding: '0.5rem 0.7rem',
                          borderRadius: '7px',
                          fontSize: '0.72rem',
                          boxShadow: '0 8px 20px rgba(15,23,42,0.28)',
                          maxWidth: '240px',
                          border: '1px solid #334155',
                        }}
                      >
                        <div style={{ fontWeight: 700, marginBottom: '0.2rem', lineHeight: 1.25 }}>
                          {s.fullName}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                          <span style={{ color: '#cbd5e1' }}>Allocation</span>
                          <span style={{ fontWeight: 700 }}>{formatNairaCompact(s.amount)} ({s.sharePct.toFixed(1)}%)</span>
                        </div>
                        {yoyText && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginTop: '0.1rem' }}>
                            <span style={{ color: '#cbd5e1' }}>YoY vs FY{financialYear - 1}</span>
                            <span style={{ color: (s.yoyDeltaPct || 0) >= 0 ? '#4ade80' : '#fca5a5', fontWeight: 600 }}>
                              {yoyText}
                            </span>
                          </div>
                        )}
                        {s.flaggedSharePct !== null && s.flaggedCount > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginTop: '0.1rem' }}>
                            <span style={{ color: '#cbd5e1' }}>Flagged Exposure</span>
                            <span style={{ color: '#fbbf24', fontWeight: 600 }}>
                              {s.flaggedSharePct.toFixed(1)}% ({s.flaggedCount.toLocaleString('en-US')})
                            </span>
                          </div>
                        )}
                        {s.mdaAudit && (
                          <div style={{ marginTop: '0.22rem', paddingTop: '0.22rem', borderTop: '1px solid #334155', color: '#e2e8f0' }}>
                            Grade {s.mdaAudit.grade} · {s.mdaAudit.oaugfQueries} OAuGF queries
                          </div>
                        )}
                        <div style={{ fontSize: '0.64rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                          Click slice to inspect items
                        </div>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>

            {/* Dynamic Center Readout */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
                textAlign: 'center',
                padding: '0 2.6rem',
              }}
            >
              {centerTarget ? (
                <>
                  <span
                    style={{
                      fontSize: '0.63rem',
                      fontWeight: 700,
                      color: 'var(--text-secondary)',
                      lineHeight: 1.15,
                      maxWidth: '112px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {centerTarget.shortLabel}
                  </span>
                  <span
                    style={{
                      fontSize: '0.98rem',
                      fontWeight: 800,
                      color: 'var(--text-primary)',
                      marginTop: '0.15rem',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatNairaCompact(centerTarget.amount)}
                  </span>
                  <span
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      color: '#0284c7',
                      marginTop: '0.05rem',
                    }}
                  >
                    {centerTarget.sharePct.toFixed(1)}%
                    {centerTarget.yoyDeltaPct !== null ? ` · ${formatYoyBadge(centerTarget.yoyDeltaPct)}` : ''}
                  </span>
                </>
              ) : (
                <>
                  <span
                    style={{
                      fontSize: '0.6rem',
                      fontWeight: 700,
                      letterSpacing: '0.05em',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                    }}
                  >
                    FY {financialYear} Total
                  </span>
                  <span
                    style={{
                      fontSize: '1.02rem',
                      fontWeight: 800,
                      color: 'var(--text-primary)',
                      marginTop: '0.12rem',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatNairaCompact(activeSummary.totalAmount)}
                  </span>
                  <span
                    style={{
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      color:
                        activeSummary.totalYoyDeltaPct !== null
                          ? activeSummary.totalYoyDeltaPct >= 0
                            ? '#047857'
                            : '#b91c1c'
                          : '#475569',
                      marginTop: '0.1rem',
                    }}
                  >
                    {overallYoyText
                      ? `${overallYoyText} vs FY${financialYear - 1}`
                      : `Top 3 = ${activeSummary.top3SharePct.toFixed(1)}%`}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Clickable Interactive Legend with Share Bars & Ledger Badges */}
          <div
            style={{
              flex: '1 1 225px',
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.36rem',
            }}
          >
            {activeSummary.slices.map((slice) => {
              const isActive = hoveredSlice?.name === slice.name;
              const barPct = Math.max(2, (slice.sharePct / maxSliceShare) * 100);
              const highRiskShare = slice.flaggedSharePct !== null && slice.flaggedSharePct >= 15;
              return (
                <button
                  key={slice.name}
                  type="button"
                  onMouseEnter={() => setHoveredSlice(slice)}
                  onMouseLeave={() => setHoveredSlice(null)}
                  onClick={() => openDrillDownForSlice(slice)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.28rem 0.42rem',
                    borderRadius: '6px',
                    border: isActive ? `1px solid ${slice.color}` : '1px solid transparent',
                    backgroundColor: isActive ? '#f8fafc' : 'transparent',
                    cursor: 'pointer',
                    transition: 'background-color 0.14s ease, border-color 0.14s ease',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.4rem',
                      fontSize: '0.73rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0, flex: 1 }}>
                      <span
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          backgroundColor: slice.color,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        title={slice.fullName}
                        style={{
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {slice.shortLabel}
                      </span>
                      {slice.mdaAudit && slice.mdaAudit.grade !== 'N/A' && (
                        <span
                          title={`MDA Integrity Grade ${slice.mdaAudit.grade}`}
                          style={{
                            fontSize: '0.58rem',
                            fontWeight: 800,
                            padding: '0.03rem 0.28rem',
                            borderRadius: '4px',
                            backgroundColor: slice.mdaAudit.gradeBg,
                            color: slice.mdaAudit.gradeColor,
                            border: `1px solid ${slice.mdaAudit.gradeBorder}`,
                            flexShrink: 0,
                          }}
                        >
                          {slice.mdaAudit.grade}
                        </span>
                      )}
                      {highRiskShare && (
                        <ShieldAlert
                          size={11}
                          color="#d97706"
                          style={{ flexShrink: 0 }}
                        />
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                      <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                        {slice.sharePct.toFixed(1)}%
                      </span>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', minWidth: '52px', textAlign: 'right' }}>
                        {formatNairaCompact(slice.amount)}
                      </span>
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: '0.2rem',
                      height: '3px',
                      width: '100%',
                      backgroundColor: '#e2e8f0',
                      borderRadius: '999px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${barPct}%`,
                        backgroundColor: slice.color,
                        borderRadius: '999px',
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Summary & Export Action Footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.55rem',
          paddingTop: '0.65rem',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          <span>
            Top 3 hold <strong style={{ color: 'var(--text-primary)' }}>{activeSummary.top3SharePct.toFixed(1)}%</strong>
          </span>
          {macroCoveragePct !== null && (
            <>
              <span>·</span>
              <span>
                {macroCoveragePct.toFixed(1)}% of Official {formatNairaCompact(macro.officialTotalBudget)}
              </span>
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={openModalOverview}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
              padding: '0.3rem 0.6rem',
              fontSize: '0.71rem',
              fontWeight: 600,
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-canvas)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            <ExternalLink size={12} />
            Inspect All ({activeSummary.totalEntitiesCount.toLocaleString('en-US')})
          </button>
          <button
            type="button"
            onClick={() => handleExport('pdf')}
            disabled={exportingFormat !== null}
            style={{
              padding: '0.3rem 0.55rem',
              fontSize: '0.69rem',
              fontWeight: 700,
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#0f172a',
              color: '#ffffff',
              cursor: exportingFormat ? 'wait' : 'pointer',
            }}
          >
            {exportingFormat === 'pdf' ? 'Exporting…' : 'PDF'}
          </button>
          <button
            type="button"
            onClick={() => handleExport('docx')}
            disabled={exportingFormat !== null}
            style={{
              padding: '0.3rem 0.55rem',
              fontSize: '0.69rem',
              fontWeight: 700,
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#ffffff',
              color: '#0f172a',
              cursor: exportingFormat ? 'wait' : 'pointer',
            }}
          >
            {exportingFormat === 'docx' ? 'Exporting…' : 'DOCX'}
          </button>
        </div>
      </div>

      {/* Click-to-Drill-Down Inspection Modal */}
      {drawerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Fiscal Allocation Inspection Drawer FY ${financialYear}`}
          className="mobile-sheet-backdrop"
          onClick={() => setDrawerOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.58)',
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div
            className="mobile-sheet-panel"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '940px',
              maxHeight: '90dvh',
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              boxShadow: '0 24px 60px rgba(15, 23, 42, 0.35)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div className="mobile-sheet-handle" />
            {/* Modal Header */}
            <div
              style={{
                padding: '1rem 1.25rem',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.75rem',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {focusedSlice && (
                    <button
                      type="button"
                      onClick={() => {
                        setModalFocusName(null);
                        setModalFocusIsOther(false);
                        setModalSearch('');
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.2rem',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        padding: '0.2rem 0.5rem',
                        borderRadius: '5px',
                        border: '1px solid #cbd5e1',
                        backgroundColor: '#f8fafc',
                        color: '#0f172a',
                        cursor: 'pointer',
                      }}
                    >
                      <ChevronLeft size={13} />
                      All {dimension === 'sector' ? 'Sectors' : 'MDAs'}
                    </button>
                  )}
                  <h4 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700, color: '#0f172a' }}>
                    {focusedSlice
                      ? `${focusedSlice.fullName} — FY ${financialYear}`
                      : `Complete ${dimension === 'sector' ? 'Sector' : 'MDA'} Breakdown — FY ${financialYear}`}
                  </h4>
                </div>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.74rem', color: '#64748b' }}>
                  {focusedSlice
                    ? `Drill-down across extracted budget line items (${formatNairaExact(focusedSlice.amount)} · ${focusedSlice.sharePct.toFixed(2)}% share)`
                    : `Showing ${activeSummary.allRankedEntries.length.toLocaleString('en-US')} entities reconciled to ${formatNairaExact(activeSummary.totalAmount)}`}
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {!focusedSlice && (
                  <div style={{ display: 'inline-flex', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '0.15rem', gap: '0.15rem' }}>
                    <button
                      type="button"
                      onClick={() => setDimension('sector')}
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        padding: '0.22rem 0.55rem',
                        borderRadius: '4px',
                        border: 'none',
                        cursor: 'pointer',
                        backgroundColor: dimension === 'sector' ? '#0f172a' : 'transparent',
                        color: dimension === 'sector' ? '#ffffff' : '#475569',
                      }}
                    >
                      Sectors ({sectorSummary.totalEntitiesCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setDimension('mda')}
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        padding: '0.22rem 0.55rem',
                        borderRadius: '4px',
                        border: 'none',
                        cursor: 'pointer',
                        backgroundColor: dimension === 'mda' ? '#0f172a' : 'transparent',
                        color: dimension === 'mda' ? '#ffffff' : '#475569',
                      }}
                    >
                      MDAs ({mdaSummary.totalEntitiesCount})
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => handleExport('pdf')}
                  disabled={exportingFormat !== null}
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    padding: '0.32rem 0.6rem',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: '#0f172a',
                    color: '#ffffff',
                    cursor: 'pointer',
                  }}
                >
                  {exportingFormat === 'pdf' ? 'Exporting…' : 'Export PDF'}
                </button>
                <button
                  type="button"
                  onClick={() => handleExport('docx')}
                  disabled={exportingFormat !== null}
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    padding: '0.32rem 0.6rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    color: '#0f172a',
                    cursor: 'pointer',
                  }}
                >
                  {exportingFormat === 'docx' ? 'Exporting…' : 'Export DOCX'}
                </button>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close modal"
                  style={{
                    padding: '0.32rem',
                    borderRadius: '6px',
                    border: '1px solid #e2e8f0',
                    backgroundColor: '#f8fafc',
                    color: '#334155',
                    cursor: 'pointer',
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Modal Search Bar */}
            <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid #f1f5f9', backgroundColor: '#f8fafc' }}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <Search size={14} color="#64748b" style={{ position: 'absolute', left: '0.7rem' }} />
                <input
                  type="text"
                  value={modalSearch}
                  onChange={(e) => setModalSearch(e.target.value)}
                  placeholder={
                    focusedSlice
                      ? `Filter line items in ${focusedSlice.shortLabel} by title, code, or MDA...`
                      : `Filter ${dimension === 'sector' ? 'sectors' : 'MDAs'} or cross-ledger flags...`
                  }
                  style={{
                    width: '100%',
                    padding: '0.45rem 0.75rem 0.45rem 2.1rem',
                    borderRadius: '7px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.78rem',
                    color: '#0f172a',
                    backgroundColor: '#ffffff',
                  }}
                />
              </div>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '1rem 1.25rem', overflowY: 'auto', flex: 1 }}>
              {focusedSlice ? (
                <>
                  {/* Focused KPI Strip + 6-Ledger Metadata */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                      gap: '0.65rem',
                      marginBottom: '0.9rem',
                    }}
                  >
                    <div style={{ padding: '0.65rem', borderRadius: '8px', border: '1px solid #e2e8f0', backgroundColor: '#f8fafc' }}>
                      <div style={{ fontSize: '0.66rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                        Extracted Allocation
                      </div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0f172a', marginTop: '0.15rem' }}>
                        {formatNairaCompact(focusedSlice.amount)}
                      </div>
                      <div style={{ fontSize: '0.68rem', color: '#475569' }}>
                        {focusedSlice.sharePct.toFixed(2)}% of schedule
                      </div>
                    </div>

                    <div style={{ padding: '0.65rem', borderRadius: '8px', border: '1px solid #e2e8f0', backgroundColor: '#f8fafc' }}>
                      <div style={{ fontSize: '0.66rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                        YoY vs FY {financialYear - 1}
                      </div>
                      <div
                        style={{
                          fontSize: '0.95rem',
                          fontWeight: 800,
                          color:
                            focusedSlice.yoyDeltaPct === null
                              ? '#64748b'
                              : focusedSlice.yoyDeltaPct >= 0
                                ? '#047857'
                                : '#b91c1c',
                          marginTop: '0.15rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                        }}
                      >
                        {focusedSlice.yoyDeltaPct !== null && (
                          focusedSlice.yoyDeltaPct >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />
                        )}
                        {formatYoyBadge(focusedSlice.yoyDeltaPct) || 'Baseline / Unmatched'}
                      </div>
                      <div style={{ fontSize: '0.68rem', color: '#475569' }}>
                        {focusedSlice.priorAmount !== null
                          ? `Prior: ${formatNairaCompact(focusedSlice.priorAmount)}`
                          : 'No prior year baseline'}
                      </div>
                    </div>

                    <div style={{ padding: '0.65rem', borderRadius: '8px', border: '1px solid #e2e8f0', backgroundColor: '#f8fafc' }}>
                      <div style={{ fontSize: '0.66rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                        Flagged Risk Share
                      </div>
                      <div
                        style={{
                          fontSize: '0.95rem',
                          fontWeight: 800,
                          color: (focusedSlice.flaggedSharePct || 0) >= 15 ? '#b45309' : '#0f172a',
                          marginTop: '0.15rem',
                        }}
                      >
                        {focusedSlice.flaggedSharePct !== null ? `${focusedSlice.flaggedSharePct.toFixed(1)}%` : 'N/A'}
                      </div>
                      <div style={{ fontSize: '0.68rem', color: '#475569' }}>
                        {focusedSlice.flaggedCount.toLocaleString('en-US')} flagged items ({formatNairaCompact(focusedSlice.flaggedAmount)})
                      </div>
                    </div>

                    {focusedSlice.mdaAudit && (
                      <div style={{ padding: '0.65rem', borderRadius: '8px', border: '1px solid #e2e8f0', backgroundColor: '#f8fafc' }}>
                        <div style={{ fontSize: '0.66rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                          6-Ledger MDA Profile
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.15rem' }}>
                          <span
                            style={{
                              fontSize: '0.78rem',
                              fontWeight: 800,
                              padding: '0.1rem 0.4rem',
                              borderRadius: '4px',
                              backgroundColor: focusedSlice.mdaAudit.gradeBg,
                              color: focusedSlice.mdaAudit.gradeColor,
                              border: `1px solid ${focusedSlice.mdaAudit.gradeBorder}`,
                            }}
                          >
                            Grade {focusedSlice.mdaAudit.grade}
                          </span>
                          <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#0f172a' }}>
                            {focusedSlice.mdaAudit.oaugfQueries} OAuGF queries
                          </span>
                        </div>
                        <div style={{ fontSize: '0.67rem', color: '#475569', marginTop: '0.15rem' }}>
                          {focusedSlice.mdaAudit.convergenceLabels.length > 0
                            ? focusedSlice.mdaAudit.convergenceLabels.slice(0, 2).join(' · ')
                            : 'No cross-ledger convergence alert'}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Line-Item Schedule Table */}
                  {yearRecords.length === 0 ? (
                    <div
                      style={{
                        padding: '1.25rem',
                        borderRadius: '8px',
                        backgroundColor: '#f8fafc',
                        border: '1px dashed #cbd5e1',
                        fontSize: '0.8rem',
                        color: '#475569',
                      }}
                    >
                      Line-item project records are not loaded for FY {financialYear} (summary-only year). Export the
                      PDF or DOCX dossier above for full statistical provenance.
                    </div>
                  ) : focusedProjects.length === 0 ? (
                    <div style={{ padding: '1.25rem', textAlign: 'center', fontSize: '0.8rem', color: '#64748b' }}>
                      No matching projects found inside {focusedSlice.fullName}.
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '0.45rem' }}>
                        Showing top {Math.min(100, focusedProjects.length).toLocaleString('en-US')} of{' '}
                        {focusedProjects.length.toLocaleString('en-US')} line items
                        {onSelectProject ? ' (click any row to inspect provenance & evidence)' : ''}
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                          <thead>
                            <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left', color: '#475569' }}>
                              <th style={{ padding: '0.45rem 0.5rem' }}>Code</th>
                              <th style={{ padding: '0.45rem 0.5rem' }}>Project Description</th>
                              <th style={{ padding: '0.45rem 0.5rem' }}>{dimension === 'sector' ? 'Agency / MDA' : 'Sector'}</th>
                              <th style={{ padding: '0.45rem 0.5rem', textAlign: 'right' }}>Allocation</th>
                              <th style={{ padding: '0.45rem 0.5rem', textAlign: 'center' }}>Flags</th>
                            </tr>
                          </thead>
                          <tbody>
                            {focusedProjects.slice(0, 100).map((r) => {
                              const compound = findCompoundForProject(compoundLookup, financialYear, {
                                id: r.recordIdentity.id,
                                projectCode: r.recordIdentity.projectCode,
                                projectName: r.recordIdentity.verbatimProjectName,
                                page: r.sourceProvenance?.pdfPage ?? 1,
                                amount: r.recordIdentity.amountNaira,
                              });
                              const flagged =
                                compound !== null || (r.forensicEvidenceFlags?.length ?? 0) > 0;
                              return (
                                <tr
                                  key={r.recordIdentity.id}
                                  onClick={() => {
                                    if (onSelectProject) {
                                      onSelectProject(toModalProjectShape(r, financialYear));
                                    }
                                  }}
                                  style={{
                                    borderBottom: '1px solid #f1f5f9',
                                    cursor: onSelectProject ? 'pointer' : 'default',
                                  }}
                                >
                                  <td style={{ padding: '0.45rem 0.5rem', fontFamily: 'monospace', fontSize: '0.71rem', color: '#334155', whiteSpace: 'nowrap' }}>
                                    {r.recordIdentity.projectCode || 'LINE-ITEM'}
                                  </td>
                                  <td style={{ padding: '0.45rem 0.5rem', color: '#0f172a', fontWeight: 500 }}>
                                    {r.recordIdentity.verbatimProjectName}
                                  </td>
                                  <td style={{ padding: '0.45rem 0.5rem', color: '#475569' }}>
                                    {dimension === 'sector' ? resolveMdaGroupKey(r) : resolveSectorGroupKey(r)}
                                  </td>
                                  <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                                    {formatNairaExact(r.recordIdentity.amountNaira)}
                                  </td>
                                  <td style={{ padding: '0.45rem 0.5rem', textAlign: 'center' }}>
                                    {flagged ? (
                                      <span style={{ fontSize: '0.64rem', fontWeight: 700, padding: '0.1rem 0.35rem', borderRadius: '4px', backgroundColor: '#fef3c7', color: '#b45309' }}>
                                        Flagged
                                      </span>
                                    ) : (
                                      <span style={{ color: '#94a3b8' }}>-</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left', color: '#475569' }}>
                        <th style={{ padding: '0.45rem 0.5rem' }}>#</th>
                        <th style={{ padding: '0.45rem 0.5rem' }}>{dimension === 'sector' ? 'Sector' : 'Ministry / Agency'}</th>
                        <th style={{ padding: '0.45rem 0.5rem', textAlign: 'right' }}>Allocation</th>
                        <th style={{ padding: '0.45rem 0.5rem', textAlign: 'right' }}>Share</th>
                        <th style={{ padding: '0.45rem 0.5rem', textAlign: 'right' }}>YoY %</th>
                        <th style={{ padding: '0.45rem 0.5rem', textAlign: 'right' }}>Flagged</th>
                        {dimension === 'mda' && <th style={{ padding: '0.45rem 0.5rem' }}>6-Ledger</th>}
                        <th style={{ padding: '0.45rem 0.5rem' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAllRanked.map((entry) => {
                        const yoyText = formatYoyBadge(entry.yoyDeltaPct);
                        return (
                          <tr
                            key={entry.name}
                            onClick={() => {
                              setModalFocusName(entry.name);
                              setModalFocusIsOther(false);
                              setModalSearch('');
                            }}
                            style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                          >
                            <td style={{ padding: '0.45rem 0.5rem', fontWeight: 700, color: '#64748b' }}>{entry.rank}</td>
                            <td style={{ padding: '0.45rem 0.5rem', fontWeight: 600, color: '#0f172a' }}>{entry.fullName}</td>
                            <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                              {formatNairaCompact(entry.amount)}
                            </td>
                            <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {entry.sharePct.toFixed(2)}%
                            </td>
                            <td
                              style={{
                                padding: '0.45rem 0.5rem',
                                textAlign: 'right',
                                fontVariantNumeric: 'tabular-nums',
                                color:
                                  entry.yoyDeltaPct === null
                                    ? '#94a3b8'
                                    : entry.yoyDeltaPct >= 0
                                      ? '#047857'
                                      : '#b91c1c',
                              }}
                            >
                              {yoyText || 'N/A'}
                            </td>
                            <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {entry.flaggedSharePct !== null && entry.flaggedCount > 0 ? (
                                <span style={{ color: '#b45309', fontWeight: 600 }}>
                                  {entry.flaggedSharePct.toFixed(1)}%
                                </span>
                              ) : (
                                <span style={{ color: '#94a3b8' }}>0%</span>
                              )}
                            </td>
                            {dimension === 'mda' && (
                              <td style={{ padding: '0.45rem 0.5rem' }}>
                                {entry.mdaAudit ? (
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
                                    <span
                                      style={{
                                        fontSize: '0.64rem',
                                        fontWeight: 800,
                                        padding: '0.06rem 0.32rem',
                                        borderRadius: '4px',
                                        backgroundColor: entry.mdaAudit.gradeBg,
                                        color: entry.mdaAudit.gradeColor,
                                        border: `1px solid ${entry.mdaAudit.gradeBorder}`,
                                      }}
                                    >
                                      {entry.mdaAudit.grade}
                                    </span>
                                    {entry.mdaAudit.oaugfQueries > 0 && (
                                      <span style={{ fontSize: '0.67rem', color: '#475569' }}>
                                        {entry.mdaAudit.oaugfQueries} Qs
                                      </span>
                                    )}
                                  </span>
                                ) : (
                                  <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Uncovered</span>
                                )}
                              </td>
                            )}
                            <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right' }}>
                              <ChevronRight size={14} color="#64748b" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '0.75rem 1.25rem',
                borderTop: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: '#f8fafc',
                fontSize: '0.72rem',
                color: '#64748b',
              }}
            >
              <span>
                Official Enacted FY {financialYear} Macro Budget: {formatNairaCompact(macro.officialTotalBudget)}
              </span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                style={{
                  backgroundColor: '#0f172a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '0.45rem 0.9rem',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Close Inspection Drawer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
