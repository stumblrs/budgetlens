/**
 * Client-side Evidence Engine v3.0 All-Years Index & Cross-Ledger Context Loader
 * (Phase 5 · Stage P5-S2 / Checkpoint EE-CP-2).
 *
 * Operates 100% offline against `/datasets/evidence_engine_all_years.json` (< 275 KB)
 * and builds the compact `CrossLedgerRuleContext` passed to Rule Engine v3.0 and the Web Worker.
 */

import { fetchDataset } from '../services/apiClient';
import { normalizeMdaCoreClient } from './projectLifecycle';

export interface CompactMdaRiskProfile {
  /** Verbatim or canonical MDA name */
  n: string;
  /** Composite Integrity Grade ('A'..'F' or 'N/A') */
  g: string;
  /** Composite Integrity Score (0..100 or null) */
  s: number | null;
  /** OAuGF Constitutional Audit query count */
  oi: number;
  /** OAuGF Repeat / Ignored directive count */
  or: number;
  /** OAuGF total queried Naira amount */
  oa: number;
  /** 1 if flagged for STAFF_OR_INDIVIDUAL personal-account payouts or blank vouchers */
  po: number;
  /** 6-Ledger Convergence flag IDs */
  cf: string[];
  /** Repeat physical asset categories procured inside usable lifespan */
  ra: string[];
}

export interface CrossLedgerContextWire {
  paidOnPaperCodes: string[];
  billInsertionCodes: string[];
  zombieLineageCodes: string[];
  mdaProfilesByKey: Record<string, CompactMdaRiskProfile>;
}

export interface EvidenceRuleCatalogEntry {
  id: string;
  name: string;
  version: string;
  severity: 'high' | 'medium' | 'low';
  confidence: number;
  category: string;
  ledgerScope: 'TEXT_AND_DOMAIN' | 'CROSS_LEDGER';
  description: string;
  allYearsCount: number;
  allYearsAmountNaira: number;
  peakYear: number | null;
  topMdaName: string | null;
}

export interface EvidenceYearSummaryEntry {
  financialYear: number;
  recordsScanned: number;
  flaggedProjectsCount: number;
  ruleFindingsCount: number;
  crossLedgerFindingsCount: number;
  flaggedAmountNaira: number;
  duplicateClustersCount: number;
  duplicateItemsCount: number;
  duplicateAmountNaira: number;
  topRules: Array<{ ruleId: string; count: number }>;
}

export interface EvidenceTopMdaAllTimeEntry {
  mdaKey: string;
  mdaName: string;
  flaggedProjectCount: number;
  totalRuleFindings: number;
  crossLedgerFindings: number;
  flaggedAmountNaira: number;
  yearsActiveCount: number;
  oaugfIssues: number;
  oaugfRepeat: number;
  grade: string;
  hasPersonalOrOpaquePayoutFlag: boolean;
  topRules: Array<{ ruleId: string; count: number }>;
}

export interface EvidenceTopCompoundProjectEntry {
  id: string;
  financialYear: number;
  projectCode: string;
  projectName: string;
  agency: string;
  amount: number;
  page: number;
  ruleCount: number;
  crossLedgerCount: number;
  compoundRiskScore: number;
  ruleIds: string[];
  paidOnPaper: boolean;
  billInsertionStatus: string | null;
  mdaOaugfIssues: number;
  mdaGrade: string;
}

export interface EvidenceEngineAllYearsPayload {
  generatedAt: string;
  status: string;
  engineVersion: string;
  summary: {
    yearsScanned: number;
    firstYear: number;
    lastYear: number;
    totalRecordsScanned: number;
    totalRulesCount: number;
    textRulesCount: number;
    crossLedgerRulesCount: number;
    totalRuleFindings: number;
    totalCrossLedgerFindings: number;
    totalFlaggedProjects: number;
    totalFlaggedNaira: number;
    totalDuplicateClusters: number;
    totalDuplicateItems: number;
    totalDuplicateNaira: number;
    linkedPaidOnPaperCodesCount: number;
    linkedBillInsertionCodesCount: number;
    linkedZombieLineageCodesCount: number;
    trackedMdaRiskProfilesCount: number;
  };
  rulesCatalog: EvidenceRuleCatalogEntry[];
  byYear: EvidenceYearSummaryEntry[];
  topFlaggedMdasAllTime: EvidenceTopMdaAllTimeEntry[];
  topCompoundProjectsAllTime: EvidenceTopCompoundProjectEntry[];
  crossLedgerContext: CrossLedgerContextWire;
}

let cachedAllYearsPromise: Promise<EvidenceEngineAllYearsPayload | null> | null = null;

export function resetEvidenceEngineV3Cache(): void {
  cachedAllYearsPromise = null;
}

export function loadEvidenceEngineAllYears(): Promise<EvidenceEngineAllYearsPayload | null> {
  if (!cachedAllYearsPromise) {
    cachedAllYearsPromise = fetchDataset<EvidenceEngineAllYearsPayload>(
      'evidence_engine_all_years'
    ).catch(() => null);
  }
  return cachedAllYearsPromise;
}

export function lookupMdaRiskProfile(
  ctx: CrossLedgerContextWire | null | undefined,
  rawMdaName?: string | null
): CompactMdaRiskProfile | null {
  if (!ctx?.mdaProfilesByKey || !rawMdaName) return null;
  const key = normalizeMdaCoreClient(rawMdaName);
  if (!key) return null;
  if (ctx.mdaProfilesByKey[key]) {
    return ctx.mdaProfilesByKey[key];
  }
  // Prefix / substring fallback for truncated MDA names
  for (const [k, prof] of Object.entries(ctx.mdaProfilesByKey)) {
    if (k.length >= 6 && (key.includes(k) || k.includes(key))) {
      return prof;
    }
  }
  return null;
}
