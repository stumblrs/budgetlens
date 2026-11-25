"""GovSpend.ng Open Treasury Expenditure Indexer & NOCOPO Cross-Linker.

Streams `govspend_data/govspend_all.jsonl` (467,780 rows, 2018-09-01..2026-06-19)
with bounded memory, normalizes 9/10-digit `payer_code`s, MDA names, and beneficiary
names via `entity_normalizer.py`, builds an FTS5 SQLite table (`govspend_payments`
+ `govspend_fts`) inside `backend/data/external_ledger_fts.sqlite`, detects
same-day multi-voucher split-payment clusters, cross-links contractors against
`nocopo_contracts`, and emits a compact `< 2 MB` frontend summary at
`public/datasets/govspend_summary.json`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ingestion.parsers.entity_normalizer import (
    normalize_admin_code,
    normalize_entity_name,
    normalize_mda_name,
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_GOVSPEND_JSONL = PROJECT_ROOT / "govspend_data" / "govspend_all.jsonl"
DEFAULT_DATASETS_DIR = PROJECT_ROOT / "public" / "datasets"
DEFAULT_FTS_SQLITE = PROJECT_ROOT / "backend" / "data" / "external_ledger_fts.sqlite"


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1048576), b""):
            h.update(chunk)
    return f"sha256:{h.hexdigest()}"


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


def _load_nocopo_by_contractor(db_path: Path) -> dict[str, dict[str, Any]]:
    """Load deduplicated awarded NOCOPO contracts keyed by normalized contractor name."""
    if not db_path.exists():
        return {}
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        tbl = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='nocopo_contracts'"
        ).fetchone()
        if tbl is None:
            return {}
        rows = conn.execute(
            """
            SELECT contractor_name, norm_contractor, bpp_contractor_id, contract_award_naira, mda_name
            FROM nocopo_contracts
            WHERE norm_contractor != '' AND contract_award_naira > 0
            """
        ).fetchall()
    finally:
        conn.close()

    agg: dict[str, dict[str, Any]] = {}
    for r in rows:
        key = str(r["norm_contractor"]).strip()
        if len(key) < 4:
            continue
        entry = agg.setdefault(
            key,
            {
                "contractorName": str(r["contractor_name"]),
                "bppContractorId": str(r["bpp_contractor_id"] or "") or None,
                "nocopoAwardCount": 0,
                "nocopoAwardedNaira": 0,
                "mdas": set(),
            },
        )
        if not entry["bppContractorId"] and r["bpp_contractor_id"]:
            entry["bppContractorId"] = str(r["bpp_contractor_id"])
        entry["nocopoAwardCount"] += 1
        entry["nocopoAwardedNaira"] += int(r["contract_award_naira"] or 0)
        if r["mda_name"]:
            entry["mdas"].add(str(r["mda_name"]))
    return agg


def build_govspend_index(
    jsonl_path: str | Path = DEFAULT_GOVSPEND_JSONL,
    datasets_dir: str | Path = DEFAULT_DATASETS_DIR,
    fts_sqlite_path: str | Path | None = DEFAULT_FTS_SQLITE,
    write: bool = True,
) -> dict[str, Any]:
    """Stream `govspend_all.jsonl`, build SQLite FTS5 ledger, and emit `govspend_summary.json`."""
    src_path = Path(jsonl_path)
    ds_dir = Path(datasets_dir)
    if not src_path.exists():
        payload = {
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "status": "AWAITING_GOVSPEND_DROP",
            "totalRowsScanned": 0,
            "validPaymentCount": 0,
            "zeroAmountExcludedCount": 0,
            "totalDisbursedNaira": 0,
            "yearlyTotals": [],
            "monthlyTotals": [],
            "topMdas": [],
            "topBeneficiaries": [],
            "splitPaymentAlerts": [],
            "nocopoCrossLinks": [],
        }
        if write:
            _atomic_write_json(ds_dir / "govspend_summary.json", payload)
        return payload

    sqlite_target = Path(fts_sqlite_path) if fts_sqlite_path is not None else None
    nocopo_map = _load_nocopo_by_contractor(sqlite_target) if sqlite_target else {}

    tmp_sqlite: Path | None = None
    conn: sqlite3.Connection | None = None
    if write and sqlite_target is not None:
        sqlite_target.parent.mkdir(parents=True, exist_ok=True)
        tmp_sqlite = Path(str(sqlite_target) + ".tmp")
        if tmp_sqlite.exists():
            tmp_sqlite.unlink()
        if sqlite_target.exists():
            shutil.copy2(sqlite_target, tmp_sqlite)
        conn = sqlite3.connect(str(tmp_sqlite))
        conn.execute("PRAGMA journal_mode=OFF")
        conn.execute("PRAGMA synchronous=OFF")
        conn.execute("DROP TABLE IF EXISTS govspend_fts")
        conn.execute("DROP TABLE IF EXISTS govspend_payments")
        conn.execute(
            """
            CREATE TABLE govspend_payments (
                payment_no TEXT PRIMARY KEY,
                payment_date TEXT,
                financial_year INTEGER,
                payer_code TEXT,
                organization_name TEXT,
                norm_mda TEXT,
                beneficiary_name TEXT,
                norm_beneficiary TEXT,
                amount_naira INTEGER,
                description TEXT
            )
            """
        )

    total_scanned = 0
    valid_count = 0
    zero_excluded = 0
    total_disbursed = 0
    min_date: str | None = None
    max_date: str | None = None

    yearly_stats: dict[int, dict[str, int]] = defaultdict(lambda: {"paymentCount": 0, "totalAmountNaira": 0})
    monthly_stats: dict[str, dict[str, int]] = defaultdict(lambda: {"paymentCount": 0, "totalAmountNaira": 0})
    mda_stats: dict[str, dict[str, Any]] = {}
    ben_stats: dict[str, dict[str, Any]] = {}
    # Keyed by (payment_date, norm_mda, norm_beneficiary) for same-day multi-voucher detection
    day_clusters: dict[tuple[str, str, str], dict[str, Any]] = {}

    batch: list[tuple[Any, ...]] = []
    batch_size = 10_000

    try:
        with open(src_path, "r", encoding="utf-8") as f:
            for line in f:
                raw = line.strip()
                if not raw:
                    continue
                row = json.loads(raw)
                total_scanned += 1

                try:
                    amt_naira = int(round(float(row.get("amount") or 0)))
                except Exception:
                    amt_naira = 0

                if amt_naira <= 0:
                    zero_excluded += 1
                    continue

                valid_count += 1
                total_disbursed += amt_naira

                p_no = str(row.get("payment_no") or f"ROW-{total_scanned}").strip()
                p_date = str(row.get("date") or "")[:10]
                yr = int(p_date[:4]) if len(p_date) >= 4 and p_date[:4].isdigit() else 0
                ym = p_date[:7] if len(p_date) >= 7 else ""
                if p_date:
                    if min_date is None or p_date < min_date:
                        min_date = p_date
                    if max_date is None or p_date > max_date:
                        max_date = p_date

                payer_code = normalize_admin_code(str(row.get("payer_code") or ""))
                org_raw = str(row.get("organization_name") or "").strip()
                ben_raw = str(row.get("beneficiary_name") or "").strip()
                desc = str(row.get("description") or "").strip()

                norm_mda = normalize_mda_name(org_raw)
                norm_ben = normalize_entity_name(ben_raw)

                if yr:
                    yearly_stats[yr]["paymentCount"] += 1
                    yearly_stats[yr]["totalAmountNaira"] += amt_naira
                if ym:
                    monthly_stats[ym]["paymentCount"] += 1
                    monthly_stats[ym]["totalAmountNaira"] += amt_naira

                mda_key = norm_mda or org_raw.upper()
                m_entry = mda_stats.get(mda_key)
                if m_entry is None:
                    m_entry = {
                        "organizationName": org_raw,
                        "payerCode": payer_code,
                        "paymentCount": 0,
                        "totalAmountNaira": 0,
                    }
                    mda_stats[mda_key] = m_entry
                m_entry["paymentCount"] += 1
                m_entry["totalAmountNaira"] += amt_naira

                ben_key = norm_ben or ben_raw.upper()
                b_entry = ben_stats.get(ben_key)
                if b_entry is None:
                    b_entry = {
                        "beneficiaryName": ben_raw,
                        "normBeneficiary": norm_ben,
                        "paymentCount": 0,
                        "totalAmountNaira": 0,
                        "topMda": org_raw,
                        "_topMdaAmt": 0,
                    }
                    ben_stats[ben_key] = b_entry
                b_entry["paymentCount"] += 1
                b_entry["totalAmountNaira"] += amt_naira
                if amt_naira > b_entry["_topMdaAmt"]:
                    b_entry["_topMdaAmt"] = amt_naira
                    b_entry["topMda"] = org_raw

                if p_date and mda_key and len(norm_ben) >= 4:
                    ckey = (p_date, mda_key, norm_ben)
                    c_entry = day_clusters.get(ckey)
                    if c_entry is None:
                        c_entry = {
                            "date": p_date,
                            "organizationName": org_raw,
                            "beneficiaryName": ben_raw,
                            "voucherCount": 0,
                            "totalAmountNaira": 0,
                            "sampleDescription": desc[:140],
                        }
                        day_clusters[ckey] = c_entry
                    c_entry["voucherCount"] += 1
                    c_entry["totalAmountNaira"] += amt_naira

                if conn is not None:
                    batch.append(
                        (
                            p_no,
                            p_date,
                            yr,
                            payer_code,
                            org_raw,
                            norm_mda,
                            ben_raw,
                            norm_ben,
                            amt_naira,
                            desc,
                        )
                    )
                    if len(batch) >= batch_size:
                        conn.executemany(
                            "INSERT OR REPLACE INTO govspend_payments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            batch,
                        )
                        batch.clear()

        if conn is not None:
            if batch:
                conn.executemany(
                    "INSERT OR REPLACE INTO govspend_payments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    batch,
                )
                batch.clear()
            conn.execute(
                """
                CREATE VIRTUAL TABLE govspend_fts USING fts5(
                    payment_no,
                    organization_name,
                    beneficiary_name,
                    description,
                    payer_code,
                    content='govspend_payments',
                    content_rowid='rowid'
                )
                """
            )
            conn.execute("INSERT INTO govspend_fts(govspend_fts) VALUES ('rebuild')")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_govspend_year ON govspend_payments(financial_year)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_govspend_norm_ben ON govspend_payments(norm_beneficiary)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_govspend_payer ON govspend_payments(payer_code)")
            conn.commit()
    finally:
        if conn is not None:
            conn.close()

    if write and tmp_sqlite is not None and sqlite_target is not None:
        for attempt in range(5):
            try:
                os.replace(tmp_sqlite, sqlite_target)
                break
            except PermissionError:
                if attempt == 4:
                    raise
                time.sleep(0.2)

    yearly_list = [
        {"year": yr, "paymentCount": v["paymentCount"], "totalAmountNaira": v["totalAmountNaira"]}
        for yr, v in sorted(yearly_stats.items())
    ]
    monthly_list = [
        {"month": ym, "paymentCount": v["paymentCount"], "totalAmountNaira": v["totalAmountNaira"]}
        for ym, v in sorted(monthly_stats.items())
    ]
    top_mdas = sorted(mda_stats.values(), key=lambda x: -x["totalAmountNaira"])[:50]
    top_bens = [
        {
            "beneficiaryName": v["beneficiaryName"],
            "normBeneficiary": v["normBeneficiary"],
            "paymentCount": v["paymentCount"],
            "totalAmountNaira": v["totalAmountNaira"],
            "topMda": v["topMda"],
        }
        for v in sorted(ben_stats.values(), key=lambda x: -x["totalAmountNaira"])[:50]
    ]

    split_alerts = sorted(
        (c for c in day_clusters.values() if c["voucherCount"] >= 3 and c["totalAmountNaira"] >= 5_000_000),
        key=lambda x: (-x["totalAmountNaira"], -x["voucherCount"]),
    )[:50]

    cross_links: list[dict[str, Any]] = []
    for norm_key, noc in nocopo_map.items():
        b_entry = ben_stats.get(norm_key)
        if not b_entry:
            continue
        cross_links.append(
            {
                "contractorName": noc["contractorName"],
                "bppContractorId": noc["bppContractorId"],
                "nocopoAwardCount": noc["nocopoAwardCount"],
                "nocopoAwardedNaira": noc["nocopoAwardedNaira"],
                "govspendPaymentCount": b_entry["paymentCount"],
                "govspendPaidNaira": b_entry["totalAmountNaira"],
                "mdas": sorted(noc["mdas"])[:8],
            }
        )
    cross_links.sort(key=lambda x: (-x["govspendPaidNaira"], -x["nocopoAwardedNaira"]))

    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "VERIFIED_GOVSPEND_LEDGER",
        "sourceFile": src_path.name,
        "sha256": _sha256_file(src_path),
        "totalRowsScanned": total_scanned,
        "validPaymentCount": valid_count,
        "zeroAmountExcludedCount": zero_excluded,
        "totalDisbursedNaira": total_disbursed,
        "dateRange": {"minDate": min_date, "maxDate": max_date},
        "uniqueOrganizationsCount": len(mda_stats),
        "uniqueBeneficiariesCount": len(ben_stats),
        "splitAlertTotalClusters": sum(1 for c in day_clusters.values() if c["voucherCount"] >= 3),
        "nocopoCrossLinkCount": len(cross_links),
        "yearlyTotals": yearly_list,
        "monthlyTotals": monthly_list,
        "topMdas": top_mdas,
        "topBeneficiaries": top_bens,
        "splitPaymentAlerts": split_alerts,
        "nocopoCrossLinks": cross_links[:60],
    }

    if write:
        _atomic_write_json(ds_dir / "govspend_summary.json", payload)

    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Index GovSpend Open Treasury JSONL into FTS5 + Summary")
    parser.add_argument("--jsonl", type=str, default=str(DEFAULT_GOVSPEND_JSONL))
    parser.add_argument("--datasets", type=str, default=str(DEFAULT_DATASETS_DIR))
    parser.add_argument("--sqlite", type=str, default=str(DEFAULT_FTS_SQLITE))
    args = parser.parse_args()

    out = build_govspend_index(args.jsonl, args.datasets, args.sqlite, write=True)
    print(
        f"GovSpend Ledger [{out['status']}]: scanned={out['totalRowsScanned']} | "
        f"valid={out['validPaymentCount']} | zeroExcluded={out['zeroAmountExcludedCount']} | "
        f"disbursed=NGN {out['totalDisbursedNaira']/1e12:.2f}T | "
        f"nocopoMatches={out.get('nocopoCrossLinkCount', 0)}"
    )


if __name__ == "__main__":
    main()
