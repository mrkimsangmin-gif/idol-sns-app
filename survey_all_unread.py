# -*- coding: utf-8 -*-
"""
전체 미읽은 Google 알리미 메일(컴백 + 데뷔) 전수 조사 및 추출 시뮬레이션
"""
import sys, io, re, base64, email
from datetime import datetime, date
from pathlib import Path
from email.header import decode_header
from bs4 import BeautifulSoup

sys.path.insert(0, r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\07.hanteo")
from comeback_alert import get_gmail_service, load_group_index, extract_comebacks, _parse_email_date, _extract_text

service = get_gmail_service()
group_index = load_group_index()

# 1. 쿼리: subject:"Google 알리미" is:unread (컴백 및 데뷔 포함 전체 알리미)
all_msgs = []
page_token = None
query = 'subject:"Google 알리미" is:unread'

while True:
    res = service.users().messages().list(userId="me", q=query, pageToken=page_token, maxResults=500).execute()
    msgs = res.get("messages", [])
    all_msgs.extend(msgs)
    page_token = res.get("nextPageToken")
    if not page_token:
        break

print(f"전체 미읽은 알리미 메일 수: {len(all_msgs)}건")

# 2. 각 메일 분석
extracted_all = []
for i, m in enumerate(all_msgs):
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
    except Exception as e:
        print(f"Error reading {mid}: {e}")

print(f"추출된 전체 후보 건수: {len(extracted_all)}건")

# 3. 중복 정리 (동일 그룹은 가장 최근/최적 일정 기준)
unique = {}
for cb in extracted_all:
    slug = cb["slug"]
    if slug not in unique or cb["comeback_date"] < unique[slug]["comeback_date"]:
        unique[slug] = cb

print(f"중복 제거 후 최종 고유 그룹 수: {len(unique)}건")

# 4. 결과 출력
for slug, item in sorted(unique.items(), key=lambda x: x[1]["comeback_date"]):
    print(f"[{item['name']} ({item['name_en']})] 컴백/데뷔일: {item['comeback_date']} | 앨범: {item['album']}")
    if item.get("sentences"):
        print(f"   근거: {item['sentences'][0][:100]}")
