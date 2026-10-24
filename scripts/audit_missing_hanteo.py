import glob, json, sys

sys.stdout.reconfigure(encoding='utf-8')

files = glob.glob(r'G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\data\namu-groups\*.json')
missing = []

for f in files:
    with open(f, encoding='utf-8') as fp:
        d = json.load(fp)
    slug = d.get('slug', '')
    name = d.get('name', '')
    for idx, a in enumerate(d.get('albums', [])):
        title = a.get('title', '')
        atype = a.get('type', '')
        date = a.get('발매일', '')
        ht = a.get('초동_한터', '')
        cc_cho = a.get('초동_써클', '')
        cc_cum = a.get('누적_써클', '')
        
        # Exclude digital / non-physical releases
        if any(w in atype for w in ['디지털', 'OST', '리믹스']) or any(w in title for w in ['TRACK', 'Remix', 'Instrumental', '[발매 예정]']):
            continue
            
        if (not ht or ht == '-') and cc_cum and cc_cum != '-':
            try:
                num = int(cc_cum.replace(',', ''))
                if num >= 10000:
                    missing.append({
                        'slug': slug,
                        'name': name,
                        'title': title,
                        'type': atype,
                        'date': date,
                        'cc_cum': cc_cum,
                        'cc_cho': cc_cho
                    })
            except: pass

print(f"Total major physical albums (>=10k Circle sales) missing Hanteo sales: {len(missing)}")
# Group by year
by_year = {}
for m in missing:
    yr = m['date'][:4] if m['date'] else 'unknown'
    by_year[yr] = by_year.get(yr, 0) + 1

print("\nBreakdown by release year:")
for yr, cnt in sorted(by_year.items()):
    print(f"  {yr}: {cnt} albums")

print("\nTop 25 highest-selling albums missing Hanteo:")
missing_sorted = sorted(missing, key=lambda x: int(x['cc_cum'].replace(',', '')), reverse=True)
for m in missing_sorted[:25]:
    print(f"- [{m['name']}({m['slug']})] {m['title']} | Type: {m['type']} | Date: {m['date']} | Circle Cum: {m['cc_cum']}")
