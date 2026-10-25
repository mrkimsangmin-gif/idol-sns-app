import os
import json
import glob
import sys
import re

sys.stdout.reconfigure(encoding='utf-8')

groups_dir = r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\data\namu-groups"
files = glob.glob(os.path.join(groups_dir, "*.json"))

issues = []

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
            album_type = str(album.get("type", "")).strip()
            date = str(album.get("발매일", "")).strip()
            biko = str(album.get("비고", "")).strip()
            
            reasons = []
            if any(q in title for q in ["???", "미정", "TBD", "TBA", "가제"]):
                reasons.append("placeholder_title")
            elif title in ["?", "??", "-", ""]:
                reasons.append("empty_or_symbol_title")
            elif re.search(r"[\?？]{2,}", title):
                reasons.append("question_marks_in_title")
                
            if album_type in ["미정", "???", "발매 예정", "발매예정"]:
                reasons.append("placeholder_type")
                
            if reasons:
                issues.append({
                    "group": group_name,
                    "slug": slug,
                    "idx": idx,
                    "title": title,
                    "type": album_type,
                    "date": date,
                    "biko": biko,
                    "reasons": reasons,
                    "sales_hanteo": album.get("초동_한터") or album.get("총판_한터"),
                    "sales_circle": album.get("초동_써클") or album.get("누적_써클"),
                    "all_albums": [(a.get("title"), a.get("발매일")) for a in albums]
                })
    except Exception as e:
        print(f"Error {fname}: {e}")

print(f"Total issue albums: {len(issues)}\n")
for it in issues:
    same_date = [a for a in it["all_albums"] if a[1] == it["date"] and a[0] != it["title"] and it["date"]]
    print(f"Group: {it['group']} ({it['slug']}) | Alb #{it['idx']}")
    print(f"  Title: '{it['title']}' | Type: '{it['type']}' | Date: '{it['date']}' | Biko: '{it['biko']}'")
    print(f"  Reasons: {it['reasons']}")
    if same_date:
        print(f"  * Same date exists in other albums: {same_date}")
    print("-" * 60)
