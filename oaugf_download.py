#!/usr/bin/env python3
"""
OAuGF (Office of the Auditor-General for the Federation) report downloader for CitizenWatch

The Reports page (https://oaugf.ng/26/publications/reports) builds its grid in the browser
from one JSON file that lists every document:

    https://oaugf.ng/26/media/com_jamegafilter/en_gb/2.json

Each entry has a title, category ("Annual Audit Report", "Performance Audit", ...),
year tags and a download link like /docman/10-annual-report-2017/file.
This script reads that JSON, downloads every PDF, and writes a manifest.

Install:  pip install requests
Run:      python oaugf_download.py
          python oaugf_download.py --list-only      # manifest only, no downloads
          python oaugf_download.py --out data/oaugf --delay 2

Output (one folder, subfolders by category):
    oaugf_pdfs/Annual Audit Report/10-annual-report-2017.pdf
    oaugf_pdfs/Performance Audit/...
    oaugf_pdfs/manifest.json, manifest.csv
"""

import argparse
import csv
import hashlib
import html
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

DEFAULT_BASE = "https://oaugf.ng/26"
LISTING_PATH = "/media/com_jamegafilter/en_gb/2.json"

# PDFs linked on the site that are NOT part of the Reports listing JSON.
EXTRA_PDFS = [
    {
        "title": "Office of the Auditor-General: History and Introduction (book)",
        "category": "About OAuGF",
        "url": "https://oaugf.ng/images/downloads/office%20of%20the%20Auditor%20General%20%20History%20and%20introduction%20book.pdf",
        "id": "extra-history",
    },
]


def make_session():
    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": "CitizenWatch-OAuGF-Fetcher/1.0 (public audit reports; contact: you@example.com)",
            "Accept": "application/json,application/pdf,*/*",
        }
    )
    retry = Retry(total=5, backoff_factor=2, status_forcelist=(429, 500, 502, 503, 504),
                  allowed_methods=("GET",), respect_retry_after_header=True)
    s.mount("https://", HTTPAdapter(max_retries=retry))
    s.mount("http://", HTTPAdapter(max_retries=retry))
    return s


def fix_text(s):
    """The JSON has some mis-encoded quotes (e.g. 'â\\x80\\x9c'); repair them and tidy entities."""
    if not isinstance(s, str):
        return s
    try:
        s = s.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    return html.unescape(s).replace("\xa0", " ").strip()


def safe_name(s: str, limit=100) -> str:
    s = re.sub(r"[^A-Za-z0-9._ -]+", "-", s).strip(" .-")
    return s[:limit].rstrip(" .-") or "untitled"


def parse_listing(data: dict, base: str):
    items = []
    for key, v in data.items():
        if not isinstance(v, dict) or "url_download" not in v:
            continue
        attr = v.get("attr") or {}
        cats = (attr.get("cat") or {}).get("frontend_value") or []
        tags = (attr.get("tag") or {}).get("frontend_value") or []
        pub = v.get("published_date")
        pub = pub[0] if isinstance(pub, list) and pub else pub
        published = (datetime.fromtimestamp(pub, timezone.utc).date().isoformat()
                     if isinstance(pub, (int, float)) and not isinstance(pub, bool) and pub else None)
        m = re.search(r"/docman/([^/]+)/file", v["url_download"])
        slug = m.group(1) if m else f"doc-{v.get('id')}"
        items.append(
            {
                "id": v.get("id"),
                "title": fix_text(attr.get("name", {}).get("frontend_value") or v.get("name")),
                "description": fix_text(v.get("desc", "")),
                "category": fix_text(cats[0]) if cats else "Uncategorised",
                "years": sorted({t for t in tags if re.fullmatch(r"(?:19|20)\d{2}", str(t))}),
                "tags": [fix_text(t) for t in tags],
                "published_date": published,
                "site_download_count": v.get("downloads"),
                "page_url": base + v.get("url", ""),
                "url": base + v["url_download"],
                "slug": slug,
            }
        )
    return sorted(items, key=lambda d: (d["id"] if isinstance(d["id"], int) else 10**9))


def is_pdf(path: Path) -> bool:
    try:
        with open(path, "rb") as f:
            return f.read(5) == b"%PDF-"
    except OSError:
        return False


def download(session, item, dest_dir: Path, timeout):
    dest_dir.mkdir(parents=True, exist_ok=True)
    slug = safe_name(item["slug"])
    if isinstance(item["id"], int) and not slug.startswith(f"{item['id']}-"):
        slug = f"{item['id']}-{slug}"  # DOCman slugs normally already begin with the id
    stem = slug
    final = dest_dir / (stem + ".pdf")
    if final.exists() and is_pdf(final):
        item.update(local_path=str(final), size_bytes=final.stat().st_size)
        return "skipped"

    tmp = dest_dir / (stem + ".part")
    sha = hashlib.sha256()
    with session.get(item["url"], stream=True, timeout=timeout) as r:
        r.raise_for_status()
        item["content_type"] = r.headers.get("Content-Type", "")
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 16):
                f.write(chunk)
                sha.update(chunk)

    if not is_pdf(tmp):
        # Keep non-PDF files under their real name rather than losing them
        ct = item["content_type"].lower()
        ext = ".docx" if "word" in ct else ".html" if "html" in ct else ".bin"
        other = dest_dir / (stem + ext)
        tmp.replace(other)
        item.update(local_path=str(other), size_bytes=other.stat().st_size)
        return f"not-a-pdf ({item['content_type'] or 'unknown'})"

    tmp.replace(final)
    item.update(local_path=str(final), size_bytes=final.stat().st_size, sha256=sha.hexdigest())
    return "downloaded"


def main():
    ap = argparse.ArgumentParser(description="Download all OAuGF reports listed on the Reports page.")
    ap.add_argument("--out", default="oaugf_pdfs")
    ap.add_argument("--base", default=DEFAULT_BASE, help="site base URL (default %(default)s)")
    ap.add_argument("--delay", type=float, default=1.5, help="seconds between downloads")
    ap.add_argument("--timeout", type=int, default=180)
    ap.add_argument("--list-only", action="store_true", help="write the manifest only")
    ap.add_argument("--no-extras", action="store_true", help="skip PDFs linked elsewhere on the site")
    ap.add_argument("--expected", type=int, help="number of documents you expect")
    args = ap.parse_args()

    base = args.base.rstrip("/")
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    session = make_session()

    # 1) Read the listing the page itself uses.
    print(f"Reading listing: {base + LISTING_PATH}")
    try:
        r = session.get(base + LISTING_PATH, timeout=60)
        r.raise_for_status()
        data = r.json()
    except (requests.RequestException, ValueError) as e:
        sys.exit(f"Could not read the listing JSON: {e}")

    items = parse_listing(data, base)
    if not items:
        sys.exit("Listing JSON had no documents. The site layout may have changed; see the docstring.")
    print(f"Found {len(items)} documents in the listing.")

    ids = [i["id"] for i in items if isinstance(i["id"], int)]
    gaps = sorted(set(range(min(ids), max(ids) + 1)) - set(ids)) if ids else []
    if gaps:
        print(f"Note: document IDs not in the listing (unpublished or removed?): {gaps}")

    if not args.no_extras:
        for e in EXTRA_PDFS:
            items.append({**e, "description": "", "years": [], "tags": [], "published_date": None,
                          "site_download_count": None, "page_url": "", "slug": e["id"]})

    # 2) Download.
    stats = {}
    if not args.list_only:
        for n, it in enumerate(items, 1):
            try:
                status = download(session, it, out / safe_name(it["category"]), args.timeout)
            except requests.RequestException as e:
                status = f"error ({str(e)[:80]})"
            it["status"] = status
            stats[status.split(" ")[0]] = stats.get(status.split(" ")[0], 0) + 1
            print(f"[{n}/{len(items)}] {status:<12} {it['title'][:70]}")
            if status == "downloaded":
                time.sleep(args.delay)

    # 3) Manifest.
    manifest = {"source": f"{base}/publications/reports", "listing": base + LISTING_PATH,
                "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "count": len(items), "documents": items}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    fields = ["id", "title", "category", "years", "published_date", "url", "local_path", "size_bytes", "status"]
    with open(out / "manifest.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for it in items:
            w.writerow({**it, "years": ";".join(it.get("years", []))})

    # 4) Summary.
    print("\n==== SUMMARY ====")
    print(f"  Documents in listing:   {len(items) - (0 if args.no_extras else len(EXTRA_PDFS))}")
    if not args.no_extras:
        print(f"  Extra PDFs added:       {len(EXTRA_PDFS)}")
    if not args.list_only:
        print("  Results:                " + ", ".join(f"{k}={v}" for k, v in stats.items()))
        good = stats.get("downloaded", 0) + stats.get("skipped", 0)
        print(f"  PDFs on disk:           {good} of {len(items)}")
        if good < len(items):
            print("  Some files failed - re-run the same command to retry only those.")
    if args.expected:
        listed = len(items) - (0 if args.no_extras else len(EXTRA_PDFS))
        print(f"  Expected:               {args.expected} (difference {args.expected - listed:+d})")
    print(f"\nFiles are in {out.resolve()}  (manifest.json / manifest.csv inside)")


if __name__ == "__main__":
    main()
