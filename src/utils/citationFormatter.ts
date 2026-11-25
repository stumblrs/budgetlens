import { getMacroForYear } from '../data/historicalMacroData';
import { getPresidentForYear } from '../data/presidentialTerms';
import type { RegistryDocument } from '../services/budgetDatabaseEngine';

export type CitationStyle = 'newsroom' | 'apa' | 'chicago' | 'bibtex';

export interface SourceFileProvenance {
  filename: string;
  sha256: string;
  shortSha256: string;
  totalRecords: number;
  status: string;
  ingestedAt?: string;
}

export interface YearProvenanceManifest {
  year: number;
  fileCount: number;
  totalRecords: number;
  pageCount?: number;
  scheduleStatus?: string;
  primaryFile: SourceFileProvenance;
  files: SourceFileProvenance[];
}

export interface ExternalSourceFileEntry {
  relativePath: string;
  filename: string;
  bytes: number;
  sha256: string;
  shortSha256: string;
}

export interface ExternalSourceBucket {
  rootDir: string;
  fileCount: number;
  totalBytes: number;
  files: ExternalSourceFileEntry[];
}

export interface CrossLedgerDatasetProvenanceEntry {
  filename?: string;
  bytes?: number;
  sha256?: string;
  shortSha256?: string;
  shardCount?: number;
  totalBytes?: number;
}

export interface ProvenanceManifestResponse {
  generatedAt: string;
  sourceRegistry: string;
  totalFiles: number;
  yearCount: number;
  years: Record<string, YearProvenanceManifest>;
  externalSources?: Record<string, ExternalSourceBucket>;
  phase3Datasets?: Record<string, CrossLedgerDatasetProvenanceEntry>;
}

export interface ResolvedRecordProvenance {
  filename: string;
  sha256: string | null;
  shortSha256: string | null;
  recordHash?: string | null;
  ingestedAt?: string;
  fileCountForYear: number;
  pageCount?: number;
  enactedActTitle: string;
  matchedExactFile: boolean;
}

export interface RecordCitationInput {
  financialYear: number;
  projectCode: string;
  projectName: string;
  amountNaira: number;
  agencyName: string;
  page: number;
  state?: string;
  permalink: string;
  provenance: ResolvedRecordProvenance;
  accessedDate?: Date;
}

export interface ViewCitationInput {
  activeTab: string;
  financialYear: number;
  permalink: string;
  provenance: ResolvedRecordProvenance;
  totalIndexedYears?: number;
  totalRecordsInYear?: number;
  activeFilters?: {
    president?: string;
    pillar?: string;
    scrutinyYear?: string;
    currency?: string;
    forensicsSubTab?: string;
    diffFilter?: string;
    searchQuery?: string;
  };
  accessedDate?: Date;
}

export const CITATION_STYLES: ReadonlyArray<{
  id: CitationStyle;
  label: string;
  shortLabel: string;
  audience: string;
}> = [
  { id: 'newsroom', label: 'Newsroom / Press', shortLabel: 'Newsroom', audience: 'Journalists & fact-checkers' },
  { id: 'apa', label: 'APA 7th Edition', shortLabel: 'APA 7', audience: 'Academic papers & policy briefs' },
  { id: 'chicago', label: 'Chicago / Legal', shortLabel: 'Chicago / Legal', audience: 'Legislative & court filings' },
  { id: 'bibtex', label: 'BibTeX', shortLabel: 'BibTeX', audience: 'LaTeX & reference managers' },
];

export const OBSERVATORY_MODULE_LABELS: Record<
  string,
  { group: string; label: string; description: string }
> = {
  overview: {
    group: 'Observatory',
    label: 'Executive Overview',
    description: 'Federal Appropriation Summary, Macro Narrative & Risk Indicators',
  },
  citizen: {
    group: 'Observatory',
    label: 'Citizen Tax & Area Accountability Hub',
    description: 'Personal Federal Tax Receipt (PITA PAYE + 7.5% VAT), Neighborhood Project Lookup & Elected Representatives Directory',
  },
  oaugf: {
    group: 'Observatory',
    label: 'OAuGF Constitutional Audit & 6-Ledger Convergence Explorer',
    description: 'Auditor-General for the Federation (OAuGF) Constitutional Audit Findings (1999–2024), Repeat Neglect, Recovery Orders & 6-Ledger Red-Flag Convergence',
  },
  compare: {
    group: 'Observatory',
    label: '1999–2026 Presidential Compare',
    description: 'Cross-Administration Fiscal Expenditure & Governance Ledger (Fourth Republic)',
  },
  scrutiny: {
    group: 'Observatory',
    label: 'Presidential Scrutiny Sweep',
    description: 'Year-Native Econometric Audit of Public-Interest Red Flags Across Administrations',
  },
  trends: {
    group: 'Observatory',
    label: 'Spending Trends',
    description: 'Multi-Year Nominal & Constant-Value Expenditure Trajectory (1999–2026)',
  },
  execution: {
    group: 'Observatory',
    label: 'Execution & Contracts',
    description: 'Enacted vs. Actual Capital Releases (BIR/OAGF) & NOCOPO/CAC Procurement Bridge',
  },
  projects: {
    group: 'Budget Explorer',
    label: 'Capital Projects',
    description: 'Searchable Line-Item Schedule of Federal Appropriation Projects',
  },
  agencies: {
    group: 'Budget Explorer',
    label: 'Ministries & MDAs',
    description: 'Ministry, Department & Agency Budget Allocation & Execution Hierarchy',
  },
  network: {
    group: 'Budget Explorer',
    label: 'Ministries & MDAs',
    description: 'Ministry, Department & Agency Budget Allocation & Execution Hierarchy',
  },
  map: {
    group: 'Budget Explorer',
    label: 'Geo & Anomaly Map',
    description: 'Unified 36-State + FCT, 774-LGA & 6-Zone Budgeted vs. Contracted vs. Disbursed Intelligence',
  },
  assets: {
    group: 'Budget Explorer',
    label: 'Asset Inventory',
    description: 'Extracted Physical Asset, Vehicle & Equipment Procurement Schedule',
  },
  evidence: {
    group: 'Forensic Lab',
    label: 'Evidence Engine',
    description: 'Rule-Verified Budget Anomaly & Compliance Flag Evidence',
  },
  rules: {
    group: 'Forensic Lab',
    label: 'Evidence Engine',
    description: 'Rule-Verified Budget Anomaly & Compliance Flag Evidence',
  },
  duplicates: {
    group: 'Forensic Lab',
    label: 'Duplicate Detector',
    description: 'Near-Identical & Split-Line Appropriation Cluster Audit',
  },
  anomalies: {
    group: 'Budget Explorer',
    label: 'Geo & Anomaly Map',
    description: 'Unified 36-State + FCT, 774-LGA & 6-Zone Budgeted vs. Contracted vs. Disbursed Intelligence',
  },
  recurring: {
    group: 'Forensic Lab',
    label: 'Recurring Lineages',
    description: 'Multi-Year Repeated Capital Project Lineage Tracker',
  },
  forensics: {
    group: 'Forensic Lab',
    label: 'Statistical Forensics Lab',
    description:
      "Benford's Law MAD Audit, Premature Asset Replacement, Virement & Contingency Tracking, and Coordinated Duplicate Rings",
  },
  padding: {
    group: 'Forensic Lab',
    label: 'Bill vs. Act Diff',
    description:
      'Executive Appropriation Bill vs. Enacted Appropriation Act Legislative Padding & Delta Audit (2017–2025)',
  },
  record: {
    group: 'Budget Explorer',
    label: 'Official Record Dossier',
    description: 'Standalone Full-Viewport Appropriation Line-Item Dossier & Schedule Context',
  },
  ai: {
    group: 'Forensic Lab',
    label: 'AI Assistant',
    description: 'Grounded Natural-Language Query Assistant Over Official Schedules',
  },
  reports: {
    group: 'Publish & Cite',
    label: 'Reports & Export',
    description: 'Executive Briefing & Statutory Document Publisher',
  },
  casebook: {
    group: 'Publish & Cite',
    label: 'Investigator Casebook',
    description: 'Multi-Year Evidence Basket, Analyst Annotations & Exportable Investigative Dossiers',
  },
  methodology: {
    group: 'Publish & Cite',
    label: 'Sources & Methodology',
    description: 'Cryptographic Source Provenance Registry & Year-Native Fiscal Methodology',
  },
};

const STOP_TOKENS = new Set([
  'federal',
  'ministry',
  'min',
  'of',
  'and',
  'the',
  'for',
  'affairs',
  'commission',
  'service',
  'services',
  'office',
  'national',
  'development',
  'department',
  'agency',
  'board',
  'pdf',
]);

let provenanceCachePromise: Promise<ProvenanceManifestResponse | null> | null = null;

/**
 * Fetches `/datasets/source_provenance.json` once and caches the result.
 * Resets cache if fetch fails so a subsequent modal open can retry.
 */
export async function loadSourceProvenance(): Promise<ProvenanceManifestResponse | null> {
  if (typeof fetch === 'undefined') return null;
  if (!provenanceCachePromise) {
    provenanceCachePromise = fetch('/datasets/source_provenance.json', { cache: 'no-cache' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<ProvenanceManifestResponse>;
      })
      .catch(() => {
        provenanceCachePromise = null;
        return null;
      });
  }
  return provenanceCachePromise;
}

/** Derives an authoritative legislative title from fiscal year and filename. */
export function getEnactedActTitle(year: number, filename?: string): string {
  const lower = (filename || '').toLowerCase();
  if (lower.includes('supplementary')) {
    return `FY ${year} Supplementary Appropriation Act, Federal Republic of Nigeria`;
  }
  if (lower.includes('appropriation bill details')) {
    return `FY ${year} Federal Appropriation Bill Details, Federal Republic of Nigeria`;
  }
  if (lower.includes('appropriation bill')) {
    return `FY ${year} Federal Appropriation Bill, Federal Republic of Nigeria`;
  }
  if (lower.includes('amended') || lower.includes('amendment') || lower.includes('revised')) {
    return `FY ${year} Amended Federal Appropriation Act, Federal Republic of Nigeria`;
  }
  return `FY ${year} Federal Appropriation Act, Federal Republic of Nigeria`;
}

function normalizeBasename(raw?: string): string {
  if (!raw) return '';
  const parts = raw.trim().split(/[/\\]/);
  return parts[parts.length - 1].toLowerCase();
}

function tokenizeSignificant(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((tok) => tok.length >= 3 && !STOP_TOKENS.has(tok) && !/^\d{4}$/.test(tok));
}

function findMatchingFileForAgency(
  files: SourceFileProvenance[],
  agencyName: string
): SourceFileProvenance | null {
  if (files.length <= 1 || !agencyName) return null;
  const agencyTokens = tokenizeSignificant(agencyName);
  if (agencyTokens.length === 0) return null;

  let bestScore = 0;
  let bestFile: SourceFileProvenance | null = null;
  let tied = false;

  for (const file of files) {
    const fileTokens = new Set(tokenizeSignificant(file.filename));
    let score = 0;
    for (const tok of agencyTokens) {
      if (fileTokens.has(tok)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestFile = file;
      tied = false;
    } else if (score > 0 && score === bestScore) {
      tied = true;
    }
  }

  return bestScore > 0 && !tied ? bestFile : null;
}

/** Resolves primary year-level cryptographic provenance from the manifest and registry doc. */
export function resolveYearProvenance(
  manifest: ProvenanceManifestResponse | null,
  year: number,
  registryDoc?: RegistryDocument
): ResolvedRecordProvenance {
  const yearEntry = manifest?.years?.[String(year)];
  const primary = yearEntry?.primaryFile;
  const fallbackFile =
    primary?.filename ||
    registryDoc?.source_files?.[0] ||
    `FY ${year} Federal Appropriation Schedule.pdf`;

  return {
    filename: fallbackFile,
    sha256: primary?.sha256 || null,
    shortSha256: primary?.shortSha256 || (primary?.sha256 ? primary.sha256.slice(0, 16) : null),
    ingestedAt: primary?.ingestedAt || registryDoc?.ingested_at,
    fileCountForYear: yearEntry?.fileCount ?? registryDoc?.source_files?.length ?? 1,
    pageCount: yearEntry?.pageCount ?? registryDoc?.page_count,
    enactedActTitle: getEnactedActTitle(year, fallbackFile),
    matchedExactFile: Boolean(primary),
  };
}

/**
 * Matches a budget record to its ingested PDF provenance file and 64-char SHA-256 hash.
 * Order: exact filename match -> unambiguous MDA filename token match -> year primary file.
 */
export function resolveRecordProvenance(
  manifest: ProvenanceManifestResponse | null,
  year: number,
  opts: {
    sourceFilename?: string;
    agencyName?: string;
    recordSha256?: string;
    registryDoc?: RegistryDocument;
  } = {}
): ResolvedRecordProvenance {
  const yearEntry = manifest?.years?.[String(year)];
  const files = yearEntry?.files || [];
  const targetBase = normalizeBasename(opts.sourceFilename);

  let matched: SourceFileProvenance | null = null;
  let matchedExact = false;

  if (targetBase && files.length > 0) {
    matched = files.find((f) => normalizeBasename(f.filename) === targetBase) || null;
    if (matched) matchedExact = true;
  }

  if (!matched && opts.agencyName && files.length > 0) {
    matched = findMatchingFileForAgency(files, opts.agencyName);
    if (matched) matchedExact = true;
  }

  if (!matched && yearEntry?.primaryFile) {
    matched = yearEntry.primaryFile;
  }

  const resolvedFilename =
    matched?.filename ||
    opts.sourceFilename ||
    opts.registryDoc?.source_files?.[0] ||
    `FY ${year} Federal Appropriation Schedule.pdf`;

  return {
    filename: resolvedFilename,
    sha256: matched?.sha256 || null,
    shortSha256: matched?.shortSha256 || (matched?.sha256 ? matched.sha256.slice(0, 16) : null),
    recordHash: opts.recordSha256 || null,
    ingestedAt: matched?.ingestedAt || opts.registryDoc?.ingested_at,
    fileCountForYear: yearEntry?.fileCount ?? opts.registryDoc?.source_files?.length ?? 1,
    pageCount: yearEntry?.pageCount ?? opts.registryDoc?.page_count,
    enactedActTitle: getEnactedActTitle(year, resolvedFilename),
    matchedExactFile: matchedExact,
  };
}

function formatAccessDates(date?: Date): {
  usLong: string;
  chicago: string;
  iso: string;
  yearNum: number;
} {
  const d = date ?? new Date();
  const monthsLong = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const monthsShort = [
    'Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June',
    'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.',
  ];
  const yyyy = d.getUTCFullYear();
  const mmIdx = d.getUTCMonth();
  const dd = d.getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');

  return {
    usLong: `${monthsLong[mmIdx]} ${dd}, ${yyyy}`,
    chicago: `${monthsShort[mmIdx]} ${dd}, ${yyyy}`,
    iso: `${yyyy}-${pad(mmIdx + 1)}-${pad(dd)}`,
    yearNum: yyyy,
  };
}

function formatNairaAndUsd(amountNaira: number, year: number): {
  naira: string;
  usd: string;
  fxRate: number;
} {
  const macro = getMacroForYear(year);
  const fxRate = macro.fxNairaPerUsd || 1500;
  const usdVal = amountNaira / fxRate;
  const naira = `₦${Math.round(amountNaira).toLocaleString('en-US')}`;
  const usd =
    usdVal >= 100
      ? `$${Math.round(usdVal).toLocaleString('en-US')}`
      : `$${usdVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return { naira, usd, fxRate };
}

function cleanText(text: string, maxLen = 220): string {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 1).trimEnd()}…`;
}

export function sanitizeBibtexKey(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'record';
}

export function escapeBibtexValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/([{}%&#_$])/g, '\\$1');
}

function shaLabel(prov: ResolvedRecordProvenance, full = false): string {
  if (!prov.sha256) return 'SHA-256: registry digest pending';
  if (full) return `SHA-256: ${prov.sha256}`;
  return `SHA-256: ${prov.shortSha256 || prov.sha256.slice(0, 16)}…`;
}

/** Formats Newsroom, APA 7, Chicago / Legal, and BibTeX citations for one line item. */
export function formatRecordCitations(input: RecordCitationInput): Record<CitationStyle, string> {
  const dates = formatAccessDates(input.accessedDate);
  const pres = getPresidentForYear(input.financialYear);
  const money = formatNairaAndUsd(input.amountNaira, input.financialYear);
  const code = (input.projectCode || 'LINE-ITEM').trim();
  const title = cleanText(input.projectName, 180);
  const agency = cleanText(input.agencyName || 'Federal Ministry / MDA', 120);
  const shaShort = shaLabel(input.provenance, false);
  const shaFull = shaLabel(input.provenance, true);
  const bibKey = sanitizeBibtexKey(`budgetlens_fy${input.financialYear}_${code}_p${input.page}`);

  const newsroom =
    `Source: Budget Office of the Federation (Nigeria), "${input.provenance.filename}" ` +
    `(FY ${input.financialYear}, ${pres.presidentName} Administration), Schedule p. ${input.page}, ` +
    `Line Code ${code} ("${title}"), Executing MDA: ${agency}, Allocation: ${money.naira} ` +
    `(${money.usd} at FY ${input.financialYear} CBN rate ₦${money.fxRate.toLocaleString('en-US')}/US$1). ` +
    `Indexed by BudgetLens Civic Fiscal Observatory (${shaShort}; accessed ${dates.usLong}). ` +
    `${input.permalink}`;

  const apa =
    `Budget Office of the Federation, Federal Republic of Nigeria. (${input.financialYear}). ` +
    `${input.provenance.enactedActTitle} [Budget line item ${code}: "${title}"; ${agency}; ` +
    `Schedule p. ${input.page}; ${money.naira} / ${money.usd}]. In BudgetLens Civic Fiscal Observatory ` +
    `(${pres.presidentName} Administration, source file ${input.provenance.filename}, ${shaFull}). ` +
    `Retrieved ${dates.usLong}, from ${input.permalink}`;

  const chicago =
    `Federal Republic of Nigeria, Budget Office of the Federation, ${input.provenance.enactedActTitle} ` +
    `(${input.financialYear}), "${input.provenance.filename}," Schedule p. ${input.page}, ` +
    `Appropriation Line ${code} ("${title}"), Executing Agency: ${agency}, ` +
    `Allocated ${money.naira} (${money.usd}; ${pres.presidentName} Administration; ${shaShort}), ` +
    `verified on BudgetLens Civic Fiscal Observatory, accessed ${dates.chicago}, ${input.permalink}.`;

  const bibtexNote = escapeBibtexValue(
    `Executing MDA: ${agency}; Allocation: ${money.naira} (${money.usd} at FY ${input.financialYear} FX ₦${money.fxRate}/USD); ` +
      `Administration: ${pres.presidentName} (${pres.termLabel}); Source PDF: ${input.provenance.filename} (p. ${input.page}); ` +
      `${shaFull}; Accessed: ${dates.iso}`
  );

  const bibtex = [
    `@misc{${bibKey},`,
    `  author       = {{Budget Office of the Federation, Federal Republic of Nigeria}},`,
    `  title        = {{${escapeBibtexValue(`FY ${input.financialYear} Appropriation Line ${code}: ${title}`)}}},`,
    `  year         = {${input.financialYear}},`,
    `  howpublished = {BudgetLens Civic Fiscal Observatory},`,
    `  note         = {${bibtexNote}},`,
    `  url          = {${input.permalink}}`,
    `}`,
  ].join('\n');

  return { newsroom, apa, chicago, bibtex };
}

function summarizeActiveFilters(filters?: ViewCitationInput['activeFilters']): string {
  if (!filters) return '';
  const parts: string[] = [];
  if (filters.president && filters.president.toUpperCase() !== 'ALL') {
    parts.push(`President=${filters.president}`);
  }
  if (filters.pillar) parts.push(`Pillar=${filters.pillar}`);
  if (filters.scrutinyYear && filters.scrutinyYear.toUpperCase() !== 'ALL') {
    parts.push(`ScrutinyYear=${filters.scrutinyYear}`);
  }
  if (filters.currency) parts.push(`Currency=${filters.currency.toUpperCase()}`);
  if (filters.forensicsSubTab) parts.push(`ForensicsPillar=${filters.forensicsSubTab}`);
  if (filters.diffFilter) parts.push(`DiffFilter=${filters.diffFilter}`);
  if (filters.searchQuery?.trim()) parts.push(`Query="${cleanText(filters.searchQuery, 48)}"`);
  return parts.join(', ');
}

/** Formats Newsroom, APA 7, Chicago / Legal, and BibTeX citations for the active Observatory view. */
export function formatViewCitations(input: ViewCitationInput): Record<CitationStyle, string> {
  const dates = formatAccessDates(input.accessedDate);
  const pres = getPresidentForYear(input.financialYear);
  const mod = OBSERVATORY_MODULE_LABELS[input.activeTab] || OBSERVATORY_MODULE_LABELS.overview;
  const filterSummary = summarizeActiveFilters(input.activeFilters);
  const filterClause = filterSummary ? ` [Filters: ${filterSummary}]` : '';
  const fileCountNote =
    input.provenance.fileCountForYear > 1
      ? ` (+${input.provenance.fileCountForYear - 1} related FY ${input.financialYear} schedules)`
      : '';
  const recordsNote =
    typeof input.totalRecordsInYear === 'number' && input.totalRecordsInYear > 0
      ? `, ${input.totalRecordsInYear.toLocaleString('en-US')} extracted items`
      : '';
  const shaShort = shaLabel(input.provenance, false);
  const shaFull = shaLabel(input.provenance, true);
  const bibKey = sanitizeBibtexKey(`budgetlens_${input.activeTab}_fy${input.financialYear}`);

  const newsroom =
    `Source: BudgetLens Civic Fiscal Observatory, "${mod.label}" (${mod.group}) — FY ${input.financialYear} ` +
    `(${pres.presidentName} Administration${filterClause}). Compiled from official Budget Office of the Federation ` +
    `PDF schedule "${input.provenance.filename}"${fileCountNote}${recordsNote} (${shaShort}; accessed ${dates.usLong}). ` +
    `${input.permalink}`;

  const apa =
    `BudgetLens Civic Fiscal Observatory. (${dates.yearNum}). ${mod.label}: ${mod.description} ` +
    `[FY ${input.financialYear}; ${pres.presidentName} Administration${filterSummary ? `; ${filterSummary}` : ''}]. ` +
    `Derived from Budget Office of the Federation, "${input.provenance.filename}"${fileCountNote} (${shaFull}). ` +
    `Retrieved ${dates.usLong}, from ${input.permalink}`;

  const chicago =
    `BudgetLens Civic Fiscal Observatory, "${mod.label}" (${mod.group}), FY ${input.financialYear} ` +
    `(${pres.presidentName} Administration${filterSummary ? `; ${filterSummary}` : ''}), ` +
    `sourced from Federal Republic of Nigeria, Budget Office of the Federation, ` +
    `"${input.provenance.filename}"${fileCountNote} (${shaShort}), accessed ${dates.chicago}, ${input.permalink}.`;

  const bibtexNote = escapeBibtexValue(
    `Module: ${mod.group} / ${mod.label}; Administration: ${pres.presidentName} (${pres.termLabel}); ` +
      `Primary Schedule: ${input.provenance.filename}${fileCountNote}${recordsNote}; ` +
      `${filterSummary ? `Active Filters: ${filterSummary}; ` : ''}${shaFull}; Accessed: ${dates.iso}`
  );

  const bibtex = [
    `@misc{${bibKey},`,
    `  author       = {{BudgetLens Civic Fiscal Observatory}},`,
    `  title        = {{${escapeBibtexValue(`${mod.label} — FY ${input.financialYear} Nigeria Federal Budget`)}}},`,
    `  year         = {${input.financialYear}},`,
    `  howpublished = {Electronic Fiscal Observatory Dataset},`,
    `  note         = {${bibtexNote}},`,
    `  url          = {${input.permalink}}`,
    `}`,
  ].join('\n');

  return { newsroom, apa, chicago, bibtex };
}
