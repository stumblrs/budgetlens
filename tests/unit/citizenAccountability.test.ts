import { describe, expect, it } from 'vitest';
import type { BudgetRecord } from '../../src/services/budgetDatabaseEngine';
import {
  buildCitizenFiscalVerdicts,
  buildCitizenTaxReceipt,
  buildLocalAccountabilitySummary,
  computeAnnualNigeriaPaye,
  searchNeighborhoodProjects,
} from '../../src/utils/citizenAccountability';
import type { CompoundFlaggedProject } from '../../src/utils/ruleEngine';
import type { OaugfAuditIndexPayload } from '../../src/utils/mdaScorecard';
import {
  buildCitizenTaxReceiptDocxBytes,
  buildCitizenTaxReceiptPdfBytes,
  buildNeighborhoodCheckSheetDocxBytes,
  buildNeighborhoodCheckSheetPdfBytes,
} from '../../src/utils/documentExporter';

function makeRec(id: string, code: string, name: string, state: string, amount: number): BudgetRecord {
  return {
    recordIdentity: {
      id,
      financialYear: 2026,
      projectCode: code,
      verbatimProjectName: name,
      amountNaira: amount,
      amountFormatted: `₦${amount.toLocaleString()}`,
      spendingType: 'CAPITAL',
    },
    sourceProvenance: {
      documentId: 'doc-2026',
      sourceFilename: '2026.pdf',
      pdfPage: 12,
      sha256Hash: 'abc',
    },
    geographicTaxonomy: {
      jurisdictionLevel: 'STATE',
      geoPoliticalZone: 'North West',
      state,
      lga: 'Tarauni',
    },
    mdaGovernanceTaxonomy: {
      mdaCode: '0234',
      mdaName: 'MINISTRY OF WATER RESOURCES',
      sector: 'Water',
    },
    multiYearLineage: {
      lineageId: null,
      yearsAppeared: [2026],
      cumulativeSpendNaira: amount,
      cumulativeSpendFormatted: `₦${amount.toLocaleString()}`,
    },
    forensicEvidenceFlags: [],
    humanScaleEquivalents: {
      teacherSalaries: '10',
      solarBoreholes: '2',
      primaryHealthCentres: '1',
    },
  };
}

describe('Citizen Accountability Hub (Tax Receipt, Neighborhood Lookup & Exports)', () => {
  it('computes progressive Nigeria PITA PAYE and itemized federal tax receipt', () => {
    expect(computeAnnualNigeriaPaye(840_000)).toBe(0);
    expect(computeAnnualNigeriaPaye(2_160_000)).toBeGreaterThan(100_000);

    const receipt = buildCitizenTaxReceipt({
      financialYear: 2026,
      monthlyIncomeNaira: 450_000,
      macroCredibility: null,
    });
    expect(receipt.estimatedTotalAnnualTaxNaira).toBe(
      receipt.estimatedAnnualPayeNaira + receipt.estimatedAnnualVatNaira
    );
    expect(receipt.slices).toHaveLength(5);
    const totalShare = receipt.slices.reduce((s, x) => s + x.sharePct, 0);
    expect(totalShare).toBeGreaterThan(99);
    expect(totalShare).toBeLessThan(101);
  });

  it('pins Paid-on-Paper neighborhood projects first and produces valid PDF/DOCX exports', async () => {
    const recs = [
      makeRec('R1', 'ERGP111', 'Solar Borehole in Tarauni Kano', 'Kano', 50_000_000),
      makeRec('R2', 'ERGP222', 'Primary Health Clinic in Tarauni Kano', 'Kano', 120_000_000),
    ];
    const hits = searchNeighborhoodProjects({
      query: 'Tarauni',
      stateFilter: 'Kano',
      records: recs,
      lifecycleIndex: null,
    });
    expect(hits).toHaveLength(2);
    expect(hits[0].amountNaira).toBe(120_000_000);

    const verdicts = buildCitizenFiscalVerdicts({
      financialYear: 2026,
      macroCredibility: null,
      oaugfIndex: null,
      lifecycleIndex: null,
    });
    expect(verdicts).toHaveLength(4);

    const receipt = buildCitizenTaxReceipt({ financialYear: 2026, monthlyIncomeNaira: 180_000 });
    const rPdf = await buildCitizenTaxReceiptPdfBytes(receipt);
    const rDocx = await buildCitizenTaxReceiptDocxBytes(receipt);
    expect(new TextDecoder().decode(rPdf.slice(0, 5))).toBe('%PDF-');
    expect(new TextDecoder().decode(rDocx.slice(0, 2))).toBe('PK');

    const nPdf = await buildNeighborhoodCheckSheetPdfBytes({
      financialYear: 2026,
      areaQuery: 'Tarauni',
      stateFilter: 'Kano',
      items: hits,
    });
    const nDocx = await buildNeighborhoodCheckSheetDocxBytes({
      financialYear: 2026,
      areaQuery: 'Tarauni',
      stateFilter: 'Kano',
      items: hits,
    });
    expect(new TextDecoder().decode(nPdf.slice(0, 5))).toBe('%PDF-');
    expect(new TextDecoder().decode(nDocx.slice(0, 2))).toBe('PK');
  });

  it('enriches neighborhood hits with Evidence Engine v3.0 compound risk, Bill->Act insertions, and OAuGF MDA queries', () => {
    const recs = [
      makeRec('R1', 'ERGP111', 'Solar Borehole in Tarauni Kano', 'Kano', 50_000_000),
      makeRec('R2', 'ERGP222', 'Primary Health Clinic in Tarauni Kano', 'Kano', 120_000_000),
    ];
    const mockCompound: CompoundFlaggedProject[] = [
      {
        projectKey: '2026:ERGP222:12:120000000',
        id: 'R2',
        projectCode: 'ERGP222',
        projectName: 'Primary Health Clinic in Tarauni Kano',
        agency: 'MINISTRY OF WATER RESOURCES',
        sector: 'Water',
        financialYear: 2026,
        amount: 120_000_000,
        page: 12,
        highestSeverity: 'high',
        compoundRiskScore: 72,
        ruleCount: 3,
        crossLedgerRuleCount: 2,
        triggeredRules: [],
        crossLedgerBadges: {
          paidOnPaper: true,
          billInsertedOrInflated: true,
          zombieRecurringLineage: false,
          mdaOaugfIssuesCount: 49,
          mdaOaugfRepeatCount: 1,
          mdaOaugfAmountNaira: 2_000_000_000,
          mdaIntegrityGrade: 'D',
          mdaCompositeScore: 49.6,
          mdaPersonalOrOpaquePayoutFlag: false,
          mdaConvergenceFlags: [],
          mdaRepeatAssetCategories: [],
        },
      },
    ];
    const mockOaugf: OaugfAuditIndexPayload = {
      generatedAt: '2026-11-23T12:00:00Z',
      status: 'VERIFIED',
      headline: {
        reportsIndexed: 1,
        totalPages: 50,
        totalChunks: 50,
        yearsCovered: [2021],
        parsedAuditIssuesCount: 49,
        matchedMdasCount: 1,
        categoryCounts: {},
      },
      documents: [],
      topIssues: [],
      byMda: {
        'WATER RESOURCES': {
          mdaKey: 'WATER RESOURCES',
          mdaName: 'FEDERAL MINISTRY OF WATER RESOURCES',
          findingCount: 49,
          repeatNeglectCount: 1,
          recoveryDirectiveCount: 9,
          totalFlaggedNaira: 2_000_000_000,
          reportYears: [2021],
          categories: {},
          sampleFindings: [],
        },
      },
    };

    const hits = searchNeighborhoodProjects({
      query: 'Tarauni',
      stateFilter: 'Kano',
      records: recs,
      lifecycleIndex: null,
      compoundProjects: mockCompound,
      crossLedgerContext: {
        paidOnPaperCodes: [],
        billInsertionCodes: ['ERGP111', 'ERGP222'],
        zombieLineageCodes: [],
        mdaProfilesByKey: {},
      },
      oaugfIndex: mockOaugf,
    });

    expect(hits).toHaveLength(2);
    expect(hits[0].compoundRiskScore).toBe(72);
    expect(hits[0].billInsertedOrInflated).toBe(true);
    expect(hits[0].oaugfMdaQueries).toBe(49);
    expect(hits[1].billInsertedOrInflated).toBe(true);

    const summary = buildLocalAccountabilitySummary(hits);
    expect(summary.totalMatchedCount).toBe(2);
    expect(summary.billInsertedCount).toBe(2);
    expect(summary.flaggedCompoundCount).toBe(1);
    expect(summary.highRiskCount).toBe(1);
    expect(summary.oaugfIndictedMdaCount).toBe(1);
    expect(summary.oaugfTotalMdaQueries).toBe(49);
    expect(summary.topOaugfMdas[0].oaugfQueries).toBe(49);
  });
});
