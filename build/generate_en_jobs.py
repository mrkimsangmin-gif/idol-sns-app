import sys
sys.stdout.reconfigure(encoding='utf-8')
# -*- coding: utf-8 -*-
"""
build/generate_en_jobs.py — /en/jobs/ 영문 채용 페이지 정적 빌더 (SSR + JobPosting JSON-LD)

매일 jobs.json이 업데이트될 때마다:
1. data/jobs.json 최신 공고 데이터를 읽어 영문화된 직무 카테고리/경력/마감일 표 사전 렌더링 (SSR)
2. Schema.org JobPosting 및 CollectionPage 영문 JSON-LD 주입
3. build/en_shell_localizer.py를 통해 베이스 쉘의 모든 컨트롤/모달/A11y 속성 완전 영문화
4. 한국어(/jobs/) 및 영문(/en/jobs/) 상호 hreflang 연결 및 Globe 언어 전환 토글 배치
"""
import html
import json
import re
import sys
from pathlib import Path

# en_shell_localizer 임포트 지원
sys.path.insert(0, str(Path(__file__).resolve().parent))
from en_shell_localizer import localize_shell_to_en

ROOT = Path(__file__).resolve().parent.parent
SHELL = ROOT / "index.html"
SITE = "https://aimcontents.com"
URL_EN = f"{SITE}/en/jobs/"
URL_KO = f"{SITE}/jobs/"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

JOB_CATEGORY_EN_MAP = {
    'all': 'All', '전체': 'All',
    '마케팅': 'Marketing',
    '영상': 'Video / Media',
    '신인개발': 'A&R / Casting',
    '매니지먼트': 'Management',
    '프로듀싱': 'Music Production',
    '디자인': 'Creative Design',
    'IT': 'IT & Tech',
    '영업': 'Business Sales',
    '경영지원': 'Operations & HR',
    '해외사업': 'Global Business',
    '기타': 'Others'
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

def build_jobposting_en(job):
    category_en = JOB_CATEGORY_EN_MAP.get(job.get("category", ""), job.get("category", "Entertainment"))
    career_val = job.get("career", "")
    career_en = "Any Experience" if career_val in ("무관", "경력무관", "") else career_val
    comp = job.get("company", "")
    pos = job.get("position", "")

    jp = {
        "@type": "JobPosting",
        "title": pos,
        "hiringOrganization": {"@type": "Organization", "name": comp},
        "industry": "K-POP / Entertainment",
        "url": job.get("url", ""),
        "directApply": False,
        "description": f"K-POP & Entertainment Career Opportunity: {comp} is hiring for {pos}"
                       + (f" ({career_en})" if career_en else "")
                       + f". Location: {job.get('location', 'Seoul, KR')}. Please check official source ({job.get('source', '')}) for requirements.",
    }
    if job.get("location"):
        jp["jobLocation"] = {
            "@type": "Place",
            "address": {"@type": "PostalAddress", "addressLocality": job["location"], "addressCountry": "KR"},
        }
    if DATE_RE.match(job.get("deadline", "")):
        jp["validThrough"] = f"{job['deadline']}T23:59:59+09:00"
    return jp

def build_table_en(jobs):
    rows = []
    for j in jobs:
        comp = esc(j.get("company", ""))
        pos = esc(j.get("position", ""))
        link = j.get("url", "")
        pos_cell = f'<a href="{esc(link)}" target="_blank" rel="noopener">{pos}</a>' if link else pos
        cat_en = esc(JOB_CATEGORY_EN_MAP.get(j.get("category", ""), j.get("category", "")))
        career_raw = j.get("career", "")
        career_en = esc("Any" if career_raw in ("무관", "경력무관", "") else career_raw)
        deadline = esc(j.get("deadline", ""))
        if deadline == "상시채용":
            deadline = "Always"

        rows.append(
            "<tr>"
            f"<td>{comp}</td><td>{pos_cell}</td>"
            f"<td>{cat_en}</td>"
            f"<td>{career_en}</td>"
            f"<td>{esc(j.get('location',''))}</td>"
            f"<td>{deadline}</td>"
            f"<td>{esc(j.get('source',''))}</td>"
            "</tr>"
        )
    return (
        '<div class="col-12"><section>'
        '<table class="table table-sm table-hover"><thead><tr>'
        '<th>Company</th><th>Position</th><th>Category</th><th>Experience</th><th>Location</th><th>Deadline</th><th>Source</th>'
        f'</tr></thead><tbody>{"".join(rows)}</tbody></table>'
        '<p class="text-muted small">💼 This job board is a link curation service based on publicly available postings from external recruitment sites.</p>'
        "</section></div>"
    )

def generate_en_jobs():
    jobs_file = ROOT / "data" / "jobs.json"
    if not jobs_file.exists():
        print("data/jobs.json missing")
        return
    jobs = json.loads(jobs_file.read_text(encoding="utf-8"))["data"]

    title = f"K-POP & Entertainment Career Opportunities ({len(jobs)} Openings) | AIMCONTENTS"
    desc = (f"Explore {len(jobs)} curated K-POP and entertainment industry job openings. "
            f"Career opportunities across major agencies and labels in Marketing, Video, A&R, Management, and Global Business.")

    graph = {"@context": "https://schema.org", "@graph": [build_jobposting_en(j) for j in jobs]}
    collection = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": "K-POP & Entertainment Career Opportunities",
        "url": URL_EN,
        "about": "K-POP & Entertainment Industry Job Opportunities",
        "publisher": {"@type": "Organization", "name": "AIMCONTENTS"},
    }
    jsonld = "\n".join(
        f'    <script type="application/ld+json" data-static="jobs">\n'
        f"{json.dumps(b, ensure_ascii=False, indent=2)}\n    </script>"
        for b in (collection, graph)
    )

    t = SHELL.read_text(encoding="utf-8")
    t = strip_once(t, r'<article id="seo-static-content".*?</article>', "home seo article")
    t = strip_once(t, r"<noscript>.*?</noscript>", "home noscript")
    t = strip_once(
        t,
        r'<!-- Schema\.org K-POP 아이돌 데이터베이스 \(AI 봇 인용 최적화\) -->\s*'
        r'<script type="application/ld\+json">.*?</script>',
        "home ItemList",
    )

    # 1. html lang & meta
    t = replace_once(t, '<html lang="ko">', '<html lang="en">', "html lang")

    t = re.sub(r'<title>.*?</title>', f'<title>{esc(title)}</title>', t, count=1)
    t = re.sub(r'<meta name="description"[^>]*>', f'<meta name="description" content="{esc(desc)}">', t, count=1)
    t = re.sub(r'<link rel="canonical"[^>]*>', f'<link rel="canonical" href="{URL_EN}">', t, count=1)

    hreflang_tags = (
        f'<link rel="alternate" hreflang="ko" href="{URL_KO}">\n'
        f'    <link rel="alternate" hreflang="en" href="{URL_EN}">\n'
        f'    <link rel="alternate" hreflang="x-default" href="{URL_KO}">'
    )
    t = replace_once(t, "</head>", f"{hreflang_tags}\n{jsonld}\n</head>", "head close")

    # OG / Twitter
    t = re.sub(r'<meta property="og:title"[^>]*>', f'<meta property="og:title" content="{esc(title)}">', t, count=1)
    t = re.sub(r'<meta property="og:description"[^>]*>', f'<meta property="og:description" content="{esc(desc)}">', t, count=1)
    t = re.sub(r'<meta property="og:url"[^>]*>', f'<meta property="og:url" content="{URL_EN}">', t, count=1)
    t = re.sub(r'<meta name="twitter:title"[^>]*>', f'<meta name="twitter:title" content="{esc(title)}">', t, count=1)
    t = re.sub(r'<meta name="twitter:description"[^>]*>', f'<meta name="twitter:description" content="{esc(desc)}">', t, count=1)
    t = re.sub(r'<meta name="twitter:url"[^>]*>', f'<meta name="twitter:url" content="{URL_EN}">', t, count=1)

    # 2. Nav links
    t = replace_once(t, 'route(\'home\')">SNS랭킹</a>', 'route(\'home\')">SNS Ranking</a>', "nav ranking en")
    t = replace_once(t, '/monthly/2026-09/boys/">월간차트<', '/monthly/2026-09/boys/">Monthly Chart<', "nav monthly en")
    t = replace_once(t, 'route(\'namu\')">나무위키<', 'route(\'namu\')">Profiles<', "nav namu en")
    t = replace_once(t, 'route(\'comeback\')">컴백일정</a>', 'route(\'comeback\')">Comebacks</a>', "nav comeback en")
    t = replace_once(t, 'route(\'news\')">엔터뉴스</a>', 'route(\'news\')">News</a>', "nav news en")
    t = replace_once(t, 'route(\'douyin\')">중국트렌드</a>', 'route(\'douyin\')">China Trends</a>', "nav douyin en")
    t = replace_once(t, 'class="nav-link" href="/jobs" onclick="event.preventDefault(); route(\'jobs\')">채용정보</a>',
                     'class="nav-link active" href="/en/jobs" onclick="event.preventDefault(); route(\'jobs\')">Jobs</a>', "nav jobs active en")
    t = replace_once(t, 'route(\'links\')">링크모음</a>', 'route(\'links\')">Links</a>', "nav links en")
    t = replace_once(t, 'route(\'vendors\')">업체정보</a>', 'route(\'vendors\')">Vendors</a>', "nav vendors en")
    t = replace_once(t, 'href="/insight/index_insight.html">인사이트</a>', 'href="/insight/index_insight.html">Insights</a>', "nav insights en")

    # 3. Globe toggle to Korean version
    pos_ins = t.find('href="/insight/index_insight.html">Insights</a>')
    pos_end_ul = t.find('</ul>', pos_ins) + 5
    nav_tail = t[pos_ins:pos_end_ul]
    lang_btn = (
        f'<li class="nav-item ms-lg-2 my-1 my-lg-0">'
        f'<a class="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" '
        f'href="{URL_KO}"><i class="bi bi-globe"></i> 한국어</a></li>'
        f'\n                </ul>'
    )
    t = replace_once(t, nav_tail, nav_tail[:-5] + lang_btn, "nav lang toggle jobs en")

    # 4. Page jobs visible, home hidden
    t = replace_once(t, '<section id="page-home" class="page-section">',
                     '<section id="page-home" class="page-section d-none">', "page-home hide")
    t = replace_once(t, '<section id="page-jobs" class="page-section d-none">',
                     '<section id="page-jobs" class="page-section">', "page-jobs show")

    t = replace_once(t, '<h1 class="mb-3 fw-bold fs-5">K-POP 아이돌 SNS 팔로워 순위</h1>',
                     '<h2 class="mb-3 fw-bold fs-5">K-POP 아이돌 SNS 팔로워 순위</h2>', "home h1 demote")
    t = replace_once(t, '<h2 class="mb-3 fw-bold fs-5">엔터테인먼트 채용정보</h2>',
                     f'<h1 class="mb-3 fw-bold fs-5">K-POP & Entertainment Career Opportunities ({len(jobs)} Openings)</h1>',
                     "jobs h1 en")

    # SSR Baked Table Injection
    t = replace_once(t, '<div id="jobsLoading" class="text-center py-5">',
                     '<div id="jobsLoading" class="text-center py-5 d-none">', "jobsLoading hide")
    t = replace_once(t, '<div id="jobsContainer" class="row g-3" style="display: none;">',
                     '<div id="jobsContainer" class="row g-3">' + build_table_en(jobs), "jobsContainer inject")

    # Mobile nav
    t = replace_once(t, '<a href="/ranking" class="mobile-nav-item active" data-page="home"',
                     '<a href="/ranking" class="mobile-nav-item" data-page="home"', "mobile-nav home inactive")
    t = replace_once(t, '<a href="/jobs" class="mobile-nav-item" data-page="jobs"',
                     '<a href="/jobs" class="mobile-nav-item active" data-page="jobs"', "mobile-nav jobs active")

    # 5. Base Shell Localization (공통 모달, 속성, 카테고리 완전 영문화)
    t = localize_shell_to_en(t, noscript_mode="strip")

    out_dir = ROOT / "en" / "jobs"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "index.html"
    t = localize_shell_to_en(t, noscript_mode="strip")
    out_file.write_text(t, encoding="utf-8")
    print(f"✅ Generated EN jobs page: {out_file.relative_to(ROOT)} ({out_file.stat().st_size:,} bytes, {len(jobs)} openings)")

def patch_ko_jobs_hreflang():
    ko_file = ROOT / "jobs" / "index.html"
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
        text = localize_shell_to_en(text, noscript_mode="strip")
        ko_file.write_text(text, encoding="utf-8")
        print("✅ Patched KO jobs page with English toggle and hreflang")

if __name__ == "__main__":
    generate_en_jobs()
    patch_ko_jobs_hreflang()