#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys, io
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

"""
tiktok_deep_analysis.py — TikTok 173개 그룹 심층 분석
ENT_PALANTIR Phase 4.8 프레임워크 기반

주의사항 반영:
  1. 조회수 38% 결손 → Track A (조회수 불필요) / Track B (조회수 보유만) 이원화
  2. NCT 127/DREAM 동일계정 → 'NCT (통합)'으로 병합
  3. 비활동 64개 그룹 → 분석 모집단에서 제외
  4. 카테고리 96.8% General → 카테고리 분석 제외
  5. 팔로워 티어별 비교

팩트체크 반영 (v2, 2026-03-09):
  6. "거품" → "휴면/비활동" 재분류 (마마무·VIVIZ 등 게시물 ≤3개는 활동 부족이지 허수 아님)
  7. 소분모 함정 보정: 게시물 5개 미만 랭킹 제외 또는 LOW 경고
  8. Action Rate→Spotify 선행지표: "가설" 명시 (교차검증 미완)
  9. 성별 차이: 관측값만 기술, WHY 해석 자제
  10. 종합 랭킹: 티어별 리그 분리 출력
"""

import json
import statistics
from pathlib import Path
from collections import defaultdict

SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
DATA_DIR = PROJECT_DIR / "data"
GROUPS_DIR = DATA_DIR / "tiktok-data" / "groups"
NAMU_JSON = DATA_DIR / "namu-wiki.json"

# ═══════════════════════════════════════════════════════════════
# 1. 데이터 로드 + 전처리
# ═══════════════════════════════════════════════════════════════
all_groups = []
for f in sorted(GROUPS_DIR.glob("*.json")):
    with open(f, "r", encoding="utf-8") as fp:
        all_groups.append(json.load(fp))

# 성별 매핑 (namu-wiki.json)
with open(NAMU_JSON, "r", encoding="utf-8") as fp:
    namu = json.load(fp)
gender_map = {}
for g in namu["groups"]:
    gender_map[g["name"]] = g.get("gender", "")
    gender_map[g["name_en"]] = g.get("gender", "")

# NCT 병합 (nct-127 + nct-dream → 단일 엔트리, 같은 계정이므로 게시물 중복 제거)
NCT_SLUGS = {"nct-127", "nct-dream"}
nct_merged = None
clean_groups = []
for g in all_groups:
    if g["slug"] in NCT_SLUGS:
        if nct_merged is None:
            nct_merged = {
                "name": "NCT (통합)", "name_en": "NCT", "slug": "nct-all",
                "tiktok_url": g["tiktok_url"],
                "profile": dict(g.get("profile", {})),
                "posts": list(g.get("posts", [])),
                "stats": dict(g.get("stats", {})),
            }
        continue
    clean_groups.append(g)
if nct_merged:
    clean_groups.append(nct_merged)

# 활동/비활동 분리
active = [g for g in clean_groups if len(g.get("posts", [])) >= 1]
inactive = [g for g in clean_groups if len(g.get("posts", [])) == 0]

total_posts = sum(len(g.get("posts", [])) for g in active)
print(f"{'='*70}")
print(f"  TikTok 심층 분석 리포트 — ENT_PALANTIR Phase 4.8")
print(f"{'='*70}")
print(f"  분석 대상: {len(active)}개 활동 그룹 / {total_posts}개 게시물")
print(f"  제외: {len(inactive)}개 비활동 + NCT 2계정→1로 병합")
print(f"  기간: 최근 30일 (2026-02~03)")
print()


# ═══════════════════════════════════════════════════════════════
# 2. 그룹별 지표 계산
# ═══════════════════════════════════════════════════════════════
def med(lst):
    return statistics.median(lst) if lst else 0

results = []
for g in active:
    posts = g.get("posts", [])
    if not posts:
        continue
    profile = g.get("profile", {})
    followers = profile.get("followers", 0)
    name = g["name"]
    name_en = g.get("name_en", "")
    gender = gender_map.get(name_en, gender_map.get(name, ""))

    n = len(posts)
    likes = [p.get("likes", 0) for p in posts]
    saves = [p.get("saves", 0) for p in posts]
    shares = [p.get("shares", 0) for p in posts]
    comments = [p.get("comments", 0) for p in posts]
    actions = [s + sh for s, sh in zip(saves, shares)]

    med_likes = med(likes)
    med_saves = med(saves)
    med_shares = med(shares)
    med_comments = med(comments)
    med_actions = med(actions)
    sum_saves = sum(saves)
    sum_shares = sum(shares)
    sum_likes = sum(likes)

    # Track A 핵심 지표 (조회수 불필요)
    retention = med([s / l if l > 0 else 0 for s, l in zip(saves, likes)])
    spread = med([sh / l if l > 0 else 0 for sh, l in zip(shares, likes)])
    comment_int = med([c / l if l > 0 else 0 for c, l in zip(comments, likes)])
    action_per_fol = med_actions / followers if followers > 0 else 0

    # Track B (조회수 보유 게시물만)
    vp = [p for p in posts if p.get("views", 0) > 0]
    n_vp = len(vp)
    action_rate = 0
    viral_ratio = 0
    med_views = 0
    views_floor = 0
    if n_vp >= 3:
        views = sorted([p["views"] for p in vp])
        med_views = med(views)
        q1_idx = max(len(views) // 4, 1)
        views_floor = med(views[:q1_idx])
        if med_views > 0:
            action_rate = med([(p["saves"] + p["shares"]) / p["views"] for p in vp])
            viral_ratio = sum(1 for v in views if v > med_views * 5) / n_vp

    # 팔로워 티어
    if followers >= 10_000_000:
        tier = "S"
    elif followers >= 5_000_000:
        tier = "A"
    elif followers >= 1_000_000:
        tier = "B"
    elif followers >= 100_000:
        tier = "C"
    else:
        tier = "D"

    results.append({
        "name": name, "name_en": name_en, "slug": g["slug"], "gender": gender,
        "tier": tier, "followers": followers, "n_posts": n,
        "med_likes": med_likes, "med_saves": med_saves, "med_shares": med_shares,
        "med_comments": med_comments, "med_actions": med_actions,
        "sum_saves": sum_saves, "sum_shares": sum_shares, "sum_likes": sum_likes,
        "retention": retention, "spread": spread, "comment_int": comment_int,
        "action_per_fol": action_per_fol,
        "n_views_posts": n_vp, "med_views": med_views, "views_floor": views_floor,
        "action_rate": action_rate, "viral_ratio": viral_ratio,
    })


# ═══════════════════════════════════════════════════════════════
# Finding 1: 팔로워 효율 분석 (활동량 구분 반영)
# ═══════════════════════════════════════════════════════════════
print(f"\n{'─'*70}")
print(f"  Finding 1: 팔로워 효율 분석 — 활동 그룹 vs 휴면 그룹 분리")
print(f"{'─'*70}")
print(f"  지표: action_per_follower = 게시물당 (저장+공유) 중앙값 / 팔로워")
print(f"  ※ 게시물 5개 미만은 통계 신뢰도 부족으로 별도 표기")
print()

# 충분한 게시물이 있는 그룹만 효율 랭킹에 포함 (소분모 함정 방지)
reliable = [r for r in results if r["n_posts"] >= 5]
few_posts = [r for r in results if r["n_posts"] < 5]

by_eff = sorted(reliable, key=lambda x: x["action_per_fol"], reverse=True)

print(f"  ▸ 팔로워 대비 행동 효율 TOP 15 (알짜 팬덤, 게시물 5개+)")
print(f"    {'그룹':<16s} {'팔로워':>12s} {'저장+공유':>10s} {'효율%':>8s} {'게시물':>6s} {'성별':>4s} {'T':>2s}")
print(f"    {'─'*64}")
for r in by_eff[:15]:
    pct = r["action_per_fol"] * 100
    print(f"    {r['name']:<16s} {r['followers']:>12,} {r['med_actions']:>10,.0f} {pct:>7.3f}% {r['n_posts']:>6d} {r['gender']:>4s} {r['tier']:>2s}")

# 휴면/비활동 대형 계정 분리 (게시물 ≤3개 + 100만+ 팔로워)
big = [r for r in results if r["followers"] >= 1_000_000]
big_dormant = [r for r in big if r["n_posts"] <= 3]
big_active = [r for r in big if r["n_posts"] > 3]

if big_dormant:
    print(f"\n  ▸ 대형 계정 중 휴면 상태 (100만+ 팔로워, 게시물 ≤3개)")
    print(f"    ※ 효율 하락은 팔로워 허수가 아닌 활동 부족으로 판단")
    print(f"    {'그룹':<16s} {'팔로워':>12s} {'게시물':>6s} {'저장+공유':>10s}")
    print(f"    {'─'*48}")
    for r in sorted(big_dormant, key=lambda x: x["followers"], reverse=True):
        print(f"    {r['name']:<16s} {r['followers']:>12,} {r['n_posts']:>6d} {r['med_actions']:>10,.0f}")

big_active_low = sorted(big_active, key=lambda x: x["action_per_fol"])
print(f"\n  ▸ 활동 중인 100만+ 계정 중 효율 최하위 10 (팔로워 대비 반응 저조)")
print(f"    {'그룹':<16s} {'팔로워':>12s} {'저장+공유':>10s} {'효율%':>8s} {'게시물':>6s}")
print(f"    {'─'*56}")
for r in big_active_low[:10]:
    pct = r["action_per_fol"] * 100
    print(f"    {r['name']:<16s} {r['followers']:>12,} {r['med_actions']:>10,.0f} {pct:>7.4f}% {r['n_posts']:>6d}")


# ═══════════════════════════════════════════════════════════════
# Finding 2: 남녀 소비 패턴 차이 (관측값 기술)
# ═══════════════════════════════════════════════════════════════
print(f"\n{'─'*70}")
print(f"  Finding 2: 남녀 아이돌 틱톡 지표 비교 (관측값)")
print(f"{'─'*70}")
print(f"  ※ 수치 차이만 기술함 — 원인(팬 동기, 콘텐츠 성격 등) 해석은 별도 연구 필요")

female = [r for r in results if r["gender"] == "여자"]
male = [r for r in results if r["gender"] == "남자"]

print(f"\n  {'지표':<24s} {'여자('+str(len(female))+'개)':>16s} {'남자('+str(len(male))+'개)':>16s} {'차이':>10s}")
print(f"  {'─'*68}")

metrics_compare = [
    ("retention (저장/좋아요)", "retention", "{:.4f}"),
    ("spread (공유/좋아요)", "spread", "{:.4f}"),
    ("comment (댓글/좋아요)", "comment_int", "{:.4f}"),
    ("action_per_follower", "action_per_fol", "{:.5f}"),
    ("med_saves (중앙)", "med_saves", "{:,.0f}"),
    ("med_shares (중앙)", "med_shares", "{:,.0f}"),
    ("med_comments (중앙)", "med_comments", "{:,.0f}"),
    ("med_likes (중앙)", "med_likes", "{:,.0f}"),
]
for label, key, fmt in metrics_compare:
    fv = med([r[key] for r in female])
    mv = med([r[key] for r in male])
    if fv > 0:
        diff = ((mv - fv) / fv * 100)
        diff_s = f"남 {diff:+.1f}%"
    else:
        diff_s = "N/A"
    print(f"  {label:<24s} {fmt.format(fv):>16s} {fmt.format(mv):>16s} {diff_s:>10s}")

# 티어별 남녀 retention 비교
print(f"\n  ▸ 티어별 retention (저장/좋아요) 중앙값")
for tier in ["S", "A", "B", "C", "D"]:
    ft = [r for r in female if r["tier"] == tier]
    mt = [r for r in male if r["tier"] == tier]
    fr = med([r["retention"] for r in ft]) if ft else 0
    mr = med([r["retention"] for r in mt]) if mt else 0
    print(f"    Tier {tier}: 여({len(ft):2d}) {fr:.4f} | 남({len(mt):2d}) {mr:.4f}")


# ═══════════════════════════════════════════════════════════════
# Finding 3: 저장(Saves) 폭발 콘텐츠 분석
# ═══════════════════════════════════════════════════════════════
print(f"\n{'─'*70}")
print(f"  Finding 3: 저장(Saves) 폭발 콘텐츠 — 상위 5% 분석")
print(f"{'─'*70}")

# 전체 게시물 풀링
all_posts_flat = []
for g in active:
    for p in g.get("posts", []):
        p_copy = dict(p)
        p_copy["group_name"] = g["name"]
        p_copy["group_followers"] = g.get("profile", {}).get("followers", 0)
        all_posts_flat.append(p_copy)

all_posts_flat.sort(key=lambda x: x.get("saves", 0), reverse=True)
top5pct_n = max(1, len(all_posts_flat) // 20)
top5 = all_posts_flat[:top5pct_n]
rest = all_posts_flat[top5pct_n:]

print(f"  전체 {len(all_posts_flat)}개 중 상위 5% = {top5pct_n}개")

# 상위 vs 나머지 비교
def avg(lst):
    return sum(lst) / len(lst) if lst else 0

print(f"\n  {'지표':<20s} {'상위 5%':>14s} {'나머지 95%':>14s} {'배수':>8s}")
print(f"  {'─'*58}")
for label, key in [("평균 저장", "saves"), ("평균 공유", "shares"), ("평균 좋아요", "likes"), ("평균 댓글", "comments")]:
    tv = avg([p.get(key, 0) for p in top5])
    rv = avg([p.get(key, 0) for p in rest])
    ratio = tv / rv if rv > 0 else 0
    print(f"  {label:<20s} {tv:>14,.0f} {rv:>14,.0f} {ratio:>7.1f}x")

# 상위 5%에서 가장 많이 등장하는 그룹
from collections import Counter
top5_groups = Counter(p["group_name"] for p in top5)
print(f"\n  ▸ 저장 상위 5%에 가장 많이 등장하는 그룹")
for name, cnt in top5_groups.most_common(10):
    total = next((r["n_posts"] for r in results if r["name"] == name), 0)
    print(f"    {name:<16s}: {cnt}개 (전체 {total}개 중 {cnt/total*100:.0f}%)")

# 상위 5% retention vs 전체 retention
top5_ret = med([p["saves"] / p["likes"] if p["likes"] > 0 else 0 for p in top5])
rest_ret = med([p["saves"] / p["likes"] if p["likes"] > 0 else 0 for p in rest])
print(f"\n  ▸ retention 비교: 상위5%={top5_ret:.4f} / 나머지={rest_ret:.4f} ({top5_ret/rest_ret:.1f}x)")

# 상위 게시물 샘플
print(f"\n  ▸ 저장 TOP 10 게시물")
print(f"    {'그룹':<16s} {'저장':>8s} {'공유':>8s} {'좋아요':>10s} {'retention':>10s}")
print(f"    {'─'*56}")
for p in top5[:10]:
    ret = p["saves"] / p["likes"] if p["likes"] > 0 else 0
    print(f"    {p['group_name']:<16s} {p['saves']:>8,} {p['shares']:>8,} {p['likes']:>10,} {ret:>10.4f}")


# ═══════════════════════════════════════════════════════════════
# Finding 4: 바이럴 로또 vs 안정형 (Track B, 조회수 보유 한정)
# ═══════════════════════════════════════════════════════════════
print(f"\n{'─'*70}")
print(f"  Finding 4: 바이럴 로또 vs 안정형 (조회수 보유 그룹 한정)")
print(f"{'─'*70}")
print(f"  ※ 조회수는 그리드 상위 6개만 보유 — 인기 게시물 편향 있음")

trackb = [r for r in results if r["n_views_posts"] >= 3]
print(f"  분석 대상: {len(trackb)}개 그룹 (조회수 3개+ 보유)")

# 안정형: viral_ratio = 0 이고 views_floor 높은 그룹
stable = sorted([r for r in trackb if r["viral_ratio"] == 0], key=lambda x: x["views_floor"], reverse=True)
print(f"\n  ▸ 안정형 (바이럴 없이 꾸준한 조회수) — views_floor 기준 TOP 10")
print(f"    {'그룹':<16s} {'views중앙':>12s} {'views바닥':>12s} {'action_rate':>12s}")
print(f"    {'─'*54}")
for r in stable[:10]:
    print(f"    {r['name']:<16s} {r['med_views']:>12,.0f} {r['views_floor']:>12,.0f} {r['action_rate']:>11.4f}")

# 바이럴형: viral_ratio > 0
viral = sorted([r for r in trackb if r["viral_ratio"] > 0], key=lambda x: x["viral_ratio"], reverse=True)
print(f"\n  ▸ 바이럴형 (중앙값 5배 이상 폭발 경험) — {len(viral)}개 그룹")
print(f"    {'그룹':<16s} {'viral_ratio':>12s} {'views중앙':>12s} {'views_max':>12s}")
print(f"    {'─'*54}")
for r in viral[:10]:
    # 최대 조회수 계산
    g = next((g for g in active if g["slug"] == r["slug"]), None)
    if g:
        vmax = max([p["views"] for p in g["posts"] if p.get("views", 0) > 0], default=0)
    else:
        vmax = 0
    print(f"    {r['name']:<16s} {r['viral_ratio']:>11.1%} {r['med_views']:>12,.0f} {vmax:>12,.0f}")

# action_rate 랭킹 (외부 플랫폼 유입 잠재력 — 미검증 가설)
print(f"\n  ▸ Action Rate TOP 15 (저장+공유/조회수)")
print(f"    ※ 높은 action_rate = 영상 외부 공유/저장 비율 높음")
print(f"    ※ Spotify 등 외부 플랫폼 유입 선행지표 가설 — 교차검증 미완")
by_ar = sorted(trackb, key=lambda x: x["action_rate"], reverse=True)
print(f"    {'그룹':<16s} {'action_rate':>12s} {'저장(중앙)':>10s} {'공유(중앙)':>10s} {'게시물':>6s} {'성별':>4s}")
print(f"    {'─'*62}")
for r in by_ar[:15]:
    print(f"    {r['name']:<16s} {r['action_rate']:>11.4f} {r['med_saves']:>10,.0f} {r['med_shares']:>10,.0f} {r['n_posts']:>6d} {r['gender']:>4s}")


# ═══════════════════════════════════════════════════════════════
# Finding 5: 게시 빈도 vs 인게이지먼트 관계
# ═══════════════════════════════════════════════════════════════
print(f"\n{'─'*70}")
print(f"  Finding 5: 게시 빈도와 인게이지먼트 관계")
print(f"{'─'*70}")

# 빈도 구간별 평균 retention
freq_buckets = [
    ("1~5개", 1, 5),
    ("6~10개", 6, 10),
    ("11~20개", 11, 20),
    ("21~30개", 21, 30),
    ("31개+", 31, 999),
]
print(f"\n  {'빈도 구간':<12s} {'그룹수':>6s} {'retention':>10s} {'med_saves':>10s} {'med_actions':>12s}")
print(f"  {'─'*54}")
for label, lo, hi in freq_buckets:
    bucket = [r for r in results if lo <= r["n_posts"] <= hi]
    if bucket:
        bret = med([r["retention"] for r in bucket])
        bsav = med([r["med_saves"] for r in bucket])
        bact = med([r["med_actions"] for r in bucket])
        print(f"  {label:<12s} {len(bucket):>6d} {bret:>10.4f} {bsav:>10,.0f} {bact:>12,.0f}")

# 상관계수 (게시 빈도 vs retention)
n_posts_list = [r["n_posts"] for r in results]
ret_list = [r["retention"] for r in results]
if len(n_posts_list) >= 5:
    n_mean = sum(n_posts_list) / len(n_posts_list)
    r_mean = sum(ret_list) / len(ret_list)
    cov = sum((n - n_mean) * (r - r_mean) for n, r in zip(n_posts_list, ret_list)) / len(n_posts_list)
    std_n = (sum((n - n_mean) ** 2 for n in n_posts_list) / len(n_posts_list)) ** 0.5
    std_r = (sum((r - r_mean) ** 2 for r in ret_list) / len(ret_list)) ** 0.5
    corr = cov / (std_n * std_r) if std_n > 0 and std_r > 0 else 0
    print(f"\n  선형 상관계수 (게시빈도 vs retention): r = {corr:.3f}")
    print(f"  ※ 선형 상관만 측정 — U자형·계단형 등 비선형 관계는 포착 불가")
    if abs(corr) < 0.2:
        print(f"  → 선형적으로 거의 무관")
    elif corr > 0.3:
        print(f"  → 약한 양의 상관")
    elif corr < -0.3:
        print(f"  → 약한 음의 상관")


# ═══════════════════════════════════════════════════════════════
# Finding 6: 종합 팬덤 건강도 랭킹 (100점) — 티어별 리그 분리
# ═══════════════════════════════════════════════════════════════
print(f"\n{'─'*70}")
print(f"  Finding 6: 종합 팬덤 건강도 랭킹 (100점 만점)")
print(f"{'─'*70}")
print(f"  산출: 팬덤바닥(25) + 행동전환(30) + 팬덤밀도(25) + 바이럴(20)")
print(f"  ※ 게시물 5개 미만 = Low Confidence 표기 (랭킹 참고용)")
print(f"  ※ 규모 차이 고려하여 티어별 리그 분리 출력")

# 백분위 기반 점수화 (Rank Percentile Scaling)
def rank_pct(lst, key):
    """백분위 기반 0~100 점수 부여"""
    vals = sorted(enumerate(lst), key=lambda x: x[1][key])
    n = len(vals)
    scores = [0.0] * n
    for rank, (idx, _) in enumerate(vals):
        scores[idx] = (rank / (n - 1)) * 100 if n > 1 else 50
    return scores

# 점수 계산 대상: 게시물 1개+
scored = list(results)

# 각 지표별 백분위 점수
fandom_floor_scores = rank_pct(scored, "med_actions")        # 팬덤 바닥값 (S+A 절대량)
action_scores = rank_pct(scored, "retention")                 # 행동 전환 (저장/좋아요)
density_scores = rank_pct(scored, "comment_int")              # 팬덤 밀도 (댓글/좋아요)
viral_scores = rank_pct(scored, "viral_ratio")                # 바이럴 파워

for i, r in enumerate(scored):
    r["score_floor"] = fandom_floor_scores[i]
    r["score_action"] = action_scores[i]
    r["score_density"] = density_scores[i]
    r["score_viral"] = viral_scores[i]
    r["total_score"] = (
        r["score_floor"] * 0.25 +
        r["score_action"] * 0.30 +
        r["score_density"] * 0.25 +
        r["score_viral"] * 0.20
    )
    r["confidence"] = "HIGH" if r["n_posts"] >= 5 else "LOW"

ranked = sorted(scored, key=lambda x: x["total_score"], reverse=True)

# 전체 TOP 20 (HIGH confidence만)
ranked_high = [r for r in ranked if r["confidence"] == "HIGH"]
print(f"\n  ▸ 종합 TOP 20 (게시물 5개+ HIGH confidence만, {len(ranked_high)}개 중)")
print(f"    {'#':>3s} {'그룹':<16s} {'점수':>6s} {'바닥':>5s} {'전환':>5s} {'밀도':>5s} {'바이럴':>5s} {'T':>2s} {'성별':>4s} {'게시물':>6s}")
print(f"    {'─'*74}")
for i, r in enumerate(ranked_high[:20]):
    print(f"    {i+1:>3d} {r['name']:<16s} {r['total_score']:>5.1f} "
          f"{r['score_floor']:>5.0f} {r['score_action']:>5.0f} {r['score_density']:>5.0f} "
          f"{r['score_viral']:>5.0f} {r['tier']:>2s} {r['gender']:>4s} {r['n_posts']:>6d}")

# 티어별 리그 분리 (동일 규모끼리 비교)
tier_labels = {
    "S": "S (1000만+)", "A": "A (500만+)", "B": "B (100만+)",
    "C": "C (10만+)", "D": "D (10만 미만)"
}
for tier_code in ["S", "A", "B", "C"]:
    tier_grps = sorted([r for r in ranked if r["tier"] == tier_code], key=lambda x: x["total_score"], reverse=True)
    if not tier_grps:
        continue
    print(f"\n  ▸ Tier {tier_labels[tier_code]} 리그 ({len(tier_grps)}개)")
    print(f"    {'#':>3s} {'그룹':<16s} {'점수':>6s} {'팔로워':>12s} {'게시물':>6s} {'성별':>4s} {'신뢰':>4s}")
    print(f"    {'─'*56}")
    for i, r in enumerate(tier_grps[:10]):
        print(f"    {i+1:>3d} {r['name']:<16s} {r['total_score']:>5.1f} {r['followers']:>12,} {r['n_posts']:>6d} {r['gender']:>4s} {r['confidence']:>4s}")

# 남녀 TOP 10 (HIGH confidence만)
print(f"\n  ▸ 여자 그룹 TOP 10 (HIGH confidence)")
print(f"    {'#':>3s} {'그룹':<16s} {'점수':>6s} {'팔로워':>12s} {'T':>2s} {'게시물':>6s}")
print(f"    {'─'*50}")
f_ranked = [r for r in ranked_high if r["gender"] == "여자"]
for i, r in enumerate(f_ranked[:10]):
    print(f"    {i+1:>3d} {r['name']:<16s} {r['total_score']:>5.1f} {r['followers']:>12,} {r['tier']:>2s} {r['n_posts']:>6d}")

print(f"\n  ▸ 남자 그룹 TOP 10 (HIGH confidence)")
print(f"    {'#':>3s} {'그룹':<16s} {'점수':>6s} {'팔로워':>12s} {'T':>2s} {'게시물':>6s}")
print(f"    {'─'*50}")
m_ranked = [r for r in ranked_high if r["gender"] == "남자"]
for i, r in enumerate(m_ranked[:10]):
    print(f"    {i+1:>3d} {r['name']:<16s} {r['total_score']:>5.1f} {r['followers']:>12,} {r['tier']:>2s} {r['n_posts']:>6d}")


# ═══════════════════════════════════════════════════════════════
# Finding 7: Hidden Gems (저평가 그룹 발굴)
# ═══════════════════════════════════════════════════════════════
print(f"\n{'─'*70}")
print(f"  Finding 7: Hidden Gems — 팔로워는 적지만 팬덤 건강한 그룹")
print(f"{'─'*70}")
print(f"  조건: 팔로워 100만 미만 + 종합 점수 상위 25% + 게시물 5개+ (소분모 필터)")

score_75th = sorted([r["total_score"] for r in ranked])[int(len(ranked) * 0.75)]
# 소분모 함정 방지: 게시물 5개 이상만 Hidden Gem 후보
gems = [r for r in ranked if r["followers"] < 1_000_000 and r["total_score"] >= score_75th and r["n_posts"] >= 5]
gems.sort(key=lambda x: x["total_score"], reverse=True)

print(f"  발견: {len(gems)}개 그룹")
print(f"\n    {'그룹':<16s} {'점수':>6s} {'팔로워':>12s} {'retention':>10s} {'저장(중앙)':>10s} {'게시물':>6s} {'성별':>4s}")
print(f"    {'─'*70}")
for r in gems[:15]:
    print(f"    {r['name']:<16s} {r['total_score']:>5.1f} {r['followers']:>12,} {r['retention']:>10.4f} {r['med_saves']:>10,.0f} {r['n_posts']:>6d} {r['gender']:>4s}")

# 소분모 그룹 별도 표기 (참고용)
small_gems = [r for r in ranked if r["followers"] < 1_000_000 and r["total_score"] >= score_75th and r["n_posts"] < 5]
if small_gems:
    print(f"\n    ※ 아래 {len(small_gems)}개 그룹은 게시물 5개 미만 (참고용, 추가 데이터 필요)")
    for r in sorted(small_gems, key=lambda x: x["total_score"], reverse=True)[:5]:
        print(f"      {r['name']:<16s} {r['total_score']:>5.1f} {r['followers']:>12,} {r['n_posts']:>6d}개 게시물")


# ═══════════════════════════════════════════════════════════════
# 최종 요약
# ═══════════════════════════════════════════════════════════════
print(f"\n{'='*70}")
print(f"  분석 완료")
print(f"{'='*70}")
