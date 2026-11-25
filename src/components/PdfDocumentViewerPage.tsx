import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl } from '../services/apiClient';
import { ArrowLeft, ChevronLeft, ChevronRight, FileText, Search, X } from 'lucide-react';
import { readAppUrlState, syncUrlParams } from '../utils/urlState';
import { ExpandableText } from './ExpandableText';

interface MinProjectRow {
  id: string;
  budgetCode?: string;
  projectCode?: string;
  projectName: string;
  agency?: string;
  financialYear: number;
  amount: number;
  projectType?: string;
  page: number;
  spendingType?: string;
  sector?: string;
}

interface PdfDocumentViewerPageProps {
  selectedYear: number;
  onBack?: () => void;
}

const formatNairaExact = (amt: number) => `₦${Number(amt || 0).toLocaleString('en-US')}`;

export const PdfDocumentViewerPage: React.FC<PdfDocumentViewerPageProps> = ({
  selectedYear,
  onBack,
}) => {
  const urlState = useMemo(() => readAppUrlState(), []);
  const docYear = urlState.year || selectedYear || 2017;
  const citedPage = urlState.page || 1;
  const citedItem = urlState.item || '';

  const [rows, setRows] = useState<MinProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState(urlState.q || '');
  const [activePage, setActivePage] = useState<number>(citedPage);
  const [viewMode, setViewMode] = useState<'page' | 'all'>('page');
  const highlightedRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    let active = true;
    const params = new URLSearchParams({
      year: String(docYear),
      sort: 'page_asc',
      limit: '200',
    });
    if (viewMode === 'page' && activePage > 0) {
      params.set('page', String(activePage));
    } else if (searchQuery.trim()) {
      params.set('q', searchQuery.trim());
    }
    fetch(apiUrl(`/api/v1/projects?${params.toString()}`), { cache: 'no-cache' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!active) return;
        const list = Array.isArray(data) ? data : (data?.items || data?.projects || data?.records || []);
        setRows(list);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError(`Could not load FY ${docYear} appropriation schedule.`);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [docYear, activePage, viewMode, searchQuery]);

  useEffect(() => {
    if (!loading && highlightedRef.current) {
      highlightedRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [loading, activePage, viewMode]);

  const handlePageChange = (nextPage: number) => {
    setActivePage(nextPage);
    syncUrlParams({ page: nextPage }, 'replace');
  };

  const availablePages = useMemo(() => {
    const set = new Set<number>();
    for (const r of rows) {
      if (Number.isFinite(r.page) && r.page > 0) set.add(r.page);
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [rows]);

  const trimmedQuery = searchQuery.trim().toLowerCase();

  const filteredRows = useMemo(() => {
    if (trimmedQuery) {
      return rows.filter((r) => {
        const hay = `${r.projectCode || ''} ${r.projectName || ''} ${r.agency || ''} ${r.sector || ''} ${r.id || ''} page ${r.page}`.toLowerCase();
        return hay.includes(trimmedQuery);
      });
    }
    if (viewMode === 'page') {
      return rows.filter((r) => r.page === activePage);
    }
    return rows;
  }, [rows, trimmedQuery, viewMode, activePage]);

  const pagesToRender = useMemo(() => {
    const capped = filteredRows.slice(0, 250);
    const grouped = new Map<number, MinProjectRow[]>();
    for (const r of capped) {
      const p = r.page || 1;
      const bucket = grouped.get(p);
      if (bucket) bucket.push(r);
      else grouped.set(p, [r]);
    }
    return Array.from(grouped.entries()).sort((a, b) => a[0] - b[0]);
  }, [filteredRows]);

  const pageIdx = availablePages.indexOf(activePage);
  const canPrev = pageIdx > 0;
  const canNext = pageIdx >= 0 && pageIdx < availablePages.length - 1;

  const isTargetRow = (r: MinProjectRow) => {
    if (!citedItem) return false;
    const normCited = citedItem.toLowerCase();
    if ((r.id || '').toLowerCase() === normCited) return true;
    if (r.page === citedPage && (r.projectCode || '').toLowerCase() === normCited) return true;
    return false;
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '84vh',
        borderRadius: '10px',
        overflow: 'hidden',
        border: '1px solid #334155',
        backgroundColor: '#334155',
      }}
    >
      {/* PDF Document Toolbar */}
      <div
        style={{
          padding: '0.8rem 1.15rem',
          backgroundColor: '#0f172a',
          borderBottom: '1px solid #334155',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          flexWrap: 'wrap',
          color: '#f8fafc',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              style={{
                padding: '0.32rem 0.55rem',
                borderRadius: '6px',
                border: '1px solid #334155',
                backgroundColor: '#1e293b',
                color: '#f8fafc',
                fontSize: '0.74rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
            >
              <ArrowLeft size={13} /> Back
            </button>
          )}
          <FileText size={18} color="#10b981" />
          <div>
            <div style={{ fontSize: '0.94rem', fontWeight: 700 }}>
              FY {docYear} Federal Appropriation Act — Official Schedule
            </div>
            <div className="font-mono" style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
              {rows.length.toLocaleString()} indexed lines · {availablePages.length.toLocaleString()} pages · Cited Page {citedPage}
            </div>
          </div>
        </div>

        {/* Search Inside Document */}
        <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: '400px' }}>
          <Search
            size={14}
            color="#94a3b8"
            style={{ position: 'absolute', left: '0.7rem', top: '50%', transform: 'translateY(-50%)' }}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search FY ${docYear} document (code, project, MDA)...`}
            style={{
              width: '100%',
              padding: '0.44rem 2rem 0.44rem 2rem',
              borderRadius: '6px',
              border: '1px solid #334155',
              backgroundColor: '#1e293b',
              color: '#f8fafc',
              fontSize: '0.78rem',
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              style={{
                position: 'absolute',
                right: '0.45rem',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: '0.1rem',
              }}
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Page Navigation */}
        {!trimmedQuery && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <button
              type="button"
              disabled={!canPrev || viewMode === 'all'}
              onClick={() => canPrev && handlePageChange(availablePages[pageIdx - 1])}
              style={{
                padding: '0.32rem 0.45rem',
                borderRadius: '6px',
                border: '1px solid #334155',
                backgroundColor: '#1e293b',
                color: canPrev && viewMode === 'page' ? '#f8fafc' : '#64748b',
                cursor: canPrev && viewMode === 'page' ? 'pointer' : 'not-allowed',
                display: 'inline-flex',
                alignItems: 'center',
              }}
              title="Previous page"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="font-mono" style={{ fontSize: '0.73rem', color: '#cbd5e1', minWidth: '88px', textAlign: 'center' }}>
              {viewMode === 'page' ? `Page ${activePage}` : 'All Pages'}
            </span>
            <button
              type="button"
              disabled={!canNext || viewMode === 'all'}
              onClick={() => canNext && handlePageChange(availablePages[pageIdx + 1])}
              style={{
                padding: '0.32rem 0.45rem',
                borderRadius: '6px',
                border: '1px solid #334155',
                backgroundColor: '#1e293b',
                color: canNext && viewMode === 'page' ? '#f8fafc' : '#64748b',
                cursor: canNext && viewMode === 'page' ? 'pointer' : 'not-allowed',
                display: 'inline-flex',
                alignItems: 'center',
              }}
              title="Next page"
            >
              <ChevronRight size={14} />
            </button>
            <button
              type="button"
              onClick={() => setViewMode((v) => (v === 'page' ? 'all' : 'page'))}
              style={{
                padding: '0.32rem 0.65rem',
                borderRadius: '6px',
                border: '1px solid #334155',
                backgroundColor: viewMode === 'all' ? '#047857' : '#1e293b',
                color: '#f8fafc',
                fontSize: '0.72rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {viewMode === 'page' ? 'Scroll All Pages' : `Back to Page ${activePage}`}
            </button>
          </div>
        )}
      </div>

      {/* Scrollable PDF Paper Canvas */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '1.75rem 1.25rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.5rem',
        }}
      >
        {loading ? (
          <div style={{ color: '#e2e8f0', fontSize: '0.92rem', padding: '3rem' }}>
            Rendering FY {docYear} document pages...
          </div>
        ) : error ? (
          <div style={{ color: '#fca5a5', fontSize: '0.92rem', padding: '3rem' }}>{error}</div>
        ) : pagesToRender.length === 0 ? (
          <div
            style={{
              width: '100%',
              maxWidth: '880px',
              backgroundColor: '#ffffff',
              color: '#334155',
              padding: '3rem 2rem',
              borderRadius: '4px',
              textAlign: 'center',
              boxShadow: '0 10px 25px rgba(0, 0, 0, 0.35)',
            }}
          >
            No line items matched &ldquo;{searchQuery}&rdquo; in FY {docYear}.
          </div>
        ) : (
          <>
            {trimmedQuery && (
              <div
                className="font-mono"
                style={{
                  width: '100%',
                  maxWidth: '880px',
                  color: '#e2e8f0',
                  fontSize: '0.75rem',
                }}
              >
                Found {filteredRows.length.toLocaleString()} matching record(s) across FY {docYear}
                {filteredRows.length > 250 ? ' (showing first 250)' : ''}
              </div>
            )}

            {pagesToRender.map(([pageNo, pageRows]) => (
              <div
                key={pageNo}
                style={{
                  width: '100%',
                  maxWidth: '880px',
                  backgroundColor: '#ffffff',
                  color: '#0f172a',
                  borderRadius: '3px',
                  boxShadow: '0 12px 28px rgba(0, 0, 0, 0.38)',
                  padding: '2rem 2.25rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1rem',
                }}
              >
                {/* Official Document Page Header */}
                <div
                  style={{
                    borderBottom: '2px solid #0f172a',
                    paddingBottom: '0.65rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-end',
                    gap: '1rem',
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: '#475569',
                      }}
                    >
                      Federal Republic of Nigeria · Budget Office Schedule
                    </div>
                    <div className="font-editorial" style={{ fontSize: '1.08rem', fontWeight: 700, color: '#0f172a' }}>
                      {docYear} Appropriation Act — Schedule of Projects
                    </div>
                  </div>
                  <div className="font-mono" style={{ fontSize: '0.76rem', fontWeight: 700, color: '#047857' }}>
                    PDF PAGE {pageNo}
                  </div>
                </div>

                {/* Page Line-Item Table */}
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #cbd5e1', textAlign: 'left', color: '#475569' }}>
                      <th style={{ padding: '0.45rem 0.4rem', fontWeight: 700, width: '110px' }}>Code</th>
                      <th style={{ padding: '0.45rem 0.4rem', fontWeight: 700 }}>Project / Line Item Description</th>
                      <th style={{ padding: '0.45rem 0.4rem', fontWeight: 700, width: '175px' }}>MDA / Agency</th>
                      <th style={{ padding: '0.45rem 0.4rem', fontWeight: 700, textAlign: 'right', width: '130px' }}>
                        Amount (₦)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r, idx) => {
                      const hit = isTargetRow(r);
                      return (
                        <tr
                          key={`${r.id}-${idx}`}
                          ref={hit ? highlightedRef : undefined}
                          style={{
                            borderBottom: '1px solid #e2e8f0',
                            backgroundColor: hit ? '#ecfdf5' : undefined,
                            outline: hit ? '2px solid #10b981' : undefined,
                          }}
                        >
                          <td className="font-mono" style={{ padding: '0.5rem 0.4rem', verticalAlign: 'top', fontWeight: 600, color: '#334155' }}>
                            <div>{r.projectCode || r.budgetCode || '—'}</div>
                            {hit && (
                              <span
                                style={{
                                  display: 'inline-block',
                                  marginTop: '0.2rem',
                                  fontSize: '0.62rem',
                                  backgroundColor: '#047857',
                                  color: '#ffffff',
                                  padding: '0.08rem 0.35rem',
                                  borderRadius: '3px',
                                  fontWeight: 700,
                                }}
                              >
                                CITED RECORD
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '0.5rem 0.4rem', verticalAlign: 'top', color: '#0f172a', lineHeight: 1.45 }}>
                            <div style={{ fontWeight: hit ? 700 : 500 }}>
                              <ExpandableText text={r.projectName} maxChars={180} />
                            </div>
                            <div className="font-mono" style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '0.15rem' }}>
                              {r.id} · {r.spendingType || 'CAPITAL'} · {r.sector || 'Federal'}
                            </div>
                          </td>
                          <td style={{ padding: '0.5rem 0.4rem', verticalAlign: 'top', color: '#475569', fontSize: '0.73rem' }}>
                            {r.agency || 'Federal MDA'}
                          </td>
                          <td
                            className="font-mono tabular-nums"
                            style={{ padding: '0.5rem 0.4rem', verticalAlign: 'top', textAlign: 'right', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' }}
                          >
                            {formatNairaExact(r.amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Official Document Page Footer */}
                <div
                  className="font-mono"
                  style={{
                    borderTop: '1px solid #e2e8f0',
                    paddingTop: '0.55rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '0.68rem',
                    color: '#64748b',
                  }}
                >
                  <span>Source: Budget Office of the Federation · FY {docYear}</span>
                  <span>Page {pageNo} · {pageRows.length} item(s) shown</span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
};
