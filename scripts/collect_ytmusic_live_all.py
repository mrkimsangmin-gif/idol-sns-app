#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
collect_ytmusic_live_all.py — YouTube Innertube API를 비동기 병렬 호출하여
전체 148개 K-POP 아이돌 그룹의 6,400여 개 공식 음원 트랙 조회수를 실시간 수집하고,
그룹별 YT Music 총 조회수(total_views), 평균(mean_views), 최고 조회수(max_views)를 갱신합니다.
"""

import sys, os, time, json, asyncio, aiohttp
from datetime import datetime
from pathlib import Path

# UTF-8 출력 보장
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = Path(r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app")
NAMU_GROUPS_DIR = BASE / "data/namu-groups"
CACHE_FILE = Path("C:/temp/ytmusic_views_cache.json")
INNERTUBE_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false"

CONCURRENCY_LIMIT = 20  # 안전한 병렬 동시 요청 수

def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)

async def fetch_video_stats(session, sem, vid, cache):
    if vid in cache:
        return vid, cache[vid]

    payload = {
        "videoId": vid,
        "context": {
            "client": {
                "clientName": "WEB",
                "clientVersion": "2.20261021.01.00"
            }
        }
    }
    async with sem:
        for attempt in range(3):
            try:
                async with session.post(INNERTUBE_URL, json=payload, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        vdetails = data.get("videoDetails", {})
                        vc = int(vdetails.get("viewCount", 0))
                        cache[vid] = vc
                        return vid, vc
                    elif resp.status == 429:
                        await asyncio.sleep(2 * (attempt + 1))
            except Exception:
                await asyncio.sleep(1)
        return vid, None

async def main_async():
    log("전체 아이돌 그룹 파일 로드 중...")
    group_files = sorted(NAMU_GROUPS_DIR.glob("*.json"))
    
    # 1. Collect unique video IDs
    vids_to_fetch = set()
    groups_data = []

    for f in group_files:
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            ytm = d.get("streaming", {}).get("ytmusic")
            if ytm and isinstance(ytm, dict) and ytm.get("albums"):
                groups_data.append((f, d))
                for alb in ytm.get("albums", []):
                    for trk in alb.get("tracks", []):
                        vid = trk.get("video_id")
                        if vid and len(vid) == 11:
                            vids_to_fetch.add(vid)
        except Exception:
            pass

    log(f"총 {len(groups_data)}개 그룹 발견, 고유 음원 트랙: {len(vids_to_fetch)}곡")

    # Load cache if available
    cache = {}
    if CACHE_FILE.exists():
        try:
            cache = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
            log(f"기존 조회수 캐시 로드: {len(cache)}곡")
        except Exception:
            pass

    sem = asyncio.Semaphore(CONCURRENCY_LIMIT)
    headers = {"Content-Type": "application/json"}
    
    start_time = time.time()
    async with aiohttp.ClientSession(headers=headers) as session:
        tasks = [fetch_video_stats(session, sem, vid, cache) for vid in vids_to_fetch]
        
        # Periodic cache flush
        done_count = 0
        total_tasks = len(tasks)
        for f_task in asyncio.as_completed(tasks):
            await f_task
            done_count += 1
            if done_count % 500 == 0 or done_count == total_tasks:
                log(f"수집 진행률: [{done_count}/{total_tasks}] ({(done_count/total_tasks)*100:.1f}%)")
                with open(CACHE_FILE, "w", encoding="utf-8") as c_out:
                    json.dump(cache, c_out)

    log(f"조회수 수집 완료! 소요 시간: {time.time() - start_time:.1f}초. 파일 반영 시작...")

    # Update group JSON files
    now_date = datetime.now().strftime("%Y-%m-%d")
    updated_groups_count = 0

    for file_path, d in groups_data:
        ytm = d["streaming"]["ytmusic"]
        total_views = 0
        track_views_list = []

        for alb in ytm.get("albums", []):
            for trk in alb.get("tracks", []):
                vid = trk.get("video_id")
                if vid in cache and cache[vid] is not None:
                    vc = cache[vid]
                    trk["youtube_views"] = vc
                    total_views += vc
                    track_views_list.append(vc)
                elif "youtube_views" in trk and trk["youtube_views"]:
                    total_views += trk["youtube_views"]
                    track_views_list.append(trk["youtube_views"])

        if track_views_list:
            ytm["total_views"] = total_views
            ytm["track_count"] = len(track_views_list)
            ytm["mean_views"] = int(total_views / len(track_views_list))
            ytm["max_views"] = max(track_views_list)
            d["streaming"]["collected_at"] = now_date

            with open(file_path, "w", encoding="utf-8") as out:
                json.dump(d, out, ensure_ascii=False, indent=2)
            updated_groups_count += 1

    log(f"전체 {updated_groups_count}개 그룹의 YT Music 최신 지표 반영 완료!")

if __name__ == "__main__":
    asyncio.run(main_async())
