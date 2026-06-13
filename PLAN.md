# PLAN — 정적 페이지 생성 파이프라인 (GEO/AEO 1순위)

> 작성일: 2026-06-13 · 근거: `reference/geo-aeo-audit-2026-06-13.md`
> 목적: SPA가 JS로만 그리는 콘텐츠를 **빌드 타임에 정적 HTML로 prerender**하여, AI 크롤러·검색엔진이 핵심 데이터(173+ 그룹, 월별 랭킹, 채용)를 직접 읽게 한다.
> 호스팅: **GitHub Pages**(SSR 불가) → "빌드 타임 정적 생성(SSG)" 전략이 정답.

---

## 0. 해결하려는 핵심 문제 (재확인)

- **P0-1**: 동적 콘텐츠가 HTML에 없음 → `GPTBot`엔 "불러오는 중" 16개만 보임
- **P0-2**: `/namu/<slug>` 등 엔티티 URL이 **HTTP 404**(GitHub Pages SPA 리다이렉트 핵) → 크롤러에 빈 페이지
- **P0-3**: 페이지별 meta/canonical이 JS로만 갱신 → 크롤러는 홈 메타만 봄

→ 세 가지 모두 **실제 정적 파일을 생성**하면 동시에 해결된다.

---

## 1. 설계 핵심 결정

### 1-1. 전략: "Prerender + Hydrate" (정적 HTML이 SPA를 부팅)
각 라우트에 **실제 콘텐츠가 박힌 `index.html`**을 생성하되, 기존 `script.js`/`namu.js`를 그대로 로드해 사람에겐 SPA로 동작하게 한다.
- **봇**: `<body>`에 박힌 정적 콘텐츠 + 페이지별 JSON-LD를 읽음
- **사람**: 정적 콘텐츠가 먼저 그려지고(FCP↑), JS가 동일 컨테이너에 hydrate
- ⚠️ **설계 리스크**: SPA 부팅 시 prerendered DOM을 지우고 다시 그리면 깜빡임/중복. → 정적 콘텐츠를 **SPA가 타겟하는 동일 컨테이너 ID**에 넣고, SPA는 "이미 채워져 있으면 교체 대신 갱신"하도록 소량 가드 추가. (Phase 0에서 1페이지로 검증 후 확정)

### 1-2. 빌드 도구: **Python + Jinja2**
- 이유: 이 리포의 크롤러/도구 체인이 전부 Python(`.claude/tools/*.py`, `06.*/*.py`). 데이터(`data/*.json`)를 읽어 템플릿 렌더만 하면 됨. Node 도입 불필요.
- 산출물은 **리포에 커밋**되어 GitHub Pages가 서빙(별도 배포 파이프라인 불필요).

### 1-3. URL 설계 (실제 파일 경로)
| 라우트 | 파일 | 개수 | 데이터 소스 |
|---|---|---|---|
| `/namu/<slug>/` | `namu/<slug>/index.html` | 190 | `namu-index.json` + `namu-wiki.json`(info·members·albums) |
| `/ranking/<YYYY-MM>/<platform>-<gender>/` | 동 경로 `index.html` | ~월별 | `sns-male.json`/`sns-female.json` (snsList 8 × gender 2 × months) |
| `/jobs/` | `jobs/index.html` | 1 | `data/jobs.json` (175) |
| `/methodology/` | `methodology/index.html` | 1 | 수기(운영주체·집계기준·플랫폼 8) |
| `/llms.txt`, `/llms-full.txt` | 루트 | 2 | 자동 생성 |
| `/sitemap.xml` | 루트 | 1 | 위 전체 URL + 실제 lastmod |

> 월별 랭킹은 24개월×8플랫폼×2성별 = 384까지 가능. **thin page 방지**: 페이지마다 고유 Q&A 직답 문장 + Top N 표 포함. 1차 범위는 **최근 N개월(예: 12)만** 생성하고 점진 확대 권장.

### 1-4. 데이터 위생 (중요)
- canonical 소스만 사용: `namu-wiki.json`(O), `namu-wiki.backup*.json`(X). `sns-*.json`(O), `sns-*.bak.*`(X).
- 빌드는 **읽기 전용**. 데이터 갱신은 기존 크롤러 책임.

---

## 2. 페이지별 콘텐츠 사양 (AEO 인용 최적화 반영)

### 2-1. 그룹 페이지 `/namu/<slug>/`
- **H1**: `방탄소년단(BTS) — 소속사·데뷔일·멤버·앨범 판매량` (엔티티 명확화)
- **Q&A 직답 블록**(자기완결 문장 = AI 발췌 단위):
  - "BTS의 소속사는? — 방탄소년단(BTS)은 빅히트뮤직 소속이며 2013-06-13 데뷔한 7인조 보이그룹입니다."
  - "BTS 웨이보 팔로워는? — 2026-05 기준 N명으로 보이그룹 X위입니다." (sns 데이터 결합)
- **프로필 표**: `info` 인포박스 16필드(소속사/팬덤/데뷔/레이블/활동기간/SNS계정 등)
- **멤버**: `members[]`
- **디스코그래피 표**: `albums[]`(title/type/발매일/한터·써클 초동·누적)
- **JSON-LD**: `MusicGroup`(name·foundingDate·numberOfEmployees·members·genre) + `BreadcrumbList` + `FAQPage`

### 2-2. 월별 랭킹 `/ranking/<YYYY-MM>/<platform>-<gender>/`
- **H1**: "2026년 5월 K-POP 보이그룹 웨이보 팔로워 순위"
- **Q&A 직답**: "2026년 5월 웨이보 보이그룹 1위는? — N명의 ○○○입니다."
- **Top N 표**: 순위·그룹·수치·전월대비 증감
- **JSON-LD**: `ItemList`(ListItem×N) + `Dataset`(temporalCoverage=해당월) + `BreadcrumbList`

### 2-3. 채용 `/jobs/`
- 정적 표(회사/포지션/지역/마감/링크) + 각 건 `JobPosting` JSON-LD (Google for Jobs 노출)

### 2-4. `/methodology/` (E-E-A-T)
- 운영주체(아이엠콘텐츠), 집계 주기(매월), 수집 플랫폼 8개, 집계 기준, 운영자 프로필(칼럼·출강 이력 연결)

### 2-5. `/llms.txt`
- 사이트 1줄 정의("K-POP 173+ 그룹 SNS 데이터를 매월 집계하는 한국어 사이트") + 핵심 데이터셋 설명 + 주요 URL 맵

---

## 3. 파일 구조 (신규)

```
build/
  generate_static.py        # 엔트리: 전 페이지 빌드
  loaders.py                # data/*.json 로더 + slug/월/플랫폼 정규화
  schema.py                 # JSON-LD 빌더 (MusicGroup/ItemList/Dataset/JobPosting/FAQPage/Breadcrumb)
  templates/
    base.html.j2            # <head> 메타·canonical·OG·공통 스키마·script.js 로드
    group.html.j2
    ranking.html.j2
    jobs.html.j2
    methodology.html.j2
  qa.py                     # Q&A 자기완결 문장 생성기 (그룹/랭킹)
  build_sitemap.py          # 전 URL + 실제 lastmod
  build_llms.py             # llms.txt / llms-full.txt
PROGRESS.md                 # 진행상태 (Phase 체크리스트)
```

---

## 4. 단계별 실행 (Phase)

### Phase 0 — 스캐폴딩 + 1페이지 E2E 검증 (리스크 선제거)
- [ ] `build/` 골격 + Jinja2 도입, `loaders.py`로 slug 매핑(190) 로드
- [ ] **BTS 1페이지만** 생성 → 로컬 서빙 → ① 봇 시점(JS off)에서 콘텐츠 보임 ② 사람 시점에서 SPA hydrate 정상(깜빡임/중복 없음) 확인
- [ ] hydrate 가드 방식 확정 (1-1 리스크 해소)
- **종료 조건**: BTS 정적 페이지가 봇·사람 양쪽에서 정상

### Phase 1 — 그룹 페이지 190개
- [ ] `group.html.j2` + `MusicGroup/FAQPage/Breadcrumb` 스키마 + Q&A
- [ ] 190개 생성, `/namu/bts` 등 **직접 fetch가 200 + 콘텐츠** 확인
- [ ] 홈 ItemList도 16 → 173 전수 확장

### Phase 2 — 월별 영구 랭킹 URL
- [ ] `ranking.html.j2` + ItemList/Dataset, 최근 12개월 × 8 × 2 생성
- [ ] 전월대비 증감 계산, Q&A 직답

### Phase 3 — jobs / methodology / llms.txt
- [ ] `/jobs` 정적화 + JobPosting
- [ ] `/methodology`, `/llms.txt`, `/llms-full.txt`

### Phase 4 — sitemap + CI + 검증
- [ ] `build_sitemap.py`로 전 URL·실제 lastmod 재생성 (현재 194개 2026-04-02 고정 문제 해소)
- [ ] **GitHub Actions**: data 변경 push 시(또는 월 1회) `generate_static.py` 자동 실행→커밋. 기존 자동 뉴스 커밋 흐름과 충돌 없게 경로 한정
- [ ] 검증: `curl -A GPTBot` 표본 페이지에 콘텐츠·스키마 존재 / Rich Results Test / Search Console 색인 요청

---

## 5. 리스크 & 대응

| 리스크 | 대응 |
|---|---|
| SPA 부팅이 prerendered DOM 덮어씀(깜빡임) | Phase 0에서 hydrate 가드 검증 후 전개 |
| 월별 384페이지 thin/중복 콘텐츠 | 페이지별 고유 Q&A+증감 서술, 1차 12개월로 제한 |
| 자동 크롤러 커밋과 빌드 산출물 충돌 | 빌드 산출 경로(`namu/`,`ranking/`,`jobs/`) 한정, CI에서만 생성 |
| 데이터 백업본 오참조 | 로더에서 canonical 파일 화이트리스트 고정 |
| 빌드 산출물 대량 커밋으로 리포 비대 | 생성물만 추적, 변경분만 커밋(diff 기반) |

---

## 6. 착수 지점

**Phase 0(BTS 1페이지 E2E)부터.** 가장 큰 미지수인 "prerender+hydrate 공존"을 1페이지로 먼저 검증해야 190개·384개로 확장할 때 재작업이 없다. Phase 0 통과 = 파이프라인 타당성 입증.

> 진행상태는 `PROGRESS.md`에 Phase 체크리스트로 관리.
