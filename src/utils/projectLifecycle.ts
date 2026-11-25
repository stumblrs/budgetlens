/**
 * Client-side 5-Stage Project Lifecycle & Paid-on-Paper loader and helpers (Phase 3 · Stage P3-S2).
 *
 * Operates 100% offline against static `public/datasets/project_lifecycle_index.json`
 * and 64 deterministic FNV-1a shards under `/datasets/project_lifecycle/{00..63}.json`.
 */

import { apiUrl, fetchDataset } from '../services/apiClient';

export type MtefStageStatus = 'EXACT_YEAR_MTEF' | 'NO_MTEF_BENCHMARK';

export interface MtefStageData {
  financialYear: number;
  status: MtefStageStatus;
  oilPriceUsdPerBbl: number | null;
  oilProductionMbpd: number | null;
  exchangeRateNairaPerUsd: number | null;
  gdpGrowthPct: number | null;
  inflationPct: number | null;
  docTitle: string | null;
  docSlug: string | null;
  sourcePage: number | null;
  sha256: string | null;
  coveringDocTitle: string | null;
  coveringDocSha256: string | null;
}

export interface BillDiffStageData {
  status: string;
  diffId?: string | null;
  proposedAmountNaira?: number | null;
  enactedAmountNaira?: number | null;
  deltaNaira?: number | null;
  deltaPct?: number | null;
  isZonalIntervention?: boolean;
  billPage?: number | null;
  actPage?: number | null;
  matchConfidence?: string | null;
  cycleAvailable: boolean;
}

export interface BirMdaBreakdownRow {
  mdaName: string;
  normMda: string;
  coreKey: string;
  families: string[];
  appropriatedNaira: number;
  releasedNaira: number;
  utilizedNaira: number | null;
  releasePct: number | null;
  utilizationPct: number | null;
  overspendVirement: boolean;
}

export interface BirYearSummary {
  financialYear: number;
  quarterCovered: string | null;
  reportPeriodLabel: string | null;
  reportTitle: string | null;
  granularity: string;
  overallReleasePct: number | null;
  overallUtilizationPct: number | null;
  mdaCount: number;
  mdaBreakdown: BirMdaBreakdownRow[];
}

export interface BirStageData {
  status: 'MATCHED_MDA' | 'NO_MDA_BREAKDOWN' | 'NO_BIR_REPORT';
  matchType: 'EXACT_MDA' | 'PARENT_MINISTRY_MDA' | 'NONE';
  matchedMdaName: string | null;
  quarterCovered: string | null;
  reportPeriodLabel: string | null;
  appropriatedNaira: number | null;
  releasedNaira: number | null;
  utilizedNaira: number | null;
  releasePct: number | null;
  utilizationPct: number | null;
  overspendVirement: boolean;
  nationalOverallReleasePct: number | null;
  nationalOverallUtilizationPct: number | null;
}

export interface LifecycleContractorSummary {
  contractorName: string;
  bppContractorId?: string | null;
  awardCount: number;
  awardedNaira: number;
  nocopoDisbursedNaira: number;
  mdaGovspendCount: number;
  mdaGovspendPaidNaira: number;
  totalGovspendCount: number;
  totalGovspendPaidNaira: number;
  nonCompetitiveCount: number;
  procurementMethods: string[];
  years: number[];
  leaderboardContractCount?: number;
  leaderboardTotalContractedNaira?: number;
  leaderboardFirstYear?: number | null;
  leaderboardLastYear?: number | null;
  leaderboardMdaCount?: number;
  leaderboardTopMdas?: string[];
}

export interface LifecycleContractItem {
  ocid: string;
  financialYear: number;
  stage: string;
  title: string;
  mdaName: string;
  contractorName: string | null;
  bppContractorId?: string | null;
  awardNaira: number;
  paidNaira: number;
  awardDate: string | null;
  procurementMethod: string | null;
}

export interface NocopoStageData {
  status: 'AWARDED_AND_PAID' | 'AWARDED_UNPAID' | 'PLANNING_OR_TENDER_ONLY' | 'NO_PUBLIC_CONTRACT';
  matchMethod: string;
  confidenceScore: number;
  awardedContractCount: number;
  planningCount: number;
  totalAwardedNaira: number;
  totalNocopoDisbursedNaira: number;
  distinctContractorCount: number;
  nonCompetitiveCount: number;
  contractors: LifecycleContractorSummary[];
  contracts: LifecycleContractItem[];
}

export interface LifecycleVoucherItem {
  paymentNo: string;
  paymentDate: string;
  financialYear: number;
  organizationName: string;
  beneficiaryName: string;
  amountNaira: number;
  description: string;
}

export interface GovspendStageData {
  status: 'DIRECT_TREASURY_VOUCHERS' | 'VENDOR_MDA_PAYOUTS_RECORDED' | 'NO_TREASURY_VOUCHER_MATCH';
  directVoucherCount: number;
  directPaidNaira: number;
  directVouchers: LifecycleVoucherItem[];
  vendorMdaVoucherCount: number;
  vendorMdaPaidNaira: number;
  vendorMdaVouchers: LifecycleVoucherItem[];
}

export type PaidOnPaperTier = 'DIRECT_PROJECT_PAID' | 'VENDOR_MDA_PAID' | 'NONE';

export interface ProjectLifecycleRecord {
  recordId: string;
  financialYear: number;
  projectCode: string;
  projectName: string;
  agency: string;
  amountNaira: number;
  page: number;
  paidOnPaperPriority: boolean;
  paidOnPaperTier: PaidOnPaperTier;
  paidOnPaperReason: string;
  verifiedDisbursedNaira: number;
  billDiff: BillDiffStageData;
  bir: BirStageData;
  nocopo: NocopoStageData;
  govspend: GovspendStageData;
}

export interface CodeLifecycleFallback {
  projectCode: string;
  recordId: string | null;
  financialYear: number;
  paidOnPaperPriority: boolean;
  paidOnPaperTier: PaidOnPaperTier;
  paidOnPaperReason: string;
  verifiedDisbursedNaira: number;
  billDiff: BillDiffStageData | null;
  nocopo: NocopoStageData;
  govspend: GovspendStageData;
}

export interface ScrutinyLifecycleBadge {
  paidOnPaperPriority: boolean;
  paidOnPaperTier: PaidOnPaperTier;
  nocopoStatus: NocopoStageData['status'];
  awardedNaira: number;
  nocopoDisbursedNaira: number;
  directGovspendNaira: number;
  vendorMdaPaidNaira: number;
  contractorName: string | null;
  billDiffStatus: string;
  billDeltaPct: number | null;
  birStatus: BirStageData['status'];
  birReleasePct: number | null;
}

export interface ProjectLifecycleIndex {
  generatedAt: string;
  status: string;
  shardCount: number;
  shardDir: string;
  diffCyclesAvailable: number[];
  summary: {
    totalLinkedRecords: number;
    uniqueLinkedCodes: number;
    paidOnPaperCount: number;
    directProjectPaidCount: number;
    vendorMdaPaidCount: number;
    nocopoAwardedCount: number;
    nocopoDisbursedCount: number;
    nocopoPlanningOnlyCount: number;
    directGovspendErgpCount: number;
    billDiffLinkedCount: number;
    birMdaMatchedCount: number;
    mtefMatchedCount: number;
    totalAwardedNaira: number;
    totalNocopoDisbursedNaira: number;
    totalDirectGovspendNaira: number;
    scrutinyItemsScanned: number;
    scrutinyBadgeCount: number;
    scrutinyPaidOnPaperCount: number;
    maxShardBytes: number;
  };
  mtefByYear: Record<string, MtefStageData>;
  birByYear: Record<string, BirYearSummary>;
  priorityRecords: Array<Record<string, unknown>>;
  scrutinyBadges: Record<string, ScrutinyLifecycleBadge>;
}

export interface LifecycleShardPayload {
  byRecordId: Record<string, ProjectLifecycleRecord>;
  byCode: Record<string, CodeLifecycleFallback>;
}

export interface ResolvedProjectLifecycle {
  financialYear: number;
  recordId: string;
  projectCode: string;
  paidOnPaperPriority: boolean;
  paidOnPaperTier: PaidOnPaperTier;
  paidOnPaperReason: string;
  verifiedDisbursedNaira: number;
  mtef: MtefStageData;
  billDiff: BillDiffStageData;
  bir: BirStageData;
  nocopo: NocopoStageData;
  govspend: GovspendStageData;
  matchedVia: 'BY_RECORD_ID' | 'BY_PROJECT_CODE' | 'SYNTHESIZED_MACRO_BIR';
}

const UNIQUE_PROJECT_CODE_RE = /^(?:ERGP\d{5,12}|[A-Z]{3,8}\d{5,12})$/;
const ERGP_EXTRACT_RE = /\bERGP[\s-]?(\d{5,12})\b/i;
const MDA_SUFFIX_RE = /(?:\s*-\s*HQTRS|\bHQTRS\b|\bHEADQUARTERS\b|\s*-\s*MAIN\s+MOD\b|\bMAIN\s+MOD\b)/gi;
const MDA_PREFIX_RE = /^(?:FEDERAL\s+MINISTRY\s+OF|FED\s+MINISTRY\s+OF|MINISTRY\s+OF|OFFICE\s+OF\s+THE|OFFICE\s+OF)\s+/i;

const DEFAULT_NOCOPO: NocopoStageData = {
  status: 'NO_PUBLIC_CONTRACT',
  matchMethod: 'NONE',
  confidenceScore: 0,
  awardedContractCount: 0,
  planningCount: 0,
  totalAwardedNaira: 0,
  totalNocopoDisbursedNaira: 0,
  distinctContractorCount: 0,
  nonCompetitiveCount: 0,
  contractors: [],
  contracts: [],
};

const DEFAULT_GOVSPEND: GovspendStageData = {
  status: 'NO_TREASURY_VOUCHER_MATCH',
  directVoucherCount: 0,
  directPaidNaira: 0,
  directVouchers: [],
  vendorMdaVoucherCount: 0,
  vendorMdaPaidNaira: 0,
  vendorMdaVouchers: [],
};

export function isUniqueProjectCode(raw?: string | null): string {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return '';
  const ergp = s.match(ERGP_EXTRACT_RE);
  if (ergp?.[1]) return `ERGP${ergp[1]}`;
  const compact = s.replace(/[\s-]+/g, '');
  return UNIQUE_PROJECT_CODE_RE.test(compact) ? compact : '';
}

export function getLifecycleShardBucket(rawKey: string): string {
  const s = String(rawKey || '').trim().toUpperCase();
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  }
  return String(h % 64).padStart(2, '0');
}

export function normalizeMdaNameClient(raw?: string | null): string {
  let text = String(raw || '').toUpperCase().trim();
  if (!text) return '';
  text = text.replace(/&/g, ' AND ');
  text = text.replace(MDA_SUFFIX_RE, ' ');
  text = text.replace(/\bFED\.?\s+MIN\.?\s+OF\b/g, 'FEDERAL MINISTRY OF');
  text = text.replace(/\bMIN\.?\s+OF\b/g, 'MINISTRY OF');
  text = text.replace(/[^A-Z0-9\s]+/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

export function normalizeMdaCoreClient(raw?: string | null): string {
  const norm = normalizeMdaNameClient(raw);
  if (!norm) return '';
  return norm.replace(MDA_PREFIX_RE, '').trim() || norm;
}

const ANTI_CORRUPTION_RE = /\b(?:ICPC|INDEPENDENT\s+CORRUPT\s+PRACTICES|EFCC|ECONOMIC\s+AND\s+FINANCIAL\s+CRIMES|CODE\s+OF\s+CONDUCT)\b/i;

function hasFamilyPattern(txt: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(txt));
}

export function classifyParentMinistryFamiliesClient(raw?: string | null): string[] {
  const txt = normalizeMdaNameClient(raw);
  if (!txt) return [];
  if (ANTI_CORRUPTION_RE.test(txt)) return ['ANTI_CORRUPTION'];

  const families: string[] = [];
  const add = (fam: string) => {
    if (!families.includes(fam)) families.push(fam);
  };

  if (
    hasFamilyPattern(txt, [
      /\bWORKS?\b/,
      /\bFERMA\b/,
      /\bROAD\s+MAINTENANCE\b/,
      /\bHIGHWAYS?\b/,
      /\bSURVEYOR\s+GENERAL\b/,
    ])
  ) {
    add('WORKS');
  }
  if (hasFamilyPattern(txt, [/\bHOUSING\b/, /\bURBAN\s+DEVT\b/, /\bURBAN\s+DEVELOPMENT\b/])) {
    add('HOUSING');
  }
  if (
    hasFamilyPattern(txt, [
      /\bPOWER\b/,
      /\bELECTRIFICATION\b/,
      /\bELECTRICITY\b/,
      /\bTRANSMISSION\s+COMPANY\b/,
    ])
  ) {
    add('POWER');
  }
  if (
    hasFamilyPattern(txt, [
      /\bINLAND\s+WATERWAYS\b/,
      /\bWATERWAYS\b/,
      /\bMARITIME\b/,
      /\bRAILWAYS?\b/,
      /\bTRANSPORT(?:ATION)?\b/,
      /\bROAD\s+SAFETY\b/,
      /\bFRSC\b/,
    ])
  ) {
    add('TRANSPORT');
  }
  if (
    hasFamilyPattern(txt, [
      /\bAVIATION\b/,
      /\bAIRPORTS?\b/,
      /\bAIRSPACE\b/,
      /\bNAMA\b/,
      /\bNCAA\b/,
      /\bNIMET\b/,
    ])
  ) {
    add('AVIATION');
  }
  if (
    hasFamilyPattern(txt, [
      /\bWATER\s+RESOURCES\b/,
      /\bBASIN\b/,
      /\bRBDAS?\b/,
      /\bHYDROLOG/,
      /^WATER$/,
    ])
  ) {
    add('WATER');
  }
  if (
    hasFamilyPattern(txt, [
      /\bHEALTH\b/,
      /\bHOSPITALS?\b/,
      /\bMEDICAL\b/,
      /\bNACA\b/,
      /\bNAFDAC\b/,
      /\bN?PHCDA\b/,
    ])
  ) {
    add('HEALTH');
  }
  if (
    hasFamilyPattern(txt, [
      /\bEDUCATION\b/,
      /\bUNIVERSIT(?:Y|IES)\b/,
      /\bPOLYTECHNICS?\b/,
      /\bUNITY\s+SCHOOLS?\b/,
      /\bUBEC\b/,
      /\bBASIC\s+EDUCATION\b/,
      /\bTETFUND\b/,
      /\bNBTE\b/,
      /\bNCCE\b/,
      /\bNUC\b/,
      /\bNECO\b/,
      /\bJAMB\b/,
      /\bMASS\s+LITERACY\b/,
      /\bLIBRARY\b/,
    ])
  ) {
    add('EDUCATION');
  }
  if (
    hasFamilyPattern(txt, [
      /\bAGRICULTUR/,
      /\bRURAL\s+DEVELOPMENT\b/,
      /\bHORTICULTURE\b/,
      /\bFORESTRY\b/,
      /\bFISHER/,
      /\bLIVESTOCK\b/,
      /\bGRAINS?\b/,
      /\bCOCOA\b/,
      /\bNALDA\b/,
    ])
  ) {
    add('AGRICULTURE');
  }
  if (
    hasFamilyPattern(txt, [
      /\bCIVIL\s+DEFENCE\b/,
      /\bIMMIGRATION\b/,
      /\bPRISONS?\b/,
      /\bCORRECTIONAL\b/,
      /\bFIRE\s+SERVICE\b/,
      /\bINTERIOR\b/,
    ])
  ) {
    add('INTERIOR');
  }
  if (hasFamilyPattern(txt, [/\bPOLICE\b/])) {
    add('POLICE');
  }
  if (
    hasFamilyPattern(txt, [
      /\bDEFENCE\b/,
      /\bDEFENSE\b/,
      /\bARMY\b/,
      /\bNAVY\b/,
      /\bNAVAL\b/,
      /\bAIRFORCE\b/,
      /\bAIR\s+FORCE\b/,
      /\bDICON\b/,
      /\bNDA\b/,
      /\bMAIN\s+MOD\b/,
    ])
  ) {
    add('DEFENCE');
  }
  if (
    hasFamilyPattern(txt, [
      /\bNATIONAL\s+SECURITY\s+ADVISER\b/,
      /\bONSA\b/,
      /\bSTATE\s+SECURITY\b/,
      /\bDSS\b/,
      /\bINTELLIGEN(?:CE|T)\s+AGENCY\b/,
    ])
  ) {
    add('ONSA');
  }
  if (hasFamilyPattern(txt, [/\bFCTA?\b/, /\bFEDERAL\s+CAPITAL\s+TERRITORY\b/])) {
    add('FCTA');
  }
  if (hasFamilyPattern(txt, [/\bNIGER\s+DELTA\b/, /\bNDDC\b/])) {
    add('NIGER_DELTA');
  }
  if (
    hasFamilyPattern(txt, [
      /\bSCIENCE\b/,
      /\bTECHNOLOG/,
      /\bBIOTECHNOLOG/,
      /\bSPACE\s+RESEARCH\b/,
      /\bNASENI\b/,
      /\bPRODA\b/,
      /\bENERGY\s+COMMISSION\b/,
    ])
  ) {
    add('SCIENCE_TECH');
  }
  if (
    hasFamilyPattern(txt, [
      /\bENVIRONMENT\b/,
      /\bECOLOGICAL\b/,
      /\bBIOSAFETY\b/,
      /\bCLIMATE\s+CHANGE\b/,
      /\bHYPREP\b/,
    ])
  ) {
    add('ENVIRONMENT');
  }
  if (
    hasFamilyPattern(txt, [
      /\bTRADE\b/,
      /\bINVESTMENT\b/,
      /\bINDUSTRY\b/,
      /\bSMEDAN\b/,
      /\bEXPORT\s+PROMOTION\b/,
      /\bNEPZA\b/,
    ])
  ) {
    add('TRADE_INVESTMENT');
  }
  if (
    hasFamilyPattern(txt, [
      /\bHUMANITARIAN\b/,
      /\bDISASTER\b/,
      /\bNEMA\b/,
      /\bREFUGEES?\b/,
      /\bNORTH\s+EAST\s+DEVELOPMENT\b/,
      /\bNEDC\b/,
    ])
  ) {
    add('HUMANITARIAN');
  }
  if (hasFamilyPattern(txt, [/\bLABOUR\b/, /\bLABOR\b/, /\bEMPLOYMENT\b/, /\bPRODUCTIVITY\b/, /\bNDE\b/])) {
    add('LABOUR');
  }
  if (hasFamilyPattern(txt, [/\bWOMEN\s+AFFAIRS\b/, /\bWOMEN\s+DEVELOPMENT\b/])) {
    add('WOMEN_AFFAIRS');
  }
  if (hasFamilyPattern(txt, [/\bYOUTH\b/, /\bSPORTS?\b/, /\bNYSC\b/])) {
    add('YOUTH_SPORTS');
  }
  if (
    hasFamilyPattern(txt, [
      /\bMINES\b/,
      /\bSTEEL\b/,
      /\bSOLID\s+MINERALS\b/,
      /\bGEOLOGICAL\b/,
      /\bMETALLURGICAL\b/,
    ])
  ) {
    add('MINES_STEEL');
  }
  if (
    hasFamilyPattern(txt, [
      /\bSECRETARY\s+TO\s+(?:THE\s+)?GOVERNMENT\b/,
      /\bOSGF\b/,
      /\bSGF\b/,
      /\bBORDER\s+COMMUNITIES\b/,
    ])
  ) {
    add('OSGF');
  }
  if (hasFamilyPattern(txt, [/\bSTATE\s+HOUSE\b/, /\bPRESIDENCY\b/])) {
    add('PRESIDENCY');
  }

  return families;
}

export function matchBirMdaEntry(
  birYear: BirYearSummary | null | undefined,
  rawMdaName?: string | null
): BirStageData {
  if (!birYear) {
    return {
      status: 'NO_BIR_REPORT',
      matchType: 'NONE',
      matchedMdaName: null,
      quarterCovered: null,
      reportPeriodLabel: null,
      appropriatedNaira: null,
      releasedNaira: null,
      utilizedNaira: null,
      releasePct: null,
      utilizationPct: null,
      overspendVirement: false,
      nationalOverallReleasePct: null,
      nationalOverallUtilizationPct: null,
    };
  }

  const baseNat = {
    quarterCovered: birYear.quarterCovered ?? null,
    reportPeriodLabel: birYear.reportPeriodLabel ?? null,
    nationalOverallReleasePct: birYear.overallReleasePct ?? null,
    nationalOverallUtilizationPct: birYear.overallUtilizationPct ?? null,
  };

  const mdas = birYear.mdaBreakdown || [];
  if (mdas.length === 0) {
    return {
      status: 'NO_MDA_BREAKDOWN',
      matchType: 'NONE',
      matchedMdaName: null,
      appropriatedNaira: null,
      releasedNaira: null,
      utilizedNaira: null,
      releasePct: null,
      utilizationPct: null,
      overspendVirement: false,
      ...baseNat,
    };
  }

  const normQ = normalizeMdaNameClient(rawMdaName);
  const coreQ = normalizeMdaCoreClient(rawMdaName);

  let matched: BirMdaBreakdownRow | undefined;
  let matchType: BirStageData['matchType'] = 'NONE';

  if (normQ || coreQ) {
    matched = mdas.find((m) => (normQ && m.normMda === normQ) || (coreQ && m.coreKey === coreQ));
    if (matched) {
      matchType = 'EXACT_MDA';
    } else {
      const qFams = classifyParentMinistryFamiliesClient(rawMdaName);
      if (qFams.length > 0) {
        let bestRank = -1;
        let bestRow: BirMdaBreakdownRow | undefined;
        for (const qf of qFams) {
          for (const m of mdas) {
            const mFams = m.families || [];
            if (mFams.includes(qf)) {
              const rank = mFams.length === 1 ? 2 : 1;
              if (rank > bestRank) {
                bestRank = rank;
                bestRow = m;
              }
            }
          }
          if (bestRow) break;
        }
        if (bestRow) {
          matched = bestRow;
          matchType = 'PARENT_MINISTRY_MDA';
        }
      }
    }
  }

  if (!matched) {
    return {
      status: 'NO_MDA_BREAKDOWN',
      matchType: 'NONE',
      matchedMdaName: null,
      appropriatedNaira: null,
      releasedNaira: null,
      utilizedNaira: null,
      releasePct: null,
      utilizationPct: null,
      overspendVirement: false,
      ...baseNat,
    };
  }

  return {
    status: 'MATCHED_MDA',
    matchType,
    matchedMdaName: matched.mdaName,
    appropriatedNaira: matched.appropriatedNaira,
    releasedNaira: matched.releasedNaira,
    utilizedNaira: matched.utilizedNaira,
    releasePct: matched.releasePct,
    utilizationPct: matched.utilizationPct,
    overspendVirement: Boolean(matched.overspendVirement),
    ...baseNat,
  };
}

export function computePaidOnPaperStatus(
  nocopo: Pick<NocopoStageData, 'awardedContractCount' | 'totalNocopoDisbursedNaira'>,
  govspend: Pick<
    GovspendStageData,
    'directVoucherCount' | 'directPaidNaira' | 'vendorMdaVoucherCount' | 'vendorMdaPaidNaira'
  >
): {
  paidOnPaperPriority: boolean;
  paidOnPaperTier: PaidOnPaperTier;
  paidOnPaperReason: string;
  verifiedDisbursedNaira: number;
} {
  const nocPaid = Math.max(0, Math.round(nocopo.totalNocopoDisbursedNaira || 0));
  const govDirectPaid = Math.max(0, Math.round(govspend.directPaidNaira || 0));

  if (nocPaid > 0 || govDirectPaid > 0) {
    const parts: string[] = [];
    if (nocPaid > 0) {
      parts.push(`NGN ${nocPaid.toLocaleString('en-US')} recorded as disbursed in NOCOPO`);
    }
    if (govDirectPaid > 0) {
      parts.push(
        `NGN ${govDirectPaid.toLocaleString('en-US')} across ${govspend.directVoucherCount} ERGP-cited Open Treasury voucher(s)`
      );
    }
    return {
      paidOnPaperPriority: true,
      paidOnPaperTier: 'DIRECT_PROJECT_PAID',
      paidOnPaperReason: `${parts.join('; ')}.`,
      verifiedDisbursedNaira: Math.max(nocPaid, govDirectPaid),
    };
  }

  const vendorPaid = Math.max(0, Math.round(govspend.vendorMdaPaidNaira || 0));
  if ((nocopo.awardedContractCount || 0) > 0 && vendorPaid > 0) {
    return {
      paidOnPaperPriority: true,
      paidOnPaperTier: 'VENDOR_MDA_PAID',
      paidOnPaperReason:
        `Awarded contractor received NGN ${vendorPaid.toLocaleString('en-US')} across ${govspend.vendorMdaVoucherCount} ` +
        'same-MDA Open Treasury voucher(s) (MDA-to-contractor Treasury context; vouchers may span multiple contracts).',
      verifiedDisbursedNaira: 0,
    };
  }

  return {
    paidOnPaperPriority: false,
    paidOnPaperTier: 'NONE',
    paidOnPaperReason: '',
    verifiedDisbursedNaira: 0,
  };
}

let cachedIndexPromise: Promise<ProjectLifecycleIndex | null> | null = null;

export function resetLifecycleClientCache(): void {
  cachedIndexPromise = null;
}

export function loadProjectLifecycleIndex(): Promise<ProjectLifecycleIndex | null> {
  if (!cachedIndexPromise) {
    cachedIndexPromise = fetchDataset<ProjectLifecycleIndex>('project_lifecycle_index').catch(() => null);
  }
  return cachedIndexPromise;
}

export function lookupScrutinyBadge(
  index: ProjectLifecycleIndex | null | undefined,
  item: { id?: string | null; projectCode?: string | null }
): ScrutinyLifecycleBadge | null {
  if (!index?.scrutinyBadges) return null;
  const rid = String(item.id || '').trim().toUpperCase();
  if (rid && index.scrutinyBadges[rid]) {
    return index.scrutinyBadges[rid];
  }
  const uc = isUniqueProjectCode(item.projectCode);
  if (uc && index.scrutinyBadges[uc]) {
    return index.scrutinyBadges[uc];
  }
  return null;
}

function defaultNoMtefStage(fy: number): MtefStageData {
  return {
    financialYear: fy,
    status: 'NO_MTEF_BENCHMARK',
    oilPriceUsdPerBbl: null,
    oilProductionMbpd: null,
    exchangeRateNairaPerUsd: null,
    gdpGrowthPct: null,
    inflationPct: null,
    docTitle: null,
    docSlug: null,
    sourcePage: null,
    sha256: null,
    coveringDocTitle: null,
    coveringDocSha256: null,
  };
}

export async function loadProjectLifecycleForRecord(target: {
  id?: string | null;
  projectCode?: string | null;
  projectName?: string | null;
  financialYear: number;
  agency?: string | null;
}): Promise<ResolvedProjectLifecycle | null> {
  const fy = target.financialYear;
  const ridUp = String(target.id || '').trim().toUpperCase();
  const ucode =
    isUniqueProjectCode(target.projectCode) || isUniqueProjectCode(target.projectName);

  try {
    const lookupId = encodeURIComponent(ridUp || ucode || 'lookup');
    const qs = new URLSearchParams({ year: String(fy) });
    if (ucode) qs.set('code', ucode);
    if (target.agency) qs.set('mda', target.agency);
    const res = await fetch(apiUrl(`/api/v1/projects/${lookupId}/lifecycle?${qs.toString()}`), {
      cache: 'no-cache',
    });
    if (res.ok) {
      const apiLc = await res.json();
      if (apiLc?.ok) {
        const pop = computePaidOnPaperStatus(apiLc.nocopo || [], apiLc.govspend || []);
        return {
          financialYear: fy,
          recordId: apiLc.recordId || ridUp || ucode || 'RECORD',
          projectCode: apiLc.projectCode || ucode,
          paidOnPaperPriority: apiLc.paidOnPaperPriority || pop.paidOnPaperPriority,
          paidOnPaperTier: apiLc.paidOnPaperTier || pop.paidOnPaperTier,
          paidOnPaperReason: apiLc.paidOnPaperReason || pop.paidOnPaperReason,
          verifiedDisbursedNaira: apiLc.verifiedDisbursedNaira ?? pop.verifiedDisbursedNaira,
          mtef: apiLc.mtef || defaultNoMtefStage(fy),
          billDiff: apiLc.billDiff || {
            status: 'NO_BILL_DIFF_CYCLE',
            cycleAvailable: false,
          },
          bir: apiLc.bir || { status: 'NO_BIR_REPORT', financialYear: fy },
          nocopo: apiLc.nocopo || [],
          govspend: apiLc.govspend || [],
          matchedVia: apiLc.nocopo?.length
            ? 'BY_RECORD_ID'
            : ucode
              ? 'BY_PROJECT_CODE'
              : 'SYNTHESIZED_MACRO_BIR',
        };
      }
    }
  } catch {
    // Fall through to compact index-level synthesis
  }

  const index = await loadProjectLifecycleIndex();
  if (!index) return null;

  const mtef = index.mtefByYear?.[String(fy)] || defaultNoMtefStage(fy);
  const bir = matchBirMdaEntry(index.birByYear?.[String(fy)], target.agency);
  const diffCycles = index.diffCyclesAvailable || [];
  const defaultDiff: BillDiffStageData = {
    status: diffCycles.includes(fy) ? 'NOT_IN_ALTERED_DIFF' : 'NO_BILL_DIFF_CYCLE',
    cycleAvailable: diffCycles.includes(fy),
  };

  return {
    financialYear: fy,
    recordId: ridUp || ucode || 'RECORD',
    projectCode: ucode || String(target.projectCode || ''),
    paidOnPaperPriority: false,
    paidOnPaperTier: 'NONE',
    paidOnPaperReason: '',
    verifiedDisbursedNaira: 0,
    mtef,
    billDiff: defaultDiff,
    bir,
    nocopo: DEFAULT_NOCOPO,
    govspend: DEFAULT_GOVSPEND,
    matchedVia: 'SYNTHESIZED_MACRO_BIR',
  };
}
