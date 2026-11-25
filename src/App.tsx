import { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { HeaderStats } from './components/HeaderStats';
import { MacroNarrativeBrief } from './components/MacroNarrativeBrief';
import { TransparencyCard } from './components/TransparencyCard';
import { MobileBottomNav } from './components/MobileBottomNav';
import { MobileInstallPrompt } from './components/MobileInstallPrompt';
import { PlainEnglishGuideModal } from './components/PlainEnglishGuideModal';
import { computeCasebookMetrics, useCasebook } from './context/CasebookContext';

const CapitalProjectsDirectory = lazy(() =>
  import('./components/CapitalProjectsDirectory').then((m) => ({
    default: m.CapitalProjectsDirectory,
  }))
);

const SectorDistribution = lazy(() =>
  import('./components/SectorDistribution').then((m) => ({ default: m.SectorDistribution }))
);
const GeoMapWidget = lazy(() =>
  import('./components/GeoMapWidget').then((m) => ({ default: m.GeoMapWidget }))
);
const TopMinistriesWidget = lazy(() =>
  import('./components/TopMinistriesWidget').then((m) => ({ default: m.TopMinistriesWidget }))
);
const RecentFlaggedProjects = lazy(() =>
  import('./components/RecentFlaggedProjects').then((m) => ({ default: m.RecentFlaggedProjects }))
);
const SpendingTrendChart = lazy(() =>
  import('./components/SpendingTrendChart').then((m) => ({ default: m.SpendingTrendChart }))
);
const EvidenceEngineSummary = lazy(() =>
  import('./components/EvidenceEngineSummaryWidget').then((m) => ({ default: m.EvidenceEngineSummaryWidget }))
);
const GroundedAiAssistantWidget = lazy(() =>
  import('./components/GroundedAiAssistantWidget').then((m) => ({ default: m.GroundedAiAssistantWidget }))
);
const UniversalSearchModal = lazy(() =>
  import('./components/UniversalSearchModal').then((m) => ({ default: m.UniversalSearchModal }))
);
const BudgetAuditCalculatorWidget = lazy(() =>
  import('./components/BudgetAuditCalculatorWidget').then((m) => ({ default: m.BudgetAuditCalculatorWidget }))
);
const ProjectEvidenceModal = lazy(() =>
  import('./components/ProjectEvidenceModal').then((m) => ({ default: m.ProjectEvidenceModal }))
);
const ViewCitationModal = lazy(() =>
  import('./components/ViewCitationModal').then((m) => ({ default: m.ViewCitationModal }))
);
const TopDuplicateClustersWidget = lazy(() =>
  import('./components/TopDuplicateClustersWidget').then((m) => ({ default: m.TopDuplicateClustersWidget }))
);

const InvestigatorHeatmapWidget = lazy(() =>
  import('./components/InvestigatorHeatmapWidget').then((m) => ({ default: m.InvestigatorHeatmapWidget }))
);
const RecurringLineagesExplorer = lazy(() =>
  import('./components/RecurringLineagesExplorer').then((m) => ({ default: m.RecurringLineagesExplorer }))
);
const ExecutiveReportBuilderWidget = lazy(() =>
  import('./components/ExecutiveReportBuilderWidget').then((m) => ({ default: m.ExecutiveReportBuilderWidget }))
);
const AggregatedAssetsExplorer = lazy(() =>
  import('./components/AggregatedAssetsExplorer').then((m) => ({ default: m.AggregatedAssetsExplorer }))
);
const HistoricalPresidentialCompare = lazy(() =>
  import('./components/HistoricalPresidentialCompare').then((m) => ({ default: m.HistoricalPresidentialCompare }))
);
const CbnGovernorsAndDebtHub = lazy(() =>
  import('./components/CbnGovernorsAndDebtHub').then((m) => ({ default: m.CbnGovernorsAndDebtHub }))
);
const DuplicateClustersExplorer = lazy(() =>
  import('./components/DuplicateClustersExplorer').then((m) => ({ default: m.DuplicateClustersExplorer }))
);
const PublicScrutinyDossier = lazy(() =>
  import('./components/PublicScrutinyDossier').then((m) => ({ default: m.PublicScrutinyDossier }))
);
const SourcesMethodologyPage = lazy(() =>
  import('./components/SourcesMethodologyPage').then((m) => ({ default: m.SourcesMethodologyPage }))
);
const StatisticalForensicsLab = lazy(() =>
  import('./components/StatisticalForensicsLab').then((m) => ({ default: m.StatisticalForensicsLab }))
);
const BudgetPaddingDiffExplorer = lazy(() =>
  import('./components/BudgetPaddingDiffExplorer').then((m) => ({ default: m.BudgetPaddingDiffExplorer }))
);
const BudgetRecordDossierPage = lazy(() =>
  import('./components/BudgetRecordDossierPage').then((m) => ({ default: m.BudgetRecordDossierPage }))
);
const InvestigatorCasebookDrawer = lazy(() =>
  import('./components/InvestigatorCasebookDrawer').then((m) => ({ default: m.InvestigatorCasebookDrawer }))
);
const CasebookStudioPage = lazy(() =>
  import('./components/CasebookStudioPage').then((m) => ({ default: m.CasebookStudioPage }))
);
const ExecutionProcurementExplorer = lazy(() =>
  import('./components/ExecutionProcurementExplorer').then((m) => ({ default: m.ExecutionProcurementExplorer }))
);
const PdfDocumentViewerPage = lazy(() =>
  import('./components/PdfDocumentViewerPage').then((m) => ({ default: m.PdfDocumentViewerPage }))
);
const MdaIntegrityScorecardPanel = lazy(() =>
  import('./components/MdaIntegrityScorecardPanel').then((m) => ({
    default: m.MdaIntegrityScorecardPanel,
  }))
);
const GeoIntelligenceWorkspace = lazy(() =>
  import('./components/GeoIntelligenceWorkspace').then((m) => ({
    default: m.GeoIntelligenceWorkspace,
  }))
);
const CitizenAccountabilityHub = lazy(() =>
  import('./components/CitizenAccountabilityHub').then((m) => ({
    default: m.CitizenAccountabilityHub,
  }))
);
const OaugfNegligenceExplorer = lazy(() =>
  import('./components/OaugfNegligenceExplorer').then((m) => ({
    default: m.OaugfNegligenceExplorer,
  }))
);
const OverviewCrossLedgerWidget = lazy(() =>
  import('./components/OverviewCrossLedgerWidget').then((m) => ({
    default: m.OverviewCrossLedgerWidget,
  }))
);
const MultiLedgerTrendExplorer = lazy(() =>
  import('./components/MultiLedgerTrendExplorer').then((m) => ({
    default: m.MultiLedgerTrendExplorer,
  }))
);
import { Building2, ShieldCheck } from 'lucide-react';
import type { CompoundFlaggedProject, EvidenceItem } from './utils/ruleEngine';
import type { DuplicateCluster } from './utils/duplicateDetector';
import {
  loadEvidenceEngineAllYears,
  type EvidenceEngineAllYearsPayload,
} from './utils/evidenceEngineV3';
import { runForensicScan } from './services/forensicRunner';
import { useBudgetDatabase } from './context/BudgetDatabaseContext';
import { readAppUrlState, syncUrlParams, buildCanonicalPermalink } from './utils/urlState';

export function App() {
  const initialUrlState = useMemo(() => readAppUrlState(), []);
  const { activeYear: selectedYear, setActiveYear: setSelectedYear, registryDocs, lastSyncedAt } = useBudgetDatabase();
  const { activeCasebook, setDrawerOpen } = useCasebook();
  const casebookPinsCount = computeCasebookMetrics(activeCasebook.pins).totalPins;
  const mainContentRef = useRef<HTMLDivElement>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [datasetStats, setDatasetStats] = useState({ totalProjects: 0, totalAmount: 0 });
  const [extractedProjects, setExtractedProjects] = useState<any[]>([]);
  const [extractedProjectsYear, setExtractedProjectsYear] = useState<number | null>(null);
  const [priorAmount, setPriorAmount] = useState<number | undefined>(undefined);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [citeModalOpen, setCiteModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>(initialUrlState.tab);
  const [selectedModalProject, setSelectedModalProject] = useState<any | null>(null);
  const [pendingDeepLink, setPendingDeepLink] = useState<{ item: string; page: number | null } | null>(
    initialUrlState.item && initialUrlState.tab !== 'record'
      ? { item: initialUrlState.item, page: initialUrlState.page }
      : null
  );
  const [recurringLineages, setRecurringLineages] = useState<any[]>([]);

  const isPopStateRef = useRef(false);
  const hasMountedUrlSyncRef = useRef(false);
  const lastNavRef = useRef<{ tab: string; year: number }>({
    tab: initialUrlState.tab,
    year: initialUrlState.year ?? selectedYear,
  });

  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>([]);
  const [compoundProjects, setCompoundProjects] = useState<CompoundFlaggedProject[]>([]);
  const [duplicateClusters, setDuplicateClusters] = useState<DuplicateCluster[]>([]);
  const [evidenceAllYears, setEvidenceAllYears] = useState<EvidenceEngineAllYearsPayload | null>(null);
  const [isScanningForensics, setIsScanningForensics] = useState(false);

  // Search query state for Capital Projects Workbench (?q= permalink synced)
  const [projectSearchQuery, setProjectSearchQuery] = useState(initialUrlState.q);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);

  // Load 28-Year Evidence Engine v3.0 Cross-Ledger Index once
  useEffect(() => {
    let active = true;
    loadEvidenceEngineAllYears().then((data) => {
      if (active && data) {
        setEvidenceAllYears(data);
      }
    });
    return () => {
      active = false;
    };
  }, [lastSyncedAt]);

  // Off-main-thread Web Worker computation of Rule Engine v3.0 & Duplicate Clusters
  useEffect(() => {
    if (!extractedProjects || extractedProjects.length === 0) {
      setEvidenceItems([]);
      setCompoundProjects([]);
      setDuplicateClusters([]);
      setIsScanningForensics(false);
      return;
    }

    const controller = new AbortController();
    setIsScanningForensics(true);

    runForensicScan(
      extractedProjects,
      selectedYear,
      controller.signal,
      evidenceAllYears?.crossLedgerContext || null
    )
      .then((res) => {
        if (controller.signal.aborted) return;
        setEvidenceItems(res.evidenceItems);
        setCompoundProjects(res.compoundProjects);
        setDuplicateClusters(res.duplicateClusters);
        setIsScanningForensics(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
          return;
        }
        console.error('Forensic scan failed:', err);
        setIsScanningForensics(false);
      });

    return () => controller.abort();
  }, [extractedProjects, selectedYear, evidenceAllYears]);

  useEffect(() => {
    // Load precomputed cross-year lineages (supports both { lineages } wrapper and raw array)
    fetch(`/datasets/recurring_lineages.json?t=${Date.now()}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: any) => setRecurringLineages(Array.isArray(data) ? data : (data?.lineages || [])))
      .catch((err) => console.error('Failed to load recurring lineages:', err));
  }, [lastSyncedAt]);

  useEffect(() => {
    const cacheBust = lastSyncedAt ? `?t=${encodeURIComponent(lastSyncedAt)}` : '';
    fetch(`/datasets/${selectedYear}/statistics.json${cacheBust}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        setDatasetStats({
          totalProjects: data.totalCapitalProjects || data.totalProjects || 0,
          totalAmount: data.officialTotalBudget || data.totalCapitalAmount || data.totalAmount || 0
        });
      })
      .catch((err) => console.error(`Failed to load ${selectedYear} stats:`, err));

    fetch(`/datasets/${selectedYear}/projects.min.json${cacheBust}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        setExtractedProjects(Array.isArray(data) ? data : []);
        setExtractedProjectsYear(selectedYear);
      })
      .catch((err) => {
        console.error(`Failed to load ${selectedYear} projects:`, err);
        setExtractedProjectsYear(selectedYear);
      });

    const priorYear = selectedYear - 1;
    fetch(`/datasets/${priorYear}/statistics.json${cacheBust}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => setPriorAmount(data.officialTotalBudget || data.totalCapitalAmount || data.totalAmount))
      .catch(() => setPriorAmount(undefined));
  }, [selectedYear, lastSyncedAt]);

  // Global Ctrl+K / Cmd+K (search) and Ctrl+B / Cmd+B (sidebar) shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
          return;
        }
        e.preventDefault();
        if (window.innerWidth <= 1024) {
          setMobileMenuOpen((prev) => !prev);
        } else {
          setSidebarCollapsed((prev) => !prev);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Resolve deep-linked ?item= & ?page= once projects for selectedYear are loaded
  useEffect(() => {
    if (!pendingDeepLink || extractedProjectsYear !== selectedYear) return;
    if (extractedProjects.length === 0) {
      setPendingDeepLink(null);
      return;
    }

    const { item, page } = pendingDeepLink;
    const itemLower = item.toLowerCase();
    const matched =
      (page !== null
        ? extractedProjects.find(
          (p) => String(p.projectCode || '').trim().toLowerCase() === itemLower && Number(p.page) === page
        )
        : undefined) ||
      extractedProjects.find((p) => String(p.id || '').trim().toLowerCase() === itemLower) ||
      extractedProjects.find((p) => String(p.projectCode || '').trim().toLowerCase() === itemLower);

    if (matched) {
      setSelectedModalProject(matched);
    }
    setPendingDeepLink(null);
  }, [pendingDeepLink, extractedProjects, extractedProjectsYear, selectedYear]);

  // Bidirectional URL Permalink Synchronization
  useEffect(() => {
    if (isPopStateRef.current) {
      isPopStateRef.current = false;
      lastNavRef.current = { tab: activeTab, year: selectedYear };
      return;
    }

    const isMajorNav =
      hasMountedUrlSyncRef.current &&
      (activeTab !== lastNavRef.current.tab || selectedYear !== lastNavRef.current.year);
    const mode = isMajorNav ? 'push' : 'replace';

    hasMountedUrlSyncRef.current = true;
    lastNavRef.current = { tab: activeTab, year: selectedYear };

    const updates: Record<string, string | number | null> = {
      tab: activeTab,
      year: selectedYear,
      q: activeTab === 'projects' && projectSearchQuery.trim() ? projectSearchQuery.trim() : null,
      ...(activeTab === 'record'
        ? {}
        : {
          item: selectedModalProject
            ? String(selectedModalProject.projectCode || selectedModalProject.id || '')
            : pendingDeepLink
              ? pendingDeepLink.item
              : null,
          page: selectedModalProject
            ? selectedModalProject.page || null
            : pendingDeepLink
              ? pendingDeepLink.page
              : null,
        }),
    };

    if (activeTab !== 'scrutiny') {
      updates.president = null;
      updates.pillar = null;
      updates.sy = null;
      updates.currency = null;
      updates.sq = null;
    }

    if (activeTab !== 'forensics') {
      updates.fsub = null;
    }

    if (activeTab !== 'padding') {
      updates.diffFilter = null;
    }

    syncUrlParams(updates, mode);
  }, [activeTab, selectedYear, selectedModalProject, pendingDeepLink, projectSearchQuery]);

  // Handle Browser Back / Forward navigation (popstate)
  useEffect(() => {
    const onPopState = () => {
      const next = readAppUrlState();
      isPopStateRef.current = true;
      setActiveTab(next.tab);
      if (next.year && next.year !== selectedYear) {
        setSelectedYear(next.year);
      }
      setProjectSearchQuery(next.q);
      if (next.item) {
        setPendingDeepLink({ item: next.item, page: next.page });
      } else {
        setPendingDeepLink(null);
        setSelectedModalProject(null);
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [selectedYear, setSelectedYear]);

  // Reset scroll position when switching observatory modules
  useEffect(() => {
    if (mainContentRef.current) {
      mainContentRef.current.scrollTo({ top: 0 });
    }
  }, [activeTab]);

  const handleMenuToggle = () => {
    if (window.innerWidth <= 1024) {
      setMobileMenuOpen(!mobileMenuOpen);
    } else {
      setSidebarCollapsed(!sidebarCollapsed);
    }
  };

  const handleCopyPermalink = () => {
    const url = buildCanonicalPermalink({
      tab: activeTab,
      year: selectedYear,
      ...(selectedModalProject
        ? {
          item: selectedModalProject.projectCode || selectedModalProject.id,
          page: selectedModalProject.page || null,
        }
        : {}),
    });
    navigator.clipboard?.writeText(url || window.location.href);
  };

  return (
    <div className={`app-container ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Search Overlay Modal (Lazy Loaded on Demand) */}
      {searchOpen && (
        <Suspense fallback={null}>
          <UniversalSearchModal
            isOpen={searchOpen}
            onClose={() => setSearchOpen(false)}
            projects={extractedProjects}
            financialYear={selectedYear}
            onSelectProject={(proj) => {
              setSelectedModalProject(proj);
              setSearchOpen(false);
            }}
          />
        </Suspense>
      )}

      {/* Project Evidence Citation Modal (Lazy Loaded on Demand) */}
      {selectedModalProject && (
        <Suspense fallback={null}>
          <ProjectEvidenceModal
            project={selectedModalProject}
            financialYear={selectedYear}
            onClose={() => setSelectedModalProject(null)}
          />
        </Suspense>
      )}

      {/* Academic, Media & Legal View Citation Modal (Lazy Loaded on Demand) */}
      {citeModalOpen && (
        <Suspense fallback={null}>
          <ViewCitationModal
            isOpen={citeModalOpen}
            onClose={() => setCiteModalOpen(false)}
            activeTab={activeTab}
            selectedYear={selectedYear}
            registryDocs={registryDocs}
            totalRecordsInYear={datasetStats.totalProjects}
            searchQuery={projectSearchQuery}
          />
        </Suspense>
      )}

      {/* Slide-Over Investigator Casebook Drawer */}
      <Suspense fallback={null}>
        <InvestigatorCasebookDrawer onOpenStudio={() => setActiveTab('casebook')} />
      </Suspense>

      <div
        className={`sidebar-overlay ${mobileMenuOpen ? 'open' : ''}`}
        onClick={() => setMobileMenuOpen(false)}
      />

      {/* Responsive Navigation Sidebar Drawer */}
      <Sidebar
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        selectedYear={selectedYear}
        onSelectYear={(yr) => setSelectedYear(yr)}
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setActiveTab(tab);
        }}
        onOpenGuide={() => setGuideOpen(true)}
        onOpenCite={() => setCiteModalOpen(true)}
        onCopyPermalink={handleCopyPermalink}
        onOpenCasebook={() => setDrawerOpen(true)}
        casebookPinsCount={casebookPinsCount}
      />

      {/* Main Content Area */}
      <div className="main-content" ref={mainContentRef}>
        {/* Top Header */}
        <Topbar
          onMenuToggle={handleMenuToggle}
          isSidebarCollapsed={sidebarCollapsed}
          selectedYear={selectedYear}
          activeTab={activeTab}
          onOpenSearch={() => setSearchOpen(true)}
          onNavigateCompare={() => setActiveTab('compare')}
          onSelectYear={(yr) => setSelectedYear(yr)}
          onSelectTenure={(term) => {
            const latestInTerm = Math.max(...term.budgetYears);
            setSelectedYear(latestInTerm);
            syncUrlParams({ tab: 'scrutiny', year: latestInTerm, president: term.presidentId }, 'push');
            setActiveTab('scrutiny');
          }}
          onCopyPermalink={handleCopyPermalink}
          onOpenCite={() => setCiteModalOpen(true)}
          onOpenGuide={() => setGuideOpen(true)}
        />

        {/* Dashboard Body */}
        <main className="dashboard-main">
          <Suspense
            fallback={
              <div className="dossier-card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                <span className="font-mono" style={{ fontSize: '0.8rem' }}>Loading forensic module...</span>
              </div>
            }
          >
            {/* ============================================================== */}
            {/* TAB ROUTER                                                     */}
            {/* ============================================================== */}

            {/* 1. RECURRING LINEAGES EXPLORER */}
            {activeTab === 'citizen' ? (
              <CitizenAccountabilityHub
                compoundProjects={compoundProjects}
                evidenceAllYears={evidenceAllYears}
                onSelectProject={(p) => setSelectedModalProject(p)}
              />
            ) :

              activeTab === 'oaugf' ? (
                <OaugfNegligenceExplorer />
              ) :

                activeTab === 'recurring' ? (
                  <RecurringLineagesExplorer lineages={recurringLineages} />
                ) :

                  /* 1B. STATISTICAL FORENSICS LAB */
                  activeTab === 'forensics' ? (
                    <StatisticalForensicsLab
                      financialYear={selectedYear}
                      onSelectYear={(yr) => setSelectedYear(yr)}
                      onSelectProject={(p) => setSelectedModalProject(p)}
                      onNavigateTab={(tab) => setActiveTab(tab)}
                    />
                  ) :

                    /* 1C. BILL VS. ACT BUDGET PADDING DIFF ENGINE */
                    activeTab === 'padding' ? (
                      <BudgetPaddingDiffExplorer
                        selectedYear={selectedYear}
                        onSelectYear={(yr) => setSelectedYear(yr)}
                        onSelectProject={(p) => setSelectedModalProject(p)}
                      />
                    ) :

                      /* 1D. FULL-TAB OFFICIAL RECORD DOSSIER (?tab=record) */
                      activeTab === 'record' ? (
                        <BudgetRecordDossierPage
                          onBackToObservatory={(yr) => {
                            setSelectedYear(yr);
                            setActiveTab('overview');
                          }}
                          onBrowseProjects={(yr) => {
                            setSelectedYear(yr);
                            setActiveTab('projects');
                          }}
                        />
                      ) :

                        /* 2. UNIFIED OBSERVATORY TABS */
                        activeTab === 'projects' ? (
                          <CapitalProjectsDirectory
                            financialYear={selectedYear}
                            projects={extractedProjects}
                            compoundProjects={compoundProjects}
                            isScanningForensics={isScanningForensics}
                            searchQuery={projectSearchQuery}
                            onSearchQueryChange={setProjectSearchQuery}
                            onSelectProject={(p) => setSelectedModalProject(p)}
                          />
                        ) :

                          activeTab === 'agencies' || activeTab === 'network' ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                              <div>
                                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <Building2 color="#10b981" /> Official Ministries & Verbatim MDAs ({selectedYear})
                                </h2>
                                <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                  Verbatim breakdown of top executing federal ministries and agencies
                                </p>
                              </div>

                              <div className="grid-2-cols">
                                <SectorDistribution
                                  financialYear={selectedYear}
                                  compoundProjects={compoundProjects}
                                  onSelectProject={(proj) => setSelectedModalProject(proj)}
                                />
                                <TopMinistriesWidget financialYear={selectedYear} />
                              </div>

                              <Suspense
                                fallback={
                                  <div className="dossier-card" style={{ padding: '1.25rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                                    Loading Composite MDA Integrity Scorecards...
                                  </div>
                                }
                              >
                                <MdaIntegrityScorecardPanel />
                              </Suspense>
                            </div>
                          ) :

                            activeTab === 'evidence' || activeTab === 'rules' ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                                  <div>
                                    <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                      <ShieldCheck color="#10b981" /> Forensic Evidence Engine &amp; Rule Matrix ({selectedYear})
                                    </h2>
                                    <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                      Live criteria-based verification engine flagging luxury vehicle fleets, palace renovations, and non-essential line items
                                    </p>
                                  </div>
                                  {isScanningForensics && (
                                    <span
                                      className="editorial-pill font-mono"
                                      style={{ backgroundColor: 'var(--emerald-bg)', color: '#047857', borderColor: '#a7f3d0' }}
                                    >
                                      Scanning {extractedProjects.length.toLocaleString()} line items...
                                    </span>
                                  )}
                                </div>

                                <div className="grid-2-cols">
                                  <EvidenceEngineSummary
                                    availableYearsCount={registryDocs.length}
                                    evidenceItems={evidenceItems}
                                    compoundProjectsCount={compoundProjects.length}
                                    duplicateClusters={duplicateClusters}
                                    selectedRuleId={selectedRuleId}
                                    onSelectRule={setSelectedRuleId}
                                  />
                                  <TopDuplicateClustersWidget
                                    duplicateClusters={duplicateClusters}
                                    onViewAll={() => setActiveTab('duplicates')}
                                  />
                                </div>

                                <div style={{ marginTop: '0.5rem' }}>
                                  <RecentFlaggedProjects
                                    projects={extractedProjects}
                                    financialYear={selectedYear}
                                    evidenceItems={evidenceItems}
                                    compoundProjects={compoundProjects}
                                    allYearsData={evidenceAllYears}
                                    selectedRuleId={selectedRuleId}
                                    onClearRuleFilter={() => setSelectedRuleId(null)}
                                    onSelectProject={(p: any) => setSelectedModalProject(p)}
                                    onSelectYear={(yr) => setSelectedYear(yr)}
                                  />
                                </div>
                              </div>
                            ) :

                              activeTab === 'map' || activeTab === 'anomalies' ? (
                                <GeoIntelligenceWorkspace
                                  financialYear={selectedYear}
                                  onSelectProject={(proj) => setSelectedModalProject(proj)}
                                />
                              ) :

                                activeTab === 'compare' ? (
                                  <HistoricalPresidentialCompare
                                    onSelectYear={(yr) => {
                                      setSelectedYear(yr);
                                      setActiveTab('overview');
                                    }}
                                    onSelectProject={(proj) => setSelectedModalProject(proj)}
                                    onNavigateTab={(tab) => setActiveTab(tab)}
                                  />
                                ) :

                                  activeTab === 'cbn' ? (
                                    <CbnGovernorsAndDebtHub
                                      onSelectYear={(yr) => {
                                        setSelectedYear(yr);
                                        setActiveTab('overview');
                                      }}
                                      onNavigateTab={(tab) => setActiveTab(tab)}
                                    />
                                  ) :

                                  activeTab === 'duplicates' ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                      {isScanningForensics && (
                                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                          <span
                                            className="editorial-pill font-mono"
                                            style={{ backgroundColor: 'var(--emerald-bg)', color: '#047857', borderColor: '#a7f3d0' }}
                                          >
                                            Scanning {extractedProjects.length.toLocaleString()} line items...
                                          </span>
                                        </div>
                                      )}
                                      <DuplicateClustersExplorer
                                        clusters={duplicateClusters}
                                        financialYear={selectedYear}
                                        totalScannedProjects={extractedProjects.length}
                                        crossLedgerContext={evidenceAllYears?.crossLedgerContext || null}
                                        onSelectProject={(p: any) => setSelectedModalProject(p)}
                                      />
                                    </div>
                                  ) :

                                    activeTab === 'reports' ? (
                                      <ExecutiveReportBuilderWidget
                                        financialYear={selectedYear}
                                        extractedProjects={extractedProjects}
                                        registryLength={registryDocs.length}
                                        evidenceAllYears={evidenceAllYears}
                                      />
                                    ) :

                                      activeTab === 'casebook' ? (
                                        <CasebookStudioPage />
                                      ) :

                                        activeTab === 'execution' ? (
                                          <ExecutionProcurementExplorer
                                            selectedYear={selectedYear}
                                            onSelectYear={(yr) => setSelectedYear(yr)}
                                          />
                                        ) :

                                          activeTab === 'document' ? (
                                            <PdfDocumentViewerPage
                                              selectedYear={selectedYear}
                                              onBack={() => setActiveTab('recurring')}
                                            />
                                          ) :

                                            activeTab === 'search' ? (
                                              <UniversalSearchModal
                                                isOpen={true}
                                                onClose={() => setActiveTab('overview')}
                                                projects={extractedProjects}
                                                financialYear={selectedYear}
                                                onSelectProject={(proj) => setSelectedModalProject(proj)}
                                              />
                                            ) :

                                              activeTab === 'ai' ? (
                                                <GroundedAiAssistantWidget projects={extractedProjects} onSelectProject={(proj) => setSelectedModalProject(proj)} />
                                              ) :

                                                activeTab === 'assets' ? (
                                                  <AggregatedAssetsExplorer onSelectProject={(proj) => setSelectedModalProject(proj)} />
                                                ) :

                                                  activeTab === 'scrutiny' ? (
                                                    <PublicScrutinyDossier onSelectProject={(p: any) => setSelectedModalProject(p)} />
                                                  ) :

                                                    activeTab === 'methodology' ? (
                                                      <SourcesMethodologyPage
                                                        onSelectFiscalYear={(fy) => {
                                                          setSelectedYear(fy);
                                                          setActiveTab('overview');
                                                        }}
                                                      />
                                                    ) :

                                                      activeTab === 'trends' ? (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                                          <div>
                                                            <h2 className="font-editorial" style={{ fontSize: '1.4rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                                                              28-Year Multi-Ledger Expenditure &amp; Accountability Trajectory (1999–2026)
                                                            </h2>
                                                            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                                              Unites enacted appropriation envelopes, DMO sovereign debt stock, BIR execution reality, Evidence Engine v3.0 flagged spend, and OAuGF audit queries across 28 fiscal years
                                                            </p>
                                                          </div>

                                                          <MultiLedgerTrendExplorer
                                                            onSelectYear={(yr) => {
                                                              setSelectedYear(yr);
                                                              setActiveTab('overview');
                                                            }}
                                                          />

                                                          <SpendingTrendChart />
                                                        </div>
                                                      ) :

                                                        /* ============================================================== */
                                                        /* DEFAULT: UNIFIED OPEN OBSERVATORY OVERVIEW                     */
                                                        /* ============================================================== */
                                                        (
                                                          <>
                                                            <HeaderStats
                                                              financialYear={selectedYear}
                                                              totalProjects={datasetStats.totalProjects}
                                                              totalAmount={datasetStats.totalAmount}
                                                              priorAmount={priorAmount}
                                                              evidenceItemsCount={evidenceItems.length}
                                                              compoundProjectsCount={compoundProjects.length}
                                                              crossLedgerFindingsCount={evidenceItems.filter((i) => i.ledgerScope === 'CROSS_LEDGER').length}
                                                              onNavigateTab={(tab) => setActiveTab(tab)}
                                                            />

                                                            <Suspense fallback={<div className="dossier-card skeleton-shimmer" style={{ height: '210px', marginBottom: '1.25rem' }} />}>
                                                              <OverviewCrossLedgerWidget
                                                                financialYear={selectedYear}
                                                                evidenceItemsCount={evidenceItems.length}
                                                                compoundProjects={compoundProjects}
                                                                evidenceAllYears={evidenceAllYears}
                                                                onNavigateTab={(tab) => setActiveTab(tab)}
                                                                onSelectProject={(proj) => setSelectedModalProject(proj)}
                                                              />
                                                            </Suspense>

                                                            <div style={{ marginBottom: '1.25rem' }}>
                                                              <MacroNarrativeBrief financialYear={selectedYear} />
                                                            </div>

                                                            <Suspense fallback={<div className="dossier-card skeleton-shimmer" style={{ height: '140px' }} />}>
                                                              <BudgetAuditCalculatorWidget financialYear={selectedYear} />
                                                            </Suspense>

                                                            <div style={{ marginBottom: '1.25rem' }}>
                                                              <Suspense fallback={<div className="dossier-card skeleton-shimmer" style={{ height: '240px' }} />}>
                                                                <InvestigatorHeatmapWidget onSelectProject={(proj) => setSelectedModalProject(proj)} />
                                                              </Suspense>
                                                            </div>

                                                            <div className="grid-3-cols">
                                                              <Suspense fallback={<div className="dossier-card skeleton-shimmer" style={{ height: '260px' }} />}>
                                                                <SectorDistribution
                                                                  financialYear={selectedYear}
                                                                  compoundProjects={compoundProjects}
                                                                  onSelectProject={(proj) => setSelectedModalProject(proj)}
                                                                />
                                                              </Suspense>
                                                              <Suspense fallback={<div className="dossier-card skeleton-shimmer" style={{ height: '260px' }} />}>
                                                                <GeoMapWidget financialYear={selectedYear} onSelectProject={(proj) => setSelectedModalProject(proj)} />
                                                              </Suspense>
                                                              <Suspense fallback={<div className="dossier-card skeleton-shimmer" style={{ height: '260px' }} />}>
                                                                <SpendingTrendChart />
                                                              </Suspense>
                                                            </div>

                                                            <div style={{ marginTop: '1.25rem' }}>
                                                              <TransparencyCard onOpenMethodology={() => setActiveTab('methodology')} />
                                                            </div>
                                                          </>
                                                        )}
          </Suspense>
        </main>
      </div>

      <MobileInstallPrompt />
      <MobileBottomNav
        activeTab={activeTab}
        onSelectTab={(tab) => setActiveTab(tab)}
        onOpenMore={() => setMobileMenuOpen(true)}
        onReselectActiveTab={() => mainContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
      />
      <PlainEnglishGuideModal isOpen={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
