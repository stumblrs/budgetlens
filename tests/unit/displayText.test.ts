import { describe, expect, it } from 'vitest';
import {
  cleanEntityDisplayName,
  getCoverageCaveatMeta,
  repairMojibake,
} from '../../src/utils/displayText';

describe('displayText entity cleanup & coverage caveat helpers', () => {
  it('repairs UTF-8/Windows-1252 mojibake sequences, source typos, and dangling punctuation', () => {
    expect(repairMojibake('HADEJIA-JAMA\u00c4\u00bbARE RBDA')).toBe("HADEJIA-JAMA'ARE RBDA");
    expect(cleanEntityDisplayName('HADEJIA-JAMAÄ»ARE RBDA')).toBe("HADEJIA-JAMA'ARE RBDA");
    expect(cleanEntityDisplayName('HADEJIA-JAMA\u00c3\u0084\u00c2\u00bbARE RBDA')).toBe(
      "HADEJIA-JAMA'ARE RBDA"
    );
    expect(
      cleanEntityDisplayName('FEDERAL MINISTRY OF AGRICULTURE AND FOOD SECURITY -')
    ).toBe('FEDERAL MINISTRY OF AGRICULTURE AND FOOD SECURITY');
    expect(cleanEntityDisplayName('FEDERAL MINISTRY OF WORKS  - , ')).toBe(
      'FEDERAL MINISTRY OF WORKS'
    );
    expect(cleanEntityDisplayName('FEDERAL UNIVERSITYOF GASHUA')).toBe(
      'FEDERAL UNIVERSITY OF GASHUA'
    );
    expect(cleanEntityDisplayName('National Emergency Managemant Agency')).toBe(
      'National Emergency Management Agency'
    );
    expect(cleanEntityDisplayName('DEFENCE HEADQURTERS')).toBe('DEFENCE HEADQUARTERS');
    expect(cleanEntityDisplayName('MINSITRY OF ENERGY')).toBe('MINISTRY OF ENERGY');
    expect(cleanEntityDisplayName(null)).toBe('');
    expect(cleanEntityDisplayName(undefined)).toBe('');
    expect(cleanEntityDisplayName('   ')).toBe('');
  });

  it('identifies SUMMARY_ACT_ONLY and PARTIAL_SCHEDULE fiscal years cleanly', () => {
    for (const yr of [2000, 2001, 2002, 2003, 2005, 2007]) {
      const meta = getCoverageCaveatMeta(yr);
      expect(meta.tier).toBe('SUMMARY_ACT_ONLY');
      expect(meta.label).toBe('Summary Act Only');
      expect(meta.hasCaveat).toBe(true);
    }

    const fy2011 = getCoverageCaveatMeta(2011, {
      coverage_tier: 'PARTIAL_SCHEDULE',
      extracted_ratio_pct: 23.9,
      project_count: 1911,
    });
    expect(fy2011.tier).toBe('PARTIAL_SCHEDULE');
    expect(fy2011.label).toContain('23.9%');
    expect(fy2011.hasCaveat).toBe(true);
    expect(fy2011.detail).toContain('1,911');

    const fy2015 = getCoverageCaveatMeta(2015);
    expect(fy2015.tier).toBe('PARTIAL_SCHEDULE');
    expect(fy2015.label).toContain('29.3%');
    expect(fy2015.hasCaveat).toBe(true);
  });

  it('surfaces partial-year BIR, Treasury boundary, and >100% rollup breakdowns', () => {
    const fy2014 = getCoverageCaveatMeta(2014);
    expect(fy2014.birPartialNote).toContain('Q2');
    expect(fy2014.hasCaveat).toBe(true);

    const fy2018 = getCoverageCaveatMeta(2018);
    expect(fy2018.treasuryPartialNote).toContain('partial boundary calendar year');
    expect(fy2018.hasCaveat).toBe(true);

    const fy2026 = getCoverageCaveatMeta(2026);
    expect(fy2026.treasuryPartialNote).toContain('partial calendar year');
    expect(fy2026.hasCaveat).toBe(true);

    const fy1999 = getCoverageCaveatMeta(1999, {
      coverage_tier: 'FULL_SCHEDULE',
      extracted_ratio_pct: 194.2,
      over_100_pct_flag: true,
      extracted_breakdown_note:
        'includes Supplementary Appropriation Act alongside main Act; non-rollup line items equal 72.8%.',
    });
    expect(fy1999.tier).toBe('FULL_SCHEDULE');
    expect(fy1999.hasCaveat).toBe(true);
    expect(fy1999.detail).toContain('Supplementary Appropriation Act');

    const fy2025 = getCoverageCaveatMeta(2025, {
      coverage_tier: 'FULL_SCHEDULE',
      extracted_ratio_pct: 112.1,
      over_100_pct_flag: true,
      extracted_breakdown_note:
        'enacted FY 2025 signed total (₦54.99T) exceeded the ₦46.02T baseline in OFFICIAL_MACRO_TOTALS.',
    });
    expect(fy2025.tier).toBe('FULL_SCHEDULE');
    expect(fy2025.hasCaveat).toBe(true);
    expect(fy2025.detail).toContain('₦54.99T');

    const fy2024 = getCoverageCaveatMeta(2024, {
      coverage_tier: 'FULL_SCHEDULE',
      extracted_ratio_pct: 88.0,
      project_count: 43203,
    });
    expect(fy2024.tier).toBe('FULL_SCHEDULE');
    expect(fy2024.label).toBe('Full Schedule');
    expect(fy2024.hasCaveat).toBe(false);
    expect(fy2024.detail).toContain('43,203');
  });
});
