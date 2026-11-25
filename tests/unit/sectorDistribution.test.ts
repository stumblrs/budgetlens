import { describe, expect, it } from 'vitest';
import type { BudgetRecord } from '../../src/services/budgetDatabaseEngine';
import type { CompoundFlaggedProject } from '../../src/utils/ruleEngine';
import type {
  MdaScorecardEntry,
  OaugfAuditIndexPayload,
  RedFlagConvergencePayload,
} from '../../src/utils/mdaScorecard';
import {
  buildReconciledDonutSlices,
  computeFlaggedExposureByGroup,
  shortenEntityLabel,
} from '../../src/utils/sectorDistribution';

function makeRecord(overrides: {
  id: string;
  projectCode?: string;
  projectName?: string;
  amount: number;
  mdaName: string;
  sector: string;
  hasRedFlags?: boolean;
}): BudgetRecord {
  return {
    recordIdentity: {
      id: overrides.id,
      projectCode: overrides.projectCode ?? overrides.id,
      verbatimProjectName: overrides.projectName ?? `Project ${overrides.id}`,
      amountNaira: overrides.amount,
      amountMillions: overrides.amount / 1e6,
      financialYear: 2026,
      recordHash: `hash-${overrides.id}`,
    } as BudgetRecord['recordIdentity'],
    sourceProvenance: {
      documentId: 'doc-2026',
      sourceFilename: '2026_ACT.pdf',
      pdfPage: 10,
      sha256Hash: 'abc123',
      extractionMethod: 'pdf',
    } as BudgetRecord['sourceProvenance'],
    geographicTaxonomy: {
      state: 'FCT',
      geopoliticalZone: 'North-Central',
      isNationwide: false,
      locationText: 'Abuja',
    } as BudgetRecord['geographicTaxonomy'],
    mdaGovernanceTaxonomy: {
      sector: overrides.sector,
      ministryCode: '0234',
      mdaName: overrides.mdaName,
    } as BudgetRecord['mdaGovernanceTaxonomy'],
    multiYearLineage: {
      lineageId: overrides.id,
      appearanceCount: 1,
      firstSeenYear: 2026,
      lastSeenYear: 2026,
      cumulativeAmountNaira: overrides.amount,
      isZombieCandidate: false,
    } as BudgetRecord['multiYearLineage'],
    forensicEvidenceFlags: overrides.hasRedFlags
      ? ([{ ruleId: 'TEST_RULE', ruleName: 'Test Flag', severity: 'high', reason: 'Test' }] as BudgetRecord['forensicEvidenceFlags'])
      : [],
  };
}

describe('sectorDistribution utilities', () => {
  it('reconciles 40 MDAs so ranks 26-40 and true tail are included inside Other totaling 100.0%', () => {
    const entries = Array.from({ length: 40 }, (_, idx) => ({
      name: `FEDERAL MINISTRY OF AGENCY ${idx + 1}`,
      amount: (40 - idx) * 1_000_000_000,
    }));
    const totalAmount = entries.reduce((sum, e) => sum + e.amount, 0);

    const summary = buildReconciledDonutSlices({
      dimension: 'mda',
      entries,
      totalAmount,
      maxVisibleSlices: 7,
    });

    expect(summary.totalEntitiesCount).toBe(40);
    expect(summary.slices).toHaveLength(8); // Top 7 + Other (33 MDAs)
    const otherSlice = summary.slices[summary.slices.length - 1];
    expect(otherSlice.isOther).toBe(true);
    expect(otherSlice.name).toBe('Other (33 MDAs)');
    expect(otherSlice.otherEntityCount).toBe(33);

    const expectedTailAmount = entries.slice(7).reduce((sum, e) => sum + e.amount, 0);
    expect(otherSlice.amount).toBe(expectedTailAmount);

    const sliceSum = summary.slices.reduce((sum, s) => sum + s.amount, 0);
    const pctSum = summary.slices.reduce((sum, s) => sum + s.sharePct, 0);
    expect(sliceSum).toBe(totalAmount);
    expect(pctSum).toBeCloseTo(100, 6);
  });

  it('reconciles 11 canonical sectors, computes YoY delta vs prior year, and computes top3SharePct', () => {
    const sectorEntries = [
      { name: 'Works & Housing', amount: 400_000_000_000 },
      { name: 'Defence & Security', amount: 250_000_000_000 },
      { name: 'Power & Energy', amount: 150_000_000_000 },
      { name: 'Education', amount: 50_000_000_000 },
      { name: 'Health & Social Welfare', amount: 40_000_000_000 },
      { name: 'Agriculture & Water', amount: 30_000_000_000 },
      { name: 'Transport & Aviation', amount: 25_000_000_000 },
      { name: 'General Administration', amount: 20_000_000_000 },
      { name: 'ICT & Science', amount: 15_000_000_000 },
      { name: 'Finance & Economy', amount: 12_000_000_000 },
      { name: 'Justice & Legislature', amount: 8_000_000_000 },
    ];
    const priorEntries = [
      { name: 'Works & Housing', amount: 200_000_000_000 },
      { name: 'Defence & Security', amount: 250_000_000_000 },
    ];

    const summary = buildReconciledDonutSlices({
      dimension: 'sector',
      entries: sectorEntries,
      totalAmount: 1_000_000_000_000,
      priorEntries,
      priorTotalAmount: 800_000_000_000,
      maxVisibleSlices: 8,
    });

    expect(summary.slices).toHaveLength(9); // Top 8 + Other (3 Sectors)
    expect(summary.top3SharePct).toBeCloseTo(80, 4);
    expect(summary.totalYoyDeltaPct).toBeCloseTo(25, 4);

    const worksSlice = summary.slices[0];
    expect(worksSlice.name).toBe('Works & Housing');
    expect(worksSlice.yoyDeltaPct).toBeCloseTo(100, 4);
    expect(worksSlice.shareShiftPts).toBeCloseTo(15, 4); // 40% vs 25%

    const pctSum = summary.slices.reduce((sum, s) => sum + s.sharePct, 0);
    expect(pctSum).toBeCloseTo(100, 6);
  });

  it('shortens verbose federal MDA labels cleanly while preserving key acronyms', () => {
    expect(shortenEntityLabel('FEDERAL MINISTRY OF WORKS AND HOUSING', 28)).toBe('Works and Housing');
    expect(shortenEntityLabel('OFFICE OF THE NATIONAL SECURITY ADVISER', 28)).toBe('ONSA (Security)');
    expect(shortenEntityLabel('FEDERAL MINISTRY OF ICT AND SCIENCE', 28)).toBe('ICT and Science');
  });

  it('computes flagged exposure by Sector and MDA using compound risk and red flags', () => {
    const r1 = makeRecord({
      id: 'ERGP100001',
      amount: 300_000_000,
      mdaName: 'FEDERAL MINISTRY OF WORKS',
      sector: 'Works & Housing',
      hasRedFlags: false,
    });
    const r2 = makeRecord({
      id: 'ERGP100002',
      amount: 700_000_000,
      mdaName: 'FEDERAL MINISTRY OF WORKS',
      sector: 'Works & Housing',
      hasRedFlags: false,
    });
    const r3 = makeRecord({
      id: 'ERGP200001',
      amount: 500_000_000,
      mdaName: 'MINISTRY OF DEFENCE',
      sector: 'Defence & Security',
      hasRedFlags: true,
    });

    const compoundProjects: CompoundFlaggedProject[] = [
      {
        projectKey: '2026:ERGP100001:10:300000000',
        id: 'ERGP100001',
        projectCode: 'ERGP100001',
        projectName: 'Project ERGP100001',
        agency: 'FEDERAL MINISTRY OF WORKS',
        sector: 'Works & Housing',
        financialYear: 2026,
        amount: 300_000_000,
        page: 10,
        highestSeverity: 'high',
        compoundRiskScore: 82,
        ruleCount: 3,
        crossLedgerRuleCount: 1,
        triggeredRules: [],
        crossLedgerBadges: {
          paidOnPaper: true,
          billInsertedOrInflated: false,
          zombieRecurringLineage: false,
          mdaOaugfIssuesCount: 2,
          mdaOaugfRepeatCount: 1,
          mdaOaugfAmountNaira: 0,
          mdaIntegrityGrade: 'D',
          mdaCompositeScore: 41,
          mdaPersonalOrOpaquePayoutFlag: false,
          mdaConvergenceFlags: [],
          mdaRepeatAssetCategories: [],
        },
      },
    ];

    const flagged = computeFlaggedExposureByGroup([r1, r2, r3], compoundProjects, 2026);
    expect(flagged.bySector['works & housing'].flaggedCount).toBe(1);
    expect(flagged.bySector['works & housing'].flaggedAmount).toBe(300_000_000);
    expect(flagged.bySector['works & housing'].compoundCount).toBe(1);
    expect(flagged.byMda['federal ministry of works'].flaggedAmount).toBe(300_000_000);
    expect(flagged.bySector['defence & security'].flaggedAmount).toBe(500_000_000);
  });

  it('attaches 6-ledger MDA Scorecard Grade, OAuGF query count, and Convergence labels in MDA mode', () => {
    const scorecards: MdaScorecardEntry[] = [
      {
        rank: 1,
        mdaKey: 'WORKS',
        mdaName: 'FEDERAL MINISTRY OF WORKS',
        parentFamilies: [],
        compositeScore: 42.5,
        grade: 'D',
        metricsPresent: 4,
        totalExpectedMetrics: 5,
        activeWeightSum: 0.8,
        coverageTier: 'STRONG_4_PILLAR',
        totalTrackedExposureNaira: 500_000_000_000,
        pillars: {} as any,
      },
    ];

    const oaugfIndex: OaugfAuditIndexPayload = {
      generatedAt: '2026-01-01',
      status: 'ok',
      byMda: {
        WORKS: {
          mdaKey: 'WORKS',
          mdaName: 'FEDERAL MINISTRY OF WORKS',
          findingCount: 14,
          repeatNeglectCount: 5,
          recoveryDirectiveCount: 2,
          totalFlaggedNaira: 12_000_000_000,
          categories: {},
          findings: [],
        },
      },
    } as any;

    const convergenceIndex: RedFlagConvergencePayload = {
      generatedAt: '2026-01-01',
      status: 'ok',
      headline: {
        convergentContractorCount: 0,
        highRisk3PlusContractorCount: 0,
        convergentContractorExposureNaira: 0,
        convergentMdaCount: 1,
        highRisk3PlusMdaCount: 0,
      },
      contractors: [],
      mdas: [
        {
          mdaKey: 'WORKS',
          mdaName: 'FEDERAL MINISTRY OF WORKS',
          flagCount: 2,
          flags: ['HIGH_OAUGF_NEGLIGENCE', 'LOW_INTEGRITY_GRADE'],
          flagDetails: [],
          compositeScore: 42.5,
          grade: 'D',
          oaugfQueryCount: 14,
          oaugfRepeatCount: 5,
          totalExposureNaira: 500_000_000_000,
        },
      ],
    };

    const summary = buildReconciledDonutSlices({
      dimension: 'mda',
      entries: [{ name: 'FEDERAL MINISTRY OF WORKS', amount: 500_000_000_000 }],
      totalAmount: 500_000_000_000,
      mdaScorecards: scorecards,
      oaugfIndex,
      convergenceIndex,
    });

    const worksSlice = summary.slices[0];
    expect(worksSlice.mdaAudit).not.toBeNull();
    expect(worksSlice.mdaAudit?.grade).toBe('D');
    expect(worksSlice.mdaAudit?.oaugfQueries).toBe(14);
    expect(worksSlice.mdaAudit?.convergenceFlagCount).toBe(2);
    expect(worksSlice.mdaAudit?.convergenceLabels).toEqual([
      'OAuGF Audit Queries',
      'Low Scorecard Grade (D/F)',
    ]);
  });
});
