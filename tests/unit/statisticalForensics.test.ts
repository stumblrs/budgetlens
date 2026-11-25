import { describe, it, expect } from 'vitest';
import {
  chiSquarePValueDf8,
  classifyVirementCategory,
  computeBenfordFromAmounts,
  isBoilerplateOverheadTitle,
  isValidMdaName,
} from '../../src/utils/statisticalForensics';
import { readForensicsUrlState } from '../../src/utils/urlState';
import {
  buildGovspendForensicsDocxBytes,
  buildGovspendForensicsPdfBytes,
  buildGovspendForensicsSpec,
  buildStatisticalForensicsDocxBytes,
  buildStatisticalForensicsPdfBytes,
} from '../../src/utils/documentExporter';

describe('Statistical Forensics Engine (Benford MAD, Virements & Hygiene Guards)', () => {
  it('computes exact Nigrini MAD & Chi-Square for true Benford vs. uniform distributions', () => {
    // True Benford counts out of 1,000 samples (301, 176, 125, 97, 79, 67, 58, 51, 46)
    const benfordCounts = [301, 176, 125, 97, 79, 67, 58, 51, 46];
    const benfordAmounts: number[] = [];
    benfordCounts.forEach((cnt, idx) => {
      const digit = idx + 1;
      for (let i = 0; i < cnt; i++) {
        benfordAmounts.push(digit * 1_000_000 + i * 100);
      }
    });

    const good = computeBenfordFromAmounts(benfordAmounts, 2026);
    expect(good.validRecordCount).toBe(1000);
    expect(good.meanAbsoluteDeviation).toBeLessThanOrEqual(0.006);
    expect(good.conformityBand).toBe('CLOSE_CONFORMITY');
    expect(good.auditRating).toBe('HIGH_INTEGRITY');
    expect(good.chiSquarePValue).toBeGreaterThan(0.95);
    expect(good.benfordIntegrityScore).toBeGreaterThan(95);

    // Uniform 100 each across digits 1..9 (900 items) should trigger NON_CONFORMITY
    const uniformAmounts: number[] = [];
    for (let d = 1; d <= 9; d++) {
      for (let i = 0; i < 100; i++) {
        uniformAmounts.push(d * 5_000_000 + i);
      }
    }
    const bad = computeBenfordFromAmounts(uniformAmounts, 2026);
    expect(bad.validRecordCount).toBe(900);
    expect(bad.meanAbsoluteDeviation).toBeGreaterThan(0.015);
    expect(bad.conformityBand).toBe('NON_CONFORMITY');
    expect(bad.auditRating).toBe('HIGH_ANOMALY_RISK');
    expect(bad.chiSquarePValue).toBeLessThan(0.001);
  });

  it('enforces low-N INSUFFICIENT_SAMPLE guard with zero NaNs on Summary Act datasets', () => {
    const empty = computeBenfordFromAmounts([], 2000);
    expect(empty.conformityBand).toBe('INSUFFICIENT_SAMPLE');
    expect(empty.auditRating).toBe('INSUFFICIENT_SAMPLE');
    expect(empty.benfordIntegrityScore).toBe(0);
    expect(Number.isFinite(empty.meanAbsoluteDeviation)).toBe(true);
    expect(Number.isFinite(empty.chiSquareStat)).toBe(true);
    expect(Number.isFinite(empty.chiSquarePValue)).toBe(true);

    const lowSample = computeBenfordFromAmounts(
      Array.from({ length: 12 }, (_, idx) => (idx + 1) * 90_000_000),
      2001
    );
    expect(lowSample.validRecordCount).toBe(12);
    expect(lowSample.conformityBand).toBe('INSUFFICIENT_SAMPLE');
    expect(lowSample.auditRating).not.toBe('HIGH_ANOMALY_RISK');
    for (const row of lowSample.breakdown) {
      expect(Number.isFinite(row.actualPct)).toBe(true);
      expect(Number.isFinite(row.zScore)).toBe(true);
      expect(row.status).toBe('Normal');
    }
  });

  it('matches known Chi-Square df=8 critical probabilities', () => {
    expect(chiSquarePValueDf8(0)).toBe(1);
    expect(chiSquarePValueDf8(15.507313)).toBeCloseTo(0.05, 4);
    expect(chiSquarePValueDf8(20.090235)).toBeCloseTo(0.01, 4);
  });

  it('classifies virements, filters invalid MDA labels, and syncs ?fsub URL param', () => {
    expect(classifyVirementCategory('Service Wide Vote: Margin for Increase in Costs', 'OVERHEAD')).toBe(
      'SERVICE_WIDE_VOTE'
    );
    expect(classifyVirementCategory('Supplementary Virement Capital Release', 'CAPITAL')).toBe(
      'SUPPLEMENTARY_VIREMENT'
    );
    expect(classifyVirementCategory('National Contingency Reserve Allocation', 'CAPITAL')).toBe(
      'CONTINGENCY_RESERVE'
    );
    expect(classifyVirementCategory('Special Intervention Emergency Rehabilitation', 'CAPITAL')).toBe(
      'SPECIAL_EMERGENCY'
    );
    expect(classifyVirementCategory('Construction of Solar Borehole in Kano', 'CAPITAL')).toBeNull();

    expect(isValidMdaName('General Federal')).toBe(false);
    expect(isValidMdaName('KM267+400-KM372+842')).toBe(false);
    expect(isValidMdaName('10,250,000')).toBe(false);
    expect(isValidMdaName('Federal Ministry of Works')).toBe(true);

    expect(isBoilerplateOverheadTitle('OFFICE STATIONERIES / COMPUTER CONSUMABLES', 'CAPITAL')).toBe(true);
    expect(isBoilerplateOverheadTitle('LOCAL TRAVEL AND TRANSPORT: TRAINING', 'OVERHEAD')).toBe(true);
    expect(isBoilerplateOverheadTitle('CONSTRUCTION OF 50 SOLAR BOREHOLES IN KATSINA', 'CAPITAL')).toBe(false);

    expect(readForensicsUrlState('?tab=forensics&fsub=rings').fsub).toBe('rings');
    expect(readForensicsUrlState('?tab=forensics&fsub=unknown').fsub).toBe('benford');
  });

  it('builds valid %PDF- and OOXML PK binaries for Statistical Forensics Dossiers', async () => {
    const benford = computeBenfordFromAmounts(
      Array.from({ length: 120 }, (_, i) => ((i % 9) + 1) * 12_500_000),
      2026
    );
    const exportInput = {
      financialYear: 2026,
      activeSubTab: 'benford',
      benford,
      prematureAlerts: [
        {
          mdaName: 'Federal Ministry of Works',
          assetCategory: 'vehicles_mobility',
          assetCategoryLabel: 'Vehicles & Official Fleets',
          recentAllocationsCount: 3,
          totalSpentNaira: 900_000_000,
          totalSpentFormatted: '₦900.00 Million',
          yearsActive: [2024, 2025, 2026],
          minGapYears: 1,
          antiquityLifespanYears: 5,
          earliestAcquisitionYear: 2024,
          latestAcquisitionYear: 2026,
          activeInventoryTally: 9,
          wasteRisk: 'HIGH' as const,
          reason: 'Repeated fleet acquisition below 5-year threshold.',
          sampleRecords: [],
        },
      ],
      virements: {
        financialYear: 2026,
        virementRecordCount: 1,
        totalNaira: 250_000_000,
        totalNairaFormatted: '₦250.00 Million',
        categoryBreakdown: [
          { key: 'SERVICE_WIDE_VOTE' as const, label: 'Service-Wide & Margin Votes', count: 1, totalNaira: 250_000_000 },
        ],
        records: [
          {
            id: 'P-2026-0001',
            projectCode: 'ERGP100',
            projectName: 'Service Wide Vote Contingency',
            agency: 'Ministry of Finance',
            amount: 250_000_000,
            page: 12,
            financialYear: 2026,
            categoryKey: 'SERVICE_WIDE_VOTE' as const,
          },
        ],
      },
      duplicateRings: [
        {
          clusterId: 'RING-2026-TEST',
          normalizedTitle: 'SUPPLY OF DIAGNOSTIC SCANNERS',
          itemCount: 2,
          totalNaira: 300_000_000,
          totalNairaFormatted: '₦300.00 Million',
          mdasInvolved: ['Ministry of Health', 'Ministry of Interior'],
          isCrossMda: true,
          isBoilerplateOverhead: false,
          sampleRecords: [],
        },
      ],
      sourceFilename: '2026 Appropriation Bill Details.pdf',
      sha256: 'sha256:abcdef1234567890',
      permalink: 'https://budgetlens.ng/?tab=forensics&fsub=benford&year=2026',
    };

    const pdfBytes = await buildStatisticalForensicsPdfBytes(exportInput);
    expect(new TextDecoder('ascii').decode(pdfBytes.slice(0, 5))).toBe('%PDF-');

    const docxBytes = await buildStatisticalForensicsDocxBytes(exportInput);
    expect(docxBytes[0]).toBe(0x50);
    expect(docxBytes[1]).toBe(0x4b);
  });

  it('supports ?fsub=govspend URL state and builds %PDF- / OOXML PK GovSpend Forensics Dossiers', async () => {
    expect(readForensicsUrlState('?tab=forensics&fsub=govspend').fsub).toBe('govspend');

    const govInput = {
      headline: {
        totalVouchers: 467763,
        totalNaira: 47_531_629_923_484,
        december2019To2025Naira: 8_764_872_118_571,
        decemberRushRatio2019To2025: 2.75,
        nearThresholdVoucherCount: 34027,
        nearThresholdNaira: 1_040_480_000_000,
        rolling7DayClusterCount: 16996,
        benford1DMad: 0.03739,
        benford1DBand: 'NON_CONFORMITY',
        benford2DMad: 0.00387,
        benford2DBand: 'NON_CONFORMITY',
      },
      yearlyRush: [
        {
          financialYear: 2018,
          monthsCovered: 4,
          isPartialYear: true,
          totalNaira: 1_346_433_969_973,
          decemberNaira: 400_000_000_000,
          decemberSharePct: 29.7,
          decemberRushRatio: null,
        },
        {
          financialYear: 2023,
          monthsCovered: 12,
          isPartialYear: false,
          totalNaira: 8_288_038_420_023,
          decemberNaira: 2_000_000_000_000,
          decemberSharePct: 24.1,
          decemberRushRatio: 3.5,
        },
      ],
      tiers: [
        {
          tierLabel: '₦10M',
          voucherCount: 21135,
          totalNaira: 200_020_000_000,
          shareOfValidCountPct: 4.52,
        },
      ],
      topFlaggedMdas: [
        {
          organizationName: 'Sample High Volume MDA',
          validCount: 1200,
          totalNaira: 50_000_000_000,
          mad: 0.0421,
          conformityBand: 'NON_CONFORMITY',
          peakDigit: 9,
        },
      ],
    };

    const pdfBytes = await buildGovspendForensicsPdfBytes(govInput);
    expect(String.fromCharCode(...pdfBytes.slice(0, 5))).toBe('%PDF-');

    const docxBytes = await buildGovspendForensicsDocxBytes(govInput);
    expect(docxBytes[0]).toBe(0x50);
    expect(docxBytes[1]).toBe(0x4b);
  }, 15_000);

  it('builds 6-table %PDF- and OOXML PK dossiers when personal accounts, opaque vouchers & OAuGF cross-links are supplied', async () => {
    const enrichedInput = {
      headline: {
        totalVouchers: 467763,
        totalNaira: 47_531_629_923_484,
        december2019To2025Naira: 8_764_872_118_571,
        decemberRushRatio2019To2025: 2.75,
        nearThresholdVoucherCount: 34027,
        nearThresholdNaira: 1_040_480_000_000,
        rolling7DayClusterCount: 16996,
        benford1DMad: 0.03739,
        benford1DBand: 'NON_CONFORMITY',
        benford2DMad: 0.00387,
        benford2DBand: 'NON_CONFORMITY',
        personalStaffCount: 10851,
        personalStaffPaidNaira: 1_488_270_101_629,
        personalStaffBillionPlusCount: 235,
        discretionaryOpaqueVoucherCount: 33366,
        discretionaryOpaqueNaira: 2_439_480_309_528,
      },
      yearlyRush: [
        {
          financialYear: 2023,
          monthsCovered: 12,
          isPartialYear: false,
          totalNaira: 8_288_038_420_023,
          decemberNaira: 2_000_000_000_000,
          decemberSharePct: 24.1,
          decemberRushRatio: 3.5,
        },
      ],
      tiers: [
        {
          tierLabel: '₦10M',
          voucherCount: 21135,
          totalNaira: 200_020_000_000,
          shareOfValidCountPct: 4.52,
        },
      ],
      topFlaggedMdas: [
        {
          organizationName: 'OFFICE OF THE ACCOUNTANT-GENERAL OF THE FEDERATION',
          validCount: 2400,
          totalNaira: 310_000_000_000,
          mad: 0.0442,
          conformityBand: 'NON_CONFORMITY',
          peakDigit: 9,
          oaugfQueryCount: 462,
          convergenceFlagCount: 3,
        },
      ],
      personalAccountPayouts: {
        staffCount: 10851,
        staffPaidNaira: 1_488_270_101_629,
        staffBillionPlusCount: 235,
        unclassifiedCount: 4169,
        unclassifiedPaidNaira: 1_262_237_826_710,
        topPayees: [
          {
            beneficiaryName: 'SAMPLE INDIVIDUAL PAYEE',
            voucherCount: 28,
            totalPaidNaira: 2_450_000_000,
            payingMdaCount: 2,
            topMdaName: 'OFFICE OF THE ACCOUNTANT-GENERAL OF THE FEDERATION',
            purposeTag: 'CASH_ADVANCE_OR_IMPREST',
            oaugfQueryCount: 462,
          },
        ],
      },
      discretionaryOpaqueAudit: {
        totalFlaggedVouchers: 33366,
        totalFlaggedNaira: 2_439_480_309_528,
        categories: [
          {
            key: 'OPAQUE_BLANK_DESCRIPTION',
            label: 'Opaque / Blank Description (< 12 chars)',
            voucherCount: 12468,
            totalNaira: 1_407_290_000_000,
            topMdaName: 'NIGERIAN AIRFORCE',
            largestBeneficiary: 'TEST PAYEE',
            largestVoucherNaira: 45_000_000_000,
          },
        ],
      },
      topOpaqueVouchers: [
        {
          paymentDate: '2024-12-18',
          categoryLabel: 'Opaque / Blank Desc',
          organizationName: 'NIGERIAN AIRFORCE',
          beneficiaryName: 'TEST PAYEE',
          amountNaira: 45_000_000_000,
          description: '',
        },
      ],
      permalink: 'https://budgetlens.ng/?tab=forensics&fsub=govspend&year=2026',
    };

    const spec = buildGovspendForensicsSpec(enrichedInput);
    expect(spec.tables.length).toBe(6);
    expect(spec.kpis?.length).toBe(6);
    expect(spec.tables[3].heading).toContain('Personal & Staff Bank Account');
    expect(spec.tables[4].heading).toContain('Opaque, Blank-Description & Discretionary Cash Audit');
    expect(spec.tables[5].heading).toContain('Sample Vouchers');

    const pdfBytes = await buildGovspendForensicsPdfBytes(enrichedInput);
    expect(String.fromCharCode(...pdfBytes.slice(0, 5))).toBe('%PDF-');
    expect(pdfBytes.length).toBeGreaterThan(2000);

    const docxBytes = await buildGovspendForensicsDocxBytes(enrichedInput);
    expect(docxBytes[0]).toBe(0x50);
    expect(docxBytes[1]).toBe(0x4b);
    expect(docxBytes.length).toBeGreaterThan(2000);
  }, 15_000);

  it('supports payroll/commercial separation scope and rolling 7-day commercial clusters in GovSpend exports', async () => {
    const separatedInput = {
      headline: {
        totalVouchers: 467763,
        totalNaira: 47_531_629_923_484,
        december2019To2025Naira: 8_764_872_118_571,
        decemberRushRatio2019To2025: 2.75,
        nearThresholdVoucherCount: 34027,
        nearThresholdNaira: 1_040_480_000_000,
        rolling7DayClusterCount: 16996,
        commercialRolling7DayClusterCount: 12100,
        commercialRolling7DayClusterNaira: 4_200_000_000_000,
        payrollRolling7DayClusterCount: 4896,
        payrollStatutoryVoucherCount: 38200,
        exemptedShortPayrollCount: 410,
        benford1DMad: 0.03739,
        benford1DBand: 'NON_CONFORMITY',
        benford2DMad: 0.00387,
        benford2DBand: 'NON_CONFORMITY',
      },
      payrollFilterMode: 'COMMERCIAL_AND_DISCRETIONARY_ONLY' as const,
      yearlyRush: [
        {
          financialYear: 2024,
          monthsCovered: 12,
          isPartialYear: false,
          totalNaira: 9_100_000_000_000,
          decemberNaira: 2_100_000_000_000,
          decemberSharePct: 23.1,
          decemberRushRatio: 3.3,
        },
      ],
      tiers: [
        {
          tierLabel: '₦10M',
          voucherCount: 21135,
          totalNaira: 200_020_000_000,
          shareOfValidCountPct: 4.52,
        },
      ],
      topFlaggedMdas: [],
      topCommercialRollingClusters: [
        {
          startDate: '2024-05-10',
          endDate: '2024-05-14',
          organizationName: 'FEDERAL MINISTRY OF WORKS',
          beneficiaryName: 'VISIBLE CONSTRUCTION LIMITED',
          voucherCount: 4,
          totalNaira: 38_500_000_000,
          sampleDescription: 'Split commercial contract milestone',
          isPayrollOrStatutory: false,
        },
      ],
    };

    const spec = buildGovspendForensicsSpec(separatedInput);
    expect(spec.metadata?.some((m) => m.label === 'Active Disbursement Scope' && m.value === 'Commercial & Discretionary Only')).toBe(true);
    expect(spec.narrative).toContain('38,200 IPPIS payroll');
    expect(spec.tables.some((t) => t.heading.includes('Top Rolling 7-Day Split-Payment Clusters'))).toBe(true);

    const pdfBytes = await buildGovspendForensicsPdfBytes(separatedInput);
    expect(String.fromCharCode(...pdfBytes.slice(0, 5))).toBe('%PDF-');

    const docxBytes = await buildGovspendForensicsDocxBytes(separatedInput);
    expect(docxBytes[0]).toBe(0x50);
    expect(docxBytes[1]).toBe(0x4b);
  }, 15_000);
});
