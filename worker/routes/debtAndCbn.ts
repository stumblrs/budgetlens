import { Hono } from 'hono';
import { CBN_ACTING_GOVERNORS, CBN_GOVERNORS } from '../../src/data/cbnGovernors';
import {
  DmoYearRow,
  computeAdministrationDebtProjection,
} from '../../src/utils/administrationDebt';
import { CACHE_PUBLIC_SHORT, WorkerEnv, loadAppDataset } from '../lib/d1Helpers';

export const debtAndCbnRouter = new Hono<{ Bindings: WorkerEnv }>();

interface DebtProfilePayload {
  generatedAt?: string;
  source?: string;
  totalDocumentsIndexed?: number;
  ocrRecoveredCount?: number;
  yearsCovered?: number[];
  yearlyDebt?: DmoYearRow[];
  [key: string]: unknown;
}

debtAndCbnRouter.get('/debt', async (c) => {
  const debtProfile = await loadAppDataset<DebtProfilePayload>(
    c.env?.DB_APP,
    'debt_profile'
  );
  if (!debtProfile) {
    return c.json(
      { ok: false, available: false, error: 'DB_APP debt_profile dataset unavailable' },
      503
    );
  }

  const administrationProjection = computeAdministrationDebtProjection(
    debtProfile.yearlyDebt || [],
    debtProfile.totalDocumentsIndexed || 0
  );

  c.header('Cache-Control', CACHE_PUBLIC_SHORT);
  return c.json({
    ok: true,
    debtProfile,
    administrationProjection,
  });
});

debtAndCbnRouter.get('/cbn', (c) => {
  const era = (c.req.query('era') || '').trim().toUpperCase();
  const president = (c.req.query('president') || '').trim().toLowerCase();

  let governors = [...CBN_GOVERNORS];
  if (era === 'FOUNDING_MILITARY' || era === 'FOURTH_REPUBLIC') {
    governors = governors.filter((g) => g.era === era);
  }
  if (president && president !== 'all') {
    governors = governors.filter((g) =>
      g.presidentIds.some((p) => p.toLowerCase() === president)
    );
  }

  c.header('Cache-Control', CACHE_PUBLIC_SHORT);
  return c.json({
    ok: true,
    totalSubstantive: CBN_GOVERNORS.length,
    count: governors.length,
    governors,
    actingGovernors: CBN_ACTING_GOVERNORS,
  });
});
