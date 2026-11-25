"""Strict-Grounding Multi-Dataset Hybrid RAG AI Query Endpoint (1999-2026).

Feeds across:
  1. SQLite FTS5 all-28-year index (`559,325` rows, 1999-2026)
  2. Statistical Forensics (`statistical_forensics_1999_2026.json`)
  3. Bill vs. Act Padding Diffs (`bill_act_diffs/index.json`)
  4. Execution & Capital Releases (`execution_tracker.json`) + `bir_ocr_fts`
  5. Phase 3 Intelligence: MDA Scorecards, Macro Credibility, Procurement Risk,
     Treasury Cash Forensics, Vendor Capture Network, and Follow-the-Money Links
  6. Disguised-Duplicate & Token-Jaccard Similar-Item Engine
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import time
from collections import defaultdict
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from backend.routers.expenditures import get_external_fts_db_path
from backend.routers.search import FTS_RESERVED, get_fts_db_path, sanitize_fts_query

router = APIRouter(prefix="/api/ai", tags=["ai"])

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATASETS_DIR = PROJECT_ROOT / "public" / "datasets"

STOP_WORDS = {
    "show", "me", "all", "the", "in", "for", "of", "and", "or", "to", "from", "across",
    "compare", "what", "is", "are", "how", "much", "many", "find", "list", "top",
    "highest", "most", "expensive", "budget", "projects", "project", "items", "item",
    "spending", "nigeria", "federal", "year", "years", "between", "under", "above",
    "with", "about", "any", "give", "tell", "can", "you", "there", "these", "those",
    "this", "that", "into", "some", "selected", "various", "different", "areas",
    "communities", "phase", "lot", "batch", "stage", "ongoing", "new",
    "does", "did", "has", "have", "was", "were", "could", "would", "should", "please",
    "contract", "contracts", "contractor", "contractors", "award", "awards", "awarded",
    "payment", "payments", "paid", "company", "firm", "know", "check",
}

INTENT_META_WORDS = {
    "duplicate", "duplicates", "duplicated", "duplication", "similar", "similarity",
    "resemble", "resembling", "related", "repeated", "repeat", "repeats", "recurring",
    "identical", "disguised", "reworded", "rewording", "cluster", "clusters", "ring",
    "rings", "padding", "padded", "insertion", "insertions", "inflated", "benford",
    "mad", "virement", "virements", "premature", "replacement", "lifecycle",
    "execution", "released", "releases", "performance", "anomaly", "anomalies",
    "flagged", "irregularities", "suspicious", "procurement", "cac", "nocopo",
    "govspend", "treasury", "disbursed", "policy", "mtef", "fsp", "mtss", "ogp",
    "ndp", "benchmark", "benchmarks",
    "scorecard", "scorecards", "integrity", "credibility", "overrun", "overruns",
    "competitive", "december", "rush", "threshold", "splitting", "split",
    "captive", "hhi", "herfindahl", "concentration", "zombie", "follow",
    "unpaid", "discrepancy", "discrepancies", "overpaid", "vendor", "vendors",
    "capture", "lifecycle", "oaugf", "auditor", "audit", "queries", "query",
    "unvouched", "unretired", "like", "same", "copy", "paste", "clones", "clone",
}

PRESIDENT_KEYWORDS = {
    "obasanjo": "obasanjo",
    "yaradua": "yaradua",
    "yar'adua": "yaradua",
    "jonathan": "jonathan",
    "buhari": "buhari",
    "tinubu": "tinubu",
}

SYNONYMS: dict[str, str] = {
    "procurement": "buy",
    "purchase": "buy",
    "supply": "buy",
    "provision": "buy",
    "acquisition": "buy",
    "buying": "buy",
    "procuring": "buy",
    "construction": "build",
    "rehabilitation": "build",
    "renovation": "build",
    "upgrading": "build",
    "completion": "build",
    "remodelling": "build",
    "remodeling": "build",
    "repair": "build",
    "refurbishment": "build",
    "installation": "build",
    "erection": "build",
    "equipping": "build",
    "streetlights": "streetlight",
    "lights": "light",
    "vehicles": "vehicle",
    "motorcycles": "motorcycle",
    "tricycles": "tricycle",
    "boreholes": "borehole",
    "classrooms": "classroom",
    "transformers": "transformer",
    "machines": "machine",
    "programmes": "programme",
    "programs": "programme",
    "projects": "project",
    "locations": "location",
    "hospitals": "hospital",
    "clinics": "clinic",
    "roads": "road",
    "bridges": "bridge",
    "schools": "school",
}

MDA_ROLLUP_RE = re.compile(r"^[0-5]\d{8,9}$")
COA_RECURRING_RE = re.compile(r"^(21|22)\d{6}$")
PROJECT_CODE_RE = re.compile(r"\b((?:ERGP|ZIP|P-\d{4}-)[A-Z0-9-]+)\b", re.IGNORECASE)
NAIRA_MENTION_RE = re.compile(
    r"(?:₦|NGN\s*)(\d[\d,]*(?:\.\d+)?)\s*(Trillion|Billion|Million|T|B|M)?",
    re.IGNORECASE,
)
_FILENAME_PAREN_RE = re.compile(
    r"\(\s*[^()\n]*?\b[A-Za-z0-9_./\\-]+\.(?:pdf|json|csv)\b[^()\n]*?\)",
    re.IGNORECASE,
)
_FILENAME_BARE_RE = re.compile(
    r'["\'`]?[A-Za-z0-9_./\\-]*\.(?:pdf|json|csv)\b["\'`]?',
    re.IGNORECASE,
)
_PUBLIC_JARGON_REPLACEMENTS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\bNOCOPO\b", re.IGNORECASE), "public procurement"),
    (re.compile(r"\bGovSpend\b", re.IGNORECASE), "federal treasury"),
    (re.compile(r"\bMTEF/FSP\b", re.IGNORECASE), "fiscal benchmark"),
    (re.compile(r"\bSQL/FTS5\b", re.IGNORECASE), "fiscal index"),
    (re.compile(r"\bBudget Implementation Reports?\b", re.IGNORECASE), "capital execution report"),
)
BOILERPLATE_HINTS = (
    "personnel cost",
    "overhead cost",
    "local travel",
    "international travel",
    "stationeries",
    "stationery",
    "miscellaneous",
    "utilities",
    "electricity charges",
    "water rates",
    "office rent",
    "cleaning & fumigation",
)


class AiQueryRequest(BaseModel):
    question: str = Field(..., min_length=2, max_length=400)
    financialYear: int | None = Field(default=None, ge=1999, le=2030)
    president: str | None = Field(default=None, max_length=32)
    mode: str | None = Field(default=None, max_length=32)
    scope: str | None = Field(default=None, max_length=16)


@lru_cache(maxsize=24)
def _load_dataset_json(filename: str) -> dict[str, Any] | None:
    path = DATASETS_DIR / filename
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _sanitize_public_ai_text(text: str) -> str:
    """Strip internal filenames (.pdf/.json/.csv) and technical dataset jargon from public AI copy."""
    if not text:
        return ""
    out = _FILENAME_PAREN_RE.sub("", text)
    out = _FILENAME_BARE_RE.sub("", out)
    for pat, repl in _PUBLIC_JARGON_REPLACEMENTS:
        out = pat.sub(repl, out)
    cleaned_lines: list[str] = []
    for line in out.splitlines():
        ln = re.sub(r"[ \t]{2,}", " ", line)
        ln = re.sub(r"\s+([,.;:!?])", r"\1", ln).rstrip()
        cleaned_lines.append(ln)
    return "\n".join(cleaned_lines)


def _register_grounded_tokens_from_text(
    text: str,
    allowed_amounts: list[int],
    allowed_codes: set[str],
) -> None:
    """Extract Naira figures and project codes present in retrieved text so grounding verification stays exact."""
    if not text:
        return
    for m in NAIRA_MENTION_RE.finditer(text):
        allowed_amounts.append(abs(int(round(_parse_naira_token(m.group(1), m.group(2) or "")))))
    for m in PROJECT_CODE_RE.finditer(text):
        allowed_codes.add(m.group(1))


def _format_naira_short(amt: int | float) -> str:
    val = int(round(amt))
    if val >= 1_000_000_000_000:
        return f"₦{val / 1e12:.2f} Trillion"
    if val >= 1_000_000_000:
        return f"₦{val / 1e9:.2f} Billion"
    if val >= 1_000_000:
        return f"₦{val / 1e6:.2f} Million"
    return f"₦{val:,}"


def _parse_naira_token(num_str: str, unit_str: str) -> float:
    val = float(num_str.replace(",", ""))
    unit = (unit_str or "").strip().lower()
    if unit.startswith("trillion") or unit == "t":
        return val * 1e12
    if unit.startswith("billion") or unit == "b":
        return val * 1e9
    if unit.startswith("million") or unit == "m":
        return val * 1e6
    return val


def verify_grounded_response(
    answer_text: str,
    allowed_amounts: list[int],
    allowed_codes: set[str],
) -> dict[str, Any]:
    """
    Deterministic Citation & Number Hallucination Gate:
    Extracts every Naira figure and project code from generated prose and rejects/redacts
    any value not mathematically grounded in the retrieved SQL/FTS5/dataset context.
    """
    rejected_figures: list[str] = []
    rejected_codes: list[str] = []
    verified_text = answer_text

    money_pat = NAIRA_MENTION_RE
    for m in money_pat.finditer(answer_text):
        raw_expr = m.group(0)
        parsed_val = _parse_naira_token(m.group(1), m.group(2) or "")
        is_grounded = any(
            (amt == 0 and parsed_val == 0)
            or (amt > 0 and abs(parsed_val - amt) / amt <= 0.02)
            for amt in allowed_amounts
        )
        if not is_grounded:
            rejected_figures.append(raw_expr)
            verified_text = verified_text.replace(raw_expr, "[UNVERIFIED FIGURE REDACTED]")

    norm_allowed = {c.upper() for c in allowed_codes if c}
    for m in PROJECT_CODE_RE.finditer(answer_text):
        code = m.group(1)
        if code.upper() not in norm_allowed:
            rejected_codes.append(code)
            verified_text = verified_text.replace(code, "[UNRETRIEVED CODE REDACTED]")

    return {
        "verifiedText": verified_text,
        "groundingVerified": len(rejected_figures) == 0 and len(rejected_codes) == 0,
        "rejectedFigures": rejected_figures,
        "rejectedCodes": rejected_codes,
    }


def _normalize_tokens(text: str, *, min_len: int = 3) -> list[str]:
    low = (text or "").lower()
    cleaned = re.sub(r"[^a-z0-9\s]", " ", low)
    out: list[str] = []
    for tok in cleaned.split():
        mapped = SYNONYMS.get(tok, tok)
        if mapped in STOP_WORDS or len(mapped) < min_len:
            continue
        out.append(mapped)
    return out


def _build_disguise_key(text: str) -> str:
    low = (text or "").lower()
    sec_tags = sorted({f"sec_{m.lower()}" for m in re.findall(r"\bsection\s+([0-9ivx]+)\b", low)})
    toks = _normalize_tokens(text, min_len=3)
    # Strip generic lead verbs ("build", "buy") when >=3 substantive deliverable tokens remain
    core = [t for t in toks if t not in {"build", "buy"}]
    chosen = core if len(set(core)) >= 3 else toks
    unique_tokens = sorted(set(chosen))[:14]
    if len(unique_tokens) < 3:
        return ""
    return " ".join(unique_tokens + sec_tags)


def _row_to_citation(r: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    return {
        "id": r["id"],
        "code": (r["project_code"] or "ERGP") if "project_code" in r.keys() else "ERGP",
        "title": r["project_name"],
        "amountNaira": int(r["amount_naira"]),
        "amount": _format_naira_short(r["amount_naira"]),
        "page": int(r["pdf_page"]),
        "agency": r["mda_name"],
        "year": int(r["financial_year"]),
        "sector": r["sector"],
        "sourceFilename": r["source_filename"],
        "sha256": r["sha256_hash"],
        "state": r["state"],
        "severity": r["severity"],
    }


def _extract_intent(
    question: str,
    explicit_year: int | None,
    explicit_pres: str | None,
    explicit_mode: str | None,
    explicit_scope: str | None,
) -> dict[str, Any]:
    lower = question.lower()
    years = sorted({int(y) for y in re.findall(r"\b(1999|20[0-2]\d)\b", lower)})
    target_year = (
        None
        if explicit_scope == "all"
        else (explicit_year if explicit_year is not None else (years[0] if len(years) == 1 else None))
    )

    target_pres = explicit_pres.lower() if explicit_pres and explicit_pres.upper() != "ALL" else None
    if not target_pres:
        for kw, canonical in PRESIDENT_KEYWORDS.items():
            if kw in lower:
                target_pres = canonical
                break

    code_matches = [m.group(1) for m in PROJECT_CODE_RE.finditer(question)]

    # Detect investigative mode cleanly
    valid_explicit = {
        "duplicates",
        "similar",
        "padding",
        "forensics",
        "execution",
        "policy",
        "scorecard",
        "procurement_risk",
        "cash_forensics",
        "vendor_capture",
        "follow_money",
        "oaugf_audit",
    }
    if explicit_mode and explicit_mode.lower() in valid_explicit:
        query_mode = explicit_mode.lower()
    elif re.search(r"\b(duplicat\w*|reword\w*|disguis\w*|cross[- ]mda|copy[- ]paste|repeat(?:ed|s|ing)?|clone[ds]?|rings?)\b", lower):
        query_mode = "duplicates"
    elif re.search(r"\b(similar(?:\s+to)?|like\s+|related\s+to|resembl\w*|lookalike)\b", lower):
        query_mode = "similar"
    elif re.search(r"\b(oaugf|auditor[- ]general|audit\s+quer(?:y|ies)|audit\s+findings?|unvouched|unretired\s+advances?|non[- ]compliance\s+report)\b", lower):
        query_mode = "oaugf_audit"
    elif re.search(r"\b(follow\s+the\s+money|padded[- ]to[- ]paid|zombie\s+projects?|paid[- ]on[- ]paper|vendor[- ]switched|project\s+lifecycle|5[- ]stage)\b", lower):
        query_mode = "follow_money"
    elif re.search(r"\b(padd\w*|bill[- ]vs[- ]act|insertions?|inflated|national\s+assembly\s+diff)\b", lower):
        query_mode = "padding"
    elif re.search(r"\b(scorecard|integrity\s+score|mda\s+grade|mda\s+ranking|credibility|promise\s+vs\.?\s+reality|debt\s+service\s+overrun|macro\s+credibility|worst\s+mdas?|best\s+mdas?)\b", lower):
        query_mode = "scorecard"
    elif re.search(r"\b(non[- ]competitive|direct\s+procurement|emergency\s+procurement|selective\s+tendering|variation\s+overrun|cost\s+overrun|contract\s+overrun|zero[- ]paid|unpaid\s+awards?|procurement\s+risk)\b", lower):
        query_mode = "procurement_risk"
    elif re.search(r"\b(december\s+rush|year[- ]end\s+rush|threshold\s+splitting|split\s+payments?|rolling\s+7[- ]day|near[- ]threshold|cash\s+benford|treasury\s+benford|voucher\s+splitting)\b", lower):
        query_mode = "cash_forensics"
    elif re.search(r"\b(vendor\s+capture|captive\s+pair|captive\s+vendor|\bhhi\b|herfindahl|contractor\s+concentration|off[- ]nocopo|off[- ]portal|unlisted\s+vendors?|multi[- ]mda\s+contractor|payout\s+discrepanc\w*|overpaid\s+contractor)\b", lower):
        query_mode = "vendor_capture"
    elif re.search(r"\b(mtef|fsp|mtss|finance\s+act|fiscal\s+strategy|oil\s+price\s+benchmark|macro\s+framework|policy\s+document|open\s+government|ogp)\b", lower):
        query_mode = "policy"
    elif re.search(r"\b(execution|bir\b|capital\s+releas\w*|cash[- ]backed|utiliz\w*|nocopo|procurement|ocds|govspend|open\s+treasury|disburs\w*)\b", lower):
        query_mode = "execution"
    elif re.search(r"\b(benford|\bmad\b|virement\w*|contingency|service[- ]wide|premature|replacement|lifespan)\b", lower):
        query_mode = "forensics"
    else:
        query_mode = "general"

    raw_tokens = re.findall(r"[A-Za-z0-9]+", lower)
    keywords = [
        tok
        for tok in raw_tokens
        if tok not in STOP_WORDS
        and tok not in PRESIDENT_KEYWORDS
        and tok not in INTENT_META_WORDS
        and not re.fullmatch(r"(1999|20[0-2]\d)", tok)
        and len(tok) >= 2
    ]

    return {
        "years": years,
        "targetYear": target_year,
        "targetPresident": target_pres,
        "codeMatches": code_matches,
        "queryMode": query_mode,
        "keywords": keywords,
        "ftsQuery": sanitize_fts_query(" ".join(keywords)),
    }


def _find_duplicate_clusters(
    conn: sqlite3.Connection,
    intent: dict[str, Any],
    forensics_data: dict[str, Any] | None,
) -> dict[str, Any]:
    clauses: list[str] = ["r.amount_naira > 0"]
    params: list[Any] = []
    fts_expr = intent["ftsQuery"]

    if fts_expr:
        clauses.append("budget_fts MATCH ?")
        params.append(fts_expr)
    if intent["targetYear"] is not None:
        clauses.append("r.financial_year = ?")
        params.append(intent["targetYear"])
    elif len(intent["years"]) >= 2:
        placeholders = ",".join("?" for _ in intent["years"])
        clauses.append(f"r.financial_year IN ({placeholders})")
        params.extend(intent["years"])
    if intent["targetPresident"]:
        clauses.append("r.president = ?")
        params.append(intent["targetPresident"])

    where_sql = f"WHERE {' AND '.join(clauses)}"
    join_sql = (
        "FROM budget_fts f JOIN budget_records r ON r.rowid = f.rowid"
        if fts_expr
        else "FROM budget_records r"
    )

    rows = conn.execute(
        f"""
        SELECT r.id, r.financial_year, r.president, r.project_code, r.project_name,
               r.mda_name, r.sector, r.spending_type, r.amount_naira, r.pdf_page,
               r.source_filename, r.sha256_hash, r.state, r.severity
        {join_sql}
        {where_sql}
        ORDER BY r.amount_naira DESC
        LIMIT 12000
        """,
        tuple(params),
    ).fetchall()

    buckets: dict[str, list[sqlite3.Row]] = defaultdict(list)
    for r in rows:
        code = str(r["project_code"] or "").strip()
        if MDA_ROLLUP_RE.match(code) or COA_RECURRING_RE.match(code):
            continue
        title_low = str(r["project_name"] or "").lower()
        if not intent["keywords"] and any(bp in title_low for bp in BOILERPLATE_HINTS):
            continue
        dkey = _build_disguise_key(r["project_name"])
        if not dkey:
            continue
        buckets[dkey].append(r)

    clusters: list[dict[str, Any]] = []
    for idx, (_, items) in enumerate(buckets.items(), 1):
        if len(items) < 2:
            continue
        total_amt = sum(int(i["amount_naira"]) for i in items)
        canonical = min(items, key=lambda x: len(str(x["project_name"])))
        agencies = sorted({str(i["mda_name"] or "").strip() for i in items if i["mda_name"]})
        years = sorted({int(i["financial_year"]) for i in items})
        wordings = {re.sub(r"\s+", " ", str(i["project_name"]).lower().strip()) for i in items}
        is_disguised = len(wordings) > 1
        match_type = "Disguised / Reworded" if is_disguised else "Exact Wording"
        pattern_type = (
            "Disguised Rewording"
            if is_disguised
            else ("Cross-MDA Duplicate" if len(agencies) > 1 else ("Multi-Year Repeat" if len(years) > 1 else "Same-MDA Split"))
        )
        clusters.append(
            {
                "clusterId": f"AI-DUP-{idx:04d}",
                "canonicalTitle": canonical["project_name"],
                "matchType": match_type,
                "patternType": pattern_type,
                "count": len(items),
                "totalAmountNaira": total_amt,
                "totalAmountFormatted": _format_naira_short(total_amt),
                "distinctAgencies": max(1, len(agencies)),
                "agencies": agencies[:5],
                "years": years,
                "items": [_row_to_citation(i) for i in sorted(items, key=lambda x: int(x["amount_naira"]), reverse=True)[:8]],
            }
        )

    # Also incorporate precomputed Cross-MDA Duplicate Rings if matching
    if forensics_data and isinstance(forensics_data.get("byYear"), dict):
        kw_set = {SYNONYMS.get(k, k) for k in intent["keywords"]}
        yr_keys = (
            [str(intent["targetYear"])]
            if intent["targetYear"]
            else sorted(forensics_data["byYear"].keys(), reverse=True)[:6]
        )
        seen_titles = {str(c["canonicalTitle"]).lower()[:60] for c in clusters}
        for yk in yr_keys:
            yr_block = forensics_data["byYear"].get(yk, {})
            for ring in (yr_block.get("duplicateRings") or {}).get("topRings", []):
                title = str(ring.get("normalizedTitle") or "")
                if not title or title.lower()[:60] in seen_titles:
                    continue
                if kw_set and not any(k in title.lower() for k in kw_set):
                    continue
                sample_items = [
                    {
                        "id": s.get("id", ""),
                        "code": s.get("projectCode") or "ERGP",
                        "title": s.get("projectName") or title,
                        "amountNaira": int(s.get("amount", 0)),
                        "amount": _format_naira_short(int(s.get("amount", 0))),
                        "page": int(s.get("page", 1)),
                        "agency": s.get("agency", "Federal MDA"),
                        "year": int(s.get("financialYear", int(yk))),
                        "sector": "Precomputed Ring",
                        "sourceFilename": s.get("sourceFilename", ""),
                    }
                    for s in ring.get("sampleRecords", [])[:6]
                ]
                if len(sample_items) >= 2:
                    seen_titles.add(title.lower()[:60])
                    clusters.append(
                        {
                            "clusterId": ring.get("clusterId", f"RING-{yk}"),
                            "canonicalTitle": title.title(),
                            "matchType": "Cross-MDA Precomputed Ring",
                            "patternType": "Cross-MDA Duplicate" if ring.get("isCrossMda") else "Same-MDA Split",
                            "count": int(ring.get("itemCount", len(sample_items))),
                            "totalAmountNaira": int(ring.get("totalNaira", 0)),
                            "totalAmountFormatted": ring.get("totalNairaFormatted") or _format_naira_short(ring.get("totalNaira", 0)),
                            "distinctAgencies": len(ring.get("mdasInvolved") or []),
                            "agencies": (ring.get("mdasInvolved") or [])[:5],
                            "years": [int(yk)],
                            "items": sample_items,
                        }
                    )

    clusters.sort(key=lambda c: (c["totalAmountNaira"], c["count"]), reverse=True)
    top_clusters = clusters[:8]
    citations: list[dict[str, Any]] = []
    for cl in top_clusters[:4]:
        for item in cl["items"][:3]:
            citations.append(item)

    return {
        "scannedRows": len(rows),
        "totalClusters": len(clusters),
        "totalClusterExposureNaira": sum(c["totalAmountNaira"] for c in top_clusters),
        "duplicateClusters": top_clusters,
        "citations": citations[:12],
    }


def _find_similar_items(conn: sqlite3.Connection, intent: dict[str, Any], raw_question: str) -> dict[str, Any]:
    anchor_row: sqlite3.Row | None = None
    for code in intent["codeMatches"]:
        anchor_row = conn.execute(
            """
            SELECT id, financial_year, president, project_code, project_name, mda_name,
                   sector, spending_type, amount_naira, pdf_page, source_filename,
                   sha256_hash, state, severity
            FROM budget_records
            WHERE UPPER(project_code) = UPPER(?) OR UPPER(id) = UPPER(?)
            ORDER BY financial_year DESC LIMIT 1
            """,
            (code, code),
        ).fetchone()
        if anchor_row:
            break

    anchor_title = str(anchor_row["project_name"]) if anchor_row else raw_question
    anchor_tokens = set(_normalize_tokens(anchor_title, min_len=3)) - INTENT_META_WORDS
    if not anchor_tokens:
        anchor_tokens = {SYNONYMS.get(k, k) for k in intent["keywords"]}

    # Build OR FTS5 query across the anchor's distinctive tokens so partial rewordings are found
    raw_query_terms = [
        tok
        for tok in re.findall(r"[A-Za-z0-9]+", anchor_title)
        if tok.lower() not in STOP_WORDS
        and tok.lower() not in INTENT_META_WORDS
        and tok.upper() not in FTS_RESERVED
        and not re.fullmatch(r"(1999|20[0-2]\d)", tok)
        and len(tok) >= 3
    ]
    # Include both original terms and mapped synonyms in OR expression (up to 6 terms)
    or_terms: list[str] = []
    for t in raw_query_terms:
        low = t.lower()
        if low not in or_terms:
            or_terms.append(low)
        mapped = SYNONYMS.get(low)
        if mapped and mapped not in or_terms:
            or_terms.append(mapped)
        if len(or_terms) >= 6:
            break

    fts_or_expr = " OR ".join(f'"{t}"*' for t in or_terms)
    clauses: list[str] = []
    params: list[Any] = []
    if fts_or_expr:
        clauses.append("budget_fts MATCH ?")
        params.append(fts_or_expr)
    if intent["targetYear"] is not None:
        clauses.append("r.financial_year = ?")
        params.append(intent["targetYear"])
    if intent["targetPresident"]:
        clauses.append("r.president = ?")
        params.append(intent["targetPresident"])

    where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    join_sql = (
        "FROM budget_fts f JOIN budget_records r ON r.rowid = f.rowid"
        if fts_or_expr
        else "FROM budget_records r"
    )

    candidates = conn.execute(
        f"""
        SELECT r.id, r.financial_year, r.president, r.project_code, r.project_name,
               r.mda_name, r.sector, r.spending_type, r.amount_naira, r.pdf_page,
               r.source_filename, r.sha256_hash, r.state, r.severity
        {join_sql}
        {where_sql}
        ORDER BY r.amount_naira DESC
        LIMIT 800
        """,
        tuple(params),
    ).fetchall()

    scored: list[tuple[int, dict[str, Any]]] = []
    anchor_sector = str(anchor_row["sector"]).lower() if anchor_row else ""
    anchor_mda = str(anchor_row["mda_name"]).lower() if anchor_row else ""
    for r in candidates:
        if anchor_row and r["id"] == anchor_row["id"]:
            continue
        cand_tokens = set(_normalize_tokens(str(r["project_name"]), min_len=3))
        if not cand_tokens or not anchor_tokens:
            continue
        shared = sorted(anchor_tokens & cand_tokens)
        if not shared:
            continue
        union = anchor_tokens | cand_tokens
        jaccard = len(shared) / max(1, len(union))
        coverage = len(shared) / max(1, len(anchor_tokens))
        affinity = 0.0
        if anchor_sector and str(r["sector"]).lower() == anchor_sector:
            affinity += 0.08
        if anchor_mda and str(r["mda_name"]).lower() == anchor_mda:
            affinity += 0.08
        sim_pct = min(99, max(18, int(round((0.55 * coverage + 0.45 * jaccard + affinity) * 100))))
        cit = _row_to_citation(r)
        cit["similarityPct"] = sim_pct
        cit["sharedTokens"] = shared[:6]
        scored.append((sim_pct * 1_000_000_000 + min(int(r["amount_naira"]), 999_999_999), cit))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    similar_items = [pair[1] for pair in scored[:12]]
    return {
        "anchor": _row_to_citation(anchor_row) if anchor_row else None,
        "similarItems": similar_items,
        "citations": similar_items,
        "totalExposureNaira": sum(int(i["amountNaira"]) for i in similar_items),
    }


def _collect_external_ledger_context(
    intent: dict[str, Any],
    policy_data: dict[str, Any] | None,
) -> dict[str, Any]:
    """Retrieve page-grounded policy chunks, MTEF benchmarks, NOCOPO contracts, and GovSpend payments."""
    lines: list[str] = []
    allowed_amounts: list[int] = []
    allowed_codes: set[str] = set()
    policy_citations: list[dict[str, Any]] = []
    mode = intent["queryMode"]
    target_year = intent["targetYear"]
    fts_expr = intent["ftsQuery"]

    if policy_data and mode in {"policy", "general", "execution"}:
        benches = policy_data.get("macroBenchmarks", [])
        picked_benches = [b for b in benches if target_year is None or b.get("financialYear") == target_year] or benches
        if mode == "policy" and picked_benches:
            lines.append("Key Economic Benchmarks:")
            for b in picked_benches[:4]:
                parts = []
                if b.get("oilPriceUsdPerBbl") is not None:
                    parts.append(f"Oil ${b['oilPriceUsdPerBbl']}/bbl")
                if b.get("oilProductionMbpd") is not None:
                    parts.append(f"Output {b['oilProductionMbpd']} mbpd")
                if b.get("exchangeRateNairaPerUsd") is not None:
                    fx_val = float(b["exchangeRateNairaPerUsd"])
                    allowed_amounts.append(int(round(fx_val)))
                    parts.append(f"FX ₦{b['exchangeRateNairaPerUsd']}/$")
                if b.get("gdpGrowthPct") is not None:
                    parts.append(f"GDP {b['gdpGrowthPct']}%")
                if parts:
                    lines.append(
                        f"• {b.get('financialYear') or 'Multi-Year'}: "
                        + " | ".join(parts)
                    )

    ext_db = get_external_fts_db_path()
    policy_fts_ready = False
    bir_ocr_ready = False
    oaugf_fts_ready = False
    nocopo_ready = False
    govspend_ready = False

    if ext_db.exists():
        ext_conn = sqlite3.connect(str(ext_db))
        ext_conn.row_factory = sqlite3.Row
        try:
            tables = {
                r["name"]
                for r in ext_conn.execute("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')").fetchall()
            }
            if "policy_fts" in tables and "policy_chunks" in tables:
                policy_fts_ready = True
                if mode in {"policy", "general"}:
                    p_where: list[str] = []
                    p_params: list[Any] = []
                    if fts_expr:
                        p_where.append("policy_fts MATCH ?")
                        p_params.append(fts_expr)
                    if target_year is not None:
                        p_where.append("(c.fiscal_year_start <= ? AND COALESCE(c.fiscal_year_end, c.fiscal_year_start) >= ?)")
                        p_params.extend([target_year, target_year])
                    if p_where or mode == "policy":
                        p_join = (
                            "FROM policy_fts f JOIN policy_chunks c ON c.id = f.rowid"
                            if fts_expr
                            else "FROM policy_chunks c"
                        )
                        p_sql_where = f"WHERE {' AND '.join(p_where)}" if p_where else ""
                        p_rows = ext_conn.execute(
                            f"""
                            SELECT c.doc_slug, c.doc_title, c.doc_type, c.fiscal_year_start,
                                   c.fiscal_year_end, c.page_number, c.sha256, c.chunk_text
                            {p_join}
                            {p_sql_where}
                            LIMIT 5
                            """,
                            tuple(p_params),
                        ).fetchall()
                        if p_rows and mode == "policy":
                            lines.append("Relevant Policy Guidance:")
                        for pr in p_rows:
                            clean_raw = _sanitize_public_ai_text(str(pr["chunk_text"])[:400]).replace("\n", " ").strip()
                            snippet = clean_raw[:240].rsplit(" ", 1)[0] if len(clean_raw) > 240 else clean_raw
                            policy_citations.append({
                                "docSlug": pr["doc_slug"],
                                "docTitle": pr["doc_title"],
                                "docType": pr["doc_type"],
                                "fiscalYearStart": pr["fiscal_year_start"],
                                "fiscalYearEnd": pr["fiscal_year_end"],
                                "page": int(pr["page_number"]),
                                "sha256": pr["sha256"],
                                "snippet": snippet,
                            })
                            if mode == "policy" and snippet:
                                _register_grounded_tokens_from_text(snippet, allowed_amounts, allowed_codes)
                                lines.append(f'• "{snippet}..."')

            if "bir_ocr_fts" in tables and "bir_ocr_chunks" in tables:
                bir_ocr_ready = True
                if mode in {"execution", "scorecard", "policy", "general"} and (
                    fts_expr or (mode == "execution" and target_year is not None)
                ):
                    b_where: list[str] = []
                    b_params: list[Any] = []
                    if fts_expr:
                        b_where.append("bir_ocr_fts MATCH ?")
                        b_params.append(fts_expr)
                    if target_year is not None:
                        b_where.append("c.financial_year = ?")
                        b_params.append(target_year)
                    b_join = (
                        "FROM bir_ocr_fts f JOIN bir_ocr_chunks c ON c.id = f.rowid"
                        if fts_expr
                        else "FROM bir_ocr_chunks c"
                    )
                    b_sql_where = f"WHERE {' AND '.join(b_where)}" if b_where else ""
                    b_rows = ext_conn.execute(
                        f"""
                        SELECT c.financial_year, c.page_number, c.chunk_text
                        {b_join}
                        {b_sql_where}
                        LIMIT 3
                        """,
                        tuple(b_params),
                    ).fetchall()
                    if b_rows and mode in {"execution", "scorecard"}:
                        bir_lines: list[str] = []
                        for br in b_rows:
                            clean_raw = _sanitize_public_ai_text(str(br["chunk_text"])[:400]).replace("\n", " ").strip()
                            clean_snip = clean_raw[:240].rsplit(" ", 1)[0] if len(clean_raw) > 240 else clean_raw
                            if not clean_snip:
                                continue
                            _register_grounded_tokens_from_text(clean_snip, allowed_amounts, allowed_codes)
                            bir_lines.append(
                                f'• FY {int(br["financial_year"])} (p.{int(br["page_number"])}): "{clean_snip}..."'
                            )
                        if bir_lines:
                            lines.append("Capital Execution Report Excerpts:")
                            lines.extend(bir_lines)

            if "oaugf_fts" in tables and "oaugf_chunks" in tables:
                oaugf_fts_ready = True
                if mode in {"oaugf_audit", "scorecard", "general"} and (
                    fts_expr or (mode == "oaugf_audit" and target_year is not None)
                ):
                    o_where: list[str] = []
                    o_params: list[Any] = []
                    if fts_expr:
                        o_where.append("oaugf_fts MATCH ?")
                        o_params.append(fts_expr)
                    if target_year is not None:
                        o_where.append("c.primary_year = ?")
                        o_params.append(target_year)
                    o_join = (
                        "FROM oaugf_fts f JOIN oaugf_chunks c ON c.id = f.rowid"
                        if fts_expr
                        else "FROM oaugf_chunks c"
                    )
                    o_sql_where = f"WHERE {' AND '.join(o_where)}" if o_where else ""
                    o_rows = ext_conn.execute(
                        f"""
                        SELECT c.doc_title, c.primary_year, c.page_number, c.chunk_text
                        {o_join}
                        {o_sql_where}
                        LIMIT 3
                        """,
                        tuple(o_params),
                    ).fetchall()
                    if o_rows and mode == "oaugf_audit":
                        o_lines: list[str] = []
                        for orow in o_rows:
                            clean_raw = _sanitize_public_ai_text(str(orow["chunk_text"])[:400]).replace("\n", " ").strip()
                            clean_snip = clean_raw[:220].rsplit(" ", 1)[0] if len(clean_raw) > 220 else clean_raw
                            if not clean_snip:
                                continue
                            _register_grounded_tokens_from_text(clean_snip, allowed_amounts, allowed_codes)
                            yr_lbl = f"FY {int(orow['primary_year'])}" if orow["primary_year"] else "Audit Report"
                            o_lines.append(
                                f'• {orow["doc_title"]} ({yr_lbl}, p.{int(orow["page_number"])}): "{clean_snip}..."'
                            )
                        if o_lines:
                            lines.append("Official Auditor-General Report Excerpts:")
                            lines.extend(o_lines)

            if "nocopo_contracts" in tables:
                nocopo_ready = True
                if mode in {"execution", "general"} and fts_expr and "nocopo_fts" in tables:
                    n_rows = ext_conn.execute(
                        """
                        SELECT c.ocid, c.project_code, c.title, c.contractor_name, c.mda_name,
                               c.contract_award_naira, c.total_paid_naira
                        FROM nocopo_fts f
                        JOIN nocopo_contracts c ON c.rowid = f.rowid
                        WHERE nocopo_fts MATCH ?
                          AND LOWER(COALESCE(c.stage, '')) IN ('award', 'contract', 'implementation')
                        ORDER BY c.contract_award_naira DESC
                        LIMIT 3
                        """,
                        (fts_expr,),
                    ).fetchall()
                    if n_rows:
                        lines.append("Contract Awards:")
                        for nr in n_rows:
                            aw = abs(int(nr["contract_award_naira"] or 0))
                            pd = abs(int(nr["total_paid_naira"] or 0))
                            allowed_amounts.extend([aw, pd])
                            if nr["project_code"]:
                                allowed_codes.add(str(nr["project_code"]))
                            contractor_txt = str(nr["contractor_name"] or "Verified Contractor")
                            mda_txt = str(nr["mda_name"] or "Federal MDA")
                            _register_grounded_tokens_from_text(f"{contractor_txt} {mda_txt}", allowed_amounts, allowed_codes)
                            lines.append(
                                f"• {contractor_txt} — "
                                f"Awarded {_format_naira_short(aw)}, Paid {_format_naira_short(pd)} ({mda_txt})"
                            )

            if "govspend_payments" in tables:
                govspend_ready = True
                if mode in {"execution", "general"} and fts_expr and "govspend_fts" in tables:
                    g_rows = ext_conn.execute(
                        """
                        SELECT p.payment_date, p.organization_name, p.beneficiary_name, p.amount_naira
                        FROM govspend_fts f
                        JOIN govspend_payments p ON p.rowid = f.rowid
                        WHERE govspend_fts MATCH ?
                        ORDER BY p.amount_naira DESC
                        LIMIT 3
                        """,
                        (fts_expr,),
                    ).fetchall()
                    if g_rows:
                        lines.append("Treasury Payments:")
                        for gr in g_rows:
                            amt = abs(int(gr["amount_naira"] or 0))
                            allowed_amounts.append(amt)
                            ben_txt = str(gr["beneficiary_name"] or "Verified Payee")
                            org_txt = str(gr["organization_name"] or "Federal Treasury")
                            _register_grounded_tokens_from_text(f"{ben_txt} {org_txt}", allowed_amounts, allowed_codes)
                            lines.append(
                                f"• {gr['payment_date']} — {ben_txt} via {org_txt}: {_format_naira_short(amt)}"
                            )
        finally:
            ext_conn.close()

    return {
        "lines": lines,
        "allowedAmounts": allowed_amounts,
        "allowedCodes": allowed_codes,
        "policyCitations": policy_citations,
        "policyBenchmarksLoaded": policy_data is not None,
        "policyFtsReady": policy_fts_ready,
        "birOcrFtsReady": bir_ocr_ready,
        "oaugfFtsReady": oaugf_fts_ready,
        "nocopoReady": nocopo_ready,
        "govspendReady": govspend_ready,
    }


def _collect_supplemental_briefs(
    intent: dict[str, Any],
    forensics_data: dict[str, Any] | None,
    padding_data: dict[str, Any] | None,
    execution_data: dict[str, Any] | None,
) -> dict[str, Any]:
    lines: list[str] = []
    allowed_amounts: list[int] = []
    mode = intent["queryMode"]
    target_year = intent["targetYear"]

    if padding_data and mode in {"padding", "general"}:
        cycles = padding_data.get("cycles", [])
        picked = [c for c in cycles if target_year is None or c.get("financialYear") == target_year] or cycles
        if mode == "padding" and picked:
            lines.append("Budget Changes Summary:")
            for c in picked[:4]:
                ins = int(c.get("insertionsTotalNaira", 0))
                inf = int(c.get("inflatedTotalNaira", 0))
                cut = int(c.get("cutTotalNaira", 0))
                act_t = int(c.get("actTotalNaira", 0))
                allowed_amounts.extend([ins, inf, cut, act_t])
                lines.append(
                    f"• {c['financialYear']}: Final Budget {_format_naira_short(act_t)} | "
                    f"New Additions {c['insertionsCount']:,} ({_format_naira_short(ins)}) | "
                    f"Increases {c['inflatedCount']:,} ({_format_naira_short(inf)}) | Reductions {c['cutCount']:,} ({_format_naira_short(cut)})"
                )

    if forensics_data and mode in {"forensics", "general"}:
        summary = forensics_data.get("summary", {})
        if mode == "forensics" and summary:
            vir_exp = int(summary.get("totalVirementExposureNaira", 0))
            allowed_amounts.append(vir_exp)
            lines.append(
                f"Spending Pattern Summary: {summary.get('totalRecordsAnalyzed', 0):,} line items analyzed across 28 years — "
                f"{summary.get('nonConformingYearsCount', 0)} digit-pattern anomalies, "
                f"{summary.get('totalPrematureAlerts', 0):,} early-replacement alerts, "
                f"{summary.get('totalCrossMdaRings', 0):,} cross-ministry duplicate clusters, "
                f"and {_format_naira_short(vir_exp)} in service-wide transfers."
            )
            alerts = forensics_data.get("prematureReplacementAlerts", [])
            for a in alerts[:3]:
                amt = int(a.get("totalSpentNaira", 0))
                allowed_amounts.append(amt)
                lines.append(
                    f"• Replacement Alert: {a.get('mdaName')} ({a.get('assetCategoryLabel')}) — "
                    f"{a.get('recentAllocationsCount')} acquisitions totaling {_format_naira_short(amt)} over {len(a.get('yearsActive', []))} cycles."
                )

    if execution_data and mode in {"execution", "general"}:
        yrs = execution_data.get("years", [])
        picked = [y for y in yrs if target_year is None or y.get("financialYear") == target_year] or yrs
        if mode == "execution" and picked:
            lines.append("Capital Budget Releases:")
            for y in picked[:3]:
                app_amt = int(y.get("totalAppropriatedNaira", 0) or 0)
                rel_amt = int(y.get("totalReleasedNaira", 0) or 0)
                allowed_amounts.extend([app_amt, rel_amt])
                lines.append(
                    f"• {y['financialYear']} ({y.get('mdaCount', 0):,} ministries/agencies): Budgeted {_format_naira_short(app_amt)} vs. "
                    f"Released {_format_naira_short(rel_amt)} ({y.get('overallReleasePct', 0)}% execution rate)."
                )

    return {
        "lines": lines,
        "allowedAmounts": allowed_amounts,
        "forensicsLoaded": forensics_data is not None,
        "paddingLoaded": padding_data is not None,
        "executionLoaded": execution_data is not None,
    }


def _collect_phase3_briefs(
    intent: dict[str, Any],
    phase3: dict[str, dict[str, Any] | None],
) -> dict[str, Any]:
    """Build strict-grounding briefs from Phase 3 precomputed intelligence datasets."""
    lines: list[str] = []
    allowed_amounts: list[int] = []
    allowed_codes: set[str] = set()
    mode = intent["queryMode"]
    target_year = intent["targetYear"]
    keywords = [k.lower() for k in intent.get("keywords", []) if len(k) >= 3]

    sc_data = phase3.get("mdaScorecards")
    mc_data = phase3.get("macroCredibility")
    pr_data = phase3.get("procurementRisk")
    gf_data = phase3.get("govspendForensics")
    vn_data = phase3.get("vendorNetwork")
    ftm_data = phase3.get("followTheMoney")
    oa_data = phase3.get("oaugfAudit")
    conv_data = phase3.get("redFlagConvergence")

    def _matches_keywords(text: str) -> bool:
        if not keywords:
            return False
        low = (text or "").lower()
        return any(kw in low for kw in keywords)

    def _clip_words(text: str, limit: int = 110) -> str:
        clean = " ".join(str(text or "").split())
        if len(clean) <= limit:
            return clean
        return clean[:limit].rsplit(" ", 1)[0]

    if mode == "scorecard":
        if sc_data and sc_data.get("mdas"):
            head = sc_data.get("headline", {})
            mdas = list(sc_data.get("mdas", []))
            lines.append(
                f"MDA Integrity Scorecards: {int(head.get('totalScoredMdas', len(mdas))):,} scored ministries/agencies "
                f"({int(head.get('full5PillarCount', 0)):,} with all 5 pillars, median score {head.get('medianCompositeScore', 0)}/100)."
            )
            matched = [m for m in mdas if _matches_keywords(str(m.get("mdaName", "")))]
            if matched:
                picked = matched[:4]
            else:
                five_p = [m for m in mdas if int(m.get("metricsPresent", 0)) >= 5] or mdas
                picked = five_p[:2] + (five_p[-2:] if len(five_p) >= 4 else [])
            for m in picked:
                exp = abs(int(m.get("totalTrackedExposureNaira") or 0))
                allowed_amounts.append(exp)
                mda_name = str(m.get("mdaName", ""))
                _register_grounded_tokens_from_text(mda_name, allowed_amounts, allowed_codes)
                lines.append(
                    f"• Rank #{m.get('rank')} {mda_name} — Score {m.get('compositeScore')}/100 "
                    f"(Grade {m.get('grade')}, {m.get('metricsPresent')}/5 pillars, exposure {_format_naira_short(exp)})."
                )
        if mc_data and mc_data.get("headline"):
            mh = mc_data["headline"]
            cum_overrun = abs(int(mh.get("cumulativeDebtServiceOverrunNaira") or 0))
            allowed_amounts.append(cum_overrun)
            lines.append(
                f"Promise vs. Reality ({mh.get('yearRange', '2009–2026')}, {int(mh.get('birYearsCount', 0))} fiscal years): "
                f"mean capital execution {mh.get('meanCapitalPerformancePct', 0)}%, mean revenue realization {mh.get('meanRevenuePerformancePct', 0)}%, "
                f"mean debt service {mh.get('meanDebtServicePerformancePct', 0)}% "
                f"({int(mh.get('debtServiceOverrunYearsCount', 0))} overrun years totaling {_format_naira_short(cum_overrun)} above budget)."
            )
            series = mc_data.get("yearlySeries", [])
            picked_yr = next((y for y in series if target_year and y.get("financialYear") == target_year), None)
            if picked_yr and isinstance(picked_yr.get("bir"), dict):
                bir = picked_yr["bir"]
                parts: list[str] = []
                if bir.get("capitalPerformancePct") is not None:
                    parts.append(f"capital execution {bir['capitalPerformancePct']}%")
                if bir.get("revenuePerformancePct") is not None:
                    parts.append(f"revenue {bir['revenuePerformancePct']}%")
                if bir.get("debtServicePerformancePct") is not None:
                    parts.append(f"debt service {bir['debtServicePerformancePct']}%")
                overrun_val = bir.get("debtServiceOverrunNaira")
                if isinstance(overrun_val, (int, float)) and overrun_val > 0:
                    ov_int = abs(int(round(overrun_val)))
                    allowed_amounts.append(ov_int)
                    parts.append(f"debt overrun {_format_naira_short(ov_int)}")
                if parts:
                    lines.append(
                        f"• FY {picked_yr['financialYear']} ({picked_yr.get('presidentName', '')}): " + " | ".join(parts) + "."
                    )

    elif mode == "procurement_risk" and pr_data:
        ph = pr_data.get("headline", {})
        tot_aw = abs(int(ph.get("totalAwardedNaira") or 0))
        nc_aw = abs(int(ph.get("nonCompetitiveAwardedNaira") or 0))
        ov_delta = abs(int(ph.get("overrunDeltaNaira") or 0))
        zp_aw = abs(int(ph.get("zeroPaidAwardedNaira") or 0))
        allowed_amounts.extend([tot_aw, nc_aw, ov_delta, zp_aw])
        lines.append(
            f"Procurement Risk Audit ({int(ph.get('totalAwardedRows', 0)):,} awarded contracts totaling {_format_naira_short(tot_aw)}; "
            f"{int(ph.get('planningExcludedCount', 0)):,} uncontracted planning entries excluded):"
        )
        lines.append(
            f"• Non-competitive awards: {int(ph.get('nonCompetitiveCount', 0)):,} contracts ({_format_naira_short(nc_aw)}, "
            f"{ph.get('nonCompetitiveValueSharePct', 0)}% of awarded value)."
        )
        lines.append(
            f"• Payment overruns & zero-paid awards: {int(ph.get('overrunCount', 0)):,} over-disbursed contracts (+{_format_naira_short(ov_delta)} above award) | "
            f"{int(ph.get('zeroPaidCount', 0)):,} unpaid awards ({_format_naira_short(zp_aw)})."
        )
        overruns = pr_data.get("topOverrunContracts", [])
        non_comp = pr_data.get("topNonCompetitiveAwards", [])
        pool = overruns if any(k in {"overrun", "overruns", "cost", "variation"} for k in keywords) or overruns else non_comp
        matched = [item for item in pool if _matches_keywords(f"{item.get('title', '')} {item.get('mdaName', '')} {item.get('contractorName', '')}")]
        for item in (matched or pool)[:2]:
            aw = abs(int(item.get("awardNaira") or 0))
            pd = abs(int(item.get("paidNaira") or 0))
            allowed_amounts.extend([aw, pd])
            if item.get("projectCode"):
                allowed_codes.add(str(item["projectCode"]))
            title = _clip_words(str(item.get("title") or "Contract Award"), 95)
            mda = str(item.get("mdaName") or "Federal MDA")
            vendor = str(item.get("contractorName") or "Contractor")
            _register_grounded_tokens_from_text(f"{title} {mda} {vendor}", allowed_amounts, allowed_codes)
            lines.append(
                f"• {item.get('financialYear') or ''} — {vendor} via {mda}: "
                f"Awarded {_format_naira_short(aw)}, Paid {_format_naira_short(pd)} ({title})."
            )

    elif mode == "cash_forensics" and gf_data:
        gh = gf_data.get("headline", {})
        tot_cash = abs(int(gh.get("totalNaira") or 0))
        dec_cash = abs(int(gh.get("december2019To2025Naira") or 0))
        thresh_cash = abs(int(gh.get("nearThresholdNaira") or 0))
        roll_cash = abs(int(gh.get("rolling7DayClusterNaira") or 0))
        allowed_amounts.extend([tot_cash, dec_cash, thresh_cash, roll_cash])
        lines.append(
            f"Federal Treasury Cash Forensics ({int(gh.get('totalVouchers', 0)):,} payment vouchers totaling {_format_naira_short(tot_cash)}):"
        )
        lines.append(
            f"• December Surge (2019–2025): {int(gh.get('december2019To2025Vouchers', 0)):,} December vouchers totaling {_format_naira_short(dec_cash)} "
            f"({gh.get('decemberRushRatio2019To2025', 0)}x average monthly run rate)."
        )
        lines.append(
            f"• Threshold Splitting & Cash Benford: {int(gh.get('nearThresholdVoucherCount', 0)):,} near-threshold payments ({_format_naira_short(thresh_cash)}), "
            f"{int(gh.get('rolling7DayClusterCount', 0)):,} 7-day rolling clusters ({_format_naira_short(roll_cash)}), "
            f"1D Benford MAD {gh.get('benford1DMad', 0)} ({gh.get('benford1DBand', '')})."
        )
        top_dec = (gf_data.get("decemberRush") or {}).get("topDecemberRushMdas", [])[:2]
        for row in top_dec:
            damt = abs(int(row.get("decemberNaira") or 0))
            allowed_amounts.append(damt)
            org = str(row.get("organizationName") or "")
            _register_grounded_tokens_from_text(org, allowed_amounts, allowed_codes)
            lines.append(
                f"• Top December Surge MDA: {org} — {_format_naira_short(damt)} in December "
                f"({row.get('decemberSharePct', 0)}% share, {row.get('decemberRushRatio', 0)}x surge)."
            )
        disc_audit = gf_data.get("discretionaryAndOpaqueAudit") or {}
        if disc_audit.get("totalFlaggedNaira"):
            d_tot = abs(int(disc_audit.get("totalFlaggedNaira") or 0))
            allowed_amounts.append(d_tot)
            lines.append(
                f"• Opaque & Discretionary Cash: {int(disc_audit.get('totalFlaggedVouchers', 0)):,} vouchers totaling {_format_naira_short(d_tot)} "
                "(including blank descriptions, personal advances/imprest, SUVs, estacode, and welfare)."
            )

    elif mode == "vendor_capture" and vn_data:
        vh = vn_data.get("headline", {})
        cap_aw = abs(int(vh.get("captivePairAwardedNaira") or 0))
        over_paid = abs(int(vh.get("overpaid125GovspendPaidNaira") or 0))
        over_aw = abs(int(vh.get("overpaid125NocopoAwardedNaira") or 0))
        off_paid = abs(int(vh.get("offNocopoPrivatePaidNaira") or 0))
        allowed_amounts.extend([cap_aw, over_paid, over_aw, off_paid])
        lines.append(
            f"Vendor Capture & Off-Portal Audit: {int(vh.get('captivePairCount', 0)):,} captive MDA-contractor pairs ({_format_naira_short(cap_aw)}), "
            f"{int(vh.get('multiMdaContractorCount', 0)):,} contractors winning across 5+ ministries, and "
            f"{int(vh.get('overpaid125Count', 0)):,} contractors where treasury disbursements ({_format_naira_short(over_paid)}) exceeded contract awards ({_format_naira_short(over_aw)})."
        )
        lines.append(
            f"• Off-Portal Private Vendors: {int(vh.get('offNocopoPrivateCount', 0)):,} private corporate payees lacking public contract award records "
            f"received {_format_naira_short(off_paid)} ({int(vh.get('offNocopoPrivateBillionPlusCount', 0)):,} firms received at least ₦1.00 Billion)."
        )
        allowed_amounts.append(1_000_000_000)
        for cp in (vn_data.get("captivePairs") or [])[:2]:
            p_aw = abs(int(cp.get("pairAwardedNaira") or 0))
            allowed_amounts.append(p_aw)
            pair_txt = f"{cp.get('contractorName', '')} {cp.get('mdaName', '')}"
            _register_grounded_tokens_from_text(pair_txt, allowed_amounts, allowed_codes)
            lines.append(
                f"• Captive Pair: {cp.get('contractorName')} at {cp.get('mdaName')} — "
                f"{cp.get('shareOfMdaPct', 0)}% of MDA award value ({_format_naira_short(p_aw)})."
            )
        top_off = ((vn_data.get("offNocopoAudit") or {}).get("topOffNocopoPrivateVendors") or [])[:1]
        for ov in top_off:
            o_amt = abs(int(ov.get("totalPaidNaira") or 0))
            allowed_amounts.append(o_amt)
            b_name = str(ov.get("beneficiaryName") or "")
            _register_grounded_tokens_from_text(b_name, allowed_amounts, allowed_codes)
            lines.append(
                f"• Top Off-Portal Private Payee: {b_name} — {int(ov.get('voucherCount', 0)):,} vouchers totaling {_format_naira_short(o_amt)}."
            )
        staff_paid = abs(int(vh.get("offNocopoStaffPaidNaira") or 0))
        unclass_paid = abs(int(vh.get("offNocopoUnclassifiedPaidNaira") or 0))
        if staff_paid > 0:
            allowed_amounts.extend([staff_paid, unclass_paid])
            lines.append(
                f"• Personal / Staff Accounts & Unclassified Payees: {int(vh.get('offNocopoStaffCount', 0)):,} personal/staff names received {_format_naira_short(staff_paid)} "
                f"and {int(vh.get('offNocopoUnclassifiedCount', 0)):,} unclassified payees received {_format_naira_short(unclass_paid)}."
            )

    elif mode == "follow_money" and ftm_data:
        fs = ftm_data.get("summary", {})
        aw_amt = abs(int(fs.get("diffTotalAwardedNaira") or 0))
        pd_amt = abs(int(fs.get("diffTotalNocopoDisbursedNaira") or 0))
        pad_aw = abs(int(fs.get("diffPositivePaddingAwardedNaira") or 0))
        allowed_amounts.extend([aw_amt, pd_amt, pad_aw])
        lcc = fs.get("lineageClassificationCounts") or {}
        lines.append(
            f"Follow-the-Money Cross-Link Audit ({int(fs.get('diffItemsScanned', 0)):,} budget diffs & {int(fs.get('lineagesScanned', 0)):,} multi-year lineages scanned):"
        )
        lines.append(
            f"• Contracted Budget Changes: {int(fs.get('diffMatchedAwardedCount', 0)):,} items progressed to public contract awards "
            f"({_format_naira_short(aw_amt)} awarded, {_format_naira_short(pd_amt)} disbursed), including "
            f"{int(fs.get('diffPositivePaddingAwardedCount', 0)):,} legislature-added/inflated items ({_format_naira_short(pad_aw)} awarded)."
        )
        lines.append(
            f"• Multi-Year Zombie & Active Builds: {int(lcc.get('VENDOR_SWITCHED_REPEAT', 0)):,} vendor-switched repeats, "
            f"{int(lcc.get('ACTIVE_PHASED_BUILD', 0)):,} active phased builds, {int(lcc.get('AWARDED_UNPAID', 0)):,} awarded unpaid, "
            f"and {int(lcc.get('PLANNED_ONLY_REPEAT', 0)):,} planned-only repeats."
        )

    elif mode == "oaugf_audit" and oa_data:
        oh = oa_data.get("headline", {})
        lines.append(
            f"OAuGF Constitutional Audit Archive: {int(oh.get('reportsIndexed', 0)):,} audit reports "
            f"({int(oh.get('totalPages', 0)):,} pages, {int(oh.get('parsedAuditIssuesCount', 0)):,} parsed audit issues across "
            f"{int(oh.get('matchedMdasCount', 0)):,} matched federal ministries/agencies)."
        )
        cats = oh.get("categoryCounts") or {}
        if cats:
            top_cats = ", ".join(f"{k}: {int(v):,}" for k, v in list(cats.items())[:4])
            lines.append(f"• Top Issue Categories: {top_cats}.")
        by_mda = oa_data.get("byMda") or {}
        matched_mdas = [
            v for v in by_mda.values() if _matches_keywords(str(v.get("mdaName", "")))
        ]
        for mv in (matched_mdas or list(by_mda.values()))[:3]:
            amt = abs(int(mv.get("totalFlaggedNaira") or 0))
            allowed_amounts.append(amt)
            m_name = str(mv.get("mdaName") or "")
            _register_grounded_tokens_from_text(m_name, allowed_amounts, allowed_codes)
            yrs = ", ".join(str(y) for y in (mv.get("reportYears") or [])[-5:])
            lines.append(
                f"• {m_name} — {int(mv.get('findingCount', 0)):,} audit queries "
                f"(years: {yrs or 'Multiple'}, referenced amounts {_format_naira_short(amt)})."
            )

    elif mode == "execution" and mc_data:
        series = mc_data.get("yearlySeries", [])
        picked_yr = next((y for y in series if target_year and y.get("financialYear") == target_year), None)
        if picked_yr and isinstance(picked_yr.get("bir"), dict):
            bir = picked_yr["bir"]
            cap_p = bir.get("capitalPerformancePct")
            debt_p = bir.get("debtServicePerformancePct")
            if cap_p is not None or debt_p is not None:
                lines.append(
                    f"Macro Execution Credibility (FY {picked_yr['financialYear']}): "
                    f"Capital Actual {cap_p if cap_p is not None else 'N/A'}% vs. "
                    f"Debt Service Actual {debt_p if debt_p is not None else 'N/A'}%."
                )

    return {
        "lines": lines,
        "allowedAmounts": allowed_amounts,
        "allowedCodes": allowed_codes,
        "mdaScorecardsLoaded": sc_data is not None,
        "macroCredibilityLoaded": mc_data is not None,
        "procurementRiskLoaded": pr_data is not None,
        "govspendForensicsLoaded": gf_data is not None,
        "vendorNetworkLoaded": vn_data is not None,
        "followTheMoneyLoaded": ftm_data is not None,
        "oaugfAuditLoaded": oa_data is not None,
        "redFlagConvergenceLoaded": conv_data is not None,
    }


@router.post("/query")
def run_hybrid_rag_query(payload: AiQueryRequest) -> dict[str, Any]:
    t0 = time.perf_counter()
    db_path = get_fts_db_path()
    if not db_path.exists():
        return {
            "available": False,
            "answer": "FTS5 search index is not initialized yet.",
            "groundingVerified": False,
            "citations": [],
            "duplicateClusters": [],
            "similarItems": [],
            "yearBreakdown": [],
            "totalMatches": 0,
            "totalExposureNaira": 0,
            "elapsedMs": 0.0,
        }

    intent = _extract_intent(
        payload.question,
        payload.financialYear,
        payload.president,
        payload.mode,
        payload.scope,
    )
    forensics_data = _load_dataset_json("statistical_forensics_1999_2026.json")
    padding_data = _load_dataset_json("bill_act_diffs/index.json")
    execution_data = _load_dataset_json("execution_tracker.json")
    policy_data = _load_dataset_json("policy_benchmarks.json")
    phase3_datasets = {
        "mdaScorecards": _load_dataset_json("mda_integrity_scorecards.json"),
        "macroCredibility": _load_dataset_json("macro_credibility_tracker.json"),
        "procurementRisk": _load_dataset_json("procurement_risk_index.json"),
        "govspendForensics": _load_dataset_json("govspend_forensics.json"),
        "vendorNetwork": _load_dataset_json("vendor_network_index.json"),
        "followTheMoney": _load_dataset_json("follow_the_money_links.json"),
        "oaugfAudit": _load_dataset_json("oaugf_audit_index.json"),
        "redFlagConvergence": _load_dataset_json("red_flag_convergence_index.json"),
    }

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    try:
        mode = intent["queryMode"]
        duplicate_clusters: list[dict[str, Any]] = []
        similar_items: list[dict[str, Any]] = []
        citations: list[dict[str, Any]] = []
        policy_citations: list[dict[str, Any]] = []
        year_breakdown: list[dict[str, Any]] = []
        total_matches = 0
        total_exposure = 0
        extra_allowed_amounts: list[int] = []
        extra_allowed_codes: set[str] = set()
        lead_lines: list[str] = []

        supp = _collect_supplemental_briefs(intent, forensics_data, padding_data, execution_data)
        ext_ctx = _collect_external_ledger_context(intent, policy_data)
        phase3_ctx = _collect_phase3_briefs(intent, phase3_datasets)
        extra_allowed_amounts.extend(supp["allowedAmounts"])
        extra_allowed_amounts.extend(ext_ctx["allowedAmounts"])
        extra_allowed_amounts.extend(phase3_ctx["allowedAmounts"])
        extra_allowed_codes.update(ext_ctx["allowedCodes"])
        extra_allowed_codes.update(phase3_ctx["allowedCodes"])
        policy_citations = ext_ctx["policyCitations"]

        if mode == "duplicates":
            dup_res = _find_duplicate_clusters(conn, intent, forensics_data)
            duplicate_clusters = dup_res["duplicateClusters"]
            citations = dup_res["citations"]
            total_matches = dup_res["totalClusters"]
            total_exposure = dup_res["totalClusterExposureNaira"]
            for cl in duplicate_clusters:
                extra_allowed_amounts.append(int(cl["totalAmountNaira"]))
                for item in cl["items"]:
                    extra_allowed_amounts.append(int(item["amountNaira"]))

            scope_desc = f"{intent['targetYear']}" if intent["targetYear"] else "1999–2026"
            if duplicate_clusters:
                lead_lines.append(
                    f"Found {total_matches:,} repeated allocation clusters across {scope_desc} (top cluster exposure {_format_naira_short(total_exposure)})."
                )
                lead_lines.append("")
                for idx, cl in enumerate(duplicate_clusters[:5], 1):
                    lead_lines.append(
                        f"{idx}. {cl['canonicalTitle']} — {cl['count']}x across {cl['distinctAgencies']} ministry/agency unit(s), totaling {cl['totalAmountFormatted']}"
                    )
            else:
                lead_lines.append(
                    f'No repeated allocations matched "{payload.question}" in {scope_desc}. Try broader keywords or another year.'
                )

        elif mode == "similar":
            sim_res = _find_similar_items(conn, intent, payload.question)
            similar_items = sim_res["similarItems"]
            citations = sim_res["citations"]
            total_matches = len(similar_items)
            total_exposure = sim_res["totalExposureNaira"]
            anchor = sim_res["anchor"]
            if anchor:
                extra_allowed_amounts.append(int(anchor["amountNaira"]))
                extra_allowed_codes.add(str(anchor["code"]))
                extra_allowed_codes.add(str(anchor["id"]))
            scope_desc = f"{intent['targetYear']}" if intent["targetYear"] else "1999–2026"
            if similar_items:
                lead_lines.append(
                    f"Found {total_matches} similar items across {scope_desc} totaling {_format_naira_short(total_exposure)}."
                )
                lead_lines.append("")
                for idx, item in enumerate(similar_items[:5], 1):
                    lead_lines.append(
                        f"{idx}. {item['year']} — {item['title']} ({item['agency']}): {item['amount']}"
                    )
            else:
                lead_lines.append(
                    f'No similar items found for "{payload.question}" across {scope_desc}.'
                )

        else:
            # General / Padding / Forensics / Execution SQL + FTS5 Retrieval
            where_clauses: list[str] = []
            params: list[Any] = []
            fts_expr = intent["ftsQuery"]

            if fts_expr:
                where_clauses.append("budget_fts MATCH ?")
                params.append(fts_expr)
            if intent["targetYear"] is not None:
                where_clauses.append("r.financial_year = ?")
                params.append(intent["targetYear"])
            elif len(intent["years"]) >= 2:
                placeholders = ",".join("?" for _ in intent["years"])
                where_clauses.append(f"r.financial_year IN ({placeholders})")
                params.extend(intent["years"])
            if intent["targetPresident"]:
                where_clauses.append("r.president = ?")
                params.append(intent["targetPresident"])

            where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
            join_sql = (
                "FROM budget_fts f JOIN budget_records r ON r.rowid = f.rowid"
                if fts_expr
                else "FROM budget_records r"
            )

            agg_row = conn.execute(
                f"SELECT COUNT(*) AS cnt, COALESCE(SUM(r.amount_naira), 0) AS total_amt {join_sql} {where_sql}",
                tuple(params),
            ).fetchone()
            total_matches = int(agg_row["cnt"]) if agg_row else 0
            total_exposure = int(agg_row["total_amt"]) if agg_row else 0

            year_rows = conn.execute(
                f"""
                SELECT r.financial_year AS year, COUNT(*) AS count, COALESCE(SUM(r.amount_naira), 0) AS total_amt
                {join_sql}
                {where_sql}
                GROUP BY r.financial_year
                ORDER BY r.financial_year ASC
                """,
                tuple(params),
            ).fetchall()

            top_rows = conn.execute(
                f"""
                SELECT r.id, r.financial_year, r.president, r.project_code,
                       r.project_name, r.mda_name, r.sector, r.spending_type,
                       r.amount_naira, r.pdf_page, r.source_filename, r.sha256_hash,
                       r.state, r.severity
                {join_sql}
                {where_sql}
                ORDER BY r.amount_naira DESC
                LIMIT 12
                """,
                tuple(params),
            ).fetchall()

            citations = [_row_to_citation(r) for r in top_rows]
            year_breakdown = [
                {"year": r["year"], "count": r["count"], "totalNaira": r["total_amt"]}
                for r in year_rows
            ]

            scope_desc = (
                f"{intent['targetYear']}"
                if intent["targetYear"]
                else f"{len(year_breakdown)} fiscal years (1999–2026)"
            )
            if supp["lines"] or phase3_ctx["lines"] or ext_ctx["lines"]:
                lead_lines.extend(supp["lines"])
                if phase3_ctx["lines"]:
                    if lead_lines:
                        lead_lines.append("")
                    lead_lines.extend(phase3_ctx["lines"])
                if ext_ctx["lines"]:
                    if lead_lines:
                        lead_lines.append("")
                    lead_lines.extend(ext_ctx["lines"])
                if citations:
                    lead_lines.append("")

            if total_matches > 0:
                lead_lines.append(
                    f"Found {total_matches:,} matching budget records across {scope_desc} totaling {_format_naira_short(total_exposure)}."
                )
                lead_lines.append("")
                lead_lines.append("Top Matching Items:")
                for idx, c in enumerate(citations[:5], 1):
                    lead_lines.append(
                        f"{idx}. {c['year']} — {c['title']} ({c['agency']}): {c['amount']}"
                    )
            elif not lead_lines:
                lead_lines.append(
                    f'No matching records were found for "{payload.question}". '
                    "Try a shorter keyword or a specific ministry or contractor name."
                )

        raw_answer = _sanitize_public_ai_text("\n".join(lead_lines))
        allowed_amounts = (
            [total_exposure]
            + [c["amountNaira"] for c in citations]
            + [y["totalNaira"] for y in year_breakdown]
            + extra_allowed_amounts
        )
        allowed_codes = {c["code"] for c in citations} | {c["id"] for c in citations} | extra_allowed_codes
        for c in citations:
            for m in PROJECT_CODE_RE.finditer(str(c.get("title") or "")):
                allowed_codes.add(m.group(1))
        for cl in duplicate_clusters:
            for m in PROJECT_CODE_RE.finditer(str(cl.get("canonicalTitle") or "")):
                allowed_codes.add(m.group(1))
            for item in cl["items"]:
                allowed_codes.add(item["code"])
                allowed_codes.add(item["id"])
        gate = verify_grounded_response(raw_answer, allowed_amounts, allowed_codes)

        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
        return {
            "available": True,
            "queryMode": mode,
            "answer": gate["verifiedText"],
            "groundingVerified": gate["groundingVerified"],
            "rejectedFigures": gate["rejectedFigures"],
            "rejectedCodes": gate["rejectedCodes"],
            "citations": citations,
            "policyCitations": policy_citations,
            "duplicateClusters": duplicate_clusters,
            "similarItems": similar_items,
            "yearBreakdown": year_breakdown,
            "totalMatches": total_matches,
            "totalExposureNaira": total_exposure,
            "datasetsConnected": {
                "fts5Sql": True,
                "statisticalForensics": supp["forensicsLoaded"],
                "billActPadding": supp["paddingLoaded"],
                "executionTracker": supp["executionLoaded"],
                "policyBenchmarks": ext_ctx["policyBenchmarksLoaded"],
                "policyFts": ext_ctx["policyFtsReady"],
                "birOcrFts": ext_ctx["birOcrFtsReady"],
                "oaugfAuditFts": ext_ctx["oaugfFtsReady"],
                "nocopoContracts": ext_ctx["nocopoReady"],
                "govspendPayments": ext_ctx["govspendReady"],
                "mdaScorecards": phase3_ctx["mdaScorecardsLoaded"],
                "macroCredibility": phase3_ctx["macroCredibilityLoaded"],
                "procurementRisk": phase3_ctx["procurementRiskLoaded"],
                "govspendForensics": phase3_ctx["govspendForensicsLoaded"],
                "vendorNetwork": phase3_ctx["vendorNetworkLoaded"],
                "followTheMoney": phase3_ctx["followTheMoneyLoaded"],
                "oaugfAuditIndex": phase3_ctx["oaugfAuditLoaded"],
                "redFlagConvergence": phase3_ctx["redFlagConvergenceLoaded"],
            },
            "elapsedMs": elapsed_ms,
        }
    finally:
        conn.close()
