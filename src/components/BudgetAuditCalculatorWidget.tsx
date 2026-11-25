import React, { useEffect, useMemo, useState } from 'react';
import { datasetUrl } from '../services/apiClient';
import {
  AlertTriangle,
  BookmarkPlus,
  Building2,
  Calculator,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  HeartPulse,
  GraduationCap,
  Landmark,
  RotateCcw,
  ShieldAlert,
  Sliders,
  Trash2,
  TrendingDown,
  TrendingUp,
  Waypoints,
  Wrench,
  X,
} from 'lucide-react';
import { useBudgetDatabase } from '../context/BudgetDatabaseContext';
import { HISTORICAL_MACRO_DATA, getMacroForYear } from '../data/historicalMacroData';
import { applyRules, RawProject } from '../utils/ruleEngine';
import { exportTabularDossierDocx, exportTabularDossierPdf } from '../utils/documentExporter';

interface OfficialBudgetBreakdown {
  financialYear: number;
  officialTotalBudget: number;
  personnelCost: number;
  overheadCost: number;
  pensionsAndGratuities: number;
  serviceWideVotes: number;
  recurrentNonDebtTotal: number;
  capitalDevelopmentFund: number;
  capitalSupplementation: number;
  totalCapitalBudget: number;
  statutoryTransfers: number;
  debtService: number;
  domesticDebt: number;
  foreignDebt: number;
  judiciaryTransfer: number;
  inecTransfer: number;
  nddcTransfer: number;
  bhcpfTransfer: number;
}

interface FiscalRiskSignal {
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
}

interface ReallocationWeights {
  health: number;
  education: number;
  waterPower: number;
  roadsDebt: number;
}

interface SavedScenario {
  id: string;
  name: string;
  financialYear: number;
  overheadCutPct: number;
  serviceWideCutPct: number;
  scrutinyCapitalCutPct: number;
  weights: ReallocationWeights;
  totalFreedNaira: number;
  capitalShareShiftPct: number;
  phcsFunded: number;
  createdAt: number;
}

interface Props {
  financialYear: number;
}

const SCENARIO_STORAGE_KEY = 'budgetlens_fiscal_scenarios_v2';
const MDA_ROLLUP_RE = /^[0-5]\d{8,9}$/;
const DISCRETIONARY_OVERHEAD_CODES = new Set([
  '22020104', // International Travel & Transport (Others)
  '22020103', // International Travel & Transport (Training)
  '22021007', // Welfare Packages
  '22021002', // Honorarium & Sitting Allowance
  '22021001', // Refreshment & Meals
  '22021003', // Publicity & Advertisements
  '22021009', // Sporting Activities
]);
const SCRUTINY_CAPITAL_RULES = new Set([
  'MDA_MANDATE_MISMATCH',
  'VEHICLE_UNIT_COST_ANOMALY',
  'NON_ESSENTIAL_CEREMONIAL',
  'ROYAL_PALACE_INFRASTRUCTURE',
  'RELIGIOUS_INFRASTRUCTURE',
  'VAGUE_BLANK_CHECK',
]);

function buildBreakdownFromMacro(year: number): OfficialBudgetBreakdown {
  const m = getMacroForYear(year);
  return {
    financialYear: year,
    officialTotalBudget: m.officialTotalBudget,
    personnelCost: m.personnelCost,
    overheadCost: m.overheadCost,
    pensionsAndGratuities: Math.round(m.recurrentNonDebtTotal * 0.08),
    serviceWideVotes: Math.max(
      0,
      m.recurrentNonDebtTotal - m.personnelCost - m.overheadCost - Math.round(m.recurrentNonDebtTotal * 0.08)
    ),
    recurrentNonDebtTotal: m.recurrentNonDebtTotal,
    capitalDevelopmentFund: Math.round(m.totalCapitalBudget * 0.75),
    capitalSupplementation: Math.max(0, m.totalCapitalBudget - Math.round(m.totalCapitalBudget * 0.75)),
    totalCapitalBudget: m.totalCapitalBudget,
    statutoryTransfers: m.statutoryTransfers,
    debtService: m.debtService,
    domesticDebt: Math.round(m.debtService * 0.72),
    foreignDebt: Math.round(m.debtService * 0.28),
    judiciaryTransfer: Math.round(m.statutoryTransfers * 0.08),
    inecTransfer: Math.round(m.statutoryTransfers * 0.1),
    nddcTransfer: Math.round(m.statutoryTransfers * 0.05),
    bhcpfTransfer: Math.round(m.statutoryTransfers * 0.03),
  };
}

const INITIAL_BUDGET_MAP: Record<number, OfficialBudgetBreakdown> = Object.fromEntries(
  Object.keys(HISTORICAL_MACRO_DATA).map((yr) => [Number(yr), buildBreakdownFromMacro(Number(yr))])
);

function fmtNaira(amt: number): string {
  if (!amt || Number.isNaN(amt)) return '₦0';
  if (amt >= 1e12) return `₦${(amt / 1e12).toFixed(2)}T`;
  if (amt >= 1e9) return `₦${(amt / 1e9).toFixed(2)}B`;
  if (amt >= 1e6) return `₦${(amt / 1e6).toFixed(1)}M`;
  return `₦${Math.round(amt).toLocaleString()}`;
}

export const BudgetAuditCalculatorWidget: React.FC<Props> = ({ financialYear }) => {
  const { records } = useBudgetDatabase();
  const [budgetMap, setBudgetMap] = useState<Record<number, OfficialBudgetBreakdown>>(INITIAL_BUDGET_MAP);

  useEffect(() => {
    let active = true;
    const yearsToLoad = [financialYear, financialYear - 1].filter((y) => y >= 1999);
    yearsToLoad.forEach((year) => {
      fetch(datasetUrl(`/datasets/${year}/statistics.json`), { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((stats) => {
          if (!active || !stats) return;
          if (stats.recurrentNonDebtTotal || stats.totalCapitalBudget || stats.officialTotalBudget) {
            const baseFallback = INITIAL_BUDGET_MAP[year] || buildBreakdownFromMacro(year);
            const recTotal = stats.recurrentNonDebtTotal || baseFallback.recurrentNonDebtTotal;
            const pers = stats.personnelCost || baseFallback.personnelCost;
            const oh = stats.overheadCost || baseFallback.overheadCost;
            const pens = stats.pensionsGratuities || stats.pensionsAndGratuities || baseFallback.pensionsAndGratuities;
            const swv = stats.serviceWideVotes ?? Math.max(0, recTotal - pers - oh - pens);
            const capTotal = stats.totalCapitalBudget || baseFallback.totalCapitalBudget;
            const debt = stats.debtService || baseFallback.debtService;
            const statT = stats.statutoryTransfers || baseFallback.statutoryTransfers;

            const breakdown: OfficialBudgetBreakdown = {
              financialYear: stats.financialYear || year,
              officialTotalBudget: stats.officialTotalBudget || baseFallback.officialTotalBudget,
              personnelCost: pers,
              overheadCost: oh,
              pensionsAndGratuities: pens,
              serviceWideVotes: swv,
              recurrentNonDebtTotal: recTotal,
              capitalDevelopmentFund: stats.capitalDevelopmentFund || Math.round(capTotal * 0.75),
              capitalSupplementation: stats.capitalSupplementation || Math.max(0, capTotal - Math.round(capTotal * 0.75)),
              totalCapitalBudget: capTotal,
              statutoryTransfers: statT,
              debtService: debt,
              domesticDebt: stats.domesticDebt || Math.round(debt * 0.72),
              foreignDebt: stats.foreignDebt || Math.round(debt * 0.28),
              judiciaryTransfer: stats.judiciaryTransfer || Math.round(statT * 0.08),
              inecTransfer: stats.inecTransfer || Math.round(statT * 0.1),
              nddcTransfer: stats.nddcTransfer || Math.round(statT * 0.05),
              bhcpfTransfer: stats.bhcpfTransfer || Math.round(statT * 0.03),
            };
            setBudgetMap((prev) => ({ ...prev, [year]: breakdown }));
          }
        })
        .catch(() => {});
    });
    return () => {
      active = false;
    };
  }, [financialYear]);

  const data: OfficialBudgetBreakdown = budgetMap[financialYear] || buildBreakdownFromMacro(financialYear);
  const safeTotal = Math.max(1, data.officialTotalBudget);

  // Compute live extracted pools from `records` (memoized so sliders are instant & rollup-free)
  const {
    extractedDiscretionaryOverhead,
    discretionaryLineCount,
    extractedScrutinyCapitalPool,
    scrutinyFlaggedLineCount,
  } = useMemo(() => {
    const activeRecs = records.filter((r) => (r.recordIdentity?.financialYear || financialYear) === financialYear);
    let overheadSum = 0;
    let overheadCount = 0;
    const rawForRules: RawProject[] = [];

    for (const r of activeRecs) {
      const code = String(r.recordIdentity?.projectCode || '').trim();
      if (MDA_ROLLUP_RE.test(code)) continue;
      const amt = r.recordIdentity?.amountNaira || 0;
      const ag = (r.mdaGovernanceTaxonomy?.mdaName || '').toUpperCase();
      const title = r.recordIdentity?.verbatimProjectName || '';

      if (DISCRETIONARY_OVERHEAD_CODES.has(code) && !ag.includes('CORRECTIONAL') && !ag.includes('PRISON')) {
        overheadSum += amt;
        overheadCount++;
      }

      if (/^(ERGP|ZIP|NASS)/i.test(code) && amt >= 25_000_000) {
        rawForRules.push({
          id: r.recordIdentity.id,
          projectCode: code,
          projectName: title,
          financialYear: r.recordIdentity.financialYear || financialYear,
          amount: amt,
          projectType: r.recordIdentity.spendingType || 'CAPITAL',
          page: r.sourceProvenance?.pdfPage || 1,
          sector: r.mdaGovernanceTaxonomy?.sector || 'General',
          agency: r.mdaGovernanceTaxonomy?.mdaName || '',
        });
      }
    }

    const ruleMatches = applyRules(rawForRules).filter((ev) => SCRUTINY_CAPITAL_RULES.has(ev.ruleId));
    const uniqueFlagged = new Map<string, number>();
    for (const ev of ruleMatches) {
      const k = ev.budgetCode || ev.id;
      uniqueFlagged.set(k, Math.max(uniqueFlagged.get(k) || 0, ev.amount));
    }
    const flaggedSum = Array.from(uniqueFlagged.values()).reduce((s, v) => s + v, 0);

    return {
      extractedDiscretionaryOverhead: overheadSum,
      discretionaryLineCount: overheadCount,
      extractedScrutinyCapitalPool: flaggedSum,
      scrutinyFlaggedLineCount: uniqueFlagged.size,
    };
  }, [records, financialYear]);

  // UI & Simulator State
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [showYearComparison, setShowYearComparison] = useState(false);
  const [activeModalPillar, setActiveModalPillar] = useState<'recurrent' | 'capital' | 'debt' | 'statutory' | null>(null);
  const [copiedNotice, setCopiedNotice] = useState<string | null>(null);
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null);

  // 3 Independent Policy Cut Levers
  const [overheadCutPct, setOverheadCutPct] = useState(25);
  const [serviceWideCutPct, setServiceWideCutPct] = useState(10);
  const [scrutinyCapitalCutPct, setScrutinyCapitalCutPct] = useState(50);

  // 4 Normalized Re-Allocation Target Weights
  const [weights, setWeights] = useState<ReallocationWeights>({
    health: 30,
    education: 30,
    waterPower: 20,
    roadsDebt: 20,
  });

  // Persistent Saved Scenarios
  const [scenarioName, setScenarioName] = useState('');
  const [savedScenarios, setSavedScenarios] = useState<SavedScenario[]>(() => {
    try {
      const raw = localStorage.getItem(SCENARIO_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore storage failure
    }
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify(savedScenarios));
    } catch {
      // ignore storage failure
    }
  }, [savedScenarios]);

  // Pool Resolution
  const overheadPool = extractedDiscretionaryOverhead > 0 ? extractedDiscretionaryOverhead : data.overheadCost;
  const overheadPoolLabel =
    extractedDiscretionaryOverhead > 0
      ? `Verbatim 2202xxxx Pool (${discretionaryLineCount.toLocaleString()} lines)`
      : 'Macro Overhead Envelope';

  const overheadSavings = overheadPool * (overheadCutPct / 100);
  const serviceWideSavings = data.serviceWideVotes * (serviceWideCutPct / 100);
  const scrutinyCapitalRedirect =
    extractedScrutinyCapitalPool > 0 ? extractedScrutinyCapitalPool * (scrutinyCapitalCutPct / 100) : 0;

  const totalFreedFunds = overheadSavings + serviceWideSavings + scrutinyCapitalRedirect;

  // Strict 100% Normalization of Target Shares
  const weightSum = weights.health + weights.education + weights.waterPower + weights.roadsDebt;
  const normalizedShares = useMemo(() => {
    if (weightSum <= 0) {
      return { health: 25, education: 25, waterPower: 25, roadsDebt: 25 };
    }
    return {
      health: (weights.health / weightSum) * 100,
      education: (weights.education / weightSum) * 100,
      waterPower: (weights.waterPower / weightSum) * 100,
      roadsDebt: (weights.roadsDebt / weightSum) * 100,
    };
  }, [weights, weightSum]);

  const allocated = {
    health: totalFreedFunds * (normalizedShares.health / 100),
    education: totalFreedFunds * (normalizedShares.education / 100),
    waterPower: totalFreedFunds * (normalizedShares.waterPower / 100),
    roadsDebt: totalFreedFunds * (normalizedShares.roadsDebt / 100),
  };

  // Verified Nigerian Public-Cost Baselines (2023=1.0 scaled cleanly by year inflation scalar >= 0.08)
  const inflationFactor = Math.max(0.08, getMacroForYear(financialYear).assetInflationFrom2023);
  const unitCosts = useMemo(
    () => ({
      phc: Math.round(25_000_000 * inflationFactor),
      ambulance: Math.round(18_000_000 * inflationFactor),
      classroomBlock: Math.round(15_000_000 * inflationFactor),
      annualSchoolMeal: Math.round(72_000 * inflationFactor),
      solarBorehole: Math.round(3_500_000 * inflationFactor),
      solarMiniGrid: Math.round(45_000_000 * inflationFactor),
      ruralRoadKm: Math.round(180_000_000 * inflationFactor),
    }),
    [inflationFactor]
  );

  const civicImpact = {
    phcs: Math.floor(allocated.health / unitCosts.phc),
    ambulances: Math.floor(allocated.health / unitCosts.ambulance),
    classroomBlocks: Math.floor(allocated.education / unitCosts.classroomBlock),
    schoolMealsFed: Math.floor(allocated.education / unitCosts.annualSchoolMeal),
    boreholes: Math.floor(allocated.waterPower / unitCosts.solarBorehole),
    miniGrids: Math.floor(allocated.waterPower / unitCosts.solarMiniGrid),
    ruralRoadsKm: Math.floor(allocated.roadsDebt / unitCosts.ruralRoadKm),
    debtOffsetPct: data.debtService > 0 ? (allocated.roadsDebt / data.debtService) * 100 : 0,
  };

  // Structural Reconciliation & Post-Reform Capital Share
  const calculatedSum =
    data.recurrentNonDebtTotal + data.totalCapitalBudget + data.statutoryTransfers + data.debtService;
  const discrepancyAmount = Math.abs(calculatedSum - data.officialTotalBudget);
  const isExactMatch = discrepancyAmount <= safeTotal * 0.0005;

  const baselinePct = {
    recurrent: (data.recurrentNonDebtTotal / safeTotal) * 100,
    capital: (data.totalCapitalBudget / safeTotal) * 100,
    debt: (data.debtService / safeTotal) * 100,
    statutory: (data.statutoryTransfers / safeTotal) * 100,
  };

  // Redirecting administrative savings into productive social/infrastructure capital increases Capital share
  const recurrentReduction = overheadSavings + serviceWideSavings;
  const socialCapitalGain = allocated.health + allocated.education + allocated.waterPower;
  const simulatedRecurrent = Math.max(0, data.recurrentNonDebtTotal - recurrentReduction);
  const simulatedCapital = data.totalCapitalBudget + socialCapitalGain;
  const simulatedDebt = Math.max(0, data.debtService - allocated.roadsDebt * 0.5); // illustrative debt offset option
  const simulatedDenom = Math.max(1, simulatedRecurrent + simulatedCapital + simulatedDebt + data.statutoryTransfers);
  const simulatedPct = {
    recurrent: (simulatedRecurrent / simulatedDenom) * 100,
    capital: (simulatedCapital / simulatedDenom) * 100,
    debt: (simulatedDebt / simulatedDenom) * 100,
    statutory: (data.statutoryTransfers / simulatedDenom) * 100,
  };
  const capitalShareShiftPct = simulatedPct.capital - baselinePct.capital;

  // Objective Fiscal Risk Signals (No proverbs or emojis)
  const riskSignals = useMemo<FiscalRiskSignal[]>(() => {
    const signals: FiscalRiskSignal[] = [];
    const debtRatio = (data.debtService / safeTotal) * 100;
    if (debtRatio > 35) {
      signals.push({
        severity: 'high',
        title: `Debt Service Burden at ${debtRatio.toFixed(1)}% of Total Budget`,
        detail: `Exceeds the 35% fiscal sustainability ceiling (${fmtNaira(data.debtService)}).`,
      });
    } else if (debtRatio > 25) {
      signals.push({
        severity: 'medium',
        title: `Elevated Debt Service Share (${debtRatio.toFixed(1)}%)`,
        detail: `Approaching the 35% crowding-out threshold against capital spending.`,
      });
    }

    if (data.personnelCost > data.totalCapitalBudget) {
      signals.push({
        severity: 'medium',
        title: 'Personnel Outlay Exceeds Capital Expenditure',
        detail: `Personnel (${fmtNaira(data.personnelCost)}) exceeds Total Capital (${fmtNaira(data.totalCapitalBudget)}).`,
      });
    }

    const prev = budgetMap[financialYear - 1];
    if (prev) {
      const ohDelta = prev.overheadCost > 0 ? ((data.overheadCost - prev.overheadCost) / prev.overheadCost) * 100 : 0;
      if (ohDelta > 25) {
        signals.push({
          severity: 'medium',
          title: `Overhead Expanded +${ohDelta.toFixed(1)}% YoY`,
          detail: `Rose from ${fmtNaira(prev.overheadCost)} in FY ${financialYear - 1} to ${fmtNaira(data.overheadCost)}.`,
        });
      }
      const capDelta = prev.totalCapitalBudget > 0 ? ((data.totalCapitalBudget - prev.totalCapitalBudget) / prev.totalCapitalBudget) * 100 : 0;
      if (capDelta < 0 && ohDelta > 0) {
        signals.push({
          severity: 'low',
          title: 'Capital Contraction Alongside Recurrent Growth',
          detail: `Capital contracted ${capDelta.toFixed(1)}% YoY while overhead rose.`,
        });
      }
    }

    if (scrutinyFlaggedLineCount > 0) {
      signals.push({
        severity: 'medium',
        title: `${scrutinyFlaggedLineCount.toLocaleString()} Scrutiny-Flagged Capital Lines Identifiable`,
        detail: `${fmtNaira(extractedScrutinyCapitalPool)} eligible for targeted line-item review.`,
      });
    }
    return signals;
  }, [data, safeTotal, budgetMap, financialYear, scrutinyFlaggedLineCount, extractedScrutinyCapitalPool]);

  const prevData = budgetMap[financialYear - 1];
  const yoyBudgetChangePct =
    prevData && prevData.officialTotalBudget > 0
      ? ((data.officialTotalBudget - prevData.officialTotalBudget) / prevData.officialTotalBudget) * 100
      : null;

  const notifyCopied = (msg: string) => {
    setCopiedNotice(msg);
    setTimeout(() => setCopiedNotice(null), 2400);
  };

  const applyPreset = (oh: number, sw: number, sc: number) => {
    setOverheadCutPct(oh);
    setServiceWideCutPct(sw);
    setScrutinyCapitalCutPct(sc);
  };

  const handleSaveScenario = () => {
    const label = scenarioName.trim() || `FY ${financialYear} Plan (${overheadCutPct}/${serviceWideCutPct}/${scrutinyCapitalCutPct}%)`;
    const item: SavedScenario = {
      id: `sc-${Date.now()}`,
      name: label,
      financialYear,
      overheadCutPct,
      serviceWideCutPct,
      scrutinyCapitalCutPct,
      weights: { ...weights },
      totalFreedNaira: Math.round(totalFreedFunds),
      capitalShareShiftPct: Number(capitalShareShiftPct.toFixed(2)),
      phcsFunded: civicImpact.phcs,
      createdAt: Date.now(),
    };
    setSavedScenarios((prev) => [item, ...prev].slice(0, 8));
    setScenarioName('');
  };

  const handleLoadScenario = (sc: SavedScenario) => {
    setOverheadCutPct(sc.overheadCutPct);
    setServiceWideCutPct(sc.serviceWideCutPct);
    setScrutinyCapitalCutPct(sc.scrutinyCapitalCutPct);
    setWeights({ ...sc.weights });
    setSimulatorOpen(true);
  };

  const handleDeleteScenario = (id: string) => {
    setSavedScenarios((prev) => prev.filter((s) => s.id !== id));
  };

  const handleCopyAuditBrief = () => {
    const lines = [
      `FISCAL STRUCTURE AUDIT & RE-ALLOCATION BRIEF — FY ${financialYear}`,
      `Official Budget Total: ${fmtNaira(data.officialTotalBudget)} (${isExactMatch ? 'Reconciled' : `Delta: ${fmtNaira(discrepancyAmount)}`})`,
      `- Recurrent Non-Debt: ${fmtNaira(data.recurrentNonDebtTotal)} (${baselinePct.recurrent.toFixed(1)}%)`,
      `- Capital Expenditure: ${fmtNaira(data.totalCapitalBudget)} (${baselinePct.capital.toFixed(1)}%)`,
      `- Debt Service: ${fmtNaira(data.debtService)} (${baselinePct.debt.toFixed(1)}%)`,
      `- Statutory Transfers: ${fmtNaira(data.statutoryTransfers)} (${baselinePct.statutory.toFixed(1)}%)`,
      '',
      `SIMULATED RE-ALLOCATION (${overheadCutPct}% Overhead / ${serviceWideCutPct}% Service-Wide / ${scrutinyCapitalCutPct}% Flagged Capital):`,
      `- Total Freed Pool: ${fmtNaira(totalFreedFunds)} (Capital Share Shift: ${capitalShareShiftPct >= 0 ? '+' : ''}${capitalShareShiftPct.toFixed(2)} pts)`,
      `- Healthcare (${normalizedShares.health.toFixed(1)}%): ${fmtNaira(allocated.health)} -> ${civicImpact.phcs.toLocaleString()} PHCs or ${civicImpact.ambulances.toLocaleString()} ambulances`,
      `- Education (${normalizedShares.education.toFixed(1)}%): ${fmtNaira(allocated.education)} -> ${civicImpact.classroomBlocks.toLocaleString()} 3-classroom blocks or ${civicImpact.schoolMealsFed.toLocaleString()} annual child meals`,
      `- Water & Solar Power (${normalizedShares.waterPower.toFixed(1)}%): ${fmtNaira(allocated.waterPower)} -> ${civicImpact.boreholes.toLocaleString()} boreholes or ${civicImpact.miniGrids.toLocaleString()} mini-grids`,
      `- Rural Roads & Debt Offset (${normalizedShares.roadsDebt.toFixed(1)}%): ${fmtNaira(allocated.roadsDebt)} -> ${civicImpact.ruralRoadsKm.toLocaleString()} km paved rural road or ${civicImpact.debtOffsetPct.toFixed(2)}% Debt Service offset`,
    ].join('\n');
    navigator.clipboard.writeText(lines).then(() => notifyCopied('Fiscal brief copied to clipboard'));
  };

  const handleExportDoc = async (format: 'pdf' | 'docx') => {
    if (exportingFormat) return;
    setExportingFormat(format);
    try {
      const spec = {
        filenameBase: `BudgetLens_Fiscal_ReAllocator_FY${financialYear}`,
        eyebrow: `BUDGETLENS FISCAL STRUCTURE AUDIT · FY ${financialYear}`,
        title: `Fiscal Structure Audit & Citizen Re-Allocation Brief — FY ${financialYear}`,
        subtitle: `Enacted Budget Envelope vs Simulated Savings (${overheadCutPct}% Overhead / ${serviceWideCutPct}% Service-Wide / ${scrutinyCapitalCutPct}% Flagged Capital)`,
        orientation: 'portrait' as const,
        metadata: [
          { label: 'Official Budget', value: fmtNaira(data.officialTotalBudget) },
          { label: 'Freed Re-Allocation Pool', value: fmtNaira(totalFreedFunds) },
          { label: 'Capital Share Shift', value: `${capitalShareShiftPct >= 0 ? '+' : ''}${capitalShareShiftPct.toFixed(2)} pts` },
        ],
        kpis: [
          { label: 'Official Total', value: fmtNaira(data.officialTotalBudget), subtext: `FY ${financialYear} Enacted` },
          { label: 'Total Freed Pool', value: fmtNaira(totalFreedFunds), subtext: 'Combined 3-Lever Savings' },
          { label: 'PHCs Fundable', value: civicImpact.phcs.toLocaleString(), subtext: `Or ${civicImpact.ambulances.toLocaleString()} ambulances` },
          { label: 'School Blocks', value: civicImpact.classroomBlocks.toLocaleString(), subtext: `Or ${civicImpact.boreholes.toLocaleString()} boreholes` },
        ],
        tables: [
          {
            heading: 'Enacted Baseline Structure & Simulated Re-Allocation Schedule',
            columns: ['Section', 'Metric / Sector', 'Amount (Naira)', 'Share (%)', 'Civic Outcome / Notes'],
            rows: [
              ['Baseline', 'Recurrent Non-Debt', `₦${Math.round(data.recurrentNonDebtTotal).toLocaleString()}`, `${baselinePct.recurrent.toFixed(2)}%`, `Personnel ${fmtNaira(data.personnelCost)} | Overhead ${fmtNaira(data.overheadCost)}`],
              ['Baseline', 'Capital Expenditure', `₦${Math.round(data.totalCapitalBudget).toLocaleString()}`, `${baselinePct.capital.toFixed(2)}%`, `CDF ${fmtNaira(data.capitalDevelopmentFund)}`],
              ['Baseline', 'Debt Service', `₦${Math.round(data.debtService).toLocaleString()}`, `${baselinePct.debt.toFixed(2)}%`, `Domestic ${fmtNaira(data.domesticDebt)} | External ${fmtNaira(data.foreignDebt)}`],
              ['Baseline', 'Statutory Transfers', `₦${Math.round(data.statutoryTransfers).toLocaleString()}`, `${baselinePct.statutory.toFixed(2)}%`, 'Judiciary, INEC, NDDC, BHCPF & NASS'],
              ['Lever Savings', `Discretionary Overhead (${overheadCutPct}%)`, `₦${Math.round(overheadSavings).toLocaleString()}`, '-', overheadPoolLabel],
              ['Lever Savings', `Service-Wide Votes (${serviceWideCutPct}%)`, `₦${Math.round(serviceWideSavings).toLocaleString()}`, '-', 'Macro Service-Wide Pool'],
              ['Lever Savings', `Scrutiny Capital (${scrutinyCapitalCutPct}%)`, `₦${Math.round(scrutinyCapitalRedirect).toLocaleString()}`, '-', `${scrutinyFlaggedLineCount} flagged lines`],
              ['Re-Allocation', 'Primary Healthcare', `₦${Math.round(allocated.health).toLocaleString()}`, `${normalizedShares.health.toFixed(1)}%`, `${civicImpact.phcs.toLocaleString()} PHCs`],
              ['Re-Allocation', 'Basic Education', `₦${Math.round(allocated.education).toLocaleString()}`, `${normalizedShares.education.toFixed(1)}%`, `${civicImpact.classroomBlocks.toLocaleString()} Classroom Blocks`],
              ['Re-Allocation', 'Clean Water & Solar Power', `₦${Math.round(allocated.waterPower).toLocaleString()}`, `${normalizedShares.waterPower.toFixed(1)}%`, `${civicImpact.boreholes.toLocaleString()} Boreholes`],
              ['Re-Allocation', 'Rural Roads & Debt Relief', `₦${Math.round(allocated.roadsDebt).toLocaleString()}`, `${normalizedShares.roadsDebt.toFixed(1)}%`, `${civicImpact.ruralRoadsKm.toLocaleString()} km Roads / ${civicImpact.debtOffsetPct.toFixed(2)}% Debt`],
            ],
            rightAlignColumns: [2, 3],
          },
        ],
      };
      if (format === 'pdf') {
        await exportTabularDossierPdf(spec);
        notifyCopied(`Exported FY ${financialYear} Re-Allocator PDF`);
      } else {
        await exportTabularDossierDocx(spec);
        notifyCopied(`Exported FY ${financialYear} Re-Allocator DOCX`);
      }
    } finally {
      setExportingFormat(null);
    }
  };

  const pillarCards: Array<{
    key: 'recurrent' | 'capital' | 'debt' | 'statutory';
    label: string;
    amount: number;
    pct: number;
    accent: string;
    bg: string;
    subtext: string;
    icon: React.ReactNode;
  }> = [
    {
      key: 'recurrent',
      label: 'Recurrent (Non-Debt)',
      amount: data.recurrentNonDebtTotal,
      pct: baselinePct.recurrent,
      accent: '#2563eb',
      bg: '#eff6ff',
      subtext: `Personnel ${fmtNaira(data.personnelCost)} · Overhead ${fmtNaira(data.overheadCost)}`,
      icon: <Building2 size={16} color="#2563eb" />,
    },
    {
      key: 'capital',
      label: 'Capital Expenditure',
      amount: data.totalCapitalBudget,
      pct: baselinePct.capital,
      accent: '#059669',
      bg: '#ecfdf5',
      subtext: `CDF ${fmtNaira(data.capitalDevelopmentFund)} · Supplementation ${fmtNaira(data.capitalSupplementation)}`,
      icon: <Wrench size={16} color="#059669" />,
    },
    {
      key: 'debt',
      label: 'Debt Service',
      amount: data.debtService,
      pct: baselinePct.debt,
      accent: '#b91c1c',
      bg: '#fef2f2',
      subtext: `Domestic ${fmtNaira(data.domesticDebt)} · Foreign ${fmtNaira(data.foreignDebt)}`,
      icon: <TrendingDown size={16} color="#b91c1c" />,
    },
    {
      key: 'statutory',
      label: 'Statutory Transfers',
      amount: data.statutoryTransfers,
      pct: baselinePct.statutory,
      accent: '#6d28d9',
      bg: '#f5f3ff',
      subtext: `Judiciary, INEC, NDDC, BHCPF & NASS`,
      icon: <Landmark size={16} color="#6d28d9" />,
    },
  ];

  return (
    <section
      className="dossier-card"
      style={{
        padding: '1.35rem 1.5rem',
        margin: '0 0 1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.1rem',
      }}
      aria-label={`FY ${financialYear} Fiscal Audit and Re-Allocator`}
    >
      {copiedNotice && (
        <div
          style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            backgroundColor: '#091017',
            color: '#10b981',
            padding: '0.55rem 0.95rem',
            borderRadius: '7px',
            fontSize: '0.78rem',
            fontWeight: 600,
            zIndex: 2000,
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
          }}
        >
          <Check size={14} /> {copiedNotice}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.85rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.2rem' }}>
            <Calculator size={14} style={{ color: 'var(--accent-primary)' }} />
            <span className="font-mono" style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--accent-primary)' }}>
              FY {financialYear} Fiscal Structure Audit &amp; Re-Allocator
            </span>
          </div>
          <h2 className="font-editorial" style={{ margin: 0, fontSize: '1.38rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Statutory Expenditure Structure &amp; Citizen Re-Allocation Simulator
          </h2>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.77rem', color: 'var(--text-muted)' }}>
            Reconciles 4 statutory budget pillars against {fmtNaira(data.officialTotalBudget)} and models shifting non-essential outlays into health, education, water/power, and debt reduction.
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setShowYearComparison((prev) => !prev)}
            style={{
              padding: '0.38rem 0.7rem',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: showYearComparison ? '#091017' : '#ffffff',
              color: showYearComparison ? '#ffffff' : 'var(--text-secondary)',
              fontSize: '0.74rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
            }}
          >
            <TrendingUp size={13} /> YoY Audit
          </button>

          <button
            type="button"
            onClick={handleCopyAuditBrief}
            style={{
              padding: '0.38rem 0.7rem',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: '#ffffff',
              color: 'var(--text-secondary)',
              fontSize: '0.74rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
            }}
          >
            <Copy size={13} /> Copy Brief
          </button>

          <button
            type="button"
            onClick={() => handleExportDoc('pdf')}
            disabled={exportingFormat !== null}
            style={{
              padding: '0.38rem 0.65rem',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: '#ffffff',
              color: 'var(--text-secondary)',
              fontSize: '0.74rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
            }}
          >
            <FileText size={13} color="#059669" /> {exportingFormat === 'pdf' ? 'PDF...' : 'PDF'}
          </button>

          <button
            type="button"
            onClick={() => handleExportDoc('docx')}
            disabled={exportingFormat !== null}
            style={{
              padding: '0.38rem 0.65rem',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: '#ffffff',
              color: 'var(--text-secondary)',
              fontSize: '0.74rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
            }}
          >
            <Download size={13} /> {exportingFormat === 'docx' ? 'DOCX...' : 'DOCX'}
          </button>

          <button
            type="button"
            onClick={() => setSimulatorOpen((prev) => !prev)}
            style={{
              padding: '0.42rem 0.85rem',
              borderRadius: '7px',
              border: '1px solid #059669',
              backgroundColor: simulatorOpen ? '#091017' : '#059669',
              color: '#ffffff',
              fontSize: '0.76rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
            }}
          >
            <Sliders size={14} /> {simulatorOpen ? 'Hide Re-Allocator' : 'Open Fiscal Re-Allocator'}
          </button>
        </div>
      </div>

      {/* YoY Comparison Drawer Strip */}
      {showYearComparison && prevData && (
        <div
          style={{
            padding: '0.8rem 1rem',
            borderRadius: '8px',
            backgroundColor: 'var(--bg-canvas)',
            border: '1px solid var(--border-subtle)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: '0.75rem',
          }}
        >
          <div>
            <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>FY {financialYear - 1} Total</div>
            <div className="font-mono tabular-nums" style={{ fontSize: '0.95rem', fontWeight: 700 }}>{fmtNaira(prevData.officialTotalBudget)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>FY {financialYear} Total</div>
            <div className="font-mono tabular-nums" style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--accent-primary)' }}>{fmtNaira(data.officialTotalBudget)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Nominal Envelope Shift</div>
            <div className="font-mono tabular-nums" style={{ fontSize: '0.95rem', fontWeight: 700, color: (yoyBudgetChangePct || 0) >= 0 ? '#059669' : '#b45309' }}>
              {yoyBudgetChangePct !== null ? `${yoyBudgetChangePct >= 0 ? '+' : ''}${yoyBudgetChangePct.toFixed(1)}%` : '—'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Capital YoY Delta</div>
            <div className="font-mono tabular-nums" style={{ fontSize: '0.95rem', fontWeight: 700 }}>
              {prevData.totalCapitalBudget > 0
                ? `${(((data.totalCapitalBudget - prevData.totalCapitalBudget) / prevData.totalCapitalBudget) * 100).toFixed(1)}%`
                : '—'}
            </div>
          </div>
        </div>
      )}

      {/* Always-Visible Proportional Composition Bar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.73rem' }}>
          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
            Enacted Statutory Split (FY {financialYear})
          </span>
          <span className="font-mono tabular-nums" style={{ color: isExactMatch ? '#059669' : '#b45309', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
            <CheckCircle2 size={13} /> Σ = {fmtNaira(calculatedSum)} {isExactMatch ? '(Exact Reconciliation)' : `(Residual ${fmtNaira(discrepancyAmount)})`}
          </span>
        </div>

        <div style={{ height: '14px', width: '100%', borderRadius: '6px', overflow: 'hidden', display: 'flex', border: '1px solid var(--border-subtle)' }}>
          <div style={{ width: `${baselinePct.recurrent}%`, backgroundColor: '#2563eb' }} title={`Recurrent: ${baselinePct.recurrent.toFixed(1)}%`} />
          <div style={{ width: `${baselinePct.capital}%`, backgroundColor: '#059669' }} title={`Capital: ${baselinePct.capital.toFixed(1)}%`} />
          <div style={{ width: `${baselinePct.debt}%`, backgroundColor: '#b91c1c' }} title={`Debt Service: ${baselinePct.debt.toFixed(1)}%`} />
          <div style={{ width: `${baselinePct.statutory}%`, backgroundColor: '#6d28d9' }} title={`Statutory: ${baselinePct.statutory.toFixed(1)}%`} />
        </div>

        {simulatorOpen && totalFreedFunds > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.71rem' }}>
              <span style={{ fontWeight: 700, color: '#059669' }}>Simulated Post-Reform Structure</span>
              <span className="font-mono tabular-nums" style={{ color: '#059669', fontWeight: 700 }}>
                Capital Share: {baselinePct.capital.toFixed(1)}% → {simulatedPct.capital.toFixed(1)}% ({capitalShareShiftPct >= 0 ? '+' : ''}{capitalShareShiftPct.toFixed(2)} pts)
              </span>
            </div>
            <div style={{ height: '12px', width: '100%', borderRadius: '6px', overflow: 'hidden', display: 'flex', border: '1px solid #a7f3d0' }}>
              <div style={{ width: `${simulatedPct.recurrent}%`, backgroundColor: '#60a5fa', transition: 'width 0.25s ease' }} />
              <div style={{ width: `${simulatedPct.capital}%`, backgroundColor: '#10b981', transition: 'width 0.25s ease' }} />
              <div style={{ width: `${simulatedPct.debt}%`, backgroundColor: '#ef4444', transition: 'width 0.25s ease' }} />
              <div style={{ width: `${simulatedPct.statutory}%`, backgroundColor: '#8b5cf6', transition: 'width 0.25s ease' }} />
            </div>
          </div>
        )}
      </div>

      {/* 4-Column Statutory Pillar Cards */}
      <div className="grid-4-cols">
        {pillarCards.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setActiveModalPillar(p.key)}
            style={{
              textAlign: 'left',
              padding: '0.9rem 1rem',
              borderRadius: '8px',
              backgroundColor: 'var(--bg-canvas)',
              border: '1px solid var(--border-subtle)',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.35rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.73rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                {p.icon} {p.label}
              </span>
              <span className="font-mono tabular-nums" style={{ fontSize: '0.72rem', fontWeight: 700, color: p.accent, backgroundColor: p.bg, padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                {p.pct.toFixed(1)}%
              </span>
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {fmtNaira(p.amount)}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>
              {p.subtext}
            </div>
          </button>
        ))}
      </div>

      {/* Objective Fiscal Risk Signals */}
      {riskSignals.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {riskSignals.map((sig, i) => (
            <div
              key={i}
              title={sig.detail}
              style={{
                flex: '1 1 250px',
                padding: '0.55rem 0.75rem',
                borderRadius: '6px',
                backgroundColor: sig.severity === 'high' ? '#fef2f2' : sig.severity === 'medium' ? '#fffbeb' : 'var(--bg-canvas)',
                border: `1px solid ${sig.severity === 'high' ? '#fecaca' : sig.severity === 'medium' ? '#fde68a' : 'var(--border-subtle)'}`,
                fontSize: '0.74rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.45rem',
              }}
            >
              <AlertTriangle size={14} style={{ color: sig.severity === 'high' ? '#b91c1c' : sig.severity === 'medium' ? '#b45309' : '#64748b', flexShrink: 0, marginTop: '0.1rem' }} />
              <div>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{sig.title}</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.71rem' }}>{sig.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* INLINE EXPANDABLE MULTI-LEVER RE-ALLOCATOR WORKBENCH */}
      {simulatorOpen && (
        <div
          style={{
            marginTop: '0.25rem',
            padding: '1.25rem',
            borderRadius: '10px',
            backgroundColor: 'var(--bg-canvas)',
            border: '1px solid #a7f3d0',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
          }}
        >
          {/* Simulator Masthead & Presets */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.85rem' }}>
            <div>
              <h3 className="font-editorial" style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Multi-Lever Civic Re-Allocation Model (FY {financialYear})
              </h3>
              <p style={{ margin: '0.15rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Adjust cuts across three source pools below; funds are redistributed strictly at 100% across four public priorities.
              </p>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {[
                { label: 'Baseline (0%)', oh: 0, sw: 0, sc: 0 },
                { label: 'Targeted Scrutiny', oh: 25, sw: 10, sc: 50 },
                { label: 'Austerity Pivot', oh: 40, sw: 25, sc: 75 },
                { label: 'Max Efficiency', oh: 50, sw: 35, sc: 100 },
              ].map((pr) => (
                <button
                  key={pr.label}
                  type="button"
                  onClick={() => applyPreset(pr.oh, pr.sw, pr.sc)}
                  style={{
                    padding: '0.32rem 0.65rem',
                    borderRadius: '5px',
                    border: '1px solid var(--border-subtle)',
                    backgroundColor:
                      overheadCutPct === pr.oh && serviceWideCutPct === pr.sw && scrutinyCapitalCutPct === pr.sc
                        ? '#091017'
                        : '#ffffff',
                    color:
                      overheadCutPct === pr.oh && serviceWideCutPct === pr.sw && scrutinyCapitalCutPct === pr.sc
                        ? '#ffffff'
                        : 'var(--text-secondary)',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {pr.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  applyPreset(25, 10, 50);
                  setWeights({ health: 30, education: 30, waterPower: 20, roadsDebt: 20 });
                }}
                title="Reset Simulator"
                style={{
                  padding: '0.32rem 0.6rem',
                  borderRadius: '5px',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: '#ffffff',
                  color: 'var(--text-secondary)',
                  fontSize: '0.72rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                }}
              >
                <RotateCcw size={12} /> Reset
              </button>
            </div>
          </div>

          {/* 3 Source Levers Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '0.85rem' }}>
            {/* Lever 1: Discretionary Overhead */}
            <div style={{ padding: '0.9rem', borderRadius: '8px', backgroundColor: '#ffffff', border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>1. Discretionary Overhead Cut</span>
                <span className="font-mono tabular-nums" style={{ fontSize: '0.82rem', fontWeight: 700, color: '#b91c1c' }}>{overheadCutPct}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={50}
                step={1}
                value={overheadCutPct}
                onChange={(e) => setOverheadCutPct(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#059669', cursor: 'pointer' }}
              />
              <div className="font-mono tabular-nums" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'flex', justifyContent: 'space-between' }}>
                <span>Pool: {fmtNaira(overheadPool)}</span>
                <strong style={{ color: '#059669' }}>+{fmtNaira(overheadSavings)}</strong>
              </div>
              <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{overheadPoolLabel}</div>
            </div>

            {/* Lever 2: Service-Wide Votes */}
            <div style={{ padding: '0.9rem', borderRadius: '8px', backgroundColor: '#ffffff', border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>2. Service-Wide Votes Trim</span>
                <span className="font-mono tabular-nums" style={{ fontSize: '0.82rem', fontWeight: 700, color: '#b91c1c' }}>{serviceWideCutPct}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={40}
                step={1}
                value={serviceWideCutPct}
                onChange={(e) => setServiceWideCutPct(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#059669', cursor: 'pointer' }}
              />
              <div className="font-mono tabular-nums" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'flex', justifyContent: 'space-between' }}>
                <span>Pool: {fmtNaira(data.serviceWideVotes)}</span>
                <strong style={{ color: '#059669' }}>+{fmtNaira(serviceWideSavings)}</strong>
              </div>
              <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>Unallocated contingency &amp; service-wide votes</div>
            </div>

            {/* Lever 3: Scrutiny-Flagged Capital */}
            <div style={{ padding: '0.9rem', borderRadius: '8px', backgroundColor: '#ffffff', border: '1px solid var(--border-subtle)', opacity: extractedScrutinyCapitalPool > 0 ? 1 : 0.65 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>3. Flagged Capital Redirect</span>
                <span className="font-mono tabular-nums" style={{ fontSize: '0.82rem', fontWeight: 700, color: '#b91c1c' }}>
                  {extractedScrutinyCapitalPool > 0 ? `${scrutinyCapitalCutPct}%` : 'N/A'}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                disabled={extractedScrutinyCapitalPool <= 0}
                value={scrutinyCapitalCutPct}
                onChange={(e) => setScrutinyCapitalCutPct(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#059669', cursor: extractedScrutinyCapitalPool > 0 ? 'pointer' : 'not-allowed' }}
              />
              <div className="font-mono tabular-nums" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'flex', justifyContent: 'space-between' }}>
                <span>Pool: {fmtNaira(extractedScrutinyCapitalPool)}</span>
                <strong style={{ color: '#059669' }}>+{fmtNaira(scrutinyCapitalRedirect)}</strong>
              </div>
              <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                {scrutinyFlaggedLineCount > 0
                  ? `${scrutinyFlaggedLineCount.toLocaleString()} mandate/fleet/vague ERGP lines`
                  : 'Requires detailed line-item schedule (1999–2008 acts lack ERGP)'}
              </div>
            </div>
          </div>

          {/* Freed Pool Banner + 100% Normalized Weight Sliders */}
          <div style={{ padding: '1rem', borderRadius: '8px', backgroundColor: '#091017', color: '#ffffff', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <div className="font-mono" style={{ fontSize: '0.68rem', color: '#10b981', fontWeight: 700, textTransform: 'uppercase' }}>
                  Total Re-Allocatable Public Pool (FY {financialYear})
                </div>
                <div className="font-mono tabular-nums" style={{ fontSize: '1.6rem', fontWeight: 700, color: '#ffffff' }}>
                  {fmtNaira(totalFreedFunds)}
                </div>
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                100.0% Normalized Split · Inflation Index {inflationFactor.toFixed(2)}× (vs 2023)
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: '0.75rem' }}>
              {[
                { key: 'health', label: 'Primary Healthcare', share: normalizedShares.health, amt: allocated.health },
                { key: 'education', label: 'Basic Education', share: normalizedShares.education, amt: allocated.education },
                { key: 'waterPower', label: 'Water & Rural Power', share: normalizedShares.waterPower, amt: allocated.waterPower },
                { key: 'roadsDebt', label: 'Rural Roads & Debt Relief', share: normalizedShares.roadsDebt, amt: allocated.roadsDebt },
              ].map((w) => (
                <div key={w.key} style={{ padding: '0.6rem 0.75rem', borderRadius: '6px', backgroundColor: '#111827', border: '1px solid #1f2937' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', marginBottom: '0.25rem' }}>
                    <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{w.label}</span>
                    <span className="font-mono tabular-nums" style={{ color: '#10b981', fontWeight: 700 }}>{w.share.toFixed(1)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={weights[w.key as keyof ReallocationWeights]}
                    onChange={(e) =>
                      setWeights((prev) => ({
                        ...prev,
                        [w.key]: Number(e.target.value),
                      }))
                    }
                    style={{ width: '100%', accentColor: '#10b981', cursor: 'pointer' }}
                  />
                  <div className="font-mono tabular-nums" style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.2rem' }}>
                    {fmtNaira(w.amt)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 4-Column Verifiable Civic Opportunity-Cost Cards */}
          <div className="grid-4-cols">
            <div style={{ padding: '0.9rem', borderRadius: '8px', backgroundColor: '#ffffff', border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.74rem', fontWeight: 700, color: '#059669' }}>
                <HeartPulse size={15} /> Primary Healthcare
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0.3rem 0 0.15rem' }}>
                {civicImpact.phcs.toLocaleString()} PHCs
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '0.73rem', color: 'var(--text-secondary)' }}>
                or {civicImpact.ambulances.toLocaleString()} equipped ambulances
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                Unit base: {fmtNaira(unitCosts.phc)}/PHC
              </div>
            </div>

            <div style={{ padding: '0.9rem', borderRadius: '8px', backgroundColor: '#ffffff', border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.74rem', fontWeight: 700, color: '#2563eb' }}>
                <GraduationCap size={15} /> Basic Education
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0.3rem 0 0.15rem' }}>
                {civicImpact.classroomBlocks.toLocaleString()} Blocks
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '0.73rem', color: 'var(--text-secondary)' }}>
                or {civicImpact.schoolMealsFed.toLocaleString()} pupils fed/yr
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                Unit base: {fmtNaira(unitCosts.classroomBlock)}/block
              </div>
            </div>

            <div style={{ padding: '0.9rem', borderRadius: '8px', backgroundColor: '#ffffff', border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.74rem', fontWeight: 700, color: '#d97706' }}>
                <ShieldAlert size={15} /> Water &amp; Rural Power
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0.3rem 0 0.15rem' }}>
                {civicImpact.boreholes.toLocaleString()} Boreholes
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '0.73rem', color: 'var(--text-secondary)' }}>
                or {civicImpact.miniGrids.toLocaleString()} 100-home mini-grids
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                Unit base: {fmtNaira(unitCosts.solarBorehole)}/borehole
              </div>
            </div>

            <div style={{ padding: '0.9rem', borderRadius: '8px', backgroundColor: '#ffffff', border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.74rem', fontWeight: 700, color: '#6d28d9' }}>
                <Waypoints size={15} /> Rural Roads &amp; Debt Relief
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0.3rem 0 0.15rem' }}>
                {civicImpact.ruralRoadsKm.toLocaleString()} km Paved
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '0.73rem', color: 'var(--text-secondary)' }}>
                or {civicImpact.debtOffsetPct.toFixed(2)}% Debt Service offset
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                Unit base: {fmtNaira(unitCosts.ruralRoadKm)}/km
              </div>
            </div>
          </div>

          {/* Save & Compare Scenarios */}
          <div style={{ padding: '0.9rem', borderRadius: '8px', backgroundColor: '#ffffff', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Saved Policy Scenarios ({savedScenarios.length})
              </span>
              <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  type="text"
                  value={scenarioName}
                  onChange={(e) => setScenarioName(e.target.value)}
                  placeholder="Name scenario (e.g. PHC Priority Cut)..."
                  style={{
                    padding: '0.36rem 0.65rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-subtle)',
                    backgroundColor: 'var(--bg-canvas)',
                    fontSize: '0.76rem',
                    width: '230px',
                  }}
                />
                <button
                  type="button"
                  onClick={handleSaveScenario}
                  style={{
                    padding: '0.38rem 0.75rem',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: '#059669',
                    color: '#ffffff',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                  }}
                >
                  <BookmarkPlus size={13} /> Save Scenario
                </button>
              </div>
            </div>

            {savedScenarios.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', textAlign: 'left' }}>
                      <th style={{ padding: '0.4rem 0.5rem' }}>Scenario</th>
                      <th style={{ padding: '0.4rem 0.5rem' }}>FY</th>
                      <th style={{ padding: '0.4rem 0.5rem' }}>Cuts (OH / SWV / Cap)</th>
                      <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>Total Freed</th>
                      <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>Capital Shift</th>
                      <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>PHCs Eqv</th>
                      <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {savedScenarios.map((sc) => (
                      <tr key={sc.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '0.42rem 0.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>{sc.name}</td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.42rem 0.5rem' }}>{sc.financialYear}</td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.42rem 0.5rem', color: 'var(--text-secondary)' }}>
                          {sc.overheadCutPct}% / {sc.serviceWideCutPct}% / {sc.scrutinyCapitalCutPct}%
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.42rem 0.5rem', textAlign: 'right', fontWeight: 700, color: '#059669' }}>
                          {fmtNaira(sc.totalFreedNaira)}
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.42rem 0.5rem', textAlign: 'right', fontWeight: 600 }}>
                          +{sc.capitalShareShiftPct.toFixed(2)} pts
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.42rem 0.5rem', textAlign: 'right' }}>
                          {sc.phcsFunded.toLocaleString()}
                        </td>
                        <td style={{ padding: '0.42rem 0.5rem', textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                            <button
                              type="button"
                              onClick={() => handleLoadScenario(sc)}
                              style={{ padding: '0.18rem 0.45rem', borderRadius: '4px', border: '1px solid var(--border-subtle)', backgroundColor: '#ffffff', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer' }}
                            >
                              Load
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteScenario(sc.id)}
                              aria-label="Delete Scenario"
                              style={{ padding: '0.18rem 0.35rem', borderRadius: '4px', border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#b91c1c', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Clean Sub-Pillar Inspection Modal */}
      {activeModalPillar && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.72)',
            backdropFilter: 'blur(4px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.25rem',
          }}
          onClick={() => setActiveModalPillar(null)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '620px',
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.3)',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '1.2rem 1.4rem', backgroundColor: '#091017', color: '#ffffff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="font-mono" style={{ fontSize: '0.68rem', color: '#10b981', fontWeight: 700, textTransform: 'uppercase' }}>
                  FY {financialYear} Statutory Pillar Sub-Breakdown
                </div>
                <h3 className="font-editorial" style={{ margin: '0.15rem 0 0', fontSize: '1.25rem', fontWeight: 600, color: '#ffffff' }}>
                  {activeModalPillar === 'recurrent' && 'Recurrent Non-Debt Expenditure'}
                  {activeModalPillar === 'capital' && 'Capital Expenditure Envelope'}
                  {activeModalPillar === 'debt' && 'Consolidated Debt Service'}
                  {activeModalPillar === 'statutory' && 'Statutory Transfers'}
                </h3>
              </div>
              <button type="button" onClick={() => setActiveModalPillar(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '1.1rem 1.4rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
              {(activeModalPillar === 'recurrent'
                ? [
                    { label: 'Personnel Cost (MDAs & Agencies)', val: data.personnelCost },
                    { label: 'Overhead Cost (Travel, Utilities, Operations)', val: data.overheadCost },
                    { label: 'Pensions, Gratuities & Retirees', val: data.pensionsAndGratuities },
                    { label: 'Service-Wide Votes & Contingency', val: data.serviceWideVotes },
                  ]
                : activeModalPillar === 'capital'
                ? [
                    { label: 'Capital Development Fund (Main MDAs)', val: data.capitalDevelopmentFund },
                    { label: 'Capital Supplementation & Special Projects', val: data.capitalSupplementation },
                  ]
                : activeModalPillar === 'debt'
                ? [
                    { label: 'Domestic Debt Servicing (FGN Bonds & NTBs)', val: data.domesticDebt },
                    { label: 'External Debt Servicing (Multilateral & Eurobonds)', val: data.foreignDebt },
                  ]
                : [
                    { label: 'National Judicial Council (Judiciary)', val: data.judiciaryTransfer },
                    { label: 'INEC Electoral Operations', val: data.inecTransfer },
                    { label: 'Niger Delta Development Commission (NDDC)', val: data.nddcTransfer },
                    { label: 'Basic Healthcare Provision Fund (BHCPF)', val: data.bhcpfTransfer },
                  ]
              ).map((row) => (
                <div
                  key={row.label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.65rem 0.8rem',
                    borderRadius: '7px',
                    backgroundColor: 'var(--bg-canvas)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.82rem',
                  }}
                >
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{row.label}</span>
                  <span className="font-mono tabular-nums" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                    {fmtNaira(row.val)} ({((row.val / safeTotal) * 100).toFixed(1)}%)
                  </span>
                </div>
              ))}
            </div>

            <div style={{ padding: '0.95rem 1.4rem', backgroundColor: 'var(--bg-canvas)', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => {
                  setActiveModalPillar(null);
                  setSimulatorOpen(true);
                }}
                style={{
                  padding: '0.45rem 0.9rem',
                  borderRadius: '6px',
                  border: '1px solid #059669',
                  backgroundColor: '#059669',
                  color: '#ffffff',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                }}
              >
                <Sliders size={13} /> Simulate Cuts on This Budget
              </button>
              <button
                type="button"
                onClick={() => setActiveModalPillar(null)}
                style={{ padding: '0.45rem 0.9rem', borderRadius: '6px', border: '1px solid var(--border-subtle)', backgroundColor: '#ffffff', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
