export interface PresidentialTerm {
  termId: string;
  presidentId: 'obasanjo' | 'yaradua' | 'jonathan' | 'buhari' | 'tinubu';
  presidentName: string;
  shortName: string;
  party: 'PDP' | 'APC';
  partyColor: string;
  accentColor: string;
  termLabel: string;
  tenureSpan: string;
  budgetYears: number[];
  portraitPath: string;
  initials: string;
  economicAgenda: string;
  handoverNote?: string;
}

export const PRESIDENTIAL_TERMS: PresidentialTerm[] = [
  {
    termId: 'OBJ-1',
    presidentId: 'obasanjo',
    presidentName: 'Olusegun Obasanjo',
    shortName: 'Obasanjo (1st Term)',
    party: 'PDP',
    partyColor: '#16a34a',
    accentColor: '#10b981',
    termLabel: '1st Term (1999–2003)',
    tenureSpan: 'May 29, 1999 – May 29, 2003',
    budgetYears: [1999, 2000, 2001, 2002],
    portraitPath: '/presidents/obasanjo.jpg',
    initials: 'OO',
    economicAgenda: 'Democratic Transition, Stabilization & Early Privatization',
    handoverNote: '1999 includes the Military-to-Civilian Supplementary Appropriation Act.',
  },
  {
    termId: 'OBJ-2',
    presidentId: 'obasanjo',
    presidentName: 'Olusegun Obasanjo',
    shortName: 'Obasanjo (2nd Term)',
    party: 'PDP',
    partyColor: '#16a34a',
    accentColor: '#059669',
    termLabel: '2nd Term (2003–2007)',
    tenureSpan: 'May 29, 2003 – May 29, 2007',
    budgetYears: [2003, 2004, 2005, 2006],
    portraitPath: '/presidents/obasanjo.jpg',
    initials: 'OO',
    economicAgenda: 'NEEDS Framework, Paris Club Debt Exit & Due Process Reforms',
  },
  {
    termId: 'YAR-1',
    presidentId: 'yaradua',
    presidentName: "Umaru Musa Yar'Adua",
    shortName: "Yar'Adua / Jonathan (2007–10)",
    party: 'PDP',
    partyColor: '#16a34a',
    accentColor: '#0284c7',
    termLabel: 'Term 2007–2011',
    tenureSpan: 'May 29, 2007 – May 5, 2010 (completed by G. Jonathan)',
    budgetYears: [2007, 2008, 2009, 2010],
    portraitPath: '/presidents/yaradua.jpg',
    initials: 'UY',
    economicAgenda: '7-Point Agenda, Niger Delta Amnesty & Power Sector Emergency',
    handoverNote: 'Dr. Goodluck Jonathan assumed executive responsibility in 2010 following Yar\'Adua\'s passing.',
  },
  {
    termId: 'GEJ-1',
    presidentId: 'jonathan',
    presidentName: 'Goodluck Ebele Jonathan',
    shortName: 'Jonathan (2011–2015)',
    party: 'PDP',
    partyColor: '#16a34a',
    accentColor: '#2563eb',
    termLabel: 'Full Term (2011–2015)',
    tenureSpan: 'May 29, 2011 – May 29, 2015',
    budgetYears: [2011, 2012, 2013, 2014],
    portraitPath: '/presidents/jonathan.jpg',
    initials: 'GJ',
    economicAgenda: 'Transformation Agenda, SURE-P & Agricultural Transformation',
    handoverNote: '2015 Appropriation Act was signed in May 2015 before transition to Buhari administration.',
  },
  {
    termId: 'PMB-1',
    presidentId: 'buhari',
    presidentName: 'Muhammadu Buhari',
    shortName: 'Buhari (1st Term)',
    party: 'APC',
    partyColor: '#0ea5e9',
    accentColor: '#8b5cf6',
    termLabel: '1st Term (2015–2019)',
    tenureSpan: 'May 29, 2015 – May 29, 2019',
    budgetYears: [2015, 2016, 2017, 2018],
    portraitPath: '/presidents/buhari.jpg',
    initials: 'MB',
    economicAgenda: 'TSA Implementation, ERGP Coding Standardization (2017) & Social Investment',
    handoverNote: 'Includes 2015 transition budget enacted in May 2015.',
  },
  {
    termId: 'PMB-2',
    presidentId: 'buhari',
    presidentName: 'Muhammadu Buhari',
    shortName: 'Buhari (2nd Term)',
    party: 'APC',
    partyColor: '#0ea5e9',
    accentColor: '#7c3aed',
    termLabel: '2nd Term (2019–2023)',
    tenureSpan: 'May 29, 2019 – May 29, 2023',
    budgetYears: [2019, 2020, 2021, 2022],
    portraitPath: '/presidents/buhari.jpg',
    initials: 'MB',
    economicAgenda: 'Jan–Dec Fiscal Cycle Restoration, COVID-19 Response & Rail Infrastructure',
  },
  {
    termId: 'BAT-1',
    presidentId: 'tinubu',
    presidentName: 'Bola Ahmed Tinubu',
    shortName: 'Tinubu (Current Term)',
    party: 'APC',
    partyColor: '#0ea5e9',
    accentColor: '#f59e0b',
    termLabel: 'Current Term (2023–2027)',
    tenureSpan: 'May 29, 2023 – Present',
    budgetYears: [2023, 2024, 2025, 2026],
    portraitPath: '/presidents/tinubu.jpg',
    initials: 'BT',
    economicAgenda: 'Renewed Hope Agenda, Fuel Subsidy Removal & FX Unification',
    handoverNote: '2023 Main Act was signed Jan 2023 (Buhari) & extended; 2023 Supplementary Act was enacted Nov 2023 (Tinubu).',
  },
];

export interface PresidentProfile {
  presidentId: PresidentialTerm['presidentId'];
  presidentName: string;
  party: 'PDP' | 'APC';
  partyColor: string;
  accentColor: string;
  portraitPath: string;
  initials: string;
  totalYearsInOfficeLabel: string;
  budgetYears: number[];
  termIds: string[];
}

export const PRESIDENTS_AGGREGATE: PresidentProfile[] = [
  {
    presidentId: 'obasanjo',
    presidentName: 'Olusegun Obasanjo',
    party: 'PDP',
    partyColor: '#16a34a',
    accentColor: '#10b981',
    portraitPath: '/presidents/obasanjo.jpg',
    initials: 'OO',
    totalYearsInOfficeLabel: '1999–2007 (2 Terms)',
    budgetYears: [1999, 2000, 2001, 2002, 2003, 2004, 2005, 2006],
    termIds: ['OBJ-1', 'OBJ-2'],
  },
  {
    presidentId: 'yaradua',
    presidentName: "Umaru Musa Yar'Adua",
    party: 'PDP',
    partyColor: '#16a34a',
    accentColor: '#0284c7',
    portraitPath: '/presidents/yaradua.jpg',
    initials: 'UY',
    totalYearsInOfficeLabel: '2007–2010 (1 Term)',
    budgetYears: [2007, 2008, 2009, 2010],
    termIds: ['YAR-1'],
  },
  {
    presidentId: 'jonathan',
    presidentName: 'Goodluck Ebele Jonathan',
    party: 'PDP',
    partyColor: '#16a34a',
    accentColor: '#2563eb',
    portraitPath: '/presidents/jonathan.jpg',
    initials: 'GJ',
    totalYearsInOfficeLabel: '2010–2015 (Term 2011–14)',
    budgetYears: [2011, 2012, 2013, 2014],
    termIds: ['GEJ-1'],
  },
  {
    presidentId: 'buhari',
    presidentName: 'Muhammadu Buhari',
    party: 'APC',
    partyColor: '#0ea5e9',
    accentColor: '#8b5cf6',
    portraitPath: '/presidents/buhari.jpg',
    initials: 'MB',
    totalYearsInOfficeLabel: '2015–2023 (2 Terms)',
    budgetYears: [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022],
    termIds: ['PMB-1', 'PMB-2'],
  },
  {
    presidentId: 'tinubu',
    presidentName: 'Bola Ahmed Tinubu',
    party: 'APC',
    partyColor: '#0ea5e9',
    accentColor: '#f59e0b',
    portraitPath: '/presidents/tinubu.jpg',
    initials: 'BT',
    totalYearsInOfficeLabel: '2023–Present (Term 1)',
    budgetYears: [2023, 2024, 2025, 2026],
    termIds: ['BAT-1'],
  },
];

export function getTermForYear(year: number): PresidentialTerm {
  const found = PRESIDENTIAL_TERMS.find((t) => t.budgetYears.includes(year));
  if (found) return found;
  if (year < 1999) return PRESIDENTIAL_TERMS[0];
  return PRESIDENTIAL_TERMS[PRESIDENTIAL_TERMS.length - 1];
}

export function getPresidentForYear(year: number): PresidentialTerm {
  return getTermForYear(year);
}
