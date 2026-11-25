// ─── BudgetLens Relatable Equivalents (Diverse Mix & Match Engine) ───────────
// Converts raw ₦ amounts into human-scale civic amenities citizens understand.
// Uses dynamic baseline selection to prevent repetitive metrics and maximize engagement.

export interface Equivalent {
  label: string;       // "primary school classrooms"
  count: number;       // 187
  unit: string;        // "classroom blocks"
  baseline: number;    // 15_000_000
  source: string;      // "UBEC 2024 avg"
  emoji: string;       // "🏫"
}

interface Baseline {
  id: string;
  label: string;
  unit: string;
  amount: number;      // in ₦
  source: string;
  emoji: string;
  sectors: string[];   // sectors where this baseline is relevant
  minAmount: number;   // only show if project amount >= this
}

// ─── Comprehensive Baseline Table (v2.0) ──────────────────────────────────────
const BASELINES: Baseline[] = [
  {
    id: 'CLASSROOM',
    label: '3-classroom primary school block',
    unit: 'classroom blocks',
    amount: 15_000_000,
    source: 'UBEC 2024 avg',
    emoji: '🏫',
    sectors: ['Education', 'Infrastructure', 'Humanitarian & Social'],
    minAmount: 15_000_000,
  },
  {
    id: 'PHC',
    label: 'functional primary health centre',
    unit: 'primary health centres',
    amount: 25_000_000,
    source: 'FMOH 2024 avg',
    emoji: '🏥',
    sectors: ['Health', 'Infrastructure', 'Humanitarian & Social'],
    minAmount: 25_000_000,
  },
  {
    id: 'AMBULANCE',
    label: 'standard government ambulance',
    unit: 'fully equipped ambulances',
    amount: 18_000_000,
    source: 'FMOH 2024 avg',
    emoji: '🚑',
    sectors: ['Health', 'Security', 'Infrastructure'],
    minAmount: 18_000_000,
  },
  {
    id: 'TEACHER_SALARY',
    label: 'federal teacher annual salary',
    unit: 'teachers paid for 1 year',
    amount: 2_400_000,
    source: 'NUT/FME 2024',
    emoji: '👨‍🏫',
    sectors: ['Education', 'Administrative', 'Humanitarian & Social'],
    minAmount: 5_000_000,
  },
  {
    id: 'SCHOOL_MEAL',
    label: 'school meal (1 child for 1 full school year)',
    unit: 'children fed for 1 year',
    amount: 72_000,
    source: 'NHGSFP 2024 avg',
    emoji: '🍽️',
    sectors: ['Education', 'Humanitarian & Social', 'Agriculture & Food'],
    minAmount: 1_000_000,
  },
  {
    id: 'COMPUTER_LAB',
    label: '30-computer ICT school lab',
    unit: 'school computer labs',
    amount: 8_500_000,
    source: 'NITDA 2024 avg',
    emoji: '💻',
    sectors: ['Education', 'Administration & Services'],
    minAmount: 8_500_000,
  },
  {
    id: 'BOREHOLE',
    label: 'functional rural solar borehole',
    unit: 'community solar boreholes',
    amount: 3_500_000,
    source: 'RUWASA 2024 avg',
    emoji: '💧',
    sectors: ['Infrastructure', 'Humanitarian & Social', 'Agriculture & Food'],
    minAmount: 5_000_000,
  },
  {
    id: 'MINI_GRID',
    label: 'rural solar mini-grid (100 homes)',
    unit: 'solar mini-grids (100 homes)',
    amount: 45_000_000,
    source: 'REA 2024 avg',
    emoji: '⚡',
    sectors: ['Infrastructure', 'Administration & Services'],
    minAmount: 45_000_000,
  },
  {
    id: 'SOLAR_LIGHT',
    label: 'all-in-one solar street light',
    unit: 'solar street lights',
    amount: 350_000,
    source: 'REA 2024 avg',
    emoji: '💡',
    sectors: ['Infrastructure', 'Security'],
    minAmount: 1_000_000,
  },
  {
    id: 'RURAL_ROAD_KM',
    label: 'km of paved rural road',
    unit: 'km of paved rural road',
    amount: 180_000_000,
    source: 'FERMA 2024 avg',
    emoji: '🛣️',
    sectors: ['Infrastructure', 'Aviation & Transport'],
    minAmount: 180_000_000,
  },
  {
    id: 'MARKET_STALL',
    label: 'community market stall',
    unit: 'lock-up market stalls',
    amount: 800_000,
    source: 'LASG 2024 avg',
    emoji: '🏪',
    sectors: ['Agriculture & Food', 'Administration & Services'],
    minAmount: 5_000_000,
  },
  {
    id: 'RICE_MILL',
    label: 'community rice processing mill',
    unit: 'rice processing mills',
    amount: 12_000_000,
    source: 'FMARD 2024 avg',
    emoji: '🌾',
    sectors: ['Agriculture & Food', 'Infrastructure'],
    minAmount: 12_000_000,
  },
  {
    id: 'POLICE_VAN',
    label: 'patrol vehicle for security',
    unit: 'security patrol vans',
    amount: 22_000_000,
    source: 'NPF 2024 procurement',
    emoji: '🚔',
    sectors: ['Security', 'Administration & Services'],
    minAmount: 22_000_000,
  },
  {
    id: 'OXYGEN_PLANT',
    label: 'hospital medical oxygen plant',
    unit: 'medical oxygen plants',
    amount: 60_000_000,
    source: 'NPHCDA 2024 avg',
    emoji: '🩺',
    sectors: ['Health', 'Infrastructure'],
    minAmount: 60_000_000,
  },
];

// Simple deterministic hash to rotate baselines per project
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// ─── Main Function ────────────────────────────────────────────────────────────
export function getEquivalents(amount: number, sector: string, maxItems = 2, seed = ''): Equivalent[] {
  // Filter eligible baselines
  const eligible = BASELINES.filter(b => amount >= b.minAmount);
  if (eligible.length === 0) return [];

  // Deterministic shuffle seed based on project title/id/sector hash to ensure variety
  const seedNum = hashString(seed || sector || `${amount}`);

  // Sort eligible baselines: prefer sector matches, then hash rotation
  const sorted = [...eligible].sort((a, b) => {
    const aMatch = a.sectors.includes(sector) ? -2 : 0;
    const bMatch = b.sectors.includes(sector) ? -2 : 0;
    const aHash = (hashString(a.id) + seedNum) % 100;
    const bHash = (hashString(b.id) + seedNum) % 100;
    return (aMatch + aHash) - (bMatch + bHash);
  });

  return sorted.slice(0, maxItems).map(b => ({
    label: b.label,
    count: Math.floor(amount / b.amount),
    unit: b.unit,
    baseline: b.amount,
    source: b.source,
    emoji: b.emoji,
  }));
}

export function formatEquivalentText(eq: Equivalent): string {
  const countStr = eq.count >= 1000
    ? `${(eq.count / 1000).toFixed(1)}k`
    : eq.count.toLocaleString();
  return `≈ ${countStr} ${eq.unit}`;
}
