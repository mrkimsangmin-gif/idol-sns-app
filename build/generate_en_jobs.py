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

# Load i18n dictionary if exists
JOBS_I18N_FILE = ROOT / "data" / "jobs-i18n-en.json"
JOBS_I18N = {}
if JOBS_I18N_FILE.exists():
    try:
        JOBS_I18N = json.loads(JOBS_I18N_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        print("Warning: failed to load jobs-i18n-en.json:", e)

COMPANY_EN_MAP = JOBS_I18N.get("companies", {})
LOCATION_EN_MAP = JOBS_I18N.get("locations", {})
CAREER_EN_MAP = JOBS_I18N.get("careers", {})
POSITION_EN_MAP = JOBS_I18N.get("positions", {})

def esc(s):
    return html.escape(str(s if s is not None else ""), quote=True)

def replace_once(text, old, new, label):
    if text.count(old) != 1:
        raise RuntimeError(f"[앵커 불일치] '{label}' = {text.count(old)} (1이어야 함)")
    return text.replace(old, new)

def build_jobposting_en(job):
    category_en = JOB_CATEGORY_EN_MAP.get(job.get("category", ""), job.get("category", "Entertainment"))
    raw_career = job.get("career", "")
    career_en = CAREER_EN_MAP.get(raw_career, "Any Experience" if raw_career in ("무관", "경력무관", "") else raw_career)
    comp = COMPANY_EN_MAP.get(job.get("company", ""), job.get("company", ""))
    pos = POSITION_EN_MAP.get(job.get("position", ""), job.get("position", ""))
    loc = LOCATION_EN_MAP.get(job.get("location", ""), job.get("location", "Seoul, KR"))

    jp = {
        "@type": "JobPosting",
        "title": pos,
        "hiringOrganization": {"@type": "Organization", "name": comp},
        "industry": "K-POP / Entertainment",
        "url": job.get("url", ""),
        "directApply": False,
        "description": f"K-POP & Entertainment Career Opportunity: {comp} is hiring for {pos}"
                       + (f" ({career_en})" if career_en else "")
                       + f". Location: {loc}. Please check official source ({job.get('source', '')}) for requirements.",
    }
    if job.get("location"):
        jp["jobLocation"] = {
            "@type": "Place",
            "address": {"@type": "PostalAddress", "addressLocality": loc, "addressCountry": "KR"},
        }
    if DATE_RE.match(job.get("deadline", "")):
        jp["validThrough"] = f"{job['deadline']}T23:59:59+09:00"
    return jp

def build_table_en(jobs):
    rows = []
    for j in jobs:
        comp = esc(COMPANY_EN_MAP.get(j.get("company", ""), j.get("company", "")))
        pos = esc(POSITION_EN_MAP.get(j.get("position", ""), j.get("position", "")))
        link = j.get("url", "")
        pos_cell = f'<a href="{esc(link)}" target="_blank" rel="noopener">{pos}</a>' if link else pos
        cat_en = esc(JOB_CATEGORY_EN_MAP.get(j.get("category", ""), j.get("category", "")))
        career_raw = j.get("career", "")
        career_en = esc(CAREER_EN_MAP.get(career_raw, "Any" if career_raw in ("무관", "경력무관", "") else career_raw))
        loc_en = esc(LOCATION_EN_MAP.get(j.get("location", ""), j.get("location", "")))
        deadline = esc(j.get("deadline", ""))
        if deadline == "상시채용":
            deadline = "Always"

        rows.append(
            "<tr>"
            f"<td>{comp}</td><td>{pos_cell}</td>"
            f"<td>{cat_en}</td>"
            f"<td>{career_en}</td>"
            f"<td>{loc_en}</td>"
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
        f"    {json.dumps(d, ensure_ascii=False, indent=2)}\n"
        f"    </script>"
        for d in (graph, collection)
    )

    t = SHELL.read_text(encoding="utf-8")

    # 1. Title / Meta
    t = replace_once(
        t,
        "<title>아이돌 SNS 팔로워 순위 - 틱톡·유튜브·인스타·웨이보·도우인 | 아이엠콘텐츠</title>",
        f"<title>{esc(title)}</title>", "title")
    t = replace_once(
        t,
        ('content="K-POP 아이돌 틱톡(TikTok)·유튜브·인스타그램·웨이보·빌리빌리·도우인 SNS 순위 및 팔로워 랭킹. '
         '188개 아이돌 그룹의 숏폼 참여율(ER), 컴백 일정, 나무위키 정보를 매주/매월 업데이트합니다.">'),
        f'content="{esc(desc)}">', "meta description")

    # 2. Canonical & Hreflang
    canonical_block = (
        f'<link rel="canonical" href="{URL_EN}">\n'
        f'    <link rel="alternate" hreflang="ko" href="{URL_KO}">\n'
        f'    <link rel="alternate" hreflang="en" href="{URL_EN}">\n'
        f'    <link rel="alternate" hreflang="x-default" href="{URL_KO}">'
    )
    t = replace_once(
        t,
        '<link rel="canonical" href="https://aimcontents.com/">',
        canonical_block,
        "canonical",
    )

    # 3. Open Graph
    t = replace_once(
        t,
        '<meta property="og:url" content="https://aimcontents.com/">',
        f'<meta property="og:url" content="{URL_EN}">',
        "og:url",
    )
    t = replace_once(
        t,
        '<meta property="og:title" content="K-POP 아이돌 SNS·틱톡·유튜브 팔로워 순위 | 아이엠콘텐츠">',
        f'<meta property="og:title" content="{esc(title)}">',
        "og:title",
    )
    t = replace_once(
        t,
        '<meta property="og:description" content="K-POP 아이돌 틱톡(TikTok), 유튜브, 인스타그램, 웨이보, 도우인 SNS 팔로워 순위와 컴백 일정, 188개 그룹 상세 정보.">',
        f'<meta property="og:description" content="{esc(desc)}">',
        "og:description",
    )
    t = replace_once(
        t,
        '<meta name="twitter:url" content="https://aimcontents.com/">',
        f'<meta name="twitter:url" content="{URL_EN}">',
        "twitter:url",
    )
    t = replace_once(
        t,
        '<meta name="twitter:title" content="K-POP 아이돌 SNS·틱톡·유튜브 팔로워 순위 | 아이엠콘텐츠">',
        f'<meta name="twitter:title" content="{esc(title)}">',
        "twitter:title",
    )
    t = replace_once(
        t,
        '<meta name="twitter:description" content="K-POP 아이돌 틱톡(TikTok), 유튜브, 인스타그램, 웨이보, 도우인 SNS 팔로워 순위와 컴백 일정, 188개 그룹 상세 정보.">',
        f'<meta name="twitter:description" content="{esc(desc)}">',
        "twitter:description",
    )

    # 4. JSON-LD 주입
    t = replace_once(t, "</head>", f"{jsonld}\n</head>", "jsonld")

    # 5. 페이지 가시화: home 숨김, jobs 표시
    t = replace_once(t, '<section id="page-home" class="page-section">',
                     '<section id="page-home" class="page-section d-none">', "page-home hide")
    t = replace_once(t, '<section id="page-jobs" class="page-section d-none">',
                     '<section id="page-jobs" class="page-section">', "page-jobs show")

    # 6. 헤더 H1 / H2
    t = replace_once(t, '<h1 class="mb-3 fw-bold fs-5">K-POP 아이돌 SNS 팔로워 순위</h1>',
                     '<h2 class="mb-3 fw-bold fs-5">K-POP 아이돌 SNS 팔로워 순위</h2>', "home h1 demote")
    t = replace_once(t, '<h2 class="mb-3 fw-bold fs-5">엔터테인먼트 채용정보</h2>',
                     f'<h1 class="mb-3 fw-bold fs-5">K-POP & Entertainment Career Opportunities ({len(jobs)} Openings)</h1>',
                     "jobs h1")

    # 7. SSR 테이블 주입
    t = replace_once(t, '<div id="jobsLoading" class="text-center py-5">',
                     '<div id="jobsLoading" class="text-center py-5 d-none">', "jobsLoading hide")
    t = replace_once(t, '<div id="jobsContainer" class="row g-3" style="display: none;">',
                     f'<div id="jobsContainer" class="row g-3">{build_table_en(jobs)}', "jobsContainer inject")

    # 8. 카테고리 탭 영문화
    cat_tabs = (
        '<div id="jobsCategoryTabs" class="jobs-category-tabs mb-3">\n'
        '                <button class="jobs-category-tab active" data-category="all" onclick="filterJobsByCategory(\'all\')">\n'
        '                    All\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="마케팅" onclick="filterJobsByCategory(\'마케팅\')">\n'
        '                    Marketing\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="영상" onclick="filterJobsByCategory(\'영상\')">\n'
        '                    Video / Media\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="신인개발" onclick="filterJobsByCategory(\'신인개발\')">\n'
        '                    A&R / Casting\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="매니지먼트" onclick="filterJobsByCategory(\'매니지먼트\')">\n'
        '                    Management\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="프로듀싱" onclick="filterJobsByCategory(\'프로듀싱\')">\n'
        '                    Music Production\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="디자인" onclick="filterJobsByCategory(\'디자인\')">\n'
        '                    Creative Design\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="IT" onclick="filterJobsByCategory(\'IT\')">\n'
        '                    IT & Tech\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="영업" onclick="filterJobsByCategory(\'영업\')">\n'
        '                    Business Sales\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="경영지원" onclick="filterJobsByCategory(\'경영지원\')">\n'
        '                    Operations & HR\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="해외사업" onclick="filterJobsByCategory(\'해외사업\')">\n'
        '                    Global Business\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="기타" onclick="filterJobsByCategory(\'기타\')">\n'
        '                    Others\n'
        '                </button>\n'
        '            </div>'
    )
    t = re.sub(
        r'<div id="jobsCategoryTabs" class="jobs-category-tabs mb-3">.*?</div>\s*</div>',
        cat_tabs + '\n        </div>',
        t,
        flags=re.DOTALL
    )

    # 9. 모바일 하단 네비 active 탭을 jobs로 전환
    t = replace_once(
        t,
        '<a href="/ranking" class="mobile-nav-item active" data-page="home"',
        '<a href="/ranking" class="mobile-nav-item" data-page="home"',
        "mobile-nav home inactive",
    )
    t = replace_once(
        t,
        '<a href="/jobs" class="mobile-nav-item" data-page="jobs"',
        '<a href="/jobs" class="mobile-nav-item active" data-page="jobs"',
        "mobile-nav jobs active",
    )

    # 10. 공통 쉘 완전 영문화 (GNB, 모달, 언어선택기 등)
    t = localize_shell_to_en(t, noscript_mode="strip")

    out = ROOT / "en" / "jobs" / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(t, encoding="utf-8")
    print(f"✅ Generated EN jobs page: {out.relative_to(ROOT)} ({len(t):,} bytes, {len(jobs)} jobs)")

if __name__ == "__main__":
    generate_en_jobs()
