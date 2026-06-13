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

## Phase 1 — 그룹 페이지 190개  ⬜
- [ ] lean 템플릿화(불필요 홈 섹션 제거) + 깜빡임 가드 확정
- [ ] 190개 일괄 생성, 표본 직접 fetch 200 확인
- [ ] 홈 ItemList 16→173 확장

## Phase 2 — 월별 영구 랭킹 URL  ⬜
## Phase 3 — jobs / methodology / llms.txt  ⬜
## Phase 4 — sitemap + GitHub Actions CI + 검증  ⬜
