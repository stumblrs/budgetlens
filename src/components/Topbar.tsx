import React, { useEffect, useMemo, useState } from 'react';
import { Briefcase, Calendar, Check, ChevronDown, ChevronRight, HelpCircle, Layers, Link2, Menu, PanelLeftClose, PanelLeftOpen, Quote, Search, X } from 'lucide-react';
import { computeCasebookMetrics, useCasebook } from '../context/CasebookContext';
import { useBudgetDatabase } from '../context/BudgetDatabaseContext';
import type { RegistryDocument } from '../services/budgetDatabaseEngine';
import { PRESIDENTIAL_TERMS, PresidentialTerm, getPresidentForYear } from '../data/presidentialTerms';
import { getCoverageCaveatMeta } from '../utils/displayText';
import { PresidentAvatar } from './PresidentAvatar';
import { PlainEnglishGuideModal } from './PlainEnglishGuideModal';

interface TopbarProps {
  onMenuToggle: () => void;
  isSidebarCollapsed?: boolean;
  selectedYear?: number;
  activeTab?: string;
  onOpenSearch?: () => void;
  onNavigateCompare?: () => void;
  onSelectYear?: (year: number) => void;
  onSelectTenure?: (term: PresidentialTerm) => void;
  onCopyPermalink?: () => void;
  onOpenCite?: () => void;
  onOpenGuide?: () => void;
}

const TAB_BREADCRUMBS: Record<string, { group: string; label: string }> = {
  overview: { group: 'Observatory', label: 'Executive Overview' },
  citizen: { group: 'Observatory', label: 'Citizen Tax Receipt & Neighborhood' },
  oaugf: { group: 'Observatory', label: 'OAuGF Audit Negligences' },
  compare: { group: 'Observatory', label: '1999–2026 Presidential Compare' },
  scrutiny: { group: 'Observatory', label: 'Presidential Scrutiny Sweep' },
  cbn: { group: 'Observatory', label: 'CBN Governors & Debt Ledger' },
  trends: { group: 'Observatory', label: 'Spending Trends' },
  execution: { group: 'Observatory', label: 'Execution & Contracts' },
  projects: { group: 'Budget Explorer', label: 'Capital Projects' },
  agencies: { group: 'Budget Explorer', label: 'Ministries & MDAs' },
  network: { group: 'Budget Explorer', label: 'Ministries & MDAs' },
  map: { group: 'Budget Explorer', label: 'Geo & Anomaly Map' },
  assets: { group: 'Budget Explorer', label: 'Asset Inventory' },
  evidence: { group: 'Forensic Lab', label: 'Evidence Engine' },
  rules: { group: 'Forensic Lab', label: 'Evidence Engine' },
  duplicates: { group: 'Forensic Lab', label: 'Duplicate Detector' },
  anomalies: { group: 'Budget Explorer', label: 'Geo & Anomaly Map' },
  recurring: { group: 'Forensic Lab', label: 'Recurring Lineages' },
  forensics: { group: 'Forensic Lab', label: 'Statistical Forensics' },
  padding: { group: 'Forensic Lab', label: 'Bill vs. Act Diff' },
  record: { group: 'Budget Explorer', label: 'Official Record Dossier' },
  ai: { group: 'Forensic Lab', label: 'AI Assistant' },
  reports: { group: 'Publish & Cite', label: 'Reports & Export' },
  casebook: { group: 'Publish & Cite', label: 'Investigator Casebook' },
  methodology: { group: 'Publish & Cite', label: 'Sources & Methodology' },
};

export const Topbar: React.FC<TopbarProps> = ({
  onMenuToggle,
  isSidebarCollapsed = true,
  selectedYear,
  activeTab = 'overview',
  onOpenSearch,
  onNavigateCompare,
  onSelectYear,
  onSelectTenure,
  onCopyPermalink,
  onOpenCite,
  onOpenGuide,
}) => {
  const { availableYears, activeYear, setActiveYear, registryDocs } = useBudgetDatabase();
  const { activeCasebook, setDrawerOpen } = useCasebook();
  const casebookMetrics = computeCasebookMetrics(activeCasebook.pins);
  const [linkCopied, setLinkCopied] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [selectedTenureId, setSelectedTenureId] = useState<string | null>(null);

  useEffect(() => {
    if (!scopeOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setScopeOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [scopeOpen]);

  const effectiveYear = selectedYear ?? activeYear ?? 2026;
  const president = getPresidentForYear(effectiveYear);
  const crumb = TAB_BREADCRUMBS[activeTab] || TAB_BREADCRUMBS.overview;

  const regDocByYear = useMemo(() => {
    const map = new Map<number, RegistryDocument>();
    for (const d of registryDocs) {
      const yr = d.financial_year || d.financialYear;
      if (yr) map.set(yr, d);
    }
    return map;
  }, [registryDocs]);

  const activeCoverage = useMemo(
    () => getCoverageCaveatMeta(effectiveYear, regDocByYear.get(effectiveYear)),
    [effectiveYear, regDocByYear]
  );

  const handleCopy = () => {
    if (onCopyPermalink) {
      onCopyPermalink();
    } else {
      navigator.clipboard?.writeText(window.location.href);
    }
    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 1800);
  };

  return (
    <>
      <header className="app-topbar">
        {/* Left: Drawer Toggle, Institutional Breadcrumb & Command Search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flex: '1 1 auto', minWidth: 0 }}>
          <button
            type="button"
            onClick={onMenuToggle}
            className="mobile-menu-btn"
            aria-label={isSidebarCollapsed ? 'Open or expand navigation menu' : 'Collapse navigation menu'}
            title={isSidebarCollapsed ? 'Expand navigation menu (Ctrl+B)' : 'Collapse navigation menu (Ctrl+B)'}
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0.42rem',
              minWidth: '38px',
              minHeight: '38px',
              flexShrink: 0,
              boxShadow: 'var(--shadow-xs)',
            }}
          >
            <span className="desktop-sidebar-icon">
              {isSidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </span>
            <span className="mobile-sidebar-icon">
              <Menu size={17} />
            </span>
          </button>

          {/* Live Context Breadcrumb */}
          <nav aria-label="Breadcrumb" className="topbar-breadcrumb">
            <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>
              {crumb.group}
            </span>
            <ChevronRight size={13} color="var(--text-light)" style={{ flexShrink: 0 }} />
            <span
              style={{
                fontSize: '0.77rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {crumb.label}
            </span>
          </nav>

          <span className="mobile-topbar-title">{crumb.label}</span>

          {/* Command Search Trigger */}
          <button
            type="button"
            onClick={onOpenSearch}
            aria-label="Search MDAs, codes, and projects"
            className="topbar-search-btn"
            style={{
              cursor: onOpenSearch ? 'pointer' : 'default',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <Search size={15} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
              <span className="topbar-hide-sm">Search MDAs, codes, projects...</span>
            </span>
            <kbd
              className="font-mono topbar-hide-sm"
              style={{
                fontSize: '0.66rem',
                padding: '0.08rem 0.34rem',
                borderRadius: '4px',
                border: '1px solid var(--border-color)',
                backgroundColor: '#ffffff',
                color: 'var(--text-secondary)',
                flexShrink: 0,
              }}
            >
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Right: Sync / Fiscal Scope Dropdown, Copy Permalink, Guide, Cite View, Administration Chip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexShrink: 0 }}>
          <div className="topbar-hide-sm" style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setScopeOpen((prev) => !prev)}
              aria-expanded={scopeOpen}
              aria-label="Select single fiscal year or 4-year presidential tenure"
              title={`${availableYears.length} fiscal years indexed (${registryDocs.length} government records synced) · FY ${effectiveYear}: ${activeCoverage.label} — ${activeCoverage.detail}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.3rem 0.62rem',
                borderRadius: '9999px',
                backgroundColor: 'var(--emerald-bg)',
                border: '1px solid #a7f3d0',
                color: '#065f46',
                fontSize: '0.71rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <span className="live-pulse-dot" />
              <span className="font-mono tabular-nums">
                {selectedTenureId
                  ? `${availableYears.length} Yrs Live · ${PRESIDENTIAL_TERMS.find((t) => t.termId === selectedTenureId)?.termLabel || '4-Yr'}`
                  : `${availableYears.length} Yrs Live · FY ${effectiveYear}${activeCoverage.tier !== 'FULL_SCHEDULE' ? ` · ${activeCoverage.shortBadge}` : ''
                  }`}
              </span>
              <ChevronDown size={12} />
            </button>
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="editorial-btn topbar-hide-sm"
            title="Copy direct link to current view"
            style={{ padding: '0.36rem 0.65rem', fontSize: '0.73rem' }}
          >
            {linkCopied ? <Check size={13} color="#059669" /> : <Link2 size={13} />}
            <span>{linkCopied ? 'Copied' : 'Copy Link'}</span>
          </button>

          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="editorial-btn"
            title="Open Investigator Casebook"
            style={{ padding: '0.36rem 0.58rem', fontSize: '0.73rem', minHeight: '36px' }}
          >
            <Briefcase size={14} color="#059669" />
            <span className="topbar-hide-sm">Casebook</span>
            <span
              className="font-mono tabular-nums"
              style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                padding: '0.06rem 0.36rem',
                borderRadius: '999px',
                backgroundColor: casebookMetrics.totalPins > 0 ? '#059669' : '#e2e8f0',
                color: casebookMetrics.totalPins > 0 ? '#ffffff' : '#475569',
              }}
            >
              {casebookMetrics.totalPins}
            </span>
          </button>

          <button
            type="button"
            onClick={() => (onOpenGuide ? onOpenGuide() : setGuideOpen(true))}
            className="editorial-btn topbar-hide-sm"
            title="Open Plain-English Budget & Forensics Guide"
            style={{ padding: '0.36rem 0.65rem', fontSize: '0.73rem' }}
          >
            <HelpCircle size={13} color="#059669" />
            <span>Guide</span>
          </button>

          {onOpenCite && (
            <button
              type="button"
              onClick={onOpenCite}
              className="editorial-btn topbar-hide-sm"
              title="Cite current BudgetLens view"
              style={{ padding: '0.36rem 0.68rem', fontSize: '0.73rem' }}
            >
              <Quote size={13} color="#059669" />
              <span>Cite View</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined' && window.innerWidth <= 640) {
                setScopeOpen((prev) => !prev);
              } else {
                onNavigateCompare?.();
              }
            }}
            aria-expanded={scopeOpen}
            title={`${president.presidentName} (${president.termLabel}) — select year or open 1999–2026 Presidential Compare`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.24rem 0.55rem 0.24rem 0.28rem',
              borderRadius: '9999px',
              border: '1px solid var(--border-color)',
              backgroundColor: '#ffffff',
              minHeight: '36px',
            }}
          >
            <PresidentAvatar
              src={president.portraitPath}
              name={president.presidentName}
              initials={president.initials}
              accentColor={president.accentColor}
              size={23}
              party={president.party}
            />
            <span className="font-mono tabular-nums" style={{ fontSize: '0.73rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              FY {effectiveYear}
            </span>
            <ChevronDown size={12} color="var(--text-muted)" className="mobile-only-block" />
            <span className="topbar-hide-sm" style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
              {president.shortName.split(' ')[0]}
            </span>
          </button>
        </div>
      </header>

      {scopeOpen && (
        <div
          className="scope-menu-backdrop mobile-sheet-backdrop"
          onClick={() => setScopeOpen(false)}
        >
          <div
            role="menu"
            aria-label="Fiscal Scope Selector"
            className="scope-menu-panel mobile-sheet-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mobile-sheet-handle" />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '0.25rem' }}>
              <span className="font-mono" style={{ fontSize: '0.68rem', fontWeight: 700, color: '#0f172a', textTransform: 'uppercase' }}>
                Select Fiscal Dataset ({availableYears.length} Years)
              </span>
              <button
                type="button"
                onClick={() => setScopeOpen(false)}
                aria-label="Close fiscal year selector"
                style={{
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  backgroundColor: '#f8fafc',
                  color: '#475569',
                  width: '30px',
                  height: '30px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <X size={14} />
              </button>
            </div>

            <div
              style={{
                padding: '0.42rem 0.58rem',
                borderRadius: '8px',
                backgroundColor: activeCoverage.bg,
                border: `1px solid ${activeCoverage.border}`,
                color: activeCoverage.color,
                fontSize: '0.68rem',
                lineHeight: 1.38,
              }}
            >
              <div className="font-mono" style={{ fontWeight: 700 }}>
                FY {effectiveYear} · {activeCoverage.label}
              </div>
              {activeCoverage.hasCaveat && (
                <div style={{ marginTop: '0.14rem', color: 'var(--text-secondary)' }}>
                  {activeCoverage.detail}
                </div>
              )}
            </div>

            <div>
              <div className="font-mono" style={{ fontSize: '0.66rem', fontWeight: 700, color: '#059669', textTransform: 'uppercase', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <Layers size={12} /> Full 4-Year Presidential Tenures
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.28rem' }}>
                {PRESIDENTIAL_TERMS.map((term) => {
                  const active = selectedTenureId === term.termId;
                  return (
                    <button
                      key={term.termId}
                      type="button"
                      onClick={() => {
                        setSelectedTenureId(term.termId);
                        const latestInTerm = Math.max(...term.budgetYears);
                        if (onSelectTenure) {
                          onSelectTenure(term);
                        } else {
                          setActiveYear(latestInTerm);
                          onNavigateCompare?.();
                        }
                        setScopeOpen(false);
                      }}
                      style={{
                        textAlign: 'left',
                        padding: '0.48rem 0.62rem',
                        borderRadius: '6px',
                        border: active ? '1px solid #059669' : '1px solid var(--border-subtle)',
                        backgroundColor: active ? '#ecfdf5' : '#faf9f6',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '0.4rem',
                        fontSize: '0.75rem',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <span style={{ fontWeight: 700 }}>{term.shortName}</span>
                      <span className="font-mono" style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                        {Math.min(...term.budgetYears)}–{Math.max(...term.budgetYears)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.6rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.4rem' }}>
                <div className="font-mono" style={{ fontSize: '0.66rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <Calendar size={12} /> Single Fiscal Year ({availableYears.length})
                </div>
                <div className="font-mono" style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.58rem', color: 'var(--text-muted)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '999px', backgroundColor: '#059669' }} />
                    Full
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '999px', backgroundColor: '#d97706' }} />
                    Partial
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '999px', backgroundColor: '#64748b' }} />
                    Summary Act
                  </span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.35rem' }}>
                {[...availableYears].sort((a, b) => b - a).map((yr) => {
                  const active = !selectedTenureId && yr === effectiveYear;
                  const yrCov = getCoverageCaveatMeta(yr, regDocByYear.get(yr));
                  const dotColor =
                    yrCov.tier === 'FULL_SCHEDULE'
                      ? '#059669'
                      : yrCov.tier === 'PARTIAL_SCHEDULE'
                        ? '#d97706'
                        : '#64748b';
                  return (
                    <button
                      key={yr}
                      type="button"
                      title={`FY ${yr} — ${yrCov.label}: ${yrCov.detail}`}
                      onClick={() => {
                        setSelectedTenureId(null);
                        if (onSelectYear) onSelectYear(yr);
                        else setActiveYear(yr);
                        setScopeOpen(false);
                      }}
                      className="font-mono tabular-nums"
                      style={{
                        padding: '0.42rem 0.25rem',
                        borderRadius: '6px',
                        border: active ? '1px solid #059669' : '1px solid var(--border-subtle)',
                        backgroundColor: active ? '#091017' : '#ffffff',
                        color: active ? '#ffffff' : 'var(--text-primary)',
                        fontSize: '0.73rem',
                        fontWeight: active ? 700 : 500,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.22rem',
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: '5px',
                          height: '5px',
                          borderRadius: '999px',
                          backgroundColor: active ? '#34d399' : dotColor,
                          flexShrink: 0,
                        }}
                      />
                      <span>{yr}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {onNavigateCompare && (
              <button
                type="button"
                onClick={() => {
                  setScopeOpen(false);
                  onNavigateCompare();
                }}
                className="editorial-btn-primary mobile-only-flex"
                style={{ justifyContent: 'center', width: '100%', padding: '0.6rem' }}
              >
                Open 1999–2026 Presidential Compare
              </button>
            )}
          </div>
        </div>
      )}

      <PlainEnglishGuideModal isOpen={guideOpen} onClose={() => setGuideOpen(false)} />
    </>
  );
};
