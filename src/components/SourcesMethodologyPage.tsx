import React, { useEffect, useMemo, useState } from 'react';
import { datasetUrl } from '../services/apiClient';
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Filter,
  Landmark,
  Layers,
  Scale,
  Search,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { useBudgetDatabase } from '../context/BudgetDatabaseContext';
import { PRESIDENTS_AGGREGATE, getPresidentForYear } from '../data/presidentialTerms';
import {
  CITATION_STYLES,
  CitationStyle,
  ProvenanceManifestResponse,
  formatViewCitations,
  loadSourceProvenance,
  resolveYearProvenance,
} from '../utils/citationFormatter';
import { exportTabularDossierDocx, exportTabularDossierPdf, TabularDossierSpec } from '../utils/documentExporter';
import { formatNairaCompact, formatNairaExact } from '../utils/reportExporter';
import { getRulesSummary } from '../utils/ruleEngine';
import {
  loadEvidenceEngineAllYears,
  type EvidenceEngineAllYearsPayload,
} from '../utils/evidenceEngineV3';
import {
  loadOaugfAuditIndex,
  type OaugfAuditIndexPayload,
} from '../utils/mdaScorecard';
import { buildCanonicalPermalink } from '../utils/urlState';

interface SourcesMethodologyPageProps {
  onSelectFiscalYear?: (year: number) => void;
}

interface RedFlagConvergenceSummaryPayload {
  headline?: {
    convergentContractorCount?: number;
    highRisk3PlusContractorCount?: number;
    convergentContractorExposureNaira?: number;
    convergentMdaCount?: number;
    highRisk3PlusMdaCount?: number;
  };
}

type MethodologyTab = 'ledger' | 'architecture' | 'economics' | 'rules' | 'citation';
type CoverageFilter = 'ALL' | 'full_project_schedule' | 'partial_schedule' | 'summary_act_only';

interface SweepTimelineRow {
  financialYear: number;
  presidentId: string;
  presidentName: string;
  shortName: string;
  party: string;
  officialBudgetNaira: number;
  fxNairaPerUsd: number;
  minWageMonthly: number;
  dataCoverage: 'full_project_schedule' | 'partial_schedule' | 'summary_act_only';
  totalRecordsScanned: number;
  thresholdsApplied: {
    vehiclesNaira: number;
    mandatesNaira: number;
    blankCheckNaira: number;
    blankShortNaira: number;
    ceremonialNaira: number;
    intangibleNaira: number;
  };
}

interface ForensicSweepMetaPayload {
  generatedAt?: string;
  methodology?: string;
  hygiene?: {
    totalRecordsScanned: number;
    leafCapitalCount: number;
    leafOverheadCount: number;
    excludedRollupRows: number;
  };
  yearlyTimeline?: SweepTimelineRow[];
}

interface DmoDebtYearRow {
  financialYear: number;
  documentCount: number;
  asAt: string | null;
  totalDebtNairaM: number | null;
  totalDebtUsdM: number | null;
  domesticDebtNairaM: number | null;
  externalDebtUsdM: number | null;
  externalDebtNairaM: number | null;
  cbnFxRate: number | null;
  primarySource: string;
}

interface DebtProfilePayload {
  generatedAt?: string;
  source?: string;
  totalDocumentsIndexed?: number;
  yearsCovered?: number[];
  yearlyDebt?: DmoDebtYearRow[];
}

interface PolicyDocumentRow {
  slug: string;
  title: string;
  category: string;
  docType: string;
  fiscalYearStart: number | null;
  fiscalYearEnd: number | null;
  localPath: string;
  pageCount: number;
  chunkCount: number;
  sha256: string | null;
  extractionStatus: 'TEXT_INDEXED' | 'OCR_INDEXED' | 'OCR_PENDING' | 'INVALID_PDF';
}

interface PolicyBenchmarksPayload {
  generatedAt?: string;
  status?: string;
  source?: string;
  totalManifestEntries?: number;
  textIndexedCount?: number;
  ocrIndexedCount?: number;
  ocrPendingCount?: number;
  invalidPdfCount?: number;
  totalChunksIndexed?: number;
  documents?: PolicyDocumentRow[];
}

interface ExecutionTrackerReportRow {
  financialYear: number;
  sourceFile: string;
  sha256?: string | null;
  quarterCovered?: string | null;
  reportPeriodLabel?: string | null;
  totalAppropriatedNaira: number;
  totalReleasedNaira: number;
  overallReleasePct: number;
  overallUtilizationPct?: number | null;
  mdaCount?: number;
}

interface ExecutionTrackerPayload {
  status?: string;
  yearsCovered?: number[];
  reports?: ExecutionTrackerReportRow[];
}

interface LedgerRow {
  year: number;
  presidentId: string;
  presidentName: string;
  party: string;
  primaryFilename: string;
  primarySha256: string | null;
  shortSha256: string | null;
  files: Array<{ filename: string; sha256: string; totalRecords: number }>;
  coverage: 'full_project_schedule' | 'partial_schedule' | 'summary_act_only';
  extractedItems: number;
  gemmaEnrichedCount: number;
  extractedRatioPct: number | null;
  pageCount: number;
  status: string;
}

const COVERAGE_META: Record<
  LedgerRow['coverage'],
  { label: string; bg: string; fg: string; border: string }
> = {
  full_project_schedule: {
    label: 'Full Project Schedule',
    bg: '#ecfdf5',
    fg: '#047857',
    border: '#a7f3d0',
  },
  partial_schedule: {
    label: 'Partial Schedule',
    bg: '#fffbeb',
    fg: '#b45309',
    border: '#fde68a',
  },
  summary_act_only: {
    label: 'Summary Act Only',
    bg: '#f1f5f9',
    fg: '#475569',
    border: '#cbd5e1',
  },
};

const DATA_HYGIENE_SPECS = [
  {
    title: '1. MDA Summary Rollup Exclusion',
    formula: 'Regex ^[0-5]\\d{8,9}$',
    summary:
      'Parent agency/ministry subtotal rows matching 9–10 digit administrative rollup codes (prefix 0–5) are excluded before rule scans and summation so agency totals never double-count child capital projects.',
  },
  {
    title: '2. Chart of Accounts (COA) Hierarchy Isolation',
    formula: '21xxxxxx / 23xxxxxx vs 2202xxxx',
    summary:
      'Macro COA summary headers (21xxxxxx personnel, 23xxxxxx capital rollups) are separated from project lines, while specific discretionary overhead codes (22020104, 22020103, 22021007, 22021002, 22021001, 22021003, 22021009) are audited separately.',
  },
  {
    title: '3. Domain False-Positive Guards',
    formula: 'Security · Hospital / Correctional · Multilateral',
    summary:
      'Vehicle, lodging, and food/travel rules suppress matches involving Military/Police/Intelligence agencies (Defence, Army, Navy, Police, DSS, NSCDC), Tertiary Hospitals/Correctional Services, and tied World Bank/AfDB/IsDB loans.',
  },
  {
    title: '4. Disguised Duplicate & Split Detection',
    formula: 'O(N) Token-Synonym Normalization',
    summary:
      'Near-identical descriptions reworded with synonyms or split across round-number lots are normalized deterministically into reproducible clusters with line-level page citations.',
  },
  {
    title: '5. NOCOPO Planning vs. Awarded Stage Isolation',
    formula: 'Award / Contract / Implementation Only',
    summary:
      'Out of 98,866 BPP NOCOPO OCDS records, 82,140 planning/tender rows are excluded from contract award totals, HHI concentration, and payment overrun calculations so pre-tender budget ceilings never distort procurement reality.',
  },
  {
    title: '6. Open Treasury Partial-Year & Benford Sample Controls',
    formula: 'Full Calendar Years (2019–2025) & N >= 500',
    summary:
      'December Rush ratios are computed strictly across the 7 complete calendar years (2019–2025), excluding partial boundary years (2018: 4 mos; 2026: 6 mos), and per-MDA Benford MAD alerts enforce N >= 500 vouchers.',
  },
];

const CROSS_LEDGER_ARTIFACT_DESCRIPTIONS: Record<string, { label: string; scope: string }> = {
  'evidence_engine_all_years.json': {
    label: 'Evidence Engine v3.0 28-Year Cross-Ledger Index',
    scope: '559,391 records × 22 rules -> 46,255 findings (27,859 cross-ledger) & 3,329 duplicate clusters',
  },
  'oaugf_audit_index.json': {
    label: 'OAuGF Constitutional Audit Negligence Index (1999–2024)',
    scope: '36 official reports (11,372 pages) -> 7,028 findings, 675 recovery directives & 54 repeat queries (+7 shards)',
  },
  'red_flag_convergence_index.json': {
    label: '6-Ledger Multi-Flag Convergence Index',
    scope: '29 Multi-Flag Contractors (₦583.04B) & 77 Multi-Flag MDAs (27 triggering >=3 ledgers simultaneously)',
  },
  'vendor_network_index.json': {
    label: 'Vendor Capture, HHI & Off-NOCOPO Personal/Staff Payouts Index',
    scope: '216 HHI-scored MDAs, 3,377 >125% overpaid vendors, 10,851 Staff/Individual accounts (₦1.49T) & 4,169 Unclassified (₦1.26T)',
  },
  'govspend_forensics.json': {
    label: 'Open Treasury Cash Forensics & Opaque/Discretionary Audit',
    scope: '467,763 vouchers (₦47.53T): 2.75x Dec Rush, 16,996 7-day split clusters & 33,366 opaque/discretionary vouchers (₦2.44T)',
  },
  'procurement_risk_index.json': {
    label: 'NOCOPO Non-Competitive Procurement & Variation Overrun Index',
    scope: '16,726 awarded contracts (₦4.38T): 5,481 non-competitive awards (₦1.31T) & 440 payment overruns (+₦939.85B)',
  },
  'project_lifecycle_index.json': {
    label: '5-Stage Project Lifecycle & Paid-on-Paper Index (+64 Shards)',
    scope: '40,655 linked budget records & 3,096 Paid-on-Paper priority verification records',
  },
  'follow_the_money_links.json': {
    label: 'Follow-the-Money Padding & Zombie Lineage Cross-Links',
    scope: 'Links 7 Bill-vs-Act padding cycles (9,403 items) and 3,500 recurring lineages to NOCOPO & GovSpend payouts',
  },
  'mda_integrity_scorecards.json': {
    label: 'Composite 5-Pillar MDA Integrity Scorecards',
    scope: '252 federal MDAs graded A–F with dynamic weight re-normalization across covered pillars',
  },
  'macro_credibility_tracker.json': {
    label: 'Macro-Fiscal Credibility & Optimism Bias Tracker (2009–2026)',
    scope: 'Reconciles MTEF oil/FX/GDP benchmarks against enacted budgets, BIR releases, and DMO debt service',
  },
  'geo_intelligence_index.json': {
    label: '36-State + FCT & 774-LGA 3-Layer Geo Execution Index',
    scope: 'Maps Budgeted vs. Contracted (NOCOPO) vs. Disbursed (GovSpend) across 37 states & 774 LGAs',
  },
};

export const SourcesMethodologyPage: React.FC<SourcesMethodologyPageProps> = ({
  onSelectFiscalYear,
}) => {
  const { registryDocs, activeYear } = useBudgetDatabase();
  const [activeSubTab, setActiveSubTab] = useState<MethodologyTab>('ledger');
  const [provenanceManifest, setProvenanceManifest] = useState<ProvenanceManifestResponse | null>(null);
  const [sweepData, setSweepData] = useState<ForensicSweepMetaPayload | null>(null);
  const [debtData, setDebtData] = useState<DebtProfilePayload | null>(null);
  const [policyData, setPolicyData] = useState<PolicyBenchmarksPayload | null>(null);
  const [birData, setBirData] = useState<ExecutionTrackerPayload | null>(null);
  const [oaugfData, setOaugfData] = useState<OaugfAuditIndexPayload | null>(null);
  const [convergenceData, setConvergenceData] = useState<RedFlagConvergenceSummaryPayload | null>(null);
  const [evidenceV3Data, setEvidenceV3Data] = useState<EvidenceEngineAllYearsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const [ledgerSection, setLedgerSection] = useState<'budgets' | 'oaugf' | 'bir_policy' | 'dmo'>('budgets');
  const [ledgerQuery, setLedgerQuery] = useState('');
  const [presidentFilter, setPresidentFilter] = useState<string>('ALL');
  const [coverageFilter, setCoverageFilter] = useState<CoverageFilter>('ALL');
  const [expandedYear, setExpandedYear] = useState<number | null>(null);
  const [ruleSeverityFilter, setRuleSeverityFilter] = useState<'ALL' | 'high' | 'medium' | 'low'>('ALL');
  const [ruleScopeFilter, setRuleScopeFilter] = useState<'ALL' | 'CROSS_LEDGER' | 'TEXT_AND_DOMAIN'>('ALL');
  const [citationStyle, setCitationStyle] = useState<CitationStyle>('newsroom');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [exportingKey, setExportingKey] = useState<string | null>(null);

  const rulesCatalog = useMemo(() => getRulesSummary(true), []);

  useEffect(() => {
    let active = true;
    setLoading(true);

    Promise.all([
      loadSourceProvenance(),
      fetch(datasetUrl('/datasets/forensic_sweep_1999_2026.json'), { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(datasetUrl('/datasets/debt_profile.json'), { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(datasetUrl('/datasets/policy_benchmarks.json'), { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(datasetUrl('/datasets/execution_tracker.json'), { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      loadOaugfAuditIndex(),
      fetch(datasetUrl('/datasets/red_flag_convergence_index.json'), { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      loadEvidenceEngineAllYears(),
    ]).then(([manifest, sweep, debt, policy, bir, oaugf, conv, ev3]) => {
      if (!active) return;
      setProvenanceManifest(manifest);
      setSweepData(sweep);
      setDebtData(debt);
      setPolicyData(policy);
      setBirData(bir);
      setOaugfData(oaugf);
      setConvergenceData(conv);
      setEvidenceV3Data(ev3);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  const triggerCopy = (id: string, value: string) => {
    if (!value) return;
    navigator.clipboard?.writeText(value);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1800);
  };

  // Merge registryDocs, source_provenance.json, and forensic_sweep yearlyTimeline for 1999-2026
  const ledgerRows = useMemo<LedgerRow[]>(() => {
    const timelineByYear = new Map<number, SweepTimelineRow>(
      (sweepData?.yearlyTimeline || []).map((t) => [t.financialYear, t])
    );
    const regByYear = new Map(
      registryDocs.map((d) => [d.financial_year || d.financialYear, d])
    );

    const yearsSet = new Set<number>();
    timelineByYear.forEach((_, y) => yearsSet.add(y));
    regByYear.forEach((_, y) => yearsSet.add(y));
    if (provenanceManifest?.years) {
      Object.keys(provenanceManifest.years).forEach((y) => yearsSet.add(Number(y)));
    }

    return Array.from(yearsSet)
      .filter((y) => Number.isInteger(y) && y >= 1999)
      .sort((a, b) => b - a)
      .map((yr) => {
        const regDoc = regByYear.get(yr);
        const manifestYr = provenanceManifest?.years?.[String(yr)];
        const tl = timelineByYear.get(yr);
        const pres = getPresidentForYear(yr);
        const primaryFilename =
          manifestYr?.primaryFile?.filename ||
          regDoc?.source_files?.[0] ||
          `FY ${yr} Federal Appropriation Act.pdf`;
        const regShaRaw = (regDoc?.sha256 || '').replace(/^sha256:/i, '').trim();
        const primarySha256 = manifestYr?.primaryFile?.sha256 || (regShaRaw || null);
        const shortSha256 =
          manifestYr?.primaryFile?.shortSha256 || (primarySha256 ? primarySha256.slice(0, 16) : null);
        const extractedItems =
          tl?.totalRecordsScanned ??
          (regDoc?.project_count || regDoc?.extractedProjectsCount || manifestYr?.totalRecords || 0);
        const tierMap: Record<string, LedgerRow['coverage']> = {
          FULL_SCHEDULE: 'full_project_schedule',
          PARTIAL_SCHEDULE: 'partial_schedule',
          SUMMARY_ACT_ONLY: 'summary_act_only',
        };
        const coverage: LedgerRow['coverage'] =
          (regDoc?.coverage_tier && tierMap[regDoc.coverage_tier]) ||
          tl?.dataCoverage ||
          (extractedItems >= 1500
            ? 'full_project_schedule'
            : extractedItems >= 300
            ? 'partial_schedule'
            : 'summary_act_only');

        return {
          year: yr,
          presidentId: tl?.presidentId || pres.presidentId,
          presidentName: tl?.presidentName || pres.presidentName,
          party: tl?.party || pres.party,
          primaryFilename,
          primarySha256,
          shortSha256,
          files: (manifestYr?.files || []).map((f) => ({
            filename: f.filename,
            sha256: f.sha256,
            totalRecords: f.totalRecords,
          })),
          coverage,
          extractedItems,
          gemmaEnrichedCount: regDoc?.gemma_enriched_count || 0,
          extractedRatioPct:
            typeof regDoc?.extracted_ratio_pct === 'number' ? regDoc.extracted_ratio_pct : null,
          pageCount: manifestYr?.pageCount ?? regDoc?.page_count ?? 0,
          status: regDoc?.status || manifestYr?.scheduleStatus || 'INDEXED',
        };
      });
  }, [registryDocs, provenanceManifest, sweepData]);

  const filteredLedgerRows = useMemo(() => {
    const q = ledgerQuery.trim().toLowerCase();
    return ledgerRows.filter((r) => {
      if (presidentFilter !== 'ALL' && r.presidentId !== presidentFilter) return false;
      if (coverageFilter !== 'ALL' && r.coverage !== coverageFilter) return false;
      if (!q) return true;
      const fileHay = r.files.map((f) => `${f.filename} ${f.sha256}`).join(' ');
      return (
        String(r.year).includes(q) ||
        r.presidentName.toLowerCase().includes(q) ||
        r.primaryFilename.toLowerCase().includes(q) ||
        (r.primarySha256 || '').toLowerCase().includes(q) ||
        fileHay.toLowerCase().includes(q)
      );
    });
  }, [ledgerRows, ledgerQuery, presidentFilter, coverageFilter]);

  const timelineAsc = useMemo(
    () => [...(sweepData?.yearlyTimeline || [])].sort((a, b) => a.financialYear - b.financialYear),
    [sweepData]
  );

  const debtRowsDesc = useMemo(
    () => [...(debtData?.yearlyDebt || [])].sort((a, b) => b.financialYear - a.financialYear),
    [debtData]
  );

  const birReportsDesc = useMemo(
    () => [...(birData?.reports || [])].sort((a, b) => b.financialYear - a.financialYear),
    [birData]
  );

  const totalEnrichedLive = useMemo(
    () => registryDocs.reduce((sum, d) => sum + (d.gemma_enriched_count || 0), 0),
    [registryDocs]
  );

  const ruleStatsById = useMemo(() => {
    const map = new Map<string, { allYearsCount: number; allYearsAmountNaira: number; peakYear: number | null; topMdaName: string | null }>();
    for (const r of evidenceV3Data?.rulesCatalog || []) {
      map.set(r.id, {
        allYearsCount: r.allYearsCount,
        allYearsAmountNaira: r.allYearsAmountNaira,
        peakYear: r.peakYear,
        topMdaName: r.topMdaName,
      });
    }
    return map;
  }, [evidenceV3Data]);

  const filteredRules = useMemo(() => {
    return rulesCatalog.filter((r) => {
      if (ruleSeverityFilter !== 'ALL' && r.severity !== ruleSeverityFilter) return false;
      if (ruleScopeFilter !== 'ALL' && r.ledgerScope !== ruleScopeFilter) return false;
      return true;
    });
  }, [rulesCatalog, ruleSeverityFilter, ruleScopeFilter]);

  const institutionalCitations = useMemo(() => {
    const refYear = activeYear || 2026;
    const regDoc = registryDocs.find((d) => (d.financial_year || d.financialYear) === refYear);
    const prov = resolveYearProvenance(provenanceManifest, refYear, regDoc);
    const permalink =
      buildCanonicalPermalink({ tab: 'methodology', year: refYear }) ||
      'https://budgetlens.ng/?tab=methodology';
    return formatViewCitations({
      activeTab: 'methodology',
      financialYear: refYear,
      permalink,
      provenance: prov,
      totalIndexedYears: ledgerRows.length,
    });
  }, [activeYear, registryDocs, provenanceManifest, ledgerRows.length]);

  const ccAttributionText =
    `BudgetLens Civic Fiscal Observatory (${new Date().getUTCFullYear()}). Nigeria Multi-Ledger Federal Budget, OAuGF Constitutional Audit, Open Treasury, NOCOPO Procurement & Public Debt Provenance Registry (FY 1999–2026), licensed under Creative Commons Attribution 4.0 International (CC BY 4.0). Primary documents: Budget Office of the Federation, Office of the Auditor-General for the Federation (OAuGF), Bureau of Public Procurement (NOCOPO), Office of the Accountant-General (Open Treasury), and Debt Management Office (Nigeria). Permalink: ${
      buildCanonicalPermalink({ tab: 'methodology' }) || 'https://budgetlens.ng/?tab=methodology'
    }`;

  // Shared Spec Builders for Strict PDF & DOCX Export
  const buildSourceLedgerSpec = (): TabularDossierSpec => ({
    filenameBase: 'BudgetLens_Source_Provenance_Ledger_1999_2026',
    eyebrow: 'BUDGETLENS CRYPTOGRAPHIC SOURCE REGISTRY · FY 1999–2026',
    title: 'Primary Government Source Document & 6-Ledger SHA-256 Provenance Registry',
    subtitle:
      'Federal Appropriation Acts/Bills (1999–2026), OAuGF Audit Reports (1999–2024), BIR Releases (2009–2026), NOCOPO OCDS, Open Treasury & DMO Debt (2004–2026)',
    orientation: 'landscape',
    metadata: [
      { label: 'Budget Years Shown', value: `${filteredLedgerRows.length} of ${ledgerRows.length}` },
      { label: 'Ingested Budget PDFs', value: `${provenanceManifest?.totalFiles ?? 468} Fingerprinted Schedules` },
      { label: 'OAuGF Audit Archive', value: `${oaugfData?.headline.reportsIndexed ?? 36} Reports (${(oaugfData?.headline.parsedAuditIssuesCount ?? 7028).toLocaleString()} Findings)` },
      { label: 'DMO Debt Releases', value: `${debtData?.totalDocumentsIndexed ?? 505} Official Debt Bulletins` },
    ],
    kpis: [
      { label: 'Federal Schedules', value: `${ledgerRows.length} Years`, subtext: `${provenanceManifest?.totalFiles ?? 468} PDFs Indexed` },
      { label: 'OAuGF Audit Reports', value: `${oaugfData?.headline.reportsIndexed ?? 36} Reports`, subtext: `${(oaugfData?.headline.parsedAuditIssuesCount ?? 7028).toLocaleString()} Constitutional Findings` },
      { label: 'Treasury & NOCOPO', value: '467,763 Vouchers', subtext: '98,866 NOCOPO OCDS Records' },
      { label: 'DMO Debt Archive', value: `${debtData?.yearsCovered?.length ?? 23} Years`, subtext: '505 Sovereign Debt PDFs' },
    ],
    tables: [
      {
        heading: `1. Federal Appropriation Schedules (${filteredLedgerRows.length} Fiscal Years)`,
        columns: ['FY', 'Serving President', 'Primary PDF Source', 'PDFs', 'Coverage Tier', 'Items', 'SHA-256 Prefix'],
        rows: filteredLedgerRows.map((r) => [
          `FY ${r.year}`,
          `${r.presidentName} (${r.party})`,
          r.primaryFilename,
          r.files.length || 1,
          COVERAGE_META[r.coverage].label,
          r.extractedItems.toLocaleString(),
          r.shortSha256 ? `${r.shortSha256}...` : 'Pending',
        ]),
        rightAlignColumns: [3, 5],
      },
      {
        heading: `2. OAuGF Constitutional Audit Reports (${oaugfData?.documents?.length ?? 36} Extracted Reports · 1999–2024)`,
        columns: ['FY', 'Official OAuGF Audit Report Title', 'Category', 'Pages', 'Findings', 'Source'],
        rows: (oaugfData?.documents || []).map((rep) => [
          rep.years?.length ? `FY ${rep.years.join('/')}` : 'Multi-Yr',
          rep.title.slice(0, 68),
          rep.category.slice(0, 26),
          String(rep.pageCount),
          String(rep.issueCount),
          'oaugf.ng (Verified)',
        ]),
        rightAlignColumns: [3, 4],
      },
      {
        heading: `3. DMO Sovereign Public Debt Releases (${debtRowsDesc.length} Fiscal Years)`,
        columns: ['FY', 'Primary DMO Document Title', 'As-At Date', 'Releases', 'Total Debt Stock', 'CBN FX (₦/$)'],
        rows: debtRowsDesc.map((d) => [
          `FY ${d.financialYear}`,
          d.primarySource,
          d.asAt || `FY ${d.financialYear}`,
          d.documentCount,
          d.totalDebtNairaM !== null ? formatNairaCompact(d.totalDebtNairaM * 1e6) : 'Service-Only Record',
          d.cbnFxRate ? `₦${d.cbnFxRate.toLocaleString()}` : 'N/A',
        ]),
        rightAlignColumns: [3, 4, 5],
      },
    ],
    permalink: buildCanonicalPermalink({ tab: 'methodology' }),
    footnote: 'SHA-256 digests verified verbatim against ingested official appropriation PDFs and treasury records.',
  });

  const buildCompleteMethodologySpec = (): TabularDossierSpec => ({
    filenameBase: 'BudgetLens_Complete_Methodology_Dossier_1999_2026',
    eyebrow: 'BUDGETLENS INSTITUTIONAL REFERENCE · 6-LEDGER METHODOLOGY & PROVENANCE DOSSIER',
    title: 'Sources, 6-Ledger Architecture, Cryptographic Provenance & Rule Engine v3.0',
    subtitle:
      'Complete specification of SHA-256 fingerprinting, 6-ledger cross-joins (Budgets, Padding, BIR, NOCOPO, Open Treasury, OAuGF), CBN FX thresholds, and Rule Engine v3.0 (22 Rules)',
    orientation: 'landscape',
    metadata: [
      { label: 'Scope', value: 'Fourth Republic (FY 1999–2026)' },
      { label: 'Primary Archives', value: `${provenanceManifest?.totalFiles ?? 468} Budget + ${oaugfData?.headline.reportsIndexed ?? 36} OAuGF + ${debtData?.totalDocumentsIndexed ?? 505} DMO` },
      { label: 'Rule Engine', value: `v3.0 (${rulesCatalog.length} Deterministic Rules: 16 Domain + 6 Cross-Ledger)` },
      { label: 'Reuse License', value: 'CC BY 4.0 International' },
    ],
    kpis: [
      { label: '28-Yr Budget Lines', value: (evidenceV3Data?.summary.totalRecordsScanned ?? 559391).toLocaleString(), subtext: 'FY 1999–2026 scanned' },
      { label: 'Rule Engine v3.0 Hits', value: (evidenceV3Data?.summary.totalRuleFindings ?? 46255).toLocaleString(), subtext: `${(evidenceV3Data?.summary.totalCrossLedgerFindings ?? 27859).toLocaleString()} cross-ledger` },
      { label: 'OAuGF Audit Queries', value: (oaugfData?.headline.parsedAuditIssuesCount ?? 7028).toLocaleString(), subtext: '36 reports (1999–2024)' },
      { label: 'Open Treasury & NOCOPO', value: '467,763 Vouchers', subtext: '98,866 NOCOPO OCIDs' },
    ],
    narrative:
      'BudgetLens cross-joins 6 independent public fiscal and constitutional audit ledgers: (1) Enacted Federal Appropriation Acts & Executive Bills (1999–2026), (2) Budget Office Implementation Reports (BIR 2009–2026) & MTEF/FSP Benchmarks, (3) BPP NOCOPO Open Contracting Awards (98,866 OCIDs; 16,726 awarded / NGN 4.38T), (4) OAGF Open Treasury Payment Vouchers (467,763 vouchers / NGN 47.53T, including NGN 1.49T staff/personal accounts & NGN 2.44T opaque/discretionary vouchers), (5) Office of the Auditor-General for the Federation (OAuGF) Constitutional Audit Reports (36 reports / 11,372 pages / 7,028 findings), and (6) DMO Sovereign Debt Bulletins (505 releases).',
    bulletBlocks: [
      {
        heading: 'Data Hygiene, COA Isolation & Cross-Ledger Statistical Controls',
        items: DATA_HYGIENE_SPECS.map((s) => `${s.title} [${s.formula}]: ${s.summary}`),
      },
      {
        heading: 'Methodological Scope Limitations & Licensing (CC BY 4.0)',
        items: [
          'Enacted vs Executed Spending: Federal Appropriation Acts measure statutory expenditure ceilings authorized by the National Assembly, while BIR, NOCOPO, and Open Treasury track releases, contracts, and cash vouchers.',
          'Constitutional Audit Queries vs Court Convictions: OAuGF audit findings and 6-ledger convergence scores document verified public-record queries and statistical discrepancies requiring oversight or FOI follow-up — not judicial convictions.',
          'Institutional Attribution (CC BY 4.0): Analytical classifications and derived indices are reusable with attribution; underlying PDF schedules remain public Government of Nigeria records.',
        ],
      },
    ],
    tables: [
      {
        heading: `1. Rule Engine v3.0 Deterministic Catalog (${rulesCatalog.length} Rules: 16 Domain + 6 Cross-Ledger)`,
        columns: ['Rule ID', 'Scope', 'Rule Name', 'Category', 'Severity', '28-Yr Hits', '28-Yr Exposure'],
        rows: rulesCatalog.map((r) => {
          const st = ruleStatsById.get(r.id);
          return [
            r.id,
            r.ledgerScope === 'CROSS_LEDGER' ? '6-LEDGER' : 'DOMAIN',
            r.name,
            r.category,
            r.severity.toUpperCase(),
            st ? st.allYearsCount.toLocaleString() : 'Active',
            st ? formatNairaCompact(st.allYearsAmountNaira) : 'Active',
          ];
        }),
        rightAlignColumns: [5, 6],
      },
      {
        heading: '2. Year-Native Economic Calibration Schedule (1999–2026)',
        columns: ['FY', 'President', 'Enacted Budget', 'CBN FX (₦/$)', 'Min Wage/Mo', 'Fleet ($65k)', 'Blank Check (0.001%)', 'Coverage'],
        rows: timelineAsc.map((t) => [
          t.financialYear,
          t.shortName,
          formatNairaCompact(t.officialBudgetNaira),
          `₦${t.fxNairaPerUsd.toLocaleString()}`,
          `₦${t.minWageMonthly.toLocaleString()}`,
          formatNairaCompact(t.thresholdsApplied.vehiclesNaira),
          formatNairaCompact(t.thresholdsApplied.blankCheckNaira),
          COVERAGE_META[t.dataCoverage]?.label || t.dataCoverage,
        ]),
        rightAlignColumns: [0, 2, 3, 4, 5, 6],
      },
      {
        heading: `3. Primary Federal Budget Source Ledger (${ledgerRows.length} Fiscal Years)`,
        columns: ['FY', 'Serving President', 'Primary PDF Filename', 'Coverage', 'Items', 'SHA-256 Prefix'],
        rows: ledgerRows.map((r) => [
          `FY ${r.year}`,
          r.presidentName,
          r.primaryFilename,
          COVERAGE_META[r.coverage].label,
          r.extractedItems.toLocaleString(),
          r.shortSha256 ? `${r.shortSha256}...` : 'Pending',
        ]),
        rightAlignColumns: [4],
      },
    ],
    permalink: buildCanonicalPermalink({ tab: 'methodology' }),
    footnote: 'BudgetLens Civic Fiscal Observatory — Evidence, not accusations.',
  });

  const handleExportPdf = async (kind: 'ledger' | 'complete') => {
    const key = `${kind}-pdf`;
    if (exportingKey) return;
    setExportingKey(key);
    try {
      const spec = kind === 'ledger' ? buildSourceLedgerSpec() : buildCompleteMethodologySpec();
      await exportTabularDossierPdf(spec);
    } finally {
      setExportingKey(null);
    }
  };

  const handleExportDocx = async (kind: 'ledger' | 'complete') => {
    const key = `${kind}-docx`;
    if (exportingKey) return;
    setExportingKey(key);
    try {
      const spec = kind === 'ledger' ? buildSourceLedgerSpec() : buildCompleteMethodologySpec();
      await exportTabularDossierDocx(spec);
    } finally {
      setExportingKey(null);
    }
  };

  const subTabs: Array<{ id: MethodologyTab; label: string; icon: React.ReactNode }> = [
    {
      id: 'ledger',
      label: `Primary Source Ledgers (${ledgerRows.length} Yrs + OAuGF + BIR + DMO)`,
      icon: <Database size={15} />,
    },
    {
      id: 'architecture',
      label: '6-Ledger Cross-Join Architecture & Provenance',
      icon: <Layers size={15} />,
    },
    {
      id: 'economics',
      label: 'Year-Native Economic Calibration (1999–2026)',
      icon: <Scale size={15} />,
    },
    {
      id: 'rules',
      label: `Hygiene & Rule Engine v3.0 (${rulesCatalog.length} Rules)`,
      icon: <ShieldAlert size={15} />,
    },
    {
      id: 'citation',
      label: 'Citation Standard & CC BY 4.0',
      icon: <BookOpen size={15} />,
    },
  ];

  const phase3DatasetsEntries = useMemo(() => {
    const map = provenanceManifest?.phase3Datasets || {};
    return Object.entries(map).filter(([k]) => k !== 'project_lifecycle_shards');
  }, [provenanceManifest]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Editorial Hero Header */}
      <section
        className="dossier-card"
        style={{
          padding: '1.4rem 1.55rem',
          background: 'linear-gradient(135deg, #091017 0%, #0f1b29 100%)',
          color: '#ffffff',
          borderColor: '#1e293b',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ maxWidth: '760px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.45rem' }}>
              <span
                className="font-mono"
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  letterSpacing: '0.07em',
                  textTransform: 'uppercase',
                  padding: '0.18rem 0.55rem',
                  borderRadius: '4px',
                  backgroundColor: 'rgba(16, 185, 129, 0.16)',
                  color: '#6ee7b7',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                }}
              >
                Institutional Reference · FY 1999–2026 · 6 Public Ledgers Joined
              </span>
              <span className="font-mono" style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                CC BY 4.0 Open Fiscal Observability
              </span>
            </div>
            <h1 className="font-editorial" style={{ fontSize: '1.65rem', fontWeight: 600, color: '#ffffff', margin: '0 0 0.35rem 0', lineHeight: 1.25 }}>
              Sources, 6-Ledger Cryptographic Provenance &amp; Methodology
            </h1>
            <p style={{ fontSize: '0.84rem', color: '#cbd5e1', lineHeight: 1.55, margin: 0 }}>
              Every figure, chart, and red flag on BudgetLens is deterministically traced to byte-verified Federal Appropriation Acts/Bills (`468` PDFs), OAuGF Constitutional Audit Reports (`36` reports / `11,372` pages / `7,028` findings), Budget Office Implementation Reports (`46` BIRs), BPP NOCOPO contracts (`98,866` OCIDs), OAGF Open Treasury vouchers (`467,763` payments / `₦47.53T`), and DMO Sovereign Debt bulletins (`505` releases).
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => handleExportPdf('complete')}
              disabled={loading || exportingKey !== null}
              className="editorial-btn-primary"
            >
              <FileText size={14} />
              {exportingKey === 'complete-pdf' ? 'Generating PDF...' : 'Methodology Dossier (PDF)'}
            </button>
            <button
              type="button"
              onClick={() => handleExportDocx('complete')}
              disabled={loading || exportingKey !== null}
              className="editorial-btn"
              style={{ backgroundColor: '#111b27', color: '#ffffff', borderColor: '#334155' }}
            >
              <Download size={14} color="#34d399" />
              {exportingKey === 'complete-docx' ? 'Generating DOCX...' : 'Methodology Dossier (DOCX)'}
            </button>
          </div>
        </div>

        {/* 6-Ledger Summary KPI Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(195px, 1fr))',
            gap: '0.65rem',
            marginTop: '1.15rem',
          }}
        >
          <div style={{ backgroundColor: 'rgba(15, 24, 34, 0.88)', border: '1px solid #1e293b', borderRadius: '8px', padding: '0.72rem 0.85rem' }}>
            <div style={{ fontSize: '0.66rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              1. Federal Budgets (1999–2026)
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.1rem', fontWeight: 700, color: '#ffffff', marginTop: '0.15rem' }}>
              {ledgerRows.length} Yrs · {provenanceManifest?.totalFiles ?? 468} PDFs
            </div>
            <div style={{ fontSize: '0.68rem', color: '#6ee7b7', marginTop: '0.12rem' }}>
              {(evidenceV3Data?.summary.totalRecordsScanned ?? 559391).toLocaleString()} items · 7 Bill-vs-Act cycles
            </div>
          </div>

          <div style={{ backgroundColor: 'rgba(15, 24, 34, 0.88)', border: '1px solid #1e293b', borderRadius: '8px', padding: '0.72rem 0.85rem' }}>
            <div style={{ fontSize: '0.66rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              2. OAuGF Constitutional Audits
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fca5a5', marginTop: '0.15rem' }}>
              {oaugfData?.headline.reportsIndexed ?? 36} Reports · {(oaugfData?.headline.parsedAuditIssuesCount ?? 7028).toLocaleString()} Issues
            </div>
            <div style={{ fontSize: '0.68rem', color: '#cbd5e1', marginTop: '0.12rem' }}>
              {(oaugfData?.headline.totalPages ?? 11372).toLocaleString()} pages · {oaugfData?.headline.recoveryDirectiveCount ?? 675} recovery orders
            </div>
          </div>

          <div style={{ backgroundColor: 'rgba(15, 24, 34, 0.88)', border: '1px solid #1e293b', borderRadius: '8px', padding: '0.72rem 0.85rem' }}>
            <div style={{ fontSize: '0.66rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              3. Open Treasury (GovSpend)
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.1rem', fontWeight: 700, color: '#93c5fd', marginTop: '0.15rem' }}>
              467,763 Vouchers · ₦47.53T
            </div>
            <div style={{ fontSize: '0.68rem', color: '#cbd5e1', marginTop: '0.12rem' }}>
              ₦1.49T personal/staff · ₦2.44T opaque/discretionary
            </div>
          </div>

          <div style={{ backgroundColor: 'rgba(15, 24, 34, 0.88)', border: '1px solid #1e293b', borderRadius: '8px', padding: '0.72rem 0.85rem' }}>
            <div style={{ fontSize: '0.66rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              4. BPP NOCOPO Contracts
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fde68a', marginTop: '0.15rem' }}>
              98,866 OCIDs · ₦4.38T Awarded
            </div>
            <div style={{ fontSize: '0.68rem', color: '#cbd5e1', marginTop: '0.12rem' }}>
              16,726 awarded · 82,140 planning excluded
            </div>
          </div>

          <div style={{ backgroundColor: 'rgba(15, 24, 34, 0.88)', border: '1px solid #1e293b', borderRadius: '8px', padding: '0.72rem 0.85rem' }}>
            <div style={{ fontSize: '0.66rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              5. BIR, Policy &amp; DMO Debt
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.1rem', fontWeight: 700, color: '#ffffff', marginTop: '0.15rem' }}>
              46 BIRs · 22 MTEF · 505 DMO
            </div>
            <div style={{ fontSize: '0.68rem', color: '#cbd5e1', marginTop: '0.12rem' }}>
              18 BIR yrs (2009–2026) · 23 DMO debt yrs
            </div>
          </div>

          <div style={{ backgroundColor: 'rgba(15, 24, 34, 0.88)', border: '1px solid #1e293b', borderRadius: '8px', padding: '0.72rem 0.85rem' }}>
            <div style={{ fontSize: '0.66rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              6. Evidence Engine v3.0
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.1rem', fontWeight: 700, color: '#34d399', marginTop: '0.15rem' }}>
              {rulesCatalog.length} Rules · {(evidenceV3Data?.summary.totalRuleFindings ?? 46255).toLocaleString()} Hits
            </div>
            <div style={{ fontSize: '0.68rem', color: '#6ee7b7', marginTop: '0.12rem' }}>
              {totalEnrichedLive.toLocaleString()} AI Enriched · {convergenceData?.headline?.convergentMdaCount ?? 77} Convergent MDAs
            </div>
          </div>
        </div>
      </section>

      {/* Navigation Tab Bar */}
      <div
        className="dossier-card"
        style={{
          padding: '0.35rem',
          display: 'flex',
          gap: '0.35rem',
          overflowX: 'auto',
        }}
      >
        {subTabs.map((tab) => {
          const active = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSubTab(tab.id)}
              style={{
                flex: '1 1 auto',
                minWidth: 'fit-content',
                padding: '0.58rem 0.95rem',
                borderRadius: '7px',
                border: active ? '1px solid var(--emerald-primary)' : '1px solid transparent',
                backgroundColor: active ? 'var(--emerald-bg)' : 'transparent',
                color: active ? '#047857' : 'var(--text-secondary)',
                fontWeight: active ? 700 : 500,
                fontSize: '0.8rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.42rem',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
              }}
            >
              {tab.icon} {tab.label}
            </button>
          );
        })}
      </div>

      {/* ===================================================================== */}
      {/* TAB 1: PRIMARY GOVERNMENT SOURCE LEDGERS                              */}
      {/* ===================================================================== */}
      {activeSubTab === 'ledger' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
          {/* Sub-Ledger Pill Switcher + Export Controls */}
          <div className="dossier-card" style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {(
                  [
                    {
                      id: 'budgets',
                      label: `1. Federal Budget PDFs (${ledgerRows.length} Yrs · ${provenanceManifest?.totalFiles ?? 468} PDFs)`,
                    },
                    {
                      id: 'oaugf',
                      label: `2. OAuGF Constitutional Audit Archive (${oaugfData?.headline.reportsIndexed ?? 36} Reports · 1999–2024)`,
                    },
                    {
                      id: 'bir_policy',
                      label: `3. BIR Execution (${birReportsDesc.length} Yrs) & MTEF/Policy (${policyData?.totalManifestEntries ?? 22})`,
                    },
                    {
                      id: 'dmo',
                      label: `4. DMO Sovereign Debt Ledger (${debtRowsDesc.length} Yrs · ${debtData?.totalDocumentsIndexed ?? 505} PDFs)`,
                    },
                  ] as const
                ).map((sec) => (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => setLedgerSection(sec.id)}
                    style={{
                      padding: '0.42rem 0.8rem',
                      borderRadius: '7px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: ledgerSection === sec.id ? '#091017' : 'var(--card-bg)',
                      color: ledgerSection === sec.id ? '#ffffff' : 'var(--text-secondary)',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {sec.label}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => handleExportPdf('ledger')}
                  disabled={loading || exportingKey !== null}
                  className="editorial-btn-primary"
                >
                  <FileText size={14} />
                  {exportingKey === 'ledger-pdf' ? 'Building PDF...' : 'Export Source Ledger (PDF)'}
                </button>
                <button
                  type="button"
                  onClick={() => handleExportDocx('ledger')}
                  disabled={loading || exportingKey !== null}
                  className="editorial-btn"
                >
                  <Download size={14} color="#059669" />
                  {exportingKey === 'ledger-docx' ? 'Building DOCX...' : 'Export Source Ledger (DOCX)'}
                </button>
              </div>
            </div>

            {ledgerSection === 'budgets' && (
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: '1 1 240px' }}>
                  <Search size={14} color="var(--text-muted)" style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)' }} />
                  <input
                    type="text"
                    value={ledgerQuery}
                    onChange={(e) => setLedgerQuery(e.target.value)}
                    placeholder="Search fiscal year, filename, president, or SHA-256 hash..."
                    style={{
                      width: '100%',
                      padding: '0.45rem 0.75rem 0.45rem 2rem',
                      borderRadius: '7px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--card-subtle)',
                      fontSize: '0.78rem',
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Filter size={13} color="var(--text-muted)" />
                  <select
                    aria-label="Filter by Serving President"
                    value={presidentFilter}
                    onChange={(e) => setPresidentFilter(e.target.value)}
                    style={{
                      padding: '0.44rem 0.7rem',
                      borderRadius: '7px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--card-bg)',
                      fontSize: '0.78rem',
                      color: 'var(--text-primary)',
                    }}
                  >
                    <option value="ALL">All Administrations (1999–2026)</option>
                    {PRESIDENTS_AGGREGATE.map((p) => (
                      <option key={p.presidentId} value={p.presidentId}>
                        {p.presidentName} ({p.party})
                      </option>
                    ))}
                  </select>
                </div>

                <select
                  aria-label="Filter by Schedule Coverage"
                  value={coverageFilter}
                  onChange={(e) => setCoverageFilter(e.target.value as CoverageFilter)}
                  style={{
                    padding: '0.44rem 0.7rem',
                    borderRadius: '7px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--card-bg)',
                    fontSize: '0.78rem',
                    color: 'var(--text-primary)',
                  }}
                >
                  <option value="ALL">All Coverage Tiers</option>
                  <option value="full_project_schedule">Full Project Schedule</option>
                  <option value="partial_schedule">Partial Schedule</option>
                  <option value="summary_act_only">Summary Act Only</option>
                </select>
              </div>
            )}
          </div>

          {/* SECTION 1: 28-Year Budget Source Table */}
          {ledgerSection === 'budgets' && (
            <div className="dossier-card" style={{ overflowX: 'auto' }}>
              <table className="editorial-table">
                <thead>
                  <tr>
                    <th>Fiscal Year</th>
                    <th>Serving President</th>
                    <th>Act / Bill Primary PDF(s)</th>
                    <th>Schedule Coverage</th>
                    <th style={{ textAlign: 'right' }}>Items</th>
                    <th>Primary SHA-256 Checksum</th>
                    <th style={{ textAlign: 'right' }}>Explore</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLedgerRows.map((row) => {
                    const covBadge = COVERAGE_META[row.coverage];
                    const isExpanded = expandedYear === row.year;
                    return (
                      <React.Fragment key={row.year}>
                        <tr>
                          <td className="font-mono" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                            FY {row.year}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{row.presidentName}</span>{' '}
                            <span className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>({row.party})</span>
                          </td>
                          <td>
                            <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{row.primaryFilename}</div>
                            {row.files.length > 1 && (
                              <button
                                type="button"
                                onClick={() => setExpandedYear(isExpanded ? null : row.year)}
                                style={{
                                  marginTop: '0.2rem',
                                  background: 'none',
                                  border: 'none',
                                  padding: 0,
                                  fontSize: '0.71rem',
                                  color: 'var(--emerald-primary)',
                                  fontWeight: 600,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.25rem',
                                  cursor: 'pointer',
                                }}
                              >
                                {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                {row.files.length} indexed source PDFs
                              </button>
                            )}
                          </td>
                          <td>
                            <span
                              className="editorial-pill"
                              style={{
                                backgroundColor: covBadge.bg,
                                color: covBadge.fg,
                                border: `1px solid ${covBadge.border}`,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {covBadge.label}
                            </span>
                          </td>
                          <td className="font-mono tabular-nums" style={{ textAlign: 'right', fontWeight: 600 }}>
                            <div>{row.extractedItems.toLocaleString()}</div>
                            {row.gemmaEnrichedCount > 0 && (
                              <div style={{ fontSize: '0.64rem', color: '#059669', fontWeight: 700 }}>
                                {row.gemmaEnrichedCount.toLocaleString()} AI enriched
                              </div>
                            )}
                          </td>
                          <td>
                            {row.primarySha256 ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <span className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }} title={row.primarySha256}>
                                  {row.shortSha256}…
                                </span>
                                <button
                                  type="button"
                                  onClick={() => triggerCopy(`sha-${row.year}`, row.primarySha256 || '')}
                                  className="editorial-btn"
                                  style={{ padding: '0.18rem 0.45rem', fontSize: '0.68rem' }}
                                  title="Copy full 64-character SHA-256 checksum"
                                >
                                  {copiedId === `sha-${row.year}` ? <Check size={11} color="#059669" /> : <Copy size={11} />}
                                  {copiedId === `sha-${row.year}` ? 'Copied' : 'Copy'}
                                </button>
                              </div>
                            ) : (
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Pending verification</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {onSelectFiscalYear && (
                              <button
                                type="button"
                                onClick={() => onSelectFiscalYear(row.year)}
                                className="editorial-btn"
                                style={{ padding: '0.24rem 0.55rem', fontSize: '0.71rem' }}
                              >
                                Open FY <ExternalLink size={11} />
                              </button>
                            )}
                          </td>
                        </tr>
                        {isExpanded && row.files.length > 0 && (
                          <tr>
                            <td colSpan={7} style={{ backgroundColor: 'var(--card-subtle)', padding: '0.85rem 1.15rem' }}>
                              <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.45rem' }}>
                                All {row.files.length} Cryptographically Indexed PDFs for FY {row.year}
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.38rem' }}>
                                {row.files.map((f) => (
                                  <div
                                    key={f.sha256}
                                    style={{
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      gap: '0.75rem',
                                      flexWrap: 'wrap',
                                      padding: '0.4rem 0.65rem',
                                      backgroundColor: 'var(--card-bg)',
                                      border: '1px solid var(--border-color)',
                                      borderRadius: '6px',
                                      fontSize: '0.72rem',
                                    }}
                                  >
                                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{f.filename}</span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                                      <span className="font-mono" style={{ color: 'var(--text-muted)' }}>
                                        {f.totalRecords.toLocaleString()} records
                                      </span>
                                      <span className="font-mono" style={{ color: '#047857', wordBreak: 'break-all' }}>
                                        {f.sha256}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => triggerCopy(`file-${f.sha256}`, f.sha256)}
                                        className="editorial-btn"
                                        style={{ padding: '0.14rem 0.42rem', fontSize: '0.67rem' }}
                                      >
                                        {copiedId === `file-${f.sha256}` ? <Check size={11} color="#059669" /> : <Copy size={11} />}
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* SECTION 2: OAuGF Constitutional Audit Reports Ledger (1999-2024) */}
          {ledgerSection === 'oaugf' && (
            <div className="dossier-card" style={{ overflowX: 'auto' }}>
              <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <h3 className="font-editorial" style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <Scale size={17} color="#b91c1c" />
                    Office of the Auditor-General for the Federation (OAuGF) Constitutional Audit Archive (1999–2024)
                  </h3>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.15rem 0 0' }}>
                    {oaugfData?.headline.reportsIndexed ?? 36} readable reports extracted &amp; OCR&apos;d ({(oaugfData?.headline.totalPages ?? 11372).toLocaleString()} pages · {(oaugfData?.headline.totalChunks ?? 20465).toLocaleString()} FTS5 passages · {(oaugfData?.headline.parsedAuditIssuesCount ?? 7028).toLocaleString()} structured findings). Raw PDFs were deleted post-OCR to save 3.90 GB while preserving SHA-256 digests and verbatim page text.
                  </p>
                </div>
                <span className="editorial-pill" style={{ backgroundColor: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', fontWeight: 700 }}>
                  {(oaugfData?.headline.parsedAuditIssuesCount ?? 7028).toLocaleString()} Extracted Audit Findings
                </span>
              </div>

              <table className="editorial-table">
                <thead>
                  <tr>
                    <th>FY Scope</th>
                    <th>Official OAuGF Report Title</th>
                    <th>Category</th>
                    <th style={{ textAlign: 'right' }}>Pages</th>
                    <th style={{ textAlign: 'right' }}>Findings</th>
                    <th>Published / Source</th>
                  </tr>
                </thead>
                <tbody>
                  {(oaugfData?.documents || []).map((rep) => (
                    <tr key={rep.id}>
                      <td className="font-mono" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {rep.years?.length ? `FY ${rep.years.join('/')}` : 'Multi-Yr'}
                      </td>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{rep.title}</td>
                      <td>
                        <span className="editorial-pill" style={{ fontSize: '0.67rem' }}>{rep.category}</span>
                      </td>
                      <td className="font-mono tabular-nums" style={{ textAlign: 'right' }}>{rep.pageCount.toLocaleString()}</td>
                      <td className="font-mono tabular-nums" style={{ textAlign: 'right', fontWeight: 700, color: rep.issueCount > 0 ? '#b91c1c' : 'var(--text-muted)' }}>
                        {rep.issueCount.toLocaleString()}
                      </td>
                      <td className="font-mono" style={{ fontSize: '0.71rem', color: 'var(--text-secondary)' }}>
                        {rep.publishedDate || 'oaugf.ng'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {(oaugfData?.upstreamMissing404Reports?.length || 0) > 0 && (
                <div style={{ padding: '0.85rem 1.25rem', backgroundColor: '#fffbeb', borderTop: '1px solid #fde68a', fontSize: '0.75rem', color: '#92400e', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                  <AlertTriangle size={15} color="#b45309" style={{ marginTop: '2px', flexShrink: 0 }} />
                  <div>
                    <strong>Upstream OAuGF Portal Disclosure:</strong> {oaugfData?.upstreamMissing404Reports?.length} older catalog links on <code>oaugf.ng</code> return HTTP 404 upstream ({oaugfData?.upstreamMissing404Reports?.map((m) => `${m.title}`).join('; ')}). Zero synthetic findings are fabricated for broken upstream links.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SECTION 3: BIR Execution Reports (2009-2026) & Policy/MTEF Ledger */}
          {ledgerSection === 'bir_policy' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
              <div className="dossier-card" style={{ overflowX: 'auto' }}>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <h3 className="font-editorial" style={{ fontSize: '1.08rem', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
                      Budget Implementation Reports (BIR · FY 2009–2026 Consecutive)
                    </h3>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.15rem 0 0' }}>
                      46 official quarterly/fourth-quarter Budget Office implementation reports reconciling Appropriated vs. Released vs. Utilized capital expenditure.
                    </p>
                  </div>
                  <span className="editorial-pill" style={{ backgroundColor: 'var(--emerald-bg)', color: '#047857', border: '1px solid #a7f3d0' }}>
                    {birReportsDesc.length} Covered Fiscal Years
                  </span>
                </div>
                <table className="editorial-table">
                  <thead>
                    <tr>
                      <th>FY</th>
                      <th>Primary BIR Source File</th>
                      <th>Period Covered</th>
                      <th style={{ textAlign: 'right' }}>Appropriated</th>
                      <th style={{ textAlign: 'right' }}>Released / Actual</th>
                      <th style={{ textAlign: 'right' }}>Release %</th>
                      <th>SHA-256 Checksum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {birReportsDesc.map((rep) => (
                      <tr key={rep.financialYear}>
                        <td className="font-mono" style={{ fontWeight: 700 }}>FY {rep.financialYear}</td>
                        <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{rep.sourceFile}</td>
                        <td className="font-mono" style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                          {rep.reportPeriodLabel || rep.quarterCovered || 'Full Year'}
                        </td>
                        <td className="font-mono tabular-nums" style={{ textAlign: 'right' }}>
                          {formatNairaCompact(rep.totalAppropriatedNaira)}
                        </td>
                        <td className="font-mono tabular-nums" style={{ textAlign: 'right', fontWeight: 600 }}>
                          {formatNairaCompact(rep.totalReleasedNaira)}
                        </td>
                        <td className="font-mono tabular-nums" style={{ textAlign: 'right', fontWeight: 700, color: '#047857' }}>
                          {rep.overallReleasePct}%
                        </td>
                        <td className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {rep.sha256 ? `${rep.sha256.replace('sha256:', '').slice(0, 16)}…` : 'Verified'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {policyData && (policyData.documents?.length ?? 0) > 0 && (
                <div className="dossier-card" style={{ overflowX: 'auto' }}>
                  <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                      <h3 className="font-editorial" style={{ fontSize: '1.08rem', fontWeight: 600, margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                        <FileText size={17} color="var(--emerald-primary)" />
                        Budget Office Policy, MTEF/FSP &amp; Finance Act Ledger
                      </h3>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.15rem 0 0' }}>
                        {policyData.textIndexedCount ?? 0} native text + {policyData.ocrIndexedCount ?? 0} OCR-indexed ({(policyData.totalChunksIndexed ?? 0).toLocaleString()} indexed passages).
                      </p>
                    </div>
                    <span className="editorial-pill" style={{ backgroundColor: 'var(--emerald-bg)', color: '#047857', border: '1px solid #a7f3d0' }}>
                      {policyData.totalManifestEntries ?? policyData.documents?.length ?? 0} Manifest Entries
                    </span>
                  </div>
                  <table className="editorial-table">
                    <thead>
                      <tr>
                        <th>Document Title</th>
                        <th>Type</th>
                        <th>Fiscal Scope</th>
                        <th style={{ textAlign: 'right' }}>Pages</th>
                        <th>Status</th>
                        <th>SHA-256 Checksum</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(policyData.documents ?? []).map((doc) => (
                        <tr key={doc.slug}>
                          <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{doc.title}</td>
                          <td>
                            <span className="editorial-pill" style={{ fontSize: '0.67rem' }}>{doc.docType}</span>
                          </td>
                          <td className="font-mono" style={{ fontSize: '0.73rem', whiteSpace: 'nowrap' }}>
                            {doc.fiscalYearStart
                              ? doc.fiscalYearEnd && doc.fiscalYearEnd !== doc.fiscalYearStart
                                ? `${doc.fiscalYearStart}–${doc.fiscalYearEnd}`
                                : `${doc.fiscalYearStart}`
                              : 'General'}
                          </td>
                          <td className="font-mono tabular-nums" style={{ textAlign: 'right' }}>{doc.pageCount || '—'}</td>
                          <td>
                            <span
                              className="editorial-pill"
                              style={{
                                fontSize: '0.67rem',
                                backgroundColor:
                                  doc.extractionStatus === 'TEXT_INDEXED' || doc.extractionStatus === 'OCR_INDEXED'
                                    ? '#ecfdf5'
                                    : '#fffbeb',
                                color:
                                  doc.extractionStatus === 'TEXT_INDEXED' || doc.extractionStatus === 'OCR_INDEXED'
                                    ? '#047857'
                                    : '#b45309',
                                border: `1px solid ${
                                  doc.extractionStatus === 'TEXT_INDEXED' || doc.extractionStatus === 'OCR_INDEXED'
                                    ? '#a7f3d0'
                                    : '#fde68a'
                                }`,
                              }}
                            >
                              {doc.extractionStatus}
                            </span>
                          </td>
                          <td className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {doc.sha256 ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <span>{doc.sha256.replace('sha256:', '').slice(0, 16)}…</span>
                                <button
                                  type="button"
                                  onClick={() => triggerCopy(`pol-${doc.slug}`, doc.sha256 || '')}
                                  className="editorial-btn"
                                  style={{ padding: '0.12rem 0.36rem', fontSize: '0.65rem' }}
                                >
                                  {copiedId === `pol-${doc.slug}` ? <Check size={10} color="#059669" /> : <Copy size={10} />}
                                </button>
                              </div>
                            ) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* SECTION 4: DMO Debt Releases Table */}
          {ledgerSection === 'dmo' && (
            <div className="dossier-card" style={{ overflowX: 'auto' }}>
              <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <h3 className="font-editorial" style={{ fontSize: '1.08rem', fontWeight: 600, margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <Landmark size={17} color="var(--emerald-primary)" />
                    Debt Management Office (DMO) Sovereign Public Debt Ledger (2004–2026)
                  </h3>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.15rem 0 0' }}>
                    Source: {debtData?.source || 'Debt Management Office (DMO) Nigeria — dmo.gov.ng'} · {(debtData?.totalDocumentsIndexed ?? 505).toLocaleString()} official debt PDFs indexed.
                  </p>
                </div>
                <span className="editorial-pill" style={{ backgroundColor: 'var(--emerald-bg)', color: '#047857', border: '1px solid #a7f3d0' }}>
                  {debtRowsDesc.length} Covered Years
                </span>
              </div>
              <table className="editorial-table">
                <thead>
                  <tr>
                    <th>Fiscal Year</th>
                    <th>Primary DMO Release Title</th>
                    <th>As-At Reference</th>
                    <th style={{ textAlign: 'right' }}>Indexed PDFs</th>
                    <th style={{ textAlign: 'right' }}>Total Debt (₦)</th>
                    <th style={{ textAlign: 'right' }}>Total Debt (US$)</th>
                    <th style={{ textAlign: 'right' }}>CBN FX</th>
                  </tr>
                </thead>
                <tbody>
                  {debtRowsDesc.map((d) => (
                    <tr key={d.financialYear}>
                      <td className="font-mono" style={{ fontWeight: 700 }}>FY {d.financialYear}</td>
                      <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{d.primarySource}</td>
                      <td className="font-mono" style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                        {d.asAt || `FY ${d.financialYear}`}
                      </td>
                      <td className="font-mono tabular-nums" style={{ textAlign: 'right' }}>{d.documentCount}</td>
                      <td className="font-mono tabular-nums" style={{ textAlign: 'right', fontWeight: 600 }}>
                        {d.totalDebtNairaM !== null ? formatNairaCompact(d.totalDebtNairaM * 1e6) : 'Service Schedule Only'}
                      </td>
                      <td className="font-mono tabular-nums" style={{ textAlign: 'right' }}>
                        {d.totalDebtUsdM !== null ? `$${(d.totalDebtUsdM / 1000).toFixed(2)}B` : '—'}
                      </td>
                      <td className="font-mono tabular-nums" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                        {d.cbnFxRate ? `₦${d.cbnFxRate.toLocaleString()}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: 6-LEDGER CROSS-JOIN ARCHITECTURE & ARTIFACT PROVENANCE          */}
      {/* ===================================================================== */}
      {activeSubTab === 'architecture' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* 6-Stage Accountability Pipeline Cards */}
          <div className="dossier-card" style={{ padding: '1.25rem 1.4rem' }}>
            <h2 className="font-editorial" style={{ fontSize: '1.2rem', fontWeight: 600, margin: '0 0 0.35rem', color: 'var(--text-primary)' }}>
              The 6-Stage End-to-End Fiscal &amp; Constitutional Accountability Chain
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 1rem', lineHeight: 1.5 }}>
              BudgetLens links every capital and overhead allocation across 6 distinct statutory stages so investigators can see where macro plans, legislative insertions, procurement awards, daily Treasury cash payouts, and Auditor-General queries converge.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(265px, 1fr))', gap: '0.85rem' }}>
              {[
                {
                  stage: 'Stage 1 · Macro & Policy Benchmark',
                  source: '22 MTEF/FSP & Finance Act PDFs (2,272 chunks)',
                  method: 'Extracts statutory crude oil price ($/bbl), production (MBPD), CBN exchange rate (₦/$), and GDP growth assumptions to measure optimism bias.',
                  color: '#047857',
                },
                {
                  stage: 'Stage 2 · Legislative Bill vs. Act Markup',
                  source: '7 Full Bill-vs-Act Cycles (2017, 2019–2023, 2025)',
                  method: 'Matches Executive Proposal line items against Enacted Acts by project code & normalized title, isolating NASS_INSERTION and ALLOCATION_INFLATED items.',
                  color: '#b45309',
                },
                {
                  stage: 'Stage 3 · Budget Implementation Releases (BIR)',
                  source: '46 Official Budget Office BIR PDFs (2009–2026)',
                  method: 'Reconciles MDA-level and national capital appropriation against cash released and utilized (plus 1,247 OCR-indexed scanned narrative passages).',
                  color: '#1d4ed8',
                },
                {
                  stage: 'Stage 4 · BPP Open Contracting (NOCOPO)',
                  source: '98,866 OCDS Records (16,726 Awarded / ₦4.38T)',
                  method: 'Links ERGP project codes and MDA+title tokens to awarded contractors, flagging non-competitive awards (₦1.31T), variation overruns (+₦939.85B), and HHI capture.',
                  color: '#7c3aed',
                },
                {
                  stage: 'Stage 5 · OAGF Open Treasury Cash (GovSpend)',
                  source: '467,763 Daily Vouchers (2018–2026 / ₦47.53T)',
                  method: 'Audits actual Treasury payouts: 2.75x December Rush, 16,996 7-day threshold-splitting clusters, 10,851 Staff/Personal accounts (₦1.49T), and 33,366 opaque vouchers (₦2.44T).',
                  color: '#2563eb',
                },
                {
                  stage: 'Stage 6 · OAuGF Constitutional Audit & Convergence',
                  source: '36 OAuGF Audit Reports (1999–2024 / 7,028 Findings)',
                  method: 'Parses multi-format Auditor-General queries, 675 recovery orders, and 54 repeat/ignored directives, cross-joining all 6 ledgers to rank Multi-Flag Contractors & MDAs.',
                  color: '#b91c1c',
                },
              ].map((s) => (
                <div
                  key={s.stage}
                  style={{
                    padding: '0.95rem 1.05rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    borderTop: `3px solid ${s.color}`,
                    backgroundColor: 'var(--card-subtle)',
                  }}
                >
                  <div className="font-mono" style={{ fontSize: '0.7rem', fontWeight: 700, color: s.color, marginBottom: '0.2rem' }}>
                    {s.stage}
                  </div>
                  <div style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.3rem' }}>
                    {s.source}
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.48 }}>
                    {s.method}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Cryptographic SHA-256 Manifest of Generated Cross-Ledger Static Indices */}
          <div className="dossier-card" style={{ overflowX: 'auto' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h3 className="font-editorial" style={{ fontSize: '1.08rem', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
                  Verified Cross-Ledger Forensic Indices
                </h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.15rem 0 0' }}>
                  Precomputed fiscal cross-checks served from verified official audit, procurement, and treasury ledgers.
                </p>
              </div>
              <span className="editorial-pill" style={{ backgroundColor: 'var(--emerald-bg)', color: '#047857', border: '1px solid #a7f3d0' }}>
                {phase3DatasetsEntries.length} Cross-Ledger Indices + 71 Shards
              </span>
            </div>
            <table className="editorial-table">
              <thead>
                <tr>
                  <th>Static Dataset Artifact</th>
                  <th>Forensic Intelligence Scope</th>
                  <th style={{ textAlign: 'right' }}>Payload Size</th>
                  <th>SHA-256 Checksum</th>
                </tr>
              </thead>
              <tbody>
                {phase3DatasetsEntries.map(([filename, meta]) => {
                  const desc = CROSS_LEDGER_ARTIFACT_DESCRIPTIONS[filename];
                  const kb = meta.bytes ? `${(meta.bytes / 1024).toFixed(1)} KB` : '—';
                  return (
                    <tr key={filename}>
                      <td>
                        <div className="font-mono" style={{ fontWeight: 700, fontSize: '0.75rem', color: 'var(--emerald-primary)' }}>
                          {filename}
                        </div>
                        {desc && (
                          <div style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '0.1rem' }}>
                            {desc.label}
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                        {desc?.scope || 'Cross-dataset static forensic index'}
                      </td>
                      <td className="font-mono tabular-nums" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {kb}
                      </td>
                      <td className="font-mono" style={{ fontSize: '0.71rem', color: 'var(--text-secondary)' }}>
                        {meta.sha256 ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <span>{meta.shortSha256 || meta.sha256.slice(0, 16)}…</span>
                            <button
                              type="button"
                              onClick={() => triggerCopy(`ds-${filename}`, meta.sha256 || '')}
                              className="editorial-btn"
                              style={{ padding: '0.12rem 0.36rem', fontSize: '0.65rem' }}
                            >
                              {copiedId === `ds-${filename}` ? <Check size={10} color="#059669" /> : <Copy size={10} />}
                            </button>
                          </div>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 3: YEAR-NATIVE ECONOMIC RULES                                      */}
      {/* ===================================================================== */}
      {activeSubTab === 'economics' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
            <div className="dossier-card" style={{ padding: '1.15rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--emerald-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
                Rule Group A · CBN Official FX Scaling
              </div>
              <h3 className="font-editorial" style={{ fontSize: '1.05rem', margin: '0 0 0.4rem 0', color: 'var(--text-primary)' }}>
                US$-Pegged Asset &amp; Perk Baselines
              </h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>
                Zero CPI back-casting. Vehicle fleet floors (<strong>US$65,000</strong>), mandate insertions (<strong>US$15,000</strong>), and ceremonial/executive quarters floors (<strong>US$30,000</strong>) convert using that exact fiscal year's Central Bank of Nigeria official rate (from ₦92.34 in 1999 to ₦1,550 in 2025 and ₦1,500 in 2026).
              </p>
            </div>

            <div className="dossier-card" style={{ padding: '1.15rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--blue-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
                Rule Group B · Enacted Budget Shares
              </div>
              <h3 className="font-editorial" style={{ fontSize: '1.05rem', margin: '0 0 0.4rem 0', color: 'var(--text-primary)' }}>
                Macro-Proportional Thresholds
              </h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>
                Blank-check allocations scale strictly at <strong>0.001%</strong> of that year's enacted Federal Budget (₦2.99M in 1999 vs ₦542M in 2026), short vague descriptors at <strong>0.002%</strong>, and intangible soft-spend items at <strong>0.0004%</strong>, guaranteeing fair cross-era scrutiny from ₦299B to ₦54.2T budgets.
              </p>
            </div>

            <div className="dossier-card" style={{ padding: '1.15rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--orange-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
                Rule Group C · Statutory Labor Reality
              </div>
              <h3 className="font-editorial" style={{ fontSize: '1.05rem', margin: '0 0 0.4rem 0', color: 'var(--text-primary)' }}>
                Contemporaneous Minimum Wage Ladder
              </h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>
                Human-scale minimum wage equivalents match Nigerian statutory law per administration: <strong>₦3,500/mo</strong> (1999) → <strong>₦7,500/mo</strong> (2000–2010) → <strong>₦18,000/mo</strong> (2011–2018) → <strong>₦30,000/mo</strong> (2019–2023) → <strong>₦70,000/mo</strong> (2024–2026).
              </p>
            </div>
          </div>

          <div className="dossier-card" style={{ overflowX: 'auto' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)' }}>
              <h3 className="font-editorial" style={{ fontSize: '1.08rem', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
                Year-Native Threshold &amp; Macroeconomic Baseline Schedule (1999–2026)
              </h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.15rem 0 0' }}>
                Exact thresholds applied by <code>forensic_sweep.py</code> and verified in <code>forensic_sweep_1999_2026.json</code>.
              </p>
            </div>
            <table className="editorial-table">
              <thead>
                <tr>
                  <th>FY</th>
                  <th>President</th>
                  <th style={{ textAlign: 'right' }}>Enacted Budget</th>
                  <th style={{ textAlign: 'right' }}>CBN FX (₦/$)</th>
                  <th style={{ textAlign: 'right' }}>Min Wage/Mo</th>
                  <th style={{ textAlign: 'right' }}>Fleet Floor ($65k)</th>
                  <th style={{ textAlign: 'right' }}>Blank Check (0.001%)</th>
                  <th style={{ textAlign: 'right' }}>Intangible (0.0004%)</th>
                </tr>
              </thead>
              <tbody>
                {timelineAsc.map((row) => (
                  <tr key={row.financialYear}>
                    <td className="font-mono" style={{ fontWeight: 700 }}>{row.financialYear}</td>
                    <td style={{ fontWeight: 500 }}>{row.shortName} ({row.party})</td>
                    <td className="font-mono tabular-nums" style={{ textAlign: 'right' }}>{formatNairaCompact(row.officialBudgetNaira)}</td>
                    <td className="font-mono tabular-nums" style={{ textAlign: 'right' }}>₦{row.fxNairaPerUsd.toLocaleString()}</td>
                    <td className="font-mono tabular-nums" style={{ textAlign: 'right' }}>{formatNairaExact(row.minWageMonthly)}</td>
                    <td className="font-mono tabular-nums" style={{ textAlign: 'right' }}>{formatNairaCompact(row.thresholdsApplied.vehiclesNaira)}</td>
                    <td className="font-mono tabular-nums" style={{ textAlign: 'right' }}>{formatNairaCompact(row.thresholdsApplied.blankCheckNaira)}</td>
                    <td className="font-mono tabular-nums" style={{ textAlign: 'right' }}>{formatNairaCompact(row.thresholdsApplied.intangibleNaira)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 4: DATA HYGIENE & RULE ENGINE V3.0 (22 RULES)                      */}
      {/* ===================================================================== */}
      {activeSubTab === 'rules' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(275px, 1fr))', gap: '1rem' }}>
            {DATA_HYGIENE_SPECS.map((spec) => (
              <div key={spec.title} className="dossier-card" style={{ padding: '1.1rem' }}>
                <div className="font-mono" style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--emerald-primary)', marginBottom: '0.3rem' }}>
                  {spec.formula}
                </div>
                <h3 style={{ fontSize: '0.94rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 0.35rem 0' }}>
                  {spec.title}
                </h3>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                  {spec.summary}
                </p>
              </div>
            ))}
          </div>

          <div className="dossier-card" style={{ overflowX: 'auto' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
              <div>
                <h3 className="font-editorial" style={{ fontSize: '1.08rem', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
                  Rule Engine v3.0 Deterministic Catalog ({filteredRules.length} of {rulesCatalog.length} Rules · 16 Domain + 6 Cross-Ledger)
                </h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.15rem 0 0' }}>
                  Live inspection of versioned compliance triggers defined in <code>src/utils/ruleEngine.ts</code> and 28-year hit telemetry from <code>evidence_engine_all_years.json</code>.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '0.25rem' }}>
                  {(
                    [
                      { id: 'ALL', label: 'All 22' },
                      { id: 'CROSS_LEDGER', label: '6 Cross-Ledger' },
                      { id: 'TEXT_AND_DOMAIN', label: '16 Domain' },
                    ] as const
                  ).map((sc) => (
                    <button
                      key={sc.id}
                      type="button"
                      onClick={() => setRuleScopeFilter(sc.id)}
                      className="editorial-pill"
                      style={{
                        border: ruleScopeFilter === sc.id ? '1px solid #1d4ed8' : '1px solid var(--border-color)',
                        backgroundColor: ruleScopeFilter === sc.id ? '#eff6ff' : 'var(--card-bg)',
                        color: ruleScopeFilter === sc.id ? '#1e40af' : 'var(--text-secondary)',
                        fontWeight: ruleScopeFilter === sc.id ? 700 : 500,
                        cursor: 'pointer',
                      }}
                    >
                      {sc.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '0.25rem' }}>
                  {(['ALL', 'high', 'medium', 'low'] as const).map((sev) => (
                    <button
                      key={sev}
                      type="button"
                      onClick={() => setRuleSeverityFilter(sev)}
                      className="editorial-pill"
                      style={{
                        border: ruleSeverityFilter === sev ? '1px solid var(--emerald-primary)' : '1px solid var(--border-color)',
                        backgroundColor: ruleSeverityFilter === sev ? 'var(--emerald-bg)' : 'var(--card-bg)',
                        color: ruleSeverityFilter === sev ? '#047857' : 'var(--text-secondary)',
                        fontWeight: ruleSeverityFilter === sev ? 700 : 500,
                        textTransform: 'uppercase',
                        cursor: 'pointer',
                      }}
                    >
                      {sev}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <table className="editorial-table">
              <thead>
                <tr>
                  <th>Rule ID</th>
                  <th>Scope</th>
                  <th>Rule Name</th>
                  <th>Severity</th>
                  <th style={{ textAlign: 'right' }}>28-Yr Hits</th>
                  <th style={{ textAlign: 'right' }}>28-Yr Exposure</th>
                  <th>Deterministic Match Criterion</th>
                </tr>
              </thead>
              <tbody>
                {filteredRules.map((rule) => {
                  const st = ruleStatsById.get(rule.id);
                  const isCross = rule.ledgerScope === 'CROSS_LEDGER';
                  return (
                    <tr key={rule.id}>
                      <td className="font-mono" style={{ fontSize: '0.73rem', fontWeight: 700, color: 'var(--emerald-primary)' }}>
                        {rule.id}
                      </td>
                      <td>
                        <span
                          className="font-mono"
                          style={{
                            fontSize: '0.62rem',
                            fontWeight: 700,
                            padding: '0.1rem 0.38rem',
                            borderRadius: '4px',
                            backgroundColor: isCross ? '#eff6ff' : '#f1f5f9',
                            color: isCross ? '#1d4ed8' : '#475569',
                            border: isCross ? '1px solid #bfdbfe' : '1px solid #cbd5e1',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {isCross ? '6-LEDGER' : 'DOMAIN'}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{rule.name}</div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                          {rule.category}
                          {st?.peakYear ? ` · Peak FY ${st.peakYear}` : ''}
                        </div>
                      </td>
                      <td>
                        <span
                          className="editorial-pill"
                          style={{
                            backgroundColor:
                              rule.severity === 'high' ? 'var(--badge-high-bg)' : rule.severity === 'medium' ? 'var(--badge-medium-bg)' : 'var(--badge-low-bg)',
                            color:
                              rule.severity === 'high' ? 'var(--badge-high-text)' : rule.severity === 'medium' ? 'var(--badge-medium-text)' : 'var(--badge-low-text)',
                            textTransform: 'uppercase',
                          }}
                        >
                          {rule.severity}
                        </span>
                      </td>
                      <td className="font-mono tabular-nums" style={{ textAlign: 'right', fontWeight: 700 }}>
                        {st ? st.allYearsCount.toLocaleString() : '—'}
                      </td>
                      <td className="font-mono tabular-nums" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--accent-primary)' }}>
                        {st ? formatNairaCompact(st.allYearsAmountNaira) : '—'}
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '0.76rem', lineHeight: 1.45 }}>
                        {rule.description}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div
            className="dossier-card"
            style={{
              padding: '1rem 1.25rem',
              backgroundColor: 'var(--accent-amber-glow)',
              borderColor: '#fde68a',
              display: 'flex',
              gap: '0.75rem',
              alignItems: 'flex-start',
            }}
          >
            <ShieldCheck size={18} color="#b45309" style={{ flexShrink: 0, marginTop: '0.15rem' }} />
            <div style={{ fontSize: '0.79rem', color: '#78350f', lineHeight: 1.55 }}>
              <strong>Methodological Limitations &amp; Evidentiary Scope:</strong> Federal Appropriation Acts and Budget Bills document <strong>enacted legislative authority</strong>, while BIR, NOCOPO, Open Treasury, and OAuGF reports document releases, contracts, cash vouchers, and constitutional audit queries. A BudgetLens audit flag highlights a verified public-record pattern requiring civic, journalistic, legislative, or FOI follow-up — it does not constitute a judicial conviction.
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 5: CITATION STANDARD & REUSE LICENSE                               */}
      {/* ===================================================================== */}
      {activeSubTab === 'citation' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="dossier-card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
              <div>
                <h2 className="font-editorial" style={{ fontSize: '1.15rem', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
                  Institutional Attribution &amp; Open Data Reuse License (CC BY 4.0)
                </h2>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.15rem 0 0' }}>
                  Journalists, researchers, and civil society monitors may freely cite and republish BudgetLens findings under Creative Commons Attribution 4.0.
                </p>
              </div>
              <span className="editorial-pill" style={{ backgroundColor: 'var(--emerald-bg)', color: '#047857', border: '1px solid #a7f3d0', fontWeight: 700 }}>
                <FileCheck2 size={13} /> CC BY 4.0 International
              </span>
            </div>

            <div
              style={{
                backgroundColor: 'var(--card-subtle)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '0.85rem 1rem',
                fontSize: '0.79rem',
                color: 'var(--text-primary)',
                lineHeight: 1.55,
              }}
            >
              {ccAttributionText}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => triggerCopy('cc-attr', ccAttributionText)}
                className="editorial-btn"
              >
                {copiedId === 'cc-attr' ? <Check size={14} color="#059669" /> : <Copy size={14} />}
                {copiedId === 'cc-attr' ? 'Attribution Copied' : 'Copy CC BY 4.0 Attribution'}
              </button>

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => handleExportPdf('complete')}
                  disabled={loading || exportingKey !== null}
                  className="editorial-btn-primary"
                >
                  <FileText size={14} /> Download Methodology Dossier (PDF)
                </button>
                <button
                  type="button"
                  onClick={() => handleExportDocx('complete')}
                  disabled={loading || exportingKey !== null}
                  className="editorial-btn"
                >
                  <Download size={14} color="#059669" /> Download Methodology Dossier (DOCX)
                </button>
              </div>
            </div>
          </div>

          <div className="dossier-card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h3 className="font-editorial" style={{ fontSize: '1.05rem', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
                Cite BudgetLens Methodology &amp; 6-Ledger Provenance Registry
              </h3>
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                {CITATION_STYLES.map((opt) => {
                  const active = citationStyle === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setCitationStyle(opt.id)}
                      className="editorial-pill"
                      style={{
                        border: active ? '1px solid var(--emerald-primary)' : '1px solid var(--border-color)',
                        backgroundColor: active ? 'var(--emerald-bg)' : 'var(--card-bg)',
                        color: active ? '#047857' : 'var(--text-secondary)',
                        fontWeight: active ? 700 : 500,
                        padding: '0.26rem 0.65rem',
                        cursor: 'pointer',
                      }}
                    >
                      {opt.shortLabel}
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              className={citationStyle === 'bibtex' ? 'font-mono' : undefined}
              style={{
                backgroundColor: '#0f1822',
                color: '#e2e8f0',
                borderRadius: '8px',
                border: '1px solid #1e293b',
                padding: '0.95rem 1rem',
                fontSize: citationStyle === 'bibtex' ? '0.73rem' : '0.8rem',
                lineHeight: 1.55,
                whiteSpace: citationStyle === 'bibtex' ? 'pre-wrap' : 'normal',
                wordBreak: 'break-word',
                userSelect: 'all',
              }}
            >
              {institutionalCitations[citationStyle]}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => triggerCopy('inst-cite', institutionalCitations[citationStyle])}
                className="editorial-btn-primary"
              >
                {copiedId === 'inst-cite' ? <Check size={14} /> : <Copy size={14} />}
                {copiedId === 'inst-cite'
                  ? 'Citation Copied'
                  : `Copy ${CITATION_STYLES.find((s) => s.id === citationStyle)?.shortLabel} Citation`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
