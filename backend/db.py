"""Persistent SQLite (WAL) storage for BudgetLens Citizen Field Verification Tips."""

from __future__ import annotations

import json
import os
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_TIPS_DB = Path(__file__).resolve().parent / "data" / "citizen_tips.sqlite"

PUBLIC_TIP_COLUMNS = (
    "tip_id",
    "project_id",
    "financial_year",
    "project_code",
    "state",
    "lga",
    "status",
    "observation",
    "reporter_alias",
    "photos_json",
    "corroborations",
    "moderation_status",
    "moderation_note",
    "created_at_iso",
)


def get_tips_db_path() -> Path:
    override = os.environ.get("BUDGETLENS_TIPS_DB")
    return Path(override) if override else DEFAULT_TIPS_DB


def get_tips_connection() -> sqlite3.Connection:
    db_path = get_tips_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), timeout=10.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def init_tips_db() -> None:
    """Create citizen_tips and tip_rate_limits tables if absent (PostgreSQL-compatible schema)."""
    with get_tips_connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS citizen_tips (
                tip_id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                financial_year INTEGER NOT NULL,
                project_code TEXT NOT NULL DEFAULT '',
                state TEXT NOT NULL DEFAULT '',
                lga TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL,
                observation TEXT NOT NULL,
                reporter_alias TEXT NOT NULL DEFAULT 'Anonymous Citizen',
                photos_json TEXT NOT NULL DEFAULT '[]',
                corroborations INTEGER NOT NULL DEFAULT 0,
                moderation_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
                moderation_note TEXT NOT NULL DEFAULT '',
                ip_hash TEXT NOT NULL,
                created_at_iso TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tips_project_year
                ON citizen_tips(project_id, financial_year);
            CREATE INDEX IF NOT EXISTS idx_tips_state
                ON citizen_tips(state);
            CREATE INDEX IF NOT EXISTS idx_tips_moderation
                ON citizen_tips(moderation_status);
            CREATE INDEX IF NOT EXISTS idx_tips_created
                ON citizen_tips(created_at_iso DESC);

            CREATE TABLE IF NOT EXISTS tip_rate_limits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ip_hash TEXT NOT NULL,
                created_epoch REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_rate_ip_epoch
                ON tip_rate_limits(ip_hash, created_epoch);
            """
        )


def _row_to_public_dict(row: sqlite3.Row) -> dict[str, Any]:
    photos_raw = row["photos_json"] or "[]"
    try:
        photos = json.loads(photos_raw)
    except json.JSONDecodeError:
        photos = []
    return {
        "tip_id": row["tip_id"],
        "project_id": row["project_id"],
        "financial_year": row["financial_year"],
        "project_code": row["project_code"],
        "state": row["state"],
        "lga": row["lga"],
        "status": row["status"],
        "observation": row["observation"],
        "reporter_alias": row["reporter_alias"],
        "photos": [f"/api/tips/photos/{name}" for name in photos],
        "corroborations": int(row["corroborations"]),
        "moderation_status": row["moderation_status"],
        "moderation_note": row["moderation_note"],
        "created_at_iso": row["created_at_iso"],
    }


def check_and_record_rate_limit(
    ip_hash: str,
    window_seconds: int = 3600,
    max_requests: int = 12,
) -> bool:
    """Return True if under limit and record attempt; False if rate-limited."""
    init_tips_db()
    now = time.time()
    cutoff = now - window_seconds
    with get_tips_connection() as conn:
        conn.execute("DELETE FROM tip_rate_limits WHERE created_epoch < ?", (cutoff,))
        count_row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM tip_rate_limits WHERE ip_hash = ? AND created_epoch >= ?",
            (ip_hash, cutoff),
        ).fetchone()
        cnt = int(count_row["cnt"]) if count_row else 0
        if cnt >= max_requests:
            return False
        conn.execute(
            "INSERT INTO tip_rate_limits (ip_hash, created_epoch) VALUES (?, ?)",
            (ip_hash, now),
        )
    return True


def insert_tip(
    *,
    tip_id: str,
    project_id: str,
    financial_year: int,
    project_code: str,
    state: str,
    lga: str,
    status: str,
    observation: str,
    reporter_alias: str,
    photo_filenames: list[str],
    ip_hash: str,
) -> dict[str, Any]:
    init_tips_db()
    created_at_iso = datetime.now(timezone.utc).isoformat()
    with get_tips_connection() as conn:
        conn.execute(
            """
            INSERT INTO citizen_tips (
                tip_id, project_id, financial_year, project_code, state, lga,
                status, observation, reporter_alias, photos_json,
                corroborations, moderation_status, moderation_note, ip_hash, created_at_iso
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'UNVERIFIED', '', ?, ?)
            """,
            (
                tip_id,
                project_id,
                financial_year,
                project_code,
                state,
                lga,
                status,
                observation,
                reporter_alias,
                json.dumps(photo_filenames),
                ip_hash,
                created_at_iso,
            ),
        )
        row = conn.execute(
            f"SELECT {', '.join(PUBLIC_TIP_COLUMNS)} FROM citizen_tips WHERE tip_id = ?",
            (tip_id,),
        ).fetchone()
    assert row is not None
    return _row_to_public_dict(row)


def list_tips(
    *,
    project_id: str | None = None,
    financial_year: int | None = None,
    state: str | None = None,
    status: str | None = None,
    include_rejected: bool = False,
    limit: int = 25,
) -> list[dict[str, Any]]:
    init_tips_db()
    clauses: list[str] = []
    params: list[Any] = []
    if project_id:
        clauses.append("project_id = ?")
        params.append(project_id)
    if financial_year is not None:
        clauses.append("financial_year = ?")
        params.append(financial_year)
    if state:
        clauses.append("LOWER(state) = LOWER(?)")
        params.append(state.strip())
    if status:
        clauses.append("status = ?")
        params.append(status.strip())
    if not include_rejected:
        clauses.append("moderation_status != 'REJECTED'")

    where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    safe_limit = max(1, min(limit, 100))
    sql = (
        f"SELECT {', '.join(PUBLIC_TIP_COLUMNS)} FROM citizen_tips "
        f"{where_sql} ORDER BY created_at_iso DESC LIMIT ?"
    )
    params.append(safe_limit)
    with get_tips_connection() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_row_to_public_dict(row) for row in rows]


def increment_corroboration(tip_id: str) -> dict[str, Any] | None:
    init_tips_db()
    with get_tips_connection() as conn:
        row = conn.execute(
            "SELECT corroborations, moderation_status FROM citizen_tips WHERE tip_id = ?",
            (tip_id,),
        ).fetchone()
        if row is None:
            return None
        next_count = int(row["corroborations"]) + 1
        next_mod = row["moderation_status"]
        if next_mod == "UNVERIFIED" and next_count >= 3:
            next_mod = "CORROBORATED"
        conn.execute(
            "UPDATE citizen_tips SET corroborations = ?, moderation_status = ? WHERE tip_id = ?",
            (next_count, next_mod, tip_id),
        )
        updated = conn.execute(
            f"SELECT {', '.join(PUBLIC_TIP_COLUMNS)} FROM citizen_tips WHERE tip_id = ?",
            (tip_id,),
        ).fetchone()
    return _row_to_public_dict(updated) if updated else None


def update_moderation(
    tip_id: str,
    moderation_status: str,
    moderation_note: str = "",
) -> dict[str, Any] | None:
    init_tips_db()
    with get_tips_connection() as conn:
        cur = conn.execute(
            "UPDATE citizen_tips SET moderation_status = ?, moderation_note = ? WHERE tip_id = ?",
            (moderation_status, moderation_note.strip(), tip_id),
        )
        if cur.rowcount == 0:
            return None
        updated = conn.execute(
            f"SELECT {', '.join(PUBLIC_TIP_COLUMNS)} FROM citizen_tips WHERE tip_id = ?",
            (tip_id,),
        ).fetchone()
    return _row_to_public_dict(updated) if updated else None
