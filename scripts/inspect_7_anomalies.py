import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

p = Path(r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\data\namu-groups")
slugs = ['cravity', 'e-last', 'kep1er', 'oh-my-girl', 'pentagon', 'wei']
for s in slugs:
    with open(p / f"{s}.json", encoding='utf-8') as f:
        d = json.load(f)
    for a in d.get('albums', []):
        cho_str = str(a.get('초동_써클', '')).replace(',', '').strip()
        cum_str = str(a.get('누적_써클', '')).replace(',', '').strip()
        if cho_str.isdigit() and cum_str.isdigit():
            cho = int(cho_str)
            cum = int(cum_str)
            if cho > cum and cum > 0:
                print(f"[{s}] {a.get('title')}: 초동={cho:,} 누적={cum:,} timeline={a.get('monthly_timeline')}")
