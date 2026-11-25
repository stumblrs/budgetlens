import { getMacroForYear, HISTORICAL_MACRO_DATA } from '../data/historicalMacroData';
import {
  ASSET_CATEGORY_META,
  BenfordAnalysisResult,
  BenfordYearTrendPoint,
  classifyVirementCategory,
  computeBenfordFromAmounts,
  DURABLE_ACTION_RE,
  DURABLE_CATEGORY_RULES,
  DuplicateRingCluster,
  isBoilerplateOverheadTitle,
  isValidMdaName,
  normalizeMdaClusterName,
  PrecomputedStatisticalForensics,
  PrematureReplacementAlert,
  ROUTINE_CONSUMABLE_RE,
  VIREMENT_CATEGORY_DEFS,
  VirementAnalyticsResult,
  VirementCategoryKey,
  VirementRecordSummary,
} from '../utils/statisticalForensics';

export interface RecordIdentity {
  id: string;
  financialYear: number;
  projectCode: string;
  verbatimProjectName: string;
  amountNaira: number;
  amountFormatted: string;
  spendingType: string;
}

export interface SourceProvenance {
  documentId: string;
  sourceFilename: string;
  pdfPage: number;
  sha256Hash: string;
}

export interface GeographicTaxonomy {
  jurisdictionLevel: string;
  geoPoliticalZone: string;
  state: string;
  lga: string;
}

export interface MdaGovernanceTaxonomy {
  mdaCode: string;
  mdaName: string;
  sector: string;
}

export interface MultiYearLineage {
  lineageId: string | null;
  yearsAppeared: number[];
  cumulativeSpendNaira: number;
  cumulativeSpendFormatted: string;
}

export interface ForensicEvidenceFlag {
  ruleId: string;
  ruleName: string;
  severity: 'high' | 'medium' | 'low';
  confidence: number;
  reason: string;
}

export interface HumanScaleEquivalents {
  teacherSalaries: string;
  solarBoreholes: string;
  primaryHealthCentres: string;
}

export interface ExtractedAssetToken {
  category: 'vehicles_mobility' | 'office_tech' | 'road_infrastructure' | 'power_utilities' | 'water_boreholes' | 'healthcare' | 'education' | 'general';
  itemRawName: string;
  quantity: number | null;
  quantityUnit: string;
  isEstimated: boolean;
  totalAllocationNaira: number;
}

export interface BudgetRecord {
  recordIdentity: RecordIdentity;
  sourceProvenance: SourceProvenance;
  geographicTaxonomy: GeographicTaxonomy;
  mdaGovernanceTaxonomy: MdaGovernanceTaxonomy;
  multiYearLineage: MultiYearLineage;
  forensicEvidenceFlags: ForensicEvidenceFlag[];
  humanScaleEquivalents: HumanScaleEquivalents;
  assetTokens?: ExtractedAssetToken[];
  gemmaAnalyticalOverlay?: Record<string, unknown> | null;
}

export interface HierarchySummary {
  totalRecordsAllYears: number;
  totalAmountAllYears: number;
  yearsIngested: number[];
  totalLineages: number;
  yearSummaries: Record<string, {
    recordCount: number;
    totalAmountNaira: number;
    totalAmountFormatted: string;
    topZones: Record<string, number>;
  }>;
}

export interface RegistryDocument {
  financial_year: number;
  financialYear: number;
  project_count: number;
  extractedProjectsCount: number;
  total_budget: number;
  totalBudget: number;
  page_count: number;
  gemma_enriched_count?: number;
  enrichment_status?: string;
  source_files?: string[];
  sha256?: string;
  source_sha256_count?: number;
  coverage_tier?: 'FULL_SCHEDULE' | 'PARTIAL_SCHEDULE' | 'SUMMARY_ACT_ONLY';
  official_macro_total?: number;
  extracted_ratio_pct?: number;
  scanned_pages_count?: number;
  ingested_at?: string;
  status: string;
}

class BudgetDatabaseEngine {
  private activeYear: number = 2026;
  private recordsByYear: Map<number, BudgetRecord[]> = new Map();
  private summaryData: HierarchySummary | null = null;
  private registryDocs: RegistryDocument[] = [];
  private forensicsData: PrecomputedStatisticalForensics | null = null;
  private availableYears: number[] = [];
  private lastRegistryGeneratedAt: string = '';
  private lastGrandTotalProjects: number = -1;
  private loadingYears: Set<number> = new Set();

  public async initialize(preferredYear?: number): Promise<void> {
    await Promise.all([
      this.fetchRegistry(),
      this.loadSummary(),
      this.loadStatisticalForensics(),
    ]);

    const years = this.discoverAvailableYears();
    this.availableYears = years;

    if (preferredYear && years.includes(preferredYear)) {
      this.activeYear = preferredYear;
    } else if (years.length > 0) {
      // Pick the latest year that has actual extracted projects, or latest available
      const nonEmpty = this.registryDocs.filter((d) => (d.project_count || d.extractedProjectsCount || 0) > 0);
      if (nonEmpty.length > 0) {
        this.activeYear = Math.max(...nonEmpty.map((d) => d.financial_year || d.financialYear));
      } else {
        this.activeYear = years[0];
      }
    } else if (preferredYear) {
      this.activeYear = preferredYear;
    }

    const toPreload = [this.activeYear];
    if (years.includes(this.activeYear - 1)) {
      toPreload.push(this.activeYear - 1);
    }
    await Promise.all(toPreload.map((y) => this.loadYearRecords(y)));
  }

  private discoverAvailableYears(): number[] {
    const set = new Set<number>();
    this.registryDocs.forEach((d) => {
      const yr = d.financial_year || d.financialYear;
      if (yr) set.add(yr);
    });
    if (this.summaryData?.yearSummaries) {
      Object.keys(this.summaryData.yearSummaries).forEach((k) => {
        const yr = parseInt(k, 10);
        if (!isNaN(yr)) set.add(yr);
      });
    }
    return Array.from(set).sort((a, b) => b - a);
  }

  private async fetchRegistry(): Promise<{
    changed: boolean;
    changedYears: number[];
    generatedAt: string;
  }> {
    try {
      const res = await fetch(`/datasets/registry.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return { changed: false, changedYears: [], generatedAt: this.lastRegistryGeneratedAt };
      const raw = await res.json();
      const docs: RegistryDocument[] = Array.isArray(raw)
        ? raw.map((d: any) => ({
            financial_year: d.financialYear ?? d.financial_year,
            financialYear: d.financialYear ?? d.financial_year,
            project_count: d.extractedProjectsCount ?? d.project_count ?? 0,
            extractedProjectsCount: d.extractedProjectsCount ?? d.project_count ?? 0,
            total_budget: d.totalBudget ?? d.total_budget ?? 0,
            totalBudget: d.totalBudget ?? d.total_budget ?? 0,
            page_count: d.pageCount ?? d.page_count ?? 0,
            gemma_enriched_count: d.gemma_enriched_count ?? 0,
            enrichment_status: d.enrichment_status ?? 'STAGE1_RULE_VERIFIED',
            source_files: d.source_files ?? [],
            ingested_at: d.ingested_at ?? '',
            status: d.status ?? 'archived',
          }))
        : (raw.documents || []);

      const generatedAt = (!Array.isArray(raw) && raw.generated_at) ? raw.generated_at : '';
      const grandTotal = (!Array.isArray(raw) && typeof raw.grand_total_projects === 'number')
        ? raw.grand_total_projects
        : docs.reduce((s, d) => s + (d.project_count || 0), 0);

      const prevByYear = new Map<number, RegistryDocument>(
        this.registryDocs.map((d) => [d.financial_year || d.financialYear, d])
      );
      const changedYears: number[] = [];
      docs.forEach((d) => {
        const yr = d.financial_year || d.financialYear;
        const prev = prevByYear.get(yr);
        if (
          !prev ||
          prev.project_count !== d.project_count ||
          prev.total_budget !== d.total_budget ||
          prev.ingested_at !== d.ingested_at ||
          prev.gemma_enriched_count !== d.gemma_enriched_count
        ) {
          changedYears.push(yr);
        }
      });

      const changed =
        changedYears.length > 0 ||
        (generatedAt !== '' && generatedAt !== this.lastRegistryGeneratedAt) ||
        grandTotal !== this.lastGrandTotalProjects;

      this.registryDocs = docs;
      this.availableYears = this.discoverAvailableYears();
      this.lastRegistryGeneratedAt = generatedAt;
      this.lastGrandTotalProjects = grandTotal;

      return { changed, changedYears, generatedAt };
    } catch (err) {
      console.error('Failed to fetch registry:', err);
      return { changed: false, changedYears: [], generatedAt: this.lastRegistryGeneratedAt };
    }
  }

  public async refreshLiveRegistry(): Promise<{ updated: boolean; changedYears: number[] }> {
    const { changed, changedYears } = await this.fetchRegistry();
    if (!changed) {
      return { updated: false, changedYears: [] };
    }
    await Promise.all([
      this.loadSummary(true),
      this.loadStatisticalForensics(true),
    ]);
    const loadedChanged = changedYears.filter((yr) => this.recordsByYear.has(yr) || yr === this.activeYear);
    await Promise.all(loadedChanged.map((yr) => this.loadYearRecords(yr, true)));
    return { updated: true, changedYears };
  }

  public getAvailableYears(): number[] {
    return this.availableYears.length > 0 ? this.availableYears : Object.keys(HISTORICAL_MACRO_DATA).map(Number).sort((a, b) => b - a);
  }

  public getRegistryDocuments(): RegistryDocument[] {
    return this.registryDocs;
  }

  public async setActiveYear(year: number): Promise<void> {
    this.activeYear = year;
    if (!this.recordsByYear.has(year)) {
      await this.loadYearRecords(year);
    }
  }

  public getActiveYear(): number {
    return this.activeYear;
  }

  public getSummary(): HierarchySummary | null {
    return this.summaryData;
  }

  public getStatisticalForensicsDataset(): PrecomputedStatisticalForensics | null {
    return this.forensicsData;
  }

  public async loadStatisticalForensics(forceRefresh: boolean = false): Promise<PrecomputedStatisticalForensics | null> {
    if (!forceRefresh && this.forensicsData) {
      return this.forensicsData;
    }
    try {
      const url = forceRefresh
        ? `/datasets/statistical_forensics_1999_2026.json?t=${Date.now()}`
        : '/datasets/statistical_forensics_1999_2026.json';
      const res = await fetch(url, forceRefresh ? { cache: 'no-store' } : undefined);
      if (res.ok) {
        this.forensicsData = await res.json();
        return this.forensicsData;
      }
    } catch (err) {
      console.error('Failed to load precomputed statistical forensics:', err);
    }
    return this.forensicsData;
  }

  public getBenfordMultiYearTrend(): BenfordYearTrendPoint[] {
    if (this.forensicsData?.benfordTrend?.length) {
      return this.forensicsData.benfordTrend;
    }
    const years = [...this.getAvailableYears()].sort((a, b) => a - b);
    return years.map((yr) => {
      const res = this.getBenfordAnalysis(yr);
      return {
        financialYear: yr,
        validRecordCount: res.validRecordCount,
        meanAbsoluteDeviation: res.meanAbsoluteDeviation,
        chiSquareStat: res.chiSquareStat,
        chiSquarePValue: res.chiSquarePValue,
        conformityBand: res.conformityBand,
        auditRating: res.auditRating,
        benfordIntegrityScore: res.benfordIntegrityScore,
      };
    });
  }

  public getRecords(year: number = this.activeYear): BudgetRecord[] {
    return this.recordsByYear.get(year) || [];
  }

  private async loadSummary(forceRefresh: boolean = false): Promise<void> {
    try {
      const url = forceRefresh
        ? `/datasets/db/hierarchy_summary.json?t=${Date.now()}`
        : '/datasets/db/hierarchy_summary.json';
      const res = await fetch(url, forceRefresh ? { cache: 'no-store' } : undefined);
      if (res.ok) {
        this.summaryData = await res.json();
        this.availableYears = this.discoverAvailableYears();
      }
    } catch (err) {
      console.error("Failed to load hierarchy summary:", err);
    }
  }

  public async loadYearRecords(year: number, forceRefresh: boolean = false): Promise<BudgetRecord[]> {
    if (!forceRefresh && this.recordsByYear.has(year)) {
      return this.recordsByYear.get(year)!;
    }

    if (this.loadingYears.has(year)) {
      return this.recordsByYear.get(year) || [];
    }

    this.loadingYears.add(year);
    try {
      const url = forceRefresh
        ? `/datasets/db/${year}/records.json?t=${Date.now()}`
        : `/datasets/db/${year}/records.json`;
      const res = await fetch(url, forceRefresh ? { cache: 'no-store' } : undefined);
      if (res.ok) {
        const records: BudgetRecord[] = await res.json();
        this.recordsByYear.set(year, records);
        return records;
      }
    } catch (err) {
      console.error(`Failed to load database records for year ${year}:`, err);
    } finally {
      this.loadingYears.delete(year);
    }

    return this.recordsByYear.get(year) || [];
  }

  // Feature Query 1: Sector & MDA Distribution
  public getSectorDistribution(year: number = this.activeYear) {
    const records = this.recordsByYear.get(year) || [];
    const mdaStats: Record<string, { amount: number; projectCount: number }> = {};
    const sectorStats: Record<string, { amount: number; projectCount: number }> = {};

    let totalAmount = 0;
    records.forEach(r => {
      const amt = Number(r.recordIdentity.amountNaira) || 0;
      totalAmount += amt;

      const mda = r.mdaGovernanceTaxonomy.mdaName;
      const rawSector = r.mdaGovernanceTaxonomy.sector;
      const mdaKey = (mda && mda !== 'General Federal')
        ? mda
        : (rawSector && rawSector !== 'Capital Infrastructure' ? rawSector : 'General Federal Administration');
      if (!mdaStats[mdaKey]) mdaStats[mdaKey] = { amount: 0, projectCount: 0 };
      mdaStats[mdaKey].amount += amt;
      mdaStats[mdaKey].projectCount += 1;

      const sectorKey = (rawSector && rawSector.trim()) ? rawSector.trim() : 'General Administration';
      if (!sectorStats[sectorKey]) sectorStats[sectorKey] = { amount: 0, projectCount: 0 };
      sectorStats[sectorKey].amount += amt;
      sectorStats[sectorKey].projectCount += 1;
    });

    const toEntries = (stats: Record<string, { amount: number; projectCount: number }>) =>
      Object.entries(stats)
        .sort((a, b) => b[1].amount - a[1].amount)
        .map(([name, info], idx) => ({
          rank: idx + 1,
          name,
          amount: info.amount,
          projectCount: info.projectCount,
          sharePct: totalAmount > 0 ? (info.amount / totalAmount) * 100 : 0
        }));

    const allMdas = toEntries(mdaStats);
    const sectors = toEntries(sectorStats);

    return {
      totalAmount,
      totalRecords: records.length,
      totalMdaCount: allMdas.length,
      sectors,
      allMdas,
      topMdas: allMdas.slice(0, 25)
    };
  }

  // Feature Query 2: Top Ministries Rankings
  public getTopMinistries(year: number = this.activeYear, limit: number = 10) {
    const records = this.recordsByYear.get(year) || [];
    const mdaTotals: Record<string, number> = {};

    records.forEach(r => {
      const mda = r.mdaGovernanceTaxonomy.mdaName;
      mdaTotals[mda] = (mdaTotals[mda] || 0) + r.recordIdentity.amountNaira;
    });

    const totalAmount = records.reduce((sum, r) => sum + r.recordIdentity.amountNaira, 0);
    const sorted = Object.entries(mdaTotals).sort((a, b) => b[1] - a[1]).slice(0, limit);
    const maxVal = sorted[0]?.[1] || 1;

    return sorted.map(([name, amount], idx) => ({
      rank: idx + 1,
      name,
      amountRaw: amount,
      amountFormatted: this.formatNaira(amount),
      sharePct: totalAmount > 0 ? (amount / totalAmount) * 100 : 0,
      relativePct: (amount / maxVal) * 100
    }));
  }

  // Feature Query 3: Regional Equity & Geo-Political Zone Metrics
  public getRegionalEquity(year: number = this.activeYear) {
    const records = this.recordsByYear.get(year) || [];
    const zoneTotals: Record<string, { amount: number; count: number; evidence: number }> = {};

    records.forEach(r => {
      const zone = r.geographicTaxonomy.geoPoliticalZone;
      if (!zoneTotals[zone]) {
        zoneTotals[zone] = { amount: 0, count: 0, evidence: 0 };
      }
      zoneTotals[zone].amount += r.recordIdentity.amountNaira;
      zoneTotals[zone].count += 1;
      zoneTotals[zone].evidence += r.forensicEvidenceFlags.length;
    });

    return zoneTotals;
  }

  // Feature Query 4: Universal Search Across Hierarchy with Multi-Field Scored Search & Filters
  public search(
    query: string, 
    year: number = this.activeYear, 
    limit: number = 30,
    filters?: {
      sector?: string;
      minAmount?: number;
      maxAmount?: number;
      state?: string;
      severity?: 'high' | 'medium' | 'low';
    }
  ): BudgetRecord[] {
    const records = this.recordsByYear.get(year) || [];
    let target = records;

    if (filters) {
      if (filters.sector && filters.sector !== 'all') {
        target = target.filter(r => r.mdaGovernanceTaxonomy.sector?.toLowerCase() === filters.sector!.toLowerCase());
      }
      if (filters.state && filters.state !== 'all') {
        target = target.filter(r => r.geographicTaxonomy.state?.toLowerCase() === filters.state!.toLowerCase());
      }
      if (filters.minAmount !== undefined) {
        target = target.filter(r => r.recordIdentity.amountNaira >= filters.minAmount!);
      }
      if (filters.maxAmount !== undefined) {
        target = target.filter(r => r.recordIdentity.amountNaira <= filters.maxAmount!);
      }
      if (filters.severity) {
        target = target.filter(r => r.forensicEvidenceFlags.some(f => f.severity === filters.severity));
      }
    }

    if (!query || query.trim() === '') return target.slice(0, limit);

    const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    
    return target
      .map(r => {
        const title = r.recordIdentity.verbatimProjectName.toLowerCase();
        const code = r.recordIdentity.projectCode.toLowerCase();
        const mda = r.mdaGovernanceTaxonomy.mdaName.toLowerCase();
        const state = r.geographicTaxonomy.state.toLowerCase();
        const lga = r.geographicTaxonomy.lga.toLowerCase();
        const zone = r.geographicTaxonomy.geoPoliticalZone.toLowerCase();
        let score = 0;

        for (const t of tokens) {
          if (code === t) score += 100;
          else if (code.includes(t)) score += 30;

          if (title.includes(t)) score += t.length * 2;
          if (mda.includes(t)) score += t.length;
          if (state.includes(t) || lga.includes(t) || zone.includes(t)) score += t.length * 1.5;
        }

        return { r, score };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || b.r.recordIdentity.amountNaira - a.r.recordIdentity.amountNaira)
      .slice(0, limit)
      .map(x => x.r);
  }

  // Feature Query 5: Multi-Year Lineage & Project Repeat Explorer
  public getMultiYearLineages(minYears: number = 2) {
    const lineageMap = new Map<string, {
      lineageId: string;
      title: string;
      records: BudgetRecord[];
      years: number[];
      totalNaira: number;
    }>();

    this.recordsByYear.forEach((records) => {
      records.forEach(r => {
        const lid = r.multiYearLineage?.lineageId;
        if (!lid) return;

        if (!lineageMap.has(lid)) {
          lineageMap.set(lid, {
            lineageId: lid,
            title: r.recordIdentity.verbatimProjectName,
            records: [],
            years: [],
            totalNaira: 0
          });
        }

        const entry = lineageMap.get(lid)!;
        entry.records.push(r);
        if (!entry.years.includes(r.recordIdentity.financialYear)) {
          entry.years.push(r.recordIdentity.financialYear);
        }
        entry.totalNaira += r.recordIdentity.amountNaira;
      });
    });

    return Array.from(lineageMap.values())
      .filter(e => e.years.length >= minYears)
      .sort((a, b) => b.totalNaira - a.totalNaira);
  }

  // Feature Query 6: Forensic Anomaly & Risk Flag Finder
  public getForensicFlaggedRecords(year: number = this.activeYear, minSeverity: 'high' | 'medium' | 'low' = 'low'): BudgetRecord[] {
    const records = this.recordsByYear.get(year) || [];
    const severityWeight = { high: 3, medium: 2, low: 1 };

    return records
      .filter(r => r.forensicEvidenceFlags.some(f => severityWeight[f.severity] >= severityWeight[minSeverity]))
      .sort((a, b) => b.forensicEvidenceFlags.length - a.forensicEvidenceFlags.length || b.recordIdentity.amountNaira - a.recordIdentity.amountNaira);
  }

  // Feature Query 7: State-by-State Heatmap Data
  public getStateDistribution(year: number = this.activeYear) {
    const records = this.recordsByYear.get(year) || [];
    const stateStats: Record<string, { totalAmount: number; projectCount: number; evidenceFlags: number; topSector: string }> = {};

    records.forEach(r => {
      const state = r.geographicTaxonomy.state || 'Federal / Unspecified';
      if (!stateStats[state]) {
        stateStats[state] = { totalAmount: 0, projectCount: 0, evidenceFlags: 0, topSector: '' };
      }
      stateStats[state].totalAmount += r.recordIdentity.amountNaira;
      stateStats[state].projectCount += 1;
      stateStats[state].evidenceFlags += r.forensicEvidenceFlags.length;
    });

    return stateStats;
  }

  // Feature Query 8: Multi-Year Expenditure Trend Aggregator (Dynamic across all ingested years)
  public getMultiYearTrends() {
    const years = [...this.getAvailableYears()].sort((a, b) => a - b);
    return years.map(yr => {
      const sumEntry = this.summaryData?.yearSummaries?.[String(yr)];
      const records = this.recordsByYear.get(yr);
      const totalAmount = records && records.length > 0
        ? records.reduce((s, r) => s + r.recordIdentity.amountNaira, 0)
        : (sumEntry?.totalAmountNaira || 0);
      const capitalCount = records && records.length > 0
        ? records.length
        : (sumEntry?.recordCount || 0);
      return {
        year: yr,
        totalAmount,
        totalAmountFormatted: this.formatNaira(totalAmount),
        capitalCount
      };
    });
  }

  // Feature Query 9: Benford's Law Mathematical Audit Engine (Nigrini MAD + Chi-Square df=8 + Flagged MDAs)
  public getBenfordAnalysis(year: number = this.activeYear): BenfordAnalysisResult {
    const records = this.recordsByYear.get(year);
    if (records && records.length > 0) {
      const amounts: number[] = [];
      const mdaPairs: Array<{ mdaName: string; amount: number }> = [];
      for (const r of records) {
        const amt = r.recordIdentity.amountNaira;
        amounts.push(amt);
        mdaPairs.push({ mdaName: r.mdaGovernanceTaxonomy.mdaName, amount: amt });
      }
      return computeBenfordFromAmounts(amounts, year, mdaPairs);
    }

    const pre = this.forensicsData?.byYear?.[String(year)]?.benford;
    if (pre) {
      return pre;
    }

    return computeBenfordFromAmounts([], year);
  }

  // Feature Query 10: Inflation & USD Benchmark Real-Terms Converter (1999-2026)
  public getRealTermsSpending(year: number = this.activeYear) {
    const macro = getMacroForYear(year);
    const records = this.recordsByYear.get(year) || [];
    const totalNaira = records.length > 0
      ? records.reduce((s, r) => s + r.recordIdentity.amountNaira, 0)
      : (this.summaryData?.yearSummaries?.[String(year)]?.totalAmountNaira || 0);
    const equivalentUsd = totalNaira / macro.fxNairaPerUsd;
    const real2026Naira = totalNaira * macro.cpiDeflatorTo2026;

    return {
      financialYear: year,
      totalNaira,
      totalNairaFormatted: this.formatNaira(totalNaira),
      real2026Naira,
      real2026NairaFormatted: this.formatNaira(real2026Naira),
      nairaPerUsdRate: macro.fxNairaPerUsd,
      equivalentUsd,
      equivalentUsdFormatted: `$${(equivalentUsd / 1e9).toFixed(2)} Billion USD`,
      cpiInflationRate: macro.cpiInflationRate,
      cpiDeflatorTo2026: macro.cpiDeflatorTo2026
    };
  }

  // Feature Query 11: Coordinated & Cross-MDA Duplicate Ring Clustering Engine
  public getDuplicateRingClusters(
    year: number = this.activeYear,
    includeRoutineOverhead: boolean = false
  ): DuplicateRingCluster[] {
    const records = this.recordsByYear.get(year);
    if (records && records.length > 0) {
      const titleMap = new Map<string, BudgetRecord[]>();
      for (const r of records) {
        const normalizedKey = (r.recordIdentity.verbatimProjectName || '')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '');
        if (normalizedKey.length < 10) continue;
        const arr = titleMap.get(normalizedKey);
        if (arr) arr.push(r);
        else titleMap.set(normalizedKey, [r]);
      }

      const clusters: DuplicateRingCluster[] = [];
      titleMap.forEach((dupes, key) => {
        if (dupes.length <= 1) return;
        const sampleTitle = dupes[0].recordIdentity.verbatimProjectName;
        const hasCapital = dupes.some(
          (d) => (d.recordIdentity.spendingType || '').toUpperCase() === 'CAPITAL'
        );
        const isBoilerplate = !hasCapital || isBoilerplateOverheadTitle(sampleTitle, 'CAPITAL');
        if (!includeRoutineOverhead && isBoilerplate) return;

        const total = dupes.reduce((s, r) => s + r.recordIdentity.amountNaira, 0);
        const mdas = Array.from(
          new Set(
            dupes
              .map((r) => r.mdaGovernanceTaxonomy.mdaName)
              .filter((name) => isValidMdaName(name))
          )
        ).sort();
        const isCrossMda = mdas.length >= 2;
        const topSamples = [...dupes]
          .sort((a, b) => b.recordIdentity.amountNaira - a.recordIdentity.amountNaira)
          .slice(0, 8)
          .map((r) => ({
            id: r.recordIdentity.id,
            projectCode: r.recordIdentity.projectCode,
            projectName: r.recordIdentity.verbatimProjectName,
            agency: r.mdaGovernanceTaxonomy.mdaName,
            amount: r.recordIdentity.amountNaira,
            page: r.sourceProvenance?.pdfPage || 1,
            financialYear: r.recordIdentity.financialYear || year,
            spendingType: r.recordIdentity.spendingType,
            sourceFilename: r.sourceProvenance?.sourceFilename,
          }));

        clusters.push({
          clusterId: `RING-${year}-${key.substring(0, 10).toUpperCase()}`,
          normalizedTitle: sampleTitle,
          itemCount: dupes.length,
          totalNaira: total,
          totalNairaFormatted: this.formatNaira(total),
          mdasInvolved: mdas,
          mdasIninvolved: mdas,
          isCrossMda,
          isBoilerplateOverhead: isBoilerplate,
          sampleRecords: topSamples,
        });
      });

      return clusters.sort((a, b) => {
        if (a.isCrossMda !== b.isCrossMda) return a.isCrossMda ? -1 : 1;
        return b.totalNaira - a.totalNaira || b.itemCount - a.itemCount;
      });
    }

    const pre = this.forensicsData?.byYear?.[String(year)]?.duplicateRings;
    if (!pre) return [];

    const combined = includeRoutineOverhead
      ? [...(pre.topRings || []), ...(pre.boilerplateSampleRings || [])]
      : [...(pre.topRings || [])];

    return combined.map((c) => {
      const mdas = c.mdasInvolved || c.mdasIninvolved || [];
      return {
        ...c,
        mdasInvolved: mdas,
        mdasIninvolved: mdas,
        sampleRecords: (c.sampleRecords || []).map((sr) => ({
          ...sr,
          projectName: sr.projectName || c.normalizedTitle,
        })),
      };
    });
  }

  // Feature Query 12: Off-Budget & Virement Fund Injection Analytics (4 Forensic Buckets)
  public getVirementAnalytics(year: number = this.activeYear): VirementAnalyticsResult {
    const records = this.recordsByYear.get(year);
    if (records && records.length > 0) {
      const buckets = new Map<VirementCategoryKey, { key: VirementCategoryKey; label: string; count: number; totalNaira: number }>();
      for (const def of VIREMENT_CATEGORY_DEFS) {
        buckets.set(def.key, { key: def.key, label: def.label, count: 0, totalNaira: 0 });
      }

      const matched: VirementRecordSummary[] = [];
      let totalNaira = 0;

      for (const r of records) {
        const key = classifyVirementCategory(
          r.recordIdentity.verbatimProjectName,
          r.recordIdentity.spendingType
        );
        if (!key) continue;
        const amt = r.recordIdentity.amountNaira;
        totalNaira += amt;
        const bucket = buckets.get(key)!;
        bucket.count += 1;
        bucket.totalNaira += amt;
        matched.push({
          id: r.recordIdentity.id,
          projectCode: r.recordIdentity.projectCode,
          projectName: r.recordIdentity.verbatimProjectName,
          agency: r.mdaGovernanceTaxonomy.mdaName,
          amount: amt,
          page: r.sourceProvenance?.pdfPage || 1,
          financialYear: r.recordIdentity.financialYear || year,
          spendingType: r.recordIdentity.spendingType,
          categoryKey: key,
          sourceFilename: r.sourceProvenance?.sourceFilename,
        });
      }

      matched.sort((a, b) => b.amount - a.amount);
      return {
        financialYear: year,
        virementRecordCount: matched.length,
        totalNaira,
        totalNairaFormatted: this.formatNaira(totalNaira),
        categoryBreakdown: VIREMENT_CATEGORY_DEFS.map((d) => buckets.get(d.key)!),
        records: matched,
      };
    }

    const pre = this.forensicsData?.byYear?.[String(year)]?.virements;
    if (pre) {
      return {
        ...pre,
        records: pre.records || pre.topRecords || [],
      };
    }

    return {
      financialYear: year,
      virementRecordCount: 0,
      totalNaira: 0,
      totalNairaFormatted: '₦0',
      categoryBreakdown: VIREMENT_CATEGORY_DEFS.map((d) => ({
        key: d.key,
        label: d.label,
        count: 0,
        totalNaira: 0,
      })),
      records: [],
    };
  }

  // Feature Query 13: Unified Multi-Year Aggregated Asset Inventory with Learned Unit-Price & Dynamic Multi-Year Antiquity Tracker
  public getAggregatedAssetsInventory() {
    // Specific physical item definitions with regex match patterns & baseline inflation unit prices
    const itemCatalog: Record<string, {
      itemKey: string;
      label: string;
      categoryGroup: string;
      iconName: string;
      keywords: RegExp;
      baseUnitPrice2023: number;
    }> = {
      hilux_pickups: {
        itemKey: 'hilux_pickups',
        label: 'Hilux & Pickup Trucks',
        categoryGroup: 'Vehicles & Transport',
        iconName: 'Car',
        keywords: /\b(hilux|pick-?up|utility vehicle|operational vehicle|double cab)\b/i,
        baseUnitPrice2023: 45000000
      },
      suv_luxury: {
        itemKey: 'suv_luxury',
        label: 'SUVs & Executive Sedans',
        categoryGroup: 'Vehicles & Transport',
        iconName: 'Car',
        keywords: /\b(suvs?|land cruiser|prado|fortuner|pajero|executive vehicle|official vehicle|jeep|saloon)\b/i,
        baseUnitPrice2023: 75000000
      },
      buses_buses: {
        itemKey: 'buses_buses',
        label: 'Staff Buses & Coasters',
        categoryGroup: 'Vehicles & Transport',
        iconName: 'Car',
        keywords: /\b(coaster|staff bus(?:es)?|mini bus(?:es)?|school bus(?:es)?|commuter|18-?seater|30-?seater|\bbus(?:es)?\b)\b/i,
        baseUnitPrice2023: 55000000
      },
      ambulances: {
        itemKey: 'ambulances',
        label: 'Ambulances & Mobile Clinics',
        categoryGroup: 'Vehicles & Transport',
        iconName: 'Activity',
        keywords: /ambulance|mobile clinic|medical vehicle/i,
        baseUnitPrice2023: 50000000
      },
      computers_laptops: {
        itemKey: 'computers_laptops',
        label: 'Computers & Laptops',
        categoryGroup: 'Office Technology',
        iconName: 'Monitor',
        keywords: /computer|laptop|desktop|macbook|workstation|pc /i,
        baseUnitPrice2023: 750000
      },
      photocopy_printers: {
        itemKey: 'photocopy_printers',
        label: 'Photocopy Machines & Printers',
        categoryGroup: 'Office Technology',
        iconName: 'FileText',
        keywords: /photocopy|photocopier|copier|printer|scanner|heavy duty printer/i,
        baseUnitPrice2023: 2500000
      },
      generators_power: {
        itemKey: 'generators_power',
        label: 'Generators & Power Plants',
        categoryGroup: 'Power & Energy',
        iconName: 'Zap',
        keywords: /generator|generating set|power plant|soundproof gen|kva gen/i,
        baseUnitPrice2023: 18000000
      },
      solar_inverters: {
        itemKey: 'solar_inverters',
        label: 'Solar Systems & Inverters',
        categoryGroup: 'Power & Energy',
        iconName: 'Zap',
        keywords: /solar system|solar power|inverter|solar street light|solar panel/i,
        baseUnitPrice2023: 5000000
      },
      water_boreholes: {
        itemKey: 'water_boreholes',
        label: 'Boreholes & Water Facilities',
        categoryGroup: 'Water Infrastructure',
        iconName: 'Droplet',
        keywords: /borehole|solar borehole|water scheme|water treatment/i,
        baseUnitPrice2023: 8500000
      },
      transformers: {
        itemKey: 'transformers',
        label: 'Electrical Transformers',
        categoryGroup: 'Power & Energy',
        iconName: 'Zap',
        keywords: /transformer|500kva|300kva|substation/i,
        baseUnitPrice2023: 12000000
      }
    };

    const ledger: Record<string, {
      itemKey: string;
      label: string;
      categoryGroup: string;
      iconName: string;
      totalSpendNaira: number;
      totalSpendFormatted: string;
      totalQuantity: number;
      verbatimQuantity: number;
      estimatedQuantity: number;
      averageUnitPriceNaira: number;
      byYearBreakdown: Record<number, { year: number; spendNaira: number; count: number; ageInYears: number }>;
      records: Array<{
        projectTitle: string;
        mdaName: string;
        amountNaira: number;
        financialYear: number;
        extractedQty: number;
        isEstimated: boolean;
        budgetCode: string;
        page: number;
      }>;
    }> = {};

    Object.values(itemCatalog).forEach(def => {
      ledger[def.itemKey] = {
        itemKey: def.itemKey,
        label: def.label,
        categoryGroup: def.categoryGroup,
        iconName: def.iconName,
        totalSpendNaira: 0,
        totalSpendFormatted: '₦0',
        totalQuantity: 0,
        verbatimQuantity: 0,
        estimatedQuantity: 0,
        averageUnitPriceNaira: 0,
        byYearBreakdown: {},
        records: []
      };
    });

    // Reference active year for calculating age (e.g. 2026)
    const currentRefYear = this.activeYear || 2026;

    // Guards against rollup header codes, overhead/fuel/maintenance lines, and false quantities
    const mdaRollupRe = /^[0-5]\d{8,9}$/;
    const coaRecurringRe = /^(21|22)\d{4,6}$/;
    const exclusionRe = /\b(fuel\s+cost|lubricant|maintenance\s+of|repairs?\s+of|servicing|insurance|software\s+acquisition|agribusiness|small\s+business|business\s+dev)\b/i;
    const qtySuffixRe = /\b(\d{1,4})\s*(?:nos?\.?|units?|pcs|pieces|sets?|blocks?)\b/i;
    const qtyPrefixRe = /(?:purchase|procurement|supply|acquisition|provision|construction)\s+of\s+(\d{1,4})\b(?!\s*(?:-?seater|-?in-?1|kva|kw|mw|watts?|km|mm|gb|tb|hp|ton|litre|model))/i;

    this.recordsByYear.forEach((records, year) => {
      const inflation = Math.max(0.03, getMacroForYear(year).assetInflationFrom2023);

      records.forEach((r) => {
        const code = String(r.recordIdentity.projectCode || '').trim();
        if (mdaRollupRe.test(code) || coaRecurringRe.test(code)) return;
        const title = r.recordIdentity.verbatimProjectName;
        const amount = r.recordIdentity.amountNaira;

        if (!title || amount <= 0 || exclusionRe.test(title)) return;

        Object.values(itemCatalog).forEach((def) => {
          if (def.keywords.test(title)) {
            const entry = ledger[def.itemKey];

            let verbatimQty: number | null = null;
            const match1 = title.match(qtySuffixRe);
            const match2 = title.match(qtyPrefixRe);

            if (match1 && match1[1]) {
              verbatimQty = parseInt(match1[1], 10);
            } else if (match2 && match2[1]) {
              verbatimQty = parseInt(match2[1], 10);
            }

            let finalQty = 1;
            let isEst = false;

            if (verbatimQty && verbatimQty > 0 && verbatimQty < 10000) {
              finalQty = verbatimQty;
              entry.verbatimQuantity += verbatimQty;
            } else {
              // Honorable estimation using benchmark unit price adjusted for inflation
              const adjustedUnitPrice = def.baseUnitPrice2023 * inflation;
              finalQty = Math.max(1, Math.round(amount / adjustedUnitPrice));
              entry.estimatedQuantity += finalQty;
              isEst = true;
            }

            entry.totalSpendNaira += amount;
            entry.totalQuantity += finalQty;

            // Update year-by-year antiquity ledger
            if (!entry.byYearBreakdown[year]) {
              entry.byYearBreakdown[year] = {
                year,
                spendNaira: 0,
                count: 0,
                ageInYears: Math.max(0, currentRefYear - year)
              };
            }
            entry.byYearBreakdown[year].spendNaira += amount;
            entry.byYearBreakdown[year].count += finalQty;

            // Line item citation entry
            entry.records.push({
              projectTitle: title,
              mdaName: r.mdaGovernanceTaxonomy.mdaName,
              amountNaira: amount,
              financialYear: year,
              extractedQty: finalQty,
              isEstimated: isEst,
              budgetCode: r.recordIdentity.projectCode || r.recordIdentity.id,
              page: r.sourceProvenance?.pdfPage || 1
            });
          }
        });
      });
    });

    // Format results & calc averages
    Object.values(ledger).forEach((item) => {
      item.totalSpendFormatted = this.formatNaira(item.totalSpendNaira);
      item.averageUnitPriceNaira = item.totalQuantity > 0 ? Math.round(item.totalSpendNaira / item.totalQuantity) : 0;
      item.records.sort((a, b) => b.amountNaira - a.amountNaira);
    });

    return ledger;
  }

  // Feature Query 14: Presumption of Acquisition & Antiquity Lifespan Waste Alerts
  public getPrematureReplacementAlerts(): PrematureReplacementAlert[] {
    if (this.forensicsData?.prematureReplacementAlerts?.length) {
      return this.forensicsData.prematureReplacementAlerts;
    }

    const alerts: PrematureReplacementAlert[] = [];
    const grouped = new Map<string, { displayMda: string; assetCategory: string; byYear: Map<number, Array<{ rec: BudgetRecord; qty: number }>> }>();

    this.recordsByYear.forEach((records, yrKey) => {
      for (const r of records) {
        if ((r.recordIdentity.spendingType || '').toUpperCase() !== 'CAPITAL') continue;
        if (r.recordIdentity.amountNaira < 1_000_000) continue;
        const rawMda = r.mdaGovernanceTaxonomy.mdaName;
        if (!isValidMdaName(rawMda)) continue;
        const title = r.recordIdentity.verbatimProjectName || '';
        if (!title || ROUTINE_CONSUMABLE_RE.test(title)) continue;

        const cats = new Map<string, number>();
        for (const tok of r.assetTokens || []) {
          if (ASSET_CATEGORY_META[tok.category]) {
            const qty = tok.quantity || 1;
            cats.set(tok.category, Math.max(cats.get(tok.category) || 0, Math.max(1, qty)));
          }
        }
        if (cats.size === 0 && DURABLE_ACTION_RE.test(title)) {
          for (const rule of DURABLE_CATEGORY_RULES) {
            if (rule.pattern.test(title)) cats.set(rule.key, 1);
          }
        }
        if (cats.size === 0) continue;

        const normMda = normalizeMdaClusterName(rawMda);
        const recYear = r.recordIdentity.financialYear || yrKey;
        cats.forEach((qty, catKey) => {
          const groupKey = `${normMda}::${catKey}`;
          let bucket = grouped.get(groupKey);
          if (!bucket) {
            bucket = { displayMda: rawMda.replace(/\s+/g, ' ').trim(), assetCategory: catKey, byYear: new Map() };
            grouped.set(groupKey, bucket);
          }
          const arr = bucket.byYear.get(recYear);
          if (arr) arr.push({ rec: r, qty });
          else bucket.byYear.set(recYear, [{ rec: r, qty }]);
        });
      }
    });

    grouped.forEach((bucket) => {
      const years = Array.from(bucket.byYear.keys()).sort((a, b) => a - b);
      if (years.length < 2) return;
      const meta = ASSET_CATEGORY_META[bucket.assetCategory];
      if (!meta) return;
      const lifespan = meta.lifespanYears;

      let bestWindow: number[] = [];
      for (let i = years.length - 1; i >= 1; i--) {
        const yEnd = years[i];
        const win = years.slice(0, i + 1).filter((y) => yEnd - y < lifespan);
        if (win.length >= 2) {
          bestWindow = win;
          break;
        }
      }
      if (bestWindow.length < 2) return;

      let minGapYears = lifespan;
      for (let i = 0; i < bestWindow.length - 1; i++) {
        minGapYears = Math.min(minGapYears, bestWindow[i + 1] - bestWindow[i]);
      }

      const recsWithQty = bestWindow.flatMap((y) => bucket.byYear.get(y) || []);
      const totalSpentNaira = recsWithQty.reduce((s, p) => s + p.rec.recordIdentity.amountNaira, 0);
      const activeInventoryTally = recsWithQty.reduce((s, p) => s + p.qty, 0);
      const earliestAcquisitionYear = bestWindow[0];
      const latestAcquisitionYear = bestWindow[bestWindow.length - 1];
      const wasteRisk: 'HIGH' | 'MEDIUM' =
        bestWindow.length >= 3 || totalSpentNaira >= 500_000_000 ? 'HIGH' : 'MEDIUM';

      const sampleRecords = recsWithQty
        .map((p) => p.rec)
        .sort((a, b) => b.recordIdentity.amountNaira - a.recordIdentity.amountNaira)
        .slice(0, 10)
        .map((r) => ({
          id: r.recordIdentity.id,
          projectCode: r.recordIdentity.projectCode,
          projectName: r.recordIdentity.verbatimProjectName,
          agency: r.mdaGovernanceTaxonomy.mdaName,
          amount: r.recordIdentity.amountNaira,
          page: r.sourceProvenance?.pdfPage || 1,
          financialYear: r.recordIdentity.financialYear,
          spendingType: r.recordIdentity.spendingType,
          sourceFilename: r.sourceProvenance?.sourceFilename,
        }));

      alerts.push({
        mdaName: bucket.displayMda,
        assetCategory: bucket.assetCategory,
        assetCategoryLabel: meta.label,
        recentAllocationsCount: recsWithQty.length,
        totalSpentNaira,
        totalSpentFormatted: this.formatNaira(totalSpentNaira),
        yearsActive: bestWindow,
        minGapYears,
        antiquityLifespanYears: lifespan,
        earliestAcquisitionYear,
        latestAcquisitionYear,
        activeInventoryTally,
        wasteRisk,
        reason: `${bucket.displayMda} budgeted ${recsWithQty.length} durable ${meta.label.toLowerCase()} acquisitions across ${bestWindow.length} fiscal cycles (${bestWindow.join(', ')}) within a ${latestAcquisitionYear - earliestAcquisitionYear}-year span — below the ${lifespan}-year usable lifespan benchmark.`,
        sampleRecords,
      });
    });

    return alerts
      .sort((a, b) => {
        if (a.wasteRisk !== b.wasteRisk) return a.wasteRisk === 'HIGH' ? -1 : 1;
        return b.totalSpentNaira - a.totalSpentNaira;
      })
      .slice(0, 150);
  }

  private formatNaira(amt: number): string {
    if (amt >= 1e12) return `₦${(amt / 1e12).toFixed(2)} Trillion`;
    if (amt >= 1e9) return `₦${(amt / 1e9).toFixed(2)} Billion`;
    if (amt >= 1e6) return `₦${(amt / 1e6).toFixed(2)} Million`;
    return `₦${amt.toLocaleString()}`;
  }
}

export const budgetDatabase = new BudgetDatabaseEngine();

