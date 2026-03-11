#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TikTok 월별 추적 시스템
- SQLite DB에 월별 스냅샷 저장
- 팔로워 증감, ER 변화, 랭킹 이동 추적
- 자동 크롤링 파이프라인 지원

사용법:
  python tiktok_monthly.py init-baseline     # 최초 실행: 현재 데이터를 baseline으로 저장
  python tiktok_monthly.py snapshot          # 현재 데이터를 이번 달 스냅샷으로 저장
  python tiktok_monthly.py analyze           # 월별 트렌드 분석 리포트
  python tiktok_monthly.py history <slug>    # 특정 그룹 히스토리 조회
  python tiktok_monthly.py rankings          # 이번 달 vs 지난 달 랭킹 비교
  python tiktok_monthly.py pipeline          # 전체: 크롤링 → 스냅샷 → 분석
"""

# === UTF-8 stdout wrapper ===
import sys, io
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import json
import os
import sqlite3
import argparse
import subprocess
import logging
from datetime import datetime
from pathlib import Path

# ─── 경로 설정 ───
SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
DATA_DIR = PROJECT_DIR / "data"
TIKTOK_DIR = DATA_DIR / "tiktok-data"
GROUPS_DIR = TIKTOK_DIR / "groups"
DB_PATH = TIKTOK_DIR / "tiktok_history.db"
REPORTS_DIR = TIKTOK_DIR / "reports"

# 메타데이터 경로 (성별 매핑용)
META_DIR = DATA_DIR

# A32 디바이스 시리얼
DEVICE_SERIAL = "RF9R7042F3K"

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("tiktok_monthly")


# ═══════════════════════════════════════════
# DB 초기화 및 유틸리티
# ═══════════════════════════════════════════

def get_db():
    """SQLite 연결 반환 (Google Drive 안전 설정)"""
    conn = sqlite3.connect(str(DB_PATH), timeout=30)
    conn.execute("PRAGMA journal_mode=DELETE")   # Google Drive 호환 (WAL 비권장)
    conn.execute("PRAGMA synchronous=FULL")      # 안전한 디스크 쓰기
    conn.row_factory = sqlite3.Row               # dict-like 접근
    return conn


def init_db():
    """DB 테이블 생성"""
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            month TEXT NOT NULL,
            slug TEXT NOT NULL,
            name TEXT NOT NULL,
            name_en TEXT NOT NULL,
            gender TEXT DEFAULT '',

            -- 프로필 지표
            followers INTEGER DEFAULT 0,
            following INTEGER DEFAULT 0,
            total_likes INTEGER DEFAULT 0,
            verified INTEGER DEFAULT 0,

            -- 게시물 집계
            post_count INTEGER DEFAULT 0,
            avg_likes REAL DEFAULT 0,
            avg_comments REAL DEFAULT 0,
            avg_shares REAL DEFAULT 0,
            avg_saves REAL DEFAULT 0,
            avg_views REAL DEFAULT 0,

            -- 인게이지먼트
            er_basic REAL DEFAULT 0,
            er_weighted REAL DEFAULT 0,
            shares_ratio REAL DEFAULT 0,
            saves_ratio REAL DEFAULT 0,

            -- 메타
            crawled_at TEXT,
            snapshot_at TEXT NOT NULL,

            UNIQUE(month, slug)
        );

        CREATE TABLE IF NOT EXISTS runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            month TEXT NOT NULL,
            started_at TEXT NOT NULL,
            completed_at TEXT,
            status TEXT DEFAULT 'running',
            groups_crawled INTEGER DEFAULT 0,
            groups_snapshot INTEGER DEFAULT 0,
            error_message TEXT,
            device TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_snap_month ON snapshots(month);
        CREATE INDEX IF NOT EXISTS idx_snap_slug ON snapshots(slug);
        CREATE INDEX IF NOT EXISTS idx_snap_month_slug ON snapshots(month, slug);
    """)
    conn.commit()
    conn.close()
    log.info(f"DB 초기화 완료: {DB_PATH}")


# ═══════════════════════════════════════════
# 성별 매핑
# ═══════════════════════════════════════════

def load_gender_map():
    """metadata에서 name 기반 성별 매핑"""
    name_to_gender = {}
    name_en_to_gender = {}

    for gf, gl in [("metadata-female.json", "여자"), ("metadata-male.json", "남자")]:
        fpath = META_DIR / gf
        if not fpath.exists():
            continue
        with open(fpath, "r", encoding="utf-8") as f:
            raw = json.load(f)
        items = raw.get("data", raw) if isinstance(raw, dict) else raw
        for item in items:
            if not isinstance(item, dict):
                continue
            if item.get("name"):
                name_to_gender[item["name"]] = gl
            if item.get("group"):
                name_en_to_gender[item["group"].upper()] = gl

    # groups JSON에서 name으로 매칭
    gmap = {}
    for jf in GROUPS_DIR.glob("*.json"):
        with open(jf, "r", encoding="utf-8") as f:
            d = json.load(f)
        slug = jf.stem
        name = d.get("name", "")
        name_en = d.get("name_en", "")
        if name in name_to_gender:
            gmap[slug] = name_to_gender[name]
        elif name_en and name_en.upper() in name_en_to_gender:
            gmap[slug] = name_en_to_gender[name_en.upper()]
    return gmap


# ═══════════════════════════════════════════
# 지표 계산
# ═══════════════════════════════════════════

def compute_metrics(profile, posts, stats):
    """그룹 JSON에서 지표 계산"""
    result = {
        "followers": profile.get("followers", 0),
        "following": profile.get("following", 0),
        "total_likes": profile.get("total_likes", 0),
        "verified": 1 if profile.get("verified") else 0,
        "post_count": len(posts),
        "avg_likes": 0, "avg_comments": 0, "avg_shares": 0,
        "avg_saves": 0, "avg_views": 0,
        "er_basic": 0, "er_weighted": 0,
        "shares_ratio": 0, "saves_ratio": 0,
    }

    n = len(posts)
    if n == 0:
        return result

    # 게시물에서 직접 계산
    t_likes = sum(p.get("likes", 0) for p in posts)
    t_comments = sum(p.get("comments", 0) for p in posts)
    t_shares = sum(p.get("shares", 0) for p in posts)
    t_saves = sum(p.get("saves", 0) for p in posts)
    t_views = sum(p.get("views", 0) for p in posts)

    result["avg_likes"] = round(t_likes / n)
    result["avg_comments"] = round(t_comments / n)
    result["avg_shares"] = round(t_shares / n)
    result["avg_saves"] = round(t_saves / n)
    result["avg_views"] = round(t_views / n)

    # ER 계산
    if t_likes > 0:
        # 기본 ER: (댓글+공유+저장)/좋아요 × 100
        result["er_basic"] = round(
            (t_comments + t_shares + t_saves) / t_likes * 100, 2
        )
        # 가중 ER: (공유×3+저장×2+댓글×1)/좋아요 × 100
        result["er_weighted"] = round(
            (t_shares * 3 + t_saves * 2 + t_comments) / t_likes * 100, 2
        )
        result["shares_ratio"] = round(t_shares / t_likes * 100, 2)
        result["saves_ratio"] = round(t_saves / t_likes * 100, 2)

    return result


# ═══════════════════════════════════════════
# 스냅샷 저장
# ═══════════════════════════════════════════

def take_snapshot(month=None):
    """현재 groups/*.json을 SQLite에 스냅샷"""
    if month is None:
        month = datetime.now().strftime("%Y-%m")

    gender_map = load_gender_map()
    now = datetime.now().isoformat()

    conn = get_db()
    count = 0
    errors = []

    json_files = sorted(GROUPS_DIR.glob("*.json"))
    log.info(f"스냅샷 시작: {len(json_files)}개 그룹 → {month}")

    for jf in json_files:
        slug = jf.stem
        try:
            with open(jf, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            errors.append(f"{slug}: {e}")
            continue

        profile = data.get("profile", {})
        posts = data.get("posts", [])
        stats = data.get("stats", {})

        metrics = compute_metrics(profile, posts, stats)

        conn.execute("""
            INSERT OR REPLACE INTO snapshots
            (month, slug, name, name_en, gender,
             followers, following, total_likes, verified,
             post_count, avg_likes, avg_comments, avg_shares, avg_saves, avg_views,
             er_basic, er_weighted, shares_ratio, saves_ratio,
             crawled_at, snapshot_at)
            VALUES (?,?,?,?,?, ?,?,?,?, ?,?,?,?,?,?, ?,?,?,?, ?,?)
        """, (
            month, slug, data.get("name", ""), data.get("name_en", ""),
            gender_map.get(slug, ""),
            metrics["followers"], metrics["following"], metrics["total_likes"],
            metrics["verified"],
            metrics["post_count"], metrics["avg_likes"], metrics["avg_comments"],
            metrics["avg_shares"], metrics["avg_saves"], metrics["avg_views"],
            metrics.get("er_basic", 0), metrics.get("er_weighted", 0),
            metrics.get("shares_ratio", 0), metrics.get("saves_ratio", 0),
            data.get("crawled_at", ""), now,
        ))
        count += 1

        # 20개마다 중간 커밋
        if count % 20 == 0:
            conn.commit()

    conn.commit()
    conn.close()

    log.info(f"스냅샷 완료: {count}개 그룹 저장 (month={month})")
    if errors:
        log.warning(f"오류 {len(errors)}개: {errors[:3]}")

    return count


# ═══════════════════════════════════════════
# 트렌드 분석
# ═══════════════════════════════════════════

def fmt(n):
    """숫자 포맷"""
    if isinstance(n, float):
        if abs(n) >= 1_000_000:
            return f"{n/1_000_000:.1f}M"
        if abs(n) >= 1000:
            return f"{n/1000:.1f}K"
        return f"{n:.1f}"
    if abs(n) >= 1_000_000:
        return f"{n/1_000_000:.1f}M"
    if abs(n) >= 1000:
        return f"{n/1000:.1f}K"
    return str(n)


def get_months(conn):
    """DB에 있는 모든 월 목록 (정렬됨)"""
    rows = conn.execute(
        "SELECT DISTINCT month FROM snapshots ORDER BY month"
    ).fetchall()
    return [r["month"] for r in rows]


def get_snapshot(conn, month):
    """특정 월의 전체 스냅샷 (slug→Row dict)"""
    rows = conn.execute(
        "SELECT * FROM snapshots WHERE month=? ORDER BY followers DESC", (month,)
    ).fetchall()
    return {r["slug"]: r for r in rows}


def generate_report(month=None):
    """월별 트렌드 분석 리포트 생성"""
    conn = get_db()
    months = get_months(conn)

    if not months:
        print("데이터가 없습니다. 먼저 init-baseline을 실행해주세요.")
        conn.close()
        return

    if month is None:
        month = months[-1]

    current = get_snapshot(conn, month)

    # 이전 월 찾기
    prev_month = None
    for m in months:
        if m < month:
            prev_month = m
    previous = get_snapshot(conn, prev_month) if prev_month else None

    lines = []
    def p(s=""):
        lines.append(s)
        print(s)

    p("=" * 80)
    if previous:
        p(f"  TikTok Monthly Report — {month} vs {prev_month}")
    else:
        p(f"  TikTok Baseline Report — {month} (첫 스냅샷)")
    p("=" * 80)
    p(f"  총 그룹: {len(current)}개")

    # ─── 1. 전체 요약 ───
    p()
    p("━" * 80)
    p("1. 전체 요약")
    p("━" * 80)

    total_fol = sum(r["followers"] for r in current.values())
    with_posts = sum(1 for r in current.values() if r["post_count"] > 0)
    total_posts = sum(r["post_count"] for r in current.values())

    p(f"  총 팔로워: {fmt(total_fol)}")
    p(f"  게시물 보유 그룹: {with_posts}개")
    p(f"  총 게시물: {total_posts}개")

    if previous:
        prev_fol = sum(r["followers"] for r in previous.values())
        fol_delta = total_fol - prev_fol
        fol_pct = fol_delta / prev_fol * 100 if prev_fol > 0 else 0
        p(f"  팔로워 변화: {'+' if fol_delta >= 0 else ''}{fmt(fol_delta)} ({'+' if fol_pct >= 0 else ''}{fol_pct:.1f}%)")

    # ─── 2. 팔로워 Top 20 ───
    p()
    p("━" * 80)
    p("2. 팔로워 Top 20")
    p("━" * 80)

    sorted_by_fol = sorted(current.values(), key=lambda r: r["followers"], reverse=True)

    if previous:
        # 이전 달 팔로워 랭킹
        prev_fol_rank = {}
        for i, r in enumerate(sorted(previous.values(), key=lambda r: r["followers"], reverse=True)):
            prev_fol_rank[r["slug"]] = i + 1

        p(f"\n  {'#':>3} {'변동':>5} {'이름':18s} {'성별':4s} {'팔로워':>12s} {'증감':>10s} {'증감%':>7s} {'가중ER':>8s}")
        p(f"  {'─'*3} {'─'*5} {'─'*18} {'─'*4} {'─'*12} {'─'*10} {'─'*7} {'─'*8}")

        for i, r in enumerate(sorted_by_fol[:20]):
            new_rank = i + 1
            old_rank = prev_fol_rank.get(r["slug"], new_rank)
            delta_rank = old_rank - new_rank
            arrow = f"↑{delta_rank}" if delta_rank > 0 else f"↓{abs(delta_rank)}" if delta_rank < 0 else "─"

            prev_r = previous.get(r["slug"])
            if prev_r:
                fol_d = r["followers"] - prev_r["followers"]
                fol_p = fol_d / prev_r["followers"] * 100 if prev_r["followers"] > 0 else 0
                p(f"  {new_rank:>3} {arrow:>5s} {r['name']:18s} [{r['gender']:2s}] {r['followers']:>12,} {'+' if fol_d>=0 else ''}{fmt(fol_d):>9s} {'+' if fol_p>=0 else ''}{fol_p:>5.1f}% {r['er_weighted']:>7.1f}%")
            else:
                p(f"  {new_rank:>3} {'NEW':>5s} {r['name']:18s} [{r['gender']:2s}] {r['followers']:>12,} {'':>9s} {'':>6s} {r['er_weighted']:>7.1f}%")
    else:
        p(f"\n  {'#':>3} {'이름':18s} {'성별':4s} {'팔로워':>12s} {'posts':>5s} {'가중ER':>8s} {'shares%':>8s} {'saves%':>8s}")
        p(f"  {'─'*3} {'─'*18} {'─'*4} {'─'*12} {'─'*5} {'─'*8} {'─'*8} {'─'*8}")
        for i, r in enumerate(sorted_by_fol[:20]):
            p(f"  {i+1:>3} {r['name']:18s} [{r['gender']:2s}] {r['followers']:>12,} {r['post_count']:>5d} {r['er_weighted']:>7.1f}% {r['shares_ratio']:>7.1f}% {r['saves_ratio']:>7.1f}%")

    # ─── 3. 가중 ER Top 20 ───
    p()
    p("━" * 80)
    p("3. 가중 ER Top 20")
    p("━" * 80)

    active = [r for r in current.values() if r["post_count"] > 0]
    sorted_by_er = sorted(active, key=lambda r: r["er_weighted"], reverse=True)

    if previous:
        prev_er_rank = {}
        prev_active = [r for r in previous.values() if r["post_count"] > 0]
        for i, r in enumerate(sorted(prev_active, key=lambda r: r["er_weighted"], reverse=True)):
            prev_er_rank[r["slug"]] = i + 1

        p(f"\n  {'#':>3} {'변동':>5} {'이름':18s} {'성별':4s} {'가중ER':>8s} {'ER변화':>8s} {'shares%':>8s} {'saves%':>8s}")
        p(f"  {'─'*3} {'─'*5} {'─'*18} {'─'*4} {'─'*8} {'─'*8} {'─'*8} {'─'*8}")

        for i, r in enumerate(sorted_by_er[:20]):
            new_rank = i + 1
            old_rank = prev_er_rank.get(r["slug"], new_rank)
            delta_rank = old_rank - new_rank
            arrow = f"↑{delta_rank}" if delta_rank > 0 else f"↓{abs(delta_rank)}" if delta_rank < 0 else "─"

            prev_r = previous.get(r["slug"])
            er_d = r["er_weighted"] - prev_r["er_weighted"] if prev_r else 0
            p(f"  {new_rank:>3} {arrow:>5s} {r['name']:18s} [{r['gender']:2s}] {r['er_weighted']:>7.1f}% {'+' if er_d>=0 else ''}{er_d:>6.1f}p {r['shares_ratio']:>7.1f}% {r['saves_ratio']:>7.1f}%")
    else:
        p(f"\n  {'#':>3} {'이름':18s} {'성별':4s} {'가중ER':>8s} {'팔로워':>10s} {'shares%':>8s} {'saves%':>8s}")
        p(f"  {'─'*3} {'─'*18} {'─'*4} {'─'*8} {'─'*10} {'─'*8} {'─'*8}")
        for i, r in enumerate(sorted_by_er[:20]):
            p(f"  {i+1:>3} {r['name']:18s} [{r['gender']:2s}] {r['er_weighted']:>7.1f}% {fmt(r['followers']):>10s} {r['shares_ratio']:>7.1f}% {r['saves_ratio']:>7.1f}%")

    # ─── 4. 팔로워 성장 Top 15 (비교 데이터 있을 때만) ───
    if previous:
        p()
        p("━" * 80)
        p("4. 팔로워 성장률 Top 15")
        p("━" * 80)

        growth = []
        for slug, r in current.items():
            prev_r = previous.get(slug)
            if not prev_r or prev_r["followers"] <= 0:
                continue
            delta = r["followers"] - prev_r["followers"]
            pct = delta / prev_r["followers"] * 100
            growth.append((slug, r["name"], r["gender"], r["followers"],
                          delta, pct, prev_r["followers"]))

        # 성장률 순
        growth.sort(key=lambda x: x[4], reverse=True)
        p(f"\n  [절대 성장 Top 15]")
        p(f"  {'#':>3} {'이름':18s} {'성별':4s} {'현재':>12s} {'증감':>10s} {'증감%':>7s}")
        for i, (slug, name, gender, fol, delta, pct, prev_fol) in enumerate(growth[:15]):
            p(f"  {i+1:>3} {name:18s} [{gender:2s}] {fol:>12,} {'+' if delta>=0 else ''}{fmt(delta):>9s} {'+' if pct>=0 else ''}{pct:>5.1f}%")

        growth.sort(key=lambda x: x[5], reverse=True)
        p(f"\n  [성장률(%) Top 15]")
        for i, (slug, name, gender, fol, delta, pct, prev_fol) in enumerate(growth[:15]):
            p(f"  {i+1:>3} {name:18s} [{gender:2s}] {fol:>12,} {'+' if delta>=0 else ''}{fmt(delta):>9s} {'+' if pct>=0 else ''}{pct:>5.1f}%")

        # 하락 그룹
        growth.sort(key=lambda x: x[4])
        declining = [(s,n,g,f,d,pc,pf) for s,n,g,f,d,pc,pf in growth if d < 0]
        if declining:
            p(f"\n  [팔로워 감소 그룹]")
            for i, (slug, name, gender, fol, delta, pct, prev_fol) in enumerate(declining[:10]):
                p(f"  {i+1:>3} {name:18s} [{gender:2s}] {fol:>12,} {fmt(delta):>9s} {pct:>5.1f}%")

        # ─── 5. ER 변화 Top 15 ───
        p()
        p("━" * 80)
        p("5. 가중 ER 변화 Top 15")
        p("━" * 80)

        er_changes = []
        for slug, r in current.items():
            prev_r = previous.get(slug)
            if not prev_r or r["post_count"] == 0 or prev_r["post_count"] == 0:
                continue
            delta = r["er_weighted"] - prev_r["er_weighted"]
            er_changes.append((slug, r["name"], r["gender"],
                              prev_r["er_weighted"], r["er_weighted"], delta))

        er_changes.sort(key=lambda x: x[5], reverse=True)
        p(f"\n  [ER 상승 Top 15]")
        p(f"  {'#':>3} {'이름':18s} {'성별':4s} {'이전ER':>8s} {'현재ER':>8s} {'변화':>8s}")
        for i, (slug, name, gender, prev_er, cur_er, delta) in enumerate(er_changes[:15]):
            p(f"  {i+1:>3} {name:18s} [{gender:2s}] {prev_er:>7.1f}% {cur_er:>7.1f}% {'+' if delta>=0 else ''}{delta:>6.1f}p")

        p(f"\n  [ER 하락 Top 10]")
        er_changes.sort(key=lambda x: x[5])
        for i, (slug, name, gender, prev_er, cur_er, delta) in enumerate(er_changes[:10]):
            if delta >= 0:
                break
            p(f"  {i+1:>3} {name:18s} [{gender:2s}] {prev_er:>7.1f}% {cur_er:>7.1f}% {delta:>6.1f}p")

    # ─── 성별 요약 ───
    p()
    p("━" * 80)
    p(f"{'6' if previous else '4'}. 성별 요약")
    p("━" * 80)

    for label in ["여자", "남자"]:
        grps = [r for r in current.values() if r["gender"] == label]
        active_g = [r for r in grps if r["post_count"] > 0]
        if not grps:
            continue
        fol_vals = [r["followers"] for r in grps if r["followers"] > 0]
        er_vals = [r["er_weighted"] for r in active_g if r["er_weighted"] > 0]
        fol_med = sorted(fol_vals)[len(fol_vals)//2] if fol_vals else 0
        er_avg = sum(er_vals) / len(er_vals) if er_vals else 0

        p(f"\n  [{label}] {len(grps)}개 그룹 ({len(active_g)}개 활성)")
        p(f"    팔로워 총합: {fmt(sum(fol_vals))}  중앙값: {fmt(fol_med)}")
        p(f"    가중ER 평균: {er_avg:.1f}%")

        if previous:
            prev_grps = [r for r in previous.values() if r["gender"] == label]
            prev_fol = sum(r["followers"] for r in prev_grps if r["followers"] > 0)
            cur_fol = sum(fol_vals)
            if prev_fol > 0:
                delta = cur_fol - prev_fol
                p(f"    팔로워 변화: {'+' if delta>=0 else ''}{fmt(delta)} ({'+' if delta>=0 else ''}{delta/prev_fol*100:.1f}%)")

    p()
    p("=" * 80)

    # 리포트 파일 저장
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report_file = REPORTS_DIR / f"monthly-report-{month}.txt"
    with open(report_file, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
        f.flush()
        os.fsync(f.fileno())
    log.info(f"리포트 저장: {report_file}")

    conn.close()


# ═══════════════════════════════════════════
# 그룹 히스토리
# ═══════════════════════════════════════════

def show_history(slug):
    """특정 그룹의 월별 히스토리"""
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM snapshots WHERE slug=? ORDER BY month", (slug,)
    ).fetchall()

    if not rows:
        print(f"'{slug}' 데이터가 없습니다.")
        conn.close()
        return

    first = rows[0]
    print(f"\n  {first['name']} ({first['name_en']}) [{first['gender']}] — 월별 히스토리")
    print()
    print(f"  {'월':10s} {'팔로워':>12s} {'증감':>10s} {'증감%':>7s} {'posts':>5s} {'가중ER':>8s} {'shares%':>8s} {'saves%':>8s}")
    print(f"  {'─'*10} {'─'*12} {'─'*10} {'─'*7} {'─'*5} {'─'*8} {'─'*8} {'─'*8}")

    prev_fol = None
    for r in rows:
        if prev_fol is not None and prev_fol > 0:
            delta = r["followers"] - prev_fol
            pct = delta / prev_fol * 100
            delta_str = f"{'+' if delta>=0 else ''}{fmt(delta)}"
            pct_str = f"{'+' if pct>=0 else ''}{pct:.1f}%"
        else:
            delta_str = "─"
            pct_str = "─"

        print(f"  {r['month']:10s} {r['followers']:>12,} {delta_str:>10s} {pct_str:>7s} {r['post_count']:>5d} {r['er_weighted']:>7.1f}% {r['shares_ratio']:>7.1f}% {r['saves_ratio']:>7.1f}%")
        prev_fol = r["followers"]

    conn.close()


# ═══════════════════════════════════════════
# 랭킹 비교
# ═══════════════════════════════════════════

def show_rankings(month=None):
    """이번 달 vs 지난 달 종합 랭킹"""
    conn = get_db()
    months = get_months(conn)

    if not months:
        print("데이터가 없습니다.")
        conn.close()
        return

    if month is None:
        month = months[-1]

    current = get_snapshot(conn, month)

    # z-score 종합 랭킹
    active = [r for r in current.values() if r["post_count"] > 0 and r["followers"] > 0]

    metrics = ["followers", "avg_likes", "er_weighted", "saves_ratio", "post_count"]
    weights = [0.30, 0.25, 0.20, 0.15, 0.10]

    # z-score 계산
    for m in metrics:
        vals = [r[m] for r in active]
        mean = sum(vals) / len(vals) if vals else 0
        std = (sum((v - mean) ** 2 for v in vals) / len(vals)) ** 0.5 if vals else 1
        if std == 0:
            std = 1
        for r in active:
            r[f"z_{m}"] = (r[m] - mean) / std  # sqlite3.Row를 dict로 변환 필요

    # dict로 변환하여 z-score 추가
    active_dicts = []
    for r in active:
        d = dict(r)
        for m in metrics:
            vals = [dict(rr)[m] for rr in active]
            mean = sum(vals) / len(vals)
            std = (sum((v - mean) ** 2 for v in vals) / len(vals)) ** 0.5
            if std == 0:
                std = 1
            d[f"z_{m}"] = (d[m] - mean) / std
        d["composite"] = sum(d[f"z_{m}"] * w for m, w in zip(metrics, weights))
        active_dicts.append(d)

    active_dicts.sort(key=lambda x: x["composite"], reverse=True)

    print(f"\n  종합 랭킹 — {month}")
    print(f"  (팔로워30% + avg_likes25% + 가중ER20% + saves%15% + posts10%)")
    print()
    print(f"  {'#':>3} {'이름':18s} {'성별':4s} {'팔로워':>10s} {'avg_likes':>10s} {'가중ER':>8s} {'saves%':>7s} {'점수':>7s}")
    print(f"  {'─'*3} {'─'*18} {'─'*4} {'─'*10} {'─'*10} {'─'*8} {'─'*7} {'─'*7}")

    for i, d in enumerate(active_dicts[:30]):
        print(f"  {i+1:>3} {d['name']:18s} [{d['gender']:2s}] {fmt(d['followers']):>10s} {fmt(d['avg_likes']):>10s} {d['er_weighted']:>7.1f}% {d['saves_ratio']:>6.1f}% {d['composite']:>+7.2f}")

    conn.close()


# ═══════════════════════════════════════════
# 파이프라인 (크롤링 → 스냅샷 → 분석)
# ═══════════════════════════════════════════

def check_device():
    """A32 디바이스 연결 확인"""
    try:
        result = subprocess.run(
            ["adb", "-s", DEVICE_SERIAL, "shell", "echo", "ok"],
            capture_output=True, text=True, timeout=10
        )
        return result.returncode == 0 and "ok" in result.stdout
    except Exception:
        return False


def run_pipeline():
    """전체 파이프라인: 디바이스 확인 → 크롤링 → 리빌드 → 스냅샷 → 분석"""
    month = datetime.now().strftime("%Y-%m")

    conn = get_db()
    conn.execute(
        "INSERT INTO runs (month, started_at, status, device) VALUES (?,?,?,?)",
        (month, datetime.now().isoformat(), "running", DEVICE_SERIAL)
    )
    conn.commit()
    run_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.close()

    log.info(f"파이프라인 시작: {month}")

    # Step 1: 디바이스 확인
    if not check_device():
        log.error(f"디바이스 {DEVICE_SERIAL} 미연결")
        _update_run(run_id, "failed", error="Device not connected")
        print(f"\n  오류: A32 디바이스({DEVICE_SERIAL})가 연결되지 않았습니다.")
        print(f"  USB 연결 후 다시 시도해주세요.")
        return False

    log.info("디바이스 확인 완료")

    # Step 2: 크롤링 실행
    crawl_script = SCRIPT_DIR / "crawl_a32.py"
    log.info(f"크롤링 시작: {crawl_script}")
    print(f"\n  크롤링 시작... (약 12~14시간 소요)")

    try:
        proc = subprocess.run(
            [sys.executable, str(crawl_script)],
            timeout=86400,  # 24시간 제한
        )
        if proc.returncode != 0:
            log.warning(f"크롤러 종료 코드: {proc.returncode}")
    except subprocess.TimeoutExpired:
        log.error("크롤링 타임아웃 (24시간)")
        _update_run(run_id, "failed", error="Crawl timeout 24h")
        return False
    except Exception as e:
        log.error(f"크롤링 오류: {e}")
        _update_run(run_id, "failed", error=str(e))
        return False

    # Step 3: Summary 리빌드
    rebuild_script = SCRIPT_DIR / "rebuild_summary.py"
    log.info("Summary 리빌드...")
    subprocess.run([sys.executable, str(rebuild_script)])

    # Step 4: 스냅샷
    count = take_snapshot(month)

    # Step 5: 분석
    generate_report(month)

    # Step 6: 팔란티어 DB 업데이트
    ingest_script = Path("G:/내 드라이브/01.Work/04.AI.M.Contents/00.pumit/00.ent_palantir/ingest.py")
    if ingest_script.exists():
        log.info("팔란티어 DB 업데이트 (ingest.py)...")
        try:
            subprocess.run([sys.executable, str(ingest_script)], timeout=120)
            log.info("팔란티어 DB 업데이트 완료")
        except Exception as e:
            log.warning(f"팔란티어 업데이트 실패 (무시): {e}")

    _update_run(run_id, "completed", groups=count)
    log.info(f"파이프라인 완료: {count}개 그룹")
    return True


def _update_run(run_id, status, error=None, groups=0):
    """runs 테이블 업데이트"""
    conn = get_db()
    conn.execute(
        "UPDATE runs SET completed_at=?, status=?, groups_snapshot=?, error_message=? WHERE id=?",
        (datetime.now().isoformat(), status, groups, error, run_id)
    )
    conn.commit()
    conn.close()


# ═══════════════════════════════════════════
# CLI 엔트리포인트
# ═══════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="TikTok 월별 추적 시스템",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
사용 예시:
  python tiktok_monthly.py init-baseline      # 최초: 현재 데이터를 baseline으로 저장
  python tiktok_monthly.py snapshot           # 이번 달 스냅샷 저장
  python tiktok_monthly.py snapshot --month 2026-04
  python tiktok_monthly.py analyze            # 트렌드 분석
  python tiktok_monthly.py history aespa      # 에스파 히스토리
  python tiktok_monthly.py rankings           # 종합 랭킹
  python tiktok_monthly.py pipeline           # 전체 자동화
        """
    )

    sub = parser.add_subparsers(dest="command")

    # init-baseline
    sub.add_parser("init-baseline", help="최초 실행: 현재 데이터를 baseline으로 저장")

    # snapshot
    p_snap = sub.add_parser("snapshot", help="현재 데이터를 스냅샷으로 저장")
    p_snap.add_argument("--month", default=datetime.now().strftime("%Y-%m"),
                        help="저장할 월 (기본: 이번 달)")

    # analyze
    p_analyze = sub.add_parser("analyze", help="월별 트렌드 분석 리포트")
    p_analyze.add_argument("--month", default=None, help="분석할 월 (기본: 최신)")

    # history
    p_hist = sub.add_parser("history", help="특정 그룹 월별 히스토리")
    p_hist.add_argument("slug", help="그룹 slug (예: aespa)")

    # rankings
    p_rank = sub.add_parser("rankings", help="종합 랭킹")
    p_rank.add_argument("--month", default=None, help="랭킹 월 (기본: 최신)")

    # pipeline
    sub.add_parser("pipeline", help="전체 자동화: 크롤링→스냅샷→분석")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    # DB 초기화 (항상)
    init_db()

    if args.command == "init-baseline":
        month = datetime.now().strftime("%Y-%m")
        log.info(f"Baseline 캡처: {month}")
        count = take_snapshot(month)
        print(f"\n  Baseline 저장 완료: {count}개 그룹 → {DB_PATH}")
        print(f"  다음 달 snapshot을 찍으면 트렌드 비교가 시작됩니다.")
        generate_report(month)

    elif args.command == "snapshot":
        count = take_snapshot(args.month)
        print(f"\n  스냅샷 완료: {count}개 그룹 (month={args.month})")

    elif args.command == "analyze":
        generate_report(args.month)

    elif args.command == "history":
        show_history(args.slug)

    elif args.command == "rankings":
        show_rankings(args.month)

    elif args.command == "pipeline":
        run_pipeline()


if __name__ == "__main__":
    main()
