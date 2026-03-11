#!/usr/bin/env python3
"""
에스파(@aespa_official) 최근 1년 전체 트윗 크롤링 + 게시물 유형별 인게이지먼트 분석

Usage:
    C:/Python314/python.exe crawl_aespa_analysis.py [--crawl] [--analyze] [--both]

    --crawl    크롤링만 실행
    --analyze  분석만 실행 (DB에 데이터 있어야 함)
    --both     크롤링 + 분석 (기본값)
"""

import sys, os, io, re, time, json, sqlite3, random, unicodedata, argparse
from datetime import datetime, timedelta
from collections import defaultdict
from statistics import median

# UTF-8 stdout wrapper (Windows CP949 문제 방지)
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

sys.path.insert(0, 'C:/temp/mv-tweet-crawler')
from twitter_search import TwitterSearchClient
from config_mv import COOKIES_PATH, SEARCHES_PER_15MIN, REQUEST_DELAY_MIN, REQUEST_DELAY_MAX

# ─── Config ──────────────────────────────────────────────────────────────────
DB_PATH = "C:/temp/mv-tweet-crawler/aespa_tweets.db"
USERNAME = "aespa_official"
SINCE_DATE = "2025-03-08"
UNTIL_DATE = "2026-03-08"

# ─── DB Setup ────────────────────────────────────────────────────────────────
def init_db(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS aespa_tweets (
            tweet_id TEXT PRIMARY KEY,
            text TEXT,
            created_at TEXT,
            created_at_kst TEXT,
            likes INTEGER DEFAULT 0,
            retweets INTEGER DEFAULT 0,
            replies INTEGER DEFAULT 0,
            views INTEGER DEFAULT 0,
            bookmarks INTEGER DEFAULT 0,
            quotes INTEGER DEFAULT 0,
            has_video INTEGER DEFAULT 0,
            has_youtube INTEGER DEFAULT 0,
            urls TEXT DEFAULT '[]',
            media_types TEXT DEFAULT '[]',
            tweet_type TEXT DEFAULT '',
            crawled_at TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS crawl_meta (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    """)
    conn.commit()
    return conn


def _normalize_unicode(text):
    """Normalize Unicode decorative characters while preserving Korean."""
    return unicodedata.normalize('NFKC', text)


# ─── Tweet Type Classification ───────────────────────────────────────────────
TYPE_RULES = [
    # (type_name, keywords, requires_media_condition)
    ("MV", {
        "keywords": [
            r'\bmv\b', r'\bm/v\b', 'music video', '뮤직비디오',
            'official mv', 'official m/v'
        ],
        "requires": "video_or_youtube"
    }),
    ("Teaser", {
        "keywords": [
            'teaser', '티저', 'highlight medley', 'concept photo',
            'concept clip', 'mood sampler', 'track preview',
            'comeback trailer', 'logo motion'
        ]
    }),
    ("Performance", {
        "keywords": [
            'performance', 'dance practice', 'choreography', '안무',
            'relay dance', 'dance challenge', 'stage practice',
            'performance video'
        ]
    }),
    ("Behind/Making", {
        "keywords": [
            'behind', 'making', '비하인드', '메이킹', 'behind the scenes',
            'making film', 'making of', 'jacket making'
        ]
    }),
    ("Live/방송", {
        "keywords": [
            r'\blive\b', '라이브', '방송', 'vlive', 'weverse live',
            '생방송', 'aespa on', 'inkigayo', '인기가요',
            'music bank', '뮤직뱅크', 'mcountdown', 'music core',
            '음악중심', 'show champion'
        ]
    }),
    ("Schedule/Notice", {
        "keywords": [
            'schedule', '스케줄', 'notice', '공지', 'coming soon',
            'announcement', 'release info', 'tracklist', 'track list',
            'album preview', 'pre-order', '예약'
        ]
    }),
    ("Collaboration", {
        "keywords": [
            r'\bcollab\b', '컬래버', r'\bfeat\.', 'featuring',
            'collaboration', 'x @', '× '
        ]
    }),
]

def classify_tweet(tweet):
    """Classify tweet into a type based on text and media."""
    text = _normalize_unicode(tweet.get('text', '')).lower()
    has_video = tweet.get('has_video', 0)
    has_youtube = tweet.get('has_youtube', 0)

    for type_name, rules in TYPE_RULES:
        keywords = rules.get("keywords", [])
        requires = rules.get("requires", None)

        matched = False
        for kw in keywords:
            if kw.startswith(r'\b') or '\\b' in kw:
                # regex pattern
                if re.search(kw, text):
                    matched = True
                    break
            else:
                if kw in text:
                    matched = True
                    break

        if matched:
            if requires == "video_or_youtube":
                if has_video or has_youtube:
                    return type_name
                # MV keyword without video → could be teaser or notice about MV
                continue
            return type_name

    # Photo/Image: has media but short text and no other type matched
    media_types = tweet.get('media_types', '[]')
    if isinstance(media_types, str):
        try:
            media_types = json.loads(media_types)
        except:
            media_types = []
    has_photo = 'photo' in media_types if isinstance(media_types, list) else False
    text_len = len(tweet.get('text', '').strip())
    if has_photo and text_len < 200:
        return "Photo/Image"

    return "기타"


# ─── Crawling ────────────────────────────────────────────────────────────────
def _generate_windows(since, until, days=14):
    """Generate date windows for chunked crawling. Twitter search API truncates
    results on long date ranges, so we split into 2-week windows."""
    from datetime import date
    start = date.fromisoformat(since)
    end = date.fromisoformat(until)
    windows = []
    cur = start
    while cur < end:
        win_end = min(cur + timedelta(days=days), end)
        windows.append((cur.isoformat(), win_end.isoformat()))
        cur = win_end
    return windows


def crawl_all_tweets(conn):
    """Crawl all tweets from @aespa_official for the past year using windowed queries."""
    client = TwitterSearchClient(COOKIES_PATH)
    client.init()
    print(f"[INIT] TwitterSearchClient initialized")

    windows = _generate_windows(SINCE_DATE, UNTIL_DATE, days=7)
    print(f"[PLAN] {len(windows)} windows (14-day each) from {SINCE_DATE} to {UNTIL_DATE}")

    total_saved = 0
    total_dupes = 0
    total_pages = 0
    request_count = 0
    window_start_time = time.time()

    for wi, (win_since, win_until) in enumerate(windows, 1):
        query = f"from:{USERNAME} since:{win_since} until:{win_until}"
        print(f"\n[WINDOW {wi}/{len(windows)}] {win_since} ~ {win_until}")

        cursor = None
        page = 0
        win_saved = 0

        while True:
            page += 1
            total_pages += 1

            # Rate limit check
            request_count += 1
            elapsed = time.time() - window_start_time
            if elapsed >= 900:
                request_count = 1
                window_start_time = time.time()
            elif request_count >= SEARCHES_PER_15MIN:
                wait_time = 900 - elapsed + 5
                print(f"[RATE] Limit reached ({request_count} req). Waiting {wait_time:.0f}s...")
                time.sleep(wait_time)
                request_count = 1
                window_start_time = time.time()

            # Delay between requests
            if total_pages > 1:
                time.sleep(random.uniform(REQUEST_DELAY_MIN, REQUEST_DELAY_MAX))

            try:
                result = client.search(query, count=20, product='Latest', cursor=cursor)
            except Exception as e:
                err_str = str(e)
                if '429' in err_str or 'rate' in err_str.lower():
                    print(f"  [429] Rate limited. Waiting 60s...")
                    time.sleep(60)
                    request_count = max(0, request_count - 5)
                    continue
                print(f"  [ERROR] Page {page}: {e}")
                break

            tweets = result.get('tweets', [])
            next_cursor = result.get('next_cursor')

            if not tweets:
                if page == 1:
                    print(f"  (no tweets)")
                break

            saved, dupes = _save_tweets(conn, tweets)
            total_saved += saved
            total_dupes += dupes
            win_saved += saved

            print(f"  p{page}: {len(tweets)} tweets (new={saved}, dup={dupes})")

            if not next_cursor:
                break
            cursor = next_cursor

        if win_saved:
            print(f"  → window total: {win_saved} new")

    # Save crawl metadata
    now = datetime.now().isoformat()
    conn.execute("INSERT OR REPLACE INTO crawl_meta VALUES (?, ?)", ('last_crawl', now))
    conn.execute("INSERT OR REPLACE INTO crawl_meta VALUES (?, ?)", ('total_pages', str(total_pages)))
    conn.commit()

    # Final count from DB
    db_total = conn.execute("SELECT COUNT(*) FROM aespa_tweets").fetchone()[0]
    print(f"\n[SUMMARY] New: {total_saved}, Dupes: {total_dupes}, DB Total: {db_total}")
    return total_saved


def _save_tweets(conn, tweets):
    """Save tweets to DB. Returns (saved_count, dupe_count)."""
    saved = 0
    dupes = 0
    for t in tweets:
        tweet_id = t.get('id', '')
        if not tweet_id:
            continue

        # Extract media_types from raw data if available
        media_types = []
        if t.get('has_video'):
            media_types.append('video')
        if t.get('has_youtube'):
            media_types.append('youtube')
        # Check for photos in URLs
        urls = t.get('urls', [])
        if isinstance(urls, list):
            for u in urls:
                if 'pbs.twimg.com/media' in str(u):
                    if 'photo' not in media_types:
                        media_types.append('photo')

        tweet_type = classify_tweet(t)

        try:
            conn.execute("""
                INSERT INTO aespa_tweets
                (tweet_id, text, created_at, created_at_kst, likes, retweets,
                 replies, views, bookmarks, quotes, has_video, has_youtube,
                 urls, media_types, tweet_type, crawled_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                tweet_id,
                t.get('text', ''),
                t.get('created_at', ''),
                t.get('created_at_kst', ''),
                t.get('likes', 0),
                t.get('retweets', 0),
                t.get('replies', 0),
                t.get('views', 0),
                t.get('bookmarks', 0),
                t.get('quotes', 0),
                1 if t.get('has_video') else 0,
                1 if t.get('has_youtube') else 0,
                json.dumps(urls if isinstance(urls, list) else [], ensure_ascii=False),
                json.dumps(media_types, ensure_ascii=False),
                tweet_type,
                datetime.now().isoformat()
            ))
            saved += 1
        except sqlite3.IntegrityError:
            dupes += 1

    conn.commit()
    return saved, dupes


# ─── Analysis ────────────────────────────────────────────────────────────────
def analyze_tweets(conn):
    """Run full analysis on crawled tweets."""
    rows = conn.execute("""
        SELECT tweet_id, text, created_at, created_at_kst,
               likes, retweets, replies, views, bookmarks, quotes,
               has_video, has_youtube, urls, media_types, tweet_type
        FROM aespa_tweets
        ORDER BY created_at DESC
    """).fetchall()

    if not rows:
        print("[ERROR] No tweets in DB. Run with --crawl first.")
        return

    cols = ['tweet_id', 'text', 'created_at', 'created_at_kst',
            'likes', 'retweets', 'replies', 'views', 'bookmarks', 'quotes',
            'has_video', 'has_youtube', 'urls', 'media_types', 'tweet_type']
    tweets = [dict(zip(cols, r)) for r in rows]

    # Re-classify if tweet_type is empty (for previously crawled data)
    reclassified = 0
    for t in tweets:
        if not t['tweet_type']:
            t['tweet_type'] = classify_tweet(t)
            conn.execute("UPDATE aespa_tweets SET tweet_type=? WHERE tweet_id=?",
                         (t['tweet_type'], t['tweet_id']))
            reclassified += 1
    if reclassified:
        conn.commit()
        print(f"[INFO] Re-classified {reclassified} tweets")

    total = len(tweets)
    print(f"\n{'='*80}")
    print(f"  에스파(@{USERNAME}) 트윗 분석 — {SINCE_DATE} ~ {UNTIL_DATE}")
    print(f"  총 {total}개 트윗")
    print(f"{'='*80}")

    # ── 1. 유형별 통계 ──
    _print_type_stats(tweets)

    # ── 2. 유형별 인게이지먼트 비율 ──
    _print_engagement_ratios(tweets)

    # ── 3. 월별 트렌드 ──
    _print_monthly_trend(tweets)

    # ── 4. Top 10 게시물 ──
    _print_top_tweets(tweets, n=10)

    # ── 5. 유형별 샘플 출력 ──
    _print_type_samples(tweets, n=3)

    # Export to JSON
    _export_analysis_json(tweets)


def _print_type_stats(tweets):
    """유형별 게시물 수 + 인게이지먼트 통계."""
    print(f"\n{'─'*80}")
    print(f"  1. 유형별 인게이지먼트 통계")
    print(f"{'─'*80}")

    by_type = defaultdict(list)
    for t in tweets:
        by_type[t['tweet_type']].append(t)

    # Sort by count descending
    sorted_types = sorted(by_type.items(), key=lambda x: -len(x[1]))

    metrics = ['views', 'likes', 'retweets', 'replies', 'bookmarks', 'quotes']

    # Header
    print(f"\n{'유형':<16} {'건수':>5}  {'평균Views':>12} {'중앙Views':>12} {'최대Views':>12} "
          f"{'평균Likes':>10} {'평균RT':>8} {'평균Reply':>8} {'평균BM':>8}")
    print(f"{'─'*120}")

    for type_name, type_tweets in sorted_types:
        n = len(type_tweets)
        stats = {}
        for m in metrics:
            vals = [t[m] for t in type_tweets if t[m] is not None]
            if vals:
                stats[m] = {
                    'avg': sum(vals) / len(vals),
                    'med': median(vals),
                    'max': max(vals),
                    'sum': sum(vals)
                }
            else:
                stats[m] = {'avg': 0, 'med': 0, 'max': 0, 'sum': 0}

        print(f"{type_name:<16} {n:>5}  "
              f"{stats['views']['avg']:>12,.0f} {stats['views']['med']:>12,.0f} {stats['views']['max']:>12,.0f} "
              f"{stats['likes']['avg']:>10,.0f} {stats['retweets']['avg']:>8,.0f} "
              f"{stats['replies']['avg']:>8,.0f} {stats['bookmarks']['avg']:>8,.0f}")

    # Total row
    n = len(tweets)
    total_views = sum(t['views'] for t in tweets if t['views'])
    total_likes = sum(t['likes'] for t in tweets if t['likes'])
    print(f"{'─'*120}")
    print(f"{'TOTAL':<16} {n:>5}  {total_views/n:>12,.0f} {'':>12} {'':>12} "
          f"{total_likes/n:>10,.0f}")


def _print_engagement_ratios(tweets):
    """유형별 인게이지먼트 비율 분석."""
    print(f"\n{'─'*80}")
    print(f"  2. 유형별 인게이지먼트 비율 (중앙값)")
    print(f"{'─'*80}")

    by_type = defaultdict(list)
    for t in tweets:
        by_type[t['tweet_type']].append(t)

    sorted_types = sorted(by_type.items(), key=lambda x: -len(x[1]))

    print(f"\n{'유형':<16} {'RT/Likes':>10} {'BM/Likes':>10} {'Reply/Likes':>12} "
          f"{'Likes/Views':>12} {'RT/Views':>10}")
    print(f"{'─'*80}")

    for type_name, type_tweets in sorted_types:
        ratios = {'rt_likes': [], 'bm_likes': [], 'reply_likes': [],
                  'likes_views': [], 'rt_views': []}

        for t in type_tweets:
            likes = t['likes'] or 0
            rt = t['retweets'] or 0
            bm = t['bookmarks'] or 0
            rep = t['replies'] or 0
            views = t['views'] or 0

            if likes > 0:
                ratios['rt_likes'].append(rt / likes)
                ratios['bm_likes'].append(bm / likes)
                ratios['reply_likes'].append(rep / likes)
            if views > 0:
                ratios['likes_views'].append(likes / views)
                ratios['rt_views'].append(rt / views)

        def med_pct(vals):
            return f"{median(vals)*100:.1f}%" if vals else "N/A"

        print(f"{type_name:<16} {med_pct(ratios['rt_likes']):>10} "
              f"{med_pct(ratios['bm_likes']):>10} {med_pct(ratios['reply_likes']):>12} "
              f"{med_pct(ratios['likes_views']):>12} {med_pct(ratios['rt_views']):>10}")


def _print_monthly_trend(tweets):
    """월별 게시물 수 + 평균 views 트렌드."""
    print(f"\n{'─'*80}")
    print(f"  3. 월별 트렌드")
    print(f"{'─'*80}")

    by_month = defaultdict(list)
    for t in tweets:
        dt_str = t.get('created_at_kst') or t.get('created_at', '')
        if not dt_str:
            continue
        # Parse month from datetime string
        try:
            if 'T' in dt_str:
                month = dt_str[:7]  # YYYY-MM
            else:
                # Try other formats
                for fmt in ('%Y-%m-%d %H:%M:%S', '%a %b %d %H:%M:%S %z %Y'):
                    try:
                        dt = datetime.strptime(dt_str, fmt)
                        month = dt.strftime('%Y-%m')
                        break
                    except:
                        continue
                else:
                    month = dt_str[:7]
        except:
            continue
        by_month[month].append(t)

    sorted_months = sorted(by_month.keys())

    print(f"\n{'월':>8} {'게시물수':>8} {'평균Views':>12} {'평균Likes':>10} "
          f"{'평균RT':>8} {'총Views':>14}")
    print(f"{'─'*70}")

    for month in sorted_months:
        mt = by_month[month]
        n = len(mt)
        avg_views = sum(t['views'] for t in mt if t['views']) / max(n, 1)
        avg_likes = sum(t['likes'] for t in mt if t['likes']) / max(n, 1)
        avg_rt = sum(t['retweets'] for t in mt if t['retweets']) / max(n, 1)
        total_views = sum(t['views'] for t in mt if t['views'])

        print(f"{month:>8} {n:>8} {avg_views:>12,.0f} {avg_likes:>10,.0f} "
              f"{avg_rt:>8,.0f} {total_views:>14,}")


def _print_top_tweets(tweets, n=10):
    """Views 기준 Top N 트윗."""
    print(f"\n{'─'*80}")
    print(f"  4. Top {n} 게시물 (Views 기준)")
    print(f"{'─'*80}\n")

    sorted_tweets = sorted(tweets, key=lambda t: t.get('views', 0) or 0, reverse=True)

    for i, t in enumerate(sorted_tweets[:n], 1):
        text_preview = t['text'][:80].replace('\n', ' ')
        date = (t.get('created_at_kst') or t.get('created_at', ''))[:10]
        print(f"  #{i:>2}  [{t['tweet_type']:<14}] {date}")
        print(f"       Views: {t['views']:>12,} | Likes: {t['likes']:>8,} | RT: {t['retweets']:>6,} "
              f"| BM: {t['bookmarks']:>6,} | Reply: {t['replies']:>5,}")
        print(f"       {text_preview}")
        print(f"       https://x.com/{USERNAME}/status/{t['tweet_id']}")
        print()


def _print_type_samples(tweets, n=3):
    """유형별 샘플 트윗 출력."""
    print(f"\n{'─'*80}")
    print(f"  5. 유형별 샘플 (각 {n}개)")
    print(f"{'─'*80}")

    by_type = defaultdict(list)
    for t in tweets:
        by_type[t['tweet_type']].append(t)

    for type_name in sorted(by_type.keys()):
        type_tweets = by_type[type_name]
        # Sort by views desc, take top N
        samples = sorted(type_tweets, key=lambda t: t.get('views', 0) or 0, reverse=True)[:n]
        print(f"\n  ▸ {type_name} ({len(type_tweets)}건)")
        for t in samples:
            text_preview = t['text'][:100].replace('\n', ' ')
            print(f"    - [{t['views']:>10,} views] {text_preview}")


def _export_analysis_json(tweets):
    """Export analysis results to JSON."""
    output_path = "C:/temp/mv-tweet-crawler/aespa_analysis.json"

    by_type = defaultdict(list)
    for t in tweets:
        by_type[t['tweet_type']].append(t)

    type_stats = []
    for type_name, type_tweets in sorted(by_type.items(), key=lambda x: -len(x[1])):
        n = len(type_tweets)
        metrics = {}
        for m in ['views', 'likes', 'retweets', 'replies', 'bookmarks', 'quotes']:
            vals = [t[m] for t in type_tweets if t[m]]
            if vals:
                metrics[m] = {
                    'avg': round(sum(vals) / len(vals)),
                    'median': round(median(vals)),
                    'max': max(vals),
                    'total': sum(vals)
                }
        type_stats.append({
            'type': type_name,
            'count': n,
            'pct': round(n / len(tweets) * 100, 1),
            'metrics': metrics
        })

    # Top tweets
    top_tweets = []
    for t in sorted(tweets, key=lambda t: t.get('views', 0) or 0, reverse=True)[:20]:
        top_tweets.append({
            'tweet_id': t['tweet_id'],
            'text': t['text'][:200],
            'type': t['tweet_type'],
            'date': (t.get('created_at_kst') or '')[:10],
            'views': t['views'],
            'likes': t['likes'],
            'retweets': t['retweets'],
            'bookmarks': t['bookmarks'],
            'url': f"https://x.com/{USERNAME}/status/{t['tweet_id']}"
        })

    result = {
        'generated': datetime.now().isoformat(),
        'period': f"{SINCE_DATE} ~ {UNTIL_DATE}",
        'account': USERNAME,
        'total_tweets': len(tweets),
        'type_stats': type_stats,
        'top_tweets': top_tweets
    }

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"\n[EXPORT] Analysis saved to {output_path}")


# ─── Main ────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='에스파 트윗 크롤링 + 분석')
    parser.add_argument('--crawl', action='store_true', help='크롤링만 실행')
    parser.add_argument('--analyze', action='store_true', help='분석만 실행')
    parser.add_argument('--both', action='store_true', help='크롤링 + 분석 (기본)')
    args = parser.parse_args()

    # Default: both
    do_crawl = args.crawl or args.both or (not args.crawl and not args.analyze)
    do_analyze = args.analyze or args.both or (not args.crawl and not args.analyze)

    conn = init_db(DB_PATH)

    if do_crawl:
        print(f"\n{'='*60}")
        print(f"  STEP 1: 크롤링 — from:{USERNAME} ({SINCE_DATE} ~ {UNTIL_DATE})")
        print(f"{'='*60}\n")
        crawl_all_tweets(conn)

    if do_analyze:
        analyze_tweets(conn)

    conn.close()


if __name__ == '__main__':
    main()
