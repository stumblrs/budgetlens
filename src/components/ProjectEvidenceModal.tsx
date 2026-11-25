import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  ShieldCheck,
  FileText,
  Share2,
  CheckCircle2,
  FileSignature,
  Copy,
  Check,
  Sparkles,
  Send,
  AlertTriangle,
  UserCheck,
  Quote,
  Link2,
  Hash,
  ExternalLink,
  BookmarkPlus,
  Download,
  FileSpreadsheet,
} from 'lucide-react';
import { useCasebook } from '../context/CasebookContext';
import {
  exportFormalFoiPacketDocx,
  exportFormalFoiPacketPdf,
  exportOversightBriefDocx,
  exportOversightBriefPdf,
} from '../utils/documentExporter';
import { getEquivalents, formatEquivalentText } from '../utils/relatableEquivalents';
import { EvidenceShareCard } from './EvidenceShareCard';
import { OfficialRecordCard } from './OfficialRecordCard';
import { buildRecordDossierUrl } from '../utils/recordDossier';
import { useBudgetDatabase } from '../context/BudgetDatabaseContext';
import { getPresidentForYear } from '../data/presidentialTerms';
import { lookupConstituency } from '../data/constituenciesDirectory';
import { getMacroForYear } from '../data/historicalMacroData';
import { buildCanonicalPermalink } from '../utils/urlState';
import {
  CITATION_STYLES,
  CitationStyle,
  ProvenanceManifestResponse,
  formatRecordCitations,
  loadSourceProvenance,
  resolveRecordProvenance,
} from '../utils/citationFormatter';
import { resolveValidGemmaReview } from '../utils/gemmaReview';
import {
  loadProjectLifecycleForRecord,
  type ResolvedProjectLifecycle,
} from '../utils/projectLifecycle';
import {
  loadEvidenceEngineAllYears,
  lookupMdaRiskProfile,
  type CrossLedgerContextWire,
} from '../utils/evidenceEngineV3';
import { applyRules } from '../utils/ruleEngine';
import { ProjectLifecycleStepper } from './ProjectLifecycleStepper';

interface ProjectEvidenceProps {
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
    sourceFilename?: string;
    sha256?: string;
    sourceProvenance?: {
      documentId?: string;
      sourceFilename?: string;
      pdfPage?: number;
      sha256Hash?: string;
    };
    gemmaReview?: any;
  };
  financialYear: number;
  onClose: () => void;
}

interface FieldTipRecord {
  tip_id: string;
  project_id: string;
  financial_year: number;
  status: string;
  observation: string;
  reporter_alias: string;
  photos: string[];
  corroborations: number;
  moderation_status: string;
  moderation_note?: string;
  created_at_iso: string;
}

const TIPS_API_BASE =
  ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

const CITIZEN_TIP_LEGAL_BANNER =
  'Citizen Field Observation (Unverified Independent Report — Subject to Corroboration & Official BPP/Contractor Right-of-Reply)';

type ModalSubTab = 'evidence' | 'cite' | 'pdf' | 'action' | 'foi' | 'share';

export const ProjectEvidenceModal: React.FC<ProjectEvidenceProps> = ({
  project,
  financialYear,
  onClose,
}) => {
  const effectiveYear = project.financialYear || financialYear;
  const { getRecordsForYear, registryDocs } = useBudgetDatabase();
  const { pinItem, removePin, isPinned } = useCasebook();

  const [activeSubTab, setActiveSubTab] = useState<ModalSubTab>('evidence');
  const [selectedCitationStyle, setSelectedCitationStyle] = useState<CitationStyle>('newsroom');
  const [provenanceManifest, setProvenanceManifest] = useState<ProvenanceManifestResponse | null>(null);
  const [copiedKey, setCopiedKey] = useState<'foi' | 'rep' | 'cite' | 'link' | 'sha' | null>(null);
  const [tipText, setTipText] = useState('');
  const [tipStatus, setTipStatus] = useState('NOT_ON_GROUND');
  const [tipAlias, setTipAlias] = useState('');
  const [tipPhotos, setTipPhotos] = useState<File[]>([]);
  const [tipSubmitting, setTipSubmitting] = useState(false);
  const [tipError, setTipError] = useState<string | null>(null);
  const [tipSubmitted, setTipSubmitted] = useState(false);
  const [tipsList, setTipsList] = useState<FieldTipRecord[]>([]);
  const [tipsOffline, setTipsOffline] = useState(false);
  const [corroboratingId, setCorroboratingId] = useState<string | null>(null);
  const [lifecycle, setLifecycle] = useState<ResolvedProjectLifecycle | null>(null);
  const [crossLedgerCtx, setCrossLedgerCtx] = useState<CrossLedgerContextWire | null>(null);

  useEffect(() => {
    let active = true;
    loadEvidenceEngineAllYears().then((res) => {
      if (active && res?.crossLedgerContext) {
        setCrossLedgerCtx(res.crossLedgerContext);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    loadSourceProvenance().then((manifest) => {
      if (active && manifest) {
        setProvenanceManifest(manifest);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const triggerCopy = (key: 'foi' | 'rep' | 'cite' | 'link' | 'sha', value: string) => {
    if (!value) return;
    navigator.clipboard?.writeText(value);
    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 1800);
  };

  const formatNaira = (amt: number) => `₦${Math.round(amt).toLocaleString()}`;

  const sector = project.sector || 'Infrastructure';
  const agencyName =
    project.agency ||
    project.ministry ||
    (sector ? `Federal MDA (${sector})` : 'Federal Ministry / MDA');
  const projectCode = project.projectCode || 'ERGP';

  useEffect(() => {
    let active = true;
    loadProjectLifecycleForRecord({
      id: project.id,
      projectCode: project.projectCode,
      projectName: project.projectName,
      financialYear: effectiveYear,
      agency: project.agency || project.ministry || '',
    })
      .then((res) => {
        if (active) setLifecycle(res);
      })
      .catch(() => {
        if (active) setLifecycle(null);
      });
    return () => {
      active = false;
    };
  }, [project.id, project.projectCode, project.projectName, effectiveYear, project.agency, project.ministry]);
  const equivalents = getEquivalents(project.amount, sector, 2, project.projectName);

  const matchedDbRecord = useMemo(() => {
    const yearRecords = getRecordsForYear(effectiveYear);
    if (!yearRecords || yearRecords.length === 0) return undefined;
    const normCode = (project.projectCode || '').trim().toLowerCase();
    const normName = (project.projectName || '').trim().toLowerCase();

    return (
      yearRecords.find(
        (r) =>
          (project.id && r.recordIdentity.id === project.id) ||
          (normCode &&
            r.recordIdentity.projectCode.trim().toLowerCase() === normCode &&
            r.sourceProvenance.pdfPage === project.page)
      ) ||
      yearRecords.find(
        (r) =>
          r.recordIdentity.verbatimProjectName.trim().toLowerCase() === normName &&
          Math.abs(r.recordIdentity.amountNaira - project.amount) < 1
      )
    );
  }, [getRecordsForYear, effectiveYear, project.id, project.projectCode, project.page, project.projectName, project.amount]);

  const registryDoc = useMemo(
    () => registryDocs.find((d) => (d.financial_year || d.financialYear) === effectiveYear),
    [registryDocs, effectiveYear]
  );

  const provenance = useMemo(
    () =>
      resolveRecordProvenance(provenanceManifest, effectiveYear, {
        sourceFilename:
          project.sourceFilename ||
          project.sourceProvenance?.sourceFilename ||
          matchedDbRecord?.sourceProvenance?.sourceFilename,
        agencyName,
        recordSha256:
          project.sha256 ||
          project.sourceProvenance?.sha256Hash ||
          matchedDbRecord?.sourceProvenance?.sha256Hash,
        registryDoc,
      }),
    [provenanceManifest, effectiveYear, project, matchedDbRecord, agencyName, registryDoc]
  );

  const gemmaReview = useMemo(
    () => resolveValidGemmaReview(project, matchedDbRecord),
    [project, matchedDbRecord]
  );

  const president = getPresidentForYear(effectiveYear);
  const macro = getMacroForYear(effectiveYear);
  const usdEquivalent = project.amount / (macro.fxNairaPerUsd || 1500);
  const formattedUsd =
    usdEquivalent >= 100
      ? `$${Math.round(usdEquivalent).toLocaleString()}`
      : `$${usdEquivalent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const canonicalPermalink =
    buildCanonicalPermalink({
      year: effectiveYear,
      item: project.projectCode || project.id || projectCode,
      page: project.page,
    }) || 'https://budgetlens.ng';

  const citations = useMemo(
    () =>
      formatRecordCitations({
        financialYear: effectiveYear,
        projectCode,
        projectName: project.projectName,
        amountNaira: project.amount,
        agencyName,
        page: project.page,
        state: project.state,
        permalink: canonicalPermalink,
        provenance,
      }),
    [effectiveYear, projectCode, project.projectName, project.amount, agencyName, project.page, project.state, canonicalPermalink, provenance]
  );

  const constituencyMatch = useMemo(
    () => lookupConstituency(project.state, (project as { lga?: string }).lga, project.projectName),
    [project]
  );

  const mdaRiskProfile = useMemo(
    () => lookupMdaRiskProfile(crossLedgerCtx, agencyName),
    [crossLedgerCtx, agencyName]
  );

  const triggeredRulesForProject = useMemo(() => {
    const raw = {
      id: project.id || projectCode,
      projectCode,
      projectName: project.projectName,
      financialYear: effectiveYear,
      amount: project.amount,
      projectType: 'CAPITAL',
      page: project.page,
      sector,
      agency: agencyName,
    };
    return applyRules([raw], crossLedgerCtx);
  }, [project.id, projectCode, project.projectName, effectiveYear, project.amount, project.page, sector, agencyName, crossLedgerCtx]);

  useEffect(() => {
    if (activeSubTab !== 'action') return;
    let cancelled = false;
    fetch(
      `${TIPS_API_BASE}/api/tips?project_id=${encodeURIComponent(project.id || projectCode)}&year=${effectiveYear}`
    )
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        if (!cancelled) {
          setTipsList(Array.isArray(data?.tips) ? data.tips : []);
          setTipsOffline(false);
        }
      })
      .catch(() => {
        if (!cancelled) setTipsOffline(true);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSubTab, project.id, projectCode, effectiveYear]);

  const handleTipSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tipText.trim().length < 10) {
      setTipError('Please enter at least 10 characters describing your field observation.');
      return;
    }
    setTipSubmitting(true);
    setTipError(null);
    try {
      const form = new FormData();
      form.append('project_id', project.id || projectCode);
      form.append('financial_year', String(effectiveYear));
      form.append('project_code', projectCode);
      form.append('state', project.state || '');
      form.append('lga', (project as { lga?: string }).lga || '');
      form.append('status', tipStatus);
      form.append('observation', tipText.trim());
      form.append('reporter_alias', tipAlias.trim() || 'Anonymous Citizen');
      for (const file of tipPhotos.slice(0, 3)) {
        form.append('photos', file);
      }
      const res = await fetch(`${TIPS_API_BASE}/api/tips`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.detail || `HTTP ${res.status}`);
      }
      const payload = await res.json();
      if (payload?.tip) {
        setTipsList((prev) => [payload.tip, ...prev]);
      }
      setTipText('');
      setTipPhotos([]);
      setTipSubmitted(true);
      setTipsOffline(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to reach Citizen Verification API';
      setTipError(
        msg.includes('Failed to fetch') || msg.includes('NetworkError')
          ? 'Field report submission is temporarily unavailable.'
          : msg
      );
    } finally {
      setTipSubmitting(false);
    }
  };

  const handleCorroborate = async (tipId: string) => {
    setCorroboratingId(tipId);
    try {
      const res = await fetch(`${TIPS_API_BASE}/api/tips/${encodeURIComponent(tipId)}/corroborate`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.tip) {
          setTipsList((prev) => prev.map((t) => (t.tip_id === tipId ? data.tip : t)));
        }
      }
    } finally {
      setCorroboratingId(null);
    }
  };

  const provenanceFooterLine = provenance.sha256
    ? `Source Schedule: ${provenance.filename} (Page ${project.page}, SHA-256: ${provenance.shortSha256})`
    : `Source Schedule: ${provenance.filename} (Page ${project.page})`;

  const ccRepLine =
    constituencyMatch.matchedBy === 'lga_or_hint' && constituencyMatch.federalConstituency
      ? `CC: Representative for ${constituencyMatch.federalConstituency} Federal Constituency${constituencyMatch.senatorialDistrict ? ` & Senator for ${constituencyMatch.senatorialDistrict} Senatorial District` : ''}`
      : `CC: Representative for ${project.state || 'Federal Constituency'}`;

  const crossLedgerForensicBulletLines = useMemo(() => {
    const lines: string[] = [];
    if (lifecycle?.paidOnPaperPriority) {
      lines.push(`- Paid-on-Paper Record: ${lifecycle.paidOnPaperReason}`);
    }
    if (
      lifecycle?.billDiff?.status &&
      ['NEW_INSERTION', 'NASS_INSERTION', 'AMOUNT_INFLATED', 'ALLOCATION_INFLATED'].includes(
        lifecycle.billDiff.status
      )
    ) {
      lines.push(
        `- Legislative Bill-to-Act Markup: Status ${lifecycle.billDiff.status} (Delta: ${formatNaira(
          lifecycle.billDiff.deltaNaira || 0
        )}).`
      );
    }
    if (mdaRiskProfile && mdaRiskProfile.oi > 0) {
      lines.push(
        `- OAuGF Constitutional Audit Context: Executing MDA (${agencyName}) carries ${mdaRiskProfile.oi} Auditor-General audit queries${
          mdaRiskProfile.or > 0 ? ` (${mdaRiskProfile.or} repeat/unanswered directives)` : ''
        }.`
      );
    }
    if (mdaRiskProfile && mdaRiskProfile.po === 1) {
      lines.push(
        `- Open Treasury Risk Context: Executing MDA is flagged in federal payment records for personal staff-account disbursements or blank-description vouchers.`
      );
    }
    for (const r of triggeredRulesForProject.slice(0, 4)) {
      lines.push(`- Rule [${r.ruleId}]: ${r.reason}`);
    }
    return lines;
  }, [lifecycle, mdaRiskProfile, agencyName, triggeredRulesForProject]);

  // Representative Letter Template (§18.1)
  const repLetterText = `TO: Chairman, National Assembly Committee on Oversight
${ccRepLine}

RE: PUBLIC ACCOUNTABILITY NOTICE REGARDING APPROPRIATION ITEM (${projectCode})

Dear Honorable Representative,

I am writing to draw your attention to the following capital line item in the ${effectiveYear} Appropriation Act (Page ${project.page}, ${president.presidentName} Administration):

Project Title: "${project.projectName}"
Allocated Amount: ${formatNaira(project.amount)} (${formattedUsd} at FY ${effectiveYear} CBN rate)
Executing Agency: ${agencyName}
${provenanceFooterLine}
${
  crossLedgerForensicBulletLines.length > 0
    ? `\nObserved Cross-Ledger Public-Record Indicators:\n${crossLedgerForensicBulletLines.join('\n')}\n`
    : ''
}
As our elected representative, I request that your committee exercise its oversight function to verify that:
1. This project has a designated physical site and procurement schedule.
2. Funds allocated are disbursed transparently to verified contractors.

Respectfully submitted by a constituent,
Verified via BudgetLens Civic Fiscal Observatory (${canonicalPermalink})`;

  // FOI Draft Letter Template (§18.1)
  const foiLetterText = `TO: Freedom of Information Desk
${agencyName.toUpperCase()}
Federal Secretariat Complex, Abuja.

SUBJECT: FREEDOM OF INFORMATION (FOI) REQUEST REGARDING CAPITAL ALLOCATION
[REF: ${projectCode} | FY ${effectiveYear} APPROPRIATION SCHEDULE PAGE ${project.page}]

Dear Public Officer,

Pursuant to Section 2 and Section 4 of the Freedom of Information Act (2011), I hereby request official records regarding the following capital allocation in the ${effectiveYear} Federal Appropriation Act:

1. Project Description: "${project.projectName}"
2. Allocated Amount: ${formatNaira(project.amount)}
3. Budget Code / Line Reference: ${projectCode} (Page ${project.page})
4. Primary Document Source: ${provenanceFooterLine}
${
  crossLedgerForensicBulletLines.length > 0
    ? `\n5. Cross-Ledger Audit & Execution Context Requiring Clarification:\n${crossLedgerForensicBulletLines.join('\n')}\n`
    : ''
}
Specifically, I respectfully request access to:
a. The exact project site location, procurement award notice, and executing contractor details.
b. The physical completion progress report, payment vouchers, and disbursement timetable.
c. Bills of quantities (BOQ) and responses to any relevant Auditor-General (OAuGF) audit queries.

As provided by Section 5 of the FOI Act 2011, please provide these public records within 7 business days.

Yours faithfully,

Citizen Investigator / FOI Applicant
Verified via BudgetLens Civic Fiscal Observatory (${canonicalPermalink})`;

  const fullTabDossierUrl = buildRecordDossierUrl({
    year: effectiveYear,
    item: project.projectCode || project.id || projectCode,
    page: project.page,
  });

  const subTabs: Array<{ id: ModalSubTab; label: string; icon: React.ReactNode }> = [
    { id: 'evidence', label: 'Evidence & Summary', icon: <ShieldCheck size={15} /> },
    { id: 'cite', label: 'Cite Record', icon: <Quote size={15} /> },
    { id: 'pdf', label: `Official Record Card (p.${project.page})`, icon: <FileText size={15} /> },
    { id: 'action', label: 'Take Action (§18.1)', icon: <Send size={15} /> },
    { id: 'foi', label: 'Draft FOI Request', icon: <FileSignature size={15} /> },
    { id: 'share', label: 'Share Evidence Card (§18.6)', icon: <Share2 size={15} /> },
  ];

  return (
    <div
      className="mobile-sheet-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(9, 16, 23, 0.75)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.25rem',
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Evidence Record ${projectCode}`}
        className="mobile-sheet-panel"
        style={{
          width: '100%',
          maxWidth: '790px',
          maxHeight: '90dvh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--card-bg)',
          borderRadius: '12px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.30)',
          border: '1px solid var(--border-color)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mobile-sheet-handle" />
        {/* Modal Header */}
        <div
          style={{
            padding: '1.15rem 1.5rem',
            backgroundColor: '#091017',
            color: '#ffffff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '1rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
              <span
                style={{
                  fontSize: '0.68rem',
                  backgroundColor: '#10b981',
                  color: '#ffffff',
                  fontWeight: 700,
                  padding: '0.15rem 0.5rem',
                  borderRadius: '4px',
                }}
              >
                FY {effectiveYear} · Evidence Record
              </span>
              <span className="font-mono" style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                Ref: {projectCode}
              </span>
              {provenance.shortSha256 && (
                <span
                  className="font-mono"
                  style={{
                    fontSize: '0.66rem',
                    color: '#6ee7b7',
                    backgroundColor: 'rgba(16, 185, 129, 0.14)',
                    border: '1px solid rgba(16, 185, 129, 0.35)',
                    padding: '0.1rem 0.45rem',
                    borderRadius: '4px',
                  }}
                >
                  SHA-256: {provenance.shortSha256}…
                </span>
              )}
              {gemmaReview && (
                <span
                  className="font-mono"
                  style={{
                    fontSize: '0.66rem',
                    color: '#fef3c7',
                    backgroundColor: 'rgba(245, 158, 11, 0.16)',
                    border: '1px solid rgba(251, 191, 36, 0.42)',
                    padding: '0.1rem 0.45rem',
                    borderRadius: '4px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                  }}
                >
                  <Sparkles size={10} color="#fbbf24" /> AI Enriched ({gemmaReview.gemmaModelVersion})
                </span>
              )}
              {lifecycle?.paidOnPaperPriority && (
                <span
                  className="font-mono"
                  style={{
                    fontSize: '0.64rem',
                    color: '#ffffff',
                    backgroundColor: lifecycle.paidOnPaperTier === 'DIRECT_PROJECT_PAID' ? '#b91c1c' : '#b45309',
                    border: '1px solid rgba(254, 202, 202, 0.55)',
                    padding: '0.1rem 0.45rem',
                    borderRadius: '4px',
                    fontWeight: 700,
                  }}
                >
                  Paid on Paper — Field Verification Priority
                </span>
              )}
              {effectiveYear >= 2009 && effectiveYear <= 2026 && (
                <span
                  className="font-mono"
                  style={{
                    fontSize: '0.64rem',
                    color: '#bfdbfe',
                    backgroundColor: 'rgba(59, 130, 246, 0.18)',
                    border: '1px solid rgba(96, 165, 250, 0.42)',
                    padding: '0.1rem 0.45rem',
                    borderRadius: '4px',
                  }}
                >
                  BIR Execution Source Indexed
                </span>
              )}
            </div>
            <h2 className="font-editorial" style={{ fontSize: '1.15rem', fontWeight: 600, color: '#ffffff', lineHeight: 1.32, maxWidth: '660px' }}>
              {project.projectName}
            </h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
            {(() => {
              const targetPinId = `line_item:${effectiveYear}:${(project.projectCode || project.id || project.projectName).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)}`;
              const pinned = isPinned(targetPinId);
              return (
                <button
                  type="button"
                  onClick={() => {
                    if (pinned) {
                      removePin(targetPinId);
                    } else {
                      const tags: Array<'OAuGF Query' | 'Treasury Cash' | 'Bill Insertion' | 'Paid on Paper' | 'Compound Risk' | 'Zombie Lineage'> = [];
                      if (lifecycle?.paidOnPaperPriority) tags.push('Paid on Paper');
                      if (
                        lifecycle?.billDiff?.status &&
                        ['NEW_INSERTION', 'NASS_INSERTION', 'AMOUNT_INFLATED', 'ALLOCATION_INFLATED'].includes(
                          lifecycle.billDiff.status
                        )
                      ) {
                        tags.push('Bill Insertion');
                      }
                      if ((mdaRiskProfile?.oi || 0) > 0) tags.push('OAuGF Query');
                      if (mdaRiskProfile?.po === 1) tags.push('Treasury Cash');
                      if (triggeredRulesForProject.length >= 2) tags.push('Compound Risk');

                      pinItem({
                        pinId: targetPinId,
                        kind: 'line_item',
                        financialYear: effectiveYear,
                        projectCode,
                        title: project.projectName,
                        mdaName: agencyName,
                        amountNaira: project.amount,
                        page: project.page,
                        sourceFilename: provenance.filename,
                        sha256: provenance.sha256,
                        ...(tags.length > 0 || mdaRiskProfile
                          ? {
                              ledgerProvenance: {
                                ledgerTags: tags,
                                triggeredRulesCount: triggeredRulesForProject.length,
                                oaugfQueryCount: mdaRiskProfile?.oi || 0,
                                oaugfRepeatCount: mdaRiskProfile?.or || 0,
                                mdaIntegrityGrade: mdaRiskProfile?.g || 'N/A',
                                paidOnPaper: Boolean(lifecycle?.paidOnPaperPriority),
                                billInsertionStatus: lifecycle?.billDiff?.status || null,
                                personalOrOpaqueCashFlag: mdaRiskProfile?.po === 1,
                              },
                            }
                          : {}),
                      });
                    }
                  }}
                  className="editorial-btn"
                  style={{
                    backgroundColor: pinned ? '#059669' : 'rgba(255,255,255,0.09)',
                    borderColor: pinned ? '#059669' : 'rgba(255,255,255,0.22)',
                    color: '#ffffff',
                    fontSize: '0.72rem',
                    padding: '0.32rem 0.6rem',
                  }}
                >
                  {pinned ? <Check size={12} /> : <BookmarkPlus size={12} />}
                  {pinned ? 'Pinned' : 'Pin to Casebook'}
                </button>
              );
            })()}
            <a
              href={fullTabDossierUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="editorial-btn"
              style={{
                backgroundColor: 'rgba(16, 185, 129, 0.16)',
                borderColor: 'rgba(16, 185, 129, 0.45)',
                color: '#6ee7b7',
                textDecoration: 'none',
                fontSize: '0.72rem',
                padding: '0.32rem 0.6rem',
              }}
            >
              <ExternalLink size={12} /> Open in New Tab
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close evidence modal"
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '0.2rem', flexShrink: 0 }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Action Tabs Header */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border-color)',
            backgroundColor: 'var(--card-subtle)',
            padding: '0 1.25rem',
            overflowX: 'auto',
            gap: '0.15rem',
          }}
        >
          {subTabs.map((tab) => {
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSubTab(tab.id)}
                style={{
                  padding: '0.75rem 0.85rem',
                  fontSize: '0.8rem',
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? 'var(--emerald-primary)' : 'var(--text-secondary)',
                  borderBottom: isActive ? '2px solid var(--emerald-primary)' : '2px solid transparent',
                  borderTop: 'none',
                  borderLeft: 'none',
                  borderRight: 'none',
                  backgroundColor: 'transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.38rem',
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.icon} {tab.label}
              </button>
            );
          })}
        </div>

        {/* Modal Body */}
        <div style={{ padding: '1.25rem 1.5rem', flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
          {activeSubTab === 'evidence' ? (
            <>
              {/* Key Metadata Cards Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 155px), 1fr))', gap: '0.75rem' }}>
                <div style={{ backgroundColor: 'var(--card-subtle)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Allocated Amount</div>
                  <div className="font-mono tabular-nums" style={{ fontSize: '1.08rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {formatNaira(project.amount)}
                  </div>
                  <div className="font-mono tabular-nums" style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                    {formattedUsd} @ FY {effectiveYear} CBN Rate
                  </div>
                </div>

                <div style={{ backgroundColor: 'var(--card-subtle)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Executing Agency</div>
                  <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={agencyName}>
                    {agencyName}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                    {president.presidentName} Term
                  </div>
                </div>

                <div style={{ backgroundColor: 'var(--card-subtle)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Page Citation</div>
                  <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <FileText size={15} color="var(--emerald-primary)" /> Page {project.page} ({effectiveYear})
                  </div>
                  <div className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={provenance.filename}>
                    {provenance.filename}
                  </div>
                </div>
              </div>

              {/* Unified 5-Stage Lifecycle Timeline & Paid-on-Paper Priority */}
              <ProjectLifecycleStepper
                project={project}
                financialYear={effectiveYear}
                compact={true}
                onJumpToFieldVerify={() => setActiveSubTab('action')}
              />

              {/* Stage 6: Constitutional Audit (OAuGF) & 6-Ledger MDA Risk Profile */}
              {mdaRiskProfile && (mdaRiskProfile.oi > 0 || mdaRiskProfile.po === 1 || mdaRiskProfile.cf.length > 0 || mdaRiskProfile.g !== 'N/A') && (
                <div
                  style={{
                    backgroundColor: mdaRiskProfile.oi >= 10 || mdaRiskProfile.g === 'F' ? '#fef2f2' : '#f8fafc',
                    border:
                      mdaRiskProfile.oi >= 10 || mdaRiskProfile.g === 'F'
                        ? '1px solid #fecaca'
                        : '1px solid var(--border-color)',
                    borderRadius: '8px',
                    padding: '0.9rem 1.05rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.45rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                      <AlertTriangle
                        size={15}
                        color={mdaRiskProfile.oi >= 10 || mdaRiskProfile.g === 'F' ? '#b91c1c' : '#b45309'}
                      />
                      <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        Stage 6: Constitutional Audit (OAuGF) &amp; 6-Ledger MDA Risk Profile
                      </span>
                    </div>
                    <a
                      href={`/?tab=oaugf&year=${effectiveYear}`}
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        color: '#b91c1c',
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                      }}
                    >
                      Inspect in OAuGF Explorer <ExternalLink size={11} />
                    </a>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.55rem', fontSize: '0.74rem' }}>
                    <div style={{ backgroundColor: '#ffffff', padding: '0.48rem 0.65rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>OAuGF Audit Queries</div>
                      <div className="font-mono tabular-nums" style={{ fontSize: '0.92rem', fontWeight: 700, color: mdaRiskProfile.oi > 0 ? '#b91c1c' : 'var(--text-primary)' }}>
                        {mdaRiskProfile.oi.toLocaleString()} queries
                        {mdaRiskProfile.or > 0 ? ` (${mdaRiskProfile.or} repeat)` : ''}
                      </div>
                    </div>
                    <div style={{ backgroundColor: '#ffffff', padding: '0.48rem 0.65rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>MDA Integrity Grade</div>
                      <div className="font-mono tabular-nums" style={{ fontSize: '0.92rem', fontWeight: 700, color: mdaRiskProfile.g === 'F' || mdaRiskProfile.g === 'D' ? '#b91c1c' : 'var(--text-primary)' }}>
                        Grade {mdaRiskProfile.g}
                        {mdaRiskProfile.s !== null ? ` (${mdaRiskProfile.s}/100)` : ''}
                      </div>
                    </div>
                    <div style={{ backgroundColor: '#ffffff', padding: '0.48rem 0.65rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Treasury Payout Risk</div>
                      <div className="font-mono" style={{ fontSize: '0.78rem', fontWeight: 700, color: mdaRiskProfile.po === 1 ? '#1e40af' : '#059669' }}>
                        {mdaRiskProfile.po === 1 ? 'Personal / Opaque Payouts Flagged' : 'Standard Corporate Payouts'}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Relatable Equivalents Section (§18.4) */}
              {equivalents.length > 0 && (
                <div style={{ backgroundColor: 'var(--emerald-bg)', border: '1px solid #a7f3d0', borderRadius: '8px', padding: '0.85rem 1rem' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#047857', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <Sparkles size={14} color="#10b981" /> Relatable Human-Scale Equivalent (§18.4)
                  </div>
                  <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                    {equivalents.map((eq, idx) => (
                      <div key={idx} style={{ backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '0.35rem 0.65rem', fontSize: '0.8rem', color: '#0f172a', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span>{eq.emoji}</span>
                        <span>{formatEquivalentText(eq)}</span>
                        <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 400 }}>({eq.source})</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: '#065f46', marginTop: '0.4rem' }}>
                    Sourced from cited Nigerian agency baseline averages. Displayed for citizen comprehension only.
                  </div>
                </div>
              )}

              {/* Gemma AI Pre-Computed Citizen & Forensic Audit Card */}
              {gemmaReview && (
                <div style={{ backgroundColor: '#0d131d', border: '1px solid #1f2937', borderRadius: '8px', padding: '1rem', color: '#ffffff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.6rem' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#10b981', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <Sparkles size={16} /> Gemma AI Pre-Computed Audit &amp; Citizen Impact Brief
                    </div>
                    <span className="font-mono" style={{ fontSize: '0.66rem', color: '#94a3b8' }}>
                      {gemmaReview.gemmaModelVersion}
                      {gemmaReview.processedAt ? ` · ${gemmaReview.processedAt.slice(0, 10)}` : ''}
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: '0.6rem', marginBottom: '0.75rem', fontSize: '0.75rem' }}>
                    <div style={{ backgroundColor: '#111827', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid #1f2937' }}>
                      <span style={{ color: '#94a3b8' }}>Target Location: </span>
                      <strong style={{ color: '#ffffff' }}>{gemmaReview.location?.lga || 'Nationwide'}, {gemmaReview.location?.state || 'Nationwide'} ({gemmaReview.location?.geopoliticalZone || 'FCT'})</strong>
                    </div>
                    <div style={{ backgroundColor: '#111827', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid #1f2937' }}>
                      <span style={{ color: '#94a3b8' }}>SDG Target: </span>
                      <strong style={{ color: '#34d399' }}>{gemmaReview.impact?.sdgGoal || 'SDG 9: Industry & Infrastructure'}</strong>
                    </div>
                  </div>

                  {gemmaReview.impact?.auditQuestion && (
                    <div style={{ fontSize: '0.775rem', backgroundColor: '#1e293b', borderLeft: '3px solid #10b981', padding: '0.6rem 0.8rem', borderRadius: '4px', marginBottom: '0.6rem' }}>
                      <div style={{ fontWeight: 700, color: '#10b981', marginBottom: '0.2rem' }}>On-Site Citizen Verification Question:</div>
                      <div style={{ color: '#e2e8f0' }}>{gemmaReview.impact.auditQuestion}</div>
                    </div>
                  )}

                  {gemmaReview.impact?.opportunityCostText && (
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                      <strong style={{ color: '#fbbf24' }}>Opportunity Impact:</strong> {gemmaReview.impact.opportunityCostText}
                    </div>
                  )}
                </div>
              )}

              {/* Review Criteria Checklist */}
              <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1.15rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.7rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                  <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <ShieldCheck size={17} color="var(--emerald-primary)" /> Why Flagged (Rule Engine v3.0 &amp; Verification Criteria)
                  </h3>
                  <span style={{ fontSize: '0.72rem', backgroundColor: triggeredRulesForProject.length > 0 ? '#fef2f2' : 'var(--emerald-bg)', color: triggeredRulesForProject.length > 0 ? '#b91c1c' : '#047857', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '12px' }}>
                    {triggeredRulesForProject.length > 0
                      ? `${triggeredRulesForProject.length} Forensic Rule${triggeredRulesForProject.length === 1 ? '' : 's'} Triggered`
                      : 'Line Code Verified'}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                  {triggeredRulesForProject.map((ruleHit) => (
                    <div
                      key={ruleHit.ruleId}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '0.5rem',
                        fontSize: '0.79rem',
                        color: 'var(--text-primary)',
                        backgroundColor:
                          ruleHit.ledgerScope === 'CROSS_LEDGER' ? '#eff6ff' : 'var(--card-subtle)',
                        border:
                          ruleHit.ledgerScope === 'CROSS_LEDGER'
                            ? '1px solid #bfdbfe'
                            : '1px solid var(--border-color)',
                        padding: '0.5rem 0.65rem',
                        borderRadius: '6px',
                      }}
                    >
                      <AlertTriangle
                        size={14}
                        color={ruleHit.severity === 'high' ? '#b91c1c' : '#b45309'}
                        style={{ marginTop: '2px', flexShrink: 0 }}
                      />
                      <div>
                        <div style={{ fontWeight: 700 }}>
                          {ruleHit.ruleName}{' '}
                          <span className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                            [{ruleHit.ruleId} · {ruleHit.ledgerScope === 'CROSS_LEDGER' ? '6-Ledger Cross-Check' : 'Domain Rule'}]
                          </span>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
                          {ruleHit.reason}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    <CheckCircle2 size={15} color="#10b981" style={{ marginTop: '2px', flexShrink: 0 }} />
                    <span><strong>Budget Magnitude Benchmark:</strong> Allocated {formatNaira(project.amount)} ({formattedUsd} at FY {effectiveYear} CBN FX rate of ₦{macro.fxNairaPerUsd.toLocaleString()}/US$).</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    <CheckCircle2 size={15} color="#10b981" style={{ marginTop: '2px', flexShrink: 0 }} />
                    <span><strong>Verified Extracted Line Item:</strong> Code <strong className="font-mono">{projectCode}</strong> parsed directly from "{provenance.filename}" (Page {project.page}).</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    <CheckCircle2 size={15} color="#10b981" style={{ marginTop: '2px', flexShrink: 0 }} />
                    <span><strong>Administration Attribution:</strong> Enacted during the {president.presidentName} Administration ({president.termLabel}).</span>
                  </div>
                </div>
              </div>

              {/* Source Integrity Guarantee Card */}
              <div
                style={{
                  backgroundColor: 'var(--emerald-bg)',
                  border: '1px solid #a7f3d0',
                  borderRadius: '8px',
                  padding: '0.9rem 1rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '1rem',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ flex: '1 1 360px' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#047857', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <ShieldCheck size={16} /> Cryptographic Source Integrity &amp; Trust Guarantee
                  </div>
                  <p style={{ fontSize: '0.73rem', color: '#065f46', marginTop: '0.25rem', lineHeight: 1.45 }}>
                    Verified against <strong className="font-mono">{provenance.filename}</strong>
                    {provenance.sha256 ? (
                      <> · Digest <span className="font-mono">{provenance.shortSha256}…</span></>
                    ) : null}
                    . Cite directly in newsroom reports, academic papers, or legislative filings.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSubTab('cite')}
                  className="editorial-btn-primary"
                  style={{ flexShrink: 0 }}
                >
                  <Quote size={14} /> Cite &amp; Verify SHA-256
                </button>
              </div>
            </>
          ) : activeSubTab === 'cite' ? (
            /* Sub-Tab 2: Academic, Media & Legal Citation Engine + SHA-256 Provenance */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Cryptographic Source Provenance Card */}
              <div
                style={{
                  backgroundColor: 'var(--card-subtle)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  padding: '1rem 1.1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    <ShieldCheck size={16} color="var(--emerald-primary)" />
                    Cryptographic Source Provenance
                  </div>
                  <span
                    className="editorial-pill"
                    style={{
                      backgroundColor: 'var(--emerald-bg)',
                      color: '#047857',
                      border: '1px solid #a7f3d0',
                    }}
                  >
                    {provenance.matchedExactFile ? 'Matched Source PDF' : 'Primary FY Schedule'}
                    {provenance.fileCountForYear > 1 ? ` · ${provenance.fileCountForYear} FY ${effectiveYear} PDFs` : ''}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.65rem', fontSize: '0.75rem' }}>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Source Document Filename
                    </div>
                    <div className="font-mono" style={{ fontWeight: 600, color: 'var(--text-primary)', marginTop: '0.12rem', wordBreak: 'break-word' }}>
                      {provenance.filename}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Schedule Page &amp; Line Code
                    </div>
                    <div className="font-mono" style={{ fontWeight: 600, color: 'var(--text-primary)', marginTop: '0.12rem' }}>
                      Page {project.page} · Code {projectCode}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Administration &amp; Year-Native FX
                    </div>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginTop: '0.12rem' }}>
                      {president.presidentName} · {formatNaira(project.amount)} ({formattedUsd})
                    </div>
                  </div>
                </div>

                {/* Full SHA-256 Hash Row */}
                <div
                  style={{
                    backgroundColor: 'var(--card-bg)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    padding: '0.6rem 0.8rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ minWidth: 0, flex: '1 1 320px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      <Hash size={12} color="var(--emerald-primary)" /> Official PDF SHA-256 Checksum
                    </div>
                    <div className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--text-primary)', wordBreak: 'break-all', marginTop: '0.15rem', userSelect: 'all' }}>
                      {provenance.sha256 || 'SHA-256 verification digest unavailable for this offline session.'}
                    </div>
                  </div>
                  {provenance.sha256 && (
                    <button
                      type="button"
                      onClick={() => triggerCopy('sha', provenance.sha256 || '')}
                      className="editorial-btn"
                      style={{ flexShrink: 0, fontSize: '0.72rem', padding: '0.35rem 0.65rem' }}
                    >
                      {copiedKey === 'sha' ? <Check size={13} color="#059669" /> : <Copy size={13} />}
                      {copiedKey === 'sha' ? 'SHA Copied' : 'Copy SHA-256'}
                    </button>
                  )}
                </div>

                {/* Canonical Permalink Row */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    fontSize: '0.72rem',
                    color: 'var(--text-secondary)',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0, flex: '1 1 280px' }}>
                    <Link2 size={13} color="var(--emerald-primary)" style={{ flexShrink: 0 }} />
                    <span className="font-mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={canonicalPermalink}>
                      {canonicalPermalink}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => triggerCopy('link', canonicalPermalink)}
                    className="editorial-btn"
                    style={{ flexShrink: 0, fontSize: '0.72rem', padding: '0.32rem 0.65rem' }}
                  >
                    {copiedKey === 'link' ? <Check size={13} color="#059669" /> : <Link2 size={13} />}
                    {copiedKey === 'link' ? 'Permalink Copied' : 'Copy Permalink'}
                  </button>
                </div>
              </div>

              {/* 4-Style Citation Switcher */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Ready-to-Cite Formats
                  </div>
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {CITATION_STYLES.map((styleOpt) => {
                      const active = selectedCitationStyle === styleOpt.id;
                      return (
                        <button
                          key={styleOpt.id}
                          type="button"
                          onClick={() => setSelectedCitationStyle(styleOpt.id)}
                          className="editorial-pill"
                          style={{
                            border: active ? '1px solid var(--emerald-primary)' : '1px solid var(--border-color)',
                            backgroundColor: active ? 'var(--emerald-bg)' : 'var(--card-bg)',
                            color: active ? '#047857' : 'var(--text-secondary)',
                            fontWeight: active ? 700 : 500,
                            padding: '0.28rem 0.65rem',
                          }}
                        >
                          {styleOpt.shortLabel}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div
                  className={selectedCitationStyle === 'bibtex' ? 'font-mono' : undefined}
                  style={{
                    backgroundColor: '#0f1822',
                    color: '#e2e8f0',
                    borderRadius: '8px',
                    border: '1px solid #1e293b',
                    padding: '0.95rem 1rem',
                    fontSize: selectedCitationStyle === 'bibtex' ? '0.73rem' : '0.8rem',
                    lineHeight: 1.55,
                    whiteSpace: selectedCitationStyle === 'bibtex' ? 'pre-wrap' : 'normal',
                    wordBreak: 'break-word',
                    userSelect: 'all',
                  }}
                >
                  {citations[selectedCitationStyle]}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.71rem', color: 'var(--text-muted)' }}>
                    {CITATION_STYLES.find((s) => s.id === selectedCitationStyle)?.audience} · Clipboard text copy
                  </span>
                  <button
                    type="button"
                    onClick={() => triggerCopy('cite', citations[selectedCitationStyle])}
                    className="editorial-btn-primary"
                  >
                    {copiedKey === 'cite' ? <Check size={14} /> : <Copy size={14} />}
                    {copiedKey === 'cite' ? 'Citation Copied' : `Copy ${CITATION_STYLES.find((s) => s.id === selectedCitationStyle)?.shortLabel} Citation`}
                  </button>
                </div>
              </div>
            </div>
          ) : activeSubTab === 'action' ? (
            /* Sub-Tab 4: Take Action (§18.1 Action Loop) */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '10px', padding: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                  <div>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <UserCheck size={18} color="#10b981" /> 1. Contact Representative / Oversight Committee (§18.1)
                    </h3>
                    <p style={{ fontSize: '0.725rem', color: '#64748b' }}>
                      Send an official public accountability message to National Assembly oversight members
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() =>
                        exportOversightBriefPdf({
                          financialYear: effectiveYear,
                          projectCode,
                          projectName: project.projectName,
                          amountNaira: project.amount,
                          agencyName,
                          page: project.page,
                          state: project.state,
                          sourceFilename: provenance.filename,
                          sha256: provenance.sha256,
                          permalink: canonicalPermalink,
                        })
                      }
                      className="editorial-btn"
                      style={{ fontSize: '0.73rem' }}
                    >
                      <Download size={13} /> Oversight PDF
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        exportOversightBriefDocx({
                          financialYear: effectiveYear,
                          projectCode,
                          projectName: project.projectName,
                          amountNaira: project.amount,
                          agencyName,
                          page: project.page,
                          state: project.state,
                          sourceFilename: provenance.filename,
                          sha256: provenance.sha256,
                          permalink: canonicalPermalink,
                        })
                      }
                      className="editorial-btn"
                      style={{ fontSize: '0.73rem' }}
                    >
                      <FileSpreadsheet size={13} /> DOCX
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerCopy('rep', repLetterText)}
                      style={{
                        backgroundColor: copiedKey === 'rep' ? '#047857' : '#10b981',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '0.4rem 0.75rem',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        flexShrink: 0,
                      }}
                    >
                      {copiedKey === 'rep' ? <Check size={14} /> : <Copy size={14} />}
                      {copiedKey === 'rep' ? 'Copied Letter!' : 'Copy Letter to MP'}
                    </button>
                  </div>
                </div>

                <textarea
                  readOnly
                  value={repLetterText}
                  style={{
                    width: '100%',
                    height: '150px',
                    backgroundColor: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    padding: '0.75rem',
                    fontSize: '0.75rem',
                    fontFamily: 'var(--font-mono)',
                    color: '#0f172a',
                    lineHeight: 1.45,
                    resize: 'none',
                  }}
                />
              </div>

              <div style={{ backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '10px', padding: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <AlertTriangle size={18} color="#f59e0b" /> 2. Citizen Field Tip Channel (§18.1)
                  </h3>
                  <div style={{ marginTop: '0.35rem', padding: '0.45rem 0.65rem', borderRadius: '6px', backgroundColor: '#fffbeb', border: '1px solid #fde68a', fontSize: '0.7rem', fontWeight: 700, color: '#92400e' }}>
                    {CITIZEN_TIP_LEGAL_BANNER}
                  </div>
                  {lifecycle?.paidOnPaperPriority && (
                    <div
                      style={{
                        marginTop: '0.45rem',
                        padding: '0.6rem 0.75rem',
                        borderRadius: '6px',
                        backgroundColor: lifecycle.paidOnPaperTier === 'DIRECT_PROJECT_PAID' ? '#fef2f2' : '#fff7ed',
                        border:
                          lifecycle.paidOnPaperTier === 'DIRECT_PROJECT_PAID'
                            ? '1px solid #fecaca'
                            : '1px solid #fed7aa',
                        borderLeft:
                          lifecycle.paidOnPaperTier === 'DIRECT_PROJECT_PAID'
                            ? '4px solid #b91c1c'
                            : '4px solid #d97706',
                        fontSize: '0.74rem',
                        color: lifecycle.paidOnPaperTier === 'DIRECT_PROJECT_PAID' ? '#7f1d1d' : '#7c2d12',
                        lineHeight: 1.45,
                      }}
                    >
                      <div style={{ fontWeight: 700, marginBottom: '0.18rem' }}>
                        Paid on Paper — Field Verification Priority
                      </div>
                      <div>
                        {lifecycle.paidOnPaperReason}
                        {lifecycle.nocopo.contractors[0]?.contractorName
                          ? ` Awarded Contractor: ${lifecycle.nocopo.contractors[0].contractorName}.`
                          : ''}
                      </div>
                    </div>
                  )}
                </div>

                {tipsOffline && (
                  <div style={{ padding: '0.45rem 0.65rem', borderRadius: '6px', backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', fontSize: '0.72rem', color: '#475569' }}>
                    Live citizen field reports are temporarily unavailable.
                  </div>
                )}

                {tipSubmitted && (
                  <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #a7f3d0', borderRadius: '8px', padding: '0.65rem 0.85rem', color: '#047857', fontWeight: 600, fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Citizen Field Report persisted with EXIF/GPS metadata scrubbed.</span>
                    <button type="button" onClick={() => setTipSubmitted(false)} style={{ background: 'none', border: 'none', color: '#047857', textDecoration: 'underline', cursor: 'pointer', fontSize: '0.74rem' }}>
                      Add another
                    </button>
                  </div>
                )}

                <form onSubmit={handleTipSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <select
                      aria-label="Field verification status"
                      value={tipStatus}
                      onChange={(e) => setTipStatus(e.target.value)}
                      style={{ padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.78rem', backgroundColor: '#ffffff', color: '#0f172a' }}
                    >
                      <option value="NOT_ON_GROUND">Project Not Found on Ground</option>
                      <option value="ABANDONED_SITE">Abandoned Site</option>
                      <option value="STALLED_PARTIAL">Stalled / Partial Execution</option>
                      <option value="SUBSTANTIAL_COMPLETION">Substantial Completion</option>
                      <option value="VERIFIED_ON_GROUND">Verified Complete on Ground</option>
                      <option value="OTHER_OBSERVATION">Other Field Observation</option>
                    </select>
                    <input
                      type="text"
                      placeholder="Reporter alias (optional)"
                      value={tipAlias}
                      onChange={(e) => setTipAlias(e.target.value)}
                      style={{ flex: 1, minWidth: '150px', padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.78rem' }}
                    />
                  </div>
                  <textarea
                    placeholder="Describe field observations (min 10 chars, e.g. 'Visited LGA clinic site in Nov 2026; foundation unbuilt')..."
                    value={tipText}
                    onChange={(e) => setTipText(e.target.value)}
                    style={{
                      width: '100%',
                      height: '82px',
                      padding: '0.7rem',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.8rem',
                      outline: 'none',
                      resize: 'none',
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <label style={{ fontSize: '0.72rem', color: '#475569', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span>Photos (max 3, &le;5 MB, EXIF/GPS auto-stripped):</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        onChange={(e) => {
                          const selected = Array.from(e.target.files || []).slice(0, 3);
                          setTipPhotos(selected);
                        }}
                        style={{ fontSize: '0.72rem', maxWidth: '210px' }}
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={tipSubmitting}
                      style={{
                        backgroundColor: '#0f172a',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '0.5rem 1rem',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        cursor: tipSubmitting ? 'wait' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                      }}
                    >
                      {tipSubmitting ? 'Submitting...' : 'Submit Citizen Field Tip'} <Send size={14} color="#10b981" />
                    </button>
                  </div>
                  {tipError && (
                    <div style={{ fontSize: '0.74rem', color: '#b91c1c', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '0.45rem 0.65rem' }}>
                      {tipError}
                    </div>
                  )}
                </form>

                {tipsList.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.25rem' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
                      Recorded Field Observations ({tipsList.length})
                    </div>
                    {tipsList.map((tip) => (
                      <div key={tip.tip_id} style={{ padding: '0.6rem 0.75rem', borderRadius: '6px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', fontSize: '0.76rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem' }}>
                          <span style={{ fontWeight: 700, color: '#0f172a' }}>
                            {tip.status.replace(/_/g, ' ')} · <span style={{ fontWeight: 500, color: '#64748b' }}>{tip.reporter_alias}</span>
                          </span>
                          <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: '999px', backgroundColor: '#fef3c7', color: '#92400e' }}>
                            {tip.moderation_status}
                          </span>
                        </div>
                        <p style={{ margin: '0 0 0.35rem', color: '#334155', lineHeight: 1.4 }}>{tip.observation}</p>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.68rem', color: '#64748b' }}>
                          <span>{tip.photos.length} scrubbed photo(s) · {new Date(tip.created_at_iso).toLocaleDateString()}</span>
                          <button
                            type="button"
                            disabled={corroboratingId === tip.tip_id}
                            onClick={() => handleCorroborate(tip.tip_id)}
                            style={{ padding: '0.2rem 0.55rem', borderRadius: '4px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', color: '#0f172a', fontWeight: 600, cursor: 'pointer', fontSize: '0.7rem' }}
                          >
                            Corroborate ({tip.corroborations})
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : activeSubTab === 'foi' ? (
            /* Sub-Tab 5: FOI Request Generator (§18.1) */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                <div>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <FileSignature size={18} color="#10b981" /> Freedom of Information (FOI) Act Draft Letter
                  </h3>
                  <p style={{ fontSize: '0.725rem', color: '#64748b' }}>
                    Auto-generated formal request letter pursuant to FOI Act 2011 for citizen advocacy
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() =>
                      exportFormalFoiPacketPdf({
                        financialYear: effectiveYear,
                        projectCode,
                        projectName: project.projectName,
                        amountNaira: project.amount,
                        agencyName,
                        page: project.page,
                        state: project.state,
                        sourceFilename: provenance.filename,
                        sha256: provenance.sha256,
                        permalink: canonicalPermalink,
                      })
                    }
                    className="editorial-btn-primary"
                    style={{ fontSize: '0.74rem' }}
                  >
                    <Download size={13} /> Download FOI Packet (PDF)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      exportFormalFoiPacketDocx({
                        financialYear: effectiveYear,
                        projectCode,
                        projectName: project.projectName,
                        amountNaira: project.amount,
                        agencyName,
                        page: project.page,
                        state: project.state,
                        sourceFilename: provenance.filename,
                        sha256: provenance.sha256,
                        permalink: canonicalPermalink,
                      })
                    }
                    className="editorial-btn"
                    style={{ fontSize: '0.74rem' }}
                  >
                    <FileSpreadsheet size={13} /> FOI Packet (DOCX)
                  </button>
                  <button
                    type="button"
                    onClick={() => triggerCopy('foi', foiLetterText)}
                    style={{
                      backgroundColor: copiedKey === 'foi' ? '#047857' : '#10b981',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '0.45rem 0.85rem',
                      fontSize: '0.775rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      flexShrink: 0,
                    }}
                  >
                    {copiedKey === 'foi' ? <Check size={14} /> : <Copy size={14} />}
                    {copiedKey === 'foi' ? 'Copied to Clipboard!' : 'Copy FOI Letter'}
                  </button>
                </div>
              </div>

              <textarea
                readOnly
                value={foiLetterText}
                style={{
                  width: '100%',
                  height: '250px',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: '8px',
                  padding: '1rem',
                  fontSize: '0.76rem',
                  fontFamily: 'var(--font-mono)',
                  color: '#0f172a',
                  lineHeight: 1.45,
                  resize: 'none',
                }}
              />
            </div>
          ) : activeSubTab === 'pdf' ? (
            /* Sub-Tab 3: Clean Editorial Official Record Card + Virtual Schedule Context */
            <OfficialRecordCard
              project={project}
              financialYear={effectiveYear}
              provenance={provenance}
              gemmaReview={gemmaReview}
              matchedDbRecord={matchedDbRecord}
              samePagePool={getRecordsForYear(effectiveYear)}
              onOpenCitation={() => setActiveSubTab('cite')}
            />
          ) : (
            /* Sub-Tab 6: Shareable Evidence Card (§18.6) */
            <EvidenceShareCard project={project} financialYear={effectiveYear} />
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '0.95rem 1.5rem',
            backgroundColor: 'var(--card-subtle)',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}
        >
          <button type="button" onClick={onClose} className="editorial-btn">
            Close
          </button>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setActiveSubTab('cite')}
              className="editorial-btn"
              style={{ borderColor: '#a7f3d0', color: '#047857', backgroundColor: 'var(--emerald-bg)' }}
            >
              <Quote size={14} /> Cite Record
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('foi')}
              className="editorial-btn"
            >
              <FileSignature size={14} /> Generate FOI Request
            </button>
            <a
              href={fullTabDossierUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="editorial-btn"
              style={{ textDecoration: 'none' }}
            >
              <ExternalLink size={14} /> Open Full Record in New Tab
            </a>
            <button
              type="button"
              onClick={() => setActiveSubTab('pdf')}
              className="editorial-btn-primary"
            >
              <FileText size={14} /> Official Record Card (p.{project.page})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
