import { describe, expect, it } from 'vitest';
import type { BudgetRecord } from '../../src/services/budgetDatabaseEngine';
import {
  buildMultiDatasetContextSummary,
  detectAiModeFromQuery,
  findDuplicateClustersForQuery,
  findSimilarItemsForQuery,
  sanitizeAiPublicText,
} from '../../src/utils/aiForensicEngine';

function makeRecord(
  id: string,
  code: string,
  name: string,
  mda: string,
  amount: number,
  year = 2025,
  state = 'Kano'
): BudgetRecord {
  return {
    recordIdentity: {
      id,
      financialYear: year,
      projectCode: code,
      verbatimProjectName: name,
      amountNaira: amount,
      amountFormatted: `₦${amount.toLocaleString()}`,
      spendingType: 'CAPITAL',
    },
    sourceProvenance: {
      documentId: `doc-${year}`,
      sourceFilename: `${year}.pdf`,
      pdfPage: 42,
      sha256Hash: 'abc123',
    },
    geographicTaxonomy: {
      jurisdictionLevel: 'STATE',
      geoPoliticalZone: 'North West',
      state,
      lga: '',
    },
    mdaGovernanceTaxonomy: {
      mdaCode: '0234',
      mdaName: mda,
      sector: 'Water & Sanitation',
    },
    multiYearLineage: {
      lineageId: null,
      yearsAppeared: [year],
      cumulativeSpendNaira: amount,
      cumulativeSpendFormatted: `₦${amount.toLocaleString()}`,
    },
    forensicEvidenceFlags: [],
    humanScaleEquivalents: {
      teacherSalaries: '10',
      solarBoreholes: '2',
      primaryHealthCentres: '1',
    },
  };
}

describe('AI Forensic Engine (Multi-Dataset, Duplicates & Similar Items)', () => {
  const sampleRecords: BudgetRecord[] = [
    makeRecord('r1', 'ERGP101', 'Construction of Solar Borehole in Kano State', 'Ministry of Water Resources', 95_000_000, 2025, 'Kano'),
    makeRecord('r2', 'ERGP102', 'Provision of Solar Boreholes in Kano State', 'Border Communities Agency', 88_000_000, 2025, 'Kano'),
    makeRecord('r3', 'ERGP103', 'Construction of Solar Powered Borehole in Kaduna State', 'Ministry of Water Resources', 72_000_000, 2025, 'Kaduna'),
    makeRecord('r4', 'ERGP104', 'Purchase of Armored Luxury SUV Vehicles', 'Office of Secretary', 240_000_000, 2025, 'FCT'),
  ];

  it('detects AI investigation modes accurately while preserving topic keywords', () => {
    expect(detectAiModeFromQuery('Find duplicate solar borehole projects in 2025')).toBe('duplicates');
    expect(detectAiModeFromQuery('Show items similar to ERGP101')).toBe('similar');
    expect(detectAiModeFromQuery('Bill vs Act padding insertions in 2025')).toBe('padding');
    expect(detectAiModeFromQuery('Check Benford MAD score')).toBe('forensics');
    expect(detectAiModeFromQuery('Show 2016 BIR capital releases')).toBe('execution');
    expect(detectAiModeFromQuery('Show MDA integrity scorecard ranking')).toBe('scorecard');
    expect(detectAiModeFromQuery('Show non-competitive procurement risk and variation overruns')).toBe('procurement_risk');
    expect(detectAiModeFromQuery('Analyze December rush and threshold splitting')).toBe('cash_forensics');
    expect(detectAiModeFromQuery('Audit captive vendor pairs and off-portal payees')).toBe('vendor_capture');
    expect(detectAiModeFromQuery('Show follow the money padded-to-paid and zombie projects')).toBe('follow_money');
    expect(detectAiModeFromQuery('Show OAuGF Auditor-General audit queries')).toBe('oaugf_audit');
    expect(detectAiModeFromQuery('Summarize Evidence Engine v3.0 22 rules and compound risk')).toBe('evidence_engine');
    expect(detectAiModeFromQuery('Which MDAs appear in Red-Flag Convergence with 3+ flags?')).toBe('convergence');
    expect(detectAiModeFromQuery('Compare Buhari and Tinubu across Fourth Republic scrutiny total')).toBe('presidential');
  });

  it('finds disguised-rewording duplicate clusters matching topic keywords', () => {
    const clusters = findDuplicateClustersForQuery(
      'Find duplicate solar borehole projects in Kano',
      sampleRecords,
      null,
      2025,
      'year'
    );
    expect(clusters.length).toBe(1);
    expect(clusters[0].count).toBe(2);
    expect(clusters[0].matchType).toBe('Disguised / Reworded');
    expect(clusters[0].totalAmountNaira).toBe(183_000_000);
  });

  it('ranks structurally similar items against a code anchor or keyword prompt', () => {
    const { anchor, similarItems } = findSimilarItemsForQuery(
      'Find items similar to ERGP101',
      sampleRecords,
      [],
      2025,
      'all'
    );
    expect(anchor?.code).toBe('ERGP101');
    expect(similarItems.length).toBeGreaterThanOrEqual(2);
    expect(similarItems[0].code).toBe('ERGP102');
    expect(similarItems[0].similarityPct).toBeGreaterThanOrEqual(70);
  });

  it('builds grounded context briefs from Bill-Act Padding and BIR Execution bundles', () => {
    const padBrief = buildMultiDatasetContextSummary({
      query: 'Show padding in 2025',
      mode: 'padding',
      activeYear: 2025,
      statisticalForensics: null,
      bundle: {
        paddingIndex: {
          cyclesCount: 7,
          cycles: [
            {
              financialYear: 2025,
              comparisonScope: 'LINE_ITEM_SCHEDULE',
              billItemCount: 44825,
              actItemCount: 52487,
              billTotalNaira: 47_656_412_598_985,
              actTotalNaira: 50_356_384_178_282,
              insertionsCount: 12364,
              insertionsTotalNaira: 11_709_885_296_656,
              inflatedCount: 2734,
              inflatedTotalNaira: 3_939_032_364_439,
              cutCount: 3560,
              cutTotalNaira: 3_110_795_510_759,
              zipCount: 11,
              zipTotalNaira: 201_146_571_996,
              topPaddedMdas: [
                {
                  mdaName: 'MINISTRY OF BUDGET',
                  insertionsNaira: 4_000_000_000_000,
                  inflatedDeltaNaira: 100_000_000_000,
                  totalPositivePaddingNaira: 4_100_000_000_000,
                },
              ],
            },
          ],
        },
        executionTracker: null,
        staticSearchRecords: [],
      },
    });
    expect(padBrief?.headline).toContain('Bill vs. Act Legislative Padding Dossier');
    expect(padBrief?.bullets.some((b) => b.includes('12,364'))).toBe(true);
  });

  it('builds Phase 3 offline summaries and strips forbidden filenames and internal jargon', () => {
    const clean = sanitizeAiPublicText(
      'Review (see bir_2025.pdf) via NOCOPO, GovSpend, MTEF/FSP, SQL/FTS5, mda_integrity_scorecards.json, export.csv, and Budget Implementation Report.'
    );
    for (const forbidden of ['.pdf', '.json', '.csv', 'NOCOPO', 'GovSpend', 'MTEF/FSP', 'SQL/FTS5', 'Budget Implementation Report']) {
      expect(clean).not.toContain(forbidden);
    }

    const phase3Bundle = {
      paddingIndex: null,
      executionTracker: null,
      staticSearchRecords: [],
      mdaScorecards: {
        headline: { totalScoredMdas: 250, full5PillarCount: 21, medianCompositeScore: 58.7 },
        mdas: [{ rank: 1, mdaName: 'FEDERAL CHARACTER COMMISSION', compositeScore: 83.1, grade: 'A', metricsPresent: 5, totalTrackedExposureNaira: 12_050_276_534 }],
      },
      macroCredibility: {
        headline: { yearRange: '2009–2026', debtServiceOverrunYearsCount: 11, cumulativeDebtServiceOverrunNaira: 8_439_080_000_000 },
      },
      procurementRisk: {
        headline: { totalAwardedRows: 16726, totalAwardedNaira: 4_384_260_773_742, planningExcludedCount: 82140, nonCompetitiveCount: 5481, nonCompetitiveAwardedNaira: 1_312_027_332_057, nonCompetitiveValueSharePct: 29.93, overrunCount: 440, overrunDeltaNaira: 939_854_881_856, zeroPaidCount: 3560, zeroPaidAwardedNaira: 2_943_711_756_150 },
        topOverrunContracts: [{ contractorName: 'SAMPLE CONTRACTOR', mdaName: 'MINISTRY OF WORKS', awardNaira: 100_000_000, paidNaira: 500_000_000 }],
      },
      govspendForensics: {
        headline: { totalVouchers: 467763, totalNaira: 47_530_000_000_000, december2019To2025Vouchers: 12000, december2019To2025Naira: 8_760_000_000_000, decemberRushRatio2019To2025: 2.75, nearThresholdVoucherCount: 34027, nearThresholdNaira: 1_040_480_000_000, rolling7DayClusterCount: 16996, rolling7DayClusterNaira: 900_000_000_000, benford1DMad: 0.0374 },
      },
      vendorNetwork: {
        headline: { captivePairCount: 7, captivePairAwardedNaira: 150_000_000_000, multiMdaContractorCount: 83, overpaid125Count: 3377, overpaid125GovspendPaidNaira: 4_860_000_000_000, overpaid125NocopoAwardedNaira: 760_000_000_000, offNocopoPrivateCount: 25869, offNocopoPrivatePaidNaira: 6_740_000_000_000, offNocopoPrivateBillionPlusCount: 1111 },
      },
      followTheMoney: {
        summary: { diffMatchedAwardedCount: 106, diffTotalAwardedNaira: 253_100_000_000, diffTotalNocopoDisbursedNaira: 90_000_000_000, diffPositivePaddingAwardedCount: 22, diffPositivePaddingAwardedNaira: 45_000_000_000, lineagesScanned: 3500, lineageClassificationCounts: { VENDOR_SWITCHED_REPEAT: 6, ACTIVE_PHASED_BUILD: 18, AWARDED_UNPAID: 5 } },
      },
    };

    const scoreSummary = buildMultiDatasetContextSummary({ query: 'Show MDA scorecard', mode: 'scorecard', activeYear: 2026, statisticalForensics: null, bundle: phase3Bundle });
    expect(scoreSummary?.bullets.some((b) => b.includes('FEDERAL CHARACTER COMMISSION'))).toBe(true);
    const riskSummary = buildMultiDatasetContextSummary({ query: 'Show procurement risk', mode: 'procurement_risk', activeYear: 2026, statisticalForensics: null, bundle: phase3Bundle });
    expect(riskSummary?.bullets.some((b) => b.includes('16,726'))).toBe(true);
    const cashSummary = buildMultiDatasetContextSummary({ query: 'Show December rush', mode: 'cash_forensics', activeYear: 2026, statisticalForensics: null, bundle: phase3Bundle });
    expect(cashSummary?.bullets.some((b) => b.includes('2.75x'))).toBe(true);
    const vendorSummary = buildMultiDatasetContextSummary({ query: 'Show captive vendors', mode: 'vendor_capture', activeYear: 2026, statisticalForensics: null, bundle: phase3Bundle });
    expect(vendorSummary?.bullets.some((b) => b.includes('25,869'))).toBe(true);
    const ftmSummary = buildMultiDatasetContextSummary({ query: 'Show follow the money', mode: 'follow_money', activeYear: 2026, statisticalForensics: null, bundle: phase3Bundle });
    expect(ftmSummary?.bullets.some((b) => b.includes('3,500'))).toBe(true);
  });

  it('synthesizes 6-ledger Evidence Engine v3.0, Red-Flag Convergence, and Presidential comparisons with strict public-text hygiene', () => {
    const phase6Bundle = {
      paddingIndex: null,
      executionTracker: null,
      staticSearchRecords: [],
      evidenceEngineAllYears: {
        summary: {
          yearsScanned: 28,
          firstYear: 1999,
          lastYear: 2026,
          totalRecordsScanned: 559391,
          totalRulesCount: 22,
          textRulesCount: 16,
          crossLedgerRulesCount: 6,
          totalRuleFindings: 49679,
          totalCrossLedgerFindings: 28113,
          totalFlaggedProjects: 28681,
          totalFlaggedNaira: 79_498_671_645_131,
          linkedPaidOnPaperCodesCount: 1196,
          linkedBillInsertionCodesCount: 3638,
          linkedZombieLineageCodesCount: 1036,
          trackedMdaRiskProfilesCount: 345,
        },
        topFlaggedMdasAllTime: [
          {
            mdaName: 'FEDERAL MINISTRY OF WORKS AND HOUSING',
            flaggedProjectCount: 914,
            totalRuleFindings: 2914,
            crossLedgerFindings: 2470,
            flaggedAmountNaira: 1_043_889_572_367,
            oaugfIssues: 18,
            grade: 'C',
          },
        ],
        topCompoundProjectsAllTime: [
          {
            id: 'P-2021-26013',
            financialYear: 2021,
            projectCode: 'ERGP12154805',
            projectName: 'REHABILITATION OF GOMBE-BIU ROAD',
            agency: 'FEDERAL MINISTRY OF WORKS AND HOUSING',
            amount: 1_010_000_000,
            page: 846,
            ruleCount: 8,
            compoundRiskScore: 100,
          },
        ],
      },
      redFlagConvergence: {
        headline: {
          convergentContractorCount: 29,
          highRisk3PlusContractorCount: 5,
          convergentContractorExposureNaira: 583_044_505_642,
          convergentMdaCount: 77,
          highRisk3PlusMdaCount: 27,
        },
        mdas: [
          {
            mdaName: 'STATE HOUSE',
            flagCount: 5,
            grade: 'D',
            oaugfQueryCount: 21,
            flagDetails: ['Legislative padding share 65.3% (see bir_2024.pdf NOCOPO GovSpend)'],
          },
        ],
        contractors: [
          {
            contractorName: 'CGC Nigeria Limited',
            flagCount: 3,
            totalExposureNaira: 63_293_030_611,
            flagDetails: ['Treasury paid 188.0% via GovSpend vs NOCOPO'],
          },
        ],
      },
      forensicSweep: {
        headlineMetrics: {
          uniqueFlaggedCapitalLines: 14250,
          discretionaryOverheadExposure: 855_750_589_471,
          combinedScrutinyExposure: 24_566_245_957_263,
          combinedScrutinyUsd: 37_034_916_177.33,
          combinedScheduledBudgetSharePct: 9.55,
          crossLedgerTotals: {
            oaugfParsedIssuesCount: 7028,
            oaugfRecoveryDirectiveCount: 675,
            evidenceEngineV3TotalFindings: 49679,
            evidenceEngineV3FlaggedProjects: 28681,
            openTreasuryPersonalAccountBeneficiaries: 10851,
            openTreasuryPersonalAccountNaira: 1_490_000_000_000,
            openTreasuryOpaqueDiscretionaryVouchers: 33366,
            openTreasuryOpaqueDiscretionaryNaira: 2_439_480_309_528,
          },
        },
        presidents: [
          {
            presidentId: 'buhari',
            presidentName: 'Muhammadu Buhari',
            shortName: 'Buhari',
            tenureLabel: '2015–2023',
            combinedNominal: 10_500_000_000_000,
            combinedUsd: 26_000_000_000,
            crossLedgerProfile: {
              oaugf: { issuesCount: 3100, recoveryDirectiveCount: 280 },
              legislativePadding: { cyclesCount: 6, insertionsCount: 55000 },
              macroAndDebt: { dmoEndDebtNairaM: 87_379_400 },
              evidenceEngineV3: { totalRuleFindingsCount: 21000 },
            },
          },
          {
            presidentId: 'tinubu',
            presidentName: 'Bola Ahmed Tinubu',
            shortName: 'Tinubu',
            tenureLabel: '2023–2026',
            combinedNominal: 12_100_000_000_000,
            combinedUsd: 8_500_000_000,
            crossLedgerProfile: {
              oaugf: { issuesCount: 410, recoveryDirectiveCount: 45 },
              legislativePadding: { cyclesCount: 1, insertionsCount: 12364 },
              macroAndDebt: { dmoEndDebtNairaM: 149_390_000 },
              evidenceEngineV3: { totalRuleFindingsCount: 18500 },
            },
          },
        ],
      },
    };

    const eeRes = buildMultiDatasetContextSummary({
      query: 'Summarize 28-year Evidence Engine v3.0 findings',
      mode: 'evidence_engine',
      activeYear: 2026,
      statisticalForensics: null,
      bundle: phase6Bundle,
    });
    expect(eeRes?.bullets.some((b) => b.includes('49,679') && b.includes('28,681'))).toBe(true);
    expect(eeRes?.bullets.some((b) => b.includes('ERGP12154805'))).toBe(true);

    const convRes = buildMultiDatasetContextSummary({
      query: 'Show Red-Flag Convergence with 3+ flags',
      mode: 'convergence',
      activeYear: 2026,
      statisticalForensics: null,
      bundle: phase6Bundle,
    });
    expect(convRes?.bullets.some((b) => b.includes('77') && b.includes('27'))).toBe(true);
    expect(convRes?.bullets.some((b) => b.includes('CGC Nigeria Limited'))).toBe(true);

    const presRes = buildMultiDatasetContextSummary({
      query: 'Compare Buhari and Tinubu across Fourth Republic scrutiny total',
      mode: 'presidential',
      activeYear: 2026,
      statisticalForensics: null,
      bundle: phase6Bundle,
    });
    expect(presRes?.bullets.some((b) => b.includes('₦24.57 Trillion') && b.includes('$37.03 Billion'))).toBe(true);
    expect(presRes?.bullets.some((b) => b.includes('₦1.49 Trillion'))).toBe(true);
    expect(presRes?.bullets.some((b) => b.includes('Muhammadu Buhari'))).toBe(true);
    expect(presRes?.bullets.some((b) => b.includes('Bola Ahmed Tinubu'))).toBe(true);

    for (const block of [eeRes, convRes, presRes]) {
      const combinedText = [block?.headline || '', ...(block?.bullets || []), block?.extraLine || ''].join('\n');
      for (const forbidden of [
        '.pdf',
        '.json',
        '.csv',
        'NOCOPO',
        'GovSpend',
        'MTEF/FSP',
        'SQL/FTS5',
        'Budget Implementation Report',
      ]) {
        expect(combinedText).not.toContain(forbidden);
      }
    }
  });
});
