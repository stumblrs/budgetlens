"""FastAPI GovSpend Open Treasury Expenditure Search Router."""

from __future__ import annotations

import os
import sqlite3
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query

from backend.routers.search import sanitize_fts_query
from ingestion.parsers.entity_normalizer import normalize_entity_name

router = APIRouter(prefix="/api/expenditures", tags=["expenditures"])

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
def search_expenditures(
    q: str = Query(default="", max_length=200),
    year: int | None = Query(default=None, ge=2018, le=2030),
    mda: str | None = Query(default=None, max_length=120),
    min_amount: int | None = Query(default=None, ge=0),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=5000),
) -> dict[str, Any]:
    t0 = time.perf_counter()
    conn = _open_conn()
    if conn is None:
        return {"available": False, "query": q, "totalMatches": 0, "elapsedMs": 0.0, "results": []}

    try:
        tbl_check = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='govspend_payments'"
        ).fetchone()
        if tbl_check is None:
            return {"available": False, "query": q, "totalMatches": 0, "elapsedMs": 0.0, "results": []}

        fts_expr = sanitize_fts_query(q)
        where_clauses: list[str] = []
        params: list[Any] = []

        if fts_expr:
            where_clauses.append("govspend_fts MATCH ?")
            params.append(fts_expr)
        if year is not None:
            where_clauses.append("g.financial_year = ?")
            params.append(year)
        if mda and mda.strip():
            where_clauses.append("LOWER(g.organization_name) LIKE ?")
            params.append(f"%{mda.strip().lower()}%")
        if min_amount is not None and min_amount > 0:
            where_clauses.append("g.amount_naira >= ?")
            params.append(min_amount)

        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        join_sql = (
            "FROM govspend_fts f JOIN govspend_payments g ON g.rowid = f.rowid"
            if fts_expr
            else "FROM govspend_payments g"
        )
        order_sql = (
            "ORDER BY bm25(govspend_fts, 1.0, 2.0, 4.0, 2.5, 1.0), g.amount_naira DESC"
            if fts_expr
            else "ORDER BY g.payment_date DESC, g.amount_naira DESC"
        )

        rows = conn.execute(
            f"""
            SELECT
                g.payment_no, g.payment_date, g.financial_year, g.payer_code,
                g.organization_name, g.beneficiary_name, g.amount_naira, g.description
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
                "paymentNo": r["payment_no"],
                "paymentDate": r["payment_date"],
                "financialYear": r["financial_year"],
                "payerCode": r["payer_code"],
                "organizationName": r["organization_name"],
                "beneficiaryName": r["beneficiary_name"],
                "amountNaira": r["amount_naira"],
                "description": r["description"],
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


@router.get("/beneficiary")
def get_beneficiary_expenditures(
    name: str = Query(..., min_length=2, max_length=200),
    limit: int = Query(default=40, ge=1, le=100),
) -> dict[str, Any]:
    t0 = time.perf_counter()
    conn = _open_conn()
    if conn is None:
        return {"available": False, "name": name, "paymentCount": 0, "totalAmountNaira": 0, "results": []}

    try:
        tbl_check = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='govspend_payments'"
        ).fetchone()
        if tbl_check is None:
            return {"available": False, "name": name, "paymentCount": 0, "totalAmountNaira": 0, "results": []}

        norm = normalize_entity_name(name)
        agg = conn.execute(
            """
            SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_naira), 0) AS total_amt
            FROM govspend_payments
            WHERE norm_beneficiary = ?
            """,
            (norm,),
        ).fetchone()
        rows = conn.execute(
            """
            SELECT payment_no, payment_date, financial_year, payer_code, organization_name, beneficiary_name, amount_naira, description
            FROM govspend_payments
            WHERE norm_beneficiary = ?
            ORDER BY payment_date DESC, amount_naira DESC
            LIMIT ?
            """,
            (norm, limit),
        ).fetchall()

        return {
            "available": True,
            "name": name,
            "normalizedName": norm,
            "paymentCount": int(agg["cnt"]) if agg else 0,
            "totalAmountNaira": int(agg["total_amt"]) if agg else 0,
            "elapsedMs": round((time.perf_counter() - t0) * 1000, 2),
            "results": [
                {
                    "paymentNo": r["payment_no"],
                    "paymentDate": r["payment_date"],
                    "financialYear": r["financial_year"],
                    "payerCode": r["payer_code"],
                    "organizationName": r["organization_name"],
                    "beneficiaryName": r["beneficiary_name"],
                    "amountNaira": r["amount_naira"],
                    "description": r["description"],
                }
                for r in rows
            ],
        }
    finally:
        conn.close()
