"""
DMO Nigeria Debt Stock & Debt Service Parser
Extracts official annual public debt stock (External + Domestic, FGN + States/FCT)
and actual debt service payments from downloaded DMO PDFs (`dmo_pdfs/manifest.json`),
and writes `public/datasets/debt_profile.json` for year-by-year and presidential-term analysis.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF

from ingestion.parsers.ocr_engine import is_ocr_available, ocr_pdf_pages

# Priority rank for picking the best representative snapshot in a year (higher = better)
MONTH_RANK = {
    "12": 12, "dec": 12, "december": 12, "4th quarter": 12, "q4": 12,
    "09": 9, "sep": 9, "sept": 9, "september": 9, "3rd quarter": 9, "q3": 9,
    "06": 6, "jun": 6, "june": 6, "2nd quarter": 6, "q2": 6,
    "03": 3, "mar": 3, "march": 3, "1st quarter": 3, "q1": 3,
}

NUM_RE = re.compile(r"(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?")


def _parse_float(token: str) -> float | None:
    s = token.strip().replace(",", "")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _extract_numbers(text: str) -> list[float]:
    nums: list[float] = []
    for m in NUM_RE.finditer(text):
        raw = m.group(0).replace(",", "")
        try:
            val = float(raw)
            nums.append(val)
        except ValueError:
            continue
    return nums


def _snapshot_rank(doc: dict[str, Any]) -> int:
    """Rank snapshots so December / Q4 / full-year Jan-Dec wins over earlier quarters."""
    title = (doc.get("title") or "").lower()
    as_at = doc.get("as_at") or ""
    if "january" in title and ("december" in title or "dec" in title):
        return 100
    if "jan" in title and "dec" in title:
        return 100
    if as_at and len(as_at) >= 7:
        mm = as_at[5:7]
        if mm in MONTH_RANK:
            return MONTH_RANK[mm] * 5
    for k, r in MONTH_RANK.items():
        if k in title:
            return r * 5
    return 1


def _detect_unit_multiplier(text: str, default_unit: str = "M") -> float:
    """Return multiplier to normalize a value into Naira Millions (or USD Millions)."""
    low = text.lower()
    if "amount in naira" in low or "(=n=)" in low or "(naira)" in low:
        return 1e-6  # raw Naira -> Millions
    if "n'b" in low or "n billion" in low or "₦ billion" in low or "in billion" in low or "n’b" in low:
        return 1_000.0  # Billions -> Millions
    if "n'm" in low or "n’m" in low or "us$'m" in low or "us$’m" in low or "in million" in low or "million" in low:
        return 1.0  # already Millions
    return 1.0 if default_unit == "M" else 1_000.0


def _read_pdf_text(path: str, max_pages: int = 4, enable_ocr: bool = True) -> str:
    try:
        doc = fitz.open(path)
        try:
            pages = min(len(doc), max_pages)
            text = "\n".join(doc[i].get_text("text") for i in range(pages))
            page_indices = list(range(pages))
        finally:
            doc.close()
        if len(text.strip()) < 40 and enable_ocr and page_indices and is_ocr_available():
            ocr_pages = ocr_pdf_pages(Path(path), page_indices=page_indices, dpi=200, verbose=False)
            ocr_text = "\n".join(
                str(ocr_pages.get(i + 1, {}).get("text") or "") for i in page_indices
            ).strip()
            if ocr_text:
                return ocr_text
        return text
    except Exception:
        return ""


def _ocr_remaining_scanned_dmo_pdfs(dmo_root: Path, *, dpi: int = 200) -> list[dict[str, Any]]:
    """OCR any remaining image-only PDFs under `dmo_root` so none remain uncached/skipped."""
    recovered: list[dict[str, Any]] = []
    if not dmo_root.exists() or not is_ocr_available():
        return recovered
    for pdf in sorted(dmo_root.rglob("*.pdf")):
        try:
            doc = fitz.open(str(pdf))
            try:
                sample_n = min(len(doc), 5)
                if sample_n == 0:
                    continue
                chars = sum(len(doc[i].get_text("text").strip()) for i in range(sample_n))
                avg = chars / sample_n
            finally:
                doc.close()
            if avg < 40.0:
                ocr_pages = ocr_pdf_pages(pdf, dpi=dpi, verbose=False)
                recovered.append(
                    {
                        "file": pdf.relative_to(dmo_root).as_posix(),
                        "pages": len(ocr_pages),
                        "chars": sum(len(str(p.get("text") or "").strip()) for p in ocr_pages.values()),
                    }
                )
        except Exception:
            continue
    return recovered


def _parse_total_public_debt_pdf(path: str, title: str) -> dict[str, Any] | None:
    text = _read_pdf_text(path, max_pages=2)
    if not text.strip():
        return None

    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    joined = "\n".join(lines)

    # Detect CBN FX rate if stated
    fx_rate = None
    fx_match = re.search(r"US\$1\s*/\s*[N₦]?\s*(\d{1,4}(?:,\d{3})*(?:\.\d+)?)", joined, re.I)
    if fx_match:
        fx_rate = _parse_float(fx_match.group(1))

    # Helper to find the first 2 numbers (USD'M, N'M) following a label within next 4 lines
    def find_pair(label_patterns: list[str]) -> tuple[float | None, float | None]:
        for idx, ln in enumerate(lines):
            low = ln.lower()
            if any(re.search(pat, low) for pat in label_patterns):
                window = " ".join(lines[idx : idx + 5])
                nums = [n for n in _extract_numbers(window) if n > 10.0 and n not in (2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026)]
                # Expect USD'M then N'M (where N'M > USD'M in Nigeria for all 2004-2026)
                if len(nums) >= 2:
                    a, b = nums[0], nums[1]
                    # Filter out percentage like 46.73 if it sneaks in before N'M
                    if b < a and len(nums) >= 3:
                        b = nums[2]
                    if b >= a:
                        return a, b
        return None, None

    ext_usd, ext_ngn = find_pair([r"total\s+external\s+debt", r"^\s*a\.\s*external\s+debt"])
    dom_usd, dom_ngn = find_pair([r"total\s+domestic\s+debt", r"^\s*b\.\s*domestic\s+debt"])
    tot_usd, tot_ngn = find_pair([r"total\s+public\s+debt", r"^\s*c\.\s*total\s+public\s+debt"])

    if not tot_ngn and ext_ngn and dom_ngn:
        tot_ngn = round(ext_ngn + dom_ngn, 2)
    if not tot_usd and ext_usd and dom_usd:
        tot_usd = round(ext_usd + dom_usd, 2)

    if not tot_ngn:
        return None

    # Sanity unit check: if tot_ngn < 50_000 (e.g. written in Billions), convert to Millions
    if tot_ngn < 50_000 and ("billion" in joined.lower() or "n’b" in joined.lower() or "n'b" in joined.lower()):
        scale = 1_000.0
        tot_ngn *= scale
        if ext_ngn:
            ext_ngn *= scale
        if dom_ngn:
            dom_ngn *= scale

    return {
        "externalDebtUsdM": round(ext_usd, 2) if ext_usd else None,
        "externalDebtNairaM": round(ext_ngn, 2) if ext_ngn else None,
        "domesticDebtUsdM": round(dom_usd, 2) if dom_usd else None,
        "domesticDebtNairaM": round(dom_ngn, 2) if dom_ngn else None,
        "totalDebtUsdM": round(tot_usd, 2) if tot_usd else None,
        "totalDebtNairaM": round(tot_ngn, 2),
        "cbnFxRate": fx_rate,
        "sourceTitle": title,
    }


def _parse_domestic_stock_fallback(path: str, title: str) -> float | None:
    """Parse FGN Domestic Debt Stock PDFs -> returns Naira Millions."""
    text = _read_pdf_text(path, max_pages=2)
    if not text.strip():
        return None
    mult = _detect_unit_multiplier(text, default_unit="M")
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    for idx in range(len(lines) - 1, -1, -1):
        low = lines[idx].lower()
        if "total" in low and "sub-total" not in low:
            window = " ".join(lines[idx : idx + 3])
            nums = [
                n for n in _extract_numbers(window)
                if n > 100 and not (1980 <= n <= 2030 and n == int(n))
            ]
            if nums:
                val = max(nums)
                # Auto-detect raw Naira (> 100 billion) vs Billions (< 50,000) vs Millions
                if val > 100_000_000:
                    return round(val / 1e6, 2)
                if val < 50_000 and mult == 1.0:
                    return round(val * 1_000.0, 2)
                return round(val * mult, 2)
    return None


def _parse_external_stock_fallback(path: str, title: str) -> float | None:
    """Parse External Debt Stock PDFs -> returns USD Millions."""
    text = _read_pdf_text(path, max_pages=2)
    if not text.strip():
        return None
    low_all = text.lower()
    is_billions = "us$ billion" in low_all or "in billion" in low_all
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    for idx in range(len(lines) - 1, -1, -1):
        low = lines[idx].lower()
        if "grand total" in low or (low.startswith("total") and "sub" not in low):
            window = " ".join(lines[idx : idx + 4])
            nums = [
                n for n in _extract_numbers(window)
                if n > 100 and not (1980 <= n <= 2030 and n == int(n))
            ]
            if nums:
                val = max(nums)
                if val > 100_000_000:
                    return round(val / 1e6, 2)
                if is_billions and val < 500:
                    return round(val * 1_000.0, 2)
                return round(val, 2)
    return None


def _parse_debt_service_total(path: str, is_external: bool = False) -> float | None:
    """Extract total annual debt service (Naira Millions for domestic, USD Millions for external)."""
    text = _read_pdf_text(path, max_pages=3)
    if not text.strip():
        return None
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    for idx in range(len(lines) - 1, -1, -1):
        low = lines[idx].lower()
        if "grand total" in low or ("total" in low and "sub" not in low and "q1" not in low and "q2" not in low):
            window = " ".join(lines[idx : idx + 4])
            nums = [n for n in _extract_numbers(window) if n > 100]
            if nums:
                val = nums[-1]  # rightmost column is usually annual/cumulative TOTAL
                if val > 1_000_000_000:
                    return round(val / 1e6, 2)  # raw Naira / USD -> Millions
                if is_external and val > 100_000:
                    return round(val / 1e3, 2)  # thousands -> Millions
                return round(val, 2)
    return None


def build_debt_profile(
    manifest_path: str | Path = "dmo_pdfs/manifest.json",
    output_path: str | Path = "public/datasets/debt_profile.json",
    enable_ocr: bool = True,
) -> dict[str, Any]:
    manifest_file = Path(manifest_path)
    if not manifest_file.exists():
        raise FileNotFoundError(f"DMO manifest not found: {manifest_file}")

    ocr_recovered_files = (
        _ocr_remaining_scanned_dmo_pdfs(manifest_file.parent) if enable_ocr else []
    )

    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    docs = manifest.get("documents", [])

    by_year: dict[int, list[dict[str, Any]]] = {}
    for d in docs:
        yr_str = str(d.get("year") or "")
        if yr_str.isdigit():
            yr = int(yr_str)
            if 1999 <= yr <= 2026:
                by_year.setdefault(yr, []).append(d)

    # Official CBN annual average / budget FX fallback for years without Total Public Debt PDF (2004-2017)
    historical_fx = {
        2004: 132.9, 2005: 131.3, 2006: 128.7, 2007: 125.8, 2008: 117.0,
        2009: 148.9, 2010: 150.3, 2011: 153.9, 2012: 157.5, 2013: 157.3,
        2014: 158.6, 2015: 192.4, 2016: 253.5, 2017: 305.8,
    }

    yearly_records: list[dict[str, Any]] = []
    for yr in sorted(by_year.keys()):
        yr_docs = by_year[yr]
        # 1. Total Public Debt PDFs
        total_docs = sorted(
            [d for d in yr_docs if d.get("category") == "total-public-debts" or "total public debt" in (d.get("title") or "").lower()],
            key=_snapshot_rank,
            reverse=True,
        )
        parsed_total = None
        for d in total_docs:
            p = d.get("local_path")
            if p and Path(p).exists():
                parsed_total = _parse_total_public_debt_pdf(p, d.get("title", ""))
                if parsed_total:
                    parsed_total["asAt"] = d.get("as_at")
                    parsed_total["localPath"] = p
                    break

        # 2. Fallback Domestic & External Stocks if Total Public Debt PDF wasn't published/parsed
        dom_docs = sorted(
            [
                d for d in yr_docs
                if (d.get("category") == "domestic-debts__debt-stock" or "domestic debt stock" in (d.get("title") or "").lower())
                and "states" not in (d.get("title") or "").lower()
                and "fgn bonds stock" not in (d.get("title") or "").lower()
                and "1999" not in (d.get("title") or "").lower()
                and "1996" not in (d.get("title") or "").lower()
            ],
            key=_snapshot_rank,
            reverse=True,
        )
        ext_docs = sorted(
            [
                d for d in yr_docs
                if (d.get("category") == "external-debts__external-debt-stock" or "external debt stock" in (d.get("title") or "").lower())
                and "states" not in (d.get("title") or "").lower()
                and "1983" not in (d.get("title") or "").lower()
            ],
            key=_snapshot_rank,
            reverse=True,
        )

        dom_fallback_ngn_m = None
        dom_source = None
        for d in dom_docs:
            p = d.get("local_path")
            if p and Path(p).exists():
                val = _parse_domestic_stock_fallback(p, d.get("title", ""))
                if val:
                    dom_fallback_ngn_m = val
                    dom_source = d.get("title")
                    break

        ext_fallback_usd_m = None
        ext_source = None
        for d in ext_docs:
            p = d.get("local_path")
            if p and Path(p).exists():
                val = _parse_external_stock_fallback(p, d.get("title", ""))
                if val:
                    ext_fallback_usd_m = val
                    ext_source = d.get("title")
                    break

        # 3. Debt Service (Domestic & External)
        dom_svc_docs = sorted(
            [d for d in yr_docs if d.get("category") == "domestic-debts__domestic-debt-service"],
            key=_snapshot_rank,
            reverse=True,
        )
        ext_svc_docs = sorted(
            [d for d in yr_docs if d.get("category") == "external-debts__debt-service"],
            key=_snapshot_rank,
            reverse=True,
        )

        dom_svc_ngn_m = None
        for d in dom_svc_docs:
            p = d.get("local_path")
            if p and Path(p).exists():
                dom_svc_ngn_m = _parse_debt_service_total(p, is_external=False)
                if dom_svc_ngn_m:
                    break

        ext_svc_usd_m = None
        for d in ext_svc_docs:
            p = d.get("local_path")
            if p and Path(p).exists():
                ext_svc_usd_m = _parse_debt_service_total(p, is_external=True)
                if ext_svc_usd_m:
                    break

        dom_ngn_m = (parsed_total.get("domesticDebtNairaM") if parsed_total else None) or dom_fallback_ngn_m
        ext_usd_m = (parsed_total.get("externalDebtUsdM") if parsed_total else None) or ext_fallback_usd_m
        fx = (parsed_total.get("cbnFxRate") if parsed_total else None) or historical_fx.get(yr)
        ext_ngn_m = (parsed_total.get("externalDebtNairaM") if parsed_total else None) or (
            round(ext_usd_m * fx, 2) if (ext_usd_m and fx) else None
        )
        tot_ngn_m = (parsed_total.get("totalDebtNairaM") if parsed_total else None) or (
            round((dom_ngn_m or 0.0) + (ext_ngn_m or 0.0), 2) if (dom_ngn_m or ext_ngn_m) else None
        )
        tot_usd_m = (parsed_total.get("totalDebtUsdM") if parsed_total else None) or (
            round(tot_ngn_m / fx, 2) if (tot_ngn_m and fx) else None
        )

        entry: dict[str, Any] = {
            "financialYear": yr,
            "documentCount": len(yr_docs),
            "asAt": parsed_total.get("asAt") if parsed_total else None,
            "isDerivedTotal": parsed_total is None and tot_ngn_m is not None,
            "totalDebtNairaM": tot_ngn_m,
            "totalDebtUsdM": tot_usd_m,
            "domesticDebtNairaM": dom_ngn_m,
            "externalDebtUsdM": ext_usd_m,
            "externalDebtNairaM": ext_ngn_m,
            "domesticDebtServiceNairaM": dom_svc_ngn_m,
            "externalDebtServiceUsdM": ext_svc_usd_m,
            "cbnFxRate": fx,
            "primarySource": (
                parsed_total.get("sourceTitle")
                if parsed_total
                else (dom_source or ext_source or (yr_docs[0].get("title") if yr_docs else None))
            ),
        }
        yearly_records.append(entry)

    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Debt Management Office (DMO) Nigeria — dmo.gov.ng",
        "totalDocumentsIndexed": len(docs),
        "ocrRecoveredCount": len(ocr_recovered_files),
        "ocrRecoveredFiles": ocr_recovered_files,
        "yearsCovered": [r["financialYear"] for r in yearly_records],
        "yearlyDebt": yearly_records,
    }

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    os.replace(tmp, out)
    return payload


if __name__ == "__main__":
    result = build_debt_profile()
    print(f"Wrote public/datasets/debt_profile.json ({len(result['yearlyDebt'])} years)")
    for row in result["yearlyDebt"]:
        tot_t = f"₦{row['totalDebtNairaM']/1e6:.2f}T" if row["totalDebtNairaM"] else "—"
        usd_b = f"${row['totalDebtUsdM']/1e3:.2f}B" if row["totalDebtUsdM"] else "—"
        dom_t = f"₦{row['domesticDebtNairaM']/1e6:.2f}T" if row["domesticDebtNairaM"] else "—"
        ext_b = f"${row['externalDebtUsdM']/1e3:.2f}B" if row["externalDebtUsdM"] else "—"
        print(f"  {row['financialYear']}: Total={tot_t} ({usd_b}) | Dom={dom_t} | Ext={ext_b} | {row['primarySource']}")
