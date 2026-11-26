import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Hash,
  Layers,
  Quote,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { getPresidentForYear } from '../data/presidentialTerms';
import type { BudgetRecord } from '../services/budgetDatabaseEngine';
import type { ResolvedRecordProvenance } from '../utils/citationFormatter';
import {
  exportEvidenceSheetDocx,
  exportEvidenceSheetPdf,
  type TabularDossierSpec,
} from '../utils/documentExporter';
import { ExtractedPdfPreview } from './ExtractedPdfPreview';
import type { GemmaReviewPayload } from '../utils/gemmaReview';
import {
  buildRecordDossierUrl,
  computeEconomicRealityMetrics,
  sliceSamePageSiblings,
} from '../utils/recordDossier';
import { getEquivalents } from '../utils/relatableEquivalents';
import { applyRules } from '../utils/ruleEngine';
import { PresidentAvatar } from './PresidentAvatar';

interface OfficialRecordCardProps {
  project: {
    id?: string;
    projectCode?: string;
    projectName: string;
    amount: number;
    agency?: string;
    ministry?: string;
    page: number;
    state?: string;
    sector?: string;
    financialYear?: number;
  };
  financialYear: number;
  provenance: ResolvedRecordProvenance;
  gemmaReview: GemmaReviewPayload | null;
  matchedDbRecord?: BudgetRecord;
  samePagePool?: BudgetRecord[];
  fullPageMode?: boolean;
  onOpenCitation?: () => void;
  onSelectSiblingRecord?: (record: BudgetRecord) => void;
}

function formatNairaExact(amt: number): string {
  return `₦${Math.round(amt || 0).toLocaleString('en-US')}`;
}

function formatNairaCompact(amt: number): string {
  const abs = Math.abs(amt || 0);
  if (abs >= 1e12) return `₦${(amt / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `₦${(amt / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `₦${(amt / 1e6).toFixed(2)}M`;
  return formatNairaExact(amt);
}

export const OfficialRecordCard: React.FC<OfficialRecordCardProps> = ({
  project,
  financialYear,
  provenance,
  gemmaReview,
  matchedDbRecord,
  samePagePool = [],
  fullPageMode = false,
  onOpenCitation,
  onSelectSiblingRecord,
}) => {
  const [copiedSha, setCopiedSha] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null);

  const effectiveYear = project.financialYear || financialYear;
  const president = getPresidentForYear(effectiveYear);
  const agencyName =
    project.agency ||
    project.ministry ||
    matchedDbRecord?.mdaGovernanceTaxonomy?.mdaName ||
    'Federal Ministry / MDA';
  const sector =
    project.sector ||
    matchedDbRecord?.mdaGovernanceTaxonomy?.sector ||
    'Infrastructure';
  const projectCode = project.projectCode || matchedDbRecord?.recordIdentity?.projectCode || 'ERGP';
  const econ = computeEconomicRealityMetrics(project.amount, effectiveYear);
  const equivalents = useMemo(
    () => getEquivalents(project.amount, sector, 3, project.projectName),
    [project.amount, sector, project.projectName]
  );

  const ruleHits = useMemo(
    () =>
      applyRules([
        {
          ...project,
          id: project.id || projectCode,
          projectCode,
          agency: agencyName,
          sector,
          financialYear: effectiveYear,
          projectType: 'CAPITAL',
        },
      ]),
    [project, agencyName, sector, effectiveYear]
  );

  const siblingContext = useMemo(
    () =>
      sliceSamePageSiblings(
        samePagePool,
        {
          targetId: matchedDbRecord?.recordIdentity?.id || project.id,
          projectCode,
          projectName: project.projectName,
          page: project.page,
          agency: agencyName,
        },
        fullPageMode ? 30 : 12
      ),
    [samePagePool, matchedDbRecord, project.id, projectCode, project.projectName, project.page, agencyName, fullPageMode]
  );

  const newTabUrl = buildRecordDossierUrl({
    year: effectiveYear,
    item: project.projectCode || project.id || projectCode,
    page: project.page,
  });

  const handleCopySha = () => {
    if (!provenance.sha256) return;
    navigator.clipboard?.writeText(provenance.sha256);
    setCopiedSha(true);
    window.setTimeout(() => setCopiedSha(false), 1800);
  };

  const handleDownload = async (format: 'pdf' | 'docx') => {
    setExportingFormat(format);
    try {
      const topFlag = matchedDbRecord?.forensicEvidenceFlags?.[0] || ruleHits[0];
      const spec = {
        financialYear: effectiveYear,
        projectCode,
        projectName: project.projectName,
        amountNaira: project.amount,
        agencyName,
        sector,
        state: project.state || matchedDbRecord?.geographicTaxonomy?.state,
        page: project.page,
        ruleName: topFlag?.ruleName,
        severity: topFlag?.severity,
        equivalents: equivalents.map((e) => ({
          label: `${e.count.toLocaleString()} ${e.unit}`,
          source: e.source,
        })),
        permalink: newTabUrl,
        sourceFilename: provenance.filename,
        sha256: provenance.sha256,
      };
      if (format === 'pdf') {
        await exportEvidenceSheetPdf(spec);
      } else {
        await exportEvidenceSheetDocx(spec);
      }
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.05rem' }}>
      {/* Editorial Ledger Header Card */}
      <div
        className="dossier-card"
        style={{
          overflow: 'hidden',
          border: '1px solid var(--border-color)',
          backgroundColor: '#ffffff',
        }}
      >
        <div
          style={{
            backgroundColor: '#091017',
            borderTop: '4px solid #059669',
            padding: fullPageMode ? '1.35rem 1.6rem' : '1.05rem 1.25rem',
            color: '#ffffff',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.65rem',
              marginBottom: '0.65rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span
                className="font-mono"
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  letterSpacing: '0.07em',
                  color: '#6ee7b7',
                  textTransform: 'uppercase',
                }}
              >
                {provenance.enactedActTitle}
              </span>
              <span
                className="font-mono"
                style={{
                  fontSize: '0.68rem',
                  backgroundColor: 'rgba(255,255,255,0.08)',
                  color: '#e2e8f0',
                  padding: '0.14rem 0.48rem',
                  borderRadius: '4px',
                }}
              >
                Code: {projectCode} · Page {project.page}
              </span>
            </div>

            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.42rem',
                backgroundColor: 'rgba(255,255,255,0.07)',
                padding: '0.22rem 0.6rem 0.22rem 0.28rem',
                borderRadius: '999px',
              }}
            >
              <PresidentAvatar
                src={president.portraitPath}
                name={president.presidentName}
                initials={president.initials}
                accentColor={president.accentColor}
                size={22}
                party={president.party}
              />
              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#f8fafc' }}>
                {president.presidentName}
              </span>
            </div>
          </div>

          <h2
            className="font-editorial"
            style={{
              margin: 0,
              fontSize: fullPageMode ? '1.55rem' : '1.18rem',
              fontWeight: 600,
              lineHeight: 1.35,
              color: '#ffffff',
            }}
          >
            &ldquo;{project.projectName}&rdquo;
          </h2>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.7rem',
              marginTop: '0.9rem',
              paddingTop: '0.8rem',
              borderTop: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', fontSize: '0.73rem', color: '#cbd5e1' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.32rem' }}>
                <FileText size={13} color="#34d399" />
                <strong style={{ color: '#ffffff' }}>{provenance.filename}</strong>
              </span>
              {provenance.sha256 && (
                <button
                  type="button"
                  onClick={handleCopySha}
                  className="font-mono"
                  title="Copy full SHA-256 checksum"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.28rem',
                    fontSize: '0.67rem',
                    color: '#6ee7b7',
                    backgroundColor: 'rgba(16, 185, 129, 0.14)',
                    border: '1px solid rgba(16, 185, 129, 0.35)',
                    borderRadius: '4px',
                    padding: '0.14rem 0.48rem',
                  }}
                >
                  {copiedSha ? <Check size={11} /> : <Hash size={11} />}
                  {copiedSha ? 'SHA-256 Copied' : `${provenance.shortSha256 || provenance.sha256.slice(0, 16)}…`}
                  <Copy size={10} />
                </button>
              )}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'center' }}>
              {!fullPageMode && (
                <a
                  href={newTabUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="editorial-btn"
                  style={{
                    backgroundColor: '#10b981',
                    borderColor: '#10b981',
                    color: '#ffffff',
                    textDecoration: 'none',
                    fontSize: '0.73rem',
                  }}
                >
                  <ExternalLink size={13} /> Open Full Record in New Tab
                </a>
              )}
              {onOpenCitation && (
                <button
                  type="button"
                  onClick={onOpenCitation}
                  className="editorial-btn"
                  style={{ fontSize: '0.73rem' }}
                >
                  <Quote size={13} /> Cite
                </button>
              )}
              <button
                type="button"
                disabled={exportingFormat !== null}
                onClick={() => handleDownload('pdf')}
                className="editorial-btn"
                style={{ fontSize: '0.73rem' }}
              >
                <Download size={13} />
                {exportingFormat === 'pdf' ? 'PDF...' : 'PDF'}
              </button>
              <button
                type="button"
                disabled={exportingFormat !== null}
                onClick={() => handleDownload('docx')}
                className="editorial-btn"
                style={{ fontSize: '0.73rem' }}
              >
                <FileSpreadsheet size={13} />
                {exportingFormat === 'docx' ? 'DOCX...' : 'DOCX'}
              </button>
            </div>
          </div>
        </div>

        {/* 4-Metric Economic Reality Strip */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))',
            borderBottom: '1px solid var(--border-subtle)',
            backgroundColor: '#faf9f6',
          }}
        >
          <div style={{ padding: '0.85rem 1.1rem', borderRight: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
              As-Enacted Allocation
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.1rem', fontWeight: 700, color: '#047857', marginTop: '0.18rem' }}>
              {formatNairaExact(econ.nominalNaira)}
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>FY {effectiveYear} Nominal Naira</div>
          </div>

          <div style={{ padding: '0.85rem 1.1rem', borderRight: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
              Year-Native USD Value
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.18rem' }}>
              {econ.formattedUsd}
            </div>
            <div className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
              CBN FX ₦{econ.fxRate.toLocaleString('en-US')}/US$1
            </div>
          </div>

          <div style={{ padding: '0.85rem 1.1rem', borderRight: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
              Constant 2026 Purchasing Power
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.18rem' }}>
              {formatNairaCompact(econ.constant2026Naira)}
            </div>
            <div className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
              Deflator {econ.cpiDeflatorTo2026.toFixed(2)}&times;
            </div>
          </div>

          <div style={{ padding: '0.85rem 1.1rem' }}>
            <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
              Share of Enacted Budget
            </div>
            <div className="font-mono tabular-nums" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.18rem' }}>
              {econ.shareOfBudgetPct < 0.0001
                ? `${econ.shareOfBudgetPct.toFixed(6)}%`
                : `${econ.shareOfBudgetPct.toFixed(4)}%`}
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
              MDA: {agencyName}
            </div>
          </div>
        </div>

        {/* Forensic Flags, Gemma Brief, Civic Equivalents & Asset Tokens */}
        <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'center' }}>
            <span className="editorial-pill">
              <Layers size={12} color="#059669" /> Sector: {sector}
            </span>
            <span className="editorial-pill">
              Location: {project.state || matchedDbRecord?.geographicTaxonomy?.state || 'Federal / Multi-State'}
            </span>
            {matchedDbRecord?.multiYearLineage?.yearsAppeared?.length ? (
              <span className="editorial-pill font-mono">
                Lineage: {matchedDbRecord.multiYearLineage.yearsAppeared.join(', ')}
              </span>
            ) : null}
            {ruleHits.map((hit, idx) => (
              <span
                key={`${hit.ruleId}-${idx}`}
                className="editorial-pill"
                style={{
                  backgroundColor: hit.severity === 'high' ? '#fef2f2' : '#fffbeb',
                  color: hit.severity === 'high' ? '#b91c1c' : '#b45309',
                  borderColor: hit.severity === 'high' ? '#fecaca' : '#fde68a',
                }}
              >
                <AlertTriangle size={11} /> {hit.ruleName}
              </span>
            ))}
          </div>

          {equivalents.length > 0 && (
            <div
              style={{
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '0.75rem 0.95rem',
              }}
            >
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' }}>
                Civic Opportunity-Cost Benchmarks (FY {effectiveYear} Purchasing Power)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
                {equivalents.map((eq, idx) => (
                  <span key={idx} className="editorial-pill" style={{ backgroundColor: '#ffffff' }}>
                    <ShieldCheck size={12} color="#059669" /> {eq.emoji} {eq.count.toLocaleString()} {eq.unit} ({eq.source})
                  </span>
                ))}
              </div>
            </div>
          )}

          {gemmaReview && (
            <div
              style={{
                backgroundColor: '#ecfdf5',
                border: '1px solid #a7f3d0',
                borderRadius: '8px',
                padding: '0.85rem 1rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.74rem', fontWeight: 700, color: '#047857', marginBottom: '0.3rem' }}>
                <Sparkles size={13} /> Stage-2 AI Citizen Impact Audit ({gemmaReview.gemmaModelVersion})
              </div>
              {gemmaReview.impact?.auditQuestion && (
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#064e3b' }}>
                  Field Audit Question: {gemmaReview.impact.auditQuestion}
                </div>
              )}
              {gemmaReview.rationale && (
                <div style={{ fontSize: '0.76rem', color: '#065f46', marginTop: '0.25rem', lineHeight: 1.45 }}>
                  {gemmaReview.rationale}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Virtual Source Page Context Table (Surrounding Schedule Ledger) */}
      {siblingContext.rows.length > 0 && (
        <div className="dossier-card" style={{ overflow: 'hidden' }}>
          <div
            style={{
              padding: '0.8rem 1.15rem',
              borderBottom: '1px solid var(--border-subtle)',
              backgroundColor: '#faf9f6',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.5rem',
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700 }}>
                Verified Schedule Extract (PDF &amp; Ledger)
              </h3>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {siblingContext.scopeLabel} · Generated from verified extracted records
              </div>
            </div>
          </div>

          <div style={{ padding: '0.85rem' }}>
            <ExtractedPdfPreview
              spec={{
                filenameBase: `BudgetLens_FY${effectiveYear}_${projectCode}_Extract`,
                eyebrow: `BUDGETLENS VERIFIED RECORD & SCHEDULE EXTRACT · FY ${effectiveYear}`,
                title: project.projectName,
                subtitle: `${agencyName} · Page ${project.page} · ${president.presidentName} (${president.termLabel})`,
                orientation: 'portrait',
                metadata: [
                  { label: 'Project Code', value: projectCode },
                  { label: 'Fiscal Year', value: `FY ${effectiveYear}` },
                  { label: 'Schedule Page', value: `Page ${project.page}` },
                  { label: 'Source Schedule', value: provenance.filename },
                ],
                kpis: [
                  { label: 'Allocation', value: formatNairaExact(project.amount) },
                  { label: 'USD Equivalent', value: econ.formattedUsd },
                  { label: 'Context Rows', value: String(siblingContext.rows.length) },
                ],
                tables: [
                  {
                    heading: `${siblingContext.scopeLabel} (Page ${project.page})`,
                    columns: ['Code', 'Schedule Line Item', 'Executing MDA', 'Allocation (₦)'],
                    rows: siblingContext.rows.map(({ record, isTarget }) => [
                      `${record.recordIdentity.projectCode || 'ERGP'}${isTarget ? ' [CITED]' : ''}`,
                      record.recordIdentity.verbatimProjectName,
                      record.mdaGovernanceTaxonomy.mdaName,
                      formatNairaExact(record.recordIdentity.amountNaira),
                    ]),
                    rightAlignColumns: [3],
                  },
                ],
                sha256: provenance.sha256,
                sourceFilename: provenance.filename,
                permalink: newTabUrl,
                footnote: `Generated directly from verified BudgetLens FY ${effectiveYear} appropriation records.`,
              } satisfies TabularDossierSpec}
              title={`FY ${effectiveYear} Record & Page ${project.page} PDF`}
              subtitle={projectCode}
              minHeight="52vh"
            >
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                      <th style={{ padding: '0.55rem 0.95rem' }}>Code</th>
                      <th style={{ padding: '0.55rem 0.95rem' }}>Schedule Line Item</th>
                      <th style={{ padding: '0.55rem 0.95rem' }}>Executing MDA</th>
                      <th style={{ padding: '0.55rem 0.95rem', textAlign: 'right' }}>Allocation (₦)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {siblingContext.rows.map(({ record, isTarget }, idx) => (
                      <tr
                        key={`${record.recordIdentity.id}-${idx}`}
                        onClick={() => {
                          if (!isTarget) onSelectSiblingRecord?.(record);
                        }}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          backgroundColor: isTarget ? '#ecfdf5' : '#ffffff',
                          cursor: !isTarget && onSelectSiblingRecord ? 'pointer' : 'default',
                        }}
                      >
                        <td className="font-mono" style={{ padding: '0.55rem 0.95rem', fontWeight: 700, color: isTarget ? '#047857' : '#059669' }}>
                          {record.recordIdentity.projectCode || 'ERGP'}
                        </td>
                        <td style={{ padding: '0.55rem 0.95rem', fontWeight: isTarget ? 700 : 500, color: 'var(--text-primary)' }}>
                          {record.recordIdentity.verbatimProjectName}
                          {isTarget && (
                            <span
                              className="editorial-pill font-mono"
                              style={{
                                marginLeft: '0.45rem',
                                fontSize: '0.62rem',
                                backgroundColor: '#059669',
                                color: '#ffffff',
                                borderColor: '#059669',
                              }}
                            >
                              TARGET LINE
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '0.55rem 0.95rem', color: 'var(--text-muted)' }}>
                          {record.mdaGovernanceTaxonomy.mdaName}
                        </td>
                        <td className="font-mono tabular-nums" style={{ padding: '0.55rem 0.95rem', textAlign: 'right', fontWeight: 700 }}>
                          {formatNairaExact(record.recordIdentity.amountNaira)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ExtractedPdfPreview>
          </div>
        </div>
      )}
    </div>
  );
};
