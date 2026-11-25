import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  BookmarkPlus,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  EyeOff,
  FileSpreadsheet,
  Info,
  Network,
  Scale,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useBudgetDatabase } from '../context/BudgetDatabaseContext';
import { useCasebook } from '../context/CasebookContext';
import { InfoHint } from './InfoHint';
import { ExpandableText } from './ExpandableText';
import { loadSourceProvenance, resolveYearProvenance } from '../utils/citationFormatter';
import {
  exportGovspendForensicsDocx,
  exportGovspendForensicsPdf,
  exportStatisticalForensicsDocx,
  exportStatisticalForensicsPdf,
} from '../utils/documentExporter';
import {
  ASSET_CATEGORY_META,
  type BenfordConformityBand,
  type DuplicateRingCluster,
  type PrematureReplacementAlert,
  type VirementCategoryKey,
} from '../utils/statisticalForensics';
import {
  buildCanonicalPermalink,
  type ForensicsSubTabKey,
  readForensicsUrlState,
  syncUrlParams,
} from '../utils/urlState';
import {
  loadEvidenceEngineAllYears,
  lookupMdaRiskProfile,
  type CrossLedgerContextWire,
} from '../utils/evidenceEngineV3';

interface StatisticalForensicsLabProps {
  financialYear: number;
  onSelectYear?: (year: number) => void;
  onSelectProject?: (project: any) => void;
  onNavigateTab?: (tab: string) => void;
}

interface GovspendForensicsPayload {
  generatedAt: string;
  status: string;
  headline: {
    totalVouchers: number;
    totalNaira: number;
    minDate: string | null;
    maxDate: string | null;
    completeYearsCount: number;
    december2019To2025Vouchers: number;
    december2019To2025Naira: number;
    decemberRushRatio2019To2025: number | null;
    nearThresholdVoucherCount: number;
    nearThresholdNaira: number;
    rolling7DayClusterCount: number;
    rolling7DayClusterNaira: number;
    commercialRolling7DayClusterCount?: number;
    commercialRolling7DayClusterNaira?: number;
    payrollRolling7DayClusterCount?: number;
    payrollRolling7DayClusterNaira?: number;
    payrollStatutoryVoucherCount?: number;
    payrollStatutoryNaira?: number;
    exemptedShortPayrollCount?: number;
    exemptedShortPayrollNaira?: number;
    benfordValidCount: number;
    benford1DMad: number;
    benford1DBand: string;
    benford2DMad: number;
    benford2DBand: string;
    eligibleBenfordMdaCount: number;
    discretionaryOpaqueVoucherCount?: number;
    discretionaryOpaqueNaira?: number;
    commercialOpaqueVoucherCount?: number;
    commercialOpaqueNaira?: number;
  };
  decemberRush: {
    calendarProfile2019To2025: Array<{
      month: string;
      label: string;
      voucherCount: number;
      totalNaira: number;
      sharePct: number;
    }>;
    yearlyRush: Array<{
      financialYear: number;
      monthsCovered: number;
      isPartialYear: boolean;
      partialReason: string;
      totalNaira: number;
      janNovAvgMonthlyNaira: number;
      decemberVoucherCount: number;
      decemberNaira: number;
      decemberSharePct: number;
      decemberRushRatio: number | null;
    }>;
    topDecemberRushMdas: Array<{
      organizationName: string;
      totalNaira: number;
      decemberNaira: number;
      decemberVoucherCount: number;
      janNovAvgMonthlyNaira: number;
      decemberSharePct: number;
      decemberRushRatio: number;
    }>;
  };
  thresholdSplitting: {
    tiers: Array<{
      tierCeilingNaira: number;
      tierLabel: string;
      bandMinNaira: number;
      bandMaxNaira: number;
      voucherCount: number;
      totalNaira: number;
      shareOfValidCountPct: number;
      topMdas: Array<{ organizationName: string; voucherCount: number; totalNaira: number }>;
    }>;
    rolling7DayClusterCount: number;
    rolling7DayClusterNaira: number;
    commercialRolling7DayClusterCount?: number;
    commercialRolling7DayClusterNaira?: number;
    payrollRolling7DayClusterCount?: number;
    payrollRolling7DayClusterNaira?: number;
    topRolling7DayClusters: Array<{
      startDate: string;
      endDate: string;
      organizationName: string;
      beneficiaryName: string;
      voucherCount: number;
      totalNaira: number;
      maxSingleVoucherNaira: number;
      sampleDescription: string;
      isPayrollOrStatutory?: boolean;
    }>;
    topCommercialRolling7DayClusters?: Array<{
      startDate: string;
      endDate: string;
      organizationName: string;
      beneficiaryName: string;
      voucherCount: number;
      totalNaira: number;
      maxSingleVoucherNaira: number;
      sampleDescription: string;
      isPayrollOrStatutory?: boolean;
    }>;
  };
  benfordCash: {
    minAmountNaira: number;
    minMdaSampleSize: number;
    firstDigit: {
      validCount: number;
      meanAbsoluteDeviation: number;
      chiSquareStat: number;
      chiSquarePValue: number;
      conformityBand: string;
      digits: Array<{
        digit: number;
        actualCount: number;
        actualPct: number;
        expectedPct: number;
        deviationPct: number;
        zScore: number;
      }>;
    };
    secondDigitMad: number;
    secondDigitBand: string;
    top2DigitSpikes: Array<{
      prefix: number;
      actualCount: number;
      actualPct: number;
      expectedPct: number;
      deviationPct: number;
      zScore: number;
    }>;
    topFlaggedMdas: Array<{
      organizationName: string;
      validCount: number;
      totalNaira: number;
      mad: number;
      chiSquareStat: number;
      chiSquarePValue: number;
      conformityBand: string;
      peakDigit: number;
      peakDigitDeviationPct: number;
    }>;
  };
  discretionaryAndOpaqueAudit?: {
    totalFlaggedVouchers: number;
    totalFlaggedNaira: number;
    commercialFlaggedVouchers?: number;
    commercialFlaggedNaira?: number;
    exemptedShortPayrollCount?: number;
    exemptedShortPayrollNaira?: number;
    categories: Array<{
      key: string;
      label: string;
      voucherCount: number;
      totalNaira: number;
      topMdas: Array<{ organizationName: string; voucherCount: number; totalNaira: number }>;
      topVouchers: Array<{
        paymentDate: string;
        organizationName: string;
        beneficiaryName: string;
        amountNaira: number;
        description: string;
        isPayrollOrStatutory?: boolean;
      }>;
      commercialVoucherCount?: number;
      commercialTotalNaira?: number;
      commercialTopMdas?: Array<{ organizationName: string; voucherCount: number; totalNaira: number }>;
      commercialTopVouchers?: Array<{
        paymentDate: string;
        organizationName: string;
        beneficiaryName: string;
        amountNaira: number;
        description: string;
        isPayrollOrStatutory?: boolean;
      }>;
    }>;
  };
}

interface VendorPersonalPayeeEntry {
  beneficiaryName: string;
  category: string;
  voucherCount: number;
  totalPaidNaira: number;
  payingMdaCount: number;
  topPayingMdas: Array<{ organizationName: string; totalNaira: number }>;
  firstYear: number | null;
  lastYear: number | null;
  sampleDescription: string;
  purposeTag?: string;
}

interface VendorPersonalPayoutsSlice {
  status: string;
  headline: {
    offNocopoStaffCount?: number;
    offNocopoStaffPaidNaira?: number;
    offNocopoStaffBillionPlusCount?: number;
    offNocopoUnclassifiedCount?: number;
    offNocopoUnclassifiedPaidNaira?: number;
    offNocopoUnclassifiedBillionPlusCount?: number;
    offNocopoPrivateCount?: number;
    offNocopoPrivatePaidNaira?: number;
  };
  offNocopoAudit?: {
    topStaffOrIndividualPayees?: VendorPersonalPayeeEntry[];
    topUnclassifiedPayees?: VendorPersonalPayeeEntry[];
  };
}

const STAFF_PURPOSE_META: Record<
  string,
  { label: string; bg: string; color: string; border: string }
> = {
  OPAQUE_OR_BLANK_DESCRIPTION: {
    label: 'Blank / Opaque Desc',
    bg: '#fef2f2',
    color: '#991b1b',
    border: '#fecaca',
  },
  CONTRACT_OR_SUPPLY_VIA_INDIVIDUAL: {
    label: 'Contract / Supply via Person',
    bg: '#fff1f2',
    color: '#be123c',
    border: '#fecdd3',
  },
  CASH_ADVANCE_OR_IMPREST: {
    label: 'Cash Advance / Imprest',
    bg: '#fffbeb',
    color: '#92400e',
    border: '#fde68a',
  },
  TRAVEL_ESTACODE_OR_DTA: {
    label: 'Travel / Estacode / DTA',
    bg: '#fff7ed',
    color: '#c2410c',
    border: '#fed7aa',
  },
  ALLOWANCE_WELFARE_OR_OTHER: {
    label: 'Allowance / Other',
    bg: '#f1f5f9',
    color: '#475569',
    border: '#cbd5e1',
  },
};

const OPAQUE_CATEGORY_SHORT: Record<string, string> = {
  OPAQUE_BLANK_DESCRIPTION: 'Opaque / Blank Desc',
  STAFF_ADVANCE_IMPREST_REFUND: 'Staff Advance / Imprest',
  CONSULTANCY_LEGAL_SENSITIZATION: 'Consultancy / Advocacy',
  LUXURY_SUV_MOTOR_VEHICLES: 'Motor Vehicles / SUVs',
  ESTACODE_FOREIGN_TRAVEL_DTA: 'Estacode / Foreign Travel',
  WELFARE_HONORARIUM_SITTING_REFRESHMENT: 'Welfare / Honorarium',
};

const BAND_STYLES: Record<
  BenfordConformityBand,
  { label: string; bg: string; color: string; border: string; bar: string }
> = {
  CLOSE_CONFORMITY: {
    label: 'Close Conformity',
    bg: '#ecfdf5',
    color: '#047857',
    border: '#a7f3d0',
    bar: '#059669',
  },
  ACCEPTABLE: {
    label: 'Acceptable Conformity',
    bg: '#ecfdf5',
    color: '#065f46',
    border: '#a7f3d0',
    bar: '#10b981',
  },
  MARGINAL: {
    label: 'Marginal Conformity',
    bg: '#fffbeb',
    color: '#b45309',
    border: '#fde68a',
    bar: '#d97706',
  },
  NON_CONFORMITY: {
    label: 'Non-Conformity',
    bg: '#fef2f2',
    color: '#b91c1c',
    border: '#fecaca',
    bar: '#dc2626',
  },
  INSUFFICIENT_SAMPLE: {
    label: 'Insufficient Sample (n < 30)',
    bg: '#f1f5f9',
    color: '#475569',
    border: '#cbd5e1',
    bar: '#94a3b8',
  },
};

function formatNairaCompact(amt: number): string {
  if (!amt) return '₦0';
  if (amt >= 1e12) return `₦${(amt / 1e12).toFixed(2)}T`;
  if (amt >= 1e9) return `₦${(amt / 1e9).toFixed(2)}B`;
  if (amt >= 1e6) return `₦${(amt / 1e6).toFixed(2)}M`;
  return `₦${Math.round(amt).toLocaleString()}`;
}

export const StatisticalForensicsLab: React.FC<StatisticalForensicsLabProps> = ({
  financialYear,
  onSelectYear,
  onSelectProject,
  onNavigateTab,
}) => {
  const {
    registryDocs,
    statisticalForensics,
    getBenfordAnalysis,
    getBenfordMultiYearTrend,
    getPrematureReplacementAlerts,
    getVirementAnalytics,
    getDuplicateRingClusters,
    getRecordsForYear,
    loadYearRecords,
  } = useBudgetDatabase();
  const { pinItem, isPinned } = useCasebook();

  const [subTab, setSubTab] = useState<ForensicsSubTabKey>(() => readForensicsUrlState().fsub);
  const [mdaQuery, setMdaQuery] = useState('');

  // Replacement state
  const [riskFilter, setRiskFilter] = useState<'ALL' | 'HIGH' | 'MEDIUM'>('ALL');
  const [assetCatFilter, setAssetCatFilter] = useState<string>('ALL');
  const [replacementQuery, setReplacementQuery] = useState('');
  const [expandedAlertKey, setExpandedAlertKey] = useState<string | null>(null);
  const [replacementPage, setReplacementPage] = useState(1);

  // Virement state
  const [virementCategory, setVirementCategory] = useState<'ALL' | VirementCategoryKey>('ALL');
  const [virementQuery, setVirementQuery] = useState('');
  const [virementPage, setVirementPage] = useState(1);

  // Rings state
  const [crossMdaOnly, setCrossMdaOnly] = useState(false);
  const [includeOverhead, setIncludeOverhead] = useState(false);
  const [ringQuery, setRingQuery] = useState('');
  const [expandedRingId, setExpandedRingId] = useState<string | null>(null);
  const [ringsPage, setRingsPage] = useState(1);

  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null);
  const [govForensics, setGovForensics] = useState<GovspendForensicsPayload | null>(null);
  const [vendorPersonalData, setVendorPersonalData] = useState<VendorPersonalPayoutsSlice | null>(null);
  const [crossLedgerCtx, setCrossLedgerCtx] = useState<CrossLedgerContextWire | null>(null);

  // Interactive Cash Forensics filter & pagination states
  const [personalBucket, setPersonalBucket] = useState<'STAFF' | 'UNCLASSIFIED'>('STAFF');
  const [personalPurposeFilter, setPersonalPurposeFilter] = useState<string>('ALL');
  const [personalQuery, setPersonalQuery] = useState<string>('');
  const [personalPage, setPersonalPage] = useState<number>(1);

  const [opaqueCatKey, setOpaqueCatKey] = useState<string>('ALL');
  const [opaqueQuery, setOpaqueQuery] = useState<string>('');
  const [opaquePage, setOpaquePage] = useState<number>(1);
  const [includePayrollInGovspend, setIncludePayrollInGovspend] = useState<boolean>(false);

  useEffect(() => {
    setOpaquePage(1);
  }, [includePayrollInGovspend]);

  useEffect(() => {
    let active = true;
    fetch('/datasets/govspend_forensics.json', { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (active && d) setGovForensics(d);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (subTab !== 'govspend') return;
    let active = true;
    if (!vendorPersonalData) {
      fetch('/datasets/vendor_network_index.json', { cache: 'no-cache' })
        .then((res) => (res.ok ? res.json() : null))
        .then((d) => {
          if (active && d) setVendorPersonalData(d);
        })
        .catch(() => {});
    }
    if (!crossLedgerCtx) {
      loadEvidenceEngineAllYears()
        .then((payload) => {
          if (active && payload?.crossLedgerContext) {
            setCrossLedgerCtx(payload.crossLedgerContext);
          }
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [subTab, vendorPersonalData, crossLedgerCtx]);

  useEffect(() => {
    setPersonalPage(1);
  }, [personalBucket, personalPurposeFilter, personalQuery]);

  useEffect(() => {
    setOpaquePage(1);
  }, [opaqueCatKey, opaqueQuery]);

  const personalSourceRows = useMemo(() => {
    if (!vendorPersonalData?.offNocopoAudit) return [];
    return personalBucket === 'STAFF'
      ? vendorPersonalData.offNocopoAudit.topStaffOrIndividualPayees || []
      : vendorPersonalData.offNocopoAudit.topUnclassifiedPayees || [];
  }, [vendorPersonalData, personalBucket]);

  const personalPurposeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of personalSourceRows) {
      const tag = row.purposeTag || 'ALLOWANCE_WELFARE_OR_OTHER';
      counts[tag] = (counts[tag] || 0) + 1;
    }
    return counts;
  }, [personalSourceRows]);

  const filteredPersonalRows = useMemo(() => {
    const q = personalQuery.trim().toLowerCase();
    return personalSourceRows.filter((row) => {
      const tag = row.purposeTag || 'ALLOWANCE_WELFARE_OR_OTHER';
      if (personalPurposeFilter !== 'ALL' && tag !== personalPurposeFilter) return false;
      if (!q) return true;
      if (row.beneficiaryName.toLowerCase().includes(q)) return true;
      if ((row.sampleDescription || '').toLowerCase().includes(q)) return true;
      return row.topPayingMdas.some((m) => m.organizationName.toLowerCase().includes(q));
    });
  }, [personalSourceRows, personalPurposeFilter, personalQuery]);

  const PERSONAL_PER_PAGE = 15;
  const totalPersonalPages = Math.max(1, Math.ceil(filteredPersonalRows.length / PERSONAL_PER_PAGE));
  const safePersonalPage = Math.min(personalPage, totalPersonalPages);
  const pagedPersonalRows = filteredPersonalRows.slice(
    (safePersonalPage - 1) * PERSONAL_PER_PAGE,
    safePersonalPage * PERSONAL_PER_PAGE
  );

  const flattenedOpaqueVouchers = useMemo(() => {
    const cats = govForensics?.discretionaryAndOpaqueAudit?.categories || [];
    const list: Array<{
      categoryKey: string;
      categoryLabel: string;
      paymentDate: string;
      organizationName: string;
      beneficiaryName: string;
      amountNaira: number;
      description: string;
      isPayrollOrStatutory?: boolean;
    }> = [];
    for (const cat of cats) {
      if (opaqueCatKey !== 'ALL' && cat.key !== opaqueCatKey) continue;
      const sourceVouchers =
        !includePayrollInGovspend && cat.commercialTopVouchers
          ? cat.commercialTopVouchers
          : cat.topVouchers || [];
      for (const v of sourceVouchers) {
        if (!includePayrollInGovspend && v.isPayrollOrStatutory) continue;
        list.push({
          categoryKey: cat.key,
          categoryLabel: OPAQUE_CATEGORY_SHORT[cat.key] || cat.label,
          paymentDate: v.paymentDate,
          organizationName: v.organizationName,
          beneficiaryName: v.beneficiaryName,
          amountNaira: v.amountNaira,
          description: v.description,
          isPayrollOrStatutory: v.isPayrollOrStatutory,
        });
      }
    }
    list.sort((a, b) => b.amountNaira - a.amountNaira);
    return list;
  }, [govForensics, opaqueCatKey, includePayrollInGovspend]);

  const filteredOpaqueVouchers = useMemo(() => {
    const q = opaqueQuery.trim().toLowerCase();
    if (!q) return flattenedOpaqueVouchers;
    return flattenedOpaqueVouchers.filter(
      (v) =>
        v.organizationName.toLowerCase().includes(q) ||
        v.beneficiaryName.toLowerCase().includes(q) ||
        v.description.toLowerCase().includes(q) ||
        v.categoryLabel.toLowerCase().includes(q)
    );
  }, [flattenedOpaqueVouchers, opaqueQuery]);

  const OPAQUE_PER_PAGE = 15;
  const totalOpaquePages = Math.max(1, Math.ceil(filteredOpaqueVouchers.length / OPAQUE_PER_PAGE));
  const safeOpaquePage = Math.min(opaquePage, totalOpaquePages);
  const pagedOpaqueVouchers = filteredOpaqueVouchers.slice(
    (safeOpaquePage - 1) * OPAQUE_PER_PAGE,
    safeOpaquePage * OPAQUE_PER_PAGE
  );

  const activeOpaqueMdas = useMemo(() => {
    const cats = govForensics?.discretionaryAndOpaqueAudit?.categories || [];
    const pickMdas = (cat: (typeof cats)[number]) =>
      !includePayrollInGovspend && cat.commercialTopMdas ? cat.commercialTopMdas : cat.topMdas || [];
    if (opaqueCatKey !== 'ALL') {
      const selected = cats.find((c) => c.key === opaqueCatKey);
      return selected ? pickMdas(selected) : [];
    }
    const merged = new Map<string, { organizationName: string; voucherCount: number; totalNaira: number }>();
    for (const cat of cats) {
      for (const m of pickMdas(cat)) {
        const cur = merged.get(m.organizationName);
        if (cur) {
          cur.voucherCount += m.voucherCount;
          cur.totalNaira += m.totalNaira;
        } else {
          merged.set(m.organizationName, { ...m });
        }
      }
    }
    return Array.from(merged.values())
      .sort((a, b) => b.totalNaira - a.totalNaira)
      .slice(0, 6);
  }, [govForensics, opaqueCatKey, includePayrollInGovspend]);

  const renderMdaAuditBadges = (mdaName: string) => {
    const prof = lookupMdaRiskProfile(crossLedgerCtx, mdaName);
    if (!prof) return null;
    const hasOaugf = prof.oi > 0;
    const hasConvergence = (prof.cf?.length || 0) >= 2;
    if (!hasOaugf && !hasConvergence) return null;

    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.28rem', marginTop: '0.22rem' }}>
        {hasOaugf && (
          <button
            type="button"
            onClick={() => onNavigateTab?.('oaugf')}
            title="Inspect this MDA in OAuGF Constitutional Audit Negligences"
            className="font-mono"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.2rem',
              fontSize: '0.62rem',
              fontWeight: 700,
              padding: '0.08rem 0.36rem',
              borderRadius: '4px',
              backgroundColor: prof.or > 0 ? '#fef2f2' : '#fffbeb',
              color: prof.or > 0 ? '#991b1b' : '#92400e',
              border: `1px solid ${prof.or > 0 ? '#fecaca' : '#fde68a'}`,
              cursor: onNavigateTab ? 'pointer' : 'default',
            }}
          >
            <Scale size={10} />
            OAuGF: {prof.oi} {prof.oi === 1 ? 'query' : 'queries'}
            {prof.or > 0 ? ` (${prof.or} repeat)` : ''}
          </button>
        )}
        {hasConvergence && (
          <button
            type="button"
            onClick={() => onNavigateTab?.('agencies')}
            title="Inspect MDA Integrity Scorecard & Red-Flag Convergence"
            className="font-mono"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.2rem',
              fontSize: '0.62rem',
              fontWeight: 700,
              padding: '0.08rem 0.36rem',
              borderRadius: '4px',
              backgroundColor: (prof.cf?.length || 0) >= 3 ? '#fff1f2' : '#f8fafc',
              color: (prof.cf?.length || 0) >= 3 ? '#be123c' : '#334155',
              border: `1px solid ${(prof.cf?.length || 0) >= 3 ? '#fecdd3' : '#cbd5e1'}`,
              cursor: onNavigateTab ? 'pointer' : 'default',
            }}
          >
            {prof.cf.length}x Red-Flag{prof.g && prof.g !== 'N/A' ? ` · Grade ${prof.g}` : ''}
          </button>
        )}
      </div>
    );
  };

  useEffect(() => {
    syncUrlParams({ tab: 'forensics', fsub: subTab }, 'replace');
  }, [subTab]);

  useEffect(() => {
    const onPop = () => {
      setSubTab(readForensicsUrlState().fsub);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Ensure full year records are loaded when toggling boilerplate overhead inspection
  useEffect(() => {
    if (includeOverhead && getRecordsForYear(financialYear).length === 0) {
      loadYearRecords(financialYear);
    }
  }, [includeOverhead, financialYear, getRecordsForYear, loadYearRecords]);

  const benford = useMemo(() => getBenfordAnalysis(financialYear), [getBenfordAnalysis, financialYear]);
  const benfordTrend = useMemo(() => getBenfordMultiYearTrend(), [getBenfordMultiYearTrend]);
  const prematureAlerts = useMemo(
    () => getPrematureReplacementAlerts(),
    [getPrematureReplacementAlerts]
  );
  const virements = useMemo(() => getVirementAnalytics(financialYear), [getVirementAnalytics, financialYear]);
  const duplicateRings = useMemo(
    () => getDuplicateRingClusters(financialYear, includeOverhead),
    [getDuplicateRingClusters, financialYear, includeOverhead]
  );

  const bandMeta = BAND_STYLES[benford.conformityBand] || BAND_STYLES.NON_CONFORMITY;
  const activeRegDoc = useMemo(
    () => registryDocs.find((d) => (d.financial_year || d.financialYear) === financialYear),
    [registryDocs, financialYear]
  );
  const isSummaryActOnly = activeRegDoc?.coverage_tier === 'SUMMARY_ACT_ONLY';

  // Filtered MDA list in Benford tab
  const filteredMdas = useMemo(() => {
    const q = mdaQuery.trim().toLowerCase();
    if (!q) return benford.flaggedMdas;
    return benford.flaggedMdas.filter((m) => m.mdaName.toLowerCase().includes(q));
  }, [benford.flaggedMdas, mdaQuery]);

  // Asset categories present in premature alerts
  const presentCategories = useMemo(() => {
    const set = new Set(prematureAlerts.map((a) => a.assetCategory));
    return Array.from(set);
  }, [prematureAlerts]);

  const filteredAlerts = useMemo(() => {
    const q = replacementQuery.trim().toLowerCase();
    return prematureAlerts.filter((a) => {
      if (riskFilter !== 'ALL' && a.wasteRisk !== riskFilter) return false;
      if (assetCatFilter !== 'ALL' && a.assetCategory !== assetCatFilter) return false;
      if (!q) return true;
      if (a.mdaName.toLowerCase().includes(q) || a.assetCategoryLabel.toLowerCase().includes(q)) {
        return true;
      }
      return a.sampleRecords.some((r) => r.projectName.toLowerCase().includes(q));
    });
  }, [prematureAlerts, riskFilter, assetCatFilter, replacementQuery]);

  const ALERTS_PER_PAGE = 15;
  const totalAlertPages = Math.max(1, Math.ceil(filteredAlerts.length / ALERTS_PER_PAGE));
  const safeAlertPage = Math.min(replacementPage, totalAlertPages);
  const pagedAlerts = filteredAlerts.slice(
    (safeAlertPage - 1) * ALERTS_PER_PAGE,
    safeAlertPage * ALERTS_PER_PAGE
  );

  useEffect(() => {
    setReplacementPage(1);
  }, [riskFilter, assetCatFilter, replacementQuery]);

  // Filtered Virements
  const filteredVirements = useMemo(() => {
    const q = virementQuery.trim().toLowerCase();
    return virements.records.filter((r) => {
      if (virementCategory !== 'ALL' && r.categoryKey !== virementCategory) return false;
      if (!q) return true;
      return (
        r.projectName.toLowerCase().includes(q) ||
        r.agency.toLowerCase().includes(q) ||
        r.projectCode.toLowerCase().includes(q)
      );
    });
  }, [virements.records, virementCategory, virementQuery]);

  const VIREMENTS_PER_PAGE = 25;
  const totalVirementPages = Math.max(1, Math.ceil(filteredVirements.length / VIREMENTS_PER_PAGE));
  const safeVirementPage = Math.min(virementPage, totalVirementPages);
  const pagedVirements = filteredVirements.slice(
    (safeVirementPage - 1) * VIREMENTS_PER_PAGE,
    safeVirementPage * VIREMENTS_PER_PAGE
  );

  useEffect(() => {
    setVirementPage(1);
  }, [virementCategory, virementQuery, financialYear]);

  // Filtered Duplicate Rings
  const ringYearSummary = statisticalForensics?.byYear?.[String(financialYear)]?.duplicateRings;
  const filteredRings = useMemo(() => {
    const q = ringQuery.trim().toLowerCase();
    return duplicateRings.filter((c) => {
      if (crossMdaOnly && !c.isCrossMda) return false;
      if (!q) return true;
      if (c.normalizedTitle.toLowerCase().includes(q)) return true;
      if (c.mdasInvolved.some((m) => m.toLowerCase().includes(q))) return true;
      return c.sampleRecords.some(
        (r) =>
          r.projectCode.toLowerCase().includes(q) || r.agency.toLowerCase().includes(q)
      );
    });
  }, [duplicateRings, crossMdaOnly, ringQuery]);

  const RINGS_PER_PAGE = 20;
  const totalRingPages = Math.max(1, Math.ceil(filteredRings.length / RINGS_PER_PAGE));
  const safeRingPage = Math.min(ringsPage, totalRingPages);
  const pagedRings = filteredRings.slice(
    (safeRingPage - 1) * RINGS_PER_PAGE,
    safeRingPage * RINGS_PER_PAGE
  );

  useEffect(() => {
    setRingsPage(1);
  }, [crossMdaOnly, includeOverhead, ringQuery, financialYear]);

  const handleExport = async (format: 'pdf' | 'docx') => {
    setExportingFormat(format);
    try {
      const manifest = await loadSourceProvenance();
      const activeDoc = registryDocs.find(
        (d) => (d.financial_year || d.financialYear) === financialYear
      );
      const prov = resolveYearProvenance(manifest, financialYear, activeDoc);
      const permalink = buildCanonicalPermalink({
        tab: 'forensics',
        fsub: subTab,
        year: financialYear,
      });
      const input = {
        financialYear,
        activeSubTab: subTab,
        benford,
        prematureAlerts: filteredAlerts.slice(0, 25),
        virements,
        duplicateRings: filteredRings.slice(0, 25),
        totalCrossYearPrematureAlerts: prematureAlerts.length,
        sourceFilename: prov.filename,
        sha256: prov.sha256 || activeDoc?.sha256 || null,
        permalink,
      };
      if (format === 'pdf') {
        await exportStatisticalForensicsPdf(input);
      } else {
        await exportStatisticalForensicsDocx(input);
      }
    } finally {
      setExportingFormat(null);
    }
  };

  const openModalRecord = (rec: {
    id?: string;
    projectCode?: string;
    projectName: string;
    agency?: string;
    amount: number;
    page?: number;
    financialYear?: number;
    sourceFilename?: string;
  }) => {
    onSelectProject?.({
      id: rec.id,
      projectCode: rec.projectCode || 'ERGP',
      projectName: rec.projectName,
      agency: rec.agency || 'Federal MDA',
      amount: rec.amount,
      page: rec.page || 1,
      financialYear: rec.financialYear || financialYear,
      sourceFilename: rec.sourceFilename,
    });
  };

  const subTabs: Array<{
    id: ForensicsSubTabKey;
    label: string;
    icon: React.ReactNode;
    pill: string;
  }> = [
    {
      id: 'benford',
      label: 'Benford Digit Audit',
      icon: <BarChart3 size={14} />,
      pill:
        benford.conformityBand === 'INSUFFICIENT_SAMPLE'
          ? 'Low N'
          : `MAD ${benford.meanAbsoluteDeviation.toFixed(4)}`,
    },
    {
      id: 'replacement',
      label: 'Premature Replacement',
      icon: <Clock size={14} />,
      pill: `${prematureAlerts.length} MDAs (1999–2026)`,
    },
    {
      id: 'virements',
      label: 'Virement & Contingency',
      icon: <ArrowLeftRight size={14} />,
      pill: formatNairaCompact(virements.totalNaira),
    },
    {
      id: 'rings',
      label: 'Duplicate Rings',
      icon: <Network size={14} />,
      pill: `${(ringYearSummary?.crossMdaRingsCount ?? duplicateRings.filter((r) => r.isCrossMda).length).toLocaleString()} Cross-MDA`,
    },
    {
      id: 'govspend',
      label: 'Treasury Cash & Dec Rush',
      icon: <AlertTriangle size={14} />,
      pill: govForensics?.headline?.decemberRushRatio2019To2025
        ? `${govForensics.headline.decemberRushRatio2019To2025.toFixed(2)}x Dec`
        : '467k Vouchers',
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Editorial Dark-Accent Banner Header */}
      <div className="dossier-card" style={{ padding: '1.35rem 1.5rem' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '1rem',
          }}
        >
          <div style={{ flex: '1 1 420px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.28rem', flexWrap: 'wrap' }}>
              <BarChart3 size={14} style={{ color: 'var(--emerald-primary)' }} />
              <span
                className="font-mono"
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  letterSpacing: '0.07em',
                  textTransform: 'uppercase',
                  color: 'var(--emerald-primary)',
                }}
              >
                Statistical Forensics Lab · FY {financialYear} &amp; 1999–2026 Corpus
              </span>
              {statisticalForensics && (
                <span
                  className="editorial-pill font-mono"
                  style={{
                    fontSize: '0.64rem',
                    backgroundColor: '#ecfdf5',
                    color: '#047857',
                    borderColor: '#a7f3d0',
                  }}
                >
                  {statisticalForensics.summary.totalRecordsAnalyzed.toLocaleString()} Pre-Indexed Rows
                </span>
              )}
            </div>
            <h1
              className="font-editorial"
              style={{ margin: 0, fontSize: '1.55rem', fontWeight: 600, color: 'var(--text-primary)' }}
            >
              Econometric &amp; Lifecycle Anomaly Workbench
            </h1>
            <p style={{ margin: '0.28rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Nigrini Mean Absolute Deviation (MAD) Benford testing, multi-decade durable asset lifespan audits,
              virement/service-wide tracking, and coordinated cross-MDA duplicate rings.
            </p>
          </div>

          {/* Strict PDF & DOCX Export Controls */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => handleExport('pdf')}
              disabled={exportingFormat !== null}
              className="editorial-btn-primary"
            >
              <Download size={14} />
              {exportingFormat === 'pdf'
                ? 'Generating PDF...'
                : 'Download Forensics Dossier (PDF)'}
            </button>
            <button
              type="button"
              onClick={() => handleExport('docx')}
              disabled={exportingFormat !== null}
              className="editorial-btn"
            >
              <FileSpreadsheet size={14} />
              {exportingFormat === 'docx'
                ? 'Generating DOCX...'
                : 'Download Forensics Dossier (DOCX)'}
            </button>
          </div>
        </div>

        {/* 4-Pillar Sub-Navigation */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.5rem',
            marginTop: '1.05rem',
            paddingTop: '0.95rem',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          {subTabs.map((t) => {
            const active = subTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSubTab(t.id)}
                className={active ? 'editorial-btn-primary' : 'editorial-btn'}
                style={{ padding: '0.48rem 0.85rem' }}
              >
                {t.icon}
                <span>{t.label}</span>
                <span
                  className="font-mono"
                  style={{
                    fontSize: '0.66rem',
                    padding: '0.08rem 0.42rem',
                    borderRadius: '999px',
                    backgroundColor: active ? 'rgba(16, 185, 129, 0.22)' : '#f1f5f9',
                    color: active ? '#6ee7b7' : '#475569',
                  }}
                >
                  {t.pill}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ================================================================ */}
      {/* TAB 1: BENFORD FIRST-DIGIT AUDIT                                 */}
      {/* ================================================================ */}
      {subTab === 'benford' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
          {/* Low-N / Summary Act Methodological Guard Notice */}
          {benford.conformityBand === 'INSUFFICIENT_SAMPLE' ? (
            <div
              className="dossier-card"
              style={{
                padding: '0.9rem 1.15rem',
                backgroundColor: '#fffbeb',
                borderColor: '#fde68a',
                display: 'flex',
                alignItems: 'center',
                gap: '0.7rem',
              }}
            >
              <Info size={18} color="#b45309" style={{ flexShrink: 0 }} />
              <div style={{ fontSize: '0.8rem', color: '#78350f' }}>
                <strong>Statistical Guard Active (Low N):</strong> FY {financialYear} contains{' '}
                <span className="font-mono">{benford.validRecordCount}</span> extracted line items (below the minimum
                statistical threshold of <span className="font-mono">n = 30</span> for first-digit Benford testing).
                High-anomaly classification is suppressed to avoid false positives on enacted summary tables.
              </div>
            </div>
          ) : isSummaryActOnly ? (
            <div
              className="dossier-card"
              style={{
                padding: '0.85rem 1.15rem',
                backgroundColor: '#f8fafc',
                borderColor: '#cbd5e1',
                display: 'flex',
                alignItems: 'center',
                gap: '0.7rem',
              }}
            >
              <Info size={17} color="#475569" style={{ flexShrink: 0 }} />
              <div style={{ fontSize: '0.79rem', color: '#334155' }}>
                <strong>Small-Sample Summary Act Methodological Note:</strong> FY {financialYear} is indexed from an
                aggregate Statutory Summary Act (<span className="font-mono">N = {benford.validRecordCount}</span>). Small
                macro summary tables naturally elevate Nigrini MAD sampling variance; always weigh MAD alongside
                Pearson &chi;&sup2; (<span className="font-mono">p = {benford.chiSquarePValue.toFixed(4)}</span>).
              </div>
            </div>
          ) : null}

          {/* KPI Strip */}
          <div className="grid-4-cols">
            <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                Valid Line Items (FY {financialYear})
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.45rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.25rem' }}>
                {benford.validRecordCount.toLocaleString()}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Positive Naira allocations audited</div>
            </div>

            <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                Nigrini MAD
                <InfoHint
                  term="Benford's Law & Nigrini MAD"
                  meaning="Mean Absolute Deviation measures how closely the first digits (1–9) of budget amounts match natural financial distributions."
                  whyItMatters="Values above 0.015 suggest heavy round-number guessing, template copy-pasting, or artificial splitting."
                />
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.45rem', fontWeight: 700, color: bandMeta.color, marginTop: '0.25rem' }}>
                {benford.meanAbsoluteDeviation.toFixed(5)}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Benchmarks: &le;0.006 Close · &le;0.012 OK · &gt;0.015 Non-Conforming
              </div>
            </div>

            <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                Pearson &chi;&sup2; (df = 8)
                <InfoHint
                  term="Pearson Chi-Square & p-value"
                  meaning="Statistical test checking whether digit deviations could happen by random chance alone."
                  whyItMatters="A very small p-value (< 0.01) means the digit skew is statistically real, not random noise."
                />
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.45rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.25rem' }}>
                {benford.chiSquareStat.toLocaleString()}
              </div>
              <div className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                p-value = {benford.chiSquarePValue < 0.0001 ? '< 0.0001' : benford.chiSquarePValue.toFixed(4)}
              </div>
            </div>

            <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                Conformity Verdict
              </div>
              <div style={{ marginTop: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                <span
                  className="editorial-pill"
                  style={{
                    backgroundColor: bandMeta.bg,
                    color: bandMeta.color,
                    borderColor: bandMeta.border,
                    fontWeight: 700,
                    fontSize: '0.75rem',
                  }}
                >
                  {benford.conformityBand === 'CLOSE_CONFORMITY' || benford.conformityBand === 'ACCEPTABLE' ? (
                    <ShieldCheck size={13} />
                  ) : (
                    <AlertTriangle size={13} />
                  )}
                  {bandMeta.label}
                </span>
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                Integrity Score:{' '}
                <strong className="font-mono">{benford.benfordIntegrityScore}/100</strong>
              </div>
            </div>
          </div>

          {/* Charts Grid */}
          <div className="grid-2-cols">
            {/* Leading Digit Observed vs Expected */}
            <div className="dossier-card" style={{ padding: '1.15rem 1.25rem', minWidth: 0 }}>
              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                First-Digit Empirical Distribution vs. Benford Expected Curve
              </h3>
              <p style={{ margin: '0.2rem 0 0.85rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Spikes above expected percentages at leading digits 4–9 often reflect statutory splitting, ceiling-evasion, or rounded lump sums.
              </p>
              <div style={{ width: '100%', height: '270px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={benford.breakdown} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="digit" tick={{ fontSize: 12 }} />
                    <YAxis unit="%" tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(val: any, name: any) => [`${Number(val).toFixed(2)}%`, String(name)]}
                      labelFormatter={(digit) => `Leading Digit ${digit}`}
                    />
                    <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
                    <Bar dataKey="actualPct" name="Observed (%)" radius={[4, 4, 0, 0]}>
                      {benford.breakdown.map((row) => (
                        <Cell
                          key={row.digit}
                          fill={
                            row.status === 'Abnormally High'
                              ? '#dc2626'
                              : row.status === 'Abnormally Low'
                              ? '#d97706'
                              : '#059669'
                          }
                        />
                      ))}
                    </Bar>
                    <Line
                      type="monotone"
                      dataKey="expectedPct"
                      name="Benford Law (%)"
                      stroke="#091017"
                      strokeWidth={2.5}
                      dot={{ r: 3.5, fill: '#091017' }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 28-Year MAD Timeline */}
            <div className="dossier-card" style={{ padding: '1.15rem 1.25rem', minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    28-Year Benford MAD Trajectory (1999–2026)
                  </h3>
                  <p style={{ margin: '0.2rem 0 0.85rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Click any fiscal year bar to jump the lab directly to that year&apos;s audit.
                  </p>
                </div>
              </div>
              <div style={{ width: '100%', height: '270px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={benfordTrend}
                    margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
                    onClick={(state: any) => {
                      const yr = state?.activeLabel ? Number(state.activeLabel) : NaN;
                      if (Number.isInteger(yr) && onSelectYear) onSelectYear(yr);
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="financialYear" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} domain={[0, 'auto']} />
                    <Tooltip
                      formatter={(val: any) => [Number(val).toFixed(5), 'Nigrini MAD']}
                      labelFormatter={(yr) => `FY ${yr} (Click to inspect)`}
                    />
                    <ReferenceLine y={0.015} stroke="#dc2626" strokeDasharray="4 4" label={{ value: 'Non-Conf (0.015)', fontSize: 10, fill: '#dc2626', position: 'insideTopRight' }} />
                    <ReferenceLine y={0.006} stroke="#059669" strokeDasharray="4 4" />
                    <Bar dataKey="meanAbsoluteDeviation" name="MAD" radius={[3, 3, 0, 0]} cursor="pointer">
                      {benfordTrend.map((pt) => {
                        const isSelected = pt.financialYear === financialYear;
                        const col = (BAND_STYLES[pt.conformityBand] || BAND_STYLES.NON_CONFORMITY).bar;
                        return (
                          <Cell
                            key={pt.financialYear}
                            fill={isSelected ? '#091017' : col}
                            stroke={isSelected ? '#10b981' : undefined}
                            strokeWidth={isSelected ? 2 : 0}
                          />
                        );
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Digit Breakdown Table */}
          <div className="dossier-card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '0.9rem 1.2rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>
                Digits 1–9 Forensic Deviation Matrix (FY {financialYear})
              </h3>
              <span className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Critical |Z| &ge; 1.96 (95% CI)
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '0.65rem 1rem' }}>Digit</th>
                    <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Observed Count</th>
                    <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Observed %</th>
                    <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Expected %</th>
                    <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Deviation</th>
                    <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Z-Score</th>
                    <th style={{ padding: '0.65rem 1rem' }}>Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {benford.breakdown.map((row) => (
                    <tr key={row.digit} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td className="font-mono" style={{ padding: '0.6rem 1rem', fontWeight: 700 }}>{row.digit}</td>
                      <td className="font-mono tabular-nums" style={{ padding: '0.6rem 1rem', textAlign: 'right' }}>
                        {row.actualCount.toLocaleString()}
                      </td>
                      <td className="font-mono tabular-nums" style={{ padding: '0.6rem 1rem', textAlign: 'right' }}>
                        {row.actualPct.toFixed(2)}%
                      </td>
                      <td className="font-mono tabular-nums" style={{ padding: '0.6rem 1rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                        {row.expectedPct.toFixed(2)}%
                      </td>
                      <td
                        className="font-mono tabular-nums"
                        style={{
                          padding: '0.6rem 1rem',
                          textAlign: 'right',
                          fontWeight: 600,
                          color: row.deviationPct > 0 ? '#b91c1c' : '#0f172a',
                        }}
                      >
                        {row.deviationPct >= 0 ? `+${row.deviationPct.toFixed(2)}%` : `${row.deviationPct.toFixed(2)}%`}
                      </td>
                      <td className="font-mono tabular-nums" style={{ padding: '0.6rem 1rem', textAlign: 'right' }}>
                        {row.zScore >= 0 ? `+${row.zScore.toFixed(2)}` : row.zScore.toFixed(2)}
                      </td>
                      <td style={{ padding: '0.6rem 1rem' }}>
                        <span
                          className="editorial-pill"
                          style={{
                            backgroundColor:
                              row.status === 'Abnormally High'
                                ? '#fef2f2'
                                : row.status === 'Abnormally Low'
                                ? '#fffbeb'
                                : '#ecfdf5',
                            color:
                              row.status === 'Abnormally High'
                                ? '#b91c1c'
                                : row.status === 'Abnormally Low'
                                ? '#b45309'
                                : '#047857',
                          }}
                        >
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* High-Risk MDA Drill-down */}
          <div className="dossier-card" style={{ overflow: 'hidden' }}>
            <div
              style={{
                padding: '0.9rem 1.2rem',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.6rem',
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>
                  Top High-Risk MDAs by Benford MAD (N &ge; 50 items, FY {financialYear})
                </h3>
                <p style={{ margin: '0.15rem 0 0', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  Ministries and agencies whose internal allocation distributions deviate furthest from Benford&apos;s Law
                </p>
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Filter MDAs..."
                  value={mdaQuery}
                  onChange={(e) => setMdaQuery(e.target.value)}
                  style={{
                    padding: '0.42rem 0.7rem 0.42rem 2rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.78rem',
                    width: '220px',
                  }}
                />
                <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)' }} />
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '0.65rem 1rem' }}>Executing MDA</th>
                    <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Items</th>
                    <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>MDA Spend</th>
                    <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>MAD</th>
                    <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>&chi;&sup2; (p)</th>
                    <th style={{ padding: '0.65rem 1rem' }}>Peak Spike Digit</th>
                    <th style={{ padding: '0.65rem 1rem' }}>Conformity</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMdas.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        No MDAs meet the N &ge; 50 line-item minimum for FY {financialYear} or match your filter.
                      </td>
                    </tr>
                  ) : (
                    filteredMdas.map((m) => {
                      const style = BAND_STYLES[m.conformityBand] || BAND_STYLES.NON_CONFORMITY;
                      return (
                        <tr key={m.mdaName} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '0.62rem 1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {m.mdaName}
                          </td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.62rem 1rem', textAlign: 'right' }}>
                            {m.recordCount.toLocaleString()}
                          </td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.62rem 1rem', textAlign: 'right' }}>
                            {formatNairaCompact(m.totalAmountNaira)}
                          </td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.62rem 1rem', textAlign: 'right', fontWeight: 700, color: style.color }}>
                            {m.mad.toFixed(5)}
                          </td>
                          <td className="font-mono tabular-nums" style={{ padding: '0.62rem 1rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                            {m.chiSquareStat.toLocaleString()} ({m.chiSquarePValue < 0.001 ? '<0.001' : m.chiSquarePValue.toFixed(3)})
                          </td>
                          <td className="font-mono" style={{ padding: '0.62rem 1rem' }}>
                            Digit {m.topSuspiciousDigit} ({m.topDigitDeviationPct >= 0 ? '+' : ''}
                            {m.topDigitDeviationPct.toFixed(1)}%)
                          </td>
                          <td style={{ padding: '0.62rem 1rem' }}>
                            <span
                              className="editorial-pill"
                              style={{ backgroundColor: style.bg, color: style.color, borderColor: style.border }}
                            >
                              {style.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 2: PREMATURE ASSET REPLACEMENT (1999-2026)                   */}
      {/* ================================================================ */}
      {subTab === 'replacement' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
          <div className="dossier-card" style={{ padding: '1rem 1.25rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700 }}>
                  Cross-Year Durable Capital Lifecycle Audit (1999–2026)
                </h3>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                  Detects MDAs repeatedly budgeting durable assets (SUVs, ICT gear, generators, boreholes) strictly inside usable lifespan thresholds. Routine consumables &amp; maintenance are excluded.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                  value={riskFilter}
                  onChange={(e) => setRiskFilter(e.target.value as any)}
                  style={{ padding: '0.42rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.78rem', fontWeight: 600 }}
                >
                  <option value="ALL">All Risks ({prematureAlerts.length})</option>
                  <option value="HIGH">HIGH Risk Only</option>
                  <option value="MEDIUM">MEDIUM Risk Only</option>
                </select>
                <select
                  value={assetCatFilter}
                  onChange={(e) => setAssetCatFilter(e.target.value)}
                  style={{ padding: '0.42rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.78rem', fontWeight: 600 }}
                >
                  <option value="ALL">All Asset Categories</option>
                  {presentCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {ASSET_CATEGORY_META[cat]?.label || cat}
                    </option>
                  ))}
                </select>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    placeholder="Search MDA or project..."
                    value={replacementQuery}
                    onChange={(e) => setReplacementQuery(e.target.value)}
                    style={{
                      padding: '0.42rem 0.7rem 0.42rem 2rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.78rem',
                      width: '210px',
                    }}
                  />
                  <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)' }} />
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {pagedAlerts.length === 0 ? (
              <div className="dossier-card" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                No durable capital replacement alerts matched the active filters.
              </div>
            ) : (
              pagedAlerts.map((alert: PrematureReplacementAlert) => {
                const key = `${alert.mdaName}::${alert.assetCategory}`;
                const isOpen = expandedAlertKey === key;
                return (
                  <div key={key} className="dossier-card" style={{ overflow: 'hidden' }}>
                    <button
                      type="button"
                      onClick={() => setExpandedAlertKey(isOpen ? null : key)}
                      style={{
                        width: '100%',
                        background: 'none',
                        border: 'none',
                        padding: '0.95rem 1.2rem',
                        textAlign: 'left',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '1rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem', minWidth: 0, flex: 1 }}>
                        <span style={{ marginTop: '0.2rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem' }}>
                            <span
                              className="editorial-pill font-mono"
                              style={{
                                backgroundColor: alert.wasteRisk === 'HIGH' ? '#fef2f2' : '#fffbeb',
                                color: alert.wasteRisk === 'HIGH' ? '#b91c1c' : '#b45309',
                                borderColor: alert.wasteRisk === 'HIGH' ? '#fecaca' : '#fde68a',
                              }}
                            >
                              {alert.wasteRisk} RISK
                            </span>
                            <span className="editorial-pill">{alert.assetCategoryLabel}</span>
                            <span className="editorial-pill font-mono">
                              Years: {alert.yearsActive.join(', ')} (Threshold: {alert.antiquityLifespanYears}y)
                            </span>
                          </div>
                          <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                            {alert.mdaName}
                          </div>
                          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '0.18rem' }}>
                            {alert.reason}
                          </div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div className="font-mono tabular-nums" style={{ fontSize: '1rem', fontWeight: 700, color: '#b45309' }}>
                          {formatNairaCompact(alert.totalSpentNaira)}
                        </div>
                        <div className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {alert.recentAllocationsCount} lines · {alert.activeInventoryTally.toLocaleString()} units
                        </div>
                      </div>
                    </button>

                    {isOpen && (
                      <div style={{ borderTop: '1px solid var(--border-subtle)', backgroundColor: '#faf9f6', padding: '0.75rem 1.2rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.45rem' }}>
                          <div style={{ fontSize: '0.73rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                            Underlying Official Appropriation Records (click any line to inspect PDF provenance &amp; citation):
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              pinItem({
                                pinId: `statistical_alert:${alert.latestAcquisitionYear}:${alert.mdaName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 28)}-${alert.assetCategory}`,
                                kind: 'statistical_alert',
                                financialYear: alert.latestAcquisitionYear,
                                projectCode: alert.assetCategory,
                                title: `[${alert.wasteRisk} Lifecycle] ${alert.assetCategoryLabel} (${alert.yearsActive.join(', ')})`,
                                mdaName: alert.mdaName,
                                amountNaira: alert.totalSpentNaira,
                              })
                            }
                            className="editorial-btn"
                            style={{ fontSize: '0.71rem', padding: '0.26rem 0.58rem' }}
                          >
                            {isPinned(`statistical_alert:${alert.latestAcquisitionYear}:${alert.mdaName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 28)}-${alert.assetCategory}`) ? (
                              <Check size={12} color="#059669" />
                            ) : (
                              <BookmarkPlus size={12} />
                            )}
                            {isPinned(`statistical_alert:${alert.latestAcquisitionYear}:${alert.mdaName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 28)}-${alert.assetCategory}`)
                              ? 'Pinned to Casebook'
                              : 'Pin Alert to Casebook'}
                          </button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                          {alert.sampleRecords.map((rec, idx) => (
                            <div
                              key={`${rec.id || rec.projectCode}-${idx}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => openModalRecord(rec)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  openModalRecord(rec);
                                }
                              }}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: '0.75rem',
                                padding: '0.52rem 0.75rem',
                                borderRadius: '6px',
                                border: '1px solid #e2e8f0',
                                backgroundColor: '#ffffff',
                                textAlign: 'left',
                                cursor: 'pointer',
                              }}
                            >
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                                  <span className="font-mono" style={{ fontSize: '0.7rem', fontWeight: 700, color: '#059669' }}>
                                    FY {rec.financialYear} · {rec.projectCode || 'ERGP'}
                                  </span>
                                  <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                    <ExpandableText text={rec.projectName} maxChars={140} />
                                  </span>
                                </div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                                  {rec.sourceFilename || 'Official Schedule'} · p.{rec.page}
                                </div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexShrink: 0 }}>
                                <span className="font-mono tabular-nums" style={{ fontSize: '0.78rem', fontWeight: 700 }}>
                                  {formatNairaCompact(rec.amount)}
                                </span>
                                <ExternalLink size={13} color="#64748b" />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {totalAlertPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', alignItems: 'center', fontSize: '0.78rem' }}>
              <button
                type="button"
                disabled={safeAlertPage <= 1}
                onClick={() => setReplacementPage((p) => Math.max(1, p - 1))}
                className="editorial-btn"
              >
                Previous
              </button>
              <span className="font-mono">
                Page {safeAlertPage} / {totalAlertPages}
              </span>
              <button
                type="button"
                disabled={safeAlertPage >= totalAlertPages}
                onClick={() => setReplacementPage((p) => Math.min(totalAlertPages, p + 1))}
                className="editorial-btn"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 3: VIREMENT & CONTINGENCY TRACKING                           */}
      {/* ================================================================ */}
      {subTab === 'virements' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
          <div className="grid-4-cols">
            {virements.categoryBreakdown.map((cat) => {
              const selected = virementCategory === cat.key;
              return (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => setVirementCategory(selected ? 'ALL' : cat.key)}
                  className="dossier-card dossier-card-interactive"
                  style={{
                    padding: '0.95rem 1.15rem',
                    textAlign: 'left',
                    borderColor: selected ? '#059669' : undefined,
                    backgroundColor: selected ? '#ecfdf5' : undefined,
                  }}
                >
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                    {cat.label}
                  </div>
                  <div className="font-mono tabular-nums" style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.2rem' }}>
                    {formatNairaCompact(cat.totalNaira)}
                  </div>
                  <div className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {cat.count.toLocaleString()} flagged lines {selected ? '· Active Filter' : ''}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="dossier-card" style={{ padding: '1.15rem 1.25rem' }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', fontWeight: 700 }}>
              FY {financialYear} Off-Budget, Service-Wide &amp; Contingency Exposure by Bucket
            </h3>
            <div style={{ width: '100%', height: '220px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={virements.categoryBreakdown} layout="vertical" margin={{ top: 4, right: 20, left: 20, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" tickFormatter={(v) => formatNairaCompact(Number(v))} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="label" width={190} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(val: any) => [formatNairaCompact(Number(val)), 'Allocation']} />
                  <Bar dataKey="totalNaira" fill="#091017" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="dossier-card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '0.9rem 1.2rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>
                  Flagged Virement, Service-Wide &amp; Emergency Lines (FY {financialYear})
                </h3>
                <p style={{ margin: '0.15rem 0 0', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  Showing {filteredVirements.length.toLocaleString()} of {virements.virementRecordCount.toLocaleString()} total matches ({virements.totalNairaFormatted})
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
                {virementCategory !== 'ALL' && (
                  <button type="button" onClick={() => setVirementCategory('ALL')} className="editorial-btn">
                    Clear Bucket
                  </button>
                )}
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    placeholder="Filter title, MDA, code..."
                    value={virementQuery}
                    onChange={(e) => setVirementQuery(e.target.value)}
                    style={{
                      padding: '0.42rem 0.7rem 0.42rem 2rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.78rem',
                      width: '220px',
                    }}
                  />
                  <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)' }} />
                </div>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '0.65rem 1rem' }}>Code</th>
                    <th style={{ padding: '0.65rem 1rem' }}>Line Item Title</th>
                    <th style={{ padding: '0.65rem 1rem' }}>Bucket</th>
                    <th style={{ padding: '0.65rem 1rem' }}>MDA</th>
                    <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Amount (₦)</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedVirements.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        No virement or contingency lines matched for FY {financialYear}.
                      </td>
                    </tr>
                  ) : (
                    pagedVirements.map((rec, idx) => (
                      <tr
                        key={`${rec.id || rec.projectCode}-${idx}`}
                        onClick={() => openModalRecord(rec)}
                        style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                      >
                        <td className="font-mono" style={{ padding: '0.6rem 1rem', fontWeight: 700, color: '#059669' }}>
                          {rec.projectCode || 'ERGP'}
                        </td>
                        <td style={{ padding: '0.6rem 1rem', fontWeight: 600, maxWidth: '380px' }}>
                          <ExpandableText text={rec.projectName} maxChars={150} />
                        </td>
                        <td style={{ padding: '0.6rem 1rem' }}>
                          <span className="editorial-pill" style={{ fontSize: '0.68rem' }}>
                            <ShieldAlert size={11} color="#d97706" />
                            {rec.categoryKey.replace('_', ' ')}
                          </span>
                        </td>
                        <td style={{ padding: '0.6rem 1rem', color: 'var(--text-muted)' }}>{rec.agency}</td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.6rem 1rem', textAlign: 'right', fontWeight: 700 }}>
                          {formatNairaCompact(rec.amount)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {totalVirementPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', alignItems: 'center', padding: '0.75rem 1rem', backgroundColor: '#f8fafc', borderTop: '1px solid #e2e8f0', fontSize: '0.78rem' }}>
                <button
                  type="button"
                  disabled={safeVirementPage <= 1}
                  onClick={() => setVirementPage((p) => Math.max(1, p - 1))}
                  className="editorial-btn"
                >
                  Previous
                </button>
                <span className="font-mono">
                  Page {safeVirementPage} / {totalVirementPages}
                </span>
                <button
                  type="button"
                  disabled={safeVirementPage >= totalVirementPages}
                  onClick={() => setVirementPage((p) => Math.min(totalVirementPages, p + 1))}
                  className="editorial-btn"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 4: COORDINATED DUPLICATE RINGS                               */}
      {/* ================================================================ */}
      {subTab === 'rings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
          <div className="dossier-card" style={{ padding: '1rem 1.25rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700 }}>
                  Coordinated &amp; Cross-MDA Duplicate Rings (FY {financialYear})
                </h3>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                  Identifies verbatim identical allocations split across multiple agencies or repeated identically.
                  Default view suppresses standard COA overhead boilerplate to spotlight anomalous capital rings.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => setCrossMdaOnly((v) => !v)}
                  className={crossMdaOnly ? 'editorial-btn-primary' : 'editorial-btn'}
                >
                  Cross-MDA Rings Only
                </button>
                <button
                  type="button"
                  onClick={() => setIncludeOverhead((v) => !v)}
                  className={includeOverhead ? 'editorial-btn-primary' : 'editorial-btn'}
                >
                  Include Routine Overhead
                </button>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    placeholder="Filter cluster or MDA..."
                    value={ringQuery}
                    onChange={(e) => setRingQuery(e.target.value)}
                    style={{
                      padding: '0.42rem 0.7rem 0.42rem 2rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.78rem',
                      width: '210px',
                    }}
                  />
                  <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)' }} />
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {pagedRings.length === 0 ? (
              <div className="dossier-card" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                No duplicate ring clusters matched the current FY {financialYear} filters.
              </div>
            ) : (
              pagedRings.map((cluster: DuplicateRingCluster) => {
                const isOpen = expandedRingId === cluster.clusterId;
                return (
                  <div key={cluster.clusterId} className="dossier-card" style={{ overflow: 'hidden' }}>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-expanded={isOpen}
                      onClick={() => setExpandedRingId(isOpen ? null : cluster.clusterId)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setExpandedRingId(isOpen ? null : cluster.clusterId);
                        }
                      }}
                      style={{
                        width: '100%',
                        padding: '0.9rem 1.2rem',
                        textAlign: 'left',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '1rem',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem', minWidth: 0, flex: 1 }}>
                        <span style={{ marginTop: '0.2rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.25rem' }}>
                            <span className="editorial-pill font-mono">{cluster.clusterId}</span>
                            {cluster.isCrossMda ? (
                              <span
                                className="editorial-pill font-mono"
                                style={{ backgroundColor: '#fef2f2', color: '#b91c1c', borderColor: '#fecaca' }}
                              >
                                Cross-MDA ({cluster.mdasInvolved.length} Agencies)
                              </span>
                            ) : (
                              <span className="editorial-pill font-mono">Same-MDA Repeat</span>
                            )}
                            {cluster.isBoilerplateOverhead && (
                              <span className="editorial-pill">Routine Overhead</span>
                            )}
                          </div>
                          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                            <ExpandableText text={cluster.normalizedTitle} maxChars={150} />
                          </div>
                          <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: '0.18rem' }}>
                            MDAs: {cluster.mdasInvolved.slice(0, 4).join(' · ')}
                            {cluster.mdasInvolved.length > 4 ? ` (+${cluster.mdasInvolved.length - 4} more)` : ''}
                          </div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div className="font-mono tabular-nums" style={{ fontSize: '0.98rem', fontWeight: 700, color: '#b45309' }}>
                          {cluster.totalNairaFormatted}
                        </div>
                        <div className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {cluster.itemCount} identical lines
                        </div>
                      </div>
                    </div>

                    {isOpen && (
                      <div style={{ borderTop: '1px solid var(--border-subtle)', backgroundColor: '#faf9f6', padding: '0.75rem 1.2rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                          {cluster.sampleRecords.map((rec, idx) => (
                            <button
                              key={`${rec.id || rec.projectCode}-${idx}`}
                              type="button"
                              onClick={() =>
                                openModalRecord({
                                  ...rec,
                                  projectName: rec.projectName || cluster.normalizedTitle,
                                })
                              }
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: '0.75rem',
                                padding: '0.5rem 0.75rem',
                                borderRadius: '6px',
                                border: '1px solid #e2e8f0',
                                backgroundColor: '#ffffff',
                                textAlign: 'left',
                              }}
                            >
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                  <span className="font-mono" style={{ fontSize: '0.7rem', fontWeight: 700, color: '#059669' }}>
                                    {rec.projectCode || 'ERGP'}
                                  </span>
                                  <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>{rec.agency}</span>
                                </div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                  {rec.sourceFilename || 'Official Schedule'} · p.{rec.page}
                                </div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexShrink: 0 }}>
                                <span className="font-mono tabular-nums" style={{ fontSize: '0.78rem', fontWeight: 700 }}>
                                  {formatNairaCompact(rec.amount)}
                                </span>
                                <ExternalLink size={13} color="#64748b" />
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {totalRingPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', alignItems: 'center', fontSize: '0.78rem' }}>
              <button
                type="button"
                disabled={safeRingPage <= 1}
                onClick={() => setRingsPage((p) => Math.max(1, p - 1))}
                className="editorial-btn"
              >
                Previous
              </button>
              <span className="font-mono">
                Page {safeRingPage} / {totalRingPages}
              </span>
              <button
                type="button"
                disabled={safeRingPage >= totalRingPages}
                onClick={() => setRingsPage((p) => Math.min(totalRingPages, p + 1))}
                className="editorial-btn"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 5: GOVSPEND TREASURY CASH, DEC RUSH & BENFORD FORENSICS      */}
      {/* ================================================================ */}
      {subTab === 'govspend' && (
        govForensics && govForensics.status === 'VERIFIED_GOVSPEND_FORENSICS' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
            {(() => {
              const buildGovExportInput = () => {
                const topStaff = (vendorPersonalData?.offNocopoAudit?.topStaffOrIndividualPayees || []).slice(0, 25);
                const opaqueAudit = govForensics.discretionaryAndOpaqueAudit;
                const combinedVouchers = (opaqueAudit?.categories || [])
                  .flatMap((cat) => {
                    const sourceList =
                      !includePayrollInGovspend && cat.commercialTopVouchers
                        ? cat.commercialTopVouchers
                        : cat.topVouchers || [];
                    return sourceList.map((v) => ({
                      paymentDate: v.paymentDate,
                      categoryLabel: OPAQUE_CATEGORY_SHORT[cat.key] || cat.label,
                      organizationName: v.organizationName,
                      beneficiaryName: v.beneficiaryName,
                      amountNaira: v.amountNaira,
                      description: v.description,
                    }));
                  })
                  .sort((a, b) => b.amountNaira - a.amountNaira)
                  .slice(0, 20);

                const activeRollingClusters = includePayrollInGovspend
                  ? govForensics.thresholdSplitting.topRolling7DayClusters
                  : govForensics.thresholdSplitting.topCommercialRolling7DayClusters ||
                    govForensics.thresholdSplitting.topRolling7DayClusters;

                const activeOpaqueTotalVouchers = includePayrollInGovspend
                  ? opaqueAudit?.totalFlaggedVouchers ?? 0
                  : opaqueAudit?.commercialFlaggedVouchers ?? opaqueAudit?.totalFlaggedVouchers ?? 0;
                const activeOpaqueTotalNaira = includePayrollInGovspend
                  ? opaqueAudit?.totalFlaggedNaira ?? 0
                  : opaqueAudit?.commercialFlaggedNaira ?? opaqueAudit?.totalFlaggedNaira ?? 0;

                return {
                  headline: {
                    ...govForensics.headline,
                    personalStaffCount: vendorPersonalData?.headline?.offNocopoStaffCount,
                    personalStaffPaidNaira: vendorPersonalData?.headline?.offNocopoStaffPaidNaira,
                    personalStaffBillionPlusCount: vendorPersonalData?.headline?.offNocopoStaffBillionPlusCount,
                  },
                  payrollFilterMode: includePayrollInGovspend
                    ? ('ALL_VOUCHERS_WITH_PAYROLL' as const)
                    : ('COMMERCIAL_AND_DISCRETIONARY_ONLY' as const),
                  yearlyRush: govForensics.decemberRush.yearlyRush,
                  tiers: govForensics.thresholdSplitting.tiers,
                  topFlaggedMdas: govForensics.benfordCash.topFlaggedMdas.map((m) => {
                    const prof = lookupMdaRiskProfile(crossLedgerCtx, m.organizationName);
                    return {
                      ...m,
                      oaugfQueryCount: prof?.oi,
                      convergenceFlagCount: prof?.cf?.length,
                    };
                  }),
                  personalAccountPayouts: vendorPersonalData?.headline?.offNocopoStaffCount
                    ? {
                        staffCount: vendorPersonalData.headline.offNocopoStaffCount || 0,
                        staffPaidNaira: vendorPersonalData.headline.offNocopoStaffPaidNaira || 0,
                        staffBillionPlusCount: vendorPersonalData.headline.offNocopoStaffBillionPlusCount || 0,
                        unclassifiedCount: vendorPersonalData.headline.offNocopoUnclassifiedCount,
                        unclassifiedPaidNaira: vendorPersonalData.headline.offNocopoUnclassifiedPaidNaira,
                        topPayees: topStaff.map((p) => {
                          const topMda = p.topPayingMdas[0]?.organizationName || 'Federal MDA';
                          const mProf = lookupMdaRiskProfile(crossLedgerCtx, topMda);
                          return {
                            beneficiaryName: p.beneficiaryName,
                            voucherCount: p.voucherCount,
                            totalPaidNaira: p.totalPaidNaira,
                            payingMdaCount: p.payingMdaCount,
                            topMdaName: topMda,
                            purposeTag: p.purposeTag,
                            oaugfQueryCount: mProf?.oi,
                          };
                        }),
                      }
                    : undefined,
                  discretionaryOpaqueAudit: opaqueAudit
                    ? {
                        totalFlaggedVouchers: activeOpaqueTotalVouchers,
                        totalFlaggedNaira: activeOpaqueTotalNaira,
                        categories: opaqueAudit.categories.map((c) => {
                          const activeMdas =
                            !includePayrollInGovspend && c.commercialTopMdas ? c.commercialTopMdas : c.topMdas;
                          const activeTopV =
                            !includePayrollInGovspend && c.commercialTopVouchers
                              ? c.commercialTopVouchers
                              : c.topVouchers;
                          return {
                            key: c.key,
                            label: c.label,
                            voucherCount:
                              !includePayrollInGovspend && typeof c.commercialVoucherCount === 'number'
                                ? c.commercialVoucherCount
                                : c.voucherCount,
                            totalNaira:
                              !includePayrollInGovspend && typeof c.commercialTotalNaira === 'number'
                                ? c.commercialTotalNaira
                                : c.totalNaira,
                            topMdaName: activeMdas[0]?.organizationName,
                            largestBeneficiary: activeTopV[0]?.beneficiaryName,
                            largestVoucherNaira: activeTopV[0]?.amountNaira,
                          };
                        }),
                      }
                    : undefined,
                  topOpaqueVouchers: combinedVouchers,
                  topCommercialRollingClusters: activeRollingClusters.slice(0, 20),
                  permalink: buildCanonicalPermalink({ tab: 'forensics', fsub: 'govspend', year: financialYear }),
                };
              };

              const staffHeadlineCount = vendorPersonalData?.headline?.offNocopoStaffCount ?? 10851;
              const staffHeadlineNaira = vendorPersonalData?.headline?.offNocopoStaffPaidNaira ?? 1_488_270_101_629;
              const staffBillionCount = vendorPersonalData?.headline?.offNocopoStaffBillionPlusCount ?? 235;
              const unclassHeadlineCount = vendorPersonalData?.headline?.offNocopoUnclassifiedCount ?? 4169;
              const unclassHeadlineNaira = vendorPersonalData?.headline?.offNocopoUnclassifiedPaidNaira ?? 1_262_237_826_710;
              const opaqueHeadlineNaira = includePayrollInGovspend
                ? govForensics.discretionaryAndOpaqueAudit?.totalFlaggedNaira ??
                  govForensics.headline.discretionaryOpaqueNaira ??
                  0
                : govForensics.discretionaryAndOpaqueAudit?.commercialFlaggedNaira ??
                  govForensics.headline.commercialOpaqueNaira ??
                  govForensics.discretionaryAndOpaqueAudit?.totalFlaggedNaira ??
                  govForensics.headline.discretionaryOpaqueNaira ??
                  0;
              const opaqueHeadlineCount = includePayrollInGovspend
                ? govForensics.discretionaryAndOpaqueAudit?.totalFlaggedVouchers ??
                  govForensics.headline.discretionaryOpaqueVoucherCount ??
                  0
                : govForensics.discretionaryAndOpaqueAudit?.commercialFlaggedVouchers ??
                  govForensics.headline.commercialOpaqueVoucherCount ??
                  govForensics.discretionaryAndOpaqueAudit?.totalFlaggedVouchers ??
                  govForensics.headline.discretionaryOpaqueVoucherCount ??
                  0;
              const rollingClusterHeadlineCount = includePayrollInGovspend
                ? govForensics.headline.rolling7DayClusterCount
                : govForensics.headline.commercialRolling7DayClusterCount ??
                  govForensics.headline.rolling7DayClusterCount;
              const rollingClusterHeadlineNaira = includePayrollInGovspend
                ? govForensics.headline.rolling7DayClusterNaira
                : govForensics.headline.commercialRolling7DayClusterNaira ??
                  govForensics.headline.rolling7DayClusterNaira;
              const displayedRollingClusters = includePayrollInGovspend
                ? govForensics.thresholdSplitting.topRolling7DayClusters
                : govForensics.thresholdSplitting.topCommercialRolling7DayClusters ||
                  govForensics.thresholdSplitting.topRolling7DayClusters;

              return (
                <>
                  {/* Top Toolbar + Export */}
                  <div className="dossier-card" style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                      <div>
                        <h2 className="font-editorial" style={{ margin: 0, fontSize: '1.12rem', fontWeight: 600 }}>
                          Open Treasury Cash Forensics ({govForensics.headline.minDate} to {govForensics.headline.maxDate})
                        </h2>
                        <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          Audits {govForensics.headline.totalVouchers.toLocaleString()} cash vouchers ({formatNairaCompact(govForensics.headline.totalNaira)}) across December spikes, threshold splitting, Benford anomalies, personal/staff accounts, and opaque vouchers, cross-linked with OAuGF audits.
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          disabled={exportingFormat !== null}
                          onClick={async () => {
                            setExportingFormat('pdf');
                            try {
                              await exportGovspendForensicsPdf(buildGovExportInput());
                            } finally {
                              setExportingFormat(null);
                            }
                          }}
                          className="editorial-btn-primary"
                          style={{ fontSize: '0.74rem' }}
                        >
                          <Download size={13} /> Export Treasury Forensics (PDF)
                        </button>
                        <button
                          type="button"
                          disabled={exportingFormat !== null}
                          onClick={async () => {
                            setExportingFormat('docx');
                            try {
                              await exportGovspendForensicsDocx(buildGovExportInput());
                            } finally {
                              setExportingFormat(null);
                            }
                          }}
                          className="editorial-btn"
                          style={{ fontSize: '0.74rem' }}
                        >
                          <FileSpreadsheet size={13} /> DOCX
                        </button>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '0.6rem',
                        paddingTop: '0.7rem',
                        borderTop: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                        <span className="font-mono" style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                          Disbursement Scope:
                        </span>
                        <button
                          type="button"
                          onClick={() => setIncludePayrollInGovspend(false)}
                          className={!includePayrollInGovspend ? 'editorial-btn-primary' : 'editorial-btn'}
                          style={{ fontSize: '0.72rem', padding: '0.28rem 0.65rem' }}
                        >
                          Commercial &amp; Discretionary Only
                        </button>
                        <button
                          type="button"
                          onClick={() => setIncludePayrollInGovspend(true)}
                          className={includePayrollInGovspend ? 'editorial-btn-primary' : 'editorial-btn'}
                          style={{ fontSize: '0.72rem', padding: '0.28rem 0.65rem' }}
                        >
                          Include IPPIS / Military Payroll
                        </button>
                      </div>

                      {(govForensics.headline.payrollStatutoryVoucherCount || 0) > 0 && (
                        <span
                          className="editorial-pill font-mono"
                          style={{
                            fontSize: '0.68rem',
                            backgroundColor: '#f8fafc',
                            color: '#475569',
                            borderColor: '#cbd5e1',
                          }}
                        >
                          {(govForensics.headline.payrollStatutoryVoucherCount || 0).toLocaleString()} IPPIS / payroll &amp; pension transfers separated ·{' '}
                          {(govForensics.headline.exemptedShortPayrollCount || 0).toLocaleString()} monthly salary tags exempted from opaque alerts
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 6 Cash Forensics KPI Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(195px, 1fr))', gap: '0.85rem' }}>
                    <div className="dossier-card" style={{ padding: '0.95rem 1.05rem' }}>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                        Dec 2019–2025 Surge
                      </div>
                      <div className="font-mono tabular-nums" style={{ fontSize: '1.26rem', fontWeight: 700, color: '#b45309', marginTop: '0.2rem' }}>
                        {formatNairaCompact(govForensics.headline.december2019To2025Naira)}
                      </div>
                      <div className="font-mono" style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: '0.16rem' }}>
                        {govForensics.headline.decemberRushRatio2019To2025 ? `${govForensics.headline.decemberRushRatio2019To2025.toFixed(2)}x Jan–Nov avg` : 'Baseline'} · {govForensics.headline.december2019To2025Vouchers.toLocaleString()} Dec vouchers
                      </div>
                    </div>

                    <div className="dossier-card" style={{ padding: '0.95rem 1.05rem' }}>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                        Near-Threshold Clustering
                      </div>
                      <div className="font-mono tabular-nums" style={{ fontSize: '1.26rem', fontWeight: 700, color: '#b91c1c', marginTop: '0.2rem' }}>
                        {formatNairaCompact(govForensics.headline.nearThresholdNaira)}
                      </div>
                      <div className="font-mono" style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: '0.16rem' }}>
                        {govForensics.headline.nearThresholdVoucherCount.toLocaleString()} vouchers in [90%, 100%) bands
                      </div>
                    </div>

                    <div className="dossier-card" style={{ padding: '0.95rem 1.05rem' }}>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                        7-Day Split Clusters{includePayrollInGovspend ? ' (All)' : ' (Commercial)'}
                      </div>
                      <div className="font-mono tabular-nums" style={{ fontSize: '1.26rem', fontWeight: 700, color: '#0f172a', marginTop: '0.2rem' }}>
                        {rollingClusterHeadlineCount.toLocaleString()}
                      </div>
                      <div className="font-mono" style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: '0.16rem' }}>
                        {formatNairaCompact(rollingClusterHeadlineNaira)}
                        {!includePayrollInGovspend && (govForensics.headline.payrollRolling7DayClusterCount || 0) > 0
                          ? ` · ${(govForensics.headline.payrollRolling7DayClusterCount || 0).toLocaleString()} payroll excluded`
                          : ' (≥3 payouts in 7d)'}
                      </div>
                    </div>

                    <div className="dossier-card" style={{ padding: '0.95rem 1.05rem' }}>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                        Cash Benford MAD (1D / 2D)
                      </div>
                      <div className="font-mono tabular-nums" style={{ fontSize: '1.26rem', fontWeight: 700, color: '#b91c1c', marginTop: '0.2rem' }}>
                        {govForensics.headline.benford1DMad.toFixed(4)} / {govForensics.headline.benford2DMad.toFixed(4)}
                      </div>
                      <div className="font-mono" style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: '0.16rem' }}>
                        {govForensics.headline.benford1DBand} · {govForensics.headline.eligibleBenfordMdaCount} MDAs (N&ge;500)
                      </div>
                    </div>

                    <div className="dossier-card" style={{ padding: '0.95rem 1.05rem', borderColor: '#fecdd3', backgroundColor: '#fff1f2' }}>
                      <div style={{ fontSize: '0.68rem', color: '#9f1239', textTransform: 'uppercase', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.28rem' }}>
                        <Users size={12} /> Personal / Staff Accounts
                      </div>
                      <div className="font-mono tabular-nums" style={{ fontSize: '1.26rem', fontWeight: 800, color: '#991b1b', marginTop: '0.2rem' }}>
                        {formatNairaCompact(staffHeadlineNaira)}
                      </div>
                      <div className="font-mono" style={{ fontSize: '0.67rem', color: '#881337', marginTop: '0.16rem' }}>
                        {staffHeadlineCount.toLocaleString()} payees · {staffBillionCount.toLocaleString()} &ge; ₦1B
                      </div>
                    </div>

                    <div className="dossier-card" style={{ padding: '0.95rem 1.05rem', borderColor: '#fecaca', backgroundColor: '#fef2f2' }}>
                      <div style={{ fontSize: '0.68rem', color: '#991b1b', textTransform: 'uppercase', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.28rem' }}>
                        <EyeOff size={12} /> Opaque &amp; Discretionary Cash
                      </div>
                      <div className="font-mono tabular-nums" style={{ fontSize: '1.26rem', fontWeight: 800, color: '#7f1d1d', marginTop: '0.2rem' }}>
                        {formatNairaCompact(opaqueHeadlineNaira)}
                      </div>
                      <div className="font-mono" style={{ fontSize: '0.67rem', color: '#991b1b', marginTop: '0.16rem' }}>
                        {opaqueHeadlineCount.toLocaleString()} vouchers across {govForensics.discretionaryAndOpaqueAudit?.categories.length || 6} categories
                      </div>
                    </div>
                  </div>

                  {/* Seasonality & Cash Benford Charts */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '1rem' }}>
                    <div className="dossier-card" style={{ padding: '1.1rem 1.25rem' }}>
                      <h3 style={{ margin: '0 0 0.65rem', fontSize: '0.92rem', fontWeight: 700 }}>
                        Monthly Calendar Cash Burn Profile (2019–2025, ₦T)
                      </h3>
                      <div style={{ width: '100%', height: '230px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={govForensics.decemberRush.calendarProfile2019To2025.map((m) => ({
                              label: m.label,
                              totalTn: Number((m.totalNaira / 1e12).toFixed(2)),
                              isDec: m.month === '12',
                            }))}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="label" tick={{ fontSize: 10.5 }} />
                            <YAxis tick={{ fontSize: 10.5 }} unit="T" />
                            <Tooltip formatter={(v: any) => `₦${Number(v).toFixed(2)}T`} />
                            <Bar dataKey="totalTn" name="Disbursed (₦T)" radius={[3, 3, 0, 0]}>
                              {govForensics.decemberRush.calendarProfile2019To2025.map((m) => (
                                <Cell key={m.month} fill={m.month === '12' ? '#b91c1c' : '#059669'} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="dossier-card" style={{ padding: '1.1rem 1.25rem' }}>
                      <h3 style={{ margin: '0 0 0.65rem', fontSize: '0.92rem', fontWeight: 700 }}>
                        Cash Voucher Benford 1st-Digit Audit (&ge; ₦1,000)
                      </h3>
                      <div style={{ width: '100%', height: '230px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={govForensics.benfordCash.firstDigit.digits}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="digit" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 10.5 }} unit="%" />
                            <Tooltip />
                            <Legend wrapperStyle={{ fontSize: '11px' }} />
                            <Bar dataKey="actualPct" name="Observed (%)" fill="#b45309" radius={[3, 3, 0, 0]} />
                            <Line type="monotone" dataKey="expectedPct" name="Benford Expected (%)" stroke="#0f172a" strokeWidth={2} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>

                  {/* Annual Rush Table + Near-Threshold Bands */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: '1rem' }}>
                    <div className="dossier-card" style={{ overflow: 'hidden' }}>
                      <div style={{ padding: '0.85rem 1.1rem', borderBottom: '1px solid var(--border-subtle)' }}>
                        <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700 }}>
                          Annual December Rush Ratios (Partial Boundary Years Flagged)
                        </h3>
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem', textAlign: 'left' }}>
                          <thead>
                            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                              <th style={{ padding: '0.52rem 0.75rem' }}>FY</th>
                              <th style={{ padding: '0.52rem 0.75rem' }}>Coverage</th>
                              <th style={{ padding: '0.52rem 0.75rem', textAlign: 'right' }}>December Cash</th>
                              <th style={{ padding: '0.52rem 0.75rem', textAlign: 'right' }}>Dec %</th>
                              <th style={{ padding: '0.52rem 0.75rem', textAlign: 'right' }}>Rush Ratio</th>
                            </tr>
                          </thead>
                          <tbody>
                            {govForensics.decemberRush.yearlyRush.map((y) => (
                              <tr key={y.financialYear} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                <td className="font-mono" style={{ padding: '0.5rem 0.75rem', fontWeight: 700 }}>{y.financialYear}</td>
                                <td className="font-mono" style={{ padding: '0.5rem 0.75rem' }}>
                                  {y.isPartialYear ? (
                                    <span style={{ fontSize: '0.64rem', fontWeight: 700, padding: '0.1rem 0.35rem', borderRadius: '4px', backgroundColor: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' }}>
                                      PARTIAL ({y.monthsCovered}m)
                                    </span>
                                  ) : (
                                    <span style={{ fontSize: '0.67rem', color: '#047857' }}>Full Year ({y.monthsCovered}m)</span>
                                  )}
                                </td>
                                <td className="font-mono tabular-nums" style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 600 }}>
                                  {formatNairaCompact(y.decemberNaira)}
                                </td>
                                <td className="font-mono tabular-nums" style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>
                                  {y.decemberSharePct.toFixed(1)}%
                                </td>
                                <td className="font-mono tabular-nums" style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 700, color: (y.decemberRushRatio || 0) >= 2.5 ? '#b91c1c' : 'var(--text-primary)' }}>
                                  {y.decemberRushRatio !== null ? `${y.decemberRushRatio.toFixed(2)}x` : 'N/A (Partial)'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="dossier-card" style={{ overflow: 'hidden' }}>
                      <div style={{ padding: '0.85rem 1.1rem', borderBottom: '1px solid var(--border-subtle)' }}>
                        <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700 }}>
                          Near-Threshold Watch Tiers [90%, 100%)
                        </h3>
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem', textAlign: 'left' }}>
                          <thead>
                            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                              <th style={{ padding: '0.52rem 0.75rem' }}>Approval Ceiling</th>
                              <th style={{ padding: '0.52rem 0.75rem', textAlign: 'right' }}>Vouchers</th>
                              <th style={{ padding: '0.52rem 0.75rem', textAlign: 'right' }}>Combined Cash</th>
                              <th style={{ padding: '0.52rem 0.75rem', textAlign: 'right' }}>Share</th>
                            </tr>
                          </thead>
                          <tbody>
                            {govForensics.thresholdSplitting.tiers.map((t) => (
                              <tr key={t.tierLabel} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                <td className="font-mono" style={{ padding: '0.5rem 0.75rem', fontWeight: 700 }}>
                                  Below {t.tierLabel}
                                </td>
                                <td className="font-mono tabular-nums" style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>
                                  {t.voucherCount.toLocaleString()}
                                </td>
                                <td className="font-mono tabular-nums" style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 700, color: '#b45309' }}>
                                  {formatNairaCompact(t.totalNaira)}
                                </td>
                                <td className="font-mono tabular-nums" style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>
                                  {t.shareOfValidCountPct.toFixed(2)}%
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {/* Top Rolling 7-Day Split Clusters + Top Cash-Benford MDAs (with OAuGF & Convergence Cross-Links) */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: '1rem' }}>
                    <div className="dossier-card" style={{ overflow: 'hidden' }}>
                      <div style={{ padding: '0.85rem 1.1rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.45rem' }}>
                        <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700 }}>
                          Top Rolling 7-Day Split-Payment Clusters (&ge; 3 Vouchers)
                        </h3>
                        <span
                          className="font-mono"
                          style={{
                            fontSize: '0.64rem',
                            fontWeight: 700,
                            padding: '0.1rem 0.42rem',
                            borderRadius: '4px',
                            backgroundColor: includePayrollInGovspend ? '#fef3c7' : '#ecfdf5',
                            color: includePayrollInGovspend ? '#92400e' : '#047857',
                            border: `1px solid ${includePayrollInGovspend ? '#fde68a' : '#a7f3d0'}`,
                          }}
                        >
                          {includePayrollInGovspend ? 'Incl. IPPIS / Military Payroll' : 'Commercial & Discretionary Only'}
                        </span>
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', textAlign: 'left' }}>
                          <thead>
                            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                              <th style={{ padding: '0.5rem 0.75rem' }}>Window</th>
                              <th style={{ padding: '0.5rem 0.75rem' }}>MDA &amp; Payee</th>
                              <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>Count</th>
                              <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>Cluster Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {displayedRollingClusters.slice(0, 15).map((cl, i) => (
                              <tr key={`${cl.startDate}-${cl.beneficiaryName}-${i}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                <td className="font-mono" style={{ padding: '0.48rem 0.75rem', whiteSpace: 'nowrap' }}>
                                  {cl.startDate} &rarr; {cl.endDate.slice(5)}
                                </td>
                                <td style={{ padding: '0.48rem 0.75rem' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                                    <span style={{ fontWeight: 700 }}>{cl.beneficiaryName}</span>
                                    {cl.isPayrollOrStatutory && (
                                      <span
                                        className="font-mono"
                                        style={{
                                          fontSize: '0.6rem',
                                          fontWeight: 700,
                                          padding: '0.06rem 0.3rem',
                                          borderRadius: '4px',
                                          backgroundColor: '#f1f5f9',
                                          color: '#475569',
                                          border: '1px solid #cbd5e1',
                                        }}
                                      >
                                        Payroll / Statutory
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{cl.organizationName}</div>
                                  {renderMdaAuditBadges(cl.organizationName)}
                                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                                    <ExpandableText text={cl.sampleDescription} maxChars={100} />
                                  </div>
                                </td>
                                <td className="font-mono tabular-nums" style={{ padding: '0.48rem 0.75rem', textAlign: 'right' }}>
                                  {cl.voucherCount}
                                </td>
                                <td className="font-mono tabular-nums" style={{ padding: '0.48rem 0.75rem', textAlign: 'right', fontWeight: 700, color: '#b45309' }}>
                                  {formatNairaCompact(cl.totalNaira)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="dossier-card" style={{ overflow: 'hidden' }}>
                      <div style={{ padding: '0.85rem 1.1rem', borderBottom: '1px solid var(--border-subtle)' }}>
                        <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700 }}>
                          Top Paying MDAs by Cash Benford MAD (N &ge; 500)
                        </h3>
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', textAlign: 'left' }}>
                          <thead>
                            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                              <th style={{ padding: '0.5rem 0.75rem' }}>Paying MDA &amp; OAuGF Cross-Link</th>
                              <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>Vouchers</th>
                              <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>MAD</th>
                              <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>Peak Digit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {govForensics.benfordCash.topFlaggedMdas.slice(0, 15).map((m) => (
                              <tr key={m.organizationName} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                <td style={{ padding: '0.48rem 0.75rem', fontWeight: 600 }}>
                                  <div>{m.organizationName}</div>
                                  {renderMdaAuditBadges(m.organizationName)}
                                </td>
                                <td className="font-mono tabular-nums" style={{ padding: '0.48rem 0.75rem', textAlign: 'right' }}>
                                  {m.validCount.toLocaleString()}
                                </td>
                                <td className="font-mono tabular-nums" style={{ padding: '0.48rem 0.75rem', textAlign: 'right', fontWeight: 700, color: '#b91c1c' }}>
                                  {m.mad.toFixed(4)}
                                </td>
                                <td className="font-mono tabular-nums" style={{ padding: '0.48rem 0.75rem', textAlign: 'right' }}>
                                  Digit {m.peakDigit} ({m.peakDigitDeviationPct > 0 ? '+' : ''}{m.peakDigitDeviationPct.toFixed(1)}%)
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {/* Interactive Panel A: Personal / Staff Bank Account & Unclassified Treasury Disbursements (₦1.49T + ₦1.26T) */}
                  <div className="dossier-card" style={{ padding: '1.15rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                          <Users size={16} color="#991b1b" />
                          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#991b1b' }}>
                            Personal / Staff Bank Account &amp; Unclassified Treasury Disbursements ({formatNairaCompact(staffHeadlineNaira)} Staff + {formatNairaCompact(unclassHeadlineNaira)} Unclassified)
                          </h3>
                        </div>
                        <p style={{ margin: '0.25rem 0 0', fontSize: '0.77rem', color: 'var(--text-muted)', maxWidth: '78ch' }}>
                          Classifies Open Treasury vouchers paid directly to named individuals or unclassified non-corporate accounts outside public procurement awards — including <strong>{staffBillionCount.toLocaleString()} individual payees</strong> receiving <strong>&ge; ₦1B</strong> cumulative disbursements. Direct individual payouts warrant voucher &amp; imprest-retirement audit verification and do not constitute proof of wrongdoing.
                        </p>
                      </div>
                    </div>

                    {/* Bucket Switch + Search */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.65rem' }}>
                      <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setPersonalBucket('STAFF');
                            setPersonalPurposeFilter('ALL');
                          }}
                          className={personalBucket === 'STAFF' ? 'editorial-btn-primary' : 'editorial-btn'}
                          style={{ fontSize: '0.74rem' }}
                        >
                          Personal / Staff Accounts ({staffHeadlineCount.toLocaleString()} · {formatNairaCompact(staffHeadlineNaira)})
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPersonalBucket('UNCLASSIFIED');
                            setPersonalPurposeFilter('ALL');
                          }}
                          className={personalBucket === 'UNCLASSIFIED' ? 'editorial-btn-primary' : 'editorial-btn'}
                          style={{ fontSize: '0.74rem' }}
                        >
                          Unclassified Payees ({unclassHeadlineCount.toLocaleString()} · {formatNairaCompact(unclassHeadlineNaira)})
                        </button>
                      </div>

                      <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: '340px' }}>
                        <Search size={14} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                        <input
                          type="text"
                          value={personalQuery}
                          onChange={(e) => setPersonalQuery(e.target.value)}
                          placeholder="Search payee, paying MDA, or narration..."
                          aria-label="Search personal or unclassified treasury payees"
                          style={{
                            width: '100%',
                            padding: '0.42rem 0.65rem 0.42rem 2rem',
                            borderRadius: '6px',
                            border: '1px solid var(--border-subtle)',
                            fontSize: '0.77rem',
                          }}
                        />
                      </div>
                    </div>

                    {/* Purpose Tag Filter Pills */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
                      <button
                        type="button"
                        onClick={() => setPersonalPurposeFilter('ALL')}
                        className="font-mono"
                        style={{
                          fontSize: '0.69rem',
                          fontWeight: 700,
                          padding: '0.24rem 0.6rem',
                          borderRadius: '999px',
                          border: `1px solid ${personalPurposeFilter === 'ALL' ? '#0f172a' : '#cbd5e1'}`,
                          backgroundColor: personalPurposeFilter === 'ALL' ? '#0f172a' : '#f8fafc',
                          color: personalPurposeFilter === 'ALL' ? '#ffffff' : '#334155',
                          cursor: 'pointer',
                        }}
                      >
                        All Purposes ({personalSourceRows.length})
                      </button>
                      {Object.entries(STAFF_PURPOSE_META).map(([tag, meta]) => {
                        const cnt = personalPurposeCounts[tag] || 0;
                        if (cnt === 0) return null;
                        const active = personalPurposeFilter === tag;
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => setPersonalPurposeFilter(active ? 'ALL' : tag)}
                            className="font-mono"
                            style={{
                              fontSize: '0.69rem',
                              fontWeight: 700,
                              padding: '0.24rem 0.6rem',
                              borderRadius: '999px',
                              border: `1px solid ${active ? meta.color : meta.border}`,
                              backgroundColor: active ? meta.color : meta.bg,
                              color: active ? '#ffffff' : meta.color,
                              cursor: 'pointer',
                            }}
                          >
                            {meta.label} ({cnt})
                          </button>
                        );
                      })}
                    </div>

                    {!vendorPersonalData ? (
                      <div style={{ padding: '1rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        Loading personal &amp; staff bank account disbursement ledger...
                      </div>
                    ) : (
                      <>
                        <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', textAlign: 'left' }}>
                            <thead>
                              <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                                <th style={{ padding: '0.52rem 0.75rem' }}>Payee &amp; Purpose Tag</th>
                                <th style={{ padding: '0.52rem 0.75rem' }}>Top Paying MDAs &amp; OAuGF Cross-Link</th>
                                <th style={{ padding: '0.52rem 0.75rem' }}>Sample Treasury Narration</th>
                                <th style={{ padding: '0.52rem 0.75rem', textAlign: 'right' }}>Vouchers</th>
                                <th style={{ padding: '0.52rem 0.75rem', textAlign: 'right' }}>Total Disbursed</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pagedPersonalRows.length === 0 ? (
                                <tr>
                                  <td colSpan={5} style={{ padding: '1.1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                                    No payees matched the active purpose filter or search query.
                                  </td>
                                </tr>
                              ) : (
                                pagedPersonalRows.map((row) => {
                                  const tag = row.purposeTag || 'ALLOWANCE_WELFARE_OR_OTHER';
                                  const meta = STAFF_PURPOSE_META[tag] || STAFF_PURPOSE_META.ALLOWANCE_WELFARE_OR_OTHER;
                                  return (
                                    <tr key={`${personalBucket}-${row.beneficiaryName}`} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                                      <td style={{ padding: '0.55rem 0.75rem', minWidth: '185px' }}>
                                        <div style={{ fontWeight: 700, color: '#0f172a' }}>{row.beneficiaryName}</div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.28rem', marginTop: '0.25rem', alignItems: 'center' }}>
                                          <span
                                            className="font-mono"
                                            style={{
                                              fontSize: '0.62rem',
                                              fontWeight: 700,
                                              padding: '0.08rem 0.36rem',
                                              borderRadius: '4px',
                                              backgroundColor: meta.bg,
                                              color: meta.color,
                                              border: `1px solid ${meta.border}`,
                                            }}
                                          >
                                            {meta.label}
                                          </span>
                                          {(row.firstYear || row.lastYear) && (
                                            <span className="font-mono" style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>
                                              {row.firstYear === row.lastYear ? row.firstYear : `${row.firstYear}–${row.lastYear}`}
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                      <td style={{ padding: '0.55rem 0.75rem', minWidth: '215px' }}>
                                        {row.topPayingMdas.map((mda) => (
                                          <div key={`${row.beneficiaryName}-${mda.organizationName}`} style={{ marginBottom: '0.32rem' }}>
                                            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#1e293b' }}>
                                              {mda.organizationName}{' '}
                                              <span className="font-mono" style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>
                                                ({formatNairaCompact(mda.totalNaira)})
                                              </span>
                                            </div>
                                            {renderMdaAuditBadges(mda.organizationName)}
                                          </div>
                                        ))}
                                        {row.payingMdaCount > row.topPayingMdas.length && (
                                          <div className="font-mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                                            +{row.payingMdaCount - row.topPayingMdas.length} additional paying MDA(s)
                                          </div>
                                        )}
                                      </td>
                                      <td style={{ padding: '0.55rem 0.75rem', maxWidth: '290px', color: 'var(--text-secondary)' }}>
                                        <ExpandableText
                                          text={row.sampleDescription?.trim() ? row.sampleDescription : '(Blank / Missing Treasury Narration)'}
                                          maxChars={95}
                                        />
                                      </td>
                                      <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.75rem', textAlign: 'right' }}>
                                        {row.voucherCount.toLocaleString()}
                                      </td>
                                      <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.75rem', textAlign: 'right', fontWeight: 700, color: '#991b1b', whiteSpace: 'nowrap' }}>
                                        {formatNairaCompact(row.totalPaidNaira)}
                                      </td>
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', fontSize: '0.74rem' }}>
                          <span style={{ color: 'var(--text-muted)' }}>
                            Indexing top {personalSourceRows.length.toLocaleString()} highest-value {personalBucket === 'STAFF' ? 'personal/staff payees' : 'unclassified payees'} ({filteredPersonalRows.length} matched).
                          </span>
                          {totalPersonalPages > 1 && (
                            <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
                              <button
                                type="button"
                                disabled={safePersonalPage <= 1}
                                onClick={() => setPersonalPage((p) => Math.max(1, p - 1))}
                                className="editorial-btn"
                              >
                                Previous
                              </button>
                              <span className="font-mono">
                                Page {safePersonalPage} / {totalPersonalPages}
                              </span>
                              <button
                                type="button"
                                disabled={safePersonalPage >= totalPersonalPages}
                                onClick={() => setPersonalPage((p) => Math.min(totalPersonalPages, p + 1))}
                                className="editorial-btn"
                              >
                                Next
                              </button>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Interactive Panel B: Opaque, Blank-Description & Self-Serving Discretionary Cash Audit (₦2.44T) */}
                  {govForensics.discretionaryAndOpaqueAudit && govForensics.discretionaryAndOpaqueAudit.categories.length > 0 && (
                    <div className="dossier-card" style={{ padding: '1.15rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.95rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                            <EyeOff size={16} color="#991b1b" />
                            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#991b1b' }}>
                              Opaque, Blank-Description &amp; Self-Serving Discretionary Cash Explorer ({formatNairaCompact(opaqueHeadlineNaira)} across {opaqueHeadlineCount.toLocaleString()} vouchers)
                            </h3>
                          </div>
                          <p style={{ margin: '0.25rem 0 0', fontSize: '0.77rem', color: 'var(--text-muted)' }}>
                            Click any category card below to isolate verbatim Treasury vouchers, inspect top offending paying MDAs with OAuGF audit links, and search individual beneficiaries.
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => setOpaqueCatKey('ALL')}
                          className={opaqueCatKey === 'ALL' ? 'editorial-btn-primary' : 'editorial-btn'}
                          style={{ fontSize: '0.73rem' }}
                        >
                          All Categories ({govForensics.discretionaryAndOpaqueAudit.categories.length})
                        </button>
                      </div>

                      {/* 6 Interactive Category Cards */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))', gap: '0.65rem' }}>
                        {govForensics.discretionaryAndOpaqueAudit.categories.map((cat) => {
                          const isSelected = opaqueCatKey === cat.key;
                          const catTotalNaira =
                            !includePayrollInGovspend && typeof cat.commercialTotalNaira === 'number'
                              ? cat.commercialTotalNaira
                              : cat.totalNaira;
                          const catVoucherCount =
                            !includePayrollInGovspend && typeof cat.commercialVoucherCount === 'number'
                              ? cat.commercialVoucherCount
                              : cat.voucherCount;
                          const catMdas =
                            !includePayrollInGovspend && cat.commercialTopMdas ? cat.commercialTopMdas : cat.topMdas;
                          const catVouchers =
                            !includePayrollInGovspend && cat.commercialTopVouchers
                              ? cat.commercialTopVouchers
                              : cat.topVouchers;
                          return (
                            <button
                              key={cat.key}
                              type="button"
                              onClick={() => setOpaqueCatKey(isSelected ? 'ALL' : cat.key)}
                              style={{
                                textAlign: 'left',
                                padding: '0.75rem 0.9rem',
                                borderRadius: '8px',
                                border: isSelected ? '2px solid #991b1b' : '1px solid #fecaca',
                                backgroundColor: isSelected ? '#fee2e2' : '#fef2f2',
                                cursor: 'pointer',
                                transition: 'border-color 0.15s ease',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.35rem' }}>
                                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#991b1b' }}>{cat.label}</div>
                                {isSelected && (
                                  <span className="font-mono" style={{ fontSize: '0.6rem', fontWeight: 800, padding: '0.06rem 0.3rem', borderRadius: '4px', backgroundColor: '#991b1b', color: '#ffffff' }}>
                                    ACTIVE
                                  </span>
                                )}
                              </div>
                              <div className="font-mono tabular-nums" style={{ fontSize: '1.12rem', fontWeight: 800, color: '#0f172a', marginTop: '0.2rem' }}>
                                {formatNairaCompact(catTotalNaira)}
                              </div>
                              <div className="font-mono" style={{ fontSize: '0.68rem', color: '#475569', marginTop: '0.1rem' }}>
                                {catVoucherCount.toLocaleString()} vouchers · Top: {catMdas[0]?.organizationName.slice(0, 26) || 'Federal MDA'}
                              </div>
                              {catVouchers[0] && (
                                <div style={{ fontSize: '0.68rem', color: '#7f1d1d', marginTop: '0.3rem', borderTop: '1px dashed #fca5a5', paddingTop: '0.25rem' }}>
                                  Largest: <strong>{catVouchers[0].beneficiaryName.slice(0, 24)}</strong> ({formatNairaCompact(catVouchers[0].amountNaira)})
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {/* Top Offending Paying MDAs Strip */}
                      {activeOpaqueMdas.length > 0 && (
                        <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem 0.9rem' }}>
                          <div className="font-mono" style={{ fontSize: '0.69rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '0.45rem' }}>
                            Top Offending Paying MDAs — {opaqueCatKey === 'ALL' ? 'Combined Opaque & Discretionary Pool' : OPAQUE_CATEGORY_SHORT[opaqueCatKey] || opaqueCatKey}
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.5rem' }}>
                            {activeOpaqueMdas.slice(0, 6).map((m) => (
                              <div key={m.organizationName} style={{ padding: '0.48rem 0.62rem', borderRadius: '6px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0' }}>
                                <div style={{ fontSize: '0.73rem', fontWeight: 700, color: '#0f172a' }}>{m.organizationName}</div>
                                <div className="font-mono" style={{ fontSize: '0.67rem', color: '#991b1b', fontWeight: 700, marginTop: '0.12rem' }}>
                                  {formatNairaCompact(m.totalNaira)} · {m.voucherCount.toLocaleString()} vouchers
                                </div>
                                {renderMdaAuditBadges(m.organizationName)}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Search Bar + Filter Count */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.65rem' }}>
                        <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: '420px' }}>
                          <Search size={14} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                          <input
                            type="text"
                            value={opaqueQuery}
                            onChange={(e) => setOpaqueQuery(e.target.value)}
                            placeholder="Filter verbatim vouchers by MDA, beneficiary, or description..."
                            aria-label="Filter opaque and discretionary cash vouchers"
                            style={{
                              width: '100%',
                              padding: '0.42rem 0.65rem 0.42rem 2rem',
                              borderRadius: '6px',
                              border: '1px solid var(--border-subtle)',
                              fontSize: '0.77rem',
                            }}
                          />
                        </div>
                        <span className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          Showing {filteredOpaqueVouchers.length} verbatim sample vouchers
                        </span>
                      </div>

                      {/* Verbatim Sample Vouchers Table */}
                      <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', textAlign: 'left' }}>
                          <thead>
                            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                              <th style={{ padding: '0.5rem 0.75rem' }}>Date</th>
                              <th style={{ padding: '0.5rem 0.75rem' }}>Category</th>
                              <th style={{ padding: '0.5rem 0.75rem' }}>Paying MDA &amp; Audit Cross-Link</th>
                              <th style={{ padding: '0.5rem 0.75rem' }}>Beneficiary</th>
                              <th style={{ padding: '0.5rem 0.75rem' }}>Verbatim Treasury Description</th>
                              <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pagedOpaqueVouchers.length === 0 ? (
                              <tr>
                                <td colSpan={6} style={{ padding: '1.1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                                  No sample vouchers matched your active category or keyword query.
                                </td>
                              </tr>
                            ) : (
                              pagedOpaqueVouchers.map((v, idx) => (
                                <tr key={`${v.categoryKey}-${v.paymentDate}-${v.beneficiaryName}-${idx}`} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                                  <td className="font-mono" style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap' }}>
                                    {v.paymentDate}
                                  </td>
                                  <td style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap' }}>
                                    <span
                                      className="font-mono"
                                      style={{
                                        fontSize: '0.62rem',
                                        fontWeight: 700,
                                        padding: '0.08rem 0.36rem',
                                        borderRadius: '4px',
                                        backgroundColor: '#fef2f2',
                                        color: '#991b1b',
                                        border: '1px solid #fecaca',
                                      }}
                                    >
                                      {v.categoryLabel}
                                    </span>
                                  </td>
                                  <td style={{ padding: '0.5rem 0.75rem', minWidth: '185px' }}>
                                    <div style={{ fontWeight: 600, color: '#0f172a' }}>{v.organizationName}</div>
                                    {renderMdaAuditBadges(v.organizationName)}
                                  </td>
                                  <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600, minWidth: '150px' }}>
                                    <div>{v.beneficiaryName}</div>
                                    {v.isPayrollOrStatutory && (
                                      <span
                                        className="font-mono"
                                        style={{
                                          display: 'inline-block',
                                          marginTop: '0.15rem',
                                          fontSize: '0.6rem',
                                          fontWeight: 700,
                                          padding: '0.05rem 0.28rem',
                                          borderRadius: '4px',
                                          backgroundColor: '#f1f5f9',
                                          color: '#475569',
                                          border: '1px solid #cbd5e1',
                                        }}
                                      >
                                        Payroll / Statutory
                                      </span>
                                    )}
                                  </td>
                                  <td style={{ padding: '0.5rem 0.75rem', maxWidth: '280px', color: 'var(--text-secondary)' }}>
                                    <ExpandableText
                                      text={v.description?.trim() ? v.description : '(Blank / Missing Description)'}
                                      maxChars={105}
                                    />
                                  </td>
                                  <td className="font-mono tabular-nums" style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 700, color: '#b91c1c', whiteSpace: 'nowrap' }}>
                                    {formatNairaCompact(v.amountNaira)}
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>

                      {totalOpaquePages > 1 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', fontSize: '0.74rem' }}>
                          <span style={{ color: 'var(--text-muted)' }}>
                            Previewing highest-value verbatim vouchers across {opaqueHeadlineCount.toLocaleString()} {includePayrollInGovspend ? 'total' : 'commercial & discretionary'} flagged records ({formatNairaCompact(opaqueHeadlineNaira)}).
                          </span>
                          <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
                            <button
                              type="button"
                              disabled={safeOpaquePage <= 1}
                              onClick={() => setOpaquePage((p) => Math.max(1, p - 1))}
                              className="editorial-btn"
                            >
                              Previous
                            </button>
                            <span className="font-mono">
                              Page {safeOpaquePage} / {totalOpaquePages}
                            </span>
                            <button
                              type="button"
                              disabled={safeOpaquePage >= totalOpaquePages}
                              onClick={() => setOpaquePage((p) => Math.min(totalOpaquePages, p + 1))}
                              className="editorial-btn"
                            >
                              Next
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        ) : (
          <div className="dossier-card" style={{ padding: '1.6rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
            GovSpend Treasury Cash forensics summary is currently unavailable.
          </div>
        )
      )}
    </div>
  );
};
