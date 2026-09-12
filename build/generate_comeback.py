# -*- coding: utf-8 -*-
"""
/comeback/ 정적 컴백/데뷔 캘린더 페이지 생성 스크립트.

- 봇/검색엔진(JS 미실행):
  1) #calendarContainer 에 현재 월 7열 캘린더 그리드 + 라인업 카드 목록 사전 렌더링 (SSR)
  2) Schema.org Event/MusicEvent 및 CollectionPage/ItemList JSON-LD (@graph) 주입
- 사람(브라우저):
  1) script.js가 /comeback 라우팅 시 해당 섹션 정상 표시
  2) calendar.js가 실행되면서 최신 이벤트 데이터 및 월 변경 인터랙션 hydrate
출력: comeback/index.html
"""
import calendar
import datetime
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHELL = ROOT / "index.html"
SITE = "https://aimcontents.com"
URL = f"{SITE}/comeback/"

FALLBACK_GENDER_MAP = {
    'verivery': '남자', '베리베리': '남자', 'big-ocean': '남자', '빅오션': '남자',
    'w3way': '남자', '위웨이': '남자', 'b1a4': '남자', '비원에이포': '남자',
    'exo': '남자', '엑소': '남자', 'nct wish': '남자', 'nctwish': '남자', '엔시티위시': '남자',
    'genus': '남자', '제너스': '남자', 'tnx': '남자', '티엔엑스': '남자',
    '미완소년': '남자', 'v01d': '남자', '보이드': '남자', 'b:dawn': '남자', 'bdawn': '남자', '비던': '남자',
    'btob': '남자', '비투비': '남자', 'bigbang': '남자', '빅뱅': '남자',
    '씨엔블루': '남자', 'cnblue': '남자', 'onewe': '남자', '원위': '남자', 'splayit': '남자', '에스플릿': '남자',
    'x-in': '여자', '엑신': '여자', 'hype princess': '여자', '하입프린세스': '여자',
    'xg': '여자', '엑스지': '여자', 'girlset': '여자', '걸셋': '여자',
    'i.o.i': '여자', '아이오아이': '여자', '에이핑크': '여자', 'apink': '여자',
    '제니': '여자', 'jennie': '여자', 'katseye': '여자', '캣츠아이': '여자',
    'queenz eye': '여자', '퀸즈아이': '여자'
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
                if g.get("name_en"):
                    gmap[g["name_en"].lower().replace(" ", "")] = gen
        except Exception as e:
            print(f"namu-index 로드 실패: {e}")
    return gmap


def get_event_gender(ev, gmap):
    slug = (ev.get("slug") or "").lower()
    if slug in FALLBACK_GENDER_MAP:
        return FALLBACK_GENDER_MAP[slug]
    if slug and slug in gmap:
        return gmap[slug]

    raw_title = re.sub(r"\(Comeback\)|\(Debut\)", "", ev.get("title") or "", flags=re.IGNORECASE).strip()
    clean_full = raw_title.lower().replace(" ", "")
    if clean_full in FALLBACK_GENDER_MAP:
        return FALLBACK_GENDER_MAP[clean_full]
    if clean_full in gmap:
        return gmap[clean_full]

    tokens = [t for t in re.split(r"[\(\)\/\s]+", raw_title.lower()) if len(t) >= 2]
    for token in tokens:
        if token in FALLBACK_GENDER_MAP:
            return FALLBACK_GENDER_MAP[token]
        if token in gmap:
            return gmap[token]
    return ""


def build_events_jsonld(events, year, month, gmap):
    items = []
    for ev in events:
        d_str = ev.get("date") or ""
        clean_title = re.sub(r"\(Comeback\)|\(Debut\)", "", ev.get("title") or "", flags=re.IGNORECASE).strip()
        is_debut = "데뷔" in (ev.get("title") or "") or "Debut" in (ev.get("title") or "")
        event_name = f"{clean_title} {'데뷔' if is_debut else '컴백'}"
        slug = ev.get("slug")
        profile_url = f"{SITE}/namu/{slug}/" if slug else URL

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
            "description": ev.get("description") or f"K-POP {clean_title}의 {d_str} 공식 컴백/데뷔 일정 및 상세 프로필 정보",
            "url": URL
        }
        items.append(event_obj)

    collection = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": f"K-POP 아이돌 컴백/데뷔 일정 ({year}년 {month}월) | 아이엠콘텐츠",
        "url": URL,
        "description": f"{year}년 {month}월 K-POP 아이돌 컴백 및 데뷔 캘린더 라인업. 날짜별 일정, 보도자료, 멤버 프로필 제공.",
        "publisher": {
            "@type": "Organization",
            "name": "아이엠콘텐츠",
            "url": SITE
        }
    }

    graph = {
        "@context": "https://schema.org",
        "@graph": items
    }
    return collection, graph


def build_baked_calendar(events, year, month, gmap):
    month_str = f"{year}-{month:02d}"
    first_weekday, num_days = calendar.monthrange(year, month)
    first_day_index = (first_weekday + 1) % 7

    filtered = [ev for ev in events if (ev.get("date") or "").startswith(month_str)]

    weekdays = ['일', '월', '화', '수', '목', '금', '토']
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
            clean_title = re.sub(r"\(Comeback\)|\(Debut\)", "", ev.get("title") or "", flags=re.IGNORECASE).strip()
            debut_tag = '<span class="cal-debut-tag">데뷔</span>' if is_debut else ''
            ev_id = esc(ev.get("id", ""))
            c_title_esc = esc(clean_title)

            grid.append(
                f'<div class="cal-event-badge {badge_cls}" onclick="openCalEventModal(\'{ev_id}\')" title="{c_title_esc}{" (데뷔)" if is_debut else ""}">'
                f'<span class="cal-event-dot"></span><span class="cal-event-text">{c_title_esc}</span>{debut_tag}'
                f'</div>'
            )
        grid.append('</div></div>')

    grid.append('</div></div></div>')

    # 하단 라인업 피드
    summary = [f'<div class="mt-4"><h3 class="fs-6 fw-bold mb-3">{year}년 {month}월 컴백/데뷔 라인업 ({len(filtered)}팀)</h3>']
    if not filtered:
        summary.append('<div class="text-center py-4 text-muted">해당 조건의 컴백/데뷔 일정이 없습니다.</div>')
    else:
        summary.append('<div class="row g-2">')
        for ev in filtered:
            is_debut = "데뷔" in (ev.get("title") or "") or "Debut" in (ev.get("title") or "")
            gen = get_event_gender(ev, gmap)
            gender_badge = ''
            if gen == '여자':
                gender_badge = '<span class="badge bg-danger-subtle text-danger border border-danger-subtle me-1">👧 걸그룹</span>'
            elif gen == '남자':
                gender_badge = '<span class="badge bg-primary-subtle text-primary border border-primary-subtle me-1">👦 보이그룹</span>'
            type_badge = '<span class="badge bg-warning text-dark me-1">데뷔</span>' if is_debut else '<span class="badge bg-secondary me-1">컴백</span>'
            clean_title = re.sub(r"\(Comeback\)|\(Debut\)", "", ev.get("title") or "", flags=re.IGNORECASE).strip()
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


def main():
    cal_file = ROOT / "data" / "calendar.json"
    if not cal_file.exists():
        print("data/calendar.json 파일이 없습니다.")
        return
    cal_data = json.loads(cal_file.read_text(encoding="utf-8"))
    events = cal_data.get("events", [])

    gmap = load_gender_map()

    today = datetime.date.today()
    year = today.year
    month = today.month

    m_str = f"{year}-{month:02d}"
    this_month_events = [e for e in events if (e.get("date") or "").startswith(m_str)]

    title = f"K-POP 아이돌 컴백/데뷔 일정 ({year}년 {month}월) | 아이엠콘텐츠"
    desc = (
        f"{year}년 {month}월 K-POP 아이돌 컴백 및 데뷔 캘린더 총정리 ({len(this_month_events)}팀). "
        f"르세라핌, 몬스타엑스, 지수, 원어스 등 일자별 컴백 일정, 보도자료 기사, 나무위키 상세 프로필을 실시간 확인하세요."
    )

    collection, graph = build_events_jsonld(this_month_events, year, month, gmap)
    jsonld = "\n".join(
        f'    <script type="application/ld+json" data-static="comeback">\n'
        f"{json.dumps(b, ensure_ascii=False, indent=2)}\n    </script>"
        for b in (collection, graph)
    )

    t = SHELL.read_text(encoding="utf-8")

    # 홈 전용 블록 제거
    t = strip_once(t, r'<article id="seo-static-content".*?</article>', "home seo article")
    t = strip_once(t, r"<noscript>.*?</noscript>", "home noscript")
    t = strip_once(
        t,
        r'<!-- Schema\.org K-POP 아이돌 데이터베이스 \(AI 봇 인용 최적화\) -->\s*'
        r'<script type="application/ld\+json">.*?</script>',
        "home ItemList",
    )

    # Head 메타 교체
    t = replace_once(
        t,
        "<title>아이돌 SNS 팔로워 순위 - 틱톡·유튜브·인스타·웨이보·도우인 | 아이엠콘텐츠</title>",
        f"<title>{esc(title)}</title>", "title")
    t = replace_once(
        t,
        ('content="K-POP 아이돌 틱톡(TikTok)·유튜브·인스타그램·웨이보·빌리빌리·도우인 SNS 순위 및 팔로워 랭킹. '
         '188개 아이돌 그룹의 숏폼 참여율(ER), 컴백 일정, 나무위키 정보를 매주/매월 업데이트합니다.">'),
        f'content="{esc(desc)}">', "meta description")
    t = replace_once(t, '<link rel="canonical" href="https://aimcontents.com/">',
                     f'<link rel="canonical" href="{URL}">', "canonical")
    t = replace_once(t, '<meta property="og:url" content="https://aimcontents.com/">',
                     f'<meta property="og:url" content="{URL}">', "og:url")
    t = replace_once(t, '<meta name="twitter:url" content="https://aimcontents.com/">',
                     f'<meta name="twitter:url" content="{URL}">', "twitter:url")
    t = replace_once(t, '<meta property="og:title" content="K-POP 아이돌 SNS·틱톡·유튜브 팔로워 순위 | 아이엠콘텐츠">',
                     f'<meta property="og:title" content="{esc(title)}">', "og:title")
    t = replace_once(t, '<meta name="twitter:title" content="K-POP 아이돌 SNS·틱톡·유튜브 팔로워 순위 | 아이엠콘텐츠">',
                     f'<meta name="twitter:title" content="{esc(title)}">', "twitter:title")
    t = replace_once(
        t,
        '<meta property="og:description" content="K-POP 아이돌 틱톡(TikTok), 유튜브, 인스타그램, 웨이보, 도우인 SNS 팔로워 순위와 컴백 일정, 188개 그룹 상세 정보.">',
        f'<meta property="og:description" content="{esc(desc)}">', "og:description")
    t = replace_once(
        t,
        '<meta name="twitter:description" content="K-POP 아이돌 틱톡(TikTok), 유튜브, 인스타그램, 웨이보, 도우인 SNS 팔로워 순위와 컴백 일정, 188개 그룹 상세 정보.">',
        f'<meta name="twitter:description" content="{esc(desc)}">', "twitter:description")

    # JSON-LD 주입
    t = replace_once(t, "</head>", jsonld + "\n</head>", "</head>")

    # 섹션 활성화: page-home 숨김, page-comeback 표시
    t = replace_once(t, '<section id="page-home" class="page-section">',
                     '<section id="page-home" class="page-section d-none">', "page-home hide")
    t = replace_once(t, '<section id="page-comeback" class="page-section d-none">',
                     '<section id="page-comeback" class="page-section">', "page-comeback show")

    # H1 / H2 구조화 (SEO)
    t = replace_once(t, '<h1 class="mb-3 fw-bold fs-5">K-POP 아이돌 SNS 팔로워 순위</h1>',
                     '<h2 class="mb-3 fw-bold fs-5">K-POP 아이돌 SNS 팔로워 순위</h2>', "home h1 demote")
    t = replace_once(t, '<h2 class="fw-bold fs-5 mb-0">K-POP 아이돌 컴백/데뷔 일정</h2>',
                     f'<h1 class="fw-bold fs-5 mb-0">K-POP 아이돌 컴백/데뷔 일정 ({year}년 {month}월)</h1>',
                     "comeback h1 promote")

    # SSR 그리드 및 라인업 피드 주입
    baked_html = build_baked_calendar(events, year, month, gmap)
    placeholder = (
        '<div id="calendarContainer">\n'
        '                    <div class="text-center py-5 text-muted">\n'
        '                        <div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>\n'
        '                        일정을 불러오는 중입니다...\n'
        '                    </div>\n'
        '                </div>'
    )
    t = replace_once(t, placeholder, f'<div id="calendarContainer">{baked_html}</div>', "calendarContainer inject")

    # 모바일 하단 네비게이션 active 탭을 comeback으로 전환
    t = replace_once(t, '<a href="/ranking" class="mobile-nav-item active" data-page="home"',
                     '<a href="/ranking" class="mobile-nav-item" data-page="home"', "mobile-nav home inactive")
    t = replace_once(t, '<a href="/comeback" class="mobile-nav-item" data-page="comeback"',
                     '<a href="/comeback" class="mobile-nav-item active" data-page="comeback"', "mobile-nav comeback active")

    out = ROOT / "comeback" / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(t, encoding="utf-8")
    print(f"comeback 정적 페이지 생성 완료: {out.relative_to(ROOT)} ({len(t):,} bytes, 이번 달 {len(this_month_events)}팀)")


if __name__ == "__main__":
    main()
