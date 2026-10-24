# -*- coding: utf-8 -*-
"""
backfill_hanteo_from_monthly.py — 한터 초동 미등록 앨범에 대해 한터 월간/주간 차트 실측치를 보강
- 한터 초동이 비어있는 경우, 발매월의 한터 월간 차트(또는 주간 1주차) 실판매량 수치를 연동
- 예: idntt itsnotover -> 한터 8월 마감 월간 차트 실측치 568,698장 반영
"""

import sys, json, os, glob, re
from pathlib import Path
from collections import defaultdict

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = Path(r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app")
GROUPS_DIR = BASE_DIR / "data" / "namu-groups"
INDEX_PATH = BASE_DIR / "data" / "namu-index.json"
HANTEO_MONTHLY = BASE_DIR / "07.hanteo" / "data" / "monthly"
HANTEO_WEEKLY = BASE_DIR / "07.hanteo" / "data" / "weekly"

def normalize_title(t):
    if not t: return ""
    t = re.sub(r"[\<\[\(].*?[\>\]\)]", "", t)
    t = re.sub(r"[^a-zA-Z0-9가-힣]", "", t)
    return t.lower().strip()

def run_backfill():
    with open(INDEX_PATH, encoding="utf-8") as f:
        index_data = json.load(f)
    
    artist_to_slug = {}
    for g in index_data.get("groups", []):
        slug = g.get("slug")
        if g.get("name"): artist_to_slug[g["name"].lower().strip()] = slug
        if g.get("name_en"): artist_to_slug[g["name_en"].lower().strip()] = slug

    # Collect all hanteo monthly albums: slug -> list of (alb_name, sales_int, date_str)
    hanteo_by_slug = defaultdict(list)
    
    for mf in sorted(HANTEO_MONTHLY.glob("*.json")):
        with open(mf, encoding="utf-8") as fp:
            d = json.load(fp)
        gen = d.get("generated", "")
        for r in d.get("rows", []):
            art = r.get("artist", "")
            alb = r.get("album", "")
            sales_str = r.get("sales", "0").replace(",", "").strip()
            sales = int(sales_str) if sales_str.isdigit() else 0
            if sales <= 0: continue

            # Match slug
            main = re.sub(r"\(.*?\)", "", art).strip().lower()
            slug = artist_to_slug.get(main)
            if not slug:
                for m in re.finditer(r"\(([^)]+)\)", art):
                    inner = m.group(1).strip().lower()
                    if inner in artist_to_slug:
                        slug = artist_to_slug[inner]
                        break
            if slug:
                hanteo_by_slug[slug].append({"album": alb, "sales": sales, "date": gen, "source": "monthly"})

    print(f"Loaded Hanteo monthly records for {len(hanteo_by_slug)} groups.")

    updated_albums = 0
    group_files = glob.glob(str(GROUPS_DIR / "*.json"))

    for gf in group_files:
        slug = Path(gf).stem
        if slug not in hanteo_by_slug:
            continue

        with open(gf, encoding="utf-8") as fp:
            gdata = json.load(fp)

        h_records = hanteo_by_slug[slug]
        albums = gdata.get("albums", [])
        modified = False

        for na in albums:
            ht_curr = na.get("초동_한터", "")
            if ht_curr and ht_curr != "-":
                continue # Already has chodong

            ntitle = na.get("title", "")
            norm_ntitle = normalize_title(ntitle)
            if not norm_ntitle or len(norm_ntitle) < 2:
                continue

            # Find matching hanteo record
            best_match = None
            for hr in h_records:
                norm_hr = normalize_title(hr["album"])
                if norm_ntitle == norm_hr or (len(norm_ntitle) >= 3 and norm_ntitle in norm_hr) or (len(norm_hr) >= 3 and norm_hr in norm_ntitle):
                    if best_match is None or hr["sales"] > best_match["sales"]:
                        best_match = hr

            if best_match:
                sales_val = best_match["sales"]
                na["초동_한터"] = f"{sales_val:,}"
                na["초동_한터_numeric"] = sales_val
                # Note in biko if not already mentioned
                biko = na.get("비고", "")
                if "한터" not in biko:
                    na["비고"] = f"{biko}, 한터 월간 실측치" if biko else "한터 월간 실측치"
                modified = True
                updated_albums += 1
                print(f"[{slug}] {ntitle} -> Set Hanteo sales: {sales_val:,} ({best_match['source']})")

        if modified:
            with open(gf, "w", encoding="utf-8") as fp:
                json.dump(gdata, fp, ensure_ascii=False, indent=2)

    print(f"\nCompleted! Backfilled {updated_albums} albums with Hanteo monthly data.")

if __name__ == "__main__":
    run_backfill()
