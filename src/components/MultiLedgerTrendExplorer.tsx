import React, { useEffect, useMemo, useState } from 'react';
import { datasetUrl } from '../services/apiClient';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Download,
  ExternalLink,
  FileSpreadsheet,
  Layers,
  Scale,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import type { DmoYearRow } from '../utils/administrationDebt';
import {
  exportTabularDossierDocx,
  exportTabularDossierPdf,
} from '../utils/documentExporter';
import {
  loadEvidenceEngineAllYears,
  type EvidenceEngineAllYearsPayload,
} from '../utils/evidenceEngineV3';
import {
  loadMacroCredibilityTracker,
  type MacroCredibilityTrackerPayload,
} from '../utils/mdaScorecard';
import {
  buildMultiLedgerYearSeries,
  type MultiLedgerTrendPoint,
  type OaugfDocumentMeta,
} from '../utils/multiLedgerTrends';
import { buildCanonicalPermalink } from '../utils/urlState';

interface MultiLedgerTrendExplorerProps {
  onSelectYear?: (year: number) => void;
}

interface OaugfIndexSlice {
  headline?: {
    reportsIndexed?: number;
    parsedAuditIssuesCount?: number;
    repeatNeglectCount?: number;
    recoveryDirectiveCount?: number;
  };
  documents?: OaugfDocumentMeta[];
}

export const MultiLedgerTrendExplorer: React.FC<MultiLedgerTrendExplorerProps> = ({
  onSelectYear,
}) => {
  const [debtRows, setDebtRows] = useState<DmoYearRow[]>([]);
  const [macroCredibility, setMacroCredibility] = useState<MacroCredibilityTrackerPayload | null>(null);
  const [evidenceAllYears, setEvidenceAllYears] = useState<EvidenceEngineAllYearsPayload | null>(null);
  const [oaugfData, setOaugfData] = useState<OaugfIndexSlice | null>(null);
  const [loading, setLoading] = useState(true);

  const [rangeMode, setRangeMode] = useState<'all' | 'bir' | 'modern'>('all');
  const [debtUnit, setDebtUnit] = useState<'naira' | 'usd'>('naira');
  const [showEnacted, setShowEnacted] = useState(true);
  const [showDebt, setShowDebt] = useState(true);
  const [showEeFlagged, setShowEeFlagged] = useState(true);
  const [showBirExec, setShowBirExec] = useState(true);
  const [showOaugf, setShowOaugf] = useState(true);
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      fetch(datasetUrl('/datasets/debt_profile.json'), { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      loadMacroCredibilityTracker().catch(() => null),
      loadEvidenceEngineAllYears().catch(() => null),
      fetch(datasetUrl('/datasets/oaugf_audit_index.json'), { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([debtRes, mcRes, eeRes, oaugfRes]) => {
        if (!active) return;
        setDebtRows(Array.isArray(debtRes?.yearlyDebt) ? debtRes.yearlyDebt : []);
        setMacroCredibility(mcRes);
        setEvidenceAllYears(eeRes);
        setOaugfData(oaugfRes);
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const fullSeries = useMemo(
    () =>
      buildMultiLedgerYearSeries({
        debtRows,
        macroCredibility,
        evidenceAllYears,
        oaugfDocuments: oaugfData?.documents || [],
        startYear: 1999,
        endYear: 2026,
      }),
    [debtRows, macroCredibility, evidenceAllYears, oaugfData]
  );

  const visibleSeries = useMemo<MultiLedgerTrendPoint[]>(() => {
    const minY = rangeMode === 'modern' ? 2015 : rangeMode === 'bir' ? 2009 : 1999;
    return fullSeries.filter((p) => p.year >= minY);
  }, [fullSeries, rangeMode]);

  const latestDebtPoint = useMemo(() => {
    for (let i = fullSeries.length - 1; i >= 0; i--) {
      if (fullSeries[i].dmoDebtTn !== null) return fullSeries[i];
    }
    return null;
  }, [fullSeries]);

  const firstPoint = visibleSeries[0] || fullSeries[0];
  const lastPoint = visibleSeries[visibleSeries.length - 1] || fullSeries[fullSeries.length - 1];

  const handleExportMultiLedger = async (format: 'pdf' | 'docx') => {
    if (exportingFormat || visibleSeries.length === 0) return;
    setExportingFormat(format);
    try {
      const startY = visibleSeries[0]?.year || 1999;
      const endY = visibleSeries[visibleSeries.length - 1]?.year || 2026;
      const spec = {
        filenameBase: `BudgetLens_28Yr_MultiLedger_Trends_${startY}_${endY}`,
        eyebrow: `BUDGETLENS 6-LEDGER HISTORICAL OBSERVATORY · FY ${startY}–${endY}`,
        title: `Multi-Ledger Fiscal, Debt, Execution & Audit Trajectory (${startY}–${endY})`,
        subtitle:
          'Unites Enacted Federal Budgets, DMO Sovereign Debt, BIR Capital vs Debt-Service Execution, Evidence Engine v3.0 Flags, and OAuGF Constitutional Audit Queries.',
        orientation: 'landscape' as const,
        metadata: [
          { label: 'Window Covered', value: `${startY}–${endY} (${visibleSeries.length} Fiscal Years)` },
          {
            label: 'Evidence Engine v3.0',
            value: `${(evidenceAllYears?.summary?.totalRuleFindings ?? 49679).toLocaleString()} findings (${evidenceAllYears?.summary?.totalRulesCount ?? 22} rules)`,
          },
          {
            label: 'OAuGF Audits',
            value: `${(oaugfData?.headline?.parsedAuditIssuesCount ?? 7028).toLocaleString()} queries across ${oaugfData?.headline?.reportsIndexed ?? 36} reports`,
          },
        ],
        kpis: [
          {
            label: `Enacted Envelope (${endY})`,
            value: lastPoint ? `₦${lastPoint.enactedBudgetTn.toFixed(2)}T` : 'N/A',
            subtext: firstPoint ? `Up from ₦${firstPoint.enactedBudgetTn.toFixed(2)}T in ${firstPoint.year}` : undefined,
          },
          {
            label: 'Latest DMO Debt Stock',
            value: latestDebtPoint?.dmoDebtTn ? `₦${latestDebtPoint.dmoDebtTn.toFixed(2)}T` : 'N/A',
            subtext: latestDebtPoint?.dmoDebtUsdBn ? `$${latestDebtPoint.dmoDebtUsdBn.toFixed(2)}B (FY ${latestDebtPoint.year})` : undefined,
          },
          {
            label: 'Mean BIR Cap / Debt Svc',
            value: macroCredibility
              ? `${macroCredibility.headline.meanCapitalPerformancePct?.toFixed(1) ?? 'N/A'}% / ${macroCredibility.headline.meanDebtServicePerformancePct?.toFixed(1) ?? 'N/A'}%`
              : 'N/A',
            subtext: macroCredibility
              ? `Debt overrun in ${macroCredibility.headline.debtServiceOverrunYearsCount}/${macroCredibility.headline.birYearsCount} BIR yrs`
              : undefined,
          },
          {
            label: 'OAuGF Audit Queries',
            value: (oaugfData?.headline?.parsedAuditIssuesCount ?? 7028).toLocaleString(),
            subtext: `${oaugfData?.headline?.recoveryDirectiveCount ?? 675} recoveries · ${oaugfData?.headline?.repeatNeglectCount ?? 54} repeat`,
          },
        ],
        narrative:
          'Missing historical sub-ledger intervals (Pre-2005 DMO stock, Pre-2009 BIR execution, and unaudited OAuGF report years) are marked N/A rather than coerced to zero. Each layer represents a distinct constitutional accountability stage.',
        tables: [
          {
            heading: `Yearly Cross-Ledger Fiscal Trajectory (${startY}–${endY})`,
            columns: [
              'FY',
              'President',
              'Enacted (NGN T)',
              'DMO Debt (NGN T / $B)',
              'BIR Cap %',
              'BIR Debt Svc %',
              'EE v3 Flagged (NGN T)',
              'EE v3 Hits',
              'OAuGF Queries',
            ],
            rows: visibleSeries.map((r) => [
              String(r.year),
              r.shortName,
              `NGN ${r.enactedBudgetTn.toFixed(2)}T`,
              r.dmoDebtTn !== null
                ? `NGN ${r.dmoDebtTn.toFixed(2)}T ($${(r.dmoDebtUsdBn ?? 0).toFixed(1)}B)`
                : 'N/A (Pre-2005)',
              r.birCapitalExecPct !== null
                ? `${r.birCapitalExecPct.toFixed(1)}%${r.birIsPartialYear ? '*' : ''}`
                : 'N/A',
              r.birDebtServiceExecPct !== null
                ? `${r.birDebtServiceExecPct.toFixed(1)}%${r.birDebtOverrun ? ' (!)' : ''}`
                : 'N/A',
              `NGN ${r.eeFlaggedSpendTn.toFixed(2)}T`,
              r.eeRuleFindingsCount.toLocaleString(),
              r.oaugfFindingsCount !== null ? r.oaugfFindingsCount.toLocaleString() : 'No Report',
            ]),
            rightAlignColumns: [0, 2, 3, 4, 5, 6, 7, 8],
          },
        ],
        permalink: buildCanonicalPermalink({ tab: 'trends' }),
        footnote:
          'Sources: FGN Enacted Appropriation Acts (1999–2026), Debt Management Office (DMO), Budget Office BIRs (2009–2026), OAuGF Reports (1999–2024), and Evidence Engine v3.0.',
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

  const overlayButtons: Array<{
    key: string;
    label: string;
    active: boolean;
    onToggle: () => void;
    color: string;
  }> = [
    {
      key: 'enacted',
      label: 'Enacted Budget (₦T)',
      active: showEnacted,
      onToggle: () => setShowEnacted((v) => !v),
      color: '#059669',
    },
    {
      key: 'debt',
      label: `DMO Sovereign Debt (${debtUnit === 'naira' ? '₦T' : '$B'})`,
      active: showDebt,
      onToggle: () => setShowDebt((v) => !v),
      color: '#d97706',
    },
    {
      key: 'eeFlagged',
      label: 'Evidence Engine v3 Flagged (₦T)',
      active: showEeFlagged,
      onToggle: () => setShowEeFlagged((v) => !v),
      color: '#dc2626',
    },
    {
      key: 'birExec',
      label: 'BIR Capital vs Debt Svc Exec (%)',
      active: showBirExec,
      onToggle: () => setShowBirExec((v) => !v),
      color: '#0284c7',
    },
    {
      key: 'oaugf',
      label: 'OAuGF Audit Findings / Yr',
      active: showOaugf,
      onToggle: () => setShowOaugf((v) => !v),
      color: '#7c3aed',
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
      {/* Header & Controls Card */}
      <div className="dossier-card" style={{ padding: '1.25rem 1.4rem', display: 'flex', flexDirection: 'column', gap: '0.95rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.85rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
              <Layers size={15} color="#059669" />
              <span className="font-mono" style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#059669' }}>
                28-Year Multi-Ledger Trajectory Explorer (1999–2026)
              </span>
            </div>
            <h3 className="font-editorial" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: '#0f172a' }}>
              Appropriations, Sovereign Debt, Execution Credibility &amp; Constitutional Audits
            </h3>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Toggle independent federal accountability overlays across the Fourth Republic. Pre-2005 DMO, pre-2009 BIR, and unaudited OAuGF intervals remain explicitly marked N/A.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={loading || exportingFormat !== null}
              onClick={() => handleExportMultiLedger('pdf')}
              className="editorial-btn-primary"
              style={{ fontSize: '0.74rem' }}
            >
              <Download size={13} /> Export 28-Year PDF
            </button>
            <button
              type="button"
              disabled={loading || exportingFormat !== null}
              onClick={() => handleExportMultiLedger('docx')}
              className="editorial-btn"
              style={{ fontSize: '0.74rem' }}
            >
              <FileSpreadsheet size={13} /> DOCX
            </button>
          </div>
        </div>

        {/* Range + Unit + Overlay Toggles */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', alignItems: 'center', justifyContent: 'space-between', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {(
              [
                ['all', '1999–2026 (28 Yrs)'],
                ['bir', '2009–2026 (BIR Era)'],
                ['modern', '2015–2026 (Modern)'],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setRangeMode(k)}
                className="font-mono"
                style={{
                  fontSize: '0.71rem',
                  fontWeight: 700,
                  padding: '0.32rem 0.65rem',
                  borderRadius: '6px',
                  border: `1px solid ${rangeMode === k ? '#0f172a' : '#cbd5e1'}`,
                  backgroundColor: rangeMode === k ? '#0f172a' : '#ffffff',
                  color: rangeMode === k ? '#ffffff' : '#475569',
                  cursor: 'pointer',
                }}
              >
                {lbl}
              </button>
            ))}

            <div style={{ width: '1px', height: '20px', backgroundColor: '#cbd5e1', margin: '0 0.2rem' }} />

            <button
              type="button"
              onClick={() => setDebtUnit('naira')}
              className="font-mono"
              style={{
                fontSize: '0.71rem',
                fontWeight: 700,
                padding: '0.32rem 0.6rem',
                borderRadius: '6px',
                border: `1px solid ${debtUnit === 'naira' ? '#d97706' : '#cbd5e1'}`,
                backgroundColor: debtUnit === 'naira' ? '#fffbeb' : '#ffffff',
                color: debtUnit === 'naira' ? '#92400e' : '#475569',
                cursor: 'pointer',
              }}
            >
              Debt: ₦T
            </button>
            <button
              type="button"
              onClick={() => setDebtUnit('usd')}
              className="font-mono"
              style={{
                fontSize: '0.71rem',
                fontWeight: 700,
                padding: '0.32rem 0.6rem',
                borderRadius: '6px',
                border: `1px solid ${debtUnit === 'usd' ? '#d97706' : '#cbd5e1'}`,
                backgroundColor: debtUnit === 'usd' ? '#fffbeb' : '#ffffff',
                color: debtUnit === 'usd' ? '#92400e' : '#475569',
                cursor: 'pointer',
              }}
            >
              Debt: USD $B
            </button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.38rem' }}>
            {overlayButtons.map((btn) => (
              <button
                key={btn.key}
                type="button"
                onClick={btn.onToggle}
                className="font-mono"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '0.69rem',
                  fontWeight: 700,
                  padding: '0.28rem 0.6rem',
                  borderRadius: '999px',
                  border: `1px solid ${btn.active ? btn.color : '#cbd5e1'}`,
                  backgroundColor: btn.active ? btn.color : '#f8fafc',
                  color: btn.active ? '#ffffff' : '#64748b',
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '999px',
                    backgroundColor: btn.active ? '#ffffff' : btn.color,
                  }}
                />
                {btn.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 4-Card 28-Year Multi-Ledger Headline Strip */}
      <div className="grid-4-cols">
        <div className="dossier-card" style={{ padding: '0.95rem 1.1rem' }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <TrendingUp size={12} color="#059669" /> Enacted Budget Envelope
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#059669', marginTop: '0.18rem' }}>
            ₦{firstPoint?.enactedBudgetTn.toFixed(2)}T &rarr; ₦{lastPoint?.enactedBudgetTn.toFixed(2)}T
          </div>
          <div className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
            {visibleSeries.length} fiscal cycles ({firstPoint?.year}–{lastPoint?.year})
          </div>
        </div>

        <div className="dossier-card" style={{ padding: '0.95rem 1.1rem' }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Scale size={12} color="#d97706" /> DMO Sovereign Debt Stock
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#b45309', marginTop: '0.18rem' }}>
            {latestDebtPoint?.dmoDebtTn ? `₦${latestDebtPoint.dmoDebtTn.toFixed(2)}T` : 'N/A'}
            {latestDebtPoint?.dmoDebtUsdBn ? ` ($${latestDebtPoint.dmoDebtUsdBn.toFixed(1)}B)` : ''}
          </div>
          <div className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
            Live DMO series (2005–{latestDebtPoint?.year || 2026})
          </div>
        </div>

        <div className="dossier-card" style={{ padding: '0.95rem 1.1rem' }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
            BIR Capital vs. Debt Service
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a', marginTop: '0.18rem' }}>
            {macroCredibility?.headline.meanCapitalPerformancePct?.toFixed(1) ?? 'N/A'}% vs{' '}
            <span style={{ color: '#b91c1c' }}>
              {macroCredibility?.headline.meanDebtServicePerformancePct?.toFixed(1) ?? 'N/A'}%
            </span>
          </div>
          <div className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
            {macroCredibility?.headline.debtServiceOverrunYearsCount ?? 11} overrun yrs (2009–2026)
          </div>
        </div>

        <div className="dossier-card" style={{ padding: '0.95rem 1.1rem' }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <ShieldAlert size={12} color="#b91c1c" /> EE v3 &amp; OAuGF Oversight
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#991b1b', marginTop: '0.18rem' }}>
            {(evidenceAllYears?.summary?.totalRuleFindings ?? 49679).toLocaleString()} /{' '}
            {(oaugfData?.headline?.parsedAuditIssuesCount ?? 7028).toLocaleString()}
          </div>
          <div className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
            EE v3 hits ({evidenceAllYears?.summary?.totalRulesCount ?? 22} rules) · OAuGF queries
          </div>
        </div>
      </div>

      {/* Chart 1: Monetary Trajectory Overlay */}
      {(showEnacted || showDebt || showEeFlagged) && (
        <div className="dossier-card" style={{ padding: '1.15rem 1.25rem' }}>
          <h4 style={{ margin: '0 0 0.25rem', fontSize: '0.95rem', fontWeight: 700, color: '#0f172a' }}>
            Monetary Scale Overlay: Enacted Budgets, Sovereign Debt &amp; Evidence Engine v3.0 Flagged Spend
          </h4>
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.73rem', color: 'var(--text-muted)' }}>
            Left axis displays ₦ Trillions{debtUnit === 'usd' && showDebt ? '; right axis displays DMO Total Debt Stock ($ Billions)' : ''}. Click any bar/point to inspect yearly data below.
          </p>
          <div style={{ width: '100%', height: '285px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={visibleSeries} margin={{ top: 10, right: 16, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#475569' }} />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 11, fill: '#475569' }}
                  tickFormatter={(v) => `₦${v}T`}
                />
                {debtUnit === 'usd' && showDebt && (
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 11, fill: '#b45309' }}
                    tickFormatter={(v) => `$${v}B`}
                  />
                )}
                <Tooltip
                  formatter={(val: any, name: any) => {
                    if (val === null || val === undefined) return ['N/A', name];
                    if (String(name).includes('USD')) return [`$${Number(val).toFixed(2)}B`, name];
                    return [`₦${Number(val).toFixed(2)}T`, name];
                  }}
                  labelFormatter={(yr) => `Financial Year ${yr}`}
                  contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '0.75rem' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                {showEeFlagged && (
                  <Bar
                    yAxisId="left"
                    dataKey="eeFlaggedSpendTn"
                    name="Evidence Engine v3 Flagged (₦T)"
                    fill="#dc2626"
                    opacity={0.78}
                    radius={[3, 3, 0, 0]}
                  />
                )}
                {showEnacted && (
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="enactedBudgetTn"
                    name="Enacted Budget Envelope (₦T)"
                    stroke="#059669"
                    strokeWidth={2.5}
                    dot={{ r: 3.5 }}
                  />
                )}
                {showDebt && (
                  <Line
                    yAxisId={debtUnit === 'usd' ? 'right' : 'left'}
                    type="monotone"
                    dataKey={debtUnit === 'usd' ? 'dmoDebtUsdBn' : 'dmoDebtTn'}
                    name={debtUnit === 'usd' ? 'DMO Sovereign Debt (USD $B)' : 'DMO Sovereign Debt (₦T)'}
                    stroke="#d97706"
                    strokeWidth={2.4}
                    connectNulls={false}
                    dot={{ r: 3.5 }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Chart 2: BIR Execution & OAuGF Oversight Overlay */}
      {(showBirExec || showOaugf) && (
        <div className="dossier-card" style={{ padding: '1.15rem 1.25rem' }}>
          <h4 style={{ margin: '0 0 0.25rem', fontSize: '0.95rem', fontWeight: 700, color: '#0f172a' }}>
            Accountability &amp; Execution Overlay: BIR Capital vs. Debt-Service Execution (%) &amp; OAuGF Queries
          </h4>
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.73rem', color: 'var(--text-muted)' }}>
            Left axis tracks Budget Implementation Report execution percentages against the 100% Appropriation ceiling (2009–2026); right axis tracks indexed OAuGF audit queries per report year.
          </p>
          <div style={{ width: '100%', height: '270px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={visibleSeries} margin={{ top: 10, right: 16, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#475569' }} />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 11, fill: '#475569' }}
                  tickFormatter={(v) => `${v}%`}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 11, fill: '#7c3aed' }}
                />
                <Tooltip
                  formatter={(val: any, name: any) => {
                    if (val === null || val === undefined) return ['N/A', name];
                    if (String(name).includes('%')) return [`${Number(val).toFixed(1)}%`, name];
                    return [`${Number(val).toLocaleString()} queries`, name];
                  }}
                  labelFormatter={(yr) => `Financial Year ${yr}`}
                  contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '0.75rem' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                {showBirExec && (
                  <ReferenceLine
                    yAxisId="left"
                    y={100}
                    stroke="#94a3b8"
                    strokeDasharray="4 4"
                    label={{ value: '100% Budget Ceiling', position: 'insideTopRight', fontSize: 10, fill: '#64748b' }}
                  />
                )}
                {showOaugf && (
                  <Bar
                    yAxisId="right"
                    dataKey="oaugfFindingsCount"
                    name="OAuGF Audit Queries (Report Year)"
                    fill="#7c3aed"
                    opacity={0.72}
                    radius={[3, 3, 0, 0]}
                  />
                )}
                {showBirExec && (
                  <>
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="birCapitalExecPct"
                      name="BIR Capital Execution (%)"
                      stroke="#059669"
                      strokeWidth={2.4}
                      connectNulls={false}
                      dot={{ r: 3.5 }}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="birDebtServiceExecPct"
                      name="BIR Debt Service Execution (%)"
                      stroke="#b91c1c"
                      strokeWidth={2.4}
                      connectNulls={false}
                      dot={{ r: 3.5 }}
                    />
                  </>
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Yearly Multi-Ledger Data Table */}
      <div className="dossier-card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '0.85rem 1.15rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700, color: '#0f172a' }}>
            28-Year Multi-Ledger Fiscal Ledger ({firstPoint?.year}–{lastPoint?.year})
          </h4>
          <span className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
            * Indicates YTD partial-year BIR report
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                <th style={{ padding: '0.52rem 0.7rem' }}>FY</th>
                <th style={{ padding: '0.52rem 0.7rem' }}>Administration</th>
                <th style={{ padding: '0.52rem 0.7rem', textAlign: 'right' }}>Enacted Budget</th>
                <th style={{ padding: '0.52rem 0.7rem', textAlign: 'right' }}>DMO Sovereign Debt</th>
                <th style={{ padding: '0.52rem 0.7rem', textAlign: 'right' }}>BIR Capital %</th>
                <th style={{ padding: '0.52rem 0.7rem', textAlign: 'right' }}>BIR Debt Svc %</th>
                <th style={{ padding: '0.52rem 0.7rem', textAlign: 'right' }}>EE v3 Flagged</th>
                <th style={{ padding: '0.52rem 0.7rem', textAlign: 'right' }}>OAuGF Queries</th>
              </tr>
            </thead>
            <tbody>
              {visibleSeries.map((r) => (
                <tr key={r.year} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '0.46rem 0.7rem', whiteSpace: 'nowrap' }}>
                    {onSelectYear ? (
                      <button
                        type="button"
                        onClick={() => onSelectYear(r.year)}
                        className="font-mono"
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          fontWeight: 700,
                          color: '#059669',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                        }}
                        title={`Inspect FY ${r.year} Overview`}
                      >
                        {r.year} <ExternalLink size={10} />
                      </button>
                    ) : (
                      <span className="font-mono" style={{ fontWeight: 700 }}>{r.year}</span>
                    )}
                  </td>
                  <td style={{ padding: '0.46rem 0.7rem', fontWeight: 600 }}>
                    {r.presidentName}
                  </td>
                  <td className="font-mono tabular-nums" style={{ padding: '0.46rem 0.7rem', textAlign: 'right', fontWeight: 600 }}>
                    ₦{r.enactedBudgetTn.toFixed(2)}T
                  </td>
                  <td className="font-mono tabular-nums" style={{ padding: '0.46rem 0.7rem', textAlign: 'right' }}>
                    {r.dmoDebtTn !== null
                      ? debtUnit === 'usd' && r.dmoDebtUsdBn !== null
                        ? `$${r.dmoDebtUsdBn.toFixed(2)}B`
                        : `₦${r.dmoDebtTn.toFixed(2)}T`
                      : <span style={{ color: '#94a3b8' }}>N/A (Pre-2005)</span>}
                  </td>
                  <td className="font-mono tabular-nums" style={{ padding: '0.46rem 0.7rem', textAlign: 'right', color: '#047857', fontWeight: 600 }}>
                    {r.birCapitalExecPct !== null
                      ? `${r.birCapitalExecPct.toFixed(1)}%${r.birIsPartialYear ? '*' : ''}`
                      : <span style={{ color: '#94a3b8', fontWeight: 400 }}>N/A (Pre-2009)</span>}
                  </td>
                  <td
                    className="font-mono tabular-nums"
                    style={{
                      padding: '0.46rem 0.7rem',
                      textAlign: 'right',
                      fontWeight: r.birDebtOverrun ? 700 : 500,
                      color: r.birDebtOverrun ? '#b91c1c' : '#334155',
                    }}
                  >
                    {r.birDebtServiceExecPct !== null
                      ? `${r.birDebtServiceExecPct.toFixed(1)}%`
                      : <span style={{ color: '#94a3b8', fontWeight: 400 }}>N/A</span>}
                  </td>
                  <td className="font-mono tabular-nums" style={{ padding: '0.46rem 0.7rem', textAlign: 'right', color: '#991b1b', fontWeight: 600 }}>
                    ₦{r.eeFlaggedSpendTn.toFixed(2)}T ({r.eeRuleFindingsCount.toLocaleString()})
                  </td>
                  <td className="font-mono tabular-nums" style={{ padding: '0.46rem 0.7rem', textAlign: 'right', fontWeight: 600, color: '#6d28d9' }}>
                    {r.oaugfFindingsCount !== null
                      ? r.oaugfFindingsCount.toLocaleString()
                      : <span style={{ color: '#94a3b8', fontWeight: 400 }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
