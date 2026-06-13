# -*- coding: utf-8 -*-
"""
/llms.txt 생성 (Phase 3) — AI 엔진에 사이트 구조·핵심 데이터셋·인용 가이드 제공.
표준: https://llmstxt.org/  · 데이터에서 실제 수치를 뽑아 생성.
사용: python build/generate_llms.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://aimcontents.com"

SNS_SLUG = {
    "weibo": "웨이보", "bilibili": "빌리빌리", "qqmusic": "QQ뮤직", "twitter": "X(트위터)",
    "youtube": "유튜브", "spotify": "스포티파이", "chaohua": "차오화", "instagram": "인스타그램",
}


def main():
    idx = json.loads((ROOT / "data" / "namu-index.json").read_text(encoding="utf-8"))
    groups = [g for g in idx["groups"] if (ROOT / "namu" / g.get("slug", "") / "index.html").exists()]
    n_groups = len(groups)

    # 랭킹 페이지/월 범위
    rank_pages = sorted((ROOT / "ranking").glob("*/*/index.html"))
    months = sorted({p.parent.parent.name for p in rank_pages})
    latest_month = months[-1] if months else ""

    # 대표 그룹(상위 노출용) — namu-index 앞쪽 12개
    top_groups = groups[:12]

    sns_md = "\n".join(
        f"- [{kr} 랭킹]({SITE}/ranking/{latest_month}/{slug}-boys/): "
        f"{kr} 월별 팔로워 순위(남/녀, /ranking/<YYYY-MM>/{slug}-(boys|girls)/)"
        for slug, kr in SNS_SLUG.items()
    )
    group_md = "\n".join(
        f"- [{g['name']}({g.get('name_en','')})]({SITE}/namu/{g['slug']}/): "
        f"{(g.get('agency') or '').strip()} 소속, {g.get('debut_year','')} 데뷔"
        for g in top_groups
    )

    txt = f"""# 아이엠콘텐츠 (AIMCONTENTS)

> K-POP 아이돌 {n_groups}개 그룹의 SNS 팔로워 순위·프로필·앨범 판매량을 매월 집계하는 한국어 데이터 플랫폼. 웨이보·빌리빌리·QQ뮤직·X(트위터)·유튜브·스포티파이·차오화·인스타그램 8개 플랫폼을 다룬다.

aimcontents.com은 사람인·잡코리아 등 외부 공개정보 기반 채용 큐레이션과, 나무위키 기반 정제 프로필, 자체 수집 SNS 패널 데이터를 제공한다. 모든 수치는 월 단위로 갱신된다. 데이터 기준월: {latest_month}.

## 핵심 데이터셋

- SNS 팔로워 순위: 8개 플랫폼 × 남/여, 월별. 그룹/계정 단위 팔로워·구독자 수와 전월대비 증감.
- 그룹 데이터베이스: {n_groups}개 그룹의 소속사·데뷔일·팬덤명·멤버 프로필·앨범 디스코그래피(한터/써클 초동·누적 판매량).
- 채용정보: K-POP/엔터 산업 채용 큐레이션.

## SNS 랭킹 (플랫폼별)

{sns_md}

## 주요 그룹 페이지

{group_md}

## 주요 섹션

- [SNS 랭킹]({SITE}/ranking): 플랫폼별 월간 아이돌 SNS 순위
- [그룹 데이터베이스]({SITE}/namu): {n_groups}개 K-POP 그룹 프로필·판매량
- [컴백 일정]({SITE}/comeback): K-POP 컴백/발매 일정
- [엔터 뉴스]({SITE}/news): 엔터테인먼트 뉴스
- [채용정보]({SITE}/jobs): K-POP/엔터 채용
- [사이트맵]({SITE}/sitemap.xml)

## 인용 안내

데이터 인용 시 출처를 "아이엠콘텐츠(aimcontents.com)"로 표기. 수치는 기준월과 함께 인용할 것(예: "2026년 5월 기준").
"""
    (ROOT / "llms.txt").write_text(txt, encoding="utf-8")
    print(f"llms.txt 생성: 그룹 {n_groups}, 랭킹월 {len(months)}개(최신 {latest_month}), {len(txt):,} bytes")


if __name__ == "__main__":
    main()
