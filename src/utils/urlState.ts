export const VALID_TABS = new Set([
  'overview',
  'citizen',
  'oaugf',
  'compare',
  'scrutiny',
  'cbn',
  'trends',
  'execution',
  'projects',
  'agencies',
  'network',
  'map',
  'assets',
  'evidence',
  'rules',
  'duplicates',
  'anomalies',
  'recurring',
  'forensics',
  'padding',
  'record',
  'document',
  'ai',
  'reports',
  'casebook',
  'methodology',
]);

export const VALID_FORENSICS_SUBTABS = new Set([
  'benford',
  'replacement',
  'virements',
  'rings',
  'govspend',
]);

export type ForensicsSubTabKey = 'benford' | 'replacement' | 'virements' | 'rings' | 'govspend';

export const VALID_PRESIDENTS = new Set([
  'ALL',
  'obasanjo',
  'yaradua',
  'jonathan',
  'buhari',
  'tinubu',
]);

export const VALID_PILLARS = new Set([
  'oaugfAndCrossLedger',
  'vehicles',
  'mandates',
  'blankChecks',
  'disguised',
  'roundSplits',
  'overhead',
  'ceremonial',
  'intangible',
]);

export type ScrutinyPillarKey =
  | 'oaugfAndCrossLedger'
  | 'vehicles'
  | 'mandates'
  | 'blankChecks'
  | 'disguised'
  | 'roundSplits'
  | 'overhead'
  | 'ceremonial'
  | 'intangible';

export type ScrutinyCurrencyKey = 'usd' | 'nominal';

function parseBoundedYear(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 1999 || n > 2030) return null;
  return n;
}

export function parseInitialYearFromUrl(fallback = 2026): number {
  if (typeof window === 'undefined') return fallback;
  const params = new URLSearchParams(window.location.search);
  return parseBoundedYear(params.get('year')) ?? fallback;
}

export function readAppUrlState(search?: string): {
  tab: string;
  year: number | null;
  item: string | null;
  page: number | null;
  q: string;
} {
  const qs = search !== undefined ? search : typeof window !== 'undefined' ? window.location.search : '';
  const params = new URLSearchParams(qs);

  const rawTab = (params.get('tab') || '').trim().toLowerCase();
  const normalizedTab =
    rawTab === 'anomalies'
      ? 'map'
      : rawTab === 'governors' || rawTab === 'debt'
      ? 'cbn'
      : rawTab;
  const tab = VALID_TABS.has(normalizedTab) ? normalizedTab : 'overview';
  const year = parseBoundedYear(params.get('year'));

  const rawItem = (params.get('item') || '').trim();
  const item = rawItem ? rawItem : null;

  const rawPage = params.get('page');
  const parsedPage = rawPage ? Number(rawPage.trim()) : NaN;
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : null;

  const q = params.get('q') || '';

  return { tab, year, item, page, q };
}

export function readScrutinyUrlState(search?: string): {
  president: string;
  pillar: ScrutinyPillarKey;
  sy: 'ALL' | number;
  currency: ScrutinyCurrencyKey;
  sq: string;
} {
  const qs = search !== undefined ? search : typeof window !== 'undefined' ? window.location.search : '';
  const params = new URLSearchParams(qs);

  const rawPres = (params.get('president') || '').trim();
  const lowerPres = rawPres.toLowerCase();
  const president =
    rawPres === 'ALL' || lowerPres === 'all'
      ? 'ALL'
      : VALID_PRESIDENTS.has(lowerPres)
      ? lowerPres
      : 'ALL';

  const rawPillar = (params.get('pillar') || '').trim();
  const pillar: ScrutinyPillarKey = VALID_PILLARS.has(rawPillar)
    ? (rawPillar as ScrutinyPillarKey)
    : 'vehicles';

  const syRaw = parseBoundedYear(params.get('sy'));
  const sy: 'ALL' | number = syRaw ?? 'ALL';

  const rawCurr = (params.get('currency') || '').trim().toLowerCase();
  const currency: ScrutinyCurrencyKey = rawCurr === 'nominal' ? 'nominal' : 'usd';

  const sq = params.get('sq') || '';

  return { president, pillar, sy, currency, sq };
}

export function readForensicsUrlState(search?: string): { fsub: ForensicsSubTabKey } {
  const qs = search !== undefined ? search : typeof window !== 'undefined' ? window.location.search : '';
  const params = new URLSearchParams(qs);
  const raw = (params.get('fsub') || '').trim().toLowerCase();
  const fsub: ForensicsSubTabKey = VALID_FORENSICS_SUBTABS.has(raw)
    ? (raw as ForensicsSubTabKey)
    : 'benford';
  return { fsub };
}

export const VALID_PADDING_FILTERS = new Set([
  'all',
  'insertions',
  'inflated',
  'cut',
  'removed',
  'zip',
  'contracted',
]);

export type PaddingDiffFilterKey = 'all' | 'insertions' | 'inflated' | 'cut' | 'removed' | 'zip' | 'contracted';

export function readPaddingUrlState(search?: string): { diffFilter: PaddingDiffFilterKey } {
  const qs = search !== undefined ? search : typeof window !== 'undefined' ? window.location.search : '';
  const params = new URLSearchParams(qs);
  const raw = (params.get('diffFilter') || '').trim().toLowerCase();
  const diffFilter: PaddingDiffFilterKey = VALID_PADDING_FILTERS.has(raw)
    ? (raw as PaddingDiffFilterKey)
    : 'all';
  return { diffFilter };
}

export function syncUrlParams(
  updates: Record<string, string | number | null | undefined>,
  mode: 'push' | 'replace' = 'replace'
): string {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);

  for (const [key, val] of Object.entries(updates)) {
    if (val === null || val === undefined || val === '') {
      params.delete(key);
    } else {
      params.set(key, String(val));
    }
  }

  const nextSearch = params.toString();
  const currentSearch = window.location.search.replace(/^\?/, '');
  const nextRelativeUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;

  if (nextSearch !== currentSearch) {
    if (mode === 'push') {
      window.history.pushState(null, '', nextRelativeUrl);
    } else {
      window.history.replaceState(null, '', nextRelativeUrl);
    }
  }

  return `${window.location.origin}${nextRelativeUrl}`;
}

export function buildCanonicalPermalink(
  overrides: Record<string, string | number | null | undefined> = {}
): string {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  for (const [key, val] of Object.entries(overrides)) {
    if (val === null || val === undefined || val === '') {
      params.delete(key);
    } else {
      params.set(key, String(val));
    }
  }
  const qs = params.toString();
  return `${window.location.origin}${window.location.pathname}${qs ? `?${qs}` : ''}`;
}
