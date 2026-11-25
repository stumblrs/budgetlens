import React, { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Box,
  Briefcase,
  Building2,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileCheck2,
  FileText,
  FolderKanban,
  GitCompare,
  HelpCircle,
  Landmark,
  Layers,
  LayoutDashboard,
  Link2,
  MapPin,
  Network,
  Quote,
  RefreshCw,
  Scale,
  Sparkles,
  TrendingUp,
  UserCheck,
  X,
} from 'lucide-react';
import { useBudgetDatabase } from '../context/BudgetDatabaseContext';
import { PRESIDENTIAL_TERMS, getPresidentForYear } from '../data/presidentialTerms';
import { getMacroForYear } from '../data/historicalMacroData';
import { evaluateDrawerSwipe } from '../utils/mobilePwa';
import { PresidentAvatar } from './PresidentAvatar';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  selectedYear: number;
  onSelectYear: (year: number) => void;
  activeTab: string;
  onSelectTab: (tab: string) => void;
  onOpenGuide?: () => void;
  onOpenCite?: () => void;
  onCopyPermalink?: () => void;
  onOpenCasebook?: () => void;
  casebookPinsCount?: number;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

interface FloatingTooltipState {
  group: string;
  label: string;
  badge?: string;
  top: number;
  left: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  isCollapsed = true,
  onToggleCollapse,
  selectedYear,
  onSelectYear,
  activeTab,
  onSelectTab,
  onOpenGuide,
  onOpenCite,
  onCopyPermalink,
  onOpenCasebook,
  casebookPinsCount = 0,
}) => {
  const { availableYears, registryDocs, refreshNow, lastSyncedAt } = useBudgetDatabase();
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 1024 : false
  );
  const [hoveredTip, setHoveredTip] = useState<FloatingTooltipState | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 1024px)');
    const syncViewport = () => setIsMobileViewport(mq.matches);
    syncViewport();
    mq.addEventListener('change', syncViewport);
    return () => mq.removeEventListener('change', syncViewport);
  }, []);

  const effectiveCollapsed = isMobileViewport ? false : isCollapsed;

  useEffect(() => {
    if (!effectiveCollapsed) setHoveredTip(null);
  }, [effectiveCollapsed]);

  const activePres = getPresidentForYear(selectedYear);
  const macro = getMacroForYear(selectedYear);

  const docsByYear = new Map(
    registryDocs.map((d) => [d.financial_year || d.financialYear, d])
  );
  const activeDoc = docsByYear.get(selectedYear);
  const activeCount = activeDoc ? (activeDoc.project_count || activeDoc.extractedProjectsCount || 0) : 0;
  const knownYearsSet = new Set(PRESIDENTIAL_TERMS.flatMap((t) => t.budgetYears));
  const extraYears = availableYears.filter((y) => !knownYearsSet.has(y)).sort((a, b) => b - a);

  const navGroups: NavGroup[] = [
    {
      title: 'OBSERVATORY',
      items: [
        { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={15} /> },
        { id: 'citizen', label: 'Citizen Tax & Area', icon: <UserCheck size={15} />, badge: 'New' },
        { id: 'oaugf', label: 'OAuGF Negligences', icon: <Scale size={15} />, badge: 'Audit' },
        { id: 'compare', label: '1999–2026 Compare', icon: <GitCompare size={15} /> },
        { id: 'scrutiny', label: 'Presidential Scrutiny', icon: <Scale size={15} /> },
        { id: 'cbn', label: 'CBN & Debt Ledger', icon: <Landmark size={15} />, badge: 'New' },
        { id: 'trends', label: 'Spending Trends', icon: <TrendingUp size={15} /> },
        { id: 'execution', label: 'Execution & Contracts', icon: <FileCheck2 size={15} /> },
      ],
    },
    {
      title: 'BUDGET EXPLORER',
      items: [
        { id: 'projects', label: 'Capital Projects', icon: <FolderKanban size={15} /> },
        { id: 'agencies', label: 'Ministries & MDAs', icon: <Building2 size={15} /> },
        { id: 'map', label: 'Geo & Anomaly Map', icon: <MapPin size={15} /> },
        { id: 'assets', label: 'Asset Inventory', icon: <Box size={15} /> },
      ],
    },
    {
      title: 'FORENSIC LAB',
      items: [
        { id: 'forensics', label: 'Statistical Forensics', icon: <BarChart3 size={15} />, badge: 'Lab' },
        { id: 'padding', label: 'Bill vs. Act Diff', icon: <GitCompare size={15} />, badge: 'Diff' },
        { id: 'evidence', label: 'Evidence Engine', icon: <FileCheck2 size={15} /> },
        { id: 'duplicates', label: 'Duplicate Detector', icon: <Copy size={15} /> },
        { id: 'recurring', label: 'Recurring Lineages', icon: <Network size={15} /> },
        { id: 'ai', label: 'AI Assistant', icon: <Sparkles size={15} />, badge: 'Beta' },
      ],
    },
    {
      title: 'PUBLISH & CITE',
      items: [
        { id: 'casebook', label: 'Investigator Casebook', icon: <Briefcase size={15} /> },
        { id: 'reports', label: 'Reports & Export', icon: <FileText size={15} /> },
        { id: 'methodology', label: 'Sources & Methodology', icon: <BookOpen size={15} /> },
      ],
    },
  ];

  const isNavItemActive = (id: string) =>
    activeTab === id ||
    (id === 'evidence' && activeTab === 'rules') ||
    (id === 'agencies' && activeTab === 'network') ||
    (id === 'map' && activeTab === 'anomalies');

  const showFloatingTooltip = (
    el: HTMLElement,
    group: string,
    label: string,
    badge?: string
  ) => {
    if (!effectiveCollapsed) return;
    const rect = el.getBoundingClientRect();
    setHoveredTip({
      group,
      label,
      badge,
      top: rect.top + rect.height / 2,
      left: rect.right + 14,
    });
  };

  const renderNavButton = (groupTitle: string, item: NavItem) => {
    const isActive = isNavItemActive(item.id);
    return (
      <button
        key={item.id}
        type="button"
        aria-label={item.label}
        onClick={() => {
          onSelectTab(item.id);
          onClose();
        }}
        onMouseEnter={(e) => showFloatingTooltip(e.currentTarget, groupTitle, item.label, item.badge)}
        onFocus={(e) => showFloatingTooltip(e.currentTarget, groupTitle, item.label, item.badge)}
        onMouseLeave={() => setHoveredTip(null)}
        onBlur={() => setHoveredTip(null)}
        className={`sidebar-nav-btn ${effectiveCollapsed ? 'rail-mode' : ''} ${isActive ? 'active' : ''}`}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.62rem', minWidth: 0 }}>
          <span className="sidebar-icon-box">{item.icon}</span>
          {!effectiveCollapsed && (
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.label}
            </span>
          )}
        </span>
        {!effectiveCollapsed && item.badge && (
          <span
            className="font-mono"
            style={{
              fontSize: '0.58rem',
              backgroundColor: 'rgba(16, 185, 129, 0.14)',
              color: '#6ee7b7',
              padding: '0.08rem 0.38rem',
              borderRadius: '999px',
              border: '1px solid rgba(16, 185, 129, 0.28)',
              flexShrink: 0,
            }}
          >
            {item.badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <>
      <aside
        className={`sidebar-shell ${isOpen ? 'open' : ''} ${effectiveCollapsed ? 'collapsed' : ''}`}
        style={{
          width: effectiveCollapsed ? 'var(--sidebar-rail-width)' : 'var(--sidebar-width)',
        }}
        onTouchStart={(e) => {
          if (!isMobileViewport || !isOpen || e.touches.length !== 1) return;
          const t = e.touches[0];
          touchStartRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
        }}
        onTouchEnd={(e) => {
          const start = touchStartRef.current;
          touchStartRef.current = null;
          if (!start || !isMobileViewport || !isOpen || e.changedTouches.length === 0) return;
          const t = e.changedTouches[0];
          if (evaluateDrawerSwipe(start.x, start.y, t.clientX, t.clientY, Date.now() - start.time)) {
            onClose();
          }
        }}
      >
        {/* Floating Edge Seam Handle (Desktop Only) */}
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={effectiveCollapsed ? 'Expand navigation rail' : 'Collapse navigation rail'}
            aria-expanded={!effectiveCollapsed}
            title={effectiveCollapsed ? 'Expand navigation (Ctrl+B)' : 'Collapse navigation (Ctrl+B)'}
            className="sidebar-edge-toggle"
          >
            {effectiveCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        )}

        {/* Sculpted Floating Obsidian Panel */}
        <div className="sidebar-panel">
          {/* Masthead */}
          <div
            style={{
              padding: effectiveCollapsed ? '0.9rem 0.45rem 0.78rem' : '0.95rem 0.9rem 0.82rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: effectiveCollapsed ? 'center' : 'space-between',
              borderBottom: '1px solid rgba(255, 255, 255, 0.065)',
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', minWidth: 0 }}>
              <button
                type="button"
                onClick={effectiveCollapsed ? onToggleCollapse : undefined}
                aria-label={effectiveCollapsed ? 'Expand BudgetLens sidebar' : 'BudgetLens'}
                onMouseEnter={(e) =>
                  showFloatingTooltip(
                    e.currentTarget,
                    'CIVIC OBSERVATORY',
                    'Expand Navigation',
                    'Ctrl+B'
                  )
                }
                onMouseLeave={() => setHoveredTip(null)}
                className="sidebar-brand-emblem"
                style={{
                  border: '1px solid rgba(255, 255, 255, 0.22)',
                  cursor: effectiveCollapsed ? 'pointer' : 'default',
                }}
              >
                <Layers size={17} />
              </button>

              {!effectiveCollapsed && (
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <h1
                      className="font-editorial"
                      style={{ color: '#ffffff', fontSize: '1.08rem', fontWeight: 600, lineHeight: 1.1, margin: 0 }}
                    >
                      BudgetLens
                    </h1>
                    <span
                      className="live-pulse-dot"
                      title="Verified Fourth Republic Corpus"
                      style={{ width: '6px', height: '6px' }}
                    />
                  </div>
                  <p
                    className="font-mono"
                    style={{
                      color: '#64748b',
                      fontSize: '0.58rem',
                      letterSpacing: '0.07em',
                      textTransform: 'uppercase',
                      margin: '0.18rem 0 0',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Nigeria · 1999–2026
                  </p>
                </div>
              )}
            </div>

            {!effectiveCollapsed && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span
                  className="font-mono desktop-sidebar-icon"
                  style={{
                    fontSize: '0.58rem',
                    color: '#64748b',
                    backgroundColor: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '5px',
                    padding: '0.12rem 0.35rem',
                  }}
                >
                  Ctrl+B
                </span>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close menu"
                  className="mobile-close-btn"
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '7px',
                    color: '#cbd5e1',
                    padding: '0.28rem',
                  }}
                >
                  <X size={17} />
                </button>
              </div>
            )}
          </div>

          {/* Scrollable 4-Group Navigation */}
          <div className="sidebar-scroll" onScroll={() => setHoveredTip(null)}>
            {!effectiveCollapsed && (onOpenGuide || onOpenCite || onCopyPermalink || onOpenCasebook) && (
              <div
                className="mobile-only-flex"
                style={{
                  gap: '0.35rem',
                  flexWrap: 'wrap',
                  padding: '0 0.2rem 0.7rem',
                  marginBottom: '0.65rem',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                {onOpenCasebook && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenCasebook();
                    }}
                    style={{
                      flex: '1 1 calc(50% - 0.35rem)',
                      minHeight: '38px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.35rem',
                      borderRadius: '8px',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      backgroundColor: 'rgba(16, 185, 129, 0.12)',
                      color: '#6ee7b7',
                      fontSize: '0.73rem',
                      fontWeight: 600,
                      padding: '0.35rem 0.5rem',
                    }}
                  >
                    <Briefcase size={13} /> Casebook ({casebookPinsCount})
                  </button>
                )}
                {onOpenCite && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenCite();
                    }}
                    style={{
                      flex: '1 1 calc(50% - 0.35rem)',
                      minHeight: '38px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.35rem',
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      color: '#e2e8f0',
                      fontSize: '0.73rem',
                      fontWeight: 600,
                      padding: '0.35rem 0.5rem',
                    }}
                  >
                    <Quote size={13} /> Cite View
                  </button>
                )}
                {onCopyPermalink && (
                  <button
                    type="button"
                    onClick={() => {
                      onCopyPermalink();
                      onClose();
                    }}
                    style={{
                      flex: '1 1 calc(50% - 0.35rem)',
                      minHeight: '38px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.35rem',
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      color: '#e2e8f0',
                      fontSize: '0.73rem',
                      fontWeight: 600,
                      padding: '0.35rem 0.5rem',
                    }}
                  >
                    <Link2 size={13} /> Copy Link
                  </button>
                )}
                {onOpenGuide && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenGuide();
                    }}
                    style={{
                      flex: '1 1 calc(50% - 0.35rem)',
                      minHeight: '38px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.35rem',
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      color: '#e2e8f0',
                      fontSize: '0.73rem',
                      fontWeight: 600,
                      padding: '0.35rem 0.5rem',
                    }}
                  >
                    <HelpCircle size={13} /> Guide
                  </button>
                )}
              </div>
            )}
            {navGroups.map((group, gIdx) => (
              <div
                key={group.title}
                style={{
                  marginBottom: effectiveCollapsed ? '0.62rem' : '0.88rem',
                }}
              >
                {!effectiveCollapsed ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      padding: '0 0.45rem 0.32rem',
                    }}
                  >
                    <span
                      className="font-mono"
                      style={{
                        fontSize: '0.58rem',
                        fontWeight: 700,
                        letterSpacing: '0.1em',
                        color: '#64748b',
                        flexShrink: 0,
                      }}
                    >
                      {group.title}
                    </span>
                    <span
                      style={{
                        height: '1px',
                        flex: 1,
                        background: 'linear-gradient(90deg, rgba(255, 255, 255, 0.09), transparent)',
                      }}
                    />
                  </div>
                ) : (
                  gIdx > 0 && (
                    <div
                      style={{
                        width: '20px',
                        height: '1px',
                        backgroundColor: 'rgba(255, 255, 255, 0.11)',
                        margin: '0 auto 0.5rem',
                      }}
                    />
                  )
                )}

                <nav style={{ display: 'flex', flexDirection: 'column', gap: effectiveCollapsed ? '0.32rem' : '0.18rem' }}>
                  {group.items.map((item) => renderNavButton(group.title, item))}
                </nav>
              </div>
            ))}
          </div>

          {/* Bottom Fiscal Administration & Year Dock */}
          <div
            style={{
              padding: effectiveCollapsed ? '0.65rem 0.45rem 0.8rem' : '0.65rem 0.65rem 0.75rem',
              borderTop: '1px solid rgba(255, 255, 255, 0.06)',
              flexShrink: 0,
            }}
          >
            {effectiveCollapsed ? (
              <button
                type="button"
                onClick={onToggleCollapse}
                aria-label={`FY ${selectedYear} — Expand to switch year`}
                onMouseEnter={(e) =>
                  showFloatingTooltip(
                    e.currentTarget,
                    'ACTIVE FISCAL DATASET',
                    `FY ${selectedYear} · ${activePres.presidentName} (${activePres.party})`,
                    'Switch'
                  )
                }
                onFocus={(e) =>
                  showFloatingTooltip(
                    e.currentTarget,
                    'ACTIVE FISCAL DATASET',
                    `FY ${selectedYear} · ${activePres.presidentName} (${activePres.party})`,
                    'Switch'
                  )
                }
                onMouseLeave={() => setHoveredTip(null)}
                onBlur={() => setHoveredTip(null)}
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '12px',
                  padding: '0.45rem 0.25rem',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.28rem',
                }}
              >
                <PresidentAvatar
                  src={activePres.portraitPath}
                  name={activePres.presidentName}
                  initials={activePres.initials}
                  accentColor={activePres.accentColor}
                  party={activePres.party}
                  size={30}
                />
                <span className="font-mono" style={{ fontSize: '0.62rem', fontWeight: 700, color: '#6ee7b7' }}>
                  FY &apos;{String(selectedYear).slice(-2)}
                </span>
              </button>
            ) : (
              <div className="sidebar-fy-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.58rem', marginBottom: '0.52rem' }}>
                  <PresidentAvatar
                    src={activePres.portraitPath}
                    name={activePres.presidentName}
                    initials={activePres.initials}
                    accentColor={activePres.accentColor}
                    party={activePres.party}
                    size={34}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <h4 style={{ color: '#ffffff', fontSize: '0.8rem', fontWeight: 700, lineHeight: 1.2, margin: 0 }}>
                      FY {selectedYear} Appropriation
                    </h4>
                    <p
                      style={{
                        color: '#94a3b8',
                        fontSize: '0.67rem',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        margin: '0.1rem 0 0',
                      }}
                    >
                      {activePres.presidentName} ({activePres.party})
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => refreshNow()}
                    aria-label="Refresh source registry"
                    title={lastSyncedAt ? `Registry synced ${new Date(lastSyncedAt).toLocaleTimeString()}` : 'Refresh source registry'}
                    style={{
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '7px',
                      padding: '0.3rem',
                      color: '#34d399',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <RefreshCw size={12} />
                  </button>
                </div>

                <div
                  className="font-mono"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '0.63rem',
                    color: '#cbd5e1',
                    backgroundColor: 'rgba(6, 11, 17, 0.72)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    borderRadius: '6px',
                    padding: '0.28rem 0.48rem',
                    marginBottom: '0.48rem',
                  }}
                >
                  <span>₦{(macro.officialTotalBudget / 1e12).toFixed(2)}T Act</span>
                  <span style={{ color: '#34d399' }}>₦{macro.fxNairaPerUsd}/$</span>
                </div>

                <select
                  value={selectedYear}
                  onChange={(e) => onSelectYear(Number(e.target.value))}
                  aria-label="Select Budget Fiscal Year"
                  style={{
                    width: '100%',
                    backgroundColor: '#131d2b',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '7px',
                    color: '#ffffff',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    padding: '0.4rem 0.5rem',
                    cursor: 'pointer',
                  }}
                >
                  {extraYears.length > 0 && (
                    <optgroup label="Post-2026 Datasets">
                      {extraYears.map((yr) => {
                        const doc = docsByYear.get(yr);
                        const cnt = doc ? (doc.project_count || doc.extractedProjectsCount || 0) : 0;
                        return (
                          <option key={yr} value={yr}>
                            {yr} Budget — {cnt.toLocaleString()} lines
                          </option>
                        );
                      })}
                    </optgroup>
                  )}
                  {[...PRESIDENTIAL_TERMS].reverse().map((term) => {
                    const termYears = [...term.budgetYears]
                      .filter((yr) => availableYears.length === 0 || availableYears.includes(yr))
                      .sort((a, b) => b - a);
                    if (termYears.length === 0) return null;
                    return (
                      <optgroup key={term.termId} label={`${term.presidentName} (${term.termLabel})`}>
                        {termYears.map((yr) => {
                          const doc = docsByYear.get(yr);
                          const cnt = doc ? (doc.project_count || doc.extractedProjectsCount || 0) : 0;
                          return (
                            <option key={yr} value={yr}>
                              {yr} Federal Budget {cnt > 0 ? `(${cnt.toLocaleString()} lines)` : '(Statutory Act)'}
                            </option>
                          );
                        })}
                      </optgroup>
                    );
                  })}
                </select>

                {(() => {
                  const coverageLabel =
                    activeDoc?.coverage_tier === 'FULL_SCHEDULE'
                      ? 'Full Schedule'
                      : activeDoc?.coverage_tier === 'PARTIAL_SCHEDULE'
                      ? 'Partial Schedule'
                      : activeDoc?.coverage_tier === 'SUMMARY_ACT_ONLY'
                      ? 'Summary Act'
                      : activeCount >= 1500
                      ? 'Full Schedule'
                      : activeCount > 0
                      ? 'Summary Act'
                      : 'Statutory Baseline';
                  const enrichedCount = activeDoc?.gemma_enriched_count || 0;
                  return (
                    <>
                      <div
                        className="font-mono"
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: '0.6rem',
                          color: '#64748b',
                          marginTop: '0.38rem',
                        }}
                      >
                        <span>{activeCount > 0 ? `${activeCount.toLocaleString()} · ${coverageLabel}` : 'Statutory Baseline'}</span>
                        <span>{availableYears.length} yrs ready</span>
                      </div>
                      {enrichedCount > 0 && (
                        <div
                          className="font-mono"
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: '0.58rem',
                            color: '#34d399',
                            marginTop: '0.22rem',
                          }}
                        >
                          <span>{enrichedCount.toLocaleString()} AI enriched · Live</span>
                          <span>{activeCount > 0 ? `${Math.min(100, Math.round((enrichedCount / activeCount) * 100))}%` : ''}</span>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Bespoke Floating Glass Tooltip (Collapsed Desktop Rail Mode Only) */}
      {effectiveCollapsed && hoveredTip && (
        <div
          className="sidebar-floating-tooltip"
          style={{
            top: `${hoveredTip.top}px`,
            left: `${hoveredTip.left}px`,
          }}
        >
          <div
            className="font-mono"
            style={{
              fontSize: '0.56rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: '#6ee7b7',
              textTransform: 'uppercase',
              marginBottom: '0.12rem',
            }}
          >
            {hoveredTip.group}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <span style={{ fontSize: '0.79rem', fontWeight: 600, color: '#ffffff' }}>
              {hoveredTip.label}
            </span>
            {hoveredTip.badge && (
              <span
                className="font-mono"
                style={{
                  fontSize: '0.58rem',
                  color: '#cbd5e1',
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.14)',
                  borderRadius: '999px',
                  padding: '0.06rem 0.35rem',
                }}
              >
                {hoveredTip.badge}
              </span>
            )}
          </div>
        </div>
      )}
    </>
  );
};
