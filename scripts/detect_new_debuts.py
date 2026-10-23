# -*- coding: utf-8 -*-
"""
scripts/detect_new_debuts.py — 5단계 교차 검증 기반 신규 데뷔 아이돌 자동 탐지 및 등록 모듈
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

WORK_AI_ENV = Path("G:/내 드라이브/01.Work/05.초록뱀/00.work_ai/.env")
env_vals = dotenv_values(WORK_AI_ENV) if WORK_AI_ENV.exists() else {}
NAVER_ID = env_vals.get("NAVER_CLIENT_ID")
NAVER_SECRET = env_vals.get("NAVER_CLIENT_SECRET")

NOISE_KEYWORDS = [
    "프로야구", "KBO", "골프", "축구", "야구", "배구", "농구", "기수", "대변인",
    "배우", "드라마", "영화", "감독", "예능", "MC", "주년", "선수", "단독 콘서트", "재데뷔"
]


def fetch_debut_alert_emails(service, max_results=30) -> list[dict]:
    if not service:
        return []
    query = 'from:googlealerts-noreply@google.com subject:"데뷔"'
    res = service.users().messages().list(userId="me", q=query, maxResults=max_results).execute()
    messages = res.get("messages", [])
    articles = []

    for m in messages:
        msg_id = m["id"]
        msg_data = service.users().messages().get(userId="me", id=msg_id, format="raw").execute()
        raw = base64.urlsafe_b64decode(msg_data["raw"].encode("ASCII"))
        msg = email.message_from_bytes(raw)
        date_str = msg.get("Date", "")

        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/html":
                    html = part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", errors="replace")
                    soup = BeautifulSoup(html, "html.parser")
                    for a in soup.find_all("a"):
                        t = a.get_text(strip=True)
                        if t and len(t) > 6 and any(k in t for k in ["데뷔", "신인", "걸그룹", "보이그룹"]):
                            articles.append({"date": date_str, "title": t, "url": a.get("href", "")})
        else:
            payload = msg.get_payload(decode=True).decode(msg.get_content_charset() or "utf-8", errors="replace")
            soup = BeautifulSoup(payload, "html.parser")
            for a in soup.find_all("a"):
                t = a.get_text(strip=True)
                if t and len(t) > 6 and any(k in t for k in ["데뷔", "신인", "걸그룹", "보이그룹"]):
                    articles.append({"date": date_str, "title": t, "url": a.get("href", "")})

    return articles


def extract_candidate_names(articles: list[dict]) -> set[str]:
    candidates = set()
    for a in articles:
        t = a["title"]
        if any(ign in t for ign in NOISE_KEYWORDS):
            continue

        m1 = re.search(r'신인\s+(?:걸그룹|보이그룹|아이돌|그룹)\s+[\'"]?([A-Za-z0-9가-힣\s]{2,15})[\'"]?(?:,|의|\s+|이|가|\(|\[|로|출격|데뷔)', t)
        if m1:
            name = m1.group(1).strip()
            if name not in ["멤버", "출신", "프로듀서", "기획사", "2팀 동시", "보이", "걸그룹", "보이그룹"]:
                candidates.add(name)

        m2 = re.search(r'^[\'"]?([A-Za-z0-9가-힣\s]{2,15})[\'"]?,\s*.*(?:전격\s+)?데뷔', t)
        if m2:
            candidates.add(m2.group(1).strip())

        m3 = re.search(r'([A-Z0-9]{2,10}(?:\s+[A-Z0-9]{2,10})?)\s*,\s*.*데뷔', t)
        if m3:
            candidates.add(m3.group(1).strip())

    return candidates


def verify_with_naver_news(name: str) -> dict | None:
    if not NAVER_ID or not NAVER_SECRET:
        return None
    q = f'"{name}" (데뷔 OR 신인) (아이돌 OR 걸그룹 OR 보이그룹 OR 가요계)'
    url = f"https://openapi.naver.com/v1/search/news.json?query={urllib.parse.quote(q)}&display=5&sort=sim"
    req = urllib.request.Request(url, headers={"X-Naver-Client-Id": NAVER_ID, "X-Naver-Client-Secret": NAVER_SECRET})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            items = data.get("items", [])
            if len(items) >= 2:
                full_text = " ".join([it["title"] + " " + it["description"] for it in items])
                m_date = re.search(r'(202\d)년\s*(\d{1,2})월\s*(\d{1,2})일', full_text)
                d_day = None
                if m_date:
                    d_day = f"{m_date.group(1)}-{int(m_date.group(2)):02d}-{int(m_date.group(3)):02d}"
                return {
                    "name": name,
                    "count": data.get("total", len(items)),
                    "d_day": d_day,
                    "sample_title": items[0]["title"].replace("<b>", "").replace("</b>", "").replace("&quot;", '"')
                }
    except Exception:
        pass
    return None


def run_pipeline(dry_run=False):
    print("=" * 60)
    print("🚀 [1단계] 구글 알리미 '데뷔' 메일 수신 및 후보 추출 시작")
    print("=" * 60)
    service = get_gmail_service()
    if not service:
        print("❌ Gmail API 연동 실패")
        return

    articles = fetch_debut_alert_emails(service)
    print(f"✅ 데뷔 관련 기사 {len(articles)}건 수신 완료")

    candidates = extract_candidate_names(articles)
    print(f"✅ 1차 후보군 추출: {len(candidates)}개 -> {candidates}")

    print("\n" + "=" * 60)
    print("🔎 [2단계 & 3단계] 네이버 뉴스 API 및 교차 검증 진행")
    print("=" * 60)
    verified = []
    for c in candidates:
        res = verify_with_naver_news(c)
        if res:
            print(f"  [확정 후보] {res['name']} (기사 {res['count']}건) | 추정 데뷔일: {res['d_day']}")
            print(f"    - 대표 보도: {res['sample_title']}")
            verified.append(res)
        else:
            print(f"  [오탐 제외] {c}")

    if not verified:
        print("신규 등록할 확정 데뷔 그룹이 없습니다.")
        return

    if dry_run:
        print("\n[Dry-run 모드] 실제 DB 업데이트를 건너뜁니다.")
        return

    print("\n" + "=" * 60)
    print("💾 [4단계 & 5단계] namu-index.json & calendar.json 동기화")
    print("=" * 60)
    with open(INDEX_PATH, "r", encoding="utf-8") as f:
        idx_data = json.load(f)
    with open(CALENDAR_PATH, "r", encoding="utf-8") as f:
        cal_data = json.load(f)

    existing_slugs = {g["slug"] for g in idx_data.get("groups", [])}
    existing_event_titles = {e["title"] for e in cal_data.get("events", [])}

    added_count = 0
    for v in verified:
        slug = re.sub(r'[^a-z0-9]+', '-', v["name"].lower()).strip('-')
        if slug not in existing_slugs:
            idx_data["groups"].append({
                "name": v["name"],
                "name_en": v["name"],
                "slug": slug,
                "gender": "여자" if "걸그룹" in v["sample_title"] else "남자",
                "agency": "확인 중",
                "debut_year": str(datetime.now().year),
                "album_count": 1,
                "member_count": 0,
                "members": []
            })
            existing_slugs.add(slug)
            print(f"  + namu-index 등록: {v['name']} ({slug})")

        event_title = f"{v['name']} (Debut)"
        if event_title not in existing_event_titles and v["d_day"]:
            cal_data["events"].append({
                "id": f"debut_{slug}_{v['d_day'].replace('-', '')}",
                "date": v["d_day"],
                "title": event_title,
                "slug": slug,
                "description": v["sample_title"],
                "category": "comeback_debut"
            })
            existing_event_titles.add(event_title)
            added_count += 1
            print(f"  + calendar.json 일정 추가: {v['d_day']} | {event_title}")

    if added_count > 0:
        cal_data["events"].sort(key=lambda x: x.get("date", ""))
        with open(INDEX_PATH, "w", encoding="utf-8") as f:
            json.dump(idx_data, f, ensure_ascii=False, indent=2)
        with open(CALENDAR_PATH, "w", encoding="utf-8") as f:
            json.dump(cal_data, f, ensure_ascii=False, indent=2)
        print(f"\n🎉 총 {added_count}건의 신규 데뷔 일정이 정상 갱신되었습니다.")

        gen_script = APP_ROOT / "build" / "generate_comeback.py"
        if gen_script.exists():
            os.system(f'python "{gen_script}"')
            print("✅ comeback/index.html SSR 빌드 갱신 완료")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="신규 데뷔 아이돌 자동 탐지기")
    parser.add_argument("--dry-run", action="store_true", help="등록 없이 탐지만 수행")
    args = parser.parse_args()
    run_pipeline(dry_run=args.dry_run)
