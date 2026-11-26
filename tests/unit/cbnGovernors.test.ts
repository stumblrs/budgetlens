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
  buildCbnDebtBriefSpec,
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
      expect(gov.efccRecord).toBeDefined();
      expect([
        'CHARGED_TRIAL_ONGOING',
        'INVESTIGATED_CLEARED',
        'SCRUTINIZED_NO_EFCC_CHARGE',
        'NO_EFCC_INVESTIGATION',
      ]).toContain(gov.efccRecord.status);
      expect(gov.efccRecord.badgeLabel.length).toBeGreaterThan(5);
      expect(gov.efccRecord.legalStatusNote.length).toBeGreaterThan(20);
      expect(gov.efccRecord.sources.length).toBeGreaterThanOrEqual(1);
      expect(gov.portraitPath).toMatch(/^\/governors\/[a-z0-9_]+\.jpg$/);

      const diskPath = path.join(publicDir, gov.portraitPath.replace(/^\//, ''));
      expect(fs.existsSync(diskPath), `Missing portrait: ${diskPath}`).toBe(true);
      const buf = fs.readFileSync(diskPath);
      expect(buf.length).toBeGreaterThan(5_000);
      // JPEG SOI magic bytes (0xFF, 0xD8)
      expect(buf[0]).toBe(0xff);
      expect(buf[1]).toBe(0xd8);
    });

    const emefiele = CBN_GOVERNORS.find((g) => g.id === 'emefiele')!;
    expect(emefiele.efccRecord.status).toBe('CHARGED_TRIAL_ONGOING');
    expect(emefiele.efccRecord.accusationScope.length).toBeGreaterThanOrEqual(3);
    const emefieleScopeText = emefiele.efccRecord.accusationScope.join(' ');
    expect(emefieleScopeText).toContain('$6.23 million');
    expect(emefieleScopeText).toContain('$4.5 billion');
    expect(emefieleScopeText).toContain('Naira redesign');

    const soludo = CBN_GOVERNORS.find((g) => g.id === 'soludo')!;
    expect(soludo.efccRecord.status).toBe('INVESTIGATED_CLEARED');
    expect(soludo.efccRecord.legalStatusNote).toContain('2015');
    expect(soludo.efccRecord.accusationScope.join(' ')).toContain('Securency');

    const sanusi = CBN_GOVERNORS.find((g) => g.id === 'sls_sanusi')!;
    expect(sanusi.efccRecord.status).toBe('SCRUTINIZED_NO_EFCC_CHARGE');
    expect(sanusi.efccRecord.legalStatusNote).toContain('unlawful');
    expect(sanusi.efccRecord.legalStatusNote).toContain('Never criminally charged');

    const cardoso = CBN_GOVERNORS.find((g) => g.id === 'cardoso')!;
    expect(cardoso.efccRecord.status).toBe('NO_EFCC_INVESTIGATION');
    expect(cardoso.efccRecord.legalStatusNote).toContain('partnered with the EFCC');

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

    const spec = buildCbnDebtBriefSpec(input);
    expect(spec.tables.some((t) => t.heading.includes('EFCC & Anti-Graft Investigation Records'))).toBe(true);

    const pdfBytes = await buildCbnDebtBriefPdfBytes(input);
    expect(new TextDecoder('ascii').decode(pdfBytes.slice(0, 5))).toBe('%PDF-');

    const docxBytes = await buildCbnDebtBriefDocxBytes(input);
    expect(docxBytes[0]).toBe(0x50);
    expect(docxBytes[1]).toBe(0x4b);
  }, 15_000);
});
