import os
import json
import glob
import sys
import re

sys.stdout.reconfigure(encoding='utf-8')

groups_dir = r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\data\namu-groups"
files = glob.glob(os.path.join(groups_dir, "*.json"))

total_groups_updated = 0
total_removed = 0
total_renamed = 0
total_scheduled = 0

for fpath in files:
    fname = os.path.basename(fpath)
    slug = fname.replace(".json", "")
    with open(fpath, encoding="utf-8") as f:
        data = json.load(f)
    
    albums = data.get("albums", [])
    if not albums:
        continue
    
    modified = False
    new_albums = []
    
    for idx, album in enumerate(albums):
        title = str(album.get("title", "")).strip()
        atype = str(album.get("type", "")).strip()
        date = str(album.get("발매일", "")).strip()
        biko = str(album.get("비고", "")).strip()
        
        # 1. Special rule for idntt: rename to Kids Return (Japanese Ver.)
        if slug == "idntt" and title == "??? (Japanese ver.)":
            album["title"] = "Kids Return (Japanese Ver.)"
            album["비고"] = album.get("비고") or "일본 디지털 싱글"
            new_albums.append(album)
            modified = True
            total_renamed += 1
            print(f"[idntt] Renamed '??? (Japanese ver.)' -> 'Kids Return (Japanese Ver.)'")
            continue
            
        # Type A: Duplicate ghost rows where a real album exists with identical or verified date
        # ahof: ??? on 2026.07.08 (RUN TO YOU exists)
        if slug == "ahof" and title == "???" and date == "2026.07.08":
            modified = True
            total_removed += 1
            print(f"[{slug}] Removed ghost row '{title}' ({date})")
            continue
            
        # cortis: ??? on 2026.04.20 (REDRED exists)
        if slug == "cortis" and title == "???" and date == "2026.04.20":
            modified = True
            total_removed += 1
            print(f"[{slug}] Removed ghost row '{title}' ({date})")
            continue
            
        # kickflip: 미정 on 2026.04.06 (My First Kick exists)
        if slug == "kickflip" and title == "미정" and date == "2026.04.06":
            modified = True
            total_removed += 1
            print(f"[{slug}] Removed ghost row '{title}' ({date})")
            continue
            
        # p1harmony: 미정 on 2026.03.12 (UNIQUE exists)
        if slug == "p1harmony" and title == "미정" and date == "2026.03.12":
            modified = True
            total_removed += 1
            print(f"[{slug}] Removed ghost row '{title}' ({date})")
            continue
            
        # rescene: ??? on 2026.04.08 (Runaway exists)
        if slug == "rescene" and title == "???" and date == "2026.04.08":
            modified = True
            total_removed += 1
            print(f"[{slug}] Removed ghost row '{title}' ({date})")
            continue
            
        # rescene: [RESCENE X ???] on 2026.02.27 (Busy Boy / Higher exists)
        if slug == "rescene" and "[RESCENE X ???]" in title:
            # Check if actual songs Busy Boy / Higher exist
            modified = True
            total_removed += 1
            print(f"[{slug}] Removed ghost row '{title}' ({date})")
            continue
            
        # riize: ??? on 2026.06.15 (II exists with sales 1.77M!)
        if slug == "riize" and title == "???" and date == "2026.06.15":
            modified = True
            total_removed += 1
            print(f"[{slug}] Removed ghost row '{title}' ({date})")
            continue
            
        # babymonster: two duplicates on 2026.XX.XX (one '미정', one '???')
        # Keep one as scheduled album, drop the duplicate '???'
        if slug == "babymonster" and title == "???" and date == "2026.XX.XX":
            modified = True
            total_removed += 1
            print(f"[{slug}] Removed duplicate ghost row '{title}' ({date})")
            continue

        # yuhz / close-your-eyes duplicate placeholders
        if slug == "yuhz" and title == "???":
            modified = True
            total_removed += 1
            print(f"[{slug}] Removed ghost row '{title}'")
            continue

        # 3. Type B: Genuine unreleased / scheduled albums
        # Replace title with clean '[발매 예정] <유형/비고>'
        is_placeholder_title = (
            title in ["미정", "???", "??", "?", "-"] or
            re.search(r"^[\?？]+$", title) or
            title.startswith("?? 1집")
        )
        
        if is_placeholder_title:
            # Build an informative title
            type_label = atype if atype and atype not in ["미정", "???", "발매 예정", "발매예정"] else ""
            biko_label = biko if biko and biko not in ["미정", "???", "발매 예정", "발매예정", "-"] else ""
            
            label_candidate = type_label or biko_label or "앨범"
            # e.g., "[발매 예정] 2집 정규앨범", "[발매 예정] 5집 미니앨범"
            new_title = f"[발매 예정] {label_candidate}"
            album["title"] = new_title
            if not album.get("비고"):
                album["비고"] = "타이틀 미정 (발매 예정)"
            modified = True
            total_scheduled += 1
            print(f"[{slug}] Formatted unreleased album: '{title}' -> '{new_title}' ({date})")

        # Also normalize album type if type is '미정'
        if atype in ["미정", "???"]:
            album["type"] = "발매 예정"
            modified = True
            
        new_albums.append(album)
        
    if modified:
        data["albums"] = new_albums
        with open(fpath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        total_groups_updated += 1

print("\n" + "=" * 50)
print(f"Done! Updated {total_groups_updated} groups.")
print(f"- Renamed specific albums: {total_renamed}")
print(f"- Removed ghost duplicate rows: {total_removed}")
print(f"- Reformatted to '[발매 예정] ...': {total_scheduled}")
print("=" * 50)
