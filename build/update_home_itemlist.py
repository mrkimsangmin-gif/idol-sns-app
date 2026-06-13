# -*- coding: utf-8 -*-
"""
홈(index.html)의 Schema.org ItemList 를 전수(정적 생성된 그룹) 로 확장.

- 기존: 상위 16개만 하드코딩 → AI 봇/구글이 16개만 인식
- 변경: namu-index 순서로 '정적 페이지가 존재하는' 그룹 전부를 ItemList 에 포함
        각 항목에 url(/namu/<slug>/) 추가 → 엔티티 내부 링크 그래프 강화
- 결과물(index.html)이 아니라 이 생성기를 수정/실행하는 방식 (CLAUDE.md 원칙)

사용: python build/update_home_itemlist.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "index.html"
GROUPS_DIR = ROOT / "data" / "namu-groups"
SITE = "https://aimcontents.com"

# ItemList 블록 앵커(주석 + 바로 뒤 ld+json script)
ANCHOR = re.compile(
    r'(<!-- Schema\.org K-POP 아이돌 데이터베이스 \(AI 봇 인용 최적화\) -->\s*)'
    r'<script type="application/ld\+json">.*?</script>',
    re.DOTALL,
)


def iso_date(s, year_fallback=""):
    """'2013.06.13' → '2013-06-13'. 월/일이 00이거나 비정상이면 연도만."""
    s = (s or "").strip()
    m = re.match(r"(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})", s)
    if m:
        y, mo, d = m.group(1), int(m.group(2)), int(m.group(3))
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return f"{y}-{mo:02d}-{d:02d}"
        return y
    m2 = re.match(r"(\d{4})", s)
    if m2:
        return m2.group(1)
    return str(year_fallback or "").strip()


def main():
    idx = json.loads((ROOT / "data" / "namu-index.json").read_text(encoding="utf-8"))
    items = []
    pos = 0
    for g in idx["groups"]:
        slug = g.get("slug")
        if not slug or not (ROOT / "namu" / slug / "index.html").exists():
            continue  # 정적 페이지 있는 그룹만
        # 풀 데뷔일은 per-group json 의 info['데뷔일'] 에 있음
        pg = json.loads((GROUPS_DIR / f"{slug}.json").read_text(encoding="utf-8"))
        info = pg.get("info", {}) or {}
        founding = iso_date(info.get("데뷔일", ""), g.get("debut_year", ""))
        name = pg.get("name", g.get("name", ""))
        name_en = pg.get("name_en", g.get("name_en", ""))
        disp = f"{name}({name_en})" if name_en else name
        pos += 1
        mg = {
            "@type": "MusicGroup",
            "name": disp,
            "genre": "K-POP",
            "url": f"{SITE}/namu/{slug}/",
            "numberOfEmployees": len(pg.get("members", []) or []),
        }
        if founding:
            mg["foundingDate"] = founding
        items.append({"@type": "ListItem", "position": pos, "item": mg})

    itemlist = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": "K-POP 아이돌 데이터베이스 (팬덤, 소속사, 데뷔일)",
        "description": "1세대부터 5세대까지 K-POP 아이돌 그룹의 세대, 팬덤명, 소속사, 리더, 데뷔일, SNS 팔로워 정보를 제공합니다.",
        "url": f"{SITE}/namu",
        "numberOfItems": len(items),
        "itemListElement": items,
    }
    body = json.dumps(itemlist, ensure_ascii=False, indent=2)
    body = "\n".join("    " + line for line in body.splitlines())  # 4칸 들여쓰기
    new_script = f'<script type="application/ld+json">\n{body}\n    </script>'

    html = INDEX.read_text(encoding="utf-8")
    if not ANCHOR.search(html):
        raise RuntimeError("ItemList 앵커를 찾지 못함 (index.html 구조 변경?)")
    html2 = ANCHOR.sub(lambda m: m.group(1) + new_script, html, count=1)
    INDEX.write_text(html2, encoding="utf-8")
    print(f"홈 ItemList 확장: {len(items)}개 그룹 (이전 16)")


if __name__ == "__main__":
    main()
