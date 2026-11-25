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

app.get('/api/v1/health', (c) => {
  return c.json({
    ok: true,
    service: 'budgetlens-api',
    runtime: 'cloudflare-workers',
    environment: c.env?.ENVIRONMENT || 'development',
    bindings: {
      budgets: Boolean(c.env?.DB_BUDGETS),
      ledgers: Boolean(c.env?.DB_LEDGERS),
      app: Boolean(c.env?.DB_APP),
    },
  });
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
