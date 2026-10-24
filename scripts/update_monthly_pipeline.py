#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
update_monthly_pipeline.py — 매월 1회 실행하는 전수 자동 업데이트 통합 파이프라인
1. Chrome CDP를 통해 Spotify Web에서 최신 인증 토큰 및 클라이언트 토큰 자동 캡처
2. 전체 170+ 아이돌 그룹의 Spotify 월간 리스너 & Top 10 트랙 실시간 수집 (collect_spotify_live_all.py)
3. 수집된 최신 데이터를 namu-groups/*.json 데이터 파일에 병합 (merge_spotify_latest_to_namu.py)
4. namu 정적 페이지 및 인덱스 전체 재빌드 (generate_static.py)
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
BUILD_DIR = BASE_DIR / "build"
TEMP_DIR = Path("C:/temp")

def log(step, msg):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] [{step}] {msg}", flush=True)

def run_proc(cmd, step_name):
    # Use utf-8 encoding explicitly for subprocess to prevent CP949 errors on Windows
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    return res

def step1_capture_spotify_token():
    log("STEP 1", "Chrome CDP를 통한 Spotify Web 토큰 캡처 확인 중...")
    
    req_file = TEMP_DIR / "spotify_pathfinder_reqs.json"
    if req_file.exists():
        age = time.time() - req_file.stat().st_mtime
        if age < 1800:
            log("STEP 1", f"최근 캡처된 유효 토큰 발견 (경과 시간: {int(age)}초). 기존 토큰을 재사용합니다.")
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
    log("STEP 3", "수집된 데이터를 namu-groups/*.json 에 일괄 병합 중...")
    merger = SPOTIFY_DIR / "merge_spotify_latest_to_namu.py"
    res = run_proc([sys.executable, str(merger)], "STEP 3")
    if res.returncode == 0:
        log("STEP 3", "namu-groups 데이터 병합 완료!")
        return True
    else:
        log("STEP 3", f"병합 실패:\n{res.stderr}\n{res.stdout}")
        return False

def step4_rebuild_static_pages():
    log("STEP 4", "정적 HTML 페이지 재빌드(Re-baking) 실행...")
    builder = BUILD_DIR / "generate_static.py"
    res = run_proc([sys.executable, str(builder)], "STEP 4")
    if res.returncode == 0:
        log("STEP 4", f"HTML 재빌드 완료: {res.stdout.strip()}")
        return True
    else:
        log("STEP 4", f"빌드 실패:\n{res.stderr}")
        return False

def main():
    print("=" * 60)
    print("🚀 [K-POP 스트리밍 & 나무위키 월간 자동 최신화 파이프라인]")
    print(f"   실행일시: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    if not step1_capture_spotify_token():
        sys.exit(1)

    if not step2_collect_spotify_data():
        sys.exit(1)

    if not step3_merge_to_namu_groups():
        sys.exit(1)

    if not step4_rebuild_static_pages():
        sys.exit(1)

    print("=" * 60)
    print("🎉 모든 업데이트가 성공적으로 완료되었습니다!")
    print("=" * 60)

if __name__ == "__main__":
    main()
