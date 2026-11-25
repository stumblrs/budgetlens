import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Download, FileCheck2, FileText, Search, X } from 'lucide-react';
import { ExpandableText } from './ExpandableText';
import {
  exportContractorBriefDocx,
  exportContractorBriefPdf,
} from '../utils/documentExporter';

export interface ContractorSummaryItem {
  contractorName: string;
  bppContractorId?: string;
  contractCount: number;
  totalContractedNaira: number;
  nocopoDisbursedNaira?: number;
  govspendPaymentCount?: number;
  govspendPaidNaira?: number;
  firstYear: number | null;
  lastYear: number | null;
  mdaCount: number;
  topMdas: string[];
}

export interface FallbackContractLink {
  budgetRecordId: string;
  financialYear: number;
  projectCode: string;
  budgetTitle: string;
  mdaName: string;
  matchType: string;
  ocdsReleaseId: string | null;
  stage?: string;
  contractorName: string | null;
  contractAwardNaira: number | null;
  totalPaidNaira?: number | null;
  awardDate: string | null;
  procurementMethod: string | null;
}

interface ContractHistoryRow {
  ocdsReleaseId: string;
  financialYear: number;
  stage?: string;
  budgetTitle: string;
  mdaName: string;
  contractorName: string;
  bppContractorId?: string | null;
  contractAwardNaira: number;
  totalPaidNaira: number;
  awardDate?: string | null;
  procurementMethod?: string | null;
  projectCode?: string;
  matchType?: string;
}

interface PaymentHistoryRow {
  paymentNo: string;
  paymentDate: string;
  financialYear: number;
  payerCode: string;
  organizationName: string;
  beneficiaryName: string;
  amountNaira: number;
  description: string;
}

interface ContractorHistoryResponse {
  available: boolean;
  contractorName: string;
  totalContracts: number;
  totalContractedNaira: number;
  totalNocopoDisbursedNaira: number;
  contracts: ContractHistoryRow[];
  totalGovspendCount: number;
  totalGovspendNaira: number;
  payments: PaymentHistoryRow[];
}

interface ContractorNetworkContext {
  captiveMdaLabel?: string;
  multiMdaCount?: number;
  payoutDiscrepancyPct?: number;
}

interface ContractorHistoryModalProps {
  contractor: ContractorSummaryItem | null;
  fallbackLinks?: FallbackContractLink[];
  networkContext?: ContractorNetworkContext | null;
  onClose: () => void;
}

function formatNairaCompact(amt: number): string {
  const abs = Math.abs(amt || 0);
  if (abs >= 1e12) return `₦${(amt / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `₦${(amt / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `₦${(amt / 1e6).toFixed(2)}M`;
  return `₦${Math.round(amt || 0).toLocaleString()}`;
}

type HistoryShardMap = Record<
  string,
  { contracts?: ContractHistoryRow[]; payments?: PaymentHistoryRow[] }
>;

const historyShardCache = new Map<string, HistoryShardMap>();

function getShardBucket(name: string): string {
  const s = (name || '').trim();
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  }
  return String(h % 64).padStart(2, '0');
}

export const ContractorHistoryModal: React.FC<ContractorHistoryModalProps> = ({
  contractor,
  fallbackLinks = [],
  networkContext = null,
  onClose,
}) => {
  const [innerTab, setInnerTab] = useState<'contracts' | 'payments'>('contracts');
  const [filterQuery, setFilterQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyData, setHistoryData] = useState<ContractorHistoryResponse | null>(null);
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null);

  useEffect(() => {
    if (!contractor) return;
    setInnerTab('contracts');
    setFilterQuery('');
    setHistoryData(null);

    const bucket = getShardBucket(contractor.contractorName);
    const cachedShard = historyShardCache.get(bucket);
    if (cachedShard && cachedShard[contractor.contractorName]) {
      const entry = cachedShard[contractor.contractorName];
      const contracts = entry.contracts || [];
      const payments = entry.payments || [];
      setHistoryData({
        available: true,
        contractorName: contractor.contractorName,
        totalContracts: contracts.length || contractor.contractCount,
        totalContractedNaira: contractor.totalContractedNaira,
        totalNocopoDisbursedNaira: contractor.nocopoDisbursedNaira || 0,
        contracts,
        totalGovspendCount: contractor.govspendPaymentCount || payments.length,
        totalGovspendNaira: contractor.govspendPaidNaira || 0,
        payments,
      });
      setLoading(false);
      return;
    }

    setLoading(true);
    const ctrl = new AbortController();

    fetch(`/datasets/contractor_history/${bucket}.json`, { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((shard: HistoryShardMap | null) => {
        if (shard) {
          historyShardCache.set(bucket, shard);
          const entry = shard[contractor.contractorName];
          if (entry) {
            const contracts = entry.contracts || [];
            const payments = entry.payments || [];
            setHistoryData({
              available: true,
              contractorName: contractor.contractorName,
              totalContracts: contracts.length || contractor.contractCount,
              totalContractedNaira: contractor.totalContractedNaira,
              totalNocopoDisbursedNaira: contractor.nocopoDisbursedNaira || 0,
              contracts,
              totalGovspendCount: contractor.govspendPaymentCount || payments.length,
              totalGovspendNaira: contractor.govspendPaidNaira || 0,
              payments,
            });
            setLoading(false);
            return null;
          }
        }
        return fetch(
          `/api/procurement/contractor-history?name=${encodeURIComponent(contractor.contractorName)}&limit=200`,
          { signal: ctrl.signal }
        ).then((r) => (r.ok ? r.json() : null));
      })
      .then((apiData) => {
        if (apiData && apiData.available) {
          setHistoryData(apiData);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') {
          setLoading(false);
        }
      });

    return () => ctrl.abort();
  }, [contractor]);

  useEffect(() => {
    if (!contractor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [contractor, onClose]);

  const offlineContracts = useMemo<ContractHistoryRow[]>(() => {
    if (!contractor) return [];
    const target = contractor.contractorName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
    return fallbackLinks
      .filter((l) => {
        const cn = (l.contractorName || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
        return cn && (cn === target || cn.includes(target) || target.includes(cn));
      })
      .map((l) => ({
        ocdsReleaseId: l.ocdsReleaseId || l.budgetRecordId,
        financialYear: l.financialYear,
        stage: l.stage,
        budgetTitle: l.budgetTitle,
        mdaName: l.mdaName,
        contractorName: l.contractorName || contractor.contractorName,
        contractAwardNaira: l.contractAwardNaira || 0,
        totalPaidNaira: l.totalPaidNaira || 0,
        awardDate: l.awardDate,
        procurementMethod: l.procurementMethod,
        projectCode: l.projectCode,
        matchType: l.matchType,
      }));
  }, [contractor, fallbackLinks]);

  const contractsToShow = useMemo(() => {
    const base = historyData?.available ? historyData.contracts : offlineContracts;
    const q = filterQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter((c) =>
      [c.budgetTitle, c.mdaName, c.projectCode, c.ocdsReleaseId, c.procurementMethod, String(c.financialYear)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [historyData, offlineContracts, filterQuery]);

  const paymentsToShow = useMemo(() => {
    const base = historyData?.available ? historyData.payments : [];
    const q = filterQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter((p) =>
      [p.description, p.organizationName, p.paymentNo, p.paymentDate, p.beneficiaryName]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [historyData, filterQuery]);

  if (!contractor) return null;

  const yearsLabel =
    contractor.firstYear && contractor.lastYear
      ? contractor.firstYear === contractor.lastYear
        ? `${contractor.firstYear}`
        : `${contractor.firstYear}–${contractor.lastYear}`
      : '—';

  const totalContracts = historyData?.available ? historyData.totalContracts : contractor.contractCount;
  const totalContractedNaira = historyData?.available ? historyData.totalContractedNaira : contractor.totalContractedNaira;
  const totalGovspendNaira = historyData?.available ? historyData.totalGovspendNaira : (contractor.govspendPaidNaira || 0);
  const totalGovspendCount = historyData?.available ? historyData.totalGovspendCount : (contractor.govspendPaymentCount || 0);

  const handleExportBrief = async (format: 'pdf' | 'docx') => {
    if (exportingFormat) return;
    setExportingFormat(format);
    try {
      const briefInput = {
        contractorName: contractor.contractorName,
        bppContractorId: contractor.bppContractorId,
        firstYear: contractor.firstYear,
        lastYear: contractor.lastYear,
        totalContracts,
        totalContractedNaira,
        totalGovspendNaira,
        totalGovspendCount,
        mdaCount: contractor.mdaCount,
        topMdas: contractor.topMdas,
        networkContext,
        contracts: contractsToShow,
        payments: paymentsToShow,
        permalink: typeof window !== 'undefined' ? window.location.href : undefined,
      };
      if (format === 'pdf') {
        await exportContractorBriefPdf(briefInput);
      } else {
        await exportContractorBriefDocx(briefInput);
      }
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Contract History for ${contractor.contractorName}`}
      className="mobile-sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        backgroundColor: 'rgba(15, 23, 42, 0.72)',
        backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        className="dossier-card mobile-sheet-panel"
        style={{
          width: '100%',
          maxWidth: '980px',
          maxHeight: '90dvh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          backgroundColor: 'var(--card-bg)',
        }}
      >
        <div className="mobile-sheet-handle" />
        {/* Header */}
        <div
          style={{
            padding: '1.1rem 1.35rem',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '1rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
              <Building2 size={15} color="#059669" />
              <span className="font-mono" style={{ fontSize: '0.7rem', fontWeight: 700, color: '#059669', textTransform: 'uppercase' }}>
                Contractor Recurrence &amp; Award Dossier
              </span>
              {contractor.bppContractorId && (
                <span className="editorial-pill font-mono">{contractor.bppContractorId}</span>
              )}
              <span className="editorial-pill font-mono">Active {yearsLabel}</span>
              {networkContext?.captiveMdaLabel && (
                <span
                  className="editorial-pill font-mono"
                  style={{ backgroundColor: '#fef2f2', color: '#b91c1c', borderColor: '#fecaca' }}
                >
                  Captive MDA: {networkContext.captiveMdaLabel}
                </span>
              )}
              {networkContext?.multiMdaCount && networkContext.multiMdaCount >= 5 && (
                <span
                  className="editorial-pill font-mono"
                  style={{ backgroundColor: '#eff6ff', color: '#1d4ed8', borderColor: '#bfdbfe' }}
                >
                  Multi-MDA ({networkContext.multiMdaCount} MDAs)
                </span>
              )}
              {networkContext?.payoutDiscrepancyPct && networkContext.payoutDiscrepancyPct > 125 && (
                <span
                  className="editorial-pill font-mono"
                  style={{ backgroundColor: '#fffbeb', color: '#b45309', borderColor: '#fde68a' }}
                >
                  Treasury {networkContext.payoutDiscrepancyPct.toFixed(0)}% of NOCOPO
                </span>
              )}
            </div>
            <h2 className="font-editorial" style={{ margin: 0, fontSize: '1.3rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {contractor.contractorName}
            </h2>
          </div>

          <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => handleExportBrief('pdf')}
              disabled={exportingFormat !== null}
              className="editorial-btn-primary"
              style={{ padding: '0.35rem 0.65rem', fontSize: '0.73rem' }}
              title="Download Multi-Layer Contractor Forensic Brief as PDF"
            >
              <FileText size={13} /> {exportingFormat === 'pdf' ? 'PDF...' : 'Brief (PDF)'}
            </button>
            <button
              type="button"
              onClick={() => handleExportBrief('docx')}
              disabled={exportingFormat !== null}
              className="editorial-btn"
              style={{ padding: '0.35rem 0.65rem', fontSize: '0.73rem' }}
              title="Download Multi-Layer Contractor Forensic Brief as Word (.docx)"
            >
              <Download size={13} color="#059669" /> {exportingFormat === 'docx' ? 'DOCX...' : 'Brief (DOCX)'}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close contractor dossier"
              className="editorial-btn"
              style={{ padding: '0.35rem 0.6rem', flexShrink: 0 }}
            >
              <X size={15} /> Close
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.1rem 1.35rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* 4 KPI Cards */}
          <div className="grid-4-cols">
            <div style={{ padding: '0.85rem 1rem', borderRadius: '8px', backgroundColor: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Times Contracted</div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700 }}>
                {totalContracts.toLocaleString()}×
              </div>
            </div>
            <div style={{ padding: '0.85rem 1rem', borderRadius: '8px', backgroundColor: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Total Contracted</div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#047857' }}>
                {formatNairaCompact(totalContractedNaira)}
              </div>
            </div>
            <div style={{ padding: '0.85rem 1rem', borderRadius: '8px', backgroundColor: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Treasury Cash Paid</div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700 }}>
                {totalGovspendNaira > 0 ? formatNairaCompact(totalGovspendNaira) : '—'}
              </div>
              {totalGovspendCount > 0 && (
                <div className="font-mono" style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                  {totalGovspendCount.toLocaleString()} vouchers
                </div>
              )}
            </div>
            <div style={{ padding: '0.85rem 1rem', borderRadius: '8px', backgroundColor: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Ministries Served</div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700 }}>
                {contractor.mdaCount.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Inner Tabs & Filter */}
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem' }}>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button
                type="button"
                onClick={() => setInnerTab('contracts')}
                className={innerTab === 'contracts' ? 'editorial-btn-primary' : 'editorial-btn'}
              >
                <FileCheck2 size={13} /> Contract Awards ({totalContracts.toLocaleString()})
              </button>
              <button
                type="button"
                onClick={() => setInnerTab('payments')}
                className={innerTab === 'payments' ? 'editorial-btn-primary' : 'editorial-btn'}
              >
                Treasury Payments ({totalGovspendCount.toLocaleString()})
              </button>
            </div>

            <div style={{ position: 'relative' }}>
              <input
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder={innerTab === 'contracts' ? 'Filter contracts by title, MDA, year...' : 'Filter vouchers by MDA or description...'}
                style={{ padding: '0.38rem 0.7rem 0.38rem 2rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.78rem', width: '250px' }}
              />
              <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)' }} />
            </div>
          </div>

          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
              Loading full contract &amp; payment history...
            </div>
          ) : innerTab === 'contracts' ? (
            <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '0.55rem 0.85rem', whiteSpace: 'nowrap' }}>FY / Award Date</th>
                    <th style={{ padding: '0.55rem 0.85rem' }}>Project / Contract Title</th>
                    <th style={{ padding: '0.55rem 0.85rem' }}>Ministry / Agency</th>
                    <th style={{ padding: '0.55rem 0.85rem' }}>Stage / Method</th>
                    <th style={{ padding: '0.55rem 0.85rem', textAlign: 'right' }}>Awarded</th>
                    <th style={{ padding: '0.55rem 0.85rem', textAlign: 'right' }}>Disbursed</th>
                  </tr>
                </thead>
                <tbody>
                  {contractsToShow.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        No individual contract awards matched the active filter.
                      </td>
                    </tr>
                  ) : (
                    contractsToShow.map((row, idx) => (
                      <tr key={`${row.ocdsReleaseId}-${idx}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td className="font-mono" style={{ padding: '0.52rem 0.85rem', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                          <div style={{ fontWeight: 700 }}>{row.financialYear ? `FY ${row.financialYear}` : '—'}</div>
                          {row.awardDate && (
                            <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>{row.awardDate.slice(0, 10)}</div>
                          )}
                        </td>
                        <td style={{ padding: '0.52rem 0.85rem', maxWidth: '320px', verticalAlign: 'top' }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                            <ExpandableText text={row.budgetTitle || 'Untitled Contract Award'} maxChars={150} />
                          </div>
                          <div className="font-mono" style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                            {row.projectCode ? `${row.projectCode} · ` : ''}{row.ocdsReleaseId}
                          </div>
                        </td>
                        <td style={{ padding: '0.52rem 0.85rem', color: 'var(--text-secondary)', verticalAlign: 'top' }}>
                          {row.mdaName || 'Federal MDA'}
                        </td>
                        <td className="font-mono" style={{ padding: '0.52rem 0.85rem', fontSize: '0.7rem', color: 'var(--text-muted)', verticalAlign: 'top' }}>
                          <div>{row.stage || 'award'}</div>
                          {row.procurementMethod && <div>{row.procurementMethod}</div>}
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.52rem 0.85rem', textAlign: 'right', fontWeight: 700, verticalAlign: 'top' }}>
                          {formatNairaCompact(row.contractAwardNaira)}
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.52rem 0.85rem', textAlign: 'right', color: '#047857', fontWeight: 600, verticalAlign: 'top' }}>
                          {row.totalPaidNaira > 0 ? formatNairaCompact(row.totalPaidNaira) : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '0.55rem 0.85rem', whiteSpace: 'nowrap' }}>Date / Voucher</th>
                    <th style={{ padding: '0.55rem 0.85rem' }}>Paying MDA</th>
                    <th style={{ padding: '0.55rem 0.85rem' }}>Description</th>
                    <th style={{ padding: '0.55rem 0.85rem', textAlign: 'right' }}>Amount (₦)</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentsToShow.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        No Open Treasury payments matched this contractor.
                      </td>
                    </tr>
                  ) : (
                    paymentsToShow.map((p, idx) => (
                      <tr key={`${p.paymentNo}-${idx}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td className="font-mono" style={{ padding: '0.52rem 0.85rem', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                          <div style={{ fontWeight: 700 }}>{p.paymentDate}</div>
                          <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>{p.paymentNo}</div>
                        </td>
                        <td style={{ padding: '0.52rem 0.85rem', verticalAlign: 'top' }}>
                          <div style={{ fontWeight: 600 }}>{p.organizationName}</div>
                          <div className="font-mono" style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>{p.payerCode}</div>
                        </td>
                        <td style={{ padding: '0.52rem 0.85rem', maxWidth: '360px', verticalAlign: 'top' }}>
                          <ExpandableText text={p.description || '—'} maxChars={150} />
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.52rem 0.85rem', textAlign: 'right', fontWeight: 700, color: '#047857', verticalAlign: 'top' }}>
                          {formatNairaCompact(p.amountNaira)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
