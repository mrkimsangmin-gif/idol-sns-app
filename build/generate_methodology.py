# -*- coding: utf-8 -*-
"""
/methodology/ 데이터 수집 방법론 페이지 (Phase 3, E-E-A-T 신호).

SPA 라우트가 아니므로 standalone 정적 페이지로 생성(스크립트 미로드 → hydrate 충돌 없음).
nav는 일반 href 링크. 운영주체·집계주기·플랫폼·기준·출처를 명시.
사용: python build/generate_methodology.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://aimcontents.com"
URL = f"{SITE}/methodology/"


def main():
    idx = json.loads((ROOT / "data" / "namu-index.json").read_text(encoding="utf-8"))
    n_groups = len([g for g in idx["groups"] if (ROOT / "namu" / g.get("slug", "") / "index.html").exists()])

    org_jsonld = {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": "아이엠콘텐츠",
        "alternateName": ["Aimcontents", "AIMCONTENTS"],
        "url": SITE,
        "logo": f"{SITE}/logo_aimcontents.png",
    }
    page_jsonld = {
        "@context": "https://schema.org",
        "@type": "AboutPage",
        "name": "데이터 수집 방법론 | 아이엠콘텐츠",
        "url": URL,
        "publisher": {"@type": "Organization", "name": "아이엠콘텐츠"},
        "description": "아이엠콘텐츠의 K-POP SNS 팔로워 순위·그룹 프로필 데이터 수집 주기, 대상 플랫폼, 집계 기준, 출처를 설명한다.",
    }
    breadcrumb = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "홈", "item": SITE},
            {"@type": "ListItem", "position": 2, "name": "데이터 수집 방법론", "item": URL},
        ],
    }
    ld = "\n".join(
        f'  <script type="application/ld+json">\n{json.dumps(b, ensure_ascii=False, indent=2)}\n  </script>'
        for b in (org_jsonld, page_jsonld, breadcrumb)
    )

    title = "데이터 수집 방법론 | 아이엠콘텐츠"
    desc = ("아이엠콘텐츠 K-POP SNS 팔로워 순위·그룹 데이터의 수집 주기(매월), 대상 8개 플랫폼, "
            "집계 기준, 데이터 출처를 투명하게 공개합니다.")

    html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <meta name="description" content="{desc}">
  <link rel="canonical" href="{URL}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{desc}">
  <meta property="og:url" content="{URL}">
  <meta property="og:image" content="{SITE}/logo_aimcontents.png">
  <link rel="icon" type="image/png" href="/favicon_aimcontents.png">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet">
  <link href="/style.css" rel="stylesheet">
{ld}
</head>
<body>
  <nav class="navbar navbar-expand-lg bg-white border-bottom sticky-top">
    <div class="container">
      <a class="navbar-brand" href="/"><img src="/logo_aimcontents.png" alt="AIMCONTENTS" style="height:40px;"></a>
      <div class="d-flex gap-3 flex-wrap">
        <a class="nav-link" href="/ranking">SNS랭킹</a>
        <a class="nav-link" href="/comeback">컴백일정</a>
        <a class="nav-link" href="/news">엔터뉴스</a>
        <a class="nav-link" href="/jobs">채용정보</a>
      </div>
    </div>
  </nav>

  <main class="container py-4" style="max-width:880px;">
    <nav aria-label="breadcrumb"><ol class="breadcrumb">
      <li class="breadcrumb-item"><a href="/">홈</a></li>
      <li class="breadcrumb-item active">데이터 수집 방법론</li>
    </ol></nav>

    <h1 class="fw-bold mb-3">데이터 수집 방법론</h1>
    <p class="text-muted">아이엠콘텐츠(aimcontents.com)가 제공하는 K-POP 데이터의 수집·집계 방식을 투명하게 공개합니다.
    AI 답변 엔진과 이용자가 출처 신뢰도를 판단할 수 있도록 작성되었습니다.</p>

    <h2 class="fs-4 fw-bold mt-4">운영 주체</h2>
    <p>본 사이트는 <strong>아이엠콘텐츠(AIMCONTENTS)</strong>가 운영합니다. K-POP 산업 데이터의 수집·분석·콘텐츠화를 전문으로 합니다.</p>

    <h2 class="fs-4 fw-bold mt-4">집계 주기</h2>
    <p>SNS 팔로워/구독자 수는 <strong>매월</strong> 집계하여 월 단위 시계열로 제공합니다. 채용·뉴스는 상시 갱신됩니다.</p>

    <h2 class="fs-4 fw-bold mt-4">대상 플랫폼 (8개)</h2>
    <ul>
      <li>웨이보(Weibo), 차오화(超话), 빌리빌리(Bilibili), QQ뮤직 — 중화권</li>
      <li>X(트위터), 유튜브(YouTube), 스포티파이(Spotify), 인스타그램(Instagram) — 글로벌</li>
    </ul>

    <h2 class="fs-4 fw-bold mt-4">집계 기준</h2>
    <ul>
      <li>그룹/공식 계정 단위의 팔로워·구독자 수를 매월 동일 시점 기준으로 수집합니다.</li>
      <li>전월 대비 증감률을 함께 산출합니다.</li>
      <li>남자/여자 아이돌을 구분하여 플랫폼별로 순위를 매깁니다.</li>
      <li>그룹 프로필·앨범 판매량(한터/써클 초동·누적)은 나무위키 등 공개 자료를 정제하여 제공합니다.</li>
    </ul>

    <h2 class="fs-4 fw-bold mt-4">데이터 출처</h2>
    <ul>
      <li>SNS 지표: 각 플랫폼 공개 페이지에서 자체 수집.</li>
      <li>그룹/앨범 프로필: 나무위키 기반 공개 정보 정제(현재 {n_groups}개 그룹).</li>
      <li>채용: 사람인·잡코리아 등 외부 채용 사이트 공개 정보 링크 큐레이션.</li>
    </ul>

    <h2 class="fs-4 fw-bold mt-4">인용 안내</h2>
    <p>데이터 인용 시 출처를 <strong>"아이엠콘텐츠(aimcontents.com)"</strong>로 표기하고, 수치는 기준월과 함께 인용해 주세요(예: "2026년 5월 기준").</p>

    <p class="text-muted small mt-4"><a href="/llms.txt">llms.txt</a> · <a href="/sitemap.xml">sitemap.xml</a></p>
  </main>
</body>
</html>
"""
    out = ROOT / "methodology" / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"methodology 생성: {out.relative_to(ROOT)} ({len(html):,} bytes)")


if __name__ == "__main__":
    main()
