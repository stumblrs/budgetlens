import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileText,
  Hash,
  Landmark,
  Link2,
  Scale,
  Share2,
  ShieldCheck,
} from 'lucide-react';
import { getMacroForYear } from '../data/historicalMacroData';
import { getPresidentForYear } from '../data/presidentialTerms';
import {
  ProvenanceManifestResponse,
  loadSourceProvenance,
  resolveRecordProvenance,
} from '../utils/citationFormatter';
import { exportEvidenceSheetDocx, exportEvidenceSheetPdf } from '../utils/documentExporter';
import { formatEquivalentText, getEquivalents } from '../utils/relatableEquivalents';
import { formatNairaCompact } from '../utils/reportExporter';
import { buildCanonicalPermalink } from '../utils/urlState';

interface Props {
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
    ruleName?: string;
    severity?: string;
    sourceFilename?: string;
    sha256?: string;
    sourceProvenance?: {
      sourceFilename?: string;
      sha256Hash?: string;
    };
  };
  financialYear: number;
}

export const EvidenceShareCard: React.FC<Props> = ({ project, financialYear }) => {
  const [downloadingFormat, setDownloadingFormat] = useState<'pdf' | 'docx' | null>(null);
  const [copied, setCopied] = useState(false);
  const [manifest, setManifest] = useState<ProvenanceManifestResponse | null>(null);

  const year = project.financialYear || financialYear || 2026;

  useEffect(() => {
    let active = true;
    loadSourceProvenance().then((data) => {
      if (active && data) setManifest(data);
    });
    return () => {
      active = false;
    };
  }, []);

  const president = getPresidentForYear(year);
  const macro = getMacroForYear(year);
  const fxRate = macro.fxNairaPerUsd || 1500;
  const amountNaira = project.amount || 0;
  const amountExactStr = `₦${Math.round(amountNaira).toLocaleString('en-US')}`;
  const usdVal = amountNaira / fxRate;
  const formattedUsd =
    usdVal >= 100
      ? `$${Math.round(usdVal).toLocaleString('en-US')}`
      : `$${usdVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const budgetSharePct =
    macro.officialTotalBudget > 0 ? (amountNaira / macro.officialTotalBudget) * 100 : 0;
  const formattedSharePct =
    budgetSharePct >= 0.01 ? `${budgetSharePct.toFixed(3)}%` : `${budgetSharePct.toFixed(4)}%`;

  const sector = project.sector || 'Infrastructure';
  const agencyName = project.agency || project.ministry || `Federal MDA (${sector})`;
  const lineCode = project.projectCode || project.id || 'ERGP';
  const equivalents = getEquivalents(amountNaira, sector, 2, project.projectName);

  const provenance = useMemo(
    () =>
      resolveRecordProvenance(manifest, year, {
        sourceFilename: project.sourceFilename || project.sourceProvenance?.sourceFilename,
        agencyName,
        recordSha256: project.sha256 || project.sourceProvenance?.sha256Hash,
      }),
    [manifest, year, project.sourceFilename, project.sourceProvenance, agencyName, project.sha256]
  );

  const permalink =
    buildCanonicalPermalink({
      year,
      item: project.projectCode || project.id || 'record',
      page: project.page,
    }) || 'https://budgetlens.ng';

  const handleCopyLink = () => {
    const linkText = `[BudgetLens Verified Evidence Dossier Sheet] "${project.projectName}" (${lineCode}) — ${amountExactStr} (${formattedUsd} at FY ${year} CBN FX ₦${fxRate}/US$1; ${formattedSharePct} of FY ${year} Budget), ${agencyName}, ${president.presidentName} Administration. Source: ${provenance.filename} p.${project.page}${
      provenance.shortSha256 ? ` [SHA-256: ${provenance.shortSha256}]` : ''
    }. Permalink: ${permalink}`;
    navigator.clipboard.writeText(linkText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadDocument = async (format: 'pdf' | 'docx') => {
    if (downloadingFormat) return;
    setDownloadingFormat(format);
    try {
      const spec = {
        financialYear: year,
        projectCode: lineCode,
        projectName: project.projectName,
        amountNaira,
        agencyName,
        sector,
        state: project.state,
        page: project.page,
        ruleName: project.ruleName,
        severity: project.severity,
        equivalents: equivalents.map((e) => ({ label: formatEquivalentText(e), source: e.source })),
        permalink,
        sourceFilename: provenance.filename,
        sha256: provenance.sha256,
      };
      if (format === 'pdf') {
        await exportEvidenceSheetPdf(spec);
      } else {
        await exportEvidenceSheetDocx(spec);
      }
    } catch (err) {
      console.error(`Failed to generate ${format.toUpperCase()} evidence sheet:`, err);
    } finally {
      setDownloadingFormat(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
      {/* Institutional Verified Evidence Dossier Sheet */}
      <article
        style={{
          backgroundColor: 'var(--card-bg)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          overflow: 'hidden',
          boxShadow: '0 8px 24px -8px rgba(9, 16, 23, 0.16)',
        }}
      >
        {/* Obsidian & Emerald Top Masthead */}
        <div
          style={{
            backgroundColor: '#091017',
            borderTop: '4px solid var(--emerald-primary)',
            color: '#ffffff',
            padding: '0.95rem 1.2rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <ShieldCheck size={17} color="#10b981" />
            <span className="font-mono" style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.07em', color: '#6ee7b7' }}>
              VERIFIED EVIDENCE DOSSIER SHEET
            </span>
          </div>
          <span
            className="font-mono"
            style={{
              fontSize: '0.69rem',
              color: '#cbd5e1',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              padding: '0.18rem 0.55rem',
              borderRadius: '4px',
            }}
          >
            FY {year} · {president.presidentName} ({president.party})
          </span>
        </div>

        {/* Sheet Body */}
        <div style={{ padding: '1.15rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '0.95rem' }}>
          {/* Code / Sector / State Strip + Verbatim Description */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
              <span
                className="font-mono"
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  color: '#047857',
                  backgroundColor: 'var(--emerald-bg)',
                  border: '1px solid #a7f3d0',
                  padding: '0.12rem 0.45rem',
                  borderRadius: '4px',
                }}
              >
                CODE: {lineCode}
              </span>
              <span className="font-mono" style={{ fontSize: '0.69rem', color: 'var(--text-muted)' }}>
                SECTOR: {sector.toUpperCase()}
              </span>
              {project.state && (
                <span className="font-mono" style={{ fontSize: '0.69rem', color: 'var(--text-muted)' }}>
                  · LOCATION: {project.state.toUpperCase()}
                </span>
              )}
            </div>
            <blockquote
              className="font-editorial"
              style={{
                margin: 0,
                fontSize: '1.08rem',
                fontWeight: 600,
                lineHeight: 1.4,
                color: 'var(--text-primary)',
                borderLeft: '3px solid var(--emerald-primary)',
                paddingLeft: '0.75rem',
              }}
            >
              "{project.projectName}"
            </blockquote>
          </div>

          {/* 4-Cell Year-Native Fiscal & Page Citation Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.6rem' }}>
            <div style={{ backgroundColor: 'var(--card-subtle)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.65rem 0.75rem' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                As-Enacted Naira (₦)
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.02rem', fontWeight: 700, color: '#047857', marginTop: '0.15rem' }}>
                {formatNairaCompact(amountNaira)}
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '0.67rem', color: 'var(--text-secondary)' }}>
                {amountExactStr}
              </div>
            </div>

            <div style={{ backgroundColor: 'var(--card-subtle)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.65rem 0.75rem' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Historical US$ (FX)
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.02rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.15rem' }}>
                {formattedUsd}
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '0.67rem', color: 'var(--text-secondary)' }}>
                CBN Rate ₦{fxRate.toLocaleString('en-US')}/$
              </div>
            </div>

            <div style={{ backgroundColor: 'var(--card-subtle)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.65rem 0.75rem' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                % of Enacted Budget
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.02rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.15rem' }}>
                {formattedSharePct}
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '0.67rem', color: 'var(--text-secondary)' }}>
                Of {formatNairaCompact(macro.officialTotalBudget)} FY{year}
              </div>
            </div>

            <div style={{ backgroundColor: 'var(--card-subtle)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.65rem 0.75rem' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Official PDF Citation
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: '1.02rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.28rem' }}>
                <FileText size={14} color="var(--emerald-primary)" /> Page {project.page}
              </div>
              <div className="font-mono" style={{ fontSize: '0.67rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={provenance.filename}>
                {provenance.filename}
              </div>
            </div>
          </div>

          {/* Executing MDA, Administration & Cryptographic Provenance Box */}
          <div
            style={{
              backgroundColor: 'var(--card-subtle)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '0.75rem 0.9rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4rem',
              fontSize: '0.74rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: 'var(--text-primary)' }}>
              <Landmark size={13} color="var(--emerald-primary)" style={{ flexShrink: 0 }} />
              <span>
                <strong>Executing MDA:</strong> {agencyName}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: 'var(--text-secondary)' }}>
              <Scale size={13} color="var(--emerald-primary)" style={{ flexShrink: 0 }} />
              <span>
                <strong>Administration:</strong> {president.presidentName} ({president.termLabel})
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: 'var(--text-secondary)' }}>
              <Hash size={13} color="var(--emerald-primary)" style={{ flexShrink: 0 }} />
              <span className="font-mono" style={{ wordBreak: 'break-all' }}>
                <strong>Source PDF:</strong> {provenance.filename}
                {provenance.shortSha256 ? ` · SHA-256: ${provenance.shortSha256}…` : ''}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: 'var(--text-muted)' }}>
              <Link2 size={13} color="var(--emerald-primary)" style={{ flexShrink: 0 }} />
              <span className="font-mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={permalink}>
                {permalink}
              </span>
            </div>
          </div>

          {/* Year-Native Civic Equivalents */}
          {equivalents.length > 0 && (
            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
              {equivalents.map((eq, i) => (
                <span
                  key={i}
                  className="editorial-pill"
                  style={{
                    backgroundColor: 'var(--emerald-bg)',
                    border: '1px solid #a7f3d0',
                    color: '#065f46',
                    fontSize: '0.72rem',
                    padding: '0.28rem 0.65rem',
                  }}
                >
                  <span>{eq.emoji}</span>
                  <strong>{formatEquivalentText(eq)}</strong>
                  <span style={{ fontSize: '0.64rem', color: 'var(--text-muted)', fontWeight: 400 }}>({eq.source})</span>
                </span>
              ))}
            </div>
          )}

          {/* Institutional Verification Footer */}
          <div
            style={{
              borderTop: '1px solid var(--border-color)',
              paddingTop: '0.6rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.5rem',
              fontSize: '0.69rem',
              color: 'var(--text-muted)',
            }}
          >
            <span>Evidence — not accusations. Every record traces back to official Federal Appropriation PDFs.</span>
            <span className="font-mono" style={{ color: 'var(--emerald-primary)', fontWeight: 700 }}>
              BudgetLens Verified Sheet
            </span>
          </div>
        </div>
      </article>

      {/* Action Buttons: Strictly PDF, DOCX & Clipboard Summary */}
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => handleDownloadDocument('pdf')}
          disabled={downloadingFormat !== null}
          className="editorial-btn-primary"
          style={{ flex: '1 1 180px', justifyContent: 'center', padding: '0.62rem 1rem', fontSize: '0.82rem' }}
        >
          <FileText size={15} />
          {downloadingFormat === 'pdf' ? 'Building PDF...' : 'Download Evidence Sheet (PDF)'}
        </button>

        <button
          type="button"
          onClick={() => handleDownloadDocument('docx')}
          disabled={downloadingFormat !== null}
          className="editorial-btn"
          style={{
            flex: '1 1 180px',
            justifyContent: 'center',
            padding: '0.62rem 1rem',
            fontSize: '0.82rem',
            backgroundColor: '#091017',
            color: '#ffffff',
            borderColor: '#091017',
          }}
        >
          <Download size={15} color="#10b981" />
          {downloadingFormat === 'docx' ? 'Building DOCX...' : 'Download Evidence Sheet (DOCX)'}
        </button>

        <button
          type="button"
          onClick={handleCopyLink}
          className="editorial-btn"
          style={{ padding: '0.62rem 0.95rem', fontSize: '0.8rem' }}
        >
          {copied ? <CheckCircle2 size={15} color="#059669" /> : <Share2 size={15} />}
          {copied ? 'Copied!' : 'Copy Summary'}
        </button>
      </div>
    </div>
  );
};
