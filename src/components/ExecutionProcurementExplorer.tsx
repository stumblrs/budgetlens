import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Download,
  FileCheck2,
  FileSpreadsheet,
  Info,
  Search,
  ShieldCheck,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  exportExecutionProcurementDocx,
  exportExecutionProcurementPdf,
  exportProcurementRiskDocx,
  exportProcurementRiskPdf,
} from '../utils/documentExporter';
import { InfoHint } from './InfoHint';
import { ExpandableText } from './ExpandableText';
import { ContractorHistoryModal, ContractorSummaryItem } from './ContractorHistoryModal';
import { VendorCaptureNetworkView } from './VendorCaptureNetworkView';
import type { ContractorNetworkContext } from '../utils/vendorNetwork';
import {
  formatConvergenceFlagLabel,
  loadOaugfAuditIndex,
  loadRedFlagConvergenceIndex,
  lookupContractorConvergence,
  lookupMdaConvergence,
  lookupOaugfProcurementViolations,
  type OaugfAuditIndexPayload,
  type RedFlagConvergencePayload,
} from '../utils/mdaScorecard';
import { buildCanonicalPermalink } from '../utils/urlState';
import { cleanEntityDisplayName, getCoverageCaveatMeta } from '../utils/displayText';

interface ExecutionYearReport {
  financialYear: number;
  status: 'VERIFIED_BIR_SOURCE' | 'AWAITING_QUARTERLY_DROP';
  quarterCovered?: string;
  isPartialYear?: boolean;
  coverageNote?: string | null;
  macroIntegrityWarnings?: string[] | null;
  reportPeriodLabel?: string;
  reportTitle: string;
  sourceFile: string;
  sha256: string;
  granularity: 'MDA_CAPITAL_RELEASES' | 'MACRO_FISCAL_PERFORMANCE' | 'COMBINED_MACRO_AND_MDA';
  mdaCount: number;
  totalAppropriatedNaira: number;
  totalReleasedNaira: number;
  totalUtilizedNaira: number | null;
  overallReleasePct: number;
  overallUtilizationPct?: number | null;
  mdaBreakdown: Array<{
    sn: number;
    mdaName: string;
    appropriatedNaira: number;
    releasedNaira: number;
    cashBackedNaira?: number;
    utilizedNaira?: number | null;
    releasePct: number;
    utilizationPct?: number | null;
    overspendVirement: boolean;
    page: number;
  }>;
  macroRows: Array<{
    label: string;
    budgetNaira: number;
    actualNaira: number;
    performancePct: number;
    derivedFromComponents?: boolean;
  }>;
}

interface ExecutionTrackerPayload {
  generatedAt: string;
  verifiedYears: number[];
  dropFolder: string;
  dropInstructions: string;
  scannedSkipped?: Array<{ financialYear: number; file: string; status: string }>;
  years: ExecutionYearReport[];
}

interface ProcurementContractLink {
  budgetRecordId: string;
  financialYear: number;
  projectCode: string;
  budgetTitle: string;
  mdaName: string;
  matchType: 'EXACT_ERGP_CODE' | 'HIGH_CONFIDENCE_FUZZY' | 'NO_PUBLIC_RECORD_FOUND';
  confidenceScore: number;
  ocdsReleaseId: string | null;
  stage?: string;
  contractorName: string | null;
  bppContractorId?: string | null;
  cacRcNumber: string | null;
  contractAwardNaira: number | null;
  totalPaidNaira?: number | null;
  awardDate: string | null;
  procurementMethod: string | null;
}

interface ProcurementLinksPayload {
  generatedAt: string;
  status: 'VERIFIED_OCDS_SNAPSHOT' | 'AWAITING_PROCUREMENT_DROP';
  dropFolder: string;
  dropInstructions: string;
  releasesScanned: number;
  deduplicatedOcidCount?: number;
  stageBreakdown?: {
    planningOnlyCount: number;
    tenderCount: number;
    awardedCount: number;
    implementationCount: number;
  };
  matchedCount: number;
  totalAwardNaira: number;
  totalDisbursedNaira?: number;
  contractorConcentration: Array<{
    contractorName: string;
    bppContractorId?: string | null;
    cacRcNumber: string | null;
    beneficialOwners: string[];
    awardCount: number;
    totalAwardNaira: number;
    totalPaidNaira?: number;
    mdas: string[];
  }>;
  links: ProcurementContractLink[];
}

interface GovspendSummaryPayload {
  generatedAt: string;
  status: string;
  sourceFile?: string;
  sha256?: string;
  totalRowsScanned: number;
  validPaymentCount: number;
  zeroAmountExcludedCount: number;
  totalDisbursedNaira: number;
  dateRange?: { minDate: string | null; maxDate: string | null };
  uniqueOrganizationsCount: number;
  uniqueBeneficiariesCount: number;
  splitAlertTotalClusters: number;
  nocopoCrossLinkCount: number;
  yearlyTotals: Array<{ year: number; paymentCount: number; totalAmountNaira: number }>;
  topMdas: Array<{ organizationName: string; payerCode: string; paymentCount: number; totalAmountNaira: number }>;
  topBeneficiaries: Array<{ beneficiaryName: string; paymentCount: number; totalAmountNaira: number; topMda: string }>;
  splitPaymentAlerts: Array<{
    date: string;
    organizationName: string;
    beneficiaryName: string;
    voucherCount: number;
    totalAmountNaira: number;
    sampleDescription: string;
  }>;
  nocopoCrossLinks: Array<{
    contractorName: string;
    bppContractorId: string | null;
    nocopoAwardCount: number;
    nocopoAwardedNaira: number;
    govspendPaymentCount: number;
    govspendPaidNaira: number;
    mdas: string[];
  }>;
}

interface GovspendPaymentRow {
  paymentNo: string;
  paymentDate: string;
  financialYear: number;
  payerCode: string;
  organizationName: string;
  beneficiaryName: string;
  amountNaira: number;
  description: string;
}

interface ContractorLeaderboardRow {
  contractorName: string;
  bppContractorId?: string;
  contractCount: number;
  totalContractedNaira: number;
  nocopoDisbursedNaira?: number;
  govspendPaymentCount?: number;
  govspendPaidNaira?: number;
  firstYear: number | null;
  lastYear: number | null;
  mdaCount: number;
  topMdas: string[];
}

interface ContractorsLeaderboardPayload {
  generatedAt: string;
  status: string;
  awardCoverageYears: string;
  treasuryCoverageRange: string;
  coverageNote: string;
  totalDistinctContractors: number;
  repeatContractorsCount: number;
  totalAwardedContracts: number;
  totalContractedNaira: number;
  totalGovspendMatchedNaira: number;
  contractors: ContractorLeaderboardRow[];
}

interface ExecutionProcurementExplorerProps {
  selectedYear: number;
  onSelectYear?: (year: number) => void;
}

interface ProcurementRiskContractItem {
  ocid: string;
  financialYear: number;
  stage: string;
  title: string;
  mdaName: string;
  contractorName: string | null;
  bppContractorId?: string | null;
  procurementMethod: string;
  awardNaira: number;
  paidNaira: number;
  overrunDeltaNaira?: number;
  overrunPct?: number;
  awardDate: string | null;
  projectCode: string | null;
  leaderboardContractCount?: number;
  leaderboardTotalContractedNaira?: number;
  leaderboardFirstYear?: number | null;
  leaderboardLastYear?: number | null;
  leaderboardMdaCount?: number;
  leaderboardTopMdas?: string[];
  leaderboardGovspendCount?: number;
  leaderboardGovspendPaidNaira?: number;
}

interface ProcurementRiskPayload {
  generatedAt: string;
  status: string;
  headline: {
    totalAwardedRows: number;
    pricedAwardedCount: number;
    totalAwardedNaira: number;
    totalPaidNaira: number;
    planningExcludedCount: number;
    nonCompetitiveCount: number;
    nonCompetitiveAwardedNaira: number;
    nonCompetitivePaidNaira: number;
    nonCompetitiveValueSharePct: number;
    overrunCount: number;
    overrunAwardedNaira: number;
    overrunPaidNaira: number;
    overrunDeltaNaira: number;
    zeroPaidCount: number;
    zeroPaidAwardedNaira: number;
    excludedTestRecordsCount?: number;
    excludedTestAwardedNaira?: number;
    excludedTestPaidNaira?: number;
    koboShiftAnomalyCount?: number;
    koboShiftAnomalyDeltaNaira?: number;
    totalQuarantinedAnomaliesCount?: number;
  };
  methodBreakdown: Array<{
    method: string;
    category: string;
    contractCount: number;
    awardedNaira: number;
    paidNaira: number;
    sharePct: number;
    overrunCount: number;
    zeroPaidCount: number;
  }>;
  yearlyRiskTrend: Array<{
    financialYear: number;
    totalCount: number;
    awardedNaira: number;
    nonCompetitiveCount: number;
    nonCompetitiveAwardedNaira: number;
    nonCompetitiveSharePct: number;
    overrunCount: number;
    overrunDeltaNaira: number;
    zeroPaidCount: number;
    zeroPaidAwardedNaira: number;
  }>;
  mdaRiskRanking: Array<{
    mdaName: string;
    awardCount: number;
    totalAwardedNaira: number;
    totalPaidNaira: number;
    nonCompetitiveCount: number;
    nonCompetitiveAwardedNaira: number;
    nonCompetitiveSharePct: number;
    emergencyCount: number;
    emergencyAwardedNaira: number;
    directCount: number;
    directAwardedNaira: number;
    selectiveCount: number;
    selectiveAwardedNaira: number;
    overrunCount: number;
    overrunDeltaNaira: number;
    zeroPaidCount: number;
    zeroPaidAwardedNaira: number;
    riskScore: number;
  }>;
  topOverrunContracts: ProcurementRiskContractItem[];
  topZeroPaidAwards: ProcurementRiskContractItem[];
  topNonCompetitiveAwards: ProcurementRiskContractItem[];
  portalDataEntryAnomalies?: Array<
    ProcurementRiskContractItem & {
      overrunDeltaNaira?: number;
      paidToAwardRatio?: number | null;
      anomalyType: string;
      anomalyReason: string;
    }
  >;
}

function getQuarantineAnomalyMeta(anomalyType: string): {
  label: string;
  bg: string;
  color: string;
  border: string;
} {
  switch (anomalyType) {
    case 'PORTAL_TEST_RECORD':
      return { label: 'Portal Test Entry', bg: '#f1f5f9', color: '#334155', border: '#cbd5e1' };
    case 'KOBO_SHIFT_100X':
      return { label: '100x Kobo Shift', bg: '#fffbeb', color: '#92400e', border: '#fde68a' };
    case 'DECIMAL_SHIFT_1000X':
      return { label: '1,000x Decimal Shift', bg: '#fff7ed', color: '#9a3412', border: '#fed7aa' };
    case 'DECIMAL_SHIFT_10000X':
      return { label: '10,000x Decimal Shift', bg: '#fef2f2', color: '#991b1b', border: '#fecaca' };
    default:
      return { label: 'Unit Scale Typo', bg: '#fdf4ff', color: '#86198f', border: '#f5d0fe' };
  }
}

function formatNairaCompact(amt: number): string {
  const abs = Math.abs(amt || 0);
  if (abs >= 1e12) return `₦${(amt / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `₦${(amt / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `₦${(amt / 1e6).toFixed(2)}M`;
  return `₦${Math.round(amt || 0).toLocaleString()}`;
}

export const ExecutionProcurementExplorer: React.FC<ExecutionProcurementExplorerProps> = ({
  selectedYear,
  onSelectYear,
}) => {
  const [subTab, setSubTab] = useState<'execution' | 'procurement' | 'risk' | 'network' | 'contractors' | 'govspend'>('execution');
  const [execData, setExecData] = useState<ExecutionTrackerPayload | null>(null);
  const [procData, setProcData] = useState<ProcurementLinksPayload | null>(null);
  const [riskData, setRiskData] = useState<ProcurementRiskPayload | null>(null);
  const [riskView, setRiskView] = useState<'mdas' | 'overruns' | 'zeropaid' | 'noncomp'>('mdas');
  const [riskQuery, setRiskQuery] = useState('');
  const [riskConvergentOnly, setRiskConvergentOnly] = useState(false);
  const [showQuarantinedAnomalies, setShowQuarantinedAnomalies] = useState(false);
  const [govData, setGovData] = useState<GovspendSummaryPayload | null>(null);
  const [contractorsData, setContractorsData] = useState<ContractorsLeaderboardPayload | null>(null);
  const [contractorQuery, setContractorQuery] = useState('');
  const [contractorSort, setContractorSort] = useState<'amount' | 'count' | 'govspend' | 'mdas' | 'convergence'>('amount');
  const [contractorMinAwards, setContractorMinAwards] = useState<number>(1);
  const [contractorConvergentOnly, setContractorConvergentOnly] = useState(false);
  const [contractorPage, setContractorPage] = useState<number>(0);
  const [convergenceData, setConvergenceData] = useState<RedFlagConvergencePayload | null>(null);
  const [oaugfIndex, setOaugfIndex] = useState<OaugfAuditIndexPayload | null>(null);
  const [selectedContractor, setSelectedContractor] = useState<ContractorSummaryItem | null>(null);
  const [selectedContractorNetworkCtx, setSelectedContractorNetworkCtx] = useState<ContractorNetworkContext | null>(null);
  const [mdaQuery, setMdaQuery] = useState('');
  const [procQuery, setProcQuery] = useState('');
  const [procApiResults, setProcApiResults] = useState<ProcurementContractLink[] | null>(null);
  const [procApiTotal, setProcApiTotal] = useState<number | null>(null);
  const [govQuery, setGovQuery] = useState('');
  const [govApiResults, setGovApiResults] = useState<GovspendPaymentRow[] | null>(null);
  const [govApiTotal, setGovApiTotal] = useState<number | null>(null);
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null);

  useEffect(() => {
    fetch('/datasets/execution_tracker.json', { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => d && setExecData(d))
      .catch(() => { });

    fetch('/datasets/procurement_links.json', { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => d && setProcData(d))
      .catch(() => { });

    fetch('/datasets/govspend_summary.json', { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => d && setGovData(d))
      .catch(() => { });

    fetch('/datasets/contractors_leaderboard.json', { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => d && setContractorsData(d))
      .catch(() => { });

    fetch('/datasets/procurement_risk_index.json', { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => d && setRiskData(d))
      .catch(() => { });

    loadRedFlagConvergenceIndex().then((d) => d && setConvergenceData(d));
    loadOaugfAuditIndex().then((d) => d && setOaugfIndex(d));
  }, []);

  useEffect(() => {
    if (subTab !== 'procurement') return;
    const trimmed = procQuery.trim();
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      const qs = new URLSearchParams({ limit: '40' });
      if (trimmed) qs.set('q', trimmed);
      fetch(`/api/procurement/search?${qs.toString()}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.available && Array.isArray(d.results)) {
            setProcApiResults(d.results);
            setProcApiTotal(typeof d.totalMatches === 'number' ? d.totalMatches : d.results.length);
          } else {
            setProcApiResults(null);
            setProcApiTotal(null);
          }
        })
        .catch(() => {
          setProcApiResults(null);
          setProcApiTotal(null);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [subTab, procQuery]);

  const displayedContracts = useMemo(() => {
    if (procApiResults) return procApiResults;
    const base = procData?.links || [];
    const q = procQuery.trim().toLowerCase();
    if (!q) return base.slice(0, 40);
    return base
      .filter((l) =>
        [l.budgetTitle, l.mdaName, l.contractorName, l.projectCode, l.bppContractorId]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      )
      .slice(0, 40);
  }, [procApiResults, procData, procQuery]);

  const activeReport = useMemo(
    () => execData?.years.find((y) => y.financialYear === selectedYear) || null,
    [execData, selectedYear]
  );

  const filteredMdas = useMemo(() => {
    if (!activeReport?.mdaBreakdown) return [];
    const q = mdaQuery.trim().toLowerCase();
    if (!q) return activeReport.mdaBreakdown;
    return activeReport.mdaBreakdown.filter((m) => m.mdaName.toLowerCase().includes(q));
  }, [activeReport, mdaQuery]);

  const chartData = useMemo(() => {
    if (!activeReport?.mdaBreakdown?.length) return [];
    return activeReport.mdaBreakdown.slice(0, 10).map((m) => {
      const cleanedMda = cleanEntityDisplayName(m.mdaName);
      return {
        mdaName: cleanedMda.length > 24 ? `${cleanedMda.slice(0, 22)}…` : cleanedMda,
        appropriatedBn: Number((m.appropriatedNaira / 1e9).toFixed(2)),
        releasedBn: Number((m.releasedNaira / 1e9).toFixed(2)),
      };
    });
  }, [activeReport]);

  const multiYearTrendData = useMemo(() => {
    if (!execData?.years?.length) return [];
    return execData.years.map((y) => ({
      year: String(y.financialYear),
      financialYear: y.financialYear,
      releasePct: Number((y.overallReleasePct || 0).toFixed(1)),
      appropriatedLabel: formatNairaCompact(y.totalAppropriatedNaira),
      releasedLabel: formatNairaCompact(y.totalReleasedNaira),
      periodLabel: y.reportPeriodLabel || y.quarterCovered || 'Full-Year',
    }));
  }, [execData]);

  const hasUtilizedColumn = useMemo(
    () => Boolean(activeReport?.mdaBreakdown?.some((m) => m.utilizedNaira != null)),
    [activeReport]
  );

  useEffect(() => {
    if (subTab !== 'govspend') return;
    const trimmed = govQuery.trim();
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      const qs = new URLSearchParams({ limit: '40' });
      if (trimmed) qs.set('q', trimmed);
      fetch(`/api/expenditures/search?${qs.toString()}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.available && Array.isArray(d.results)) {
            setGovApiResults(d.results);
            setGovApiTotal(typeof d.totalMatches === 'number' ? d.totalMatches : d.results.length);
          } else {
            setGovApiResults(null);
            setGovApiTotal(null);
          }
        })
        .catch(() => {
          setGovApiResults(null);
          setGovApiTotal(null);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [subTab, govQuery]);

  const govAnnualChartData = useMemo(() => {
    if (!govData?.yearlyTotals?.length) return [];
    return govData.yearlyTotals.map((y) => ({
      year: String(y.year),
      totalTn: Number((y.totalAmountNaira / 1e12).toFixed(2)),
      paymentCount: y.paymentCount,
    }));
  }, [govData]);

  const filteredContractors = useMemo(() => {
    if (!contractorsData?.contractors?.length) return [];
    const q = contractorQuery.trim().toLowerCase();
    const matched = contractorsData.contractors.filter((c) => {
      if (c.contractCount < contractorMinAwards) return false;
      if (
        contractorConvergentOnly &&
        !lookupContractorConvergence(convergenceData, c.contractorName, c.bppContractorId)
      ) {
        return false;
      }
      if (!q) return true;
      return (
        c.contractorName.toLowerCase().includes(q) ||
        (c.bppContractorId && c.bppContractorId.toLowerCase().includes(q)) ||
        (c.topMdas || []).some((m) => m.toLowerCase().includes(q))
      );
    });
    const sorted = [...matched].sort((a, b) => {
      if (contractorSort === 'convergence') {
        const ac = lookupContractorConvergence(convergenceData, a.contractorName, a.bppContractorId);
        const bc = lookupContractorConvergence(convergenceData, b.contractorName, b.bppContractorId);
        return (
          (bc?.flagCount || 0) - (ac?.flagCount || 0) ||
          (bc?.totalExposureNaira || 0) - (ac?.totalExposureNaira || 0) ||
          b.totalContractedNaira - a.totalContractedNaira
        );
      }
      if (contractorSort === 'count') {
        return b.contractCount - a.contractCount || b.totalContractedNaira - a.totalContractedNaira;
      }
      if (contractorSort === 'govspend') {
        return (b.govspendPaidNaira || 0) - (a.govspendPaidNaira || 0) || b.totalContractedNaira - a.totalContractedNaira;
      }
      if (contractorSort === 'mdas') {
        return b.mdaCount - a.mdaCount || b.contractCount - a.contractCount;
      }
      return b.totalContractedNaira - a.totalContractedNaira || b.contractCount - a.contractCount;
    });
    return sorted;
  }, [contractorsData, contractorQuery, contractorSort, contractorMinAwards, contractorConvergentOnly, convergenceData]);

  useEffect(() => {
    setContractorPage(0);
  }, [contractorQuery, contractorSort, contractorMinAwards, contractorConvergentOnly]);

  const handleExport = async (format: 'pdf' | 'docx') => {
    setExportingFormat(format);
    try {
      const payload = {
        financialYear: selectedYear,
        executionYearReport: activeReport,
        procurementStatus: procData?.status || 'AWAITING_PROCUREMENT_DROP',
        contractorConcentration: procData?.contractorConcentration || [],
        govspendSummary: govData
          ? {
            totalDisbursedNaira: govData.totalDisbursedNaira,
            validPaymentCount: govData.validPaymentCount,
            nocopoCrossLinks: govData.nocopoCrossLinks || [],
            splitPaymentAlerts: govData.splitPaymentAlerts || [],
          }
          : null,
        permalink: buildCanonicalPermalink({ tab: 'execution', year: selectedYear }),
      };
      if (format === 'pdf') {
        await exportExecutionProcurementPdf(payload);
      } else {
        await exportExecutionProcurementDocx(payload);
      }
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="dossier-card" style={{ padding: '1.35rem 1.5rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.25rem' }}>
              <FileCheck2 size={14} style={{ color: 'var(--emerald-primary)' }} />
              <span className="font-mono" style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--emerald-primary)' }}>
                Budget Implementation &amp; Procurement Bridge · Zero-Fabrication Policy
              </span>
            </div>
            <h1 className="font-editorial" style={{ margin: 0, fontSize: '1.55rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
              <span>Enacted vs. Actual Execution &amp; NOCOPO / CAC Contracts</span>
              <InfoHint
                term="Appropriated vs. Released vs. Cash-Backed"
                meaning="Appropriated is what the law approved on paper. Released / Cash-Backed (from Budget Implementation Reports) is the actual money disbursed by OAGF."
                whyItMatters="A large budget means little if only 20%–40% of capital funds were actually released for execution."
              />
            </h1>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Tracks official Budget Implementation Reports, warrant releases, and public contract awards.
              Missing years are marked explicitly rather than estimated.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={exportingFormat !== null}
              onClick={() => handleExport('pdf')}
              className="editorial-btn-primary"
            >
              <Download size={14} />
              {exportingFormat === 'pdf' ? 'Generating PDF...' : 'Export Execution Brief (PDF)'}
            </button>
            <button
              type="button"
              disabled={exportingFormat !== null}
              onClick={() => handleExport('docx')}
              className="editorial-btn"
            >
              <FileSpreadsheet size={14} />
              {exportingFormat === 'docx' ? 'Generating DOCX...' : 'Export Brief (DOCX)'}
            </button>
          </div>
        </div>

        {/* Sub-Tabs & Verified BIR Year Pills */}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '0.65rem', marginTop: '1rem', paddingTop: '0.9rem', borderTop: '1px solid var(--border-subtle)', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setSubTab('execution')}
              className={subTab === 'execution' ? 'editorial-btn-primary' : 'editorial-btn'}
            >
              Execution Waterfall (FY {selectedYear})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('procurement')}
              className={subTab === 'procurement' ? 'editorial-btn-primary' : 'editorial-btn'}
            >
              Procurement &amp; Contractor Concentration
            </button>
            <button
              type="button"
              onClick={() => setSubTab('risk')}
              className={subTab === 'risk' ? 'editorial-btn-primary' : 'editorial-btn'}
            >
              Procurement Risk &amp; Overruns
              {riskData?.headline?.overrunCount ? ` (${riskData.headline.overrunCount})` : ''}
            </button>
            <button
              type="button"
              onClick={() => setSubTab('network')}
              className={subTab === 'network' ? 'editorial-btn-primary' : 'editorial-btn'}
            >
              Vendor Capture &amp; Off-NOCOPO
            </button>
            <button
              type="button"
              onClick={() => setSubTab('contractors')}
              className={subTab === 'contractors' ? 'editorial-btn-primary' : 'editorial-btn'}
            >
              Top Contractors{contractorsData?.totalDistinctContractors ? ` (${contractorsData.totalDistinctContractors.toLocaleString()})` : ''}
            </button>
            <button
              type="button"
              onClick={() => setSubTab('govspend')}
              className={subTab === 'govspend' ? 'editorial-btn-primary' : 'editorial-btn'}
            >
              Open Treasury Payments (GovSpend)
            </button>
          </div>

          {execData && (
            <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                VERIFIED BIR SOURCES:
              </span>
              {execData.verifiedYears.map((yr) => {
                const yrRep = execData.years.find((y) => y.financialYear === yr);
                const partialTag =
                  yrRep?.isPartialYear && yrRep.quarterCovered ? ` (${yrRep.quarterCovered})` : '';
                return (
                  <button
                    key={yr}
                    type="button"
                    title={yrRep?.coverageNote || yrRep?.reportPeriodLabel || `FY ${yr} BIR Source`}
                    onClick={() => onSelectYear?.(yr)}
                    className={yr === selectedYear ? 'editorial-btn-primary' : 'editorial-btn'}
                    style={{ padding: '0.28rem 0.6rem', fontSize: '0.73rem' }}
                  >
                    <ShieldCheck size={12} /> FY {yr}{partialTag}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ================================================================ */}
      {/* TAB 1: EXECUTION WATERFALL                                       */}
      {/* ================================================================ */}
      {subTab === 'execution' && multiYearTrendData.length > 1 && (
        <div className="dossier-card" style={{ padding: '1.15rem 1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.65rem' }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>
              Multi-Year Budget Implementation &amp; Execution Rate Trajectory ({multiYearTrendData[0].year}–{multiYearTrendData[multiYearTrendData.length - 1].year})
            </h3>
            <span className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {multiYearTrendData.length} Verified BIR / OAGF Fiscal Cycles
            </span>
          </div>
          <div style={{ width: '100%', height: '210px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={multiYearTrendData}
                margin={{ top: 6, right: 14, left: 4, bottom: 4 }}
                onClick={(state: any) => {
                  const yrNum = state?.activePayload?.[0]?.payload?.financialYear;
                  if (typeof yrNum === 'number') onSelectYear?.(yrNum);
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="year" tick={{ fontSize: 10.5 }} />
                <YAxis unit="%" tick={{ fontSize: 10.5 }} />
                <Tooltip
                  formatter={(v: any, _n: any, entry: any) => {
                    const p = entry?.payload;
                    return [
                      `${v}% (${p?.releasedLabel || ''} vs ${p?.appropriatedLabel || ''} · ${p?.periodLabel || ''})`,
                      'Execution / Performance',
                    ];
                  }}
                />
                <Bar dataKey="releasePct" name="Execution %" fill="#059669" radius={[3, 3, 0, 0]} cursor="pointer" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {subTab === 'execution' && (
        activeReport ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
            <div className="grid-4-cols">
              <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                  Source Provenance
                </div>
                <div style={{ marginTop: '0.3rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="editorial-pill font-mono" style={{ backgroundColor: '#ecfdf5', color: '#047857', borderColor: '#a7f3d0' }}>
                    {activeReport.status}
                  </span>
                  {(activeReport.reportPeriodLabel || activeReport.quarterCovered) && (
                    <span
                      className="editorial-pill font-mono"
                      style={{
                        backgroundColor: activeReport.isPartialYear || activeReport.quarterCovered !== 'Q4' ? '#fffbeb' : '#eff6ff',
                        color: activeReport.isPartialYear || activeReport.quarterCovered !== 'Q4' ? '#b45309' : '#1d4ed8',
                        borderColor: activeReport.isPartialYear || activeReport.quarterCovered !== 'Q4' ? '#fde68a' : '#bfdbfe',
                      }}
                    >
                      {activeReport.reportPeriodLabel || activeReport.quarterCovered}
                    </span>
                  )}
                  {activeReport.isPartialYear && (
                    <span
                      className="editorial-pill font-mono"
                      style={{
                        backgroundColor: '#fef3c7',
                        color: '#92400e',
                        borderColor: '#f59e0b',
                        fontWeight: 700,
                      }}
                    >
                      Partial-Year BIR ({activeReport.quarterCovered || 'YTD'})
                    </span>
                  )}
                </div>
                <div className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                  {activeReport.sourceFile}
                </div>
              </div>

              <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                  Enacted / Budget Benchmark
                </div>
                <div className="font-mono tabular-nums" style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: '0.2rem' }}>
                  {formatNairaCompact(activeReport.totalAppropriatedNaira)}
                </div>
              </div>

              <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                  Released / Actual Performance
                </div>
                <div className="font-mono tabular-nums" style={{ fontSize: '1.4rem', fontWeight: 700, color: '#047857', marginTop: '0.2rem' }}>
                  {formatNairaCompact(activeReport.totalReleasedNaira)}
                </div>
              </div>

              <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                  Execution Rate
                </div>
                <div className="font-mono tabular-nums" style={{ fontSize: '1.4rem', fontWeight: 700, color: '#b45309', marginTop: '0.2rem' }}>
                  {activeReport.overallReleasePct.toFixed(1)}%
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {activeReport.mdaCount > 0 && activeReport.macroRows.length > 0
                    ? `${activeReport.mdaCount} MDAs + Macro Fiscal Table`
                    : activeReport.mdaCount > 0
                      ? `${activeReport.mdaCount} MDAs reconciled`
                      : 'Macro Fiscal Summary'}
                  {activeReport.overallUtilizationPct != null
                    ? ` · Capital Utilized: ${activeReport.overallUtilizationPct.toFixed(1)}%`
                    : ''}
                </div>
              </div>
            </div>

            {(activeReport.isPartialYear || activeReport.coverageNote) && (
              <div
                className="dossier-card"
                style={{
                  padding: '0.78rem 1.1rem',
                  backgroundColor: '#fffbeb',
                  borderColor: '#fde68a',
                  fontSize: '0.78rem',
                  color: '#78350f',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.55rem',
                }}
              >
                <Info size={16} color="#b45309" style={{ flexShrink: 0 }} />
                <span>
                  {activeReport.coverageNote ||
                    getCoverageCaveatMeta(activeReport.financialYear, {
                      birIsPartialYear: activeReport.isPartialYear,
                      birQuarterCovered: activeReport.quarterCovered,
                    }).birPartialNote}
                </span>
              </div>
            )}

            {chartData.length > 0 && (
              <div className="dossier-card" style={{ padding: '1.15rem 1.25rem' }}>
                <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', fontWeight: 700 }}>
                  Top 10 MDAs: Enacted Capital vs. Warrant + AIE Releases (₦ Billions, FY {activeReport.financialYear})
                </h3>
                <div style={{ width: '100%', height: '270px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 20, left: 20, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis type="number" unit="B" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="mdaName" width={190} tick={{ fontSize: 10.5 }} />
                      <Tooltip formatter={(v: any, n: any) => [`₦${Number(v).toLocaleString()}B`, String(n)]} />
                      <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
                      <Bar dataKey="appropriatedBn" name="Appropriated (₦B)" fill="#091017" />
                      <Bar dataKey="releasedBn" name="Released (₦B)" fill="#059669" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {activeReport.mdaBreakdown.length > 0 && (
              <div className="dossier-card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '0.9rem 1.2rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>
                    MDA Capital Release &amp; Utilization Schedule (FY {activeReport.financialYear})
                  </h3>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      placeholder="Filter MDA..."
                      value={mdaQuery}
                      onChange={(e) => setMdaQuery(e.target.value)}
                      style={{ padding: '0.4rem 0.7rem 0.4rem 2rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.78rem', width: '220px' }}
                    />
                    <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)' }} />
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                        <th style={{ padding: '0.65rem 1rem' }}>Executing MDA</th>
                        <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Appropriated</th>
                        <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Released (Warrant + AIE)</th>
                        <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Release %</th>
                        {hasUtilizedColumn && (
                          <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Utilized</th>
                        )}
                        <th style={{ padding: '0.65rem 1rem' }}>Audit Signal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMdas.slice(0, 60).map((m) => (
                        <tr key={`${m.sn}-${m.mdaName}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '0.6rem 1rem', fontWeight: 600 }}>{cleanEntityDisplayName(m.mdaName)}</td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.6rem 1rem', textAlign: 'right' }}>
                            {m.appropriatedNaira > 0 ? formatNairaCompact(m.appropriatedNaira) : '—'}
                          </td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.6rem 1rem', textAlign: 'right', fontWeight: 700, color: '#047857' }}>
                            {formatNairaCompact(m.releasedNaira)}
                          </td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.6rem 1rem', textAlign: 'right' }}>
                            {m.appropriatedNaira > 0 ? `${m.releasePct.toFixed(1)}%` : '—'}
                          </td>
                          {hasUtilizedColumn && (
                            <td className="font-mono tabular-nums" style={{ padding: '0.6rem 1rem', textAlign: 'right' }}>
                              {m.utilizedNaira != null
                                ? `${formatNairaCompact(m.utilizedNaira)}${m.utilizationPct != null ? ` (${m.utilizationPct.toFixed(1)}%)` : ''}`
                                : '—'}
                            </td>
                          )}
                          <td style={{ padding: '0.6rem 1rem' }}>
                            {m.overspendVirement ? (
                              <span className="editorial-pill" style={{ backgroundColor: '#fef2f2', color: '#b91c1c', borderColor: '#fecaca' }}>
                                <AlertTriangle size={11} /> OVERSPEND_VIREMENT
                              </span>
                            ) : (
                              <span className="editorial-pill">Within Ceiling</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeReport.macroRows.length > 0 && (
              <div className="dossier-card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '0.9rem 1.2rem', borderBottom: '1px solid var(--border-subtle)' }}>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>
                    Macro Fiscal Performance Table (FY {activeReport.financialYear} · {activeReport.reportPeriodLabel || activeReport.quarterCovered || 'Full-Year'})
                  </h3>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                        <th style={{ padding: '0.65rem 1rem' }}>Fiscal Line</th>
                        <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Budget Benchmark</th>
                        <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Actual Outturn</th>
                        <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Performance %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeReport.macroRows.map((r) => (
                        <tr key={r.label} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '0.6rem 1rem', fontWeight: 600 }}>
                            <span>{r.label}</span>
                            {r.derivedFromComponents && (
                              <span
                                className="font-mono"
                                style={{
                                  marginLeft: '0.45rem',
                                  fontSize: '0.62rem',
                                  fontWeight: 700,
                                  padding: '0.08rem 0.35rem',
                                  borderRadius: '4px',
                                  backgroundColor: '#fffbeb',
                                  color: '#92400e',
                                  border: '1px solid #fde68a',
                                }}
                              >
                                Derived from components
                              </span>
                            )}
                          </td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.6rem 1rem', textAlign: 'right' }}>{formatNairaCompact(r.budgetNaira)}</td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.6rem 1rem', textAlign: 'right', fontWeight: 700 }}>{formatNairaCompact(r.actualNaira)}</td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.6rem 1rem', textAlign: 'right' }}>{r.performancePct.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {activeReport.macroIntegrityWarnings && activeReport.macroIntegrityWarnings.length > 0 && (
                  <div
                    style={{
                      padding: '0.7rem 1.05rem',
                      borderTop: '1px solid #fde68a',
                      backgroundColor: '#fffbeb',
                      fontSize: '0.74rem',
                      color: '#78350f',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem',
                    }}
                  >
                    <div className="font-mono" style={{ fontWeight: 700, fontSize: '0.67rem', textTransform: 'uppercase' }}>
                      BIR Source Integrity Guard Notes
                    </div>
                    {activeReport.macroIntegrityWarnings.map((warn, idx) => (
                      <div key={idx} style={{ lineHeight: 1.4 }}>
                        • {warn}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="dossier-card" style={{ padding: '1.6rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', color: '#b45309', fontWeight: 700 }}>
              <Info size={18} /> Official Public Execution Dataset Not Yet Ingested for FY {selectedYear}
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 }}>
              Budget Implementation Report data for FY {selectedYear} is not yet published. Select one of the verified fiscal years above (
              <strong className="font-mono">
                {execData?.verifiedYears?.length
                  ? execData.verifiedYears.map((yr) => `FY ${yr}`).join(', ')
                  : 'verified years'}
              </strong>
              ).
            </p>
          </div>
        )
      )}

      {/* ================================================================ */}
      {/* TAB 2: PROCUREMENT & CONTRACTOR CONCENTRATION                    */}
      {/* ================================================================ */}
      {subTab === 'procurement' && (
        procData && procData.status === 'VERIFIED_OCDS_SNAPSHOT' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
            <div className="grid-4-cols">
              <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Deduplicated OCIDs</div>
                <div className="font-mono tabular-nums" style={{ fontSize: '1.4rem', fontWeight: 700 }}>
                  {(procData.deduplicatedOcidCount ?? procData.releasesScanned).toLocaleString()}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {procData.stageBreakdown
                    ? `${procData.stageBreakdown.awardedCount.toLocaleString()} awarded · ${procData.stageBreakdown.implementationCount.toLocaleString()} in implementation`
                    : `${procData.releasesScanned.toLocaleString()} raw releases`}
                </div>
              </div>
              <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Budget-Matched Contracts</div>
                <div className="font-mono tabular-nums" style={{ fontSize: '1.4rem', fontWeight: 700 }}>{procData.matchedCount.toLocaleString()}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>EXACT_ERGP + High-Confidence MDA</div>
              </div>
              <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Total Awarded Value</div>
                <div className="font-mono tabular-nums" style={{ fontSize: '1.4rem', fontWeight: 700, color: '#047857' }}>{formatNairaCompact(procData.totalAwardNaira)}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  Disbursed (Impl. Tx): {formatNairaCompact(procData.totalDisbursedNaira || 0)}
                </div>
              </div>
              <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Top Winning Contractors</div>
                <div className="font-mono tabular-nums" style={{ fontSize: '1.4rem', fontWeight: 700 }}>{procData.contractorConcentration.length}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Ranked by cumulative award value</div>
              </div>
            </div>

            <div className="dossier-card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '0.9rem 1.2rem', borderBottom: '1px solid var(--border-subtle)' }}>
                <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                  <Building2 size={15} color="#059669" /> Repeat-Winner Contractor Concentration &amp; BPP / CAC Ownership
                </h3>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                      <th style={{ padding: '0.65rem 1rem' }}>Contractor</th>
                      <th style={{ padding: '0.65rem 1rem' }}>BPP ID</th>
                      <th style={{ padding: '0.65rem 1rem' }}>CAC RC</th>
                      <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Awards</th>
                      <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Awarded</th>
                      <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Disbursed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {procData.contractorConcentration.map((c) => (
                      <tr key={c.contractorName} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.6rem 1rem', fontWeight: 700 }}>{cleanEntityDisplayName(c.contractorName)}</td>
                        <td className="font-mono" style={{ padding: '0.6rem 1rem', fontSize: '0.74rem' }}>{c.bppContractorId || '—'}</td>
                        <td className="font-mono" style={{ padding: '0.6rem 1rem', color: 'var(--text-muted)' }}>{c.cacRcNumber || 'Pending CAC'}</td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.6rem 1rem', textAlign: 'right' }}>{c.awardCount}</td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.6rem 1rem', textAlign: 'right', fontWeight: 700 }}>{formatNairaCompact(c.totalAwardNaira)}</td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.6rem 1rem', textAlign: 'right', color: '#047857' }}>
                          {c.totalPaidNaira ? formatNairaCompact(c.totalPaidNaira) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="dossier-card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '0.9rem 1.2rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>
                    NOCOPO OCDS Contracts &amp; Budget Links
                  </h3>
                  <div className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                    {procApiTotal != null
                      ? `Live Search (${procApiTotal.toLocaleString()} matching contracts)`
                      : `Showing top ${displayedContracts.length} matched contract records`}
                  </div>
                </div>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    placeholder="Search contract, MDA, contractor, ERGP..."
                    value={procQuery}
                    onChange={(e) => setProcQuery(e.target.value)}
                    style={{ padding: '0.4rem 0.7rem 0.4rem 2rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.78rem', width: '270px' }}
                  />
                  <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)' }} />
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                      <th style={{ padding: '0.6rem 0.9rem' }}>Project / Contract</th>
                      <th style={{ padding: '0.6rem 0.9rem' }}>MDA</th>
                      <th style={{ padding: '0.6rem 0.9rem' }}>Contractor</th>
                      <th style={{ padding: '0.6rem 0.9rem' }}>Match / Stage</th>
                      <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>Awarded</th>
                      <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>Disbursed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedContracts.map((l, idx) => (
                      <tr key={`${l.ocdsReleaseId || l.budgetRecordId}-${idx}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.55rem 0.9rem', maxWidth: '300px' }}>
                          <div style={{ fontWeight: 600 }}>
                            <ExpandableText text={l.budgetTitle || 'Untitled OCDS Release'} maxChars={140} />
                          </div>
                          <div className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                            {l.projectCode ? `${l.projectCode} · ` : ''}{l.ocdsReleaseId || ''}
                          </div>
                        </td>
                        <td style={{ padding: '0.55rem 0.9rem' }}>{cleanEntityDisplayName(l.mdaName)}</td>
                        <td style={{ padding: '0.55rem 0.9rem' }}>
                          <div>{l.contractorName ? cleanEntityDisplayName(l.contractorName) : '—'}</div>
                          {l.bppContractorId && (
                            <div className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{l.bppContractorId}</div>
                          )}
                        </td>
                        <td style={{ padding: '0.55rem 0.9rem' }}>
                          <span className="editorial-pill font-mono">{l.matchType}</span>
                          {l.stage && (
                            <span className="font-mono" style={{ display: 'block', fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                              stage: {l.stage}{l.financialYear ? ` · FY ${l.financialYear}` : ''}
                            </span>
                          )}
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.9rem', textAlign: 'right', fontWeight: 700 }}>
                          {l.contractAwardNaira ? formatNairaCompact(l.contractAwardNaira) : '—'}
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.9rem', textAlign: 'right', color: '#047857' }}>
                          {l.totalPaidNaira ? formatNairaCompact(l.totalPaidNaira) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="dossier-card" style={{ padding: '1.6rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', color: '#b45309', fontWeight: 700 }}>
              <Info size={18} /> Official NOCOPO (OCDS) / BPP Contract Dataset Not Yet Ingested
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 }}>
              Public procurement contract records are currently unavailable.
            </p>
          </div>
        )
      )}

      {subTab === 'risk' && (
        riskData && riskData.status === 'VERIFIED_PROCUREMENT_RISK' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
            {/* Risk KPI Strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.85rem' }}>
              <div className="dossier-card" style={{ padding: '1rem 1.15rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Non-Competitive Share
                </div>
                <div className="font-mono tabular-nums" style={{ fontSize: '1.35rem', fontWeight: 700, color: '#b45309', marginTop: '0.25rem' }}>
                  {formatNairaCompact(riskData.headline.nonCompetitiveAwardedNaira)}
                </div>
                <div className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.18rem' }}>
                  {riskData.headline.nonCompetitiveValueSharePct.toFixed(1)}% of awarded · {riskData.headline.nonCompetitiveCount.toLocaleString()} contracts
                </div>
              </div>

              <div className="dossier-card" style={{ padding: '1rem 1.15rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Payment Overruns (Paid &gt; Award)
                </div>
                <div className="font-mono tabular-nums" style={{ fontSize: '1.35rem', fontWeight: 700, color: '#b91c1c', marginTop: '0.25rem' }}>
                  +{formatNairaCompact(riskData.headline.overrunDeltaNaira)}
                </div>
                <div className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.18rem' }}>
                  {riskData.headline.overrunCount.toLocaleString()} contracts ({formatNairaCompact(riskData.headline.overrunPaidNaira)} paid vs {formatNairaCompact(riskData.headline.overrunAwardedNaira)} award)
                </div>
              </div>

              <div className="dossier-card" style={{ padding: '1rem 1.15rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Zero-Paid Awarded Contracts
                </div>
                <div className="font-mono tabular-nums" style={{ fontSize: '1.35rem', fontWeight: 700, color: '#0f172a', marginTop: '0.25rem' }}>
                  {formatNairaCompact(riskData.headline.zeroPaidAwardedNaira)}
                </div>
                <div className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.18rem' }}>
                  {riskData.headline.zeroPaidCount.toLocaleString()} awarded contracts @ ₦0 paid
                </div>
              </div>

              <div className="dossier-card" style={{ padding: '1rem 1.15rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Stage Hygiene Guard
                </div>
                <div className="font-mono tabular-nums" style={{ fontSize: '1.35rem', fontWeight: 700, color: '#047857', marginTop: '0.25rem' }}>
                  {riskData.headline.totalAwardedRows.toLocaleString()} Awarded
                </div>
                <div className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.18rem' }}>
                  {riskData.headline.planningExcludedCount.toLocaleString()} planning/tender rows excluded
                </div>
              </div>
            </div>

            {((riskData.headline.excludedTestRecordsCount || 0) > 0 ||
              (riskData.headline.koboShiftAnomalyCount || 0) > 0 ||
              (riskData.portalDataEntryAnomalies?.length || 0) > 0) && (
              <div
                className="dossier-card"
                style={{
                  padding: '0.9rem 1.15rem',
                  backgroundColor: '#fffbeb',
                  borderColor: '#fde68a',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '0.65rem',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                      <span
                        className="editorial-pill font-mono"
                        style={{
                          backgroundColor: '#fef3c7',
                          color: '#92400e',
                          borderColor: '#f59e0b',
                          fontWeight: 700,
                        }}
                      >
                        <AlertTriangle size={12} /> Quarantined Portal Test / Kobo-Shift Entries
                      </span>
                      <span className="font-mono" style={{ fontSize: '0.72rem', color: '#78350f', fontWeight: 700 }}>
                        {(riskData.headline.excludedTestRecordsCount || 0).toLocaleString()} sandbox test rows
                        {' · '}
                        {(riskData.headline.koboShiftAnomalyCount || 0).toLocaleString()} exact 100x/1,000x portal decimal typos (
                        {formatNairaCompact(riskData.headline.koboShiftAnomalyDeltaNaira || 0)} isolated)
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.78rem', color: '#78350f', lineHeight: 1.45 }}>
                      Excluded from MDA risk rankings and genuine overrun totals without deletion so portal test records and kobo-vs-Naira data entry errors remain auditable.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowQuarantinedAnomalies((prev) => !prev)}
                    className="editorial-btn"
                    style={{
                      fontSize: '0.73rem',
                      padding: '0.34rem 0.72rem',
                      borderColor: '#f59e0b',
                      color: '#78350f',
                      backgroundColor: '#ffffff',
                    }}
                  >
                    {showQuarantinedAnomalies
                      ? 'Hide Quarantined Entries'
                      : `Inspect Quarantined Entries (${(
                          riskData.headline.totalQuarantinedAnomaliesCount ??
                          (riskData.headline.excludedTestRecordsCount || 0) +
                            (riskData.headline.koboShiftAnomalyCount || 0)
                        ).toLocaleString()})`}
                  </button>
                </div>

                {showQuarantinedAnomalies && (riskData.portalDataEntryAnomalies?.length || 0) > 0 && (
                  <div style={{ marginTop: '0.85rem', borderTop: '1px solid #fde68a', paddingTop: '0.75rem' }}>
                    <div style={{ overflowX: 'auto', backgroundColor: '#ffffff', borderRadius: '6px', border: '1px solid #fde68a' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem', textAlign: 'left' }}>
                        <thead>
                          <tr style={{ backgroundColor: '#fefce8', borderBottom: '1px solid #fde68a', color: '#78350f' }}>
                            <th style={{ padding: '0.55rem 0.8rem' }}>Class</th>
                            <th style={{ padding: '0.55rem 0.8rem' }}>FY / OCID</th>
                            <th style={{ padding: '0.55rem 0.8rem' }}>Executing MDA</th>
                            <th style={{ padding: '0.55rem 0.8rem' }}>Contract Title</th>
                            <th style={{ padding: '0.55rem 0.8rem', textAlign: 'right' }}>Awarded</th>
                            <th style={{ padding: '0.55rem 0.8rem', textAlign: 'right' }}>Recorded Paid</th>
                            <th style={{ padding: '0.55rem 0.8rem', textAlign: 'right' }}>Ratio</th>
                            <th style={{ padding: '0.55rem 0.8rem' }}>Audit Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(riskData.portalDataEntryAnomalies || []).slice(0, 50).map((anom, idx) => {
                            const meta = getQuarantineAnomalyMeta(anom.anomalyType);
                            return (
                              <tr key={`${anom.ocid}-${anom.anomalyType}-${idx}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                <td style={{ padding: '0.5rem 0.8rem', whiteSpace: 'nowrap' }}>
                                  <span
                                    className="font-mono"
                                    style={{
                                      fontSize: '0.64rem',
                                      fontWeight: 700,
                                      padding: '0.1rem 0.38rem',
                                      borderRadius: '4px',
                                      backgroundColor: meta.bg,
                                      color: meta.color,
                                      border: `1px solid ${meta.border}`,
                                    }}
                                  >
                                    {meta.label}
                                  </span>
                                </td>
                                <td className="font-mono" style={{ padding: '0.5rem 0.8rem', whiteSpace: 'nowrap' }}>
                                  <div style={{ fontWeight: 700 }}>{anom.financialYear || '—'}</div>
                                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{anom.ocid}</div>
                                </td>
                                <td style={{ padding: '0.5rem 0.8rem', fontWeight: 600 }}>{cleanEntityDisplayName(anom.mdaName)}</td>
                                <td style={{ padding: '0.5rem 0.8rem', maxWidth: '240px' }}>
                                  <ExpandableText text={anom.title || 'Untitled OCDS entry'} maxChars={90} />
                                </td>
                                <td className="font-mono tabular-nums" style={{ padding: '0.5rem 0.8rem', textAlign: 'right' }}>
                                  {formatNairaCompact(anom.awardNaira)}
                                </td>
                                <td className="font-mono tabular-nums" style={{ padding: '0.5rem 0.8rem', textAlign: 'right', fontWeight: 700, color: '#9a3412' }}>
                                  {formatNairaCompact(anom.paidNaira)}
                                </td>
                                <td className="font-mono tabular-nums" style={{ padding: '0.5rem 0.8rem', textAlign: 'right' }}>
                                  {anom.paidToAwardRatio != null ? `${anom.paidToAwardRatio.toLocaleString()}x` : '—'}
                                </td>
                                <td style={{ padding: '0.5rem 0.8rem', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                  {anom.anomalyReason}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {(riskData.portalDataEntryAnomalies?.length || 0) > 50 && (
                      <div className="font-mono" style={{ marginTop: '0.4rem', fontSize: '0.68rem', color: '#78350f' }}>
                        Showing top 50 of {riskData.portalDataEntryAnomalies!.length.toLocaleString()} logged portal anomalies sorted by outlier magnitude.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Method Breakdown + Yearly Trend Charts */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '1rem' }}>
              <div className="dossier-card" style={{ padding: '1.1rem 1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700 }}>
                    Awarded Value by Procurement Method (₦B)
                  </h3>
                  <span className="font-mono" style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>
                    Award / Contract / Implementation
                  </span>
                </div>
                <div style={{ width: '100%', height: '230px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={riskData.methodBreakdown.slice(0, 8).map((m) => ({
                        method: m.method.length > 22 ? `${m.method.slice(0, 20)}…` : m.method,
                        awardedBn: Number((m.awardedNaira / 1e9).toFixed(1)),
                        category: m.category,
                      }))}
                      margin={{ top: 8, right: 12, left: 4, bottom: 32 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="method" tick={{ fontSize: 9.5 }} angle={-18} textAnchor="end" interval={0} />
                      <YAxis tick={{ fontSize: 10 }} unit="B" />
                      <Tooltip formatter={(v: any) => `₦${Number(v).toLocaleString()}B`} />
                      <Bar dataKey="awardedBn" name="Awarded (₦B)" fill="#b45309" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="dossier-card" style={{ padding: '1.1rem 1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700 }}>
                    Annual Non-Competitive Share (%) &amp; Overruns (₦B)
                  </h3>
                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                    <button
                      type="button"
                      disabled={exportingFormat !== null}
                      onClick={async () => {
                        setExportingFormat('pdf');
                        try {
                          await exportProcurementRiskPdf({
                            headline: riskData.headline,
                            mdaRiskRanking: riskData.mdaRiskRanking,
                            topOverrunContracts: riskData.topOverrunContracts.map((c) => ({
                              ...c,
                              overrunDeltaNaira: c.overrunDeltaNaira || 0,
                            })),
                            topZeroPaidAwards: riskData.topZeroPaidAwards,
                            portalDataEntryAnomalies: riskData.portalDataEntryAnomalies || [],
                            permalink: buildCanonicalPermalink({ tab: 'execution', year: selectedYear }),
                          });
                        } finally {
                          setExportingFormat(null);
                        }
                      }}
                      className="editorial-btn"
                      style={{ fontSize: '0.7rem', padding: '0.28rem 0.55rem' }}
                    >
                      <Download size={12} /> Risk PDF
                    </button>
                    <button
                      type="button"
                      disabled={exportingFormat !== null}
                      onClick={async () => {
                        setExportingFormat('docx');
                        try {
                          await exportProcurementRiskDocx({
                            headline: riskData.headline,
                            mdaRiskRanking: riskData.mdaRiskRanking,
                            topOverrunContracts: riskData.topOverrunContracts.map((c) => ({
                              ...c,
                              overrunDeltaNaira: c.overrunDeltaNaira || 0,
                            })),
                            topZeroPaidAwards: riskData.topZeroPaidAwards,
                            portalDataEntryAnomalies: riskData.portalDataEntryAnomalies || [],
                            permalink: buildCanonicalPermalink({ tab: 'execution', year: selectedYear }),
                          });
                        } finally {
                          setExportingFormat(null);
                        }
                      }}
                      className="editorial-btn"
                      style={{ fontSize: '0.7rem', padding: '0.28rem 0.55rem' }}
                    >
                      <FileSpreadsheet size={12} /> DOCX
                    </button>
                  </div>
                </div>
                <div style={{ width: '100%', height: '230px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={riskData.yearlyRiskTrend.slice(-10).map((y) => ({
                        year: String(y.financialYear),
                        nonCompPct: y.nonCompetitiveSharePct,
                        overrunBn: Number((y.overrunDeltaNaira / 1e9).toFixed(1)),
                      }))}
                      margin={{ top: 8, right: 12, left: 4, bottom: 10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="year" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <Bar dataKey="nonCompPct" name="Non-Competitive Share (%)" fill="#d97706" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="overrunBn" name="Overrun Delta (₦B)" fill="#b91c1c" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Drill-down Selector + Table */}
            <div className="dossier-card" style={{ overflow: 'hidden' }}>
              <div
                style={{
                  padding: '0.9rem 1.2rem',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.7rem',
                }}
              >
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {(
                    [
                      { id: 'mdas', label: `MDA Risk Scorecard (${riskData.mdaRiskRanking.length})` },
                      { id: 'overruns', label: `Payment Overruns (${riskData.headline.overrunCount.toLocaleString()})` },
                      { id: 'zeropaid', label: `Zero-Paid Awards (${riskData.headline.zeroPaidCount.toLocaleString()})` },
                      { id: 'noncomp', label: `Non-Competitive (${riskData.headline.nonCompetitiveCount.toLocaleString()})` },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setRiskView(opt.id)}
                      className={riskView === opt.id ? 'editorial-btn-primary' : 'editorial-btn'}
                      style={{ fontSize: '0.73rem', padding: '0.32rem 0.65rem' }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => setRiskConvergentOnly((prev) => !prev)}
                    className={riskConvergentOnly ? 'editorial-btn-primary' : 'editorial-btn'}
                    style={{
                      fontSize: '0.72rem',
                      padding: '0.32rem 0.62rem',
                      backgroundColor: riskConvergentOnly ? '#b91c1c' : undefined,
                      borderColor: riskConvergentOnly ? '#b91c1c' : undefined,
                    }}
                  >
                    Convergent / OAuGF Only
                  </button>

                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      placeholder="Filter MDA, contractor, OCID, method..."
                      value={riskQuery}
                      onChange={(e) => setRiskQuery(e.target.value)}
                      style={{
                        padding: '0.4rem 0.7rem 0.4rem 2rem',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color)',
                        fontSize: '0.78rem',
                        width: '250px',
                      }}
                    />
                    <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)' }} />
                  </div>
                </div>
              </div>

              {riskView === 'mdas' ? (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                        <th style={{ padding: '0.6rem 0.9rem' }}>Executing MDA</th>
                        <th style={{ padding: '0.6rem 0.9rem' }}>6-Ledger &amp; OAuGF</th>
                        <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>Awards</th>
                        <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>Total Awarded</th>
                        <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>Non-Competitive</th>
                        <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>Non-Open %</th>
                        <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>Overrun Delta</th>
                        <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>Zero-Paid</th>
                        <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>Risk Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {riskData.mdaRiskRanking
                        .filter((m) => {
                          if (riskQuery.trim() && !m.mdaName.toLowerCase().includes(riskQuery.trim().toLowerCase())) {
                            return false;
                          }
                          if (riskConvergentOnly) {
                            const conv = lookupMdaConvergence(convergenceData, m.mdaName);
                            const oaugf = lookupOaugfProcurementViolations(oaugfIndex, m.mdaName);
                            return Boolean(conv || oaugf);
                          }
                          return true;
                        })
                        .map((m) => {
                          const mConv = lookupMdaConvergence(convergenceData, m.mdaName);
                          const mOaugf = lookupOaugfProcurementViolations(oaugfIndex, m.mdaName);
                          return (
                          <tr key={m.mdaName} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '0.58rem 0.9rem', fontWeight: 700 }}>{cleanEntityDisplayName(m.mdaName)}</td>
                            <td style={{ padding: '0.58rem 0.9rem' }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.26rem' }}>
                                {mConv && (
                                  <span
                                    className="font-mono"
                                    title={mConv.flagDetails.join(' • ')}
                                    style={{
                                      fontSize: '0.62rem',
                                      fontWeight: 700,
                                      padding: '0.08rem 0.36rem',
                                      borderRadius: '4px',
                                      backgroundColor: mConv.flagCount >= 3 ? '#fef2f2' : '#fffbeb',
                                      color: mConv.flagCount >= 3 ? '#b91c1c' : '#b45309',
                                      border: `1px solid ${mConv.flagCount >= 3 ? '#fecaca' : '#fde68a'}`,
                                    }}
                                  >
                                    {mConv.flagCount} Flags
                                  </span>
                                )}
                                {mOaugf && (
                                  <span
                                    className="font-mono"
                                    title={`${mOaugf.totalQueries} total OAuGF audit queries (${mOaugf.procurementViolationCount} procurement due process violations, ${mOaugf.contractOverpaymentCount} contract overpayments)`}
                                    style={{
                                      fontSize: '0.62rem',
                                      fontWeight: 700,
                                      padding: '0.08rem 0.36rem',
                                      borderRadius: '4px',
                                      backgroundColor: mOaugf.procurementViolationCount > 0 ? '#fff7ed' : '#fffbeb',
                                      color: mOaugf.procurementViolationCount > 0 ? '#c2410c' : '#92400e',
                                      border: `1px solid ${mOaugf.procurementViolationCount > 0 ? '#fed7aa' : '#fde68a'}`,
                                    }}
                                  >
                                    {mOaugf.procurementViolationCount > 0
                                      ? `OAuGF: ${mOaugf.procurementViolationCount} Proc. / ${mOaugf.totalQueries} Total`
                                      : `OAuGF: ${mOaugf.totalQueries} Queries`}
                                  </span>
                                )}
                                {!mConv && !mOaugf && (
                                  <span className="font-mono" style={{ fontSize: '0.66rem', color: '#94a3b8' }}>—</span>
                                )}
                              </div>
                            </td>
                            <td className="font-mono tabular-nums" style={{ padding: '0.58rem 0.9rem', textAlign: 'right' }}>
                              {m.awardCount.toLocaleString()}
                            </td>
                            <td className="font-mono tabular-nums" style={{ padding: '0.58rem 0.9rem', textAlign: 'right' }}>
                              {formatNairaCompact(m.totalAwardedNaira)}
                            </td>
                            <td className="font-mono tabular-nums" style={{ padding: '0.58rem 0.9rem', textAlign: 'right', color: '#b45309', fontWeight: 600 }}>
                              {formatNairaCompact(m.nonCompetitiveAwardedNaira)} ({m.nonCompetitiveCount})
                            </td>
                            <td className="font-mono tabular-nums" style={{ padding: '0.58rem 0.9rem', textAlign: 'right', fontWeight: 700 }}>
                              {m.nonCompetitiveSharePct.toFixed(1)}%
                            </td>
                            <td className="font-mono tabular-nums" style={{ padding: '0.58rem 0.9rem', textAlign: 'right', color: m.overrunDeltaNaira > 0 ? '#b91c1c' : 'var(--text-muted)', fontWeight: 600 }}>
                              {m.overrunDeltaNaira > 0 ? `+${formatNairaCompact(m.overrunDeltaNaira)} (${m.overrunCount})` : '—'}
                            </td>
                            <td className="font-mono tabular-nums" style={{ padding: '0.58rem 0.9rem', textAlign: 'right' }}>
                              {m.zeroPaidCount > 0 ? `${formatNairaCompact(m.zeroPaidAwardedNaira)} (${m.zeroPaidCount})` : '—'}
                            </td>
                            <td className="font-mono tabular-nums" style={{ padding: '0.58rem 0.9rem', textAlign: 'right' }}>
                              <span
                                style={{
                                  padding: '0.14rem 0.42rem',
                                  borderRadius: '4px',
                                  fontWeight: 700,
                                  fontSize: '0.72rem',
                                  backgroundColor: m.riskScore >= 50 ? '#fef2f2' : m.riskScore >= 25 ? '#fffbeb' : '#ecfdf5',
                                  color: m.riskScore >= 50 ? '#b91c1c' : m.riskScore >= 25 ? '#b45309' : '#047857',
                                }}
                              >
                                {m.riskScore.toFixed(1)}
                              </span>
                            </td>
                          </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                        <th style={{ padding: '0.6rem 0.9rem' }}>FY / OCID</th>
                        <th style={{ padding: '0.6rem 0.9rem' }}>MDA &amp; Method</th>
                        <th style={{ padding: '0.6rem 0.9rem' }}>Contract Title</th>
                        <th style={{ padding: '0.6rem 0.9rem' }}>Contractor</th>
                        <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>Awarded</th>
                        <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>
                          {riskView === 'overruns' ? 'Paid / Overrun' : 'NOCOPO Paid'}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(riskView === 'overruns'
                        ? riskData.topOverrunContracts
                        : riskView === 'zeropaid'
                          ? riskData.topZeroPaidAwards
                          : riskData.topNonCompetitiveAwards
                      )
                        .filter((c) => {
                          const q = riskQuery.trim().toLowerCase();
                          if (
                            q &&
                            ![c.ocid, c.mdaName, c.contractorName, c.title, c.procurementMethod, String(c.financialYear)]
                              .filter(Boolean)
                              .some((v) => String(v).toLowerCase().includes(q))
                          ) {
                            return false;
                          }
                          if (riskConvergentOnly) {
                            const cConv = c.contractorName
                              ? lookupContractorConvergence(convergenceData, c.contractorName, c.bppContractorId)
                              : null;
                            const mConv = lookupMdaConvergence(convergenceData, c.mdaName);
                            const mOaugf = lookupOaugfProcurementViolations(oaugfIndex, c.mdaName);
                            return Boolean(cConv || mConv || mOaugf);
                          }
                          return true;
                        })
                        .slice(0, 60)
                        .map((c) => {
                          const cConv = c.contractorName
                            ? lookupContractorConvergence(convergenceData, c.contractorName, c.bppContractorId)
                            : null;
                          const mConv = lookupMdaConvergence(convergenceData, c.mdaName);
                          const mOaugf = lookupOaugfProcurementViolations(oaugfIndex, c.mdaName);
                          return (
                          <tr key={`${riskView}-${c.ocid}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td className="font-mono" style={{ padding: '0.58rem 0.9rem', whiteSpace: 'nowrap' }}>
                              <div style={{ fontWeight: 700 }}>{c.financialYear || '—'}</div>
                              <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>{c.ocid}</div>
                            </td>
                            <td style={{ padding: '0.58rem 0.9rem' }}>
                              <div style={{ fontWeight: 600 }}>{cleanEntityDisplayName(c.mdaName)}</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.18rem' }}>
                                <span
                                  className="font-mono"
                                  style={{
                                    display: 'inline-block',
                                    fontSize: '0.65rem',
                                    fontWeight: 700,
                                    padding: '0.08rem 0.36rem',
                                    borderRadius: '4px',
                                    backgroundColor: '#fffbeb',
                                    color: '#92400e',
                                    border: '1px solid #fde68a',
                                  }}
                                >
                                  {c.procurementMethod}
                                </span>
                                {mConv && (
                                  <span
                                    className="font-mono"
                                    title={mConv.flagDetails.join(' • ')}
                                    style={{
                                      fontSize: '0.61rem',
                                      fontWeight: 700,
                                      padding: '0.08rem 0.32rem',
                                      borderRadius: '4px',
                                      backgroundColor: mConv.flagCount >= 3 ? '#fef2f2' : '#fffbeb',
                                      color: mConv.flagCount >= 3 ? '#b91c1c' : '#b45309',
                                      border: `1px solid ${mConv.flagCount >= 3 ? '#fecaca' : '#fde68a'}`,
                                    }}
                                  >
                                    MDA {mConv.flagCount} Flags
                                  </span>
                                )}
                                {mOaugf && mOaugf.totalQueries > 0 && (
                                  <span
                                    className="font-mono"
                                    style={{
                                      fontSize: '0.61rem',
                                      fontWeight: 700,
                                      padding: '0.08rem 0.32rem',
                                      borderRadius: '4px',
                                      backgroundColor: '#fff7ed',
                                      color: '#c2410c',
                                      border: '1px solid #fed7aa',
                                    }}
                                  >
                                    {mOaugf.procurementViolationCount > 0
                                      ? `OAuGF ${mOaugf.procurementViolationCount} Proc.`
                                      : `OAuGF ${mOaugf.totalQueries} Q`}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td style={{ padding: '0.58rem 0.9rem', maxWidth: '300px' }}>
                              <ExpandableText text={c.title || 'Untitled OCDS contract'} maxChars={140} />
                            </td>
                            <td style={{ padding: '0.58rem 0.9rem' }}>
                              {c.contractorName ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.24rem', alignItems: 'flex-start' }}>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSelectedContractor({
                                        contractorName: c.contractorName!,
                                        bppContractorId: c.bppContractorId ?? undefined,
                                        contractCount: c.leaderboardContractCount ?? 1,
                                        totalContractedNaira: c.leaderboardTotalContractedNaira ?? c.awardNaira,
                                        nocopoDisbursedNaira: c.paidNaira,
                                        govspendPaymentCount: c.leaderboardGovspendCount ?? 0,
                                        govspendPaidNaira: c.leaderboardGovspendPaidNaira ?? 0,
                                        firstYear: c.leaderboardFirstYear ?? c.financialYear ?? null,
                                        lastYear: c.leaderboardLastYear ?? c.financialYear ?? null,
                                        mdaCount: c.leaderboardMdaCount ?? 1,
                                        topMdas: c.leaderboardTopMdas ?? [c.mdaName],
                                      })
                                    }
                                    style={{
                                      fontSize: '0.73rem',
                                      padding: '0.18rem 0.48rem',
                                      borderRadius: '5px',
                                      border: '1px solid #bfdbfe',
                                      backgroundColor: '#eff6ff',
                                      color: '#1d4ed8',
                                      fontWeight: 700,
                                      cursor: 'pointer',
                                      textAlign: 'left',
                                    }}
                                  >
                                    {cleanEntityDisplayName(c.contractorName)}
                                  </button>
                                  {cConv && (
                                    <span
                                      className="font-mono"
                                      title={cConv.flagDetails.join(' • ')}
                                      style={{
                                        fontSize: '0.61rem',
                                        fontWeight: 700,
                                        padding: '0.07rem 0.34rem',
                                        borderRadius: '4px',
                                        backgroundColor: cConv.flagCount >= 3 ? '#fef2f2' : '#fffbeb',
                                        color: cConv.flagCount >= 3 ? '#b91c1c' : '#b45309',
                                        border: `1px solid ${cConv.flagCount >= 3 ? '#fecaca' : '#fde68a'}`,
                                      }}
                                    >
                                      Convergence ({cConv.flagCount} Flags) · {cConv.flags.slice(0, 2).map(formatConvergenceFlagLabel).join(', ')}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                                  Vendor undisclosed in award release
                                </span>
                              )}
                            </td>
                            <td className="font-mono tabular-nums" style={{ padding: '0.58rem 0.9rem', textAlign: 'right', fontWeight: 700 }}>
                              {formatNairaCompact(c.awardNaira)}
                            </td>
                            <td className="font-mono tabular-nums" style={{ padding: '0.58rem 0.9rem', textAlign: 'right' }}>
                              {riskView === 'overruns' ? (
                                <>
                                  <div style={{ fontWeight: 700, color: '#b91c1c' }}>{formatNairaCompact(c.paidNaira)}</div>
                                  <div style={{ fontSize: '0.67rem', color: '#b91c1c' }}>
                                    +{formatNairaCompact(c.overrunDeltaNaira || 0)}
                                    {c.overrunPct ? ` (+${c.overrunPct}%)` : ''}
                                  </div>
                                </>
                              ) : (
                                <span style={{ color: c.paidNaira > 0 ? '#047857' : '#64748b', fontWeight: 600 }}>
                                  {formatNairaCompact(c.paidNaira)}
                                </span>
                              )}
                            </td>
                          </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="dossier-card" style={{ padding: '1.6rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
            Procurement Risk &amp; Overrun audit index is currently unavailable.
          </div>
        )
      )}

      {/* ================================================================ */}
      {/* TAB 2B: TOP CONTRACTORS LEADERBOARD                              */}
      {/* ================================================================ */}
      {subTab === 'contractors' && (
        contractorsData && contractorsData.status === 'VERIFIED_CONTRACTORS_LEADERBOARD' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
            <div className="dossier-card" style={{ padding: '0.85rem 1.15rem', backgroundColor: '#f8fafc', fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Info size={16} color="#059669" style={{ flexShrink: 0 }} />
              <span>{contractorsData.coverageNote}</span>
            </div>

            <div className="grid-4-cols">
              <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Distinct Contractors</div>
                <div className="font-mono tabular-nums" style={{ fontSize: '1.4rem', fontWeight: 700 }}>
                  {contractorsData.totalDistinctContractors.toLocaleString()}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Normalized awardees ({contractorsData.awardCoverageYears})</div>
              </div>
              <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Total Contracts Awarded</div>
                <div className="font-mono tabular-nums" style={{ fontSize: '1.4rem', fontWeight: 700 }}>
                  {contractorsData.totalAwardedContracts.toLocaleString()}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Deduplicated public awards</div>
              </div>
              <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Total Contracted Value</div>
                <div className="font-mono tabular-nums" style={{ fontSize: '1.4rem', fontWeight: 700, color: '#047857' }}>
                  {formatNairaCompact(contractorsData.totalContractedNaira)}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Cumulative awarded amount</div>
              </div>
              <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Repeat Contractors</div>
                <div className="font-mono tabular-nums" style={{ fontSize: '1.4rem', fontWeight: 700, color: '#b45309' }}>
                  {contractorsData.repeatContractorsCount.toLocaleString()}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Contracted 2 or more times</div>
              </div>
            </div>

            <div className="dossier-card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '0.9rem 1.2rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.65rem' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>
                    Federal Contractors Leaderboard — Recurrence &amp; Total Value ({contractorsData.awardCoverageYears})
                  </h3>
                  <div className="font-mono" style={{ fontSize: '0.69rem', color: 'var(--text-muted)' }}>
                    Showing {filteredContractors.length.toLocaleString()} matching contractor(s)
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      placeholder="Search contractor name, BPP ID, or ministry..."
                      value={contractorQuery}
                      onChange={(e) => setContractorQuery(e.target.value)}
                      style={{ padding: '0.4rem 0.7rem 0.4rem 2rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.78rem', width: '250px' }}
                    />
                    <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)' }} />
                  </div>

                  <select
                    aria-label="Sort contractors by"
                    value={contractorSort}
                    onChange={(e) => setContractorSort(e.target.value as 'amount' | 'count' | 'govspend' | 'mdas' | 'convergence')}
                    style={{ padding: '0.4rem 0.65rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.78rem', backgroundColor: '#ffffff' }}
                  >
                    <option value="amount">Highest Total Contracted (₦)</option>
                    <option value="convergence">Most Convergent Flags (6-Ledger)</option>
                    <option value="count">Most Times Contracted</option>
                    <option value="govspend">Highest Treasury Paid (₦)</option>
                    <option value="mdas">Most Ministries Served</option>
                  </select>

                  <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                    {[1, 2, 5, 10].map((minVal) => (
                      <button
                        key={minVal}
                        type="button"
                        onClick={() => setContractorMinAwards(minVal)}
                        className={contractorMinAwards === minVal ? 'editorial-btn-primary' : 'editorial-btn'}
                        style={{ padding: '0.32rem 0.55rem', fontSize: '0.72rem' }}
                      >
                        {minVal === 1 ? 'All' : `${minVal}+ Awards`}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setContractorConvergentOnly((prev) => !prev)}
                      className={contractorConvergentOnly ? 'editorial-btn-primary' : 'editorial-btn'}
                      style={{
                        padding: '0.32rem 0.6rem',
                        fontSize: '0.72rem',
                        backgroundColor: contractorConvergentOnly ? '#b91c1c' : undefined,
                        borderColor: contractorConvergentOnly ? '#b91c1c' : undefined,
                      }}
                    >
                      Convergent Only ({convergenceData?.headline?.convergentContractorCount ?? '2+'})
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                      <th style={{ padding: '0.6rem 0.9rem', width: '52px' }}>#</th>
                      <th style={{ padding: '0.6rem 0.9rem' }}>Contractor &amp; BPP ID</th>
                      <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>Times Contracted</th>
                      <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>Total Contracted (₦)</th>
                      <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>Treasury Cash Paid (₦)</th>
                      <th style={{ padding: '0.6rem 0.9rem', textAlign: 'center' }}>Years Active</th>
                      <th style={{ padding: '0.6rem 0.9rem' }}>Ministries Served</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredContractors.slice(contractorPage * 50, (contractorPage + 1) * 50).map((c, idx) => {
                      const rank = contractorPage * 50 + idx + 1;
                      const yrsLabel =
                        c.firstYear && c.lastYear
                          ? c.firstYear === c.lastYear
                            ? `${c.firstYear}`
                            : `${c.firstYear}–${c.lastYear}`
                          : '—';
                      const cConv = lookupContractorConvergence(
                        convergenceData,
                        c.contractorName,
                        c.bppContractorId
                      );
                      return (
                        <tr
                          key={`${c.contractorName}-${rank}`}
                          onClick={() => setSelectedContractor(c)}
                          style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                        >
                          <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.9rem', color: 'var(--text-muted)' }}>
                            {rank}
                          </td>
                          <td style={{ padding: '0.55rem 0.9rem' }}>
                            <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{cleanEntityDisplayName(c.contractorName)}</div>
                            <div className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                              {c.bppContractorId && <span>{c.bppContractorId} ·</span>}
                              <span style={{ color: '#059669', fontWeight: 600 }}>Inspect history →</span>
                            </div>
                            {cConv && (
                              <div
                                title={cConv.flagDetails.join(' • ')}
                                style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.26rem' }}
                              >
                                <span
                                  className="font-mono"
                                  style={{
                                    fontSize: '0.61rem',
                                    fontWeight: 700,
                                    padding: '0.07rem 0.36rem',
                                    borderRadius: '4px',
                                    backgroundColor: cConv.flagCount >= 3 ? '#fef2f2' : '#fffbeb',
                                    color: cConv.flagCount >= 3 ? '#b91c1c' : '#b45309',
                                    border: `1px solid ${cConv.flagCount >= 3 ? '#fecaca' : '#fde68a'}`,
                                  }}
                                >
                                  {cConv.flagCount >= 3
                                    ? `High-Risk Convergence (${cConv.flagCount} Flags)`
                                    : `Multi-Ledger (${cConv.flagCount} Flags)`}
                                </span>
                                {cConv.flags.slice(0, 2).map((fl) => (
                                  <span
                                    key={fl}
                                    className="font-mono"
                                    style={{
                                      fontSize: '0.6rem',
                                      fontWeight: 600,
                                      padding: '0.06rem 0.32rem',
                                      borderRadius: '4px',
                                      backgroundColor: '#f8fafc',
                                      color: '#475569',
                                      border: '1px solid #cbd5e1',
                                    }}
                                  >
                                    {formatConvergenceFlagLabel(fl)}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.9rem', textAlign: 'right' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '0.12rem 0.5rem',
                                borderRadius: '999px',
                                backgroundColor: c.contractCount >= 5 ? '#ecfdf5' : '#f1f5f9',
                                color: c.contractCount >= 5 ? '#047857' : '#334155',
                                fontWeight: 700,
                              }}
                            >
                              {c.contractCount.toLocaleString()}×
                            </span>
                          </td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.9rem', textAlign: 'right', fontWeight: 700 }}>
                            {formatNairaCompact(c.totalContractedNaira)}
                          </td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.9rem', textAlign: 'right', color: '#047857' }}>
                            {c.govspendPaidNaira ? (
                              <div>
                                <div style={{ fontWeight: 700 }}>{formatNairaCompact(c.govspendPaidNaira)}</div>
                                <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                                  {(c.govspendPaymentCount || 0).toLocaleString()} vouchers
                                </div>
                              </div>
                            ) : '—'}
                          </td>
                          <td className="font-mono" style={{ padding: '0.55rem 0.9rem', textAlign: 'center', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                            {yrsLabel}
                          </td>
                          <td style={{ padding: '0.55rem 0.9rem', maxWidth: '280px', fontSize: '0.73rem', color: 'var(--text-secondary)' }}>
                            <ExpandableText
                              text={
                                c.topMdas?.length
                                  ? `${c.topMdas.map((m) => cleanEntityDisplayName(m)).join('; ')}${c.mdaCount > c.topMdas.length ? ` (+${c.mdaCount - c.topMdas.length} more)` : ''}`
                                  : `${c.mdaCount} MDA(s)`
                              }
                              maxChars={95}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {filteredContractors.length > 50 && (
                <div style={{ padding: '0.75rem 1.2rem', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.76rem' }}>
                  <span className="font-mono" style={{ color: 'var(--text-muted)' }}>
                    Showing {(contractorPage * 50 + 1).toLocaleString()}–{Math.min((contractorPage + 1) * 50, filteredContractors.length).toLocaleString()} of {filteredContractors.length.toLocaleString()}
                  </span>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button
                      type="button"
                      disabled={contractorPage === 0}
                      onClick={() => setContractorPage((p) => Math.max(0, p - 1))}
                      className="editorial-btn"
                      style={{ opacity: contractorPage === 0 ? 0.5 : 1 }}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={(contractorPage + 1) * 50 >= filteredContractors.length}
                      onClick={() => setContractorPage((p) => p + 1)}
                      className="editorial-btn"
                      style={{ opacity: (contractorPage + 1) * 50 >= filteredContractors.length ? 0.5 : 1 }}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="dossier-card" style={{ padding: '1.6rem', color: 'var(--text-secondary)', fontSize: '0.84rem' }}>
            Contractor leaderboard data is currently unavailable.
          </div>
        )
      )}

      {/* ================================================================ */}
      {/* TAB 3: OPEN TREASURY PAYMENTS (GOVSPEND)                         */}
      {/* ================================================================ */}
      {subTab === 'govspend' && (
        govData && govData.status === 'VERIFIED_GOVSPEND_LEDGER' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
            <div className="grid-4-cols">
              <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Valid Treasury Vouchers</div>
                <div className="font-mono tabular-nums" style={{ fontSize: '1.4rem', fontWeight: 700 }}>{govData.validPaymentCount.toLocaleString()}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {govData.dateRange?.minDate} to {govData.dateRange?.maxDate} ({govData.zeroAmountExcludedCount} zero-amt excluded)
                </div>
              </div>
              <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Total Cash Disbursed</div>
                <div className="font-mono tabular-nums" style={{ fontSize: '1.4rem', fontWeight: 700, color: '#047857' }}>{formatNairaCompact(govData.totalDisbursedNaira)}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {govData.uniqueOrganizationsCount.toLocaleString()} MDAs · {govData.uniqueBeneficiariesCount.toLocaleString()} beneficiaries
                </div>
              </div>
              <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Same-Day Split Clusters</div>
                <div className="font-mono tabular-nums" style={{ fontSize: '1.4rem', fontWeight: 700, color: '#b45309' }}>{govData.splitAlertTotalClusters.toLocaleString()}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>3+ vouchers same MDA + beneficiary + day</div>
              </div>
              <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>NOCOPO ↔ GovSpend Links</div>
                <div className="font-mono tabular-nums" style={{ fontSize: '1.4rem', fontWeight: 700 }}>{govData.nocopoCrossLinkCount.toLocaleString()}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Contractors matched to treasury payouts</div>
              </div>
            </div>

            {govAnnualChartData.length > 0 && (
              <div className="dossier-card" style={{ padding: '1.15rem 1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>
                    Annual Open Treasury Cash Disbursements (₦ Trillions, 2018–2026)
                  </h3>
                  <span
                    className="editorial-pill font-mono"
                    title={`${getCoverageCaveatMeta(2018).treasuryPartialNote} ${getCoverageCaveatMeta(2026).treasuryPartialNote}`}
                    style={{
                      backgroundColor: '#fffbeb',
                      color: '#92400e',
                      borderColor: '#fde68a',
                      fontSize: '0.67rem',
                      fontWeight: 700,
                    }}
                  >
                    2018 &amp; 2026 Partial Calendar Windows
                  </span>
                </div>
                <div style={{ width: '100%', height: '210px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={govAnnualChartData} margin={{ top: 6, right: 16, left: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                      <YAxis unit="T" tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: any, _n: any, entry: any) => [`₦${v}T (${Number(entry?.payload?.paymentCount || 0).toLocaleString()} vouchers)`, 'Treasury Disbursements']} />
                      <Bar dataKey="totalTn" name="Disbursed (₦T)" fill="#059669" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {govData.nocopoCrossLinks.length > 0 && (
              <div className="dossier-card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '0.9rem 1.2rem', borderBottom: '1px solid var(--border-subtle)' }}>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>
                    Follow-the-Money Bridge: NOCOPO Contract Awards vs. GovSpend Cash Paid
                  </h3>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                        <th style={{ padding: '0.6rem 0.9rem' }}>Contractor / Beneficiary</th>
                        <th style={{ padding: '0.6rem 0.9rem' }}>BPP ID</th>
                        <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>NOCOPO Awards</th>
                        <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>Awarded Value</th>
                        <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>Treasury Vouchers</th>
                        <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>Cash Paid (GovSpend)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {govData.nocopoCrossLinks.slice(0, 25).map((x) => (
                        <tr key={x.contractorName} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '0.55rem 0.9rem', fontWeight: 700 }}>{cleanEntityDisplayName(x.contractorName)}</td>
                          <td className="font-mono" style={{ padding: '0.55rem 0.9rem', fontSize: '0.72rem' }}>{x.bppContractorId || '—'}</td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.9rem', textAlign: 'right' }}>{x.nocopoAwardCount}</td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.9rem', textAlign: 'right' }}>{formatNairaCompact(x.nocopoAwardedNaira)}</td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.9rem', textAlign: 'right' }}>{x.govspendPaymentCount.toLocaleString()}</td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.9rem', textAlign: 'right', fontWeight: 700, color: '#047857' }}>
                            {formatNairaCompact(x.govspendPaidNaira)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="dossier-card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '0.9rem 1.2rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>
                    Full Open Treasury Payment Ledger Search (467k+ Vouchers)
                  </h3>
                  <div className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                    {govApiTotal != null
                      ? `Live Search (${govApiTotal.toLocaleString()} matching payments)`
                      : 'Showing verified Treasury disbursement summary and split-payment clusters below.'}
                  </div>
                </div>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    placeholder="Search beneficiary, MDA, description..."
                    value={govQuery}
                    onChange={(e) => setGovQuery(e.target.value)}
                    style={{ padding: '0.4rem 0.7rem 0.4rem 2rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.78rem', width: '270px' }}
                  />
                  <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)' }} />
                </div>
              </div>

              {govApiResults ? (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                        <th style={{ padding: '0.6rem 0.9rem' }}>Date / Voucher</th>
                        <th style={{ padding: '0.6rem 0.9rem' }}>MDA (Payer Code)</th>
                        <th style={{ padding: '0.6rem 0.9rem' }}>Beneficiary</th>
                        <th style={{ padding: '0.6rem 0.9rem' }}>Description</th>
                        <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {govApiResults.map((p) => (
                        <tr key={p.paymentNo} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td className="font-mono" style={{ padding: '0.55rem 0.9rem', whiteSpace: 'nowrap' }}>
                            <div>{p.paymentDate}</div>
                            <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>{p.paymentNo}</div>
                          </td>
                          <td style={{ padding: '0.55rem 0.9rem' }}>
                            <div style={{ fontWeight: 600 }}>{cleanEntityDisplayName(p.organizationName)}</div>
                            <div className="font-mono" style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>{p.payerCode}</div>
                          </td>
                          <td style={{ padding: '0.55rem 0.9rem', fontWeight: 600 }}>{cleanEntityDisplayName(p.beneficiaryName)}</td>
                          <td style={{ padding: '0.55rem 0.9rem', maxWidth: '320px' }}>
                            <ExpandableText text={p.description} maxChars={140} />
                          </td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.9rem', textAlign: 'right', fontWeight: 700, color: '#047857' }}>
                            {formatNairaCompact(p.amountNaira)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                        <th style={{ padding: '0.6rem 0.9rem' }}>Date</th>
                        <th style={{ padding: '0.6rem 0.9rem' }}>Paying MDA</th>
                        <th style={{ padding: '0.6rem 0.9rem' }}>Beneficiary (Split Cluster)</th>
                        <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>Vouchers</th>
                        <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>Same-Day Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {govData.splitPaymentAlerts.slice(0, 25).map((s, idx) => (
                        <tr key={`${s.date}-${s.beneficiaryName}-${idx}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td className="font-mono" style={{ padding: '0.55rem 0.9rem', whiteSpace: 'nowrap' }}>{s.date}</td>
                          <td style={{ padding: '0.55rem 0.9rem' }}>{cleanEntityDisplayName(s.organizationName)}</td>
                          <td style={{ padding: '0.55rem 0.9rem' }}>
                            <div style={{ fontWeight: 700 }}>{cleanEntityDisplayName(s.beneficiaryName)}</div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                              <ExpandableText text={s.sampleDescription} maxChars={140} />
                            </div>
                          </td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.9rem', textAlign: 'right' }}>{s.voucherCount}</td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.9rem', textAlign: 'right', fontWeight: 700, color: '#b45309' }}>
                            {formatNairaCompact(s.totalAmountNaira)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="dossier-card" style={{ padding: '1.6rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', color: '#b45309', fontWeight: 700 }}>
              <Info size={18} /> GovSpend Open Treasury Summary Not Yet Indexed
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 }}>
              Treasury disbursement records are currently unavailable.
            </p>
          </div>
        )
      )}

      {subTab === 'network' && (
        <VendorCaptureNetworkView
          onSelectContractor={(contractor, ctx) => {
            setSelectedContractorNetworkCtx(ctx ?? null);
            setSelectedContractor(contractor);
          }}
        />
      )}

      <ContractorHistoryModal
        contractor={selectedContractor}
        fallbackLinks={procData?.links || []}
        networkContext={selectedContractorNetworkCtx}
        onClose={() => {
          setSelectedContractor(null);
          setSelectedContractorNetworkCtx(null);
        }}
      />
    </div>
  );
};
