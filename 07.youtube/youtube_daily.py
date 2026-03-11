"""
YouTube Daily Collector
- 매일 06:00 실행: 구독자수 + 최근 30일 신규 영상 조회수 수집
- 신규 MV 감지 시 컴백 추적 목록에 자동 등록
- 숏츠 자동 제외

Usage: python youtube_daily.py [--days 30]
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
from datetime import datetime, timedelta

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE_DIR = r'G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app'
CHANNELS_JSON = os.path.join(BASE_DIR, 'data', 'youtube-channels.json')
TIMESERIES_DIR = os.path.join(BASE_DIR, 'data', 'timeseries', 'youtube')
SUBSCRIBERS_CSV = os.path.join(TIMESERIES_DIR, 'subscribers_daily.csv')
NEW_VIDEOS_CSV = os.path.join(TIMESERIES_DIR, 'new_videos_daily.csv')
COMEBACK_TRACKING_JSON = os.path.join(TIMESERIES_DIR, 'comebacks', 'tracking.json')

API_KEY = os.environ.get('GOOGLE_API_KEY', os.environ.get('YOUTUBE_API_KEY', ''))
YT_API = 'https://www.googleapis.com/youtube/v3'

def parse_duration(duration_str):
    """ISO 8601 duration -> seconds (PT3M42S -> 222)"""
    m = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', duration_str or '')
    if not m:
        return 0
    h, mi, s = (int(x) if x else 0 for x in m.groups())
    return h * 3600 + mi * 60 + s

def check_is_short(video_id):
    """YouTube /shorts/ URL redirect check. True=Shorts, False=normal."""
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

def yt_api(endpoint, params):
    """YouTube API v3 call."""
    params['key'] = API_KEY
    url = f'{YT_API}/{endpoint}?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        print(f'  API error: {e}')
        return None

def load_channels():
    with open(CHANNELS_JSON, 'r', encoding='utf-8') as f:
        return json.load(f)

def collect_subscribers(channels, today):
    """Collect subscriber counts for all channels."""
    print(f'\n[구독자 수집] {len(channels)} channels')
    results = []

    # Batch by 50 (API limit)
    for i in range(0, len(channels), 50):
        batch = channels[i:i+50]
        ids = ','.join(ch['channel_id'] for ch in batch)
        data = yt_api('channels', {
            'part': 'statistics',
            'id': ids,
        })
        if not data:
            continue

        id_to_group = {ch['channel_id']: ch for ch in batch}
        for item in data.get('items', []):
            ch_id = item['id']
            ch = id_to_group.get(ch_id, {})
            subs = int(item['statistics'].get('subscriberCount', 0))
            results.append({
                'date': today,
                'group': ch.get('group', ''),
                'subscribers': subs,
                'source': 'daily'
            })

    # Append to CSV
    file_exists = os.path.exists(SUBSCRIBERS_CSV)
    with open(SUBSCRIBERS_CSV, 'a', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['date', 'group', 'subscribers', 'source'])
        if not file_exists:
            writer.writeheader()
        writer.writerows(results)

    print(f'  Saved {len(results)} subscriber records')
    return results

def collect_new_videos(channels, days=30):
    """Collect videos published in the last N days."""
    print(f'\n[신규 영상 수집] last {days} days')
    today = datetime.now()
    cutoff = today - timedelta(days=days)
    cutoff_str = cutoff.strftime('%Y-%m-%dT00:00:00Z')
    today_str = today.strftime('%Y-%m-%d')

    all_videos = []
    mv_keywords = ['m/v', 'mv', 'music video', '뮤직비디오', 'official video', 'official mv']

    for ch in channels:
        playlist_id = ch.get('uploads_playlist', '')
        if not playlist_id:
            continue

        # Fetch recent uploads
        page_token = None
        video_ids = []
        while True:
            params = {
                'part': 'snippet',
                'playlistId': playlist_id,
                'maxResults': 50,
            }
            if page_token:
                params['pageToken'] = page_token

            data = yt_api('playlistItems', params)
            if not data:
                break

            for item in data.get('items', []):
                pub = item['snippet'].get('publishedAt', '')
                if pub < cutoff_str:
                    page_token = None
                    break
                video_ids.append({
                    'id': item['snippet']['resourceId']['videoId'],
                    'title': item['snippet'].get('title', ''),
                    'published': pub[:10],
                })
            else:
                page_token = data.get('nextPageToken')
                if not page_token:
                    break
                continue
            break

        if not video_ids:
            continue

        # Get statistics for these videos
        shorts_filtered = 0
        for j in range(0, len(video_ids), 50):
            batch = video_ids[j:j+50]
            ids_str = ','.join(v['id'] for v in batch)
            stats = yt_api('videos', {
                'part': 'statistics,contentDetails',
                'id': ids_str,
            })
            if not stats:
                continue

            stats_map = {item['id']: item for item in stats.get('items', [])}
            for v in batch:
                s = stats_map.get(v['id'], {})
                stat = s.get('statistics', {})
                content = s.get('contentDetails', {})

                # Shorts filtering: duration <= 180s -> check /shorts/ URL
                dur = parse_duration(content.get('duration', ''))
                if dur > 0 and dur <= 180:
                    if check_is_short(v['id']):
                        shorts_filtered += 1
                        continue

                title_lower = v['title'].lower()
                is_mv = any(kw in title_lower for kw in mv_keywords)

                video_data = {
                    'date': today_str,
                    'video_id': v['id'],
                    'group': ch['group'],
                    'title': v['title'],
                    'published': v['published'],
                    'views': int(stat.get('viewCount', 0)),
                    'likes': int(stat.get('likeCount', 0)),
                    'comments': int(stat.get('commentCount', 0)),
                    'is_mv': is_mv,
                    'duration': dur,
                }
                all_videos.append(video_data)
        if shorts_filtered:
            print(f'  [{ch["group"]}] {shorts_filtered} Shorts filtered')

    # Write to CSV
    file_exists = os.path.exists(NEW_VIDEOS_CSV)
    with open(NEW_VIDEOS_CSV, 'a', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=[
            'date', 'video_id', 'group', 'title', 'published',
            'views', 'likes', 'comments', 'is_mv', 'duration'
        ])
        if not file_exists:
            writer.writeheader()
        writer.writerows(all_videos)

    mv_count = sum(1 for v in all_videos if v['is_mv'])
    print(f'  Saved {len(all_videos)} videos ({mv_count} MVs)')
    return all_videos

def detect_new_comebacks(videos):
    """Detect new MVs and register for comeback tracking."""
    os.makedirs(os.path.dirname(COMEBACK_TRACKING_JSON), exist_ok=True)

    # Load existing tracking
    tracking = {}
    if os.path.exists(COMEBACK_TRACKING_JSON):
        with open(COMEBACK_TRACKING_JSON, 'r', encoding='utf-8') as f:
            tracking = json.load(f)

    new_comebacks = []
    for v in videos:
        if not v['is_mv']:
            continue
        vid = v['video_id']
        if vid in tracking:
            continue

        # New MV detected
        pub_date = datetime.strptime(v['published'], '%Y-%m-%d')
        days_since = (datetime.now() - pub_date).days

        if days_since <= 30:  # Only track MVs within 30 days
            tracking[vid] = {
                'group': v['group'],
                'title': v['title'],
                'published': v['published'],
                'registered': datetime.now().strftime('%Y-%m-%d %H:%M'),
                'status': 'active',
                'snapshots': [{
                    'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M'),
                    'hours_since_release': days_since * 24,
                    'views': v['views'],
                    'likes': v['likes'],
                    'comments': v['comments'],
                }]
            }
            new_comebacks.append(f"{v['group']} - {v['title']}")

    # Save tracking
    with open(COMEBACK_TRACKING_JSON, 'w', encoding='utf-8') as f:
        json.dump(tracking, f, ensure_ascii=False, indent=2)

    if new_comebacks:
        print(f'\n[신규 컴백 감지] {len(new_comebacks)}개')
        for cb in new_comebacks:
            print(f'  + {cb}')

    return new_comebacks

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--days', type=int, default=30)
    args = parser.parse_args()

    if not API_KEY:
        print('ERROR: GOOGLE_API_KEY or YOUTUBE_API_KEY environment variable required')
        return

    today = datetime.now().strftime('%Y-%m-%d')
    print(f'=== YouTube Daily Collector ({today}) ===')

    channels = load_channels()
    print(f'Loaded {len(channels)} channels')

    # 1. Collect subscribers
    collect_subscribers(channels, today)

    # 2. Collect new videos
    videos = collect_new_videos(channels, days=args.days)

    # 3. Detect new comebacks
    detect_new_comebacks(videos)

    print(f'\n=== Done ===')

if __name__ == '__main__':
    main()
