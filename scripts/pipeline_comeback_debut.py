# -*- coding: utf-8 -*-
"""
scripts/pipeline_comeback_debut.py — 완성형 K-POP 컴백·데뷔 자동 수집 및 신뢰성 검증 파이프라인

핵심 아키텍처:
  1. [Trigger] Google 알리미(컴백/데뷔) 이메일 수신 (Gmail API)
  2. [URL 추출 & 1차 도메인 필터] 구글 리다이렉트에서 언론사 원문 직링크 디코딩 + 블로그/렉카 도메인 1차 컷
  3. [2차 안전장치: 네이버 검색제휴 교차검증]
     - 네이버 뉴스 API(openapi.naver.com)로 해당 아티스트와 날짜의 정식 기사 교차 검증
     - 포털 제휴 심사를 통과한 정식 언론사(CP 및 검색제휴 매체) 기사가 확인되면 팩트로 확정 (중소돌 100% 포용)
  4. [중복 방지 잠금 (Deduplication Lock)]
     - 동일 아티스트 + 동일 날짜는 1건으로 통합
     - 신규 그룹은 data/namu-index.json에 자동 등록
     - data/calendar.json에 데뷔/컴백 일정 등록 (원문 기사 링크 포함)
  5. [SSR 캘린더 자동 배포]
     - build/generate_comeback.py 실행으로 comeback/index.html 갱신
     - Git commit & push로 aimcontents.com 라이브 사이트 무인 자동 배포
"""
import sys
import os
import re
import json
import base64
import email
import argparse
import subprocess
import urllib.request
import urllib.parse
from datetime import datetime, date, timedelta
from pathlib import Path
from bs4 import BeautifulSoup
from dotenv import dotenv_values

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SCRIPT_DIR = Path(__file__).resolve().parent
APP_ROOT = SCRIPT_DIR.parent
DATA_DIR = APP_ROOT / "data"
INDEX_PATH = DATA_DIR / "namu-index.json"
CALENDAR_PATH = DATA_DIR / "calendar.json"

sys.path.insert(0, str(APP_ROOT / "07.hanteo"))
from comeback_alert import get_gmail_service
from artist_normalizer import normalize_artist

# Load Naver API Keys
WORK_AI_ENV = Path("G:/내 드라이브/01.Work/05.초록뱀/00.work_ai/.env")
env_vals = dotenv_values(WORK_AI_ENV) if WORK_AI_ENV.exists() else {}
NAVER_ID = env_vals.get("NAVER_CLIENT_ID")
NAVER_SECRET = env_vals.get("NAVER_CLIENT_SECRET")

# 1차 도메인 블랙리스트 (사이버렉카, 블로그, 유사언론)
BLOCKED_DOMAINS = [
    "tistory.com", "blogspot.com", "wordpress.com", "youtube.com", "youtu.be",
    "dcinside.com", "instiz.net", "theqoo.net", "fmkorea.com", "inven.co.kr"
]

# 주제 외 노이즈 키워드
NOISE_KEYWORDS = [
    "프로야구", "KBO", "골프", "축구", "야구", "배구", "농구", "기수", "대변인",
    "배우", "드라마", "영화", "감독", "예능", "MC", "주년", "선수", "재데뷔", "단독 콘서트",
    "서울시", "경기도", "지자체", "정부", "경찰", "법원", "검찰", "대통령", "국회"
]


def extract_direct_url(google_url: str) -> str:
    """구글 알리미 리다이렉트 URL에서 순수 언론사 원문 URL 추출"""
    if not google_url:
        return ""
    try:
        parsed = urllib.parse.urlparse(google_url)
        qs = urllib.parse.parse_qs(parsed.query)
        if "url" in qs:
            return qs["url"][0]
    except Exception:
        pass
    return google_url


def is_blocked_domain(url: str) -> bool:
    """개인 블로그/커뮤니티 등 유사 언론 도메인 여부 확인"""
    for bd in BLOCKED_DOMAINS:
        if bd in url.lower():
            return True
    return False


def fetch_alert_emails(service, max_results=50) -> list[dict]:
    """Gmail API로 Google 알리미(컴백/데뷔) 메일 수신 및 원문 URL 확보"""
    if not service:
        return []
    query = 'from:googlealerts-noreply@google.com (subject:"데뷔" OR subject:"컴백")'
    res = service.users().messages().list(userId="me", q=query, maxResults=max_results).execute()
    messages = res.get("messages", [])
    articles = []

    for m in messages:
        msg_id = m["id"]
        msg_data = service.users().messages().get(userId="me", id=msg_id, format="raw").execute()
        raw = base64.urlsafe_b64decode(msg_data["raw"].encode("ASCII"))
        msg = email.message_from_bytes(raw)
        date_str = msg.get("Date", "")

        def extract_from_html(html_data):
            soup = BeautifulSoup(html_data, "html.parser")
            for a in soup.find_all("a"):
                t = a.get_text(strip=True)
                raw_href = a.get("href", "")
                direct_url = extract_direct_url(raw_href)

                if t and len(t) > 6 and any(k in t for k in ["데뷔", "컴백", "신보", "발매", "출격", "신인"]):
                    if not is_blocked_domain(direct_url):
                        articles.append({"date": date_str, "title": t, "url": direct_url})

        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/html":
                    html = part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", errors="replace")
                    extract_from_html(html)
        else:
            payload = msg.get_payload(decode=True).decode(msg.get_content_charset() or "utf-8", errors="replace")
            extract_from_html(payload)

    return articles


def parse_schedule_candidates(articles: list[dict]) -> list[dict]:
    """뉴스 기사에서 아티스트명과 일자(M월 D일) 추출"""
    candidates = []
    seen = set()

    for a in articles:
        t = a["title"]
        if any(ign in t for ign in NOISE_KEYWORDS):
            continue

        # 날짜 추출 (M월 D일)
        m_date = re.search(r'(1[0-2]|[1-9])월\s*(\d{1,2})일', t)
        if not m_date:
            continue

        month = int(m_date.group(1))
        day = int(m_date.group(2))
        year = datetime.now().year
        d_str = f"{year}-{month:02d}-{day:02d}"

        # 아티스트 후보 추출 정규식
        m1 = re.search(r'신인\s+(?:걸그룹|보이그룹|아이돌|그룹)\s+[\'"]?([A-Za-z0-9가-힣\s]{2,15})[\'"]?(?:,|의|\s+|이|가|\(|\[|로|출격|데뷔|컴백)', t)
        m2 = re.search(r'^[\'"]?([A-Za-z0-9가-힣\s]{2,15})[\'"]?,\s*.*(?:컴백|데뷔)', t)
        m3 = re.search(r'([A-Za-z0-9가-힣\s]{2,15})\s+(?:컴백|데뷔)', t)

        art_name = None
        if m1:
            art_name = m1.group(1).strip()
        elif m2:
            art_name = m2.group(1).strip()
        elif m3:
            art_name = m3.group(1).strip()

        if art_name:
            art_name = re.sub(r'[\'\"\[\]\(\)]', '', art_name).strip()
            if art_name in ["오늘", "내일", "드디어", "가요계", "멤버", "출신", "프로듀서", "기획사", "걸그룹", "보이그룹", "아이돌", "팀"]:
                continue
            key = (art_name, d_str)
            if key not in seen and len(art_name) >= 2:
                seen.add(key)
                is_debut = "데뷔" in t
                candidates.append({
                    "artist": art_name,
                    "date": d_str,
                    "month_day": f"{month}월 {day}일",
                    "is_debut": is_debut,
                    "origin_url": a["url"],
                    "sample_title": t
                })

    return candidates


def verify_with_naver_news_partner(candidate: dict) -> dict | None:
    """
    네이버 뉴스 검색제휴(포털 정식 심사 통과 매체) 교차 검증:
    구글 알리미에 뜬 기사라도 네이버 검색제휴 언론사에 배포되지 않은 가짜/루머는 100% 탈락.
    단, 중소형 기획사가 bnt뉴스, 톱스타뉴스 등에 낸 기사는 1건만 있어도 정상 통과.
    """
    if not NAVER_ID or not NAVER_SECRET:
        return None

    art = candidate["artist"]
    md = candidate["month_day"]
    keyword = "데뷔" if candidate["is_debut"] else "컴백"

    # 엄격한 검색 질의: 아티스트명 + 날짜 + 키워드
    q = f'"{art}" "{md}" {keyword}'
    url = f"https://openapi.naver.com/v1/search/news.json?query={urllib.parse.quote(q)}&display=5&sort=sim"
    req = urllib.request.Request(url, headers={"X-Naver-Client-Id": NAVER_ID, "X-Naver-Client-Secret": NAVER_SECRET})

    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            items = data.get("items", [])
            if len(items) > 0:
                first = items[0]
                clean_title = first["title"].replace("<b>", "").replace("</b>", "").replace("&quot;", '"')
                final_link = first.get("originallink") or first.get("link") or candidate["origin_url"]
                return {
                    "artist": art,
                    "date": candidate["date"],
                    "is_debut": candidate["is_debut"],
                    "verified_title": clean_title,
                    "url": final_link,
                    "news_count": data.get("total", len(items))
                }
    except Exception:
        pass

    return None


def run_pipeline(dry_run=False):
    print("=" * 65)
    print("🚀 [1단계] Google 알리미 수신 및 원문 URL 확보")
    print("=" * 65)
    service = get_gmail_service()
    if not service:
        print("❌ Gmail API 연결 실패")
        return

    articles = fetch_alert_emails(service)
    print(f"✅ 구글 알리미 유효 기사 {len(articles)}건 수신 완료")

    candidates = parse_schedule_candidates(articles)
    print(f"✅ 일자/아티스트 특정 후보군 {len(candidates)}건 추출 완료")

    print("\n" + "=" * 65)
    print("🛡️ [2단계] 네이버 검색제휴(정식 심사 매체) 팩트체크 교차 검증")
    print("=" * 65)
    verified_list = []
    for cand in candidates:
        v = verify_with_naver_news_partner(cand)
        if v:
            tag = "데뷔" if v["is_debut"] else "컴백"
            print(f"  [✅ 검증 통과] [{v['date']}] {v['artist']} ({tag}) | 제휴 기사 {v['news_count']}건")
            print(f"      - 기사: {v['verified_title'][:60]}")
            print(f"      - 링크: {v['url']}")
            verified_list.append(v)
        else:
            print(f"  [❌ 검증 탈락/보류] {cand['artist']} ({cand['date']}) - 네이버 제휴 매체 보도 없음 (가짜/미확정 방지)")

    if not verified_list:
        print("\n새로 반영할 신규 검증 일정이 없습니다.")
        return

    if dry_run:
        print("\n[Dry-run 모드] 실제 DB 업데이트를 건너뜁니다.")
        return

    print("\n" + "=" * 65)
    print("💾 [3단계] 캘린더 반영 (중복 방지 잠금 + SSR 빌드 배포)")
    print("=" * 65)
    with open(INDEX_PATH, "r", encoding="utf-8") as f:
        idx_data = json.load(f)
    with open(CALENDAR_PATH, "r", encoding="utf-8") as f:
        cal_data = json.load(f)

    existing_slugs = {g["slug"]: g for g in idx_data.get("groups", [])}
    # (날짜, slug) 고유 키로 중복 원천 차단
    existing_event_keys = {(e.get("date"), (e.get("slug") or "").lower()) for e in cal_data.get("events", [])}

    added_count = 0
    for v in verified_list:
        # 아티스트 표준명, 정규화된 slug, 기본 성별 판별
        canon_name, slug, default_gender = normalize_artist(v["artist"])

        # 신규 그룹 자동 인덱싱
        if slug not in existing_slugs:
            gender = "여자" if ("걸그룹" in v["verified_title"] or default_gender == "여자") else "남자"
            idx_data["groups"].append({
                "name": canon_name,
                "name_en": canon_name,
                "slug": slug,
                "gender": gender,
                "agency": "확인 중",
                "debut_year": str(datetime.now().year),
                "album_count": 1,
                "member_count": 0,
                "members": []
            })
            existing_slugs[slug] = True
            print(f"  + 신규 아티스트 namu-index 자동 등록: {canon_name} ({slug})")

        event_key = (v["date"], slug)
        if event_key not in existing_event_keys:
            tag = "Debut" if v["is_debut"] else "Comeback"
            event_id = f"{'debut' if v['is_debut'] else 'comeback'}_{slug}_{v['date'].replace('-', '')}"
            cal_data["events"].append({
                "id": event_id,
                "date": v["date"],
                "title": f"{canon_name} ({tag})",
                "slug": slug,
                "description": f"{v['verified_title']} (기사: {v['url']})",
                "url": v["url"],
                "category": "comeback_debut",
                "source": "Verified News Partner"
            })
            existing_event_keys.add(event_key)
            added_count += 1
            print(f"  + 캘린더 일정 추가: [{v['date']}] {v['artist']} ({tag})")

    if added_count > 0:
        # 날짜순 정렬
        cal_data["events"].sort(key=lambda x: x.get("date", ""))
        with open(INDEX_PATH, "w", encoding="utf-8") as f:
            json.dump(idx_data, f, ensure_ascii=False, indent=2)
        with open(CALENDAR_PATH, "w", encoding="utf-8") as f:
            json.dump(cal_data, f, ensure_ascii=False, indent=2)
        print(f"\n🎉 총 {added_count}건의 검증된 일정이 캘린더에 안전하게 추가되었습니다.")

        # SSR 캘린더 빌드
        gen_script = APP_ROOT / "build" / "generate_comeback.py"
        if gen_script.exists():
            subprocess.run([sys.executable, str(gen_script)], check=True)
            print("✅ comeback/index.html SSR 빌드 갱신 완료")

        # Git 커밋 & 푸시
        try:
            subprocess.run(["git", "add", "data/calendar.json", "data/namu-index.json", "comeback/index.html"], cwd=str(APP_ROOT), check=True)
            msg = f"feat(calendar): 자동 수집 파이프라인 신규 {added_count}팀 컴백·데뷔 검증 일정 등록"
            subprocess.run(["git", "commit", "-m", msg], cwd=str(APP_ROOT), check=True)
            subprocess.run(["git", "push", "origin", "main"], cwd=str(APP_ROOT), check=True)
            print("🚀 GitHub 푸시 및 라이브 사이트 배포 완료!")
        except Exception as e:
            print(f"⚠️ Git 배포 중 알림: {e}")
    else:
        print("\n이미 최신 상태입니다. (추가할 신규 일정 없음)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="K-POP 컴백·데뷔 자동 수집 및 신뢰성 검증 파이프라인")
    parser.add_argument("--dry-run", action="store_true", help="등록 없이 탐지만 수행")
    args = parser.parse_args()
    run_pipeline(dry_run=args.dry_run)
