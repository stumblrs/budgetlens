"""SQLite FTS5 Full-Text Index & Lightweight Static Search Fallback Builder (1999-2026).

Builds:
  1. `backend/data/budgetlens_fts.sqlite` — SQLite FTS5 (`porter unicode61`) across all 28 years
  2. `public/datasets/search_index_top.json` — compact offline cross-year fallback (~3,500 top rows)
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATASETS_DIR = PROJECT_ROOT / "public" / "datasets"
DEFAULT_DB_PATH = PROJECT_ROOT / "backend" / "data" / "budgetlens_fts.sqlite"
DEFAULT_STATIC_INDEX_PATH = DEFAULT_DATASETS_DIR / "search_index_top.json"

PRESIDENT_BY_YEAR: dict[int, str] = {
    **{y: "obasanjo" for y in range(1999, 2008)},
    **{y: "yaradua" for y in range(2008, 2011)},
    **{y: "jonathan" for y in range(2011, 2016)},
    **{y: "buhari" for y in range(2016, 2024)},
    **{y: "tinubu" for y in range(2024, 2030)},
}


def president_for_year(year: int) -> str:
    return PRESIDENT_BY_YEAR.get(year, "unknown")


def max_severity(flags: list[dict[str, Any]] | None) -> str:
    if not flags:
        return "none"
    rank = {"high": 3, "medium": 2, "low": 1}
    best = "none"
    best_r = 0
    for f in flags:
        sev = str(f.get("severity") or "").lower()
        r = rank.get(sev, 0)
        if r > best_r:
            best_r = r
            best = sev
    return best


def build_fts_index(
    datasets_dir: str | Path = DEFAULT_DATASETS_DIR,
    db_path: str | Path = DEFAULT_DB_PATH,
    static_index_path: str | Path = DEFAULT_STATIC_INDEX_PATH,
    max_static_per_year: int = 125,
) -> dict[str, Any]:
    ds_dir = Path(datasets_dir)
    db_dir = ds_dir / "db"
    out_db = Path(db_path)
    out_db.parent.mkdir(parents=True, exist_ok=True)
    tmp_db = Path(str(out_db) + ".tmp")
    if tmp_db.exists():
        tmp_db.unlink()

    t0 = time.perf_counter()
    conn = sqlite3.connect(str(tmp_db))
    conn.execute("PRAGMA journal_mode = OFF")
    conn.execute("PRAGMA synchronous = OFF")
    conn.execute("PRAGMA temp_store = MEMORY")
    conn.execute("PRAGMA cache_size = -64000")

    conn.execute(
        """
        CREATE TABLE budget_records (
            rowid INTEGER PRIMARY KEY AUTOINCREMENT,
            id TEXT NOT NULL,
            financial_year INTEGER NOT NULL,
            president TEXT NOT NULL,
            project_code TEXT NOT NULL,
            project_name TEXT NOT NULL,
            mda_name TEXT NOT NULL,
            sector TEXT NOT NULL,
            spending_type TEXT NOT NULL,
            amount_naira INTEGER NOT NULL,
            pdf_page INTEGER NOT NULL,
            source_filename TEXT NOT NULL,
            sha256_hash TEXT NOT NULL,
            state TEXT NOT NULL,
            severity TEXT NOT NULL
        )
        """
    )

    conn.execute(
        """
        CREATE VIRTUAL TABLE budget_fts USING fts5(
            project_name,
            mda_name,
            project_code,
            sector,
            state,
            content='budget_records',
            content_rowid='rowid',
            tokenize='porter unicode61'
        )
        """
    )

    total_rows = 0
    years_indexed: list[int] = []
    static_top_records: list[dict[str, Any]] = []

    if db_dir.exists():
        year_dirs = sorted(
            (d for d in db_dir.iterdir() if d.is_dir() and d.name.isdigit()),
            key=lambda d: int(d.name),
        )
        for ydir in year_dirs:
            yr = int(ydir.name)
            rec_path = ydir / "records.json"
            if not rec_path.exists():
                continue
            raw = json.loads(rec_path.read_text(encoding="utf-8"))
            recs = raw if isinstance(raw, list) else raw.get("records", [])
            years_indexed.append(yr)
            pres = president_for_year(yr)

            batch: list[tuple[Any, ...]] = []
            year_candidates: list[tuple[int, int, dict[str, Any]]] = []

            for r in recs:
                ident = r.get("recordIdentity") or {}
                mda = r.get("mdaGovernanceTaxonomy") or {}
                prov = r.get("sourceProvenance") or {}
                geo = r.get("geographicTaxonomy") or {}
                flags = r.get("forensicEvidenceFlags") or []
                sev = max_severity(flags)
                amt = int(ident.get("amountNaira") or 0)
                rec_id = str(ident.get("id") or "")
                code = str(ident.get("projectCode") or "")
                title = str(ident.get("verbatimProjectName") or "")
                mda_name = str(mda.get("mdaName") or "")
                sector = str(mda.get("sector") or "")
                stype = str(ident.get("spendingType") or "CAPITAL")
                page = int(prov.get("pdfPage") or 1)
                src_file = str(prov.get("sourceFilename") or "")
                sha = str(prov.get("sha256Hash") or "")
                state = str(geo.get("state") or "")

                batch.append(
                    (
                        rec_id,
                        yr,
                        pres,
                        code,
                        title,
                        mda_name,
                        sector,
                        stype,
                        amt,
                        page,
                        src_file,
                        sha,
                        state,
                        sev,
                    )
                )

                sev_score = 3 if sev == "high" else 2 if sev == "medium" else 1 if sev == "low" else 0
                year_candidates.append(
                    (
                        sev_score,
                        amt,
                        {
                            "id": rec_id,
                            "financialYear": yr,
                            "president": pres,
                            "projectCode": code,
                            "projectName": title,
                            "agency": mda_name,
                            "sector": sector,
                            "projectType": stype,
                            "amount": amt,
                            "page": page,
                            "sourceFilename": src_file,
                            "sha256": sha,
                            "state": state,
                            "severity": sev,
                        },
                    )
                )

            conn.executemany(
                """
                INSERT INTO budget_records (
                    id, financial_year, president, project_code, project_name,
                    mda_name, sector, spending_type, amount_naira, pdf_page,
                    source_filename, sha256_hash, state, severity
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                batch,
            )
            total_rows += len(batch)

            year_candidates.sort(key=lambda item: (-item[0], -item[1]))
            static_top_records.extend(item[2] for item in year_candidates[:max_static_per_year])

    # Populate FTS5 contentless-sync index & relational indexes
    conn.execute("INSERT INTO budget_fts(budget_fts) VALUES('rebuild')")
    conn.execute("CREATE INDEX idx_records_year_amt ON budget_records(financial_year, amount_naira DESC)")
    conn.execute("CREATE INDEX idx_records_pres_amt ON budget_records(president, amount_naira DESC)")
    conn.execute("CREATE INDEX idx_records_sev_amt ON budget_records(severity, amount_naira DESC)")
    conn.execute("CREATE INDEX idx_records_code ON budget_records(project_code)")
    conn.execute("INSERT INTO budget_fts(budget_fts) VALUES('optimize')")
    conn.execute("ANALYZE")
    conn.commit()
    conn.close()

    os.replace(tmp_db, out_db)

    # Atomic write for static fallback index
    static_path = Path(static_index_path)
    static_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_json = str(static_path) + ".tmp"
    with open(tmp_json, "w", encoding="utf-8") as f:
        json.dump(
            {
                "totalIndexedYears": len(years_indexed),
                "totalCorpusRecords": total_rows,
                "records": static_top_records,
            },
            f,
            separators=(",", ":"),
            ensure_ascii=False,
        )
    os.replace(tmp_json, static_path)

    elapsed = time.perf_counter() - t0
    db_mb = out_db.stat().st_size / (1024 * 1024)
    static_mb = static_path.stat().st_size / (1024 * 1024)

    return {
        "totalRows": total_rows,
        "yearsCount": len(years_indexed),
        "dbSizeMb": round(db_mb, 2),
        "staticSizeMb": round(static_mb, 2),
        "staticRecords": len(static_top_records),
        "buildSeconds": round(elapsed, 2),
    }


def benchmark_fts(db_path: str | Path = DEFAULT_DB_PATH) -> list[dict[str, Any]]:
    conn = sqlite3.connect(str(db_path))
    queries = ['"Land"* "Cruiser"*', '"borehole"* "Kano"*', '"ERGP"*']
    results: list[dict[str, Any]] = []
    for q in queries:
        t0 = time.perf_counter()
        rows = conn.execute(
            """
            SELECT r.id, r.financial_year, r.project_code, r.amount_naira
            FROM budget_fts f
            JOIN budget_records r ON r.rowid = f.rowid
            WHERE budget_fts MATCH ?
            ORDER BY bm25(budget_fts)
            LIMIT 20
            """,
            (q,),
        ).fetchall()
        ms = round((time.perf_counter() - t0) * 1000, 2)
        results.append({"query": q, "hits": len(rows), "latencyMs": ms})
    conn.close()
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Build BudgetLens All-28-Year SQLite FTS5 Index")
    parser.add_argument("--datasets", type=str, default=str(DEFAULT_DATASETS_DIR))
    parser.add_argument("--db", type=str, default=str(DEFAULT_DB_PATH))
    args = parser.parse_args()

    stats = build_fts_index(datasets_dir=args.datasets, db_path=args.db)
    bench = benchmark_fts(db_path=args.db)
    print(
        f"FTS5 Index complete: {stats['totalRows']:,} rows across {stats['yearsCount']} years | "
        f"SQLite={stats['dbSizeMb']} MB | StaticFallback={stats['staticSizeMb']} MB ({stats['staticRecords']:,} rows) | "
        f"Built in {stats['buildSeconds']}s"
    )
    for b in bench:
        print(f"  Benchmark {b['query']}: {b['hits']} hits in {b['latencyMs']} ms")


if __name__ == "__main__":
    main()
