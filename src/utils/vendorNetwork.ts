/**
 * Client types & pure helpers for MDA <-> Contractor Capture Network & Off-NOCOPO Audit (P3-S5).
 */
import type { ContractorSummaryItem } from '../components/ContractorHistoryModal';

export type BeneficiaryEntityCategory =
  | 'PRIVATE_CORPORATE'
  | 'STATUTORY_GOV_MDA'
  | 'BANK_FINANCIAL'
  | 'TAX_REVENUE_PENSION_PAYROLL'
  | 'STAFF_OR_INDIVIDUAL'
  | 'UNCLASSIFIED';

export interface ContractorNetworkContext {
  captiveMdaLabel?: string;
  multiMdaCount?: number;
  payoutDiscrepancyPct?: number;
}

export interface BipartiteNodeMda {
  id: string;
  label: string;
  x: number;
  y: number;
  totalAwardedNaira: number;
}

export interface BipartiteNodeContractor {
  id: string;
  label: string;
  x: number;
  y: number;
  totalAwardedNaira: number;
  mdaCount: number;
  bppContractorId?: string | null;
  govspendPaidNaira?: number;
  govspendPaymentCount?: number;
}

export interface BipartiteEdge {
  id: string;
  mdaId: string;
  contractorId: string;
  mdaName: string;
  contractorName: string;
  awardCount: number;
  awardedNaira: number;
  shareOfMdaPct: number;
  isCaptive: boolean;
}

export interface BipartiteGraphData {
  width: number;
  height: number;
  mdaNodes: BipartiteNodeMda[];
  contractorNodes: BipartiteNodeContractor[];
  edges: BipartiteEdge[];
}

export interface NetworkContractorBase {
  contractorName: string;
  bppContractorId?: string | null;
  leaderboardContractCount?: number | null;
  leaderboardTotalContractedNaira?: number | null;
  leaderboardFirstYear?: number | null;
  leaderboardLastYear?: number | null;
  leaderboardMdaCount?: number | null;
  leaderboardTopMdas?: string[];
  govspendPaymentCount?: number;
  govspendPaidNaira?: number;
}

export interface MdaConcentrationRow extends NetworkContractorBase {
  mdaName: string;
  awardCount: number;
  distinctContractors: number;
  totalAwardedNaira: number;
  totalPaidNaira: number;
  hhi: number;
  hhiNormalized: number;
  concentrationBand: 'HIGHLY_CONCENTRATED' | 'MODERATELY_CONCENTRATED' | 'COMPETITIVE';
  topVendorSharePct: number;
  topVendorAwardedNaira: number;
  topVendorAwardCount: number;
}

export interface CaptivePairRow extends NetworkContractorBase {
  mdaName: string;
  mdaAwardCount: number;
  mdaTotalAwardedNaira: number;
  pairAwardCount: number;
  pairAwardedNaira: number;
  pairPaidNaira: number;
  shareOfMdaPct: number;
}

export interface MultiMdaContractorRow extends NetworkContractorBase {
  mdaCount: number;
  awardCount: number;
  totalAwardedNaira: number;
  totalNocopoPaidNaira: number;
  firstYear: number | null;
  lastYear: number | null;
  topMdaBreakdown: Array<{ mdaName: string; awardCount: number; awardedNaira: number }>;
}

export interface PayoutDiscrepancyRow {
  contractorName: string;
  bppContractorId?: string | null;
  awardCount: number;
  mdaCount: number;
  nocopoAwardedNaira: number;
  nocopoDisbursedNaira: number;
  govspendPaidNaira: number;
  govspendVoucherCount: number;
  excessNaira: number;
  payoutToAwardPct: number;
  topPayingMdas: string[];
  firstYear: number | null;
  lastYear: number | null;
  leaderboardContractCount?: number | null;
  leaderboardTotalContractedNaira?: number | null;
  leaderboardFirstYear?: number | null;
  leaderboardLastYear?: number | null;
  leaderboardMdaCount?: number | null;
  leaderboardTopMdas?: string[];
}

export interface OffNocopoVendorRow {
  beneficiaryName: string;
  category: BeneficiaryEntityCategory;
  voucherCount: number;
  totalPaidNaira: number;
  payingMdaCount: number;
  topPayingMdas: Array<{ organizationName: string; totalNaira: number }>;
  firstYear: number | null;
  lastYear: number | null;
  sampleDescription: string;
  purposeTag?: string;
}

export interface TaxonomyBucketSummary {
  category: BeneficiaryEntityCategory;
  beneficiaryCount: number;
  voucherCount: number;
  totalPaidNaira: number;
  billionPlusCount: number;
  shareOfOffNocopoNairaPct: number;
}

export interface VendorNetworkPayload {
  generatedAt: string;
  status: string;
  headline: {
    awardedMdaCount: number;
    eligibleHhiMdaCount: number;
    highlyConcentratedMdaCount: number;
    captivePairCount: number;
    captivePairAwardedNaira: number;
    multiMdaContractorCount: number;
    matchedNocopoGovspendCount: number;
    overpaid125Count: number;
    overpaid125NocopoAwardedNaira: number;
    overpaid125GovspendPaidNaira: number;
    overpaid125ExcessNaira: number;
    offNocopoBeneficiaryCount: number;
    offNocopoTotalPaidNaira: number;
    offNocopoPrivateCount: number;
    offNocopoPrivatePaidNaira: number;
    offNocopoPrivateBillionPlusCount: number;
    offNocopoStaffCount?: number;
    offNocopoStaffPaidNaira?: number;
    offNocopoStaffBillionPlusCount?: number;
    offNocopoUnclassifiedCount?: number;
    offNocopoUnclassifiedPaidNaira?: number;
    offNocopoUnclassifiedBillionPlusCount?: number;
  };
  mdaConcentration: MdaConcentrationRow[];
  captivePairs: CaptivePairRow[];
  multiMdaContractors: MultiMdaContractorRow[];
  payoutDiscrepancies: PayoutDiscrepancyRow[];
  offNocopoAudit: {
    taxonomyBreakdown: TaxonomyBucketSummary[];
    topOffNocopoPrivateVendors: OffNocopoVendorRow[];
    topStaffOrIndividualPayees?: OffNocopoVendorRow[];
    topUnclassifiedPayees?: OffNocopoVendorRow[];
    topExcludedInstitutionalTransfers: OffNocopoVendorRow[];
  };
  bipartiteGraphs: {
    captiveGraph: BipartiteGraphData;
    multiMdaGraph: BipartiteGraphData;
  };
}

export const TAXONOMY_META: Record<
  BeneficiaryEntityCategory,
  { label: string; isPrivateTarget: boolean; color: string; bg: string; border: string }
> = {
  PRIVATE_CORPORATE: {
    label: 'Private Corporate Entities (Target)',
    isPrivateTarget: true,
    color: '#b45309',
    bg: '#fffbeb',
    border: '#fde68a',
  },
  TAX_REVENUE_PENSION_PAYROLL: {
    label: 'IPPIS, Tax, Pension & TSA Transfers',
    isPrivateTarget: false,
    color: '#475569',
    bg: '#f1f5f9',
    border: '#cbd5e1',
  },
  STATUTORY_GOV_MDA: {
    label: 'Statutory Agencies, Security & MDAs',
    isPrivateTarget: false,
    color: '#0369a1',
    bg: '#f0f9ff',
    border: '#bae6fd',
  },
  BANK_FINANCIAL: {
    label: 'CBN, Commercial Banks & Insurers',
    isPrivateTarget: false,
    color: '#6d28d9',
    bg: '#f5f3ff',
    border: '#ddd6fe',
  },
  STAFF_OR_INDIVIDUAL: {
    label: 'Staff / Named Individuals',
    isPrivateTarget: false,
    color: '#334155',
    bg: '#f8fafc',
    border: '#e2e8f0',
  },
  UNCLASSIFIED: {
    label: 'Unclassified Payees',
    isPrivateTarget: false,
    color: '#64748b',
    bg: '#f8fafc',
    border: '#e2e8f0',
  },
};

export function formatHhiBand(hhi: number): {
  band: 'HIGHLY_CONCENTRATED' | 'MODERATELY_CONCENTRATED' | 'COMPETITIVE';
  label: string;
  color: string;
  bg: string;
  border: string;
} {
  if (hhi >= 2500) {
    return {
      band: 'HIGHLY_CONCENTRATED',
      label: 'Highly Concentrated',
      color: '#b91c1c',
      bg: '#fef2f2',
      border: '#fecaca',
    };
  }
  if (hhi >= 1500) {
    return {
      band: 'MODERATELY_CONCENTRATED',
      label: 'Moderately Concentrated',
      color: '#b45309',
      bg: '#fffbeb',
      border: '#fde68a',
    };
  }
  return {
    band: 'COMPETITIVE',
    label: 'Competitive',
    color: '#047857',
    bg: '#ecfdf5',
    border: '#a7f3d0',
  };
}

export function filterBipartiteSubgraph(
  graph: BipartiteGraphData,
  selectedNodeId: string | null
): { highlightedNodeIds: Set<string>; highlightedEdgeIds: Set<string> } {
  if (!selectedNodeId) {
    return {
      highlightedNodeIds: new Set([
        ...graph.mdaNodes.map((n) => n.id),
        ...graph.contractorNodes.map((n) => n.id),
      ]),
      highlightedEdgeIds: new Set(graph.edges.map((e) => e.id)),
    };
  }

  const nodeIds = new Set<string>([selectedNodeId]);
  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.mdaId === selectedNodeId || edge.contractorId === selectedNodeId) {
      edgeIds.add(edge.id);
      nodeIds.add(edge.mdaId);
      nodeIds.add(edge.contractorId);
    }
  }
  return { highlightedNodeIds: nodeIds, highlightedEdgeIds: edgeIds };
}

export function buildContractorSummaryFromNetwork(
  input: NetworkContractorBase & {
    fallbackAwardCount?: number;
    fallbackTotalAwarded?: number;
    fallbackNocopoPaid?: number;
    fallbackFirstYear?: number | null;
    fallbackLastYear?: number | null;
    fallbackMdaCount?: number;
    fallbackTopMdas?: string[];
  }
): ContractorSummaryItem {
  return {
    contractorName: input.contractorName,
    bppContractorId: input.bppContractorId ?? undefined,
    contractCount: input.leaderboardContractCount ?? input.fallbackAwardCount ?? 1,
    totalContractedNaira: input.leaderboardTotalContractedNaira ?? input.fallbackTotalAwarded ?? 0,
    nocopoDisbursedNaira: input.fallbackNocopoPaid ?? 0,
    govspendPaymentCount: input.govspendPaymentCount ?? 0,
    govspendPaidNaira: input.govspendPaidNaira ?? 0,
    firstYear: input.leaderboardFirstYear ?? input.fallbackFirstYear ?? null,
    lastYear: input.leaderboardLastYear ?? input.fallbackLastYear ?? null,
    mdaCount: input.leaderboardMdaCount ?? input.fallbackMdaCount ?? 1,
    topMdas: input.leaderboardTopMdas ?? input.fallbackTopMdas ?? [],
  };
}
