# aimcontents.com E2E 테스트 - 실행 가이드

## 📋 목차
1. [PC에서 바로 테스트 실행하기](#1-pc에서-바로-테스트-실행하기)
2. [테스트 결과 확인하기](#2-테스트-결과-확인하기)
3. [정기 자동 테스트 + 이메일 알림 설정](#3-정기-자동-테스트--이메일-알림-설정)
4. [참고: 브라우저에서 직접 빠른 체크](#4-참고-브라우저에서-직접-빠른-체크)

---

## 1. PC에서 바로 테스트 실행하기

### 사전 준비
- **Node.js 18+** 설치: https://nodejs.org (LTS 버전 다운로드)
- 설치 확인: PowerShell에서 `node --version` 입력

### ⚠️ 중요: 반드시 로컬 경로에서 실행

Google Drive 경로(G:\내 드라이브\...)에서는 npm이 정상 동작하지 않습니다.

```powershell
# PowerShell에서 실행

# 1. 로컬 경로에 폴더 생성 및 이동
mkdir C:\aimcontents-e2e
cd C:\aimcontents-e2e

# 2. 프로젝트 파일 복사 (Google Drive에서 로컬로)
#    → 또는 이 폴더의 파일들을 C:\aimcontents-e2e에 직접 복사

# 3. 의존성 설치
npm install

# 4. Playwright 브라우저 설치 (최초 1회)
npx playwright install chromium
```

### 테스트 실행

```powershell
# 🟢 기본 실행 (Chrome, 모든 테스트) — 가장 많이 사용
npm test

# 🟡 빠른 체크 (네비게이션 + SEO만, 2~3분)
npm run test:quick

# 🔵 브라우저 화면 보면서 실행 (디버깅)
npm run test:headed

# 🟣 Playwright UI 모드 (강력 추천! 클릭으로 테스트 관리)
npm run test:ui

# 📱 모바일 테스트
npm run test:mobile

# 🌐 모든 브라우저 (Chrome + Firefox + Safari)
npm run test:all
```

### 개별 테스트 파일 실행

```powershell
# 네비게이션만
npx playwright test tests/navigation.spec.ts --project="Desktop Chrome"

# SNS 랭킹만
npx playwright test tests/sns-ranking.spec.ts --project="Desktop Chrome"

# SEO만
npx playwright test tests/seo.spec.ts --project="Desktop Chrome"

# 콘텐츠 섹션만
npx playwright test tests/content-sections.spec.ts --project="Desktop Chrome"

# 모바일만
npx playwright test tests/mobile.spec.ts --project="iPhone 13"
```

---

## 2. 테스트 결과 확인하기

### 터미널 출력 (즉시 확인)
```
  ✅  12 passed
  ❌   2 failed
  ⚠️   1 skipped
```

### HTML 리포트 (상세 확인)
```powershell
npm run report
```
브라우저가 열리면서 시각적 리포트가 표시됩니다:
- 성공/실패 목록
- 실패 시 스크린샷
- 에러 메시지

### 실패 시 스크린샷 위치
- `test-results/` 폴더에 자동 저장

---

## 3. 정기 자동 테스트 + 이메일 알림 설정

GitHub Actions를 사용하면 **매일 자동으로** 테스트가 실행되고, 실패 시 이메일을 받을 수 있습니다. 무료입니다.

### Step 1: GitHub 리포지토리 생성

```powershell
cd C:\aimcontents-e2e

# Git 초기화
git init
git add .
git commit -m "E2E 테스트 프로젝트 초기 설정"

# GitHub에 리포지토리 만들기 (github.com에서 New Repository)
# 예: https://github.com/[사용자명]/aimcontents-e2e

# 원격 연결 및 푸시
git remote add origin https://github.com/[사용자명]/aimcontents-e2e.git
git branch -M main
git push -u origin main
```

### Step 2: 이메일 알림 설정 (Secrets 등록)

GitHub 리포지토리 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

3개의 Secret을 추가합니다:

| Secret 이름 | 값 | 설명 |
|-------------|---|------|
| `EMAIL_USERNAME` | `your-email@gmail.com` | 발송용 Gmail 주소 |
| `EMAIL_PASSWORD` | `xxxx xxxx xxxx xxxx` | Gmail 앱 비밀번호 (※아래 참고) |
| `NOTIFY_EMAIL` | `your-email@gmail.com` | 알림 받을 이메일 주소 |

### Gmail 앱 비밀번호 생성 방법

1. https://myaccount.google.com/security 접속
2. "2단계 인증" 활성화 (아직 안 했다면)
3. "앱 비밀번호" 클릭
4. 앱 이름에 "AIM E2E Bot" 입력
5. 생성된 16자리 비밀번호를 `EMAIL_PASSWORD`에 저장

### Step 3: 자동 실행 확인

Push 후 GitHub → **Actions** 탭에서 워크플로우가 표시됩니다.

- **매일 오전 9시 (한국시간)**: 자동 실행
- **코드 push 시**: 자동 실행
- **수동 실행**: Actions → "E2E Test" → "Run workflow" 클릭

### 알림 규칙
- **실패 시**: 즉시 이메일 발송
- **성공 시**: 월요일에만 주간 요약 이메일 발송
- **리포트**: GitHub Actions 페이지에서 artifact 다운로드 가능

---

## 4. 참고: 브라우저에서 직접 빠른 체크

Playwright 설치 없이 바로 할 수 있는 방법입니다.

### A. Lighthouse (성능/SEO 점수)
1. aimcontents.com 접속
2. `F12` → **Lighthouse** 탭
3. "페이지 로드 분석" 클릭
4. Performance, SEO 점수 확인 (80점 이상이면 양호)

### B. Network 탭 (API 속도)
1. `F12` → **Network** 탭
2. 사이트 새로고침
3. `exec` 검색 → GAS API 응답 시간 확인
4. 3초 이상이면 데이터 최적화 필요

### C. Gremlins.js (무작위 버그 탐색)
1. `F12` → **Console** 탭
2. 아래 코드 붙여넣고 Enter:
```javascript
(function() {
    var s = document.createElement("script");
    s.src = "https://unpkg.com/gremlins.js";
    s.onload = function() { gremlins.createHorde().unleash(); };
    document.body.appendChild(s);
})();
```
3. 봇이 무작위로 클릭하며 에러를 찾음
4. 멈추려면 페이지 새로고침

---

## 📁 프로젝트 파일 구조

```
aimcontents-e2e/
├── package.json              # 의존성 및 npm 스크립트
├── playwright.config.ts      # 테스트 설정 (브라우저, 타임아웃)
├── .github/
│   └── workflows/
│       └── e2e-test.yml      # 정기 자동 실행 + 이메일 알림
├── tests/
│   ├── navigation.spec.ts    # 네비게이션 + URL 라우팅 (12개 항목)
│   ├── sns-ranking.spec.ts   # SNS 드롭다운/성별/월/검색/모달 (18개 항목)
│   ├── content-sections.spec.ts  # 뉴스/채용/업체/도우인/링크/컴백 (7개 항목)
│   ├── seo.spec.ts           # SEO meta/schema/robots/sitemap (13개 항목)
│   └── mobile.spec.ts        # 모바일 햄버거/터치/레이아웃 (6개 항목)
├── playwright-report/        # HTML 리포트 (자동 생성)
└── test-results/             # 스크린샷/비디오 (자동 생성)
```

## 테스트 항목 요약: 총 56개

| 파일 | 항목 수 | 내용 |
|------|--------|------|
| navigation | 12 | 8개 탭 전환 + 로고 + URL 직접 접속 + 뒤로가기 |
| sns-ranking | 18 | 초기 로딩 + 7개 SNS + 성별 + 월 + 검색 + 모달 |
| content-sections | 7 | 뉴스·채용·업체·도우인·링크·컴백 각 1개 |
| seo | 13 | title·desc·canonical·OG·schema·robots·sitemap·동적업데이트 |
| mobile | 6 | 햄버거·메뉴전환·스크롤·드롭다운·레이아웃 |
