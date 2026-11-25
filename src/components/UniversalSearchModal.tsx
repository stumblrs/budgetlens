import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, X, CornerDownLeft, Sparkles, FileText, Zap, Hash, MapPin, Bot, Filter } from 'lucide-react';
import { useBudgetDatabase } from '../context/BudgetDatabaseContext';
import { ExpandableText } from './ExpandableText';

interface Project {
  id: string;
  projectCode: string;
  projectName: string;
  financialYear: number;
  amount: number;
  projectType: string;
  page: number;
  sector: string;
  agency?: string;
  state?: string;
  severity?: string;
  sourceFilename?: string;
  sha256?: string;
  president?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  projects?: any[];
  financialYear?: number;
  onSelectProject: (project: any) => void;
}

type SearchTab = 'all' | 'projects' | 'sectors' | 'commands';

const QUICK_CHIPS = [
  { label: 'Land Cruiser', icon: '🚗' },
  { label: 'Borehole Kano', icon: '💧' },
  { label: 'Solar street lighting', icon: '💡' },
  { label: 'Primary health centre', icon: '🏥' },
  { label: 'Consultancy services', icon: '📋' },
  { label: 'Road construction', icon: '🛣️' },
];

const SECTORS = ['Infrastructure', 'Health', 'Education', 'Security', 'Agriculture', 'Administration', 'Transport', 'Humanitarian'];

const buildCommands = (year: number) => [
  { label: `Show top 10 most expensive projects (${year})`, icon: <Zap size={14} color="#f59e0b" /> },
  { label: 'Show all vehicle procurement items', icon: <Zap size={14} color="#f59e0b" /> },
  { label: `List all health sector projects in ${year}`, icon: <Zap size={14} color="#f59e0b" /> },
  { label: 'Show projects above ₦5 billion', icon: <Zap size={14} color="#f59e0b" /> },
  { label: `Compare education ${year - 1} vs ${year}`, icon: <Zap size={14} color="#f59e0b" /> },
];

const formatNaira = (n: number) =>
  n >= 1e12 ? `₦${(n / 1e12).toFixed(2)}T`
  : n >= 1e9 ? `₦${(n / 1e9).toFixed(2)}B`
  : n >= 1e6 ? `₦${(n / 1e6).toFixed(2)}M`
  : `₦${Math.round(n || 0).toLocaleString()}`;

const SECTOR_COLORS: Record<string, string> = {
  Infrastructure: '#3b82f6',
  Health: '#10b981',
  Education: '#8b5cf6',
  Security: '#ef4444',
  'Agriculture & Food': '#f59e0b',
  'Administration & Services': '#64748b',
  'Aviation & Transport': '#06b6d4',
  'Humanitarian & Social': '#ec4899',
  Administrative: '#94a3b8',
};

let staticFallbackPromise: Promise<Project[]> | null = null;
function loadStaticSearchFallback(): Promise<Project[]> {
  if (!staticFallbackPromise) {
    staticFallbackPromise = fetch('/datasets/search_index_top.json', { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => (Array.isArray(data?.records) ? data.records : []))
      .catch(() => []);
  }
  return staticFallbackPromise;
}

export const UniversalSearchModal: React.FC<Props> = ({
  isOpen,
  onClose,
  projects: propProjects,
  financialYear: propYear,
  onSelectProject,
}) => {
  const { records, activeYear, availableYears, search } = useBudgetDatabase();
  const displayYear = propYear || activeYear || 2026;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Project[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [activeTab, setActiveTab] = useState<SearchTab>('all');
  const [searchScope, setSearchScope] = useState<'year' | 'all'>('all');
  const [filterPresident, setFilterPresident] = useState<string>('ALL');
  const [filterYear, setFilterYear] = useState<string>('ALL');
  const [filterSeverity, setFilterSeverity] = useState<string>('ALL');
  const [searchMeta, setSearchMeta] = useState<{
    mode: 'fts5' | 'static' | 'local';
    totalMatches: number;
    elapsedMs: number;
  }>({ mode: 'local', totalMatches: 0, elapsedMs: 0 });
  const [staticPool, setStaticPool] = useState<Project[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const commands = useMemo(() => buildCommands(displayYear), [displayYear]);

  const allProjects: Project[] = useMemo(() => {
    if (propProjects && propProjects.length > 0) return propProjects;
    return records.map((r) => ({
      id: r.recordIdentity.id,
      financialYear: r.recordIdentity.financialYear,
      projectCode: r.recordIdentity.projectCode,
      projectName: r.recordIdentity.verbatimProjectName,
      amount: r.recordIdentity.amountNaira,
      projectType: r.recordIdentity.spendingType || 'CAPITAL',
      sector: r.mdaGovernanceTaxonomy.sector || '',
      agency: r.mdaGovernanceTaxonomy.mdaName,
      state: r.geographicTaxonomy.state,
      page: r.sourceProvenance.pdfPage,
      sourceFilename: r.sourceProvenance.sourceFilename,
      sha256: r.sourceProvenance.sha256Hash,
    }));
  }, [propProjects, records]);

  const totalCount = allProjects.length;

  useEffect(() => {
    if (isOpen && searchScope === 'all' && staticPool.length === 0) {
      loadStaticSearchFallback().then((recs) => setStaticPool(recs));
    }
  }, [isOpen, searchScope, staticPool.length]);

  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed && searchScope === 'year') {
        setResults(allProjects.slice(0, 12));
        setSearchMeta({ mode: 'local', totalMatches: allProjects.length, elapsedMs: 0 });
        return;
      }

      if (searchScope === 'all') {
        const params = new URLSearchParams({ q: trimmed, limit: '25' });
        if (filterYear !== 'ALL') params.set('year', filterYear);
        if (filterPresident !== 'ALL') params.set('president', filterPresident);
        if (filterSeverity !== 'ALL') params.set('severity', filterSeverity);

        try {
          const res = await fetch(`/api/search?${params.toString()}`);
          if (res.ok) {
            const data = await res.json();
            if (data?.available && Array.isArray(data.results)) {
              setResults(data.results);
              setSearchMeta({
                mode: 'fts5',
                totalMatches: data.totalMatches ?? data.results.length,
                elapsedMs: data.elapsedMs ?? 0,
              });
              setActiveIdx(0);
              return;
            }
          }
        } catch {
          // Backend offline: gracefully fall back to static cross-year index + loaded years
        }

        const t0 = performance.now();
        const fallbackPool = staticPool.length > 0 ? staticPool : await loadStaticSearchFallback();
        const terms = trimmed.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
        const multiLoaded = trimmed
          ? search(trimmed, 25).map((r) => ({
              id: r.recordIdentity.id,
              financialYear: r.recordIdentity.financialYear,
              projectCode: r.recordIdentity.projectCode,
              projectName: r.recordIdentity.verbatimProjectName,
              amount: r.recordIdentity.amountNaira,
              projectType: r.recordIdentity.spendingType || 'CAPITAL',
              sector: r.mdaGovernanceTaxonomy.sector || '',
              agency: r.mdaGovernanceTaxonomy.mdaName,
              page: r.sourceProvenance.pdfPage,
              sourceFilename: r.sourceProvenance.sourceFilename,
              sha256: r.sourceProvenance.sha256Hash,
            }))
          : [];

        const mergedMap = new Map<string, Project>();
        for (const item of [...multiLoaded, ...fallbackPool]) {
          const k = `${item.financialYear}-${item.id || item.projectCode}-${item.page}`;
          if (!mergedMap.has(k)) mergedMap.set(k, item);
        }

        const filtered = Array.from(mergedMap.values()).filter((item) => {
          if (filterYear !== 'ALL' && String(item.financialYear) !== filterYear) return false;
          if (filterPresident !== 'ALL' && item.president && item.president !== filterPresident) return false;
          if (filterSeverity !== 'ALL' && (item.severity || 'none') !== filterSeverity) return false;
          if (terms.length === 0) return true;
          const hay = `${item.projectName} ${item.projectCode} ${item.agency || ''} ${item.sector || ''}`.toLowerCase();
          return terms.every((t) => hay.includes(t));
        });

        filtered.sort((a, b) => b.amount - a.amount);
        setResults(filtered.slice(0, 25));
        setSearchMeta({
          mode: 'static',
          totalMatches: filtered.length,
          elapsedMs: Math.round(performance.now() - t0),
        });
        setActiveIdx(0);
        return;
      }

      const t0 = performance.now();
      const terms = trimmed.toLowerCase().split(/\s+/).filter((t: string) => t.length > 1);
      const scored = allProjects
        .filter(
          (p: Project) =>
            activeTab === 'all' ||
            activeTab === 'projects' ||
            (activeTab === 'sectors' &&
              SECTORS.some((s) => (p.sector || '').toLowerCase().includes(s.toLowerCase())))
        )
        .map((p: Project) => {
          const title = p.projectName.toLowerCase();
          const code = (p.projectCode || '').toLowerCase();
          const sector = (p.sector || '').toLowerCase();
          let score = 0;
          for (const t of terms) {
            if (title.includes(t)) score += t.length * 2;
            if (code.includes(t)) score += t.length;
            if (sector.includes(t)) score += t.length;
          }
          return { p, score };
        })
        .filter((x: { score: number }) => x.score > 0)
        .sort(
          (a: { score: number; p: Project }, b: { score: number; p: Project }) =>
            b.score - a.score || b.p.financialYear - a.p.financialYear || b.p.amount - a.p.amount
        )
        .slice(0, 20)
        .map((x: { p: Project }) => x.p);
      setResults(scored);
      setSearchMeta({
        mode: 'local',
        totalMatches: scored.length,
        elapsedMs: Math.round(performance.now() - t0),
      });
      setActiveIdx(0);
    },
    [activeTab, allProjects, filterPresident, filterSeverity, filterYear, search, searchScope, staticPool]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      runSearch(query);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [query, runSearch]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setActiveTab('all');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, results.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter' && results[activeIdx]) {
        onSelectProject(results[activeIdx]);
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, results, activeIdx, onClose, onSelectProject]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!isOpen) return null;

  const tabStyle = (tab: SearchTab) => ({
    padding: '0.35rem 0.85rem',
    border: 'none',
    borderRadius: '6px',
    fontSize: '0.75rem',
    fontWeight: 600,
    cursor: 'pointer',
    backgroundColor: activeTab === tab ? '#0f172a' : 'transparent',
    color: activeTab === tab ? '#10b981' : '#64748b',
    transition: 'all 0.15s',
  });

  return (
    <div
      className="mobile-sheet-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1150,
        backgroundColor: 'rgba(9, 16, 23, 0.62)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '4.5rem 1rem 1rem',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Universal Budget Search"
        className="mobile-sheet-panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '720px',
          maxHeight: '82dvh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#ffffff',
          borderRadius: '14px',
          boxShadow: '0 24px 60px rgba(9, 16, 23, 0.35)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
        }}
      >
        <div className="mobile-sheet-handle" />
        {/* Search Input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.85rem 1.05rem', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
          <Search size={19} color="#10b981" style={{ flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            placeholder={
              searchScope === 'all'
                ? 'Search all 28 Federal Budgets (1999–2026)...'
                : `Search ${totalCount.toLocaleString()} projects (${displayYear})...`
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: '1rem', color: '#0f172a', fontWeight: 500, background: 'transparent' }}
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search query" style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '0.35rem' }}>
              <X size={16} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              backgroundColor: '#f8fafc',
              color: '#475569',
              flexShrink: 0,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs + Scope Toggle */}
        <div className="mobile-chip-scroll" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.5rem 1rem', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap', flexShrink: 0 }}>
          {(['all', 'projects', 'sectors', 'commands'] as SearchTab[]).map((tab) => (
            <button key={tab} style={tabStyle(tab)} onClick={() => setActiveTab(tab)}>
              {tab === 'all' ? 'All' : tab === 'projects' ? 'Projects' : tab === 'sectors' ? 'Sectors' : 'AI Commands'}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setSearchScope('year')}
              style={{
                padding: '0.2rem 0.55rem',
                borderRadius: '4px',
                border: '1px solid #cbd5e1',
                fontSize: '0.68rem',
                fontWeight: 600,
                cursor: 'pointer',
                backgroundColor: searchScope === 'year' ? '#091017' : '#ffffff',
                color: searchScope === 'year' ? '#ffffff' : '#64748b',
              }}
            >
              FY {displayYear}
            </button>
            <button
              type="button"
              onClick={() => setSearchScope('all')}
              style={{
                padding: '0.2rem 0.55rem',
                borderRadius: '4px',
                border: '1px solid #cbd5e1',
                fontSize: '0.68rem',
                fontWeight: 600,
                cursor: 'pointer',
                backgroundColor: searchScope === 'all' ? '#091017' : '#ffffff',
                color: searchScope === 'all' ? '#ffffff' : '#64748b',
              }}
            >
              All 28 Years ({availableYears.length || 28})
            </button>
            <span className="font-mono tabular-nums" style={{ fontSize: '0.68rem', color: '#059669', marginLeft: '0.2rem' }}>
              {searchMeta.totalMatches > 0 ? `${searchMeta.totalMatches.toLocaleString()} hits (${searchMeta.elapsedMs}ms · ${searchMeta.mode.toUpperCase()})` : ''}
            </span>
          </div>
        </div>

        {/* Faceted Filter Bar (All 28 Years Mode) */}
        {searchScope === 'all' && (
          <div style={{ padding: '0.45rem 1rem', backgroundColor: '#ffffff', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', fontSize: '0.7rem' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: '#64748b', fontWeight: 700 }}>
              <Filter size={11} /> Facets:
            </span>
            <select
              aria-label="Filter by President"
              value={filterPresident}
              onChange={(e) => setFilterPresident(e.target.value)}
              style={{ padding: '0.2rem 0.45rem', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.7rem' }}
            >
              <option value="ALL">All Administrations</option>
              <option value="obasanjo">Obasanjo (1999–2007)</option>
              <option value="yaradua">Yar&apos;Adua (2008–2010)</option>
              <option value="jonathan">Jonathan (2011–2015)</option>
              <option value="buhari">Buhari (2016–2023)</option>
              <option value="tinubu">Tinubu (2024–2026)</option>
            </select>
            <select
              aria-label="Filter by Fiscal Year"
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
              style={{ padding: '0.2rem 0.45rem', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.7rem' }}
            >
              <option value="ALL">All Years (1999–2026)</option>
              {availableYears.map((y) => (
                <option key={y} value={String(y)}>
                  FY {y}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by Forensic Severity"
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value)}
              style={{ padding: '0.2rem 0.45rem', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.7rem' }}
            >
              <option value="ALL">All Risk Levels</option>
              <option value="high">HIGH Risk Flagged</option>
              <option value="medium">MEDIUM Risk Flagged</option>
              <option value="low">LOW Risk Flagged</option>
            </select>
          </div>
        )}

        {/* Quick Chips */}
        {!query && (
          <div className="mobile-chip-scroll" style={{ padding: '0.65rem 1.05rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap', borderBottom: '1px solid #f1f5f9', flexShrink: 0 }}>
            <span style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 600, alignSelf: 'center', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
              <Sparkles size={11} color="#10b981" /> Try:
            </span>
            {QUICK_CHIPS.map((chip, i) => (
              <button
                key={i}
                onClick={() => setQuery(chip.label)}
                style={{ backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '20px', padding: '0.2rem 0.65rem', fontSize: '0.7rem', color: '#334155', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
              >
                {chip.icon} {chip.label}
              </button>
            ))}
          </div>
        )}

        {/* Sector Tab */}
        {activeTab === 'sectors' && !query && (
          <div style={{ padding: '0.75rem 1.05rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '0.5rem', flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
            {SECTORS.map((sector) => {
              const count = allProjects.filter((p) => (p.sector || '').toLowerCase().includes(sector.toLowerCase().split(' ')[0])).length;
              const total = allProjects.filter((p) => (p.sector || '').toLowerCase().includes(sector.toLowerCase().split(' ')[0])).reduce((s, p) => s + p.amount, 0);
              return (
                <button
                  key={sector}
                  onClick={() => {
                    setQuery(sector);
                    setActiveTab('projects');
                  }}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.65rem 0.9rem', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', textAlign: 'left' }}
                >
                  <div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: SECTOR_COLORS[sector] || '#64748b' }}>{sector}</div>
                    <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>{count.toLocaleString()} projects</div>
                  </div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0f172a' }}>{formatNaira(total)}</div>
                </button>
              );
            })}
          </div>
        )}

        {/* AI Commands Tab */}
        {activeTab === 'commands' && !query && (
          <div style={{ padding: '0.5rem 0' }}>
            {commands.map((cmd, i) => (
              <div
                key={i}
                onClick={() => {
                  onSelectProject({ isAiCommand: true, command: cmd.label });
                  onClose();
                }}
                style={{ padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', borderBottom: i < commands.length - 1 ? '1px solid #f1f5f9' : 'none' }}
              >
                {cmd.icon}
                <span style={{ fontSize: '0.85rem', color: '#0f172a', fontWeight: 500 }}>{cmd.label}</span>
                <Bot size={14} color="#10b981" style={{ marginLeft: 'auto' }} />
              </div>
            ))}
          </div>
        )}

        {/* Results List */}
        {(activeTab !== 'sectors' || query) && (activeTab !== 'commands' || query) && (
          <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
            {results.length > 0 ? (
              results.map((p, idx) => (
                <div
                  key={`${p.financialYear}-${p.id || idx}`}
                  data-idx={idx}
                  onClick={() => {
                    onSelectProject(p);
                    onClose();
                  }}
                  style={{
                    padding: '0.75rem 1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '1rem',
                    cursor: 'pointer',
                    backgroundColor: activeIdx === idx ? '#f0fdf4' : '#ffffff',
                    borderLeft: activeIdx === idx ? '3px solid #10b981' : '3px solid transparent',
                    borderBottom: idx < results.length - 1 ? '1px solid #f8fafc' : 'none',
                  }}
                  onMouseEnter={() => setActiveIdx(idx)}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.65rem', backgroundColor: '#e8f2ff', color: '#3b82f6', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: '4px', fontFamily: 'monospace' }}>
                        {p.projectCode || `PG-${p.page}`}
                      </span>
                      {p.sector && (
                        <span style={{ fontSize: '0.65rem', backgroundColor: '#f1f5f9', color: SECTOR_COLORS[p.sector] || '#64748b', fontWeight: 600, padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                          {p.sector}
                        </span>
                      )}
                      <span style={{ fontSize: '0.65rem', color: '#059669', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                        <Hash size={10} /> FY {p.financialYear}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a', lineHeight: 1.4 }}>
                      <ExpandableText text={p.projectName} maxChars={140} />
                    </div>
                    {p.agency && (
                      <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '0.1rem' }}>
                        {p.agency}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div className="font-mono tabular-nums" style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0f172a' }}>
                      {formatNaira(p.amount)}
                    </div>
                    <div style={{ fontSize: '0.65rem', color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.2rem', justifyContent: 'flex-end' }}>
                      <FileText size={10} /> Pg. {p.page} <CornerDownLeft size={11} />
                    </div>
                  </div>
                </div>
              ))
            ) : query ? (
              <div style={{ padding: '2.5rem', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
                <Search size={32} color="#e2e8f0" style={{ marginBottom: '0.75rem' }} />
                <div>No projects found for <strong>&ldquo;{query}&rdquo;</strong></div>
                <div style={{ fontSize: '0.75rem', marginTop: '0.3rem', color: '#94a3b8' }}>Try broader keywords or clear facet filters</div>
              </div>
            ) : null}
          </div>
        )}

        {/* Footer */}
        <div className="mobile-hide" style={{ padding: '0.6rem 1.25rem', backgroundColor: '#f8fafc', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', color: '#94a3b8', flexShrink: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <MapPin size={11} color="#10b981" />
            1999–2026 Federal Appropriation Corpus · FTS5 &amp; Offline Index
          </span>
          <span style={{ display: 'flex', gap: '0.75rem' }}>
            <span>↑↓ navigate</span>
            <span>↵ open</span>
            <span>ESC close</span>
          </span>
        </div>
      </div>
    </div>
  );
};
