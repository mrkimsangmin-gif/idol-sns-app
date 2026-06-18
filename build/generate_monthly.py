# -*- coding: utf-8 -*-
"""
/monthly/<YYYY-MM>/<gender>/ 월간 흥행 차트("이달의아이돌") 페이지 생성.

기존 /ranking 의 단일-플랫폼 팔로워 순위와 달리, 5개 신호(음원·SNS·글로벌·음악방송·검색)를
통합한 "흥행 점수" 기반 차트다. methodology 페이지처럼 SPA 라우트가 아닌 standalone 정적 페이지로
생성한다(스크립트 미로드 → hydrate 충돌 없음). nav는 일반 href 링크.

데이터: data/monthly-<YYYY-MM>.csv
  컬럼: 성별,순위,그룹,흥행점수,A기여,B기여,C기여,D기여,E기여,A,B,C,D,E,플래그

검수 단계(게이트 미통과)에서는 NOINDEX=True → robots noindex + sitemap/네비 미노출.
사용: python build/generate_monthly.py 2026-05
"""
import csv
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://aimcontents.com"

# 발행 게이트(방법론 동결·백테스트·외부검증) 통과 전까지 검수용 → noindex.
# 공개 승인 시 False 로 바꾸고 재생성 + sitemap/네비 연결.
# 2026-06-18 사용자 승인 → 정식 공개 전환(False).
NOINDEX = False

GENDER_KR = {"boys": "남자", "girls": "여자"}      # CSV '성별' 필터용(데이터 키)
# 공식 차트명(2026-06-18 키워드 리서치 확정): 제목 머리는 검색수요 큰 일반명사.
# "차트(687)/걸그룹(430)/보이그룹(163)/순위(100)" 강세 ↔ "흥행/랭킹"=검색량 0 → 흥행은 꼬리로.
GROUP_KR = {"boys": "보이그룹", "girls": "걸그룹"}  # 표기/제목용(SEO)

# 5신호: (코드, 표기명, 색상) — 기여도 분해 스택바/범례 공용
SIGNALS = [
    ("A", "음원", "#e74c3c"),
    ("B", "SNS", "#3498db"),
    ("C", "글로벌", "#2ecc71"),
    ("D", "음악방송", "#9b59b6"),
    ("E", "검색량", "#f39c12"),
]
SIGNAL_DESC = {
    "A": "멜론·유튜브뮤직·스포티파이 국내 음원 성과",
    "B": "7개 SNS 플랫폼 팔로워 순증·증감률",
    "C": "스포티파이 월간 청취자(글로벌)",
    "D": "음악방송 무대 영상 반응(조회·참여)",
    "E": "네이버 검색량 추이",
}


def esc(s):
    return html.escape(str(s if s is not None else ""), quote=True)


def month_kr(m):
    y, mo = m.split("-")
    return f"{y}년 {int(mo)}월"


def load_rows(month, gender_kr):
    """해당 월·성별 행을 순위 오름차순으로 반환."""
    path = ROOT / "data" / f"monthly-{month}.csv"
    with path.open(encoding="utf-8-sig", newline="") as f:
        rows = [r for r in csv.DictReader(f) if r["성별"] == gender_kr]
    rows.sort(key=lambda r: int(r["순위"]))
    return rows


def dominant(row):
    """기여도가 가장 큰 신호 (코드, 표기명, 색상) 반환."""
    best = max(SIGNALS, key=lambda s: float(row[f"{s[0]}기여"] or 0))
    return best


def flag_badge(flag):
    if not flag:
        return ""
    if "신규데뷔" in flag:
        return '<span class="badge bg-info text-dark">신규데뷔</span>'
    if "검색과대" in flag or "verify" in flag:
        return '<span class="badge bg-warning text-dark" title="검색 신호 단독 급등 — 교차검증 대상">검증중</span>'
    return f'<span class="badge bg-secondary">{esc(flag)}</span>'


def contrib_bar(row, max_score):
    """막대 길이 = 흥행점수 비례(1위=최대), 막대 내부 세그먼트 = 신호별 기여 구성."""
    score = float(row["흥행점수"])
    pct = max(3.0, score / max_score * 100.0)  # 1위=100%, 최소 가시폭 보장
    segs = []
    for code, name, color in SIGNALS:
        v = float(row[f"{code}기여"] or 0)
        if v <= 0:
            continue
        segs.append(
            f'<div style="flex:{v:.3f};background:{color}" '
            f'title="{name} 기여 {v:.1f}"></div>'
        )
    inner = "".join(segs) or '<div style="flex:1;background:#dee2e6"></div>'
    return f'<div class="cbar-track"><div class="cbar" style="width:{pct:.1f}%">{inner}</div></div>'


def build_cards(rows, max_score):
    """/ranking 의 .idol-card 패턴을 따른 카드 리스트(순위뱃지+그룹/구성+우측 점수)."""
    cards = []
    for r in rows:
        rank = int(r["순위"])
        score = float(r["흥행점수"])
        _, dom_name, dom_color = dominant(r)
        rb_color = {1: "#f59e0b", 2: "#94a3b8", 3: "#b45309"}.get(rank, "")  # 금/은/동
        rb_style = f' style="color:{rb_color}"' if rb_color else ""
        cards.append(
            '<div class="col-12">'
            '<div class="idol-card">'
            f'<div class="rank-badge"{rb_style}>{rank}</div>'
            '<div class="flex-grow-1 ps-2" style="min-width:0">'
            f'<h5 class="m-0 fw-bold">{esc(r["그룹"])}</h5>'
            '<div class="d-flex align-items-center gap-2 mt-1 flex-wrap">'
            f'<span class="badge sig-badge flex-shrink-0" style="background:{dom_color}">{dom_name}</span>'
            f"{contrib_bar(r, max_score)}"
            "</div></div>"
            '<div class="text-end ps-2 flex-shrink-0">'
            f'<div class="fw-bold fs-4">{score:.1f}</div>'
            '<small class="text-muted" style="font-size:0.72rem">흥행점수</small>'
            "</div></div></div>"
        )
    return "".join(cards)


def legend_html():
    items = "".join(
        f'<span class="me-3 text-nowrap"><span class="lg-dot" style="background:{c}"></span>'
        f'<strong>{n}</strong> <span class="text-muted small">{SIGNAL_DESC[code]}</span></span>'
        for code, n, c in SIGNALS
    )
    return f'<div class="d-flex flex-wrap gap-1 small mb-3">{items}</div>'


def build_jsonld(rows, url, month, group_kr):
    items = [
        {"@type": "ListItem", "position": int(r["순위"]),
         "item": {"@type": "MusicGroup", "name": r["그룹"]}}
        for r in rows[:50]
    ]
    item_list = {
        "@context": "https://schema.org", "@type": "ItemList",
        "name": f"{month_kr(month)} K-POP {group_kr} 순위 — 월간 흥행 차트",
        "url": url, "numberOfItems": len(items), "itemListElement": items,
    }
    breadcrumb = {
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "홈", "item": SITE},
            {"@type": "ListItem", "position": 2, "name": "월간차트", "item": f"{SITE}/monthly/{month}/"},
            {"@type": "ListItem", "position": 3,
             "name": f"{month_kr(month)} {group_kr}", "item": url},
        ],
    }
    return "\n".join(
        f'  <script type="application/ld+json">\n{json.dumps(b, ensure_ascii=False, indent=2)}\n  </script>'
        for b in (item_list, breadcrumb)
    )


PAGE_CSS = """
  <style>
    .cbar-track{flex-grow:1;min-width:90px;max-width:380px;height:14px;background:#f1f3f5;border-radius:4px;overflow:hidden}
    .cbar{display:flex;height:100%;border-radius:4px;overflow:hidden;min-width:6px}
    .cbar>div{min-width:2px}
    .rank-badge{flex-shrink:0}
    .sig-badge{width:68px;text-align:center;padding-left:4px;padding-right:4px}
    .lg-dot{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:4px;vertical-align:middle}
    .gender-toggle .btn{min-width:96px}
    .review-banner{background:#fff3cd;border:1px solid #ffe69c;border-radius:6px}
  </style>"""


def review_banner():
    if not NOINDEX:
        return ""
    return (
        '<div class="review-banner p-2 px-3 mb-3 small">'
        "🔒 <strong>검수용(비공개)</strong> — 방법론 동결·백테스트·외부검증 게이트 통과 전 내부 검토 페이지입니다. "
        "검색엔진 비노출(noindex), 정식 공개 아님.</div>"
    )


def build_page(month, gender_slug):
    gender_kr = GENDER_KR[gender_slug]
    group_kr = GROUP_KR[gender_slug]
    rows = load_rows(month, gender_kr)
    if not rows:
        raise RuntimeError(f"데이터 없음: {gender_kr}/{month}")
    max_score = max(float(r["흥행점수"]) for r in rows)  # 막대 길이 정규화 기준(1위)
    top = rows[0]
    url = f"{SITE}/monthly/{month}/{gender_slug}/"
    mk = month_kr(month)

    title = f"{mk} K-POP {group_kr} 순위 — 월간 흥행 차트 | 아이엠콘텐츠"
    desc = (
        f"{mk} K-POP {group_kr} 순위(월간 흥행 차트). 음원·SNS·글로벌·음악방송·검색 "
        f"5개 신호 통합 점수. 1위 {top['그룹']}(흥행점수 {float(top['흥행점수']):.1f}) 등 {len(rows)}팀."
    )
    robots = '<meta name="robots" content="noindex,nofollow">\n  ' if NOINDEX else ""

    toggle = (
        '<div class="btn-group gender-toggle mb-3" role="group">'
        f'<a href="/monthly/{month}/boys/" class="btn btn-{"dark" if gender_slug=="boys" else "outline-dark"}">보이그룹</a>'
        f'<a href="/monthly/{month}/girls/" class="btn btn-{"dark" if gender_slug=="girls" else "outline-dark"}">걸그룹</a>'
        "</div>"
    )

    page = f"""<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  {robots}<title>{esc(title)}</title>
  <meta name="description" content="{esc(desc)}">
  <link rel="canonical" href="{url}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="{esc(title)}">
  <meta property="og:description" content="{esc(desc)}">
  <meta property="og:url" content="{url}">
  <meta property="og:image" content="{SITE}/logo_aimcontents.png">
  <link rel="icon" type="image/png" href="/favicon_aimcontents.png">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet">
  <link href="/style.css" rel="stylesheet">{PAGE_CSS}
{build_jsonld(rows, url, month, group_kr)}
</head>
<body>
  <nav class="navbar navbar-expand-lg bg-white border-bottom sticky-top">
    <div class="container">
      <a class="navbar-brand" href="/"><img src="/logo_aimcontents.png" alt="AIMCONTENTS" style="height:40px;"></a>
      <div class="d-flex gap-3 flex-wrap">
        <a class="nav-link" href="/ranking">SNS랭킹</a>
        <a class="nav-link fw-bold" href="/monthly/{month}/boys/">월간차트</a>
        <a class="nav-link" href="/comeback">컴백일정</a>
        <a class="nav-link" href="/news">엔터뉴스</a>
        <a class="nav-link" href="/methodology">방법론</a>
      </div>
    </div>
  </nav>

  <main class="container py-4" style="max-width:920px;">
    <nav aria-label="breadcrumb"><ol class="breadcrumb">
      <li class="breadcrumb-item"><a href="/">홈</a></li>
      <li class="breadcrumb-item">월간차트</li>
      <li class="breadcrumb-item active">{esc(mk)} {esc(group_kr)}</li>
    </ol></nav>

    {review_banner()}
    <h1 class="fw-bold mb-1">{esc(mk)} K-POP {esc(group_kr)} 순위</h1>
    <p class="text-muted mb-1"><strong>월간 흥행 차트</strong> · 음원·SNS·글로벌·음악방송·검색 5개 신호 통합 점수 기준 전체 순위입니다.
    각 카드의 막대는 <strong>길이=흥행점수 크기</strong>(1위 기준 100%), <strong>색=신호별 기여 구성</strong>을 나타냅니다.</p>

    {toggle}
    {legend_html()}

    <section>
      <h2 class="fs-5 fw-bold mb-3">{esc(mk)} {esc(group_kr)} 흥행 차트 (전체 {len(rows)}팀)</h2>
      <div class="row g-3">{build_cards(rows, max_score)}</div>
      <p class="text-muted small mt-3">출처: 아이엠콘텐츠(aimcontents.com) · {esc(mk)} 기준 · 전량 자동 집계.
      방법론은 <a href="/methodology">데이터 수집 방법론</a> 참고.</p>
    </section>
  </main>
</body>
</html>
"""
    out = ROOT / "monthly" / month / gender_slug / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding="utf-8")
    return out, len(rows)


def build_landing(month):
    """/monthly/<month>/ — 성별 선택 랜딩(남자 차트로 기본 안내)."""
    mk = month_kr(month)
    url = f"{SITE}/monthly/{month}/"
    robots = '<meta name="robots" content="noindex,nofollow">\n  ' if NOINDEX else ""
    title = f"{mk} 월간 K-POP 아이돌 순위 — 걸그룹·보이그룹 흥행 차트 | 아이엠콘텐츠"
    desc = f"{mk} 월간 K-POP 아이돌 순위(걸그룹·보이그룹). 5개 신호 통합 흥행 점수 기반 차트."
    page = f"""<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  {robots}<title>{esc(title)}</title>
  <meta name="description" content="{esc(desc)}">
  <link rel="canonical" href="{url}">
  <link rel="icon" type="image/png" href="/favicon_aimcontents.png">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="/style.css" rel="stylesheet">{PAGE_CSS}
</head>
<body>
  <nav class="navbar navbar-expand-lg bg-white border-bottom sticky-top">
    <div class="container">
      <a class="navbar-brand" href="/"><img src="/logo_aimcontents.png" alt="AIMCONTENTS" style="height:40px;"></a>
      <div class="d-flex gap-3 flex-wrap">
        <a class="nav-link" href="/ranking">SNS랭킹</a>
        <a class="nav-link fw-bold" href="/monthly/{month}/boys/">월간차트</a>
        <a class="nav-link" href="/comeback">컴백일정</a>
        <a class="nav-link" href="/methodology">방법론</a>
      </div>
    </div>
  </nav>
  <main class="container py-5 text-center" style="max-width:680px;">
    {review_banner()}
    <h1 class="fw-bold mb-2">{esc(mk)} 월간 K-POP 아이돌 순위</h1>
    <p class="text-muted mb-4">걸그룹·보이그룹 흥행 차트 · 음원·SNS·글로벌·음악방송·검색 5개 신호를 통합한 흥행 점수 기반.</p>
    <div class="d-flex justify-content-center gap-3">
      <a href="/monthly/{month}/boys/" class="btn btn-dark btn-lg px-4">보이그룹 순위</a>
      <a href="/monthly/{month}/girls/" class="btn btn-outline-dark btn-lg px-4">걸그룹 순위</a>
    </div>
  </main>
</body>
</html>
"""
    out = ROOT / "monthly" / month / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding="utf-8")
    return out


def main(month):
    landing = build_landing(month)
    print(f"landing 생성: {landing.relative_to(ROOT)} ({landing.stat().st_size:,} bytes)")
    for g in ("boys", "girls"):
        out, n = build_page(month, g)
        print(f"{g} 생성: {out.relative_to(ROOT)} ({out.stat().st_size:,} bytes, {n}팀)")
    print(f"NOINDEX={NOINDEX} (검수용)" if NOINDEX else "공개 모드")


if __name__ == "__main__":
    import sys
    main(sys.argv[1] if len(sys.argv) > 1 else "2026-05")
