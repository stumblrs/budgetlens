export interface HistoricalMacroYear {
  year: number;
  officialTotalBudget: number;
  recurrentNonDebtTotal: number;
  totalCapitalBudget: number;
  statutoryTransfers: number;
  debtService: number;
  personnelCost: number;
  overheadCost: number;
  fxNairaPerUsd: number;
  cpiInflationRate: number;
  /** Multiplier to convert Year Y nominal Naira into Constant 2026 Naira */
  cpiDeflatorTo2026: number;
  /** Strictly positive price index relative to 2023 = 1.0 for unit-cost asset estimation */
  assetInflationFrom2023: number;
}

const MACRO_BASE_ROWS: Array<{
  year: number;
  totalBn: number;
  capitalRatio: number;
  recurrentRatio: number;
  debtRatio: number;
  statutoryRatio: number;
  fx: number;
  cpi: number;
}> = [
  { year: 1999, totalBn: 299.0,  capitalRatio: 0.41, recurrentRatio: 0.36, debtRatio: 0.19, statutoryRatio: 0.04, fx: 92.34,   cpi: 6.6 },
  { year: 2000, totalBn: 677.5,  capitalRatio: 0.44, recurrentRatio: 0.35, debtRatio: 0.17, statutoryRatio: 0.04, fx: 101.70,  cpi: 6.9 },
  { year: 2001, totalBn: 894.2,  capitalRatio: 0.49, recurrentRatio: 0.33, debtRatio: 0.14, statutoryRatio: 0.04, fx: 111.23,  cpi: 18.9 },
  { year: 2002, totalBn: 1064.8, capitalRatio: 0.40, recurrentRatio: 0.41, debtRatio: 0.15, statutoryRatio: 0.04, fx: 120.58,  cpi: 12.9 },
  { year: 2003, totalBn: 976.3,  capitalRatio: 0.32, recurrentRatio: 0.45, debtRatio: 0.19, statutoryRatio: 0.04, fx: 129.22,  cpi: 14.0 },
  { year: 2004, totalBn: 1300.0, capitalRatio: 0.27, recurrentRatio: 0.47, debtRatio: 0.21, statutoryRatio: 0.05, fx: 132.89,  cpi: 15.0 },
  { year: 2005, totalBn: 1799.9, capitalRatio: 0.34, recurrentRatio: 0.45, debtRatio: 0.16, statutoryRatio: 0.05, fx: 131.27,  cpi: 17.9 },
  { year: 2006, totalBn: 1900.0, capitalRatio: 0.31, recurrentRatio: 0.49, debtRatio: 0.14, statutoryRatio: 0.06, fx: 128.65,  cpi: 8.2 },
  { year: 2007, totalBn: 2300.0, capitalRatio: 0.36, recurrentRatio: 0.46, debtRatio: 0.12, statutoryRatio: 0.06, fx: 125.81,  cpi: 5.4 },
  { year: 2008, totalBn: 2748.0, capitalRatio: 0.32, recurrentRatio: 0.49, debtRatio: 0.13, statutoryRatio: 0.06, fx: 118.57,  cpi: 11.6 },
  { year: 2009, totalBn: 3101.8, capitalRatio: 0.33, recurrentRatio: 0.48, debtRatio: 0.13, statutoryRatio: 0.06, fx: 148.90,  cpi: 12.5 },
  { year: 2010, totalBn: 4427.2, capitalRatio: 0.35, recurrentRatio: 0.47, debtRatio: 0.12, statutoryRatio: 0.06, fx: 150.30,  cpi: 13.7 },
  { year: 2011, totalBn: 4484.7, capitalRatio: 0.26, recurrentRatio: 0.54, debtRatio: 0.11, statutoryRatio: 0.09, fx: 153.86,  cpi: 10.8 },
  { year: 2012, totalBn: 4697.2, capitalRatio: 0.29, recurrentRatio: 0.51, debtRatio: 0.12, statutoryRatio: 0.08, fx: 157.50,  cpi: 12.2 },
  { year: 2013, totalBn: 4987.2, capitalRatio: 0.32, recurrentRatio: 0.48, debtRatio: 0.12, statutoryRatio: 0.08, fx: 157.31,  cpi: 8.5 },
  { year: 2014, totalBn: 4695.2, capitalRatio: 0.24, recurrentRatio: 0.52, debtRatio: 0.15, statutoryRatio: 0.09, fx: 158.55,  cpi: 8.1 },
  { year: 2015, totalBn: 4493.4, capitalRatio: 0.16, recurrentRatio: 0.58, debtRatio: 0.18, statutoryRatio: 0.08, fx: 192.44,  cpi: 9.0 },
  { year: 2016, totalBn: 6060.7, capitalRatio: 0.26, recurrentRatio: 0.44, debtRatio: 0.24, statutoryRatio: 0.06, fx: 253.49,  cpi: 15.7 },
  { year: 2017, totalBn: 7441.2, capitalRatio: 0.29, recurrentRatio: 0.40, debtRatio: 0.25, statutoryRatio: 0.06, fx: 305.79,  cpi: 16.5 },
  { year: 2018, totalBn: 9120.3, capitalRatio: 0.31, recurrentRatio: 0.39, debtRatio: 0.24, statutoryRatio: 0.06, fx: 306.08,  cpi: 12.1 },
  { year: 2019, totalBn: 8917.0, capitalRatio: 0.23, recurrentRatio: 0.45, debtRatio: 0.26, statutoryRatio: 0.06, fx: 306.92,  cpi: 11.4 },
  { year: 2020, totalBn: 10805.5, capitalRatio: 0.23, recurrentRatio: 0.46, debtRatio: 0.27, statutoryRatio: 0.04, fx: 358.81, cpi: 13.2 },
  { year: 2021, totalBn: 13588.0, capitalRatio: 0.30, recurrentRatio: 0.42, debtRatio: 0.24, statutoryRatio: 0.04, fx: 400.00, cpi: 17.0 },
  { year: 2022, totalBn: 17126.9, capitalRatio: 0.32, recurrentRatio: 0.41, debtRatio: 0.22, statutoryRatio: 0.05, fx: 425.98, cpi: 18.8 },
  { year: 2023, totalBn: 24820.0, capitalRatio: 0.31, recurrentRatio: 0.31, debtRatio: 0.26, statutoryRatio: 0.05, fx: 645.19, cpi: 24.5 },
  { year: 2024, totalBn: 28770.0, capitalRatio: 0.35, recurrentRatio: 0.30, debtRatio: 0.29, statutoryRatio: 0.06, fx: 1480.00, cpi: 31.7 },
  { year: 2025, totalBn: 46019.6, capitalRatio: 0.28, recurrentRatio: 0.26, debtRatio: 0.36, statutoryRatio: 0.10, fx: 1550.00, cpi: 22.0 },
  { year: 2026, totalBn: 54200.0, capitalRatio: 0.31, recurrentRatio: 0.29, debtRatio: 0.30, statutoryRatio: 0.10, fx: 1500.00, cpi: 18.0 },
];

// Build cumulative CPI index so 2026 = 1.0 (every prior year's cpiDeflatorTo2026 > 1.0)
const cumulativeCpiFactor: Record<number, number> = {};
let runningFactor = 1.0;
for (let i = MACRO_BASE_ROWS.length - 1; i >= 0; i--) {
  const row = MACRO_BASE_ROWS[i];
  cumulativeCpiFactor[row.year] = Number(runningFactor.toFixed(4));
  runningFactor *= 1 + row.cpi / 100;
}

const cpi2023 = cumulativeCpiFactor[2023] || 1.85;

export const HISTORICAL_MACRO_DATA: Record<number, HistoricalMacroYear> = Object.fromEntries(
  MACRO_BASE_ROWS.map((r) => {
    const total = Math.round(r.totalBn * 1e9);
    const capital = Math.round(total * r.capitalRatio);
    const recurrent = Math.round(total * r.recurrentRatio);
    const debt = Math.round(total * r.debtRatio);
    const statutory = Math.max(0, total - capital - recurrent - debt);
    const deflator = cumulativeCpiFactor[r.year];
    // Strictly positive price ratio relative to 2023 = 1.0
    const assetInflation = Math.max(0.03, Number((cpi2023 / deflator).toFixed(4)));

    return [
      r.year,
      {
        year: r.year,
        officialTotalBudget: total,
        recurrentNonDebtTotal: recurrent,
        totalCapitalBudget: capital,
        statutoryTransfers: statutory,
        debtService: debt,
        personnelCost: Math.round(recurrent * 0.64),
        overheadCost: Math.round(recurrent * 0.11),
        fxNairaPerUsd: r.fx,
        cpiInflationRate: r.cpi,
        cpiDeflatorTo2026: deflator,
        assetInflationFrom2023: assetInflation,
      },
    ];
  })
);

export function getMacroForYear(year: number): HistoricalMacroYear {
  if (HISTORICAL_MACRO_DATA[year]) {
    return HISTORICAL_MACRO_DATA[year];
  }
  const latest = HISTORICAL_MACRO_DATA[2026];
  const yearsDelta = Math.max(0, year - 2026);
  return {
    ...latest,
    year,
    cpiDeflatorTo2026: Number((1 / Math.pow(1.16, yearsDelta)).toFixed(4)),
    assetInflationFrom2023: Number((latest.assetInflationFrom2023 * Math.pow(1.16, yearsDelta)).toFixed(4)),
  };
}
