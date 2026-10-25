# -*- coding: utf-8 -*-
"""
build/en_shell_localizer.py — EN 정적 페이지(218개) 한국어 잔존(1,077개 노드) 완전 제거 공통 모듈

적용 대상 빌더:
  1. build/generate_en_sections.py (en/index.html, en/news/index.html, 업체 디렉토리 등)
  2. build/generate_static.py      (en/namu/<slug>/index.html 199개)
  3. build/generate_en_comeback.py  (en/comeback/index.html)
  4. build/generate_en_monthly.py   (en/monthly/index.html)
"""
import html
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parent.parent
GROUPS_DIR = ROOT / "data" / "namu-groups"

# ── 1. HTML 속성(aria-label, placeholder, title) 치환 사전 ────────────────────
ATTR_KO_TO_EN: Dict[str, str] = {
    'aria-label="메뉴 열기"': 'aria-label="Open menu"',
    'aria-label="닫기"': 'aria-label="Close"',
    'aria-label="모바일 하단 탐색"': 'aria-label="Mobile Navigation"',
    'title="이메일 복사"': 'title="Copy email"',
    'placeholder="그룹 검색"': 'placeholder="Search Group"',
    'placeholder="그룹명 또는 아티스트 검색 (예: 르세라핌, 원어스)"': 'placeholder="Search group or artist (e.g. LE SSERAFIM, ONEUS)"',
    'placeholder="업체명 또는 키워드 검색"': 'placeholder="Search company or keyword"',
    'placeholder="성함"': 'placeholder="Contact Name"',
    'placeholder="수정할 내용이나 포트폴리오 URL 등을 적어주세요."': 'placeholder="Enter details or portfolio URL..."',
    'placeholder="그룹/멤버 검색 또는 질문"': 'placeholder="Search group, member, or question..."',
}

# ── 2. 공통 UI / 필터 / 모달 / 초기 프리뷰 카드 텍스트 치환 사전 ──
TEXT_KO_TO_EN: Dict[str, str] = {
    "아이엠콘텐츠 (aimcontents.com) - K-POP 아이돌 종합 데이터 플랫폼": "AIMCONTENTS (aimcontents.com) - K-POP Idol Analytics Platform",
    "K-POP 아이돌 나무위키 검색": "K-POP Idol Database & Search",
    "K-POP 아이돌 SNS & 틱톡 팔로워 순위": "K-POP Idol SNS & TikTok Follower Rankings",
    "K-POP 아이돌 SNS 팔로워 순위": "K-POP Idol SNS Follower Rankings",
    "K-POP 아이돌 데이터베이스 (174개 그룹)": "K-POP Idol Database (174 Groups)",
    "K-POP 아이돌 컴백/데뷔 일정": "K-POP Idol Comeback & Debut Schedule",
    "실시간 엔터테인먼트 뉴스": "Real-time Entertainment News",
    "엔터테인먼트 채용정보": "Entertainment Careers",
    "엔터테인먼트 업체정보": "K-POP Vendor Directory",
    "K-POP 링크 모음": "K-POP Useful Links",
    "중국 도우인 인기 챌린지": "Douyin Trending Challenges",
    "조회 월 선택": "Select Month",
    "오늘": "Today",
    "남자": "Male",
    "여자": "Female",
    "웨이보": "Weibo",
    "웨이보(슈퍼챗)": "Weibo (Super Topic)",
    "빌리빌리": "Bilibili",
    "QQ뮤직": "QQ Music",
    "X(트위터)": "X (Twitter)",
    "유튜브": "YouTube",
    "스포티파이": "Spotify",
    "인스타그램": "Instagram",
    "전체": "All",
    "마케팅": "Marketing",
    "영상": "Video / Media",
    "신인개발": "A&R / Casting",
    "매니지먼트": "Management",
    "프로듀싱": "Producing",
    "디자인": "Design",
    "영업": "Sales / Biz",
    "경영지원": "Operations / HR",
    "해외사업": "Global Business",
    "기타": "Other",
    "+ 신규업체 등록": "+ Add Vendor",
    "신규 업체 등록": "Add New Vendor",
    "신규업체 등록": "+ Add Vendor",
    "전체 연도": "All Years",
    "블랙핑크": "BLACKPINK",
    "YG Entertainment • 2016년 데뷔": "YG Entertainment • Debut 2016",
    "연도": "Year",
    "월": "Month",
    "일": "Day",
    "정보 수정 요청": "Request Edit",
    "닫기": "Close",
    "취소": "Cancel",
    "요청 보내기": "Submit Request",
    "복사": "Copy",
    "업체명": "Company Name",
    "카테고리": "Category",
    "신청자/담당자": "Contact Person",
    "휴대전화": "Mobile",
    "일반전화": "Phone",
    "이메일": "Email",
    "홈페이지": "Website",
    "상세 내용 (포트폴리오 등)": "Details / Portfolio",
    "담당자:": "Contact:",
    "휴대전화:": "Mobile:",
    "일반전화:": "Phone:",
    "이메일:": "Email:",
    "홈페이지:": "Website:",
    "포트폴리오": "Portfolio",
    "비고": "Notes",
    "SNS 링크": "SNS Links",
    "메모": "Memo",
    "일정 상세": "Schedule Details",
    "홈/랭킹": "Ranking",
    "컴백": "Comeback",
    "엔터뉴스": "News",
    "채용정보": "Jobs",
    "📚 나무위키에서 보기": "📚 View on Namuwiki",
    "뉴스를 불러오는 중...": "Loading news...",
    "채용정보를 불러오는 중...": "Loading job openings...",
    "업체정보를 불러오는 중...": "Loading vendor directory...",
    "챌린지 데이터를 불러오는 중...": "Loading challenge trends...",
    "데이터를 불러오는 중...": "Loading data...",
    "데이터를 조회해주세요.": "Please select filters to view data.",
    "걸그룹 (79개)": "Girl Groups (79 Groups)",
    "보이그룹 (95개)": "Boy Groups (95 Groups)",
    "걸그룹 프로필 요약 (79개)": "Girl Group Profiles (79)",
    "보이그룹 프로필 요약 (95개)": "Boy Group Profiles (95)",
    "그룹": "Group",
    "앨범": "Album",
    "유형": "Type",
    "발매일": "Release",
    "초동": "1st Week Sales",
    "그룹명": "Group Name",
    "소속사": "Agency",
    "데뷔": "Debut",
    "인원": "Count",
    "멤버": "Members",
    "뮤직비디오": "Music Video",
    "참여 음반": "Featured / OST",
    "일본 디지털 싱글": "Japan Digital Single",
    "미정 (발매 예정)": "TBA (Upcoming)",
    "← 목록으로": "← Back to List",
    "프로필": "Profile",
    "디스코그래피": "Discography",
    "판매량 차트": "Sales Chart",
    "스트리밍": "Streaming",
}

# ── 3. 정규식 패턴 치환 사전 (날짜, 면책문구 등) ──────────────────────────────
REGEX_PATTERNS = [
    (
        re.compile(r"(\d{4})년\s*(\d{1,2})월"),
        r"\1-\2",
    ),
    (
        re.compile(
            r"💼\s*본\s*채용\s*정보는\s*사람인·잡코리아\s*등\s*외부\s*채용\s*사이트에\s*등록된\s*공개\s*정보를\s*기반으로\s*한\s*링크\s*큐레이션\s*서비스입니다\.\s*"
            r"채용\s*관련\s*모든\s*상세\s*내용\s*및\s*지원은\s*원문\s*사이트에서\s*확인하시기\s*바랍니다\."
        ),
        "💼 This job board is a link curation service based on publicly available postings from external recruitment sites. "
        "Please visit the original source site for full application requirements and submissions.",
    ),
]


def _esc(val: Any) -> str:
    return html.escape(str(val if val is not None else ""), quote=True)


def _clean_en_text(ko_text: str, fallback_en: str = "") -> str:
    """한글이 섞여 있을 때 영문/숫자/공백만 남기거나 fallback 반환"""
    en_only = re.sub(r"[^\x00-\x7F]+", "", ko_text).strip()
    return en_only if len(en_only) >= 2 else fallback_en


def build_en_noscript_directory(groups: Optional[List[Dict[str, Any]]] = None) -> str:
    """
    en/index.html의 <noscript> 내부를 100% 영문 디렉토리 테이블로 생성.
    """
    if groups is None:
        groups = []
        if GROUPS_DIR.exists():
            for p in sorted(GROUPS_DIR.glob("*.json")):
                try:
                    groups.append(json.loads(p.read_text(encoding="utf-8")))
                except Exception:
                    pass

    girls = [g for g in groups if str(g.get("gender", "")).lower() in ("female", "girl", "여자", "걸그룹", "f")]
    boys = [g for g in groups if str(g.get("gender", "")).lower() in ("male", "boy", "남자", "보이그룹", "m")]

    def _render_table(label: str, caption: str, items: List[Dict[str, Any]]) -> str:
        rows = []
        for g in items:
            slug = g.get("slug") or ""
            name_en = g.get("name_en") or _clean_en_text(g.get("name", ""), slug.replace("-", " ").upper())
            agency_en = g.get("agency_en") or _clean_en_text(g.get("agency", ""), "K-POP Agency")
            debut = str(g.get("debut_year") or g.get("debut") or "")[:4] or "-"
            members_list = g.get("members") or []
            m_cnt = len(members_list) if isinstance(members_list, list) else 0

            en_members = []
            if isinstance(members_list, list):
                for m in members_list:
                    if isinstance(m, dict):
                        en_m = m.get("name_en") or _clean_en_text(m.get("name", ""))
                    else:
                        en_m = _clean_en_text(str(m))
                    if en_m:
                        en_members.append(en_m)

            lineup_str = ", ".join(en_members) if en_members else f"{m_cnt} Members"

            rows.append(
                f"      <tr>"
                f'<td><a href="/en/namu/{_esc(slug)}/">{_esc(name_en)}</a></td>'
                f"<td>{_esc(agency_en)}</td>"
                f"<td>{_esc(debut)}</td>"
                f"<td>{_esc(m_cnt)}</td>"
                f"<td>{_esc(lineup_str)}</td>"
                f"</tr>"
            )
        return (
            f"  <h3>{_esc(label)} ({len(items)})</h3>\n"
            f'  <table border="1" cellpadding="4" cellspacing="0" style="width:100%; border-collapse:collapse; margin-bottom:24px;">\n'
            f"    <caption>{_esc(caption)}</caption>\n"
            f"    <thead><tr style=\"background:#f0f0f0;\"><th>Group</th><th>Agency</th><th>Debut</th><th>Count</th><th>Members</th></tr></thead>\n"
            f"    <tbody>\n" + "\n".join(rows) + "\n    </tbody>\n"
            f"  </table>"
        )

    total = len(girls) + len(boys) or len(groups)
    return (
        "<noscript>\n"
        '<div style="padding:20px; max-width:1200px; margin:0 auto; font-family:sans-serif; line-height:1.8;">\n'
        "  <h1>AIMCONTENTS (aimcontents.com) - Comprehensive K-POP Idol Analytics Platform</h1>\n"
        f"  <p>Tracking <strong>{total} K-POP Idol Groups</strong> across global social and music platforms.</p>\n"
        '  <h2><a href="/en/">K-POP Idol SNS &amp; TikTok Follower Rankings</a></h2>\n'
        "  <p>Monthly and weekly follower, subscriber, and short-form engagement rankings across TikTok, YouTube, Instagram, Weibo, Bilibili, QQ Music, X (Twitter), Spotify, and Douyin.</p>\n"
        f'  <h2><a href="/en/">K-POP Idol Database ({total} Groups)</a></h2>\n'
        "  <p>Comprehensive profiles from 1st to 5th generation K-POP idol groups including agency, debut date, fandom name, leader, member profiles, album discography, and Hanteo/Circle chart sales comparisons.</p>\n"
        + _render_table("Girl Groups", "K-POP Girl Groups List - Agency, Debut Year, and Member Info", girls)
        + "\n"
        + _render_table("Boy Groups", "K-POP Boy Groups List - Agency, Debut Year, and Member Info", boys)
        + "\n</div>\n</noscript>"
    )


def localize_shell_to_en(
    raw_html: str,
    noscript_mode: str = "strip",  # "replace" (en/index.html 전용) | "strip" (나머지 217개 EN 페이지)
    groups: Optional[List[Dict[str, Any]]] = None,
) -> str:
    """
    모든 EN 빌더에서 루트 index.html 쉘 로드 직후 1순위로 호출하는 통합 로컬라이저.
    - noscript_mode="replace": <noscript> 블록을 100% 영문 SEO 디렉토리 테이블로 교체 (en/index.html)
    - noscript_mode="strip"  : <noscript> 블록을 제거하여 중복 보일러플레이트 및 한글 잔존 방지
    """
    out = raw_html

    # 1. <noscript> 처리
    if noscript_mode == "replace":
        en_noscript = build_en_noscript_directory(groups)
        out = re.sub(r"<noscript>.*?</noscript>", lambda _: en_noscript, out, count=1, flags=re.DOTALL)
    else:
        out = re.sub(r"<noscript>.*?</noscript>", "", out, count=1, flags=re.DOTALL)

    # 2. 속성(aria-label, placeholder, title) 치환
    for ko_attr, en_attr in ATTR_KO_TO_EN.items():
        out = out.replace(ko_attr, en_attr)

    # 3. 태그 내부 정적 텍스트 치환 (긴 문자열 우선 정렬)
    for ko_txt in sorted(TEXT_KO_TO_EN.keys(), key=len, reverse=True):
        en_txt = TEXT_KO_TO_EN[ko_txt]
        pattern = re.compile(r"(>\s*)" + re.escape(ko_txt) + r"(\s*<)")
        out = pattern.sub(rf"\g<1>{en_txt}\g<2>", out)

    # 4. 정규식 기반 멀티라인/날짜 치환
    for rx, repl in REGEX_PATTERNS:
        out = rx.sub(repl, out)

    return out
