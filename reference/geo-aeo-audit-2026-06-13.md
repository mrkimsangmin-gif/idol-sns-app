# GEO/AEO 정밀 진단 리포트 — aimcontents.com

> 작성일: 2026-06-13 · 대상: `idol-sns-app` (GitHub Pages, 커스텀 도메인 `aimcontents.com`)
> 목적: 코드 수정 전, 생성형 엔진/답변 엔진 최적화(GEO·AEO) 현황 진단 및 우선순위 도출
> 방법: 라이브 사이트 크롤러 시점 fetch(GPTBot UA 포함) + 로컬 소스(index.html, 404.html, script.js, sitemap) 정적 분석

---

## 0. 한 줄 결론

**GEO/AEO 진행은 가능하며, 데이터가 풍부해 잠재력이 큰 사이트다.** 단, 현재는 **SPA(JS 렌더링) + GitHub Pages 404 리다이렉트** 구조 때문에 AI 답변 엔진이 핵심 콘텐츠(랭킹·173개 그룹 페이지)를 **거의 보지 못한다.** 최우선 과제는 콘텐츠를 HTML에 정적으로 박는 **prerendering(정적 페이지 생성)**이며, 이것 없이는 llms.txt·스키마 보강의 효과가 제한적이다.

### 종합 점수 (10점 만점)

| 차원 | 점수 | 메모 |
|---|---|---|
| 크롤링 접근성 (robots/sitemap) | 8 | robots 전체 허용·sitemap 등록 양호. lastmod 정체가 감점 |
| **AI 크롤러 콘텐츠 가시성 (렌더링)** | **2** | **핵심 블로커.** 동적 콘텐츠·엔티티 페이지가 HTML에 없음 |
| 구조화 데이터 (Schema.org) | 6 | 홈은 우수, 개별 페이지·FAQ·JobPosting 부재 |
| 인용 가능성 (AEO 콘텐츠 구조) | 5 | noscript 정적 표는 강점, 통계 콜아웃·출처·갱신일 부족 |
| llms.txt / AI 전용 가이드 | 0 | 없음(404) |
| 메타데이터 품질 | 6 | 홈 메타 우수, 페이지별 메타는 JS 의존(크롤러 불가시) |

---

## 1. 🔴 P0 — 치명적: AI 크롤러가 콘텐츠를 못 본다

### 1-1. 동적 렌더링 (SPA)
- **증거**: `GPTBot/1.0` UA로 홈을 받으면 "불러오는 중…" 플레이스홀더 **16개**. 랭킹·뉴스·채용 실데이터가 HTML에 없음.
- **원인**: 모든 핵심 섹션이 JS fetch 후 클라이언트 렌더링. GPT/Claude/Perplexity/Google AI Overviews 크롤러는 JS 실행이 제한적 → 빈 셸을 봄.

### 1-2. 엔티티 페이지 173개가 HTTP 404
- **증거**: `curl https://aimcontents.com/namu/bts` → **HTTP 404**, `<title>Redirecting...</title>`, 본문 1072 bytes(BTS 콘텐츠 0).
- **원인**: GitHub Pages SPA 라우팅 핵(`404.html:10-16` → `l.replace('/?/'+path)`, `index.html:40-51`에서 경로 복원). 미지정 경로는 **404 상태 코드**로 응답 후 JS 리다이렉트.
- **영향**: 가장 인용 가치 높은 콘텐츠(그룹별 프로필·디스코그래피·판매량)가 AI 엔진·검색엔진에 **사실상 존재하지 않음.** sitemap에 173개를 등록해도 fetch 시 404.

### 1-3. 페이지별 메타가 JS로만 갱신
- **증거**: `script.js:804-812, 901-917` — `document.title`, `meta[description]`, `canonical`, `og:*`를 라우트 전환 시 JS로 교체.
- **영향**: JS 미실행 크롤러는 **모든 경로에서 홈의 일반 메타**(또는 404)를 봄. 페이지별 SEO/AEO 메타가 무효.

> **결론**: P1 이하 항목을 손대기 전에 **1-2(엔티티 페이지 정적화)부터 해결**해야 ROI가 나온다.

---

## 2. 🟠 P1 — 높음

### 2-1. llms.txt 부재
- `/llms.txt` → 404. AI 엔진에 사이트 구조·핵심 데이터·인용 가이드를 제공하는 표준 파일 없음.
- **권장**: `/llms.txt`(요약 + 핵심 URL 맵) + `/llms-full.txt`(그룹·랭킹 요약 데이터) 생성. 로컬 `data/*.json`으로 자동 생성 가능.

### 2-2. 사이트맵 freshness 정체
- `<lastmod>` 194개가 **전부 `2026-04-02`** (오늘 2026-06-13 기준 2개월+ 정체). 매월 갱신되는 데이터 특성과 불일치 → 신선도 신호 약화.
- **권장**: 빌드 시 실제 데이터 갱신일로 lastmod 자동 기입. `changefreq` 정합성 점검.

### 2-3. 정적 콘텐츠가 홈에만 존재
- 강력한 `<noscript>` 그룹 표(`index.html:815~`)가 **홈 1곳에만** 있음. 개별 그룹/랭킹/채용 페이지에는 정적 폴백 없음.

---

## 3. 🟡 P2 — 중간 (구조화 데이터·인용 최적화)

- **ItemList 부분 커버**: 홈 JSON-LD ItemList에 **173개 중 16개**만(`index.html:146-163`). 전수 + 개별 페이지 `MusicGroup` 스키마 필요.
- **FAQPage 스키마 부재**: AEO에서 답변 직접 인용을 유도하는 FAQ 스키마 없음.
- **JobPosting 스키마 부재**: `/jobs`에 Google for Jobs/AI 인용용 `JobPosting` 스키마 미적용(현재 데이터는 `data/jobs.json`에 존재).
- **BreadcrumbList 부재**: 엔티티 계층 신호 없음.
- **noscript 링크가 404로 연결**: `index.html:834~`의 `/namu/{group}` 링크가 1-2 블로커로 인해 죽은 링크.
- **통계 인용 요소 부족**: AEO는 "출처·수치·날짜"가 명시된 문장을 선호. 현재 수치는 차트(JS) 안에 갇혀 텍스트 인용 불가.

---

## 4. 🟢 이미 잘 되어 있는 것 (유지)

- robots.txt 전체 허용 + sitemap 등록, AI 봇 차단 없음 (`GPTBot/ClaudeBot/PerplexityBot` 등 허용).
- 홈 JSON-LD 4종: `Organization`(+alternateName), `WebSite`(+SearchAction), `Dataset`, `ItemList`.
- 홈 메타: title/description/keywords/canonical/OG/Twitter/google-site-verification 완비.
- `<noscript>` 폴백에 걸그룹/보이그룹 전수 표(소속사·데뷔·멤버) — 크롤러용 콘텐츠로 양질.
- 봇 감지 로직(`index.html:56-67`)은 현재 GA4 억제 용도로만 사용 → **클로킹 아님**(콘텐츠를 봇별로 다르게 주지 않음). 단, 향후 콘텐츠 분기에 쓰면 클로킹 위험이니 금지 원칙 명시 필요.

---

## 5. 권장 로드맵 (효과 × 노력)

| 우선 | 작업 | 효과 | 노력 | 비고 |
|---|---|---|---|---|
| **1** | **엔티티/주요 라우트 정적 HTML 생성 파이프라인** | ★★★★★ | ★★★★ | `data/*.json` → 173 그룹 + /jobs + /ranking 정적 페이지(콘텐츠+페이지별 JSON-LD). 404 핵 제거 |
| 2 | llms.txt + llms-full.txt 생성 | ★★★ | ★ | 자동 생성, 빌드에 포함 |
| 3 | 페이지별 JSON-LD(MusicGroup/FAQPage/JobPosting/BreadcrumbList) | ★★★★ | ★★ | 정적 페이지 생성과 함께 박기 |
| 4 | sitemap lastmod 실데이터 연동 + freshness | ★★ | ★ | 빌드 스크립트에 통합 |
| 5 | 인용 최적화(통계 콜아웃 텍스트, 출처/갱신일 표기, FAQ 본문) | ★★★ | ★★ | AEO 인용률 직접 상승 |

> 1·3·4를 **하나의 정적 생성 빌드 스크립트**로 묶는 것이 핵심. GitHub Pages는 정적 호스팅이므로 SSR 대신 "빌드 타임 prerender" 전략이 정답이며, 데이터가 이미 로컬 JSON으로 존재해 실현 가능성이 높다.

---

## 6. 부록 — 증거 인덱스

| 항목 | 위치 |
|---|---|
| GitHub Pages 404 리다이렉트 | `404.html:10-16`, `index.html:40-51` |
| 페이지별 meta JS 갱신 | `script.js:804-812`, `script.js:901-917` |
| 홈 JSON-LD 4종 | `index.html:91-165` |
| noscript 정적 표 | `index.html:815-1215` |
| 봇 감지 | `index.html:56-67` |
| jobs 데이터 원천 | `data/jobs.json` (175건) |
| sitemap | `https://aimcontents.com/sitemap.xml` (203 URL, lastmod 194개 = 2026-04-02 고정) |
| robots | `https://aimcontents.com/robots.txt` (전체 허용) |
| AI 크롤러 시점 | `curl -A GPTBot https://aimcontents.com/` → "불러오는 중" 16개 / `/namu/bts` → 404 |
| 호스팅 판별 | `curl -I` → `Server: GitHub.com` + Fastly CDN, `cf-ray` 없음 → **GitHub Pages (Cloudflare 아님)** |

---

## 7. 외부 진단 대조 (제3자 GEO/AEO 컨설팅 검토)

> 별도 AI/컨설팅이 작성한 진단을 본 리포트의 실측 결과와 대조. 채택할 부분과 사실 오류를 분리한다.

### 7-1. ✅ 채택 — 본 리포트를 보완하는 유효 제안 (주로 오프사이트·콘텐츠 전략)

| 항목 | 평가 | 본 리포트 연결 |
|---|---|---|
| **Q&A 자기완결 문장** ("주어+기준시점+수치+맥락" = AI 발췌 단위) | ★ 최고의 실전 팁 | P2 "인용 최적화" 구체화 |
| **월별 영구 URL** `/ranking/2026-05/weibo-boys` | ★ 시점별 인용 URL | 로드맵 1번(정적 생성) 구체화 |
| **오프사이트 인용 축적** (월간 데이터 리포트·매체 인용·나무위키 출처화) | ★ "GEO의 절반은 사이트 밖" | 본 리포트 미커버 공백 보완 |
| **E-E-A-T 방법론/운영자 페이지** (집계 기준·운영주체·칼럼/출강 이력) | ★ 신뢰도 신호 | 신규 채택 |
| **영문/중문 요약 페이지** | ★ 영어 질의 다수, 글로벌 인용 | 신규 채택 |
| llms.txt 포지셔닝 문구 | ○ | P1-2-1과 동일 방향 |
| Princeton GEO 연구(통계·출처·인용·정의 → 인용률↑) | ○ 방향 정확 | 데이터 풍부성과 정합 |
| Dataset 스키마 → Google Dataset Search 노출 | ○ 정확한 보너스 | P2 보강 |

### 7-2. ⚠️ 폐기 — 실측과 불일치하는 사실 오류

1. **"JSON-LD가 없다(가장 큰 결손)"** → **오류.** 홈에 4종 존재(`index.html:91-165`). 실제 과제는 "없음"이 아니라 *개별 페이지 미적용 + ItemList 173 중 16만*.
2. **"Cloudflare Pages / Block AI Bots 옵션 확인이 10분 최우선"** → **오류.** `Server: GitHub.com`+Fastly로 **GitHub Pages**(Cloudflare 아님). robots `Allow: /`로 봇 차단 이슈 없음 → 해당 없음.
3. **"개별 그룹 URL(/namu/bts)이 이미 갖춰짐 = 강점"** → **반대.** 직접 접속 시 HTTP 404(SPA 핵). 강점이 아니라 **최대 약점(P0-1-2)**. 외부 글은 이 핵심 블로커를 놓침.

> 부수: "robots에 GPTBot 등 명시 허용"은 무해하나 이미 전체 허용이라 **필수 아님**.

### 7-3. 통합 우선순위 (두 진단 합본 — 실행 순서)

1. **🔑 정적 페이지 생성 파이프라인** — 173 그룹 + **월별 영구 랭킹 URL** + /jobs를 콘텐츠+페이지별 JSON-LD 박아 빌드 (404 핵 제거 포함, 두 진단 공통 1순위)
2. 정적 페이지에 **Q&A 자기완결 문장** + FAQPage/MusicGroup/Dataset/JobPosting 스키마 주입
3. llms.txt + 방법론/E-E-A-T 페이지
4. sitemap lastmod 실데이터 연동
5. **오프사이트 인용 축적** (월간 데이터 리포트·매체/나무위키 출처화) ← 외부 진단의 최대 기여
6. 영문/중문 요약 페이지
