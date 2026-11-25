"""FastAPI Procurement & NOCOPO OCDS Contract Search Router."""

from __future__ import annotations

import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query

from backend.routers.search import sanitize_fts_query
from ingestion.parsers.contractors_leaderboard import canonical_contractor_key

router = APIRouter(prefix="/api/procurement", tags=["procurement"])

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_EXTERNAL_DB_PATH = PROJECT_ROOT / "backend" / "data" / "external_ledger_fts.sqlite"


def get_external_fts_db_path() -> Path:
    return Path(os.environ.get("BUDGETLENS_EXTERNAL_FTS_DB", str(DEFAULT_EXTERNAL_DB_PATH)))


def _open_conn() -> sqlite3.Connection | None:
    db_path = get_external_fts_db_path()
    if not db_path.exists():
        return None
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


@router.get("/search")
def search_procurement_contracts(
    q: str = Query(default="", max_length=200),
    year: int | None = Query(default=None, ge=1999, le=2030),
    stage: str | None = Query(default=None, max_length=24),
    matched_only: bool = Query(default=False),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=5000),
) -> dict[str, Any]:
    t0 = time.perf_counter()
    conn = _open_conn()
    if conn is None:
        return {
            "available": False,
            "query": q,
            "totalMatches": 0,
            "elapsedMs": 0.0,
            "results": [],
        }

    try:
        tbl_check = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='nocopo_contracts'"
        ).fetchone()
        if tbl_check is None:
            return {
                "available": False,
                "query": q,
                "totalMatches": 0,
                "elapsedMs": 0.0,
                "results": [],
            }

        fts_expr = sanitize_fts_query(q)
        where_clauses: list[str] = []
        params: list[Any] = []

        if fts_expr:
            where_clauses.append("nocopo_fts MATCH ?")
            params.append(fts_expr)
        if year is not None:
            where_clauses.append("c.financial_year = ?")
            params.append(year)
        if stage and stage.upper() != "ALL":
            where_clauses.append("c.stage = ?")
            params.append(stage.strip().lower())
        if matched_only:
            where_clauses.append("c.match_type != 'NO_PUBLIC_RECORD_FOUND'")

        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        join_sql = (
            "FROM nocopo_fts f JOIN nocopo_contracts c ON c.rowid = f.rowid"
            if fts_expr
            else "FROM nocopo_contracts c"
        )
        order_sql = (
            "ORDER BY bm25(nocopo_fts, 1.0, 4.0, 2.0, 3.0, 2.0, 3.0), c.contract_award_naira DESC"
            if fts_expr
            else "ORDER BY c.contract_award_naira DESC, c.financial_year DESC"
        )

        rows = conn.execute(
            f"""
            SELECT
                c.ocid, c.financial_year, c.stage, c.title, c.mda_name,
                c.buyer_admin_code, c.contractor_name, c.bpp_contractor_id,
                c.cac_rc_number, c.contract_award_naira, c.total_paid_naira,
                c.award_date, c.procurement_method, c.budget_record_id,
                c.project_code, c.match_type, c.confidence_score, c.source_file
            {join_sql}
            {where_sql}
            {order_sql}
            LIMIT ? OFFSET ?
            """,
            (*params, limit, offset),
        ).fetchall()

        total_row = conn.execute(
            f"SELECT COUNT(*) AS cnt {join_sql} {where_sql}",
            tuple(params),
        ).fetchone()
        total_matches = int(total_row["cnt"]) if total_row else len(rows)

        results = [
            {
                "ocdsReleaseId": r["ocid"],
                "financialYear": r["financial_year"],
                "stage": r["stage"],
                "budgetTitle": r["title"],
                "mdaName": r["mda_name"],
                "buyerAdminCode": r["buyer_admin_code"],
                "contractorName": r["contractor_name"] or None,
                "bppContractorId": r["bpp_contractor_id"] or None,
                "cacRcNumber": r["cac_rc_number"] or None,
                "contractAwardNaira": r["contract_award_naira"] or None,
                "totalPaidNaira": r["total_paid_naira"] or None,
                "awardDate": r["award_date"] or None,
                "procurementMethod": r["procurement_method"] or None,
                "budgetRecordId": r["budget_record_id"] or "",
                "projectCode": r["project_code"] or "",
                "matchType": r["match_type"],
                "confidenceScore": r["confidence_score"],
                "sourceUrlOrFile": r["source_file"],
            }
            for r in rows
        ]

        return {
            "available": True,
            "query": q,
            "totalMatches": total_matches,
            "elapsedMs": round((time.perf_counter() - t0) * 1000, 2),
            "results": results,
        }
    finally:
        conn.close()


DEFAULT_CONTRACTORS_JSON = PROJECT_ROOT / "public" / "datasets" / "contractors_leaderboard.json"
_CONTRACTORS_CACHE: dict[str, Any] = {"path": None, "mtime": None, "data": None}


def _load_contractors_leaderboard() -> dict[str, Any] | None:
    path = Path(os.environ.get("BUDGETLENS_CONTRACTORS_JSON", str(DEFAULT_CONTRACTORS_JSON)))
    if not path.exists():
        return None
    mtime = path.stat().st_mtime
    if (
        _CONTRACTORS_CACHE["data"] is not None
        and _CONTRACTORS_CACHE["path"] == str(path)
        and _CONTRACTORS_CACHE["mtime"] == mtime
    ):
        return _CONTRACTORS_CACHE["data"]
    data = json.loads(path.read_text(encoding="utf-8"))
    _CONTRACTORS_CACHE.update({"path": str(path), "mtime": mtime, "data": data})
    return data


@router.get("/contractors")
def get_contractors_leaderboard(
    q: str = Query(default="", max_length=200),
    sort: str = Query(default="amount", pattern="^(amount|count|govspend|mdas)$"),
    min_awards: int = Query(default=1, ge=1, le=500),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=50000),
) -> dict[str, Any]:
    data = _load_contractors_leaderboard()
    if data is None:
        return {
            "available": False,
            "totalMatches": 0,
            "totalDistinctContractors": 0,
            "results": [],
        }

    q_low = q.strip().lower()
    filtered: list[dict[str, Any]] = []
    for c in data.get("contractors", []):
        if int(c.get("contractCount", 0)) < min_awards:
            continue
        if q_low:
            hay = " ".join(
                [
                    str(c.get("contractorName") or ""),
                    str(c.get("bppContractorId") or ""),
                    " ".join(c.get("topMdas") or []),
                ]
            ).lower()
            if q_low not in hay:
                continue
        filtered.append(c)

    if sort == "count":
        filtered.sort(key=lambda x: (int(x.get("contractCount", 0)), int(x.get("totalContractedNaira", 0))), reverse=True)
    elif sort == "govspend":
        filtered.sort(key=lambda x: (int(x.get("govspendPaidNaira", 0)), int(x.get("totalContractedNaira", 0))), reverse=True)
    elif sort == "mdas":
        filtered.sort(key=lambda x: (int(x.get("mdaCount", 0)), int(x.get("contractCount", 0))), reverse=True)
    else:
        filtered.sort(key=lambda x: (int(x.get("totalContractedNaira", 0)), int(x.get("contractCount", 0))), reverse=True)

    return {
        "available": True,
        "totalMatches": len(filtered),
        "totalDistinctContractors": data.get("totalDistinctContractors", 0),
        "awardCoverageYears": data.get("awardCoverageYears", "2001–2026"),
        "treasuryCoverageRange": data.get("treasuryCoverageRange", "2018-09-01 to 2026-06-19"),
        "coverageNote": data.get("coverageNote", ""),
        "results": filtered[offset : offset + limit],
    }


@router.get("/contractor-history")
def get_contractor_history(
    name: str = Query(..., min_length=2, max_length=200),
    limit: int = Query(default=100, ge=1, le=500),
) -> dict[str, Any]:
    t0 = time.perf_counter()
    key = canonical_contractor_key(name)
    if not key:
        return {
            "available": False,
            "contractorName": name,
            "canonicalKey": "",
            "contracts": [],
            "payments": [],
        }

    candidates = (key, f"M S {key}", f"MS {key}", f"MESSRS {key}")
    conn = _open_conn()
    if conn is None:
        return {
            "available": False,
            "contractorName": name,
            "canonicalKey": key,
            "contracts": [],
            "payments": [],
        }

    try:
        tables = {
            r["name"]
            for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
        if "nocopo_contracts" not in tables:
            return {
                "available": False,
                "contractorName": name,
                "canonicalKey": key,
                "contracts": [],
                "payments": [],
            }

        c_agg = conn.execute(
            """
            SELECT COUNT(*) AS cnt,
                   COALESCE(SUM(contract_award_naira), 0) AS awarded,
                   COALESCE(SUM(total_paid_naira), 0) AS paid
            FROM nocopo_contracts
            WHERE norm_contractor IN (?, ?, ?, ?) AND contract_award_naira > 0
            """,
            candidates,
        ).fetchone()

        c_rows = conn.execute(
            """
            SELECT ocid, financial_year, stage, title, mda_name, contractor_name,
                   bpp_contractor_id, contract_award_naira, total_paid_naira,
                   award_date, procurement_method, project_code, match_type
            FROM nocopo_contracts
            WHERE norm_contractor IN (?, ?, ?, ?) AND contract_award_naira > 0
            ORDER BY financial_year DESC, contract_award_naira DESC
            LIMIT ?
            """,
            (*candidates, limit),
        ).fetchall()

        contracts = [
            {
                "ocdsReleaseId": r["ocid"],
                "financialYear": int(r["financial_year"] or 0),
                "stage": r["stage"] or "award",
                "budgetTitle": r["title"] or "",
                "mdaName": r["mda_name"] or "",
                "contractorName": r["contractor_name"] or name,
                "bppContractorId": r["bpp_contractor_id"] or None,
                "contractAwardNaira": int(r["contract_award_naira"] or 0),
                "totalPaidNaira": int(r["total_paid_naira"] or 0),
                "awardDate": r["award_date"] or None,
                "procurementMethod": r["procurement_method"] or None,
                "projectCode": r["project_code"] or "",
                "matchType": r["match_type"] or "",
            }
            for r in c_rows
        ]

        total_gov_cnt = 0
        total_gov_amt = 0
        payments: list[dict[str, Any]] = []
        if "govspend_payments" in tables:
            g_agg = conn.execute(
                """
                SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_naira), 0) AS amt
                FROM govspend_payments
                WHERE norm_beneficiary IN (?, ?, ?, ?) AND amount_naira > 0
                """,
                candidates,
            ).fetchone()
            total_gov_cnt = int(g_agg["cnt"] or 0) if g_agg else 0
            total_gov_amt = int(g_agg["amt"] or 0) if g_agg else 0

            g_rows = conn.execute(
                """
                SELECT payment_no, payment_date, financial_year, payer_code,
                       organization_name, beneficiary_name, amount_naira, description
                FROM govspend_payments
                WHERE norm_beneficiary IN (?, ?, ?, ?) AND amount_naira > 0
                ORDER BY payment_date DESC, amount_naira DESC
                LIMIT ?
                """,
                (*candidates, limit),
            ).fetchall()
            payments = [
                {
                    "paymentNo": r["payment_no"] or "",
                    "paymentDate": r["payment_date"] or "",
                    "financialYear": int(r["financial_year"] or 0),
                    "payerCode": r["payer_code"] or "",
                    "organizationName": r["organization_name"] or "",
                    "beneficiaryName": r["beneficiary_name"] or "",
                    "amountNaira": int(r["amount_naira"] or 0),
                    "description": r["description"] or "",
                }
                for r in g_rows
            ]

        return {
            "available": True,
            "contractorName": name,
            "canonicalKey": key,
            "totalContracts": int(c_agg["cnt"] or 0) if c_agg else len(contracts),
            "totalContractedNaira": int(c_agg["awarded"] or 0) if c_agg else 0,
            "totalNocopoDisbursedNaira": int(c_agg["paid"] or 0) if c_agg else 0,
            "contracts": contracts,
            "totalGovspendCount": total_gov_cnt,
            "totalGovspendNaira": total_gov_amt,
            "payments": payments,
            "elapsedMs": round((time.perf_counter() - t0) * 1000, 2),
        }
    finally:
        conn.close()
