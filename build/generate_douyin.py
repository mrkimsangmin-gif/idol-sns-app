# -*- coding: utf-8 -*-
"""
/douyin/ 정적 랜딩 페이지 생성 스크립트
- 봇: baked 도우인 인기 챌린지 목록 + ItemList/BreadcrumbList JSON-LD
- 사람: script.js가 /douyin 라우팅해 SPA hydrate
데이터: data/douyin-challenges.json
출력: douyin/index.html
"""
import json
import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHELL = ROOT / "index.html"
SITE = "https://aimcontents.com"
URL = f"{SITE}/douyin/"

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

def build_jsonld(challenges):
    items = []
    for c in challenges[:20]:
        items.append({
            "@type": "ListItem",
            "position": c.get("rank", 1),
            "name": f"{c.get('title_ko', '')} ({c.get('title_zh', '')})",
            "item": {
                "@type": "CreativeWork",
                "name": c.get("title_ko") or c.get("title_zh"),
                "headline": c.get("title_zh"),
                "description": c.get("summary_ko", ""),
                "interactionStatistic": {
                    "@type": "InteractionCounter",
                    "interactionType": "https://schema.org/InteractAction",
                    "userInteractionCount": c.get("participants", 0)
                }
            }
        })
    item_list = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": "중국 도우인(抖音) K-POP 인기 챌린지 순위",
        "description": "중국 숏폼 플랫폼 도우인(抖音)의 K-POP 화제 챌린지 및 바이럴 숏폼 트렌드 순위.",
        "url": URL,
        "numberOfItems": len(items),
        "itemListElement": items
    }
    breadcrumb = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "홈", "item": SITE},
            {"@type": "ListItem", "position": 2, "name": "중국 트렌드 (도우인)", "item": URL}
        ]
    }
    return "\n".join(
        f'    <script type="application/ld+json" data-static="douyin">\n'
        f'{json.dumps(b, ensure_ascii=False, indent=2)}\n    </script>'
        for b in (item_list, breadcrumb)
    )

def build_baked_content(challenges, updated_at):
    cards = []
    for c in challenges:
        rank = c.get("rank", 1)
        title_ko = esc(c.get("title_ko", ""))
        title_zh = esc(c.get("title_zh", ""))
        parts_raw = esc(c.get("participants_raw", f"{c.get('participants', 0):,}"))
        summary = esc(c.get("summary_ko", ""))
        trend = esc(c.get("trend_reason", ""))
        ch_url = c.get("challenge_url", "")
        
        cover_url = c.get("cover_url", "")
        video_url = c.get("video_url", "")
        
        main_click_url = video_url or ch_url

        thumb_html = ""
        if cover_url:
            thumb_html = f"""
            <div class="position-relative overflow-hidden rounded-top" style="height: 220px; background: #000;">
                <img src="/{esc(cover_url)}" class="w-100 h-100 object-fit-cover transition-scale" alt="{title_ko}" loading="lazy">
                <span class="position-absolute top-0 start-0 m-2 badge bg-danger fs-6 shadow-sm">#{rank}</span>
                <span class="position-absolute bottom-0 end-0 m-2 badge bg-dark bg-opacity-75 text-white small">참여 {parts_raw}</span>
            </div>
            """
        else:
            thumb_html = f"""
            <div class="d-flex justify-content-between align-items-center p-3 pb-0">
                <span class="badge bg-danger fs-6">#{rank}</span>
                <span class="text-muted small">참여자: <strong>{parts_raw}</strong></span>
            </div>
            """

        title_html = f'<h5 class="card-title fw-bold mb-1">{title_ko}</h5>'

        action_btns = []
        if video_url:
            action_btns.append(f'<a href="{esc(video_url)}" target="_blank" rel="noopener" class="btn btn-danger btn-sm">▶ 영상 재생</a>')
        if ch_url:
            action_btns.append(f'<a href="{esc(ch_url)}" target="_blank" rel="noopener" class="btn btn-outline-secondary btn-sm">검색 보기</a>')
        action_html = " ".join(action_btns)

        # 카드 전체 클릭 링크 지원:
        # action_btns의 <a> 태그와 중첩(nested <a>)되면 브라우저 파서가 태그를 강제로 분리하여 상단에 빈 블록(공백)이 생기므로,
        # onclick 이벤트를 통해 카드 클릭 시 이동하도록 처리
        click_attr = f' onclick="window.open(\'{esc(main_click_url)}\', \'_blank\');"' if main_click_url else ''

        card_content = f"""
            <div class="card h-100 shadow-sm border-0 overflow-hidden position-relative hover-shadow transition-all" style="cursor: pointer;"{click_attr}>
                {thumb_html}
                <div class="card-body d-flex flex-column">
                    {title_html}
                    <p class="text-muted small mb-2">{title_zh}</p>
                    <p class="card-text small text-secondary mb-3">{summary}</p>
                    <div class="d-flex justify-content-between align-items-center mt-auto pt-2 border-top">
                        <span class="badge bg-light text-dark">{trend}</span>
                        <div class="position-relative" style="z-index: 2;" onclick="event.stopPropagation();">{action_html}</div>
                    </div>
                </div>
            </div>
        """

        cards.append(f"""
        <div class="col-12 col-md-6 col-lg-4">
            {card_content}
        </div>
        """)
    
    return "".join(cards)

def main():
    data_file = ROOT / "data" / "douyin-challenges.json"
    if not data_file.exists():
        print("data/douyin-challenges.json 파일이 없습니다.")
        return
    douyin_json = json.loads(data_file.read_text(encoding="utf-8"))
    challenges = douyin_json.get("challenges", [])
    updated_at = douyin_json.get("crawled_at", "") or douyin_json.get("updated_at", "")
    
    title = "중국 도우인(抖音) K-POP 인기 챌린지 순위 - 숏폼 트렌드 | 아이엠콘텐츠"
    desc = "중국 도우인(抖音)에서 화제가 된 K-POP 챌린지 및 숏폼 영상 실시간 순위. 참여자 수, 인기 음원, 주간 트렌드를 매주 업데이트합니다."
    
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
    jsonld = build_jsonld(challenges)
    t = replace_once(t, "</head>", jsonld + "\n</head>", "</head>")
    
    # 본문: #page-home 감추고 #page-douyin 표시
    t = replace_once(
        t,
        '<section id="page-home" class="page-section">',
        '<section id="page-home" class="page-section d-none">',
        "hide page-home"
    )
    t = replace_once(
        t,
        '<section id="page-douyin" class="page-section d-none">',
        '<section id="page-douyin" class="page-section">',
        "show page-douyin"
    )
    # H1 계층 구조 조정
    t = replace_once(
        t,
        '<h1 class="mb-3 fw-bold fs-5">K-POP 아이돌 SNS 팔로워 순위</h1>',
        '<h2 class="mb-3 fw-bold fs-5">K-POP 아이돌 SNS 팔로워 순위</h2>',
        "home h1 demote"
    )
    t = replace_once(
        t,
        '<h2 class="mb-3 fw-bold fs-5">중국 도우인 인기 챌린지 <span id="douyinWeekBadge" class="douyin-week-badge"></span></h2>',
        '<h1 class="mb-3 fw-bold fs-5">중국 도우인 인기 챌린지 <span id="douyinWeekBadge" class="douyin-week-badge"></span></h1>',
        "douyin h1 promote"
    )
    # 네비게이션 active 전환
    t = replace_once(
        t,
        '<a class="nav-link active" href="/ranking"',
        '<a class="nav-link" href="/ranking"',
        "nav ranking inactive"
    )
    t = replace_once(
        t,
        '<a class="nav-link" href="/douyin"',
        '<a class="nav-link active" href="/douyin"',
        "nav douyin active"
    )
    # alert 상단 안내문 및 baked cards 주입, 로딩 스피너 숨김
    baked_html = build_baked_content(challenges, updated_at)
    alert_box = (
        f'<div class="alert alert-light border mb-3">\n'
        f'    <strong>중국 도우인(抖音) 주간 트렌드 분석</strong> — 중국 본토에서 가장 바이럴되고 있는 챌린지 순위입니다. (집계일: {updated_at[:10]})\n'
        f'</div>'
    )
    t = replace_once(
        t,
        '<div id="douyinLoading" class="text-center py-5">',
        '<div id="douyinLoading" class="text-center py-5 d-none">',
        "hide douyinLoading"
    )
    # douyinUpdateTime 제거(불필요한 빈 높이 방지)
    t = replace_once(
        t,
        '<div id="douyinUpdateTime" class="text-muted small mb-3"></div>',
        alert_box,
        "replace douyinUpdateTime with alert_box"
    )
    t = replace_once(
        t,
        '<div id="douyinContainer" class="row g-3" style="display: none;"></div>',
        f'<div id="douyinContainer" class="row g-3">{baked_html}</div>',
        "inject douyinContainer"
    )
    # script.js가 home 페이지로 리셋하지 않도록 제거 (순수 정적 랜딩 페이지 유지)
    t = replace_once(
        t,
        '<script src="/script.js?v=20260321"></script>',
        '',
        "remove script.js for static douyin landing"
    )
    
    out_dir = ROOT / "douyin"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "index.html"
    out_file.write_text(t, encoding="utf-8")
    print(f"생성 완료: {out_file.relative_to(ROOT)} ({out_file.stat().st_size:,} bytes)")

if __name__ == "__main__":
    main()
