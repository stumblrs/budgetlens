import React, { useEffect, useState } from 'react';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileSpreadsheet,
  GitCompareArrows,
  Landmark,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import {
  loadProjectLifecycleForRecord,
  type LifecycleContractorSummary,
  type ResolvedProjectLifecycle,
} from '../utils/projectLifecycle';
import { ExpandableText } from './ExpandableText';
import { ContractorHistoryModal, type ContractorSummaryItem } from './ContractorHistoryModal';

interface ProjectLifecycleStepperProps {
  project: {
    id?: string;
    projectCode?: string;
    projectName: string;
    agency?: string;
    ministry?: string;
    financialYear?: number;
  };
  financialYear: number;
  compact?: boolean;
  onLifecycleResolved?: (resolved: ResolvedProjectLifecycle | null) => void;
  onJumpToFieldVerify?: () => void;
}

function formatNairaCompact(amt?: number | null): string {
  if (amt === null || amt === undefined) return '—';
  const abs = Math.abs(amt);
  if (abs >= 1e12) return `₦${(amt / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `₦${(amt / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `₦${(amt / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `₦${(amt / 1e3).toFixed(1)}K`;
  return `₦${Math.round(amt).toLocaleString('en-US')}`;
}

function formatBillDiffLabel(status: string): string {
  switch (status) {
    case 'NASS_INSERTION':
      return 'NASS Insertion';
    case 'ALLOCATION_INFLATED':
      return 'Allocated Inflated';
    case 'ALLOCATION_CUT':
      return 'Allocation Cut';
    case 'REMOVED_IN_ACT':
      return 'Removed in Act';
    case 'UNCHANGED':
      return 'Unchanged vs Bill';
    case 'NOT_IN_ALTERED_DIFF':
      return 'Not in Altered Diff';
    case 'NO_BILL_DIFF_CYCLE':
      return 'No Bill-Diff Cycle';
    default:
      return status.replace(/_/g, ' ');
  }
}

function toContractorSummaryItem(c: LifecycleContractorSummary): ContractorSummaryItem {
  return {
    contractorName: c.contractorName,
    bppContractorId: c.bppContractorId ?? undefined,
    contractCount: c.leaderboardContractCount ?? c.awardCount,
    totalContractedNaira: c.leaderboardTotalContractedNaira ?? c.awardedNaira,
    nocopoDisbursedNaira: c.nocopoDisbursedNaira || 0,
    govspendPaymentCount: c.totalGovspendCount || c.mdaGovspendCount || 0,
    govspendPaidNaira: c.totalGovspendPaidNaira || c.mdaGovspendPaidNaira || 0,
    firstYear: c.leaderboardFirstYear ?? c.years?.[0] ?? null,
    lastYear: c.leaderboardLastYear ?? c.years?.[c.years.length - 1] ?? null,
    mdaCount: c.leaderboardMdaCount ?? 1,
    topMdas: c.leaderboardTopMdas ?? [],
  };
}

export const ProjectLifecycleStepper: React.FC<ProjectLifecycleStepperProps> = ({
  project,
  financialYear,
  compact = false,
  onLifecycleResolved,
  onJumpToFieldVerify,
}) => {
  const effectiveYear = project.financialYear || financialYear;
  const agencyName = project.agency || project.ministry || '';

  const [resolved, setResolved] = useState<ResolvedProjectLifecycle | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedContractor, setSelectedContractor] = useState<ContractorSummaryItem | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setDrawerOpen(false);
    loadProjectLifecycleForRecord({
      id: project.id,
      projectCode: project.projectCode,
      projectName: project.projectName,
      financialYear: effectiveYear,
      agency: agencyName,
    })
      .then((res) => {
        if (!active) return;
        setResolved(res);
        onLifecycleResolved?.(res);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [project.id, project.projectCode, project.projectName, effectiveYear, agencyName, onLifecycleResolved]);

  if (loading && !resolved) {
    return (
      <div
        className="dossier-card"
        style={{
          padding: compact ? '0.85rem 1rem' : '1.1rem 1.25rem',
          fontSize: '0.78rem',
          color: 'var(--text-muted)',
        }}
      >
        Loading 5-stage cross-dataset audit chain (MTEF, Bill vs. Act, BIR, NOCOPO &amp; Open Treasury)...
      </div>
    );
  }

  if (!resolved) return null;

  const { mtef, billDiff, bir, nocopo, govspend } = resolved;
  const hasDetailEvidence =
    nocopo.contracts.length > 0 ||
    govspend.directVouchers.length > 0 ||
    govspend.vendorMdaVouchers.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      {resolved.paidOnPaperPriority && (
        <div
          role="status"
          style={{
            backgroundColor: resolved.paidOnPaperTier === 'DIRECT_PROJECT_PAID' ? '#fef2f2' : '#fffbeb',
            border:
              resolved.paidOnPaperTier === 'DIRECT_PROJECT_PAID'
                ? '1px solid #fecaca'
                : '1px solid #fde68a',
            borderLeft:
              resolved.paidOnPaperTier === 'DIRECT_PROJECT_PAID'
                ? '4px solid #b91c1c'
                : '4px solid #d97706',
            borderRadius: '8px',
            padding: compact ? '0.75rem 0.9rem' : '0.9rem 1.1rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <div style={{ flex: '1 1 320px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
              <span
                className="font-mono"
                style={{
                  fontSize: '0.67rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  padding: '0.16rem 0.5rem',
                  borderRadius: '4px',
                  backgroundColor: resolved.paidOnPaperTier === 'DIRECT_PROJECT_PAID' ? '#b91c1c' : '#b45309',
                  color: '#ffffff',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                }}
              >
                <ShieldAlert size={12} /> Paid on Paper — Field Verification Priority
              </span>
              {resolved.paidOnPaperTier === 'VENDOR_MDA_PAID' && (
                <span className="font-mono" style={{ fontSize: '0.67rem', fontWeight: 600, color: '#92400e' }}>
                  MDA-Vendor Treasury Context
                </span>
              )}
            </div>
            <p
              style={{
                margin: '0.35rem 0 0',
                fontSize: '0.77rem',
                color: resolved.paidOnPaperTier === 'DIRECT_PROJECT_PAID' ? '#7f1d1d' : '#78350f',
                lineHeight: 1.45,
              }}
            >
              {resolved.paidOnPaperReason} Public payment records indicate funds moved—independent on-site citizen verification is prioritized.
            </p>
          </div>
          {onJumpToFieldVerify && (
            <button
              type="button"
              onClick={onJumpToFieldVerify}
              className="editorial-btn"
              style={{
                flexShrink: 0,
                backgroundColor: '#ffffff',
                borderColor: resolved.paidOnPaperTier === 'DIRECT_PROJECT_PAID' ? '#fca5a5' : '#fcd34d',
                color: resolved.paidOnPaperTier === 'DIRECT_PROJECT_PAID' ? '#991b1b' : '#92400e',
                fontWeight: 700,
                fontSize: '0.73rem',
              }}
            >
              Verify on Ground
            </button>
          )}
        </div>
      )}

      {/* 5-Stage Lifecycle Card Container */}
      <div
        className="dossier-card"
        style={{
          padding: compact ? '0.9rem 1rem' : '1.1rem 1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.85rem',
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
          <div>
            <div
              className="font-mono"
              style={{
                fontSize: '0.67rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
                color: '#059669',
              }}
            >
              End-to-End 5-Stage Accountability Chain
            </div>
            <h3 className="font-editorial" style={{ margin: '0.1rem 0 0', fontSize: compact ? '0.98rem' : '1.08rem', fontWeight: 600 }}>
              From Macro MTEF Assumptions to Treasury Cash
            </h3>
          </div>
          {hasDetailEvidence && (
            <button
              type="button"
              onClick={() => setDrawerOpen((prev) => !prev)}
              className="editorial-btn"
              style={{ fontSize: '0.72rem', padding: '0.32rem 0.65rem' }}
            >
              {drawerOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {drawerOpen ? 'Hide' : 'Inspect'} {nocopo.contracts.length} Award(s) &amp;{' '}
              {govspend.directVouchers.length || govspend.vendorMdaVouchers.length} Voucher(s)
            </button>
          )}
        </div>

        {/* 5-Stage Stepper Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: compact
              ? 'repeat(auto-fit, minmax(195px, 1fr))'
              : 'repeat(auto-fit, minmax(175px, 1fr))',
            gap: '0.65rem',
          }}
        >
          {/* Stage 1: MTEF */}
          <div
            style={{
              backgroundColor: 'var(--card-subtle)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '0.72rem 0.8rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.35rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.68rem', fontWeight: 700, color: '#047857', textTransform: 'uppercase' }}>
              <TrendingUp size={13} /> 1 · MTEF Macro
            </div>
            {mtef.status === 'EXACT_YEAR_MTEF' ? (
              <>
                <div className="font-mono tabular-nums" style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {mtef.oilPriceUsdPerBbl != null ? `$${mtef.oilPriceUsdPerBbl}/bbl` : 'Oil n/a'} ·{' '}
                  {mtef.oilProductionMbpd != null ? `${mtef.oilProductionMbpd} mbpd` : 'Prod n/a'}
                </div>
                <div className="font-mono tabular-nums" style={{ fontSize: '0.69rem', color: 'var(--text-muted)' }}>
                  FX {mtef.exchangeRateNairaPerUsd != null ? `₦${mtef.exchangeRateNairaPerUsd.toLocaleString()}/$` : 'n/a'} ·{' '}
                  GDP {mtef.gdpGrowthPct != null ? `${mtef.gdpGrowthPct}%` : 'n/a'} ·{' '}
                  CPI {mtef.inflationPct != null ? `${mtef.inflationPct}%` : 'n/a'}
                </div>
                {mtef.docTitle && (
                  <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>
                    {mtef.docTitle}
                    {mtef.sourcePage ? ` (p.${mtef.sourcePage})` : ''}
                  </div>
                )}
              </>
            ) : (
              <>
                <span className="font-mono" style={{ fontSize: '0.67rem', fontWeight: 700, color: '#64748b' }}>
                  NO_MTEF_BENCHMARK
                </span>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>
                  {mtef.coveringDocTitle
                    ? `Covered qualitatively in ${mtef.coveringDocTitle}; year-specific table not extracted.`
                    : `No extracted MTEF benchmark series indexed for FY ${effectiveYear}.`}
                </div>
              </>
            )}
          </div>

          {/* Stage 2: Bill vs Act */}
          <div
            style={{
              backgroundColor: 'var(--card-subtle)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '0.72rem 0.8rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.35rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.68rem', fontWeight: 700, color: '#047857', textTransform: 'uppercase' }}>
              <GitCompareArrows size={13} /> 2 · Bill &rarr; Act
            </div>
            {billDiff.cycleAvailable && !['NO_BILL_DIFF_CYCLE', 'NOT_IN_ALTERED_DIFF'].includes(billDiff.status) ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
                  <span
                    className="font-mono"
                    style={{
                      fontSize: '0.66rem',
                      fontWeight: 700,
                      padding: '0.1rem 0.36rem',
                      borderRadius: '4px',
                      backgroundColor:
                        billDiff.status === 'NASS_INSERTION' || billDiff.status === 'ALLOCATION_INFLATED'
                          ? '#fef2f2'
                          : billDiff.status === 'ALLOCATION_CUT' || billDiff.status === 'REMOVED_IN_ACT'
                          ? '#eff6ff'
                          : '#ecfdf5',
                      color:
                        billDiff.status === 'NASS_INSERTION' || billDiff.status === 'ALLOCATION_INFLATED'
                          ? '#b91c1c'
                          : billDiff.status === 'ALLOCATION_CUT' || billDiff.status === 'REMOVED_IN_ACT'
                          ? '#1d4ed8'
                          : '#047857',
                    }}
                  >
                    {formatBillDiffLabel(billDiff.status)}
                  </span>
                  {billDiff.isZonalIntervention && (
                    <span className="font-mono" style={{ fontSize: '0.62rem', fontWeight: 700, color: '#6d28d9' }}>
                      ZIP
                    </span>
                  )}
                </div>
                <div className="font-mono tabular-nums" style={{ fontSize: '0.73rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {formatNairaCompact(billDiff.proposedAmountNaira)} &rarr; {formatNairaCompact(billDiff.enactedAmountNaira)}
                </div>
                <div className="font-mono tabular-nums" style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>
                  Delta {billDiff.deltaNaira && billDiff.deltaNaira > 0 ? '+' : ''}
                  {formatNairaCompact(billDiff.deltaNaira)}
                  {billDiff.deltaPct !== null && billDiff.deltaPct !== undefined ? ` (${billDiff.deltaPct > 0 ? '+' : ''}${billDiff.deltaPct}%)` : ''}
                  {billDiff.billPage || billDiff.actPage ? ` · p.${billDiff.billPage ?? '—'}→p.${billDiff.actPage ?? '—'}` : ''}
                </div>
              </>
            ) : (
              <>
                <span className="font-mono" style={{ fontSize: '0.67rem', fontWeight: 700, color: '#64748b' }}>
                  {billDiff.cycleAvailable ? 'NOT_IN_ALTERED_DIFF' : 'NO_BILL_DIFF_CYCLE'}
                </span>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>
                  {billDiff.cycleAvailable
                    ? `FY ${effectiveYear} diff tracked; no Bill-to-Act change matched this line.`
                    : `Paired Executive Bill comparison unavailable for FY ${effectiveYear}.`}
                </div>
              </>
            )}
          </div>

          {/* Stage 3: Parent MDA BIR Execution */}
          <div
            style={{
              backgroundColor: 'var(--card-subtle)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '0.72rem 0.8rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.35rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.68rem', fontWeight: 700, color: '#047857', textTransform: 'uppercase' }}>
              <Building2 size={13} /> 3 · BIR MDA Release
            </div>
            {bir.status === 'MATCHED_MDA' ? (
              <>
                <div className="font-mono tabular-nums" style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {bir.releasePct !== null && bir.releasePct !== undefined
                    ? `${bir.releasePct.toFixed(1)}% Released`
                    : `${formatNairaCompact(bir.releasedNaira)} Released`}
                  {bir.utilizationPct !== null && bir.utilizationPct !== undefined
                    ? ` · ${bir.utilizationPct.toFixed(1)}% Util.`
                    : ''}
                </div>
                <div className="font-mono tabular-nums" style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>
                  {bir.appropriatedNaira && bir.appropriatedNaira > 0
                    ? `App ${formatNairaCompact(bir.appropriatedNaira)} · Rel ${formatNairaCompact(bir.releasedNaira)}`
                    : `Appropriated denominator omitted in FY ${effectiveYear} BIR`}
                </div>
                <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>
                  {bir.matchedMdaName} ({bir.matchType === 'EXACT_MDA' ? 'Exact MDA' : 'Parent Ministry'} ·{' '}
                  {bir.quarterCovered || bir.reportPeriodLabel || `FY ${effectiveYear}`})
                  {bir.overspendVirement ? ' · Exceeded Appropriation' : ''}
                </div>
              </>
            ) : bir.status === 'NO_MDA_BREAKDOWN' ? (
              <>
                <span className="font-mono" style={{ fontSize: '0.67rem', fontWeight: 700, color: '#92400e' }}>
                  NO_MDA_BREAKDOWN
                </span>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>
                  FY {effectiveYear} BIR ({bir.quarterCovered || bir.reportPeriodLabel || 'Report'}) reported macro totals only
                  {bir.nationalOverallReleasePct != null
                    ? ` (National execution ${bir.nationalOverallReleasePct.toFixed(1)}%).`
                    : '.'}
                </div>
              </>
            ) : (
              <>
                <span className="font-mono" style={{ fontSize: '0.67rem', fontWeight: 700, color: '#64748b' }}>
                  NO_BIR_REPORT
                </span>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>
                  No verified Budget Implementation Report indexed for FY {effectiveYear}.
                </div>
              </>
            )}
          </div>

          {/* Stage 4: NOCOPO Procurement */}
          <div
            style={{
              backgroundColor: 'var(--card-subtle)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '0.72rem 0.8rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.35rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.68rem', fontWeight: 700, color: '#047857', textTransform: 'uppercase' }}>
              <FileSpreadsheet size={13} /> 4 · NOCOPO Award
            </div>
            {nocopo.awardedContractCount > 0 ? (
              <>
                <div className="font-mono tabular-nums" style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {nocopo.awardedContractCount} Award(s) · {formatNairaCompact(nocopo.totalAwardedNaira)}
                </div>
                <div className="font-mono tabular-nums" style={{ fontSize: '0.68rem', color: nocopo.totalNocopoDisbursedNaira > 0 ? '#047857' : '#b45309' }}>
                  NOCOPO Paid: {formatNairaCompact(nocopo.totalNocopoDisbursedNaira)}
                  {nocopo.nonCompetitiveCount > 0 ? ` · ${nocopo.nonCompetitiveCount} Non-Open` : ''}
                </div>
                <div className="font-mono" style={{ fontSize: '0.63rem', color: 'var(--text-muted)' }}>
                  {nocopo.matchMethod === 'EXACT_ERGP_CODE'
                    ? 'Exact Project Code'
                    : `MDA+Title (${Math.round(nocopo.confidenceScore * 100)}%)`}
                  {nocopo.planningCount > 0 ? ` · +${nocopo.planningCount} planning` : ''}
                </div>
                {nocopo.contractors.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.1rem' }}>
                    {nocopo.contractors.slice(0, 2).map((c) => (
                      <button
                        key={c.contractorName}
                        type="button"
                        onClick={() => setSelectedContractor(toContractorSummaryItem(c))}
                        style={{
                          fontSize: '0.65rem',
                          padding: '0.12rem 0.38rem',
                          borderRadius: '4px',
                          border: '1px solid #bfdbfe',
                          backgroundColor: '#eff6ff',
                          color: '#1d4ed8',
                          fontWeight: 600,
                          cursor: 'pointer',
                          textAlign: 'left',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.2rem',
                        }}
                        title="Open full contractor procurement & payment history"
                      >
                        {c.contractorName.length > 24 ? `${c.contractorName.slice(0, 22)}…` : c.contractorName}
                        <ExternalLink size={9} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <span style={{ fontSize: '0.65rem', color: '#64748b' }}>
                    Vendor undisclosed in award release
                  </span>
                )}
              </>
            ) : nocopo.planningCount > 0 ? (
              <>
                <span className="font-mono" style={{ fontSize: '0.67rem', fontWeight: 700, color: '#475569' }}>
                  PLANNING / TENDER ONLY ({nocopo.planningCount})
                </span>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>
                  Listed in NOCOPO planning/tender stages; no contract award release recorded.
                </div>
              </>
            ) : (
              <>
                <span className="font-mono" style={{ fontSize: '0.67rem', fontWeight: 700, color: '#64748b' }}>
                  NO_PUBLIC_CONTRACT
                </span>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>
                  No matching BPP NOCOPO procurement release linked to this line.
                </div>
              </>
            )}
          </div>

          {/* Stage 5: GovSpend Open Treasury Cash */}
          <div
            style={{
              backgroundColor: 'var(--card-subtle)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '0.72rem 0.8rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.35rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.68rem', fontWeight: 700, color: '#047857', textTransform: 'uppercase' }}>
              <Landmark size={13} /> 5 · Treasury Cash
            </div>
            {govspend.status === 'DIRECT_TREASURY_VOUCHERS' ? (
              <>
                <div className="font-mono tabular-nums" style={{ fontSize: '0.76rem', fontWeight: 700, color: '#047857' }}>
                  {formatNairaCompact(govspend.directPaidNaira)} Paid
                </div>
                <div className="font-mono" style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>
                  {govspend.directVoucherCount} Direct ERGP Open Treasury voucher(s)
                </div>
                {govspend.directVouchers[0] && (
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>
                    Latest/Top: {govspend.directVouchers[0].beneficiaryName} ({govspend.directVouchers[0].paymentDate})
                  </div>
                )}
              </>
            ) : govspend.status === 'VENDOR_MDA_PAYOUTS_RECORDED' ? (
              <>
                <div className="font-mono tabular-nums" style={{ fontSize: '0.74rem', fontWeight: 700, color: '#92400e' }}>
                  {formatNairaCompact(govspend.vendorMdaPaidNaira)} MDA-Vendor Context
                </div>
                <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>
                  {govspend.vendorMdaVoucherCount} voucher(s) paid by this MDA to awarded vendor; vouchers lack explicit ERGP tags.
                </div>
              </>
            ) : (
              <>
                <span className="font-mono" style={{ fontSize: '0.67rem', fontWeight: 700, color: '#64748b' }}>
                  NO_TREASURY_VOUCHER
                </span>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>
                  No matching Open Treasury payment voucher linked to this code or vendor.
                </div>
              </>
            )}
          </div>
        </div>

        {/* Expandable Contracts & Vouchers Drawer */}
        {drawerOpen && hasDetailEvidence && (
          <div
            style={{
              borderTop: '1px solid var(--border-color)',
              paddingTop: '0.8rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            {nocopo.contracts.length > 0 && (
              <div>
                <div className="font-mono" style={{ fontSize: '0.69rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                  Matched NOCOPO Releases ({nocopo.contracts.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {nocopo.contracts.map((c) => (
                    <div
                      key={c.ocid}
                      style={{
                        backgroundColor: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: '6px',
                        padding: '0.55rem 0.7rem',
                        fontSize: '0.74rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem', fontWeight: 700 }}>
                        <span className="font-mono" style={{ color: '#047857' }}>
                          {c.ocid} · {c.stage.toUpperCase()} {c.financialYear ? `(FY ${c.financialYear})` : ''}
                        </span>
                        <span className="font-mono tabular-nums">
                          Award: {formatNairaCompact(c.awardNaira)} · Paid: {formatNairaCompact(c.paidNaira)}
                        </span>
                      </div>
                      <div style={{ marginTop: '0.2rem', color: 'var(--text-primary)' }}>
                        <ExpandableText text={c.title || 'Untitled OCDS procurement item'} maxChars={140} />
                      </div>
                      <div style={{ marginTop: '0.2rem', fontSize: '0.68rem', color: 'var(--text-muted)', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <span>Contractor: {c.contractorName || 'Undisclosed in release'}</span>
                        {c.procurementMethod && <span>Method: {c.procurementMethod}</span>}
                        {c.awardDate && <span>Date: {c.awardDate}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(govspend.directVouchers.length > 0 || govspend.vendorMdaVouchers.length > 0) && (
              <div>
                <div className="font-mono" style={{ fontSize: '0.69rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                  {govspend.directVouchers.length > 0
                    ? `Direct ERGP Open Treasury Vouchers (${govspend.directVouchers.length})`
                    : `Same-MDA Vendor Open Treasury Context (${govspend.vendorMdaVouchers.length})`}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {(govspend.directVouchers.length > 0 ? govspend.directVouchers : govspend.vendorMdaVouchers).map((v) => (
                    <div
                      key={`${v.paymentNo}-${v.beneficiaryName}-${v.amountNaira}`}
                      style={{
                        backgroundColor: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: '6px',
                        padding: '0.55rem 0.7rem',
                        fontSize: '0.74rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem', fontWeight: 700 }}>
                        <span className="font-mono" style={{ color: '#0f172a' }}>
                          {v.paymentDate || `FY ${v.financialYear}`} · #{v.paymentNo || 'Voucher'} · {v.beneficiaryName}
                        </span>
                        <span className="font-mono tabular-nums" style={{ color: '#047857' }}>
                          {formatNairaCompact(v.amountNaira)}
                        </span>
                      </div>
                      <div style={{ marginTop: '0.2rem', color: 'var(--text-muted)' }}>
                        <ExpandableText text={v.description || v.organizationName} maxChars={140} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {selectedContractor && (
        <ContractorHistoryModal
          contractor={selectedContractor}
          onClose={() => setSelectedContractor(null)}
        />
      )}
    </div>
  );
};
