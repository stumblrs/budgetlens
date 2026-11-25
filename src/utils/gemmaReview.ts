export interface GemmaReviewPayload {
  recordId?: string;
  gemmaModelVersion: string;
  processedAt?: string;
  category?: {
    primaryCategory?: string;
    confidence?: number;
  };
  normalization?: {
    normalizedTitle?: string;
    wasNormalized?: boolean;
  };
  location?: {
    state?: string;
    lga?: string;
    geopoliticalZone?: string;
  };
  impact?: {
    sdgGoal?: string;
    assetType?: string;
    anomalyScore?: number;
    auditQuestion?: string;
    opportunityCostText?: string;
    foiSubjectLine?: string;
  };
  forensicTags?: string[];
  ambiguityDetection?: {
    isAmbiguous?: boolean;
    riskLevel?: string;
  };
  applicableRules?: string[];
  rationale?: string;
  developerDecision?: string;
}

/**
 * Validates that a Stage-2 Gemma enrichment object represents an actual completed AI review.
 * Explicitly rejects empty `{}` objects (legacy un-enriched DB rows) and `"UNAVAILABLE"` placeholders.
 */
export function isValidGemmaReview(review: unknown): review is GemmaReviewPayload {
  if (!review || typeof review !== 'object' || Array.isArray(review)) {
    return false;
  }
  const ver = (review as { gemmaModelVersion?: unknown }).gemmaModelVersion;
  return typeof ver === 'string' && ver.trim().length > 0 && ver.trim().toUpperCase() !== 'UNAVAILABLE';
}

/**
 * Resolves a verified Gemma review either from the lightweight record (`project.gemmaReview`)
 * or its matched full database record (`matchedDbRecord.gemmaAnalyticalOverlay`).
 */
export function resolveValidGemmaReview(
  project?: { gemmaReview?: unknown } | null,
  matchedDbRecord?: { gemmaAnalyticalOverlay?: unknown } | null
): GemmaReviewPayload | null {
  if (isValidGemmaReview(project?.gemmaReview)) {
    return project.gemmaReview;
  }
  if (isValidGemmaReview(matchedDbRecord?.gemmaAnalyticalOverlay)) {
    return matchedDbRecord.gemmaAnalyticalOverlay;
  }
  return null;
}
