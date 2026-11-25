import React, { useEffect, useState, useMemo } from 'react';
import { Search, Building2, Download, FileText, Copy, Check, X, ShieldCheck, Layers } from 'lucide-react';
import { useBudgetDatabase } from '../context/BudgetDatabaseContext';
import { getPresidentForYear } from '../data/presidentialTerms';
import { loadSourceProvenance, resolveYearProvenance } from '../utils/citationFormatter';
import { exportTabularDossierDocx, exportTabularDossierPdf } from '../utils/documentExporter';
import { ExpandableText } from './ExpandableText';
import {
  getScoreGradeMeta,
  loadMdaIntegrityScorecards,
  matchMdaScorecardByName,
  type MdaPillarKey,
  type MdaScorecardEntry,
} from '../utils/mdaScorecard';

interface RawMinistry {
  name: string;
  amount: number;
}

interface FormattedMinistry {
  rank: number;
  name: string;
  amountRaw: number;
  amountFormatted: string;
  sharePct: number;    // % of total national budget
  relativePct: number; // % relative to top ministry
}

interface MDAProject {
  projectCode: string;
  projectName: string;
  amount: number;
  page: number;
}

interface Props {
  financialYear: number;
}

export const TopMinistriesWidget: React.FC<Props> = ({ financialYear }) => {
  const { getTopMinistries, isLoading } = useBudgetDatabase();
  const [ministries, setMinistries] = useState<FormattedMinistry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMDA, setSelectedMDA] = useState<FormattedMinistry | null>(null);
  const [mdaProjects, setMdaProjects] = useState<MDAProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null);
  const [scorecardEntries, setScorecardEntries] = useState<MdaScorecardEntry[]>([]);

  useEffect(() => {
    let active = true;
    loadMdaIntegrityScorecards().then((payload) => {
      if (active && payload?.mdas) {
        setScorecardEntries(payload.mdas);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const selectedMdaScorecard = useMemo(
    () => (selectedMDA ? matchMdaScorecardByName(scorecardEntries, selectedMDA.name) : null),
    [scorecardEntries, selectedMDA]
  );

  useEffect(() => {
    const topMdas = getTopMinistries(15);
    if (topMdas && topMdas.length > 0) {
      setMinistries(topMdas);
    } else {
      fetch(`/datasets/${financialYear}/statistics.json`)
        .then(res => res.json())
        .then(stats => {
          if (stats?.topMinistries) {
            const rawTop = stats.topMinistries as RawMinistry[];
            const grandTotal = stats.officialTotalBudget || stats.totalCapitalAmount || 50e12;
            const maxVal = rawTop[0]?.amount || 1;

            const formatted: FormattedMinistry[] = rawTop.map((m, idx) => ({
              rank: idx + 1,
              name: m.name,
              amountRaw: m.amount,
              amountFormatted: m.amount >= 1e12 ? `₦${(m.amount / 1e12).toFixed(2)} Trillion` : `₦${(m.amount / 1e9).toFixed(2)} Billion`,
              sharePct: grandTotal > 0 ? (m.amount / grandTotal) * 100 : 0,
              relativePct: (m.amount / maxVal) * 100
            }));
            setMinistries(formatted);
          }
        })
        .catch(() => {});
    }
  }, [financialYear, isLoading]);

  // Filter ministries by search query
  const filteredMinistries = useMemo(() => {
    if (!searchQuery.trim()) return ministries;
    const q = searchQuery.toLowerCase();
    return ministries.filter(m => m.name.toLowerCase().includes(q));
  }, [ministries, searchQuery]);

  // Fetch top projects when an MDA is clicked
  const handleSelectMDA = (mda: FormattedMinistry) => {
    setSelectedMDA(mda);
    setLoadingProjects(true);

    fetch(`/datasets/${financialYear}/projects.min.json`)
      .then(res => res.json())
      .then((allProjects: any[]) => {
        const mdaWords = mda.name.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !['federal', 'ministry', 'department', 'agency'].includes(w));

        const matched = allProjects.filter(p => {
          const name = (p.projectName || '').toLowerCase();
          const sector = (p.sector || '').toLowerCase();
          return mdaWords.some(w => name.includes(w) || sector.includes(w));
        });

        matched.sort((a, b) => (b.amount || 0) - (a.amount || 0));

        setMdaProjects(matched.slice(0, 4).map(p => ({
          projectCode: p.projectCode || p.id || 'ERGP',
          projectName: p.projectName,
          amount: p.amount || 0,
          page: p.page || 1
        })));
        setLoadingProjects(false);
      })
      .catch(() => setLoadingProjects(false));
  };

  const handleCopySummary = () => {
    const text = `🏛️ VERBATIM MINISTERIAL ALLOCATIONS (${financialYear})\n` +
      ministries.slice(0, 8).map(m => `#${m.rank} ${m.name}: ${m.amountFormatted} (${m.sharePct}% of Total Budget)`).join('\n') +
      `\nExtracted verbatim from Pages 1–2 of official Appropriation Act. Sourced via budgetlens.ng`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportMdas = async (format: 'pdf' | 'docx') => {
    if (ministries.length === 0 || exportingFormat) return;
    setExportingFormat(format);
    try {
      const pres = getPresidentForYear(financialYear);
      const manifest = await loadSourceProvenance();
      const prov = resolveYearProvenance(manifest, financialYear);
      const topSum = ministries.reduce((s, m) => s + (m.amountRaw || 0), 0);

      const spec = {
        filenameBase: `BudgetLens_Ministerial_Allocations_FY${financialYear}`,
        eyebrow: `BUDGETLENS MINISTERIAL ALLOCATION LEDGER · FY ${financialYear}`,
        title: `Verbatim Top Federal Ministries & MDAs — FY ${financialYear}`,
        subtitle: `Extracted from enacted summary schedules (${pres.presidentName} Administration)`,
        orientation: 'portrait' as const,
        metadata: [
          { label: 'Administration', value: `${pres.presidentName} (${pres.termLabel})` },
          { label: 'MDAs Listed', value: ministries.length.toLocaleString() },
        ],
        kpis: [
          { label: '#1 Ranked MDA', value: ministries[0]?.name.replace('Federal Ministry of ', '') || 'N/A', subtext: `${ministries[0]?.amountFormatted || ''} (${ministries[0]?.sharePct.toFixed(1) || 0}%)` },
          { label: 'Combined Top MDAs', value: topSum >= 1e12 ? `₦${(topSum / 1e12).toFixed(2)}T` : `₦${(topSum / 1e9).toFixed(2)}B`, subtext: `${ministries.length} ranked entities` },
        ],
        tables: [
          {
            heading: `FY ${financialYear} Top Federal Ministerial Allocations`,
            columns: ['Rank', 'Ministry / Executing Agency', 'Allocation (Naira)', 'Share (%)'],
            rows: ministries.map((m) => [
              `#${m.rank}`,
              m.name,
              `₦${Math.round(m.amountRaw).toLocaleString()}`,
              `${m.sharePct.toFixed(2)}%`,
            ]),
            rightAlignColumns: [2, 3],
          },
        ],
        sourceFilename: prov.filename,
        sha256: prov.sha256,
        permalink: typeof window !== 'undefined' ? window.location.href : undefined,
      };

      if (format === 'pdf') {
        await exportTabularDossierPdf(spec);
      } else {
        await exportTabularDossierDocx(spec);
      }
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <div style={{
      backgroundColor: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: '10px',
      padding: '1.25rem',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      position: 'relative'
    }}>
      <div>
        {/* 1. Header & Page Citation */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.2rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>
                Verbatim Ministerial Allocations ({financialYear})
              </h3>
              <span style={{ fontSize: '0.65rem', backgroundColor: '#e6f4ea', color: '#047857', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                <ShieldCheck size={11} /> Pages 1–2 PDF
              </span>
            </div>
            <p style={{ fontSize: '0.725rem', color: '#64748b' }}>
              Extracted verbatim from Pages 1–2 of official Appropriation Act records
            </p>
          </div>
        </div>

        {/* 2. Quick Search & Filter Bar */}
        <div style={{ position: 'relative', marginBottom: '0.85rem' }}>
          <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search 50+ Federal Ministries & Agencies..."
            style={{
              width: '100%',
              padding: '0.4rem 0.6rem 0.4rem 2rem',
              fontSize: '0.75rem',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              backgroundColor: '#f8fafc',
              outline: 'none',
              color: '#0f172a'
            }}
          />
        </div>

        {/* 3. MDA List with Share Progress Bars */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '320px', overflowY: 'auto', paddingRight: '0.2rem' }}>
          {filteredMinistries.length === 0 ? (
            <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.75rem', color: '#64748b' }}>
              No ministry matching "{searchQuery}"
            </div>
          ) : (
            filteredMinistries.map((m) => (
              <div
                key={m.name}
                onClick={() => handleSelectMDA(m)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.25rem',
                  padding: '0.45rem 0.6rem',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #f1f5f9',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.775rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: '0.65rem', fontWeight: 700, backgroundColor: '#e2e8f0', color: '#0f172a', padding: '0.1rem 0.35rem', borderRadius: '4px', flexShrink: 0 }}>
                      #{m.rank}
                    </span>
                    <span style={{ color: '#0f172a', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {m.name}
                    </span>
                    {(() => {
                      const sc = matchMdaScorecardByName(scorecardEntries, m.name);
                      if (!sc || sc.compositeScore === null) return null;
                      const gm = getScoreGradeMeta(sc.compositeScore);
                      return (
                        <span
                          className="font-mono"
                          title={`5-Pillar Integrity Score: ${sc.compositeScore.toFixed(1)}/100 (${sc.metricsPresent}/5 pillars)`}
                          style={{
                            fontSize: '0.62rem',
                            fontWeight: 700,
                            padding: '0.08rem 0.32rem',
                            borderRadius: '4px',
                            backgroundColor: gm.bg,
                            color: gm.color,
                            border: `1px solid ${gm.border}`,
                            flexShrink: 0,
                          }}
                        >
                          {gm.grade}·{sc.compositeScore.toFixed(0)}
                        </span>
                      );
                    })()}
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '0.5rem' }}>
                    <span style={{ color: '#0f172a', fontWeight: 700, fontFamily: 'var(--font-family)', display: 'block' }}>
                      {m.amountFormatted}
                    </span>
                    <span style={{ fontSize: '0.65rem', color: '#10b981', fontWeight: 600 }}>
                      {m.sharePct}% of total budget
                    </span>
                  </div>
                </div>

                {/* Progress Bar */}
                <div style={{ width: '100%', height: '5px', backgroundColor: '#e2e8f0', borderRadius: '3px', overflow: 'hidden', marginTop: '0.15rem' }}>
                  <div style={{ width: `${m.relativePct}%`, height: '100%', backgroundColor: '#10b981', borderRadius: '3px' }} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 4. Actions Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.65rem', borderTop: '1px solid #f1f5f9', marginTop: '0.75rem', fontSize: '0.725rem' }}>
        <button
          onClick={handleCopySummary}
          style={{ backgroundColor: 'transparent', border: 'none', color: '#10b981', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied!' : 'Copy Summary'}
        </button>

        <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => handleExportMdas('pdf')}
            disabled={ministries.length === 0 || exportingFormat !== null}
            style={{ backgroundColor: 'transparent', border: 'none', color: '#059669', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
          >
            <FileText size={12} /> {exportingFormat === 'pdf' ? 'PDF...' : 'MDA PDF'}
          </button>
          <button
            type="button"
            onClick={() => handleExportMdas('docx')}
            disabled={ministries.length === 0 || exportingFormat !== null}
            style={{ backgroundColor: 'transparent', border: 'none', color: '#475569', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
          >
            <Download size={12} /> {exportingFormat === 'docx' ? 'DOCX...' : 'MDA DOCX'}
          </button>
        </div>
      </div>

      {/* 5. Ministry Forensic Inspector Modal */}
      {selectedMDA && (
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'rgba(255, 255, 255, 0.98)',
          backdropFilter: 'blur(6px)',
          borderRadius: '10px',
          padding: '1.15rem',
          zIndex: 20,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          boxShadow: '0 10px 25px rgba(0,0,0,0.15)'
        }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Building2 size={16} color="#10b981" />
                <h4 style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0f172a', maxWidth: '240px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {selectedMDA.name}
                </h4>
              </div>
              <button onClick={() => setSelectedMDA(null)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.65rem', backgroundColor: '#f0fdf4', padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid #a7f3d0' }}>
              <div>
                <span style={{ fontSize: '0.65rem', color: '#047857', display: 'block' }}>Verbatim PDF Pages 1–2 Allocation</span>
                <span style={{ fontSize: '1.15rem', fontWeight: 700, color: '#0f172a' }}>{selectedMDA.amountFormatted}</span>
              </div>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#047857' }}>
                {selectedMDA.sharePct}% National Share
              </span>
            </div>

            {selectedMdaScorecard && (() => {
              const gm = getScoreGradeMeta(selectedMdaScorecard.compositeScore);
              const pillarLabels: Array<[MdaPillarKey, string]> = [
                ['paddingRestraint', 'Pad'],
                ['birCapitalExecution', 'BIR'],
                ['openBiddingShare', 'Bid'],
                ['vendorDiversification', 'HHI'],
                ['cashDiscipline', 'Cash'],
              ];
              return (
                <div
                  style={{
                    marginBottom: '0.6rem',
                    padding: '0.45rem 0.6rem',
                    borderRadius: '6px',
                    backgroundColor: '#f8fafc',
                    border: `1px solid ${gm.border}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.35rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem' }}>
                    <span style={{ fontWeight: 700, color: '#0f172a' }}>
                      Composite Integrity ({selectedMdaScorecard.metricsPresent}/5 pillars)
                    </span>
                    <span className="font-mono" style={{ fontWeight: 700, color: gm.color }}>
                      Grade {gm.grade} · {selectedMdaScorecard.compositeScore?.toFixed(1) ?? 'N/A'}/100
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                    {pillarLabels.map(([pk, shortLbl]) => {
                      const pv = selectedMdaScorecard.pillars[pk]?.score;
                      const pg = getScoreGradeMeta(pv);
                      return (
                        <span
                          key={pk}
                          className="font-mono"
                          style={{
                            fontSize: '0.62rem',
                            fontWeight: 700,
                            padding: '0.1rem 0.35rem',
                            borderRadius: '4px',
                            backgroundColor: pv === null ? '#ffffff' : pg.bg,
                            color: pv === null ? '#94a3b8' : pg.color,
                            border: `1px solid ${pv === null ? '#e2e8f0' : pg.border}`,
                          }}
                        >
                          {shortLbl}: {pv !== null && pv !== undefined ? pv.toFixed(0) : 'N/A'}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Top Projects under MDA */}
            <div style={{ fontSize: '0.725rem', color: '#475569', fontWeight: 600, marginBottom: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <Layers size={12} color="#3b82f6" /> Sample Line Item Projects under MDA:
            </div>

            {loadingProjects ? (
              <div style={{ fontSize: '0.75rem', color: '#64748b', padding: '0.5rem 0' }}>Loading line items from PDF...</div>
            ) : mdaProjects.length === 0 ? (
              <div style={{ fontSize: '0.725rem', color: '#64748b', padding: '0.4rem 0' }}>No standalone line items tagged directly under this MDA header.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {mdaProjects.map((p, idx) => (
                  <div key={idx} style={{ padding: '0.35rem 0.5rem', backgroundColor: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: '4px', fontSize: '0.7rem' }}>
                    <div style={{ fontWeight: 600, color: '#0f172a', lineHeight: 1.35 }}>
                      <ExpandableText text={p.projectName} maxChars={130} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', marginTop: '0.1rem' }}>
                      <span>Pg. {p.page} · {p.projectCode}</span>
                      <span style={{ fontWeight: 700, color: '#10b981' }}>₦{p.amount.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => setSelectedMDA(null)}
            style={{ width: '100%', marginTop: '0.5rem', backgroundColor: '#0f172a', color: '#ffffff', border: 'none', borderRadius: '6px', padding: '0.45rem', fontSize: '0.775rem', fontWeight: 600, cursor: 'pointer' }}
          >
            Close MDA Inspector
          </button>
        </div>
      )}
    </div>
  );
};
