"""
sitemap.xml 자동 갱신 스크립트
- data/namu-index.json에서 그룹 slug 추출
- 기존 페이지 + 174개 그룹 개별 URL 생성
- lastmod를 실행 시점 날짜로 자동 업데이트
- 사용법: python update_sitemap.py
"""
import json, sys, io
from datetime import date
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# 프로젝트 루트 (이 스크립트와 같은 디렉토리)
ROOT = Path(__file__).resolve().parent
TODAY = date.today().isoformat()  # YYYY-MM-DD

# 고정 페이지 정의
STATIC_PAGES = [
    ('/', 'daily', '1.0'),
    ('/ranking', 'monthly', '0.9'),
    ('/comeback', 'weekly', '0.8'),
    ('/news', 'daily', '0.8'),
    ('/links', 'monthly', '0.6'),
    ('/jobs', 'daily', '0.7'),
    ('/vendors', 'monthly', '0.6'),
    ('/douyin', 'weekly', '0.6'),
    ('/namu', 'weekly', '0.8'),
    ('/namuwiki', 'weekly', '0.7'),
    ('/namu/ranking', 'weekly', '0.7'),
    ('/team', 'monthly', '0.4'),
]

# SNS별 랭킹 페이지
SNS_PAGES = ['weibo', 'bilibili', 'qqmusic', 'twitter', 'youtube', 'spotify', 'chaohua', 'instagram']

def generate_sitemap():
    # namu-index.json에서 그룹 slug 추출
    index_path = ROOT / 'data' / 'namu-index.json'
    with open(index_path, 'r', encoding='utf-8') as f:
        idx = json.load(f)
    groups = idx.get('groups', [])

    urls = []

    # 고정 페이지
    for path, freq, priority in STATIC_PAGES:
        urls.append(f'''  <url>
    <loc>https://aimcontents.com{path}</loc>
    <lastmod>{TODAY}</lastmod>
    <changefreq>{freq}</changefreq>
    <priority>{priority}</priority>
  </url>''')

    # SNS별 랭킹
    for sns in SNS_PAGES:
        priority = '0.8' if sns in ('weibo', 'bilibili', 'youtube', 'instagram') else '0.7'
        urls.append(f'''  <url>
    <loc>https://aimcontents.com/ranking/{sns}</loc>
    <lastmod>{TODAY}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>{priority}</priority>
  </url>''')

    # 나무위키 그룹 개별 페이지
    # - 정적 페이지(namu/<slug>/index.html)가 실제 생성된 슬러그만 포함
    #   (미생성 슬러그는 SPA 404 핵으로 404 → 사이트맵 오류 방지)
    # - GitHub Pages가 /namu/<slug> → /namu/<slug>/ 로 301하므로 끝슬래시 URL 사용
    group_count = 0
    for g in groups:
        slug = g.get('slug', '')
        if not slug:
            continue
        if not (ROOT / 'namu' / slug / 'index.html').exists():
            continue
        group_count += 1
        urls.append(f'''  <url>
    <loc>https://aimcontents.com/namu/{slug}/</loc>
    <lastmod>{TODAY}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>''')

    # XML 생성
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    xml += '\n'.join(urls) + '\n'
    xml += '</urlset>\n'

    # 저장
    sitemap_path = ROOT / 'sitemap.xml'
    with open(sitemap_path, 'w', encoding='utf-8') as f:
        f.write(xml)

    print(f'sitemap.xml updated: {len(urls)} URLs, lastmod={TODAY}')
    print(f'  Static: {len(STATIC_PAGES)}, SNS: {len(SNS_PAGES)}, Groups: {group_count} (정적 생성분만)')

if __name__ == '__main__':
    generate_sitemap()
