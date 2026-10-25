from bs4 import BeautifulSoup
from pathlib import Path
import sys

sys.stdout.reconfigure(encoding='utf-8')

p = Path(r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\namu\idntt\index.html")
with open(p, encoding='utf-8') as f:
    soup = BeautifulSoup(f.read(), 'html.parser')

tables = soup.find_all('table')
print(f"Total tables: {len(tables)}")
for idx, table in enumerate(tables):
    headers = [th.get_text(strip=True) for th in table.find_all('th')]
    print(f"\n--- Table {idx+1} (Headers: {headers}) ---")
    for tr in table.find_all('tr')[1:]:
        cells = [td.get_text(strip=True) for td in tr.find_all(['td', 'th'])]
        if cells:
            print(" | ".join(cells))
