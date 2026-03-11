"""
Crawl Playboard.co to collect historical YouTube subscriber data for K-POP channels.

Playboard is a Nuxt.js SSR app that embeds data in window.__NUXT__ as a JS IIFE.
This script extracts daily subscriber counts (~90 days) and weekly ranking data (~10 months).

Usage:
    python crawl_playboard.py                # crawl all channels
    python crawl_playboard.py --test 3       # crawl first 3 channels only
    python crawl_playboard.py --skip-existing # skip channels already in CSV
"""
import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR = r'G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app'
CHANNELS_JSON = os.path.join(BASE_DIR, 'data', 'youtube-channels.json')
OUTPUT_DAILY_CSV = os.path.join(BASE_DIR, 'data', 'timeseries', 'youtube', 'playboard_subscribers.csv')
OUTPUT_RANKINGS_CSV = os.path.join(BASE_DIR, 'data', 'timeseries', 'youtube', 'playboard_rankings.csv')

PLAYBOARD_URL = 'https://playboard.co/en/channel/{channel_id}/subscribers'

USER_AGENT = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
    'AppleWebKit/537.36 (KHTML, like Gecko) '
    'Chrome/131.0.0.0 Safari/537.36'
)

REQUEST_DELAY_MIN = 15.0
REQUEST_DELAY_MAX = 25.0

# ---------------------------------------------------------------------------
# HTTP fetch
# ---------------------------------------------------------------------------
def fetch_page(url):
    """Fetch a URL and return decoded text. Returns None on error."""
    req = urllib.request.Request(url, headers={
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            # Try UTF-8 first, fall back to latin-1
            try:
                return raw.decode('utf-8')
            except UnicodeDecodeError:
                return raw.decode('latin-1')
    except urllib.error.HTTPError as e:
        print(f'  HTTP {e.code}: {e.reason}')
        if e.code == 429:
            print('  Rate limited! Waiting 30s before retry...')
            time.sleep(30)
            try:
                with urllib.request.urlopen(req, timeout=20) as resp:
                    raw = resp.read()
                    return raw.decode('utf-8')
            except Exception:
                pass
        return None
    except urllib.error.URLError as e:
        print(f'  URL Error: {e.reason}')
        return None
    except Exception as e:
        print(f'  Fetch error: {e}')
        return None


# ---------------------------------------------------------------------------
# NUXT data extraction
# ---------------------------------------------------------------------------
def extract_nuxt_script(html):
    """Extract the raw window.__NUXT__ script content from HTML."""
    # Look for the script containing window.__NUXT__
    pattern = r'window\.__NUXT__\s*=\s*(.+?);\s*</script>'
    m = re.search(pattern, html, re.DOTALL)
    if m:
        return m.group(1)
    return None


def extract_numeric_arrays(text, min_length=2):
    """
    Extract arrays of numbers from JS text.
    Finds patterns like [number, number, ...] including nested arrays.
    Returns a list of arrays (each is a list of numbers).
    """
    results = []
    # Match arrays that contain only numbers, commas, spaces, and nested brackets
    # This pattern finds inner arrays like [1234567890,12345,100,""]
    arr_pattern = r'\[(\d{9,10})\s*,\s*(\d+)\s*,\s*(-?\d+)(?:\s*,\s*(?:"[^"]*"|null|""))?\]'
    for m in re.finditer(arr_pattern, text):
        try:
            row = [int(m.group(1)), int(m.group(2)), int(m.group(3))]
            results.append(row)
        except (ValueError, IndexError):
            continue
    return results


def extract_ranking_arrays(text):
    """
    Extract ranking arrays: [timestamp, rank, subscribers]
    Rankings have 3 numeric elements where first is a unix timestamp.
    """
    results = []
    # Pattern for ranking entries: [timestamp, rank, subscriber_count]
    arr_pattern = r'\[(\d{9,10})\s*,\s*(\d{1,6})\s*,\s*(\d+)\]'
    for m in re.finditer(arr_pattern, text):
        try:
            ts = int(m.group(1))
            rank = int(m.group(2))
            subs = int(m.group(3))
            # Sanity checks: rank should be reasonable, subs > 0
            if 1 <= rank <= 999999 and subs > 0:
                results.append([ts, rank, subs])
        except (ValueError, IndexError):
            continue
    return results


def find_daily_subscribers(nuxt_text):
    """
    Extract daily subscriber data from NUXT text.
    Looks for the sheet.rows region containing daily subscriber arrays.
    Returns list of [unix_ts, total_subs, new_subs].
    """
    rows = []

    # Strategy 1: Look near "sheet" or "rows" keys for subscriber arrays
    # The daily data has entries like [unix_ts, total_subs, daily_change, ""]
    # where unix_ts is ~10 digits (seconds since epoch, 2020+ = 1577836800+)

    # Try to isolate the region around "rows" or "sheet"
    def is_daily_data(entry):
        """Distinguish daily subscriber data from ranking data.
        Daily: [ts, total_subs(large), delta(small)] where total >> delta
        Ranking: [ts, rank(small), subs(large)] where rank << subs
        """
        ts, val1, val2 = entry[0], entry[1], entry[2]
        if not (1577836800 <= ts <= 2000000000):
            return False
        # If val1 is much smaller than val2 (ratio > 100x), it's ranking data
        if val1 > 0 and val2 > 0 and val2 / val1 > 100:
            return False  # Ranking: [ts, rank, subs]
        # Daily data: val1 (total subs) should be > 10000
        if val1 > 10000:
            return True
        return False

    # Strategy 1: Look near "sheet" or "rows" keys for subscriber arrays
    for key_pattern in [r'rows\s*:\s*\[', r'sheet\s*:\s*\{[^}]*rows\s*:\s*\[']:
        m = re.search(key_pattern, nuxt_text)
        if m:
            start = m.start()
            chunk = nuxt_text[start:start + 50000]
            candidates = extract_numeric_arrays(chunk)
            daily = [c for c in candidates if is_daily_data(c)]
            if daily:
                return daily

    # Strategy 2: Scan the entire text
    all_arrays = extract_numeric_arrays(nuxt_text)
    daily = [arr for arr in all_arrays if is_daily_data(arr)]

    return daily


def find_rankings(nuxt_text):
    """
    Extract ranking data from NUXT text.
    Looks for goSubsRankings or loSubsRankings arrays.
    Returns dict with keys 'global' and 'local', each a list of [ts, rank, subs].
    """
    rankings = {'global': [], 'local': []}

    # Try to find near known keys
    for key, label in [('goSubsRankings', 'global'), ('loSubsRankings', 'local')]:
        m = re.search(re.escape(key) + r'\s*:\s*\[', nuxt_text)
        if m:
            start = m.start()
            chunk = nuxt_text[start:start + 20000]
            candidates = extract_ranking_arrays(chunk)
            for c in candidates:
                if 1577836800 <= c[0] <= 2000000000:
                    rankings[label].append(c)

    # If key-based search found nothing, scan the whole text
    if not rankings['global'] and not rankings['local']:
        all_rankings = extract_ranking_arrays(nuxt_text)
        # Separate by rank magnitude — rankings with small ranks are likely global
        for r in all_rankings:
            ts, rank, subs = r
            if 1577836800 <= ts <= 2000000000:
                rankings['global'].append(r)

    return rankings


def ts_to_date(ts):
    """Convert unix timestamp (seconds) to YYYY-MM-DD string."""
    try:
        return datetime.fromtimestamp(ts, tz=timezone.utc).strftime('%Y-%m-%d')
    except (OSError, ValueError, OverflowError):
        return None


# ---------------------------------------------------------------------------
# CSV I/O
# ---------------------------------------------------------------------------
def load_existing_groups(csv_path):
    """Load set of group names already present in a CSV file."""
    groups = set()
    if os.path.exists(csv_path):
        try:
            with open(csv_path, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    g = row.get('group', '').strip()
                    if g:
                        groups.add(g)
        except Exception:
            pass
    return groups


def load_existing_rows(csv_path):
    """Load all existing rows from a CSV file as list of dicts."""
    rows = []
    if os.path.exists(csv_path):
        try:
            with open(csv_path, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    rows.append(row)
        except Exception:
            pass
    return rows


def write_daily_csv(all_rows):
    """Write daily subscriber CSV. all_rows is list of dicts."""
    os.makedirs(os.path.dirname(OUTPUT_DAILY_CSV), exist_ok=True)
    # Deduplicate by (date, group)
    seen = set()
    unique = []
    for r in all_rows:
        key = (r['date'], r['group'])
        if key not in seen:
            seen.add(key)
            unique.append(r)
    unique.sort(key=lambda x: (x['date'], x['group']))

    with open(OUTPUT_DAILY_CSV, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=['date', 'group', 'subscribers', 'new_subscribers', 'source'])
        writer.writeheader()
        writer.writerows(unique)
    return len(unique)


def write_rankings_csv(all_rows):
    """Write rankings CSV. all_rows is list of dicts."""
    os.makedirs(os.path.dirname(OUTPUT_RANKINGS_CSV), exist_ok=True)
    # Deduplicate by (date, group, source)
    seen = set()
    unique = []
    for r in all_rows:
        key = (r['date'], r['group'], r.get('source', ''))
        if key not in seen:
            seen.add(key)
            unique.append(r)
    unique.sort(key=lambda x: (x['date'], x['group']))

    with open(OUTPUT_RANKINGS_CSV, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=['date', 'group', 'rank', 'subscribers', 'source'])
        writer.writeheader()
        writer.writerows(unique)
    return len(unique)


# ---------------------------------------------------------------------------
# Main crawl logic
# ---------------------------------------------------------------------------
def crawl_channel(channel_id, group_name):
    """
    Crawl Playboard subscriber page for a single channel.
    Returns (daily_rows, ranking_rows) as lists of dicts.
    """
    url = PLAYBOARD_URL.format(channel_id=channel_id)
    print(f'  Fetching: {url}')

    html = fetch_page(url)
    if html is None:
        return [], []

    # Extract NUXT script
    nuxt_text = extract_nuxt_script(html)
    if nuxt_text is None:
        print('  WARNING: Could not find window.__NUXT__ data')
        # Fallback: search entire HTML for numeric patterns
        nuxt_text = html

    # Extract daily subscriber data
    daily_data = find_daily_subscribers(nuxt_text)
    daily_rows = []
    for entry in daily_data:
        ts, total_subs, new_subs = entry[0], entry[1], entry[2]
        date_str = ts_to_date(ts)
        if date_str:
            daily_rows.append({
                'date': date_str,
                'group': group_name,
                'subscribers': total_subs,
                'new_subscribers': new_subs,
                'source': 'playboard_daily',
            })

    # Extract ranking data
    ranking_data = find_rankings(nuxt_text)
    ranking_rows = []
    for label, entries in ranking_data.items():
        source = f'playboard_{label}_rank'
        for entry in entries:
            ts, rank, subs = entry
            date_str = ts_to_date(ts)
            if date_str:
                ranking_rows.append({
                    'date': date_str,
                    'group': group_name,
                    'rank': rank,
                    'subscribers': subs,
                    'source': source,
                })

    print(f'  Found {len(daily_rows)} daily records, {len(ranking_rows)} ranking records')
    return daily_rows, ranking_rows


def main():
    parser = argparse.ArgumentParser(description='Crawl Playboard.co for YouTube subscriber data')
    parser.add_argument('--test', type=int, default=0,
                        help='Only process first N channels (for testing)')
    parser.add_argument('--skip-existing', action='store_true',
                        help='Skip channels already present in output CSV')
    args = parser.parse_args()

    # Load channel list
    if not os.path.exists(CHANNELS_JSON):
        print(f'ERROR: Channels file not found: {CHANNELS_JSON}')
        sys.exit(1)

    with open(CHANNELS_JSON, 'r', encoding='utf-8') as f:
        channels = json.load(f)

    print(f'Loaded {len(channels)} channels from {CHANNELS_JSON}')

    # Determine which channels to skip
    skip_daily = set()
    skip_rankings = set()
    if args.skip_existing:
        skip_daily = load_existing_groups(OUTPUT_DAILY_CSV)
        skip_rankings = load_existing_groups(OUTPUT_RANKINGS_CSV)
        print(f'Skip-existing: {len(skip_daily)} groups in daily CSV, {len(skip_rankings)} groups in rankings CSV')

    # Load existing data to merge with
    all_daily = load_existing_rows(OUTPUT_DAILY_CSV) if args.skip_existing else []
    all_rankings = load_existing_rows(OUTPUT_RANKINGS_CSV) if args.skip_existing else []

    # Limit channels if --test
    process_channels = channels
    if args.test > 0:
        process_channels = channels[:args.test]
        print(f'Test mode: processing first {args.test} channels')

    # Crawl each channel
    total_daily = 0
    total_rankings = 0
    success_count = 0
    skip_count = 0
    error_count = 0

    for i, ch in enumerate(process_channels, 1):
        group = ch.get('group', ch.get('name', 'unknown'))
        channel_id = ch.get('channel_id', '')
        name = ch.get('name', group)

        print(f'\n[{i}/{len(process_channels)}] {name} ({group}) - {channel_id}')

        if not channel_id:
            print('  SKIP: No channel_id')
            skip_count += 1
            continue

        # Check if we should skip this channel
        if args.skip_existing:
            if group in skip_daily and group in skip_rankings:
                print('  SKIP: Already exists in both CSVs')
                skip_count += 1
                continue

        # Crawl
        daily_rows, ranking_rows = crawl_channel(channel_id, group)

        if daily_rows or ranking_rows:
            all_daily.extend(daily_rows)
            all_rankings.extend(ranking_rows)
            total_daily += len(daily_rows)
            total_rankings += len(ranking_rows)
            success_count += 1
        else:
            print('  WARNING: No data extracted')
            error_count += 1

        # Rate limiting with jitter
        if i < len(process_channels):
            import random
            delay = random.uniform(REQUEST_DELAY_MIN, REQUEST_DELAY_MAX)
            print(f'  Waiting {delay:.1f}s...')
            time.sleep(delay)

    # Write results
    print('\n' + '=' * 60)
    print('WRITING RESULTS')
    print('=' * 60)

    if all_daily:
        n = write_daily_csv(all_daily)
        print(f'Daily CSV: {n} total rows -> {OUTPUT_DAILY_CSV}')
    else:
        print('Daily CSV: No data to write')

    if all_rankings:
        n = write_rankings_csv(all_rankings)
        print(f'Rankings CSV: {n} total rows -> {OUTPUT_RANKINGS_CSV}')
    else:
        print('Rankings CSV: No data to write')

    # Summary
    print('\n' + '=' * 60)
    print('SUMMARY')
    print('=' * 60)
    print(f'Channels processed: {success_count} success, {skip_count} skipped, {error_count} no data')
    print(f'New daily records: {total_daily}')
    print(f'New ranking records: {total_rankings}')
    print('Done.')


if __name__ == '__main__':
    main()
