"""FastAPI FTS5 Full-Text Search Router across all 28 Federal Budget Years (1999-2026)."""

from __future__ import annotations

import os
import re
import sqlite3
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query

router = APIRouter(prefix="/api", tags=["search"])

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = PROJECT_ROOT / "backend" / "data" / "budgetlens_fts.sqlite"

FTS_RESERVED = {"AND", "OR", "NOT", "NEAR"}


def get_fts_db_path() -> Path:
    return Path(os.environ.get("BUDGETLENS_FTS_DB", str(DEFAULT_DB_PATH)))


def sanitize_fts_query(raw: str) -> str:
    """
    Converts arbitrary user input into a safe FTS5 prefix-AND query (`"tok1"* "tok2"*`),
    preventing FTS5 syntax errors and injection on punctuation, quotes, or operators.
    """
    tokens = re.findall(r"[A-Za-z0-9]+", raw or "")
    cleaned = [tok for tok in tokens if tok.upper() not in FTS_RESERVED and len(tok) >= 1]
    if not cleaned:
        return ""
    return " ".join(f'"{tok}"*' for tok in cleaned[:10])


def _open_conn() -> sqlite3.Connection | None:
    db_path = get_fts_db_path()
    if not db_path.exists():
        return None
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


@router.get("/search")
def search_budget_records(
    q: str = Query(default="", max_length=200),
    year: int | None = Query(default=None, ge=1999, le=2030),
    president: str | None = Query(default=None, max_length=32),
    severity: str | None = Query(default=None, max_length=16),
    sector: str | None = Query(default=None, max_length=64),
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
            "facets": {"years": [], "severities": []},
        }

    try:
        fts_expr = sanitize_fts_query(q)
        where_clauses: list[str] = []
        params: list[Any] = []

        if fts_expr:
            where_clauses.append("budget_fts MATCH ?")
            params.append(fts_expr)
        if year is not None:
            where_clauses.append("r.financial_year = ?")
            params.append(year)
        if president and president.upper() != "ALL":
            where_clauses.append("r.president = ?")
            params.append(president.strip().lower())
        if severity and severity.upper() != "ALL":
            where_clauses.append("r.severity = ?")
            params.append(severity.strip().lower())
        if sector and sector.upper() != "ALL":
            where_clauses.append("LOWER(r.sector) LIKE ?")
            params.append(f"%{sector.strip().lower()}%")

        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        join_sql = (
            "FROM budget_fts f JOIN budget_records r ON r.rowid = f.rowid"
            if fts_expr
            else "FROM budget_records r"
        )
        order_sql = (
            "ORDER BY bm25(budget_fts, 4.0, 2.0, 3.0, 1.0, 1.0), r.amount_naira DESC"
            if fts_expr
            else "ORDER BY r.financial_year DESC, r.amount_naira DESC"
        )

        rows = conn.execute(
            f"""
            SELECT
                r.id, r.financial_year, r.president, r.project_code,
                r.project_name, r.mda_name, r.sector, r.spending_type,
                r.amount_naira, r.pdf_page, r.source_filename, r.sha256_hash,
                r.state, r.severity
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

        year_facets = conn.execute(
            f"""
            SELECT r.financial_year AS year, COUNT(*) AS count
            {join_sql}
            {where_sql}
            GROUP BY r.financial_year
            ORDER BY count DESC
            LIMIT 8
            """,
            tuple(params),
        ).fetchall()

        sev_facets = conn.execute(
            f"""
            SELECT r.severity AS severity, COUNT(*) AS count
            {join_sql}
            {where_sql}
            GROUP BY r.severity
            ORDER BY count DESC
            """,
            tuple(params),
        ).fetchall()

        results = [
            {
                "id": r["id"],
                "financialYear": r["financial_year"],
                "president": r["president"],
                "projectCode": r["project_code"],
                "projectName": r["project_name"],
                "agency": r["mda_name"],
                "sector": r["sector"],
                "projectType": r["spending_type"],
                "amount": r["amount_naira"],
                "page": r["pdf_page"],
                "sourceFilename": r["source_filename"],
                "sha256": r["sha256_hash"],
                "state": r["state"],
                "severity": r["severity"],
            }
            for r in rows
        ]

        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
        return {
            "available": True,
            "query": q,
            "sanitizedFtsQuery": fts_expr,
            "totalMatches": total_matches,
            "elapsedMs": elapsed_ms,
            "results": results,
            "facets": {
                "years": [{"year": f["year"], "count": f["count"]} for f in year_facets],
                "severities": [{"severity": f["severity"], "count": f["count"]} for f in sev_facets],
            },
        }
    finally:
        conn.close()
