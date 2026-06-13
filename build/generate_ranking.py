# -*- coding: utf-8 -*-
"""
월별 영구 랭킹 페이지 생성 (Phase 2)

URL: /ranking/<YYYY-MM>/<sns>-<gender>/   예: /ranking/2026-05/weibo-boys/
- 봇: baked Top N 표 + Q&A + JSON-LD(ItemList/Dataset/BreadcrumbList)
- 사람: script.js가 URL(월·플랫폼·성별)을 파싱해 동일 랭킹으로 SPA hydrate
        (parseUrlParams + init 블록에 boys/girls 패턴 추가 완료)

데이터: data/sns-male.json / sns-female.json
        data[플랫폼] = {months[], records[{name, group, date, count}]}
"""
import json
import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHELL = ROOT / "index.html"
SITE = "https://aimcontents.com"

SNS_SLUG_MAP = {  # slug → 한글(데이터 키)
    "weibo": "웨이보", "bilibili": "빌리빌리", "qqmusic": "QQ뮤직",
    "twitter": "X(트위터)", "youtube": "유튜브", "spotify": "스포티파이",
    "chaohua": "차오화", "instagram": "인스타그램",
}
SNS_DISPLAY = {  # 표기용(영문 보조)
    "웨이보": "웨이보(Weibo)", "빌리빌리": "빌리빌리(Bilibili)", "QQ뮤직": "QQ뮤직",
    "X(트위터)": "X(트위터)", "유튜브": "유튜브(YouTube)", "스포티파이": "스포티파이(Spotify)",
    "차오화": "차오화(超话)", "인스타그램": "인스타그램(Instagram)",
}
GENDER_KR = {"boys": "남자", "girls": "여자"}
GENDER_FILE = {"남자": "sns-male.json", "여자": "sns-female.json"}

_sns_cache = {}


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


def month_kr(m):
    y, mo = m.split("-")
    return f"{y}년 {int(mo)}월"


def load_sns(gender_kr):
    if gender_kr not in _sns_cache:
        path = ROOT / "data" / GENDER_FILE[gender_kr]
        _sns_cache[gender_kr] = json.loads(path.read_text(encoding="utf-8"))
    return _sns_cache[gender_kr]


def ranking(gender_kr, sns_kr, month):
    recs = [r for r in load_sns(gender_kr)["data"][sns_kr]["records"] if r["date"] == month]
    recs.sort(key=lambda r: r.get("count", 0), reverse=True)
    return recs


def available_months(gender_kr, sns_kr):
    return load_sns(gender_kr)["data"][sns_kr]["months"]


# ---------------------------------------------------------------------------
def build_jsonld(top, url, month, sns_kr, gender_kr):
    items = [
        {
            "@type": "ListItem",
            "position": i,
            "item": {
                "@type": "MusicGroup",
                "name": r["name"],
                "interactionStatistic": {
                    "@type": "InteractionCounter",
                    "interactionType": "https://schema.org/FollowAction",
                    "userInteractionCount": r.get("count", 0),
                },
            },
        }
        for i, r in enumerate(top, 1)
    ]
    item_list = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": f"{month_kr(month)} {gender_kr} {sns_kr} 팔로워 순위",
        "url": url,
        "numberOfItems": len(items),
        "itemListElement": items,
    }
    dataset = {
        "@context": "https://schema.org",
        "@type": "Dataset",
        "name": f"{month_kr(month)} K-POP {gender_kr} 아이돌 {sns_kr} 팔로워 순위 데이터",
        "description": f"{month_kr(month)} 기준 K-POP {gender_kr} 아이돌 그룹의 {sns_kr} 팔로워/구독자 수 순위.",
        "url": url,
        "temporalCoverage": month,
        "creator": {"@type": "Organization", "name": "아이엠콘텐츠"},
    }
    breadcrumb = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "홈", "item": SITE},
            {"@type": "ListItem", "position": 2, "name": "SNS랭킹", "item": f"{SITE}/ranking"},
            {"@type": "ListItem", "position": 3,
             "name": f"{month_kr(month)} {gender_kr} {sns_kr}", "item": url},
        ],
    }
    return "\n".join(
        f'    <script type="application/ld+json" data-static="ranking">\n'
        f"{json.dumps(b, ensure_ascii=False, indent=2)}\n    </script>"
        for b in (item_list, dataset, breadcrumb)
    )


def build_qa(top, month, sns_kr, gender_kr):
    qas = [(
        f"{month_kr(month)} {gender_kr} {sns_kr} 팔로워 1위는 누구인가요?",
        f"{month_kr(month)} 기준 K-POP {gender_kr} 아이돌 {sns_kr} 팔로워 1위는 "
        f"{top[0]['name']}({top[0]['group']})으로 {top[0]['count']:,}명입니다.",
    )]
    if len(top) >= 3:
        qas.append((
            f"{month_kr(month)} {gender_kr} {sns_kr} 팔로워 상위 3팀은 어디인가요?",
            f"1위 {top[0]['name']}({top[0]['count']:,}), "
            f"2위 {top[1]['name']}({top[1]['count']:,}), "
            f"3위 {top[2]['name']}({top[2]['count']:,}) 순입니다.",
        ))
    return qas


def build_content(top, month, sns_kr, gender_kr, qas):
    rows = []
    for i, r in enumerate(top, 1):
        rows.append(
            "<tr>"
            f"<td>{i}</td>"
            f"<td>{esc(r['name'])}</td>"
            f"<td>{esc(r.get('group',''))}</td>"
            f"<td style='text-align:right'>{r.get('count',0):,}</td>"
            "</tr>"
        )
    qa_html = "".join(
        f"<dt class='fw-bold mt-2'>{esc(q)}</dt><dd>{esc(a)}</dd>" for q, a in qas
    )
    title_h = f"{month_kr(month)} {gender_kr} {SNS_DISPLAY.get(sns_kr, sns_kr)} 팔로워 순위"
    return (
        '<div class="col-12">'
        f'<section class="mb-4"><h2 class="fs-5 fw-bold">자주 묻는 질문</h2><dl>{qa_html}</dl></section>'
        f'<section><h2 class="fs-5 fw-bold">{esc(title_h)} TOP {len(top)}</h2>'
        '<table class="table table-sm table-hover"><thead><tr>'
        '<th>순위</th><th>이름</th><th>그룹</th><th style="text-align:right">팔로워 수</th>'
        f'</tr></thead><tbody>{"".join(rows)}</tbody></table>'
        '<p class="text-muted small">출처: 아이엠콘텐츠(aimcontents.com) · 매월 집계</p>'
        "</section></div>"
    )


def build_ranking_page(month, sns_slug, gender_slug, topn=50):
    gender_kr = GENDER_KR[gender_slug]
    sns_kr = SNS_SLUG_MAP[sns_slug]
    recs = ranking(gender_kr, sns_kr, month)
    if not recs:
        raise RuntimeError(f"데이터 없음: {gender_kr}/{sns_kr}/{month}")
    top = recs[:topn]
    url = f"{SITE}/ranking/{month}/{sns_slug}-{gender_slug}/"
    title = f"{month_kr(month)} {gender_kr} {SNS_DISPLAY.get(sns_kr, sns_kr)} 팔로워 순위 | 아이엠콘텐츠"
    desc = (
        f"{month_kr(month)} 기준 K-POP {gender_kr} 아이돌 {sns_kr} 팔로워 순위. "
        f"1위 {top[0]['name']} {top[0]['count']:,}명 등 상위 {len(top)}팀. 매월 집계."
    )
    qas = build_qa(top, month, sns_kr, gender_kr)
    jsonld = build_jsonld(top, url, month, sns_kr, gender_kr)

    t = SHELL.read_text(encoding="utf-8")

    # lean: 홈 전용 블록 제거
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

    # JSON-LD 주입
    t = replace_once(t, "</head>", jsonld + "\n</head>", "</head>")

    # 홈 랭킹 H1을 월별 랭킹 H1으로 (이 페이지의 주제 = 그 H1)
    t = replace_once(
        t,
        '<h1 class="mb-3 fw-bold fs-5">K-POP 아이돌 SNS 팔로워 순위</h1>',
        f'<h1 class="mb-3 fw-bold fs-5">{esc(month_kr(month))} {esc(gender_kr)} '
        f'{esc(SNS_DISPLAY.get(sns_kr, sns_kr))} 팔로워 순위</h1>',
        "home ranking h1")

    # 봇용 baked 콘텐츠: #result-area 에 주입 (SPA가 hydrate 시 교체)
    t = replace_once(
        t,
        '<div id="result-area" class="row g-3">',
        '<div id="result-area" class="row g-3">' + build_content(top, month, sns_kr, gender_kr, qas),
        "result-area inject")

    out_dir = ROOT / "ranking" / month / f"{sns_slug}-{gender_slug}"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "index.html"
    out_path.write_text(t, encoding="utf-8")
    return out_path


if __name__ == "__main__":
    import sys
    a = sys.argv[1:]
    if len(a) == 3:
        p = build_ranking_page(a[0], a[1], a[2])
        print(f"생성: {p.relative_to(ROOT)} ({p.stat().st_size:,} bytes)")
    else:
        # 파일럿 기본
        p = build_ranking_page("2026-05", "weibo", "boys")
        print(f"파일럿 생성: {p.relative_to(ROOT)} ({p.stat().st_size:,} bytes)")
