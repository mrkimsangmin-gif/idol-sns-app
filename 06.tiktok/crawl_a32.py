#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys, io
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
"""
crawl_a32.py — Samsung Galaxy A32 디바이스용 TikTok ADB 크롤러

핵심 개선: 프로필 그리드를 먼저 스크롤하여 ALL 조회수를 사전 수집한 뒤,
비디오 상세로 진입하여 views를 매칭. 기존 크롤러는 첫 화면 3~6개만 views 확보 가능.

수집 항목:
  프로필: 팔로워, 팔로잉, 좋아요 합계, 인증 여부, bio
  게시물 (최근 30일): 조회수, 좋아요, 댓글, 공유, 저장, 날짜, 캡션, 분류

사용법:
  python crawl_a32.py                          # 전체 그룹
  python crawl_a32.py --test 에스파            # 특정 그룹 테스트
  python crawl_a32.py --resume                 # 중단 지점부터 재개
  python crawl_a32.py --failed-only            # 0 팔로워 5개 그룹만
  python crawl_a32.py --recrawl-views          # 전체 118개 views 재수집
  python crawl_a32.py --max-groups 10          # 최대 N개
  python crawl_a32.py --profile-only           # 프로필만 수집

ER 공식: likes-based = (comments + shares + saves) / likes * 100
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
SUMMARY_FILE = TIKTOK_DIR / "tiktok-summary-a32.json"
PROGRESS_FILE = TIKTOK_DIR / "crawl-progress-a32.json"

GROUPS_DIR.mkdir(parents=True, exist_ok=True)

# ─── A32 디바이스 설정 ──────────────────────────────────────────────────────────
DEVICE = "RF9R7042F3K"  # Samsung Galaxy A32
TIKTOK_PKG = "com.ss.android.ugc.trill"
SCREEN_W, SCREEN_H = 1080, 2400  # A32: 1080x2400

# ─── Resource ID 매핑 (Primary: S23/A32 공통, Fallback: A90) ───────────────────
RID = {
    # 그리드 조회수 라벨 (A32=yrd, S23=ysg)
    "grid_views": ["yrd", "ysg"],
    # 프로필 통계 (A32: r0f/r0e, S23: r1q/r1p)
    "stat_value": ["r0f", "r1q"],
    "stat_label": ["r0e", "r1p"],
    # 비디오 상세 engagement (A32: far/dug/h35/tx1, S23: fat/duk/h3d/txs)
    "likes": ["far", "fat"],
    "comments": ["dug", "duk"],
    "saves": ["h35", "h3d"],
    "shares": ["tx1", "txs"],
    # 기타
    "date": ["ytg"],
    "caption": ["desc"],
    "username": ["r30"],
    "category": ["qvo", "qwz"],
}

# ─── 딜레이 (초) — A32는 중저사양이므로 여유 있게 ────────────────────────────────
DELAY = {
    "tap": 0.8,
    "transition": 2.0,
    "profile_load": 5.0,       # A32 더 느림 → 5초
    "video_load": 4.0,         # A32 더 느림 → 4초
    "scroll": 1.2,
    "back": 1.0,
    "between_groups": 3.0,
    "swipe": 1.5,
    "grid_scroll": 2.0,        # 그리드 스크롤 후 렌더링 대기
}

# ─── 크롤링 설정 ──────────────────────────────────────────────────────────────
DAYS_BACK = 30
MAX_VIDEOS_PER_GROUP = 30
MAX_SCROLLS_PROFILE = 10       # 그리드 스크롤 최대 횟수

# ─── 0 팔로워 재크롤링 대상 ────────────────────────────────────────────────────
FAILED_GROUPS = ["8TURN", "ALL(H)OURS", "CRAVITY", "MIRAE", "UNIS"]

# ─── 로깅 ─────────────────────────────────────────────────────────────────────
LOG_DIR = SCRIPT_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)
log_file = LOG_DIR / f"crawl_a32_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"

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
    """ADB 호스트 명령 실행 (shell 아닌 로컬 명령)"""
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
    """위로 스와이프 (다음 비디오) — 화면 비율 기반"""
    y_from = int(SCREEN_H * 0.75)  # 1800
    y_to = int(SCREEN_H * 0.33)    # 792
    adb(f"input swipe {SCREEN_W // 2} {y_from} {SCREEN_W // 2} {y_to} 300")
    time.sleep(DELAY["swipe"])


def swipe_down():
    """아래로 스와이프 (이전 비디오) — 화면 비율 기반"""
    y_from = int(SCREEN_H * 0.33)
    y_to = int(SCREEN_H * 0.75)
    adb(f"input swipe {SCREEN_W // 2} {y_from} {SCREEN_W // 2} {y_to} 300")
    time.sleep(DELAY["swipe"])


def grid_scroll_down():
    """프로필 그리드 아래로 스크롤 — 느린 스크롤로 렌더링 보장"""
    y_from = int(SCREEN_H * 0.75)  # 1800
    y_to = int(SCREEN_H * 0.38)    # 912
    adb(f"input swipe {SCREEN_W // 2} {y_from} {SCREEN_W // 2} {y_to} 300")
    time.sleep(DELAY["grid_scroll"])


def grid_scroll_up():
    """프로필 그리드 위로 스크롤 (복원용)"""
    y_from = int(SCREEN_H * 0.38)
    y_to = int(SCREEN_H * 0.75)
    adb(f"input swipe {SCREEN_W // 2} {y_from} {SCREEN_W // 2} {y_to} 300")
    time.sleep(DELAY["grid_scroll"])


def back():
    """뒤로가기"""
    adb("input keyevent 4")
    time.sleep(DELAY["back"])


def wake_screen():
    """화면 켜기 + 잠금해제 (A32 대응)"""
    # 화면 ON/OFF 확인
    power_state = adb("dumpsys power | grep -E 'mWakefulness|mScreenOn|Display Power'")
    screen_on = "Awake" in power_state or "mScreenOn=true" in power_state

    if not screen_on:
        logger.info("  화면 OFF → 켜기")
        adb("input keyevent 26")  # Power
        time.sleep(2)

    # NotificationShade/잠금화면 닫기
    focus = adb("dumpsys window | grep mCurrentFocus")
    if any(kw in focus for kw in ["NotificationShade", "Keyguard", "StatusBar", "Launcher"]):
        adb("input keyevent 4")  # Back (알림창 닫기)
        time.sleep(1)
        adb(f"input swipe {SCREEN_W // 2} {int(SCREEN_H * 0.83)} {SCREEN_W // 2} {int(SCREEN_H * 0.21)} 500")
        time.sleep(2)


def ensure_tiktok_foreground():
    """TikTok이 포그라운드인지 확인, 아니면 복귀"""
    wake_screen()
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


def dismiss_popups(nodes: list):
    """팝업/알림 닫기 시도"""
    dismiss_texts = ["나중에 하기", "닫기", "Close", "Not now", "Skip", "취소",
                     "Maybe later", "No thanks", "거부", "허용 안 함"]
    for n in nodes:
        t = n.get("text", "")
        if t in dismiss_texts:
            bounds = n.get("bounds", "")
            if bounds:
                cx, cy = get_bounds_center(bounds)
                tap(cx, cy, f"dismiss:{t}")
                time.sleep(1)
                return True
    return False


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
        xml = r.stdout.decode("utf-8", errors="replace")
        # AOD dump 감지 (노드 50개 미만 + common_hour 포함)
        if xml.count("<node") < 50 and "common_hour" in xml:
            logger.warning("  AOD dump 감지, 화면 깨우기 후 재시도...")
            wake_screen()
            time.sleep(2)
            adb("rm -f /sdcard/tiktok_dump.xml")
            adb("uiautomator dump /sdcard/tiktok_dump.xml")
            r = subprocess.run(full, shell=True, capture_output=True, timeout=10)
            xml = r.stdout.decode("utf-8", errors="replace")
        return xml
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


def find_nodes_multi_rid(nodes: list, rid_keys: list[str]) -> list[dict]:
    """여러 resource-id 후보 중 첫 번째 매칭되는 그룹 반환"""
    for rid in rid_keys:
        found = find_nodes(nodes, resource_id=rid)
        if found:
            return found
    return []


def find_node_multi_rid(nodes: list, rid_keys: list[str]) -> dict | None:
    """여러 resource-id 후보 중 첫 번째 매칭 노드 반환"""
    for rid in rid_keys:
        n = find_node(nodes, resource_id=rid)
        if n:
            return n
    return None


def get_bounds_center(bounds_str: str) -> tuple[int, int]:
    """bounds 문자열에서 중앙 좌표 추출"""
    m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', bounds_str)
    if m:
        x1, y1, x2, y2 = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
        return (x1 + x2) // 2, (y1 + y2) // 2
    return 0, 0


def get_bounds_y(bounds_str: str) -> int:
    """bounds에서 top Y 좌표 추출"""
    m = re.match(r'\[(\d+),(\d+)\]', bounds_str)
    if m:
        return int(m.group(2))
    return 0


# ═══════════════════════════════════════════════════════════════════════════════
# 숫자 파싱
# ═══════════════════════════════════════════════════════════════════════════════

def parse_korean_count(text: str) -> int:
    """한국어/영어 숫자 파싱: '1,666.9만' → 16669000, '7.8억' → 780000000"""
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

    # K / 천 단위
    m = re.match(r'([\d.]+)\s*[Kk천]', text)
    if m:
        return int(float(m.group(1)) * 1_000)

    # M 단위
    m = re.match(r'([\d.]+)\s*[Mm]', text)
    if m:
        return int(float(m.group(1)) * 1_000_000)

    # B 단위 (billion)
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
    """상대 날짜 → YYYY-MM-DD"""
    if not text:
        return ""
    text = text.strip().lstrip("·").strip()
    now = datetime.now()

    # 한국어: N일/주/개월/시간/분/초 전
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

    # 절대 날짜: YYYY-M-D
    abs_m = re.match(r'(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})', text)
    if abs_m:
        return f"{int(abs_m.group(1)):04d}-{int(abs_m.group(2)):02d}-{int(abs_m.group(3)):02d}"

    # M-D 형식
    md_m = re.match(r'(\d{1,2})[.\-/](\d{1,2})', text)
    if md_m:
        m_val, d_val = int(md_m.group(1)), int(md_m.group(2))
        if 1 <= m_val <= 12 and 1 <= d_val <= 31:
            return f"{now.year:04d}-{m_val:02d}-{d_val:02d}"

    return text


def is_ad(caption: str, nodes: list = None) -> bool:
    """광고 게시물 여부 판별"""
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

    # 광고 UI 마커 (노드 내 "Sponsored" / "광고" 라벨)
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
    """URL에서 @username 추출"""
    m = re.search(r'@([A-Za-z0-9_.]+)', tiktok_url)
    return m.group(1).lower() if m else ""


def open_profile(tiktok_url: str) -> bool:
    """딥링크로 TikTok 프로필 열기"""
    ensure_tiktok_foreground()
    adb(f"am start -a android.intent.action.VIEW -d '{tiktok_url}'")
    time.sleep(DELAY["profile_load"])
    # 팝업이 떴을 수 있으므로 focus 재확인
    focus = adb("dumpsys window | grep mCurrentFocus")
    if "UniversalPopup" in focus or "Popup" in focus:
        logger.info("  팝업 감지, 뒤로가기...")
        adb("input keyevent 4")
        time.sleep(2)
    return True


def verify_profile(expected_username: str, max_retries: int = 2) -> tuple[str, list]:
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
    """프로필 페이지 UI 노드에서 데이터 추출 — 다중 resource-id 대응"""
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

    # 통계값: 여러 resource-id 후보로 시도 (r1q/r1p → r0f/r0e)
    stat_values = find_nodes_multi_rid(nodes, RID["stat_value"])
    stat_labels = find_nodes_multi_rid(nodes, RID["stat_label"])

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

    # 유저네임 (@...) — resource-id 또는 @ 텍스트 직접 검색
    for n in nodes:
        rid = n.get("resource-id", "").split("/")[-1]
        text = n.get("text", "").strip()
        if text.startswith("@") and rid in ("r1p", "r0e", "r30", ""):
            profile["username"] = text
            break

    # 인증 배지
    verified_node = find_node(nodes, content_desc="인증 완료")
    if not verified_node:
        verified_node = find_node(nodes, content_desc="Verified")
    profile["verified"] = verified_node is not None

    # 카테고리 (아티스트 등)
    cat_node = find_node_multi_rid(nodes, RID["category"])
    if cat_node:
        profile["category"] = cat_node.get("text", "")

    # 표시 이름 (유저네임 위)
    for n in nodes:
        text = n.get("text", "").strip()
        bounds = n.get("bounds", "")
        rid = n.get("resource-id", "").split("/")[-1]
        if text and bounds and rid not in ("r0f", "r0e", "r1q", "r1p", "qvo", "qwz"):
            m = re.match(r'\[(\d+),(\d+)\]', bounds)
            if m and 250 < int(m.group(2)) < 550:
                if ("@" not in text and
                    text not in ["아티스트", "크리에이터", "공인", "Artist", "팔로우", "메시지"] and
                    len(text) < 40):
                    profile["display_name"] = text
                    break

    # Bio — 프로필 영역의 긴 텍스트
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


# ═══════════════════════════════════════════════════════════════════════════════
# 그리드 조회수 사전 수집 (핵심 개선점)
# ═══════════════════════════════════════════════════════════════════════════════

def _extract_grid_items_from_nodes(nodes: list) -> list[dict]:
    """현재 UI 노드에서 그리드 아이템 추출 (views + Y좌표)

    Returns: [{"views": int, "y": int, "text": str}, ...]  Y좌표 오름차순 정렬
    """
    items = []
    for rid in RID["grid_views"]:
        view_nodes = find_nodes(nodes, resource_id=rid)
        if view_nodes:
            for n in view_nodes:
                text = n.get("text", "")
                bounds = n.get("bounds", "")
                y = get_bounds_y(bounds)
                items.append({
                    "views": parse_korean_count(text),
                    "y": y,
                    "text": text,  # 원본 텍스트 (중복 비교용)
                })
            break
    # Y좌표 오름차순 정렬 (화면 위 → 아래)
    items.sort(key=lambda x: x["y"])
    return items


def collect_all_grid_views(nodes: list) -> list[int]:
    """프로필 그리드를 스크롤하며 ALL 조회수를 사전 수집

    핵심 로직:
    1. 현재 화면의 그리드 뷰 추출
    2. 스크롤 다운 → 새 뷰 추출 (이전과 겹치는 부분 제거)
    3. 반복: 새 항목이 없거나 MAX_SCROLLS_PROFILE 도달 시 종료
    4. 원래 위치로 복원 (스크롤 업 or 프로필 재진입)

    Returns: views 리스트 (위에서 아래 순서, 전체)
    """
    all_views = []
    prev_screen_items = []  # 이전 화면의 아이템 목록
    empty_scroll_count = 0  # 연속 빈 스크롤 횟수
    scroll_count = 0        # 총 스크롤 횟수
    target_count = MAX_VIDEOS_PER_GROUP + 10  # 수집 목표

    # ── 1단계: 현재 화면 (스크롤 전) 아이템 수집 ──
    current_items = _extract_grid_items_from_nodes(nodes)
    if not current_items:
        logger.warning("  그리드 뷰 없음 (초기 화면)")
        return []

    for item in current_items:
        all_views.append(item["views"])
    prev_screen_items = current_items
    logger.info(f"  [그리드] 초기 화면: {len(current_items)}개 → 누적 {len(all_views)}개")

    # ── 2단계: 스크롤하며 추가 수집 ──
    while scroll_count < MAX_SCROLLS_PROFILE:
        if len(all_views) >= target_count:
            logger.info(f"  [그리드] 목표 {target_count}개 도달 ({len(all_views)}개), 스크롤 중단")
            break

        grid_scroll_down()
        scroll_count += 1

        xml = get_ui_dump()
        nodes_new = parse_nodes(xml)
        current_items = _extract_grid_items_from_nodes(nodes_new)

        if not current_items:
            empty_scroll_count += 1
            logger.info(f"  [그리드] 스크롤 {scroll_count}: 빈 화면 (연속 {empty_scroll_count}회)")
            if empty_scroll_count >= 2:
                logger.info(f"  [그리드] 연속 빈 스크롤 2회 → 수집 완료")
                break
            continue
        empty_scroll_count = 0

        # ── 중복 제거: 이전 화면과 겹치는 아이템 스킵 ──
        # 이전 화면 하단 아이템들의 (views, text) 집합
        if prev_screen_items:
            # 이전 화면의 마지막 N개와 현재 화면의 처음 M개를 비교
            prev_tail_keys = set()
            for item in prev_screen_items:
                prev_tail_keys.add(item["text"])

            new_items = []
            found_new = False
            for item in current_items:
                if found_new:
                    # 한 번이라도 새 항목을 발견한 이후로는 전부 new
                    new_items.append(item)
                elif item["text"] not in prev_tail_keys:
                    # 이전 화면에 없는 항목 → 새 항목 시작점
                    found_new = True
                    new_items.append(item)
                # else: 이전 화면에 있었던 항목 → 스킵

            if not new_items:
                # 모든 항목이 이전과 동일 → 스크롤 끝에 도달
                empty_scroll_count += 1
                logger.info(f"  [그리드] 스크롤 {scroll_count}: 새 항목 0개 (모두 중복, 연속 {empty_scroll_count}회)")
                if empty_scroll_count >= 2:
                    logger.info(f"  [그리드] 연속 중복 2회 → 수집 완료")
                    break
                continue
        else:
            new_items = current_items

        # 새 항목 추가
        for item in new_items:
            all_views.append(item["views"])

        logger.info(f"  [그리드] 스크롤 {scroll_count}: +{len(new_items)}개 → 누적 {len(all_views)}개")
        prev_screen_items = current_items

    # ── 3단계: 프로필 맨 위로 복원 ──
    # 스크롤 횟수만큼 위로 복원 + 여유분 추가
    if scroll_count > 0:
        logger.info(f"  [그리드] 프로필 맨 위로 복원 중... ({scroll_count}회 스크롤 업)")
        for _ in range(scroll_count + 2):  # 여유분 +2
            grid_scroll_up()
        time.sleep(1)

    logger.info(f"  [그리드] 총 수집: {len(all_views)}개 조회수 (스크롤 {scroll_count}회)")
    return all_views


def get_grid_positions(nodes: list) -> list[tuple[int, int]]:
    """그리드 비디오 썸네일 중앙 좌표 추출 (첫 비디오 탭용)"""
    positions = []
    thumb_h = SCREEN_W // 3  # 3열 그리드 → 정사각형 썸네일

    for rid in RID["grid_views"]:
        view_nodes = find_nodes(nodes, resource_id=rid)
        if view_nodes:
            for n in view_nodes:
                bounds = n.get("bounds", "")
                if bounds:
                    cx, cy = get_bounds_center(bounds)
                    # 조회수 라벨 위의 썸네일 중앙
                    positions.append((cx, cy - thumb_h // 2 - 20))
            break
    return positions


# ═══════════════════════════════════════════════════════════════════════════════
# 비디오 상세 추출
# ═══════════════════════════════════════════════════════════════════════════════

def extract_video_detail(nodes: list) -> dict:
    """비디오 상세 페이지에서 데이터 추출 — A32 + A90 + S23 통합 대응

    1차: content-desc 패턴 매칭 (모든 디바이스 공통)
    2차: resource-id text 직접 읽기 (디바이스별 fallback)
    """
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

    # ── 1. content-desc 기반 통합 추출 (디바이스 무관) ──
    for n in nodes:
        desc = n.get("content-desc", "")

        # 좋아요: "좋아요 N개" 패턴
        if post["likes"] == 0 and ("좋아요" in desc and "개" in desc):
            m = re.search(r'좋아요\s*([\d,.]+[만억KMBkmb]?)\s*개', desc)
            if m:
                post["likes"] = parse_korean_count(m.group(1))

        # 댓글: "댓글 N개" 패턴
        if post["comments"] == 0 and ("댓글" in desc and "개" in desc):
            m = re.search(r'댓글\s*([\d,.]+[만억KMBkmb]?)\s*개', desc)
            if m:
                post["comments"] = parse_korean_count(m.group(1))

        # 공유: "공유 N회" 패턴
        if post["shares"] == 0 and ("공유" in desc and "회" in desc):
            m = re.search(r'공유\s*([\d,.]+[만억KMBkmb]?)\s*회', desc)
            if m:
                post["shares"] = parse_korean_count(m.group(1))

        # 저장/즐겨찾기
        if post["saves"] == 0 and ("즐겨찾기" in desc or "저장" in desc or "Bookmark" in desc):
            m = re.search(r'(?:즐겨찾기|저장|Bookmark)\s*([\d,.]+[만억KMBkmb]?)\s*(?:개|$)', desc)
            if m:
                post["saves"] = parse_korean_count(m.group(1))

        # 음악
        if not post["music"] and ("사운드:" in desc or "sound:" in desc.lower()):
            post["music"] = re.sub(r'^사운드:\s*', '', desc).strip()[:200]

    # ── 2. resource-id text 직접 추출 (fallback) ──
    for rid in RID["likes"]:
        if post["likes"] == 0:
            n = find_node(nodes, resource_id=rid)
            if n and n.get("text", ""):
                post["likes"] = parse_korean_count(n["text"])

    for rid in RID["comments"]:
        if post["comments"] == 0:
            n = find_node(nodes, resource_id=rid)
            if n and n.get("text", ""):
                post["comments"] = parse_korean_count(n["text"])

    for rid in RID["saves"]:
        if post["saves"] == 0:
            n = find_node(nodes, resource_id=rid)
            if n and n.get("text", ""):
                post["saves"] = parse_korean_count(n["text"])

    for rid in RID["shares"]:
        if post["shares"] == 0:
            n = find_node(nodes, resource_id=rid)
            if n and n.get("text", ""):
                post["shares"] = parse_korean_count(n["text"])

    # ── 3. 게시일 ──
    # resource-id 기반
    date_node = find_node_multi_rid(nodes, RID["date"])
    if date_node:
        post["posted_at"] = parse_relative_date(date_node.get("text", ""))

    # 텍스트 패턴 폴백
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
    # resource-id 기반
    desc_node = find_node_multi_rid(nodes, RID["caption"])
    if desc_node:
        caption = desc_node.get("text", "")
        caption = re.sub(r'\s*번역\s*보기\s*$', '', caption).strip()
        post["caption"] = caption[:1000]
        post["hashtags"] = re.findall(r'(?<!&)#([A-Za-z가-힣_]\w*)', caption)[:20]

    # 긴 텍스트 노드 폴백 (캡션 없을 때)
    if not post["caption"]:
        for n in nodes:
            text = n.get("text", "")
            rid = n.get("resource-id", "").split("/")[-1]
            if len(text) > 10 and rid not in ("common_date", "common_hour", "common_minute"):
                if "#" in text or len(text) > 30:
                    caption = re.sub(r'\s*번역\s*보기\s*$', '', text).strip()
                    post["caption"] = caption[:1000]
                    post["hashtags"] = re.findall(r'(?<!&)#([A-Za-z가-힣_]\w*)', caption)[:20]
                    break

    # 분류
    post["category"] = classify_post(post["caption"])
    return post


# ═══════════════════════════════════════════════════════════════════════════════
# 메인 크롤링 로직
# ═══════════════════════════════════════════════════════════════════════════════

def crawl_group(group: dict, profile_only: bool = False) -> dict:
    """1개 그룹의 TikTok 데이터 크롤링

    핵심 개선: collect_all_grid_views()로 그리드를 먼저 스크롤하여
    전체 조회수를 사전 수집한 뒤, 비디오 상세에서 매칭.
    """
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
            time.sleep(4)
            xml, nodes = verify_profile(expected_user, max_retries=1)

        # ─── 2. 프로필 데이터 추출 ───
        profile = extract_profile(nodes)
        result["profile"] = profile
        logger.info(f"  프로필: {profile.get('display_name', '')} | "
                     f"팔로워 {profile['followers']:,} | "
                     f"좋아요 {profile['total_likes']:,}")

        if profile_only:
            return result

        # ─── 3. 그리드 위치 확인 (재시도 포함) ───
        grid_positions = get_grid_positions(nodes)

        if not grid_positions:
            for grid_retry in range(4):
                wait_sec = 3 + grid_retry * 2
                logger.warning(f"  그리드 비디오 없음, 재시도 {grid_retry+1}/4 ({wait_sec}초 대기)...")

                # 팝업 닫기 시도
                dismiss_popups(nodes)

                # 살짝 스크롤하여 그리드 렌더링 트리거
                adb(f"input swipe {SCREEN_W // 2} {int(SCREEN_H * 0.58)} {SCREEN_W // 2} {int(SCREEN_H * 0.50)} 200")
                time.sleep(wait_sec)

                xml = get_ui_dump()
                nodes = parse_nodes(xml)
                grid_positions = get_grid_positions(nodes)
                if grid_positions:
                    logger.info(f"  그리드 재시도 {grid_retry+1}에서 발견: {len(grid_positions)}개")
                    break

        if not grid_positions:
            logger.warning("  그리드 비디오 없음 (4회 재시도 실패)")
            return result

        # ─── 4. [핵심] 그리드 스크롤하여 ALL 조회수 사전 수집 ───
        grid_views = collect_all_grid_views(nodes)
        logger.info(f"  사전 수집 조회수: {len(grid_views)}개 (첫 3개: {grid_views[:3]})")

        # 스크롤 복원 후 다시 그리드 위치 확인
        xml = get_ui_dump()
        nodes = parse_nodes(xml)
        grid_positions = get_grid_positions(nodes)

        if not grid_positions:
            # 복원 실패 → 프로필 재진입
            logger.warning("  그리드 복원 실패, 프로필 재진입...")
            open_profile(tiktok_url)
            time.sleep(2)
            xml = get_ui_dump()
            nodes = parse_nodes(xml)
            grid_positions = get_grid_positions(nodes)

        if not grid_positions:
            logger.warning("  그리드 복원 2차 실패")
            return result

        # ─── 5. 첫 비디오 클릭 → 상세 페이지 ───
        first_pos = grid_positions[0]
        tap(first_pos[0], first_pos[1], "first_video")
        time.sleep(DELAY["video_load"])

        # 비디오 진입 확인 (영상 재생 중 idle 불가 → 일시정지 후 dump)
        check_xml = get_ui_dump(pause_video=True)
        check_nodes = parse_nodes(check_xml)

        def check_video_page(ns):
            """비디오 상세 페이지 진입 여부 판별"""
            # resource-id 기반
            for rid in RID["likes"]:
                if find_node(ns, resource_id=rid):
                    return True
            # content-desc 기반
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

        # ─── 6. 비디오 상세 순회 (위로 스와이프) ───
        posts = []
        cutoff_date = (datetime.now() - timedelta(days=DAYS_BACK)).strftime("%Y-%m-%d")
        real_vi = 0        # 실제 게시물 인덱스 (광고/중복 제외)
        ad_count = 0       # 광고 횟수
        prev_caption = ""  # 중복 감지용
        prev_fingerprint = ""  # engagement 기반 중복 감지용
        consecutive_dup = 0    # 연속 중복 횟수
        consecutive_zero = 0   # 연속 빈 데이터 감지

        for vi in range(MAX_VIDEOS_PER_GROUP + 15):  # 광고 여유분 추가
            xml = get_ui_dump(pause_video=True)  # 영상 재생 중 idle 확보
            nodes_v = parse_nodes(xml)

            post = extract_video_detail(nodes_v)

            # 빈 데이터 감지 (TikTok 비활성 상태)
            if post["likes"] == 0 and post["comments"] == 0 and not post["caption"]:
                consecutive_zero += 1
                if consecutive_zero >= 3:
                    logger.warning(f"  연속 빈 데이터 {consecutive_zero}회 — TikTok 포그라운드 확인")
                    ensure_tiktok_foreground()
                    back()
                    time.sleep(1)
                    break
                swipe_up()
                continue
            else:
                consecutive_zero = 0

            # 광고 필터
            if is_ad(post["caption"], nodes_v):
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

            # [핵심] 사전 수집한 그리드 조회수 매칭
            if real_vi < len(grid_views):
                post["views"] = grid_views[real_vi]

            # 날짜 확인 — 30일 이전이면 중단
            if post["posted_at"] and post["posted_at"] < cutoff_date:
                logger.info(f"  [{real_vi+1}] {post['posted_at']} — 30일 이전, 중단")
                break

            posts.append(post)
            real_vi += 1
            logger.info(f"  [{real_vi}] 조회수:{post['views']:,} 좋아요:{post['likes']:,} "
                         f"댓글:{post['comments']:,} 저장:{post['saves']:,} "
                         f"공유:{post['shares']:,} 날짜:{post['posted_at']} | "
                         f"{post['caption'][:40]}")

            # 다음 비디오로 스와이프
            swipe_up()

        if ad_count > 0:
            logger.info(f"  광고 {ad_count}개 필터링됨")

        # ─── 7. 프로필로 돌아가기 ───
        back()
        time.sleep(DELAY["transition"])

        result["posts"] = posts

        # ─── 8. 통계 계산 (likes-based ER) ───
        if posts:
            total = len(posts)
            total_likes = sum(p["likes"] for p in posts)
            total_comments = sum(p["comments"] for p in posts)
            total_shares = sum(p["shares"] for p in posts)
            total_saves = sum(p["saves"] for p in posts)
            total_views = sum(p["views"] for p in posts)

            # ER = (comments + shares + saves) / likes * 100
            er_likes = 0.0
            if total_likes > 0:
                er_likes = round((total_comments + total_shares + total_saves) / total_likes * 100, 2)

            # views 기반 ER (참고용)
            er_views = 0.0
            if total_views > 0:
                total_eng = total_likes + total_comments + total_shares + total_saves
                er_views = round(total_eng / total_views * 100, 2)

            result["stats"] = {
                "total_posts_crawled": total,
                "posts_last_30d": total,
                "total_grid_views_collected": len(grid_views),
                "avg_views": total_views // total if total else 0,
                "avg_likes": total_likes // total if total else 0,
                "avg_comments": total_comments // total if total else 0,
                "avg_shares": total_shares // total if total else 0,
                "avg_saves": total_saves // total if total else 0,
                "engagement_rate": er_likes,
                "engagement_rate_views": er_views,
                "er_formula": "likes_based",
            }

    except Exception as e:
        result["error"] = f"{type(e).__name__}: {str(e)[:200]}"
        logger.error(f"  크롤링 실패: {result['error']}")

    return result


# ═══════════════════════════════════════════════════════════════════════════════
# 저장/로드
# ═══════════════════════════════════════════════════════════════════════════════

def safe_write_json(path: Path, data: dict):
    """Google Drive 안전 쓰기 (os.replace 사용 안 함!)"""
    content = json.dumps(data, ensure_ascii=False, indent=2)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
        f.flush()
        os.fsync(f.fileno())


def save_group_data(slug: str, data: dict):
    """개별 그룹 JSON 저장"""
    path = GROUPS_DIR / f"{slug}.json"
    safe_write_json(path, data)


def save_progress(completed: list):
    """진행 상태 저장"""
    safe_write_json(PROGRESS_FILE, {
        "completed": completed,
        "updated_at": datetime.now().isoformat(),
    })


def load_progress() -> list:
    """이전 진행 상태 로드"""
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("completed", [])
    return []


# ═══════════════════════════════════════════════════════════════════════════════
# 메인
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="A32 TikTok ADB 크롤러 (그리드 뷰 사전수집)")
    parser.add_argument("--test", type=str, default="",
                        help="테스트할 그룹명 (콤마 구분, name 또는 name_en)")
    parser.add_argument("--resume", action="store_true",
                        help="이전 진행에서 재개")
    parser.add_argument("--failed-only", action="store_true",
                        help="0 팔로워 5개 그룹만 재크롤링")
    parser.add_argument("--recrawl-views", action="store_true",
                        help="전체 118개 그룹 views 재수집")
    parser.add_argument("--profile-only", action="store_true",
                        help="프로필만 수집")
    parser.add_argument("--max-groups", type=int, default=0,
                        help="최대 처리 그룹 수")
    parser.add_argument("--skip", type=int, default=0,
                        help="처음 N개 건너뛰기")
    args = parser.parse_args()

    # ── ADB 연결 확인 ──
    r = subprocess.run(f"adb -s {DEVICE} shell echo ok",
                       shell=True, capture_output=True, text=True, timeout=5)
    if "ok" not in r.stdout:
        logger.error(f"디바이스 {DEVICE} 연결 안 됨")
        logger.error("adb devices 결과:")
        logger.error(subprocess.run("adb devices", shell=True, capture_output=True, text=True).stdout)
        sys.exit(1)
    logger.info(f"디바이스 연결 확인: {DEVICE} (Samsung Galaxy A32)")

    # ── 화면 꺼지지 않게 설정 ──
    adb("svc power stayon true")
    adb("settings put system screen_off_timeout 1800000")  # 30분
    logger.info("  화면 상시 켜짐 + 30분 타임아웃 설정")

    # ── namu-wiki.json 로드 ──
    with open(NAMU_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)

    groups = data["groups"]
    all_with_tiktok = [g for g in groups if g.get("info", {}).get("틱톡", "").strip()]
    logger.info(f"틱톡 URL 보유: {len(all_with_tiktok)}개")

    # ── 타겟 그룹 결정 ──
    if args.test:
        test_names = [n.strip() for n in args.test.split(",")]
        targets = [g for g in all_with_tiktok
                   if g["name"] in test_names or g["name_en"] in test_names]
        logger.info(f"테스트 모드: {test_names}")

    elif args.failed_only:
        # 0 팔로워 5개 그룹
        failed_set = set(FAILED_GROUPS)
        targets = [g for g in all_with_tiktok if g["name_en"] in failed_set]
        logger.info(f"실패 그룹 재크롤링: {FAILED_GROUPS}")

    elif args.recrawl_views:
        # 기존에 포스트가 있는 모든 그룹 (views 재수집)
        existing_slugs_with_posts = set()
        for gf in GROUPS_DIR.glob("*.json"):
            try:
                with open(gf, "r", encoding="utf-8") as f:
                    gdata = json.load(f)
                if len(gdata.get("posts", [])) > 0:
                    # name_en을 slug로 역추적은 어려우므로 name_en 저장
                    existing_slugs_with_posts.add(gdata.get("name_en", ""))
            except Exception:
                pass
        targets = [g for g in all_with_tiktok if g["name_en"] in existing_slugs_with_posts]
        logger.info(f"Views 재수집: {len(targets)}개 그룹")

    else:
        # 전체
        targets = all_with_tiktok

    # ── 재개 모드 ──
    is_test = bool(args.test)
    completed = []
    if args.resume:
        completed = load_progress()
        before = len(targets)
        targets = [g for g in targets if make_slug(g["name_en"]) not in completed]
        logger.info(f"재개: {len(completed)}개 완료, {before - len(targets)}개 스킵, {len(targets)}개 남음")

    # ── skip / max-groups 적용 ──
    if args.skip > 0:
        targets = targets[args.skip:]
    if args.max_groups > 0:
        targets = targets[:args.max_groups]

    logger.info(f"크롤링 시작: {len(targets)}개 그룹")
    if not targets:
        logger.info("대상 없음, 종료")
        return

    # ── 크롤링 루프 ──
    summary_data = []

    for gi, group in enumerate(targets):
        name = group["name"]
        name_en = group["name_en"]
        slug = make_slug(name_en)

        logger.info(f"\n{'='*60}")
        logger.info(f"[{gi+1}/{len(targets)}] {name} ({name_en})")
        logger.info(f"{'='*60}")

        result = crawl_group(group, args.profile_only)

        # ── 기존 데이터와 비교하여 더 나은 결과만 저장 ──
        existing_path = GROUPS_DIR / f"{slug}.json"
        old_posts = 0
        if existing_path.exists():
            try:
                with open(existing_path, "r", encoding="utf-8") as f:
                    old = json.load(f)
                old_posts = len(old.get("posts", []))
            except Exception:
                pass

        new_posts = len(result.get("posts", []))
        if new_posts >= old_posts:
            save_group_data(slug, result)
            logger.info(f"  -> 저장: {new_posts}개 게시물 (기존 {old_posts}개)")
        else:
            logger.warning(f"  -> 스킵: 새 {new_posts}개 < 기존 {old_posts}개 (기존 유지)")

        stats = result.get("stats", {})
        logger.info(f"  -> 게시물 {stats.get('total_posts_crawled', 0)}개, "
                     f"평균좋아요 {stats.get('avg_likes', 0):,}, "
                     f"ER(likes) {stats.get('engagement_rate', 0)}%")

        # ── 요약 데이터 ──
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
            "er_formula": stats.get("er_formula", "likes_based"),
            "grid_views_collected": stats.get("total_grid_views_collected", 0),
        })

        # ── 진행 저장 ──
        completed.append(slug)
        if not is_test:
            save_progress(completed)

        # ── 10개마다 interim 요약 저장 ──
        if (gi + 1) % 10 == 0:
            safe_write_json(SUMMARY_FILE, {
                "crawled_at": datetime.now().isoformat(),
                "device": "Samsung Galaxy A32",
                "total_groups": len(summary_data),
                "groups": summary_data,
            })
            logger.info(f"  [interim] {len(summary_data)}개 그룹 요약 저장됨")

        if gi < len(targets) - 1:
            time.sleep(DELAY["between_groups"])

    # ── 최종 요약 저장 ──
    safe_write_json(SUMMARY_FILE, {
        "crawled_at": datetime.now().isoformat(),
        "device": "Samsung Galaxy A32",
        "total_groups": len(summary_data),
        "settings": {
            "days_back": DAYS_BACK,
            "max_videos": MAX_VIDEOS_PER_GROUP,
            "er_formula": "likes_based: (comments + shares + saves) / likes * 100",
        },
        "groups": summary_data,
    })

    logger.info(f"\n{'='*60}")
    logger.info(f"크롤링 완료: {len(summary_data)}개 그룹")
    logger.info(f"요약: {SUMMARY_FILE}")

    # Top 10 팔로워
    top = sorted(summary_data, key=lambda x: x["followers"], reverse=True)[:10]
    logger.info("\nTop 10 팔로워:")
    for i, g in enumerate(top):
        logger.info(f"  {i+1}. {g['name']:15s} {g['followers']:>15,}")

    # Views 수집 통계
    views_count = [g for g in summary_data if g.get("grid_views_collected", 0) > 0]
    logger.info(f"\n그리드 조회수 수집 성공: {len(views_count)}/{len(summary_data)}개 그룹")

    # 화면 상시켜짐 해제
    adb("svc power stayon false")
    logger.info("화면 상시 켜짐 해제")


if __name__ == "__main__":
    main()
