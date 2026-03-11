#!/usr/bin/env python3
"""YouTube Engagement 크롤러 — YouTube Data API v3 기반
K-POP 아이돌 그룹의 유튜브 영상별 조회수/인게이지먼트 수집.
쇼츠 제외, 최근 1개월, Gemini AI 영상 분류, 컴백 사이클 감지.
"""
import sys, os, io
# UTF-8 stdout wrapper (Windows CP949 문제 방지)
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import json, re, time, argparse, math, logging
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse, unquote
from pathlib import Path

# ── 경로 설정 ──
BASE_DIR = Path(__file__).resolve().parent.parent  # idol-sns-app/
DATA_DIR = BASE_DIR / "data"
LOG_FILE = BASE_DIR / "07.youtube" / "progress.log"

# ── 로깅 설정 (파일 + 콘솔) ──
logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8", mode="w"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger(__name__)
CHANNELS_FILE = DATA_DIR / "youtube-channels.json"  # 채널 ID 캐시
OUTPUT_FILE = DATA_DIR / "youtube-engagement.json"   # 출력 데이터
META_FEMALE = DATA_DIR / "metadata-female.json"
META_MALE = DATA_DIR / "metadata-male.json"

# ── API 설정 ──
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "")
YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
GEMINI_MODEL = "gemini-3-flash-preview"

# ── 영상 분류 카테고리 ──
VIDEO_CATEGORIES = [
    "MV", "MV_Teaser", "Dance_Practice", "Performance", "Behind",
    "Variety", "Vlog", "Music_Show", "Live_Concert", "Interview",
    "Cover", "Album_Preview", "Concept_Teaser", "Other"
]

# ── 키워드 기반 분류 폴백 (Gemini 미사용 시) ──
KEYWORD_RULES = [
    (r"(?i)\bM/?V\b|Music\s*Video|뮤직비디오", "MV"),
    (r"(?i)teaser|예고|트레일러|trailer", "MV_Teaser"),
    (r"(?i)dance\s*practice|안무\s*영상|choreography", "Dance_Practice"),
    (r"(?i)performance|퍼포먼스|교차편집|stage\s*mix", "Performance"),
    (r"(?i)behind|비하인드|making|메이킹|jacket", "Behind"),
    (r"(?i)going|달려라|자체\s*예능|game|게임|challenge", "Variety"),
    (r"(?i)vlog|브이로그|diary|일기", "Vlog"),
    (r"(?i)음악방송|엠카|뮤뱅|인기가요|music\s*(bank|core|show)", "Music_Show"),
    (r"(?i)concert|콘서트|fan\s*meeting|팬미팅|live\s*tour", "Live_Concert"),
    (r"(?i)interview|인터뷰", "Interview"),
    (r"(?i)cover|커버", "Cover"),
    (r"(?i)highlight|하이라이트|medley|메들리|preview|미리듣기", "Album_Preview"),
    (r"(?i)concept|콘셉트|film|필름", "Concept_Teaser"),
]


def load_metadata(group_filter=None):
    """metadata-female/male.json에서 그룹 목록 로드"""
    groups = []
    for meta_path, gender in [(META_FEMALE, "여자"), (META_MALE, "남자")]:
        with open(meta_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        for g in data["data"]:
            yt = g.get("youtube_link", "").strip()
            if not yt:
                continue
            entry = {
                "name": g["name"],
                "group": g["group"],
                "gender": gender,
                "youtube_link": yt,
                "label": g.get("label", ""),
                "debut_year": g.get("debut_year", 0),
            }
            # 필터 적용 (--group 옵션)
            if group_filter:
                if g["group"].lower() != group_filter.lower() and g["name"] != group_filter:
                    continue
            groups.append(entry)
    log.info(f"[메타데이터] {len(groups)}개 그룹 로드")
    return groups


def _youtube_api(endpoint, params):
    """YouTube Data API v3 호출 (urllib 사용, 한글 파라미터 안전 인코딩)"""
    import urllib.request, urllib.error, urllib.parse
    params["key"] = GOOGLE_API_KEY
    query = urllib.parse.urlencode(params)  # 한글 등 비ASCII 안전 인코딩
    url = f"{YOUTUBE_API_BASE}/{endpoint}?{query}"
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        log.info(f"  [API 에러] {e.code}: {body[:300]}")
        return None
    except Exception as e:
        log.info(f"  [요청 에러] {e}")
        return None


def _parse_youtube_url(url):
    """YouTube URL에서 handle/channel_id/username/directname 파싱"""
    parsed = urlparse(url)
    path = parsed.path.rstrip("/")
    # /featured 등 불필요한 접미사 제거
    path = re.sub(r"/(featured|about|videos|shorts|streams|playlists|community)$", "", path)
    # /@handle 형식
    if path.startswith("/@"):
        return ("handle", path[2:])
    # /channel/UCxxx 형식
    m = re.match(r"/channel/(UC[\w-]+)", path)
    if m:
        return ("channel_id", m.group(1))
    # /c/name 형식
    m = re.match(r"/c/(.+)", path)
    if m:
        return ("username", unquote(m.group(1)))
    # /directname 형식
    if path.startswith("/") and len(path) > 1:
        return ("handle", path[1:])  # handle로 시도
    return ("unknown", url)


def resolve_channel_ids(groups):
    """YouTube API로 채널 ID 해석 → youtube-channels.json 캐시"""
    # 기존 캐시 로드
    cache = {}
    if CHANNELS_FILE.exists():
        with open(CHANNELS_FILE, "r", encoding="utf-8") as f:
            existing = json.load(f)
        for ch in existing:
            cache[ch["group"]] = ch

    resolved = []
    new_count = 0
    for g in groups:
        # 캐시 히트
        if g["group"] in cache:
            resolved.append(cache[g["group"]])
            continue

        url_type, value = _parse_youtube_url(g["youtube_link"])
        channel_id = None

        if url_type == "channel_id":
            channel_id = value
        elif url_type == "handle":
            # forHandle API 호출
            data = _youtube_api("channels", {
                "part": "id,snippet,statistics",
                "forHandle": value,
            })
            if data and data.get("items"):
                channel_id = data["items"][0]["id"]
            else:
                # forUsername 폴백
                data = _youtube_api("channels", {
                    "part": "id,snippet,statistics",
                    "forUsername": value,
                })
                if data and data.get("items"):
                    channel_id = data["items"][0]["id"]
        elif url_type == "username":
            data = _youtube_api("channels", {
                "part": "id,snippet,statistics",
                "forUsername": value,
            })
            if data and data.get("items"):
                channel_id = data["items"][0]["id"]
            else:
                # forHandle 폴백
                data = _youtube_api("channels", {
                    "part": "id,snippet,statistics",
                    "forHandle": value,
                })
                if data and data.get("items"):
                    channel_id = data["items"][0]["id"]

        # 최종 폴백: search.list (100 units 소모, 최후의 수단)
        if not channel_id:
            search_query = f"{g['name']} {g['group']} official youtube"
            data = _youtube_api("search", {
                "part": "snippet",
                "q": search_query,
                "type": "channel",
                "maxResults": 1,
            })
            if data and data.get("items"):
                channel_id = data["items"][0]["snippet"]["channelId"]
                log.info(f"  [검색 폴백] {g['name']} → {channel_id}")

        if not channel_id:
            log.info(f"  [경고] 채널 해석 실패: {g['name']} ({g['youtube_link']})")
            continue

        # 구독자 수 조회 (이미 snippet,statistics 포함된 경우)
        sub_count = 0
        if url_type == "channel_id":
            # channel_id 직접 추출한 경우 별도 조회
            data = _youtube_api("channels", {
                "part": "snippet,statistics",
                "id": channel_id,
            })
            if data and data.get("items"):
                sub_count = int(data["items"][0].get("statistics", {}).get("subscriberCount", 0))
        elif data and data.get("items"):
            sub_count = int(data["items"][0].get("statistics", {}).get("subscriberCount", 0))

        # uploads playlist = UC → UU 교체
        uploads_playlist = "UU" + channel_id[2:]

        entry = {
            "name": g["name"],
            "group": g["group"],
            "gender": g["gender"],
            "channel_id": channel_id,
            "uploads_playlist": uploads_playlist,
            "subscriber_count": sub_count,
            "label": g.get("label", ""),
            "debut_year": g.get("debut_year", 0),
        }
        resolved.append(entry)
        new_count += 1
        log.info(f"  [해석] {g['name']} → {channel_id} (구독자: {sub_count:,})")
        time.sleep(0.1)  # API 속도 제한 방지

    # 캐시 저장
    with open(CHANNELS_FILE, "w", encoding="utf-8") as f:
        json.dump(resolved, f, ensure_ascii=False, indent=2)
    log.info(f"[채널 해석] 총 {len(resolved)}개 ({new_count}개 신규) → {CHANNELS_FILE.name}")
    return resolved


def _parse_duration(duration_str):
    """ISO 8601 duration 파싱 (PT3M42S → 222초)"""
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", duration_str or "")
    if not m:
        return 0
    h, mi, s = (int(x) if x else 0 for x in m.groups())
    return h * 3600 + mi * 60 + s


def _check_is_short(video_id):
    """YouTube /shorts/ URL 체크로 쇼츠 여부 판별.
    쇼츠면 True, 일반 영상이면 False 반환."""
    import urllib.request, urllib.error
    url = f"https://www.youtube.com/shorts/{video_id}"
    req = urllib.request.Request(url, method="HEAD")
    req.add_header("User-Agent", "Mozilla/5.0")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            # /shorts/ URL에 머무르면 쇼츠, /watch?v= 리다이렉트면 일반
            return "/shorts/" in resp.url
    except urllib.error.HTTPError as e:
        if e.code == 303 or e.code == 302 or e.code == 301:
            # 리다이렉트 = 일반 영상
            location = e.headers.get("Location", "")
            return "/shorts/" in location
        return False
    except Exception:
        return False


def _batch_check_shorts(video_ids):
    """여러 영상의 쇼츠 여부를 배치 체크. {video_id: bool} 반환."""
    import concurrent.futures
    results = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(_check_is_short, vid): vid for vid in video_ids}
        for future in concurrent.futures.as_completed(futures):
            vid = futures[future]
            try:
                results[vid] = future.result()
            except Exception:
                results[vid] = False
    return results


def fetch_recent_videos(channels, days=30, save_callback=None):
    """각 채널의 최근 N일 영상 수집 (쇼츠 필터링 포함)"""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    all_groups = []
    total = len(channels)

    for ch_idx, ch in enumerate(channels, 1):
        # playlistItems.list — 최근 영상 ID 수집
        video_ids = []
        page_token = None
        stop = False

        while not stop:
            params = {
                "part": "snippet,contentDetails",
                "playlistId": ch["uploads_playlist"],
                "maxResults": 50,
            }
            if page_token:
                params["pageToken"] = page_token

            data = _youtube_api("playlistItems", params)
            if not data or not data.get("items"):
                break

            for item in data["items"]:
                pub = item["snippet"].get("publishedAt", "")
                if pub:
                    pub_dt = datetime.fromisoformat(pub.replace("Z", "+00:00"))
                    if pub_dt < cutoff:
                        stop = True  # 이전 영상 → 더 이상 조회 불필요
                        break
                vid_id = item["contentDetails"].get("videoId")
                if vid_id:
                    video_ids.append(vid_id)

            page_token = data.get("nextPageToken")
            if not page_token:
                break

        if not video_ids:
            log.info(f"  [{ch['name']}] 최근 {days}일 영상 없음")
            continue

        # videos.list — 상세 정보 배치 조회 (50개씩)
        videos = []
        shorts_check_queue = []  # (item_dict, video_id) — 3분 이하 영상 쇼츠 체크 대기
        for i in range(0, len(video_ids), 50):
            batch = video_ids[i:i+50]
            data = _youtube_api("videos", {
                "part": "snippet,contentDetails,statistics",
                "id": ",".join(batch),
            })
            if not data or not data.get("items"):
                continue
            for item in data["items"]:
                dur = _parse_duration(item["contentDetails"].get("duration", ""))
                title = item["snippet"].get("title", "")
                stats = item.get("statistics", {})
                views = int(stats.get("viewCount", 0))
                likes = int(stats.get("likeCount", 0))
                comments = int(stats.get("commentCount", 0))

                vid_data = {
                    "video_id": item["id"],
                    "title": title,
                    "published_at": item["snippet"].get("publishedAt", ""),
                    "duration_seconds": dur,
                    "views": views,
                    "likes": likes,
                    "comments": comments,
                    "like_ratio": round(likes / views, 4) if views > 0 else 0,
                    "comment_ratio": round(comments / views, 4) if views > 0 else 0,
                    "tags": item["snippet"].get("tags", [])[:10],
                }

                # 3분(180초) 이하 → 쇼츠 여부 확인 필요
                if dur <= 180:
                    shorts_check_queue.append(vid_data)
                else:
                    # 3분 초과 → 무조건 일반 영상
                    videos.append(vid_data)

        # 3분 이하 영상 쇼츠 배치 체크 (병렬 HTTP)
        shorts_filtered = 0
        if shorts_check_queue:
            check_ids = [v["video_id"] for v in shorts_check_queue]
            is_short_map = _batch_check_shorts(check_ids)
            for vid_data in shorts_check_queue:
                if is_short_map.get(vid_data["video_id"], False):
                    shorts_filtered += 1  # 쇼츠 → 제외
                else:
                    videos.append(vid_data)  # 일반 영상 → 포함

        log.info(f"  [{ch_idx}/{total}] [{ch['name']}] {len(video_ids)}개 발견 → {len(videos)}개 수집 (쇼츠 {shorts_filtered}개 제외)")
        all_groups.append({
            "channel": ch,
            "videos": videos,
        })

        # 10그룹마다 중간 저장
        if save_callback and ch_idx % 10 == 0:
            save_callback(all_groups)
            log.info(f"  [중간 저장] {ch_idx}/{total} 완료")

    return all_groups


def classify_by_keywords(title):
    """키워드 기반 영상 분류 (Gemini 폴백용)"""
    for pattern, category in KEYWORD_RULES:
        if re.search(pattern, title):
            return category
    return "Other"


def _repair_json(text):
    """절삭된 JSON 배열 복구 시도"""
    text = text.strip()
    # 마지막 완전한 오브젝트까지만 파싱
    if text.startswith("[") and not text.endswith("]"):
        # 마지막 }, 찾아서 거기까지 자르고 ] 추가
        last_brace = text.rfind("}")
        if last_brace > 0:
            text = text[:last_brace + 1] + "]"
    return text


def _build_classify_prompt(videos_batch):
    """Gemini 분류용 프롬프트 생성"""
    lines = []
    for idx, v in enumerate(videos_batch, 1):
        mins = v["duration"] // 60
        secs = v["duration"] % 60
        lines.append(f'{idx}. [{v["id"]}] "{v["title"]}" | {mins}분{secs}초')
    return f"""아래 K-POP 유튜브 영상 목록을 카테고리로 분류하세요.
카테고리: {', '.join(VIDEO_CATEGORIES)}

또한 각 영상이 컴백 프로모션 콘텐츠인지(is_comeback: true/false),
광고 집행 가능성이 높은 콘텐츠인지(likely_promoted: true/false) 판별.

JSON 배열만 출력 (다른 텍스트 없이):
[{{"id":"video_id","type":"MV","is_comeback":true,"likely_promoted":true}}]

영상 목록:
{chr(10).join(lines)}"""


def _parse_classify_response(text, batch_videos, results):
    """Gemini 분류 응답 파싱 → results dict에 추가, 성공 수 반환"""
    try:
        classified = json.loads(text)
    except json.JSONDecodeError:
        text = _repair_json(text)
        classified = json.loads(text)
    count = 0
    for item in classified:
        vid_id = item.get("id", "")
        results[vid_id] = {
            "video_type": item.get("type", "Other"),
            "is_comeback_content": item.get("is_comeback", False),
            "likely_promoted": item.get("likely_promoted", False),
        }
        count += 1
    return count


def classify_videos_gemini(all_videos):
    """Gemini AI로 영상 분류. ≤200개: sync API / >200개: Batch API (50% 비용 절감)"""
    if not all_videos:
        return {}

    results = {}
    batch_size = 30  # 각 프롬프트에 30개 영상

    # Batch API가 PENDING 상태에서 지연되는 문제 → 항상 sync 사용
    # Batch API는 --use-batch 플래그로만 활성화
    return _classify_sync(all_videos, results, batch_size)


def _classify_sync(all_videos, results, batch_size):
    """Sync API로 분류 (소량용)"""
    import urllib.request
    success_count = 0
    fail_count = 0

    for i in range(0, len(all_videos), batch_size):
        batch = all_videos[i:i+batch_size]
        batch_num = i // batch_size + 1
        prompt = _build_classify_prompt(batch)

        url = f"{GEMINI_API_BASE}/{GEMINI_MODEL}:generateContent?key={GOOGLE_API_KEY}"
        body = json.dumps({
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.1,
                "maxOutputTokens": 8192,
                "responseMimeType": "application/json",
            }
        }).encode("utf-8")

        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                resp_data = json.loads(resp.read().decode("utf-8"))
            text = resp_data["candidates"][0]["content"]["parts"][0]["text"]
            count = _parse_classify_response(text, batch, results)
            success_count += count
            if batch_num % 10 == 0 or batch_num == 1:
                log.info(f"  [Gemini sync] 배치 {batch_num}: {count}개 ({success_count}/{len(all_videos)})")
        except Exception as e:
            log.info(f"  [Gemini 에러] 배치 {batch_num}: {e}")
            fail_count += len(batch)
            for v in batch:
                results[v["id"]] = {
                    "video_type": classify_by_keywords(v["title"]),
                    "is_comeback_content": False,
                    "likely_promoted": False,
                }
        time.sleep(0.5)

    log.info(f"  [Gemini sync] 완료: {success_count}개 AI, {fail_count}개 폴백")
    return results


def _classify_batch(all_videos, results, batch_size):
    """Batch API로 분류 (대량용, 50% 비용 절감)"""
    from google import genai

    client = genai.Client(api_key=GOOGLE_API_KEY)

    # 배치별 프롬프트 → inline requests 생성
    inline_requests = []
    batch_map = {}  # index → video list

    for i in range(0, len(all_videos), batch_size):
        batch = all_videos[i:i+batch_size]
        prompt = _build_classify_prompt(batch)
        inline_requests.append({
            "contents": [{"parts": [{"text": prompt}], "role": "user"}],
            "config": {
                "response_mime_type": "application/json",
                "temperature": 0.1,
                "max_output_tokens": 8192,
            }
        })
        batch_map[len(inline_requests) - 1] = batch

    total_requests = len(inline_requests)
    log.info(f"  [Batch API] {len(all_videos)}개 영상 → {total_requests}개 요청")

    # Batch Job 생성
    batch_job = client.batches.create(
        model=GEMINI_MODEL,
        src=inline_requests,
        config={"display_name": f"yt-classify-{datetime.now().strftime('%m%d-%H%M')}"},
    )
    job_name = batch_job.name
    log.info(f"  [Batch API] Job 생성: {job_name}")

    # 완료 대기 (폴링, 최대 30분 → 초과 시 sync 폴백)
    MAX_WAIT = 1800  # 30분
    completed_states = {"JOB_STATE_SUCCEEDED", "JOB_STATE_FAILED", "JOB_STATE_CANCELLED", "JOB_STATE_EXPIRED"}
    poll_count = 0
    while True:
        batch_job = client.batches.get(name=job_name)
        state = batch_job.state.name
        if state in completed_states:
            break
        poll_count += 1
        elapsed = poll_count * 30
        if elapsed >= MAX_WAIT:
            log.info(f"  [Batch API] {MAX_WAIT}초 타임아웃 → sync 폴백 전환")
            return _classify_sync(all_videos, results, batch_size)
        if poll_count % 2 == 0:
            log.info(f"  [Batch API] 대기 중... ({state}, {elapsed}초/{MAX_WAIT}초)")
        time.sleep(30)

    log.info(f"  [Batch API] Job 상태: {state}")

    if state != "JOB_STATE_SUCCEEDED":
        log.info(f"  [Batch API] 실패 → sync 폴백 전환")
        return _classify_sync(all_videos, results, batch_size)

    # 결과 파싱
    success_count = 0
    fail_count = 0
    if batch_job.dest and batch_job.dest.inlined_responses:
        for idx, inline_resp in enumerate(batch_job.dest.inlined_responses):
            batch_videos = batch_map.get(idx, [])
            if inline_resp.response:
                try:
                    text = inline_resp.response.text
                    count = _parse_classify_response(text, batch_videos, results)
                    success_count += count
                except Exception as e:
                    log.info(f"  [파싱 에러] 배치 {idx+1}: {e}")
                    fail_count += len(batch_videos)
                    for v in batch_videos:
                        results[v["id"]] = {
                            "video_type": classify_by_keywords(v["title"]),
                            "is_comeback_content": False,
                            "likely_promoted": False,
                        }
            else:
                fail_count += len(batch_videos)
                for v in batch_videos:
                    results[v["id"]] = {
                        "video_type": classify_by_keywords(v["title"]),
                        "is_comeback_content": False,
                        "likely_promoted": False,
                    }

    log.info(f"  [Batch API] 완료: {success_count}개 AI, {fail_count}개 폴백")
    return results


def detect_comeback_periods(videos):
    """MV 업로드 기준 컴백 기간 감지 → (mv_date, start, end) 리스트 반환"""
    mv_dates = []
    for v in videos:
        vtype = v.get("video_type", "")
        if vtype == "MV":
            pub = v.get("published_at", "")
            if pub:
                dt = datetime.fromisoformat(pub.replace("Z", "+00:00"))
                mv_dates.append(dt)
    # 컴백 기간: MV 기준 D-14 ~ D+30
    periods = []
    for mv_dt in mv_dates:
        periods.append({
            "mv_date": mv_dt,
            "start": mv_dt - timedelta(days=14),
            "end": mv_dt + timedelta(days=30),
        })
    return periods


def tag_comeback_phase(video, comeback_periods):
    """각 영상에 컴백 단계 태깅"""
    pub = video.get("published_at", "")
    if not pub:
        return "non_comeback", None
    vid_dt = datetime.fromisoformat(pub.replace("Z", "+00:00"))

    for period in comeback_periods:
        mv_dt = period["mv_date"]
        if period["start"] <= vid_dt <= period["end"]:
            delta = (vid_dt - mv_dt).days
            if delta < -7:
                return "pre_comeback", delta
            elif delta <= 0:
                return "comeback_week", delta
            elif delta <= 7:
                return "first_week", delta
            elif delta <= 14:
                return "second_week", delta
            else:
                return "post_comeback", delta
    return "non_comeback", None


def calculate_stats(videos):
    """그룹별 통계 산출"""
    if not videos:
        return {}

    mv_views = sum(v["views"] for v in videos if v.get("video_type") == "MV")
    non_mv_views = sum(v["views"] for v in videos if v.get("video_type") != "MV")
    total_views = mv_views + non_mv_views

    # 타입별 카운트
    types = {}
    for v in videos:
        t = v.get("video_type", "Other")
        types[t] = types.get(t, 0) + 1

    # 좋아요/댓글 비율 평균
    like_ratios = [v["like_ratio"] for v in videos if v["views"] > 0]
    comment_ratios = [v["comment_ratio"] for v in videos if v["views"] > 0]

    # 팬덤 인덱스: 광고 제외 영상(Dance_Practice, Behind, Variety)의 평균 조회수
    fandom_types = {"Dance_Practice", "Behind", "Variety", "Vlog"}
    fandom_videos = [v for v in videos if v.get("video_type") in fandom_types]
    fandom_index = (
        round(sum(v["views"] for v in fandom_videos) / len(fandom_videos))
        if fandom_videos else 0
    )

    return {
        "total_videos": len(videos),
        "total_views": total_views,
        "mv_views": mv_views,
        "non_mv_views": non_mv_views,
        "bubble_ratio": round(non_mv_views / mv_views, 3) if mv_views > 0 else 0,
        "avg_like_ratio": round(sum(like_ratios) / len(like_ratios), 4) if like_ratios else 0,
        "avg_comment_ratio": round(sum(comment_ratios) / len(comment_ratios), 4) if comment_ratios else 0,
        "fandom_index": fandom_index,
        "types": types,
    }


def build_output(groups_data, days):
    """최종 JSON 구조 생성"""
    now = datetime.now(timezone(timedelta(hours=9)))  # KST
    start_date = (now - timedelta(days=days)).strftime("%Y-%m-%d")
    end_date = now.strftime("%Y-%m-%d")

    total_videos = sum(len(g["videos"]) for g in groups_data)
    output_groups = []

    for g in groups_data:
        ch = g["channel"]
        videos = g["videos"]
        stats = calculate_stats(videos)

        output_groups.append({
            "name": ch["name"],
            "group": ch["group"],
            "gender": ch["gender"],
            "channel_id": ch["channel_id"],
            "subscriber_count": ch.get("subscriber_count", 0),
            "videos": videos,
            "stats": stats,
        })

    # 구독자 수 내림차순 정렬
    output_groups.sort(key=lambda x: x["subscriber_count"], reverse=True)

    return {
        "generated": now.isoformat(),
        "period": {"start": start_date, "end": end_date},
        "total_groups": len(output_groups),
        "total_videos": total_videos,
        "groups": output_groups,
    }


def save_output(output):
    """data/youtube-engagement.json 저장"""
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    size_kb = OUTPUT_FILE.stat().st_size / 1024
    log.info(f"\n[저장] {OUTPUT_FILE.name} ({size_kb:.1f}KB)")
    log.info(f"  그룹: {output['total_groups']}개, 영상: {output['total_videos']}개")


def main():
    parser = argparse.ArgumentParser(description="YouTube Engagement 크롤러")
    parser.add_argument("--resolve-channels", action="store_true",
                        help="채널 ID 최초 해석 (1회만 실행)")
    parser.add_argument("--group", type=str, default=None,
                        help="특정 그룹만 테스트 (예: aespa)")
    parser.add_argument("--days", type=int, default=365,
                        help="수집 기간 (기본 365일)")
    parser.add_argument("--force", action="store_true",
                        help="기존 데이터 무시하고 전체 재수집")
    parser.add_argument("--no-ai-classify", action="store_true",
                        help="Gemini 분류 스킵 (키워드 기반 폴백)")
    args = parser.parse_args()

    if not GOOGLE_API_KEY:
        log.info("[에러] GOOGLE_API_KEY 환경변수를 설정하세요.")
        sys.exit(1)

    log.info(f"=== YouTube Engagement 크롤러 ===")
    log.info(f"  기간: 최근 {args.days}일")
    if args.group:
        log.info(f"  대상: {args.group}")
    log.info("")

    # Step 1: 메타데이터 로드
    groups = load_metadata(group_filter=args.group)
    if not groups:
        log.info("[에러] 대상 그룹이 없습니다.")
        sys.exit(1)

    # Step 2: 채널 ID 해석
    if args.resolve_channels or not CHANNELS_FILE.exists():
        log.info("\n[Step 2] 채널 ID 해석...")
        channels = resolve_channel_ids(groups)
    else:
        # 캐시에서 로드 + 필터
        with open(CHANNELS_FILE, "r", encoding="utf-8") as f:
            all_channels = json.load(f)
        if args.group:
            channels = [c for c in all_channels
                        if c["group"].lower() == args.group.lower()
                        or c["name"] == args.group]
        else:
            channels = all_channels
        log.info(f"[채널 캐시] {len(channels)}개 로드")

    if not channels:
        log.info("[에러] 해석된 채널이 없습니다.")
        sys.exit(1)

    # 기존 데이터 로드 (이미 수집된 그룹 스킵용)
    existing_groups = {}  # group_name → group_data
    if OUTPUT_FILE.exists():
        try:
            with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
                existing = json.load(f)
            for g in existing.get("groups", []):
                existing_groups[g["group"]] = g
            log.info(f"[기존 데이터] {len(existing_groups)}개 그룹 로드")
        except Exception:
            pass

    # 이미 수집된 그룹 제외 (--force 시: 특정 그룹만 재수집, 나머지 보존)
    channels_to_fetch = []
    for ch in channels:
        if args.force:
            # --force: 대상 그룹은 기존 데이터에서 제거 후 재수집
            existing_groups.pop(ch["group"], None)
            channels_to_fetch.append(ch)
        elif ch["group"] not in existing_groups:
            channels_to_fetch.append(ch)
    log.info(f"[수집 대상] {len(channels_to_fetch)}개 그룹 (기존 {len(existing_groups)}개 스킵)")

    # 중간 저장 콜백: 수집 중 10그룹마다 JSON 저장 (중단 시 데이터 보존)
    def _interim_save(partial_groups_data):
        now = datetime.now(timezone(timedelta(hours=9)))
        partial_output = build_output(partial_groups_data, args.days)
        # 기존 + 신규 병합
        merged = dict(existing_groups)
        for g in partial_output["groups"]:
            merged[g["group"]] = g
        all_merged = sorted(merged.values(), key=lambda x: x.get("subscriber_count", 0), reverse=True)
        interim = {
            "generated": now.isoformat(),
            "period": {"start": (now - timedelta(days=args.days)).strftime("%Y-%m-%d"), "end": now.strftime("%Y-%m-%d")},
            "total_groups": len(all_merged),
            "total_videos": sum(len(g.get("videos", [])) for g in all_merged),
            "groups": list(all_merged),
        }
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            json.dump(interim, f, ensure_ascii=False, indent=2)

    # Step 3-4: 최근 영상 수집 (쇼츠 자동 필터링)
    groups_data = []
    if channels_to_fetch:
        log.info(f"\n[Step 3] 최근 {args.days}일 영상 수집...")
        groups_data = fetch_recent_videos(channels_to_fetch, days=args.days, save_callback=_interim_save)

    # Step 5: 미분류 영상 수집 (기존 + 신규 모두)
    # 기존 데이터 중 미분류 영상도 포함
    unclassified_videos = []  # {"id", "title", "duration"} 리스트
    for g in existing_groups.values():
        for v in g.get("videos", []):
            if not v.get("video_type"):
                unclassified_videos.append({
                    "id": v["video_id"],
                    "title": v["title"],
                    "duration": v.get("duration_seconds", 0),
                })
    # 신규 수집분
    for g in groups_data:
        for v in g["videos"]:
            unclassified_videos.append({
                "id": v["video_id"],
                "title": v["title"],
                "duration": v["duration_seconds"],
            })

    if unclassified_videos:
        if not args.no_ai_classify:
            log.info(f"\n[Step 5] Gemini AI 영상 분류 ({len(unclassified_videos)}개 미분류)...")
            classifications = classify_videos_gemini(unclassified_videos)
        else:
            log.info(f"\n[Step 5] 키워드 기반 분류 ({len(unclassified_videos)}개)...")
            classifications = {}
            for v in unclassified_videos:
                classifications[v["id"]] = {
                    "video_type": classify_by_keywords(v["title"]),
                    "is_comeback_content": False,
                    "likely_promoted": False,
                }

        # 분류 결과 적용: 기존 데이터
        for g in existing_groups.values():
            for v in g.get("videos", []):
                if not v.get("video_type"):
                    cls = classifications.get(v["video_id"], {})
                    v["video_type"] = cls.get("video_type", classify_by_keywords(v["title"]))
                    v["is_comeback_content"] = cls.get("is_comeback_content", False)
                    v["likely_promoted"] = cls.get("likely_promoted", False)
        # 분류 결과 적용: 신규 데이터
        for g in groups_data:
            for v in g["videos"]:
                cls = classifications.get(v["video_id"], {})
                v["video_type"] = cls.get("video_type", classify_by_keywords(v["title"]))
                v["is_comeback_content"] = cls.get("is_comeback_content", False)
                v["likely_promoted"] = cls.get("likely_promoted", False)
    else:
        log.info(f"\n[Step 5] 분류할 영상 없음 (모두 분류 완료)")

    # Step 6: 컴백 기간 감지 + 태깅 (기존 미처리 + 신규)
    log.info(f"\n[Step 6] 컴백 기간 감지...")
    for g in existing_groups.values():
        if any(not v.get("comeback_phase") for v in g.get("videos", [])):
            comeback_periods = detect_comeback_periods(g["videos"])
            for v in g["videos"]:
                if not v.get("comeback_phase"):
                    phase, delta = tag_comeback_phase(v, comeback_periods)
                    v["comeback_phase"] = phase
                    v["days_from_mv"] = delta
    for g in groups_data:
        comeback_periods = detect_comeback_periods(g["videos"])
        for v in g["videos"]:
            phase, delta = tag_comeback_phase(v, comeback_periods)
            v["comeback_phase"] = phase
            v["days_from_mv"] = delta

    # Step 7: 기존 데이터 병합 + 통계 재산출 + 저장
    log.info(f"\n[Step 7] 통계 산출 및 저장...")

    # 신규 수집분을 build_output 형태로 변환
    new_output = build_output(groups_data, args.days) if groups_data else {"groups": []}

    # 기존 그룹 통계 재산출
    for g in existing_groups.values():
        g["stats"] = calculate_stats(g.get("videos", []))

    # 기존 그룹 + 신규 그룹 병합
    merged_groups_map = {}
    for g in existing_groups.values():
        merged_groups_map[g["group"]] = g
    for g in new_output["groups"]:
        merged_groups_map[g["group"]] = g

    # 최종 출력 생성
    now = datetime.now(timezone(timedelta(hours=9)))
    all_merged = list(merged_groups_map.values())
    all_merged.sort(key=lambda x: x.get("subscriber_count", 0), reverse=True)
    total_videos = sum(len(g.get("videos", [])) for g in all_merged)

    final_output = {
        "generated": now.isoformat(),
        "period": {"start": (now - timedelta(days=args.days)).strftime("%Y-%m-%d"), "end": now.strftime("%Y-%m-%d")},
        "total_groups": len(all_merged),
        "total_videos": total_videos,
        "groups": all_merged,
    }
    save_output(final_output)

    # 요약 출력
    log.info(f"\n=== 완료 ===")
    for g in final_output["groups"]:
        s = g["stats"]
        types_str = ", ".join(f"{k}:{v}" for k, v in sorted(s.get("types", {}).items()))
        log.info(f"  {g['name']} ({g['group']}): {s['total_videos']}개 영상, "
              f"조회수 {s['total_views']:,}, 거품비율 {s.get('bubble_ratio', 0):.3f}")
        log.info(f"    유형: {types_str}")
        log.info(f"    좋아요율: {s['avg_like_ratio']:.4f}, 댓글율: {s['avg_comment_ratio']:.4f}, "
              f"팬덤지수: {s['fandom_index']:,}")


if __name__ == "__main__":
    main()
