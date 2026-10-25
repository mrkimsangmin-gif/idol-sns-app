import glob, json, sys, os, re

sys.stdout.reconfigure(encoding='utf-8')
groups_dir = r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\data\namu-groups"
files = glob.glob(os.path.join(groups_dir, "*.json"))

issues = {
    "hanteo_gt_circle_cumul": [],    # Hanteo chodong > Circle cumul (potential version omission in Circle)
    "circle_chodong_gt_cumul": [],   # Circle chodong > Circle cumul (internal contradiction)
    "empty_date_physical": [],       # Physical albums with missing release date
    "duplicate_titles_same_date": [],# Same title or exact duplicate on same date
}

def to_int(s):
    if not s or s in ("-", ""): return 0
    clean = re.sub(r"[^0-9]", "", str(s))
    return int(clean) if clean else 0

for fpath in files:
    fname = os.path.basename(fpath)
    slug = fname.replace(".json", "")
    with open(fpath, encoding='utf-8') as fp:
        d = json.load(fp)
    name = d.get("name", slug)
    albums = d.get("albums", [])
    
    seen_dates = {}

    for idx, a in enumerate(albums):
        tit = str(a.get("title", "")).strip()
        atype = str(a.get("type", "")).strip()
        date = str(a.get("발매일", "")).strip()
        ht_cho = to_int(a.get("초동_한터"))
        cc_cho = to_int(a.get("초동_써클"))
        cc_cum = to_int(a.get("누적_써클"))

        # Skip non-physical / scheduled
        if any(w in atype for w in ["디지털", "OST", "리믹스"]) or any(w in tit for w in ["TRACK", "[발매 예정]"]):
            continue

        # 1. Hanteo chodong > Circle cumulative by more than 10% (and >= 10k gap)
        if ht_cho > 0 and cc_cum > 0 and ht_cho > cc_cum * 1.1 and (ht_cho - cc_cum) >= 10000:
            issues["hanteo_gt_circle_cumul"].append({
                "group": name, "slug": slug, "title": tit, "type": atype, "date": date,
                "ht_cho": ht_cho, "cc_cum": cc_cum, "diff": ht_cho - cc_cum
            })

        # 2. Circle chodong > Circle cumulative
        if cc_cho > 0 and cc_cum > 0 and cc_cho > cc_cum:
            issues["circle_chodong_gt_cumul"].append({
                "group": name, "slug": slug, "title": tit, "date": date,
                "cc_cho": cc_cho, "cc_cum": cc_cum
            })

        # 3. Empty date physical album
        if not date and not any(w in tit for w in ["[발매 예정]", "미정"]):
            issues["empty_date_physical"].append({
                "group": name, "slug": slug, "title": tit, "type": atype
            })

        # 4. Duplicate titles on same date
        key = (tit.lower(), date)
        if date and key in seen_dates:
            issues["duplicate_titles_same_date"].append({
                "group": name, "slug": slug, "title": tit, "date": date, "prev_idx": seen_dates[key], "curr_idx": idx
            })
        seen_dates[key] = idx

print("=" * 60)
print("AUDIT RESULTS ACROSS ALL 212 GROUPS")
print("=" * 60)

print(f"\n1. [Hanteo Chodong > Circle Cumulative (>10k gap)] : {len(issues['hanteo_gt_circle_cumul'])} cases")
for it in sorted(issues["hanteo_gt_circle_cumul"], key=lambda x: x["diff"], reverse=True)[:15]:
    print(f"  - [{it['group']}({it['slug']})] {it['title']} ({it['date']}): Hanteo Chodong {it['ht_cho']:,} > Circle Cum {it['cc_cum']:,} (Gap: +{it['diff']:,})")

print(f"\n2. [Circle Chodong > Circle Cumulative Contradiction] : {len(issues['circle_chodong_gt_cumul'])} cases")
for it in issues["circle_chodong_gt_cumul"]:
    print(f"  - [{it['group']}({it['slug']})] {it['title']} ({it['date']}): Circle Chodong {it['cc_cho']:,} > Circle Cum {it['cc_cum']:,}")

print(f"\n3. [Physical Album with Empty Release Date] : {len(issues['empty_date_physical'])} cases")
for it in issues["empty_date_physical"]:
    print(f"  - [{it['group']}({it['slug']})] {it['title']} ({it['type']})")

print(f"\n4. [Duplicate Album Title on Same Date] : {len(issues['duplicate_titles_same_date'])} cases")
for it in issues["duplicate_titles_same_date"]:
    print(f"  - [{it['group']}({it['slug']})] '{it['title']}' on {it['date']}")
