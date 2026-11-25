import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FolderKanban,
  Search,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { ExpandableText } from './ExpandableText';
import {
  buildCompoundProjectLookup,
  findCompoundForProject,
  type CompoundFlaggedProject,
} from '../utils/ruleEngine';
import { buildRecordDossierUrl } from '../utils/recordDossier';
import { isValidGemmaReview } from '../utils/gemmaReview';
import { formatNairaCompact, formatNairaExact } from '../utils/reportExporter';
import {
  exportTabularDossierDocx,
  exportTabularDossierPdf,
  type TabularDossierSpec,
} from '../utils/documentExporter';
import { buildCanonicalPermalink } from '../utils/urlState';

export type ProjectQuickFilter =
  | 'all'
  | 'flagged'
  | 'crossLedger'
  | 'paidOnPaper'
  | 'nassInsertion'
  | 'oaugfMda'
  | 'zombieLineage'
  | 'aiEnriched';

export type ProjectSortOption =
  | 'amount-desc'
  | 'risk-desc'
  | 'amount-asc'
  | 'page-asc'
  | 'default';

interface CapitalProjectsDirectoryProps {
  financialYear: number;
  projects: any[];
  compoundProjects: CompoundFlaggedProject[];
  isScanningForensics?: boolean;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onSelectProject: (project: any) => void;
}

const PROJECTS_PER_PAGE = 50;

const FILTER_LABELS: Record<ProjectQuickFilter, string> = {
  all: 'All Projects',
  flagged: 'Flagged Only',
  crossLedger: 'Cross-Ledger Only',
  paidOnPaper: 'Paid on Paper',
  nassInsertion: 'NASS Insertion',
  oaugfMda: 'OAuGF-Indicted MDA',
  zombieLineage: 'Zombie Lineage',
  aiEnriched: 'AI Enriched Only',
};

function getRiskScoreBadgeStyle(score: number): {
  bg: string;
  color: string;
  border: string;
} {
  if (score >= 60) {
    return { bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' };
  }
  if (score >= 35) {
    return { bg: '#fffbeb', color: '#b45309', border: '#fde68a' };
  }
  return { bg: '#f1f5f9', color: '#334155', border: '#cbd5e1' };
}

function summarizeBadgesText(compound: CompoundFlaggedProject | null): string {
  if (!compound) return 'No rule trigger';
  const tags: string[] = [];
  const b = compound.crossLedgerBadges;
  if (b.paidOnPaper) tags.push('Paid on Paper');
  if (b.billInsertedOrInflated) tags.push('NASS Insertion');
  if (b.mdaOaugfIssuesCount > 0) tags.push(`OAuGF MDA (${b.mdaOaugfIssuesCount})`);
  if (b.zombieRecurringLineage) tags.push('Zombie Lineage');
  if (b.mdaPersonalOrOpaquePayoutFlag) tags.push('Personal/Opaque MDA');
  if (tags.length === 0) {
    return `${compound.ruleCount} rule(s): ${compound.triggeredRules
      .slice(0, 2)
      .map((r) => r.ruleName)
      .join('; ')}`;
  }
  return `${compound.ruleCount} rule(s) · ${tags.join(', ')}`;
}

export const CapitalProjectsDirectory: React.FC<CapitalProjectsDirectoryProps> = ({
  financialYear,
  projects,
  compoundProjects,
  isScanningForensics = false,
  searchQuery,
  onSearchQueryChange,
  onSelectProject,
}) => {
  const [quickFilter, setQuickFilter] = useState<ProjectQuickFilter>('all');
  const [projectSort, setProjectSort] = useState<ProjectSortOption>('amount-desc');
  const [projectPage, setProjectPage] = useState(1);
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null);

  useEffect(() => {
    setQuickFilter((prev) => (prev === 'aiEnriched' ? 'all' : prev));
  }, [financialYear]);

  useEffect(() => {
    setProjectPage(1);
  }, [searchQuery, projectSort, quickFilter, financialYear]);

  const compoundLookup = useMemo(
    () => buildCompoundProjectLookup(compoundProjects),
    [compoundProjects]
  );

  const enrichedRows = useMemo(() => {
    return projects.map((p) => {
      const compound = findCompoundForProject(compoundLookup, financialYear, p);
      const hasAi = isValidGemmaReview(p?.gemmaReview);
      return {
        project: p,
        compound,
        hasAi,
      };
    });
  }, [projects, compoundLookup, financialYear]);

  const filterCounts = useMemo(() => {
    let flagged = 0;
    let crossLedger = 0;
    let paidOnPaper = 0;
    let nassInsertion = 0;
    let oaugfMda = 0;
    let zombieLineage = 0;
    let aiEnriched = 0;

    for (const row of enrichedRows) {
      if (row.hasAi) aiEnriched += 1;
      const c = row.compound;
      if (!c) continue;
      flagged += 1;
      const b = c.crossLedgerBadges;
      if (
        c.crossLedgerRuleCount > 0 ||
        b.paidOnPaper ||
        b.billInsertedOrInflated ||
        b.mdaOaugfIssuesCount > 0 ||
        b.zombieRecurringLineage
      ) {
        crossLedger += 1;
      }
      if (b.paidOnPaper) paidOnPaper += 1;
      if (b.billInsertedOrInflated) nassInsertion += 1;
      if (b.mdaOaugfIssuesCount > 0) oaugfMda += 1;
      if (b.zombieRecurringLineage) zombieLineage += 1;
    }

    return {
      all: enrichedRows.length,
      flagged,
      crossLedger,
      paidOnPaper,
      nassInsertion,
      oaugfMda,
      zombieLineage,
      aiEnriched,
    };
  }, [enrichedRows]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const matched = enrichedRows.filter(({ project: p, compound: c, hasAi }) => {
      if (quickFilter === 'aiEnriched' && !hasAi) return false;
      if (quickFilter === 'flagged' && !c) return false;
      if (quickFilter === 'crossLedger') {
        if (!c) return false;
        const b = c.crossLedgerBadges;
        if (
          c.crossLedgerRuleCount === 0 &&
          !b.paidOnPaper &&
          !b.billInsertedOrInflated &&
          b.mdaOaugfIssuesCount === 0 &&
          !b.zombieRecurringLineage
        ) {
          return false;
        }
      }
      if (quickFilter === 'paidOnPaper' && !c?.crossLedgerBadges.paidOnPaper) return false;
      if (quickFilter === 'nassInsertion' && !c?.crossLedgerBadges.billInsertedOrInflated) {
        return false;
      }
      if (quickFilter === 'oaugfMda' && !(c && c.crossLedgerBadges.mdaOaugfIssuesCount > 0)) {
        return false;
      }
      if (quickFilter === 'zombieLineage' && !c?.crossLedgerBadges.zombieRecurringLineage) {
        return false;
      }

      if (!q) return true;
      return (
        (p.projectName || '').toLowerCase().includes(q) ||
        (p.projectCode && String(p.projectCode).toLowerCase().includes(q)) ||
        (p.agency && String(p.agency).toLowerCase().includes(q))
      );
    });

    const sorted = [...matched];
    if (projectSort === 'risk-desc') {
      sorted.sort(
        (a, b) =>
          (b.compound?.compoundRiskScore || 0) - (a.compound?.compoundRiskScore || 0) ||
          (b.compound?.ruleCount || 0) - (a.compound?.ruleCount || 0) ||
          (b.project.amount || 0) - (a.project.amount || 0)
      );
    } else if (projectSort === 'amount-desc') {
      sorted.sort((a, b) => (b.project.amount || 0) - (a.project.amount || 0));
    } else if (projectSort === 'amount-asc') {
      sorted.sort((a, b) => (a.project.amount || 0) - (b.project.amount || 0));
    } else if (projectSort === 'page-asc') {
      sorted.sort((a, b) => (a.project.page || 0) - (b.project.page || 0));
    }
    return sorted;
  }, [enrichedRows, searchQuery, quickFilter, projectSort]);

  const filteredSummary = useMemo(() => {
    let totalAmountNaira = 0;
    let flaggedInFilter = 0;
    let crossLedgerInFilter = 0;
    let paidOrInsertedInFilter = 0;

    for (const r of filteredRows) {
      totalAmountNaira += Number(r.project.amount || 0);
      if (r.compound) {
        flaggedInFilter += 1;
        const b = r.compound.crossLedgerBadges;
        if (
          r.compound.crossLedgerRuleCount > 0 ||
          b.paidOnPaper ||
          b.billInsertedOrInflated ||
          b.mdaOaugfIssuesCount > 0 ||
          b.zombieRecurringLineage
        ) {
          crossLedgerInFilter += 1;
        }
        if (b.paidOnPaper || b.billInsertedOrInflated) {
          paidOrInsertedInFilter += 1;
        }
      }
    }
    return {
      totalAmountNaira,
      flaggedInFilter,
      crossLedgerInFilter,
      paidOrInsertedInFilter,
    };
  }, [filteredRows]);

  const totalProjectPages = Math.max(1, Math.ceil(filteredRows.length / PROJECTS_PER_PAGE));
  const paginatedRows = filteredRows.slice(
    (projectPage - 1) * PROJECTS_PER_PAGE,
    projectPage * PROJECTS_PER_PAGE
  );

  const handleExportFiltered = async (format: 'pdf' | 'docx') => {
    if (exportingFormat) return;
    setExportingFormat(format);
    try {
      const topRows = filteredRows.slice(0, 80);
      const spec: TabularDossierSpec = {
        filenameBase: `BudgetLens_Capital_Projects_${quickFilter}_FY${financialYear}`,
        eyebrow: `BUDGETLENS CAPITAL PROJECTS WORKBENCH | FY ${financialYear}`,
        title: `Filtered Capital Projects Schedule (FY ${financialYear})`,
        subtitle: `Filter: ${FILTER_LABELS[quickFilter]}${searchQuery.trim() ? ` | Query: "${searchQuery.trim()}"` : ''} | Matching Rows: ${filteredRows.length.toLocaleString('en-US')}`,
        orientation: 'landscape',
        metadata: [
          { label: 'Fiscal Year', value: `FY ${financialYear}` },
          { label: 'Active Filter', value: FILTER_LABELS[quickFilter] },
          { label: 'Search Query', value: searchQuery.trim() || 'None (All Matching)' },
          { label: 'Matching Total', value: formatNairaCompact(filteredSummary.totalAmountNaira) },
        ],
        kpis: [
          {
            label: 'Matching Line Items',
            value: filteredRows.length.toLocaleString('en-US'),
            subtext: `of ${projects.length.toLocaleString('en-US')} FY ${financialYear} items`,
          },
          {
            label: 'Filtered Enacted Value',
            value: formatNairaCompact(filteredSummary.totalAmountNaira),
            subtext: formatNairaExact(filteredSummary.totalAmountNaira),
          },
          {
            label: 'Evidence Engine v3.0 Flagged',
            value: filteredSummary.flaggedInFilter.toLocaleString('en-US'),
            subtext: `${filteredSummary.crossLedgerInFilter.toLocaleString('en-US')} with cross-ledger flags`,
          },
          {
            label: 'Paid-on-Paper / Inserted',
            value: filteredSummary.paidOrInsertedInFilter.toLocaleString('en-US'),
            subtext: 'Direct execution or Bill-vs-Act delta hits',
          },
        ],
        narrative: `Filtered capital schedule export combining verbatim FY ${financialYear} Federal Appropriation Act line items with Evidence Engine v3.0 compound risk scores (0–100) and cross-ledger accountability badges (Paid-on-Paper, National Assembly Bill-vs-Act Insertion, OAuGF MDA Query History, and Zombie Recurring Lineage).`,
        tables: [
          {
            heading: `Top ${topRows.length} Matching Capital Line Items (${filteredRows.length.toLocaleString('en-US')} total matches)`,
            columns: [
              'Code / Page',
              'Verbatim Project Title',
              'Executing MDA',
              'Risk Score',
              'Cross-Ledger & Rule Signals',
              'Enacted (NGN)',
            ],
            rows:
              topRows.length > 0
                ? topRows.map(({ project: p, compound: c }) => [
                    `${p.projectCode || 'ERGP'} (p.${p.page || 0})`,
                    String(p.projectName || '').slice(0, 88),
                    String(p.agency || 'Federal MDA').slice(0, 40),
                    c ? `${c.compoundRiskScore}/100` : '—',
                    summarizeBadgesText(c).slice(0, 82),
                    formatNairaExact(Number(p.amount || 0)),
                  ])
                : [['-', 'No capital line items matched current filter', '-', '-', '-', '-']],
            rightAlignColumns: [3, 5],
          },
        ],
        permalink: buildCanonicalPermalink({
          tab: 'projects',
          year: financialYear,
        }),
        footnote:
          'Sources: Federal Appropriation Act Schedules, Evidence Engine v3.0 (22 rules), Bill-vs-Act Diffs, BPP NOCOPO, OAGF Open Treasury, and OAuGF Constitutional Audit Reports.',
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

  const quickFilterPills: Array<{
    id: ProjectQuickFilter;
    label: string;
    count: number;
    tone?: 'danger' | 'amber' | 'emerald' | 'slate';
  }> = [
    { id: 'all', label: 'All Projects', count: filterCounts.all, tone: 'slate' },
    { id: 'flagged', label: 'Flagged Only', count: filterCounts.flagged, tone: 'amber' },
    {
      id: 'crossLedger',
      label: 'Cross-Ledger Only',
      count: filterCounts.crossLedger,
      tone: 'danger',
    },
    { id: 'paidOnPaper', label: 'Paid on Paper', count: filterCounts.paidOnPaper, tone: 'danger' },
    {
      id: 'nassInsertion',
      label: 'NASS Insertion',
      count: filterCounts.nassInsertion,
      tone: 'amber',
    },
    { id: 'oaugfMda', label: 'OAuGF-Indicted MDA', count: filterCounts.oaugfMda, tone: 'amber' },
    {
      id: 'zombieLineage',
      label: 'Zombie Lineage',
      count: filterCounts.zombieLineage,
      tone: 'slate',
    },
    ...(filterCounts.aiEnriched > 0
      ? [
          {
            id: 'aiEnriched' as const,
            label: 'AI Enriched Only',
            count: filterCounts.aiEnriched,
            tone: 'emerald' as const,
          },
        ]
      : []),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
      {/* Header & Controls */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
            <h2
              style={{
                fontSize: '1.25rem',
                fontWeight: 700,
                color: '#0f172a',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                margin: 0,
              }}
            >
              <FolderKanban color="#10b981" /> Capital Projects Workbench ({financialYear})
            </h2>
            {isScanningForensics && (
              <span
                className="editorial-pill font-mono"
                style={{
                  backgroundColor: 'var(--emerald-bg)',
                  color: '#047857',
                  borderColor: '#a7f3d0',
                }}
              >
                Scoring risk rules...
              </span>
            )}
            {filterCounts.aiEnriched > 0 && (
              <span
                className="editorial-pill font-mono"
                style={{
                  backgroundColor: '#ecfdf5',
                  color: '#047857',
                  borderColor: '#a7f3d0',
                  fontWeight: 700,
                }}
              >
                <Sparkles size={12} color="#059669" /> {filterCounts.aiEnriched.toLocaleString('en-US')}{' '}
                AI Enriched · Live
              </span>
            )}
          </div>
          <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0.25rem 0 0' }}>
            Searchable catalog of {projects.length.toLocaleString('en-US')} official capital line items
            joined with Evidence Engine v3.0 compound risk scores &amp; cross-ledger signals
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            disabled={exportingFormat !== null || filteredRows.length === 0}
            onClick={() => handleExportFiltered('pdf')}
            className="editorial-btn-primary"
            style={{ fontSize: '0.74rem', padding: '0.42rem 0.72rem' }}
          >
            <Download size={13} /> {exportingFormat === 'pdf' ? 'Exporting PDF...' : 'Export Filtered (PDF)'}
          </button>
          <button
            type="button"
            disabled={exportingFormat !== null || filteredRows.length === 0}
            onClick={() => handleExportFiltered('docx')}
            className="editorial-btn"
            style={{ fontSize: '0.74rem', padding: '0.42rem 0.72rem' }}
          >
            <FileSpreadsheet size={13} color="#059669" />{' '}
            {exportingFormat === 'docx' ? 'Exporting DOCX...' : 'Export Filtered (DOCX)'}
          </button>

          <select
            aria-label="Sort capital projects by"
            value={projectSort}
            onChange={(e) => setProjectSort(e.target.value as ProjectSortOption)}
            style={{
              padding: '0.46rem 0.65rem',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontSize: '0.78rem',
              backgroundColor: '#ffffff',
              color: '#0f172a',
              fontWeight: 600,
            }}
          >
            <option value="amount-desc">Highest Amount (₦)</option>
            <option value="risk-desc">Highest Compound Risk (0–100)</option>
            <option value="amount-asc">Lowest Amount (₦)</option>
            <option value="page-asc">PDF Page Order</option>
            <option value="default">Original Schedule Order</option>
          </select>

          <div style={{ position: 'relative' }}>
            <input
              type="text"
              placeholder="Filter by title, agency, or code..."
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              style={{
                padding: '0.46rem 0.75rem 0.46rem 2.15rem',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '0.8rem',
                width: '250px',
              }}
            />
            <Search
              size={14}
              color="#94a3b8"
              style={{
                position: 'absolute',
                left: '0.7rem',
                top: '50%',
                transform: 'translateY(-50%)',
              }}
            />
          </div>
        </div>
      </div>

      {/* Summary KPI Strip */}
      <div className="grid-4-cols">
        <div className="dossier-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.67rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
            Matching Schedule Lines
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a', marginTop: '0.15rem' }}>
            {filteredRows.length.toLocaleString('en-US')}
          </div>
          <div className="font-mono" style={{ fontSize: '0.68rem', color: '#64748b' }}>
            {formatNairaCompact(filteredSummary.totalAmountNaira)} enacted
          </div>
        </div>

        <div className="dossier-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.67rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
            Evidence Engine Flagged
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#b45309', marginTop: '0.15rem' }}>
            {filteredSummary.flaggedInFilter.toLocaleString('en-US')}
          </div>
          <div className="font-mono" style={{ fontSize: '0.68rem', color: '#64748b' }}>
            Triggered 1+ rule checks
          </div>
        </div>

        <div className="dossier-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.67rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
            Cross-Ledger Hits
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#b91c1c', marginTop: '0.15rem' }}>
            {filteredSummary.crossLedgerInFilter.toLocaleString('en-US')}
          </div>
          <div className="font-mono" style={{ fontSize: '0.68rem', color: '#64748b' }}>
            Linked to external ledgers
          </div>
        </div>

        <div className="dossier-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.67rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
            Paid on Paper / NASS Inserted
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a', marginTop: '0.15rem' }}>
            {filteredSummary.paidOrInsertedInFilter.toLocaleString('en-US')}
          </div>
          <div className="font-mono" style={{ fontSize: '0.68rem', color: '#64748b' }}>
            In current filtered set
          </div>
        </div>
      </div>

      {/* Investigative Quick Filter Pills */}
      <div
        className="dossier-card mobile-chip-scroll"
        style={{
          padding: '0.65rem 0.9rem',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.4rem',
          alignItems: 'center',
        }}
      >
        <span
          className="font-mono"
          style={{
            fontSize: '0.68rem',
            fontWeight: 700,
            color: '#64748b',
            marginRight: '0.25rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
          }}
        >
          <ShieldAlert size={13} color="#059669" /> CROSS-LEDGER FILTERS:
        </span>
        {quickFilterPills.map((pill) => {
          const active = quickFilter === pill.id;
          const activeBg =
            pill.tone === 'danger'
              ? '#b91c1c'
              : pill.tone === 'amber'
                ? '#b45309'
                : pill.tone === 'emerald'
                  ? '#059669'
                  : '#0f172a';
          return (
            <button
              key={pill.id}
              type="button"
              onClick={() => setQuickFilter(pill.id)}
              style={{
                padding: '0.3rem 0.62rem',
                borderRadius: '999px',
                border: active ? `1px solid ${activeBg}` : '1px solid #cbd5e1',
                backgroundColor: active ? activeBg : '#ffffff',
                color: active ? '#ffffff' : '#334155',
                fontSize: '0.71rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.32rem',
              }}
            >
              <span>{pill.label}</span>
              <span
                className="font-mono tabular-nums"
                style={{
                  fontSize: '0.65rem',
                  opacity: active ? 0.95 : 0.75,
                }}
              >
                ({pill.count.toLocaleString('en-US')})
              </span>
            </button>
          );
        })}
      </div>

      {/* Projects Table */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '10px',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
        }}
      >
        <div className="projects-desktop-table table-scroll-wrap">
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.82rem',
              textAlign: 'left',
            }}
          >
            <thead>
              <tr
                style={{
                  backgroundColor: '#f8fafc',
                  borderBottom: '1px solid #e2e8f0',
                  color: '#475569',
                  fontWeight: 600,
                }}
              >
                <th style={{ padding: '0.72rem 0.9rem' }}>Code</th>
                <th style={{ padding: '0.72rem 0.9rem' }}>Project Title &amp; Cross-Ledger Signals</th>
                <th style={{ padding: '0.72rem 0.9rem' }}>Executing Agency</th>
                <th style={{ padding: '0.72rem 0.9rem', textAlign: 'center' }}>Risk Score</th>
                <th style={{ padding: '0.72rem 0.9rem', textAlign: 'right' }}>Amount (₦)</th>
                <th style={{ padding: '0.72rem 0.9rem', textAlign: 'center' }}>PDF Page</th>
              </tr>
            </thead>
            <tbody>
              {paginatedRows.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '1.5rem', textAlign: 'center', color: '#64748b' }}>
                    No capital line items match the active search or cross-ledger filter.
                  </td>
                </tr>
              ) : (
                paginatedRows.map(({ project: p, compound, hasAi }, idx) => {
                  const badges = compound?.crossLedgerBadges;
                  const scoreMeta = compound ? getRiskScoreBadgeStyle(compound.compoundRiskScore) : null;

                  return (
                    <tr
                      key={p.id || idx}
                      onClick={() => onSelectProject(p)}
                      style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                    >
                      <td
                        style={{
                          padding: '0.72rem 0.9rem',
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          color: '#059669',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {p.projectCode || 'ERGP'}
                      </td>
                      <td
                        style={{
                          padding: '0.72rem 0.9rem',
                          color: '#0f172a',
                          fontWeight: 500,
                          maxWidth: '460px',
                        }}
                      >
                        <ExpandableText text={p.projectName} maxChars={160} />

                        {(hasAi || compound) && (
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: '0.32rem',
                              marginTop: '0.35rem',
                            }}
                          >
                            {badges?.paidOnPaper && (
                              <span
                                className="font-mono"
                                style={{
                                  fontSize: '0.62rem',
                                  fontWeight: 700,
                                  backgroundColor: '#fef2f2',
                                  color: '#b91c1c',
                                  border: '1px solid #fecaca',
                                  padding: '0.07rem 0.38rem',
                                  borderRadius: '4px',
                                }}
                              >
                                Paid on Paper
                              </span>
                            )}
                            {badges?.billInsertedOrInflated && (
                              <span
                                className="font-mono"
                                style={{
                                  fontSize: '0.62rem',
                                  fontWeight: 700,
                                  backgroundColor: '#fffbeb',
                                  color: '#b45309',
                                  border: '1px solid #fde68a',
                                  padding: '0.07rem 0.38rem',
                                  borderRadius: '4px',
                                }}
                              >
                                NASS Insertion
                              </span>
                            )}
                            {badges && badges.mdaOaugfIssuesCount > 0 && (
                              <span
                                className="font-mono"
                                style={{
                                  fontSize: '0.62rem',
                                  fontWeight: 700,
                                  backgroundColor: '#fff7ed',
                                  color: '#c2410c',
                                  border: '1px solid #fed7aa',
                                  padding: '0.07rem 0.38rem',
                                  borderRadius: '4px',
                                }}
                              >
                                OAuGF-Indicted MDA ({badges.mdaOaugfIssuesCount})
                              </span>
                            )}
                            {badges?.zombieRecurringLineage && (
                              <span
                                className="font-mono"
                                style={{
                                  fontSize: '0.62rem',
                                  fontWeight: 700,
                                  backgroundColor: '#f1f5f9',
                                  color: '#334155',
                                  border: '1px solid #cbd5e1',
                                  padding: '0.07rem 0.38rem',
                                  borderRadius: '4px',
                                }}
                              >
                                Zombie Lineage
                              </span>
                            )}
                            {badges?.mdaPersonalOrOpaquePayoutFlag && (
                              <span
                                className="font-mono"
                                style={{
                                  fontSize: '0.62rem',
                                  fontWeight: 700,
                                  backgroundColor: '#fef2f2',
                                  color: '#991b1b',
                                  border: '1px solid #fecaca',
                                  padding: '0.07rem 0.38rem',
                                  borderRadius: '4px',
                                }}
                              >
                                Personal/Opaque MDA
                              </span>
                            )}
                            {compound && (
                              <span
                                className="font-mono"
                                title={compound.triggeredRules.map((r) => r.ruleName).join(' • ')}
                                style={{
                                  fontSize: '0.62rem',
                                  fontWeight: 600,
                                  backgroundColor: '#f8fafc',
                                  color: '#475569',
                                  border: '1px solid #e2e8f0',
                                  padding: '0.07rem 0.38rem',
                                  borderRadius: '4px',
                                }}
                              >
                                <AlertTriangle size={9} style={{ verticalAlign: 'middle', marginRight: '0.2rem' }} />
                                {compound.ruleCount} Rule{compound.ruleCount > 1 ? 's' : ''}
                              </span>
                            )}
                            {hasAi && (
                              <span
                                className="font-mono"
                                style={{
                                  fontSize: '0.62rem',
                                  fontWeight: 700,
                                  backgroundColor: '#ecfdf5',
                                  color: '#047857',
                                  border: '1px solid #a7f3d0',
                                  padding: '0.07rem 0.38rem',
                                  borderRadius: '4px',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.18rem',
                                }}
                              >
                                <Sparkles size={10} /> AI Enriched
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '0.72rem 0.9rem', color: '#475569' }}>
                        <div style={{ fontWeight: 600 }}>{p.agency || 'Federal MDA'}</div>
                        {badges && badges.mdaIntegrityGrade && badges.mdaIntegrityGrade !== 'N/A' && (
                          <span
                            className="font-mono"
                            style={{
                              display: 'inline-block',
                              marginTop: '0.18rem',
                              fontSize: '0.62rem',
                              fontWeight: 700,
                              padding: '0.05rem 0.34rem',
                              borderRadius: '4px',
                              backgroundColor:
                                badges.mdaIntegrityGrade === 'D' || badges.mdaIntegrityGrade === 'F'
                                  ? '#fef2f2'
                                  : '#f1f5f9',
                              color:
                                badges.mdaIntegrityGrade === 'D' || badges.mdaIntegrityGrade === 'F'
                                  ? '#b91c1c'
                                  : '#475569',
                            }}
                          >
                            MDA Grade {badges.mdaIntegrityGrade}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '0.72rem 0.9rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {compound && scoreMeta ? (
                          <div
                            title={compound.triggeredRules
                              .map((r) => `${r.ruleName} (${r.severity})`)
                              .join('\n')}
                          >
                            <span
                              className="font-mono tabular-nums"
                              style={{
                                display: 'inline-block',
                                padding: '0.15rem 0.45rem',
                                borderRadius: '999px',
                                fontSize: '0.71rem',
                                fontWeight: 700,
                                backgroundColor: scoreMeta.bg,
                                color: scoreMeta.color,
                                border: `1px solid ${scoreMeta.border}`,
                              }}
                            >
                              {compound.compoundRiskScore}/100
                            </span>
                            {compound.crossLedgerRuleCount > 0 && (
                              <div
                                className="font-mono"
                                style={{ fontSize: '0.61rem', color: '#64748b', marginTop: '0.12rem' }}
                              >
                                {compound.crossLedgerRuleCount} cross-ledger
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="font-mono" style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                            —
                          </span>
                        )}
                      </td>
                      <td
                        className="font-mono tabular-nums"
                        style={{
                          padding: '0.72rem 0.9rem',
                          textAlign: 'right',
                          fontWeight: 700,
                          color: '#0f172a',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        ₦{p.amount ? Number(p.amount).toLocaleString('en-US') : '0'}
                      </td>
                      <td
                        style={{
                          padding: '0.72rem 0.9rem',
                          textAlign: 'center',
                          color: '#64748b',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                          <span>Page {p.page}</span>
                          <a
                            href={buildRecordDossierUrl({
                              year: financialYear,
                              item: p.projectCode || p.id || 'ERGP',
                              page: p.page,
                            })}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title="Open full Official Record Dossier in new tab"
                            style={{ color: '#059669', display: 'inline-flex', alignItems: 'center' }}
                          >
                            <ExternalLink size={13} />
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Native Card Feed (<= 640px) */}
        <div className="projects-mobile-cards" style={{ padding: '0.75rem' }}>
          {paginatedRows.length === 0 ? (
            <div style={{ padding: '1.25rem', textAlign: 'center', fontSize: '0.82rem', color: '#64748b' }}>
              No capital line items match the active search or cross-ledger filter.
            </div>
          ) : (
            paginatedRows.map(({ project: p, compound, hasAi }, idx) => {
              const badges = compound?.crossLedgerBadges;
              const scoreMeta = compound ? getRiskScoreBadgeStyle(compound.compoundRiskScore) : null;
              return (
                <div
                  key={`mobile-${p.id || idx}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectProject(p)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectProject(p);
                    }
                  }}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    padding: '0.8rem 0.85rem',
                    backgroundColor: '#fafaf9',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.45rem',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                    <span className="font-mono" style={{ fontSize: '0.72rem', fontWeight: 700, color: '#059669' }}>
                      {p.projectCode || 'ERGP'}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {scoreMeta && compound && (
                        <span
                          className="font-mono tabular-nums"
                          style={{
                            padding: '0.1rem 0.42rem',
                            borderRadius: '999px',
                            fontSize: '0.66rem',
                            fontWeight: 700,
                            backgroundColor: scoreMeta.bg,
                            color: scoreMeta.color,
                            border: `1px solid ${scoreMeta.border}`,
                          }}
                        >
                          {compound.compoundRiskScore}/100
                        </span>
                      )}
                      <span className="font-mono tabular-nums" style={{ fontSize: '0.85rem', fontWeight: 800, color: '#0f172a' }}>
                        ₦{p.amount ? Number(p.amount).toLocaleString('en-US') : '0'}
                      </span>
                    </div>
                  </div>

                  <div style={{ fontSize: '0.84rem', fontWeight: 600, color: '#0f172a', lineHeight: 1.38 }}>
                    <ExpandableText text={p.projectName} maxChars={140} />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', fontSize: '0.72rem', color: '#475569' }}>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
                      {p.agency || 'Federal MDA'}
                    </span>
                    <a
                      href={buildRecordDossierUrl({
                        year: financialYear,
                        item: p.projectCode || p.id || 'ERGP',
                        page: p.page,
                      })}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{ color: '#059669', display: 'inline-flex', alignItems: 'center', gap: '0.22rem', flexShrink: 0, fontWeight: 600, textDecoration: 'none' }}
                    >
                      Pg {p.page} <ExternalLink size={12} />
                    </a>
                  </div>

                  {(hasAi || badges?.paidOnPaper || badges?.billInsertedOrInflated || (badges && badges.mdaOaugfIssuesCount > 0)) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.1rem' }}>
                      {badges?.paidOnPaper && (
                        <span className="font-mono" style={{ fontSize: '0.62rem', fontWeight: 700, backgroundColor: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', padding: '0.06rem 0.34rem', borderRadius: '4px' }}>
                          Paid on Paper
                        </span>
                      )}
                      {badges?.billInsertedOrInflated && (
                        <span className="font-mono" style={{ fontSize: '0.62rem', fontWeight: 700, backgroundColor: '#fffbeb', color: '#b45309', border: '1px solid #fde68a', padding: '0.06rem 0.34rem', borderRadius: '4px' }}>
                          NASS Insertion
                        </span>
                      )}
                      {badges && badges.mdaOaugfIssuesCount > 0 && (
                        <span className="font-mono" style={{ fontSize: '0.62rem', fontWeight: 700, backgroundColor: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa', padding: '0.06rem 0.34rem', borderRadius: '4px' }}>
                          OAuGF ({badges.mdaOaugfIssuesCount})
                        </span>
                      )}
                      {hasAi && (
                        <span className="font-mono" style={{ fontSize: '0.62rem', fontWeight: 700, backgroundColor: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '0.06rem 0.34rem', borderRadius: '4px' }}>
                          AI Enriched
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0.75rem 1rem',
            backgroundColor: '#f8fafc',
            borderTop: '1px solid #e2e8f0',
            fontSize: '0.775rem',
            color: '#475569',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}
        >
          <span>
            Showing {filteredRows.length === 0 ? 0 : (projectPage - 1) * PROJECTS_PER_PAGE + 1}–
            {Math.min(projectPage * PROJECTS_PER_PAGE, filteredRows.length)} of{' '}
            {filteredRows.length.toLocaleString('en-US')} matching projects
          </span>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <button
              type="button"
              disabled={projectPage <= 1}
              onClick={() => setProjectPage((p) => Math.max(1, p - 1))}
              style={{
                padding: '0.3rem 0.65rem',
                borderRadius: '5px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                color: projectPage <= 1 ? '#94a3b8' : '#0f172a',
                fontWeight: 600,
              }}
            >
              Previous
            </button>
            <span style={{ fontWeight: 700 }}>
              Page {projectPage} / {totalProjectPages}
            </span>
            <button
              type="button"
              disabled={projectPage >= totalProjectPages}
              onClick={() => setProjectPage((p) => Math.min(totalProjectPages, p + 1))}
              style={{
                padding: '0.3rem 0.65rem',
                borderRadius: '5px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                color: projectPage >= totalProjectPages ? '#94a3b8' : '#0f172a',
                fontWeight: 600,
              }}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
