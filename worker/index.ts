import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { WorkerEnv } from './lib/d1Helpers';
import { aiRouter } from './routes/ai';
import { civicRouter } from './routes/civic';
import { debtAndCbnRouter } from './routes/debtAndCbn';
import { mdasAndForensicsRouter } from './routes/mdasAndForensics';
import { projectsRouter } from './routes/projects';
import { searchRouter } from './routes/search';
import { yearsRouter } from './routes/years';

export type { WorkerEnv };

export const app = new Hono<{ Bindings: WorkerEnv }>();

app.use(
  '/api/*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key', 'X-Share-Token'],
  })
);

const UNCACHEABLE_API_PREFIXES = [
  '/api/health',
  '/api/v1/health',
  '/api/tips',
  '/api/v1/tips',
  '/api/casebooks',
  '/api/v1/casebooks',
];

app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET') {
    await next();
    return;
  }
  const path = c.req.path;
  if (UNCACHEABLE_API_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    await next();
    return;
  }

  const edgeCache =
    typeof caches !== 'undefined'
      ? (caches as unknown as { default?: Cache }).default
      : undefined;
  if (!edgeCache) {
    await next();
    return;
  }

  const cacheKey = new Request(c.req.url, { method: 'GET' });
  const cached = await edgeCache.match(cacheKey);
  if (cached) {
    const hitHeaders = new Headers(cached.headers);
    if (!hitHeaders.has('Access-Control-Allow-Origin')) {
      hitHeaders.set('Access-Control-Allow-Origin', '*');
    }
    return new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers: hitHeaders,
    });
  }

  await next();

  if (
    c.res.status === 200 &&
    (c.res.headers.get('Cache-Control') || '').includes('public')
  ) {
    const toCache = c.res.clone();
    try {
      c.executionCtx.waitUntil(edgeCache.put(cacheKey, toCache));
    } catch {
      void edgeCache.put(cacheKey, toCache);
    }
  }
});

app.onError((err, c) => {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'worker_unhandled_error',
      path: c.req.path,
      method: c.req.method,
      message: err.message,
    })
  );
  return c.json(
    {
      ok: false,
      error: 'Internal Server Error',
      path: c.req.path,
    },
    500
  );
});

async function countTableRows(
  db: D1Database | undefined,
  table: 'budget_records' | 'nocopo_contracts' | 'app_datasets'
): Promise<number | null> {
  if (!db) return null;
  try {
    const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
    return typeof row?.count === 'number' ? row.count : Number(row?.count ?? 0);
  } catch {
    return null;
  }
}

async function healthHandler(c: {
  env?: WorkerEnv;
  req: { query: (k: string) => string | undefined };
  json: (data: unknown, status?: number) => Response;
}) {
  const deep = c.req.query('deep') === '1';
  const payload: {
    ok: boolean;
    status: string;
    ftsDbReady: boolean;
    service: string;
    runtime: string;
    environment: string;
    bindings: {
      budgets: boolean;
      ledgers: boolean;
      app: boolean;
    };
    counts?: {
      budget_records: number | null;
      nocopo_contracts: number | null;
      app_datasets: number | null;
    };
  } = {
    ok: true,
    status: 'ok',
    ftsDbReady: Boolean(c.env?.DB_BUDGETS),
    service: 'budgetlens-api',
    runtime: 'cloudflare-workers',
    environment: c.env?.ENVIRONMENT || 'development',
    bindings: {
      budgets: Boolean(c.env?.DB_BUDGETS),
      ledgers: Boolean(c.env?.DB_LEDGERS),
      app: Boolean(c.env?.DB_APP),
    },
  };

  if (deep) {
    const [budget_records, nocopo_contracts, app_datasets] = await Promise.all([
      countTableRows(c.env?.DB_BUDGETS, 'budget_records'),
      countTableRows(c.env?.DB_LEDGERS, 'nocopo_contracts'),
      countTableRows(c.env?.DB_APP, 'app_datasets'),
    ]);
    payload.counts = { budget_records, nocopo_contracts, app_datasets };
  }

  return c.json(payload);
}

app.get('/api/v1/health', healthHandler);
app.get('/api/health', healthHandler);

const apiRoutes = new Hono<{ Bindings: WorkerEnv }>();
apiRoutes.route('/', yearsRouter);
apiRoutes.route('/', projectsRouter);
apiRoutes.route('/', searchRouter);
apiRoutes.route('/', mdasAndForensicsRouter);
apiRoutes.route('/', debtAndCbnRouter);
apiRoutes.route('/', aiRouter);
apiRoutes.route('/', civicRouter);

app.route('/api/v1', apiRoutes);
app.route('/api', apiRoutes);

app.all('/api/*', (c) =>
  c.json(
    {
      ok: false,
      error: 'API route not found',
      path: c.req.path,
    },
    404
  )
);

app.all('*', async (c) => {
  if (c.env?.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.json({ ok: false, error: 'Static asset binding not configured' }, 404);
});

export default app;
