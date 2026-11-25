import React, { useEffect, useMemo, useState } from 'react';
import { datasetUrl } from '../services/apiClient';
import {
  Activity,
  AlertTriangle,
  Box,
  Building,
  Car,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  Droplet,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  Layers,
  Monitor,
  Search,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import { useBudgetDatabase } from '../context/BudgetDatabaseContext';
import { ExpandableText } from './ExpandableText';
import {
  loadOaugfAuditIndex,
  lookupOaugfAssetAndUnvouched,
  type OaugfAuditIndexPayload,
} from '../utils/mdaScorecard';
import {
  loadEvidenceEngineAllYears,
  lookupMdaRiskProfile,
  type EvidenceEngineAllYearsPayload,
} from '../utils/evidenceEngineV3';
import {
  exportTabularDossierDocx,
  exportTabularDossierPdf,
  type TabularDossierSpec,
} from '../utils/documentExporter';
import { formatNairaExact } from '../utils/reportExporter';
import { buildCanonicalPermalink } from '../utils/urlState';

interface AssetRecordCitation {
  id: string;
  financialYear: number;
  projectCode: string;
  projectName: string;
  agency: string;
  sector: string;
  state?: string | null;
  amount: number;
  page: number;
  verbatimQty?: number | null;
  estimatedQty?: number | null;
  impliedUnitCostNaira?: number | null;
}

interface AssetYearBucket {
  year: number;
  spendNaira: number;
  lineCount: number;
  verbatimQty: number;
  estimatedQty: number;
}

interface AssetCategoryData {
  itemKey: string;
  label: string;
  categoryGroup: string;
  lifespanYears: number;
  baseUnitPrice2023: number;
  totalSpendNaira: number;
  totalLineCount: number;
  verbatimQuantity: number;
  verbatimRecordCount: number;
  estimatedQuantity: number;
  estimatedRecordCount: number;
  avgVerbatimUnitCostNaira?: number | null;
  byYear: Record<string, AssetYearBucket>;
  topRecords: AssetRecordCitation[];
}

interface RepeatProcurementAlert {
  mdaName: string;
  assetCategory: string;
  categoryLabel: string;
  lifespanYears: number;
  yearsActive: number[];
  allocationCount: number;
  totalSpendNaira: number;
  verbatimTotalUnits: number;
  wasteRisk: 'HIGH' | 'MEDIUM';
  records: AssetRecordCitation[];
}

interface AssetInventoryIndex {
  generatedAt: string;
  yearsCovered: number[];
  categories: AssetCategoryData[];
  repeatAlerts: RepeatProcurementAlert[];
}

interface AggregatedAssetsExplorerProps {
  onSelectProject?: (project: any) => void;
}

function fmtNaira(amt: number): string {
  if (!amt) return '₦0';
  if (amt >= 1e12) return `₦${(amt / 1e12).toFixed(2)}T`;
  if (amt >= 1e9) return `₦${(amt / 1e9).toFixed(2)}B`;
  if (amt >= 1e6) return `₦${(amt / 1e6).toFixed(2)}M`;
  return `₦${amt.toLocaleString()}`;
}

export const AggregatedAssetsExplorer: React.FC<AggregatedAssetsExplorerProps> = ({
  onSelectProject,
}) => {
  const { activeYear } = useBudgetDatabase();
  const [indexData, setIndexData] = useState<AssetInventoryIndex | null>(null);
  const [oaugfIndex, setOaugfIndex] = useState<OaugfAuditIndexPayload | null>(null);
  const [evidenceAllYears, setEvidenceAllYears] = useState<EvidenceEngineAllYearsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('all');
  const [scope, setScope] = useState<'all' | 'recent' | 'active'>('all');
  const [expandedItemKey, setExpandedItemKey] = useState<string | null>('hilux_pickups');
  const [expandedAlertIdx, setExpandedAlertIdx] = useState<number | null>(null);
  const [riskFilter, setRiskFilter] = useState<'ALL' | 'HIGH' | 'MEDIUM'>('ALL');
  const [oaugfOnly, setOaugfOnly] = useState(false);
  const [activeTab, setActiveTab] = useState<'physical_ledger' | 'antiquity_alerts'>('physical_ledger');
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([
      fetch(datasetUrl('/datasets/asset_inventory_index.json'), { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
      loadOaugfAuditIndex(),
      loadEvidenceEngineAllYears(),
    ])
      .then(([json, oaugf, ee]) => {
        if (!mounted) return;
        setIndexData(json as AssetInventoryIndex | null);
        setOaugfIndex(oaugf);
        setEvidenceAllYears(ee);
        setLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setIndexData(null);
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const iconForCategory = (key: string) => {
    switch (key) {
      case 'hilux_pickups':
      case 'suv_saloons':
      case 'staff_buses':
      case 'motorcycles_tricycles':
        return <Car size={20} style={{ color: '#2563eb' }} />;
      case 'ambulances':
        return <Activity size={20} style={{ color: '#e11d48' }} />;
      case 'computers_laptops':
        return <Monitor size={20} style={{ color: '#059669' }} />;
      case 'photocopiers_printers':
        return <FileText size={20} style={{ color: '#7c3aed' }} />;
      case 'generators':
      case 'solar_systems':
      case 'transformers':
        return <Zap size={20} style={{ color: '#d97706' }} />;
      case 'boreholes':
        return <Droplet size={20} style={{ color: '#0891b2' }} />;
      case 'classrooms':
        return <GraduationCap size={20} style={{ color: '#059669' }} />;
      default:
        return <Box size={20} style={{ color: '#475569' }} />;
    }
  };

  // Dynamically recompute scoped totals (All 1999-2026 | Recent 2023-2026 | Active Year)
  const scopedCategories = useMemo(() => {
    if (!indexData) return [];
    const inScope = (yr: number) =>
      scope === 'all' ? true : scope === 'recent' ? yr >= 2023 : yr === activeYear;

    return indexData.categories
      .map((cat) => {
        const yearBuckets = Object.values(cat.byYear).filter((b) => inScope(b.year));
        const spend = yearBuckets.reduce((s, b) => s + b.spendNaira, 0);
        const lineCount = yearBuckets.reduce((s, b) => s + b.lineCount, 0);
        const verbatimQty = yearBuckets.reduce((s, b) => s + b.verbatimQty, 0);
        const estimatedQty = yearBuckets.reduce((s, b) => s + b.estimatedQty, 0);
        const scopedRecords = cat.topRecords.filter((r) => inScope(r.financialYear));

        return {
          ...cat,
          scopedSpend: spend,
          scopedLineCount: lineCount,
          scopedVerbatimQty: verbatimQty,
          scopedEstimatedQty: estimatedQty,
          scopedYears: yearBuckets.sort((a, b) => b.year - a.year),
          scopedRecords,
        };
      })
      .sort((a, b) => b.scopedSpend - a.scopedSpend);
  }, [indexData, scope, activeYear]);

  const categoryGroups = useMemo(
    () => Array.from(new Set(scopedCategories.map((c) => c.categoryGroup))),
    [scopedCategories]
  );

  const filteredCategories = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return scopedCategories.filter((c) => {
      if (selectedGroup !== 'all' && c.categoryGroup !== selectedGroup) return false;
      if (!q) return true;
      return (
        c.label.toLowerCase().includes(q) ||
        c.categoryGroup.toLowerCase().includes(q) ||
        c.scopedRecords.some(
          (r) =>
            r.projectName.toLowerCase().includes(q) ||
            r.agency.toLowerCase().includes(q) ||
            r.projectCode.toLowerCase().includes(q)
        )
      );
    });
  }, [scopedCategories, selectedGroup, searchTerm]);

  const filteredAlerts = useMemo(() => {
    if (!indexData) return [];
    const q = searchTerm.trim().toLowerCase();
    return indexData.repeatAlerts.filter((a) => {
      if (riskFilter !== 'ALL' && a.wasteRisk !== riskFilter) return false;
      if (scope === 'active' && !a.yearsActive.includes(activeYear)) return false;
      if (scope === 'recent' && !a.yearsActive.some((y) => y >= 2023)) return false;
      if (oaugfOnly && !lookupOaugfAssetAndUnvouched(oaugfIndex, a.mdaName)) return false;
      if (!q) return true;
      return (
        a.mdaName.toLowerCase().includes(q) ||
        a.categoryLabel.toLowerCase().includes(q) ||
        a.records.some((r) => r.projectName.toLowerCase().includes(q))
      );
    });
  }, [indexData, riskFilter, scope, activeYear, searchTerm, oaugfOnly, oaugfIndex]);

  const repeatAssetRule = useMemo(
    () =>
      evidenceAllYears?.rulesCatalog?.find(
        (r) => r.id === 'REPEAT_ASSET_LIFESPAN_VIOLATION'
      ) || null,
    [evidenceAllYears]
  );

  const totalsSummary = useMemo(() => {
    const spend = filteredCategories.reduce((s, c) => s + c.scopedSpend, 0);
    const lines = filteredCategories.reduce((s, c) => s + c.scopedLineCount, 0);
    const vUnits = filteredCategories.reduce((s, c) => s + c.scopedVerbatimQty, 0);
    return { spend, lines, vUnits };
  }, [filteredCategories]);

  const handleExportAssetLedger = async (format: 'pdf' | 'docx') => {
    if (!indexData || exportingFormat) return;
    setExportingFormat(format);
    try {
      const scopeLabel =
        scope === 'all'
          ? `All Years (${indexData.yearsCovered[0]}–${indexData.yearsCovered[indexData.yearsCovered.length - 1]})`
          : scope === 'recent'
            ? '2023–2026 Cycle'
            : `FY ${activeYear} Only`;
      const assetMgmtTotal =
        oaugfIndex?.headline?.categoryCounts?.['Internal Control & Asset Management'] ?? 0;
      const unvouchedTotal =
        oaugfIndex?.headline?.categoryCounts?.['Unvouched / Missing Payment Vouchers'] ?? 0;

      const spec: TabularDossierSpec = {
        filenameBase: `BudgetLens_Physical_Asset_Ledger_${scope}_FY${activeYear}`,
        eyebrow: 'BUDGETLENS 28-YEAR PHYSICAL ASSET INVENTORY & OAUGF AUDIT BRIEF',
        title: 'Physical Equipment, Fleet & Repeat-Procurement Ledger (1999–2026)',
        subtitle: `Scope: ${scopeLabel}${selectedGroup !== 'all' ? ` | Group: ${selectedGroup}` : ''} | Repeat Alerts: ${filteredAlerts.length.toLocaleString('en-US')}`,
        orientation: 'landscape',
        metadata: [
          { label: 'Temporal Scope', value: scopeLabel },
          { label: 'Category Filter', value: selectedGroup === 'all' ? 'All Physical Asset Groups' : selectedGroup },
          { label: 'EE v3.0 Lifespan Rule', value: `${(repeatAssetRule?.allYearsCount ?? 6606).toLocaleString('en-US')} hits (${fmtNaira(repeatAssetRule?.allYearsAmountNaira ?? 1735641428700)})` },
          { label: 'OAuGF Asset & Unvouched', value: `${assetMgmtTotal.toLocaleString('en-US')} Asset Mgmt | ${unvouchedTotal.toLocaleString('en-US')} Unvouched` },
        ],
        kpis: [
          {
            label: 'Tracked Asset Spend',
            value: fmtNaira(totalsSummary.spend),
            subtext: `${totalsSummary.lines.toLocaleString('en-US')} capital asset lines`,
          },
          {
            label: 'Verbatim Documented Units',
            value: totalsSummary.vUnits.toLocaleString('en-US'),
            subtext: 'Explicit PDF unit counts',
          },
          {
            label: 'Repeat-Buy Alerts',
            value: filteredAlerts.length.toLocaleString('en-US'),
            subtext: 'Inside statutory asset lifespan',
          },
          {
            label: 'EE v3.0 Repeat Rule',
            value: `${(repeatAssetRule?.allYearsCount ?? 6606).toLocaleString('en-US')} Hits`,
            subtext: fmtNaira(repeatAssetRule?.allYearsAmountNaira ?? 1735641428700),
          },
        ],
        narrative:
          'Audits physical fleet, IT, power, water, medical, and education equipment procurements across 28 federal budgets, cross-linked with Evidence Engine v3.0 REPEAT_ASSET_LIFESPAN_VIOLATION alerts and OAuGF Internal Control & Asset Management / Unvouched Payment queries.',
        tables: [
          {
            heading: `1. Scoped Physical Asset Categories (${filteredCategories.length} categories)`,
            columns: ['Asset Category', 'Group', 'Lifespan', 'Budget Lines', 'Verbatim Units', 'Total Spend (NGN)'],
            rows:
              filteredCategories.length > 0
                ? filteredCategories.map((c) => [
                    c.label,
                    c.categoryGroup,
                    `${c.lifespanYears} yrs`,
                    c.scopedLineCount.toLocaleString('en-US'),
                    c.scopedVerbatimQty.toLocaleString('en-US'),
                    formatNairaExact(c.scopedSpend),
                  ])
                : [['-', 'No asset categories matched current filter', '-', '-', '-', '-']],
            rightAlignColumns: [2, 3, 4, 5],
          },
          {
            heading: `2. Repeat-Procurement Alerts with OAuGF & EE v3.0 Links (${Math.min(50, filteredAlerts.length)} of ${filteredAlerts.length})`,
            columns: ['Executing MDA', 'Asset Class', 'Priority', 'Years Active', 'OAuGF Asset / Unvouched', 'Cumulative (NGN)'],
            rows:
              filteredAlerts.length > 0
                ? filteredAlerts.slice(0, 50).map((a) => {
                    const oa = lookupOaugfAssetAndUnvouched(oaugfIndex, a.mdaName);
                    const oaLabel = oa
                      ? `${oa.assetManagementCount} Asset / ${oa.unvouchedCount} Unvouched (${oa.totalQueries} Q)`
                      : 'No direct OAuGF match';
                    return [
                      a.mdaName.slice(0, 44),
                      `${a.categoryLabel} (${a.lifespanYears}y)`,
                      a.wasteRisk,
                      `${a.yearsActive.length} yrs (${a.yearsActive.slice(0, 5).join(', ')})`,
                      oaLabel,
                      formatNairaExact(a.totalSpendNaira),
                    ];
                  })
                : [['-', 'No repeat-procurement alerts matched filter', '-', '-', '-', '-']],
            rightAlignColumns: [5],
          },
        ],
        permalink: buildCanonicalPermalink({ tab: 'assets', year: activeYear }),
        footnote:
          'Sources: 1999–2026 Federal Appropriation Acts, Evidence Engine v3.0 (REPEAT_ASSET_LIFESPAN_VIOLATION), and OAuGF Audit Reports (1999–2024).',
      };

      if (format === 'pdf') await exportTabularDossierPdf(spec);
      else await exportTabularDossierDocx(spec);
    } finally {
      setExportingFormat(null);
    }
  };

  const openModal = (rec: AssetRecordCitation) => {
    onSelectProject?.({
      id: rec.id,
      projectCode: rec.projectCode,
      projectName: rec.projectName,
      agency: rec.agency,
      financialYear: rec.financialYear,
      amount: rec.amount,
      page: rec.page,
      sector: rec.sector,
      state: rec.state,
    });
  };

  if (loading) {
    return (
      <div className="dossier-card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        <span className="font-mono" style={{ fontSize: '0.82rem' }}>
          Loading verified multi-year physical asset ledger...
        </span>
      </div>
    );
  }

  if (!indexData) {
    return (
      <div className="dossier-card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Asset inventory data is currently unavailable.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', width: '100%' }}>
      {/* Editorial Masthead */}
      <section className="dossier-card" style={{ padding: '1.45rem 1.65rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ flex: '1 1 440px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.25rem' }}>
            <Layers size={15} style={{ color: 'var(--accent-primary)' }} />
            <span className="font-mono" style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--accent-primary)' }}>
              {indexData.yearsCovered.length}-Year Physical Asset Inventory &amp; Repeat-Procurement Tracker
            </span>
          </div>
          <h1 className="font-editorial" style={{ fontSize: '1.55rem', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
            Physical Equipment, Fleet &amp; Infrastructure Asset Ledger
          </h1>
          <p style={{ fontSize: '0.81rem', color: 'var(--text-secondary)', margin: '0.3rem 0 0', lineHeight: 1.5 }}>
            Scans all {indexData.yearsCovered.length} budget years ({indexData.yearsCovered[0]}–{indexData.yearsCovered[indexData.yearsCovered.length - 1]}), excluding fuel, maintenance, agribusiness, and rollup headers. Separates <strong>explicitly stated unit counts</strong> (`NOS`/`units`) from inflation-adjusted estimates.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            disabled={exportingFormat !== null}
            onClick={() => handleExportAssetLedger('pdf')}
            className="editorial-btn-primary"
            style={{ fontSize: '0.74rem', padding: '0.42rem 0.72rem' }}
          >
            <Download size={13} /> {exportingFormat === 'pdf' ? 'Exporting PDF...' : 'Export Ledger (PDF)'}
          </button>
          <button
            type="button"
            disabled={exportingFormat !== null}
            onClick={() => handleExportAssetLedger('docx')}
            className="editorial-btn"
            style={{ fontSize: '0.74rem', padding: '0.42rem 0.72rem' }}
          >
            <FileSpreadsheet size={13} color="#059669" /> {exportingFormat === 'docx' ? 'Exporting DOCX...' : 'Export Ledger (DOCX)'}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('physical_ledger')}
            style={{
              padding: '0.5rem 0.9rem',
              borderRadius: '7px',
              fontSize: '0.78rem',
              fontWeight: 700,
              cursor: 'pointer',
              border: '1px solid var(--border-subtle)',
              backgroundColor: activeTab === 'physical_ledger' ? '#091017' : '#ffffff',
              color: activeTab === 'physical_ledger' ? '#ffffff' : 'var(--text-secondary)',
            }}
          >
            Physical Unit Ledger ({filteredCategories.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('antiquity_alerts')}
            style={{
              padding: '0.5rem 0.9rem',
              borderRadius: '7px',
              fontSize: '0.78rem',
              fontWeight: 700,
              cursor: 'pointer',
              border: activeTab === 'antiquity_alerts' ? '1px solid #b91c1c' : '1px solid var(--border-subtle)',
              backgroundColor: activeTab === 'antiquity_alerts' ? '#b91c1c' : '#ffffff',
              color: activeTab === 'antiquity_alerts' ? '#ffffff' : '#b91c1c',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
            }}
          >
            <ShieldAlert size={14} /> Repeat-Procurement Alerts ({filteredAlerts.length})
          </button>
        </div>
      </section>

      {/* 4-Card Summary Strip */}
      <div className="grid-4-cols">
        <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
            Tracked Asset Spend
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--accent-primary)', marginTop: '0.25rem' }}>
            {fmtNaira(totalsSummary.spend)}
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Across {totalsSummary.lines.toLocaleString()} capital asset lines
          </div>
        </div>

        <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
            Documented Verbatim Units
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.25rem' }}>
            {totalsSummary.vUnits.toLocaleString()} units
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Explicitly printed counts in PDF text</div>
        </div>

        <div className="dossier-card" style={{ padding: '1rem 1.2rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
            MDA Repeat-Buy Cycles
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.4rem', fontWeight: 700, color: '#b91c1c', marginTop: '0.25rem' }}>
            {filteredAlerts.length.toLocaleString()} Alerts
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Same MDA re-procuring inside asset lifespan</div>
        </div>

        <div className="dossier-card" style={{ padding: '1rem 1.2rem', borderColor: '#fde68a', backgroundColor: '#fffbeb' }}>
          <div style={{ fontSize: '0.7rem', color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
            EE v3.0 Lifespan &amp; OAuGF Link
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.35rem', fontWeight: 700, color: '#b45309', marginTop: '0.25rem' }}>
            {(repeatAssetRule?.allYearsCount ?? 6606).toLocaleString('en-US')} Hits
          </div>
          <div className="font-mono" style={{ fontSize: '0.69rem', color: '#78350f' }}>
            {fmtNaira(repeatAssetRule?.allYearsAmountNaira ?? 1735641428700)} · {(oaugfIndex?.headline?.categoryCounts?.['Internal Control & Asset Management'] ?? 0).toLocaleString('en-US')} OAuGF Asset / {(oaugfIndex?.headline?.categoryCounts?.['Unvouched / Missing Payment Vouchers'] ?? 0).toLocaleString('en-US')} Unvouched
          </div>
        </div>
      </div>

      {/* Controls Bar */}
      <div className="dossier-card" style={{ padding: '0.95rem 1.15rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: '380px' }}>
            <Search size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search assets, MDAs, or ERGP codes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '0.45rem 0.75rem 0.45rem 2.15rem',
                fontSize: '0.8rem',
                borderRadius: '6px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--bg-canvas)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            {[
              { id: 'all', label: `All Years (${indexData.yearsCovered[0]}–${indexData.yearsCovered[indexData.yearsCovered.length - 1]})` },
              { id: 'recent', label: '2023–2026 Cycle' },
              { id: 'active', label: `FY ${activeYear} Only` },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setScope(s.id as 'all' | 'recent' | 'active')}
                className="font-mono"
                style={{
                  padding: '0.35rem 0.7rem',
                  borderRadius: '6px',
                  fontSize: '0.73rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: scope === s.id ? '#091017' : '#ffffff',
                  color: scope === s.id ? '#ffffff' : 'var(--text-secondary)',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'physical_ledger' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', paddingTop: '0.55rem', borderTop: '1px solid var(--border-subtle)' }}>
            <button
              type="button"
              onClick={() => setSelectedGroup('all')}
              style={{
                padding: '0.32rem 0.7rem',
                borderRadius: '6px',
                fontSize: '0.74rem',
                fontWeight: 600,
                cursor: 'pointer',
                border: selectedGroup === 'all' ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                backgroundColor: selectedGroup === 'all' ? '#ecfdf5' : '#ffffff',
                color: selectedGroup === 'all' ? '#065f46' : 'var(--text-secondary)',
              }}
            >
              All Groups
            </button>
            {categoryGroups.map((group) => (
              <button
                key={group}
                type="button"
                onClick={() => setSelectedGroup(group)}
                style={{
                  padding: '0.32rem 0.7rem',
                  borderRadius: '6px',
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: selectedGroup === group ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                  backgroundColor: selectedGroup === group ? '#ecfdf5' : '#ffffff',
                  color: selectedGroup === group ? '#065f46' : 'var(--text-secondary)',
                }}
              >
                {group}
              </button>
            ))}
          </div>
        )}

        {activeTab === 'antiquity_alerts' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', paddingTop: '0.55rem', borderTop: '1px solid var(--border-subtle)' }}>
            {(['ALL', 'HIGH', 'MEDIUM'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRiskFilter(r)}
                style={{
                  padding: '0.32rem 0.7rem',
                  borderRadius: '6px',
                  fontSize: '0.73rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: riskFilter === r ? '#091017' : '#ffffff',
                  color: riskFilter === r ? '#ffffff' : 'var(--text-secondary)',
                }}
              >
                {r === 'ALL' ? 'All Severities' : `${r} Risk`}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setOaugfOnly((prev) => !prev)}
              style={{
                padding: '0.32rem 0.7rem',
                borderRadius: '6px',
                fontSize: '0.73rem',
                fontWeight: 700,
                cursor: 'pointer',
                border: oaugfOnly ? '1px solid #c2410c' : '1px solid var(--border-subtle)',
                backgroundColor: oaugfOnly ? '#c2410c' : '#ffffff',
                color: oaugfOnly ? '#ffffff' : '#c2410c',
              }}
            >
              With OAuGF Asset / Unvouched Queries Only
            </button>
          </div>
        )}
      </div>

      {/* Physical Unit Ledger View */}
      {activeTab === 'physical_ledger' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          {filteredCategories.map((item) => {
            const isExpanded = expandedItemKey === item.itemKey;
            const totalUnits = item.scopedVerbatimQty + item.scopedEstimatedQty;
            return (
              <div key={item.itemKey} className="dossier-card" style={{ overflow: 'hidden' }}>
                <div
                  onClick={() => setExpandedItemKey(isExpanded ? null : item.itemKey)}
                  style={{
                    padding: '1.1rem 1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '1rem',
                    flexWrap: 'wrap',
                    cursor: 'pointer',
                    backgroundColor: isExpanded ? 'var(--bg-canvas)' : '#ffffff',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', minWidth: '240px', flex: '1 1 300px' }}>
                    <div style={{ padding: '0.65rem', backgroundColor: 'var(--bg-canvas)', borderRadius: '8px', border: '1px solid var(--border-subtle)', display: 'flex' }}>
                      {iconForCategory(item.itemKey)}
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                        <h3 className="font-editorial" style={{ fontSize: '1.08rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                          {item.label}
                        </h3>
                        <span style={{ fontSize: '0.68rem', padding: '0.1rem 0.45rem', borderRadius: '4px', backgroundColor: '#f1f5f9', color: '#475569', fontWeight: 600 }}>
                          {item.categoryGroup}
                        </span>
                      </div>
                      <div className="font-mono tabular-nums" style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                        {item.scopedLineCount.toLocaleString()} lines · Usable lifespan: {item.lifespanYears} yrs
                        {item.avgVerbatimUnitCostNaira ? ` · Verbatim avg: ${fmtNaira(item.avgVerbatimUnitCostNaira)}/unit` : ''}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '1.4rem', flexWrap: 'wrap' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div className="font-mono tabular-nums" style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {totalUnits.toLocaleString()} units
                      </div>
                      <div className="font-mono tabular-nums" style={{ fontSize: '0.7rem', color: 'var(--accent-primary)', fontWeight: 600 }}>
                        {item.scopedVerbatimQty.toLocaleString()} verbatim · {item.scopedEstimatedQty.toLocaleString()} est.
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', minWidth: '100px' }}>
                      <div className="font-mono tabular-nums" style={{ fontSize: '1.05rem', fontWeight: 700, color: '#059669' }}>
                        {fmtNaira(item.scopedSpend)}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Total Spend</div>
                    </div>

                    <span style={{ color: 'var(--text-muted)' }}>
                      {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    </span>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ padding: '1.1rem 1.25rem', borderTop: '1px solid var(--border-subtle)', backgroundColor: '#ffffff', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {/* Year-by-year antiquity chips */}
                    <div>
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.45rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <Clock size={13} /> Multi-Year Spend &amp; Unit Timeline
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
                        {item.scopedYears.slice(0, 12).map((yb) => (
                          <div key={yb.year} style={{ padding: '0.4rem 0.7rem', borderRadius: '6px', backgroundColor: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', fontSize: '0.74rem' }}>
                            <div className="font-mono tabular-nums" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                              FY {yb.year} · {Math.max(0, activeYear - yb.year)}y ago
                            </div>
                            <div className="font-mono tabular-nums" style={{ fontSize: '0.7rem', color: '#059669', fontWeight: 600 }}>
                              {fmtNaira(yb.spendNaira)} ({yb.verbatimQty > 0 ? `${yb.verbatimQty} verb` : `${yb.estimatedQty} est`})
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Top Line Items Table */}
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                        <thead>
                          <tr style={{ backgroundColor: 'var(--bg-canvas)', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', textAlign: 'left' }}>
                            <th style={{ padding: '0.5rem 0.65rem' }}>FY</th>
                            <th style={{ padding: '0.5rem 0.65rem' }}>Code</th>
                            <th style={{ padding: '0.5rem 0.65rem' }}>Agency</th>
                            <th style={{ padding: '0.5rem 0.65rem' }}>Verbatim Description</th>
                            <th style={{ padding: '0.5rem 0.65rem', textAlign: 'right' }}>Units</th>
                            <th style={{ padding: '0.5rem 0.65rem', textAlign: 'right' }}>Amount</th>
                            <th style={{ padding: '0.5rem 0.65rem', textAlign: 'center' }}>PDF</th>
                          </tr>
                        </thead>
                        <tbody>
                          {item.scopedRecords.slice(0, 15).map((rec, idx) => (
                            <tr
                              key={`${rec.financialYear}-${rec.id}-${idx}`}
                              onClick={() => openModal(rec)}
                              style={{ borderBottom: '1px solid var(--border-subtle)', cursor: onSelectProject ? 'pointer' : 'default' }}
                            >
                              <td className="font-mono tabular-nums" style={{ padding: '0.48rem 0.65rem', fontWeight: 700 }}>{rec.financialYear}</td>
                              <td className="font-mono" style={{ padding: '0.48rem 0.65rem', color: 'var(--accent-primary)', fontWeight: 600 }}>{rec.projectCode}</td>
                              <td style={{ padding: '0.48rem 0.65rem', color: 'var(--text-secondary)', maxWidth: '180px' }}>{rec.agency}</td>
                              <td style={{ padding: '0.48rem 0.65rem', color: 'var(--text-primary)' }}>
                                <div><ExpandableText text={rec.projectName} maxChars={150} /></div>
                                {rec.impliedUnitCostNaira ? (
                                  <span className="font-mono tabular-nums" style={{ fontSize: '0.68rem', color: '#b45309', fontWeight: 600 }}>
                                    Implied unit cost: {fmtNaira(rec.impliedUnitCostNaira)}
                                  </span>
                                ) : null}
                              </td>
                              <td className="font-mono tabular-nums" style={{ padding: '0.48rem 0.65rem', textAlign: 'right', color: rec.verbatimQty ? '#059669' : 'var(--text-muted)', fontWeight: 600 }}>
                                {rec.verbatimQty ? `${rec.verbatimQty} (verb)` : `${rec.estimatedQty || 1} (est)`}
                              </td>
                              <td className="font-mono tabular-nums" style={{ padding: '0.48rem 0.65rem', textAlign: 'right', fontWeight: 700 }}>{fmtNaira(rec.amount)}</td>
                              <td className="font-mono tabular-nums" style={{ padding: '0.48rem 0.65rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                                p.{rec.page} <ExternalLink size={10} style={{ verticalAlign: 'middle' }} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* Repeat-Procurement & Antiquity Alerts View */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {filteredAlerts.length === 0 ? (
            <div className="dossier-card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              No repeat-procurement alerts match the selected filter.
            </div>
          ) : (
            filteredAlerts.map((alert, idx) => {
              const isOpen = expandedAlertIdx === idx;
              const oaugfAsset = lookupOaugfAssetAndUnvouched(oaugfIndex, alert.mdaName);
              const mdaProf = lookupMdaRiskProfile(evidenceAllYears?.crossLedgerContext, alert.mdaName);
              return (
                <div key={`${alert.mdaName}-${alert.assetCategory}-${idx}`} className="dossier-card" style={{ borderLeft: `4px solid ${alert.wasteRisk === 'HIGH' ? '#b91c1c' : '#d97706'}`, overflow: 'hidden' }}>
                  <div
                    onClick={() => setExpandedAlertIdx(isOpen ? null : idx)}
                    style={{ padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', cursor: 'pointer' }}
                  >
                    <div style={{ flex: '1 1 360px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                        <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '0.12rem 0.45rem', borderRadius: '4px', backgroundColor: alert.wasteRisk === 'HIGH' ? '#fef2f2' : '#fffbeb', color: alert.wasteRisk === 'HIGH' ? '#b91c1c' : '#b45309' }}>
                          {alert.wasteRisk} PRIORITY
                        </span>
                        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {alert.categoryLabel} ({alert.lifespanYears}-yr lifespan)
                        </span>
                        {mdaProf && mdaProf.ra.length > 0 && (
                          <span
                            className="font-mono"
                            style={{ fontSize: '0.62rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: '4px', backgroundColor: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}
                          >
                            EE v3.0 Repeat Lifespan Rule
                          </span>
                        )}
                        {oaugfAsset && (
                          <span
                            className="font-mono"
                            title={`${oaugfAsset.totalQueries} OAuGF queries (${oaugfAsset.assetManagementCount} Asset Management, ${oaugfAsset.unvouchedCount} Unvouched Payment Vouchers, ${oaugfAsset.unretiredAdvanceCount} Unretired Advances)`}
                            style={{ fontSize: '0.62rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: '4px', backgroundColor: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa' }}
                          >
                            OAuGF: {oaugfAsset.assetManagementCount} Asset · {oaugfAsset.unvouchedCount} Unvouched ({oaugfAsset.totalQueries} Q)
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <Building size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} /> {alert.mdaName}
                      </div>
                      <div className="font-mono tabular-nums" style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                        Procured across {alert.yearsActive.length} years ({alert.yearsActive.join(', ')}) · {alert.allocationCount} allocations
                        {alert.verbatimTotalUnits > 0 ? ` · ${alert.verbatimTotalUnits} documented units` : ''}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div className="font-mono tabular-nums" style={{ fontSize: '1.1rem', fontWeight: 700, color: '#b91c1c' }}>
                          {fmtNaira(alert.totalSpendNaira)}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Cumulative Spend</div>
                      </div>
                      {isOpen ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
                    </div>
                  </div>

                  {isOpen && (
                    <div style={{ padding: '0.75rem 1.25rem 1rem', backgroundColor: 'var(--bg-canvas)', borderTop: '1px solid var(--border-subtle)' }}>
                      {alert.records.map((r, rIdx) => (
                        <div
                          key={rIdx}
                          onClick={() => openModal(r)}
                          style={{ padding: '0.45rem 0', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.77rem', cursor: onSelectProject ? 'pointer' : 'default' }}
                        >
                          <span>
                            <strong className="font-mono tabular-nums" style={{ marginRight: '0.45rem' }}>FY {r.financialYear}</strong>
                            <span className="font-mono" style={{ color: 'var(--accent-primary)', marginRight: '0.45rem' }}>{r.projectCode}</span>
                            <ExpandableText text={r.projectName} maxChars={150} />
                          </span>
                          <span className="font-mono tabular-nums" style={{ fontWeight: 700, flexShrink: 0 }}>
                            {fmtNaira(r.amount)} · p.{r.page}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.73rem', color: 'var(--text-muted)' }}>
        <AlertTriangle size={13} />
        <span>Source: 1999–2026 Federal Appropriation Acts/Bills · Click any line item to verify exact PDF citation.</span>
      </div>
    </div>
  );
};
