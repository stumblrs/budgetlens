import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Coins, Flag, FolderKanban } from 'lucide-react';
import { useBudgetDatabase } from '../context/BudgetDatabaseContext';
import { getPresidentForYear } from '../data/presidentialTerms';
import { getMacroForYear } from '../data/historicalMacroData';
import { PresidentAvatar } from './PresidentAvatar';
import type { YearNarrativeDossier } from './MacroNarrativeBrief';
import {
  getCoverageCaveatMeta,
  loadCoverageAuditIndex,
  type CoverageAuditIndexPayload,
  type CoverageAuditYearLike,
} from '../utils/displayText';

interface HeaderStatsProps {
  financialYear: number;
  totalProjects?: number;
  totalAmount?: number;
  priorAmount?: number;
  evidenceItemsCount?: number;
  compoundProjectsCount?: number;
  crossLedgerFindingsCount?: number;
  onNavigateTab?: (tab: string) => void;
}

export const HeaderStats: React.FC<HeaderStatsProps> = ({
  financialYear,
  totalProjects: propProjects,
  totalAmount: propAmount,
  priorAmount: propPrior,
  evidenceItemsCount,
  compoundProjectsCount,
  crossLedgerFindingsCount,
  onNavigateTab,
}) => {
  const { summary, activeYear, records, registryDocs } = useBudgetDatabase();
  const effectiveYear = financialYear || activeYear;
  const yearKey = String(effectiveYear);
  const priorYearKey = String(effectiveYear - 1);

  const yearStats = summary?.yearSummaries[yearKey];
  const priorStats = summary?.yearSummaries[priorYearKey];

  const totalAmount = propAmount || yearStats?.totalAmountNaira || 0;
  const totalProjects = propProjects || yearStats?.recordCount || records.length || 0;
  const priorAmount = propPrior || priorStats?.totalAmountNaira;

  const president = getPresidentForYear(effectiveYear);
  const historicalMacro = getMacroForYear(effectiveYear);
  const [narrative, setNarrative] = useState<YearNarrativeDossier | null>(null);
  const [yearDebt, setYearDebt] = useState<{ totalDebtNairaM?: number | null; totalDebtUsdM?: number | null } | null>(null);
  const [coverageAudit, setCoverageAudit] = useState<CoverageAuditIndexPayload | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/datasets/narratives/${effectiveYear}.json`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: YearNarrativeDossier | null) => {
        if (active) setNarrative(data);
      })
      .catch(() => {
        if (active) setNarrative(null);
      });
    fetch('/datasets/debt_profile.json', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { yearlyDebt?: Array<{ financialYear: number; totalDebtNairaM?: number | null; totalDebtUsdM?: number | null }> } | null) => {
        if (!active || !data?.yearlyDebt) return;
        const match = data.yearlyDebt.find((d) => d.financialYear === effectiveYear) || null;
        setYearDebt(match);
      })
      .catch(() => {
        if (active) setYearDebt(null);
      });
    loadCoverageAuditIndex().then((audit) => {
      if (active && audit) setCoverageAudit(audit);
    });
    return () => {
      active = false;
    };
  }, [effectiveYear]);

  const activeRegDoc = useMemo(
    () =>
      registryDocs.find(
        (d) => (d.financial_year || d.financialYear) === effectiveYear
      ) || null,
    [registryDocs, effectiveYear]
  );

  const mergedCoverage = useMemo<CoverageAuditYearLike>(() => {
    const auditYear = coverageAudit?.years?.[yearKey];
    return {
      ...(activeRegDoc || {}),
      ...(auditYear || {}),
      project_count:
        auditYear?.extracted_count ??
        activeRegDoc?.project_count ??
        activeRegDoc?.extractedProjectsCount ??
        totalProjects,
    };
  }, [activeRegDoc, coverageAudit, yearKey, totalProjects]);

  const coverageMeta = useMemo(
    () => getCoverageCaveatMeta(effectiveYear, mergedCoverage),
    [effectiveYear, mergedCoverage]
  );

  const computedMetrics = useMemo(() => {
    const recCount = records.length;
    if (recCount === 0) {
      return {
        evidenceCount: evidenceItemsCount ?? 0,
        infraCount: 0,
        adminCount: 0,
      };
    }

    let flagged = 0;
    let infra = 0;
    let admin = 0;
    for (const r of records) {
      if ((r.forensicEvidenceFlags?.length || 0) > 0) flagged++;
      const sec = (r.mdaGovernanceTaxonomy?.sector || '').toLowerCase();
      const sType = (r.recordIdentity?.spendingType || '').toUpperCase();
      if (
        sType === 'OVERHEAD' ||
        sType === 'PERSONNEL' ||
        sec.includes('administration') ||
        sec.includes('finance') ||
        sec.includes('legislature')
      ) {
        admin++;
      } else {
        infra++;
      }
    }

    return {
      evidenceCount: evidenceItemsCount ?? flagged,
      infraCount: infra,
      adminCount: admin,
    };
  }, [records, evidenceItemsCount]);

  const evidencePct = totalProjects > 0 ? ((computedMetrics.evidenceCount / totalProjects) * 100).toFixed(1) : '0.0';
  const infraPct = totalProjects > 0 ? ((computedMetrics.infraCount / totalProjects) * 100).toFixed(1) : '0.0';
  const adminPct = totalProjects > 0 ? ((computedMetrics.adminCount / totalProjects) * 100).toFixed(1) : '0.0';

  const formatNairaCompact = (amt?: number) => {
    if (amt === undefined || amt === null || Number.isNaN(amt) || amt === 0) return '₦0';
    if (amt >= 1e12) return `₦${(amt / 1e12).toFixed(2)}T`;
    if (amt >= 1e9) return `₦${(amt / 1e9).toFixed(2)}B`;
    if (amt >= 1e6) return `₦${(amt / 1e6).toFixed(1)}M`;
    return `₦${amt.toLocaleString('en-US')}`;
  };

  const getYoYDelta = () => {
    if (!priorAmount || priorAmount === 0) return null;
    const diff = ((totalAmount - priorAmount) / priorAmount) * 100;
    const sign = diff >= 0 ? '+' : '';
    return {
      text: `${sign}${diff.toFixed(1)}% vs FY ${priorYearKey}`,
      positive: diff >= 0,
    };
  };

  const yoy = getYoYDelta();
  const macro = narrative?.macroeconomicFramework;
  const oilBench = macro?.benchmarkOilPriceUSD;
  const fxBench = macro?.exchangeRateNairaPerUSD ?? historicalMacro?.fxNairaPerUsd;
  const enactedTotal = historicalMacro?.officialTotalBudget;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.25rem' }}>
      {/* Editorial Fiscal Dossier Masthead */}
      <section className="dossier-card header-masthead">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: '1 1 min(100%, 340px)', minWidth: 0 }}>
          <PresidentAvatar
            src={president.portraitPath}
            name={president.presidentName}
            initials={president.initials}
            accentColor={president.accentColor}
            size={56}
            party={president.party}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.28rem', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
              <span
                className="font-mono"
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--accent-primary)',
                }}
              >
                Federal Fiscal Dossier · FY {effectiveYear}
              </span>
              <span
                style={{
                  fontSize: '0.7rem',
                  padding: '0.1rem 0.45rem',
                  borderRadius: '4px',
                  backgroundColor: 'var(--bg-canvas)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)',
                  fontWeight: 600,
                }}
              >
                {president.presidentName} · {president.party}
              </span>
              <span
                className="editorial-pill font-mono"
                title={coverageMeta.detail}
                style={{
                  fontSize: '0.67rem',
                  padding: '0.1rem 0.48rem',
                  backgroundColor: coverageMeta.bg,
                  color: coverageMeta.color,
                  border: `1px solid ${coverageMeta.border}`,
                  fontWeight: 700,
                }}
              >
                {coverageMeta.label}
              </span>
            </div>
            <h1 className="font-editorial header-masthead-title">
              {narrative?.budgetTheme || president.economicAgenda}
            </h1>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {president.termLabel} ({president.tenureSpan})
            </div>
            {(coverageMeta.tier !== 'FULL_SCHEDULE' ||
              coverageMeta.partialLedgerNotes.length > 0 ||
              Boolean(mergedCoverage.over_100_pct_flag)) && (
              <div
                style={{
                  fontSize: '0.72rem',
                  lineHeight: 1.4,
                  color: coverageMeta.tier === 'FULL_SCHEDULE' ? 'var(--text-muted)' : coverageMeta.color,
                  marginTop: '0.12rem',
                }}
              >
                {coverageMeta.detail}
              </div>
            )}
          </div>
        </div>

        {/* Right Macro & Enacted Reference Strip */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          {enactedTotal ? (
            <div
              style={{
                padding: '0.5rem 0.85rem',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-canvas)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.15rem',
              }}
            >
              <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                Enacted Aggregate
              </span>
              <span className="font-mono tabular-nums" style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {formatNairaCompact(enactedTotal)}
              </span>
            </div>
          ) : null}

          {oilBench ? (
            <div
              style={{
                padding: '0.5rem 0.85rem',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-canvas)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.15rem',
              }}
            >
              <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                Oil Bench
              </span>
              <span className="font-mono tabular-nums" style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                ${oilBench}/bbl
              </span>
            </div>
          ) : null}

          {fxBench ? (
            <div
              style={{
                padding: '0.5rem 0.85rem',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-canvas)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.15rem',
              }}
            >
              <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                FX Rate
              </span>
              <span className="font-mono tabular-nums" style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                ₦{fxBench.toLocaleString('en-US')}/$
              </span>
            </div>
          ) : null}

          {yearDebt?.totalDebtNairaM ? (
            <div
              style={{
                padding: '0.5rem 0.85rem',
                borderRadius: '8px',
                backgroundColor: '#fffbeb',
                border: '1px solid #fde68a',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.15rem',
              }}
            >
              <span style={{ fontSize: '0.66rem', color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
                DMO Public Debt
              </span>
              <span className="font-mono tabular-nums" style={{ fontSize: '0.95rem', fontWeight: 700, color: '#78350f' }}>
                ₦{(yearDebt.totalDebtNairaM / 1e6).toFixed(2)}T
                {yearDebt.totalDebtUsdM ? ` ($${(yearDebt.totalDebtUsdM / 1e3).toFixed(1)}B)` : ''}
              </span>
            </div>
          ) : null}
        </div>
      </section>

      {/* 4-Column Authoritative KPI Strip */}
      <div className="grid-4-cols">
        {/* KPI 1: Extracted Budget Envelope */}
        <div className="dossier-card" style={{ padding: '1.15rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
          <div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              Extracted Envelope
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.45rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0.35rem 0 0.25rem' }}>
              {formatNairaCompact(totalAmount)}
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '0.74rem', color: yoy ? (yoy.positive ? 'var(--accent-primary)' : '#b45309') : 'var(--text-muted)', fontWeight: 600 }}>
              {yoy ? yoy.text : `FY ${effectiveYear} appropriation`}
            </div>
          </div>
          <div style={{ width: '36px', height: '36px', borderRadius: '8px', backgroundColor: '#ecfdf5', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Coins size={18} />
          </div>
        </div>

        {/* KPI 2: Verified Line Items */}
        <div
          className="dossier-card"
          onClick={() => onNavigateTab?.('projects')}
          style={{
            padding: '1.15rem 1.25rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '0.75rem',
            cursor: onNavigateTab ? 'pointer' : 'default',
          }}
          title="Click to browse Capital Projects Directory"
        >
          <div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              Verified Line Items
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.45rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0.35rem 0 0.25rem' }}>
              {totalProjects.toLocaleString('en-US')}
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              Across federal MDAs &amp; schedules
            </div>
          </div>
          <div style={{ width: '36px', height: '36px', borderRadius: '8px', backgroundColor: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <FolderKanban size={18} />
          </div>
        </div>

        {/* KPI 3: Capital vs Recurrent Split */}
        <div
          className="dossier-card"
          onClick={() => onNavigateTab?.('agencies')}
          style={{
            padding: '1.15rem 1.25rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '0.75rem',
            cursor: onNavigateTab ? 'pointer' : 'default',
          }}
          title="Click to view Ministries, MDAs & 5-Pillar Integrity Scorecards"
        >
          <div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              Capital vs. Recurrent
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.45rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0.35rem 0 0.25rem' }}>
              {infraPct}% / {adminPct}%
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              {computedMetrics.infraCount.toLocaleString('en-US')} cap · {computedMetrics.adminCount.toLocaleString('en-US')} admin
            </div>
          </div>
          <div style={{ width: '36px', height: '36px', borderRadius: '8px', backgroundColor: '#f5f3ff', color: '#6d28d9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Building2 size={18} />
          </div>
        </div>

        {/* KPI 4: Forensic Review Flags */}
        <div
          className="dossier-card"
          onClick={() => onNavigateTab?.('evidence')}
          style={{
            padding: '1.15rem 1.25rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '0.75rem',
            cursor: onNavigateTab ? 'pointer' : 'default',
          }}
          title="Click to open Evidence Engine v3.0 & Rule Matrix"
        >
          <div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              Forensic Flags (22 Rules)
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.45rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0.35rem 0 0.25rem' }}>
              {computedMetrics.evidenceCount.toLocaleString('en-US')}
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '0.72rem', color: '#b45309', fontWeight: 600 }}>
              {compoundProjectsCount !== undefined && compoundProjectsCount > 0
                ? `${compoundProjectsCount.toLocaleString('en-US')} flagged projects · ${(crossLedgerFindingsCount ?? 0).toLocaleString('en-US')} cross-ledger`
                : `${evidencePct}% match audit rules`}
            </div>
          </div>
          <div style={{ width: '36px', height: '36px', borderRadius: '8px', backgroundColor: '#fffbeb', color: 'var(--accent-amber)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Flag size={18} />
          </div>
        </div>
      </div>
    </div>
  );
};
