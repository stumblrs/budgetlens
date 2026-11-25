import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  Building2,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Search,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import {
  type MdaIntegrityScorecardsPayload,
  type MdaPillarKey,
  type MdaScorecardEntry,
  type OaugfAuditIndexPayload,
  type RedFlagConvergencePayload,
  formatConvergenceFlagLabel,
  getScoreGradeMeta,
  loadMdaIntegrityScorecards,
  loadOaugfAuditIndex,
  loadRedFlagConvergenceIndex,
  lookupMdaConvergence,
  lookupOaugfMdaFindings,
  normalizeMdaLookupKey,
} from '../utils/mdaScorecard';
import {
  type EvidenceEngineAllYearsPayload,
  type EvidenceTopMdaAllTimeEntry,
  loadEvidenceEngineAllYears,
  lookupMdaRiskProfile,
} from '../utils/evidenceEngineV3';
import {
  exportMdaScorecardBriefDocx,
  exportMdaScorecardBriefPdf,
} from '../utils/documentExporter';
import { ExpandableText } from './ExpandableText';

type SortOption =
  | 'lowestScore'
  | 'highestScore'
  | 'convergence'
  | 'exposureDesc'
  | 'coverageDesc'
  | 'openBiddingAsc'
  | 'cashDisciplineAsc';

type CoverageFilter = 'all' | 'strong4Plus' | 'full5';
type ConvergenceFilter = 'all' | 'convergent2Plus' | 'highRisk3Plus';

interface MdaCrossLedgerEnrichment {
  flagCount: number;
  flags: string[];
  flagDetails: string[];
  hasPersonalOrOpaqueCash: boolean;
  oaugfQueryCount: number;
  oaugfRepeatCount: number;
  oaugfRecoveryDirectives: number;
  eeV3RuleHits: number;
  eeV3CrossLedgerHits: number;
  eeV3FlaggedProjects: number;
  eeV3FlaggedAmountNaira: number;
  repeatAssetCategories: string[];
}

function fmtNairaCompact(amt: number | null | undefined): string {
  if (!amt || !Number.isFinite(amt)) return '₦0';
  if (amt >= 1e12) return `₦${(amt / 1e12).toFixed(2)}T`;
  if (amt >= 1e9) return `₦${(amt / 1e9).toFixed(2)}B`;
  if (amt >= 1e6) return `₦${(amt / 1e6).toFixed(1)}M`;
  return `₦${Math.round(amt).toLocaleString()}`;
}

export const MdaIntegrityScorecardPanel: React.FC = () => {
  const [payload, setPayload] = useState<MdaIntegrityScorecardsPayload | null>(null);
  const [oaugfIndex, setOaugfIndex] = useState<OaugfAuditIndexPayload | null>(null);
  const [convergenceData, setConvergenceData] = useState<RedFlagConvergencePayload | null>(null);
  const [evidenceAllYears, setEvidenceAllYears] = useState<EvidenceEngineAllYearsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [gradeFilter, setGradeFilter] = useState<string>('ALL');
  const [coverageFilter, setCoverageFilter] = useState<CoverageFilter>('strong4Plus');
  const [convergenceFilter, setConvergenceFilter] = useState<ConvergenceFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('highestScore');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(30);
  const [exportingKey, setExportingKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      loadMdaIntegrityScorecards(),
      loadOaugfAuditIndex(),
      loadRedFlagConvergenceIndex(),
      loadEvidenceEngineAllYears(),
    ])
      .then(([data, oaugf, conv, eeAll]) => {
        if (!active) return;
        setPayload(data);
        setOaugfIndex(oaugf);
        setConvergenceData(conv);
        setEvidenceAllYears(eeAll);
        setLoading(false);
        if (data?.mdas?.length) {
          const firstFull = data.mdas.find((m) => m.metricsPresent >= 4) || data.mdas[0];
          setExpandedKey(firstFull.mdaKey);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const enrichmentByMdaKey = useMemo(() => {
    const map = new Map<string, MdaCrossLedgerEnrichment>();
    if (!payload?.mdas) return map;

    const eeByKey = new Map<string, EvidenceTopMdaAllTimeEntry>();
    for (const ee of evidenceAllYears?.topFlaggedMdasAllTime || []) {
      if (ee.mdaKey) eeByKey.set(ee.mdaKey.toUpperCase(), ee);
      const norm = normalizeMdaLookupKey(ee.mdaName);
      if (norm && !eeByKey.has(norm)) eeByKey.set(norm, ee);
    }

    for (const m of payload.mdas) {
      const conv = lookupMdaConvergence(convergenceData, m.mdaName, m.mdaKey);
      const riskProf =
        lookupMdaRiskProfile(evidenceAllYears?.crossLedgerContext, m.mdaName) ||
        lookupMdaRiskProfile(evidenceAllYears?.crossLedgerContext, m.mdaKey);
      const oaugf = lookupOaugfMdaFindings(oaugfIndex, m.mdaName);
      const eeMda =
        eeByKey.get(m.mdaKey) ||
        eeByKey.get(normalizeMdaLookupKey(m.mdaName)) ||
        null;

      const flags = conv?.flags?.length ? conv.flags : riskProf?.cf || [];
      const flagCount = conv?.flagCount ?? flags.length;
      const hasPersonalOrOpaqueCash =
        riskProf?.po === 1 ||
        flags.includes('OPAQUE_OR_STAFF_PAYOUTS') ||
        Boolean(eeMda?.hasPersonalOrOpaquePayoutFlag);

      map.set(m.mdaKey, {
        flagCount,
        flags,
        flagDetails: conv?.flagDetails || [],
        hasPersonalOrOpaqueCash,
        oaugfQueryCount: Math.max(conv?.oaugfQueryCount || 0, oaugf?.findingCount || 0, riskProf?.oi || 0),
        oaugfRepeatCount: Math.max(conv?.oaugfRepeatCount || 0, oaugf?.repeatNeglectCount || 0, riskProf?.or || 0),
        oaugfRecoveryDirectives: oaugf?.recoveryDirectiveCount || 0,
        eeV3RuleHits: eeMda?.totalRuleFindings || 0,
        eeV3CrossLedgerHits: eeMda?.crossLedgerFindings || 0,
        eeV3FlaggedProjects: eeMda?.flaggedProjectCount || 0,
        eeV3FlaggedAmountNaira: eeMda?.flaggedAmountNaira || 0,
        repeatAssetCategories: riskProf?.ra || [],
      });
    }
    return map;
  }, [payload, convergenceData, evidenceAllYears, oaugfIndex]);

  const convergentCounts = useMemo(() => {
    let count2Plus = 0;
    let count3Plus = 0;
    for (const e of enrichmentByMdaKey.values()) {
      if (e.flagCount >= 2) count2Plus += 1;
      if (e.flagCount >= 3) count3Plus += 1;
    }
    return { count2Plus, count3Plus };
  }, [enrichmentByMdaKey]);

  const filteredMdas = useMemo(() => {
    if (!payload?.mdas) return [];
    const qLower = query.trim().toLowerCase();

    const out = payload.mdas.filter((m) => {
      if (coverageFilter === 'full5' && m.metricsPresent < 5) return false;
      if (coverageFilter === 'strong4Plus' && m.metricsPresent < 4) return false;
      if (gradeFilter !== 'ALL' && m.grade !== gradeFilter) return false;
      const enrich = enrichmentByMdaKey.get(m.mdaKey);
      if (convergenceFilter === 'convergent2Plus' && (enrich?.flagCount || 0) < 2) return false;
      if (convergenceFilter === 'highRisk3Plus' && (enrich?.flagCount || 0) < 3) return false;
      if (!qLower) return true;
      return (
        m.mdaName.toLowerCase().includes(qLower) ||
        m.mdaKey.toLowerCase().includes(qLower) ||
        m.parentFamilies.some((f) => f.toLowerCase().includes(qLower))
      );
    });

    out.sort((a, b) => {
      if (sortBy === 'convergence') {
        const ae = enrichmentByMdaKey.get(a.mdaKey);
        const be = enrichmentByMdaKey.get(b.mdaKey);
        return (
          (be?.flagCount || 0) - (ae?.flagCount || 0) ||
          (be?.oaugfQueryCount || 0) - (ae?.oaugfQueryCount || 0) ||
          (be?.eeV3RuleHits || 0) - (ae?.eeV3RuleHits || 0) ||
          (a.compositeScore ?? 999) - (b.compositeScore ?? 999)
        );
      }
      if (sortBy === 'highestScore') {
        return (
          (b.compositeScore ?? -1) - (a.compositeScore ?? -1) ||
          b.metricsPresent - a.metricsPresent ||
          b.totalTrackedExposureNaira - a.totalTrackedExposureNaira
        );
      }
      if (sortBy === 'lowestScore') {
        return (
          (a.compositeScore ?? 999) - (b.compositeScore ?? 999) ||
          b.metricsPresent - a.metricsPresent ||
          b.totalTrackedExposureNaira - a.totalTrackedExposureNaira
        );
      }
      if (sortBy === 'exposureDesc') {
        return b.totalTrackedExposureNaira - a.totalTrackedExposureNaira;
      }
      if (sortBy === 'coverageDesc') {
        return (
          b.metricsPresent - a.metricsPresent ||
          (b.compositeScore ?? -1) - (a.compositeScore ?? -1)
        );
      }
      if (sortBy === 'openBiddingAsc') {
        const as = a.pillars.openBiddingShare?.score ?? 999;
        const bs = b.pillars.openBiddingShare?.score ?? 999;
        return as - bs || b.totalTrackedExposureNaira - a.totalTrackedExposureNaira;
      }
      const ac = a.pillars.cashDiscipline?.score ?? 999;
      const bc = b.pillars.cashDiscipline?.score ?? 999;
      return ac - bc || b.totalTrackedExposureNaira - a.totalTrackedExposureNaira;
    });

    return out;
  }, [payload, query, gradeFilter, coverageFilter, convergenceFilter, sortBy, enrichmentByMdaKey]);

  const displayedMdas = filteredMdas.slice(0, visibleLimit);

  const extremumLeaders = useMemo(() => {
    const strong = (payload?.mdas || []).filter(
      (m) => m.metricsPresent >= 4 && m.compositeScore !== null
    );
    if (strong.length === 0) return { top: null, bottom: null };
    const sorted = [...strong].sort(
      (a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0)
    );
    return { top: sorted[0], bottom: sorted[sorted.length - 1] };
  }, [payload]);

  const renderPillarMetricsText = (key: MdaPillarKey, m: MdaScorecardEntry): string => {
    const p = m.pillars[key];
    if (!p || p.score === null) {
      return p?.status === 'INSUFFICIENT_SAMPLE'
        ? `Insufficient public sample (${
            p.voucherCount ?? p.awardedCount ?? p.pricedAwardedCount ?? 0
          } records) — omitted from active denominator.`
        : 'No verified source coverage for this MDA — omitted from active weight denominator (never scored as 0).';
    }
    if (key === 'paddingRestraint') {
      return `Positive NASS padding ${fmtNairaCompact(p.positivePaddingNaira)} across ${
        p.cyclesCovered?.join(', ') || 'N/A'
      } (${(p.paddingSharePct ?? 0).toFixed(1)}% of ${fmtNairaCompact(
        p.auditedEnactedNaira
      )} audited enacted; ${(p.alteredItemCount || 0).toLocaleString()} altered items).`;
    }
    if (key === 'birCapitalExecution') {
      return `Mean BIR capital release ${
        p.avgReleasePct !== null && p.avgReleasePct !== undefined ? `${p.avgReleasePct.toFixed(1)}%` : 'N/A'
      }, utilization ${
        p.avgUtilizationPct !== null && p.avgUtilizationPct !== undefined
          ? `${p.avgUtilizationPct.toFixed(1)}%`
          : 'N/A'
      } across ${p.yearsCount || p.yearsCovered?.length || 0} BIR yrs (${
        p.matchScope === 'EXACT_MDA' ? 'Exact MDA match' : 'Parent Ministry family'
      }: ${(p.matchedBirLabels || []).join('; ')}).`;
    }
    if (key === 'openBiddingShare') {
      return `${(p.openBiddingValueSharePct ?? 0).toFixed(1)}% of awarded value (${
        p.openBiddingCount || 0
      }/${p.methodKnownCount || 0} method-known awards) via Open Competitive Bidding; ${
        p.nonCompetitiveCount || 0
      } selective/direct/emergency awards across ${fmtNairaCompact(p.totalAwardedNaira)} total awarded (planning excluded).`;
    }
    if (key === 'vendorDiversification') {
      return `HHI ${((p.hhiPoints || 0)).toLocaleString()}/10,000 across ${
        p.distinctVendors || 0
      } contractors (${p.pricedAwardedCount || 0} priced awards). Top winner "${
        p.topVendorName || 'N/A'
      }" holds ${(p.topVendorSharePct ?? 0).toFixed(1)}% share.`;
    }
    return `${(p.voucherCount || 0).toLocaleString()} vouchers (${fmtNairaCompact(
      p.totalDisbursedNaira
    )}): Dec Rush ${
      p.decRushRatio !== null && p.decRushRatio !== undefined ? `${p.decRushRatio}x` : 'N/A'
    } (-${p.decPenalty ?? 0} pts), near-threshold ${(p.nearThresholdPct ?? 0).toFixed(
      2
    )}% (-${p.nearPenalty ?? 0} pts), 7-day splits ${p.splitClusterCount || 0} clusters / ${(
      p.splitVoucherPct ?? 0
    ).toFixed(2)}% (-${p.splitPenalty ?? 0} pts).`;
  };

  const handleExportMdaBrief = async (m: MdaScorecardEntry, format: 'pdf' | 'docx') => {
    if (!payload || exportingKey) return;
    setExportingKey(`${m.mdaKey}:${format}`);
    try {
      const enrich = enrichmentByMdaKey.get(m.mdaKey);
      const briefInput = {
        mdaKey: m.mdaKey,
        mdaName: m.mdaName,
        parentFamilies: m.parentFamilies,
        compositeScore: m.compositeScore,
        grade: m.grade,
        metricsPresent: m.metricsPresent,
        totalExpectedMetrics: m.totalExpectedMetrics,
        activeWeightSum: m.activeWeightSum,
        totalTrackedExposureNaira: m.totalTrackedExposureNaira,
        pillarRows: payload.pillarDefinitions.map((pd) => {
          const p = m.pillars[pd.key];
          const pScore = p?.score ?? null;
          const effWt =
            pScore !== null && m.activeWeightSum > 0
              ? ((pd.weight / m.activeWeightSum) * 100).toFixed(0)
              : '0';
          return {
            pillarLabel: pd.label,
            weight: pd.weight,
            effectiveWeightPct: effWt,
            score: pScore,
            status: p?.status || 'NO_SOURCE_COVERAGE',
            telemetrySummary: renderPillarMetricsText(pd.key, m),
          };
        }),
        convergenceSummary: enrich
          ? {
              flagCount: enrich.flagCount,
              flags: enrich.flags.map((f) => formatConvergenceFlagLabel(f)),
              flagDetails: enrich.flagDetails,
              oaugfQueryCount: enrich.oaugfQueryCount,
              oaugfRepeatCount: enrich.oaugfRepeatCount,
              oaugfRecoveryDirectives: enrich.oaugfRecoveryDirectives,
              hasPersonalOrOpaqueCash: enrich.hasPersonalOrOpaqueCash,
              eeV3RuleHits: enrich.eeV3RuleHits,
              eeV3CrossLedgerHits: enrich.eeV3CrossLedgerHits,
              eeV3FlaggedProjects: enrich.eeV3FlaggedProjects,
              eeV3FlaggedAmountNaira: enrich.eeV3FlaggedAmountNaira,
              repeatAssetCategories: enrich.repeatAssetCategories.map((c) =>
                c.replace(/_/g, ' ')
              ),
            }
          : null,
        permalink: typeof window !== 'undefined' ? window.location.href : undefined,
      };
      if (format === 'pdf') {
        await exportMdaScorecardBriefPdf(briefInput);
      } else {
        await exportMdaScorecardBriefDocx(briefInput);
      }
    } finally {
      setExportingKey(null);
    }
  };

  if (loading) {
    return (
      <div className="dossier-card" style={{ padding: '1.25rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
        Loading Composite 5-Pillar MDA Integrity Scorecards...
      </div>
    );
  }

  if (!payload || payload.mdas.length === 0) {
    return (
      <div className="dossier-card" style={{ padding: '1.25rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
        Composite MDA Integrity Scorecard dataset is not available yet.
      </div>
    );
  }

  const h = payload.headline;

  return (
    <section
      className="dossier-card"
      style={{
        padding: '1.35rem 1.45rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.1rem',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Award size={18} color="#059669" />
            <h3 className="font-editorial" style={{ margin: 0, fontSize: '1.18rem', fontWeight: 700, color: '#0f172a' }}>
              Composite MDA Integrity Scorecard (2009–2026)
            </h3>
            <span
              className="font-mono"
              style={{
                fontSize: '0.67rem',
                fontWeight: 700,
                padding: '0.16rem 0.5rem',
                borderRadius: '999px',
                backgroundColor: '#ecfdf5',
                color: '#047857',
                border: '1px solid #a7f3d0',
              }}
            >
              Open Formula · 5 Accountability Pillars
            </span>
          </div>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', color: '#64748b', lineHeight: 1.45 }}>
            Transparent 0–100 weighted index combining Legislative Padding Restraint, BIR Capital Execution,
            Open Competitive Bidding, Vendor Diversification, and Treasury Cash Discipline. Uncovered pillars stay{' '}
            <strong>N/A</strong> and are strictly omitted from that agency’s denominator.
          </p>
        </div>

        <div className="font-mono" style={{ fontSize: '0.7rem', color: '#64748b', textAlign: 'right' }}>
          <div>{h.awardedContractsAnalyzed.toLocaleString()} awarded NOCOPO contracts</div>
          <div>{h.planningContractsExcluded.toLocaleString()} planning/tender excluded</div>
        </div>
      </div>

      {/* Headline KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(195px, 1fr))', gap: '0.75rem' }}>
        <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem 0.9rem' }}>
          <div style={{ fontSize: '0.67rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
            Audited MDAs
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a', marginTop: '0.15rem' }}>
            {h.totalScoredMdas.toLocaleString()}
          </div>
          <div className="font-mono" style={{ fontSize: '0.68rem', color: '#64748b' }}>
            of {h.totalCandidateMdas.toLocaleString()} federal entities
          </div>
        </div>

        <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem 0.9rem' }}>
          <div style={{ fontSize: '0.67rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
            4–5 Pillar High-Coverage
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#047857', marginTop: '0.15rem' }}>
            {h.strong4PlusPillarCount.toLocaleString()} MDAs
          </div>
          <div className="font-mono" style={{ fontSize: '0.68rem', color: '#64748b' }}>
            {h.full5PillarCount} with all 5/5 pillars scored
          </div>
        </div>

        <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem 0.9rem' }}>
          <div style={{ fontSize: '0.67rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
            Median Integrity Score
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a', marginTop: '0.15rem' }}>
            {h.medianCompositeScore !== null ? `${h.medianCompositeScore.toFixed(1)} / 100` : 'N/A'}
          </div>
          <div className="font-mono" style={{ fontSize: '0.68rem', color: '#64748b' }}>
            Mean {h.meanCompositeScore !== null ? h.meanCompositeScore.toFixed(1) : 'N/A'} · A:{h.gradeDistribution.A || 0} B:{h.gradeDistribution.B || 0} C:{h.gradeDistribution.C || 0} D:{h.gradeDistribution.D || 0} F:{h.gradeDistribution.F || 0}
          </div>
        </div>

        <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '0.75rem 0.9rem' }}>
          <div style={{ fontSize: '0.67rem', fontWeight: 700, color: '#991b1b', textTransform: 'uppercase' }}>
            6-Ledger Convergent MDAs
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#b91c1c', marginTop: '0.15rem' }}>
            {(convergenceData?.headline?.highRisk3PlusMdaCount ?? convergentCounts.count3Plus).toLocaleString('en-US')} High-Risk (3+)
          </div>
          <div className="font-mono" style={{ fontSize: '0.68rem', color: '#991b1b' }}>
            {(convergenceData?.headline?.convergentMdaCount ?? convergentCounts.count2Plus).toLocaleString('en-US')} MDAs with 2+ flags
          </div>
        </div>

        <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem 0.9rem' }}>
          <div style={{ fontSize: '0.67rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
            4–5 Pillar Leader vs. Laggard
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '0.82rem', fontWeight: 700, color: '#047857', marginTop: '0.2rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            High: {extremumLeaders.top?.compositeScore?.toFixed(1) ?? 'N/A'} · {extremumLeaders.top?.mdaName || 'N/A'}
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: '0.76rem', fontWeight: 600, color: '#b91c1c', marginTop: '0.12rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Low: {extremumLeaders.bottom?.compositeScore?.toFixed(1) ?? 'N/A'} · {extremumLeaders.bottom?.mdaName || 'N/A'}
          </div>
        </div>
      </div>

      {/* Transparent 5-Pillar Formula Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '0.5rem',
          padding: '0.65rem 0.8rem',
          backgroundColor: '#faf9f6',
          border: '1px solid rgba(15, 23, 42, 0.09)',
          borderRadius: '8px',
        }}
      >
        {payload.pillarDefinitions.map((pd) => (
          <div key={pd.key} style={{ fontSize: '0.7rem', lineHeight: 1.35 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: '#0f172a' }}>
              <span>{pd.shortLabel}</span>
              <span className="font-mono" style={{ color: '#047857' }}>{pd.weight} pts</span>
            </div>
            <div style={{ color: '#64748b', fontSize: '0.66rem', marginTop: '0.12rem' }}>{pd.sourceLabel}</div>
          </div>
        ))}
      </div>

      {/* Filters & Controls */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: '330px' }}>
          <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '0.7rem', top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ministry, commission, agency, sector..."
            style={{
              width: '100%',
              padding: '0.42rem 0.7rem 0.42rem 2.05rem',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#f8fafc',
              fontSize: '0.78rem',
              color: '#0f172a',
              outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'center' }}>
          <div style={{ display: 'inline-flex', backgroundColor: '#f1f5f9', borderRadius: '6px', padding: '0.18rem', gap: '0.15rem' }}>
            {(
              [
                ['strong4Plus', '4–5 Pillars'],
                ['full5', '5/5 Full Only'],
                ['all', `All (${payload.mdas.length})`],
              ] as Array<[CoverageFilter, string]>
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setCoverageFilter(k)}
                style={{
                  border: 'none',
                  borderRadius: '4px',
                  padding: '0.26rem 0.55rem',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  backgroundColor: coverageFilter === k ? '#0f172a' : 'transparent',
                  color: coverageFilter === k ? '#ffffff' : '#475569',
                }}
              >
                {lbl}
              </button>
            ))}
          </div>

          <div style={{ display: 'inline-flex', backgroundColor: '#f1f5f9', borderRadius: '6px', padding: '0.18rem', gap: '0.12rem' }}>
            {(['ALL', 'A', 'B', 'C', 'D', 'F'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGradeFilter(g)}
                className="font-mono"
                style={{
                  border: 'none',
                  borderRadius: '4px',
                  padding: '0.26rem 0.48rem',
                  fontSize: '0.69rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  backgroundColor: gradeFilter === g ? '#059669' : 'transparent',
                  color: gradeFilter === g ? '#ffffff' : '#475569',
                }}
              >
                {g}
              </button>
            ))}
          </div>

          <div style={{ display: 'inline-flex', backgroundColor: '#f1f5f9', borderRadius: '6px', padding: '0.18rem', gap: '0.12rem' }}>
            {(
              [
                ['all', 'All Risk Levels'],
                ['convergent2Plus', `Convergent 2+ (${convergentCounts.count2Plus})`],
                ['highRisk3Plus', `High-Risk Convergent Only (${convergentCounts.count3Plus})`],
              ] as Array<[ConvergenceFilter, string]>
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setConvergenceFilter(k)}
                style={{
                  border: 'none',
                  borderRadius: '4px',
                  padding: '0.26rem 0.52rem',
                  fontSize: '0.69rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  backgroundColor:
                    convergenceFilter === k
                      ? k === 'highRisk3Plus'
                        ? '#b91c1c'
                        : k === 'convergent2Plus'
                          ? '#b45309'
                          : '#0f172a'
                      : 'transparent',
                  color: convergenceFilter === k ? '#ffffff' : k === 'highRisk3Plus' ? '#991b1b' : '#475569',
                }}
              >
                {lbl}
              </button>
            ))}
          </div>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <SlidersHorizontal size={13} color="#64748b" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              style={{
                padding: '0.34rem 0.55rem',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                fontSize: '0.73rem',
                fontWeight: 600,
                color: '#0f172a',
              }}
            >
              <option value="highestScore">Highest Score First</option>
              <option value="lowestScore">Lowest Score First (Red Flags)</option>
              <option value="convergence">Most Convergent Flags (6-Ledger)</option>
              <option value="exposureDesc">Largest Tracked Exposure (₦)</option>
              <option value="coverageDesc">Most Pillars Covered (5/5 → 1/5)</option>
              <option value="openBiddingAsc">Lowest Open Bidding %</option>
              <option value="cashDisciplineAsc">Lowest Cash Discipline</option>
            </select>
          </div>
        </div>
      </div>

      {/* Scorecard Leaderboard Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.77rem' }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'left' }}>
              <th style={{ padding: '0.55rem 0.6rem' }}>#</th>
              <th style={{ padding: '0.55rem 0.6rem' }}>Federal Ministry / Executing Agency</th>
              <th style={{ padding: '0.55rem 0.6rem', textAlign: 'center' }}>Composite</th>
              <th style={{ padding: '0.55rem 0.6rem', textAlign: 'center' }}>Coverage</th>
              <th style={{ padding: '0.55rem 0.5rem', textAlign: 'center' }}>Padding</th>
              <th style={{ padding: '0.55rem 0.5rem', textAlign: 'center' }}>BIR Exec</th>
              <th style={{ padding: '0.55rem 0.5rem', textAlign: 'center' }}>Open Bid</th>
              <th style={{ padding: '0.55rem 0.5rem', textAlign: 'center' }}>HHI Spread</th>
              <th style={{ padding: '0.55rem 0.5rem', textAlign: 'center' }}>Cash Disc.</th>
              <th style={{ padding: '0.55rem 0.6rem', textAlign: 'right' }}>Tracked Vol.</th>
            </tr>
          </thead>
          <tbody>
            {displayedMdas.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ padding: '1.25rem', textAlign: 'center', color: '#64748b' }}>
                  No agencies match the active scorecard filters.
                </td>
              </tr>
            ) : (
              displayedMdas.map((m, idx) => {
                const gm = getScoreGradeMeta(m.compositeScore);
                const isExpanded = expandedKey === m.mdaKey;
                const enrich = enrichmentByMdaKey.get(m.mdaKey);
                const pillarKeys: MdaPillarKey[] = [
                  'paddingRestraint',
                  'birCapitalExecution',
                  'openBiddingShare',
                  'vendorDiversification',
                  'cashDiscipline',
                ];

                return (
                  <React.Fragment key={m.mdaKey}>
                    <tr
                      onClick={() => setExpandedKey(isExpanded ? null : m.mdaKey)}
                      style={{
                        borderBottom: isExpanded ? 'none' : '1px solid #f1f5f9',
                        cursor: 'pointer',
                        backgroundColor: isExpanded ? '#f0fdf4' : undefined,
                      }}
                    >
                      <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.6rem', color: '#64748b', fontWeight: 700 }}>
                        {idx + 1}
                      </td>
                      <td style={{ padding: '0.55rem 0.6rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          {isExpanded ? <ChevronDown size={14} color="#059669" /> : <ChevronRight size={14} color="#94a3b8" />}
                          <div>
                            <div style={{ fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                              <Building2 size={13} color="#64748b" />
                              <span>{m.mdaName}</span>
                            </div>
                            {m.parentFamilies.length > 0 && (
                              <div className="font-mono" style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '0.1rem' }}>
                                Sector Family: {m.parentFamilies.join(' · ')}
                              </div>
                            )}
                            {enrich && (
                              enrich.flagCount >= 2 ||
                              enrich.hasPersonalOrOpaqueCash ||
                              enrich.eeV3RuleHits > 0 ||
                              enrich.repeatAssetCategories.length > 0 ||
                              enrich.oaugfQueryCount > 0
                            ) && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.28rem', marginTop: '0.28rem' }}>
                                {enrich.flagCount >= 2 && (
                                  <span
                                    className="font-mono"
                                    title={enrich.flagDetails.join(' • ') || enrich.flags.map(formatConvergenceFlagLabel).join(' • ')}
                                    style={{
                                      fontSize: '0.61rem',
                                      fontWeight: 700,
                                      padding: '0.07rem 0.36rem',
                                      borderRadius: '4px',
                                      backgroundColor: enrich.flagCount >= 3 ? '#fef2f2' : '#fffbeb',
                                      color: enrich.flagCount >= 3 ? '#b91c1c' : '#b45309',
                                      border: `1px solid ${enrich.flagCount >= 3 ? '#fecaca' : '#fde68a'}`,
                                    }}
                                  >
                                    {enrich.flagCount >= 3 ? `High-Risk Convergence (${enrich.flagCount} Flags)` : `Convergence (${enrich.flagCount} Flags)`}
                                  </span>
                                )}
                                {enrich.hasPersonalOrOpaqueCash && (
                                  <span
                                    className="font-mono"
                                    style={{
                                      fontSize: '0.61rem',
                                      fontWeight: 700,
                                      padding: '0.07rem 0.36rem',
                                      borderRadius: '4px',
                                      backgroundColor: '#fef2f2',
                                      color: '#991b1b',
                                      border: '1px solid #fecaca',
                                    }}
                                  >
                                    Personal/Opaque Cash
                                  </span>
                                )}
                                {enrich.eeV3RuleHits > 0 && (
                                  <span
                                    className="font-mono"
                                    style={{
                                      fontSize: '0.61rem',
                                      fontWeight: 700,
                                      padding: '0.07rem 0.36rem',
                                      borderRadius: '4px',
                                      backgroundColor: '#f1f5f9',
                                      color: '#0f172a',
                                      border: '1px solid #cbd5e1',
                                    }}
                                  >
                                    28-Yr EE v3: {enrich.eeV3RuleHits.toLocaleString('en-US')} Hits
                                  </span>
                                )}
                                {enrich.repeatAssetCategories.length > 0 && (
                                  <span
                                    className="font-mono"
                                    title={`Repeat physical asset alerts: ${enrich.repeatAssetCategories.join(', ')}`}
                                    style={{
                                      fontSize: '0.61rem',
                                      fontWeight: 700,
                                      padding: '0.07rem 0.36rem',
                                      borderRadius: '4px',
                                      backgroundColor: '#fff7ed',
                                      color: '#c2410c',
                                      border: '1px solid #fed7aa',
                                    }}
                                  >
                                    Repeat Asset ({enrich.repeatAssetCategories.length})
                                  </span>
                                )}
                                {enrich.oaugfQueryCount > 0 && (
                                  <span
                                    className="font-mono"
                                    style={{
                                      fontSize: '0.61rem',
                                      fontWeight: 700,
                                      padding: '0.07rem 0.36rem',
                                      borderRadius: '4px',
                                      backgroundColor: '#fffbeb',
                                      color: '#92400e',
                                      border: '1px solid #fde68a',
                                    }}
                                  >
                                    OAuGF: {enrich.oaugfQueryCount} Queries
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '0.55rem 0.6rem', textAlign: 'center' }}>
                        <span
                          className="font-mono tabular-nums"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.28rem',
                            padding: '0.2rem 0.5rem',
                            borderRadius: '999px',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            backgroundColor: gm.bg,
                            color: gm.color,
                            border: `1px solid ${gm.border}`,
                          }}
                        >
                          {gm.grade} · {m.compositeScore !== null ? m.compositeScore.toFixed(1) : 'N/A'}
                        </span>
                      </td>
                      <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontSize: '0.71rem', color: '#475569' }}>
                        <strong>{m.metricsPresent}/{m.totalExpectedMetrics}</strong>
                        <span style={{ color: '#94a3b8' }}> ({m.activeWeightSum}%)</span>
                      </td>
                      {pillarKeys.map((pk) => {
                        const pv = m.pillars[pk]?.score;
                        const pg = getScoreGradeMeta(pv);
                        return (
                          <td key={pk} className="font-mono tabular-nums" style={{ padding: '0.55rem 0.45rem', textAlign: 'center' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                minWidth: '42px',
                                padding: '0.14rem 0.35rem',
                                borderRadius: '5px',
                                fontSize: '0.69rem',
                                fontWeight: 700,
                                backgroundColor: pv === null ? '#f8fafc' : pg.bg,
                                color: pv === null ? '#94a3b8' : pg.color,
                                border: `1px solid ${pv === null ? '#e2e8f0' : pg.border}`,
                              }}
                            >
                              {pv !== null && pv !== undefined ? pv.toFixed(0) : 'N/A'}
                            </span>
                          </td>
                        );
                      })}
                      <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.6rem', textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>
                        {fmtNairaCompact(m.totalTrackedExposureNaira)}
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr style={{ backgroundColor: '#fafdfb', borderBottom: '1px solid #a7f3d0' }}>
                        <td colSpan={10} style={{ padding: '0.85rem 1rem 1rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.82rem', fontWeight: 700, color: '#0f172a' }}>
                              <ShieldCheck size={15} color="#059669" />
                              <span>
                                5-Pillar Forensic Breakdown — {m.mdaName} ({m.metricsPresent}/{m.totalExpectedMetrics} pillars · Active denominator {m.activeWeightSum}%)
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <span className="font-mono" style={{ fontSize: '0.7rem', color: gm.color, fontWeight: 700 }}>
                                Grade {gm.grade} ({gm.label}) · {m.compositeScore?.toFixed(1) ?? 'N/A'} / 100
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleExportMdaBrief(m, 'pdf');
                                }}
                                disabled={exportingKey !== null}
                                className="editorial-btn-primary"
                                style={{ fontSize: '0.68rem', padding: '0.24rem 0.52rem' }}
                              >
                                <FileText size={11} /> {exportingKey === `${m.mdaKey}:pdf` ? 'PDF...' : 'Brief (PDF)'}
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleExportMdaBrief(m, 'docx');
                                }}
                                disabled={exportingKey !== null}
                                className="editorial-btn"
                                style={{ fontSize: '0.68rem', padding: '0.24rem 0.52rem' }}
                              >
                                <Download size={11} color="#059669" /> {exportingKey === `${m.mdaKey}:docx` ? 'DOCX...' : 'Brief (DOCX)'}
                              </button>
                            </div>
                          </div>

                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fit, minmax(235px, 1fr))',
                              gap: '0.65rem',
                            }}
                          >
                            {payload.pillarDefinitions.map((pd) => {
                              const p = m.pillars[pd.key];
                              const pScore = p?.score ?? null;
                              const pg = getScoreGradeMeta(pScore);
                              const effectiveWeightPct =
                                pScore !== null && m.activeWeightSum > 0
                                  ? ((pd.weight / m.activeWeightSum) * 100).toFixed(0)
                                  : '0';
                              return (
                                <div
                                  key={pd.key}
                                  style={{
                                    backgroundColor: '#ffffff',
                                    border: `1px solid ${pScore === null ? '#e2e8f0' : pg.border}`,
                                    borderRadius: '8px',
                                    padding: '0.7rem 0.85rem',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '0.35rem',
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#0f172a' }}>{pd.label}</span>
                                    <span
                                      className="font-mono tabular-nums"
                                      style={{
                                        fontSize: '0.74rem',
                                        fontWeight: 700,
                                        color: pScore === null ? '#64748b' : pg.color,
                                      }}
                                    >
                                      {pScore !== null ? `${pScore.toFixed(1)}/100` : 'N/A'}
                                    </span>
                                  </div>

                                  <div style={{ width: '100%', height: '5px', backgroundColor: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                                    <div
                                      style={{
                                        width: `${pScore !== null ? Math.min(100, Math.max(0, pScore)) : 0}%`,
                                        height: '100%',
                                        backgroundColor: pScore === null ? '#cbd5e1' : pg.color,
                                      }}
                                    />
                                  </div>

                                  <div className="font-mono" style={{ fontSize: '0.65rem', color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
                                    <span>{pScore !== null ? `Effective wt: ${effectiveWeightPct}%` : p?.status || 'NO_SOURCE_COVERAGE'}</span>
                                    <span>{pd.shortLabel}</span>
                                  </div>

                                  <div style={{ fontSize: '0.7rem', color: '#334155', lineHeight: 1.4 }}>
                                    <ExpandableText text={renderPillarMetricsText(pd.key, m)} maxChars={155} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {enrich && (
                            enrich.flagCount > 0 ||
                            enrich.hasPersonalOrOpaqueCash ||
                            enrich.eeV3RuleHits > 0 ||
                            enrich.repeatAssetCategories.length > 0
                          ) && (
                            <div
                              style={{
                                marginTop: '0.85rem',
                                padding: '0.75rem 0.9rem',
                                backgroundColor: '#f8fafc',
                                border: '1px solid #cbd5e1',
                                borderRadius: '8px',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.45rem' }}>
                                <span style={{ fontSize: '0.76rem', fontWeight: 700, color: '#0f172a' }}>
                                  6-Ledger Convergence, Evidence Engine v3.0 &amp; Repeat Asset Profile
                                </span>
                                <span className="font-mono" style={{ fontSize: '0.68rem', color: '#475569', fontWeight: 700 }}>
                                  {enrich.flagCount} Convergence Flags · {enrich.eeV3RuleHits.toLocaleString('en-US')} EE v3 Hits ({enrich.eeV3CrossLedgerHits.toLocaleString('en-US')} cross-ledger)
                                </span>
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: enrich.flagDetails.length > 0 ? '0.45rem' : 0 }}>
                                {enrich.flags.map((fl) => (
                                  <span
                                    key={fl}
                                    className="font-mono"
                                    style={{
                                      fontSize: '0.64rem',
                                      fontWeight: 700,
                                      padding: '0.12rem 0.42rem',
                                      borderRadius: '4px',
                                      backgroundColor: '#fef2f2',
                                      color: '#b91c1c',
                                      border: '1px solid #fecaca',
                                    }}
                                  >
                                    {formatConvergenceFlagLabel(fl)}
                                  </span>
                                ))}
                                {enrich.hasPersonalOrOpaqueCash && (
                                  <span className="font-mono" style={{ fontSize: '0.64rem', fontWeight: 700, padding: '0.12rem 0.42rem', borderRadius: '4px', backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>
                                    Personal/Opaque Treasury Vouchers Flagged
                                  </span>
                                )}
                                {enrich.repeatAssetCategories.length > 0 && (
                                  <span className="font-mono" style={{ fontSize: '0.64rem', fontWeight: 700, padding: '0.12rem 0.42rem', borderRadius: '4px', backgroundColor: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa' }}>
                                    Repeat Asset Lifespan: {enrich.repeatAssetCategories.map((c) => c.replace(/_/g, ' ')).join(', ')}
                                  </span>
                                )}
                              </div>
                              {enrich.flagDetails.length > 0 && (
                                <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.71rem', color: '#334155', lineHeight: 1.45 }}>
                                  {enrich.flagDetails.map((d, dIdx) => (
                                    <li key={dIdx}>{d}</li>
                                  ))}
                                </ul>
                              )}
                              {enrich.eeV3FlaggedProjects > 0 && (
                                <div className="font-mono" style={{ fontSize: '0.67rem', color: '#475569', marginTop: '0.35rem' }}>
                                  28-Year Cumulative Rule Exposure (1999–2026): {enrich.eeV3FlaggedProjects.toLocaleString('en-US')} flagged items ({fmtNairaCompact(enrich.eeV3FlaggedAmountNaira)})
                                </div>
                              )}
                            </div>
                          )}

                          {(() => {
                            const oaugfMda = lookupOaugfMdaFindings(oaugfIndex, m.mdaName);
                            if (!oaugfMda || oaugfMda.findingCount === 0) return null;
                            return (
                              <div
                                style={{
                                  marginTop: '0.85rem',
                                  padding: '0.75rem 0.9rem',
                                  backgroundColor: '#fffbeb',
                                  border: '1px solid #fde68a',
                                  borderRadius: '8px',
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.5rem' }}>
                                  <span style={{ fontSize: '0.76rem', fontWeight: 700, color: '#92400e' }}>
                                    Official OAuGF Constitutional Audit Findings — {oaugfMda.findingCount} parsed query citation(s) ({oaugfMda.reportYears.join(', ')})
                                  </span>
                                  {oaugfMda.totalFlaggedNaira > 0 && (
                                    <span className="font-mono tabular-nums" style={{ fontSize: '0.7rem', fontWeight: 700, color: '#b45309' }}>
                                      Referenced Amounts: {fmtNairaCompact(oaugfMda.totalFlaggedNaira)}
                                    </span>
                                  )}
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                                  {oaugfMda.sampleFindings.slice(0, 3).map((sf, sIdx) => (
                                    <div
                                      key={sIdx}
                                      style={{
                                        backgroundColor: '#ffffff',
                                        border: '1px solid #fef3c7',
                                        borderRadius: '6px',
                                        padding: '0.5rem 0.65rem',
                                        fontSize: '0.72rem',
                                      }}
                                    >
                                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.2rem' }}>
                                        <span style={{ fontWeight: 700, color: '#0f172a' }}>{sf.heading}</span>
                                        <span className="font-mono" style={{ fontSize: '0.67rem', color: '#64748b' }}>
                                          {sf.docTitle} · p.{sf.page} · {sf.category}
                                        </span>
                                      </div>
                                      {sf.excerpt && (
                                        <div style={{ color: '#475569', lineHeight: 1.4 }}>
                                          <ExpandableText text={sf.excerpt} maxChars={160} />
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer Pagination / Caveat */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', fontSize: '0.73rem', color: '#64748b' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <AlertTriangle size={13} color="#d97706" />
          <span>
            Showing {displayedMdas.length} of {filteredMdas.length} matching MDAs (missing BIR/NOCOPO/GovSpend coverage never penalizes an MDA with 0).
          </span>
        </div>

        {filteredMdas.length > displayedMdas.length && (
          <button
            type="button"
            onClick={() => setVisibleLimit((prev) => prev + 50)}
            className="editorial-btn"
            style={{ fontSize: '0.72rem', padding: '0.32rem 0.7rem' }}
          >
            Show 50 More MDAs ({filteredMdas.length - displayedMdas.length} remaining)
          </button>
        )}
      </div>
    </section>
  );
};
