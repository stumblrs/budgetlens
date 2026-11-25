/**
 * Shared presentation-layer entity display cleanup & fiscal coverage disclosure helpers.
 *
 * Governance rule: cleanEntityDisplayName() is intended strictly for human-readable
 * MDA, agency, contractor, and beneficiary display cells/charts while leaving verbatim
 * source project descriptions, PDF citations, and SHA-256 digests unaltered.
 */

export type CoverageTier = 'FULL_SCHEDULE' | 'PARTIAL_SCHEDULE' | 'SUMMARY_ACT_ONLY';
export type CoverageTone = 'emerald' | 'amber' | 'slate' | 'blue';

export interface CoverageAuditYearLike {
  coverage_tier?: CoverageTier | string | null;
  extracted_ratio_pct?: number | null;
  non_rollup_ratio_pct?: number | null;
  over_100_pct_flag?: boolean | null;
  extracted_breakdown_note?: string | null;
  diagnostic_note?: string | null;
  extracted_count?: number | null;
  project_count?: number | null;
  extractedProjectsCount?: number | null;
  birQuarterCovered?: string | null;
  birIsPartialYear?: boolean | null;
  birCoverageNote?: string | null;
}

export interface CoverageAuditIndexPayload {
  years?: Record<string, CoverageAuditYearLike>;
  over_100_pct_years?: Array<Record<string, unknown>>;
}

export interface CoverageCaveatMeta {
  year: number;
  tier: CoverageTier;
  label: string;
  shortBadge: string;
  detail: string;
  hasCaveat: boolean;
  partialLedgerNotes: string[];
  birPartialNote: string | null;
  treasuryPartialNote: string | null;
  tone: CoverageTone;
  bg: string;
  color: string;
  border: string;
}

const MOJIBAKE_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ['\u00c3\u00a2\u00e2\u0082\u00ac\u00e2\u0084\u00a2', "'"],
  ['\u00c3\u0084\u00c2\u00bb', "'"],
  ['\u00c4\u00bb', "'"],
  ['\u00e2\u0080\u0099', "'"],
  ['\u00e2\u0080\u0098', "'"],
  ['\u00e2\u0080\u009c', '"'],
  ['\u00e2\u0080\u009d', '"'],
  ['\u00e2\u0080\u0093', '-'],
  ['\u00e2\u0080\u0094', '-'],
  ['\u00c2\u00a0', ' '],
  ['\u00c2 ', ' '],
  ['\u00a0', ' '],
];

const TYPO_RULES: ReadonlyArray<{
  pattern: RegExp;
  upper: string;
  title: string;
  lower: string;
}> = [
  { pattern: /\bUNIVERSITYOF\b/gi, upper: 'UNIVERSITY OF', title: 'University of', lower: 'university of' },
  { pattern: /\bMANAGEMANT\b/gi, upper: 'MANAGEMENT', title: 'Management', lower: 'management' },
  { pattern: /\bHEADQU(?:R|A)TERS\b/gi, upper: 'HEADQUARTERS', title: 'Headquarters', lower: 'headquarters' },
  { pattern: /\bMINSITRY\b/gi, upper: 'MINISTRY', title: 'Ministry', lower: 'ministry' },
];

const SUMMARY_ACT_ONLY_YEARS = new Set<number>([2000, 2001, 2002, 2003, 2005, 2007]);

const PARTIAL_SCHEDULE_YEARS: Record<number, number> = {
  2006: 100.8,
  2011: 23.9,
  2015: 29.3,
};

const PARTIAL_BIR_DEFAULT_NOTES: Record<number, string> = {
  2010: 'BIR FY 2010 covers Q2 Half-Year YTD only.',
  2014: 'BIR FY 2014 covers Q2 Half-Year YTD only; full-year Q4 outturn not published.',
  2020: 'BIR FY 2020 covers Q3 YTD execution.',
  2025: 'BIR FY 2025 covers Q2 Half-Year YTD execution.',
  2026: 'BIR FY 2026 covers Q2 Half-Year YTD execution.',
};

const PARTIAL_TREASURY_NOTES: Record<number, string> = {
  2018: 'Open Treasury (GovSpend) FY 2018 is a partial boundary calendar year (excluded from December Rush baseline).',
  2026: 'Open Treasury (GovSpend) FY 2026 is an in-progress partial calendar year (excluded from December Rush baseline).',
};

let cachedCoverageAuditPromise: Promise<CoverageAuditIndexPayload | null> | null = null;

/** Repairs common UTF-8/Windows-1252 mojibake sequences and normalizes smart typography. */
export function repairMojibake(raw: string | null | undefined): string {
  let text = String(raw ?? '');
  if (!text) return '';
  for (const [bad, good] of MOJIBAKE_REPLACEMENTS) {
    if (text.includes(bad)) {
      text = text.split(bad).join(good);
    }
  }
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-');
}

/**
 * Cleans entity display names (MDAs, ministries, contractors, beneficiaries) for UI and export
 * tables by fixing mojibake, verified source typos, excess whitespace, and dangling punctuation.
 */
export function cleanEntityDisplayName(raw: string | null | undefined): string {
  const repaired = repairMojibake(raw).trim();
  if (!repaired) return '';

  let out = repaired;
  for (const rule of TYPO_RULES) {
    out = out.replace(rule.pattern, (token) => {
      if (token === token.toUpperCase()) return rule.upper;
      if (token[0] === token[0].toUpperCase()) return rule.title;
      return rule.lower;
    });
  }

  return out
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s,\-;:/]+$/g, '')
    .trim();
}

/**
 * Resolves standardized schedule coverage tier metadata plus BIR & Treasury partial-year
 * disclaimers for a given fiscal year and optional audit/registry record.
 */
export function getCoverageCaveatMeta(
  year: number,
  coverageAuditEntry?: CoverageAuditYearLike | null
): CoverageCaveatMeta {
  const count =
    coverageAuditEntry?.extracted_count ??
    coverageAuditEntry?.project_count ??
    coverageAuditEntry?.extractedProjectsCount ??
    null;

  const explicitTier = coverageAuditEntry?.coverage_tier;
  const tier: CoverageTier =
    explicitTier === 'FULL_SCHEDULE' ||
    explicitTier === 'PARTIAL_SCHEDULE' ||
    explicitTier === 'SUMMARY_ACT_ONLY'
      ? explicitTier
      : SUMMARY_ACT_ONLY_YEARS.has(year)
        ? 'SUMMARY_ACT_ONLY'
        : year in PARTIAL_SCHEDULE_YEARS
          ? 'PARTIAL_SCHEDULE'
          : typeof count === 'number' && count > 0 && count < 250
            ? 'SUMMARY_ACT_ONLY'
            : 'FULL_SCHEDULE';

  let birPartialNote: string | null = null;
  if (coverageAuditEntry?.birCoverageNote) {
    birPartialNote = coverageAuditEntry.birCoverageNote;
  } else if (coverageAuditEntry?.birIsPartialYear === true) {
    birPartialNote =
      PARTIAL_BIR_DEFAULT_NOTES[year] ||
      `BIR FY ${year} (${coverageAuditEntry.birQuarterCovered || 'Partial-Year'}) does not publish a full Q4 annual outturn.`;
  } else if (coverageAuditEntry?.birIsPartialYear === false) {
    birPartialNote = null;
  } else {
    birPartialNote = PARTIAL_BIR_DEFAULT_NOTES[year] ?? null;
  }

  const treasuryPartialNote = PARTIAL_TREASURY_NOTES[year] ?? null;
  const partialLedgerNotes = [birPartialNote, treasuryPartialNote].filter(
    (note): note is string => Boolean(note && note.trim())
  );

  if (tier === 'SUMMARY_ACT_ONLY') {
    const countText =
      typeof count === 'number' && count > 0
        ? ` (${count.toLocaleString('en-US')} summary lines)`
        : '';
    const detail = `FY ${year} uses the statutory Summary Appropriation Act${countText}; granular MDA project schedules were not published.${
      partialLedgerNotes.length > 0 ? ` ${partialLedgerNotes.join(' ')}` : ''
    }`;
    return {
      year,
      tier,
      label: 'Summary Act Only',
      shortBadge: 'Summary Act',
      detail,
      hasCaveat: true,
      partialLedgerNotes,
      birPartialNote,
      treasuryPartialNote,
      tone: 'slate',
      bg: '#f1f5f9',
      color: '#334155',
      border: '#cbd5e1',
    };
  }

  if (tier === 'PARTIAL_SCHEDULE') {
    const ratio =
      typeof coverageAuditEntry?.extracted_ratio_pct === 'number'
        ? coverageAuditEntry.extracted_ratio_pct
        : PARTIAL_SCHEDULE_YEARS[year] ?? null;
    const label =
      ratio !== null && ratio < 95
        ? `Partial Schedule (${ratio.toFixed(1)}%)`
        : 'Partial Schedule';
    const baseDetail =
      coverageAuditEntry?.diagnostic_note ||
      coverageAuditEntry?.extracted_breakdown_note ||
      `FY ${year} reflects partial schedule recovery${
        ratio !== null ? ` (${ratio.toFixed(1)}% of macro total)` : ''
      }${
        typeof count === 'number' && count > 0
          ? ` across ${count.toLocaleString('en-US')} extracted items`
          : ''
      }.`;
    const detail =
      partialLedgerNotes.length > 0
        ? `${baseDetail} ${partialLedgerNotes.join(' ')}`
        : baseDetail;
    return {
      year,
      tier,
      label,
      shortBadge: 'Partial',
      detail,
      hasCaveat: true,
      partialLedgerNotes,
      birPartialNote,
      treasuryPartialNote,
      tone: 'amber',
      bg: '#fffbeb',
      color: '#92400e',
      border: '#fde68a',
    };
  }

  const ratio =
    typeof coverageAuditEntry?.extracted_ratio_pct === 'number'
      ? coverageAuditEntry.extracted_ratio_pct
      : null;
  const over100 = Boolean(
    coverageAuditEntry?.over_100_pct_flag || (ratio !== null && ratio > 105)
  );
  const hasCaveat = over100 || partialLedgerNotes.length > 0;
  const detailParts: string[] = [];

  if (over100 && coverageAuditEntry?.extracted_breakdown_note) {
    detailParts.push(
      `FY ${year} extracted ratio exceeds 100% because it ${coverageAuditEntry.extracted_breakdown_note}`
    );
  } else if (over100) {
    detailParts.push(
      `FY ${year} merges multiple source Appropriation PDFs or includes MDA administrative roll-up rows above the 100% baseline.`
    );
  } else if (typeof count === 'number' && count > 0) {
    detailParts.push(
      `FY ${year} includes full granular appropriation schedules (${count.toLocaleString('en-US')} verified line items).`
    );
  } else {
    detailParts.push(`FY ${year} includes full granular federal appropriation schedules.`);
  }

  if (partialLedgerNotes.length > 0) {
    detailParts.push(...partialLedgerNotes);
  }

  return {
    year,
    tier: 'FULL_SCHEDULE',
    label: 'Full Schedule',
    shortBadge: 'Full',
    detail: detailParts.join(' '),
    hasCaveat,
    partialLedgerNotes,
    birPartialNote,
    treasuryPartialNote,
    tone: 'emerald',
    bg: '#ecfdf5',
    color: '#065f46',
    border: '#a7f3d0',
  };
}

/** Loads and caches the static coverage_audit.json index in browser contexts. */
export async function loadCoverageAuditIndex(): Promise<CoverageAuditIndexPayload | null> {
  if (typeof fetch !== 'function') return null;
  if (!cachedCoverageAuditPromise) {
    cachedCoverageAuditPromise = fetch('/datasets/coverage_audit.json', { cache: 'no-cache' })
      .then((res) => (res.ok ? (res.json() as Promise<CoverageAuditIndexPayload>) : null))
      .catch(() => null);
  }
  return cachedCoverageAuditPromise;
}
