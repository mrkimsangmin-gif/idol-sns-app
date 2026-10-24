# -*- coding: utf-8 -*-
"""
2026년 8월 1일 이후 미읽은 Google 알리미 메일 전수 조사 및 컴백/데뷔 추출 스크립트
"""
import sys, io, re, base64, email, json
from datetime import datetime, date
from pathlib import Path
from email.header import decode_header
from bs4 import BeautifulSoup

def log(msg):
    sys.stderr.write(str(msg) + "\n")
    sys.stderr.flush()

sys.path.insert(0, r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\07.hanteo")
from comeback_alert import get_gmail_service, load_group_index, extract_comebacks, _parse_email_date, _extract_text

service = get_gmail_service()
group_index = load_group_index()

# 2026년 8월 1일 이후 미읽은 알리미 쿼리
query = 'subject:"Google 알리미" is:unread after:2026/07/31'

all_msgs = []
page_token = None

while True:
    res = service.users().messages().list(userId="me", q=query, pageToken=page_token, maxResults=500).execute()
    msgs = res.get("messages", [])
    all_msgs.extend(msgs)
    page_token = res.get("nextPageToken")
    if not page_token:
        break

log(f"=== 2026년 8월 이후 미읽은 Google 알리미 메일: 총 {len(all_msgs)}건 ===")

extracted_all = []
processed_count = 0

for m in all_msgs:
    mid = m["id"]
    try:
        msg_data = service.users().messages().get(userId="me", id=mid, format="raw").execute()
        raw = base64.urlsafe_b64decode(msg_data["raw"].encode("ASCII"))
        msg = email.message_from_bytes(raw)
        
        email_date = _parse_email_date(msg)
        body = _extract_text(msg)
        
        cbs = extract_comebacks(body, email_date, group_index)
        if cbs:
            for c in cbs:
                c["msg_id"] = mid
            extracted_all.extend(cbs)
        processed_count += 1
        if processed_count % 10 == 0:
            log(f"진행 상황: {processed_count}/{len(all_msgs)} 메일 처리 완료...")
    except Exception as e:
        log(f"Error {mid}: {e}")

log(f"총 {len(extracted_all)}건의 컴백/데뷔 후보 추출 완료 (중복 포함)")

# 중복 제거 (동일 slug에 대해 최신 또는 가장 이른 유효 컴백일)
unique = {}
for cb in extracted_all:
    slug = cb["slug"]
    if slug not in unique or cb["comeback_date"] < unique[slug]["comeback_date"]:
        unique[slug] = cb

log(f"=== 최종 고유 그룹 컴백/데뷔 라인업: 총 {len(unique)}팀 ===")

output_path = Path(r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\data\survey_2026_august_result.json")
with open(output_path, "w", encoding="utf-8") as f:
    json.dump({
        "total_emails": len(all_msgs),
        "total_groups": len(unique),
        "groups": list(unique.values()),
        "processed_msg_ids": [m["id"] for m in all_msgs]
    }, f, ensure_ascii=False, indent=2)

log(f"결과 JSON 저장 완료: {output_path}")
