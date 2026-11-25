const rawBase =
  (import.meta as { env?: Record<string, string | undefined> }).env
    ?.VITE_API_BASE_URL || '';

export const API_BASE_URL = String(rawBase).replace(/\/+$/, '');

interface CacheEntry {
  exp: number;
  promise: Promise<unknown>;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 64;
const datasetCache = new Map<string, CacheEntry>();

export function clearApiClientCache(): void {
  datasetCache.clear();
}

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
}

export function normalizeDatasetKey(datasetPath: string): string {
  const [rawPath] = datasetPath.split('?');
  let key = rawPath.replace(/^\/+/, '').replace(/^datasets\//i, '').replace(/\.json$/i, '');
  if (key === 'db/hierarchy_summary') key = 'hierarchy_summary';
  if (key === 'bill_act_diffs/index') key = 'bill_act_diffs_index';
  return key;
}

export function datasetUrl(datasetPath: string): string {
  const [rawPath, rawQuery] = datasetPath.split('?');
  const key = normalizeDatasetKey(rawPath);
  let querySuffix = '';
  if (rawQuery) {
    const params = new URLSearchParams(rawQuery);
    params.delete('t');
    const serialized = params.toString();
    if (serialized) querySuffix = `?${serialized}`;
  }
  return apiUrl(`/api/v1/datasets/${key}${querySuffix}`);
}

export async function fetchApiJson<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<T | null> {
  try {
    const res = await fetch(apiUrl(path), init);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function fetchDataset<T = unknown>(
  datasetKeyOrPath: string,
  forceRefresh = false
): Promise<T | null> {
  const key = normalizeDatasetKey(datasetKeyOrPath);
  const now = Date.now();
  const cached = datasetCache.get(key);
  if (!forceRefresh && cached && cached.exp > now) {
    return cached.promise as Promise<T | null>;
  }

  const url = forceRefresh
    ? `${datasetUrl(key)}?t=${now}`
    : datasetUrl(key);

  const promise = fetch(url, forceRefresh ? { cache: 'no-store' } : { cache: 'no-cache' })
    .then((res) => (res.ok ? (res.json() as Promise<T>) : null))
    .catch(() => {
      datasetCache.delete(key);
      return null;
    });

  if (datasetCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = datasetCache.keys().next().value;
    if (oldest !== undefined) datasetCache.delete(oldest);
  }
  datasetCache.set(key, { exp: now + CACHE_TTL_MS, promise });
  return promise;
}
