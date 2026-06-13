"""
sitemap.xml 자동 갱신 스크립트

원칙:
- **실제 200으로 서빙되는(정적 파일이 존재하는) URL만 포함** → sitemap 404 방지
  (SPA 전용 라우트 /ranking, /news, /comeback, /namu, /douyin 등은 직접 접근 시 404라 제외)
- **URL별 lastmod는 원천 데이터 파일의 mtime 기준** → 안 바뀐 과거 페이지가 오늘로 찍히지 않음
- 사용법: python update_sitemap.py
"""
import json, sys, io, os
from datetime import date
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

ROOT = Path(__file__).resolve().parent
TODAY = date.today().isoformat()
BASE = 'https://aimcontents.com'


def lastmod_of(*paths):
    """**원천 데이터** 파일들 중 가장 최근 mtime의 날짜(YYYY-MM-DD). 없으면 오늘.
    주의: 생성된 정적 HTML mtime은 넣지 말 것(매 빌드마다 오늘로 갱신돼 freshness 신호 무의미)."""
    times = [os.path.getmtime(p) for p in paths if p and Path(p).exists()]
    if not times:
        return TODAY
    return date.fromtimestamp(max(times)).isoformat()


def url_block(loc, lastmod, freq, priority):
    return (f'  <url>\n    <loc>{loc}</loc>\n    <lastmod>{lastmod}</lastmod>\n'
            f'    <changefreq>{freq}</changefreq>\n    <priority>{priority}</priority>\n  </url>')


def generate_sitemap():
    data = ROOT / 'data'
    urls = []

    # 1) 정적 파일이 존재하는 고정 페이지만 (url, 정적파일, lastmod소스, freq, priority)
    static_defs = [
        ('/',              ROOT / 'index.html',              ROOT / 'index.html',           'daily',   '1.0'),
        ('/jobs/',         ROOT / 'jobs' / 'index.html',     data / 'jobs.json',            'daily',   '0.7'),
        ('/methodology/',  ROOT / 'methodology' / 'index.html', data / 'namu-index.json',   'monthly', '0.5'),
    ]
    static_count = 0
    for path, static_file, src, freq, pr in static_defs:
        if not static_file.exists():
            continue
        static_count += 1
        urls.append(url_block(f'{BASE}{path}', lastmod_of(src), freq, pr))

    # 2) 나무위키 그룹 (정적 페이지 존재분만), lastmod = 원천 per-group json mtime
    idx = json.loads((data / 'namu-index.json').read_text(encoding='utf-8'))
    group_count = 0
    for g in idx.get('groups', []):
        slug = g.get('slug', '')
        page = ROOT / 'namu' / slug / 'index.html'
        if not slug or not page.exists():
            continue
        group_count += 1
        src = data / 'namu-groups' / f'{slug}.json'
        urls.append(url_block(f'{BASE}/namu/{slug}/', lastmod_of(src), 'weekly', '0.6'))

    # 3) 월별 랭킹 (정적 생성분), lastmod = 성별별 원천 SNS json mtime
    ranking_root = ROOT / 'ranking'
    ranking_count = 0
    if ranking_root.exists():
        for page in sorted(ranking_root.glob('*/*/index.html')):
            rel = page.parent.relative_to(ranking_root).as_posix()  # 'YYYY-MM/sns-gender'
            gender_slug = page.parent.name.rsplit('-', 1)[-1]       # boys / girls
            src = data / ('sns-male.json' if gender_slug == 'boys' else 'sns-female.json')
            ranking_count += 1
            urls.append(url_block(f'{BASE}/ranking/{rel}/', lastmod_of(src), 'monthly', '0.7'))

    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
           + '\n'.join(urls) + '\n</urlset>\n')
    (ROOT / 'sitemap.xml').write_text(xml, encoding='utf-8')

    print(f'sitemap.xml updated: {len(urls)} URLs')
    print(f'  Static: {static_count}, Groups: {group_count}, Rankings: {ranking_count} '
          f'(정적 200 서빙분만, lastmod=원천 mtime)')


if __name__ == '__main__':
    generate_sitemap()
