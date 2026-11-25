import React, { useEffect, useMemo, useState } from 'react';
import { apiUrl, fetchDataset } from '../services/apiClient';
import {
  Building2,
  Download,
  ExternalLink,
  FileText,
  FileWarning,
  Repeat,
  Scale,
  Search,
  ShieldAlert,
} from 'lucide-react';
import {
  loadOaugfAuditIndex,
  type OaugfAuditFindingSample,
  type OaugfAuditIndexPayload,
} from '../utils/mdaScorecard';
import {
  exportOaugfNegligenceDocx,
  exportOaugfNegligencePdf,
} from '../utils/documentExporter';
import { buildCanonicalPermalink } from '../utils/urlState';
import { ExpandableText } from './ExpandableText';

type OaugfSubTab = 'issues' | 'mdas' | 'convergence' | 'reports';

interface ConvergenceIndexPayload {
  status: string;
  headline: {
    convergentContractorCount: number;
    highRisk3PlusContractorCount: number;
    convergentContractorExposureNaira: number;
    convergentMdaCount: number;
    highRisk3PlusMdaCount: number;
  };
  contractors: Array<{
    contractorName: string;
    bppContractorId?: string | null;
    flagCount: number;
    flags: string[];
    flagDetails: string[];
    totalExposureNaira: number;
    mdasInvolved: string[];
  }>;
  mdas: Array<{
    mdaName: string;
    flagCount: number;
    flags: string[];
    flagDetails: string[];
    compositeScore: number | null;
    grade: string;
    oaugfQueryCount: number;
    oaugfRepeatCount: number;
    totalExposureNaira: number;
  }>;
}

function fmtNairaCompact(amt: number | null | undefined): string {
  if (!amt || !Number.isFinite(amt)) return '—';
  if (amt >= 1e12) return `₦${(amt / 1e12).toFixed(2)}T`;
  if (amt >= 1e9) return `₦${(amt / 1e9).toFixed(2)}B`;
  if (amt >= 1e6) return `₦${(amt / 1e6).toFixed(1)}M`;
  return `₦${Math.round(amt).toLocaleString('en-US')}`;
}

export const OaugfNegligenceExplorer: React.FC = () => {
  const [payload, setPayload] = useState<OaugfAuditIndexPayload | null>(null);
  const [shardedIssues, setShardedIssues] = useState<OaugfAuditFindingSample[] | null>(null);
  const [convergence, setConvergence] = useState<ConvergenceIndexPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState<OaugfSubTab>('issues');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [yearFilter, setYearFilter] = useState<string>('ALL');
  const [repeatOnly, setRepeatOnly] = useState(false);
  const [recoveryOnly, setRecoveryOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(40);
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null);

  useEffect(() => {
    let active = true;
    fetchDataset<any>('red_flag_convergence_index')
      .then((c) => {
        if (active && c) setConvergence(c);
      })
      .catch(() => {});
    loadOaugfAuditIndex()
      .then((data) => {
        if (!active) return;
        setPayload(data);
        setLoading(false);
        fetch(apiUrl('/api/v1/forensics/oaugf?limit=200'))
          .then((r) => (r.ok ? r.json() : null))
          .then((apiRes) => {
            if (active && Array.isArray(apiRes?.findings) && apiRes.findings.length > 0) {
              setShardedIssues(apiRes.findings);
            }
          })
          .catch(() => {});
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const allIssues: OaugfAuditFindingSample[] = useMemo(() => {
    if (shardedIssues && shardedIssues.length > 0) return shardedIssues;
    if (!payload) return [];
    return payload.issues && payload.issues.length > 0 ? payload.issues : payload.topIssues || [];
  }, [payload, shardedIssues]);

  const filteredIssues = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allIssues.filter((it) => {
      if (categoryFilter !== 'ALL' && it.category !== categoryFilter) return false;
      if (yearFilter !== 'ALL' && String(it.year ?? '') !== yearFilter) return false;
      if (repeatOnly && !it.repeatNeglect) return false;
      if (recoveryOnly && !it.recoveryRequired) return false;
      if (!q) return true;
      const hay = `${it.heading} ${it.mdaName || ''} ${it.docTitle} ${it.excerpt} ${it.recommendation || ''} ${it.category}`.toLowerCase();
      return hay.includes(q);
    });
  }, [allIssues, query, categoryFilter, yearFilter, repeatOnly, recoveryOnly]);

  const mdaRows = useMemo(() => {
    if (!payload?.byMda) return [];
    const q = query.trim().toLowerCase();
    return Object.values(payload.byMda).filter((m) =>
      !q ? true : m.mdaName.toLowerCase().includes(q) || m.mdaKey.toLowerCase().includes(q)
    );
  }, [payload, query]);

  const reportDocs = useMemo(() => {
    if (!payload?.documents) return [];
    const q = query.trim().toLowerCase();
    return payload.documents.filter((d) =>
      !q ? true : d.title.toLowerCase().includes(q) || d.category.toLowerCase().includes(q)
    );
  }, [payload, query]);

  const handleExport = async (fmt: 'pdf' | 'docx') => {
    if (!payload) return;
    setExporting(fmt);
    try {
      const h = payload.headline;
      const spec = {
        filterSummary: [
          categoryFilter !== 'ALL' ? categoryFilter : 'All Categories',
          yearFilter !== 'ALL' ? `FY ${yearFilter}` : 'All Years (1999–2024)',
          repeatOnly ? 'Repeat Neglect Only' : '',
          recoveryOnly ? 'Recovery Directives Only' : '',
          query.trim() ? `Query="${query.trim()}"` : '',
        ]
          .filter(Boolean)
          .join(' | '),
        reportsIndexed: h.reportsIndexed,
        parsedAuditIssuesCount: h.parsedAuditIssuesCount,
        repeatNeglectCount: h.repeatNeglectCount || 0,
        recoveryDirectiveCount: h.recoveryDirectiveCount || 0,
        items: filteredIssues.slice(0, 50),
        permalink: buildCanonicalPermalink({ tab: 'oaugf' }),
      };
      if (fmt === 'pdf') await exportOaugfNegligencePdf(spec);
      else await exportOaugfNegligenceDocx(spec);
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading official Auditor-General audit archive...
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Official Auditor-General audit index is not yet available.
      </div>
    );
  }

  const h = payload.headline;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
      {/* Header Banner */}
      <div
        className="card"
        style={{
          padding: '1.25rem 1.4rem',
          background: 'linear-gradient(135deg, #7c2d12 0%, #1e293b 100%)',
          color: '#ffffff',
          border: 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.8rem' }}>
          <div style={{ maxWidth: '760px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', color: '#fed7aa', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
              <Scale size={13} /> Constitutional Audit Archive · Office of the Auditor-General (OAuGF)
            </div>
            <h2 className="font-editorial" style={{ fontSize: '1.42rem', fontWeight: 700, margin: 0, color: '#ffffff' }}>
              Official Audit Negligences, Repeat Offenders & Unacted Queries (1999–2024)
            </h2>
            <p style={{ margin: '0.45rem 0 0', fontSize: '0.84rem', color: '#e2e8f0', lineHeight: 1.5 }}>
              Every numbered audit query extracted from {h.reportsIndexed} official Auditor-General reports ({h.totalPages.toLocaleString('en-US')} pages) — exposing unvouched payments, unretired advances, due-process contract violations, and repeat queries ignored from prior years.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => handleExport('pdf')}
              disabled={exporting !== null}
              className="editorial-btn-primary"
              style={{ fontSize: '0.76rem', padding: '0.38rem 0.72rem' }}
            >
              <FileText size={13} /> {exporting === 'pdf' ? 'Exporting...' : 'Dossier PDF'}
            </button>
            <button
              type="button"
              onClick={() => handleExport('docx')}
              disabled={exporting !== null}
              className="editorial-btn"
              style={{ fontSize: '0.76rem', padding: '0.38rem 0.72rem', backgroundColor: '#ffffff', color: '#0f172a' }}
            >
              <Download size={13} color="#059669" /> {exporting === 'docx' ? 'Exporting...' : 'Dossier DOCX'}
            </button>
          </div>
        </div>

        {/* KPI Strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: '0.65rem', marginTop: '1rem' }}>
          <div style={{ padding: '0.7rem 0.85rem', borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.09)' }}>
            <div style={{ fontSize: '0.68rem', color: '#cbd5e1', fontWeight: 600 }}>PARSED AUDIT NEGLIGENCES</div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.2rem', fontWeight: 800, color: '#ffffff' }}>
              {h.parsedAuditIssuesCount.toLocaleString('en-US')}
            </div>
            <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Across {h.reportsIndexed} OAuGF reports</div>
          </div>
          <div style={{ padding: '0.7rem 0.85rem', borderRadius: '8px', backgroundColor: 'rgba(239, 68, 68, 0.22)', border: '1px solid rgba(252, 165, 165, 0.35)' }}>
            <div style={{ fontSize: '0.68rem', color: '#fecaca', fontWeight: 700 }}>REPEAT / IGNORED QUERIES</div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.2rem', fontWeight: 800, color: '#ffffff' }}>
              {(h.repeatNeglectCount || 0).toLocaleString('en-US')}
            </div>
            <div style={{ fontSize: '0.68rem', color: '#fecaca' }}>Recurred without action</div>
          </div>
          <div style={{ padding: '0.7rem 0.85rem', borderRadius: '8px', backgroundColor: 'rgba(245, 158, 11, 0.22)', border: '1px solid rgba(253, 230, 138, 0.35)' }}>
            <div style={{ fontSize: '0.68rem', color: '#fde68a', fontWeight: 700 }}>RECOVERY / SURCHARGE ORDERS</div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.2rem', fontWeight: 800, color: '#ffffff' }}>
              {(h.recoveryDirectiveCount || 0).toLocaleString('en-US')}
            </div>
            <div style={{ fontSize: '0.68rem', color: '#fde68a' }}>Refund, surcharge, or sanction</div>
          </div>
          <div style={{ padding: '0.7rem 0.85rem', borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.09)' }}>
            <div style={{ fontSize: '0.68rem', color: '#cbd5e1', fontWeight: 600 }}>MATCHED FEDERAL MDAs</div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.2rem', fontWeight: 800, color: '#ffffff' }}>
              {h.matchedMdasCount}
            </div>
            <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Years {h.yearsCovered[0]}–{h.yearsCovered[h.yearsCovered.length - 1]}</div>
          </div>
        </div>
      </div>

      {/* Category Filter Strip */}
      <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => { setCategoryFilter('ALL'); setVisibleCount(40); }}
          style={{
            padding: '0.35rem 0.7rem',
            borderRadius: '999px',
            border: categoryFilter === 'ALL' ? '1px solid #059669' : '1px solid var(--border-color)',
            backgroundColor: categoryFilter === 'ALL' ? '#ecfdf5' : 'var(--card-bg)',
            color: categoryFilter === 'ALL' ? '#047857' : 'var(--text-primary)',
            fontSize: '0.75rem',
            fontWeight: 700,
          }}
        >
          All Categories ({h.parsedAuditIssuesCount.toLocaleString('en-US')})
        </button>
        {Object.entries(h.categoryCounts || {}).map(([cat, count]) => {
          const active = categoryFilter === cat;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => { setCategoryFilter(active ? 'ALL' : cat); setSubTab('issues'); setVisibleCount(40); }}
              style={{
                padding: '0.35rem 0.7rem',
                borderRadius: '999px',
                border: active ? '1px solid #b45309' : '1px solid var(--border-color)',
                backgroundColor: active ? '#fffbeb' : 'var(--card-bg)',
                color: active ? '#92400e' : 'var(--text-secondary)',
                fontSize: '0.74rem',
                fontWeight: active ? 700 : 500,
              }}
            >
              {cat} ({count.toLocaleString('en-US')})
            </button>
          );
        })}
      </div>

      {/* Controls & Sub-tabs */}
      <div className="card" style={{ padding: '1rem 1.15rem' }}>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.85rem' }}>
          <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
            {(
              [
                { id: 'issues', label: `All Negligences (${filteredIssues.length.toLocaleString('en-US')})` },
                { id: 'mdas', label: `Repeat-Offender MDAs (${mdaRows.length})` },
                { id: 'convergence', label: `6-Ledger Convergence (${(convergence?.contractors.length || 0) + (convergence?.mdas.length || 0)})` },
                { id: 'reports', label: `Audit Reports (${reportDocs.length})` },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSubTab(t.id)}
                className={subTab === t.id ? 'editorial-btn-primary' : 'editorial-btn'}
                style={{ fontSize: '0.76rem', padding: '0.35rem 0.7rem' }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div style={{ position: 'relative', flex: '1 1 240px' }}>
            <Search size={14} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setVisibleCount(40); }}
              placeholder="Search MDA, unvouched, unretired, NDDC, COVID, FERMA..."
              style={{
                width: '100%',
                padding: '0.42rem 0.7rem 0.42rem 2rem',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                fontSize: '0.8rem',
              }}
            />
          </div>

          {subTab === 'issues' && (
            <>
              <select
                value={yearFilter}
                onChange={(e) => { setYearFilter(e.target.value); setVisibleCount(40); }}
                aria-label="Filter by Report Year"
                style={{
                  padding: '0.42rem 0.65rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.78rem',
                }}
              >
                <option value="ALL">All Years</option>
                {[...h.yearsCovered].reverse().map((yr) => (
                  <option key={yr} value={String(yr)}>{yr}</option>
                ))}
              </select>

              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.76rem', fontWeight: 600, color: '#991b1b', cursor: 'pointer' }}>
                <input type="checkbox" checked={repeatOnly} onChange={(e) => setRepeatOnly(e.target.checked)} />
                Repeat / Ignored Only
              </label>

              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.76rem', fontWeight: 600, color: '#92400e', cursor: 'pointer' }}>
                <input type="checkbox" checked={recoveryOnly} onChange={(e) => setRecoveryOnly(e.target.checked)} />
                Recovery / Surcharge Only
              </label>
            </>
          )}
        </div>

        {/* SUB-TAB 1: ALL ISSUES */}
        {subTab === 'issues' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {filteredIssues.slice(0, visibleCount).map((it, idx) => (
              <div
                key={`${it.docId || idx}-${it.page}-${idx}`}
                style={{
                  padding: '0.78rem 0.95rem',
                  borderRadius: '8px',
                  border: it.repeatNeglect ? '1px solid #fca5a5' : '1px solid var(--border-color)',
                  backgroundColor: it.repeatNeglect ? '#fef2f2' : 'var(--bg-secondary)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: '250px' }}>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.25rem' }}>
                      <span style={{ fontSize: '0.69rem', padding: '0.1rem 0.45rem', borderRadius: '999px', backgroundColor: '#fef3c7', color: '#92400e', fontWeight: 700 }}>
                        {it.category}
                      </span>
                      {it.repeatNeglect && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.22rem', fontSize: '0.69rem', padding: '0.1rem 0.45rem', borderRadius: '999px', backgroundColor: '#dc2626', color: '#ffffff', fontWeight: 700 }}>
                          <Repeat size={10} /> Repeat / Ignored
                        </span>
                      )}
                      {it.recoveryRequired && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.22rem', fontSize: '0.69rem', padding: '0.1rem 0.45rem', borderRadius: '999px', backgroundColor: '#b45309', color: '#ffffff', fontWeight: 700 }}>
                          <ShieldAlert size={10} /> Recover / Surcharge
                        </span>
                      )}
                      {it.mdaName && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.22rem', fontSize: '0.71rem', fontWeight: 700, color: '#0f172a' }}>
                          <Building2 size={11} /> {it.mdaName}
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {it.heading}
                    </div>
                    {it.excerpt && (
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.25rem', lineHeight: 1.45 }}>
                        <ExpandableText text={it.excerpt} maxChars={175} />
                      </div>
                    )}
                    {it.recommendation && (
                      <div style={{ fontSize: '0.74rem', color: '#065f46', backgroundColor: '#ecfdf5', padding: '0.35rem 0.55rem', borderRadius: '6px', marginTop: '0.35rem' }}>
                        <strong>OAuGF Recommendation:</strong> {it.recommendation}
                      </div>
                    )}
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    {it.amountNaira > 0 && (
                      <div className="font-mono tabular-nums" style={{ fontSize: '0.94rem', fontWeight: 800, color: '#991b1b' }}>
                        {fmtNairaCompact(it.amountNaira)}
                      </div>
                    )}
                    <div className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                      {it.docTitle} · p.{it.page}
                    </div>
                    {it.sourceUrl && (
                      <a
                        href={it.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.22rem', fontSize: '0.7rem', color: '#047857', fontWeight: 600, marginTop: '0.2rem' }}
                      >
                        Official OAuGF PDF <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {filteredIssues.length > visibleCount && (
              <button
                type="button"
                onClick={() => setVisibleCount((v) => v + 50)}
                className="editorial-btn"
                style={{ alignSelf: 'center', fontSize: '0.78rem', padding: '0.45rem 1rem' }}
              >
                Show 50 More Negligences ({(filteredIssues.length - visibleCount).toLocaleString('en-US')} remaining)
              </button>
            )}
          </div>
        )}

        {/* SUB-TAB 2: REPEAT-OFFENDER MDAs */}
        {subTab === 'mdas' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '0.75rem' }}>
            {mdaRows.map((m) => (
              <div key={m.mdaKey} style={{ padding: '0.85rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'flex-start' }}>
                  <div style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-primary)' }}>{m.mdaName}</div>
                  <span className="font-mono" style={{ fontSize: '0.74rem', fontWeight: 800, color: '#991b1b', whiteSpace: 'nowrap' }}>
                    {m.findingCount} queries
                  </span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Years: {m.reportYears.join(', ')} · Repeat: {m.repeatNeglectCount || 0} · Recoveries: {m.recoveryDirectiveCount || 0}
                  {m.totalFlaggedNaira > 0 ? ` · ${fmtNairaCompact(m.totalFlaggedNaira)}` : ''}
                </div>
                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.45rem' }}>
                  {Object.entries(m.categories).slice(0, 3).map(([cat, cnt]) => (
                    <span key={cat} style={{ fontSize: '0.67rem', padding: '0.1rem 0.4rem', borderRadius: '6px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', color: '#334155' }}>
                      {cat}: {cnt}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* SUB-TAB 2B: 6-LEDGER RED-FLAG CONVERGENCE (CP-4) */}
        {subTab === 'convergence' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ padding: '0.75rem 1rem', borderRadius: '8px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', fontSize: '0.77rem', color: '#7f1d1d' }}>
              <strong>Multi-Layer Red-Flag Convergence Across All 6 Forensic Ledgers:</strong> Ranks contractors and federal MDAs that trigger multiple independent forensic alerts simultaneously (Legislative Padding, Non-Competitive Procurement, Variation Overruns, &gt;125% Treasury Overpayment, December Rush / Opaque Staff Payouts, and OAuGF Constitutional Audit Queries).
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 330px), 1fr))', gap: '0.9rem' }}>
              <div>
                <h4 style={{ margin: '0 0 0.55rem', fontSize: '0.88rem', fontWeight: 700, color: '#991b1b' }}>
                  Convergent High-Risk Contractors ({convergence?.headline.convergentContractorCount || 0} total · {convergence?.headline.highRisk3PlusContractorCount || 0} with &ge;3 layers)
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                  {(convergence?.contractors || [])
                    .filter((c) => !query.trim() || c.contractorName.toLowerCase().includes(query.trim().toLowerCase()))
                    .slice(0, 25)
                    .map((c) => (
                      <div key={c.contractorName} style={{ padding: '0.75rem', borderRadius: '8px', border: '1px solid #fecaca', backgroundColor: '#fff7ed' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0f172a' }}>{c.contractorName}</span>
                          <span className="font-mono" style={{ fontSize: '0.7rem', padding: '0.1rem 0.45rem', borderRadius: '999px', backgroundColor: '#dc2626', color: '#ffffff', fontWeight: 700 }}>
                            {c.flagCount} Red-Flag Layers · {fmtNairaCompact(c.totalExposureNaira)}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                          {c.flags.map((fl) => (
                            <span key={fl} className="font-mono" style={{ fontSize: '0.64rem', padding: '0.08rem 0.38rem', borderRadius: '4px', backgroundColor: '#fee2e2', color: '#991b1b', fontWeight: 700 }}>
                              {fl}
                            </span>
                          ))}
                        </div>
                        <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem', fontSize: '0.72rem', color: '#334155' }}>
                          {c.flagDetails.slice(0, 3).map((fd, i) => (
                            <li key={i}>{fd}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                </div>
              </div>

              <div>
                <h4 style={{ margin: '0 0 0.55rem', fontSize: '0.88rem', fontWeight: 700, color: '#92400e' }}>
                  Convergent Multi-Flag MDAs ({convergence?.headline.convergentMdaCount || 0} total · {convergence?.headline.highRisk3PlusMdaCount || 0} with &ge;3 layers)
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                  {(convergence?.mdas || [])
                    .filter((m) => !query.trim() || m.mdaName.toLowerCase().includes(query.trim().toLowerCase()))
                    .slice(0, 25)
                    .map((m) => (
                      <div key={m.mdaName} style={{ padding: '0.75rem', borderRadius: '8px', border: '1px solid #fde68a', backgroundColor: '#fffbeb' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0f172a' }}>{m.mdaName}</span>
                          <span className="font-mono" style={{ fontSize: '0.7rem', padding: '0.1rem 0.45rem', borderRadius: '999px', backgroundColor: '#b45309', color: '#ffffff', fontWeight: 700 }}>
                            {m.flagCount} Layers · Grade {m.grade}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                          {m.flags.map((fl) => (
                            <span key={fl} className="font-mono" style={{ fontSize: '0.64rem', padding: '0.08rem 0.38rem', borderRadius: '4px', backgroundColor: '#fef3c7', color: '#92400e', fontWeight: 700 }}>
                              {fl}
                            </span>
                          ))}
                        </div>
                        <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem', fontSize: '0.72rem', color: '#334155' }}>
                          {m.flagDetails.slice(0, 3).map((fd, i) => (
                            <li key={i}>{fd}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SUB-TAB 3: ALL 36 REPORTS */}
        {subTab === 'reports' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {payload.upstreamMissing404Reports && payload.upstreamMissing404Reports.length > 0 && (
              <div style={{ padding: '0.7rem 0.95rem', borderRadius: '8px', backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', fontSize: '0.74rem', color: '#334155' }}>
                <strong>Full 1999–2024 Upstream Transparency Note:</strong> {h.reportsIndexed} of 45 reports listed on <code>oaugf.ng</code> were downloaded and extracted ({h.reportsWithFindingsCount || h.reportsIndexed} with parsed audit findings). The remaining {payload.upstreamMissing404Reports.length} upstream links ({payload.upstreamMissing404Reports.map((r) => `${r.title} [${r.year}]`).join(', ')}) return HTTP 404 Not Found on the official OAuGF server.
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: '0.7rem' }}>
            {reportDocs.map((d) => (
              <div key={d.id} style={{ padding: '0.8rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.4rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '0.1rem 0.42rem', borderRadius: '999px', backgroundColor: '#e2e8f0', color: '#1e293b' }}>
                    {d.category}
                  </span>
                  <span className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    {d.pageCount} pp. · {d.issueCount} issues
                  </span>
                </div>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'flex-start', gap: '0.35rem' }}>
                  <FileWarning size={14} color="#b45309" style={{ flexShrink: 0, marginTop: '0.15rem' }} />
                  <span>{d.title}</span>
                </div>
                {d.sourceUrl && (
                  <a
                    href={d.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.72rem', color: '#047857', fontWeight: 600 }}
                  >
                    Official OAuGF Source <ExternalLink size={11} />
                  </a>
                )}
              </div>
            ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
