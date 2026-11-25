import React, { useEffect, useMemo, useState } from 'react';
import { datasetUrl } from '../services/apiClient';
import { Building2, ExternalLink, Info, Network, Search, ShieldAlert } from 'lucide-react';
import { ExpandableText } from './ExpandableText';
import type { ContractorSummaryItem } from './ContractorHistoryModal';
import {
  TAXONOMY_META,
  buildContractorSummaryFromNetwork,
  filterBipartiteSubgraph,
  formatHhiBand,
  type ContractorNetworkContext,
  type VendorNetworkPayload,
} from '../utils/vendorNetwork';
import { cleanEntityDisplayName } from '../utils/displayText';

interface VendorCaptureNetworkViewProps {
  onSelectContractor: (
    contractor: ContractorSummaryItem,
    networkContext?: ContractorNetworkContext
  ) => void;
}

function formatNairaCompact(amt?: number | null): string {
  if (!amt) return '₦0';
  const abs = Math.abs(amt);
  if (abs >= 1e12) return `₦${(amt / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `₦${(amt / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `₦${(amt / 1e6).toFixed(2)}M`;
  return `₦${Math.round(amt).toLocaleString('en-US')}`;
}

export const VendorCaptureNetworkView: React.FC<VendorCaptureNetworkViewProps> = ({
  onSelectContractor,
}) => {
  const [data, setData] = useState<VendorNetworkPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [graphMode, setGraphMode] = useState<'captive' | 'multimda'>('captive');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [innerView, setInnerView] = useState<
    'offnocopo' | 'staff' | 'hhi' | 'captive' | 'multimda' | 'discrepancies'
  >('offnocopo');
  const [searchQuery, setSearchQuery] = useState('');
  const [showExcludedInstitutions, setShowExcludedInstitutions] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(datasetUrl('/datasets/vendor_network_index.json'), { cache: 'no-cache' })
      .then((res) => (res.ok ? (res.json() as Promise<VendorNetworkPayload>) : null))
      .then((json) => {
        if (active && json) setData(json);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const activeGraph = useMemo(() => {
    if (!data) return null;
    return graphMode === 'captive'
      ? data.bipartiteGraphs.captiveGraph
      : data.bipartiteGraphs.multiMdaGraph;
  }, [data, graphMode]);

  const { highlightedNodeIds, highlightedEdgeIds } = useMemo(() => {
    if (!activeGraph) {
      return { highlightedNodeIds: new Set<string>(), highlightedEdgeIds: new Set<string>() };
    }
    return filterBipartiteSubgraph(activeGraph, selectedNodeId);
  }, [activeGraph, selectedNodeId]);

  if (loading && !data) {
    return (
      <div className="dossier-card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading MDA &harr; Contractor Capture Network &amp; Off-NOCOPO Vendor Audit...
      </div>
    );
  }

  if (!data || data.status !== 'VERIFIED_VENDOR_NETWORK') {
    return (
      <div className="dossier-card" style={{ padding: '1.5rem', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
        Vendor capture network dataset is currently unavailable.
      </div>
    );
  }

  const h = data.headline;
  const q = searchQuery.trim().toLowerCase();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
      {/* 1. Headline Capture & Off-NOCOPO KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))', gap: '0.85rem' }}>
        <div className="dossier-card" style={{ padding: '1rem 1.15rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
            Off-NOCOPO Private Vendors
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.35rem', fontWeight: 700, color: '#b45309', marginTop: '0.2rem' }}>
            {formatNairaCompact(h.offNocopoPrivatePaidNaira)}
          </div>
          <div className="font-mono" style={{ fontSize: '0.69rem', color: 'var(--text-muted)', marginTop: '0.16rem' }}>
            {h.offNocopoPrivateCount.toLocaleString()} private firms ({h.offNocopoPrivateBillionPlusCount} &ge; ₦1B)
          </div>
        </div>

        <div className="dossier-card" style={{ padding: '1rem 1.15rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
            Captive MDA &harr; Vendor Pairs
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.35rem', fontWeight: 700, color: '#b91c1c', marginTop: '0.2rem' }}>
            {h.captivePairCount.toLocaleString()} Pairs
          </div>
          <div className="font-mono" style={{ fontSize: '0.69rem', color: 'var(--text-muted)', marginTop: '0.16rem' }}>
            &ge;40% MDA award share &amp; &ge;3 awards ({formatNairaCompact(h.captivePairAwardedNaira)})
          </div>
        </div>

        <div className="dossier-card" style={{ padding: '1rem 1.15rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
            Multi-MDA Super-Contractors
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.35rem', fontWeight: 700, color: '#1d4ed8', marginTop: '0.2rem' }}>
            {h.multiMdaContractorCount.toLocaleString()} Vendors
          </div>
          <div className="font-mono" style={{ fontSize: '0.69rem', color: 'var(--text-muted)', marginTop: '0.16rem' }}>
            Awarded across &ge;5 distinct federal MDAs
          </div>
        </div>

        <div className="dossier-card" style={{ padding: '1rem 1.15rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
            GovSpend &gt; 125% of Awards
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.35rem', fontWeight: 700, color: '#0f172a', marginTop: '0.2rem' }}>
            {h.overpaid125Count.toLocaleString()} / {h.matchedNocopoGovspendCount.toLocaleString()}
          </div>
          <div className="font-mono" style={{ fontSize: '0.69rem', color: 'var(--text-muted)', marginTop: '0.16rem' }}>
            Treasury {formatNairaCompact(h.overpaid125GovspendPaidNaira)} vs Awards {formatNairaCompact(h.overpaid125NocopoAwardedNaira)}
          </div>
        </div>
      </div>

      {/* 2. Interactive Bipartite SVG Capture Graph */}
      {activeGraph && activeGraph.edges.length > 0 && (
        <div className="dossier-card" style={{ padding: '1.1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.7rem', fontWeight: 700, color: '#059669', textTransform: 'uppercase' }}>
                <Network size={14} /> Precomputed Bipartite Procurement Graph (Awarded Stages Only)
              </div>
              <h3 className="font-editorial" style={{ margin: '0.1rem 0 0', fontSize: '1.05rem', fontWeight: 600 }}>
                {graphMode === 'captive'
                  ? 'Top Captive MDA <-> Contractor Relationships (>= 40% MDA Share)'
                  : 'Cross-MDA Super-Contractor Span Across Multiple Ministries'}
              </h3>
            </div>

            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {selectedNodeId && (
                <button
                  type="button"
                  onClick={() => setSelectedNodeId(null)}
                  className="editorial-btn"
                  style={{ fontSize: '0.72rem', padding: '0.28rem 0.6rem' }}
                >
                  Reset Highlight
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setGraphMode('captive');
                  setSelectedNodeId(null);
                }}
                className={graphMode === 'captive' ? 'editorial-btn-primary' : 'editorial-btn'}
                style={{ fontSize: '0.73rem', padding: '0.32rem 0.65rem' }}
              >
                Captive Pairs Network
              </button>
              <button
                type="button"
                onClick={() => {
                  setGraphMode('multimda');
                  setSelectedNodeId(null);
                }}
                className={graphMode === 'multimda' ? 'editorial-btn-primary' : 'editorial-btn'}
                style={{ fontSize: '0.73rem', padding: '0.32rem 0.65rem' }}
              >
                Multi-MDA Super-Contractors
              </button>
            </div>
          </div>

          <div
            className="mobile-only-block font-mono"
            style={{
              padding: '0.38rem 0.68rem',
              borderRadius: '6px',
              backgroundColor: '#ecfdf5',
              border: '1px solid #a7f3d0',
              color: '#065f46',
              fontSize: '0.7rem',
              fontWeight: 600,
            }}
          >
            &harr; Swipe horizontally to inspect full capture graph
          </div>

          <div
            style={{
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              backgroundColor: '#fafaf9',
              padding: '0.5rem',
            }}
          >
            <svg
              viewBox={`0 0 ${activeGraph.width} ${activeGraph.height}`}
              style={{ width: '100%', minWidth: '720px', height: 'auto', display: 'block' }}
              role="img"
              aria-label="MDA and Contractor Capture Network"
            >
              <text x="24" y="18" fontSize="11" fontWeight="700" fill="#475569">
                EXECUTING MDAs (LEFT)
              </text>
              <text x="640" y="18" fontSize="11" fontWeight="700" fill="#475569">
                AWARDED CONTRACTORS (CLICK TO INSPECT)
              </text>

              {activeGraph.edges.map((edge) => {
                const mNode = activeGraph.mdaNodes.find((n) => n.id === edge.mdaId);
                const cNode = activeGraph.contractorNodes.find((n) => n.id === edge.contractorId);
                if (!mNode || !cNode) return null;
                const active = highlightedEdgeIds.has(edge.id);
                const x1 = mNode.x + 250;
                const y1 = mNode.y;
                const x2 = cNode.x;
                const y2 = cNode.y;
                const midX = (x1 + x2) / 2;
                const strokeW = Math.max(1.5, Math.min(6, Math.log10(Math.max(1e6, edge.awardedNaira)) - 5.5));
                return (
                  <path
                    key={edge.id}
                    d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke={edge.isCaptive ? '#dc2626' : '#059669'}
                    strokeWidth={strokeW}
                    strokeOpacity={active ? 0.72 : 0.12}
                  >
                    <title>
                      {`${cleanEntityDisplayName(edge.mdaName)} -> ${cleanEntityDisplayName(edge.contractorName)}: ${edge.awardCount} awards (${formatNairaCompact(edge.awardedNaira)}, ${edge.shareOfMdaPct.toFixed(1)}% share)`}
                    </title>
                  </path>
                );
              })}

              {activeGraph.mdaNodes.map((node) => {
                const active = highlightedNodeIds.has(node.id);
                const isSel = selectedNodeId === node.id;
                const cleanMda = cleanEntityDisplayName(node.label);
                return (
                  <g
                    key={node.id}
                    style={{ cursor: 'pointer', opacity: active ? 1 : 0.25 }}
                    onClick={() => setSelectedNodeId((prev) => (prev === node.id ? null : node.id))}
                  >
                    <rect
                      x={node.x}
                      y={node.y - 14}
                      width={250}
                      height={28}
                      rx={5}
                      fill={isSel ? '#091017' : '#ffffff'}
                      stroke={isSel ? '#059669' : '#cbd5e1'}
                      strokeWidth={isSel ? 2 : 1}
                    />
                    <text
                      x={node.x + 8}
                      y={node.y + 4}
                      fontSize="10.5"
                      fontWeight="600"
                      fill={isSel ? '#ffffff' : '#0f172a'}
                    >
                      {cleanMda.length > 33 ? `${cleanMda.slice(0, 31)}…` : cleanMda}
                    </text>
                  </g>
                );
              })}

              {activeGraph.contractorNodes.map((node) => {
                const active = highlightedNodeIds.has(node.id);
                const isSel = selectedNodeId === node.id;
                const cleanVendor = cleanEntityDisplayName(node.label);
                return (
                  <g
                    key={node.id}
                    style={{ cursor: 'pointer', opacity: active ? 1 : 0.25 }}
                    onClick={() => {
                      setSelectedNodeId(node.id);
                      onSelectContractor(
                        buildContractorSummaryFromNetwork({
                          contractorName: node.label,
                          bppContractorId: node.bppContractorId,
                          fallbackTotalAwarded: node.totalAwardedNaira,
                          fallbackMdaCount: node.mdaCount,
                          govspendPaidNaira: node.govspendPaidNaira,
                          govspendPaymentCount: node.govspendPaymentCount,
                        }),
                        {
                          multiMdaCount: node.mdaCount,
                        }
                      );
                    }}
                  >
                    <rect
                      x={node.x}
                      y={node.y - 14}
                      width={256}
                      height={28}
                      rx={5}
                      fill={isSel ? '#047857' : '#eff6ff'}
                      stroke={isSel ? '#047857' : '#93c5fd'}
                      strokeWidth={1.2}
                    />
                    <text
                      x={node.x + 8}
                      y={node.y + 4}
                      fontSize="10.5"
                      fontWeight="700"
                      fill={isSel ? '#ffffff' : '#1e40af'}
                    >
                      {cleanVendor.length > 30 ? `${cleanVendor.slice(0, 28)}…` : cleanVendor}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          <div style={{ fontSize: '0.71rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span>Click any MDA box (left) to isolate its vendor links, or click any contractor pill (right) to inspect full contracts &amp; Treasury vouchers.</span>
            <span className="font-mono">Red curves: Captive (&ge;40% MDA share) · Emerald curves: Multi-MDA</span>
          </div>
        </div>
      )}

      {/* 3. Drill-Down Navigation & Filter */}
      <div className="dossier-card" style={{ overflow: 'hidden' }}>
        <div
          style={{
            padding: '0.9rem 1.2rem',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.7rem',
          }}
        >
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {(
              [
                { id: 'offnocopo', label: `Off-NOCOPO Private Vendors (${data.offNocopoAudit.topOffNocopoPrivateVendors.length})` },
                { id: 'staff', label: `Personal / Staff Accounts (${(data.offNocopoAudit.topStaffOrIndividualPayees || []).length})` },
                { id: 'hhi', label: `MDA Concentration HHI (${data.mdaConcentration.length})` },
                { id: 'captive', label: `Captive Pairs (${data.captivePairs.length})` },
                { id: 'multimda', label: `Multi-MDA (${data.multiMdaContractors.length})` },
                { id: 'discrepancies', label: `GovSpend > 125% (${data.payoutDiscrepancies.length})` },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setInnerView(t.id)}
                className={innerView === t.id ? 'editorial-btn-primary' : 'editorial-btn'}
                style={{ fontSize: '0.73rem', padding: '0.32rem 0.65rem' }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div style={{ position: 'relative' }}>
            <input
              type="text"
              placeholder="Filter contractor, beneficiary, MDA..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                padding: '0.4rem 0.7rem 0.4rem 2rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                fontSize: '0.78rem',
                width: '250px',
              }}
            />
            <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)' }} />
          </div>
        </div>

        {/* View A: Off-NOCOPO Private Vendors + Entity Taxonomy Hygiene Strip */}
        {innerView === 'offnocopo' && (
          <div style={{ padding: '1rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 0.9rem', borderRadius: '8px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', fontSize: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flex: '1 1 420px' }}>
                <Info size={15} color="#059669" style={{ flexShrink: 0 }} />
                <span>
                  Statutory transfers (<strong>IPPIS, FIRS, PenCom, CBN, Federal Ministries, Military &amp; Commercial Banks</strong>) are automatically isolated from <strong>Off-NOCOPO Private Corporate Vendors</strong> to prevent false procurement flags.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowExcludedInstitutions((prev) => !prev)}
                className="editorial-btn"
                style={{ fontSize: '0.7rem', padding: '0.25rem 0.55rem' }}
              >
                {showExcludedInstitutions ? 'Hide' : 'Show'} Excluded Statutory Transfers
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: '0.55rem' }}>
              {data.offNocopoAudit.taxonomyBreakdown.map((tb) => {
                const meta = TAXONOMY_META[tb.category];
                return (
                  <div
                    key={tb.category}
                    style={{
                      padding: '0.65rem 0.78rem',
                      borderRadius: '7px',
                      backgroundColor: meta.bg,
                      border: `1px solid ${meta.border}`,
                    }}
                  >
                    <div style={{ fontSize: '0.66rem', fontWeight: 700, color: meta.color }}>
                      {meta.label}
                    </div>
                    <div className="font-mono tabular-nums" style={{ fontSize: '1.02rem', fontWeight: 700, marginTop: '0.18rem', color: '#0f172a' }}>
                      {formatNairaCompact(tb.totalPaidNaira)}
                    </div>
                    <div className="font-mono" style={{ fontSize: '0.65rem', color: '#475569' }}>
                      {tb.beneficiaryCount.toLocaleString()} entities · {tb.shareOfOffNocopoNairaPct.toFixed(1)}%
                    </div>
                  </div>
                );
              })}
            </div>

            {showExcludedInstitutions && (
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '1px solid #cbd5e1', color: '#334155' }}>
                      <th style={{ padding: '0.5rem 0.8rem' }}>Excluded Statutory / Payroll / Bank Payee</th>
                      <th style={{ padding: '0.5rem 0.8rem' }}>Taxonomy Bucket</th>
                      <th style={{ padding: '0.5rem 0.8rem', textAlign: 'right' }}>Vouchers</th>
                      <th style={{ padding: '0.5rem 0.8rem', textAlign: 'right' }}>Total Transfers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.offNocopoAudit.topExcludedInstitutionalTransfers.map((row) => (
                      <tr key={row.beneficiaryName} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.45rem 0.8rem', fontWeight: 600 }}>{cleanEntityDisplayName(row.beneficiaryName)}</td>
                        <td className="font-mono" style={{ padding: '0.45rem 0.8rem', fontSize: '0.68rem' }}>
                          {TAXONOMY_META[row.category].label}
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.45rem 0.8rem', textAlign: 'right' }}>
                          {row.voucherCount.toLocaleString()}
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.45rem 0.8rem', textAlign: 'right', fontWeight: 700 }}>
                          {formatNairaCompact(row.totalPaidNaira)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '0.58rem 0.85rem' }}>Private Corporate Payee (Zero Public NOCOPO Match)</th>
                    <th style={{ padding: '0.58rem 0.85rem' }}>Primary Paying MDA &amp; Purpose</th>
                    <th style={{ padding: '0.58rem 0.85rem', textAlign: 'right' }}>Vouchers</th>
                    <th style={{ padding: '0.58rem 0.85rem', textAlign: 'right' }}>Treasury Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {data.offNocopoAudit.topOffNocopoPrivateVendors
                    .filter((v) => {
                      if (!q) return true;
                      return (
                        v.beneficiaryName.toLowerCase().includes(q) ||
                        v.sampleDescription.toLowerCase().includes(q) ||
                        v.topPayingMdas.some((m) => m.organizationName.toLowerCase().includes(q))
                      );
                    })
                    .map((v) => (
                      <tr key={v.beneficiaryName} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.55rem 0.85rem' }}>
                          <div style={{ fontWeight: 700, color: '#0f172a' }}>{cleanEntityDisplayName(v.beneficiaryName)}</div>
                          <div className="font-mono" style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>
                            {v.payingMdaCount} MDA(s) · {v.firstYear || '—'}–{v.lastYear || '—'}
                          </div>
                        </td>
                        <td style={{ padding: '0.55rem 0.85rem', maxWidth: '380px' }}>
                          <div style={{ fontWeight: 600, fontSize: '0.73rem' }}>
                            {cleanEntityDisplayName(v.topPayingMdas[0]?.organizationName) || 'Federal MDA'}
                          </div>
                          {v.sampleDescription && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.12rem' }}>
                              <ExpandableText text={v.sampleDescription} maxChars={120} />
                            </div>
                          )}
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.85rem', textAlign: 'right' }}>
                          {v.voucherCount.toLocaleString()}
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.85rem', textAlign: 'right', fontWeight: 700, color: '#b45309' }}>
                          {formatNairaCompact(v.totalPaidNaira)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* View A2: Staff / Personal Accounts & Unclassified Off-Portal Payouts (CP-2) */}
        {innerView === 'staff' && (
          <div style={{ padding: '1rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div style={{ padding: '0.75rem 1rem', borderRadius: '8px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', fontSize: '0.76rem', color: '#7f1d1d', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ShieldAlert size={16} color="#dc2626" style={{ flexShrink: 0 }} />
              <span>
                <strong>₦1.49 Trillion across {(h.offNocopoStaffCount || 10851).toLocaleString()} Personal / Staff-Named Beneficiaries</strong> ({h.offNocopoStaffBillionPlusCount || 235} &ge; ₦1B) plus <strong>₦1.26 Trillion across {(h.offNocopoUnclassifiedCount || 4169).toLocaleString()} Unclassified Payees</strong>. OAuGF reports repeatedly warn against paying contractors or project funds through personal staff bank accounts (Financial Regulations para. 601). Inspect the verbatim voucher description to distinguish legitimate imprest/allowance transfers from contract/supply payments routed to individuals.
              </span>
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '0.58rem 0.85rem' }}>Personal / Staff or Unclassified Payee</th>
                    <th style={{ padding: '0.58rem 0.85rem' }}>Purpose Classification</th>
                    <th style={{ padding: '0.58rem 0.85rem' }}>Paying MDA &amp; Verbatim Voucher Description</th>
                    <th style={{ padding: '0.58rem 0.85rem', textAlign: 'right' }}>Vouchers</th>
                    <th style={{ padding: '0.58rem 0.85rem', textAlign: 'right' }}>Treasury Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ...(data.offNocopoAudit.topStaffOrIndividualPayees || []),
                    ...(data.offNocopoAudit.topUnclassifiedPayees || []).slice(0, 25),
                  ]
                    .filter((v) => {
                      if (!q) return true;
                      return (
                        v.beneficiaryName.toLowerCase().includes(q) ||
                        v.sampleDescription.toLowerCase().includes(q) ||
                        (v.purposeTag || '').toLowerCase().includes(q) ||
                        v.topPayingMdas.some((m) => m.organizationName.toLowerCase().includes(q))
                      );
                    })
                    .map((v, idx) => (
                      <tr key={`${v.beneficiaryName}-${idx}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.55rem 0.85rem' }}>
                          <div style={{ fontWeight: 700, color: '#0f172a' }}>{cleanEntityDisplayName(v.beneficiaryName)}</div>
                          <div className="font-mono" style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>
                            {v.category} · {v.payingMdaCount} MDA(s) · {v.firstYear || '—'}–{v.lastYear || '—'}
                          </div>
                        </td>
                        <td style={{ padding: '0.55rem 0.85rem' }}>
                          <span
                            className="font-mono"
                            style={{
                              fontSize: '0.66rem',
                              fontWeight: 700,
                              padding: '0.12rem 0.42rem',
                              borderRadius: '4px',
                              backgroundColor:
                                v.purposeTag === 'CONTRACT_OR_SUPPLY_VIA_INDIVIDUAL' || v.purposeTag === 'OPAQUE_OR_BLANK_DESCRIPTION'
                                  ? '#fef2f2'
                                  : '#fffbeb',
                              color:
                                v.purposeTag === 'CONTRACT_OR_SUPPLY_VIA_INDIVIDUAL' || v.purposeTag === 'OPAQUE_OR_BLANK_DESCRIPTION'
                                  ? '#b91c1c'
                                  : '#92400e',
                              border: '1px solid #fde68a',
                            }}
                          >
                            {v.purposeTag || 'PERSONAL_PAYOUT'}
                          </span>
                        </td>
                        <td style={{ padding: '0.55rem 0.85rem', maxWidth: '370px' }}>
                          <div style={{ fontWeight: 600, fontSize: '0.73rem' }}>
                            {cleanEntityDisplayName(v.topPayingMdas[0]?.organizationName) || 'Federal MDA'}
                          </div>
                          {v.sampleDescription ? (
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.12rem' }}>
                              <ExpandableText text={v.sampleDescription} maxChars={120} />
                            </div>
                          ) : (
                            <div style={{ fontSize: '0.7rem', color: '#dc2626', fontStyle: 'italic' }}>
                              [Blank / Opaque Voucher Description]
                            </div>
                          )}
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.85rem', textAlign: 'right' }}>
                          {v.voucherCount.toLocaleString()}
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.85rem', textAlign: 'right', fontWeight: 700, color: '#b91c1c' }}>
                          {formatNairaCompact(v.totalPaidNaira)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* View B: MDA Concentration (HHI) */}
        {innerView === 'hhi' && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                  <th style={{ padding: '0.6rem 0.9rem' }}>Executing MDA (&ge;3 Awards)</th>
                  <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>HHI (0–10k)</th>
                  <th style={{ padding: '0.6rem 0.9rem' }}>Concentration Band</th>
                  <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>Top Vendor Share</th>
                  <th style={{ padding: '0.6rem 0.9rem' }}>Top Contractor</th>
                  <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>MDA Total Awarded</th>
                </tr>
              </thead>
              <tbody>
                {data.mdaConcentration
                  .filter((m) => !q || m.mdaName.toLowerCase().includes(q) || m.contractorName.toLowerCase().includes(q))
                  .map((m) => {
                    const hb = formatHhiBand(m.hhi);
                    return (
                      <tr key={m.mdaName} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.58rem 0.9rem' }}>
                          <div style={{ fontWeight: 700 }}>{cleanEntityDisplayName(m.mdaName)}</div>
                          <div className="font-mono" style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>
                            {m.awardCount} awards · {m.distinctContractors} distinct vendors
                          </div>
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.58rem 0.9rem', textAlign: 'right', fontWeight: 700 }}>
                          {m.hhi.toLocaleString()}
                        </td>
                        <td style={{ padding: '0.58rem 0.9rem' }}>
                          <span
                            className="font-mono"
                            style={{
                              fontSize: '0.67rem',
                              fontWeight: 700,
                              padding: '0.12rem 0.42rem',
                              borderRadius: '4px',
                              backgroundColor: hb.bg,
                              color: hb.color,
                              border: `1px solid ${hb.border}`,
                            }}
                          >
                            {hb.label}
                          </span>
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.58rem 0.9rem', textAlign: 'right', fontWeight: 700 }}>
                          {m.topVendorSharePct.toFixed(1)}%
                        </td>
                        <td style={{ padding: '0.58rem 0.9rem' }}>
                          <button
                            type="button"
                            onClick={() =>
                              onSelectContractor(
                                buildContractorSummaryFromNetwork({
                                  ...m,
                                  fallbackAwardCount: m.topVendorAwardCount,
                                  fallbackTotalAwarded: m.topVendorAwardedNaira,
                                  fallbackTopMdas: [m.mdaName],
                                }),
                                m.topVendorSharePct >= 40 ? { captiveMdaLabel: m.mdaName } : undefined
                              )
                            }
                            style={{
                              fontSize: '0.73rem',
                              padding: '0.16rem 0.45rem',
                              borderRadius: '4px',
                              border: '1px solid #bfdbfe',
                              backgroundColor: '#eff6ff',
                              color: '#1d4ed8',
                              fontWeight: 600,
                              cursor: 'pointer',
                              textAlign: 'left',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                            }}
                          >
                            {cleanEntityDisplayName(m.contractorName)} <ExternalLink size={10} />
                          </button>
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.58rem 0.9rem', textAlign: 'right', fontWeight: 700 }}>
                          {formatNairaCompact(m.totalAwardedNaira)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}

        {/* View C: Captive Pairs */}
        {innerView === 'captive' && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                  <th style={{ padding: '0.6rem 0.9rem' }}>MDA</th>
                  <th style={{ padding: '0.6rem 0.9rem' }}>Captive Contractor</th>
                  <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>Pair Awards</th>
                  <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>MDA Share</th>
                  <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>Pair Awarded</th>
                </tr>
              </thead>
              <tbody>
                {data.captivePairs
                  .filter((p) => !q || p.mdaName.toLowerCase().includes(q) || p.contractorName.toLowerCase().includes(q))
                  .map((p) => (
                    <tr key={`${p.mdaName}-${p.contractorName}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.58rem 0.9rem', fontWeight: 600 }}>
                        <Building2 size={12} style={{ verticalAlign: 'middle', marginRight: '0.3rem', color: '#64748b' }} />
                        {cleanEntityDisplayName(p.mdaName)}
                      </td>
                      <td style={{ padding: '0.58rem 0.9rem' }}>
                        <button
                          type="button"
                          onClick={() =>
                            onSelectContractor(
                              buildContractorSummaryFromNetwork({
                                ...p,
                                fallbackAwardCount: p.pairAwardCount,
                                fallbackTotalAwarded: p.pairAwardedNaira,
                                fallbackNocopoPaid: p.pairPaidNaira,
                                fallbackTopMdas: [p.mdaName],
                              }),
                              { captiveMdaLabel: p.mdaName }
                            )
                          }
                          style={{
                            fontSize: '0.73rem',
                            padding: '0.16rem 0.45rem',
                            borderRadius: '4px',
                            border: '1px solid #fecaca',
                            backgroundColor: '#fef2f2',
                            color: '#b91c1c',
                            fontWeight: 700,
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          {cleanEntityDisplayName(p.contractorName)}
                        </button>
                      </td>
                      <td className="font-mono tabular-nums" style={{ padding: '0.58rem 0.9rem', textAlign: 'right' }}>
                        {p.pairAwardCount} / {p.mdaAwardCount}
                      </td>
                      <td className="font-mono tabular-nums" style={{ padding: '0.58rem 0.9rem', textAlign: 'right', fontWeight: 700, color: '#b91c1c' }}>
                        {p.shareOfMdaPct.toFixed(1)}%
                      </td>
                      <td className="font-mono tabular-nums" style={{ padding: '0.58rem 0.9rem', textAlign: 'right', fontWeight: 700 }}>
                        {formatNairaCompact(p.pairAwardedNaira)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {/* View D: Multi-MDA Super-Contractors */}
        {innerView === 'multimda' && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                  <th style={{ padding: '0.6rem 0.9rem' }}>Multi-MDA Contractor (&ge;5 MDAs)</th>
                  <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>MDAs Won</th>
                  <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>Awards</th>
                  <th style={{ padding: '0.6rem 0.9rem' }}>Top MDAs Awarded</th>
                  <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>Total Contracted</th>
                  <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>GovSpend Paid</th>
                </tr>
              </thead>
              <tbody>
                {data.multiMdaContractors
                  .filter(
                    (c) =>
                      !q ||
                      c.contractorName.toLowerCase().includes(q) ||
                      c.topMdaBreakdown.some((m) => m.mdaName.toLowerCase().includes(q))
                  )
                  .map((c) => (
                    <tr key={c.contractorName} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.58rem 0.9rem' }}>
                        <button
                          type="button"
                          onClick={() =>
                            onSelectContractor(
                              buildContractorSummaryFromNetwork({
                                ...c,
                                fallbackAwardCount: c.awardCount,
                                fallbackTotalAwarded: c.totalAwardedNaira,
                                fallbackNocopoPaid: c.totalNocopoPaidNaira,
                                fallbackFirstYear: c.firstYear,
                                fallbackLastYear: c.lastYear,
                                fallbackMdaCount: c.mdaCount,
                                fallbackTopMdas: c.topMdaBreakdown.map((m) => m.mdaName),
                              }),
                              { multiMdaCount: c.mdaCount }
                            )
                          }
                          style={{
                            fontSize: '0.74rem',
                            padding: '0.18rem 0.48rem',
                            borderRadius: '4px',
                            border: '1px solid #bfdbfe',
                            backgroundColor: '#eff6ff',
                            color: '#1d4ed8',
                            fontWeight: 700,
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          {cleanEntityDisplayName(c.contractorName)}
                        </button>
                      </td>
                      <td className="font-mono tabular-nums" style={{ padding: '0.58rem 0.9rem', textAlign: 'right', fontWeight: 700, color: '#1d4ed8' }}>
                        {c.mdaCount}
                      </td>
                      <td className="font-mono tabular-nums" style={{ padding: '0.58rem 0.9rem', textAlign: 'right' }}>
                        {c.awardCount.toLocaleString('en-US')}
                      </td>
                      <td style={{ padding: '0.58rem 0.9rem', maxWidth: '300px', fontSize: '0.71rem', color: 'var(--text-muted)' }}>
                        {c.topMdaBreakdown.slice(0, 3).map((m) => `${cleanEntityDisplayName(m.mdaName)} (${m.awardCount})`).join(' · ')}
                      </td>
                      <td className="font-mono tabular-nums" style={{ padding: '0.58rem 0.9rem', textAlign: 'right', fontWeight: 700 }}>
                        {formatNairaCompact(c.totalAwardedNaira)}
                      </td>
                      <td className="font-mono tabular-nums" style={{ padding: '0.58rem 0.9rem', textAlign: 'right', color: '#047857', fontWeight: 600 }}>
                        {c.govspendPaidNaira ? formatNairaCompact(c.govspendPaidNaira) : '—'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {/* View E: GovSpend > 125% Discrepancy */}
        {innerView === 'discrepancies' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            <div style={{ padding: '0.75rem 1.1rem', backgroundColor: '#fffbeb', borderBottom: '1px solid #fde68a', fontSize: '0.75rem', color: '#78350f', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ShieldAlert size={15} color="#b45309" style={{ flexShrink: 0 }} />
              <span>
                Compares total Open Treasury cash receipts (2018–2026) against publicly disclosed awarded NOCOPO contract totals. Excess may reflect multi-year contract amendments, sub-threshold lots, or undisclosed tender awards.
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '0.6rem 0.9rem' }}>Matched Contractor</th>
                    <th style={{ padding: '0.6rem 0.9rem' }}>Top Paying Treasury MDAs</th>
                    <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>NOCOPO Awarded</th>
                    <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>GovSpend Paid</th>
                    <th style={{ padding: '0.6rem 0.9rem', textAlign: 'right' }}>Excess / Ratio</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payoutDiscrepancies
                    .filter(
                      (d) =>
                        !q ||
                        d.contractorName.toLowerCase().includes(q) ||
                        d.topPayingMdas.some((m) => m.toLowerCase().includes(q))
                    )
                    .map((d) => (
                      <tr key={d.contractorName} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.58rem 0.9rem' }}>
                          <button
                            type="button"
                            onClick={() =>
                              onSelectContractor(
                                buildContractorSummaryFromNetwork({
                                  ...d,
                                  govspendPaymentCount: d.govspendVoucherCount,
                                  govspendPaidNaira: d.govspendPaidNaira,
                                  fallbackAwardCount: d.awardCount,
                                  fallbackTotalAwarded: d.nocopoAwardedNaira,
                                  fallbackNocopoPaid: d.nocopoDisbursedNaira,
                                  fallbackFirstYear: d.firstYear,
                                  fallbackLastYear: d.lastYear,
                                  fallbackMdaCount: d.mdaCount,
                                  fallbackTopMdas: d.topPayingMdas,
                                }),
                                { payoutDiscrepancyPct: d.payoutToAwardPct }
                              )
                            }
                            style={{
                              fontSize: '0.74rem',
                              padding: '0.18rem 0.48rem',
                              borderRadius: '4px',
                              border: '1px solid #bfdbfe',
                              backgroundColor: '#eff6ff',
                              color: '#1d4ed8',
                              fontWeight: 700,
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                          >
                            {cleanEntityDisplayName(d.contractorName)}
                          </button>
                        </td>
                        <td style={{ padding: '0.58rem 0.9rem', fontSize: '0.72rem', color: 'var(--text-muted)', maxWidth: '280px' }}>
                          {d.topPayingMdas.map((m) => cleanEntityDisplayName(m)).join(' · ') || 'Federal MDA'} ({d.govspendVoucherCount.toLocaleString('en-US')} vouchers)
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.58rem 0.9rem', textAlign: 'right' }}>
                          {formatNairaCompact(d.nocopoAwardedNaira)}
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.58rem 0.9rem', textAlign: 'right', fontWeight: 700, color: '#b45309' }}>
                          {formatNairaCompact(d.govspendPaidNaira)}
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.58rem 0.9rem', textAlign: 'right', fontWeight: 700, color: '#b91c1c' }}>
                          +{formatNairaCompact(d.excessNaira)} ({d.payoutToAwardPct.toFixed(0)}%)
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
