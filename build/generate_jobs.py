# -*- coding: utf-8 -*-
"""
/jobs/ 정적 채용 페이지 (Phase 3) — JobPosting 구조화 데이터 + baked 목록.

- index.html 셸 복제 → 사람: SPA가 /jobs 라우팅해 채용 렌더(getPageIdFromPath 끝슬래시 정규화 완료)
- 봇: #jobsContainer 에 baked 채용 표 + JobPosting JSON-LD(@graph)
데이터: data/jobs.json {company, position, category, career, location, deadline, url, source}

주의: 이 사이트는 외부(사람인/잡코리아 등) 공고로 연결하는 '큐레이션'이라, 각 JobPosting의
      url(directApply 대상)은 출처로 연결한다. datePosted/상세 description은 원천에만 있어
      생략(허위 기입 금지) → Google for Jobs 완전 적격은 아니나 AI 엔진엔 구조화 정보 제공.
"""
import json
import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHELL = ROOT / "index.html"
SITE = "https://aimcontents.com"
URL = f"{SITE}/jobs/"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def esc(s):
    return html.escape(str(s if s is not None else ""), quote=True)


def replace_once(text, old, new, label):
    if text.count(old) != 1:
        raise RuntimeError(f"[앵커 불일치] '{label}' = {text.count(old)}")
    return text.replace(old, new)


def strip_once(text, pattern, label):
    new, n = re.subn(pattern, "", text, flags=re.DOTALL)
    if n != 1:
        raise RuntimeError(f"[strip 불일치] '{label}' = {n}")
    return new


def build_jobposting(job):
    jp = {
        "@type": "JobPosting",
        "title": job.get("position", ""),
        "hiringOrganization": {"@type": "Organization", "name": job.get("company", "")},
        "industry": "K-POP/엔터테인먼트",
        "url": job.get("url", ""),
        "directApply": False,
        "description": f"{job.get('company','')}의 {job.get('position','')} 채용 공고"
                       + (f" ({job.get('career','')})" if job.get("career") else "")
                       + f". 근무지: {job.get('location','')}. 자세한 내용은 출처({job.get('source','')})에서 확인하세요.",
    }
    if job.get("location"):
        jp["jobLocation"] = {
            "@type": "Place",
            "address": {"@type": "PostalAddress", "addressLocality": job["location"], "addressCountry": "KR"},
        }
    if DATE_RE.match(job.get("deadline", "") or ""):
        jp["validThrough"] = job["deadline"]
    return jp


def build_table(jobs):
    rows = []
    for j in jobs:
        comp = esc(j.get("company", ""))
        pos = esc(j.get("position", ""))
        link = j.get("url", "")
        pos_cell = f'<a href="{esc(link)}" target="_blank" rel="noopener">{pos}</a>' if link else pos
        rows.append(
            "<tr>"
            f"<td>{comp}</td><td>{pos_cell}</td>"
            f"<td>{esc(j.get('category',''))}</td>"
            f"<td>{esc(j.get('career',''))}</td>"
            f"<td>{esc(j.get('location',''))}</td>"
            f"<td>{esc(j.get('deadline',''))}</td>"
            f"<td>{esc(j.get('source',''))}</td>"
            "</tr>"
        )
    return (
        '<div class="col-12"><section>'
        '<table class="table table-sm table-hover"><thead><tr>'
        '<th>회사</th><th>포지션</th><th>분야</th><th>경력</th><th>지역</th><th>마감</th><th>출처</th>'
        f'</tr></thead><tbody>{"".join(rows)}</tbody></table>'
        '<p class="text-muted small">본 채용 정보는 사람인·잡코리아 등 외부 채용 사이트의 공개 정보를 모은 링크 큐레이션입니다.</p>'
        "</section></div>"
    )


def main():
    jobs = json.loads((ROOT / "data" / "jobs.json").read_text(encoding="utf-8"))["data"]
    title = f"K-POP·엔터테인먼트 채용정보 ({len(jobs)}건) | 아이엠콘텐츠"
    desc = (f"K-POP·엔터테인먼트 산업 채용 {len(jobs)}건을 한곳에. 기획사·레이블의 마케팅·영상·"
            f"매니지먼트·A&R 등 분야별 채용 공고를 사람인·잡코리아 등에서 큐레이션합니다.")

    graph = {"@context": "https://schema.org", "@graph": [build_jobposting(j) for j in jobs]}
    collection = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": "K-POP·엔터테인먼트 채용정보",
        "url": URL,
        "about": "K-POP/엔터테인먼트 산업 채용 공고 큐레이션",
        "publisher": {"@type": "Organization", "name": "아이엠콘텐츠"},
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
    # head 메타
    t = replace_once(
        t,
        "<title>아이돌 SNS 팔로워 순위 - 웨이보·빌리빌리·유튜브·스포티파이·인스타그램 | 아이엠콘텐츠</title>",
        f"<title>{esc(title)}</title>", "title")
    t = replace_once(
        t,
        ('content="K-POP 아이돌 SNS 팔로워 순위, 컴백 일정, 실시간 엔터테인먼트 뉴스를 한눈에 확인하세요. '
         '웨이보, 빌리빌리, 유튜브, 스포티파이 등 주요 SNS 플랫폼의 최신 순위 정보를 제공합니다.">'),
        f'content="{esc(desc)}">', "meta description")
    t = replace_once(t, '<link rel="canonical" href="https://aimcontents.com/">',
                     f'<link rel="canonical" href="{URL}">', "canonical")
    t = replace_once(t, '<meta property="og:url" content="https://aimcontents.com/">',
                     f'<meta property="og:url" content="{URL}">', "og:url")
    t = replace_once(t, '<meta name="twitter:url" content="https://aimcontents.com/">',
                     f'<meta name="twitter:url" content="{URL}">', "twitter:url")
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
    # JSON-LD
    t = replace_once(t, "</head>", jsonld + "\n</head>", "</head>")
    # 페이지 가시화: home 숨김, jobs 표시
    t = replace_once(t, '<section id="page-home" class="page-section">',
                     '<section id="page-home" class="page-section d-none">', "page-home hide")
    t = replace_once(t, '<section id="page-jobs" class="page-section d-none">',
                     '<section id="page-jobs" class="page-section">', "page-jobs show")
    # 숨긴 page-home의 H1을 H2로 강등 → jobs 엔티티 H1만 남김
    t = replace_once(t, '<h1 class="mb-3 fw-bold fs-5">K-POP 아이돌 SNS 팔로워 순위</h1>',
                     '<h2 class="mb-3 fw-bold fs-5">K-POP 아이돌 SNS 팔로워 순위</h2>', "home h1 demote")
    # jobs H2 → H1 (이 페이지의 주제)
    t = replace_once(t, '<h2 class="mb-3 fw-bold fs-5">엔터테인먼트 채용정보</h2>',
                     f'<h1 class="mb-3 fw-bold fs-5">K-POP·엔터테인먼트 채용정보 ({len(jobs)}건)</h1>',
                     "jobs h1")
    # 로딩 숨김 + 컨테이너에 baked 주입(표시)
    t = replace_once(t, '<div id="jobsLoading" class="text-center py-5">',
                     '<div id="jobsLoading" class="text-center py-5 d-none">', "jobsLoading hide")
    t = replace_once(t, '<div id="jobsContainer" class="row g-3" style="display: none;">',
                     '<div id="jobsContainer" class="row g-3">' + build_table(jobs), "jobsContainer inject")

    out = ROOT / "jobs" / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(t, encoding="utf-8")
    print(f"jobs 생성: {out.relative_to(ROOT)} ({len(t):,} bytes, {len(jobs)}건)")


if __name__ == "__main__":
    main()
