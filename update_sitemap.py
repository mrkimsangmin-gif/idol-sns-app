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


def lastmod_of(*json_paths):
    """원천 JSON의 **내장 'generated' 타임스탬프**(YYYY-MM-DD) 중 최신. 없으면 오늘.
    주의: 파일 mtime을 쓰지 말 것 — git이 mtime을 보존하지 않아 CI 체크아웃 시 전부 '오늘'이 되어
    freshness 신호가 매 빌드 무의미해진다. 데이터 내용에 박힌 generated 값은 체크아웃과 무관하게 안정적."""
    dates = []
    for p in json_paths:
        try:
            g = json.loads(Path(p).read_text(encoding='utf-8')).get('generated')
            if g:
                dates.append(str(g)[:10])
        except Exception:
            pass
    return max(dates) if dates else TODAY


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
        # per-group json엔 generated가 없음 → 그룹 데이터셋 갱신 시점(namu-index.generated) 사용
        urls.append(url_block(f'{BASE}/namu/{slug}/', lastmod_of(data / 'namu-index.json'), 'weekly', '0.6'))

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
          f'(정적 200 서빙분만, lastmod=데이터 내장 generated)')


if __name__ == '__main__':
    generate_sitemap()
