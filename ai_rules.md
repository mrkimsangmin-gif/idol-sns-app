# AI 에이전트 행동 수칙

1. **언어:** 모든 대화, 계획(Plan), implementation_plan.md, 워크스루(Walkthrough), 생각(Thought)은 반드시 **"한국어(Korean)"**로 작성한다.
2. **전문 용어:** 프로그래밍 용어(함수 이름, 변수명 등)는 영어 그대로 쓴다.
3. **코드 주석:** 코드를 수정할 때는 각 줄마다 이해하기 쉬운 **한글 주석**을 단다.
4. **워크스루:** Walkthrough를 작성할 때 "Changes", "Verification Steps" 같은 소제목 옆에 **(한글 번역)**을 병기한다.

## 프로젝트 기술 스택 및 아키텍처 규칙

### 1. 백엔드 (Google Apps Script)
- **API 구조:** `doGet(e)` 함수 내에서 `action` 파라미터로 라우팅 처리한다 (예: 기본 조회, `metadata`, `allMetadata`).
- **데이터 캐싱:** 자주 변하지 않는 메타데이터(링크, 정보 등)는 별도 시트(`idol_metadata`)로 관리하며, `allMetadata` 액션으로 일괄 조회 기능을 제공한다.
- **시트 관리:** 외부 연동 시트 ID는 `SHEET_IDS` 상수로 중앙 관리하며, `SpreadsheetApp.openById()`를 통해 안전하게 접근한다.

### 2. 프론트엔드 (HTML/JS/CSS)
- **UI 컴포넌트 (중요):**
  - 드롭다운 메뉴는 네이티브 `<select>` 대신 **Bootstrap Dropdown** 컴포넌트를 사용한다. 이는 메뉴가 위로 열리는 문제 등을 방지하고(`data-bs-popper="static"`) 스타일 일관성을 유지하기 위함이다.
- **성능 최적화:**
  - **프리페칭 & 캐싱:** 초기 로딩 직후 `prefetchMetadata()`를 호출하여 백그라운드에서 메타데이터를 미리 가져온다.
  - **캐시 우선 전략:** 모달 팝업 등 인터랙션 시 API를 호출하기 전에 클라이언트 메모리 캐시(`metadataCache`)를 먼저 확인하여 지연 없는 경험(Zero Latency)을 제공한다.
- **스타일링:** `style.css`를 통해 버튼 호버, 카드 인터랙션 등 미세한 UX 효과를 구현한다.