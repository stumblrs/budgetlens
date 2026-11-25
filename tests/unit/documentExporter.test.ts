import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  sanitizePdfText,
  buildTabularDossierPdfBytes,
  buildTabularDossierDocxBytes,
  buildEvidenceSheetPdfBytes,
  buildEvidenceSheetDocxBytes,
  buildExecutionProcurementSpec,
  buildProcurementRiskSpec,
  buildProcurementRiskPdfBytes,
  buildProcurementRiskDocxBytes,
  buildContractorBriefPdfBytes,
  buildContractorBriefDocxBytes,
  buildMdaScorecardBriefPdfBytes,
  buildMdaScorecardBriefDocxBytes,
  buildRecordForensicBriefPdfBytes,
  buildRecordForensicBriefDocxBytes,
  buildStateBriefPdfBytes,
  buildStateBriefDocxBytes,
  buildOaugfNegligencePdfBytes,
  buildOaugfNegligenceDocxBytes,
  buildEvidenceEngineDossierPdfBytes,
  buildEvidenceEngineDossierDocxBytes,
  buildDuplicateClustersDossierPdfBytes,
  buildDuplicateClustersDossierDocxBytes,
  buildExecutiveReportSpec,
  buildExecutiveReportPdfBytes,
  buildExecutiveReportDocxBytes,
} from '../../src/utils/documentExporter';
import type { ReportPayload } from '../../src/utils/reportExporter';

function walkSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

describe('documentExporter & strict PDF/DOCX policy', () => {
  it('sanitizes Naira and Unicode punctuation for WinAnsi PDF fonts without losing amounts', () => {
    const clean = sanitizePdfText('Allocation: ₦1,250,000,000 — “Executive” · Item…');
    expect(clean).toBe('Allocation: NGN 1,250,000,000 - "Executive" | Item...');
    expect(clean).not.toContain('\u20A6');
    expect(sanitizePdfText('HADEJIA-JAMAÄ»ARE RBDA')).toBe("HADEJIA-JAMA'ARE RBDA");
  });

  it('cleans tabular MDA/contractor names and includes BIR caveats while emitting valid %PDF- and PK headers', async () => {
    const execSpec = buildExecutionProcurementSpec({
      financialYear: 2015,
      executionYearReport: {
        status: 'VERIFIED_BIR_SOURCE',
        quarterCovered: 'Q4',
        isPartialYear: false,
        coverageNote: 'FY 2015 Debt Service sub-total reconciled from components.',
        macroIntegrityWarnings: [
          'FY 2015 Debt Service sub-total extracted at ₦60.38B fell below component debt service; reconciled to ₦1060.39B.',
        ],
        reportTitle: 'FY 2015 Budget Implementation Report',
        sourceFile: '2015_Q4_BIR.pdf',
        totalAppropriatedNaira: 3_452_360_000_000,
        totalReleasedNaira: 2_776_360_000_000,
        overallReleasePct: 80.42,
        mdaBreakdown: [
          {
            mdaName: 'FEDERAL MINISTRY OF AGRICULTURE AND FOOD SECURITY -',
            appropriatedNaira: 39_150_000_000,
            releasedNaira: 18_500_000_000,
            releasePct: 47.3,
            overspendVirement: false,
          },
          {
            mdaName: 'HADEJIA-JAMAÄ»ARE RBDA',
            appropriatedNaira: 5_200_000_000,
            releasedNaira: 2_100_000_000,
            releasePct: 40.4,
            overspendVirement: false,
          },
        ],
        macroRows: [
          {
            label: 'Debt Service / Recurrent Debt (Sub-Total)',
            budgetNaira: 953_620_000_000,
            actualNaira: 1_060_390_000_000,
            performancePct: 111.2,
            derivedFromComponents: true,
          },
        ],
      },
      procurementStatus: 'VERIFIED_OCDS_SNAPSHOT',
      contractorConcentration: [
        {
          contractorName: 'HADEJIA-JAMAÄ»ARE CONTRACTING LTD -',
          awardCount: 2,
          totalAwardNaira: 450_000_000,
        },
      ],
    });

    expect(execSpec.tables[0].rows[0][0]).toBe('FEDERAL MINISTRY OF AGRICULTURE AND FOOD SECURITY');
    expect(execSpec.tables[0].rows[1][0]).toBe("HADEJIA-JAMA'ARE RBDA");
    expect(execSpec.tables[1].rows[0][0]).toContain('(Derived)');
    expect(execSpec.tables[2].rows[0][0]).toBe("HADEJIA-JAMA'ARE CONTRACTING LTD");
    expect(execSpec.narrative).toContain('FY 2015 Debt Service sub-total reconciled');
    expect(execSpec.bulletBlocks?.[0].items[0]).toContain('reconciled to ₦1060.39B');

    const execPdf = await buildTabularDossierPdfBytes(execSpec);
    expect(String.fromCharCode(...execPdf.slice(0, 5))).toBe('%PDF-');
    const execDocx = await buildTabularDossierDocxBytes(execSpec);
    expect(execDocx[0]).toBe(0x50);
    expect(execDocx[1]).toBe(0x4b);

    const riskSpec = buildProcurementRiskSpec({
      headline: {
        totalAwardedRows: 100,
        totalAwardedNaira: 1_000_000_000,
        totalPaidNaira: 500_000_000,
        planningExcludedCount: 10,
        nonCompetitiveCount: 5,
        nonCompetitiveAwardedNaira: 100_000_000,
        nonCompetitiveValueSharePct: 10,
        overrunCount: 1,
        overrunDeltaNaira: 50_000_000,
        zeroPaidCount: 2,
        zeroPaidAwardedNaira: 20_000_000,
      },
      mdaRiskRanking: [
        {
          mdaName: 'HADEJIA-JAMAÄ»ARE RBDA -',
          awardCount: 5,
          totalAwardedNaira: 200_000_000,
          nonCompetitiveAwardedNaira: 50_000_000,
          nonCompetitiveSharePct: 25,
          overrunCount: 0,
          overrunDeltaNaira: 0,
          zeroPaidCount: 1,
          riskScore: 32,
        },
      ],
      topOverrunContracts: [],
      topZeroPaidAwards: [],
    });
    expect(riskSpec.tables[0].rows[0][0]).toBe("HADEJIA-JAMA'ARE RBDA");
  });

  it('produces valid %PDF- and OOXML PK binaries for Tabular Dossiers', async () => {
    const spec = {
      filenameBase: 'BudgetLens_Unit_Test',
      eyebrow: 'TEST DOSSIER',
      title: 'Verification Export Table',
      subtitle: 'FY 2025 Audit Sample',
      kpis: [{ label: 'Sample Total', value: '₦1.20B', subtext: '₦1,200,000,000' }],
      tables: [
        {
          heading: 'Sample Rows',
          columns: ['Code', 'Project', 'Amount'],
          rows: [['ERGP01', 'Rehabilitation of General Hospital Ward', '₦1,200,000,000']],
          rightAlignColumns: [2],
        },
      ],
      sha256: 'e3afde2dce406a366c3a7a9dbec4adb125db9b25777fb02f033c4dad04ffa5cd',
      permalink: 'https://budgetlens.ng/?tab=overview&year=2025',
    };

    const pdfBytes = await buildTabularDossierPdfBytes(spec);
    expect(pdfBytes.byteLength).toBeGreaterThan(1000);
    expect(String.fromCharCode(...pdfBytes.slice(0, 5))).toBe('%PDF-');

    const docxBytes = await buildTabularDossierDocxBytes(spec);
    expect(docxBytes.byteLength).toBeGreaterThan(2000);
    expect(docxBytes[0]).toBe(0x50); // 'P'
    expect(docxBytes[1]).toBe(0x4b); // 'K'
  });

  it('produces valid %PDF- and OOXML PK binaries for Single-Record Evidence Sheets', async () => {
    const evidenceSpec = {
      financialYear: 2025,
      projectCode: 'ERGP202588',
      projectName: 'Procurement of Utility Ambulance Vehicles',
      amountNaira: 350_000_000,
      agencyName: 'Federal Ministry of Health',
      page: 112,
      sha256: 'a'.repeat(64),
    };

    const pdfBytes = await buildEvidenceSheetPdfBytes(evidenceSpec);
    expect(String.fromCharCode(...pdfBytes.slice(0, 5))).toBe('%PDF-');

    const docxBytes = await buildEvidenceSheetDocxBytes(evidenceSpec);
    expect(docxBytes[0]).toBe(0x50);
    expect(docxBytes[1]).toBe(0x4b);
  });

  it('produces valid %PDF- and OOXML PK binaries for Procurement Risk & Overrun Dossiers', async () => {
    const riskInput = {
      headline: {
        totalAwardedRows: 16536,
        totalAwardedNaira: 4_311_275_338_387,
        totalPaidNaira: 1_400_000_000_000,
        planningExcludedCount: 82140,
        nonCompetitiveCount: 5400,
        nonCompetitiveAwardedNaira: 1_240_000_000_000,
        nonCompetitiveValueSharePct: 28.76,
        overrunCount: 410,
        overrunDeltaNaira: 112_000_000_000,
        zeroPaidCount: 3500,
        zeroPaidAwardedNaira: 2_900_000_000_000,
        excludedTestRecordsCount: 190,
        excludedTestAwardedNaira: 72_985_435_355,
        koboShiftAnomalyCount: 25,
        koboShiftAnomalyDeltaNaira: 358_000_000_000,
      },
      mdaRiskRanking: [
        {
          mdaName: 'Federal Ministry of Works',
          awardCount: 250,
          totalAwardedNaira: 500_000_000_000,
          nonCompetitiveAwardedNaira: 200_000_000_000,
          nonCompetitiveSharePct: 40.0,
          overrunCount: 12,
          overrunDeltaNaira: 50_000_000_000,
          zeroPaidCount: 40,
          riskScore: 45.0,
        },
      ],
      topOverrunContracts: [
        {
          ocid: 'ocds-gyl66f-00001',
          financialYear: 2022,
          mdaName: 'Federal Ministry of Works',
          contractorName: 'Sample Builders Ltd',
          procurementMethod: 'Direct Procurement',
          awardNaira: 100_000_000,
          paidNaira: 250_000_000,
          overrunDeltaNaira: 150_000_000,
        },
      ],
      topZeroPaidAwards: [
        {
          ocid: 'ocds-gyl66f-00002',
          financialYear: 2023,
          mdaName: 'Federal Ministry of Health',
          contractorName: 'Medical Equipment Co',
          procurementMethod: 'Emergency',
          awardNaira: 300_000_000,
        },
      ],
      portalDataEntryAnomalies: [
        {
          ocid: 'ocds-gyl66f-156006003-000039',
          financialYear: 2018,
          mdaName: 'NIGERIAN COMMUNICATION COMMISSION',
          anomalyType: 'KOBO_SHIFT_100X',
          anomalyReason: 'Recorded payment is ~100x award (likely kobo entered as Naira on NOCOPO)',
          awardNaira: 248_105_700,
          paidNaira: 24_810_570_000,
          overrunDeltaNaira: 24_562_464_300,
          paidToAwardRatio: 100,
        },
      ],
    };

    const riskSpec = buildProcurementRiskSpec(riskInput);
    expect(riskSpec.tables.length).toBe(4);
    expect(riskSpec.tables[3].heading).toContain('Quarantined Portal Test');
    expect(riskSpec.narrative).toContain('190 portal sandbox/test rows');

    const pdfBytes = await buildProcurementRiskPdfBytes(riskInput);
    expect(String.fromCharCode(...pdfBytes.slice(0, 5))).toBe('%PDF-');

    const docxBytes = await buildProcurementRiskDocxBytes(riskInput);
    expect(docxBytes[0]).toBe(0x50);
    expect(docxBytes[1]).toBe(0x4b);
  });

  it('produces valid %PDF- and OOXML PK binaries for Contractor, MDA Scorecard, and Record Forensic Briefs', async () => {
    const contractorPdf = await buildContractorBriefPdfBytes({
      contractorName: 'SAMPLE ENGINEERING NIG LTD',
      bppContractorId: 'BPP-CI-901',
      firstYear: 2021,
      lastYear: 2024,
      totalContracts: 2,
      totalContractedNaira: 450_000_000,
      totalGovspendNaira: 620_000_000,
      totalGovspendCount: 3,
      mdaCount: 1,
      networkContext: { captiveMdaLabel: 'Works (78%)', payoutDiscrepancyPct: 137.8 },
      contracts: [
        {
          financialYear: 2023,
          stage: 'contract',
          budgetTitle: 'Rehabilitation of Abuja-Lokoja Lot 2',
          mdaName: 'Federal Ministry of Works',
          procurementMethod: 'National Competitive Bidding',
          contractAwardNaira: 450_000_000,
          totalPaidNaira: 450_000_000,
        },
      ],
      payments: [
        {
          paymentDate: '2024-02-15',
          paymentNo: '1009911',
          organizationName: 'Federal Ministry of Works',
          amountNaira: 200_000_000,
          description: 'Certificate 1 road rehabilitation works',
        },
      ],
    });
    expect(String.fromCharCode(...contractorPdf.slice(0, 5))).toBe('%PDF-');

    const contractorDocx = await buildContractorBriefDocxBytes({
      contractorName: 'SAMPLE ENGINEERING NIG LTD',
      totalContracts: 1,
      totalContractedNaira: 450_000_000,
      totalGovspendNaira: 200_000_000,
      totalGovspendCount: 1,
      mdaCount: 1,
      contracts: [],
      payments: [],
    });
    expect(contractorDocx[0]).toBe(0x50);
    expect(contractorDocx[1]).toBe(0x4b);

    const mdaPdf = await buildMdaScorecardBriefPdfBytes({
      mdaKey: 'WORKS',
      mdaName: 'FEDERAL MINISTRY OF WORKS',
      parentFamilies: ['WORKS'],
      compositeScore: 68.5,
      grade: 'B',
      metricsPresent: 5,
      totalExpectedMetrics: 5,
      activeWeightSum: 100,
      totalTrackedExposureNaira: 2_000_000_000_000,
      pillarRows: [
        {
          pillarLabel: 'Legislative Padding Restraint',
          weight: 20,
          effectiveWeightPct: '20',
          score: 85.0,
          status: 'SCORED',
          telemetrySummary: '15.0% positive NASS padding across 7 cycles',
        },
      ],
    });
    expect(String.fromCharCode(...mdaPdf.slice(0, 5))).toBe('%PDF-');

    const mdaDocx = await buildMdaScorecardBriefDocxBytes({
      mdaKey: 'WORKS',
      mdaName: 'FEDERAL MINISTRY OF WORKS',
      parentFamilies: ['WORKS'],
      compositeScore: 68.5,
      grade: 'B',
      metricsPresent: 5,
      totalExpectedMetrics: 5,
      activeWeightSum: 100,
      totalTrackedExposureNaira: 2_000_000_000_000,
      pillarRows: [],
    });
    expect(mdaDocx[0]).toBe(0x50);
    expect(mdaDocx[1]).toBe(0x4b);

    const recPdf = await buildRecordForensicBriefPdfBytes({
      financialYear: 2024,
      projectCode: 'ERGP12141395',
      projectName: 'Rehabilitation of Umuahia-Ikot Ekpene Road in Abia State',
      agencyName: 'Federal Ministry of Works',
      state: 'Abia',
      page: 214,
      amountNaira: 1_500_000_000,
      paidOnPaperPriority: true,
      paidOnPaperReason: '100% NOCOPO award paid while BIR release lagged',
      stages: [
        { stage: 'Stage 1: MTEF', status: 'EXACT_YEAR_MTEF', evidenceSummary: 'FX NGN 402.28/$ | Oil $105.88' },
        { stage: 'Stage 4: NOCOPO', status: 'AWARDED', evidenceSummary: '1 awarded release totaling NGN 1.50B' },
      ],
    });
    expect(String.fromCharCode(...recPdf.slice(0, 5))).toBe('%PDF-');

    const recDocx = await buildRecordForensicBriefDocxBytes({
      financialYear: 2024,
      projectCode: 'ERGP12141395',
      projectName: 'Rehabilitation of Umuahia-Ikot Ekpene Road in Abia State',
      agencyName: 'Federal Ministry of Works',
      page: 214,
      amountNaira: 1_500_000_000,
      stages: [],
    });
    expect(recDocx[0]).toBe(0x50);
    expect(recDocx[1]).toBe(0x4b);

    const statePdf = await buildStateBriefPdfBytes({
      financialYear: 2025,
      stateName: 'Kano',
      displayName: 'Kano',
      zone: 'North West',
      anomalyScore: 'High',
      budgetedNaira: 45_000_000_000,
      projectCount: 120,
      flaggedCount: 18,
      flaggedAmountNaira: 9_000_000_000,
      flaggedSharePct: 15.0,
      topMinistry: 'Federal Ministry of Works',
      contractedNairaFy: 12_000_000_000,
      contractedNairaCumulative: 123_800_000_000,
      disbursedNairaFy: 28_000_000_000,
      disbursedNairaCumulative: 711_000_000_000,
      senatorialDistricts: ['Kano Central', 'Kano North', 'Kano South'],
      federalConstituenciesCount: 24,
      topContractors: [{ name: 'SAMPLE ROADS NIG LTD', awardedNaira: 15_000_000_000, count: 4 }],
      topAllocations: [
        {
          projectCode: 'ERGP1001',
          projectName: 'Rehabilitation of Kano Dual Carriageway',
          agency: 'Federal Ministry of Works',
          amount: 5_000_000_000,
          page: 88,
          isFlagged: false,
        },
      ],
      lgaBreakdown: [
        {
          lgaName: 'Bichi',
          projectCount: 5,
          amountNaira: 1_200_000_000,
          flaggedCount: 1,
          topProjectCode: 'ERGP1002',
          topProjectTitle: 'Bichi Rural Water Supply',
        },
      ],
    });
    expect(String.fromCharCode(...statePdf.slice(0, 5))).toBe('%PDF-');

    const stateDocx = await buildStateBriefDocxBytes({
      financialYear: 2025,
      stateName: 'Kano',
      displayName: 'Kano',
      zone: 'North West',
      anomalyScore: 'High',
      budgetedNaira: 45_000_000_000,
      projectCount: 120,
      flaggedCount: 18,
      flaggedAmountNaira: 9_000_000_000,
      flaggedSharePct: 15.0,
      topMinistry: 'Federal Ministry of Works',
      contractedNairaFy: 12_000_000_000,
      contractedNairaCumulative: 123_800_000_000,
      disbursedNairaFy: 28_000_000_000,
      disbursedNairaCumulative: 711_000_000_000,
      topContractors: [],
      topAllocations: [],
      lgaBreakdown: [],
    });
    expect(stateDocx[0]).toBe(0x50);
    expect(stateDocx[1]).toBe(0x4b);

    const oaugfPdf = await buildOaugfNegligencePdfBytes({
      filterSummary: 'All Categories | FY 2024',
      reportsIndexed: 36,
      parsedAuditIssuesCount: 3385,
      repeatNeglectCount: 34,
      recoveryDirectiveCount: 121,
      items: [
        {
          heading: 'Issue 12: Payment Vouchers Not Presented for Audit',
          category: 'Unvouched / Missing Payment Vouchers',
          mdaName: 'FEDERAL MINISTRY OF WORKS',
          docTitle: 'Annual Report on Non-Compliance 2024 Vol I',
          year: 2024,
          page: 15,
          amountNaira: 250_000_000,
          repeatNeglect: true,
          recoveryRequired: true,
          recommendation: 'Recover the unvouched sum to Treasury.',
        },
      ],
    });
    expect(String.fromCharCode(...oaugfPdf.slice(0, 5))).toBe('%PDF-');

    const oaugfDocx = await buildOaugfNegligenceDocxBytes({
      filterSummary: 'All Categories | FY 2024',
      reportsIndexed: 36,
      parsedAuditIssuesCount: 3385,
      repeatNeglectCount: 34,
      recoveryDirectiveCount: 121,
      items: [],
    });
    expect(oaugfDocx[0]).toBe(0x50);
    expect(oaugfDocx[1]).toBe(0x4b);

    const eePdf = await buildEvidenceEngineDossierPdfBytes({
      financialYear: 2025,
      modeLabel: 'FY 2025 Compound Risk Ledger',
      filterSummary: 'All 22 Rules',
      totalRulesCount: 22,
      totalRuleFindings: 3200,
      totalCrossLedgerFindings: 1450,
      totalCompoundProjects: 1850,
      compoundProjects: [
        {
          projectCode: 'ERGP123456',
          projectName: 'Provision of Solar Street Lights in Selected Locations',
          agency: 'Federal Ministry of Agriculture',
          financialYear: 2025,
          amount: 850_000_000,
          page: 112,
          ruleCount: 5,
          crossLedgerRuleCount: 3,
          compoundRiskScore: 95,
          ruleNames: ['MDA Mandate Mismatch', 'Paid-on-Paper High-Risk Disbursement'],
          paidOnPaper: true,
          billInsertedOrInflated: true,
          mdaOaugfIssuesCount: 38,
          mdaIntegrityGrade: 'F',
        },
      ],
    });
    expect(String.fromCharCode(...eePdf.slice(0, 5))).toBe('%PDF-');

    const eeDocx = await buildEvidenceEngineDossierDocxBytes({
      financialYear: 2025,
      modeLabel: 'FY 2025 Compound Risk Ledger',
      filterSummary: 'All 22 Rules',
      totalRulesCount: 22,
      totalRuleFindings: 3200,
      totalCrossLedgerFindings: 1450,
      totalCompoundProjects: 1850,
      compoundProjects: [],
    });
    expect(eeDocx[0]).toBe(0x50);
    expect(eeDocx[1]).toBe(0x4b);

    const dupPdf = await buildDuplicateClustersDossierPdfBytes({
      financialYear: 2025,
      filterSummary: 'All Patterns',
      totalClusters: 120,
      totalItems: 480,
      totalValueNaira: 95_000_000_000,
      paidOnPaperClusterCount: 14,
      billInsertedClusterCount: 28,
      oaugfFlaggedClusterCount: 45,
      clusters: [
        {
          id: 'DUP-00001',
          patternType: 'Cross-MDA Duplicate',
          canonicalTitle: 'Provision of Solar Street Lights in Rural Communities',
          count: 4,
          distinctAgencies: 3,
          distinctStates: 2,
          totalAmount: 1_200_000_000,
          paidOnPaperCount: 2,
          billInsertedCount: 3,
          maxMdaOaugfIssues: 22,
          worstMdaGrade: 'F',
          sampleAgencies: ['Ministry of Agriculture', 'SMEDAN'],
        },
      ],
    });
    expect(String.fromCharCode(...dupPdf.slice(0, 5))).toBe('%PDF-');

    const dupDocx = await buildDuplicateClustersDossierDocxBytes({
      financialYear: 2025,
      filterSummary: 'All Patterns',
      totalClusters: 120,
      totalItems: 480,
      totalValueNaira: 95_000_000_000,
      paidOnPaperClusterCount: 14,
      billInsertedClusterCount: 28,
      oaugfFlaggedClusterCount: 45,
      clusters: [],
    });
    expect(dupDocx[0]).toBe(0x50);
    expect(dupDocx[1]).toBe(0x4b);

    const sixLedgerReportPayload: ReportPayload = {
      financialYear: 2025,
      template: 'six_ledger_brief',
      documentTitle: 'FY2025 Six-Ledger Audit Brief',
      preparedBy: 'Observatory Desk',
      generatedAt: '2026-11-23T18:00:00Z',
      presidentName: 'Bola Ahmed Tinubu',
      party: 'APC',
      termLabel: '2023–Present',
      filterSummary: 'All Sectors',
      tableRowLimit: 50,
      orientation: 'landscape',
      sections: {
        includeMacroContext: false,
        includeDebtSnapshot: false,
        includeYoY: false,
        includeCivicImpact: false,
        includeCitations: true,
        includeAnalystNotes: false,
      },
      analystNotes: '',
      registryLength: 162,
      excludedRollupsCount: 412,
      macro: {
        officialTotalBudget: 54_990_000_000_000,
        totalCapitalBudget: 23_960_000_000_000,
        recurrentNonDebtTotal: 13_060_000_000_000,
        debtService: 14_320_000_000_000,
        statutoryTransfers: 3_650_000_000_000,
        totalCapitalExtracted: 23_500_000_000_000,
        totalCapitalCount: 52487,
        budgetTheme: 'Budget of Restoration',
        policyPriorities: [],
        sourcesAnalyzed: [],
      },
      debtSnapshot: null,
      yoy: null,
      stats: {
        count: 52487,
        totalAllocated: 23_500_000_000_000,
        avgAmount: 447_700_000,
        medianAmount: 120_000_000,
        maxItem: null,
        sectorBreakdown: [],
        topAgencies: [],
        highSeverityCount: 420,
        mediumSeverityCount: 180,
        lowSeverityCount: 50,
        flaggedTotalAmount: 1_800_000_000_000,
        duplicateClusterCount: 25,
        duplicateTotalAmount: 45_000_000_000,
        duplicateItemCount: 80,
      },
      civicEquivalents: {
        inflationFactor: 1.5,
        unitCosts: {
          phc: 37_500_000,
          classroomBlock: 22_500_000,
          solarBorehole: 5_250_000,
          annualSchoolMeal: 108_000,
          annualMinWage: 840_000,
        },
        equivalents: {
          phcs: 1000,
          classroomBlocks: 2000,
          solarBoreholes: 5000,
          schoolMealsFed: 100000,
          annualMinWages: 50000,
        },
      },
      findings: [],
      duplicateClusters: [],
      lineages: [],
      projects: [],
      crossLedgerFindingsCount: 210,
      compoundProjectsCount: 140,
      sixLedgerSummary: {
        engineVersion: '3.0.0',
        totalRulesCount: 22,
        activeYearFindingsCount: 650,
        activeYearCrossLedgerCount: 210,
        activeYearCompoundProjectsCount: 140,
        allYearsRecordsScanned: 559391,
        allYearsRuleFindings: 49679,
        allYearsFlaggedProjects: 28681,
        allYearsFlaggedNaira: 24_570_000_000_000,
        oaugf: {
          reportsIndexed: 36,
          parsedAuditIssuesCount: 7028,
          repeatNeglectCount: 54,
          recoveryDirectiveCount: 675,
          matchedMdasCount: 127,
          topCategories: [{ category: 'Internal Control & Asset Management', count: 1910 }],
        },
        billActDiff: {
          cyclesCount: 7,
          activeYearCycle: {
            financialYear: 2025,
            comparisonScope: 'LINE_ITEM_SCHEDULE',
            insertionsCount: 12364,
            insertionsTotalNaira: 11_709_885_296_656,
            inflatedCount: 2734,
            inflatedTotalNaira: 3_939_032_364_439,
            cutCount: 3560,
            cutTotalNaira: 3_110_795_510_759,
            zipTotalNaira: 201_146_571_996,
          },
          allCyclesInsertionsCount: 38673,
          allCyclesInsertionsNaira: 17_446_935_740_309,
          allCyclesInflatedNaira: 9_623_637_263_431,
        },
        treasuryCash: {
          totalVouchers: 467763,
          totalNaira: 47_531_629_923_484,
          personalStaffCount: 10851,
          personalStaffPaidNaira: 1_488_270_101_629,
          personalStaffBillionPlusCount: 235,
          unclassifiedCount: 4169,
          unclassifiedPaidNaira: 1_262_237_826_710,
          opaqueVoucherCount: 33366,
          opaqueNaira: 2_439_480_309_528,
          decemberRushRatio: 2.75,
        },
        topCompoundProjects: [
          {
            projectCode: 'ERGP2025101',
            projectName: 'Supply of Solar Street Lights in Rural Wards',
            agency: 'Federal Ministry of Agriculture',
            amount: 850_000_000,
            page: 112,
            ruleCount: 4,
            crossLedgerRuleCount: 2,
            compoundRiskScore: 86,
            ruleNames: ['MDA Mandate Mismatch', 'Paid-on-Paper High-Risk Disbursement'],
            paidOnPaper: true,
            billInserted: true,
            mdaOaugfIssues: 97,
            mdaGrade: 'D',
          },
        ],
        topConvergentMdas: [
          {
            mdaName: 'STATE HOUSE',
            flagCount: 5,
            flags: ['HIGH_LEGISLATIVE_PADDING', 'HIGH_OAUGF_NEGLIGENCE', 'OPAQUE_OR_STAFF_PAYOUTS'],
            grade: 'D',
            compositeScore: 35.3,
            oaugfQueryCount: 21,
            oaugfRepeatCount: 0,
            totalExposureNaira: 1_060_320_535_463,
          },
        ],
      },
    };

    const sixLedgerSpec = buildExecutiveReportSpec(sixLedgerReportPayload);
    expect(sixLedgerSpec.tables.length).toBe(4);
    expect(sixLedgerSpec.kpis?.length).toBe(6);

    const sixPdf = await buildExecutiveReportPdfBytes(sixLedgerReportPayload);
    expect(String.fromCharCode(...sixPdf.slice(0, 5))).toBe('%PDF-');
    expect(sixPdf.byteLength).toBeGreaterThan(2000);

    const sixDocx = await buildExecutiveReportDocxBytes(sixLedgerReportPayload);
    expect(sixDocx[0]).toBe(0x50);
    expect(sixDocx[1]).toBe(0x4b);
    expect(sixDocx.byteLength).toBeGreaterThan(2000);
  });

  it('enforces ZERO disallowed CSV/JSON/HTML/MD/SVG file download code paths across src/', () => {
    const srcFiles = walkSourceFiles(path.resolve(process.cwd(), 'src'));
    const forbiddenMimeOrBlobPatterns = [
      /new\s+Blob\([^)]*text\/(csv|html|markdown)/i,
      /new\s+Blob\([^)]*application\/json/i,
      /data:text\/(csv|html|json|markdown)/i,
      /download\s*=\s*['"`][^'"`]*\.(csv|json|html|md|svg)\b/i,
    ];

    const violations: string[] = [];
    for (const file of srcFiles) {
      const text = fs.readFileSync(file, 'utf8');
      for (const re of forbiddenMimeOrBlobPatterns) {
        if (re.test(text)) {
          violations.push(`${path.relative(process.cwd(), file)} matched ${re}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
