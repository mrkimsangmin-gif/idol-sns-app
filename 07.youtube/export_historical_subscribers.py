"""
Export historical YouTube subscriber data from sns_data_cache.csv
to timeseries/youtube/subscribers_daily.csv format.

Converts monthly snapshots (2024-03 ~ 2026-01) into the same format
used by the daily collector for seamless time-series analysis.
"""
import csv
import os
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE_DIR = r'G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit'
CACHE_CSV = os.path.join(BASE_DIR, '08.kpop_sns', 'data', 'sns_data_cache.csv')
OUTPUT_CSV = os.path.join(BASE_DIR, '04.aimcontents.com', 'idol-sns-app', 'data', 'timeseries', 'youtube', 'subscribers_daily.csv')

def main():
    # Read historical YouTube data from sns_data_cache
    rows = []
    with open(CACHE_CSV, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for r in reader:
            if r['sns'] == '유튜브' and r['count']:
                try:
                    count = int(float(r['count']))
                except ValueError:
                    continue
                # Convert YYYY-MM to YYYY-MM-01 (first day of month)
                date_str = r['date'].strip() + '-01'
                rows.append({
                    'date': date_str,
                    'group': r['group'],
                    'subscribers': count,
                    'source': 'historical'
                })

    # Sort by date, then group
    rows.sort(key=lambda x: (x['date'], x['group']))

    # Check if output file exists and has daily data
    existing_daily = []
    if os.path.exists(OUTPUT_CSV):
        with open(OUTPUT_CSV, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for r in reader:
                if r.get('source') != 'historical':
                    existing_daily.append(r)

    # Write: historical first, then daily data
    os.makedirs(os.path.dirname(OUTPUT_CSV), exist_ok=True)
    with open(OUTPUT_CSV, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['date', 'group', 'subscribers', 'source'])
        writer.writeheader()
        writer.writerows(rows)
        writer.writerows(existing_daily)

    dates = sorted(set(r['date'] for r in rows))
    groups = set(r['group'] for r in rows)
    print(f'Exported {len(rows)} historical records')
    print(f'Groups: {len(groups)}')
    print(f'Date range: {dates[0]} ~ {dates[-1]} ({len(dates)} months)')
    print(f'Daily records preserved: {len(existing_daily)}')
    print(f'Output: {OUTPUT_CSV}')

if __name__ == '__main__':
    main()
