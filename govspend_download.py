#!/usr/bin/env python3
"""
Govspend.ng full download (for CitizenWatch)

Pages through the same public JSON API the Explore page uses:
    https://app.govspend.ng/api/payments/advanced_search/?count=<n>&page=<k>

The "50,000 records" limit only applies to the Export button, not to this listing API,
so no date splitting is needed. The script:
  * finds the biggest page size the API will give (so ~468k rows take far fewer requests)
  * downloads pages in order with a few polite parallel workers
  * saves progress after every batch, so you can stop (Ctrl+C) and resume by re-running
  * writes govspend_all.csv and govspend_all.jsonl (de-duplicated) when finished

Install:  pip install requests
Run:      python govspend_download.py
          python govspend_download.py --expected 467930
          python govspend_download.py --param year=2024          # filtered download
          python govspend_download.py --param start_date=2024-01-01 --param end_date=2024-03-31
"""

import argparse
import csv
import hashlib
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

API = "https://app.govspend.ng/api/payments/advanced_search/"
PROBE_SIZES = [5000, 2000, 1000, 500, 200, 100, 50, 10]  # tried largest first


def make_session():
    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": "CitizenWatch-Govspend-Fetcher/1.0 (public spending data; contact: you@example.com)",
            "Accept": "application/json",
        }
    )
    retry = Retry(
        total=6,
        backoff_factor=2,  # 2s, 4s, 8s ...
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET",),
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_maxsize=8)
    s.mount("https://", adapter)
    return s


def get_page(session, params, count, page, timeout):
    q = {**params, "count": count, "page": page}
    r = session.get(API, params=q, timeout=timeout)
    r.raise_for_status()
    return r.json()


def pick_page_size(session, params, timeout):
    """Largest page size the API actually honours. Returns (count, last_page, first_page_json)."""
    for size in PROBE_SIZES:
        try:
            data = get_page(session, params, size, 1, timeout)
        except (requests.RequestException, ValueError) as e:
            print(f"  count={size}: not accepted ({str(e)[:80]})")
            continue
        got = len(data.get("results", []))
        print(f"  count={size}: returned {got} rows, last page = {data.get('last')}")
        # accept if the API gave a full page, or the whole dataset fits in one page
        if got == size or (data.get("last") == 1 and got > 0):
            return size, int(data.get("last") or 1), data
    raise SystemExit("Could not get a usable response from the API.")


def fetch_batch(session, params, count, pages, timeout, delay):
    def one(p):
        time.sleep(delay)
        return p, get_page(session, params, count, p, timeout)

    with ThreadPoolExecutor(max_workers=len(pages)) as ex:
        return list(ex.map(one, pages))  # keeps page order


def crawl(args, params, out: Path):
    out.mkdir(parents=True, exist_ok=True)
    jsonl = out / "pages.jsonl"
    state_file = out / "progress.json"
    session = make_session()

    state = None
    if state_file.exists():
        state = json.loads(state_file.read_text())
        if state.get("params") != params:
            print("Existing progress was for different filters; starting fresh.")
            state = None
            jsonl.unlink(missing_ok=True)

    if state:
        count, last, next_page = state["count"], state["last"], state["next_page"]
        print(f"Resuming: page size {count}, continuing at page {next_page} of {last}")
        first = None
    else:
        print("Probing page size...")
        count, last, first = pick_page_size(session, params, args.timeout)
        next_page = 1
        jsonl.unlink(missing_ok=True)

    print(f"Plan: {last:,} pages x {count} rows  (~{last * count:,} rows max)")

    workers = max(1, args.workers)
    with open(jsonl, "a", encoding="utf-8") as fout:
        p = next_page
        while p <= last:
            pages = list(range(p, min(p + workers, last + 1)))
            try:
                if first is not None and pages[0] == 1:
                    got = [(1, first)] + (
                        fetch_batch(session, params, count, pages[1:], args.timeout, args.delay) if pages[1:] else []
                    )
                else:
                    got = fetch_batch(session, params, count, pages, args.timeout, args.delay)
            except (requests.RequestException, ValueError) as e:
                print(f"\nStopped at page {p}: {e}\nRe-run the same command to resume.", file=sys.stderr)
                return count, last, False

            for page_no, data in got:
                for rec in data.get("results", []):
                    fout.write(json.dumps(rec, ensure_ascii=False) + "\n")
            fout.flush()

            p = pages[-1] + 1
            state_file.write_text(json.dumps({"params": params, "count": count, "last": last, "next_page": p}))
            print(f"\r  page {p - 1:,}/{last:,}  ({(p - 1) / last:.1%})", end="", flush=True)
            if args.delay:
                time.sleep(args.delay)
    print()
    return count, last, True


def export(out: Path):
    """pages.jsonl -> de-duplicated CSV + JSONL."""
    src = out / "pages.jsonl"
    seen, total, dupes, fields = set(), 0, 0, None
    with open(src, encoding="utf-8") as fin, \
         open(out / "govspend_all.jsonl", "w", encoding="utf-8") as fj, \
         open(out / "govspend_all.csv", "w", newline="", encoding="utf-8") as fc:
        writer = None
        for line in fin:
            rec = json.loads(line)
            # pagination can shift while new payments are added, so drop exact repeats
            key = hashlib.md5(json.dumps(rec, sort_keys=True).encode()).digest()
            if key in seen:
                dupes += 1
                continue
            seen.add(key)
            if writer is None:
                fields = list(rec.keys())
                writer = csv.DictWriter(fc, fieldnames=fields, extrasaction="ignore")
                writer.writeheader()
            writer.writerow(rec)
            fj.write(line)
            total += 1
    return total, dupes


def main():
    ap = argparse.ArgumentParser(description="Download all Govspend payments via the public API.")
    ap.add_argument("--out", default="govspend_data")
    ap.add_argument("--workers", type=int, default=3, help="parallel requests per batch (keep small, default 3)")
    ap.add_argument("--delay", type=float, default=0.5, help="seconds pause per request")
    ap.add_argument("--timeout", type=int, default=90)
    ap.add_argument("--expected", type=int, help="total shown on the site, for a sanity check")
    ap.add_argument("--param", action="append", default=[], metavar="KEY=VALUE",
                    help="extra API filter, e.g. year=2024, start_date=2024-01-01, keyword=road (repeatable)")
    args = ap.parse_args()

    params = {}
    for kv in args.param:
        if "=" not in kv:
            sys.exit(f"--param must look like KEY=VALUE, got: {kv}")
        k, v = kv.split("=", 1)
        params[k] = v

    out = Path(args.out)
    count, last, finished = crawl(args, params, out)
    if not finished:
        sys.exit(1)

    total, dupes = export(out)
    raw = total + dupes

    # Ask the API how many records exist right now: full pages + rows on the last page.
    api_total = None
    try:
        tail = get_page(make_session(), params, count, last, args.timeout)
        api_total = (last - 1) * count + len(tail.get("results", []))
    except (requests.RequestException, ValueError):
        pass

    print("\n==== SUMMARY ====")
    print(f"  Rows downloaded:        {raw:,}")
    print(f"  Duplicates dropped:     {dupes:,}")
    print(f"  Unique rows saved:      {total:,}")
    if api_total is not None:
        diff = api_total - total
        print(f"  Records on server now:  {api_total:,}  (from the API's own page count)")
        print(f"  Difference:             {diff:+,}  " +
              ("-> COMPLETE" if diff == 0 else "-> data shifted or pages missing; see note below"))
    if args.expected:
        diff = args.expected - total
        print(f"  Expected (your figure): {args.expected:,}  (difference {diff:+,})")
    print(f"\nFiles in {out.resolve()}:")
    print(f"  govspend_all.csv / govspend_all.jsonl   <- the data")
    print(f"  pages.jsonl, progress.json              <- working files (safe to delete once you're done)")
    if api_total is not None and api_total != total:
        print("\nNote: new payments are added at the top of the list while you download, so a small"
              "\ndifference is normal. Re-run with a fresh --out and compare if it is large.")


if __name__ == "__main__":
    main()