import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Download,
  ExternalLink,
  FileCode,
  FileText,
  MapPin,
  ShieldCheck,
  X,
} from 'lucide-react';
import statePaths from '../data/state_svg_paths.json';
import lgaSummaryData from '../data/nigeria_lga_summary.json';
import { getStateConstituencyProfile } from '../data/constituenciesDirectory';
import { useBudgetDatabase } from '../context/BudgetDatabaseContext';
import { loadSourceProvenance, resolveYearProvenance } from '../utils/citationFormatter';
import { exportStateBriefDocx, exportStateBriefPdf } from '../utils/documentExporter';
import {
  type GeoExecutionGlobalSummary,
  type GeoIntelligenceIndexPayload,
  type GeoProjectStub,
  type GeoYearPayload,
  type StateGeoEntry,
  computeStateDeliveryMetrics,
  loadGeoIntelligenceIndex,
} from '../utils/geoIntelligence';
import { ContractorHistoryModal, type ContractorSummaryItem } from './ContractorHistoryModal';
import { ExpandableText } from './ExpandableText';

interface Props {
  geoIndex?: GeoIntelligenceIndexPayload | null;
  externalSelectedState?: string | null;
  onSelectState?: (stateName: string) => void;
  onSelectProject?: (project: any) => void;
}

function fmtNaira(amt: number): string {
  if (!amt) return '₦0';
  if (amt >= 1e12) return `₦${(amt / 1e12).toFixed(2)}T`;
  if (amt >= 1e9) return `₦${(amt / 1e9).toFixed(2)}B`;
  if (amt >= 1e6) return `₦${(amt / 1e6).toFixed(2)}M`;
  return `₦${amt.toLocaleString()}`;
}

export const InvestigatorHeatmapWidget: React.FC<Props> = ({
  geoIndex,
  externalSelectedState,
  onSelectState,
  onSelectProject,
}) => {
  const { activeYear } = useBudgetDatabase();
  const [yearData, setYearData] = useState<GeoYearPayload | null>(null);
  const [execSummary, setExecSummary] = useState<GeoExecutionGlobalSummary | null>(null);
  const [loading, setLoading] = useState(!geoIndex);
  const [selectedStateName, setSelectedStateName] = useState<string>(externalSelectedState || 'Kano');
  const [hoveredStateName, setHoveredStateName] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<'risk' | 'deliveryGap' | 'spend' | 'flaggedShare' | 'contracted' | 'disbursed'>('risk');
  const [execScope, setExecScope] = useState<'fy' | 'cumulative'>('fy');
  const [showLgaDrawer, setShowLgaDrawer] = useState(false);
  const [selectedContractor, setSelectedContractor] = useState<ContractorSummaryItem | null>(null);
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null);

  useEffect(() => {
    if (externalSelectedState) {
      setSelectedStateName(externalSelectedState);
    }
  }, [externalSelectedState]);

  const handleSelectState = (stateName: string) => {
    setSelectedStateName(stateName);
    onSelectState?.(stateName);
  };

  useEffect(() => {
    if (geoIndex) {
      setYearData(geoIndex.years?.[String(activeYear)] || null);
      setExecSummary(geoIndex.executionSummary || null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    loadGeoIntelligenceIndex()
      .then((json) => {
        if (!active) return;
        setYearData(json?.years?.[String(activeYear)] || null);
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
  }, [activeYear, geoIndex]);

  const statesMap = yearData?.states || {};

  const getStateLayerAmount = (stName: string, st?: StateGeoEntry): number => {
    if (colorMode === 'contracted') {
      return execScope === 'cumulative'
        ? execSummary?.cumulativeByState?.[stName]?.contractedNaira || 0
        : st?.contractedNaira || 0;
    }
    if (colorMode === 'disbursed') {
      return execScope === 'cumulative'
        ? execSummary?.cumulativeByState?.[stName]?.govspendDisbursedNaira || 0
        : st?.govspendDisbursedNaira || 0;
    }
    return st?.amountNaira || 0;
  };

  const maxStateSpend = useMemo(() => {
    const vals = Object.entries(statesMap).map(([stName, s]) =>
      getStateLayerAmount(stName, s)
    );
    return Math.max(1, ...vals);
  }, [statesMap, colorMode, execScope, execSummary]);

  const topHotspots = useMemo(
    () =>
      Object.values(statesMap)
        .filter((s) => s.projectCount > 0)
        .sort((a, b) => b.flaggedAmountNaira - a.flaggedAmountNaira || b.amountNaira - a.amountNaira)
        .slice(0, 10),
    [statesMap]
  );

  const activeState: StateGeoEntry | null =
    statesMap[selectedStateName] || Object.values(statesMap)[0] || null;

  const getOfficialLgaCount = (stateName: string) => {
    const lgaInfo =
      (lgaSummaryData as Record<string, { count: number }>)[stateName] ||
      (lgaSummaryData as Record<string, { count: number }>)['Federal Capital Territory'];
    return lgaInfo?.count || 0;
  };

  const getFillColor = (st?: StateGeoEntry): string => {
    if (!st) return '#cbd5e1';
    if (colorMode === 'deliveryGap') {
      const cumSt = execSummary?.cumulativeByState?.[st.name];
      const dm = computeStateDeliveryMetrics(st, cumSt);
      switch (dm.deliveryGapBand) {
        case 'PAPER_HEAVY_LOW_EXECUTION':
          return '#b91c1c';
        case 'DISBURSED_EXCEEDS_AWARDS':
          return '#d97706';
        case 'ACTIVE_DELIVERY':
          return '#059669';
        case 'MINIMAL_STATE_DATA':
          return '#cbd5e1';
      }
    }
    if (colorMode === 'contracted') {
      const amt = getStateLayerAmount(st.name, st);
      if (amt <= 0) return '#e2e8f0';
      const ratio = amt / maxStateSpend;
      if (ratio >= 0.45) return '#1e3a8a';
      if (ratio >= 0.2) return '#2563eb';
      if (ratio >= 0.08) return '#60a5fa';
      return '#bfdbfe';
    }
    if (colorMode === 'disbursed') {
      const amt = getStateLayerAmount(st.name, st);
      if (amt <= 0) return '#e2e8f0';
      const ratio = amt / maxStateSpend;
      if (ratio >= 0.45) return '#4c1d95';
      if (ratio >= 0.2) return '#7c3aed';
      if (ratio >= 0.08) return '#a78bfa';
      return '#ddd6fe';
    }
    if (st.projectCount === 0) return '#cbd5e1';
    if (colorMode === 'risk') {
      switch (st.anomalyScore) {
        case 'High': return '#dc2626';
        case 'Medium': return '#d97706';
        case 'Low': return '#f59e0b';
        case 'None': return '#059669';
      }
    }
    if (colorMode === 'spend') {
      const ratio = st.amountNaira / maxStateSpend;
      if (ratio >= 0.45) return '#064e3b';
      if (ratio >= 0.2) return '#059669';
      if (ratio >= 0.08) return '#34d399';
      return '#a7f3d0';
    }
    // flaggedShare %
    if (st.flaggedSharePct >= 15) return '#b91c1c';
    if (st.flaggedSharePct >= 7) return '#d97706';
    if (st.flaggedSharePct > 0) return '#f59e0b';
    return '#10b981';
  };

  const renderPrimaryItemButton = (item: GeoProjectStub) => {
    onSelectProject?.({
      id: item.id,
      projectCode: item.projectCode,
      projectName: item.projectName,
      amount: item.amount,
      agency: item.agency,
      state: item.state,
      page: item.page,
      financialYear: item.financialYear,
      sector: item.sector,
    });
  };

  return (
    <div
      className="dossier-card"
      style={{
        padding: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.1rem',
        position: 'relative',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.8rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.15rem' }}>
            <h3 className="font-editorial" style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Sub-National Anomaly &amp; Allocation Heatmap (FY {activeYear})
            </h3>
            <span className="font-mono" style={{ fontSize: '0.67rem', backgroundColor: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', fontWeight: 700, padding: '0.12rem 0.48rem', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
              <ShieldCheck size={11} /> 37 States · 774 LGAs Word-Boundary Indexed
            </span>
          </div>
          <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: 0 }}>
            {yearData
              ? `${yearData.summary.geoTaggedItems.toLocaleString()} location-tagged items (${fmtNaira(yearData.summary.geoTaggedAmountNaira)} · ${yearData.summary.geoCoveragePct}% of FY ${activeYear} leaf spend)`
              : `Loading FY ${activeYear} spatial distribution...`}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', backgroundColor: 'var(--bg-canvas)', borderRadius: '6px', padding: '0.18rem', border: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
            {[
              { id: 'risk', label: 'Anomaly Risk' },
              { id: 'deliveryGap', label: 'Delivery Gap' },
              { id: 'spend', label: 'Budgeted (₦)' },
              { id: 'contracted', label: 'Contracted (NOCOPO)' },
              { id: 'disbursed', label: 'Paid (GovSpend)' },
              { id: 'flaggedShare', label: 'Flagged %' },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setColorMode(m.id as 'risk' | 'deliveryGap' | 'spend' | 'flaggedShare' | 'contracted' | 'disbursed')}
                style={{
                  border: 'none',
                  borderRadius: '4px',
                  padding: '0.28rem 0.55rem',
                  fontSize: '0.7rem',
                  fontWeight: colorMode === m.id ? 700 : 500,
                  backgroundColor: colorMode === m.id ? '#091017' : 'transparent',
                  color: colorMode === m.id ? '#ffffff' : 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                {m.label}
              </button>
            ))}
          </div>

          {(colorMode === 'contracted' || colorMode === 'disbursed') && (
            <div style={{ display: 'flex', backgroundColor: 'var(--bg-canvas)', borderRadius: '6px', padding: '0.18rem', border: '1px solid var(--border-subtle)' }}>
              {[
                { id: 'fy', label: `FY ${activeYear}` },
                { id: 'cumulative', label: '2018–26 Total' },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setExecScope(s.id as 'fy' | 'cumulative')}
                  style={{
                    border: 'none',
                    borderRadius: '4px',
                    padding: '0.24rem 0.48rem',
                    fontSize: '0.67rem',
                    fontWeight: execScope === s.id ? 700 : 500,
                    backgroundColor: execScope === s.id ? '#059669' : 'transparent',
                    color: execScope === s.id ? '#ffffff' : 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {(colorMode === 'contracted' || colorMode === 'disbursed') && yearData && (
        <div
          className="font-mono tabular-nums"
          style={{
            padding: '0.45rem 0.7rem',
            borderRadius: '6px',
            backgroundColor: colorMode === 'contracted' ? '#eff6ff' : '#f5f3ff',
            border: `1px solid ${colorMode === 'contracted' ? '#bfdbfe' : '#ddd6fe'}`,
            fontSize: '0.7rem',
            color: colorMode === 'contracted' ? '#1e3a8a' : '#4c1d95',
            display: 'flex',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.4rem',
          }}
        >
          <span>
            {colorMode === 'contracted' ? 'NOCOPO Awarded' : 'GovSpend Disbursed'} geoMatchedPct:{' '}
            <strong>
              {execScope === 'cumulative'
                ? `${(colorMode === 'contracted'
                    ? execSummary?.nocopoGeoMatchedPct || 0
                    : execSummary?.govspendGeoMatchedPct || 0
                  ).toFixed(1)}%`
                : `${(colorMode === 'contracted'
                    ? yearData.summary.execution?.nocopoGeoMatchedPct || 0
                    : yearData.summary.execution?.govspendGeoMatchedPct || 0
                  ).toFixed(1)}%`}
            </strong>
          </span>
          <span>
            Nationwide / Abuja HQ Isolated:{' '}
            <strong>
              {fmtNaira(
                execScope === 'cumulative'
                  ? colorMode === 'contracted'
                    ? execSummary?.nocopoHqNationwideNaira || 0
                    : execSummary?.govspendHqNationwideNaira || 0
                  : colorMode === 'contracted'
                  ? yearData.summary.execution?.nocopoHqNationwideNaira || 0
                  : yearData.summary.execution?.govspendHqNationwideNaira || 0
              )}
            </strong>
          </span>
        </div>
      )}

      {/* Split Map + Forensic Profile */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '1.25rem', alignItems: 'stretch' }}>
        {/* Left: SVG State Map */}
        <div
          style={{
            position: 'relative',
            backgroundColor: 'var(--bg-canvas)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            padding: '0.75rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '340px',
          }}
        >
          {loading ? (
            <span className="font-mono" style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Loading FY {activeYear} state geometry...
            </span>
          ) : (
            <svg viewBox="4 0 795 590" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '320px', display: 'block' }}>
              {statePaths.map((st) => {
                const entry = statesMap[st.name];
                const isHovered = hoveredStateName === st.name;
                const isSelected = activeState?.name === st.name;
                return (
                  <path
                    key={st.code}
                    d={st.svgPath}
                    fill={getFillColor(entry)}
                    fillOpacity={isHovered ? 0.96 : isSelected ? 0.9 : 0.72}
                    stroke="#ffffff"
                    strokeWidth={isSelected ? 2.8 : isHovered ? 2 : 0.85}
                    style={{ cursor: 'pointer', transition: 'all 0.18s ease' }}
                    onMouseEnter={() => setHoveredStateName(st.name)}
                    onMouseLeave={() => setHoveredStateName(null)}
                    onClick={() => handleSelectState(st.name)}
                  />
                );
              })}
            </svg>
          )}

          {/* Legend */}
          <div
            style={{
              position: 'absolute',
              right: '12px',
              bottom: '12px',
              backgroundColor: 'rgba(255,255,255,0.95)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              padding: '0.38rem 0.6rem',
              fontSize: '0.67rem',
            }}
          >
            {colorMode === 'risk' ? (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}><span style={{ width: '8px', height: '8px', backgroundColor: '#dc2626', borderRadius: '2px' }} /> High</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}><span style={{ width: '8px', height: '8px', backgroundColor: '#d97706', borderRadius: '2px' }} /> Med</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}><span style={{ width: '8px', height: '8px', backgroundColor: '#f59e0b', borderRadius: '2px' }} /> Low</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}><span style={{ width: '8px', height: '8px', backgroundColor: '#059669', borderRadius: '2px' }} /> Clean</span>
              </div>
            ) : colorMode === 'deliveryGap' ? (
              <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}><span style={{ width: '8px', height: '8px', backgroundColor: '#b91c1c', borderRadius: '2px' }} /> Paper-Heavy</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}><span style={{ width: '8px', height: '8px', backgroundColor: '#d97706', borderRadius: '2px' }} /> Cash&gt;Award</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}><span style={{ width: '8px', height: '8px', backgroundColor: '#059669', borderRadius: '2px' }} /> Active</span>
              </div>
            ) : colorMode === 'spend' ? (
              <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
                <span>Allocation Scale:</span>
                <span style={{ width: '10px', height: '8px', backgroundColor: '#a7f3d0', borderRadius: '2px' }} />
                <span style={{ width: '10px', height: '8px', backgroundColor: '#34d399', borderRadius: '2px' }} />
                <span style={{ width: '10px', height: '8px', backgroundColor: '#059669', borderRadius: '2px' }} />
                <span style={{ width: '10px', height: '8px', backgroundColor: '#064e3b', borderRadius: '2px' }} />
              </div>
            ) : colorMode === 'contracted' ? (
              <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
                <span>Contracted:</span>
                <span style={{ width: '10px', height: '8px', backgroundColor: '#bfdbfe', borderRadius: '2px' }} />
                <span style={{ width: '10px', height: '8px', backgroundColor: '#60a5fa', borderRadius: '2px' }} />
                <span style={{ width: '10px', height: '8px', backgroundColor: '#2563eb', borderRadius: '2px' }} />
                <span style={{ width: '10px', height: '8px', backgroundColor: '#1e3a8a', borderRadius: '2px' }} />
              </div>
            ) : colorMode === 'disbursed' ? (
              <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
                <span>Disbursed:</span>
                <span style={{ width: '10px', height: '8px', backgroundColor: '#ddd6fe', borderRadius: '2px' }} />
                <span style={{ width: '10px', height: '8px', backgroundColor: '#a78bfa', borderRadius: '2px' }} />
                <span style={{ width: '10px', height: '8px', backgroundColor: '#7c3aed', borderRadius: '2px' }} />
                <span style={{ width: '10px', height: '8px', backgroundColor: '#4c1d95', borderRadius: '2px' }} />
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span>Flagged %:</span>
                <span>0% Green</span>
                <span>· 1–14% Amber</span>
                <span>· 15%+ Red</span>
              </div>
            )}
          </div>

          {hoveredStateName && statesMap[hoveredStateName] && (
            <div
              style={{
                position: 'absolute',
                top: '12px',
                left: '12px',
                backgroundColor: '#091017',
                color: '#ffffff',
                padding: '0.35rem 0.65rem',
                borderRadius: '6px',
                fontSize: '0.73rem',
                pointerEvents: 'none',
              }}
            >
              <div style={{ fontWeight: 700 }}>{statesMap[hoveredStateName].displayName}</div>
              <div className="font-mono tabular-nums" style={{ color: '#10b981', fontSize: '0.7rem' }}>
                {colorMode === 'deliveryGap'
                  ? computeStateDeliveryMetrics(
                      statesMap[hoveredStateName],
                      execSummary?.cumulativeByState?.[hoveredStateName]
                    ).deliveryGapLabel
                  : colorMode === 'contracted'
                  ? `Contracted ${fmtNaira(getStateLayerAmount(hoveredStateName, statesMap[hoveredStateName]))}`
                  : colorMode === 'disbursed'
                  ? `Disbursed ${fmtNaira(getStateLayerAmount(hoveredStateName, statesMap[hoveredStateName]))}`
                  : `${fmtNaira(statesMap[hoveredStateName].amountNaira)} · ${statesMap[hoveredStateName].flaggedCount} flags`}
              </div>
            </div>
          )}
        </div>

        {/* Right: Active State Profile */}
        {activeState && (
          <div
            style={{
              backgroundColor: '#ffffff',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              padding: '1rem',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              minHeight: '340px',
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.85rem' }}>
                <div>
                  <span className="font-mono" style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {activeState.zone} · State Forensic Profile
                  </span>
                  <h4 className="font-editorial" style={{ fontSize: '1.3rem', fontWeight: 600, color: 'var(--text-primary)', margin: '0.1rem 0 0' }}>
                    {activeState.displayName}
                  </h4>
                  {(() => {
                    const cp = getStateConstituencyProfile(activeState.displayName || activeState.name);
                    if (!cp) return null;
                    return (
                      <div className="font-mono" style={{ fontSize: '0.64rem', color: '#475569', marginTop: '0.15rem' }}>
                        {cp.senatorialDistricts.join(' · ')} ({cp.federalConstituencies.length} Fed. Constituencies)
                      </div>
                    );
                  })()}
                </div>
                <span
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    padding: '0.24rem 0.6rem',
                    borderRadius: '6px',
                    backgroundColor: activeState.anomalyScore === 'High' ? '#fef2f2' : activeState.anomalyScore === 'Medium' ? '#fffbeb' : '#ecfdf5',
                    color: activeState.anomalyScore === 'High' ? '#b91c1c' : activeState.anomalyScore === 'Medium' ? '#b45309' : '#059669',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                  }}
                >
                  <AlertTriangle size={12} /> {activeState.anomalyScore} Risk
                </span>
              </div>

              {/* Metrics Strip */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 95px), 1fr))', gap: '0.5rem', marginBottom: '0.85rem' }}>
                <div style={{ backgroundColor: 'var(--bg-canvas)', padding: '0.55rem 0.65rem', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Tagged Allocation</div>
                  <div className="font-mono tabular-nums" style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {fmtNaira(activeState.amountNaira)}
                  </div>
                </div>
                <div style={{ backgroundColor: 'var(--bg-canvas)', padding: '0.55rem 0.65rem', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Flagged / Total Items</div>
                  <div className="font-mono tabular-nums" style={{ fontSize: '0.9rem', fontWeight: 700, color: activeState.flaggedCount > 0 ? '#b91c1c' : '#059669' }}>
                    {activeState.flaggedCount} / {activeState.projectCount}
                  </div>
                </div>
                <div style={{ backgroundColor: 'var(--bg-canvas)', padding: '0.55rem 0.65rem', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>YoY Change</div>
                  <div className="font-mono tabular-nums" style={{ fontSize: '0.9rem', fontWeight: 700, color: activeState.yoyDeltaPct === null ? 'var(--text-muted)' : activeState.yoyDeltaPct >= 0 ? '#059669' : '#b45309' }}>
                    {activeState.yoyDeltaPct !== null
                      ? `${activeState.yoyDeltaPct >= 0 ? '+' : ''}${activeState.yoyDeltaPct}%`
                      : `FY ${activeYear}`}
                  </div>
                </div>
              </div>

              {/* 3-Layer Budgeted vs. Contracted vs. Paid Strip */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '0.5rem',
                  marginBottom: '0.85rem',
                }}
              >
                <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', padding: '0.5rem 0.65rem' }}>
                  <div style={{ fontSize: '0.63rem', color: '#1d4ed8', fontWeight: 700 }}>
                    Contracted (NOCOPO · FY {activeYear})
                  </div>
                  <div className="font-mono tabular-nums" style={{ fontSize: '0.88rem', fontWeight: 700, color: '#1e3a8a' }}>
                    {fmtNaira(activeState.contractedNaira || 0)}{' '}
                    <span style={{ fontSize: '0.66rem', fontWeight: 500 }}>({activeState.contractedCount || 0})</span>
                  </div>
                  <div className="font-mono" style={{ fontSize: '0.62rem', color: '#3b82f6' }}>
                    2018–26: {fmtNaira(execSummary?.cumulativeByState?.[activeState.name]?.contractedNaira || 0)}
                  </div>
                </div>
                <div style={{ backgroundColor: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '6px', padding: '0.5rem 0.65rem' }}>
                  <div style={{ fontSize: '0.63rem', color: '#6d28d9', fontWeight: 700 }}>
                    Disbursed (GovSpend · FY {activeYear})
                  </div>
                  <div className="font-mono tabular-nums" style={{ fontSize: '0.88rem', fontWeight: 700, color: '#4c1d95' }}>
                    {fmtNaira(activeState.govspendDisbursedNaira || 0)}{' '}
                    <span style={{ fontSize: '0.66rem', fontWeight: 500 }}>({activeState.govspendVoucherCount || 0})</span>
                  </div>
                  <div className="font-mono" style={{ fontSize: '0.62rem', color: '#7c3aed' }}>
                    2018–26: {fmtNaira(execSummary?.cumulativeByState?.[activeState.name]?.govspendDisbursedNaira || 0)}
                  </div>
                </div>
              </div>

              {/* Primary Item Card */}
              {activeState.primaryItem ? (
                <div style={{ backgroundColor: activeState.primaryItem.isFlagged ? '#fef2f2' : 'var(--bg-canvas)', border: `1px solid ${activeState.primaryItem.isFlagged ? '#fecaca' : 'var(--border-subtle)'}`, borderRadius: '7px', padding: '0.75rem', marginBottom: '0.85rem' }}>
                  <div style={{ fontSize: '0.66rem', color: activeState.primaryItem.isFlagged ? '#b91c1c' : 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '0.2rem' }}>
                    {activeState.primaryItem.isFlagged
                      ? activeState.primaryItem.ruleReason || 'Primary Flagged Allocation'
                      : 'Largest State-Tagged Allocation'}
                  </div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                    <ExpandableText text={activeState.primaryItem.projectName} maxChars={130} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-secondary)', gap: '0.5rem' }}>
                    <span>
                      MDA: <strong>{activeState.topMinistry}</strong> ({fmtNaira(activeState.topMinistryAmountNaira)})
                    </span>
                    <span className="font-mono tabular-nums" style={{ fontWeight: 700, color: '#b91c1c', flexShrink: 0 }}>
                      {fmtNaira(activeState.primaryItem.amount)} · p.{activeState.primaryItem.page}
                    </span>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '0.75rem', borderRadius: '7px', backgroundColor: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.85rem' }}>
                  No explicitly location-tagged line items matched for {activeState.displayName} in FY {activeYear}.
                </div>
              )}

              {/* Top Projects Mini-List */}
              {activeState.topProjects.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.75rem' }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    Top State Allocations (FY {activeYear})
                  </div>
                  {activeState.topProjects.slice(0, 3).map((tp, idx) => (
                    <div
                      key={tp.id || idx}
                      onClick={() => renderPrimaryItemButton(tp)}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '0.5rem',
                        fontSize: '0.74rem',
                        padding: '0.32rem 0.45rem',
                        borderRadius: '5px',
                        backgroundColor: 'var(--bg-canvas)',
                        cursor: onSelectProject ? 'pointer' : 'default',
                      }}
                    >
                      <span style={{ color: 'var(--text-primary)' }}>
                        <strong className="font-mono" style={{ color: 'var(--accent-primary)', marginRight: '0.35rem' }}>{tp.projectCode}</strong>
                        <ExpandableText text={tp.projectName} maxChars={120} />
                      </span>
                      <span className="font-mono tabular-nums" style={{ fontWeight: 700, color: 'var(--text-primary)', flexShrink: 0 }}>
                        {fmtNaira(tp.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Top 3 NOCOPO Contractors in State */}
              {(execSummary?.cumulativeByState?.[activeState.name]?.topContractors?.length || 0) > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#1e3a8a', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <Building2 size={11} /> Top 3 NOCOPO Contractors in {activeState.displayName} (2018–26)
                  </div>
                  {(execSummary?.cumulativeByState?.[activeState.name]?.topContractors || []).map((tc) => (
                    <button
                      key={tc.name}
                      type="button"
                      onClick={() =>
                        setSelectedContractor({
                          contractorName: tc.name,
                          contractCount: tc.count,
                          totalContractedNaira: tc.awardedNaira,
                          mdaCount: 1,
                          firstYear: 2018,
                          lastYear: 2026,
                          topMdas: [activeState.displayName],
                        })
                      }
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.32rem 0.5rem',
                        borderRadius: '5px',
                        backgroundColor: '#eff6ff',
                        border: '1px solid #dbeafe',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {tc.name}
                      </span>
                      <span className="font-mono tabular-nums" style={{ fontSize: '0.7rem', fontWeight: 700, color: '#1d4ed8', flexShrink: 0 }}>
                        {fmtNaira(tc.awardedNaira)} ({tc.count}×)
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '0.45rem', marginTop: '0.9rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setShowLgaDrawer(true)}
                style={{
                  flex: 1,
                  minWidth: '180px',
                  backgroundColor: '#091017',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '0.5rem 0.75rem',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.35rem',
                  cursor: 'pointer',
                }}
              >
                <MapPin size={13} color="#10b981" />
                Inspect LGAs ({activeState.lgaBreakdown.length}/{getOfficialLgaCount(activeState.name)})
              </button>

              {(['pdf', 'docx'] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  disabled={exportingFormat !== null}
                  onClick={async () => {
                    if (exportingFormat) return;
                    setExportingFormat(fmt);
                    try {
                      const cumSt = execSummary?.cumulativeByState?.[activeState.name];
                      const cp = getStateConstituencyProfile(activeState.displayName || activeState.name);
                      const manifest = await loadSourceProvenance();
                      const prov = resolveYearProvenance(manifest, activeYear);
                      const briefInput = {
                        financialYear: activeYear,
                        stateName: activeState.name,
                        displayName: activeState.displayName,
                        zone: activeState.zone,
                        anomalyScore: activeState.anomalyScore,
                        budgetedNaira: activeState.amountNaira,
                        projectCount: activeState.projectCount,
                        flaggedCount: activeState.flaggedCount,
                        flaggedAmountNaira: activeState.flaggedAmountNaira,
                        flaggedSharePct: activeState.flaggedSharePct,
                        topMinistry: activeState.topMinistry,
                        contractedNairaFy: activeState.contractedNaira || 0,
                        contractedNairaCumulative: cumSt?.contractedNaira || 0,
                        disbursedNairaFy: activeState.govspendDisbursedNaira || 0,
                        disbursedNairaCumulative: cumSt?.govspendDisbursedNaira || 0,
                        senatorialDistricts: cp?.senatorialDistricts,
                        federalConstituenciesCount: cp?.federalConstituencies.length,
                        topContractors: cumSt?.topContractors || [],
                        topAllocations: activeState.topProjects || [],
                        lgaBreakdown: activeState.lgaBreakdown || [],
                        sourceFilename: prov.filename,
                        sha256: prov.sha256,
                        permalink: typeof window !== 'undefined' ? window.location.href : undefined,
                      };
                      if (fmt === 'pdf') await exportStateBriefPdf(briefInput);
                      else await exportStateBriefDocx(briefInput);
                    } finally {
                      setExportingFormat(null);
                    }
                  }}
                  className={fmt === 'pdf' ? 'editorial-btn-primary' : 'editorial-btn'}
                  style={{ padding: '0.45rem 0.65rem', fontSize: '0.72rem' }}
                  title={`Export ${activeState.displayName} State Brief (${fmt.toUpperCase()})`}
                >
                  {fmt === 'pdf' ? <FileText size={12} /> : <Download size={12} color="#059669" />}
                  {exportingFormat === fmt ? `${fmt.toUpperCase()}...` : `Brief (${fmt.toUpperCase()})`}
                </button>
              ))}

              {onSelectProject && activeState.primaryItem && (
                <button
                  type="button"
                  onClick={() => renderPrimaryItemButton(activeState.primaryItem!)}
                  style={{
                    backgroundColor: 'var(--bg-canvas)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    padding: '0.45rem 0.65rem',
                    fontSize: '0.73rem',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    cursor: 'pointer',
                  }}
                >
                  <FileCode size={13} color="#2563eb" /> {activeState.primaryItem.projectCode}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Top 10 States by Flagged Exposure Table */}
      {topHotspots.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.9rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.55rem' }}>
            Top 10 States by Flagged Exposure (FY {activeYear}) — Click any row to focus map
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.77rem' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-canvas)', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '0.48rem 0.65rem' }}>State</th>
                  <th style={{ padding: '0.48rem 0.65rem' }}>Zone</th>
                  <th style={{ padding: '0.48rem 0.65rem', textAlign: 'right' }}>Tagged Spend</th>
                  <th style={{ padding: '0.48rem 0.65rem', textAlign: 'right' }}>Flagged Exposure</th>
                  <th style={{ padding: '0.48rem 0.65rem', textAlign: 'center' }}>Flags / Items</th>
                  <th style={{ padding: '0.48rem 0.65rem' }}>Top MDA</th>
                </tr>
              </thead>
              <tbody>
                {topHotspots.map((st) => (
                  <tr
                    key={st.name}
                    onClick={() => handleSelectState(st.name)}
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      backgroundColor: activeState?.name === st.name ? '#ecfdf5' : '#ffffff',
                      cursor: 'pointer',
                    }}
                  >
                    <td style={{ padding: '0.45rem 0.65rem', fontWeight: 700, color: 'var(--text-primary)' }}>{st.displayName}</td>
                    <td style={{ padding: '0.45rem 0.65rem', color: 'var(--text-muted)' }}>{st.zone}</td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.45rem 0.65rem', textAlign: 'right', fontWeight: 600 }}>{fmtNaira(st.amountNaira)}</td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.45rem 0.65rem', textAlign: 'right', fontWeight: 700, color: '#b91c1c' }}>{fmtNaira(st.flaggedAmountNaira)}</td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.45rem 0.65rem', textAlign: 'center' }}>{st.flaggedCount} / {st.projectCount}</td>
                    <td style={{ padding: '0.45rem 0.65rem', color: 'var(--text-secondary)' }}>{st.topMinistry}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Real LGA Breakdown Modal */}
      {showLgaDrawer && activeState && (
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
          onClick={() => setShowLgaDrawer(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '750px',
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.3)',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '1.2rem 1.4rem', backgroundColor: '#091017', color: '#ffffff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="font-mono" style={{ fontSize: '0.68rem', color: '#10b981', fontWeight: 700, textTransform: 'uppercase' }}>
                  FY {activeYear} Document-Verified LGA Allocations
                </div>
                <h2 className="font-editorial" style={{ margin: '0.15rem 0 0', fontSize: '1.25rem', fontWeight: 600, color: '#ffffff' }}>
                  {activeState.displayName} — {activeState.lgaBreakdown.length} LGAs Matched ({getOfficialLgaCount(activeState.name)} Official LGAs)
                </h2>
              </div>
              <button type="button" onClick={() => setShowLgaDrawer(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '1rem 1.4rem', maxHeight: '58vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
              {activeState.lgaBreakdown.length === 0 ? (
                <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
                  All {activeState.projectCount} state-tagged items in {activeState.displayName} for FY {activeYear} are specified at State/Senatorial/Institution level without naming an individual LGA.
                </div>
              ) : (
                activeState.lgaBreakdown.map((lga, idx) => (
                  <div
                    key={`${lga.lgaName}-${idx}`}
                    onClick={() =>
                      onSelectProject?.({
                        projectCode: lga.topProjectCode,
                        projectName: lga.topProjectTitle,
                        amount: lga.topProjectAmount,
                        agency: lga.topProjectAgency,
                        state: activeState.name,
                        page: lga.topProjectPage,
                        financialYear: activeYear,
                      })
                    }
                    style={{
                      padding: '0.75rem',
                      backgroundColor: 'var(--bg-canvas)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '7px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.75rem',
                      cursor: onSelectProject ? 'pointer' : 'default',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)' }}>{lga.lgaName} LGA</div>
                      <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
                        Top Item: <ExpandableText text={lga.topProjectTitle} maxChars={130} />
                      </div>
                      <div className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                        {lga.topProjectCode} · p.{lga.topProjectPage} <ExternalLink size={10} style={{ verticalAlign: 'middle' }} />
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div className="font-mono tabular-nums" style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--accent-primary)' }}>{fmtNaira(lga.amountNaira)}</div>
                      <div className="font-mono tabular-nums" style={{ fontSize: '0.69rem', color: 'var(--text-muted)' }}>
                        {lga.projectCount} items · <span style={{ color: lga.flaggedCount > 0 ? '#b91c1c' : 'var(--text-muted)' }}>{lga.flaggedCount} flags</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div style={{ padding: '0.9rem 1.4rem', backgroundColor: 'var(--bg-canvas)', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              <span className="font-mono tabular-nums">
                State-Wide / Unspecified LGA: {activeState.unmappedLgaCount.toLocaleString()} items
              </span>
              <button type="button" onClick={() => setShowLgaDrawer(false)} style={{ backgroundColor: '#091017', color: '#ffffff', border: 'none', borderRadius: '6px', padding: '0.45rem 0.9rem', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <ContractorHistoryModal
        contractor={selectedContractor}
        onClose={() => setSelectedContractor(null)}
      />
    </div>
  );
};
