// ─── BudgetLens Duplicate & Disguised-Rewording Detector (O(N) Engine) ───────
// Excludes MDA rollup summary codes and standard COA personnel/overhead codes
// so clusters represent genuine capital project duplicates & disguised rewordings.

export interface DuplicateCluster {
  id: string;
  canonicalTitle: string;
  sector: string;
  financialYear: number;
  count: number;
  totalAmount: number;
  distinctAgencies: number;
  distinctStates: number;
  matchType: 'Exact Wording' | 'Disguised / Reworded';
  patternType: 'Disguised Rewording' | 'Cross-MDA Duplicate' | 'Same-MDA Split' | 'Multi-Location Repeat';
  projects: Array<{
    id: string;
    projectCode: string;
    projectName: string;
    amount: number;
    page: number;
    agency?: string;
    state?: string;
  }>;
}

interface RawProject {
  id: string;
  projectCode: string;
  projectName: string;
  financialYear: number;
  amount: number;
  page: number;
  sector: string;
  agency?: string;
  state?: string;
}

const MDA_ROLLUP_RE = /^[0-5]\d{8,9}$/;
const COA_RECURRING_RE = /^(21|22)\d{6}$/;

const SYNONYMS: Record<string, string> = {
  procurement: 'buy',
  purchase: 'buy',
  supply: 'buy',
  provision: 'buy',
  acquisition: 'buy',
  buying: 'buy',
  procuring: 'buy',
  construction: 'build',
  rehabilitation: 'build',
  renovation: 'build',
  upgrading: 'build',
  completion: 'build',
  remodelling: 'build',
  remodeling: 'build',
  repair: 'build',
  refurbishment: 'build',
  installation: 'build',
  erection: 'build',
  equipping: 'build',
  streetlights: 'streetlight',
  lights: 'light',
  vehicles: 'vehicle',
  motorcycles: 'motorcycle',
  tricycles: 'tricycle',
  boreholes: 'borehole',
  classrooms: 'classroom',
  transformers: 'transformer',
  machines: 'machine',
  programmes: 'programme',
  programs: 'programme',
  projects: 'project',
  locations: 'location',
};

const STOP_WORDS = new Set([
  'of', 'the', 'in', 'for', 'and', 'to', 'at', 'on', 'by', 'with', 'from',
  'some', 'selected', 'various', 'different', 'location', 'areas', 'communities',
  'phase', 'lot', 'batch', 'stage', 'ongoing', 'new', 'i', 'ii', 'iii', 'iv',
  '1', '2', '3', '4', '5', '6', 'a', 'an',
]);

function normalizeVerbatim(text: string): string {
  return (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function buildDisguiseKey(text: string): string {
  if (!text) return '';
  const low = text.toLowerCase();
  const sectionTags: string[] = [];
  const secRx = /\bsection\s+([0-9ivx]+)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = secRx.exec(low)) !== null) {
    sectionTags.push(`sec_${m[1].toLowerCase()}`);
  }

  const cleaned = low.replace(/[^a-z0-9\s]/g, ' ');
  const tokens: string[] = [];
  for (const w of cleaned.split(/\s+/)) {
    if (!w) continue;
    const mapped = SYNONYMS[w] || w;
    if (STOP_WORDS.has(mapped) || mapped.length <= 2) continue;
    tokens.push(mapped);
  }
  const uniqueTokens = Array.from(new Set(tokens)).sort().slice(0, 14);
  if (uniqueTokens.length < 4) return '';
  return [...uniqueTokens, ...Array.from(new Set(sectionTags)).sort()].join(' ');
}

export function detectDuplicates(
  projects: RawProject[],
  maxProjects = Infinity
): DuplicateCluster[] {
  if (!projects || projects.length === 0) return [];

  const sample = Number.isFinite(maxProjects) ? projects.slice(0, maxProjects) : projects;
  const buckets = new Map<string, RawProject[]>();

  for (const p of sample) {
    const code = String(p.projectCode || '').trim();
    if (MDA_ROLLUP_RE.test(code) || COA_RECURRING_RE.test(code)) continue;

    const key = buildDisguiseKey(p.projectName);
    if (!key) continue;

    const list = buckets.get(key);
    if (list) {
      list.push(p);
    } else {
      buckets.set(key, [p]);
    }
  }

  const clusters: DuplicateCluster[] = [];
  let counter = 0;

  for (const [, items] of buckets.entries()) {
    if (items.length < 2) continue;
    counter++;
    const totalAmount = items.reduce((sum, item) => sum + (item.amount || 0), 0);
    const canonical = items.slice().sort((a, b) => a.projectName.length - b.projectName.length)[0];

    const agencies = new Set(items.map(i => (i.agency || '').trim()).filter(Boolean));
    const states = new Set(
      items
        .map(i => (i.state || '').trim())
        .filter(s => s && s !== 'HQ / Federal Direct' && s !== 'Nationwide')
    );
    const distinctWordings = new Set(items.map(i => normalizeVerbatim(i.projectName)));
    const distinctCodes = new Set(items.map(i => (i.projectCode || '').trim()).filter(Boolean));

    const isDisguised = distinctWordings.size > 1 && distinctCodes.size >= 1;
    const matchType: DuplicateCluster['matchType'] = isDisguised ? 'Disguised / Reworded' : 'Exact Wording';

    const patternType: DuplicateCluster['patternType'] = isDisguised
      ? 'Disguised Rewording'
      : agencies.size > 1
      ? 'Cross-MDA Duplicate'
      : states.size > 1
      ? 'Multi-Location Repeat'
      : 'Same-MDA Split';

    clusters.push({
      id: `DUP-${String(counter).padStart(5, '0')}`,
      canonicalTitle: canonical.projectName,
      sector: canonical.sector || 'General',
      financialYear: canonical.financialYear || 2026,
      count: items.length,
      totalAmount,
      distinctAgencies: Math.max(1, agencies.size),
      distinctStates: states.size,
      matchType,
      patternType,
      projects: items.map(p => ({
        id: p.id,
        projectCode: p.projectCode || '',
        projectName: p.projectName,
        amount: p.amount,
        page: p.page,
        agency: p.agency,
        state: p.state,
      })),
    });
  }

  return clusters.sort((a, b) => b.totalAmount - a.totalAmount || b.count - a.count);
}

export function getDuplicateStats(clusters: DuplicateCluster[]) {
  const totalProjects = clusters.reduce((s, c) => s + c.count, 0);
  const totalAmount = clusters.reduce((s, c) => s + c.totalAmount, 0);
  return { clusterCount: clusters.length, totalProjects, totalAmount };
}
