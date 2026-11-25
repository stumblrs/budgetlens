import { describe, expect, it } from 'vitest';
import { app } from '../../worker/index';

describe('Cloudflare Worker Health & Binding Guards', () => {
  it('responds 200 OK on /api/v1/health and /api/health alias with runtime and binding telemetry', async () => {
    for (const path of ['/api/v1/health', '/api/health']) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        status: string;
        ftsDbReady: boolean;
        service: string;
        runtime: string;
        environment: string;
        bindings: Record<string, boolean>;
      };
      expect(body.ok).toBe(true);
      expect(body.status).toBe('ok');
      expect(body.ftsDbReady).toBe(false);
      expect(body.service).toBe('budgetlens-api');
      expect(body.runtime).toBe('cloudflare-workers');
      expect(body.bindings).toEqual({
        budgets: false,
        ledgers: false,
        app: false,
      });
    }
  });

  it('responds gracefully with 503 / { available: false } when D1 bindings are absent', async () => {
    const projRes = await app.request('/api/v1/projects');
    expect(projRes.status).toBe(503);
    const projBody = (await projRes.json()) as { ok: boolean; available: boolean };
    expect(projBody.ok).toBe(false);
    expect(projBody.available).toBe(false);

    const searchRes = await app.request('/api/search?q=solar');
    expect(searchRes.status).toBe(200);
    const searchBody = (await searchRes.json()) as { available: boolean; totalMatches: number };
    expect(searchBody.available).toBe(false);
    expect(searchBody.totalMatches).toBe(0);
  });
});
