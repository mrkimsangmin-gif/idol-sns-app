"""
소속사 공용 채널 MV 수집기
— 그룹 공식 채널이 아닌 소속사 채널에 게시된 MV를 별도 테이블로 수집
— engagement 지표는 그룹 채널 데이터와 직접 비교 불가 (구독자 구성이 다름)

Usage: python collect_label_mvs.py [--days 1095] [--resume] [--label HYBE]
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
from datetime import datetime, timedelta, timezone

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE_DIR = r'G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app'
CHANNELS_JSON = os.path.join(BASE_DIR, 'data', 'youtube-channels.json')
OUTPUT_CSV = os.path.join(BASE_DIR, 'data', 'timeseries', 'youtube', 'label_mvs.csv')
PROGRESS_FILE = os.path.join(BASE_DIR, 'data', 'timeseries', 'youtube', 'label_mvs_progress.json')

API_KEY = os.environ.get('GOOGLE_API_KEY', os.environ.get('YOUTUBE_API_KEY', ''))
YT_API = 'https://www.googleapis.com/youtube/v3'

CSV_FIELDS = [
    'collected_date', 'video_id', 'group', 'label_channel', 'label_name',
    'title', 'published', 'duration', 'views', 'likes', 'comments',
    'like_ratio', 'comment_ratio', 'source',
]

# ============================================================
# 소속사 공용 채널 매핑
# ============================================================
LABEL_CHANNELS = [
    {
        'name': 'HYBE LABELS',
        'channel_id': 'UC3IZKseVpdzPSBaWxBxundA',
        'groups': ['BTS', 'LE SSERAFIM', 'TXT', 'ENHYPEN', 'SEVENTEEN',
                   'ILLIT', 'TWS', 'BOYNEXTDOOR', '&TEAM', 'KATSEYE'],
    },
    {
        'name': 'JYP Entertainment',
        'channel_id': 'UCaO6TYtlC8U5ttz62hTrZgg',
        'groups': ['ITZY', 'DAY6', 'Stray Kids', 'TWICE', 'NMIXX', 'NiziU', 'NEXZ'],
    },
    {
        'name': 'SMTOWN',
        'channel_id': 'UCEf_Bc-KVd7onSeifS3py9g',
        'groups': ['NCT DREAM', 'NCT 127', 'aespa', 'Red Velvet', 'RIIZE'],
    },
    {
        'name': 'STARSHIP',
        'channel_id': 'UCYDmx2Sfpnaxg488yBpZIGg',
        'groups': ['IVE', 'CRAVITY', 'WJSN'],
    },
    {
        'name': 'THEBLACKLABEL',
        'channel_id': 'UCg8ZzloDPTrOiGztK0C9txQ',
        'groups': ['ALLDAY PROJECT', 'MEOVV'],
    },
    {
        'name': 'KQ Entertainment',
        'channel_id': 'UCQdq-lqPEq_yZ_wP_kuVB9Q',
        'groups': ['ATEEZ'],
    },
    {
        'name': 'BIGHIT MUSIC',
        'channel_id': 'UCZcuvva_DgJfeF5W-mSqA2A',
        'groups': ['BTS'],
    },
    {
        'name': 'YG ENTERTAINMENT',
        'channel_id': 'UCQi67q4kGdmnJaRzX81uK5g',
        'groups': ['BLACKPINK', 'BABYMONSTER', 'TREASURE'],
    },
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
    'trailer', '#shorts', 'shorts',
]

api_calls = 0


def is_actual_mv(title):
    t = title.lower()
    if not any(re.search(pat, t) for pat in MV_PATTERNS):
        return False
    if any(ex in t for ex in MV_EXCLUDE):
        return False
    return True


def yt_api(endpoint, params):
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
    m = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', duration_str or '')
    if not m:
        return 0
    h, mi, s = (int(x) if x else 0 for x in m.groups())
    return h * 3600 + mi * 60 + s


def get_uploads_playlist(channel_id):
    """Get the uploads playlist ID for a channel."""
    data = yt_api('channels', {'part': 'contentDetails', 'id': channel_id})
    if data and data.get('items'):
        return data['items'][0]['contentDetails']['relatedPlaylists']['uploads']
    return None


GROUP_VARIATIONS = {
    'BTS': ['방탄소년단'],
    'LE SSERAFIM': ['르세라핌'],
    'NCT DREAM': ['엔시티 드림'],
    'NCT 127': ['엔시티 127'],
    'ENHYPEN': ['엔하이픈'],
    'TXT': ['투모로우바이투게더', 'tomorrow x together'],
    'SEVENTEEN': ['세븐틴', 'svt'],
    'ITZY': ['있지'],
    'DAY6': ['데이식스'],
    'Stray Kids': ['스트레이 키즈', 'skz'],
    'TWICE': ['트와이스'],
    'NMIXX': ['엔믹스'],
    'aespa': ['에스파'],
    'Red Velvet': ['레드벨벳'],
    'RIIZE': ['라이즈'],
    'IVE': ['아이브'],
    'BLACKPINK': ['블랙핑크'],
    'BABYMONSTER': ['베이비몬스터'],
    'TREASURE': ['트레저'],
    'ILLIT': ['아일릿'],
    'TWS': ['투어스'],
    'BOYNEXTDOOR': ['보이넥스트도어'],
    'ALLDAY PROJECT': ['올데이 프로젝트'],
    'MEOVV': ['미야오'],
    'ATEEZ': ['에이티즈'],
    'CRAVITY': ['크래비티'],
    'WJSN': ['우주소녀', 'cosmic girls'],
    'NiziU': ['니쥬'],
}


def match_group(title, groups):
    """Match a video title to one of the known groups.
    Uses earliest-position matching to avoid false positives like
    'LE SSERAFIM feat. j-hope of BTS' being matched as BTS.
    """
    title_lower = title.lower()
    candidates = []  # (position, group)

    for group in groups:
        # Check group name
        pos = title_lower.find(group.lower())
        if pos != -1:
            candidates.append((pos, group))
        # Check variations
        for var in GROUP_VARIATIONS.get(group, []):
            vpos = title_lower.find(var.lower())
            if vpos != -1:
                candidates.append((vpos, group))
                break

    if not candidates:
        return None

    # Return the group that appears earliest in the title
    candidates.sort(key=lambda x: x[0])
    return candidates[0][1]


def collect_label_mvs(label, cutoff, today_str):
    """Collect MVs from a label channel, matching to known groups."""
    channel_id = label['channel_id']
    label_name = label['name']
    groups = label['groups']

    print(f'\n[{label_name}] channel_id={channel_id}, groups={len(groups)}')

    # Get uploads playlist
    uploads_pl = get_uploads_playlist(channel_id)
    if not uploads_pl:
        print(f'  Failed to get uploads playlist')
        return []

    # Paginate through all videos
    all_video_ids = []
    page_token = None
    while True:
        params = {
            'part': 'snippet',
            'playlistId': uploads_pl,
            'maxResults': 50,
        }
        if page_token:
            params['pageToken'] = page_token

        data = yt_api('playlistItems', params)
        if not data or 'items' not in data:
            break

        for item in data['items']:
            snippet = item['snippet']
            published = snippet.get('publishedAt', '')[:10]
            title = snippet.get('title', '')
            video_id = snippet.get('resourceId', {}).get('videoId', '')

            # Skip if before cutoff
            if published < cutoff:
                # Videos are in reverse chronological order
                # but playlistItems are not guaranteed to be sorted
                continue

            # Only keep if it looks like an MV
            if not is_actual_mv(title):
                continue

            # Match to a known group
            group = match_group(title, groups)
            if not group:
                continue

            all_video_ids.append({
                'video_id': video_id,
                'group': group,
                'title': title,
                'published': published,
            })

        page_token = data.get('nextPageToken')
        if not page_token:
            break

        # Check if we've gone past cutoff significantly
        oldest_in_page = min(
            (item['snippet'].get('publishedAt', '')[:10] for item in data['items']),
            default=''
        )
        if oldest_in_page and oldest_in_page < cutoff:
            break

    print(f'  Found {len(all_video_ids)} MV candidates')

    if not all_video_ids:
        return []

    # Get video statistics in batches of 50
    results = []
    for i in range(0, len(all_video_ids), 50):
        batch = all_video_ids[i:i+50]
        ids_str = ','.join(v['video_id'] for v in batch)
        data = yt_api('videos', {
            'part': 'statistics,contentDetails',
            'id': ids_str,
        })
        if not data or 'items' not in data:
            continue

        stats_map = {}
        for item in data['items']:
            vid = item['id']
            stats = item.get('statistics', {})
            content = item.get('contentDetails', {})
            stats_map[vid] = {
                'views': int(stats.get('viewCount', 0)),
                'likes': int(stats.get('likeCount', 0)),
                'comments': int(stats.get('commentCount', 0)),
                'duration': parse_duration(content.get('duration', '')),
            }

        for v in batch:
            if v['video_id'] not in stats_map:
                continue
            s = stats_map[v['video_id']]
            views = s['views']
            results.append({
                'collected_date': today_str,
                'video_id': v['video_id'],
                'group': v['group'],
                'label_channel': label['channel_id'],
                'label_name': label_name,
                'title': v['title'],
                'published': v['published'],
                'duration': s['duration'],
                'views': views,
                'likes': s['likes'],
                'comments': s['comments'],
                'like_ratio': round(s['likes'] / views, 6) if views > 0 else 0,
                'comment_ratio': round(s['comments'] / views, 6) if views > 0 else 0,
                'source': 'label_channel',
            })

    print(f'  Collected {len(results)} MVs with stats')
    for r in results:
        print(f'    [{r["group"]}] {r["title"][:55]} — {r["views"]:,} views')

    return results


def normalize_song_title(title):
    """Normalize title for dedup: strip MV markers, parens, brackets, whitespace."""
    t = title.lower()
    # Remove common MV markers
    for marker in ['official m/v', 'official mv', 'm/v', 'mv', 'music video',
                    'official video', '뮤직비디오']:
        t = t.replace(marker, '')
    # Remove content in parentheses and brackets
    t = re.sub(r'[\(\[\{].*?[\)\]\}]', '', t)
    # Remove extra whitespace, quotes, dashes
    t = re.sub(r"['\"""''「」]", '', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t


def dedup_results(results):
    """Remove duplicate MVs: same video_id or same song (keep highest views)."""
    if not results:
        return results

    # 1. Exact video_id dedup
    seen_ids = set()
    unique = []
    for r in results:
        if r['video_id'] not in seen_ids:
            seen_ids.add(r['video_id'])
            unique.append(r)

    # 2. Same-song dedup: group by (group, normalized_title), keep highest views
    song_map = {}
    for r in unique:
        key = (r['group'], normalize_song_title(r['title']))
        if key not in song_map or r['views'] > song_map[key]['views']:
            song_map[key] = r

    deduped = list(song_map.values())
    removed = len(results) - len(deduped)
    if removed > 0:
        print(f'  Dedup: {len(results)} → {len(deduped)} ({removed} duplicates removed)')
    return deduped


def load_progress():
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE, 'r', encoding='utf-8') as f:
            return set(json.load(f).get('completed', []))
    return set()


def save_progress(completed_ids):
    with open(PROGRESS_FILE, 'w', encoding='utf-8') as f:
        json.dump({'completed': list(completed_ids), 'updated': datetime.now().isoformat()}, f)


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--days', type=int, default=1095, help='Collection period in days')
    parser.add_argument('--resume', action='store_true')
    parser.add_argument('--label', type=str, help='Specific label name to collect')
    args = parser.parse_args()

    if not API_KEY:
        print('ERROR: GOOGLE_API_KEY not set')
        sys.exit(1)

    today = datetime.now(timezone.utc)
    today_str = today.strftime('%Y-%m-%d')
    cutoff = (today - timedelta(days=args.days)).strftime('%Y-%m-%d')

    print(f'=== Label Channel MV Collector ===')
    print(f'Period: {cutoff} ~ {today_str} ({args.days} days)')
    print(f'Labels: {len(LABEL_CHANNELS)}')
    print(f'Output: {OUTPUT_CSV}')

    completed = load_progress() if args.resume else set()

    labels_to_process = LABEL_CHANNELS
    if args.label:
        labels_to_process = [l for l in LABEL_CHANNELS if args.label.lower() in l['name'].lower()]

    # Collect all results first, then dedup and write
    all_results = []

    # If resuming, load existing data
    if args.resume and os.path.exists(OUTPUT_CSV):
        with open(OUTPUT_CSV, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                row['views'] = int(row['views'])
                row['likes'] = int(row['likes'])
                row['comments'] = int(row['comments'])
                row['duration'] = int(row['duration'])
                row['like_ratio'] = float(row['like_ratio'])
                row['comment_ratio'] = float(row['comment_ratio'])
                all_results.append(row)
        print(f'Loaded {len(all_results)} existing MVs from previous run')

    for label in labels_to_process:
        if label['channel_id'] in completed:
            print(f'\n[{label["name"]}] already completed, skipping')
            continue

        try:
            results = collect_label_mvs(label, cutoff, today_str)
            all_results.extend(results)
            completed.add(label['channel_id'])
            save_progress(completed)
        except Exception as e:
            print(f'  ERROR: {e}')
            save_progress(completed)
            if 'quota' in str(e).lower():
                break

    # Dedup and write final CSV
    print(f'\n--- Deduplication ---')
    all_results = dedup_results(all_results)

    with open(OUTPUT_CSV, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(all_results)

    print(f'\n=== Complete ===')
    print(f'Total MVs: {len(all_results)}')
    print(f'API calls: {api_calls}')
    print(f'Output: {OUTPUT_CSV}')


if __name__ == '__main__':
    main()
