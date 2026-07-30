#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
setup_spotify.py — Spotify 인증 설정 도우미

방법 A: 브라우저 Bearer 토큰 (monthly_listeners + followers + popularity)
  → Chrome에서 JS 스니펫 실행 → 결과 붙여넣기 → 캐시 저장
  → 유효기간 ~1시간 (주 1회 오케스트레이터 실행 전 갱신 필요)
  → Akamai Bot Manager가 get_access_token 직접 호출 차단 → 브라우저만 가능

방법 B: Client Credentials (followers + popularity, monthly_listeners 없음)
  → developer.spotify.com 앱 등록 (무료 5분) → CLIENT_ID + SECRET
  → run_orchestrator.bat 자동 수정 → 영구 자동 갱신

실행:
  C:\\Python314\\python.exe setup_spotify.py          # 대화형
  C:\\Python314\\python.exe setup_spotify.py --method a   # 방법 A만
  C:\\Python314\\python.exe setup_spotify.py --method b   # 방법 B만
"""

import sys
import io
import os
import re
import json
import time
import base64
import argparse
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

BASE_DIR    = Path(r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app")
BAT_FILE    = BASE_DIR / "run_orchestrator.bat"
TOKEN_CACHE = BASE_DIR / "data/timeseries/spotify/spotify_token_cache.json"


# ─────────────────────────────────────────────────────────────────────────────
# 방법 A: 브라우저 Bearer 토큰
# ─────────────────────────────────────────────────────────────────────────────
CHROME_SNIPPET = r"""
fetch('/get_access_token?reason=transport&productType=web_player')
  .then(r=>r.json())
  .then(d=>console.log(JSON.stringify({
    access_token: d.accessToken,
    expires_at: d.accessTokenExpirationTimestampMs,
    is_anonymous: d.isAnonymous
  })))
""".strip()


def setup_method_a():
    """브라우저 Bearer 토큰 추출 → 캐시 저장."""
    print()
    print("=" * 62)
    print("  방법 A: 브라우저 Bearer 토큰 (monthly_listeners 포함)")
    print("=" * 62)
    print()
    print("  이 방법은 Spotify를 완전히 로그인한 Chrome 브라우저에서")
    print("  토큰을 직접 추출합니다. 유효기간 ~1시간.")
    print()
    print("  ① Chrome에서 open.spotify.com 접속 (플레이어 재생 화면)")
    print("  ② F12 → Console 탭")
    print("  ③ 아래 코드를 붙여넣고 Enter:")
    print()
    print("  " + "-" * 58)
    for line in CHROME_SNIPPET.split("\n"):
        print(f"  {line}")
    print("  " + "-" * 58)
    print()
    print("  ④ Console에 출력된 JSON 전체를 아래에 붙여넣기")
    print()

    raw = input("JSON 결과 붙여넣기: ").strip()
    if not raw:
        print("✗ 빈 값입니다.")
        return False

    try:
        d = json.loads(raw)
    except json.JSONDecodeError:
        # access_token만 입력한 경우 처리
        if len(raw) > 50 and not raw.startswith("{"):
            d = {"access_token": raw, "expires_at": (time.time() + 3600) * 1000, "is_anonymous": False}
        else:
            print("✗ JSON 파싱 실패. Console 출력 전체를 복사하세요.")
            return False

    token    = d.get("access_token", d.get("accessToken", ""))
    expires  = d.get("expires_at", d.get("accessTokenExpirationTimestampMs", 0))
    is_anon  = d.get("is_anonymous", d.get("isAnonymous", True))

    if not token:
        print("✗ access_token이 없습니다.")
        return False
    if is_anon:
        print("✗ 익명 토큰 — open.spotify.com에 완전히 로그인되지 않은 상태입니다.")
        return False

    expires_ts = expires / 1000 if expires > 1e10 else expires
    remaining  = max(0, int(expires_ts - time.time()))

    # 캐시 저장
    TOKEN_CACHE.parent.mkdir(parents=True, exist_ok=True)
    with open(TOKEN_CACHE, "w", encoding="utf-8") as f:
        json.dump({"access_token": token, "expires_at": expires_ts, "source": "browser"}, f)

    print()
    print(f"✓ 토큰 저장 완료 (유효기간: {remaining // 60}분 {remaining % 60}초)")
    print(f"  → {TOKEN_CACHE}")
    print()
    print("  이 토큰으로 monthly_listeners + followers + popularity 수집 가능.")
    print("  ⚠  ~1시간 후 만료 → 주간 수집 직전에 이 스크립트를 다시 실행하세요.")
    return True


# ─────────────────────────────────────────────────────────────────────────────
# 방법 B: Client Credentials
# ─────────────────────────────────────────────────────────────────────────────
def verify_client_credentials(client_id: str, client_secret: str) -> bool:
    """Client Credentials로 토큰 발급 → 유효성 확인."""
    credentials = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    data = urllib.parse.urlencode({"grant_type": "client_credentials"}).encode()
    req = urllib.request.Request(
        "https://accounts.spotify.com/api/token",
        data=data,
        headers={
            "Authorization": f"Basic {credentials}",
            "Content-Type": "application/x-www-form-urlencoded",
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            d = json.loads(resp.read())
        if d.get("access_token"):
            print(f"✓ 인증 성공 (token_type: {d.get('token_type')}, expires_in: {d.get('expires_in')}s)")
            return True
        else:
            print(f"✗ 인증 실패: {d}")
            return False
    except urllib.error.HTTPError as e:
        print(f"✗ HTTP {e.code} — CLIENT_ID 또는 CLIENT_SECRET이 잘못됨")
        return False
    except Exception as e:
        print(f"✗ 오류: {e}")
        return False


def save_credentials_to_bat(client_id: str, client_secret: str) -> None:
    """run_orchestrator.bat에 SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET 추가/갱신."""
    if not BAT_FILE.exists():
        print(f"⚠  bat 파일 없음: {BAT_FILE}")
        return

    with open(BAT_FILE, encoding="utf-8") as f:
        content = f.read()

    def replace_or_insert(content: str, key: str, value: str) -> str:
        new_line = f"set {key}={value}"
        pattern = rf"(?m)^.*set {key}.*$"
        if re.search(pattern, content):
            return re.sub(pattern, new_line, content)
        # 없으면 GOOGLE_API_KEY 줄 다음에 추가
        return content.replace(
            "set GOOGLE_API_KEY=",
            f"{new_line}\nset GOOGLE_API_KEY="
        )

    content = replace_or_insert(content, "SPOTIFY_CLIENT_ID", client_id)
    content = replace_or_insert(content, "SPOTIFY_CLIENT_SECRET", client_secret)

    with open(BAT_FILE, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"✓ bat 파일 업데이트: SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET")


def setup_method_b():
    """Client Credentials 설정 → bat 파일 업데이트."""
    print()
    print("=" * 62)
    print("  방법 B: Spotify Client Credentials (followers + popularity)")
    print("=" * 62)
    print()
    print("  monthly_listeners는 수집 불가하지만, 자동 갱신되어 영구적입니다.")
    print()
    print("  ① developer.spotify.com 로그인")
    print("  ② Dashboard → Create App")
    print("  ③ App name: KPop SNS Tracker (아무 이름)")
    print("  ④ Redirect URIs: http://localhost → Add")
    print("  ⑤ Web API 체크 → Save")
    print("  ⑥ 앱 페이지 → Client ID 복사 / View client secret → 복사")
    print()

    client_id = input("Client ID 입력: ").strip()
    if not client_id:
        print("✗ 빈 값입니다.")
        return False

    client_secret = input("Client Secret 입력: ").strip()
    if not client_secret:
        print("✗ 빈 값입니다.")
        return False

    print()
    print("  검증 중...")
    ok = verify_client_credentials(client_id, client_secret)
    if ok:
        save_credentials_to_bat(client_id, client_secret)
        print()
        print("✓ 설정 완료! 오케스트레이터 재시작 시 적용됩니다.")
        print("  followers + popularity 매주 월요일 09:00 자동 수집.")
    return ok


# ─────────────────────────────────────────────────────────────────────────────
# 메인
# ─────────────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--method", choices=["a", "b", "A", "B"], help="a=브라우저토큰 b=ClientCredentials")
    args = parser.parse_args()

    method = (args.method or "").lower()

    if method == "a":
        setup_method_a()
    elif method == "b":
        setup_method_b()
    else:
        print()
        print("=" * 62)
        print("  Spotify 인증 설정 도우미")
        print("=" * 62)
        print()
        print("  방법 A: 브라우저 Bearer 토큰")
        print("    → monthly_listeners + followers + popularity 수집 가능")
        print("    → 유효기간 ~1시간 (주간 수집 직전 갱신 권장)")
        print()
        print("  방법 B: Client Credentials (developer.spotify.com)")
        print("    → followers + popularity만 (monthly_listeners 없음)")
        print("    → 자동 갱신, 영구적")
        print()
        print("  두 방법을 모두 설정하면 방법 A 우선 (만료 시 방법 B 폴백)")
        print()
        choice = input("설정할 방법 선택 [A/B/둘다]: ").strip().lower()

        if choice in ("a",):
            setup_method_a()
        elif choice in ("b",):
            setup_method_b()
        else:
            # 둘 다 (기본)
            ok_a = setup_method_a()
            print()
            ok_b = setup_method_b()
            if ok_a or ok_b:
                print()
                print("=" * 62)
                print("  설정 완료!")
                if ok_a:
                    print("  ✓ 방법 A (브라우저 토큰) — monthly_listeners 수집 가능")
                if ok_b:
                    print("  ✓ 방법 B (Client Credentials) — followers/popularity 자동 수집")
                print("=" * 62)


if __name__ == "__main__":
    main()
