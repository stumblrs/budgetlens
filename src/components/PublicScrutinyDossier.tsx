import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Car,
  ChevronDown,
  ChevronRight,
  Copy,
  Crown,
  Download,
  ExternalLink,
  FileText,
  FileWarning,
  Info,
  Layers,
  Scale,
  Search,
  ShieldAlert,
  Sparkles,
  Split,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PRESIDENTS_AGGREGATE } from '../data/presidentialTerms';
import { PresidentAvatar } from './PresidentAvatar';
import { ExpandableText } from './ExpandableText';
import { buildCanonicalPermalink, readScrutinyUrlState, syncUrlParams } from '../utils/urlState';
import { loadSourceProvenance, resolveYearProvenance } from '../utils/citationFormatter';
import {
  ExportSectionTable,
  ScrutinyBriefExportInput,
  exportPresidentialScrutinyDocx,
  exportPresidentialScrutinyPdf,
} from '../utils/documentExporter';
import {
  loadProjectLifecycleIndex,
  lookupScrutinyBadge,
  type ProjectLifecycleIndex,
} from '../utils/projectLifecycle';
import {
  loadMacroCredibilityTracker,
  type AdministrationCredibilityRow,
  type MacroCredibilityTrackerPayload,
} from '../utils/mdaScorecard';

interface Equivalents {
  minWageAnnualSalaries: number;
  primaryHealthCentres: number;
  classroomBlocks: number;
  solarBoreholes: number;
}

interface ScrutinyItem {
  id: string;
  financialYear: number;
  presidentId: string;
  presidentName: string;
  party: string;
  termId?: string;
  projectCode: string;
  projectName: string;
  agency: string;
  sector: string;
  state?: string | null;
  amount: number;
  amountUsd: number;
  fxRate: number;
  budgetSharePct: number;
  minWageMonthly: number;
  page: number;
  sourceFile?: string;
  equivalents: Equivalents;
  unitCount?: number | null;
  impliedUnitCostNaira?: number | null;
  insertedCategory?: string;
  ambiguityReason?: string;
}

interface DisguisedCluster {
  signature: string;
  financialYear?: number;
  presidentId?: string;
  presidentName?: string;
  party?: string;
  yearsAppeared?: number[];
  presidentsSpanned?: string[];
  crossedAdministrations?: boolean;
  count: number;
  distinctCodes: number;
  distinctWordings?: number;
  distinctAgencies: number;
  recodedAcrossYears?: boolean;
  agencyHopped?: boolean;
  totalAmount: number;
  totalUsd: number;
  equivalents: Equivalents;
  items: ScrutinyItem[];
}

interface RoundSplitCluster {
  financialYear: number;
  presidentId: string;
  presidentName: string;
  party: string;
  agency: string;
  unitAmount: number;
  unitAmountUsd: number;
  itemCount: number;
  totalAmount: number;
  totalUsd: number;
  equivalents: Equivalents;
  sampleItems: ScrutinyItem[];
}

interface OverheadByPresCell {
  nominal: number;
  usd: number;
  recordCount: number;
}

interface OverheadCodeSeries {
  economicCode: string;
  label: string;
  recordCount: number;
  total2023_2026: number;
  totalAllYears: number;
  totalUsd: number;
  yearlyTotals: Record<string, number>;
  yearlyUsdTotals: Record<string, number>;
  byPresident: Record<string, OverheadByPresCell>;
  growth2023To2026Pct: number;
  equivalents: Equivalents;
  topMdas: Array<{ agency: string; totalUsd: number }>;
  topItems: ScrutinyItem[];
}

interface PresidentBucketStat {
  count?: number;
  clusterCount?: number;
  itemCount?: number;
  recordCount?: number;
  totalAmount: number;
  totalUsd: number;
}

interface OaugfTopFinding {
  year: number;
  docTitle?: string;
  page?: number;
  category: string;
  mdaName: string;
  heading?: string;
  amountNaira: number;
  amountUsd: number;
  repeatNeglect: boolean;
  recoveryRequired: boolean;
  excerpt: string;
}

interface PresidentCrossLedgerProfile {
  oaugf: {
    reportsCount: number;
    yearsAudited: number[];
    issuesCount: number;
    repeatNeglectCount: number;
    recoveryDirectiveCount: number;
    totalQueriedNaira: number;
    totalQueriedUsd: number;
    topCategories: Array<{ category: string; count: number }>;
    topFindings: OaugfTopFinding[];
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
    topPaddedMdas: Array<{ mdaName: string; totalPositivePaddingNaira: number }>;
  };
  macroAndDebt: {
    birCoverageStatus: string;
    birYearsCovered: number;
    avgCapitalPerformancePct: number | null;
    avgRevenuePerformancePct: number | null;
    avgDebtServicePerformancePct: number | null;
    debtServiceOverrunYears: number;
    totalDebtServiceOverrunNaira: number;
    dmoStartDebtNairaM: number | null;
    dmoEndDebtNairaM: number | null;
    dmoEndDebtUsdM: number | null;
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

interface CrossLedgerTotals {
  oaugfReportsIndexed: number;
  oaugfParsedIssuesCount: number;
  oaugfRepeatNeglectCount: number;
  oaugfRecoveryDirectiveCount: number;
  oaugfTotalQueriedNaira: number;
  oaugfTotalQueriedUsd: number;
  billActCyclesCount: number;
  billActInsertionsCount: number;
  billActInsertionsNaira: number;
  openTreasuryVouchersCount: number;
  openTreasuryTotalNaira: number;
  openTreasuryPersonalAccountBeneficiaries: number;
  openTreasuryPersonalAccountNaira: number;
  openTreasuryOpaqueDiscretionaryVouchers: number;
  openTreasuryOpaqueDiscretionaryNaira: number;
  nocopoAwardedContractsAnalyzed: number;
  nocopoAwardedTotalNaira: number;
  nocopoNonCompetitiveNaira: number;
  nocopoVariationOverrunsNaira: number;
  evidenceEngineV3RulesCount: number;
  evidenceEngineV3TotalFindings: number;
  evidenceEngineV3CrossLedgerFindings: number;
  evidenceEngineV3FlaggedProjects: number;
}

interface PresidentSummary {
  presidentId: string;
  presidentName: string;
  shortName: string;
  party: string;
  accentColor: string;
  tenureLabel: string;
  budgetYears: number[];
  fxRangeLabel: string;
  minWageRangeLabel: string;
  avgFxNairaPerUsd: number;
  enactedBudgetSumNominal: number;
  enactedBudgetSumUsd: number;
  fullScheduleYearsCount: number;
  partialScheduleYearsCount: number;
  summaryOnlyYearsCount: number;
  handoverNote: string;
  recordsScanned: number;
  leafCapitalCount: number;
  leafOverheadCount: number;
  uniqueFlaggedCapitalLines: number;
  flaggedCapitalNominal: number;
  flaggedCapitalUsd: number;
  overheadNominal: number;
  overheadUsd: number;
  combinedNominal: number;
  combinedUsd: number;
  combinedBudgetSharePct: number;
  annualizedUsdPerScheduledYear: number;
  equivalents: Equivalents;
  disguisedWithinClusters: number;
  roundSplitClusters: number;
  pillarBreakdown: Record<string, PresidentBucketStat>;
  crossLedgerProfile?: PresidentCrossLedgerProfile;
}

interface YearlyTimelineRow {
  financialYear: number;
  presidentId: string;
  presidentName: string;
  shortName: string;
  party: string;
  accentColor: string;
  officialBudgetNaira: number;
  fxNairaPerUsd: number;
  minWageMonthly: number;
  thresholdsApplied: {
    vehiclesNaira: number;
    mandatesNaira: number;
    blankCheckNaira: number;
    blankShortNaira: number;
    ceremonialNaira: number;
    intangibleNaira: number;
  };
  dataCoverage: 'full_project_schedule' | 'partial_schedule' | 'summary_act_only';
  totalRecordsScanned: number;
  leafCapitalCount: number;
  leafOverheadCount: number;
  uniqueFlaggedLines: number;
  flaggedCapitalNominal: number;
  flaggedCapitalUsd: number;
  overheadNominal: number;
  overheadUsd: number;
  combinedNominal: number;
  combinedUsd: number;
  combinedBudgetSharePct: number;
  disguisedClusterCount: number;
  roundSplitClusterCount: number;
}

interface ForensicSweepPayload {
  generatedAt: string;
  scope: string;
  methodology: string;
  yearsCovered: number[];
  hygiene: {
    totalRecordsScanned: number;
    leafCapitalCount: number;
    leafOverheadCount: number;
    excludedRollupRows: number;
  };
  headlineMetrics: {
    uniqueFlaggedCapitalLines: number;
    uniqueFlaggedCapitalExposure: number;
    uniqueFlaggedCapitalUsd: number;
    discretionaryOverheadExposure: number;
    discretionaryOverheadUsd: number;
    combinedScrutinyExposure: number;
    combinedScrutinyUsd: number;
    combinedScheduledBudgetSharePct: number;
    combinedEquivalents: Equivalents;
    withinYearDisguisedClusters: number;
    crossYearRecodedOrHoppedClusters: number;
    roundNumberSplitClusters: number;
    overheadSurge2023To2026Pct: number;
    crossLedgerTotals?: CrossLedgerTotals;
  };
  presidents: PresidentSummary[];
  yearlyTimeline: YearlyTimelineRow[];
  pillars: {
    unitCostVehicles: {
      title: string;
      count: number;
      totalAmount: number;
      totalUsd: number;
      equivalents: Equivalents;
      byPresident: Record<string, PresidentBucketStat>;
      items: ScrutinyItem[];
    };
    mdaMandateMismatches: {
      title: string;
      count: number;
      totalAmount: number;
      totalUsd: number;
      equivalents: Equivalents;
      byPresident: Record<string, PresidentBucketStat>;
      topMdas: Array<{ agency: string; count: number; totalAmount: number; totalUsd: number }>;
      items: ScrutinyItem[];
    };
    vagueBlankChecks: {
      title: string;
      count: number;
      totalAmount: number;
      totalUsd: number;
      equivalents: Equivalents;
      byPresident: Record<string, PresidentBucketStat>;
      items: ScrutinyItem[];
    };
    disguisedDuplicates: {
      title: string;
      withinYearCount: number;
      withinYearTotalAmount: number;
      withinYearTotalUsd: number;
      crossYearCount: number;
      crossYearTotalAmount: number;
      crossYearTotalUsd: number;
      byPresident: Record<string, PresidentBucketStat>;
      withinYearClusters: DisguisedCluster[];
      crossYearClusters: DisguisedCluster[];
    };
    roundNumberSplits: {
      title: string;
      clusterCount: number;
      itemCount: number;
      totalAmount: number;
      totalUsd: number;
      equivalents: Equivalents;
      byPresident: Record<string, PresidentBucketStat>;
      clusters: RoundSplitCluster[];
    };
    overheadSurge: {
      title: string;
      totalAllYears: number;
      totalAllYearsUsd: number;
      total2023_2026: number;
      total2023: number;
      total2026: number;
      growth2023To2026Pct: number;
      equivalents: Equivalents;
      byPresident: Record<string, PresidentBucketStat>;
      codes: OverheadCodeSeries[];
    };
    ceremonialAndSectarian: {
      title: string;
      count: number;
      totalAmount: number;
      totalUsd: number;
      equivalents: Equivalents;
      byPresident: Record<string, PresidentBucketStat>;
      items: ScrutinyItem[];
    };
    intangibleSoftSpend: {
      title: string;
      count: number;
      totalAmount: number;
      totalUsd: number;
      equivalents: Equivalents;
      byPresident: Record<string, PresidentBucketStat>;
      items: ScrutinyItem[];
    };
  };
}

type PillarTab =
  | 'oaugfAndCrossLedger'
  | 'vehicles'
  | 'mandates'
  | 'blankChecks'
  | 'disguised'
  | 'roundSplits'
  | 'overhead'
  | 'ceremonial'
  | 'intangible';

type CurrencyView = 'usd' | 'nominal';
type ChartMetricView = 'usd' | 'nominal' | 'budgetShare';

interface PublicScrutinyDossierProps {
  onSelectProject?: (project: any) => void;
}

const PRES_AVATAR_MAP = Object.fromEntries(
  PRESIDENTS_AGGREGATE.map((p) => [p.presidentId, p])
);

const PRES_COLOR_MAP: Record<string, string> = {
  obasanjo: '#10b981',
  yaradua: '#0284c7',
  jonathan: '#2563eb',
  buhari: '#8b5cf6',
  tinubu: '#d97706',
};

function fmtNaira(amt: number): string {
  if (!amt) return '₦0';
  if (amt >= 1e12) return `₦${(amt / 1e12).toFixed(2)}T`;
  if (amt >= 1e9) return `₦${(amt / 1e9).toFixed(2)}B`;
  if (amt >= 1e6) return `₦${(amt / 1e6).toFixed(2)}M`;
  return `₦${Math.round(amt).toLocaleString()}`;
}

function fmtUsd(amt: number): string {
  if (!amt) return '$0';
  if (amt >= 1e9) return `$${(amt / 1e9).toFixed(2)}B`;
  if (amt >= 1e6) return `$${(amt / 1e6).toFixed(2)}M`;
  if (amt >= 1e3) return `$${(amt / 1e3).toFixed(1)}K`;
  return `$${Math.round(amt).toLocaleString()}`;
}

export const PublicScrutinyDossier: React.FC<PublicScrutinyDossierProps> = ({ onSelectProject }) => {
  const initialScrutinyUrl = useMemo(() => readScrutinyUrlState(), []);
  const [data, setData] = useState<ForensicSweepPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [currencyView, setCurrencyView] = useState<CurrencyView>(initialScrutinyUrl.currency);
  const [chartMetric, setChartMetric] = useState<ChartMetricView>('usd');
  const [selectedPresident, setSelectedPresident] = useState<string>(initialScrutinyUrl.president);
  const [yearFilter, setYearFilter] = useState<'ALL' | number>(initialScrutinyUrl.sy);
  const [activePillar, setActivePillar] = useState<PillarTab>(initialScrutinyUrl.pillar);
  const [query, setQuery] = useState(initialScrutinyUrl.sq);
  const [dupScope, setDupScope] = useState<'crossYear' | 'withinYear'>('crossYear');
  const [expandedSplitIdx, setExpandedSplitIdx] = useState<number | null>(0);
  const [expandedDupIdx, setExpandedDupIdx] = useState<number | null>(0);
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [lifecycleIndex, setLifecycleIndex] = useState<ProjectLifecycleIndex | null>(null);
  const [macroCredibility, setMacroCredibility] = useState<MacroCredibilityTrackerPayload | null>(null);
  const [paidOnPaperOnly, setPaidOnPaperOnly] = useState(false);

  const isPopStateRef = React.useRef(false);
  const hasMountedSyncRef = React.useRef(false);
  const lastNavRef = React.useRef<{ president: string; pillar: PillarTab }>({
    president: initialScrutinyUrl.president,
    pillar: initialScrutinyUrl.pillar,
  });

  useEffect(() => {
    if (isPopStateRef.current) {
      isPopStateRef.current = false;
      lastNavRef.current = { president: selectedPresident, pillar: activePillar };
      return;
    }

    const isMajorSwitch =
      hasMountedSyncRef.current &&
      (selectedPresident !== lastNavRef.current.president || activePillar !== lastNavRef.current.pillar);
    hasMountedSyncRef.current = true;
    lastNavRef.current = { president: selectedPresident, pillar: activePillar };

    syncUrlParams(
      {
        president: selectedPresident !== 'ALL' ? selectedPresident : null,
        pillar: activePillar,
        sy: yearFilter !== 'ALL' ? yearFilter : null,
        currency: currencyView !== 'usd' ? currencyView : null,
        sq: query.trim() || null,
      },
      isMajorSwitch ? 'push' : 'replace'
    );
  }, [selectedPresident, activePillar, yearFilter, currencyView, query]);

  useEffect(() => {
    const onPopState = () => {
      const next = readScrutinyUrlState();
      isPopStateRef.current = true;
      setSelectedPresident(next.president);
      setActivePillar(next.pillar);
      setYearFilter(next.sy);
      setCurrencyView(next.currency);
      setQuery(next.sq);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch('/datasets/forensic_sweep_1999_2026.json', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: ForensicSweepPayload | null) => {
        if (!active) return;
        setData(json);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setData(null);
        setLoading(false);
      });
    loadProjectLifecycleIndex().then((idx) => {
      if (active && idx) setLifecycleIndex(idx);
    });
    loadMacroCredibilityTracker().then((mc) => {
      if (active && mc) setMacroCredibility(mc);
    });
    return () => {
      active = false;
    };
  }, []);

  const adminCredById = useMemo(() => {
    const out: Record<string, AdministrationCredibilityRow> = {};
    for (const adm of macroCredibility?.administrations || []) {
      out[adm.presidentId] = adm;
    }
    return out;
  }, [macroCredibility]);

  const fmtPrimary = (nom: number, usd: number) =>
    currencyView === 'usd' ? fmtUsd(usd) : fmtNaira(nom);

  const fmtSecondary = (nom: number, usd: number) =>
    currencyView === 'usd' ? fmtNaira(nom) : fmtUsd(usd);

  const selectedPresProfile = useMemo(() => {
    if (!data || selectedPresident === 'ALL') return null;
    return data.presidents.find((p) => p.presidentId === selectedPresident) || null;
  }, [data, selectedPresident]);

  const selectedYearRow = useMemo(() => {
    if (!data || yearFilter === 'ALL') return null;
    return data.yearlyTimeline.find((y) => y.financialYear === yearFilter) || null;
  }, [data, yearFilter]);

  const handleSelectPresident = (pid: string) => {
    setSelectedPresident(pid);
    setYearFilter('ALL');
  };

  const selectableYears = useMemo(() => {
    if (!data) return [];
    if (selectedPresProfile) return selectedPresProfile.budgetYears;
    return [2004, 2008, 2009, 2010, 2012, 2014, 2016, 2018, 2020, 2022, 2023, 2024, 2025, 2026];
  }, [data, selectedPresProfile]);

  const qLower = query.trim().toLowerCase();

  const matchesPresidentAndYear = (presId?: string, fy?: number) => {
    if (selectedPresident !== 'ALL' && presId !== selectedPresident) return false;
    if (yearFilter !== 'ALL' && fy !== yearFilter) return false;
    return true;
  };

  const filterItem = (item: ScrutinyItem) => {
    if (!matchesPresidentAndYear(item.presidentId, item.financialYear)) return false;
    if (paidOnPaperOnly && !lookupScrutinyBadge(lifecycleIndex, item)?.paidOnPaperPriority) {
      return false;
    }
    if (!qLower) return true;
    return (
      item.projectName.toLowerCase().includes(qLower) ||
      item.agency.toLowerCase().includes(qLower) ||
      item.projectCode.toLowerCase().includes(qLower) ||
      item.presidentName.toLowerCase().includes(qLower)
    );
  };

  const openModal = (it: ScrutinyItem) => {
    onSelectProject?.({
      id: it.id,
      projectCode: it.projectCode,
      projectName: it.projectName,
      agency: it.agency,
      financialYear: it.financialYear,
      amount: it.amount,
      page: it.page,
      sector: it.sector,
      state: it.state,
      sourceFilename: it.sourceFile,
    });
  };

  // Timeline BarChart series (1999-2026)
  const timelineChartData = useMemo(() => {
    if (!data) return [];
    return data.yearlyTimeline.map((row) => {
      const value =
        chartMetric === 'budgetShare'
          ? row.combinedBudgetSharePct
          : chartMetric === 'usd'
          ? Number((row.combinedUsd / 1e9).toFixed(3))
          : Number((row.combinedNominal / 1e9).toFixed(2));
      return {
        year: String(row.financialYear),
        financialYear: row.financialYear,
        presidentId: row.presidentId,
        presidentName: row.shortName,
        value,
        fxRate: row.fxNairaPerUsd,
        budgetSharePct: row.combinedBudgetSharePct,
        flaggedLines: row.uniqueFlaggedLines,
        color: PRES_COLOR_MAP[row.presidentId] || '#059669',
      };
    });
  }, [data, chartMetric]);

  // Overhead comparison across all 5 Presidential Administrations
  const overheadChartData = useMemo(() => {
    if (!data) return [];
    return data.pillars.overheadSurge.codes.map((c) => {
      const getP = (pid: string) => {
        const cell = c.byPresident?.[pid];
        if (!cell) return 0;
        const val = currencyView === 'usd' ? cell.usd / 1e6 : cell.nominal / 1e9;
        return Number(val.toFixed(2));
      };
      return {
        name: c.label.split(' ')[0] + ' (' + c.economicCode.slice(-4) + ')',
        obasanjo: getP('obasanjo'),
        yaradua: getP('yaradua'),
        jonathan: getP('jonathan'),
        buhari: getP('buhari'),
        tinubu: getP('tinubu'),
      };
    });
  }, [data, currencyView]);

  // Scoped KPI summary
  const scopedKpis = useMemo(() => {
    if (!data) return null;
    if (!selectedPresProfile) {
      const hm = data.headlineMetrics;
      return {
        recordsScanned: data.hygiene.totalRecordsScanned,
        leafCapital: data.hygiene.leafCapitalCount,
        leafOverhead: data.hygiene.leafOverheadCount,
        combinedNominal: hm.combinedScrutinyExposure,
        combinedUsd: hm.combinedScrutinyUsd,
        budgetSharePct: hm.combinedScheduledBudgetSharePct,
        phcsEqv: hm.combinedEquivalents.primaryHealthCentres,
        disguisedCount: hm.withinYearDisguisedClusters + hm.crossYearRecodedOrHoppedClusters,
        roundSplitCount: hm.roundNumberSplitClusters,
        overheadNominal: hm.discretionaryOverheadExposure,
        overheadUsd: hm.discretionaryOverheadUsd,
        flaggedCapitalLines: hm.uniqueFlaggedCapitalLines,
      };
    }

    const p = selectedPresProfile;
    return {
      recordsScanned: p.recordsScanned,
      leafCapital: p.leafCapitalCount,
      leafOverhead: p.leafOverheadCount,
      combinedNominal: p.combinedNominal,
      combinedUsd: p.combinedUsd,
      budgetSharePct: p.combinedBudgetSharePct,
      phcsEqv: p.equivalents.primaryHealthCentres,
      disguisedCount: p.disguisedWithinClusters,
      roundSplitCount: p.roundSplitClusters,
      overheadNominal: p.overheadNominal,
      overheadUsd: p.overheadUsd,
      flaggedCapitalLines: p.uniqueFlaggedCapitalLines,
    };
  }, [data, selectedPresProfile]);

  if (loading) {
    return (
      <div className="dossier-card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        <span className="font-mono" style={{ fontSize: '0.82rem' }}>
          Loading 1999–2026 Fourth Republic Year-Native Scrutiny &amp; Presidential Audit Dossier...
        </span>
      </div>
    );
  }

  if (!data || !scopedKpis) {
    return (
      <div className="dossier-card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Unable to load the Fourth Republic scrutiny dataset right now. Please refresh the page.
      </div>
    );
  }

  const { hygiene, headlineMetrics, pillars } = data;

  const getPillarCount = (globalCount: number, key: string) => {
    if (!selectedPresProfile) return globalCount;
    const stat = selectedPresProfile.pillarBreakdown[key];
    return stat ? stat.count ?? stat.clusterCount ?? 0 : 0;
  };

  const crossTotals = headlineMetrics.crossLedgerTotals;
  const scopedOaugfIssuesCount = selectedPresProfile
    ? selectedPresProfile.crossLedgerProfile?.oaugf.issuesCount ?? 0
    : crossTotals?.oaugfParsedIssuesCount ?? 7028;

  const tabs: Array<{ id: PillarTab; label: string; badge: string; icon: React.ReactNode }> = [
    {
      id: 'oaugfAndCrossLedger',
      label: 'OAuGF & 6-Ledger Record',
      badge: `${scopedOaugfIssuesCount.toLocaleString()} queries`,
      icon: <ShieldAlert size={14} />,
    },
    { id: 'vehicles', label: 'Fleet & Unit Cost', badge: `${getPillarCount(pillars.unitCostVehicles.count, 'vehicles').toLocaleString()}`, icon: <Car size={14} /> },
    { id: 'mandates', label: 'MDA Mismatches', badge: `${getPillarCount(pillars.mdaMandateMismatches.count, 'mandates').toLocaleString()}`, icon: <Building2 size={14} /> },
    { id: 'blankChecks', label: 'Blank-Check Lines', badge: `${getPillarCount(pillars.vagueBlankChecks.count, 'blankChecks').toLocaleString()}`, icon: <FileWarning size={14} /> },
    {
      id: 'disguised',
      label: 'Disguised & Hopping',
      badge: selectedPresProfile
        ? `${selectedPresProfile.disguisedWithinClusters.toLocaleString()}`
        : `${(pillars.disguisedDuplicates.crossYearCount + pillars.disguisedDuplicates.withinYearCount).toLocaleString()}`,
      icon: <Copy size={14} />,
    },
    { id: 'roundSplits', label: 'Round-Number Splits', badge: `${getPillarCount(pillars.roundNumberSplits.clusterCount, 'roundSplits').toLocaleString()}`, icon: <Split size={14} /> },
    {
      id: 'overhead',
      label: 'Discretionary Overhead',
      badge: selectedPresProfile
        ? fmtPrimary(selectedPresProfile.overheadNominal, selectedPresProfile.overheadUsd)
        : fmtPrimary(pillars.overheadSurge.totalAllYears, pillars.overheadSurge.totalAllYearsUsd),
      icon: <TrendingUp size={14} />,
    },
    { id: 'ceremonial', label: 'Quarters & Sectarian', badge: `${getPillarCount(pillars.ceremonialAndSectarian.count, 'ceremonial').toLocaleString()}`, icon: <Crown size={14} /> },
    { id: 'intangible', label: 'Intangible Soft Spend', badge: `${getPillarCount(pillars.intangibleSoftSpend.count, 'intangible').toLocaleString()}`, icon: <Sparkles size={14} /> },
  ];

  const getPillarTotalsForScope = (
    pillarObj: { count: number; totalAmount: number; totalUsd: number; byPresident: Record<string, PresidentBucketStat> },
    key: string
  ) => {
    if (!selectedPresProfile) {
      return {
        count: pillarObj.count,
        totalAmount: pillarObj.totalAmount,
        totalUsd: pillarObj.totalUsd,
      };
    }
    const ps = pillarObj.byPresident?.[selectedPresProfile.presidentId] || selectedPresProfile.pillarBreakdown[key];
    return {
      count: ps?.count ?? ps?.clusterCount ?? 0,
      totalAmount: ps?.totalAmount || 0,
      totalUsd: ps?.totalUsd || 0,
    };
  };

  const buildScopedScrutinyBriefInput = async (): Promise<ScrutinyBriefExportInput> => {
    const refYear =
      yearFilter !== 'ALL'
        ? yearFilter
        : selectedPresProfile?.budgetYears[selectedPresProfile.budgetYears.length - 1] ?? 2026;
    const manifest = await loadSourceProvenance();
    const prov = resolveYearProvenance(manifest, refYear);
    const activeTabMeta = tabs.find((t) => t.id === activePillar) || tabs[0];
    const scopeLabel = selectedPresProfile
      ? `${selectedPresProfile.presidentName} (${selectedPresProfile.tenureLabel})`
      : 'Fourth Republic Aggregate (1999–2026)';

    const permalink =
      buildCanonicalPermalink({
        tab: 'scrutiny',
        president: selectedPresident !== 'ALL' ? selectedPresident : null,
        pillar: activePillar,
        sy: yearFilter !== 'ALL' ? yearFilter : null,
        currency: currencyView !== 'usd' ? currencyView : null,
        sq: query.trim() || null,
      }) || 'https://budgetlens.ng/?tab=scrutiny';

    const baselineNotes: string[] = [];
    if (selectedYearRow) {
      baselineNotes.push(
        `FY ${selectedYearRow.financialYear} (${selectedYearRow.presidentName}): Enacted Budget ${fmtNaira(selectedYearRow.officialBudgetNaira)}, CBN FX ₦${selectedYearRow.fxNairaPerUsd}/US$1, Statutory Minimum Wage ₦${selectedYearRow.minWageMonthly.toLocaleString()}/month.`,
        `Calibrated Cutoffs — Fleet ($65k): ${fmtNaira(selectedYearRow.thresholdsApplied.vehiclesNaira)} | Mandate ($15k): ${fmtNaira(selectedYearRow.thresholdsApplied.mandatesNaira)} | Blank-Check (0.001%): ${fmtNaira(selectedYearRow.thresholdsApplied.blankCheckNaira)} | Ceremonial ($30k): ${fmtNaira(selectedYearRow.thresholdsApplied.ceremonialNaira)} | Intangible (0.0004%): ${fmtNaira(selectedYearRow.thresholdsApplied.intangibleNaira)}.`
      );
    } else if (selectedPresProfile) {
      baselineNotes.push(
        `Administration Context: ${selectedPresProfile.presidentName} (${selectedPresProfile.party} · ${selectedPresProfile.tenureLabel}).`,
        `Economic Reality Baseline: CBN FX Range ${selectedPresProfile.fxRangeLabel} | Minimum Wage ${selectedPresProfile.minWageRangeLabel} | Enacted Budgets Sum ${fmtNaira(selectedPresProfile.enactedBudgetSumNominal)} (US$${(selectedPresProfile.enactedBudgetSumUsd / 1e9).toFixed(1)}B).`,
        `Schedule Coverage: ${selectedPresProfile.fullScheduleYearsCount} full project schedules, ${selectedPresProfile.partialScheduleYearsCount} partial schedules, ${selectedPresProfile.summaryOnlyYearsCount} summary-act years.${selectedPresProfile.handoverNote ? ` Note: ${selectedPresProfile.handoverNote}` : ''}`
      );
    } else {
      baselineNotes.push(
        'All thresholds scale strictly to each year CBN FX rate, enacted budget share, and contemporaneous statutory minimum wage across 28 years (1999–2026) with zero CPI back-casting.'
      );
    }

    const comparisonTable: ExportSectionTable | undefined = !selectedPresProfile
      ? {
          heading: 'Fourth Republic Presidential Scrutiny & 6-Ledger Accountability Comparison (1999–2026)',
          columns: [
            'Administration',
            'Years',
            'CBN FX Range',
            currencyView === 'usd' ? 'Flagged Capital ($)' : 'Flagged Capital (₦)',
            currencyView === 'usd' ? 'Overhead ($)' : 'Overhead (₦)',
            'Combined Exposure',
            '% Scheduled Budget',
            'OAuGF Audit Queries',
            'Bill→Act Insertions',
          ],
          rows: data.presidents.map((p) => {
            const oa = p.crossLedgerProfile?.oaugf;
            const lp = p.crossLedgerProfile?.legislativePadding;
            return [
              `${p.presidentName} (${p.party})`,
              p.budgetYears.length,
              p.fxRangeLabel,
              fmtPrimary(p.flaggedCapitalNominal, p.flaggedCapitalUsd),
              fmtPrimary(p.overheadNominal, p.overheadUsd),
              fmtPrimary(p.combinedNominal, p.combinedUsd),
              `${p.combinedBudgetSharePct.toFixed(2)}%`,
              oa ? `${oa.issuesCount.toLocaleString()} (${oa.repeatNeglectCount} repeat / ${oa.recoveryDirectiveCount} recov)` : 'N/A',
              lp && lp.cyclesCount > 0 ? `${lp.insertionsCount.toLocaleString()} (${fmtNaira(lp.insertionsTotalNaira)})` : 'Pre-Diff Era',
            ];
          }),
          rightAlignColumns: [1, 3, 4, 5, 6, 7, 8],
        }
      : undefined;

    let activePillarTable: ExportSectionTable;
    const maxExportRows = 120;

    if (activePillar === 'oaugfAndCrossLedger') {
      const targetPresidents = selectedPresProfile ? [selectedPresProfile] : data.presidents;
      activePillarTable = {
        heading: 'OAuGF Constitutional Audit & 6-Ledger Accountability Record by Presidency (1999–2026)',
        caption: 'Cross-referenced across OAuGF Constitutional Audit Reports (1999–2024), Bill-vs-Act Diffs (2017–2025), Open Treasury Vouchers (2018–2026), DMO Debt Bulletins, and Evidence Engine v3.0.',
        columns: [
          'Administration',
          'OAuGF Reports',
          'Audit Queries (₦ Queried)',
          'Repeat / Recovery Orders',
          'Bill→Act Insertions',
          'Open Treasury Disbursed',
          'DMO End Debt Stock',
          'Evidence Engine v3 Hits',
        ],
        rows: targetPresidents.map((p) => {
          const cl = p.crossLedgerProfile;
          const oa = cl?.oaugf;
          const lp = cl?.legislativePadding;
          const ot = cl?.openTreasury;
          const md = cl?.macroAndDebt;
          const ee = cl?.evidenceEngineV3;
          return [
            `${p.presidentName} (${p.party})`,
            oa ? `${oa.reportsCount} reports` : '0',
            oa ? `${oa.issuesCount.toLocaleString()} (${fmtNaira(oa.totalQueriedNaira)})` : '0',
            oa ? `${oa.repeatNeglectCount} repeat · ${oa.recoveryDirectiveCount} recovery` : '0',
            lp && lp.cyclesCount > 0 ? `${lp.insertionsCount.toLocaleString()} (${fmtNaira(lp.insertionsTotalNaira)})` : 'Pre-2017 Era',
            ot && ot.totalDisbursedNaira > 0
              ? `${fmtNaira(ot.totalDisbursedNaira)}${ot.avgDecemberRushRatio ? ` (${ot.avgDecemberRushRatio}x Dec)` : ''}`
              : 'Pre-2018 Portal',
            md?.dmoEndDebtNairaM
              ? `₦${(md.dmoEndDebtNairaM / 1e6).toFixed(2)}T ($${((md.dmoEndDebtUsdM || 0) / 1e3).toFixed(1)}B)`
              : 'N/A',
            ee ? `${ee.totalRuleFindingsCount.toLocaleString()} (${ee.crossLedgerFindingsCount.toLocaleString()} cross-ledger)` : 'N/A',
          ];
        }),
        rightAlignColumns: [1, 2, 3, 4, 5, 6, 7],
      };
    } else if (activePillar === 'overhead') {
      activePillarTable = {
        heading: 'Discretionary Overhead Comparison Across All 5 Presidencies (COA 2202xxxx)',
        caption: `Currency view: ${currencyView === 'usd' ? 'Historical US$ (Year CBN FX)' : 'As-Enacted Naira'}`,
        columns: ['COA Code', 'Overhead Category', 'Obasanjo', "Yar'Adua", 'Jonathan', 'Buhari', 'Tinubu', '1999–2026 Total'],
        rows: pillars.overheadSurge.codes.map((c) => {
          const val = (pid: string) => {
            const cell = c.byPresident?.[pid];
            return cell ? fmtPrimary(cell.nominal, cell.usd) : currencyView === 'usd' ? '$0' : '₦0';
          };
          return [
            c.economicCode,
            `${c.label} (Top MDA: ${c.topMdas[0]?.agency || 'N/A'})`,
            val('obasanjo'),
            val('yaradua'),
            val('jonathan'),
            val('buhari'),
            val('tinubu'),
            fmtPrimary(c.totalAllYears, c.totalUsd),
          ];
        }),
        rightAlignColumns: [2, 3, 4, 5, 6, 7],
      };
    } else if (activePillar === 'disguised') {
      const clusters = (
        dupScope === 'crossYear'
          ? pillars.disguisedDuplicates.crossYearClusters
          : pillars.disguisedDuplicates.withinYearClusters
      ).filter((cl) => {
        if (dupScope === 'withinYear') {
          if (!matchesPresidentAndYear(cl.presidentId, cl.financialYear)) return false;
        } else {
          if (selectedPresident !== 'ALL' && !cl.presidentsSpanned?.includes(selectedPresident)) return false;
          if (yearFilter !== 'ALL' && !cl.yearsAppeared?.includes(yearFilter)) return false;
        }
        if (!qLower) return true;
        return cl.items.some(
          (it) =>
            it.projectName.toLowerCase().includes(qLower) ||
            it.agency.toLowerCase().includes(qLower) ||
            it.projectCode.toLowerCase().includes(qLower)
        );
      });
      const sliced = clusters.slice(0, maxExportRows);
      activePillarTable = {
        heading: `${dupScope === 'crossYear' ? 'Cross-Year & Cross-Presidency' : 'Within-Year'} Disguised Clusters (${sliced.length} of ${clusters.length})`,
        columns: ['Years / FY', 'Sample Project Title', 'Codes', 'MDAs', 'Items', 'Cluster Total', 'PHCs Eqv'],
        rows: sliced.map((cl) => [
          cl.yearsAppeared ? cl.yearsAppeared.join(', ') : `FY ${cl.financialYear || ''}`,
          cl.items[0]?.projectName || cl.signature,
          cl.distinctCodes,
          cl.distinctAgencies,
          cl.count,
          fmtPrimary(cl.totalAmount, cl.totalUsd),
          cl.equivalents.primaryHealthCentres.toLocaleString(),
        ]),
        rightAlignColumns: [2, 3, 4, 5, 6],
      };
    } else if (activePillar === 'roundSplits') {
      const clusters = pillars.roundNumberSplits.clusters
        .filter((c) => matchesPresidentAndYear(c.presidentId, c.financialYear))
        .filter((c) => !qLower || c.agency.toLowerCase().includes(qLower) || c.sampleItems.some((s) => s.projectName.toLowerCase().includes(qLower)));
      const sliced = clusters.slice(0, maxExportRows);
      activePillarTable = {
        heading: `${pillars.roundNumberSplits.title} (${sliced.length} of ${clusters.length} Clusters)`,
        columns: ['FY', 'President', 'Executing MDA', 'Lines', 'Unit Amount', 'Cluster Total', 'Sample Line Code'],
        rows: sliced.map((cl) => [
          `FY ${cl.financialYear}`,
          cl.presidentName,
          cl.agency,
          cl.itemCount,
          fmtPrimary(cl.unitAmount, cl.unitAmountUsd),
          fmtPrimary(cl.totalAmount, cl.totalUsd),
          cl.sampleItems[0]?.projectCode || 'ERGP',
        ]),
        rightAlignColumns: [3, 4, 5],
      };
    } else {
      const pillarMap: Record<
        string,
        { title: string; items: ScrutinyItem[]; showUnit?: boolean }
      > = {
        vehicles: { title: pillars.unitCostVehicles.title, items: pillars.unitCostVehicles.items, showUnit: true },
        mandates: { title: pillars.mdaMandateMismatches.title, items: pillars.mdaMandateMismatches.items },
        blankChecks: { title: pillars.vagueBlankChecks.title, items: pillars.vagueBlankChecks.items },
        ceremonial: { title: pillars.ceremonialAndSectarian.title, items: pillars.ceremonialAndSectarian.items },
        intangible: { title: pillars.intangibleSoftSpend.title, items: pillars.intangibleSoftSpend.items },
      };
      const cfg = pillarMap[activePillar] || pillarMap.vehicles;
      const filtered = cfg.items.filter(filterItem);
      const sliced = filtered.slice(0, maxExportRows);
      activePillarTable = {
        heading: `${cfg.title} (${sliced.length} of ${filtered.length} Matched Lines)`,
        caption: filtered.length > maxExportRows ? `Showing top ${maxExportRows} ranked items matching active filters.` : undefined,
        columns: cfg.showUnit
          ? ['FY', 'President', 'Code', 'MDA', 'Line Item Description', 'Allocation', 'Implied / Unit', 'PHCs Eqv', 'Page']
          : ['FY', 'President', 'Code', 'MDA', 'Line Item Description', 'Allocation', 'Secondary Value', 'PHCs Eqv', 'Page'],
        rows: sliced.map((it) =>
          cfg.showUnit
            ? [
                `${it.financialYear}`,
                it.presidentName.split(' ').slice(-1)[0],
                it.projectCode || 'ERGP',
                it.agency,
                it.projectName,
                fmtPrimary(it.amount, it.amountUsd),
                it.impliedUnitCostNaira
                  ? `${currencyView === 'usd' ? fmtUsd(it.impliedUnitCostNaira / (it.fxRate || 1)) : fmtNaira(it.impliedUnitCostNaira)} (${it.unitCount})`
                  : 'N/A',
                it.equivalents.primaryHealthCentres.toLocaleString(),
                `p.${it.page}`,
              ]
            : [
                `${it.financialYear}`,
                it.presidentName.split(' ').slice(-1)[0],
                it.projectCode || 'ERGP',
                it.agency,
                it.projectName,
                fmtPrimary(it.amount, it.amountUsd),
                fmtSecondary(it.amount, it.amountUsd),
                it.equivalents.primaryHealthCentres.toLocaleString(),
                `p.${it.page}`,
              ]
        ),
        rightAlignColumns: [5, 6, 7, 8],
      };
    }

    return {
      filenameSlug: `BudgetLens_Scrutiny_${selectedPresident}_${activePillar}_${yearFilter === 'ALL' ? '1999_2026' : `FY${yearFilter}`}`,
      scopeLabel,
      selectedPresident,
      yearFilter,
      currencyView,
      activePillarLabel: activeTabMeta.label,
      searchQuery: query,
      methodology: data.methodology,
      permalink,
      metadata: [
        { label: 'Scope', value: scopeLabel },
        { label: 'Fiscal Year Filter', value: yearFilter === 'ALL' ? 'All Years (1999–2026)' : `FY ${yearFilter}` },
        { label: 'Active Pillar', value: `${activeTabMeta.label} (${activeTabMeta.badge})` },
        { label: 'Currency Mode', value: currencyView === 'usd' ? 'Historical US$ (CBN FX)' : 'As-Enacted Naira (₦)' },
      ],
      kpis: [
        {
          label: 'Combined Scrutiny Pool',
          value: fmtPrimary(scopedKpis.combinedNominal, scopedKpis.combinedUsd),
          subtext: `${scopedKpis.budgetSharePct.toFixed(2)}% of scheduled budgets`,
        },
        {
          label: 'Flagged Capital Lines',
          value: scopedKpis.flaggedCapitalLines.toLocaleString(),
          subtext: `${scopedKpis.leafCapital.toLocaleString()} leaf capital scanned`,
        },
        {
          label: 'Discretionary Overhead',
          value: fmtPrimary(scopedKpis.overheadNominal, scopedKpis.overheadUsd),
          subtext: `${scopedKpis.leafOverhead.toLocaleString()} 2202xxxx records`,
        },
        {
          label: 'Era Health Equivalent',
          value: `${scopedKpis.phcsEqv.toLocaleString()} PHCs`,
          subtext: `${scopedKpis.disguisedCount.toLocaleString()} disguised clusters`,
        },
      ],
      baselineNotes,
      comparisonTable,
      activePillarTable,
      sourceFilename: prov.filename,
      sha256: prov.sha256,
    };
  };

  const handleExportScrutinyBrief = async (format: 'pdf' | 'docx') => {
    if (exportingFormat) return;
    setExportingFormat(format);
    try {
      const briefInput = await buildScopedScrutinyBriefInput();
      const savedName =
        format === 'pdf'
          ? await exportPresidentialScrutinyPdf(briefInput)
          : await exportPresidentialScrutinyDocx(briefInput);
      setExportNotice(`Downloaded ${savedName}`);
      window.setTimeout(() => setExportNotice(null), 2800);
    } catch (err) {
      console.error(`Scrutiny ${format.toUpperCase()} export failed:`, err);
      setExportNotice('Export failed — please retry');
      window.setTimeout(() => setExportNotice(null), 2800);
    } finally {
      setExportingFormat(null);
    }
  };

  const renderItemTable = (
    items: ScrutinyItem[],
    subtitle: string,
    totalCount: number,
    totalNom: number,
    totalUsd: number,
    showUnitCol = false
  ) => {
    const visible = items.filter(filterItem);
    const phcsTotal = Math.round(totalUsd / 16_500);
    const classTotal = Math.round(totalUsd / 10_000);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.75rem',
            paddingBottom: '0.85rem',
            borderBottom: '1px solid var(--card-border)',
          }}
        >
          <div>
            <div style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-dark)' }}>{subtitle}</div>
            <div className="font-mono tabular-nums" style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
              {totalCount.toLocaleString()} lines flagged ·{' '}
              <strong>{fmtPrimary(totalNom, totalUsd)}</strong> ({fmtSecondary(totalNom, totalUsd)}) · Era Eqv:{' '}
              {phcsTotal.toLocaleString()} PHCs or {classTotal.toLocaleString()} classroom blocks
            </div>
          </div>
          <span className="font-mono tabular-nums" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Showing top {visible.length} matching records
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.79rem' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--card-subtle)', borderBottom: '1px solid var(--card-border)', color: 'var(--text-muted)', textAlign: 'left' }}>
                <th style={{ padding: '0.6rem 0.65rem' }}>FY &amp; FX</th>
                <th style={{ padding: '0.6rem 0.65rem' }}>Administration</th>
                <th style={{ padding: '0.6rem 0.65rem' }}>Code</th>
                <th style={{ padding: '0.6rem 0.65rem' }}>MDA / Executing Agency</th>
                <th style={{ padding: '0.6rem 0.65rem' }}>Verbatim Budget Line Item</th>
                <th style={{ padding: '0.6rem 0.65rem', textAlign: 'right' }}>
                  {currencyView === 'usd' ? 'Historical US$ / Nom ₦' : 'Nominal ₦ / US$'}
                </th>
                {showUnitCol && <th style={{ padding: '0.6rem 0.65rem', textAlign: 'right' }}>Implied / Unit</th>}
                <th style={{ padding: '0.6rem 0.65rem', textAlign: 'right' }}>Era PHCs Eqv</th>
                <th style={{ padding: '0.6rem 0.65rem', textAlign: 'center' }}>PDF</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((it, idx) => {
                const pColor = PRES_COLOR_MAP[it.presidentId] || '#059669';
                return (
                  <tr
                    key={`${it.financialYear}-${it.id || idx}`}
                    onClick={() => openModal(it)}
                    style={{
                      borderBottom: '1px solid var(--card-border)',
                      cursor: onSelectProject ? 'pointer' : 'default',
                    }}
                  >
                    <td className="font-mono tabular-nums" style={{ padding: '0.6rem 0.65rem', whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: 700, color: 'var(--text-dark)' }}>{it.financialYear}</div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-light)' }}>₦{it.fxRate}/$</div>
                    </td>
                    <td style={{ padding: '0.6rem 0.65rem', whiteSpace: 'nowrap' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.32rem',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          color: '#0f172a',
                          backgroundColor: '#f8fafc',
                          border: '1px solid rgba(15, 23, 42, 0.1)',
                          padding: '0.12rem 0.42rem',
                          borderRadius: '4px',
                        }}
                      >
                        <span style={{ width: '6px', height: '6px', borderRadius: '999px', backgroundColor: pColor }} />
                        {it.presidentName.split(' ').slice(-1)[0]}
                      </span>
                    </td>
                    <td className="font-mono" style={{ padding: '0.6rem 0.65rem', color: 'var(--emerald-primary)', fontWeight: 600 }}>
                      {it.projectCode}
                    </td>
                    <td style={{ padding: '0.6rem 0.65rem', color: 'var(--text-muted)', maxWidth: '195px' }}>
                      {it.agency}
                    </td>
                    <td style={{ padding: '0.6rem 0.65rem', color: 'var(--text-dark)', fontWeight: 500 }}>
                      <div><ExpandableText text={it.projectName} maxChars={150} /></div>
                      {(() => {
                        const lc = lookupScrutinyBadge(lifecycleIndex, it);
                        if (!lc) return null;
                        return (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.28rem', marginTop: '0.25rem' }}>
                            {lc.paidOnPaperPriority && (
                              <span
                                className="font-mono"
                                style={{
                                  fontSize: '0.62rem',
                                  fontWeight: 700,
                                  padding: '0.08rem 0.36rem',
                                  borderRadius: '4px',
                                  backgroundColor: lc.paidOnPaperTier === 'DIRECT_PROJECT_PAID' ? '#fef2f2' : '#fffbeb',
                                  color: lc.paidOnPaperTier === 'DIRECT_PROJECT_PAID' ? '#b91c1c' : '#b45309',
                                  border:
                                    lc.paidOnPaperTier === 'DIRECT_PROJECT_PAID'
                                      ? '1px solid #fecaca'
                                      : '1px solid #fde68a',
                                }}
                              >
                                Paid on Paper — Field Verify
                              </span>
                            )}
                            {lc.awardedNaira > 0 && (
                              <span
                                className="font-mono"
                                style={{
                                  fontSize: '0.62rem',
                                  fontWeight: 600,
                                  padding: '0.08rem 0.36rem',
                                  borderRadius: '4px',
                                  backgroundColor: '#ecfdf5',
                                  color: '#047857',
                                  border: '1px solid #a7f3d0',
                                }}
                              >
                                Contracted {fmtNaira(lc.awardedNaira)}
                                {lc.contractorName ? ` · ${lc.contractorName.slice(0, 24)}` : ''}
                              </span>
                            )}
                            {lc.birStatus === 'MATCHED_MDA' && lc.birReleasePct !== null && (
                              <span
                                className="font-mono"
                                style={{
                                  fontSize: '0.62rem',
                                  fontWeight: 600,
                                  padding: '0.08rem 0.36rem',
                                  borderRadius: '4px',
                                  backgroundColor: '#eff6ff',
                                  color: '#1d4ed8',
                                  border: '1px solid #bfdbfe',
                                }}
                              >
                                BIR Release {lc.birReleasePct.toFixed(0)}%
                              </span>
                            )}
                            {lc.billDiffStatus && !['NO_BILL_DIFF_CYCLE', 'NOT_IN_ALTERED_DIFF'].includes(lc.billDiffStatus) && (
                              <span
                                className="font-mono"
                                style={{
                                  fontSize: '0.62rem',
                                  fontWeight: 600,
                                  padding: '0.08rem 0.36rem',
                                  borderRadius: '4px',
                                  backgroundColor: '#fffbeb',
                                  color: '#b45309',
                                  border: '1px solid #fde68a',
                                }}
                              >
                                Bill&rarr;Act {lc.billDiffStatus.replace(/_/g, ' ')}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                      {it.insertedCategory && (
                        <span style={{ fontSize: '0.68rem', color: '#b45309', fontWeight: 600 }}>
                          Category: {it.insertedCategory}
                        </span>
                      )}
                      {it.ambiguityReason && (
                        <span style={{ fontSize: '0.68rem', color: '#b45309', fontWeight: 600 }}>
                          Signal: {it.ambiguityReason}
                        </span>
                      )}
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.6rem 0.65rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: 700, color: 'var(--text-dark)' }}>
                        {fmtPrimary(it.amount, it.amountUsd)}
                      </div>
                      <div style={{ fontSize: '0.66rem', color: 'var(--text-light)' }}>
                        {fmtSecondary(it.amount, it.amountUsd)}
                      </div>
                    </td>
                    {showUnitCol && (
                      <td className="font-mono tabular-nums" style={{ padding: '0.6rem 0.65rem', textAlign: 'right', fontWeight: 600, color: it.impliedUnitCostNaira ? '#b91c1c' : 'var(--text-muted)' }}>
                        {it.impliedUnitCostNaira
                          ? `${currencyView === 'usd' ? fmtUsd(it.impliedUnitCostNaira / (it.fxRate || 1)) : fmtNaira(it.impliedUnitCostNaira)} (${it.unitCount})`
                          : '—'}
                      </td>
                    )}
                    <td className="font-mono tabular-nums" style={{ padding: '0.6rem 0.65rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                      {it.equivalents.primaryHealthCentres.toLocaleString()}
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.6rem 0.65rem', textAlign: 'center', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      p.{it.page} <ExternalLink size={10} style={{ verticalAlign: 'middle' }} />
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={showUnitCol ? 9 : 8} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No records match the active Presidential / Year / keyword filter in this pillar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* 1. Editorial Masthead & Currency Comparison Switch */}
      <section className="dossier-card" style={{ padding: '1.35rem 1.6rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
          <div style={{ flex: '1 1 520px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
              <Scale size={14} style={{ color: 'var(--emerald-primary)' }} />
              <span className="font-mono" style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--emerald-primary)' }}>
                FY 1999–2026 Fourth Republic · Year-Native Economic &amp; Presidential Audit
              </span>
            </div>
            <h1 className="font-editorial" style={{ margin: 0, fontSize: '1.55rem', fontWeight: 600, color: 'var(--text-dark)' }}>
              28-Year Public Scrutiny Sweep Matched to Each Administration&apos;s Realities
            </h1>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', lineHeight: 1.55, color: 'var(--text-muted)' }}>
              Audits <strong>{hygiene.totalRecordsScanned.toLocaleString()}</strong> extracted records ({hygiene.leafCapitalCount.toLocaleString()} leaf capital lines +{' '}
              {hygiene.leafOverheadCount.toLocaleString()} discretionary overhead lines; {hygiene.excludedRollupRows.toLocaleString()} rollups excluded).{' '}
              {data.methodology}
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: '0.55rem' }}>
            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {exportNotice && (
                <span
                  className="font-mono"
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    color: '#047857',
                    backgroundColor: 'var(--emerald-bg)',
                    border: '1px solid #a7f3d0',
                    padding: '0.3rem 0.55rem',
                    borderRadius: '6px',
                  }}
                >
                  {exportNotice}
                </span>
              )}
              <button
                type="button"
                onClick={() => handleExportScrutinyBrief('pdf')}
                disabled={exportingFormat !== null}
                className="editorial-btn-primary"
                title="Download scoped Presidential Scrutiny Brief as A4 PDF"
              >
                <FileText size={13} />
                {exportingFormat === 'pdf' ? 'Building PDF...' : 'Export Scrutiny Brief (PDF)'}
              </button>
              <button
                type="button"
                onClick={() => handleExportScrutinyBrief('docx')}
                disabled={exportingFormat !== null}
                className="editorial-btn"
                title="Download scoped Presidential Scrutiny Brief as Word (.docx)"
              >
                <Download size={13} color="#059669" />
                {exportingFormat === 'docx' ? 'Building DOCX...' : 'Export Scrutiny Brief (DOCX)'}
              </button>
            </div>

            <div
              style={{
                display: 'inline-flex',
                border: '1px solid rgba(15, 23, 42, 0.14)',
                borderRadius: '7px',
                overflow: 'hidden',
                backgroundColor: '#f8fafc',
              }}
            >
              {(
                [
                  { id: 'usd', label: 'Historical US$ (Year CBN FX)' },
                  { id: 'nominal', label: 'As-Enacted ₦ (Nominal)' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setCurrencyView(m.id)}
                  className="font-mono"
                  style={{
                    border: 'none',
                    padding: '0.42rem 0.72rem',
                    fontSize: '0.71rem',
                    fontWeight: 700,
                    backgroundColor: currencyView === m.id ? '#091017' : 'transparent',
                    color: currencyView === m.id ? '#ffffff' : 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div style={{ padding: '0.5rem 0.75rem', borderRadius: '7px', backgroundColor: 'var(--card-subtle)', border: '1px solid var(--card-border)', fontSize: '0.71rem', color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--text-dark)' }}>Domain Guards:</strong> Military/Police fleet excluded · Hospital &amp; prison feeding excluded · Tied multilateral loans excluded
            </div>
          </div>
        </div>
      </section>

      {/* 2. Presidential Administration Selector Strip */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(195px, 1fr))',
            gap: '0.75rem',
          }}
        >
          {/* All Fourth Republic Card */}
          <button
            type="button"
            onClick={() => handleSelectPresident('ALL')}
            style={{
              textAlign: 'left',
              padding: '0.85rem 0.95rem',
              borderRadius: '10px',
              backgroundColor: selectedPresident === 'ALL' ? '#091017' : '#ffffff',
              color: selectedPresident === 'ALL' ? '#ffffff' : 'var(--text-dark)',
              border: selectedPresident === 'ALL' ? '1.5px solid #10b981' : '1px solid var(--card-border)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '0.4rem',
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="font-mono" style={{ fontSize: '0.67rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: selectedPresident === 'ALL' ? '#34d399' : '#059669' }}>
                All Administrations
              </span>
              <span className="font-mono" style={{ fontSize: '0.67rem', opacity: 0.8 }}>1999–2026</span>
            </div>
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>Fourth Republic Total</div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.12rem', fontWeight: 700, marginTop: '0.18rem' }}>
                {fmtPrimary(headlineMetrics.combinedScrutinyExposure, headlineMetrics.combinedScrutinyUsd)}
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '0.68rem', opacity: 0.78 }}>
                {fmtSecondary(headlineMetrics.combinedScrutinyExposure, headlineMetrics.combinedScrutinyUsd)} · {headlineMetrics.combinedScheduledBudgetSharePct.toFixed(2)}% of scheduled
              </div>
            </div>
            <div className="font-mono" style={{ fontSize: '0.68rem', opacity: 0.82 }}>
              {headlineMetrics.uniqueFlaggedCapitalLines.toLocaleString()} capital flags ·{' '}
              {(crossTotals?.oaugfParsedIssuesCount ?? 7028).toLocaleString()} OAuGF queries
            </div>
          </button>

          {/* Individual President Cards */}
          {data.presidents.map((p) => {
            const active = selectedPresident === p.presidentId;
            const avatar = PRES_AVATAR_MAP[p.presidentId];
            const accent = PRES_COLOR_MAP[p.presidentId] || p.accentColor;
            const oaIssues = p.crossLedgerProfile?.oaugf.issuesCount ?? 0;
            const oaRepeat = p.crossLedgerProfile?.oaugf.repeatNeglectCount ?? 0;
            const lpCycles = p.crossLedgerProfile?.legislativePadding.cyclesCount ?? 0;
            const lpInsNaira = p.crossLedgerProfile?.legislativePadding.insertionsTotalNaira ?? 0;
            return (
              <button
                key={p.presidentId}
                type="button"
                onClick={() => handleSelectPresident(p.presidentId)}
                style={{
                  textAlign: 'left',
                  padding: '0.85rem 0.95rem',
                  borderRadius: '10px',
                  backgroundColor: active ? '#091017' : '#ffffff',
                  color: active ? '#ffffff' : 'var(--text-dark)',
                  border: active ? `2px solid ${accent}` : '1px solid var(--card-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '0.4rem',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                  <PresidentAvatar
                    src={avatar?.portraitPath || ''}
                    name={p.presidentName}
                    initials={avatar?.initials || p.shortName.slice(0, 2).toUpperCase()}
                    accentColor={accent}
                    size={36}
                    party={p.party}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.84rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.shortName}
                    </div>
                    <div className="font-mono" style={{ fontSize: '0.66rem', opacity: 0.8 }}>
                      {p.party} · {p.budgetYears[0]}–{p.budgetYears[p.budgetYears.length - 1]}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="font-mono tabular-nums" style={{ fontSize: '1.08rem', fontWeight: 700 }}>
                    {fmtPrimary(p.combinedNominal, p.combinedUsd)}
                  </div>
                  <div className="font-mono tabular-nums" style={{ fontSize: '0.67rem', opacity: 0.78 }}>
                    {fmtSecondary(p.combinedNominal, p.combinedUsd)} · {p.combinedBudgetSharePct.toFixed(2)}% budget
                  </div>
                </div>

                <div className="font-mono" style={{ fontSize: '0.64rem', opacity: 0.86, display: 'flex', flexDirection: 'column', gap: '0.12rem' }}>
                  <span>FX {p.fxRangeLabel} · MW {p.minWageRangeLabel}</span>
                  <span style={{ color: active ? '#fcd34d' : '#b45309', fontWeight: 600 }}>
                    OAuGF: {oaIssues.toLocaleString()} queries{oaRepeat > 0 ? ` (${oaRepeat} repeat)` : ''}
                    {lpCycles > 0 ? ` · Pad: +${fmtNaira(lpInsNaira)}` : ''}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Fourth Republic Total (₦23.98T / $36.29B) Verification & 6-Ledger Architecture Banner */}
        <div
          className="dossier-card"
          style={{
            padding: '0.9rem 1.15rem',
            backgroundColor: '#f8fafc',
            border: '1px solid rgba(15, 23, 42, 0.12)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.65rem',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Layers size={15} color="#059669" />
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0f172a' }}>
                Verified Decomposition of the Fourth Republic Enacted Budget Scrutiny Total ({fmtNaira(headlineMetrics.combinedScrutinyExposure)} / {fmtUsd(headlineMetrics.combinedScrutinyUsd)} · up from ₦23.98T / $36.29B after plural mandate-mismatch &amp; 1999/2007 schedule recovery)
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActivePillar('oaugfAndCrossLedger')}
              className="font-mono"
              style={{
                padding: '0.28rem 0.62rem',
                borderRadius: '6px',
                border: '1px solid #059669',
                backgroundColor: activePillar === 'oaugfAndCrossLedger' ? '#059669' : '#ecfdf5',
                color: activePillar === 'oaugfAndCrossLedger' ? '#ffffff' : '#065f46',
                fontSize: '0.69rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Inspect OAuGF &amp; 6-Ledger Presidential Record &rarr;
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(235px, 1fr))',
              gap: '0.6rem',
            }}
          >
            <div style={{ padding: '0.6rem 0.75rem', borderRadius: '7px', backgroundColor: '#ffffff', border: '1px solid var(--card-border)' }}>
              <div className="font-mono" style={{ fontSize: '0.64rem', fontWeight: 700, color: '#047857', textTransform: 'uppercase' }}>
                Component A · Enacted Capital Flags (Deduplicated)
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '0.96rem', fontWeight: 700, color: 'var(--text-dark)', marginTop: '0.15rem' }}>
                {fmtNaira(headlineMetrics.uniqueFlaggedCapitalExposure)} ({fmtUsd(headlineMetrics.uniqueFlaggedCapitalUsd)})
              </div>
              <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                <strong>{headlineMetrics.uniqueFlaggedCapitalLines.toLocaleString()}</strong> unique leaf capital lines across Pillars 1, 2, 3, 7 &amp; 8 ({hygiene.excludedRollupRows.toLocaleString()} MDA/COA summary rollups excluded).
              </div>
            </div>

            <div style={{ padding: '0.6rem 0.75rem', borderRadius: '7px', backgroundColor: '#ffffff', border: '1px solid var(--card-border)' }}>
              <div className="font-mono" style={{ fontSize: '0.64rem', fontWeight: 700, color: '#b45309', textTransform: 'uppercase' }}>
                Component B · Discretionary Overhead (COA 2202xxxx)
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '0.96rem', fontWeight: 700, color: 'var(--text-dark)', marginTop: '0.15rem' }}>
                {fmtNaira(headlineMetrics.discretionaryOverheadExposure)} ({fmtUsd(headlineMetrics.discretionaryOverheadUsd)})
              </div>
              <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                <strong>{hygiene.leafOverheadCount.toLocaleString()}</strong> leaf lines across 7 travel, refreshment, welfare, honoraria &amp; publicity codes (hospital/prison feeding excluded).
              </div>
            </div>

            <div style={{ padding: '0.6rem 0.75rem', borderRadius: '7px', backgroundColor: '#fffbeb', border: '1px solid #fde68a' }}>
              <div className="font-mono" style={{ fontSize: '0.64rem', fontWeight: 700, color: '#b45309', textTransform: 'uppercase' }}>
                Separate Ledger · OAuGF Constitutional Audits (1999–2024)
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '0.96rem', fontWeight: 700, color: '#92400e', marginTop: '0.15rem' }}>
                {(crossTotals?.oaugfParsedIssuesCount ?? 7028).toLocaleString()} Audit Queries · {(crossTotals?.oaugfRecoveryDirectiveCount ?? 675).toLocaleString()} Recovery Orders
              </div>
              <div style={{ fontSize: '0.69rem', color: '#78350f', marginTop: '0.1rem' }}>
                <strong>{crossTotals?.oaugfRepeatNeglectCount ?? 54}</strong> repeat/ignored audit directives across <strong>{crossTotals?.oaugfReportsIndexed ?? 36}</strong> Auditor-General reports (tracked separately to prevent double-adding).
              </div>
            </div>

            <div style={{ padding: '0.6rem 0.75rem', borderRadius: '7px', backgroundColor: '#fef2f2', border: '1px solid #fecaca' }}>
              <div className="font-mono" style={{ fontSize: '0.64rem', fontWeight: 700, color: '#b91c1c', textTransform: 'uppercase' }}>
                Separate Ledgers · Treasury Cash, Bill Padding &amp; Contracts
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '0.96rem', fontWeight: 700, color: '#991b1b', marginTop: '0.15rem' }}>
                ₦1.49T Personal Accts · ₦2.44T Opaque Cash
              </div>
              <div style={{ fontSize: '0.69rem', color: '#7f1d1d', marginTop: '0.1rem' }}>
                Plus <strong>{(crossTotals?.billActInsertionsCount ?? 115658).toLocaleString()}</strong> Bill&rarr;Act insertions ({crossTotals?.billActCyclesCount ?? 7} cycles) &amp; <strong>₦1.31T</strong> non-competitive procurement awards.
              </div>
            </div>
          </div>
        </div>

        {/* Year / Administration Economic Reality Strip */}
        {(selectedPresProfile || selectedYearRow) && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4rem',
              padding: '0.7rem 0.95rem',
              borderRadius: '8px',
              backgroundColor: '#faf9f6',
              border: '1px solid rgba(15, 23, 42, 0.1)',
              fontSize: '0.76rem',
              color: 'var(--text-muted)',
            }}
          >
            {selectedPresProfile && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
                <Info size={14} color={PRES_COLOR_MAP[selectedPresProfile.presidentId] || '#059669'} style={{ flexShrink: 0 }} />
                <span>
                  <strong style={{ color: 'var(--text-dark)' }}>{selectedPresProfile.presidentName} Reality Baseline:</strong>{' '}
                  CBN FX <strong>{selectedPresProfile.fxRangeLabel}</strong> · Statutory Minimum Wage{' '}
                  <strong>{selectedPresProfile.minWageRangeLabel}</strong> · Total Enacted Budgets{' '}
                  <strong>{fmtNaira(selectedPresProfile.enactedBudgetSumNominal)}</strong> ({fmtUsd(selectedPresProfile.enactedBudgetSumUsd)})
                  {(() => {
                    const ac = adminCredById[selectedPresProfile.presidentId];
                    if (!ac) return null;
                    if (ac.birCoverageStatus === 'PRE_BIR_ERA_NO_SOURCE') {
                      return <> · BIR Macro Execution: <strong>N/A (Pre-2009 BIR Era)</strong></>;
                    }
                    return (
                      <>
                        {' '}· BIR Mean Capital Exec: <strong>{ac.avgCapitalPerformancePct !== null ? `${ac.avgCapitalPerformancePct.toFixed(1)}%` : 'N/A'}</strong> ·
                        Debt Service Exec: <strong style={{ color: (ac.avgDebtServicePerformancePct || 0) > 100 ? '#b91c1c' : undefined }}>
                          {ac.avgDebtServicePerformancePct !== null ? `${ac.avgDebtServicePerformancePct.toFixed(1)}%` : 'N/A'} ({ac.debtServiceOverrunYears} overrun yrs)
                        </strong>
                      </>
                    );
                  })()} —{' '}
                  {selectedPresProfile.handoverNote}
                </span>
              </div>
            )}

            {selectedYearRow && (
              <div
                className="font-mono"
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.9rem',
                  paddingTop: selectedPresProfile ? '0.4rem' : 0,
                  borderTop: selectedPresProfile ? '1px solid rgba(15, 23, 42, 0.08)' : 'none',
                  fontSize: '0.71rem',
                  color: '#0f172a',
                }}
              >
                <span><strong>FY{selectedYearRow.financialYear} Cutoffs:</strong></span>
                <span>Enacted Budget: <strong>{fmtNaira(selectedYearRow.officialBudgetNaira)}</strong></span>
                <span>CBN FX: <strong>₦{selectedYearRow.fxNairaPerUsd}/$</strong></span>
                <span>Min Wage: <strong>₦{selectedYearRow.minWageMonthly.toLocaleString()}/mo</strong></span>
                <span>Fleet Floor ($65k): <strong>{fmtNaira(selectedYearRow.thresholdsApplied.vehiclesNaira)}</strong></span>
                <span>Blank-Check (0.001%): <strong>{fmtNaira(selectedYearRow.thresholdsApplied.blankCheckNaira)}</strong></span>
                <span>Intangible (0.0004%): <strong>{fmtNaira(selectedYearRow.thresholdsApplied.intangibleNaira)}</strong></span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 3. Scoped 4-Metric KPI Strip */}
      <div className="grid-4-cols">
        <div className="dossier-card" style={{ padding: '1rem 1.15rem' }}>
          <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
            Records Audited ({selectedPresProfile ? selectedPresProfile.shortName : '1999–2026'})
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-dark)', marginTop: '0.2rem' }}>
            {scopedKpis.recordsScanned.toLocaleString()}
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '0.71rem', color: 'var(--text-muted)' }}>
            {scopedKpis.leafCapital.toLocaleString()} leaf capital · {scopedKpis.leafOverhead.toLocaleString()} overhead
          </div>
        </div>

        <div className="dossier-card" style={{ padding: '1rem 1.15rem' }}>
          <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
            Combined Scrutiny ({currencyView === 'usd' ? 'Historical US$' : 'Nominal ₦'})
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.35rem', fontWeight: 700, color: '#b45309', marginTop: '0.2rem' }}>
            {fmtPrimary(scopedKpis.combinedNominal, scopedKpis.combinedUsd)}
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '0.71rem', color: 'var(--text-muted)' }}>
            {fmtSecondary(scopedKpis.combinedNominal, scopedKpis.combinedUsd)} · {scopedKpis.budgetSharePct.toFixed(2)}% of scheduled budget · ≈ {scopedKpis.phcsEqv.toLocaleString()} PHCs
          </div>
        </div>

        <div className="dossier-card" style={{ padding: '1rem 1.15rem' }}>
          <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
            Disguised &amp; Split Clusters
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.35rem', fontWeight: 700, color: '#7e22ce', marginTop: '0.2rem' }}>
            {scopedKpis.disguisedCount.toLocaleString()}
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '0.71rem', color: 'var(--text-muted)' }}>
            +{scopedKpis.roundSplitCount} cookie-cutter split clusters
          </div>
        </div>

        <div className="dossier-card" style={{ padding: '1rem 1.15rem' }}>
          <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
            Discretionary Overhead (7 Codes)
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.35rem', fontWeight: 700, color: '#b91c1c', marginTop: '0.2rem' }}>
            {fmtPrimary(scopedKpis.overheadNominal, scopedKpis.overheadUsd)}
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '0.71rem', color: 'var(--text-muted)' }}>
            {fmtSecondary(scopedKpis.overheadNominal, scopedKpis.overheadUsd)} · {scopedKpis.flaggedCapitalLines.toLocaleString()} capital flags
          </div>
        </div>
      </div>

      {/* 4. 28-Year Timeline Chart + 5-President Comparative Scorecard */}
      <section className="dossier-card" style={{ padding: '1.2rem 1.4rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.65rem' }}>
          <div>
            <h2 className="font-editorial" style={{ margin: 0, fontSize: '1.12rem', fontWeight: 600, color: 'var(--text-dark)' }}>
              Annual Flagged Scrutiny Exposure by Presidency (1999–2026)
            </h2>
            <p style={{ margin: '0.15rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {chartMetric === 'budgetShare'
                ? 'Measured as % of that specific year’s Enacted Federal Budget. Click any bar to isolate that fiscal year.'
                : chartMetric === 'usd'
                ? 'Converted at each year’s official CBN Exchange Rate ($B). Click any bar to inspect that year’s cutoffs.'
                : 'Unadjusted As-Enacted Nominal Naira (₦B). Click any bar to inspect that year’s cutoffs.'}
            </p>
          </div>

          <div style={{ display: 'inline-flex', border: '1px solid var(--card-border)', borderRadius: '6px', overflow: 'hidden', backgroundColor: '#f8fafc' }}>
            {(
              [
                { id: 'usd', label: 'US$ (Year FX)' },
                { id: 'budgetShare', label: '% of Year Budget' },
                { id: 'nominal', label: 'Nominal ₦' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setChartMetric(opt.id)}
                className="font-mono"
                style={{
                  border: 'none',
                  padding: '0.34rem 0.6rem',
                  fontSize: '0.69rem',
                  fontWeight: 700,
                  backgroundColor: chartMetric === opt.id ? '#091017' : 'transparent',
                  color: chartMetric === opt.id ? '#ffffff' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ height: '240px', width: '100%' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={timelineChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 10, fill: '#475569' }} />
              <YAxis
                tick={{ fontSize: 10, fill: '#475569' }}
                unit={chartMetric === 'budgetShare' ? '%' : 'B'}
              />
              <Tooltip
                formatter={(value: any, _name: any, props: any) => {
                  const unitStr =
                    chartMetric === 'budgetShare'
                      ? `${Number(value).toFixed(2)}% of budget`
                      : chartMetric === 'usd'
                      ? `$${Number(value).toFixed(2)}B`
                      : `₦${Number(value).toLocaleString()}B`;
                  return [
                    `${unitStr} (${props.payload.flaggedLines.toLocaleString()} flags @ ₦${props.payload.fxRate}/$)`,
                    props.payload.presidentName,
                  ];
                }}
                labelFormatter={(label) => `FY ${label}`}
              />
              <Bar
                dataKey="value"
                radius={[3, 3, 0, 0]}
                style={{ cursor: 'pointer' }}
                onClick={(entry: any) => {
                  if (entry?.financialYear) {
                    setSelectedPresident(entry.presidentId);
                    setYearFilter(entry.financialYear);
                  }
                }}
              >
                {timelineChartData.map((entry) => {
                  const dim =
                    (selectedPresident !== 'ALL' && entry.presidentId !== selectedPresident) ||
                    (yearFilter !== 'ALL' && entry.financialYear !== yearFilter);
                  return (
                    <Cell
                      key={entry.year}
                      fill={entry.color}
                      fillOpacity={dim ? 0.22 : 0.92}
                    />
                  );
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 5-President Comparative Scorecard Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--card-subtle)', borderBottom: '1px solid var(--card-border)', color: 'var(--text-muted)', textAlign: 'left' }}>
                <th style={{ padding: '0.52rem 0.6rem' }}>Presidential Administration</th>
                <th style={{ padding: '0.52rem 0.6rem' }}>Budget Years</th>
                <th style={{ padding: '0.52rem 0.6rem' }}>CBN FX &amp; Min Wage</th>
                <th style={{ padding: '0.52rem 0.6rem', textAlign: 'right' }}>Scheduled Yrs</th>
                <th style={{ padding: '0.52rem 0.6rem', textAlign: 'right' }}>Capital Flags</th>
                <th style={{ padding: '0.52rem 0.6rem', textAlign: 'right' }}>Flagged Capital</th>
                <th style={{ padding: '0.52rem 0.6rem', textAlign: 'right' }}>Overhead</th>
                <th style={{ padding: '0.52rem 0.6rem', textAlign: 'right' }}>Combined ({currencyView === 'usd' ? 'US$' : '₦'})</th>
                <th style={{ padding: '0.52rem 0.6rem', textAlign: 'right' }}>% Scheduled</th>
                <th style={{ padding: '0.52rem 0.6rem', textAlign: 'right' }}>OAuGF Audit Queries</th>
                <th style={{ padding: '0.52rem 0.6rem', textAlign: 'right' }}>Bill&rarr;Act Padding</th>
                <th style={{ padding: '0.52rem 0.6rem', textAlign: 'right' }}>BIR Capital %</th>
                <th style={{ padding: '0.52rem 0.6rem', textAlign: 'right' }}>BIR Debt Svc %</th>
              </tr>
            </thead>
            <tbody>
              {data.presidents.map((p) => {
                const isSel = selectedPresident === p.presidentId;
                const scheduledYrs = p.fullScheduleYearsCount + p.partialScheduleYearsCount;
                const ac = adminCredById[p.presidentId];
                const isPreBir = !ac || ac.birCoverageStatus === 'PRE_BIR_ERA_NO_SOURCE';
                const oa = p.crossLedgerProfile?.oaugf;
                const lp = p.crossLedgerProfile?.legislativePadding;
                return (
                  <tr
                    key={p.presidentId}
                    onClick={() => handleSelectPresident(isSel ? 'ALL' : p.presidentId)}
                    style={{
                      borderBottom: '1px solid var(--card-border)',
                      cursor: 'pointer',
                      backgroundColor: isSel ? '#ecfdf5' : undefined,
                    }}
                  >
                    <td style={{ padding: '0.55rem 0.6rem', fontWeight: 700, color: 'var(--text-dark)' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '999px', backgroundColor: PRES_COLOR_MAP[p.presidentId] }} />
                        {p.presidentName}
                        <span className="font-mono" style={{ fontSize: '0.67rem', color: 'var(--text-muted)', fontWeight: 600 }}>({p.party})</span>
                      </span>
                    </td>
                    <td className="font-mono" style={{ padding: '0.55rem 0.6rem', color: 'var(--text-muted)' }}>
                      {p.budgetYears[0]}–{p.budgetYears[p.budgetYears.length - 1]}
                    </td>
                    <td className="font-mono" style={{ padding: '0.55rem 0.6rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {p.fxRangeLabel} · {p.minWageRangeLabel}
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.6rem', textAlign: 'right' }}>
                      {scheduledYrs}/{p.budgetYears.length}
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.6rem', textAlign: 'right', fontWeight: 600 }}>
                      {p.uniqueFlaggedCapitalLines.toLocaleString()}
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.6rem', textAlign: 'right' }}>
                      {fmtPrimary(p.flaggedCapitalNominal, p.flaggedCapitalUsd)}
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.6rem', textAlign: 'right' }}>
                      {fmtPrimary(p.overheadNominal, p.overheadUsd)}
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.6rem', textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>
                      {fmtPrimary(p.combinedNominal, p.combinedUsd)}
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.6rem', textAlign: 'right', color: '#047857', fontWeight: 700 }}>
                      {p.combinedBudgetSharePct.toFixed(2)}%
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.6rem', textAlign: 'right', fontSize: '0.71rem', color: '#b45309', fontWeight: 700 }}>
                      {oa ? `${oa.issuesCount.toLocaleString()} (${oa.recoveryDirectiveCount} recov)` : '—'}
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.6rem', textAlign: 'right', fontSize: '0.71rem', color: lp && lp.cyclesCount > 0 ? '#7e22ce' : '#94a3b8', fontWeight: lp && lp.cyclesCount > 0 ? 700 : 500 }}>
                      {lp && lp.cyclesCount > 0 ? `+${fmtNaira(lp.insertionsTotalNaira)} (${lp.cyclesCount}y)` : 'Pre-2017'}
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.6rem', textAlign: 'right', fontSize: '0.72rem', color: isPreBir ? '#94a3b8' : '#047857', fontWeight: isPreBir ? 500 : 700 }}>
                      {isPreBir
                        ? 'N/A (Pre-2009)'
                        : ac.avgCapitalPerformancePct !== null
                        ? `${ac.avgCapitalPerformancePct.toFixed(1)}%`
                        : 'N/A'}
                    </td>
                    <td
                      className="font-mono tabular-nums"
                      style={{
                        padding: '0.55rem 0.6rem',
                        textAlign: 'right',
                        fontSize: '0.72rem',
                        color: isPreBir ? '#94a3b8' : (ac.avgDebtServicePerformancePct || 0) > 100 ? '#b91c1c' : '#0f172a',
                        fontWeight: isPreBir ? 500 : 700,
                      }}
                    >
                      {isPreBir
                        ? 'N/A (Pre-2009)'
                        : ac.avgDebtServicePerformancePct !== null
                        ? `${ac.avgDebtServicePerformancePct.toFixed(1)}% (${ac.debtServiceOverrunYears}y >100%)`
                        : 'N/A'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 5. Filters + 8 Pillar Navigation */}
      <div className="dossier-card" style={{ padding: '0.9rem 1.15rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => setYearFilter('ALL')}
              className="font-mono tabular-nums"
              style={{
                padding: '0.32rem 0.65rem',
                borderRadius: '6px',
                border: '1px solid var(--card-border)',
                backgroundColor: yearFilter === 'ALL' ? '#091017' : '#ffffff',
                color: yearFilter === 'ALL' ? '#ffffff' : 'var(--text-muted)',
                fontSize: '0.73rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {selectedPresProfile ? `All ${selectedPresProfile.shortName} Yrs` : 'All 1999–2026'}
            </button>
            {selectableYears.map((yr) => (
              <button
                key={yr}
                type="button"
                onClick={() => setYearFilter(yr)}
                className="font-mono tabular-nums"
                style={{
                  padding: '0.3rem 0.55rem',
                  borderRadius: '6px',
                  border: '1px solid var(--card-border)',
                  backgroundColor: yearFilter === yr ? '#091017' : '#ffffff',
                  color: yearFilter === yr ? '#ffffff' : 'var(--text-muted)',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {yr}
              </button>
            ))}
          </div>

          <div style={{ position: 'relative', flex: '1 1 230px', maxWidth: '330px' }}>
            <Search size={14} style={{ position: 'absolute', left: '0.7rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search titles, ERGP/GIFMIS codes, MDAs..."
              style={{
                width: '100%',
                padding: '0.42rem 0.7rem 0.42rem 2.05rem',
                borderRadius: '6px',
                border: '1px solid var(--card-border)',
                backgroundColor: 'var(--card-subtle)',
                fontSize: '0.8rem',
                color: 'var(--text-dark)',
              }}
            />
          </div>

          <button
            type="button"
            onClick={() => setPaidOnPaperOnly((prev) => !prev)}
            className="font-mono"
            style={{
              padding: '0.38rem 0.72rem',
              borderRadius: '6px',
              border: paidOnPaperOnly ? '1px solid #b91c1c' : '1px solid var(--card-border)',
              backgroundColor: paidOnPaperOnly ? '#fef2f2' : '#ffffff',
              color: paidOnPaperOnly ? '#b91c1c' : 'var(--text-muted)',
              fontSize: '0.72rem',
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Paid on Paper — Field Verify Only
            {lifecycleIndex?.summary?.scrutinyPaidOnPaperCount !== undefined
              ? ` (${lifecycleIndex.summary.scrutinyPaidOnPaperCount})`
              : ''}
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', paddingTop: '0.6rem', borderTop: '1px solid var(--card-border)' }}>
          {tabs.map((t) => {
            const active = activePillar === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActivePillar(t.id)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.42rem 0.72rem',
                  borderRadius: '6px',
                  border: active ? '1px solid var(--emerald-primary)' : '1px solid var(--card-border)',
                  backgroundColor: active ? '#ecfdf5' : '#ffffff',
                  color: active ? '#065f46' : 'var(--text-muted)',
                  fontSize: '0.75rem',
                  fontWeight: active ? 700 : 500,
                  cursor: 'pointer',
                }}
              >
                {t.icon}
                <span>{t.label}</span>
                <span className="font-mono tabular-nums" style={{ fontSize: '0.67rem', padding: '0.05rem 0.35rem', borderRadius: '4px', backgroundColor: active ? '#059669' : 'var(--card-subtle)', color: active ? '#ffffff' : 'var(--text-muted)' }}>
                  {t.badge}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 6. Active Pillar Content */}
      <div className="dossier-card" style={{ padding: '1.25rem 1.4rem' }}>
        {activePillar === 'oaugfAndCrossLedger' && (() => {
          const targetPresidents = selectedPresProfile ? [selectedPresProfile] : data.presidents;
          const allTopFindings = targetPresidents
            .flatMap((p) =>
              (p.crossLedgerProfile?.oaugf.topFindings || []).map((f) => ({
                ...f,
                presidentId: p.presidentId,
                presidentName: p.presidentName,
                shortName: p.shortName,
                party: p.party,
              }))
            )
            .filter((f) => (yearFilter === 'ALL' ? true : f.year === yearFilter))
            .filter(
              (f) =>
                !qLower ||
                f.mdaName.toLowerCase().includes(qLower) ||
                (f.heading || '').toLowerCase().includes(qLower) ||
                f.category.toLowerCase().includes(qLower) ||
                f.excerpt.toLowerCase().includes(qLower)
            )
            .sort((a, b) => (b.repeatNeglect === a.repeatNeglect ? b.amountUsd - a.amountUsd : b.repeatNeglect ? 1 : -1));

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.35rem' }}>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '0.75rem',
                  paddingBottom: '0.85rem',
                  borderBottom: '1px solid var(--card-border)',
                }}
              >
                <div>
                  <h3 className="font-editorial" style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-dark)' }}>
                    OAuGF Constitutional Audit Negligence &amp; 6-Ledger Accountability Record by Presidency (1999–2026)
                  </h3>
                  <p style={{ margin: '0.2rem 0 0', fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    Cross-references each Administration&apos;s Enacted Budget Scrutiny baseline ({fmtNaira(headlineMetrics.combinedScrutinyExposure)} / {fmtUsd(headlineMetrics.combinedScrutinyUsd)}) against{' '}
                    <strong>{(crossTotals?.oaugfParsedIssuesCount ?? 7028).toLocaleString()}</strong> OAuGF Constitutional Audit queries (1999–2024),{' '}
                    <strong>{(crossTotals?.billActInsertionsCount ?? 115658).toLocaleString()}</strong> Legislative Bill-vs-Act insertions (2017–2025),{' '}
                    <strong>{(crossTotals?.openTreasuryVouchersCount ?? 467763).toLocaleString()}</strong> Open Treasury cash vouchers (2018–2026), DMO sovereign debt bulletins, and{' '}
                    <strong>{(crossTotals?.evidenceEngineV3TotalFindings ?? 49679).toLocaleString()}</strong> Evidence Engine v3.0 rule hits.
                  </p>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
                  <a
                    href="?tab=oaugf"
                    className="font-mono"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      padding: '0.38rem 0.68rem',
                      borderRadius: '6px',
                      backgroundColor: '#fffbeb',
                      color: '#b45309',
                      border: '1px solid #fde68a',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      textDecoration: 'none',
                    }}
                  >
                    Open OAuGF Audit Explorer <ExternalLink size={11} />
                  </a>
                  <a
                    href="?tab=padding"
                    className="font-mono"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      padding: '0.38rem 0.68rem',
                      borderRadius: '6px',
                      backgroundColor: '#f5f3ff',
                      color: '#6d28d9',
                      border: '1px solid #ddd6fe',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      textDecoration: 'none',
                    }}
                  >
                    Open Bill-vs-Act Padding <ExternalLink size={11} />
                  </a>
                  <a
                    href="?tab=forensics"
                    className="font-mono"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      padding: '0.38rem 0.68rem',
                      borderRadius: '6px',
                      backgroundColor: '#fef2f2',
                      color: '#b91c1c',
                      border: '1px solid #fecaca',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      textDecoration: 'none',
                    }}
                  >
                    Open Treasury Cash Forensics <ExternalLink size={11} />
                  </a>
                </div>
              </div>

              {/* 5-President 6-Ledger Accountability Matrix */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.77rem' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--card-subtle)', borderBottom: '1px solid var(--card-border)', color: 'var(--text-muted)', textAlign: 'left' }}>
                      <th style={{ padding: '0.55rem 0.65rem' }}>Presidential Administration</th>
                      <th style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>Enacted Scrutiny ({currencyView === 'usd' ? 'US$' : '₦'})</th>
                      <th style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>OAuGF Audit Queries</th>
                      <th style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>Repeat / Recovery Orders</th>
                      <th style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>Legislative Bill&rarr;Act Insertions</th>
                      <th style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>Open Treasury Cash &amp; Dec Rush</th>
                      <th style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>DMO Sovereign Debt (Start &rarr; End)</th>
                      <th style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>Evidence Engine v3.0 (22 Rules)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {targetPresidents.map((p) => {
                      const cl = p.crossLedgerProfile;
                      const oa = cl?.oaugf;
                      const lp = cl?.legislativePadding;
                      const ot = cl?.openTreasury;
                      const md = cl?.macroAndDebt;
                      const ee = cl?.evidenceEngineV3;
                      return (
                        <tr key={p.presidentId} style={{ borderBottom: '1px solid var(--card-border)' }}>
                          <td style={{ padding: '0.6rem 0.65rem', fontWeight: 700, color: 'var(--text-dark)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                              <span style={{ width: '8px', height: '8px', borderRadius: '999px', backgroundColor: PRES_COLOR_MAP[p.presidentId] }} />
                              <span>{p.presidentName}</span>
                              <span className="font-mono" style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>({p.party})</span>
                            </div>
                            <div className="font-mono" style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '0.12rem' }}>
                              FY {p.budgetYears[0]}–{p.budgetYears[p.budgetYears.length - 1]} · FX {p.fxRangeLabel}
                            </div>
                          </td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.6rem 0.65rem', textAlign: 'right' }}>
                            <div style={{ fontWeight: 700, color: '#0f172a' }}>{fmtPrimary(p.combinedNominal, p.combinedUsd)}</div>
                            <div style={{ fontSize: '0.66rem', color: '#047857', fontWeight: 600 }}>
                              {p.combinedBudgetSharePct.toFixed(2)}% of scheduled ({p.uniqueFlaggedCapitalLines.toLocaleString()} flags)
                            </div>
                          </td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.6rem 0.65rem', textAlign: 'right' }}>
                            <div style={{ fontWeight: 700, color: '#b45309' }}>
                              {oa ? `${oa.issuesCount.toLocaleString()} findings` : '0'}
                            </div>
                            <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                              {oa ? `${oa.reportsCount} reports · ${fmtPrimary(oa.totalQueriedNaira, oa.totalQueriedUsd)}` : '—'}
                            </div>
                          </td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.6rem 0.65rem', textAlign: 'right' }}>
                            <div style={{ fontWeight: 700, color: (oa?.repeatNeglectCount || 0) > 0 ? '#b91c1c' : 'var(--text-dark)' }}>
                              {oa ? `${oa.repeatNeglectCount} repeat neglected` : '0'}
                            </div>
                            <div style={{ fontSize: '0.66rem', color: '#047857', fontWeight: 600 }}>
                              {oa ? `${oa.recoveryDirectiveCount} recovery directives` : '—'}
                            </div>
                          </td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.6rem 0.65rem', textAlign: 'right' }}>
                            {lp && lp.cyclesCount > 0 ? (
                              <>
                                <div style={{ fontWeight: 700, color: '#6d28d9' }}>
                                  +{fmtNaira(lp.insertionsTotalNaira)} ({lp.insertionsCount.toLocaleString()} ins)
                                </div>
                                <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                                  {lp.cyclesCount} cycles ({lp.cyclesYears.join(', ')}) · +{fmtNaira(lp.inflatedTotalNaira)} inflated
                                </div>
                              </>
                            ) : (
                              <span style={{ color: '#94a3b8', fontSize: '0.7rem' }}>Pre-2017 Bill Diff Era</span>
                            )}
                          </td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.6rem 0.65rem', textAlign: 'right' }}>
                            {ot && ot.totalDisbursedNaira > 0 ? (
                              <>
                                <div style={{ fontWeight: 700, color: '#0f172a' }}>{fmtNaira(ot.totalDisbursedNaira)}</div>
                                <div style={{ fontSize: '0.66rem', color: (ot.avgDecemberRushRatio || 0) >= 2.5 ? '#b91c1c' : 'var(--text-muted)', fontWeight: 600 }}>
                                  Dec: {fmtNaira(ot.decemberNaira)} ({ot.avgDecemberRushRatio ? `${ot.avgDecemberRushRatio}x rush` : 'N/A'})
                                </div>
                              </>
                            ) : (
                              <span style={{ color: '#94a3b8', fontSize: '0.7rem' }}>Pre-2018 Treasury Portal</span>
                            )}
                          </td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.6rem 0.65rem', textAlign: 'right' }}>
                            {md?.dmoStartDebtNairaM && md?.dmoEndDebtNairaM ? (
                              <>
                                <div style={{ fontWeight: 700, color: 'var(--text-dark)' }}>
                                  ₦{(md.dmoStartDebtNairaM / 1e6).toFixed(2)}T &rarr; ₦{(md.dmoEndDebtNairaM / 1e6).toFixed(2)}T
                                </div>
                                <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                                  End US$: ${((md.dmoEndDebtUsdM || 0) / 1e3).toFixed(1)}B
                                  {md.debtServiceOverrunYears > 0 ? ` · ${md.debtServiceOverrunYears}y debt overrun` : ''}
                                </div>
                              </>
                            ) : (
                              <span style={{ color: '#94a3b8', fontSize: '0.7rem' }}>N/A</span>
                            )}
                          </td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.6rem 0.65rem', textAlign: 'right' }}>
                            <div style={{ fontWeight: 700, color: '#047857' }}>
                              {(ee?.totalRuleFindingsCount ?? 0).toLocaleString()} rule hits
                            </div>
                            <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                              {(ee?.crossLedgerFindingsCount ?? 0).toLocaleString()} cross-ledger · {(ee?.flaggedProjectsCount ?? 0).toLocaleString()} projects
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Per-Administration OAuGF Category Breakdown & Top Constitutional Audit Queries */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-dark)' }}>
                    High-Severity OAuGF Constitutional Audit Queries &amp; Recovery Directives ({selectedPresProfile ? selectedPresProfile.presidentName : 'All 5 Administrations · 1999–2024'})
                  </h4>
                  <span className="font-mono" style={{ fontSize: '0.71rem', color: 'var(--text-muted)' }}>
                    Showing {allTopFindings.length} highest-priority queries (Repeat Neglect &amp; Recovery Orders prioritized)
                  </span>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.77rem' }}>
                    <thead>
                      <tr style={{ backgroundColor: 'var(--card-subtle)', borderBottom: '1px solid var(--card-border)', color: 'var(--text-muted)', textAlign: 'left' }}>
                        <th style={{ padding: '0.55rem 0.65rem' }}>Audit FY</th>
                        <th style={{ padding: '0.55rem 0.65rem' }}>Administration</th>
                        <th style={{ padding: '0.55rem 0.65rem' }}>Queried MDA / Account</th>
                        <th style={{ padding: '0.55rem 0.65rem' }}>Audit Category &amp; Verbatim Finding</th>
                        <th style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>Queried Amount</th>
                        <th style={{ padding: '0.55rem 0.65rem', textAlign: 'center' }}>Report &amp; Page</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allTopFindings.map((f, idx) => (
                        <tr key={`${f.year}-${f.page}-${idx}`} style={{ borderBottom: '1px solid var(--card-border)' }}>
                          <td className="font-mono tabular-nums" style={{ padding: '0.58rem 0.65rem', fontWeight: 700 }}>
                            FY {f.year}
                          </td>
                          <td style={{ padding: '0.58rem 0.65rem', whiteSpace: 'nowrap' }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.32rem',
                                fontSize: '0.71rem',
                                fontWeight: 600,
                                padding: '0.12rem 0.42rem',
                                borderRadius: '4px',
                                backgroundColor: '#f8fafc',
                                border: '1px solid rgba(15, 23, 42, 0.1)',
                              }}
                            >
                              <span style={{ width: '6px', height: '6px', borderRadius: '999px', backgroundColor: PRES_COLOR_MAP[f.presidentId] }} />
                              {f.shortName}
                            </span>
                          </td>
                          <td style={{ padding: '0.58rem 0.65rem', fontWeight: 600, color: 'var(--text-dark)', maxWidth: '210px' }}>
                            {f.mdaName}
                          </td>
                          <td style={{ padding: '0.58rem 0.65rem' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', alignItems: 'center', marginBottom: '0.2rem' }}>
                              <span
                                className="font-mono"
                                style={{
                                  fontSize: '0.63rem',
                                  fontWeight: 700,
                                  padding: '0.06rem 0.36rem',
                                  borderRadius: '4px',
                                  backgroundColor: '#f1f5f9',
                                  color: '#334155',
                                }}
                              >
                                {f.category}
                              </span>
                              {f.repeatNeglect && (
                                <span
                                  className="font-mono"
                                  style={{
                                    fontSize: '0.62rem',
                                    fontWeight: 700,
                                    padding: '0.06rem 0.36rem',
                                    borderRadius: '4px',
                                    backgroundColor: '#fef2f2',
                                    color: '#b91c1c',
                                    border: '1px solid #fecaca',
                                  }}
                                >
                                  REPEAT / IGNORED DIRECTIVE
                                </span>
                              )}
                              {f.recoveryRequired && (
                                <span
                                  className="font-mono"
                                  style={{
                                    fontSize: '0.62rem',
                                    fontWeight: 700,
                                    padding: '0.06rem 0.36rem',
                                    borderRadius: '4px',
                                    backgroundColor: '#ecfdf5',
                                    color: '#047857',
                                    border: '1px solid #a7f3d0',
                                  }}
                                >
                                  TREASURY RECOVERY ORDERED
                                </span>
                              )}
                            </div>
                            <div style={{ fontWeight: 600, color: 'var(--text-dark)', fontSize: '0.77rem' }}>
                              {f.heading}
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.12rem' }}>
                              <ExpandableText text={f.excerpt} maxChars={165} />
                            </div>
                          </td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.58rem 0.65rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 700, color: f.amountNaira > 0 ? '#b45309' : 'var(--text-muted)' }}>
                              {f.amountNaira > 0 ? fmtPrimary(f.amountNaira, f.amountUsd) : 'Non-Monetary / Control'}
                            </div>
                            {f.amountNaira > 0 && (
                              <div style={{ fontSize: '0.66rem', color: 'var(--text-light)' }}>
                                {fmtSecondary(f.amountNaira, f.amountUsd)}
                              </div>
                            )}
                          </td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.58rem 0.65rem', textAlign: 'center', fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            <div>{f.docTitle || `FY ${f.year} Audit`}</div>
                            <div>p.{f.page || 1}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })()}

        {activePillar === 'vehicles' && (() => {
          const s = getPillarTotalsForScope(pillars.unitCostVehicles, 'vehicles');
          return renderItemTable(pillars.unitCostVehicles.items, pillars.unitCostVehicles.title, s.count, s.totalAmount, s.totalUsd, true);
        })()}

        {activePillar === 'mandates' && (() => {
          const s = getPillarTotalsForScope(pillars.mdaMandateMismatches, 'mandates');
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.6rem' }}>
                {pillars.mdaMandateMismatches.topMdas.slice(0, 8).map((m) => (
                  <div key={m.agency} style={{ padding: '0.65rem 0.8rem', borderRadius: '7px', backgroundColor: 'var(--card-subtle)', border: '1px solid var(--card-border)' }}>
                    <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-dark)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.agency}>
                      {m.agency}
                    </div>
                    <div className="font-mono tabular-nums" style={{ fontSize: '0.78rem', fontWeight: 700, color: '#b45309', marginTop: '0.2rem' }}>
                      {m.count} non-core lines · {fmtPrimary(m.totalAmount, m.totalUsd)}
                    </div>
                  </div>
                ))}
              </div>
              {renderItemTable(pillars.mdaMandateMismatches.items, pillars.mdaMandateMismatches.title, s.count, s.totalAmount, s.totalUsd)}
            </div>
          );
        })()}

        {activePillar === 'blankChecks' && (() => {
          const s = getPillarTotalsForScope(pillars.vagueBlankChecks, 'blankChecks');
          return renderItemTable(pillars.vagueBlankChecks.items, pillars.vagueBlankChecks.title, s.count, s.totalAmount, s.totalUsd);
        })()}

        {activePillar === 'ceremonial' && (() => {
          const s = getPillarTotalsForScope(pillars.ceremonialAndSectarian, 'ceremonial');
          return renderItemTable(pillars.ceremonialAndSectarian.items, pillars.ceremonialAndSectarian.title, s.count, s.totalAmount, s.totalUsd);
        })()}

        {activePillar === 'intangible' && (() => {
          const s = getPillarTotalsForScope(pillars.intangibleSoftSpend, 'intangible');
          return renderItemTable(pillars.intangibleSoftSpend.items, pillars.intangibleSoftSpend.title, s.count, s.totalAmount, s.totalUsd);
        })()}

        {activePillar === 'disguised' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <h3 className="font-editorial" style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>
                  Disguised, Cross-Presidency &amp; Agency-Hopping Duplicate Clusters
                </h3>
                <p style={{ margin: '0.15rem 0 0', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  Detects identical allocations persisted across Administrations, shifted across MDAs, or reworded via synonyms
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button
                  type="button"
                  onClick={() => { setDupScope('crossYear'); setExpandedDupIdx(0); }}
                  style={{
                    padding: '0.35rem 0.7rem',
                    borderRadius: '6px',
                    border: '1px solid var(--card-border)',
                    backgroundColor: dupScope === 'crossYear' ? '#091017' : '#ffffff',
                    color: dupScope === 'crossYear' ? '#ffffff' : 'var(--text-muted)',
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cross-Year &amp; Cross-Presidency ({pillars.disguisedDuplicates.crossYearCount.toLocaleString()})
                </button>
                <button
                  type="button"
                  onClick={() => { setDupScope('withinYear'); setExpandedDupIdx(0); }}
                  style={{
                    padding: '0.35rem 0.7rem',
                    borderRadius: '6px',
                    border: '1px solid var(--card-border)',
                    backgroundColor: dupScope === 'withinYear' ? '#091017' : '#ffffff',
                    color: dupScope === 'withinYear' ? '#ffffff' : 'var(--text-muted)',
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Within-Year Disguised ({pillars.disguisedDuplicates.withinYearCount.toLocaleString()})
                </button>
              </div>
            </div>

            {(dupScope === 'crossYear'
              ? pillars.disguisedDuplicates.crossYearClusters
              : pillars.disguisedDuplicates.withinYearClusters
            )
              .filter((cl) => {
                if (dupScope === 'withinYear') {
                  if (!matchesPresidentAndYear(cl.presidentId, cl.financialYear)) return false;
                } else {
                  if (selectedPresident !== 'ALL' && !cl.presidentsSpanned?.includes(selectedPresident)) return false;
                  if (yearFilter !== 'ALL' && !cl.yearsAppeared?.includes(yearFilter)) return false;
                }
                if (!qLower) return true;
                return cl.items.some(
                  (it) =>
                    it.projectName.toLowerCase().includes(qLower) ||
                    it.agency.toLowerCase().includes(qLower) ||
                    it.projectCode.toLowerCase().includes(qLower)
                );
              })
              .map((cl, idx) => {
                const open = expandedDupIdx === idx;
                return (
                  <div key={`${cl.signature}-${idx}`} style={{ border: '1px solid var(--card-border)', borderRadius: '8px', overflow: 'hidden' }}>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-expanded={open}
                      onClick={() => setExpandedDupIdx(open ? null : idx)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setExpandedDupIdx(open ? null : idx);
                        }
                      }}
                      style={{
                        width: '100%',
                        padding: '0.8rem 1rem',
                        backgroundColor: open ? 'var(--card-subtle)' : '#ffffff',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '1rem',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0, flex: 1 }}>
                        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-dark)' }}>
                              <ExpandableText text={cl.items[0]?.projectName || cl.signature} maxChars={150} />
                            </span>
                            {cl.crossedAdministrations && (
                              <span
                                className="font-mono"
                                style={{
                                  fontSize: '0.64rem',
                                  fontWeight: 700,
                                  textTransform: 'uppercase',
                                  padding: '0.1rem 0.38rem',
                                  borderRadius: '4px',
                                  backgroundColor: '#fef2f2',
                                  color: '#b91c1c',
                                  border: '1px solid #fecaca',
                                }}
                              >
                                Cross-Presidency ({cl.presidentsSpanned?.length} Admins)
                              </span>
                            )}
                          </div>
                          <div className="font-mono tabular-nums" style={{ fontSize: '0.71rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                            {cl.yearsAppeared ? `Years: ${cl.yearsAppeared.join(', ')}` : `FY ${cl.financialYear} (${cl.presidentName})`} · {cl.distinctCodes} codes · {cl.distinctAgencies} MDAs · {cl.count} items
                          </div>
                        </div>
                      </div>
                      <span className="font-mono tabular-nums" style={{ fontSize: '0.88rem', fontWeight: 700, color: '#7e22ce', flexShrink: 0 }}>
                        {fmtPrimary(cl.totalAmount, cl.totalUsd)}
                      </span>
                    </div>

                    {open && (
                      <div style={{ padding: '0.5rem 1rem 0.9rem 2.2rem', backgroundColor: 'var(--card-subtle)', overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem', backgroundColor: '#ffffff', border: '1px solid var(--card-border)' }}>
                          <tbody>
                            {cl.items.map((it, j) => (
                              <tr key={`${it.financialYear}-${it.id}-${j}`} onClick={() => openModal(it)} style={{ borderBottom: '1px solid var(--card-border)', cursor: 'pointer' }}>
                                <td className="font-mono tabular-nums" style={{ padding: '0.45rem 0.65rem', fontWeight: 700 }}>{it.financialYear}</td>
                                <td className="font-mono" style={{ padding: '0.45rem 0.65rem', fontSize: '0.7rem', color: PRES_COLOR_MAP[it.presidentId], fontWeight: 700 }}>
                                  {it.presidentName.split(' ').slice(-1)[0]}
                                </td>
                                <td className="font-mono" style={{ padding: '0.45rem 0.65rem', color: 'var(--emerald-primary)', fontWeight: 600 }}>{it.projectCode}</td>
                                <td style={{ padding: '0.45rem 0.65rem', color: 'var(--text-muted)' }}>{it.agency}</td>
                                <td style={{ padding: '0.45rem 0.65rem', color: 'var(--text-dark)' }}><ExpandableText text={it.projectName} maxChars={150} /></td>
                                <td className="font-mono tabular-nums" style={{ padding: '0.45rem 0.65rem', textAlign: 'right', fontWeight: 700 }}>
                                  {fmtPrimary(it.amount, it.amountUsd)}
                                </td>
                                <td className="font-mono tabular-nums" style={{ padding: '0.45rem 0.65rem', textAlign: 'center', color: 'var(--text-muted)' }}>p.{it.page}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}

        {activePillar === 'roundSplits' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div>
              <h3 className="font-editorial" style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>
                {pillars.roundNumberSplits.title}
              </h3>
              <p className="font-mono tabular-nums" style={{ margin: '0.15rem 0 0', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                {pillars.roundNumberSplits.clusterCount} clusters total ({pillars.roundNumberSplits.itemCount.toLocaleString()} identical-amount lines totaling{' '}
                {fmtPrimary(pillars.roundNumberSplits.totalAmount, pillars.roundNumberSplits.totalUsd)})
              </p>
            </div>
            {pillars.roundNumberSplits.clusters
              .filter((c) => matchesPresidentAndYear(c.presidentId, c.financialYear))
              .filter((c) => !qLower || c.agency.toLowerCase().includes(qLower) || c.sampleItems.some((s) => s.projectName.toLowerCase().includes(qLower)))
              .map((cl, idx) => {
                const open = expandedSplitIdx === idx;
                return (
                  <div key={`${cl.financialYear}-${cl.agency}-${cl.unitAmount}-${idx}`} style={{ border: '1px solid var(--card-border)', borderRadius: '8px', overflow: 'hidden' }}>
                    <button
                      type="button"
                      onClick={() => setExpandedSplitIdx(open ? null : idx)}
                      style={{
                        width: '100%',
                        padding: '0.8rem 1rem',
                        backgroundColor: open ? 'var(--card-subtle)' : '#ffffff',
                        border: 'none',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '1rem',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
                        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        <div>
                          <div style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-dark)' }}>
                            FY {cl.financialYear} ({cl.presidentName}) · {cl.agency}
                          </div>
                          <div className="font-mono tabular-nums" style={{ fontSize: '0.73rem', color: '#b45309', fontWeight: 600 }}>
                            {cl.itemCount} identical lines × {fmtPrimary(cl.unitAmount, cl.unitAmountUsd)} each
                          </div>
                        </div>
                      </div>
                      <span className="font-mono tabular-nums" style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-dark)' }}>
                        {fmtPrimary(cl.totalAmount, cl.totalUsd)}
                      </span>
                    </button>
                    {open && (
                      <div style={{ padding: '0.5rem 1rem 0.85rem 2.2rem', backgroundColor: 'var(--card-subtle)' }}>
                        {cl.sampleItems.map((it, j) => (
                          <div
                            key={j}
                            onClick={() => openModal(it)}
                            style={{ padding: '0.4rem 0', borderBottom: '1px solid var(--card-border)', display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.76rem', cursor: 'pointer' }}
                          >
                            <span>
                              <strong className="font-mono" style={{ color: 'var(--emerald-primary)', marginRight: '0.45rem' }}>{it.projectCode}</strong>
                              <ExpandableText text={it.projectName} maxChars={150} />
                            </span>
                            <span className="font-mono tabular-nums" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                              {fmtPrimary(it.amount, it.amountUsd)} · p.{it.page}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}

        {activePillar === 'overhead' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <h3 className="font-editorial" style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>
                Discretionary Overhead Comparison Across All 5 Presidencies (2202xxxx, 1999–2026)
              </h3>
              <p className="font-mono tabular-nums" style={{ margin: '0.15rem 0 0', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                1999–2026 Combined: {fmtPrimary(pillars.overheadSurge.totalAllYears, pillars.overheadSurge.totalAllYearsUsd)} ({fmtSecondary(pillars.overheadSurge.totalAllYears, pillars.overheadSurge.totalAllYearsUsd)})
              </p>
            </div>

            <div style={{ height: '280px', width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={overheadChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#475569' }} unit={currencyView === 'usd' ? 'M' : 'B'} />
                  <Tooltip
                    formatter={(val: any) =>
                      currencyView === 'usd'
                        ? `$${Number(val).toLocaleString()}M`
                        : `₦${Number(val).toLocaleString()}B`
                    }
                  />
                  <Legend />
                  <Bar dataKey="obasanjo" name="Obasanjo" fill={PRES_COLOR_MAP.obasanjo} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="yaradua" name="Yar'Adua" fill={PRES_COLOR_MAP.yaradua} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="jonathan" name="Jonathan" fill={PRES_COLOR_MAP.jonathan} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="buhari" name="Buhari" fill={PRES_COLOR_MAP.buhari} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="tinubu" name="Tinubu" fill={PRES_COLOR_MAP.tinubu} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.77rem' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--card-subtle)', borderBottom: '1px solid var(--card-border)', color: 'var(--text-muted)', textAlign: 'left' }}>
                    <th style={{ padding: '0.55rem 0.65rem' }}>COA Code</th>
                    <th style={{ padding: '0.55rem 0.65rem' }}>Discretionary Overhead Line</th>
                    <th style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>Obasanjo</th>
                    <th style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>Yar&apos;Adua</th>
                    <th style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>Jonathan</th>
                    <th style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>Buhari</th>
                    <th style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>Tinubu</th>
                    <th style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>1999–2026 Total</th>
                  </tr>
                </thead>
                <tbody>
                  {pillars.overheadSurge.codes.map((c) => {
                    const cellVal = (pid: string) => {
                      const row = c.byPresident?.[pid];
                      return row ? fmtPrimary(row.nominal, row.usd) : (currencyView === 'usd' ? '$0' : '₦0');
                    };
                    return (
                      <tr key={c.economicCode} style={{ borderBottom: '1px solid var(--card-border)' }}>
                        <td className="font-mono" style={{ padding: '0.55rem 0.65rem', fontWeight: 700, color: 'var(--emerald-primary)' }}>{c.economicCode}</td>
                        <td style={{ padding: '0.55rem 0.65rem', fontWeight: 600, color: 'var(--text-dark)' }}>
                          <div>{c.label}</div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                            Top MDA: {c.topMdas[0]?.agency} ({fmtUsd(c.topMdas[0]?.totalUsd || 0)})
                          </div>
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>{cellVal('obasanjo')}</td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>{cellVal('yaradua')}</td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>{cellVal('jonathan')}</td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>{cellVal('buhari')}</td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.65rem', textAlign: 'right', fontWeight: 700 }}>{cellVal('tinubu')}</td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.65rem', textAlign: 'right', fontWeight: 700 }}>
                          {fmtPrimary(c.totalAllYears, c.totalUsd)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Footer Note */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.73rem', color: 'var(--text-muted)', padding: '0 0.25rem' }}>
        <AlertTriangle size={13} />
        <span>
          Source Basis: {data.scope} · Click any row to inspect verbatim PDF provenance and year-native civic equivalents.
        </span>
      </div>
    </div>
  );
};
