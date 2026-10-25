import os
import json
import glob
import sys

sys.stdout.reconfigure(encoding='utf-8')

groups_dir = r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\data\namu-groups"
files = glob.glob(os.path.join(groups_dir, "*.json"))

total_groups = len(files)
total_albums = 0
issues = []

for fpath in files:
    slug = os.path.basename(fpath).replace(".json", "")
    with open(fpath, encoding="utf-8") as f:
        data = json.load(f)
    
    albums = data.get("albums", [])
    total_albums += len(albums)
    group_name = data.get("name", slug)
    
    seen_keys = set()
    for idx, a in enumerate(albums):
        tit = str(a.get("title", "")).strip()
        atype = str(a.get("type", "")).strip()
        date = str(a.get("발매일", "")).strip()
        cho_hanteo = str(a.get("초동_한터", "")).replace(",", "").strip()
        cho_circle = str(a.get("초동_써클", "")).replace(",", "").strip()
        cum_circle = str(a.get("누적_써클", "")).replace(",", "").strip()
        
        # 1. Circle Chodong > Cumulative contradiction
        if cho_circle.isdigit() and cum_circle.isdigit():
            c_val = int(cho_circle)
            u_val = int(cum_circle)
            if c_val > u_val and u_val > 0:
                issues.append(f"[{group_name} ({slug})] '{tit}': 써클 초동({c_val:,}) > 써클 누적({u_val:,}) 역전")
        
        # 2. Duplicate album title on same date
        key = (tit.lower(), date, atype)
        if date and key in seen_keys:
            issues.append(f"[{group_name} ({slug})] '{tit}' ({date}): 동일 발매일 중복 등록")
        if date:
            seen_keys.add(key)
        
        # 3. Missing title or ghost placeholder
        if not tit or tit in ["?", "??", "-", "미정", "TBD"]:
            issues.append(f"[{group_name} ({slug})] #{idx}: 유령/미정 앨범명 ('{tit}')")

print(f"=== 전수 조사 결과 요약 ===")
print(f"총 그룹 수: {total_groups}개")
print(f"총 앨범 수: {total_albums}개")
print(f"발견된 이상치 건수: {len(issues)}건")

if issues:
    print("\n[이상치 목록]")
    for iss in issues[:30]:
        print(" - " + iss)
    if len(issues) > 30:
        print(f" ... 외 {len(issues) - 30}건")
else:
    print("\n✓ 212개 전 그룹, 총 {total_albums}개 앨범에서 써클 초동 역전, 중복 앨범, 유령 데이터가 0건으로 완전히 무결합니다.")
