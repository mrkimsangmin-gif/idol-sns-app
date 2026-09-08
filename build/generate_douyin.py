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
        
        cards.append(f"""
        <div class="col-12 col-md-6 col-lg-4">
            <div class="card h-100 shadow-sm border-0">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <span class="badge bg-danger fs-6">#{rank}</span>
                        <span class="text-muted small">참여자: <strong>{parts_raw}</strong></span>
                    </div>
                    <h5 class="card-title fw-bold mb-1">{title_ko}</h5>
                    <p class="text-muted small mb-2">{title_zh}</p>
                    <p class="card-text small text-secondary mb-3">{summary}</p>
                    <div class="d-flex justify-content-between align-items-center mt-auto">
                        <span class="badge bg-light text-dark">{trend}</span>
                        {f'<a href="{esc(ch_url)}" target="_blank" rel="noopener" class="btn btn-outline-danger btn-sm">도우인 보기</a>' if ch_url else ''}
                    </div>
                </div>
            </div>
        </div>
        """)
    
    return f"""
    <div class="col-12 mb-3">
        <div class="alert alert-light border">
            <strong>중국 도우인(抖音) 주간 트렌드 분석</strong> — 중국 본토에서 가장 바이럴되고 있는 K-POP 및 숏폼 챌린지 순위입니다. (집계일: {updated_at[:10]})
        </div>
    </div>
    {"".join(cards)}
    """

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
    # baked cards 주입 및 로딩 스피너 숨김
    baked_html = build_baked_content(challenges, updated_at)
    t = replace_once(
        t,
        '<div id="douyinLoading" class="text-center py-5">',
        '<div id="douyinLoading" class="text-center py-5 d-none">',
        "hide douyinLoading"
    )
    t = replace_once(
        t,
        '<div id="douyinContainer" class="row g-3" style="display: none;"></div>',
        f'<div id="douyinContainer" class="row g-3" style="display: flex;">{baked_html}</div>',
        "inject douyinContainer"
    )
    
    out_dir = ROOT / "douyin"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "index.html"
    out_file.write_text(t, encoding="utf-8")
    print(f"생성 완료: {out_file.relative_to(ROOT)} ({out_file.stat().st_size:,} bytes)")

if __name__ == "__main__":
    main()
