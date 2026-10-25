import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHELL = ROOT / "index.html"
OUT_DIR = ROOT / "en"
OUT_NEWS_DIR = ROOT / "en" / "news"

def replace_once(text, old, new, label):
    if text.count(old) != 1:
        raise RuntimeError(f"[앵커 불일치] '{label}' 발생횟수={text.count(old)} (1이어야 함)")
    return text.replace(old, new)

def build_en_home_and_news():
    raw = SHELL.read_text(encoding="utf-8")

    # 1. EN Home (en/index.html)
    t_home = raw
    t_home = replace_once(t_home, '<html lang="ko">', '<html lang="en">', "html lang en")
    t_home = replace_once(
        t_home,
        "<title>아이돌 SNS 팔로워 순위 - 틱톡·유튜브·인스타·웨이보·도우인 | 아이엠콘텐츠</title>",
        "<title>K-POP Idol SNS & Discography Analytics | AIMCONTENTS</title>",
        "title en"
    )
    seo_links = (
        '<link rel="canonical" href="https://aimcontents.com/en/">\n'
        '    <link rel="alternate" hreflang="ko" href="https://aimcontents.com/">\n'
        '    <link rel="alternate" hreflang="en" href="https://aimcontents.com/en/">\n'
        '    <link rel="alternate" hreflang="x-default" href="https://aimcontents.com/">'
    )
    t_home = replace_once(t_home, '<link rel="canonical" href="https://aimcontents.com/">', seo_links, "canonical en")
    
    # Nav labels
    t_home = replace_once(t_home, "route('home')\">SNS랭킹</a>", "route('home')\">SNS Ranking</a>", "nav ranking en")
    t_home = replace_once(t_home, '/monthly/2026-09/boys/">월간차트<', '/monthly/2026-09/boys/">Monthly Chart<', "nav monthly en")
    t_home = replace_once(t_home, "route('comeback')\">컴백일정</a>", "route('comeback')\">Comebacks</a>", "nav comeback en")
    t_home = replace_once(t_home, "route('news')\">엔터뉴스</a>", "route('news')\">News</a>", "nav news en")
    t_home = replace_once(t_home, "route('douyin')\">중국트렌드</a>", "route('douyin')\">China Trends</a>", "nav douyin en")
    t_home = replace_once(t_home, "route('jobs')\">채용정보</a>", "route('jobs')\">Jobs</a>", "nav jobs en")
    t_home = replace_once(t_home, "route('links')\">링크모음</a>", "route('links')\">Links</a>", "nav links en")
    t_home = replace_once(t_home, "route('vendors')\">업체정보</a>", "route('vendors')\">Vendors</a>", "nav vendors en")
    t_home = replace_once(t_home, 'href="/insight/index_insight.html">인사이트</a>', 'href="/insight/index_insight.html">Insights</a>', "nav insights en")

    # Add toggle to EN
    pos_ins = t_home.find('index_insight.html')
    pos_end_ul = t_home.find('</ul>', pos_ins) + 5
    nav_tail = t_home[pos_ins:pos_end_ul]
    lang_btn_en = (
        '<li class="nav-item ms-lg-2 my-1 my-lg-0">'
        '<a class="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" '
        'href="https://aimcontents.com/"><i class="bi bi-globe"></i> 한국어</a></li>'
        '\n                </ul>'
    )
    t_home = replace_once(t_home, nav_tail, nav_tail[:-5] + lang_btn_en, "nav lang toggle en")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "index.html").write_text(t_home, encoding="utf-8")
    print(f"Created: {OUT_DIR / 'index.html'}")

    # 2. EN News (en/news/index.html)
    t_news = t_home
    t_news = replace_once(
        t_news,
        "<title>K-POP Idol SNS & Discography Analytics | AIMCONTENTS</title>",
        "<title>Latest K-POP Entertainment News & Industry Headlines | AIMCONTENTS</title>",
        "title news en"
    )
    # switch visible section from home to news
    t_news = replace_once(t_news, '<section id="page-home" class="page-section">',
                          '<section id="page-home" class="page-section d-none">', "page-home hide")
    t_news = replace_once(t_news, '<section id="page-news" class="page-section d-none">',
                          '<section id="page-news" class="page-section">', "page-news show")
    t_news = replace_once(t_news, '<h2 class="mb-3 fw-bold fs-5">실시간 엔터테인먼트 뉴스</h2>',
                          '<h2 class="mb-3 fw-bold fs-5">Real-Time K-POP Entertainment News</h2>', "news h2 en")
    t_news = replace_once(t_news, '<p class="text-muted small mb-3">업데이트: <span id="newsUpdateTime">-</span></p>',
                          '<p class="text-muted small mb-3">Updated: <span id="newsUpdateTime">-</span></p>', "news updated en")
    
    # Update canonical for news
    seo_links_news = (
        '<link rel="canonical" href="https://aimcontents.com/en/news/">\n'
        '    <link rel="alternate" hreflang="ko" href="https://aimcontents.com/news">\n'
        '    <link rel="alternate" hreflang="en" href="https://aimcontents.com/en/news/">\n'
        '    <link rel="alternate" hreflang="x-default" href="https://aimcontents.com/news">'
    )
    t_news = replace_once(t_news, seo_links, seo_links_news, "canonical news en")

    OUT_NEWS_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_NEWS_DIR / "index.html").write_text(t_news, encoding="utf-8")
    print(f"Created: {OUT_NEWS_DIR / 'index.html'}")

if __name__ == "__main__":
    build_en_home_and_news()
