#!/usr/bin/env python3
"""
crawl_wayback_milestones.py
===========================
Uses the Internet Archive Wayback Machine to find historical view count
milestones for major K-POP Music Video (MV) uploads.

Workflow
--------
1. Read youtube-engagement.json → filter top MV videos by view count.
2. For each video, query the Wayback CDX API for archived YouTube watch-page
   snapshots (deduplicated to ~daily granularity).
3. Fetch each archived page and parse the view count from the HTML.
4. Write milestone rows to wayback_milestones.csv.

Usage
-----
    python crawl_wayback_milestones.py                  # all MVs above 100M views
    python crawl_wayback_milestones.py --min-views 50000000   # above 50M
    python crawl_wayback_milestones.py --test 3               # first 3 videos only
    python crawl_wayback_milestones.py --resume               # skip already-collected video_ids
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR = r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app"
ENGAGEMENT_JSON = os.path.join(BASE_DIR, "data", "youtube-engagement.json")
OUTPUT_DIR = os.path.join(BASE_DIR, "data", "timeseries", "youtube")
OUTPUT_CSV = os.path.join(OUTPUT_DIR, "wayback_milestones.csv")

# ---------------------------------------------------------------------------
# Rate-limit settings (seconds)
# ---------------------------------------------------------------------------
CDX_DELAY = 1.0        # between CDX API calls
FETCH_DELAY = 2.0      # between archived-page fetches
REQUEST_TIMEOUT = 30    # per HTTP request

# ---------------------------------------------------------------------------
# View-count regex patterns (ordered by reliability)
# ---------------------------------------------------------------------------
VIEW_PATTERNS: list[re.Pattern] = [
    # <meta itemprop="interactionCount" content="12345">
    re.compile(r'<meta\s+itemprop=["\']interactionCount["\']\s+content=["\'](\d+)["\']', re.I),
    # "viewCount":"12345" in JSON-LD / ytInitialData / ytInitialPlayerResponse
    re.compile(r'"viewCount"\s*:\s*"(\d+)"'),
    # "view_count":"12345"
    re.compile(r'"view_count"\s*:\s*"?(\d+)"?'),
    # English: "1,234,567 views"
    re.compile(r'([\d,]+)\s+views'),
    # Korean: "조회수 1,234,567회" or "조회수 12345회"
    re.compile(r'조회수\s+([\d,]+)\s*회'),
]

CSV_COLUMNS = [
    "video_id", "group", "title", "published", "snapshot_date", "views",
    "days_since_release",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _setup_encoding() -> None:
    """Ensure stdout handles UTF-8 on Windows."""
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]


def _http_get(url: str, *, timeout: int = REQUEST_TIMEOUT) -> bytes | None:
    """Simple GET with user-agent. Returns body bytes or None on error."""
    req = urllib.request.Request(url, headers={
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "en-US,en;q=0.9",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as exc:
        print(f"    [WARN] HTTP error for {url[:120]}... : {exc}")
        return None


def load_top_mvs(json_path: str, min_views: int, limit: int) -> list[dict]:
    """
    Load youtube-engagement.json and return the top MV videos sorted by
    descending views, filtered by *min_views* and capped at *limit*.
    """
    with open(json_path, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    mvs: list[dict] = []
    for group in data.get("groups", []):
        group_name = group.get("group", group.get("name", "Unknown"))
        for v in group.get("videos", []):
            vtype = v.get("video_type", "")
            views = v.get("views", 0)
            if vtype == "MV" and views >= min_views:
                mvs.append({
                    "video_id": v["video_id"],
                    "group": group_name,
                    "title": v.get("title", ""),
                    "published": v.get("published_at", ""),
                    "views": views,
                })

    mvs.sort(key=lambda x: x["views"], reverse=True)
    return mvs[:limit]


# ---------------------------------------------------------------------------
# Wayback CDX
# ---------------------------------------------------------------------------

def fetch_cdx_snapshots(video_id: str) -> list[tuple[str, str]]:
    """
    Query the Wayback CDX API for archived snapshots of a YouTube watch page.
    Returns a list of (timestamp, original_url) pairs, deduplicated to ~daily.
    """
    cdx_url = (
        "https://web.archive.org/cdx/search/cdx"
        f"?url=youtube.com/watch?v={video_id}"
        "&output=json&fl=timestamp,statuscode,original"
        "&filter=statuscode:200"
        "&collapse=timestamp:8"
    )
    raw = _http_get(cdx_url)
    if raw is None:
        return []

    try:
        rows = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        print(f"    [WARN] CDX response not valid JSON for {video_id}")
        return []

    if not rows or len(rows) < 2:
        return []

    # First row is the header: ["timestamp","statuscode","original"]
    results: list[tuple[str, str]] = []
    for row in rows[1:]:
        if len(row) >= 3:
            ts, _status, orig = row[0], row[1], row[2]
            results.append((ts, orig))

    return results


# ---------------------------------------------------------------------------
# Parse view count from archived page
# ---------------------------------------------------------------------------

def parse_view_count(html: str) -> int | None:
    """
    Try several regex patterns to extract the numeric view count.
    Returns the first successful match as an int, or None.
    """
    for pat in VIEW_PATTERNS:
        m = pat.search(html)
        if m:
            raw = m.group(1).replace(",", "")
            try:
                count = int(raw)
                if count > 0:
                    return count
            except ValueError:
                continue
    return None


def fetch_and_parse(timestamp: str, original_url: str) -> int | None:
    """
    Fetch the Wayback archived page and extract the view count.
    """
    wb_url = f"https://web.archive.org/web/{timestamp}/{original_url}"
    body = _http_get(wb_url)
    if body is None:
        return None

    # Try UTF-8 first, fall back to latin-1 (never fails)
    try:
        html = body.decode("utf-8", errors="replace")
    except Exception:
        html = body.decode("latin-1", errors="replace")

    return parse_view_count(html)


# ---------------------------------------------------------------------------
# Date helpers
# ---------------------------------------------------------------------------

def ts_to_date(timestamp: str) -> str:
    """Convert Wayback timestamp (YYYYMMDDhhmmss) to YYYY-MM-DD."""
    return f"{timestamp[:4]}-{timestamp[4:6]}-{timestamp[6:8]}"


def days_between(published_iso: str, snapshot_date: str) -> int | None:
    """
    Calculate days between the published date and the snapshot date.
    Returns None if either date cannot be parsed.
    """
    try:
        # published_at might be full ISO or just date
        pub_str = published_iso[:10]  # YYYY-MM-DD
        pub = datetime.strptime(pub_str, "%Y-%m-%d")
        snap = datetime.strptime(snapshot_date, "%Y-%m-%d")
        delta = (snap - pub).days
        return max(delta, 0)
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Resume support
# ---------------------------------------------------------------------------

def load_existing_video_ids(csv_path: str) -> set[str]:
    """Return set of video_ids already present in the output CSV."""
    ids: set[str] = set()
    if not os.path.isfile(csv_path):
        return ids
    try:
        with open(csv_path, "r", encoding="utf-8") as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                vid = row.get("video_id", "").strip()
                if vid:
                    ids.add(vid)
    except Exception:
        pass
    return ids


# ---------------------------------------------------------------------------
# Main crawl
# ---------------------------------------------------------------------------

def crawl_video(video: dict) -> list[dict]:
    """
    Crawl Wayback snapshots for a single video.
    Returns a list of row dicts (one per snapshot with a valid view count).
    """
    vid = video["video_id"]
    print(f"\n  Querying CDX for {vid} ({video['title'][:60]})")

    snapshots = fetch_cdx_snapshots(vid)
    print(f"    Found {len(snapshots)} snapshot(s)")

    if not snapshots:
        return []

    rows: list[dict] = []
    for idx, (ts, orig_url) in enumerate(snapshots):
        snap_date = ts_to_date(ts)
        views = fetch_and_parse(ts, orig_url)

        if views is not None:
            days = days_between(video["published"], snap_date)
            rows.append({
                "video_id": vid,
                "group": video["group"],
                "title": video["title"],
                "published": video["published"][:10],
                "snapshot_date": snap_date,
                "views": views,
                "days_since_release": days if days is not None else "",
            })
            print(f"    [{idx+1}/{len(snapshots)}] {snap_date} -> {views:>15,} views")
        else:
            print(f"    [{idx+1}/{len(snapshots)}] {snap_date} -> (no view count found)")

        # Rate-limit between page fetches (skip after last)
        if idx < len(snapshots) - 1:
            time.sleep(FETCH_DELAY)

    return rows


def main() -> None:
    _setup_encoding()

    parser = argparse.ArgumentParser(
        description="Crawl Wayback Machine for K-POP MV view-count milestones."
    )
    parser.add_argument(
        "--test", type=int, default=0, metavar="N",
        help="Only process the first N videos (for testing).",
    )
    parser.add_argument(
        "--min-views", type=int, default=100_000_000, metavar="N",
        help="Minimum current view count to include an MV (default: 100,000,000).",
    )
    parser.add_argument(
        "--limit", type=int, default=50, metavar="N",
        help="Maximum number of MV videos to process (default: 50).",
    )
    parser.add_argument(
        "--resume", action="store_true",
        help="Skip videos already present in the output CSV.",
    )
    args = parser.parse_args()

    # ------------------------------------------------------------------
    # 1. Load top MVs
    # ------------------------------------------------------------------
    if not os.path.isfile(ENGAGEMENT_JSON):
        print(f"[ERROR] Engagement JSON not found: {ENGAGEMENT_JSON}")
        sys.exit(1)

    mvs = load_top_mvs(ENGAGEMENT_JSON, min_views=args.min_views, limit=args.limit)
    print(f"Loaded {len(mvs)} MV(s) with >= {args.min_views:,} views")

    if not mvs:
        print("[INFO] No videos match the criteria. Try lowering --min-views.")
        sys.exit(0)

    # Apply --test limit
    if args.test > 0:
        mvs = mvs[: args.test]
        print(f"  (--test mode: processing first {len(mvs)} video(s))")

    # Apply --resume filter
    if args.resume:
        existing = load_existing_video_ids(OUTPUT_CSV)
        before = len(mvs)
        mvs = [v for v in mvs if v["video_id"] not in existing]
        skipped = before - len(mvs)
        if skipped:
            print(f"  (--resume: skipping {skipped} already-collected video(s))")

    if not mvs:
        print("[INFO] All videos already collected. Nothing to do.")
        sys.exit(0)

    # Print video list
    print("\nVideos to crawl:")
    for i, v in enumerate(mvs, 1):
        print(f"  {i:3d}. [{v['group']}] {v['title'][:60]}  ({v['views']:,} views)")

    # ------------------------------------------------------------------
    # 2. Ensure output directory exists
    # ------------------------------------------------------------------
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Determine if we need to write the CSV header
    write_header = not os.path.isfile(OUTPUT_CSV)

    # ------------------------------------------------------------------
    # 3. Crawl each video
    # ------------------------------------------------------------------
    total_rows = 0
    total_snapshots = 0
    errors = 0

    with open(OUTPUT_CSV, "a", newline="", encoding="utf-8") as csvf:
        writer = csv.DictWriter(csvf, fieldnames=CSV_COLUMNS)
        if write_header:
            writer.writeheader()

        for vi, video in enumerate(mvs, 1):
            print(f"\n{'='*70}")
            print(f"[{vi}/{len(mvs)}] {video['group']} - {video['title'][:60]}")
            print(f"  video_id={video['video_id']}  current_views={video['views']:,}")

            try:
                rows = crawl_video(video)
                for row in rows:
                    writer.writerow(row)
                csvf.flush()

                total_rows += len(rows)
                print(f"  => Collected {len(rows)} data point(s)")
            except Exception as exc:
                errors += 1
                print(f"  [ERROR] {exc}")

            # Rate-limit between CDX calls (skip after last)
            if vi < len(mvs):
                time.sleep(CDX_DELAY)

    # ------------------------------------------------------------------
    # 4. Summary
    # ------------------------------------------------------------------
    print(f"\n{'='*70}")
    print("SUMMARY")
    print(f"  Videos processed : {len(mvs)}")
    print(f"  Data points saved: {total_rows}")
    print(f"  Errors           : {errors}")
    print(f"  Output file      : {OUTPUT_CSV}")
    print("Done.")


if __name__ == "__main__":
    main()
