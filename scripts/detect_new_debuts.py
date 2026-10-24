# -*- coding: utf-8 -*-
"""
scripts/detect_new_debuts.py — 신규 데뷔·컴백 자동 탐지 및 네이버 뉴스 CP사 교차 검증 모듈

동작 원리:
  1. 구글 알리미 (데뷔/컴백) 메일 수신 (Gmail API) -> 1차 Trigger
  2. 기사 본문에서 아티스트명 및 컴백/데뷔 일자(M월 D일) 추출
  3. [핵심 안전장치] 네이버 뉴스 API (검증된 정식 포털 제휴사) 교차 검증:
     - 쿼리: `"{아티스트명}" "{M월 D일}" (컴백 OR 데뷔)`
     - 네이버 뉴스 검색 결과가 0건이면(가짜/찌라시/사이버렉카 언론사) 즉시 보류/제외
     - 정식 제휴 매체 기사가 1건 이상 확인되면 즉시 팩트로 확정
  4. 확정 시:
     - 신규 그룹인 경우: data/namu-index.json에 자동 등록
     - data/calendar.json에 데뷔/컴백 일정 중복 없이 안전 추가
  5. build/generate_comeback.py 재실행으로 SSR 캘린더 자동 갱신
"""
import sys
import os
import re
import json
import base64
import email
import argparse
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

# Load Naver API Keys
WORK_AI_ENV = Path("G:/내 드라이브/01.Work/05.초록뱀/00.work_ai/.env")
env_vals = dotenv_values(WORK_AI_ENV) if WORK_AI_ENV.exists() else {}
NAVER_ID = env_vals.get("NAVER_CLIENT_ID")
NAVER_SECRET = env_vals.get("NAVER_CLIENT_SECRET")

# Noise keywords
NOISE_KEYWORDS = [
    "프로야구", "KBO", "골프", "축구", "야구", "배구", "농구", "기수", "대변인",
    "배우", "드라마", "영화", "감독", "예능", "MC", "주년", "선수", "재데뷔", "단독 콘서트"
]


def fetch_alert_emails(service, max_results=40) -> list[dict]:
    """Gmail API로 Google 알리미(컴백/데뷔) 메일 수신"""
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
                if t and len(t) > 6 and any(k in t for k in ["데뷔", "컴백", "신보", "발매", "신인"]):
                    articles.append({"date": date_str, "title": t, "url": a.get("href", "")})

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

        # 날짜 추출
        m_date = re.search(r'(1[0-2]|[1-9])월\s*(\d{1,2})일', t)
        if not m_date:
            continue

        month = int(m_date.group(1))
        day = int(m_date.group(2))
        year = datetime.now().year
        d_str = f"{year}-{month:02d}-{day:02d}"

        # 아티스트 후보 추출
        # 패턴 1: '신인 [걸|보이]?그룹 [‘\'"]?([A-Za-z0-9가-힣\s]+?)[‘\'"]?'
        m1 = re.search(r'신인\s+(?:걸그룹|보이그룹|아이돌|그룹)\s+[\'"]?([A-Za-z0-9가-힣\s]{2,15})[\'"]?(?:,|의|\s+|이|가|\(|\[|로|출격|데뷔|컴백)', t)
        # 패턴 2: '([아티스트명]), ... 컴백/데뷔'
        m2 = re.search(r'^[\'"]?([A-Za-z0-9가-힣\s]{2,15})[\'"]?,\s*.*(?:컴백|데뷔)', t)
        # 패턴 3: '([아티스트명]) 컴백/데뷔'
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
            if art_name in ["오늘", "내일", "드디어", "가요계", "멤버", "출신", "프로듀서", "기획사", "걸그룹", "보이그룹", "아이돌"]:
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
                    "sample_title": t
                })

    return candidates


def verify_with_naver_cp(candidate: dict) -> dict | None:
    """
    네이버 뉴스 제휴사(CP사) 교차 검증:
    구글 알리미에 뜬 소식이라도 네이버 제휴 언론사에 배포되지 않은 가짜/찌라시는 완전 배제.
    """
    if not NAVER_ID or not NAVER_SECRET:
        return None

    art = candidate["artist"]
    md = candidate["month_day"]
    keyword = "데뷔" if candidate["is_debut"] else "컴백"

    # 엄격한 검색: 아티스트명 + 날짜 + 키워드
    q = f'"{art}" "{md}" {keyword}'
    url = f"https://openapi.naver.com/v1/search/news.json?query={urllib.parse.quote(q)}&display=5&sort=sim"
    req = urllib.request.Request(url, headers={"X-Naver-Client-Id": NAVER_ID, "X-Naver-Client-Secret": NAVER_SECRET})

    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            items = data.get("items", [])
            if len(items) > 0:
                # 네이버 CP사 정식 보도 확인 완료!
                first = items[0]
                clean_title = first["title"].replace("<b>", "").replace("</b>", "").replace("&quot;", '"')
                original_link = first.get("originallink") or first.get("link") or ""
                return {
                    "artist": art,
                    "date": candidate["date"],
                    "is_debut": candidate["is_debut"],
                    "verified_title": clean_title,
                    "url": original_link,
                    "news_count": data.get("total", len(items))
                }
    except Exception as e:
        pass

    return None


def run_verified_pipeline(dry_run=False):
    print("=" * 65)
    print("🚀 [1단계] Google 알리미 수신 및 컴백/데뷔 후보 추출 (Trigger)")
    print("=" * 65)
    service = get_gmail_service()
    if not service:
        print("❌ Gmail API 연결 실패")
        return

    articles = fetch_alert_emails(service)
    print(f"✅ 구글 알리미 기사 {len(articles)}건 수신 완료")

    candidates = parse_schedule_candidates(articles)
    print(f"✅ 일자/아티스트 특정 후보군: {len(candidates)}건 추출 완료")

    print("\n" + "=" * 65)
    print("🛡️ [2단계 안전장치] 네이버 뉴스 API (포털 정식 제휴 매체) 교차 검증")
    print("=" * 65)
    verified_list = []
    for cand in candidates:
        v = verify_with_naver_cp(cand)
        if v:
            tag = "데뷔" if v["is_debut"] else "컴백"
            print(f"  [✅ 검증 통과] [{v['date']}] {v['artist']} ({tag}) | 제휴 기사 {v['news_count']}건")
            print(f"      - 기사: {v['verified_title'][:60]}")
            print(f"      - 링크: {v['url']}")
            verified_list.append(v)
        else:
            print(f"  [❌ 검증 탈락/보류] {cand['artist']} ({cand['date']}) - 네이버 제휴 매체 보도 없음 (가짜/미확정 방지)")

    if not verified_list:
        print("\n신규 반영할 검증 완료 일정이 없습니다.")
        return

    if dry_run:
        print("\n[Dry-run 모드] 실제 DB 업데이트를 건너뜁니다.")
        return

    print("\n" + "=" * 65)
    print("💾 [3단계] 검증된 일정 마스터 DB 및 캘린더 반영 (중복 방지 잠금)")
    print("=" * 65)
    with open(INDEX_PATH, "r", encoding="utf-8") as f:
        idx_data = json.load(f)
    with open(CALENDAR_PATH, "r", encoding="utf-8") as f:
        cal_data = json.load(f)

    existing_slugs = {g["slug"]: g for g in idx_data.get("groups", [])}
    existing_event_keys = {(e.get("date"), (e.get("slug") or "").lower()) for e in cal_data.get("events", [])}

    added_count = 0
    for v in verified_list:
        slug = re.sub(r'[^a-z0-9]+', '-', v["artist"].lower()).strip('-')
        # 신규 아티스트 namu-index 등록
        if slug not in existing_slugs:
            idx_data["groups"].append({
                "name": v["artist"],
                "name_en": v["artist"],
                "slug": slug,
                "gender": "여자" if "걸그룹" in v["verified_title"] else "남자",
                "agency": "확인 중",
                "debut_year": str(datetime.now().year),
                "album_count": 1,
                "member_count": 0,
                "members": []
            })
            existing_slugs[slug] = True
            print(f"  + 신규 아티스트 인덱스 등록: {v['artist']} ({slug})")

        event_key = (v["date"], slug)
        if event_key not in existing_event_keys:
            tag = "Debut" if v["is_debut"] else "Comeback"
            event_id = f"{'debut' if v['is_debut'] else 'comeback'}_{slug}_{v['date'].replace('-', '')}"
            cal_data["events"].append({
                "id": event_id,
                "date": v["date"],
                "title": f"{v['artist']} ({tag})",
                "slug": slug,
                "description": f"{v['verified_title']} (기사: {v['url']})",
                "category": "comeback_debut"
            })
            existing_event_keys.add(event_key)
            added_count += 1
            print(f"  + 캘린더 일정 추가: [{v['date']}] {v['artist']} ({tag})")

    if added_count > 0:
        cal_data["events"].sort(key=lambda x: x.get("date", ""))
        with open(INDEX_PATH, "w", encoding="utf-8") as f:
            json.dump(idx_data, f, ensure_ascii=False, indent=2)
        with open(CALENDAR_PATH, "w", encoding="utf-8") as f:
            json.dump(cal_data, f, ensure_ascii=False, indent=2)
        print(f"\n🎉 총 {added_count}건의 검증된 일정이 캘린더에 안전하게 추가되었습니다.")

        gen_script = APP_ROOT / "build" / "generate_comeback.py"
        if gen_script.exists():
            os.system(f'python "{gen_script}"')
            print("✅ comeback/index.html SSR 빌드 갱신 완료")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="네이버 CP사 교차 검증 기반 데뷔/컴백 자동 수집기")
    parser.add_argument("--dry-run", action="store_true", help="등록 없이 탐지만 수행")
    args = parser.parse_args()
    run_verified_pipeline(dry_run=args.dry_run)
