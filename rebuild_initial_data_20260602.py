"""initial-data.json 재생성 — update_sns_data.py 의 generate_initial_data() 단독 호출.

배경:
  2026-05-31 ranking 2605 배포가 sns-male/female.json 만 갱신,
  initial-data.json 누락 → SPA default month 가 2026-04 로 stale.
  사용자 보고 2026-06-02: 페이지 진입 시 2026-04 가 default.

작업:
  - 백업: data/initial-data.json.bak.20260602
  - 재생성: latestMonth = sns-male/female.json 의 최신 month (2026-05 예상)
"""
import sys, io, json, shutil
from pathlib import Path
from datetime import datetime, timezone

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)

ROOT = Path(__file__).parent
DATA = ROOT / 'data'
SNS_MALE = DATA / 'sns-male.json'
SNS_FEMALE = DATA / 'sns-female.json'
INITIAL = DATA / 'initial-data.json'
BAK = DATA / f'initial-data.json.bak.20260602'

# update_sns_data.py 의 generate_initial_data 재사용
sys.path.insert(0, str(ROOT))
from update_sns_data import generate_initial_data  # type: ignore

# ============================================================
# SEO Top 10 블록 자동 갱신
# index.html 의 <!-- SEO_RANKING_BLOCK_START --> ~ END 마커 사이를
# 남자/웨이보 latestMonth Top 10 으로 매월 자동 교체.
# ============================================================
import re

INDEX_HTML = ROOT / 'index.html'
SEO_START = '<!-- SEO_RANKING_BLOCK_START'
SEO_END = '<!-- SEO_RANKING_BLOCK_END -->'

def format_year_month_korean(yyyy_mm):
    """'2026-05' -> '2026년 5월'"""
    y, m = yyyy_mm.split('-')
    return f'{y}년 {int(m)}월'

def build_seo_block(records_top10, year_month, indent='        '):
    """SEO 블록 HTML 생성 — 헤딩 + ol/li 리스트.
    records_top10: [{name, group, count}, ...] (이미 top 10 정렬됨)
    """
    label = format_year_month_korean(year_month)
    lines = [
        f'{indent}<!-- SEO_RANKING_BLOCK_START — 매월 자동 갱신 영역 (rebuild_initial_data update_seo_block) -->',
        f'{indent}<h3>{label} 남자 아이돌 웨이보 팔로워 Top 10</h3>',
        f'{indent}<ol>',
    ]
    for r in records_top10:
        name = r.get('name') or ''
        group = r.get('group') or ''
        count = r.get('count') or 0
        lines.append(f'{indent}    <li>{name} ({group}) - {count:,}</li>')
    lines.append(f'{indent}</ol>')
    lines.append(f'{indent}<!-- SEO_RANKING_BLOCK_END -->')
    return '\n'.join(lines)

def update_seo_block(male_data):
    """index.html 의 SEO 마커 사이를 최신 데이터로 교체."""
    weibo = male_data.get('data', {}).get('웨이보')
    if not weibo:
        print('[seo] male 웨이보 데이터 없음 — skip'); return False
    months = sorted(weibo.get('months', []))
    if not months:
        print('[seo] months 비어있음 — skip'); return False
    latest = months[-1]

    top10 = sorted([r for r in weibo['records'] if r['date'] == latest],
                   key=lambda r: -r.get('count', 0))[:10]
    if not top10:
        print(f'[seo] latest={latest} records 없음 — skip'); return False

    new_block = build_seo_block(top10, latest)

    txt = INDEX_HTML.read_text(encoding='utf-8')
    # 마커 검사
    if SEO_START not in txt or SEO_END not in txt:
        print(f'[seo] index.html 에 마커 없음 ({SEO_START} / {SEO_END}) — skip'); return False

    # START 마커 (포함된 줄 전체) ~ END 마커 (포함된 줄 전체) 까지 교체
    pattern = re.compile(
        r'[^\n]*' + re.escape(SEO_START) + r'[^\n]*\n.*?\n[^\n]*' + re.escape(SEO_END) + r'[^\n]*',
        re.DOTALL,
    )
    new_txt, n = pattern.subn(new_block, txt, count=1)
    if n == 0:
        print('[seo] 마커 영역 매칭 실패 — skip'); return False

    # 백업
    bak = INDEX_HTML.with_suffix('.html.bak.20260602')
    if not bak.exists():
        bak.write_text(txt, encoding='utf-8')
        print(f'[seo backup] {bak.name}: {bak.stat().st_size:,} bytes')

    INDEX_HTML.write_text(new_txt, encoding='utf-8')
    print(f'\n[seo updated] index.html — 남자/웨이보 {latest} Top 10 반영')
    for i, r in enumerate(top10, 1):
        print(f'  {i:>2}. {r["name"]} ({r["group"]}) - {r["count"]:,}')
    return True

# 1) 두 JSON 로드
with open(SNS_MALE, 'r', encoding='utf-8') as f: male = json.load(f)
with open(SNS_FEMALE, 'r', encoding='utf-8') as f: female = json.load(f)
print(f'[load] male generated={male.get("generated")}')
print(f'[load] female generated={female.get("generated")}')

# 2) 각 sns 별 최신 month 진단 (재생성 전 데이터 확인)
for label, j in [('남자', male), ('여자', female)]:
    for sns_name in j.get('snsList', []):
        platform = j.get('data', {}).get(sns_name)
        if not platform: continue
        months = sorted(platform.get('months', []))
        if not months: continue
        latest = months[-1]
        print(f'  {label} / {sns_name:<12} latest={latest} (months={len(months)})')

# 3) 백업
shutil.copy2(INITIAL, BAK)
print(f'\n[backup] {BAK.name}: {BAK.stat().st_size:,} bytes')

# 4) 재생성
initial = generate_initial_data(female, male)
combo_count = len(initial.get('combinations', {}))

with open(INITIAL, 'w', encoding='utf-8') as f:
    json.dump(initial, f, ensure_ascii=False, indent=2)

print(f'\n[rebuilt] {INITIAL.name}: {INITIAL.stat().st_size:,} bytes')
print(f'  generated: {initial["generated"]}')
print(f'  version: {initial.get("version")}')
print(f'  combinations: {combo_count}')

# 5) 검증 — 각 조합의 latestMonth
print('\n조합별 latestMonth:')
for key, combo in sorted(initial['combinations'].items()):
    m = combo['meta']
    print(f'  {key:<24} latest={m["latestMonth"]} prev={m["prevMonth"]} months_count={len(m["allMonths"])}')

# 6) SEO 정적 블록 (남자/웨이보 Top 10) 자동 갱신
print('\n[6] SEO 블록 자동 갱신 (index.html)')
update_seo_block(male)
