# -*- coding: utf-8 -*-
"""
/ranking/ 정적 랜딩 페이지 생성 스크립트
- 봇: 최신 플랫폼별 1위 요약 표 + 주요 플랫폼 바로가기 + FAQ + ItemList/Dataset JSON-LD
- 사람: script.js가 /ranking 라우팅해 최신 랭킹 SPA hydrate
출력: ranking/index.html
"""
import json
import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHELL = ROOT / "index.html"
SITE = "https://aimcontents.com"
URL = f"{SITE}/ranking/"

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

def build_jsonld():
    platforms = [
        {"name": "틱톡 (TikTok)", "url": f"{SITE}/ranking"},
        {"name": "유튜브 (YouTube)", "url": f"{SITE}/ranking/2026-08/youtube-girls/"},
        {"name": "인스타그램 (Instagram)", "url": f"{SITE}/ranking/2026-08/instagram-girls/"},
        {"name": "웨이보 (Weibo)", "url": f"{SITE}/ranking/2026-08/weibo-boys/"},
        {"name": "스포티파이 (Spotify)", "url": f"{SITE}/ranking/2026-08/spotify-boys/"},
        {"name": "빌리빌리 (Bilibili)", "url": f"{SITE}/ranking/2026-08/bilibili-boys/"},
        {"name": "도우인 (Douyin)", "url": f"{SITE}/douyin/"}
    ]
    items = [{
        "@type": "ListItem",
        "position": i + 1,
        "name": p["name"],
        "item": {
            "@type": "WebPage",
            "name": f"K-POP 아이돌 {p['name']} 순위",
            "url": p["url"]
        }
    } for i, p in enumerate(platforms)]

    item_list = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": "K-POP 아이돌 주요 SNS 플랫폼별 순위",
        "description": "틱톡, 유튜브, 인스타그램, 웨이보, 스포티파이 등 주요 플랫폼의 K-POP 아이돌 팔로워 순위 모음.",
        "url": URL,
        "numberOfItems": len(items),
        "itemListElement": items
    }
    dataset = {
        "@context": "https://schema.org",
        "@type": "Dataset",
        "name": "K-POP 아이돌 SNS 팔로워 & 틱톡 순위 데이터",
        "description": "K-POP 아이돌의 틱톡, 유튜브, 인스타그램, 웨이보, 빌리빌리 등 주요 SNS 플랫폼 팔로워 및 참여율 데이터.",
        "url": URL,
        "creator": {"@type": "Organization", "name": "아이엠콘텐츠"},
        "temporalCoverage": "2024-03/..",
        "keywords": ["K-POP", "아이돌", "SNS 순위", "틱톡 순위", "유튜브 순위", "인스타그램 팔로워", "웨이보 순위"]
    }
    breadcrumb = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "홈", "item": SITE},
            {"@type": "ListItem", "position": 2, "name": "SNS 랭킹", "item": URL}
        ]
    }
    return "\n".join(
        f'    <script type="application/ld+json" data-static="ranking-hub">\n'
        f'{json.dumps(b, ensure_ascii=False, indent=2)}\n    </script>'
        for b in (item_list, dataset, breadcrumb)
    )

def build_baked_content():
    return """
    <div class="col-12">
        <section class="mb-4">
            <h2 class="fs-5 fw-bold mb-3">🔥 주요 SNS 플랫폼별 순위 바로가기</h2>
            <div class="row g-2 mb-4">
                <div class="col-6 col-md-3">
                    <a href="/ranking/2026-08/youtube-girls/" class="btn btn-outline-danger w-100 py-2 text-start">
                        <strong>유튜브 (여자)</strong><br><small class="text-muted">1위 블랙핑크 (1.01억)</small>
                    </a>
                </div>
                <div class="col-6 col-md-3">
                    <a href="/ranking/2026-08/youtube-boys/" class="btn btn-outline-danger w-100 py-2 text-start">
                        <strong>유튜브 (남자)</strong><br><small class="text-muted">1위 BTS (7,850만)</small>
                    </a>
                </div>
                <div class="col-6 col-md-3">
                    <a href="/ranking/2026-08/weibo-boys/" class="btn btn-outline-warning w-100 py-2 text-start">
                        <strong>웨이보 (남자)</strong><br><small class="text-muted">1위 BTS (567만)</small>
                    </a>
                </div>
                <div class="col-6 col-md-3">
                    <a href="/ranking/2026-08/weibo-girls/" class="btn btn-outline-warning w-100 py-2 text-start">
                        <strong>웨이보 (여자)</strong><br><small class="text-muted">1위 블랙핑크 (782만)</small>
                    </a>
                </div>
                <div class="col-6 col-md-3">
                    <a href="/ranking/2026-08/spotify-boys/" class="btn btn-outline-success w-100 py-2 text-start">
                        <strong>스포티파이 (남자)</strong><br><small class="text-muted">1위 BTS (7,750만)</small>
                    </a>
                </div>
                <div class="col-6 col-md-3">
                    <a href="/ranking/2026-08/spotify-girls/" class="btn btn-outline-success w-100 py-2 text-start">
                        <strong>스포티파이 (여자)</strong><br><small class="text-muted">1위 블랙핑크 (4,990만)</small>
                    </a>
                </div>
                <div class="col-6 col-md-3">
                    <a href="/douyin" class="btn btn-outline-dark w-100 py-2 text-start">
                        <strong>중국 도우인 챌린지</strong><br><small class="text-muted">주간 화제 숏폼 순위</small>
                    </a>
                </div>
                <div class="col-6 col-md-3">
                    <a href="/namu" class="btn btn-outline-primary w-100 py-2 text-start">
                        <strong>나무위키 DB</strong><br><small class="text-muted">188개 그룹 상세 정보</small>
                    </a>
                </div>
            </div>
        </section>

        <section class="mb-4">
            <h2 class="fs-5 fw-bold mb-2">자주 묻는 질문 (FAQ)</h2>
            <dl>
                <dt class="fw-bold mt-2">아이돌 SNS 팔로워 순위는 얼마나 자주 갱신되나요?</dt>
                <dd>웨이보, 빌리빌리, 유튜브, 스포티파이, 인스타그램, QQ뮤직 등 주요 SNS는 매월 말일 기준으로 월 1회 정기 집계되며, 틱톡(TikTok) 및 중국 도우인(抖音) 챌린지는 주간 단위로 수집·분석됩니다.</dd>
                <dt class="fw-bold mt-2">틱톡(TikTok) 순위와 참여율(ER)은 무엇인가요?</dt>
                <dd>틱톡 랭킹은 191개 K-POP 아이돌 공식 계정의 팔로워 수뿐만 아니라, 최근 30일간 업로드된 영상들의 평균 조회수, 좋아요 수, 댓글/공유/저장 비율을 종합한 참여율(Engagement Rate)을 함께 산출하여 실제 바이럴 영향력을 측정합니다.</dd>
            </dl>
            <p class="text-muted small">출처: 아이엠콘텐츠(aimcontents.com) · 매월 및 매주 집계</p>
        </section>
    </div>
    """

def main():
    title = "K-POP 아이돌 SNS 팔로워 순위 - 틱톡·유튜브·인스타·웨이보·빌리빌리 | 아이엠콘텐츠"
    desc = "월별·주간 K-POP 아이돌 SNS 팔로워 및 틱톡 순위. 유튜브 구독자, 인스타그램, 웨이보, 빌리빌리, 도우인 등 8대 플랫폼의 최신 랭킹과 188개 그룹 데이터를 제공합니다."

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
    jsonld = build_jsonld()
    t = replace_once(t, "</head>", jsonld + "\n</head>", "</head>")

    # baked 콘텐츠: #result-area 에 주입
    baked_html = build_baked_content()
    t = replace_once(
        t,
        '<div id="result-area" class="row g-3">',
        f'<div id="result-area" class="row g-3">{baked_html}',
        "result-area inject"
    )

    out_dir = ROOT / "ranking"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "index.html"
    out_file.write_text(t, encoding="utf-8")
    print(f"생성 완료: {out_file.relative_to(ROOT)} ({out_file.stat().st_size:,} bytes)")

if __name__ == "__main__":
    main()
