# -*- coding: utf-8 -*-
"""
rescan_alerts_robust.py — 알리미 메일 전면 재스캔 및 컴백/데뷔 정밀 복원 엔진

개선된 핵심 알고리즘:
1. 그룹 사전 대폭 보완:
   - NCT WISH (엔시티 위시, nct wish)
   - N.Flying (엔플라잉, nflying)
   - 올데이 프로젝트 (공백 무시: 올데이프로젝트, ALLDAY PROJECT)
   - 핑클, 러블리즈, 크래비티, 보이넥스트도어, 니쥬 등 전원 포함
2. 단락/기사 블록(Article Chunk) 파싱:
   - HTML 테이블 및 링크 구조를 기반으로 기사 제목 + 요약문 덩어리별 문맥 파싱
3. 상대 날짜(D-day) 환산기:
   - D-N, 사흘 앞두고, 내일, 오늘 등 메일 수신일 기준 계산
4. 날짜 윈도우:
   - 최근 30일 이내 컴백하여 현재 활동 중인 신보까지 전수 포용 (2026-09-01 이후)
5. 기사 URL 정확한 추출:
   - 구글 알리미 redirect url (url=...) 디코딩
"""
import sys, io, re, json, base64, email, urllib.parse
from datetime import datetime, date, timedelta
from pathlib import Path
from bs4 import BeautifulSoup

def log(msg):
    sys.stderr.write(str(msg) + "\n")
    sys.stderr.flush()

sys.path.insert(0, r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\07.hanteo")
from comeback_alert import get_gmail_service, load_group_index, _parse_email_date

service = get_gmail_service()
base_group_index = load_group_index()

# ── 1. 그룹 사전 보강 ──────────────────────────────────────────────────────────
EXTRA_GROUPS = [
    {"slug": "nct-wish", "name": "NCT WISH", "name_en": "NCT WISH", "aliases": ["nct wish", "nctwish", "엔시티 위시", "엔시티위시"]},
    {"slug": "n-flying", "name": "엔플라잉", "name_en": "N.Flying", "aliases": ["엔플라잉", "n.flying", "nflying"]},
    {"slug": "allday-project", "name": "올데이 프로젝트", "name_en": "ALLDAY PROJECT", "aliases": ["올데이 프로젝트", "올데이프로젝트", "allday project", "alldayproject"]},
    {"slug": "cravity", "name": "크래비티", "name_en": "CRAVITY", "aliases": ["크래비티", "cravity"]},
    {"slug": "boynextdoor", "name": "보이넥스트도어", "name_en": "BOYNEXTDOOR", "aliases": ["보이넥스트도어", "보이 넥스트 도어", "boynextdoor"]},
    {"slug": "fin-k-l", "name": "핑클", "name_en": "Fin.K.L", "aliases": ["핑클", "fin.k.l", "finkl"]},
    {"slug": "lovelyz", "name": "러블리즈", "name_en": "Lovelyz", "aliases": ["러블리즈", "lovelyz"]},
    {"slug": "niziu", "name": "니쥬", "name_en": "NiziU", "aliases": ["니쥬", "niziu"]},
    {"slug": "close-your-eyes", "name": "클로즈 유어 아이즈", "name_en": "CLOSE YOUR EYES", "aliases": ["클로즈 유어 아이즈", "클로즈유어아이즈", "close your eyes"]}
]

# 통합 매핑 사전 구축 (공백 제거된 키 포함)
GROUP_MAP = {}
for k, v in base_group_index.items():
    clean_k = k.lower().replace(" ", "")
    GROUP_MAP[clean_k] = v
    GROUP_MAP[k.lower()] = v

for eg in EXTRA_GROUPS:
    info = {"slug": eg["slug"], "name": eg["name"], "name_en": eg["name_en"]}
    for alias in eg["aliases"]:
        GROUP_MAP[alias.lower()] = info
        GROUP_MAP[alias.lower().replace(" ", "")] = info

log(f"확장된 그룹 사전: 총 {len(GROUP_MAP)}개 키워드 등록 완료.")


# ── 2. 이메일 전수 수집 (2026년 8월 1일 이후) ──────────────────────────────────
query = 'subject:"Google 알리미" "컴백" after:2026/07/31'
all_msgs = []
page_token = None

while True:
    res = service.users().messages().list(userId="me", q=query, pageToken=page_token, maxResults=500).execute()
    msgs = res.get("messages", [])
    all_msgs.extend(msgs)
    page_token = res.get("nextPageToken")
    if not page_token:
        break

log(f"스캔 대상 알리미 이메일: 총 {len(all_msgs)}건")


# ── 3. 정밀 기사 블록 파서 및 상대 날짜 연산 ─────────────────────────────────────
def parse_article_chunks(html_content, email_date_str):
    email_dt = date.fromisoformat(email_date_str)
    soup = BeautifulSoup(html_content, "html.parser")
    chunks = []

    # Google 알리미는 각각의 기사가 <table> 또는 <td> 또는 <a> 링크 블록으로 나뉨
    for a in soup.find_all("a"):
        title = a.get_text().strip()
        href = a.get("href", "")
        if not title or len(title) < 5:
            continue
        
        # 기사 실제 링크 추출
        real_url = href
        m_u = re.search(r"url=([^&]+)", href)
        if m_u:
            real_url = urllib.parse.unquote(m_u.group(1))

        # 주변 텍스트(요약문) 추출
        parent = a.find_parent(["td", "div", "li"])
        full_text = parent.get_text(separator=" ").strip() if parent else title
        full_text = re.sub(r"\s+", " ", full_text)

        # 컴백, 발매, 신보 관련 기사인지 1차 검사
        if not any(kw in full_text for kw in ["컴백", "발매", "신보", "데뷔", "D-"]):
            continue

        chunks.append({
            "title": title,
            "url": real_url,
            "text": full_text
        })
    return chunks


def extract_event_from_chunk(chunk, email_date_str):
    email_dt = date.fromisoformat(email_date_str)
    full_text = chunk["text"]
    clean_text = full_text.lower().replace(" ", "")

    # 1. 매칭되는 그룹 찾기 (가장 긴 매칭 우선)
    matched_info = None
    matched_len = 0
    for key, info in GROUP_MAP.items():
        if len(key) >= 2 and key in clean_text:
            if len(key) > matched_len:
                matched_len = len(key)
                matched_info = info

    if not matched_info:
        return None

    # 제외 대상 (순수 스포츠/팬미팅 단독 등)
    if any(ex in full_text for ex in ["야구", "투수", "MLB", "홈런", "팬미팅 개최"]):
        if not any(ab in full_text for ab in ["앨범", "음원", "신보", "미니"]):
            return None

    comeback_date = None

    # 패턴 1: D-day (예: '컴백 D-3', 'D-1')
    m_dday = re.search(r"D-(\d+)", full_text)
    if m_dday:
        days = int(m_dday.group(1))
        comeback_date = email_dt + timedelta(days=days)

    # 패턴 2: '사흘 앞두고' (3일 전)
    if not comeback_date and "사흘 앞두고" in full_text:
        comeback_date = email_dt + timedelta(days=3)

    # 패턴 3: 'N월 N일'
    if not comeback_date:
        m_md = re.search(r"(\d{1,2})월\s*(\d{1,2})일", full_text)
        if m_md:
            try:
                m_val, d_val = int(m_md.group(1)), int(m_md.group(2))
                comeback_date = date(email_dt.year, m_val, d_val)
            except ValueError:
                pass

    # 패턴 4: 'YYYY.MM.DD' / 'YYYY-MM-DD'
    if not comeback_date:
        m_ymd = re.search(r"(202\d)[.\-/](\d{1,2})[.\-/](\d{1,2})", full_text)
        if m_ymd:
            try:
                comeback_date = date(int(m_ymd.group(1)), int(m_ymd.group(2)), int(m_ymd.group(3)))
            except ValueError:
                pass

    # 패턴 5: '오는 N일'
    if not comeback_date:
        m_on = re.search(r"오는\s*(\d{1,2})일", full_text)
        if m_on:
            try:
                d_val = int(m_on.group(1))
                comeback_date = date(email_dt.year, email_dt.month, d_val)
                if comeback_date < email_dt:
                    nm = email_dt.month + 1
                    ny = email_dt.year
                    if nm > 12:
                        nm = 1; ny += 1
                    comeback_date = date(ny, nm, d_val)
            except ValueError:
                pass

    # 날짜가 없거나 9월 1일 이전(너무 과거)인 경우 제외
    if not comeback_date or comeback_date < date(2026, 9, 1):
        return None

    # 앨범명 추출
    album_name = "(미정)"
    m_alb = re.search(r"['\"「]([^'\"」]{2,30})['\"」]", full_text)
    if m_alb:
        album_name = m_alb.group(1)

    return {
        "slug": matched_info["slug"],
        "name": matched_info["name"],
        "name_en": matched_info["name_en"],
        "comeback_date": comeback_date.isoformat(),
        "album": album_name,
        "article_title": chunk["title"],
        "article_url": chunk["url"],
        "snippet": chunk["text"][:160]
    }


# ── 4. 전체 메일 순회 및 추출 ───────────────────────────────────────────────────
all_extracted = []

for idx, m in enumerate(all_msgs):
    mid = m["id"]
    try:
        msg_data = service.users().messages().get(userId="me", id=mid, format="raw").execute()
        raw = base64.urlsafe_b64decode(msg_data["raw"].encode("ASCII"))
        msg = email.message_from_bytes(raw)
        
        email_date = _parse_email_date(msg)
        
        html_content = ""
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/html":
                    charset = part.get_content_charset() or "utf-8"
                    html_content = part.get_payload(decode=True).decode(charset, errors="replace")
                    break
        else:
            if msg.get_content_type() == "text/html":
                charset = msg.get_content_charset() or "utf-8"
                html_content = msg.get_payload(decode=True).decode(charset, errors="replace")

        if not html_content:
            continue

        chunks = parse_article_chunks(html_content, email_date)
        for ch in chunks:
            ev = extract_event_from_chunk(ch, email_date)
            if ev:
                all_extracted.append(ev)

        if (idx + 1) % 20 == 0:
            log(f"진행: {idx + 1}/{len(all_msgs)} 메일 정밀 스캔 완료...")
    except Exception as e:
        pass

log(f"\n총 {len(all_extracted)}건의 이벤트 감지 완료 (중복 포함)")

# ── 5. 고유 그룹별 가장 신뢰도 높은 최신 일정으로 정리 ───────────────────────────
unique_events = {}
for ev in all_extracted:
    key = (ev["slug"], ev["comeback_date"])
    if key not in unique_events:
        unique_events[key] = ev
    else:
        # 더 긴 스니펫이나 구체적인 앨범명 우선
        if len(ev["snippet"]) > len(unique_events[key]["snippet"]):
            unique_events[key] = ev

# 결과 JSON 저장
output_path = Path(r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\data\rescan_alerts_full_result.json")
with open(output_path, "w", encoding="utf-8") as f:
    json.dump({
        "scanned_at": datetime.now().isoformat(),
        "total_emails": len(all_msgs),
        "total_events": len(unique_events),
        "events": sorted(list(unique_events.values()), key=lambda x: x["comeback_date"])
    }, f, ensure_ascii=False, indent=2)

log(f"정밀 재스캔 완료! 결과 저장: {output_path}")
