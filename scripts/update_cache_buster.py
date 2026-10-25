import re
import glob
from pathlib import Path

base = Path(r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app")
html_files = list(base.glob("namu/**/*.html")) + [base / "namu" / "index.html"]

count = 0
for f in html_files:
    if not f.exists(): continue
    txt = f.read_text(encoding='utf-8')
    if "namu-smart-search.js?v=20260912nosource" in txt:
        txt = txt.replace("namu-smart-search.js?v=20260912nosource", "namu-smart-search.js?v=20261025history")
        f.write_text(txt, encoding='utf-8')
        count += 1

print(f"Updated cache-buster in {count} HTML files!")
