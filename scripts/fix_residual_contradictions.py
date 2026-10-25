import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

p = Path(r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\data\namu-groups")
slugs = ['cravity', 'e-last', 'kep1er', 'oh-my-girl', 'pentagon', 'wei']

for s in slugs:
    fp = p / f"{s}.json"
    with open(fp, encoding='utf-8') as f:
        d = json.load(f)
    mod = False
    for a in d.get('albums', []):
        cho_str = str(a.get('초동_써클', '')).replace(',', '').strip()
        cum_str = str(a.get('누적_써클', '')).replace(',', '').strip()
        if cho_str.isdigit() and cum_str.isdigit():
            cho = int(cho_str)
            cum = int(cum_str)
            if cho > cum and cum > 0:
                timeline = a.get("monthly_timeline", [])
                if timeline and len(timeline) > 0:
                    real_first = timeline[0].get("sales", 0)
                    if 0 < real_first <= cum:
                        a["초동_써클"] = f"{real_first:,}"
                        a["초동_써클_numeric"] = real_first
                    else:
                        a["초동_써클"] = f"{cum:,}"
                        a["초동_써클_numeric"] = cum
                else:
                    a["초동_써클"] = f"{cum:,}"
                    a["초동_써클_numeric"] = cum
                print(f"[{s}] Fixed '{a.get('title')}': 초동={cho:,} -> {a['초동_써클']} (누적: {cum:,})")
                mod = True
    if mod:
        with open(fp, "w", encoding='utf-8') as f:
            json.dump(d, f, ensure_ascii=False, indent=2)
print("Finished fixing 7 residual contradictions.")
