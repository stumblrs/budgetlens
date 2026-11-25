import React from 'react';
import {
  ShieldCheck,
  FileCheck,
  Cpu,
  Eye,
  ExternalLink,
  Layers,
  Scale,
  Database,
} from 'lucide-react';

interface TransparencyCardProps {
  onOpenMethodology?: () => void;
}

export const TransparencyCard: React.FC<TransparencyCardProps> = ({ onOpenMethodology }) => {
  const pillars = [
    {
      icon: <FileCheck size={15} color="#059669" />,
      title: '468 Budget PDFs + 36 OAuGF Audit Reports',
      detail: '64-character SHA-256 cryptographic checksums across FY 1999–2026 schedules & 11,372 OAuGF pages.',
    },
    {
      icon: <Database size={15} color="#2563eb" />,
      title: '6 Independent Public Ledgers Cross-Joined',
      detail: 'Appropriation Acts, Bill-vs-Act Diffs, BIR Releases, NOCOPO Contracts (98,866), Open Treasury Vouchers (467,763), and DMO Debt (505).',
    },
    {
      icon: <Eye size={15} color="#d97706" />,
      title: 'Evidence Engine v3.0 (22 Deterministic Rules)',
      detail: '16 domain/unit-cost rules + 6 cross-ledger forensic rules (49,679 verified findings across 28 years & ₦24.57T scrutiny baseline).',
    },
    {
      icon: <Cpu size={15} color="#7c3aed" />,
      title: 'AI Explains Evidence — Never Decides Verdicts',
      detail: 'Every irregularity cites its exact official schedule page, voucher number, OCID, or OAuGF audit report page.',
    },
  ];

  return (
    <div
      className="dossier-card"
      style={{
        padding: '1.25rem 1.4rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.9rem',
        background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.6rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              backgroundColor: '#ecfdf5',
              border: '1px solid #a7f3d0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ShieldCheck size={18} color="#059669" />
          </div>
          <div>
            <h3
              className="font-editorial"
              style={{
                fontSize: '1.06rem',
                fontWeight: 600,
                color: 'var(--text-primary)',
                margin: 0,
              }}
            >
              Cryptographic Provenance, 6-Ledger Architecture &amp; Methodological Trust
            </h3>
            <p style={{ fontSize: '0.73rem', color: 'var(--text-muted)', margin: '0.1rem 0 0' }}>
              CC BY 4.0 Open Fiscal Observability · Zero Fabrication Guarantee
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
          <span
            className="font-mono"
            style={{
              fontSize: '0.66rem',
              backgroundColor: '#ecfdf5',
              color: '#047857',
              border: '1px solid #a7f3d0',
              padding: '0.2rem 0.55rem',
              borderRadius: '999px',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
            }}
          >
            <Layers size={11} /> 6 LEDGERS VERIFIED
          </span>
          <a
            href="?tab=methodology"
            onClick={(e) => {
              e.preventDefault();
              onOpenMethodology?.();
            }}
            className="editorial-btn-primary"
            style={{
              textDecoration: 'none',
              fontSize: '0.75rem',
              padding: '0.36rem 0.75rem',
            }}
          >
            <Scale size={13} /> Inspect Sources &amp; Methodology <ExternalLink size={12} />
          </a>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(235px, 1fr))',
          gap: '0.7rem',
        }}
      >
        {pillars.map((p) => (
          <div
            key={p.title}
            style={{
              padding: '0.7rem 0.85rem',
              borderRadius: '8px',
              backgroundColor: '#ffffff',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.25rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: '0.8rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
              }}
            >
              {p.icon}
              <span>{p.title}</span>
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
              {p.detail}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
