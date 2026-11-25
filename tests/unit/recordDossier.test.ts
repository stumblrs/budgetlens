import { describe, it, expect } from 'vitest';
import type { BudgetRecord } from '../../src/services/budgetDatabaseEngine';
import { buildEvidenceSheetDocxBytes, buildEvidenceSheetPdfBytes } from '../../src/utils/documentExporter';
import {
  buildRecordDossierUrl,
  computeEconomicRealityMetrics,
  resolveTargetBudgetRecord,
  sliceSamePageSiblings,
} from '../../src/utils/recordDossier';
import { readAppUrlState } from '../../src/utils/urlState';

function makeMockRecord(id: string, code: string, name: string, amount: number, page: number, agency = 'Ministry of Works'): BudgetRecord {
  return {
    recordIdentity: {
      id,
      financialYear: 2025,
      projectCode: code,
      verbatimProjectName: name,
      amountNaira: amount,
      amountFormatted: `₦${amount.toLocaleString()}`,
      spendingType: 'CAPITAL',
    },
    sourceProvenance: {
      documentId: 'DOC-2025',
      sourceFilename: '2025 Appropriation ACT as Passed.pdf',
      pdfPage: page,
      sha256Hash: 'abc123def456',
    },
    geographicTaxonomy: {
      jurisdictionLevel: 'Federal',
      geoPoliticalZone: 'North Central',
      state: 'FCT',
      lga: 'AMAC',
    },
    mdaGovernanceTaxonomy: {
      mdaCode: '0234001001',
      mdaName: agency,
      sector: 'Works & Housing',
    },
    multiYearLineage: {
      lineageId: null,
      yearsAppeared: [2025],
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

describe('Official Record Dossier & Full-Tab (?tab=record)', () => {
  it('parses and builds ?tab=record permalinks cleanly', () => {
    const parsed = readAppUrlState('?tab=record&year=2025&item=ERGP99123&page=412');
    expect(parsed).toEqual({
      tab: 'record',
      year: 2025,
      item: 'ERGP99123',
      page: 412,
      q: '',
    });

    const url = buildRecordDossierUrl({ year: 2025, item: 'ERGP99123', page: 412 });
    expect(url).toContain('tab=record');
    expect(url).toContain('year=2025');
    expect(url).toContain('item=ERGP99123');
    expect(url).toContain('page=412');
  });

  it('resolves target record, slices same-page sibling context, and handles not-found gracefully', () => {
    const records: BudgetRecord[] = [
      makeMockRecord('P-2025-1', 'ERGP100', 'Rehabilitation of Bridge A', 200_000_000, 12),
      makeMockRecord('P-2025-2', 'ERGP101', 'Dualization of Highway B', 500_000_000, 12),
      makeMockRecord('P-2025-3', 'ERGP102', 'Construction of Feeder Road C', 150_000_000, 13),
    ];

    const matched = resolveTargetBudgetRecord(records, { item: 'ERGP101', page: 12 });
    expect(matched?.recordIdentity.id).toBe('P-2025-2');

    const missing = resolveTargetBudgetRecord(records, { item: 'NON_EXISTENT', page: 999 });
    expect(missing).toBeUndefined();

    const siblings = sliceSamePageSiblings(records, {
      targetId: matched!.recordIdentity.id,
      projectCode: 'ERGP101',
      projectName: 'Dualization of Highway B',
      page: 12,
      agency: 'Ministry of Works',
    });
    expect(siblings.rows).toHaveLength(2);
    expect(siblings.rows.filter((r) => r.isTarget)).toHaveLength(1);
    expect(siblings.rows[1].isTarget).toBe(true);
  });

  it('computes economic reality metrics and produces valid %PDF- / OOXML PK exports', async () => {
    const econ = computeEconomicRealityMetrics(1_500_000_000, 2025);
    expect(econ.usdValue).toBeGreaterThan(0);
    expect(econ.shareOfBudgetPct).toBeGreaterThan(0);

    const pdfBytes = await buildEvidenceSheetPdfBytes({
      financialYear: 2025,
      projectCode: 'ERGP101',
      projectName: 'Dualization of Highway B',
      amountNaira: 500_000_000,
      agencyName: 'Ministry of Works',
      page: 12,
      sourceFilename: '2025 Appropriation ACT as Passed.pdf',
      sha256: 'sha256:abc123',
      permalink: 'https://budgetlens.ng/?tab=record&year=2025&item=ERGP101&page=12',
    });
    expect(new TextDecoder('ascii').decode(pdfBytes.slice(0, 5))).toBe('%PDF-');

    const docxBytes = await buildEvidenceSheetDocxBytes({
      financialYear: 2025,
      projectCode: 'ERGP101',
      projectName: 'Dualization of Highway B',
      amountNaira: 500_000_000,
      agencyName: 'Ministry of Works',
      page: 12,
      sourceFilename: '2025 Appropriation ACT as Passed.pdf',
      sha256: 'sha256:abc123',
      permalink: 'https://budgetlens.ng/?tab=record&year=2025&item=ERGP101&page=12',
    });
    expect(docxBytes[0]).toBe(0x50);
    expect(docxBytes[1]).toBe(0x4b);
  });
});
