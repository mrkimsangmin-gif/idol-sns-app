from bs4 import BeautifulSoup
from pathlib import Path
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

p = Path(r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\namu\idntt\index.html")
soup = BeautifulSoup(p.read_text(encoding='utf-8'), 'html.parser')

print("1. Title:", soup.title.string if soup.title else '')

# Check visually-hidden element
vh = soup.find('div', class_='visually-hidden')
print("\n2. Visually Hidden Element (for SEO Bots only):")
if vh:
    print(vh.prettify())
else:
    print("Not found!")

# Check FAQPage in JSON-LD
scripts = soup.find_all('script', type='application/ld+json')
print(f"\n3. JSON-LD scripts count: {len(scripts)}")
for idx, s in enumerate(scripts):
    try:
        data = json.loads(s.string)
        if data.get('@type') == 'FAQPage':
            print(f"--- FAQPage (Script #{idx+1}) ---")
            for q in data.get('mainEntity', []):
                print(" Q:", q.get('name'))
                print(" A:", q.get('acceptedAnswer', {}).get('text'))
    except:
        pass
