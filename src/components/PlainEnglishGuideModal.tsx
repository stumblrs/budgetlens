import React, { useMemo, useState } from 'react';
import { BookOpen, Search, X } from 'lucide-react';

interface PlainEnglishGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface GlossaryEntry {
  term: string;
  category: 'Budget Basics' | 'Forensic Flags' | 'Data & Provenance';
  plainMeaning: string;
  whatToLookFor: string;
}

const GLOSSARY_ENTRIES: GlossaryEntry[] = [
  {
    term: 'Appropriation Act vs. Executive Bill',
    category: 'Budget Basics',
    plainMeaning:
      'The Executive Bill is the budget proposal the President submits to the National Assembly. The Appropriation Act is the final signed law after lawmakers review and amend it.',
    whatToLookFor:
      'Use Bill vs. Act Diff (?tab=padding) to see which projects were added, increased, or cut between the proposal and the enacted law.',
  },
  {
    term: 'Budget Padding (Inserted / Inflated / Cut)',
    category: 'Forensic Flags',
    plainMeaning:
      'Inserted means a brand-new project appeared in the enacted Act that was never in the Executive Bill. Inflated means an existing project kept its name/code but its Naira amount jumped.',
    whatToLookFor:
      'Look for large insertions into unrelated ministries (e.g., agricultural or water agencies funding urban streetlights or training).',
  },
  {
    term: 'Zonal Intervention Projects (ZIP)',
    category: 'Budget Basics',
    plainMeaning:
      'Often called constituency projects — allocations nominated by National Assembly members for specific Senatorial Districts or Federal Constituencies.',
    whatToLookFor:
      'Check if a ZIP item names a clear LGA/constituency and whether multiple agencies received duplicate lines for the same deliverable.',
  },
  {
    term: "Benford's Law & Nigrini MAD Score",
    category: 'Forensic Flags',
    plainMeaning:
      'In natural financial figures, smaller leading digits (1, 2, 3) appear much more often than 8 or 9. MAD (Mean Absolute Deviation) measures how far a budget year strays from that natural curve.',
    whatToLookFor:
      'MAD <= 0.006 is Close Conformity, <= 0.012 is Acceptable, and > 0.015 flags Non-Conformity (lots of rounded or copy-pasted estimates). Note: small summary years (<30 rows) are guarded automatically.',
  },
  {
    term: 'Premature Asset Replacement',
    category: 'Forensic Flags',
    plainMeaning:
      'Flags ministries budgeting to buy durable assets (vehicles, generators, hospital or ICT gear) repeatedly within fewer years than their expected lifespan.',
    whatToLookFor:
      'Consumables (stationery, fuel, food) are excluded. Look at the gap between purchase years and total cumulative spend.',
  },
  {
    term: 'Virements & Service-Wide Votes',
    category: 'Budget Basics',
    plainMeaning:
      'Lump-sum contingency pools or mid-year transfers used to shift funds across budget lines without the usual line-by-line project breakdown.',
    whatToLookFor:
      'High Service-Wide or contingency totals mean large amounts of spending lack project-level location details.',
  },
  {
    term: 'Disguised Rewording & Cross-MDA Rings',
    category: 'Forensic Flags',
    plainMeaning:
      'Two or more budget lines that describe the exact same physical deliverable using slightly swapped words (e.g., "Construction of Borehole" vs. "Provision of Boreholes") or appear under different ministries.',
    whatToLookFor:
      'Expand a cluster in Duplicate Detector (?tab=duplicates) or AI Assistant Duplicate Hunter to compare the MDAs, states, and page citations side by side.',
  },
  {
    term: 'Appropriated vs. Released vs. Cash-Backed (BIR)',
    category: 'Budget Basics',
    plainMeaning:
      'Appropriated is what the budget authorized on paper. Released / Cash-Backed (from Budget Implementation Reports) is the actual money released for spending.',
    whatToLookFor:
      'A 15% release rate means 85% of the approved capital budget was never released — even if the budget looked huge on paper.',
  },
  {
    term: 'Coverage Tiers & SHA-256 Provenance',
    category: 'Data & Provenance',
    plainMeaning:
      'FULL_SCHEDULE means full line-item pages were extracted; PARTIAL_SCHEDULE means partial recovery; SUMMARY_ACT_ONLY means only high-level statutory summary tables exist on disk. SHA-256 is the exact cryptographic fingerprint of the source PDF.',
    whatToLookFor:
      'Every citation includes the exact PDF filename, page number, and SHA-256 fingerprint so journalists and lawyers can verify it independently.',
  },
];

export const PlainEnglishGuideModal: React.FC<PlainEnglishGuideModalProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<'ALL' | GlossaryEntry['category']>('ALL');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GLOSSARY_ENTRIES.filter((entry) => {
      if (cat !== 'ALL' && entry.category !== cat) return false;
      if (!q) return true;
      return `${entry.term} ${entry.plainMeaning} ${entry.whatToLookFor}`.toLowerCase().includes(q);
    });
  }, [query, cat]);

  if (!isOpen) return null;

  return (
    <div
      className="mobile-sheet-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(9, 16, 23, 0.65)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Plain-English Observatory Guide"
        className="mobile-sheet-panel"
        style={{
          width: '100%',
          maxWidth: '780px',
          maxHeight: '88dvh',
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.3)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div className="mobile-sheet-handle" />
        <div
          style={{
            padding: '1.1rem 1.35rem',
            backgroundColor: '#091017',
            color: '#ffffff',
            borderBottom: '3px solid #059669',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
            <BookOpen size={18} color="#34d399" />
            <div>
              <h2 className="font-editorial" style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600 }}>
                Plain-English Budget &amp; Forensics Guide
              </h2>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                Clear explanations of every term, metric, and red flag used across BudgetLens
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close guide"
            style={{ background: 'none', border: 'none', color: '#94a3b8', padding: '0.25rem' }}
          >
            <X size={18} />
          </button>
        </div>

        <div
          style={{
            padding: '0.85rem 1.35rem',
            backgroundColor: 'var(--bg-secondary)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.55rem',
            alignItems: 'center',
          }}
        >
          <div style={{ position: 'relative', flex: '1 1 220px' }}>
            <Search size={13} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search terms (e.g. Benford, padding, virement, ZIP)..."
              style={{
                width: '100%',
                padding: '0.42rem 0.7rem 0.42rem 2rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                fontSize: '0.78rem',
                backgroundColor: '#ffffff',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            {(['ALL', 'Budget Basics', 'Forensic Flags', 'Data & Provenance'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCat(c)}
                style={{
                  padding: '0.32rem 0.62rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  backgroundColor: cat === c ? '#091017' : '#ffffff',
                  color: cat === c ? '#ffffff' : 'var(--text-secondary)',
                }}
              >
                {c === 'ALL' ? 'All Topics' : c}
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.35rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filtered.map((entry) => (
            <div
              key={entry.term}
              className="dossier-card"
              style={{ padding: '0.9rem 1.05rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {entry.term}
                </h3>
                <span className="editorial-pill font-mono" style={{ fontSize: '0.64rem', backgroundColor: 'var(--emerald-bg)', color: '#047857', borderColor: '#a7f3d0' }}>
                  {entry.category}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {entry.plainMeaning}
              </p>
              <div style={{ fontSize: '0.75rem', color: '#065f46', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '0.4rem 0.6rem', marginTop: '0.15rem' }}>
                <strong>What to look for:</strong> {entry.whatToLookFor}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
