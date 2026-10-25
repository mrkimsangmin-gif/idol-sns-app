# -*- coding: utf-8 -*-
"""
정적 페이지 생성 파이프라인 — 한국어(KO) 및 영문(EN) 멀티 링구얼 정적 페이지 빌더

- 한국어 기본 경로: /namu/<slug>/index.html
- 영문 글로벌 경로: /en/namu/<slug>/index.html
- hreflang 상호 연결 (ko, en, x-default)
- 상단 헤더 언어 전환 토글 [🌐 English] / [🌐 한국어] 주입
"""
import json
import html
import re
from pathlib import Path
import sys

ROOT_BUILD = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT_BUILD))
from seo_enricher import generate_seo_enrichment, generate_seo_enrichment_en

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
    """그룹 데이터셋 갱신일(YYYY-MM-DD) = namu-index.json의 내장 'generated'."""
    global _data_updated
    if _data_updated is None:
        try:
            g = json.loads((ROOT / "data" / "namu-index.json").read_text(encoding="utf-8")).get("generated", "")
            _data_updated = str(g)[:10]
        except Exception:
            _data_updated = ""
    return _data_updated


# ----------------------------------------------------------------------------
# 한국어(KO) 메타 & JSON-LD & 가시 콘텐츠
# ----------------------------------------------------------------------------
def build_meta(g, enrichment=None):
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


def build_jsonld(g, slug, member_names, enrichment=None):
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
    if enrichment and enrichment.get("extra_qas"):
        qas.extend(enrichment["extra_qas"])
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


def build_header_html(g, lang="ko"):
    badge = "bg-danger-subtle text-danger" if g.get("gender") == "여자" else "bg-primary-subtle text-primary"
    gender_label = g.get("gender", "")
    if lang == "en":
        gender_label = "Female Group" if g.get("gender") == "여자" else "Male Group"

    namu_btn_text = "나무위키에서 보기" if lang == "ko" else "View on NamuWiki"
    namu_link = (
        f'<a href="{esc(g["namu_url"])}" target="_blank" rel="noopener" '
        f'class="btn btn-outline-success btn-sm ms-2">{namu_btn_text}</a>'
        if g.get("namu_url")
        else ""
    )
    primary_name = esc(g["name"]) if lang == "ko" else esc(g["name_en"] or g["name"])
    secondary_name = esc(g["name_en"]) if lang == "ko" else esc(g["name"])

    return (
        '<div class="d-flex align-items-center gap-2 flex-wrap">'
        f'<h1 class="fw-bold mb-0 fs-3">{primary_name}</h1>'
        f'<span class="text-muted">{secondary_name}</span>'
        f'<span class="badge {badge}">{esc(gender_label)}</span>'
        f"{namu_link}</div>"
    )


def build_detail_html(g, qas, updated="", enrichment=None):
    info = g.get("info", {}) or {}
    parts = []

    src_line = (
        f"<p class='text-muted small'>출처: 아이엠콘텐츠(aimcontents.com) · "
        f"나무위키 기반 공개정보 정제"
        + (f" · 갱신 {updated}" if updated else "")
        + "</p>"
    )
    parts.append(src_line)

    if enrichment and enrichment.get("sr_only_html"):
        parts.append(enrichment["sr_only_html"])

    if qas:
        parts.append('<section class="mb-4"><h2 class="fs-5 fw-bold">자주 묻는 질문</h2><dl>')
        for q, a in qas:
            parts.append(f"<dt class='fw-bold mt-2'>{esc(q)}</dt><dd>{esc(a)}</dd>")
        parts.append("</dl></section>")

    if info:
        parts.append('<section class="mb-4"><h2 class="fs-5 fw-bold">프로필</h2>')
        parts.append('<table class="table table-sm"><tbody>')
        for k, v in info.items():
            if v in (None, ""):
                continue
            parts.append(f"<tr><th style='width:140px'>{esc(k)}</th><td>{esc(v)}</td></tr>")
        parts.append("</tbody></table></section>")

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

    parts.append(f'''
    <section class="mt-4 pt-3 border-top">
        <div class="card border-0 bg-light p-3 rounded-3 shadow-sm">
            <h3 class="fs-6 fw-bold mb-3">🔗 {esc(g['name'])} 더 알아보기 & 실시간 K-POP 데이터</h3>
            <div class="row g-2">
                <div class="col-12 col-md-6">
                    <a href="/ranking" class="btn btn-outline-primary w-100 py-2 d-flex align-items-center justify-content-between text-start">
                        <span>
                            <strong class="d-block">🏆 실시간 SNS & 틱톡 순위</strong>
                            <small class="text-muted">191개 아이돌 팔로워 & 숏폼 참여율(ER) 비교</small>
                        </span>
                        <i class="bi bi-chevron-right text-primary"></i>
                    </a>
                </div>
                <div class="col-12 col-md-6">
                    <a href="/comeback" class="btn btn-outline-success w-100 py-2 d-flex align-items-center justify-content-between text-start">
                        <span>
                            <strong class="d-block">📅 K-POP 컴백 & 데뷔 캘린더</strong>
                            <small class="text-muted">2026년 최신 앨범 발매일 및 컴백 스케줄</small>
                        </span>
                        <i class="bi bi-chevron-right text-success"></i>
                    </a>
                </div>
                <div class="col-12 col-md-6">
                    <a href="/jobs" class="btn btn-outline-warning text-dark w-100 py-2 d-flex align-items-center justify-content-between text-start">
                        <span>
                            <strong class="d-block">💼 엔터테인먼트 채용정보</strong>
                            <small class="text-muted">하이브·SM·JYP·YG 등 기획사 실시간 채용공고</small>
                        </span>
                        <i class="bi bi-chevron-right text-warning"></i>
                    </a>
                </div>
                <div class="col-12 col-md-6">
                    <a href="/news" class="btn btn-outline-info text-dark w-100 py-2 d-flex align-items-center justify-content-between text-start">
                        <span>
                            <strong class="d-block">📰 실시간 엔터뉴스</strong>
                            <small class="text-muted">K-POP 컴백·기획사 동향 실시간 업계 소식</small>
                        </span>
                        <i class="bi bi-chevron-right text-info"></i>
                    </a>
                </div>
            </div>
        </div>
    </section>
    ''')
    return "\n".join(parts)


# ----------------------------------------------------------------------------
# 영문(EN) 메타 & JSON-LD & 가시 콘텐츠
# ----------------------------------------------------------------------------
INFO_LABEL_MAP_EN = {
    "멤버수": "Members",
    "데뷔일": "Debut Date",
    "소속사": "Agency",
    "그룹명뜻": "Meaning of Name",
    "팬덤명": "Fandom Name",
    "응원봉": "Lightstick",
    "훈장": "Honors / Awards",
    "레이블": "Label",
    "유통사": "Distributor",
    "결성일": "Formation Date",
    "활동유형": "Group Type",
    "활동유 유형": "Group Type",
    "리더": "Leader",
    "인스타그램": "Instagram",
    "유튜브": "YouTube",
    "X(트위터)": "X (Twitter)",
    "틱톡": "TikTok",
    "멤버목록": "Member List"
}


def build_meta_en(g, enrichment_en=None):
    info = g.get("info", {}) or {}
    name_en = g.get("name_en") or g["name"]
    name_kr = g["name"]
    member_names = info.get("멤버목록") or ", ".join(
        m.get("name", "") for m in g.get("members", [])
    )
    title = f"{name_en} ({name_kr}) - Profile, Members, Age, Debut & Album Sales | AIMCONTENTS"
    
    agency = info.get("소속사", "") or g.get("agency", "")
    agency_part = f", managed by {agency}" if agency else ""
    debut_part = f" Debut Date: {info.get('데뷔일', '')}." if info.get('데뷔일') else ""
    fandom_part = f" Official Fandom: {info['팬덤명']}." if info.get("팬덤명") else ""

    desc = (
        f"Complete profile and verified statistics for K-POP group {name_en} ({name_kr}){agency_part}."
        f"{debut_part} Members: {member_names}.{fandom_part} "
        f"Explore first-week album sales, member age ranking, and real-time SNS metrics on AIMCONTENTS Data Lab."
    )
    return title, desc, member_names


def build_jsonld_en(g, slug, member_names, enrichment_en=None):
    info = g.get("info", {}) or {}
    url = f"{SITE}/en/namu/{slug}/"
    name_en = g.get("name_en") or g["name"]
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
        "name": name_en,
        "alternateName": g["name"],
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
            {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{SITE}/en/"},
            {"@type": "ListItem", "position": 2, "name": "K-POP Profiles", "item": f"{SITE}/en/namu/"},
            {"@type": "ListItem", "position": 3, "name": name_en, "item": url},
        ],
    }

    qas = []
    if info.get("소속사"):
        qas.append((
            f"What agency does {name_en} belong to?",
            f"{name_en} ({g['name']}) is managed by {info['소속사']}, and debuted on "
            f"{info.get('데뷔일','')} as a {len(g.get('members',[]))}-member K-POP group.",
        ))
    if member_names:
        qas.append((
            f"Who are the members of {name_en}?",
            f"The members of {name_en} are {member_names}.",
        ))
    if info.get("팬덤명"):
        qas.append((
            f"What is the official fandom name of {name_en}?",
            f"The official fandom name of {name_en} is {info['팬덤명']}.",
        ))
    if enrichment_en and enrichment_en.get("extra_qas"):
        qas.extend(enrichment_en["extra_qas"])
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


def build_detail_html_en(g, qas, updated="", enrichment_en=None):
    info = g.get("info", {}) or {}
    name_en = g.get("name_en") or g["name"]
    parts = []

    src_line = (
        f"<p class='text-muted small'>Source: AIMCONTENTS Data Lab (aimcontents.com) · "
        f"Verified K-POP Open Database"
        + (f" · Updated {updated}" if updated else "")
        + "</p>"
    )
    parts.append(src_line)

    if enrichment_en and enrichment_en.get("sr_only_html"):
        parts.append(enrichment_en["sr_only_html"])

    if qas:
        parts.append('<section class="mb-4"><h2 class="fs-5 fw-bold">Frequently Asked Questions</h2><dl>')
        for q, a in qas:
            parts.append(f"<dt class='fw-bold mt-2'>{esc(q)}</dt><dd>{esc(a)}</dd>")
        parts.append("</dl></section>")

    if info:
        parts.append('<section class="mb-4"><h2 class="fs-5 fw-bold">Official Profile</h2>')
        parts.append('<table class="table table-sm"><tbody>')
        for k, v in info.items():
            if v in (None, ""):
                continue
            en_label = INFO_LABEL_MAP_EN.get(k, k)
            parts.append(f"<tr><th style='width:160px'>{esc(en_label)}</th><td>{esc(v)}</td></tr>")
        parts.append("</tbody></table></section>")

    members = g.get("members", [])
    if members:
        parts.append('<section class="mb-4"><h2 class="fs-5 fw-bold">Members</h2>')
        parts.append('<table class="table table-sm"><thead><tr>'
                     '<th>Stage Name</th><th>Real Name</th><th>Birth Date</th><th>Birthplace</th><th>Role</th>'
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

    albums = g.get("albums", [])
    if albums:
        parts.append(f'<section class="mb-4"><h2 class="fs-5 fw-bold">Discography ({len(albums)} Releases)</h2>')
        parts.append('<table class="table table-sm"><thead><tr>'
                     '<th>Album Title</th><th>Type</th><th>Release Date</th><th>1st Week Sales</th><th>Total Sales</th>'
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

    parts.append(f'''
    <section class="mt-4 pt-3 border-top">
        <div class="card border-0 bg-light p-3 rounded-3 shadow-sm">
            <h3 class="fs-6 fw-bold mb-3">🔗 Explore More {esc(name_en)} & Real-Time K-POP Analytics</h3>
            <div class="row g-2">
                <div class="col-12 col-md-6">
                    <a href="/ranking" class="btn btn-outline-primary w-100 py-2 d-flex align-items-center justify-content-between text-start">
                        <span>
                            <strong class="d-block">🏆 Live SNS & TikTok Rankings</strong>
                            <small class="text-muted">Compare followers & Engagement Rate across 190+ groups</small>
                        </span>
                        <i class="bi bi-chevron-right text-primary"></i>
                    </a>
                </div>
                <div class="col-12 col-md-6">
                    <a href="/comeback" class="btn btn-outline-success w-100 py-2 d-flex align-items-center justify-content-between text-start">
                        <span>
                            <strong class="d-block">📅 K-POP Comeback Schedule</strong>
                            <small class="text-muted">2026 latest album releases and verified comeback dates</small>
                        </span>
                        <i class="bi bi-chevron-right text-success"></i>
                    </a>
                </div>
                <div class="col-12 col-md-6">
                    <a href="/jobs" class="btn btn-outline-warning text-dark w-100 py-2 d-flex align-items-center justify-content-between text-start">
                        <span>
                            <strong class="d-block">💼 K-POP Industry Jobs</strong>
                            <small class="text-muted">Openings at HYBE, SM, JYP, YG and leading agencies</small>
                        </span>
                        <i class="bi bi-chevron-right text-warning"></i>
                    </a>
                </div>
                <div class="col-12 col-md-6">
                    <a href="/news" class="btn btn-outline-info text-dark w-100 py-2 d-flex align-items-center justify-content-between text-start">
                        <span>
                            <strong class="d-block">📰 Entertainment News</strong>
                            <small class="text-muted">Daily verified K-POP comeback and industry headlines</small>
                        </span>
                        <i class="bi bi-chevron-right text-info"></i>
                    </a>
                </div>
            </div>
        </div>
    </section>
    ''')
    return "\n".join(parts)


# ----------------------------------------------------------------------------
# 셸 헬퍼 함수
# ----------------------------------------------------------------------------
def replace_once(text, old, new, label):
    if text.count(old) != 1:
        raise RuntimeError(f"[앵커 불일치] '{label}' 발생횟수={text.count(old)} (1이어야 함)")
    return text.replace(old, new)


def strip_once(text, pattern, label):
    new, n = re.subn(pattern, "", text, flags=re.DOTALL)
    if n != 1:
        raise RuntimeError(f"[strip 불일치] '{label}' 제거={n} (1이어야 함)")
    return new


# ----------------------------------------------------------------------------
# 한국어 페이지 빌드
# ----------------------------------------------------------------------------
def build_group_page_ko(slug):
    g = load_group(slug)
    enrichment = generate_seo_enrichment(g)
    title, desc, member_names = build_meta(g, enrichment)
    jsonld_html, qas = build_jsonld(g, slug, member_names, enrichment)
    
    url_ko = f"{SITE}/namu/{slug}/"
    url_en = f"{SITE}/en/namu/{slug}/"

    t = SHELL.read_text(encoding="utf-8")

    # 1) <head> 메타 치환
    t = replace_once(
        t,
        "<title>아이돌 SNS 팔로워 순위 - 틱톡·유튜브·인스타·웨이보·도우인 | 아이엠콘텐츠</title>",
        f"<title>{esc(title)}</title>",
        "title",
    )
    home_desc_anchor = ('content="K-POP 아이돌 틱톡(TikTok)·유튜브·인스타그램·웨이보·빌리빌리·도우인 SNS 순위 및 팔로워 랭킹. '
                        '188개 아이돌 그룹의 숏폼 참여율(ER), 컴백 일정, 나무위키 정보를 매주/매월 업데이트합니다.">')
    t = replace_once(t, home_desc_anchor, f'content="{esc(desc)}">', "meta description")
    
    # hreflang + canonical
    seo_links = (
        f'<link rel="canonical" href="{url_ko}">\n'
        f'    <link rel="alternate" hreflang="ko" href="{url_ko}">\n'
        f'    <link rel="alternate" hreflang="en" href="{url_en}">\n'
        f'    <link rel="alternate" hreflang="x-default" href="{url_ko}">'
    )
    t = replace_once(t, '<link rel="canonical" href="https://aimcontents.com/">', seo_links, "canonical + hreflang")

    t = replace_once(t, '<meta property="og:url" content="https://aimcontents.com/">',
                     f'<meta property="og:url" content="{url_ko}">', "og:url")
    t = replace_once(t, '<meta name="twitter:url" content="https://aimcontents.com/">',
                     f'<meta name="twitter:url" content="{url_ko}">', "twitter:url")
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

    # 2) JSON-LD 주입
    t = replace_once(t, "</head>", jsonld_html + "\n</head>", "</head>")

    # 2.5) lean화
    t = strip_once(t, r'<article id="seo-static-content".*?</article>', "home seo article")
    t = strip_once(t, r"<noscript>.*?</noscript>", "home noscript")
    t = strip_once(
        t,
        r'<!-- Schema\.org K-POP 아이돌 데이터베이스 \(AI 봇 인용 최적화\) -->\s*'
        r'<script type="application/ld\+json">.*?</script>',
        "home ItemList",
    )
    t = replace_once(
        t,
        '<h1 class="mb-3 fw-bold fs-5">K-POP 아이돌 SNS 팔로워 순위</h1>',
        '<h2 class="mb-3 fw-bold fs-5">K-POP 아이돌 SNS 팔로워 순위</h2>',
        "home h1 demote",
    )

    # 3) 상단 네비게이션에 [🌐 English] 전환 토글 주입
    pos_ins = t.find('index_insight.html')
    pos_end_ul = t.find('</ul>', pos_ins) + 5
    nav_tail = t[pos_ins:pos_end_ul]
    lang_btn_ko = (
        f'<li class="nav-item ms-lg-2 my-1 my-lg-0">'
        f'<a class="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" '
        f'href="{url_en}"><i class="bi bi-globe"></i> English</a></li>'
        f'\n                </ul>'
    )
    t = replace_once(t, nav_tail, nav_tail[:-5] + lang_btn_ko, "nav lang toggle ko")

    # 4) 봇용 가시 콘텐츠
    t = replace_once(t, '<section id="page-home" class="page-section">',
                     '<section id="page-home" class="page-section d-none">', "page-home hide")
    t = replace_once(t, '<section id="page-namu" class="page-section d-none">',
                     '<section id="page-namu" class="page-section">', "page-namu show")
    t = replace_once(t, '<div id="namuGroupDetail" style="display: none;">',
                     '<div id="namuGroupDetail" style="display: block;">', "namuGroupDetail show")
    t = replace_once(t, '<div id="namuGroupHeader" class="mb-3"></div>',
                     f'<div id="namuGroupHeader" class="mb-3">{build_header_html(g, lang="ko")}</div>', "header")
    updated = data_updated()
    t = replace_once(t, '<div id="namuDetailContent"></div>',
                     f'<div id="namuDetailContent">{build_detail_html(g, qas, updated, enrichment=enrichment)}</div>', "detail")

    t = replace_once(t, '<a href="/ranking" class="mobile-nav-item active" data-page="home"',
                     '<a href="/ranking" class="mobile-nav-item" data-page="home"', "mobile-nav home inactive")

    out_dir = ROOT / "namu" / slug
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "index.html"
    out_path.write_text(t, encoding="utf-8")
    return out_path


# ----------------------------------------------------------------------------
# 영문(EN) 페이지 빌드
# ----------------------------------------------------------------------------
def build_group_page_en(slug):
    g = load_group(slug)
    enrichment_en = generate_seo_enrichment_en(g)
    title, desc, member_names = build_meta_en(g, enrichment_en)
    jsonld_html, qas = build_jsonld_en(g, slug, member_names, enrichment_en)
    
    url_ko = f"{SITE}/namu/{slug}/"
    url_en = f"{SITE}/en/namu/{slug}/"

    t = SHELL.read_text(encoding="utf-8")

    # 0) lang="ko" -> lang="en"
    t = replace_once(t, '<html lang="ko">', '<html lang="en">', "html lang en")

    # 1) <head> 메타 치환
    t = replace_once(
        t,
        "<title>아이돌 SNS 팔로워 순위 - 틱톡·유튜브·인스타·웨이보·도우인 | 아이엠콘텐츠</title>",
        f"<title>{esc(title)}</title>",
        "title en",
    )
    home_desc_anchor = ('content="K-POP 아이돌 틱톡(TikTok)·유튜브·인스타그램·웨이보·빌리빌리·도우인 SNS 순위 및 팔로워 랭킹. '
                        '188개 아이돌 그룹의 숏폼 참여율(ER), 컴백 일정, 나무위키 정보를 매주/매월 업데이트합니다.">')
    t = replace_once(t, home_desc_anchor, f'content="{esc(desc)}">', "meta description en")
    
    # hreflang + canonical
    seo_links = (
        f'<link rel="canonical" href="{url_en}">\n'
        f'    <link rel="alternate" hreflang="ko" href="{url_ko}">\n'
        f'    <link rel="alternate" hreflang="en" href="{url_en}">\n'
        f'    <link rel="alternate" hreflang="x-default" href="{url_ko}">'
    )
    t = replace_once(t, '<link rel="canonical" href="https://aimcontents.com/">', seo_links, "canonical + hreflang en")

    t = replace_once(t, '<meta property="og:url" content="https://aimcontents.com/">',
                     f'<meta property="og:url" content="{url_en}">', "og:url en")
    t = replace_once(t, '<meta name="twitter:url" content="https://aimcontents.com/">',
                     f'<meta name="twitter:url" content="{url_en}">', "twitter:url en")
    t = replace_once(t, '<meta property="og:title" content="K-POP 아이돌 SNS·틱톡·유튜브 팔로워 순위 | 아이엠콘텐츠">',
                     f'<meta property="og:title" content="{esc(title)}">', "og:title en")
    t = replace_once(t, '<meta name="twitter:title" content="K-POP 아이돌 SNS·틱톡·유튜브 팔로워 순위 | 아이엠콘텐츠">',
                     f'<meta name="twitter:title" content="{esc(title)}">', "twitter:title en")
    t = replace_once(
        t,
        '<meta property="og:description" content="K-POP 아이돌 틱톡(TikTok), 유튜브, 인스타그램, 웨이보, 도우인 SNS 팔로워 순위와 컴백 일정, 188개 그룹 상세 정보.">',
        f'<meta property="og:description" content="{esc(desc)}">', "og:description en")
    t = replace_once(
        t,
        '<meta name="twitter:description" content="K-POP 아이돌 틱톡(TikTok), 유튜브, 인스타그램, 웨이보, 도우인 SNS 팔로워 순위와 컴백 일정, 188개 그룹 상세 정보.">',
        f'<meta name="twitter:description" content="{esc(desc)}">', "twitter:description en")

    # 2) JSON-LD 주입
    t = replace_once(t, "</head>", jsonld_html + "\n</head>", "</head> en")

    # 2.5) lean화
    t = strip_once(t, r'<article id="seo-static-content".*?</article>', "home seo article en")
    t = strip_once(t, r"<noscript>.*?</noscript>", "home noscript en")
    t = strip_once(
        t,
        r'<!-- Schema\.org K-POP 아이돌 데이터베이스 \(AI 봇 인용 최적화\) -->\s*'
        r'<script type="application/ld\+json">.*?</script>',
        "home ItemList en",
    )
    t = replace_once(
        t,
        '<h1 class="mb-3 fw-bold fs-5">K-POP 아이돌 SNS 팔로워 순위</h1>',
        '<h2 class="mb-3 fw-bold fs-5">K-POP Idol SNS & Discography Analytics</h2>',
        "home h1 demote en",
    )

    # 3) 상단 네비게이션 라벨 영문화 + [🌐 한국어] 전환 토글 주입
    t = replace_once(t, 'route(\'home\')">SNS랭킹</a>', 'route(\'home\')">SNS Ranking</a>', "nav ranking en")
    t = replace_once(t, '/monthly/2026-09/boys/">월간차트<', '/monthly/2026-09/boys/">Monthly Chart<', "nav monthly en")
    t = replace_once(t, 'route(\'comeback\')">컴백일정</a>', 'route(\'comeback\')">Comebacks</a>', "nav comeback en")
    t = replace_once(t, 'route(\'news\')">엔터뉴스</a>', 'route(\'news\')">News</a>', "nav news en")
    t = replace_once(t, 'route(\'douyin\')">중국트렌드</a>', 'route(\'douyin\')">China Trends</a>', "nav douyin en")
    t = replace_once(t, 'route(\'jobs\')">채용정보</a>', 'route(\'jobs\')">Jobs</a>', "nav jobs en")
    t = replace_once(t, 'route(\'links\')">링크모음</a>', 'route(\'links\')">Links</a>', "nav links en")
    t = replace_once(t, 'route(\'vendors\')">업체정보</a>', 'route(\'vendors\')">Vendors</a>', "nav vendors en")
    t = replace_once(t, 'href="/insight/index_insight.html">인사이트</a>', 'href="/insight/index_insight.html">Insights</a>', "nav insights en")

    pos_ins = t.find('index_insight.html')
    pos_end_ul = t.find('</ul>', pos_ins) + 5
    nav_tail = t[pos_ins:pos_end_ul]
    lang_btn_en = (
        f'<li class="nav-item ms-lg-2 my-1 my-lg-0">'
        f'<a class="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" '
        f'href="{url_ko}"><i class="bi bi-globe"></i> 한국어</a></li>'
        f'\n                </ul>'
    )
    t = replace_once(t, nav_tail, nav_tail[:-5] + lang_btn_en, "nav lang toggle en")

    # 4) 봇용 가시 콘텐츠
    t = replace_once(t, '<section id="page-home" class="page-section">',
                     '<section id="page-home" class="page-section d-none">', "page-home hide en")
    t = replace_once(t, '<section id="page-namu" class="page-section d-none">',
                     '<section id="page-namu" class="page-section">', "page-namu show en")
    t = replace_once(t, '<div id="namuGroupDetail" style="display: none;">',
                     '<div id="namuGroupDetail" style="display: block;">', "namuGroupDetail show en")
    t = replace_once(t, '<div id="namuGroupHeader" class="mb-3"></div>',
                     f'<div id="namuGroupHeader" class="mb-3">{build_header_html(g, lang="en")}</div>', "header en")
    updated = data_updated()
    t = replace_once(t, '<div id="namuDetailContent"></div>',
                     f'<div id="namuDetailContent">{build_detail_html_en(g, qas, updated, enrichment_en=enrichment_en)}</div>', "detail en")

    t = replace_once(t, '<a href="/ranking" class="mobile-nav-item active" data-page="home"',
                     '<a href="/ranking" class="mobile-nav-item" data-page="home"', "mobile-nav home inactive en")

    out_dir = ROOT / "en" / "namu" / slug
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
    slugs = args if args else all_index_slugs()

    built_ko, built_en, skipped, total_bytes = 0, 0, [], 0
    for s in slugs:
        try:
            p_ko = build_group_page_ko(s)
            built_ko += 1
            total_bytes += p_ko.stat().st_size
            
            p_en = build_group_page_en(s)
            built_en += 1
            total_bytes += p_en.stat().st_size
        except Exception as e:
            skipped.append((s, str(e)))
            
    print(f"생성 완료: 한국어 {built_ko}개 + 영문 {built_en}개 (총 {built_ko + built_en} 페이지)")
    print(f"총 용량: {total_bytes // 1024:,} KB")
    if skipped:
        print(f"스킵: {len(skipped)}개")
        for s, e in skipped[:10]:
            print(f"  - {s}: {e}")
