import React from 'react';
import { ArrowRight, Copy } from 'lucide-react';
import type { DuplicateCluster } from '../utils/duplicateDetector';

interface Props {
  duplicateClusters?: DuplicateCluster[];
  onViewAll?: () => void;
}

function formatNairaShort(amt: number): string {
  if (amt >= 1e12) return `₦${(amt / 1e12).toFixed(2)}T`;
  if (amt >= 1e9) return `₦${(amt / 1e9).toFixed(2)}B`;
  if (amt >= 1e6) return `₦${(amt / 1e6).toFixed(2)}M`;
  return `₦${amt.toLocaleString()}`;
}

export const TopDuplicateClustersWidget: React.FC<Props> = ({
  duplicateClusters = [],
  onViewAll,
}) => {
  const displayItems = duplicateClusters.slice(0, 5);
  const totalClusterCount = duplicateClusters.length;

  return (
    <div
      className="dossier-card"
      style={{
        padding: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '0.5rem' }}>
          <div>
            <h3 className="font-editorial" style={{ fontSize: '1.08rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Duplicate Clusters (Top 5)
            </h3>
            <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '0.15rem 0 0' }}>
              Repeated wording &amp; split allocations across MDAs
            </p>
          </div>
          <span
            className="font-mono tabular-nums"
            style={{
              fontSize: '0.7rem',
              backgroundColor: '#fffbeb',
              color: '#b45309',
              border: '1px solid #fde68a',
              fontWeight: 700,
              padding: '0.18rem 0.5rem',
              borderRadius: '4px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              flexShrink: 0,
            }}
          >
            <Copy size={12} /> {totalClusterCount.toLocaleString()} Clusters
          </span>
        </div>

        {displayItems.length === 0 ? (
          <div style={{ padding: '1.5rem 0.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            No duplicate clusters detected in the active dataset.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '0.5rem 0', fontWeight: 600 }}>Cluster</th>
                  <th style={{ padding: '0.5rem 0', fontWeight: 600, textAlign: 'center' }}>Items</th>
                  <th style={{ padding: '0.5rem 0', fontWeight: 600, textAlign: 'right' }}>Total Value</th>
                </tr>
              </thead>
              <tbody>
                {displayItems.map((item, index) => (
                  <tr
                    key={item.id || index}
                    onClick={onViewAll}
                    style={{
                      borderBottom: index === displayItems.length - 1 ? 'none' : '1px solid var(--border-subtle)',
                      cursor: onViewAll ? 'pointer' : 'default',
                    }}
                  >
                    <td style={{ padding: '0.6rem 0', fontWeight: 600, color: 'var(--text-primary)' }}>
                      <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '210px' }} title={item.canonicalTitle}>
                        {item.canonicalTitle}
                      </div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                        {item.patternType} · {item.distinctAgencies} MDA{item.distinctAgencies > 1 ? 's' : ''}
                      </div>
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.6rem 0', color: 'var(--text-primary)', fontWeight: 700, textAlign: 'center' }}>
                      {item.count}
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.6rem 0', fontWeight: 700, color: 'var(--accent-primary)', textAlign: 'right' }}>
                      {formatNairaShort(item.totalAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)', marginTop: '0.5rem' }}>
        <button
          type="button"
          onClick={onViewAll}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            fontSize: '0.78rem',
            color: 'var(--accent-primary)',
            fontWeight: 600,
            cursor: onViewAll ? 'pointer' : 'default',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
          }}
        >
          Inspect all {totalClusterCount.toLocaleString()} duplicate clusters <ArrowRight size={13} />
        </button>
      </div>
    </div>
  );
};
