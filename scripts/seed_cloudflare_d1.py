#!/usr/bin/env python3
"""
BudgetLens Phase 8 (P8-CP-2) Idempotent Cloudflare D1 Migration & Seeding Pipeline.

Modes:
  --local        Apply all 3 D1 migrations locally (--persist-to .cloudflare/state) and
                 seed 100% of records from backend/data/*.sqlite + public/datasets/*.
  --remote-init  Apply all 3 D1 migrations remotely and seed compact Free-Tier summary
                 tables (year_statistics + app_datasets + app_dataset_chunks; < 500 writes).
  --export-sql   Export transaction-free SQL batch files (no BEGIN/COMMIT) to <dir>
                 for bulk `cf d1 import` on permanent/paid accounts.
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parent.parent
PERSIST_DIR = ROOT / ".cloudflare" / "state"
DEFAULT_EXPORT_DIR = ROOT / "scratch" / "d1_sql_export"
MAX_CHUNK_CHARS = 320_000  # Safely under D1's ~1 MB single-statement / parameter cap

TOP_LEVEL_APP_DATASETS = [
    "registry",
    "coverage_audit",
    "debt_profile",
    "source_provenance",
    "execution_tracker",
    "macro_credibility_tracker",
    "macro_narratives_summary",
    "policy_benchmarks",
    "govspend_summary",
    "govspend_forensics",
    "mda_integrity_scorecards",
    "red_flag_convergence_index",
    "evidence_engine_all_years",
    "procurement_risk_index",
    "procurement_links",
    "vendor_network_index",
    "follow_the_money_links",
    "asset_inventory_index",
    "oaugf_audit_index",
    "project_lifecycle_index",
    "contractors_leaderboard",
    "forensic_sweep_1999_2026",
    "forensic_sweep_2023_2026",
    "statistical_forensics_1999_2026",
    "geo_intelligence_index",
    "search_index_top",
    "recurring_lineages",
]


def load_env(env_path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if env_path.exists():
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            values[k.strip()] = v.strip().strip('"').strip("'")
    for key in ("D1_BUDGETS_ID", "D1_LEDGERS_ID", "D1_APP_ID"):
        if os.environ.get(key):
            values[key] = os.environ[key]
    return values


def run_cf(args: list[str]) -> str:
    cmd = ["cf.cmd" if os.name == "nt" else "cf", *args]
    res = subprocess.run(
        cmd,
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        shell=(os.name == "nt"),
    )
    if res.returncode != 0:
        raise RuntimeError(
            f"cf {' '.join(args)} failed (exit {res.returncode}):\n{res.stdout}\n{res.stderr}"
        )
    return res.stdout.strip()


def apply_migrations(db_ids: dict[str, str], local: bool) -> None:
    specs = [
        ("budgets", db_ids["budgets"], ROOT / "worker" / "migrations" / "budgets"),
        ("ledgers", db_ids["ledgers"], ROOT / "worker" / "migrations" / "ledgers"),
        ("app", db_ids["app"], ROOT / "worker" / "migrations" / "app"),
    ]
    for label, db_id, mig_dir in specs:
        args = ["d1", "migrations", "apply", db_id, "--dir", str(mig_dir)]
        if local:
            args.extend(["--local", "--persist-to", str(PERSIST_DIR)])
        print(f"[migrate] Applying {label} migrations ({'local' if local else 'remote'})...")
        out = run_cf(args)
        if out:
            print(out)


def find_local_sqlite_files() -> dict[str, Path]:
    d1_dir = PERSIST_DIR / "v3" / "d1" / "miniflare-D1DatabaseObject"
    candidates = sorted(d1_dir.glob("*.sqlite"))
    if not candidates:
        raise FileNotFoundError(f"No local D1 SQLite files found under {d1_dir}")

    mapping: dict[str, Path] = {}
    for path in candidates:
        con = sqlite3.connect(str(path))
        try:
            tables = {
                r[0]
                for r in con.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
        finally:
            con.close()
        if "budget_records" in tables:
            mapping["budgets"] = path
        elif "nocopo_contracts" in tables:
            mapping["ledgers"] = path
        elif "app_datasets" in tables:
            mapping["app"] = path

    missing = {"budgets", "ledgers", "app"} - set(mapping)
    if missing:
        raise RuntimeError(f"Missing local D1 SQLite targets after migrations: {missing}")
    return mapping


def get_datasets_dir() -> Path:
    archived = ROOT / "data_archive" / "datasets"
    return archived if archived.exists() else (ROOT / "public" / "datasets")


def iter_app_dataset_blobs() -> Iterable[tuple[str, str]]:
    datasets_dir = get_datasets_dir()
    for name in TOP_LEVEL_APP_DATASETS:
        fp = datasets_dir / f"{name}.json"
        if fp.exists():
            yield name, fp.read_text(encoding="utf-8")

    hier = datasets_dir / "db" / "hierarchy_summary.json"
    if hier.exists():
        yield "hierarchy_summary", hier.read_text(encoding="utf-8")

    bad_idx = datasets_dir / "bill_act_diffs" / "index.json"
    if bad_idx.exists():
        yield "bill_act_diffs_index", bad_idx.read_text(encoding="utf-8")

    for np in sorted((datasets_dir / "narratives").glob("*.json")):
        yield f"narratives/{np.stem}", np.read_text(encoding="utf-8")


def split_chunks(text: str, max_chars: int = MAX_CHUNK_CHARS) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    return [text[i : i + max_chars] for i in range(0, len(text), max_chars)]


def iter_year_statistics() -> Iterable[tuple[int, str]]:
    datasets_dir = get_datasets_dir()
    for p in sorted(datasets_dir.glob("[0-9][0-9][0-9][0-9]/statistics.json")):
        year = int(p.parent.name)
        yield year, p.read_text(encoding="utf-8")


def load_year_enrichment(year: int) -> dict[str, dict[str, Any]]:
    rec_path = get_datasets_dir() / "db" / str(year) / "records.json"
    if not rec_path.exists():
        return {}
    raw = json.loads(rec_path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        return {}
    enriched: dict[str, dict[str, Any]] = {}
    for item in raw:
        ri = item.get("recordIdentity") or {}
        rid = ri.get("id")
        if not rid:
            continue
        geo = item.get("geographicTaxonomy") or {}
        mda = item.get("mdaGovernanceTaxonomy") or {}
        lineage = item.get("multiYearLineage") or {}
        enriched[rid] = {
            "mda_code": str(mda.get("mdaCode") or ""),
            "geo_zone": str(geo.get("geoPoliticalZone") or ""),
            "lga": str(geo.get("lga") or ""),
            "lineage_id": lineage.get("lineageId"),
            "forensic_flags_json": json.dumps(
                item.get("forensicEvidenceFlags") or [], ensure_ascii=False, separators=(",", ":")
            ),
            "asset_tokens_json": json.dumps(
                item.get("assetTokens") or [], ensure_ascii=False, separators=(",", ":")
            ),
        }
    return enriched


def seed_local_budgets(target_sqlite: Path) -> dict[str, int]:
    src_path = ROOT / "backend" / "data" / "budgetlens_fts.sqlite"
    src = sqlite3.connect(str(src_path))
    dst = sqlite3.connect(str(target_sqlite))
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        src_count = src.execute("SELECT COUNT(*) FROM budget_records").fetchone()[0]
        years = [
            r[0]
            for r in src.execute(
                "SELECT DISTINCT financial_year FROM budget_records ORDER BY financial_year"
            ).fetchall()
        ]

        dst.execute("PRAGMA journal_mode=WAL")
        dst.execute("PRAGMA synchronous=NORMAL")
        dst.execute("DELETE FROM budget_records")
        dst.execute("DELETE FROM year_statistics")

        inserted = 0
        for year in years:
            enrich_map = load_year_enrichment(int(year))
            rows = src.execute(
                """
                SELECT rowid, id, financial_year, president, project_code, project_name,
                       mda_name, sector, spending_type, amount_naira, pdf_page,
                       source_filename, sha256_hash, state, severity
                FROM budget_records
                WHERE financial_year = ?
                ORDER BY rowid
                """,
                (year,),
            ).fetchall()
            batch = []
            for r in rows:
                extra = enrich_map.get(r[1])
                batch.append(
                    (
                        r[0],
                        r[1],
                        r[2],
                        r[3],
                        r[4],
                        r[5],
                        extra["mda_code"] if extra else "",
                        r[6],
                        r[7],
                        r[8],
                        r[9],
                        r[10],
                        r[11],
                        r[12],
                        extra["geo_zone"] if extra else "",
                        r[13],
                        extra["lga"] if extra else "",
                        r[14],
                        extra["lineage_id"] if extra else None,
                        extra["forensic_flags_json"] if extra else "[]",
                        extra["asset_tokens_json"] if extra else "[]",
                    )
                )
            dst.executemany(
                """
                INSERT INTO budget_records (
                  rowid, id, financial_year, president, project_code, project_name,
                  mda_code, mda_name, sector, spending_type, amount_naira, pdf_page,
                  source_filename, sha256_hash, geo_zone, state, lga, severity,
                  lineage_id, forensic_flags_json, asset_tokens_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                batch,
            )
            inserted += len(batch)

        stats_rows = [
            (yr, payload, now_iso) for yr, payload in iter_year_statistics()
        ]
        dst.executemany(
            "INSERT OR REPLACE INTO year_statistics (financial_year, payload_json, updated_at) VALUES (?, ?, ?)",
            stats_rows,
        )
        dst.execute("INSERT INTO budget_fts(budget_fts) VALUES('rebuild')")
        dst.commit()

        dst_count = dst.execute("SELECT COUNT(*) FROM budget_records").fetchone()[0]
        stats_count = dst.execute("SELECT COUNT(*) FROM year_statistics").fetchone()[0]
        if dst_count != src_count:
            raise AssertionError(f"budget_records mismatch: {dst_count} != {src_count}")
        return {"budget_records": dst_count, "year_statistics": stats_count, "inserted": inserted}
    finally:
        src.close()
        dst.close()


def copy_table(
    src: sqlite3.Connection,
    dst: sqlite3.Connection,
    table: str,
    columns: list[str],
    batch_size: int = 10_000,
) -> int:
    col_sql = ", ".join(columns)
    placeholders = ", ".join("?" for _ in columns)
    dst.execute(f"DELETE FROM {table}")
    cur = src.execute(f"SELECT {col_sql} FROM {table}")
    total = 0
    while True:
        rows = cur.fetchmany(batch_size)
        if not rows:
            break
        dst.executemany(
            f"INSERT INTO {table} ({col_sql}) VALUES ({placeholders})", rows
        )
        total += len(rows)
    return total


def seed_local_ledgers(target_sqlite: Path) -> dict[str, int]:
    src_path = ROOT / "backend" / "data" / "external_ledger_fts.sqlite"
    src = sqlite3.connect(str(src_path))
    dst = sqlite3.connect(str(target_sqlite))
    table_specs = [
        (
            "nocopo_contracts",
            [
                "rowid", "ocid", "financial_year", "stage", "title", "mda_name", "norm_mda",
                "buyer_admin_code", "contractor_name", "norm_contractor", "bpp_contractor_id",
                "cac_rc_number", "contract_award_naira", "total_paid_naira", "award_date",
                "procurement_method", "budget_record_id", "project_code", "match_type",
                "confidence_score", "source_file",
            ],
            "nocopo_fts",
        ),
        (
            "govspend_payments",
            [
                "rowid", "payment_no", "payment_date", "financial_year", "payer_code",
                "organization_name", "norm_mda", "beneficiary_name", "norm_beneficiary",
                "amount_naira", "description",
            ],
            "govspend_fts",
        ),
        (
            "oaugf_chunks",
            [
                "id", "doc_id", "doc_title", "category", "audit_years", "primary_year",
                "page_number", "chunk_index", "source_url", "sha256", "chunk_text",
            ],
            "oaugf_fts",
        ),
        (
            "policy_chunks",
            [
                "id", "doc_slug", "doc_title", "doc_type", "fiscal_year_start",
                "fiscal_year_end", "page_number", "chunk_index", "sha256", "chunk_text",
            ],
            "policy_fts",
        ),
        (
            "bir_ocr_chunks",
            ["id", "doc_file", "financial_year", "page_number", "chunk_index", "sha256", "chunk_text"],
            "bir_ocr_fts",
        ),
    ]
    counts: dict[str, int] = {}
    try:
        dst.execute("PRAGMA journal_mode=WAL")
        dst.execute("PRAGMA synchronous=NORMAL")
        for table, cols, fts_table in table_specs:
            src_cnt = src.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            copied = copy_table(src, dst, table, cols)
            dst.execute(f"INSERT INTO {fts_table}({fts_table}) VALUES('rebuild')")
            if copied != src_cnt:
                raise AssertionError(f"{table} mismatch: {copied} != {src_cnt}")
            counts[table] = copied
        dst.commit()
        return counts
    finally:
        src.close()
        dst.close()


def seed_local_app(target_sqlite: Path) -> dict[str, int]:
    dst = sqlite3.connect(str(target_sqlite))
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        dst.execute("PRAGMA journal_mode=WAL")
        dst.execute("PRAGMA synchronous=NORMAL")
        for tbl in (
            "app_datasets",
            "app_dataset_chunks",
            "bill_act_diffs",
            "bill_act_diff_items",
            "contractor_dossiers",
            "oaugf_findings",
        ):
            dst.execute(f"DELETE FROM {tbl}")

        ds_count = 0
        chunk_count_total = 0
        for key, raw_text in iter_app_dataset_blobs():
            digest = hashlib.sha256(raw_text.encode("utf-8")).hexdigest()[:16]
            byte_len = len(raw_text.encode("utf-8"))
            parts = split_chunks(raw_text)
            if len(parts) == 1:
                dst.execute(
                    """
                    INSERT INTO app_datasets (dataset_key, chunk_count, byte_size, sha256, payload_json, updated_at)
                    VALUES (?, 1, ?, ?, ?, ?)
                    """,
                    (key, byte_len, digest, parts[0], now_iso),
                )
            else:
                dst.execute(
                    """
                    INSERT INTO app_datasets (dataset_key, chunk_count, byte_size, sha256, payload_json, updated_at)
                    VALUES (?, ?, ?, ?, NULL, ?)
                    """,
                    (key, len(parts), byte_len, digest, now_iso),
                )
                dst.executemany(
                    "INSERT INTO app_dataset_chunks (dataset_key, chunk_index, chunk_text) VALUES (?, ?, ?)",
                    [(key, idx, chunk) for idx, chunk in enumerate(parts)],
                )
                chunk_count_total += len(parts)
            ds_count += 1

        datasets_dir = get_datasets_dir()
        bad_years = 0
        bad_items_total = 0
        for bp in sorted(
            (datasets_dir / "bill_act_diffs").glob("[0-9][0-9][0-9][0-9].json")
        ):
            data = json.loads(bp.read_text(encoding="utf-8"))
            year = int(data.get("financialYear") or bp.stem)
            items = data.pop("items", [])
            dst.execute(
                "INSERT INTO bill_act_diffs (financial_year, summary_json) VALUES (?, ?)",
                (year, json.dumps(data, ensure_ascii=False, separators=(",", ":"))),
            )
            bad_years += 1
            batch = []
            for item in items:
                batch.append(
                    (
                        year,
                        str(item.get("mdaName") or ""),
                        str(item.get("status") or ""),
                        1 if item.get("isZonalIntervention") else 0,
                        int(item.get("deltaNaira") or 0),
                        json.dumps(item, ensure_ascii=False, separators=(",", ":")),
                    )
                )
            dst.executemany(
                """
                INSERT INTO bill_act_diff_items (financial_year, mda_name, status, is_zip, delta_naira, item_json)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                batch,
            )
            bad_items_total += len(batch)

        contractor_rows = []
        for cp in sorted((datasets_dir / "contractor_history").glob("*.json")):
            shard = json.loads(cp.read_text(encoding="utf-8"))
            if not isinstance(shard, dict):
                continue
            for key, payload in shard.items():
                contracts = payload.get("contracts") or []
                total_award = sum(int(c.get("contractAwardNaira") or 0) for c in contracts)
                contractor_rows.append(
                    (
                        key,
                        key,
                        len(contracts),
                        total_award,
                        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                    )
                )
        dst.executemany(
            """
            INSERT OR REPLACE INTO contractor_dossiers
              (contractor_key, display_name, contract_count, total_awarded_naira, payload_json)
            VALUES (?, ?, ?, ?, ?)
            """,
            contractor_rows,
        )

        oaugf_rows = []
        for op in sorted((datasets_dir / "oaugf_issues").glob("*.json")):
            shard = json.loads(op.read_text(encoding="utf-8"))
            bucket = str(shard.get("bucket") or op.stem)
            for idx, issue in enumerate(shard.get("issues") or []):
                doc_id = str(issue.get("docId") or "")
                year_val = issue.get("year")
                fid = f"{bucket}:{doc_id}:{issue.get('page', 0)}:{idx}"
                oaugf_rows.append(
                    (
                        fid,
                        doc_id,
                        int(year_val) if year_val is not None else None,
                        str(issue.get("mdaName") or ""),
                        str(issue.get("category") or ""),
                        int(issue.get("amountNaira") or 0),
                        json.dumps(issue, ensure_ascii=False, separators=(",", ":")),
                    )
                )
        dst.executemany(
            """
            INSERT OR REPLACE INTO oaugf_findings
              (finding_id, doc_id, financial_year, mda_name, category, amount_naira, item_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            oaugf_rows,
        )

        tips_src_path = ROOT / "backend" / "data" / "citizen_tips.sqlite"
        tips_copied = 0
        if tips_src_path.exists():
            tsrc = sqlite3.connect(str(tips_src_path))
            try:
                tips_copied = copy_table(
                    tsrc,
                    dst,
                    "citizen_tips",
                    [
                        "tip_id", "project_id", "financial_year", "project_code", "state", "lga",
                        "status", "observation", "reporter_alias", "photos_json", "corroborations",
                        "moderation_status", "moderation_note", "ip_hash", "created_at_iso",
                    ],
                )
                copy_table(tsrc, dst, "tip_rate_limits", ["id", "ip_hash", "created_epoch"])
            finally:
                tsrc.close()

        dst.commit()
        return {
            "app_datasets": ds_count,
            "app_dataset_chunks": chunk_count_total,
            "bill_act_diffs": bad_years,
            "bill_act_diff_items": bad_items_total,
            "contractor_dossiers": len(contractor_rows),
            "oaugf_findings": len(oaugf_rows),
            "citizen_tips": tips_copied,
        }
    finally:
        dst.close()


def cf_d1_batch_query(db_id: str, statements: list[dict[str, Any]]) -> None:
    if not statements:
        return
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", encoding="utf-8", delete=False
    ) as tf:
        json.dump(statements, tf, ensure_ascii=False)
        tmp_path = tf.name
    try:
        run_cf(["d1", "query", db_id, "--batch", f"@{tmp_path}"])
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


def flush_remote_batches(db_id: str, statements: list[dict[str, Any]], max_bytes: int = 380_000) -> int:
    sent = 0
    chunk: list[dict[str, Any]] = []
    chunk_bytes = 2
    for stmt in statements:
        sz = len(json.dumps(stmt, ensure_ascii=False).encode("utf-8"))
        if chunk and (chunk_bytes + sz > max_bytes or len(chunk) >= 25):
            cf_d1_batch_query(db_id, chunk)
            sent += len(chunk)
            chunk = []
            chunk_bytes = 2
        chunk.append(stmt)
        chunk_bytes += sz
    if chunk:
        cf_d1_batch_query(db_id, chunk)
        sent += len(chunk)
    return sent


def seed_remote_init(db_ids: dict[str, str]) -> dict[str, int]:
    now_iso = datetime.now(timezone.utc).isoformat()
    stats_stmts = [
        {
            "sql": "INSERT OR REPLACE INTO year_statistics (financial_year, payload_json, updated_at) VALUES (?, ?, ?)",
            "params": [yr, payload, now_iso],
        }
        for yr, payload in iter_year_statistics()
    ]
    stats_written = flush_remote_batches(db_ids["budgets"], stats_stmts)

    app_stmts: list[dict[str, Any]] = []
    datasets_count = 0
    chunks_count = 0
    for key, raw_text in iter_app_dataset_blobs():
        digest = hashlib.sha256(raw_text.encode("utf-8")).hexdigest()[:16]
        byte_len = len(raw_text.encode("utf-8"))
        parts = split_chunks(raw_text)
        if len(parts) == 1:
            app_stmts.append(
                {
                    "sql": "INSERT OR REPLACE INTO app_datasets (dataset_key, chunk_count, byte_size, sha256, payload_json, updated_at) VALUES (?, 1, ?, ?, ?, ?)",
                    "params": [key, byte_len, digest, parts[0], now_iso],
                }
            )
        else:
            app_stmts.append(
                {
                    "sql": "INSERT OR REPLACE INTO app_datasets (dataset_key, chunk_count, byte_size, sha256, payload_json, updated_at) VALUES (?, ?, ?, ?, NULL, ?)",
                    "params": [key, len(parts), byte_len, digest, now_iso],
                }
            )
            app_stmts.append(
                {
                    "sql": "DELETE FROM app_dataset_chunks WHERE dataset_key = ?",
                    "params": [key],
                }
            )
            for idx, part in enumerate(parts):
                app_stmts.append(
                    {
                        "sql": "INSERT OR REPLACE INTO app_dataset_chunks (dataset_key, chunk_index, chunk_text) VALUES (?, ?, ?)",
                        "params": [key, idx, part],
                    }
                )
                chunks_count += 1
        datasets_count += 1

    app_written = flush_remote_batches(db_ids["app"], app_stmts)
    return {
        "remote_year_statistics_statements": stats_written,
        "remote_app_datasets": datasets_count,
        "remote_app_dataset_chunks": chunks_count,
        "remote_app_statements": app_written,
    }


def sql_literal(val: Any) -> str:
    if val is None:
        return "NULL"
    if isinstance(val, (int, float)):
        return str(val)
    return "'" + str(val).replace("'", "''") + "'"


def export_transaction_free_sql(out_dir: Path) -> dict[str, int]:
    out_dir.mkdir(parents=True, exist_ok=True)
    files_written = 0
    total_rows = 0
    src_budgets = sqlite3.connect(str(ROOT / "backend" / "data" / "budgetlens_fts.sqlite"))
    try:
        years = [
            r[0]
            for r in src_budgets.execute(
                "SELECT DISTINCT financial_year FROM budget_records ORDER BY financial_year"
            ).fetchall()
        ]
        for year in years:
            enrich_map = load_year_enrichment(int(year))
            out_file = out_dir / f"budgets_{year}.sql"
            rows = src_budgets.execute(
                """
                SELECT rowid, id, financial_year, president, project_code, project_name,
                       mda_name, sector, spending_type, amount_naira, pdf_page,
                       source_filename, sha256_hash, state, severity
                FROM budget_records WHERE financial_year = ? ORDER BY rowid
                """,
                (year,),
            ).fetchall()
            with out_file.open("w", encoding="utf-8") as fh:
                for r in rows:
                    extra = enrich_map.get(r[1])
                    vals = [
                        r[0], r[1], r[2], r[3], r[4], r[5],
                        extra["mda_code"] if extra else "",
                        r[6], r[7], r[8], r[9], r[10], r[11], r[12],
                        extra["geo_zone"] if extra else "",
                        r[13],
                        extra["lga"] if extra else "",
                        r[14],
                        extra["lineage_id"] if extra else None,
                        extra["forensic_flags_json"] if extra else "[]",
                        extra["asset_tokens_json"] if extra else "[]",
                    ]
                    fh.write(
                        "INSERT OR REPLACE INTO budget_records "
                        "(rowid,id,financial_year,president,project_code,project_name,mda_code,mda_name,sector,spending_type,amount_naira,pdf_page,source_filename,sha256_hash,geo_zone,state,lga,severity,lineage_id,forensic_flags_json,asset_tokens_json) "
                        f"VALUES ({','.join(sql_literal(v) for v in vals)});\n"
                    )
                    total_rows += 1
                fh.write("INSERT INTO budget_fts(budget_fts) VALUES('rebuild');\n")
            files_written += 1
    finally:
        src_budgets.close()
    return {"sql_files_written": files_written, "budget_rows_exported": total_rows}


def main() -> int:
    parser = argparse.ArgumentParser(description="BudgetLens Cloudflare D1 migration & seeding tool")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--local", action="store_true", help="Migrate & seed 100%% of rows into local .cloudflare/state")
    mode.add_argument("--remote-init", action="store_true", help="Apply remote schemas & seed compact Free-Tier summary datasets")
    mode.add_argument("--export-sql", nargs="?", const=str(DEFAULT_EXPORT_DIR), help="Export transaction-free SQL files for cf d1 import")
    args = parser.parse_args()

    if args.export_sql:
        summary = export_transaction_free_sql(Path(args.export_sql))
        print(json.dumps({"mode": "export-sql", "summary": summary}, indent=2))
        return 0

    env = load_env(ROOT / ".env")
    missing_env = [k for k in ("D1_BUDGETS_ID", "D1_LEDGERS_ID", "D1_APP_ID") if not env.get(k)]
    if missing_env:
        print(f"ERROR: Missing D1 IDs in .env: {missing_env}", file=sys.stderr)
        return 1

    db_ids = {
        "budgets": env["D1_BUDGETS_ID"],
        "ledgers": env["D1_LEDGERS_ID"],
        "app": env["D1_APP_ID"],
    }

    if args.local:
        PERSIST_DIR.mkdir(parents=True, exist_ok=True)
        apply_migrations(db_ids, local=True)
        targets = find_local_sqlite_files()
        summary = {
            "budgets": seed_local_budgets(targets["budgets"]),
            "ledgers": seed_local_ledgers(targets["ledgers"]),
            "app": seed_local_app(targets["app"]),
        }
        print(json.dumps({"mode": "local", "summary": summary}, indent=2))
        return 0

    if args.remote_init:
        apply_migrations(db_ids, local=False)
        summary = seed_remote_init(db_ids)
        print(json.dumps({"mode": "remote-init", "summary": summary}, indent=2))
        return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
