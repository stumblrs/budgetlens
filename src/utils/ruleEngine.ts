// ─── BudgetLens Rule Engine v3.0 (Domain + 6 Cross-Ledger Forensic Rules) ───
// Deterministic, versioned transparency rules applied to all budget projects.
// Supports 22 total rules:
//   • 16 Text & Domain Rules (v2.0 parity; runs even without cross-ledger context)
//   • 6 Cross-Ledger Forensic Rules (activated when CrossLedgerContextWire is provided)
// Also computes deduplicated CompoundFlaggedProject[] ranking projects where
// multiple rules and multiple external ledgers converge on a single line item.

import type { CompactMdaRiskProfile, CrossLedgerContextWire } from './evidenceEngineV3';
import { normalizeMdaCoreClient } from './projectLifecycle';

export interface CrossLedgerBadges {
  paidOnPaper: boolean;
  billInsertedOrInflated: boolean;
  zombieRecurringLineage: boolean;
  mdaOaugfIssuesCount: number;
  mdaOaugfRepeatCount: number;
  mdaOaugfAmountNaira: number;
  mdaIntegrityGrade: string;
  mdaCompositeScore: number | null;
  mdaPersonalOrOpaquePayoutFlag: boolean;
  mdaConvergenceFlags: string[];
  mdaRepeatAssetCategories: string[];
}

export interface EvidenceItem {
  id: string;
  ruleId: string;
  ruleName: string;
  ruleVersion: string;
  ledgerScope?: 'TEXT_AND_DOMAIN' | 'CROSS_LEDGER';
  projectName: string;
  projectCode: string;
  amount: number;
  page: number;
  sector: string;
  financialYear: number;
  severity: 'high' | 'medium' | 'low';
  confidence: number;
  reason: string;
  budgetCode: string;
  agency: string;
  crossLedgerBadges?: CrossLedgerBadges;
}

export interface CompoundFlaggedProject {
  projectKey: string;
  id: string;
  projectCode: string;
  projectName: string;
  agency: string;
  sector: string;
  financialYear: number;
  amount: number;
  page: number;
  highestSeverity: 'high' | 'medium' | 'low';
  compoundRiskScore: number;
  ruleCount: number;
  crossLedgerRuleCount: number;
  triggeredRules: Array<{
    ruleId: string;
    ruleName: string;
    severity: 'high' | 'medium' | 'low';
    ledgerScope: 'TEXT_AND_DOMAIN' | 'CROSS_LEDGER';
    reason: string;
  }>;
  crossLedgerBadges: CrossLedgerBadges;
}

interface Rule {
  id: string;
  name: string;
  version: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
  confidence: number;
  category: string;
  ledgerScope: 'TEXT_AND_DOMAIN' | 'CROSS_LEDGER';
  match: (title: string, amount: number, sector: string, agency: string, projectCode: string) => boolean;
  explain: (title: string, amount: number, agency: string) => string;
}

// ─── Domain Guards & Utilities ────────────────────────────────────────────────
const containsAny = (text: string, terms: string[]) =>
  terms.some((t) => text.includes(t));

const nairaBn = (n: number) =>
  n >= 1e12
    ? `₦${(n / 1e12).toFixed(2)} Trillion`
    : n >= 1e9
      ? `₦${(n / 1e9).toFixed(2)} Billion`
      : `₦${(n / 1e6).toFixed(2)} Million`;

const MDA_ROLLUP_RE = /^[0-5]\d{8,9}$/;
const UNIQUE_PROJECT_CODE_RE = /^(?:ERGP\d{5,12}|[A-Z]{3,8}\d{5,12})$/;
const ERGP_EXTRACT_RE = /\bERGP[\s-]?(\d{5,12})\b/i;

const SECURITY_TERMS = [
  'defence', 'army', 'navy', 'airforce', 'air force', 'police',
  'dss', 'state security', 'nia', 'onsa', 'national security adviser',
  'nscdc', 'immigration', 'customs', 'fire service', 'defence intelligence',
];

const HEALTH_OR_PRISON_TERMS = [
  'correctional', 'prison', 'hospital', 'medical centre', 'medical center',
  'cancer', 'university college hospital', 'orthopaedic', 'psychiatric',
];

const MULTILATERAL_TERMS = [
  'multilateral', 'bilateral', 'tied loan', 'world bank', 'afdb', 'isdb',
];

function isSecurityAgency(agency: string): boolean {
  const low = (agency || '').toLowerCase();
  return SECURITY_TERMS.some((k) => low.includes(k));
}

function isHealthOrPrisonAgency(agency: string, title = ''): boolean {
  const low = `${agency || ''} ${title || ''}`.toLowerCase();
  return HEALTH_OR_PRISON_TERMS.some((k) => low.includes(k));
}

function isMultilateralLoan(title: string): boolean {
  const low = (title || '').toLowerCase();
  return MULTILATERAL_TERMS.some((k) => low.includes(k));
}

function parseQuantity(title: string): number | null {
  const m = /\b(\d{1,3})\s*(?:nos?\.?|units?)\b/i.exec(title || '');
  if (!m) return null;
  const q = parseInt(m[1], 10);
  return q > 0 ? q : null;
}

export function extractCanonicalProjectCode(rawCode?: string | null, rawTitle?: string | null): string {
  for (const candidate of [rawCode, rawTitle]) {
    const s = String(candidate || '').trim().toUpperCase();
    if (!s) continue;
    const m = s.match(ERGP_EXTRACT_RE);
    if (m?.[1]) return `ERGP${m[1]}`;
    const compact = s.replace(/[\s-]+/g, '');
    if (UNIQUE_PROJECT_CODE_RE.test(compact)) return compact;
  }
  return '';
}

const DISCRETIONARY_OVERHEAD_CODES: Record<string, string> = {
  '22020104': 'International Travel & Transport (Others)',
  '22020103': 'International Travel & Transport (Training)',
  '22021007': 'Welfare Packages',
  '22021002': 'Honorarium & Sitting Allowance',
  '22021001': 'Refreshment & Meals',
  '22021003': 'Publicity & Advertisements',
  '22021009': 'Sporting Activities',
};

const NON_CORE_MDA_RE = /(agricultur|river\s+basin|rbda|research\s+inst|forestry|fisher|horticultur|cocoa|rubber|oil\s+palm|root\s+crop|cereals|animal|veterinary|labour|humanitarian|border\s+comm|smedan|film|cultur|arts|tourism|sports|youth|science|tech|education|health|raw\s+materials)/i;
const MANDATE_INSERTION_RE = /\b(solar\s+street\s*lights?|street\s*lights?|motorcycles?|tricycles?|keke|sewing\s+machines?|grinding\s+machines?|make\s*up|makeup|palaces?|mosques?|church(?:es)?|town\s*halls?|transformers?|asphalt\s+roads?|deep\s+freezers?|hair\s+dry|clippers?|barbing)\b/i;

const ASSET_CATEGORY_KEYWORDS: Record<string, string[]> = {
  hilux_pickups: ['hilux', 'pickup', 'pick-up'],
  suv_saloons: ['suv', 'prado', 'land cruiser', 'landcruiser', 'saloon', 'lexus'],
  staff_buses: ['coaster bus', 'hiace', 'staff bus', 'utility bus'],
  generators: ['generator', 'generating set', 'kva'],
  computers_laptops: ['computer', 'laptop', 'desktop'],
  photocopiers_printers: ['photocopier', 'printer', 'scanner'],
  office_furniture: ['furniture', 'furnishing', 'office equipment'],
  solar_systems: ['solar street light', 'solar light', 'solar power'],
  transformers: ['transformer'],
  motorcycles_tricycles: ['motorcycle', 'tricycle', 'keke'],
};

// ─── 16 Text & Domain Rule Definitions (v2.0 Parity) ──────────────────────────
const TEXT_RULES: Rule[] = [
  {
    id: 'MDA_MANDATE_MISMATCH',
    name: 'MDA Mandate Mismatch / Non-Core Insertion',
    version: '2.0.0',
    description: 'Non-Power/Works MDA budgeting streetlights, motorcycles, makeup/sewing kits, palaces, or asphalt roads.',
    severity: 'high',
    confidence: 0.96,
    category: 'Mandate Mismatch',
    ledgerScope: 'TEXT_AND_DOMAIN',
    match: (t, amt, _sec, ag, code) => {
      if (amt < 25_000_000 || !/^(ergp|zip|nass)/i.test(code)) return false;
      const upAg = (ag || '').toUpperCase();
      if (upAg.includes('POWER') || upAg.includes('RURAL ELECTRIFICATION') || upAg.includes('WORKS')) return false;
      return NON_CORE_MDA_RE.test(ag) && MANDATE_INSERTION_RE.test(t);
    },
    explain: (_title, amt, ag) =>
      `Allocation of ${nairaBn(amt)} placed under ${ag || 'this MDA'} exhibits a non-core infrastructure/empowerment insertion outside its primary statutory mandate.`,
  },
  {
    id: 'VAGUE_BLANK_CHECK',
    name: 'Blank-Check / Vague Mega-Allocation',
    version: '2.0.0',
    description: 'Capital line item >=₦500M citing "selected locations", "multiple lots", or non-specific descriptors.',
    severity: 'high',
    confidence: 0.94,
    category: 'Geographic Vagueness',
    ledgerScope: 'TEXT_AND_DOMAIN',
    match: (t, amt, _sec, _ag, code) => {
      if (amt < 500_000_000 || !/^(ergp|zip|nass)/i.test(code) || isMultilateralLoan(t)) return false;
      if (containsAny(t, ['selected locations', 'multiple lots', 'various locations', 'across the nation', 'nationwide', 'different locations', 'special intervention', 'constituency projects'])) {
        return true;
      }
      const words = t.split(/\s+/).filter((w) => w.length > 2);
      return amt >= 1_000_000_000 && words.length < 6;
    },
    explain: (_title, amt) =>
      `High-value allocation of ${nairaBn(amt)} uses un-itemized location/lot descriptors ("selected locations" / "multiple lots" / vague phrasing) without verifiable community coordinates.`,
  },
  {
    id: 'VEHICLE_UNIT_COST_ANOMALY',
    name: 'Non-Military Vehicle Unit-Cost Outlier',
    version: '2.0.0',
    description: 'Non-security vehicle procurement >=₦100M, computing implied cost per vehicle when quantities appear.',
    severity: 'high',
    confidence: 0.95,
    category: 'Fleet Unit-Cost',
    ledgerScope: 'TEXT_AND_DOMAIN',
    match: (t, amt, _sec, ag, code) => {
      if (amt < 100_000_000 || !/^(ergp|zip|nass)/i.test(code)) return false;
      if (isSecurityAgency(ag) || isHealthOrPrisonAgency(ag, t)) return false;
      return /\b(suv|prado|land\s*cruiser|hilux|saloon|bulletproof|armoured|armored|official\s+vehicle|utility\s+vehicle|operational\s+vehicle|project\s+vehicle|motor\s+vehicle|coaster\s+bus|toyota|lexus|mercedes)\b/i.test(t);
    },
    explain: (title, amt) => {
      const qty = parseQuantity(title);
      if (qty) {
        const unitCost = Math.round(amt / qty);
        return `Non-military vehicle allocation of ${nairaBn(amt)} specifies ${qty} unit(s), implying ${nairaBn(unitCost)} per vehicle.`;
      }
      return `Non-military vehicle procurement of ${nairaBn(amt)} exceeds the ₦100M executive fleet scrutiny threshold.`;
    },
  },
  {
    id: 'MEGA_CAPITAL_ALLOCATION',
    name: 'Mega Capital Infrastructure Spend',
    version: '2.0.0',
    description: 'Single capital line item exceeds ₦5B — requires heightened public scrutiny.',
    severity: 'high',
    confidence: 0.99,
    category: 'High-Value Spend',
    ledgerScope: 'TEXT_AND_DOMAIN',
    match: (_, amt, _sec, _ag, code) => amt > 5_000_000_000 && /^(ergp|zip|nass)/i.test(code),
    explain: (_, amt) =>
      `Single capital allocation of ${nairaBn(amt)} exceeds ₦5B. Meets the platform's mega-capital scrutiny criteria requiring heightened public review.`,
  },
  {
    id: 'HIGH_VEHICLE_PROCUREMENT',
    name: 'Executive Vehicle & VIP Fleets',
    version: '2.0.0',
    description: 'Non-security vehicle/fleet purchase exceeding ₦250M.',
    severity: 'high',
    confidence: 0.94,
    category: 'Fleet Expansion',
    ledgerScope: 'TEXT_AND_DOMAIN',
    match: (t, amt, _sec, ag) => {
      if (amt <= 250_000_000 || isSecurityAgency(ag) || isHealthOrPrisonAgency(ag, t)) return false;
      return containsAny(t, ['vehicle', 'suv', 'bus', 'pickup', 'fleet', 'automobile', 'saloon']);
    },
    explain: (_, amt) =>
      `Vehicle procurement allocation of ${nairaBn(amt)} exceeds the ₦250M non-security fleet scrutiny threshold.`,
  },
  {
    id: 'NON_ESSENTIAL_CEREMONIAL',
    name: 'Non-Essential Ceremonial & Lifestyle Kits',
    version: '2.0.0',
    description: 'Cosmetic/makeup kits, souvenirs, hampers, or banquet/golf/VIP lodge outlays >=₦25M.',
    severity: 'high',
    confidence: 0.94,
    category: 'Non-Essential Spend',
    ledgerScope: 'TEXT_AND_DOMAIN',
    match: (t, amt, _sec, ag) => {
      if (amt < 25_000_000 || isSecurityAgency(ag)) return false;
      return /\b(make\s*up|makeup|souvenir|hamper|banquet\s+hall|vvip|golf|recreation\s+club|sporting\s+activit|vip\s+lodge)\b/i.test(t);
    },
    explain: (_, amt) =>
      `Allocation of ${nairaBn(amt)} targets non-essential ceremonial, hospitality, or lifestyle items prioritized for public justification review.`,
  },
  {
    id: 'ROYAL_PALACE_INFRASTRUCTURE',
    name: 'Palace, State House & Executive Lodges',
    version: '2.0.0',
    description: 'Federal capital spend >=₦50M on palaces, dodan barracks, or presidential/VIP lodges.',
    severity: 'high',
    confidence: 0.97,
    category: 'Executive Quarters',
    ledgerScope: 'TEXT_AND_DOMAIN',
    match: (t, amt, _sec, ag) => {
      if (amt <= 50_000_000 || isSecurityAgency(ag)) return false;
      return containsAny(t, ['palace', 'guest house', 'presidential lodge', 'dodan barracks', 'state house', 'governor', 'emirate', 'monarch', 'traditional ruler']);
    },
    explain: (_, amt) =>
      `Residential/ceremonial quarters allocation of ${nairaBn(amt)} meets non-essential executive/traditional lodge review criteria.`,
  },
  {
    id: 'RELIGIOUS_INFRASTRUCTURE',
    name: 'Direct Funding of Religious / Pilgrimage Facilities',
    version: '2.0.0',
    description: 'Direct federal capital allocation >=₦50M for church, mosque, or pilgrimage infrastructure.',
    severity: 'high',
    confidence: 0.96,
    category: 'Sectarian Expenditure',
    ledgerScope: 'TEXT_AND_DOMAIN',
    match: (t, amt) =>
      amt > 50_000_000 &&
      containsAny(t, ['church', 'mosque', 'cathedral', 'chapel', 'islamic centre', 'hajj', 'pilgrims']),
    explain: (_, amt) =>
      `Allocation of ${nairaBn(amt)} for religious or pilgrimage facilities meets sectarian expenditure transparency criteria.`,
  },
  {
    id: 'DISCRETIONARY_OVERHEAD',
    name: 'Discretionary Overhead Spike (Travel / Meals / Welfare)',
    version: '2.0.0',
    description: 'Single MDA 2202xxxx overhead item >=₦100M for international travel, refreshments, honoraria, publicity, or welfare.',
    severity: 'medium',
    confidence: 0.93,
    category: 'Administrative Overhead',
    ledgerScope: 'TEXT_AND_DOMAIN',
    match: (t, amt, _sec, ag, code) => {
      if (amt < 100_000_000 || !DISCRETIONARY_OVERHEAD_CODES[code]) return false;
      return !isHealthOrPrisonAgency(ag, t);
    },
    explain: (_title, amt, ag) =>
      `Discretionary administrative overhead line of ${nairaBn(amt)} under ${ag || 'Federal MDA'} exceeds the ₦100M single-line threshold.`,
  },
  {
    id: 'HIGH_RENOVATION_COST',
    name: 'VIP Office & Complex Renovation Overhead',
    version: '2.0.0',
    description: 'Renovation or refurbishment allocation exceeds ₦500M threshold (excluding hospitals).',
    severity: 'medium',
    confidence: 0.90,
    category: 'Office Refurbishment',
    ledgerScope: 'TEXT_AND_DOMAIN',
    match: (t, amt, _sec, ag) =>
      amt > 500_000_000 &&
      !isHealthOrPrisonAgency(ag, t) &&
      containsAny(t, ['renovation', 'refurbish', 'rehabilitation', 'remodeling', 'remodelling', 'restoration']),
    explain: (_, amt) =>
      `Renovation/rehabilitation allocation of ${nairaBn(amt)} exceeds the ₦500M scrutiny threshold.`,
  },
  {
    id: 'LARGE_TRAINING_ALLOCATION',
    name: 'Sensitizations, Workshops & Advocacy Grants',
    version: '2.0.0',
    description: 'Intangible training, workshop, advocacy or sensitization item >=₦200M (excluding multilateral loans).',
    severity: 'medium',
    confidence: 0.90,
    category: 'Intangible Services',
    ledgerScope: 'TEXT_AND_DOMAIN',
    match: (t, amt) =>
      amt > 200_000_000 &&
      !isMultilateralLoan(t) &&
      containsAny(t, ['training', 'workshop', 'seminar', 'capacity building', 'capacity-building', 'conference', 'sensitization', 'advocacy', 'awareness campaign', 'symposium', 'town hall']),
    explain: (_, amt) =>
      `Intangible workshop/advocacy allocation of ${nairaBn(amt)} exceeds the ₦200M soft-spend review threshold.`,
  },
  {
    id: 'HIGH_CONSULTANCY',
    name: 'Consultancy & External Advisory Services',
    version: '2.0.0',
    description: 'Consultancy, advisory or feasibility services allocation >=₦200M.',
    severity: 'medium',
    confidence: 0.93,
    category: 'Professional Services',
    ledgerScope: 'TEXT_AND_DOMAIN',
    match: (t, amt) =>
      amt > 200_000_000 &&
      !isMultilateralLoan(t) &&
      containsAny(t, ['consultancy', 'consulting', 'advisory', 'professional services', 'feasibility study', 'consultant']),
    explain: (_, amt) =>
      `Consultancy spend of ${nairaBn(amt)} exceeds the ₦200M review threshold.`,
  },
  {
    id: 'GENERIC_DESCRIPTION',
    name: 'Generic or Vague Line Item Title',
    version: '2.0.0',
    description: 'Project title has < 6 meaningful words for an allocation above ₦1B.',
    severity: 'medium',
    confidence: 0.80,
    category: 'Vague Descriptions',
    ledgerScope: 'TEXT_AND_DOMAIN',
    match: (t, amt, _sec, _ag, code) => {
      if (amt <= 1_000_000_000 || !/^(ergp|zip|nass)/i.test(code)) return false;
      const words = t.split(/\s+/).filter((w) => w.length > 2);
      return words.length < 6;
    },
    explain: (title, amt) =>
      `Project "${title}" has fewer than 6 meaningful words for an allocation of ${nairaBn(amt)}.`,
  },
  {
    id: 'EMPOWERMENT_ITEM',
    name: 'Empowerment & Starter Kit Grants',
    version: '2.0.0',
    description: 'Empowerment, starter packs or kit distribution program >=₦100M (excluding multilateral loans).',
    severity: 'low',
    confidence: 0.85,
    category: 'Distributive Grants',
    ledgerScope: 'TEXT_AND_DOMAIN',
    match: (t, amt) =>
      amt > 100_000_000 &&
      !isMultilateralLoan(t) &&
      containsAny(t, ['empowerment', 'kits', 'starter pack', 'distribution', 'grants to']),
    explain: (_, amt) =>
      `Empowerment/distribution allocation of ${nairaBn(amt)} requires field verification that items reached intended beneficiaries.`,
  },
  {
    id: 'LARGE_FURNITURE',
    name: 'Annual Office Furniture & IT Re-Procurement',
    version: '2.0.0',
    description: 'Office furniture, fittings or IT equipment purchase exceeds ₦200M (excluding hospitals).',
    severity: 'low',
    confidence: 0.88,
    category: 'Administrative Procurement',
    ledgerScope: 'TEXT_AND_DOMAIN',
    match: (t, amt, _sec, ag) =>
      amt > 200_000_000 &&
      !isHealthOrPrisonAgency(ag, t) &&
      containsAny(t, ['furniture', 'furnishing', 'office equipment', 'fittings', 'generator', 'air condition', 'computers', 'laptops']),
    explain: (_, amt) =>
      `Furniture/office IT allocation of ${nairaBn(amt)} exceeds the ₦200M scrutiny threshold.`,
  },
  {
    id: 'SOLAR_STREET_LIGHTS',
    name: 'Solar Street Lighting Allocations',
    version: '2.0.0',
    description: 'Solar street lighting allocation exceeding ₦200M.',
    severity: 'low',
    confidence: 0.86,
    category: 'Procurement',
    ledgerScope: 'TEXT_AND_DOMAIN',
    match: (t, amt) =>
      amt > 200_000_000 &&
      containsAny(t, ['solar street light', 'street lighting', 'solar light']),
    explain: (_, amt) =>
      `Solar street lighting allocation of ${nairaBn(amt)} meets the platform's unit-cost and mandate review threshold.`,
  },
];

// ─── 6 Cross-Ledger Forensic Rule Metadata (v3.0) ─────────────────────────────
const CROSS_LEDGER_RULES_META: Array<{
  id: string;
  name: string;
  version: string;
  severity: 'high' | 'medium' | 'low';
  confidence: number;
  category: string;
  ledgerScope: 'CROSS_LEDGER';
  description: string;
}> = [
    {
      id: 'LEGISLATIVE_INSERTION_ANOMALY',
      name: 'Legislative Insertion / Bill-to-Act Markup Spike',
      version: '3.0.0',
      severity: 'high',
      confidence: 0.97,
      category: 'Cross-Ledger: Bill vs. Act',
      ledgerScope: 'CROSS_LEDGER',
      description: 'Line item was newly inserted (NASS_INSERTION) or inflated >=+100% (>=₦100M delta) between the Executive Proposal Bill and Enacted Appropriation Act.',
    },
    {
      id: 'PAID_ON_PAPER_HIGH_RISK',
      name: 'Paid-on-Paper High-Risk Disbursement',
      version: '3.0.0',
      severity: 'high',
      confidence: 0.98,
      category: 'Cross-Ledger: Cash & Procurement',
      ledgerScope: 'CROSS_LEDGER',
      description: 'Line item triggers a forensic scrutiny rule AND has verified NOCOPO contract disbursement or Open Treasury cash vouchers — immediate physical site verification priority.',
    },
    {
      id: 'ZOMBIE_RECURRING_LINEAGE',
      name: 'Multi-Year Recurring Zombie / Vendor-Switched Lineage',
      version: '3.0.0',
      severity: 'high',
      confidence: 0.95,
      category: 'Cross-Ledger: Multi-Year Lineage',
      ledgerScope: 'CROSS_LEDGER',
      description: 'Line item belongs to a recurring project lineage appearing across >=3 budget cycles or exhibiting vendor-switched repeat awards.',
    },
    {
      id: 'OAUGF_INDICTED_MDA_RISKY_SPEND',
      name: 'Risky Spend in OAuGF-Queried / Repeat-Neglect MDA',
      version: '3.0.0',
      severity: 'high',
      confidence: 0.94,
      category: 'Cross-Ledger: OAuGF Constitutional Audit',
      ledgerScope: 'CROSS_LEDGER',
      description: 'High-value (>=₦100M) flagged or discretionary allocation placed under an MDA with >=10 OAuGF Constitutional Audit queries or repeat/ignored audit directives.',
    },
    {
      id: 'PERSONAL_OR_OPAQUE_PAYOUT_MDA_RISK',
      name: 'Allocation in MDA with Personal-Account / Blank-Voucher Payouts',
      version: '3.0.0',
      severity: 'high',
      confidence: 0.93,
      category: 'Cross-Ledger: Open Treasury Forensics',
      ledgerScope: 'CROSS_LEDGER',
      description: 'High-value (>=₦100M) flagged or discretionary allocation in an MDA flagged for STAFF_OR_INDIVIDUAL personal bank account disbursements (₦1.49T pool) or blank-description Treasury vouchers (₦1.41T pool).',
    },
    {
      id: 'REPEAT_ASSET_LIFESPAN_VIOLATION',
      name: 'Repeat Physical Asset Buy Inside Statutory Lifespan',
      version: '3.0.0',
      severity: 'medium',
      confidence: 0.92,
      category: 'Cross-Ledger: Physical Asset Ledger',
      ledgerScope: 'CROSS_LEDGER',
      description: 'Equipment, vehicle, IT, or generator allocation (>=₦50M) by an MDA flagged in the 28-Year Physical Asset Ledger for re-procuring the same asset class inside its usable lifespan.',
    },
  ];

// ─── Engine Entry Point ───────────────────────────────────────────────────────
export interface RawProject {
  id: string;
  projectCode: string;
  projectName: string;
  financialYear: number;
  amount: number;
  projectType: string;
  page: number;
  sector: string;
  agency?: string;
}

function resolveMdaProfileFromContext(
  mdaMap: Record<string, CompactMdaRiskProfile> | undefined,
  agency: string
): CompactMdaRiskProfile | null {
  if (!mdaMap || !agency) return null;
  const key = normalizeMdaCoreClient(agency);
  if (!key) return null;
  if (mdaMap[key]) return mdaMap[key];
  for (const [k, prof] of Object.entries(mdaMap)) {
    if (k.length >= 6 && (key.includes(k) || k.includes(key))) {
      return prof;
    }
  }
  return null;
}

export function applyRules(
  projects: RawProject[],
  crossLedgerContext?: CrossLedgerContextWire | null
): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  let counter = 0;

  const popSet = crossLedgerContext?.paidOnPaperCodes
    ? new Set(crossLedgerContext.paidOnPaperCodes)
    : null;
  const billSet = crossLedgerContext?.billInsertionCodes
    ? new Set(crossLedgerContext.billInsertionCodes)
    : null;
  const zombieSet = crossLedgerContext?.zombieLineageCodes
    ? new Set(crossLedgerContext.zombieLineageCodes)
    : null;
  const mdaProfiles = crossLedgerContext?.mdaProfilesByKey;

  for (const p of projects) {
    const code = String(p.projectCode || '').trim();
    if (MDA_ROLLUP_RE.test(code)) continue; // Exclude summary rollup header rows

    const title = p.projectName ? p.projectName.toLowerCase() : '';
    const amt = p.amount || 0;
    const sector = p.sector || 'Unknown';
    const agency = p.agency || '';

    if (amt < 25_000_000) continue; // Performance & materiality floor

    const ucode = crossLedgerContext ? extractCanonicalProjectCode(code, p.projectName) : '';
    const mdaProf = crossLedgerContext ? resolveMdaProfileFromContext(mdaProfiles, agency) : null;

    const isPaidOnPaper = Boolean(ucode && popSet?.has(ucode));
    const isBillInserted = Boolean(ucode && billSet?.has(ucode));
    const isZombieLineage = Boolean(ucode && zombieSet?.has(ucode));

    const badges: CrossLedgerBadges | undefined = crossLedgerContext
      ? {
        paidOnPaper: isPaidOnPaper,
        billInsertedOrInflated: isBillInserted,
        zombieRecurringLineage: isZombieLineage,
        mdaOaugfIssuesCount: mdaProf?.oi || 0,
        mdaOaugfRepeatCount: mdaProf?.or || 0,
        mdaOaugfAmountNaira: mdaProf?.oa || 0,
        mdaIntegrityGrade: mdaProf?.g || 'N/A',
        mdaCompositeScore: mdaProf?.s ?? null,
        mdaPersonalOrOpaquePayoutFlag: Boolean(mdaProf?.po),
        mdaConvergenceFlags: mdaProf?.cf || [],
        mdaRepeatAssetCategories: mdaProf?.ra || [],
      }
      : undefined;

    const matchedThisProject: Array<{
      ruleId: string;
      ruleName: string;
      ruleVersion: string;
      ledgerScope: 'TEXT_AND_DOMAIN' | 'CROSS_LEDGER';
      severity: 'high' | 'medium' | 'low';
      confidence: number;
      reason: string;
    }> = [];

    // 1. Evaluate 16 Text & Domain Rules
    for (const rule of TEXT_RULES) {
      if (rule.match(title, amt, sector, agency, code)) {
        matchedThisProject.push({
          ruleId: rule.id,
          ruleName: rule.name,
          ruleVersion: rule.version,
          ledgerScope: 'TEXT_AND_DOMAIN',
          severity: rule.severity,
          confidence: rule.confidence,
          reason: rule.explain(p.projectName, amt, agency),
        });
      }
    }

    // 2. Evaluate 6 Cross-Ledger Forensic Rules (when crossLedgerContext is provided)
    if (crossLedgerContext) {
      if (isBillInserted) {
        matchedThisProject.push({
          ruleId: 'LEGISLATIVE_INSERTION_ANOMALY',
          ruleName: 'Legislative Insertion / Bill-to-Act Markup Spike',
          ruleVersion: '3.0.0',
          ledgerScope: 'CROSS_LEDGER',
          severity: 'high',
          confidence: 0.97,
          reason: `Line item (${code || ucode}) of ${nairaBn(amt)} was newly inserted or inflated >=+100% between the Executive Proposal Bill and Enacted Act.`,
        });
      }

      if (isPaidOnPaper && (matchedThisProject.length > 0 || amt >= 250_000_000)) {
        matchedThisProject.push({
          ruleId: 'PAID_ON_PAPER_HIGH_RISK',
          ruleName: 'Paid-on-Paper High-Risk Disbursement',
          ruleVersion: '3.0.0',
          ledgerScope: 'CROSS_LEDGER',
          severity: 'high',
          confidence: 0.98,
          reason: `Allocation of ${nairaBn(amt)} has verified public contract disbursement or Open Treasury cash vouchers — top priority for citizen physical site verification.`,
        });
      }

      if (isZombieLineage) {
        matchedThisProject.push({
          ruleId: 'ZOMBIE_RECURRING_LINEAGE',
          ruleName: 'Multi-Year Recurring Zombie / Vendor-Switched Lineage',
          ruleVersion: '3.0.0',
          ledgerScope: 'CROSS_LEDGER',
          severity: 'high',
          confidence: 0.95,
          reason: `Project code ${ucode || code} belongs to a multi-year recurring lineage appearing across >=3 federal budget cycles.`,
        });
      }

      if (
        mdaProf &&
        (mdaProf.oi >= 10 || mdaProf.or >= 1) &&
        amt >= 100_000_000 &&
        matchedThisProject.length > 0
      ) {
        matchedThisProject.push({
          ruleId: 'OAUGF_INDICTED_MDA_RISKY_SPEND',
          ruleName: 'Risky Spend in OAuGF-Queried / Repeat-Neglect MDA',
          ruleVersion: '3.0.0',
          ledgerScope: 'CROSS_LEDGER',
          severity: 'high',
          confidence: 0.94,
          reason: `Flagged allocation of ${nairaBn(amt)} sits inside ${agency || mdaProf.n}, which has ${mdaProf.oi} OAuGF Constitutional Audit queries${mdaProf.or > 0 ? ` (${mdaProf.or} repeat/ignored)` : ''}.`,
        });
      }

      if (
        mdaProf &&
        mdaProf.po === 1 &&
        amt >= 100_000_000 &&
        matchedThisProject.length > 0
      ) {
        matchedThisProject.push({
          ruleId: 'PERSONAL_OR_OPAQUE_PAYOUT_MDA_RISK',
          ruleName: 'Allocation in MDA with Personal-Account / Blank-Voucher Payouts',
          ruleVersion: '3.0.0',
          ledgerScope: 'CROSS_LEDGER',
          severity: 'high',
          confidence: 0.93,
          reason: `Flagged allocation of ${nairaBn(amt)} sits inside ${agency || mdaProf.n}, an agency flagged in Open Treasury forensics for personal staff-account disbursements or blank-description vouchers.`,
        });
      }

      if (mdaProf && mdaProf.ra.length > 0 && amt >= 50_000_000) {
        let matchedAssetCat: string | null = null;
        for (const catKey of mdaProf.ra) {
          const kws = ASSET_CATEGORY_KEYWORDS[catKey] || [];
          if (kws.some((kw) => title.includes(kw))) {
            matchedAssetCat = catKey;
            break;
          }
        }
        if (matchedAssetCat) {
          matchedThisProject.push({
            ruleId: 'REPEAT_ASSET_LIFESPAN_VIOLATION',
            ruleName: 'Repeat Physical Asset Buy Inside Statutory Lifespan',
            ruleVersion: '3.0.0',
            ledgerScope: 'CROSS_LEDGER',
            severity: 'medium',
            confidence: 0.92,
            reason: `Physical equipment allocation of ${nairaBn(amt)} under ${agency || mdaProf.n} intersects an active repeat-procurement alert (${matchedAssetCat.replace(/_/g, ' ')}) inside statutory asset lifespan.`,
          });
        }
      }
    }

    for (const m of matchedThisProject) {
      counter++;
      items.push({
        id: `EV-${p.financialYear}-${String(counter).padStart(6, '0')}`,
        ruleId: m.ruleId,
        ruleName: m.ruleName,
        ruleVersion: m.ruleVersion,
        ...(crossLedgerContext ? { ledgerScope: m.ledgerScope } : {}),
        projectName: p.projectName,
        projectCode: code,
        amount: amt,
        page: p.page,
        sector,
        financialYear: p.financialYear,
        severity: m.severity,
        confidence: m.confidence,
        reason: m.reason,
        budgetCode: code || p.id,
        agency: agency || 'Federal Government of Nigeria',
        ...(badges ? { crossLedgerBadges: badges } : {}),
      });
    }
  }

  // Sort: high severity first, then by amount descending
  return items.sort((a, b) => {
    const sev = { high: 3, medium: 2, low: 1 };
    if (sev[b.severity] !== sev[a.severity]) return sev[b.severity] - sev[a.severity];
    return b.amount - a.amount;
  });
}

/**
 * Groups individual rule findings into deduplicated CompoundFlaggedProject[] rows
 * (1 row per project, ranked by compound risk score, rule count, and Naira exposure).
 */
export function buildCompoundFlaggedProjects(
  evidenceItems: EvidenceItem[]
): CompoundFlaggedProject[] {
  const map = new Map<string, CompoundFlaggedProject>();
  const sevRank = { high: 3, medium: 2, low: 1 };

  for (const item of evidenceItems) {
    const key = `${item.financialYear}:${item.projectCode || item.budgetCode}:${item.page}:${item.amount}`;
    const scope: 'TEXT_AND_DOMAIN' | 'CROSS_LEDGER' =
      item.ledgerScope ||
      (CROSS_LEDGER_RULES_META.some((r) => r.id === item.ruleId) ? 'CROSS_LEDGER' : 'TEXT_AND_DOMAIN');

    const existing = map.get(key);
    if (!existing) {
      const defaultBadges: CrossLedgerBadges = item.crossLedgerBadges || {
        paidOnPaper: false,
        billInsertedOrInflated: false,
        zombieRecurringLineage: false,
        mdaOaugfIssuesCount: 0,
        mdaOaugfRepeatCount: 0,
        mdaOaugfAmountNaira: 0,
        mdaIntegrityGrade: 'N/A',
        mdaCompositeScore: null,
        mdaPersonalOrOpaquePayoutFlag: false,
        mdaConvergenceFlags: [],
        mdaRepeatAssetCategories: [],
      };
      map.set(key, {
        projectKey: key,
        id: item.budgetCode || item.id,
        projectCode: item.projectCode,
        projectName: item.projectName,
        agency: item.agency,
        sector: item.sector,
        financialYear: item.financialYear,
        amount: item.amount,
        page: item.page,
        highestSeverity: item.severity,
        compoundRiskScore: 0,
        ruleCount: 1,
        crossLedgerRuleCount: scope === 'CROSS_LEDGER' ? 1 : 0,
        triggeredRules: [
          {
            ruleId: item.ruleId,
            ruleName: item.ruleName,
            severity: item.severity,
            ledgerScope: scope,
            reason: item.reason,
          },
        ],
        crossLedgerBadges: defaultBadges,
      });
    } else {
      if (!existing.triggeredRules.some((r) => r.ruleId === item.ruleId)) {
        existing.triggeredRules.push({
          ruleId: item.ruleId,
          ruleName: item.ruleName,
          severity: item.severity,
          ledgerScope: scope,
          reason: item.reason,
        });
        existing.ruleCount = existing.triggeredRules.length;
        if (scope === 'CROSS_LEDGER') {
          existing.crossLedgerRuleCount += 1;
        }
        if (sevRank[item.severity] > sevRank[existing.highestSeverity]) {
          existing.highestSeverity = item.severity;
        }
      }
    }
  }

  const list = Array.from(map.values());
  for (const proj of list) {
    let score = 0;
    for (const r of proj.triggeredRules) {
      score += r.severity === 'high' ? 22 : r.severity === 'medium' ? 14 : 8;
      if (r.ledgerScope === 'CROSS_LEDGER') score += 8;
    }
    if (proj.crossLedgerBadges.paidOnPaper) score += 10;
    if (proj.crossLedgerBadges.mdaIntegrityGrade === 'F') score += 8;
    else if (proj.crossLedgerBadges.mdaIntegrityGrade === 'D') score += 5;
    proj.compoundRiskScore = Math.min(100, score);
  }

  return list.sort(
    (a, b) =>
      b.ruleCount - a.ruleCount ||
      b.crossLedgerRuleCount - a.crossLedgerRuleCount ||
      b.compoundRiskScore - a.compoundRiskScore ||
      b.amount - a.amount
  );
}

export function getRulesSummary(includeCrossLedger = true) {
  const base = TEXT_RULES.map((r) => ({
    id: r.id,
    name: r.name,
    version: r.version,
    severity: r.severity,
    category: r.category,
    ledgerScope: r.ledgerScope,
    description: r.description,
  }));
  if (!includeCrossLedger) return base;
  return [
    ...base,
    ...CROSS_LEDGER_RULES_META.map((r) => ({
      id: r.id,
      name: r.name,
      version: r.version,
      severity: r.severity,
      category: r.category,
      ledgerScope: r.ledgerScope,
      description: r.description,
    })),
  ];
}

export interface CompoundProjectLookup {
  byProjectKey: Map<string, CompoundFlaggedProject>;
  byId: Map<string, CompoundFlaggedProject>;
  byCodePageAmount: Map<string, CompoundFlaggedProject>;
  byUniqueCode: Map<string, CompoundFlaggedProject>;
}

/**
 * Indexes `CompoundFlaggedProject[]` by composite key, record id,
 * `projectCode:page:amount`, and unambiguous canonical projectCode
 * for O(1) attachment onto raw budget schedule tables.
 */
export function buildCompoundProjectLookup(
  compoundProjects: CompoundFlaggedProject[] | null | undefined
): CompoundProjectLookup {
  const byProjectKey = new Map<string, CompoundFlaggedProject>();
  const byId = new Map<string, CompoundFlaggedProject>();
  const byCodePageAmount = new Map<string, CompoundFlaggedProject>();
  const codeCounts = new Map<string, number>();
  const firstByCode = new Map<string, CompoundFlaggedProject>();

  for (const cp of compoundProjects || []) {
    if (cp.projectKey) {
      byProjectKey.set(cp.projectKey, cp);
    }
    if (cp.id) {
      byId.set(cp.id, cp);
    }
    const cpaKey = `${cp.projectCode || ''}:${cp.page || 0}:${cp.amount || 0}`;
    byCodePageAmount.set(cpaKey, cp);

    const canonicalCode = extractCanonicalProjectCode(cp.projectCode, cp.projectName);
    if (canonicalCode) {
      codeCounts.set(canonicalCode, (codeCounts.get(canonicalCode) || 0) + 1);
      if (!firstByCode.has(canonicalCode)) {
        firstByCode.set(canonicalCode, cp);
      }
    }
  }

  const byUniqueCode = new Map<string, CompoundFlaggedProject>();
  for (const [code, count] of codeCounts.entries()) {
    if (count === 1) {
      const cp = firstByCode.get(code);
      if (cp) byUniqueCode.set(code, cp);
    }
  }

  return { byProjectKey, byId, byCodePageAmount, byUniqueCode };
}

export function findCompoundForProject(
  lookup: CompoundProjectLookup | null | undefined,
  financialYear: number,
  project: { id?: string; projectCode?: string; projectName?: string; page?: number; amount?: number } | null | undefined
): CompoundFlaggedProject | null {
  if (!lookup || !project) return null;
  const rawCode = String(project.projectCode || '').trim();
  const canonicalCode = extractCanonicalProjectCode(project.projectCode, project.projectName);
  const page = Number(project.page || 0);
  const amount = Number(project.amount || 0);

  for (const codeCandidate of [rawCode, canonicalCode, project.id || '']) {
    if (!codeCandidate) continue;
    const pk = `${financialYear}:${codeCandidate}:${page}:${amount}`;
    const byPk = lookup.byProjectKey.get(pk);
    if (byPk) return byPk;
  }

  if (project.id) {
    const byId = lookup.byId.get(String(project.id));
    if (byId) return byId;
  }

  for (const codeCandidate of [rawCode, canonicalCode]) {
    if (!codeCandidate) continue;
    const byCpa = lookup.byCodePageAmount.get(`${codeCandidate}:${page}:${amount}`);
    if (byCpa) return byCpa;
  }

  if (canonicalCode) {
    const byCode = lookup.byUniqueCode.get(canonicalCode);
    if (byCode) return byCode;
  }

  return null;
}
