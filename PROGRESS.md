# PROGRESS — 정적 페이지 생성 파이프라인

> 설계: `PLAN.md` · 진단: `reference/geo-aeo-audit-2026-06-13.md`

## Phase 0 — 스캐폴딩 + BTS 1페이지 E2E 검증  ✅ (2026-06-13)

- [x] `build/generate_static.py` 작성 (index.html 셸 복제 + 헤드/JSON-LD/콘텐츠 주입 방식)
- [x] 데이터 소스 확정: `data/namu-groups/<slug>.json` (SPA가 실제 fetch하는 per-group, 201개)
- [x] BTS 페이지 생성 → `namu/bts/index.html` (144KB)
- [x] **봇 검증(GPTBot UA, 로컬 서버)**: `/namu/bts/` HTTP 200 + BTS 프로필·멤버·디스코그래피 콘텐츠 노출 + "Loading" 없음(본문)
- [x] **JSON-LD 3종 유효**: MusicGroup(7멤버·5앨범·소속사)/BreadcrumbList/FAQPage(3Q)
- [x] 단일 H1(엔티티) — 홈 전용 H1 2개는 H2로 강등
- [x] 페이지별 메타(title/canonical/og/twitter/description) baked

### 검증 방법 (재현)
```bash
export PYTHONIOENCODING=utf-8
C:/Python314/python.exe build/generate_static.py bts
C:/Python314/python.exe -m http.server 8899 &
curl -s -A "GPTBot/1.0" http://127.0.0.1:8899/namu/bts/ -w "[%{http_code}]\n" -o botview.html
```

### ✅ 라이브 배포 + 사람 시점 검증 (2026-06-13)
- 커밋 `7b06a83`(파일럿) → `e0cc10d`(버그수정). GitHub Pages `built`
- **봇 시점(GPTBot 라이브)**: HTTP 200, BTS 콘텐츠·JSON-LD 3종 노출 확인
- **사람 시점(Chrome headless 스크린샷)**: SPA가 BTS 그룹 상세를 정상 렌더(프로필/멤버/디스코/판매량/스트리밍 탭) — 하이드레이트 정상, 중복 없음

### 🐞 파일럿이 잡은 버그 → 수정 완료 (핵심 교훈)
- **트레일링 슬래시 라우팅 버그**: GitHub Pages가 `/namu/<slug>` → `/namu/<slug>/`(디렉토리)로 301하는데, `namu.js`의 slug 정규식 `(...)$`이 끝 슬래시에 매칭 실패 → **사람 시점에서 그룹 상세 대신 검색 화면으로 폴백**. 봇(JS無)은 baked 콘텐츠라 정상이었으나 사람이 깨짐
- 수정: `namu.js` 정규식 `([a-z0-9_-]+)\/?$` + canonical/og/JSON-LD url을 트레일링 슬래시(실제 200 URL)로 통일. generate_static.py도 동일 정렬
- → **이 수정은 190개 전 그룹 페이지의 전제**. Phase 1 전 반드시 반영돼야 함 (이미 라이브 반영됨)

### 📐 구조화 데이터 검증
- JSON-LD 3종 모두 **구문 유효**(json.loads 통과): MusicGroup / BreadcrumbList / FAQPage
- Google 리치결과 *기능* 기준: BreadcrumbList=지원 / FAQPage=대부분 사이트 비노출(2023 정책) / MusicGroup=리치결과 비대상이나 엔티티·AI엔진 이해엔 유효
- Google Rich Results Test는 헤드리스 자동화 차단 → 사용자가 URL 직접 입력해 확인 권장

### 🚧 남은 정리 (Phase 1로)
- BTS와 무관한 숨김 섹션(홈/뉴스/채용)의 "Loading" 플레이스홀더가 HTML에 잔존 → lean 템플릿으로 제거
- sitemap의 `/namu/<slug>` 항목도 트레일링 슬래시로 정렬

## Phase 1 — 그룹 페이지 일괄 생성  ✅ (2026-06-13)
- [x] lean화: 그룹 페이지에서 홈 전용 `<article id="seo-static-content">` + `<noscript>` 제거 → 144KB→약 52KB, 190페이지 중복 콘텐츠 제거
- [x] 전체 생성: **188개** (`namu-index.json` 190 그룹 중 per-group json 존재분). 13초
- [x] 전수 검증 0 문제: 단일 H1 / JSON-LD 3종(MusicGroup·BreadcrumbList·FAQPage) 유효 / 끝슬래시 canonical / title 정상
- [x] nav 무결성: 전 page-section + script.js/namu.js 유지(셸 복제 방식)
- [x] 홈 ItemList 16→**188** 확장 (`build/update_home_itemlist.py`, url+foundingDate 포함). 그룹 페이지엔 중복 제거(자체 MusicGroup 보유)
- [x] sitemap 끝슬래시 정렬 + 정적 생성분만 필터 + lastmod 실행일 갱신 (`update_sitemap.py` 수정): 208 URL, 그룹 188개 끝슬래시
- [x] 라이브 배포 후 표본 직접 fetch 200 확인 (Phase 1 표본 5 + 아래 재배포)

> nav를 위해 다른 page-section은 유지해야 하므로, 그 안의 "Loading" 플레이스홀더(홈/뉴스/채용)는 남김.
> 숨김 섹션이라 BTS 등 엔티티 본문 대비 노이즈 미미. 완전 제거는 nav 분리 리팩터 필요(보류).

## Phase 2 — 월별 영구 랭킹 URL  ✅ (2026-06-13)
- [x] **SPA 라우팅 확장**: `script.js` parseUrlParams에 `/ranking/{YYYY-MM}/{sns}-{gender}/` 패턴 + init에서 성별(boys/girls) 토글 반영 (기존 /ranking 동작 불변, 가산적)
- [x] `build/generate_ranking.py`: `sns-male/female.json` → Top50 표 + Q&A + ItemList/Dataset/BreadcrumbList JSON-LD baked
- [x] 파일럿 `/ranking/2026-05/weibo-boys/` 봇+사람 검증: 봇 HTTP200+JSON-LD3, **사람 SPA가 남자/웨이보/26년5월 자동 설정 후 인터랙티브 랭킹 렌더(전월대비 증감 포함)** — baked와 일치
- [x] 전체 생성: **92개** (최근 6개월 × 8플랫폼 × 2성별, 데이터 6개월 미만 조합은 자동 단축). 전수검증 0문제
- [x] sitemap에 랭킹 92개 포함(총 300 URL)
- [ ] 라이브 배포 후 표본 검증

> URL 스킴 `/ranking/<YYYY-MM>/<sns>-<gender>/` (sns=weibo/bilibili/qqmusic/twitter/youtube/spotify/chaohua/instagram, gender=boys/girls)
## Phase 3 — jobs / methodology / llms.txt  ✅ (2026-06-13)
- [x] `/llms.txt` (`build/generate_llms.py`): 사이트 정의·핵심 데이터셋·플랫폼별 랭킹/주요 그룹 URL·인용 안내. 데이터에서 실수치(188그룹, 6개월, 기준월) 생성
- [x] `/methodology/` (`build/generate_methodology.py`): standalone E-E-A-T 페이지(운영주체·집계주기·8플랫폼·집계기준·출처) + Organization/AboutPage/Breadcrumb JSON-LD. SPA 미로드(라우트 아님)라 hydrate 충돌 없음
- [x] `/jobs/` (`build/generate_jobs.py`): 셸 복제+SPA hydrate. baked 채용표(176건) + JobPosting @graph(176) + CollectionPage. 단일 H1
- [x] `script.js` getPageIdFromPath 끝슬래시 정규화(`/jobs/`→jobs 라우팅, namu/jobs 등 범용)
- [x] sitemap에 /methodology 추가(총 301 URL)
- [ ] 라이브 배포 후 표본 검증

> JobPosting 주의: 외부(사람인/잡코리아) 큐레이션이라 url은 출처 연결, datePosted/상세 description은 원천에만 있어 생략(허위 금지). Google for Jobs 완전 적격은 per-job 상세페이지 필요(후속).
## Phase 4 — sitemap + GitHub Actions CI + 검증  ✅ (2026-06-13)
- [x] **외부리뷰 반영**: (#1) sitemap에서 SPA 404 라우트 전부 제거 → 정적 200분만 283 URL / (#4) lastmod를 원천 데이터 mtime 기준(그룹 05-18·랭킹 05-31)으로 정교화 / (#6) 그룹 본문 출처·갱신일 문장
- [x] `.github/workflows/geo-build.yml`: 원천 데이터/생성기/셸 변경 시 정적 페이지 자동 재생성·커밋(stdlib만, 의존성0). 산출물은 트리거 경로 제외+[skip ci]로 루프 방지. JSON-LD 검증 게이트 포함
- [x] `.github/workflows/geo-smoke.yml`: 핵심 GEO 자산(llms.txt/methodology/jobs/namu/ranking/sitemap/robots) 200 + sitemap loc 표본 200 확인(리뷰 #2·#7)
- [ ] **사용자 작업 필요**: 리포 Settings→Actions→Workflow permissions를 "Read and write"로 설정해야 geo-build가 커밋 푸시 가능. 첫 `workflow_dispatch` 수동 실행으로 검증 권장

### 외부 리뷰 대응 요약
- ✅ #1 sitemap 404 제거 / ✅ #4 lastmod 정교화 / ✅ #6 본문 출처·기준일 / ✅ #7 스모크 테스트(smoke 워크플로)
- ℹ️ #2·#3(llms.txt·methodology 404)은 리뷰 시점 stale — Phase 3 배포로 이미 200(재확인 완료)
- 🚧 #5 JobPosting Google-Jobs 완전 적격(datePosted/description)은 per-job 상세페이지 필요 — 보류
