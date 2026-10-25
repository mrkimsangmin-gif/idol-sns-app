import glob, json, sys, os

sys.stdout.reconfigure(encoding='utf-8')
groups_dir = r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\data\namu-groups"

# 1. First fix idntt.json
idntt_path = os.path.join(groups_dir, "idntt.json")
with open(idntt_path, encoding='utf-8') as fp:
    idntt_data = json.load(fp)

new_albums = []
for a in idntt_data.get("albums", []):
    tit = a.get("title", "")
    # Remove ghost unreleased album 'idntt' with empty date
    if tit == "idntt" and not a.get("발매일"):
        print("Removed ghost album: 'idntt' 1집 미니앨범")
        continue
    # Clean duplicates: keep id TRACK versions or title versions
    if tit == "8시 11분":
        print("Removed duplicate song entry: '8시 11분' (unevermet id TRACK covers it)")
        continue
    if tit == "All I Need":
        print("Removed duplicate song entry: 'All I Need' (yesweare id TRACK covers it)")
        continue

    # Update itsnotover with exact verified dual figures
    if tit == "itsnotover":
        a["초동_한터"] = "568,005"
        a["초동_한터_numeric"] = 568005
        a["누적_한터"] = "568,698"
        a["누적_한터_numeric"] = 568698
        a["초동_써클"] = "277,887"
        a["초동_써클_numeric"] = 277887
        a["누적_써클"] = "278,868"
        a["누적_써클_numeric"] = 278868
        a["비고"] = "Kids Return, It's Not Over"
        print("Updated 'itsnotover' with verified figures (Hanteo Chodong: 568,005, Cum: 568,698 / Circle Chodong: 277,887, Cum: 278,868)")

    new_albums.append(a)

idntt_data["albums"] = new_albums
with open(idntt_path, "w", encoding='utf-8') as fp:
    json.dump(idntt_data, fp, ensure_ascii=False, indent=2)

print("\nidntt.json updated successfully.")
