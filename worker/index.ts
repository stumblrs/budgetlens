import { Hono } from 'hono';
import { cors } from 'hono/cors';

export interface WorkerEnv {
  DB_BUDGETS?: D1Database;
  DB_LEDGERS?: D1Database;
  DB_APP?: D1Database;
  ASSETS?: Fetcher;
  ENVIRONMENT?: string;
}

export const app = new Hono<{ Bindings: WorkerEnv }>();

app.use(
  '/api/*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

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

async function countTableRows(db: D1Database | undefined, table: 'budget_records' | 'nocopo_contracts' | 'app_datasets'): Promise<number | null> {
  if (!db) return null;
  try {
    const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
    return typeof row?.count === 'number' ? row.count : Number(row?.count ?? 0);
  } catch {
    return null;
  }
}

app.get('/api/v1/health', async (c) => {
  const deep = c.req.query('deep') === '1';
  const payload: {
    ok: boolean;
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
});

const PENDING_ENDPOINTS = [
  '/api/v1/years',
  '/api/v1/projects',
  '/api/v1/search',
  '/api/v1/debt',
  '/api/v1/cbn',
];

for (const route of PENDING_ENDPOINTS) {
  app.all(route, (c) =>
    c.json(
      {
        ok: false,
        status: 501,
        endpoint: route,
        error: 'Not Implemented — D1 database seeding and query handlers pending in P8-CP-2 / P8-CP-3.',
      },
      501
    )
  );
}

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
