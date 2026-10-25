# -*- coding: utf-8 -*-
"""
월간 흥행 차트 영문화 페이지 생성 모듈
- 대상: /en/monthly/<YYYY-MM>/<boys|girls>/index.html 및 /en/monthly/<YYYY-MM>/index.html
- 한국어 페이지에는 [🌐 English] 버튼 및 hreflang 주입
- 영문 페이지에는 [🌐 한국어] 버튼, hreflang, 영문 네비, 5대 신호 영문화 범례, BreadcrumbList, ItemList 주입
"""
import sys
sys.stdout.reconfigure(encoding='utf-8')
import csv
import html
import json
import re
from pathlib import Path


IDOL_NAMES_EN_FILE = Path(__file__).resolve().parent.parent / "data" / "idol-names-en.json"
_IDOL_NAMES_MAP = {}
if IDOL_NAMES_EN_FILE.exists():
    import json
    try:
        _IDOL_NAMES_MAP = json.loads(IDOL_NAMES_EN_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass

def get_en_group_name(ko_name):
    if not ko_name:
        return ""
    en = _IDOL_NAMES_MAP.get(ko_name) or _IDOL_NAMES_MAP.get(ko_name.lower())
    return en if en else ko_name

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://aimcontents.com"

GENDER_EN = {"boys": "Boy Groups", "girls": "Girl Groups"}
GENDER_KR = {"boys": "남자", "girls": "여자"}
GROUP_KR = {"boys": "보이그룹", "girls": "걸그룹"}

SIGNALS_EN = [
    ("A", "Digital Streams", "#e74c3c"),
    ("B", "Social Media", "#3498db"),
    ("C", "Spotify Global", "#2ecc71"),
    ("D", "Music Shows", "#9b59b6"),
    ("E", "Search Volume", "#f39c12"),
]
SIGNAL_DESC_EN = {
    "A": "Melon, YouTube Music & Spotify KR Streams",
    "B": "Net Follower Growth Across 7 SNS Platforms",
    "C": "Spotify Global Monthly Active Listeners",
    "D": "Music Show Stage Performance Views & Engagement",
    "E": "Naver & Web Search Volume Trends",
}

def esc(s):
    return html.escape(str(s if s is not None else ""), quote=True)

def month_en(m):
    y, mo = m.split("-")
    en_months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return f"{en_months[int(mo)]} {y}"

def load_rows(month, gender_kr):
    csv_path = ROOT / "data" / f"monthly-{month}.csv"
    if not csv_path.exists():
        return []
    with csv_path.open(encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return [r for r in reader if r.get("성별") == gender_kr]

def dominant_en(r):
    sigs = [
        ("A", float(r["A기여"])),
        ("B", float(r["B기여"])),
        ("C", float(r["C기여"])),
        ("D", float(r["D기여"])),
        ("E", float(r["E기여"])),
    ]
    sigs.sort(key=lambda x: x[1], reverse=True)
    code = sigs[0][0]
    info = next((s for s in SIGNALS_EN if s[0] == code), None)
    return code, info[1], info[2]

def contrib_bar(r, max_score):
    score = float(r["흥행점수"])
    width_pct = max(3.0, (score / max_score) * 100.0) if max_score > 0 else 0
    contribs = [
        ("A", float(r["A기여"]), "#e74c3c"),
        ("B", float(r["B기여"]), "#3498db"),
        ("C", float(r["C기여"]), "#2ecc71"),
        ("D", float(r["D기여"]), "#9b59b6"),
        ("E", float(r["E기여"]), "#f39c12"),
    ]
    tot = sum(c[1] for c in contribs) or 1.0
    segments = "".join(
        f'<div style="width:{(c[1]/tot)*100.0:.2f}%;background:{c[2]}" title="{c[0]}: {c[1]:.1f}"></div>'
        for c in contribs if c[1] > 0
    )
    return (
        f'<div class="cbar-track"><div class="cbar" style="width:{width_pct:.1f}%">'
        f'{segments}</div></div>'
    )

def build_cards_en(rows, max_score):
    cards = []
    for r in rows:
        rank = int(r["순위"])
        score = float(r["흥행점수"])
        _, dom_name, dom_color = dominant_en(r)
        rb_color = {1: "#f59e0b", 2: "#94a3b8", 3: "#b45309"}.get(rank, "")
        rb_style = f' style="color:{rb_color}"' if rb_color else ""
        cards.append(
            '<div class="col-12">'
            '<div class="idol-card">'
            f'<div class="rank-badge"{rb_style}>{rank}</div>'
            '<div class="flex-grow-1 ps-2" style="min-width:0">'
            f'<h5 class="m-0 fw-bold">{esc(get_en_group_name(r["그룹"]))}</h5>'
            '<div class="d-flex align-items-center gap-2 mt-1 flex-wrap">'
            f'<span class="badge sig-badge flex-shrink-0" style="background:{dom_color}">{dom_name}</span>'
            f"{contrib_bar(r, max_score)}"
            "</div></div>"
            '<div class="text-end ps-2 flex-shrink-0">'
            f'<div class="fw-bold fs-4">{score:.1f}</div>'
            '<small class="text-muted" style="font-size:0.72rem">Hit Score</small>'
            "</div></div></div>"
        )
    return "".join(cards)

def legend_html_en():
    items = "".join(
        f'<span class="me-3 text-nowrap"><span class="lg-dot" style="background:{c}"></span>'
        f'<strong>{n}</strong> <span class="text-muted small">{SIGNAL_DESC_EN[code]}</span></span>'
        for code, n, c in SIGNALS_EN
    )
    return f'<div class="d-flex flex-wrap gap-1 small mb-3">{items}</div>'

def site_nav_en(month):
    items = [
        ("/en/ranking", "SNS Ranking", False),
        (f"/en/monthly/{month}/boys/", "Monthly Chart", True),
        ("/comeback", "Comebacks", False),
        ("/news", "News", False),
        ("/douyin", "China Trends", False),
        ("/jobs", "Jobs", False),
        ("/links", "Links", False),
        ("/vendors", "Vendors", False),
        ("/insight/index_insight.html", "Insights", False),
    ]
    lis = "".join(
        f'<li class="nav-item"><a class="nav-link{" active fw-bold" if act else ""}" '
        f'href="{href}">{label}</a></li>'
        for href, label, act in items
    )
    lang_btn = (
        f'<li class="nav-item ms-lg-2 my-1 my-lg-0">'
        f'<a class="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" '
        f'href="{SITE}/monthly/{month}/boys/"><i class="bi bi-globe"></i> 한국어</a></li>'
    )
    return (
        '<nav class="navbar navbar-expand-lg navbar-light bg-white shadow-sm sticky-top">'
        '<div class="container">'
        '<a class="navbar-brand" href="/en/"><img src="/logo_aimcontents.png" alt="AIMCONTENTS" style="height:36px;"></a>'
        '<button class="navbar-toggler" type="button" data-bs-toggle="collapse" '
        'data-bs-target="#navbarNav" aria-label="Toggle navigation"><span class="navbar-toggler-icon"></span></button>'
        f'<div class="collapse navbar-collapse" id="navbarNav"><ul class="navbar-nav me-auto">{lis}{lang_btn}</ul></div>'
        "</div></nav>"
    )

def build_jsonld_en(rows, url, month, group_en):
    items = [
        {"@type": "ListItem", "position": int(r["순위"]),
         "item": {"@type": "MusicGroup", "name": r["그룹"]}}
        for r in rows[:50]
    ]
    item_list = {
        "@context": "https://schema.org", "@type": "ItemList",
        "name": f"{month_en(month)} K-POP {group_en} Rankings — Monthly Hit Chart",
        "url": url, "numberOfItems": len(items), "itemListElement": items,
    }
    breadcrumb = {
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{SITE}/en/"},
            {"@type": "ListItem", "position": 2, "name": "Monthly Chart", "item": f"{SITE}/en/monthly/{month}/"},
            {"@type": "ListItem", "position": 3, "name": f"{month_en(month)} {group_en}", "item": url},
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
    .navbar-nav .nav-link{white-space:nowrap}
    .sig-badge{width:105px;text-align:center;padding-left:4px;padding-right:4px;font-size:0.75rem}
    .lg-dot{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:4px;vertical-align:middle}
    .gender-toggle .btn{min-width:110px}
  </style>"""

def build_en_page(month, gender_slug):
    gender_kr = GENDER_KR[gender_slug]
    group_en = GENDER_EN[gender_slug]
    rows = load_rows(month, gender_kr)
    if not rows:
        raise RuntimeError(f"데이터 없음: {gender_kr}/{month}")
    max_score = max(float(r["흥행점수"]) for r in rows)
    top = rows[0]
    url_en = f"{SITE}/en/monthly/{month}/{gender_slug}/"
    url_ko = f"{SITE}/monthly/{month}/{gender_slug}/"
    me = month_en(month)

    title = f"{me} K-POP {group_en} Rankings — Monthly Hit Chart | AIMCONTENTS"
    desc = (
        f"{me} K-POP {group_en} Rankings (Monthly Hit Chart). Multi-signal score combining "
        f"Streams, SNS, Global Spotify, Music Shows & Search Volume. #1 {top['그룹']} (Score {float(top['흥행점수']):.1f}) across {len(rows)} groups."
    )

    hreflang_tags = (
        f'<link rel="alternate" hreflang="ko" href="{url_ko}">\n'
        f'  <link rel="alternate" hreflang="en" href="{url_en}">\n'
        f'  <link rel="alternate" hreflang="x-default" href="{url_ko}">'
    )

    toggle = (
        '<div class="btn-group gender-toggle mb-3" role="group">'
        f'<a href="/en/monthly/{month}/boys/" class="btn btn-{"dark" if gender_slug=="boys" else "outline-dark"}">Boy Groups</a>'
        f'<a href="/en/monthly/{month}/girls/" class="btn btn-{"dark" if gender_slug=="girls" else "outline-dark"}">Girl Groups</a>'
        "</div>"
    )

    page = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(desc)}">
  <link rel="canonical" href="{url_en}">
  {hreflang_tags}
  <meta property="og:type" content="article">
  <meta property="og:title" content="{esc(title)}">
  <meta property="og:description" content="{esc(desc)}">
  <meta property="og:url" content="{url_en}">
  <meta property="og:image" content="{SITE}/logo_aimcontents.png">
  <link rel="icon" type="image/png" href="/favicon_aimcontents.png">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet">
  <link href="/style.css" rel="stylesheet">{PAGE_CSS}
{build_jsonld_en(rows, url_en, month, group_en)}
</head>
<body>
  {site_nav_en(month)}

  <main class="container py-4" style="max-width:920px;">
    <nav aria-label="breadcrumb"><ol class="breadcrumb">
      <li class="breadcrumb-item"><a href="/en/">Home</a></li>
      <li class="breadcrumb-item">Monthly Chart</li>
      <li class="breadcrumb-item active">{esc(me)} {esc(group_en)}</li>
    </ol></nav>

    <h1 class="fw-bold mb-1">{esc(me)} K-POP {esc(group_en)} Rankings</h1>
    <p class="text-muted mb-1"><strong>Monthly Hit Chart</strong> · Multi-signal composite ranking combining Digital Streams, Social Media, Global Spotify, Music Shows, and Search Volume.
    The bar on each card represents <strong>length = Total Hit Score</strong> (100% normalized to #1), and <strong>color = Signal Breakdown</strong>.</p>

    {toggle}
    {legend_html_en()}

    <section>
      <h2 class="fs-5 fw-bold mb-3">{esc(me)} {esc(group_en)} Hit Chart (Top {len(rows)} Groups)</h2>
      <div class="row g-3">{build_cards_en(rows, max_score)}</div>
      <p class="text-muted small mt-3">Source: AIMCONTENTS (aimcontents.com) · Verified {esc(me)} Analytics.
      See <a href="/methodology">Data Methodology</a> for scoring formulation.</p>
    </section>
  </main>
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>
"""
    out = ROOT / "en" / "monthly" / month / gender_slug / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding="utf-8")
    return out, len(rows)

def build_en_landing(month):
    me = month_en(month)
    url_en = f"{SITE}/en/monthly/{month}/"
    url_ko = f"{SITE}/monthly/{month}/"
    title = f"{me} Monthly K-POP Idol Rankings — Boy & Girl Groups Hit Chart | AIMCONTENTS"
    desc = f"{me} Monthly K-POP Idol Rankings (Boy Groups & Girl Groups). Composite score across 5 major performance signals."
    hreflang_tags = (
        f'<link rel="alternate" hreflang="ko" href="{url_ko}">\n'
        f'  <link rel="alternate" hreflang="en" href="{url_en}">\n'
        f'  <link rel="alternate" hreflang="x-default" href="{url_ko}">'
    )
    page = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(desc)}">
  <link rel="canonical" href="{url_en}">
  {hreflang_tags}
  <link rel="icon" type="image/png" href="/favicon_aimcontents.png">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="/style.css" rel="stylesheet">{PAGE_CSS}
</head>
<body>
  {site_nav_en(month)}
  <main class="container py-5 text-center" style="max-width:680px;">
    <h1 class="fw-bold mb-2">{esc(me)} Monthly K-POP Idol Rankings</h1>
    <p class="text-muted mb-4">Boy Groups & Girl Groups Hit Chart · Composite ranking integrating Streams, SNS, Global Spotify, Music Shows, and Search Volume.</p>
    <div class="d-flex justify-content-center gap-3">
      <a href="/en/monthly/{month}/boys/" class="btn btn-dark btn-lg px-4">Boy Groups</a>
      <a href="/en/monthly/{month}/girls/" class="btn btn-outline-dark btn-lg px-4">Girl Groups</a>
    </div>
  </main>
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>
"""
    out = ROOT / "en" / "monthly" / month / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding="utf-8")
    return out

def patch_ko_page_toggle_and_hreflang(month, gender_slug):
    path = ROOT / "monthly" / month / gender_slug / "index.html"
    if not path.exists():
        return
    text = path.read_text(encoding="utf-8")
    url_ko = f"{SITE}/monthly/{month}/{gender_slug}/"
    url_en = f"{SITE}/en/monthly/{month}/{gender_slug}/"

    # Add hreflang
    if 'hreflang="en"' not in text:
        canonical_str = f'<link rel="canonical" href="{url_ko}">'
        hreflang_tags = (
            f'<link rel="canonical" href="{url_ko}">\n'
            f'  <link rel="alternate" hreflang="ko" href="{url_ko}">\n'
            f'  <link rel="alternate" hreflang="en" href="{url_en}">\n'
            f'  <link rel="alternate" hreflang="x-default" href="{url_ko}">'
        )
        if canonical_str in text:
            text = text.replace(canonical_str, hreflang_tags, 1)

    # Add Globe toggle
    if 'bi-globe' not in text:
        lang_btn = (
            f'<li class="nav-item ms-lg-2 my-1 my-lg-0">'
            f'<a class="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" '
            f'href="{url_en}"><i class="bi bi-globe"></i> English</a></li>'
            f'</ul>'
        )
        pos = text.find('href="/insight/index_insight.html">인사이트</a>')
        if pos != -1:
            end_ul = text.find('</ul>', pos)
            text = text[:end_ul] + lang_btn + text[end_ul+5:]

    path.write_text(text, encoding="utf-8")

def main():
    months = ["2026-09", "2026-08", "2026-07", "2026-06", "2026-05"]
    for m in months:
        csv_file = ROOT / "data" / f"monthly-{m}.csv"
        if not csv_file.exists():
            continue
        print(f"Building EN Monthly Chart for {m}...")
        for g in ["boys", "girls"]:
            out, cnt = build_en_page(m, g)
            print(f"  - Created {out.relative_to(ROOT)} ({cnt} groups)")
            patch_ko_page_toggle_and_hreflang(m, g)
        l_out = build_en_landing(m)
        print(f"  - Created landing {l_out.relative_to(ROOT)}")
    print("ALL EN MONTHLY CHARTS SUCCESSFULLY GENERATED!")

if __name__ == "__main__":
    main()
