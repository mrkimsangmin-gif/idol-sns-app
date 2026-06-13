# -*- coding: utf-8 -*-
"""
정적 페이지 생성 파이프라인 — Phase 0 (그룹 엔티티 페이지)

전략: index.html(SPA 셸)을 그대로 복제하여 사람에겐 SPA가 정상 부팅되게 하고,
      <head> 메타 + JSON-LD + 그룹 콘텐츠를 정적으로 주입하여 AI 크롤러(JS 미실행)가
      콘텐츠를 직접 읽게 한다. (= prerender + hydrate)

데이터 소스: data/namu-groups/<slug>.json  (SPA가 실제로 fetch하는 per-group 파일)
출력:       namu/<slug>/index.html          (GitHub Pages가 /namu/<slug> 로 200 서빙)

Phase 0는 BTS 1개만 생성하여 "봇=콘텐츠 / 사람=SPA" 공존을 검증한다.
"""
import json
import html
import re
from pathlib import Path

# 리포 루트 = 이 파일(build/)의 부모
ROOT = Path(__file__).resolve().parent.parent
SHELL = ROOT / "index.html"
GROUPS_DIR = ROOT / "data" / "namu-groups"
SITE = "https://aimcontents.com"


def esc(s):
    """HTML 본문/속성 이스케이프 (None 안전)."""
    return html.escape(str(s if s is not None else ""), quote=True)


def load_group(slug):
    with open(GROUPS_DIR / f"{slug}.json", encoding="utf-8") as f:
        return json.load(f)


_data_updated = None


def data_updated():
    """그룹 데이터셋 갱신일(YYYY-MM-DD) = namu-index.json의 내장 'generated'.
    파일 mtime은 git이 보존하지 않아 CI에서 매번 오늘로 바뀌므로 쓰지 않는다."""
    global _data_updated
    if _data_updated is None:
        try:
            g = json.loads((ROOT / "data" / "namu-index.json").read_text(encoding="utf-8")).get("generated", "")
            _data_updated = str(g)[:10]
        except Exception:
            _data_updated = ""
    return _data_updated


# ----------------------------------------------------------------------------
# 메타 문장 (namu.js loadNamuGroupBySlug 의 groupDesc 공식과 동일하게 유지)
# ----------------------------------------------------------------------------
def build_meta(g):
    info = g.get("info", {}) or {}
    member_names = info.get("멤버목록") or ", ".join(
        m.get("name", "") for m in g.get("members", [])
    )
    title = f"{g['name']} ({g['name_en']}) - 소속사·데뷔일·멤버·앨범 판매량 | 나무위키 | 아이엠콘텐츠"
    desc = (
        f"{g['name']}({g['name_en']}) - {info.get('소속사','')} 소속 K-POP "
        f"{info.get('활동유형','아이돌 그룹')}. 데뷔일: {info.get('데뷔일','')}, "
        f"멤버: {member_names}"
        + (f", 팬덤: {info['팬덤명']}" if info.get("팬덤명") else "")
        + ". 앨범 판매량, 멤버 프로필, 나무위키 정보를 제공합니다."
    )
    return title, desc, member_names


# ----------------------------------------------------------------------------
# JSON-LD (3종): MusicGroup / BreadcrumbList / FAQPage
# MusicGroup 은 namu.js updateNamuGroupJsonLd 와 동일 스키마로 baked.
# ----------------------------------------------------------------------------
def build_jsonld(g, slug, member_names):
    info = g.get("info", {}) or {}
    url = f"{SITE}/namu/{slug}/"
    members = [
        {"@type": "Person", "name": m.get("name", ""), "birthDate": m.get("생년월일", "")}
        for m in g.get("members", [])
    ]
    albums = [
        {
            "@type": "MusicAlbum",
            "name": a.get("title", ""),
            "datePublished": a.get("발매일", ""),
            "albumProductionType": a.get("type", ""),
        }
        for a in g.get("albums", [])
        if a.get("초동_한터") not in (None, "", "-")
    ][:5]

    music_group = {
        "@context": "https://schema.org",
        "@type": "MusicGroup",
        "name": g["name"],
        "alternateName": g["name_en"],
        "url": url,
        "genre": "K-POP",
        "foundingDate": info.get("데뷔일", ""),
        "numberOfEmployees": len(g.get("members", [])),
        "member": members,
    }
    if info.get("소속사"):
        music_group["parentOrganization"] = {"@type": "Organization", "name": info["소속사"]}
    if info.get("팬덤명"):
        music_group["funder"] = info["팬덤명"]
    if albums:
        music_group["album"] = albums

    breadcrumb = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "홈", "item": SITE},
            {"@type": "ListItem", "position": 2, "name": "나무위키", "item": f"{SITE}/namu"},
            {"@type": "ListItem", "position": 3, "name": g["name"], "item": url},
        ],
    }

    # FAQPage — 자기완결 직답 문장(AEO 발췌 단위)
    qas = []
    if info.get("소속사"):
        qas.append((
            f"{g['name']}의 소속사는 어디인가요?",
            f"{g['name']}({g['name_en']})은(는) {info['소속사']} 소속이며, "
            f"{info.get('데뷔일','')}에 데뷔한 {len(g.get('members',[]))}인조 "
            f"{info.get('활동유형','K-POP 그룹')}입니다.",
        ))
    if member_names:
        qas.append((
            f"{g['name']}의 멤버는 누구인가요?",
            f"{g['name']}의 멤버는 {member_names}입니다.",
        ))
    if info.get("팬덤명"):
        qas.append((
            f"{g['name']}의 팬덤명은 무엇인가요?",
            f"{g['name']}의 공식 팬덤명은 {info['팬덤명']}입니다.",
        ))
    faq = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": q,
                "acceptedAnswer": {"@type": "Answer", "text": a},
            }
            for q, a in qas
        ],
    }

    blocks = [music_group, breadcrumb]
    if qas:
        blocks.append(faq)
    return "\n".join(
        f'    <script type="application/ld+json" data-static="namu">\n'
        f"{json.dumps(b, ensure_ascii=False, indent=2)}\n    </script>"
        for b in blocks
    ), qas


# ----------------------------------------------------------------------------
# 가시 콘텐츠 (봇이 읽는 본문) — #namuGroupHeader + #namuDetailContent 에 주입
# 사람은 namu.js가 동일 컨테이너를 재렌더(hydrate)하므로 충돌 없음.
# ----------------------------------------------------------------------------
def build_header_html(g):
    badge = "bg-danger-subtle text-danger" if g.get("gender") == "여자" else "bg-primary-subtle text-primary"
    namu_link = (
        f'<a href="{esc(g["namu_url"])}" target="_blank" rel="noopener" '
        f'class="btn btn-outline-success btn-sm ms-2">나무위키에서 보기</a>'
        if g.get("namu_url")
        else ""
    )
    # 봇을 위한 단일 H1 (엔티티 명확화)
    return (
        '<div class="d-flex align-items-center gap-2 flex-wrap">'
        f'<h1 class="fw-bold mb-0 fs-3">{esc(g["name"])}</h1>'
        f'<span class="text-muted">{esc(g["name_en"])}</span>'
        f'<span class="badge {badge}">{esc(g.get("gender",""))}</span>'
        f"{namu_link}</div>"
    )


def build_detail_html(g, qas, updated=""):
    info = g.get("info", {}) or {}
    parts = []

    # 출처·갱신일 (GEO/AEO 인용용 고정 문장)
    src_line = (
        f"<p class='text-muted small'>출처: 아이엠콘텐츠(aimcontents.com) · "
        f"나무위키 기반 공개정보 정제"
        + (f" · 갱신 {updated}" if updated else "")
        + "</p>"
    )
    parts.append(src_line)

    # 1) Q&A 직답 블록 (AEO)
    if qas:
        parts.append('<section class="mb-4"><h2 class="fs-5 fw-bold">자주 묻는 질문</h2><dl>')
        for q, a in qas:
            parts.append(f"<dt class='fw-bold mt-2'>{esc(q)}</dt><dd>{esc(a)}</dd>")
        parts.append("</dl></section>")

    # 2) 프로필 표 (info 인포박스)
    if info:
        parts.append('<section class="mb-4"><h2 class="fs-5 fw-bold">프로필</h2>')
        parts.append('<table class="table table-sm"><tbody>')
        for k, v in info.items():
            if v in (None, ""):
                continue
            parts.append(f"<tr><th style='width:140px'>{esc(k)}</th><td>{esc(v)}</td></tr>")
        parts.append("</tbody></table></section>")

    # 3) 멤버 표
    members = g.get("members", [])
    if members:
        parts.append('<section class="mb-4"><h2 class="fs-5 fw-bold">멤버</h2>')
        parts.append('<table class="table table-sm"><thead><tr>'
                     '<th>활동명</th><th>본명</th><th>생년월일</th><th>출신지</th><th>역할</th>'
                     '</tr></thead><tbody>')
        for m in members:
            parts.append(
                "<tr>"
                f"<td>{esc(m.get('name',''))}</td>"
                f"<td>{esc(m.get('본명',''))}</td>"
                f"<td>{esc(m.get('생년월일',''))}</td>"
                f"<td>{esc(m.get('출신지',''))}</td>"
                f"<td>{esc(m.get('역할',''))}</td>"
                "</tr>"
            )
        parts.append("</tbody></table></section>")

    # 4) 디스코그래피 표 (앨범 + 판매량)
    albums = g.get("albums", [])
    if albums:
        parts.append(f'<section class="mb-4"><h2 class="fs-5 fw-bold">디스코그래피 ({len(albums)}장)</h2>')
        parts.append('<table class="table table-sm"><thead><tr>'
                     '<th>앨범</th><th>유형</th><th>발매일</th><th>초동(써클)</th><th>누적(써클)</th>'
                     '</tr></thead><tbody>')
        for a in albums:
            parts.append(
                "<tr>"
                f"<td>{esc(a.get('title',''))}</td>"
                f"<td>{esc(a.get('type',''))}</td>"
                f"<td>{esc(a.get('발매일',''))}</td>"
                f"<td>{esc(a.get('초동_써클',''))}</td>"
                f"<td>{esc(a.get('누적_써클',''))}</td>"
                "</tr>"
            )
        parts.append("</tbody></table></section>")

    return "\n".join(parts)


# ----------------------------------------------------------------------------
# 셸(index.html)에 주입 — 유니크 앵커 문자열 기반 안전 치환
# ----------------------------------------------------------------------------
def replace_once(text, old, new, label):
    if text.count(old) != 1:
        raise RuntimeError(f"[앵커 불일치] '{label}' 발생횟수={text.count(old)} (1이어야 함)")
    return text.replace(old, new)


def strip_once(text, pattern, label):
    """정규식으로 블록 1개를 제거 (DOTALL, non-greedy). 1개가 아니면 오류."""
    new, n = re.subn(pattern, "", text, flags=re.DOTALL)
    if n != 1:
        raise RuntimeError(f"[strip 불일치] '{label}' 제거={n} (1이어야 함)")
    return new


def build_group_page(slug):
    g = load_group(slug)
    title, desc, member_names = build_meta(g)
    jsonld_html, qas = build_jsonld(g, slug, member_names)
    # GitHub Pages는 /namu/<slug> → /namu/<slug>/ (디렉토리)로 301하므로
    # canonical/og/JSON-LD는 실제 200 URL(트레일링 슬래시)에 맞춘다.
    url = f"{SITE}/namu/{slug}/"

    shell = SHELL.read_text(encoding="utf-8")
    t = shell

    # 1) <head> 메타 치환
    t = replace_once(
        t,
        "<title>아이돌 SNS 팔로워 순위 - 웨이보·빌리빌리·유튜브·스포티파이·인스타그램 | 아이엠콘텐츠</title>",
        f"<title>{esc(title)}</title>",
        "title",
    )
    # description (홈 meta description 한 줄 통째 치환)
    home_desc_anchor = ('content="K-POP 아이돌 SNS 팔로워 순위, 컴백 일정, 실시간 엔터테인먼트 뉴스를 한눈에 확인하세요. '
                        '웨이보, 빌리빌리, 유튜브, 스포티파이 등 주요 SNS 플랫폼의 최신 순위 정보를 제공합니다.">')
    t = replace_once(t, home_desc_anchor, f'content="{esc(desc)}">', "meta description")
    t = replace_once(t, '<link rel="canonical" href="https://aimcontents.com/">',
                     f'<link rel="canonical" href="{url}">', "canonical")
    t = replace_once(t, '<meta property="og:url" content="https://aimcontents.com/">',
                     f'<meta property="og:url" content="{url}">', "og:url")
    t = replace_once(t, '<meta name="twitter:url" content="https://aimcontents.com/">',
                     f'<meta name="twitter:url" content="{url}">', "twitter:url")
    t = replace_once(t, '<meta property="og:title" content="K-Idol SNS Ranking | 아이엠콘텐츠">',
                     f'<meta property="og:title" content="{esc(title)}">', "og:title")
    t = replace_once(t, '<meta name="twitter:title" content="K-Idol SNS Ranking | 아이엠콘텐츠">',
                     f'<meta name="twitter:title" content="{esc(title)}">', "twitter:title")
    t = replace_once(
        t,
        '<meta property="og:description" content="K-POP 아이돌 SNS 팔로워 순위, 컴백 일정, 실시간 엔터테인먼트 뉴스를 한눈에 확인하세요.">',
        f'<meta property="og:description" content="{esc(desc)}">', "og:description")
    t = replace_once(
        t,
        '<meta name="twitter:description" content="K-POP 아이돌 SNS 팔로워 순위, 컴백 일정, 실시간 엔터테인먼트 뉴스를 한눈에 확인하세요.">',
        f'<meta name="twitter:description" content="{esc(desc)}">', "twitter:description")

    # 2) JSON-LD 주입 (</head> 직전)
    t = replace_once(t, "</head>", jsonld_html + "\n</head>", "</head>")

    # 2.5) lean화: 그룹 페이지에서 홈 전용 SEO 블록 제거 (190페이지 중복 콘텐츠 방지)
    #      - <article id="seo-static-content">: 홈 SEO 텍스트
    #      - <noscript>: 홈 그룹표(끝슬래시 무관, baked 본문이 no-JS 폴백 역할 대체)
    t = strip_once(t, r'<article id="seo-static-content".*?</article>', "home seo article")
    t = strip_once(t, r"<noscript>.*?</noscript>", "home noscript")
    # 홈 전용 전수 ItemList(188개)는 그룹 페이지에 불필요(자체 MusicGroup 보유) → 제거
    t = strip_once(
        t,
        r'<!-- Schema\.org K-POP 아이돌 데이터베이스 \(AI 봇 인용 최적화\) -->\s*'
        r'<script type="application/ld\+json">.*?</script>',
        "home ItemList",
    )
    # 잔여 홈 H1(숨김 #page-home 내부)을 H2로 강등 → 엔티티 H1만 남김
    t = replace_once(
        t,
        '<h1 class="mb-3 fw-bold fs-5">K-POP 아이돌 SNS 팔로워 순위</h1>',
        '<h2 class="mb-3 fw-bold fs-5">K-POP 아이돌 SNS 팔로워 순위</h2>',
        "home h1 demote",
    )

    # 3) 봇용 가시 콘텐츠: 섹션 가시성 전환 + 컨테이너 주입
    t = replace_once(t, '<section id="page-home" class="page-section">',
                     '<section id="page-home" class="page-section d-none">', "page-home hide")
    t = replace_once(t, '<section id="page-namu" class="page-section d-none">',
                     '<section id="page-namu" class="page-section">', "page-namu show")
    t = replace_once(t, '<div id="namuGroupDetail" style="display: none;">',
                     '<div id="namuGroupDetail" style="display: block;">', "namuGroupDetail show")
    t = replace_once(t, '<div id="namuGroupHeader" class="mb-3"></div>',
                     f'<div id="namuGroupHeader" class="mb-3">{build_header_html(g)}</div>', "header")
    updated = data_updated()
    t = replace_once(t, '<div id="namuDetailContent"></div>',
                     f'<div id="namuDetailContent">{build_detail_html(g, qas, updated)}</div>', "detail")

    out_dir = ROOT / "namu" / slug
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "index.html"
    out_path.write_text(t, encoding="utf-8")
    return out_path


def all_index_slugs():
    """namu-index.json 의 그룹 슬러그 중 per-group json 이 존재하는 것만."""
    idx = json.loads((ROOT / "data" / "namu-index.json").read_text(encoding="utf-8"))
    slugs = []
    for g in idx["groups"]:
        slug = g.get("slug")
        if slug and (GROUPS_DIR / f"{slug}.json").exists():
            slugs.append(slug)
    return slugs


if __name__ == "__main__":
    import sys
    args = [a for a in sys.argv[1:] if a != "--all"]
    slugs = args if args else all_index_slugs()  # 인자 없으면 전체

    built, skipped, total_bytes = 0, [], 0
    for s in slugs:
        try:
            p = build_group_page(s)
            built += 1
            total_bytes += p.stat().st_size
        except Exception as e:
            skipped.append((s, str(e)))
    print(f"생성: {built}개  (평균 {total_bytes // max(built,1):,} bytes)")
    if skipped:
        print(f"스킵: {len(skipped)}개")
        for s, e in skipped[:10]:
            print(f"  - {s}: {e}")
