import { describe, it, expect } from 'vitest';
import { runForensicScan } from '../../src/services/forensicRunner';
import { applyRules, buildCompoundFlaggedProjects, getRulesSummary } from '../../src/utils/ruleEngine';
import { detectDuplicates } from '../../src/utils/duplicateDetector';
import type { CrossLedgerContextWire } from '../../src/utils/evidenceEngineV3';

describe('forensicRunner & Rule Engine v3.0 (EE-CP-2)', () => {
  it('returns empty collections immediately for empty project lists', async () => {
    const res = await runForensicScan([], 2026);
    expect(res.evidenceItems).toEqual([]);
    expect(res.compoundProjects).toEqual([]);
    expect(res.duplicateClusters).toEqual([]);
  });

  it('exposes 22 total rules in v3.0 (16 text/domain + 6 cross-ledger)', () => {
    const allRules = getRulesSummary(true);
    const textOnly = getRulesSummary(false);
    expect(allRules.length).toBe(22);
    expect(textOnly.length).toBe(16);
  });

  it('matches synchronous applyRules and detectDuplicates output via inline fallback in test runtime', async () => {
    const projects = [
      {
        id: '1',
        projectCode: 'ERGP501',
        projectName: 'Procurement of 5 Nos Prado SUVs for Official Secretariat Operations',
        financialYear: 2025,
        amount: 600_000_000,
        projectType: 'CAPITAL',
        page: 14,
        sector: 'Administration',
        agency: 'Ministry of Special Duties',
      },
      {
        id: '2',
        projectCode: 'ERGP502',
        projectName: 'Construction of Rural Electrification Feeder Network in Sokoto South',
        financialYear: 2025,
        amount: 320_000_000,
        projectType: 'CAPITAL',
        page: 91,
        sector: 'Power',
        agency: 'Rural Electrification Agency',
        state: 'Sokoto',
      },
      {
        id: '3',
        projectCode: 'ERGP503',
        projectName: 'Construction of Rural Electrification Feeder Network in Sokoto South',
        financialYear: 2025,
        amount: 320_000_000,
        projectType: 'CAPITAL',
        page: 108,
        sector: 'Power',
        agency: 'Ministry of Power',
        state: 'Sokoto',
      },
    ];

    const res = await runForensicScan(projects, 2025);
    expect(res.evidenceItems).toEqual(applyRules(projects));
    expect(res.compoundProjects).toEqual(buildCompoundFlaggedProjects(applyRules(projects)));
    expect(res.duplicateClusters).toEqual(detectDuplicates(projects));
  });

  it('evaluates all 6 cross-ledger forensic rules and groups compound multi-flag projects accurately', async () => {
    const mockContext: CrossLedgerContextWire = {
      paidOnPaperCodes: ['ERGP12345678'],
      billInsertionCodes: ['ERGP12345678'],
      zombieLineageCodes: ['ERGP12345678'],
      mdaProfilesByKey: {
        'AGRICULTURE AND RURAL DEVELOPMENT': {
          n: 'FEDERAL MINISTRY OF AGRICULTURE AND RURAL DEVELOPMENT',
          g: 'F',
          s: 38,
          oi: 42,
          or: 3,
          oa: 18_500_000_000,
          po: 1,
          cf: ['LOW_INTEGRITY_GRADE', 'HIGH_OAUGF_NEGLIGENCE', 'OPAQUE_OR_STAFF_PAYOUTS'],
          ra: ['hilux_pickups', 'solar_systems'],
        },
      },
    };

    const projects = [
      {
        id: 'rec-1',
        projectCode: 'ERGP12345678',
        projectName: 'Provision of Solar Street Lights and 4 Nos Hilux Vehicles in Selected Locations',
        financialYear: 2025,
        amount: 650_000_000,
        projectType: 'CAPITAL',
        page: 88,
        sector: 'Agriculture',
        agency: 'Federal Ministry of Agriculture and Rural Development - HQTRS',
      },
    ];

    const res = await runForensicScan(projects, 2025, undefined, mockContext);
    const triggeredIds = res.evidenceItems.map((i) => i.ruleId);

    // Domain rules triggered
    expect(triggeredIds).toContain('MDA_MANDATE_MISMATCH');
    expect(triggeredIds).toContain('VAGUE_BLANK_CHECK');
    expect(triggeredIds).toContain('VEHICLE_UNIT_COST_ANOMALY');
    expect(triggeredIds).toContain('SOLAR_STREET_LIGHTS');

    // All 6 Cross-ledger rules triggered on this single high-risk compound item
    expect(triggeredIds).toContain('LEGISLATIVE_INSERTION_ANOMALY');
    expect(triggeredIds).toContain('PAID_ON_PAPER_HIGH_RISK');
    expect(triggeredIds).toContain('ZOMBIE_RECURRING_LINEAGE');
    expect(triggeredIds).toContain('OAUGF_INDICTED_MDA_RISKY_SPEND');
    expect(triggeredIds).toContain('PERSONAL_OR_OPAQUE_PAYOUT_MDA_RISK');
    expect(triggeredIds).toContain('REPEAT_ASSET_LIFESPAN_VIOLATION');

    // Deduplicated into exactly 1 CompoundFlaggedProject with compoundRiskScore === 100
    expect(res.compoundProjects.length).toBe(1);
    const cp = res.compoundProjects[0];
    expect(cp.ruleCount).toBeGreaterThanOrEqual(10);
    expect(cp.crossLedgerRuleCount).toBe(6);
    expect(cp.compoundRiskScore).toBe(100);
    expect(cp.crossLedgerBadges.paidOnPaper).toBe(true);
    expect(cp.crossLedgerBadges.billInsertedOrInflated).toBe(true);
    expect(cp.crossLedgerBadges.zombieRecurringLineage).toBe(true);
    expect(cp.crossLedgerBadges.mdaOaugfIssuesCount).toBe(42);
    expect(cp.crossLedgerBadges.mdaIntegrityGrade).toBe('F');
    expect(cp.crossLedgerBadges.mdaPersonalOrOpaquePayoutFlag).toBe(true);
  });

  it('rejects cleanly with AbortError when pre-aborted via AbortSignal', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runForensicScan(
        [
          {
            id: '1',
            projectCode: 'ERGP1',
            projectName: 'Sample Project',
            financialYear: 2026,
            amount: 50_000_000,
            projectType: 'CAPITAL',
            page: 1,
            sector: 'Infrastructure',
          },
        ],
        2026,
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
