import { describe, it, expect } from 'vitest';
import { isValidGemmaReview, resolveValidGemmaReview } from '../../src/utils/gemmaReview';

describe('gemmaReview resolution & empty-object guards', () => {
  it('rejects empty objects {}, null, undefined, and UNAVAILABLE model versions', () => {
    expect(isValidGemmaReview(undefined)).toBe(false);
    expect(isValidGemmaReview(null)).toBe(false);
    expect(isValidGemmaReview({})).toBe(false);
    expect(isValidGemmaReview([])).toBe(false);
    expect(isValidGemmaReview({ gemmaModelVersion: '' })).toBe(false);
    expect(isValidGemmaReview({ gemmaModelVersion: 'UNAVAILABLE' })).toBe(false);
    expect(isValidGemmaReview({ gemmaModelVersion: 'unavailable' })).toBe(false);
  });

  it('accepts genuine Stage-2 Gemma reviews', () => {
    const valid = {
      recordId: 'P-2009-00010',
      gemmaModelVersion: 'gemma-4-E2B',
      impact: { auditQuestion: 'Verify physical delivery on site.' },
    };
    expect(isValidGemmaReview(valid)).toBe(true);
  });

  it('prefers valid project.gemmaReview and falls back to matchedDbRecord.gemmaAnalyticalOverlay', () => {
    const direct = { gemmaModelVersion: 'gemma-4-E2B', impact: { sdgGoal: 'SDG 3' } };
    const fromDb = { gemmaModelVersion: 'gemma-4-E2B', impact: { sdgGoal: 'SDG 9' } };

    expect(resolveValidGemmaReview({ gemmaReview: direct }, { gemmaAnalyticalOverlay: fromDb })).toEqual(direct);
    expect(resolveValidGemmaReview({ gemmaReview: {} }, { gemmaAnalyticalOverlay: fromDb })).toEqual(fromDb);
    expect(resolveValidGemmaReview({}, { gemmaAnalyticalOverlay: fromDb })).toEqual(fromDb);
    expect(resolveValidGemmaReview(null, { gemmaAnalyticalOverlay: {} })).toBeNull();
    expect(resolveValidGemmaReview({ gemmaReview: { gemmaModelVersion: 'UNAVAILABLE' } }, { gemmaAnalyticalOverlay: null })).toBeNull();
  });
});
