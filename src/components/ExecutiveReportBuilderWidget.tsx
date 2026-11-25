import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { apiUrl, datasetUrl } from '../services/apiClient';
import {
  FileText,
  Printer,
  Copy,
  Check,
  Download,
  Search,
  RotateCcw,
  SlidersHorizontal,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Landmark,
  ShieldAlert,
  Layers,
  History,
  Building2,
  TrendingUp,
  Scale,
} from 'lucide-react';
import { useBudgetDatabase } from '../context/BudgetDatabaseContext';
import {
  applyRules,
  buildCompoundFlaggedProjects,
  type CompoundFlaggedProject,
  type EvidenceItem,
  type RawProject,
} from '../utils/ruleEngine';
import { detectDuplicates, DuplicateCluster } from '../utils/duplicateDetector';
import {
  loadEvidenceEngineAllYears,
  type EvidenceEngineAllYearsPayload,
} from '../utils/evidenceEngineV3';
import { getMacroForYear } from '../data/historicalMacroData';
import { getPresidentForYear } from '../data/presidentialTerms';
import { ExpandableText } from './ExpandableText';
import {
  ReportTemplate,
  PrintOrientation,
  ReportSectionOptions,
  CleanProject,
  RecurringLineageItem,
  DebtSnapshotSummary,
  MacroContextSummary,
  YoYComparisonSummary,
  SixLedgerAccountabilitySummary,
  ReportPayload,
  TEMPLATE_META,
  formatNairaCompact,
  formatNairaExact,
  printReportDocument,
  buildClipboardSummaryText,
} from '../utils/reportExporter';
import {
  exportExecutiveReportPdf,
  exportExecutiveReportDocx,
} from '../utils/documentExporter';

interface Props {
  financialYear: number;
  extractedProjects?: any[];
  registryLength?: number;
  previousYearProjects?: any[];
  evidenceAllYears?: EvidenceEngineAllYearsPayload | null;
}

type SortField = 'amount' | 'projectName' | 'agency' | 'page';
type SortDirection = 'asc' | 'desc';

const MDA_ROLLUP_RE = /^[0-5]\d{8,9}$/;
const COA_RECURRING_RE = /^(21|22)\d{6}$/;

let cachedDebtRows: any[] | null = null;
let cachedLineages: RecurringLineageItem[] | null = null;
interface SixLedgerBundleCache {
  oaugf: any | null;
  billDiff: any | null;
  govspend: any | null;
  vendorNetwork: any | null;
  convergence: any | null;
}
let cachedSixLedgerBundle: SixLedgerBundleCache | null = null;

function isNonCapitalLineage(lin: RecurringLineageItem): boolean {
  const code = String(lin.projectCode || '').trim();
  if (MDA_ROLLUP_RE.test(code) || COA_RECURRING_RE.test(code)) return true;
  const low = (lin.canonicalTitle || '').toLowerCase();
  if (
    low.startsWith('interest - ') ||
    low.includes('public debt') ||
    low === 'pension' ||
    low === 'service wide vote' ||
    low.includes('contributory pension')
  ) {
    return true;
  }
  return false;
}

export const ExecutiveReportBuilderWidget: React.FC<Props> = ({
  financialYear,
  extractedProjects = [],
  registryLength = 0,
  previousYearProjects = [],
  evidenceAllYears = null,
}) => {
  const { records } = useBudgetDatabase();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Template & Filter Controls
  const [template, setTemplate] = useState<ReportTemplate>('executive_brief');
  const [selectedSector, setSelectedSector] = useState<string>('ALL');
  const [minAmount, setMinAmount] = useState<number>(0);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedSeverities, setSelectedSeverities] = useState<Set<'high' | 'medium' | 'low'>>(
    () => new Set(['high', 'medium', 'low'])
  );
  const [capitalOnlyLineages, setCapitalOnlyLineages] = useState<boolean>(true);
  const [sortField, setSortField] = useState<SortField>('amount');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [tableRowLimit, setTableRowLimit] = useState<number>(50);
  const [expandedFindingId, setExpandedFindingId] = useState<string | null>(null);

  // Print & Dossier Customization Controls
  const [orientation, setOrientation] = useState<PrintOrientation>('portrait');
  const [customTitle, setCustomTitle] = useState<string>('');
  const [preparedBy, setPreparedBy] = useState<string>('BudgetLens Civic Observatory Desk');
  const [analystNotes, setAnalystNotes] = useState<string>('');
  const [sections, setSections] = useState<ReportSectionOptions>({
    includeMacroContext: true,
    includeDebtSnapshot: true,
    includeYoY: true,
    includeCivicImpact: true,
    includeCitations: true,
    includeAnalystNotes: true,
  });

  // Feedback States
  const [copiedBrief, setCopiedBrief] = useState<boolean>(false);
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  // Hydrated Multi-Dataset States
  const [yearStats, setYearStats] = useState<any | null>(null);
  const [priorYearStats, setPriorYearStats] = useState<any | null>(null);
  const [narrativeData, setNarrativeData] = useState<any | null>(null);
  const [debtSnapshot, setDebtSnapshot] = useState<DebtSnapshotSummary | null>(null);
  const [lineagesData, setLineagesData] = useState<RecurringLineageItem[]>(cachedLineages || []);
  const [lineagesLoading, setLineagesLoading] = useState<boolean>(false);
  const [lineagesError, setLineagesError] = useState<string | null>(null);
  const [evidenceAllYearsState, setEvidenceAllYearsState] = useState<EvidenceEngineAllYearsPayload | null>(
    evidenceAllYears
  );
  const [sixLedgerBundle, setSixLedgerBundle] = useState<SixLedgerBundleCache | null>(cachedSixLedgerBundle);
  const [sixLedgerLoading, setSixLedgerLoading] = useState<boolean>(false);

  useEffect(() => {
    if (evidenceAllYears) {
      setEvidenceAllYearsState(evidenceAllYears);
      return;
    }
    let active = true;
    loadEvidenceEngineAllYears()
      .then((payload) => {
        if (active && payload) setEvidenceAllYearsState(payload);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [evidenceAllYears]);

  useEffect(() => {
    if (template !== 'six_ledger_brief') return;
    if (cachedSixLedgerBundle) {
      setSixLedgerBundle(cachedSixLedgerBundle);
      return;
    }
    let active = true;
    setSixLedgerLoading(true);
    Promise.all([
      fetch(datasetUrl('/datasets/oaugf_audit_index.json'), { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(datasetUrl('/datasets/bill_act_diffs/index.json'), { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(datasetUrl('/datasets/govspend_forensics.json'), { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(datasetUrl('/datasets/vendor_network_index.json'), { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(datasetUrl('/datasets/red_flag_convergence_index.json'), { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([oaugf, billDiff, govspend, vendorNetwork, convergence]) => {
        if (!active) return;
        const bundle: SixLedgerBundleCache = { oaugf, billDiff, govspend, vendorNetwork, convergence };
        cachedSixLedgerBundle = bundle;
        setSixLedgerBundle(bundle);
        setSixLedgerLoading(false);
      })
      .catch(() => {
        if (active) setSixLedgerLoading(false);
      });
    return () => {
      active = false;
    };
  }, [template]);

  // Hydrate Year Statistics, Prior Year Statistics, Narrative, and DMO Debt Profile
  useEffect(() => {
    let active = true;

    fetch(datasetUrl(`/datasets/${financialYear}/statistics.json`), { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active) setYearStats(data);
      })
      .catch(() => {
        if (active) setYearStats(null);
      });

    if (financialYear > 1999) {
      fetch(datasetUrl(`/datasets/${financialYear - 1}/statistics.json`), { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (active) setPriorYearStats(data);
        })
        .catch(() => {
          if (active) setPriorYearStats(null);
        });
    } else {
      setPriorYearStats(null);
    }

    fetch(datasetUrl(`/datasets/narratives/${financialYear}.json`), { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active) setNarrativeData(data);
      })
      .catch(() => {
        if (active) setNarrativeData(null);
      });

    const resolveDebtForYear = (rows: any[]) => {
      const exact = rows.find((r) => r.financialYear === financialYear && r.totalDebtNairaM !== null);
      if (exact) {
        return { ...exact, isExactYearMatch: true } as DebtSnapshotSummary;
      }
      const prior = [...rows]
        .filter((r) => r.financialYear <= financialYear && r.totalDebtNairaM !== null)
        .sort((a, b) => b.financialYear - a.financialYear)[0];
      if (!prior) return null;
      return { ...prior, isExactYearMatch: false } as DebtSnapshotSummary;
    };

    if (cachedDebtRows) {
      setDebtSnapshot(resolveDebtForYear(cachedDebtRows));
    } else {
      fetch(datasetUrl('/datasets/debt_profile.json'), { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!active || !data?.yearlyDebt) return;
          cachedDebtRows = data.yearlyDebt;
          setDebtSnapshot(resolveDebtForYear(data.yearlyDebt));
        })
        .catch(() => {
          if (active) setDebtSnapshot(null);
        });
    }

    return () => {
      active = false;
    };
  }, [financialYear]);

  // Lazy-load multi-year recurring lineages when Recurring Lineage template is selected
  useEffect(() => {
    if (template !== 'recurring_lineage') return;
    if (cachedLineages && cachedLineages.length > 0) {
      setLineagesData(cachedLineages);
      return;
    }

    let active = true;
    setLineagesLoading(true);
    setLineagesError(null);

    fetch(apiUrl('/api/v1/forensics/lineages?limit=200'), { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!active) return;
        const parsed: RecurringLineageItem[] = Array.isArray(data) ? data : data?.lineages || [];
        cachedLineages = parsed;
        setLineagesData(parsed);
        setLineagesLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLineagesError('Unable to load multi-year recurring lineage dataset.');
        setLineagesLoading(false);
      });

    return () => {
      active = false;
    };
  }, [template]);

  // Clean Normalization + Strict MDA Summary Rollup Exclusion
  const { cleanProjects, excludedRollupsCount } = useMemo(() => {
    const sourceRows: CleanProject[] =
      extractedProjects && extractedProjects.length > 0
        ? extractedProjects.map((p, idx) => ({
            id: String(p.id || `EXT-${financialYear}-${idx}`),
            projectCode: String(p.projectCode || '').trim(),
            projectName: String(p.projectName || 'Untitled Appropriation Line Item').trim(),
            financialYear: Number(p.financialYear || financialYear),
            amount: Number(p.amount || 0),
            projectType: String(p.projectType || 'CAPITAL'),
            page: Number(p.page || 0),
            sector: String(p.sector || 'General Administration').trim(),
            agency: String(p.agency || 'Federal MDA').trim(),
            state: String(p.state || 'FCT / National').trim(),
          }))
        : records.map((r) => ({
            id: r.recordIdentity.id,
            projectCode: String(r.recordIdentity.projectCode || '').trim(),
            projectName: String(r.recordIdentity.verbatimProjectName || '').trim(),
            financialYear: r.recordIdentity.financialYear || financialYear,
            amount: Number(r.recordIdentity.amountNaira || 0),
            projectType: r.recordIdentity.spendingType || 'CAPITAL',
            page: Number(r.sourceProvenance.pdfPage || 0),
            sector: String(r.mdaGovernanceTaxonomy.sector || 'General Administration').trim(),
            agency: String(r.mdaGovernanceTaxonomy.mdaName || 'Federal MDA').trim(),
            state: String(r.geographicTaxonomy.state || 'FCT / National').trim(),
          }));

    let excluded = 0;
    const cleaned: CleanProject[] = [];
    for (const row of sourceRows) {
      if (row.projectCode && MDA_ROLLUP_RE.test(row.projectCode)) {
        excluded += 1;
        continue;
      }
      cleaned.push(row);
    }
    return { cleanProjects: cleaned, excludedRollupsCount: excluded };
  }, [extractedProjects, records, financialYear]);

  // Available Sectors sorted alphabetically
  const availableSectors = useMemo(() => {
    const set = new Set<string>();
    cleanProjects.forEach((p) => {
      if (p.sector) set.add(p.sector);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [cleanProjects]);

  // Filtered + Sorted Clean Line Items
  const filteredProjects = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const list = cleanProjects.filter((p) => {
      if (selectedSector !== 'ALL' && p.sector !== selectedSector) return false;
      if (minAmount > 0 && p.amount < minAmount) return false;
      if (q) {
        const hay = `${p.projectName} ${p.agency} ${p.projectCode} ${p.sector}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const mult = sortDirection === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortField === 'amount') return (a.amount - b.amount) * mult;
      if (sortField === 'page') return (a.page - b.page) * mult;
      if (sortField === 'agency') return a.agency.localeCompare(b.agency) * mult;
      return a.projectName.localeCompare(b.projectName) * mult;
    });
  }, [cleanProjects, selectedSector, minAmount, searchTerm, sortField, sortDirection]);

  // Live Evidence Engine v3.0 Findings (22 rules including 6 Cross-Ledger rules) over Active Scope
  const ruleFindings = useMemo<EvidenceItem[]>(() => {
    if (filteredProjects.length === 0) return [];
    const rawInputs: RawProject[] = filteredProjects.map((p) => ({
      id: p.id,
      projectCode: p.projectCode,
      projectName: p.projectName,
      financialYear: p.financialYear,
      amount: p.amount,
      projectType: p.projectType,
      page: p.page,
      sector: p.sector,
      agency: p.agency,
    }));
    const rawFindings = applyRules(rawInputs, evidenceAllYearsState?.crossLedgerContext || null);
    return rawFindings.filter((f) => selectedSeverities.has(f.severity));
  }, [filteredProjects, selectedSeverities, evidenceAllYearsState]);

  const compoundProjects = useMemo<CompoundFlaggedProject[]>(
    () => buildCompoundFlaggedProjects(ruleFindings),
    [ruleFindings]
  );

  const crossLedgerFindingsCount = useMemo(
    () => ruleFindings.filter((f) => f.ledgerScope === 'CROSS_LEDGER').length,
    [ruleFindings]
  );

  // Real Duplicate & Disguised-Rewording Clusters over Active Scope
  const duplicateClusters = useMemo<DuplicateCluster[]>(() => {
    if (filteredProjects.length === 0) return [];
    return detectDuplicates(filteredProjects);
  }, [filteredProjects]);

  // Real Multi-Year Lineages active in Selected Fiscal Year
  const filteredLineages = useMemo<RecurringLineageItem[]>(() => {
    if (lineagesData.length === 0) return [];
    const q = searchTerm.trim().toLowerCase();
    const matched = lineagesData.filter((lin) => {
      if (!Array.isArray(lin.yearsAppeared) || !lin.yearsAppeared.includes(financialYear)) return false;
      if (capitalOnlyLineages && isNonCapitalLineage(lin)) return false;
      const fyInst = lin.instances.find((inst) => (inst.financialYear ?? inst.year) === financialYear);
      const fyAmt = fyInst?.amount || 0;
      if (minAmount > 0 && fyAmt < minAmount && lin.cumulativeAllocation < minAmount) return false;
      if (q) {
        const hay = `${lin.canonicalTitle} ${lin.agency} ${lin.projectCode}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return [...matched].sort((a, b) => {
      const aAmt = a.instances.find((i) => (i.financialYear ?? i.year) === financialYear)?.amount || 0;
      const bAmt = b.instances.find((i) => (i.financialYear ?? i.year) === financialYear)?.amount || 0;
      return bAmt - aAmt || b.cumulativeAllocation - a.cumulativeAllocation;
    });
  }, [lineagesData, financialYear, capitalOnlyLineages, minAmount, searchTerm]);

  // Real Aggregated Stats
  const stats = useMemo(() => {
    const count = filteredProjects.length;
    const totalAllocated = filteredProjects.reduce((sum, p) => sum + (p.amount || 0), 0);
    const avgAmount = count > 0 ? totalAllocated / count : 0;

    let medianAmount = 0;
    if (count > 0) {
      const sortedAmounts = filteredProjects.map((p) => p.amount).sort((a, b) => a - b);
      const mid = Math.floor(sortedAmounts.length / 2);
      medianAmount =
        sortedAmounts.length % 2 === 0
          ? (sortedAmounts[mid - 1] + sortedAmounts[mid]) / 2
          : sortedAmounts[mid];
    }

    let maxItem: CleanProject | null = null;
    const sectorMap = new Map<string, { totalAmount: number; count: number }>();
    const agencyMap = new Map<string, { totalAmount: number; count: number }>();

    for (const p of filteredProjects) {
      if (!maxItem || p.amount > maxItem.amount) maxItem = p;

      const sKey = p.sector || 'General Administration';
      const sPrev = sectorMap.get(sKey) || { totalAmount: 0, count: 0 };
      sPrev.totalAmount += p.amount;
      sPrev.count += 1;
      sectorMap.set(sKey, sPrev);

      const aKey = p.agency || 'Federal MDA';
      const aPrev = agencyMap.get(aKey) || { totalAmount: 0, count: 0 };
      aPrev.totalAmount += p.amount;
      aPrev.count += 1;
      agencyMap.set(aKey, aPrev);
    }

    const sectorBreakdown = Array.from(sectorMap.entries())
      .map(([sector, d]) => ({
        sector,
        totalAmount: d.totalAmount,
        sharePct: totalAllocated > 0 ? (d.totalAmount / totalAllocated) * 100 : 0,
        count: d.count,
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount);

    const topAgencies = Array.from(agencyMap.entries())
      .map(([agency, d]) => ({
        agency,
        totalAmount: d.totalAmount,
        sharePct: totalAllocated > 0 ? (d.totalAmount / totalAllocated) * 100 : 0,
        count: d.count,
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount);

    let highSeverityCount = 0;
    let mediumSeverityCount = 0;
    let lowSeverityCount = 0;
    const seenFindingItems = new Set<string>();
    let flaggedTotalAmount = 0;

    for (const f of ruleFindings) {
      if (f.severity === 'high') highSeverityCount += 1;
      else if (f.severity === 'medium') mediumSeverityCount += 1;
      else lowSeverityCount += 1;

      const uniqueItemKey = `${f.projectCode}_${f.page}_${f.amount}`;
      if (!seenFindingItems.has(uniqueItemKey)) {
        seenFindingItems.add(uniqueItemKey);
        flaggedTotalAmount += f.amount;
      }
    }

    const duplicateTotalAmount = duplicateClusters.reduce((s, c) => s + c.totalAmount, 0);
    const duplicateItemCount = duplicateClusters.reduce((s, c) => s + c.count, 0);

    return {
      count,
      totalAllocated,
      avgAmount,
      medianAmount,
      maxItem,
      sectorBreakdown,
      topAgencies,
      highSeverityCount,
      mediumSeverityCount,
      lowSeverityCount,
      flaggedTotalAmount,
      duplicateClusterCount: duplicateClusters.length,
      duplicateTotalAmount,
      duplicateItemCount,
    };
  }, [filteredProjects, ruleFindings, duplicateClusters]);

  // Verified Inflation-Scaled Civic Infrastructure Equivalents
  const civicEquivalents = useMemo(() => {
    const inflationFactor = Math.max(0.08, getMacroForYear(financialYear).assetInflationFrom2023);
    const annualMinWage =
      financialYear >= 2024 ? 840_000 : financialYear >= 2019 ? 360_000 : financialYear >= 2011 ? 216_000 : 90_000;

    const unitCosts = {
      phc: Math.round(25_000_000 * inflationFactor),
      classroomBlock: Math.round(15_000_000 * inflationFactor),
      solarBorehole: Math.round(3_500_000 * inflationFactor),
      annualSchoolMeal: Math.round(72_000 * inflationFactor),
      annualMinWage,
    };

    const basis = stats.totalAllocated;
    return {
      inflationFactor,
      unitCosts,
      equivalents: {
        phcs: Math.floor(basis / unitCosts.phc),
        classroomBlocks: Math.floor(basis / unitCosts.classroomBlock),
        solarBoreholes: Math.floor(basis / unitCosts.solarBorehole),
        schoolMealsFed: Math.floor(basis / unitCosts.annualSchoolMeal),
        annualMinWages: Math.floor(basis / unitCosts.annualMinWage),
      },
    };
  }, [financialYear, stats.totalAllocated]);

  // Enacted Macro Context + Administration Metadata
  const macroContext = useMemo<MacroContextSummary>(() => {
    const fallbackMacro = getMacroForYear(financialYear);
    const nMacro = narrativeData?.macroeconomicFramework || {};
    return {
      officialTotalBudget: yearStats?.officialTotalBudget || fallbackMacro.officialTotalBudget,
      totalCapitalBudget: yearStats?.totalCapitalBudget || fallbackMacro.totalCapitalBudget,
      recurrentNonDebtTotal: yearStats?.recurrentNonDebtTotal || fallbackMacro.recurrentNonDebtTotal,
      debtService: yearStats?.debtService || fallbackMacro.debtService,
      statutoryTransfers: yearStats?.statutoryTransfers || fallbackMacro.statutoryTransfers,
      totalCapitalExtracted: yearStats?.totalCapitalAmount || cleanProjects.reduce((s, p) => s + p.amount, 0),
      totalCapitalCount: yearStats?.totalCapitalProjects || cleanProjects.length,
      budgetTheme: narrativeData?.budgetTheme || `FY${financialYear} Federal Appropriation Act`,
      benchmarkOilPriceUSD: nMacro.benchmarkOilPriceUSD,
      dailyOilProductionMBPD: nMacro.dailyOilProductionMBPD,
      exchangeRateNairaPerUSD: nMacro.exchangeRateNairaPerUSD,
      projectedGdpGrowthPercent: nMacro.projectedGdpGrowthPercent,
      inflationRatePercent: nMacro.inflationRatePercent,
      executiveSummary: narrativeData?.executiveSummary,
      policyPriorities: Array.isArray(narrativeData?.policyPriorities) ? narrativeData.policyPriorities : [],
      sourcesAnalyzed: Array.isArray(narrativeData?.sourcesAnalyzed) ? narrativeData.sourcesAnalyzed : [],
    };
  }, [financialYear, yearStats, narrativeData, cleanProjects]);

  // Year-over-Year Comparison (live prior stats + optional previousYearProjects prop)
  const yoyComparison = useMemo<YoYComparisonSummary | null>(() => {
    if (financialYear <= 1999) return null;
    const priorMacro = getMacroForYear(financialYear - 1);
    const priorOfficialTotal = priorYearStats?.officialTotalBudget || priorMacro.officialTotalBudget;
    const currentOfficialTotal = macroContext.officialTotalBudget;

    let priorExtractedTotal = priorYearStats?.totalCapitalAmount || 0;
    if (previousYearProjects && previousYearProjects.length > 0) {
      priorExtractedTotal = previousYearProjects.reduce((sum, p) => {
        const code = String(p.projectCode || '').trim();
        if (MDA_ROLLUP_RE.test(code)) return sum;
        return sum + Number(p.amount || 0);
      }, 0);
    }

    const currentExtractedTotal = macroContext.totalCapitalExtracted;
    const officialDelta = currentOfficialTotal - priorOfficialTotal;
    const extractedDelta = currentExtractedTotal - priorExtractedTotal;

    return {
      priorYear: financialYear - 1,
      priorOfficialTotal,
      currentOfficialTotal,
      officialDelta,
      officialDeltaPct: priorOfficialTotal > 0 ? (officialDelta / priorOfficialTotal) * 100 : 0,
      priorExtractedTotal,
      currentExtractedTotal,
      extractedDelta,
      extractedDeltaPct: priorExtractedTotal > 0 ? (extractedDelta / priorExtractedTotal) * 100 : 0,
    };
  }, [financialYear, priorYearStats, macroContext, previousYearProjects]);

  const president = getPresidentForYear(financialYear);
  const resolvedTitle =
    customTitle.trim() || `Nigeria FY${financialYear} Federal Budget ${TEMPLATE_META[template].label}`;

  const sixLedgerSummary = useMemo<SixLedgerAccountabilitySummary>(() => {
    const eeSum = evidenceAllYearsState?.summary;
    const oaugfHead = sixLedgerBundle?.oaugf?.headline;
    const catCountsObj: Record<string, number> = oaugfHead?.categoryCounts || {};
    const topCategories = Object.entries(catCountsObj)
      .map(([category, count]) => ({ category, count: Number(count) || 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 7);

    const diffCycles: any[] = sixLedgerBundle?.billDiff?.cycles || [];
    const activeCycleRaw = diffCycles.find((c) => Number(c.financialYear) === financialYear) || null;
    const lineItemCycles = diffCycles.filter((c) => c.comparisonScope === 'LINE_ITEM_SCHEDULE');
    const allCyclesInsertionsCount = lineItemCycles.reduce((s, c) => s + (Number(c.insertionsCount) || 0), 0);
    const allCyclesInsertionsNaira = lineItemCycles.reduce((s, c) => s + (Number(c.insertionsTotalNaira) || 0), 0);
    const allCyclesInflatedNaira = lineItemCycles.reduce((s, c) => s + (Number(c.inflatedTotalNaira) || 0), 0);

    const govHead = sixLedgerBundle?.govspend?.headline;
    const opaqueHead = sixLedgerBundle?.govspend?.discretionaryAndOpaqueAudit;
    const vnHead = sixLedgerBundle?.vendorNetwork?.headline;

    const topCompFromLive = compoundProjects.slice(0, 25).map((cp) => ({
      projectCode: cp.projectCode,
      projectName: cp.projectName,
      agency: cp.agency,
      amount: cp.amount,
      page: cp.page,
      ruleCount: cp.ruleCount,
      crossLedgerRuleCount: cp.crossLedgerRuleCount,
      compoundRiskScore: cp.compoundRiskScore,
      ruleNames: cp.triggeredRules.map((r) => r.ruleName),
      paidOnPaper: cp.crossLedgerBadges.paidOnPaper,
      billInserted: cp.crossLedgerBadges.billInsertedOrInflated,
      mdaOaugfIssues: cp.crossLedgerBadges.mdaOaugfIssuesCount,
      mdaGrade: cp.crossLedgerBadges.mdaIntegrityGrade,
    }));

    const topCompFallback = (evidenceAllYearsState?.topCompoundProjectsAllTime || [])
      .filter((c) => c.financialYear === financialYear)
      .slice(0, 25)
      .map((c) => ({
        projectCode: c.projectCode,
        projectName: c.projectName,
        agency: c.agency,
        amount: c.amount,
        page: c.page,
        ruleCount: c.ruleCount,
        crossLedgerRuleCount: c.crossLedgerCount,
        compoundRiskScore: c.compoundRiskScore,
        ruleNames: c.ruleIds,
        paidOnPaper: c.paidOnPaper,
        billInserted: Boolean(c.billInsertionStatus),
        mdaOaugfIssues: c.mdaOaugfIssues,
        mdaGrade: c.mdaGrade,
      }));

    const topConvergentMdas = (sixLedgerBundle?.convergence?.mdas || []).slice(0, 20).map((m: any) => ({
      mdaName: String(m.mdaName || ''),
      flagCount: Number(m.flagCount) || 0,
      flags: Array.isArray(m.flags) ? m.flags : [],
      grade: String(m.grade || 'N/A'),
      compositeScore: typeof m.compositeScore === 'number' ? m.compositeScore : null,
      oaugfQueryCount: Number(m.oaugfQueryCount) || 0,
      oaugfRepeatCount: Number(m.oaugfRepeatCount) || 0,
      totalExposureNaira: Number(m.totalExposureNaira) || 0,
    }));

    return {
      engineVersion: evidenceAllYearsState?.engineVersion || '3.0.0',
      totalRulesCount: eeSum?.totalRulesCount || 22,
      activeYearFindingsCount: ruleFindings.length,
      activeYearCrossLedgerCount: crossLedgerFindingsCount,
      activeYearCompoundProjectsCount: compoundProjects.length,
      allYearsRecordsScanned: eeSum?.totalRecordsScanned || 559391,
      allYearsRuleFindings: eeSum?.totalRuleFindings || 49679,
      allYearsFlaggedProjects: eeSum?.totalFlaggedProjects || 28681,
      allYearsFlaggedNaira: eeSum?.totalFlaggedNaira || stats.flaggedTotalAmount,
      oaugf: oaugfHead
        ? {
            reportsIndexed: Number(oaugfHead.reportsIndexed) || 36,
            parsedAuditIssuesCount: Number(oaugfHead.parsedAuditIssuesCount) || 7028,
            repeatNeglectCount: Number(oaugfHead.repeatNeglectCount) || 54,
            recoveryDirectiveCount: Number(oaugfHead.recoveryDirectiveCount) || 675,
            matchedMdasCount: Number(oaugfHead.matchedMdasCount) || 127,
            topCategories,
          }
        : null,
      billActDiff: sixLedgerBundle?.billDiff
        ? {
            cyclesCount: Number(sixLedgerBundle.billDiff.cyclesCount) || diffCycles.length,
            activeYearCycle: activeCycleRaw
              ? {
                  financialYear: Number(activeCycleRaw.financialYear),
                  comparisonScope: String(activeCycleRaw.comparisonScope || ''),
                  insertionsCount: Number(activeCycleRaw.insertionsCount) || 0,
                  insertionsTotalNaira: Number(activeCycleRaw.insertionsTotalNaira) || 0,
                  inflatedCount: Number(activeCycleRaw.inflatedCount) || 0,
                  inflatedTotalNaira: Number(activeCycleRaw.inflatedTotalNaira) || 0,
                  cutCount: Number(activeCycleRaw.cutCount) || 0,
                  cutTotalNaira: Number(activeCycleRaw.cutTotalNaira) || 0,
                  zipTotalNaira: Number(activeCycleRaw.zipTotalNaira) || 0,
                }
              : null,
            allCyclesInsertionsCount,
            allCyclesInsertionsNaira,
            allCyclesInflatedNaira,
          }
        : null,
      treasuryCash:
        govHead || vnHead
          ? {
              totalVouchers: Number(govHead?.totalVouchers) || 467763,
              totalNaira: Number(govHead?.totalNaira) || 0,
              personalStaffCount: Number(vnHead?.offNocopoStaffCount) || 10851,
              personalStaffPaidNaira: Number(vnHead?.offNocopoStaffPaidNaira) || 0,
              personalStaffBillionPlusCount: Number(vnHead?.offNocopoStaffBillionPlusCount) || 235,
              unclassifiedCount: Number(vnHead?.offNocopoUnclassifiedCount) || 4169,
              unclassifiedPaidNaira: Number(vnHead?.offNocopoUnclassifiedPaidNaira) || 0,
              opaqueVoucherCount:
                Number(opaqueHead?.totalFlaggedVouchers ?? govHead?.discretionaryOpaqueVoucherCount) || 33366,
              opaqueNaira: Number(opaqueHead?.totalFlaggedNaira ?? govHead?.discretionaryOpaqueNaira) || 0,
              decemberRushRatio:
                typeof govHead?.decemberRushRatio2019To2025 === 'number'
                  ? govHead.decemberRushRatio2019To2025
                  : null,
            }
          : null,
      topCompoundProjects: topCompFromLive.length > 0 ? topCompFromLive : topCompFallback,
      topConvergentMdas,
    };
  }, [
    evidenceAllYearsState,
    sixLedgerBundle,
    financialYear,
    ruleFindings.length,
    crossLedgerFindingsCount,
    compoundProjects,
    stats.flaggedTotalAmount,
  ]);

  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    parts.push(selectedSector === 'ALL' ? 'All Sectors' : selectedSector);
    if (minAmount > 0) parts.push(`>= ${formatNairaCompact(minAmount)}`);
    if (searchTerm.trim()) parts.push(`Query "${searchTerm.trim()}"`);
    if (template === 'forensic_digest' && selectedSeverities.size < 3) {
      parts.push(`Severity: ${Array.from(selectedSeverities).join('/') || 'None'}`);
    }
    if (template === 'recurring_lineage') {
      parts.push(capitalOnlyLineages ? 'Capital Items Only' : 'All Codes');
    }
    return parts.join(' · ');
  }, [selectedSector, minAmount, searchTerm, template, selectedSeverities, capitalOnlyLineages]);

  // Unified Report Payload shared across Live Preview, A4 Print Engine, PDF & DOCX exports
  const buildReportPayload = useCallback((): ReportPayload => {
    return {
      financialYear,
      template,
      documentTitle: resolvedTitle,
      preparedBy: preparedBy.trim() || 'BudgetLens Civic Observatory Desk',
      generatedAt: new Date().toISOString(),
      presidentName: president.presidentName,
      party: president.party,
      termLabel: president.termLabel,
      filterSummary,
      tableRowLimit,
      orientation,
      sections,
      analystNotes,
      registryLength,
      excludedRollupsCount,
      macro: macroContext,
      debtSnapshot,
      yoy: yoyComparison,
      stats,
      civicEquivalents,
      findings: ruleFindings,
      duplicateClusters,
      lineages: filteredLineages,
      projects: filteredProjects,
      crossLedgerFindingsCount,
      compoundProjectsCount: compoundProjects.length,
      sixLedgerSummary,
    };
  }, [
    financialYear,
    template,
    resolvedTitle,
    preparedBy,
    president,
    filterSummary,
    tableRowLimit,
    orientation,
    sections,
    analystNotes,
    registryLength,
    excludedRollupsCount,
    macroContext,
    debtSnapshot,
    yoyComparison,
    stats,
    civicEquivalents,
    ruleFindings,
    duplicateClusters,
    filteredLineages,
    filteredProjects,
    crossLedgerFindingsCount,
    compoundProjects.length,
    sixLedgerSummary,
  ]);

  const notifyExport = useCallback((msg: string) => {
    setExportNotice(msg);
    window.setTimeout(() => setExportNotice(null), 2800);
  }, []);

  const handlePrint = useCallback(() => {
    const payload = buildReportPayload();
    printReportDocument(payload);
    notifyExport(`Print dossier prepared (${orientation.toUpperCase()})`);
  }, [buildReportPayload, orientation, notifyExport]);

  const handleDownloadPdf = useCallback(async () => {
    if (exportingFormat) return;
    setExportingFormat('pdf');
    try {
      const payload = buildReportPayload();
      const savedName = await exportExecutiveReportPdf(payload);
      notifyExport(`Downloaded ${savedName}`);
    } catch (err) {
      console.error('PDF export failed:', err);
      notifyExport('PDF generation failed — please retry');
    } finally {
      setExportingFormat(null);
    }
  }, [buildReportPayload, exportingFormat, notifyExport]);

  const handleDownloadDocx = useCallback(async () => {
    if (exportingFormat) return;
    setExportingFormat('docx');
    try {
      const payload = buildReportPayload();
      const savedName = await exportExecutiveReportDocx(payload);
      notifyExport(`Downloaded ${savedName}`);
    } catch (err) {
      console.error('DOCX export failed:', err);
      notifyExport('DOCX generation failed — please retry');
    } finally {
      setExportingFormat(null);
    }
  }, [buildReportPayload, exportingFormat, notifyExport]);

  const handleCopyBrief = useCallback(() => {
    const payload = buildReportPayload();
    const summaryText = buildClipboardSummaryText(payload);
    navigator.clipboard.writeText(summaryText);
    setCopiedBrief(true);
    window.setTimeout(() => setCopiedBrief(false), 2000);
    notifyExport('Summary brief copied to clipboard');
  }, [buildReportPayload, notifyExport]);

  const resetFilters = useCallback(() => {
    setSelectedSector('ALL');
    setMinAmount(0);
    setSearchTerm('');
    setSelectedSeverities(new Set(['high', 'medium', 'low']));
    setSortField('amount');
    setSortDirection('desc');
    setExpandedFindingId(null);
  }, []);

  // Up-to-date keyboard shortcuts (F focus search, Esc clears query/expanded row)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'Escape') {
        setSearchTerm('');
        setExpandedFindingId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const toggleSeverity = (sev: 'high' | 'medium' | 'low') => {
    setSelectedSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(sev)) {
        if (next.size > 1) next.delete(sev);
      } else {
        next.add(sev);
      }
      return next;
    });
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'amount' || field === 'page' ? 'desc' : 'asc');
    }
  };

  const toggleSection = (key: keyof ReportSectionOptions) => {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const exportRowCountText = useMemo(() => {
    if (template === 'six_ledger_brief') {
      return `${compoundProjects.length.toLocaleString()} compound projects · ${sixLedgerSummary.topConvergentMdas.length} convergent MDAs`;
    }
    if (template === 'forensic_digest') return `${ruleFindings.length.toLocaleString()} flagged records`;
    if (template === 'duplicate_audit') return `${duplicateClusters.length.toLocaleString()} duplicate clusters`;
    if (template === 'recurring_lineage') return `${filteredLineages.length.toLocaleString()} multi-year lineages`;
    return `${filteredProjects.length.toLocaleString()} filtered line items`;
  }, [
    template,
    compoundProjects.length,
    sixLedgerSummary.topConvergentMdas.length,
    ruleFindings.length,
    duplicateClusters.length,
    filteredLineages.length,
    filteredProjects.length,
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
      {/* 1. Editorial Studio Header & Export Action Bar */}
      <div className="dossier-card no-print" style={{ padding: '1.15rem 1.35rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
              <span
                className="font-mono"
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  padding: '0.18rem 0.5rem',
                  borderRadius: '4px',
                  backgroundColor: 'var(--emerald-bg)',
                  color: 'var(--emerald-primary)',
                  border: '1px solid #a7f3d0',
                }}
              >
                FY{financialYear} Audit Dossier Studio
              </span>
              <span
                className="font-mono"
                style={{
                  fontSize: '0.68rem',
                  color: 'var(--text-muted)',
                  backgroundColor: '#f8fafc',
                  border: '1px solid var(--card-border)',
                  padding: '0.18rem 0.5rem',
                  borderRadius: '4px',
                }}
              >
                {president.presidentName} ({president.party}) · {cleanProjects.length.toLocaleString()} Clean Items
              </span>
            </div>
            <h2
              className="font-editorial"
              style={{
                fontSize: '1.45rem',
                fontWeight: 700,
                color: 'var(--text-dark)',
                margin: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
              }}
            >
              <FileText size={20} color="#059669" />
              Reports & Verification Export Studio
            </h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
            {exportNotice && (
              <span
                className="font-mono"
                style={{
                  fontSize: '0.72rem',
                  color: '#065f46',
                  backgroundColor: '#ecfdf5',
                  border: '1px solid #a7f3d0',
                  padding: '0.35rem 0.6rem',
                  borderRadius: '6px',
                  fontWeight: 600,
                }}
              >
                {exportNotice}
              </span>
            )}

            <button
              type="button"
              onClick={handleCopyBrief}
              style={secondaryBtnStyle}
              title="Copy executive summary text to clipboard"
            >
              {copiedBrief ? <Check size={14} color="#059669" /> : <Copy size={14} />}
              {copiedBrief ? 'Copied Brief' : 'Copy Brief'}
            </button>

            <button
              type="button"
              onClick={handleDownloadDocx}
              disabled={exportingFormat !== null}
              style={{
                ...secondaryBtnStyle,
                opacity: exportingFormat !== null ? 0.65 : 1,
                borderColor: '#059669',
                color: '#047857',
              }}
              title="Download editable Microsoft Word dossier (.docx)"
            >
              <Download size={14} color="#059669" />
              {exportingFormat === 'docx' ? 'Building DOCX...' : 'Download DOCX'}
            </button>

            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={exportingFormat !== null}
              style={{
                backgroundColor: '#059669',
                color: '#ffffff',
                border: '1px solid #059669',
                borderRadius: '7px',
                padding: '0.48rem 0.9rem',
                fontSize: '0.78rem',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                opacity: exportingFormat !== null ? 0.7 : 1,
                boxShadow: '0 2px 6px rgba(5, 150, 105, 0.18)',
              }}
              title="Download multi-page verified PDF dossier (.pdf)"
            >
              <FileText size={14} />
              {exportingFormat === 'pdf' ? 'Building PDF...' : 'Download PDF'}
            </button>

            <button
              type="button"
              onClick={handlePrint}
              style={{
                backgroundColor: '#0f172a',
                color: '#ffffff',
                border: '1px solid #0f172a',
                borderRadius: '7px',
                padding: '0.48rem 0.9rem',
                fontSize: '0.78rem',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                boxShadow: '0 2px 6px rgba(15, 23, 42, 0.14)',
              }}
              title="Open dedicated multi-page A4 print preview"
            >
              <Printer size={14} />
              Print A4
            </button>
          </div>
        </div>

        {/* 2. 5-Template Selector Strip */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
            gap: '0.6rem',
            marginTop: '1rem',
            paddingTop: '1rem',
            borderTop: '1px solid rgba(15, 23, 42, 0.07)',
          }}
        >
          {(
            [
              {
                id: 'executive_brief',
                icon: <Landmark size={15} />,
                badge: `FY${financialYear}`,
              },
              {
                id: 'six_ledger_brief',
                icon: <Scale size={15} />,
                badge: `22 Rules · 6 Ledgers`,
              },
              {
                id: 'forensic_digest',
                icon: <ShieldAlert size={15} />,
                badge: `${ruleFindings.length.toLocaleString()} flags (${crossLedgerFindingsCount} XL)`,
              },
              {
                id: 'duplicate_audit',
                icon: <Layers size={15} />,
                badge: `${duplicateClusters.length.toLocaleString()} clusters`,
              },
              {
                id: 'recurring_lineage',
                icon: <History size={15} />,
                badge: cachedLineages ? `${filteredLineages.length.toLocaleString()} active` : 'Cross-year',
              },
              {
                id: 'sector_summary',
                icon: <Building2 size={15} />,
                badge: `${stats.sectorBreakdown.length} sectors`,
              },
            ] as const
          ).map((item) => {
            const active = template === item.id;
            const meta = TEMPLATE_META[item.id];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTemplate(item.id)}
                style={{
                  textAlign: 'left',
                  padding: '0.65rem 0.8rem',
                  borderRadius: '8px',
                  border: active ? '1.5px solid #059669' : '1px solid rgba(15, 23, 42, 0.09)',
                  backgroundColor: active ? '#ecfdf5' : '#faf9f6',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.25rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      color: active ? '#065f46' : '#0f172a',
                    }}
                  >
                    <span style={{ color: active ? '#059669' : '#64748b', display: 'inline-flex' }}>{item.icon}</span>
                    {meta.label}
                  </span>
                </div>
                <span
                  className="font-mono"
                  style={{
                    fontSize: '0.67rem',
                    fontWeight: 600,
                    color: active ? '#047857' : '#64748b',
                  }}
                >
                  {item.badge}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Studio Workspace: Sticky Left Configuration Rail + Live A4 Paper Sheet Preview */}
      <div className="report-studio-grid">
        {/* Left Control Rail (Hidden during Print) */}
        <aside className="dossier-card report-rail no-print" style={{ padding: '1rem 1.05rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0f172a', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <SlidersHorizontal size={14} color="#059669" />
              Dossier Configuration
            </span>
            <button
              type="button"
              onClick={resetFilters}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#059669',
                fontSize: '0.72rem',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
            >
              <RotateCcw size={12} />
              Reset
            </button>
          </div>

          {/* Search Scope */}
          <div>
            <label style={railLabelStyle}>Search Line Items / Agencies / Codes</label>
            <div style={{ position: 'relative' }}>
              <Search size={14} color="#64748b" style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)' }} />
              <input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="e.g. borehole, ERGP, Health..."
                style={{
                  width: '100%',
                  padding: '0.45rem 0.65rem 0.45rem 1.85rem',
                  fontSize: '0.78rem',
                  borderRadius: '6px',
                  border: '1px solid rgba(15, 23, 42, 0.14)',
                  backgroundColor: '#ffffff',
                  color: '#0f172a',
                }}
              />
            </div>
          </div>

          {/* Sector Filter */}
          <div>
            <label style={railLabelStyle}>Sector Scope</label>
            <select
              value={selectedSector}
              onChange={(e) => setSelectedSector(e.target.value)}
              style={{
                width: '100%',
                padding: '0.45rem 0.6rem',
                fontSize: '0.78rem',
                borderRadius: '6px',
                border: '1px solid rgba(15, 23, 42, 0.14)',
                backgroundColor: '#ffffff',
                color: '#0f172a',
                fontWeight: 500,
              }}
            >
              <option value="ALL">All Sectors ({availableSectors.length})</option>
              {availableSectors.map((sec) => (
                <option key={sec} value={sec}>
                  {sec}
                </option>
              ))}
            </select>
          </div>

          {/* Minimum Allocation Presets */}
          <div>
            <label style={railLabelStyle}>Materiality Floor (Min Amount)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
              {[
                { label: 'All', value: 0 },
                { label: '₦100M+', value: 100_000_000 },
                { label: '₦500M+', value: 500_000_000 },
                { label: '₦1B+', value: 1_000_000_000 },
                { label: '₦5B+', value: 5_000_000_000 },
              ].map((preset) => {
                const active = minAmount === preset.value;
                return (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setMinAmount(preset.value)}
                    className="font-mono"
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      padding: '0.28rem 0.5rem',
                      borderRadius: '5px',
                      border: active ? '1px solid #059669' : '1px solid rgba(15, 23, 42, 0.12)',
                      backgroundColor: active ? '#ecfdf5' : '#ffffff',
                      color: active ? '#047857' : '#475569',
                    }}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Template-specific filter controls */}
          {template === 'forensic_digest' && (
            <div>
              <label style={railLabelStyle}>Rule Severity Filter</label>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                {(['high', 'medium', 'low'] as const).map((sev) => {
                  const active = selectedSeverities.has(sev);
                  const tone =
                    sev === 'high'
                      ? { bg: '#fef2f2', fg: '#b91c1c', border: '#fecaca' }
                      : sev === 'medium'
                      ? { bg: '#fffbeb', fg: '#b45309', border: '#fde68a' }
                      : { bg: '#f0f9ff', fg: '#0369a1', border: '#bae6fd' };
                  return (
                    <button
                      key={sev}
                      type="button"
                      onClick={() => toggleSeverity(sev)}
                      style={{
                        flex: 1,
                        padding: '0.32rem 0.4rem',
                        borderRadius: '5px',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        border: `1px solid ${active ? tone.border : 'rgba(15, 23, 42, 0.12)'}`,
                        backgroundColor: active ? tone.bg : '#ffffff',
                        color: active ? tone.fg : '#94a3b8',
                      }}
                    >
                      {sev}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {template === 'recurring_lineage' && (
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.76rem',
                color: '#1e293b',
                backgroundColor: '#f8fafc',
                padding: '0.5rem 0.65rem',
                borderRadius: '6px',
                border: '1px solid rgba(15, 23, 42, 0.08)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={capitalOnlyLineages}
                onChange={(e) => setCapitalOnlyLineages(e.target.checked)}
              />
              <span>Capital projects only (exclude COA 21xx/22xx & Debt Service)</span>
            </label>
          )}

          {/* Print Orientation & Preview Table Density */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', paddingTop: '0.6rem', borderTop: '1px solid rgba(15, 23, 42, 0.08)' }}>
            <div>
              <label style={railLabelStyle}>Print Page Size</label>
              <div style={{ display: 'flex', border: '1px solid rgba(15, 23, 42, 0.14)', borderRadius: '6px', overflow: 'hidden' }}>
                {(['portrait', 'landscape'] as const).map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    onClick={() => setOrientation(dir)}
                    style={{
                      flex: 1,
                      padding: '0.35rem 0.3rem',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      border: 'none',
                      backgroundColor: orientation === dir ? '#0f172a' : '#ffffff',
                      color: orientation === dir ? '#ffffff' : '#475569',
                      textTransform: 'capitalize',
                    }}
                  >
                    {dir}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={railLabelStyle}>Print Table Rows</label>
              <select
                value={tableRowLimit}
                onChange={(e) => setTableRowLimit(Number(e.target.value))}
                style={{
                  width: '100%',
                  padding: '0.36rem 0.45rem',
                  fontSize: '0.74rem',
                  borderRadius: '6px',
                  border: '1px solid rgba(15, 23, 42, 0.14)',
                  backgroundColor: '#ffffff',
                  color: '#0f172a',
                }}
              >
                <option value={25}>Top 25 rows</option>
                <option value={50}>Top 50 rows</option>
                <option value={100}>Top 100 rows</option>
                <option value={250}>Top 250 rows</option>
              </select>
            </div>
          </div>

          {/* Section Toggles */}
          <div style={{ paddingTop: '0.6rem', borderTop: '1px solid rgba(15, 23, 42, 0.08)' }}>
            <label style={railLabelStyle}>Included Dossier Sections</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.42rem' }}>
              {(
                [
                  { key: 'includeMacroContext', label: 'Macro & Administration Framework' },
                  { key: 'includeDebtSnapshot', label: 'DMO Sovereign Debt Snapshot' },
                  { key: 'includeYoY', label: 'Year-over-Year Budget Shift' },
                  { key: 'includeCivicImpact', label: 'Civic Infrastructure Equivalents' },
                  { key: 'includeCitations', label: 'PDF Codes & Page Citations' },
                  { key: 'includeAnalystNotes', label: 'Analyst Commentary Block' },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.key}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: '#334155', cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={sections[opt.key]}
                    onChange={() => toggleSection(opt.key)}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Attribution & Analyst Notes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', paddingTop: '0.6rem', borderTop: '1px solid rgba(15, 23, 42, 0.08)' }}>
            <div>
              <label style={railLabelStyle}>Custom Dossier Title</label>
              <input
                type="text"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder={`Nigeria FY${financialYear} ${TEMPLATE_META[template].label}`}
                style={railInputStyle}
              />
            </div>

            <div>
              <label style={railLabelStyle}>Prepared By / Attribution</label>
              <input
                type="text"
                value={preparedBy}
                onChange={(e) => setPreparedBy(e.target.value)}
                style={railInputStyle}
              />
            </div>

            <div>
              <label style={railLabelStyle}>Analyst Commentary</label>
              <textarea
                rows={3}
                value={analystNotes}
                onChange={(e) => setAnalystNotes(e.target.value)}
                placeholder="Add audit observations, FOIA requests, or legislative scrutiny notes to include in PDF and DOCX exports..."
                style={{ ...railInputStyle, resize: 'vertical', lineHeight: 1.45 }}
              />
            </div>
          </div>

          {/* Export Manifest */}
          <div
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid rgba(15, 23, 42, 0.09)',
              borderRadius: '7px',
              padding: '0.65rem 0.75rem',
              fontSize: '0.71rem',
              color: '#475569',
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '0.2rem' }}>Export Manifest</div>
            <div>PDF &amp; DOCX scope: up to {tableRowLimit} rows per table (A4 {orientation}).</div>
            <div>Filtered universe: <strong>{exportRowCountText}</strong> eligible for publication.</div>
            <div>Excluded rollups: {excludedRollupsCount.toLocaleString()} MDA summary rows filtered out.</div>
          </div>
        </aside>

        {/* Right Live A4 Dossier Preview Sheet */}
        <article className="report-paper-sheet">
          {/* Top Emerald-Slate Gradient Rule */}
          <div style={{ height: '5px', background: 'linear-gradient(90deg, #059669 0%, #0f172a 100%)' }} />

          <div style={{ padding: '1.75rem 2rem', display: 'flex', flexDirection: 'column', gap: '1.35rem' }}>
            {/* Formal Dossier Masthead */}
            <header
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '1.25rem',
                borderBottom: '2px solid #0f172a',
                paddingBottom: '1rem',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ maxWidth: '640px' }}>
                <div
                  className="font-mono"
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: '#047857',
                    marginBottom: '0.35rem',
                  }}
                >
                  BudgetLens Civic Fiscal Observatory · Verbatim Audit Dossier
                </div>
                <h1
                  className="font-editorial"
                  style={{
                    fontSize: '1.7rem',
                    lineHeight: 1.18,
                    fontWeight: 700,
                    color: '#0f172a',
                    margin: '0 0 0.35rem 0',
                  }}
                >
                  {resolvedTitle}
                </h1>
                <p style={{ fontSize: '0.84rem', color: '#475569', margin: 0, lineHeight: 1.45 }}>
                  {TEMPLATE_META[template].label} — {TEMPLATE_META[template].subtitle}
                </p>
              </div>

              <div
                className="font-mono"
                style={{
                  textAlign: 'right',
                  fontSize: '0.73rem',
                  color: '#334155',
                  lineHeight: 1.65,
                }}
              >
                <div>
                  <strong>FISCAL YEAR:</strong> FY{financialYear}
                </div>
                <div>
                  <strong>PREPARED BY:</strong> {preparedBy || 'Observatory Desk'}
                </div>
                <div>
                  <strong>INDEXED SOURCES:</strong> {registryLength.toLocaleString()} Documents
                </div>
                <div>
                  <strong>LAYOUT:</strong> A4 {orientation.toUpperCase()}
                </div>
              </div>
            </header>

            {/* Scope & Metadata Strip */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                gap: '0.75rem',
                backgroundColor: '#faf9f6',
                border: '1px solid rgba(15, 23, 42, 0.09)',
                borderRadius: '8px',
                padding: '0.75rem 1rem',
              }}
            >
              <div>
                <div style={metaCellLabel}>Administration</div>
                <div style={metaCellValue}>
                  {president.presidentName} ({president.party})
                </div>
              </div>
              <div>
                <div style={metaCellLabel}>Tenure Term</div>
                <div style={metaCellValue}>{president.termLabel}</div>
              </div>
              <div>
                <div style={metaCellLabel}>Filter Scope</div>
                <div style={metaCellValue}>{filterSummary}</div>
              </div>
              <div>
                <div style={metaCellLabel}>Rollup Hygiene</div>
                <div style={metaCellValue}>{excludedRollupsCount.toLocaleString()} Header Rollups Excluded</div>
              </div>
            </div>

            {/* Primary 4-KPI Summary Strip */}
            <div className="grid-4-cols">
              <div style={kpiCardStyle}>
                <div style={kpiLabelStyle}>Filtered Line Items</div>
                <div className="font-mono" style={kpiValStyle}>
                  {stats.count.toLocaleString()}
                </div>
                <div style={kpiSubStyle}>Median {formatNairaCompact(stats.medianAmount)}</div>
              </div>

              <div style={kpiCardStyle}>
                <div style={kpiLabelStyle}>Filtered Total Allocation</div>
                <div className="font-mono" style={kpiValStyle}>
                  {formatNairaCompact(stats.totalAllocated)}
                </div>
                <div style={kpiSubStyle}>Mean {formatNairaCompact(stats.avgAmount)}</div>
              </div>

              <div style={kpiCardStyle}>
                <div style={kpiLabelStyle}>Evidence Engine v3.0 Flags</div>
                <div className="font-mono" style={{ ...kpiValStyle, color: ruleFindings.length > 0 ? '#b91c1c' : '#0f172a' }}>
                  {ruleFindings.length.toLocaleString()}
                </div>
                <div style={kpiSubStyle}>
                  {stats.highSeverityCount} High · {crossLedgerFindingsCount} Cross-Ledger · {compoundProjects.length} Compound
                </div>
              </div>

              <div style={kpiCardStyle}>
                <div style={kpiLabelStyle}>Duplicate Clusters</div>
                <div className="font-mono" style={{ ...kpiValStyle, color: stats.duplicateClusterCount > 0 ? '#b45309' : '#0f172a' }}>
                  {stats.duplicateClusterCount.toLocaleString()}
                </div>
                <div style={kpiSubStyle}>{formatNairaCompact(stats.duplicateTotalAmount)} cumulative</div>
              </div>
            </div>

            {/* Optional: Macro & Administration Context */}
            {sections.includeMacroContext && (
              <section style={sectionBlockStyle}>
                <h2 className="font-editorial" style={sectionHeadingStyle}>
                  Enacted Macroeconomic Framework & Administration Policy Context
                </h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.85rem' }}>
                  <div style={{ backgroundColor: '#faf9f6', border: '1px solid rgba(15, 23, 42, 0.09)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
                    <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#047857', marginBottom: '0.25rem' }}>
                      Appropriation Theme
                    </div>
                    <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.35rem' }}>
                      {macroContext.budgetTheme}
                    </div>
                    <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, lineHeight: 1.5 }}>
                      {macroContext.executiveSummary || president.economicAgenda}
                    </p>
                  </div>

                  <div style={{ backgroundColor: '#faf9f6', border: '1px solid rgba(15, 23, 42, 0.09)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
                    <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#0f172a', marginBottom: '0.45rem' }}>
                      Official FY{financialYear} Fiscal Envelope
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.28rem 0.75rem', fontSize: '0.78rem' }}>
                      <span style={{ color: '#475569' }}>Total Enacted Appropriation</span>
                      <strong className="font-mono">{formatNairaCompact(macroContext.officialTotalBudget)}</strong>
                      <span style={{ color: '#475569' }}>Total Capital Budget</span>
                      <strong className="font-mono">{formatNairaCompact(macroContext.totalCapitalBudget)}</strong>
                      <span style={{ color: '#475569' }}>Recurrent Non-Debt</span>
                      <strong className="font-mono">{formatNairaCompact(macroContext.recurrentNonDebtTotal)}</strong>
                      <span style={{ color: '#475569' }}>Debt Service Provision</span>
                      <strong className="font-mono">{formatNairaCompact(macroContext.debtService)}</strong>
                      <span style={{ color: '#475569' }}>Statutory Transfers</span>
                      <strong className="font-mono">{formatNairaCompact(macroContext.statutoryTransfers)}</strong>
                    </div>
                  </div>
                </div>

                {(macroContext.benchmarkOilPriceUSD || macroContext.exchangeRateNairaPerUSD) && (
                  <div
                    className="font-mono"
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '1.1rem',
                      marginTop: '0.65rem',
                      padding: '0.55rem 0.85rem',
                      backgroundColor: '#f8fafc',
                      border: '1px solid rgba(15, 23, 42, 0.08)',
                      borderRadius: '6px',
                      fontSize: '0.73rem',
                      color: '#334155',
                    }}
                  >
                    <span>Oil: <strong>${macroContext.benchmarkOilPriceUSD ?? 'N/A'}/bbl</strong></span>
                    <span>Output: <strong>{macroContext.dailyOilProductionMBPD ?? 'N/A'} mbpd</strong></span>
                    <span>FX Ref: <strong>₦{macroContext.exchangeRateNairaPerUSD ?? 'N/A'}/US$</strong></span>
                    <span>GDP Proj: <strong>{macroContext.projectedGdpGrowthPercent ?? 'N/A'}%</strong></span>
                    <span>Inflation: <strong>{macroContext.inflationRatePercent ?? 'N/A'}%</strong></span>
                  </div>
                )}
              </section>
            )}

            {/* Optional: DMO Sovereign Public Debt Snapshot */}
            {sections.includeDebtSnapshot && debtSnapshot && (
              <section style={sectionBlockStyle}>
                <h2 className="font-editorial" style={sectionHeadingStyle}>
                  DMO Sovereign Public Debt Profile (
                  {debtSnapshot.isExactYearMatch ? `FY${debtSnapshot.financialYear}` : `Latest Prior Record: FY${debtSnapshot.financialYear}`})
                </h2>
                <div className="grid-4-cols">
                  <div style={kpiCardStyle}>
                    <div style={kpiLabelStyle}>Total Debt Stock</div>
                    <div className="font-mono" style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a' }}>
                      {debtSnapshot.totalDebtNairaM !== null ? formatNairaCompact(debtSnapshot.totalDebtNairaM * 1e6) : 'N/A'}
                    </div>
                    <div style={kpiSubStyle}>
                      {debtSnapshot.totalDebtUsdM !== null ? `US$${(debtSnapshot.totalDebtUsdM / 1000).toFixed(2)}B` : 'USD N/A'}
                    </div>
                  </div>
                  <div style={kpiCardStyle}>
                    <div style={kpiLabelStyle}>Domestic Debt</div>
                    <div className="font-mono" style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a' }}>
                      {debtSnapshot.domesticDebtNairaM !== null ? formatNairaCompact(debtSnapshot.domesticDebtNairaM * 1e6) : 'N/A'}
                    </div>
                    <div style={kpiSubStyle}>FGN Bonds & T-Bills</div>
                  </div>
                  <div style={kpiCardStyle}>
                    <div style={kpiLabelStyle}>External Debt</div>
                    <div className="font-mono" style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a' }}>
                      {debtSnapshot.externalDebtNairaM !== null ? formatNairaCompact(debtSnapshot.externalDebtNairaM * 1e6) : 'N/A'}
                    </div>
                    <div style={kpiSubStyle}>
                      {debtSnapshot.externalDebtUsdM !== null ? `US$${(debtSnapshot.externalDebtUsdM / 1000).toFixed(2)}B` : 'USD N/A'}
                    </div>
                  </div>
                  <div style={kpiCardStyle}>
                    <div style={kpiLabelStyle}>DMO Reference</div>
                    <div className="font-mono" style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0f172a' }}>
                      {debtSnapshot.asAt || `FY${debtSnapshot.financialYear}`}
                    </div>
                    <div style={kpiSubStyle}>{debtSnapshot.primarySource}</div>
                  </div>
                </div>
              </section>
            )}

            {/* Optional: Year-over-Year Shift */}
            {sections.includeYoY && yoyComparison && (
              <section style={sectionBlockStyle}>
                <h2 className="font-editorial" style={sectionHeadingStyle}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                    <TrendingUp size={16} color="#059669" />
                    Year-over-Year Shift (FY{yoyComparison.priorYear} vs FY{financialYear})
                  </span>
                </h2>
                <div style={{ overflowX: 'auto' }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Fiscal Aggregate</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>FY{yoyComparison.priorYear}</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>FY{financialYear}</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Nominal Delta</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Change %</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>Enacted Federal Budget Total</td>
                        <td style={tdNumStyle}>{formatNairaCompact(yoyComparison.priorOfficialTotal)}</td>
                        <td style={tdNumStyle}>{formatNairaCompact(yoyComparison.currentOfficialTotal)}</td>
                        <td style={tdNumStyle}>
                          {yoyComparison.officialDelta >= 0 ? '+' : ''}
                          {formatNairaCompact(yoyComparison.officialDelta)}
                        </td>
                        <td style={{ ...tdNumStyle, fontWeight: 700, color: yoyComparison.officialDeltaPct >= 0 ? '#047857' : '#b91c1c' }}>
                          {yoyComparison.officialDeltaPct >= 0 ? '+' : ''}
                          {yoyComparison.officialDeltaPct.toFixed(1)}%
                        </td>
                      </tr>
                      <tr>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>Extracted PDF Schedule Total</td>
                        <td style={tdNumStyle}>{formatNairaCompact(yoyComparison.priorExtractedTotal)}</td>
                        <td style={tdNumStyle}>{formatNairaCompact(yoyComparison.currentExtractedTotal)}</td>
                        <td style={tdNumStyle}>
                          {yoyComparison.extractedDelta >= 0 ? '+' : ''}
                          {formatNairaCompact(yoyComparison.extractedDelta)}
                        </td>
                        <td style={{ ...tdNumStyle, fontWeight: 700, color: yoyComparison.extractedDeltaPct >= 0 ? '#047857' : '#b91c1c' }}>
                          {yoyComparison.extractedDeltaPct >= 0 ? '+' : ''}
                          {yoyComparison.extractedDeltaPct.toFixed(1)}%
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* TEMPLATE 1: EXECUTIVE BRIEF */}
            {template === 'executive_brief' && (
              <>
                <section style={sectionBlockStyle}>
                  <h2 className="font-editorial" style={sectionHeadingStyle}>
                    1. Concentration Profile (Top Sectors & Executing Agencies)
                  </h2>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '1rem' }}>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={tableStyle}>
                        <thead>
                          <tr>
                            <th style={thStyle}>Sector</th>
                            <th style={{ ...thStyle, textAlign: 'right' }}>Items</th>
                            <th style={{ ...thStyle, textAlign: 'right' }}>Share</th>
                            <th style={{ ...thStyle, textAlign: 'right' }}>Allocation</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats.sectorBreakdown.slice(0, 10).map((s) => (
                            <tr key={s.sector}>
                              <td style={{ ...tdStyle, fontWeight: 600 }}>{s.sector}</td>
                              <td style={tdNumStyle}>{s.count.toLocaleString()}</td>
                              <td style={tdNumStyle}>{s.sharePct.toFixed(1)}%</td>
                              <td style={{ ...tdNumStyle, fontWeight: 700 }}>{formatNairaCompact(s.totalAmount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div style={{ overflowX: 'auto' }}>
                      <table style={tableStyle}>
                        <thead>
                          <tr>
                            <th style={thStyle}>Top Executing Agencies</th>
                            <th style={{ ...thStyle, textAlign: 'right' }}>Items</th>
                            <th style={{ ...thStyle, textAlign: 'right' }}>Share</th>
                            <th style={{ ...thStyle, textAlign: 'right' }}>Allocation</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats.topAgencies.slice(0, 10).map((a) => (
                            <tr key={a.agency}>
                              <td style={{ ...tdStyle, fontWeight: 600 }}>{a.agency}</td>
                              <td style={tdNumStyle}>{a.count.toLocaleString()}</td>
                              <td style={tdNumStyle}>{a.sharePct.toFixed(1)}%</td>
                              <td style={{ ...tdNumStyle, fontWeight: 700 }}>{formatNairaCompact(a.totalAmount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>

                <section style={sectionBlockStyle}>
                  <h2 className="font-editorial" style={sectionHeadingStyle}>
                    2. Priority Evidence Engine v3.0 Exceptions ({ruleFindings.length.toLocaleString()} Flagged · {crossLedgerFindingsCount.toLocaleString()} Cross-Ledger)
                  </h2>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={tableStyle}>
                      <thead>
                        <tr>
                          {sections.includeCitations && <th style={{ ...thStyle, width: '96px' }}>Code</th>}
                          <th style={thStyle}>Line Item & Audit Finding</th>
                          <th style={{ ...thStyle, width: '190px' }}>Executing Agency</th>
                          <th style={{ ...thStyle, width: '78px' }}>Severity</th>
                          <th style={{ ...thStyle, textAlign: 'right', width: '105px' }}>Amount</th>
                          {sections.includeCitations && <th style={{ ...thStyle, textAlign: 'right', width: '58px' }}>PDF</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {ruleFindings.slice(0, Math.min(15, tableRowLimit)).map((f) => (
                          <tr key={f.id}>
                            {sections.includeCitations && (
                              <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: '0.73rem', color: '#047857', fontWeight: 600 }}>
                                {f.projectCode || 'N/A'}
                              </td>
                            )}
                            <td style={tdStyle}>
                              <div style={{ fontWeight: 600, color: '#0f172a' }}>
                                <ExpandableText text={f.projectName} maxChars={150} />
                              </div>
                              <div style={{ fontSize: '0.74rem', color: '#475569', marginTop: '0.18rem' }}>
                                <strong>{f.ruleName}:</strong> {f.reason}
                              </div>
                              {f.crossLedgerBadges && (f.crossLedgerBadges.paidOnPaper || f.crossLedgerBadges.billInsertedOrInflated || f.crossLedgerBadges.mdaOaugfIssuesCount > 0) && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.28rem', marginTop: '0.25rem' }}>
                                  {f.crossLedgerBadges.paidOnPaper && (
                                    <span className="font-mono" style={{ fontSize: '0.62rem', fontWeight: 700, padding: '0.06rem 0.32rem', borderRadius: '4px', backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>
                                      Paid on Paper
                                    </span>
                                  )}
                                  {f.crossLedgerBadges.billInsertedOrInflated && (
                                    <span className="font-mono" style={{ fontSize: '0.62rem', fontWeight: 700, padding: '0.06rem 0.32rem', borderRadius: '4px', backgroundColor: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' }}>
                                      Bill Insertion
                                    </span>
                                  )}
                                  {f.crossLedgerBadges.mdaOaugfIssuesCount > 0 && (
                                    <span className="font-mono" style={{ fontSize: '0.62rem', fontWeight: 700, padding: '0.06rem 0.32rem', borderRadius: '4px', backgroundColor: '#fff1f2', color: '#be123c', border: '1px solid #fecdd3' }}>
                                      OAuGF ({f.crossLedgerBadges.mdaOaugfIssuesCount})
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                            <td style={{ ...tdStyle, fontSize: '0.76rem', color: '#475569' }}>{f.agency}</td>
                            <td style={tdStyle}>{renderSeverityBadge(f.severity)}</td>
                            <td style={{ ...tdNumStyle, fontWeight: 700 }}>{formatNairaCompact(f.amount)}</td>
                            {sections.includeCitations && (
                              <td style={{ ...tdNumStyle, color: '#64748b' }}>p.{f.page || '-'}</td>
                            )}
                          </tr>
                        ))}
                        {ruleFindings.length === 0 && (
                          <tr>
                            <td colSpan={sections.includeCitations ? 6 : 4} style={{ ...tdStyle, textAlign: 'center', color: '#64748b', padding: '1.25rem' }}>
                              No Evidence Engine v3.0 exceptions match the current filters.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}

            {/* TEMPLATE 1B: 6-LEDGER ACCOUNTABILITY & AUDIT BRIEF */}
            {template === 'six_ledger_brief' && (
              <>
                <section style={sectionBlockStyle}>
                  <h2 className="font-editorial" style={sectionHeadingStyle}>
                    1. Six Federal Accountability Layers (Distinct Non-Additive Ledgers)
                  </h2>
                  <p style={{ fontSize: '0.75rem', color: '#475569', margin: '0 0 0.65rem 0', lineHeight: 1.45 }}>
                    Enacted Appropriations, Legislative Bill-vs-Act Deltas, Open Treasury Cash Vouchers, and OAuGF Constitutional Audit Queries inspect separate fiscal stages and are cross-referenced without double-counting.
                  </p>
                  {sixLedgerLoading ? (
                    <div style={{ padding: '1.25rem', textAlign: 'center', color: '#64748b', fontSize: '0.82rem' }}>
                      Hydrating 6-ledger OAuGF audit, Bill-vs-Act padding, Treasury personal/opaque cash, and Red-Flag Convergence indices...
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.75rem' }}>
                      <div style={{ ...kpiCardStyle, borderColor: '#a7f3d0', backgroundColor: '#ecfdf5' }}>
                        <div style={{ ...kpiLabelStyle, color: '#047857' }}>Evidence Engine v{sixLedgerSummary.engineVersion}</div>
                        <div className="font-mono" style={{ fontSize: '1.15rem', fontWeight: 700, color: '#065f46' }}>
                          {sixLedgerSummary.allYearsRuleFindings.toLocaleString()} Findings ({sixLedgerSummary.totalRulesCount} Rules)
                        </div>
                        <div style={kpiSubStyle}>
                          {sixLedgerSummary.activeYearFindingsCount.toLocaleString()} active FY · {sixLedgerSummary.activeYearCompoundProjectsCount.toLocaleString()} compound projects
                        </div>
                      </div>

                      <div style={{ ...kpiCardStyle, borderColor: '#fecaca', backgroundColor: '#fef2f2' }}>
                        <div style={{ ...kpiLabelStyle, color: '#991b1b' }}>OAuGF Constitutional Audits</div>
                        <div className="font-mono" style={{ fontSize: '1.15rem', fontWeight: 700, color: '#7f1d1d' }}>
                          {(sixLedgerSummary.oaugf?.parsedAuditIssuesCount ?? 7028).toLocaleString()} Queries ({sixLedgerSummary.oaugf?.reportsIndexed ?? 36} Reports)
                        </div>
                        <div style={kpiSubStyle}>
                          {(sixLedgerSummary.oaugf?.recoveryDirectiveCount ?? 675).toLocaleString()} recoveries · {(sixLedgerSummary.oaugf?.repeatNeglectCount ?? 54).toLocaleString()} repeat directives
                        </div>
                      </div>

                      <div style={{ ...kpiCardStyle, borderColor: '#fde68a', backgroundColor: '#fffbeb' }}>
                        <div style={{ ...kpiLabelStyle, color: '#92400e' }}>Legislative Bill-vs-Act Deltas</div>
                        <div className="font-mono" style={{ fontSize: '1.15rem', fontWeight: 700, color: '#78350f' }}>
                          {formatNairaCompact(sixLedgerSummary.billActDiff?.allCyclesInsertionsNaira ?? 0)} Insertions
                        </div>
                        <div style={kpiSubStyle}>
                          {sixLedgerSummary.billActDiff?.activeYearCycle
                            ? `FY${financialYear}: ${sixLedgerSummary.billActDiff.activeYearCycle.insertionsCount.toLocaleString()} insertions (${formatNairaCompact(sixLedgerSummary.billActDiff.activeYearCycle.insertionsTotalNaira)})`
                            : `${(sixLedgerSummary.billActDiff?.allCyclesInsertionsCount ?? 0).toLocaleString()} line-item insertions indexed`}
                        </div>
                      </div>

                      <div style={{ ...kpiCardStyle, borderColor: '#fecdd3', backgroundColor: '#fff1f2' }}>
                        <div style={{ ...kpiLabelStyle, color: '#9f1239' }}>Treasury Personal &amp; Opaque Cash</div>
                        <div className="font-mono" style={{ fontSize: '1.15rem', fontWeight: 700, color: '#881337' }}>
                          {formatNairaCompact(sixLedgerSummary.treasuryCash?.personalStaffPaidNaira ?? 0)} + {formatNairaCompact(sixLedgerSummary.treasuryCash?.opaqueNaira ?? 0)}
                        </div>
                        <div style={kpiSubStyle}>
                          {(sixLedgerSummary.treasuryCash?.personalStaffCount ?? 10851).toLocaleString()} staff payees · {(sixLedgerSummary.treasuryCash?.opaqueVoucherCount ?? 33366).toLocaleString()} opaque vouchers
                        </div>
                      </div>
                    </div>
                  )}
                </section>

                <section style={sectionBlockStyle}>
                  <h2 className="font-editorial" style={sectionHeadingStyle}>
                    2. Priority Compound-Risk Flagged Projects (FY{financialYear} · Evidence Engine v3.0)
                  </h2>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={tableStyle}>
                      <thead>
                        <tr>
                          <th style={{ ...thStyle, width: '92px' }}>Code</th>
                          <th style={thStyle}>Project &amp; Triggered Rules</th>
                          <th style={{ ...thStyle, width: '175px' }}>Executing MDA</th>
                          <th style={{ ...thStyle, width: '145px' }}>6-Ledger Signals</th>
                          <th style={{ ...thStyle, textAlign: 'right', width: '74px' }}>Score</th>
                          <th style={{ ...thStyle, textAlign: 'right', width: '100px' }}>Amount</th>
                          {sections.includeCitations && <th style={{ ...thStyle, textAlign: 'right', width: '52px' }}>PDF</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {sixLedgerSummary.topCompoundProjects.slice(0, Math.min(25, tableRowLimit)).map((cp, idx) => (
                          <tr key={`${cp.projectCode}-${idx}`}>
                            <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: '#047857', fontWeight: 600 }}>
                              {cp.projectCode || 'ERGP'}
                            </td>
                            <td style={tdStyle}>
                              <div style={{ fontWeight: 600, color: '#0f172a' }}>
                                <ExpandableText text={cp.projectName} maxChars={135} />
                              </div>
                              <div style={{ fontSize: '0.71rem', color: '#475569', marginTop: '0.16rem' }}>
                                {cp.ruleNames.slice(0, 3).join(' · ')}
                              </div>
                            </td>
                            <td style={{ ...tdStyle, fontSize: '0.74rem' }}>{cp.agency}</td>
                            <td style={tdStyle}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.24rem' }}>
                                {cp.paidOnPaper && (
                                  <span className="font-mono" style={{ fontSize: '0.62rem', fontWeight: 700, padding: '0.08rem 0.34rem', borderRadius: '4px', backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>
                                    Paid on Paper
                                  </span>
                                )}
                                {cp.billInserted && (
                                  <span className="font-mono" style={{ fontSize: '0.62rem', fontWeight: 700, padding: '0.08rem 0.34rem', borderRadius: '4px', backgroundColor: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' }}>
                                    Bill&rarr;Act
                                  </span>
                                )}
                                {cp.mdaOaugfIssues > 0 && (
                                  <span className="font-mono" style={{ fontSize: '0.62rem', fontWeight: 700, padding: '0.08rem 0.34rem', borderRadius: '4px', backgroundColor: '#fff1f2', color: '#be123c', border: '1px solid #fecdd3' }}>
                                    OAuGF ({cp.mdaOaugfIssues})
                                  </span>
                                )}
                                {cp.mdaGrade && cp.mdaGrade !== 'N/A' && (
                                  <span className="font-mono" style={{ fontSize: '0.62rem', fontWeight: 700, color: '#475569' }}>
                                    Grade {cp.mdaGrade}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td style={{ ...tdNumStyle, fontWeight: 700, color: cp.compoundRiskScore >= 70 ? '#b91c1c' : '#b45309' }}>
                              {cp.compoundRiskScore}/100
                            </td>
                            <td style={{ ...tdNumStyle, fontWeight: 700 }}>{formatNairaCompact(cp.amount)}</td>
                            {sections.includeCitations && <td style={tdNumStyle}>p.{cp.page || '-'}</td>}
                          </tr>
                        ))}
                        {sixLedgerSummary.topCompoundProjects.length === 0 && (
                          <tr>
                            <td colSpan={sections.includeCitations ? 7 : 6} style={{ ...tdStyle, textAlign: 'center', color: '#64748b', padding: '1.1rem' }}>
                              No compound-risk projects matched the active filters in FY{financialYear}.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section style={sectionBlockStyle}>
                  <h2 className="font-editorial" style={sectionHeadingStyle}>
                    3. Top Multi-Ledger Red-Flag Convergent MDAs &amp; OAuGF Category Breakdown
                  </h2>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '1rem' }}>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={tableStyle}>
                        <thead>
                          <tr>
                            <th style={thStyle}>Executing MDA</th>
                            <th style={{ ...thStyle, textAlign: 'right' }}>Flags</th>
                            <th style={thStyle}>Grade</th>
                            <th style={{ ...thStyle, textAlign: 'right' }}>OAuGF</th>
                            <th style={{ ...thStyle, textAlign: 'right' }}>Exposure</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sixLedgerSummary.topConvergentMdas.slice(0, 15).map((m) => (
                            <tr key={m.mdaName}>
                              <td style={tdStyle}>
                                <div style={{ fontWeight: 600 }}>{m.mdaName}</div>
                                <div style={{ fontSize: '0.68rem', color: '#64748b' }}>
                                  {m.flags.join(' · ').replace(/_/g, ' ')}
                                </div>
                              </td>
                              <td style={{ ...tdNumStyle, fontWeight: 700, color: '#b91c1c' }}>{m.flagCount}x</td>
                              <td className="font-mono" style={tdStyle}>
                                {m.grade}{m.compositeScore !== null ? ` (${m.compositeScore.toFixed(1)})` : ''}
                              </td>
                              <td style={tdNumStyle}>
                                {m.oaugfQueryCount} ({m.oaugfRepeatCount} rep)
                              </td>
                              <td style={{ ...tdNumStyle, fontWeight: 700 }}>{formatNairaCompact(m.totalExposureNaira)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {sixLedgerSummary.oaugf?.topCategories && (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={tableStyle}>
                          <thead>
                            <tr>
                              <th style={thStyle}>OAuGF Constitutional Audit Category</th>
                              <th style={{ ...thStyle, textAlign: 'right' }}>Queries</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sixLedgerSummary.oaugf.topCategories.map((c) => (
                              <tr key={c.category}>
                                <td style={{ ...tdStyle, fontWeight: 600 }}>{c.category}</td>
                                <td style={{ ...tdNumStyle, fontWeight: 700, color: '#991b1b' }}>{c.count.toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </section>
              </>
            )}

            {/* TEMPLATE 2: FORENSIC COMPLIANCE DIGEST */}
            {template === 'forensic_digest' && (
              <section style={sectionBlockStyle}>
                <h2 className="font-editorial" style={sectionHeadingStyle}>
                  Forensic Compliance & Exception Log ({Math.min(tableRowLimit, ruleFindings.length).toLocaleString()} of{' '}
                  {ruleFindings.length.toLocaleString()} Shown)
                </h2>
                <p style={{ fontSize: '0.78rem', color: '#475569', margin: '0 0 0.65rem 0' }}>
                  Click any row to inspect the verbatim audit explanation across{' '}
                  <strong>{ruleFindings.length.toLocaleString()}</strong> matching exception records (PDF &amp; DOCX export ready).
                </p>
                <div style={{ overflowX: 'auto' }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        {sections.includeCitations && <th style={{ ...thStyle, width: '96px' }}>Code</th>}
                        <th style={thStyle}>Line Item Title</th>
                        <th style={{ ...thStyle, width: '185px' }}>Agency & Sector</th>
                        <th style={{ ...thStyle, width: '155px' }}>Severity & Rule</th>
                        <th style={{ ...thStyle, textAlign: 'right', width: '108px' }}>Amount</th>
                        {sections.includeCitations && <th style={{ ...thStyle, textAlign: 'right', width: '58px' }}>PDF</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {ruleFindings.slice(0, tableRowLimit).map((f) => {
                        const expanded = expandedFindingId === f.id;
                        return (
                          <React.Fragment key={f.id}>
                            <tr
                              onClick={() => setExpandedFindingId(expanded ? null : f.id)}
                              style={{ cursor: 'pointer', backgroundColor: expanded ? '#f8fafc' : undefined }}
                            >
                              {sections.includeCitations && (
                                <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: '0.73rem', color: '#047857', fontWeight: 600 }}>
                                  {f.projectCode || 'N/A'}
                                </td>
                              )}
                              <td style={tdStyle}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 600, color: '#0f172a' }}>
                                  {expanded ? <ChevronUp size={13} color="#64748b" /> : <ChevronDown size={13} color="#64748b" />}
                                  <span><ExpandableText text={f.projectName} maxChars={150} /></span>
                                </div>
                              </td>
                              <td style={tdStyle}>
                                <div style={{ fontWeight: 600, fontSize: '0.76rem' }}>{f.agency}</div>
                                <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{f.sector}</div>
                              </td>
                              <td style={tdStyle}>
                                {renderSeverityBadge(f.severity)}
                                <div style={{ fontSize: '0.7rem', color: '#475569', marginTop: '0.2rem' }}>{f.ruleName}</div>
                              </td>
                              <td style={{ ...tdNumStyle, fontWeight: 700 }} title={formatNairaExact(f.amount)}>
                                {formatNairaCompact(f.amount)}
                              </td>
                              {sections.includeCitations && (
                                <td style={{ ...tdNumStyle, color: '#64748b' }}>p.{f.page || '-'}</td>
                              )}
                            </tr>
                            {expanded && (
                              <tr style={{ backgroundColor: '#f8fafc' }}>
                                <td colSpan={sections.includeCitations ? 6 : 4} style={{ ...tdStyle, paddingLeft: '1.5rem', fontSize: '0.76rem', color: '#334155' }}>
                                  <strong>Rule Rationale ({f.ruleId} · {Math.round(f.confidence * 100)}% confidence):</strong> {f.reason}
                                  <span className="font-mono" style={{ marginLeft: '0.75rem', color: '#64748b' }}>
                                    Exact: {formatNairaExact(f.amount)}
                                  </span>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                      {ruleFindings.length === 0 && (
                        <tr>
                          <td colSpan={sections.includeCitations ? 6 : 4} style={{ ...tdStyle, textAlign: 'center', color: '#64748b', padding: '1.25rem' }}>
                            No exceptions matched for the active filter scope.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* TEMPLATE 3: DUPLICATE & SPLIT-ALLOCATION AUDIT */}
            {template === 'duplicate_audit' && (
              <section style={sectionBlockStyle}>
                <h2 className="font-editorial" style={sectionHeadingStyle}>
                  Duplicate, Disguised-Rewording & Split-Allocation Clusters (
                  {Math.min(tableRowLimit, duplicateClusters.length).toLocaleString()} of{' '}
                  {duplicateClusters.length.toLocaleString()} Clusters)
                </h2>
                <p style={{ fontSize: '0.78rem', color: '#475569', margin: '0 0 0.65rem 0' }}>
                  Detected deterministically via O(N) token-synonym normalization with MDA rollup and COA 21xx/22xx exclusions.
                </p>
                <div style={{ overflowX: 'auto' }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={{ ...thStyle, width: '92px' }}>Cluster ID</th>
                        <th style={thStyle}>Canonical Description & Sample Provenance</th>
                        <th style={{ ...thStyle, width: '140px' }}>Pattern Type</th>
                        <th style={{ ...thStyle, textAlign: 'right', width: '68px' }}>Items</th>
                        <th style={{ ...thStyle, textAlign: 'right', width: '64px' }}>MDAs</th>
                        <th style={{ ...thStyle, textAlign: 'right', width: '115px' }}>Cluster Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {duplicateClusters.slice(0, tableRowLimit).map((c) => (
                        <tr key={c.id}>
                          <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: '0.73rem', color: '#047857', fontWeight: 600 }}>
                            {c.id}
                          </td>
                          <td style={tdStyle}>
                            <div style={{ fontWeight: 600, color: '#0f172a' }}>
                              <ExpandableText text={c.canonicalTitle} maxChars={150} />
                            </div>
                            {sections.includeCitations && (
                              <div className="font-mono" style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.2rem' }}>
                                {c.projects
                                  .slice(0, 4)
                                  .map((p) => `${p.projectCode || 'ERGP'} (p.${p.page || '?'})`)
                                  .join(' · ')}
                                {c.projects.length > 4 ? ` (+${c.projects.length - 4} more)` : ''}
                              </div>
                            )}
                          </td>
                          <td style={tdStyle}>
                            <span
                              style={{
                                display: 'inline-block',
                                fontSize: '0.67rem',
                                fontWeight: 700,
                                padding: '0.14rem 0.45rem',
                                borderRadius: '4px',
                                textTransform: 'uppercase',
                                backgroundColor: c.patternType === 'Disguised Rewording' ? '#fef2f2' : '#fffbeb',
                                color: c.patternType === 'Disguised Rewording' ? '#b91c1c' : '#b45309',
                                border: `1px solid ${c.patternType === 'Disguised Rewording' ? '#fecaca' : '#fde68a'}`,
                              }}
                            >
                              {c.patternType}
                            </span>
                          </td>
                          <td style={tdNumStyle}>{c.count.toLocaleString()}</td>
                          <td style={tdNumStyle}>{c.distinctAgencies.toLocaleString()}</td>
                          <td style={{ ...tdNumStyle, fontWeight: 700 }}>{formatNairaCompact(c.totalAmount)}</td>
                        </tr>
                      ))}
                      {duplicateClusters.length === 0 && (
                        <tr>
                          <td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: '#64748b', padding: '1.25rem' }}>
                            No duplicate or split-allocation clusters detected within the active filter scope.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* TEMPLATE 4: MULTI-YEAR RECURRING LINEAGES */}
            {template === 'recurring_lineage' && (
              <section style={sectionBlockStyle}>
                <h2 className="font-editorial" style={sectionHeadingStyle}>
                  Multi-Year Recurring Lineages Active in FY{financialYear}
                </h2>
                {lineagesLoading ? (
                  <div style={{ padding: '1.5rem', textAlign: 'center', color: '#64748b', fontSize: '0.82rem' }}>
                    Loading historical recurring lineages across FY2009–FY2026...
                  </div>
                ) : lineagesError ? (
                  <div style={{ padding: '1rem', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#b91c1c', fontSize: '0.8rem' }}>
                    {lineagesError}
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={tableStyle}>
                      <thead>
                        <tr>
                          <th style={{ ...thStyle, width: '105px' }}>Code</th>
                          <th style={thStyle}>Canonical Title & Appearance Years</th>
                          <th style={{ ...thStyle, width: '190px' }}>Lead Agency</th>
                          <th style={{ ...thStyle, textAlign: 'right', width: '70px' }}>Span</th>
                          <th style={{ ...thStyle, textAlign: 'right', width: '105px' }}>FY{financialYear}</th>
                          <th style={{ ...thStyle, textAlign: 'right', width: '112px' }}>Cumulative</th>
                          {sections.includeCitations && <th style={{ ...thStyle, textAlign: 'right', width: '56px' }}>PDF</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLineages.slice(0, tableRowLimit).map((lin) => {
                          const fyInst = lin.instances.find((i) => (i.financialYear ?? i.year) === financialYear);
                          return (
                            <tr key={lin.lineageId}>
                              <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: '0.73rem', color: '#047857', fontWeight: 600 }}>
                                {lin.projectCode || lin.lineageId}
                              </td>
                              <td style={tdStyle}>
                                <div style={{ fontWeight: 600, color: '#0f172a' }}>
                                  <ExpandableText text={lin.canonicalTitle} maxChars={150} />
                                </div>
                                <div className="font-mono" style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.18rem' }}>
                                  Years: {lin.yearsAppeared.join(', ')}
                                </div>
                              </td>
                              <td style={{ ...tdStyle, fontSize: '0.76rem', color: '#475569' }}>{lin.agency}</td>
                              <td style={tdNumStyle}>{lin.appearanceCount} yrs</td>
                              <td style={tdNumStyle}>{formatNairaCompact(fyInst?.amount || 0)}</td>
                              <td style={{ ...tdNumStyle, fontWeight: 700 }}>{formatNairaCompact(lin.cumulativeAllocation)}</td>
                              {sections.includeCitations && (
                                <td style={{ ...tdNumStyle, color: '#64748b' }}>p.{fyInst?.page || '-'}</td>
                              )}
                            </tr>
                          );
                        })}
                        {filteredLineages.length === 0 && (
                          <tr>
                            <td colSpan={sections.includeCitations ? 7 : 6} style={{ ...tdStyle, textAlign: 'center', color: '#64748b', padding: '1.25rem' }}>
                              No recurring lineages match the active filters in FY{financialYear}.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {/* TEMPLATE 5: SECTOR & MDA LEDGER */}
            {template === 'sector_summary' && (
              <>
                <section style={sectionBlockStyle}>
                  <h2 className="font-editorial" style={sectionHeadingStyle}>
                    1. Sectoral Share Distribution
                  </h2>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={tableStyle}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Sector</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>Line Items</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>Share of Scope</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>Total Allocation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.sectorBreakdown.map((s) => (
                          <tr key={s.sector}>
                            <td style={{ ...tdStyle, fontWeight: 600 }}>{s.sector}</td>
                            <td style={tdNumStyle}>{s.count.toLocaleString()}</td>
                            <td style={tdNumStyle}>{s.sharePct.toFixed(1)}%</td>
                            <td style={{ ...tdNumStyle, fontWeight: 700 }}>{formatNairaCompact(s.totalAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section style={sectionBlockStyle}>
                  <h2 className="font-editorial" style={sectionHeadingStyle}>
                    2. Filtered Verbatim Line-Item Ledger ({Math.min(tableRowLimit, filteredProjects.length).toLocaleString()} of{' '}
                    {filteredProjects.length.toLocaleString()})
                  </h2>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={tableStyle}>
                      <thead>
                        <tr>
                          {sections.includeCitations && <th style={{ ...thStyle, width: '98px' }}>Code</th>}
                          <th style={{ ...thStyle, cursor: 'pointer' }} onClick={() => toggleSort('projectName')}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                              Project Title <ArrowUpDown size={11} />
                            </span>
                          </th>
                          <th style={{ ...thStyle, cursor: 'pointer', width: '210px' }} onClick={() => toggleSort('agency')}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                              Executing Agency <ArrowUpDown size={11} />
                            </span>
                          </th>
                          <th style={{ ...thStyle, cursor: 'pointer', textAlign: 'right', width: '112px' }} onClick={() => toggleSort('amount')}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', justifyContent: 'flex-end' }}>
                              Amount <ArrowUpDown size={11} />
                            </span>
                          </th>
                          {sections.includeCitations && (
                            <th style={{ ...thStyle, cursor: 'pointer', textAlign: 'right', width: '64px' }} onClick={() => toggleSort('page')}>
                              PDF
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredProjects.slice(0, tableRowLimit).map((p) => (
                          <tr key={p.id}>
                            {sections.includeCitations && (
                              <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: '0.73rem', color: '#047857', fontWeight: 600 }}>
                                {p.projectCode || 'ERGP'}
                              </td>
                            )}
                            <td style={{ ...tdStyle, fontWeight: 500, color: '#0f172a' }}>
                              <ExpandableText text={p.projectName} maxChars={150} />
                            </td>
                            <td style={tdStyle}>
                              <div style={{ fontSize: '0.76rem', fontWeight: 600 }}>{p.agency}</div>
                              <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{p.sector}</div>
                            </td>
                            <td style={{ ...tdNumStyle, fontWeight: 700 }} title={formatNairaExact(p.amount)}>
                              {formatNairaCompact(p.amount)}
                            </td>
                            {sections.includeCitations && (
                              <td style={{ ...tdNumStyle, color: '#64748b' }}>p.{p.page || '-'}</td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}

            {/* Optional: Inflation-Adjusted Civic Infrastructure Equivalents */}
            {sections.includeCivicImpact && (
              <section style={sectionBlockStyle}>
                <h2 className="font-editorial" style={sectionHeadingStyle}>
                  Civic Infrastructure Equivalents ({formatNairaCompact(stats.totalAllocated)} Scope Basis)
                </h2>
                <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0 0 0.6rem 0' }}>
                  Unit benchmarks scaled to FY{financialYear} macro price index ({civicEquivalents.inflationFactor.toFixed(2)}x vs 2023 baseline). Illustrates physical capacity parity.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: '0.75rem' }}>
                  <div style={kpiCardStyle}>
                    <div style={kpiLabelStyle}>Equipped PHCs</div>
                    <div className="font-mono" style={{ fontSize: '1.08rem', fontWeight: 700, color: '#0f172a' }}>
                      {civicEquivalents.equivalents.phcs.toLocaleString()}
                    </div>
                    <div style={kpiSubStyle}>@ {formatNairaCompact(civicEquivalents.unitCosts.phc)}</div>
                  </div>
                  <div style={kpiCardStyle}>
                    <div style={kpiLabelStyle}>3-Classroom Blocks</div>
                    <div className="font-mono" style={{ fontSize: '1.08rem', fontWeight: 700, color: '#0f172a' }}>
                      {civicEquivalents.equivalents.classroomBlocks.toLocaleString()}
                    </div>
                    <div style={kpiSubStyle}>@ {formatNairaCompact(civicEquivalents.unitCosts.classroomBlock)}</div>
                  </div>
                  <div style={kpiCardStyle}>
                    <div style={kpiLabelStyle}>Solar Boreholes</div>
                    <div className="font-mono" style={{ fontSize: '1.08rem', fontWeight: 700, color: '#0f172a' }}>
                      {civicEquivalents.equivalents.solarBoreholes.toLocaleString()}
                    </div>
                    <div style={kpiSubStyle}>@ {formatNairaCompact(civicEquivalents.unitCosts.solarBorehole)}</div>
                  </div>
                  <div style={kpiCardStyle}>
                    <div style={kpiLabelStyle}>Annual School Meals</div>
                    <div className="font-mono" style={{ fontSize: '1.08rem', fontWeight: 700, color: '#0f172a' }}>
                      {civicEquivalents.equivalents.schoolMealsFed.toLocaleString()}
                    </div>
                    <div style={kpiSubStyle}>@ {formatNairaCompact(civicEquivalents.unitCosts.annualSchoolMeal)}</div>
                  </div>
                  <div style={kpiCardStyle}>
                    <div style={kpiLabelStyle}>Annual Min. Wages</div>
                    <div className="font-mono" style={{ fontSize: '1.08rem', fontWeight: 700, color: '#0f172a' }}>
                      {civicEquivalents.equivalents.annualMinWages.toLocaleString()}
                    </div>
                    <div style={kpiSubStyle}>@ {formatNairaCompact(civicEquivalents.unitCosts.annualMinWage)}</div>
                  </div>
                </div>
              </section>
            )}

            {/* Optional: Analyst Notes */}
            {sections.includeAnalystNotes && analystNotes.trim() && (
              <section style={sectionBlockStyle}>
                <h2 className="font-editorial" style={sectionHeadingStyle}>
                  Analyst Commentary & Observations
                </h2>
                <div
                  style={{
                    borderLeft: '3px solid #059669',
                    backgroundColor: '#f8fafc',
                    padding: '0.8rem 1rem',
                    borderRadius: '0 6px 6px 0',
                    fontSize: '0.82rem',
                    color: '#1e293b',
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.55,
                  }}
                >
                  {analystNotes}
                </div>
              </section>
            )}

            {/* Provenance Footer */}
            <footer
              style={{
                borderTop: '1px solid rgba(15, 23, 42, 0.12)',
                paddingTop: '0.75rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.75rem',
                flexWrap: 'wrap',
                fontSize: '0.72rem',
                color: '#64748b',
              }}
            >
              <span>
                Every record is grounded verbatim against official Federal Appropriation Act PDF schedules and DMO releases.
              </span>
              <span className="font-mono">BudgetLens · Open Civic Observatory · FY{financialYear}</span>
            </footer>
          </div>
        </article>
      </div>
    </div>
  );
};

function renderSeverityBadge(severity: 'high' | 'medium' | 'low') {
  const palette =
    severity === 'high'
      ? { bg: '#fef2f2', fg: '#b91c1c', border: '#fecaca' }
      : severity === 'medium'
      ? { bg: '#fffbeb', fg: '#b45309', border: '#fde68a' }
      : { bg: '#f0f9ff', fg: '#0369a1', border: '#bae6fd' };

  return (
    <span
      className="font-mono"
      style={{
        display: 'inline-block',
        padding: '0.12rem 0.42rem',
        borderRadius: '4px',
        fontSize: '0.67rem',
        fontWeight: 700,
        textTransform: 'uppercase',
        backgroundColor: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.border}`,
      }}
    >
      {severity}
    </span>
  );
}

const secondaryBtnStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  color: '#0f172a',
  border: '1px solid rgba(15, 23, 42, 0.15)',
  borderRadius: '7px',
  padding: '0.45rem 0.72rem',
  fontSize: '0.75rem',
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.35rem',
};

const railLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.69rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#475569',
  marginBottom: '0.35rem',
};

const railInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.42rem 0.6rem',
  fontSize: '0.77rem',
  borderRadius: '6px',
  border: '1px solid rgba(15, 23, 42, 0.14)',
  backgroundColor: '#ffffff',
  color: '#0f172a',
};

const metaCellLabel: React.CSSProperties = {
  fontSize: '0.65rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#64748b',
  marginBottom: '0.15rem',
};

const metaCellValue: React.CSSProperties = {
  fontSize: '0.79rem',
  fontWeight: 600,
  color: '#0f172a',
};

const kpiCardStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid rgba(15, 23, 42, 0.1)',
  borderRadius: '8px',
  padding: '0.75rem 0.9rem',
};

const kpiLabelStyle: React.CSSProperties = {
  fontSize: '0.66rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#64748b',
  marginBottom: '0.2rem',
};

const kpiValStyle: React.CSSProperties = {
  fontSize: '1.25rem',
  fontWeight: 700,
  color: '#0f172a',
};

const kpiSubStyle: React.CSSProperties = {
  fontSize: '0.71rem',
  color: '#64748b',
  marginTop: '0.15rem',
};

const sectionBlockStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.45rem',
};

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: '1.08rem',
  fontWeight: 700,
  color: '#0f172a',
  borderBottom: '1px solid rgba(15, 23, 42, 0.12)',
  paddingBottom: '0.35rem',
  margin: '0 0 0.3rem 0',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.78rem',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.52rem 0.6rem',
  backgroundColor: '#f1f5f9',
  color: '#334155',
  fontSize: '0.69rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  borderTop: '1px solid #cbd5e1',
  borderBottom: '1.5px solid #94a3b8',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '0.52rem 0.6rem',
  borderBottom: '1px solid #e2e8f0',
  verticalAlign: 'top',
  color: '#1e293b',
};

const tdNumStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: 'right',
  fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};
