import React, { useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../services/apiClient';
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  FileSignature,
  FileText,
  Link2,
  Quote,
  Send,
} from 'lucide-react';
import { useBudgetDatabase } from '../context/BudgetDatabaseContext';
import { getPresidentForYear } from '../data/presidentialTerms';
import type { BudgetRecord } from '../services/budgetDatabaseEngine';
import {
  CITATION_STYLES,
  type CitationStyle,
  type ProvenanceManifestResponse,
  formatRecordCitations,
  loadSourceProvenance,
  resolveRecordProvenance,
} from '../utils/citationFormatter';
import {
  exportRecordForensicBriefDocx,
  exportRecordForensicBriefPdf,
} from '../utils/documentExporter';
import {
  loadProjectLifecycleForRecord,
  type ResolvedProjectLifecycle,
} from '../utils/projectLifecycle';
import { resolveValidGemmaReview } from '../utils/gemmaReview';
import {
  buildRecordDossierUrl,
  computeEconomicRealityMetrics,
  resolveTargetBudgetRecord,
} from '../utils/recordDossier';
import { readAppUrlState } from '../utils/urlState';
import { OfficialRecordCard } from './OfficialRecordCard';
import { ProjectLifecycleStepper } from './ProjectLifecycleStepper';

interface BudgetRecordDossierPageProps {
  onBackToObservatory: (year: number) => void;
  onBrowseProjects: (year: number) => void;
}

export const BudgetRecordDossierPage: React.FC<BudgetRecordDossierPageProps> = ({
  onBackToObservatory,
  onBrowseProjects,
}) => {
  const { getRecordsForYear, loadYearRecords, registryDocs } = useBudgetDatabase();
  const urlState = useMemo(() => readAppUrlState(), []);
  const targetYear = urlState.year || 2026;
  const targetItem = urlState.item || '';
  const targetPage = urlState.page;

  const [yearRecords, setYearRecords] = useState<BudgetRecord[]>(() =>
    getRecordsForYear(targetYear)
  );
  const [minFallbackProject, setMinFallbackProject] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [manifest, setManifest] = useState<ProvenanceManifestResponse | null>(null);
  const [citationStyle, setCitationStyle] = useState<CitationStyle>('newsroom');
  const [copiedKey, setCopiedKey] = useState<'cite' | 'foi' | 'rep' | 'link' | null>(null);
  const [lifecycle, setLifecycle] = useState<ResolvedProjectLifecycle | null>(null);
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null);

  useEffect(() => {
    let active = true;
    loadSourceProvenance().then((m) => {
      if (active && m) setManifest(m);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadYearRecords(targetYear)
      .then((recs) => {
        if (!active) return;
        setYearRecords(recs);
        const found = resolveTargetBudgetRecord(recs, {
          item: targetItem,
          page: targetPage,
        });
        if (!found && targetItem) {
          return fetch(apiUrl(`/api/v1/projects/${encodeURIComponent(targetItem.trim())}`), { cache: 'no-cache' })
            .then((res) => (res.ok ? res.json() : null))
            .then((singlePayload: { item?: any } | null) => {
              if (!active) return;
              if (singlePayload?.item) {
                setMinFallbackProject(singlePayload.item);
                return;
              }
              return fetch(
                apiUrl(`/api/v1/projects?year=${targetYear}&q=${encodeURIComponent(targetItem.trim())}&limit=20`),
                { cache: 'no-cache' }
              )
                .then((res) => (res.ok ? res.json() : null))
                .then((listRes: { items?: any[] } | null) => {
                  if (!active || !Array.isArray(listRes?.items)) return;
                  const norm = targetItem.trim().toLowerCase();
                  const minList = listRes.items;
                  const matchedMin =
                    (targetPage
                      ? minList.find(
                          (p) =>
                            String(p.projectCode || '').trim().toLowerCase() === norm &&
                            Number(p.page) === Number(targetPage)
                        )
                      : undefined) ||
                    minList.find((p) => String(p.id || '').trim().toLowerCase() === norm) ||
                    minList.find((p) => String(p.projectCode || '').trim().toLowerCase() === norm) ||
                    minList[0];
                  if (matchedMin) setMinFallbackProject(matchedMin);
                });
            });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [targetYear, targetItem, targetPage, loadYearRecords]);

  const matchedDbRecord = useMemo(
    () => resolveTargetBudgetRecord(yearRecords, { item: targetItem, page: targetPage }),
    [yearRecords, targetItem, targetPage]
  );

  const resolvedProject = useMemo(() => {
    if (matchedDbRecord) {
      return {
        id: matchedDbRecord.recordIdentity.id,
        projectCode: matchedDbRecord.recordIdentity.projectCode,
        projectName: matchedDbRecord.recordIdentity.verbatimProjectName,
        amount: matchedDbRecord.recordIdentity.amountNaira,
        agency: matchedDbRecord.mdaGovernanceTaxonomy.mdaName,
        sector: matchedDbRecord.mdaGovernanceTaxonomy.sector,
        page: matchedDbRecord.sourceProvenance.pdfPage || 1,
        state: matchedDbRecord.geographicTaxonomy.state,
        financialYear: matchedDbRecord.recordIdentity.financialYear || targetYear,
        sourceFilename: matchedDbRecord.sourceProvenance.sourceFilename,
        sha256: matchedDbRecord.sourceProvenance.sha256Hash,
      };
    }
    if (minFallbackProject) {
      return {
        ...minFallbackProject,
        financialYear: minFallbackProject.financialYear || targetYear,
      };
    }
    return null;
  }, [matchedDbRecord, minFallbackProject, targetYear]);

  const registryDoc = useMemo(
    () => registryDocs.find((d) => (d.financial_year || d.financialYear) === targetYear),
    [registryDocs, targetYear]
  );

  const provenance = useMemo(
    () =>
      resolveRecordProvenance(manifest, targetYear, {
        sourceFilename: resolvedProject?.sourceFilename,
        agencyName: resolvedProject?.agency,
        recordSha256: resolvedProject?.sha256,
        registryDoc,
      }),
    [manifest, targetYear, resolvedProject, registryDoc]
  );

  const gemmaReview = useMemo(
    () => resolveValidGemmaReview(resolvedProject, matchedDbRecord),
    [resolvedProject, matchedDbRecord]
  );

  const permalink = useMemo(
    () =>
      buildRecordDossierUrl({
        year: targetYear,
        item: resolvedProject?.projectCode || resolvedProject?.id || targetItem,
        page: resolvedProject?.page || targetPage,
      }),
    [targetYear, resolvedProject, targetItem, targetPage]
  );

  useEffect(() => {
    if (!resolvedProject) {
      setLifecycle(null);
      return;
    }
    let active = true;
    loadProjectLifecycleForRecord({
      id: resolvedProject.id,
      projectCode: resolvedProject.projectCode,
      projectName: resolvedProject.projectName,
      financialYear: resolvedProject.financialYear || targetYear,
      agency: resolvedProject.agency,
    }).then((lc) => {
      if (active) setLifecycle(lc);
    });
    return () => {
      active = false;
    };
  }, [resolvedProject, targetYear]);

  const handleExportRecordBrief = async (format: 'pdf' | 'docx') => {
    if (!resolvedProject || exportingFormat) return;
    setExportingFormat(format);
    try {
      const econMetrics = computeEconomicRealityMetrics(resolvedProject.amount, targetYear);
      const stages = [
        {
          stage: 'Stage 1: MTEF Macro Benchmark',
          status: lifecycle?.mtef?.status || 'CHECKING',
          evidenceSummary:
            lifecycle?.mtef?.status === 'EXACT_YEAR_MTEF'
              ? `Oil $${lifecycle.mtef.oilPriceUsdPerBbl ?? '-'}/bbl | FX NGN ${lifecycle.mtef.exchangeRateNairaPerUsd ?? '-'}/$`
              : lifecycle?.mtef?.coveringDocTitle || 'No exact MTEF benchmark table for cycle',
        },
        {
          stage: 'Stage 2: Executive Bill vs. Enacted Act',
          status: lifecycle?.billDiff?.status || 'NOT_IN_DIFF_CYCLE',
          evidenceSummary:
            lifecycle?.billDiff?.proposedAmountNaira !== undefined && lifecycle?.billDiff?.proposedAmountNaira !== null
              ? `Bill NGN ${Math.round(lifecycle.billDiff.proposedAmountNaira).toLocaleString()} -> Act NGN ${Math.round(lifecycle.billDiff.enactedAmountNaira || 0).toLocaleString()}`
              : 'Matching cycle not altered or outside 2017-2025 diff scope',
        },
        {
          stage: 'Stage 3: Parent MDA BIR Execution',
          status: lifecycle?.bir?.status || 'NO_BIR_REPORT',
          evidenceSummary:
            lifecycle?.bir?.status === 'MATCHED_MDA'
              ? `${lifecycle.bir.matchedMdaName || resolvedProject.agency}: Release ${lifecycle.bir.releasePct?.toFixed(1) ?? 'N/A'}% | Util ${lifecycle.bir.utilizationPct?.toFixed(1) ?? 'N/A'}%`
              : `National BIR overall release ${lifecycle?.bir?.nationalOverallReleasePct?.toFixed(1) ?? 'N/A'}%`,
        },
        {
          stage: 'Stage 4: BPP NOCOPO Awarded Procurement',
          status: (lifecycle?.nocopo?.awardedContractCount || 0) > 0 ? `${lifecycle?.nocopo.awardedContractCount} AWARDED` : 'NO_NOCOPO_LINK',
          evidenceSummary:
            (lifecycle?.nocopo?.awardedContractCount || 0) > 0
              ? `Contracted NGN ${Math.round(lifecycle!.nocopo.totalAwardedNaira).toLocaleString()} | NOCOPO paid NGN ${Math.round(lifecycle!.nocopo.totalNocopoDisbursedNaira).toLocaleString()}`
              : 'No awarded/contracted OCDS link (planning/tender excluded)',
        },
        {
          stage: 'Stage 5: OAGF Open Treasury Cash',
          status:
            (lifecycle?.govspend?.directVoucherCount || 0) + (lifecycle?.govspend?.vendorMdaVoucherCount || 0) > 0
              ? 'VOUCHERS_MATCHED'
              : 'NO_DIRECT_VOUCHER',
          evidenceSummary:
            (lifecycle?.govspend?.directVoucherCount || 0) + (lifecycle?.govspend?.vendorMdaVoucherCount || 0) > 0
              ? `${lifecycle!.govspend.directVoucherCount} ERGP direct + ${lifecycle!.govspend.vendorMdaVoucherCount} contractor-MDA vouchers`
              : 'No direct GovSpend ERGP/contractor voucher linked',
        },
      ];

      const briefInput = {
        financialYear: targetYear,
        projectCode: resolvedProject.projectCode || 'ERGP',
        projectName: resolvedProject.projectName,
        agencyName: resolvedProject.agency || 'Federal MDA',
        state: resolvedProject.state || undefined,
        sector: resolvedProject.sector || undefined,
        page: resolvedProject.page || 1,
        amountNaira: resolvedProject.amount,
        formattedUsd: econMetrics.formattedUsd,
        formattedReal2026:
          econMetrics.constant2026Naira >= 1e9
            ? `₦${(econMetrics.constant2026Naira / 1e9).toFixed(2)}B`
            : `₦${(econMetrics.constant2026Naira / 1e6).toFixed(2)}M`,
        sourceFilename: provenance.filename,
        sha256: provenance.sha256,
        permalink,
        paidOnPaperPriority: lifecycle?.paidOnPaperPriority,
        paidOnPaperReason: lifecycle?.paidOnPaperReason,
        stages,
        contractors: (lifecycle?.nocopo?.contractors || []).map((c) => ({
          contractorName: c.contractorName,
          awardCount: c.awardCount,
          awardedNaira: c.awardedNaira,
          govspendPaidNaira: c.totalGovspendPaidNaira,
        })),
      };

      if (format === 'pdf') {
        await exportRecordForensicBriefPdf(briefInput);
      } else {
        await exportRecordForensicBriefDocx(briefInput);
      }
    } finally {
      setExportingFormat(null);
    }
  };

  const citations = useMemo(() => {
    if (!resolvedProject) return null;
    return formatRecordCitations({
      financialYear: targetYear,
      projectCode: resolvedProject.projectCode || 'ERGP',
      projectName: resolvedProject.projectName,
      amountNaira: resolvedProject.amount,
      agencyName: resolvedProject.agency || 'Federal MDA',
      page: resolvedProject.page || 1,
      state: resolvedProject.state,
      permalink,
      provenance,
    });
  }, [resolvedProject, targetYear, permalink, provenance]);

  const triggerCopy = (key: 'cite' | 'foi' | 'rep' | 'link', value: string) => {
    if (!value) return;
    navigator.clipboard?.writeText(value);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((p) => (p === key ? null : p)), 1800);
  };

  if (loading && !resolvedProject) {
    return (
      <div className="dossier-card" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        <span className="font-mono" style={{ fontSize: '0.85rem' }}>
          Hydrating Official Record Dossier for FY {targetYear} ({targetItem || 'line item'})...
        </span>
      </div>
    );
  }

  if (!resolvedProject) {
    return (
      <div className="dossier-card" style={{ padding: '2.25rem', maxWidth: '720px', margin: '1rem auto', textAlign: 'center' }}>
        <h2 className="font-editorial" style={{ margin: 0, fontSize: '1.4rem' }}>
          Official Record Not Found in FY {targetYear} Schedule
        </h2>
        <p style={{ margin: '0.5rem 0 1.25rem', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
          Line reference <strong className="font-mono">{targetItem || '(missing)'}</strong> could not be resolved in
          the FY {targetYear} appropriation dataset.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => onBackToObservatory(targetYear)} className="editorial-btn">
            <ArrowLeft size={14} /> Back to Observatory
          </button>
          <button type="button" onClick={() => onBrowseProjects(targetYear)} className="editorial-btn-primary">
            Browse FY {targetYear} Capital Projects
          </button>
        </div>
      </div>
    );
  }

  const president = getPresidentForYear(targetYear);
  const econ = computeEconomicRealityMetrics(resolvedProject.amount, targetYear);
  const foiDraft = `TO: Freedom of Information Desk\n${(resolvedProject.agency || 'FEDERAL MDA').toUpperCase()}\nFederal Secretariat Complex, Abuja.\n\nSUBJECT: FOI REQUEST REGARDING ${resolvedProject.projectCode || 'ERGP'} (FY ${targetYear} PAGE ${resolvedProject.page})\n\nPursuant to the Freedom of Information Act (2011), please provide procurement award records, physical site coordinates, and disbursement status for "${resolvedProject.projectName}" (₦${Math.round(resolvedProject.amount).toLocaleString()}, ${econ.formattedUsd}; ${president.presidentName} Administration).\n\nSource: ${provenance.filename}${provenance.sha256 ? ` (${provenance.sha256})` : ''}\nPermalink: ${permalink}`;
  const repDraft = `TO: National Assembly Appropriations / Oversight Committee\nRE: Public Accountability Inquiry — ${resolvedProject.projectCode || 'ERGP'} (FY ${targetYear}, p.${resolvedProject.page})\n\nLine Item: "${resolvedProject.projectName}"\nAllocation: ₦${Math.round(resolvedProject.amount).toLocaleString()} (${econ.formattedUsd})\nExecuting Agency: ${resolvedProject.agency || 'Federal MDA'}\nSource Schedule: ${provenance.filename}\nVerify via BudgetLens: ${permalink}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
      {/* Full-Viewport Navigation Bar */}
      <div
        className="dossier-card"
        style={{
          padding: '0.75rem 1.15rem',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => onBackToObservatory(targetYear)}
            className="editorial-btn"
          >
            <ArrowLeft size={14} /> Back to Observatory
          </button>
          <span className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            FULL RECORD DOSSIER · FY {targetYear} · {resolvedProject.projectCode || 'ERGP'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => handleExportRecordBrief('pdf')}
            disabled={exportingFormat !== null}
            className="editorial-btn-primary"
          >
            <FileText size={13} />
            {exportingFormat === 'pdf' ? 'Building PDF...' : 'Forensic Brief (PDF)'}
          </button>
          <button
            type="button"
            onClick={() => handleExportRecordBrief('docx')}
            disabled={exportingFormat !== null}
            className="editorial-btn"
          >
            <Download size={13} color="#059669" />
            {exportingFormat === 'docx' ? 'Building DOCX...' : 'Forensic Brief (DOCX)'}
          </button>
          <button
            type="button"
            onClick={() => triggerCopy('link', permalink)}
            className="editorial-btn"
          >
            {copiedKey === 'link' ? <Check size={13} color="#059669" /> : <Link2 size={13} />}
            {copiedKey === 'link' ? 'Permalink Copied' : 'Copy Canonical Permalink'}
          </button>
        </div>
      </div>

      {/* Main Content + Side-by-Side Action & Citation Rail */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
          gap: '1.15rem',
          alignItems: 'start',
        }}
      >
        <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
          <OfficialRecordCard
            project={resolvedProject}
            financialYear={targetYear}
            provenance={provenance}
            gemmaReview={gemmaReview}
            matchedDbRecord={matchedDbRecord}
            samePagePool={yearRecords}
            fullPageMode={true}
            onSelectSiblingRecord={(sib) => {
              window.location.href = buildRecordDossierUrl({
                year: targetYear,
                item: sib.recordIdentity.projectCode || sib.recordIdentity.id,
                page: sib.sourceProvenance?.pdfPage || 1,
              });
            }}
          />
          <ProjectLifecycleStepper
            project={resolvedProject}
            financialYear={targetYear}
          />
        </div>

        {/* Action & Citation Rail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {citations && (
            <div className="dossier-card" style={{ padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontWeight: 700, fontSize: '0.84rem' }}>
                  <Quote size={14} color="#059669" /> Verified Citations
                </span>
                <button
                  type="button"
                  onClick={() => triggerCopy('cite', citations[citationStyle])}
                  className="editorial-btn"
                  style={{ fontSize: '0.7rem', padding: '0.26rem 0.55rem' }}
                >
                  {copiedKey === 'cite' ? <Check size={12} color="#059669" /> : <Copy size={12} />}
                  {copiedKey === 'cite' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                {CITATION_STYLES.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setCitationStyle(opt.id)}
                    className={citationStyle === opt.id ? 'editorial-btn-primary' : 'editorial-btn'}
                    style={{ fontSize: '0.69rem', padding: '0.24rem 0.52rem' }}
                  >
                    {opt.shortLabel}
                  </button>
                ))}
              </div>
              <div
                className={citationStyle === 'bibtex' ? 'font-mono' : undefined}
                style={{
                  backgroundColor: '#0f1822',
                  color: '#e2e8f0',
                  borderRadius: '7px',
                  padding: '0.75rem',
                  fontSize: '0.72rem',
                  lineHeight: 1.5,
                  whiteSpace: citationStyle === 'bibtex' ? 'pre-wrap' : 'normal',
                  wordBreak: 'break-word',
                }}
              >
                {citations[citationStyle]}
              </div>
            </div>
          )}

          <div className="dossier-card" style={{ padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontWeight: 700, fontSize: '0.84rem' }}>
                <FileSignature size={14} color="#059669" /> FOI Act 2011 Request
              </span>
              <button
                type="button"
                onClick={() => triggerCopy('foi', foiDraft)}
                className="editorial-btn"
                style={{ fontSize: '0.7rem', padding: '0.26rem 0.55rem' }}
              >
                {copiedKey === 'foi' ? <Check size={12} color="#059669" /> : <Copy size={12} />}
                {copiedKey === 'foi' ? 'Copied' : 'Copy FOI'}
              </button>
            </div>
            <textarea
              readOnly
              value={foiDraft}
              style={{
                width: '100%',
                height: '135px',
                fontSize: '0.71rem',
                fontFamily: 'var(--font-mono)',
                padding: '0.6rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                backgroundColor: '#f8fafc',
                resize: 'none',
              }}
            />
          </div>

          <div className="dossier-card" style={{ padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontWeight: 700, fontSize: '0.84rem' }}>
                <Send size={14} color="#059669" /> Legislative Oversight Notice
              </span>
              <button
                type="button"
                onClick={() => triggerCopy('rep', repDraft)}
                className="editorial-btn"
                style={{ fontSize: '0.7rem', padding: '0.26rem 0.55rem' }}
              >
                {copiedKey === 'rep' ? <Check size={12} color="#059669" /> : <Copy size={12} />}
                {copiedKey === 'rep' ? 'Copied' : 'Copy Notice'}
              </button>
            </div>
            <textarea
              readOnly
              value={repDraft}
              style={{
                width: '100%',
                height: '115px',
                fontSize: '0.71rem',
                fontFamily: 'var(--font-mono)',
                padding: '0.6rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                backgroundColor: '#f8fafc',
                resize: 'none',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
