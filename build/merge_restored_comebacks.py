# -*- coding: utf-8 -*-
"""
merge_restored_comebacks.py — 재스캔된 복원 컴백 일정을 calendar.json 및 comebacks.json에 안전하게 병합
"""
import json
from pathlib import Path
from datetime import datetime, date

APP_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = APP_ROOT / "data"

rescan_path = DATA_DIR / "rescan_alerts_full_result.json"
cal_path = DATA_DIR / "calendar.json"
hanteo_path = APP_ROOT / "07.hanteo" / "comebacks.json"

rescan_data = json.loads(rescan_path.read_text(encoding="utf-8"))
cal_data = json.loads(cal_path.read_text(encoding="utf-8"))
hanteo_data = json.loads(hanteo_path.read_text(encoding="utf-8")) if hanteo_path.exists() else {"comebacks": []}

events_to_merge = rescan_data.get("events", [])
print(f"병합 대상 이벤트: {len(events_to_merge)}건")

# 1. calendar.json 병합
cal_events = cal_data.get("events", [])

for ev in events_to_merge:
    slug = ev["slug"]
    d_str = ev["comeback_date"]
    title = f"{ev['name']} (Comeback)"
    
    # 기존 항목 검색 (동일 slug + 동일 월 또는 동일 일자)
    matched_idx = -1
    for i, ce in enumerate(cal_events):
        if ce.get("slug") == slug and ce.get("date") == d_str:
            matched_idx = i
            break
        elif ce.get("slug") == slug and (ce.get("date") or "").startswith(d_str[:7]):
            matched_idx = i
            break

    entry = {
        "id": f"alert_{slug}_{d_str.replace('-', '')}",
        "date": d_str,
        "title": title,
        "slug": slug,
        "description": f"{ev['article_title']} - {ev['snippet'][:120]}",
        "url": ev["article_url"],
        "category": "comeback_debut",
        "source": "Google Alerts"
    }

    if matched_idx >= 0:
        cal_events[matched_idx] = entry
        print(f"[calendar.json 갱신] {ev['name']} ({d_str})")
    else:
        cal_events.append(entry)
        print(f"[calendar.json 신규] {ev['name']} ({d_str})")

cal_events.sort(key=lambda x: x.get("date", ""))
cal_data["events"] = cal_events
cal_data["total_events"] = len(cal_events)
cal_path.write_text(json.dumps(cal_data, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"calendar.json 저장 완료 (총 {cal_data['total_events']}건)")

# 2. 07.hanteo/comebacks.json 병합 (초동 추적용)
h_list = hanteo_data.get("comebacks", [])
today_str = date.today().isoformat()

for ev in events_to_merge:
    slug = ev["slug"]
    d_str = ev["comeback_date"]
    
    matched_h_idx = -1
    for i, hc in enumerate(h_list):
        if hc.get("slug") == slug:
            matched_h_idx = i
            break

    h_entry = {
        "slug": slug,
        "name": ev["name"],
        "album": ev.get("album") or "(신보)",
        "comeback_date": d_str,
        "collect_days": 7,
        "added": today_str
    }

    if matched_h_idx >= 0:
        h_list[matched_h_idx] = h_entry
    else:
        h_list.append(h_entry)

hanteo_data["comebacks"] = h_list
hanteo_path.write_text(json.dumps(hanteo_data, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"07.hanteo/comebacks.json 저장 완료 (총 {len(h_list)}팀)")
