import React, { useEffect, useMemo, useState } from 'react';
import { datasetUrl } from '../services/apiClient';
import {
  AlertTriangle,
  ArrowUpRight,
  Layers,
  Scale,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import type { CompoundFlaggedProject } from '../utils/ruleEngine';
import type { EvidenceEngineAllYearsPayload } from '../utils/evidenceEngineV3';
import { getPresidentForYear } from '../data/presidentialTerms';
import { ExpandableText } from './ExpandableText';

interface OverviewCrossLedgerWidgetProps {
  financialYear: number;
  evidenceItemsCount: number;
  compoundProjects: CompoundFlaggedProject[];
  evidenceAllYears: EvidenceEngineAllYearsPayload | null;
  onNavigateTab: (tab: string) => void;
  onSelectProject?: (project: any) => void;
}

interface BillActCycleRow {
  financialYear: number;
  comparisonScope: string;
  insertionsCount: number;
  insertionsTotalNaira: number;
  inflatedCount: number;
  inflatedTotalNaira: number;
  zipCount: number;
  zipTotalNaira: number;
}

interface GovSpendYearRow {
  financialYear: number;
  totalNaira: number;
  decemberVoucherCount: number;
  decemberNaira: number;
  decemberSharePct: number;
  decemberRushRatio: number | null;
}

interface MacroYearRow {
  financialYear: number;
  overallReleasePct: number | null;
  overallUtilizationPct: number | null;
  realized?: {
    cbnFxRateNairaPerUsd?: number | null;
    fxSlippagePct?: number | null;
    totalDebtNairaM?: number | null;
    totalDebtUsdM?: number | null;
  };
  bir?: {
    capitalPerformancePct?: number | null;
    debtServicePerformancePct?: number | null;
    debtServiceOverrunFlag?: boolean;
    debtServiceOverrunNaira?: number;
    debtServiceToRevenuePct?: number | null;
  };
}

interface ForensicSweepSummaryMini {
  headlineMetrics?: {
    combinedScrutinyExposure: number;
    combinedScrutinyUsd: number;
    combinedScheduledBudgetSharePct: number;
    uniqueFlaggedCapitalLines: number;
    crossLedgerTotals?: {
      oaugfReportsIndexed: number;
      oaugfParsedIssuesCount: number;
      oaugfRepeatNeglectCount: number;
      oaugfRecoveryDirectiveCount: number;
      billActCyclesCount: number;
      billActInsertionsCount: number;
      billActInsertionsNaira: number;
      openTreasuryVouchersCount: number;
      openTreasuryTotalNaira: number;
      openTreasuryPersonalAccountBeneficiaries: number;
      openTreasuryPersonalAccountNaira: number;
      openTreasuryOpaqueDiscretionaryVouchers: number;
      openTreasuryOpaqueDiscretionaryNaira: number;
      nocopoAwardedContractsAnalyzed: number;
      nocopoAwardedTotalNaira: number;
      nocopoNonCompetitiveNaira: number;
      nocopoVariationOverrunsNaira: number;
    };
  };
  presidents?: Array<{
    presidentId: string;
    shortName: string;
    combinedNominal: number;
    combinedUsd: number;
    combinedBudgetSharePct: number;
    uniqueFlaggedCapitalLines: number;
    crossLedgerProfile?: {
      oaugf: {
        reportsCount: number;
        issuesCount: number;
        repeatNeglectCount: number;
        recoveryDirectiveCount: number;
        totalQueriedNaira: number;
      };
    };
  }>;
  yearlyTimeline?: Array<{
    financialYear: number;
    uniqueFlaggedLines: number;
    combinedNominal: number;
    combinedUsd: number;
    combinedBudgetSharePct: number;
  }>;
}

function fmtNaira(amt?: number | null): string {
  if (!amt || Number.isNaN(amt)) return '₦0';
  if (amt >= 1e12) return `₦${(amt / 1e12).toFixed(2)}T`;
  if (amt >= 1e9) return `₦${(amt / 1e9).toFixed(2)}B`;
  if (amt >= 1e6) return `₦${(amt / 1e6).toFixed(1)}M`;
  return `₦${Math.round(amt).toLocaleString()}`;
}

function fmtUsd(amt?: number | null): string {
  if (!amt || Number.isNaN(amt)) return '$0';
  if (amt >= 1e9) return `$${(amt / 1e9).toFixed(2)}B`;
  if (amt >= 1e6) return `$${(amt / 1e6).toFixed(2)}M`;
  if (amt >= 1e3) return `$${(amt / 1e3).toFixed(1)}K`;
  return `$${Math.round(amt).toLocaleString()}`;
}

export const OverviewCrossLedgerWidget: React.FC<OverviewCrossLedgerWidgetProps> = ({
  financialYear,
  evidenceItemsCount,
  compoundProjects,
  evidenceAllYears,
  onNavigateTab,
  onSelectProject,
}) => {
  const [billCycleMap, setBillCycleMap] = useState<Record<number, BillActCycleRow>>({});
  const [govSpendYearMap, setGovSpendYearMap] = useState<Record<number, GovSpendYearRow>>({});
  const [macroYearMap, setMacroYearMap] = useState<Record<number, MacroYearRow>>({});
  const [sweepMini, setSweepMini] = useState<ForensicSweepSummaryMini | null>(null);
  const [oaugfYearCountMap, setOaugfYearCountMap] = useState<Record<number, { issues: number; docs: number }>>({});

  useEffect(() => {
    let active = true;

    fetch(datasetUrl('/datasets/bill_act_diffs/index.json'))
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!active || !json?.cycles) return;
        const map: Record<number, BillActCycleRow> = {};
        for (const c of json.cycles) {
          map[Number(c.financialYear)] = c;
        }
        setBillCycleMap(map);
      })
      .catch(() => {});

    fetch(datasetUrl('/datasets/govspend_forensics.json'))
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!active || !json?.decemberRush?.yearlyRush) return;
        const map: Record<number, GovSpendYearRow> = {};
        for (const row of json.decemberRush.yearlyRush) {
          map[Number(row.financialYear)] = row;
        }
        setGovSpendYearMap(map);
      })
      .catch(() => {});

    fetch(datasetUrl('/datasets/macro_credibility_tracker.json'))
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!active || !json?.yearlySeries) return;
        const map: Record<number, MacroYearRow> = {};
        for (const row of json.yearlySeries) {
          map[Number(row.financialYear)] = row;
        }
        setMacroYearMap(map);
      })
      .catch(() => {});

    fetch(datasetUrl('/datasets/forensic_sweep_1999_2026.json'))
      .then((r) => (r.ok ? r.json() : null))
      .then((json: ForensicSweepSummaryMini | null) => {
        if (active && json) setSweepMini(json);
      })
      .catch(() => {});

    fetch(datasetUrl('/datasets/oaugf_audit_index.json'))
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!active || !json?.documents) return;
        const map: Record<number, { issues: number; docs: number }> = {};
        for (const doc of json.documents) {
          const yrs: number[] = doc.years || [];
          const issCount = Number(doc.issueCount || 0);
          for (const y of yrs) {
            const yrNum = Number(y);
            if (!map[yrNum]) map[yrNum] = { issues: 0, docs: 0 };
            map[yrNum].docs += 1;
            map[yrNum].issues += Math.round(issCount / Math.max(1, yrs.length));
          }
        }
        setOaugfYearCountMap(map);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  const president = getPresidentForYear(financialYear);
  const eeYearRow = useMemo(
    () => evidenceAllYears?.byYear.find((y) => y.financialYear === financialYear) || null,
    [evidenceAllYears, financialYear]
  );
  const sweepYearRow = useMemo(
    () => sweepMini?.yearlyTimeline?.find((y) => y.financialYear === financialYear) || null,
    [sweepMini, financialYear]
  );
  const sweepPresRow = useMemo(
    () => sweepMini?.presidents?.find((p) => p.presidentId === president.presidentId) || null,
    [sweepMini, president.presidentId]
  );

  const billCycle = billCycleMap[financialYear] || null;
  const gsYear = govSpendYearMap[financialYear] || null;
  const macroYear = macroYearMap[financialYear] || null;
  const oaugfYear = oaugfYearCountMap[financialYear] || null;
  const crossTotals = sweepMini?.headlineMetrics?.crossLedgerTotals;

  const topCompoundItems = useMemo(() => {
    return [...compoundProjects]
      .sort(
        (a, b) =>
          b.compoundRiskScore - a.compoundRiskScore ||
          b.crossLedgerRuleCount - a.crossLedgerRuleCount ||
          b.amount - a.amount
      )
      .slice(0, 5);
  }, [compoundProjects]);

  const crossLedgerCountInYear =
    eeYearRow?.crossLedgerFindingsCount ??
    compoundProjects.reduce((acc, p) => acc + p.crossLedgerRuleCount, 0);

  return (
    <section
      className="dossier-card"
      style={{
        padding: '1.35rem 1.55rem',
        marginBottom: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.15rem',
      }}
      aria-label={`FY ${financialYear} 6-Ledger Forensic & Accountability Command Center`}
    >
      {/* 1. Header Strip */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '0.85rem',
          paddingBottom: '0.9rem',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
            <Layers size={15} color="#059669" />
            <span
              className="font-mono"
              style={{
                fontSize: '0.7rem',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: '#059669',
              }}
            >
              6-Ledger Cross-Join Command Center · FY {financialYear} &amp; Fourth Republic Baseline
            </span>
            <span
              className="font-mono"
              style={{
                fontSize: '0.66rem',
                fontWeight: 700,
                padding: '0.12rem 0.48rem',
                borderRadius: '4px',
                backgroundColor: '#ecfdf5',
                color: '#065f46',
                border: '1px solid #a7f3d0',
              }}
            >
              22 Forensic Rules · 1999–2026 Indexed
            </span>
          </div>
          <h2
            className="font-editorial"
            style={{
              margin: 0,
              fontSize: '1.32rem',
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            Multi-Ledger Accountability Pulse: Appropriation, Padding, Treasury Cash, Contracts &amp; Constitutional Audits
          </h2>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.77rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Synthesizes FY {financialYear} ({president.presidentName}) across all 6 verified public ledgers alongside the{' '}
            <strong>{fmtNaira(sweepMini?.headlineMetrics?.combinedScrutinyExposure ?? 24570000000000)}</strong> (
            <strong>{fmtUsd(sweepMini?.headlineMetrics?.combinedScrutinyUsd ?? 37030000000)}</strong> historical US$) Fourth Republic scrutiny baseline.
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
          <button
            type="button"
            onClick={() => onNavigateTab('scrutiny')}
            className="editorial-btn-primary"
            style={{ fontSize: '0.73rem' }}
          >
            <Scale size={13} />
            Presidential Scrutiny ({fmtNaira(sweepMini?.headlineMetrics?.combinedScrutinyExposure ?? 24570000000000)})
          </button>
          <button
            type="button"
            onClick={() => onNavigateTab('oaugf')}
            className="editorial-btn"
            style={{ fontSize: '0.73rem' }}
          >
            <ShieldAlert size={13} color="#b45309" />
            OAuGF Audits ({(crossTotals?.oaugfParsedIssuesCount ?? 7028).toLocaleString()})
          </button>
          <button
            type="button"
            onClick={() => onNavigateTab('evidence')}
            className="editorial-btn"
            style={{ fontSize: '0.73rem' }}
          >
            <Sparkles size={13} color="#059669" />
            Evidence Engine v3.0
          </button>
        </div>
      </div>

      {/* 2. 6-Ledger Live Telemetry Cards (FY Scoped + All-Years Context) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(245px, 1fr))',
          gap: '0.75rem',
        }}
      >
        {/* Card 1: Evidence Engine v3.0 & Presidential Scrutiny */}
        <div
          onClick={() => onNavigateTab('evidence')}
          style={{
            padding: '0.85rem 1rem',
            borderRadius: '9px',
            backgroundColor: '#f8fafc',
            border: '1px solid var(--border-subtle)',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '0.4rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="font-mono" style={{ fontSize: '0.66rem', fontWeight: 700, color: '#047857', textTransform: 'uppercase' }}>
              1. Evidence Engine v3.0 (FY {financialYear})
            </span>
            <ArrowUpRight size={14} color="#047857" />
          </div>
          <div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {(eeYearRow?.ruleFindingsCount ?? evidenceItemsCount).toLocaleString()} Rule Hits
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '0.72rem', color: '#047857', fontWeight: 600 }}>
              {crossLedgerCountInYear.toLocaleString()} cross-ledger · {(eeYearRow?.flaggedProjectsCount ?? compoundProjects.length).toLocaleString()} flagged projects
            </div>
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
            28-Yr Corpus: <strong>{(evidenceAllYears?.summary.totalRuleFindings ?? 49679).toLocaleString()}</strong> hits across{' '}
            <strong>{(evidenceAllYears?.summary.totalFlaggedProjects ?? 28681).toLocaleString()}</strong> projects (22 rules).
          </div>
        </div>

        {/* Card 2: OAuGF Constitutional Audit Negligence */}
        <div
          onClick={() => onNavigateTab('oaugf')}
          style={{
            padding: '0.85rem 1rem',
            borderRadius: '9px',
            backgroundColor: '#fffbeb',
            border: '1px solid #fde68a',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '0.4rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="font-mono" style={{ fontSize: '0.66rem', fontWeight: 700, color: '#b45309', textTransform: 'uppercase' }}>
              2. OAuGF Constitutional Audits
            </span>
            <ArrowUpRight size={14} color="#b45309" />
          </div>
          <div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.15rem', fontWeight: 700, color: '#92400e' }}>
              {oaugfYear
                ? `FY ${financialYear}: ${oaugfYear.issues.toLocaleString()} Queries`
                : `${president.shortName}: ${(sweepPresRow?.crossLedgerProfile?.oaugf.issuesCount ?? 0).toLocaleString()} Queries`}
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '0.72rem', color: '#b45309', fontWeight: 600 }}>
              {sweepPresRow?.crossLedgerProfile?.oaugf
                ? `${sweepPresRow.crossLedgerProfile.oaugf.recoveryDirectiveCount} recovery orders · ${sweepPresRow.crossLedgerProfile.oaugf.repeatNeglectCount} repeat neglected`
                : '675 recovery orders · 54 repeat neglected'}
            </div>
          </div>
          <div style={{ fontSize: '0.68rem', color: '#78350f' }}>
            1999–2024 Total: <strong>{(crossTotals?.oaugfParsedIssuesCount ?? 7028).toLocaleString()}</strong> constitutional audit findings across{' '}
            <strong>{crossTotals?.oaugfReportsIndexed ?? 36}</strong> reports.
          </div>
        </div>

        {/* Card 3: Legislative Bill-vs-Act Padding Diff */}
        <div
          onClick={() => onNavigateTab('padding')}
          style={{
            padding: '0.85rem 1rem',
            borderRadius: '9px',
            backgroundColor: '#f5f3ff',
            border: '1px solid #ddd6fe',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '0.4rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="font-mono" style={{ fontSize: '0.66rem', fontWeight: 700, color: '#6d28d9', textTransform: 'uppercase' }}>
              3. Legislative Bill&rarr;Act Padding
            </span>
            <ArrowUpRight size={14} color="#6d28d9" />
          </div>
          <div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.15rem', fontWeight: 700, color: '#4c1d95' }}>
              {billCycle
                ? `+${fmtNaira(billCycle.insertionsTotalNaira)} Inserted`
                : '7 Diff Cycles (2017–2025)'}
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '0.72rem', color: '#6d28d9', fontWeight: 600 }}>
              {billCycle
                ? `FY ${financialYear}: ${billCycle.insertionsCount.toLocaleString()} insertions · ${billCycle.inflatedCount.toLocaleString()} markups`
                : `${(crossTotals?.billActInsertionsCount ?? 115658).toLocaleString()} inserted lines (+${fmtNaira(crossTotals?.billActInsertionsNaira ?? 52710000000000)})`}
            </div>
          </div>
          <div style={{ fontSize: '0.68rem', color: '#5b21b6' }}>
            Compares Executive Appropriation Bills vs. Enacted Acts line-by-line to isolate legislative insertions.
          </div>
        </div>

        {/* Card 4: Open Treasury Cash & Personal/Opaque Vouchers */}
        <div
          onClick={() => onNavigateTab('forensics')}
          style={{
            padding: '0.85rem 1rem',
            borderRadius: '9px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '0.4rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="font-mono" style={{ fontSize: '0.66rem', fontWeight: 700, color: '#b91c1c', textTransform: 'uppercase' }}>
              4. Open Treasury Cash Forensics
            </span>
            <ArrowUpRight size={14} color="#b91c1c" />
          </div>
          <div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.15rem', fontWeight: 700, color: '#7f1d1d' }}>
              {gsYear
                ? `FY ${financialYear}: ${fmtNaira(gsYear.totalNaira)} Cash`
                : '₦1.49T Personal · ₦2.44T Opaque'}
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '0.72rem', color: '#b91c1c', fontWeight: 600 }}>
              {gsYear
                ? `Dec Rush: ${fmtNaira(gsYear.decemberNaira)} (${gsYear.decemberRushRatio ? `${gsYear.decemberRushRatio}x Jan-Nov` : `${gsYear.decemberSharePct}%`})`
                : '10,851 personal bank payees · 33,366 opaque vouchers'}
            </div>
          </div>
          <div style={{ fontSize: '0.68rem', color: '#991b1b' }}>
            2018–2026 Ledger: <strong>467,763</strong> daily treasury vouchers (<strong>₦47.53T</strong>) &amp; <strong>₦1.49T</strong> to personal accounts.
          </div>
        </div>

        {/* Card 5: NOCOPO Procurement & Paid-on-Paper Lifecycle */}
        <div
          onClick={() => onNavigateTab('execution')}
          style={{
            padding: '0.85rem 1rem',
            borderRadius: '9px',
            backgroundColor: '#eff6ff',
            border: '1px solid #bfdbfe',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '0.4rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="font-mono" style={{ fontSize: '0.66rem', fontWeight: 700, color: '#1d4ed8', textTransform: 'uppercase' }}>
              5. Procurement &amp; Paid-on-Paper
            </span>
            <ArrowUpRight size={14} color="#1d4ed8" />
          </div>
          <div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1e3a8a' }}>
              ₦4.38T Awarded (16,726 Contracts)
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '0.72rem', color: '#1d4ed8', fontWeight: 600 }}>
              ₦1.31T non-competitive · +₦939.85B variation overruns
            </div>
          </div>
          <div style={{ fontSize: '0.68rem', color: '#1e40af' }}>
            <strong>3,096</strong> Paid-on-Paper projects linked across Budget &rarr; Contract &rarr; Cash for citizen site verification.
          </div>
        </div>

        {/* Card 6: BIR Execution & DMO Sovereign Debt */}
        <div
          onClick={() => onNavigateTab('scrutiny')}
          style={{
            padding: '0.85rem 1rem',
            borderRadius: '9px',
            backgroundColor: '#f8fafc',
            border: '1px solid var(--border-subtle)',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '0.4rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="font-mono" style={{ fontSize: '0.66rem', fontWeight: 700, color: '#0f172a', textTransform: 'uppercase' }}>
              6. BIR Execution &amp; DMO Debt
            </span>
            <ArrowUpRight size={14} color="#0f172a" />
          </div>
          <div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {macroYear?.bir?.capitalPerformancePct !== null && macroYear?.bir?.capitalPerformancePct !== undefined
                ? `FY ${financialYear} Cap Exec: ${macroYear.bir.capitalPerformancePct.toFixed(1)}%`
                : sweepYearRow
                ? `FY ${financialYear} Scrutiny: ${fmtNaira(sweepYearRow.combinedNominal)}`
                : '18 BIR Years · 23 DMO Debt Yrs'}
            </div>
            <div
              className="font-mono tabular-nums"
              style={{
                fontSize: '0.72rem',
                color: macroYear?.bir?.debtServiceOverrunFlag ? '#b91c1c' : '#047857',
                fontWeight: 600,
              }}
            >
              {macroYear?.bir?.debtServicePerformancePct !== null && macroYear?.bir?.debtServicePerformancePct !== undefined
                ? `Debt Svc Exec: ${macroYear.bir.debtServicePerformancePct.toFixed(1)}%${
                    macroYear.bir.debtServiceOverrunFlag ? ` (+${fmtNaira(macroYear.bir.debtServiceOverrunNaira)} overrun)` : ''
                  }`
                : sweepYearRow
                ? `${sweepYearRow.combinedBudgetSharePct.toFixed(2)}% of FY ${financialYear} budget (${sweepYearRow.uniqueFlaggedLines.toLocaleString()} flags)`
                : 'Mean Capital 53.5% vs. Debt Svc 107.6%'}
            </div>
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
            {macroYear?.realized?.totalDebtNairaM
              ? `FY ${financialYear} DMO Debt: ₦${(macroYear.realized.totalDebtNairaM / 1e6).toFixed(2)}T ($${((macroYear.realized.totalDebtUsdM || 0) / 1e3).toFixed(1)}B)`
              : 'Tracks capital shortfall against debt-service overruns across 11 fiscal cycles.'}
          </div>
        </div>
      </div>

      {/* 3. Top Compound Multi-Ledger Flagged Projects in Selected Year */}
      {topCompoundItems.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.65rem',
            paddingTop: '0.4rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <AlertTriangle size={14} color="#b45309" />
              <span style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Highest-Risk Multi-Ledger Flagged Line Items in FY {financialYear} ({compoundProjects.length.toLocaleString()} Flagged Projects)
              </span>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('evidence')}
              className="font-mono"
              style={{
                border: 'none',
                background: 'none',
                color: '#059669',
                fontSize: '0.72rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
            >
              Inspect All {compoundProjects.length.toLocaleString()} Flagged Projects &rarr;
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
              <thead>
                <tr
                  style={{
                    backgroundColor: 'var(--bg-canvas)',
                    borderBottom: '1px solid var(--border-subtle)',
                    color: 'var(--text-muted)',
                    textAlign: 'left',
                  }}
                >
                  <th style={{ padding: '0.5rem 0.65rem' }}>Risk</th>
                  <th style={{ padding: '0.5rem 0.65rem' }}>Code</th>
                  <th style={{ padding: '0.5rem 0.65rem' }}>Executing MDA</th>
                  <th style={{ padding: '0.5rem 0.65rem' }}>Verbatim Line Item &amp; Cross-Ledger Signals</th>
                  <th style={{ padding: '0.5rem 0.65rem', textAlign: 'right' }}>Allocation (₦)</th>
                  <th style={{ padding: '0.5rem 0.65rem', textAlign: 'center' }}>Page</th>
                </tr>
              </thead>
              <tbody>
                {topCompoundItems.map((cp) => (
                  <tr
                    key={cp.projectKey}
                    onClick={() =>
                      onSelectProject?.({
                        id: cp.id,
                        projectCode: cp.projectCode,
                        projectName: cp.projectName,
                        agency: cp.agency,
                        financialYear: cp.financialYear,
                        amount: cp.amount,
                        page: cp.page,
                        sector: cp.sector,
                      })
                    }
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      cursor: onSelectProject ? 'pointer' : 'default',
                    }}
                  >
                    <td className="font-mono tabular-nums" style={{ padding: '0.52rem 0.65rem', whiteSpace: 'nowrap' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '0.12rem 0.42rem',
                          borderRadius: '4px',
                          fontWeight: 700,
                          fontSize: '0.68rem',
                          backgroundColor: cp.compoundRiskScore >= 80 ? '#fef2f2' : '#fffbeb',
                          color: cp.compoundRiskScore >= 80 ? '#b91c1c' : '#b45309',
                          border: cp.compoundRiskScore >= 80 ? '1px solid #fecaca' : '1px solid #fde68a',
                        }}
                      >
                        {cp.compoundRiskScore}/100 ({cp.ruleCount} rules)
                      </span>
                    </td>
                    <td className="font-mono" style={{ padding: '0.52rem 0.65rem', fontWeight: 700, color: '#059669' }}>
                      {cp.projectCode || 'ERGP'}
                    </td>
                    <td style={{ padding: '0.52rem 0.65rem', color: 'var(--text-muted)', maxWidth: '190px' }}>
                      {cp.agency}
                    </td>
                    <td style={{ padding: '0.52rem 0.65rem', color: 'var(--text-primary)' }}>
                      <div style={{ fontWeight: 600 }}>
                        <ExpandableText text={cp.projectName} maxChars={140} />
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.2rem' }}>
                        {cp.triggeredRules.slice(0, 4).map((tr) => (
                          <span
                            key={tr.ruleId}
                            className="font-mono"
                            style={{
                              fontSize: '0.61rem',
                              fontWeight: 600,
                              padding: '0.05rem 0.34rem',
                              borderRadius: '4px',
                              backgroundColor: tr.ledgerScope === 'CROSS_LEDGER' ? '#f5f3ff' : '#f1f5f9',
                              color: tr.ledgerScope === 'CROSS_LEDGER' ? '#6d28d9' : '#334155',
                              border: tr.ledgerScope === 'CROSS_LEDGER' ? '1px solid #ddd6fe' : '1px solid #cbd5e1',
                            }}
                          >
                            {tr.ruleName}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.52rem 0.65rem', textAlign: 'right', fontWeight: 700 }}>
                      {fmtNaira(cp.amount)}
                    </td>
                    <td className="font-mono tabular-nums" style={{ padding: '0.52rem 0.65rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      p.{cp.page}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};
