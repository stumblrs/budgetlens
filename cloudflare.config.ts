try {
  (globalThis as { process?: { loadEnvFile?: (path?: string) => void } }).process?.loadEnvFile?.('.env');
} catch {
  // .env is optional (e.g., CI or fresh clone before D1 provisioning)
}

const envVars = (
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
) as Record<string, string | undefined>;

export default {
  worker: {
    name: 'budgetlens',
    entrypoint: './worker/index.ts',
    compatibilityDate: '2026-11-25',
    compatibilityFlags: ['nodejs_compat'],
    observability: {
      enabled: true,
      logs: { enabled: true, persist: true },
      traces: { enabled: true, persist: true },
    },
    assets: {
      notFoundHandling: 'single-page-application',
      runWorkerFirst: ['/api/*'],
    },
    env: {
      DB_BUDGETS: {
        type: 'd1',
        name: 'budgetlens-budgets',
        ...(envVars.D1_BUDGETS_ID ? { id: envVars.D1_BUDGETS_ID } : {}),
      },
      DB_LEDGERS: {
        type: 'd1',
        name: 'budgetlens-ledgers',
        ...(envVars.D1_LEDGERS_ID ? { id: envVars.D1_LEDGERS_ID } : {}),
      },
      DB_APP: {
        type: 'd1',
        name: 'budgetlens-app',
        ...(envVars.D1_APP_ID ? { id: envVars.D1_APP_ID } : {}),
      },
      ASSETS: { type: 'assets' },
      ENVIRONMENT: { type: 'text', value: 'development' },
    },
  },
};
