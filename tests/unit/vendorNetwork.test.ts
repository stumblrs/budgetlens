import { describe, it, expect } from 'vitest';
import {
  TAXONOMY_META,
  buildContractorSummaryFromNetwork,
  filterBipartiteSubgraph,
  formatHhiBand,
  type BipartiteGraphData,
} from '../../src/utils/vendorNetwork';

describe('Vendor Capture Network & Off-NOCOPO Audit Utilities (P3-S5)', () => {
  it('formats HHI concentration bands across DOJ thresholds cleanly', () => {
    expect(formatHhiBand(3200).band).toBe('HIGHLY_CONCENTRATED');
    expect(formatHhiBand(2500).label).toBe('Highly Concentrated');
    expect(formatHhiBand(1900).band).toBe('MODERATELY_CONCENTRATED');
    expect(formatHhiBand(900).band).toBe('COMPETITIVE');
  });

  it('marks only PRIVATE_CORPORATE as private target in TAXONOMY_META', () => {
    expect(TAXONOMY_META.PRIVATE_CORPORATE.isPrivateTarget).toBe(true);
    expect(TAXONOMY_META.TAX_REVENUE_PENSION_PAYROLL.isPrivateTarget).toBe(false);
    expect(TAXONOMY_META.STATUTORY_GOV_MDA.isPrivateTarget).toBe(false);
    expect(TAXONOMY_META.BANK_FINANCIAL.isPrivateTarget).toBe(false);
    expect(TAXONOMY_META.STAFF_OR_INDIVIDUAL.isPrivateTarget).toBe(false);
    expect(TAXONOMY_META.UNCLASSIFIED.isPrivateTarget).toBe(false);
  });

  it('filters bipartite subgraphs cleanly around any selected MDA or Contractor node', () => {
    const graph: BipartiteGraphData = {
      width: 920,
      height: 260,
      mdaNodes: [
        { id: 'mda-0', label: 'Works', x: 24, y: 36, totalAwardedNaira: 100 },
        { id: 'mda-1', label: 'Health', x: 24, y: 78, totalAwardedNaira: 80 },
      ],
      contractorNodes: [
        { id: 'con-0', label: 'Alpha Ltd', x: 640, y: 36, totalAwardedNaira: 90, mdaCount: 2 },
        { id: 'con-1', label: 'Beta Ltd', x: 640, y: 78, totalAwardedNaira: 80, mdaCount: 1 },
      ],
      edges: [
        {
          id: 'edge-0',
          mdaId: 'mda-0',
          contractorId: 'con-0',
          mdaName: 'Works',
          contractorName: 'Alpha Ltd',
          awardCount: 4,
          awardedNaira: 90,
          shareOfMdaPct: 90,
          isCaptive: true,
        },
        {
          id: 'edge-1',
          mdaId: 'mda-1',
          contractorId: 'con-1',
          mdaName: 'Health',
          contractorName: 'Beta Ltd',
          awardCount: 3,
          awardedNaira: 80,
          shareOfMdaPct: 100,
          isCaptive: true,
        },
      ],
    };

    const all = filterBipartiteSubgraph(graph, null);
    expect(all.highlightedNodeIds.size).toBe(4);
    expect(all.highlightedEdgeIds.size).toBe(2);

    const sub = filterBipartiteSubgraph(graph, 'mda-0');
    expect(Array.from(sub.highlightedEdgeIds)).toEqual(['edge-0']);
    expect(sub.highlightedNodeIds.has('mda-0')).toBe(true);
    expect(sub.highlightedNodeIds.has('con-0')).toBe(true);
    expect(sub.highlightedNodeIds.has('con-1')).toBe(false);
  });

  it('constructs ContractorSummaryItem safely with leaderboard overrides and fallbacks', () => {
    const item = buildContractorSummaryFromNetwork({
      contractorName: 'Zenith Builders Ltd',
      bppContractorId: 'BPP-CI-77',
      leaderboardContractCount: 12,
      leaderboardTotalContractedNaira: 900_000_000,
      govspendPaymentCount: 8,
      govspendPaidNaira: 750_000_000,
      fallbackAwardCount: 2,
      fallbackTotalAwarded: 100_000_000,
    });
    expect(item.contractorName).toBe('Zenith Builders Ltd');
    expect(item.contractCount).toBe(12);
    expect(item.totalContractedNaira).toBe(900_000_000);
    expect(item.govspendPaidNaira).toBe(750_000_000);
  });
});
