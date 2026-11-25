import React, { useState, useMemo, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
  ReferenceLine,
} from 'recharts';
import {
  Calendar,
  Scale,
  ArrowRightLeft,
  Layers,
  ShieldCheck,
  Info,
  ExternalLink,
  Check,
  RotateCcw,
  FileWarning,
  ShieldAlert,
  Wallet,
} from 'lucide-react';
import { useBudgetDatabase } from '../context/BudgetDatabaseContext';
import {
  PRESIDENTIAL_TERMS,
  PRESIDENTS_AGGREGATE,
  PresidentialTerm,
  getPresidentForYear,
} from '../data/presidentialTerms';
import { getMacroForYear } from '../data/historicalMacroData';
import { PresidentAvatar } from './PresidentAvatar';
import { InfoHint } from './InfoHint';
import {
  computeAdministrationDebtProjection,
  computeConstitutionalHandoverDebtLedger,
  type DmoYearRow,
} from '../utils/administrationDebt';
import {
  loadMacroCredibilityTracker,
  type MacroCredibilityTrackerPayload,
} from '../utils/mdaScorecard';
import {
  formatPresidentialBillPadding,
  formatPresidentialOpenTreasury,
  type PresidentCrossLedgerSummary,
} from '../utils/multiLedgerTrends';

type CompareSubView = 'terms' | 'headToHead' | 'years' | 'credibility';
type CurrencyMode = 'nominal' | 'real2026' | 'usd';
type DataBasis = 'official' | 'extracted';

const DEFAULT_COMPARISON_YEARS = [1999, 2007, 2011, 2015, 2023, 2026];

interface HistoricalPresidentialCompareProps {
  onSelectYear?: (year: number) => void;
  onSelectProject?: (project: any) => void;
  onNavigateTab?: (tab: string) => void;
}

export const HistoricalPresidentialCompare: React.FC<HistoricalPresidentialCompareProps> = ({
  onSelectYear,
  onNavigateTab,
}) => {
  const { summary, availableYears, registryDocs, loadYearRecords, getRecordsForYear, setActiveYear, lastSyncedAt } =
    useBudgetDatabase();

  const [subView, setSubView] = useState<CompareSubView>('terms');
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>('nominal');
  const [dataBasis, setDataBasis] = useState<DataBasis>('official');
  const [scopeMode, setScopeMode] = useState<'terms' | 'presidents'>('terms');
  const [debtMetricUnit, setDebtMetricUnit] = useState<'usd' | 'naira'>('usd');
  const [debtBasisMode, setDebtBasisMode] = useState<'handover' | 'raw'>('handover');

  // Head-to-head selectors
  const [leftId, setLeftId] = useState<string>('OBJ-2');
  const [rightId, setRightId] = useState<string>('BAT-1');

  // Multi-year custom comparator selection (default opening year of all 5 Fourth Republic presidents + FY 2026)
  const [selectedYears, setSelectedYears] = useState<number[]>(DEFAULT_COMPARISON_YEARS);
  const [macroNarrativesMap, setMacroNarrativesMap] = useState<
    Record<number, { budgetTheme?: string; benchmarkOilPriceUSD?: number | null; exchangeRateNairaPerUSD?: number | null }>
  >({});
  const [debtByYearMap, setDebtByYearMap] = useState<
    Record<number, DmoYearRow>
  >({});
  const [debtRows, setDebtRows] = useState<DmoYearRow[]>([]);
  const [debtDocsCount, setDebtDocsCount] = useState<number>(0);
  const [macroCredibility, setMacroCredibility] = useState<MacroCredibilityTrackerPayload | null>(null);
  const [crossLedgerByPresident, setCrossLedgerByPresident] = useState<
    Record<string, PresidentCrossLedgerSummary>
  >({});

  const loadDebtProfile = React.useCallback(() => {
    return fetch('/datasets/debt_profile.json', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { totalDocumentsIndexed?: number; yearlyDebt?: DmoYearRow[] } | null) => {
        if (!data?.yearlyDebt) return;
        const dMap: Record<number, DmoYearRow> = {};
        for (const row of data.yearlyDebt) {
          dMap[row.financialYear] = row;
        }
        setDebtByYearMap(dMap);
        setDebtRows(data.yearlyDebt);
        setDebtDocsCount(data.totalDocumentsIndexed || 0);
      })
      .catch(() => {});
  }, []);

  const adminDebtProjection = useMemo(
    () => computeAdministrationDebtProjection(debtRows, debtDocsCount),
    [debtRows, debtDocsCount]
  );

  const handoverDebtLedger = useMemo(
    () => computeConstitutionalHandoverDebtLedger(debtRows, debtDocsCount),
    [debtRows, debtDocsCount]
  );

  const displayedDebtRows = useMemo(() => {
    if (debtBasisMode === 'handover') {
      return handoverDebtLedger.records.map((r) => ({
        presidentId: r.presidentId,
        presidentName: r.presidentName,
        portraitPath: r.portraitPath,
        initials: r.initials,
        accentColor: r.accentColor,
        party: r.party,
        windowLabel: r.handoverWindow,
        startTotalUsdM: r.startTotalUsdM,
        endTotalUsdM: r.endTotalUsdM,
        netAddedUsdM: r.netAddedUsdM,
        netAddedExternalUsdM: r.netAddedExternalUsdM,
        pctChangeUsd: r.pctChangeUsd,
        startTotalNairaM: r.startTotalNairaM,
        endTotalNairaM: r.endTotalNairaM,
        netAddedNairaM: r.netAddedNairaM,
        netAddedDomesticNairaM: r.netAddedDomesticNairaM,
        pctChangeNaira: r.pctChangeNaira,
        note: r.methodologyNote,
      }));
    }
    return adminDebtProjection.administrations.map((r) => ({
      presidentId: r.presidentId,
      presidentName: r.presidentName,
      portraitPath: `/presidents/${r.presidentId}.jpg`,
      initials: r.presidentName.slice(0, 2).toUpperCase(),
      accentColor: r.accentColor,
      party: r.party,
      windowLabel: `${r.baselineYear} → ${r.endYear}`,
      startTotalUsdM: r.startTotalUsdM,
      endTotalUsdM: r.endTotalUsdM,
      netAddedUsdM: r.netAddedUsdM,
      netAddedExternalUsdM: r.netAddedExternalUsdM,
      pctChangeUsd: r.startTotalUsdM > 0 ? Number(((r.netAddedUsdM / r.startTotalUsdM) * 100).toFixed(1)) : 0,
      startTotalNairaM: r.startTotalNairaM,
      endTotalNairaM: r.endTotalNairaM,
      netAddedNairaM: r.netAddedNairaM,
      netAddedDomesticNairaM: r.netAddedDomesticNairaM,
      pctChangeNaira: r.startTotalNairaM > 0 ? Number(((r.netAddedNairaM / r.startTotalNairaM) * 100).toFixed(1)) : 0,
      note: r.note,
    }));
  }, [debtBasisMode, handoverDebtLedger, adminDebtProjection]);

  useEffect(() => {
    let active = true;
    fetch('/datasets/macro_narratives_summary.json', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { narratives?: Array<{ financialYear: number; budgetTheme?: string; macroeconomicFramework?: { benchmarkOilPriceUSD?: number | null; exchangeRateNairaPerUSD?: number | null } }> } | null) => {
        if (!active || !data?.narratives) return;
        const map: Record<number, { budgetTheme?: string; benchmarkOilPriceUSD?: number | null; exchangeRateNairaPerUSD?: number | null }> = {};
        for (const item of data.narratives) {
          map[item.financialYear] = {
            budgetTheme: item.budgetTheme,
            benchmarkOilPriceUSD: item.macroeconomicFramework?.benchmarkOilPriceUSD,
            exchangeRateNairaPerUSD: item.macroeconomicFramework?.exchangeRateNairaPerUSD,
          };
        }
        setMacroNarrativesMap(map);
      })
      .catch(() => {});

    loadDebtProfile();
    loadMacroCredibilityTracker().then((mc) => {
      if (active && mc) setMacroCredibility(mc);
    });

    fetch('/datasets/forensic_sweep_1999_2026.json', { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { presidents?: Array<{ presidentId: string; crossLedgerProfile?: PresidentCrossLedgerSummary }> } | null) => {
        if (!active || !Array.isArray(data?.presidents)) return;
        const map: Record<string, PresidentCrossLedgerSummary> = {};
        for (const p of data.presidents) {
          if (p.presidentId && p.crossLedgerProfile) {
            map[p.presidentId] = p.crossLedgerProfile;
          }
        }
        setCrossLedgerByPresident(map);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [lastSyncedAt, loadDebtProfile]);

  // Preload records for selected custom comparison years so project counts / top items are live
  useEffect(() => {
    if (subView === 'years') {
      selectedYears.forEach((yr) => {
        loadYearRecords(yr).catch(() => {});
      });
    }
  }, [subView, selectedYears, loadYearRecords]);

  const docsByYear = useMemo(
    () => new Map(registryDocs.map((d) => [d.financial_year || d.financialYear, d])),
    [registryDocs]
  );

  const allYears = useMemo(() => {
    const base = new Set<number>([...availableYears]);
    for (let y = 1999; y <= 2026; y++) base.add(y);
    return Array.from(base).sort((a, b) => a - b);
  }, [availableYears]);

  // Compute unified metrics per year (Nominal, Constant 2026 Real, USD)
  const yearMetricsMap = useMemo(() => {
    const map = new Map<
      number,
      {
        year: number;
        president: PresidentialTerm;
        extractedNaira: number;
        officialNaira: number;
        projectCount: number;
        capitalSharePct: number;
        fxRate: number;
        cpiDeflator: number;
        isIngested: boolean;
        enrichmentStatus: string;
      }
    >();

    allYears.forEach((yr) => {
      const macro = getMacroForYear(yr);
      const sumEntry = summary?.yearSummaries?.[String(yr)];
      const docEntry = docsByYear.get(yr);
      const extractedNaira =
        sumEntry?.totalAmountNaira ?? docEntry?.total_budget ?? 0;
      const projectCount =
        sumEntry?.recordCount ?? docEntry?.project_count ?? 0;
      const capPct =
        macro.officialTotalBudget > 0
          ? (macro.totalCapitalBudget / macro.officialTotalBudget) * 100
          : 30;

      map.set(yr, {
        year: yr,
        president: getPresidentForYear(yr),
        extractedNaira,
        officialNaira: macro.officialTotalBudget,
        projectCount,
        capitalSharePct: capPct,
        fxRate: macro.fxNairaPerUsd,
        cpiDeflator: macro.cpiDeflatorTo2026,
        isIngested: Boolean(sumEntry || docEntry),
        enrichmentStatus: docEntry?.enrichment_status || 'BASELINE',
      });
    });
    return map;
  }, [allYears, summary, docsByYear]);

  const getValueForYear = (yr: number): number => {
    const m = yearMetricsMap.get(yr);
    if (!m) return 0;
    const rawNaira =
      dataBasis === 'extracted'
        ? m.extractedNaira > 0
          ? m.extractedNaira
          : 0
        : m.officialNaira;
    if (currencyMode === 'real2026') return rawNaira * m.cpiDeflator;
    if (currencyMode === 'usd') return m.fxRate > 0 ? rawNaira / m.fxRate : 0;
    return rawNaira;
  };

  const formatMetric = (val: number): string => {
    const sym = currencyMode === 'usd' ? '$' : '₦';
    if (val >= 1e12) return `${sym}${(val / 1e12).toFixed(2)}T`;
    if (val >= 1e9) return `${sym}${(val / 1e9).toFixed(2)}B`;
    if (val >= 1e6) return `${sym}${(val / 1e6).toFixed(2)}M`;
    return `${sym}${Math.round(val).toLocaleString()}`;
  };

  const formatMetricLong = (val: number): string => {
    const sym = currencyMode === 'usd' ? '$' : '₦';
    if (val >= 1e12) return `${sym}${(val / 1e12).toFixed(2)} Trillion`;
    if (val >= 1e9) return `${sym}${(val / 1e9).toFixed(2)} Billion`;
    if (val >= 1e6) return `${sym}${(val / 1e6).toFixed(2)} Million`;
    return `${sym}${Math.round(val).toLocaleString()}`;
  };

  // Aggregate metrics per 4-year term OR per full presidency
  const aggregatedTerms = useMemo(() => {
    const sourceList =
      scopeMode === 'terms'
        ? PRESIDENTIAL_TERMS.map((t) => ({
            id: t.termId,
            presidentId: t.presidentId,
            isSingleTermSlice: t.presidentId === 'obasanjo' || t.presidentId === 'buhari',
            title: t.presidentName,
            subtitle: t.termLabel,
            tenureSpan: t.tenureSpan,
            party: t.party,
            partyColor: t.partyColor,
            accentColor: t.accentColor,
            portraitPath: t.portraitPath,
            initials: t.initials,
            years: t.budgetYears,
            agenda: t.economicAgenda,
            note: t.handoverNote,
          }))
        : PRESIDENTS_AGGREGATE.map((p) => ({
            id: p.presidentId,
            presidentId: p.presidentId,
            isSingleTermSlice: false,
            title: p.presidentName,
            subtitle: p.totalYearsInOfficeLabel,
            tenureSpan: p.totalYearsInOfficeLabel,
            party: p.party,
            partyColor: p.partyColor,
            accentColor: p.accentColor,
            portraitPath: p.portraitPath,
            initials: p.initials,
            years: p.budgetYears,
            agenda: p.termIds.join(' + '),
            note: undefined,
          }));

    return sourceList.map((item) => {
      const yrVals = item.years.map((y) => getValueForYear(y));
      const cumulative = yrVals.reduce((s, v) => s + v, 0);
      const avgAnnual = item.years.length > 0 ? cumulative / item.years.length : 0;
      const firstVal = yrVals[0] || 0;
      const lastVal = yrVals[yrVals.length - 1] || 0;
      const termGrowthPct = firstVal > 0 ? ((lastVal - firstVal) / firstVal) * 100 : 0;
      const totalProjects = item.years.reduce(
        (s, y) => s + (yearMetricsMap.get(y)?.projectCount || 0),
        0
      );
      const ingestedCount = item.years.filter(
        (y) => (yearMetricsMap.get(y)?.projectCount || 0) > 0
      ).length;
      const avgCapRatio =
        item.years.reduce((s, y) => s + (yearMetricsMap.get(y)?.capitalSharePct || 0), 0) /
        Math.max(1, item.years.length);

      const firstYear = item.years[0];
      const lastYear = item.years[item.years.length - 1];
      const endDebt = [...item.years].reverse().map((y) => debtByYearMap[y]).find((d) => d?.totalDebtNairaM);
      const baseDebt = debtByYearMap[firstYear - 1]?.totalDebtNairaM
        ? debtByYearMap[firstYear - 1]
        : item.years.map((y) => debtByYearMap[y]).find((d) => d?.totalDebtNairaM);
      const endDebtNairaM = endDebt?.totalDebtNairaM ?? null;
      const endDebtUsdM = endDebt?.totalDebtUsdM ?? null;
      const netDebtAddedNairaM =
        endDebtNairaM && baseDebt?.totalDebtNairaM && lastYear > firstYear
          ? endDebtNairaM - baseDebt.totalDebtNairaM
          : null;

      return {
        ...item,
        cumulative,
        avgAnnual,
        termGrowthPct,
        totalProjects,
        ingestedCount,
        avgCapRatio,
        endDebtNairaM,
        endDebtUsdM,
        netDebtAddedNairaM,
        crossLedger: crossLedgerByPresident[item.presidentId] || null,
        yearlyBreakdown: item.years.map((y, idx) => ({
          year: y,
          yearLabel: `Year ${idx + 1} (${y})`,
          value: getValueForYear(y),
          projects: yearMetricsMap.get(y)?.projectCount || 0,
        })),
      };
    });
  }, [scopeMode, currencyMode, dataBasis, yearMetricsMap, debtByYearMap, crossLedgerByPresident]);

  // Keep head-to-head selectors valid when switching between 4-Year Terms and Full Presidencies
  useEffect(() => {
    const ids = aggregatedTerms.map((t) => t.id);
    if (!ids.includes(leftId) && ids.length > 0) setLeftId(ids[0]);
    if (!ids.includes(rightId) && ids.length > 0) setRightId(ids[ids.length - 1]);
  }, [scopeMode, aggregatedTerms, leftId, rightId]);

  const leftTerm = aggregatedTerms.find((t) => t.id === leftId) || aggregatedTerms[0];
  const rightTerm =
    aggregatedTerms.find((t) => t.id === rightId) ||
    aggregatedTerms[aggregatedTerms.length - 1];

  const timelineChartData = useMemo(
    () =>
      allYears.map((yr) => {
        const m = yearMetricsMap.get(yr)!;
        const val = getValueForYear(yr);
        return {
          year: yr,
          president: m.president.presidentName,
          shortLabel: `${yr}`,
          valueBillions: Number((val / 1e9).toFixed(2)),
          valueTrillions: Number((val / 1e12).toFixed(3)),
          color: m.president.accentColor,
          projects: m.projectCount,
        };
      }),
    [allYears, yearMetricsMap, currencyMode, dataBasis]
  );

  const headToHeadOverlayData = useMemo(() => {
    if (!leftTerm || !rightTerm) return [];
    const maxLen = Math.max(leftTerm.yearlyBreakdown.length, rightTerm.yearlyBreakdown.length);
    return Array.from({ length: maxLen }, (_, idx) => {
      const l = leftTerm.yearlyBreakdown[idx];
      const r = rightTerm.yearlyBreakdown[idx];
      return {
        slot: `Year ${idx + 1}`,
        leftYear: l?.year || '',
        rightYear: r?.year || '',
        leftValueT: l ? Number((l.value / 1e12).toFixed(3)) : 0,
        rightValueT: r ? Number((r.value / 1e12).toFixed(3)) : 0,
      };
    });
  }, [leftTerm, rightTerm]);

  const toggleCustomYear = (yr: number) => {
    setSelectedYears((prev) => {
      if (prev.includes(yr)) {
        return prev.length > 2 ? prev.filter((y) => y !== yr) : prev;
      }
      if (prev.length >= 6) {
        return [...prev.slice(1), yr].sort((a, b) => a - b);
      }
      return [...prev, yr].sort((a, b) => a - b);
    });
  };

  const handleInspectYear = (yr: number) => {
    setActiveYear(yr);
    onSelectYear?.(yr);
  };

  const currencySuffix =
    currencyMode === 'nominal'
      ? 'Nominal Naira (₦)'
      : currencyMode === 'real2026'
      ? 'Constant 2026 Naira (CPI-Adjusted)'
      : 'US Dollars ($ at CBN Rate)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', minWidth: 0, width: '100%' }}>
      {/* Hero Banner */}
      <div
        style={{
          backgroundColor: '#0d131d',
          border: '1px solid #1e293b',
          borderRadius: '12px',
          padding: '1.35rem 1.5rem',
          color: '#ffffff',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: '#10b981',
              fontSize: '0.75rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.3rem',
            }}
          >
            <Scale size={15} /> Fourth Republic Multi-Year & Presidential Term Comparison (1999–2026)
          </div>
          <h1 className="font-editorial" style={{ fontSize: '1.55rem', fontWeight: 600, color: '#ffffff' }}>
            28-Year Federal Budget & Presidential Administration Analyzer
          </h1>
          <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.2rem' }}>
            Compare individual years, 4-year constitutional terms, and full presidencies from 1999 to present across Nominal ₦, CPI-Adjusted Real Terms, and USD.
          </p>
        </div>

        {/* Normalization & Basis Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', backgroundColor: '#111827', border: '1px solid #334155', borderRadius: '8px', padding: '0.2rem' }}>
            {(
              [
                ['nominal', '₦ Nominal'],
                ['real2026', '📉 Real (2026 ₦)'],
                ['usd', '💵 USD ($)'],
              ] as Array<[CurrencyMode, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setCurrencyMode(key)}
                style={{
                  border: 'none',
                  borderRadius: '6px',
                  padding: '0.35rem 0.7rem',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  backgroundColor: currencyMode === key ? '#10b981' : 'transparent',
                  color: currencyMode === key ? '#000000' : '#94a3b8',
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.7rem' }}>
            <span style={{ color: '#94a3b8' }}>Data Basis:</span>
            <button
              onClick={() => setDataBasis('official')}
              style={{
                border: '1px solid #334155',
                borderRadius: '5px',
                padding: '0.2rem 0.55rem',
                fontSize: '0.7rem',
                fontWeight: 600,
                backgroundColor: dataBasis === 'official' ? '#1e293b' : 'transparent',
                color: dataBasis === 'official' ? '#ffffff' : '#64748b',
              }}
            >
              Official Enacted Envelopes
            </button>
            <button
              onClick={() => setDataBasis('extracted')}
              style={{
                border: '1px solid #334155',
                borderRadius: '5px',
                padding: '0.2rem 0.55rem',
                fontSize: '0.7rem',
                fontWeight: 600,
                backgroundColor: dataBasis === 'extracted' ? '#1e293b' : 'transparent',
                color: dataBasis === 'extracted' ? '#34d399' : '#64748b',
              }}
            >
              PDF Extracted Line-Items
            </button>
          </div>
        </div>
      </div>

      {/* Sub-view Tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {(
            [
              ['terms', '4-Year Presidential Terms (1999–2026)', Layers],
              ['headToHead', 'President-vs-President Head-to-Head', ArrowRightLeft],
              ['years', 'Year-vs-Year Custom Comparator', Calendar],
              ['credibility', 'Promise vs. Reality (2009–2026)', ShieldCheck],
            ] as Array<[CompareSubView, string, any]>
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setSubView(key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.55rem 1rem',
                borderRadius: '8px',
                border: subView === key ? '1px solid #10b981' : '1px solid #e2e8f0',
                backgroundColor: subView === key ? '#0f172a' : '#ffffff',
                color: subView === key ? '#ffffff' : '#475569',
                fontSize: '0.8rem',
                fontWeight: 700,
              }}
            >
              <Icon size={15} color={subView === key ? '#10b981' : '#64748b'} />
              {label}
            </button>
          ))}
        </div>

        {subView !== 'years' && subView !== 'credibility' && (
          <div style={{ display: 'flex', backgroundColor: '#e2e8f0', borderRadius: '6px', padding: '0.2rem' }}>
            <button
              onClick={() => setScopeMode('terms')}
              style={{
                border: 'none',
                borderRadius: '4px',
                padding: '0.3rem 0.7rem',
                fontSize: '0.725rem',
                fontWeight: 700,
                backgroundColor: scopeMode === 'terms' ? '#ffffff' : 'transparent',
                color: scopeMode === 'terms' ? '#0f172a' : '#475569',
              }}
            >
              7 Four-Year Terms
            </button>
            <button
              onClick={() => setScopeMode('presidents')}
              style={{
                border: 'none',
                borderRadius: '4px',
                padding: '0.3rem 0.7rem',
                fontSize: '0.725rem',
                fontWeight: 700,
                backgroundColor: scopeMode === 'presidents' ? '#ffffff' : 'transparent',
                color: scopeMode === 'presidents' ? '#0f172a' : '#475569',
              }}
            >
              5 Presidents (Full Tenure)
            </button>
          </div>
        )}
      </div>

      {/* ================================================================== */}
      {/* SUB-VIEW 1: 4-YEAR PRESIDENTIAL TERMS (1999–2026)                  */}
      {/* ================================================================== */}
      {subView === 'terms' && (
        <>
          {/* 28-Year Timeline Chart */}
          <div
            style={{
              backgroundColor: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '1.25rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>
                  Annual Budget Trajectory by Presidential Era (1999–2026) — {currencySuffix}
                </h3>
                <p style={{ fontSize: '0.725rem', color: '#64748b' }}>
                  Colored by administration; switch between Nominal ₦, Real 2026 ₦, and USD $ above to compare purchasing power fairly across decades.
                </p>
              </div>
              <span style={{ fontSize: '0.7rem', backgroundColor: '#f0fdf4', color: '#047857', border: '1px solid #a7f3d0', padding: '0.2rem 0.55rem', borderRadius: '6px', fontWeight: 700 }}>
                <ShieldCheck size={12} style={{ verticalAlign: 'middle', marginRight: '0.2rem' }} />
                {allYears.length} Years Indexed
              </span>
            </div>

            <div style={{ width: '100%', height: '270px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={timelineChartData} margin={{ top: 10, right: 15, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="shortLabel" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickFormatter={(v: number) =>
                      currencyMode === 'usd' ? `$${v}B` : `${v}T`
                    }
                  />
                  <Tooltip
                    formatter={(_val: any, _name: any, props: any) => {
                      const yr = props?.payload?.year;
                      const formatted = formatMetricLong(getValueForYear(yr));
                      return [formatted, `${props?.payload?.president} (${yr})`];
                    }}
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#ffffff',
                      fontSize: '0.775rem',
                    }}
                  />
                  <Bar
                    dataKey={currencyMode === 'usd' ? 'valueBillions' : 'valueTrillions'}
                    radius={[4, 4, 0, 0]}
                    onClick={(d: any) => d?.year && handleInspectYear(d.year)}
                    style={{ cursor: 'pointer' }}
                  >
                    {timelineChartData.map((entry) => (
                      <Cell key={entry.year} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 4-Year Term / President Cards Grid */}
          <div className="grid-3-cols">
            {aggregatedTerms.map((term) => (
              <div
                key={term.id}
                style={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderTop: `4px solid ${term.accentColor}`,
                  borderRadius: '10px',
                  padding: '1.25rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.85rem',
                  minWidth: 0,
                  overflow: 'hidden',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                  <PresidentAvatar
                    src={term.portraitPath}
                    name={term.title}
                    initials={term.initials}
                    accentColor={term.accentColor}
                    party={term.party}
                    size={58}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <span
                        style={{
                          fontSize: '0.65rem',
                          fontWeight: 800,
                          backgroundColor: term.party === 'PDP' ? '#dcfce7' : '#e0f2fe',
                          color: term.party === 'PDP' ? '#15803d' : '#0369a1',
                          padding: '0.1rem 0.4rem',
                          borderRadius: '4px',
                        }}
                      >
                        {term.party}
                      </span>
                      <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>
                        {term.subtitle}
                      </span>
                    </div>
                    <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a', marginTop: '0.15rem' }}>
                      {term.title}
                    </h3>
                    <div style={{ fontSize: '0.68rem', color: '#64748b' }}>
                      Budget Years: {term.years.join(', ')}
                    </div>
                  </div>
                </div>

                {/* Primary Cumulative Figures */}
                <div
                  style={{
                    backgroundColor: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '0.75rem',
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '0.6rem',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.65rem', color: '#64748b' }}>
                      {term.years.length}-Yr Cumulative ({currencyMode === 'nominal' ? 'Nominal' : currencyMode === 'real2026' ? 'Real 2026' : 'USD'})
                    </div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                      {formatMetric(term.cumulative)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: '#64748b' }}>Avg Annual Budget</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 700, color: term.accentColor }}>
                      {formatMetric(term.avgAnnual)}/yr
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: '#64748b' }}>Term Growth (Yr1→Yr{term.years.length})</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: term.termGrowthPct >= 0 ? '#10b981' : '#ef4444' }}>
                      {term.termGrowthPct >= 0 ? `+${term.termGrowthPct.toFixed(1)}%` : `${term.termGrowthPct.toFixed(1)}%`}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: '#64748b' }}>Extracted Line-Items</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0f172a' }}>
                      {term.totalProjects.toLocaleString()} ({term.ingestedCount}/{term.years.length} yrs)
                    </div>
                  </div>
                  {term.endDebtNairaM ? (
                    <div style={{ gridColumn: '1 / -1', paddingTop: '0.45rem', borderTop: '1px dashed #cbd5e1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                      <div>
                        <div style={{ fontSize: '0.63rem', color: '#92400e', fontWeight: 700, textTransform: 'uppercase' }}>
                          DMO Public Debt (End of Term)
                        </div>
                        <div className="font-mono tabular-nums" style={{ fontSize: '0.85rem', fontWeight: 700, color: '#78350f' }}>
                          ₦{(term.endDebtNairaM / 1e6).toFixed(2)}T{term.endDebtUsdM ? ` ($${(term.endDebtUsdM / 1e3).toFixed(1)}B)` : ''}
                        </div>
                      </div>
                      {term.netDebtAddedNairaM !== null ? (
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '0.63rem', color: '#64748b' }}>Term Debt Delta</div>
                          <div className="font-mono tabular-nums" style={{ fontSize: '0.8rem', fontWeight: 700, color: term.netDebtAddedNairaM >= 0 ? '#b45309' : '#059669' }}>
                            {term.netDebtAddedNairaM >= 0 ? '+' : ''}₦{(term.netDebtAddedNairaM / 1e6).toFixed(2)}T
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {term.crossLedger && (
                    <div style={{ gridColumn: '1 / -1', paddingTop: '0.5rem', borderTop: '1px dashed #cbd5e1', display: 'flex', flexDirection: 'column', gap: '0.38rem' }}>
                      <div style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', color: '#475569', display: 'flex', alignItems: 'center', gap: '0.28rem' }}>
                        <ShieldAlert size={11} color="#991b1b" />
                        6-Ledger Accountability{term.isSingleTermSlice ? ' (Full Presidency)' : ''}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', fontSize: '0.68rem' }}>
                        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '5px', padding: '0.32rem 0.45rem' }}>
                          <div style={{ color: '#64748b', fontSize: '0.61rem' }}>OAuGF Audit Queries</div>
                          <div className="font-mono tabular-nums" style={{ fontWeight: 700, color: '#991b1b' }}>
                            {term.crossLedger.oaugf.reportsCount > 0
                              ? `${term.crossLedger.oaugf.issuesCount.toLocaleString()} (${term.crossLedger.oaugf.recoveryDirectiveCount} rec)`
                              : 'N/A'}
                          </div>
                        </div>
                        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '5px', padding: '0.32rem 0.45rem' }}>
                          <div style={{ color: '#64748b', fontSize: '0.61rem' }}>Evidence Engine v3.0</div>
                          <div className="font-mono tabular-nums" style={{ fontWeight: 700, color: '#0f172a' }}>
                            {term.crossLedger.evidenceEngineV3.totalRuleFindingsCount.toLocaleString()} hits ({term.crossLedger.evidenceEngineV3.crossLedgerFindingsCount.toLocaleString()} XL)
                          </div>
                        </div>
                        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '5px', padding: '0.32rem 0.45rem' }}>
                          <div style={{ color: '#64748b', fontSize: '0.61rem' }}>Bill &rarr; Act Insertions</div>
                          <div className="font-mono tabular-nums" style={{ fontWeight: 700, color: term.crossLedger.legislativePadding.cyclesCount > 0 ? '#b45309' : '#94a3b8' }}>
                            {formatPresidentialBillPadding(term.crossLedger)}
                          </div>
                        </div>
                        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '5px', padding: '0.32rem 0.45rem' }}>
                          <div style={{ color: '#64748b', fontSize: '0.61rem' }}>Open Treasury Cash</div>
                          <div className="font-mono tabular-nums" style={{ fontWeight: 700, color: term.crossLedger.openTreasury.yearsCovered.length > 0 ? '#991b1b' : '#94a3b8' }}>
                            {formatPresidentialOpenTreasury(term.crossLedger)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Year-by-year clickable pills */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: 0, width: '100%' }}>
                  {term.yearlyBreakdown.map((yb) => {
                    const narrativeMeta = macroNarrativesMap[yb.year];
                    const yrDebt = debtByYearMap[yb.year];
                    return (
                    <button
                      key={yb.year}
                      onClick={() => handleInspectYear(yb.year)}
                      title={
                        narrativeMeta?.budgetTheme
                          ? `${yb.year} — ${narrativeMeta.budgetTheme}${yrDebt?.totalDebtNairaM ? ` · Debt ₦${(yrDebt.totalDebtNairaM / 1e6).toFixed(1)}T` : ''}`
                          : `Inspect FY ${yb.year}`
                      }
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '0.5rem',
                        width: '100%',
                        minWidth: 0,
                        maxWidth: '100%',
                        overflow: 'hidden',
                        backgroundColor: '#ffffff',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '6px',
                        padding: '0.38rem 0.6rem',
                        fontSize: '0.75rem',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                      }}
                    >
                      <span className="font-mono tabular-nums" style={{ fontWeight: 700, flexShrink: 0 }}>{yb.year}</span>
                      <span
                        style={{
                          color: 'var(--text-muted)',
                          fontSize: '0.68rem',
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: '1 1 0%',
                          minWidth: 0,
                          textAlign: 'left',
                        }}
                      >
                        {narrativeMeta?.budgetTheme
                          ? `${narrativeMeta.budgetTheme}${yrDebt?.totalDebtNairaM ? ` · Debt ₦${(yrDebt.totalDebtNairaM / 1e6).toFixed(1)}T` : ''}`
                          : yb.projects > 0
                          ? `${yb.projects.toLocaleString()} items`
                          : 'Macro envelope'}
                      </span>
                      <span className="font-mono tabular-nums" style={{ fontWeight: 700, color: term.accentColor, flexShrink: 0, whiteSpace: 'nowrap' }}>
                        {formatMetric(yb.value)} <ExternalLink size={10} style={{ verticalAlign: 'middle' }} />
                      </span>
                    </button>
                    );
                  })}
                </div>

                {term.note && (
                  <div style={{ fontSize: '0.68rem', color: '#64748b', display: 'flex', gap: '0.3rem', alignItems: 'flex-start', borderTop: '1px solid #f1f5f9', paddingTop: '0.5rem' }}>
                    <Info size={12} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <span>{term.note}</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Live DMO Public Debt by Administration Panel */}
          {displayedDebtRows.length > 0 && (
            <div className="dossier-card" style={{ padding: '1.25rem 1.4rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                    <h3 className="font-editorial" style={{ margin: 0, fontSize: '1.18rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Public Debt Incurred by Administration (Live DMO Data)
                    </h3>
                    <InfoHint
                      term="USD Borrowing vs. Naira Revaluation"
                      meaning="USD shows actual hard-currency debt growth. Naira stock jumps whenever CBN Ways & Means are securitized (₦22.71T May 2023) or the Naira floats against the US Dollar."
                      whyItMatters="Comparing Handover Basis with USD & External USD separates new borrowing from exchange-rate revaluation and off-budget overdraft recognition."
                    />
                  </div>
                  <div className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    {handoverDebtLedger.totalDocumentsIndexed} DMO releases indexed · Live through{' '}
                    {handoverDebtLedger.latestAsAt || `FY ${handoverDebtLedger.latestYear}`} ·{' '}
                    {debtBasisMode === 'handover' ? 'Constitutional Handover + ₦22.71T Ways & Means' : 'Raw Year-End DMO Matrix'}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setDebtBasisMode('handover')}
                    style={{
                      padding: '0.34rem 0.6rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-subtle)',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      backgroundColor: debtBasisMode === 'handover' ? '#059669' : '#ffffff',
                      color: debtBasisMode === 'handover' ? '#ffffff' : 'var(--text-secondary)',
                    }}
                  >
                    Handover + W&amp;M
                  </button>
                  <button
                    type="button"
                    onClick={() => setDebtBasisMode('raw')}
                    style={{
                      padding: '0.34rem 0.6rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-subtle)',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      backgroundColor: debtBasisMode === 'raw' ? '#059669' : '#ffffff',
                      color: debtBasisMode === 'raw' ? '#ffffff' : 'var(--text-secondary)',
                    }}
                  >
                    Raw Year-End
                  </button>
                  <button
                    type="button"
                    onClick={() => setDebtMetricUnit('usd')}
                    style={{
                      padding: '0.34rem 0.65rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-subtle)',
                      fontSize: '0.74rem',
                      fontWeight: 600,
                      backgroundColor: debtMetricUnit === 'usd' ? '#091017' : '#ffffff',
                      color: debtMetricUnit === 'usd' ? '#ffffff' : 'var(--text-secondary)',
                    }}
                  >
                    USD ($ Billions)
                  </button>
                  <button
                    type="button"
                    onClick={() => setDebtMetricUnit('naira')}
                    style={{
                      padding: '0.34rem 0.65rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-subtle)',
                      fontSize: '0.74rem',
                      fontWeight: 600,
                      backgroundColor: debtMetricUnit === 'naira' ? '#091017' : '#ffffff',
                      color: debtMetricUnit === 'naira' ? '#ffffff' : 'var(--text-secondary)',
                    }}
                  >
                    Naira (₦ Trillions)
                  </button>
                  <button
                    type="button"
                    onClick={() => loadDebtProfile()}
                    className="editorial-btn"
                    title="Re-fetch latest debt_profile.json"
                    style={{ padding: '0.34rem 0.6rem', fontSize: '0.73rem' }}
                  >
                    <RotateCcw size={12} /> Refresh
                  </button>
                  {onNavigateTab && (
                    <button
                      type="button"
                      onClick={() => onNavigateTab('cbn')}
                      className="editorial-btn"
                      style={{ padding: '0.34rem 0.65rem', fontSize: '0.73rem', fontWeight: 700, borderColor: '#059669', color: '#047857' }}
                    >
                      Open CBN Governors &amp; Debt Ledger <ExternalLink size={11} />
                    </button>
                  )}
                </div>
              </div>

              {/* Dynamic Top Borrowers Callout */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: '0.75rem' }}>
                {(debtBasisMode === 'handover' ? handoverDebtLedger.topUsdTotalBorrower : adminDebtProjection.topUsdBorrower) && (() => {
                  const topU = debtBasisMode === 'handover' ? handoverDebtLedger.topUsdTotalBorrower! : adminDebtProjection.topUsdBorrower!;
                  return (
                    <div style={{ padding: '0.8rem 0.95rem', borderRadius: '8px', backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0' }}>
                      <div className="font-mono" style={{ fontSize: '0.66rem', fontWeight: 700, color: '#047857', textTransform: 'uppercase' }}>
                        Largest Net USD Addition ({'handoverWindow' in topU ? topU.handoverWindow : `${topU.baselineYear}–${topU.endYear}`})
                      </div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', marginTop: '0.15rem' }}>
                        {topU.presidentName}
                      </div>
                      <div className="font-mono tabular-nums" style={{ fontSize: '0.82rem', fontWeight: 700, color: '#059669' }}>
                        +${(topU.netAddedUsdM / 1e3).toFixed(2)}B total USD
                        {topU.netAddedExternalUsdM !== null
                          ? ` (+$${(topU.netAddedExternalUsdM / 1e3).toFixed(2)}B external)`
                          : ''}
                      </div>
                    </div>
                  );
                })()}
                {(debtBasisMode === 'handover' ? handoverDebtLedger.topNairaIncrease : adminDebtProjection.topNairaJump) && (() => {
                  const topN = debtBasisMode === 'handover' ? handoverDebtLedger.topNairaIncrease! : adminDebtProjection.topNairaJump!;
                  return (
                    <div style={{ padding: '0.8rem 0.95rem', borderRadius: '8px', backgroundColor: '#fffbeb', border: '1px solid #fde68a' }}>
                      <div className="font-mono" style={{ fontSize: '0.66rem', fontWeight: 700, color: '#b45309', textTransform: 'uppercase' }}>
                        Largest Nominal Naira Jump ({'handoverWindow' in topN ? topN.handoverWindow : `${topN.baselineYear}–${topN.endYear}`})
                      </div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', marginTop: '0.15rem' }}>
                        {topN.presidentName}
                      </div>
                      <div className="font-mono tabular-nums" style={{ fontSize: '0.82rem', fontWeight: 700, color: '#d97706' }}>
                        +₦{(topN.netAddedNairaM / 1e6).toFixed(2)}T nominal Naira
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Net Debt Added Chart */}
              <div style={{ width: '100%', height: '240px', minWidth: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={displayedDebtRows.map((a) => ({
                      name: a.presidentName.split(' ').slice(-1)[0],
                      netValue:
                        debtMetricUnit === 'usd'
                          ? Number((a.netAddedUsdM / 1e3).toFixed(2))
                          : Number((a.netAddedNairaM / 1e6).toFixed(2)),
                      color: a.accentColor,
                    }))}
                    margin={{ top: 10, right: 16, left: 4, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      tickFormatter={(v) => (debtMetricUnit === 'usd' ? `$${v}B` : `₦${v}T`)}
                    />
                    <Tooltip
                      formatter={(val: any) =>
                        debtMetricUnit === 'usd' ? [`$${val} Billion`, 'Net USD Debt Delta'] : [`₦${val} Trillion`, 'Net Naira Debt Delta']
                      }
                    />
                    <Bar dataKey="netValue" radius={[4, 4, 0, 0]}>
                      {displayedDebtRows.map((entry) => (
                        <Cell key={entry.presidentId} fill={entry.accentColor} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Breakdown Table */}
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table style={{ width: '100%', minWidth: '680px', borderCollapse: 'collapse', fontSize: '0.77rem' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', textAlign: 'left' }}>
                      <th style={{ padding: '0.5rem 0.65rem' }}>Administration</th>
                      <th style={{ padding: '0.5rem 0.65rem' }}>DMO Window</th>
                      <th style={{ padding: '0.5rem 0.65rem', textAlign: 'right' }}>Start → End (USD)</th>
                      <th style={{ padding: '0.5rem 0.65rem', textAlign: 'right' }}>Net USD Delta</th>
                      <th style={{ padding: '0.5rem 0.65rem', textAlign: 'right' }}>Ext. USD Delta</th>
                      <th style={{ padding: '0.5rem 0.65rem', textAlign: 'right' }}>Start → End (Naira)</th>
                      <th style={{ padding: '0.5rem 0.65rem', textAlign: 'right' }}>Net Naira Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedDebtRows.map((row) => (
                      <tr key={row.presidentId} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '0.55rem 0.65rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <PresidentAvatar
                              src={row.portraitPath}
                              name={row.presidentName}
                              initials={row.initials}
                              accentColor={row.accentColor}
                              size={28}
                            />
                            <div>
                              <div>{row.presidentName}</div>
                              <div style={{ fontSize: '0.66rem', fontWeight: 400, color: 'var(--text-muted)' }}>{row.note}</div>
                            </div>
                          </div>
                        </td>
                        <td className="font-mono" style={{ padding: '0.55rem 0.65rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {row.windowLabel}
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.65rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          ${(row.startTotalUsdM / 1e3).toFixed(1)}B → ${(row.endTotalUsdM / 1e3).toFixed(1)}B
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.65rem', textAlign: 'right', fontWeight: 700, color: row.netAddedUsdM >= 0 ? '#b45309' : '#059669', whiteSpace: 'nowrap' }}>
                          {row.netAddedUsdM >= 0 ? '+' : ''}${(row.netAddedUsdM / 1e3).toFixed(2)}B ({row.pctChangeUsd >= 0 ? '+' : ''}{row.pctChangeUsd}%)
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.65rem', textAlign: 'right', fontWeight: 700, color: (row.netAddedExternalUsdM || 0) >= 0 ? '#991b1b' : '#059669', whiteSpace: 'nowrap' }}>
                          {row.netAddedExternalUsdM !== null
                            ? `${row.netAddedExternalUsdM >= 0 ? '+' : ''}$${(row.netAddedExternalUsdM / 1e3).toFixed(2)}B`
                            : 'N/A'}
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.65rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          ₦{(row.startTotalNairaM / 1e6).toFixed(2)}T → ₦{(row.endTotalNairaM / 1e6).toFixed(2)}T
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.65rem', textAlign: 'right', fontWeight: 700, color: row.netAddedNairaM >= 0 ? '#b45309' : '#059669', whiteSpace: 'nowrap' }}>
                          {row.netAddedNairaM >= 0 ? '+' : ''}₦{(row.netAddedNairaM / 1e6).toFixed(2)}T ({row.pctChangeNaira >= 0 ? '+' : ''}{row.pctChangeNaira}%)
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ================================================================== */}
      {/* SUB-VIEW 2: PRESIDENT-VS-PRESIDENT HEAD-TO-HEAD                    */}
      {/* ================================================================== */}
      {subView === 'headToHead' && leftTerm && rightTerm && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Selector Row */}
          <div
            className="mobile-head-to-head-grid"
            style={{
              backgroundColor: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '1.25rem',
            }}
          >
            {/* Left Administration */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', minWidth: 0 }}>
              <PresidentAvatar
                src={leftTerm.portraitPath}
                name={leftTerm.title}
                initials={leftTerm.initials}
                accentColor={leftTerm.accentColor}
                size={64}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                  Administration A
                </div>
                <select
                  value={leftTerm.id}
                  onChange={(e) => setLeftId(e.target.value)}
                  style={{
                    width: '100%',
                    marginTop: '0.25rem',
                    padding: '0.45rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    color: '#0f172a',
                  }}
                >
                  {aggregatedTerms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title} — {t.subtitle}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: '0.725rem', color: '#64748b', marginTop: '0.25rem' }}>
                  Years: {leftTerm.years.join(', ')} • {leftTerm.party}
                </div>
              </div>
            </div>

            <div
              style={{
                backgroundColor: '#0f172a',
                color: '#10b981',
                fontWeight: 800,
                padding: '0.5rem 0.85rem',
                borderRadius: '999px',
                fontSize: '0.8rem',
              }}
            >
              VS
            </div>

            {/* Right Administration */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', minWidth: 0 }}>
              <PresidentAvatar
                src={rightTerm.portraitPath}
                name={rightTerm.title}
                initials={rightTerm.initials}
                accentColor={rightTerm.accentColor}
                size={64}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                  Administration B
                </div>
                <select
                  value={rightTerm.id}
                  onChange={(e) => setRightId(e.target.value)}
                  style={{
                    width: '100%',
                    marginTop: '0.25rem',
                    padding: '0.45rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    color: '#0f172a',
                  }}
                >
                  {aggregatedTerms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title} — {t.subtitle}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: '0.725rem', color: '#64748b', marginTop: '0.25rem' }}>
                  Years: {rightTerm.years.join(', ')} • {rightTerm.party}
                </div>
              </div>
            </div>
          </div>

          {/* Delta Comparison KPIs */}
          <div className="grid-3-cols">
            <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1.15rem' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Cumulative Spend ({currencySuffix})</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '0.4rem' }}>
                <span style={{ fontWeight: 800, fontSize: '1.1rem', color: leftTerm.accentColor }}>
                  {formatMetric(leftTerm.cumulative)}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>vs</span>
                <span style={{ fontWeight: 800, fontSize: '1.1rem', color: rightTerm.accentColor }}>
                  {formatMetric(rightTerm.cumulative)}
                </span>
              </div>
              <div style={{ fontSize: '0.725rem', color: '#0f172a', fontWeight: 700, marginTop: '0.35rem' }}>
                {leftTerm.cumulative > 0
                  ? `B vs A: ${(((rightTerm.cumulative - leftTerm.cumulative) / leftTerm.cumulative) * 100).toFixed(1)}%`
                  : 'N/A'}
              </div>
            </div>

            <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1.15rem' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Average Annual Allocation</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '0.4rem' }}>
                <span style={{ fontWeight: 800, fontSize: '1.1rem', color: leftTerm.accentColor }}>
                  {formatMetric(leftTerm.avgAnnual)}/yr
                </span>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>vs</span>
                <span style={{ fontWeight: 800, fontSize: '1.1rem', color: rightTerm.accentColor }}>
                  {formatMetric(rightTerm.avgAnnual)}/yr
                </span>
              </div>
              <div style={{ fontSize: '0.725rem', color: '#64748b', marginTop: '0.35rem' }}>
                Avg Capital Share: {leftTerm.avgCapRatio.toFixed(1)}% vs {rightTerm.avgCapRatio.toFixed(1)}%
              </div>
            </div>

            <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1.15rem' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Extracted Line-Item Projects</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '0.4rem' }}>
                <span style={{ fontWeight: 800, fontSize: '1.1rem', color: leftTerm.accentColor }}>
                  {leftTerm.totalProjects.toLocaleString()}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>vs</span>
                <span style={{ fontWeight: 800, fontSize: '1.1rem', color: rightTerm.accentColor }}>
                  {rightTerm.totalProjects.toLocaleString()}
                </span>
              </div>
              <div style={{ fontSize: '0.725rem', color: '#64748b', marginTop: '0.35rem' }}>
                Term Growth: {leftTerm.termGrowthPct.toFixed(1)}% vs {rightTerm.termGrowthPct.toFixed(1)}%
              </div>
            </div>
          </div>

          {/* 6-Ledger Accountability Head-to-Head Matrix */}
          <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1.25rem', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                  <Scale size={16} color="#059669" />
                  6-Ledger Accountability Comparison: {leftTerm.title} vs. {rightTerm.title}
                </h3>
                <p style={{ fontSize: '0.73rem', color: '#64748b', margin: '0.2rem 0 0' }}>
                  {(leftTerm.isSingleTermSlice || rightTerm.isSingleTermSlice)
                    ? 'Note: Audit queries, Legislative Bill->Act deltas, Open Treasury cash, and Evidence Engine v3 totals reflect each President\'s full constitutional tenure across indexed years.'
                    : 'Side-by-side multi-ledger accountability metrics across Official Audit, Legislative Padding, Open Treasury Cash, Evidence Engine v3.0, and Sovereign Debt.'}
                </p>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '0.55rem 0.7rem' }}>6-Ledger Accountability Dimension</th>
                    <th style={{ padding: '0.55rem 0.7rem', color: leftTerm.accentColor }}>{leftTerm.title} ({leftTerm.subtitle})</th>
                    <th style={{ padding: '0.55rem 0.7rem', color: rightTerm.accentColor }}>{rightTerm.title} ({rightTerm.subtitle})</th>
                    <th style={{ padding: '0.55rem 0.7rem' }}>Era Coverage Guard</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.55rem 0.7rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <ShieldAlert size={13} color="#991b1b" /> OAuGF Constitutional Audit Queries
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.7rem', fontWeight: 700 }}>
                      {leftTerm.crossLedger
                        ? `${leftTerm.crossLedger.oaugf.issuesCount.toLocaleString()} queries · ${leftTerm.crossLedger.oaugf.recoveryDirectiveCount} rec · ${leftTerm.crossLedger.oaugf.repeatNeglectCount} repeat`
                        : 'Loading...'}
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.7rem', fontWeight: 700 }}>
                      {rightTerm.crossLedger
                        ? `${rightTerm.crossLedger.oaugf.issuesCount.toLocaleString()} queries · ${rightTerm.crossLedger.oaugf.recoveryDirectiveCount} rec · ${rightTerm.crossLedger.oaugf.repeatNeglectCount} repeat`
                        : 'Loading...'}
                    </td>
                    <td style={{ padding: '0.55rem 0.7rem', fontSize: '0.7rem', color: '#64748b' }}>
                      36 OAuGF Reports (1999–2024)
                    </td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.55rem 0.7rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <FileWarning size={13} color="#b45309" /> Legislative Bill &rarr; Act Insertions
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.7rem', fontWeight: 700, color: leftTerm.crossLedger?.legislativePadding.cyclesCount ? '#b45309' : '#94a3b8' }}>
                      {formatPresidentialBillPadding(leftTerm.crossLedger)}
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.7rem', fontWeight: 700, color: rightTerm.crossLedger?.legislativePadding.cyclesCount ? '#b45309' : '#94a3b8' }}>
                      {formatPresidentialBillPadding(rightTerm.crossLedger)}
                    </td>
                    <td style={{ padding: '0.55rem 0.7rem', fontSize: '0.7rem', color: '#64748b' }}>
                      Bill-vs-Act archive starts FY 2017
                    </td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.55rem 0.7rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Wallet size={13} color="#9f1239" /> Open Treasury Cash &amp; Dec Rush
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.7rem', fontWeight: 700, color: leftTerm.crossLedger?.openTreasury.yearsCovered.length ? '#991b1b' : '#94a3b8' }}>
                      {formatPresidentialOpenTreasury(leftTerm.crossLedger)}
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.7rem', fontWeight: 700, color: rightTerm.crossLedger?.openTreasury.yearsCovered.length ? '#991b1b' : '#94a3b8' }}>
                      {formatPresidentialOpenTreasury(rightTerm.crossLedger)}
                    </td>
                    <td style={{ padding: '0.55rem 0.7rem', fontSize: '0.7rem', color: '#64748b' }}>
                      Open Treasury portal starts Sep 2018
                    </td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.55rem 0.7rem', fontWeight: 700 }}>
                      Evidence Engine v3.0 Rule Hits (22 Rules)
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.7rem', fontWeight: 700 }}>
                      {leftTerm.crossLedger
                        ? `${leftTerm.crossLedger.evidenceEngineV3.totalRuleFindingsCount.toLocaleString()} hits (${leftTerm.crossLedger.evidenceEngineV3.crossLedgerFindingsCount.toLocaleString()} XL · ${leftTerm.crossLedger.evidenceEngineV3.flaggedProjectsCount.toLocaleString()} proj)`
                        : 'Loading...'}
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.7rem', fontWeight: 700 }}>
                      {rightTerm.crossLedger
                        ? `${rightTerm.crossLedger.evidenceEngineV3.totalRuleFindingsCount.toLocaleString()} hits (${rightTerm.crossLedger.evidenceEngineV3.crossLedgerFindingsCount.toLocaleString()} XL · ${rightTerm.crossLedger.evidenceEngineV3.flaggedProjectsCount.toLocaleString()} proj)`
                        : 'Loading...'}
                    </td>
                    <td style={{ padding: '0.55rem 0.7rem', fontSize: '0.7rem', color: '#64748b' }}>
                      559,391 records (1999–2026)
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '0.55rem 0.7rem', fontWeight: 700 }}>
                      DMO Sovereign Debt (End of Period)
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.7rem', fontWeight: 700 }}>
                      {leftTerm.endDebtNairaM
                        ? `₦${(leftTerm.endDebtNairaM / 1e6).toFixed(2)}T ($${((leftTerm.endDebtUsdM || 0) / 1e3).toFixed(1)}B)`
                        : 'N/A (Pre-2005)'}
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.7rem', fontWeight: 700 }}>
                      {rightTerm.endDebtNairaM
                        ? `₦${(rightTerm.endDebtNairaM / 1e6).toFixed(2)}T ($${((rightTerm.endDebtUsdM || 0) / 1e3).toFixed(1)}B)`
                        : 'N/A (Pre-2005)'}
                    </td>
                    <td style={{ padding: '0.55rem 0.7rem', fontSize: '0.7rem', color: '#64748b' }}>
                      505 DMO Bulletins (2005–2026)
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Year 1..4 Overlaid Bar Chart */}
          <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1.25rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.75rem' }}>
              Year-by-Year Term Trajectory ({leftTerm.title} vs {rightTerm.title})
            </h3>
            <div style={{ width: '100%', height: '260px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={headToHeadOverlayData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="slot" tick={{ fontSize: 12, fill: '#475569' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v: number) => `${v}T`} />
                  <Tooltip
                    formatter={(v: any, name: any) => [`${currencyMode === 'usd' ? '$' : '₦'}${v} Trillion`, name]}
                    contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '0.75rem' }}
                  />
                  <Legend />
                  <Bar
                    dataKey="leftValueT"
                    name={`${leftTerm.title} (${leftTerm.subtitle})`}
                    fill={leftTerm.accentColor}
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="rightValueT"
                    name={`${rightTerm.title} (${rightTerm.subtitle})`}
                    fill={rightTerm.accentColor}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* SUB-VIEW 3: YEAR-VS-YEAR CUSTOM MULTI-YEAR COMPARATOR (1999-2026)  */}
      {/* ================================================================== */}
      {subView === 'years' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1.15rem' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.5rem',
                marginBottom: '0.65rem',
              }}
            >
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0f172a' }}>
                Select 2 to 6 Years to Compare Side-by-Side (1999–2026):
              </div>
              <button
                type="button"
                onClick={() => setSelectedYears(DEFAULT_COMPARISON_YEARS)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.3rem 0.7rem',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#f8fafc',
                  color: '#0f172a',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                <RotateCcw size={12} />
                Reset: All 5 Presidents
              </button>
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '0.45rem 0.9rem',
                marginBottom: '0.75rem',
                padding: '0.45rem 0.65rem',
                borderRadius: '7px',
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
              }}
            >
              {PRESIDENTS_AGGREGATE.map((p) => {
                const startYr = p.budgetYears[0];
                const endYr = p.budgetYears[p.budgetYears.length - 1];
                return (
                  <span
                    key={p.presidentId}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      fontSize: '0.72rem',
                      color: '#334155',
                      fontWeight: 600,
                    }}
                  >
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '9999px',
                        backgroundColor: p.accentColor,
                        display: 'inline-block',
                        flexShrink: 0,
                      }}
                    />
                    <span>
                      {p.presidentName} &middot; {startYr}&ndash;{endYr}
                    </span>
                  </span>
                );
              })}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
              {allYears.map((yr) => {
                const isSelected = selectedYears.includes(yr);
                const pres = getPresidentForYear(yr);
                return (
                  <button
                    key={yr}
                    onClick={() => toggleCustomYear(yr)}
                    title={`${yr} — ${pres.presidentName}`}
                    style={{
                      padding: '0.3rem 0.65rem',
                      borderRadius: '6px',
                      border: isSelected ? `1px solid ${pres.accentColor}` : '1px solid #e2e8f0',
                      backgroundColor: isSelected ? pres.accentColor : '#f8fafc',
                      color: isSelected ? '#ffffff' : '#334155',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                    }}
                  >
                    {isSelected && <Check size={11} />}
                    {yr}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Comparison Cards Grid */}
          <div className="grid-3-cols">
            {selectedYears.map((yr) => {
              const m = yearMetricsMap.get(yr)!;
              const macro = getMacroForYear(yr);
              const displayVal = getValueForYear(yr);
              const yearRecs = getRecordsForYear(yr);
              const avgProjectSize = m.projectCount > 0 ? m.extractedNaira / m.projectCount : 0;

              return (
                <div
                  key={yr}
                  style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderTop: `4px solid ${m.president.accentColor}`,
                    borderRadius: '10px',
                    padding: '1.15rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                    minWidth: 0,
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <PresidentAvatar
                        src={m.president.portraitPath}
                        name={m.president.presidentName}
                        initials={m.president.initials}
                        accentColor={m.president.accentColor}
                        size={42}
                      />
                      <div>
                        <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>{yr} Budget</div>
                        <div style={{ fontSize: '0.725rem', color: '#64748b', fontWeight: 600 }}>
                          {m.president.presidentName} ({m.president.party})
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleInspectYear(yr)}
                      style={{
                        backgroundColor: '#f1f5f9',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        padding: '0.25rem 0.55rem',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        color: '#0f172a',
                      }}
                    >
                      Open Year
                    </button>
                  </div>

                  <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.775rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748b' }}>Selected Metric ({currencyMode}):</span>
                      <strong style={{ color: m.president.accentColor }}>{formatMetricLong(displayVal)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748b' }}>Official Enacted Envelope:</span>
                      <strong>₦{(macro.officialTotalBudget / 1e12).toFixed(2)}T</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748b' }}>Extracted PDF Line-Items:</span>
                      <strong>{m.extractedNaira > 0 ? `₦${(m.extractedNaira / 1e12).toFixed(2)}T` : 'Scanned / Pending'}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748b' }}>USD Equivalent (@₦{macro.fxNairaPerUsd}/$):</span>
                      <strong>${(macro.officialTotalBudget / macro.fxNairaPerUsd / 1e9).toFixed(2)}B</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748b' }}>Constant 2026 Value:</span>
                      <strong>₦{((macro.officialTotalBudget * macro.cpiDeflatorTo2026) / 1e12).toFixed(2)}T</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748b' }}>Capital Line Items:</span>
                      <strong>{m.projectCount.toLocaleString()} items</strong>
                    </div>
                    {avgProjectSize > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#64748b' }}>Avg Item Allocation:</span>
                        <strong>₦{(avgProjectSize / 1e6).toFixed(1)}M</strong>
                      </div>
                    )}
                    {yearRecs.length > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#64748b' }}>Loaded Forensic Records:</span>
                        <strong>{yearRecs.length.toLocaleString()}</strong>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* SUB-VIEW 4: PROMISE VS. REALITY MACRO CREDIBILITY (2009–2026)      */}
      {/* ================================================================== */}
      {subView === 'credibility' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
          {!macroCredibility ? (
            <div className="dossier-card" style={{ padding: '1.25rem', fontSize: '0.82rem', color: '#64748b' }}>
              Loading 2009–2026 Promise vs. Reality macro credibility series...
            </div>
          ) : (
            <>
              {/* 4-Metric Headline Strip */}
              <div className="grid-4-cols">
                <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.9rem 1.05rem' }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                    Verified BIR Window
                  </div>
                  <div className="font-mono tabular-nums" style={{ fontSize: '1.3rem', fontWeight: 700, color: '#0f172a', marginTop: '0.15rem' }}>
                    {macroCredibility.headline.birYearsCount} Fiscal Yrs
                  </div>
                  <div className="font-mono" style={{ fontSize: '0.68rem', color: '#64748b' }}>
                    {macroCredibility.headline.yearRange} · Obasanjo pre-BIR era marked N/A
                  </div>
                </div>

                <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.9rem 1.05rem' }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                    Mean Capital Execution
                  </div>
                  <div className="font-mono tabular-nums" style={{ fontSize: '1.3rem', fontWeight: 700, color: '#059669', marginTop: '0.15rem' }}>
                    {macroCredibility.headline.meanCapitalPerformancePct !== null
                      ? `${macroCredibility.headline.meanCapitalPerformancePct.toFixed(1)}%`
                      : 'N/A'}
                  </div>
                  <div className="font-mono" style={{ fontSize: '0.68rem', color: '#64748b' }}>
                    Mean Revenue {macroCredibility.headline.meanRevenuePerformancePct?.toFixed(1) ?? 'N/A'}% of MTEF target
                  </div>
                </div>

                <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.9rem 1.05rem' }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                    Mean Debt-Service Execution
                  </div>
                  <div className="font-mono tabular-nums" style={{ fontSize: '1.3rem', fontWeight: 700, color: '#b91c1c', marginTop: '0.15rem' }}>
                    {macroCredibility.headline.meanDebtServicePerformancePct !== null
                      ? `${macroCredibility.headline.meanDebtServicePerformancePct.toFixed(1)}%`
                      : 'N/A'}
                  </div>
                  <div className="font-mono" style={{ fontSize: '0.68rem', color: '#64748b' }}>
                    Overrun (&gt;100%) in {macroCredibility.headline.debtServiceOverrunYearsCount} of {macroCredibility.headline.birYearsCount} yrs
                  </div>
                </div>

                <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.9rem 1.05rem' }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                    Cumulative Debt Overrun
                  </div>
                  <div className="font-mono tabular-nums" style={{ fontSize: '1.3rem', fontWeight: 700, color: '#b45309', marginTop: '0.15rem' }}>
                    ₦{(macroCredibility.headline.cumulativeDebtServiceOverrunNaira / 1e12).toFixed(2)}T
                  </div>
                  <div className="font-mono" style={{ fontSize: '0.68rem', color: '#64748b' }}>
                    Exceeding Appropriation Act debt ceilings
                  </div>
                </div>
              </div>

              {/* 5-President Credibility Rollup Strip */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(225px, 1fr))', gap: '0.75rem' }}>
                {macroCredibility.administrations.map((adm) => {
                  const isPreBir = adm.birCoverageStatus === 'PRE_BIR_ERA_NO_SOURCE';
                  const presMeta = PRESIDENTS_AGGREGATE.find((p) => p.presidentId === adm.presidentId);
                  return (
                    <div
                      key={adm.presidentId}
                      style={{
                        backgroundColor: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderTop: `4px solid ${presMeta?.accentColor || '#059669'}`,
                        borderRadius: '10px',
                        padding: '0.95rem 1rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.45rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0f172a' }}>
                            {adm.presidentName}
                          </div>
                          <div className="font-mono" style={{ fontSize: '0.67rem', color: '#64748b' }}>
                            {adm.party} · {adm.tenureLabel}
                          </div>
                        </div>
                        <span
                          className="font-mono"
                          style={{
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            padding: '0.15rem 0.45rem',
                            borderRadius: '999px',
                            backgroundColor: isPreBir ? '#f1f5f9' : '#ecfdf5',
                            color: isPreBir ? '#64748b' : '#047857',
                          }}
                        >
                          {isPreBir ? 'Pre-2009 N/A' : `${adm.birYearsCovered} BIR Yrs`}
                        </span>
                      </div>

                      {isPreBir ? (
                        <div style={{ fontSize: '0.73rem', color: '#64748b', backgroundColor: '#f8fafc', padding: '0.55rem 0.65rem', borderRadius: '6px' }}>
                          OAGF/Budget Office BIR series starts in FY 2009 — no verified BIR execution scores fabricated for 1999–2006.
                          {adm.dmoEndDebtNairaM && (
                            <div className="font-mono" style={{ marginTop: '0.25rem', color: '#0f172a', fontWeight: 600 }}>
                              2006 Paris-Exit Debt: ₦{(adm.dmoEndDebtNairaM / 1e6).toFixed(2)}T (${((adm.dmoEndDebtUsdM || 0) / 1e3).toFixed(2)}B)
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="font-mono tabular-nums" style={{ display: 'flex', flexDirection: 'column', gap: '0.26rem', fontSize: '0.72rem', backgroundColor: '#f8fafc', padding: '0.55rem 0.65rem', borderRadius: '6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#64748b' }}>Avg BIR Capital Exec:</span>
                            <strong style={{ color: '#059669' }}>
                              {adm.avgCapitalPerformancePct !== null ? `${adm.avgCapitalPerformancePct.toFixed(1)}%` : 'N/A'} ({adm.birCapitalYearsCount}y)
                            </strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#64748b' }}>Avg BIR Revenue:</span>
                            <strong style={{ color: '#0f172a' }}>
                              {adm.avgRevenuePerformancePct !== null ? `${adm.avgRevenuePerformancePct.toFixed(1)}%` : 'N/A'} ({adm.birRevenueYearsCount}y)
                            </strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#64748b' }}>Avg Debt Svc Exec:</span>
                            <strong style={{ color: (adm.avgDebtServicePerformancePct || 0) > 100 ? '#b91c1c' : '#0f172a' }}>
                              {adm.avgDebtServicePerformancePct !== null ? `${adm.avgDebtServicePerformancePct.toFixed(1)}%` : 'N/A'} ({adm.debtServiceOverrunYears} overruns)
                            </strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#64748b' }}>Debt Svc / Revenue:</span>
                            <strong>{adm.avgDebtServiceToRevenuePct !== null ? `${adm.avgDebtServiceToRevenuePct.toFixed(1)}%` : 'N/A'}</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#64748b' }}>Mean FX Slippage:</span>
                            <strong style={{ color: (adm.avgFxSlippagePct || 0) > 25 ? '#b45309' : '#0f172a' }}>
                              {adm.avgFxSlippagePct !== null ? `${adm.avgFxSlippagePct > 0 ? '+' : ''}${adm.avgFxSlippagePct.toFixed(1)}%` : 'N/A'}
                            </strong>
                          </div>
                          {adm.partialYearNotes.length > 0 && (
                            <div style={{ fontSize: '0.64rem', color: '#b45309', marginTop: '0.15rem' }}>
                              Includes YTD interim: {adm.partialYearNotes.join(', ')}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Capital vs Debt Service Chart (2009–2026) */}
              <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1.2rem' }}>
                <div style={{ marginBottom: '0.75rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>
                    BIR Execution Reality (2009–2026): Capital Expenditure vs. Debt Service (% of Approved Budget)
                  </h3>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                    Dashed line marks 100% Enacted Budget ceiling. Debt Service repeatedly breaches 100% while Capital releases lag (missing BIR rows omitted cleanly).
                  </p>
                </div>

                <div style={{ height: '295px', width: '100%' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={macroCredibility.yearlySeries.map((r) => ({
                        year: String(r.financialYear),
                        capitalPct: r.bir.capitalPerformancePct,
                        debtPct: r.bir.debtServicePerformancePct,
                        revPct: r.bir.revenuePerformancePct,
                        scope: r.reportPeriodLabel || r.quarterCovered || 'Full Year',
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#475569' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#475569' }} unit="%" />
                      <ReferenceLine y={100} stroke="#0f172a" strokeDasharray="4 4" />
                      <Tooltip
                        formatter={(val: any, name: any) =>
                          val !== null && val !== undefined ? [`${Number(val).toFixed(1)}%`, name] : ['N/A', name]
                        }
                        labelFormatter={(lbl, payloadItems: any) => {
                          const scope = payloadItems?.[0]?.payload?.scope || '';
                          return `FY ${lbl} (${scope})`;
                        }}
                      />
                      <Legend />
                      <Bar dataKey="capitalPct" name="Capital Expenditure %" fill="#10b981" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="debtPct" name="Debt Service %" fill="#dc2626" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="revPct" name="FGN Revenue %" fill="#0284c7" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Year-by-Year Audit Table */}
              <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1.15rem', overflowX: 'auto' }}>
                <div style={{ marginBottom: '0.65rem' }}>
                  <h4 style={{ margin: 0, fontSize: '0.94rem', fontWeight: 700, color: '#0f172a' }}>
                    Year-by-Year MTEF Promise vs. BIR / CBN / DMO Reality Ledger (2009–2026)
                  </h4>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'left' }}>
                      <th style={{ padding: '0.5rem 0.55rem' }}>FY &amp; Scope</th>
                      <th style={{ padding: '0.5rem 0.55rem' }}>President</th>
                      <th style={{ padding: '0.5rem 0.55rem', textAlign: 'right' }}>MTEF Oil / FX</th>
                      <th style={{ padding: '0.5rem 0.55rem', textAlign: 'right' }}>CBN/DMO FX (Slip)</th>
                      <th style={{ padding: '0.5rem 0.55rem', textAlign: 'right' }}>BIR Rev %</th>
                      <th style={{ padding: '0.5rem 0.55rem', textAlign: 'right' }}>BIR Cap %</th>
                      <th style={{ padding: '0.5rem 0.55rem', textAlign: 'right' }}>Debt Svc %</th>
                      <th style={{ padding: '0.5rem 0.55rem', textAlign: 'right' }}>Debt / Rev</th>
                      <th style={{ padding: '0.5rem 0.55rem', textAlign: 'right' }}>DMO Debt Stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {macroCredibility.yearlySeries.map((r) => (
                      <tr key={r.financialYear} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td className="font-mono" style={{ padding: '0.48rem 0.55rem', whiteSpace: 'nowrap' }}>
                          <strong style={{ color: '#0f172a' }}>{r.financialYear}</strong>{' '}
                          <span style={{ fontSize: '0.65rem', color: r.isPartialYearReport ? '#b45309' : '#64748b' }}>
                            ({r.quarterCovered || 'Q4'})
                          </span>
                        </td>
                        <td style={{ padding: '0.48rem 0.55rem', fontWeight: 600, color: '#334155' }}>
                          {r.shortName}
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.48rem 0.55rem', textAlign: 'right' }}>
                          ${r.mtef.oilPriceUsdPerBbl ?? '–'} · ₦{r.mtef.exchangeRateNairaPerUsd ?? '–'}
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.48rem 0.55rem', textAlign: 'right' }}>
                          ₦{r.realized.cbnFxRateNairaPerUsd ?? '–'}
                          {r.realized.fxSlippagePct !== null && (
                            <span style={{ color: r.realized.fxSlippagePct > 20 ? '#b45309' : '#64748b', marginLeft: '0.25rem' }}>
                              ({r.realized.fxSlippagePct > 0 ? '+' : ''}{r.realized.fxSlippagePct.toFixed(1)}%)
                            </span>
                          )}
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.48rem 0.55rem', textAlign: 'right' }}>
                          {r.bir.revenuePerformancePct !== null ? `${r.bir.revenuePerformancePct.toFixed(1)}%` : 'N/A'}
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.48rem 0.55rem', textAlign: 'right', color: '#047857', fontWeight: 700 }}>
                          {r.bir.capitalPerformancePct !== null ? `${r.bir.capitalPerformancePct.toFixed(1)}%` : 'N/A'}
                        </td>
                        <td
                          className="font-mono tabular-nums"
                          style={{
                            padding: '0.48rem 0.55rem',
                            textAlign: 'right',
                            fontWeight: 700,
                            color: r.bir.debtServiceOverrunFlag ? '#b91c1c' : '#0f172a',
                          }}
                        >
                          {r.bir.debtServicePerformancePct !== null
                            ? `${r.bir.debtServicePerformancePct.toFixed(1)}%${r.bir.debtServiceDerivedFromComponents ? '*' : ''}`
                            : 'N/A'}
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.48rem 0.55rem', textAlign: 'right' }}>
                          {r.bir.debtServiceToRevenuePct !== null ? `${r.bir.debtServiceToRevenuePct.toFixed(1)}%` : 'N/A'}
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.48rem 0.55rem', textAlign: 'right', color: '#475569' }}>
                          {r.realized.totalDebtNairaM
                            ? `₦${(r.realized.totalDebtNairaM / 1e6).toFixed(2)}T / $${((r.realized.totalDebtUsdM || 0) / 1e3).toFixed(1)}B`
                            : 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="font-mono" style={{ fontSize: '0.66rem', color: '#64748b', marginTop: '0.5rem' }}>
                  * FY 2009 &amp; FY 2015 Debt Service % derived from verified Domestic + Foreign Debt Service components.
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
