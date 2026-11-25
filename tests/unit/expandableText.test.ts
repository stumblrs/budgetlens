import { describe, expect, it } from 'vitest';
import { truncateAtWordBoundary } from '../../src/components/ExpandableText';

describe('ExpandableText truncation utility', () => {
  it('leaves short descriptions untouched without truncation', () => {
    const shortText = 'Construction of solar borehole in Kano';
    const res = truncateAtWordBoundary(shortText, 160);
    expect(res.isTruncated).toBe(false);
    expect(res.preview).toBe(shortText);
  });

  it('truncates long multi-clause project descriptions cleanly on a word boundary', () => {
    const longRailText =
      '1. COMPLETION OF ABUJA-KADUNA RAILWAY PROJECT. 2. COMPLETION OF LAGOS - IBADAN AND ITS ASSOCIATED ADDITIONAL WORKS. 3. REHABILITATION OF ITAKPE - AJAOKUTA RAIL LINE AND CONSTRUCTION OF 12 NOS STATION BUILDINGS AND TRACK LAYING WORKS AT RAILWAY ANCILLARY FACILITIES AREAS AGBOR. 4. COMPLETION OF ADDENDUM 2A AND RAILWAY ANCILLARY FACILITIES AREAS AGBOR. 5. DESIGN, MANUFACTURE, SUPPLY AND INSTALLATION OF ROLLING STOCK, SUPPLY OF SPARE PARTS AND MAINTENANCE EQUIPMENTS FOR THE ONGOING RAILWAY MODERNIZATION PROJECT.';

    const res = truncateAtWordBoundary(longRailText, 160);
    expect(res.isTruncated).toBe(true);
    expect(res.preview.endsWith('…')).toBe(true);
    expect(res.preview.length).toBeLessThanOrEqual(161);
    expect(res.preview).toContain('ABUJA-KADUNA RAILWAY PROJECT');
  });
});
