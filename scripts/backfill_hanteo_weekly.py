import sys, json, os, glob, re
from pathlib import Path
from collections import defaultdict

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = Path(r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app")
GROUPS_DIR = BASE_DIR / "data" / "namu-groups"
INDEX_PATH = BASE_DIR / "data" / "namu-index.json"
HANTEO_WEEKLY = BASE_DIR / "07.hanteo" / "data" / "weekly"

def normalize_title(t):
    if not t: return ""
    t = re.sub(r"[\<\[\(].*?[\>\]\)]", "", t)
    t = re.sub(r"[^a-zA-Z0-9가-힣]", "", t)
    return t.lower().strip()

with open(INDEX_PATH, encoding="utf-8") as f:
    index_data = json.load(f)

artist_to_slug = {}
for g in index_data.get("groups", []):
    slug = g.get("slug")
    if g.get("name"): artist_to_slug[g["name"].lower().strip()] = slug
    if g.get("name_en"): artist_to_slug[g["name_en"].lower().strip()] = slug

weekly_by_slug = defaultdict(list)
for wf in HANTEO_WEEKLY.glob("*.json"):
    with open(wf, encoding="utf-8") as fp:
        d = json.load(fp)
    gen = d.get("generated", "")
    for r in d.get("rows", []):
        art = r.get("artist", "")
        alb = r.get("album", "")
        sales_str = r.get("sales", "0").replace(",", "").strip()
        sales = int(sales_str) if sales_str.isdigit() else 0
        if sales < 5000: continue # Only significant weekly sales

        main = re.sub(r"\(.*?\)", "", art).strip().lower()
        slug = artist_to_slug.get(main)
        if not slug:
            for m in re.finditer(r"\(([^)]+)\)", art):
                inner = m.group(1).strip().lower()
                if inner in artist_to_slug:
                    slug = artist_to_slug[inner]
                    break
        if slug:
            weekly_by_slug[slug].append({"album": alb, "sales": sales, "date": gen})

print(f"Loaded significant weekly records for {len(weekly_by_slug)} groups.")

updated = 0
for gf in glob.glob(str(GROUPS_DIR / "*.json")):
    slug = Path(gf).stem
    if slug not in weekly_by_slug:
        continue

    with open(gf, encoding="utf-8") as fp:
        gdata = json.load(fp)

    w_records = weekly_by_slug[slug]
    albums = gdata.get("albums", [])
    mod = False

    for na in albums:
        ht = na.get("초동_한터", "")
        if ht and ht != "-": continue

        ntitle = na.get("title", "")
        norm_ntitle = normalize_title(ntitle)
        if not norm_ntitle or len(norm_ntitle) < 2: continue

        best = None
        for wr in w_records:
            norm_wr = normalize_title(wr["album"])
            if norm_ntitle == norm_wr or (len(norm_ntitle) >= 3 and norm_ntitle in norm_wr) or (len(norm_wr) >= 3 and norm_wr in norm_ntitle):
                if best is None or wr["sales"] > best["sales"]:
                    best = wr

        if best:
            s_val = best["sales"]
            na["초동_한터"] = f"{s_val:,}"
            na["초동_한터_numeric"] = s_val
            biko = na.get("비고", "")
            if "한터" not in biko:
                na["비고"] = f"{biko}, 한터 주간 실측치" if biko else "한터 주간 실측치"
            mod = True
            updated += 1
            print(f"[{slug}] {ntitle} -> Set Hanteo Weekly sales: {s_val:,}")

    if mod:
        with open(gf, "w", encoding="utf-8") as fp:
            json.dump(gdata, fp, ensure_ascii=False, indent=2)

print(f"Completed! Backfilled {updated} additional albums from Hanteo Weekly charts.")
