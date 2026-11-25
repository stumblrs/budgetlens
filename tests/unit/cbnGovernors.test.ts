import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  CBN_ACTING_GOVERNORS,
  CBN_GOVERNORS,
  getGovernorForYear,
  getGovernorsForPresident,
} from '../../src/data/cbnGovernors';
import { computeConstitutionalHandoverDebtLedger } from '../../src/utils/administrationDebt';
import {
  buildCbnDebtBriefDocxBytes,
  buildCbnDebtBriefPdfBytes,
} from '../../src/utils/documentExporter';

describe('CBN Governors Archive & Presidential Debt Exports', () => {
  it('contains all 12 substantive CBN Governors (1958-2026) and 2 acting governors with verified portrait JPEGs on disk', () => {
    expect(CBN_GOVERNORS).toHaveLength(12);
    expect(CBN_ACTING_GOVERNORS).toHaveLength(2);

    const publicDir = path.resolve(__dirname, '../../public');
    CBN_GOVERNORS.forEach((gov, idx) => {
      expect(gov.order).toBe(idx + 1);
      expect(gov.economicManagement.length).toBeGreaterThanOrEqual(3);
      expect(gov.documentedCriticisms.length).toBeGreaterThanOrEqual(3);
      expect(gov.sources.length).toBeGreaterThanOrEqual(2);
      expect(gov.portraitPath).toMatch(/^\/governors\/[a-z0-9_]+\.jpg$/);

      const diskPath = path.join(publicDir, gov.portraitPath.replace(/^\//, ''));
      expect(fs.existsSync(diskPath), `Missing portrait: ${diskPath}`).toBe(true);
      const buf = fs.readFileSync(diskPath);
      expect(buf.length).toBeGreaterThan(5_000);
      // JPEG SOI magic bytes (0xFF, 0xD8)
      expect(buf[0]).toBe(0xff);
      expect(buf[1]).toBe(0xd8);
    });

    expect(getGovernorsForPresident('buhari').map((g) => g.id)).toContain('emefiele');
    expect(getGovernorsForPresident('tinubu').map((g) => g.id)).toContain('cardoso');
    expect(getGovernorForYear(2005).id).toBe('soludo');
    expect(getGovernorForYear(2025).id).toBe('cardoso');
  });

  it('builds valid %PDF- and OOXML PK binaries for CBN Governors & Presidential Debt dossiers', async () => {
    const ledger = computeConstitutionalHandoverDebtLedger([], 505);
    const input = {
      governors: CBN_GOVERNORS,
      actingGovernors: CBN_ACTING_GOVERNORS,
      debtRecords: ledger.records,
      latestAsAt: ledger.latestAsAt,
      totalDocumentsIndexed: ledger.totalDocumentsIndexed,
      permalink: 'https://budgetlens.ng/?tab=cbn',
    };

    const pdfBytes = await buildCbnDebtBriefPdfBytes(input);
    expect(new TextDecoder('ascii').decode(pdfBytes.slice(0, 5))).toBe('%PDF-');

    const docxBytes = await buildCbnDebtBriefDocxBytes(input);
    expect(docxBytes[0]).toBe(0x50);
    expect(docxBytes[1]).toBe(0x4b);
  }, 15_000);
});
