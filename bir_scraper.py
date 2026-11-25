#!/usr/bin/env python3
"""
Budget Office of the Federation — Quarterly Budget Implementation Report (BIR) Scraper

Crawls:
    https://budgetoffice.gov.ng/index.php/resources/internal-resources/reports/quarterly-budget-implementation
and downloads all yearly BIR PDFs into:
    bir_pdfs/<year>/<slug>.pdf
    bir_pdfs/manifest.json

Safe to re-run: existing valid PDFs (%PDF-) are skipped automatically.
"""

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

BASE = "https://budgetoffice.gov.ng"
INDEX_URL = (
    "https://budgetoffice.gov.ng/index.php/resources/internal-resources/"
    "reports/quarterly-budget-implementation"
)
POLICY_URL = (
    "https://budgetoffice.gov.ng/index.php/resources/internal-resources/"
    "policy-documents"
)

YEAR_PAGE_RE = re.compile(r"/((?:1999|20\d{2}))-budget-implementation-reports?/?$", re.I)
POLICY_CAT_RE = re.compile(r"/policy-documents/([a-z0-9_-]+)/?$", re.I)


def make_session(insecure: bool = False) -> requests.Session:
    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": "CitizenWatch-BIR-Fetcher/1.0 (public budget execution data)",
            "Accept": "text/html,application/pdf,*/*",
        }
    )
    retry = Retry(
        total=5,
        backoff_factor=1.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET", "HEAD"),
    )
    s.mount("https://", HTTPAdapter(max_retries=retry))
    s.mount("http://", HTTPAdapter(max_retries=retry))
    if insecure:
        s.verify = False
        requests.packages.urllib3.disable_warnings()
    return s


def discover_year_pages(session: requests.Session, timeout: int) -> list[tuple[int, str]]:
    r = session.get(INDEX_URL, timeout=timeout)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    found: dict[int, str] = {}
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        m = YEAR_PAGE_RE.search(href)
        if m:
            yr = int(m.group(1))
            found[yr] = urljoin(BASE, href)
    return sorted(found.items(), reverse=True)


def discover_downloads_for_year(
    session: requests.Session, year: int, year_url: str, timeout: int
) -> list[dict[str, str | int]]:
    r = session.get(year_url, timeout=timeout)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    seen_urls: set[str] = set()
    docs: list[dict[str, str | int]] = []
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href.lower().rstrip("/").endswith("/download"):
            continue
        full_url = urljoin(BASE, href)
        if full_url in seen_urls:
            continue
        seen_urls.add(full_url)
        parts = [p for p in urlparse(full_url).path.split("/") if p and p != "index.php" and p != "download"]
        slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", parts[-1] if parts else f"bir-{year}").strip("-")
        title = a.get_text(" ", strip=True)
        if not title or title.lower() == "download":
            title = slug.replace("-", " ").title()
        docs.append(
            {
                "financialYear": year,
                "title": title,
                "slug": slug,
                "downloadUrl": full_url,
                "sourcePage": year_url,
            }
        )
    return docs


def is_valid_pdf(path: Path) -> bool:
    if not path.is_file() or path.stat().st_size < 1024:
        return False
    with open(path, "rb") as f:
        return f.read(5) == b"%PDF-"


def download_pdf(session: requests.Session, url: str, dest: Path, timeout: int) -> tuple[bool, str]:
    if is_valid_pdf(dest):
        return True, "skipped (already exists)"
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".pdf.part")
    try:
        with session.get(url, stream=True, timeout=timeout) as r:
            r.raise_for_status()
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(chunk_size=65536):
                    if chunk:
                        f.write(chunk)
        if not is_valid_pdf(tmp):
            tmp.unlink(missing_ok=True)
            return False, "not a valid %PDF- file"
        tmp.replace(dest)
        return True, f"downloaded ({dest.stat().st_size:,} bytes)"
    except Exception as exc:
        tmp.unlink(missing_ok=True)
        return False, str(exc)


def discover_policy_categories(session: requests.Session, timeout: int) -> list[tuple[str, str]]:
    r = session.get(POLICY_URL, timeout=timeout)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    found: dict[str, str] = {}
    for a in soup.find_all("a", href=True):
        href = a["href"].split("?")[0].strip()
        m = POLICY_CAT_RE.search(href)
        if m:
            cat = m.group(1).lower()
            found[cat] = urljoin(BASE, href)
    return sorted(found.items())


def main() -> None:
    ap = argparse.ArgumentParser(description="Download Budget Office Quarterly BIR or Policy PDFs.")
    ap.add_argument("--source", choices=("bir", "policy"), default="policy", help="Which Budget Office archive to scrape (default: policy)")
    ap.add_argument("--out", default=None, help="Output directory (defaults to bir_pdfs or policy_pdfs)")
    ap.add_argument("--year", type=int, help="Only fetch a single fiscal year (bir mode)")
    ap.add_argument("--delay", type=float, default=0.5, help="Pause between requests in seconds")
    ap.add_argument("--timeout", type=int, default=90)
    ap.add_argument("--list-only", action="store_true", help="Discover and write manifest.json without downloading")
    ap.add_argument("--insecure", action="store_true", help="Disable TLS verification if needed")
    args = ap.parse_args()

    out = Path(args.out or ("policy_pdfs" if args.source == "policy" else "bir_pdfs"))
    out.mkdir(parents=True, exist_ok=True)
    session = make_session(insecure=args.insecure)

    manifest_docs: list[dict[str, str | int]] = []
    if args.source == "policy":
        print(f"Discovering Policy Document categories from {POLICY_URL} ...")
        cats = discover_policy_categories(session, args.timeout)
        print(f"Found {len(cats)} category page(s): {[c for c, _ in cats]}")
        for cat, curl in cats:
            docs = discover_downloads_for_year(session, 0, curl, args.timeout)
            print(f"  Category [{cat.upper()}]: {len(docs)} document(s)")
            for doc in docs:
                doc["category"] = cat
                dest = out / cat / f"{doc['slug']}.pdf"
                doc["localPath"] = str(dest)
                if not args.list_only:
                    ok, status = download_pdf(session, str(doc["downloadUrl"]), dest, args.timeout)
                    doc["status"] = "ok" if ok else f"error: {status}"
                    print(f"    -> {dest.name}: {status}")
                    if args.delay:
                        time.sleep(args.delay)
                else:
                    doc["status"] = "listed"
                manifest_docs.append(doc)
            if args.delay:
                time.sleep(args.delay)
        source_url = POLICY_URL
    else:
        print(f"Discovering BIR year pages from {INDEX_URL} ...")
        year_pages = discover_year_pages(session, args.timeout)
        if args.year:
            year_pages = [(y, u) for y, u in year_pages if y == args.year]
        print(f"Found {len(year_pages)} year page(s): {[y for y, _ in year_pages]}")

        for yr, yurl in year_pages:
            docs = discover_downloads_for_year(session, yr, yurl, args.timeout)
            print(f"  FY {yr}: {len(docs)} document(s)")
            for doc in docs:
                dest = out / str(yr) / f"{doc['slug']}.pdf"
                doc["localPath"] = str(dest)
                if not args.list_only:
                    ok, status = download_pdf(session, str(doc["downloadUrl"]), dest, args.timeout)
                    doc["status"] = "ok" if ok else f"error: {status}"
                    print(f"    -> {dest.name}: {status}")
                    if args.delay:
                        time.sleep(args.delay)
                else:
                    doc["status"] = "listed"
                manifest_docs.append(doc)
            if args.delay:
                time.sleep(args.delay)
        source_url = INDEX_URL

    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": source_url,
        "totalDocuments": len(manifest_docs),
        "documents": manifest_docs,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"\nDone. Manifest saved to {out / 'manifest.json'} ({len(manifest_docs)} documents).")


if __name__ == "__main__":
    main()
