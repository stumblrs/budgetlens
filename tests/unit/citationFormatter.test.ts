import { describe, it, expect } from 'vitest';
import {
  formatRecordCitations,
  formatViewCitations,
  escapeBibtexValue,
  sanitizeBibtexKey,
  ResolvedRecordProvenance,
} from '../../src/utils/citationFormatter';

const sampleProvenance: ResolvedRecordProvenance = {
  filename: '2025 Appropriation ACT.pdf',
  sha256: 'e3afde2dce406a366c3a7a9dbec4adb125db9b25777fb02f033c4dad04ffa5cd',
  shortSha256: 'e3afde2dce406a36',
  fileCountForYear: 4,
  pageCount: 2185,
  enactedActTitle: '2025 Federal Appropriation Act',
  matchedExactFile: true,
};

describe('citationFormatter', () => {
  it('sanitizes BibTeX keys and escapes special TeX characters', () => {
    expect(sanitizeBibtexKey('FY-2025 / ERGP#123')).toBe('fy_2025_ergp_123');
    expect(sanitizeBibtexKey('---')).toBe('record');
    expect(escapeBibtexValue('Oil & Gas {Phase_1} 50% $100 #2')).toBe(
      'Oil \\& Gas \\{Phase\\_1\\} 50\\% \\$100 \\#2'
    );
  });

  it('generates Newsroom, APA 7, Chicago, and BibTeX record citations with SHA-256 and page provenance', () => {
    const cites = formatRecordCitations({
      financialYear: 2025,
      projectCode: 'ERGP2025991',
      projectName: 'Construction of Model Primary Healthcare Clinic & Solar Cold Chain',
      amountNaira: 450_000_000,
      agencyName: 'Federal Ministry of Health',
      page: 314,
      permalink: 'https://budgetlens.ng/?tab=projects&year=2025&item=ERGP2025991&page=314',
      provenance: sampleProvenance,
      accessedDate: new Date('2026-11-19T12:00:00Z'),
    });

    expect(cites.newsroom).toContain('2025 Appropriation ACT.pdf');
    expect(cites.newsroom).toContain('Schedule p. 314');
    expect(cites.newsroom).toContain('e3afde2dce406a36');
    expect(cites.apa).toContain('SHA-256: e3afde2dce406a366c3a7a9dbec4adb125db9b25777fb02f033c4dad04ffa5cd');
    expect(cites.chicago).toContain('Appropriation Line ERGP2025991');
    expect(cites.bibtex).toMatch(/^@misc\{budgetlens_fy2025_ergp2025991_p314,/);
    expect(cites.bibtex).toContain('\\&');
  });

  it('generates observatory view citations including active scrutiny filters', () => {
    const viewCites = formatViewCitations({
      activeTab: 'scrutiny',
      financialYear: 2024,
      permalink: 'https://budgetlens.ng/?tab=scrutiny&year=2024&president=tinubu&pillar=overhead',
      provenance: sampleProvenance,
      totalRecordsInYear: 43203,
      activeFilters: {
        president: 'tinubu',
        pillar: 'overhead',
        currency: 'usd',
      },
      accessedDate: new Date('2026-11-19T12:00:00Z'),
    });

    expect(viewCites.newsroom).toContain('Presidential Scrutiny Sweep');
    expect(viewCites.newsroom).toContain('President=tinubu');
    expect(viewCites.newsroom).toContain('43,203 extracted items');
    expect(viewCites.bibtex).toContain('Electronic Fiscal Observatory Dataset');
  });
});
