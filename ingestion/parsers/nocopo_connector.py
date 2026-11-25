"""NOCOPO (OCDS) & CAC Beneficial-Ownership Procurement Connector.

Ingests official Open Contracting Data Standard (OCDS) `releases`/`records` JSON
snapshots (from `NocopoJson/` or `procurement_data/`) and cross-links them to
ingested budget line items via:
  1. `EXACT_ERGP_CODE` (extracting ERGP codes from `planning.budget.description`,
     `planning.budget.project`, `tender.title`, and `awards[].title`)
  2. `HIGH_CONFIDENCE_FUZZY` (normalized MDA / core MDA + token Jaccard >= 0.72)

Also deduplicates multi-stage releases by `ocid`, resolves BPP Contractor IDs from
top-level `parties[]` without mislabeling them as CAC RC numbers, extracts
`contracts[].implementation.transactions[]` disbursements, sanitizes out-of-range
typo years, writes `public/datasets/procurement_links.json`, and indexes all
deduplicated contracts into `backend/data/external_ledger_fts.sqlite`.
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

from ingestion.parsers.entity_normalizer import (
    extract_bpp_contractor_id,
    extract_ergp_codes,
    mda_core_key,
    normalize_admin_code,
    normalize_entity_name,
    normalize_mda_name,
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PROC_DIR = PROJECT_ROOT / "procurement_data"
DEFAULT_NOCOPO_DIR = PROJECT_ROOT / "NocopoJson"
DEFAULT_DATASETS_DIR = PROJECT_ROOT / "public" / "datasets"
DEFAULT_FTS_SQLITE = PROJECT_ROOT / "backend" / "data" / "external_ledger_fts.sqlite"

STAGE_PRIORITY = {
    "planning": 1,
    "tender": 2,
    "award": 3,
    "contract": 4,
    "implementation": 5,
}


def _normalize_text(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(text or "").lower()).strip()


def _normalize_code(code: str) -> str:
    c = re.sub(r"[^A-Z0-9]", "", str(code or "").upper())
    if len(c) < 4 or c in {"ERGP", "NONE", "N/A"}:
        return ""
    return c


def _token_jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    if inter == 0:
        return 0.0
    return inter / len(a | b)


def _stage_rank(rel: dict[str, Any]) -> tuple[int, str]:
    tags = [str(t).lower() for t in (rel.get("tag") or []) if isinstance(t, str)]
    max_tag = max((STAGE_PRIORITY.get(t, 0) for t in tags), default=0)
    if rel.get("contracts"):
        for c in rel["contracts"]:
            if isinstance(c, dict) and (c.get("implementation") or {}).get("transactions"):
                max_tag = max(max_tag, 5)
                break
        max_tag = max(max_tag, 4)
    elif rel.get("awards"):
        max_tag = max(max_tag, 3)
    elif rel.get("tender"):
        max_tag = max(max_tag, 2)
    elif rel.get("planning"):
        max_tag = max(max_tag, 1)
    dt = str(rel.get("date") or "")[:19]
    return (max_tag, dt)


def _merge_ocid_releases(existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    """Keep highest-maturity release for an `ocid` while preserving planning/parties/buyer fields."""
    if _stage_rank(incoming) >= _stage_rank(existing):
        primary, secondary = dict(incoming), existing
    else:
        primary, secondary = dict(existing), incoming

    for key in ("planning", "buyer", "tender", "awards", "contracts", "parties"):
        if not primary.get(key) and secondary.get(key):
            primary[key] = secondary[key]
    if not primary.get("_sourceFile") and secondary.get("_sourceFile"):
        primary["_sourceFile"] = secondary["_sourceFile"]
    return primary


def deduplicate_releases_by_ocid(releases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse multi-stage OCDS releases sharing the same `ocid` into one record."""
    by_ocid: dict[str, dict[str, Any]] = {}
    no_ocid: list[dict[str, Any]] = []
    for rel in releases:
        if not isinstance(rel, dict):
            continue
        ocid = str(rel.get("ocid") or "").strip()
        if not ocid:
            no_ocid.append(rel)
            continue
        if ocid in by_ocid:
            by_ocid[ocid] = _merge_ocid_releases(by_ocid[ocid], rel)
        else:
            by_ocid[ocid] = rel
    return list(by_ocid.values()) + no_ocid


def _load_ocds_releases(proc_dir: Path) -> list[dict[str, Any]]:
    releases: list[dict[str, Any]] = []
    if not proc_dir.exists():
        return releases

    for json_file in sorted(proc_dir.rglob("*.json")):
        try:
            data = json.loads(json_file.read_text(encoding="utf-8"))
        except Exception:
            continue
        raw_list: list[dict[str, Any]] = []
        if isinstance(data, dict):
            if isinstance(data.get("releases"), list):
                raw_list = data["releases"]
            elif isinstance(data.get("records"), list):
                for rec in data["records"]:
                    if isinstance(rec, dict) and isinstance(rec.get("compiledRelease"), dict):
                        raw_list.append(rec["compiledRelease"])
            elif "ocid" in data:
                raw_list = [data]
        elif isinstance(data, list):
            raw_list = data

        for rel in raw_list:
            if not isinstance(rel, dict):
                continue
            rel["_sourceFile"] = json_file.name
            releases.append(rel)
    return releases


def _sanitize_year_hint(*candidates: str | None) -> int | None:
    """Return the first valid fiscal year in 1999..2026 from date/title candidates."""
    for raw in candidates:
        if not raw:
            continue
        for m in re.finditer(r"\b(1999|20[0-2]\d)\b", str(raw)):
            yr = int(m.group(1))
            if 1999 <= yr <= 2026:
                return yr
    return None


def _extract_release_fields(rel: dict[str, Any]) -> dict[str, Any]:
    ocid = str(rel.get("ocid") or rel.get("id") or "").strip()
    tender = rel.get("tender") if isinstance(rel.get("tender"), dict) else {}
    buyer = rel.get("buyer") if isinstance(rel.get("buyer"), dict) else {}
    planning = rel.get("planning") if isinstance(rel.get("planning"), dict) else {}
    budget = planning.get("budget") if isinstance(planning.get("budget"), dict) else {}
    awards = rel.get("awards") if isinstance(rel.get("awards"), list) else []
    contracts = rel.get("contracts") if isinstance(rel.get("contracts"), list) else []
    parties = rel.get("parties") if isinstance(rel.get("parties"), list) else []

    first_award = awards[0] if awards and isinstance(awards[0], dict) else {}
    suppliers = first_award.get("suppliers") if isinstance(first_award.get("suppliers"), list) else []
    first_supplier = suppliers[0] if suppliers and isinstance(suppliers[0], dict) else {}

    # Prefer rich project/tender title over generic award title when available
    title = str(
        budget.get("project")
        or tender.get("title")
        or first_award.get("title")
        or budget.get("description")
        or rel.get("title")
        or ""
    ).strip()
    if title.upper().startswith("ERGP") and len(title) < 20 and budget.get("project"):
        title = str(budget.get("project")).strip()

    mda = str(
        buyer.get("name")
        or (tender.get("procuringEntity") or {}).get("name")
        or ""
    ).strip()
    buyer_admin_code = normalize_admin_code(str(buyer.get("id") or ""))

    # Extract ERGP codes from all relevant text fields (e.g. planning.budget.description)
    ergp_blob = " ".join(
        str(x or "")
        for x in (
            tender.get("id"),
            budget.get("id"),
            budget.get("description"),
            budget.get("project"),
            tender.get("title"),
            first_award.get("title"),
        )
    )
    ergp_codes = extract_ergp_codes(ergp_blob)
    project_code_hint = ergp_codes[0] if ergp_codes else _normalize_code(str(tender.get("id") or budget.get("id") or ""))

    value_obj = first_award.get("value") or tender.get("value") or budget.get("amount") or {}
    if not isinstance(value_obj, dict):
        value_obj = {}
    try:
        award_amt = int(round(float(value_obj.get("amount") or 0)))
    except Exception:
        award_amt = 0

    # Sum contract implementation transactions when present
    paid_amt = 0
    has_impl_tx = False
    for c in contracts:
        if not isinstance(c, dict):
            continue
        impl = c.get("implementation") if isinstance(c.get("implementation"), dict) else {}
        for tx in (impl.get("transactions") or []):
            if not isinstance(tx, dict):
                continue
            val = tx.get("value") if isinstance(tx.get("value"), dict) else {}
            try:
                amt = int(round(float(val.get("amount") or 0)))
            except Exception:
                amt = 0
            if amt > 0:
                paid_amt += amt
                has_impl_tx = True

    # Resolve supplier name, BPP Contractor ID (from parties[]), and true CAC RC number (if any)
    contractor = str(first_supplier.get("name") or "").strip() or None
    supplier_ref_id = str(first_supplier.get("id") or "").strip()

    bpp_contractor_id: str | None = extract_bpp_contractor_id(supplier_ref_id)
    cac_rc_number: str | None = None

    sup_ident_id = str((first_supplier.get("identifier") or {}).get("id") or "").strip()
    if sup_ident_id:
        bpp_from_ident = extract_bpp_contractor_id(sup_ident_id)
        if bpp_from_ident:
            bpp_contractor_id = bpp_contractor_id or bpp_from_ident
        elif "RC" in sup_ident_id.upper() or (first_supplier.get("identifier") or {}).get("scheme") == "NG-CAC":
            cac_rc_number = sup_ident_id

    for pt in parties:
        if not isinstance(pt, dict):
            continue
        roles = [str(r).lower() for r in (pt.get("roles") or [])]
        is_supplier_party = "supplier" in roles or (supplier_ref_id and pt.get("id") == supplier_ref_id)
        if not is_supplier_party:
            continue
        if not contractor and pt.get("name"):
            contractor = str(pt.get("name")).strip() or None
        pt_ident = pt.get("identifier") if isinstance(pt.get("identifier"), dict) else {}
        pt_id_str = str(pt_ident.get("id") or pt.get("id") or "").strip()
        if not bpp_contractor_id:
            bpp_contractor_id = extract_bpp_contractor_id(pt_id_str)
        if not cac_rc_number and pt_id_str and not extract_bpp_contractor_id(pt_id_str):
            if "RC" in pt_id_str.upper() or pt_ident.get("scheme") == "NG-CAC":
                cac_rc_number = pt_id_str

    beneficial_owners = [
        str(bo.get("name") or "").strip()
        for bo in (first_supplier.get("beneficialOwners") or [])
        if isinstance(bo, dict) and str(bo.get("name") or "").strip()
    ]

    first_contract = contracts[0] if contracts and isinstance(contracts[0], dict) else {}
    raw_award_date = str(first_award.get("date") or first_contract.get("dateSigned") or rel.get("date") or "")[:10] or None
    year_hint = _sanitize_year_hint(
        str(first_award.get("date") or ""),
        str(first_contract.get("dateSigned") or ""),
        str(rel.get("date") or ""),
        title,
    )
    if raw_award_date and re.match(r"^\d{4}", raw_award_date):
        y_num = int(raw_award_date[:4])
        if not (1999 <= y_num <= 2026):
            raw_award_date = None

    stage = "planning"
    if has_impl_tx or "implementation" in [str(t).lower() for t in (rel.get("tag") or [])]:
        stage = "implementation"
    elif contracts:
        stage = "contract"
    elif awards:
        stage = "award"
    elif tender:
        stage = "tender"

    norm_mda = normalize_mda_name(mda)
    core_mda = mda_core_key(mda)

    return {
        "ocdsReleaseId": ocid or None,
        "stage": stage,
        "projectCodeHint": project_code_hint,
        "ergpCodes": ergp_codes,
        "title": title,
        "normTitle": _normalize_text(title),
        "tokens": {t for t in _normalize_text(title).split() if len(t) >= 3},
        "mdaName": mda,
        "normMda": norm_mda,
        "coreMda": core_mda,
        "buyerAdminCode": buyer_admin_code,
        "contractorName": contractor,
        "normContractor": normalize_entity_name(contractor),
        "bppContractorId": bpp_contractor_id,
        "cacRcNumber": cac_rc_number,
        "beneficialOwners": beneficial_owners,
        "contractAwardNaira": award_amt if award_amt > 0 else None,
        "totalPaidNaira": paid_amt if paid_amt > 0 else None,
        "awardDate": raw_award_date,
        "procurementMethod": str(tender.get("procurementMethodDetails") or tender.get("procurementMethod") or "") or None,
        "yearHint": year_hint,
        "sourceUrlOrFile": str(rel.get("_sourceFile") or "NocopoJson/"),
    }


def match_ocds_to_budget_records(
    releases: list[dict[str, Any]],
    budget_records: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Cross-links OCDS releases to ingested budget records using indexed ERGP + MDA-token lookup."""
    deduped = deduplicate_releases_by_ocid(releases)

    by_code: dict[str, list[dict[str, Any]]] = defaultdict(list)
    mda_records: dict[str, list[tuple[dict[str, Any], set[str]]]] = defaultdict(list)
    mda_token_index: dict[str, dict[str, list[int]]] = defaultdict(lambda: defaultdict(list))

    for rec in budget_records:
        ident = rec.get("recordIdentity") or {}
        mda = rec.get("mdaGovernanceTaxonomy") or {}
        nc = _normalize_code(str(ident.get("projectCode") or ""))
        if nc:
            by_code[nc].append(rec)

        mda_raw = str(mda.get("mdaName") or "")
        norm_m = normalize_mda_name(mda_raw)
        core_m = mda_core_key(mda_raw)
        title_toks = {t for t in _normalize_text(str(ident.get("verbatimProjectName") or "")).split() if len(t) >= 3}
        if not title_toks:
            continue

        for mkey in {k for k in (norm_m, core_m) if k}:
            rec_idx = len(mda_records[mkey])
            mda_records[mkey].append((rec, title_toks))
            for tok in title_toks:
                mda_token_index[mkey][tok].append(rec_idx)

    links: list[dict[str, Any]] = []
    for raw_rel in deduped:
        rel = _extract_release_fields(raw_rel)
        matched_rec: dict[str, Any] | None = None
        match_type = "NO_PUBLIC_RECORD_FOUND"
        confidence = 0.0

        # Tier 1: Exact ERGP code (checking all extracted ERGP codes + projectCodeHint)
        code_candidates = list(rel["ergpCodes"])
        if rel["projectCodeHint"] and rel["projectCodeHint"] not in code_candidates:
            code_candidates.append(rel["projectCodeHint"])

        for code_key in code_candidates:
            if code_key in by_code:
                cands = by_code[code_key]
                if rel["yearHint"]:
                    yr_cands = [c for c in cands if (c.get("recordIdentity") or {}).get("financialYear") == rel["yearHint"]]
                    matched_rec = yr_cands[0] if yr_cands else cands[0]
                else:
                    matched_rec = cands[0]
                match_type = "EXACT_ERGP_CODE"
                confidence = 1.0
                break

        # Tier 2: Same normalized/core MDA + inverted token-index Jaccard >= 0.72
        if matched_rec is None and len(rel["tokens"]) >= 3:
            mkey = rel["normMda"] if rel["normMda"] in mda_records else (rel["coreMda"] if rel["coreMda"] in mda_records else "")
            if mkey:
                tok_idx = mda_token_index[mkey]
                overlap_counts: dict[int, int] = defaultdict(int)
                for tok in rel["tokens"]:
                    for ridx in tok_idx.get(tok, ()):
                        overlap_counts[ridx] += 1

                min_overlap = max(2, int(len(rel["tokens"]) * 0.6))
                best_sim = 0.7199
                recs_for_mda = mda_records[mkey]
                for ridx, ov in overlap_counts.items():
                    if ov < min_overlap:
                        continue
                    cand, ctoks = recs_for_mda[ridx]
                    sim = _token_jaccard(rel["tokens"], ctoks)
                    if sim > best_sim:
                        best_sim = sim
                        matched_rec = cand
                if matched_rec is not None:
                    match_type = "HIGH_CONFIDENCE_FUZZY"
                    confidence = round(best_sim, 3)

        if matched_rec is not None:
            ident = matched_rec.get("recordIdentity") or {}
            links.append(
                {
                    "budgetRecordId": str(ident.get("id") or ""),
                    "financialYear": int(ident.get("financialYear") or rel["yearHint"] or 0),
                    "projectCode": str(ident.get("projectCode") or rel["projectCodeHint"] or ""),
                    "budgetTitle": str(ident.get("verbatimProjectName") or rel["title"]),
                    "mdaName": str((matched_rec.get("mdaGovernanceTaxonomy") or {}).get("mdaName") or rel["mdaName"]),
                    "matchType": match_type,
                    "confidenceScore": confidence,
                    "ocdsReleaseId": rel["ocdsReleaseId"],
                    "stage": rel["stage"],
                    "contractorName": rel["contractorName"],
                    "bppContractorId": rel["bppContractorId"],
                    "cacRcNumber": rel["cacRcNumber"],
                    "beneficialOwners": rel["beneficialOwners"],
                    "contractAwardNaira": rel["contractAwardNaira"],
                    "totalPaidNaira": rel["totalPaidNaira"],
                    "awardDate": rel["awardDate"],
                    "procurementMethod": rel["procurementMethod"],
                    "sourceUrlOrFile": rel["sourceUrlOrFile"],
                }
            )

    return links


def compute_contractor_concentration(links: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Aggregate awarded contracts & disbursements by normalized contractor name."""
    by_contractor: dict[str, dict[str, Any]] = {}
    for link in links:
        name = link.get("contractorName")
        if not name:
            continue
        key = normalize_entity_name(name) or name.upper()
        entry = by_contractor.setdefault(
            key,
            {
                "contractorName": name,
                "bppContractorId": link.get("bppContractorId"),
                "cacRcNumber": link.get("cacRcNumber"),
                "beneficialOwners": link.get("beneficialOwners") or [],
                "awardCount": 0,
                "totalAwardNaira": 0,
                "totalPaidNaira": 0,
                "mdas": set(),
            },
        )
        if not entry["bppContractorId"] and link.get("bppContractorId"):
            entry["bppContractorId"] = link.get("bppContractorId")
        if not entry["cacRcNumber"] and link.get("cacRcNumber"):
            entry["cacRcNumber"] = link.get("cacRcNumber")
        entry["awardCount"] += 1
        entry["totalAwardNaira"] += int(link.get("contractAwardNaira") or 0)
        entry["totalPaidNaira"] += int(link.get("totalPaidNaira") or 0)
        if link.get("mdaName"):
            entry["mdas"].add(link["mdaName"])

    ranked = [
        {
            "contractorName": v["contractorName"],
            "bppContractorId": v["bppContractorId"],
            "cacRcNumber": v["cacRcNumber"],
            "beneficialOwners": v["beneficialOwners"],
            "awardCount": v["awardCount"],
            "totalAwardNaira": v["totalAwardNaira"],
            "totalPaidNaira": v["totalPaidNaira"],
            "mdas": sorted(v["mdas"]),
        }
        for v in by_contractor.values()
    ]
    ranked.sort(key=lambda x: (-x["totalAwardNaira"], -x["awardCount"]))
    return ranked[:50]


def _write_nocopo_fts_sqlite(
    db_path: Path,
    extracted_releases: list[dict[str, Any]],
    links_by_ocid: dict[str, dict[str, Any]],
) -> None:
    """Persist all deduplicated NOCOPO records with awards/tenders/links into FTS5 SQLite."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = Path(str(db_path) + ".tmp")
    if tmp_path.exists():
        tmp_path.unlink()

    if db_path.exists():
        # Copy existing DB to tmp so other tables (e.g. govspend, policy) are preserved
        import shutil
        shutil.copy2(db_path, tmp_path)

    conn = sqlite3.connect(str(tmp_path))
    try:
        conn.execute("DROP TABLE IF EXISTS nocopo_fts")
        conn.execute("DROP TABLE IF EXISTS nocopo_contracts")
        conn.execute(
            """
            CREATE TABLE nocopo_contracts (
                ocid TEXT PRIMARY KEY,
                financial_year INTEGER,
                stage TEXT,
                title TEXT,
                mda_name TEXT,
                norm_mda TEXT,
                buyer_admin_code TEXT,
                contractor_name TEXT,
                norm_contractor TEXT,
                bpp_contractor_id TEXT,
                cac_rc_number TEXT,
                contract_award_naira INTEGER,
                total_paid_naira INTEGER,
                award_date TEXT,
                procurement_method TEXT,
                budget_record_id TEXT,
                project_code TEXT,
                match_type TEXT,
                confidence_score REAL,
                source_file TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE VIRTUAL TABLE nocopo_fts USING fts5(
                ocid,
                title,
                mda_name,
                contractor_name,
                bpp_contractor_id,
                project_code,
                content='nocopo_contracts',
                content_rowid='rowid'
            )
            """
        )

        rows_to_insert = []
        for rel in extracted_releases:
            ocid = rel.get("ocdsReleaseId")
            if not ocid:
                continue
            link = links_by_ocid.get(ocid) or {}
            rows_to_insert.append(
                (
                    ocid,
                    link.get("financialYear") or rel.get("yearHint") or 0,
                    rel.get("stage"),
                    rel.get("title") or "",
                    rel.get("mdaName") or "",
                    rel.get("normMda") or "",
                    rel.get("buyerAdminCode") or "",
                    rel.get("contractorName") or "",
                    rel.get("normContractor") or "",
                    rel.get("bppContractorId") or "",
                    rel.get("cacRcNumber") or "",
                    int(rel.get("contractAwardNaira") or 0),
                    int(rel.get("totalPaidNaira") or 0),
                    rel.get("awardDate") or "",
                    rel.get("procurementMethod") or "",
                    link.get("budgetRecordId") or "",
                    link.get("projectCode") or rel.get("projectCodeHint") or "",
                    link.get("matchType") or "NO_PUBLIC_RECORD_FOUND",
                    float(link.get("confidenceScore") or 0.0),
                    rel.get("sourceUrlOrFile") or "",
                )
            )

        conn.executemany(
            """
            INSERT OR REPLACE INTO nocopo_contracts (
                ocid, financial_year, stage, title, mda_name, norm_mda,
                buyer_admin_code, contractor_name, norm_contractor,
                bpp_contractor_id, cac_rc_number, contract_award_naira,
                total_paid_naira, award_date, procurement_method,
                budget_record_id, project_code, match_type, confidence_score,
                source_file
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows_to_insert,
        )
        conn.execute("INSERT INTO nocopo_fts(nocopo_fts) VALUES ('rebuild')")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_nocopo_year ON nocopo_contracts(financial_year)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_nocopo_stage ON nocopo_contracts(stage)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_nocopo_norm_contractor ON nocopo_contracts(norm_contractor)")
        conn.commit()
    finally:
        conn.close()

    for attempt in range(5):
        try:
            os.replace(tmp_path, db_path)
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.2)


def _atomic_write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = str(path) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"), ensure_ascii=False)
    for attempt in range(5):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.2)


def build_procurement_links(
    proc_dir: str | Path = DEFAULT_PROC_DIR,
    datasets_dir: str | Path = DEFAULT_DATASETS_DIR,
    fts_sqlite_path: str | Path | None = DEFAULT_FTS_SQLITE,
    write: bool = True,
) -> dict[str, Any]:
    """Ingest OCDS releases, deduplicate by ocid, cross-link to budget records, and persist artifacts."""
    p_dir = Path(proc_dir)
    if p_dir == DEFAULT_PROC_DIR:
        has_proc_json = p_dir.exists() and any(p_dir.rglob("*.json"))
        if not has_proc_json and DEFAULT_NOCOPO_DIR.exists():
            p_dir = DEFAULT_NOCOPO_DIR

    ds_dir = Path(datasets_dir)
    raw_releases = _load_ocds_releases(p_dir)

    if not raw_releases:
        payload = {
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "status": "AWAITING_PROCUREMENT_DROP",
            "dropFolder": "procurement_data/",
            "dropInstructions": (
                "Official NOCOPO (OCDS) / BPP contract award JSON snapshots have not been ingested yet. "
                "Place OCDS release JSON files into procurement_data/ or NocopoJson/ and run `python -m ingestion.parsers.nocopo_connector`."
            ),
            "releasesScanned": 0,
            "deduplicatedOcidCount": 0,
            "stageBreakdown": {
                "planningOnlyCount": 0,
                "tenderCount": 0,
                "awardedCount": 0,
                "implementationCount": 0,
            },
            "matchedCount": 0,
            "totalAwardNaira": 0,
            "totalDisbursedNaira": 0,
            "contractorConcentration": [],
            "links": [],
        }
        if write:
            _atomic_write_json(ds_dir / "procurement_links.json", payload)
        return payload

    deduped = deduplicate_releases_by_ocid(raw_releases)
    extracted = [_extract_release_fields(r) for r in deduped]

    stage_breakdown = {
        "planningOnlyCount": sum(1 for r in extracted if r["stage"] == "planning"),
        "tenderCount": sum(1 for r in extracted if r["stage"] == "tender"),
        "awardedCount": sum(1 for r in extracted if r["stage"] in {"award", "contract", "implementation"}),
        "implementationCount": sum(1 for r in extracted if r["stage"] == "implementation"),
    }

    db_dir = ds_dir / "db"
    all_records: list[dict[str, Any]] = []
    if db_dir.exists():
        for ydir in sorted(d for d in db_dir.iterdir() if d.is_dir() and d.name.isdigit()):
            rec_path = ydir / "records.json"
            if rec_path.exists():
                raw = json.loads(rec_path.read_text(encoding="utf-8"))
                all_records.extend(raw if isinstance(raw, list) else raw.get("records", []))

    links = match_ocds_to_budget_records(deduped, all_records)
    links_by_ocid = {str(l["ocdsReleaseId"]): l for l in links if l.get("ocdsReleaseId")}

    # Aggregate contractor concentration across ALL deduplicated awarded releases
    awarded_records = [r for r in extracted if r.get("contractorName")]
    concentration = compute_contractor_concentration(awarded_records)

    total_award_all = sum(int(r.get("contractAwardNaira") or 0) for r in awarded_records)
    total_disbursed_all = sum(int(r.get("totalPaidNaira") or 0) for r in awarded_records)

    # Sort links by confidence + award value descending for static preview
    links.sort(key=lambda x: (-float(x.get("confidenceScore") or 0), -int(x.get("contractAwardNaira") or 0)))

    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "VERIFIED_OCDS_SNAPSHOT",
        "dropFolder": str(p_dir.name) + "/",
        "dropInstructions": "Drop updated NOCOPO OCDS JSON snapshots into NocopoJson/ or procurement_data/ and re-run nocopo_connector.",
        "releasesScanned": len(raw_releases),
        "deduplicatedOcidCount": len(deduped),
        "stageBreakdown": stage_breakdown,
        "matchedCount": len(links),
        "totalAwardNaira": total_award_all,
        "totalDisbursedNaira": total_disbursed_all,
        "contractorConcentration": concentration,
        "links": links[:500],
    }
    if write:
        _atomic_write_json(ds_dir / "procurement_links.json", payload)
        if fts_sqlite_path is not None:
            _write_nocopo_fts_sqlite(Path(fts_sqlite_path), extracted, links_by_ocid)
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Build BudgetLens NOCOPO/CAC Procurement Links")
    parser.add_argument("--proc", type=str, default=str(DEFAULT_PROC_DIR))
    parser.add_argument("--datasets", type=str, default=str(DEFAULT_DATASETS_DIR))
    parser.add_argument("--sqlite", type=str, default=str(DEFAULT_FTS_SQLITE))
    args = parser.parse_args()

    out = build_procurement_links(args.proc, args.datasets, args.sqlite, write=True)
    sb = out.get("stageBreakdown", {})
    print(
        f"Procurement Bridge [{out['status']}]: raw={out['releasesScanned']} | dedup={out.get('deduplicatedOcidCount', 0)} | "
        f"awarded={sb.get('awardedCount', 0)} | impl={sb.get('implementationCount', 0)} | "
        f"matched={out['matchedCount']} | totalAward=NGN {out['totalAwardNaira']/1e9:.2f}B | "
        f"disbursed=NGN {out.get('totalDisbursedNaira', 0)/1e9:.2f}B"
    )


if __name__ == "__main__":
    main()
