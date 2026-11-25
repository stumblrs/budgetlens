import React, { useState, useEffect } from 'react';
import { Search, ExternalLink, Calendar, TrendingUp, AlertTriangle, ShieldCheck, Building2, Download, FileSpreadsheet } from 'lucide-react';
import { useBudgetDatabase } from '../context/BudgetDatabaseContext';
import { buildCanonicalPermalink } from '../utils/urlState';
import { ExpandableText } from './ExpandableText';
import { ContractorHistoryModal, type ContractorSummaryItem } from './ContractorHistoryModal';
import {
  loadOaugfAuditIndex,
  lookupOaugfMdaFindings,
  type OaugfAuditIndexPayload,
} from '../utils/mdaScorecard';
import {
  exportTabularDossierDocx,
  exportTabularDossierPdf,
  type TabularDossierSpec,
} from '../utils/documentExporter';
import { formatNairaExact } from '../utils/reportExporter';

interface ProjectInstance {
  financialYear: number;
  projectId: string;
  projectCode: string;
  projectName: string;
  amount: number;
  page: number;
}

interface LineageRecord {
  lineage_id: string;
  project_code: string;
  canonical_title: string;
  agency: string;
  instances: ProjectInstance[];
  years_appeared: number[];
  cumulative_allocation: number;
  match_confidence: number;
  severity: 'high' | 'medium' | 'low';
}

type LineageClassification =
  | 'VENDOR_SWITCHED_REPEAT'
  | 'ACTIVE_PHASED_BUILD'
  | 'AWARDED_UNPAID'
  | 'PLANNED_ONLY_REPEAT'
  | 'BUDGET_ONLY_REPEAT';

interface FtmLineageContractor {
  contractorName: string;
  bppContractorId?: string | null;
  awardCount: number;
  awardedNaira: number;
  nocopoDisbursedNaira: number;
  mdaGovspendCount?: number;
  mdaGovspendPaidNaira?: number;
  totalGovspendCount?: number;
  totalGovspendPaidNaira?: number;
  nonCompetitiveCount: number;
  procurementMethods: string[];
  years: number[];
  leaderboardContractCount?: number;
  leaderboardTotalContractedNaira?: number;
  leaderboardFirstYear?: number | null;
  leaderboardLastYear?: number | null;
  leaderboardMdaCount?: number;
  leaderboardTopMdas?: string[];
}

interface FtmLineageLink {
  lineageId: string;
  classification: LineageClassification;
  matchMethod: string;
  confidenceScore: number;
  awardedContractCount: number;
  planningCount: number;
  totalAwardedNaira: number;
  totalNocopoDisbursedNaira: number;
  matchedMdaGovspendPaidNaira: number;
  distinctContractorCount: number;
  nonCompetitiveCount: number;
  procurementMethods: string[];
  contractors: FtmLineageContractor[];
}

interface FollowTheMoneyLineagePayload {
  status: string;
  govspendScopeNote?: string;
  summary?: {
    lineagesScanned: number;
    lineageClassificationCounts: Record<LineageClassification, number>;
    lineageTotalAwardedNaira: number;
    lineageTotalNocopoDisbursedNaira: number;
  };
  lineageLinksById?: Record<string, FtmLineageLink>;
}

const CLASSIFICATION_META: Record<
  LineageClassification,
  { label: string; shortLabel: string; bg: string; color: string; border: string; note: string }
> = {
  VENDOR_SWITCHED_REPEAT: {
    label: 'Vendor-Switched Repeat',
    shortLabel: 'Vendor-Switched',
    bg: '#fef2f2',
    color: '#b91c1c',
    border: '#fecaca',
    note: 'Repeated across budget cycles with multiple different contractors winning awards — high priority for completion & duplication review.',
  },
  ACTIVE_PHASED_BUILD: {
    label: 'Active Phased Build',
    shortLabel: 'Active Phased',
    bg: '#ecfdf5',
    color: '#047857',
    border: '#a7f3d0',
    note: 'Consistent contractor award with verified NOCOPO disbursement or MDA Treasury cash payouts.',
  },
  AWARDED_UNPAID: {
    label: 'Awarded · ₦0 Paid',
    shortLabel: 'Awarded Unpaid',
    bg: '#fffbeb',
    color: '#b45309',
    border: '#fde68a',
    note: 'Public contract award recorded without matching recorded disbursement in NOCOPO or MDA GovSpend.',
  },
  PLANNED_ONLY_REPEAT: {
    label: 'Planned / Tender Only',
    shortLabel: 'Planned Only',
    bg: '#eff6ff',
    color: '#1d4ed8',
    border: '#bfdbfe',
    note: 'Procurement planning or tender entries exist without a recorded contract award.',
  },
  BUDGET_ONLY_REPEAT: {
    label: 'Budget-Only Repeat',
    shortLabel: 'Budget Only',
    bg: '#f1f5f9',
    color: '#475569',
    border: '#cbd5e1',
    note: 'Repeated in annual Appropriation Acts with no matching public NOCOPO tender or contract award.',
  },
};

function toContractorModalItem(c: FtmLineageContractor): ContractorSummaryItem {
  return {
    contractorName: c.contractorName,
    bppContractorId: c.bppContractorId ?? undefined,
    contractCount: c.leaderboardContractCount ?? c.awardCount,
    totalContractedNaira: c.leaderboardTotalContractedNaira ?? c.awardedNaira,
    nocopoDisbursedNaira: c.nocopoDisbursedNaira,
    govspendPaymentCount: c.totalGovspendCount,
    govspendPaidNaira: c.totalGovspendPaidNaira,
    firstYear: c.leaderboardFirstYear ?? (c.years[0] ?? null),
    lastYear: c.leaderboardLastYear ?? (c.years[c.years.length - 1] ?? null),
    mdaCount: c.leaderboardMdaCount ?? 1,
    topMdas: c.leaderboardTopMdas ?? [],
  };
}

interface Props {
  lineages?: LineageRecord[];
}

export const RecurringLineagesExplorer: React.FC<Props> = ({ lineages: propLineages }) => {
  const { isLoading } = useBudgetDatabase();
  const [lineages, setLineages] = useState<LineageRecord[]>(propLineages || []);
  const [selectedLineage, setSelectedLineage] = useState<LineageRecord | null>(propLineages?.[0] || null);
  const [ftmData, setFtmData] = useState<FollowTheMoneyLineagePayload | null>(null);
  const [oaugfIndex, setOaugfIndex] = useState<OaugfAuditIndexPayload | null>(null);
  const [selectedContractor, setSelectedContractor] = useState<ContractorSummaryItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [classificationFilter, setClassificationFilter] = useState<string>('all');
  const [oaugfMdaOnly, setOaugfMdaOnly] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null);

  const normalizeLineages = (raw: any): LineageRecord[] => {
    const arr = Array.isArray(raw) ? raw : (raw?.lineages || []);
    return arr.map((lin: any, idx: number) => ({
      lineage_id: lin.lineage_id || lin.lineageId || `LIN-${String(idx + 1).padStart(6, '0')}`,
      project_code: lin.project_code || lin.projectCode || '',
      canonical_title: lin.canonical_title || lin.canonicalTitle || '',
      agency: lin.agency || 'Federal MDA',
      instances: (lin.instances || lin.appearances || []).map((inst: any) => ({
        financialYear: inst.financialYear ?? inst.year,
        projectId: inst.projectId || '',
        projectCode: inst.projectCode || lin.projectCode || lin.project_code || '',
        projectName: inst.projectName || inst.title || '',
        amount: inst.amount || 0,
        page: inst.page || 1,
      })),
      years_appeared: lin.years_appeared || lin.yearsAppeared || [],
      cumulative_allocation: lin.cumulative_allocation ?? lin.cumulativeAllocation ?? 0,
      match_confidence: lin.match_confidence ?? 0.9,
      severity: lin.severity === 'high' ? 'high' : lin.severity === 'low' ? 'low' : 'medium',
    }));
  };

  useEffect(() => {
    if (propLineages && propLineages.length > 0) {
      const normalized = normalizeLineages(propLineages);
      setLineages(normalized);
      setSelectedLineage(normalized[0] || null);
      return;
    }
    fetch(`/datasets/recurring_lineages.json?t=${Date.now()}`, { cache: 'no-store' })
      .then(res => res.json())
      .then(data => {
        const normalized = normalizeLineages(data);
        setLineages(normalized);
        if (normalized.length > 0) setSelectedLineage(normalized[0]);
      })
      .catch(err => console.error("Error loading recurring lineages:", err));
  }, [propLineages, isLoading]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/datasets/follow_the_money_links.json', { cache: 'no-cache' })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
      loadOaugfAuditIndex(),
    ])
      .then(([data, oa]) => {
        if (!active) return;
        if (data) setFtmData(data as FollowTheMoneyLineagePayload);
        if (oa) setOaugfIndex(oa);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const lineageLinksById = ftmData?.lineageLinksById || {};

  const formatNaira = (amt: number) => {
    if (amt >= 1e9) return `₦${(amt / 1e9).toFixed(2)} Billion`;
    if (amt >= 1e6) return `₦${(amt / 1e6).toFixed(2)} Million`;
    return `₦${amt.toLocaleString()}`;
  };

  const getLineageClassification = (lid: string): LineageClassification =>
    lineageLinksById[lid]?.classification ?? 'BUDGET_ONLY_REPEAT';

  const filteredLineages = lineages.filter(lin => {
    const q = searchQuery.toLowerCase();
    const link = lineageLinksById[lin.lineage_id];
    const contractorHit = link?.contractors?.some((c) =>
      c.contractorName.toLowerCase().includes(q)
    );
    const matchesSearch =
      !q ||
      lin.canonical_title.toLowerCase().includes(q) ||
      lin.project_code.toLowerCase().includes(q) ||
      lin.agency.toLowerCase().includes(q) ||
      Boolean(contractorHit);

    const matchesSeverity = severityFilter === 'all' || lin.severity === severityFilter;
    const cls = getLineageClassification(lin.lineage_id);
    const matchesClass = classificationFilter === 'all' || cls === classificationFilter;
    const oaugf = oaugfMdaOnly ? lookupOaugfMdaFindings(oaugfIndex, lin.agency) : null;
    const matchesOaugf = !oaugfMdaOnly || Boolean(oaugf && oaugf.findingCount > 0);
    return matchesSearch && matchesSeverity && matchesClass && matchesOaugf;
  });

  const selectedLink = selectedLineage ? lineageLinksById[selectedLineage.lineage_id] : undefined;
  const selectedClass: LineageClassification = selectedLineage
    ? getLineageClassification(selectedLineage.lineage_id)
    : 'BUDGET_ONLY_REPEAT';
  const selectedClassMeta = CLASSIFICATION_META[selectedClass];
  const selectedOaugf = selectedLineage
    ? lookupOaugfMdaFindings(oaugfIndex, selectedLineage.agency)
    : null;

  const handleExportLineages = async (format: 'pdf' | 'docx') => {
    if (exportingFormat) return;
    setExportingFormat(format);
    try {
      const topRows = filteredLineages.slice(0, 60);
      const totalCum = filteredLineages.reduce((s, l) => s + (l.cumulative_allocation || 0), 0);
      const oaugfMatchedCount = filteredLineages.filter((l) => {
        const oa = lookupOaugfMdaFindings(oaugfIndex, l.agency);
        return Boolean(oa && oa.findingCount > 0);
      }).length;

      const tables: TabularDossierSpec['tables'] = [
        {
          heading: `1. Cross-Year Recurring Project Lineages (${topRows.length} of ${filteredLineages.length.toLocaleString('en-US')})`,
          columns: [
            'Lineage / Code',
            'Project Title',
            'Executing MDA',
            'Yrs',
            'Execution Class',
            'OAuGF Queries',
            'Cumulative (NGN)',
          ],
          rows:
            topRows.length > 0
              ? topRows.map((l) => {
                  const oa = lookupOaugfMdaFindings(oaugfIndex, l.agency);
                  const clsMeta = CLASSIFICATION_META[getLineageClassification(l.lineage_id)];
                  return [
                    `${l.lineage_id} (${l.project_code || 'ERGP'})`,
                    l.canonical_title.slice(0, 82),
                    l.agency.slice(0, 34),
                    String(l.years_appeared.length),
                    clsMeta.shortLabel,
                    oa && oa.findingCount > 0
                      ? `${oa.findingCount} (${oa.repeatNeglectCount || 0} rpt)`
                      : '—',
                    formatNairaExact(l.cumulative_allocation),
                  ];
                })
              : [['-', 'No recurring lineages matched filter', '-', '-', '-', '-', '-']],
          rightAlignColumns: [3, 6],
        },
      ];

      if (selectedLineage) {
        tables.push({
          heading: `2. Selected Lineage Citation Timeline — ${selectedLineage.lineage_id}`,
          columns: ['Fiscal Year', 'Project Code', 'PDF Page', 'Enacted Allocation (NGN)'],
          rows: selectedLineage.instances.map((inst) => [
            `FY ${inst.financialYear}`,
            inst.projectCode || selectedLineage.project_code || 'ERGP',
            `p.${inst.page}`,
            formatNairaExact(inst.amount),
          ]),
          rightAlignColumns: [2, 3],
        });
      }

      const spec: TabularDossierSpec = {
        filenameBase: `BudgetLens_Recurring_Lineages_${classificationFilter}`,
        eyebrow: 'BUDGETLENS 28-YEAR RECURRING LINEAGE & ZOMBIE PROJECT DOSSIER',
        title: 'Cross-Year Recurring Capital Project Lineages (1999–2026)',
        subtitle: `Filter: ${classificationFilter} | Query: "${searchQuery.trim() || 'None'}" | Matching Lineages: ${filteredLineages.length.toLocaleString('en-US')}`,
        orientation: 'landscape',
        metadata: [
          { label: 'Matching Lineages', value: filteredLineages.length.toLocaleString('en-US') },
          { label: 'Cumulative Value', value: formatNaira(totalCum) },
          { label: 'OAuGF-Queried MDAs', value: `${oaugfMatchedCount.toLocaleString('en-US')} lineages` },
          { label: 'Selected Focus', value: selectedLineage ? selectedLineage.lineage_id : 'Top Lineages View' },
        ],
        kpis: [
          {
            label: 'Matching Lineages',
            value: filteredLineages.length.toLocaleString('en-US'),
            subtext: `of ${lineages.length.toLocaleString('en-US')} multi-year lineages`,
          },
          {
            label: 'Cumulative Scheduled',
            value: formatNaira(totalCum),
            subtext: 'Across repeated budget cycles',
          },
          {
            label: 'OAuGF MDA Overlap',
            value: oaugfMatchedCount.toLocaleString('en-US'),
            subtext: 'Executed by OAuGF-queried MDAs',
          },
          {
            label: 'Selected Lineage',
            value: selectedLineage ? `${selectedLineage.years_appeared.length} Yrs` : '—',
            subtext: selectedLineage ? formatNaira(selectedLineage.cumulative_allocation) : 'All lineages',
          },
        ],
        narrative:
          'Tracks repeated capital project lineages reappearing across multi-year Federal Appropriation schedules, linked with NOCOPO public contracting outcomes and Office of the Auditor-General (OAuGF) constitutional audit queries for parent executing MDAs.',
        tables,
        permalink: buildCanonicalPermalink({ tab: 'recurring' }),
        footnote:
          'Sources: 1999–2026 Federal Appropriation Acts, BPP NOCOPO OCDS Awards, OAGF Open Treasury, and OAuGF Audit Reports (1999–2024).',
      };

      if (format === 'pdf') await exportTabularDossierPdf(spec);
      else await exportTabularDossierDocx(spec);
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <div style={{ padding: '1.5rem', backgroundColor: '#f8fafc', minHeight: '85vh' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
            <span style={{ fontSize: '0.75rem', backgroundColor: '#e6f7f0', color: '#047857', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '4px' }}>
              Section 9.5 · Evidence Engine
            </span>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Multi-Year Lineage Tracker</span>
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.5px', margin: 0 }}>
            Cross-Year Recurring Project Explorer
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '0.2rem' }}>
            Forensic multi-year lineage tracking across <strong>{lineages.length.toLocaleString()} recurring project lineages</strong> (1999–2026) cross-checked against public NOCOPO contracts, Open Treasury payouts &amp; OAuGF MDA queries.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={exportingFormat !== null || filteredLineages.length === 0}
            onClick={() => handleExportLineages('pdf')}
            className="editorial-btn-primary"
            style={{ fontSize: '0.76rem', padding: '0.45rem 0.78rem' }}
          >
            <Download size={13} /> {exportingFormat === 'pdf' ? 'Exporting PDF...' : 'Export Lineages Dossier (PDF)'}
          </button>
          <button
            type="button"
            disabled={exportingFormat !== null || filteredLineages.length === 0}
            onClick={() => handleExportLineages('docx')}
            className="editorial-btn"
            style={{ fontSize: '0.76rem', padding: '0.45rem 0.78rem' }}
          >
            <FileSpreadsheet size={13} color="#059669" /> {exportingFormat === 'docx' ? 'Exporting DOCX...' : 'Export Lineages (DOCX)'}
          </button>
        </div>
      </div>

      {/* Reality Check Summary Strip */}
      {ftmData?.summary?.lineageClassificationCounts && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
            gap: '0.75rem',
            marginBottom: '1.25rem',
          }}
        >
          {(
            [
              'VENDOR_SWITCHED_REPEAT',
              'ACTIVE_PHASED_BUILD',
              'AWARDED_UNPAID',
              'PLANNED_ONLY_REPEAT',
              'BUDGET_ONLY_REPEAT',
            ] as LineageClassification[]
          ).map((clsKey) => {
            const meta = CLASSIFICATION_META[clsKey];
            const cnt = ftmData.summary?.lineageClassificationCounts?.[clsKey] ?? 0;
            const active = classificationFilter === clsKey;
            return (
              <button
                key={clsKey}
                type="button"
                onClick={() => setClassificationFilter(active ? 'all' : clsKey)}
                style={{
                  textAlign: 'left',
                  padding: '0.75rem 0.9rem',
                  borderRadius: '8px',
                  border: active ? `2px solid ${meta.color}` : `1px solid ${meta.border}`,
                  backgroundColor: meta.bg,
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: '0.68rem', fontWeight: 700, color: meta.color, textTransform: 'uppercase' }}>
                  {meta.label}
                </div>
                <div className="font-mono tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a', marginTop: '0.15rem' }}>
                  {cnt.toLocaleString()}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Main Workbench Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '1.5rem' }}>
        {/* Left Column: Filterable Lineage List */}
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1.25rem', display: 'flex', flexDirection: 'column', height: '75vh' }}>
          {/* Search & Filter bar */}
          <div style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '0.45rem 0.75rem' }}>
              <Search size={16} color="#64748b" />
              <input
                type="text"
                placeholder="Search code, title, agency, or contractor..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: '0.8rem', color: '#0f172a' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.4rem' }}>
              {['all', 'high', 'medium'].map(sev => (
                <button
                  key={sev}
                  onClick={() => setSeverityFilter(sev)}
                  style={{
                    flex: 1,
                    padding: '0.25rem 0.5rem',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    borderRadius: '4px',
                    border: '1px solid #e2e8f0',
                    backgroundColor: severityFilter === sev ? '#0f172a' : '#ffffff',
                    color: severityFilter === sev ? '#ffffff' : '#475569',
                    cursor: 'pointer',
                    textTransform: 'capitalize'
                  }}
                >
                  {sev === 'all' ? 'All Severities' : `${sev} Severity`}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
              <button
                type="button"
                onClick={() => setClassificationFilter('all')}
                style={{
                  padding: '0.2rem 0.45rem',
                  fontSize: '0.66rem',
                  fontWeight: 600,
                  borderRadius: '4px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: classificationFilter === 'all' ? '#047857' : '#ffffff',
                  color: classificationFilter === 'all' ? '#ffffff' : '#475569',
                  cursor: 'pointer',
                }}
              >
                All Status ({lineages.length})
              </button>
              <button
                type="button"
                onClick={() => setOaugfMdaOnly((prev) => !prev)}
                style={{
                  padding: '0.2rem 0.48rem',
                  fontSize: '0.66rem',
                  fontWeight: 700,
                  borderRadius: '4px',
                  border: oaugfMdaOnly ? '1px solid #c2410c' : '1px solid #fed7aa',
                  backgroundColor: oaugfMdaOnly ? '#c2410c' : '#fff7ed',
                  color: oaugfMdaOnly ? '#ffffff' : '#c2410c',
                  cursor: 'pointer',
                }}
              >
                OAuGF-Queried MDAs Only
              </button>
              {(
                [
                  'VENDOR_SWITCHED_REPEAT',
                  'ACTIVE_PHASED_BUILD',
                  'AWARDED_UNPAID',
                  'PLANNED_ONLY_REPEAT',
                  'BUDGET_ONLY_REPEAT',
                ] as LineageClassification[]
              ).map((clsKey) => {
                const meta = CLASSIFICATION_META[clsKey];
                const active = classificationFilter === clsKey;
                return (
                  <button
                    key={clsKey}
                    type="button"
                    onClick={() => setClassificationFilter(clsKey)}
                    style={{
                      padding: '0.2rem 0.45rem',
                      fontSize: '0.66rem',
                      fontWeight: 600,
                      borderRadius: '4px',
                      border: `1px solid ${active ? meta.color : '#e2e8f0'}`,
                      backgroundColor: active ? meta.bg : '#ffffff',
                      color: active ? meta.color : '#475569',
                      cursor: 'pointer',
                    }}
                  >
                    {meta.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Scrollable Item List */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {filteredLineages.slice(0, 60).map((lin) => {
              const isSelected = selectedLineage?.lineage_id === lin.lineage_id;
              const cls = getLineageClassification(lin.lineage_id);
              const clsMeta = CLASSIFICATION_META[cls];
              const link = lineageLinksById[lin.lineage_id];
              const linOaugf = lookupOaugfMdaFindings(oaugfIndex, lin.agency);
              return (
                <div
                  key={lin.lineage_id}
                  onClick={() => setSelectedLineage(lin)}
                  style={{
                    padding: '0.75rem',
                    border: isSelected ? '2px solid #10b981' : '1px solid #f1f5f9',
                    borderRadius: '8px',
                    backgroundColor: isSelected ? '#f0fdf4' : '#ffffff',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem', gap: '0.3rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.65rem', backgroundColor: '#e8f2ff', color: '#3b82f6', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: '4px', fontFamily: 'monospace' }}>
                      {lin.project_code}
                    </span>
                    <span
                      style={{
                        fontSize: '0.62rem',
                        backgroundColor: clsMeta.bg,
                        color: clsMeta.color,
                        border: `1px solid ${clsMeta.border}`,
                        fontWeight: 700,
                        padding: '0.08rem 0.38rem',
                        borderRadius: '4px',
                      }}
                    >
                      {clsMeta.shortLabel}
                    </span>
                    {linOaugf && linOaugf.findingCount > 0 && (
                      <span
                        className="font-mono"
                        style={{
                          fontSize: '0.61rem',
                          backgroundColor: '#fff7ed',
                          color: '#c2410c',
                          border: '1px solid #fed7aa',
                          fontWeight: 700,
                          padding: '0.07rem 0.34rem',
                          borderRadius: '4px',
                        }}
                      >
                        OAuGF: {linOaugf.findingCount} Q
                      </span>
                    )}
                    <span style={{ fontSize: '0.65rem', color: lin.severity === 'high' ? '#ef4444' : '#f97316', fontWeight: 700 }}>
                      {lin.years_appeared.length} Yrs
                    </span>
                  </div>

                  <div style={{ fontSize: '0.825rem', fontWeight: 600, color: '#0f172a', lineHeight: 1.35 }}>
                    <ExpandableText text={lin.canonical_title} maxChars={110} />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', fontSize: '0.725rem', color: '#64748b' }}>
                    <span>
                      Cumul. {formatNaira(lin.cumulative_allocation)}
                      {link && link.awardedContractCount > 0 ? ` · ${link.awardedContractCount} Award(s)` : ''}
                    </span>
                    <span style={{ fontWeight: 600, color: '#10b981' }}>View Timeline →</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Selected Lineage Forensic Timeline */}
        {selectedLineage ? (
          <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Header Details */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.75rem', backgroundColor: '#0f172a', color: '#ffffff', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '4px', fontFamily: 'monospace' }}>
                  {selectedLineage.lineage_id}
                </span>
                <span style={{ fontSize: '0.75rem', backgroundColor: '#10b981', color: '#ffffff', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '4px' }}>
                  Code: {selectedLineage.project_code}
                </span>
                <span style={{ fontSize: '0.75rem', backgroundColor: '#fee2e2', color: '#ef4444', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '4px' }}>
                  Match Confidence: {(selectedLineage.match_confidence * 100).toFixed(0)}%
                </span>
              </div>

              <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: '#0f172a', lineHeight: 1.35 }}>
                <ExpandableText text={selectedLineage.canonical_title} maxChars={180} />
              </h2>
              <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem' }}>
                Executing Agency: <strong>{selectedLineage.agency}</strong>
              </p>
            </div>

            {/* Metrics Overview Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: '1rem', backgroundColor: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div>
                <div style={{ fontSize: '0.725rem', color: '#64748b' }}>Cumulative Allocation</div>
                <div style={{ fontSize: '1.35rem', fontWeight: 700, color: '#0f172a', fontFamily: 'var(--font-family)' }}>
                  {formatNaira(selectedLineage.cumulative_allocation)}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.725rem', color: '#64748b' }}>Years Appeared</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <Calendar size={16} color="#10b981" /> {selectedLineage.years_appeared.length} Consecutive Budgets
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.725rem', color: '#64748b' }}>Evidence Engine Rule</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#ef4444', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <AlertTriangle size={15} /> RECURRING_ALLOCATION
                </div>
              </div>
            </div>

            {/* Procurement & Treasury Reality Check */}
            <div style={{ backgroundColor: selectedClassMeta.bg, border: `1px solid ${selectedClassMeta.border}`, borderRadius: '8px', padding: '1rem 1.15rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                  <Building2 size={16} color={selectedClassMeta.color} />
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: selectedClassMeta.color }}>
                    Procurement &amp; Treasury Reality Check: {selectedClassMeta.label}
                  </span>
                </div>
                <span className="font-mono" style={{ fontSize: '0.68rem', color: '#475569', backgroundColor: '#ffffff', padding: '0.15rem 0.45rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}>
                  {selectedLink
                    ? selectedLink.matchMethod === 'EXACT_PROJECT_CODE'
                      ? 'Exact Project Code Match'
                      : `MDA + Title Match (${Math.round(selectedLink.confidenceScore * 100)}%)`
                    : 'No NOCOPO Record Linked'}
                </span>
              </div>

              <p style={{ fontSize: '0.76rem', color: '#334155', marginTop: '0.35rem', marginBottom: '0.75rem', lineHeight: 1.45 }}>
                {selectedClassMeta.note}
              </p>

              {selectedLink && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.65rem', backgroundColor: '#ffffff', padding: '0.75rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                    <div>
                      <div style={{ fontSize: '0.66rem', color: '#64748b' }}>Awarded Contracts</div>
                      <div className="font-mono tabular-nums" style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>
                        {selectedLink.awardedContractCount} ({selectedLink.distinctContractorCount} vendor{selectedLink.distinctContractorCount === 1 ? '' : 's'})
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.66rem', color: '#64748b' }}>NOCOPO Awarded</div>
                      <div className="font-mono tabular-nums" style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>
                        {formatNaira(selectedLink.totalAwardedNaira)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.66rem', color: '#64748b' }}>NOCOPO Disbursed</div>
                      <div className="font-mono tabular-nums" style={{ fontSize: '1rem', fontWeight: 700, color: '#047857' }}>
                        {formatNaira(selectedLink.totalNocopoDisbursedNaira)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.66rem', color: '#64748b' }}>MDA-Matched GovSpend Cash</div>
                      <div className="font-mono tabular-nums" style={{ fontSize: '1rem', fontWeight: 700, color: '#1d4ed8' }}>
                        {formatNaira(selectedLink.matchedMdaGovspendPaidNaira)}
                      </div>
                    </div>
                  </div>

                  {selectedLink.contractors.length > 0 && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>
                        Linked Contractors (Click to inspect full award &amp; Treasury history):
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                        {selectedLink.contractors.map((c) => (
                          <button
                            key={c.contractorName}
                            type="button"
                            onClick={() => setSelectedContractor(toContractorModalItem(c))}
                            style={{
                              fontSize: '0.72rem',
                              padding: '0.3rem 0.6rem',
                              borderRadius: '6px',
                              border: '1px solid #93c5fd',
                              backgroundColor: '#ffffff',
                              color: '#1d4ed8',
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                            }}
                          >
                            <span>{c.contractorName}</span>
                            <span className="font-mono" style={{ fontSize: '0.65rem', color: '#475569' }}>
                              ({c.awardCount} · {formatNaira(c.awardedNaira)}
                              {c.nonCompetitiveCount > 0 ? ` · ${c.nonCompetitiveCount} Non-Open` : ''})
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {ftmData?.govspendScopeNote && (
                    <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '0.55rem' }}>
                      {ftmData.govspendScopeNote}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Timeline Breakdown */}
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <TrendingUp size={18} color="#10b981" /> Multi-Year Historical Timeline ({selectedLineage.years_appeared[0]}–{selectedLineage.years_appeared[selectedLineage.years_appeared.length - 1]})
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {selectedLineage.instances.map((inst, idx) => (
                  <div key={idx} style={{ borderLeft: '3px solid #10b981', paddingLeft: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.5rem', paddingBottom: '0.5rem' }}>
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0f172a' }}>
                        {inst.financialYear} Appropriation Act
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                        Page {inst.page} · Code: {inst.projectCode}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a', fontFamily: 'var(--font-family)' }}>
                        {formatNaira(inst.amount)}
                      </div>
                      <a
                        href={buildCanonicalPermalink({
                          tab: 'document',
                          year: inst.financialYear,
                          page: inst.page,
                          item: inst.projectId || inst.projectCode,
                          q: '',
                        })}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: '0.725rem', color: '#10b981', textDecoration: 'none', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.2rem', justifyContent: 'flex-end' }}
                      >
                        Inspect {inst.financialYear} PDF Page {inst.page} Record <ExternalLink size={12} />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Neutrality Citation Card + OAuGF MDA Negligence Summary */}
            {selectedOaugf && selectedOaugf.findingCount > 0 && (
              <div style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '0.85rem 1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#92400e' }}>
                    OAuGF MDA Negligence Context: {selectedOaugf.mdaName}
                  </span>
                  <span className="font-mono" style={{ fontSize: '0.7rem', fontWeight: 700, color: '#b45309' }}>
                    {selectedOaugf.findingCount} Queries · {selectedOaugf.repeatNeglectCount || 0} Repeat · {selectedOaugf.recoveryDirectiveCount || 0} Recovery Orders
                  </span>
                </div>
                {selectedOaugf.sampleFindings[0] && (
                  <p style={{ fontSize: '0.74rem', color: '#78350f', margin: '0.35rem 0 0', lineHeight: 1.45 }}>
                    Sample citation ({selectedOaugf.sampleFindings[0].docTitle} p.{selectedOaugf.sampleFindings[0].page}):{' '}
                    {selectedOaugf.sampleFindings[0].heading}
                  </p>
                )}
              </div>
            )}

            <div style={{ backgroundColor: '#e6f7f0', border: '1px solid #a7f3d0', borderRadius: '8px', padding: '1rem', marginTop: 'auto' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#047857', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <ShieldCheck size={16} /> Verifiable Citable Evidence
              </div>
              <p style={{ fontSize: '0.75rem', color: '#065f46', marginTop: '0.25rem', lineHeight: 1.4 }}>
                This project lineage has been indexed across {selectedLineage.years_appeared.length} official federal budget PDFs. Every allocation line is byte-traceable to the Budget Office of the Federation records.
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <ContractorHistoryModal
        contractor={selectedContractor}
        onClose={() => setSelectedContractor(null)}
      />
    </div>
  );
};
