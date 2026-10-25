# -*- coding: utf-8 -*-
"""
영문 SNS 랭킹 랜딩 페이지 (/en/ranking/index.html) 및 정적 페이지 생성 스크립트
- 봇/크롤러: 영어 최신 Top 1위 표 + FAQ + Schema.org ItemList/Dataset + hreflang
- 사람: script.js가 URL을 인식해 /en/ 언어 모드로 동작 (드롭다운, 검색창, 카드 영문화)
"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHELL = ROOT / "index.html"
SITE = "https://aimcontents.com"
URL_EN = f"{SITE}/en/ranking/"
URL_KO = f"{SITE}/ranking/"

def esc(s):
    return html.escape(str(s if s is not None else ""), quote=True)

def replace_once(text, old, new, label):
    if text.count(old) != 1:
        raise RuntimeError(f"[앵커 불일치] '{label}' = {text.count(old)} (1이어야 함)")
    return text.replace(old, new)

def build_en_jsonld():
    return """
    <script type="application/ld+json" data-static="ranking-hub-en">
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "name": "K-POP Idol SNS & Global Follower Rankings",
  "description": "Comprehensive follower and subscriber rankings for K-POP idols across YouTube, TikTok, Instagram, Weibo, Spotify, and Bilibili.",
  "url": "https://aimcontents.com/en/ranking/",
  "numberOfItems": 7,
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "name": "TikTok",
      "item": {
        "@type": "WebPage",
        "name": "K-POP Idol TikTok Ranking",
        "url": "https://aimcontents.com/en/ranking/"
      }
    },
    {
      "@type": "ListItem",
      "position": 2,
      "name": "YouTube",
      "item": {
        "@type": "WebPage",
        "name": "K-POP Idol YouTube Ranking",
        "url": "https://aimcontents.com/en/ranking/"
      }
    },
    {
      "@type": "ListItem",
      "position": 3,
      "name": "Instagram",
      "item": {
        "@type": "WebPage",
        "name": "K-POP Idol Instagram Ranking",
        "url": "https://aimcontents.com/en/ranking/"
      }
    },
    {
      "@type": "ListItem",
      "position": 4,
      "name": "Weibo",
      "item": {
        "@type": "WebPage",
        "name": "K-POP Idol Weibo Ranking",
        "url": "https://aimcontents.com/en/ranking/"
      }
    },
    {
      "@type": "ListItem",
      "position": 5,
      "name": "Spotify",
      "item": {
        "@type": "WebPage",
        "name": "K-POP Idol Spotify Ranking",
        "url": "https://aimcontents.com/en/ranking/"
      }
    },
    {
      "@type": "ListItem",
      "position": 6,
      "name": "Bilibili",
      "item": {
        "@type": "WebPage",
        "name": "K-POP Idol Bilibili Ranking",
        "url": "https://aimcontents.com/en/ranking/"
      }
    },
    {
      "@type": "ListItem",
      "position": 7,
      "name": "Douyin",
      "item": {
        "@type": "WebPage",
        "name": "K-POP Idol Douyin Trends",
        "url": "https://aimcontents.com/douyin/"
      }
    }
  ]
}
    </script>
    <script type="application/ld+json" data-static="ranking-hub-en">
{
  "@context": "https://schema.org",
  "@type": "Dataset",
  "name": "K-POP Idol SNS Followers & Global Engagement Dataset",
  "description": "Monthly verified follower counts, growth rates, and engagement metrics for over 188 K-POP idol groups across 8 major social platforms.",
  "url": "https://aimcontents.com/en/ranking/",
  "creator": {
    "@type": "Organization",
    "name": "AIMCONTENTS",
    "url": "https://aimcontents.com"
  }
}
    </script>
    """

def build_en_baked_content():
    return """
    <div class="col-12">
        <section class="mb-4">
            <h2 class="fs-5 fw-bold mb-3">🔥 Major SNS Platform Rankings</h2>
            <div class="row g-2 mb-4">
                <div class="col-6 col-md-3">
                    <div class="card p-3 border-0 shadow-sm">
                        <strong class="text-danger">YouTube (Female)</strong>
                        <small class="text-muted mt-1">#1 BLACKPINK (101M)</small>
                    </div>
                </div>
                <div class="col-6 col-md-3">
                    <div class="card p-3 border-0 shadow-sm">
                        <strong class="text-danger">YouTube (Male)</strong>
                        <small class="text-muted mt-1">#1 BTS (86.0M)</small>
                    </div>
                </div>
                <div class="col-6 col-md-3">
                    <div class="card p-3 border-0 shadow-sm">
                        <strong class="text-warning">Weibo (Male)</strong>
                        <small class="text-muted mt-1">#1 BTS (5.67M)</small>
                    </div>
                </div>
                <div class="col-6 col-md-3">
                    <div class="card p-3 border-0 shadow-sm">
                        <strong class="text-warning">Weibo (Female)</strong>
                        <small class="text-muted mt-1">#1 BLACKPINK (5.77M)</small>
                    </div>
                </div>
                <div class="col-6 col-md-3">
                    <div class="card p-3 border-0 shadow-sm">
                        <strong class="text-success">Spotify (Male)</strong>
                        <small class="text-muted mt-1">#1 BTS (31.46M)</small>
                    </div>
                </div>
                <div class="col-6 col-md-3">
                    <div class="card p-3 border-0 shadow-sm">
                        <strong class="text-success">Spotify (Female)</strong>
                        <small class="text-muted mt-1">#1 ILLIT (20.20M)</small>
                    </div>
                </div>
                <div class="col-6 col-md-3">
                    <a href="/douyin" class="card p-3 border-0 shadow-sm text-decoration-none text-dark">
                        <strong>China Douyin Trends</strong>
                        <small class="text-muted mt-1">Weekly viral challenges</small>
                    </a>
                </div>
                <div class="col-6 col-md-3">
                    <a href="/en/namu/bts/" class="card p-3 border-0 shadow-sm text-decoration-none text-dark">
                        <strong class="text-primary">Idol Profiles</strong>
                        <small class="text-muted mt-1">199 K-pop groups DB</small>
                    </a>
                </div>
            </div>
        </section>

        <section class="mb-4">
            <h2 class="fs-5 fw-bold mb-2">Frequently Asked Questions (FAQ)</h2>
            <dl>
                <dt class="fw-bold mt-2">How often are the K-POP idol SNS rankings updated?</dt>
                <dd>Follower statistics across YouTube, Spotify, Instagram, Weibo, and Bilibili are systematically gathered and refreshed monthly, while TikTok and Douyin challenge metrics are updated weekly.</dd>
                <dt class="fw-bold mt-2">What metrics are included in the rankings?</dt>
                <dd>We measure total active followers, month-over-month growth rate, and 30-day engagement rate (ER) based on average views, likes, comments, and shares across 199 verified K-POP idol groups.</dd>
            </dl>
            <p class="text-muted small">Source: AIMCONTENTS (aimcontents.com) · Verified Monthly & Weekly Analytics</p>
        </section>
    </div>
    """

def generate_en_ranking():
    text = SHELL.read_text(encoding="utf-8")

    # 1) html lang
    text = replace_once(text, '<html lang="ko">', '<html lang="en">', "html lang")

    # 2) title, description, canonical, hreflang
    title = "K-POP Idol SNS & Global Follower Rankings | AIMCONTENTS"
    desc = "Compare K-POP idol follower rankings and engagement across YouTube, TikTok, Instagram, Weibo, Spotify, and Bilibili. Track verified real-time metrics for 199+ groups."

    text = re.sub(r'<title>.*?</title>', f'<title>{esc(title)}</title>', text, count=1)
    text = re.sub(r'<meta name="description"[^>]*>', f'<meta name="description" content="{esc(desc)}">', text, count=1)
    text = re.sub(r'<link rel="canonical"[^>]*>', f'<link rel="canonical" href="{URL_EN}">', text, count=1)

    hreflang_tags = (
        f'<link rel="alternate" hreflang="ko" href="{URL_KO}">\n'
        f'    <link rel="alternate" hreflang="en" href="{URL_EN}">\n'
        f'    <link rel="alternate" hreflang="x-default" href="{URL_KO}">'
    )
    text = replace_once(text, '</head>', f'{hreflang_tags}\n{build_en_jsonld()}\n</head>', "head close")

    # OG / Twitter
    text = re.sub(r'<meta property="og:title"[^>]*>', f'<meta property="og:title" content="{esc(title)}">', text, count=1)
    text = re.sub(r'<meta property="og:description"[^>]*>', f'<meta property="og:description" content="{esc(desc)}">', text, count=1)
    text = re.sub(r'<meta property="og:url"[^>]*>', f'<meta property="og:url" content="{URL_EN}">', text, count=1)
    text = re.sub(r'<meta name="twitter:title"[^>]*>', f'<meta name="twitter:title" content="{esc(title)}">', text, count=1)
    text = re.sub(r'<meta name="twitter:description"[^>]*>', f'<meta name="twitter:description" content="{esc(desc)}">', text, count=1)
    text = re.sub(r'<meta name="twitter:url"[^>]*>', f'<meta name="twitter:url" content="{URL_EN}">', text, count=1)

    # 3) 상단 네비게이션 라벨 영문화
    text = replace_once(text, 'route(\'home\')">SNS랭킹</a>', 'route(\'home\')">SNS Ranking</a>', "nav ranking en")
    text = replace_once(text, '/monthly/2026-09/boys/">월간차트<', '/monthly/2026-09/boys/">Monthly Chart<', "nav monthly en")
    text = replace_once(text, 'route(\'namu\')">나무위키<', 'route(\'namu\')">Profiles<', "nav namu en")
    text = replace_once(text, 'route(\'comeback\')">컴백일정</a>', 'route(\'comeback\')">Comebacks</a>', "nav comeback en")
    text = replace_once(text, 'route(\'news\')">엔터뉴스</a>', 'route(\'news\')">News</a>', "nav news en")
    text = replace_once(text, 'route(\'douyin\')">중국트렌드</a>', 'route(\'douyin\')">China Trends</a>', "nav douyin en")
    text = replace_once(text, 'route(\'jobs\')">채용정보</a>', 'route(\'jobs\')">Jobs</a>', "nav jobs en")
    text = replace_once(text, 'route(\'links\')">링크모음</a>', 'route(\'links\')">Links</a>', "nav links en")
    text = replace_once(text, 'route(\'vendors\')">업체정보</a>', 'route(\'vendors\')">Vendors</a>', "nav vendors en")
    text = replace_once(text, 'href="/insight/index_insight.html">인사이트</a>', 'href="/insight/index_insight.html">Insights</a>', "nav insights en")

    # 4) [🌐 한국어] 언어 전환기 주입 (기존 English 버튼이 있다면 교체, 없으면 새로 주입)
    if 'href="https://aimcontents.com/en/"><i class="bi bi-globe"></i> English</a></li>' in text:
        text = replace_once(
            text,
            'href="https://aimcontents.com/en/"><i class="bi bi-globe"></i> English</a></li>',
            f'href="{URL_KO}"><i class="bi bi-globe"></i> 한국어</a></li>',
            "nav lang toggle replace"
        )
    else:
        pos_ins = text.find('href="/insight/index_insight.html">Insights</a>')
        pos_end_ul = text.find('</ul>', pos_ins) + 5
        nav_tail = text[pos_ins:pos_end_ul]
        lang_btn_en = (
            f'<li class="nav-item ms-lg-2 my-1 my-lg-0">'
            f'<a class="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" '
            f'href="{URL_KO}"><i class="bi bi-globe"></i> 한국어</a></li>'
            f'\n                </ul>'
        )
        text = replace_once(text, nav_tail, nav_tail[:-5] + lang_btn_en, "nav lang toggle en")

    # 5) Ranking 본문 UI 영문화 (헤딩, 드롭다운, 검색창)
    text = replace_once(text, '<h1 class="mb-3 fw-bold fs-5">K-POP 아이돌 SNS 팔로워 순위</h1>',
                       '<h1 class="mb-3 fw-bold fs-5">K-POP Idol SNS & Follower Rankings</h1>', "heading en")
    text = replace_once(text, 'id="genderDropdown" data-bs-toggle="dropdown" data-bs-auto-close="true"\n                                aria-expanded="false">\n                                남자\n                            </button>',
                       'id="genderDropdown" data-bs-toggle="dropdown" data-bs-auto-close="true"\n                                aria-expanded="false">\n                                Male\n                            </button>', "gender btn en")
    text = replace_once(text, 'onclick="updateFilter(\'gender\', \'남자\'); return false;">남자</a>',
                       'onclick="updateFilter(\'gender\', \'남자\'); return false;">Male</a>', "gender male en")
    text = replace_once(text, 'onclick="updateFilter(\'gender\', \'여자\'); return false;">여자</a>',
                       'onclick="updateFilter(\'gender\', \'여자\'); return false;">Female</a>', "gender female en")

    text = replace_once(text, 'id="snsDropdown" data-bs-toggle="dropdown" data-bs-auto-close="true"\n                                aria-expanded="false">\n                                웨이보\n                            </button>',
                       'id="snsDropdown" data-bs-toggle="dropdown" data-bs-auto-close="true"\n                                aria-expanded="false">\n                                Weibo\n                            </button>', "sns btn en")
    text = replace_once(text, 'onclick="updateFilter(\'sns\', \'웨이보\'); return false;">웨이보</a>',
                       'onclick="updateFilter(\'sns\', \'웨이보\'); return false;">Weibo</a>', "sns weibo en")
    text = replace_once(text, 'onclick="updateFilter(\'sns\', \'차오화\'); return false;">웨이보(슈퍼챗)</a>',
                       'onclick="updateFilter(\'sns\', \'차오화\'); return false;">Weibo (Super Topic)</a>', "sns chaohua en")
    text = replace_once(text, 'onclick="updateFilter(\'sns\', \'빌리빌리\'); return false;">빌리빌리</a>',
                       'onclick="updateFilter(\'sns\', \'빌리빌리\'); return false;">Bilibili</a>', "sns bilibili en")
    text = replace_once(text, 'onclick="updateFilter(\'sns\', \'QQ뮤직\'); return false;">QQ뮤직</a>',
                       'onclick="updateFilter(\'sns\', \'QQ뮤직\'); return false;">QQ Music</a>', "sns qqmusic en")
    text = replace_once(text, 'onclick="updateFilter(\'sns\', \'X(트위터)\'); return false;">X(트위터)</a>',
                       'onclick="updateFilter(\'sns\', \'X(트위터)\'); return false;">X (Twitter)</a>', "sns twitter en")
    text = replace_once(text, 'onclick="updateFilter(\'sns\', \'유튜브\'); return false;">유튜브</a>',
                       'onclick="updateFilter(\'sns\', \'유튜브\'); return false;">YouTube</a>', "sns youtube en")
    text = replace_once(text, 'onclick="updateFilter(\'sns\', \'스포티파이\'); return false;">스포티파이</a>',
                       'onclick="updateFilter(\'sns\', \'스포티파이\'); return false;">Spotify</a>', "sns spotify en")
    text = replace_once(text, 'onclick="updateFilter(\'sns\', \'인스타그램\'); return false;">인스타그램</a>',
                       'onclick="updateFilter(\'sns\', \'인스타그램\'); return false;">Instagram</a>', "sns instagram en")

    text = replace_once(text, '조회 월 선택\n                            </button>',
                       'Select Month\n                            </button>', "month btn en")
    text = replace_once(text, '<input type="text" class="form-control border" id="searchInput" placeholder="그룹 검색">',
                       '<input type="text" class="form-control border" id="searchInput" placeholder="Search idol or group...">', "search placeholder en")

    # 6) Modal UI 영문화
    text = replace_once(text, '<small class="text-muted" id="idolInfo">YG Entertainment • 2016년 데뷔</small>',
                       '<small class="text-muted" id="idolInfo">YG Entertainment • Debuted in 2016</small>', "modal info en")
    text = replace_once(text, '📚 나무위키에서 보기\n                        </a>',
                       '📚 View on Wiki\n                        </a>', "modal wiki btn en")
    text = replace_once(text, '<label class="form-label fw-bold small">SNS 링크</label>',
                       '<label class="form-label fw-bold small">Official SNS Links</label>', "modal sns label en")
    text = replace_once(text, '<label class="form-label fw-bold small">메모</label>',
                       '<label class="form-label fw-bold small">Notes</label>', "modal note label en")

    # 7) 모바일 하단 네비게이션 영문화
    text = replace_once(text, '<span class="mobile-nav-label">홈/랭킹</span>', '<span class="mobile-nav-label">Ranking</span>', "mob ranking en")
    text = replace_once(text, '<span class="mobile-nav-label">컴백</span>', '<span class="mobile-nav-label">Comebacks</span>', "mob comeback en")
    text = replace_once(text, '<span class="mobile-nav-label">엔터뉴스</span>', '<span class="mobile-nav-label">News</span>', "mob news en")
    text = replace_once(text, '<span class="mobile-nav-label">채용정보</span>', '<span class="mobile-nav-label">Jobs</span>', "mob jobs en")

    # 8) baked 콘텐츠 주입
    baked_html = build_en_baked_content()
    text = replace_once(
        text,
        '<div id="result-area" class="row g-3">',
        f'<div id="result-area" class="row g-3">{baked_html}',
        "result-area inject"
    )

    # Additional UI translations for hidden/tab sections
    extra_map = {
        'placeholder="그룹명 또는 아티스트 검색 (예: 르세라핌, 원어스)"': 'placeholder="Search group or artist (e.g. LE SSERAFIM, ONEUS)..."',
        'onclick="changeCalendarMonth(-1)">이전달</button>': 'onclick="changeCalendarMonth(-1)">Prev Month</button>',
        'onclick="changeCalendarMonth(1)">다음달</button>': 'onclick="changeCalendarMonth(1)">Next Month</button>',
        'onclick="resetCalendarToCurrentMonth()">오늘</button>': 'onclick="resetCalendarToCurrentMonth()">Today</button>',
        '>전체</button>': '>All</button>',
        '>마케팅</button>': '>Marketing</button>',
        '>영상</button>': '>Video/Media</button>',
        '>신인개발</button>': '>A&R / Casting</button>',
        '>매니지먼트</button>': '>Management</button>',
        '>프로듀싱</button>': '>Producing</button>',
        '>디자인</button>': '>Design</button>',
        'placeholder="업체명 또는 키워드 검색"': 'placeholder="Search vendor or keyword..."',
        'placeholder="성함"': 'placeholder="Your name"',
        'placeholder="수정할 내용이나 포트폴리오 URL 등을 적어주세요."': 'placeholder="Describe edits or provide portfolio URL..."',
        'placeholder="그룹/멤버 검색 또는 질문"': 'placeholder="Search group, member, or question..."',
        'aria-label="닫기"': 'aria-label="Close"',
        'aria-label="메뉴 열기"': 'aria-label="Open Menu"',
    }
    for old_str, new_str in extra_map.items():
        text = text.replace(old_str, new_str)

    out_dir = ROOT / "en" / "ranking"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "index.html"
    out_file.write_text(text, encoding="utf-8")
    print(f"✅ Generated EN ranking page: {out_file.relative_to(ROOT)} ({out_file.stat().st_size:,} bytes)")

if __name__ == "__main__":
    generate_en_ranking()
