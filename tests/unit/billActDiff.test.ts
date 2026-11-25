import { describe, it, expect } from 'vitest';
import {
  classifyDiffDelta,
  filterBillActDiffItems,
  isSummaryComparisonScope,
  isZonalInterventionItem,
  type BillActDiffItem,
} from '../../src/utils/billActDiff';
import { readPaddingUrlState } from '../../src/utils/urlState';
import {
  buildPaddingDiffDocxBytes,
  buildPaddingDiffPdfBytes,
} from '../../src/utils/documentExporter';
import {
  lookupOaugfAssetAndUnvouched,
  lookupOaugfMdaFindings,
  type OaugfAuditIndexPayload,
} from '../../src/utils/mdaScorecard';

describe('Bill vs. Act Budget Padding Diff Engine', () => {
  it('classifies NASS insertions, inflations, cuts, removals, and unchanged lines accurately', () => {
    expect(classifyDiffDelta(0, 250_000_000)).toEqual({
      status: 'NASS_INSERTION',
      deltaNaira: 250_000_000,
      deltaPct: null,
    });
    expect(classifyDiffDelta(100_000_000, 0)).toEqual({
      status: 'REMOVED_BY_NASS',
      deltaNaira: -100_000_000,
      deltaPct: -100,
    });
    expect(classifyDiffDelta(100_000_000, 145_000_000)).toEqual({
      status: 'ALLOCATION_INFLATED',
      deltaNaira: 45_000_000,
      deltaPct: 45,
    });
    expect(classifyDiffDelta(200_000_000, 150_000_000)).toEqual({
      status: 'ALLOCATION_CUT',
      deltaNaira: -50_000_000,
      deltaPct: -25,
    });
    expect(classifyDiffDelta(50_000_000, 50_000_000)).toEqual({
      status: 'UNCHANGED',
      deltaNaira: 0,
      deltaPct: 0,
    });
  });

  it('detects Zonal Intervention Projects (ZIP), granularity guard, and ?diffFilter URL param', () => {
    expect(isZonalInterventionItem('ZIP101', 'Supply of Transformers', '2025 Act.pdf')).toBe(true);
    expect(
      isZonalInterventionItem('ERGP5', 'Solar Boreholes (Zonal Intervention)', '2022.pdf')
    ).toBe(true);
    expect(
      isZonalInterventionItem('ERGP1', 'Rehabilitation of Highway', 'Signed 2019 Zonal Intervention Projects.pdf')
    ).toBe(true);
    expect(isZonalInterventionItem('ERGP2', 'Construction of Classroom Block', '2025 Act.pdf')).toBe(false);

    expect(isSummaryComparisonScope('SUMMARY_LEVEL_ONLY')).toBe(true);
    expect(isSummaryComparisonScope('LINE_ITEM_SCHEDULE')).toBe(false);

    expect(readPaddingUrlState('?tab=padding&diffFilter=zip').diffFilter).toBe('zip');
    expect(readPaddingUrlState('?tab=padding&diffFilter=bogus').diffFilter).toBe('all');
  });

  it('filters diff items by status, ZIP badge, and search query', () => {
    const sample: BillActDiffItem[] = [
      {
        id: 'DIFF-2025-1',
        financialYear: 2025,
        status: 'NASS_INSERTION',
        matchConfidence: 'UNMATCHED',
        isZonalIntervention: true,
        projectCode: 'ZIP99',
        projectName: 'Supply of Tricycles in Bauchi',
        mdaName: 'Ministry of Agriculture',
        proposedAmountNaira: 0,
        enactedAmountNaira: 300_000_000,
        deltaNaira: 300_000_000,
        deltaPct: null,
        billSourceFile: '2025 Bill.pdf',
        billPage: null,
        actSourceFile: '2025 Act.pdf',
        actPage: 44,
        billSha256: 'sha256:bill',
        actSha256: 'sha256:act',
      },
      {
        id: 'DIFF-2025-2',
        financialYear: 2025,
        status: 'ALLOCATION_INFLATED',
        matchConfidence: 'EXACT_CODE',
        isZonalIntervention: false,
        projectCode: 'ERGP2025',
        projectName: 'Dualization of Abuja-Lokoja Road',
        mdaName: 'Federal Ministry of Works',
        proposedAmountNaira: 1_000_000_000,
        enactedAmountNaira: 1_500_000_000,
        deltaNaira: 500_000_000,
        deltaPct: 50,
        billSourceFile: '2025 Bill.pdf',
        billPage: 10,
        actSourceFile: '2025 Act.pdf',
        actPage: 12,
        billSha256: 'sha256:bill',
        actSha256: 'sha256:act',
      },
    ];

    expect(filterBillActDiffItems(sample, 'zip')).toHaveLength(1);
    expect(filterBillActDiffItems(sample, 'inflated')).toHaveLength(1);
    expect(filterBillActDiffItems(sample, 'all', 'Bauchi')).toHaveLength(1);
    expect(filterBillActDiffItems(sample, 'contracted', '', new Set(['DIFF-2025-2']))).toHaveLength(1);
    expect(readPaddingUrlState('?tab=padding&diffFilter=contracted').diffFilter).toBe('contracted');
  });

  it('builds valid %PDF- and OOXML PK binaries for Padding Diff Briefs', async () => {
    const summary = {
      financialYear: 2025,
      comparisonScope: 'LINE_ITEM_SCHEDULE' as const,
      comparisonNote: 'Full line-item schedule comparison.',
      billFiles: ['2025 Executive Proposal.pdf'],
      actFiles: ['2025 Appropriation ACT as Passed.pdf'],
      billSha256: 'sha256:billhash',
      actSha256: 'sha256:acthash',
      billItemCount: 1000,
      actItemCount: 1200,
      billTotalNaira: 40_000_000_000_000,
      actTotalNaira: 46_000_000_000_000,
      netDeltaNaira: 6_000_000_000_000,
      insertionsCount: 200,
      insertionsTotalNaira: 5_000_000_000_000,
      inflatedCount: 50,
      inflatedTotalNaira: 1_000_000_000_000,
      cutCount: 10,
      cutTotalNaira: 100_000_000_000,
      removedCount: 0,
      removedTotalNaira: 0,
      unchangedCount: 940,
      zipCount: 40,
      zipTotalNaira: 800_000_000_000,
      topPaddedMdas: [
        {
          mdaName: 'Federal Ministry of Works',
          insertionsNaira: 2_000_000_000,
          inflatedDeltaNaira: 500_000_000,
          cutDeltaNaira: 0,
          alteredCount: 5,
          totalPositivePaddingNaira: 2_500_000_000,
        },
      ],
    };

    const pdfBytes = await buildPaddingDiffPdfBytes({
      summary,
      diffFilter: 'all',
      filteredItems: [],
      permalink: 'https://budgetlens.ng/?tab=padding&year=2025',
    });
    expect(new TextDecoder('ascii').decode(pdfBytes.slice(0, 5))).toBe('%PDF-');

    const docxBytes = await buildPaddingDiffDocxBytes({
      summary,
      diffFilter: 'all',
      filteredItems: [],
      permalink: 'https://budgetlens.ng/?tab=padding&year=2025',
    });
    expect(docxBytes[0]).toBe(0x50);
    expect(docxBytes[1]).toBe(0x4b);
  });

  it('extracts OAuGF Asset Management, Unvouched Vouchers, and MDA Negligence signals for diffs & assets', () => {
    const mockOaugf: OaugfAuditIndexPayload = {
      generatedAt: '2026-11-23T12:00:00Z',
      status: 'VERIFIED',
      headline: {
        reportsIndexed: 2,
        totalPages: 120,
        totalChunks: 200,
        yearsCovered: [2020, 2021],
        parsedAuditIssuesCount: 25,
        matchedMdasCount: 1,
        categoryCounts: {
          'Internal Control & Asset Management': 9,
          'Unvouched / Missing Payment Vouchers': 6,
          'Unretired Advances & Cash Irregularities': 4,
        },
      },
      documents: [],
      topIssues: [],
      byMda: {
        POWER: {
          mdaKey: 'POWER',
          mdaName: 'FEDERAL MINISTRY OF POWER -HQTRS',
          findingCount: 25,
          repeatNeglectCount: 3,
          recoveryDirectiveCount: 7,
          totalFlaggedNaira: 12_500_000_000,
          reportYears: [2020, 2021],
          categories: {
            'Internal Control & Asset Management': 9,
            'Unvouched / Missing Payment Vouchers': 6,
            'Unretired Advances & Cash Irregularities': 4,
          },
          sampleFindings: [],
        },
      },
    };

    const assetSummary = lookupOaugfAssetAndUnvouched(mockOaugf, 'MINISTRY OF POWER - HQTRS');
    expect(assetSummary).not.toBeNull();
    expect(assetSummary?.assetManagementCount).toBe(9);
    expect(assetSummary?.unvouchedCount).toBe(6);
    expect(assetSummary?.unretiredAdvanceCount).toBe(4);
    expect(assetSummary?.totalQueries).toBe(25);

    const diffMdaMatch = lookupOaugfMdaFindings(mockOaugf, 'Federal Ministry of Power');
    expect(diffMdaMatch?.repeatNeglectCount).toBe(3);
  });
});
