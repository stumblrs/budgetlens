import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownUp,
  Building2,
  Download,
  FileText,
  Globe,
  MapPin,
  Search,
  Table2,
} from 'lucide-react';
import { useBudgetDatabase } from '../context/BudgetDatabaseContext';
import { getStateConstituencyProfile } from '../data/constituenciesDirectory';
import { loadSourceProvenance, resolveYearProvenance } from '../utils/citationFormatter';
import { exportStateBriefDocx, exportStateBriefPdf } from '../utils/documentExporter';
import {
  type GeoIntelligenceIndexPayload,
  type StateLeagueRow,
  build37StateLeagueRows,
  computeHqVsStateSplit,
  loadGeoIntelligenceIndex,
} from '../utils/geoIntelligence';
import {
  loadOaugfAuditIndex,
  type OaugfAuditIndexPayload,
} from '../utils/mdaScorecard';
import {
  loadEvidenceEngineAllYears,
  type EvidenceEngineAllYearsPayload,
} from '../utils/evidenceEngineV3';
import { GeoMapWidget } from './GeoMapWidget';
import { InvestigatorHeatmapWidget } from './InvestigatorHeatmapWidget';

type GeoSubView = 'states' | 'zones' | 'table';
type LeagueSortKey =
  | 'budgeted'
  | 'contracted'
  | 'disbursed'
  | 'flaggedShare'
  | 'oaugfExposure'
  | 'billInsertions'
  | 'lgas'
  | 'name';

interface GeoIntelligenceWorkspaceProps {
  financialYear: number;
  onSelectProject?: (project: any) => void;
}

function fmtNairaCompact(amt: number): string {
  if (!amt) return '₦0';
  if (amt >= 1e12) return `₦${(amt / 1e12).toFixed(2)}T`;
  if (amt >= 1e9) return `₦${(amt / 1e9).toFixed(2)}B`;
  if (amt >= 1e6) return `₦${(amt / 1e6).toFixed(1)}M`;
  return `₦${Math.round(amt).toLocaleString()}`;
}

export const GeoIntelligenceWorkspace: React.FC<GeoIntelligenceWorkspaceProps> = ({
  financialYear,
  onSelectProject,
}) => {
  const { activeYear, records } = useBudgetDatabase();
  const effectiveYear = financialYear || activeYear;

  const [geoIndex, setGeoIndex] = useState<GeoIntelligenceIndexPayload | null>(null);
  const [oaugfIndex, setOaugfIndex] = useState<OaugfAuditIndexPayload | null>(null);
  const [evidenceAllYears, setEvidenceAllYears] = useState<EvidenceEngineAllYearsPayload | null>(null);
  const [subView, setSubView] = useState<GeoSubView>('states');
  const [selectedState, setSelectedState] = useState<string>('Kano');
  const [splitLayer, setSplitLayer] = useState<'budget' | 'contracted' | 'disbursed'>('disbursed');
  const [splitScope, setSplitScope] = useState<'fy' | 'cumulative'>('cumulative');
  const [tableScope, setTableScope] = useState<'fy' | 'cumulative'>('cumulative');
  const [tableQuery, setTableQuery] = useState('');
  const [sortBy, setSortBy] = useState<LeagueSortKey>('contracted');
  const [exportingKey, setExportingKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      loadGeoIntelligenceIndex(),
      loadOaugfAuditIndex(),
      loadEvidenceEngineAllYears(),
    ]).then(([data, oaugf, ee]) => {
      if (!active) return;
      if (data) setGeoIndex(data);
      if (oaugf) setOaugfIndex(oaugf);
      if (ee) setEvidenceAllYears(ee);
    });
    return () => {
      active = false;
    };
  }, []);

  const yearRecordsProjection = useMemo(
    () =>
      records
        .filter((r) => r.recordIdentity.financialYear === effectiveYear)
        .map((r) => ({
          state: r.geographicTaxonomy?.state,
          projectCode: r.recordIdentity.projectCode,
          projectName: r.recordIdentity.verbatimProjectName,
          agency: r.mdaGovernanceTaxonomy?.mdaName,
          amount: r.recordIdentity.amountNaira,
        })),
    [records, effectiveYear]
  );

  const yearData = geoIndex?.years?.[String(effectiveYear)] || null;
  const execSummary = geoIndex?.executionSummary || null;

  const hqSplit = useMemo(
    () =>
      computeHqVsStateSplit(
        splitLayer,
        splitLayer === 'budget' ? 'fy' : splitScope,
        yearData,
        execSummary
      ),
    [splitLayer, splitScope, yearData, execSummary]
  );

  const leagueRows = useMemo(() => {
    const base = build37StateLeagueRows(yearData, execSummary, tableScope, {
      oaugfIndex,
      crossLedgerContext: evidenceAllYears?.crossLedgerContext || null,
      yearRecords: yearRecordsProjection,
    });
    const q = tableQuery.trim().toLowerCase();
    const filtered = q
      ? base.filter(
          (r) =>
            r.displayName.toLowerCase().includes(q) ||
            r.zone.toLowerCase().includes(q) ||
            (r.topContractor?.name || '').toLowerCase().includes(q)
        )
      : base;

    return [...filtered].sort((a, b) => {
      if (sortBy === 'budgeted') return b.budgetedNaira - a.budgetedNaira;
      if (sortBy === 'contracted') return b.contractedNaira - a.contractedNaira;
      if (sortBy === 'disbursed') return b.disbursedNaira - a.disbursedNaira;
      if (sortBy === 'flaggedShare') {
        return b.flaggedSharePct - a.flaggedSharePct || b.flaggedCount - a.flaggedCount;
      }
      if (sortBy === 'oaugfExposure') {
        return (
          (b.oaugfQueriedExposureNaira || 0) - (a.oaugfQueriedExposureNaira || 0) ||
          (b.oaugfTotalMdaQueries || 0) - (a.oaugfTotalMdaQueries || 0)
        );
      }
      if (sortBy === 'billInsertions') {
        return (
          (b.billInsertionNaira || 0) - (a.billInsertionNaira || 0) ||
          (b.billInsertionCount || 0) - (a.billInsertionCount || 0)
        );
      }
      if (sortBy === 'lgas') return b.lgaMappedCount - a.lgaMappedCount;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [yearData, execSummary, tableScope, tableQuery, sortBy, oaugfIndex, evidenceAllYears, yearRecordsProjection]);

  const handleExportRowBrief = async (row: StateLeagueRow, format: 'pdf' | 'docx') => {
    if (!yearData || exportingKey) return;
    const st = yearData.states?.[row.state];
    if (!st) return;
    setExportingKey(`${row.state}:${format}`);
    try {
      const cumSt = execSummary?.cumulativeByState?.[row.state];
      const constProfile = getStateConstituencyProfile(st.displayName || st.name);
      const manifest = await loadSourceProvenance();
      const prov = resolveYearProvenance(manifest, effectiveYear);

      const input = {
        financialYear: effectiveYear,
        stateName: st.name,
        displayName: st.displayName,
        zone: st.zone,
        anomalyScore: st.anomalyScore,
        budgetedNaira: st.amountNaira,
        projectCount: st.projectCount,
        flaggedCount: st.flaggedCount,
        flaggedAmountNaira: st.flaggedAmountNaira,
        flaggedSharePct: st.flaggedSharePct,
        topMinistry: st.topMinistry,
        contractedNairaFy: st.contractedNaira || 0,
        contractedNairaCumulative: cumSt?.contractedNaira || 0,
        disbursedNairaFy: st.govspendDisbursedNaira || 0,
        disbursedNairaCumulative: cumSt?.govspendDisbursedNaira || 0,
        senatorialDistricts: constProfile?.senatorialDistricts,
        federalConstituenciesCount: constProfile?.federalConstituencies.length,
        topContractors: cumSt?.topContractors || [],
        topAllocations: st.topProjects || [],
        lgaBreakdown: st.lgaBreakdown || [],
        crossLedgerAccountability:
          oaugfIndex || evidenceAllYears
            ? {
                oaugfQueriedMdaCount: row.oaugfQueriedMdaCount || 0,
                oaugfQueriedExposureNaira: row.oaugfQueriedExposureNaira || 0,
                oaugfTotalMdaQueries: row.oaugfTotalMdaQueries || 0,
                billInsertionCount: row.billInsertionCount || 0,
                billInsertionNaira: row.billInsertionNaira || 0,
                topOaugfMdas: row.topOaugfMdas || [],
              }
            : null,
        sourceFilename: prov.filename,
        sha256: prov.sha256,
        permalink: typeof window !== 'undefined' ? window.location.href : undefined,
      };
      if (format === 'pdf') {
        await exportStateBriefPdf(input);
      } else {
        await exportStateBriefDocx(input);
      }
    } finally {
      setExportingKey(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
      {/* Unified Geo & Anomaly Map Hero Banner + HQ Split Bar */}
      <div
        className="dossier-card"
        style={{
          padding: '1.15rem 1.35rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.9rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <div>
            <h2
              className="font-editorial"
              style={{
                margin: 0,
                fontSize: '1.42rem',
                fontWeight: 600,
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <MapPin color="#059669" /> Geo &amp; Anomaly Accountability Map (FY {effectiveYear})
            </h2>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Unified 36-State + FCT, 774-LGA &amp; 6-Zone Intelligence comparing Enacted Budget, NOCOPO Awarded Contracts, and GovSpend Disbursements
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              gap: '0.35rem',
              flexWrap: 'wrap',
              backgroundColor: 'var(--bg-canvas)',
              padding: '0.22rem',
              borderRadius: '8px',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {(
              [
                ['states', '36 States + FCT & LGAs', MapPin],
                ['zones', '6 Geopolitical Zones', Globe],
                ['table', '37-State League Table', Table2],
              ] as Array<[GeoSubView, string, any]>
            ).map(([id, lbl, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSubView(id)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.36rem 0.72rem',
                  borderRadius: '6px',
                  border: 'none',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  backgroundColor: subView === id ? '#091017' : 'transparent',
                  color: subView === id ? '#ffffff' : 'var(--text-secondary)',
                }}
              >
                <Icon size={13} color={subView === id ? '#10b981' : '#64748b'} />
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {/* Visual Abuja HQ / Nationwide vs. State-Tagged Split Bar */}
        <div
          style={{
            padding: '0.7rem 0.9rem',
            borderRadius: '8px',
            backgroundColor: 'var(--bg-canvas)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.45rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              <Building2 size={14} color="#059669" />
              <span>Centralized HQ / Nationwide Isolation: {hqSplit.headlineLabel}</span>
            </div>

            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {(
                [
                  ['budget', `FY ${effectiveYear} Budget`],
                  ['contracted', 'NOCOPO Contracted'],
                  ['disbursed', 'GovSpend Paid'],
                ] as const
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSplitLayer(k)}
                  className="font-mono"
                  style={{
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '5px',
                    padding: '0.18rem 0.48rem',
                    fontSize: '0.67rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    backgroundColor: splitLayer === k ? '#059669' : '#ffffff',
                    color: splitLayer === k ? '#ffffff' : 'var(--text-secondary)',
                  }}
                >
                  {lbl}
                </button>
              ))}
              {splitLayer !== 'budget' && (
                <button
                  type="button"
                  onClick={() => setSplitScope((s) => (s === 'cumulative' ? 'fy' : 'cumulative'))}
                  className="font-mono"
                  style={{
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '5px',
                    padding: '0.18rem 0.48rem',
                    fontSize: '0.67rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    backgroundColor: '#091017',
                    color: '#ffffff',
                  }}
                >
                  {splitScope === 'cumulative' ? 'Scope: 2018–26' : `Scope: FY ${effectiveYear}`}
                </button>
              )}
            </div>
          </div>

          <div
            style={{
              width: '100%',
              height: '12px',
              borderRadius: '6px',
              overflow: 'hidden',
              backgroundColor: '#e2e8f0',
              display: 'flex',
            }}
          >
            <div
              title={`State-Tagged Infrastructure: ${hqSplit.stateMatchedPct}%`}
              style={{
                width: `${hqSplit.stateMatchedPct}%`,
                backgroundColor:
                  splitLayer === 'budget'
                    ? '#10b981'
                    : splitLayer === 'contracted'
                    ? '#2563eb'
                    : '#7c3aed',
              }}
            />
            <div
              title={`Nationwide / Abuja HQ Isolated: ${hqSplit.hqPct}%`}
              style={{
                width: `${hqSplit.hqPct}%`,
                backgroundColor: '#475569',
              }}
            />
          </div>

          <div
            className="font-mono tabular-nums"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.5rem',
              fontSize: '0.69rem',
              color: 'var(--text-secondary)',
            }}
          >
            <span>
              <strong
                style={{
                  color:
                    splitLayer === 'budget'
                      ? '#047857'
                      : splitLayer === 'contracted'
                      ? '#1d4ed8'
                      : '#6d28d9',
                }}
              >
                State-Tagged ({hqSplit.stateMatchedPct}%):
              </strong>{' '}
              {fmtNairaCompact(hqSplit.stateMatchedNaira)} across 36 States + local FCT
            </span>
            <span>
              <strong style={{ color: '#334155' }}>
                Nationwide / Abuja HQ Isolated ({hqSplit.hqPct}%):
              </strong>{' '}
              {fmtNairaCompact(hqSplit.hqNationwideNaira)} excluded from FCT infrastructure totals
            </span>
          </div>
        </div>
      </div>

      {/* Sub-View 1: Interactive 37-State + 774-LGA Map */}
      {subView === 'states' && (
        <InvestigatorHeatmapWidget
          geoIndex={geoIndex}
          externalSelectedState={selectedState}
          onSelectState={setSelectedState}
          onSelectProject={onSelectProject}
        />
      )}

      {/* Sub-View 2: Interactive 6-Zone Equity Map */}
      {subView === 'zones' && (
        <GeoMapWidget
          financialYear={effectiveYear}
          geoIndex={geoIndex}
          onSelectProject={onSelectProject}
          onSelectState={(stName) => {
            setSelectedState(stName);
            setSubView('states');
          }}
        />
      )}

      {/* Sub-View 3: Sortable 37-State Accountability League Table */}
      {subView === 'table' && (
        <div
          className="dossier-card"
          style={{
            padding: '1.2rem 1.3rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.9rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.65rem',
            }}
          >
            <div>
              <h3 className="font-editorial" style={{ margin: 0, fontSize: '1.08rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                37-State &amp; FCT Paper vs. Execution Accountability Table (FY {effectiveYear})
              </h3>
              <p style={{ margin: '0.15rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Click any state name to inspect its LGA breakdown &amp; top contractors, or export a State Brief directly.
              </p>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'center' }}>
              <div style={{ position: 'relative' }}>
                <Search size={13} color="#94a3b8" style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)' }} />
                <input
                  type="text"
                  value={tableQuery}
                  onChange={(e) => setTableQuery(e.target.value)}
                  placeholder="Filter state, zone, contractor..."
                  style={{
                    padding: '0.32rem 0.6rem 0.32rem 1.85rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.74rem',
                    width: '215px',
                  }}
                />
              </div>

              <div style={{ display: 'flex', backgroundColor: 'var(--bg-canvas)', borderRadius: '6px', padding: '0.18rem', border: '1px solid var(--border-subtle)' }}>
                {(
                  [
                    ['cumulative', 'Exec: 2018–26'],
                    ['fy', `Exec: FY ${effectiveYear}`],
                  ] as const
                ).map(([s, lbl]) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setTableScope(s)}
                    style={{
                      border: 'none',
                      borderRadius: '4px',
                      padding: '0.24rem 0.5rem',
                      fontSize: '0.69rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      backgroundColor: tableScope === s ? '#091017' : 'transparent',
                      color: tableScope === s ? '#ffffff' : 'var(--text-secondary)',
                    }}
                  >
                    {lbl}
                  </button>
                ))}
              </div>

              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                <ArrowDownUp size={13} color="#64748b" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as LeagueSortKey)}
                  style={{
                    padding: '0.3rem 0.5rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.73rem',
                    fontWeight: 600,
                    backgroundColor: '#ffffff',
                  }}
                >
                  <option value="contracted">Sort: NOCOPO Contracted</option>
                  <option value="disbursed">Sort: GovSpend Disbursed</option>
                  <option value="budgeted">Sort: FY {effectiveYear} Budgeted</option>
                  <option value="oaugfExposure">Sort: OAuGF-Queried Exposure</option>
                  <option value="billInsertions">Sort: Bill→Act / ZIP Insertions</option>
                  <option value="flaggedShare">Sort: Flagged Share %</option>
                  <option value="lgas">Sort: Matched LGAs</option>
                  <option value="name">Sort: State A–Z</option>
                </select>
              </div>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'left' }}>
                  <th style={{ padding: '0.52rem 0.55rem' }}>State / FCT</th>
                  <th style={{ padding: '0.52rem 0.55rem', textAlign: 'right' }}>FY Budgeted</th>
                  <th style={{ padding: '0.52rem 0.55rem', textAlign: 'right' }}>Flagged</th>
                  <th style={{ padding: '0.52rem 0.55rem', textAlign: 'right' }}>Contracted (NOCOPO)</th>
                  <th style={{ padding: '0.52rem 0.55rem', textAlign: 'right' }}>Disbursed (GovSpend)</th>
                  <th style={{ padding: '0.52rem 0.55rem' }}>OAuGF &amp; Bill→Act</th>
                  <th style={{ padding: '0.52rem 0.55rem' }}>Delivery Gap</th>
                  <th style={{ padding: '0.52rem 0.55rem' }}>Top State Contractor</th>
                  <th style={{ padding: '0.52rem 0.55rem', textAlign: 'right' }}>Brief</th>
                </tr>
              </thead>
              <tbody>
                {leagueRows.map((row) => (
                  <tr key={row.state} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.5rem 0.55rem' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedState(row.state);
                          setSubView('states');
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          textAlign: 'left',
                          cursor: 'pointer',
                          color: '#0f172a',
                          fontWeight: 700,
                        }}
                      >
                        {row.displayName}
                      </button>
                      <div className="font-mono" style={{ fontSize: '0.64rem', color: '#64748b' }}>
                        {row.zone} · {row.lgaTotalCount} LGAs
                      </div>
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.5rem 0.55rem', textAlign: 'right', fontWeight: 600 }}>
                      {fmtNairaCompact(row.budgetedNaira)}
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.5rem 0.55rem', textAlign: 'right', color: row.flaggedCount > 0 ? '#b91c1c' : '#059669', fontWeight: 700 }}>
                      {row.flaggedSharePct.toFixed(1)}% ({row.flaggedCount})
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.5rem 0.55rem', textAlign: 'right', color: '#1e3a8a', fontWeight: 700 }}>
                      {fmtNairaCompact(row.contractedNaira)}
                      <div style={{ fontSize: '0.63rem', color: '#64748b', fontWeight: 500 }}>
                        {row.contractedCount.toLocaleString()} awards
                      </div>
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.5rem 0.55rem', textAlign: 'right', color: '#5b21b6', fontWeight: 700 }}>
                      {fmtNairaCompact(row.disbursedNaira)}
                      <div style={{ fontSize: '0.63rem', color: '#64748b', fontWeight: 500 }}>
                        {row.govspendVoucherCount.toLocaleString()} vouchers
                      </div>
                    </td>
                    <td style={{ padding: '0.5rem 0.55rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', alignItems: 'flex-start' }}>
                        {(row.oaugfQueriedMdaCount || 0) > 0 && (
                          <span
                            className="font-mono"
                            title={(row.topOaugfMdas || []).map((m) => `${m.mdaName}: ${m.queryCount} queries`).join(' • ')}
                            style={{
                              fontSize: '0.62rem',
                              fontWeight: 700,
                              padding: '0.08rem 0.36rem',
                              borderRadius: '4px',
                              backgroundColor: '#fff7ed',
                              color: '#c2410c',
                              border: '1px solid #fed7aa',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            OAuGF: {row.oaugfQueriedMdaCount} MDAs · {fmtNairaCompact(row.oaugfQueriedExposureNaira || 0)}
                          </span>
                        )}
                        {(row.billInsertionCount || 0) > 0 && (
                          <span
                            className="font-mono"
                            style={{
                              fontSize: '0.62rem',
                              fontWeight: 700,
                              padding: '0.08rem 0.36rem',
                              borderRadius: '4px',
                              backgroundColor: '#fef3c7',
                              color: '#92400e',
                              border: '1px solid #fde68a',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            Bill→Act/ZIP: {row.billInsertionCount} ({fmtNairaCompact(row.billInsertionNaira || 0)})
                          </span>
                        )}
                        {!(row.oaugfQueriedMdaCount || 0) && !(row.billInsertionCount || 0) && (
                          <span className="font-mono" style={{ fontSize: '0.64rem', color: '#94a3b8' }}>—</span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '0.5rem 0.55rem' }}>
                      <span
                        className="font-mono"
                        style={{
                          fontSize: '0.64rem',
                          fontWeight: 700,
                          padding: '0.14rem 0.4rem',
                          borderRadius: '4px',
                          backgroundColor:
                            row.deliveryGapBand === 'PAPER_HEAVY_LOW_EXECUTION'
                              ? '#fef2f2'
                              : row.deliveryGapBand === 'DISBURSED_EXCEEDS_AWARDS'
                              ? '#fffbeb'
                              : row.deliveryGapBand === 'ACTIVE_DELIVERY'
                              ? '#ecfdf5'
                              : '#f1f5f9',
                          color:
                            row.deliveryGapBand === 'PAPER_HEAVY_LOW_EXECUTION'
                              ? '#b91c1c'
                              : row.deliveryGapBand === 'DISBURSED_EXCEEDS_AWARDS'
                              ? '#b45309'
                              : row.deliveryGapBand === 'ACTIVE_DELIVERY'
                              ? '#047857'
                              : '#64748b',
                        }}
                      >
                        {row.deliveryGapLabel}
                      </span>
                    </td>
                    <td style={{ padding: '0.5rem 0.55rem', fontSize: '0.7rem', color: '#334155', maxWidth: '210px' }}>
                      {row.topContractor ? (
                        <div>
                          <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {row.topContractor.name}
                          </div>
                          <div className="font-mono" style={{ fontSize: '0.62rem', color: '#64748b' }}>
                            {fmtNairaCompact(row.topContractor.awardedNaira)} ({row.topContractor.count}×)
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '0.5rem 0.55rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', gap: '0.25rem' }}>
                        <button
                          type="button"
                          onClick={() => handleExportRowBrief(row, 'pdf')}
                          disabled={exportingKey !== null}
                          className="editorial-btn-primary"
                          style={{ padding: '0.2rem 0.42rem', fontSize: '0.65rem' }}
                          title={`Download ${row.displayName} State Brief (PDF)`}
                        >
                          <FileText size={10} /> PDF
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExportRowBrief(row, 'docx')}
                          disabled={exportingKey !== null}
                          className="editorial-btn"
                          style={{ padding: '0.2rem 0.42rem', fontSize: '0.65rem' }}
                          title={`Download ${row.displayName} State Brief (DOCX)`}
                        >
                          <Download size={10} color="#059669" /> DOCX
                        </button>
                      </div>
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
};
