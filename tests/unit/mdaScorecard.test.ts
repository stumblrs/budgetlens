import { describe, expect, it } from 'vitest';
import {
  computeActiveWeightedScore,
  formatConvergenceFlagLabel,
  getScoreGradeMeta,
  lookupContractorConvergence,
  lookupMdaConvergence,
  lookupOaugfProcurementViolations,
  matchMdaScorecardByName,
  normalizeContractorLookupKey,
  normalizeMdaLookupKey,
  type MdaScorecardEntry,
  type OaugfAuditIndexPayload,
  type RedFlagConvergencePayload,
} from '../../src/utils/mdaScorecard';
import {
  buildCompoundProjectLookup,
  findCompoundForProject,
  type CompoundFlaggedProject,
} from '../../src/utils/ruleEngine';
import {
  buildMdaScorecardBriefDocxBytes,
  buildMdaScorecardBriefPdfBytes,
  buildMdaScorecardBriefSpec,
} from '../../src/utils/documentExporter';

function makeMockEntry(overrides: Partial<MdaScorecardEntry>): MdaScorecardEntry {
  return {
    rank: 1,
    mdaKey: 'WORKS',
    mdaName: 'FEDERAL MINISTRY OF WORKS',
    parentFamilies: ['WORKS'],
    compositeScore: 62.5,
    grade: 'C',
    metricsPresent: 5,
    totalExpectedMetrics: 5,
    activeWeightSum: 100,
    coverageTier: 'FULL_5_PILLAR',
    totalTrackedExposureNaira: 1_500_000_000_000,
    pillars: {
      paddingRestraint: { score: 80, weight: 20, status: 'SCORED' },
      birCapitalExecution: { score: 50, weight: 20, status: 'SCORED' },
      openBiddingShare: { score: 70, weight: 20, status: 'SCORED' },
      vendorDiversification: { score: 45, weight: 20, status: 'SCORED' },
      cashDiscipline: { score: 67.5, weight: 20, status: 'SCORED' },
    },
    ...overrides,
  };
}

describe('mdaScorecard utilities', () => {
  it('omits null/uncovered pillars from the active weight denominator instead of scoring them 0', () => {
    const res = computeActiveWeightedScore({
      paddingRestraint: { score: 90, weight: 20 },
      birCapitalExecution: { score: null, weight: 20 },
      openBiddingShare: { score: 60, weight: 20 },
      vendorDiversification: { score: null, weight: 20 },
      cashDiscipline: { score: 75, weight: 20 },
    });

    expect(res.metricsPresent).toBe(3);
    expect(res.totalExpectedMetrics).toBe(5);
    expect(res.activeWeightSum).toBe(60);
    // Mean of [90, 60, 75] = 75.0 (if missing had been treated as 0, it would wrongly be 45.0)
    expect(res.compositeScore).toBe(75);
  });

  it('returns null composite score when zero pillars have valid coverage', () => {
    const res = computeActiveWeightedScore({
      paddingRestraint: { score: null, weight: 20 },
      birCapitalExecution: { score: null, weight: 20 },
    });
    expect(res.compositeScore).toBeNull();
    expect(res.metricsPresent).toBe(0);
    expect(res.activeWeightSum).toBe(0);
  });

  it('assigns deterministic grade metadata including N/A for uncovered inputs', () => {
    expect(getScoreGradeMeta(84.2).grade).toBe('A');
    expect(getScoreGradeMeta(70.0).grade).toBe('B');
    expect(getScoreGradeMeta(52.4).grade).toBe('C');
    expect(getScoreGradeMeta(38.9).grade).toBe('D');
    expect(getScoreGradeMeta(21.0).grade).toBe('F');
    expect(getScoreGradeMeta(null).grade).toBe('N/A');
  });

  it('matches Verbatim MDA display labels against canonical scorecard entries', () => {
    const entries: MdaScorecardEntry[] = [
      makeMockEntry({
        mdaKey: 'AGRICULTURE AND FOOD SECURITY',
        mdaName: 'FEDERAL MINISTRY OF AGRICULTURE AND FOOD SECURITY',
        parentFamilies: ['AGRICULTURE'],
      }),
      makeMockEntry({
        mdaKey: 'SCIENCE TECHNOLOGY AND INNOVATION',
        mdaName: 'FEDERAL MINISTRY OF INNOVATION, SCIENCE AND TECHNOLOGY',
        parentFamilies: ['SCIENCE_TECH'],
      }),
      makeMockEntry({
        mdaKey: 'WORKS',
        mdaName: 'FEDERAL MINISTRY OF WORKS',
        parentFamilies: ['WORKS'],
      }),
    ];

    expect(normalizeMdaLookupKey('MINISTRY OF DEFENCE - MOD HQTRS')).toBe('DEFENCE');
    expect(
      matchMdaScorecardByName(entries, 'FEDERAL MINISTRY OF AGRICULTURE AND FOOD SECURITY -')?.mdaKey
    ).toBe('AGRICULTURE AND FOOD SECURITY');
    expect(
      matchMdaScorecardByName(entries, 'FEDERAL MINISTRY OF SCIENCE, TECHNOLOGY AND')?.mdaKey
    ).toBe('SCIENCE TECHNOLOGY AND INNOVATION');
    expect(matchMdaScorecardByName(entries, 'UNKNOWN NONEXISTENT BODY 999')).toBeNull();
  });

  it('matches red-flag convergence entries for MDAs and contractors cleanly', () => {
    const mockConvergence: RedFlagConvergencePayload = {
      generatedAt: '2026-11-23T12:00:00Z',
      status: 'VERIFIED_RED_FLAG_CONVERGENCE',
      headline: {
        convergentContractorCount: 2,
        highRisk3PlusContractorCount: 1,
        convergentContractorExposureNaira: 90_000_000_000,
        convergentMdaCount: 2,
        highRisk3PlusMdaCount: 1,
      },
      contractors: [
        {
          contractorKey: 'CGC NIG LTD',
          contractorName: 'CGC Nigeria Limited',
          bppContractorId: 'BPP-CI-68',
          flagCount: 3,
          flags: ['NON_COMPETITIVE_PROCUREMENT', 'OVERPAID_GT_125_PCT', 'PADDED_OR_ZOMBIE_LINEAGE_LINK'],
          flagDetails: ['Treasury paid 188.0% of recorded contract awards'],
          totalExposureNaira: 63_293_030_611,
          awardedNaira: 33_670_383_383,
          govspendPaidNaira: 63_293_030_611,
          excessOverAwardNaira: 29_622_647_228,
          overrunDeltaNaira: 0,
          nonCompetitiveNaira: 33_305_001_957,
          mdasInvolved: ['FEDERAL MINISTRY OF WORKS'],
        },
        {
          contractorKey: 'DIAMOND LEEDS LTD',
          contractorName: 'DIAMOND LEEDS LTD',
          bppContractorId: null,
          flagCount: 3,
          flags: ['CAPTIVE_OR_MULTI_MDA_DOMINANCE', 'OVERPAID_GT_125_PCT'],
          flagDetails: ['Multi-MDA super-contractor winning across 14 MDAs'],
          totalExposureNaira: 29_147_968_585,
          awardedNaira: 1_810_419_576,
          govspendPaidNaira: 29_147_968_585,
          excessOverAwardNaira: 27_337_549_009,
          overrunDeltaNaira: 0,
          nonCompetitiveNaira: 0,
          mdasInvolved: ['FEDERAL MINISTRY OF WORKS'],
        },
      ],
      mdas: [
        {
          mdaKey: 'STATE HOUSE',
          mdaName: 'STATE HOUSE',
          flagCount: 5,
          flags: ['HIGH_OAUGF_NEGLIGENCE', 'OPAQUE_OR_STAFF_PAYOUTS'],
          flagDetails: ['21 OAuGF audit queries'],
          compositeScore: 35.3,
          grade: 'D',
          oaugfQueryCount: 21,
          oaugfRepeatCount: 0,
          totalExposureNaira: 1_060_320_535_463,
        },
      ],
    };

    expect(normalizeContractorLookupKey('CGC Nigeria Limited')).toBe('CGC NIG LTD');
    expect(formatConvergenceFlagLabel('OPAQUE_OR_STAFF_PAYOUTS')).toBe('Personal / Opaque Cash');
    expect(lookupContractorConvergence(mockConvergence, 'CGC Nigeria Ltd', 'BPP-CI-68')?.flagCount).toBe(3);
    expect(lookupContractorConvergence(mockConvergence, 'Diamond Leeds Limited')?.contractorKey).toBe(
      'DIAMOND LEEDS LTD'
    );
    expect(lookupContractorConvergence(mockConvergence, 'UNFLAGGED VENDOR PLC')).toBeNull();
    expect(lookupMdaConvergence(mockConvergence, 'STATE HOUSE - HQTRS')?.flagCount).toBe(5);
    expect(lookupMdaConvergence(mockConvergence, 'NONEXISTENT AGENCY 404')).toBeNull();
  });

  it('extracts OAuGF procurement due-process violation counts for MDAs', () => {
    const mockOaugf: OaugfAuditIndexPayload = {
      generatedAt: '2026-11-23T12:00:00Z',
      status: 'VERIFIED',
      headline: {
        reportsIndexed: 1,
        totalPages: 100,
        totalChunks: 100,
        yearsCovered: [2021],
        parsedAuditIssuesCount: 15,
        matchedMdasCount: 1,
        categoryCounts: {},
      },
      documents: [],
      topIssues: [],
      byMda: {
        WORKS: {
          mdaKey: 'WORKS',
          mdaName: 'FEDERAL MINISTRY OF WORKS',
          findingCount: 15,
          repeatNeglectCount: 2,
          recoveryDirectiveCount: 4,
          totalFlaggedNaira: 5_000_000_000,
          reportYears: [2021],
          categories: {
            'Procurement & Due Process Violations': 6,
            'Contract Overpayments & Abandoned Works': 5,
            'Unvouched / Missing Payment Vouchers': 4,
          },
          sampleFindings: [],
        },
      },
    };

    const summary = lookupOaugfProcurementViolations(mockOaugf, 'FEDERAL MINISTRY OF WORKS - HQTRS');
    expect(summary).not.toBeNull();
    expect(summary?.procurementViolationCount).toBe(6);
    expect(summary?.contractOverpaymentCount).toBe(5);
    expect(summary?.totalQueries).toBe(15);
    expect(summary?.recoveryDirectiveCount).toBe(4);
  });

  it('maps CompoundFlaggedProject entries onto Capital Projects rows via exact and fallback keys', () => {
    const mockCompound: CompoundFlaggedProject[] = [
      {
        projectKey: '2026:ERGP99123:44:250000000',
        id: 'ERGP99123',
        projectCode: 'ERGP99123',
        projectName: 'Purchase of 50 Prado SUVs',
        agency: 'STATE HOUSE',
        sector: 'General Administration',
        financialYear: 2026,
        amount: 250_000_000,
        page: 44,
        highestSeverity: 'high',
        compoundRiskScore: 68,
        ruleCount: 3,
        crossLedgerRuleCount: 2,
        triggeredRules: [],
        crossLedgerBadges: {
          paidOnPaper: true,
          billInsertedOrInflated: true,
          zombieRecurringLineage: false,
          mdaOaugfIssuesCount: 21,
          mdaOaugfRepeatCount: 0,
          mdaOaugfAmountNaira: 1_000_000_000,
          mdaIntegrityGrade: 'D',
          mdaCompositeScore: 35.3,
          mdaPersonalOrOpaquePayoutFlag: true,
          mdaConvergenceFlags: ['OPAQUE_OR_STAFF_PAYOUTS'],
          mdaRepeatAssetCategories: [],
        },
      },
    ];

    const lookup = buildCompoundProjectLookup(mockCompound);
    const exactMatch = findCompoundForProject(lookup, 2026, {
      id: 'row-1',
      projectCode: 'ERGP99123',
      page: 44,
      amount: 250_000_000,
    });
    expect(exactMatch?.compoundRiskScore).toBe(68);
    expect(exactMatch?.crossLedgerBadges.paidOnPaper).toBe(true);

    const codeFallback = findCompoundForProject(lookup, 2026, {
      projectCode: 'ERGP99123',
      page: 999,
      amount: 100,
    });
    expect(codeFallback?.projectKey).toBe('2026:ERGP99123:44:250000000');
  });

  it('includes 6-ledger convergence telemetry in MDA Scorecard PDF and DOCX exports', async () => {
    const briefInput = {
      mdaKey: 'STATE HOUSE',
      mdaName: 'STATE HOUSE',
      parentFamilies: ['PRESIDENCY'],
      compositeScore: 35.3,
      grade: 'D',
      metricsPresent: 5,
      totalExpectedMetrics: 5,
      activeWeightSum: 100,
      totalTrackedExposureNaira: 1_060_320_535_463,
      pillarRows: [
        {
          pillarLabel: 'Legislative Padding Restraint',
          weight: 20,
          effectiveWeightPct: '20',
          score: 30,
          status: 'SCORED',
          telemetrySummary: 'Legislative padding share 65.3%',
        },
      ],
      convergenceSummary: {
        flagCount: 5,
        flags: ['Personal / Opaque Cash', 'OAuGF Audit Queries'],
        flagDetails: ['21 OAuGF audit queries', 'December spending surge 3.78x'],
        oaugfQueryCount: 21,
        oaugfRepeatCount: 0,
        oaugfRecoveryDirectives: 1,
        hasPersonalOrOpaqueCash: true,
        eeV3RuleHits: 1250,
        eeV3CrossLedgerHits: 410,
        eeV3FlaggedProjects: 680,
        eeV3FlaggedAmountNaira: 280_000_000_000,
        repeatAssetCategories: ['MOTOR_VEHICLES'],
      },
    };

    const spec = buildMdaScorecardBriefSpec(briefInput);
    expect(spec.tables).toHaveLength(2);
    expect(spec.tables[1].heading).toContain('6-Ledger Red-Flag Convergence');
    expect(spec.bulletBlocks?.[0]?.items).toContain('21 OAuGF audit queries');

    const pdfBytes = await buildMdaScorecardBriefPdfBytes(briefInput);
    expect(String.fromCharCode(...pdfBytes.slice(0, 5))).toBe('%PDF-');

    const docxBytes = await buildMdaScorecardBriefDocxBytes(briefInput);
    expect(String.fromCharCode(docxBytes[0], docxBytes[1])).toBe('PK');
  });
});
