import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { budgetDatabase, BudgetRecord, HierarchySummary, RegistryDocument } from '../services/budgetDatabaseEngine';
import type {
  BenfordAnalysisResult,
  BenfordYearTrendPoint,
  DuplicateRingCluster,
  PrecomputedStatisticalForensics,
  PrematureReplacementAlert,
  VirementAnalyticsResult,
} from '../utils/statisticalForensics';

interface BudgetDatabaseContextType {
  activeYear: number;
  setActiveYear: (year: number) => Promise<void>;
  availableYears: number[];
  registryDocs: RegistryDocument[];
  lastSyncedAt: string | null;
  refreshNow: () => Promise<void>;
  loadYearRecords: (year: number) => Promise<BudgetRecord[]>;
  isLoading: boolean;
  summary: HierarchySummary | null;
  statisticalForensics: PrecomputedStatisticalForensics | null;
  records: BudgetRecord[];
  getRecordsForYear: (year: number) => BudgetRecord[];
  search: (query: string, limit?: number, filters?: any) => BudgetRecord[];
  getTopMinistries: (limit?: number) => any[];
  getSectorDistribution: () => any;
  getRegionalEquity: () => any;
  getMultiYearLineages: (minYears?: number) => any[];
  getForensicFlaggedRecords: (minSeverity?: 'high' | 'medium' | 'low') => BudgetRecord[];
  getStateDistribution: () => any;
  getMultiYearTrends: () => any[];
  getBenfordAnalysis: (year?: number) => BenfordAnalysisResult;
  getBenfordMultiYearTrend: () => BenfordYearTrendPoint[];
  getRealTermsSpending: () => any;
  getDuplicateRingClusters: (year?: number, includeRoutineOverhead?: boolean) => DuplicateRingCluster[];
  getVirementAnalytics: (year?: number) => VirementAnalyticsResult;
  getAggregatedAssetsInventory: () => any;
  getPrematureReplacementAlerts: () => PrematureReplacementAlert[];
}

const BudgetDatabaseContext = createContext<BudgetDatabaseContextType | undefined>(undefined);

export const BudgetDatabaseProvider: React.FC<{ children: React.ReactNode; initialYear?: number }> = ({
  children,
  initialYear
}) => {
  const [activeYear, setActiveYearState] = useState<number>(initialYear || 2026);
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [registryDocs, setRegistryDocs] = useState<RegistryDocument[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [records, setRecords] = useState<BudgetRecord[]>([]);
  const [summary, setSummary] = useState<HierarchySummary | null>(null);
  const [statisticalForensics, setStatisticalForensics] = useState<PrecomputedStatisticalForensics | null>(null);

  const syncContextFromEngine = useCallback(() => {
    const currentYr = budgetDatabase.getActiveYear();
    setActiveYearState(currentYr);
    setAvailableYears([...budgetDatabase.getAvailableYears()]);
    setRegistryDocs([...budgetDatabase.getRegistryDocuments()]);
    setRecords([...budgetDatabase.getRecords(currentYr)]);
    setSummary(budgetDatabase.getSummary());
    setStatisticalForensics(budgetDatabase.getStatisticalForensicsDataset());
    setLastSyncedAt(new Date().toISOString());
  }, []);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    budgetDatabase.initialize(initialYear).then(() => {
      if (isMounted) {
        syncContextFromEngine();
        setIsLoading(false);
      }
    });

    return () => { isMounted = false; };
  }, [initialYear, syncContextFromEngine]);

  // Live auto-refresh poll (15s) to pick up ongoing ingestion updates automatically
  const refreshNow = useCallback(async () => {
    try {
      const { updated } = await budgetDatabase.refreshLiveRegistry();
      if (updated) {
        syncContextFromEngine();
      }
    } catch {
      // Ignore transient network errors while file is atomically swapping
    }
  }, [syncContextFromEngine]);

  useEffect(() => {
    const timer = setInterval(() => {
      refreshNow();
    }, 15000);
    return () => clearInterval(timer);
  }, [refreshNow]);

  const handleSetActiveYear = async (year: number) => {
    setIsLoading(true);
    await budgetDatabase.setActiveYear(year);
    setActiveYearState(year);
    setRecords(budgetDatabase.getRecords(year));
    setSummary(budgetDatabase.getSummary());
    setIsLoading(false);
  };

  const value: BudgetDatabaseContextType = {
    activeYear,
    setActiveYear: handleSetActiveYear,
    availableYears,
    registryDocs,
    lastSyncedAt,
    refreshNow,
    loadYearRecords: (year: number) => budgetDatabase.loadYearRecords(year),
    isLoading,
    summary,
    statisticalForensics,
    records,
    getRecordsForYear: (year: number) => budgetDatabase.getRecords(year),
    search: (query: string, limit?: number, filters?: any) => budgetDatabase.search(query, activeYear, limit, filters),
    getTopMinistries: (limit?: number) => budgetDatabase.getTopMinistries(activeYear, limit),
    getSectorDistribution: () => budgetDatabase.getSectorDistribution(activeYear),
    getRegionalEquity: () => budgetDatabase.getRegionalEquity(activeYear),
    getMultiYearLineages: (minYears?: number) => budgetDatabase.getMultiYearLineages(minYears),
    getForensicFlaggedRecords: (minSeverity?: 'high' | 'medium' | 'low') => budgetDatabase.getForensicFlaggedRecords(activeYear, minSeverity),
    getStateDistribution: () => budgetDatabase.getStateDistribution(activeYear),
    getMultiYearTrends: () => budgetDatabase.getMultiYearTrends(),
    getBenfordAnalysis: (year?: number) => budgetDatabase.getBenfordAnalysis(year ?? activeYear),
    getBenfordMultiYearTrend: () => budgetDatabase.getBenfordMultiYearTrend(),
    getRealTermsSpending: () => budgetDatabase.getRealTermsSpending(activeYear),
    getDuplicateRingClusters: (year?: number, includeRoutineOverhead?: boolean) =>
      budgetDatabase.getDuplicateRingClusters(year ?? activeYear, includeRoutineOverhead),
    getVirementAnalytics: (year?: number) => budgetDatabase.getVirementAnalytics(year ?? activeYear),
    getAggregatedAssetsInventory: () => budgetDatabase.getAggregatedAssetsInventory(),
    getPrematureReplacementAlerts: () => budgetDatabase.getPrematureReplacementAlerts()
  };

  return (
    <BudgetDatabaseContext.Provider value={value}>
      {children}
    </BudgetDatabaseContext.Provider>
  );
};

export const useBudgetDatabase = () => {
  const context = useContext(BudgetDatabaseContext);
  if (!context) {
    throw new Error('useBudgetDatabase must be used within a BudgetDatabaseProvider');
  }
  return context;
};
