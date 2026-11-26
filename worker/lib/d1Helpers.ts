export interface WorkerEnv {
  DB_BUDGETS?: D1Database;
  DB_LEDGERS?: D1Database;
  DB_APP?: D1Database;
  ASSETS?: Fetcher;
  ENVIRONMENT?: string;
  ADMIN_KEY?: string;
  IP_SALT?: string;
}

export const CACHE_PUBLIC_SHORT = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';

const FTS_RESERVED = new Set(['AND', 'OR', 'NOT', 'NEAR']);
const CORP_SUFFIX_RE =
  /\b(LIMITED|LTD|PLC|NIGERIA|NIG|INC|CO|COMPANY|ENTERPRISES|VENTURES|INTERNATIONAL|INTL|SERVICES|GROUP)\b/g;

const appDatasetCache = new WeakMap<
  D1Database,
  Map<string, { exp: number; data: unknown }>
>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 20;

export function sanitizeFtsQuery(raw: string): string {
  const tokens = (raw || '').match(/[A-Za-z0-9]+/g) || [];
  const cleaned = tokens.filter((t) => t.length >= 1 && !FTS_RESERVED.has(t.toUpperCase()));
  if (cleaned.length === 0) return '';
  return cleaned
    .slice(0, 10)
    .map((t) => `"${t}"*`)
    .join(' ');
}

export function normalizeEntityName(raw: string): string {
  return (raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\b(M\s*S|MS|MESSRS)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function canonicalContractorKey(raw: string): string {
  return normalizeEntityName(raw)
    .replace(CORP_SUFFIX_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatNairaShort(amount: number): string {
  const val = Math.round(amount || 0);
  if (Math.abs(val) >= 1_000_000_000_000) {
    return `₦${(val / 1e12).toFixed(2)} Trillion`;
  }
  if (Math.abs(val) >= 1_000_000_000) {
    return `₦${(val / 1e9).toFixed(2)} Billion`;
  }
  if (Math.abs(val) >= 1_000_000) {
    return `₦${(val / 1e6).toFixed(2)} Million`;
  }
  return `₦${val.toLocaleString('en-US')}`;
}

export function clampInt(
  raw: string | undefined,
  def: number,
  min: number,
  max: number
): number {
  if (raw === undefined || raw === '') return def;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return def;
  return Math.max(min, Math.min(max, parsed));
}

export async function loadAppDataset<T = unknown>(
  db: D1Database | undefined,
  key: string
): Promise<T | null> {
  if (!db) return null;

  let perDb = appDatasetCache.get(db);
  if (!perDb) {
    perDb = new Map();
    appDatasetCache.set(db, perDb);
  }

  const now = Date.now();
  const cached = perDb.get(key);
  if (cached && cached.exp > now) {
    perDb.delete(key);
    perDb.set(key, cached);
    return cached.data as T;
  }
  if (cached) {
    perDb.delete(key);
  }

  const meta = await db
    .prepare('SELECT chunk_count, payload_json FROM app_datasets WHERE dataset_key = ?')
    .bind(key)
    .first<{ chunk_count: number; payload_json: string | null }>();

  if (!meta) return null;

  let rawText: string | null = null;
  if (meta.chunk_count <= 1 && meta.payload_json !== null) {
    rawText = meta.payload_json;
  } else {
    const chunkRes = await db
      .prepare(
        'SELECT chunk_text FROM app_dataset_chunks WHERE dataset_key = ? ORDER BY chunk_index ASC'
      )
      .bind(key)
      .all<{ chunk_text: string }>();
    const rows = chunkRes.results || [];
    if (rows.length > 0) {
      rawText = rows.map((r) => r.chunk_text).join('');
    }
  }

  if (!rawText) return null;

  const parsed = JSON.parse(rawText) as T;
  if (perDb.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = perDb.keys().next().value;
    if (oldestKey !== undefined) perDb.delete(oldestKey);
  }
  perDb.set(key, { exp: now + CACHE_TTL_MS, data: parsed });
  return parsed;
}
