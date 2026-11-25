import { describe, it, expect } from 'vitest';
import {
  computePaidOnPaperStatus,
  getLifecycleShardBucket,
  isUniqueProjectCode,
  lookupScrutinyBadge,
  matchBirMdaEntry,
  type BirYearSummary,
  type ProjectLifecycleIndex,
} from '../../src/utils/projectLifecycle';

describe('Project Lifecycle 5-Stage Utility & Paid-on-Paper Priority (P3-S2)', () => {
  it('computes FNV-1a 64-bucket shard hashes matching Python builder vectors', () => {
    expect(getLifecycleShardBucket('P-2025-00001')).toBe('27');
    expect(getLifecycleShardBucket('  p-2025-00001 ')).toBe('27');
    expect(getLifecycleShardBucket('ERGP22101448')).toBe('09');
    expect(getLifecycleShardBucket('DIFF-2023-00100')).toBe('46');
    expect(getLifecycleShardBucket('ERGP21250280')).toBe('27');
    expect(getLifecycleShardBucket('MOBAN09501181')).toBe('05');
  });

  it('accepts unique ERGP/MDA project codes and rejects bare numeric IPSAS codes', () => {
    expect(isUniqueProjectCode('ergp 22101448')).toBe('ERGP22101448');
    expect(isUniqueProjectCode('MOBAN09501181')).toBe('MOBAN09501181');
    expect(isUniqueProjectCode('22020305')).toBe('');
    expect(isUniqueProjectCode('111001002')).toBe('');
    expect(isUniqueProjectCode('')).toBe('');
  });

  it('classifies Paid-on-Paper priority accurately without counting planning or unpaid awards', () => {
    const nocPaid = computePaidOnPaperStatus(
      { awardedContractCount: 1, totalNocopoDisbursedNaira: 120_000_000 },
      { directVoucherCount: 0, directPaidNaira: 0, vendorMdaVoucherCount: 0, vendorMdaPaidNaira: 0 }
    );
    expect(nocPaid.paidOnPaperPriority).toBe(true);
    expect(nocPaid.paidOnPaperTier).toBe('DIRECT_PROJECT_PAID');
    expect(nocPaid.verifiedDisbursedNaira).toBe(120_000_000);

    const directGovPaid = computePaidOnPaperStatus(
      { awardedContractCount: 0, totalNocopoDisbursedNaira: 0 },
      { directVoucherCount: 2, directPaidNaira: 45_000_000, vendorMdaVoucherCount: 0, vendorMdaPaidNaira: 0 }
    );
    expect(directGovPaid.paidOnPaperPriority).toBe(true);
    expect(directGovPaid.paidOnPaperTier).toBe('DIRECT_PROJECT_PAID');
    expect(directGovPaid.verifiedDisbursedNaira).toBe(45_000_000);

    const vendorMdaPaid = computePaidOnPaperStatus(
      { awardedContractCount: 1, totalNocopoDisbursedNaira: 0 },
      { directVoucherCount: 0, directPaidNaira: 0, vendorMdaVoucherCount: 3, vendorMdaPaidNaira: 90_000_000 }
    );
    expect(vendorMdaPaid.paidOnPaperPriority).toBe(true);
    expect(vendorMdaPaid.paidOnPaperTier).toBe('VENDOR_MDA_PAID');
    expect(vendorMdaPaid.verifiedDisbursedNaira).toBe(0);

    const planningOnlyWithVendorPayout = computePaidOnPaperStatus(
      { awardedContractCount: 0, totalNocopoDisbursedNaira: 0 },
      { directVoucherCount: 0, directPaidNaira: 0, vendorMdaVoucherCount: 4, vendorMdaPaidNaira: 500_000_000 }
    );
    expect(planningOnlyWithVendorPayout.paidOnPaperPriority).toBe(false);
    expect(planningOnlyWithVendorPayout.paidOnPaperTier).toBe('NONE');

    const unpaidAward = computePaidOnPaperStatus(
      { awardedContractCount: 1, totalNocopoDisbursedNaira: 0 },
      { directVoucherCount: 0, directPaidNaira: 0, vendorMdaVoucherCount: 0, vendorMdaPaidNaira: 0 }
    );
    expect(unpaidAward.paidOnPaperPriority).toBe(false);
  });

  it('resolves BIR MDA release percentages and preserves explicit non-zero missing states', () => {
    const missingYear = matchBirMdaEntry(null, 'Federal Ministry of Works');
    expect(missingYear.status).toBe('NO_BIR_REPORT');
    expect(missingYear.releasePct).toBeNull();

    const macroOnlyYear: BirYearSummary = {
      financialYear: 2025,
      quarterCovered: 'Q2',
      reportPeriodLabel: 'Q2 Half-Year YTD',
      reportTitle: 'FY 2025 BIR',
      granularity: 'MACRO_FISCAL_PERFORMANCE',
      overallReleasePct: 60.49,
      overallUtilizationPct: null,
      mdaCount: 0,
      mdaBreakdown: [],
    };
    const macroHit = matchBirMdaEntry(macroOnlyYear, 'Federal Ministry of Works');
    expect(macroHit.status).toBe('NO_MDA_BREAKDOWN');
    expect(macroHit.releasePct).toBeNull();
    expect(macroHit.nationalOverallReleasePct).toBe(60.49);

    const yearWithMdas: BirYearSummary = {
      financialYear: 2024,
      quarterCovered: 'Q4',
      reportPeriodLabel: 'Q4 Full-Year',
      reportTitle: 'FY 2024 BIR',
      granularity: 'COMBINED_MACRO_AND_MDA',
      overallReleasePct: 98.4,
      overallUtilizationPct: 88.53,
      mdaCount: 1,
      mdaBreakdown: [
        {
          mdaName: 'Federal Ministry of Works',
          normMda: 'FEDERAL MINISTRY OF WORKS',
          coreKey: 'WORKS',
          families: ['WORKS'],
          appropriatedNaira: 1000,
          releasedNaira: 950,
          utilizedNaira: 850,
          releasePct: 95.0,
          utilizationPct: 89.47,
          overspendVirement: false,
        },
      ],
    };
    const exactHit = matchBirMdaEntry(yearWithMdas, 'FEDERAL MINISTRY OF WORKS - HQTRS');
    expect(exactHit.status).toBe('MATCHED_MDA');
    expect(exactHit.matchType).toBe('EXACT_MDA');
    expect(exactHit.releasePct).toBe(95.0);

    const parentHit = matchBirMdaEntry(yearWithMdas, 'FEDERAL ROAD MAINTENANCE AGENCY (FERMA)');
    expect(parentHit.status).toBe('MATCHED_MDA');
    expect(parentHit.matchType).toBe('PARENT_MINISTRY_MDA');
    expect(parentHit.releasePct).toBe(95.0);
  });

  it('looks up scrutiny badges cleanly by record id or unique project code', () => {
    const mockIdx = {
      scrutinyBadges: {
        'P-2024-00001': {
          paidOnPaperPriority: true,
          paidOnPaperTier: 'DIRECT_PROJECT_PAID',
          nocopoStatus: 'AWARDED_AND_PAID',
          awardedNaira: 500_000_000,
          nocopoDisbursedNaira: 320_000_000,
          directGovspendNaira: 0,
          vendorMdaPaidNaira: 0,
          contractorName: 'Alpha Roadworks Ltd',
          billDiffStatus: 'NASS_INSERTION',
          billDeltaPct: 100,
          birStatus: 'MATCHED_MDA',
          birReleasePct: 95,
        },
      },
    } as unknown as ProjectLifecycleIndex;

    const hit = lookupScrutinyBadge(mockIdx, { id: 'p-2024-00001', projectCode: '22020305' });
    expect(hit?.paidOnPaperPriority).toBe(true);
    expect(hit?.contractorName).toBe('Alpha Roadworks Ltd');

    const miss = lookupScrutinyBadge(mockIdx, { id: 'P-9999', projectCode: '22020305' });
    expect(miss).toBeNull();
  });
});
