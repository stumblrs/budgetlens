import { describe, expect, it } from 'vitest';
import {
  computeAdministrationDebtProjection,
  computeConstitutionalHandoverDebtLedger,
  type DmoYearRow,
} from '../../src/utils/administrationDebt';
import {
  buildMultiLedgerYearSeries,
  formatPresidentialBillPadding,
  formatPresidentialOpenTreasury,
  type PresidentCrossLedgerSummary,
} from '../../src/utils/multiLedgerTrends';

describe('computeAdministrationDebtProjection', () => {
  const sampleRows: DmoYearRow[] = [
    { financialYear: 2005, totalDebtNairaM: 4_214_667, totalDebtUsdM: 32_099, externalDebtUsdM: 20_477, domesticDebtNairaM: 1_525_910 },
    { financialYear: 2006, totalDebtNairaM: 1_339_026, totalDebtUsdM: 10_404, externalDebtUsdM: 3_544, domesticDebtNairaM: 882_850 },
    { financialYear: 2010, totalDebtNairaM: 5_233_311, totalDebtUsdM: 34_819, externalDebtUsdM: 4_534, domesticDebtNairaM: 4_551_822 },
    { financialYear: 2014, totalDebtNairaM: 8_982_403, totalDebtUsdM: 56_635, externalDebtUsdM: 6_799, domesticDebtNairaM: 7_904_025 },
    { financialYear: 2022, totalDebtNairaM: 46_250_367, totalDebtUsdM: 103_110, externalDebtUsdM: 41_694, domesticDebtNairaM: 27_548_116 },
    { financialYear: 2026, asAt: '2026-06-30', totalDebtNairaM: 166_788_480, totalDebtUsdM: 120_932, externalDebtUsdM: 54_523, domesticDebtNairaM: 91_590_433 },
  ];

  it('identifies Buhari as top USD/external borrower and Tinubu as largest Naira FX-revalued jump', () => {
    const proj = computeAdministrationDebtProjection(sampleRows, 505);
    expect(proj.latestYear).toBe(2026);
    expect(proj.latestAsAt).toBe('2026-06-30');
    expect(proj.topUsdBorrower?.presidentId).toBe('buhari');
    expect(proj.topExternalUsdBorrower?.presidentId).toBe('buhari');
    expect(proj.topNairaJump?.presidentId).toBe('tinubu');
  });

  it('automatically updates projection when a new future DMO year (e.g. 2027) arrives', () => {
    const withNewData: DmoYearRow[] = [
      ...sampleRows,
      { financialYear: 2027, asAt: '2027-03-31', totalDebtNairaM: 180_000_000, totalDebtUsdM: 132_000, externalDebtUsdM: 60_000, domesticDebtNairaM: 98_000_000 },
    ];
    const proj = computeAdministrationDebtProjection(withNewData, 520);
    expect(proj.latestYear).toBe(2027);
    expect(proj.latestAsAt).toBe('2027-03-31');
    const tinubu = proj.administrations.find((a) => a.presidentId === 'tinubu');
    expect(tinubu?.endYear).toBe(2027);
    expect(tinubu?.endTotalUsdM).toBe(132_000);
    expect(tinubu?.netAddedUsdM).toBe(132_000 - 103_110);
  });

  it('builds a clean 28-year (1999-2026) multi-ledger series with null-era guards and deduplicated OAuGF reports', () => {
    const series = buildMultiLedgerYearSeries({
      debtRows: sampleRows,
      oaugfDocuments: [
        { years: [2013, 2018], issueCount: 148 },
        { years: [2018], issueCount: 470 },
        { years: [2024], issueCount: 668 },
      ],
      startYear: 1999,
      endYear: 2026,
    });

    expect(series.length).toBe(28);
    expect(series[0].year).toBe(1999);
    expect(series[27].year).toBe(2026);

    // Pre-2005 DMO and pre-2009 BIR remain null (no fabricated zeroes or NaNs)
    const fy2002 = series.find((p) => p.year === 2002)!;
    expect(fy2002.dmoDebtTn).toBeNull();
    expect(fy2002.birCapitalExecPct).toBeNull();
    expect(fy2002.oaugfFindingsCount).toBeNull();
    expect(Number.isFinite(fy2002.enactedBudgetTn)).toBe(true);

    // Multi-year OAuGF report [2013, 2018] is attributed once to 2018, not double-counted in 2013
    const fy2013 = series.find((p) => p.year === 2013)!;
    const fy2018 = series.find((p) => p.year === 2018)!;
    const fy2024 = series.find((p) => p.year === 2024)!;
    expect(fy2013.oaugfFindingsCount).toBeNull();
    expect(fy2018.oaugfFindingsCount).toBe(148 + 470);
    expect(fy2024.oaugfFindingsCount).toBe(668);

    // Every numeric value is strictly finite when non-null
    for (const row of series) {
      expect(Number.isFinite(row.enactedBudgetTn)).toBe(true);
      expect(Number.isFinite(row.eeFlaggedSpendTn)).toBe(true);
      if (row.dmoDebtTn !== null) expect(Number.isFinite(row.dmoDebtTn)).toBe(true);
    }
  });

  it('formats pre-2017 Bill Padding and pre-2018 Open Treasury as explicit N/A strings without NaN', () => {
    const preEraProfile: PresidentCrossLedgerSummary = {
      oaugf: {
        reportsCount: 5,
        yearsAudited: [1999, 2005],
        issuesCount: 250,
        repeatNeglectCount: 3,
        recoveryDirectiveCount: 15,
        totalQueriedNaira: 500_000_000_000,
        totalQueriedUsd: 3_800_000_000,
      },
      legislativePadding: {
        cyclesCount: 0,
        cyclesYears: [],
        lineItemScheduleCyclesCount: 0,
        insertionsCount: 0,
        insertionsTotalNaira: 0,
        insertionsTotalUsd: 0,
        inflatedCount: 0,
        inflatedTotalNaira: 0,
        zipCount: 0,
        zipTotalNaira: 0,
      },
      openTreasury: {
        yearsCovered: [],
        totalDisbursedNaira: 0,
        decemberVoucherCount: 0,
        decemberNaira: 0,
        avgDecemberRushRatio: null,
      },
      evidenceEngineV3: {
        flaggedProjectsCount: 420,
        totalRuleFindingsCount: 510,
        crossLedgerFindingsCount: 120,
        flaggedAmountNaira: 90_000_000_000,
        duplicateClustersCount: 8,
      },
    };

    expect(formatPresidentialBillPadding(preEraProfile)).toBe('N/A (Pre-2017)');
    expect(formatPresidentialOpenTreasury(preEraProfile)).toBe('N/A (Pre-2018)');

    const modernProfile: PresidentCrossLedgerSummary = {
      ...preEraProfile,
      legislativePadding: {
        ...preEraProfile.legislativePadding,
        cyclesCount: 2,
        cyclesYears: [2023, 2025],
        insertionsCount: 12364,
        insertionsTotalNaira: 11_710_000_000_000,
      },
      openTreasury: {
        yearsCovered: [2023, 2024, 2025],
        totalDisbursedNaira: 19_500_000_000_000,
        decemberVoucherCount: 8500,
        decemberNaira: 4_200_000_000_000,
        avgDecemberRushRatio: 2.41,
      },
    };

    expect(formatPresidentialBillPadding(modernProfile)).toContain('₦11.71T');
    expect(formatPresidentialBillPadding(modernProfile)).toContain('12,364');
    expect(formatPresidentialOpenTreasury(modernProfile)).toContain('₦19.50T');
    expect(formatPresidentialOpenTreasury(modernProfile)).toContain('2.41x Dec');
  });

  it('computes Constitutional Handover Debt Ledger across all 5 presidents with Buhari Ways & Means and Tinubu FX decomposition', () => {
    const ledger = computeConstitutionalHandoverDebtLedger(sampleRows, 505);
    expect(ledger.records).toHaveLength(5);

    const obasanjo = ledger.records.find((r) => r.presidentId === 'obasanjo')!;
    expect(obasanjo.netAddedUsdM).toBeLessThan(0);
    expect(obasanjo.netAddedExternalUsdM).toBeLessThan(-20_000);

    const jonathan = ledger.records.find((r) => r.presidentId === 'jonathan')!;
    expect(jonathan.endTotalNairaM).toBe(12_118_000);
    expect(jonathan.netAddedNairaM).toBeGreaterThan(6_000_000);

    const buhari = ledger.records.find((r) => r.presidentId === 'buhari')!;
    expect(buhari.waysAndMeansSecuritizedNairaM).toBe(22_712_000);
    expect(buhari.endTotalNairaM).toBeCloseTo(87_379_401.75, 2);
    expect(buhari.netAddedExternalUsdM).toBeGreaterThan(30_000);
    expect(ledger.topExternalUsdBorrower?.presidentId).toBe('buhari');

    const tinubu = ledger.records.find((r) => r.presidentId === 'tinubu')!;
    expect(tinubu.endTotalNairaM).toBe(166_788_480);
    expect(tinubu.estimatedFxRevalNairaM).toBeGreaterThan(25_000_000);
    expect(ledger.topNairaIncrease?.presidentId).toBe('tinubu');
    expect(ledger.topNetDebtReducer?.presidentId).toBe('obasanjo');

    for (const r of ledger.records) {
      expect(Number.isFinite(r.netAddedUsdM)).toBe(true);
      expect(Number.isFinite(r.netAddedNairaM)).toBe(true);
      expect(Number.isFinite(r.pctChangeNaira)).toBe(true);
      expect(r.cbnGovernors.length).toBeGreaterThan(0);
    }

    // Dynamic update check with future 2027 row
    const updatedLedger = computeConstitutionalHandoverDebtLedger(
      [
        ...sampleRows,
        {
          financialYear: 2027,
          asAt: '2027-03-31',
          totalDebtNairaM: 180_000_000,
          totalDebtUsdM: 132_000,
          externalDebtUsdM: 58_000,
          domesticDebtNairaM: 98_800_000,
          cbnFxRate: 1400,
        },
      ],
      520
    );
    const updatedTinubu = updatedLedger.records.find((r) => r.presidentId === 'tinubu')!;
    expect(updatedTinubu.endTotalUsdM).toBe(132_000);
    expect(updatedTinubu.endTotalNairaM).toBe(180_000_000);
  });
});
