import { describe, expect, it } from 'vitest';
import {
  build37StateLeagueRows,
  computeHqVsStateSplit,
  computeStateDeliveryMetrics,
  type GeoExecutionGlobalSummary,
  type GeoYearPayload,
} from '../../src/utils/geoIntelligence';
import type { OaugfAuditIndexPayload } from '../../src/utils/mdaScorecard';
import {
  buildStateBriefDocxBytes,
  buildStateBriefPdfBytes,
  buildStateBriefSpec,
} from '../../src/utils/documentExporter';

const SAMPLE_YEAR_DATA: GeoYearPayload = {
  financialYear: 2024,
  summary: {
    totalLeafItems: 100,
    totalBudgetNaira: 100_000_000_000,
    geoTaggedItems: 70,
    geoTaggedAmountNaira: 60_000_000_000,
    federalHqItems: 30,
    federalHqAmountNaira: 40_000_000_000,
    geoCoveragePct: 60.0,
    flaggedItemsTotal: 8,
    execution: {
      nocopoAwardedCount: 10,
      nocopoGeoMatchedCount: 6,
      nocopoGeoMatchedNaira: 12_000_000_000,
      nocopoHqNationwideNaira: 8_000_000_000,
      nocopoGeoMatchedPct: 60.0,
      govspendVoucherCount: 50,
      govspendGeoMatchedCount: 15,
      govspendGeoMatchedNaira: 15_000_000_000,
      govspendHqNationwideNaira: 35_000_000_000,
      govspendGeoMatchedPct: 30.0,
    },
  },
  zones: {},
  states: {
    Kano: {
      name: 'Kano',
      displayName: 'Kano',
      zone: 'North West',
      amountNaira: 25_000_000_000,
      projectCount: 30,
      flaggedCount: 6,
      flaggedAmountNaira: 5_000_000_000,
      flaggedSharePct: 20.0,
      anomalyScore: 'High',
      yoyDeltaPct: 12.5,
      priorYear: 2023,
      topMinistry: 'Works',
      topMinistryAmountNaira: 15_000_000_000,
      primaryItem: null,
      topProjects: [],
      lgaMappedCount: 14,
      unmappedLgaCount: 16,
      lgaBreakdown: [],
      contractedCount: 4,
      contractedNaira: 2_000_000_000,
      nocopoPaidNaira: 1_000_000_000,
      govspendVoucherCount: 12,
      govspendDisbursedNaira: 10_000_000_000,
    },
    Lagos: {
      name: 'Lagos',
      displayName: 'Lagos',
      zone: 'South West',
      amountNaira: 35_000_000_000,
      projectCount: 40,
      flaggedCount: 2,
      flaggedAmountNaira: 1_000_000_000,
      flaggedSharePct: 5.0,
      anomalyScore: 'Low',
      yoyDeltaPct: -4.0,
      priorYear: 2023,
      topMinistry: 'Transport',
      topMinistryAmountNaira: 20_000_000_000,
      primaryItem: null,
      topProjects: [],
      lgaMappedCount: 18,
      unmappedLgaCount: 22,
      lgaBreakdown: [],
      contractedCount: 6,
      contractedNaira: 20_000_000_000,
      nocopoPaidNaira: 12_000_000_000,
      govspendVoucherCount: 20,
      govspendDisbursedNaira: 75_000_000_000,
    },
  },
};

const SAMPLE_EXEC_SUMMARY: GeoExecutionGlobalSummary = {
  nocopoYearsCovered: [2024],
  nocopoTotalAwardedCount: 100,
  nocopoTotalAwardedNaira: 200_000_000_000,
  nocopoPlanningExcludedCount: 500,
  nocopoGeoMatchedCount: 60,
  nocopoGeoMatchedNaira: 120_000_000_000,
  nocopoGeoMatchedPct: 60.0,
  nocopoHqNationwideCount: 40,
  nocopoHqNationwideNaira: 80_000_000_000,
  govspendYearsCovered: [2024],
  govspendTotalVoucherCount: 500,
  govspendTotalDisbursedNaira: 500_000_000_000,
  govspendGeoMatchedCount: 150,
  govspendGeoMatchedNaira: 150_000_000_000,
  govspendGeoMatchedPct: 30.0,
  govspendHqNationwideCount: 350,
  govspendHqNationwideNaira: 350_000_000_000,
  cumulativeByZone: {},
  cumulativeByState: {
    Kano: {
      displayName: 'Kano',
      zone: 'North West',
      contractedCount: 4,
      contractedNaira: 2_000_000_000,
      nocopoPaidNaira: 1_000_000_000,
      govspendVoucherCount: 12,
      govspendDisbursedNaira: 10_000_000_000,
      topContractors: [{ name: 'KANO BUILDERS LTD', awardedNaira: 2_000_000_000, count: 4 }],
    },
    Lagos: {
      displayName: 'Lagos',
      zone: 'South West',
      contractedCount: 6,
      contractedNaira: 20_000_000_000,
      nocopoPaidNaira: 12_000_000_000,
      govspendVoucherCount: 20,
      govspendDisbursedNaira: 75_000_000_000,
      topContractors: [{ name: 'EKO INFRA PLC', awardedNaira: 20_000_000_000, count: 6 }],
    },
  },
};

describe('geoIntelligence unified helpers', () => {
  it('classifies Paper-Heavy Low Execution vs Disbursed Exceeds Awards states accurately', () => {
    const kano = computeStateDeliveryMetrics(SAMPLE_YEAR_DATA.states.Kano);
    expect(kano.deliveryGapBand).toBe('PAPER_HEAVY_LOW_EXECUTION');
    expect(kano.contractToBudgetPct).toBe(8.0);

    const lagos = computeStateDeliveryMetrics(SAMPLE_YEAR_DATA.states.Lagos);
    expect(lagos.deliveryGapBand).toBe('DISBURSED_EXCEEDS_AWARDS');
    expect(lagos.paidToContractPct).toBe(375.0);

    const empty = computeStateDeliveryMetrics(null);
    expect(empty.deliveryGapBand).toBe('MINIMAL_STATE_DATA');
  });

  it('computes HQ / Nationwide vs State-Tagged proportional splits across layers', () => {
    const budgetSplit = computeHqVsStateSplit('budget', 'fy', SAMPLE_YEAR_DATA, SAMPLE_EXEC_SUMMARY);
    expect(budgetSplit.stateMatchedPct).toBe(60.0);
    expect(budgetSplit.hqPct).toBe(40.0);

    const govCumSplit = computeHqVsStateSplit('disbursed', 'cumulative', SAMPLE_YEAR_DATA, SAMPLE_EXEC_SUMMARY);
    expect(govCumSplit.stateMatchedNaira).toBe(150_000_000_000);
    expect(govCumSplit.hqNationwideNaira).toBe(350_000_000_000);
    expect(govCumSplit.stateMatchedPct).toBe(30.0);
    expect(govCumSplit.hqPct).toBe(70.0);
  });

  it('builds 37-state league rows combining Budgeted, Contracted, Disbursed, and Top Contractor', () => {
    const rows = build37StateLeagueRows(SAMPLE_YEAR_DATA, SAMPLE_EXEC_SUMMARY, 'cumulative');
    expect(rows.length).toBe(2);
    const kanoRow = rows.find((r) => r.state === 'Kano')!;
    expect(kanoRow.topContractor?.name).toBe('KANO BUILDERS LTD');
    expect(kanoRow.deliveryGapBand).toBe('PAPER_HEAVY_LOW_EXECUTION');
  });

  it('attaches OAuGF MDA audit exposure & Bill->Act insertions onto league rows and State Brief PDF/DOCX exports', async () => {
    const mockOaugf: OaugfAuditIndexPayload = {
      generatedAt: '2026-11-23T12:00:00Z',
      status: 'VERIFIED',
      headline: {
        reportsIndexed: 1,
        totalPages: 40,
        totalChunks: 40,
        yearsCovered: [2021],
        parsedAuditIssuesCount: 18,
        matchedMdasCount: 1,
        categoryCounts: {},
      },
      documents: [],
      topIssues: [],
      byMda: {
        WORKS: {
          mdaKey: 'WORKS',
          mdaName: 'FEDERAL MINISTRY OF WORKS',
          findingCount: 18,
          repeatNeglectCount: 2,
          recoveryDirectiveCount: 5,
          totalFlaggedNaira: 4_000_000_000,
          reportYears: [2021],
          categories: {},
          sampleFindings: [],
        },
      },
    };

    const rows = build37StateLeagueRows(SAMPLE_YEAR_DATA, SAMPLE_EXEC_SUMMARY, 'cumulative', {
      oaugfIndex: mockOaugf,
      crossLedgerContext: {
        paidOnPaperCodes: [],
        billInsertionCodes: ['ERGP777'],
        zombieLineageCodes: [],
        mdaProfilesByKey: {},
      },
      yearRecords: [
        {
          state: 'Kano',
          projectCode: 'ERGP777',
          projectName: 'Zonal Solar Streetlights in Kano',
          agency: 'FEDERAL MINISTRY OF WORKS',
          amount: 1_500_000_000,
        },
      ],
    });

    const kano = rows.find((r) => r.state === 'Kano')!;
    expect(kano.oaugfQueriedMdaCount).toBe(1);
    expect(kano.oaugfQueriedExposureNaira).toBe(1_500_000_000);
    expect(kano.billInsertionCount).toBe(1);
    expect(kano.billInsertionNaira).toBe(1_500_000_000);

    const briefInput = {
      financialYear: 2024,
      stateName: 'Kano',
      displayName: 'Kano',
      zone: 'North West',
      anomalyScore: 'High',
      budgetedNaira: kano.budgetedNaira,
      projectCount: kano.projectCount,
      flaggedCount: kano.flaggedCount,
      flaggedAmountNaira: 5_000_000_000,
      flaggedSharePct: kano.flaggedSharePct,
      topMinistry: 'Works',
      contractedNairaFy: kano.contractedNaira,
      contractedNairaCumulative: kano.contractedNaira,
      disbursedNairaFy: kano.disbursedNaira,
      disbursedNairaCumulative: kano.disbursedNaira,
      topContractors: [{ name: 'KANO BUILDERS LTD', awardedNaira: 2_000_000_000, count: 4 }],
      topAllocations: [],
      lgaBreakdown: [],
      crossLedgerAccountability: {
        oaugfQueriedMdaCount: kano.oaugfQueriedMdaCount || 0,
        oaugfQueriedExposureNaira: kano.oaugfQueriedExposureNaira || 0,
        oaugfTotalMdaQueries: kano.oaugfTotalMdaQueries || 0,
        billInsertionCount: kano.billInsertionCount || 0,
        billInsertionNaira: kano.billInsertionNaira || 0,
        topOaugfMdas: kano.topOaugfMdas || [],
      },
    };

    const spec = buildStateBriefSpec(briefInput);
    expect(spec.tables).toHaveLength(4);
    expect(spec.tables[3].heading).toContain('OAuGF-Queried MDA Exposure');

    const pdfBytes = await buildStateBriefPdfBytes(briefInput);
    const docxBytes = await buildStateBriefDocxBytes(briefInput);
    expect(new TextDecoder('ascii').decode(pdfBytes.slice(0, 5))).toBe('%PDF-');
    expect(docxBytes[0]).toBe(0x50);
    expect(docxBytes[1]).toBe(0x4b);
  });
});
