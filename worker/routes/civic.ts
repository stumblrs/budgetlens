import { Hono } from 'hono';
import { WorkerEnv, clampInt } from '../lib/d1Helpers';

export const civicRouter = new Hono<{ Bindings: WorkerEnv }>();

const LEGAL_DISCLAIMER =
  'Citizen Field Observation (Unverified Independent Report — Subject to Corroboration & Official BPP/Contractor Right-of-Reply)';

const ALLOWED_STATUSES = new Set([
  'VERIFIED_ON_GROUND',
  'NOT_ON_GROUND',
  'ABANDONED_SITE',
  'STALLED_PARTIAL',
  'SUBSTANTIAL_COMPLETION',
  'OTHER_OBSERVATION',
]);
const ALLOWED_MODERATION = new Set([
  'UNVERIFIED',
  'CORROBORATED',
  'OFFICIAL_REPLY',
  'REJECTED',
]);
const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES_D1 = 400 * 1024;
const SAFE_FILENAME_RE = /^[a-f0-9-]{8,64}\.(jpg|jpeg|png|webp)$/;

function bytesToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(digest);
}

async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const ua = new Uint8Array(da);
  const ub = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < ua.length; i++) {
    diff |= ua[i] ^ ub[i];
  }
  return diff === 0;
}

export function detectMagicImageFormat(raw: Uint8Array): 'JPEG' | 'PNG' | 'WEBP' | null {
  if (raw.length >= 3 && raw[0] === 0xff && raw[1] === 0xd8 && raw[2] === 0xff) {
    return 'JPEG';
  }
  if (
    raw.length >= 8 &&
    raw[0] === 0x89 &&
    raw[1] === 0x50 &&
    raw[2] === 0x4e &&
    raw[3] === 0x47 &&
    raw[4] === 0x0d &&
    raw[5] === 0x0a &&
    raw[6] === 0x1a &&
    raw[7] === 0x0a
  ) {
    return 'PNG';
  }
  if (
    raw.length >= 12 &&
    raw[0] === 0x52 &&
    raw[1] === 0x49 &&
    raw[2] === 0x46 &&
    raw[3] === 0x46 &&
    raw[8] === 0x57 &&
    raw[9] === 0x45 &&
    raw[10] === 0x42 &&
    raw[11] === 0x50
  ) {
    return 'WEBP';
  }
  return null;
}

/** Strip JPEG APP1 (EXIF/GPS/XMP) and APP2..APP15/COM segments in pure Worker bytes. */
export function stripImageMetadata(raw: Uint8Array, fmt: 'JPEG' | 'PNG' | 'WEBP'): Uint8Array {
  if (fmt !== 'JPEG') return raw;
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i + 1 < raw.length) {
    if (raw[i] !== 0xff) {
      for (let k = i; k < raw.length; k++) out.push(raw[k]);
      break;
    }
    const marker = raw[i + 1];
    if (marker === 0xda) {
      // SOS (Start of Scan): copy remainder of entropy-coded stream verbatim
      for (let k = i; k < raw.length; k++) out.push(raw[k]);
      break;
    }
    if (marker === 0xd9) {
      out.push(0xff, 0xd9);
      break;
    }
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(0xff, marker);
      i += 2;
      continue;
    }
    if (i + 3 >= raw.length) break;
    const segLen = (raw[i + 2] << 8) | raw[i + 3];
    if (segLen < 2 || i + 2 + segLen > raw.length) {
      for (let k = i; k < raw.length; k++) out.push(raw[k]);
      break;
    }
    // Drop APP1 (EXIF/GPS = 0xE1), APP13 (IPTC = 0xED), and COM (0xFE)
    const dropSegment = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!dropSegment) {
      for (let k = i; k < i + 2 + segLen; k++) out.push(raw[k]);
    }
    i += 2 + segLen;
  }
  return new Uint8Array(out);
}

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

interface TipRow {
  tip_id: string;
  project_id: string;
  financial_year: number;
  project_code: string;
  state: string;
  lga: string;
  status: string;
  observation: string;
  reporter_alias: string;
  photos_json: string;
  corroborations: number;
  moderation_status: string;
  moderation_note: string;
  created_at_iso: string;
}

function rowToPublicTip(row: TipRow) {
  let photos: string[] = [];
  try {
    photos = JSON.parse(row.photos_json || '[]') as string[];
  } catch {
    photos = [];
  }
  return {
    tip_id: row.tip_id,
    project_id: row.project_id,
    financial_year: row.financial_year,
    project_code: row.project_code,
    state: row.state,
    lga: row.lga,
    status: row.status,
    observation: row.observation,
    reporter_alias: row.reporter_alias,
    photos: photos.map((name) => `/api/tips/photos/${name}`),
    corroborations: Number(row.corroborations || 0),
    moderation_status: row.moderation_status,
    moderation_note: row.moderation_note,
    created_at_iso: row.created_at_iso,
  };
}

const PUBLIC_TIP_COLS =
  'tip_id, project_id, financial_year, project_code, state, lga, status, observation, reporter_alias, photos_json, corroborations, moderation_status, moderation_note, created_at_iso';

civicRouter.get('/tips', async (c) => {
  const db = c.env?.DB_APP;
  if (!db) {
    return c.json({ ok: false, error: 'DB_APP binding unavailable' }, 503);
  }

  const projectId = (c.req.query('project_id') || '').trim();
  const yearRaw = c.req.query('year');
  const state = (c.req.query('state') || '').trim();
  const status = (c.req.query('status') || '').trim();
  const includeRejected = ['1', 'true', 'yes'].includes(
    (c.req.query('include_rejected') || '').toLowerCase()
  );
  const limit = clampInt(c.req.query('limit'), 25, 1, 100);

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (projectId) {
    clauses.push('project_id = ?');
    params.push(projectId);
  }
  if (yearRaw) {
    const yr = Number.parseInt(yearRaw, 10);
    if (Number.isFinite(yr)) {
      clauses.push('financial_year = ?');
      params.push(yr);
    }
  }
  if (state) {
    clauses.push('LOWER(state) = ?');
    params.push(state.toLowerCase());
  }
  if (status) {
    clauses.push('UPPER(status) = ?');
    params.push(status.toUpperCase());
  }
  if (!includeRejected) {
    clauses.push("moderation_status != 'REJECTED'");
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rowsRes = await db
    .prepare(
      `SELECT ${PUBLIC_TIP_COLS} FROM citizen_tips ${whereSql} ORDER BY corroborations DESC, created_at_iso DESC LIMIT ?`
    )
    .bind(...params, limit)
    .all<TipRow>();

  const tips = (rowsRes.results || []).map(rowToPublicTip);
  return c.json({
    total: tips.length,
    tips,
    legal_disclaimer: LEGAL_DISCLAIMER,
  });
});

civicRouter.post('/tips', async (c) => {
  const db = c.env?.DB_APP;
  if (!db) {
    return c.json({ ok: false, error: 'DB_APP binding unavailable' }, 503);
  }

  const contentType = (c.req.header('content-type') || '').toLowerCase();
  let projectId = '';
  let financialYear = 0;
  let status = '';
  let observation = '';
  let projectCode = '';
  let state = '';
  let lga = '';
  let reporterAlias = 'Anonymous Citizen';
  const uploadedPhotos: Blob[] = [];

  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    projectId = String(form.get('project_id') || '');
    financialYear = Number.parseInt(String(form.get('financial_year') || '0'), 10);
    status = String(form.get('status') || '');
    observation = String(form.get('observation') || '');
    projectCode = String(form.get('project_code') || '');
    state = String(form.get('state') || '');
    lga = String(form.get('lga') || '');
    reporterAlias = String(form.get('reporter_alias') || 'Anonymous Citizen');
    for (const entry of form.getAll('photos')) {
      if (
        typeof entry !== 'string' &&
        typeof (entry as Blob).arrayBuffer === 'function' &&
        (entry as Blob).size > 0
      ) {
        uploadedPhotos.push(entry as Blob);
      }
    }
  } else {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: 'Invalid request body' }, 400);
    }
    projectId = String(body.project_id || '');
    financialYear = Number(body.financial_year || 0);
    status = String(body.status || '');
    observation = String(body.observation || '');
    projectCode = String(body.project_code || '');
    state = String(body.state || '');
    lga = String(body.lga || '');
    reporterAlias = String(body.reporter_alias || 'Anonymous Citizen');
  }

  const cleanStatus = status.trim().toUpperCase();
  if (!ALLOWED_STATUSES.has(cleanStatus)) {
    return c.json(
      { ok: false, error: 'Invalid field observation status.' },
      400
    );
  }
  const cleanObs = observation.trim();
  if (cleanObs.length < 10 || cleanObs.length > 2000) {
    return c.json(
      { ok: false, error: 'Observation text must be between 10 and 2000 characters.' },
      400
    );
  }
  if (!Number.isFinite(financialYear) || financialYear < 1999 || financialYear > 2030) {
    return c.json(
      { ok: false, error: 'financial_year must be between 1999 and 2030.' },
      400
    );
  }
  if (uploadedPhotos.length > MAX_PHOTOS) {
    return c.json(
      { ok: false, error: `Maximum ${MAX_PHOTOS} photo attachments allowed per tip.` },
      400
    );
  }

  const rawIp =
    c.req.header('cf-connecting-ip') ||
    (c.req.header('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown';
  const salt = c.env?.IP_SALT || 'budgetlens-ng-field-tips-salt';
  const ipHash = await sha256Hex(`${salt}:${rawIp}`);

  const nowEpoch = Date.now() / 1000;
  const cutoff = nowEpoch - 3600;
  await db
    .prepare('DELETE FROM tip_rate_limits WHERE created_epoch < ?')
    .bind(cutoff)
    .run();
  const rlRow = await db
    .prepare(
      'SELECT COUNT(*) AS cnt FROM tip_rate_limits WHERE ip_hash = ? AND created_epoch >= ?'
    )
    .bind(ipHash, cutoff)
    .first<{ cnt: number }>();
  if (Number(rlRow?.cnt ?? 0) >= 12) {
    return c.json(
      { ok: false, error: 'Rate limit exceeded for citizen field submissions.' },
      429
    );
  }
  await db
    .prepare('INSERT INTO tip_rate_limits (ip_hash, created_epoch) VALUES (?, ?)')
    .bind(ipHash, nowEpoch)
    .run();

  const tipId = `tip-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const nowIso = new Date().toISOString();
  const savedFilenames: string[] = [];

  for (const file of uploadedPhotos) {
    const rawBytes = new Uint8Array(await file.arrayBuffer());
    if (rawBytes.length > MAX_PHOTO_BYTES_D1) {
      return c.json(
        { ok: false, error: 'Uploaded photo exceeds 400 KB D1 free-tier limit.' },
        413
      );
    }
    const fmt = detectMagicImageFormat(rawBytes);
    if (!fmt) {
      return c.json(
        {
          ok: false,
          error: 'Unsupported image file. Only JPEG, PNG, and WEBP magic bytes are accepted.',
        },
        400
      );
    }
    const scrubbed = stripImageMetadata(rawBytes, fmt);
    const ext = fmt === 'JPEG' ? 'jpg' : fmt.toLowerCase();
    const mimeType = fmt === 'JPEG' ? 'image/jpeg' : `image/${ext}`;
    const filename = `${crypto.randomUUID().replace(/-/g, '')}.${ext}`;
    const b64 = uint8ToBase64(scrubbed);
    await db
      .prepare(
        'INSERT INTO tip_photos (filename, tip_id, mime_type, byte_size, data_base64, created_at_iso) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(filename, tipId, mimeType, scrubbed.length, b64, nowIso)
      .run();
    savedFilenames.push(filename);
  }

  await db
    .prepare(
      `
      INSERT INTO citizen_tips (
        tip_id, project_id, financial_year, project_code, state, lga,
        status, observation, reporter_alias, photos_json,
        corroborations, moderation_status, moderation_note, ip_hash, created_at_iso
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'UNVERIFIED', '', ?, ?)
      `
    )
    .bind(
      tipId,
      projectId.trim().slice(0, 120),
      financialYear,
      projectCode.trim().slice(0, 80),
      state.trim().slice(0, 60),
      lga.trim().slice(0, 80),
      cleanStatus,
      cleanObs,
      (reporterAlias.trim() || 'Anonymous Citizen').slice(0, 80),
      JSON.stringify(savedFilenames),
      ipHash,
      nowIso
    )
    .run();

  const inserted = await db
    .prepare(`SELECT ${PUBLIC_TIP_COLS} FROM citizen_tips WHERE tip_id = ?`)
    .bind(tipId)
    .first<TipRow>();

  return c.json(
    {
      tip: inserted ? rowToPublicTip(inserted) : null,
      legal_disclaimer: LEGAL_DISCLAIMER,
    },
    201
  );
});

civicRouter.get('/tips/photos/:filename', async (c) => {
  const filename = (c.req.param('filename') || '').trim();
  if (!SAFE_FILENAME_RE.test(filename)) {
    return c.json({ ok: false, error: 'Invalid photo filename.' }, 400);
  }
  const db = c.env?.DB_APP;
  if (!db) {
    return c.json({ ok: false, error: 'DB_APP binding unavailable' }, 503);
  }
  const row = await db
    .prepare('SELECT mime_type, data_base64 FROM tip_photos WHERE filename = ?')
    .bind(filename)
    .first<{ mime_type: string; data_base64: string }>();
  if (!row) {
    return c.json({ ok: false, error: 'Tip photo not found.' }, 404);
  }
  const bytes = base64ToUint8(row.data_base64);
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': row.mime_type,
      'Content-Security-Policy': "default-src 'none'",
      'Cache-Control': 'public, max-age=86400',
    },
  });
});

civicRouter.post('/tips/:tipId/corroborate', async (c) => {
  const db = c.env?.DB_APP;
  if (!db) {
    return c.json({ ok: false, error: 'DB_APP binding unavailable' }, 503);
  }
  const tipId = (c.req.param('tipId') || '').trim();
  const res = await db
    .prepare('UPDATE citizen_tips SET corroborations = corroborations + 1 WHERE tip_id = ?')
    .bind(tipId)
    .run();
  if (!res.meta?.changes) {
    return c.json({ ok: false, error: 'Citizen tip not found.' }, 404);
  }
  const updated = await db
    .prepare(`SELECT ${PUBLIC_TIP_COLS} FROM citizen_tips WHERE tip_id = ?`)
    .bind(tipId)
    .first<TipRow>();
  return c.json({
    tip: updated ? rowToPublicTip(updated) : null,
    legal_disclaimer: LEGAL_DISCLAIMER,
  });
});

civicRouter.patch('/tips/:tipId/moderation', async (c) => {
  const db = c.env?.DB_APP;
  if (!db) {
    return c.json({ ok: false, error: 'DB_APP binding unavailable' }, 503);
  }
  const envName = (c.env?.ENVIRONMENT || 'development').toLowerCase();
  const expectedKey =
    c.env?.ADMIN_KEY ||
    (envName === 'development' || envName === 'test' ? 'dev-admin-key-change-me' : '');
  const providedKey = c.req.header('x-admin-key') || '';
  if (!expectedKey || !providedKey || !(await constantTimeEqual(providedKey, expectedKey))) {
    return c.json({ ok: false, error: 'Invalid or missing X-Admin-Key.' }, 403);
  }

  let body: { moderation_status?: unknown; moderation_note?: unknown };
  try {
    body = (await c.req.json()) as { moderation_status?: unknown; moderation_note?: unknown };
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON request body' }, 400);
  }
  const cleanMod = String(body.moderation_status || '').trim().toUpperCase();
  if (!ALLOWED_MODERATION.has(cleanMod)) {
    return c.json({ ok: false, error: 'Invalid moderation_status.' }, 400);
  }
  const cleanNote = String(body.moderation_note || '').slice(0, 500);
  const tipId = (c.req.param('tipId') || '').trim();

  const res = await db
    .prepare(
      'UPDATE citizen_tips SET moderation_status = ?, moderation_note = ? WHERE tip_id = ?'
    )
    .bind(cleanMod, cleanNote, tipId)
    .run();
  if (!res.meta?.changes) {
    return c.json({ ok: false, error: 'Citizen tip not found.' }, 404);
  }
  const updated = await db
    .prepare(`SELECT ${PUBLIC_TIP_COLS} FROM citizen_tips WHERE tip_id = ?`)
    .bind(tipId)
    .first<TipRow>();
  return c.json({
    tip: updated ? rowToPublicTip(updated) : null,
    legal_disclaimer: LEGAL_DISCLAIMER,
  });
});

civicRouter.post('/casebooks', async (c) => {
  const db = c.env?.DB_APP;
  if (!db) {
    return c.json({ ok: false, error: 'DB_APP binding unavailable' }, 503);
  }

  let body: {
    casebookId?: unknown;
    title?: unknown;
    pins?: unknown;
    notes?: unknown;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON request body' }, 400);
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title.length < 2 || title.length > 160) {
    return c.json({ ok: false, error: 'Casebook title must be 2–160 characters.' }, 400);
  }

  const payloadObj = {
    pins: Array.isArray(body.pins) ? body.pins : [],
    notes: typeof body.notes === 'string' ? body.notes : '',
  };
  const payloadJson = JSON.stringify(payloadObj);
  if (payloadJson.length > 250 * 1024) {
    return c.json({ ok: false, error: 'Casebook payload exceeds 250 KB limit.' }, 413);
  }

  const nowIso = new Date().toISOString();
  const casebookId =
    typeof body.casebookId === 'string' && body.casebookId.trim()
      ? body.casebookId.trim().slice(0, 64)
      : `cb-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

  const existing = await db
    .prepare('SELECT share_token, created_at_iso FROM casebooks WHERE casebook_id = ?')
    .bind(casebookId)
    .first<{ share_token: string; created_at_iso: string }>();

  const shareToken =
    existing?.share_token || crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const createdAtIso = existing?.created_at_iso || nowIso;

  await db
    .prepare(
      `
      INSERT INTO casebooks (casebook_id, title, share_token, payload_json, created_at_iso, updated_at_iso)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(casebook_id) DO UPDATE SET
        title = excluded.title,
        payload_json = excluded.payload_json,
        updated_at_iso = excluded.updated_at_iso
      `
    )
    .bind(casebookId, title, shareToken, payloadJson, createdAtIso, nowIso)
    .run();

  return c.json(
    {
      ok: true,
      casebookId,
      shareToken,
      title,
      createdAtIso,
      updatedAtIso: nowIso,
    },
    201
  );
});

civicRouter.get('/casebooks/:idOrToken', async (c) => {
  const db = c.env?.DB_APP;
  if (!db) {
    return c.json({ ok: false, error: 'DB_APP binding unavailable' }, 503);
  }
  const key = (c.req.param('idOrToken') || '').trim();
  const row = await db
    .prepare(
      'SELECT casebook_id, title, share_token, payload_json, created_at_iso, updated_at_iso FROM casebooks WHERE casebook_id = ? OR share_token = ? LIMIT 1'
    )
    .bind(key, key)
    .first<{
      casebook_id: string;
      title: string;
      share_token: string;
      payload_json: string;
      created_at_iso: string;
      updated_at_iso: string;
    }>();

  if (!row) {
    return c.json({ ok: false, error: 'Casebook not found.' }, 404);
  }

  const parsedPayload = JSON.parse(row.payload_json) as {
    pins?: unknown[];
    notes?: string;
  };
  return c.json({
    ok: true,
    casebook: {
      casebookId: row.casebook_id,
      title: row.title,
      shareToken: row.share_token,
      pins: parsedPayload.pins || [],
      notes: parsedPayload.notes || '',
      createdAtIso: row.created_at_iso,
      updatedAtIso: row.updated_at_iso,
    },
  });
});

civicRouter.delete('/casebooks/:id', async (c) => {
  const db = c.env?.DB_APP;
  if (!db) {
    return c.json({ ok: false, error: 'DB_APP binding unavailable' }, 503);
  }
  const casebookId = (c.req.param('id') || '').trim();
  const row = await db
    .prepare('SELECT share_token FROM casebooks WHERE casebook_id = ?')
    .bind(casebookId)
    .first<{ share_token: string }>();
  if (!row) {
    return c.json({ ok: false, error: 'Casebook not found.' }, 404);
  }

  const provided =
    c.req.header('x-share-token') || c.req.query('share_token') || '';
  if (!provided || !(await constantTimeEqual(provided, row.share_token))) {
    return c.json({ ok: false, error: 'Invalid or missing share token.' }, 403);
  }

  await db.prepare('DELETE FROM casebooks WHERE casebook_id = ?').bind(casebookId).run();
  return c.json({ ok: true, deleted: casebookId });
});
