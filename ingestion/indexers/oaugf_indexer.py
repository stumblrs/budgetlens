"""Index extracted OAuGF Audit Reports into SQLite FTS5 (`oaugf_fts`) and `public/datasets/oaugf_audit_index.json`.

Reads `ingestion/oaugf_extracted/index.json` + per-document JSONs, builds full-text
search chunks in `backend/data/external_ledger_fts.sqlite`, parses numbered OAuGF audit
issues/queries, maps findings to canonical MDAs from `mda_integrity_scorecards.json`,
and emits a compact static JSON index (`< 1.5 MB`) for the UI and Grounded AI.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ingestion.parsers.entity_normalizer import clean_display_name, mda_core_key, normalize_mda_name

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_EXTRACTED_DIR = PROJECT_ROOT / "ingestion" / "oaugf_extracted"
DEFAULT_DATASETS_DIR = PROJECT_ROOT / "public" / "datasets"
DEFAULT_FTS_SQLITE = PROJECT_ROOT / "backend" / "data" / "external_ledger_fts.sqlite"

ISSUE_HEADING_RE = re.compile(
    r"(?im)^(?:ISSUE|AUDIT\s+QUERY|FINDING|OBSERVATION)\s*(\d{1,3})?\s*[:.\-–—]\s*([^\n]{6,180})"
)
SECTION_FINDING_RE = re.compile(
    r"(?m)^(\d{1,3}(?:\.\d{1,3}){1,3})\s+([A-Z][A-Za-z0-9 ,/\-()₦'\"&]{10,165})"
)
PARA_FINDING_RE = re.compile(
    r"(?m)^(?:PARA(?:GRAPH)?\.?\s*(\d{1,3})|(\d{1,3})\.)\s+([A-Z][A-Za-z0-9 ,/\-()₦'\"&]{12,165})"
)
TABLE_FINDING_RE = re.compile(
    r"(?im)^(\d{1,2})\s+((?:Failure|Irregular\w*|Unretired|Unvouched|Non-\w+|Lack\s+of|Payment\s+of|Award\s+of|Violation|Weakness\w*|Inadequate|Overpayment|Misapplication|Diversion|Unaccounted|Delay\s+in)[^\n]{10,165})"
)
NARRATIVE_SENTENCE_RE = re.compile(
    r"([A-Z][^\n.]{25,220}?(?:failed\s+to|irregular\w*|unvouched|unretired|without\s+due\s+process|overpayment|not\s+presented|not\s+remitted|unaccounted|shortfall|noticed\s+that|observed\s+that|contrary\s+to)[^\n.]{10,160}\.)",
    re.IGNORECASE,
)
IRREGULARITY_SIGNAL_RE = re.compile(
    r"(?:unvouched|unretired|irregular|without\s+due\s+process|overpayment|abandoned|unaccounted|non[- ]remittance|violation|splitting|diversion|misapplication|missing|unauthorised|unauthorized|fraud|shortfall|loss\s+of|failure\s+to|not\s+presented|unpaid|disallow|recover|refund|surcharge|weakness|contrary\s+to|₦|NGN|N\d[\d,]{3,})",
    re.IGNORECASE,
)
SKIP_HEADING_NOISE_RE = re.compile(
    r"\b(?:ACKNOWLEDGEMENT|TABLE\s+OF\s+CONTENTS|FOREWORD|INTRODUCTION|AUDIT\s+OBJECTIVE|AUDIT\s+SCOPE|METHODOLOG|BACKGROUND\s+TO\s+THE\s+AUDIT|LIST\s+OF\s+ABBREVIATIONS|EXECUTIVE\s+SUMMARY)\b",
    re.IGNORECASE,
)
_TOC_DOT_LEADER_RE = re.compile(r"(?:[.\u2026\u00b7]{4,}|(?:\.\s+){4,})\s*\d+")
_DOT_LEADER_RUN_RE = re.compile(r"(?:[.\u2026\u00b7]{4,}|(?:\.\s+){4,})")
_TOC_PAGE_HEADER_RE = re.compile(
    r"(?:^|\n)\s*(?:TABLE\s+OF\s+CONTENTS|CONTENTS|LIST\s+OF\s+(?:ISSUES|TABLES|FINDINGS))\b",
    re.IGNORECASE,
)
_RUNNING_HEADER_LINE_RE = re.compile(
    r"^(?:\d{1,4}|(?:19|20)\d{2}\s+annual\s+report|o[ﬀf]*ice\s+of\s+the\s+auditor[- ]general.*)$",
    re.IGNORECASE,
)
DOC_YEAR_FALLBACKS: dict[str, list[int]] = {
    "6": [2016],
    "8": [2015],
    "9": [2015],
    "25": [2009],
    "28": [2012],
    "extra-history": [1999],
}
UPSTREAM_404_MISSING_REPORTS: list[dict[str, Any]] = [
    {"id": 4, "year": 2015, "title": "Annual Report 2015 (Pt 2)", "status": "UPSTREAM_404_ON_OAUGF_NG"},
    {"id": 5, "year": 2015, "title": "Annual Report 2015 (Pt 1)", "status": "UPSTREAM_404_ON_OAUGF_NG"},
    {"id": 13, "year": 2012, "title": "NDDC Report 2008–2012", "status": "UPSTREAM_404_ON_OAUGF_NG"},
    {"id": 16, "year": 2000, "title": "Annual Audit Report 2000", "status": "UPSTREAM_404_ON_OAUGF_NG"},
    {"id": 18, "year": 2002, "title": "2002 Audit Report (Part 2)", "status": "UPSTREAM_404_ON_OAUGF_NG"},
    {"id": 19, "year": 2003, "title": "2003 Audit Report (Part 2)", "status": "UPSTREAM_404_ON_OAUGF_NG"},
    {"id": 20, "year": 2004, "title": "2004 Audit Report Part 2 (1–31)", "status": "UPSTREAM_404_ON_OAUGF_NG"},
    {"id": 21, "year": 2005, "title": "2005 Audit Report Part 2 (1–36)", "status": "UPSTREAM_404_ON_OAUGF_NG"},
]
NAIRA_RE = re.compile(
    r"(?:₦|NGN\s*|N(?=\d[\d,]{3,}))\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(Trillion|Billion|Million)?\b",
    re.IGNORECASE,
)
REPEAT_NEGLECT_RE = re.compile(
    r"(?:previous\s+report|without\s+any\s+response|no\s+response|not\s+been\s+acted|repeatedly|recurred|failed\s+to\s+respond|ignored)",
    re.IGNORECASE,
)
RECOVERY_DIRECTIVE_RE = re.compile(
    r"(?:\brecover\b|\brefund\b|\bsurcharge\b|\bsanction\b|remit\s+to\s+treasury|disciplinary\s+action)",
    re.IGNORECASE,
)
RECOMMENDATION_RE = re.compile(
    r"(?:Recommendations?|Audit\s+Recommendations?)\s*[:\-]?\s*(.{15,240})",
    re.IGNORECASE,
)

COMMON_MDA_ALIASES: dict[str, tuple[str, ...]] = {
    "FEDERAL ROAD MAINTENANCE AGENCY": ("FERMA", "FEDERAL ROADS MAINTENANCE AGENCY"),
    "NIGER DELTA DEVELOPMENT COMMISSION": ("NDDC", "NIGER DELTA DEVELOPMENT COMMISSION"),
    "NIGERIAN ELECTRICITY REGULATORY COMMISSION": ("NERC", "NIGERIAN ELECTRICITY REGULATORY COMMISSION"),
    "FEDERAL INLAND REVENUE SERVICE": ("FIRS", "FEDERAL INLAND REVENUE SERVICE"),
    "FEDERAL ROAD SAFETY CORPS": ("FRSC", "FEDERAL ROAD SAFETY CORPS"),
    "NATIONAL EXAMINATIONS COUNCIL": ("NECO", "NATIONAL EXAMINATIONS COUNCIL"),
    "NATIONAL EMERGENCY MANAGEMENT AGENCY": ("NEMA", "NATIONAL EMERGENCY MANAGEMENT AGENCY"),
    "UNIVERSAL BASIC EDUCATION COMMISSION": ("UBEC", "UNIVERSAL BASIC EDUCATION COMMISSION"),
    "TERTIARY EDUCATION TRUST FUND": ("TETFUND", "TERTIARY EDUCATION TRUST FUND"),
    "CENTRAL BANK OF NIGERIA": ("CBN", "CENTRAL BANK OF NIGERIA"),
    "NIGERIAN NATIONAL PETROLEUM CORPORATION": ("NNPC", "NIGERIAN NATIONAL PETROLEUM"),
    "SMALL AND MEDIUM ENTERPRISES DEVELOPMENT AGENCY": ("SMEDAN",),
}


def _atomic_write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = str(path) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    for attempt in range(5):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.2)


def _chunk_text(text: str, max_chars: int = 1800, overlap: int = 200) -> list[str]:
    clean = " ".join(str(text or "").split())
    if not clean:
        return []
    if len(clean) <= max_chars:
        return [clean]
    chunks: list[str] = []
    start = 0
    while start < len(clean):
        end = min(len(clean), start + max_chars)
        if end < len(clean):
            sp = clean.rfind(" ", start + max_chars // 2, end)
            if sp > start:
                end = sp
        part = clean[start:end].strip()
        if part:
            chunks.append(part)
        if end >= len(clean):
            break
        start = max(start + 1, end - overlap)
    return chunks


def is_toc_page(txt: str) -> bool:
    """Return True if a page is primarily a dotted Table of Contents listing."""
    if not txt:
        return False
    dot_hits = len(_TOC_DOT_LEADER_RE.findall(txt))
    if dot_hits >= 3:
        return True
    if _TOC_PAGE_HEADER_RE.search(txt[:400]) and dot_hits >= 1:
        return True
    return False


def is_toc_candidate(heading: str, body: str) -> bool:
    """Return True if a candidate heading or excerpt contains Table of Contents dot-leaders."""
    head_s = str(heading or "")
    body_s = str(body or "")[:320]
    return bool(
        _TOC_DOT_LEADER_RE.search(head_s)
        or _TOC_DOT_LEADER_RE.search(body_s)
        or _DOT_LEADER_RUN_RE.search(head_s)
        or _DOT_LEADER_RUN_RE.search(body_s)
    )


def diagnose_oaugf_document_extraction(doc: dict[str, Any], doc_issue_count: int) -> dict[str, Any]:
    """Diagnose whether a zero-issue OAuGF document is scanned image-only vs. unstructured narrative."""
    pages = doc.get("pages") or []
    page_count = int(doc.get("pageCount") or len(pages) or 0)
    substantive_pages = 0
    for pg in pages:
        raw_lines = [ln.strip() for ln in str(pg.get("text") or "").splitlines() if ln.strip()]
        body_lines = [ln for ln in raw_lines if not _RUNNING_HEADER_LINE_RE.match(ln)]
        if len(" ".join(body_lines).strip()) > 150:
            substantive_pages += 1

    if doc_issue_count > 0:
        return {
            "extractionStatus": "INDEXED_FINDINGS",
            "substantivePagesCount": substantive_pages,
            "extractionNote": None,
        }
    if page_count >= 20 and substantive_pages <= max(15, int(page_count * 0.05)):
        return {
            "extractionStatus": "SCANNED_IMAGE_BODY_PENDING_OCR",
            "substantivePagesCount": substantive_pages,
            "extractionNote": (
                f"Only {substantive_pages} of {page_count} pages contain substantive native text; "
                "remaining body pages carry only running headers/page numbers over scanned raster images pending source PDF OCR."
            ),
        }
    return {
        "extractionStatus": "NARRATIVE_NO_STRUCTURED_ISSUES",
        "substantivePagesCount": substantive_pages,
        "extractionNote": "Document text extracted; no numbered issue/query headings matched audit finding rules.",
    }


def _extract_page_candidates(txt: str, pno: int, doc_id: str) -> list[tuple[str, str]]:
    """Extract (heading, body_slice) audit finding pairs across all 4 OAuGF report formats."""
    out: list[tuple[str, str]] = []
    if is_toc_page(txt):
        return out

    # Format 1: Explicit ISSUE / AUDIT QUERY / FINDING / OBSERVATION headers
    m1 = list(ISSUE_HEADING_RE.finditer(txt))
    if m1:
        for idx, m in enumerate(m1):
            num_part = f" {m.group(1)}" if m.group(1) else ""
            title_part = " ".join(m.group(2).split())
            if SKIP_HEADING_NOISE_RE.search(title_part):
                continue
            heading = f"Issue{num_part}: {title_part}"
            next_pos = m1[idx + 1].start() if idx + 1 < len(m1) else min(len(txt), m.end() + 1000)
            body = " ".join(txt[m.end() : next_pos].split())
            if is_toc_candidate(heading, body):
                continue
            out.append((heading, body))
        if out:
            return out

    if doc_id == "extra-history" or pno < 5:
        return out

    # Format 2 & 3: Numbered section headings (2.01 / 3.1.2), numbered paragraphs, or tabular S/N rows
    combined_matches: list[tuple[int, int, str]] = []
    for m in SECTION_FINDING_RE.finditer(txt):
        h_txt = " ".join(m.group(2).split())
        if not SKIP_HEADING_NOISE_RE.search(h_txt):
            combined_matches.append((m.start(), m.end(), f"Section {m.group(1)}: {h_txt}"))
    for m in PARA_FINDING_RE.finditer(txt):
        pnum = m.group(1) or m.group(2) or ""
        h_txt = " ".join(m.group(3).split())
        if not SKIP_HEADING_NOISE_RE.search(h_txt):
            combined_matches.append((m.start(), m.end(), f"Para {pnum}: {h_txt}"))
    for m in TABLE_FINDING_RE.finditer(txt):
        h_txt = " ".join(m.group(2).split())
        if not SKIP_HEADING_NOISE_RE.search(h_txt):
            combined_matches.append((m.start(), m.end(), f"Finding {m.group(1)}: {h_txt}"))

    combined_matches.sort(key=lambda x: x[0])
    for idx, (st_pos, end_pos, heading) in enumerate(combined_matches):
        next_pos = combined_matches[idx + 1][0] if idx + 1 < len(combined_matches) else min(len(txt), end_pos + 750)
        body = " ".join(txt[end_pos:next_pos].split())
        if is_toc_candidate(heading, body):
            continue
        if IRREGULARITY_SIGNAL_RE.search(f"{heading} {body[:500]}"):
            out.append((heading, body))

    if out:
        return out

    # Format 4: Narrative audit finding fallback for older scanned / narrative reports (1999, 2005, 2020 CFS, Lake Chad, Crude Oil)
    if pno >= 8 and len(txt) >= 180:
        nm = NARRATIVE_SENTENCE_RE.search(txt)
        if nm:
            sent = " ".join(nm.group(1).split())
            if not SKIP_HEADING_NOISE_RE.search(sent):
                heading = f"Audit Observation (p.{pno}): {sent[:115]}"
                body = " ".join(txt[nm.start() : min(len(txt), nm.end() + 550)].split())
                if not is_toc_candidate(heading, body):
                    out.append((heading, body))

    return out


def _year_shard_bucket(year: int | None) -> str:
    if not year or year <= 2010:
        return "1999_2010"
    if year <= 2014:
        return "2011_2014"
    if year <= 2017:
        return "2015_2017"
    if year <= 2019:
        return "2018_2019"
    if year <= 2022:
        return "2020_2022"
    if year == 2023:
        return "2023"
    return "2024"


def _classify_audit_issue(heading: str, context: str) -> str:
    low = f"{heading} {context[:300]}".lower()
    if any(k in low for k in ("voucher", "unvouched", "not presented for audit", "not presented for exam")):
        return "Unvouched / Missing Payment Vouchers"
    if any(k in low for k in ("due process", "procurement", "bidding", "splitting", "contract", "bpp", "nitda", "award")):
        if any(k in low for k in ("abandoned", "overpayment", "not executed", "uncompleted", "variation")):
            return "Contract Overpayments & Abandoned Works"
        return "Procurement & Due Process Violations"
    if any(k in low for k in ("unretired", "advance", "cash", "imprest", "unaccounted", "diversion")):
        return "Unretired Advances & Cash Irregularities"
    if any(k in low for k in ("remit", "tax", "vat", "withholding", "igr", "revenue", "royalt", "shortfall", "tsa")):
        return "Revenue, Tax & Remittance Shortfalls"
    if any(k in low for k in ("payroll", "salary", "allowance", "pension", "staff", "ghost", "personnel")):
        return "Payroll, Personnel & Allowance Irregularities"
    return "Internal Control & Asset Management"


def _parse_naira_amount(text: str) -> int:
    best = 0
    for m in NAIRA_RE.finditer(text or ""):
        try:
            num = float(m.group(1).replace(",", ""))
        except ValueError:
            continue
        unit = (m.group(2) or "").lower()
        if unit == "trillion":
            num *= 1e12
        elif unit == "billion":
            num *= 1e9
        elif unit == "million":
            num *= 1e6
        val = int(round(num))
        if 10_000 <= val <= 50_000_000_000_000 and val > best:
            best = val
    return best


def _load_canonical_mdas(datasets_dir: Path) -> list[dict[str, str]]:
    sc_path = datasets_dir / "mda_integrity_scorecards.json"
    out: list[dict[str, str]] = []
    if sc_path.is_file():
        try:
            sc = json.loads(sc_path.read_text(encoding="utf-8"))
            for m in sc.get("mdas", []):
                key = str(m.get("mdaKey") or "").strip().upper()
                name = str(m.get("mdaName") or "").strip().upper()
                if key and len(key) >= 10:
                    out.append({"mdaKey": key, "mdaName": name})
        except Exception:
            pass
    return out


_EXCLUDED_HEADER_MDAS: set[str] = {
    "AUDITOR GENERAL FOR THE FEDERATION",
    "OFFICE OF THE AUDITOR GENERAL FOR THE FEDERATION",
}


def _match_mda_from_text(
    page_upper: str,
    canonical_mdas: list[dict[str, str]],
) -> tuple[str, str] | None:
    for name, aliases in COMMON_MDA_ALIASES.items():
        for al in aliases:
            if re.search(rf"\b{re.escape(al)}\b", page_upper):
                key = mda_core_key(name)
                if key not in _EXCLUDED_HEADER_MDAS:
                    return key, name
    for entry in canonical_mdas:
        k = entry["mdaKey"]
        if k in _EXCLUDED_HEADER_MDAS:
            continue
        if k in page_upper:
            return k, entry["mdaName"]
    return None


def _write_oaugf_sqlite(fts_sqlite_path: Path, chunk_rows: list[tuple[Any, ...]]) -> None:
    fts_sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(fts_sqlite_path))
    try:
        conn.execute("DROP TABLE IF EXISTS oaugf_fts;")
        conn.execute("DROP TABLE IF EXISTS oaugf_chunks;")
        conn.execute(
            """
            CREATE TABLE oaugf_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                doc_id TEXT NOT NULL,
                doc_title TEXT NOT NULL,
                category TEXT NOT NULL,
                audit_years TEXT NOT NULL,
                primary_year INTEGER,
                page_number INTEGER NOT NULL,
                chunk_index INTEGER NOT NULL,
                source_url TEXT NOT NULL,
                sha256 TEXT NOT NULL,
                chunk_text TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE VIRTUAL TABLE oaugf_fts USING fts5(
                doc_title,
                category,
                chunk_text,
                content='oaugf_chunks',
                content_rowid='id',
                tokenize='porter unicode61'
            )
            """
        )
        if chunk_rows:
            conn.executemany(
                """
                INSERT INTO oaugf_chunks (
                    doc_id, doc_title, category, audit_years, primary_year,
                    page_number, chunk_index, source_url, sha256, chunk_text
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                chunk_rows,
            )
            conn.execute("INSERT INTO oaugf_fts(oaugf_fts) VALUES('rebuild');")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_oaugf_year ON oaugf_chunks(primary_year);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_oaugf_doc ON oaugf_chunks(doc_id);")
        conn.commit()
    finally:
        conn.close()


def build_oaugf_index(
    *,
    extracted_dir: str | Path = DEFAULT_EXTRACTED_DIR,
    datasets_dir: str | Path = DEFAULT_DATASETS_DIR,
    fts_sqlite_path: str | Path | None = DEFAULT_FTS_SQLITE,
    write: bool = True,
) -> dict[str, Any]:
    """Build `oaugf_fts` in SQLite and `public/datasets/oaugf_audit_index.json`."""
    ext_dir = Path(extracted_dir)
    ds_dir = Path(datasets_dir)
    idx_path = ext_dir / "index.json"
    if not idx_path.exists():
        raise FileNotFoundError(f"OAuGF extracted index not found: {idx_path}")

    raw_index = json.loads(idx_path.read_text(encoding="utf-8"))
    canonical_mdas = _load_canonical_mdas(ds_dir)

    chunk_rows: list[tuple[Any, ...]] = []
    documents_out: list[dict[str, Any]] = []
    category_counts: dict[str, int] = defaultdict(int)
    mda_acc: dict[str, dict[str, Any]] = {}
    all_issues: list[dict[str, Any]] = []
    years_seen: set[int] = set()
    repeat_neglect_count = 0
    recovery_directive_count = 0
    toc_pages_skipped = 0
    image_only_pending_ocr_doc_ids: list[str] = []

    for entry in raw_index.get("documents", []):
        if not str(entry.get("status") or "").startswith("EXTRACTED"):
            continue
        doc_path = ext_dir / str(entry["outputFile"])
        if not doc_path.is_file():
            continue
        doc = json.loads(doc_path.read_text(encoding="utf-8"))
        doc_id = str(doc.get("id") or "")
        doc_title = str(doc.get("title") or "").strip()
        doc_cat = str(doc.get("category") or "Annual Audit Report")
        years_list = [int(y) for y in doc.get("years", []) if str(y).isdigit()]
        if not years_list and doc_id in DOC_YEAR_FALLBACKS:
            years_list = list(DOC_YEAR_FALLBACKS[doc_id])
        if not years_list:
            yr_m = re.search(r"\b(1999|20[0-2]\d)\b", doc_title)
            if yr_m:
                years_list = [int(yr_m.group(1))]
        years_seen.update(years_list)
        primary_year = max(years_list) if years_list else None
        years_str = ",".join(str(y) for y in sorted(years_list))
        source_url = str(doc.get("sourceUrl") or "")
        sha256 = str(doc.get("sha256") or "")

        doc_issue_count = 0
        for pg in doc.get("pages", []):
            pno = int(pg.get("page") or 0)
            txt = str(pg.get("text") or "").strip()
            if not txt:
                continue

            for c_idx, chunk in enumerate(_chunk_text(txt)):
                chunk_rows.append(
                    (
                        doc_id,
                        doc_title,
                        doc_cat,
                        years_str,
                        primary_year,
                        pno,
                        c_idx,
                        source_url,
                        sha256,
                        chunk,
                    )
                )

            if is_toc_page(txt):
                toc_pages_skipped += 1
                continue
            candidates = _extract_page_candidates(txt, pno, doc_id)
            if not candidates:
                continue

            page_upper = normalize_mda_name(txt[:1600])
            mda_hit = _match_mda_from_text(page_upper, canonical_mdas)
            if mda_hit:
                mda_hit = (mda_hit[0], clean_display_name(mda_hit[1]) or mda_hit[1])

            for heading_raw, body_slice in candidates:
                issue_cat = _classify_audit_issue(heading_raw, body_slice)
                amt = _parse_naira_amount(f"{heading_raw} {body_slice[:450]}")
                is_repeat = bool(REPEAT_NEGLECT_RE.search(f"{heading_raw} {body_slice[:700]}"))
                is_recovery = bool(RECOVERY_DIRECTIVE_RE.search(f"{heading_raw} {body_slice[:850]}"))
                rec_match = RECOMMENDATION_RE.search(body_slice)
                recommendation_txt = rec_match.group(1).strip()[:200] if rec_match else ""

                if is_repeat:
                    repeat_neglect_count += 1
                if is_recovery:
                    recovery_directive_count += 1

                category_counts[issue_cat] += 1
                doc_issue_count += 1

                finding = {
                    "docId": doc_id,
                    "docTitle": doc_title,
                    "year": primary_year,
                    "page": pno,
                    "category": issue_cat,
                    "heading": heading_raw[:145],
                    "amountNaira": amt,
                    "mdaKey": mda_hit[0] if mda_hit else None,
                    "mdaName": mda_hit[1] if mda_hit else None,
                    "repeatNeglect": is_repeat,
                    "recoveryRequired": is_recovery,
                    "recommendation": recommendation_txt[:150],
                    "excerpt": body_slice[:160],
                    "sourceUrl": source_url,
                }
                all_issues.append(finding)

                if mda_hit:
                    m_key, m_name = mda_hit
                    bucket = mda_acc.setdefault(
                        m_key,
                        {
                            "mdaKey": m_key,
                            "mdaName": m_name,
                            "findingCount": 0,
                            "repeatNeglectCount": 0,
                            "recoveryDirectiveCount": 0,
                            "totalFlaggedNaira": 0,
                            "reportYears": set(),
                            "categories": defaultdict(int),
                            "sampleFindings": [],
                        },
                    )
                    bucket["findingCount"] += 1
                    if is_repeat:
                        bucket["repeatNeglectCount"] += 1
                    if is_recovery:
                        bucket["recoveryDirectiveCount"] += 1
                    bucket["totalFlaggedNaira"] += amt
                    if primary_year:
                        bucket["reportYears"].add(primary_year)
                    bucket["categories"][issue_cat] += 1
                    if len(bucket["sampleFindings"]) < 6:
                        bucket["sampleFindings"].append(
                            {
                                "docTitle": doc_title,
                                "year": primary_year,
                                "page": pno,
                                "category": issue_cat,
                                "heading": heading_raw[:140],
                                "amountNaira": amt,
                                "repeatNeglect": is_repeat,
                                "recoveryRequired": is_recovery,
                                "excerpt": body_slice[:200],
                                "sourceUrl": source_url,
                            }
                        )

        doc_diag = diagnose_oaugf_document_extraction(doc, doc_issue_count)
        if doc_diag["extractionStatus"] == "SCANNED_IMAGE_BODY_PENDING_OCR":
            image_only_pending_ocr_doc_ids.append(doc_id)

        documents_out.append(
            {
                "id": doc_id,
                "title": doc_title,
                "category": doc_cat,
                "years": sorted(years_list),
                "publishedDate": doc.get("publishedDate"),
                "pageCount": int(doc.get("pageCount") or 0),
                "nativePages": int(doc.get("nativePages") or 0),
                "ocrPages": int(doc.get("ocrPages") or 0),
                "substantivePagesCount": doc_diag["substantivePagesCount"],
                "extractionStatus": doc_diag["extractionStatus"],
                "extractionNote": doc_diag["extractionNote"],
                "issueCount": doc_issue_count,
                "sourceUrl": source_url,
                "sha256": sha256,
            }
        )

    by_mda_out: dict[str, dict[str, Any]] = {}
    for m_key, b in sorted(mda_acc.items(), key=lambda kv: (-kv[1]["findingCount"], -kv[1]["totalFlaggedNaira"])):
        by_mda_out[m_key] = {
            "mdaKey": m_key,
            "mdaName": b["mdaName"],
            "findingCount": b["findingCount"],
            "repeatNeglectCount": b["repeatNeglectCount"],
            "recoveryDirectiveCount": b["recoveryDirectiveCount"],
            "totalFlaggedNaira": b["totalFlaggedNaira"],
            "reportYears": sorted(b["reportYears"]),
            "categories": dict(sorted(b["categories"].items(), key=lambda kv: -kv[1])),
            "sampleFindings": b["sampleFindings"],
        }

    sorted_issues = sorted(
        all_issues,
        key=lambda x: (
            (x.get("year") or 0) >= 2019,
            x.get("repeatNeglect", False),
            x.get("amountNaira", 0),
            x.get("year") or 0,
        ),
        reverse=True,
    )
    top_issues = sorted_issues[:150]

    shards_by_bucket: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in sorted_issues:
        shards_by_bucket[_year_shard_bucket(item.get("year"))].append(item)

    shard_files_meta: list[dict[str, Any]] = []
    shards_dir = ds_dir / "oaugf_issues"
    if write:
        shards_dir.mkdir(parents=True, exist_ok=True)
    for b_key in sorted(shards_by_bucket.keys()):
        b_items = shards_by_bucket[b_key]
        rel_file = f"oaugf_issues/{b_key}.json"
        if write:
            _atomic_write_json(
                ds_dir / rel_file,
                {"bucket": b_key, "count": len(b_items), "issues": b_items},
            )
        shard_files_meta.append({"bucket": b_key, "path": rel_file, "count": len(b_items)})

    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "VERIFIED_OAUGF_AUDIT_INDEX",
        "headline": {
            "reportsIndexed": len(documents_out),
            "reportsWithFindingsCount": sum(1 for d in documents_out if d["issueCount"] > 0),
            "totalPages": sum(d["pageCount"] for d in documents_out),
            "totalChunks": len(chunk_rows),
            "yearsCovered": sorted(years_seen),
            "missingAnnualAuditYears": [yr for yr in range(2016, 2025) if yr not in years_seen],
            "tocPagesSkippedCount": toc_pages_skipped,
            "imageOnlyPendingOcrDocIds": image_only_pending_ocr_doc_ids,
            "parsedAuditIssuesCount": len(all_issues),
            "repeatNeglectCount": repeat_neglect_count,
            "recoveryDirectiveCount": recovery_directive_count,
            "matchedMdasCount": len(by_mda_out),
            "categoryCounts": dict(sorted(category_counts.items(), key=lambda kv: -kv[1])),
            "upstreamMissing404Count": len(UPSTREAM_404_MISSING_REPORTS),
        },
        "upstreamMissing404Reports": UPSTREAM_404_MISSING_REPORTS,
        "shardFiles": shard_files_meta,
        "documents": documents_out,
        "byMda": by_mda_out,
        "topIssues": top_issues,
        "issues": sorted_issues[:2200],
    }

    if write:
        out_index = ds_dir / "oaugf_audit_index.json"
        _atomic_write_json(out_index, payload)
        if fts_sqlite_path is not None:
            _write_oaugf_sqlite(Path(fts_sqlite_path), chunk_rows)
        try:
            from ingestion.checkpoints.phase4_checkpoint import record_phase4_checkpoint

            record_phase4_checkpoint(
                checkpoint_id="CP-1",
                stage="P4-S1",
                title="All-Years OAuGF Multi-Format Audit Recovery (1999-2024)",
                output_files=[out_index] + [ds_dir / s["path"] for s in shard_files_meta],
                metrics=payload["headline"],
            )
        except Exception:
            pass

    return payload


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build OAuGF FTS5 chunks and static audit index")
    parser.add_argument("--extracted-dir", default=str(DEFAULT_EXTRACTED_DIR))
    parser.add_argument("--datasets-dir", default=str(DEFAULT_DATASETS_DIR))
    parser.add_argument("--fts-sqlite", default=str(DEFAULT_FTS_SQLITE))
    parser.add_argument("--no-sqlite", action="store_true", help="Skip rewriting SQLite FTS5 tables")
    args = parser.parse_args()

    res = build_oaugf_index(
        extracted_dir=Path(args.extracted_dir),
        datasets_dir=Path(args.datasets_dir),
        fts_sqlite_path=None if args.no_sqlite else Path(args.fts_sqlite),
        write=True,
    )
    h = res["headline"]
    print(
        f"Indexed OAuGF: reports={h['reportsIndexed']}, pages={h['totalPages']:,}, "
        f"chunks={h['totalChunks']:,}, parsedIssues={h['parsedAuditIssuesCount']:,}, "
        f"matchedMDAs={h['matchedMdasCount']}"
    )
    print("Categories:", h["categoryCounts"])
