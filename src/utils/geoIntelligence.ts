import { lookupOaugfMdaFindings, type OaugfAuditIndexPayload } from './mdaScorecard';
import { lookupMdaRiskProfile, type CrossLedgerContextWire } from './evidenceEngineV3';
import { extractCanonicalProjectCode } from './ruleEngine';
import { isZonalInterventionItem } from './billActDiff';
import { fetchDataset } from '../services/apiClient';

export interface GeoProjectStub {
  id: string;
  projectCode: string;
  projectName: string;
  agency: string;
  state: string;
  lga: string;
  amount: number;
  page: number;
  financialYear: number;
  sector: string;
  isFlagged?: boolean;
  ruleReason?: string | null;
}

export interface LgaRow {
  lgaName: string;
  projectCount: number;
  amountNaira: number;
  flaggedCount: number;
  topProjectTitle: string;
  topProjectCode: string;
  topProjectAmount: number;
  topProjectPage: number;
  topProjectAgency: string;
}

export interface StateTopContractor {
  name: string;
  awardedNaira: number;
  count: number;
}

export interface ExecBucket {
  contractedCount: number;
  contractedNaira: number;
  nocopoPaidNaira: number;
  govspendVoucherCount: number;
  govspendDisbursedNaira: number;
}

export interface StateGeoEntry extends ExecBucket {
  name: string;
  displayName: string;
  zone: string;
  amountNaira: number;
  projectCount: number;
  flaggedCount: number;
  flaggedAmountNaira: number;
  flaggedSharePct: number;
  anomalyScore: 'High' | 'Medium' | 'Low' | 'None';
  yoyDeltaPct: number | null;
  priorYear: number | null;
  topMinistry: string;
  topMinistryAmountNaira: number;
  primaryItem: GeoProjectStub | null;
  topProjects: GeoProjectStub[];
  lgaMappedCount: number;
  unmappedLgaCount: number;
  lgaBreakdown: LgaRow[];
}

export interface ZoneEntry extends ExecBucket {
  name: string;
  amountNaira: number;
  projectCount: number;
  flaggedCount: number;
  flaggedAmountNaira: number;
  population: number;
  perCapitaNaira: number;
  topMinistry: string;
  topMinistryAmountNaira: number;
  stateShares: Array<
    ExecBucket & {
      state: string;
      displayName: string;
      amountNaira: number;
      projectCount: number;
      flaggedCount: number;
    }
  >;
  topProjects: GeoProjectStub[];
}

export interface GeoExecutionYearSummary {
  nocopoAwardedCount: number;
  nocopoGeoMatchedCount: number;
  nocopoGeoMatchedNaira: number;
  nocopoHqNationwideNaira: number;
  nocopoGeoMatchedPct: number;
  govspendVoucherCount: number;
  govspendGeoMatchedCount: number;
  govspendGeoMatchedNaira: number;
  govspendHqNationwideNaira: number;
  govspendGeoMatchedPct: number;
}

export interface GeoExecutionGlobalSummary {
  nocopoYearsCovered: number[];
  nocopoTotalAwardedCount: number;
  nocopoTotalAwardedNaira: number;
  nocopoPlanningExcludedCount: number;
  nocopoGeoMatchedCount: number;
  nocopoGeoMatchedNaira: number;
  nocopoGeoMatchedPct: number;
  nocopoHqNationwideCount: number;
  nocopoHqNationwideNaira: number;
  govspendYearsCovered: number[];
  govspendTotalVoucherCount: number;
  govspendTotalDisbursedNaira: number;
  govspendGeoMatchedCount: number;
  govspendGeoMatchedNaira: number;
  govspendGeoMatchedPct: number;
  govspendHqNationwideCount: number;
  govspendHqNationwideNaira: number;
  cumulativeByZone: Record<string, ExecBucket>;
  cumulativeByState: Record<
    string,
    ExecBucket & {
      displayName: string;
      zone: string;
      topContractors?: StateTopContractor[];
    }
  >;
}

export interface GeoYearPayload {
  financialYear: number;
  summary: {
    totalLeafItems: number;
    totalBudgetNaira: number;
    geoTaggedItems: number;
    geoTaggedAmountNaira: number;
    federalHqItems: number;
    federalHqAmountNaira: number;
    geoCoveragePct: number;
    flaggedItemsTotal: number;
    execution?: GeoExecutionYearSummary;
  };
  zones: Record<string, ZoneEntry>;
  states: Record<string, StateGeoEntry>;
}

export interface GeoIntelligenceIndexPayload {
  generatedAt: string;
  yearsCovered: number[];
  executionSummary?: GeoExecutionGlobalSummary;
  years: Record<string, GeoYearPayload>;
}

let cachedGeoIndexPromise: Promise<GeoIntelligenceIndexPayload | null> | null = null;

export function loadGeoIntelligenceIndex(): Promise<GeoIntelligenceIndexPayload | null> {
  if (!cachedGeoIndexPromise) {
    cachedGeoIndexPromise = fetchDataset<GeoIntelligenceIndexPayload>(
      'geo_intelligence_index'
    ).catch(() => null);
  }
  return cachedGeoIndexPromise;
}

export type DeliveryGapBand =
  | 'PAPER_HEAVY_LOW_EXECUTION'
  | 'DISBURSED_EXCEEDS_AWARDS'
  | 'ACTIVE_DELIVERY'
  | 'MINIMAL_STATE_DATA';

export interface StateDeliveryMetrics {
  budgetedNaira: number;
  contractedNaira: number;
  disbursedNaira: number;
  contractToBudgetPct: number | null;
  paidToContractPct: number | null;
  deliveryGapBand: DeliveryGapBand;
  deliveryGapLabel: string;
}

export function computeStateDeliveryMetrics(
  stateEntry: Partial<StateGeoEntry> | null | undefined,
  cumulativeState?: Partial<ExecBucket> | null
): StateDeliveryMetrics {
  const budgetedNaira = stateEntry?.amountNaira || 0;
  const contractedNaira =
    cumulativeState?.contractedNaira ?? stateEntry?.contractedNaira ?? 0;
  const disbursedNaira =
    cumulativeState?.govspendDisbursedNaira ?? stateEntry?.govspendDisbursedNaira ?? 0;

  const contractToBudgetPct =
    budgetedNaira > 0
      ? Number(((contractedNaira / budgetedNaira) * 100).toFixed(1))
      : null;
  const paidToContractPct =
    contractedNaira > 0
      ? Number(((disbursedNaira / contractedNaira) * 100).toFixed(1))
      : null;

  let deliveryGapBand: DeliveryGapBand = 'MINIMAL_STATE_DATA';
  let deliveryGapLabel = 'Minimal Execution Data';

  if (budgetedNaira >= 1_000_000_000 && contractedNaira / budgetedNaira < 0.2) {
    deliveryGapBand = 'PAPER_HEAVY_LOW_EXECUTION';
    deliveryGapLabel = 'Paper-Heavy (<20% Contracted)';
  } else if (
    disbursedNaira >= 50_000_000_000 &&
    (contractedNaira === 0 || disbursedNaira > contractedNaira * 1.5)
  ) {
    deliveryGapBand = 'DISBURSED_EXCEEDS_AWARDS';
    deliveryGapLabel = 'Cash Exceeds Public Awards';
  } else if (contractedNaira > 0 || disbursedNaira > 0) {
    deliveryGapBand = 'ACTIVE_DELIVERY';
    deliveryGapLabel = 'Active Delivery Pipeline';
  }

  return {
    budgetedNaira,
    contractedNaira,
    disbursedNaira,
    contractToBudgetPct,
    paidToContractPct,
    deliveryGapBand,
    deliveryGapLabel,
  };
}

export function computeHqVsStateSplit(
  layer: 'budget' | 'contracted' | 'disbursed',
  scope: 'fy' | 'cumulative',
  yearData: GeoYearPayload | null,
  execSummary: GeoExecutionGlobalSummary | null
): {
  stateMatchedNaira: number;
  hqNationwideNaira: number;
  totalNaira: number;
  stateMatchedPct: number;
  hqPct: number;
  headlineLabel: string;
} {
  let stateMatchedNaira = 0;
  let hqNationwideNaira = 0;
  let headlineLabel = 'Enacted Budget Split';

  if (layer === 'budget') {
    stateMatchedNaira = yearData?.summary.geoTaggedAmountNaira || 0;
    hqNationwideNaira = yearData?.summary.federalHqAmountNaira || 0;
    headlineLabel = `FY ${yearData?.financialYear || ''} Budgeted Capital Split`;
  } else if (layer === 'contracted') {
    if (scope === 'cumulative') {
      stateMatchedNaira = execSummary?.nocopoGeoMatchedNaira || 0;
      hqNationwideNaira = execSummary?.nocopoHqNationwideNaira || 0;
      headlineLabel = '2018–2026 NOCOPO Awarded Split';
    } else {
      stateMatchedNaira = yearData?.summary.execution?.nocopoGeoMatchedNaira || 0;
      hqNationwideNaira = yearData?.summary.execution?.nocopoHqNationwideNaira || 0;
      headlineLabel = `FY ${yearData?.financialYear || ''} NOCOPO Awarded Split`;
    }
  } else if (scope === 'cumulative') {
    stateMatchedNaira = execSummary?.govspendGeoMatchedNaira || 0;
    hqNationwideNaira = execSummary?.govspendHqNationwideNaira || 0;
    headlineLabel = '2018–2026 GovSpend Disbursed Split';
  } else {
    stateMatchedNaira = yearData?.summary.execution?.govspendGeoMatchedNaira || 0;
    hqNationwideNaira = yearData?.summary.execution?.govspendHqNationwideNaira || 0;
    headlineLabel = `FY ${yearData?.financialYear || ''} GovSpend Disbursed Split`;
  }

  const totalNaira = stateMatchedNaira + hqNationwideNaira;
  const stateMatchedPct =
    totalNaira > 0 ? Number(((stateMatchedNaira / totalNaira) * 100).toFixed(1)) : 0;
  const hqPct = totalNaira > 0 ? Number((100 - stateMatchedPct).toFixed(1)) : 0;

  return {
    stateMatchedNaira,
    hqNationwideNaira,
    totalNaira,
    stateMatchedPct,
    hqPct,
    headlineLabel,
  };
}

export interface StateCrossLedgerSignals {
  oaugfQueriedMdaCount: number;
  oaugfQueriedExposureNaira: number;
  oaugfTotalMdaQueries: number;
  billInsertionCount: number;
  billInsertionNaira: number;
  topOaugfMdas: Array<{ mdaName: string; queryCount: number; repeatNeglect: number }>;
}

export interface GeoRecordProjection {
  state?: string | null;
  projectCode?: string | null;
  projectName?: string | null;
  agency?: string | null;
  amount?: number;
}

export function computeStateCrossLedgerSignals(
  stateEntry: Partial<StateGeoEntry> | null | undefined,
  oaugfIndex?: OaugfAuditIndexPayload | null,
  crossLedgerContext?: CrossLedgerContextWire | null,
  stateRecords?: GeoRecordProjection[] | null
): StateCrossLedgerSignals {
  const billCodeSet = new Set(crossLedgerContext?.billInsertionCodes || []);
  const items: Array<{ code: string; title: string; agency: string; amount: number }> =
    stateRecords && stateRecords.length > 0
      ? stateRecords.map((r) => ({
          code: String(r.projectCode || ''),
          title: String(r.projectName || ''),
          agency: String(r.agency || ''),
          amount: Number(r.amount || 0),
        }))
      : (stateEntry?.topProjects || []).map((p) => ({
          code: String(p.projectCode || ''),
          title: String(p.projectName || ''),
          agency: String(p.agency || ''),
          amount: Number(p.amount || 0),
        }));

  if (items.length === 0 && stateEntry?.topMinistry) {
    items.push({
      code: '',
      title: '',
      agency: stateEntry.topMinistry,
      amount: Number(stateEntry.topMinistryAmountNaira || 0),
    });
  }

  let oaugfQueriedExposureNaira = 0;
  let billInsertionCount = 0;
  let billInsertionNaira = 0;
  const oaugfMdaMap = new Map<
    string,
    { mdaName: string; queryCount: number; repeatNeglect: number }
  >();

  for (const item of items) {
    const canonical = extractCanonicalProjectCode(item.code, item.title);
    const compactRaw = String(item.code || '').trim().toUpperCase().replace(/[\s-]+/g, '');
    if (
      (canonical && billCodeSet.has(canonical)) ||
      (compactRaw && billCodeSet.has(compactRaw)) ||
      isZonalInterventionItem(item.code, item.title)
    ) {
      billInsertionCount += 1;
      billInsertionNaira += item.amount;
    }

    if (item.agency) {
      const oaugf = lookupOaugfMdaFindings(oaugfIndex, item.agency);
      const prof = lookupMdaRiskProfile(crossLedgerContext, item.agency);
      const qCount = Math.max(oaugf?.findingCount || 0, prof?.oi || 0);
      const rCount = Math.max(oaugf?.repeatNeglectCount || 0, prof?.or || 0);
      if (qCount > 0) {
        oaugfQueriedExposureNaira += item.amount;
        const mKey = (oaugf?.mdaKey || item.agency).toUpperCase().trim();
        const existing = oaugfMdaMap.get(mKey);
        if (!existing) {
          oaugfMdaMap.set(mKey, {
            mdaName: oaugf?.mdaName || item.agency,
            queryCount: qCount,
            repeatNeglect: rCount,
          });
        } else {
          existing.queryCount = Math.max(existing.queryCount, qCount);
          existing.repeatNeglect = Math.max(existing.repeatNeglect, rCount);
        }
      }
    }
  }

  const topOaugfMdas = Array.from(oaugfMdaMap.values())
    .sort((a, b) => b.queryCount - a.queryCount || b.repeatNeglect - a.repeatNeglect)
    .slice(0, 5);
  const oaugfTotalMdaQueries = Array.from(oaugfMdaMap.values()).reduce(
    (s, m) => s + m.queryCount,
    0
  );

  return {
    oaugfQueriedMdaCount: oaugfMdaMap.size,
    oaugfQueriedExposureNaira,
    oaugfTotalMdaQueries,
    billInsertionCount,
    billInsertionNaira,
    topOaugfMdas,
  };
}

export interface StateLeagueRow {
  state: string;
  displayName: string;
  zone: string;
  budgetedNaira: number;
  projectCount: number;
  flaggedCount: number;
  flaggedSharePct: number;
  anomalyScore: string;
  contractedNaira: number;
  contractedCount: number;
  disbursedNaira: number;
  govspendVoucherCount: number;
  deliveryGapBand: DeliveryGapBand;
  deliveryGapLabel: string;
  lgaMappedCount: number;
  lgaTotalCount: number;
  topContractor: StateTopContractor | null;
  oaugfQueriedMdaCount?: number;
  oaugfQueriedExposureNaira?: number;
  oaugfTotalMdaQueries?: number;
  billInsertionCount?: number;
  billInsertionNaira?: number;
  topOaugfMdas?: Array<{ mdaName: string; queryCount: number; repeatNeglect: number }>;
}

export function build37StateLeagueRows(
  yearData: GeoYearPayload | null,
  execSummary: GeoExecutionGlobalSummary | null,
  scope: 'fy' | 'cumulative',
  crossLedgerInputs?: {
    oaugfIndex?: OaugfAuditIndexPayload | null;
    crossLedgerContext?: CrossLedgerContextWire | null;
    yearRecords?: GeoRecordProjection[];
  }
): StateLeagueRow[] {
  if (!yearData?.states) return [];

  const recordsByState = new Map<string, GeoRecordProjection[]>();
  if (crossLedgerInputs?.yearRecords?.length) {
    for (const r of crossLedgerInputs.yearRecords) {
      const stKey = String(r.state || '').trim().toLowerCase();
      if (!stKey) continue;
      const arr = recordsByState.get(stKey);
      if (arr) arr.push(r);
      else recordsByState.set(stKey, [r]);
    }
  }

  const hasCrossLedger = Boolean(
    crossLedgerInputs?.oaugfIndex ||
      crossLedgerInputs?.crossLedgerContext ||
      crossLedgerInputs?.yearRecords?.length
  );

  return Object.values(yearData.states).map((st) => {
    const cumSt = execSummary?.cumulativeByState?.[st.name];
    const contractedNaira =
      scope === 'cumulative' ? cumSt?.contractedNaira || 0 : st.contractedNaira || 0;
    const contractedCount =
      scope === 'cumulative' ? cumSt?.contractedCount || 0 : st.contractedCount || 0;
    const disbursedNaira =
      scope === 'cumulative'
        ? cumSt?.govspendDisbursedNaira || 0
        : st.govspendDisbursedNaira || 0;
    const govspendVoucherCount =
      scope === 'cumulative'
        ? cumSt?.govspendVoucherCount || 0
        : st.govspendVoucherCount || 0;

    const dm = computeStateDeliveryMetrics(st, {
      contractedNaira,
      govspendDisbursedNaira: disbursedNaira,
    });

    const stRecs =
      recordsByState.get(st.name.toLowerCase()) ||
      recordsByState.get((st.displayName || '').toLowerCase()) ||
      null;
    const cl = hasCrossLedger
      ? computeStateCrossLedgerSignals(
          st,
          crossLedgerInputs?.oaugfIndex,
          crossLedgerInputs?.crossLedgerContext,
          stRecs
        )
      : null;

    return {
      state: st.name,
      displayName: st.displayName,
      zone: st.zone,
      budgetedNaira: st.amountNaira,
      projectCount: st.projectCount,
      flaggedCount: st.flaggedCount,
      flaggedSharePct: st.flaggedSharePct,
      anomalyScore: st.anomalyScore,
      contractedNaira,
      contractedCount,
      disbursedNaira,
      govspendVoucherCount,
      deliveryGapBand: dm.deliveryGapBand,
      deliveryGapLabel: dm.deliveryGapLabel,
      lgaMappedCount: st.lgaMappedCount,
      lgaTotalCount: st.lgaBreakdown.length,
      topContractor: cumSt?.topContractors?.[0] || null,
      ...(cl
        ? {
            oaugfQueriedMdaCount: cl.oaugfQueriedMdaCount,
            oaugfQueriedExposureNaira: cl.oaugfQueriedExposureNaira,
            oaugfTotalMdaQueries: cl.oaugfTotalMdaQueries,
            billInsertionCount: cl.billInsertionCount,
            billInsertionNaira: cl.billInsertionNaira,
            topOaugfMdas: cl.topOaugfMdas,
          }
        : {}),
    };
  });
}
