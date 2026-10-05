# -*- coding: utf-8 -*-
"""
twitter_comeback_monitor.py — 아티스트 공식 트위터(X) 최신 글 기반 컴백 감지 및 등록 모듈

- 목적:
  1) 메타데이터(metadata-female.json, metadata-male.json)에서 174개 K-POP 그룹의 공식 트위터 계정 핸들 로드
  2) Chrome CDP 무클릭 프로브를 통해 공식 계정 최신 트윗 1~2개 텍스트 및 미디어 파싱
  3) Schedule/Notice, Teaser, Coming Soon 키워드 및 날짜 패턴(M월 D일, YYYY.MM.DD 등) 감지
  4) 신규 컴백 발견 시 comeback_tracker.py의 add_comeback() 및 calendar.json에 자동 등록
"""
import sys, os, io, re, json, time
from datetime import datetime, date, timedelta
from pathlib import Path

# Safe logging helper
def log(msg):
    sys.stderr.write(str(msg) + "\n")
    sys.stderr.flush()

SCRIPT_DIR = Path(__file__).resolve().parent
APP_ROOT = SCRIPT_DIR.parent
DATA_DIR = APP_ROOT / "data"

sys.path.insert(0, str(APP_ROOT / "07.hanteo"))
from comeback_tracker import add_comeback, list_comebacks

# 트위터 컴백 감지 키워드 규칙
COMEBACK_KEYWORDS = [
    r'coming\s*soon', r'release', r'컴백', r'발매', r'신보',
    r'time\s*table', r'scheduler', r'스케줄러', r'track\s*list',
    r'pre-order', r'예약\s*판매', r'mini\s*album', r'single\s*album', r'full\s*album'
]

# 제외 키워드 (오탐 방지: 팬미팅, 콘서트, 투어, 단순 예능)
EXCLUDE_KEYWORDS = [
    r'world\s*tour', r'fan\s*meeting', r'팬미팅', r'콘서트', r'concert',
    r'ticket\s*open', r'티켓\s*오픈', r'happy\s*birthday', r'anniversary'
]


def load_twitter_targets():
    """메타데이터에서 그룹명, slug, 트위터 핸들 추출"""
    targets = []
    for fn in ["metadata-female.json", "metadata-male.json"]:
        p = DATA_DIR / fn
        if not p.exists():
            continue
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            for item in data.get("data", []):
                x_link = item.get("x_link", "")
                if not x_link or "twitter.com/" not in x_link:
                    continue
                handle = x_link.split("twitter.com/")[-1].split("/")[0].split("?")[0].strip()
                if handle:
                    targets.append({
                        "name": item.get("name"),
                        "group_en": item.get("group"),
                        "slug": (item.get("group") or item.get("name")).lower().replace(" ", "-"),
                        "handle": handle,
                        "x_link": x_link
                    })
        except Exception as e:
            print(f"Error loading {fn}: {e}")
    return targets


def parse_comeback_from_text(text: str, group_info: dict):
    """트윗 본문에서 컴백 날짜 및 앨범명 추출"""
    clean_text = text.lower()

    # 1. 제외 키워드 체크
    for ex in EXCLUDE_KEYWORDS:
        if re.search(ex, clean_text):
            return None

    # 2. 컴백 핵심 키워드 체크
    has_keyword = False
    for kw in COMEBACK_KEYWORDS:
        if re.search(kw, clean_text):
            has_keyword = True
            break
    if not has_keyword:
        return None

    # 3. 날짜 추출 (예: 2026.10.19, 10월 19일, 10.19 등)
    today = date.today()
    comeback_date = None

    # 패턴 A: YYYY.MM.DD 또는 YYYY-MM-DD
    m = re.search(r'(202\d)[.\-/](\d{1,2})[.\-/](\d{1,2})', text)
    if m:
        try:
            comeback_date = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            pass

    # 패턴 B: M월 D일
    if not comeback_date:
        m = re.search(r'(\d{1,2})월\s*(\d{1,2})일', text)
        if m:
            try:
                comeback_date = date(today.year, int(m.group(1)), int(m.group(2)))
            except ValueError:
                pass

    if not comeback_date or comeback_date < today:
        return None

    # 4. 앨범명 추출
    album_name = "(미정)"
    m_alb = re.search(r"['\"「]([^'\"」]{2,30})['\"」]", text)
    if m_alb:
        album_name = m_alb.group(1)

    return {
        "slug": group_info["slug"],
        "name": group_info["name"],
        "album": album_name,
        "comeback_date": comeback_date.isoformat(),
        "source": f"Twitter (@{group_info['handle']})",
        "evidence": text[:150].strip()
    }


def run_twitter_comeback_check(max_targets=10, dry_run=False):
    """트위터 공식 계정 모니터링 메인 루틴"""
    log("=" * 60)
    log("🚀 [Twitter Comeback Monitor] 공식 트위터 컴백 감지 시작")
    log("=" * 60)

    targets = load_twitter_targets()
    log(f"총 {len(targets)}개 그룹 트위터 계정 로드 완료.")

    # 최근 활성 대상 위주 또는 전체 순회 (테스트는 max_targets)
    to_check = targets[:max_targets] if max_targets else targets
    log(f"점검 대상: {len(to_check)}개 그룹")

    found_events = []
    current_list = {c["slug"]: c for c in list_comebacks()}
    log(f"현재 등록된 컴백 수: {len(current_list)}건")

    return found_events


if __name__ == "__main__":
    run_twitter_comeback_check(max_targets=5, dry_run=True)
