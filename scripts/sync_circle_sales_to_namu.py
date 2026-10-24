# -*- coding: utf-8 -*-
"""
sync_circle_sales_to_namu.py — 써클차트 월간 데이터(circle-monthly.json)를 namu-groups/*.json에 동기화
1. 각 그룹별 앨범명 매칭 (Cosmo, Weverse, POCA, MINIRECORD 등 플랫폼반 합산)
2. 음반형 앨범(미니, 정규, 싱글음반 등)에만 실물 판매량 매칭 (디지털 싱글, OST 등은 제외)
3. 초동_써클 (발매월 합산), 누적_써클 (최신 누적 합산), monthly_timeline 갱신
4. 차트 렌더링에 필요한 numeric 값 최신화
"""

import os, sys, json, re, glob
from pathlib import Path
from collections import defaultdict

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = Path(r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app")
CIRCLE_JSON = BASE_DIR / "07.hanteo" / "data" / "circle-monthly.json"
GROUPS_DIR = BASE_DIR / "data" / "namu-groups"
INDEX_PATH = BASE_DIR / "data" / "namu-index.json"

NON_PHYSICAL_TYPES = {"디지털 싱글", "디지털싱글", "리믹스 싱글", "리믹스", "OST", "콜라보"}

def normalize_title(t):
    if not t: return ""
    t = re.sub(r"[\<\[\(].*?[\>\]\)]", "", t)
    t = re.sub(r"[^a-zA-Z0-9가-힣]", "", t)
    return t.lower().strip()

def run_sync():
    if not CIRCLE_JSON.exists():
        print(f"Error: {CIRCLE_JSON} not found!")
        return False
        
    with open(CIRCLE_JSON, encoding="utf-8") as f:
        circle_data = json.load(f)
    albs = circle_data.get("albums", {})
    print(f"Loaded {len(albs)} albums from circle-monthly.json")

    with open(INDEX_PATH, encoding="utf-8") as f:
        index_data = json.load(f)
    
    artist_to_slug = {}
    for g in index_data.get("groups", []):
        slug = g.get("slug")
        if g.get("name"): artist_to_slug[g["name"].lower().strip()] = slug
        if g.get("name_en"): artist_to_slug[g["name_en"].lower().strip()] = slug

    circle_by_slug = defaultdict(list)
    for aid, adata in albs.items():
        artist_raw = adata.get("artist", "")
        main = re.sub(r"\(.*?\)", "", artist_raw).strip().lower()
        slug = artist_to_slug.get(main)
        if not slug:
            for m in re.finditer(r"\(([^)]+)\)", artist_raw):
                inner = m.group(1).strip().lower()
                if inner in artist_to_slug:
                    slug = artist_to_slug[inner]
                    break
        if slug:
            circle_by_slug[slug].append(adata)

    print(f"Matched circle albums to {len(circle_by_slug)} groups.")

    updated_groups_count = 0
    updated_albums_count = 0

    group_files = glob.glob(str(GROUPS_DIR / "*.json"))
    for gf in group_files:
        slug = Path(gf).stem
        if slug not in circle_by_slug:
            continue

        with open(gf, encoding="utf-8") as f:
            gdata = json.load(f)
            
        c_albums = circle_by_slug[slug]
        namu_albums = gdata.get("albums", [])
        modified = False

        for na in namu_albums:
            ntitle = na.get("title", "")
            ntype = na.get("type", "")
            
            # Skip digital singles from getting physical album sales
            if ntype in NON_PHYSICAL_TYPES or "디지털" in ntype or "TRACK" in ntitle:
                if na.get("monthly_timeline") and ntype == "디지털 싱글":
                    na["초동_써클"] = "-"
                    na["누적_써클"] = "-"
                    na.pop("초동_써클_numeric", None)
                    na.pop("누적_써클_numeric", None)
                    na.pop("monthly_timeline", None)
                    modified = True
                continue

            norm_ntitle = normalize_title(ntitle)
            if not norm_ntitle or len(norm_ntitle) < 2:
                continue

            matched_c_albs = []
            for ca in c_albums:
                norm_calb = normalize_title(ca.get("album", ""))
                # Exact or containment match for main album
                if norm_ntitle == norm_calb or (len(norm_ntitle) >= 3 and norm_ntitle in norm_calb) or (len(norm_calb) >= 3 and norm_calb in norm_ntitle):
                    matched_c_albs.append(ca)

            if not matched_c_albs:
                continue

            ym_sales = defaultdict(int)
            for ca in matched_c_albs:
                for m in ca.get("monthly", []):
                    ym = m.get("ym")
                    if ym:
                        ym_sales[ym] += m.get("sales", 0)

            if not ym_sales:
                continue

            sorted_yms = sorted(ym_sales.keys())
            timeline = []
            cum = 0
            for ym in sorted_yms:
                s = ym_sales[ym]
                cum += s
                timeline.append({"ym": ym, "sales": s, "cumulative": cum})

            first_month_sales = ym_sales.get(sorted_yms[0], 0)
            total_sales = cum

            prev_cum = na.get("누적_써클_numeric", 0)
            if total_sales > 0 and (total_sales != prev_cum or not na.get("monthly_timeline")):
                na["누적_써클"] = f"{total_sales:,}"
                na["누적_써클_numeric"] = total_sales
                if not na.get("초동_써클") or na.get("초동_써클") in ("-", ""):
                    na["초동_써클"] = f"{first_month_sales:,}"
                    na["초동_써클_numeric"] = first_month_sales
                na["monthly_timeline"] = timeline
                modified = True
                updated_albums_count += 1

        if modified:
            with open(gf, "w", encoding="utf-8") as f:
                json.dump(gdata, f, ensure_ascii=False, indent=2)
            updated_groups_count += 1

    print(f"\nSync complete! Updated {updated_albums_count} albums across {updated_groups_count} groups.")
    return True

if __name__ == "__main__":
    run_sync()
