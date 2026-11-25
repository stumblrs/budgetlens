import React, { useMemo, useState } from 'react';
import {
  BookmarkPlus,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Search,
  Split,
} from 'lucide-react';
import { useCasebook } from '../context/CasebookContext';
import { InfoHint } from './InfoHint';
import { ExpandableText } from './ExpandableText';
import type { DuplicateCluster } from '../utils/duplicateDetector';
import {
  lookupMdaRiskProfile,
  type CrossLedgerContextWire,
} from '../utils/evidenceEngineV3';
import { extractCanonicalProjectCode } from '../utils/ruleEngine';
import {
  exportDuplicateClustersDossierDocx,
  exportDuplicateClustersDossierPdf,
} from '../utils/documentExporter';

interface DuplicateClustersExplorerProps {
  clusters: DuplicateCluster[];
  financialYear: number;
  totalScannedProjects?: number;
  crossLedgerContext?: CrossLedgerContextWire | null;
  onSelectProject?: (project: any) => void;
}

interface EnrichedDuplicateCluster extends DuplicateCluster {
  paidOnPaperCount: number;
  billInsertedCount: number;
  zombieLineageCount: number;
  maxMdaOaugfIssues: number;
  maxMdaOaugfRepeat: number;
  hasPersonalOrOpaquePayoutMda: boolean;
  worstMdaGrade: string;
  sampleAgencies: string[];
  itemBadges: Array<{
    paidOnPaper: boolean;
    billInserted: boolean;
    zombieLineage: boolean;
    mdaOaugfIssues: number;
    mdaGrade: string;
    personalOrOpaquePayoutMda: boolean;
  }>;
}

const CLUSTERS_PER_PAGE = 25;
const GRADE_SEVERITY: Record<string, number> = { F: 5, D: 4, C: 3, B: 2, A: 1, 'N/A': 0 };

function formatNairaCompact(amt: number): string {
  if (!amt) return '₦0';
  if (amt >= 1e12) return `₦${(amt / 1e12).toFixed(2)}T`;
  if (amt >= 1e9) return `₦${(amt / 1e9).toFixed(2)}B`;
  if (amt >= 1e6) return `₦${(amt / 1e6).toFixed(2)}M`;
  return `₦${amt.toLocaleString()}`;
}

export const DuplicateClustersExplorer: React.FC<DuplicateClustersExplorerProps> = ({
  clusters,
  financialYear,
  totalScannedProjects = 0,
  crossLedgerContext = null,
  onSelectProject,
}) => {
  const { pinItem, isPinned } = useCasebook();
  const [query, setQuery] = useState('');
  const [patternFilter, setPatternFilter] = useState<'ALL' | DuplicateCluster['patternType']>('ALL');
  const [crossFilter, setCrossFilter] = useState<
    'ALL' | 'PAID_ON_PAPER' | 'BILL_INSERTED' | 'OAUGF_INDICTED' | 'PERSONAL_PAYOUT_MDA'
  >('ALL');
  const [sortBy, setSortBy] = useState<'amount' | 'count' | 'crossRisk'>('amount');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null);

  const enrichedClusters = useMemo<EnrichedDuplicateCluster[]>(() => {
    const popSet = crossLedgerContext?.paidOnPaperCodes
      ? new Set(crossLedgerContext.paidOnPaperCodes)
      : null;
    const billSet = crossLedgerContext?.billInsertionCodes
      ? new Set(crossLedgerContext.billInsertionCodes)
      : null;
    const zombieSet = crossLedgerContext?.zombieLineageCodes
      ? new Set(crossLedgerContext.zombieLineageCodes)
      : null;

    return clusters.map((c) => {
      let paidOnPaperCount = 0;
      let billInsertedCount = 0;
      let zombieLineageCount = 0;
      let maxMdaOaugfIssues = 0;
      let maxMdaOaugfRepeat = 0;
      let hasPersonalOrOpaquePayoutMda = false;
      let worstMdaGrade = 'N/A';
      const agenciesSet = new Set<string>();

      const itemBadges = c.projects.map((p) => {
        if (p.agency) agenciesSet.add(p.agency);
        const ucode = extractCanonicalProjectCode(p.projectCode, p.projectName);
        const paidOnPaper = Boolean(ucode && popSet?.has(ucode));
        const billInserted = Boolean(ucode && billSet?.has(ucode));
        const zombieLineage = Boolean(ucode && zombieSet?.has(ucode));
        if (paidOnPaper) paidOnPaperCount += 1;
        if (billInserted) billInsertedCount += 1;
        if (zombieLineage) zombieLineageCount += 1;

        const mdaProf = lookupMdaRiskProfile(crossLedgerContext, p.agency);
        const mdaOaugfIssues = mdaProf?.oi || 0;
        const mdaGrade = mdaProf?.g || 'N/A';
        const personalOrOpaquePayoutMda = Boolean(mdaProf?.po);

        if (mdaOaugfIssues > maxMdaOaugfIssues) maxMdaOaugfIssues = mdaOaugfIssues;
        if ((mdaProf?.or || 0) > maxMdaOaugfRepeat) maxMdaOaugfRepeat = mdaProf?.or || 0;
        if (personalOrOpaquePayoutMda) hasPersonalOrOpaquePayoutMda = true;
        if ((GRADE_SEVERITY[mdaGrade] || 0) > (GRADE_SEVERITY[worstMdaGrade] || 0)) {
          worstMdaGrade = mdaGrade;
        }

        return {
          paidOnPaper,
          billInserted,
          zombieLineage,
          mdaOaugfIssues,
          mdaGrade,
          personalOrOpaquePayoutMda,
        };
      });

      return {
        ...c,
        paidOnPaperCount,
        billInsertedCount,
        zombieLineageCount,
        maxMdaOaugfIssues,
        maxMdaOaugfRepeat,
        hasPersonalOrOpaquePayoutMda,
        worstMdaGrade,
        sampleAgencies: Array.from(agenciesSet),
        itemBadges,
      };
    });
  }, [clusters, crossLedgerContext]);

  const stats = useMemo(() => {
    let totalItems = 0;
    let totalValue = 0;
    let disguisedCount = 0;
    let crossMda = 0;
    let sameMdaSplit = 0;
    let paidOnPaperClusterCount = 0;
    let billInsertedClusterCount = 0;
    let oaugfFlaggedClusterCount = 0;
    for (const c of enrichedClusters) {
      totalItems += c.count;
      totalValue += c.totalAmount;
      if (c.patternType === 'Disguised Rewording') disguisedCount++;
      else if (c.patternType === 'Cross-MDA Duplicate') crossMda++;
      else if (c.patternType === 'Same-MDA Split') sameMdaSplit++;
      if (c.paidOnPaperCount > 0) paidOnPaperClusterCount++;
      if (c.billInsertedCount > 0) billInsertedClusterCount++;
      if (c.maxMdaOaugfIssues >= 5) oaugfFlaggedClusterCount++;
    }
    return {
      totalItems,
      totalValue,
      disguisedCount,
      crossMda,
      sameMdaSplit,
      paidOnPaperClusterCount,
      billInsertedClusterCount,
      oaugfFlaggedClusterCount,
    };
  }, [enrichedClusters]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = enrichedClusters.filter((c) => {
      if (patternFilter !== 'ALL' && c.patternType !== patternFilter) return false;
      if (crossFilter === 'PAID_ON_PAPER' && c.paidOnPaperCount === 0) return false;
      if (crossFilter === 'BILL_INSERTED' && c.billInsertedCount === 0) return false;
      if (crossFilter === 'OAUGF_INDICTED' && c.maxMdaOaugfIssues < 5) return false;
      if (crossFilter === 'PERSONAL_PAYOUT_MDA' && !c.hasPersonalOrOpaquePayoutMda) return false;
      if (!q) return true;
      if (c.canonicalTitle.toLowerCase().includes(q)) return true;
      if (c.sector.toLowerCase().includes(q)) return true;
      return c.projects.some(
        (p) =>
          (p.projectCode || '').toLowerCase().includes(q) ||
          (p.agency || '').toLowerCase().includes(q) ||
          (p.state || '').toLowerCase().includes(q)
      );
    });
    return [...list].sort((a, b) => {
      if (sortBy === 'crossRisk') {
        const scoreA =
          a.paidOnPaperCount * 30 +
          a.billInsertedCount * 20 +
          (a.maxMdaOaugfIssues >= 10 ? 15 : 0) +
          (a.hasPersonalOrOpaquePayoutMda ? 10 : 0);
        const scoreB =
          b.paidOnPaperCount * 30 +
          b.billInsertedCount * 20 +
          (b.maxMdaOaugfIssues >= 10 ? 15 : 0) +
          (b.hasPersonalOrOpaquePayoutMda ? 10 : 0);
        if (scoreB !== scoreA) return scoreB - scoreA;
      }
      return sortBy === 'count'
        ? b.count - a.count || b.totalAmount - a.totalAmount
        : b.totalAmount - a.totalAmount || b.count - a.count;
    });
  }, [enrichedClusters, patternFilter, crossFilter, query, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / CLUSTERS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * CLUSTERS_PER_PAGE, safePage * CLUSTERS_PER_PAGE);

  const badgeStyle = (pattern: DuplicateCluster['patternType']) => {
    if (pattern === 'Disguised Rewording') {
      return { bg: '#faf5ff', color: '#7e22ce', border: '#e9d5ff' };
    }
    if (pattern === 'Cross-MDA Duplicate') {
      return { bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' };
    }
    if (pattern === 'Same-MDA Split') {
      return { bg: '#fffbeb', color: '#b45309', border: '#fde68a' };
    }
    return { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' };
  };

  const handleExport = async (fmt: 'pdf' | 'docx') => {
    if (exportingFormat) return;
    setExportingFormat(fmt);
    try {
      const exportInput = {
        financialYear,
        filterSummary: [
          patternFilter === 'ALL' ? 'All Duplicate Patterns' : patternFilter,
          crossFilter !== 'ALL' ? `6-Ledger Filter: ${crossFilter}` : null,
          query.trim() ? `Query: "${query.trim()}"` : null,
        ]
          .filter(Boolean)
          .join(' | '),
        totalClusters: filtered.length,
        totalItems: filtered.reduce((s, c) => s + c.count, 0),
        totalValueNaira: filtered.reduce((s, c) => s + c.totalAmount, 0),
        paidOnPaperClusterCount: stats.paidOnPaperClusterCount,
        billInsertedClusterCount: stats.billInsertedClusterCount,
        oaugfFlaggedClusterCount: stats.oaugfFlaggedClusterCount,
        clusters: filtered.slice(0, 50).map((c) => ({
          id: c.id,
          patternType: c.patternType,
          canonicalTitle: c.canonicalTitle,
          count: c.count,
          distinctAgencies: c.distinctAgencies,
          distinctStates: c.distinctStates,
          totalAmount: c.totalAmount,
          paidOnPaperCount: c.paidOnPaperCount,
          billInsertedCount: c.billInsertedCount,
          maxMdaOaugfIssues: c.maxMdaOaugfIssues,
          worstMdaGrade: c.worstMdaGrade,
          sampleAgencies: c.sampleAgencies,
        })),
        permalink: typeof window !== 'undefined' ? window.location.href : undefined,
      };
      if (fmt === 'pdf') await exportDuplicateClustersDossierPdf(exportInput);
      else await exportDuplicateClustersDossierDocx(exportInput);
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Editorial Header */}
      <div className="dossier-card" style={{ padding: '1.35rem 1.5rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.25rem' }}>
              <Copy size={14} style={{ color: 'var(--accent-primary)' }} />
              <span className="font-mono" style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--accent-primary)' }}>
                FY {financialYear} Duplicate &amp; Split-Allocation Audit · 6-Ledger Reality Check
              </span>
            </div>
            <h1 className="font-editorial" style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Duplicate Detector &amp; Allocation Split Explorer
            </h1>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Full-dataset scan across {totalScannedProjects > 0 ? totalScannedProjects.toLocaleString() : 'all'} extracted line items identifying cross-MDA duplicates and same-agency allocation splits, cross-checked against Paid-on-Paper disbursements, NASS Bill insertions, and OAuGF audit queries.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={exportingFormat !== null}
              onClick={() => handleExport('pdf')}
              className="editorial-btn-primary"
              style={{ padding: '0.42rem 0.78rem', fontSize: '0.74rem' }}
            >
              <FileText size={13} />
              {exportingFormat === 'pdf' ? 'Exporting PDF...' : 'Export Duplicate Dossier (PDF)'}
            </button>
            <button
              type="button"
              disabled={exportingFormat !== null}
              onClick={() => handleExport('docx')}
              className="editorial-btn"
              style={{ padding: '0.42rem 0.78rem', fontSize: '0.74rem' }}
            >
              <Download size={13} color="#059669" />
              {exportingFormat === 'docx' ? 'Exporting DOCX...' : 'Export DOCX'}
            </button>
          </div>
        </div>
      </div>

      {/* 4-Metric KPI Strip */}
      <div className="grid-4-cols">
        <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
            Detected Clusters
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.25rem' }}>
            {clusters.length.toLocaleString()}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            {stats.totalItems.toLocaleString()} individual line items
          </div>
        </div>

        <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
            Clustered Exposure
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.4rem', fontWeight: 700, color: '#b45309', marginTop: '0.25rem' }}>
            {formatNairaCompact(stats.totalValue)}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Combined value in clusters</div>
        </div>

        <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
            Paid-on-Paper / NASS Inserted
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.35rem', fontWeight: 700, color: '#b91c1c', marginTop: '0.25rem' }}>
            {stats.paidOnPaperClusterCount} / {stats.billInsertedClusterCount}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Clusters with cash payout / NASS insertion
          </div>
        </div>

        <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
            Disguised / Cross-MDA / OAuGF
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#7e22ce', marginTop: '0.25rem' }}>
            {stats.disguisedCount} / {stats.crossMda} / {stats.oaugfFlaggedClusterCount}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Reworded / Multi-MDA / OAuGF-queried MDAs
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="dossier-card" style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: '380px' }}>
            <Search size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Filter clusters by title, MDA, code, or state..."
              style={{
                width: '100%',
                padding: '0.48rem 0.75rem 0.48rem 2.2rem',
                borderRadius: '7px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--bg-canvas)',
                fontSize: '0.82rem',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'center' }}>
            <InfoHint
              term="Duplicate Pattern Types"
              meaning="Disguised Rewording = same deliverable with swapped verbs (e.g. 'Construction' vs 'Provision'). Cross-MDA = repeated across different ministries. Same-MDA Split = broken into multiple lines inside one ministry."
              whyItMatters="Splitting or rewording identical projects can bypass procurement thresholds or hide double-budgeting."
            />
            {(['ALL', 'Disguised Rewording', 'Cross-MDA Duplicate', 'Same-MDA Split', 'Multi-Location Repeat'] as const).map((pat) => (
              <button
                key={pat}
                type="button"
                onClick={() => {
                  setPatternFilter(pat);
                  setPage(1);
                }}
                style={{
                  padding: '0.35rem 0.7rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  backgroundColor: patternFilter === pat ? '#091017' : '#ffffff',
                  color: patternFilter === pat ? '#ffffff' : 'var(--text-secondary)',
                }}
              >
                {pat === 'ALL' ? 'All Patterns' : pat}
              </button>
            ))}

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'amount' | 'count' | 'crossRisk')}
              style={{
                padding: '0.38rem 0.65rem',
                borderRadius: '6px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: '#ffffff',
                fontSize: '0.76rem',
                fontWeight: 600,
                color: 'var(--text-primary)',
              }}
            >
              <option value="amount">Sort: Highest Value (₦)</option>
              <option value="crossRisk">Sort: Highest 6-Ledger Risk</option>
              <option value="count">Sort: Most Repeats</option>
            </select>
          </div>
        </div>

        {/* 6-Ledger Quick Filter Pills */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center', paddingTop: '0.5rem', borderTop: '1px solid var(--border-subtle)' }}>
          <span className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 700 }}>
            6-Ledger Reality Filter:
          </span>
          {(
            [
              { id: 'ALL', label: `All Clusters (${enrichedClusters.length})` },
              { id: 'PAID_ON_PAPER', label: `Paid on Paper (${stats.paidOnPaperClusterCount})` },
              { id: 'BILL_INSERTED', label: `Legislative Insertions (${stats.billInsertedClusterCount})` },
              { id: 'OAUGF_INDICTED', label: `OAuGF-Queried MDAs (${stats.oaugfFlaggedClusterCount})` },
              { id: 'PERSONAL_PAYOUT_MDA', label: 'Personal/Staff-Account Payout MDAs' },
            ] as const
          ).map((pill) => (
            <button
              key={pill.id}
              type="button"
              onClick={() => {
                setCrossFilter(pill.id);
                setPage(1);
              }}
              style={{
                padding: '0.24rem 0.6rem',
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
      </div>

      {/* Clusters List */}
      <div className="dossier-card" style={{ overflow: 'hidden' }}>
        {pageItems.length === 0 ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            <Split size={22} style={{ marginBottom: '0.5rem', opacity: 0.5 }} />
            <div>No duplicate clusters match the current filters in FY {financialYear}.</div>
          </div>
        ) : (
          <div>
            {pageItems.map((cluster) => {
              const isOpen = expandedId === cluster.id;
              const bs = badgeStyle(cluster.patternType);
              return (
                <div key={cluster.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    onClick={() => setExpandedId(isOpen ? null : cluster.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setExpandedId(isOpen ? null : cluster.id);
                      }
                    }}
                    style={{
                      width: '100%',
                      background: isOpen ? 'var(--bg-canvas)' : '#ffffff',
                      padding: '0.95rem 1.25rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '1rem',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', flex: 1, minWidth: 0 }}>
                      <span style={{ marginTop: '0.15rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                        {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', marginBottom: '0.22rem' }}>
                          <span className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                            {cluster.id}
                          </span>
                          <span
                            style={{
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              padding: '0.1rem 0.45rem',
                              borderRadius: '4px',
                              backgroundColor: bs.bg,
                              color: bs.color,
                              border: `1px solid ${bs.border}`,
                            }}
                          >
                            {cluster.patternType}
                          </span>
                          <span className="font-mono tabular-nums" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {cluster.distinctAgencies} MDA{cluster.distinctAgencies > 1 ? 's' : ''}
                            {cluster.distinctStates > 0 ? ` · ${cluster.distinctStates} State${cluster.distinctStates > 1 ? 's' : ''}` : ''}
                          </span>
                          {cluster.paidOnPaperCount > 0 && (
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
                              {cluster.paidOnPaperCount} PAID ON PAPER
                            </span>
                          )}
                          {cluster.billInsertedCount > 0 && (
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
                              {cluster.billInsertedCount} NASS INSERTED
                            </span>
                          )}
                          {cluster.maxMdaOaugfIssues > 0 && (
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
                              MDA OAuGF: {cluster.maxMdaOaugfIssues} Queries
                            </span>
                          )}
                          {cluster.hasPersonalOrOpaquePayoutMda && (
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
                          {cluster.worstMdaGrade !== 'N/A' && (
                            <span
                              className="font-mono"
                              style={{
                                fontSize: '0.62rem',
                                fontWeight: 700,
                                backgroundColor:
                                  cluster.worstMdaGrade === 'F' || cluster.worstMdaGrade === 'D'
                                    ? '#fee2e2'
                                    : '#f1f5f9',
                                color:
                                  cluster.worstMdaGrade === 'F' || cluster.worstMdaGrade === 'D'
                                    ? '#b91c1c'
                                    : '#334155',
                                padding: '0.08rem 0.36rem',
                                borderRadius: '4px',
                              }}
                            >
                              MDA Grade {cluster.worstMdaGrade}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                          <ExpandableText text={cluster.canonicalTitle} maxChars={150} />
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexShrink: 0 }}>
                      <div style={{ textAlign: 'right' }}>
                        <div className="font-mono tabular-nums" style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {cluster.count}×
                        </div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Repeats</div>
                      </div>
                      <div style={{ textAlign: 'right', minWidth: '90px' }}>
                        <div className="font-mono tabular-nums" style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--accent-primary)' }}>
                          {formatNairaCompact(cluster.totalAmount)}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Cluster Total</div>
                      </div>
                    </div>
                  </div>

                  {isOpen && (
                    <div style={{ backgroundColor: 'var(--bg-canvas)', padding: '0 1.25rem 1rem 2.75rem', overflowX: 'auto' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0.5rem 0' }}>
                        <button
                          type="button"
                          onClick={() =>
                            pinItem({
                              pinId: `duplicate_cluster:${financialYear}:${cluster.id}`,
                              kind: 'duplicate_cluster',
                              financialYear,
                              projectCode: cluster.id,
                              title: `[${cluster.patternType}] ${cluster.canonicalTitle} (${cluster.count}×)`,
                              mdaName: `${cluster.distinctAgencies} Agencies`,
                              amountNaira: cluster.totalAmount,
                            })
                          }
                          className="editorial-btn"
                          style={{ fontSize: '0.72rem', padding: '0.28rem 0.6rem' }}
                        >
                          {isPinned(`duplicate_cluster:${financialYear}:${cluster.id}`) ? <Check size={12} color="#059669" /> : <BookmarkPlus size={12} />}
                          {isPinned(`duplicate_cluster:${financialYear}:${cluster.id}`) ? 'Pinned to Casebook' : 'Pin Cluster to Casebook'}
                        </button>
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', backgroundColor: '#ffffff', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
                        <thead>
                          <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', textAlign: 'left' }}>
                            <th style={{ padding: '0.55rem 0.75rem' }}>Code</th>
                            <th style={{ padding: '0.55rem 0.75rem' }}>Line Item</th>
                            <th style={{ padding: '0.55rem 0.75rem' }}>MDA</th>
                            <th style={{ padding: '0.55rem 0.75rem' }}>6-Ledger Reality</th>
                            <th style={{ padding: '0.55rem 0.75rem' }}>Location</th>
                            <th style={{ padding: '0.55rem 0.75rem', textAlign: 'right' }}>Amount (₦)</th>
                            <th style={{ padding: '0.55rem 0.75rem', textAlign: 'center' }}>Page</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cluster.projects.map((p, idx) => {
                            const ib = cluster.itemBadges[idx];
                            return (
                              <tr
                                key={p.id || idx}
                                onClick={() =>
                                  onSelectProject?.({
                                    ...p,
                                    financialYear,
                                    sector: cluster.sector,
                                  })
                                }
                                style={{
                                  borderBottom: idx < cluster.projects.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                                  cursor: onSelectProject ? 'pointer' : 'default',
                                }}
                              >
                                <td className="font-mono" style={{ padding: '0.5rem 0.75rem', color: 'var(--accent-primary)', fontWeight: 600 }}>
                                  {p.projectCode || p.id}
                                </td>
                                <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-primary)', fontWeight: 500, maxWidth: '300px' }}>
                                  <ExpandableText text={p.projectName} maxChars={160} />
                                </td>
                                <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-secondary)' }}>
                                  {p.agency || 'Federal MDA'}
                                </td>
                                <td style={{ padding: '0.5rem 0.75rem' }}>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.28rem' }}>
                                    {ib?.paidOnPaper && (
                                      <span className="font-mono" style={{ fontSize: '0.6rem', fontWeight: 700, backgroundColor: '#b91c1c', color: '#ffffff', padding: '0.06rem 0.34rem', borderRadius: '4px' }}>
                                        PAID ON PAPER
                                      </span>
                                    )}
                                    {ib?.billInserted && (
                                      <span className="font-mono" style={{ fontSize: '0.6rem', fontWeight: 700, backgroundColor: '#fffbeb', color: '#b45309', border: '1px solid #fde68a', padding: '0.06rem 0.34rem', borderRadius: '4px' }}>
                                        NASS INSERTED
                                      </span>
                                    )}
                                    {ib?.mdaOaugfIssues > 0 && (
                                      <span className="font-mono" style={{ fontSize: '0.6rem', fontWeight: 700, backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', padding: '0.06rem 0.34rem', borderRadius: '4px' }}>
                                        OAuGF:{ib.mdaOaugfIssues}
                                      </span>
                                    )}
                                    {!ib?.paidOnPaper && !ib?.billInserted && !ib?.mdaOaugfIssues && (
                                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Schedule repeat</span>
                                    )}
                                  </div>
                                </td>
                                <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)' }}>
                                  {p.state || '—'}
                                </td>
                                <td className="font-mono tabular-nums" style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>
                                  ₦{p.amount.toLocaleString()}
                                </td>
                                <td className="font-mono tabular-nums" style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                                  p.{p.page} <ExternalLink size={11} style={{ verticalAlign: 'middle' }} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.8rem 1.25rem', backgroundColor: 'var(--bg-canvas)', borderTop: '1px solid var(--border-subtle)', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
          <span className="font-mono tabular-nums">
            Showing {filtered.length === 0 ? 0 : (safePage - 1) * CLUSTERS_PER_PAGE + 1}–{Math.min(safePage * CLUSTERS_PER_PAGE, filtered.length)} of {filtered.length.toLocaleString()} clusters
          </span>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              style={{ padding: '0.3rem 0.65rem', borderRadius: '5px', border: '1px solid var(--border-subtle)', backgroundColor: '#ffffff', color: safePage <= 1 ? 'var(--text-muted)' : 'var(--text-primary)', fontWeight: 600, cursor: safePage <= 1 ? 'default' : 'pointer' }}
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
              style={{ padding: '0.3rem 0.65rem', borderRadius: '5px', border: '1px solid var(--border-subtle)', backgroundColor: '#ffffff', color: safePage >= totalPages ? 'var(--text-muted)' : 'var(--text-primary)', fontWeight: 600, cursor: safePage >= totalPages ? 'default' : 'pointer' }}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
