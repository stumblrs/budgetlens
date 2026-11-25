import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Layers,
  MapPin,
  Scale,
  Users,
  X,
} from 'lucide-react';
import zoneSvgPaths from '../data/zone_svg_paths.json';
import { getPresidentForYear } from '../data/presidentialTerms';
import { getStateConstituencyProfile } from '../data/constituenciesDirectory';
import { loadSourceProvenance, resolveYearProvenance } from '../utils/citationFormatter';
import { exportTabularDossierDocx, exportTabularDossierPdf } from '../utils/documentExporter';
import {
  type GeoExecutionGlobalSummary,
  type GeoIntelligenceIndexPayload,
  type GeoYearPayload,
  loadGeoIntelligenceIndex,
} from '../utils/geoIntelligence';
import { ExpandableText } from './ExpandableText';

const ZONE_COLORS: Record<string, { color: string; hoverColor: string }> = {
  'North West': { color: '#0891b2', hoverColor: '#0e7490' },
  'North East': { color: '#2563eb', hoverColor: '#1d4ed8' },
  'North Central': { color: '#059669', hoverColor: '#047857' },
  'South West': { color: '#7c3aed', hoverColor: '#6d28d9' },
  'South East': { color: '#db2777', hoverColor: '#be185d' },
  'South South': { color: '#d97706', hoverColor: '#b45309' },
};

function fmtNaira(amt: number): string {
  if (!amt) return '₦0';
  if (amt >= 1e12) return `₦${(amt / 1e12).toFixed(2)}T`;
  if (amt >= 1e9) return `₦${(amt / 1e9).toFixed(2)}B`;
  if (amt >= 1e6) return `₦${(amt / 1e6).toFixed(2)}M`;
  return `₦${amt.toLocaleString()}`;
}

interface Props {
  financialYear: number;
  geoIndex?: GeoIntelligenceIndexPayload | null;
  onSelectProject?: (project: any) => void;
  onSelectState?: (stateName: string) => void;
}

export const GeoMapWidget: React.FC<Props> = ({
  financialYear,
  geoIndex,
  onSelectProject,
  onSelectState,
}) => {
  const [yearData, setYearData] = useState<GeoYearPayload | null>(null);
  const [execSummary, setExecSummary] = useState<GeoExecutionGlobalSummary | null>(null);
  const [loading, setLoading] = useState(!geoIndex);
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);
  const [selectedZoneName, setSelectedZoneName] = useState<string | null>(null);
  const [layerMode, setLayerMode] = useState<'budget' | 'contracted' | 'disbursed'>('budget');
  const [execScope, setExecScope] = useState<'fy' | 'cumulative'>('fy');
  const [viewMode, setViewMode] = useState<'budget' | 'count' | 'perCapita'>('budget');
  const [copied, setCopied] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null);

  useEffect(() => {
    if (geoIndex) {
      setYearData(geoIndex.years?.[String(financialYear)] || null);
      setExecSummary(geoIndex.executionSummary || null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    loadGeoIntelligenceIndex()
      .then((json) => {
        if (!active) return;
        setYearData(json?.years?.[String(financialYear)] || null);
        setExecSummary(json?.executionSummary || null);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setYearData(null);
        setExecSummary(null);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [financialYear, geoIndex]);

  const zones = yearData?.zones || {};
  const selectedZone = selectedZoneName ? zones[selectedZoneName] || null : null;

  const getZoneActiveMetrics = (zName: string) => {
    const z = zones[zName];
    const cumZ = execSummary?.cumulativeByZone?.[zName];
    if (layerMode === 'budget') {
      return {
        amount: z?.amountNaira || 0,
        count: z?.projectCount || 0,
        perCapita: z?.perCapitaNaira || 0,
        unitLabel: 'items',
      };
    }
    const pop = z?.population || 1;
    if (layerMode === 'contracted') {
      const amt = execScope === 'cumulative' ? cumZ?.contractedNaira || 0 : z?.contractedNaira || 0;
      const cnt = execScope === 'cumulative' ? cumZ?.contractedCount || 0 : z?.contractedCount || 0;
      return { amount: amt, count: cnt, perCapita: amt / pop, unitLabel: 'awards' };
    }
    const amt = execScope === 'cumulative' ? cumZ?.govspendDisbursedNaira || 0 : z?.govspendDisbursedNaira || 0;
    const cnt = execScope === 'cumulative' ? cumZ?.govspendVoucherCount || 0 : z?.govspendVoucherCount || 0;
    return { amount: amt, count: cnt, perCapita: amt / pop, unitLabel: 'vouchers' };
  };

  const disparityRatio = useMemo(() => {
    const vals = Object.keys(zones)
      .map((zName) => getZoneActiveMetrics(zName).amount)
      .filter((v) => v > 0);
    if (vals.length < 2) return '1.0';
    return (Math.max(...vals) / Math.min(...vals)).toFixed(1);
  }, [zones, layerMode, execScope, execSummary]);

  const paths = useMemo(
    () => Object.entries(zoneSvgPaths).map(([name, d], idx) => ({ id: `zone-${idx}`, name, d })),
    []
  );

  const handleCopySummary = () => {
    if (!yearData) return;
    const text =
      `GEO-POLITICAL ZONE BUDGET ALLOCATION (FY ${financialYear})\n` +
      `Geo-Tagged Coverage: ${fmtNaira(yearData.summary.geoTaggedAmountNaira)} (${yearData.summary.geoCoveragePct}%)\n` +
      Object.values(zones)
        .map((z) => `${z.name}: ${fmtNaira(z.amountNaira)} (${z.projectCount} items · ₦${Math.round(z.perCapitaNaira).toLocaleString()}/citizen)`)
        .join('\n') +
      `\nVerified from official FY ${financialYear} Appropriation Act.`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportGeo = async (format: 'pdf' | 'docx') => {
    if (!yearData || exportingFormat) return;
    setExportingFormat(format);
    try {
      const pres = getPresidentForYear(financialYear);
      const manifest = await loadSourceProvenance();
      const prov = resolveYearProvenance(manifest, financialYear);
      const zoneList = Object.values(zones);

      const spec = {
        filenameBase: `BudgetLens_Zones_FY${financialYear}`,
        eyebrow: `BUDGETLENS GEO-POLITICAL ZONE INTELLIGENCE · FY ${financialYear}`,
        title: `Geopolitical Zone Budget Distribution — FY ${financialYear}`,
        subtitle: `Location-tagged capital allocations across Nigeria's 6 geopolitical zones (${pres.presidentName} Administration)`,
        orientation: 'landscape' as const,
        metadata: [
          { label: 'Administration', value: `${pres.presidentName} (${pres.termLabel})` },
          { label: 'Geo Coverage', value: `${yearData.summary.geoCoveragePct}% (${yearData.summary.geoTaggedItems.toLocaleString()} items)` },
          { label: 'Zone Spread Ratio', value: `${disparityRatio}x` },
        ],
        kpis: [
          { label: 'Location-Tagged Spend', value: fmtNaira(yearData.summary.geoTaggedAmountNaira), subtext: `${yearData.summary.geoCoveragePct}% of leaf items` },
          { label: 'Federal HQ / Nationwide', value: fmtNaira(yearData.summary.federalHqAmountNaira), subtext: `${yearData.summary.federalHqItems.toLocaleString()} HQ items` },
          { label: 'Highest/Lowest Spread', value: `${disparityRatio}x`, subtext: `${zoneList.length} Zones Tracked` },
        ],
        tables: [
          {
            heading: `FY ${financialYear} Geopolitical Zone Ledger (Budgeted vs. Contracted vs. Disbursed)`,
            columns: ['Zone', 'Budgeted (NGN)', 'Contracted NOCOPO', 'Disbursed GovSpend', 'Line Items', 'Per Capita', 'Top MDA'],
            rows: zoneList.map((z) => [
              z.name,
              `₦${Math.round(z.amountNaira).toLocaleString()}`,
              `₦${Math.round(z.contractedNaira || 0).toLocaleString()}`,
              `₦${Math.round(z.govspendDisbursedNaira || 0).toLocaleString()}`,
              z.projectCount.toLocaleString(),
              `₦${Math.round(z.perCapitaNaira).toLocaleString()}`,
              z.topMinistry,
            ]),
            rightAlignColumns: [1, 2, 3, 4, 5],
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
    <div
      className="dossier-card"
      style={{
        padding: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
      }}
    >
      <div>
        {/* Header & Mode Switcher */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.6rem' }}>
          <div>
            <h3 className="font-editorial" style={{ fontSize: '1.08rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Geo-Political Zone Intelligence ({layerMode !== 'budget' && execScope === 'cumulative' ? '2018–2026' : `FY ${financialYear}`})
            </h3>
            <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '0.15rem 0 0' }}>
              Switch layers across Budgeted Act, Contracted Awards, &amp; Open Treasury Disbursements
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', backgroundColor: 'var(--bg-canvas)', borderRadius: '6px', padding: '0.18rem', border: '1px solid var(--border-subtle)' }}>
              {[
                { id: 'budget', label: 'Budgeted' },
                { id: 'contracted', label: 'Contracted' },
                { id: 'disbursed', label: 'Disbursed' },
              ].map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLayerMode(l.id as 'budget' | 'contracted' | 'disbursed')}
                  style={{
                    border: 'none',
                    borderRadius: '4px',
                    padding: '0.24rem 0.55rem',
                    fontSize: '0.69rem',
                    fontWeight: layerMode === l.id ? 700 : 500,
                    backgroundColor: layerMode === l.id ? '#059669' : 'transparent',
                    color: layerMode === l.id ? '#ffffff' : 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  {l.label}
                </button>
              ))}
            </div>

            {layerMode !== 'budget' && (
              <div style={{ display: 'flex', backgroundColor: 'var(--bg-canvas)', borderRadius: '6px', padding: '0.18rem', border: '1px solid var(--border-subtle)' }}>
                {[
                  { id: 'fy', label: `FY ${financialYear}` },
                  { id: 'cumulative', label: '2018–26 Total' },
                ].map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setExecScope(s.id as 'fy' | 'cumulative')}
                    style={{
                      border: 'none',
                      borderRadius: '4px',
                      padding: '0.22rem 0.48rem',
                      fontSize: '0.67rem',
                      fontWeight: execScope === s.id ? 700 : 500,
                      backgroundColor: execScope === s.id ? '#091017' : 'transparent',
                      color: execScope === s.id ? '#ffffff' : 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', backgroundColor: 'var(--bg-canvas)', borderRadius: '6px', padding: '0.18rem', border: '1px solid var(--border-subtle)' }}>
              {[
                { id: 'budget', label: '₦ Spend' },
                { id: 'count', label: 'Items' },
                { id: 'perCapita', label: 'Per Capita' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setViewMode(m.id as 'budget' | 'count' | 'perCapita')}
                  style={{
                    border: 'none',
                    borderRadius: '4px',
                    padding: '0.24rem 0.5rem',
                    fontSize: '0.69rem',
                    fontWeight: viewMode === m.id ? 700 : 500,
                    backgroundColor: viewMode === m.id ? '#091017' : 'transparent',
                    color: viewMode === m.id ? '#ffffff' : 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Geo-Tagging Coverage Banner */}
        {yearData && (() => {
          const ex = yearData.summary.execution;
          if (layerMode === 'budget') {
            return (
              <div
                className="font-mono tabular-nums"
                style={{
                  padding: '0.45rem 0.65rem',
                  borderRadius: '6px',
                  backgroundColor: 'var(--bg-canvas)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '0.7rem',
                  color: 'var(--text-secondary)',
                  marginBottom: '0.75rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '0.4rem',
                }}
              >
                <span>
                  Budget Geo-Matched: <strong>{fmtNaira(yearData.summary.geoTaggedAmountNaira)}</strong> ({yearData.summary.geoTaggedItems.toLocaleString()} items · {yearData.summary.geoCoveragePct}%)
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  Nationwide / Abuja HQ Isolated: {fmtNaira(yearData.summary.federalHqAmountNaira)}
                </span>
              </div>
            );
          }

          if (layerMode === 'contracted') {
            const matchedAmt = execScope === 'cumulative' ? execSummary?.nocopoGeoMatchedNaira || 0 : ex?.nocopoGeoMatchedNaira || 0;
            const matchedCnt = execScope === 'cumulative' ? execSummary?.nocopoGeoMatchedCount || 0 : ex?.nocopoGeoMatchedCount || 0;
            const matchedPct = execScope === 'cumulative' ? execSummary?.nocopoGeoMatchedPct || 0 : ex?.nocopoGeoMatchedPct || 0;
            const hqAmt = execScope === 'cumulative' ? execSummary?.nocopoHqNationwideNaira || 0 : ex?.nocopoHqNationwideNaira || 0;
            return (
              <div
                className="font-mono tabular-nums"
                style={{
                  padding: '0.45rem 0.65rem',
                  borderRadius: '6px',
                  backgroundColor: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  fontSize: '0.69rem',
                  color: '#1e3a8a',
                  marginBottom: '0.75rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '0.4rem',
                }}
              >
                <span>
                  NOCOPO Awarded geoMatchedPct: <strong>{matchedPct.toFixed(1)}%</strong> ({fmtNaira(matchedAmt)} · {matchedCnt.toLocaleString()} awards)
                </span>
                <span>
                  Nationwide / Abuja HQ Isolated: <strong>{fmtNaira(hqAmt)}</strong>
                </span>
              </div>
            );
          }

          const matchedAmt = execScope === 'cumulative' ? execSummary?.govspendGeoMatchedNaira || 0 : ex?.govspendGeoMatchedNaira || 0;
          const matchedCnt = execScope === 'cumulative' ? execSummary?.govspendGeoMatchedCount || 0 : ex?.govspendGeoMatchedCount || 0;
          const matchedPct = execScope === 'cumulative' ? execSummary?.govspendGeoMatchedPct || 0 : ex?.govspendGeoMatchedPct || 0;
          const hqAmt = execScope === 'cumulative' ? execSummary?.govspendHqNationwideNaira || 0 : ex?.govspendHqNationwideNaira || 0;
          return (
            <div
              className="font-mono tabular-nums"
              style={{
                padding: '0.45rem 0.65rem',
                borderRadius: '6px',
                backgroundColor: '#f5f3ff',
                border: '1px solid #ddd6fe',
                fontSize: '0.69rem',
                color: '#5b21b6',
                marginBottom: '0.75rem',
                display: 'flex',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '0.4rem',
              }}
            >
              <span>
                GovSpend Paid geoMatchedPct: <strong>{matchedPct.toFixed(1)}%</strong> ({fmtNaira(matchedAmt)} · {matchedCnt.toLocaleString()} vouchers)
              </span>
              <span>
                Nationwide / Abuja HQ Isolated: <strong>{fmtNaira(hqAmt)}</strong>
              </span>
            </div>
          );
        })()}

        {/* Map Canvas */}
        <div style={{ position: 'relative', height: '320px', padding: '0.65rem', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-canvas)', borderRadius: '8px', border: '1px solid var(--border-subtle)', marginBottom: '0.85rem' }}>
          {loading ? (
            <span className="font-mono" style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Loading spatial index...</span>
          ) : (
            <svg viewBox="0 10 380 260" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block' }}>
              {paths.map((zone) => {
                const isHovered = hoveredZone === zone.name;
                const isSelected = selectedZoneName === zone.name;
                const zColor = ZONE_COLORS[zone.name] || { color: '#94a3b8', hoverColor: '#64748b' };
                return (
                  <path
                    key={zone.id}
                    d={zone.d}
                    fill={isHovered || isSelected ? zColor.hoverColor : zColor.color}
                    fillOpacity={isHovered || isSelected ? 0.95 : 0.78}
                    stroke="#ffffff"
                    strokeWidth={isSelected ? 1.8 : isHovered ? 1.3 : 0.85}
                    style={{ cursor: 'pointer', transition: 'all 0.2s ease' }}
                    onMouseEnter={() => setHoveredZone(zone.name)}
                    onMouseLeave={() => setHoveredZone(null)}
                    onClick={() => setSelectedZoneName(zone.name)}
                  />
                );
              })}
            </svg>
          )}

          {hoveredZone && zones[hoveredZone] && (() => {
            const zm = getZoneActiveMetrics(hoveredZone);
            return (
              <div
                style={{
                  position: 'absolute',
                  top: '10px',
                  left: '10px',
                  backgroundColor: '#091017',
                  color: '#ffffff',
                  padding: '0.4rem 0.65rem',
                  borderRadius: '6px',
                  fontSize: '0.72rem',
                  pointerEvents: 'none',
                }}
              >
                <div style={{ fontWeight: 700 }}>{hoveredZone}</div>
                <div className="font-mono tabular-nums" style={{ color: '#10b981', fontWeight: 600 }}>
                  {viewMode === 'budget'
                    ? fmtNaira(zm.amount)
                    : viewMode === 'count'
                    ? `${zm.count.toLocaleString()} ${zm.unitLabel}`
                    : `₦${Math.round(zm.perCapita).toLocaleString()} / citizen`}
                </div>
              </div>
            );
          })()}
        </div>

        {/* 6-Zone Compact Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.45rem', marginBottom: '0.85rem' }}>
          {Object.keys(ZONE_COLORS).map((zName) => {
            const z = zones[zName];
            const zColor = ZONE_COLORS[zName];
            const zm = getZoneActiveMetrics(zName);
            const valStr = !z
              ? '—'
              : viewMode === 'budget'
              ? fmtNaira(zm.amount)
              : viewMode === 'count'
              ? `${zm.count.toLocaleString()} ${zm.unitLabel}`
              : `₦${Math.round(zm.perCapita).toLocaleString()}/p`;
            return (
              <button
                key={zName}
                type="button"
                onClick={() => setSelectedZoneName(zName)}
                style={{
                  textAlign: 'left',
                  padding: '0.45rem 0.6rem',
                  borderRadius: '6px',
                  border: selectedZoneName === zName ? `1px solid ${zColor.color}` : '1px solid var(--border-subtle)',
                  backgroundColor: selectedZoneName === zName ? '#f8fafc' : '#ffffff',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.35rem',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: zColor.color, flexShrink: 0 }} />
                  {zName}
                </span>
                <span className="font-mono tabular-nums" style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                  {valStr}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Footer Ratio & Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span className="font-mono tabular-nums" style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <Scale size={13} style={{ color: '#059669' }} />
          Highest/Lowest Zone Spread: <strong>{disparityRatio}×</strong>
        </span>

        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button
            type="button"
            onClick={handleCopySummary}
            style={{ padding: '0.3rem 0.6rem', borderRadius: '5px', border: '1px solid var(--border-subtle)', backgroundColor: '#ffffff', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
          >
            {copied ? <Check size={12} color="#059669" /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={() => handleExportGeo('pdf')}
            disabled={!yearData || exportingFormat !== null}
            style={{ padding: '0.3rem 0.6rem', borderRadius: '5px', border: '1px solid var(--border-subtle)', backgroundColor: '#ffffff', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
          >
            <FileText size={12} color="#059669" /> {exportingFormat === 'pdf' ? 'PDF...' : 'PDF'}
          </button>
          <button
            type="button"
            onClick={() => handleExportGeo('docx')}
            disabled={!yearData || exportingFormat !== null}
            style={{ padding: '0.3rem 0.6rem', borderRadius: '5px', border: '1px solid var(--border-subtle)', backgroundColor: '#ffffff', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
          >
            <Download size={12} /> {exportingFormat === 'docx' ? 'DOCX...' : 'DOCX'}
          </button>
        </div>
      </div>

      {/* Zone Drilldown Modal */}
      {selectedZone && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.72)',
            backdropFilter: 'blur(4px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.25rem',
          }}
          onClick={() => setSelectedZoneName(null)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '760px',
              maxHeight: '85vh',
              overflowY: 'auto',
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '1.2rem 1.4rem', backgroundColor: '#091017', color: '#ffffff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="font-mono" style={{ fontSize: '0.68rem', color: '#10b981', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  FY {financialYear} Regional Intelligence Dossier
                </div>
                <h2 className="font-editorial" style={{ margin: '0.15rem 0 0', fontSize: '1.3rem', fontWeight: 600, color: '#ffffff' }}>
                  {selectedZone.name} Geo-Political Zone
                </h2>
              </div>
              <button type="button" onClick={() => setSelectedZoneName(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '1.25rem 1.4rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: '0.6rem' }}>
                <div style={{ padding: '0.65rem', borderRadius: '8px', backgroundColor: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>FY {financialYear} Budgeted</div>
                  <div className="font-mono tabular-nums" style={{ fontSize: '1.02rem', fontWeight: 700, color: 'var(--accent-primary)' }}>{fmtNaira(selectedZone.amountNaira)}</div>
                </div>
                <div style={{ padding: '0.65rem', borderRadius: '8px', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe' }}>
                  <div style={{ fontSize: '0.68rem', color: '#1d4ed8', fontWeight: 600 }}>Contracted (NOCOPO)</div>
                  <div className="font-mono tabular-nums" style={{ fontSize: '1.02rem', fontWeight: 700, color: '#1e3a8a' }}>
                    {fmtNaira(selectedZone.contractedNaira || 0)}
                  </div>
                  <div className="font-mono" style={{ fontSize: '0.65rem', color: '#3b82f6' }}>
                    2018–26: {fmtNaira(execSummary?.cumulativeByZone?.[selectedZone.name]?.contractedNaira || 0)}
                  </div>
                </div>
                <div style={{ padding: '0.65rem', borderRadius: '8px', backgroundColor: '#f5f3ff', border: '1px solid #ddd6fe' }}>
                  <div style={{ fontSize: '0.68rem', color: '#6d28d9', fontWeight: 600 }}>Disbursed (GovSpend)</div>
                  <div className="font-mono tabular-nums" style={{ fontSize: '1.02rem', fontWeight: 700, color: '#4c1d95' }}>
                    {fmtNaira(selectedZone.govspendDisbursedNaira || 0)}
                  </div>
                  <div className="font-mono" style={{ fontSize: '0.65rem', color: '#7c3aed' }}>
                    2018–26: {fmtNaira(execSummary?.cumulativeByZone?.[selectedZone.name]?.govspendDisbursedNaira || 0)}
                  </div>
                </div>
                <div style={{ padding: '0.65rem', borderRadius: '8px', backgroundColor: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Users size={11} /> Per-Capita Budget
                  </div>
                  <div className="font-mono tabular-nums" style={{ fontSize: '1.02rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    ₦{Math.round(selectedZone.perCapitaNaira).toLocaleString()}
                  </div>
                </div>
              </div>

              {/* State Shares inside Zone */}
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.45rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <MapPin size={13} /> Component States ({selectedZone.stateShares.length})
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.45rem' }}>
                  {selectedZone.stateShares.map((st) => {
                    const constProfile = getStateConstituencyProfile(st.displayName || st.state);
                    return (
                    <div
                      key={st.state}
                      onClick={() => {
                        if (onSelectState) {
                          setSelectedZoneName(null);
                          onSelectState(st.state);
                        }
                      }}
                      style={{
                        padding: '0.5rem 0.7rem',
                        borderRadius: '6px',
                        backgroundColor: 'var(--bg-canvas)',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '0.76rem',
                        cursor: onSelectState ? 'pointer' : 'default',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <span>{st.displayName}</span>
                          {onSelectState && (
                            <span className="font-mono" style={{ fontSize: '0.6rem', color: '#059669' }}>
                              Inspect →
                            </span>
                          )}
                        </div>
                        <div className="font-mono tabular-nums" style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                          {st.projectCount.toLocaleString()} items · {st.flaggedCount} flags
                        </div>
                        <div className="font-mono tabular-nums" style={{ fontSize: '0.64rem', color: '#475569', marginTop: '0.1rem' }}>
                          Ctr: {fmtNaira(st.contractedNaira || 0)} · Paid: {fmtNaira(st.govspendDisbursedNaira || 0)}
                        </div>
                        {constProfile && (
                          <div style={{ fontSize: '0.64rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
                            {constProfile.senatorialDistricts.length} Sen. Districts · {constProfile.federalConstituencies.length} Fed. Constituencies
                          </div>
                        )}
                      </div>
                      <span className="font-mono tabular-nums" style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>
                        {fmtNaira(st.amountNaira)}
                      </span>
                    </div>
                  );})}
                </div>
              </div>

              {/* Top 5 Verbatim Projects */}
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.45rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <Layers size={13} /> Top Verbatim Zone Allocations
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {selectedZone.topProjects.map((p, i) => (
                    <div
                      key={p.id || i}
                      onClick={() => onSelectProject?.(p)}
                      style={{
                        padding: '0.55rem 0.75rem',
                        borderRadius: '6px',
                        border: '1px solid var(--border-subtle)',
                        backgroundColor: '#ffffff',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '0.75rem',
                        cursor: onSelectProject ? 'pointer' : 'default',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                          <ExpandableText text={p.projectName} maxChars={140} />
                        </div>
                        <div className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                          {p.projectCode} · {p.state}{p.lga !== 'Unmapped LGA' ? ` (${p.lga})` : ''} · {p.agency}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div className="font-mono tabular-nums" style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--accent-primary)' }}>{fmtNaira(p.amount)}</div>
                        <div className="font-mono tabular-nums" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                          p.{p.page} <ExternalLink size={10} style={{ verticalAlign: 'middle' }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {selectedZone.flaggedCount > 0 && (
                <div style={{ padding: '0.65rem 0.85rem', borderRadius: '6px', backgroundColor: '#fffbeb', border: '1px solid #fde68a', fontSize: '0.75rem', color: '#92400e', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <AlertTriangle size={14} />
                  <span>
                    <strong className="font-mono tabular-nums">{selectedZone.flaggedCount}</strong> location-tagged items totaling{' '}
                    <strong className="font-mono tabular-nums">{fmtNaira(selectedZone.flaggedAmountNaira)}</strong> triggered v2.0 scrutiny criteria in FY {financialYear}.
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
