"""Executive Bill vs. Enacted Act 'Budget Padding' Diff Builder (2017-2025).

Parses Executive Appropriation Bills and Enacted Appropriation Acts in strict
role-isolated passes via `PdfParser`, matches line items using a 3-tier
algorithm (Code+MDA -> Title+MDA -> Token Jaccard >= 0.82), flags Zonal
Intervention Projects (ZIP) and summary-vs-schedule granularity guards, and emits:
  - `public/datasets/bill_act_diffs/index.json`
  - `public/datasets/bill_act_diffs/<year>.json`
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF

from ingestion.parsers.pdf_parser import PdfParser

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE_ROOT = PROJECT_ROOT / "source_pdfs"
DEFAULT_DATASETS_DIR = PROJECT_ROOT / "public" / "datasets"

TARGET_CYCLES = (2017, 2019, 2020, 2021, 2022, 2023, 2024, 2025)

IGNORE_FILENAME_TERMS = (
    "mtef",
    "mtff",
    "fsp",
    "speech",
    "citizen",
    "guideline",
    "implementation",
    "call circular",
    "public presentation",
    "overview",
    "breakdown",
    "bimms",
    "goes",
    "finance act",
    "independent revenue",
    "economic recovery and growth",
    "esc plan",
    "nesp",
    "other docx",
    "table of content",
    "page ",
    "professional bodies",
    "extension of",
    "repeal bill",
    "budget performance",
    "bilateral circular",
)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return f"sha256:{h.hexdigest()}"


def _is_text_native_pdf(path: Path) -> tuple[bool, int]:
    """Samples up to 15 pages to avoid wasting minutes on image-only scanned volumes."""
    try:
        doc = fitz.open(str(path))
        total_pages = len(doc)
        if total_pages == 0:
            doc.close()
            return False, 0
        if total_pages <= 20:
            doc.close()
            return True, total_pages
        step = max(1, total_pages // 15)
        sampled = list(range(0, total_pages, step))[:15]
        text_pages = sum(1 for i in sampled if len(doc[i].get_text("text").strip()) > 40)
        doc.close()
        return (text_pages / len(sampled)) >= 0.10, total_pages
    except Exception:
        return False, 0


def classify_pdf_role(filename: str) -> str:
    lower = filename.lower()
    if any(term in lower for term in IGNORE_FILENAME_TERMS):
        return "IGNORE"
    if "bill" in lower or "proposed" in lower or "proposal" in lower:
        return "BILL"
    if (
        "act" in lower
        or "approved" in lower
        or "signed" in lower
        or "zonal intervention" in lower
        or "supplementary" in lower
        or "revised 2020 appropriation" in lower
        or lower == "2019 budget.pdf"
    ):
        return "ACT"
    return "IGNORE"


def select_cycle_pdfs(year_dir: Path) -> tuple[list[Path], list[Path]]:
    """
    Selects the cleanest text-native BILL and ACT PDFs for a fiscal year.
    When detailed schedules (>= 100 pages) exist for a role, excludes short summary Acts/Bills
    for that same role to prevent double-counting.
    """
    bill_candidates: list[tuple[Path, int]] = []
    act_candidates: list[tuple[Path, int]] = []

    if not year_dir.exists():
        return [], []

    for pdf in sorted(year_dir.glob("*.pdf")):
        role = classify_pdf_role(pdf.name)
        if role == "IGNORE":
            continue
        is_text, pages = _is_text_native_pdf(pdf)
        if not is_text:
            print(f"    [SKIP SCANNED] {pdf.name} ({pages} pages)")
            continue
        if role == "BILL":
            bill_candidates.append((pdf, pages))
        elif role == "ACT":
            act_candidates.append((pdf, pages))

    def _prefer_detailed(cands: list[tuple[Path, int]]) -> list[Path]:
        detailed = [p for p, pages in cands if pages >= 100]
        if detailed:
            return detailed
        return [p for p, _pages in cands]

    return _prefer_detailed(bill_candidates), _prefer_detailed(act_candidates)


def normalize_mda(name: str) -> str:
    s = re.sub(r"\s+", " ", str(name or "")).strip()
    s = re.sub(r"\s*[-–]\s*HQTRS\.?$", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s+HQTRS\.?$", "", s, flags=re.IGNORECASE)
    s = re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()
    return s


def normalize_title(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(title or "").lower()).strip()


def normalize_code(code: str) -> str:
    c = re.sub(r"[^A-Z0-9]", "", str(code or "").upper())
    if len(c) < 4 or c in {"ERGP", "N/A", "NONE", "LINE"}:
        return ""
    return c


def is_zonal_intervention(code: str, title: str, source_file: str) -> bool:
    c = str(code or "").upper()
    t = str(title or "").lower()
    s = str(source_file or "").lower()
    return (
        "zonal intervention" in s
        or c.startswith(("ZIP", "NASS"))
        or "zonal intervention" in t
        or "constituency project" in t
        or "(zip)" in t
    )


def _token_jaccard(a_tokens: set[str], b_tokens: set[str]) -> float:
    if not a_tokens or not b_tokens:
        return 0.0
    inter = len(a_tokens & b_tokens)
    if inter == 0:
        return 0.0
    union = len(a_tokens | b_tokens)
    return inter / union


def _parse_role_records(year: int, pdfs: list[Path], role: str) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """Parses a set of role-isolated PDFs into normalized deduplicated line-item dicts."""
    items: list[dict[str, Any]] = []
    hashes: dict[str, str] = {}
    seen_keys: set[tuple[str, str, str, int]] = set()

    for idx, pdf_path in enumerate(pdfs):
        hashes[pdf_path.name] = sha256_file(pdf_path)
        parser = PdfParser(str(pdf_path), year, file_tag=f"{role[0]}{idx + 1}")
        try:
            raw_rows, _pages = parser.parse()
        finally:
            doc = getattr(parser, "doc", None)
            if doc is not None:
                doc.close()

        for row in raw_rows:
            title = str(row.get("projectName") or "").strip()
            amt = int(row.get("amount") or 0)
            if not title or amt <= 0:
                continue
            mda = str(row.get("agency") or "Federal MDA").strip()
            code = str(row.get("projectCode") or "").strip()
            norm_c = normalize_code(code)
            norm_m = normalize_mda(mda)
            norm_t = normalize_title(title)
            dedup_key = (norm_c, norm_m, norm_t, amt)
            if dedup_key in seen_keys:
                continue
            seen_keys.add(dedup_key)

            items.append(
                {
                    "projectCode": code or "ERGP",
                    "normCode": norm_c,
                    "projectName": title,
                    "normTitle": norm_t,
                    "tokens": {tok for tok in norm_t.split() if len(tok) >= 3},
                    "mdaName": mda or "Federal MDA",
                    "normMda": norm_m,
                    "amountNaira": amt,
                    "page": int(row.get("page") or 1),
                    "sourceFile": pdf_path.name,
                    "sha256": hashes[pdf_path.name],
                    "isZip": is_zonal_intervention(code, title, pdf_path.name),
                }
            )
    return items, hashes


def match_bill_and_act_items(
    year: int,
    bill_items: list[dict[str, Any]],
    act_items: list[dict[str, Any]],
    bill_hashes: dict[str, str],
    act_hashes: dict[str, str],
) -> dict[str, Any]:
    """
    Executes the 3-tier matching algorithm:
      Tier 1: Exact (normCode, normMda)
      Tier 2: Exact (normMda, normTitle) with generic-MDA fallback on exact normTitle
      Tier 3: Same normMda token Jaccard >= 0.82
    """
    matched_bill: set[int] = set()
    matched_act: set[int] = set()
    diff_rows: list[dict[str, Any]] = []

    # Indexes for Act items
    act_by_code_mda: dict[tuple[str, str], list[int]] = defaultdict(list)
    act_by_title_mda: dict[tuple[str, str], list[int]] = defaultdict(list)
    act_by_title_only: dict[str, list[int]] = defaultdict(list)
    act_by_mda: dict[str, list[int]] = defaultdict(list)

    for a_idx, a in enumerate(act_items):
        if a["normCode"]:
            act_by_code_mda[(a["normCode"], a["normMda"])].append(a_idx)
        act_by_title_mda[(a["normMda"], a["normTitle"])].append(a_idx)
        act_by_title_only[a["normTitle"]].append(a_idx)
        act_by_mda[a["normMda"]].append(a_idx)

    def _emit_pair(b_idx: int, a_idx: int, confidence: str) -> None:
        matched_bill.add(b_idx)
        matched_act.add(a_idx)
        b = bill_items[b_idx]
        a = act_items[a_idx]
        proposed = b["amountNaira"]
        enacted = a["amountNaira"]
        delta = enacted - proposed
        delta_pct = round((delta / proposed) * 100.0, 2) if proposed > 0 else None
        if enacted > proposed:
            status = "ALLOCATION_INFLATED"
        elif enacted < proposed:
            status = "ALLOCATION_CUT"
        else:
            status = "UNCHANGED"

        diff_rows.append(
            {
                "id": f"DIFF-{year}-{len(diff_rows) + 1:05d}",
                "financialYear": year,
                "status": status,
                "matchConfidence": confidence,
                "isZonalIntervention": bool(a["isZip"] or b["isZip"]),
                "projectCode": a["projectCode"] or b["projectCode"],
                "projectName": a["projectName"] or b["projectName"],
                "mdaName": a["mdaName"] if a["mdaName"] != "Federal MDA" else b["mdaName"],
                "proposedAmountNaira": proposed,
                "enactedAmountNaira": enacted,
                "deltaNaira": delta,
                "deltaPct": delta_pct,
                "billSourceFile": b["sourceFile"],
                "billPage": b["page"],
                "actSourceFile": a["sourceFile"],
                "actPage": a["page"],
                "billSha256": b["sha256"],
                "actSha256": a["sha256"],
            }
        )

    def _pick_closest(b_amt: int, cand_indices: list[int]) -> int | None:
        avail = [idx for idx in cand_indices if idx not in matched_act]
        if not avail:
            return None
        return min(avail, key=lambda idx: abs(act_items[idx]["amountNaira"] - b_amt))

    # Tier 1: Exact (normCode, normMda)
    for b_idx, b in enumerate(bill_items):
        if not b["normCode"]:
            continue
        pick = _pick_closest(b["amountNaira"], act_by_code_mda.get((b["normCode"], b["normMda"]), []))
        if pick is not None:
            _emit_pair(b_idx, pick, "EXACT_CODE")

    # Tier 2: Exact (normMda, normTitle) + generic fallback on normTitle
    for b_idx, b in enumerate(bill_items):
        if b_idx in matched_bill:
            continue
        pick = _pick_closest(b["amountNaira"], act_by_title_mda.get((b["normMda"], b["normTitle"]), []))
        if pick is None:
            pick = _pick_closest(b["amountNaira"], act_by_title_only.get(b["normTitle"], []))
        if pick is not None:
            _emit_pair(b_idx, pick, "EXACT_TITLE")

    # Tier 3: Same normMda token Jaccard >= 0.82
    for b_idx, b in enumerate(bill_items):
        if b_idx in matched_bill or len(b["tokens"]) < 3:
            continue
        best_idx = None
        best_sim = 0.8199
        for a_idx in act_by_mda.get(b["normMda"], []):
            if a_idx in matched_act:
                continue
            sim = _token_jaccard(b["tokens"], act_items[a_idx]["tokens"])
            if sim > best_sim:
                best_sim = sim
                best_idx = a_idx
        if best_idx is not None:
            _emit_pair(b_idx, best_idx, "FUZZY_MDA_TITLE")

    default_bill_file = next(iter(bill_hashes.keys()), "")
    default_bill_sha = next(iter(bill_hashes.values()), "")
    default_act_file = next(iter(act_hashes.keys()), "")
    default_act_sha = next(iter(act_hashes.values()), "")

    # Unmatched Act items -> NASS_INSERTION
    for a_idx, a in enumerate(act_items):
        if a_idx in matched_act:
            continue
        diff_rows.append(
            {
                "id": f"DIFF-{year}-{len(diff_rows) + 1:05d}",
                "financialYear": year,
                "status": "NASS_INSERTION",
                "matchConfidence": "UNMATCHED",
                "isZonalIntervention": bool(a["isZip"]),
                "projectCode": a["projectCode"],
                "projectName": a["projectName"],
                "mdaName": a["mdaName"],
                "proposedAmountNaira": 0,
                "enactedAmountNaira": a["amountNaira"],
                "deltaNaira": a["amountNaira"],
                "deltaPct": None,
                "billSourceFile": default_bill_file or "Executive Appropriation Bill",
                "billPage": None,
                "actSourceFile": a["sourceFile"],
                "actPage": a["page"],
                "billSha256": default_bill_sha,
                "actSha256": a["sha256"],
            }
        )

    # Unmatched Bill items -> REMOVED_BY_NASS
    for b_idx, b in enumerate(bill_items):
        if b_idx in matched_bill:
            continue
        diff_rows.append(
            {
                "id": f"DIFF-{year}-{len(diff_rows) + 1:05d}",
                "financialYear": year,
                "status": "REMOVED_BY_NASS",
                "matchConfidence": "UNMATCHED",
                "isZonalIntervention": bool(b["isZip"]),
                "projectCode": b["projectCode"],
                "projectName": b["projectName"],
                "mdaName": b["mdaName"],
                "proposedAmountNaira": b["amountNaira"],
                "enactedAmountNaira": 0,
                "deltaNaira": -b["amountNaira"],
                "deltaPct": -100.0,
                "billSourceFile": b["sourceFile"],
                "billPage": b["page"],
                "actSourceFile": default_act_file or "Enacted Appropriation Act",
                "actPage": None,
                "billSha256": b["sha256"],
                "actSha256": default_act_sha,
            }
        )

    # Granularity Guard
    is_line_item_pair = len(bill_items) >= 1000 and len(act_items) >= 1000
    comparison_scope = "LINE_ITEM_SCHEDULE" if is_line_item_pair else "SUMMARY_LEVEL_ONLY"
    comparison_note = (
        "Full Executive Bill schedule vs. Enacted Act schedule line-item comparison."
        if is_line_item_pair
        else (
            f"Summary/Partial granularity mismatch (Bill: {len(bill_items):,} rows vs. Act: {len(act_items):,} rows). "
            "Interpret insertions and removals alongside statutory summary totals rather than pure 1:1 schedule padding."
        )
    )

    bill_total = sum(b["amountNaira"] for b in bill_items)
    act_total = sum(a["amountNaira"] for a in act_items)
    net_delta = act_total - bill_total

    insertions = [d for d in diff_rows if d["status"] == "NASS_INSERTION"]
    inflated = [d for d in diff_rows if d["status"] == "ALLOCATION_INFLATED"]
    cuts = [d for d in diff_rows if d["status"] == "ALLOCATION_CUT"]
    removed = [d for d in diff_rows if d["status"] == "REMOVED_BY_NASS"]
    unchanged = [d for d in diff_rows if d["status"] == "UNCHANGED"]
    zips = [d for d in diff_rows if d["isZonalIntervention"]]

    mda_agg: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"mdaName": "", "insertionsNaira": 0, "inflatedDeltaNaira": 0, "cutDeltaNaira": 0, "alteredCount": 0}
    )
    for d in diff_rows:
        if d["status"] == "UNCHANGED":
            continue
        m = mda_agg[d["mdaName"]]
        m["mdaName"] = d["mdaName"]
        m["alteredCount"] += 1
        if d["status"] == "NASS_INSERTION":
            m["insertionsNaira"] += d["enactedAmountNaira"]
        elif d["status"] == "ALLOCATION_INFLATED":
            m["inflatedDeltaNaira"] += d["deltaNaira"]
        elif d["status"] == "ALLOCATION_CUT":
            m["cutDeltaNaira"] += abs(d["deltaNaira"])

    top_padded_mdas = sorted(
        (
            {
                **v,
                "totalPositivePaddingNaira": v["insertionsNaira"] + v["inflatedDeltaNaira"],
            }
            for v in mda_agg.values()
            if (v["insertionsNaira"] + v["inflatedDeltaNaira"]) > 0
        ),
        key=lambda x: -x["totalPositivePaddingNaira"],
    )[:15]

    altered = [d for d in diff_rows if d["status"] != "UNCHANGED"]
    altered.sort(key=lambda d: -abs(d["deltaNaira"]))
    unchanged.sort(key=lambda d: -d["enactedAmountNaira"])
    capped_items = altered[:1500] + unchanged[:100]

    summary = {
        "financialYear": year,
        "comparisonScope": comparison_scope,
        "comparisonNote": comparison_note,
        "billFiles": list(bill_hashes.keys()),
        "actFiles": list(act_hashes.keys()),
        "billSha256": default_bill_sha,
        "actSha256": default_act_sha,
        "billItemCount": len(bill_items),
        "actItemCount": len(act_items),
        "billTotalNaira": bill_total,
        "actTotalNaira": act_total,
        "netDeltaNaira": net_delta,
        "insertionsCount": len(insertions),
        "insertionsTotalNaira": sum(d["enactedAmountNaira"] for d in insertions),
        "inflatedCount": len(inflated),
        "inflatedTotalNaira": sum(d["deltaNaira"] for d in inflated),
        "cutCount": len(cuts),
        "cutTotalNaira": sum(abs(d["deltaNaira"]) for d in cuts),
        "removedCount": len(removed),
        "removedTotalNaira": sum(d["proposedAmountNaira"] for d in removed),
        "unchangedCount": len(unchanged),
        "zipCount": len(zips),
        "zipTotalNaira": sum(d["enactedAmountNaira"] or d["proposedAmountNaira"] for d in zips),
        "topPaddedMdas": top_padded_mdas,
    }

    return {
        "summary": summary,
        "items": capped_items,
    }


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


def build_all_bill_act_diffs(
    source_root: str | Path = DEFAULT_SOURCE_ROOT,
    datasets_dir: str | Path = DEFAULT_DATASETS_DIR,
    years: tuple[int, ...] = TARGET_CYCLES,
) -> dict[str, Any]:
    src_root = Path(source_root)
    out_dir = Path(datasets_dir) / "bill_act_diffs"
    out_dir.mkdir(parents=True, exist_ok=True)

    summaries: list[dict[str, Any]] = []
    for yr in years:
        print(f"  [BILL-VS-ACT] Processing FY {yr}...")
        bill_pdfs, act_pdfs = select_cycle_pdfs(src_root / str(yr))
        if not bill_pdfs or not act_pdfs:
            print(f"    [SKIP] Missing comparable Bill/Act PDFs for FY {yr}")
            continue
        bill_items, bill_hashes = _parse_role_records(yr, bill_pdfs, "BILL")
        act_items, act_hashes = _parse_role_records(yr, act_pdfs, "ACT")
        year_result = match_bill_and_act_items(yr, bill_items, act_items, bill_hashes, act_hashes)
        s = year_result["summary"]
        summaries.append(s)
        _atomic_write_json(out_dir / f"{yr}.json", {**s, "items": year_result["items"]})
        print(
            f"    FY {yr} [{s['comparisonScope']}]: "
            f"Bill={s['billItemCount']:,} (NGN {s['billTotalNaira'] / 1e12:.2f}T) vs "
            f"Act={s['actItemCount']:,} (NGN {s['actTotalNaira'] / 1e12:.2f}T) | "
            f"Insertions={s['insertionsCount']:,} | Inflated={s['inflatedCount']:,} | Cuts={s['cutCount']:,}"
        )

    index_payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "cyclesCount": len(summaries),
        "cycles": summaries,
    }
    _atomic_write_json(out_dir / "index.json", index_payload)
    return index_payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Build 2017-2025 Bill vs. Act Budget Padding Diff datasets")
    parser.add_argument("--source", type=str, default=str(DEFAULT_SOURCE_ROOT))
    parser.add_argument("--datasets", type=str, default=str(DEFAULT_DATASETS_DIR))
    args = parser.parse_args()

    res = build_all_bill_act_diffs(source_root=args.source, datasets_dir=args.datasets)
    print(f"\nBill vs. Act Diff build complete: {res['cyclesCount']} cycles written to public/datasets/bill_act_diffs/.")


if __name__ == "__main__":
    main()
