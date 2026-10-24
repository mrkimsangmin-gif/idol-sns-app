# -*- coding: utf-8 -*-
"""
이메일 원문 기반 알리미 누락 원인 전수 역추적 및 검증 스크립트
9월 26일 알리미 메일을 포함하여 실제 메일 원문에서 왜 추출되지 못했는지 단계별 원인 검증
"""
import sys, io, re, json, base64, email
from pathlib import Path
from bs4 import BeautifulSoup
from datetime import datetime, date

def log(msg):
    sys.stderr.write(str(msg) + "\n")
    sys.stderr.flush()

sys.path.insert(0, r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\07.hanteo")
from comeback_alert import get_gmail_service, load_group_index, _parse_email_date, _extract_text

service = get_gmail_service()
group_index = load_group_index()

# 9월 26일 전후 알리미 메일 검색
query = 'subject:"Google 알리미" "컴백" after:2026/09/24 before:2026/09/28'
res = service.users().messages().list(userId="me", q=query).execute()
msgs = res.get("messages", [])
log(f"9월 25~27일 알리미 메일 수: {len(msgs)}건")

for m in msgs:
    mid = m["id"]
    msg_data = service.users().messages().get(userId="me", id=mid, format="raw").execute()
    raw = base64.urlsafe_b64decode(msg_data["raw"].encode("ASCII"))
    msg = email.message_from_bytes(raw)
    
    email_date = _parse_email_date(msg)
    body = _extract_text(msg)
    
    if "올데이" in body or "올데이 프로젝트" in body or "엔플라잉" in body:
        log(f"\n==========================================")
        log(f"메일 ID: {mid} (발송일: {email_date})")
        log(f"제목: {msg.get('Subject')}")
        
        # 1. 올데이 프로젝트 매칭 여부
        matched_keys = []
        clean_body = body.replace(" ", "")
        for k, info in group_index.items():
            if k in body or k.replace(" ", "") in clean_body:
                matched_keys.append(f"{info['name']}({k})")
        log(f"1) 기존 group_index 매칭된 그룹들: {list(set(matched_keys))}")
        
        # 2. '올데이 프로젝트' 본문 라인
        lines = [l.strip() for l in body.split("\n") if l.strip()]
        for idx, line in enumerate(lines):
            if "올데이" in line or "엔플라잉" in line or "엔시티 위시" in line or "NCT WISH" in line:
                log(f"\n[기사 라인 발견]")
                log(f"  내용: {line}")
                
                # 기존 정규식 패턴 테스트
                m_day = re.search(r"(\d{1,2})월\s*(\d{1,2})일", line)
                m_dday = re.search(r"D-(\d+)", line)
                log(f"  - 기존 'N월 N일' 매칭: {m_day.groups() if m_day else '실패'}")
                log(f"  - 'D-day' 패턴 매칭: {m_dday.groups() if m_dday else '없음'}")
