import React, { useEffect, useMemo, useState } from 'react';
import {
  BookmarkPlus,
  Check,
  Download,
  ExternalLink,
  FileText,
  History,
  Layers,
  Search,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { BudgetProject } from '../types';
import { useCasebook } from '../context/CasebookContext';
import { isValidGemmaReview } from '../utils/gemmaReview';
import {
  buildCompoundFlaggedProjects,
  type CompoundFlaggedProject,
  type EvidenceItem,
} from '../utils/ruleEngine';
import type { EvidenceEngineAllYearsPayload } from '../utils/evidenceEngineV3';
import {
  exportEvidenceEngineDossierDocx,
  exportEvidenceEngineDossierPdf,
} from '../utils/documentExporter';
import { ExpandableText } from './ExpandableText';

interface Props {
  projects: BudgetProject[];
  financialYear: number;
  evidenceItems?: EvidenceItem[];
  compoundProjects?: CompoundFlaggedProject[];
  allYearsData?: EvidenceEngineAllYearsPayload | null;
  selectedRuleId?: string | null;
  onClearRuleFilter?: () => void;
  onSelectProject?: (project: any) => void;
  onSelectYear?: (year: number) => void;
}

const ITEMS_PER_PAGE = 15;

export const RecentFlaggedProjects: React.FC<Props> = ({
  projects,
  financialYear,
  evidenceItems = [],
  compoundProjects,
  allYearsData = null,
  selectedRuleId = null,
  onClearRuleFilter,
  onSelectProject,
  onSelectYear,
}) => {
  const { pinItem, isPinned } = useCasebook();
  const [viewMode, setViewMode] = useState<'compound' | 'findings' | 'historical'>('compound');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [crossFilter, setCrossFilter] = useState<
    'ALL' | 'MULTI_FLAG' | 'PAID_ON_PAPER' | 'NASS_INSERTION' | 'OAUGF_INDICTED' | 'PERSONAL_PAYOUT_MDA'
  >('ALL');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null);

  useEffect(() => {
    if (selectedRuleId && viewMode === 'historical') {
      setViewMode('findings');
    }
  }, [selectedRuleId, viewMode]);

  useEffect(() => {
    setPage(1);
  }, [financialYear, viewMode, severityFilter, crossFilter, selectedRuleId, query]);

  const formatNaira = (amount: number) => {
    if (!amount) return '₦0';
    if (amount >= 1e12) return `₦${(amount / 1e12).toFixed(2)}T`;
    if (amount >= 1e9) return `₦${(amount / 1e9).toFixed(2)}B`;
    if (amount >= 1e6) return `₦${(amount / 1e6).toFixed(2)}M`;
    return `₦${amount.toLocaleString()}`;
  };

  const resolvedCompoundProjects = useMemo(
    () =>
      compoundProjects && compoundProjects.length > 0
        ? compoundProjects
        : buildCompoundFlaggedProjects(evidenceItems),
    [compoundProjects, evidenceItems]
  );

  const gemmaByProjectKey = useMemo(() => {
    const map = new Map<string, any>();
    for (const p of projects as any[]) {
      if (!isValidGemmaReview(p?.gemmaReview)) continue;
      if (p.id) map.set(`id:${p.id}`, p.gemmaReview);
      const code = String(p.projectCode || '').trim().toLowerCase();
      if (code) map.set(`cp:${code}:${p.page || 1}`, p.gemmaReview);
    }
    return map;
  }, [projects]);

  const resolveItemGemma = (item: any) => {
    if (isValidGemmaReview(item?.gemmaReview)) return item.gemmaReview;
    if (item?.id && gemmaByProjectKey.has(`id:${item.id}`)) return gemmaByProjectKey.get(`id:${item.id}`);
    const code = String(item?.projectCode || '').trim().toLowerCase();
    if (code) return gemmaByProjectKey.get(`cp:${code}:${item.page || 1}`) || null;
    return null;
  };

  // Filtered Compound Projects (Deduplicated 1 row per project)
  const filteredCompound = useMemo(() => {
    const q = query.trim().toLowerCase();
    return resolvedCompoundProjects.filter((cp) => {
      if (selectedRuleId && !cp.triggeredRules.some((r) => r.ruleId === selectedRuleId)) {
        return false;
      }
      if (severityFilter !== 'all' && cp.highestSeverity !== severityFilter) return false;
      if (crossFilter === 'MULTI_FLAG' && cp.ruleCount < 2) return false;
      if (crossFilter === 'PAID_ON_PAPER' && !cp.crossLedgerBadges.paidOnPaper) return false;
      if (crossFilter === 'NASS_INSERTION' && !cp.crossLedgerBadges.billInsertedOrInflated) return false;
      if (crossFilter === 'OAUGF_INDICTED' && cp.crossLedgerBadges.mdaOaugfIssuesCount < 5) return false;
      if (crossFilter === 'PERSONAL_PAYOUT_MDA' && !cp.crossLedgerBadges.mdaPersonalOrOpaquePayoutFlag) return false;
      if (!q) return true;
      return (
        (cp.projectName || '').toLowerCase().includes(q) ||
        (cp.projectCode || '').toLowerCase().includes(q) ||
        (cp.agency || '').toLowerCase().includes(q) ||
        cp.triggeredRules.some((r) => r.ruleName.toLowerCase().includes(q) || r.ruleId.toLowerCase().includes(q))
      );
    });
  }, [resolvedCompoundProjects, selectedRuleId, severityFilter, crossFilter, query]);

  // Filtered Individual Rule Findings
  const listSource = evidenceItems.length > 0 ? evidenceItems : (projects as any[]);
  const filteredFindings = useMemo(() => {
    const q = query.trim().toLowerCase();
    return listSource.filter((item: any) => {
      if (selectedRuleId && item.ruleId !== selectedRuleId) return false;
      if (severityFilter !== 'all' && (item.severity || 'low') !== severityFilter) return false;
      const b = item.crossLedgerBadges;
      if (crossFilter === 'PAID_ON_PAPER' && !b?.paidOnPaper) return false;
      if (crossFilter === 'NASS_INSERTION' && !b?.billInsertedOrInflated) return false;
      if (crossFilter === 'OAUGF_INDICTED' && (b?.mdaOaugfIssuesCount || 0) < 5) return false;
      if (crossFilter === 'PERSONAL_PAYOUT_MDA' && !b?.mdaPersonalOrOpaquePayoutFlag) return false;
      if (!q) return true;
      return (
        (item.projectName || '').toLowerCase().includes(q) ||
        (item.projectCode || '').toLowerCase().includes(q) ||
        (item.agency || '').toLowerCase().includes(q) ||
        (item.ruleName || '').toLowerCase().includes(q)
      );
    });
  }, [listSource, selectedRuleId, severityFilter, crossFilter, query]);

  const activeListLength =
    viewMode === 'compound' ? filteredCompound.length : filteredFindings.length;
  const totalPages = Math.max(1, Math.ceil(activeListLength / ITEMS_PER_PAGE));
  const safePage = Math.min(page, totalPages);

  const displayCompound = filteredCompound.slice(
    (safePage - 1) * ITEMS_PER_PAGE,
    safePage * ITEMS_PER_PAGE
  );
  const displayFindings = filteredFindings.slice(
    (safePage - 1) * ITEMS_PER_PAGE,
    safePage * ITEMS_PER_PAGE
  );

  const crossLedgerFindingsCount = useMemo(
    () => evidenceItems.filter((i) => i.ledgerScope === 'CROSS_LEDGER').length,
    [evidenceItems]
  );

  const handleExport = async (fmt: 'pdf' | 'docx') => {
    if (exportingFormat) return;
    setExportingFormat(fmt);
    try {
      const exportInput = {
        financialYear,
        modeLabel:
          viewMode === 'historical'
            ? '28-Year Historical Matrix (1999–2026)'
            : `FY ${financialYear} Compound Risk Ledger`,
        filterSummary: [
          selectedRuleId ? `Rule: ${selectedRuleId}` : 'All 22 Rules',
          crossFilter !== 'ALL' ? `Cross-Ledger: ${crossFilter}` : null,
          severityFilter !== 'all' ? `Severity: ${severityFilter.toUpperCase()}` : null,
          query.trim() ? `Query: "${query.trim()}"` : null,
        ]
          .filter(Boolean)
          .join(' | '),
        totalRulesCount: 22,
        totalRuleFindings:
          viewMode === 'historical' && allYearsData
            ? allYearsData.summary.totalRuleFindings
            : evidenceItems.length,
        totalCrossLedgerFindings:
          viewMode === 'historical' && allYearsData
            ? allYearsData.summary.totalCrossLedgerFindings
            : crossLedgerFindingsCount,
        totalCompoundProjects:
          viewMode === 'historical' && allYearsData
            ? allYearsData.summary.totalFlaggedProjects
            : resolvedCompoundProjects.length,
        compoundProjects:
          viewMode === 'historical' && allYearsData
            ? allYearsData.topCompoundProjectsAllTime.map((p) => ({
                projectCode: p.projectCode,
                projectName: p.projectName,
                agency: p.agency,
                financialYear: p.financialYear,
                amount: p.amount,
                page: p.page,
                ruleCount: p.ruleCount,
                crossLedgerRuleCount: p.crossLedgerCount,
                compoundRiskScore: p.compoundRiskScore,
                ruleNames: p.ruleIds,
                paidOnPaper: p.paidOnPaper,
                billInsertedOrInflated: Boolean(p.billInsertionStatus),
                mdaOaugfIssuesCount: p.mdaOaugfIssues,
                mdaIntegrityGrade: p.mdaGrade,
              }))
            : filteredCompound.slice(0, 60).map((cp) => ({
                projectCode: cp.projectCode,
                projectName: cp.projectName,
                agency: cp.agency,
                financialYear: cp.financialYear,
                amount: cp.amount,
                page: cp.page,
                ruleCount: cp.ruleCount,
                crossLedgerRuleCount: cp.crossLedgerRuleCount,
                compoundRiskScore: cp.compoundRiskScore,
                ruleNames: cp.triggeredRules.map((r) => r.ruleName),
                paidOnPaper: cp.crossLedgerBadges.paidOnPaper,
                billInsertedOrInflated: cp.crossLedgerBadges.billInsertedOrInflated,
                mdaOaugfIssuesCount: cp.crossLedgerBadges.mdaOaugfIssuesCount,
                mdaIntegrityGrade: cp.crossLedgerBadges.mdaIntegrityGrade,
              })),
        permalink: typeof window !== 'undefined' ? window.location.href : undefined,
      };
      if (fmt === 'pdf') await exportEvidenceEngineDossierPdf(exportInput);
      else await exportEvidenceEngineDossierDocx(exportInput);
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <div
      className="dossier-card"
      style={{
        padding: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}
    >
      {/* Top Mode Bar + PDF/DOCX Export Buttons */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.75rem',
          paddingBottom: '0.85rem',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setViewMode('compound')}
            style={{
              padding: '0.42rem 0.8rem',
              borderRadius: '7px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: viewMode === 'compound' ? '#091017' : '#ffffff',
              color: viewMode === 'compound' ? '#ffffff' : 'var(--text-secondary)',
              fontSize: '0.76rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
            }}
          >
            <Layers size={13} />
            Compound Multi-Flag Projects ({resolvedCompoundProjects.length.toLocaleString()})
          </button>

          <button
            type="button"
            onClick={() => setViewMode('findings')}
            style={{
              padding: '0.42rem 0.8rem',
              borderRadius: '7px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: viewMode === 'findings' ? '#091017' : '#ffffff',
              color: viewMode === 'findings' ? '#ffffff' : 'var(--text-secondary)',
              fontSize: '0.76rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            All Rule Findings ({evidenceItems.length.toLocaleString()})
          </button>

          {allYearsData && (
            <button
              type="button"
              onClick={() => setViewMode('historical')}
              style={{
                padding: '0.42rem 0.8rem',
                borderRadius: '7px',
                border: viewMode === 'historical' ? '1px solid #047857' : '1px solid #a7f3d0',
                backgroundColor: viewMode === 'historical' ? '#047857' : '#ecfdf5',
                color: viewMode === 'historical' ? '#ffffff' : '#065f46',
                fontSize: '0.76rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              <History size={13} />
              28-Year Historical Matrix (1999–2026)
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={exportingFormat !== null}
            onClick={() => handleExport('pdf')}
            className="editorial-btn-primary"
            style={{ padding: '0.4rem 0.72rem', fontSize: '0.73rem' }}
          >
            <FileText size={13} />
            {exportingFormat === 'pdf' ? 'Exporting PDF...' : 'Export Evidence Dossier (PDF)'}
          </button>
          <button
            type="button"
            disabled={exportingFormat !== null}
            onClick={() => handleExport('docx')}
            className="editorial-btn"
            style={{ padding: '0.4rem 0.72rem', fontSize: '0.73rem' }}
          >
            <Download size={13} color="#059669" />
            {exportingFormat === 'docx' ? 'Exporting DOCX...' : 'Export DOCX'}
          </button>
        </div>
      </div>

      {/* MODE 3: 28-YEAR HISTORICAL MATRIX (1999-2026) */}
      {viewMode === 'historical' && allYearsData ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
          <div className="grid-4-cols">
            <div style={{ backgroundColor: 'var(--bg-canvas)', padding: '0.85rem 1rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                28-Year Records Scanned
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.2rem' }}>
                {allYearsData.summary.totalRecordsScanned.toLocaleString()}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                FY {allYearsData.summary.firstYear}–{allYearsData.summary.lastYear} consecutive
              </div>
            </div>

            <div style={{ backgroundColor: 'var(--bg-canvas)', padding: '0.85rem 1rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                All-Time Rule Findings
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#b91c1c', marginTop: '0.2rem' }}>
                {allYearsData.summary.totalRuleFindings.toLocaleString()}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {allYearsData.summary.totalCrossLedgerFindings.toLocaleString()} cross-ledger hits
              </div>
            </div>

            <div style={{ backgroundColor: 'var(--bg-canvas)', padding: '0.85rem 1rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                All-Time Flagged Projects
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--accent-primary)', marginTop: '0.2rem' }}>
                {allYearsData.summary.totalFlaggedProjects.toLocaleString()}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {formatNaira(allYearsData.summary.totalFlaggedNaira)} cumulative value
              </div>
            </div>

            <div style={{ backgroundColor: 'var(--bg-canvas)', padding: '0.85rem 1rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                28-Year Duplicate Clusters
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#b45309', marginTop: '0.2rem' }}>
                {allYearsData.summary.totalDuplicateClusters.toLocaleString()}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {allYearsData.summary.totalDuplicateItems.toLocaleString()} clustered items ({formatNaira(allYearsData.summary.totalDuplicateNaira)})
              </div>
            </div>
          </div>

          {/* All-Time Top Flagged MDAs (1999-2026) Joined with OAuGF & Scorecards */}
          <div>
            <h4 className="font-editorial" style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 0.5rem', color: 'var(--text-primary)' }}>
              1. Top Rule-Triggering &amp; Cross-Ledger Flagged MDAs Across 28 Years (1999–2026)
            </h4>
            <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.77rem' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', textAlign: 'left' }}>
                    <th style={{ padding: '0.55rem 0.75rem' }}>Executing Ministry / Agency</th>
                    <th style={{ padding: '0.55rem 0.75rem', textAlign: 'right' }}>Flagged Projects</th>
                    <th style={{ padding: '0.55rem 0.75rem', textAlign: 'right' }}>Total Rule Hits</th>
                    <th style={{ padding: '0.55rem 0.75rem', textAlign: 'right' }}>6-Ledger Hits</th>
                    <th style={{ padding: '0.55rem 0.75rem', textAlign: 'center' }}>OAuGF Queries</th>
                    <th style={{ padding: '0.55rem 0.75rem', textAlign: 'center' }}>MDA Grade</th>
                    <th style={{ padding: '0.55rem 0.75rem', textAlign: 'right' }}>28-Yr Flagged (₦)</th>
                  </tr>
                </thead>
                <tbody>
                  {allYearsData.topFlaggedMdasAllTime.slice(0, 15).map((m) => (
                    <tr key={m.mdaKey} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        <div>{m.mdaName}</div>
                        <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                          Active across {m.yearsActiveCount} budget yrs
                          {m.hasPersonalOrOpaquePayoutFlag ? ' · Personal/Opaque Treasury Payouts Flagged' : ''}
                        </div>
                      </td>
                      <td className="font-mono tabular-nums" style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 700 }}>
                        {m.flaggedProjectCount.toLocaleString()}
                      </td>
                      <td className="font-mono tabular-nums" style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>
                        {m.totalRuleFindings.toLocaleString()}
                      </td>
                      <td className="font-mono tabular-nums" style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 700, color: '#1d4ed8' }}>
                        {m.crossLedgerFindings.toLocaleString()}
                      </td>
                      <td className="font-mono tabular-nums" style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                        {m.oaugfIssues > 0 ? (
                          <span style={{ backgroundColor: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: 700, fontSize: '0.68rem' }}>
                            {m.oaugfIssues} ({m.oaugfRepeat} rep)
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="font-mono" style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontWeight: 700 }}>
                        <span
                          style={{
                            padding: '0.1rem 0.4rem',
                            borderRadius: '4px',
                            backgroundColor: m.grade === 'F' || m.grade === 'D' ? '#fef2f2' : '#f1f5f9',
                            color: m.grade === 'F' || m.grade === 'D' ? '#b91c1c' : '#334155',
                          }}
                        >
                          {m.grade}
                        </span>
                      </td>
                      <td className="font-mono tabular-nums" style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 700, color: '#b91c1c' }}>
                        {formatNaira(m.flaggedAmountNaira)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* All-Time Top Compound Multi-Flag Projects (1999-2026) */}
          <div>
            <h4 className="font-editorial" style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 0.5rem', color: 'var(--text-primary)' }}>
              2. All-Time Highest-Compound-Risk Projects (1999–2026 · Click Any Row to Inspect)
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              {allYearsData.topCompoundProjectsAllTime.slice(0, 15).map((p, idx) => (
                <div
                  key={`${p.financialYear}-${p.id}-${idx}`}
                  onClick={() => {
                    if (onSelectYear && p.financialYear !== financialYear) {
                      onSelectYear(p.financialYear);
                    }
                    onSelectProject?.(p);
                  }}
                  style={{
                    padding: '0.65rem 0.85rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                    backgroundColor: '#ffffff',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '1rem',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.2rem' }}>
                      <span className="font-mono" style={{ fontSize: '0.66rem', fontWeight: 700, backgroundColor: '#091017', color: '#ffffff', padding: '0.1rem 0.42rem', borderRadius: '4px' }}>
                        FY {p.financialYear}
                      </span>
                      <span className="font-mono" style={{ fontSize: '0.66rem', fontWeight: 700, backgroundColor: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', padding: '0.1rem 0.42rem', borderRadius: '4px' }}>
                        {p.ruleCount} Rules ({p.crossLedgerCount} Cross-Ledger) · Risk {p.compoundRiskScore}/100
                      </span>
                      {p.paidOnPaper && (
                        <span className="font-mono" style={{ fontSize: '0.64rem', fontWeight: 700, backgroundColor: '#b91c1c', color: '#ffffff', padding: '0.1rem 0.42rem', borderRadius: '4px' }}>
                          PAID ON PAPER
                        </span>
                      )}
                      {p.billInsertionStatus && (
                        <span className="font-mono" style={{ fontSize: '0.64rem', fontWeight: 700, backgroundColor: '#fffbeb', color: '#b45309', border: '1px solid #fde68a', padding: '0.1rem 0.42rem', borderRadius: '4px' }}>
                          NASS {p.billInsertionStatus}
                        </span>
                      )}
                      {p.mdaOaugfIssues > 0 && (
                        <span className="font-mono" style={{ fontSize: '0.64rem', fontWeight: 700, backgroundColor: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '0.1rem 0.42rem', borderRadius: '4px' }}>
                          MDA OAuGF: {p.mdaOaugfIssues} Queries
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      <ExpandableText text={p.projectName} maxChars={145} />
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                      {p.agency} · <span className="font-mono">{p.projectCode}</span> · Rules: {p.ruleIds.join(', ')}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div className="font-mono tabular-nums" style={{ fontSize: '0.9rem', fontWeight: 700, color: '#b91c1c' }}>
                      {formatNaira(p.amount)}
                    </div>
                    <div className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                      p.{p.page} <ExternalLink size={10} style={{ verticalAlign: 'middle' }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Filter Controls for Mode 1 (Compound) & Mode 2 (All Findings) */}
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
            <div>
              <h3 className="font-editorial" style={{ fontSize: '1.12rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                {viewMode === 'compound'
                  ? `Compound Multi-Flag Projects (FY ${financialYear})`
                  : `Evidence Findings Ledger (FY ${financialYear})`}
              </h3>
              <p className="font-mono tabular-nums" style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '0.15rem 0 0' }}>
                {activeListLength.toLocaleString()}{' '}
                {viewMode === 'compound' ? 'deduplicated flagged projects' : 'matching rule findings'}
                {selectedRuleId ? ` · Filtered by ${selectedRuleId}` : ''}
              </p>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.45rem' }}>
              {selectedRuleId && onClearRuleFilter && (
                <button
                  type="button"
                  onClick={onClearRuleFilter}
                  style={{
                    padding: '0.28rem 0.6rem',
                    borderRadius: '5px',
                    border: '1px solid #a7f3d0',
                    backgroundColor: '#ecfdf5',
                    color: '#065f46',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {selectedRuleId} ✕
                </button>
              )}

              {(['all', 'high', 'medium', 'low'] as const).map((sev) => (
                <button
                  key={sev}
                  type="button"
                  onClick={() => setSeverityFilter(sev)}
                  style={{
                    padding: '0.3rem 0.6rem',
                    borderRadius: '5px',
                    border: '1px solid var(--border-subtle)',
                    backgroundColor: severityFilter === sev ? '#091017' : '#ffffff',
                    color: severityFilter === sev ? '#ffffff' : 'var(--text-secondary)',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    textTransform: 'capitalize',
                    cursor: 'pointer',
                  }}
                >
                  {sev}
                </button>
              ))}

              <div style={{ position: 'relative' }}>
                <Search
                  size={14}
                  style={{
                    position: 'absolute',
                    left: '0.65rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted)',
                  }}
                />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter by title, MDA, code, or rule..."
                  style={{
                    padding: '0.34rem 0.65rem 0.34rem 1.95rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-subtle)',
                    backgroundColor: 'var(--bg-canvas)',
                    fontSize: '0.76rem',
                    color: 'var(--text-primary)',
                    width: '220px',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Cross-Ledger Quick-Filter Pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.38rem', alignItems: 'center' }}>
            <span className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 700 }}>
              6-Ledger Filter:
            </span>
            {(
              [
                { id: 'ALL', label: 'All Flagged' },
                { id: 'MULTI_FLAG', label: '2+ Rules Converging' },
                { id: 'PAID_ON_PAPER', label: 'Paid on Paper (Cash Verified)' },
                { id: 'NASS_INSERTION', label: 'Legislative Insertions' },
                { id: 'OAUGF_INDICTED', label: 'OAuGF-Queried MDAs' },
                { id: 'PERSONAL_PAYOUT_MDA', label: 'Personal/Staff-Account Payout MDAs' },
              ] as const
            ).map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setCrossFilter(pill.id)}
                style={{
                  padding: '0.24rem 0.58rem',
                  borderRadius: '999px',
                  border: crossFilter === pill.id ? '1px solid #047857' : '1px solid var(--border-subtle)',
                  backgroundColor: crossFilter === pill.id ? '#ecfdf5' : '#ffffff',
                  color: crossFilter === pill.id ? '#065f46' : 'var(--text-secondary)',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {pill.label}
              </button>
            ))}
          </div>

          {/* MODE 1: COMPOUND MULTI-FLAG PROJECTS LIST */}
          {viewMode === 'compound' ? (
            displayCompound.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
                <ShieldAlert size={20} style={{ marginBottom: '0.4rem', opacity: 0.5 }} />
                <div>No compound flagged projects match the current filter in FY {financialYear}.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                {displayCompound.map((cp) => {
                  const badgeBg =
                    cp.highestSeverity === 'high'
                      ? '#fef2f2'
                      : cp.highestSeverity === 'medium'
                      ? '#fffbeb'
                      : '#f1f5f9';
                  const badgeColor =
                    cp.highestSeverity === 'high'
                      ? '#b91c1c'
                      : cp.highestSeverity === 'medium'
                      ? '#b45309'
                      : '#475569';
                  const itemGemma = resolveItemGemma(cp);
                  const pinId = `line_item:${cp.financialYear}:${(cp.projectCode || cp.id).toLowerCase()}:${cp.page}`;
                  const pinned = isPinned(pinId);
                  const b = cp.crossLedgerBadges;

                  return (
                    <div
                      key={cp.projectKey}
                      onClick={() =>
                        onSelectProject?.(itemGemma ? { ...cp, gemmaReview: itemGemma } : cp)
                      }
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.85rem',
                        cursor: onSelectProject ? 'pointer' : 'default',
                        padding: '0.75rem 0.85rem',
                        borderRadius: '8px',
                        border:
                          cp.ruleCount >= 3 || b.paidOnPaper
                            ? '1px solid #fecaca'
                            : '1px solid var(--border-subtle)',
                        backgroundColor: '#ffffff',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.7rem', flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem', flexShrink: 0 }}>
                          <span
                            style={{
                              fontSize: '0.64rem',
                              fontWeight: 700,
                              backgroundColor: badgeBg,
                              color: badgeColor,
                              padding: '0.16rem 0.45rem',
                              borderRadius: '4px',
                              textTransform: 'uppercase',
                            }}
                          >
                            {cp.ruleCount} {cp.ruleCount === 1 ? 'RULE' : 'RULES'}
                          </span>
                          <span className="font-mono" style={{ fontSize: '0.62rem', fontWeight: 700, color: '#64748b' }}>
                            Risk {cp.compoundRiskScore}
                          </span>
                        </div>

                        <div style={{ minWidth: 0, flex: 1 }}>
                          {/* Cross-Ledger Badges Row */}
                          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.22rem' }}>
                            {b.paidOnPaper && (
                              <span
                                className="font-mono"
                                style={{
                                  fontSize: '0.62rem',
                                  fontWeight: 700,
                                  backgroundColor: '#b91c1c',
                                  color: '#ffffff',
                                  padding: '0.08rem 0.4rem',
                                  borderRadius: '4px',
                                }}
                              >
                                PAID ON PAPER · FIELD VERIFY
                              </span>
                            )}
                            {b.billInsertedOrInflated && (
                              <span
                                className="font-mono"
                                style={{
                                  fontSize: '0.62rem',
                                  fontWeight: 700,
                                  backgroundColor: '#fffbeb',
                                  color: '#b45309',
                                  border: '1px solid #fde68a',
                                  padding: '0.08rem 0.4rem',
                                  borderRadius: '4px',
                                }}
                              >
                                NASS BILL INSERTION / MARKUP
                              </span>
                            )}
                            {b.zombieRecurringLineage && (
                              <span
                                className="font-mono"
                                style={{
                                  fontSize: '0.62rem',
                                  fontWeight: 700,
                                  backgroundColor: '#faf5ff',
                                  color: '#7e22ce',
                                  border: '1px solid #e9d5ff',
                                  padding: '0.08rem 0.4rem',
                                  borderRadius: '4px',
                                }}
                              >
                                MULTI-YEAR RECURRING LINEAGE
                              </span>
                            )}
                            {b.mdaOaugfIssuesCount > 0 && (
                              <span
                                className="font-mono"
                                style={{
                                  fontSize: '0.62rem',
                                  fontWeight: 700,
                                  backgroundColor: '#fef2f2',
                                  color: '#991b1b',
                                  border: '1px solid #fecaca',
                                  padding: '0.08rem 0.4rem',
                                  borderRadius: '4px',
                                }}
                              >
                                MDA OAuGF: {b.mdaOaugfIssuesCount} Queries
                                {b.mdaOaugfRepeatCount > 0 ? ` (${b.mdaOaugfRepeatCount} Repeat)` : ''}
                              </span>
                            )}
                            {b.mdaPersonalOrOpaquePayoutFlag && (
                              <span
                                className="font-mono"
                                style={{
                                  fontSize: '0.62rem',
                                  fontWeight: 700,
                                  backgroundColor: '#eff6ff',
                                  color: '#1e40af',
                                  border: '1px solid #bfdbfe',
                                  padding: '0.08rem 0.4rem',
                                  borderRadius: '4px',
                                }}
                              >
                                STAFF / OPAQUE PAYOUT MDA
                              </span>
                            )}
                            {b.mdaIntegrityGrade && b.mdaIntegrityGrade !== 'N/A' && (
                              <span
                                className="font-mono"
                                style={{
                                  fontSize: '0.62rem',
                                  fontWeight: 700,
                                  backgroundColor:
                                    b.mdaIntegrityGrade === 'F' || b.mdaIntegrityGrade === 'D'
                                      ? '#fee2e2'
                                      : '#f1f5f9',
                                  color:
                                    b.mdaIntegrityGrade === 'F' || b.mdaIntegrityGrade === 'D'
                                      ? '#b91c1c'
                                      : '#334155',
                                  padding: '0.08rem 0.38rem',
                                  borderRadius: '4px',
                                }}
                              >
                                MDA Grade {b.mdaIntegrityGrade}
                              </span>
                            )}
                            {itemGemma && (
                              <span
                                className="font-mono"
                                style={{
                                  fontSize: '0.62rem',
                                  fontWeight: 700,
                                  backgroundColor: '#ecfdf5',
                                  color: '#047857',
                                  border: '1px solid #a7f3d0',
                                  padding: '0.08rem 0.38rem',
                                  borderRadius: '4px',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.2rem',
                                }}
                              >
                                <Sparkles size={10} /> AI Enriched
                              </span>
                            )}
                          </div>

                          <div style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            <ExpandableText text={cp.projectName} maxChars={150} />
                          </div>

                          {/* Triggered Rule Pills */}
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.32rem', marginTop: '0.3rem' }}>
                            {cp.triggeredRules.map((tr) => (
                              <span
                                key={tr.ruleId}
                                style={{
                                  fontSize: '0.67rem',
                                  fontWeight: 600,
                                  padding: '0.08rem 0.42rem',
                                  borderRadius: '4px',
                                  backgroundColor:
                                    tr.ledgerScope === 'CROSS_LEDGER' ? '#eff6ff' : 'var(--bg-canvas)',
                                  color:
                                    tr.ledgerScope === 'CROSS_LEDGER' ? '#1d4ed8' : 'var(--accent-primary)',
                                  border:
                                    tr.ledgerScope === 'CROSS_LEDGER'
                                      ? '1px solid #bfdbfe'
                                      : '1px solid var(--border-subtle)',
                                }}
                                title={tr.reason}
                              >
                                {tr.ruleName}
                              </span>
                            ))}
                          </div>

                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.22rem' }}>
                            <span>{cp.agency}</span>
                            {cp.projectCode && <span className="font-mono"> · {cp.projectCode}</span>}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            pinItem({
                              pinId,
                              kind: 'line_item',
                              financialYear: cp.financialYear,
                              projectCode: cp.projectCode,
                              title: `[${cp.ruleCount} Rules] ${cp.projectName}`,
                              mdaName: cp.agency,
                              amountNaira: cp.amount,
                              page: cp.page,
                            });
                          }}
                          className="editorial-btn"
                          style={{ padding: '0.28rem 0.5rem', fontSize: '0.68rem' }}
                          title="Pin compound project to Investigator Casebook"
                        >
                          {pinned ? <Check size={12} color="#059669" /> : <BookmarkPlus size={12} />}
                          {pinned ? 'Pinned' : 'Pin'}
                        </button>

                        <div style={{ textAlign: 'right' }}>
                          <div className="font-mono tabular-nums" style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                            {formatNaira(cp.amount || 0)}
                          </div>
                          <div className="font-mono tabular-nums" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            p.{cp.page || 1} <ExternalLink size={10} style={{ verticalAlign: 'middle' }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : /* MODE 2: INDIVIDUAL RULE FINDINGS LIST */ displayFindings.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
              <ShieldAlert size={20} style={{ marginBottom: '0.4rem', opacity: 0.5 }} />
              <div>No rule findings match the current filter in FY {financialYear}.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              {displayFindings.map((item: any, i: number) => {
                const severity = item.severity || 'low';
                const badgeBg = severity === 'high' ? '#fef2f2' : severity === 'medium' ? '#fffbeb' : '#f1f5f9';
                const badgeColor = severity === 'high' ? '#b91c1c' : severity === 'medium' ? '#b45309' : '#475569';
                const itemGemma = resolveItemGemma(item);
                const b = item.crossLedgerBadges;

                return (
                  <div
                    key={item.id || i}
                    onClick={() => onSelectProject?.(itemGemma ? { ...item, gemmaReview: itemGemma } : item)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.85rem',
                      cursor: onSelectProject ? 'pointer' : 'default',
                      padding: '0.65rem 0.75rem',
                      borderRadius: '8px',
                      border: '1px solid var(--border-subtle)',
                      backgroundColor: '#ffffff',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.7rem', flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          backgroundColor: badgeBg,
                          color: badgeColor,
                          padding: '0.18rem 0.48rem',
                          borderRadius: '4px',
                          textTransform: 'uppercase',
                          flexShrink: 0,
                          marginTop: '0.1rem',
                        }}
                      >
                        {severity}
                      </span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}>
                          <ExpandableText text={item.projectName} maxChars={140} />
                          {b?.paidOnPaper && (
                            <span className="font-mono" style={{ fontSize: '0.62rem', fontWeight: 700, backgroundColor: '#b91c1c', color: '#ffffff', padding: '0.06rem 0.36rem', borderRadius: '4px' }}>
                              PAID ON PAPER
                            </span>
                          )}
                          {itemGemma && (
                            <span
                              className="font-mono"
                              style={{
                                fontSize: '0.63rem',
                                fontWeight: 700,
                                backgroundColor: '#ecfdf5',
                                color: '#047857',
                                border: '1px solid #a7f3d0',
                                padding: '0.08rem 0.38rem',
                                borderRadius: '4px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.2rem',
                              }}
                            >
                              <Sparkles size={10} /> AI Enriched
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem', display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
                          {item.ruleName && <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{item.ruleName}</span>}
                          {item.agency && <span>· {item.agency}</span>}
                          {item.projectCode && <span className="font-mono">· {item.projectCode}</span>}
                        </div>
                        {item.reason && (
                          <div style={{ fontSize: '0.71rem', color: '#475569', marginTop: '0.15rem' }}>
                            {item.reason}
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div className="font-mono tabular-nums" style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {formatNaira(item.amount || 0)}
                      </div>
                      <div className="font-mono tabular-nums" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        p.{item.page || 1} <ExternalLink size={10} style={{ verticalAlign: 'middle' }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            <span className="font-mono tabular-nums">
              Showing {activeListLength === 0 ? 0 : (safePage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(safePage * ITEMS_PER_PAGE, activeListLength)} of {activeListLength.toLocaleString()}{' '}
              {viewMode === 'compound' ? 'projects' : 'findings'}
            </span>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={{ padding: '0.28rem 0.6rem', borderRadius: '5px', border: '1px solid var(--border-subtle)', backgroundColor: '#ffffff', color: safePage <= 1 ? 'var(--text-muted)' : 'var(--text-primary)', fontWeight: 600, cursor: safePage <= 1 ? 'default' : 'pointer' }}
              >
                Prev
              </button>
              <span className="font-mono tabular-nums" style={{ fontWeight: 700 }}>
                {safePage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                style={{ padding: '0.28rem 0.6rem', borderRadius: '5px', border: '1px solid var(--border-subtle)', backgroundColor: '#ffffff', color: safePage >= totalPages ? 'var(--text-muted)' : 'var(--text-primary)', fontWeight: 600, cursor: safePage >= totalPages ? 'default' : 'pointer' }}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
