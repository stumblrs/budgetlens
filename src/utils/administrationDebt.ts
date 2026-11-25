/**
 * Dynamic Public Debt by Administration calculator.
 * Automatically recomputes net Naira, USD, and External USD debt additions
 * whenever `public/datasets/debt_profile.json` is updated with new DMO releases.
 */

import { PRESIDENTS_AGGREGATE } from '../data/presidentialTerms';

export interface DmoYearRow {
  financialYear: number;
  documentCount?: number;
  asAt?: string | null;
  isDerivedTotal?: boolean;
  totalDebtNairaM?: number | null;
  totalDebtUsdM?: number | null;
  domesticDebtNairaM?: number | null;
  externalDebtUsdM?: number | null;
  externalDebtNairaM?: number | null;
  cbnFxRate?: number | null;
  primarySource?: string | null;
}

export interface AdministrationDebtSummary {
  presidentId: string;
  presidentName: string;
  party: string;
  accentColor: string;
  tenureSpan: string;
  baselineYear: number;
  endYear: number;
  asAtEnd: string | null;
  startTotalNairaM: number;
  endTotalNairaM: number;
  netAddedNairaM: number;
  startTotalUsdM: number;
  endTotalUsdM: number;
  netAddedUsdM: number;
  startExternalUsdM: number | null;
  endExternalUsdM: number | null;
  netAddedExternalUsdM: number | null;
  startDomesticNairaM: number | null;
  endDomesticNairaM: number | null;
  netAddedDomesticNairaM: number | null;
  note: string;
}

export interface AdministrationDebtProjection {
  latestYear: number | null;
  latestAsAt: string | null;
  totalDocumentsIndexed: number;
  administrations: AdministrationDebtSummary[];
  topUsdBorrower: AdministrationDebtSummary | null;
  topExternalUsdBorrower: AdministrationDebtSummary | null;
  topNairaJump: AdministrationDebtSummary | null;
}

/**
 * Compute per-administration debt incurred from live DMO `yearlyDebt` rows.
 * For each administration covering years `[minY..maxY]`, uses the year prior to inauguration
 * (`minY - 1`, or the earliest valid DMO year inside the term if prior is unavailable) as baseline,
 * and the final year with valid DMO stock (`<= maxY`, or latest available year for the current term).
 */
export function computeAdministrationDebtProjection(
  yearlyDebt: DmoYearRow[],
  totalDocumentsIndexed = 0
): AdministrationDebtProjection {
  const validRows = [...(yearlyDebt || [])]
    .filter((r) => typeof r.totalDebtNairaM === 'number' && typeof r.totalDebtUsdM === 'number')
    .sort((a, b) => a.financialYear - b.financialYear);

  if (validRows.length === 0) {
    return {
      latestYear: null,
      latestAsAt: null,
      totalDocumentsIndexed,
      administrations: [],
      topUsdBorrower: null,
      topExternalUsdBorrower: null,
      topNairaJump: null,
    };
  }

  const byYear = new Map<number, DmoYearRow>(validRows.map((r) => [r.financialYear, r]));
  const latestRow = validRows[validRows.length - 1];
  const latestYear = latestRow.financialYear;

  const administrations: AdministrationDebtSummary[] = [];

  for (let i = 0; i < PRESIDENTS_AGGREGATE.length; i++) {
    const pres = PRESIDENTS_AGGREGATE[i];
    const minY = Math.min(...pres.budgetYears);
    const maxY = Math.max(...pres.budgetYears);
    const isLatestTerm = i === PRESIDENTS_AGGREGATE.length - 1;

    // Handover years: May 29 transitions sit mid-year; Dec 31 prior-year stock is the cleanest pre-term baseline
    // except Obasanjo (earliest DMO stock on disk is 2005).
    const candidateBaseline =
      byYear.get(minY - 1) ||
      validRows.find((r) => r.financialYear >= minY && r.financialYear <= maxY);

    // End year: use maxY if in the past (or latestRow if this is the active/latest administration)
    const endCandidates = validRows.filter(
      (r) => r.financialYear >= minY && (isLatestTerm || r.financialYear <= maxY)
    );
    const endRow = endCandidates[endCandidates.length - 1];

    if (!candidateBaseline || !endRow || endRow.financialYear < candidateBaseline.financialYear) {
      continue;
    }

    // For Obasanjo (where DMO starts in 2005 and Paris Club exit occurred in 2006),
    // also surface 2007 transition stock if present.
    const startTotalNairaM = candidateBaseline.totalDebtNairaM || 0;
    const endTotalNairaM = endRow.totalDebtNairaM || 0;
    const startTotalUsdM = candidateBaseline.totalDebtUsdM || 0;
    const endTotalUsdM = endRow.totalDebtUsdM || 0;

    const startExt = typeof candidateBaseline.externalDebtUsdM === 'number' ? candidateBaseline.externalDebtUsdM : null;
    const endExt = typeof endRow.externalDebtUsdM === 'number' ? endRow.externalDebtUsdM : null;
    const startDom = typeof candidateBaseline.domesticDebtNairaM === 'number' ? candidateBaseline.domesticDebtNairaM : null;
    const endDom = typeof endRow.domesticDebtNairaM === 'number' ? endRow.domesticDebtNairaM : null;

    let note = `${candidateBaseline.financialYear} → ${endRow.financialYear} DMO stock`;
    if (pres.presidentId === 'obasanjo') {
      note = 'Includes 2006 Paris Club external debt exit';
    } else if (isLatestTerm) {
      note = `Includes FX revaluation + Ways & Means securitization (live through ${endRow.asAt || endRow.financialYear})`;
    }

    administrations.push({
      presidentId: pres.presidentId,
      presidentName: pres.presidentName,
      party: pres.party,
      accentColor: pres.accentColor,
      tenureSpan: pres.totalYearsInOfficeLabel,
      baselineYear: candidateBaseline.financialYear,
      endYear: endRow.financialYear,
      asAtEnd: endRow.asAt || null,
      startTotalNairaM,
      endTotalNairaM,
      netAddedNairaM: endTotalNairaM - startTotalNairaM,
      startTotalUsdM,
      endTotalUsdM,
      netAddedUsdM: endTotalUsdM - startTotalUsdM,
      startExternalUsdM: startExt,
      endExternalUsdM: endExt,
      netAddedExternalUsdM: startExt != null && endExt != null ? endExt - startExt : null,
      startDomesticNairaM: startDom,
      endDomesticNairaM: endDom,
      netAddedDomesticNairaM: startDom != null && endDom != null ? endDom - startDom : null,
      note,
    });
  }

  const topUsdBorrower =
    administrations.length > 0
      ? [...administrations].sort((a, b) => b.netAddedUsdM - a.netAddedUsdM)[0]
      : null;

  const withExt = administrations.filter((a) => a.netAddedExternalUsdM !== null);
  const topExternalUsdBorrower =
    withExt.length > 0
      ? [...withExt].sort((a, b) => (b.netAddedExternalUsdM || 0) - (a.netAddedExternalUsdM || 0))[0]
      : null;

  const topNairaJump =
    administrations.length > 0
      ? [...administrations].sort((a, b) => b.netAddedNairaM - a.netAddedNairaM)[0]
      : null;

  return {
    latestYear,
    latestAsAt: latestRow.asAt || null,
    totalDocumentsIndexed,
    administrations,
    topUsdBorrower,
    topExternalUsdBorrower,
    topNairaJump,
  };
}

export interface HandoverDebtRecord {
  presidentId: 'obasanjo' | 'yaradua' | 'jonathan' | 'buhari' | 'tinubu';
  presidentName: string;
  party: 'PDP' | 'APC';
  accentColor: string;
  portraitPath: string;
  initials: string;
  tenureSpan: string;
  handoverWindow: string;
  yearsInOffice: number;
  cbnGovernors: string[];
  startTotalNairaM: number;
  endTotalNairaM: number;
  netAddedNairaM: number;
  pctChangeNaira: number;
  startTotalUsdM: number;
  endTotalUsdM: number;
  netAddedUsdM: number;
  pctChangeUsd: number;
  startExternalUsdM: number;
  endExternalUsdM: number;
  netAddedExternalUsdM: number;
  startDomesticNairaM: number;
  endDomesticNairaM: number;
  netAddedDomesticNairaM: number;
  waysAndMeansSecuritizedNairaM: number;
  marketDebtAddedExclWaysAndMeansNairaM: number | null;
  estimatedFxRevalNairaM: number;
  estimatedNewNetBorrowingNairaM: number;
  annualizedUsdAddedM: number;
  annualizedNairaAddedM: number;
  startFxRate: number;
  endFxRate: number;
  keyDriverHeadline: string;
  methodologyNote: string;
  sourceCitation: string;
}

export interface ConstitutionalDebtLedger {
  latestYear: number | null;
  latestAsAt: string | null;
  totalDocumentsIndexed: number;
  records: HandoverDebtRecord[];
  topUsdTotalBorrower: HandoverDebtRecord | null;
  topExternalUsdBorrower: HandoverDebtRecord | null;
  topNairaIncrease: HandoverDebtRecord | null;
  topNetDebtReducer: HandoverDebtRecord | null;
}

/**
 * Compute Fourth Republic Presidential Borrowing & Public Debt Increases aligned
 * to constitutional May 29 transition quarters (and live DMO end stock for the incumbent term).
 * Reconciles off-budget CBN Ways & Means securitization (₦22.71T under Buhari/securitized May 2023)
 * and FX float revaluation from hard-currency borrowing (`USD` & `External USD`).
 */
export function computeConstitutionalHandoverDebtLedger(
  yearlyDebt: DmoYearRow[],
  totalDocumentsIndexed = 0
): ConstitutionalDebtLedger {
  const validRows = [...(yearlyDebt || [])]
    .filter((r) => typeof r.totalDebtNairaM === 'number' && typeof r.totalDebtUsdM === 'number')
    .sort((a, b) => a.financialYear - b.financialYear);

  const byYear = new Map<number, DmoYearRow>(validRows.map((r) => [r.financialYear, r]));
  const latestRow = validRows[validRows.length - 1] || null;
  const latestYear = latestRow?.financialYear ?? 2026;
  const latestAsAt = latestRow?.asAt ?? '2026-06-30';

  const row2007 = byYear.get(2007);
  const row2010 = byYear.get(2010);
  const tinubuEndRow =
    validRows.filter((r) => r.financialYear >= 2024).slice(-1)[0] ||
    byYear.get(2023) ||
    latestRow;

  const pct = (delta: number, start: number) =>
    start > 0 ? Number(((delta / start) * 100).toFixed(1)) : 0;

  // 1. Olusegun Obasanjo (May 1999 -> May 2007 post-Paris Club transition)
  const objStartN = 3_550_000;
  const objStartUsd = 36_600;
  const objStartExtUsd = 28_040;
  const objStartDomN = 798_000;
  const objEndN = row2007?.totalDebtNairaM ?? 2_510_919.62;
  const objEndUsd = row2007?.totalDebtUsdM ?? 19_959.62;
  const objEndExtUsd = row2007?.externalDebtUsdM ?? 3_654.21;
  const objEndDomN = row2007?.domesticDebtNairaM ?? 2_051_220;

  // 2. Umaru Musa Yar'Adua (Jun 2007 -> Dec 2010 ticket completion)
  const yarEndN = row2010?.totalDebtNairaM ?? 5_233_311.15;
  const yarEndUsd = row2010?.totalDebtUsdM ?? 34_819.10;
  const yarEndExtUsd = row2010?.externalDebtUsdM ?? 4_534.19;
  const yarEndDomN = row2010?.domesticDebtNairaM ?? 4_551_822.39;

  // 3. Goodluck Ebele Jonathan (Dec 2010 -> Jun 30, 2015 DMO FGN+States consolidated handover)
  const gejEndN = 12_118_000;
  const gejEndUsd = 63_810;
  const gejEndExtUsd = 10_316.82;
  const gejEndDomN = 10_090_000;

  // 4. Muhammadu Buhari (Jun 30, 2015 -> Jun 30, 2023 DMO consolidated handover incl. May 2023 ₦22.71T Ways & Means)
  const pmbEndN = 87_379_401.75;
  const pmbEndUsd = 113_423.77;
  const pmbEndExtUsd = 43_159.19;
  const pmbEndDomN = 54_130_424.96;
  const pmbWaysMeans = 22_712_000;
  const pmbMar2023Naira = 49_850_000; // Pre-securitization & pre-float DMO Q1 2023 stock
  const pmbFxRevalJun2023 = Math.round(pmbEndExtUsd * (770.38 - 461.0)); // June 2023 unified float reval on Buhari handover external stock (~₦13.35T)

  // 5. Bola Ahmed Tinubu (Jun 30, 2023 handover -> live latest DMO stock)
  const batEndN = tinubuEndRow?.totalDebtNairaM ?? 166_788_480.19;
  const batEndUsd = tinubuEndRow?.totalDebtUsdM ?? 120_932.71;
  const batEndExtUsd = tinubuEndRow?.externalDebtUsdM ?? 54_523.57;
  const batEndDomN = tinubuEndRow?.domesticDebtNairaM ?? 91_590_433.92;
  const batEndFx =
    tinubuEndRow?.cbnFxRate ??
    (tinubuEndRow?.externalDebtNairaM && tinubuEndRow?.externalDebtUsdM
      ? tinubuEndRow.externalDebtNairaM / tinubuEndRow.externalDebtUsdM
      : 1379.1842);
  const batEndYear = tinubuEndRow?.financialYear ?? latestYear;
  const batEndAsAt = tinubuEndRow?.asAt ?? '2026-06-30';
  const batYearsElapsed = Math.max(1, Number((2023.42 < batEndYear ? (batEndYear - 2023) + (batEndAsAt.endsWith('06-30') ? 0.08 : 0.58) : 3.08).toFixed(2)));
  const batNetN = batEndN - pmbEndN;
  const batFxReval = Math.round(pmbEndExtUsd * Math.max(0, batEndFx - 770.38));

  const records: HandoverDebtRecord[] = [
    {
      presidentId: 'obasanjo',
      presidentName: 'Olusegun Obasanjo',
      party: 'PDP',
      accentColor: '#10b981',
      portraitPath: '/presidents/obasanjo.jpg',
      initials: 'OO',
      tenureSpan: 'May 1999 – May 2007 (8.0 yrs)',
      handoverWindow: 'May 1999 → Jun 2007',
      yearsInOffice: 8.0,
      cbnGovernors: ['Chief (Dr.) J. O. Sanusi', 'Prof. Chukwuma Soludo'],
      startTotalNairaM: objStartN,
      endTotalNairaM: objEndN,
      netAddedNairaM: objEndN - objStartN,
      pctChangeNaira: pct(objEndN - objStartN, objStartN),
      startTotalUsdM: objStartUsd,
      endTotalUsdM: objEndUsd,
      netAddedUsdM: objEndUsd - objStartUsd,
      pctChangeUsd: pct(objEndUsd - objStartUsd, objStartUsd),
      startExternalUsdM: objStartExtUsd,
      endExternalUsdM: objEndExtUsd,
      netAddedExternalUsdM: objEndExtUsd - objStartExtUsd,
      startDomesticNairaM: objStartDomN,
      endDomesticNairaM: objEndDomN,
      netAddedDomesticNairaM: objEndDomN - objStartDomN,
      waysAndMeansSecuritizedNairaM: 0,
      marketDebtAddedExclWaysAndMeansNairaM: objEndN - objStartN,
      estimatedFxRevalNairaM: Math.round(objEndExtUsd * (125.8 - 92.34)),
      estimatedNewNetBorrowingNairaM: objEndN - objStartN,
      annualizedUsdAddedM: Math.round((objEndUsd - objStartUsd) / 8),
      annualizedNairaAddedM: Math.round((objEndN - objStartN) / 8),
      startFxRate: 92.34,
      endFxRate: 125.8,
      keyDriverHeadline: 'Net Debt Reducer (-87% External via Paris Club Exit)',
      methodologyNote:
        'Paid ~$12.4B upfront to extinguish ~$18B in Paris Club external arrears (2005–2006), cutting external debt from $28.04B to $3.65B while developing domestic FGN bonds.',
      sourceCitation: 'DMO Annual Debt Stock Reports (1999 Baseline & Jun 2007 Exit)',
    },
    {
      presidentId: 'yaradua',
      presidentName: "Umaru Musa Yar'Adua",
      party: 'PDP',
      accentColor: '#0284c7',
      portraitPath: '/presidents/yaradua.jpg',
      initials: 'UY',
      tenureSpan: 'May 2007 – May/Dec 2010 (3.6 yrs)',
      handoverWindow: 'Jun 2007 → Dec 2010',
      yearsInOffice: 3.6,
      cbnGovernors: ['Prof. Chukwuma Soludo', 'Mallam Sanusi Lamido Sanusi'],
      startTotalNairaM: objEndN,
      endTotalNairaM: yarEndN,
      netAddedNairaM: yarEndN - objEndN,
      pctChangeNaira: pct(yarEndN - objEndN, objEndN),
      startTotalUsdM: objEndUsd,
      endTotalUsdM: yarEndUsd,
      netAddedUsdM: yarEndUsd - objEndUsd,
      pctChangeUsd: pct(yarEndUsd - objEndUsd, objEndUsd),
      startExternalUsdM: objEndExtUsd,
      endExternalUsdM: yarEndExtUsd,
      netAddedExternalUsdM: yarEndExtUsd - objEndExtUsd,
      startDomesticNairaM: objEndDomN,
      endDomesticNairaM: yarEndDomN,
      netAddedDomesticNairaM: yarEndDomN - objEndDomN,
      waysAndMeansSecuritizedNairaM: 0,
      marketDebtAddedExclWaysAndMeansNairaM: yarEndN - objEndN,
      estimatedFxRevalNairaM: Math.round(objEndExtUsd * (150.3 - 125.8)),
      estimatedNewNetBorrowingNairaM: yarEndN - objEndN - Math.round(objEndExtUsd * (150.3 - 125.8)),
      annualizedUsdAddedM: Math.round((yarEndUsd - objEndUsd) / 3.6),
      annualizedNairaAddedM: Math.round((yarEndN - objEndN) / 3.6),
      startFxRate: 125.8,
      endFxRate: 150.3,
      keyDriverHeadline: 'GFC Domestic Bond Stimulus (+₦2.50T Domestic)',
      methodologyNote:
        'External borrowing stayed tightly capped (+$0.88B); domestic FGN Treasury/bond issuance financed 2009–2010 global-crisis stimulus & Niger Delta amnesty.',
      sourceCitation: 'DMO Jun 2007 & Dec 2010 Bulletins',
    },
    {
      presidentId: 'jonathan',
      presidentName: 'Goodluck Ebele Jonathan',
      party: 'PDP',
      accentColor: '#2563eb',
      portraitPath: '/presidents/jonathan.jpg',
      initials: 'GJ',
      tenureSpan: '2010/2011 – May 2015 (4.5 yrs)',
      handoverWindow: 'Dec 2010 → Jun 2015',
      yearsInOffice: 4.5,
      cbnGovernors: ['Mallam Sanusi Lamido Sanusi', 'Mr. Godwin Emefiele'],
      startTotalNairaM: yarEndN,
      endTotalNairaM: gejEndN,
      netAddedNairaM: gejEndN - yarEndN,
      pctChangeNaira: pct(gejEndN - yarEndN, yarEndN),
      startTotalUsdM: yarEndUsd,
      endTotalUsdM: gejEndUsd,
      netAddedUsdM: gejEndUsd - yarEndUsd,
      pctChangeUsd: pct(gejEndUsd - yarEndUsd, yarEndUsd),
      startExternalUsdM: yarEndExtUsd,
      endExternalUsdM: gejEndExtUsd,
      netAddedExternalUsdM: gejEndExtUsd - yarEndExtUsd,
      startDomesticNairaM: yarEndDomN,
      endDomesticNairaM: gejEndDomN,
      netAddedDomesticNairaM: gejEndDomN - yarEndDomN,
      waysAndMeansSecuritizedNairaM: 0,
      marketDebtAddedExclWaysAndMeansNairaM: gejEndN - yarEndN,
      estimatedFxRevalNairaM: Math.round(yarEndExtUsd * (196.95 - 150.3)),
      estimatedNewNetBorrowingNairaM: gejEndN - yarEndN - Math.round(yarEndExtUsd * (196.95 - 150.3)),
      annualizedUsdAddedM: Math.round((gejEndUsd - yarEndUsd) / 4.5),
      annualizedNairaAddedM: Math.round((gejEndN - yarEndN) / 4.5),
      startFxRate: 150.3,
      endFxRate: 196.95,
      keyDriverHeadline: 'Eurobond Market Entry & Recurrent Deficit Bonds (+₦6.89T)',
      methodologyNote:
        'Consolidated June 30, 2015 DMO stock (₦12.12T / $63.81B across FGN+States); domestic bond yields funded recurrent deficits & post-2014 oil shock buffer.',
      sourceCitation: 'DMO Nigeria Total Public Debt Portfolio as at June 30, 2015',
    },
    {
      presidentId: 'buhari',
      presidentName: 'Muhammadu Buhari',
      party: 'APC',
      accentColor: '#8b5cf6',
      portraitPath: '/presidents/buhari.jpg',
      initials: 'MB',
      tenureSpan: 'May 2015 – May 2023 (8.0 yrs)',
      handoverWindow: 'Jun 2015 → Jun 2023',
      yearsInOffice: 8.0,
      cbnGovernors: ['Mr. Godwin Emefiele'],
      startTotalNairaM: gejEndN,
      endTotalNairaM: pmbEndN,
      netAddedNairaM: pmbEndN - gejEndN,
      pctChangeNaira: pct(pmbEndN - gejEndN, gejEndN),
      startTotalUsdM: gejEndUsd,
      endTotalUsdM: pmbEndUsd,
      netAddedUsdM: pmbEndUsd - gejEndUsd,
      pctChangeUsd: pct(pmbEndUsd - gejEndUsd, gejEndUsd),
      startExternalUsdM: gejEndExtUsd,
      endExternalUsdM: pmbEndExtUsd,
      netAddedExternalUsdM: pmbEndExtUsd - gejEndExtUsd,
      startDomesticNairaM: gejEndDomN,
      endDomesticNairaM: pmbEndDomN,
      netAddedDomesticNairaM: pmbEndDomN - gejEndDomN,
      waysAndMeansSecuritizedNairaM: pmbWaysMeans,
      marketDebtAddedExclWaysAndMeansNairaM: pmbMar2023Naira - gejEndN,
      estimatedFxRevalNairaM: pmbFxRevalJun2023,
      estimatedNewNetBorrowingNairaM: pmbEndN - gejEndN - pmbFxRevalJun2023,
      annualizedUsdAddedM: Math.round((pmbEndUsd - gejEndUsd) / 8),
      annualizedNairaAddedM: Math.round((pmbEndN - gejEndN) / 8),
      startFxRate: 196.95,
      endFxRate: 770.38,
      keyDriverHeadline: '+$32.84B External Loans + ₦22.71T CBN Ways & Means Printing',
      methodologyNote:
        'DMO Q1 2023 stood at ₦49.85T (+₦37.73T market debt); adding NASS-approved ₦22.71T CBN Ways & Means overdrafts (May 2023) & initial June 2023 FX float brought handover debt to ₦87.38T ($113.42B).',
      sourceCitation: 'DMO June 30, 2015, March 31, 2023 & June 30, 2023 Debt Reports',
    },
    {
      presidentId: 'tinubu',
      presidentName: 'Bola Ahmed Tinubu',
      party: 'APC',
      accentColor: '#f59e0b',
      portraitPath: '/presidents/tinubu.jpg',
      initials: 'BT',
      tenureSpan: `May 2023 – ${batEndAsAt} (${batYearsElapsed.toFixed(1)} yrs live)`,
      handoverWindow: `Jun 2023 → ${batEndAsAt}`,
      yearsInOffice: batYearsElapsed,
      cbnGovernors: ['Mr. Folashodun Shonubi (Acting)', 'Mr. Olayemi Cardoso'],
      startTotalNairaM: pmbEndN,
      endTotalNairaM: batEndN,
      netAddedNairaM: batNetN,
      pctChangeNaira: pct(batNetN, pmbEndN),
      startTotalUsdM: pmbEndUsd,
      endTotalUsdM: batEndUsd,
      netAddedUsdM: batEndUsd - pmbEndUsd,
      pctChangeUsd: pct(batEndUsd - pmbEndUsd, pmbEndUsd),
      startExternalUsdM: pmbEndExtUsd,
      endExternalUsdM: batEndExtUsd,
      netAddedExternalUsdM: batEndExtUsd - pmbEndExtUsd,
      startDomesticNairaM: pmbEndDomN,
      endDomesticNairaM: batEndDomN,
      netAddedDomesticNairaM: batEndDomN - pmbEndDomN,
      waysAndMeansSecuritizedNairaM: 0,
      marketDebtAddedExclWaysAndMeansNairaM: batNetN,
      estimatedFxRevalNairaM: batFxReval,
      estimatedNewNetBorrowingNairaM: batNetN - batFxReval,
      annualizedUsdAddedM: Math.round((batEndUsd - pmbEndUsd) / batYearsElapsed),
      annualizedNairaAddedM: Math.round(batNetN / batYearsElapsed),
      startFxRate: 770.38,
      endFxRate: Number(batEndFx.toFixed(2)),
      keyDriverHeadline: '+₦37.46T Domestic Issuance + ₦26.28T FX Revaluation + $11.36B External',
      methodologyNote: `External stock rose +$${((batEndExtUsd - pmbEndExtUsd) / 1e3).toFixed(2)}B; floating CBN FX (₦770.38 → ₦${batEndFx.toFixed(2)}/$) added ~₦${(batFxReval / 1e6).toFixed(2)}T to inherited foreign debt carrying value alongside +₦${((batEndDomN - pmbEndDomN) / 1e6).toFixed(2)}T domestic borrowing.`,
      sourceCitation: `DMO June 30, 2023 Handover & Live ${batEndAsAt} Debt Stock Reports`,
    },
  ];

  const topUsdTotalBorrower = [...records].sort((a, b) => b.netAddedUsdM - a.netAddedUsdM)[0] || null;
  const topExternalUsdBorrower =
    [...records].sort((a, b) => b.netAddedExternalUsdM - a.netAddedExternalUsdM)[0] || null;
  const topNairaIncrease = [...records].sort((a, b) => b.netAddedNairaM - a.netAddedNairaM)[0] || null;
  const topNetDebtReducer = [...records].sort((a, b) => a.netAddedUsdM - b.netAddedUsdM)[0] || null;

  return {
    latestYear,
    latestAsAt,
    totalDocumentsIndexed,
    records,
    topUsdTotalBorrower,
    topExternalUsdBorrower,
    topNairaIncrease,
    topNetDebtReducer,
  };
}
