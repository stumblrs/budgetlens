import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, FileText, Hash, Link2, Quote, ShieldCheck, X } from 'lucide-react';
import { getPresidentForYear } from '../data/presidentialTerms';
import type { RegistryDocument } from '../services/budgetDatabaseEngine';
import { buildCanonicalPermalink, readForensicsUrlState, readPaddingUrlState, readScrutinyUrlState } from '../utils/urlState';
import {
  CITATION_STYLES,
  CitationStyle,
  OBSERVATORY_MODULE_LABELS,
  ProvenanceManifestResponse,
  formatViewCitations,
  loadSourceProvenance,
  resolveYearProvenance,
} from '../utils/citationFormatter';

interface ViewCitationModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: string;
  selectedYear: number;
  registryDocs: RegistryDocument[];
  totalRecordsInYear?: number;
  searchQuery?: string;
}

export const ViewCitationModal: React.FC<ViewCitationModalProps> = ({
  isOpen,
  onClose,
  activeTab,
  selectedYear,
  registryDocs,
  totalRecordsInYear,
  searchQuery,
}) => {
  const [style, setStyle] = useState<CitationStyle>('newsroom');
  const [manifest, setManifest] = useState<ProvenanceManifestResponse | null>(null);
  const [copiedKey, setCopiedKey] = useState<'cite' | 'link' | 'sha' | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    loadSourceProvenance().then((data) => {
      if (active && data) setManifest(data);
    });
    return () => {
      active = false;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const registryDoc = useMemo(
    () => registryDocs.find((d) => (d.financial_year || d.financialYear) === selectedYear),
    [registryDocs, selectedYear]
  );

  const provenance = useMemo(
    () => resolveYearProvenance(manifest, selectedYear, registryDoc),
    [manifest, selectedYear, registryDoc]
  );

  const canonicalPermalink = isOpen
    ? buildCanonicalPermalink({ tab: activeTab, year: selectedYear }) ||
      (typeof window !== 'undefined' ? window.location.href : 'https://budgetlens.ng')
    : 'https://budgetlens.ng';

  const activeFilters = useMemo(() => {
    if (!isOpen) return undefined;
    if (activeTab === 'scrutiny') {
      const s = readScrutinyUrlState();
      return {
        president: s.president,
        pillar: s.pillar,
        scrutinyYear: String(s.sy),
        currency: s.currency,
        searchQuery: s.sq || searchQuery || undefined,
      };
    }
    if (activeTab === 'forensics') {
      const f = readForensicsUrlState();
      return {
        forensicsSubTab: f.fsub,
        searchQuery: searchQuery || undefined,
      };
    }
    if (activeTab === 'padding') {
      const p = readPaddingUrlState();
      return {
        diffFilter: p.diffFilter,
        searchQuery: searchQuery || undefined,
      };
    }
    return searchQuery?.trim() ? { searchQuery } : undefined;
  }, [isOpen, activeTab, searchQuery]);

  const citations = useMemo(
    () =>
      formatViewCitations({
        activeTab,
        financialYear: selectedYear,
        permalink: canonicalPermalink,
        provenance,
        totalIndexedYears: registryDocs.length,
        totalRecordsInYear,
        activeFilters,
      }),
    [activeTab, selectedYear, canonicalPermalink, provenance, registryDocs.length, totalRecordsInYear, activeFilters]
  );

  if (!isOpen) return null;

  const president = getPresidentForYear(selectedYear);
  const mod = OBSERVATORY_MODULE_LABELS[activeTab] || OBSERVATORY_MODULE_LABELS.overview;

  const triggerCopy = (key: 'cite' | 'link' | 'sha', text: string) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 1800);
  };

  return (
    <div
      className="mobile-sheet-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(9, 16, 23, 0.72)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.25rem',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Cite Current Observatory View"
        onClick={(e) => e.stopPropagation()}
        className="dossier-card mobile-sheet-panel"
        style={{
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90dvh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <div className="mobile-sheet-handle" />
        {/* Dark Obsidian Modal Header */}
        <div
          style={{
            padding: '1rem 1.35rem',
            backgroundColor: '#091017',
            color: '#ffffff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
            <Quote size={17} color="#10b981" style={{ flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <h3 className="font-editorial" style={{ margin: 0, fontSize: '1.08rem', fontWeight: 600 }}>
                Cite Current Observatory View
              </h3>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.1rem' }}>
                {mod.group} · {mod.label} · FY {selectedYear}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close citation modal"
            style={{ background: 'none', border: 'none', color: '#94a3b8', display: 'flex', padding: '0.2rem' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.15rem 1.35rem', flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Source Provenance & Scope Panel */}
          <div
            style={{
              backgroundColor: 'var(--card-subtle)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              padding: '0.9rem 1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.65rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                <ShieldCheck size={15} color="var(--emerald-primary)" />
                Cryptographic View Provenance
              </span>
              <span
                className="editorial-pill"
                style={{ backgroundColor: 'var(--emerald-bg)', color: '#047857', border: '1px solid #a7f3d0' }}
              >
                {president.presidentName} ({president.termLabel})
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.6rem', fontSize: '0.75rem' }}>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Primary Federal Schedule
                </div>
                <div className="font-mono" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '0.12rem', wordBreak: 'break-word' }}>
                  <FileText size={13} color="var(--emerald-primary)" style={{ flexShrink: 0 }} />
                  <span>
                    {provenance.filename}
                    {provenance.fileCountForYear > 1 ? ` (+${provenance.fileCountForYear - 1} schedules)` : ''}
                  </span>
                </div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Verified Scope
                </div>
                <div className="font-mono" style={{ fontWeight: 600, color: 'var(--text-primary)', marginTop: '0.12rem' }}>
                  FY {selectedYear} · {(totalRecordsInYear || 0).toLocaleString()} items
                  {provenance.pageCount ? ` · ${provenance.pageCount.toLocaleString()} pp.` : ''}
                </div>
              </div>
            </div>

            {/* SHA-256 Digest Box */}
            <div
              style={{
                backgroundColor: 'var(--card-bg)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '0.55rem 0.75rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.6rem',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ minWidth: 0, flex: '1 1 300px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.66rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <Hash size={11} color="var(--emerald-primary)" /> Source Document SHA-256 Checksum
                </div>
                <div className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-primary)', wordBreak: 'break-all', marginTop: '0.1rem', userSelect: 'all' }}>
                  {provenance.sha256 || 'Registry SHA-256 digest unavailable for offline snapshot.'}
                </div>
              </div>
              {provenance.sha256 && (
                <button
                  type="button"
                  onClick={() => triggerCopy('sha', provenance.sha256 || '')}
                  className="editorial-btn"
                  style={{ flexShrink: 0, fontSize: '0.71rem', padding: '0.3rem 0.6rem' }}
                >
                  {copiedKey === 'sha' ? <Check size={12} color="#059669" /> : <Copy size={12} />}
                  {copiedKey === 'sha' ? 'SHA Copied' : 'Copy SHA-256'}
                </button>
              )}
            </div>

            {/* Live Permalink */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', fontSize: '0.71rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', minWidth: 0, flex: '1 1 260px' }}>
                <Link2 size={13} color="var(--emerald-primary)" style={{ flexShrink: 0 }} />
                <span className="font-mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={canonicalPermalink}>
                  {canonicalPermalink}
                </span>
              </div>
              <button
                type="button"
                onClick={() => triggerCopy('link', canonicalPermalink)}
                className="editorial-btn"
                style={{ flexShrink: 0, fontSize: '0.71rem', padding: '0.28rem 0.6rem' }}
              >
                {copiedKey === 'link' ? <Check size={12} color="#059669" /> : <Link2 size={12} />}
                {copiedKey === 'link' ? 'Copied' : 'Copy Permalink'}
              </button>
            </div>
          </div>

          {/* 4-Format Switcher */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Citation Format
              </span>
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                {CITATION_STYLES.map((opt) => {
                  const active = style === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setStyle(opt.id)}
                      className="editorial-pill"
                      style={{
                        border: active ? '1px solid var(--emerald-primary)' : '1px solid var(--border-color)',
                        backgroundColor: active ? 'var(--emerald-bg)' : 'var(--card-bg)',
                        color: active ? '#047857' : 'var(--text-secondary)',
                        fontWeight: active ? 700 : 500,
                        padding: '0.28rem 0.65rem',
                      }}
                    >
                      {opt.shortLabel}
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              className={style === 'bibtex' ? 'font-mono' : undefined}
              style={{
                backgroundColor: '#0f1822',
                color: '#e2e8f0',
                border: '1px solid #1e293b',
                borderRadius: '8px',
                padding: '0.9rem 1rem',
                fontSize: style === 'bibtex' ? '0.72rem' : '0.79rem',
                lineHeight: 1.55,
                whiteSpace: style === 'bibtex' ? 'pre-wrap' : 'normal',
                wordBreak: 'break-word',
                userSelect: 'all',
              }}
            >
              {citations[style]}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {CITATION_STYLES.find((s) => s.id === style)?.audience} · Reference copied as plain text
            </div>
          </div>

          {/* Footer Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', paddingTop: '0.25rem' }}>
            <button type="button" onClick={onClose} className="editorial-btn">
              Close
            </button>
            <button
              type="button"
              onClick={() => triggerCopy('cite', citations[style])}
              className="editorial-btn-primary"
            >
              {copiedKey === 'cite' ? <Check size={14} color="#34d399" /> : <Copy size={14} />}
              {copiedKey === 'cite' ? 'Citation Copied' : `Copy ${CITATION_STYLES.find((s) => s.id === style)?.shortLabel} Citation`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
