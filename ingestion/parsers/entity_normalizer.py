"""Shared entity, administrative code, and ERGP normalization utilities.

Unifies identifiers across BudgetLens Appropriation Schedules, Budget Implementation
Reports (BIR), NOCOPO (BPP OCDS 1.1), and GovSpend Open Treasury disbursement ledgers.
"""

from __future__ import annotations

import re

_NON_ALNUM_SPACE_RE = re.compile(r"[^A-Z0-9\s]+")
_MULTI_SPACE_RE = re.compile(r"\s+")
_MDA_SUFFIX_RE = re.compile(
    r"(?:"
    r"\s*-\s*MOD\s+HQTRS\b|"
    r"\bMOD\s+HQTRS\b|"
    r"\s*-\s*MAIN\s+MOD\b|"
    r"\bMAIN\s+MOD\b|"
    r"\s*-\s*MOD\b|"
    r"\s*-\s*H/?QTRS\b|"
    r"\bH/?QTRS\b|"
    r"\bHQRS\b|"
    r"\bHEADQUARTERS\b"
    r")",
    flags=re.IGNORECASE,
)
_MDA_LEADING_PREFIX_RE = re.compile(
    r"^(?:FEDERAL\s+MINISTRY\s+OF|FED\s+MINISTRY\s+OF|MINISTRY\s+OF|OFFICE\s+OF\s+THE|OFFICE\s+OF)\s+",
    flags=re.IGNORECASE,
)
_TRAILING_CONNECTOR_WORDS_RE = re.compile(r"(?:\s+(?:AND|OF))+$", flags=re.IGNORECASE)
_TRAILING_DISPLAY_PUNCT_RE = re.compile(r"[\s,\-;:/]+$")
_HONORIFIC_KEY_RE = re.compile(r"^(?:M\s+S|MS|MESSRS)\s+", flags=re.IGNORECASE)
_TRAILING_LEGAL_SUFFIX_RE = re.compile(r"(?:\s+(?:LTD|PLC|LLC|INC))+$", flags=re.IGNORECASE)
_NUMERIC_OR_SYMBOL_ONLY_RE = re.compile(r"^[\d\s,.\-₦$€£/%+:;()]+$")
_NOISE_UNIT_PREFIX_RE = re.compile(r"^(?:LOT|KM|PHASE|SECTION|ITEM|PAGE|NO)\s+\d+$")
_ERGP_CODE_RE = re.compile(r"\bERGP[\s-]?(\d{5,12})\b", flags=re.IGNORECASE)
_BPP_CI_RE = re.compile(r"(?:NG-BPP-)?(BPP-CI-\d+)", flags=re.IGNORECASE)

_MOJIBAKE_REPLACEMENTS: tuple[tuple[str, str], ...] = (
    ("\u00c3\u00a2\u00e2\u0082\u00ac\u00e2\u0084\u00a2", "'"),  # Ã¢â‚¬â„¢
    ("\u00c3\u0084\u00c2\u00bb", "'"),  # Ã„Â» (double-encoded Ä»)
    ("\u00c4\u00bb", "'"),  # Ä»
    ("\u00e2\u0080\u0099", "'"),  # â€™
    ("\u00e2\u0080\u0098", "'"),  # â€˜
    ("\u00e2\u0080\u009c", '"'),  # â€œ
    ("\u00e2\u0080\u009d", '"'),  # â€
    ("\u00e2\u0080\u0093", "-"),  # â€“
    ("\u00e2\u0080\u0094", "-"),  # â€”
    ("\u00c2\u00a0", " "),  # Â 
    ("\u00c2 ", " "),
    ("\u00a0", " "),
    ("\u2019", "'"),
    ("\u2018", "'"),
    ("\u201c", '"'),
    ("\u201d", '"'),
    ("\u2013", "-"),
    ("\u2014", "-"),
)

_TYPO_RULES: tuple[tuple[re.Pattern[str], str, str], ...] = (
    (re.compile(r"\bUNIVERSITYOF\b", flags=re.IGNORECASE), "UNIVERSITY OF", "University of"),
    (re.compile(r"\bMANAGEMANT\b", flags=re.IGNORECASE), "MANAGEMENT", "Management"),
    (re.compile(r"\bHEADQU(?:R|A)TERS\b", flags=re.IGNORECASE), "HEADQUARTERS", "Headquarters"),
    (re.compile(r"\bMINSITRY\b", flags=re.IGNORECASE), "MINISTRY", "Ministry"),
)

_INVALID_MDA_EXACT = frozenset(
    {
        "TOTAL",
        "SUBTOTAL",
        "SUB TOTAL",
        "GRAND TOTAL",
        "N A",
        "NA",
        "NONE",
        "NULL",
        "NIL",
        "UNSPECIFIED",
        "UNKNOWN",
        "OTHERS",
        "OTHER",
        "VARIOUS",
        "MISCELLANEOUS",
        "GENERAL",
    }
)

_TRUNCATED_MDA_ALIASES = {
    "DEFENCE MOD": "DEFENCE",
    "SCIENCE TECHNOLOGY": "SCIENCE TECHNOLOGY AND INNOVATION",
    "SCIENCE TECHNOLOGY AND": "SCIENCE TECHNOLOGY AND INNOVATION",
    "HUMANITARIAN AFFAIRS DISASTER MANAGEMENT": "HUMANITARIAN AFFAIRS DISASTER MANAGEMENT AND SOCIAL DEVELOPMENT",
    "HUMANITARIAN AFFAIRS DISASTER MANAGEMENT AND": "HUMANITARIAN AFFAIRS DISASTER MANAGEMENT AND SOCIAL DEVELOPMENT",
    "HUMANITARIAN AFFAIRS DISASTER MANAGEMENT AND SOCIAL": "HUMANITARIAN AFFAIRS DISASTER MANAGEMENT AND SOCIAL DEVELOPMENT",
}

_ENTITY_WORD_MAP = {
    "LIMITED": "LTD",
    "NIGERIA": "NIG",
    "COMPANY": "CO",
    "ENTERPRISES": "ENT",
    "INTERNATIONAL": "INTL",
    "SERVICES": "SVCS",
}


def repair_mojibake(raw: str | None) -> str:
    """Repair common UTF-8/Windows-1252 mojibake sequences and smart punctuation."""
    text = str(raw or "")
    if not text:
        return ""
    for bad, good in _MOJIBAKE_REPLACEMENTS:
        if bad in text:
            text = text.replace(bad, good)
    return text


def repair_entity_typos(text: str) -> str:
    """Fix verified source PDF typos while preserving casing style."""
    out = text
    for pattern, upper_rep, title_rep in _TYPO_RULES:
        def _repl(match: re.Match[str], u: str = upper_rep, t: str = title_rep) -> str:
            token = match.group(0)
            if token.isupper():
                return u
            if token[0].isupper():
                return t
            return u.lower()

        out = pattern.sub(_repl, out)
    return out


def clean_display_name(raw: str | None) -> str:
    """Repair mojibake and verified typos while trimming stray trailing punctuation."""
    text = repair_mojibake(raw).strip()
    if not text:
        return ""
    text = repair_entity_typos(text)
    text = _MULTI_SPACE_RE.sub(" ", text).strip()
    return _TRAILING_DISPLAY_PUNCT_RE.sub("", text).strip()


def _mda_display_score(cleaned: str) -> tuple[int, int]:
    """Rank MDA display labels to prefer full canonical ministry names over truncated variants."""
    up = cleaned.upper()
    score = 0
    if re.search(r"(?:\s+(?:AND|OF)|&)$", up):
        score -= 1000
    if "MOD HQTRS" in up or "H/QTRS" in up:
        score -= 250
    elif "HQTRS" in up or "MAIN MOD" in up or "HQRS" in up:
        score -= 200
    if up.startswith(("FEDERAL MINISTRY OF ", "OFFICE OF THE ")):
        score += 50
    return (score, len(cleaned))


def choose_preferred_mda_display_name(existing: str | None, candidate: str | None) -> str:
    """Select the cleanest, least-truncated display name between two MDA label variants."""
    a = clean_display_name(existing)
    b = clean_display_name(candidate)
    if not a:
        return b
    if not b:
        return a
    return b if _mda_display_score(b) > _mda_display_score(a) else a


def _contractor_display_score(cleaned: str) -> tuple[int, int, int]:
    """Prefer mixed-case, clean legal names over hyphenated or ALL-CAPS aliases."""
    mixed_case = 1 if not cleaned.isupper() else 0
    no_dash_noise = 1 if " - " not in cleaned else 0
    return (mixed_case, no_dash_noise, len(cleaned))


def choose_preferred_contractor_display_name(existing: str | None, candidate: str | None) -> str:
    """Select the cleanest contractor display name between two alias variants."""
    a = clean_display_name(existing)
    b = clean_display_name(candidate)
    if not a:
        return b
    if not b:
        return a
    return b if _contractor_display_score(b) > _contractor_display_score(a) else a


def is_valid_mda_name(raw: str | None) -> bool:
    """Return True if raw string represents a plausible MDA rather than numeric or PDF noise."""
    text = repair_mojibake(raw).strip()
    if not text:
        return False
    if _NUMERIC_OR_SYMBOL_ONLY_RE.match(text):
        return False
    up = _MULTI_SPACE_RE.sub(" ", _NON_ALNUM_SPACE_RE.sub(" ", text.upper())).strip()
    if not up:
        return False
    if sum(1 for ch in up if ch.isalpha()) < 3:
        return False
    if up in _INVALID_MDA_EXACT:
        return False
    if _NOISE_UNIT_PREFIX_RE.match(up):
        return False
    return True


def normalize_admin_code(raw: str | None) -> str:
    """Normalize an MDA administrative code to a canonical 10-digit string when 9-10 digits.

    Examples:
        "NG-BPP-BPP-NOC-517001001" -> "0517001001"
        "145001001"                -> "0145001001"
        "0145001001"               -> "0145001001"
        "12345678"                 -> "12345678"
        "12345"                    -> ""
    """
    text = str(raw or "").strip()
    if not text:
        return ""
    groups = re.findall(r"\d+", text)
    if not groups:
        return ""
    digits = groups[-1]
    if len(digits) < 6:
        longest = max(groups, key=len)
        digits = longest
    if len(digits) < 6:
        return ""
    if len(digits) == 9:
        return digits.zfill(10)
    return digits


def normalize_mda_name(raw: str | None) -> str:
    """Return canonical uppercase MDA name stripped of HQTRS/MOD noise and punctuation."""
    text = repair_mojibake(raw).upper().strip()
    if not text:
        return ""
    text = repair_entity_typos(text)
    text = text.replace("&", " AND ")
    text = _MDA_SUFFIX_RE.sub(" ", text)
    text = re.sub(r"\bFED\.?\s+MIN\.?\s+OF\b", "FEDERAL MINISTRY OF", text)
    text = re.sub(r"\bMIN\.?\s+OF\b", "MINISTRY OF", text)
    text = _NON_ALNUM_SPACE_RE.sub(" ", text)
    text = _MULTI_SPACE_RE.sub(" ", text).strip()
    return _TRAILING_CONNECTOR_WORDS_RE.sub("", text).strip()


def mda_core_key(raw: str | None) -> str:
    """Return canonical uppercase core MDA key with ministry/office prefixes removed."""
    if not is_valid_mda_name(raw):
        return ""
    norm = normalize_mda_name(raw)
    if not norm:
        return ""
    stripped = _MDA_LEADING_PREFIX_RE.sub("", norm).strip()
    core = stripped or norm
    return _TRUNCATED_MDA_ALIASES.get(core, core)


def normalize_entity_name(raw: str | None) -> str:
    """Normalize a contractor or GovSpend beneficiary name for cross-ledger matching."""
    text = repair_mojibake(raw).upper().strip()
    if not text:
        return ""
    text = repair_entity_typos(text)
    text = text.replace("&", " AND ")
    text = _NON_ALNUM_SPACE_RE.sub(" ", text)
    tokens = [_ENTITY_WORD_MAP.get(tok, tok) for tok in text.split()]
    return _MULTI_SPACE_RE.sub(" ", " ".join(tokens)).strip()


def canonical_contractor_key(raw_name: str | None) -> str:
    """Normalize contractor/beneficiary name, stripping leading honorifics and trailing legal forms."""
    norm = normalize_entity_name(raw_name)
    if not norm:
        return ""
    stripped = _HONORIFIC_KEY_RE.sub("", norm).strip() or norm
    without_suffix = _TRAILING_LEGAL_SUFFIX_RE.sub("", stripped).strip()
    if len(without_suffix) >= 4:
        return without_suffix
    return stripped


def contractor_match_key(raw_name: str | None) -> str:
    """Return compact alphanumeric contractor comparison key folding hyphen/spacing variants."""
    key = canonical_contractor_key(raw_name)
    if not key:
        return ""
    compact = _MULTI_SPACE_RE.sub("", key)
    return compact if len(compact) >= 8 else key


def extract_ergp_codes(text: str | None) -> list[str]:
    """Extract unique uppercase ERGP project codes in order of appearance."""
    raw = str(text or "")
    if not raw:
        return []
    seen: set[str] = set()
    codes: list[str] = []
    for digits in _ERGP_CODE_RE.findall(raw):
        code = f"ERGP{digits}"
        if code not in seen:
            seen.add(code)
            codes.append(code)
    return codes


def extract_bpp_contractor_id(raw: str | None) -> str | None:
    """Extract BPP Contractor ID (e.g., BPP-CI-123) without treating it as a CAC RC number."""
    text = str(raw or "").strip()
    if not text:
        return None
    m = _BPP_CI_RE.search(text)
    if not m:
        return None
    return m.group(1).upper()
