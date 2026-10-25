import glob, json, os, sys
sys.stdout.reconfigure(encoding='utf-8')

raw_dir = r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\07.hanteo\data\circle-monthly-raw"
files = glob.glob(os.path.join(raw_dir, "*.json"))
print(f"Total raw files: {len(files)}")

for fpath in sorted(files):
    fname = os.path.basename(fpath)
    with open(fpath, encoding="utf-8") as f:
        d = json.load(f)
    items = d.get("albums", [])
    for it in items:
        artist = it.get("artist", "")
        album = it.get("album", "")
        if "idntt" in artist.lower() or "yesweare" in album.lower() or "아이덴티티" in artist:
            print(f"{fname}: {artist} - {album} | Sales: {it.get('sales'):,} | Cumul: {it.get('cumulative'):,}")
