import React, { useEffect, useMemo, useState } from 'react';
import { datasetUrl } from '../services/apiClient';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Landmark,
  RotateCcw,
  Scale,
  Search,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import {
  CBN_ACTING_GOVERNORS,
  CBN_GOVERNORS,
  type CbnGovernorProfile,
  type EfccInvestigationStatus,
} from '../data/cbnGovernors';
import { HISTORICAL_MACRO_DATA } from '../data/historicalMacroData';
import {
  computeAdministrationDebtProjection,
  computeConstitutionalHandoverDebtLedger,
  type DmoYearRow,
} from '../utils/administrationDebt';
import {
  exportCbnDebtBriefDocx,
  exportCbnDebtBriefPdf,
} from '../utils/documentExporter';
import { buildCanonicalPermalink } from '../utils/urlState';
import { InfoHint } from './InfoHint';
import { PresidentAvatar } from './PresidentAvatar';

interface CbnGovernorsAndDebtHubProps {
  onSelectYear?: (year: number) => void;
  onNavigateTab?: (tab: string) => void;
}

type SectionFocus = 'all' | 'debt' | 'governors';
type EraFilter = 'all' | 'FOURTH_REPUBLIC' | 'FOUNDING_MILITARY';
type DebtBasisMode = 'handover' | 'raw';
type DebtChartMode = 'netUsd' | 'extUsd' | 'netNaira' | 'timeline';

function getEfccBadgeStyle(status: EfccInvestigationStatus): {
  bg: string;
  color: string;
  border: string;
  headingColor: string;
} {
  switch (status) {
    case 'CHARGED_TRIAL_ONGOING':
      return { bg: '#fef2f2', color: '#991b1b', border: '#fecaca', headingColor: '#7f1d1d' };
    case 'INVESTIGATED_CLEARED':
      return { bg: '#ecfdf5', color: '#047857', border: '#a7f3d0', headingColor: '#064e3b' };
    case 'SCRUTINIZED_NO_EFCC_CHARGE':
      return { bg: '#fffbeb', color: '#b45309', border: '#fde68a', headingColor: '#78350f' };
    case 'NO_EFCC_INVESTIGATION':
    default:
      return { bg: '#f8fafc', color: '#475569', border: '#cbd5e1', headingColor: '#334155' };
  }
}

function fmtNairaT(millions: number | null | undefined, showSign = false): string {
  if (millions === null || millions === undefined || Number.isNaN(millions)) return 'N/A';
  const sign = showSign && millions > 0 ? '+' : millions < 0 ? '-' : '';
  const absT = Math.abs(millions) / 1e6;
  if (absT >= 1) return `${sign}₦${absT.toFixed(2)}T`;
  return `${sign}₦${(Math.abs(millions) / 1e3).toFixed(1)}B`;
}

function fmtUsdB(millions: number | null | undefined, showSign = false): string {
  if (millions === null || millions === undefined || Number.isNaN(millions)) return 'N/A';
  const sign = showSign && millions > 0 ? '+' : millions < 0 ? '-' : '';
  return `${sign}$${(Math.abs(millions) / 1e3).toFixed(2)}B`;
}

export const CbnGovernorsAndDebtHub: React.FC<CbnGovernorsAndDebtHubProps> = ({
  onSelectYear,
  onNavigateTab,
}) => {
  const [debtRows, setDebtRows] = useState<DmoYearRow[]>([]);
  const [debtDocsCount, setDebtDocsCount] = useState<number>(505);
  const [loadingDebt, setLoadingDebt] = useState<boolean>(true);
  const [sectionFocus, setSectionFocus] = useState<SectionFocus>('all');
  const [basisMode, setBasisMode] = useState<DebtBasisMode>('handover');
  const [chartMode, setChartMode] = useState<DebtChartMode>('netUsd');

  const [eraFilter, setEraFilter] = useState<EraFilter>('all');
  const [presidentFilter, setPresidentFilter] = useState<string>('ALL');
  const [efccOnly, setEfccOnly] = useState<boolean>(false);
  const [sortOrder, setSortOrder] = useState<'newest' | 'chronological'>('newest');
  const [govSearch, setGovSearch] = useState<string>('');
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const loadDebt = React.useCallback(() => {
    setLoadingDebt(true);
    fetch(datasetUrl('/datasets/debt_profile.json'), { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { totalDocumentsIndexed?: number; yearlyDebt?: DmoYearRow[] } | null) => {
        if (data?.yearlyDebt) {
          setDebtRows(data.yearlyDebt);
          setDebtDocsCount(data.totalDocumentsIndexed || 505);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingDebt(false));
  }, []);

  useEffect(() => {
    loadDebt();
  }, [loadDebt]);

  const handoverLedger = useMemo(
    () => computeConstitutionalHandoverDebtLedger(debtRows, debtDocsCount),
    [debtRows, debtDocsCount]
  );

  const rawLedger = useMemo(
    () => computeAdministrationDebtProjection(debtRows, debtDocsCount),
    [debtRows, debtDocsCount]
  );

  const displayedDebtRecords = useMemo(() => {
    if (basisMode === 'raw' && rawLedger.administrations.length > 0) {
      return rawLedger.administrations.map((a) => {
        const matchHandover = handoverLedger.records.find((h) => h.presidentId === a.presidentId);
        const pctNaira = a.startTotalNairaM > 0 ? Number(((a.netAddedNairaM / a.startTotalNairaM) * 100).toFixed(1)) : 0;
        const pctUsd = a.startTotalUsdM > 0 ? Number(((a.netAddedUsdM / a.startTotalUsdM) * 100).toFixed(1)) : 0;
        const yrs = Math.max(1, a.endYear - a.baselineYear);
        return {
          ...(matchHandover || {
            presidentId: a.presidentId as 'obasanjo' | 'yaradua' | 'jonathan' | 'buhari' | 'tinubu',
            presidentName: a.presidentName,
            party: (a.party === 'PDP' ? 'PDP' : 'APC') as 'PDP' | 'APC',
            accentColor: a.accentColor,
            portraitPath: `/presidents/${a.presidentId}.jpg`,
            initials: a.presidentName.slice(0, 2).toUpperCase(),
            tenureSpan: a.tenureSpan,
            yearsInOffice: yrs,
            cbnGovernors: [],
            waysAndMeansSecuritizedNairaM: 0,
            marketDebtAddedExclWaysAndMeansNairaM: a.netAddedNairaM,
            estimatedFxRevalNairaM: 0,
            estimatedNewNetBorrowingNairaM: a.netAddedNairaM,
            startFxRate: 0,
            endFxRate: 0,
            keyDriverHeadline: a.note,
            sourceCitation: 'Raw DMO Year-End Matrix',
          }),
          handoverWindow: `${a.baselineYear} → ${a.endYear} (Year-End)`,
          startTotalNairaM: a.startTotalNairaM,
          endTotalNairaM: a.endTotalNairaM,
          netAddedNairaM: a.netAddedNairaM,
          pctChangeNaira: pctNaira,
          startTotalUsdM: a.startTotalUsdM,
          endTotalUsdM: a.endTotalUsdM,
          netAddedUsdM: a.netAddedUsdM,
          pctChangeUsd: pctUsd,
          startExternalUsdM: a.startExternalUsdM ?? 0,
          endExternalUsdM: a.endExternalUsdM ?? 0,
          netAddedExternalUsdM: a.netAddedExternalUsdM ?? 0,
          startDomesticNairaM: a.startDomesticNairaM ?? 0,
          endDomesticNairaM: a.endDomesticNairaM ?? 0,
          netAddedDomesticNairaM: a.netAddedDomesticNairaM ?? 0,
          annualizedUsdAddedM: Math.round(a.netAddedUsdM / yrs),
          annualizedNairaAddedM: Math.round(a.netAddedNairaM / yrs),
          methodologyNote: `${a.note} (unadjusted year-end DMO annual matrix prior to handover consolidated reconciliation).`,
        };
      });
    }
    return handoverLedger.records;
  }, [basisMode, rawLedger, handoverLedger]);

  const filteredGovernors = useMemo(() => {
    const q = govSearch.trim().toLowerCase();
    const list = CBN_GOVERNORS.filter((g) => {
      if (eraFilter !== 'all' && g.era !== eraFilter) return false;
      if (efccOnly && g.efccRecord.status === 'NO_EFCC_INVESTIGATION') return false;
      if (
        presidentFilter !== 'ALL' &&
        !g.presidentIds.includes(presidentFilter as CbnGovernorProfile['presidentIds'][number])
      ) {
        return false;
      }
      if (!q) return true;
      const hay = [
        g.name,
        g.honorificTitle,
        g.headlineMandate,
        ...g.servedUnder,
        ...g.economicManagement,
        ...g.documentedCriticisms,
        g.efccRecord.badgeLabel,
        g.efccRecord.legalStatusNote,
        ...g.efccRecord.accusationScope,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
    return sortOrder === 'newest'
      ? [...list].sort((a, b) => b.order - a.order)
      : [...list].sort((a, b) => a.order - b.order);
  }, [eraFilter, efccOnly, presidentFilter, govSearch, sortOrder]);

  const efccRecordCount = useMemo(
    () => CBN_GOVERNORS.filter((g) => g.efccRecord.status !== 'NO_EFCC_INVESTIGATION').length,
    []
  );

  const debtTimelineSeries = useMemo(
    () =>
      debtRows
        .filter((r) => typeof r.totalDebtNairaM === 'number' && typeof r.totalDebtUsdM === 'number')
        .map((r) => ({
          label: String(r.financialYear),
          totalNairaT: Number(((r.totalDebtNairaM || 0) / 1e6).toFixed(2)),
          totalUsdB: Number(((r.totalDebtUsdM || 0) / 1e3).toFixed(2)),
          extUsdB: r.externalDebtUsdM ? Number((r.externalDebtUsdM / 1e3).toFixed(2)) : 0,
        })),
    [debtRows]
  );

  const debtDeltaSeries = useMemo(
    () =>
      displayedDebtRecords.map((r) => ({
        label: r.presidentName.split(' ').slice(-1)[0],
        fullName: r.presidentName,
        color: r.accentColor,
        value:
          chartMode === 'netUsd'
            ? Number((r.netAddedUsdM / 1e3).toFixed(2))
            : chartMode === 'extUsd'
            ? Number((r.netAddedExternalUsdM / 1e3).toFixed(2))
            : Number((r.netAddedNairaM / 1e6).toFixed(2)),
      })),
    [chartMode, displayedDebtRecords]
  );

  const monetaryMacroSeries = useMemo(() => {
    const out: Array<{ year: number; fx: number; cpi: number; governor: string }> = [];
    for (let yr = 1999; yr <= 2026; yr++) {
      const m = HISTORICAL_MACRO_DATA[yr];
      if (!m) continue;
      const gov =
        yr <= 2003
          ? 'J. O. Sanusi'
          : yr <= 2008
          ? 'C. Soludo'
          : yr <= 2013
          ? 'S. L. Sanusi'
          : yr <= 2022
          ? 'G. Emefiele'
          : 'O. Cardoso';
      out.push({
        year: yr,
        fx: m.fxNairaPerUsd,
        cpi: m.cpiInflationRate,
        governor: gov,
      });
    }
    return out;
  }, []);

  const latestTinubu = handoverLedger.records[handoverLedger.records.length - 1];
  const buhariRec = handoverLedger.records.find((r) => r.presidentId === 'buhari');
  const obasanjoRec = handoverLedger.records.find((r) => r.presidentId === 'obasanjo');

  const handleExport = async (fmt: 'pdf' | 'docx') => {
    try {
      setExportNotice(`Generating ${fmt.toUpperCase()} dossier...`);
      const payload = {
        governors: CBN_GOVERNORS,
        actingGovernors: CBN_ACTING_GOVERNORS,
        debtRecords: handoverLedger.records,
        latestAsAt: handoverLedger.latestAsAt,
        totalDocumentsIndexed: handoverLedger.totalDocumentsIndexed,
        permalink: buildCanonicalPermalink({ tab: 'cbn' }),
      };
      const file =
        fmt === 'pdf'
          ? await exportCbnDebtBriefPdf(payload)
          : await exportCbnDebtBriefDocx(payload);
      setExportNotice(`Saved ${file}`);
      window.setTimeout(() => setExportNotice(null), 3000);
    } catch {
      setExportNotice('Export failed.');
      window.setTimeout(() => setExportNotice(null), 3000);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', minWidth: 0, width: '100%' }}>
      {/* Editorial Hero Header */}
      <section
        style={{
          backgroundColor: '#091017',
          border: '1px solid #1e293b',
          borderRadius: '14px',
          padding: '1.35rem 1.45rem',
          color: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div style={{ maxWidth: '760px', minWidth: 0 }}>
            <div
              className="font-mono"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                color: '#10b981',
                fontSize: '0.7rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: '0.35rem',
              }}
            >
              <Landmark size={14} /> Monetary Governance &amp; Sovereign Debt Archive (1958–2026)
            </div>
            <h1 className="font-editorial" style={{ fontSize: 'clamp(1.35rem, 2.5vw, 1.8rem)', fontWeight: 600, color: '#ffffff', lineHeight: 1.2 }}>
              CBN Governors &amp; Presidential Borrowing Ledger
            </h1>
            <p style={{ fontSize: '0.82rem', color: '#94a3b8', marginTop: '0.35rem', lineHeight: 1.5 }}>
              Balanced civic dossier examining all <strong>12 substantive Central Bank Governors (1958–2026)</strong> — pairing
              documented macroeconomic reforms with official criticisms and mismanagement findings — alongside net public debt added by every Fourth Republic President.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => handleExport('pdf')}
              className="editorial-btn"
              style={{ fontSize: '0.75rem', padding: '0.45rem 0.8rem' }}
            >
              <Download size={14} /> Export Dossier (PDF)
            </button>
            <button
              type="button"
              onClick={() => handleExport('docx')}
              className="editorial-btn"
              style={{ fontSize: '0.75rem', padding: '0.45rem 0.8rem' }}
            >
              <FileSpreadsheet size={14} /> Export Dossier (DOCX)
            </button>
            {onNavigateTab && (
              <button
                type="button"
                onClick={() => onNavigateTab('compare')}
                className="editorial-btn"
                style={{
                  backgroundColor: '#0f1822',
                  color: '#e2e8f0',
                  borderColor: '#334155',
                  fontSize: '0.75rem',
                  padding: '0.45rem 0.8rem',
                }}
              >
                Budget Compare <ArrowUpRight size={13} />
              </button>
            )}
          </div>
        </div>

        {exportNotice && (
          <div className="font-mono" style={{ fontSize: '0.72rem', color: '#6ee7b7' }}>
            {exportNotice}
          </div>
        )}

        {/* Headline KPI Strip */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))',
            gap: '0.75rem',
          }}
        >
          <div style={{ backgroundColor: '#111b27', border: '1px solid #1e293b', borderRadius: '10px', padding: '0.8rem 0.95rem' }}>
            <div className="font-mono" style={{ fontSize: '0.66rem', color: '#94a3b8', textTransform: 'uppercase' }}>
              CBN Leadership Indexed
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.15rem', fontWeight: 700, color: '#10b981', marginTop: '0.2rem' }}>
              {CBN_GOVERNORS.length} Substantive Governors
            </div>
            <div style={{ fontSize: '0.7rem', color: '#cbd5e1', marginTop: '0.15rem' }}>
              1958–2026 (+{CBN_ACTING_GOVERNORS.length} Acting interregnums)
            </div>
          </div>

          <div style={{ backgroundColor: '#111b27', border: '1px solid #1e293b', borderRadius: '10px', padding: '0.8rem 0.95rem' }}>
            <div className="font-mono" style={{ fontSize: '0.66rem', color: '#94a3b8', textTransform: 'uppercase' }}>
              Live DMO Total Public Debt
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.15rem', fontWeight: 700, color: '#f59e0b', marginTop: '0.2rem' }}>
              {fmtNairaT(latestTinubu?.endTotalNairaM)} ({fmtUsdB(latestTinubu?.endTotalUsdM)})
            </div>
            <div style={{ fontSize: '0.7rem', color: '#cbd5e1', marginTop: '0.15rem' }}>
              As at {handoverLedger.latestAsAt || '2026-06-30'} · {debtDocsCount.toLocaleString('en-US')} DMO docs
            </div>
          </div>

          <div style={{ backgroundColor: '#111b27', border: '1px solid #1e293b', borderRadius: '10px', padding: '0.8rem 0.95rem' }}>
            <div className="font-mono" style={{ fontSize: '0.66rem', color: '#94a3b8', textTransform: 'uppercase' }}>
              Top Hard-Currency &amp; Ways/Means
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.15rem', fontWeight: 700, color: '#a78bfa', marginTop: '0.2rem' }}>
              Buhari: {fmtUsdB(buhariRec?.netAddedUsdM, true)}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#cbd5e1', marginTop: '0.15rem' }}>
              {fmtUsdB(buhariRec?.netAddedExternalUsdM, true)} External · +₦22.71T Ways &amp; Means
            </div>
          </div>

          <div style={{ backgroundColor: '#111b27', border: '1px solid #1e293b', borderRadius: '10px', padding: '0.8rem 0.95rem' }}>
            <div className="font-mono" style={{ fontSize: '0.66rem', color: '#94a3b8', textTransform: 'uppercase' }}>
              Largest FX Reval vs. Paris Exit
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.08rem', fontWeight: 700, color: '#fbbf24', marginTop: '0.2rem' }}>
              Tinubu {fmtNairaT(latestTinubu?.netAddedNairaM, true)} · OBJ {fmtUsdB(obasanjoRec?.netAddedExternalUsdM)}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#cbd5e1', marginTop: '0.15rem' }}>
              {fmtNairaT(latestTinubu?.estimatedFxRevalNairaM, true)} FX float effect vs. 2006 Paris Club exit
            </div>
          </div>
        </div>

        {/* Section Navigation Strip */}
        <div className="mobile-chip-scroll" style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
          {(
            [
              ['all', 'All Sections (Governors + Debt)'],
              ['debt', '1. Presidential Borrowing & Debt (5)'],
              ['governors', '2. All 12 CBN Governors (1958–2026)'],
            ] as Array<[SectionFocus, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSectionFocus(key)}
              style={{
                border: sectionFocus === key ? '1px solid #10b981' : '1px solid #334155',
                backgroundColor: sectionFocus === key ? '#10b981' : '#111b27',
                color: sectionFocus === key ? '#091017' : '#e2e8f0',
                borderRadius: '8px',
                padding: '0.42rem 0.85rem',
                fontSize: '0.76rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* ================================================================== */}
      {/* SECTION 1: PRESIDENTIAL BORROWING & PUBLIC DEBT INCREASES          */}
      {/* ================================================================== */}
      {(sectionFocus === 'all' || sectionFocus === 'debt') && (
        <section
          aria-labelledby="presidential-borrowing-heading"
          className="dossier-card"
          style={{ padding: '1.25rem 1.35rem', display: 'flex', flexDirection: 'column', gap: '1.1rem', minWidth: 0 }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                <Scale size={17} color="#059669" />
                <h2
                  id="presidential-borrowing-heading"
                  className="font-editorial"
                  style={{ margin: 0, fontSize: '1.3rem', fontWeight: 600, color: 'var(--text-primary)' }}
                >
                  Presidential Borrowing &amp; Sovereign Debt Increases (1999–2026)
                </h2>
                <InfoHint
                  term="Why Handover + USD Matters"
                  meaning="DMO annual tables excluded ₦22.71T of CBN Ways & Means overdrafts until May/June 2023, and the June 2023–2024 FX float raised the Naira carrying value of pre-existing dollar debt."
                  whyItMatters="Comparing USD net additions, External USD delta, Domestic Naira delta, Ways & Means securitization, and FX revaluation prevents misleading comparisons across currency regimes."
                />
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                Tracks how much each Fourth Republic administration increased or reduced Nigeria&apos;s Federal &amp; Sub-National public debt across official DMO handover snapshots.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => setBasisMode('handover')}
                style={{
                  padding: '0.35rem 0.65rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: basisMode === 'handover' ? '#091017' : 'var(--card-bg)',
                  color: basisMode === 'handover' ? '#ffffff' : 'var(--text-secondary)',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                }}
              >
                Constitutional Handover + Ways &amp; Means
              </button>
              <button
                type="button"
                onClick={() => setBasisMode('raw')}
                style={{
                  padding: '0.35rem 0.65rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: basisMode === 'raw' ? '#091017' : 'var(--card-bg)',
                  color: basisMode === 'raw' ? '#ffffff' : 'var(--text-secondary)',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                }}
              >
                Raw Year-End DMO Matrix
              </button>
              <button
                type="button"
                onClick={loadDebt}
                disabled={loadingDebt}
                className="editorial-btn"
                style={{ fontSize: '0.72rem', padding: '0.35rem 0.6rem' }}
              >
                <RotateCcw size={12} /> Refresh
              </button>
            </div>
          </div>

          {/* Separation Guardrail Box (Ways & Means + FX Revaluation) */}
          <div
            style={{
              backgroundColor: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: '10px',
              padding: '0.8rem 0.95rem',
              fontSize: '0.76rem',
              color: '#78350f',
              display: 'flex',
              gap: '0.6rem',
              alignItems: 'flex-start',
            }}
          >
            <AlertTriangle size={16} color="#d97706" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ lineHeight: 1.5 }}>
              <strong>Borrowing vs. Revaluation &amp; Off-Budget Printing:</strong> Under <strong>Buhari/Emefiele</strong>, official Q1 2023 debt stood at ₦49.85T because <strong>₦22.71T in CBN Ways &amp; Means overdrafts</strong> sat off-ledger until NASS securitized them in May 2023 (lifting June 2023 handover debt to <strong>₦87.38T / $113.42B</strong>). Under <strong>Tinubu/Cardoso</strong>, floating the Naira from ₦770.38 to ₦{latestTinubu?.endFxRate.toFixed(2) || '1,379.18'}/$ added <strong>~{fmtNairaT(latestTinubu?.estimatedFxRevalNairaM, true)}</strong> to inherited external stock carrying value alongside <strong>+{fmtNairaT(latestTinubu?.netAddedDomesticNairaM).replace('+', '')} domestic</strong> and <strong>{fmtUsdB(latestTinubu?.netAddedExternalUsdM, true)} new external</strong> debt.
            </div>
          </div>

          {/* Chart Metric Tabs & Responsive Chart */}
          <div style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '0.95rem' }}>
            <div className="mobile-chip-scroll" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                {(
                  [
                    ['netUsd', 'Net USD Added ($B)'],
                    ['extUsd', 'External USD Change ($B)'],
                    ['netNaira', 'Net Naira Jump (₦T)'],
                    ['timeline', '2005–2026 Debt Stock Curve'],
                  ] as Array<[DebtChartMode, string]>
                ).map(([mKey, mLabel]) => (
                  <button
                    key={mKey}
                    type="button"
                    onClick={() => setChartMode(mKey)}
                    style={{
                      padding: '0.3rem 0.65rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: chartMode === mKey ? '#059669' : '#ffffff',
                      color: chartMode === mKey ? '#ffffff' : 'var(--text-secondary)',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                    }}
                  >
                    {mLabel}
                  </button>
                ))}
              </div>
              <span className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                {chartMode === 'timeline' ? 'Annual DMO Bulletins (2005–2026)' : basisMode === 'handover' ? 'May 29 Handover Basis' : 'Year-End DMO Matrix'}
              </span>
            </div>

            <div style={{ width: '100%', height: '260px', minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                {chartMode === 'timeline' ? (
                  <ComposedChart data={debtTimelineSeries} margin={{ top: 10, right: 12, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#475569' }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#475569' }} tickFormatter={(v) => `₦${v}T`} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#0284c7' }} tickFormatter={(v) => `$${v}B`} />
                    <Tooltip
                      formatter={(val: any, name: any) => [
                        typeof val === 'number' ? val.toLocaleString('en-US') : val,
                        name,
                      ]}
                      contentStyle={{ backgroundColor: '#091017', border: 'none', borderRadius: '8px', color: '#ffffff', fontSize: '0.75rem' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '0.74rem' }} />
                    <Bar yAxisId="left" dataKey="totalNairaT" name="Total Debt (₦ Trillions)" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="totalUsdB" name="Total Debt ($ Billions)" stroke="#0284c7" strokeWidth={2.5} dot={{ r: 3 }} />
                  </ComposedChart>
                ) : (
                  <BarChart data={debtDeltaSeries} margin={{ top: 10, right: 12, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#475569' }} />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#475569' }}
                      tickFormatter={(v) => (chartMode === 'netNaira' ? `₦${v}T` : `$${v}B`)}
                    />
                    <Tooltip
                      formatter={(val: any, _name: any, item: any) => [
                        chartMode === 'netNaira'
                          ? `₦${Number(val).toLocaleString('en-US')} Trillion`
                          : `$${Number(val).toLocaleString('en-US')} Billion`,
                        item?.payload?.fullName || 'Net Change',
                      ]}
                      contentStyle={{ backgroundColor: '#091017', border: 'none', borderRadius: '8px', color: '#ffffff', fontSize: '0.75rem' }}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {debtDeltaSeries.map((entry, idx) => (
                        <Cell key={`${entry.label}-${idx}`} fill={entry.color || '#059669'} />
                      ))}
                    </Bar>
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>

          {/* 5 Presidential Borrowing Cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 305px), 1fr))',
              gap: '0.95rem',
            }}
          >
            {displayedDebtRecords.map((rec) => {
              const isReducer = rec.netAddedUsdM < 0;
              return (
                <article
                  key={rec.presidentId}
                  style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid var(--card-border)',
                    borderTop: `4px solid ${rec.accentColor}`,
                    borderRadius: '11px',
                    padding: '1rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                    minWidth: 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                    <PresidentAvatar
                      src={rec.portraitPath}
                      name={rec.presidentName}
                      initials={rec.initials}
                      accentColor={rec.accentColor}
                      party={rec.party}
                      size={56}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: '0.64rem',
                            fontWeight: 800,
                            backgroundColor: rec.party === 'PDP' ? '#dcfce7' : '#e0f2fe',
                            color: rec.party === 'PDP' ? '#15803d' : '#0369a1',
                            padding: '0.08rem 0.4rem',
                            borderRadius: '4px',
                          }}
                        >
                          {rec.party}
                        </span>
                        <span className="font-mono" style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>
                          {rec.handoverWindow}
                        </span>
                      </div>
                      <h3 style={{ margin: '0.15rem 0 0', fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                        {rec.presidentName}
                      </h3>
                      <div style={{ fontSize: '0.69rem', color: 'var(--text-secondary)', marginTop: '0.12rem' }}>
                        CBN: {rec.cbnGovernors.join(' · ')}
                      </div>
                    </div>
                  </div>

                  {/* Debt Delta Tiles */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <div style={{ backgroundColor: isReducer ? '#ecfdf5' : '#fffbeb', border: `1px solid ${isReducer ? '#a7f3d0' : '#fde68a'}`, borderRadius: '8px', padding: '0.55rem 0.65rem' }}>
                      <div className="font-mono" style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                        Net USD Change
                      </div>
                      <div className="font-mono tabular-nums" style={{ fontSize: '1rem', fontWeight: 800, color: isReducer ? '#047857' : '#b45309' }}>
                        {fmtUsdB(rec.netAddedUsdM, true)}
                      </div>
                      <div className="font-mono" style={{ fontSize: '0.66rem', color: 'var(--text-secondary)' }}>
                        {rec.pctChangeUsd >= 0 ? '+' : ''}{rec.pctChangeUsd}% ({fmtUsdB(rec.startTotalUsdM)} → {fmtUsdB(rec.endTotalUsdM)})
                      </div>
                    </div>

                    <div style={{ backgroundColor: '#f8fafc', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.55rem 0.65rem' }}>
                      <div className="font-mono" style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                        Net Naira Jump
                      </div>
                      <div className="font-mono tabular-nums" style={{ fontSize: '1rem', fontWeight: 800, color: rec.netAddedNairaM < 0 ? '#047857' : '#0f172a' }}>
                        {fmtNairaT(rec.netAddedNairaM, true)}
                      </div>
                      <div className="font-mono" style={{ fontSize: '0.66rem', color: 'var(--text-secondary)' }}>
                        {rec.pctChangeNaira >= 0 ? '+' : ''}{rec.pctChangeNaira}% ({fmtNairaT(rec.startTotalNairaM)} → {fmtNairaT(rec.endTotalNairaM)})
                      </div>
                    </div>

                    <div style={{ backgroundColor: '#f8fafc', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.5rem 0.65rem' }}>
                      <div className="font-mono" style={{ fontSize: '0.61rem', color: 'var(--text-muted)' }}>
                        External USD Delta
                      </div>
                      <div className="font-mono tabular-nums" style={{ fontSize: '0.84rem', fontWeight: 700, color: rec.netAddedExternalUsdM < 0 ? '#059669' : '#991b1b' }}>
                        {fmtUsdB(rec.netAddedExternalUsdM, true)}
                      </div>
                    </div>

                    <div style={{ backgroundColor: '#f8fafc', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.5rem 0.65rem' }}>
                      <div className="font-mono" style={{ fontSize: '0.61rem', color: 'var(--text-muted)' }}>
                        Domestic Naira Delta
                      </div>
                      <div className="font-mono tabular-nums" style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {fmtNairaT(rec.netAddedDomesticNairaM, true)}
                      </div>
                    </div>
                  </div>

                  {/* Driver & Ways & Means / FX Revaluation */}
                  <div style={{ fontSize: '0.73rem', color: 'var(--text-primary)', lineHeight: 1.48 }}>
                    <div style={{ fontWeight: 700, color: rec.accentColor, marginBottom: '0.2rem' }}>
                      {rec.keyDriverHeadline}
                    </div>
                    <p style={{ color: 'var(--text-secondary)', margin: 0 }}>{rec.methodologyNote}</p>
                    {rec.waysAndMeansSecuritizedNairaM > 0 && (
                      <div className="font-mono" style={{ marginTop: '0.35rem', fontSize: '0.68rem', color: '#7c3aed', fontWeight: 700 }}>
                        • CBN Ways &amp; Means included: +{fmtNairaT(rec.waysAndMeansSecuritizedNairaM).replace('+', '')}
                      </div>
                    )}
                    {rec.estimatedFxRevalNairaM > 1_000_000 && rec.presidentId === 'tinubu' && (
                      <div className="font-mono" style={{ marginTop: '0.35rem', fontSize: '0.68rem', color: '#b45309', fontWeight: 700 }}>
                        • Est. FX Float Revaluation on inherited external debt: +{fmtNairaT(rec.estimatedFxRevalNairaM).replace('+', '')}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.5rem', marginTop: 'auto' }}>
                    <span className="font-mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                      {rec.sourceCitation}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setEraFilter('FOURTH_REPUBLIC');
                        setPresidentFilter(rec.presidentId);
                        setSectionFocus('all');
                      }}
                      className="editorial-btn"
                      style={{ fontSize: '0.68rem', padding: '0.25rem 0.55rem' }}
                    >
                      Filter CBN Gov(s)
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Responsive Comparison Table */}
          <div>
            <div className="font-mono mobile-only-block" style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
              ← Swipe columns horizontally on small screens →
            </div>
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}>
              <table style={{ width: '100%', minWidth: '680px', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', textAlign: 'left' }}>
                    <th style={{ padding: '0.55rem 0.65rem' }}>Administration</th>
                    <th style={{ padding: '0.55rem 0.65rem' }}>Window</th>
                    <th style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>Start → End (USD)</th>
                    <th style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>Net USD</th>
                    <th style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>External USD</th>
                    <th style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>Start → End (₦)</th>
                    <th style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>Net Naira</th>
                    <th style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>Annual USD Pace</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedDebtRecords.map((r) => (
                    <tr key={r.presidentId} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '0.55rem 0.65rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {r.presidentName}
                      </td>
                      <td className="font-mono" style={{ padding: '0.55rem 0.65rem', color: 'var(--text-secondary)' }}>
                        {r.handoverWindow}
                      </td>
                      <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>
                        {fmtUsdB(r.startTotalUsdM)} → {fmtUsdB(r.endTotalUsdM)}
                      </td>
                      <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.65rem', textAlign: 'right', fontWeight: 700, color: r.netAddedUsdM < 0 ? '#059669' : '#b45309' }}>
                        {fmtUsdB(r.netAddedUsdM, true)}
                      </td>
                      <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.65rem', textAlign: 'right', fontWeight: 700, color: r.netAddedExternalUsdM < 0 ? '#059669' : '#991b1b' }}>
                        {fmtUsdB(r.netAddedExternalUsdM, true)}
                      </td>
                      <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>
                        {fmtNairaT(r.startTotalNairaM)} → {fmtNairaT(r.endTotalNairaM)}
                      </td>
                      <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.65rem', textAlign: 'right', fontWeight: 700, color: r.netAddedNairaM < 0 ? '#059669' : '#0f172a' }}>
                        {fmtNairaT(r.netAddedNairaM, true)}
                      </td>
                      <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.65rem', textAlign: 'right', color: 'var(--text-secondary)' }}>
                        {fmtUsdB(r.annualizedUsdAddedM, true)}/yr
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ================================================================== */}
      {/* SECTION 2: ALL 12 CBN GOVERNORS (1958–2026)                        */}
      {/* ================================================================== */}
      {(sectionFocus === 'all' || sectionFocus === 'governors') && (
        <section
          aria-labelledby="cbn-governors-heading"
          className="dossier-card"
          style={{ padding: '1.25rem 1.35rem', display: 'flex', flexDirection: 'column', gap: '1.1rem', minWidth: 0 }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                <TrendingUp size={17} color="#059669" />
                <h2
                  id="cbn-governors-heading"
                  className="font-editorial"
                  style={{ margin: 0, fontSize: '1.3rem', fontWeight: 600, color: 'var(--text-primary)' }}
                >
                  All 12 Central Bank of Nigeria Governors (1958–2026)
                </h2>
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                Chronological stewardship archive showing official portraits, FX/CPI/MPR indicators, economic reforms, and documented mismanagement risks or policy failures.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => setSortOrder('newest')}
                style={{
                  padding: '0.32rem 0.62rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: sortOrder === 'newest' ? '#091017' : '#ffffff',
                  color: sortOrder === 'newest' ? '#ffffff' : 'var(--text-secondary)',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                }}
              >
                Newest First
              </button>
              <button
                type="button"
                onClick={() => setSortOrder('chronological')}
                style={{
                  padding: '0.32rem 0.62rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: sortOrder === 'chronological' ? '#091017' : '#ffffff',
                  color: sortOrder === 'chronological' ? '#ffffff' : 'var(--text-secondary)',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                }}
              >
                Chronological (1958→2026)
              </button>
            </div>
          </div>

          {/* Monetary Reality Chart (1999-2026 Fourth Republic FX vs Inflation) */}
          <div style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '0.9rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.55rem' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Fourth Republic Monetary Stress Trajectory: Official CBN FX (₦/$) vs. Annual CPI Inflation (%)
              </div>
              <span className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                1999–2026 Annual CBN / NBS Baseline
              </span>
            </div>
            <div style={{ width: '100%', height: '220px', minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monetaryMacroSeries} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="year" tick={{ fontSize: 10.5, fill: '#475569' }} />
                  <YAxis yAxisId="fx" tick={{ fontSize: 10.5, fill: '#0f172a' }} tickFormatter={(v) => `₦${v}`} />
                  <YAxis yAxisId="cpi" orientation="right" tick={{ fontSize: 10.5, fill: '#dc2626' }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    formatter={(val: any, name: any, props: any) => [
                      name.includes('FX') ? `₦${Number(val).toLocaleString('en-US')}/$` : `${val}%`,
                      `${name} (${props?.payload?.governor || ''})`,
                    ]}
                    contentStyle={{ backgroundColor: '#091017', border: 'none', borderRadius: '8px', color: '#ffffff', fontSize: '0.75rem' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '0.73rem' }} />
                  <Bar yAxisId="fx" dataKey="fx" name="CBN Official FX (₦/$)" fill="#0f172a" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="cpi" type="monotone" dataKey="cpi" name="CPI Inflation (%)" stroke="#dc2626" strokeWidth={2.2} dot={{ r: 2.5 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Filter & Search Toolbar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.65rem' }}>
            <div className="mobile-chip-scroll" style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {(
                [
                  ['all', `All ${CBN_GOVERNORS.length} Governors`],
                  ['FOURTH_REPUBLIC', 'Fourth Republic (1999–2026)'],
                  ['FOUNDING_MILITARY', 'Founding & Military Era (1958–1999)'],
                ] as Array<[EraFilter, string]>
              ).map(([eKey, eLabel]) => (
                <button
                  key={eKey}
                  type="button"
                  onClick={() => {
                    setEraFilter(eKey);
                    if (eKey === 'FOUNDING_MILITARY') {
                      setPresidentFilter('ALL');
                      setEfccOnly(false);
                    }
                  }}
                  style={{
                    padding: '0.32rem 0.65rem',
                    borderRadius: '999px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: eraFilter === eKey ? '#059669' : '#ffffff',
                    color: eraFilter === eKey ? '#ffffff' : 'var(--text-secondary)',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                  }}
                >
                  {eLabel}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setEfccOnly((prev) => {
                    const next = !prev;
                    if (next && eraFilter === 'FOUNDING_MILITARY') setEraFilter('all');
                    return next;
                  });
                }}
                aria-pressed={efccOnly}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  padding: '0.32rem 0.65rem',
                  borderRadius: '999px',
                  border: efccOnly ? '1px solid #991b1b' : '1px solid #fecaca',
                  backgroundColor: efccOnly ? '#b91c1c' : '#fef2f2',
                  color: efccOnly ? '#ffffff' : '#991b1b',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                }}
              >
                <Scale size={12} /> EFCC / Probe Record ({efccRecordCount})
              </button>
              {presidentFilter !== 'ALL' && (
                <button
                  type="button"
                  onClick={() => setPresidentFilter('ALL')}
                  style={{
                    padding: '0.32rem 0.65rem',
                    borderRadius: '999px',
                    border: '1px solid #f59e0b',
                    backgroundColor: '#fffbeb',
                    color: '#b45309',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                  }}
                >
                  President: {presidentFilter} ×
                </button>
              )}
            </div>

            <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: '320px', minWidth: 0 }}>
              <Search size={14} color="#64748b" style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                value={govSearch}
                onChange={(e) => setGovSearch(e.target.value)}
                placeholder="Search governor, EFCC, Securency, Ways & Means..."
                aria-label="Search CBN Governors archive"
                style={{
                  width: '100%',
                  padding: '0.42rem 0.65rem 0.42rem 2rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  fontSize: '0.78rem',
                  color: 'var(--text-primary)',
                  backgroundColor: '#ffffff',
                }}
              />
            </div>
          </div>

          {/* Governor Cards List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {filteredGovernors.map((gov) => {
              const efccStyle = getEfccBadgeStyle(gov.efccRecord.status);
              const hasInquiryRecord = gov.efccRecord.status !== 'NO_EFCC_INVESTIGATION';
              return (
              <article
                key={gov.id}
                style={{
                  backgroundColor: '#ffffff',
                  border: '1px solid var(--card-border)',
                  borderLeft: `4px solid ${gov.accentColor}`,
                  borderRadius: '11px',
                  padding: '1.05rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.85rem',
                  minWidth: 0,
                }}
              >
                {/* Header Row: Official Portrait + Meta */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', flexWrap: 'wrap', minWidth: 0 }}>
                  <PresidentAvatar
                    src={gov.portraitPath}
                    name={gov.name}
                    initials={gov.initials}
                    accentColor={gov.accentColor}
                    size={72}
                  />

                  <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <span
                        className="font-mono"
                        style={{
                          fontSize: '0.66rem',
                          fontWeight: 800,
                          backgroundColor: '#091017',
                          color: '#ffffff',
                          padding: '0.1rem 0.45rem',
                          borderRadius: '4px',
                        }}
                      >
                        #{gov.order} of 12
                      </span>
                      <span
                        className="editorial-pill"
                        style={{
                          fontSize: '0.67rem',
                          backgroundColor: gov.era === 'FOURTH_REPUBLIC' ? '#ecfdf5' : '#f1f5f9',
                          color: gov.era === 'FOURTH_REPUBLIC' ? '#047857' : '#475569',
                          borderColor: gov.era === 'FOURTH_REPUBLIC' ? '#a7f3d0' : '#cbd5e1',
                        }}
                      >
                        {gov.era === 'FOURTH_REPUBLIC' ? 'Fourth Republic' : '1958–1999 Era'}
                      </span>
                      <span
                        className="editorial-pill"
                        style={{
                          fontSize: '0.66rem',
                          fontWeight: 700,
                          backgroundColor: efccStyle.bg,
                          color: efccStyle.color,
                          borderColor: efccStyle.border,
                        }}
                      >
                        {gov.efccRecord.badgeLabel}
                      </span>
                      <span className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                        {gov.tenureLabel}
                      </span>
                    </div>

                    <h3 style={{ margin: '0.25rem 0 0.1rem', fontSize: '1.08rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                      {gov.name} — <span style={{ fontWeight: 600, color: gov.accentColor, fontSize: '0.92rem' }}>{gov.honorificTitle}</span>
                    </h3>

                    <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                      Served under: <strong>{gov.servedUnder.join(', ')}</strong> · Portrait source: {gov.photoSource}
                    </div>
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-primary)', marginTop: '0.2rem', fontWeight: 500 }}>
                      {gov.headlineMandate}
                    </div>
                  </div>
                </div>

                {/* Macro Indicators Strip */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
                    gap: '0.5rem',
                  }}
                >
                  <div style={{ backgroundColor: '#f8fafc', border: '1px solid var(--border-subtle)', borderRadius: '7px', padding: '0.5rem 0.65rem' }}>
                    <div className="font-mono" style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>FX Trajectory</div>
                    <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.12rem' }}>{gov.macroIndicators.fxStartToEnd}</div>
                  </div>
                  <div style={{ backgroundColor: '#f8fafc', border: '1px solid var(--border-subtle)', borderRadius: '7px', padding: '0.5rem 0.65rem' }}>
                    <div className="font-mono" style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>CPI Inflation Range</div>
                    <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.12rem' }}>{gov.macroIndicators.inflationRange}</div>
                  </div>
                  <div style={{ backgroundColor: '#f8fafc', border: '1px solid var(--border-subtle)', borderRadius: '7px', padding: '0.5rem 0.65rem' }}>
                    <div className="font-mono" style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Policy Rate / MPR</div>
                    <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.12rem' }}>{gov.macroIndicators.policyRateHighlight}</div>
                  </div>
                  <div style={{ backgroundColor: '#f8fafc', border: '1px solid var(--border-subtle)', borderRadius: '7px', padding: '0.5rem 0.65rem' }}>
                    <div className="font-mono" style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Reserves &amp; Deficit Financing</div>
                    <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.12rem' }}>
                      {gov.macroIndicators.reservesHighlight} · {gov.macroIndicators.waysAndMeansNote}
                    </div>
                  </div>
                </div>

                {/* Balanced 2-Column Management vs. Documented Criticisms */}
                <div className="grid-2-cols">
                  <div
                    style={{
                      backgroundColor: '#ecfdf5',
                      border: '1px solid #a7f3d0',
                      borderRadius: '9px',
                      padding: '0.8rem 0.9rem',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        fontSize: '0.74rem',
                        fontWeight: 800,
                        color: '#047857',
                        textTransform: 'uppercase',
                        marginBottom: '0.45rem',
                      }}
                    >
                      <CheckCircle2 size={14} /> Economic Management &amp; Documented Reforms
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.76rem', color: '#064e3b', lineHeight: 1.48 }}>
                      {gov.economicManagement.map((pt, i) => (
                        <li key={i}>{pt}</li>
                      ))}
                    </ul>
                  </div>

                  <div
                    style={{
                      backgroundColor: '#fef2f2',
                      border: '1px solid #fecaca',
                      borderRadius: '9px',
                      padding: '0.8rem 0.9rem',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        fontSize: '0.74rem',
                        fontWeight: 800,
                        color: '#991b1b',
                        textTransform: 'uppercase',
                        marginBottom: '0.45rem',
                      }}
                    >
                      <ShieldAlert size={14} /> Documented Criticisms &amp; Mismanagement Risks
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.76rem', color: '#7f1d1d', lineHeight: 1.48 }}>
                      {gov.documentedCriticisms.map((pt, i) => (
                        <li key={i}>{pt}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* EFCC & Anti-Graft Investigation Record */}
                {hasInquiryRecord ? (
                  <div
                    style={{
                      backgroundColor: efccStyle.bg,
                      border: `1px solid ${efccStyle.border}`,
                      borderRadius: '9px',
                      padding: '0.8rem 0.95rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.45rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          fontSize: '0.74rem',
                          fontWeight: 800,
                          color: efccStyle.color,
                          textTransform: 'uppercase',
                        }}
                      >
                        <Scale size={14} /> EFCC &amp; Anti-Graft Investigation Record
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                        {gov.efccRecord.period && (
                          <span className="font-mono" style={{ fontSize: '0.67rem', fontWeight: 700, color: efccStyle.headingColor }}>
                            {gov.efccRecord.period}
                          </span>
                        )}
                        <span
                          className="editorial-pill"
                          style={{
                            fontSize: '0.66rem',
                            fontWeight: 700,
                            backgroundColor: '#ffffff',
                            color: efccStyle.color,
                            borderColor: efccStyle.border,
                          }}
                        >
                          {gov.efccRecord.badgeLabel}
                        </span>
                      </div>
                    </div>

                    <p style={{ margin: 0, fontSize: '0.76rem', color: efccStyle.headingColor, lineHeight: 1.48, fontWeight: 500 }}>
                      {gov.efccRecord.legalStatusNote}
                    </p>

                    {gov.efccRecord.accusationScope.length > 0 && (
                      <div style={{ marginTop: '0.1rem' }}>
                        <div style={{ fontSize: '0.71rem', fontWeight: 800, color: efccStyle.color, textTransform: 'uppercase', marginBottom: '0.28rem' }}>
                          Scope of Accusations / Inquiry
                        </div>
                        <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.32rem', fontSize: '0.75rem', color: efccStyle.headingColor, lineHeight: 1.48 }}>
                          {gov.efccRecord.accusationScope.map((scopePt, idx) => (
                            <li key={idx}>{scopePt}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div style={{ fontSize: '0.68rem', color: efccStyle.color, borderTop: `1px dashed ${efccStyle.border}`, paddingTop: '0.35rem', marginTop: '0.1rem' }}>
                      <strong>Attribution:</strong> {gov.efccRecord.sources.join(' · ')}. Allegations reflect formal charges or official briefings and do not constitute criminal convictions unless entered by a court of competent jurisdiction.
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      backgroundColor: '#f8fafc',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      padding: '0.55rem 0.8rem',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.5rem',
                      fontSize: '0.73rem',
                      color: 'var(--text-secondary)',
                      lineHeight: 1.45,
                    }}
                  >
                    <Scale size={14} color="#64748b" style={{ flexShrink: 0, marginTop: '0.15rem' }} />
                    <div>
                      <strong style={{ color: '#334155' }}>{gov.efccRecord.badgeLabel}:</strong>{' '}
                      {gov.efccRecord.legalStatusNote}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', fontSize: '0.69rem', color: 'var(--text-muted)' }}>
                  <span className="font-mono">Sources: {gov.sources.join(' · ')}</span>
                  {gov.startYear >= 1999 && onSelectYear && (
                    <button
                      type="button"
                      onClick={() => onSelectYear(gov.endYear ? Math.min(gov.endYear, 2026) : 2026)}
                      className="editorial-btn"
                      style={{ fontSize: '0.68rem', padding: '0.24rem 0.55rem' }}
                    >
                      Inspect FY {gov.endYear ? Math.min(gov.endYear, 2026) : 2026} Budget <ArrowUpRight size={11} />
                    </button>
                  )}
                </div>
              </article>
              );
            })}

            {filteredGovernors.length === 0 && (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                No CBN Governors matched your current filter. Clear search or reset era filter above.
              </div>
            )}
          </div>

          {/* Acting Governor Interregnums */}
          <div style={{ backgroundColor: '#f8fafc', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '0.95rem' }}>
            <div className="font-mono" style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.55rem' }}>
              Acting CBN Governor Interregnums (Substantive Transition Bridges)
            </div>
            <div className="grid-2-cols">
              {CBN_ACTING_GOVERNORS.map((act) => (
                <div key={act.id} style={{ backgroundColor: '#ffffff', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.7rem 0.85rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.84rem', color: 'var(--text-primary)' }}>{act.name}</span>
                    <span className="font-mono" style={{ fontSize: '0.68rem', color: '#059669', fontWeight: 700 }}>{act.tenureLabel}</span>
                  </div>
                  <p style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', margin: '0.3rem 0 0.25rem' }}>{act.context}</p>
                  <p style={{ fontSize: '0.73rem', color: 'var(--text-primary)', margin: 0 }}><strong>Key Action:</strong> {act.keyAction}</p>
                  {act.efccOrScrutinyNote && (
                    <p style={{ fontSize: '0.71rem', color: '#475569', margin: '0.3rem 0 0' }}>
                      <strong>Anti-Graft / Review Note:</strong> {act.efccOrScrutinyNote}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
