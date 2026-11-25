export interface FoiDeskEntry {
  mdaKeywords: string[];
  ministryTitle: string;
  foiOfficerRole: string;
  addressLines: string[];
  oversightCommittees: string[];
}

export const FOI_ACT_2011_CLAUSES = [
  {
    section: 'Section 1(1)',
    title: 'Right of Access to Public Records',
    summary:
      'Establishes the enforceable right of any person to access or request information in the custody or possession of any public official, agency, or institution.',
  },
  {
    section: 'Section 4(a)',
    title: '7-Working-Day Statutory Response Window',
    summary:
      'Mandates the public institution to make the requested record available or issue a written notice of denial within 7 days of receiving the application.',
  },
  {
    section: 'Section 5(1)',
    title: 'Transfer of Application Within 3 Days',
    summary:
      'If another public institution has a greater interest in the record, the receiving MDA must transfer the request within 3 working days and notify the applicant.',
  },
  {
    section: 'Section 7(5)',
    title: 'Wrongful Denial Penalty (₦500,000 Fine)',
    summary:
      'Where a case of wrongful denial of access is established, the defaulting officer or institution commits an offence and is liable on conviction to a fine of ₦500,000.',
  },
  {
    section: 'Section 20',
    title: 'Judicial Review (30-Day Federal High Court Filing)',
    summary:
      'Any applicant denied access may apply to the Court for a review of the matter within 30 days after the public institution denies or is deemed to have denied the application.',
  },
] as const;

export const FEDERAL_MDA_FOI_DIRECTORY: FoiDeskEntry[] = [
  {
    mdaKeywords: ['works', 'highway', 'ferma', 'housing', 'urban'],
    ministryTitle: 'Federal Ministry of Works & Housing',
    foiOfficerRole: 'The Permanent Secretary / Head of FOI Desk Unit',
    addressLines: ['Federal Ministry of Works Headquarters', 'Mabushi, Abuja, FCT'],
    oversightCommittees: ['Senate Committee on Works', 'House Committee on Works', 'Public Accounts Committee (PAC)'],
  },
  {
    mdaKeywords: ['health', 'hospital', 'medical', 'nhis', 'nphcda', 'nafdac'],
    ministryTitle: 'Federal Ministry of Health & Social Welfare',
    foiOfficerRole: 'The Permanent Secretary / FOI Desk Officer',
    addressLines: ['New Federal Secretariat Complex, Phase III', 'Central Business District, Abuja, FCT'],
    oversightCommittees: ['Senate Committee on Health (Secondary & Tertiary)', 'House Committee on Healthcare Services'],
  },
  {
    mdaKeywords: ['education', 'university', 'polytechnic', 'college', 'ubec', 'tetfund'],
    ministryTitle: 'Federal Ministry of Education',
    foiOfficerRole: 'The Permanent Secretary / FOI Compliance Desk',
    addressLines: ['Federal Secretariat Complex, Phase III', 'Shehu Shagari Way, Abuja, FCT'],
    oversightCommittees: ['Senate Committee on Tertiary Institutions & TETFUND', 'House Committee on Basic Education & Services'],
  },
  {
    mdaKeywords: ['water', 'borehole', 'river basin', 'dam', 'irrigation'],
    ministryTitle: 'Federal Ministry of Water Resources & Sanitation',
    foiOfficerRole: 'The Permanent Secretary / FOI Desk Officer',
    addressLines: ['Area 1, Garki', 'Abuja, FCT'],
    oversightCommittees: ['Senate Committee on Water Resources', 'House Committee on Water Resources'],
  },
  {
    mdaKeywords: ['power', 'transmission', 'rural electrification', 'energy', 'solar'],
    ministryTitle: 'Federal Ministry of Power',
    foiOfficerRole: 'The Permanent Secretary / FOI Desk Officer',
    addressLines: ['Power House, Plot 14 Zambezi Crescent', 'Maitama, Abuja, FCT'],
    oversightCommittees: ['Senate Committee on Power', 'House Committee on Power'],
  },
  {
    mdaKeywords: ['agric', 'food', 'rural development', 'fisheries', 'livestock'],
    ministryTitle: 'Federal Ministry of Agriculture & Food Security',
    foiOfficerRole: 'The Permanent Secretary / FOI Desk Officer',
    addressLines: ['FCDA Secretariat, Area 11, Garki', 'Abuja, FCT'],
    oversightCommittees: ['Senate Committee on Agriculture Production Services', 'House Committee on Agricultural Colleges & Institutions'],
  },
  {
    mdaKeywords: ['interior', 'police', 'defence', 'defense', 'security', 'correctional', 'immigration'],
    ministryTitle: 'Federal Ministry of Interior / Defence Oversight Desk',
    foiOfficerRole: 'The Permanent Secretary / FOI Desk Officer',
    addressLines: ['Block F, Old Federal Secretariat, Area 1, Garki', 'Abuja, FCT'],
    oversightCommittees: ['Senate Committee on Interior', 'House Committee on National Security & Intelligence', 'Public Accounts Committee (PAC)'],
  },
  {
    mdaKeywords: ['finance', 'budget', 'economic planning', 'customs', 'firs', 'service wide'],
    ministryTitle: 'Federal Ministry of Finance, Budget & Economic Planning',
    foiOfficerRole: 'The Permanent Secretary / FOI Desk Officer',
    addressLines: ['Ahmadu Bello Way, Central Business District', 'Abuja, FCT'],
    oversightCommittees: ['Senate Committee on Appropriations', 'House Committee on Appropriations', 'Public Accounts Committee (PAC)'],
  },
];

export const DEFAULT_NASS_OVERSIGHT_COMMITTEES = [
  'Chairman, Senate Committee on Appropriations',
  'Chairman, House of Representatives Committee on Appropriations',
  'Chairman, Senate & House Public Accounts Committees (PAC)',
];

export function resolveFoiDeskForMda(mdaName: string): FoiDeskEntry {
  const lower = (mdaName || '').toLowerCase();
  const matched = FEDERAL_MDA_FOI_DIRECTORY.find((entry) =>
    entry.mdaKeywords.some((kw) => lower.includes(kw))
  );
  if (matched) return matched;
  return {
    mdaKeywords: [],
    ministryTitle: mdaName || 'Federal Ministry / Executing MDA',
    foiOfficerRole: 'The Permanent Secretary / Freedom of Information (FOI) Desk Officer',
    addressLines: ['Federal Secretariat Complex', 'Central Business District, Abuja, FCT'],
    oversightCommittees: DEFAULT_NASS_OVERSIGHT_COMMITTEES,
  };
}

/**
 * Calculates the 7-working-day statutory deadline under FOI Act 2011 §4(a),
 * skipping Saturdays and Sundays cleanly.
 */
export function calculateFoiStatutoryDeadline(
  submittedDate: Date = new Date(),
  workingDays = 7
): { submittedIso: string; deadlineIso: string; deadlineFormatted: string } {
  const start = new Date(Date.UTC(submittedDate.getUTCFullYear(), submittedDate.getUTCMonth(), submittedDate.getUTCDate()));
  const cursor = new Date(start.getTime());
  let remaining = Math.max(1, workingDays);
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }
  const submittedIso = start.toISOString().slice(0, 10);
  const deadlineIso = cursor.toISOString().slice(0, 10);
  const deadlineFormatted = cursor.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return { submittedIso, deadlineIso, deadlineFormatted };
}
