import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Calculator,
  Check,
  Copy,
  Download,
  FileText,
  MapPin,
  Receipt,
  Search,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { useBudgetDatabase } from '../context/BudgetDatabaseContext';
import { NIGERIA_CONSTITUENCIES_DIRECTORY } from '../data/constituenciesDirectory';
import {
  CITIZEN_INCOME_PRESETS,
  buildCitizenFiscalVerdicts,
  buildCitizenTaxReceipt,
  buildLocalAccountabilitySummary,
  searchNeighborhoodProjects,
} from '../utils/citizenAccountability';
import {
  loadMacroCredibilityTracker,
  loadOaugfAuditIndex,
  type MacroCredibilityTrackerPayload,
  type OaugfAuditIndexPayload,
} from '../utils/mdaScorecard';
import { loadProjectLifecycleIndex, type ProjectLifecycleIndex } from '../utils/projectLifecycle';
import {
  loadEvidenceEngineAllYears,
  type EvidenceEngineAllYearsPayload,
} from '../utils/evidenceEngineV3';
import type { CompoundFlaggedProject } from '../utils/ruleEngine';
import {
  exportCitizenTaxReceiptDocx,
  exportCitizenTaxReceiptPdf,
  exportNeighborhoodCheckSheetDocx,
  exportNeighborhoodCheckSheetPdf,
} from '../utils/documentExporter';
import { buildCanonicalPermalink } from '../utils/urlState';
import { ExpandableText } from './ExpandableText';

interface Props {
  compoundProjects?: CompoundFlaggedProject[];
  evidenceAllYears?: EvidenceEngineAllYearsPayload | null;
  onSelectProject?: (project: any) => void;
}

type CitizenSubTab = 'brief' | 'receipt' | 'neighborhood';

const ALL_STATES = NIGERIA_CONSTITUENCIES_DIRECTORY.map((p) => p.state).sort();

function fmtNairaExact(amt: number): string {
  return `₦${Math.round(amt || 0).toLocaleString('en-US')}`;
}

function fmtNairaCompact(amt: number): string {
  if (!amt || !Number.isFinite(amt)) return '₦0';
  if (amt >= 1e12) return `₦${(amt / 1e12).toFixed(2)}T`;
  if (amt >= 1e9) return `₦${(amt / 1e9).toFixed(2)}B`;
  if (amt >= 1e6) return `₦${(amt / 1e6).toFixed(1)}M`;
  return `₦${Math.round(amt).toLocaleString('en-US')}`;
}

export const CitizenAccountabilityHub: React.FC<Props> = ({
  compoundProjects = [],
  evidenceAllYears = null,
  onSelectProject,
}) => {
  const { records, activeYear } = useBudgetDatabase();
  const [subTab, setSubTab] = useState<CitizenSubTab>('receipt');
  const [macroCred, setMacroCred] = useState<MacroCredibilityTrackerPayload | null>(null);
  const [oaugfIndex, setOaugfIndex] = useState<OaugfAuditIndexPayload | null>(null);
  const [lifecycleIndex, setLifecycleIndex] = useState<ProjectLifecycleIndex | null>(null);
  const [fetchedEvidenceAllYears, setFetchedEvidenceAllYears] =
    useState<EvidenceEngineAllYearsPayload | null>(null);

  const [monthlyIncome, setMonthlyIncome] = useState<number>(180_000);
  const [areaQuery, setAreaQuery] = useState<string>('');
  const [stateFilter, setStateFilter] = useState<string>('ALL');
  const [paidOnly, setPaidOnly] = useState<boolean>(false);
  const [copiedSummary, setCopiedSummary] = useState<boolean>(false);
  const [exporting, setExporting] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      loadMacroCredibilityTracker(),
      loadOaugfAuditIndex(),
      loadProjectLifecycleIndex(),
      evidenceAllYears ? Promise.resolve(evidenceAllYears) : loadEvidenceEngineAllYears(),
    ]).then(([mc, oa, lc, ee]) => {
      if (!active) return;
      setMacroCred(mc);
      setOaugfIndex(oa);
      setLifecycleIndex(lc);
      setFetchedEvidenceAllYears(ee);
    });
    return () => {
      active = false;
    };
  }, [evidenceAllYears]);

  const effectiveEvidenceAllYears = evidenceAllYears || fetchedEvidenceAllYears;

  const receipt = useMemo(
    () =>
      buildCitizenTaxReceipt({
        financialYear: activeYear,
        monthlyIncomeNaira: monthlyIncome,
        macroCredibility: macroCred,
      }),
    [activeYear, monthlyIncome, macroCred]
  );

  const verdicts = useMemo(
    () =>
      buildCitizenFiscalVerdicts({
        financialYear: activeYear,
        macroCredibility: macroCred,
        oaugfIndex,
        lifecycleIndex,
      }),
    [activeYear, macroCred, oaugfIndex, lifecycleIndex]
  );

  const areaHits = useMemo(
    () =>
      searchNeighborhoodProjects({
        query: areaQuery,
        stateFilter,
        paidOnly,
        records,
        lifecycleIndex,
        compoundProjects,
        crossLedgerContext: effectiveEvidenceAllYears?.crossLedgerContext || null,
        oaugfIndex,
        limit: 50,
      }),
    [areaQuery, stateFilter, paidOnly, records, lifecycleIndex, compoundProjects, effectiveEvidenceAllYears, oaugfIndex]
  );

  const localSummary = useMemo(
    () => buildLocalAccountabilitySummary(areaHits),
    [areaHits]
  );

  const handleCopyPlainFactSheet = () => {
    const lines = [
      `BudgetLens Citizen Brief — FY ${activeYear}`,
      `Est. Annual Tax on ${fmtNairaExact(monthlyIncome)}/mo: ${fmtNairaExact(receipt.estimatedTotalAnnualTaxNaira)} (${receipt.effectiveTaxRatePct}%)`,
      ...receipt.slices.map((s) => `- ${s.label}: ${fmtNairaExact(s.annualNaira)} (${s.sharePct}%)`),
      '',
      ...verdicts.map((v) => `${v.title}: ${v.headlineMetric}`),
    ];
    navigator.clipboard?.writeText(lines.join('\n')).then(() => {
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2000);
    });
  };

  const handleExportTaxReceipt = async (fmt: 'pdf' | 'docx') => {
    setExporting(`receipt-${fmt}`);
    try {
      const payload = {
        ...receipt,
        permalink: buildCanonicalPermalink({ tab: 'citizen', year: activeYear }),
      };
      if (fmt === 'pdf') await exportCitizenTaxReceiptPdf(payload);
      else await exportCitizenTaxReceiptDocx(payload);
    } finally {
      setExporting(null);
    }
  };

  const handleExportCheckSheet = async (fmt: 'pdf' | 'docx') => {
    setExporting(`area-${fmt}`);
    try {
      const payload = {
        financialYear: activeYear,
        areaQuery,
        stateFilter,
        items: areaHits,
        permalink: buildCanonicalPermalink({ tab: 'citizen', year: activeYear }),
      };
      if (fmt === 'pdf') await exportNeighborhoodCheckSheetPdf(payload);
      else await exportNeighborhoodCheckSheetDocx(payload);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
      {/* Hero Banner */}
      <div
        className="card"
        style={{
          padding: '1.25rem 1.4rem',
          background: 'linear-gradient(135deg, #064e3b 0%, #0f172a 100%)',
          color: '#ffffff',
          border: 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.9rem' }}>
          <div style={{ maxWidth: '720px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', color: '#6ee7b7', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
              <Sparkles size={13} /> Citizen Accountability Front Door · FY {activeYear}
            </div>
            <h2 className="font-editorial" style={{ fontSize: '1.45rem', fontWeight: 700, margin: 0, color: '#ffffff' }}>
              Where Your Tax Naira Goes — And What Was Actually Built
            </h2>
            <p style={{ margin: '0.45rem 0 0', fontSize: '0.86rem', color: '#cbd5e1', lineHeight: 1.5 }}>
              Plain-language taxpayer breakdown, local LGA & constituency verification lists, and official Auditor-General findings translated for everyday citizens.
            </p>
          </div>

          <button
            type="button"
            onClick={handleCopyPlainFactSheet}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.45rem 0.85rem',
              borderRadius: '8px',
              border: '1px solid rgba(110, 231, 183, 0.4)',
              backgroundColor: 'rgba(16, 185, 129, 0.16)',
              color: '#ecfdf5',
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {copiedSummary ? <Check size={14} /> : <Copy size={14} />}
            {copiedSummary ? 'Fact Summary Copied' : 'Copy Fact Summary'}
          </button>
        </div>

        {/* Sub-navigation pills */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
          {(
            [
              { id: 'receipt', label: 'My Tax Receipt', icon: <Receipt size={14} /> },
              { id: 'neighborhood', label: 'In My Neighborhood (LGA & Constituency)', icon: <MapPin size={14} /> },
              { id: 'brief', label: 'State of Your Money (4 Verdicts)', icon: <ShieldAlert size={14} /> },
            ] as const
          ).map((t) => {
            const active = subTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSubTab(t.id)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.46rem 0.9rem',
                  borderRadius: '8px',
                  border: active ? '1px solid #34d399' : '1px solid rgba(255,255,255,0.2)',
                  backgroundColor: active ? '#10b981' : 'rgba(255,255,255,0.08)',
                  color: active ? '#052e16' : '#f8fafc',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t.icon}
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* PANEL 1: MY TAX RECEIPT */}
      {subTab === 'receipt' && (
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <Calculator size={17} color="#059669" /> My Personal Federal Tax Receipt (FY {activeYear})
              </h3>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Select a Nigerian income preset or enter your monthly income to estimate your annual PAYE + 7.5% VAT and see how it splits across federal priorities.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => handleExportTaxReceipt('pdf')}
                disabled={exporting !== null}
                className="editorial-btn-primary"
                style={{ fontSize: '0.76rem', padding: '0.35rem 0.7rem' }}
              >
                <FileText size={13} /> {exporting === 'receipt-pdf' ? 'Generating...' : 'Receipt PDF'}
              </button>
              <button
                type="button"
                onClick={() => handleExportTaxReceipt('docx')}
                disabled={exporting !== null}
                className="editorial-btn"
                style={{ fontSize: '0.76rem', padding: '0.35rem 0.7rem' }}
              >
                <Download size={13} color="#059669" /> {exporting === 'receipt-docx' ? 'Generating...' : 'Receipt DOCX'}
              </button>
            </div>
          </div>

          {/* Presets + Monthly Input */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}>
            {CITIZEN_INCOME_PRESETS.map((p) => {
              const selected = monthlyIncome === p.monthlyIncomeNaira;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setMonthlyIncome(p.monthlyIncomeNaira)}
                  style={{
                    padding: '0.35rem 0.7rem',
                    borderRadius: '999px',
                    border: selected ? '1px solid #059669' : '1px solid var(--border-color)',
                    backgroundColor: selected ? '#ecfdf5' : 'var(--bg-secondary)',
                    color: selected ? '#047857' : 'var(--text-primary)',
                    fontSize: '0.76rem',
                    fontWeight: selected ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {p.label}
                </button>
              );
            })}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', marginLeft: 'auto' }}>
              <label htmlFor="citizen-monthly-income" style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Monthly Gross (₦):
              </label>
              <input
                id="citizen-monthly-income"
                type="number"
                min={0}
                step={5000}
                value={monthlyIncome}
                onChange={(e) => setMonthlyIncome(Math.max(0, Number(e.target.value) || 0))}
                className="font-mono"
                style={{
                  width: '140px',
                  padding: '0.35rem 0.55rem',
                  borderRadius: '7px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--card-bg)',
                  color: 'var(--text-primary)',
                  fontSize: '0.82rem',
                }}
              />
            </div>
          </div>

          {/* Summary KPI Strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: '0.65rem', marginBottom: '1rem' }}>
            <div style={{ padding: '0.75rem', borderRadius: '8px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>EST. ANNUAL PAYE</div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>
                {fmtNairaExact(receipt.estimatedAnnualPayeNaira)}
              </div>
            </div>
            <div style={{ padding: '0.75rem', borderRadius: '8px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>EST. ANNUAL VAT (7.5%)</div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>
                {fmtNairaExact(receipt.estimatedAnnualVatNaira)}
              </div>
            </div>
            <div style={{ padding: '0.75rem', borderRadius: '8px', backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0' }}>
              <div style={{ fontSize: '0.7rem', color: '#047857', fontWeight: 700 }}>TOTAL EST. ANNUAL TAX</div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.1rem', fontWeight: 700, color: '#065f46' }}>
                {fmtNairaExact(receipt.estimatedTotalAnnualTaxNaira)}
              </div>
              <div style={{ fontSize: '0.68rem', color: '#047857' }}>{receipt.effectiveTaxRatePct}% of gross income</div>
            </div>
            <div style={{ padding: '0.75rem', borderRadius: '8px', backgroundColor: '#fffbeb', border: '1px solid #fde68a' }}>
              <div style={{ fontSize: '0.7rem', color: '#b45309', fontWeight: 700 }}>CAPITAL EXECUTION RATE</div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.1rem', fontWeight: 700, color: '#92400e' }}>
                {receipt.capitalExecutionRatePct !== null ? `${receipt.capitalExecutionRatePct.toFixed(1)}%` : 'N/A'}
              </div>
              <div style={{ fontSize: '0.68rem', color: '#b45309' }}>Historical BIR release ratio</div>
            </div>
          </div>

          {/* Itemized Receipt Rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
            {receipt.slices.map((s) => (
              <div
                key={s.key}
                style={{
                  padding: '0.75rem 0.9rem',
                  borderRadius: '8px',
                  border: s.key === 'debt' ? '1px solid #fecaca' : '1px solid var(--border-color)',
                  backgroundColor: s.key === 'debt' ? '#fef2f2' : 'var(--bg-secondary)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {s.label} <span className="font-mono" style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>({s.sharePct}%)</span>
                  </span>
                  <span className="font-mono tabular-nums" style={{ fontSize: '0.95rem', fontWeight: 700, color: s.key === 'debt' ? '#b91c1c' : '#047857' }}>
                    {fmtNairaExact(s.annualNaira)} / yr
                  </span>
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  {s.plainMeaning}
                  {s.deliveredNaira !== undefined && (
                    <span style={{ fontWeight: 600, color: '#b45309', marginLeft: '0.4rem' }}>
                      · Est. delivered on historical execution rate: {fmtNairaExact(s.deliveredNaira)} (gap {fmtNairaExact(s.unexecutedGapNaira || 0)})
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PANEL 2: IN MY NEIGHBORHOOD */}
      {subTab === 'neighborhood' && (
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.9rem' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <MapPin size={17} color="#059669" /> In My Neighborhood — Look Up Projects in Your Area (FY {activeYear})
              </h3>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Search any LGA, town, road, school, or Federal Constituency. Projects marked <strong>Paid on Paper</strong> already have recorded payouts — download the site-check sheet to verify them locally.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => handleExportCheckSheet('pdf')}
                disabled={exporting !== null}
                className="editorial-btn-primary"
                style={{ fontSize: '0.76rem', padding: '0.35rem 0.7rem' }}
              >
                <FileText size={13} /> {exporting === 'area-pdf' ? 'Generating...' : 'Site-Check PDF'}
              </button>
              <button
                type="button"
                onClick={() => handleExportCheckSheet('docx')}
                disabled={exporting !== null}
                className="editorial-btn"
                style={{ fontSize: '0.76rem', padding: '0.35rem 0.7rem' }}
              >
                <Download size={13} color="#059669" /> {exporting === 'area-docx' ? 'Generating...' : 'Site-Check DOCX'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.9rem' }}>
            <div style={{ position: 'relative', flex: '1 1 260px' }}>
              <Search size={14} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={areaQuery}
                onChange={(e) => setAreaQuery(e.target.value)}
                placeholder="Type LGA, constituency, town, or project (e.g. Surulere, Gboko, Kano borehole)..."
                style={{
                  width: '100%',
                  padding: '0.45rem 0.7rem 0.45rem 2rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.82rem',
                }}
              />
            </div>

            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              aria-label="Filter by State"
              style={{
                padding: '0.45rem 0.7rem',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                fontSize: '0.82rem',
              }}
            >
              <option value="ALL">All 36 States + FCT</option>
              {ALL_STATES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', fontWeight: 600, color: '#991b1b', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={paidOnly}
                onChange={(e) => setPaidOnly(e.target.checked)}
              />
              Paid on Paper Only
            </label>
          </div>

          {/* Local Accountability Summary Card */}
          <div
            style={{
              padding: '0.9rem 1.05rem',
              borderRadius: '10px',
              backgroundColor: '#f8fafc',
              border: '1px solid #cbd5e1',
              marginBottom: '0.85rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.45rem', marginBottom: '0.6rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0f172a', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <ShieldAlert size={14} color="#059669" />
                Local Accountability Summary — {stateFilter === 'ALL' ? 'Nationwide Matching Area' : stateFilter} (FY {activeYear})
              </span>
              <span className="font-mono" style={{ fontSize: '0.68rem', color: '#475569' }}>
                {localSummary.totalMatchedCount.toLocaleString('en-US')} items · {fmtNairaCompact(localSummary.totalBudgetedNaira)} enacted
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.55rem' }}>
              <div style={{ padding: '0.55rem 0.7rem', borderRadius: '7px', backgroundColor: '#ffffff', border: '1px solid #fecaca' }}>
                <div style={{ fontSize: '0.64rem', fontWeight: 700, color: '#991b1b', textTransform: 'uppercase' }}>
                  Paid on Paper Locally
                </div>
                <div className="font-mono tabular-nums" style={{ fontSize: '0.98rem', fontWeight: 700, color: '#b91c1c' }}>
                  {localSummary.paidOnPaperCount.toLocaleString('en-US')} projects
                </div>
                <div className="font-mono" style={{ fontSize: '0.65rem', color: '#64748b' }}>
                  {fmtNairaCompact(localSummary.paidOnPaperDisbursedNaira)} cash recorded
                </div>
              </div>

              <div style={{ padding: '0.55rem 0.7rem', borderRadius: '7px', backgroundColor: '#ffffff', border: '1px solid #fde68a' }}>
                <div style={{ fontSize: '0.64rem', fontWeight: 700, color: '#92400e', textTransform: 'uppercase' }}>
                  NASS Bill→Act Insertions
                </div>
                <div className="font-mono tabular-nums" style={{ fontSize: '0.98rem', fontWeight: 700, color: '#b45309' }}>
                  {localSummary.billInsertedCount.toLocaleString('en-US')} matched
                </div>
                <div className="font-mono" style={{ fontSize: '0.65rem', color: '#64748b' }}>
                  Added or inflated in Act
                </div>
              </div>

              <div style={{ padding: '0.55rem 0.7rem', borderRadius: '7px', backgroundColor: '#ffffff', border: '1px solid #cbd5e1' }}>
                <div style={{ fontSize: '0.64rem', fontWeight: 700, color: '#334155', textTransform: 'uppercase' }}>
                  EE v3.0 Compound Risk
                </div>
                <div className="font-mono tabular-nums" style={{ fontSize: '0.98rem', fontWeight: 700, color: '#0f172a' }}>
                  {localSummary.flaggedCompoundCount.toLocaleString('en-US')} flagged
                </div>
                <div className="font-mono" style={{ fontSize: '0.65rem', color: '#64748b' }}>
                  {localSummary.highRiskCount.toLocaleString('en-US')} high-risk (60+/100)
                </div>
              </div>

              <div style={{ padding: '0.55rem 0.7rem', borderRadius: '7px', backgroundColor: '#ffffff', border: '1px solid #fed7aa' }}>
                <div style={{ fontSize: '0.64rem', fontWeight: 700, color: '#c2410c', textTransform: 'uppercase' }}>
                  OAuGF-Indicted MDAs Here
                </div>
                <div className="font-mono tabular-nums" style={{ fontSize: '0.98rem', fontWeight: 700, color: '#c2410c' }}>
                  {localSummary.oaugfIndictedMdaCount.toLocaleString('en-US')} agencies
                </div>
                <div className="font-mono" style={{ fontSize: '0.65rem', color: '#64748b' }}>
                  {localSummary.oaugfTotalMdaQueries.toLocaleString('en-US')} audit queries indexed
                </div>
              </div>
            </div>

            {localSummary.topOaugfMdas.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.55rem', alignItems: 'center' }}>
                <span className="font-mono" style={{ fontSize: '0.65rem', fontWeight: 700, color: '#475569' }}>
                  Top Queried MDAs in Area:
                </span>
                {localSummary.topOaugfMdas.slice(0, 3).map((m) => (
                  <span
                    key={m.mdaName}
                    className="font-mono"
                    style={{
                      fontSize: '0.64rem',
                      padding: '0.1rem 0.42rem',
                      borderRadius: '4px',
                      backgroundColor: '#fffbeb',
                      color: '#92400e',
                      border: '1px solid #fde68a',
                      fontWeight: 600,
                    }}
                  >
                    {m.mdaName.slice(0, 36)} · {m.oaugfQueries} Q ({m.projectCount} local)
                  </span>
                ))}
              </div>
            )}
          </div>

          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: '0.65rem' }}>
            Showing <strong>{areaHits.length}</strong> FY {activeYear} project(s) ({areaHits.filter((h) => h.paidOnPaper).length} with recorded payouts).
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
            {areaHits.slice(0, 25).map((h) => (
              <div
                key={h.id}
                style={{
                  padding: '0.75rem 0.9rem',
                  borderRadius: '8px',
                  border: h.paidOnPaper ? '1px solid #fca5a5' : '1px solid var(--border-color)',
                  backgroundColor: h.paidOnPaper ? '#fff7ed' : 'var(--bg-secondary)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '240px' }}>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.25rem' }}>
                      <span className="font-mono" style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 700 }}>
                        {h.projectCode}
                      </span>
                      <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.42rem', borderRadius: '999px', backgroundColor: '#e2e8f0', color: '#1e293b', fontWeight: 600 }}>
                        {h.state}
                      </span>
                      {h.constituency && (
                        <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.42rem', borderRadius: '999px', backgroundColor: '#dbeafe', color: '#1e40af', fontWeight: 600 }}>
                          {h.constituency}
                        </span>
                      )}
                      {h.paidOnPaper && (
                        <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.45rem', borderRadius: '999px', backgroundColor: '#dc2626', color: '#ffffff', fontWeight: 700 }}>
                          Paid on Paper — Verify on Ground
                        </span>
                      )}
                      {h.compoundRiskScore !== null && h.compoundRiskScore !== undefined && (
                        <span
                          className="font-mono"
                          style={{
                            fontSize: '0.67rem',
                            padding: '0.1rem 0.42rem',
                            borderRadius: '999px',
                            backgroundColor: h.compoundRiskScore >= 60 ? '#fef2f2' : '#fffbeb',
                            color: h.compoundRiskScore >= 60 ? '#b91c1c' : '#b45309',
                            border: `1px solid ${h.compoundRiskScore >= 60 ? '#fecaca' : '#fde68a'}`,
                            fontWeight: 700,
                          }}
                        >
                          Risk Score {h.compoundRiskScore}/100 ({h.ruleCount || 1} rules)
                        </span>
                      )}
                      {h.billInsertedOrInflated && (
                        <span
                          className="font-mono"
                          style={{
                            fontSize: '0.67rem',
                            padding: '0.1rem 0.42rem',
                            borderRadius: '999px',
                            backgroundColor: '#fef3c7',
                            color: '#92400e',
                            border: '1px solid #fde68a',
                            fontWeight: 700,
                          }}
                        >
                          Bill→Act Insertion
                        </span>
                      )}
                      {(h.oaugfMdaQueries || 0) > 0 && (
                        <span
                          className="font-mono"
                          style={{
                            fontSize: '0.67rem',
                            padding: '0.1rem 0.42rem',
                            borderRadius: '999px',
                            backgroundColor: '#fff7ed',
                            color: '#c2410c',
                            border: '1px solid #fed7aa',
                            fontWeight: 700,
                          }}
                        >
                          OAuGF MDA: {h.oaugfMdaQueries} Queries
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      <ExpandableText text={h.projectName} maxChars={160} />
                    </div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                        <Building2 size={12} /> {h.mdaName}
                      </span>
                      {h.contractorName && (
                        <span>
                          Contractor: <strong>{h.contractorName}</strong>
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div className="font-mono tabular-nums" style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {fmtNairaCompact(h.amountNaira)}
                    </div>
                    {h.disbursedNaira > 0 && (
                      <div className="font-mono tabular-nums" style={{ fontSize: '0.72rem', fontWeight: 700, color: '#b91c1c' }}>
                        Paid: {fmtNairaCompact(h.disbursedNaira)}
                      </div>
                    )}
                    {onSelectProject && (
                      <button
                        type="button"
                        onClick={() =>
                          onSelectProject({
                            id: h.id,
                            projectCode: h.projectCode,
                            projectName: h.projectName,
                            financialYear: h.financialYear,
                            amount: h.amountNaira,
                            projectType: 'CAPITAL',
                            page: h.page,
                            sector: 'Federal Capital',
                            agency: h.mdaName,
                            state: h.state,
                          })
                        }
                        className="editorial-btn"
                        style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', marginTop: '0.3rem' }}
                      >
                        Inspect & Report
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {areaHits.length === 0 && (
              <div style={{ padding: '1.25rem', textAlign: 'center', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                No matching projects found for that filter in FY {activeYear}. Try clearing the Paid-on-Paper toggle or switching states.
              </div>
            )}
          </div>
        </div>
      )}

      {/* PANEL 3: STATE OF YOUR MONEY (4 PLAIN-ENGLISH VERDICTS) */}
      {subTab === 'brief' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.85rem' }}>
          {verdicts.map((v) => {
            const border = v.tone === 'danger' ? '#fca5a5' : v.tone === 'warning' ? '#fcd34d' : '#93c5fd';
            const bg = v.tone === 'danger' ? '#fef2f2' : v.tone === 'warning' ? '#fffbeb' : '#eff6ff';
            const accent = v.tone === 'danger' ? '#991b1b' : v.tone === 'warning' ? '#92400e' : '#1e40af';
            return (
              <div key={v.id} className="card" style={{ padding: '1rem 1.15rem', border: `1px solid ${border}`, backgroundColor: bg }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.84rem', fontWeight: 700, color: accent }}>
                  <AlertTriangle size={15} />
                  {v.title}
                </div>
                <div className="font-mono" style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a', margin: '0.4rem 0' }}>
                  {v.headlineMetric}
                </div>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#334155', lineHeight: 1.5 }}>{v.plainSummary}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
