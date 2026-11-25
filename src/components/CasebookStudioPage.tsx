import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Briefcase,
  Download,
  FileSpreadsheet,
  Plus,
  Scale,
  ShieldAlert,
  Tag,
  Trash2,
} from 'lucide-react';
import {
  ALL_CASEBOOK_LEDGER_TAGS,
  computeCasebookMetrics,
  useCasebook,
  type Casebook,
  type CasebookLedgerProvenance,
  type CasebookLedgerTag,
  type CasebookPin,
} from '../context/CasebookContext';
import {
  exportCasebookDossierDocx,
  exportCasebookDossierPdf,
} from '../utils/documentExporter';
import {
  loadEvidenceEngineAllYears,
  lookupMdaRiskProfile,
  type CrossLedgerContextWire,
} from '../utils/evidenceEngineV3';
import { extractCanonicalProjectCode } from '../utils/ruleEngine';
import { buildCanonicalPermalink } from '../utils/urlState';
import { ExpandableText } from './ExpandableText';

function formatNairaCompact(amt: number): string {
  const abs = Math.abs(amt || 0);
  if (abs >= 1e12) return `₦${(amt / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `₦${(amt / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `₦${(amt / 1e6).toFixed(2)}M`;
  return `₦${Math.round(amt || 0).toLocaleString()}`;
}

const LEDGER_TAG_STYLES: Record<CasebookLedgerTag, { bg: string; color: string; border: string }> = {
  'OAuGF Query': { bg: '#fef2f2', color: '#991b1b', border: '#fecaca' },
  'Treasury Cash': { bg: '#fff1f2', color: '#be123c', border: '#fecdd3' },
  'Bill Insertion': { bg: '#fffbeb', color: '#92400e', border: '#fde68a' },
  'Paid on Paper': { bg: '#fee2e2', color: '#7f1d1d', border: '#fca5a5' },
  'Compound Risk': { bg: '#fdf4ff', color: '#86198f', border: '#f5d0fe' },
  'Zombie Lineage': { bg: '#eff6ff', color: '#1e40af', border: '#bfdbfe' },
};

function resolvePinLedgerProvenance(
  pin: CasebookPin,
  ctx: CrossLedgerContextWire | null
): CasebookLedgerProvenance {
  const existing = pin.ledgerProvenance || {};
  const tagSet = new Set<CasebookLedgerTag>(existing.ledgerTags || []);
  const mdaProf = lookupMdaRiskProfile(ctx, pin.mdaName);
  const ucode = extractCanonicalProjectCode(pin.projectCode, pin.title);

  const paidOnPaper = Boolean(
    existing.paidOnPaper || (ucode && ctx?.paidOnPaperCodes?.includes(ucode))
  );
  const billInserted = Boolean(
    existing.billInsertionStatus || (ucode && ctx?.billInsertionCodes?.includes(ucode))
  );
  const zombie = Boolean(ucode && ctx?.zombieLineageCodes?.includes(ucode));
  const oaugfQueryCount = existing.oaugfQueryCount ?? mdaProf?.oi ?? 0;
  const oaugfRepeatCount = existing.oaugfRepeatCount ?? mdaProf?.or ?? 0;
  const personalOrOpaqueCashFlag = Boolean(
    existing.personalOrOpaqueCashFlag || mdaProf?.po === 1 || pin.kind === 'treasury_cash'
  );
  const mdaIntegrityGrade = existing.mdaIntegrityGrade || mdaProf?.g || undefined;

  if (paidOnPaper) tagSet.add('Paid on Paper');
  if (billInserted || pin.kind === 'padding_diff') tagSet.add('Bill Insertion');
  if (oaugfQueryCount > 0 || pin.kind === 'oaugf_query') tagSet.add('OAuGF Query');
  if (personalOrOpaqueCashFlag) tagSet.add('Treasury Cash');
  if (zombie || pin.kind === 'lineage') tagSet.add('Zombie Lineage');
  if ((existing.triggeredRulesCount || 0) >= 2 || (existing.compoundRiskScore || 0) >= 50) {
    tagSet.add('Compound Risk');
  }

  return {
    ...existing,
    ledgerTags: Array.from(tagSet),
    oaugfQueryCount,
    oaugfRepeatCount,
    mdaIntegrityGrade,
    paidOnPaper,
    billInsertionStatus: existing.billInsertionStatus ?? (billInserted ? 'BILL_TO_ACT_ALTERED' : null),
    personalOrOpaqueCashFlag,
  };
}

export const CasebookStudioPage: React.FC = () => {
  const {
    casebooks,
    activeCasebook,
    createCasebook,
    switchCasebook,
    deleteCasebook,
    removePin,
    movePin,
    updatePinNote,
    updatePinTags,
    updatePinLedgerProvenance,
  } = useCasebook();

  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null);
  const [crossLedgerCtx, setCrossLedgerCtx] = useState<CrossLedgerContextWire | null>(null);
  const [activeLedgerFilter, setActiveLedgerFilter] = useState<'ALL' | CasebookLedgerTag>('ALL');

  useEffect(() => {
    let active = true;
    loadEvidenceEngineAllYears()
      .then((payload) => {
        if (active && payload?.crossLedgerContext) {
          setCrossLedgerCtx(payload.crossLedgerContext);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const enrichedPins = useMemo(
    () =>
      activeCasebook.pins.map((pin) => ({
        ...pin,
        ledgerProvenance: resolvePinLedgerProvenance(pin, crossLedgerCtx),
      })),
    [activeCasebook.pins, crossLedgerCtx]
  );

  const enrichedCasebook: Casebook = useMemo(
    () => ({
      ...activeCasebook,
      pins: enrichedPins,
    }),
    [activeCasebook, enrichedPins]
  );

  const filteredPins = useMemo(() => {
    if (activeLedgerFilter === 'ALL') return enrichedPins;
    return enrichedPins.filter((pin) =>
      (pin.ledgerProvenance?.ledgerTags || []).includes(activeLedgerFilter)
    );
  }, [enrichedPins, activeLedgerFilter]);

  const metrics = computeCasebookMetrics(enrichedPins);
  const permalink = buildCanonicalPermalink({ tab: 'casebook' });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    createCasebook(newName, newDesc);
    setNewName('');
    setNewDesc('');
  };

  const handleExport = async (format: 'pdf' | 'docx') => {
    setExportingFormat(format);
    try {
      if (format === 'pdf') {
        await exportCasebookDossierPdf({ casebook: enrichedCasebook, permalink });
      } else {
        await exportCasebookDossierDocx({ casebook: enrichedCasebook, permalink });
      }
    } finally {
      setExportingFormat(null);
    }
  };

  const togglePinLedgerTag = (pin: CasebookPin, tag: CasebookLedgerTag) => {
    const rawTags = new Set<CasebookLedgerTag>(pin.ledgerProvenance?.ledgerTags || []);
    if (rawTags.has(tag)) {
      rawTags.delete(tag);
    } else {
      rawTags.add(tag);
    }
    updatePinLedgerProvenance(pin.pinId, {
      ...pin.ledgerProvenance,
      ledgerTags: Array.from(rawTags),
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="dossier-card" style={{ padding: '1.35rem 1.5rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.25rem' }}>
              <Briefcase size={14} style={{ color: 'var(--emerald-primary)' }} />
              <span className="font-mono" style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--emerald-primary)' }}>
                Publish &amp; Cite · Multi-Year Evidence Basket
              </span>
            </div>
            <h1 className="font-editorial" style={{ margin: 0, fontSize: '1.55rem', fontWeight: 600 }}>
              Investigator Casebook Studio
            </h1>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Collect, annotate, reorder, and export multi-year appropriation evidence across administrations into
              publication-ready PDF &amp; Word (.docx) investigative dossiers.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={activeCasebook.pins.length === 0 || exportingFormat !== null}
              onClick={() => handleExport('pdf')}
              className="editorial-btn-primary"
            >
              <Download size={14} />
              {exportingFormat === 'pdf' ? 'Generating PDF...' : 'Export Casebook Dossier (PDF)'}
            </button>
            <button
              type="button"
              disabled={activeCasebook.pins.length === 0 || exportingFormat !== null}
              onClick={() => handleExport('docx')}
              className="editorial-btn"
            >
              <FileSpreadsheet size={14} />
              {exportingFormat === 'docx' ? 'Generating DOCX...' : 'Export Casebook Dossier (DOCX)'}
            </button>
          </div>
        </div>

        {/* Casebook Switcher + Create Form */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', alignItems: 'center', marginTop: '1rem', paddingTop: '0.9rem', borderTop: '1px solid var(--border-subtle)' }}>
          <select
            value={activeCasebook.id}
            onChange={(e) => switchCasebook(e.target.value)}
            style={{ padding: '0.42rem 0.65rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.8rem', fontWeight: 700 }}
          >
            {casebooks.map((cb) => (
              <option key={cb.id} value={cb.id}>
                {cb.name} ({cb.pins.length} pins)
              </option>
            ))}
          </select>
          {casebooks.length > 1 && (
            <button
              type="button"
              onClick={() => deleteCasebook(activeCasebook.id)}
              className="editorial-btn"
              style={{ color: '#dc2626' }}
            >
              <Trash2 size={13} /> Delete Casebook
            </button>
          )}
          <form onSubmit={handleCreate} style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginLeft: 'auto' }}>
            <input
              type="text"
              placeholder="New casebook title..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{ padding: '0.4rem 0.65rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.78rem', width: '190px' }}
            />
            <input
              type="text"
              placeholder="Investigation brief..."
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              style={{ padding: '0.4rem 0.65rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.78rem', width: '210px' }}
            />
            <button type="submit" className="editorial-btn">
              <Plus size={13} /> New Casebook
            </button>
          </form>
        </div>
      </div>

      {/* 5-Metric KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: '0.85rem' }}>
        <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
            Pinned Evidence Items
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.45rem', fontWeight: 700, marginTop: '0.2rem' }}>
            {metrics.totalPins}
          </div>
        </div>
        <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
            Cumulative Exposure
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.45rem', fontWeight: 700, color: '#b45309', marginTop: '0.2rem' }}>
            {formatNairaCompact(metrics.totalExposureNaira)}
          </div>
        </div>
        <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
            Fiscal Years Covered
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.45rem', fontWeight: 700, marginTop: '0.2rem' }}>
            {metrics.uniqueYears.length > 0 ? metrics.uniqueYears.join(', ') : '—'}
          </div>
        </div>
        <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
            Distinct Agencies
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.45rem', fontWeight: 700, marginTop: '0.2rem' }}>
            {metrics.uniqueMdasCount}
          </div>
        </div>
        <div className="dossier-card" style={{ padding: '1rem 1.2rem', borderColor: '#fecaca', backgroundColor: '#fef2f2' }}>
          <div style={{ fontSize: '0.7rem', color: '#991b1b', textTransform: 'uppercase', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Scale size={12} /> 6-Ledger Cross-Links
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.45rem', fontWeight: 800, color: '#991b1b', marginTop: '0.2rem' }}>
            {metrics.crossLedgerTaggedCount}
          </div>
        </div>
      </div>

      {/* 6-Ledger Provenance Filter Strip */}
      {enrichedPins.length > 0 && (
        <div className="dossier-card" style={{ padding: '0.75rem 1.1rem', display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'center' }}>
          <span className="font-mono" style={{ fontSize: '0.68rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: '0.3rem', marginRight: '0.25rem' }}>
            <ShieldAlert size={13} color="#059669" /> Filter by 6-Ledger Signal:
          </span>
          <button
            type="button"
            onClick={() => setActiveLedgerFilter('ALL')}
            className="font-mono"
            style={{
              fontSize: '0.69rem',
              fontWeight: 700,
              padding: '0.24rem 0.58rem',
              borderRadius: '999px',
              border: `1px solid ${activeLedgerFilter === 'ALL' ? '#0f172a' : '#cbd5e1'}`,
              backgroundColor: activeLedgerFilter === 'ALL' ? '#0f172a' : '#f8fafc',
              color: activeLedgerFilter === 'ALL' ? '#ffffff' : '#334155',
              cursor: 'pointer',
            }}
          >
            All Pins ({enrichedPins.length})
          </button>
          {ALL_CASEBOOK_LEDGER_TAGS.map((tag) => {
            const cnt = metrics.ledgerTagCounts[tag] || 0;
            const tone = LEDGER_TAG_STYLES[tag];
            const active = activeLedgerFilter === tag;
            return (
              <button
                key={tag}
                type="button"
                onClick={() => setActiveLedgerFilter(active ? 'ALL' : tag)}
                className="font-mono"
                style={{
                  fontSize: '0.69rem',
                  fontWeight: 700,
                  padding: '0.24rem 0.58rem',
                  borderRadius: '999px',
                  border: `1px solid ${active ? tone.color : tone.border}`,
                  backgroundColor: active ? tone.color : tone.bg,
                  color: active ? '#ffffff' : tone.color,
                  cursor: 'pointer',
                  opacity: cnt === 0 && !active ? 0.6 : 1,
                }}
              >
                {tag} ({cnt})
              </button>
            );
          })}
        </div>
      )}

      {/* Pinned Evidence Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {filteredPins.length === 0 ? (
          <div className="dossier-card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            {activeCasebook.pins.length === 0
              ? 'This casebook has no pinned items yet. Pin records from Evidence Modals, Bill vs. Act Padding Diff, Statistical Forensics, or Duplicate Clusters.'
              : `No pinned exhibits carry the "${activeLedgerFilter}" 6-ledger provenance tag.`}
          </div>
        ) : (
          filteredPins.map((pin, idx) => {
            const prov = pin.ledgerProvenance;
            const provTags = prov?.ledgerTags || [];
            return (
            <div key={pin.pinId} className="dossier-card" style={{ padding: '1rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.25rem' }}>
                    <span className="font-mono" style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b' }}>
                      #{idx + 1}
                    </span>
                    <span className="editorial-pill font-mono" style={{ backgroundColor: '#ecfdf5', color: '#047857', borderColor: '#a7f3d0' }}>
                      FY {pin.financialYear} · {pin.presidentName}
                    </span>
                    <span className="editorial-pill font-mono">{pin.kind}</span>
                    {pin.projectCode && <span className="font-mono" style={{ fontWeight: 700, fontSize: '0.74rem', color: '#059669' }}>{pin.projectCode}</span>}
                    {provTags.map((tag) => {
                      const tone = LEDGER_TAG_STYLES[tag];
                      return (
                        <span
                          key={tag}
                          className="font-mono"
                          style={{
                            fontSize: '0.64rem',
                            fontWeight: 700,
                            padding: '0.1rem 0.42rem',
                            borderRadius: '4px',
                            backgroundColor: tone.bg,
                            color: tone.color,
                            border: `1px solid ${tone.border}`,
                          }}
                        >
                          {tag}
                          {tag === 'OAuGF Query' && prov?.oaugfQueryCount ? ` (${prov.oaugfQueryCount})` : ''}
                          {tag === 'Compound Risk' && prov?.compoundRiskScore ? ` (${prov.compoundRiskScore})` : ''}
                        </span>
                      );
                    })}
                    {prov?.mdaIntegrityGrade && prov.mdaIntegrityGrade !== 'N/A' && (
                      <span className="font-mono" style={{ fontSize: '0.64rem', fontWeight: 700, color: '#475569' }}>
                        MDA Grade {prov.mdaIntegrityGrade}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.96rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    <ExpandableText text={pin.title} maxChars={140} />
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                    {pin.mdaName} {pin.sourceFilename ? `· ${pin.sourceFilename}` : ''} {pin.page ? `(p.${pin.page})` : ''}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span className="font-mono tabular-nums" style={{ fontSize: '1.05rem', fontWeight: 700, color: '#047857' }}>
                    {formatNairaCompact(pin.amountNaira)}
                  </span>
                  <button type="button" onClick={() => movePin(pin.pinId, 'up')} className="editorial-btn" style={{ padding: '0.28rem 0.45rem' }}>
                    <ArrowUp size={13} />
                  </button>
                  <button type="button" onClick={() => movePin(pin.pinId, 'down')} className="editorial-btn" style={{ padding: '0.28rem 0.45rem' }}>
                    <ArrowDown size={13} />
                  </button>
                  <button type="button" onClick={() => removePin(pin.pinId)} className="editorial-btn" style={{ padding: '0.28rem 0.45rem', color: '#dc2626' }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {/* 6-Ledger Provenance Toggle Bar */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.32rem', alignItems: 'center', paddingTop: '0.15rem' }}>
                <span className="font-mono" style={{ fontSize: '0.64rem', fontWeight: 700, color: '#64748b', marginRight: '0.2rem' }}>
                  6-Ledger Tags:
                </span>
                {ALL_CASEBOOK_LEDGER_TAGS.map((tag) => {
                  const active = provTags.includes(tag);
                  const tone = LEDGER_TAG_STYLES[tag];
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => togglePinLedgerTag(pin, tag)}
                      className="font-mono"
                      style={{
                        fontSize: '0.63rem',
                        fontWeight: 600,
                        padding: '0.12rem 0.4rem',
                        borderRadius: '4px',
                        border: `1px solid ${active ? tone.color : '#e2e8f0'}`,
                        backgroundColor: active ? tone.bg : '#ffffff',
                        color: active ? tone.color : '#64748b',
                        cursor: 'pointer',
                      }}
                    >
                      {active ? '✓ ' : '+ '}
                      {tag}
                    </button>
                  );
                })}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.6rem' }}>
                <textarea
                  rows={2}
                  placeholder="Analyst commentary / audit notes..."
                  value={pin.analystNote}
                  onChange={(e) => updatePinNote(pin.pinId, e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.45rem 0.65rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.76rem',
                    backgroundColor: '#faf9f6',
                    resize: 'vertical',
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Tag size={13} color="#64748b" />
                  <input
                    type="text"
                    placeholder="Comma-separated tags (e.g. padding, suv, pac-review)..."
                    value={pin.tags.join(', ')}
                    onChange={(e) =>
                      updatePinTags(
                        pin.pinId,
                        e.target.value
                          .split(',')
                          .map((t) => t.trim())
                          .filter(Boolean)
                      )
                    }
                    style={{
                      flex: 1,
                      padding: '0.45rem 0.65rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.76rem',
                      backgroundColor: '#faf9f6',
                    }}
                  />
                </div>
              </div>
            </div>
            );
          })
        )}
      </div>
    </div>
  );
};
