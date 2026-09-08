# -*- coding: utf-8 -*-
"""
/namu/ 정적 허브 페이지 생성 스크립트
- 봇: 190개 K-POP 아이돌 그룹 전체 목록 링크 표 + CollectionPage/ItemList JSON-LD
- 사람: script.js가 /namu 라우팅해 나무위키 스마트 검색 SPA hydrate
출력: namu/index.html
"""
import json
import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHELL = ROOT / "index.html"
SITE = "https://aimcontents.com"
URL = f"{SITE}/namu/"

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

def build_jsonld(groups):
    items = []
    for i, g in enumerate(groups, 1):
        slug = g.get("slug", "")
        items.append({
            "@type": "ListItem",
            "position": i,
            "name": f"{g.get('name', '')} ({g.get('name_en', '')})",
            "item": {
                "@type": "MusicGroup",
                "name": g.get("name", ""),
                "alternateName": g.get("name_en", ""),
                "url": f"{SITE}/namu/{slug}/"
            }
        })
    collection = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": "K-POP 아이돌 나무위키 데이터베이스 (190개 그룹)",
        "description": "1세대부터 5세대까지 K-POP 아이돌 그룹의 소속사, 데뷔일, 팬덤명, 멤버 프로필, 앨범 판매량 데이터베이스.",
        "url": URL,
        "numberOfItems": len(items),
        "mainEntity": {
            "@type": "ItemList",
            "itemListElement": items
        }
    }
    breadcrumb = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "홈", "item": SITE},
            {"@type": "ListItem", "position": 2, "name": "나무위키 DB", "item": URL}
        ]
    }
    return "\n".join(
        f'    <script type="application/ld+json" data-static="namu-hub">\n'
        f'{json.dumps(b, ensure_ascii=False, indent=2)}\n    </script>'
        for b in (collection, breadcrumb)
    )

def build_baked_content(groups):
    boys = [g for g in groups if g.get("gender") == "남자"]
    girls = [g for g in groups if g.get("gender") == "여자"]
    others = [g for g in groups if g.get("gender") not in ("남자", "여자")]

    def render_table(grp_list, title):
        rows = []
        for g in grp_list:
            name = esc(g.get("name", ""))
            name_en = esc(g.get("name_en", ""))
            slug = g.get("slug", "")
            agency = esc(g.get("agency", "-"))
            debut = esc(g.get("debut_date", "-"))
            gen = esc(g.get("generation", "-"))
            link = f'<a href="/namu/{slug}/" class="fw-bold text-decoration-none">{name} ({name_en})</a>' if slug else f"{name} ({name_en})"
            rows.append(
                f"<tr>"
                f"<td>{link}</td>"
                f"<td>{agency}</td>"
                f"<td>{debut}</td>"
                f"<td>{gen}</td>"
                f"</tr>"
            )
        return f"""
        <div class="mb-4">
            <h3 class="fs-6 fw-bold text-primary mb-2">{title} ({len(grp_list)}팀)</h3>
            <div class="table-responsive">
                <table class="table table-sm table-hover align-middle">
                    <thead class="table-light">
                        <tr><th>그룹명</th><th>소속사</th><th>데뷔일</th><th>세대</th></tr>
                    </thead>
                    <tbody>{"".join(rows)}</tbody>
                </table>
            </div>
        </div>
        """

    return f"""
    <div class="col-12 mt-3">
        <div class="alert alert-light border mb-4">
            <strong>K-POP 아이돌 데이터베이스 아카이브</strong> — 총 {len(groups)}개 그룹의 나무위키 요약 정보, 멤버 프로필, 앨범 판매량 및 공식 SNS 링크를 제공합니다.
        </div>
        {render_table(girls, "👧 걸그룹")}
        {render_table(boys, "👦 보이그룹")}
        {render_table(others, "혼성/기타 그룹") if others else ""}
    </div>
    """

def main():
    data_file = ROOT / "data" / "namu-index.json"
    if not data_file.exists():
        print("data/namu-index.json 파일이 없습니다.")
        return
    namu_json = json.loads(data_file.read_text(encoding="utf-8"))
    groups = namu_json.get("groups", [])
    
    title = f"K-POP 아이돌 나무위키 데이터베이스 ({len(groups)}개 그룹) | 아이엠콘텐츠"
    desc = f"1세대부터 5세대까지 {len(groups)}개 K-POP 아이돌 그룹의 소속사, 데뷔일, 멤버 프로필, 앨범 초동 판매량, SNS 링크 나무위키 총정리."

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
    jsonld = build_jsonld(groups)
    t = replace_once(t, "</head>", jsonld + "\n</head>", "</head>")

    # 본문: #page-home 감추고 #page-namu 표시
    t = replace_once(
        t,
        '<section id="page-home" class="page-section">',
        '<section id="page-home" class="page-section d-none">',
        "hide page-home"
    )
    t = replace_once(
        t,
        '<section id="page-namu" class="page-section d-none">',
        '<section id="page-namu" class="page-section">',
        "show page-namu"
    )

    # baked 그룹 테이블 주입: namuSearchView 영역
    baked_html = build_baked_content(groups)
    t = replace_once(
        t,
        '<div id="namuSearchView"></div>',
        f'<div id="namuSearchView">{baked_html}</div>',
        "inject namuSearchView"
    )

    # 모바일 하단 네비게이션 active 제거 (목록 페이지에서는 탭 미선택)
    t = replace_once(t, '<a href="/ranking" class="mobile-nav-item active" data-page="home"',
                     '<a href="/ranking" class="mobile-nav-item" data-page="home"', "mobile-nav home inactive")

    out_dir = ROOT / "namu"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "index.html"
    out_file.write_text(t, encoding="utf-8")
    print(f"생성 완료: {out_file.relative_to(ROOT)} ({out_file.stat().st_size:,} bytes)")

if __name__ == "__main__":
    main()
