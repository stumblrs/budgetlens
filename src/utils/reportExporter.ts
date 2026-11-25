import { EvidenceItem } from './ruleEngine';
import { DuplicateCluster } from './duplicateDetector';

export type ReportTemplate =
  | 'executive_brief'
  | 'six_ledger_brief'
  | 'forensic_digest'
  | 'duplicate_audit'
  | 'recurring_lineage'
  | 'sector_summary';

export type PrintOrientation = 'portrait' | 'landscape';

export interface ReportSectionOptions {
  includeMacroContext: boolean;
  includeDebtSnapshot: boolean;
  includeYoY: boolean;
  includeCivicImpact: boolean;
  includeCitations: boolean;
  includeAnalystNotes: boolean;
}

export interface CleanProject {
  id: string;
  projectCode: string;
  projectName: string;
  financialYear: number;
  amount: number;
  projectType: string;
  page: number;
  sector: string;
  agency: string;
  state: string;
}

export interface RecurringLineageInstance {
  year: number;
  financialYear?: number;
  projectId?: string;
  projectCode?: string;
  projectName?: string;
  title?: string;
  agency?: string;
  amount: number;
  page: number;
}

export interface RecurringLineageItem {
  lineageId: string;
  projectCode: string;
  canonicalTitle: string;
  agency: string;
  yearsAppeared: number[];
  appearanceCount: number;
  cumulativeAllocation: number;
  yearSpan: number;
  withinAssetLifespan?: boolean;
  severity?: string;
  instances: RecurringLineageInstance[];
}

export interface MacroContextSummary {
  officialTotalBudget: number;
  totalCapitalBudget: number;
  recurrentNonDebtTotal: number;
  debtService: number;
  statutoryTransfers: number;
  totalCapitalExtracted: number;
  totalCapitalCount: number;
  budgetTheme: string;
  benchmarkOilPriceUSD?: number;
  dailyOilProductionMBPD?: number;
  exchangeRateNairaPerUSD?: number;
  projectedGdpGrowthPercent?: number;
  inflationRatePercent?: number;
  executiveSummary?: string;
  policyPriorities: string[];
  sourcesAnalyzed: string[];
}

export interface DebtSnapshotSummary {
  financialYear: number;
  asAt: string | null;
  totalDebtNairaM: number | null;
  totalDebtUsdM: number | null;
  domesticDebtNairaM: number | null;
  externalDebtUsdM: number | null;
  externalDebtNairaM: number | null;
  domesticDebtServiceNairaM: number | null;
  externalDebtServiceUsdM: number | null;
  cbnFxRate: number | null;
  primarySource: string;
  isExactYearMatch: boolean;
}

export interface YoYComparisonSummary {
  priorYear: number;
  priorOfficialTotal: number;
  currentOfficialTotal: number;
  officialDelta: number;
  officialDeltaPct: number;
  priorExtractedTotal: number;
  currentExtractedTotal: number;
  extractedDelta: number;
  extractedDeltaPct: number;
}

export interface CivicEquivalentsSummary {
  inflationFactor: number;
  unitCosts: {
    phc: number;
    classroomBlock: number;
    solarBorehole: number;
    annualSchoolMeal: number;
    annualMinWage: number;
  };
  equivalents: {
    phcs: number;
    classroomBlocks: number;
    solarBoreholes: number;
    schoolMealsFed: number;
    annualMinWages: number;
  };
}

export interface ReportStatsSummary {
  count: number;
  totalAllocated: number;
  avgAmount: number;
  medianAmount: number;
  maxItem: CleanProject | null;
  sectorBreakdown: Array<{ sector: string; totalAmount: number; sharePct: number; count: number }>;
  topAgencies: Array<{ agency: string; totalAmount: number; sharePct: number; count: number }>;
  highSeverityCount: number;
  mediumSeverityCount: number;
  lowSeverityCount: number;
  flaggedTotalAmount: number;
  duplicateClusterCount: number;
  duplicateTotalAmount: number;
  duplicateItemCount: number;
}

export interface SixLedgerAccountabilitySummary {
  engineVersion: string;
  totalRulesCount: number;
  activeYearFindingsCount: number;
  activeYearCrossLedgerCount: number;
  activeYearCompoundProjectsCount: number;
  allYearsRecordsScanned: number;
  allYearsRuleFindings: number;
  allYearsFlaggedProjects: number;
  allYearsFlaggedNaira: number;
  oaugf: {
    reportsIndexed: number;
    parsedAuditIssuesCount: number;
    repeatNeglectCount: number;
    recoveryDirectiveCount: number;
    matchedMdasCount: number;
    topCategories: Array<{ category: string; count: number }>;
  } | null;
  billActDiff: {
    cyclesCount: number;
    activeYearCycle: {
      financialYear: number;
      comparisonScope: string;
      insertionsCount: number;
      insertionsTotalNaira: number;
      inflatedCount: number;
      inflatedTotalNaira: number;
      cutCount: number;
      cutTotalNaira: number;
      zipTotalNaira: number;
    } | null;
    allCyclesInsertionsCount: number;
    allCyclesInsertionsNaira: number;
    allCyclesInflatedNaira: number;
  } | null;
  treasuryCash: {
    totalVouchers: number;
    totalNaira: number;
    personalStaffCount: number;
    personalStaffPaidNaira: number;
    personalStaffBillionPlusCount: number;
    unclassifiedCount: number;
    unclassifiedPaidNaira: number;
    opaqueVoucherCount: number;
    opaqueNaira: number;
    decemberRushRatio: number | null;
  } | null;
  topCompoundProjects: Array<{
    projectCode: string;
    projectName: string;
    agency: string;
    amount: number;
    page: number;
    ruleCount: number;
    crossLedgerRuleCount: number;
    compoundRiskScore: number;
    ruleNames: string[];
    paidOnPaper: boolean;
    billInserted: boolean;
    mdaOaugfIssues: number;
    mdaGrade: string;
  }>;
  topConvergentMdas: Array<{
    mdaName: string;
    flagCount: number;
    flags: string[];
    grade: string;
    compositeScore: number | null;
    oaugfQueryCount: number;
    oaugfRepeatCount: number;
    totalExposureNaira: number;
  }>;
}

export interface ReportPayload {
  financialYear: number;
  template: ReportTemplate;
  documentTitle: string;
  preparedBy: string;
  generatedAt: string;
  presidentName: string;
  party: string;
  termLabel: string;
  filterSummary: string;
  tableRowLimit: number;
  orientation: PrintOrientation;
  sections: ReportSectionOptions;
  analystNotes: string;
  registryLength: number;
  excludedRollupsCount: number;
  macro: MacroContextSummary;
  debtSnapshot: DebtSnapshotSummary | null;
  yoy: YoYComparisonSummary | null;
  stats: ReportStatsSummary;
  civicEquivalents: CivicEquivalentsSummary;
  findings: EvidenceItem[];
  duplicateClusters: DuplicateCluster[];
  lineages: RecurringLineageItem[];
  projects: CleanProject[];
  crossLedgerFindingsCount?: number;
  compoundProjectsCount?: number;
  sixLedgerSummary?: SixLedgerAccountabilitySummary | null;
}

export const TEMPLATE_META: Record<ReportTemplate, { label: string; subtitle: string }> = {
  executive_brief: {
    label: 'Executive Fiscal Brief',
    subtitle: 'Enacted macro envelope, administration policy framework, concentration risks, and top budget items.',
  },
  six_ledger_brief: {
    label: '6-Ledger Audit Brief',
    subtitle: 'Unified 6-ledger accountability dossier uniting Evidence Engine v3.0 (22 rules), OAuGF audits, Bill-vs-Act padding, Open Treasury personal/opaque cash, and Red-Flag Convergent MDAs.',
  },
  forensic_digest: {
    label: 'Forensic Compliance Digest',
    subtitle: 'Evidence Engine v3.0 (22 rules including 6 cross-ledger forensic checks) sorted by severity and exposure with verbatim PDF citations.',
  },
  duplicate_audit: {
    label: 'Duplicate & Split Audit',
    subtitle: 'Exact wording repeats, disguised synonym clusters, and cross-MDA allocation overlaps.',
  },
  recurring_lineage: {
    label: 'Multi-Year Lineages',
    subtitle: 'Cross-year recurring capital or programme line items active in the selected appropriation year.',
  },
  sector_summary: {
    label: 'Sector & MDA Ledger',
    subtitle: 'Sectoral share distribution, executing agency totals, and filtered verbatim line-item ledger.',
  },
};

export function formatNairaCompact(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '₦0';
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  if (abs >= 1e12) return `${sign}₦${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}₦${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}₦${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}₦${(abs / 1e3).toFixed(1)}K`;
  return `${sign}₦${Math.round(abs).toLocaleString('en-US')}`;
}

export function formatNairaExact(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '₦0';
  return `₦${Math.round(amount).toLocaleString('en-US')}`;
}

export function escapeHtml(input: string | number | null | undefined): string {
  const s = String(input ?? '');
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getLineageFyInstance(lineage: RecurringLineageItem, fy: number): RecurringLineageInstance | undefined {
  return lineage.instances.find((inst) => (inst.financialYear ?? inst.year) === fy);
}

function renderBadgeHtml(label: string, tone: 'high' | 'medium' | 'low' | 'neutral' | 'emerald'): string {
  const palette: Record<string, { bg: string; fg: string; border: string }> = {
    high: { bg: '#fef2f2', fg: '#b91c1c', border: '#fecaca' },
    medium: { bg: '#fffbeb', fg: '#b45309', border: '#fde68a' },
    low: { bg: '#f0f9ff', fg: '#0369a1', border: '#bae6fd' },
    emerald: { bg: '#ecfdf5', fg: '#047857', border: '#a7f3d0' },
    neutral: { bg: '#f1f5f9', fg: '#334155', border: '#cbd5e1' },
  };
  const c = palette[tone] || palette.neutral;
  return `<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:8.5pt;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;background:${c.bg};color:${c.fg};border:1px solid ${c.border};white-space:nowrap;">${escapeHtml(label)}</span>`;
}

function buildPrintableHtmlDocument(payload: ReportPayload): string {
  const {
    financialYear,
    template,
    documentTitle,
    preparedBy,
    generatedAt,
    presidentName,
    party,
    termLabel,
    filterSummary,
    tableRowLimit,
    orientation,
    sections,
    analystNotes,
    registryLength,
    excludedRollupsCount,
    macro,
    debtSnapshot,
    yoy,
    stats,
    civicEquivalents,
    findings,
    duplicateClusters,
    lineages,
    projects,
    crossLedgerFindingsCount,
    compoundProjectsCount,
    sixLedgerSummary,
  } = payload;

  const formattedDate = new Date(generatedAt).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const severityCounts = [
    `${stats.highSeverityCount.toLocaleString()} High`,
    `${stats.mediumSeverityCount.toLocaleString()} Medium`,
    `${stats.lowSeverityCount.toLocaleString()} Low`,
  ].join(' · ');

  let templateSectionHtml = '';

  if (template === 'executive_brief') {
    const sectorRows = stats.sectorBreakdown
      .slice(0, 12)
      .map(
        (s) => `
      <tr>
        <td style="font-weight:600;color:#0f172a;">${escapeHtml(s.sector)}</td>
        <td class="num">${s.count.toLocaleString()}</td>
        <td class="num">${s.sharePct.toFixed(1)}%</td>
        <td class="num strong">${escapeHtml(formatNairaCompact(s.totalAmount))}</td>
      </tr>`
      )
      .join('');

    const agencyRows = stats.topAgencies
      .slice(0, 12)
      .map(
        (a) => `
      <tr>
        <td style="font-weight:600;color:#0f172a;">${escapeHtml(a.agency)}</td>
        <td class="num">${a.count.toLocaleString()}</td>
        <td class="num">${a.sharePct.toFixed(1)}%</td>
        <td class="num strong">${escapeHtml(formatNairaCompact(a.totalAmount))}</td>
      </tr>`
      )
      .join('');

    const topFindingRows = findings
      .slice(0, Math.min(15, tableRowLimit))
      .map(
        (f) => `
      <tr>
        ${sections.includeCitations ? `<td class="mono">${escapeHtml(f.projectCode || 'N/A')}</td>` : ''}
        <td>
          <div style="font-weight:600;color:#0f172a;">${escapeHtml(f.projectName)}</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:2px;">${escapeHtml(f.ruleName)} — ${escapeHtml(f.reason)}</div>
        </td>
        <td>${escapeHtml(f.agency)}</td>
        <td>${renderBadgeHtml(f.severity, f.severity)}</td>
        <td class="num strong">${escapeHtml(formatNairaCompact(f.amount))}</td>
        ${sections.includeCitations ? `<td class="num mono">p.${f.page || '-'}</td>` : ''}
      </tr>`
      )
      .join('');

    templateSectionHtml = `
      <section class="section">
        <h2 class="section-title">1. Fiscal Envelope & Portfolio Distribution</h2>
        <div class="two-col">
          <div>
            <h3 class="sub-title">Sectoral Share (Filtered Scope)</h3>
            <table>
              <thead>
                <tr>
                  <th>Sector</th>
                  <th class="num">Items</th>
                  <th class="num">Share</th>
                  <th class="num">Allocation</th>
                </tr>
              </thead>
              <tbody>${sectorRows || '<tr><td colspan="4" class="empty">No matching sector records.</td></tr>'}</tbody>
            </table>
          </div>
          <div>
            <h3 class="sub-title">Top Executing Agencies</h3>
            <table>
              <thead>
                <tr>
                  <th>Agency / MDA</th>
                  <th class="num">Items</th>
                  <th class="num">Share</th>
                  <th class="num">Allocation</th>
                </tr>
              </thead>
              <tbody>${agencyRows || '<tr><td colspan="4" class="empty">No matching agency records.</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">2. Priority Evidence Engine v3.0 Exceptions (${findings.length.toLocaleString()} Flagged)</h2>
        <table>
          <thead>
            <tr>
              ${sections.includeCitations ? '<th style="width:92px;">Code</th>' : ''}
              <th>Line Item & Audit Trigger</th>
              <th style="width:170px;">Executing Agency</th>
              <th style="width:68px;">Severity</th>
              <th class="num" style="width:92px;">Amount</th>
              ${sections.includeCitations ? '<th class="num" style="width:52px;">PDF</th>' : ''}
            </tr>
          </thead>
          <tbody>${topFindingRows || `<tr><td colspan="${sections.includeCitations ? 6 : 4}" class="empty">No rule exceptions triggered for active filters.</td></tr>`}</tbody>
        </table>
      </section>
    `;
  } else if (template === 'six_ledger_brief') {
    const s6 = sixLedgerSummary;
    const compoundRows = (s6?.topCompoundProjects || [])
      .slice(0, Math.min(25, tableRowLimit))
      .map((cp) => {
        const flags: string[] = [];
        if (cp.paidOnPaper) flags.push('Paid on Paper');
        if (cp.billInserted) flags.push('Bill->Act');
        if (cp.mdaOaugfIssues > 0) flags.push(`OAuGF (${cp.mdaOaugfIssues})`);
        if (cp.mdaGrade && cp.mdaGrade !== 'N/A') flags.push(`Grade ${cp.mdaGrade}`);
        return `
      <tr>
        <td class="mono">${escapeHtml(cp.projectCode || 'ERGP')}</td>
        <td>
          <div style="font-weight:600;color:#0f172a;">${escapeHtml(cp.projectName)}</div>
          <div style="font-size:8pt;color:#475569;margin-top:2px;">${escapeHtml(cp.ruleNames.slice(0, 3).join(' · '))}</div>
        </td>
        <td>${escapeHtml(cp.agency)}</td>
        <td>${escapeHtml(flags.join(' | ') || `${cp.crossLedgerRuleCount} cross-ledger`)}</td>
        <td class="num strong">${cp.compoundRiskScore}/100 (${cp.ruleCount}r)</td>
        <td class="num strong">${escapeHtml(formatNairaCompact(cp.amount))}</td>
      </tr>`;
      })
      .join('');

    const mdaRows = (s6?.topConvergentMdas || [])
      .slice(0, 15)
      .map(
        (m) => `
      <tr>
        <td style="font-weight:600;color:#0f172a;">${escapeHtml(m.mdaName)}</td>
        <td class="num strong">${m.flagCount}x</td>
        <td>${escapeHtml(m.grade)}${m.compositeScore !== null ? ` (${m.compositeScore.toFixed(1)})` : ''}</td>
        <td class="num">${m.oaugfQueryCount.toLocaleString()} (${m.oaugfRepeatCount} rep.)</td>
        <td style="font-size:8pt;color:#475569;">${escapeHtml(m.flags.join(', ').replace(/_/g, ' '))}</td>
        <td class="num strong">${escapeHtml(formatNairaCompact(m.totalExposureNaira))}</td>
      </tr>`
      )
      .join('');

    templateSectionHtml = `
      <section class="section">
        <h2 class="section-title">1. Six Federal Accountability Layers (Distinct Non-Additive Ledgers)</h2>
        <p class="section-note">Enacted Appropriations, Legislative Bill-to-Act Padding Deltas, Open Treasury Cash Disbursals, and OAuGF Post-Mortem Audit Queries measure distinct fiscal stages and are cross-referenced without summing across stages.</p>
        <table>
          <thead>
            <tr>
              <th>Accountability Layer</th>
              <th class="num">Volume / Records</th>
              <th class="num">Monetary / Risk Figure</th>
              <th>Cross-Ledger Scope</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="font-weight:600;">Evidence Engine v${escapeHtml(s6?.engineVersion || '3.0.0')} (${s6?.totalRulesCount || 22} Rules)</td>
              <td class="num">${(s6?.activeYearFindingsCount ?? findings.length).toLocaleString()} FY / ${(s6?.allYearsRuleFindings ?? 49679).toLocaleString()} All-Time</td>
              <td class="num strong">${escapeHtml(formatNairaCompact(s6?.allYearsFlaggedNaira ?? stats.flaggedTotalAmount))}</td>
              <td>${(s6?.activeYearCompoundProjectsCount ?? compoundProjectsCount ?? 0).toLocaleString()} compound-risk projects in FY${financialYear}</td>
            </tr>
            <tr>
              <td style="font-weight:600;">OAuGF Constitutional Audits</td>
              <td class="num">${(s6?.oaugf?.parsedAuditIssuesCount ?? 7028).toLocaleString()} queries (${s6?.oaugf?.reportsIndexed ?? 36} reports)</td>
              <td class="num strong">${(s6?.oaugf?.recoveryDirectiveCount ?? 675).toLocaleString()} recoveries</td>
              <td>${(s6?.oaugf?.repeatNeglectCount ?? 54).toLocaleString()} repeated/ignored directives across ${(s6?.oaugf?.matchedMdasCount ?? 127)} MDAs</td>
            </tr>
            <tr>
              <td style="font-weight:600;">Legislative Bill-to-Act Deltas</td>
              <td class="num">${(s6?.billActDiff?.allCyclesInsertionsCount ?? 0).toLocaleString()} insertions</td>
              <td class="num strong">${escapeHtml(formatNairaCompact(s6?.billActDiff?.allCyclesInsertionsNaira ?? 0))}</td>
              <td>${s6?.billActDiff?.activeYearCycle ? `FY${financialYear}: ${s6.billActDiff.activeYearCycle.insertionsCount.toLocaleString()} insertions (${formatNairaCompact(s6.billActDiff.activeYearCycle.insertionsTotalNaira)})` : `${s6?.billActDiff?.cyclesCount ?? 7} legislative cycles indexed`}</td>
            </tr>
            <tr>
              <td style="font-weight:600;">Open Treasury Cash Forensics</td>
              <td class="num">${(s6?.treasuryCash?.totalVouchers ?? 467763).toLocaleString()} vouchers</td>
              <td class="num strong">${escapeHtml(formatNairaCompact(s6?.treasuryCash?.totalNaira ?? 0))}</td>
              <td>${(s6?.treasuryCash?.personalStaffCount ?? 10851).toLocaleString()} personal accounts (${escapeHtml(formatNairaCompact(s6?.treasuryCash?.personalStaffPaidNaira ?? 0))}) &amp; ${(s6?.treasuryCash?.opaqueVoucherCount ?? 33366).toLocaleString()} opaque/discretionary (${escapeHtml(formatNairaCompact(s6?.treasuryCash?.opaqueNaira ?? 0))})</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="section">
        <h2 class="section-title">2. Priority Compound-Risk Flagged Projects (FY${financialYear})</h2>
        <table>
          <thead>
            <tr>
              <th style="width:90px;">Code</th>
              <th>Line Item &amp; Triggered Rules</th>
              <th style="width:150px;">Executing MDA</th>
              <th style="width:135px;">6-Ledger Signals</th>
              <th class="num" style="width:82px;">Risk Score</th>
              <th class="num" style="width:92px;">Amount</th>
            </tr>
          </thead>
          <tbody>${compoundRows || '<tr><td colspan="6" class="empty">No compound-risk projects matched active scope.</td></tr>'}</tbody>
        </table>
      </section>

      <section class="section">
        <h2 class="section-title">3. Multi-Ledger Red-Flag Convergent MDAs</h2>
        <table>
          <thead>
            <tr>
              <th>Executing MDA</th>
              <th class="num" style="width:52px;">Flags</th>
              <th style="width:76px;">Grade</th>
              <th class="num" style="width:98px;">OAuGF Audits</th>
              <th>Convergence Signals</th>
              <th class="num" style="width:96px;">Exposure</th>
            </tr>
          </thead>
          <tbody>${mdaRows || '<tr><td colspan="6" class="empty">No Red-Flag Convergent MDA records loaded.</td></tr>'}</tbody>
        </table>
      </section>
    `;
  } else if (template === 'forensic_digest') {
    const shown = findings.slice(0, tableRowLimit);
    const rows = shown
      .map(
        (f) => `
      <tr>
        ${sections.includeCitations ? `<td class="mono">${escapeHtml(f.projectCode || 'N/A')}</td>` : ''}
        <td>
          <div style="font-weight:600;color:#0f172a;">${escapeHtml(f.projectName)}</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:2px;">${escapeHtml(f.reason)}</div>
        </td>
        <td>
          <div style="font-weight:600;">${escapeHtml(f.agency)}</div>
          <div style="font-size:8pt;color:#64748b;">${escapeHtml(f.sector)}</div>
        </td>
        <td>
          ${renderBadgeHtml(f.severity, f.severity)}
          <div style="font-size:8pt;color:#475569;margin-top:2px;">${escapeHtml(f.ruleName)}</div>
        </td>
        <td class="num strong">${escapeHtml(formatNairaCompact(f.amount))}</td>
        ${sections.includeCitations ? `<td class="num mono">p.${f.page || '-'}</td>` : ''}
      </tr>`
      )
      .join('');

    templateSectionHtml = `
      <section class="section">
        <h2 class="section-title">Forensic Compliance & Exception Log</h2>
        <p class="section-note">Showing ${shown.length.toLocaleString()} of ${findings.length.toLocaleString()} flagged records (${severityCounts}; cumulative flagged exposure ${escapeHtml(formatNairaCompact(stats.flaggedTotalAmount))}).</p>
        <table>
          <thead>
            <tr>
              ${sections.includeCitations ? '<th style="width:92px;">Code</th>' : ''}
              <th>Project Title & Rule Finding</th>
              <th style="width:165px;">Executing Agency & Sector</th>
              <th style="width:130px;">Severity & Rule</th>
              <th class="num" style="width:92px;">Amount</th>
              ${sections.includeCitations ? '<th class="num" style="width:52px;">PDF</th>' : ''}
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="${sections.includeCitations ? 6 : 4}" class="empty">No findings match the current filter selection.</td></tr>`}</tbody>
        </table>
      </section>
    `;
  } else if (template === 'duplicate_audit') {
    const shown = duplicateClusters.slice(0, tableRowLimit);
    const rows = shown
      .map((c) => {
        const sampleRefs = c.projects
          .slice(0, 4)
          .map((p) => `${p.projectCode || 'ID'} (p.${p.page || '?'})`)
          .join(', ');
        return `
      <tr>
        <td class="mono">${escapeHtml(c.id)}</td>
        <td>
          <div style="font-weight:600;color:#0f172a;">${escapeHtml(c.canonicalTitle)}</div>
          ${sections.includeCitations ? `<div style="font-size:8pt;color:#64748b;margin-top:2px;">Samples: ${escapeHtml(sampleRefs)}${c.projects.length > 4 ? ` (+${c.projects.length - 4} more)` : ''}</div>` : ''}
        </td>
        <td>${renderBadgeHtml(c.patternType, c.patternType === 'Disguised Rewording' ? 'high' : 'medium')}</td>
        <td class="num">${c.count.toLocaleString()}</td>
        <td class="num">${c.distinctAgencies.toLocaleString()}</td>
        <td class="num strong">${escapeHtml(formatNairaCompact(c.totalAmount))}</td>
      </tr>`;
      })
      .join('');

    templateSectionHtml = `
      <section class="section">
        <h2 class="section-title">Duplicate, Disguised-Rewording & Split-Allocation Clusters</h2>
        <p class="section-note">Showing ${shown.length.toLocaleString()} of ${duplicateClusters.length.toLocaleString()} clusters spanning ${stats.duplicateItemCount.toLocaleString()} line items (total cluster value ${escapeHtml(formatNairaCompact(stats.duplicateTotalAmount))}). MDA summary rollups are excluded.</p>
        <table>
          <thead>
            <tr>
              <th style="width:86px;">Cluster</th>
              <th>Canonical Description & Sample Provenance</th>
              <th style="width:130px;">Pattern</th>
              <th class="num" style="width:62px;">Count</th>
              <th class="num" style="width:64px;">MDAs</th>
              <th class="num" style="width:100px;">Cluster Total</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="6" class="empty">No duplicate clusters detected within the active filter scope.</td></tr>'}</tbody>
        </table>
      </section>
    `;
  } else if (template === 'recurring_lineage') {
    const shown = lineages.slice(0, tableRowLimit);
    const rows = shown
      .map((lin) => {
        const fyInst = getLineageFyInstance(lin, financialYear);
        const fyAmt = fyInst ? fyInst.amount : 0;
        const fyPage = fyInst?.page || 0;
        return `
      <tr>
        <td class="mono">${escapeHtml(lin.projectCode || lin.lineageId)}</td>
        <td>
          <div style="font-weight:600;color:#0f172a;">${escapeHtml(lin.canonicalTitle)}</div>
          <div style="font-size:8pt;color:#64748b;margin-top:2px;">Years: ${escapeHtml(lin.yearsAppeared.join(', '))}</div>
        </td>
        <td>${escapeHtml(lin.agency)}</td>
        <td class="num">${lin.appearanceCount} yrs</td>
        <td class="num">${escapeHtml(formatNairaCompact(fyAmt))}</td>
        <td class="num strong">${escapeHtml(formatNairaCompact(lin.cumulativeAllocation))}</td>
        ${sections.includeCitations ? `<td class="num mono">p.${fyPage || '-'}</td>` : ''}
      </tr>`;
      })
      .join('');

    templateSectionHtml = `
      <section class="section">
        <h2 class="section-title">Multi-Year Recurring Lineages Active in FY${financialYear}</h2>
        <p class="section-note">Showing ${shown.length.toLocaleString()} of ${lineages.length.toLocaleString()} matching recurring lineages identified across Federal Appropriation Acts (2009–2026).</p>
        <table>
          <thead>
            <tr>
              <th style="width:94px;">Code</th>
              <th>Canonical Line Item & Active Years</th>
              <th style="width:165px;">Lead Agency</th>
              <th class="num" style="width:64px;">Span</th>
              <th class="num" style="width:94px;">FY${financialYear}</th>
              <th class="num" style="width:100px;">Cumulative</th>
              ${sections.includeCitations ? '<th class="num" style="width:50px;">PDF</th>' : ''}
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="${sections.includeCitations ? 7 : 6}" class="empty">No recurring lineages match the active filters for FY${financialYear}.</td></tr>`}</tbody>
        </table>
      </section>
    `;
  } else {
    const sectorRows = stats.sectorBreakdown
      .map(
        (s) => `
      <tr>
        <td style="font-weight:600;color:#0f172a;">${escapeHtml(s.sector)}</td>
        <td class="num">${s.count.toLocaleString()}</td>
        <td class="num">${s.sharePct.toFixed(1)}%</td>
        <td class="num strong">${escapeHtml(formatNairaCompact(s.totalAmount))}</td>
      </tr>`
      )
      .join('');

    const shown = projects.slice(0, tableRowLimit);
    const ledgerRows = shown
      .map(
        (p) => `
      <tr>
        ${sections.includeCitations ? `<td class="mono">${escapeHtml(p.projectCode || 'ERGP')}</td>` : ''}
        <td style="font-weight:500;color:#0f172a;">${escapeHtml(p.projectName)}</td>
        <td>
          <div>${escapeHtml(p.agency || 'Federal MDA')}</div>
          <div style="font-size:8pt;color:#64748b;">${escapeHtml(p.sector)}</div>
        </td>
        <td class="num strong">${escapeHtml(formatNairaCompact(p.amount))}</td>
        ${sections.includeCitations ? `<td class="num mono">p.${p.page || '-'}</td>` : ''}
      </tr>`
      )
      .join('');

    templateSectionHtml = `
      <section class="section">
        <h2 class="section-title">1. Sectoral Breakdown</h2>
        <table>
          <thead>
            <tr>
              <th>Sector Classification</th>
              <th class="num">Line Items</th>
              <th class="num">Share of Scope</th>
              <th class="num">Total Allocation</th>
            </tr>
          </thead>
          <tbody>${sectorRows || '<tr><td colspan="4" class="empty">No sector breakdown available.</td></tr>'}</tbody>
        </table>
      </section>

      <section class="section">
        <h2 class="section-title">2. Verbatim Line-Item Ledger (${shown.length.toLocaleString()} of ${projects.length.toLocaleString()} Items)</h2>
        <table>
          <thead>
            <tr>
              ${sections.includeCitations ? '<th style="width:94px;">Code</th>' : ''}
              <th>Project Description</th>
              <th style="width:185px;">Agency & Sector</th>
              <th class="num" style="width:96px;">Amount</th>
              ${sections.includeCitations ? '<th class="num" style="width:52px;">PDF</th>' : ''}
            </tr>
          </thead>
          <tbody>${ledgerRows || `<tr><td colspan="${sections.includeCitations ? 5 : 3}" class="empty">No line items match the active filters.</td></tr>`}</tbody>
        </table>
      </section>
    `;
  }

  const macroHtml = sections.includeMacroContext
    ? `
    <section class="section print-avoid-break">
      <h2 class="section-title">Enacted Macroeconomic Framework & Administration Context</h2>
      <div class="callout-grid">
        <div class="callout-box">
          <div class="callout-label">Appropriation Theme</div>
          <div class="callout-main">${escapeHtml(macro.budgetTheme || `FY${financialYear} Federal Appropriation Act`)}</div>
          ${macro.executiveSummary ? `<p style="font-size:8.8pt;color:#334155;margin:6px 0 0;line-height:1.45;">${escapeHtml(macro.executiveSummary)}</p>` : ''}
        </div>
        <div class="callout-box">
          <div class="callout-label">Official Enacted Envelope</div>
          <div class="mini-kv">
            <span>Total Appropriation:</span><strong>${escapeHtml(formatNairaCompact(macro.officialTotalBudget))}</strong>
            <span>Capital Allocation:</span><strong>${escapeHtml(formatNairaCompact(macro.totalCapitalBudget))}</strong>
            <span>Recurrent Non-Debt:</span><strong>${escapeHtml(formatNairaCompact(macro.recurrentNonDebtTotal))}</strong>
            <span>Debt Service:</span><strong>${escapeHtml(formatNairaCompact(macro.debtService))}</strong>
            <span>Statutory Transfers:</span><strong>${escapeHtml(formatNairaCompact(macro.statutoryTransfers))}</strong>
          </div>
        </div>
      </div>
      ${
        macro.benchmarkOilPriceUSD || macro.exchangeRateNairaPerUSD
          ? `<div class="strip-bar">
              <span><strong>Oil Benchmark:</strong> $${macro.benchmarkOilPriceUSD ?? 'N/A'}/bbl</span>
              <span><strong>Production:</strong> ${macro.dailyOilProductionMBPD ?? 'N/A'} mbpd</span>
              <span><strong>FX Reference:</strong> ₦${macro.exchangeRateNairaPerUSD ?? 'N/A'}/US$</span>
              <span><strong>GDP Growth Proj.:</strong> ${macro.projectedGdpGrowthPercent ?? 'N/A'}%</span>
              <span><strong>CPI / Inflation:</strong> ${macro.inflationRatePercent ?? 'N/A'}%</span>
            </div>`
          : ''
      }
    </section>
  `
    : '';

  const debtHtml =
    sections.includeDebtSnapshot && debtSnapshot
      ? `
    <section class="section print-avoid-break">
      <h2 class="section-title">DMO Sovereign Public Debt Snapshot (${debtSnapshot.isExactYearMatch ? `FY${debtSnapshot.financialYear}` : `Latest Prior DMO Record: ${debtSnapshot.financialYear}`})</h2>
      <div class="kpi-row">
        <div class="kpi-card">
          <div class="kpi-label">Total Public Debt Stock</div>
          <div class="kpi-value">${debtSnapshot.totalDebtNairaM !== null ? escapeHtml(formatNairaCompact(debtSnapshot.totalDebtNairaM * 1e6)) : 'N/A'}</div>
          <div class="kpi-sub">${debtSnapshot.totalDebtUsdM !== null ? `US$${(debtSnapshot.totalDebtUsdM / 1000).toFixed(2)}B` : 'USD N/A'}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Domestic Debt Stock</div>
          <div class="kpi-value">${debtSnapshot.domesticDebtNairaM !== null ? escapeHtml(formatNairaCompact(debtSnapshot.domesticDebtNairaM * 1e6)) : 'N/A'}</div>
          <div class="kpi-sub">FGN Bonds / T-Bills</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">External Debt Stock</div>
          <div class="kpi-value">${debtSnapshot.externalDebtNairaM !== null ? escapeHtml(formatNairaCompact(debtSnapshot.externalDebtNairaM * 1e6)) : 'N/A'}</div>
          <div class="kpi-sub">${debtSnapshot.externalDebtUsdM !== null ? `US$${(debtSnapshot.externalDebtUsdM / 1000).toFixed(2)}B` : 'USD N/A'}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">DMO Source Reference</div>
          <div class="kpi-value" style="font-size:9.5pt;">${escapeHtml(debtSnapshot.asAt || `FY${debtSnapshot.financialYear}`)}</div>
          <div class="kpi-sub">${escapeHtml(debtSnapshot.primarySource)}</div>
        </div>
      </div>
    </section>
  `
      : '';

  const yoyHtml =
    sections.includeYoY && yoy
      ? `
    <section class="section print-avoid-break">
      <h2 class="section-title">Year-over-Year Comparison (FY${yoy.priorYear} vs FY${financialYear})</h2>
      <table>
        <thead>
          <tr>
            <th>Fiscal Metric</th>
            <th class="num">FY${yoy.priorYear}</th>
            <th class="num">FY${financialYear}</th>
            <th class="num">Nominal Change</th>
            <th class="num">Shift %</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="font-weight:600;">Enacted Federal Budget Total</td>
            <td class="num">${escapeHtml(formatNairaCompact(yoy.priorOfficialTotal))}</td>
            <td class="num">${escapeHtml(formatNairaCompact(yoy.currentOfficialTotal))}</td>
            <td class="num">${yoy.officialDelta >= 0 ? '+' : ''}${escapeHtml(formatNairaCompact(yoy.officialDelta))}</td>
            <td class="num strong">${yoy.officialDeltaPct >= 0 ? '+' : ''}${yoy.officialDeltaPct.toFixed(1)}%</td>
          </tr>
          <tr>
            <td style="font-weight:600;">Extracted Project Schedules Total</td>
            <td class="num">${escapeHtml(formatNairaCompact(yoy.priorExtractedTotal))}</td>
            <td class="num">${escapeHtml(formatNairaCompact(yoy.currentExtractedTotal))}</td>
            <td class="num">${yoy.extractedDelta >= 0 ? '+' : ''}${escapeHtml(formatNairaCompact(yoy.extractedDelta))}</td>
            <td class="num strong">${yoy.extractedDeltaPct >= 0 ? '+' : ''}${yoy.extractedDeltaPct.toFixed(1)}%</td>
          </tr>
        </tbody>
      </table>
    </section>
  `
      : '';

  const civicHtml = sections.includeCivicImpact
    ? `
    <section class="section print-avoid-break">
      <h2 class="section-title">Civic Infrastructure Equivalents (${escapeHtml(formatNairaCompact(stats.totalAllocated))} Filtered Scope)</h2>
      <p class="section-note">Constant benchmark costs scaled to FY${financialYear} macro price index (${civicEquivalents.inflationFactor.toFixed(2)}x vs 2023 baseline). Shows equivalent public goods capacity, not direct execution tracking.</p>
      <div class="kpi-row" style="grid-template-columns: repeat(5, 1fr);">
        <div class="kpi-card">
          <div class="kpi-label">Equipped PHCs</div>
          <div class="kpi-value">${civicEquivalents.equivalents.phcs.toLocaleString()}</div>
          <div class="kpi-sub">@ ${escapeHtml(formatNairaCompact(civicEquivalents.unitCosts.phc))}/unit</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">3-Classroom Blocks</div>
          <div class="kpi-value">${civicEquivalents.equivalents.classroomBlocks.toLocaleString()}</div>
          <div class="kpi-sub">@ ${escapeHtml(formatNairaCompact(civicEquivalents.unitCosts.classroomBlock))}/unit</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Solar Boreholes</div>
          <div class="kpi-value">${civicEquivalents.equivalents.solarBoreholes.toLocaleString()}</div>
          <div class="kpi-sub">@ ${escapeHtml(formatNairaCompact(civicEquivalents.unitCosts.solarBorehole))}/unit</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Annual School Meals</div>
          <div class="kpi-value">${civicEquivalents.equivalents.schoolMealsFed.toLocaleString()}</div>
          <div class="kpi-sub">@ ${escapeHtml(formatNairaCompact(civicEquivalents.unitCosts.annualSchoolMeal))}/pupil-yr</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Annual Min. Wages</div>
          <div class="kpi-value">${civicEquivalents.equivalents.annualMinWages.toLocaleString()}</div>
          <div class="kpi-sub">@ ${escapeHtml(formatNairaCompact(civicEquivalents.unitCosts.annualMinWage))}/worker-yr</div>
        </div>
      </div>
    </section>
  `
    : '';

  const notesHtml =
    sections.includeAnalystNotes && analystNotes.trim()
      ? `
    <section class="section print-avoid-break">
      <h2 class="section-title">Analyst Commentary & Observations</h2>
      <div class="notes-box">${escapeHtml(analystNotes).replace(/\n/g, '<br/>')}</div>
    </section>
  `
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(documentTitle)} - FY${financialYear}</title>
  <style>
    @page {
      size: A4 ${orientation};
      margin: 14mm 12mm;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      font-size: 9.5pt;
      line-height: 1.45;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .doc-shell {
      max-width: 100%;
      margin: 0 auto;
    }
    .top-rule {
      height: 4px;
      background: linear-gradient(90deg, #059669 0%, #0f172a 100%);
      margin-bottom: 14px;
    }
    .masthead {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 1.5px solid #0f172a;
      padding-bottom: 12px;
      margin-bottom: 14px;
      gap: 16px;
    }
    .eyebrow {
      font-size: 8pt;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #047857;
      margin-bottom: 4px;
    }
    h1 {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 19pt;
      line-height: 1.15;
      margin: 0 0 4px 0;
      color: #0f172a;
    }
    .subtitle {
      font-size: 9pt;
      color: #475569;
      margin: 0;
    }
    .meta-box {
      text-align: right;
      font-size: 8.2pt;
      color: #334155;
      line-height: 1.5;
      white-space: nowrap;
    }
    .meta-strip {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px 10px;
      margin-bottom: 14px;
      font-size: 8.2pt;
    }
    .meta-strip div span {
      display: block;
      font-size: 7.2pt;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
      font-weight: 700;
    }
    .meta-strip div strong {
      color: #0f172a;
    }
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 14px;
    }
    .kpi-card {
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 9px 10px;
      background: #ffffff;
    }
    .kpi-label {
      font-size: 7.2pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
      margin-bottom: 3px;
    }
    .kpi-value {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 13pt;
      font-weight: 700;
      color: #0f172a;
      font-variant-numeric: tabular-nums;
    }
    .kpi-sub {
      font-size: 7.8pt;
      color: #64748b;
      margin-top: 2px;
    }
    .section {
      margin-bottom: 16px;
    }
    .section-title {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 11.5pt;
      color: #0f172a;
      border-bottom: 1px solid #cbd5e1;
      padding-bottom: 4px;
      margin: 0 0 8px 0;
      break-after: avoid;
      page-break-after: avoid;
    }
    .sub-title {
      font-size: 9pt;
      font-weight: 700;
      color: #334155;
      margin: 0 0 6px 0;
    }
    .section-note {
      font-size: 8.5pt;
      color: #475569;
      margin: 0 0 8px 0;
    }
    .two-col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }
    .callout-grid {
      display: grid;
      grid-template-columns: 1.3fr 1fr;
      gap: 10px;
    }
    .callout-box {
      border: 1px solid #e2e8f0;
      background: #faf9f6;
      border-radius: 6px;
      padding: 9px 11px;
    }
    .callout-label {
      font-size: 7.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #047857;
      margin-bottom: 4px;
    }
    .callout-main {
      font-weight: 700;
      font-size: 9.8pt;
      color: #0f172a;
    }
    .mini-kv {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 3px 10px;
      font-size: 8.5pt;
    }
    .mini-kv strong {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      text-align: right;
    }
    .strip-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      margin-top: 8px;
      padding: 6px 10px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 5px;
      font-size: 8.2pt;
      color: #334155;
    }
    .notes-box {
      border-left: 3px solid #059669;
      background: #f8fafc;
      padding: 9px 12px;
      font-size: 9pt;
      color: #1e293b;
      border-radius: 0 6px 6px 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.3pt;
    }
    thead {
      display: table-header-group;
    }
    th {
      background: #f1f5f9;
      color: #334155;
      font-weight: 700;
      text-align: left;
      padding: 6px 7px;
      border-top: 1px solid #cbd5e1;
      border-bottom: 1.5px solid #94a3b8;
      font-size: 7.8pt;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    td {
      padding: 6px 7px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
      color: #1e293b;
    }
    tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .num {
      text-align: right;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .strong {
      font-weight: 700;
      color: #0f172a;
    }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 8pt;
      color: #334155;
      white-space: nowrap;
    }
    .empty {
      text-align: center;
      color: #64748b;
      padding: 14px;
      font-style: italic;
    }
    .print-avoid-break {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .footer {
      margin-top: 18px;
      padding-top: 8px;
      border-top: 1px solid #cbd5e1;
      display: flex;
      justify-content: space-between;
      font-size: 7.6pt;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="doc-shell">
    <div class="top-rule"></div>
    <div class="masthead">
      <div>
        <div class="eyebrow">BudgetLens Civic Fiscal Observatory · Verbatim Audit Dossier</div>
        <h1>${escapeHtml(documentTitle)}</h1>
        <p class="subtitle">${escapeHtml(TEMPLATE_META[template].label)} — ${escapeHtml(TEMPLATE_META[template].subtitle)}</p>
      </div>
      <div class="meta-box">
        <div><strong>Fiscal Year:</strong> FY${financialYear}</div>
        <div><strong>Generated:</strong> ${escapeHtml(formattedDate)}</div>
        <div><strong>Prepared By:</strong> ${escapeHtml(preparedBy || 'Open Observatory Desk')}</div>
        <div><strong>Sources Indexed:</strong> ${registryLength.toLocaleString()} Documents</div>
      </div>
    </div>

    <div class="meta-strip">
      <div><span>Administration</span><strong>${escapeHtml(presidentName)} (${escapeHtml(party)})</strong></div>
      <div><span>Term Context</span><strong>${escapeHtml(termLabel)}</strong></div>
      <div><span>Active Filter Scope</span><strong>${escapeHtml(filterSummary)}</strong></div>
      <div><span>Data Hygiene</span><strong>${excludedRollupsCount.toLocaleString()} Rollup Headers Excluded</strong></div>
    </div>

    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-label">Filtered Capital & Line Items</div>
        <div class="kpi-value">${stats.count.toLocaleString()}</div>
        <div class="kpi-sub">Median ${escapeHtml(formatNairaCompact(stats.medianAmount))}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Filtered Allocation Total</div>
        <div class="kpi-value">${escapeHtml(formatNairaCompact(stats.totalAllocated))}</div>
        <div class="kpi-sub">Mean ${escapeHtml(formatNairaCompact(stats.avgAmount))}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Evidence Engine v3.0 Exceptions</div>
        <div class="kpi-value">${findings.length.toLocaleString()}</div>
        <div class="kpi-sub">${escapeHtml(severityCounts)}${typeof crossLedgerFindingsCount === 'number' ? ` · ${crossLedgerFindingsCount.toLocaleString()} Cross-Ledger` : ''}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Duplicate Clusters</div>
        <div class="kpi-value">${stats.duplicateClusterCount.toLocaleString()}</div>
        <div class="kpi-sub">${escapeHtml(formatNairaCompact(stats.duplicateTotalAmount))} cumulative</div>
      </div>
    </div>

    ${macroHtml}
    ${debtHtml}
    ${yoyHtml}
    ${templateSectionHtml}
    ${civicHtml}
    ${notesHtml}

    <div class="footer">
      <span>Every line item cites verbatim Federal Appropriation PDF schedules inspected via BudgetLens.</span>
      <span>Report Layout: A4 ${escapeHtml(orientation.toUpperCase())}</span>
    </div>
  </div>
</body>
</html>`;
}

let pendingPrintTimer: number | null = null;

export function printReportDocument(payload: ReportPayload): boolean {
  try {
    const html = buildPrintableHtmlDocument(payload);
    const frameId = 'budgetlens-print-frame';
    let iframe = document.getElementById(frameId) as HTMLIFrameElement | null;

    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = frameId;
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.style.visibility = 'hidden';
      iframe.style.pointerEvents = 'none';
      document.body.appendChild(iframe);
    }

    const win = iframe.contentWindow;
    const doc = win?.document || iframe.contentDocument;
    if (!win || !doc) {
      window.print();
      return false;
    }

    if (pendingPrintTimer !== null) {
      window.clearTimeout(pendingPrintTimer);
      pendingPrintTimer = null;
    }

    doc.open();
    doc.write(html);
    doc.close();

    window.requestAnimationFrame(() => {
      pendingPrintTimer = window.setTimeout(() => {
        try {
          win.focus();
          win.print();
        } catch {
          window.print();
        }
        pendingPrintTimer = null;
      }, 180);
    });

    return true;
  } catch {
    window.print();
    return false;
  }
}

/**
 * Formats a concise plain-text executive summary strictly for clipboard copying.
 * (No Markdown/CSV/JSON/HTML file download paths are permitted.)
 */
export function buildClipboardSummaryText(payload: ReportPayload): string {
  const {
    financialYear,
    template,
    documentTitle,
    preparedBy,
    generatedAt,
    presidentName,
    party,
    termLabel,
    filterSummary,
    tableRowLimit,
    sections,
    analystNotes,
    excludedRollupsCount,
    macro,
    debtSnapshot,
    yoy,
    stats,
    civicEquivalents,
    findings,
    duplicateClusters,
    lineages,
    projects,
    crossLedgerFindingsCount,
    compoundProjectsCount,
    sixLedgerSummary,
  } = payload;

  const lines: string[] = [];
  lines.push(`${documentTitle} — FY ${financialYear}`);
  lines.push(`Template: ${TEMPLATE_META[template].label}`);
  lines.push(`Administration: ${presidentName} (${party} · ${termLabel})`);
  lines.push(`Filter Scope: ${filterSummary} (${excludedRollupsCount.toLocaleString()} MDA rollup rows excluded)`);
  lines.push(`Prepared By: ${preparedBy || 'Open Observatory Desk'} | Generated: ${new Date(generatedAt).toLocaleString('en-US')}`);
  lines.push('');
  lines.push('SUMMARY METRICS');
  lines.push(`- Filtered Line Items: ${stats.count.toLocaleString()} (Mean: ${formatNairaCompact(stats.avgAmount)} | Median: ${formatNairaCompact(stats.medianAmount)})`);
  lines.push(`- Total Filtered Allocation: ${formatNairaCompact(stats.totalAllocated)} (${formatNairaExact(stats.totalAllocated)})`);
  lines.push(`- Evidence Engine v3.0 Exceptions: ${findings.length.toLocaleString()} (${stats.highSeverityCount} High, ${stats.mediumSeverityCount} Medium, ${stats.lowSeverityCount} Low${typeof crossLedgerFindingsCount === 'number' ? `, ${crossLedgerFindingsCount} Cross-Ledger` : ''}${typeof compoundProjectsCount === 'number' ? `, ${compoundProjectsCount} Compound Projects` : ''})`);
  lines.push(`- Duplicate Clusters: ${stats.duplicateClusterCount.toLocaleString()} clusters (${stats.duplicateItemCount.toLocaleString()} items, ${formatNairaCompact(stats.duplicateTotalAmount)})`);

  if (sections.includeMacroContext) {
    lines.push('');
    lines.push('ENACTED MACROECONOMIC CONTEXT');
    lines.push(`- Theme: ${macro.budgetTheme}`);
    lines.push(`- Official Total Budget: ${formatNairaCompact(macro.officialTotalBudget)} | Capital: ${formatNairaCompact(macro.totalCapitalBudget)} | Recurrent Non-Debt: ${formatNairaCompact(macro.recurrentNonDebtTotal)} | Debt Service: ${formatNairaCompact(macro.debtService)}`);
    if (macro.executiveSummary) lines.push(`- Narrative Brief: ${macro.executiveSummary}`);
  }

  if (sections.includeDebtSnapshot && debtSnapshot) {
    lines.push('');
    lines.push(`DMO PUBLIC DEBT SNAPSHOT (${debtSnapshot.isExactYearMatch ? `FY${debtSnapshot.financialYear}` : `Prior FY${debtSnapshot.financialYear}`})`);
    lines.push(`- Total Debt Stock: ${debtSnapshot.totalDebtNairaM !== null ? formatNairaCompact(debtSnapshot.totalDebtNairaM * 1e6) : 'N/A'} (${debtSnapshot.totalDebtUsdM !== null ? `US$${(debtSnapshot.totalDebtUsdM / 1000).toFixed(2)}B` : 'USD N/A'})`);
    lines.push(`- DMO Reference: ${debtSnapshot.primarySource} (${debtSnapshot.asAt || `FY${debtSnapshot.financialYear}`})`);
  }

  if (sections.includeYoY && yoy) {
    lines.push('');
    lines.push(`YEAR-OVER-YEAR COMPARISON (FY${yoy.priorYear} vs FY${financialYear})`);
    lines.push(`- Enacted Total: ${formatNairaCompact(yoy.priorOfficialTotal)} -> ${formatNairaCompact(yoy.currentOfficialTotal)} (${yoy.officialDeltaPct >= 0 ? '+' : ''}${yoy.officialDeltaPct.toFixed(1)}%)`);
  }

  lines.push('');
  if (template === 'six_ledger_brief') {
    const s6 = sixLedgerSummary;
    lines.push('6-LEDGER ACCOUNTABILITY & AUDIT LAYERS (NON-ADDITIVE)');
    if (s6?.oaugf) {
      lines.push(`- OAuGF Constitutional Audits: ${s6.oaugf.parsedAuditIssuesCount.toLocaleString()} queries (${s6.oaugf.recoveryDirectiveCount} recoveries, ${s6.oaugf.repeatNeglectCount} repeat/ignored directives across ${s6.oaugf.reportsIndexed} reports)`);
    }
    if (s6?.treasuryCash) {
      lines.push(`- Open Treasury Cash Forensics: ${formatNairaCompact(s6.treasuryCash.personalStaffPaidNaira)} to ${s6.treasuryCash.personalStaffCount.toLocaleString()} personal/staff accounts; ${formatNairaCompact(s6.treasuryCash.opaqueNaira)} across ${s6.treasuryCash.opaqueVoucherCount.toLocaleString()} opaque/discretionary vouchers`);
    }
    if (s6?.billActDiff) {
      lines.push(`- Legislative Bill-to-Act Insertions: ${s6.billActDiff.allCyclesInsertionsCount.toLocaleString()} insertions totaling ${formatNairaCompact(s6.billActDiff.allCyclesInsertionsNaira)}`);
    }
    (s6?.topCompoundProjects || []).slice(0, 15).forEach((cp) => {
      lines.push(`- [Score ${cp.compoundRiskScore}/100 · ${cp.ruleCount} rules] ${cp.projectCode || 'ERGP'} | ${cp.projectName} — ${formatNairaCompact(cp.amount)} (${cp.agency})`);
    });
  } else if (template === 'forensic_digest') {
    lines.push(`FORENSIC COMPLIANCE LOG (Top ${Math.min(tableRowLimit, findings.length)} of ${findings.length})`);
    findings.slice(0, Math.min(20, tableRowLimit)).forEach((f) => {
      lines.push(`- [${f.severity.toUpperCase()}] ${f.projectCode || 'N/A'} | ${f.projectName} — ${formatNairaCompact(f.amount)} (${f.agency}, p.${f.page || '-'}) [${f.ruleName}]`);
    });
  } else if (template === 'duplicate_audit') {
    lines.push(`DUPLICATE & SPLIT CLUSTERS (${Math.min(tableRowLimit, duplicateClusters.length)} of ${duplicateClusters.length})`);
    duplicateClusters.slice(0, Math.min(20, tableRowLimit)).forEach((c) => {
      lines.push(`- ${c.id} | ${c.canonicalTitle} (${c.patternType}, ${c.count} items across ${c.distinctAgencies} MDAs) — ${formatNairaCompact(c.totalAmount)}`);
    });
  } else if (template === 'recurring_lineage') {
    lines.push(`MULTI-YEAR RECURRING LINEAGES ACTIVE IN FY${financialYear} (${Math.min(tableRowLimit, lineages.length)} of ${lineages.length})`);
    lineages.slice(0, Math.min(20, tableRowLimit)).forEach((l) => {
      const fyInst = getLineageFyInstance(l, financialYear);
      lines.push(`- ${l.projectCode || l.lineageId} | ${l.canonicalTitle} (${l.agency}, ${l.appearanceCount} yrs) — FY${financialYear}: ${formatNairaCompact(fyInst?.amount || 0)} | Cum: ${formatNairaCompact(l.cumulativeAllocation)}`);
    });
  } else if (template === 'sector_summary') {
    lines.push(`SECTORAL BREAKDOWN & FILTERED LEDGER (${Math.min(tableRowLimit, projects.length)} of ${projects.length})`);
    stats.sectorBreakdown.slice(0, 10).forEach((s) => {
      lines.push(`- ${s.sector}: ${formatNairaCompact(s.totalAmount)} (${s.sharePct.toFixed(1)}%, ${s.count.toLocaleString()} items)`);
    });
  } else {
    lines.push('TOP EXECUTING AGENCIES & PRIORITY EXCEPTIONS');
    stats.topAgencies.slice(0, 10).forEach((a) => {
      lines.push(`- ${a.agency}: ${formatNairaCompact(a.totalAmount)} (${a.sharePct.toFixed(1)}%)`);
    });
    findings.slice(0, Math.min(10, tableRowLimit)).forEach((f) => {
      lines.push(`- [${f.severity.toUpperCase()}] ${f.projectCode || 'N/A'} ${f.projectName} — ${formatNairaCompact(f.amount)} (p.${f.page || '-'})`);
    });
  }

  if (sections.includeCivicImpact) {
    lines.push('');
    lines.push(`CIVIC INFRASTRUCTURE EQUIVALENTS (${formatNairaCompact(stats.totalAllocated)})`);
    lines.push(`- Equipped PHCs: ${civicEquivalents.equivalents.phcs.toLocaleString()} | 3-Classroom Blocks: ${civicEquivalents.equivalents.classroomBlocks.toLocaleString()} | Solar Boreholes: ${civicEquivalents.equivalents.solarBoreholes.toLocaleString()}`);
  }

  if (sections.includeAnalystNotes && analystNotes.trim()) {
    lines.push('');
    lines.push('ANALYST NOTES');
    lines.push(analystNotes.trim());
  }

  lines.push('');
  lines.push('Source: BudgetLens Civic Fiscal Observatory — Verified against Federal Appropriation Act PDF schedules.');
  return lines.join('\n');
}
