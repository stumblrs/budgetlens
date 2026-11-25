import { describe, it, expect } from 'vitest';
import { detectDuplicates, getDuplicateStats } from '../../src/utils/duplicateDetector';

describe('duplicateDetector', () => {
  it('excludes MDA rollup codes and COA 21/22 recurrent header lines', () => {
    const clusters = detectDuplicates([
      {
        id: '1',
        projectCode: '0215001001',
        projectName: 'Personnel Cost Allocation Summary for Ministry Headquarters',
        financialYear: 2025,
        amount: 5_000_000_000,
        page: 1,
        sector: 'Administration',
      },
      {
        id: '2',
        projectCode: '21010101',
        projectName: 'Personnel Cost Allocation Summary for Ministry Headquarters',
        financialYear: 2025,
        amount: 5_000_000_000,
        page: 2,
        sector: 'Administration',
      },
    ]);
    expect(clusters).toHaveLength(0);
  });

  it('clusters exact verbatim repetitions across agencies as Cross-MDA Duplicate', () => {
    const clusters = detectDuplicates([
      {
        id: 'A1',
        projectCode: 'ERGP1001',
        projectName: 'Construction of Rural Feeder Road Network in Zaria Corridor',
        financialYear: 2024,
        amount: 300_000_000,
        page: 12,
        sector: 'Infrastructure',
        agency: 'Ministry of Works',
        state: 'Kaduna',
      },
      {
        id: 'A2',
        projectCode: 'ERGP1002',
        projectName: 'Construction of Rural Feeder Road Network in Zaria Corridor',
        financialYear: 2024,
        amount: 450_000_000,
        page: 88,
        sector: 'Infrastructure',
        agency: 'Border Communities Development Agency',
        state: 'Kaduna',
      },
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].matchType).toBe('Exact Wording');
    expect(clusters[0].patternType).toBe('Cross-MDA Duplicate');
    expect(clusters[0].count).toBe(2);
    expect(clusters[0].totalAmount).toBe(750_000_000);
    expect(clusters[0].distinctAgencies).toBe(2);
  });

  it('detects disguised synonym rewordings and computes aggregate stats', () => {
    const clusters = detectDuplicates([
      {
        id: 'B1',
        projectCode: 'ERGP2001',
        projectName: 'Procurement of Solar Streetlights Infrastructure Corridor in Kano State',
        financialYear: 2025,
        amount: 200_000_000,
        page: 19,
        sector: 'Power',
        agency: 'Rural Electrification Agency',
        state: 'Kano',
      },
      {
        id: 'B2',
        projectCode: 'ERGP2002',
        projectName: 'Purchase of Solar Streetlights Infrastructure Corridor in Kano State',
        financialYear: 2025,
        amount: 250_000_000,
        page: 204,
        sector: 'Power',
        agency: 'Energy Commission of Nigeria',
        state: 'Kano',
      },
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].matchType).toBe('Disguised / Reworded');
    expect(clusters[0].patternType).toBe('Disguised Rewording');

    const stats = getDuplicateStats(clusters);
    expect(stats).toEqual({
      clusterCount: 1,
      totalProjects: 2,
      totalAmount: 450_000_000,
    });
  });
});
