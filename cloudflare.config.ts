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
      DB_BUDGETS: { type: 'd1', name: 'budgetlens-budgets' },
      DB_LEDGERS: { type: 'd1', name: 'budgetlens-ledgers' },
      DB_APP: { type: 'd1', name: 'budgetlens-app' },
      ASSETS: { type: 'assets' },
      ENVIRONMENT: { type: 'text', value: 'development' },
    },
  },
};
