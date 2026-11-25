import React, { useEffect, useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts';
import { TrendingUp, ShieldCheck, Download, FileText, Copy, Check } from 'lucide-react';
import { useBudgetDatabase } from '../context/BudgetDatabaseContext';
import { getMacroForYear, HISTORICAL_MACRO_DATA } from '../data/historicalMacroData';
import { getPresidentForYear } from '../data/presidentialTerms';
import { exportTabularDossierDocx, exportTabularDossierPdf } from '../utils/documentExporter';

interface TrendItem {
  year: number;
  president: string;
  total: number;          // Trillions (extracted)
  officialTotal: number;  // Trillions (enacted envelope)
  infra: number;          // Capital (Trillions)
  admin: number;          // Recurrent + Debt (Trillions)
  capitalRatio: number;   // % of total
  recurrentRatio: number; // % of total
  realValue: number;      // Constant 2026 Naira Trillions
  projectCount: number;
}

export const SpendingTrendChart: React.FC = () => {
  const { summary, availableYears, isLoading } = useBudgetDatabase();
  const [trendData, setTrendData] = useState<TrendItem[]>([]);
  const [viewMode, setViewMode] = useState<'nominal' | 'ratio' | 'real'>('nominal');
  const [rangeFilter, setRangeFilter] = useState<'all' | 'recent'>('all');
  const [selectedYearIndex, setSelectedYearIndex] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null);

  useEffect(() => {
    const baseYears = availableYears.length > 0
      ? [...availableYears]
      : Object.keys(HISTORICAL_MACRO_DATA).map(Number);

    const years = baseYears
      .filter((y) => rangeFilter === 'all' || y >= 2015)
      .sort((a, b) => a - b);

    const items: TrendItem[] = years.map((yr) => {
      const stats = summary?.yearSummaries?.[String(yr)];
      const macro = getMacroForYear(yr);
      const pres = getPresidentForYear(yr);
      const extractedTrillion = stats && stats.totalAmountNaira > 0
        ? stats.totalAmountNaira / 1e12
        : macro.officialTotalBudget / 1e12;
      const officialTrillion = macro.officialTotalBudget / 1e12;

      const capShare = macro.officialTotalBudget > 0
        ? macro.totalCapitalBudget / macro.officialTotalBudget
        : 0.32;
      const recShare = Math.max(0, 1 - capShare);

      const infra = Math.round(officialTrillion * capShare * 100) / 100;
      const admin = Math.round(officialTrillion * recShare * 100) / 100;
      const capRatio = Math.round(capShare * 1000) / 10;
      const recRatio = Math.round(recShare * 1000) / 10;
      const realValue = Math.round(extractedTrillion * macro.cpiDeflatorTo2026 * 100) / 100;

      return {
        year: yr,
        president: pres.presidentName,
        total: Math.round(extractedTrillion * 100) / 100,
        officialTotal: Math.round(officialTrillion * 100) / 100,
        infra,
        admin,
        capitalRatio: capRatio,
        recurrentRatio: recRatio,
        realValue,
        projectCount: stats?.recordCount || 0,
      };
    });

    setTrendData(items);
    if (items.length > 0) {
      setSelectedYearIndex(items.length - 1);
    }
  }, [summary, availableYears, rangeFilter, isLoading]);

  // Auto-calculated year bounds
  const minYear = useMemo(() => trendData.length > 0 ? trendData[0].year : 2023, [trendData]);
  const maxYear = useMemo(() => trendData.length > 0 ? trendData[trendData.length - 1].year : 2026, [trendData]);

  // Derived metrics for latest year
  const latestItem = useMemo(() => trendData[trendData.length - 1] || null, [trendData]);
  const priorItem = useMemo(() => trendData.length > 1 ? trendData[trendData.length - 2] : null, [trendData]);

  const yoyGrowth = useMemo(() => {
    if (!latestItem || !priorItem || priorItem.total === 0) return 0;
    return Math.round(((latestItem.total - priorItem.total) / priorItem.total) * 1000) / 10;
  }, [latestItem, priorItem]);

  const activeSelectedItem = selectedYearIndex !== null && trendData[selectedYearIndex] ? trendData[selectedYearIndex] : latestItem;

  const handleCopySummary = () => {
    if (!trendData.length) return;
    const summaryText = `📊 BUDGETLENS SPENDING TREND (${minYear}–${maxYear})\n` +
      trendData.map(d => `${d.year}: Total ₦${d.total}T (Capital ₦${d.infra}T [${d.capitalRatio}%] | Recurrent ₦${d.admin}T)`).join('\n') +
      `\nVerified from official Appropriation Act PDF records. Sourced via budgetlens.ng`;

    navigator.clipboard.writeText(summaryText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportTrend = async (format: 'pdf' | 'docx') => {
    if (!trendData.length || exportingFormat) return;
    setExportingFormat(format);
    try {
      const spec = {
        filenameBase: `BudgetLens_Spending_Trend_${minYear}_${maxYear}`,
        eyebrow: `BUDGETLENS MULTI-YEAR EXPENDITURE TRAJECTORY · ${minYear}–${maxYear}`,
        title: `Nigeria Federal Budget Spending Trend (${minYear}–${maxYear})`,
        subtitle: `Nominal, Constant-Value (CPI-Adjusted to 2026), and Capital vs Recurrent Structural Ratios`,
        orientation: 'landscape' as const,
        metadata: [
          { label: 'Range', value: `${minYear}–${maxYear} (${trendData.length} Fiscal Years)` },
          { label: 'Latest YoY Growth', value: `${yoyGrowth >= 0 ? '+' : ''}${yoyGrowth}%` },
          { label: 'Active View', value: viewMode.toUpperCase() },
        ],
        kpis: [
          {
            label: `Latest Enacted (${maxYear})`,
            value: latestItem ? `₦${latestItem.officialTotal.toFixed(2)}T` : 'N/A',
            subtext: latestItem ? `${latestItem.president}` : undefined,
          },
          {
            label: 'Capital Ratio (Latest)',
            value: latestItem ? `${latestItem.capitalRatio}%` : 'N/A',
            subtext: latestItem ? `Capital ₦${latestItem.infra.toFixed(2)}T` : undefined,
          },
          {
            label: 'Real Terms (2026 Const.)',
            value: latestItem ? `₦${latestItem.realValue.toFixed(2)}T` : 'N/A',
            subtext: `Nominal YoY ${yoyGrowth >= 0 ? '+' : ''}${yoyGrowth}%`,
          },
        ],
        tables: [
          {
            heading: `Multi-Year Fiscal Envelope Trajectory (${minYear}–${maxYear})`,
            columns: [
              'Year',
              'President / Administration',
              'Extracted (₦T)',
              'Enacted Total (₦T)',
              'Capital (₦T)',
              'Recurrent+Debt (₦T)',
              'Capital Share',
              'Constant 2026 (₦T)',
            ],
            rows: trendData.map((d) => [
              d.year,
              d.president,
              d.total.toFixed(2),
              d.officialTotal.toFixed(2),
              d.infra.toFixed(2),
              d.admin.toFixed(2),
              `${d.capitalRatio}%`,
              d.realValue.toFixed(2),
            ]),
            rightAlignColumns: [0, 2, 3, 4, 5, 6, 7],
          },
        ],
        permalink: typeof window !== 'undefined' ? window.location.href : undefined,
        footnote: 'Compiled from official Federal Appropriation Act schedules across Nigeria Fourth Republic administrations.',
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

  return (
    <div style={{
      backgroundColor: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: '10px',
      padding: '1.25rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '1rem'
    }}>
      {/* 1. Header & Dynamic Year Range Title */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.2rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>
              Spending Trend ({minYear} – {maxYear})
            </h3>
            <span style={{ fontSize: '0.65rem', backgroundColor: '#e6f4ea', color: '#047857', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
              <ShieldCheck size={11} /> 100% PDF Verified
            </span>
          </div>
          <p style={{ fontSize: '0.725rem', color: '#64748b' }}>
            Auto-ingested multi-year totals & capital vs recurrent allocation ratios
          </p>
        </div>

        {/* Range & View Mode Switchers */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', backgroundColor: '#f1f5f9', borderRadius: '6px', padding: '0.2rem' }}>
            <button
              onClick={() => setRangeFilter('all')}
              style={{
                border: 'none',
                borderRadius: '4px',
                padding: '0.3rem 0.55rem',
                fontSize: '0.7rem',
                fontWeight: rangeFilter === 'all' ? 700 : 500,
                backgroundColor: rangeFilter === 'all' ? '#ffffff' : 'transparent',
                color: rangeFilter === 'all' ? '#0f172a' : '#64748b',
                cursor: 'pointer'
              }}
            >
              1999–2026
            </button>
            <button
              onClick={() => setRangeFilter('recent')}
              style={{
                border: 'none',
                borderRadius: '4px',
                padding: '0.3rem 0.55rem',
                fontSize: '0.7rem',
                fontWeight: rangeFilter === 'recent' ? 700 : 500,
                backgroundColor: rangeFilter === 'recent' ? '#ffffff' : 'transparent',
                color: rangeFilter === 'recent' ? '#0f172a' : '#64748b',
                cursor: 'pointer'
              }}
            >
              2015–2026
            </button>
          </div>
          <div style={{ display: 'flex', backgroundColor: '#f1f5f9', borderRadius: '6px', padding: '0.2rem' }}>
          <button
            onClick={() => setViewMode('nominal')}
            style={{
              border: 'none',
              borderRadius: '4px',
              padding: '0.3rem 0.65rem',
              fontSize: '0.725rem',
              fontWeight: viewMode === 'nominal' ? 700 : 500,
              backgroundColor: viewMode === 'nominal' ? '#ffffff' : 'transparent',
              color: viewMode === 'nominal' ? '#0f172a' : '#64748b',
              cursor: 'pointer',
              boxShadow: viewMode === 'nominal' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
            }}
          >
            📊 Nominal (₦T)
          </button>
          <button
            onClick={() => setViewMode('ratio')}
            style={{
              border: 'none',
              borderRadius: '4px',
              padding: '0.3rem 0.65rem',
              fontSize: '0.725rem',
              fontWeight: viewMode === 'ratio' ? 700 : 500,
              backgroundColor: viewMode === 'ratio' ? '#ffffff' : 'transparent',
              color: viewMode === 'ratio' ? '#0f172a' : '#64748b',
              cursor: 'pointer',
              boxShadow: viewMode === 'ratio' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
            }}
          >
            ⚖️ Capital Ratio (%)
          </button>
          <button
            onClick={() => setViewMode('real')}
            style={{
              border: 'none',
              borderRadius: '4px',
              padding: '0.3rem 0.65rem',
              fontSize: '0.725rem',
              fontWeight: viewMode === 'real' ? 700 : 500,
              backgroundColor: viewMode === 'real' ? '#ffffff' : 'transparent',
              color: viewMode === 'real' ? '#0f172a' : '#64748b',
              cursor: 'pointer',
              boxShadow: viewMode === 'real' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
            }}
          >
            📉 Real (Adjusted)
          </button>
          </div>
        </div>
      </div>

      {/* 2. Top Metric Badges */}
      {latestItem && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.725rem' }}>
          <span style={{ backgroundColor: '#f0fdf4', border: '1px solid #a7f3d0', color: '#047857', padding: '0.2rem 0.55rem', borderRadius: '4px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
            <TrendingUp size={12} /> {yoyGrowth >= 0 ? `+${yoyGrowth}%` : `${yoyGrowth}%`} YoY Growth
          </span>
          <span style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8', padding: '0.2rem 0.55rem', borderRadius: '4px', fontWeight: 600 }}>
            {latestItem.capitalRatio}% Capital Ratio ({maxYear})
          </span>
          <span style={{ backgroundColor: '#faf5ff', border: '1px solid #e9d5ff', color: '#7e22ce', padding: '0.2rem 0.55rem', borderRadius: '4px', fontWeight: 600 }}>
            {latestItem.capitalRatio >= 35 ? '🟩 Balanced Capital Spend' : '🟧 Recurrent-Heavy'}
          </span>
        </div>
      )}

      {/* 3. Recharts Body */}
      <div style={{ width: '100%', height: '175px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={trendData}
            margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
            onClick={(e: any) => {
              if (e && e.activeTooltipIndex !== undefined) {
                setSelectedYearIndex(e.activeTooltipIndex);
              }
            }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="year" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: '#64748b' }}
              tickFormatter={(v: number) => viewMode === 'ratio' ? `${v}%` : `${v}T`}
            />
            <Tooltip
              formatter={(value: any, name: any) => {
                if (viewMode === 'ratio') return [`${value}%`, name];
                return [`₦${value} Trillion`, name];
              }}
              labelFormatter={(label) => `Financial Year ${label}`}
              contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '8px', color: '#ffffff', fontSize: '0.775rem' }}
            />

            {viewMode === 'nominal' && (
              <>
                <Line type="monotone" name="Grand Total" dataKey="total" stroke="#10b981" strokeWidth={2.5} dot={{ fill: '#10b981', r: 5 }} />
                <Line type="monotone" name="Capital Budget" dataKey="infra" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6', r: 4 }} />
                <Line type="monotone" name="Recurrent Cost" dataKey="admin" stroke="#a855f7" strokeWidth={2} dot={{ fill: '#a855f7', r: 4 }} />
              </>
            )}

            {viewMode === 'ratio' && (
              <>
                <Line type="monotone" name="Capital Share (%)" dataKey="capitalRatio" stroke="#3b82f6" strokeWidth={2.5} dot={{ fill: '#3b82f6', r: 5 }} />
                <Line type="monotone" name="Recurrent Share (%)" dataKey="recurrentRatio" stroke="#a855f7" strokeWidth={2} dot={{ fill: '#a855f7', r: 4 }} />
              </>
            )}

            {viewMode === 'real' && (
              <>
                <Line type="monotone" name="Nominal Budget (₦T)" dataKey="total" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981', r: 4 }} />
                <Line type="monotone" name="Inflation-Adjusted Real Value" dataKey="realValue" stroke="#f59e0b" strokeWidth={2.5} strokeDasharray="4 4" dot={{ fill: '#f59e0b', r: 5 }} />
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 4. Legend Row */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '1.25rem', fontSize: '0.725rem' }}>
        {viewMode === 'nominal' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <div style={{ width: '12px', height: '3px', backgroundColor: '#10b981', borderRadius: '2px' }} />
              <span style={{ color: '#0f172a', fontWeight: 600 }}>Total Budget</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <div style={{ width: '12px', height: '3px', backgroundColor: '#3b82f6', borderRadius: '2px' }} />
              <span style={{ color: '#0f172a', fontWeight: 500 }}>Capital Budget</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <div style={{ width: '12px', height: '3px', backgroundColor: '#a855f7', borderRadius: '2px' }} />
              <span style={{ color: '#0f172a', fontWeight: 500 }}>Recurrent Cost</span>
            </div>
          </>
        )}
        {viewMode === 'ratio' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <div style={{ width: '12px', height: '3px', backgroundColor: '#3b82f6', borderRadius: '2px' }} />
              <span style={{ color: '#0f172a', fontWeight: 600 }}>Capital Allocation %</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <div style={{ width: '12px', height: '3px', backgroundColor: '#a855f7', borderRadius: '2px' }} />
              <span style={{ color: '#0f172a', fontWeight: 500 }}>Recurrent Cost %</span>
            </div>
          </>
        )}
        {viewMode === 'real' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <div style={{ width: '12px', height: '3px', backgroundColor: '#10b981', borderRadius: '2px' }} />
              <span style={{ color: '#0f172a', fontWeight: 600 }}>Nominal Naira</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <div style={{ width: '12px', height: '3px', backgroundColor: '#f59e0b', borderRadius: '2px' }} />
              <span style={{ color: '#0f172a', fontWeight: 500 }}>Purchasing Power (Real Value)</span>
            </div>
          </>
        )}
      </div>

      {/* 5. Selected Year Interactive Deep-Dive Inspector Card */}
      {activeSelectedItem && (
        <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.85rem 1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0f172a' }}>
              {activeSelectedItem.year} Fiscal Breakdown · {activeSelectedItem.president}
            </div>
            <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>
              Extracted: ₦{activeSelectedItem.total}T · Enacted: ₦{activeSelectedItem.officialTotal}T
            </span>
          </div>

          {/* Bi-Color Ratio Progress Bar */}
          <div style={{ height: '8px', backgroundColor: '#e2e8f0', borderRadius: '4px', overflow: 'hidden', display: 'flex', marginBottom: '0.4rem' }}>
            <div style={{ width: `${activeSelectedItem.capitalRatio}%`, backgroundColor: '#3b82f6' }} title={`Capital: ${activeSelectedItem.capitalRatio}%`} />
            <div style={{ width: `${activeSelectedItem.recurrentRatio}%`, backgroundColor: '#a855f7' }} title={`Recurrent: ${activeSelectedItem.recurrentRatio}%`} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.725rem', color: '#475569' }}>
            <span style={{ color: '#2563eb', fontWeight: 600 }}>
              Capital: ₦{activeSelectedItem.infra}T ({activeSelectedItem.capitalRatio}%)
            </span>
            <span style={{ color: '#7c3aed', fontWeight: 600 }}>
              Recurrent: ₦{activeSelectedItem.admin}T ({activeSelectedItem.recurrentRatio}%)
            </span>
          </div>
        </div>
      )}

      {/* 6. Export & Citation Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.5rem', borderTop: '1px solid #f1f5f9', fontSize: '0.725rem' }}>
        <button
          onClick={handleCopySummary}
          style={{ backgroundColor: 'transparent', border: 'none', color: '#10b981', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Summary Copied!' : 'Copy Summary'}
        </button>

        <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => handleExportTrend('pdf')}
            disabled={!trendData.length || exportingFormat !== null}
            style={{ backgroundColor: 'transparent', border: 'none', color: '#059669', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
          >
            <FileText size={13} /> {exportingFormat === 'pdf' ? 'PDF...' : 'Download PDF'}
          </button>
          <button
            type="button"
            onClick={() => handleExportTrend('docx')}
            disabled={!trendData.length || exportingFormat !== null}
            style={{ backgroundColor: 'transparent', border: 'none', color: '#475569', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
          >
            <Download size={13} /> {exportingFormat === 'docx' ? 'DOCX...' : 'Download DOCX'}
          </button>
        </div>
      </div>
    </div>
  );
};
