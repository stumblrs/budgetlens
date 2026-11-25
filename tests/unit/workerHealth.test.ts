import { describe, expect, it } from 'vitest';
import { app } from '../../worker/index';

describe('Cloudflare Worker API Skeleton (P8-CP-1)', () => {
  it('responds 200 OK on /api/v1/health with runtime and binding telemetry', async () => {
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      service: string;
      runtime: string;
      environment: string;
      bindings: Record<string, boolean>;
    };
    expect(body.ok).toBe(true);
    expect(body.service).toBe('budgetlens-api');
    expect(body.runtime).toBe('cloudflare-workers');
    expect(body.bindings).toEqual({
      budgets: false,
      ledgers: false,
      app: false,
    });
  });

  it('responds 501 structured JSON on unseeded D1 endpoints such as /api/v1/projects', async () => {
    const res = await app.request('/api/v1/projects');
    expect(res.status).toBe(501);
    const body = (await res.json()) as {
      ok: boolean;
      status: number;
      endpoint: string;
      error: string;
    };
    expect(body.ok).toBe(false);
    expect(body.status).toBe(501);
    expect(body.endpoint).toBe('/api/v1/projects');
    expect(body.error).toMatch(/P8-CP-2/i);
  });
});
