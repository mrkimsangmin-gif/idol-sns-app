# DEV_HISTORY_RECENT — idol-sns-app 최근 이력 (≥ 2026-03-15)

> 세션 시작 시 빠른 맥락 파악용 발췌본. **전체 이력은 `DEV_HISTORY.md`** (200KB, 127개 엔트리).

> 자동 생성: `.claude/tools/split_devhistory.py 2026-03-15` — 원본 미수정.


---

## [2026-07-18] GA4 재방문(Returning) 유저 분석 파이프라인 구축 + 최초유입 채널별 재방문율 발견

### 1. 🎯 Context
- 사용자 요청: aimcontents.com 방문자 분석(GA4 자동 분석 진행 중 PC 종료로 중단된 세션을 이어받음)
- 이어서 "재방문자 분석으로 재방문율을 늘릴 방법을 찾을 수 있는가" 질의 → 재방문 유저 구성(composition) 분석에서 재방문 유발 원인(driver) 탐색으로 확장

### 2. 🛠️ Key Changes
- **`07.analytics/`** (신규, git 미추적·`.gitignore` 제외 로컬 전용 — `credentials/ga4-service-account.json` 서비스계정 키 포함): GA4 Data API 직결 분석 스크립트 4단계
  - `ga4_report.py` — 클라이언트/인증 기반 모듈, 기본 7일 리포트
  - `ga4_full_report.py` — 전체 지표 EDA(개요/월별추이/채널/기기/국가/이벤트 등)
  - `ga4_returning_users.py` — 재방문 세션 세그먼트 심층분석 13개 항목(국가/기기/OS/채널/페이지/이벤트/요일/시간대 등), 봇 트래픽 구간(2/14~4/2) CLEAN_RANGES로 제외
  - `ga4_retention_drivers.py` — `firstUser*`(최초 유입 시점 고정) 차원과 `newVsReturning` 필터를 결합해 **최초 유입 채널/소스별 재방문율(재방문 유저수÷전체 유저수)** 계산
- **기술적 결정**: `sessionCount`를 세션횟수 분포용 차원으로 시도 → GA4 Data API `runReport`가 지원 안 함(funnel/exploration 전용으로 추정, "Did you mean sessionSource?" 에러) → 해당 섹션(13번) 제거하고 원인 주석만 남김
- **기술적 결정**: 재방문 원인 규명에는 세션 단위 `newVsReturning`만으로는 불충분(구성만 보여줌) → 유저의 진짜 첫 방문 기준인 `firstUserDefaultChannelGroup`/`firstUserSourceMedium`으로 교차해 채널별 재방문율을 계산하는 방식 채택

### 3. 📌 Status & Next
- ✅ 완료: 재방문 세그먼트 리포트 13개 항목 확인 (재방문자 참여지표가 신규 대비 세션당체류 898s vs 98s, 페이지뷰/세션 13.4 vs 6.2로 크게 높음)
- ✅ 완료: 최초유입 채널별 재방문율 산출 — baseline 6.9% 대비 Email/newsletter 채널 39.7%(5.8배, n=58/23)로 최상위, Direct(전체의 70%, n=690)는 4.6%로 baseline 이하. desktop(8.0%, n=690) > mobile(4.9%, n=285)
- 🚧 보류: Email 채널 고재방문율은 자기선택편향(구독=이미 애착 있는 유저) 및 순환정의(뉴스레터 발송 자체가 재방문 세션을 만듦) 가능성 있어 인과 아닌 상관관계로만 해석 — 별도 검증 없이 "이메일이 재방문을 유발한다"고 단정 금지
- 👉 Next: GA4 BigQuery Export 연동 완료(GCP `capable-arbor-327308`, 데이터셋 `analytics_2464635637`) — 데이터 채워지면 이벤트 단위 원시데이터로 세션 재구성/정밀 리텐션(코호트) 분석 가능
- 👉 Next: Direct/Organic 다수 트래픽(baseline 이하 재방문율)에 대한 자발적 재방문 유도 장치(PWA/푸시알림/구독 CTA) 검토

---


## [2026-06-17] E2E 빨간불 정리 + git push 자동복구 보강 + 엔터뉴스 선정/신선도 개선

### 1. 🎯 Context
- 사용자: "E2E 테스트 계속 실패 메일이 온다. 중단해도 되나?" → 진단 결과 정상 작동(106 pass)인데 1건 결정론적 실패 + 자동커밋마다 트리거되어 메일 폭탄
- 이어서 "뉴스 메뉴가 멈춰 있다 / 최신이 아니다 / 이건 뉴스가 아니다(YouTube·Weverse)" 연쇄 발견 → 뉴스 파이프라인 전반 점검

### 2. 🛠️ Key Changes
- **`aimcontents-e2e/tests/seo.spec.ts`** (커밋 `49689af`): sitemap 검증 `requiredUrls`에서 `/news`·`/comeback` 제거(SPA 404 라우트라 GEO 정책상 sitemap 의도적 제외와 일치). `snsUrls`도 실제 형식 `/ranking/YYYY-MM/{sns}-{gender}/`에 맞게 `/weibo-` 등으로 수정(숨은 2차 실패였음)
- **`.github/workflows/e2e-test.yml`** (커밋 `49689af`): `test` job에 `if: ${{ !startsWith(github.event.head_commit.message, 'auto:') }}` — `auto:` 데이터 자동커밋은 E2E 스킵(PR·schedule·수동·코드커밋은 실행). 3시간마다 실패메일 제거, schedule 1일1회가 안전망
- **`orchestrator.py`** (gitignore 로컬 데몬, 커밋 없음): `_git_push_file` 보강 — ① push 실패 시 `pull --rebase --autostash` 후 재시도 ② 새 변경 없어도 origin보다 앞선 미push 커밋 있으면 push(헬스체크 복구 정상화) ③ `_git_unwedge()` 신설: 중단 rebase abort + unmerged 산출물을 HEAD(=origin 권위)로 자동 해제 → autostash-pop 충돌 wedge 자가복구
- **`update_news.py`** (gitignore 로컬, 매 실행 재로딩이라 재시작 불필요): ① `<source>` 추출 + `NON_PRESS_SOURCES` 블록리스트(YouTube·Weverse·TikTok·SNS·음원플랫폼) 제외 ② 날짜 윈도우 7→3일 ③ 정렬을 `effective = score − 신선도감점(24h:0/24~48h:−5/48h초과:−10)`, 동점 최신순 — pubDate를 `parsedate_to_datetime`로 파싱(문자열 정렬 버그 수정)
- 데몬은 작업 2회 재시작(`KPop SNS Orchestrator` Task)으로 보강코드 로딩. 뉴스 라이브 발행 `b06e58e`/`d1ad1b2`/`9adc71f`

### 3. 💡 Root Cause & Decision Log
- **E2E 빨간불 = 사이트 아님, 테스트가 GEO 이후 sitemap 정책 미추종**. `/news`·`/comeback`은 정적 200 페이지 없는 SPA 라우트(404.html spa-github-pages 리다이렉트) → sitemap 제외가 옳음. 메뉴 자체는 정상(앱 내 클릭·직접접근 모두 콘텐츠 렌더). 검색엔진 비노출은 의도된 것
- **뉴스 stale 1차 = git push 적체**: origin이 GitHub Actions(geo) 커밋으로 분기 → PC의 단순 push가 non-ff로 막혀 커밋이 로컬에만 쌓임. 라이브 ~24h 정지. 헬스체크(08:00)도 "변경없음"으로 push 스킵해 무력
- **뉴스 stale 2차 = autostash-pop wedge**: 1차 보강의 `--autostash`가 산출물(`sitemap.xml`·`jobs/index.html`, 로컬·CI 양쪽 재생성)에서 pop 충돌 → rebase는 끝나 `rebase --abort` 무효, unmerged 잔존 → 이후 모든 commit "unmerged files" 실패(12:15 이후 16h 정지). → `_git_unwedge`로 같은 실행 내 자가복구. 임시 저장소 시뮬로 검증
- **뉴스 "최신 아님" = 정렬이 관련도(score) 1순위 + pubDate 동점정렬이 문자열(요일 알파벳순) 버그 + 7일 윈도우**. 원래 설계는 의도적 "관련도 큐레이션"(Google Sheet include 26/exclude 68 가중). **채택(C 절충): 관련도 우선 유지 + 24~48h 신선도 감점** (B 완전최신순·A 원복 기각)
- **YouTube/Weverse 노출 = Google News가 플랫폼을 매체로 반환 + 출처필터 부재**. `<source>` 기반 제외가 키워드 제외보다 안전(본문 오탐 회피)
- **선정 규칙은 코드 아닌 Google Sheet**(`1vgTIw…`): GROUPS(174, search_query) + FILTER(include score 가중/exclude). 중복 키워드 점수 합산(타이틀곡 +15+3=18)

### 4. 📌 Status & Next
- ✅ E2E green화 + auto커밋 스킵 / git push 2종 장애 self-heal / 뉴스 출처·윈도우·정렬 개선 — 모두 라이브 적용·검증 완료
- ✅ 06:15~ 자동 발행 정상 재개 확인(이력상 끊김 없이 지속), 절충 정렬 실측 검증(score22 44h→eff17 강등, 비언론 0건)
- 👉 Next: 신선도 감점 폭(−5/−10)·`NON_PRESS_SOURCES`는 운영 보며 미세조정. score=0 속보 과다 시 감점 강화 또는 score>0 게이트 검토
- 📌 `orchestrator.py`·`update_news.py`는 **gitignore 로컬 데몬 자산** — 깃에 없음. 재시작은 Task Scheduler `KPop SNS Orchestrator`(런처→orchestrator). update_news.py는 매 실행 재로딩이라 즉시 반영, orchestrator.py는 데몬 재시작 필요
- 📌 (사소) autostash-pop 충돌 시 백업 stash 누적 가능 — 가끔 `git stash list` 정리

---


## [2026-06-13] 도우인 챌린지 페이지 갱신 + 크롤러 구조적 장애 발견 (Douyin SurfaceView 전환)

### 1. 🎯 Context
- 사용자: "aimcontents.com/douyin 업데이트, S23 연결됨" → 정기 갱신 시도
- 5/21 절차(`douyin_crawler.py --device s23 --top 20`) 그대로 실행했으나 **네비게이션 실패**로 중단

### 2. 🛠️ Key Changes
- **`data/douyin-challenges.json`**: 20개 갱신 (#1 Angel你懂我的眼泪 809.0万 … #20 动物园里有什么 475.5万). 참여수 단조감소·요약/제목/썸네일 누락 0 검증. updated_at 2026-06-13
- **`data/douyin-thumbnails/thumb_01~20.png`**: 挑战榜 스크린샷에서 행 밴드 검출 후 크롭(원본 x≈276-428 정사각)으로 재생성
- **수집 방식 변경(수동 보조)**: 크롤러 미사용. 사용자가 직접 터치로 挑战榜 진입 → ADB `screencap`로 스크롤 캡처 → Claude가 스크린샷 직접 판독 → 잘린 제목은 행 탭→검색결과 검색창(전체 제목 노출)으로 복원 → Gemini(`gemini-3-flash-preview`)로 KO 제목·요약·trend_reason 생성 → JSON 빌드(`C:/temp/build_douyin.py`)
- 커밋 `4083bf7` → origin/main push 완료(상주 geo 데몬과 rebase 경합, 데몬이 내 커밋을 origin 위에 재배치 후 내가 fast-forward push)

### 3. 💡 Root Cause & Decision Log
- **🚨 크롤러 구조적 장애**: 도우인 **37.2.0**이 热榜/挑战榜 화면을 **SurfaceView/Compose로 렌더링** → uiautomator accessibility 트리에 탭·리스트가 전혀 안 잡힘(검색창 chrome `返回/搜索/扫一扫`만 노출). `find_and_tap("抖音热榜")` 등 텍스트 네비게이션(Method A·B 공통)이 **구조적으로 불가능**. 5/21엔 동작했으므로 그 이후 렌더링 방식 변경된 것
- **딥링크 부분 가능**: `snssdk1128://search/trending`(=hot_board/billboard 동일) → **热点榜만** 열리고 이 페이지는 트리에 잡힘. 그러나 board_type/sub_tab 파라미터는 전부 무시되어 **挑战榜 진입 불가**
- **挑战榜 데이터 추출**: screencap 픽셀 캡처는 SurfaceView여도 정상 → 스크린샷+판독으로 우회. 행 pitch≈252px, 썸네일 x≈276-428
- **잘린 제목 복원 트릭**: 챌린지 행 탭 시 그 챌린지명이 검색창에 담긴 검색결과(accessibility O)가 열림 → 전체 제목 획득
- **세션성 주의**: 挑战榜 리스트는 **라이브 재배열**(상위 800만대 분 단위 교체) + 스크롤 후 band→rank 시각 매핑 오독 주의(검증은 스트립 몽타주로)
- **월드컵 시즌 임시요소**(사용자 제보): 서브탭에 `世界杯` 추가 + 월드컵 챌린지 다수 혼입. 종료 후 원복 예상

### 4. 📌 Status & Next
- ✅ 페이지 갱신 + 라이브 push 완료
- 🚧 **`06.douyin/douyin_crawler.py` 자동화 깨짐** — 텍스트 네비게이션 불가(SurfaceView)
- ⏸ **재작성 보류 결정(사용자)**: SurfaceView 변경이 월드컵 시즌성인지 영구 변경인지 불확실 → 지금 재작성하면 헛수고 위험. 코드 변경 없음.
- 👉 **Next (최우선): 2026-07-20경(월드컵 종료 7/19 직후) `douyin_crawler.py --device s23 --top 20` 1회 실행해 텍스트 네비 부활 여부 확인.**
  - 부활 → 시즌성 확정, 자동화 그대로 사용 (조치 불필요)
  - 여전히 깨짐 → 영구 변경 확정, 그때 ②안(screencap+Gemini Vision 좌표 네비) 재작성
- 👉 그 전까지 정기 갱신은 **수동 방식**: 사용자 挑战榜 진입 → `screencap` 스크롤 캡처 → 판독 → `C:/temp/build_douyin.py` 재사용 → douyin 파일만 commit+push
- 📌 참고: 挑战榜 직행 딥링크는 미발견(`snssdk1128://search/trending`은 热点榜만). 재작성 시 추가 조사

---


## [2026-06-13] TikTok 중복 크롤 진단 + orchestrator_state 정정

### 1. 🎯 Context
- S23 연결 확인 중, S23이 TikTok에 점유돼 다른 작업 불가 → 구동 주체 추적 결과 `06.tiktok/crawl_tiktok.py`(orchestrator가 04:25 트리거)가 월간 크롤 진행 중(17그룹째)이었음
- 사용자: "TikTok은 최근에 했다" → 중복 실행 여부 검증 요청

### 2. 🛠️ Key Changes
- **`data/orchestrator_state.json`**: `last_tiktok_weekly` `2026-06-05T07:05` → **`2026-06-10T06:24`**(정식 `tiktok-summary.json` crawled_at 기준)로 수동 정정. 다른 키 보존
- **중복 크롤러 정지**: `crawl_tiktok.py`(pid 8944)만 종료. orchestrator 본체(27904)·launcher·정상 잡은 유지. `tiktok-summary.partial.json`에만 쓰므로 정식 06-10 데이터 무손상

### 3. 💡 Root Cause
- **정식 전체 크롤은 06-10 06:24(88그룹) 완료**(3일 전). 그러나 그 크롤은 06-06 RID 난독화 사고(`tiktok-summary-SUSPECT-20260606`, 수집 0) 복구용으로 **orchestrator 밖에서 수동 실행** → `_run_tiktok_weekly_s23()`의 state 기록 코드를 안 거쳐 `last_tiktok_weekly`가 06-05에 정체
- `_get_pending_s23_tasks`는 `last_tiktok_weekly` 기준 7일 경과 판단(orchestrator.py:320) → 06-05→06-13 = 8일 > 7일 → "미실행" 오판 → 오늘 중복 트리거
- 정정 후 재검증: state 06-10 유지(orchestrator 미복원), 크롤러 재실행 0건 확인

### 4. 📌 Status & Next
- ✅ 중복 크롤 정지 + state 정정 완료. 다음 정상 크롤은 06-17 이후로 정렬됨
- 👉 Next(보강 제안, 미적용): 수동 크롤도 인식되게 ①`crawl_tiktok.py` 종료 시 `last_tiktok_weekly` 기록, 또는 ②orchestrator가 `tiktok-summary.json` mtime 병행 체크 → 동일 중복 재발 방지

---


## [2026-06-13] GEO/AEO 진단 + 상단 메뉴 나무위키 숨김 + 정적 생성 파이프라인 PLAN

### 1. 🎯 Context
- (1) 상단 네비에서 "나무위키" 메뉴 숨김 요청 → (2) GEO(생성형 엔진)·AEO(답변 엔진) 최적화 진행 가능성 검토로 확장
- 부수 발견: 배포 구조가 문서(CLAUDE.md "GAS Web App")와 달랐음

### 2. 🛠️ Key Changes
- **`index.html`**: 188줄 나무위키 nav `<li>`에 `d-none` 추가(메뉴만 비표시, 라우팅/SEO/직접접속 유지). `git push origin main` → GitHub Pages 빌드 `built` → 라이브 반영 검증 완료
- **`reference/geo-aeo-audit-2026-06-13.md`**(신규): GEO/AEO 정밀 진단 리포트. 라이브 fetch(GPTBot UA) + 소스 정적분석 근거. 7절에 제3자 컨설팅 대조(채택/사실오류 분리) 포함
- **`PLAN.md`**(신규): 정적 페이지 생성(SSG) 파이프라인 설계도. Python+Jinja2, Prerender+Hydrate, Phase 0~4
- 데이터 매핑 확정: `namu-index.json`(groups190: slug·agency·debut·members) / `namu-wiki.json`(info16·albums65) / `sns-male|female.json`(snsList8×24개월) / `jobs.json`(175)

### 3. 💡 Decision Log & Trials
- **핵심 발견(배포 구조):** 프론트엔드는 **GitHub Pages**(main 직접 서빙, Server: GitHub.com+Fastly, Cloudflare 아님), clasp/GAS는 **백엔드 API만**(`.claspignore`가 index.html 등 제외). UI 수정 후 `clasp push`는 "already up to date"만 뜨고 라이브 미반영 → **UI 배포 = git push**
- **GEO/AEO 진단 결론:** P0 블로커 = SPA 동적렌더 + `/namu/<slug>` 173개가 HTTP 404(GitHub Pages 404.html 리다이렉트 핵) + 페이지별 meta가 JS로만 갱신 → AI 크롤러가 핵심 콘텐츠 못 봄. 해결책 = 빌드타임 정적 생성
- **제3자 진단 대조:** 채택(Q&A 자기완결 문장·월별 영구URL·오프사이트 인용·E-E-A-T·영문페이지) / **폐기(사실오류 3)**: "JSON-LD 없음"(실제 홈 4종 존재) / "Cloudflare Block AI Bots 확인"(실제 GitHub Pages) / "개별URL 이미 강점"(실제 404=최대약점)
- **채택:** prerender+hydrate(정적HTML이 SPA 부팅) — 봇엔 콘텐츠, 사람엔 SPA. 빌드도구 Python+Jinja2(기존 크롤러 스택 정합)

### 4. 📌 Status & Next
- ✅ 완료: 나무위키 메뉴 숨김 배포·검증, GEO/AEO 진단 리포트, PLAN.md
- ✅ **Phase 0 완료(라이브)**: BTS 파일럿 배포·봇/사람 양시점 검증. **파일럿이 트레일링 슬래시 라우팅 버그 포착**(GitHub Pages가 `/namu/<slug>`→`/namu/<slug>/` 301하는데 `namu.js` slug 정규식이 끝슬래시 미매칭→사람 시점 검색화면 폴백) → 정규식 `\/?$` + canonical 끝슬래시 수정 배포
- ✅ **Phase 1 완료(라이브)**: 그룹 엔티티 정적 페이지 **188개** 생성·배포(`build/generate_static.py`→`namu/<slug>/index.html`). lean화 144KB→약52KB, 단일 H1 + MusicGroup/BreadcrumbList/FAQPage JSON-LD + 봇 가시 본문(프로필/멤버/디스코/Q&A). 전수검증 0문제, 표본5 라이브 HTTP200 + 사람 hydrate 확인(Chrome headless)
- ✅ **퀵윈 완료(라이브)**: 홈 Schema.org ItemList 16→**188** 확장(`build/update_home_itemlist.py`, url+데뷔일) / sitemap 끝슬래시·정적분 필터·lastmod 실행일(`update_sitemap.py`). 그룹 페이지엔 홈 ItemList 중복 제거
- ✅ **Phase 2 완료(라이브)**: 월별 영구 랭킹 **92개**(`build/generate_ranking.py`→`/ranking/<YYYY-MM>/<sns>-<gender>/`, 최근 6개월×8플랫폼×2성별). **SPA 라우팅 확장**(`script.js` parseUrlParams에 `{YYYY-MM}/{sns}-{gender}` + 성별 boys/girls 토글, 가산적). Top50 표+Q&A+ItemList/Dataset/BreadcrumbList. 봇 HTTP200 + 사람 SPA가 성별·월·플랫폼 자동설정 후 인터랙티브 랭킹 렌더(남/녀 모두 Chrome 확인). sitemap 총 300 URL
- 👉 Next: **Phase 3**(llms.txt + /methodology E-E-A-T + /jobs JobPosting) / Phase 4(GitHub Actions 자동 재빌드 CI)
- 💡 재사용 교훈 → `GLOBAL_DEV_INSIGHTS.md #50` (GitHub Pages 디렉토리 서빙+클라 라우팅=트레일링 슬래시 필수, prerender는 실브라우저 검증 필수)
- 🚧 참고: 작업트리에 크롤러 자동생성 데이터 변경 다수 미커밋 + 백업본 산재 → 빌드는 canonical 파일만 화이트리스트 참조

---


## [2026-06-06] TikTok 크롤러 2개월 silent-failure 복구 (resource-id 재난독화)

### 1. 🎯 Context
- "어제 TikTok 주간 수집이 완주했는지 중단됐는지" 점검 요청에서 시작
- 발견: 어제 run은 88/88 완주했으나 **첫 그룹부터 전부 0** (`프로필 불일치 실제=(없음)`). git/DB 추적 결과 **2026-03-30(173/173 정상) → 04-20(0/7)** 사이부터 약 2개월간 매주 빈 데이터 양산. A90→S23 이관(~04-09) 시기와 일치
- 근본 원인: 코드가 TikTok 난독화 resource-id를 하드코딩 → 앱 업데이트(현 trill 45.5.1)가 ID 재난독화 → 전 셀렉터 미스 → 전 필드 0. **S23 분리와 무관** (라이브 테스트로 앱·딥링크·프로필 정상 확인)

### 2. 🛠️ Key Changes
- **`06.tiktok/crawl_tiktok.py`**:
  - 상단 **중앙 `RID` 딕셔너리** 신설 — 다음 앱 업데이트로 또 깨지면 여기만 갱신 (구 ID 주석 병기). 실측 매핑: username `r30→row`, stat값 `r1q→rnu`, stat라벨 `r1p→rnt`, 그리드조회수 `ysg→zfs`, 좋아요 `fat→flv`, 댓글 `duk→e41`, 저장 `h3d→hdv`, 공유 `txs→uf8`, 날짜 `ytg→zgu`, 캡션 `desc`(불변). 영상 상세 ID는 S23에서 영상 진입해 직접 dump로 실측
  - **silent-failure 가드**: 중간저장을 `tiktok-summary.partial.json`으로 분리(canonical 미오염), 전체 크롤 `팔로워>0 비율 <50%`면 summary 보존+의심본 별도저장+`sys.exit(2)`(orchestrator 성공오기록 차단), `avg_views>0 <20%`면 영상ID 의심 경고. 테스트/부분모드는 canonical 절대 미변경(rebuild_summary로만 반영)
- **`C:\temp\tiktok_resilient_recrawl.ps1`** (신규, 일회성 복구용): S23 중간분리 대비 자가복구 래퍼 — 전체크롤→끊기면 재연결대기+`--resume`(최대12R)→`--retry-failed`(0그룹 보정)→`rebuild_summary.py`(per-group→canonical)

### 3. 💡 Decision Log & Trials
- **채택:** RID 중앙화 + silent-failure 가드 — ID는 앱마다 또 바뀌므로, "조용히 0" 대신 "시끄럽게 실패(rc=2)+정상데이터 보존"이 핵심 교훈
- **검증:** `--test 뉴진스,아이브` → 뉴진스 팔로워 12,962,000 / 아이브 37영상 전필드(좋아요/댓글/저장/공유/날짜/캡션) 정상, 광고 7개 필터, 참여율 19.79%. 가드의 canonical 미변경도 확인
- **참고:** per-group 파일이 source of truth, canonical은 `rebuild_summary.py`로 재조립 가능 → 부분/멀티세션 크롤 안전

### 4. 📌 Status & Next
- ✅ 완료: ID 리매핑·가드 구현+검증, **canonical 0/88 → 87/88(99%) 복구 완료**(06-10). 남은 1개=라임라이트(@limelightseoul 로그인월, 검증파일도 fail)
- ✅ **TikTok 핸들 대조로 16개 교정** (출처: `02.중국SNS데이터/27.26년05월/tiktok_douyin_verify_2605_v4.xlsx` '검증' 시트 — TikTok URL/핸들/팔로워/상태 189행):
  - namu-wiki 핸들이 대거 틀려 있었음. **빈값/오등록 9개 복구**(언차일드 @highup_ent(소속사)→@official_unchild 1.9M, 영파씨→@youngposseup 1.1M 등) + **오수집 7개 정상화**(잘못된 계정 수집으로 소액 기록: 스트레이키즈 109→36.4M(@straykids_official→@jypestraykids), 아이들 25→11.1M(@official_g_i_dle→@official_i_dle), 케플러 10→6M, 소디엑·드리핀·판타지보이즈·아이리제)
  - **교훈**: namu-wiki 틱톡 URL은 신뢰 불가(빈값/소속사/타계정/오타 다수). 검증파일이 사실상 ground truth — 향후 namu-wiki 틱톡 URL을 검증파일에서 동기화 필요
- ✅ **후속 3종 완료(06-10)**:
  - **① namu-wiki 틱톡 URL 전체 동기화** (`sync_namu_from_verify.py`): 검증파일 status=ok 기준 — 틀린 5개 교정 + **빈값 96개 신규 채움**(에스파·르세라핌·세븐틴·마마무·트레저·라이즈 등 대형 그룹이 URL 누락으로 크롤 대상서 빠져 있었음). 크롤 대상 88→~184 확장. fail 2개(라임라이트·유니코드) 보존, 검증파일 미수록 2개(포레스텔라·라포엠). 백업 `namu-wiki.backup_sync_20260610.json`
  - **② orchestrator s23_poll 중복실행 lock** (`orchestrator.py` `_acquire/_release_s23_poll_lock`, `.s23_poll.lock`, O_EXCL atomic, TTL 3h): 수동 `--run s23_poll`+데몬 10분 폴이 state 갱신 전 같은 태스크(weibo 등) 동시 기동하던 버그 차단. 단위검증 PASS
  - **③ tiktok_history.db 재연결**: 원인=tiktok_monthly.py(take_snapshot)가 A90→S23 이관 때 고아화돼 2026-03-10 이후 스냅샷 멈춤. orchestrator `_run_tiktok_weekly_s23`에 크롤 성공 후 `tiktok_monthly.py snapshot` 자동 호출 추가. 수동 백필로 2026-06 스냅샷 복원(월 목록 2026-03→2026-06)
- ✅ 복구 과정(06-06~10): 자가복구 래퍼(`--resume`/`--retry-failed`/S23 분리 대기) + 잔여 그룹 라이브 실재검증 + namu-wiki URL 복원
  - **2차 근본원인 발견**: namu-wiki 파이프라인이 일부 그룹 틱톡 URL을 **빈값/소속사계정/타계정으로 덮어씀** → 크롤 대상 누락 → 0. (예: 언차일드=`@highup_ent`(소속사), 라임라이트 `@limelightseoul`=X:IN 타계정으로 넘어감, 에버글로우·유어즈·에스투잇·클로즈 URL 빈값). 검증된 핸들로 복원→재크롤로 클로즈(593K)·에버글로우(232만)·유어즈·에스투잇·코르티스(13.1M) 등 복구. `namu-wiki.backup_20260610.json` 백업
  - **데이터검증 사례**: 라임라이트 재크롤이 `x_in_lovers`(347, 러시아어 X:IN 팬계정) 반환 → 오귀속 차단 위해 URL 제거+per-group 0 처리
  - **rebuild_summary.py**: `groups/` 전체 188개(stale 누적) 합산 버그 → crawl-progress 88 스코프로 제한 수정
  - **S23 분리 핸들링 교훈**: crawl_tiktok이 디바이스 분리를 감지 못하고 빈값으로 "완료" 처리 → wrapper resume 무력화. retry-failed(idempotent)가 실질 복구 수단
- 👉 Next: ① 남은 10개 **올바른 TikTok 핸들 확보**(빈값/소속사: 라임라이트·에이머스·언차일드 / 미로딩 6: 더씬드롬·아일리원·에이티비오·엔싸인·프림로즈·하우 / 실제0: 영파씨) → 핸들만 있으면 즉시 복구 ② **namu-wiki 파이프라인 틱톡 URL 덮어쓰기 방지**(가장 시급 — 또 누락 가능) ③ crawl_tiktok 디바이스 분리 감지 시 abort 추가 ④ `tiktok_history.db` 스냅샷 2026-03-10 멈춤 점검 ⑤ orchestrator weibo 중복실행 lock 가드(미적용)

---


## [2026-06-04] 음악방송 유튜브 화제성 분석 파이프라인 신규 (07.youtube/music_show)

### 1. 🎯 Context
- 사용자 요청: 4대 음악방송(엠카/뮤뱅/음중/인기가요) 공식 유튜브 무대 영상의 조회수·인게이지먼트를 수집해 **최근 화제 아이돌** 분석
- 기존 `youtube-engagement.json`은 그룹 공식채널 기준 → 음악방송 채널 전용 수집기는 부재 → 신규 구축

### 2. 🛠️ Key Changes
- **`07.youtube/music_show/collect_music_shows.py`**: 4사 playlistItems+videos.list 수집기. `youtube_engagement.py` API 골격(`GOOGLE_API_KEY` env) 재사용. 인기가요는 전용 무대 플레이리스트 부재 → 채널 업로드(`@SBSKPOP` uploads `UUS_hnpJLQTvBkqALgapi_4g`)에서 정규무대 `{곡}-{그룹}|SBS YYMMDD 방송`만 title 필터링
- **`parse_title_to_group.py`**: 채널별 제목 정규식 4종(뮤뱅·인기가요는 곡-그룹 순서 반대) + 선행장식 제거 + `A (B)` 한/영 분리 + `group-aliases.json` 매칭
- **`analyze_buzz.py`**: 누적보정 조회속도(views/경과일)·세그먼트 분리·비공연(인터뷰/MC) 제외·다지표(vel_sum/vel_med/eng_rate/출연방송수). 173패널 외 고조회 아티스트 surface
- **`collect_comments_ms.py` → `analyze_comments.py`**: 댓글 본문 수집(영상당 상위 50, 총 103,252개) + 그룹별 언어구성(해외 화제성)·휴리스틱 감정·키워드 분석. 중간저장+재개(백그라운드 일정시간 후 종료 패턴을 resume으로 우회, 3회 분할 완주)
- **영상별 URL**: 전 영상 `url` 필드 + 랭킹에 그룹 대표(최고조회) 영상 URL 병기 (수동 확인용)
- **출력**: `data/music-show-{engagement,buzz-ranking,comments,comment-analysis}.json`, `reports/music_show_buzz/{METHOD, buzz_ranking_2026-06-04, comment_analysis_2026-06-04}.md`
- 최근 90일 화제성 Top5: 에스파>아일릿>코르티스>르세라핌>베이비몬스터. 댓글 해외%: 엔하이픈 67·있지/르세라핌 45; 엔싸인 일본어 69%

### 3. 💡 Decision Log
- **채택: 인기가요 채널 업로드+title 필터** — 8K 풀캠 플레이리스트(`PLzJT…`)는 최근분 viewCount 비공개(멤버십성, views=0)로 사용 불가 → 정규 무대만 추출해 4번째 무대 소스로 통합
- **채택: 조회속도(velocity) 정규화** — 단순 조회수는 누적효과로 오래된 영상 우위. 전역 데이터분석 프로토콜(누적보정·세그먼트·다지표·반증) 준수
- **폐기: 4사 단순 합산** — 인기가요(원래 풀캠)는 형식·viewCount 특성 달라 합산 왜곡 → 정규무대로 통일 후 통합
- **보류: 아이오아이/NCT WISH/KATSEYE 등 패널 외** — `group-aliases.json`(공유자산) 추가는 사용자 승인 후. 아이오아이는 한/영 표기 이중카운트 상태

### 3.5 🔍 외부 리뷰 반영 정정 (2026-06-04 동일자)
- **n_songs 곡명 정규화** 추가(`norm_song`: 어포스트로피 변형·괄호 제거) → 아일릿 3→1, 에스파 4→2곡 (표기 변형 과대계상 수정)
- **패널 수 173→174** 전 문서 정정. **XLOV 추가 권장 삭제**(엑스러프 이미 패널, Top25 8위 — 자기모순이었음)
- **댓글 모집단 명확화**: "패널매칭 영상" = 1,277개(전체 댓글영상 2,730과 구분). 댓글분석은 전체기간/랭킹은 90일 → 모집단 다름 명시. `analyze_comments.py --days` 윈도우 옵션 추가
- **해외% 임계 30→100** 상향 + 표본수 병기(소표본 노이즈 스모즈 94% 등 제거)
- **METHOD.md 인기가요 세그먼트 모순 해소**(풀캠 잔존 설명 → stage 통합). eng% 스케일의존·velocity 최신성편향 한계 강화. 외부 조회수 "내부 데이터 기준" 단서

### 4. 📌 Status & Next
- ✅ 완료: 백로그 스냅샷 수집·매칭·랭킹·댓글분석·리포트 + 외부리뷰 정정
- 👉 Next: going-forward 고정창(업로드후 N일) 수집으로 velocity 최신성편향 해소, 패널 외 그룹 alias 추가, 다국어 LLM 감정분석, twitter/ytmusic_trending 삼각검증

---


## [2026-06-02] ranking default month stale fix (2604→2605) + SEO 헤딩 자동 갱신 마커

### 1. 🎯 Context
- 사용자 보고: `/ranking` 페이지 진입 시 기본 표시 월이 **2026-04** (5/31 배포 후에도 stale)
- 추가 발견: `index.html` SEO 정적 헤딩 `<h3>` 가 여전히 **"2026년 1월"**
- 원인: 5/31 배포가 `sns-male/female.json` 만 갱신, `data/initial-data.json` 누락 → SPA 초기 로드 경로(`script.js:215-229`)에서 `staticData.meta.latestMonth` 가 stale 값 사용

### 2. 🛠️ Key Changes
- **`data/initial-data.json` 재생성**: `latestMonth: "2026-04" → "2026-05"` (16 조합 모두), `generated: 2026-06-02`
- **`index.html` SEO 블록 마커 추가**: `<!-- SEO_RANKING_BLOCK_START --> ~ END -->` 사이 헤딩+`<ol>`(Top 10) 자동 갱신 가능. 2026-05 남자/웨이보 실측 Top 10 반영 (BTS 5.66M → CORTIS 704k). CORTIS 10위 신규 진입 (2605 성장률 분석과 일치)
- **`rebuild_initial_data_20260602.py`** (재사용): `update_sns_data.generate_initial_data()` 단독 호출 + `update_seo_block()` 신규. 다음 월부터 ranking 배포 후 단일 명령으로 둘 다 갱신
- **commit `5be599a` → main** push, GitHub Pages 자동 빌드

### 3. 💡 Decision Log
- **채택: 마커 기반 정적 치환** — JS 동적 textContent 교체는 SEO 크롤러 가시성 불안정. 빌드 시 마커 영역 치환이 안전 + 즉시 검색 노출
- **채택: 추측값 → 코드 출력값 자동 치환** — 1차 정적 Edit에서 추측치(투어스 10위 등) 임시 입력했으나, `update_seo_block()` 실행 시 정확한 실측치(CORTIS 10위 등)로 덮어쓰여 데이터 검증 원칙 회복
- **노출: 인스타그램 `months_count=4`** — sns-male/female.json 의 IG 히스토리가 4개월(2026-02~05)뿐. 다른 8 플랫폼(27개월) 대비 매우 짧음 → 향후 백필 필요

### 4. 📌 Status & Next
- ✅ 완료: initial-data.json, index.html SEO 블록, 자동 갱신 스크립트, main push
- 🚧 보류: 인스타그램 백필 (2024-03~2026-01 누락)
- 👉 Next 월: ranking 데이터 배포 직후 `rebuild_initial_data_20260602.py` 실행 1줄로 default month + SEO 블록 동시 갱신. `update_sns_ranking_2605.py` 같은 별도 배포 스크립트에 step 통합 권장

---


## [2026-05-31] SNS 랭킹 2026-05 데이터 배포 (1,274 records 추가)

### 1. 🎯 Context
- 27.26년05월 BOY/GIRL xlsx에 Spotify·IG 정확값 재수집 완료 → ranking 페이지 2605 월 추가
- 인스타그램: og:description 1M 단위 약식 → S23 ADB 1단위 정확값 (이전 2604와 동일 패턴)
- Spotify: og_approx → Selenium DOM 1단위 정확값

### 2. 🛠️ Key Changes
- **`data/sns-male.json`**: 2026-05 month 추가, +727 records (인스타 102, X 102, 유튜브 102, 차오화 100, 스포티파이 100, QQ 96, 웨이보 73, 빌리빌리 52)
- **`data/sns-female.json`**: 2026-05 month 추가, +547 records (차오화/X/QQ/스포티파이 각 79, 인스타 78, 유튜브 77, 웨이보 43, 빌리빌리 33)
- **신규 스크립트**: `C:/temp/update_sns_ranking_2605.py` — xlsx → JSON append, dry-run + apply 분리, 매월 변수만 변경해 재사용
- **기술적 결정**: 변경된 두 JSON만 명시 `git add` (다른 unstaged 변경과 격리) vs 전체 commit (혼합)
- **commit**: `ce3789d` → main → GitHub Pages 자동 빌드

### 3. 📌 Status & Next
- ✅ 완료: ranking 2026-05 표시 (8개 SNS × 182 그룹), Spotify/IG 1단위 정확값 반영
- 👉 Next:
  - 매월 1일 또는 SNS 수집 완료 후 `update_sns_ranking_NNNN.py` 자동 실행 (cron/Schedule)
  - 도우인 ranking 추가 (snsList + data 키 신설) — 2606부터

---


## [2026-05-28] 정기 수집 13종 전수 진단 + S23 큐 수동 트리거 + Spotify/IG 픽스

### 1. 🎯 Context & Goal
- 사용자 질문: "수집하는 데이터의 최근 업데이트 상황을 확인해서 현재 수집이 정상적으로 진행되지 않는 데이터가 무엇인지 알려주세요"
- 매일/주간/월간 자동 수집 13종의 마지막 갱신시각 + DB 테이블별 max(date) 교차검증
- 발견된 정지 항목 우선순위에 따라 가성비 큰 것부터 복구

### 2. 🛠️ Key Changes
- **진단 결과**:
  - 🔴 71일+ 정지: 지니/벅스 일간차트(`guyso.db.{genie,bugs}_daily` max=20260316), **써클** 주간차트(`circle-weekly.json` 03-15, **producer 부재**), **Spotify 월간 스냅샷**(`spotify-data.json` 03-18, **producer 부재 + Akamai 차단**), **IG Reels 곡선**(`reels_curves.csv` 03-14, 세션 만료)
  - 🟡 가동 중 지연: 멜론 일간(2-3일 지연), Weibo(1-4일 간격, S23 폴링 설계상 정상), TikTok 일부 그룹 17일 미갱신
  - ⚪ 의도된 중단: Twitter(`Pumit_TwitterCrawl 스크립트 미존재`)
- **S23 폴링 수동 트리거**: `orchestrator.py --run s23_poll` → Weibo + Hanteo 큐 잡고 즉시 실행. 결과: `weibo_batch_20260527_*.json` 2개 + `hanteo_weekly_20260527_0545.json` 100개 생성. `last_weibo_daily`/`last_hanteo_weekly` 갱신
- **IG 세션 복구**: `ig_cookies.json` 갱신 (사용자가 Chrome F12에서 쿠키 직접 추출 → sessionid·ds_user_id·csrftoken·mid·ig_did 적용). 즉시 테스트 → "세션 만료" WARNING 사라지고 활성 추적 큐 262개 점검 진행. 단 262개 모두 76일 경과로 자동 `[완료]` 처리 (큐 비워짐) — 새 Reels는 다음 IG 타임스탬프 잡 후 등록 시작
- **Spotify 근본 원인 확정 — 3중 문제**:
  1. **Akamai 차단**: sp_dc → `get_access_token` 호출 시 HTTP 403 "URL Blocked"
  2. **고아 파일**: `spotify-data.json`을 **만드는 코드가 코드베이스에 0건** (`grep`으로 입증). `spotify_collector.py`는 `listeners_weekly.csv`만 출력
  3. **사일런트 state 갱신 버그**: `orchestrator.job_spotify_monthly()`가 `run_script` 반환값 무시하고 항상 `state["last_spotify_monthly"]` 갱신 → `--status`가 실패를 정상으로 표시
- **`listeners_weekly.csv` 커버리지 확인**: 202행 / **17 아티스트만** (kworb.net top 2500 K-POP 부분집합). 사실상 sp_dc API 대체로 부적합
- **`namu-groups/*.json → streaming.spotify` 기록 정정**: DATA_INVENTORY 주장과 달리 188개 중 1개 파일(`ive.json`)만 실제로 spotify 키 보유 — 사실상 미존재
- **`circle-weekly.json` 비밀 발견**: 한터차트(`hanteo_cdp_crawler.py`) 작업으로 갱신 안 됨 — 별개 소스이며 코드베이스에 producer 없음. spotify-data.json과 같은 "고아 파일" 패턴
- **픽스 (minimal)**:
  - `orchestrator.py` `job_spotify_monthly`: `run_script` 반환값 체크해 실패 시 state 미갱신 + ERROR 로그
  - `10.spotify/spotify_collector.py`: 모듈 docstring에 Akamai 차단 + spotify-data.json 미생성 사실 명시
  - `DATA_INVENTORY.md`: §0 producer 맵에서 spotify-data.json·circle-weekly.json을 "🟡 producer 부재"로 정정. §1.5 Spotify 섹션 전면 재작성(frozen snapshot + 17-artist CSV 분리 명시)

### 3. 💡 Decision Log & Trials
- **채택: B1 미니멀 픽스** — analysis.py·config.py 미수정. spotify-data.json 그대로 사용(`idol_hit_predictor/CLAUDE.md`의 "composite_score 하락 시 즉시 revert" 규칙 + tier 비닝으로 70일 staleness 흡수). 사일런트 버그만 진짜 픽스
- **폐기: A1 Selenium DOM 확장 / A2 Selenium-XHR 브릿지** — Akamai 우회는 가능하나 작업량 1.5~2h + Spotify UI 변경에 취약. 차후 별도 작업으로 분리
- **폐기: B 원래안(소비자 마이그레이션 → listeners_weekly.csv)** — CSV가 17 아티스트만 가져 spotify-data.json 174 대비 10x 커버리지 축소. 모델 regression 위험
- **참고: 메모리 `reference_spotify_collection.md`의 "Selenium 4 Chrome ~5분" 패턴**이 차후 진짜 복구 시 출발점 (현재 `C:/temp/spotify_collect_parallel.py`는 monthly_listeners만 수집, top_tracks 미수집)

### 4. 📌 Status & Next
- ✅ 완료: 진단 13종, S23 큐 수동 트리거, IG 쿠키 갱신, Spotify 사일런트 버그 픽스, DATA_INVENTORY 정정
- 🚧 보류: 지니/벅스 차트 복구(가성비 낮음으로 보류), 써클 주간차트 복구(producer 신규 작성 필요), IG Reels 새 등록 사이클 1회 대기, Spotify 진짜 복구(Selenium-XHR ~1.5h)
- 👉 Next: ① IG 타임스탬프 다음 수/토 13:00 실행 후 Reels 새 등록 확인 → reels_curves.csv 재성장 검증, ② 써클차트 producer 신규 작성 검토(Circle Chart 공식 사이트 또는 음악 마켓 데이터 소스 조사 필요)

---


## [2026-05-21] 도우인 챌린지 페이지(aimcontents.com/douyin) 수동 갱신 — S23 ADB 크롤

### 1. 🎯 Context & Goal
- 사용자: "aimcontents.com/douyin 업데이트 해주세요. S23 연결되어 있음"
- 직전 데이터 2026-05-01(20일 경과) → 최신 挑战榜 TOP20으로 갱신

### 2. 🛠️ Key Changes
- **수집**: `06.douyin/douyin_crawler.py --device s23 --top 20` (挑战榜 스크린샷 4장 → Gemini Vision OCR 38개 추출 → TOP20 트림 → 상세/썸네일 + AI 한국어 요약). GEMINI_API_KEY는 `06.douyin/.env`(메모리 유효키와 일치)를 환경변수 주입
- **data/douyin-challenges.json**: 20개 갱신 (#1 悟空跳挑战 806.0万 … #20 467.7万, 단조감소 정상). 검증: updated_at=2026-05-21, 요약누락 0 / 썸네일 0 / 참여수0 0건. 5/20 중국 고백데이 테마 다수로 최신성 확인
- **data/douyin-thumbnails/thumb_01~20.png**: 20개 재생성
- **기술 결정**: 라이브 반영 = GitHub Pages(CNAME) 저장소이므로 **정적 JSON+썸네일 git commit+push** (정적 JSON 우선 로딩 / GAS는 폴백). douyin 21개 파일만 정확히 스테이징(타 자동화 변경 미포함), main 직접 커밋(기존 auto 데이터 갱신 패턴). 커밋 25779d3 → origin/main push 완료
- **off-by-one 경고 6건**: 크롤러 안전장치가 desc만 비움(이름은 OCR이라 정상) — 요약은 전부 생성됨

### 3. 📌 Status & Next
- ✅ 완료: S23 크롤 + 검증 + main push (GitHub Pages 자동 재빌드)
- 🚧 미적용: GAS POST(`--post-gas`) 미실행 — 정적 JSON 우선이라 불필요하나 API 폴백 동기화 원하면 별도 실행 가능
- 👉 Next: 정기 갱신 시 동일 절차(crawl → JSON 검증 → douyin 파일만 commit+push)

---


## [2026-05-21] 채용(jobs) 파이프라인 — 발행 가드 + .bat UTF-8 인코딩 버그 + 수동 발행

### 1. 🎯 Context & Goal
- 사용자 질문: "aimcontents.com/jobs 최근 공고 5개", 이어서 "채용 메일은 업데이트 안 되나?"
- 점검 결과: jobs 데이터는 정상 수집되나, 같은 날 news 사고(아래 엔트리)와 **동일한 발행 브랜치 드리프트**에 jobs도 노출돼 있었음. news 복구로 main 복귀되며 jobs도 자동 해소된 상태였음(라이브 id628). 단 `run_jobs_pipeline.bat`엔 가드가 없어 재발 위험 잔존

### 2. 🛠️ Key Changes
- **Gmail 수집 정상 입증 (read-only 프로브)**: `gmail-token.json`으로 contents.ai.m@gmail.com 직접 접속 → `helpdesk@jobkorea.co.kr` 최근 14일 **29건**/3일 **9건** 수신 확인. jobs.json 잡코리아 항목과 매칭 → "수집 정상"을 정황이 아닌 직접 증거로 확정
- **`run_jobs_pipeline.bat` 전면 ASCII 재작성**:
  - **핵심 발견**: cmd.exe는 **UTF-8 인코딩 .bat의 한글을 라인 경계째 오파싱** → 조각이 명령으로 실행되고 결국 대화형 `time` 프롬프트("Enter the new time:")에서 **무한 hang**. 원본이 동작한 건 CP949 인코딩 + 한글이 echo(장식)에만 있었기 때문. **Write 도구는 UTF-8만 생성**하므로 .bat/.cmd는 반드시 ASCII로 작성하고, 한글 경로(내 드라이브)는 파일에 박지 말고 **`%~dp0` 런타임 치환**으로 회피
  - main 브랜치 가드(아니면 `git checkout main`, 실패 시 `exit /b 1` loud) — news 엔트리와 동일 패턴
  - 단계표기 `[1/3]→[2/4]` 불일치를 `[1/4]~[4/4]`로 통일
- **`credentials/secrets.cmd` 신규**(06.jobs/는 gitignore): `GEMINI_API_KEY`를 .bat 평문에서 분리. 단 키 문자열은 추적파일 어디에도 없어(`git grep` 0건, .bat도 미추적) **유출 아님 → 회전 불필요**
- **수동 5/21 발행**: `.bat`이 hang하여 Python 직접 실행(email→verify). 위드어스(#630)·엠더블유(#631) 신규 반영, 만료 URL 109건 정리(email재생성 362 → verify후 253). commit `9a2b222` → `git push origin main` → 라이브 확인(updatedAt 2026-05-21T06:55, count 253, 630/631 present)

### 3. 💡 Decision Log & Trials
- **채택:** ASCII-only .bat + `%~dp0` — UTF-8 의존/한글경로 하드코딩 제거. side-effect-free 복제본 `cmd /c` 파싱검증 통과(PARSE_OK)
- **폐기:** UTF-8 한글 .bat(+`chcp 65001`만으로는 cmd 파서 깨짐), `& cmd /c "...bat" | Select-Object`(출력버퍼링+인코딩 깨짐으로 hang 원인 은폐)
- **채택:** `--crawl` 생략 — verify후 하이브 128≈기존130, JYP20/SM7 동일로 커버리지 손실 없음 확인
- **참고:** F&F "제작사업부문" Gemini JSON 파싱 실패는 기존 #619 중복분 → 실제 누락 0

### 4. 📌 Status & Next
- ✅ 완료: jobs 라이브 발행 정상화(253), .bat 인코딩/가드 하드닝, Gmail 수집 직접 입증
- 🚧 보류: Gemini JSON 파싱 실패(F&F류) 견고화 / jobs 커밋 메시지 영문화로 변경됨("auto: jobs update")
- 👉 Next: `run_jobs_pipeline.bat` 스케줄러 등록 상태 확인(매일 09:00 자동실행 추정) / GROUP B 일일데이터 발행주기는 아래 #6 참조

---


## [2026-05-21] 공개 사이트 3일 정지 복구 — 발행 브랜치(main) 드리프트 사고

### 1. 🎯 Context & Goal
- 제보: 화면에 "실시간 엔터테인먼트 뉴스 업데이트: 5월 18일 오전 06:15"로 멈춤 (실제는 05-21까지 수집됨)
- 진단: 데이터 수집·자동 커밋·push 모두 정상이었으나, **GitHub Pages 발행 브랜치(origin/main)가 05-18 06:15(커밋 cafc845) 이후 정지**
- 근본 원인: 이 리포(idol-sns-app)는 GitHub Pages **발행용 작업본**인데 05-18에 `auto-update/20260518` 브랜치로 체크아웃된 채 방치 → `run_news_update.ps1`의 인자 없는 `git push`가 현재 브랜치로만 push → main에 닿지 못함. 뉴스뿐 아니라 나무위키 등 **전 섹션 데이터(54커밋/481파일)가 3일간 미발행**

### 2. 🛠️ Key Changes
- **즉시 복구**: `git push origin HEAD:main` (fast-forward, divergence 0) → origin/main을 b63f955로 따라잡힘. 리포를 `git checkout main`으로 복귀
- **`C:\temp\run_news_update.ps1` (재발방지, 코드리뷰 반영 강화판)**:
  - 발행 브랜치 가드 (step 0, news.json 재생성 *전*): 브랜치≠main이면 `git checkout main` + `git merge --ff-only <작업브랜치>`로 self-heal. 매 ~1.5~3h 도는 뉴스 크론이 watchdog
  - `$needsPush` 플래그: 브랜치 끌어오기가 있었으면 **news 변경이 없어도 push** (로컬만 따라잡고 origin 정지하는 버그 제거)
  - 모든 가드 실패(checkout/ff-merge/origin 동기화)를 **경고가 아닌 `exit 1`(loud)**로 — 절반만 발행되는 상태 방지
  - `git fetch origin main` + `git merge --ff-only origin/main`로 **origin 선행 시 FF 동기화** (다중 writer push 실패 방지)
  - `git push` → `git push origin main` (명시적 발행 타깃)
- 검증: 새 흐름 전체 1회 실행 성공(42f1b5b, EXIT 0), 라이브 collectTime=2026-05-21 06:23 KST, main↔origin 0/0 확인

### 5. 🔧 코드리뷰 반영 — 운영 개선 2건 적용 (커밋 71afdda)
- **#5 스크립트 리포 이전 완료**: `scripts/run_news_update.ps1` 정본 추가, `$Repo = Split-Path -Parent $PSScriptRoot`로 PC 독립화. 호출 체인 = 스케줄러 → `C:\temp\run_news_update.bat`(불변) → `C:\temp\run_news_update.ps1`(얇은 shim, BOM) → 리포 정본. cmd.exe 한글경로 한계 때문에 .bat은 ASCII 경로 shim을 호출하고, 한글 경로 진입은 PowerShell이 담당. `.bat → shim → 정본` 전체 실행 검증(EXIT 0)
- **#3 gitignore 드리프트 정리 완료**: .gitignore에 명시됐는데도 추적되던 58개 untrack(`06.tiktok/` 39, `07.youtube/` 13, `*.db` 3, `*.bak` 2, `update_news.py` 1) + `*.bak` 규칙 추가. dirty tracked-modified 22→13. `git rm --cached`라 working tree 파일은 디스크 보존(update_news.py 런타임 정상)
- 안전: 삭제는 전부 비-서빙 파일(크롤러 코드/로그/db/bak)만 — `data/*.json`·`*.csv` 등 사이트 콘텐츠는 무변경

### 6. 🔎 데이터 커밋 파이프라인 점검 (사용자 요청)
- **GROUP B 데이터엔 전담 커밋 파이프라인 없음**: melon-chart·youtube-engagement·timeseries 등 13개가 매일 수집되지만, 커밋 경로는 오직 **나무위키 주간 작업(`NamuWiki_Weekly_Update`, 일 02:30)의 `git add data/` 광범위 sweep**(479파일)뿐. 즉 일일 데이터가 주 1회만 우연히 발행됨
- **원래 뉴스 사고의 진짜 발단 = 이 namu 작업** (05-18 로그로 확정): 품질게이트 에러 4건 → `git checkout -b auto-update/20260518` → 동시 크론들이 만든 dirty tree(`orchestrator_state.json`·`tracking.json`·`new_videos_daily.csv`) 때문에 마지막 `git checkout main`이 "would be overwritten"으로 **실패** → `_git()`이 리턴코드 미검사로 무시 → 리포가 브랜치에 갇힘 → 전 자동화가 main 대신 그 브랜치로 → 사이트 3일 정지
- **추가 취약점**: 에러 경로 PR은 수동 머지 필요한데 안 됨 → 05-11 namu 데이터 main 미반영(strand). namu↔다른 크론 동시성으로 반쯤 쓰인 파일 커밋 위험

### 7. 🔧 namu 파이프라인 강화 (드리프트 구조적 제거)
- **결정**: 발행 주기는 현행 주간 유지(점검만), namu 드리프트는 즉시 수정
- **`05.namu/weekly_update.py` (gitignore라 로컬 전용 — push 안 됨)**:
  - `_git()`에 `check` 파라미터 추가 + `_current_branch()` 헬퍼 → 무성 실패 제거
  - `git_deploy()` **실패 경로를 '브랜치 전환 없음'으로 재구현**: main 위 임시 커밋 → `git push origin HEAD:auto-update/DATE`(원격 브랜치로만) → `git reset --mixed HEAD~1`(로컬 커밋만 되돌림, 변경 보존). 리포가 main을 떠나지 않아 드리프트 구조적 불가. 동시 커밋 감지 시 reset 생략(데이터 유실 방지)
  - 시작 시 브랜치 가드(main 아니면 전환 시도, 실패 시 배포 중단)
  - 스크래치 리포 재현 검증: 시퀀스 후 현재 브랜치 main 유지 / origin엔 main+auto-update 둘 다 / 변경 보존 확인. py_compile OK
- **`data/orchestrator_state.json` untrack + gitignore** (커밋 6872f09): 런타임 상태(미서빙)가 추적·dirty로 남아 checkout 차단하던 주범 제거. 디스크 파일은 보존(런타임 정상)
- **자동 안전망 중첩**: namu(전환 안 함) + 뉴스 self-heal(드리프트 시 main 복귀·ff-merge) 이중

### 8. 📌 남은 과제 (미적용, 사용자 판단 대기)
- **GROUP B 일일 발행**: 현재 주 1회(namu sweep)만 발행. 매일 반영하려면 data/ 전용 일일 commit job 필요(이번엔 보류)
- **namu↔크론 동시성**: 근본적으론 namu 실행 중 다른 크론 일시정지(락)가 이상적

### 3. 💡 Decision Log & Trials
- **채택:** self-healing 가드를 *뉴스 크론*에 배치 — 가장 자주 도는 자동화라 드리프트를 빠르게 교정
- **채택:** ff-merge는 non-fatal(경고만) — 발행 차단보다 뉴스 계속 진행 우선
- **참고:** GitHub Pages source = `origin/main` (origin/HEAD→main), Server 헤더 `GitHub.com`로 호스팅 확인. 이 working copy엔 다른 크론들(tiktok/youtube/orchestrator)도 커밋하므로 브랜치 드리프트 시 전 섹션이 동시에 멈춘다

### 4. 📌 Status & Next
- ✅ 완료: 라이브 사이트 정상 발행 재개, 발행 브랜치 self-heal 가드 적용·검증
- 👉 Next: 작업 트리에 다른 크론들이 남긴 미커밋 변경 28건 존재 — 의도된 것인지 점검 후 정리 또는 .gitignore 검토

---


## [2026-05-17] video_catalog 분류기 EXCLUDE 강화 + in-place 재분류

### 1. 🎯 Context & Goal
- classifier_diagnosis.md 가 식별한 catalog 키워드 분류기 FP 패턴 보완 (마지막 우선순위 C)
- 대표 사례: NewJeans 'MV Review' 4건이 `is_mv=True` 로 잡힘 (분류기 정확도 20% on NewJeans)
- 풀 재빌드(API 3,500 units) 대신 **in-place 재분류** — title 은 이미 catalog 에 있으므로 키워드 룰만 재적용

### 2. 🛠️ Key Changes
- **`07.youtube/collect_video_catalog.py`**: `MV_EXCLUDE` 강화 + 정규식 EXCLUDE 추가
  - 신규 키워드: `review`, `making film`, `shoot sketch`, `mv 시사`, `mv 시청`, `mv 더빙`, `mv filming`, `filming`, `dance video`, `lyric video`, `visualizer`, `special video`
  - 정규식: `\bbh\d*\b` (MV BH2ND 등 Behind 약어)
  - `is_actual_mv()` 함수에 정규식 체크 한 줄 추가
- **`07.youtube/collect_label_mvs.py`**: 동일 EXCLUDE 룰 적용 (둘이 동기화)
- **`07.youtube/reclassify_video_catalog.py` 신규**: catalog 전체 행의 is_mv 만 in-place 재계산 (API 0건)

### 3. 💡 Decision Log & Trials
- **채택**: in-place 재분류 — title 은 catalog 에 이미 있어 API 호출 불필요
- **반려**: collect_video_catalog.py 풀 재빌드 — API 3,500 units 부담 + 영상 stats 변경은 부차적 (기존 EDA 시점 보존이 오히려 reproducibility 측면 유리)
- **dry-run 결과**: 73,114 행 중 **31건 T→F (FP 제거)**, F→T 0건
  - NewJeans 5건 → **1건 (Zero 본 MV만 유지)** — 목표 달성
  - Dreamcatcher 'Dance Video (MV ver.)' 8건 일괄 제거
  - TWICE 'MV Filming' / OH MY GIRL 'filming in Spain' / 그 외 NewJeans 'MV Review' 4건

### 4. 📌 Status & Next
- ✅ 완료: EXCLUDE 강화 (두 스크립트 동기화) + reclassify_video_catalog.py + in-place 적용 + 백업 (`video_catalog.csv.pre_reclassify.bak`)
- 📊 효과 검증: catalog.is_mv=True **1,313 → 1,282** (FP 31건 제거, 모두 합리적)
- ℹ️ 부수 효과: `mv_consensus_set.csv` (v3) 재산출 결과 **v2와 동일 251건** — 31 FP 들은 이미 AND join 에서 Gemini 가 비-MV 로 분류해 자연 제외돼 있었기 때문. 이는 진단의 정합성 강화 (Gemini 가 catalog FP 를 잘 걸러줌 = AND 조합의 강점 재확인)
- 👉 Next: catalog 단독 사용 시 신뢰도 ↑ — 향후 분석에서 `is_mv=True` 필터 단독으로도 noise 적게 사용 가능

---


## [2026-05-17] comeback_monitor 추적 큐를 label channel 본 MV 로 확장

### 1. 🎯 Context & Goal
- classifier_diagnosis.md 가 식별한 "HYBE LABELS 본 MV 16건 전부 `in_mv_curves=False`" 빈틈 해소가 우선순위 1
- 자체 채널 신규 영상만 tracking.json 에 등록되어 BTS SWIM, ILLIT It's Me 등 본 MV 의 hit-curve 시계열 0건
- comeback_monitor 인프라 (persistent loop, mv_curves.csv 매시간 갱신) 는 살아 있으니 등록 로직만 확장하면 누적 가치 큼

### 2. 🛠️ Key Changes
- **`07.youtube/register_label_mvs_to_monitor.py` 신규**:
  - label_mvs.csv → tracking.json append (video_id dict 중복 자동 방지)
  - 30일 초과 영상은 기본 skip (이미 plateau, 추적 가치 작음) — `--include-completed` 옵션으로 강제 등록 가능
  - 신규 entry 에 `source='label_channel'` 마커 보존 (comeback_monitor 는 무시, 분석 시 구분 가능)
  - 백업: `tracking.json.bak` 자동 생성
- **`C:\scripts\youtube\launcher.py`**: refresh 키 3단계 → **4단계** 확장
  - engagement refresh → label collect → **register_label_mvs_to_monitor (신규)** → merge_label_mvs

### 3. 💡 Decision Log & Trials
- **채택**: 30일 이내 영상만 `status='active'` 등록 — comeback_monitor 의 COMPLETION_DAYS=30 정책과 일치, 30일 초과는 첫 snapshot 1회만 찍히고 즉시 completed 되므로 추적 가치 낮음
- **반려**: 30일 초과도 전부 등록 — historical anchor 가치는 있으나 mv_curves.csv 에 single-point 행이 늘어 분석 시 noise
- **dry-run 결과**: 16건 중 **7건 신규 active 등록**, 9건 too-old skip (BTS SWIM/2.0/Hooligan, &TEAM, KATSEYE 등 D+34~58)
  - 등록 영상: ILLIT 'It's Me' Official MV + WONHEE ver. / BOYNEXTDOOR '똑똑똑' ×2 / TWS 'You,You' / LE SSERAFIM 'CELEBRATION' / &TEAM 'Bewitched'

### 4. 📌 Status & Next
- ✅ 완료: register 스크립트 + launcher 통합 + dry-run + 실제 등록 (tracking.json 222 → 229건)
- ⏳ 자동 검증 대기: comeback_monitor 다음 cycle 에 7건 신규 영상 snapshot → mv_curves.csv append 확인 (cycle 정책상 ≤24h 안)
- 👉 Next: (B) 확장 AND set 251건 산출 / (C) catalog 재빌드 + EXCLUDE 강화 (`review`, `shoot sketch`)

---


## [2026-05-17] youtube-engagement.json — `--refresh-days` incremental 갱신 옵션 추가

### 1. 🎯 Context & Goal
- music_chart 프로젝트 ILLIT 'It's Me' 차트인 분석 중 youtube-engagement.json의 ILLIT 영상이 2026-03-07까지만 있고 4~5월 컴백 사이클이 빠진 것 확인
- 원인 추적: `youtube_engagement.py`는 "기존 161개 그룹은 스킵, 신규 그룹만 fetch" 로직 → 기존 그룹의 신규 영상이 영원히 안 들어오는 설계
- Weekly task 정상 실행 (5/17 02:00 ✅) 했어도 동일 — 풀 재크롤은 `--force` 옵션 (API quota 부담)

### 2. 🛠️ Key Changes
- **`07.youtube/youtube_engagement.py`**:
  - argparse 에 `--refresh-days N` 옵션 추가 (default=None, 동작 변경 없음)
  - 스킵 분기에 incremental 모드 추가: refresh-days 설정 시 모든 채널을 fetch 대상에 포함
  - `fetch_recent_videos` 호출 시 `days = refresh_days if set else args.days` — 짧은 윈도우만 fetch
  - **Step 3.5 신규**: incremental merge — 신규 fetch 결과를 기존 영상과 video_id union, 기존 video_type/comeback_phase 분류 정보 보존, stats(views/likes)는 신규로 갱신
- **`C:\scripts\youtube\launcher.py`**: `'refresh'` 키 추가 (`youtube_engagement.py --refresh-days 14`)
- **Windows Task Scheduler**: `YouTube_Daily_Refresh` 신규 등록 (매일 11:00 / launcher refresh / Weekly task 02:00 별도 유지)

### 3. 💡 Decision Log & Trials
- **채택**: incremental merge — `--refresh-days 14` 매일 / `--force` 전체 풀 주 1회 (Weekly) 분리. Weekly가 channel meta + 신규 그룹 처리, Daily가 활성 그룹 신규 영상 sync 역할
- **반려**: 기존 Weekly task의 args 자체를 `--refresh-days`로 변경 — 풀크롤이 영원히 사라져 channel resolve drift 위험
- **반려**: Pumit_YouTubeAM/PM bat 재활용 — bat 자체가 인코딩(UTF-8 BOM 없음 + LF only)으로 즉시 ExitCode 1. 별도 정리 필요한 별개 이슈
- **dry-run**: `--group ILLIT --refresh-days 90` → 영상 166 → 207 (+41 신규, 6 갱신). 2026-05-12~16 컴백 영상 모두 포함 (Performance/Behind/Other)

### 4. 📌 Status & Next
- ✅ 완료: `youtube_engagement.py` 패치, launcher refresh 키, YouTube_Daily_Refresh task 등록 (next run 5/18 11:00)
- ⚠️ 별개 이슈 1: 본 MV (예: `bMhDJ0S0OBA` It's Me Official MV) 는 **HYBE LABELS 채널** 업로드라 ILLIT uploads_playlist에 없음 → `07.youtube/collect_label_mvs.py` 활용 필요
- ⚠️ 별개 이슈 2: Pumit_YouTubeAM/PM bat 인코딩 깨짐 (`'-8' is not recognized`) — 두 task 모두 풀크롤을 같은 일에 3번 시도하는 중복 설계. 정리 또는 폐기 권장
- 👉 Next: 5/18 11:00 첫 자동 실행 후 progress.log에서 [incremental merge] 카운터 확인 / collect_label_mvs.py 재가동 검토

---


## [2026-05-09] 채용공고 파이프라인 자동화 복구 + 5/6~5/8 누락 8건 백필

### 1. 🎯 Context & Goal
- 사용자 질의 "5/7 수신 채용 메일이 사이트에 반영됐는지" 점검 중 누락 발견
- 더 거슬러 올라가 보니 5/6 어트랙트 1건도 누락 → 30일 전수 비교 결과 총 8건 누락 확인
- 원인 추적 + 자동 업데이트 체계 복구가 목표

### 2. 🛠️ Key Changes
- **시트(`jobs`) 추가**: ID 575~582 — 어트랙트, 이엔터테인먼트, 모드하우스(2건), 빅히트뮤직, 쓰리와이(2건), 블루밍그레이스
- **`data/jobs.json` 재생성 + `--verify` 정리**: 270 → 272건 (+8 백필 −6 5/8 마감)
- **`C:\temp\run_jobs_pipeline_daily.bat`**: 오케스트레이터 의존 없는 독립 실행 wrapper
  - GMAIL_USER, GEMINI_API_KEY 명시 / `C:\Python314\python.exe` 절대경로 / 로그 `logs/jobs_pipeline_YYYYMMDD.log`
  - 3단계: email→sheet→json / `--crawl` (HYBE/SM/JYP/YG) / `--verify` (만료 정리) → git push
- **Windows Task Scheduler `AimContents_JobsPipeline_Daily`** 신규 등록 — 매일 09:30 KST 실행

### 3. 💡 Decision Log & Trials
- **채택: 독립 Task Scheduler 작업** — 오케스트레이터 cron(09:00)이 죽어도 30분 후 백업 실행
- **채택: existing_urls 기반 dedup** — 오케스트레이터/Task 양쪽이 모두 살아 있어도 중복 추가 없음
- **폐기: 오케스트레이터 안정화 단독 의존** — 4/28 이후 비정기 사망/재시작 패턴 → 단일 시스템 의존 위험
- **참고: orchestrator state.json `last_job_pipeline=2026-05-05T09:00:36`** — 5/6~5/8 일일 jobs.json 커밋은 `--crawl`만 동작했음을 확인

### 4. 📌 Status & Next
- ✅ 완료: 5/6~5/8 누락 8건 시트+JSON+Push 반영
- ✅ 완료: `AimContents_JobsPipeline_Daily` 매일 09:30 등록 (다음 실행 5/9 09:30)
- 👉 Next: 5/10 09:30 첫 자동 실행 후 `logs/jobs_pipeline_20260510.log` 확인 — 오케스트레이터 09:00 + Task 09:30 양쪽 동작 검증
- 👉 Next: 오케스트레이터 자체 안정성 개선(자동 재시작/헬스체크 보완)은 별도 트랙

---


## [2026-05-05] namu-wiki.json 192 SNS 그룹 100% 매칭 + TikTok URL 일괄 보강

### 1. 🎯 Context & Goal
- aimcontents.com/ranking 의 192개 SNS 그룹 중 namu_url 보유율 90.1% (173/192)
- 누락 19개를 채워 100% 매칭 달성하고, info.틱톡 필드(3.2% 보유)를 기존 tiktok-data로 보강

### 2. 🛠️ Key Changes
- **data/namu-wiki.json**: 174 → 188 그룹 (+14)
  - 신규 stub 14개 추가: 데일리디렉션·키빗업·모디세이·오위스·에스투잇·더씬드롬·튜넥스·언차일드·에버글로우·라임라이트·핑크버스·위키미키·시그니처·에이퓨처
  - 기존 2개 URL 갱신: 우아(woo!ah! → WOOAH), 나우즈(NOWADAYS → NOWZ)
  - **info.틱톡 일괄 보강: 167개 채움 → 173/188 (92.0%)** (tiktok-data/groups/{slug}.json의 tiktok_url 활용, 충돌 0건)
- **data/group-aliases.json**: 별칭 4개 추가
  - 아이들 ← `(G)I-DLE` / 비비지 ← `ViV` / 더킹덤 ← `KINGDOM` / 우아 ← `woo!ah!`
  - 신규 canonical: 나우즈 (aliases: NOWZ, NOWADAYS, nowz, nowadays)
- **05.namu/groups.csv**: 175 → 189 rows (+14)
- **Gemini 파이프라인**: 신규 stub 6개 데이터 채움 (EVERGLOW 4멤버/12앨범, LIMELIGHT 3/4, PINKVERSE 3/2, Weki Meki 8/22, cignature 7/10, Afuture 5/2)
- **정적 분할 파일 재생성** (split_namu_json.py): namu-index/ranking/releases.json + namu-groups/ 188 파일
- **namu.js**: NAMU_DATA_VERSION `'20260504'` → `'20260505d'`

### 3. 💡 Decision Log & Trials
- **채택: stub 먼저 추가 후 Gemini 파싱** — namu_url 매칭(100%)을 즉시 달성하고 멤버/앨범은 후처리
- **채택: tiktok_url 보강은 빈 필드만 채움** — 기존 6개와 tiktok-data 비교 결과 충돌 0건이라 안전
- **폐기: tiktok_history.db slug 활용** — slug가 `make_slug(name_en)` 결과(예: stray-kids)일 뿐 실제 핸들(@jypestraykids)과 무관, 0/43 일치
- **참고: tiktok-data/groups/{slug}.json (173 파일, 100% tiktok_url 보유)** — 2026-03 ~ 2026-05 수집, 그룹별 풍부한 메트릭(profile, posts, hashtags) 동시 보유

### 4. 📌 Status & Next
- ✅ 완료: 192 SNS 그룹 namu_url 매칭 100% (192/192)
- ✅ 완료: info.틱톡 92.0% (173/188), 충돌 0
- ✅ 검증: 173개 URL 외부 oEmbed 라이브 검증 — 171개 정상, 잘못된 URL 2개 + 정규화 4개 수정
  - **THE BOYZ**: `@IST_THEBOYZ`(팬 선점) → `@theboyz_officl`
  - **YOUNITE**: `@younite_bnm`(구) → `@younite_officl`(신, profile/posts STALE 마킹)
  - 대소문자 정규화: AIMERS, BADVILLAIN, MADEIN, TIOT (동일 계정, profile/posts 보존)
  - oEmbed 실패 2개(UNICODE, VVS)는 외부 출처(Kprofiles/kpopping)로 공식 확인
- ✅ 동기화: namu-wiki.json ↔ namu-groups/*.json (0 불일치) ↔ tiktok-data/groups/*.json (0 불일치)
- ✅ tiktok-data/groups/*.json에 `_url_history` 필드 추가 (URL 변경 이력 보존)
- ✅ 미수집 14개 교차검증 (Method 1: Gemini SNS 강조 프롬프트 / Method 2: WebSearch + 한글/영문 키워드)
  - WebSearch 12개 발견 (Gemini는 1개 발견했으나 EVERGLOW에서 WebSearch와 핸들 불일치 → WebSearch 채택)
  - 적용 12개: 데일리디렉션·키빗업·모디세이·오위스·에스투잇·더씬드롬·튜넥스·언차일드·에버글로우·핑크버스·위키미키·시그니처
  - 외부 라이브 검증: 12개 모두 TikTok oEmbed 정상 응답 통과
- ✅ 잔여 2개 추가 수집 → **100% 달성 (188/188)**
  - **라임라이트** (LIMELIGHT): `@limelightseoul` (MADEIN 리브랜드 이전 운영 계정)
  - **에이퓨처** (Afuture): `@4x4dancecrew` (모체 댄스크루 4X4 CREW 계정 공유)
  - NAMU_DATA_VERSION → `'20260505h'`
- 🚧 tiktok-data/groups 메트릭 파일 15개 누락 (URL은 있으나 profile/posts 미수집)
  - 트라이비, 데일리디렉션, 키빗업, 모디세이, 오위스, 에스투잇, 더씬드롬, 튜넥스, 언차일드, 에버글로우, 라임라이트, 핑크버스, 위키미키, 시그니처, 에이퓨처
- 👉 Next: 06.tiktok/crawl_tiktok.py 또는 tiktok_monthly.py 실행 시 위 15개 자동 수집 (그룹 리스트는 namu-wiki.json에서 자동 동기화)

---


## [2026-04-11] S23 폴링 시스템 — ADB 태스크 자동 이관

### 1. 🎯 Context & Goal
- A90 배터리 팽창(2026-04-09)으로 모든 ADB 태스크 비활성화
- S23은 항상 연결이 아니므로 고정 스케줄 불가 → 폴링 방식 필요
- S23 연결 시 미진행 태스크(Weibo/TikTok/Hanteo) 자동 실행

### 2. 🛠️ Key Changes
- **phone_health.py**: `S23_SERIAL` 상수 + `resolve_s23_serial()` 함수 추가 (USB만 지원)
- **orchestrator.py**:
  - `job_s23_device_poll()` — 10분 주기 S23 연결 감지 + 미진행 태스크 순차 실행
  - `_get_pending_s23_tasks()` — Weibo(24h), TikTok/Hanteo(7d) 미진행 판단
  - `_run_weibo_daily_s23()`, `_run_tiktok_weekly_s23()`, `_run_hanteo_weekly_s23()`
  - 기존 A90 cron 주석 → S23 폴링 스케줄러로 대체
  - `print_status()`에 S23 상태 + 미진행 태스크 표시
  - `--run s23_poll`로 수동 트리거 지원
- **weibo_daily.py**: `ADB_DEVICE` 환경변수 → S23 → A90 순서로 디바이스 해석

### 3. 💡 Decision Log & Trials
- **채택:** 10분 폴링 — S23 비상시 연결이므로 가장 단순하고 안정적
- **폐기:** cron 트리거 유지 → S23 비연결 시 무조건 실패, misfire 누적
- **채택:** 태스크 간 S23 재확인 → 중간에 USB 분리 시 깔끔한 중단

### 4. 📌 Status & Next
- ✅ 완료: S23 폴링 시스템 구현 (phone_health + orchestrator + weibo_daily)
- ✅ 검증: `--status` 명령으로 S23 감지 + 미진행 태스크 확인 OK
- 🚧 주의: Weibo는 S23에 쿠키(/data/local/tmp/cookies.txt) 사전 설정 필요
- 👉 Next: S23에서 Weibo 쿠키 설정 확인, orchestrator 재시작으로 폴링 활성화


## [2026-03-19] Melon 크로스레퍼런스 리빌드 + video_id 인리치먼트

### 1. 🎯 Context & Goal
- ytmusic-tracks-streams.json이 6,401개 트랙으로 인리치됨 (video_id + youtube_views/likes/comments)
- 기존 song-crossref.json에는 ytm_video_id가 null이었음 (ytmusic-ids.json 원본이 null)
- 3단계 크로스레퍼런스 파이프라인 전체 리빌드하여 video_id 데이터 반영

### 2. 🛠️ Key Changes
- **build_isrc_crossref.py**: ytmusic-tracks-streams.json에서 video_id 룩업 생성하는 `build_video_id_lookup()` 함수 추가
  - Phase 2에서 ytmusic-ids.json의 null video_id를 streams 룩업으로 대체
  - 크로스레퍼런스 출력에 youtube_views, youtube_likes 필드 추가
  - song-crossref-stats.json에 video_id_count, video_id_rate, youtube_views_count 통계 추가
- **파이프라인 실행 순서**: build_album_crossref.py → ytmusic_search_crossref.py → build_isrc_crossref.py → build_3way_crossref.py

### 3. 💡 Decision Log & Trials
- **채택: streams 룩업 방식** — ytmusic-ids.json 원본 수정 대신, build_isrc_crossref.py에서 streams 파일을 보조 소스로 사용. 기존 파이프라인 호환성 유지
- **참고: 앨범 매칭 분리 구조** — build_album_crossref.py(base, get_artist 10개 한도) + ytmusic_search_crossref.py(search API 보충, progress 파일 resume) 2단계
- **발견: 검색 progress 재사용** — 기존 1,498개 검색 결과가 progress 파일에 보존되어 별도 API 호출 없이 즉시 merge

### 4. 📌 Status & Next
- ✅ 완료: song-crossref.json에 video_id 95.7% 보유 (2,831/2,958), youtube_views 95.7% (2,830/2,958)
- ✅ 완료: 3-way 크로스레퍼런스 동일 수준 유지 (49.9% 3플랫폼, 72.0% any match)
- 👉 Next: video_id 미보유 127개 트랙 추가 인리치 검토, MusicBrainz 추가 수집으로 ISRC 매칭률(31.8%) 개선

---


## [2026-03-18] Instagram pando 캐시 diff 수집기 구현 (ig_pando_collector.py)

### 1. 🎯 Context & Goal
- A90(루팅, RFCN30XWX8W) 기기의 Instagram pando 바이너리 캐시를 파싱해 K-pop 계정 engagement 수집
- Frida/mitmproxy SSL 우회 실패 → pando 캐시 diff 방식으로 전략 전환
- 목표: 150개 K-pop 계정의 like_count, comment_count, follower_count, shortcode 수집

### 2. 🛠️ Key Changes
- **08.instagram/ig_pando_collector.py** (신규 완성):
  - pando 바이너리 포맷 역공학: field_name + type_byte(`l`/`s`/`n`/`b`) + value
  - `set_time_reference()`: pando 디렉토리 내 `.ref_ts` 생성 (같은 파일시스템, find -newer 정확도 확보)
  - `get_modified_files()`: `find -newer .ref_ts -name P3*`로 새/변경 파일 감지
  - `parse_pando_file()`: like_count, comment_count(fb_ prefix 제외), shortcode(`\x00code` 패턴), follower_count, play_count, taken_at 추출
  - `clear_cache_and_restart()`: force-stop 없이 P3* 파일만 삭제 (세션 보호)
  - `wait_for_instagram()`: foreground 앱 확인으로 Instagram 미포커스 감지
- **data/ig-pando-engagement.json** (신규): ivestarship 1개 계정 수집 완료

### 3. 💡 Decision Log & Trials
- **채택: pando 캐시 diff 방식** — 성공 (ivestarship: followers=6,718,142, 57posts, avg_likes=166,655, avg_comments=594)
- **폐기: force-stop + 재시작** → Instagram 세션 rate limiting 발생, 프로필 그리드 API 차단
- **발견: comment_count 파싱 버그** → `rfind(b'comment_count')`가 `fb_comment_count` 내 부분문자열을 반환. `fb_` prefix 역방향 필터로 해결
- **발견: shortcode 필드명** → `b'codes'` 아님, `b'\x00code'`(null+code, offset=5)가 정확한 패턴
- **발견: pando 캐시 생성 조건** → 프로필 직접 방문보다 홈 피드 로딩 시 생성됨. 이미 캐시된 계정은 재방문해도 신규 파일 미생성 (Instagram cache-hit 정책)
- **발견: find -newer 파일시스템 주의** → `/sdcard`와 `/data` 간 mtime 비교 부정확. 타임스탬프 기준 파일을 pando 디렉토리 내에 생성해야 정확함
- **폐기: am force-stop** → Instagram rate limiting 악화. 앱 세션은 반드시 유지해야 함

### 4. 📌 Status & Next
- ✅ 완료: pando 바이너리 파서 (like/comment/shortcode/follower/play 추출)
- ✅ 완료: ivestarship 데이터 수집 (followers=6,718,142, avg_likes=166,655, avg_comments=594)
- 🚧 보류: Instagram rate limiting으로 프로필 그리드 로딩 차단 (30-60분 대기 후 재시도)
- 👉 Next: rate limiting 해소 후 `python ig_pando_collector.py --start 0 --count 20` 실행
- 👉 Next: pando 캐시가 생성되지 않는 계정은 기존 ig-engagement.json(2026-03-14) 데이터로 보완
- 👉 Next: ig-pando-engagement.json + ig-engagement.json 병합 스크립트 작성

---


## [2026-03-18] Spotify 내부 API 스트리밍 데이터 수집 + 전체 데이터 검증

### 1. 🎯 Context & Goal
- 루팅된 A90 + mitmproxy로 Spotify 내부 API(spclient.wg.spotify.com) 토큰 캡처
- 170개 아티스트의 월간 청취자 수 + 인기 트랙 총 재생수 수집
- 전체 수집 데이터 완전성·무결성 검증

### 2. 🛠️ Key Changes
- **10.spotify/spotify_stream_collector.py** (신규): Spotify 내부 API 스트리밍 수집
  - `/artistview/v1/artist/{id}` → monthly_listeners + top 10 tracks streams
  - 174개 아티스트, 169개 월간 청취자, 1,563개 인기 트랙
  - 토큰 만료 시 resume 지원
- **10.spotify/spotify_internal_collector.py** (신규): 내부 API로 앨범 수집
  - 공식 API rate limit 완전 우회, 169개 아티스트 2,516개 앨범 수집
- **10.spotify/data/spotify-streams.json** (신규): 스트리밍 데이터
- **11.melon/validate_all_data.py** (신규): 13개 파일 전체 검증
  - ERROR 0건, WARNING 14건 (모두 설명 가능)
- **11.melon/data/validation-report.json** (신규): 검증 리포트

### 3. 💡 Decision Log & Trials
- **채택: Spotify 내부 API(spclient.wg.spotify.com)** — 공식 API rate limit 완전 우회
  - mitmproxy 시스템 인증서로 SSL 핀닝 없이 HTTPS 캡처 (frida 불필요)
  - Bearer 토큰은 앱 실행 시 자동 캡처 (spotify_api_captured.jsonl)
  - 공식 API limit=10 제한, Development mode 429 → 내부 API에는 해당 없음
- **발견: artistview 응답에 곡별 총 재생수 포함** — 공식 API에서는 제공하지 않는 데이터
- **발견: Spotify rate limit은 IP가 아닌 Client ID(앱) 기반** — IP 변경/테더링으로 해결 불가

### 4. 📌 Status & Next
- ✅ 완료: Spotify 스트리밍 (169개 아티스트, ML + 1,563 트랙 재생수)
- ✅ 완료: Spotify 앨범 (169개 아티스트, 2,516개 앨범)
- ✅ 완료: 3-way 크로스레퍼런스 (Melon 67.9%, YTMusic 54.1%, 3플랫폼 49.9%)
- ✅ 완료: 전체 데이터 검증 (ERROR 0, WARNING 14)
- 👉 Next: Spotify Phase 2 (ISRC + UPC 수집) — 내부 API 토큰 활용
- 👉 Next: ISRC 기반 Melon↔Spotify↔YTMusic 곡 매칭률 개선

---


## [2026-03-17] MusicBrainz ISRC/UPC 수집 + Spotify 자동 수집 파이프라인

### 1. 🎯 Context & Goal
- Spotify API rate limit(429) 장기 차단(~19시간) 중 대안 소스 탐색
- ISRC/UPC 코드 확보로 크로스 플랫폼 트랙 레벨 exact match 기반 마련
- Spotify 수집 자동화 개선 (Development mode 제약 대응)

### 2. 🛠️ Key Changes
- **11.melon/musicbrainz_collector.py** (신규): MusicBrainz 무료 API로 ISRC+UPC 수집
  - 인증 불필요, rate limit 1 req/sec (Spotify보다 훨씬 느슨)
  - 아티스트 검색 → release(앨범) UPC → recording(트랙) ISRC
  - KR release 또는 barcode 있는 release 최대 20개/아티스트
- **11.melon/data/musicbrainz-ids.json** (신규): 174개 아티스트 수집 결과
  - 170/174 아티스트 발견 (97.7%), UPC 1,733개, ISRC 8,825개
- **10.spotify/spotify_slow_collector.py** (개선): Development mode 대응
  - limit=10 고정, 429 시 즉시 중단(ban 연장 방지), progress 저장
- **10.spotify/spotify_phase2_tracks.py** (신규): 트랙+ISRC+UPC 수집 Phase 2
  - /v1/albums/{id} → external_ids.upc, /v1/tracks → external_ids.isrc
- **10.spotify/auto_collect.py** (개선): Phase 1→Phase 2→3-way 빌드 자동 연결

### 3. 💡 Decision Log & Trials
- **채택: MusicBrainz** — 유일한 즉시 사용 가능 무료 소스, ISRC 8,825개 확보
- **폐기: spotifyscraper** — Spotify HTML 구조 변경으로 파싱 실패 (ParsingError)
- **폐기: IFPI ISRC Search** — reCAPTCHA+SPA, 자동화 불가
- **폐기: imdb.copyright.or.kr** — SSL 인증서 오류로 접근 불가
- **폐기: ISRCFinder.com** — JS/AJAX, Spotify 백엔드 의존 (같은 429 문제)
- **발견: Spotify embed 페이지에서 익명 accessToken 추출 가능** — 하지만 IP 기반 rate limit으로 동일하게 429
- **발견: Spotify Development mode limit=20+ → HTTP 400** — limit=10만 허용
- **참고: Extended Quota Mode** — 법인+250K MAU 필요, 적용 불가

### 4. 📌 Status & Next
- ✅ 완료: MusicBrainz ISRC 8,825개 + UPC 1,733개 (170/174 아티스트)
- ✅ 완료: Melon 곡 15,651곡 (2,751 앨범)
- ⏰ 스케줄됨: SpotifyAutoCollect (점진적 배치 수집, rate limit 해제 대기)
- 👉 Next: ISRC 기반 Melon↔MusicBrainz↔YTMusic 곡 매칭
- 👉 Next: Spotify 완료 후 3-way + ISRC 통합 크로스레퍼런스

---


## [2026-03-16] 멜론 스트리밍 중복값 버그 수정 + 타이틀곡 태깅 98.4% 완료

### 1. 🎯 Context & Goal
- 멜론 스트리밍 수집기(ADB 2대)의 중복값 버그 발견 및 수정
- melon-song-ids-full.json의 is_title 필드 태깅 완료 (68% → 98.4%)
- 스트리밍 데이터 검증 체계 구축

### 2. 🛠️ Key Changes
- **C:/temp/melon_streaming_report.py**: 중복값 실시간 감지 + 배치 검증 추가
  - `streaming_verify_log` 테이블 신설 (song_id, check_date, issue_type, details)
  - `_song_name_visible()`: 곡명 검증 헬퍼
  - `collect_song_streaming()`: prev_data 비교로 인라인 중복 감지
  - `_run_batch_verify()`: 앨범 단위 연속곡 동일값 자동 삭제
  - `--verify-only` 모드 추가
- **C:/temp/melon_title_tagger.py**: search/song 기반 완전 재작성 (v2)
  - album/detail.htm 406 차단 우회 → search/song/index.htm 사용
  - 아티스트별 검색, 페이지네이션(50개/페이지, 최대20페이지)
  - progress v1→v2 자동 변환 (album_id 기반 → flat song_id 기반)
- **melon-song-ids-full.json**: is_title 태깅 14,427/14,661곡 (98.4%)

### 3. 💡 Decision Log & Trials
- **채택:** search/song/index.htm — album/detail.htm은 406 차단, 검색은 안정적
- **발견:** 멜론 동일곡 크로스앨범 스트리밍 공유 — 리패키지/스페셜에디션 수록곡은 원곡과 동일 cumul_listen/cumul_listener 값
  - 100개 "중복" 쌍 중 92개가 정당한 크로스앨범 공유, 6개만 실제 버그
- **타이틀 태깅 다단계 전략:** ①멜론 검색(8,513곡) → ②부분태깅 앨범 b-side 추론(2,172곡) → ③1곡태깅 앨범 확장(1,224곡) → ④싱글/2곡 앨범(49곡) → ⑤EP 첫곡 휴리스틱(623곡) → ⑥에스파 수동태깅(16곡)
- **주의:** MITM 프록시(melon_capture2.py)가 계속 JSON에 곡 추가 중 → 태깅 시점마다 총곡수 변동

### 4. 📌 Status & Next
- ✅ 완료: 중복값 버그 수정 (15개 레코드 삭제, 실시간 감지 가동)
- ✅ 완료: 타이틀곡 태깅 98.4% (Title:2,522, B-side:11,905)
- ✅ 완료: 스트리밍 수집기 재시작 (A90+A32 듀얼 디바이스)
- 🚧 진행중: 스트리밍 수집 789/14,661곡 (~5.4%, 2대 병렬)
- 👉 Next: 수집 완료 후 스트리밍 분석 리포트 작성
- 👉 Next: 분류 로직 오탐 수정 (CIX x패턴 10개, Korean Ver 12개, Part.N 25개)

---


## [2026-03-16] 플랫폼 ID 수집 개선 + 자동 수집 스케줄링

### 1. 🎯 Context & Goal
- Melon 빈 앨범 2,054개 재수집 (IP 차단 해제 후)
- Spotify API 자격증명 등록 및 수집 시작
- YTMusic 검색 기반 매칭으로 크로스레퍼런스 매칭률 개선
- 자동 재시도 스케줄 설정 (Melon + Spotify)

### 2. 🛠️ Key Changes
- **11.melon/melon_song_refill.py** (신규): 빈 앨범 곡 재수집 (songs=[] 항목만 타겟)
- **11.melon/auto_refill.py** (신규): Melon 406 차단 해제 자동 체크 + 재수집 + 스케줄 자동 제거
- **10.spotify/auto_collect.py** (신규): Spotify 429 해제 자동 체크 + 수집 + 3-way 빌드 + 스케줄 제거
- **11.melon/build_3way_crossref.py** (신규): Melon↔Spotify↔YTMusic 3-way 앨범 크로스레퍼런스 빌더
- **11.melon/build_album_crossref.py** (개선): threshold 0.88, 숫자충돌 감지, 트랙수 검증, anomalies.json 출력
- **11.melon/ytmusic_search_crossref.py** (신규): get_artist() 10개 한도 우회, YTMusic search API 개별 검색
- **10.spotify/spotify_ids_collector.py** (개선): Phase 1 앨범만 수집, DELAY 2.5s, retries 6
- **melon-song-ids-merged.json** (신규): album scrape + guyso.db 병합 11,996곡

### 3. 💡 Decision Log & Trials
- **채택: YTMusic search API** — get_artist_albums() CAROUSEL 구조 10개 한도 돌파 불가 → 검색 API로 +389건 추가 매칭
- **채택: 자동 스케줄링** — Melon/Spotify 차단 해제 시점을 예측 불가 → Windows Task Scheduler 매시간 체크
- **발견: Spotify Premium 필수** — 2025.04 이후 생성 앱은 Web API에 Premium 필요 → 새 무료 계정 불가
- **발견: Melon 반복 차단** — ~1,300 요청 후 재차단 (DELAY 1.5s에서도)
- **패치: ytmusicapi 1.11.5** — get_artist_albums() None 체크 추가

### 4. 📌 Status & Next
- ✅ 완료: YTMusic 검색 매칭 (38%→56.8%, +389건)
- ✅ 완료: Melon 곡 11,991곡 / 2,135앨범 (73%)
- ✅ 완료: 이상치 탐지 102건 (anomalies.json)
- ⏰ 스케줄됨: MelonAutoRefill (773개 빈 앨범, 매시간 406 체크)
- ⏰ 스케줄됨: SpotifyAutoCollect (170개 아티스트, 매시간 429 체크 → 수집 → 3-way 빌드)
- 👉 Next: 두 스케줄 완료 후 3-way 크로스레퍼런스 매칭률 확인
- 👉 Next: ISRC 코드 기반 트랙 레벨 exact match

---


## [2026-03-15] K-POP 161개 그룹 YouTube 콘텐츠 분석 (Gemini 무료 모델)

### 1. 🎯 Context & Goal
- YouTube timedtext API IP 차단 문제로 자막 추출 불가 → 대안 탐색
- Gemini 무료 preview 모델이 YouTube URL을 직접 처리 가능함을 발견 ($0)
- 161개 그룹 전체 YouTube 콘텐츠(언어/테마/팬상호작용 등) 분석 완료
- 데이터 품질 검증 및 3종 오류 수정 완료

### 2. 🛠️ Key Changes
- **C:/temp/yt_full_analysis.py** (신규): 161그룹 × 최대 5영상 Gemini 분석 스크립트
  - `gemini-3.1-flash-lite-preview` 모델 (무료, YouTube URL 직접 처리)
  - `--resume` 플래그: 중단 재개, `--report` 플래그: 보고서만 재생성
  - 증분 저장: `yt_full_progress.json` → 중단 시 재개 가능
- **C:/temp/yt_recollect.py** (신규): 실패/파싱실패 122개 영상 재수집
  - max_output_tokens 2048, 코드블록 금지 프롬프트로 파싱 안정화
  - 부분 복구 정규식: JSON 불완전 시 key-value 개별 추출
- **data/youtube-engagement.json**: 구독자 수 0인 9개 그룹 YouTube API로 수정
  - i-dle(9.62M), TREASURE(7.91M), PENTAGON(1.67M), PURPLE KISS(700K) 등
- **C:/temp/yt_full_results.json**: 전체 분석 결과 (최종)
- **C:/temp/yt_full_report.md**: 5가지 Finding 포함 최종 보고서

### 3. 💡 Decision Log & Trials
- **채택:** Gemini YouTube URL 직접 분석 — youtube-transcript-api/yt-dlp 모두 IP 차단
- **폐기:** youtube-transcript-api + cookies.txt — list()는 성공, fetch()는 429 (IP 레벨 차단)
- **발견:** `gemini-3-flash-preview`, `gemini-3.1-flash-lite-preview` 무료로 YouTube URL 처리 가능
  - `gt.Part(file_data=gt.FileData(file_uri=yt_url, mime_type="video/youtube"))`
- **주의:** RPD 쿼터 초과 시 모델 전환으로 별도 쿼터 사용 (3-flash vs 3.1-flash-lite 독립)
- **주의:** max_output_tokens=1024 부족 → 1024로도 JSON 잘림 발생 → 2048 사용 권장
- **주의:** 배경 실행 시 Python 출력 버퍼링으로 progress.json 기준 모니터링 필요
- **주의:** 배경 실행 시 메모리 이슈(3.8GB) 발생 가능 → `--workers 1` 권장

### 4. 📌 Status & Next
- ✅ 완료: 161개 그룹 분석, 786/791 영상 성공 (99.4%)
- ✅ 완료: 파싱실패 72개 패치, 실패 50개 재수집, 구독자 수 9개 수정
- ✅ 완료: 모든 구조화 필드(language/main_theme/fan_interaction/global_accessibility) 빈값 0
- 🚧 잔여 실패: 5개 영상 (ATEEZ·RESCENE·IDID max_retry, PLAVE·VANNER token_limit)
- 👉 Next: yt_full_results.json 데이터를 aimcontents.com에 연동 or 추가 분석


## [2026-03-15] 한터차트 + 후즈팬 자동 수집 파이프라인 구축

### 1. 🎯 Context & Goal
- S23 ADB로 한터차트(CDP) + 후즈팬 앱(uiautomator2) 데이터를 정기 수집
- Circle Chart 주간 데이터(generate_circle_weekly.py) 이후 실시간/신규 판매량 지속 수집
- Track B(컴백 트리거): 발매 D+0~D+6 집중 수집으로 초동 판매량 포착

### 2. 🛠️ Key Changes
- **07.hanteo/config.py** (신규): 디바이스 추상화(S23/A90), ADB helper, 경로/URL/지연 상수
  - 후즈팬 패키지명: `com.hanteo.whosfanglobal` (실기기 확인)
- **07.hanteo/hanteo_cdp_crawler.py** (신규+수정): Chrome DevTools Protocol로 한터차트 DOM 파싱
  - `Page.navigate`로 탭 직접 제어 (am start 대신) — 탭 탐색 오류 해결
  - `.chart-item.rank-data` 셀렉터 + `.see-more-btn` 자동 클릭 → **100개 전체 수집**
  - DOM 구조: `.rank-container > .top` / `.center .row-container` / `.right .stat-container`
  - CDP 실패 시 스크린샷+Gemini OCR 폴백
- **07.hanteo/whosfan_u2_crawler.py** (신규+수정): 후즈팬 앱 u2 크롤러 (백업용)
  - WebView 내장 한터차트 → 5단계 네비게이션 (앱→팬터차트→차트→카테고리→기간)
  - x/y 좌표 겹침 문제 해결: 카테고리 탭 y=575, 기간 탭은 텍스트 매칭
  - 행 파싱: rank_y ~ next_rank_y 범위 기반 좌/우 영역 분리 (x < 1100 = 제목/아티스트, x >= 1100 = 판매량/가중치)
- **07.hanteo/comeback_tracker.py** (신규): 컴백 일정 CRUD + Track B 트리거 판단
- **07.hanteo/scheduler.py** (신규+수정): CDP만 정기 수집 (후즈팬/월드차트 제거)
  - Track A: 주간(월요일 01:00), 월간(1일 01:00), 연간(1/2 01:00)
  - Track B: 매일 06:00 컴백 체크 → real-time 차트 수집

### 3. 💡 Decision Log & Trials
- **채택:** CDP Page.navigate — `am start`보다 탭 제어 정확도 높음
- **채택:** "더보기" 반복 클릭 — 20개→100개 전체 로드 (5회 클릭, 각 1.5초 대기)
- **채택:** CDP 메인, 후즈팬 백업 — 동일 데이터원이므로 CDP로 충분
- **폐기:** 월드차트/소셜차트 수집 — pumit에서 활용 안 됨
- **주의:** Chrome 탭이 다수일 때 `hanteochart` URL 우선 선택 로직 필요
- **주의:** 후즈팬 상단 "차트" 서브탭과 "음반" 카테고리 탭이 좌표 겹침 → y=575로 회피

### 4. 📌 Status & Next
- ✅ 완료: CDP 실 동작 검증 — real-time 100개, weekly 100개 정상 수집
- ✅ 완료: 후즈팬 u2 검증 — album 20개 정상 (CDP 백업용)
- ✅ 완료: Windows Task Scheduler 등록 (HanteoScheduler, 부팅 후 1분)
- 👉 Next: 컴백 트래커에 실제 컴백 등록 후 Track B 테스트

---


## [2026-03-15] 플랫폼 ID 크로스레퍼런스 구축 (Melon + Spotify + YouTube Music)

### 1. 🎯 Context & Goal
- 175개 K-pop 그룹의 멜론·스포티파이·유튜브뮤직 ID를 수집하여 크로스 플랫폼 분석 기반 마련
- artist_id → album_id → song_id 3계층 ID 체계 구축

### 2. 🛠️ Key Changes
- **11.melon/data/platform-artist-ids.json** (신규): 174개 그룹 × Melon+Spotify+YouTube artist ID
  - Melon: 172/175, Spotify: 171/175, YouTube: 173/175, 3플랫폼 모두: 170/175
- **11.melon/data/melon-album-ids.json** (신규): 163개 아티스트 × 2,908개 Melon 앨범
- **11.melon/data/melon-song-ids-full.json** (완료): 2,908 앨범 처리, 4,956곡 (2,054 앨범 IP 차단으로 빈값)
- **11.melon/data/melon-song-ids-merged.json** (신규): 11,996곡 (album scrape 4,956 + guyso.db 7,040 병합)
  - guyso_meta 597곡에 melon_artist_id 매핑 보강 (70개 아티스트 이름 매핑)
- **11.melon/data/ytmusic-ids.json** (완료): 174/174 처리, 146 성공, 325 앨범 + 1097 싱글
  - ytmusicapi는 아티스트당 최근 10 albums + 10 singles만 반환 (API 제한)
  - ytmusicapi 1.11.5 버그 패치 (get_artist_albums에서 None 체크 추가)
- **11.melon/data/album-crossref.json** (개선): Melon↔YTMusic 앨범 매칭
  - 매칭률 40% → **56.8%** (1,453/2,560)
  - 개선 내역: threshold 0.80→0.88, 숫자충돌 감지, 트랙수 교차검증, YTMusic search API 추가매칭(+389건)
  - Fuzzy 오매칭 34건 제거 (ARE YOU THERE Take.1↔WE ARE HERE Take.2 등)
- **11.melon/data/album-crossref-anomalies.json** (신규): 1:N browse_id 중복 102건 탐지·기록
- **11.melon/ytmusic_search_crossref.py** (신규): Melon 미매칭 앨범 YTMusic search API 검색 매칭
  - get_artist()의 10개 한도 우회, 숫자충돌 감지, 트랙수 검증
- **10.spotify/spotify_ids_collector.py** (개선): Phase 1(앨범만) 수집으로 API rate limit 방지
  - DELAY 1.0→2.5, retries 3→6, Retry-After 최소 10초
- **10.spotify/data/** (신규 디렉토리): Spotify 수집 결과 저장 위치

### 3. 💡 Decision Log & Trials
- **채택: aiming_paper 기존 데이터 우선 활용** — 멜론 검색/AJAX는 봇 차단(500)
- **채택: YTMusic search API 개별 검색** — get_artist()의 10개 한도 우회, 미매칭 1,792개 중 389개 추가 매칭
- **채택: 2단계 Spotify 수집** — Phase 1(앨범만)으로 API 호출 최소화 후 Phase 2(트랙)
- **폐기: ytmusicapi get_artist_albums()** — CAROUSEL 구조로 여전히 10개만 반환, order 파라미터도 KeyError
- **발견: Melon IP 차단(406)** — 1,813 앨범 스크래핑 후 IP 차단, 10분 쿨다운으로도 해제 안됨
- **발견: Spotify rate limit** — BLACKPINK 23앨범+트랙 수집(~50 API calls)에서 즉시 429, ban 연장됨
- **패치: ytmusicapi 1.11.5** — browsing.py:366 `nav(results, GRID, True)` None 반환 시 TypeError → None 체크 추가

### 4. 📌 Status & Next
- ✅ 완료: platform-artist-ids.json/csv (아티스트 레벨 3-플랫폼 ID)
- ✅ 완료: melon-album-ids.json (2908개 앨범)
- ✅ 완료: melon-song-ids-merged.json (11,996곡)
- ✅ 완료: ytmusic-ids.json + album-crossref.json (매칭률 56.8%)
- ✅ 완료: album-crossref-anomalies.json (1:N 중복 102건)
- 🔄 진행 중: Spotify album/track ID 수집 (rate limit 해제 대기 중)
  - Client ID/Secret 발급 완료, 인증 성공
  - BLACKPINK 23앨범/97트랙 수집 완료, 나머지 169개 아티스트 대기
- 🚧 보류: Melon 2,054 빈 앨범 재수집 (IP 차단 해제 필요, VPN 또는 더 긴 딜레이)
- 👉 Next: Spotify rate limit 해제 후 170개 아티스트 앨범 수집 재시작
- 👉 Next: Spotify 완료 후 Melon↔Spotify↔YTMusic 3-way 크로스레퍼런스 빌드
- 👉 Next: ISRC 코드 기반 트랙 레벨 exact match (Spotify API에서 제공)

---


## [2026-03-15] 멜론 앱 스트리밍 리포트 + song_meta 수집 자동화

### 1. 🎯 Context & Goal
- 멜론 앱(A90)에서만 볼 수 있는 스트리밍 리포트(누적 감상 수/감상자/데일리 감상자) 수집 자동화
- 웹 크롤링으로 수집 가능한 song_meta(장르/작사/작곡/편곡/좋아요/댓글/가사) 백그라운드 수집

### 2. 🛠️ Key Changes
- **C:/temp/melon_song_meta.py** (신규): melon_song_meta 테이블 수집
  - 3개 소스: PC HTML(장르/댓글/가사) + 모바일 HTML(작사/작곡/편곡) + API(좋아요수)
  - 7,423곡 대상, 백그라운드 실행 중 (~20% 완료)
- **C:/temp/melon_streaming_report.py** (신규): uiautomator2 ADB 자동화
  - 멜론 앱 검색 → 곡 상세 → 스크롤 → dump 파싱 → DB 저장
  - melon_song_streaming 테이블 (song_id, collected_date, cumul_listen, cumul_listener, daily_listener)
  - 테스트 성공: BANG BANG (IVE) 누적 감상 수 15,906,468 / 감상자 1,221,754
  - 백그라운드 실행 중 (최근 30일 활성 986곡 중 상위 200곡)
- **C:/temp/melon_capture2.py** (신규): mitmproxy addon (Android CA 신뢰 문제로 미사용)

### 3. 💡 Decision Log
- **채택: uiautomator2 UI dump 방식** — mitmproxy 대신 화면 텍스트 직접 읽기
  - Android 7+ 앱이 User CA 인증서 신뢰 안 함 → HTTPS 차단 → mitmproxy 불가
  - `d.dump_hierarchy()` XML → 텍스트 파싱으로 수치 추출
- **폐기: 멜론 딥링크** — `melonapp://song?songId=XXX` → 홈으로만 이동, 상세 진입 불가
- **실수: `d.app_clear()` 호출** → 멜론 앱 로그인 세션 초기화됨 → 사용자 재로그인 필요
- **프록시 완전 제거**: `global_http_proxy_host/port/exclusion_list` 세 키 모두 삭제해야 함
  - `settings delete global http_proxy` 만으로는 부족

### 4. 📌 Status & Next
- ✅ 완료: melon_song_meta.py 작성 및 백그라운드 수집 시작
- ✅ 완료: melon_streaming_report.py 작성 및 단일 곡 테스트 성공
- ✅ 완료: 컴백 감지 알고리즘 완화 → 4건 → 40건 (prev_avg>200, curr<=100)
- 🚧 진행 중: melon_song_meta.py (~20% 완료, 약 6시간 남음)
- 🚧 진행 중: melon_streaming_report.py (상위 200곡, ~83분 예상)
- 🚧 미완: 20260314~15 멜론 0건 — guyso.me 미업로드, 추후 재실행
- 👉 Next: streaming report 수집 완료 후 idol_analysis.py에 누적 감상 수 지표 추가

---


## [2026-03-15] 컴백 D+0~D+14 이용자수 추이 분석 + GROUP_MAP 확장 + YouTube 콘텐츠 전략 분석

### 1. 🎯 Context & Goal
- 컴백 이후 D+0~D+14 일별 이용자수(count) 변화 패턴 분석
- idol_analysis.py GROUP_MAP 확장 및 매핑 버그 수정
- 161개 K-POP 그룹 YouTube 콘텐츠 전략 Gemini 분석 완료

### 2. 🛠️ Key Changes
- **C:/temp/comeback_count_trend.py**: D+0~D+14 이용자수 추이 분석 (신규)
  - GROUP_PATTERNS 69개 그룹 패턴 매핑
  - ±2일 허용 count 추출 (컴백일 오차 보정)
  - Section 0: count NULL 비율 / Section 1: 그룹별 D+0~D+14 중앙값
  - Section 2: Tier별 집계 / Section 3: Top 30 이벤트 / Section 4: D+14 유지율
  - 출력: C:/temp/comeback_count_trend.md, C:/temp/comeback_count_trend.json
- **C:/temp/idol_analysis.py**: GROUP_MAP 58개 → 65개 확장
  - 버그 수정: `(여자)아이들` → `['i-dle (아이들)']` (1168일 데이터 복구)
  - 버그 수정: `샤이니` → `['SHINee (샤이니)']`
  - 신규 추가: VIVIZ, 프로미스나인, 이클립스, 엔시티위시, 리센느, 비투비, 에이비식스, 이세계아이돌
  - 기존 강화: 방탄소년단 멤버 솔로, 세븐틴 서브유닛, 데이식스 멤버 솔로, 빅뱅 멤버 솔로
- **C:/temp/yt_full_analysis.py**: 161개 그룹 YouTube Gemini 분석 완료
  - 322/791 영상 분석 성공 (소형 85개 그룹 분석 실패)
  - 출력: C:/temp/yt_full_results.json (531KB), C:/temp/yt_full_report.md (3259줄)

### 3. 💡 핵심 Findings
- **D+0~D+14 패턴**: S-tier 76% D+14 유지율 (팬덤 결집→급락), A-tier 110%, B-tier 148% (알고리즘 확산)
- **바이럴 히트**: 화사 391%, 프로미스나인 348%, 하츠투하츠 341% D+14 유지율 (슬리퍼 히트)
- **(여자)아이들 복구**: 기존 매핑 오류로 0건 → 수정 후 8,411건 (Tier A)
- **이클립스 발견**: 중앙이용자 40,123명 = 전체 4위 (GROUP_MAP에 없어서 누락됐던 그룹)
- **YouTube 전략**: 소형 그룹 좋아요율 9.82%/댓글율 1.09% (초대형의 2.5배 높은 팬 밀도)
- **YouTube 언어전략**: 구독자 규모↑ → 혼합언어 비중↑ (초대형 46%, 중형 한국어 50%)

### 4. 📌 Status & Next
- ✅ 완료: 컴백 D+0~D+14 추이 분석
- ✅ 완료: GROUP_MAP 65개로 확장 + 매핑 버그 2건 수정
- ✅ 완료: YouTube 161개 그룹 콘텐츠 전략 분석 (yt_full_report.md)
- ✅ 완료: 컴백 감지 알고리즘 완화 → 4건 → 40건 감지 (prev_avg>200, curr<=100)
- ✅ 완료: IndexError 버그 수정 (day_counts 미사용 죽은 코드 제거)
- 🚧 미완: 20260314~15 멜론 0건 — guyso.me 미업로드 상태, 추후 재실행 필요
- 🚧 미완: 소형 85개 그룹 YouTube Gemini 분석 실패 (API rate limit / URL 접근 불가)
- 🚧 미완: Melon 앱 API 캡처 (mitmdump 실행 중, 폰 프록시 설정 필요)
- 👉 Next: idol_chart_analysis.md G섹션 결과 검토 및 활용

---

