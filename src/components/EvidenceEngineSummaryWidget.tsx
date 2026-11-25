import React, { useMemo, useState } from 'react';
import { Layers, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import { getRulesSummary } from '../utils/ruleEngine';

interface EvidenceSummaryProps {
  totalExtracted?: number;
  availableYearsCount: number;
  evidenceItems?: any[];
  compoundProjectsCount?: number;
  duplicateClusters?: any[];
  selectedRuleId?: string | null;
  onSelectRule?: (ruleId: string | null) => void;
}

export const EvidenceEngineSummaryWidget: React.FC<EvidenceSummaryProps> = ({
  availableYearsCount,
  evidenceItems = [],
  compoundProjectsCount = 0,
  duplicateClusters = [],
  selectedRuleId = null,
  onSelectRule,
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [scopeTab, setScopeTab] = useState<'ALL' | 'CROSS_LEDGER' | 'TEXT_AND_DOMAIN'>('ALL');

  const realEvidenceCount = evidenceItems.length;
  const realClustersCount = duplicateClusters.length;

  const rulesSummary = useMemo(() => getRulesSummary(true), []);
  const totalRulesCount = rulesSummary.length;

  const crossLedgerFindingsCount = useMemo(
    () =>
      evidenceItems.filter(
        (i) =>
          i.ledgerScope === 'CROSS_LEDGER' ||
          [
            'LEGISLATIVE_INSERTION_ANOMALY',
            'PAID_ON_PAPER_HIGH_RISK',
            'ZOMBIE_RECURRING_LINEAGE',
            'OAUGF_INDICTED_MDA_RISKY_SPEND',
            'PERSONAL_OR_OPAQUE_PAYOUT_MDA_RISK',
            'REPEAT_ASSET_LIFESPAN_VIOLATION',
          ].includes(i.ruleId)
      ).length,
    [evidenceItems]
  );

  // Calculate real findings per rule from evidenceItems
  const ruleStats = useMemo(() => {
    const map = new Map<string, { count: number; totalAmount: number }>();
    for (const item of evidenceItems) {
      const existing = map.get(item.ruleId) || { count: 0, totalAmount: 0 };
      map.set(item.ruleId, {
        count: existing.count + 1,
        totalAmount: existing.totalAmount + (item.amount || 0),
      });
    }
    return map;
  }, [evidenceItems]);

  // Rank rules dynamically by triggered count & total exposure
  const rankedRules = useMemo(() => {
    const filtered = rulesSummary.filter(
      (r) => scopeTab === 'ALL' || r.ledgerScope === scopeTab
    );
    return [...filtered].sort((a, b) => {
      const sa = ruleStats.get(a.id);
      const sb = ruleStats.get(b.id);
      const amtDiff = (sb?.totalAmount || 0) - (sa?.totalAmount || 0);
      if (amtDiff !== 0) return amtDiff;
      return (sb?.count || 0) - (sa?.count || 0);
    });
  }, [rulesSummary, ruleStats, scopeTab]);

  const formatNairaShort = (amt: number) => {
    if (amt >= 1e12) return `₦${(amt / 1e12).toFixed(2)}T`;
    if (amt >= 1e9) return `₦${(amt / 1e9).toFixed(2)}B`;
    if (amt >= 1e6) return `₦${(amt / 1e6).toFixed(2)}M`;
    return `₦${amt.toLocaleString()}`;
  };

  return (
    <div
      className="dossier-card"
      style={{
        padding: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
      }}
    >
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '0.75rem',
            gap: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
              <h3
                className="font-editorial"
                style={{ fontSize: '1.08rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}
              >
                Evidence Engine v3.0 Rule Matrix
              </h3>
              <span
                className="font-mono"
                style={{
                  fontSize: '0.62rem',
                  fontWeight: 700,
                  backgroundColor: '#ecfdf5',
                  color: '#047857',
                  border: '1px solid #a7f3d0',
                  padding: '0.1rem 0.42rem',
                  borderRadius: '4px',
                }}
              >
                22 Rules · 6 Ledgers Joined
              </span>
            </div>
            <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '0.18rem 0 0' }}>
              {realEvidenceCount.toLocaleString()} rule findings ({crossLedgerFindingsCount.toLocaleString()} cross-ledger) ·{' '}
              {compoundProjectsCount > 0 ? `${compoundProjectsCount.toLocaleString()} flagged projects · ` : ''}
              {realClustersCount.toLocaleString()} duplicate clusters · {availableYearsCount} years indexed
            </p>
          </div>
          {selectedRuleId && onSelectRule && (
            <button
              type="button"
              onClick={() => onSelectRule(null)}
              style={{
                padding: '0.2rem 0.55rem',
                borderRadius: '4px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--bg-canvas)',
                fontSize: '0.7rem',
                fontWeight: 600,
                color: 'var(--text-primary)',
                cursor: 'pointer',
              }}
            >
              Clear Filter
            </button>
          )}
        </div>

        {/* Scope Filter Pills */}
        <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.65rem', flexWrap: 'wrap' }}>
          {(
            [
              { id: 'ALL', label: `All Rules (${totalRulesCount})` },
              { id: 'CROSS_LEDGER', label: '6 Cross-Ledger Rules' },
              { id: 'TEXT_AND_DOMAIN', label: '16 Text & Mandate Rules' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setScopeTab(tab.id)}
              style={{
                padding: '0.24rem 0.55rem',
                borderRadius: '5px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: scopeTab === tab.id ? '#091017' : 'var(--bg-canvas)',
                color: scopeTab === tab.id ? '#ffffff' : 'var(--text-secondary)',
                fontSize: '0.69rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {rankedRules.slice(0, 6).map((rule) => {
            const stat = ruleStats.get(rule.id);
            const isSelected = selectedRuleId === rule.id;
            const isCross = rule.ledgerScope === 'CROSS_LEDGER';
            const sevColor =
              rule.severity === 'high' ? '#b91c1c' : rule.severity === 'medium' ? '#b45309' : '#475569';
            const sevBg =
              rule.severity === 'high' ? '#fef2f2' : rule.severity === 'medium' ? '#fffbeb' : '#f1f5f9';

            return (
              <button
                key={rule.id}
                type="button"
                onClick={() => onSelectRule?.(isSelected ? null : rule.id)}
                style={{
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.6rem',
                  padding: '0.45rem 0.6rem',
                  borderRadius: '6px',
                  border: isSelected ? '1px solid var(--accent-primary)' : '1px solid transparent',
                  backgroundColor: isSelected ? '#ecfdf5' : 'transparent',
                  borderBottom: isSelected ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                  cursor: onSelectRule ? 'pointer' : 'default',
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      fontSize: '0.6rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      padding: '0.1rem 0.35rem',
                      borderRadius: '4px',
                      backgroundColor: sevBg,
                      color: sevColor,
                      flexShrink: 0,
                    }}
                  >
                    {rule.severity}
                  </span>
                  {isCross && (
                    <span
                      className="font-mono"
                      style={{
                        fontSize: '0.58rem',
                        fontWeight: 700,
                        padding: '0.08rem 0.34rem',
                        borderRadius: '4px',
                        backgroundColor: '#eff6ff',
                        color: '#1d4ed8',
                        border: '1px solid #bfdbfe',
                        flexShrink: 0,
                      }}
                    >
                      6-LEDGER
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: '0.79rem',
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {rule.name}
                  </span>
                </div>

                <span
                  className="font-mono tabular-nums"
                  style={{
                    fontSize: '0.76rem',
                    fontWeight: 700,
                    color: stat?.count ? 'var(--text-primary)' : 'var(--text-muted)',
                    flexShrink: 0,
                  }}
                >
                  {stat?.count
                    ? `${stat.count.toLocaleString()} (${formatNairaShort(stat.totalAmount)})`
                    : '0 matches'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: '0.75rem',
          borderTop: '1px solid var(--border-subtle)',
          marginTop: '0.5rem',
        }}
      >
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            fontSize: '0.78rem',
            color: 'var(--accent-primary)',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
          }}
        >
          <SlidersHorizontal size={13} />
          <span>Inspect all {totalRulesCount} active rule criteria (16 Domain + 6 Cross-Ledger) →</span>
        </button>
      </div>

      {/* Active Rules Drawer Modal */}
      {modalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(4px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem',
          }}
          onClick={() => setModalOpen(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '800px',
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.3)',
              border: '1px solid var(--border-subtle)',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: '1.25rem 1.5rem',
                backgroundColor: '#091017',
                color: '#ffffff',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <span
                  className="font-mono"
                  style={{
                    fontSize: '0.68rem',
                    backgroundColor: '#059669',
                    color: '#ffffff',
                    fontWeight: 700,
                    padding: '0.15rem 0.5rem',
                    borderRadius: '4px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    marginBottom: '0.3rem',
                  }}
                >
                  <ShieldAlert size={11} /> Deterministic Transparency Rule Registry v3.0
                </span>
                <h2 className="font-editorial" style={{ fontSize: '1.25rem', fontWeight: 600, color: '#ffffff', margin: 0 }}>
                  All {totalRulesCount} Active Forensic Rules (16 Domain + 6 Cross-Ledger)
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.2rem' }}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                padding: '1.25rem 1.5rem',
                maxHeight: '62vh',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.65rem',
              }}
            >
              {rulesSummary.map((r) => {
                const stat = ruleStats.get(r.id);
                const isCross = r.ledgerScope === 'CROSS_LEDGER';
                return (
                  <div
                    key={r.id}
                    onClick={() => {
                      onSelectRule?.(r.id);
                      setModalOpen(false);
                    }}
                    style={{
                      padding: '0.75rem 0.9rem',
                      backgroundColor: isCross ? '#f8fafc' : 'var(--bg-canvas)',
                      border: isCross ? '1px solid #bfdbfe' : '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: onSelectRule ? 'pointer' : 'default',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.2rem', flexWrap: 'wrap' }}>
                        <span
                          className="font-mono"
                          style={{
                            fontSize: '0.65rem',
                            backgroundColor: '#e2e8f0',
                            color: '#0f172a',
                            fontWeight: 700,
                            padding: '0.1rem 0.4rem',
                            borderRadius: '4px',
                          }}
                        >
                          {r.id} (v{r.version})
                        </span>
                        <span
                          style={{
                            fontSize: '0.65rem',
                            backgroundColor:
                              r.severity === 'high' ? '#fee2e2' : r.severity === 'medium' ? '#ffedd5' : '#f1f5f9',
                            color:
                              r.severity === 'high' ? '#dc2626' : r.severity === 'medium' ? '#d97706' : '#475569',
                            fontWeight: 700,
                            padding: '0.1rem 0.4rem',
                            borderRadius: '4px',
                            textTransform: 'capitalize',
                          }}
                        >
                          {r.severity} Severity
                        </span>
                        {isCross && (
                          <span
                            className="font-mono"
                            style={{
                              fontSize: '0.63rem',
                              backgroundColor: '#dbeafe',
                              color: '#1e40af',
                              fontWeight: 700,
                              padding: '0.1rem 0.42rem',
                              borderRadius: '4px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                            }}
                          >
                            <Layers size={10} /> CROSS-LEDGER FORENSIC RULE
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {r.name}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                        {r.description}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '1rem' }}>
                      <div className="font-mono tabular-nums" style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent-primary)' }}>
                        {stat ? `${stat.count.toLocaleString()} Items (${formatNairaShort(stat.totalAmount)})` : '0 Findings'}
                      </div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                        {r.category}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              style={{
                padding: '1rem 1.5rem',
                backgroundColor: 'var(--bg-canvas)',
                borderTop: '1px solid var(--border-subtle)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Click any rule to filter the Evidence Findings Ledger below.
              </span>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                style={{
                  backgroundColor: '#091017',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '0.45rem 0.9rem',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
