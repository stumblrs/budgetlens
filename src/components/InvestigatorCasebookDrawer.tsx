import React from 'react';
import {
  ArrowDown,
  ArrowUp,
  Briefcase,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FolderOpen,
  Trash2,
  X,
} from 'lucide-react';
import { computeCasebookMetrics, useCasebook } from '../context/CasebookContext';
import {
  exportCasebookDossierDocx,
  exportCasebookDossierPdf,
} from '../utils/documentExporter';
import { buildCanonicalPermalink } from '../utils/urlState';
import { ExpandableText } from './ExpandableText';

interface InvestigatorCasebookDrawerProps {
  onOpenStudio: () => void;
}

function formatNairaCompact(amt: number): string {
  const abs = Math.abs(amt || 0);
  if (abs >= 1e12) return `₦${(amt / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `₦${(amt / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `₦${(amt / 1e6).toFixed(2)}M`;
  return `₦${Math.round(amt || 0).toLocaleString()}`;
}

export const InvestigatorCasebookDrawer: React.FC<InvestigatorCasebookDrawerProps> = ({
  onOpenStudio,
}) => {
  const {
    casebooks,
    activeCasebook,
    switchCasebook,
    isDrawerOpen,
    setDrawerOpen,
    removePin,
    movePin,
    updatePinNote,
  } = useCasebook();

  if (!isDrawerOpen) return null;

  const metrics = computeCasebookMetrics(activeCasebook.pins);
  const permalink = buildCanonicalPermalink({ tab: 'casebook' });

  return (
    <div
      onClick={() => setDrawerOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(9, 16, 23, 0.55)',
        backdropFilter: 'blur(3px)',
        zIndex: 1100,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        aria-label="Investigator Casebook Drawer"
        style={{
          width: 'min(480px, 100vw)',
          height: '100dvh',
          backgroundColor: '#f5f4f0',
          borderLeft: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-12px 0 36px rgba(15, 23, 42, 0.22)',
        }}
      >
        {/* Drawer Header */}
        <div
          style={{
            padding: 'calc(1rem + var(--safe-top, 0px)) 1.25rem 1rem',
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
            <Briefcase size={18} color="#34d399" />
            <div>
              <h3 className="font-editorial" style={{ margin: 0, fontSize: '1.08rem', fontWeight: 600 }}>
                Investigator Casebook
              </h3>
              <div className="font-mono" style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                {metrics.totalPins} pinned · {formatNairaCompact(metrics.totalExposureNaira)} exposure
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close casebook drawer"
            style={{ background: 'none', border: 'none', color: '#94a3b8', padding: '0.25rem' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Active Casebook Switcher */}
        <div
          style={{
            padding: '0.75rem 1.15rem',
            backgroundColor: '#ffffff',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
          }}
        >
          <select
            aria-label="Select active casebook"
            value={activeCasebook.id}
            onChange={(e) => switchCasebook(e.target.value)}
            style={{
              flex: 1,
              padding: '0.38rem 0.6rem',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              fontSize: '0.78rem',
              fontWeight: 600,
            }}
          >
            {casebooks.map((cb) => (
              <option key={cb.id} value={cb.id}>
                {cb.name} ({cb.pins.length})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => {
              setDrawerOpen(false);
              onOpenStudio();
            }}
            className="editorial-btn"
            style={{ fontSize: '0.72rem' }}
          >
            <FolderOpen size={13} /> Studio
          </button>
        </div>

        {/* Pinned Items Feed */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0.95rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {activeCasebook.pins.length === 0 ? (
            <div className="dossier-card" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              No evidence pinned yet. Use <strong>Pin to Casebook</strong> across Evidence Modals, Bill vs. Act Diff,
              Statistical Forensics, or Duplicate Rings to assemble a multi-year dossier.
            </div>
          ) : (
            activeCasebook.pins.map((pin) => (
              <div key={pin.pinId} className="dossier-card" style={{ padding: '0.85rem 0.95rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.4rem' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', alignItems: 'center' }}>
                    <span className="editorial-pill font-mono" style={{ fontSize: '0.64rem', backgroundColor: '#ecfdf5', color: '#047857', borderColor: '#a7f3d0' }}>
                      FY {pin.financialYear}
                    </span>
                    <span className="editorial-pill font-mono" style={{ fontSize: '0.62rem' }}>
                      {pin.kind}
                    </span>
                    {pin.projectCode && (
                      <span className="font-mono" style={{ fontSize: '0.66rem', fontWeight: 700, color: '#059669' }}>
                        {pin.projectCode}
                      </span>
                    )}
                    {pin.ledgerProvenance?.ledgerTags?.map((tag) => (
                      <span
                        key={tag}
                        className="font-mono"
                        style={{
                          fontSize: '0.58rem',
                          fontWeight: 700,
                          padding: '0.08rem 0.34rem',
                          borderRadius: '4px',
                          backgroundColor: '#fef2f2',
                          color: '#991b1b',
                          border: '1px solid #fecaca',
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '0.2rem' }}>
                    <button type="button" onClick={() => movePin(pin.pinId, 'up')} title="Move up" style={{ background: 'none', border: 'none', color: '#64748b' }}>
                      <ArrowUp size={13} />
                    </button>
                    <button type="button" onClick={() => movePin(pin.pinId, 'down')} title="Move down" style={{ background: 'none', border: 'none', color: '#64748b' }}>
                      <ArrowDown size={13} />
                    </button>
                    <button type="button" onClick={() => removePin(pin.pinId)} title="Remove pin" style={{ background: 'none', border: 'none', color: '#dc2626' }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  <ExpandableText text={pin.title} maxChars={140} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  <span>{pin.mdaName}</span>
                  <strong className="font-mono" style={{ color: '#047857' }}>{formatNairaCompact(pin.amountNaira)}</strong>
                </div>

                <input
                  type="text"
                  placeholder="Add analyst note..."
                  value={pin.analystNote}
                  onChange={(e) => updatePinNote(pin.pinId, e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.35rem 0.55rem',
                    borderRadius: '5px',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.74rem',
                    backgroundColor: '#faf9f6',
                  }}
                />
              </div>
            ))
          )}
        </div>

        {/* Footer Export Actions (PDF & DOCX Only) */}
        <div
          style={{
            padding: '0.85rem 1.15rem calc(0.85rem + var(--safe-bottom, 0px))',
            backgroundColor: '#ffffff',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            gap: '0.5rem',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            disabled={activeCasebook.pins.length === 0}
            onClick={() => exportCasebookDossierPdf({ casebook: activeCasebook, permalink })}
            className="editorial-btn-primary"
            style={{ flex: 1, justifyContent: 'center' }}
          >
            <Download size={13} /> Export PDF Dossier
          </button>
          <button
            type="button"
            disabled={activeCasebook.pins.length === 0}
            onClick={() => exportCasebookDossierDocx({ casebook: activeCasebook, permalink })}
            className="editorial-btn"
            style={{ flex: 1, justifyContent: 'center' }}
          >
            <FileSpreadsheet size={13} /> Export DOCX
          </button>
          <button
            type="button"
            onClick={() => {
              setDrawerOpen(false);
              onOpenStudio();
            }}
            className="editorial-btn"
            title="Open Full Casebook Studio"
          >
            <ExternalLink size={13} />
          </button>
        </div>
      </aside>
    </div>
  );
};
