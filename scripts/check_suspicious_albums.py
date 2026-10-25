import os
import json
import glob
import sys

sys.stdout.reconfigure(encoding='utf-8')

groups_dir = r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\data\namu-groups"
files = glob.glob(os.path.join(groups_dir, "*.json"))
print(f"Total group files: {len(files)}")

suspicious = []
patterns = ["???", "미정", "TBD", "TBA", "발매 예정", "발매예정", "가제", "알수없음", "미상"]

for fpath in files:
    fname = os.path.basename(fpath)
    try:
        with open(fpath, encoding="utf-8") as f:
            data = json.load(f)
        group_name = data.get("name", "")
        slug = data.get("slug", fname.replace(".json", ""))
        
        albums = data.get("albums", [])
        for idx, album in enumerate(albums):
            title = str(album.get("title", "")).strip()
            matched = None
            for p in patterns:
                if p.lower() in title.lower():
                    matched = p
                    break
            if not matched and title in ["?", "??", "???", "????", "-", ""]:
                matched = "empty_or_question"
            
            if matched:
                suspicious.append({
                    "file": fname,
                    "group": group_name,
                    "slug": slug,
                    "album_idx": idx,
                    "title": title,
                    "type": album.get("type", ""),
                    "date": album.get("발매일", ""),
                    "matched": matched
                })
    except Exception as e:
        print(f"Error reading {fname}: {e}")

print(f"\nFound {len(suspicious)} suspicious album entries across all groups:")
for s in suspicious:
    print(f"- [{s['group']}({s['slug']}) alb#{s['album_idx']}] Title: '{s['title']}' | Type: '{s['type']}' | Date: '{s['date']}' (Reason: {s['matched']})")
