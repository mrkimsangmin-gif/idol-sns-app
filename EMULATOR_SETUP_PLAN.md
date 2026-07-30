# SNS 크롤링용 에뮬레이터 환경 구축 계획

## 목표
PC 에뮬레이터에서 SNS 앱의 HTTPS 트래픽을 mitmproxy로 캡처하여
비공개 API 엔드포인트를 발견하고, 크롤링 스크립트를 작성한다.

## 대상 플랫폼
1. **Weibo** — API 엔드포인트 발견 (크롤러 신규 개발)
2. **LinkedIn** — API 구조 파악 (크롤러 신규 개발)
3. **Instagram** — 내부 API 캡처 (saves/shares 등 비공개 지표)
4. **Spotify** — 내부 API 완성

## Step 1: LDPlayer 9 설치
- 설치 경로: `C:\LDPlayer\LDPlayer9`
- Android 9 (API 28) 기본 — SNS 앱 호환성 최상
- 설치 후 ADB 브릿지 활성화

## Step 2: 에뮬레이터 기본 설정
- 해상도: 1080x1920 (FHD)
- RAM: 4GB
- CPU: 4코어
- Root 권한 활성화 (LDPlayer 내장)
- ADB 디버깅 활성화

## Step 3: Magisk 설치 (LSPosed 필요 시)
- LDPlayer 내장 root로 충분할 수 있음
- SSL Pinning 우회가 안 되면 Magisk + LSPosed 진행
  - Magisk 28.x APK 설치
  - LSPosed (Zygisk) 모듈 설치
  - TrustMeAlready 또는 SSLUnpinning 모듈

## Step 4: mitmproxy 인증서 설치
- mitmproxy 시작 → CA 인증서 생성
- 에뮬레이터에 시스템 CA로 설치:
  ```bash
  # mitmproxy CA를 DER→PEM 변환
  openssl x509 -inform PEM -subject_hash_old -in ~/.mitmproxy/mitmproxy-ca-cert.pem | head -1
  # hash.0 파일로 /system/etc/security/cacerts/에 push
  adb push <hash>.0 /system/etc/security/cacerts/
  chmod 644 /system/etc/security/cacerts/<hash>.0
  ```

## Step 5: SNS 앱 설치
- Weibo (com.sina.weibo)
- LinkedIn (com.linkedin.android)
- Instagram (com.instagram.android)
- Spotify (com.spotify.music)
- APK 소스: APKPure 또는 APKMirror

## Step 6: mitmproxy 프록시 설정
- PC에서 mitmproxy 실행: `mitmproxy --mode transparent` 또는 `--mode regular`
- 에뮬레이터 WiFi 프록시: PC IP:8080
- 또는 iptables transparent proxy

## Step 7: API 캡처 & 크롤러 개발
- 각 앱 실행 → mitmproxy에서 API 엔드포인트 캡처
- 헤더, 토큰, 파라미터 분석
- Python 크롤러 스크립트 작성

## 기존 환경과의 통합
- ADB: LDPlayer는 `emulator-5554` 등으로 인식
- uiautomator2: 에뮬레이터에서도 동일하게 사용 가능
- 기존 실기기(S23/A90)와 동시 사용 가능
