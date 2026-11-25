/**
 * Citizen Accountability & Personal Taxpayer Breakdown Utilities.
 * Computes realistic Nigerian PAYE (PITA) + VAT estimates, maps them proportionally
 * to official Federal Budget shares + historical BIR execution rates, and surfaces
 * plain-English fiscal verdicts and "In My Neighborhood" Paid-on-Paper project lookups.
 */

import type { BudgetRecord } from '../services/budgetDatabaseEngine';
import { getMacroForYear } from '../data/historicalMacroData';
import { lookupConstituency } from '../data/constituenciesDirectory';
import { lookupScrutinyBadge, type ProjectLifecycleIndex } from './projectLifecycle';
import {
  lookupOaugfMdaFindings,
  type MacroCredibilityTrackerPayload,
  type OaugfAuditIndexPayload,
} from './mdaScorecard';
import {
  buildCompoundProjectLookup,
  extractCanonicalProjectCode,
  findCompoundForProject,
  type CompoundFlaggedProject,
} from './ruleEngine';
import {
  lookupMdaRiskProfile,
  type CrossLedgerContextWire,
} from './evidenceEngineV3';

export interface CitizenTaxPreset {
  id: string;
  label: string;
  monthlyIncomeNaira: number;
  monthlyTaxableSpendNaira: number;
  description: string;
}

export const CITIZEN_INCOME_PRESETS: CitizenTaxPreset[] = [
  {
    id: 'min-wage',
    label: 'Minimum Wage (₦70k/mo)',
    monthlyIncomeNaira: 70_000,
    monthlyTaxableSpendNaira: 25_000,
    description: 'New national minimum wage earner',
  },
  {
    id: 'civil-servant',
    label: 'Civil Servant (₦180k/mo)',
    monthlyIncomeNaira: 180_000,
    monthlyTaxableSpendNaira: 65_000,
    description: 'Mid-level public/private sector worker',
  },
  {
    id: 'mid-career',
    label: 'Mid-Career (₦450k/mo)',
    monthlyIncomeNaira: 450_000,
    monthlyTaxableSpendNaira: 160_000,
    description: 'Urban salaried professional',
  },
  {
    id: 'senior-pro',
    label: 'Senior Prof. (₦1.2M/mo)',
    monthlyIncomeNaira: 1_200_000,
    monthlyTaxableSpendNaira: 420_000,
    description: 'Senior manager / business owner',
  },
];

export interface TaxAllocationSlice {
  key: 'debt' | 'personnel' | 'overhead' | 'capital' | 'statutory';
  label: string;
  sharePct: number;
  annualNaira: number;
  plainMeaning: string;
  deliveredNaira?: number;
  unexecutedGapNaira?: number;
}

export interface CitizenTaxReceipt {
  financialYear: number;
  monthlyIncomeNaira: number;
  annualGrossIncomeNaira: number;
  estimatedAnnualPayeNaira: number;
  estimatedAnnualVatNaira: number;
  estimatedTotalAnnualTaxNaira: number;
  effectiveTaxRatePct: number;
  capitalExecutionRatePct: number | null;
  slices: TaxAllocationSlice[];
}

/** Compute annual Nigeria Personal Income Tax (PITA) under statutory CRA + progressive bands. */
export function computeAnnualNigeriaPaye(annualGrossIncome: number): number {
  const gross = Math.max(0, Number(annualGrossIncome) || 0);
  if (gross <= 840_000) return 0; // Statutory national minimum wage exemption (₦70,000/mo)

  const cra = Math.max(200_000, gross * 0.01) + gross * 0.2;
  const taxable = Math.max(0, gross - cra);
  if (taxable <= 0) {
    // Statutory minimum tax 1% of gross if taxable income <= 0 (for earners above minimum wage)
    return gross > 840_000 ? Math.round(gross * 0.01) : 0;
  }

  const bands: Array<[number, number]> = [
    [300_000, 0.07],
    [300_000, 0.11],
    [500_000, 0.15],
    [500_000, 0.19],
    [1_600_000, 0.21],
    [Number.POSITIVE_INFINITY, 0.24],
  ];

  let remaining = taxable;
  let tax = 0;
  for (const [cap, rate] of bands) {
    if (remaining <= 0) break;
    const chunk = Math.min(remaining, cap);
    tax += chunk * rate;
    remaining -= chunk;
  }
  return Math.round(Math.max(tax, gross > 840_000 ? gross * 0.01 : 0));
}

export function buildCitizenTaxReceipt(args: {
  financialYear: number;
  monthlyIncomeNaira: number;
  monthlyTaxableSpendNaira?: number;
  macroCredibility?: MacroCredibilityTrackerPayload | null;
}): CitizenTaxReceipt {
  const { financialYear, monthlyIncomeNaira, monthlyTaxableSpendNaira, macroCredibility } = args;
  const monthly = Math.max(0, Number(monthlyIncomeNaira) || 0);
  const annualGross = monthly * 12;
  const paye = computeAnnualNigeriaPaye(annualGross);
  const taxableSpendMonthly =
    monthlyTaxableSpendNaira !== undefined
      ? Math.max(0, Number(monthlyTaxableSpendNaira) || 0)
      : Math.round(monthly * 0.35);
  const annualVat = Math.round(taxableSpendMonthly * 12 * 0.075);
  const totalTax = paye + annualVat;

  const macro = getMacroForYear(financialYear);
  const officialTotal = Math.max(1, macro.officialTotalBudget);

  const debtShare = macro.debtService / officialTotal;
  const personnelShare = macro.personnelCost / officialTotal;
  const overheadShare =
    Math.max(0, macro.recurrentNonDebtTotal - macro.personnelCost) / officialTotal;
  const capitalShare = macro.totalCapitalBudget / officialTotal;
  const statutoryShare = Math.max(
    0,
    1 - debtShare - personnelShare - overheadShare - capitalShare
  );

  const yrCred = macroCredibility?.yearlySeries?.find((y) => y.financialYear === financialYear);
  const capExecPct =
    yrCred?.bir?.capitalPerformancePct ??
    macroCredibility?.headline?.meanCapitalPerformancePct ??
    null;

  const capitalAnnual = Math.round(totalTax * capitalShare);
  const deliveredCapital =
    capExecPct !== null
      ? Math.round(capitalAnnual * Math.min(1, Math.max(0, capExecPct / 100)))
      : undefined;
  const capitalGap =
    deliveredCapital !== undefined ? Math.max(0, capitalAnnual - deliveredCapital) : undefined;

  const slices: TaxAllocationSlice[] = [
    {
      key: 'debt',
      label: 'Debt Service (Past Loans)',
      sharePct: Number((debtShare * 100).toFixed(1)),
      annualNaira: Math.round(totalTax * debtShare),
      plainMeaning: 'Pays interest and principal on domestic & foreign loans before roads or schools.',
    },
    {
      key: 'personnel',
      label: 'Salaries & Pensions',
      sharePct: Number((personnelShare * 100).toFixed(1)),
      annualNaira: Math.round(totalTax * personnelShare),
      plainMeaning: 'Federal civil service, security, and military payroll.',
    },
    {
      key: 'overhead',
      label: 'Running Costs & Service-Wide',
      sharePct: Number((overheadShare * 100).toFixed(1)),
      annualNaira: Math.round(totalTax * overheadShare),
      plainMeaning: 'Ministry travel, vehicles, utilities, allowances, and central contingency votes.',
    },
    {
      key: 'capital',
      label: 'Capital Projects (Roads, Health, Power)',
      sharePct: Number((capitalShare * 100).toFixed(1)),
      annualNaira: capitalAnnual,
      plainMeaning:
        capExecPct !== null
          ? `Only ~${capExecPct.toFixed(1)}% of capital budgets historically reach cash execution.`
          : 'Budgeted physical infrastructure, clinics, classrooms, and power.',
      deliveredNaira: deliveredCapital,
      unexecutedGapNaira: capitalGap,
    },
    {
      key: 'statutory',
      label: 'Statutory Transfers (Judiciary, INEC, Health Fund)',
      sharePct: Number((statutoryShare * 100).toFixed(1)),
      annualNaira: Math.round(totalTax * statutoryShare),
      plainMeaning: 'Constitutional first-line transfers including Basic Health Care & UBEC.',
    },
  ];

  return {
    financialYear,
    monthlyIncomeNaira: monthly,
    annualGrossIncomeNaira: annualGross,
    estimatedAnnualPayeNaira: paye,
    estimatedAnnualVatNaira: annualVat,
    estimatedTotalAnnualTaxNaira: totalTax,
    effectiveTaxRatePct: annualGross > 0 ? Number(((totalTax / annualGross) * 100).toFixed(1)) : 0,
    capitalExecutionRatePct: capExecPct,
    slices,
  };
}

export interface NeighborhoodProjectHit {
  id: string;
  projectCode: string;
  projectName: string;
  mdaName: string;
  state: string;
  lga: string;
  constituency: string | null;
  senatorialDistrict: string | null;
  financialYear: number;
  amountNaira: number;
  paidOnPaper: boolean;
  contractorName: string | null;
  contractAwardNaira: number;
  disbursedNaira: number;
  page: number;
  compoundRiskScore?: number | null;
  ruleCount?: number;
  billInsertedOrInflated?: boolean;
  oaugfMdaQueries?: number;
  oaugfMdaRepeatNeglect?: number;
  mdaIntegrityGrade?: string | null;
}

export interface LocalAccountabilitySummary {
  totalMatchedCount: number;
  totalBudgetedNaira: number;
  paidOnPaperCount: number;
  paidOnPaperDisbursedNaira: number;
  billInsertedCount: number;
  flaggedCompoundCount: number;
  highRiskCount: number;
  oaugfIndictedMdaCount: number;
  oaugfTotalMdaQueries: number;
  topOaugfMdas: Array<{
    mdaName: string;
    projectCount: number;
    oaugfQueries: number;
    repeatNeglect: number;
  }>;
}

export function buildLocalAccountabilitySummary(
  hits: NeighborhoodProjectHit[]
): LocalAccountabilitySummary {
  let totalBudgetedNaira = 0;
  let paidOnPaperCount = 0;
  let paidOnPaperDisbursedNaira = 0;
  let billInsertedCount = 0;
  let flaggedCompoundCount = 0;
  let highRiskCount = 0;

  const oaugfMdaMap = new Map<
    string,
    { mdaName: string; projectCount: number; oaugfQueries: number; repeatNeglect: number }
  >();

  for (const h of hits) {
    totalBudgetedNaira += h.amountNaira || 0;
    if (h.paidOnPaper) {
      paidOnPaperCount += 1;
      paidOnPaperDisbursedNaira += h.disbursedNaira || 0;
    }
    if (h.billInsertedOrInflated) billInsertedCount += 1;
    if ((h.ruleCount || 0) > 0 || (h.compoundRiskScore ?? 0) > 0) {
      flaggedCompoundCount += 1;
    }
    if ((h.compoundRiskScore ?? 0) >= 60) {
      highRiskCount += 1;
    }
    if ((h.oaugfMdaQueries || 0) > 0 && h.mdaName) {
      const mKey = h.mdaName.toUpperCase().trim();
      const existing = oaugfMdaMap.get(mKey);
      if (existing) {
        existing.projectCount += 1;
        existing.oaugfQueries = Math.max(existing.oaugfQueries, h.oaugfMdaQueries || 0);
        existing.repeatNeglect = Math.max(existing.repeatNeglect, h.oaugfMdaRepeatNeglect || 0);
      } else {
        oaugfMdaMap.set(mKey, {
          mdaName: h.mdaName,
          projectCount: 1,
          oaugfQueries: h.oaugfMdaQueries || 0,
          repeatNeglect: h.oaugfMdaRepeatNeglect || 0,
        });
      }
    }
  }

  const topOaugfMdas = Array.from(oaugfMdaMap.values())
    .sort((a, b) => b.oaugfQueries - a.oaugfQueries || b.projectCount - a.projectCount)
    .slice(0, 5);

  const oaugfTotalMdaQueries = Array.from(oaugfMdaMap.values()).reduce(
    (s, m) => s + m.oaugfQueries,
    0
  );

  return {
    totalMatchedCount: hits.length,
    totalBudgetedNaira,
    paidOnPaperCount,
    paidOnPaperDisbursedNaira,
    billInsertedCount,
    flaggedCompoundCount,
    highRiskCount,
    oaugfIndictedMdaCount: oaugfMdaMap.size,
    oaugfTotalMdaQueries,
    topOaugfMdas,
  };
}

export function searchNeighborhoodProjects(args: {
  query: string;
  stateFilter?: string;
  paidOnly?: boolean;
  records: BudgetRecord[];
  lifecycleIndex: ProjectLifecycleIndex | null;
  compoundProjects?: CompoundFlaggedProject[];
  crossLedgerContext?: CrossLedgerContextWire | null;
  oaugfIndex?: OaugfAuditIndexPayload | null;
  limit?: number;
}): NeighborhoodProjectHit[] {
  const {
    query,
    stateFilter = 'ALL',
    paidOnly = false,
    records,
    lifecycleIndex,
    compoundProjects,
    crossLedgerContext,
    oaugfIndex,
    limit = 60,
  } = args;
  const q = (query || '').trim().toLowerCase();
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  const compoundLookup = compoundProjects?.length
    ? buildCompoundProjectLookup(compoundProjects)
    : null;
  const billCodeSet = new Set(crossLedgerContext?.billInsertionCodes || []);
  const hits: NeighborhoodProjectHit[] = [];

  for (const r of records) {
    const st = (r.geographicTaxonomy?.state || '').trim();
    if (stateFilter !== 'ALL' && st.toLowerCase() !== stateFilter.toLowerCase()) {
      continue;
    }

    const title = r.recordIdentity.verbatimProjectName || '';
    const mda = r.mdaGovernanceTaxonomy.mdaName || '';
    const lga = r.geographicTaxonomy?.lga || '';
    const code = r.recordIdentity.projectCode || '';
    const fy = r.recordIdentity.financialYear;
    const amt = r.recordIdentity.amountNaira;
    const page = r.sourceProvenance.pdfPage;
    const cMatch = lookupConstituency(st, lga, title);
    const haystack = `${title} ${mda} ${st} ${lga} ${code} ${cMatch.federalConstituency || ''} ${cMatch.senatorialDistrict || ''}`.toLowerCase();

    if (tokens.length > 0 && !tokens.every((t) => haystack.includes(t))) {
      continue;
    }

    const badge = lookupScrutinyBadge(lifecycleIndex, {
      id: r.recordIdentity.id,
      projectCode: code,
    });
    const nocPaid = badge?.nocopoDisbursedNaira || 0;
    const govPaid = (badge?.directGovspendNaira || 0) + (badge?.vendorMdaPaidNaira || 0);
    const disbursed = Math.max(nocPaid, badge?.directGovspendNaira || 0);
    const paidOnPaper = Boolean(badge?.paidOnPaperPriority || nocPaid > 0 || govPaid > 0);

    if (paidOnly && !paidOnPaper) {
      continue;
    }

    const compound = findCompoundForProject(compoundLookup, fy, {
      id: r.recordIdentity.id,
      projectCode: code,
      projectName: title,
      page,
      amount: amt,
    });
    const oaugf = lookupOaugfMdaFindings(oaugfIndex, mda);
    const mdaProf = lookupMdaRiskProfile(crossLedgerContext, mda);
    const canonicalCode = extractCanonicalProjectCode(code, title);
    const compactRawCode = String(code || '').trim().toUpperCase().replace(/[\s-]+/g, '');
    const billInsertedOrInflated = Boolean(
      compound?.crossLedgerBadges.billInsertedOrInflated ||
        (canonicalCode && billCodeSet.has(canonicalCode)) ||
        (compactRawCode && billCodeSet.has(compactRawCode))
    );
    const oaugfMdaQueries = Math.max(
      compound?.crossLedgerBadges.mdaOaugfIssuesCount || 0,
      oaugf?.findingCount || 0,
      mdaProf?.oi || 0
    );
    const oaugfMdaRepeatNeglect = Math.max(
      compound?.crossLedgerBadges.mdaOaugfRepeatCount || 0,
      oaugf?.repeatNeglectCount || 0,
      mdaProf?.or || 0
    );

    hits.push({
      id: r.recordIdentity.id,
      projectCode: code || 'ERGP',
      projectName: title,
      mdaName: mda,
      state: st || 'Nationwide / Unspecified',
      lga,
      constituency: cMatch.federalConstituency,
      senatorialDistrict: cMatch.senatorialDistrict,
      financialYear: fy,
      amountNaira: amt,
      paidOnPaper,
      contractorName: badge?.contractorName || null,
      contractAwardNaira: badge?.awardedNaira || 0,
      disbursedNaira: disbursed,
      page,
      compoundRiskScore: compound?.compoundRiskScore ?? null,
      ruleCount: compound?.ruleCount ?? 0,
      billInsertedOrInflated,
      oaugfMdaQueries,
      oaugfMdaRepeatNeglect,
      mdaIntegrityGrade: compound?.crossLedgerBadges.mdaIntegrityGrade || mdaProf?.g || null,
    });
  }

  hits.sort(
    (a, b) =>
      Number(b.paidOnPaper) - Number(a.paidOnPaper) ||
      (b.compoundRiskScore ?? 0) - (a.compoundRiskScore ?? 0) ||
      b.disbursedNaira - a.disbursedNaira ||
      b.amountNaira - a.amountNaira
  );
  return hits.slice(0, limit);
}

export interface CitizenFiscalVerdict {
  id: string;
  tone: 'danger' | 'warning' | 'info';
  title: string;
  headlineMetric: string;
  plainSummary: string;
}

export function buildCitizenFiscalVerdicts(args: {
  financialYear: number;
  macroCredibility: MacroCredibilityTrackerPayload | null;
  oaugfIndex: OaugfAuditIndexPayload | null;
  lifecycleIndex: ProjectLifecycleIndex | null;
}): CitizenFiscalVerdict[] {
  const { financialYear, macroCredibility, oaugfIndex, lifecycleIndex } = args;
  const macro = getMacroForYear(financialYear);
  const debtShare = macro.officialTotalBudget > 0 ? (macro.debtService / macro.officialTotalBudget) * 100 : 0;
  const capShare = macro.officialTotalBudget > 0 ? (macro.totalCapitalBudget / macro.officialTotalBudget) * 100 : 0;
  const meanCapExec = macroCredibility?.headline?.meanCapitalPerformancePct ?? 53.5;
  const overrunYears = macroCredibility?.headline?.debtServiceOverrunYearsCount ?? 11;
  const paidOnPaperCount = lifecycleIndex?.summary?.paidOnPaperCount ?? 3096;
  const auditIssues = oaugfIndex?.headline?.parsedAuditIssuesCount ?? 3385;
  const auditReports = oaugfIndex?.headline?.reportsIndexed ?? 36;

  return [
    {
      id: 'promise-delivery',
      tone: 'warning',
      title: '1. Promise vs. Reality on Capital Projects',
      headlineMetric: `${meanCapExec.toFixed(1)}% avg. capital execution`,
      plainSummary: `Across 18 years of verified implementation reports, roughly half of budgeted federal capital money actually reached execution — meaning road, school, and clinic promises routinely stall midway.`,
    },
    {
      id: 'debt-squeeze',
      tone: 'danger',
      title: '2. Debt Service vs. Development',
      headlineMetric: `${debtShare.toFixed(1)}% debt vs. ${capShare.toFixed(1)}% capital (FY ${financialYear})`,
      plainSummary: `Debt repayments exceeded their original budget in ${overrunYears} out of 18 tracked fiscal years, squeezing cash left for hospitals, power, and classrooms.`,
    },
    {
      id: 'paid-on-paper',
      tone: 'danger',
      title: '3. Paid on Paper — Verify on the Ground',
      headlineMetric: `${paidOnPaperCount.toLocaleString('en-US')} projects with cash disbursements`,
      plainSummary: `Treasury and public contract records show money already paid out on thousands of constituency and capital items. Citizens in those LGAs can inspect whether the asset actually exists.`,
    },
    {
      id: 'oaugf-queries',
      tone: 'info',
      title: '4. Official Auditor-General Queries',
      headlineMetric: `${auditIssues.toLocaleString('en-US')} audit issues across ${auditReports} reports`,
      plainSummary: `Nigeria's own Auditor-General repeatedly flagged unvouched payments, unretired cash advances, and due-process contract breaches across federal ministries.`,
    },
  ];
}
