#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
update_monthly_pipeline.py — 매월 1회 실행하는 전수 자동 업데이트 통합 파이프라인
1. Chrome CDP를 통해 Spotify Web에서 최신 인증 토큰 및 클라이언트 토큰 자동 캡처
2. 전체 170+ 아이돌 그룹의 Spotify 월간 리스너 & Top 10 트랙 실시간 수집 (collect_spotify_live_all.py)
3. 수집된 최신 데이터를 namu-groups/*.json 데이터 파일에 병합 (merge_spotify_latest_to_namu.py)
4. 전체 148개 아이돌 그룹의 6,400+ YT Music 트랙 조회수 실시간 수집 및 합산 (collect_ytmusic_live_all.py)
5. 써클차트(Circle Chart) 최신 월간 판매량 자동 수집 (circle_monthly_crawler.py --update)
6. 써클 판매량 실측치 및 월별 타임라인을 namu-groups/*.json 에 동기화 (sync_circle_sales_to_namu.py)
7. namu 정적 페이지 및 인덱스 전체 재빌드 (generate_static.py)
"""

import sys, os, time, subprocess, json
from datetime import datetime
from pathlib import Path

# UTF-8 출력 보장
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE_DIR = Path(r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app")
SPOTIFY_DIR = BASE_DIR / "10.spotify"
SCRIPTS_DIR = BASE_DIR / "scripts"
BUILD_DIR = BASE_DIR / "build"
HANTEO_DIR = BASE_DIR / "07.hanteo"
TEMP_DIR = Path("C:/temp")

def log(step, msg):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] [{step}] {msg}", flush=True)

def run_proc(cmd, step_name):
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    return res

def step1_capture_spotify_token():
    log("STEP 1", "Chrome CDP를 통한 Spotify Web 토큰 캡처 확인 중...")
    req_file = TEMP_DIR / "spotify_pathfinder_reqs.json"
    if req_file.exists():
        age = time.time() - req_file.stat().st_mtime
        if age < 1800:
            log("STEP 1", f"최근 캡처된 유효 토큰 발견 (경과 시간: {int(age)}초). 기존 토큰 재사용.")
            return True

    capture_script = TEMP_DIR / "capture_pathfinder.py"
    if not capture_script.exists():
        log("STEP 1", f"캡처 스크립트 없음: {capture_script}")
        return False
        
    log("STEP 1", "Spotify Web 탭에서 최신 Pathfinder 요청 캡처 진행...")
    res = run_proc([sys.executable, str(capture_script)], "STEP 1")
    if res.returncode == 0 and req_file.exists():
        log("STEP 1", "Spotify 인증 토큰 캡처 성공!")
        return True
    else:
        log("STEP 1", f"토큰 캡처 실패. Chrome에 open.spotify.com이 열려 있는지 확인하세요.\n{res.stderr}")
        return False

def step2_collect_spotify_data():
    log("STEP 2", "전체 아이돌 그룹 Spotify 실시간 스트리밍 지표 수집 시작...")
    collector = SPOTIFY_DIR / "collect_spotify_live_all.py"
    res = run_proc([sys.executable, str(collector)], "STEP 2")
    if res.returncode == 0:
        log("STEP 2", "전체 아이돌 그룹 Spotify 수집 성공 완료!")
        return True
    else:
        log("STEP 2", f"수집 실패:\n{res.stderr}\n{res.stdout}")
        return False

def step3_merge_to_namu_groups():
    log("STEP 3", "수집된 Spotify 데이터를 namu-groups/*.json 에 일괄 병합 중...")
    merger = SPOTIFY_DIR / "merge_spotify_latest_to_namu.py"
    res = run_proc([sys.executable, str(merger)], "STEP 3")
    if res.returncode == 0:
        log("STEP 3", "namu-groups Spotify 데이터 병합 완료!")
        return True
    else:
        log("STEP 3", f"병합 실패:\n{res.stderr}\n{res.stdout}")
        return False

def step4_collect_ytmusic_data():
    log("STEP 4", "전체 아이돌 그룹 6,400+ 곡 YouTube Music 실시간 조회수 수집 및 반영...")
    ytm_collector = SCRIPTS_DIR / "collect_ytmusic_live_all.py"
    res = run_proc([sys.executable, str(ytm_collector)], "STEP 4")
    if res.returncode == 0:
        log("STEP 4", "YouTube Music 전수 조회수 수집 및 반영 완료!")
        return True
    else:
        log("STEP 4", f"YouTube Music 수집 실패:\n{res.stderr}\n{res.stdout}")
        return False

def step5_collect_circle_sales():
    log("STEP 5", "써클차트(Circle Chart) 최신 월간 판매량 수집 실행...")
    crawler = HANTEO_DIR / "circle_monthly_crawler.py"
    res = run_proc([sys.executable, str(crawler), "--update"], "STEP 5")
    if res.returncode == 0:
        log("STEP 5", "써클차트 최신 월간 판매량 수집 완료!")
        return True
    else:
        log("STEP 5", f"써클차트 수집 실패:\n{res.stderr}\n{res.stdout}")
        return False

def step6_sync_sales_to_namu():
    log("STEP 6", "써클 판매량 실측치 및 타임라인을 namu-groups/*.json 에 동기화...")
    syncer = SCRIPTS_DIR / "sync_circle_sales_to_namu.py"
    res = run_proc([sys.executable, str(syncer)], "STEP 6")
    if res.returncode == 0:
        log("STEP 6", f"판매량 동기화 완료: {res.stdout.strip()}")
        return True
    else:
        log("STEP 6", f"동기화 실패:\n{res.stderr}\n{res.stdout}")
        return False

def step7_rebuild_static_pages():
    log("STEP 7", "정적 HTML 페이지 재빌드(Re-baking) 실행...")
    builder = BUILD_DIR / "generate_static.py"
    res = run_proc([sys.executable, str(builder)], "STEP 7")
    if res.returncode == 0:
        log("STEP 7", f"HTML 재빌드 완료: {res.stdout.strip()}")
        return True
    else:
        log("STEP 7", f"빌드 실패:\n{res.stderr}")
        return False

def main():
    print("=" * 65)
    print("🚀 [K-POP 스트리밍 & 음반 판매량 월간 전수 자동 최신화 파이프라인]")
    print(f"   실행일시: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 65)

    # 1. Spotify Token
    if not step1_capture_spotify_token():
        sys.exit(1)

    # 2. Spotify Live Metrics
    if not step2_collect_spotify_data():
        sys.exit(1)

    # 3. Merge Spotify
    if not step3_merge_to_namu_groups():
        sys.exit(1)

    # 4. YT Music Live Views (6,400+ tracks)
    if not step4_collect_ytmusic_data():
        sys.exit(1)

    # 5. Circle Monthly Chart Sales
    if not step5_collect_circle_sales():
        sys.exit(1)

    # 6. Sync Sales to Groups
    if not step6_sync_sales_to_namu():
        sys.exit(1)

    # 7. Rebuild static HTML
    if not step7_rebuild_static_pages():
        sys.exit(1)

    print("=" * 65)
    print("🎉 Spotify + YouTube Music + 음반 판매량 모든 데이터 업데이트 완료!")
    print("=" * 65)

if __name__ == "__main__":
    main()
