# aimcontents.com E2E 자동화 테스트

Playwright를 사용한 aimcontents.com의 크로스 브라우저/디바이스 E2E 테스트 프로젝트입니다.

## 🎯 왜 E2E 테스트가 필요한가?

E2E 테스트는 다음 문제를 자동으로 잡아냅니다:

- 메뉴는 열리지만 **하위 메뉴 클릭이 안 되는 경우**
- 특정 브라우저에서만 **필터/검색이 동작하지 않는 경우**
- 모바일에서만 **햄버거 메뉴가 열리지 않는 경우**
- JS 에러로 인해 **카드 렌더링이 중단된 경우**

👉 **"디자인은 멀쩡한데 실제로는 못 쓰는 상태"**를 가장 잘 잡아냅니다.

## 📋 테스트 범위

| 테스트 파일 | 설명 | 우선순위 |
|------------|------|---------|
| `navigation.spec.ts` | 네비게이션 메뉴 및 섹션 이동 | 🔴 필수 |
| `sns-ranking.spec.ts` | SNS 랭킹 탭/드롭다운/데이터 로딩 | 🔴 필수 |
| `job-listing.spec.ts` | 채용정보 카테고리 필터 | 🟡 권장 |
| `content-sections.spec.ts` | 뉴스/트렌드/링크 섹션 | 🟡 권장 |
| `mobile.spec.ts` | 모바일 전용 (터치, 햄버거 메뉴) | 🔴 필수 |
| `responsive-a11y.spec.ts` | 반응형/접근성/성능 | 🟢 선택 |
| `visual-regression.spec.ts` | 시각적 회귀 테스트 | 🟢 선택 |

## 🔧 설치

```bash
# 프로젝트 폴더로 이동
cd aimcontents-e2e

# 의존성 설치
npm install

# Playwright 브라우저 설치
npx playwright install
```

**또는 새로 시작하는 경우:**
```bash
npm init playwright@latest
```

## 🚀 테스트 실행

### 기본 실행 (모든 테스트, 모든 브라우저)
```bash
npm test
```

### 특정 브라우저만 실행
```bash
# Chrome만
npm run test:chrome

# 모바일만 (iPhone + Galaxy)
npm run test:mobile

# 모든 데스크톱 브라우저
npm run test:all-browsers
```

### 디버그 모드 (브라우저 보면서 실행)
```bash
npm run test:headed    # 브라우저 창 표시
npm run test:debug     # 단계별 디버깅
npm run test:ui        # Playwright UI 모드 (강력 추천!)
```

### 특정 테스트 파일만 실행
```bash
npx playwright test tests/navigation.spec.ts
npx playwright test tests/mobile.spec.ts
```

### 테스트 리포트 확인
```bash
npm run report
```

## 📱 테스트 환경

### 데스크톱 브라우저
- Chrome (Chromium)
- Firefox
- Safari (WebKit)
- Edge

### 모바일 디바이스
- iPhone 13 (iOS Safari)
- iPhone 14 Pro Max
- Pixel 5 (Android Chrome)
- Galaxy S9+

### 태블릿
- iPad Pro 11
- Galaxy Tab S4

## 📁 프로젝트 구조

```
aimcontents-e2e/
├── playwright.config.ts    # 테스트 설정 (브라우저, 디바이스 목록)
├── package.json            # 의존성 및 스크립트
├── .github/
│   └── workflows/
│       └── e2e-test.yml    # GitHub Actions CI 설정
├── tests/
│   ├── navigation.spec.ts      # 네비게이션 테스트
│   ├── sns-ranking.spec.ts     # SNS 랭킹 테스트
│   ├── job-listing.spec.ts     # 채용정보 테스트
│   ├── content-sections.spec.ts # 콘텐츠 섹션 테스트
│   ├── mobile.spec.ts          # 모바일 전용 테스트
│   ├── responsive-a11y.spec.ts # 반응형/접근성 테스트
│   └── visual-regression.spec.ts # 시각적 회귀 테스트
├── playwright-report/      # HTML 테스트 리포트 (자동 생성)
└── test-results/           # 스크린샷, 비디오 (자동 생성)
    └── screenshots/
```

## 🛠 선택자 커스터마이징

실제 사이트 HTML 구조에 맞게 선택자를 수정해야 할 수 있습니다.

### 선택자 찾는 방법 (Codegen 강력 추천!)

```bash
npm run codegen
# 또는
npx playwright codegen aimcontents.com
```

브라우저가 열리면 사이트에서 메뉴를 클릭하고 돌아다니는 모든 동작이 **자동으로 테스트 코드로 변환**됩니다.

### 권장 선택자 우선순위

```typescript
// 1순위: 시맨틱 선택자 (가장 안정적)
page.getByRole('link', { name: 'SNS랭킹' })
page.getByRole('button', { name: '검색' })

// 2순위: 텍스트 기반
page.locator('text=SNS랭킹')

// 3순위: aria-label (테스트용으로 추가 권장)
page.locator('[aria-label="메뉴 열기"]')

// 4순위: data-testid (개발팀과 협의 필요)
page.locator('[data-testid="sns-ranking-tab"]')

// 5순위: CSS 클래스 (변경 가능성 높음)
page.locator('.idol-card')
```

## ⚙️ GitHub Actions 연동 (무료 CI)

`.github/workflows/e2e-test.yml` 파일이 이미 포함되어 있습니다.

**효과:**
- 코드 푸시할 때마다 자동 테스트
- 메뉴 하나라도 깨지면 **자동으로 실패 알림**
- PR 머지 전 검증 가능

## 📈 현실적인 도입 로드맵

| 단계 | 목표 | 예상 시간 |
|------|------|----------|
| 1주차 | 메뉴 이동 + 모바일 햄버거 테스트 | 2-3시간 |
| 2주차 | SNS 랭킹 필터/검색 | 2-3시간 |
| 3주차 | 엔터뉴스/외부 링크 | 1-2시간 |
| 이후 | 회귀 버그 발생 시 테스트 추가 | 지속적 |

## 📊 테스트 리포트

테스트 실행 후 자동으로 HTML 리포트가 생성됩니다:
- 위치: `playwright-report/index.html`
- 실행: `npm run report`

리포트에서 확인 가능한 정보:
- ✅ 성공/실패 테스트 목록
- 📸 실패 시 스크린샷
- 🎬 실패 시 비디오 (설정 시)
- 📝 에러 메시지 및 스택 트레이스

## 🔍 문제 해결

### 1. 타임아웃 에러
```typescript
// playwright.config.ts에서 타임아웃 증가
use: {
  actionTimeout: 10000,  // 액션 타임아웃 10초
  navigationTimeout: 30000,  // 네비게이션 30초
}
```

### 2. 요소를 찾지 못함
- `npm run codegen`으로 실제 선택자 확인
- `waitForSelector` 추가로 대기 시간 확보

### 3. 네트워크 에러
```typescript
// 네트워크 대기
await page.waitForLoadState('networkidle');
```

### 4. 모바일에서만 실패
- `isMobile` 파라미터로 모바일 분기 처리
- 햄버거 메뉴 열기 로직 추가

## 💡 핵심 원칙

1. **"모든 것"이 아니라 "깨지면 치명적인 것"만 테스트**
2. **"버튼이 있다"가 아니라 "기능이 실제로 작동한다"를 검증**
3. **클래스/aria-label은 테스트용으로 안정적인 값 사용**
4. **회귀 버그 발생 시 해당 케이스 테스트 추가**

## 📚 참고 자료

- [Playwright 공식 문서](https://playwright.dev/docs/intro)
- [디바이스 목록](https://playwright.dev/docs/emulation#devices)
- [선택자 가이드](https://playwright.dev/docs/selectors)
- [GitHub Actions 연동](https://playwright.dev/docs/ci-intro)
