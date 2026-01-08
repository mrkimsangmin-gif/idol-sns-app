# Idol SNS App - 개발 가이드 및 규칙

## 📋 프로젝트 개요

K-Pop 아이돌의 SNS 팔로워/구독자 수 데이터를 월별로 집계하고 랭킹을 표시하는 웹 애플리케이션

**기술 스택**:
- Backend: Google Apps Script (GAS)
- Frontend: HTML, Vanilla JavaScript, Bootstrap
- Database: Google Sheets
- Deployment: GAS Web App

---

## 🏗️ 아키텍처 설계 원칙

### 1. **월별 캐싱 전략** (핵심)

**문제**: Google Apps Script의 `CacheService`는 100KB 크기 제한 존재

**해결**: 전체 데이터 대신 **월별로 분할**하여 캐싱
```javascript
// 캐시 키 구조
meta_${gender}_${sns}           // 월 목록만 (경량)
data_${gender}_${sns}_${month}  // 월별 데이터
```

**장점**:
- 각 월 데이터는 작아서 100KB 제한 회피
- 최근 3개월만 캐싱하여 메모리 효율적
- 필요한 월만 로드하여 성능 최적화

### 2. **점진적 로딩 (Progressive Loading)**

```javascript
// 1단계: 최근 2개월 우선 로드 (init=true)
fetch(`${API_URL}?gender=${gender}&sns=${sns}&init=true`)

// 2단계: 백그라운드에서 전체 데이터 로드
setTimeout(() => loadData(false), 100)
```

**효과**: 초기 페이지 로드 시간 단축 (20초 → 1-2초)

### 3. **클라이언트 캐싱**

- 한 번 받은 데이터는 `cachedData`, `cachedMonths` 변수에 저장
- 월 변경 시 API 호출 없이 즉시 렌더링
- 성별/SNS 변경 시에만 재호출

---

## ⚠️ 주의사항 및 알려진 이슈

### 1. **Regex 패턴 작성 시 주의**

**잘못된 예** (이중 백슬래시):
```javascript
const match = dateStr.match(/(\\d{4})[\\.\\/-](\\d{1,2})/);  // ❌
if (month.match(/^\\d{4}-\\d{2}$/)) { }  // ❌
```

**올바른 예** (단일 백슬래시):
```javascript
const match = dateStr.match(/(\\d{4})[\\.\\/-](\\d{1,2})/);  // ✅
if (month.match(/^\\d{4}-\\d{2}$/)) { }  // ✅
```

**원인**: JavaScript 정규식 리터럴에서 `\\d`는 숫자, `\\\\d`는 문자 "\\d"를 의미

### 2. **스프레드시트 데이터 형식**

**시트 이름**: `sns_data`

**필수 컬럼**:
| 컬럼명 | 설명 | 예시 |
|--------|------|------|
| name | 아이돌 이름 | 카리나 |
| group | 그룹명 | 에스파 |
| gender | 성별 | 여자, 남자 |
| sns | SNS 유형 | X(트위터), 웨이보, 인스타그램 |
| date | 날짜 | 2025-11, 2025.11 |
| count | 팔로워 수 | 2583000 (쉼표 자동 제거) |

**날짜 형식**:
- 지원: `2025-11`, `2025.11`, `2025/11`, JavaScript Date 객체
- 최종 변환: `yyyy-MM` (예: `2025-11`)

### 3. **CacheService 제한**

- **최대 크기**: 100KB per item
- **유효 기간**: 최대 21600초 (6시간)
- **전략**: 월별 분할로 크기 제한 회피
- **만료 시**: 자동으로 시트에서 재로드

### 4. **성능 최적화 체크리스트**

**백엔드 (Code.js)**:
- ✅ 날짜 포맷 결과 캐싱 (`Map` 사용)
- ✅ 배열 검색을 `Set.has()` O(1)로 변경
- ✅ 월별 데이터만 조회하여 불필요한 루프 최소화

**프론트엔드 (script.js)**:
- ✅ 전역 변수 선언 (`cachedData`, `cachedMonths`)
- ✅ 점진적 로딩 구현
- ✅ 로컬 데이터 기반 통계 계산

---

## 🚀 배포 프로세스

### 1. 코드 수정 및 푸시
```bash
clasp push
```

### 2. Apps Script 에디터에서 배포
1. Apps Script 에디터 열기
2. **[배포]** → **[배포 관리]**
3. 현재 배포 옆 **[수정]** 아이콘 클릭
4. **새 버전** 선택
5. **[배포]** 클릭

### 3. 캐시 갱신 (중요!)
- 스프레드시트에서: **📊 데이터 관리 > 🔄 캐시 갱신**
- 또는 배포 후 6시간 대기 (캐시 자동 만료)

### 4. 테스트
- 브라우저에서 `index.html` 열기
- 다양한 성별/SNS 조합 테스트
- 개발자 도구 콘솔 확인

---

## 🔧 트러블슈팅

### 문제: "데이터가 0개 로드됨"

**원인 체크리스트**:
1. ✅ 스프레드시트에 해당 성별/SNS 데이터가 존재하는가?
2. ✅ 날짜 컬럼이 `yyyy-MM` 형식으로 파싱 가능한가?
3. ✅ Regex 패턴이 올바른가? (단일 백슬래시)
4. ✅ 최신 버전이 배포되었는가?

**디버깅 방법**:
```javascript
// 브라우저 콘솔에서 API 직접 테스트
fetch('API_URL?gender=남자&sns=웨이보&init=true')
  .then(r => r.json())
  .then(console.log)
```

### 문제: "인수(value)가 너무 큽니다"

**원인**: 데이터가 100KB 초과하여 `cache.put()` 실패

**해결**: 월별 캐싱 전략 확인 (이미 구현됨)

### 문제: "로딩이 끝나지 않음"

**원인**:
1. API 응답이 비어있음 (`allMonths: []`)
2. 네트워크 오류
3. CORS 문제 (로컬 파일 실행 시)

**해결**:
- API URL 직접 접속하여 JSON 응답 확인
- 브라우저 콘솔에서 에러 메시지 확인

---

## 📊 성능 지표 목표

| 지표 | 목표 | 현재 상태 |
|------|------|-----------|
| 초기 로딩 (캐시 히트) | < 1초 | ✅ 달성 |
| 초기 로딩 (캐시 미스) | < 3초 | ✅ 달성 |
| 월 변경 속도 | 즉시 (0초) | ✅ 달성 |
| 성별/SNS 변경 | < 2초 | ✅ 달성 |

---

## 🎯 향후 개선 사항

### 단기 (P0)
- [ ] 웨이보 데이터 스프레드시트 확인 및 수정
- [ ] 자동 캐시 갱신 트리거 설정 (매일 새벽 3시)

### 중기 (P1)
- [ ] 스켈레톤 UI 적용 (Toss UX 원칙)
- [ ] 에러 핸들링 개선 (사용자 친화적 메시지)
- [ ] 로딩 상태 시각화

### 장기 (P2)
- [ ] PWA 변환 (오프라인 지원)
- [ ] 차트 시각화 추가
- [ ] Firestore 마이그레이션 (Sheets 한계 극복)

---

## 📚 참고 자료

- **Toss UX 원칙**: `TOSS` 파일 참조
- **Google Apps Script 제한**: [공식 문서](https://developers.google.com/apps-script/guides/services/quotas)
- **CacheService**: [공식 문서](https://developers.google.com/apps-script/reference/cache/cache-service)

---

**마지막 업데이트**: 2026-01-01
**작성자**: Antigravity AI
