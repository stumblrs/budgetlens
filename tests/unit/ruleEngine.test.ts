import { describe, it, expect } from 'vitest';
import { applyRules, getRulesSummary, RawProject } from '../../src/utils/ruleEngine';

const makeProject = (overrides: Partial<RawProject> = {}): RawProject => ({
  id: 'P-2026-00001',
  projectCode: 'ERGP20260001',
  projectName: 'Procurement of operational items',
  financialYear: 2026,
  amount: 100_000_000,
  projectType: 'CAPITAL',
  page: 42,
  sector: 'Infrastructure',
  agency: 'Federal Ministry of Works',
  ...overrides,
});

describe('ruleEngine v2.0', () => {
  it('exposes the full catalog of versioned forensic rules', () => {
    const summary = getRulesSummary();
    expect(summary.length).toBeGreaterThanOrEqual(10);
    expect(summary.some((r) => r.id === 'MDA_MANDATE_MISMATCH')).toBe(true);
    expect(summary.some((r) => r.id === 'VEHICLE_UNIT_COST_ANOMALY')).toBe(true);
  });

  it('excludes MDA summary rollup codes (e.g. 0215001001) to avoid double-counting', () => {
    const rollup = makeProject({
      projectCode: '0215001001',
      projectName: 'Purchase of Luxury Prado SUVs Nationwide Multiple Lots',
      amount: 10_000_000_000,
    });
    expect(applyRules([rollup])).toHaveLength(0);
  });

  it('ignores allocations below the NGN 25M materiality floor', () => {
    const small = makeProject({
      projectName: 'Purchase of Solar Street Lights for Rural Clinic',
      amount: 24_999_999,
      agency: 'Federal Ministry of Agriculture',
    });
    expect(applyRules([small])).toHaveLength(0);
  });

  it('flags non-power/works MDA mandate mismatch insertions >= NGN 25M', () => {
    const mismatch = makeProject({
      projectCode: 'ERGP991122',
      projectName: 'Installation of solar streetlight poles and makeup kits in rural wards',
      amount: 120_000_000,
      agency: 'Federal Ministry of Agriculture and Food Security',
    });
    const hits = applyRules([mismatch]);
    expect(hits.some((h) => h.ruleId === 'MDA_MANDATE_MISMATCH' && h.severity === 'high')).toBe(true);
  });

  it('respects security and hospital domain guards for operational vehicles and renovations', () => {
    const armyFleet = makeProject({
      projectCode: 'ERGP112233',
      projectName: 'Purchase of Operational Utility Hilux Vehicles for Patrol',
      amount: 800_000_000,
      agency: 'Nigerian Army HQ',
    });
    const hospitalRehab = makeProject({
      projectCode: 'ERGP445566',
      projectName: 'Rehabilitation and Renovation of Tertiary Teaching Hospital Wards',
      amount: 950_000_000,
      agency: 'University College Hospital Ibadan',
    });

    const armyHits = applyRules([armyFleet]);
    expect(armyHits.some((h) => h.ruleId === 'VEHICLE_UNIT_COST_ANOMALY' || h.ruleId === 'HIGH_VEHICLE_PROCUREMENT')).toBe(false);

    const hospHits = applyRules([hospitalRehab]);
    expect(hospHits.some((h) => h.ruleId === 'HIGH_RENOVATION_COST')).toBe(false);
  });

  it('computes implied unit cost when quantities appear on non-military vehicle purchases', () => {
    const vipFleet = makeProject({
      projectCode: 'ERGP778899',
      projectName: 'Procurement of 10 Nos Land Cruiser Prado SUVs for Secretariat',
      amount: 1_500_000_000,
      agency: 'Ministry of Interior Civil Secretariat',
    });
    const hits = applyRules([vipFleet]);
    const unitHit = hits.find((h) => h.ruleId === 'VEHICLE_UNIT_COST_ANOMALY');
    expect(unitHit).toBeDefined();
    expect(unitHit?.reason).toContain('10 unit(s)');
  });
});
