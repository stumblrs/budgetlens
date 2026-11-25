#!/usr/bin/env python3
"""
DMO Nigeria PDF scraper (for CitizenWatch)

Crawls the Debt Management Office debt-profile pages, follows pagination,
downloads every PDF, and writes a manifest (JSON + CSV) your web app can ingest.

Install:   pip install requests beautifulsoup4
Run:       python dmo_scraper.py                 # download everything to ./dmo_pdfs
           python dmo_scraper.py --list-only     # just build the manifest, no downloads
           python dmo_scraper.py --out data/dmo --delay 2

All files go into ONE folder (--out), in subfolders by year of the report date:
    dmo_pdfs/2026/6075-federal-government-....pdf
    dmo_pdfs/2025/...
    dmo_pdfs/manifest.json
Files are named <doc_id>-<slug>.pdf so names never collide across categories;
the category is kept in the manifest.

Safe to re-run: files already downloaded (valid PDFs) are skipped.
"""

import argparse
import csv
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

BASE = "https://www.dmo.gov.ng"

PAGES = [
    "https://www.dmo.gov.ng/domestic-debts/debt-stock",
    "https://www.dmo.gov.ng/domestic-debts/domestic-debt-service",
    "https://www.dmo.gov.ng/external-debts",
    "https://www.dmo.gov.ng/external-debts/external-debt-stock",
    "https://www.dmo.gov.ng/external-debts/debt-service",
    "https://www.dmo.gov.ng/sub-nationals-debts",
    "https://www.dmo.gov.ng/total-public-debts",
    "https://www.dmo.gov.ng/contingent-liabilities",
]

PAGE_SIZE = 20  # the site's default `limit`; pagination uses ?limit=20&limitstart=N

# Document links look like  /<category>/.../<id>-<slug>/file
# The "Latest Publications" sidebar links have NO category prefix (/<id>-<slug>/file),
# so requiring at least one prefix segment filters those out.
DOC_PATH_RE = re.compile(r"^/(?:[^/]+/)+(\d+)-([^/]+)/file/?$")

DATE_RE = re.compile(
    r"(January|February|March|April|May|June|July|August|September|October|November|December)"
    r"\s+(\d{1,2}),?\s+(\d{4})",
    re.I,
)


def make_session(insecure: bool) -> requests.Session:
    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": "CitizenWatch-DMO-Fetcher/1.0 (public debt data; contact: you@example.com)",
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


def page_slug(url: str) -> str:
    return urlparse(url).path.strip("/").replace("/", "__") or "root"


def parse_as_at(title: str):
    m = DATE_RE.search(title)
    if not m:
        return None
    try:
        return datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}", "%B %d %Y").date().isoformat()
    except ValueError:
        return None


def parse_year(title: str, as_at):
    """Folder year: the 'as at' date if present, else the last 4-digit year in the title."""
    if as_at:
        return as_at[:4]
    years = re.findall(r"\b(?:19|20)\d{2}\b", title)
    return years[-1] if years else "unknown-year"


def extract_docs(html: str, page_url: str):
    """Return list of document dicts found in one listing page."""
    soup = BeautifulSoup(html, "html.parser")
    docs = []
    for a in soup.find_all("a", href=True):
        url = urljoin(page_url, a["href"])
        path = urlparse(url).path
        m = DOC_PATH_RE.match(path)
        if not m:
            continue
        text = a.get_text(" ", strip=True)
        title = a.get("title") or text
        # link text is prefixed with the file-type icon label, e.g. "pdf Federal Government ..."
        ftype = "pdf"
        tm = re.match(r"^(pdf|spreadsheet|document|presentation|word|excel|zip)\s+", text, re.I)
        if tm:
            ftype = tm.group(1).lower()
            if not a.get("title"):
                title = text[tm.end():]
        as_at = parse_as_at(title)
        docs.append(
            {
                "doc_id": int(m.group(1)),
                "slug": m.group(2),
                "title": title.strip(),
                "file_type_label": ftype,
                "url": url.split("?")[0],
                "as_at": as_at,
                "year": parse_year(title, as_at),
            }
        )
    return docs


def crawl_listing(session, base_url, delay, max_pages, timeout):
    """Walk every paginated page of one listing; return unique docs."""
    found, seen_ids = [], set()
    for i in range(max_pages):
        start = i * PAGE_SIZE
        url = base_url if start == 0 else f"{base_url}?limit={PAGE_SIZE}&limitstart={start}"
        try:
            r = session.get(url, timeout=timeout)
            r.raise_for_status()
        except requests.RequestException as e:
            print(f"   ! failed to load {url}: {e}", file=sys.stderr)
            break
        docs = extract_docs(r.text, url)
        new = [d for d in docs if d["doc_id"] not in seen_ids]
        if not new:  # empty page, or pager wrapped around -> done
            break
        for d in new:
            seen_ids.add(d["doc_id"])
            found.append(d)
        print(f"   page {i + 1}: {len(new)} documents")
        time.sleep(delay)
    return found


def filename_from_headers(resp, fallback):
    cd = resp.headers.get("Content-Disposition", "")
    m = re.search(r"filename\*?=(?:UTF-8'')?\"?([^\";]+)\"?", cd, re.I)
    return m.group(1).strip() if m else fallback


def is_pdf_file(path: Path) -> bool:
    try:
        with open(path, "rb") as f:
            return f.read(5) == b"%PDF-"
    except OSError:
        return False


def download(session, doc, dest_dir: Path, timeout, include_all):
    """Download one document. Returns status string and updates doc in place."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    base_name = f"{doc['doc_id']}-{doc['slug']}"

    # Skip if already downloaded
    for existing in dest_dir.glob(base_name + ".*"):
        if existing.suffix != ".part" and (existing.suffix != ".pdf" or is_pdf_file(existing)):
            doc["local_path"] = str(existing)
            doc["size_bytes"] = existing.stat().st_size
            return "skipped"

    tmp = dest_dir / (base_name + ".part")
    with session.get(doc["url"], stream=True, timeout=timeout) as r:
        r.raise_for_status()
        ctype = r.headers.get("Content-Type", "").lower()
        original_name = filename_from_headers(r, base_name)
        doc["original_filename"] = original_name
        doc["content_type"] = ctype

        with open(tmp, "wb") as f:
            for chunk in r.iter_content(65536):
                f.write(chunk)

    looks_pdf = "pdf" in ctype or is_pdf_file(tmp)
    if not looks_pdf and not include_all:
        tmp.unlink(missing_ok=True)
        return f"not-a-pdf ({ctype or 'unknown'})"

    ext = ".pdf" if looks_pdf else (Path(original_name).suffix or ".bin")
    final = dest_dir / (base_name + ext)
    tmp.replace(final)
    doc["local_path"] = str(final)
    doc["size_bytes"] = final.stat().st_size
    return "downloaded"


def main():
    ap = argparse.ArgumentParser(description="Download all PDFs from DMO Nigeria debt pages.")
    ap.add_argument("--out", default="dmo_pdfs", help="output directory (default: dmo_pdfs)")
    ap.add_argument("--delay", type=float, default=1.0, help="seconds between requests (default 1.0)")
    ap.add_argument("--timeout", type=int, default=60, help="request timeout in seconds")
    ap.add_argument("--max-pages", type=int, default=50, help="safety cap on pages per listing")
    ap.add_argument("--list-only", action="store_true", help="build manifest only, don't download")
    ap.add_argument("--include-all", action="store_true", help="also keep non-PDF files (e.g. xlsx)")
    ap.add_argument("--insecure", action="store_true", help="skip TLS verification (only if cert errors)")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    session = make_session(args.insecure)

    # 1) Collect document links from every listing, de-duplicating by DMO doc id.
    registry = {}  # doc_id -> doc
    for page in PAGES:
        print(f"\n[{page}]")
        for d in crawl_listing(session, page, args.delay, args.max_pages, args.timeout):
            entry = registry.setdefault(d["doc_id"], {**d, "source_pages": [], "category": page_slug(page)})
            if page not in entry["source_pages"]:
                entry["source_pages"].append(page)

    docs = sorted(registry.values(), key=lambda d: (d["year"], d["category"], -d["doc_id"]))
    print(f"\nFound {len(docs)} unique documents across {len(PAGES)} pages.")

    # 2) Download.
    if not args.list_only:
        stats = {}
        for n, d in enumerate(docs, 1):
            try:
                status = download(session, d, out / d["year"], args.timeout, args.include_all)
            except requests.RequestException as e:
                status = f"error ({e})"
            d["status"] = status
            key = status.split(" ")[0]
            stats[key] = stats.get(key, 0) + 1
            print(f"[{n}/{len(docs)}] {status:<12} {d['title'][:80]}")
            if status == "downloaded":
                time.sleep(args.delay)
        print("\nSummary:", ", ".join(f"{k}={v}" for k, v in stats.items()))

    # 3) Manifest for the web app.
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    manifest = {"source": BASE, "fetched_at": fetched_at, "count": len(docs), "documents": docs}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    fields = ["doc_id", "year", "category", "title", "as_at", "url", "local_path", "size_bytes", "status", "source_pages"]
    with open(out / "manifest.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for d in docs:
            row = dict(d)
            row["source_pages"] = " | ".join(d["source_pages"])
            w.writerow(row)

    print(f"Manifest written to {out / 'manifest.json'} and {out / 'manifest.csv'}")


if __name__ == "__main__":
    main()