/**
 * Central Bank of Nigeria (CBN) Governors Historical & Fourth Republic Ledger (1958–2026).
 *
 * Dates and substantive tenures mirror official CBN Past Governors API (`/api/GetPastGovernors`)
 * and current Governor records. Management highlights, documented criticisms, and EFCC / anti-graft
 * records attribute findings neutrally to official CBN Annual Reports, NDIC Liquidation Records,
 * DMO Public Debt Bulletins, IMF Article IV consultations, EFCC court filings & press briefings,
 * Federal High Court rulings, and the 2023 Jim Obazee Special Investigation.
 */

export type EfccInvestigationStatus =
  | 'CHARGED_TRIAL_ONGOING'
  | 'INVESTIGATED_CLEARED'
  | 'SCRUTINIZED_NO_EFCC_CHARGE'
  | 'NO_EFCC_INVESTIGATION';

export interface CbnEfccRecord {
  status: EfccInvestigationStatus;
  badgeLabel: string;
  period?: string;
  legalStatusNote: string;
  accusationScope: string[];
  sources: string[];
}

export interface CbnGovernorProfile {
  id: string;
  order: number;
  name: string;
  honorificTitle: string;
  initials: string;
  portraitPath: string;
  photoSource: string;
  era: 'FOUNDING_MILITARY' | 'FOURTH_REPUBLIC';
  accentColor: string;
  tenureLabel: string;
  startYear: number;
  endYear: number | null;
  servedUnder: string[];
  presidentIds: Array<'obasanjo' | 'yaradua' | 'jonathan' | 'buhari' | 'tinubu'>;
  headlineMandate: string;
  macroIndicators: {
    fxStartToEnd: string;
    inflationRange: string;
    policyRateHighlight: string;
    reservesHighlight: string;
    waysAndMeansNote: string;
  };
  economicManagement: string[];
  documentedCriticisms: string[];
  efccRecord: CbnEfccRecord;
  sources: string[];
}

export interface CbnActingGovernorNote {
  id: string;
  name: string;
  tenureLabel: string;
  context: string;
  keyAction: string;
  efccOrScrutinyNote?: string;
}

export const CBN_ACTING_GOVERNORS: CbnActingGovernorNote[] = [
  {
    id: 'sarah-alade',
    name: 'Dr. Sarah Omotunde Alade (OFR)',
    tenureLabel: 'Feb 20, 2014 – Jun 3, 2014',
    context: 'First female Acting CBN Governor; stepped in following the suspension of Mallam Sanusi Lamido Sanusi.',
    keyAction: 'Maintained MPC tightening (12.0% MPR) and foreign-exchange window stability ahead of the June 2014 substantive handover.',
  },
  {
    id: 'folashodun-shonubi',
    name: 'Mr. Folashodun Adebisi Shonubi',
    tenureLabel: 'Jun 9, 2023 – Sep 26, 2023',
    context: 'Deputy Governor (Operations) appointed Acting Governor upon the suspension of Godwin Emefiele.',
    keyAction: 'Executed the landmark June 14, 2023 FX window unification ("I&E" float), eliminating the legacy multi-rate spread from ~₦461/$ toward market clearing (~₦770/$).',
    efccOrScrutinyNote: 'Subjected to administrative/security scrutiny and lifestyle review alongside other post-Emefiele CBN executives during the 2023 Special Investigation; exited upon Cardoso’s confirmation in Sep 2023 with no EFCC criminal conviction.',
  },
];

export const CBN_GOVERNORS: CbnGovernorProfile[] = [
  {
    id: 'fenton',
    order: 1,
    name: 'Mr. Roy Pentelow Fenton',
    honorificTitle: 'Founding CBN Governor',
    initials: 'RF',
    portraitPath: '/governors/fenton.jpg',
    photoSource: 'Central Bank of Nigeria Archive',
    era: 'FOUNDING_MILITARY',
    accentColor: '#475569',
    tenureLabel: 'Jul 24, 1958 – Jul 24, 1963',
    startYear: 1958,
    endYear: 1963,
    servedUnder: ['Sir Abubakar Tafawa Balewa (First Republic)'],
    presidentIds: [],
    headlineMandate: 'Operational launch of CBN (July 1959), Nigerian Pound currency issuance & money market founding.',
    macroIndicators: {
      fxStartToEnd: '£N1 = £1 Sterling parity',
      inflationRange: 'Low single-digit (~2%–5% post-independence)',
      policyRateHighlight: 'Pre-MRR fixed discount window (4%–5%)',
      reservesHighlight: 'Sterling backing reserves (~£100M+)',
      waysAndMeansNote: 'Conservative fiduciary statutory limits under 1958 Ordinance',
    },
    economicManagement: [
      'Operationalized the Central Bank of Nigeria under the 1958 CBN Act on July 1, 1959, replacing the colonial West African Currency Board.',
      'Issued Nigeria’s first national banknotes and coins (the Nigerian Pound) cleanly without monetary disruption.',
      'Launched Federal Government Treasury Bills (1960), Call Money Fund (1962), and institutional support for the Lagos Stock Exchange (1960/1961).',
    ],
    documentedCriticisms: [
      'Conservative Sterling-exchange-standard parity rules prioritized external convertibility over aggressive domestic industrial credit creation.',
      'Banking supervision framework under the 1958 Ordinance lacked rapid failure-resolution tools for thinly capitalized indigenous banks.',
      'Key reserve assets remained concentrated in London Sterling balances rather than diversified sovereign instruments.',
    ],
    efccRecord: {
      status: 'NO_EFCC_INVESTIGATION',
      badgeLabel: 'Pre-EFCC Era (No EFCC Investigation)',
      legalStatusNote: 'Served 40 years before the EFCC was established in 2003; no EFCC investigation recorded.',
      accusationScope: [],
      sources: ['Central Bank of Nigeria Archive'],
    },
    sources: ['Central Bank of Nigeria History Archive', 'CBN Act 1958 & Annual Reports (1959–1963)'],
  },
  {
    id: 'maibornu',
    order: 2,
    name: 'Alhaji Aliyu Mai-Bornu',
    honorificTitle: 'First Indigenous CBN Governor',
    initials: 'AM',
    portraitPath: '/governors/maibornu.jpg',
    photoSource: 'Central Bank of Nigeria Archive',
    era: 'FOUNDING_MILITARY',
    accentColor: '#0f766e',
    tenureLabel: 'Jul 25, 1963 – Jun 22, 1967',
    startYear: 1963,
    endYear: 1967,
    servedUnder: ['Sir Abubakar Tafawa Balewa', 'Maj. Gen. Aguiyi-Ironsi', 'Gen. Yakubu Gowon'],
    presidentIds: [],
    headlineMandate: 'Indigenization of monetary leadership, reserve diversification & agricultural produce financing.',
    macroIndicators: {
      fxStartToEnd: '£N1 = US$2.80 (Bretton Woods peg)',
      inflationRange: '~3%–10% (pre-Civil War supply tightening)',
      policyRateHighlight: 'Minimum Rediscount Rate (~4.0%–5.0%)',
      reservesHighlight: 'Conserved via 1962 Exchange Control Act',
      waysAndMeansNote: 'Rising pre-war federal Treasury Bill accommodation (1966–67)',
    },
    economicManagement: [
      'Became the first Nigerian Governor of the CBN, building domestic monetary research, statistics, and examination departments.',
      'Diversified external reserves away from pure Pound Sterling into US Dollars and gold after the 1962 Exchange Control Act.',
      'Designed commercial bill refinancing lines that kept cocoa, groundnut, and palm produce marketing boards liquid.',
    ],
    documentedCriticisms: [
      'Escalating political instability (1966) eroded fiscal discipline, pressing the CBN into higher Treasury Bill monetization before formal deficit rules tightened.',
      'Early reliance on administrative import-control quotas began fostering secondary FX rationing friction.',
      'Credit allocation remained heavily skewed toward foreign-owned trading houses over indigenous manufacturers.',
    ],
    efccRecord: {
      status: 'NO_EFCC_INVESTIGATION',
      badgeLabel: 'Pre-EFCC Era (No EFCC Investigation)',
      legalStatusNote: 'Served prior to the EFCC’s establishment (2003); no EFCC investigation recorded.',
      accusationScope: [],
      sources: ['Central Bank of Nigeria Archive'],
    },
    sources: ['Central Bank of Nigeria Archive', 'CBN Monetary Policy Review Series'],
  },
  {
    id: 'isong',
    order: 3,
    name: 'Dr. Clement Nyong Isong',
    honorificTitle: 'Wartime & Naira Decimalization Governor',
    initials: 'CI',
    portraitPath: '/governors/isong.jpg',
    photoSource: 'Central Bank of Nigeria Archive',
    era: 'FOUNDING_MILITARY',
    accentColor: '#047857',
    tenureLabel: 'Aug 15, 1967 – Sep 22, 1975',
    startYear: 1967,
    endYear: 1975,
    servedUnder: ['Gen. Yakubu Gowon', 'Gen. Murtala Mohammed'],
    presidentIds: [],
    headlineMandate: 'Civil War non-default macro survival, 1973 Naira decimalization & early oil-boom reserve buildup.',
    macroIndicators: {
      fxStartToEnd: '₦0.658/$ -> ₦0.616/$ (Strong fixed peg)',
      inflationRange: '~10% wartime -> 33.9% post-Udoji 1975 spike',
      policyRateHighlight: 'Direct credit ceilings & sectoral quotas (4.5%–5.0% MRR)',
      reservesHighlight: 'Swelled from war lows (<$150M) to >$5.5B (1975)',
      waysAndMeansNote: 'Wartime fiduciary debt absorbed domestically without IMF external default',
    },
    economicManagement: [
      'Maintained domestic payments continuity and avoided sovereign external default throughout the 1967–1970 Nigerian Civil War via currency swap (1968) and domestic debt mobilization.',
      'Successfully introduced the decimalized Nigerian Naira (₦) and kobo on January 1, 1973.',
      'Midwifed development finance institutions including the Nigerian Agricultural Bank (1973) and Nigerian Bank for Commerce and Industry (1973).',
    ],
    documentedCriticisms: [
      'Aggressive monetization of 1973–1975 petrodollar windfalls and the 1974–75 Udoji public salary awards fueled headline inflation surging past 30%.',
      'Overvalued fixed Naira exchange peg encouraged import dependency ("Dutch Disease") and undercut traditional non-oil agricultural exports.',
      'Rigid interest-rate caps produced negative real deposit rates, discouraging private domestic savings.',
    ],
    efccRecord: {
      status: 'NO_EFCC_INVESTIGATION',
      badgeLabel: 'Pre-EFCC Era (No EFCC Investigation)',
      legalStatusNote: 'Served prior to the EFCC’s establishment (2003); no EFCC investigation recorded.',
      accusationScope: [],
      sources: ['Central Bank of Nigeria Archive'],
    },
    sources: ['Central Bank of Nigeria Archive', 'Nigeria Historical Macroeconomic Statistics (CBN Statistical Bulletin)'],
  },
  {
    id: 'ciroma',
    order: 4,
    name: 'Mallam Adamu Ciroma',
    honorificTitle: 'Former CBN Governor & Finance Minister',
    initials: 'AC',
    portraitPath: '/governors/ciroma.jpg',
    photoSource: 'Central Bank of Nigeria Archive',
    era: 'FOUNDING_MILITARY',
    accentColor: '#0284c7',
    tenureLabel: 'Sep 24, 1975 – Jun 28, 1977',
    startYear: 1975,
    endYear: 1977,
    servedUnder: ['Gen. Murtala Mohammed', 'Gen. Olusegun Obasanjo (Military)'],
    presidentIds: [],
    headlineMandate: 'Okigbo Financial System Reform Committee rollout & anti-inflation reserve custody during oil boom.',
    macroIndicators: {
      fxStartToEnd: '₦0.62/$ -> ₦0.64/$ (Managed basket)',
      inflationRange: '~22%–24% (post-1975 port & wage pressures)',
      policyRateHighlight: 'Selective credit guidelines & liquidity ratios (~3.5%–4.0% MRR)',
      reservesHighlight: 'Stabilized above ~$4.2B–$5.0B',
      waysAndMeansNote: 'Contained federal domestic arrears during 1976 Okigbo Committee review',
    },
    economicManagement: [
      'Shortest substantive CBN tenure (21 months); implemented the 1976 Pius Okigbo Financial System Review Committee reforms.',
      'Enforced mandatory commercial bank rural branch targets and preferred-sector credit allocation guidelines (agriculture & indigenous manufacturing).',
      'Strengthened import letter-of-credit verification rules following the 1975–76 port congestion ("cement armada") settlement crisis.',
    ],
    documentedCriticisms: [
      'Persistently high oil-boom fiscal deficits kept annual inflation stuck above 20% throughout 1976–1977.',
      'Heavy reliance on direct administrative credit ceilings and fixed low interest rates suppressed bond market price discovery.',
      'Import-substitution credit quotas suffered leakage into trading and speculative imports.',
    ],
    efccRecord: {
      status: 'NO_EFCC_INVESTIGATION',
      badgeLabel: 'Pre-EFCC Era (No EFCC Investigation)',
      legalStatusNote: 'Served prior to the EFCC’s establishment (2003); no EFCC investigation recorded.',
      accusationScope: [],
      sources: ['Central Bank of Nigeria Archive'],
    },
    sources: ['Central Bank of Nigeria Archive', '1976 Financial System Review Committee Report'],
  },
  {
    id: 'vincent',
    order: 5,
    name: 'Mr. Olatunde Olabode Vincent',
    honorificTitle: 'Institutional Architect & Indigenisation Governor',
    initials: 'OV',
    portraitPath: '/governors/vincent.jpg',
    photoSource: 'Central Bank of Nigeria Archive',
    era: 'FOUNDING_MILITARY',
    accentColor: '#2563eb',
    tenureLabel: 'Jun 28, 1977 – Jun 28, 1982',
    startYear: 1977,
    endYear: 1982,
    servedUnder: ['Gen. Olusegun Obasanjo (Military)', 'President Shehu Shagari'],
    presidentIds: [],
    headlineMandate: 'Rural banking expansion (ACGSF) & 1979–82 import-boom balance-of-payments strain.',
    macroIndicators: {
      fxStartToEnd: '₦0.65/$ -> ₦0.67/$ (Overvalued official peg)',
      inflationRange: '~10%–21% (rising pre-austerity)',
      policyRateHighlight: 'MRR raised toward 6.0%–7.0% during 1982 austerity',
      reservesHighlight: 'Peaked ~$10B (1980) -> crashed below ~$1.6B (1982)',
      waysAndMeansNote: 'Rising short-term trade arrears & domestic borrowing after 1981 oil glut',
    },
    economicManagement: [
      'Executed Rural Banking Programme Phases I & II (hundreds of bank branches opened across underserved local governments) and launched ACGSF agricultural guarantees (1978).',
      'Supervised the 1977 Nigerian Enterprises Promotion Decree transfer of 60% foreign bank equity into Nigerian public and private ownership.',
      'Pioneered institutional studies that later birthed the Nigeria Deposit Insurance Corporation (NDIC) and comprehensive pre-shipment import inspection.',
    ],
    documentedCriticisms: [
      'Defense of an artificially appreciated official Naira peg (₦0.67/$) during the 1981–1982 oil price collapse depleted external reserves from ~$10B to under 2 months of import cover.',
      'Delayed FX adjustment generated multi-billion-dollar unverified import trade arrears ("Paris/London Club uninsured bills"), culminating in the April 1982 Economic Stabilization crisis.',
      'Credit expansion to state agencies amplified Second Republic fiscal vulnerabilities.',
    ],
    efccRecord: {
      status: 'NO_EFCC_INVESTIGATION',
      badgeLabel: 'Pre-EFCC Era (No EFCC Investigation)',
      legalStatusNote: 'Served prior to the EFCC’s establishment (2003); no EFCC investigation recorded.',
      accusationScope: [],
      sources: ['Central Bank of Nigeria Archive'],
    },
    sources: ['Central Bank of Nigeria Archive', 'NDIC Institutional History & Shagari-Era Economic Stabilization Records'],
  },
  {
    id: 'ahmed',
    order: 6,
    name: 'Alhaji Abdulkadir Ahmed',
    honorificTitle: 'Longest-Serving CBN Governor (SAP Era)',
    initials: 'AA',
    portraitPath: '/governors/ahmed.jpg',
    photoSource: 'Central Bank of Nigeria Archive',
    era: 'FOUNDING_MILITARY',
    accentColor: '#7c3aed',
    tenureLabel: 'Jun 28, 1982 – Sep 30, 1993',
    startYear: 1982,
    endYear: 1993,
    servedUnder: ['Shehu Shagari', 'Maj. Gen. Muhammadu Buhari', 'Gen. Ibrahim Babangida'],
    presidentIds: [],
    headlineMandate: 'Longest tenure (11.2 yrs): 1984 currency swap, 1986 SAP FX deregulation, NDIC & 1991 BOFID banking laws.',
    macroIndicators: {
      fxStartToEnd: '₦0.67/$ (1982) -> ₦22.00/$ (1993 official)',
      inflationRange: '~5.5% (1985) -> 57.2% (1993 peak)',
      policyRateHighlight: 'MRR liberalized 1987; surged past 18.5%–26% by 1993',
      reservesHighlight: 'Volatile ~$1B–$4B amid Paris/London Club debt rescheduling',
      waysAndMeansNote: '1994 Okigbo Panel documented large extra-budgetary Central Bank dedicated accounts',
    },
    economicManagement: [
      'Executed the April 1984 national currency color-change exercise and guided Paris/London Club trade-debt verification exercises.',
      'Established the Nigeria Deposit Insurance Corporation (NDIC, 1988) and modern statutory frameworks (CBN Decree 24 & BOFI Decree 25 of 1991) plus Open Market Operations (1993).',
      'Deregulated import licensing and introduced market-based FX auctions (SFEM/FEM/IFEM, 1986) under the Structural Adjustment Programme.',
    ],
    documentedCriticisms: [
      'Rapid deregulation lowered entry barriers without proportional supervision, triggering a speculative boom from ~40 to 120+ banks primarily focused on FX round-tripping — seeding the catastrophic 1990s banking distress.',
      'The 1994 Okigbo Panel Investigation heavily faulted the CBN and military presidency over $12.4 billion in Gulf War oil windfalls routed through opaque "Dedicated Accounts" outside normal budgetary oversight.',
      'Persistent fiscal deficit monetization fueled runaway inflation exceeding 57% by 1993 and wiped out middle-class Naira purchasing power.',
    ],
    efccRecord: {
      status: 'NO_EFCC_INVESTIGATION',
      badgeLabel: 'Pre-EFCC Era (No EFCC Investigation)',
      legalStatusNote: 'Served before the EFCC was established in 2003; his tenure was examined by the 1994 Okigbo Panel (a federal inquiry into $12.4B Gulf War oil windfall dedicated accounts), not the EFCC.',
      accusationScope: [],
      sources: ['Central Bank of Nigeria Archive', '1994 Okigbo Panel Report Summary'],
    },
    sources: ['Central Bank of Nigeria Archive', '1994 Pius Okigbo Panel Report on CBN Reorganization', 'NDIC Annual Reports'],
  },
  {
    id: 'ogwuma',
    order: 7,
    name: 'Dr. Paul Agbai Ogwuma',
    honorificTitle: '1990s Bank Distress Resolution Governor',
    initials: 'PO',
    portraitPath: '/governors/ogwuma.jpg',
    photoSource: 'Central Bank of Nigeria Archive',
    era: 'FOUNDING_MILITARY',
    accentColor: '#dc2626',
    tenureLabel: 'Oct 1, 1993 – May 29, 1999',
    startYear: 1993,
    endYear: 1999,
    servedUnder: ['Gen. Sani Abacha', 'Gen. Abdulsalami Abubakar'],
    presidentIds: [],
    headlineMandate: '1998 mass liquidation of 26 distressed banks, Failed Banks Tribunal enforcement & dual-FX transition.',
    macroIndicators: {
      fxStartToEnd: '₦21.89/$ pegged vs ~₦80–₦86/$ AFEM market -> ₦92/$ (1999)',
      inflationRange: '72.8% (1995 peak) -> cooled to ~6.6%–10% (1998–99)',
      policyRateHighlight: 'MRR stabilized ~13.5%–14.5%',
      reservesHighlight: 'Dropped to ~$3.7B–$4.9B by May 1999 handover',
      waysAndMeansNote: 'Military regime dual-rate subsidy (~₦22/$ official allocations)',
    },
    economicManagement: [
      'Enforced systemic clean-up alongside NDIC and the Failed Banks Tribunal, revoking licenses of 26 terminally insolvent banks in January 1998 (raising minimum bank capital to ₦500M).',
      'Brought hyper-inflation down from 72.8% (1995) back under 10% by 1998–1999 through tighter reserve requirements and monetary contraction.',
      'Oversaw final abolition of the Abacha dual exchange rate in early 1999 under Abdulsalami Abubakar prior to civilian handover.',
    ],
    documentedCriticisms: [
      'Maintained an opaque dual FX regime (₦21.89/$ privileged official rate vs ~₦85/$ AFEM market rate) through 1994–1998 that created massive arbitrage rents for connected elites.',
      'Delayed resolution of distressed banks between 1994 and 1997 allowed insider non-performing loans to compound before the 1998 liquidations.',
      'Foreign reserves fell sharply during the 1998–1999 pre-transition spending period, leaving thin external buffers for the incoming Fourth Republic.',
    ],
    efccRecord: {
      status: 'NO_EFCC_INVESTIGATION',
      badgeLabel: 'No Personal EFCC Investigation (Pre-EFCC Era)',
      legalStatusNote: 'Served before the EFCC was established (2003) and was never personally investigated or charged. Historically, fraudster Emmanuel Nwude impersonated Ogwuma during the 1995–1998 $242M Banco Noroeste scam, which the EFCC later prosecuted against Nwude and co-conspirators.',
      accusationScope: [],
      sources: ['EFCC Historical Prosecution Archives (Banco Noroeste Case)', 'Central Bank of Nigeria Archive'],
    },
    sources: ['Central Bank of Nigeria Archive', 'NDIC Failed Banks Resolution Dossier (1994–1999)', 'CBN Statistical Bulletin'],
  },
  {
    id: 'j_sanusi',
    order: 8,
    name: 'Chief (Dr.) Joseph Oladele Sanusi',
    honorificTitle: 'Fourth Republic Transition Governor',
    initials: 'JS',
    portraitPath: '/governors/j_sanusi.jpg',
    photoSource: 'Central Bank of Nigeria Archive',
    era: 'FOURTH_REPUBLIC',
    accentColor: '#10b981',
    tenureLabel: 'May 29, 1999 – May 29, 2004',
    startYear: 1999,
    endYear: 2004,
    servedUnder: ['President Olusegun Obasanjo'],
    presidentIds: ['obasanjo'],
    headlineMandate: 'Democratic monetary stabilization, Universal Banking (2001), Dutch Auction FX & ₦100/₦200/₦500 notes.',
    macroIndicators: {
      fxStartToEnd: '₦92.34/$ (1999) -> ₦132.89/$ (2004 avg)',
      inflationRange: '6.6% (1999) -> 14.0%–15.0% (2003–2004)',
      policyRateHighlight: 'MRR ranged 14.0%–20.5%',
      reservesHighlight: 'Rebuilt from ~$3.7B (1999) to >$10B (mid-2004)',
      waysAndMeansNote: 'Limited under NEEDS / Fiscal Responsibility groundwork (pre-DMO 2000)',
    },
    economicManagement: [
      'Transitioned Nigeria out of military-era dual FX controls into the Dutch Auction System (DAS, 2002), rebuilding external reserves above $10B.',
      'Launched Universal Banking (2001), strengthened AML/KYC compliance, and introduced higher currency denominations (₦100, ₦200, and ₦500 notes) to ease transaction friction.',
      'Supported creation of the Debt Management Office (DMO, 2000) and Electronic Funds Transfer (NEFT/RTGS modernization groundwork).',
    ],
    documentedCriticisms: [
      'By 2004, Nigeria still operated 89 mostly small, under-capitalized banks heavily dependent on government treasury deposits and FX round-tripping rather than industrial lending.',
      'Could not contain Naira depreciation (₦92/$ -> ₦133/$) or prevent inflation returning to 14%–15% by 2003–2004 amid election-cycle fiscal expansion.',
      'High real lending spreads (>21% prime/max) persisted throughout his tenure, starving SMEs and agriculture of long-term credit.',
    ],
    efccRecord: {
      status: 'NO_EFCC_INVESTIGATION',
      badgeLabel: 'No EFCC Investigation Recorded',
      legalStatusNote: 'No personal EFCC investigation, indictment, or prosecution recorded during or after his 1999–2004 tenure (the EFCC was established in 2003, near the end of his term).',
      accusationScope: [],
      sources: ['Central Bank of Nigeria Archive'],
    },
    sources: ['Central Bank of Nigeria Archive', 'CBN Annual Reports (1999–2004)', 'IMF Nigeria Article IV Reports'],
  },
  {
    id: 'soludo',
    order: 9,
    name: 'Prof. Charles Chukwuma Soludo',
    honorificTitle: '2005 Banking Consolidation & CBN Act Governor',
    initials: 'CS',
    portraitPath: '/governors/soludo.jpg',
    photoSource: 'Central Bank of Nigeria Archive',
    era: 'FOURTH_REPUBLIC',
    accentColor: '#059669',
    tenureLabel: 'May 29, 2004 – May 29, 2009',
    startYear: 2004,
    endYear: 2009,
    servedUnder: ['President Olusegun Obasanjo', "President Umaru Musa Yar'Adua"],
    presidentIds: ['obasanjo', 'yaradua'],
    headlineMandate: '₦25B Banking Consolidation (89 -> 25 banks), CBN Act 2007 autonomy, MPR launch & $62B reserves peak.',
    macroIndicators: {
      fxStartToEnd: '₦132.89/$ -> ₦118.57/$ (2008) -> ₦148.90/$ (2009 GFC)',
      inflationRange: '17.9% (2005) -> 5.4% (2007 low) -> 12.5% (2009)',
      policyRateHighlight: 'Introduced modern MPR (2006): 10.0% -> 8.0% GFC cut',
      reservesHighlight: 'Peaked >$62B (Aug 2008) before GFC shock (~$42B by 2009)',
      waysAndMeansNote: 'Paris Club $18B exit & zero CBN deficit monetization norm',
    },
    economicManagement: [
      'Executed the 2004–2005 Banking Consolidation, raising minimum capital 12.5x from ₦2B to ₦25B and pruning 89 weak banks into 25 stronger capitalized groups.',
      'Championed the CBN Act 2007 enshrining statutory monetary independence, launched the Monetary Policy Rate (MPR) framework (2006), and introduced polymer notes / ₦1,000 bill.',
      'Managed oil-windfall macro stabilization and the 2005–2006 Paris Club external debt exit, lifting gross reserves past an all-time record $62B before the 2008 global crash.',
    ],
    documentedCriticisms: [
      'Post-consolidation capital frenzy fueled reckless stock-market margin lending and hidden toxic insider loans — 2009 special audits uncovered insolvency across 8 major banks (Oceanic, Intercontinental, Union, Afribank, Finbank, etc.).',
      'Sudden August 2007 Naira redenomination ("₦100 = ₦1") proposal was abruptly suspended by President Yar\'Adua over lack of cabinet coordination.',
      'Late 2008–2009 defense of FX reserves failed to prevent a sharp Naira drop (₦118/$ -> ₦149/$) and sudden credit freeze when oil fell from $147/bbl to $40/bbl.',
    ],
    efccRecord: {
      status: 'INVESTIGATED_CLEARED',
      badgeLabel: 'EFCC Investigated (2013) — Officially Cleared (2015)',
      period: 'Jan 2013 – Mar 2015',
      legalStatusNote: 'Invited and interrogated by the EFCC in January 2013; never charged. In March 2015, then-EFCC Chairman Ibrahim Lamorde publicly cleared and exonerated Soludo, confirming investigations did not incriminate him and he had no case to answer.',
      accusationScope: [
        'Polymer Banknote Bribery Inquiry (2006–2008 contracts): Investigated allegations that Australian banknote manufacturer Securency Pty Ltd paid bribes to Nigerian officials to secure polymer Naira printing and supply contracts awarded during his CBN tenure (joint inquiry with international partners including UK authorities).',
      ],
      sources: ['EFCC Official Press Briefing (Chairman Ibrahim Lamorde, March 2015)', 'Premium Times', 'Vanguard'],
    },
    sources: ['Central Bank of Nigeria Archive', 'CBN Act 2007 & Banking Consolidation Reports', '2009 CBN/NDIC Special Examination Findings'],
  },
  {
    id: 'sls_sanusi',
    order: 10,
    name: 'Mallam Sanusi Lamido Sanusi',
    honorificTitle: '2009 Banking Crisis Rescue, AMCON & BVN Governor',
    initials: 'SS',
    portraitPath: '/governors/sls_sanusi.jpg',
    photoSource: 'Central Bank of Nigeria Archive',
    era: 'FOURTH_REPUBLIC',
    accentColor: '#0284c7',
    tenureLabel: 'Jun 3, 2009 – Jun 2, 2014 (Suspended Feb 20, 2014)',
    startYear: 2009,
    endYear: 2014,
    servedUnder: ["President Umaru Musa Yar'Adua", 'President Goodluck Ebele Jonathan'],
    presidentIds: ['yaradua', 'jonathan'],
    headlineMandate: '₦620B 8-bank rescue, AMCON bad-debt cleanup, Cashless policy, BVN rollout & NNPC transparency clash.',
    macroIndicators: {
      fxStartToEnd: '₦148.90/$ -> ₦157.31/$ (RDAS stability)',
      inflationRange: '13.7% (2010) -> single-digit 8.0%–8.5% (2013–14)',
      policyRateHighlight: 'Hiked MPR from 6.0% (2009) to 12.0% tight stance',
      reservesHighlight: 'Held ~$34B–$48B across 2010–2014',
      waysAndMeansNote: 'Strict compliance; raised alarm over off-budget NNPC oil remittances',
    },
    economicManagement: [
      'Averted systemic depositor panic in 2009 by sacking executives of 8 insolvent banks, injecting ₦620B rescue capital, and co-founding AMCON (2010) to scrub toxic NPLs.',
      'Introduced transformative financial architecture: Bank Verification Number (BVN), Cashless Policy, Agent/Tiered KYC financial inclusion, and bank IFRS reporting.',
      'Tightened MPR to 12.0% while maintaining official FX stability around ₦155–₦158/$ and bringing headline inflation down to single digits (`~8.0%`) in 2013–2014.',
    ],
    documentedCriticisms: [
      'Socialization of private bank losses via AMCON accumulated >₦5.4T in public-sector/banking-sector contingent obligations whose asset recovery lagged sharply.',
      'Critics argued CBN-funded quasi-fiscal schemes (`₦500B+` power/aviation/SME interventions) blurred fiscal-monetary boundaries ahead of later excesses.',
      'Governance standoff with the Presidency — following his NASS/public whistleblowing over unremitted $20B NNPC oil revenues (PwC audit later traced ~$1.48B+ refund due) — triggered his February 2014 suspension over alleged CBN procurement/intervention breaches.',
    ],
    efccRecord: {
      status: 'SCRUTINIZED_NO_EFCC_CHARGE',
      badgeLabel: 'Post-Tenure Scrutiny & Unlawful Detention Ruling — No EFCC Charge',
      period: '2014 – 2015',
      legalStatusNote: 'Suspended Feb 20, 2014 after a Financial Reporting Council of Nigeria (FRCN) report shortly after he publicly alleged ~$20B in unremitted NNPC oil revenues. A Federal High Court ruled his brief post-suspension detention and passport seizure unlawful in April 2014. Never criminally charged or convicted by the EFCC.',
      accusationScope: [
        'FRCN Governance Allegations (2014): Cited alleged financial recklessness, procurement irregularities, and unauthorized intervention spending in the FRCN report that preceded his suspension.',
        'ONSA Arms Probe & Bank Bailout Petitions (2015): Media reports cited potential EFCC questioning over CBN disbursements to the Office of the National Security Adviser ($2.2B arms probe), alongside civil society petitions regarding the 2009 commercial bank bailouts — none resulted in EFCC criminal charges.',
      ],
      sources: ['Federal High Court Ruling (April 2014)', 'FRCN Report (2014)', 'Premium Times / Vanguard'],
    },
    sources: ['Central Bank of Nigeria Archive', 'Financial Reporting Council (FRC) & CBN 2013–14 Briefings', 'IMF Nigeria Article IV'],
  },
  {
    id: 'emefiele',
    order: 11,
    name: 'Mr. Godwin Emefiele',
    honorificTitle: 'Unorthodox Interventionism & Ways & Means Era Governor',
    initials: 'GE',
    portraitPath: '/governors/emefiele.jpg',
    photoSource: 'Central Bank of Nigeria Archive',
    era: 'FOURTH_REPUBLIC',
    accentColor: '#dc2626',
    tenureLabel: 'Jun 3, 2014 – Sep 25, 2023 (Suspended Jun 9, 2023)',
    startYear: 2014,
    endYear: 2023,
    servedUnder: ['President Goodluck Ebele Jonathan', 'President Muhammadu Buhari'],
    presidentIds: ['jonathan', 'buhari'],
    headlineMandate: 'Multiple FX windows, eNaira CBDC, Anchor Borrowers, ₦22.71T Ways & Means & 2023 Naira redesign crisis.',
    macroIndicators: {
      fxStartToEnd: '₦158.55/$ -> ₦461/$ official (750+ parallel gap at Jun 2023 exit)',
      inflationRange: '8.1% (2014) -> 22.4%+ (Jun 2023; food >25%)',
      policyRateHighlight: 'Cut to 11.5% during 2020 COVID -> hiked to 18.5% (May 2023)',
      reservesHighlight: 'Reported ~$34B gross (2023 exit), encumbered by FX swaps & ~$7B backlog',
      waysAndMeansNote: '₦22.71 Trillion overdraft printed (>CBN Act 5% cap), securitized May 2023',
    },
    economicManagement: [
      'Mitigated systemic credit defaults during the 2016 oil recession and 2020 COVID-19 shock via targeted regulatory forbearance and healthcare/SME liquidity facilities.',
      'Scaled BVN/SANEF financial inclusion and launched Africa’s first central bank digital currency (eNaira, October 2021).',
      'Directed long-tenor developmental credit (Anchor Borrowers’ Programme, RT200, fertilizer/rice value chains) supporting domestic staple milling capacity.',
    ],
    documentedCriticisms: [
      'Unlawful Fiscal Monetization: DMO & IMF data confirm CBN Ways & Means overdrafts surged past ₦22.71 trillion (exceeding Section 38(2) CBN Act 5% prior-revenue cap), directly driving multi-year inflation and swelling federal debt by May 2023.',
      'Multiple FX Windows & $7B Backlog: Administrative pegs, 43-item FX bans, and segmented rates distorted capital allocation, subsidized arbitrage rents (~₦461/$ vs ₦750+/$ street), and left ~$7B unmet FX forwards & trapped foreign airline funds.',
      'Chaotic 2022–2023 Naira Redesign: Confiscatory cash-swap deadlines caused severe nationwide physical cash shortages that contracted Q1 2023 informal GDP.',
      'Obazee Special Investigator Findings (Dec 2023): Suspended June 2023; Jim Obazee\'s forensic audit documented unauthorized foreign accounts, unapproved security/procurement expenditures, illegal Anchor Borrowers disbursements, and ongoing EFCC/Federal High Court prosecutions.',
    ],
    efccRecord: {
      status: 'CHARGED_TRIAL_ONGOING',
      badgeLabel: 'EFCC Arraigned — Trials Ongoing (Pleaded Not Guilty)',
      period: 'Oct 2023 – Present',
      legalStatusNote: 'Suspended June 9, 2023; initially detained by DSS and transferred to EFCC custody in October 2023. Arraigned on multi-count charges in Abuja and Lagos courts; pleaded not guilty across all counts. Criminal trials remain ongoing with no criminal conviction entered (separate civil/final forfeiture orders were entered on linked assets, including $2.045M and connected properties).',
      accusationScope: [
        'FCT High Court, Abuja (20-count amended charge, Justice Hamza Muazu): Alleged procurement fraud, criminal breach of trust, forgery, conspiracy, conferring corrupt advantage on companies linked to family/associates, and obtaining $6.23 million from the CBN vault by false pretence purportedly for 2023 foreign election observers (defense filed a no-case submission).',
        'Lagos Special Offences Court, Ikeja (19-count amended charge with co-defendant Henry Omoile, Justice Rahman Oshodi): Alleged abuse of office, accepting gratification/kickbacks, fraudulent receipt of property, and corrupt FX allocation practices involving $4.5 billion and ₦2.8 billion.',
        'FCT High Court, Maitama, Abuja (Justice Maryann Anenih): Charges alleging disobedience to the direction of law and illegal acts causing public injury over the late-2022 Naira redesign/swap allegedly executed without mandatory Presidential and CBN Board approvals, alongside alleged unauthorized withdrawals (including ₦124.8 billion) from the Consolidated Revenue Fund.',
      ],
      sources: [
        'EFCC Court Filings (FCT High Court Abuja & Lagos Special Offences Court)',
        'Jim Obazee Special Investigator Report (Dec 2023)',
        'Premium Times / Punch / Vanguard',
      ],
    },
    sources: [
      'DMO Nigeria June 30, 2023 Debt Report (₦22.71T Ways & Means)',
      'Jim Obazee Special Investigator Report on the CBN (Dec 2023)',
      'IMF Article IV Nigeria Consultations (2019–2023)',
    ],
  },
  {
    id: 'cardoso',
    order: 12,
    name: 'Mr. Olayemi Cardoso',
    honorificTitle: 'Incumbent Monetary Orthodoxy & Recapitalisation Governor',
    initials: 'OC',
    portraitPath: '/governors/cardoso.jpg',
    photoSource: 'Wikimedia Commons / CBN Incumbent',
    era: 'FOURTH_REPUBLIC',
    accentColor: '#f59e0b',
    tenureLabel: 'Sep 26, 2023 – Present',
    startYear: 2023,
    endYear: null,
    servedUnder: ['President Bola Ahmed Tinubu'],
    presidentIds: ['tinubu'],
    headlineMandate: 'Halt of Ways & Means printing, FX market float/backlog clearance, 27.5% -> 23% MPR cycle & ₦500B bank recapitalisation.',
    macroIndicators: {
      fxStartToEnd: '₦770/$ (Jun 2023) -> ₦1,550/$ (2025) -> ~₦1,358–₦1,379/$ (2026)',
      inflationRange: 'Peaked ~31.7%–34%+ (2024) -> moderated ~14.6% (late 2026)',
      policyRateHighlight: 'Hiked 18.75% -> 27.50% peak; eased to 23.00% (Sep 2026)',
      reservesHighlight: 'Rebuilt gross reserves toward ~$54.9B–$55.0B (2026)',
      waysAndMeansNote: 'Ceased fresh deficit monetization; legacy Ways & Means shifted into DMO bonds',
    },
    economicManagement: [
      'Ended direct CBN Ways & Means fiscal monetization, restoring transparent Treasury-bill auction price discovery and positive real yields.',
      'Cleared verified portions of the inherited $7 billion FX backlog (airlines & foreign obligations), deployed Electronic FX Matching (`EFEMS`), and rebuilt gross external reserves toward ~$55 billion by 2026.',
      'Tamed overheating through decisive MPR hikes up to 27.50%, stabilizing the Naira (~₦1,330–₦1,380/$) and enabling rate easing to 23.00% as inflation cooled toward ~14.6% in 2026.',
      'Initiated the 2024–2026 Banking Recapitalisation (raising international commercial bank minimum paid-up capital to ₦500 billion) to insulate lenders.',
    ],
    documentedCriticisms: [
      'Extreme Tightening & Borrowing Cost Shock: Keeping MPR at 26.25%–27.50% squeezed productive SMEs, manufacturers, and domestic working capital with commercial lending rates exceeding 30%–35%.',
      '2023–2024 Transition Volatility & Cost-of-Living Crisis: Rapid FX unification without initial reserve buffers saw the Naira lose >60% in 2023–2024, triggering corporate FX losses, multinational exits, and >31% headline inflation.',
      'Nominal Debt Revaluation Surge: Floating the currency from ₦461/₦770 to ~₦1,379–₦1,550/$ multiplied the Naira carrying value of Nigeria’s inherited external debt stock by over ₦26 trillion even before net new foreign loans.',
    ],
    efccRecord: {
      status: 'NO_EFCC_INVESTIGATION',
      badgeLabel: 'No EFCC Investigation (CBN Partnered With EFCC)',
      period: '2023 – Present',
      legalStatusNote: 'Not investigated or charged by the EFCC. Instead, following a forensic Deloitte audit flagging ~$2.4B in allegedly invalid/unlawful legacy FX forward claims out of the ~$7B backlog, the Cardoso-led CBN partnered with the EFCC to investigate and prosecute implicated banks, firms, and individuals.',
      accusationScope: [],
      sources: ['CBN Press Briefings (2024)', 'Deloitte FX Backlog Forensic Audit Summary'],
    },
    sources: [
      'Central Bank of Nigeria MPC Communiques (2023–2026)',
      'DMO Nigeria June 30, 2026 Debt Stock Report',
      'IMF Nigeria Article IV & NBS CPI Bulletins (2024–2026)',
    ],
  },
];

export function getGovernorsForPresident(
  presidentId: CbnGovernorProfile['presidentIds'][number]
): CbnGovernorProfile[] {
  return CBN_GOVERNORS.filter((g) => g.presidentIds.includes(presidentId));
}

export function getGovernorForYear(year: number): CbnGovernorProfile {
  const match = CBN_GOVERNORS.find(
    (g) => year >= g.startYear && (g.endYear === null || year <= g.endYear)
  );
  return match || CBN_GOVERNORS[CBN_GOVERNORS.length - 1];
}
