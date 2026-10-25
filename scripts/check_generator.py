import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

p = Path(r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\generate_static.py")
txt = p.read_text(encoding='utf-8')

for match in re.finditer(r'def ([a-zA-Z0-9_]+)\(.*?album.*?\):', txt):
    print(match.group(0))

for line in txt.splitlines():
    if "초동(써클)" in line or "초동(한터)" in line or "누적(써클)" in line:
        print(line.strip())
