#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys, io
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
"""
recrawl_tablet.py — Samsung R14 태블릿용 TikTok 재크롤링
A90 크롤링에서 화면 꺼짐으로 실패한 33개 그룹 재수집

태블릿 특이사항:
  - 해상도: 800x1280 (포트레이트)
  - resource-id: S23과 동일 (ysg/r1q/r1p/fat/duk/h3d/txs)
  - UI dump 경로: /data/local/tmp/ui.xml (/sdcard/ 안 됨)
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

GROUPS_DIR.mkdir(parents=True, exist_ok=True)

# ─── 태블릿 디바이스 설정 ────────────────────────────────────────────────────────
DEVICE = "5HUG1CQU6NLB30XM894"  # Samsung R14 Tablet
TIKTOK_PKG = "com.ss.android.ugc.trill"
SCREEN_W, SCREEN_H = 800, 1280
UI_DUMP_PATH = "/data/local/tmp/ui.xml"  # 태블릿: /sdcard/ 안 됨

# ─── 딜레이 (초) ──────────────────────────────────────────────────────────────
DELAY = {
    "tap": 0.8,
    "transition": 2.0,
    "profile_load": 6.0,   # 태블릿 느림 → 6초
    "video_load": 5.0,     # 태블릿 느림 → 5초
    "scroll": 1.2,
    "back": 1.0,
    "between_groups": 3.0,
    "swipe": 1.5,
}

# ─── 크롤링 설정 ──────────────────────────────────────────────────────────────
DAYS_BACK = 30
MAX_VIDEOS_PER_GROUP = 30
MAX_SCROLLS_PROFILE = 10

# ─── 재크롤링 대상 (name_en 기준) ─────────────────────────────────────────────
# A90 크롤링에서 화면 꺼짐으로 실패한 33개 그룹 (18번~49번)
RECRAWL_TARGETS = [
    "UNIS", "BLACKSWAN", "ARTBEAT v", "FIFTY FIFTY", "KiiiKiii",
    "ALLDAY PROJECT", "ZEROBASEONE", "TREASURE", "THE BOYZ", "Ikon",
    "ASTRO", "Xdinary Heroes", "TEMPEST", "PENTAGON", "EPEX",
    "CRAVITY", "ONEUS", "8TURN", "CIX", "THE NEW SIX",
    "YOUNITE", "WEi", "MIRAE", "xikers", "ATBO",
    "E'LAST", "ALL(H)OURS", "TRENDZ", "BLITZERS", "XLOV",
    "CORTIS", "LNGSHOT", "MAMAMOO",
]

# ─── 로깅 ─────────────────────────────────────────────────────────────────────
LOG_DIR = SCRIPT_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)
log_file = LOG_DIR / f"recrawl_tablet_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"

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
# ADB 헬퍼
# ═══════════════════════════════════════════════════════════════════════════════

def adb(cmd: str, timeout: int = 25) -> str:  # 태블릿 느림 → 25초
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


def tap(x: int, y: int, label: str = ""):
    adb(f"input tap {x} {y}")
    if label:
        logger.debug(f"  tap({x},{y}) {label}")
    time.sleep(DELAY["tap"])


def swipe_up():
    # Tablet: 800x1280
    adb(f"input swipe {SCREEN_W // 2} {int(SCREEN_H * 0.7)} {SCREEN_W // 2} {int(SCREEN_H * 0.25)} 300")
    time.sleep(DELAY["swipe"])


def back():
    adb("input keyevent 4")
    time.sleep(DELAY["back"])


def wake_screen():
    """화면 켜기 + 잠금해제 (A90 대응)"""
    # 화면 ON/OFF 확인 (mScreenOn 또는 mWakefulness)
    power_state = adb("dumpsys power | grep -E 'mWakefulness|mScreenOn|Display Power'")
    screen_on = "Awake" in power_state or "mScreenOn=true" in power_state

    if not screen_on:
        logger.info("  화면 OFF → 켜기")
        adb("input keyevent 26")  # Power
        time.sleep(2)

    # NotificationShade/잠금화면 닫기 (긴 스와이프)
    focus = adb("dumpsys window | grep mCurrentFocus")
    if "NotificationShade" in focus or "Keyguard" in focus or "StatusBar" in focus or "Launcher" in focus:
        adb("input keyevent 4")  # Back (알림창 닫기)
        time.sleep(1)
        adb(f"input swipe {SCREEN_W // 2} {int(SCREEN_H * 0.8)} {SCREEN_W // 2} {int(SCREEN_H * 0.2)} 500")
        time.sleep(2)


def ensure_tiktok_foreground():
    """TikTok이 포그라운드인지 확인, 아니면 복귀"""
    wake_screen()
    # 재확인
    focus = adb("dumpsys window | grep mCurrentFocus")
    if TIKTOK_PKG not in focus:
        logger.warning(f"  TikTok이 포그라운드 아님 ({focus.split('/')[-1][:30]}), 복귀...")
        adb(f"monkey -p {TIKTOK_PKG} -c android.intent.category.LAUNCHER 1")
        time.sleep(3)
        # 한 번 더 확인
        focus2 = adb("dumpsys window | grep mCurrentFocus")
        if TIKTOK_PKG not in focus2:
            # 강제 실행
            adb(f"am start -n {TIKTOK_PKG}/com.ss.android.ugc.aweme.splash.SplashActivity")
            time.sleep(3)


def get_ui_dump(pause_video: bool = False) -> str:
    """UI dump — 태블릿은 /data/local/tmp/ 경로 사용

    pause_video=True: 영상 재생 중 idle 상태 확보를 위해 화면 탭(일시정지) 후 dump
    """
    if pause_video:
        # 영상 재생 중이면 uiautomator가 idle state를 얻지 못함
        # → 화면 중앙 탭으로 일시정지 후 dump
        adb(f"input tap {SCREEN_W // 2} {SCREEN_H // 2}")
        time.sleep(1.5)

    adb(f"rm -f {UI_DUMP_PATH}")
    result = adb(f"uiautomator dump {UI_DUMP_PATH}")

    # "could not get idle state" / "null root node" 에러 → 일시정지 재시도 (최대 2회)
    if "ERROR" in result or "error" in result or "null" in result:
        for retry in range(2):
            logger.warning(f"  UI dump 실패 ({result[:50]}), 일시정지 후 재시도 {retry+1}...")
            adb(f"input tap {SCREEN_W // 2} {SCREEN_H // 2}")
            time.sleep(2)
            adb(f"rm -f {UI_DUMP_PATH}")
            result = adb(f"uiautomator dump {UI_DUMP_PATH}")
            if "ERROR" not in result and "error" not in result and "null" not in result:
                break

    full = f'adb -s {DEVICE} shell "cat {UI_DUMP_PATH}"'
    try:
        r = subprocess.run(full, shell=True, capture_output=True, timeout=10)
        xml = r.stdout.decode("utf-8", errors="replace")
        # 캐시된 AOD dump 감지 (노드 50개 미만 + common_hour 포함)
        if xml.count("<node") < 50 and "common_hour" in xml:
            logger.warning("  AOD dump 감지, 화면 깨우기 후 재시도...")
            wake_screen()
            time.sleep(2)
            adb(f"rm -f {UI_DUMP_PATH}")
            adb(f"uiautomator dump {UI_DUMP_PATH}")
            r = subprocess.run(full, shell=True, capture_output=True, timeout=10)
            xml = r.stdout.decode("utf-8", errors="replace")
        return xml
    except Exception as e:
        logger.warning(f"UI dump 실패: {e}")
        return ""


def parse_nodes(xml: str) -> list[dict]:
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
            return n
    return None


def find_nodes(nodes: list, **kwargs) -> list[dict]:
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
    m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', bounds_str)
    if m:
        x1, y1, x2, y2 = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
        return (x1 + x2) // 2, (y1 + y2) // 2
    return 0, 0


# ═══════════════════════════════════════════════════════════════════════════════
# 숫자 파싱
# ═══════════════════════════════════════════════════════════════════════════════

def parse_korean_count(text: str) -> int:
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

    # K
    m = re.match(r'([\d.]+)\s*[Kk천]', text)
    if m:
        return int(float(m.group(1)) * 1_000)

    # M
    m = re.match(r'([\d.]+)\s*[Mm]', text)
    if m:
        return int(float(m.group(1)) * 1_000_000)

    # B (billion)
    m = re.match(r'([\d.]+)\s*[Bb]', text)
    if m:
        return int(float(m.group(1)) * 1_000_000_000)

    # 순수 숫자
    m = re.match(r'[\d,.]+', text)
    if m:
        try:
            return int(m.group(0).replace(",", ""))
        except ValueError:
            pass
    return 0


def parse_relative_date(text: str) -> str:
    if not text:
        return ""
    text = text.strip().lstrip("·").strip()
    now = datetime.now()

    # 한국어: N일/주/개월/시간/분 전
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

    # 영어: Nd ago, Nw ago, Nm ago, Nh ago
    m = re.match(r'(\d+)\s*([dwmhsDWMHS])\s*(ago)?', text)
    if m:
        num = int(m.group(1))
        unit = m.group(2).lower()
        if unit == "d":
            dt = now - timedelta(days=num)
        elif unit == "w":
            dt = now - timedelta(weeks=num)
        elif unit == "m":
            dt = now - timedelta(days=num * 30)
        elif unit == "h":
            dt = now - timedelta(hours=num)
        elif unit == "s":
            dt = now
        else:
            return text
        return dt.strftime("%Y-%m-%d")

    # 절대 날짜
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
    text = caption.lower()
    ad_keywords = [
        "지금 설치하세요", "설치하기", "지금 구매", "지금 다운로드",
        "앱 다운로드", "지금 주문", "지금 가입", "무료 체험",
        "install now", "download now", "shop now", "buy now", "get the app",
        "sponsored", "프로모션", "프로모",
        "chatgpt images를 활용", "나만의 캐리커처",
    ]
    if any(kw in text for kw in ad_keywords):
        return True
    if nodes:
        for n in nodes:
            t = n.get("text", "")
            d = n.get("content-desc", "")
            if t in ("Sponsored", "광고", "Ad") or "광고" in d:
                return True
    return False


def classify_post(caption: str) -> str:
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
    return "General"


def make_slug(name_en: str) -> str:
    slug = name_en.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    slug = re.sub(r"-+", "-", slug)
    return slug


# ═══════════════════════════════════════════════════════════════════════════════
# TikTok 네비게이션 (A90 resource-id 대응)
# ═══════════════════════════════════════════════════════════════════════════════

def extract_username_from_url(tiktok_url: str) -> str:
    m = re.search(r'@([A-Za-z0-9_.]+)', tiktok_url)
    return m.group(1).lower() if m else ""


def open_profile(tiktok_url: str) -> bool:
    ensure_tiktok_foreground()
    adb(f"am start -a android.intent.action.VIEW -d '{tiktok_url}'")
    time.sleep(DELAY["profile_load"])
    # 로드 확인: 팝업이 떴을 수 있으므로 focus 재확인
    focus = adb("dumpsys window | grep mCurrentFocus")
    if "UniversalPopup" in focus or "Popup" in focus:
        logger.info("  팝업 감지, 뒤로가기...")
        adb("input keyevent 4")
        time.sleep(2)
    return True


def verify_profile(expected_username: str, nodes: list = None, max_retries: int = 2) -> tuple[str, list]:
    """프로필 검증 — @username 텍스트 노드 직접 검색"""
    for attempt in range(max_retries + 1):
        xml = get_ui_dump()
        nodes = parse_nodes(xml)

        # @ 로 시작하는 텍스트 노드를 직접 찾음 (resource-id에 의존하지 않음)
        actual = ""
        for n in nodes:
            text = n.get("text", "").strip()
            if text.startswith("@") and len(text) > 2:
                actual = text.lstrip("@").lower()
                break

        if not expected_username or actual == expected_username:
            return xml, nodes

        if attempt < max_retries:
            logger.warning(f"  프로필 불일치: 기대={expected_username} 실제={actual or '(없음)'}, 재시도 {attempt+1}...")
            back()
            time.sleep(1)
            adb(f"am start -a android.intent.action.VIEW -d 'https://www.tiktok.com/@{expected_username}'")
            time.sleep(DELAY["profile_load"] + 2)
        else:
            logger.error(f"  프로필 불일치 해소 실패: 기대={expected_username} 실제={actual or '(없음)'}")

    return xml, nodes


def extract_profile(nodes: list) -> dict:
    """프로필 추출 — A90 resource-id 대응 (r0f/r0e + r1q/r1p 둘 다 시도)"""
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

    # 방법 1: A90 방식 (r0f=수치, r0e=라벨)
    stat_values = find_nodes(nodes, resource_id="r0f")
    stat_labels = find_nodes(nodes, resource_id="r0e")

    # 방법 2: S23 방식 (r1q=수치, r1p=라벨)
    if not stat_values:
        stat_values = find_nodes(nodes, resource_id="r1q")
        stat_labels = find_nodes(nodes, resource_id="r1p")

    for val_node, lbl_node in zip(stat_values, stat_labels):
        val = val_node.get("text", "")
        lbl = lbl_node.get("text", "")
        num = parse_korean_count(val)

        if "팔로잉" in lbl or "Following" in lbl:
            profile["following"] = num
        elif "팔로워" in lbl or "Followers" in lbl:
            profile["followers"] = num
        elif "좋아요" in lbl or "Likes" in lbl:
            profile["total_likes"] = num

    # 유저네임: A90=r1p(@가 있는 것), S23=r30
    for n in nodes:
        rid = n.get("resource-id", "").split("/")[-1]
        text = n.get("text", "").strip()
        if text.startswith("@") and rid in ("r1p", "r30", ""):
            profile["username"] = text
            break

    # 인증 배지
    verified_node = find_node(nodes, content_desc="인증 완료")
    if not verified_node:
        verified_node = find_node(nodes, content_desc="Verified")
    profile["verified"] = verified_node is not None

    # 카테고리
    for rid_key in ["qwz", "qvo"]:
        cat_node = find_node(nodes, resource_id=rid_key)
        if cat_node:
            profile["category"] = cat_node.get("text", "")
            break

    # 표시 이름 (유저네임 위)
    for n in nodes:
        text = n.get("text", "").strip()
        bounds = n.get("bounds", "")
        rid = n.get("resource-id", "").split("/")[-1]
        if text and bounds and rid not in ("r0f", "r0e", "r1q", "r1p"):
            m = re.match(r'\[(\d+),(\d+)\]', bounds)
            if m and 300 < int(m.group(2)) < 550:
                if "@" not in text and text not in ["아티스트", "크리에이터", "공인", "Artist"]:
                    profile["display_name"] = text
                    break

    # Bio
    for n in nodes:
        text = n.get("text", "").strip()
        bounds = n.get("bounds", "")
        rid = n.get("resource-id", "").split("/")[-1]
        if text and len(text) > 15 and bounds and rid not in ("r0f", "r0e", "r1q", "r1p"):
            m = re.match(r'\[(\d+),(\d+)\]', bounds)
            if m and 700 < int(m.group(2)) < 1200:
                profile["bio"] = text[:500]
                break

    return profile


def extract_grid_views(nodes: list) -> list[int]:
    """그리드 조회수 — yrd (A90) + ysg (S23) 둘 다 시도"""
    views = []
    for rid_key in ["yrd", "ysg"]:
        view_nodes = find_nodes(nodes, resource_id=rid_key)
        if view_nodes:
            for n in view_nodes:
                text = n.get("text", "")
                views.append(parse_korean_count(text))
            break
    return views


def get_grid_positions(nodes: list) -> list[tuple[int, int]]:
    """그리드 비디오 좌표 — yrd (A90) + ysg (S23) 둘 다 시도"""
    positions = []
    thumb_h = SCREEN_W // 3  # 3열 그리드

    for rid_key in ["yrd", "ysg"]:
        view_nodes = find_nodes(nodes, resource_id=rid_key)
        if view_nodes:
            for n in view_nodes:
                bounds = n.get("bounds", "")
                if bounds:
                    cx, cy = get_bounds_center(bounds)
                    # 조회수 라벨 위의 썸네일 중앙
                    positions.append((cx, cy - thumb_h // 2 - 20))
            break
    return positions


def extract_video_detail(nodes: list) -> dict:
    """비디오 상세 페이지 데이터 추출 — A90 + S23 통합 대응

    A90 engagement 구조 (content-desc 기반):
      fb1: "동영상에 '좋아요'를 누릅니다. 좋아요 2,592개"
      dz4: "댓글을 읽거나 추가합니다. 댓글 26개"
      h3r: "이 동영상을 즐겨찾기에 추가..." (저장 수치 없을 수 있음)
      fb1: "동영상을 공유합니다. 공유 29회"

    S23 engagement 구조 (text 기반):
      fat: 좋아요 수, duk: 댓글 수, h3d: 저장 수, txs: 공유 수
    """
    post = {
        "views": 0, "likes": 0, "comments": 0, "shares": 0, "saves": 0,
        "posted_at": "", "caption": "", "hashtags": [], "music": "", "category": "",
    }

    # ── 1. content-desc 기반 통합 추출 (A90 + S23 모두 동작) ──
    for n in nodes:
        desc = n.get("content-desc", "")
        rid = n.get("resource-id", "").split("/")[-1]

        # 좋아요: "좋아요 N개" 패턴
        if post["likes"] == 0 and ("좋아요" in desc and "개" in desc):
            m = re.search(r'좋아요\s*([\d,.]+[만억KMB]?)\s*개', desc)
            if m:
                post["likes"] = parse_korean_count(m.group(1))

        # 댓글: "댓글 N개" 패턴
        if post["comments"] == 0 and ("댓글" in desc and "개" in desc):
            m = re.search(r'댓글\s*([\d,.]+[만억KMB]?)\s*개', desc)
            if m:
                post["comments"] = parse_korean_count(m.group(1))

        # 공유: "공유 N회" 패턴
        if post["shares"] == 0 and ("공유" in desc and "회" in desc):
            m = re.search(r'공유\s*([\d,.]+[만억KMB]?)\s*회', desc)
            if m:
                post["shares"] = parse_korean_count(m.group(1))

        # 저장/즐겨찾기: "즐겨찾기 N개" 또는 "저장 N개"
        if post["saves"] == 0 and ("즐겨찾기" in desc or "저장" in desc or "Bookmark" in desc):
            m = re.search(r'(?:즐겨찾기|저장|Bookmark)\s*([\d,.]+[만억KMB]?)\s*(?:개|$)', desc)
            if m:
                post["saves"] = parse_korean_count(m.group(1))

        # 음악
        if not post["music"] and ("사운드:" in desc or "sound:" in desc.lower()):
            post["music"] = re.sub(r'^사운드:\s*', '', desc).strip()[:200]

    # ── 2. text 노드 직접 추출 (A90: far/dug/h35/tx1, S23: fat/duk/h3d/txs) ──
    for likes_rid in ["far", "fat"]:
        if post["likes"] == 0:
            n = find_node(nodes, resource_id=likes_rid)
            if n and n.get("text", ""):
                post["likes"] = parse_korean_count(n["text"])

    for comments_rid in ["dug", "duk"]:
        if post["comments"] == 0:
            n = find_node(nodes, resource_id=comments_rid)
            if n and n.get("text", ""):
                post["comments"] = parse_korean_count(n["text"])

    for saves_rid in ["h35", "h3d"]:
        if post["saves"] == 0:
            n = find_node(nodes, resource_id=saves_rid)
            if n and n.get("text", ""):
                post["saves"] = parse_korean_count(n["text"])

    for shares_rid in ["tx1", "txs"]:
        if post["shares"] == 0:
            n = find_node(nodes, resource_id=shares_rid)
            if n and n.get("text", ""):
                post["shares"] = parse_korean_count(n["text"])

    # ── 3. 게시일 ──
    # S23: ytg 노드
    date_node = find_node(nodes, resource_id="ytg")
    if date_node:
        post["posted_at"] = parse_relative_date(date_node.get("text", ""))

    # A90 폴백: 텍스트에서 날짜 패턴 검색
    if not post["posted_at"]:
        for n in nodes:
            text = n.get("text", "")
            if re.search(r'\d+\s*(일|주|개월|시간|분|초)\s*전', text):
                post["posted_at"] = parse_relative_date(text)
                break
            if re.search(r'\d+\s*[dwmhs]\s*(ago)?', text, re.I):
                post["posted_at"] = parse_relative_date(text)
                break

    # ── 4. 캡션 ──
    # S23: desc 노드
    desc_node = find_node(nodes, resource_id="desc")
    if desc_node:
        caption = desc_node.get("text", "")
        caption = re.sub(r'\s*번역\s*보기\s*$', '', caption).strip()
        post["caption"] = caption[:1000]
        post["hashtags"] = re.findall(r'(?<!&)#([A-Za-z가-힣_]\w*)', caption)[:20]

    # A90 폴백: 긴 텍스트 노드에서 캡션 검색
    if not post["caption"]:
        for n in nodes:
            text = n.get("text", "")
            rid = n.get("resource-id", "").split("/")[-1]
            # 프로필/날짜/시계 노드 제외
            if len(text) > 10 and rid not in ("common_date", "common_hour", "common_minute"):
                if "#" in text or len(text) > 30:
                    caption = re.sub(r'\s*번역\s*보기\s*$', '', text).strip()
                    post["caption"] = caption[:1000]
                    post["hashtags"] = re.findall(r'(?<!&)#([A-Za-z가-힣_]\w*)', caption)[:20]
                    break

    post["category"] = classify_post(post["caption"])
    return post


# ═══════════════════════════════════════════════════════════════════════════════
# 메인 크롤링 로직
# ═══════════════════════════════════════════════════════════════════════════════

def crawl_group(group: dict) -> dict:
    """1개 그룹 크롤링 — A90 대응"""
    name = group["name"]
    name_en = group["name_en"]
    tiktok_url = group.get("info", {}).get("틱톡", "")
    slug = make_slug(name_en)

    result = {
        "name": name, "name_en": name_en, "slug": slug,
        "tiktok_url": tiktok_url,
        "crawled_at": datetime.now().isoformat(),
        "profile": {}, "posts": [], "stats": {},
    }

    if not tiktok_url:
        result["error"] = "TikTok URL 없음"
        return result

    try:
        # 1. 프로필 열기 + 검증
        expected_user = extract_username_from_url(tiktok_url)
        open_profile(tiktok_url)
        xml, nodes = verify_profile(expected_user)

        if len(nodes) < 10:
            logger.warning(f"  UI 노드 부족 ({len(nodes)}), 재시도...")
            time.sleep(4)
            xml, nodes = verify_profile(expected_user, max_retries=1)

        # 2. 프로필 추출
        profile = extract_profile(nodes)
        result["profile"] = profile
        logger.info(f"  프로필: {profile.get('display_name', '')} | "
                     f"팔로워 {profile['followers']:,} | "
                     f"좋아요 {profile['total_likes']:,}")

        # 3. 그리드 조회수 + 위치 (재시도 포함)
        grid_views = extract_grid_views(nodes)
        grid_positions = get_grid_positions(nodes)

        if not grid_positions:
            for grid_retry in range(4):
                wait_sec = 3 + grid_retry * 2
                logger.warning(f"  그리드 비디오 없음, 재시도 {grid_retry+1}/4 ({wait_sec}초 대기)...")

                # 팝업 닫기 시도
                for n in nodes:
                    t = n.get("text", "")
                    if t in ("나중에 하기", "닫기", "Close", "Not now", "Skip", "취소", "Maybe later"):
                        bounds = n.get("bounds", "")
                        if bounds:
                            cx, cy = get_bounds_center(bounds)
                            tap(cx, cy, f"dismiss:{t}")
                            time.sleep(1)
                            break

                # 살짝 스크롤하여 그리드 렌더링 트리거
                adb(f"input swipe {SCREEN_W // 2} {int(SCREEN_H * 0.7)} {SCREEN_W // 2} {int(SCREEN_H * 0.5)} 200")
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
            logger.warning("  그리드 비디오 없음 (4회 재시도 실패)")
            return result

        # 4. 첫 비디오 클릭
        first_pos = grid_positions[0]
        tap(first_pos[0], first_pos[1], "first_video")
        time.sleep(DELAY["video_load"])

        # 비디오 진입 확인 (영상 재생 중 idle 불가 → 일시정지 후 dump)
        check_xml = get_ui_dump(pause_video=True)
        check_nodes = parse_nodes(check_xml)

        # 비디오 진입 확인: fb1(A90 좋아요/공유), fat(S23), 또는 content-desc에 '좋아요' 포함
        def check_video_page(ns):
            if find_node(ns, resource_id="fat"):
                return True
            if find_node(ns, resource_id="fb1"):
                return True
            for n in ns:
                desc = n.get("content-desc", "")
                if "좋아요" in desc and "개" in desc:
                    return True
            return False

        video_entered = check_video_page(check_nodes)

        if not video_entered:
            logger.warning("  비디오 페이지 미진입, 재시도...")
            tap(first_pos[0], first_pos[1] - 80, "retry_first_video")
            time.sleep(DELAY["video_load"] + 1)
            check_xml = get_ui_dump(pause_video=True)
            check_nodes = parse_nodes(check_xml)
            video_entered = check_video_page(check_nodes)
            if not video_entered:
                logger.warning("  비디오 페이지 2차 실패, 프로필만 저장")
                return result

        # 5. 비디오 순회 (스와이프)
        posts = []
        cutoff_date = (datetime.now() - timedelta(days=DAYS_BACK)).strftime("%Y-%m-%d")
        real_vi = 0
        ad_count = 0
        prev_caption = ""
        prev_fingerprint = ""
        consecutive_dup = 0
        consecutive_zero = 0

        for vi in range(MAX_VIDEOS_PER_GROUP + 15):
            xml = get_ui_dump(pause_video=True)  # 영상 재생 중 idle 확보
            nodes = parse_nodes(xml)
            post = extract_video_detail(nodes)

            # 빈 데이터 감지
            if post["likes"] == 0 and post["comments"] == 0 and not post["caption"]:
                consecutive_zero += 1
                if consecutive_zero >= 3:
                    logger.warning(f"  연속 빈 데이터 {consecutive_zero}회 — TikTok 확인")
                    ensure_tiktok_foreground()
                    back()
                    time.sleep(1)
                    break
                swipe_up()
                continue
            else:
                consecutive_zero = 0

            # 광고 필터
            if is_ad(post["caption"], nodes):
                ad_count += 1
                consecutive_dup += 1
                if consecutive_dup >= 3:
                    logger.info(f"  연속 광고/중복 {consecutive_dup}회 — 피드 끝")
                    break
                swipe_up()
                continue

            # 중복 감지
            post_fingerprint = f"{post['likes']}_{post['comments']}_{post['saves']}_{post['shares']}"
            is_dup = False
            if post["caption"] and post["caption"] == prev_caption:
                is_dup = True
            elif not post["caption"] and post_fingerprint == prev_fingerprint:
                is_dup = True

            if is_dup:
                consecutive_dup += 1
                if consecutive_dup >= 2:
                    logger.info(f"  연속 중복 {consecutive_dup}회 — 피드 끝")
                    break
                swipe_up()
                continue

            prev_caption = post["caption"]
            prev_fingerprint = post_fingerprint
            consecutive_dup = 0

            # 그리드 조회수 보완
            if real_vi < len(grid_views):
                post["views"] = grid_views[real_vi]

            # 날짜 확인
            if post["posted_at"] and post["posted_at"] < cutoff_date:
                logger.info(f"  [{real_vi+1}] {post['posted_at']} — 30일 이전, 중단")
                break

            posts.append(post)
            real_vi += 1
            logger.info(f"  [{real_vi}] 좋아요:{post['likes']:,} 댓글:{post['comments']:,} "
                         f"저장:{post['saves']:,} 공유:{post['shares']:,} "
                         f"날짜:{post['posted_at']} | {post['caption'][:40]}")

            swipe_up()

        if ad_count > 0:
            logger.info(f"  광고 {ad_count}개 필터링")

        # 6. 프로필로 복귀
        back()
        time.sleep(DELAY["transition"])

        result["posts"] = posts

        # 7. 통계 계산
        if posts:
            total = len(posts)
            result["stats"] = {
                "total_posts_crawled": total,
                "posts_last_30d": total,
                "avg_views": sum(p["views"] for p in posts) // total,
                "avg_likes": sum(p["likes"] for p in posts) // total,
                "avg_comments": sum(p["comments"] for p in posts) // total,
                "avg_shares": sum(p["shares"] for p in posts) // total,
                "avg_saves": sum(p["saves"] for p in posts) // total,
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
    path = GROUPS_DIR / f"{slug}.json"
    content = json.dumps(data, ensure_ascii=False, indent=2)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
        f.flush()
        os.fsync(f.fileno())


def main():
    parser = argparse.ArgumentParser(description="A90 TikTok 재크롤링")
    parser.add_argument("--test", type=str, default="",
                        help="테스트할 그룹 (콤마 구분, name_en)")
    parser.add_argument("--max-groups", type=int, default=0)
    parser.add_argument("--skip", type=int, default=0,
                        help="처음 N개 건너뛰기")
    args = parser.parse_args()

    # ADB 연결 확인
    r = subprocess.run(f"adb -s {DEVICE} shell echo ok",
                       shell=True, capture_output=True, text=True, timeout=5)
    if "ok" not in r.stdout:
        logger.error(f"디바이스 {DEVICE} 연결 안 됨")
        sys.exit(1)
    logger.info(f"디바이스 연결 확인: {DEVICE} (Samsung R14 Tablet, {SCREEN_W}x{SCREEN_H})")

    # namu-wiki.json에서 대상 그룹 로드
    with open(NAMU_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)

    # 대상 필터링
    if args.test:
        test_names = [n.strip() for n in args.test.split(",")]
        targets = [g for g in data["groups"]
                   if g.get("info", {}).get("틱톡", "").strip()
                   and (g["name_en"] in test_names or g["name"] in test_names)]
    else:
        target_set = set(RECRAWL_TARGETS)
        targets = [g for g in data["groups"]
                   if g.get("info", {}).get("틱톡", "").strip()
                   and g["name_en"] in target_set]

    if args.skip > 0:
        targets = targets[args.skip:]
    if args.max_groups > 0:
        targets = targets[:args.max_groups]

    logger.info(f"재크롤링 시작: {len(targets)}개 그룹")

    success = 0
    fail = 0

    for gi, group in enumerate(targets):
        name = group["name"]
        name_en = group["name_en"]
        slug = make_slug(name_en)

        logger.info(f"\n{'='*60}")
        logger.info(f"[{gi+1}/{len(targets)}] {name} ({name_en})")
        logger.info(f"{'='*60}")

        result = crawl_group(group)
        posts_count = len(result.get("posts", []))

        # 기존 데이터 로드하여 비교
        existing_path = GROUPS_DIR / f"{slug}.json"
        old_posts = 0
        if existing_path.exists():
            with open(existing_path, "r", encoding="utf-8") as f:
                old = json.load(f)
            old_posts = len(old.get("posts", []))

        # 새 데이터가 기존보다 많거나 같으면 저장, 아니면 스킵
        if posts_count >= old_posts:
            save_group_data(slug, result)
            logger.info(f"  → 저장: {posts_count}개 게시물 (기존 {old_posts}개)")
            success += 1
        else:
            logger.warning(f"  → 스킵: 새 {posts_count}개 < 기존 {old_posts}개 (기존 유지)")
            fail += 1

        if gi < len(targets) - 1:
            time.sleep(DELAY["between_groups"])

    logger.info(f"\n{'='*60}")
    logger.info(f"재크롤링 완료: 성공 {success}개, 스킵 {fail}개")


if __name__ == "__main__":
    main()
