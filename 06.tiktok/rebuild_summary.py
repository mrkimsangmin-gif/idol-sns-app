#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""groups/ 폴더의 개별 JSON을 합산하여 tiktok-summary.json 재빌드"""
import sys, io
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import json
import os
from datetime import datetime
from pathlib import Path

# 경로 설정
SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
DATA_DIR = PROJECT_DIR / "data"
TIKTOK_DIR = DATA_DIR / "tiktok-data"
GROUPS_DIR = TIKTOK_DIR / "groups"
SUMMARY_FILE = TIKTOK_DIR / "tiktok-summary.json"

def main():
    # 모든 그룹 JSON 로드
    summary_data = []
    errors = []

    for json_file in sorted(GROUPS_DIR.glob("*.json")):
        try:
            with open(json_file, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            errors.append(f"{json_file.name}: {e}")
            continue

        profile = data.get("profile", {})
        stats = data.get("stats", {})
        posts = data.get("posts", [])

        # 통계 재계산 (posts가 있으면 직접 계산)
        post_count = len(posts)
        if post_count > 0 and not stats:
            total_likes = sum(p.get("likes", 0) for p in posts)
            total_comments = sum(p.get("comments", 0) for p in posts)
            total_shares = sum(p.get("shares", 0) for p in posts)
            total_saves = sum(p.get("saves", 0) for p in posts)
            stats = {
                "total_posts_crawled": post_count,
                "posts_last_30d": post_count,
                "avg_views": sum(p.get("views", 0) for p in posts) // post_count,
                "avg_likes": total_likes // post_count,
                "avg_comments": total_comments // post_count,
                "avg_shares": total_shares // post_count,
                "avg_saves": total_saves // post_count,
            }
            # likes-based engagement rate: (comments + shares + saves) / likes * 100
            if total_likes > 0:
                stats["engagement_rate"] = round((total_comments + total_shares + total_saves) / total_likes * 100, 2)
            else:
                stats["engagement_rate"] = 0
            stats["er_formula"] = "likes_based"

        summary_data.append({
            "name": data.get("name", ""),
            "name_en": data.get("name_en", ""),
            "slug": data.get("slug", json_file.stem),
            "tiktok_url": data.get("tiktok_url", ""),
            "followers": profile.get("followers", 0),
            "following": profile.get("following", 0),
            "total_likes": profile.get("total_likes", 0),
            "display_name": profile.get("display_name", ""),
            "verified": profile.get("verified", False),
            "category": profile.get("category", ""),
            "post_count": post_count,
            "posts_last_30d": stats.get("posts_last_30d", post_count),
            "avg_views": stats.get("avg_views", 0),
            "avg_likes": stats.get("avg_likes", 0),
            "avg_comments": stats.get("avg_comments", 0),
            "avg_shares": stats.get("avg_shares", 0),
            "avg_saves": stats.get("avg_saves", 0),
            "engagement_rate": stats.get("engagement_rate", 0),
            "er_formula": stats.get("er_formula", "likes_based"),
        })

        # duplicate 표시
        if data.get("duplicate_of"):
            summary_data[-1]["duplicate_of"] = data["duplicate_of"]

    # 저장
    output = {
        "crawled_at": datetime.now().isoformat(),
        "rebuilt_at": datetime.now().isoformat(),
        "total_groups": len(summary_data),
        "settings": {
            "days_back": 30,
            "max_videos": 30,
            "er_formula": "likes_based: (comments + shares + saves) / likes * 100",
        },
        "groups": summary_data,
    }

    content = json.dumps(output, ensure_ascii=False, indent=2)
    with open(SUMMARY_FILE, "w", encoding="utf-8") as f:
        f.write(content)
        f.flush()
        os.fsync(f.fileno())

    # 통계 출력
    with_posts = [g for g in summary_data if g["post_count"] > 0]
    total_posts = sum(g["post_count"] for g in summary_data)

    print(f"Summary 재빌드 완료: {SUMMARY_FILE}")
    print(f"  총 그룹: {len(summary_data)}개")
    print(f"  게시물 보유: {len(with_posts)}개 그룹")
    print(f"  총 게시물: {total_posts:,}개")
    print()

    # Top 15 팔로워
    top = sorted(summary_data, key=lambda x: x["followers"], reverse=True)[:15]
    print("Top 15 팔로워:")
    for i, g in enumerate(top):
        print(f"  {i+1:>2}. {g['name']:15s} {g['followers']:>12,}  게시물:{g['post_count']:>3}")

    # Top 15 게시물 수
    print()
    top_posts = sorted(with_posts, key=lambda x: x["post_count"], reverse=True)[:15]
    print("Top 15 게시물 수:")
    for i, g in enumerate(top_posts):
        print(f"  {i+1:>2}. {g['name']:15s} {g['post_count']:>3}개  avg_likes:{g['avg_likes']:>8,}")

    if errors:
        print(f"\n오류: {len(errors)}개")
        for e in errors:
            print(f"  {e}")


if __name__ == "__main__":
    main()
