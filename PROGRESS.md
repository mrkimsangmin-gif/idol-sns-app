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

### 🚧 남은 확인 / 리스크
- **사람 시점(브라우저) 육안 검증 미완**: 코드 경로상 SPA hydrate 정상이나, 실제 브라우저에서 깜빡임/중복 없는지 1회 확인 후 Phase 1 확대 권장 (헤드리스 브라우저 필요)
- BTS와 무관한 숨김 섹션(홈/뉴스/채용)의 "Loading" 플레이스홀더가 HTML에 잔존 → Phase 1에서 lean 템플릿으로 제거
- 생성물 `namu/bts/index.html`은 **아직 미커밋·미배포** (로컬 검증용). 배포는 사용자 승인 후

## Phase 1 — 그룹 페이지 190개  ⬜
- [ ] lean 템플릿화(불필요 홈 섹션 제거) + 깜빡임 가드 확정
- [ ] 190개 일괄 생성, 표본 직접 fetch 200 확인
- [ ] 홈 ItemList 16→173 확장

## Phase 2 — 월별 영구 랭킹 URL  ⬜
## Phase 3 — jobs / methodology / llms.txt  ⬜
## Phase 4 — sitemap + GitHub Actions CI + 검증  ⬜
