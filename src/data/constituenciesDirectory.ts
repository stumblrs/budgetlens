/**
 * Nigeria National Assembly Representation Directory
 * Covers all 109 Senatorial Districts (3 per State × 36 + 1 FCT) and 360 Federal Constituencies
 * across Nigeria's 36 States + Federal Capital Territory (FCT).
 */

export interface StateConstituencyProfile {
  state: string;
  geopoliticalZone: string;
  senatorialDistricts: readonly string[];
  federalConstituencies: readonly string[];
}

export interface ConstituencyLookupResult {
  state: string;
  geopoliticalZone: string;
  senatorialDistrict: string | null;
  federalConstituency: string | null;
  allSenatorialDistricts: readonly string[];
  totalFederalConstituenciesInState: number;
  matchedBy: 'lga_or_hint' | 'state_default' | 'unmatched';
}

const RAW_STATES: ReadonlyArray<{
  state: string;
  zone: string;
  senatorial: readonly string[];
  federal: readonly string[];
}> = [
  {
    state: 'Abia',
    zone: 'South East',
    senatorial: ['Abia Central', 'Abia North', 'Abia South'],
    federal: [
      'Aba North / Aba South',
      'Arochukwu / Ohafia',
      'Bende',
      'Ikwuano / Umuahia North / Umuahia South',
      'Isiala Ngwa North / Isiala Ngwa South',
      'Isuikwuato / Umunneochi',
      'Obingwa / Osisioma / Ugwunagbo',
      'Ukwa East / Ukwa West',
    ],
  },
  {
    state: 'Adamawa',
    zone: 'North East',
    senatorial: ['Adamawa Central', 'Adamawa North', 'Adamawa South'],
    federal: [
      'Demsa / Numan / Lamurde',
      'Fufore / Song',
      'Gombi / Hong',
      'Guyuk / Shelleng',
      'Jada / Ganye / Mayo-Belwa / Toungo',
      'Madagali / Michika',
      'Mubi North / Mubi South / Maiha',
      'Yola North / Yola South / Girei',
    ],
  },
  {
    state: 'Akwa Ibom',
    zone: 'South South',
    senatorial: ['Akwa Ibom North East', 'Akwa Ibom North West', 'Akwa Ibom South'],
    federal: [
      'Abak / Etim Ekpo / Ika',
      'Eket / Esit Eket / Ibeno / Onna',
      'Etinan / Nsit Ibom / Nsit Ubium',
      'Ikono / Ini',
      'Ikot Abasi / Mkpat Enin / Eastern Obolo',
      'Ikot Ekpene / Essien Udim / Obot Akara',
      'Itu / Ibiono Ibom',
      'Oron / Mbo / Okobo / Udung Uko / Urue Offong-Oruko',
      'Ukanafun / Oruk Anam',
      'Uyo / Uruan / Nsit Atai / Ibesikpo Asutan',
    ],
  },
  {
    state: 'Anambra',
    zone: 'South East',
    senatorial: ['Anambra Central', 'Anambra North', 'Anambra South'],
    federal: [
      'Aguata',
      'Anambra East / Anambra West',
      'Anaocha / Njikoka / Dunukofia',
      'Awka North / Awka South',
      'Idemili North / Idemili South',
      'Ihiala',
      'Nnewi North / Nnewi South / Ekwusigo',
      'Ogbaru',
      'Onitsha North / Onitsha South',
      'Orumba North / Orumba South',
      'Oyi / Ayamelum',
    ],
  },
  {
    state: 'Bauchi',
    zone: 'North East',
    senatorial: ['Bauchi Central', 'Bauchi North', 'Bauchi South'],
    federal: [
      'Alkaleri / Kirfi',
      'Bauchi',
      'Bogoro / Dass / Tafawa Balewa',
      'Darazo / Ganjuwa',
      'Gamawa',
      'Itas-Gadau / Jamaare',
      'Katagum',
      'Misau / Dambam',
      'Ningi / Warji',
      'Shira / Giade',
      'Toro',
      'Zaki',
    ],
  },
  {
    state: 'Bayelsa',
    zone: 'South South',
    senatorial: ['Bayelsa Central', 'Bayelsa East', 'Bayelsa West'],
    federal: [
      'Brass / Nembe',
      'Ogbia',
      'Sagbama / Ekeremor',
      'Southern Ijaw',
      'Yenagoa / Kolokuma-Opokuma',
    ],
  },
  {
    state: 'Benue',
    zone: 'North Central',
    senatorial: ['Benue North East', 'Benue North West', 'Benue South'],
    federal: [
      'Ado / Okpokwu / Ogbadibo',
      'Apa / Agatu',
      'Buruku',
      'Gboko / Tarka',
      'Guma / Makurdi',
      'Gwer East / Gwer West',
      'Katsina-Ala / Ukum / Logo',
      'Konshisha / Vandeikya',
      'Kwande / Ushongo',
      'Oju / Obi',
      'Otukpo / Ohimini',
    ],
  },
  {
    state: 'Borno',
    zone: 'North East',
    senatorial: ['Borno Central', 'Borno North', 'Borno South'],
    federal: [
      'Askira-Uba / Hawul',
      'Bama / Ngala / Kala-Balge',
      'Biu / Bayo / Kwaya Kusar / Shani',
      'Chibok / Damboa / Gwoza',
      'Dikwa / Mafa / Konduga',
      'Gubio / Kaga / Magumeri',
      'Jere',
      'Kukawa / Mobbar / Abadam / Guzamala',
      'Maiduguri Metropolitan',
      'Monguno / Marte / Nganzai',
    ],
  },
  {
    state: 'Cross River',
    zone: 'South South',
    senatorial: ['Cross River Central', 'Cross River North', 'Cross River South'],
    federal: [
      'Abi / Yakurr',
      'Akamkpa / Biase',
      'Akpabuyo / Bakassi / Calabar South',
      'Boki / Ikom',
      'Calabar Municipal / Odukpani',
      'Obubra / Etung',
      'Obanliku / Obudu / Bekwarra',
      'Ogoja / Yala',
    ],
  },
  {
    state: 'Delta',
    zone: 'South South',
    senatorial: ['Delta Central', 'Delta North', 'Delta South'],
    federal: [
      'Aniocha North / Aniocha South / Oshimili North / Oshimili South',
      'Bomadi / Patani',
      'Burutu',
      'Ethiope East / Ethiope West',
      'Ika North East / Ika South',
      'Isoko North / Isoko South',
      'Ndokwa East / Ndokwa West / Ukwuani',
      'Okpe / Sapele / Uvwie',
      'Ughelli North / Ughelli South / Udu',
      'Warri North / Warri South / Warri South West',
    ],
  },
  {
    state: 'Ebonyi',
    zone: 'South East',
    senatorial: ['Ebonyi Central', 'Ebonyi North', 'Ebonyi South'],
    federal: [
      'Abakaliki / Izzi',
      'Afikpo North / Afikpo South',
      'Ebonyi / Ohaukwu',
      'Ezza North / Ishielu',
      'Ezza South / Ikwo',
      'Ivo / Ohaozara / Onicha',
    ],
  },
  {
    state: 'Edo',
    zone: 'South South',
    senatorial: ['Edo Central', 'Edo North', 'Edo South'],
    federal: [
      'Akoko-Edo',
      'Egor / Ikpoba-Okha',
      'Esan Central / Esan West / Igueben',
      'Esan North East / Esan South East',
      'Etsako East / Etsako West / Etsako Central',
      'Oredo',
      'Orhionmwon / Uhunmwonde',
      'Ovia North East / Ovia South West',
      'Owan East / Owan West',
    ],
  },
  {
    state: 'Ekiti',
    zone: 'South West',
    senatorial: ['Ekiti Central', 'Ekiti North', 'Ekiti South'],
    federal: [
      'Ado Ekiti / Irepodun-Ifelodun',
      'Ekiti South West / Ikere / Ise-Orun',
      'Emure / Gbonyin / Ekiti East',
      'Ido-Osi / Moba / Ilejemeje',
      'Ijero / Ekiti West / Efon',
      'Ikole / Oye',
    ],
  },
  {
    state: 'Enugu',
    zone: 'South East',
    senatorial: ['Enugu East', 'Enugu North', 'Enugu West'],
    federal: [
      'Aninri / Awgu / Oji River',
      'Enugu East / Isi-Uzo',
      'Enugu North / Enugu South',
      'Ezeagu / Udi',
      'Igbo-Etiti / Uzo-Uwani',
      'Igbo-Eze North / Udenu',
      'Nkanu East / Nkanu West',
      'Nsukka / Igbo-Eze South',
    ],
  },
  {
    state: 'Gombe',
    zone: 'North East',
    senatorial: ['Gombe Central', 'Gombe North', 'Gombe South'],
    federal: [
      'Akko',
      'Balanga / Billiri',
      'Dukku / Nafada',
      'Gombe / Kwami / Funakaye',
      'Kaltungo / Shongom',
      'Yamaltu-Deba',
    ],
  },
  {
    state: 'Imo',
    zone: 'South East',
    senatorial: ['Imo East', 'Imo North', 'Imo West'],
    federal: [
      'Aboh Mbaise / Ngor Okpala',
      'Ahiazu Mbaise / Ezinihitte Mbaise',
      'Ehime Mbano / Ihitte-Uboma / Obowo',
      'Ideato North / Ideato South',
      'Ikeduru / Mbaitoli',
      'Isiala Mbano / Okigwe / Onuimo',
      'Isu / Njaba / Nkwerre / Nwangele',
      'Oguta / Ohaji-Egbema / Oru West',
      'Orlu / Orsu / Oru East',
      'Owerri Municipal / Owerri North / Owerri West',
    ],
  },
  {
    state: 'Jigawa',
    zone: 'North West',
    senatorial: ['Jigawa North East', 'Jigawa North West', 'Jigawa South West'],
    federal: [
      'Babura / Garki',
      'Birnin Kudu / Buji',
      'Dutse / Kiyawa',
      'Gagarawa / Gumel / Maigatari / Sule Tankarkar',
      'Gwaram',
      'Hadejia / Auyo / Kafin Hausa',
      'Jahun / Miga',
      'Kazaure / Roni / Gwiwa / Yankwashi',
      'Kiri Kasamma / Birniwa / Guri',
      'Malam Madori / Kaugama',
      'Ringim / Taura',
    ],
  },
  {
    state: 'Kaduna',
    zone: 'North West',
    senatorial: ['Kaduna Central', 'Kaduna North', 'Kaduna South'],
    federal: [
      'Birnin Gwari / Giwa',
      'Chikun / Kajuru',
      'Igabi',
      'Ikara / Kubau',
      'Jema-a / Sanga',
      'Kachia / Kagarko',
      'Kaduna North',
      'Kaduna South',
      'Kaura',
      'Kauru',
      'Lere',
      'Makarfi / Kudan',
      'Sabon Gari',
      'Soba',
      'Zangon Kataf / Jaba',
      'Zaria',
    ],
  },
  {
    state: 'Kano',
    zone: 'North West',
    senatorial: ['Kano Central', 'Kano North', 'Kano South'],
    federal: [
      'Albasu / Gaya / Ajingi',
      'Bebeji / Kiru',
      'Bichi',
      'Dala',
      'Danbatta / Makoda',
      'Dawakin Kudu / Warawa',
      'Dawakin Tofa / Tofa / Rimin Gado',
      'Doguwa / Tudun Wada',
      'Fagge',
      'Gabasawa / Gezawa',
      'Gwarzo / Kabo',
      'Gwale',
      'Kano Municipal',
      'Karaye / Rogo',
      'Kumbotso',
      'Kura / Madobi / Garun Malam',
      'Minjibir / Ungogo',
      'Nasarawa',
      'Rano / Bunkure / Kibiya',
      'Shanono / Bagwai',
      'Sumaila / Takai',
      'Tarauni',
      'Tsanyawa / Kunchi',
      'Wudil / Garko',
    ],
  },
  {
    state: 'Katsina',
    zone: 'North West',
    senatorial: ['Katsina Central', 'Katsina North', 'Katsina South'],
    federal: [
      'Bakori / Danja',
      'Batagarawa / Charanchi / Rimi',
      'Batsari / Safana / Danmusa',
      'Bindawa / Mani',
      'Daura / Sandamu / Maiadua',
      'Dutsin-Ma / Kurfi',
      'Faskari / Kankara / Sabuwa',
      'Funtua / Dandume',
      'Ingawa / Kankia / Kusada',
      'Jibia / Kaita',
      'Kafur / Malumfashi',
      'Katsina',
      'Mashi / Dutsi',
      'Matazu / Musawa',
      'Zango / Baure',
    ],
  },
  {
    state: 'Kebbi',
    zone: 'North West',
    senatorial: ['Kebbi Central', 'Kebbi North', 'Kebbi South'],
    federal: [
      'Aleiro / Gwandu / Jega',
      'Arewa / Dandi',
      'Argungu / Augie',
      'Bagudo / Suru',
      'Birnin Kebbi / Kalgo / Bunza',
      'Fakai / Sakaba / Wasagu-Danko / Zuru',
      'Koko-Besse / Maiyama',
      'Ngaski / Shanga / Yauri',
    ],
  },
  {
    state: 'Kogi',
    zone: 'North Central',
    senatorial: ['Kogi Central', 'Kogi East', 'Kogi West'],
    federal: [
      'Adavi / Okehi',
      'Ajaokuta',
      'Ankpa / Omala / Olamaboro',
      'Bassa / Dekina',
      'Ibaji / Idah / Igalamela-Odolu / Ofu',
      'Kabba-Bunu / Ijumu',
      'Kogi / Lokoja',
      'Okene / Ogori-Magongo',
      'Yagba East / Yagba West / Mopa-Muro',
    ],
  },
  {
    state: 'Kwara',
    zone: 'North Central',
    senatorial: ['Kwara Central', 'Kwara North', 'Kwara South'],
    federal: [
      'Asa / Ilorin West',
      'Baruten / Kaiama',
      'Edu / Moro / Pategi',
      'Ekiti / Isin / Irepodun / Oke-Ero',
      'Ifelodun / Offa / Oyun',
      'Ilorin East / Ilorin South',
    ],
  },
  {
    state: 'Lagos',
    zone: 'South West',
    senatorial: ['Lagos Central', 'Lagos East', 'Lagos West'],
    federal: [
      'Agege',
      'Ajeromi-Ifelodun',
      'Alimosho',
      'Amuwo-Odofin',
      'Apapa',
      'Badagry',
      'Epe',
      'Eti-Osa',
      'Ibeju-Lekki',
      'Ifako-Ijaiye',
      'Ikeja',
      'Ikorodu',
      'Kosofe',
      'Lagos Island I',
      'Lagos Island II',
      'Lagos Mainland',
      'Mushin I',
      'Mushin II',
      'Ojo',
      'Oshodi-Isolo I',
      'Oshodi-Isolo II',
      'Shomolu',
      'Surulere I',
      'Surulere II',
    ],
  },
  {
    state: 'Nasarawa',
    zone: 'North Central',
    senatorial: ['Nasarawa North', 'Nasarawa South', 'Nasarawa West'],
    federal: [
      'Akwanga / Nasarawa Eggon / Wamba',
      'Awe / Doma / Keana',
      'Karu / Keffi / Kokona',
      'Lafia / Obi',
      'Nasarawa / Toto',
    ],
  },
  {
    state: 'Niger',
    zone: 'North Central',
    senatorial: ['Niger East', 'Niger North', 'Niger South'],
    federal: [
      'Agaie / Lapai',
      'Agwara / Borgu',
      'Bida / Gbako / Katcha',
      'Bosso / Paikoro',
      'Chanchaga',
      'Kontagora / Mariga / Mashegu / Wushishi',
      'Lavun / Mokwa / Edati',
      'Magama / Rijau',
      'Shiroro / Rafi / Munya',
      'Suleja / Gurara / Tafa',
    ],
  },
  {
    state: 'Ogun',
    zone: 'South West',
    senatorial: ['Ogun Central', 'Ogun East', 'Ogun West'],
    federal: [
      'Abeokuta North / Obafemi-Owode / Odeda',
      'Abeokuta South',
      'Ado-Odo / Ota',
      'Egbado North / Imeko-Afon',
      'Egbado South / Ipokia',
      'Ifo / Ewekoro',
      'Ijebu North / Ijebu East / Ogun Waterside',
      'Ijebu Ode / Odogbolu / Ijebu North East',
      'Ikenne / Sagamu / Remo North',
    ],
  },
  {
    state: 'Ondo',
    zone: 'South West',
    senatorial: ['Ondo Central', 'Ondo North', 'Ondo South'],
    federal: [
      'Akoko North East / Akoko North West',
      'Akoko South East / Akoko South West',
      'Akure North / Akure South',
      'Idanre / Ifedore',
      'Ilaje / Ese-Odo',
      'Ile-Oluji-Okeigbo / Odigbo',
      'Irele / Okitipupa',
      'Ondo East / Ondo West',
      'Owo / Ose',
    ],
  },
  {
    state: 'Osun',
    zone: 'South West',
    senatorial: ['Osun Central', 'Osun East', 'Osun West'],
    federal: [
      'Atakunmosa East / Atakunmosa West / Ilesa East / Ilesa West',
      'Ayedade / Irewole / Isokan',
      'Ayedire / Iwo / Ola-Oluwa',
      'Boluwaduro / Ifedayo / Ila',
      'Ede North / Ede South / Egbedore / Ejigbo',
      'Ife Central / Ife East / Ife North / Ife South',
      'Ifelodun / Boripe / Odo-Otin',
      'Irepodun / Olorunda / Osogbo / Orolu',
      'Obokun / Oriade',
    ],
  },
  {
    state: 'Oyo',
    zone: 'South West',
    senatorial: ['Oyo Central', 'Oyo North', 'Oyo South'],
    federal: [
      'Afijio / Atiba / Oyo East / Oyo West',
      'Akinyele / Lagelu',
      'Atisbo / Saki East / Saki West',
      'Egbeda / Ona-Ara',
      'Ibadan North',
      'Ibadan North East / Ibadan South East',
      'Ibadan North West / Ibadan South West',
      'Ibarapa Central / Ibarapa North',
      'Ibarapa East / Ido',
      'Irepo / Olorunsogo / Oorelope',
      'Iseyin / Itesiwaju / Kajola / Iwajowa',
      'Ogbomoso North / Ogbomoso South / Oriire',
      'Ogo Oluwa / Surulere',
      'Oluyole',
    ],
  },
  {
    state: 'Plateau',
    zone: 'North Central',
    senatorial: ['Plateau Central', 'Plateau North', 'Plateau South'],
    federal: [
      'Barkin Ladi / Riyom',
      'Bassa / Jos North',
      'Bokkos / Mangu',
      'Jos South / Jos East',
      'Kanke / Pankshin / Kanam',
      'Langtang North / Langtang South',
      'Mikang / Qua-an Pan / Shendam',
      'Wase',
    ],
  },
  {
    state: 'Rivers',
    zone: 'South South',
    senatorial: ['Rivers East', 'Rivers South East', 'Rivers West'],
    federal: [
      'Abua-Odual / Ahoada East',
      'Ahoada West / Ogba-Egbema-Ndoni',
      'Akuku-Toru / Asari-Toru',
      'Andoni / Opobo-Nkoro',
      'Degema / Bonny',
      'Eleme / Oyigbo / Tai',
      'Etche / Omuma',
      'Ikwerre / Emohua',
      'Khana / Gokana',
      'Obio / Akpor',
      'Okrika / Ogu-Bolo',
      'Port Harcourt I',
      'Port Harcourt II',
    ],
  },
  {
    state: 'Sokoto',
    zone: 'North West',
    senatorial: ['Sokoto East', 'Sokoto North', 'Sokoto South'],
    federal: [
      'Binji / Silame',
      'Dange-Shuni / Bodinga / Tureta',
      'Gada / Goronyo',
      'Gudu / Tangaza',
      'Gwadabawa / Illela',
      'Isa / Sabon Birni',
      'Kebbe / Tambuwal',
      'Kware / Wamakko',
      'Rabah / Wurno',
      'Sokoto North / Sokoto South',
      'Yabo / Shagari',
    ],
  },
  {
    state: 'Taraba',
    zone: 'North East',
    senatorial: ['Taraba Central', 'Taraba North', 'Taraba South'],
    federal: [
      'Ardo-Kola / Karim Lamido / Lau',
      'Bali / Gassol',
      'Donga / Ussa / Takum',
      'Gashaka / Kurmi / Sardauna',
      'Ibi / Wukari',
      'Jalingo / Yorro / Zing',
    ],
  },
  {
    state: 'Yobe',
    zone: 'North East',
    senatorial: ['Yobe East', 'Yobe North', 'Yobe South'],
    federal: [
      'Bade / Jakusko',
      'Bursari / Geidam / Yunusari',
      'Damaturu / Gujba / Gulani / Tarmuwa',
      'Fika / Fune',
      'Machina / Nguru / Yusufari / Karasuwa',
      'Nangere / Potiskum',
    ],
  },
  {
    state: 'Zamfara',
    zone: 'North West',
    senatorial: ['Zamfara Central', 'Zamfara North', 'Zamfara West'],
    federal: [
      'Anka / Talata Mafara',
      'Bakura / Maradun',
      'Bungudu / Maru',
      'Gummi / Bukkuyum',
      'Gusau / Tsafe',
      'Kaura Namoda / Birnin Magaji',
      'Shinkafi / Zurmi',
    ],
  },
  {
    state: 'FCT',
    zone: 'North Central',
    senatorial: ['FCT Abuja'],
    federal: ['Abaji / Gwagwalada / Kuje / Kwali', 'Abuja Municipal (AMAC) / Bwari'],
  },
];

export const NIGERIA_CONSTITUENCIES_DIRECTORY: ReadonlyArray<StateConstituencyProfile> =
  RAW_STATES.map((entry) => ({
    state: entry.state,
    geopoliticalZone: entry.zone,
    senatorialDistricts: entry.senatorial,
    federalConstituencies: entry.federal,
  }));

export const TOTAL_SENATORIAL_DISTRICTS = NIGERIA_CONSTITUENCIES_DIRECTORY.reduce(
  (acc, item) => acc + item.senatorialDistricts.length,
  0
);

export const TOTAL_FEDERAL_CONSTITUENCIES = NIGERIA_CONSTITUENCIES_DIRECTORY.reduce(
  (acc, item) => acc + item.federalConstituencies.length,
  0
);

function normalizeStateKey(raw: string): string {
  const cleaned = raw.trim().toLowerCase().replace(/\s+state$/i, '');
  if (cleaned === 'abuja' || cleaned === 'fct abuja' || cleaned === 'federal capital territory') {
    return 'fct';
  }
  return cleaned;
}

export function getStateConstituencyProfile(state: string): StateConstituencyProfile | null {
  if (!state || !state.trim()) return null;
  const key = normalizeStateKey(state);
  return (
    NIGERIA_CONSTITUENCIES_DIRECTORY.find((item) => item.state.toLowerCase() === key) || null
  );
}

/**
 * Resolve the Nigerian Federal Constituency and Senatorial District for a project
 * given its State, LGA, and optional descriptive text hint (e.g. project name).
 */
export function lookupConstituency(
  state?: string | null,
  lga?: string | null,
  textHint?: string | null
): ConstituencyLookupResult {
  const profile = state ? getStateConstituencyProfile(state) : null;
  if (!profile) {
    return {
      state: state?.trim() || 'Federal / Nationwide',
      geopoliticalZone: 'National',
      senatorialDistrict: null,
      federalConstituency: null,
      allSenatorialDistricts: [],
      totalFederalConstituenciesInState: 0,
      matchedBy: 'unmatched',
    };
  }

  const haystacks = [lga, textHint]
    .filter((v): v is string => Boolean(v && v.trim()))
    .map((v) => v.toLowerCase());

  let matchedFed: string | null = null;
  for (const fed of profile.federalConstituencies) {
    const parts = fed
      .toLowerCase()
      .split(/[/-]/)
      .map((p) => p.replace(/\(.*?\)/g, '').trim())
      .filter((p) => p.length >= 3);
    if (haystacks.some((h) => parts.some((part) => h.includes(part)))) {
      matchedFed = fed;
      break;
    }
  }

  // Match Senatorial District direction keyword if present in text/LGA
  let matchedSen = profile.senatorialDistricts[0] ?? null;
  for (const sen of profile.senatorialDistricts) {
    const suffix = sen.replace(new RegExp(`^${profile.state}\\s+`, 'i'), '').toLowerCase();
    if (haystacks.some((h) => h.includes(suffix))) {
      matchedSen = sen;
      break;
    }
  }

  return {
    state: profile.state,
    geopoliticalZone: profile.geopoliticalZone,
    senatorialDistrict: matchedSen,
    federalConstituency: matchedFed || profile.federalConstituencies[0] || null,
    allSenatorialDistricts: profile.senatorialDistricts,
    totalFederalConstituenciesInState: profile.federalConstituencies.length,
    matchedBy: matchedFed ? 'lga_or_hint' : 'state_default',
  };
}
