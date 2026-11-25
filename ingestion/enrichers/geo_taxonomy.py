import functools
import json
import re
from pathlib import Path

STATES_TO_ZONE = {
    'Abia': 'South East', 'Anambra': 'South East', 'Ebonyi': 'South East', 'Enugu': 'South East', 'Imo': 'South East',
    'Akwa Ibom': 'South South', 'Bayelsa': 'South South', 'Cross River': 'South South', 'Delta': 'South South', 'Edo': 'South South', 'Rivers': 'South South',
    'Ekiti': 'South West', 'Lagos': 'South West', 'Ogun': 'South West', 'Ondo': 'South West', 'Osun': 'South West', 'Oyo': 'South West',
    'Benue': 'North Central', 'Kogi': 'North Central', 'Kwara': 'North Central', 'Nasarawa': 'North Central', 'Niger': 'North Central', 'Plateau': 'North Central', 'Federal Capital Territory': 'North Central', 'FCT Abuja': 'North Central',
    'Adamawa': 'North East', 'Bauchi': 'North East', 'Borno': 'North East', 'Gombe': 'North East', 'Taraba': 'North East', 'Yobe': 'North East',
    'Jigawa': 'North West', 'Kaduna': 'North West', 'Kano': 'North West', 'Katsina': 'North West', 'Kebbi': 'North West', 'Sokoto': 'North West', 'Zamfara': 'North West',
}

CANONICAL_STATES = [
    s for s in STATES_TO_ZONE.keys() if s != 'FCT Abuja'
]

# Require explicit geographic context after short/ambiguous 3-5 letter tokens (e.g., ifo="in favour of", edu="education", isa, ota, ido)
_GEO_CTX = r'(?=\s+(?:l\.?g\.?a|local\s+gov|constituency|town|road|expressway|state|community|axis))'

# State-specific word-boundary regexes + major cities/capitals (prevents "nigeria"->Niger, "toyota"->Oyo, "ifo"->Ogun, etc.)
STATE_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ('Cross River', re.compile(r'\b(?:cross\s*river(?:\s+state)?|calabar|ikom|ogoja|obudu|obubra|akpabuyo|odukpani|yala|biase|bekwarra|yakurr|boki|etung)\b', re.I)),
    ('Federal Capital Territory', re.compile(r'\b(?:federal\s+capital\s+territory|fct\s+abuja|abuja\s+fct|\bfct\b|\babuja\b|gwagwalada|bwari|kuje|abaji|kwali|amac|kubwa|gwarinpa|maitama|wuse|garki|asokoro|nyanya|lugbe|karshi|zuba|jabi|utako|fcda|fcta)\b', re.I)),
    ('Niger', re.compile(r'\b(?:niger\s+state|minna|bida|suleja|kontagora|mokwa|lapai|agaie|new\s+bussa|kagara|wushishi|lavun|gbako|chanchaga|bosso|shiroro|munya|paikoro|rafi|mariga|mashegu|magama|rijau|borgu|agwara|katcha|edati|gurara|tafa)\b', re.I)),
    ('Delta', re.compile(rf'\b(?:delta\s+state|asaba|warri|sapele|ughelli|agbor|abraka|oleh|ozoro|kwale|burutu|bomadi|isoko|ndokwa|ika\s+(?:north|south)|okpe|uvwie|patani|oshimili|aniocha|ethiop[e]?\s+(?:east|west)|udu{_GEO_CTX})\b', re.I)),
    ('Rivers', re.compile(r'\b(?:rivers\s+state|port\s*harcourt|bonny|ahoada|eleme|ikwerre|obio[/\s]?akpor|ogoni|khana|gokana|okrika|degema|abua|andoni|etche|emohua|oyigbo|omuma|opobo|asari[-\s]?toru|akuku[-\s]?toru|ogba/egbema)\b', re.I)),
    ('Oyo', re.compile(rf'\b(?:oyo\s+state|\boyo\b|ibadan|ogbomos[ho]?|iseyin|saki|eruwa|igboho|kishi|afijio|akinyele|atiba|atisbo|egbeda|ibarapa|ido{_GEO_CTX}|irepo|iwa?jowa|kajola|lagelu|ogooluwa|olorunsogo|oluyole|ona[-\s]?ara|orelope|ori\s*ire)\b', re.I)),
    ('Ondo', re.compile(rf'\b(?:ondo\s+state|\bondo\b|akure|owo{_GEO_CTX}|okitipupa|ikare|idanre|ile[-\s]?oluji|akoko|ilaje|ese[-\s]?odo|ifedore|irele|odigbo|ose{_GEO_CTX}|ondowest|ondoeast)\b', re.I)),
    ('Edo', re.compile(rf'\b(?:edo\s+state|\bedo\b|benin\s+city|auchi|ekpoma|uromi|irrua|esan|etsako|oredo|ovia|egor|ikpoba|orhiomwon|uhunmwonde|igbo?eben|owen{_GEO_CTX}|owan)\b', re.I)),
    ('Imo', re.compile(rf'\b(?:imo\s+state|\bimo\b|owerri|orlu|okigwe|mbaise|oguta|mbano|ideato|njaba|ngor[-\s]?okpala|ohaji|egbema|ahiazu|ehime|ezinihitte|ihitte|ikwuano|isu{_GEO_CTX}|mbaitoli|nkwerre|nwangele|obowo|or[su]{_GEO_CTX})\b', re.I)),
    ('Abia', re.compile(rf'\b(?:abia\s+state|\babia\b|umuahia|aba\s+north|aba\s+south|arochukwu|ohafia|bende{_GEO_CTX}|isiala\s*ngwa|obingwa|ukwa|umunneochi|ikwuano|isuikwuato|osisioma|ugwunagbo)\b', re.I)),
    ('Akwa Ibom', re.compile(rf'\b(?:akwa\s*ibom(?:\s+state)?|uyo|eket|ikot\s+ekpene|oron|abak|ikot\s+abasi|etinan|itu{_GEO_CTX}|ibeno|mbo{_GEO_CTX}|mkpat\s*enin|nsit|okobo|onna|oruk\s*anam|udung\s*uko|ukanafun|uruan|urue[-\s]?offong)\b', re.I)),
    ('Bayelsa', re.compile(r'\b(?:bayelsa(?:\s+state)?|yenagoa|ekowe|otuoke|ogbia|sagbama|ekerenmor|kolokuma|nembe|southern\s+ijaw)\b', re.I)),
    ('Anambra', re.compile(r'\b(?:anambra(?:\s+state)?|awka|onitsha|nnewi|ekwulobia|ihiala|aguleri|aguata|anaoocha|ayamelum|dunukofia|ekwusigo|idemili|njikoka|nnewi|ogbaru|orumba|oyi)\b', re.I)),
    ('Ebonyi', re.compile(rf'\b(?:ebonyi(?:\s+state)?|abakaliki|afikpo|ohaofia|ohaukwu|ezillo|ezza|ikwo|ishielu|ivo{_GEO_CTX}|izzi|ohaozara|onicha)\b', re.I)),
    ('Enugu', re.compile(r'\b(?:enugu(?:\s+state)?|nsukka|awgu|oji\s*river|udi|nkanu|ezeagu|igbo[-\s]?etiti|igbo[-\s]?eze|isi[-\s]?uzo|udenu|uzo[-\s]?uwani)\b', re.I)),
    ('Ekiti', re.compile(rf'\b(?:ekiti(?:\s+state)?|ado[-\s]?ekiti|ikere|ikole|ijero|ido[-\s]?osi|efon|emure|gbonyin|iye{_GEO_CTX}|moba|oye)\b', re.I)),
    ('Lagos', re.compile(r'\b(?:lagos(?:\s+state)?|ikeja|lekki|ikorodu|badagry|epe|apapa|surulere|yaba|ikoyi|victoria\s+island|agege|alimosho|amuwo[-\s]?odofin|ejigbo|eti[-\s]?osa|ibeju|ifako|kosofe|mushin|ojo|oshodi|somolu|shomolu)\b', re.I)),
    ('Ogun', re.compile(rf'\b(?:ogun\s+state|\bogun\b|abeokuta|ijebu|sagamu|shagamu|ota{_GEO_CTX}|ado[-\s]?odo|ewekoro|ifo{_GEO_CTX}|imeko|ipokia|obafemi[-\s]?owode|odeda|odogbolu|ogun\s+waterside|remo|yewa)\b', re.I)),
    ('Osun', re.compile(rf'\b(?:osun(?:\s+state)?|osogbo|oshogbo|ile[-\s]?ife|ife\s+(?:east|west|north|south|central)|ilesa|ilesha|ede|iwo{_GEO_CTX}|ikire|ejigbo|ayedaade|ayedire|boluwaduro|boripe|ifelodun|ila{_GEO_CTX}|irepodun|irewole|isokan|obokun|odo[-\s]?otin|ola[-\s]?oluwa|olorunda|oriade)\b', re.I)),
    ('Benue', re.compile(rf'\b(?:benue(?:\s+state)?|makurdi|gboko|otukpo|katsina[-\s]?ala|vandeikya|ado{_GEO_CTX}|agatu|apa{_GEO_CTX}|buruku|guma|gwer|konshisha|kwande|obi\s+lga|ogbadibo|ohimini|oju{_GEO_CTX}|okpokwu|tarka|ukum|ushongo)\b', re.I)),
    ('Kogi', re.compile(rf'\b(?:kogi(?:\s+state)?|lokoja|okene|idah|kabba|ankpa|ajaokuta|adavi|bassa|dekina|ibaji|igalamela|ijumu|kogi|mopa|ofu{_GEO_CTX}|ogori|okehi|olamaboro|omala|yagba)\b', re.I)),
    ('Kwara', re.compile(rf'\b(?:kwara(?:\s+state)?|ilorin|offa|lafiagi|jebba|omu[-\s]?aran|asa{_GEO_CTX}|baruten|edu{_GEO_CTX}|ekiti\s+lga|ifelodun|irepodun|isin|kaiama|moro|oke[-\s]?ero|oyun|pategi)\b', re.I)),
    ('Nasarawa', re.compile(r'\b(?:nasarawa(?:\s+state)?|lafia|keffi|akwanga|doma|karu|keana|kokona|nasarawa\s+eggon|toto|wamba)\b', re.I)),
    ('Plateau', re.compile(r'\b(?:plateau(?:\s+state)?|\bjos\b|bukuru|pankshin|shendam|barkin\s*ladi|bassa|bokkos|kanam|kanke|langtang|mangu|mikang|qua.?an\s*pan|riyom|wase)\b', re.I)),
    ('Adamawa', re.compile(r'\b(?:adamawa(?:\s+state)?|yola|mubi|numan|jalingo|michika|madagali|demsa|fufore|ganye|girei|gombi|guyuk|hong|jada|lamurde|maiha|mayo[-\s]?belwa|shelleng|song|toungo)\b', re.I)),
    ('Bauchi', re.compile(r'\b(?:bauchi(?:\s+state)?|azare|misau|katagum|ningi|alkaleri|bogoro|dambam|darazo|dass|gamawa|ganjuwa|giade|itas|jama.?are|kirfi|shira|tafawa\s+balewa|toro|warji|zaki)\b', re.I)),
    ('Borno', re.compile(r'\b(?:borno(?:\s+state)?|maiduguri|biu|bama|chibok|damboa|dikwa|gubio|guzamala|gwoza|hawul|jere|kaga|kala|konduga|kukawa|kwaya|mafa|magumeri|marte|mobbar|monguno|ngala|nganzai|shani)\b', re.I)),
    ('Gombe', re.compile(r'\b(?:gombe(?:\s+state)?|kaltungo|billiri|akko|balanga|dukku|funakaye|kwami|nafada|shongom|yamaltu)\b', re.I)),
    ('Taraba', re.compile(rf'\b(?:taraba(?:\s+state)?|jalingo|wukari|takum|bali|ardo[-\s]?kola|donga|gashaka|gassol|ibi{_GEO_CTX}|karim\s+lamido|kurmi|lau{_GEO_CTX}|sardauna|ussa|yorro|zing)\b', re.I)),
    ('Yobe', re.compile(r'\b(?:yobe(?:\s+state)?|damaturu|potiskum|nguru|gashua|bade|bursari|fika|fune|geidam|gujba|gulani|jakusko|karasuwa|machina|nangere|tarmuwa|yunusari|yusufari)\b', re.I)),
    ('Jigawa', re.compile(r'\b(?:jigawa(?:\s+state)?|dutse|hadejia|kazaure|gumel|auyo|babura|biriniwa|birnin\s+kudu|buji|gagarawa|garki|gagul|guri|gwaram|gwiwa|jahun|kafin\s+hausa|kaugama|kiri\s*kasama|kiyawa|maigatari|malam\s*madori|miga|ringim|roni|sule\s*tankarkar|taura|yankwashi)\b', re.I)),
    ('Kaduna', re.compile(r'\b(?:kaduna(?:\s+state)?|zaria|kafanchan|birnin\s+gwari|chikun|giwa|igabi|ikara|jaba|jema.?a|kachia|kagarko|kajuru|kaura|kauru|kubau|kudan|lere|makarfi|sabon\s+gari|sanga|soba|zangon\s+kataf)\b', re.I)),
    ('Kano', re.compile(r'\b(?:kano(?:\s+state)?|dambatta|bichi|wudil|garko|rano|sumaila|takai|kibiya|ajingi|albasu|bagwai|bebeji|bunkure|dala|dawakin|doguwa|fagge|gabasawa|garun|gaya|gezawa|gwale|gwarzo|kabo|karaye|kumbotso|kunchi|kura|madobi|makoda|minjibir|nasarawa\s+kano|rimingado|rogo|shanono|tarauni|tofa|tsanyawa|tudun\s+wada|ungogo|warawa)\b', re.I)),
    ('Katsina', re.compile(r'\b(?:katsina(?:\s+state)?|daura|funtua|kankia|malumfashi|bakori|batagarawa|batsari|baure|bindawa|charanchi|dandume|danja|dan\s+musa|dutsi|dutsin[-\s]?ma|faskari|ingawa|jibia|kafur|kaita|kankara|kurfi|kusada|mai.?adua|mani|mashi|matazu|musawa|rimi|sabuwa|safana|sandamu|zango)\b', re.I)),
    ('Kebbi', re.compile(r'\b(?:kebbi(?:\s+state)?|birnin\s+kebbi|argungu|yauri|zuru|aleiro|arewa\s*dandi|augie|bagudo|bunza|dandi|fakai|gwandu|jega|kalgo|koko|besse|maiyama|ngaski|sakaba|shanga|suru|wasagu|danko)\b', re.I)),
    ('Sokoto', re.compile(rf'\b(?:sokoto(?:\s+state)?|binji|bodinga|dange|gada|goronyo|gudu|gwadabawa|illela|isa{_GEO_CTX}|kebbe|kware|rabah|sabon\s+birni|shagari|silame|tambuwal|tangaza|tureta|wamako|wurno|yabo)\b', re.I)),
    ('Zamfara', re.compile(r'\b(?:zamfara(?:\s+state)?|gusau|kaura\s+namoda|talata\s+mafara|anka|bakura|birnin\s+magaji|bukkuyum|bungudu|gummi|maradun|maru|shinkafi|tsafe|zurmi)\b', re.I)),
]

_ALL_STATE_PREFILTER_RE = re.compile(
    '|'.join(rx.pattern for _, rx in STATE_PATTERNS),
    re.I,
)

# Specific FCT Area Councils & infrastructure nodes (versus generic federal Abuja HQ office/travel mentions)
_FCT_LOCAL_INFRA_RE = re.compile(
    r'\b(?:gwagwalada|bwari|kuje|abaji|kwali|amac|kubwa|gwarinpa|nyanya|lugbe|karshi|zuba|karmo|mpape|katampe|gudu|fcda|fcta|area\s+council|satellite\s+town)\b',
    re.I,
)
_HQ_ADMIN_RE = re.compile(
    r'\b(?:nationwide|across\s+the\s+country|36\s+states|all\s+states|headquarters|hqtrs|\bhq\b|federal\s+secretariat|'
    r'air\s+ticket|flight|estacode|\bdta\b|duty\s+tour|hotel|workshop|seminar|conference|retreat|meeting|'
    r'allowance|salary|payroll|overhead|stationery|remittance|withholding\s+tax|\bwht\b|\bvat\b|pension|'
    r'bank\s+charges|protocol|liaison\s+office|rent\s+renewal|fuel|diesel|printing\s+of|training\s+of\s+staff)\b',
    re.I,
)
_NATIONWIDE_ONLY_RE = re.compile(
    r'\b(?:nationwide|across\s+the\s+nation|across\s+the\s+country|across\s+(?:the\s+)?36\s+states|all\s+36\s+states|selected\s+states)\b',
    re.I,
)
_PHYSICAL_INFRA_RE = re.compile(
    r'\b(?:road|bridge|highway|expressway|borehole|water\s+scheme|school|classroom|hospital|clinic|primary\s+health|'
    r'\bphc\b|drainage|erosion|electrification|transformer|solar\s+street|construction\s+of|rehabilitation\s+of|'
    r'renovation\s+of|building|housing|rail|airport|dam|irrigation|canal|market|stadium|health\s+cent(?:re|er))\b',
    re.I,
)

# Short/ambiguous LGA words that commonly appear in non-geographic federal titles
AMBIGUOUS_LGA_WORDS = {
    'abi', 'aba', 'ada', 'ado', 'aga', 'ago', 'ama', 'asa', 'bassa', 'bende', 'boki',
    'brass', 'delta', 'edo', 'ego', 'emu', 'ese', 'etu', 'fo', 'gaya', 'ibeju', 'ido',
    'ife', 'ifo', 'ila', 'imo', 'ira', 'ire', 'isa', 'isu', 'itu', 'iwa', 'iwo',
    'jaba', 'jos', 'karu', 'kisi', 'koko', 'kura', 'lau', 'logo', 'mbo', 'mopa', 'moro',
    'new', 'ngor', 'niger', 'nkanu', 'nsit', 'obi', 'obu', 'oda', 'odo', 'ogo', 'oju',
    'oke', 'okpe', 'ola', 'ona', 'ori', 'oro', 'oru', 'ose', 'ota', 'owo', 'oyi', 'oyo',
    'shell', 'tai', 'toto', 'udu', 'ukwa', 'uwani', 'war', 'wase', 'yala', 'owen', 'iye', 'edu', 'apa', 'ofu', 'ibi', 'ivo',
}


def _load_lga_patterns():
    lga_file = Path(__file__).with_name('nigeria_lgas.json')
    if not lga_file.exists():
        return {}, {}, None, {}
    raw: dict[str, list[str]] = json.loads(lga_file.read_text(encoding='utf-8'))

    per_state_re: dict[str, re.Pattern[str]] = {}
    per_state_lookup: dict[str, dict[str, str]] = {}
    global_terms: list[str] = []
    global_lookup: dict[str, tuple[str, str]] = {}

    for st, lgas in raw.items():
        st_terms: list[str] = []
        st_map: dict[str, str] = {}
        # Longest names first so "Aba North" matches before "Aba"
        for lga in sorted(lgas, key=lambda x: len(x), reverse=True):
            low = lga.strip().lower()
            if not low:
                continue
            tokens = re.split(r'[\s/\-]+', low)
            is_ambig = (low in AMBIGUOUS_LGA_WORDS) or (len(tokens) == 1 and len(low) <= 4)
            esc = re.escape(low)
            if is_ambig:
                st_terms.append(rf'{esc}(?=\s+(?:l\.?g\.?a|local\s+gov))')
            else:
                st_terms.append(esc)
                if len(low) >= 5 and low not in global_lookup:
                    global_terms.append(esc)
                    global_lookup[low] = (st, lga)
            st_map[low] = lga
        if st_terms:
            per_state_re[st] = re.compile(r'\b(?:' + '|'.join(st_terms) + r')\b', re.I)
            per_state_lookup[st] = st_map

    global_re = (
        re.compile(r'\b(?:' + '|'.join(sorted(global_terms, key=len, reverse=True)) + r')\b', re.I)
        if global_terms
        else None
    )
    return per_state_re, per_state_lookup, global_re, global_lookup


STATE_LGA_COMBINED_RE, STATE_LGA_LOOKUP, GLOBAL_LGA_COMBINED_RE, GLOBAL_LGA_LOOKUP = _load_lga_patterns()


class GeoTaxonomy:
    """Maps project titles and institutional agencies to Nigerian Geopolitical Zones, States, and LGAs."""

    @staticmethod
    def _match_lga_in_text(text: str, state: str) -> str:
        rx = STATE_LGA_COMBINED_RE.get(state)
        if not rx or not text:
            return 'Unmapped LGA'
        m = rx.search(text)
        if not m:
            return 'Unmapped LGA'
        return STATE_LGA_LOOKUP[state].get(m.group(0).lower(), 'Unmapped LGA')

    @staticmethod
    @functools.lru_cache(maxsize=65536)
    def _cached_detect_state_lga(text: str) -> tuple[str, str, str]:
        if not text:
            return 'HQ / Direct Federal', 'HQ / Federal Direct', 'Unmapped LGA'

        # 1. Explicit State / Capital match with single combined prefilter
        if _ALL_STATE_PREFILTER_RE.search(text):
            for state, rx in STATE_PATTERNS:
                if rx.search(text):
                    zone = STATES_TO_ZONE.get(state, 'HQ / Direct Federal')
                    lga = GeoTaxonomy._match_lga_in_text(text, state)
                    return zone, state, lga

        # 2. Fallback: explicit unambiguous LGA match via single combined regex
        if GLOBAL_LGA_COMBINED_RE is not None:
            m = GLOBAL_LGA_COMBINED_RE.search(text)
            if m:
                hit = GLOBAL_LGA_LOOKUP.get(m.group(0).lower())
                if hit:
                    st, lga_name = hit
                    zone = STATES_TO_ZONE.get(st, 'HQ / Direct Federal')
                    return zone, st, lga_name

        return 'HQ / Direct Federal', 'HQ / Federal Direct', 'Unmapped LGA'

    @staticmethod
    def detect_state_lga(text: str) -> tuple[str, str, str]:
        return GeoTaxonomy._cached_detect_state_lga(text or '')

    @staticmethod
    def detect_from_record(project_name: str, agency: str = '') -> tuple[str, str, str]:
        """
        Detects Zone/State/LGA prioritizing `project_name` so federal HQ ministry lines
        are not misattributed to FCT Abuja, while preserving state-sited institutions
        (e.g., Federal Polytechnic Bida, University of Maiduguri) when `project_name` lacks a location.
        """
        zone, state, lga = GeoTaxonomy.detect_state_lga(project_name or '')
        if state != 'HQ / Federal Direct':
            return zone, state, lga

        if agency:
            az, ast, alga = GeoTaxonomy.detect_state_lga(agency)
            if ast != 'HQ / Federal Direct' and ast != 'Federal Capital Territory':
                return az, ast, alga

        return 'HQ / Direct Federal', 'HQ / Federal Direct', 'Unmapped LGA'

    @staticmethod
    def detect_execution_location(
        text: str,
        agency: str = '',
        linked_budget_state: str | None = None,
        source_kind: str = 'nocopo',
    ) -> tuple[str, str, str]:
        """
        Resolve NOCOPO contract / GovSpend disbursement state while isolating Nationwide,
        generic Abuja HQ travel/admin/overhead vouchers, and FCT office ops into
        `HQ / Federal Direct`.
        """
        _ = source_kind
        if linked_budget_state and linked_budget_state in STATES_TO_ZONE:
            norm_st = 'Federal Capital Territory' if linked_budget_state == 'FCT Abuja' else linked_budget_state
            return STATES_TO_ZONE[norm_st], norm_st, 'Unmapped LGA'

        raw_text = text or ''
        zone, state, lga = GeoTaxonomy.detect_state_lga(raw_text)

        # Isolate nationwide admin / HQ dispatches unless explicit state capital/infra applies
        if state != 'HQ / Federal Direct' and _NATIONWIDE_ONLY_RE.search(raw_text) and not _PHYSICAL_INFRA_RE.search(raw_text):
            return 'HQ / Direct Federal', 'HQ / Federal Direct', 'Unmapped LGA'

        # Isolate generic Abuja / FCT headquarters travel, hotels, workshops, DTA, payroll, overhead
        if state == 'Federal Capital Territory':
            has_local_fct = bool(_FCT_LOCAL_INFRA_RE.search(raw_text))
            has_physical = bool(_PHYSICAL_INFRA_RE.search(raw_text))
            has_hq_admin = bool(_HQ_ADMIN_RE.search(raw_text))
            if has_local_fct or (has_physical and not has_hq_admin):
                return zone, state, lga
            return 'HQ / Direct Federal', 'HQ / Federal Direct', 'Unmapped LGA'

        if state != 'HQ / Federal Direct':
            return zone, state, lga

        if agency:
            az, ast, alga = GeoTaxonomy.detect_state_lga(agency)
            if ast != 'HQ / Federal Direct' and ast != 'Federal Capital Territory':
                return az, ast, alga

        return 'HQ / Direct Federal', 'HQ / Federal Direct', 'Unmapped LGA'
