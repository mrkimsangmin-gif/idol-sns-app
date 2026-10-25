import glob, json, sys, os, re

sys.stdout.reconfigure(encoding='utf-8')
groups_dir = r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\data\namu-groups"
files = glob.glob(os.path.join(groups_dir, "*.json"))

print("=" * 60)
print("STARTING COMPREHENSIVE CHART INTEGRITY REPAIR")
print("=" * 60)

# Known ground truth corrections for major inflated Hanteo figures
# (e.g. aespa pre-orders mistakenly recorded as Hanteo chodong)
HANTEO_TRUTH_FIXES = {
    ("aespa", "Armageddon"): "1,154,742",
    ("aespa", "Drama"): "1,130,379",
    ("aespa", "Whiplash"): "913,200",
}

repaired_circle_contradictions = 0
repaired_hanteo_inflations = 0
removed_duplicates = 0
fixed_dates = 0

# Known release date fixes for physical albums
DATE_FIXES = {
    ("b-d-u", "Friends to Lovers"): "2024.08.20",
    ("mamamoo", "Mr.애매모호"): "2014.06.18",
    ("mamamoo", "딩가딩가"): "2020.10.20",
    ("mamamoo", "mumumumuch"): "2021.09.15",
    ("trendz", "Chameleon"): "2024.11.12",
}

for fpath in files:
    fname = os.path.basename(fpath)
    slug = fname.replace(".json", "")
    with open(fpath, encoding='utf-8') as fp:
        d = json.load(fp)
    
    albums = d.get("albums", [])
    new_albums = []
    mod = False
    seen_keys = set()

    for idx, a in enumerate(albums):
        tit = str(a.get("title", "")).strip()
        atype = str(a.get("type", "")).strip()
        date = str(a.get("발매일", "")).strip()

        # Fix 1: Release date repair
        if (slug, tit) in DATE_FIXES and not date:
            a["발매일"] = DATE_FIXES[(slug, tit)]
            date = a["발매일"]
            mod = True
            fixed_dates += 1
            print(f"[{slug}] Fixed missing release date for '{tit}': {date}")

        # Fix 2: Remove duplicate album titles on exact same date
        key = (tit.lower(), date, atype)
        if date and key in seen_keys:
            print(f"[{slug}] Removed duplicate album: '{tit}' on {date}")
            removed_duplicates += 1
            mod = True
            continue
        if date:
            seen_keys.add(key)

        # Fix 3: Hanteo inflation fixes (ground truth verified)
        if (slug, tit) in HANTEO_TRUTH_FIXES:
            truth_val = HANTEO_TRUTH_FIXES[(slug, tit)]
            truth_num = int(truth_val.replace(',', ''))
            a["초동_한터"] = truth_val
            a["초동_한터_numeric"] = truth_num
            mod = True
            repaired_hanteo_inflations += 1
            print(f"[{slug}] Corrected inflated Hanteo Chodong for '{tit}': -> {truth_val}")

        # Fix 4: Circle Chodong > Circle Cumulative contradiction repair
        # If monthly_timeline exists, first month is the true Circle chodong!
        timeline = a.get("monthly_timeline", [])
        cho_num = a.get("초동_써클_numeric", 0)
        cum_num = a.get("누적_써클_numeric", 0)

        if cho_num > 0 and cum_num > 0 and cho_num > cum_num:
            if timeline and len(timeline) > 0:
                # Real first month sales from timeline
                real_first_month = timeline[0].get("sales", 0)
                if real_first_month > 0 and real_first_month <= cum_num:
                    a["초동_써클"] = f"{real_first_month:,}"
                    a["초동_써클_numeric"] = real_first_month
                    print(f"[{slug}] Repaired Circle Chodong for '{tit}' via monthly timeline: {cho_num:,} -> {real_first_month:,} (Cumul: {cum_num:,})")
                    repaired_circle_contradictions += 1
                    mod = True
                else:
                    # Chodong cannot exceed cumulative
                    a["초동_써클"] = a.get("누적_써클")
                    a["초동_써클_numeric"] = cum_num
                    print(f"[{slug}] Capped Circle Chodong for '{tit}' to cumulative: {cum_num:,}")
                    repaired_circle_contradictions += 1
                    mod = True
            else:
                a["초동_써클"] = a.get("누적_써클")
                a["초동_써클_numeric"] = cum_num
                print(f"[{slug}] Capped Circle Chodong for '{tit}' to cumulative: {cum_num:,}")
                repaired_circle_contradictions += 1
                mod = True

        new_albums.append(a)

    if mod:
        d["albums"] = new_albums
        with open(fpath, "w", encoding='utf-8') as fp:
            json.dump(d, fp, ensure_ascii=False, indent=2)

print("\n" + "=" * 60)
print(f"REPAIR SUMMARY:")
print(f"- Circle Chodong > Cumul Contradictions Fixed: {repaired_circle_contradictions}")
print(f"- Hanteo Inflations Corrected to Ground Truth: {repaired_hanteo_inflations}")
print(f"- Duplicate Albums Removed: {removed_duplicates}")
print(f"- Missing Release Dates Fixed: {fixed_dates}")
print("=" * 60)
