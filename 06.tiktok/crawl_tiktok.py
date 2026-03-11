#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys, io
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
"""
crawl_tiktok.py — ADB + uiautomator2 기반 TikTok 아이돌 그룹 크롤링

수집 항목:
  프로필: 팔로워, 팔로잉, 좋아요 합계, 인증 여부, bio
  게시물 (최근 1개월): 조회수, 좋아요, 댓글, 공유, 저장, URL, 날짜, 캡션, 분류

사용법:
  python crawl_tiktok.py                    # 전체 그룹
  python crawl_tiktok.py --test 에스파,BTS   # 테스트
  python crawl_tiktok.py --resume            # 중단 지점부터 재개
  python crawl_tiktok.py --profile-only      # 프로필만 수집
  python crawl_tiktok.py --max-groups 10     # 최대 N개
"""

import argparse
import json
import logging
import os
import re
import subprocess
import time
from datetime import datetime, timedelta
from pathlib import Path

# ─── 경로 설정 ────────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
DATA_DIR = PROJECT_DIR / "data"
NAMU_JSON = DATA_DIR / "namu-wiki.json"
TIKTOK_DIR = DATA_DIR / "tiktok-data"
GROUPS_DIR = TIKTOK_DIR / "groups"
SUMMARY_FILE = TIKTOK_DIR / "tiktok-summary.json"
PROGRESS_FILE = TIKTOK_DIR / "crawl-progress.json"

GROUPS_DIR.mkdir(parents=True, exist_ok=True)

# ─── ADB 설정 ─────────────────────────────────────────────────────────────────
DEVICE = "R3CTC0CHJBT"  # Samsung S23
TIKTOK_PKG = "com.ss.android.ugc.trill"
SCREEN_W, SCREEN_H = 1440, 3088

# ─── 딜레이 (초) ──────────────────────────────────────────────────────────────
DELAY = {
    "tap": 0.8,
    "transition": 2.0,
    "profile_load": 4.0,
    "video_load": 3.0,
    "scroll": 1.0,
    "back": 1.0,
    "between_groups": 3.0,
    "swipe": 1.5,
}

# ─── 크롤링 설정 ──────────────────────────────────────────────────────────────
DAYS_BACK = 30
MAX_VIDEOS_PER_GROUP = 30
MAX_SCROLLS_PROFILE = 10

# ─── 로깅 ─────────────────────────────────────────────────────────────────────
LOG_DIR = SCRIPT_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)
log_file = LOG_DIR / f"crawl_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(log_file, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# 하드웨어 보호 설정 (OLED 번인 방지 / 메모리 누수 방지)
# ═══════════════════════════════════════════════════════════════════════════════

BRIGHTNESS_CRAWL = 20   # 크롤링 중 밝기 (OLED 번인 방지)
BRIGHTNESS_IDLE  = 0    # 대기 중 밝기

def device_setup():
    """크롤링 시작 전 디바이스 보호 설정"""
    # 충전 중 화면 꺼짐 방지 (AC=1 + USB=2 = 3)
    adb_host(f"shell settings put global stay_on_while_plugged_in 3")
    # OLED 밝기 낮추기 (번인 방지)
    adb_host(f"shell settings put system screen_brightness {BRIGHTNESS_CRAWL}")
    logger.info(f"  디바이스 보호 설정 완료 (stay_on=3, brightness={BRIGHTNESS_CRAWL})")


def device_idle():
    """크롤링 종료 시 화면 밝기 최소화 (대기 상태)"""
    adb_host(f"shell settings put system screen_brightness {BRIGHTNESS_IDLE}")
    logger.info(f"  대기 모드 전환 (brightness={BRIGHTNESS_IDLE})")


def tiktok_force_stop():
    """TikTok 강제 종료 — 그룹 간 메모리 누수 방지"""
    adb_host(f"shell am force-stop {TIKTOK_PKG}")
    time.sleep(1.5)


# ═══════════════════════════════════════════════════════════════════════════════
# ADB 헬퍼
# ═══════════════════════════════════════════════════════════════════════════════

def adb(cmd: str, timeout: int = 15) -> str:
    """ADB shell 명령 실행"""
    full = f'adb -s {DEVICE} shell "{cmd}"'
    try:
        r = subprocess.run(full, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip()
    except subprocess.TimeoutExpired:
        logger.warning(f"ADB timeout: {cmd[:60]}")
        return ""
    except Exception as e:
        logger.warning(f"ADB error: {e}")
        return ""


def adb_host(cmd: str, timeout: int = 15) -> str:
    """ADB 호스트 명령 실행"""
    full = f"adb -s {DEVICE} {cmd}"
    try:
        r = subprocess.run(full, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip()
    except Exception as e:
        logger.warning(f"ADB host error: {e}")
        return ""


def tap(x: int, y: int, label: str = ""):
    """화면 탭"""
    adb(f"input tap {x} {y}")
    if label:
        logger.debug(f"  tap({x},{y}) {label}")
    time.sleep(DELAY["tap"])


def swipe_up():
    """위로 스와이프 (다음 비디오)"""
    adb(f"input swipe 720 2200 720 800 300")
    time.sleep(DELAY["swipe"])


def swipe_down():
    """아래로 스와이프 (이전 비디오)"""
    adb(f"input swipe 720 800 720 2200 300")
    time.sleep(DELAY["swipe"])


def back():
    """뒤로가기"""
    adb("input keyevent 4")
    time.sleep(DELAY["back"])


def ensure_tiktok_foreground():
    """TikTok이 포그라운드인지 확인, 아니면 복귀"""
    fg = adb("dumpsys activity activities | grep mResumedActivity")
    if TIKTOK_PKG not in fg:
        logger.warning(f"  TikTok이 포그라운드 아님, 복귀 시도...")
        adb(f"monkey -p {TIKTOK_PKG} -c android.intent.category.LAUNCHER 1")
        time.sleep(2)


def get_ui_dump(pause_video: bool = False) -> str:
    """UI hierarchy XML 덤프

    pause_video=True: 영상 재생 중 idle 상태 확보를 위해 화면 탭(일시정지) 후 dump
    """
    if pause_video:
        # 영상 재생 중이면 uiautomator가 idle state를 얻지 못함
        # → 화면 중앙 탭으로 일시정지 후 dump
        adb(f"input tap {SCREEN_W // 2} {SCREEN_H // 2}")
        time.sleep(1.5)

    adb("rm -f /sdcard/tiktok_dump.xml")
    result = adb("uiautomator dump /sdcard/tiktok_dump.xml")

    # "could not get idle state" 에러 → 일시정지 재시도 (최대 2회)
    if "ERROR" in result or "error" in result:
        for retry in range(2):
            logger.warning(f"  UI dump 실패 ({result[:40]}), 일시정지 후 재시도 {retry+1}...")
            adb(f"input tap {SCREEN_W // 2} {SCREEN_H // 2}")
            time.sleep(2)
            adb("rm -f /sdcard/tiktok_dump.xml")
            result = adb("uiautomator dump /sdcard/tiktok_dump.xml")
            if "ERROR" not in result and "error" not in result:
                break

    # exec-out으로 파일 내용 직접 읽기
    full = f'adb -s {DEVICE} exec-out "cat /sdcard/tiktok_dump.xml"'
    try:
        r = subprocess.run(full, shell=True, capture_output=True, timeout=10)
        return r.stdout.decode("utf-8", errors="replace")
    except Exception as e:
        logger.warning(f"UI dump 실패: {e}")
        return ""


def parse_nodes(xml: str) -> list[dict]:
    """XML에서 노드 파싱"""
    nodes = []
    for match in re.finditer(r'<node[^>]+>', xml):
        n = match.group(0)
        node = {}
        for attr in ["resource-id", "text", "content-desc", "bounds", "class"]:
            m = re.search(f'{attr}="([^"]*)"', n)
            if m:
                node[attr] = m.group(1)
        nodes.append(node)
    return nodes


def find_node(nodes: list, **kwargs) -> dict | None:
    """조건에 맞는 첫 번째 노드 반환"""
    for n in nodes:
        match = True
        for key, val in kwargs.items():
            field = key.replace("_", "-")
            node_val = n.get(field, "")
            if isinstance(val, str):
                if val not in node_val:
                    match = False
                    break
            elif callable(val):
                if not val(node_val):
                    match = False
                    break
        if match:
            return n
    return None


def find_nodes(nodes: list, **kwargs) -> list[dict]:
    """조건에 맞는 모든 노드 반환"""
    result = []
    for n in nodes:
        match = True
        for key, val in kwargs.items():
            field = key.replace("_", "-")
            node_val = n.get(field, "")
            if isinstance(val, str):
                if val not in node_val:
                    match = False
                    break
        if match:
            result.append(n)
    return result


def get_bounds_center(bounds_str: str) -> tuple[int, int]:
    """bounds 문자열에서 중앙 좌표 추출"""
    m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', bounds_str)
    if m:
        x1, y1, x2, y2 = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
        return (x1 + x2) // 2, (y1 + y2) // 2
    return 0, 0


# ═══════════════════════════════════════════════════════════════════════════════
# 숫자 파싱
# ═══════════════════════════════════════════════════════════════════════════════

def parse_korean_count(text: str) -> int:
    """한국어 숫자 파싱: '1,666.9만' → 16669000, '7.8억' → 780000000"""
    if not text:
        return 0
    text = text.strip().replace(",", "")

    # 억 단위
    m = re.match(r'([\d.]+)\s*억', text)
    if m:
        return int(float(m.group(1)) * 100_000_000)

    # 만 단위
    m = re.match(r'([\d.]+)\s*만', text)
    if m:
        return int(float(m.group(1)) * 10_000)

    # 천 단위 (K)
    m = re.match(r'([\d.]+)\s*[Kk천]', text)
    if m:
        return int(float(m.group(1)) * 1_000)

    # M 단위
    m = re.match(r'([\d.]+)\s*[Mm]', text)
    if m:
        return int(float(m.group(1)) * 1_000_000)

    # 순수 숫자
    m = re.match(r'[\d,.]+', text)
    if m:
        try:
            return int(m.group(0).replace(",", ""))
        except ValueError:
            pass

    return 0


def parse_relative_date(text: str) -> str:
    """상대 날짜 → YYYY-MM-DD: '1주 전' → 날짜"""
    if not text:
        return ""
    text = text.strip().lstrip("·").strip()
    now = datetime.now()

    # 한국어: N일 전, N주 전, N개월 전, N시간 전, N분 전
    m = re.match(r'(\d+)\s*(일|주|개월|시간|분|초)\s*전', text)
    if m:
        num = int(m.group(1))
        unit = m.group(2)
        if unit == "일":
            dt = now - timedelta(days=num)
        elif unit == "주":
            dt = now - timedelta(weeks=num)
        elif unit == "개월":
            dt = now - timedelta(days=num * 30)
        elif unit == "시간":
            dt = now - timedelta(hours=num)
        elif unit == "분":
            dt = now - timedelta(minutes=num)
        elif unit == "초":
            dt = now
        else:
            return text
        return dt.strftime("%Y-%m-%d")

    # 절대 날짜: YYYY-M-D, YYYY.M.D, M-D
    abs_m = re.match(r'(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})', text)
    if abs_m:
        return f"{int(abs_m.group(1)):04d}-{int(abs_m.group(2)):02d}-{int(abs_m.group(3)):02d}"

    md_m = re.match(r'(\d{1,2})[.\-/](\d{1,2})', text)
    if md_m:
        m_val, d_val = int(md_m.group(1)), int(md_m.group(2))
        if 1 <= m_val <= 12 and 1 <= d_val <= 31:
            return f"{now.year:04d}-{m_val:02d}-{d_val:02d}"

    return text


def is_ad(caption: str, nodes: list = None) -> bool:
    """광고 게시물 여부 판별"""
    text = caption.lower()
    # 광고 키워드 (한국어 + 영어)
    ad_keywords = [
        "지금 설치하세요", "설치하기", "지금 구매", "지금 다운로드",
        "앱 다운로드", "지금 주문", "지금 가입", "무료 체험",
        "install now", "download now", "shop now", "buy now", "get the app",
        "sponsored", "프로모션", "프로모",
        # 자주 뜨는 특정 광고
        "chatgpt images를 활용", "나만의 캐리커처",
    ]
    if any(kw in text for kw in ad_keywords):
        return True

    # 광고 UI 마커 체크 (노드 내 "Sponsored" / "광고" 라벨)
    if nodes:
        for n in nodes:
            t = n.get("text", "")
            d = n.get("content-desc", "")
            if t in ("Sponsored", "광고", "Ad") or "광고" in d:
                return True

    return False


def classify_post(caption: str) -> str:
    """게시물 캡션 기반 분류"""
    text = caption.lower()

    if any(kw in text for kw in ["mv", "music video", "뮤비", "뮤직비디오", "official video"]):
        return "MV"
    if any(kw in text for kw in ["comeback", "컴백", "out now", "release", "발매", "teaser", "티저", "album"]):
        return "Promotion"
    if any(kw in text for kw in ["challenge", "챌린지", "dance", "안무", "choreography", "커버"]):
        return "Challenge/Dance"
    if any(kw in text for kw in ["stage", "무대", "performance", "concert", "fancam", "직캠", "live"]):
        return "Performance"
    if any(kw in text for kw in ["behind", "비하인드", "vlog", "브이로그", "일상", "daily"]):
        return "Behind/Vlog"
    if any(kw in text for kw in ["예능", "fun", "funny", "cute", "귀여", "먹방"]):
        return "Variety"
    if any(kw in text for kw in ["shorts", "trend", "트렌드", "viral"]):
        return "Trend"

    return "General"


def make_slug(name_en: str) -> str:
    """name_en → slug"""
    slug = name_en.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    slug = re.sub(r"-+", "-", slug)
    return slug


# ═══════════════════════════════════════════════════════════════════════════════
# TikTok 네비게이션
# ═══════════════════════════════════════════════════════════════════════════════

def extract_username_from_url(tiktok_url: str) -> str:
    """URL에서 @username 추출: https://www.tiktok.com/@foo → foo"""
    m = re.search(r'@([A-Za-z0-9_.]+)', tiktok_url)
    return m.group(1).lower() if m else ""


def verify_profile(expected_username: str, max_retries: int = 2) -> tuple[str, list]:
    """현재 화면의 username이 기대값과 일치하는지 검증, (xml, nodes) 반환"""
    for attempt in range(max_retries + 1):
        xml = get_ui_dump()
        nodes = parse_nodes(xml)

        # username 노드 (resource-id=r30)
        user_node = find_node(nodes, resource_id="r30")
        actual = (user_node.get("text", "") if user_node else "").strip().lstrip("@").lower()

        if not expected_username or actual == expected_username:
            return xml, nodes

        if attempt < max_retries:
            logger.warning(f"  프로필 불일치: 기대={expected_username} 실제={actual or '(없음)'}, 재시도 {attempt+1}...")
            # 뒤로 갔다가 다시 열기
            back()
            time.sleep(1)
            adb(f"am start -a android.intent.action.VIEW -d 'https://www.tiktok.com/@{expected_username}'")
            time.sleep(DELAY["profile_load"] + 1)
        else:
            logger.error(f"  프로필 불일치 해소 실패: 기대={expected_username} 실제={actual or '(없음)'}")

    return xml, nodes


def open_profile(tiktok_url: str) -> bool:
    """딥링크로 TikTok 프로필 열기"""
    ensure_tiktok_foreground()
    adb(f"am start -a android.intent.action.VIEW -d '{tiktok_url}'")
    time.sleep(DELAY["profile_load"])
    return True


def extract_profile(nodes: list) -> dict:
    """프로필 페이지 UI 노드에서 데이터 추출"""
    profile = {
        "display_name": "",
        "username": "",
        "verified": False,
        "category": "",
        "followers": 0,
        "following": 0,
        "total_likes": 0,
        "bio": "",
    }

    # 팔로잉/팔로워/좋아요 — r1q(숫자) + r1p(라벨) 쌍으로 추출
    stat_values = find_nodes(nodes, resource_id="r1q")
    stat_labels = find_nodes(nodes, resource_id="r1p")

    for val_node, lbl_node in zip(stat_values, stat_labels):
        val = val_node.get("text", "")
        lbl = lbl_node.get("text", "")
        num = parse_korean_count(val)

        if "팔로잉" in lbl:
            profile["following"] = num
        elif "팔로워" in lbl:
            profile["followers"] = num
        elif "좋아요" in lbl:
            profile["total_likes"] = num

    # 유저네임 (@...)
    user_node = find_node(nodes, resource_id="r30")
    if user_node:
        profile["username"] = user_node.get("text", "")

    # 인증 배지
    verified_node = find_node(nodes, content_desc="인증 완료")
    profile["verified"] = verified_node is not None

    # 카테고리 (아티스트 등)
    cat_node = find_node(nodes, resource_id="qwz")
    if cat_node:
        profile["category"] = cat_node.get("text", "")

    # 표시 이름 — 유저네임 위의 텍스트
    for n in nodes:
        text = n.get("text", "").strip()
        bounds = n.get("bounds", "")
        # 프로필 영역 상단 (y < 800)에서 유저네임/카테고리가 아닌 텍스트
        if text and bounds and "r1q" not in n.get("resource-id", "") and "r1p" not in n.get("resource-id", ""):
            m = re.match(r'\[(\d+),(\d+)\]', bounds)
            if m and int(m.group(2)) < 700 and int(m.group(2)) > 400:
                if "@" not in text and text not in ["아티스트", "크리에이터", "공인"]:
                    profile["display_name"] = text
                    break

    # Bio — 프로필 영역의 긴 텍스트
    for n in nodes:
        text = n.get("text", "").strip()
        bounds = n.get("bounds", "")
        rid = n.get("resource-id", "")
        if text and len(text) > 20 and bounds and "r1" not in rid and "desc" not in rid:
            m = re.match(r'\[(\d+),(\d+)\]', bounds)
            if m and 1000 < int(m.group(2)) < 1500:
                profile["bio"] = text[:500]
                break

    return profile


def extract_grid_views(nodes: list) -> list[int]:
    """프로필 그리드에서 조회수 목록 추출 (id=ysg)"""
    view_nodes = find_nodes(nodes, resource_id="ysg")
    views = []
    for n in view_nodes:
        text = n.get("text", "")
        views.append(parse_korean_count(text))
    return views


def collect_grid_views_all(
    initial_nodes: list,
    target_count: int = MAX_VIDEOS_PER_GROUP + 10,
) -> list[int]:
    """그리드 스크롤하며 조회수 전체 수집 (bounds 기반 중복 제거 후 위→아래 정렬)

    수집 후 스크롤한 횟수만큼 반대 방향으로 복귀하므로,
    호출 후 get_ui_dump()로 그리드 상단 위치를 재취득해야 한다.
    """
    views_map: dict[str, int] = {}  # bounds → 조회수

    def _add(nds: list) -> None:
        for n in find_nodes(nds, resource_id="ysg"):
            b = n.get("bounds", "")
            if b and b not in views_map:
                views_map[b] = parse_korean_count(n.get("text", ""))

    _add(initial_nodes)

    scroll_count = 0
    while len(views_map) < target_count and scroll_count < MAX_SCROLLS_PROFILE:
        adb("input swipe 720 1800 720 1200 300")  # 위로 스크롤 (다음 게시물)
        time.sleep(1.0)
        xml = get_ui_dump()
        nds = parse_nodes(xml)
        prev_len = len(views_map)
        _add(nds)
        if len(views_map) == prev_len:
            break  # 더 이상 새 게시물 없음
        scroll_count += 1

    # 스크롤 복귀 (아래로 스크롤 = 위 게시물로 이동)
    if scroll_count > 0:
        logger.debug(f"  그리드 {scroll_count}번 스크롤 후 상단 복귀...")
        for _ in range(scroll_count + 1):
            adb("input swipe 720 1200 720 1800 300")
            time.sleep(0.5)

    # y1 좌표 기준 정렬 (위쪽 게시물이 인덱스 0)
    def _y1(b: str) -> int:
        m = re.match(r'\[(\d+),(\d+)\]', b)
        return int(m.group(2)) if m else 0

    return [v for _, v in sorted(views_map.items(), key=lambda x: _y1(x[0]))]


def get_grid_positions(nodes: list) -> list[tuple[int, int]]:
    """그리드 비디오 썸네일 중앙 좌표 추출"""
    view_nodes = find_nodes(nodes, resource_id="ysg")
    positions = []
    thumb_h = SCREEN_W // 3  # 3열 그리드 → 정사각형 썸네일
    for n in view_nodes:
        bounds = n.get("bounds", "")
        if bounds:
            cx, cy = get_bounds_center(bounds)
            # ysg 라벨 중앙에서 (라벨 높이 + 썸네일 절반) 만큼 위로 이동
            positions.append((cx, cy - thumb_h // 2 - 30))
    return positions


def extract_video_detail(nodes: list) -> dict:
    """비디오 상세 페이지에서 데이터 추출"""
    post = {
        "views": 0,
        "likes": 0,
        "comments": 0,
        "shares": 0,
        "saves": 0,
        "posted_at": "",
        "caption": "",
        "hashtags": [],
        "music": "",
        "category": "",
    }

    # 좋아요 (id=fat)
    like_node = find_node(nodes, resource_id="fat")
    if like_node:
        post["likes"] = parse_korean_count(like_node.get("text", ""))

    # 좋아요 (content-desc 폴백)
    if post["likes"] == 0:
        like_desc = find_node(nodes, content_desc="좋아요")
        if like_desc:
            desc = like_desc.get("content-desc", "")
            m = re.search(r'좋아요\s*([\d,.]+[만억]?)\s*개', desc)
            if m:
                post["likes"] = parse_korean_count(m.group(1))

    # 댓글 (id=duk)
    comment_node = find_node(nodes, resource_id="duk")
    if comment_node:
        post["comments"] = parse_korean_count(comment_node.get("text", ""))

    # 댓글 (content-desc 폴백)
    if post["comments"] == 0:
        comment_desc = find_node(nodes, content_desc="댓글")
        if comment_desc:
            desc = comment_desc.get("content-desc", "")
            m = re.search(r'댓글\s*([\d,.]+[만억]?)\s*개', desc)
            if m:
                post["comments"] = parse_korean_count(m.group(1))

    # 저장/즐겨찾기 (id=h3d)
    save_node = find_node(nodes, resource_id="h3d")
    if save_node:
        post["saves"] = parse_korean_count(save_node.get("text", ""))

    # 공유 (id=txs)
    share_node = find_node(nodes, resource_id="txs")
    if share_node:
        post["shares"] = parse_korean_count(share_node.get("text", ""))

    # 공유 (content-desc 폴백)
    if post["shares"] == 0:
        share_desc = find_node(nodes, content_desc="공유")
        if share_desc:
            desc = share_desc.get("content-desc", "")
            m = re.search(r'공유\s*([\d,.]+[만억]?)\s*회', desc)
            if m:
                post["shares"] = parse_korean_count(m.group(1))

    # 게시일 (id=ytg, 예: '· 1주 전')
    date_node = find_node(nodes, resource_id="ytg")
    if date_node:
        post["posted_at"] = parse_relative_date(date_node.get("text", ""))

    # 날짜 폴백 1: content-desc + text 전체 스캔 (ytg 미발견 시)
    if not post["posted_at"]:
        date_re = re.compile(
            r'(\d+\s*(?:일|주|개월|시간|분)\s*전|\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})'
        )
        for n in nodes:
            for field in ("text", "content-desc"):
                val = n.get(field, "")
                m = date_re.search(val)
                if m:
                    parsed = parse_relative_date(m.group(0).strip())
                    if parsed and len(parsed) == 10 and parsed[:4].isdigit():
                        post["posted_at"] = parsed
                        break
            if post["posted_at"]:
                break

    # 캡션 (id=desc)
    desc_node = find_node(nodes, resource_id="desc")
    if desc_node:
        caption = desc_node.get("text", "")
        # '번역 보기' 제거
        caption = re.sub(r'\s*번역\s*보기\s*$', '', caption).strip()
        post["caption"] = caption[:1000]

        # 해시태그 추출 (HTML 엔티티 &#NNN; 제외, 숫자만인 것 제외)
        hashtags = re.findall(r'(?<!&)#([A-Za-z가-힣_]\w*)', caption)
        post["hashtags"] = hashtags[:20]

    # 음악
    for n in nodes:
        desc = n.get("content-desc", "")
        if "사운드:" in desc:
            post["music"] = desc.replace("사운드:", "").strip()[:200]
            break

    # 분류
    post["category"] = classify_post(post["caption"])

    return post


# ═══════════════════════════════════════════════════════════════════════════════
# 메인 크롤링 로직
# ═══════════════════════════════════════════════════════════════════════════════

def crawl_group(group: dict, profile_only: bool = False) -> dict:
    """1개 그룹의 TikTok 데이터 크롤링"""
    name = group["name"]
    name_en = group["name_en"]
    tiktok_url = group.get("info", {}).get("틱톡", "")
    slug = make_slug(name_en)

    result = {
        "name": name,
        "name_en": name_en,
        "slug": slug,
        "tiktok_url": tiktok_url,
        "crawled_at": datetime.now().isoformat(),
        "profile": {},
        "posts": [],
        "stats": {},
    }

    if not tiktok_url:
        result["error"] = "TikTok URL 없음"
        return result

    try:
        # ─── 1. 프로필 페이지 열기 + 검증 ───
        expected_user = extract_username_from_url(tiktok_url)
        open_profile(tiktok_url)
        xml, nodes = verify_profile(expected_user)

        if len(nodes) < 10:
            logger.warning(f"  UI 노드 부족 ({len(nodes)}), 재시도...")
            time.sleep(3)
            xml, nodes = verify_profile(expected_user, max_retries=1)

        # ─── 2. 프로필 데이터 추출 ───
        profile = extract_profile(nodes)
        result["profile"] = profile
        logger.info(f"  프로필: {profile['display_name']} | "
                     f"팔로워 {profile['followers']:,} | "
                     f"좋아요 {profile['total_likes']:,}")

        if profile_only:
            return result

        # ─── 3. 그리드 조회수 + 위치 수집 (재시도 포함) ───
        grid_views = extract_grid_views(nodes)
        grid_positions = get_grid_positions(nodes)

        # 그리드가 안 보이면 최대 3회 재시도 (딜레이 증가 + 살짝 스크롤)
        if not grid_positions:
            for grid_retry in range(3):
                wait_sec = 3 + grid_retry * 2  # 3초, 5초, 7초
                logger.warning(f"  그리드 비디오 없음, 재시도 {grid_retry+1}/3 ({wait_sec}초 대기)...")

                # 팝업 닫기 시도 (로그인 유도, 알림 등)
                for n in nodes:
                    t = n.get("text", "")
                    if t in ("나중에 하기", "닫기", "Close", "Not now", "Skip", "취소"):
                        bounds = n.get("bounds", "")
                        if bounds:
                            cx, cy = get_bounds_center(bounds)
                            tap(cx, cy, f"dismiss_popup:{t}")
                            time.sleep(1)
                            break

                # 살짝 위로 스크롤하여 그리드 렌더링 트리거
                adb(f"input swipe 720 1800 720 1500 200")
                time.sleep(wait_sec)

                xml = get_ui_dump()
                nodes = parse_nodes(xml)
                grid_views = extract_grid_views(nodes)
                grid_positions = get_grid_positions(nodes)
                if grid_positions:
                    logger.info(f"  그리드 재시도 {grid_retry+1}에서 발견: {len(grid_positions)}개")
                    break

        logger.info(f"  그리드 비디오: {len(grid_views)}개 (조회수: {grid_views[:3]})")

        if not grid_positions:
            logger.warning("  그리드 비디오 없음 (3회 재시도 실패)")
            return result

        # ─── 3-b. 스크롤로 더 많은 grid_views 수집 후 상단 복귀 ───
        if len(grid_views) < MAX_VIDEOS_PER_GROUP:
            grid_views = collect_grid_views_all(nodes, MAX_VIDEOS_PER_GROUP + 5)
            logger.info(f"  grid_views 스크롤 수집 완료: {len(grid_views)}개")
            # 복귀 후 그리드 위치 재취득
            xml = get_ui_dump()
            nodes = parse_nodes(xml)
            grid_positions = get_grid_positions(nodes)

        # ─── 4. 첫 비디오 클릭 → 상세 페이지 ───
        first_pos = grid_positions[0]
        tap(first_pos[0], first_pos[1], "first_video")
        time.sleep(DELAY["video_load"])

        # 비디오 페이지 진입 확인 (영상 재생 중 idle 불가 → 일시정지 후 dump)
        check_xml = get_ui_dump(pause_video=True)
        check_nodes = parse_nodes(check_xml)
        if not find_node(check_nodes, resource_id="fat") and not find_node(check_nodes, resource_id="desc"):
            # 비디오 안 열림 → 재탭 (그리드 중앙에 직접 탭)
            logger.warning("  비디오 페이지 미진입, 재시도...")
            tap(first_pos[0], first_pos[1] - 100, "retry_first_video")
            time.sleep(DELAY["video_load"] + 1)
            check_xml = get_ui_dump(pause_video=True)
            check_nodes = parse_nodes(check_xml)
            if not find_node(check_nodes, resource_id="fat") and not find_node(check_nodes, resource_id="desc"):
                logger.warning("  비디오 페이지 2차 실패, 프로필만 저장")
                return result

        # ─── 5. 비디오 상세 순회 (위로 스와이프) ───
        posts = []
        cutoff_date = (datetime.now() - timedelta(days=DAYS_BACK)).strftime("%Y-%m-%d")
        real_vi = 0  # 실제 게시물 인덱스 (광고 제외)
        ad_count = 0  # 광고 횟수
        prev_caption = ""  # 중복 감지용
        prev_fingerprint = ""  # engagement 기반 중복 감지용
        consecutive_dup = 0  # 연속 중복 횟수

        consecutive_zero = 0  # 연속 빈 데이터 감지 (포그라운드 이탈 감지)

        for vi in range(MAX_VIDEOS_PER_GROUP + 15):  # 광고 여유분 추가
            xml = get_ui_dump(pause_video=True)  # 영상 재생 중 idle 확보
            nodes = parse_nodes(xml)

            post = extract_video_detail(nodes)

            # 빈 데이터 감지 (TikTok 비활성 상태)
            if post["likes"] == 0 and post["comments"] == 0 and not post["caption"]:
                consecutive_zero += 1
                if consecutive_zero >= 3:
                    logger.warning(f"  연속 빈 데이터 {consecutive_zero}회 — TikTok 포그라운드 확인")
                    ensure_tiktok_foreground()
                    # 프로필로 돌아가서 재시도
                    back()
                    time.sleep(1)
                    break
                swipe_up()
                continue
            else:
                consecutive_zero = 0

            # 광고 필터: 캡션 + UI 노드 기반
            if is_ad(post["caption"], nodes):
                ad_count += 1
                consecutive_dup += 1
                if consecutive_dup >= 3:
                    logger.info(f"  연속 광고/중복 {consecutive_dup}회 — 피드 끝, 중단")
                    break
                logger.info(f"  [skip] 광고: {post['caption'][:40]}")
                swipe_up()
                continue

            # 중복 감지: 캡션 또는 engagement 핑거프린트 비교
            post_fingerprint = f"{post['likes']}_{post['comments']}_{post['saves']}_{post['shares']}"
            is_dup = False
            if post["caption"] and post["caption"] == prev_caption:
                is_dup = True
            elif not post["caption"] and post_fingerprint == prev_fingerprint:
                # 캡션 없는 비디오: engagement 값으로 중복 판별
                is_dup = True

            if is_dup:
                consecutive_dup += 1
                if consecutive_dup >= 2:
                    logger.info(f"  연속 중복 {consecutive_dup}회 — 피드 끝, 중단")
                    break
                logger.info(f"  [skip] 중복: {post['caption'][:40] or post_fingerprint}")
                swipe_up()
                continue
            prev_caption = post["caption"]
            prev_fingerprint = post_fingerprint
            consecutive_dup = 0

            # 그리드 조회수 보완
            if real_vi < len(grid_views):
                post["views"] = grid_views[real_vi]

            # 날짜 확인 — 30일 이전이면 중단
            if post["posted_at"] and post["posted_at"] < cutoff_date:
                logger.info(f"  [{real_vi+1}] {post['posted_at']} — 30일 이전, 중단")
                break

            posts.append(post)
            real_vi += 1
            logger.info(f"  [{real_vi}] 좋아요:{post['likes']:,} 댓글:{post['comments']:,} "
                         f"저장:{post['saves']:,} 공유:{post['shares']:,} "
                         f"날짜:{post['posted_at']} | {post['caption'][:40]}")

            # 다음 비디오로 스와이프
            swipe_up()

        if ad_count > 0:
            logger.info(f"  광고 {ad_count}개 필터링됨")

        # ─── 6. 프로필로 돌아가기 ───
        back()
        time.sleep(DELAY["transition"])

        result["posts"] = posts

        # ─── 7. 통계 계산 ───
        if posts:
            total = len(posts)
            result["stats"] = {
                "total_posts_crawled": total,
                "posts_last_30d": total,
                "avg_views": sum(p["views"] for p in posts) // total if total else 0,
                "avg_likes": sum(p["likes"] for p in posts) // total if total else 0,
                "avg_comments": sum(p["comments"] for p in posts) // total if total else 0,
                "avg_shares": sum(p["shares"] for p in posts) // total if total else 0,
                "avg_saves": sum(p["saves"] for p in posts) // total if total else 0,
                "engagement_rate": 0,
            }
            total_eng = sum(p["likes"] + p["comments"] + p["shares"] + p["saves"] for p in posts)
            total_views = sum(p["views"] for p in posts)
            if total_views > 0:
                result["stats"]["engagement_rate"] = round(total_eng / total_views * 100, 2)

    except Exception as e:
        result["error"] = f"{type(e).__name__}: {str(e)[:200]}"
        logger.error(f"  크롤링 실패: {result['error']}")

    return result


def save_group_data(slug: str, data: dict):
    """그룹 데이터 JSON 저장"""
    path = GROUPS_DIR / f"{slug}.json"
    content = json.dumps(data, ensure_ascii=False, indent=2)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
        f.flush()
        os.fsync(f.fileno())


def save_progress(completed: list):
    """진행 상태 저장"""
    content = json.dumps({
        "completed": completed,
        "updated_at": datetime.now().isoformat(),
    }, ensure_ascii=False, indent=2)
    with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
        f.write(content)
        f.flush()
        os.fsync(f.fileno())


def load_progress() -> list:
    """이전 진행 상태 로드"""
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("completed", [])
    return []


def main():
    parser = argparse.ArgumentParser(description="TikTok ADB 크롤링")
    parser.add_argument("--test", type=str, default="",
                        help="테스트할 그룹명 (콤마 구분)")
    parser.add_argument("--resume", action="store_true",
                        help="이전 진행에서 재개")
    parser.add_argument("--profile-only", action="store_true",
                        help="프로필만 수집")
    parser.add_argument("--max-groups", type=int, default=0,
                        help="최대 처리 그룹 수")
    parser.add_argument("--zero-posts", action="store_true",
                        help="post_count=0인 그룹만 재크롤 (팔로워 내림차순)")
    parser.add_argument("--min-followers", type=int, default=0,
                        help="--zero-posts 사용 시 최소 팔로워 필터 (기본: 0=전체)")
    parser.add_argument("--retry-failed", action="store_true",
                        help="프로필 수집 실패 그룹 (팔로워=0 & username 없음) 재크롤")
    parser.add_argument("--retry-views", action="store_true",
                        help="views=0 비율이 높은 그룹 재크롤")
    parser.add_argument("--views-threshold", type=float, default=0.5,
                        help="--retry-views 사용 시 views=0 비율 임계값 (기본: 0.5)")
    args = parser.parse_args()

    # ADB 연결 확인
    devices = adb_host("devices")
    if DEVICE not in devices:
        logger.error(f"디바이스 {DEVICE} 연결 안 됨")
        sys.exit(1)
    logger.info(f"디바이스 연결 확인: {DEVICE}")

    # namu-wiki.json 로드
    with open(NAMU_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)

    groups = data["groups"]
    targets = [g for g in groups if g.get("info", {}).get("틱톡", "").strip()]
    logger.info(f"틱톡 URL 보유: {len(targets)}개")

    # retry-failed 모드: 팔로워=0 & username 없음 → 크롤링 완전 실패 그룹
    is_test = False
    if args.retry_failed:
        failed_slugs = set()
        for g in targets:
            slug = make_slug(g["name_en"])
            gfile = GROUPS_DIR / f"{slug}.json"
            if not gfile.exists():
                failed_slugs.add(slug)
                continue
            try:
                gdata = json.loads(gfile.read_text(encoding="utf-8"))
                prof = gdata.get("profile", {})
                followers = prof.get("followers", 0) or 0
                username = prof.get("username", "") or ""
                if followers == 0 and not username:
                    failed_slugs.add(slug)
            except Exception:
                failed_slugs.add(slug)
        targets = [g for g in targets if make_slug(g["name_en"]) in failed_slugs]
        is_test = True
        logger.info(f"retry-failed 모드: {len(targets)}개 그룹 재크롤")

    # retry-views 모드: views=0 비율이 임계값 이상인 그룹
    elif args.retry_views:
        views_slugs = set()
        for g in targets:
            slug = make_slug(g["name_en"])
            gfile = GROUPS_DIR / f"{slug}.json"
            if not gfile.exists():
                continue
            try:
                gdata = json.loads(gfile.read_text(encoding="utf-8"))
                posts = gdata.get("posts", [])
                if not posts:
                    continue
                v0 = sum(1 for p in posts if (p.get("views", 0) or 0) == 0 and (p.get("likes", 0) or 0) > 0)
                if v0 / len(posts) >= args.views_threshold:
                    views_slugs.add(slug)
            except Exception:
                pass
        targets = [g for g in targets if make_slug(g["name_en"]) in views_slugs]
        is_test = True
        logger.info(f"retry-views 모드 (threshold={args.views_threshold:.0%}): {len(targets)}개 그룹 재크롤")

    # zero-posts 모드: 기존 JSON에서 post_count=0인 그룹만 선별
    elif args.zero_posts:
        zero_slugs = set()
        for g in targets:
            slug = make_slug(g["name_en"])
            gfile = GROUPS_DIR / f"{slug}.json"
            if gfile.exists():
                try:
                    with open(gfile, encoding="utf-8") as f:
                        gdata = json.load(f)
                    posts = gdata.get("posts", [])
                    followers = gdata.get("profile", {}).get("followers", 0)
                    if len(posts) == 0 and followers >= args.min_followers:
                        zero_slugs.add(slug)
                except Exception:
                    pass
            else:
                zero_slugs.add(slug)  # JSON 없으면 포함

        targets = [g for g in targets if make_slug(g["name_en"]) in zero_slugs]
        # 팔로워 내림차순 정렬 (미수집 그룹은 0으로 처리)
        def _get_followers(g):
            slug = make_slug(g["name_en"])
            gfile = GROUPS_DIR / f"{slug}.json"
            try:
                with open(gfile, encoding="utf-8") as f:
                    return json.load(f).get("profile", {}).get("followers", 0)
            except Exception:
                return 0
        targets.sort(key=_get_followers, reverse=True)
        logger.info(f"zero-posts 모드: {len(targets)}개 (팔로워 {args.min_followers:,}+ 필터)")
        is_test = True  # progress 파일 수정 안 함

    # 테스트 모드
    elif args.test:
        is_test = True
        test_names = [n.strip() for n in args.test.split(",")]
        targets = [g for g in targets if g["name"] in test_names or g["name_en"] in test_names]

    # 재개 모드
    completed = []
    if args.resume and not args.zero_posts and not args.retry_failed and not args.retry_views:
        completed = load_progress()
        targets = [g for g in targets if make_slug(g["name_en"]) not in completed]
        logger.info(f"재개: {len(completed)}개 완료, {len(targets)}개 남음")

    if args.max_groups > 0:
        targets = targets[:args.max_groups]

    logger.info(f"크롤링 시작: {len(targets)}개 그룹")

    # 디바이스 보호 설정 (화면 꺼짐 방지 + 밝기 낮추기)
    device_setup()

    summary_data = []

    for gi, group in enumerate(targets):
        name = group["name"]
        name_en = group["name_en"]
        slug = make_slug(name_en)

        logger.info(f"\n{'='*60}")
        logger.info(f"[{gi+1}/{len(targets)}] {name} ({name_en})")
        logger.info(f"{'='*60}")

        result = crawl_group(group, args.profile_only)

        # 저장
        save_group_data(slug, result)

        stats = result.get("stats", {})
        logger.info(f"  → 게시물 {stats.get('total_posts_crawled', 0)}개, "
                     f"평균좋아요 {stats.get('avg_likes', 0):,}, "
                     f"참여율 {stats.get('engagement_rate', 0)}%")

        # 요약
        summary_data.append({
            "name": name,
            "name_en": name_en,
            "slug": slug,
            "tiktok_url": result["tiktok_url"],
            "followers": result["profile"].get("followers", 0),
            "following": result["profile"].get("following", 0),
            "total_likes": result["profile"].get("total_likes", 0),
            "display_name": result["profile"].get("display_name", ""),
            "verified": result["profile"].get("verified", False),
            "posts_last_30d": stats.get("posts_last_30d", 0),
            "avg_views": stats.get("avg_views", 0),
            "avg_likes": stats.get("avg_likes", 0),
            "avg_comments": stats.get("avg_comments", 0),
            "engagement_rate": stats.get("engagement_rate", 0),
        })

        completed.append(slug)
        if not is_test:
            save_progress(completed)

        # 10개마다 요약 저장
        if (gi + 1) % 5 == 0:
            content = json.dumps({
                "crawled_at": datetime.now().isoformat(),
                "total_groups": len(summary_data),
                "groups": summary_data,
            }, ensure_ascii=False, indent=2)
            with open(SUMMARY_FILE, "w", encoding="utf-8") as f:
                f.write(content)

        if gi < len(targets) - 1:
            # 그룹 간 TikTok 강제종료 → 메모리 누수 방지
            tiktok_force_stop()
            time.sleep(DELAY["between_groups"])

    # 최종 요약 저장
    content = json.dumps({
        "crawled_at": datetime.now().isoformat(),
        "total_groups": len(summary_data),
        "settings": {"days_back": DAYS_BACK, "max_videos": MAX_VIDEOS_PER_GROUP},
        "groups": summary_data,
    }, ensure_ascii=False, indent=2)
    with open(SUMMARY_FILE, "w", encoding="utf-8") as f:
        f.write(content)
        f.flush()
        os.fsync(f.fileno())

    # 크롤링 종료 후 화면 최소 밝기로 전환 (대기 상태)
    device_idle()

    logger.info(f"\n{'='*60}")
    logger.info(f"크롤링 완료: {len(summary_data)}개 그룹")
    logger.info(f"요약: {SUMMARY_FILE}")

    # Top 10
    top = sorted(summary_data, key=lambda x: x["followers"], reverse=True)[:10]
    logger.info("\nTop 10 팔로워:")
    for i, g in enumerate(top):
        logger.info(f"  {i+1}. {g['name']:15s} {g['followers']:>15,}")


if __name__ == "__main__":
    main()
