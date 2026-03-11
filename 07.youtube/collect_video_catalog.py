"""
YouTube Video Catalog Collector — 과거 3년간 전체 비디오 통계 수집
- 174개 채널의 모든 영상(숏츠 제외)에 대해 현재 누적 조회수/좋아요/댓글 수집
- youtube_engagement.py보다 경량 (AI 분류 없음, CSV 출력)
- 1회성 배치 작업으로 3년 베이스라인 구축용

Usage: python collect_video_catalog.py [--days 1095] [--group BLACKPINK] [--resume]
  --days N     : 수집 기간 (기본 1095일=3년)
  --group NAME : 특정 그룹만 수집
  --resume     : 이전 수집 이어서 진행 (이미 수집된 채널 스킵)
  --no-shorts-check : 숏츠 URL 체크 생략 (빠르지만 3분 이하 영상 모두 제외)

API Quota: ~3,500 units (174채널 × 3년) — 일일 한도 10,000의 35%
"""
import json
import csv
import os
import sys
import re
import time
import urllib.request
import urllib.parse
import urllib.error
import concurrent.futures
from datetime import datetime, timedelta, timezone

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE_DIR = r'G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app'
CHANNELS_JSON = os.path.join(BASE_DIR, 'data', 'youtube-channels.json')
OUTPUT_CSV = os.path.join(BASE_DIR, 'data', 'timeseries', 'youtube', 'video_catalog.csv')
PROGRESS_FILE = os.path.join(BASE_DIR, 'data', 'timeseries', 'youtube', 'catalog_progress.json')

API_KEY = os.environ.get('GOOGLE_API_KEY', os.environ.get('YOUTUBE_API_KEY', ''))
YT_API = 'https://www.googleapis.com/youtube/v3'

CSV_FIELDS = [
    'collected_date', 'video_id', 'group', 'channel_name', 'title', 'published',
    'duration', 'views', 'likes', 'comments', 'like_ratio', 'comment_ratio',
    'is_mv', 'is_short',
]

MV_PATTERNS = [
    r'\bm/v\b', r'\bmv\b', r'\bmusic\s*video\b', r'뮤직비디오',
    r'\bofficial\s+video\b', r'\bofficial\s+mv\b',
]
MV_EXCLUDE = [
    'reaction', 'making', 'behind', 'sketch', 'commentary',
    'teaser', 'practice', 'choreography', 'performance',
    'mv shoot', 'mv 촬영', '비하인드', '메이킹', '리액션',
    'fanmade', 'fan-made', 'fan made', 'self mv',
    'dance ver', 'remix', 'highlight medley',
    'trailer',
]

def is_actual_mv(title):
    """Detect actual MV (not reaction/making/behind/teaser/performance)."""
    t = title.lower()
    if not any(re.search(pat, t) for pat in MV_PATTERNS):
        return False
    if any(ex in t for ex in MV_EXCLUDE):
        return False
    return True

api_calls = 0

def yt_api(endpoint, params):
    """YouTube API v3 call with rate limiting."""
    global api_calls
    params['key'] = API_KEY
    url = f'{YT_API}/{endpoint}?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            api_calls += 1
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        if e.code == 403:
            print(f'  API quota exceeded! Total calls: {api_calls}')
            raise
        print(f'  API error {e.code}: {e.reason}')
        return None
    except Exception as e:
        print(f'  API error: {e}')
        return None

def parse_duration(duration_str):
    """ISO 8601 duration -> seconds"""
    m = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', duration_str or '')
    if not m:
        return 0
    h, mi, s = (int(x) if x else 0 for x in m.groups())
    return h * 3600 + mi * 60 + s

def check_is_short(video_id):
    """Check if video is a Short via /shorts/ URL redirect."""
    url = f'https://www.youtube.com/shorts/{video_id}'
    req = urllib.request.Request(url, method='HEAD')
    req.add_header('User-Agent', 'Mozilla/5.0')
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return '/shorts/' in resp.url
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 303):
            location = e.headers.get('Location', '')
            return '/shorts/' in location
        return False
    except Exception:
        return False

def batch_check_shorts(video_ids):
    """Parallel Shorts check. Returns {video_id: bool}."""
    results = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(check_is_short, vid): vid for vid in video_ids}
        for future in concurrent.futures.as_completed(futures):
            vid = futures[future]
            try:
                results[vid] = future.result()
            except Exception:
                results[vid] = False
    return results

def load_channels(group_filter=None):
    with open(CHANNELS_JSON, 'r', encoding='utf-8') as f:
        channels = json.load(f)
    if group_filter:
        channels = [ch for ch in channels if ch['group'].lower() == group_filter.lower()]
    return channels

def load_progress():
    """Load resume progress (set of completed channel_ids)."""
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE, 'r', encoding='utf-8') as f:
            return set(json.load(f).get('completed', []))
    return set()

def save_progress(completed_ids):
    with open(PROGRESS_FILE, 'w', encoding='utf-8') as f:
        json.dump({'completed': list(completed_ids), 'updated': datetime.now().isoformat()}, f)

def collect_channel_videos(ch, cutoff, today_str, check_shorts=True):
    """Collect all videos from a channel published after cutoff."""
    playlist_id = ch.get('uploads_playlist', '')
    if not playlist_id:
        return []

    # Step 1: Get all video IDs from uploads playlist
    video_ids = []
    page_token = None
    while True:
        params = {
            'part': 'snippet,contentDetails',
            'playlistId': playlist_id,
            'maxResults': 50,
        }
        if page_token:
            params['pageToken'] = page_token

        data = yt_api('playlistItems', params)
        if not data or not data.get('items'):
            break

        stop = False
        for item in data['items']:
            pub = item['snippet'].get('publishedAt', '')
            if pub:
                pub_dt = datetime.fromisoformat(pub.replace('Z', '+00:00'))
                if pub_dt < cutoff:
                    stop = True
                    break
            vid_id = item['contentDetails'].get('videoId')
            if vid_id:
                video_ids.append(vid_id)

        if stop:
            break
        page_token = data.get('nextPageToken')
        if not page_token:
            break

    if not video_ids:
        return []

    # Step 2: Get statistics for all videos (batch 50)
    all_videos = []
    shorts_queue = []

    for i in range(0, len(video_ids), 50):
        batch = video_ids[i:i+50]
        data = yt_api('videos', {
            'part': 'snippet,contentDetails,statistics',
            'id': ','.join(batch),
        })
        if not data or not data.get('items'):
            continue

        for item in data['items']:
            dur = parse_duration(item['contentDetails'].get('duration', ''))
            title = item['snippet'].get('title', '')
            stats = item.get('statistics', {})
            views = int(stats.get('viewCount', 0))
            likes = int(stats.get('likeCount', 0))
            comments = int(stats.get('commentCount', 0))
            title_lower = title.lower()
            is_mv = is_actual_mv(title)

            vid_data = {
                'collected_date': today_str,
                'video_id': item['id'],
                'group': ch['group'],
                'channel_name': ch['name'],
                'title': title,
                'published': item['snippet'].get('publishedAt', '')[:10],
                'duration': dur,
                'views': views,
                'likes': likes,
                'comments': comments,
                'like_ratio': round(likes / views, 6) if views > 0 else 0,
                'comment_ratio': round(comments / views, 6) if views > 0 else 0,
                'is_mv': is_mv,
                'is_short': False,
            }

            if dur <= 180 and dur > 0:
                if check_shorts:
                    shorts_queue.append(vid_data)
                else:
                    # No shorts check: assume all <=180s are shorts and skip
                    continue
            else:
                all_videos.append(vid_data)

    # Step 3: Shorts batch check
    shorts_filtered = 0
    if shorts_queue and check_shorts:
        check_ids = [v['video_id'] for v in shorts_queue]
        is_short_map = batch_check_shorts(check_ids)
        for vid_data in shorts_queue:
            if is_short_map.get(vid_data['video_id'], False):
                shorts_filtered += 1
            else:
                all_videos.append(vid_data)

    return all_videos, shorts_filtered, len(video_ids)

def main():
    import argparse
    parser = argparse.ArgumentParser(description='YouTube 3년 비디오 카탈로그 수집')
    parser.add_argument('--days', type=int, default=1095, help='수집 기간 (기본 1095일=3년)')
    parser.add_argument('--group', type=str, default=None, help='특정 그룹만 수집')
    parser.add_argument('--resume', action='store_true', help='이전 수집 이어서 진행')
    parser.add_argument('--no-shorts-check', action='store_true', help='숏츠 URL 체크 생략')
    args = parser.parse_args()

    if not API_KEY:
        print('ERROR: GOOGLE_API_KEY or YOUTUBE_API_KEY environment variable required')
        return

    today_str = datetime.now().strftime('%Y-%m-%d')
    cutoff = datetime.now(timezone.utc) - timedelta(days=args.days)
    channels = load_channels(args.group)
    total = len(channels)

    print(f'=== YouTube Video Catalog Collector ({today_str}) ===')
    print(f'Channels: {total}, Period: {args.days} days ({cutoff.strftime("%Y-%m-%d")} ~)')
    print(f'Shorts check: {"OFF" if args.no_shorts_check else "ON"}')

    # Resume support
    completed_ids = set()
    if args.resume:
        completed_ids = load_progress()
        remaining = [ch for ch in channels if ch['channel_id'] not in completed_ids]
        print(f'Resume: {len(completed_ids)} done, {len(remaining)} remaining')
        channels = remaining

    # Prepare CSV
    os.makedirs(os.path.dirname(OUTPUT_CSV), exist_ok=True)
    file_exists = os.path.exists(OUTPUT_CSV) and args.resume
    csv_file = open(OUTPUT_CSV, 'a' if file_exists else 'w', encoding='utf-8', newline='')
    writer = csv.DictWriter(csv_file, fieldnames=CSV_FIELDS)
    if not file_exists:
        writer.writeheader()

    total_videos = 0
    total_shorts = 0
    total_found = 0

    try:
        for idx, ch in enumerate(channels, 1):
            print(f'[{idx}/{len(channels)}] {ch["name"]} ({ch["group"]})', end=' ', flush=True)

            try:
                videos, shorts_count, found_count = collect_channel_videos(
                    ch, cutoff, today_str, check_shorts=not args.no_shorts_check
                )
            except urllib.error.HTTPError as e:
                if e.code == 403:
                    print(f'\nAPI quota exceeded at channel {idx}. Use --resume to continue later.')
                    break
                print(f'ERROR: {e}')
                continue

            # Write to CSV immediately
            writer.writerows(videos)
            csv_file.flush()

            total_videos += len(videos)
            total_shorts += shorts_count
            total_found += found_count

            print(f'-> {found_count} found, {len(videos)} saved, {shorts_count} shorts filtered')

            # Save progress
            completed_ids.add(ch['channel_id'])
            if idx % 5 == 0:
                save_progress(completed_ids)

    except KeyboardInterrupt:
        print('\n\nInterrupted! Saving progress...')
    finally:
        csv_file.close()
        save_progress(completed_ids)

    print(f'\n=== Summary ===')
    print(f'Channels processed: {len(completed_ids)}')
    print(f'Videos found: {total_found}')
    print(f'Videos saved (excl. Shorts): {total_videos}')
    print(f'Shorts filtered: {total_shorts}')
    print(f'API calls: {api_calls}')
    print(f'Output: {OUTPUT_CSV}')

if __name__ == '__main__':
    main()
