from en_shell_localizer import localize_shell_to_en
# -*- coding: utf-8 -*-
"""
영문 컴백/데뷔 캘린더 페이지 (/en/comeback/index.html) 정적 생성 스크립트.
- 봇/검색엔진: #calendarContainer 에 현재 월 영문 캘린더 그리드 + 라인업 카드 목록 사전 렌더링 (SSR)
              Schema.org MusicEvent / CollectionPage JSON-LD 주입
- 사람: calendar.js가 URL을 인식해 /en/ 언어 모드로 동작 (요일, 월, 필터, 뱃지 완벽 영문화)
"""
import sys
sys.stdout.reconfigure(encoding='utf-8')
import calendar
import datetime
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHELL = ROOT / "index.html"
SITE = "https://aimcontents.com"
URL_EN = f"{SITE}/en/comeback/"
URL_KO = f"{SITE}/comeback/"

FALLBACK_GENDER_MAP = {
    'verivery': '남자', '베리베리': '남자', 'big-ocean': '남자', '빅오션': '남자',
    'w3way': '남자', '위웨이': '남자', 'b1a4': '남자', '비원에이포': '남자',
    'exo': '남자', '엑소': '남자', 'nct wish': '남자', 'nctwish': '남자', '엔시티위시': '남자',
    'genus': '남자', '제너스': '남자', 'tnx': '남자', '티엔엑스': '남자',
    '미완소년': '남자', 'v01d': '남자', '보이드': '남자', 'b:dawn': '남자', 'bdawn': '남자', '비던': '남자',
    'btob': '남자', '비투비': '남자', 'bigbang': '남자', '빅뱅': '남자',
    '씨엔블루': '남자', 'cnblue': '남자', 'onewe': '남자', '원위': '남자', 'splayit': '남자', '에스플릿': '남자',
    '엔플라잉': '남자', 'n-flying': '남자', 'nflying': '남자',
    '올데이프로젝트': '혼성', 
}

def esc(s):
    return html.escape(str(s if s is not None else ""), quote=True)

def replace_once(text, old, new, label):
    if text.count(old) != 1:
        raise RuntimeError(f"[앵커 불일치] '{label}' = {text.count(old)} (1이어야 함)")
    return text.replace(old, new)

def strip_once(text, pattern, label):
    new, n = re.subn(pattern, "", text, flags=re.DOTALL)
    if n != 1:
        raise RuntimeError(f"[strip 불일치] '{label}' = {n} (1이어야 함)")
    return new

def load_gender_map():
    gmap = {}
    idx_file = ROOT / "data" / "namu-index.json"
    if idx_file.exists():
        try:
            data = json.loads(idx_file.read_text(encoding="utf-8"))
            for g in data.get("groups", []):
                gen = g.get("gender") or ""
                if g.get("slug"):
                    gmap[g["slug"].lower()] = gen
                if g.get("name"):
                    gmap[g["name"].lower().replace(" ", "")] = gen
        except Exception:
            pass
    return gmap

def get_event_gender(ev, gmap):
    slug = (ev.get("slug") or "").lower()
    if slug in FALLBACK_GENDER_MAP:
        return FALLBACK_GENDER_MAP[slug]
    if slug and slug in gmap:
        return gmap[slug]
    raw_title = re.sub(r"\(Comeback\)|\(Debut\)", "", ev.get("title") or "", flags=re.IGNORECASE).strip()
    norm_title = raw_title.lower().replace(" ", "")
    if norm_title in gmap:
        return gmap[norm_title]
    return ""

def load_artist_en_map():
    en_map = {}
    idx_file = ROOT / "data" / "namu-index.json"
    if idx_file.exists():
        try:
            data = json.loads(idx_file.read_text(encoding="utf-8"))
            for g in data.get("groups", []):
                slug = (g.get("slug") or "").lower()
                name = g.get("name") or ""
                name_en = g.get("name_en") or ""
                if name_en:
                    if slug:
                        en_map[slug] = name_en
                    if name:
                        en_map[name] = name_en
                        en_map[name.lower().replace(" ", "")] = name_en
        except Exception:
            pass
    en_file = ROOT / "data" / "idol-names-en.json"
    if en_file.exists():
        try:
            extra = json.loads(en_file.read_text(encoding="utf-8"))
            en_map.update(extra)
        except Exception:
            pass
    return en_map

def get_artist_en_name(title, slug, en_map):
    raw = re.sub(r"\(Comeback\)|\(Debut\)", "", title or "", flags=re.IGNORECASE).strip()
    if slug and slug.lower() in en_map:
        return en_map[slug.lower()]
    clean = raw.lower().replace(" ", "")
    if clean in en_map:
        return en_map[clean]
    if raw in en_map:
        return en_map[raw]
    return raw

def build_events_jsonld_en(events, year, month, gmap, en_map):
    items = []
    for ev in events:
        d_str = ev.get("date") or ""
        clean_title = get_artist_en_name(ev.get("title") or "", ev.get("slug"), en_map)
        is_debut = "데뷔" in (ev.get("title") or "") or "Debut" in (ev.get("title") or "")
        event_name = f"{clean_title} {'Debut' if is_debut else 'Comeback'}"
        slug = ev.get("slug")
        profile_url = f"{SITE}/en/namu/{slug}/" if slug else URL_EN

        event_obj = {
            "@type": "MusicEvent",
            "name": f"[K-POP] {event_name}",
            "startDate": f"{d_str}T18:00:00+09:00",
            "endDate": f"{d_str}T23:59:59+09:00",
            "eventStatus": "https://schema.org/EventScheduled",
            "eventAttendanceMode": "https://schema.org/OnlineEventAttendanceMode",
            "location": {
                "@type": "VirtualLocation",
                "url": profile_url
            },
            "performer": {
                "@type": "MusicGroup",
                "name": clean_title,
                "url": profile_url
            },
            "description": ev.get("description") or f"K-POP {clean_title} official {d_str} comeback/debut schedule and details.",
            "url": URL_EN
        }
        items.append(event_obj)

    en_months = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    m_name = en_months[month]

    collection = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": f"K-POP Comeback Schedule 2026 — {m_name} Idol Debuts & Releases | AIMCONTENTS",
        "url": URL_EN,
        "description": f"Verified upcoming and confirmed K-POP idol comebacks, debuts, and album releases for {m_name} {year}.",
        "publisher": {
            "@type": "Organization",
            "name": "AIMCONTENTS",
            "url": SITE
        }
    }

    graph = {
        "@context": "https://schema.org",
        "@graph": items
    }
    return collection, graph

def build_baked_calendar_en(events, year, month, gmap, en_map):
    month_str = f"{year}-{month:02d}"
    first_weekday, num_days = calendar.monthrange(year, month)
    first_day_index = (first_weekday + 1) % 7

    filtered = [ev for ev in events if (ev.get("date") or "").startswith(month_str)]

    weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    grid = ['<div class="cal-scroll-wrapper"><div class="cal-scroll-inner">']
    grid.append('<div class="cal-grid-header">')
    for i, wd in enumerate(weekdays):
        color = ' text-danger' if i == 0 else (' text-primary' if i == 6 else '')
        grid.append(f'<div class="cal-header-cell{color}">{wd}</div>')
    grid.append('</div>')

    grid.append('<div class="cal-grid-body">')
    for _ in range(first_day_index):
        grid.append('<div class="cal-cell cal-cell-empty"></div>')

    today = datetime.date.today()
    is_this_ym = (today.year == year and today.month == month)

    for d in range(1, num_days + 1):
        d_str = f"{month_str}-{d:02d}"
        is_today = is_this_ym and (d == today.day)
        day_events = [ev for ev in filtered if ev.get("date") == d_str]
        col_idx = (first_day_index + d - 1) % 7
        color_cls = ' text-danger' if col_idx == 0 else (' text-primary' if col_idx == 6 else '')

        cell_cls = 'cal-cell cal-today' if is_today else 'cal-cell'
        grid.append(f'<div class="{cell_cls}">')
        date_num = f'<span class="cal-today-circle">{d}</span>' if is_today else f'<span class="{color_cls}">{d}</span>'
        grid.append(f'<div class="cal-date-number">{date_num}</div>')
        grid.append('<div class="cal-events-list">')

        for ev in day_events:
            is_debut = "데뷔" in (ev.get("title") or "") or "Debut" in (ev.get("title") or "")
            gen = get_event_gender(ev, gmap)
            badge_cls = 'cal-badge-boy' if gen == '남자' else ('cal-badge-girl' if gen == '여자' else 'cal-badge-neutral')
            if is_debut:
                badge_cls += ' cal-badge-is-debut'
            clean_title = get_artist_en_name(ev.get("title") or "", ev.get("slug"), en_map)
            debut_tag = '<span class="cal-debut-tag">Debut</span>' if is_debut else ''
            ev_id = esc(ev.get("id", ""))
            c_title_esc = esc(clean_title)

            grid.append(
                f'<div class="cal-event-badge {badge_cls}" onclick="openCalEventModal(\'{ev_id}\')" title="{c_title_esc}{" (Debut)" if is_debut else ""}">'
                f'<span class="cal-event-dot"></span><span class="cal-event-text">{c_title_esc}</span>{debut_tag}'
                f'</div>'
            )
        grid.append('</div></div>')

    grid.append('</div></div></div>')

    en_months = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    m_name = en_months[month]

    summary = [f'<div class="mt-4"><h3 class="fs-6 fw-bold mb-3">Lineup for {m_name} {year} ({len(filtered)} Groups)</h3>']
    if not filtered:
        summary.append('<div class="text-center py-4 text-muted">No confirmed comeback or debut schedule for this month.</div>')
    else:
        summary.append('<div class="row g-2">')
        for ev in filtered:
            is_debut = "데뷔" in (ev.get("title") or "") or "Debut" in (ev.get("title") or "")
            gen = get_event_gender(ev, gmap)
            gender_badge = ''
            if gen == '여자':
                gender_badge = '<span class="badge bg-danger-subtle text-danger border border-danger-subtle me-1">👧 Girl Group</span>'
            elif gen == '남자':
                gender_badge = '<span class="badge bg-primary-subtle text-primary border border-primary-subtle me-1">👦 Boy Group</span>'
            type_badge = '<span class="badge bg-warning text-dark me-1">Debut</span>' if is_debut else '<span class="badge bg-secondary me-1">Comeback</span>'
            clean_title = get_artist_en_name(ev.get("title") or "", ev.get("slug"), en_map)
            d_fmt = "/".join((ev.get("date") or "").split("-")[1:])
            ev_id = esc(ev.get("id", ""))
            c_title_esc = esc(clean_title)

            summary.append(
                f'<div class="col-12 col-md-6 col-lg-4">'
                f'<div class="cal-summary-card p-2 border rounded bg-white shadow-sm d-flex align-items-center justify-content-between gap-2" onclick="openCalEventModal(\'{ev_id}\')" style="cursor:pointer;">'
                f'  <div class="d-flex align-items-center flex-wrap gap-1 text-truncate" style="min-width:0;">'
                f'    <span class="fw-bold text-dark me-1 flex-shrink-0">{d_fmt}</span>{gender_badge}{type_badge}<span class="fw-semibold text-truncate">{c_title_esc}</span>'
                f'  </div>'
                f'  <i class="bi bi-chevron-right text-muted small flex-shrink-0"></i>'
                f'</div></div>'
            )
        summary.append('</div>')
    summary.append('</div>')

    return "".join(grid) + "".join(summary)

def generate_en_comeback():
    cal_file = ROOT / "data" / "calendar.json"
    if not cal_file.exists():
        print("data/calendar.json missing")
        return
    cal_data = json.loads(cal_file.read_text(encoding="utf-8"))
    events = cal_data.get("events", [])
    gmap = load_gender_map()
    en_map = load_artist_en_map()

    today = datetime.date.today()
    year, month = today.year, today.month
    en_months = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    m_name = en_months[month]

    t = SHELL.read_text(encoding="utf-8")

    # 1. strip home specific blocks
    t = strip_once(t, r'<article id="seo-static-content".*?</article>', "home seo article")
    t = strip_once(t, r"<noscript>.*?</noscript>", "home noscript")
    t = strip_once(
        t,
        r'<!-- Schema\.org K-POP 아이돌 데이터베이스 \(AI 봇 인용 최적화\) -->\s*'
        r'<script type="application/ld\+json">.*?</script>',
        "home ItemList",
    )

    # 2. Page display: show #page-comeback, hide #page-home
    t = replace_once(t, '<section id="page-home" class="page-section">',
                     '<section id="page-home" class="page-section d-none">', "hide page-home")
    t = replace_once(t, '<section id="page-comeback" class="page-section d-none">',
                     '<section id="page-comeback" class="page-section">', "show page-comeback")

    # 3. html lang & meta (clean up existing canonical & alternates)
    t = replace_once(t, '<html lang="ko">', '<html lang="en">', "html lang")
    t = re.sub(r'<link rel="canonical"[^>]*>\s*', '', t)
    t = re.sub(r'<link rel="alternate"[^>]*>\s*', '', t)

    title = f"K-POP Comeback Schedule 2026 — {m_name} Idol Debuts & Releases | AIMCONTENTS"
    desc = f"Comprehensive 2026 K-POP idol comeback and debut schedule for {m_name}. Daily release dates, teasers, music video releases, and official profiles."

    t = re.sub(r'<title>.*?</title>', f'<title>{esc(title)}</title>', t, count=1)
    t = re.sub(r'<meta name="description"[^>]*>', f'<meta name="description" content="{esc(desc)}">', t, count=1)

    hreflang_tags = (
        f'<link rel="canonical" href="{URL_EN}">\n'
        f'    <link rel="alternate" hreflang="ko" href="{URL_KO}">\n'
        f'    <link rel="alternate" hreflang="en" href="{URL_EN}">\n'
        f'    <link rel="alternate" hreflang="x-default" href="{URL_KO}">'
    )
    collection, graph = build_events_jsonld_en(events, year, month, gmap, en_map)
    jsonld = "\n".join(
        f'    <script type="application/ld+json" data-static="comeback">\n'
        f"{json.dumps(b, ensure_ascii=False, indent=2)}\n    </script>"
        for b in (collection, graph)
    )
    t = replace_once(t, "</head>", f"{hreflang_tags}\n{jsonld}\n</head>", "head close")

    # OG / Twitter
    t = re.sub(r'<meta property="og:title"[^>]*>', f'<meta property="og:title" content="{esc(title)}">', t, count=1)
    t = re.sub(r'<meta property="og:description"[^>]*>', f'<meta property="og:description" content="{esc(desc)}">', t, count=1)
    t = re.sub(r'<meta property="og:url"[^>]*>', f'<meta property="og:url" content="{URL_EN}">', t, count=1)
    t = re.sub(r'<meta name="twitter:title"[^>]*>', f'<meta name="twitter:title" content="{esc(title)}">', t, count=1)
    t = re.sub(r'<meta name="twitter:description"[^>]*>', f'<meta name="twitter:description" content="{esc(desc)}">', t, count=1)
    t = re.sub(r'<meta name="twitter:url"[^>]*>', f'<meta name="twitter:url" content="{URL_EN}">', t, count=1)

    # 4. Nav replacements & active link
    t = replace_once(t, 'route(\'home\')">SNS랭킹</a>', 'route(\'home\')">SNS Ranking</a>', "nav ranking en")
    t = replace_once(t, '/monthly/2026-09/boys/">월간차트<', '/monthly/2026-09/boys/">Monthly Chart<', "nav monthly en")
    t = replace_once(t, 'route(\'namu\')">나무위키<', 'route(\'namu\')">Profiles<', "nav namu en")
    t = replace_once(t, 'class="nav-link" href="/comeback" onclick="event.preventDefault(); route(\'comeback\')">컴백일정</a>',
                     'class="nav-link active" href="/en/comeback" onclick="event.preventDefault(); route(\'comeback\')">Comebacks</a>', "nav comeback en active")
    t = replace_once(t, 'route(\'news\')">엔터뉴스</a>', 'route(\'news\')">News</a>', "nav news en")
    t = replace_once(t, 'route(\'douyin\')">중국트렌드</a>', 'route(\'douyin\')">China Trends</a>', "nav douyin en")
    t = replace_once(t, 'route(\'jobs\')">채용정보</a>', 'route(\'jobs\')">Jobs</a>', "nav jobs en")
    t = replace_once(t, 'route(\'links\')">링크모음</a>', 'route(\'links\')">Links</a>', "nav links en")
    t = replace_once(t, 'route(\'vendors\')">업체정보</a>', 'route(\'vendors\')">Vendors</a>', "nav vendors en")
    t = replace_once(t, 'href="/insight/index_insight.html">인사이트</a>', 'href="/insight/index_insight.html">Insights</a>', "nav insights en")

    # 5. Globe toggle to Korean version
    if 'href="https://aimcontents.com/en/"><i class="bi bi-globe"></i> English</a></li>' in t:
        t = replace_once(
            t,
            'href="https://aimcontents.com/en/"><i class="bi bi-globe"></i> English</a></li>',
            f'href="{URL_KO}"><i class="bi bi-globe"></i> 한국어</a></li>',
            "nav lang toggle replace"
        )
    else:
        pos_ins = t.find('href="/insight/index_insight.html">Insights</a>')
        pos_end_ul = t.find('</ul>', pos_ins) + 5
        nav_tail = t[pos_ins:pos_end_ul]
        lang_btn = (
            f'<li class="nav-item ms-lg-2 my-1 my-lg-0">'
            f'<a class="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" '
            f'href="{URL_KO}"><i class="bi bi-globe"></i> 한국어</a></li>'
            f'\n                </ul>'
        )
        t = replace_once(t, nav_tail, nav_tail[:-5] + lang_btn, "nav lang toggle en")

    # 6. Page Comeback Section UI Translations
    t = replace_once(t, '<h2 class="fw-bold fs-5 mb-0">K-POP 아이돌 컴백/데뷔 일정</h2>',
                     f'<h1 class="fw-bold fs-5 mb-0">K-POP Idol Comeback & Debut Schedule ({m_name} {year})</h1>', "comeback h1 en")
    t = replace_once(t, '<button class="btn btn-sm btn-outline-secondary" onclick="changeCalMonth(-1)"><i class="bi bi-chevron-left"></i> 이전달</button>',
                     '<button class="btn btn-sm btn-outline-secondary" onclick="changeCalMonth(-1)"><i class="bi bi-chevron-left"></i> Prev Month</button>', "cal prev en")
    t = replace_once(t, '<span id="calCurrentMonthLabel" class="fw-bold fs-6 px-2 text-dark">2026년 9월</span>',
                     f'<span id="calCurrentMonthLabel" class="fw-bold fs-6 px-2 text-dark">{m_name} {year}</span>', "cal month label en")
    t = replace_once(t, '<button class="btn btn-sm btn-outline-secondary" onclick="changeCalMonth(1)">다음달 <i class="bi bi-chevron-right"></i></button>',
                     '<button class="btn btn-sm btn-outline-secondary" onclick="changeCalMonth(1)">Next Month <i class="bi bi-chevron-right"></i></button>', "cal next en")
    t = replace_once(t, '<button class="btn btn-sm btn-outline-primary" onclick="setCalToday()">오늘</button>',
                     '<button class="btn btn-sm btn-outline-primary" onclick="setCalToday()">Today</button>', "cal today en")
    t = replace_once(t, 'placeholder="그룹명 또는 아티스트 검색 (예: 르세라핌, 원어스)"',
                     'placeholder="Search group or artist (e.g. LE SSERAFIM, ONEUS)..."', "cal search en")

    # 7. SSR Calendar Grid injection into #calendarContainer
    baked_cal_html = build_baked_calendar_en(events, year, month, gmap, en_map)
    placeholder = (
        '<div id="calendarContainer">\n'
        '                    <div class="text-center py-5 text-muted">\n'
        '                        <div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>\n'
        '                        일정을 불러오는 중입니다...\n'
        '                    </div>\n'
        '                </div>'
    )
    t = replace_once(t, placeholder, f'<div id="calendarContainer">{baked_cal_html}</div>', "calendarContainer inject")

    # 모바일 하단 네비게이션 active 탭을 comeback으로 전환
    t = replace_once(t, '<a href="/ranking" class="mobile-nav-item active" data-page="home"',
                     '<a href="/ranking" class="mobile-nav-item" data-page="home"', "mobile-nav home inactive")
    t = replace_once(t, '<a href="/comeback" class="mobile-nav-item" data-page="comeback"',
                     '<a href="/comeback" class="mobile-nav-item active" data-page="comeback"', "mobile-nav comeback active")

    out_dir = ROOT / "en" / "comeback"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "index.html"
    t = localize_shell_to_en(t, noscript_mode="strip")
    out_file.write_text(t, encoding="utf-8")
    print(f"✅ Generated EN comeback page: {out_file.relative_to(ROOT)} ({out_file.stat().st_size:,} bytes)")

def patch_ko_comeback_hreflang():
    ko_file = ROOT / "comeback" / "index.html"
    if not ko_file.exists():
        return
    text = ko_file.read_text(encoding="utf-8")
    changed = False
    if 'hreflang="en"' not in text:
        canonical_str = f'<link rel="canonical" href="{URL_KO}">'
        hreflang_tags = (
            f'<link rel="canonical" href="{URL_KO}">\n'
            f'    <link rel="alternate" hreflang="ko" href="{URL_KO}">\n'
            f'    <link rel="alternate" hreflang="en" href="{URL_EN}">\n'
            f'    <link rel="alternate" hreflang="x-default" href="{URL_KO}">'
        )
        if canonical_str in text:
            text = text.replace(canonical_str, hreflang_tags, 1)
            changed = True

    if 'bi-globe' not in text:
        pos_ins = text.find('href="/insight/index_insight.html">인사이트</a>')
        if pos_ins != -1:
            pos_end_ul = text.find('</ul>', pos_ins) + 5
            nav_tail = text[pos_ins:pos_end_ul]
            lang_btn_ko = (
                f'<li class="nav-item ms-lg-2 my-1 my-lg-0">'
                f'<a class="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" '
                f'href="{URL_EN}"><i class="bi bi-globe"></i> English</a></li>'
                f'\n                </ul>'
            )
            text = text.replace(nav_tail, nav_tail[:-5] + lang_btn_ko, 1)
            changed = True

    if changed:
        ko_file.write_text(text, encoding="utf-8")
        print("✅ Patched KO comeback with English toggle and hreflang")

if __name__ == "__main__":
    generate_en_comeback()
    patch_ko_comeback_hreflang()
