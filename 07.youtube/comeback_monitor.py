"""
Comeback MV Performance Monitor
- tracking.json(youtube_daily.py가 생성)에서 활성 MV 목록을 읽어
  YouTube Data API v3로 조회수/좋아요/댓글 스냅샷을 주기적으로 수집
- 수집 주기: 릴리즈 후 0~3일 3시간, 4~7일 6시간, 8~30일 24시간, 30일+ 완료 처리
- 스냅샷 결과를 tracking.json에 추가하고 mv_curves.csv에 시계열 행 기록

Usage:
    # 지속 루프 모드 (기본)
    python comeback_monitor.py

    # 단일 실행 후 종료
    python comeback_monitor.py --once

    # 간격 무시하고 모든 활성 MV 즉시 수집
    python comeback_monitor.py --once --force
"""
import json
import csv
import os
import sys
import time
import argparse
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timedelta

# ── Windows 한글 출력 안전 처리 ──
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

# ── 경로 설정 ──
BASE_DIR = r'G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app'
TRACKING_JSON = os.path.join(BASE_DIR, 'data', 'timeseries', 'youtube', 'comebacks', 'tracking.json')
MV_CURVES_CSV = os.path.join(BASE_DIR, 'data', 'timeseries', 'youtube', 'comebacks', 'mv_curves.csv')

# ── API 설정 ──
API_KEY = os.environ.get('GOOGLE_API_KEY', os.environ.get('YOUTUBE_API_KEY', ''))
YT_API = 'https://www.googleapis.com/youtube/v3'

# ── 수집 간격 정책 (릴리즈 후 일수 → 시간) ──
INTERVAL_POLICY = [
    (3,  3),    # Days 0-3:  every 3 hours
    (7,  6),    # Days 4-7:  every 6 hours
    (30, 24),   # Days 8-30: every 24 hours
]
COMPLETION_DAYS = 30  # 30일 초과 시 completed 처리


def log(msg):
    """Timestamped console logging."""
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f'[{ts}] {msg}')


def yt_api(endpoint, params):
    """YouTube Data API v3 호출 (urllib only)."""
    params['key'] = API_KEY
    url = f'{YT_API}/{endpoint}?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        log(f'  API HTTP {e.code}: {body[:300]}')
        return None
    except Exception as e:
        log(f'  API error: {e}')
        return None


def load_tracking():
    """tracking.json 로드. 파일 없으면 빈 dict 반환."""
    if not os.path.exists(TRACKING_JSON):
        log(f'tracking.json not found: {TRACKING_JSON}')
        return {}
    with open(TRACKING_JSON, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_tracking(tracking):
    """tracking.json 저장 (Google Drive 안전 패턴: 직접 write + fsync)."""
    os.makedirs(os.path.dirname(TRACKING_JSON), exist_ok=True)
    with open(TRACKING_JSON, 'w', encoding='utf-8') as f:
        json.dump(tracking, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())


def get_interval_hours(days_since_release):
    """릴리즈 후 일수에 따른 수집 간격(시간) 반환. 30일+ 이면 None (완료)."""
    if days_since_release > COMPLETION_DAYS:
        return None
    for max_day, interval_h in INTERVAL_POLICY:
        if days_since_release <= max_day:
            return interval_h
    return None


def compute_hours_since_release(published_str):
    """published 날짜 문자열('YYYY-MM-DD')로부터 현재까지 경과 시간 계산."""
    pub_dt = datetime.strptime(published_str, '%Y-%m-%d')
    delta = datetime.now() - pub_dt
    return delta.total_seconds() / 3600.0


def compute_days_since_release(published_str):
    """published 날짜 문자열로부터 현재까지 경과 일수 계산."""
    pub_dt = datetime.strptime(published_str, '%Y-%m-%d')
    return (datetime.now() - pub_dt).days


def should_check(entry, force=False):
    """해당 MV를 지금 체크해야 하는지 판단.

    Returns:
        (bool, float or None) - (체크 여부, 다음 체크까지 남은 시간(초) or None)
    """
    if entry.get('status') != 'active':
        return False, None

    days_since = compute_days_since_release(entry['published'])

    # 30일 초과 → completed 전환 대상
    if days_since > COMPLETION_DAYS:
        return True, None  # 마지막 수집 후 완료 처리

    if force:
        return True, None

    interval_h = get_interval_hours(days_since)
    if interval_h is None:
        return False, None

    # 마지막 스냅샷 시각 확인
    snapshots = entry.get('snapshots', [])
    if not snapshots:
        return True, None  # 스냅샷 없으면 즉시 수집

    last_ts_str = snapshots[-1].get('timestamp', '')
    try:
        last_ts = datetime.strptime(last_ts_str, '%Y-%m-%d %H:%M')
    except ValueError:
        return True, None

    elapsed_h = (datetime.now() - last_ts).total_seconds() / 3600.0
    if elapsed_h >= interval_h:
        return True, None
    else:
        remaining_sec = (interval_h - elapsed_h) * 3600
        return False, remaining_sec


def fetch_video_stats(video_ids):
    """YouTube API로 비디오 통계 배치 조회 (최대 50개씩).

    Returns:
        dict: {video_id: {'views': int, 'likes': int, 'comments': int}} or None on error
    """
    results = {}
    for i in range(0, len(video_ids), 50):
        batch = video_ids[i:i + 50]
        ids_str = ','.join(batch)
        data = yt_api('videos', {
            'part': 'statistics',
            'id': ids_str,
        })
        if not data:
            continue
        for item in data.get('items', []):
            stats = item.get('statistics', {})
            results[item['id']] = {
                'views': int(stats.get('viewCount', 0)),
                'likes': int(stats.get('likeCount', 0)),
                'comments': int(stats.get('commentCount', 0)),
            }
    return results


def append_to_csv(rows):
    """mv_curves.csv에 행 추가. 파일 없으면 헤더 포함 생성."""
    os.makedirs(os.path.dirname(MV_CURVES_CSV), exist_ok=True)
    fieldnames = [
        'video_id', 'group', 'title', 'published',
        'timestamp', 'hours_since_release',
        'views', 'likes', 'comments',
        'views_delta', 'likes_delta',
    ]
    file_exists = os.path.exists(MV_CURVES_CSV)
    with open(MV_CURVES_CSV, 'a', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if not file_exists:
            writer.writeheader()
        writer.writerows(rows)


def run_check(tracking, force=False):
    """활성 MV들을 점검하고 스냅샷 수집. 변경 사항이 있으면 True 반환.

    Returns:
        (bool, float) - (변경 여부, 다음 체크까지 최소 대기 시간(초))
    """
    now = datetime.now()
    now_str = now.strftime('%Y-%m-%d %H:%M')
    changed = False
    min_wait_sec = float('inf')

    # 체크 대상 MV 식별
    to_check = []
    for vid, entry in tracking.items():
        need_check, remaining = should_check(entry, force=force)
        if need_check:
            to_check.append(vid)
        elif remaining is not None:
            min_wait_sec = min(min_wait_sec, remaining)

    if not to_check:
        if min_wait_sec == float('inf'):
            log('No active MVs to monitor.')
            return False, 3600  # 활성 MV 없으면 1시간 후 재확인
        log(f'No MVs due for check. Next check in {min_wait_sec / 60:.0f} min.')
        return False, min_wait_sec

    log(f'Checking {len(to_check)} MVs...')

    # MV 정보 출력
    for vid in to_check:
        entry = tracking[vid]
        days = compute_days_since_release(entry['published'])
        interval = get_interval_hours(days)
        status_note = f'interval={interval}h' if interval else 'completing'
        log(f'  {entry["group"]} - {entry["title"]} (D+{days}, {status_note})')

    # 배치 API 호출
    stats = fetch_video_stats(to_check)
    if not stats:
        log('API returned no data. Will retry next cycle.')
        return False, 300  # 5분 후 재시도

    # 스냅샷 추가 + CSV 행 생성
    csv_rows = []
    completed_count = 0

    for vid in to_check:
        if vid not in stats:
            log(f'  WARNING: No stats for {vid}, skipping.')
            continue

        entry = tracking[vid]
        stat = stats[vid]
        hours_since = round(compute_hours_since_release(entry['published']), 1)
        days_since = compute_days_since_release(entry['published'])

        # Delta 계산 (이전 스냅샷 대비)
        prev_views = 0
        prev_likes = 0
        if entry.get('snapshots'):
            last_snap = entry['snapshots'][-1]
            prev_views = last_snap.get('views', 0)
            prev_likes = last_snap.get('likes', 0)

        views_delta = stat['views'] - prev_views
        likes_delta = stat['likes'] - prev_likes

        # 스냅샷 객체 생성
        snapshot = {
            'timestamp': now_str,
            'hours_since_release': hours_since,
            'views': stat['views'],
            'likes': stat['likes'],
            'comments': stat['comments'],
        }

        # tracking.json에 스냅샷 추가
        if 'snapshots' not in entry:
            entry['snapshots'] = []
        entry['snapshots'].append(snapshot)
        changed = True

        # CSV 행
        csv_rows.append({
            'video_id': vid,
            'group': entry['group'],
            'title': entry['title'],
            'published': entry['published'],
            'timestamp': now_str,
            'hours_since_release': hours_since,
            'views': stat['views'],
            'likes': stat['likes'],
            'comments': stat['comments'],
            'views_delta': views_delta,
            'likes_delta': likes_delta,
        })

        # 30일 초과 → completed
        if days_since > COMPLETION_DAYS:
            entry['status'] = 'completed'
            completed_count += 1
            log(f'  COMPLETED: {entry["group"]} - {entry["title"]} '
                f'(final views: {stat["views"]:,})')
        else:
            log(f'  {entry["group"]} - {entry["title"]}: '
                f'{stat["views"]:,} views (+{views_delta:,}), '
                f'{stat["likes"]:,} likes (+{likes_delta:,}), '
                f'{stat["comments"]:,} comments')

    # CSV 기록
    if csv_rows:
        append_to_csv(csv_rows)
        log(f'Appended {len(csv_rows)} rows to mv_curves.csv')

    if completed_count:
        log(f'{completed_count} MV(s) marked as completed (>30 days).')

    # 다음 체크까지 최소 대기시간 재계산
    min_wait_sec = float('inf')
    for vid, entry in tracking.items():
        if entry.get('status') != 'active':
            continue
        days = compute_days_since_release(entry['published'])
        interval_h = get_interval_hours(days)
        if interval_h is None:
            continue
        snapshots = entry.get('snapshots', [])
        if not snapshots:
            min_wait_sec = 0
            break
        try:
            last_ts = datetime.strptime(snapshots[-1]['timestamp'], '%Y-%m-%d %H:%M')
            elapsed_h = (now - last_ts).total_seconds() / 3600.0
            remaining = max(0, (interval_h - elapsed_h) * 3600)
            min_wait_sec = min(min_wait_sec, remaining)
        except ValueError:
            min_wait_sec = 0
            break

    if min_wait_sec == float('inf'):
        min_wait_sec = 3600  # 활성 MV 없으면 1시간

    return changed, min_wait_sec


def print_summary(tracking):
    """현재 추적 현황 요약 출력."""
    active = [(vid, e) for vid, e in tracking.items() if e.get('status') == 'active']
    completed = [(vid, e) for vid, e in tracking.items() if e.get('status') == 'completed']

    log(f'=== Tracking Summary ===')
    log(f'  Active:    {len(active)} MVs')
    log(f'  Completed: {len(completed)} MVs')

    if active:
        log(f'  --- Active MVs ---')
        for vid, entry in active:
            days = compute_days_since_release(entry['published'])
            interval = get_interval_hours(days)
            snaps = len(entry.get('snapshots', []))
            latest_views = entry['snapshots'][-1]['views'] if entry.get('snapshots') else 0
            log(f'    {entry["group"]:20s} | {entry["title"][:40]:40s} | '
                f'D+{days:3d} | {interval}h interval | '
                f'{snaps:3d} snaps | {latest_views:>14,} views')


def main():
    parser = argparse.ArgumentParser(
        description='Comeback MV Performance Monitor - '
                    'Tracks view growth curves after MV release'
    )
    parser.add_argument('--once', action='store_true',
                        help='Run a single check pass then exit (default: persistent loop)')
    parser.add_argument('--force', action='store_true',
                        help='Ignore interval checks, fetch all active MVs immediately')
    args = parser.parse_args()

    if not API_KEY:
        log('ERROR: Set GOOGLE_API_KEY or YOUTUBE_API_KEY environment variable.')
        sys.exit(1)

    log('=== Comeback MV Monitor Started ===')
    log(f'  Tracking file: {TRACKING_JSON}')
    log(f'  Curves CSV:    {MV_CURVES_CSV}')
    log(f'  Mode:          {"single-pass" if args.once else "persistent loop"}')
    log(f'  Force:         {args.force}')

    if args.once:
        # ── Single-pass mode ──
        tracking = load_tracking()
        if not tracking:
            log('No MVs in tracking.json. Run youtube_daily.py first to detect comebacks.')
            return

        print_summary(tracking)
        changed, _ = run_check(tracking, force=args.force)
        if changed:
            save_tracking(tracking)
            log('tracking.json updated.')
        log('=== Single pass complete ===')
    else:
        # ── Persistent loop mode ──
        while True:
            try:
                tracking = load_tracking()
                if not tracking:
                    log('No MVs in tracking.json. Waiting 1 hour...')
                    time.sleep(3600)
                    continue

                print_summary(tracking)
                changed, wait_sec = run_check(tracking, force=args.force)
                if changed:
                    save_tracking(tracking)
                    log('tracking.json updated.')

                # Force 플래그는 첫 사이클에만 적용
                if args.force:
                    args.force = False

                # 최소 60초, 최대 24시간 대기
                wait_sec = max(60, min(wait_sec, 86400))
                wake_time = datetime.now() + timedelta(seconds=wait_sec)
                log(f'Sleeping {wait_sec / 60:.0f} min. Next wake: {wake_time.strftime("%Y-%m-%d %H:%M")}')
                log('')
                time.sleep(wait_sec)

            except KeyboardInterrupt:
                log('Interrupted by user. Exiting.')
                break
            except Exception as e:
                log(f'ERROR: {e}')
                log('Retrying in 5 minutes...')
                time.sleep(300)


if __name__ == '__main__':
    main()
