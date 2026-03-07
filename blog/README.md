# 📌 aimcontents.com 인사이트 메뉴 설치 가이드

## 시스템 구조

```
aimcontents.com (Cloudflare Pages)
├── index.html                ← 기존 메인 (네비에 인사이트 링크 추가)
├── insight/
│   ├── index.html            ← 글 목록 페이지
│   └── post.html             ← 개별 글 보기 (고유 URL, SEO 최적화)
├── admin/
│   └── insight.html          ← 관리자 글 작성/수정 (비밀번호 보호)

Google Sheets → "인사이트" 시트 (CMS)
Google Apps Script → CRUD API
```

---

## 설치 순서

### 1단계: Google Apps Script 배포

1. Google Sheets 열기 → 확장 프로그램 → Apps Script
2. `google_apps_script_insight.js` 코드 붙여넣기
3. **`ADMIN_PASSWORD` 변경** (기본: `aim2026!`)
4. 배포 → 새 배포 → 웹 앱 → **"모든 사용자(익명 포함)"** 🔥
5. 배포 URL 복사

### 2단계: API URL 교체

3개 파일에서 `YOUR_GOOGLE_APPS_SCRIPT_DEPLOYMENT_URL` → 실제 URL:
- `insight/index.html`
- `insight/post.html`
- `admin/insight.html`

### 3단계: GitHub 배포

```bash
mkdir -p insight admin
# 파일 복사 후
git add . && git commit -m "feat: 인사이트 메뉴" && git push
```

### 4단계: 메인 페이지 메뉴 추가

```html
<a href="/insight/">인사이트</a>
```

---

## 운영 워크플로우

```
[1] Claude Code + GUIDE_v3.md로 글 작성 (5단계)
    ↓
[2] .md 파일 → admin/insight.html에서 업로드 & 발행
    ↓
[3] aimcontents.com/insight/ 에 게시됨
    ↓
[4] 2~3일 후 blog.naver.com/ai_m_contents 에 같은 글 발행
    글 하단에: "👉 원문: https://aimcontents.com/insight/post.html?slug=xxx"
```

### 네이버 블로그 하단 템플릿

```
━━━━━━━━━━━━━━━━━━━
📊 K-POP 데이터와 인사이트를 한곳에서!
👉 원문 보기: https://aimcontents.com/insight/post.html?slug={슬러그}
👉 전체 인사이트: https://aimcontents.com/insight/
━━━━━━━━━━━━━━━━━━━
```

---

## 관리자 페이지

**접속**: `https://aimcontents.com/admin/insight.html`

- **Markdown 불러오기**: Claude Code에서 작성한 .md 파일을 직접 업로드
- **리치 에디터**: H2, H3, 굵게, 인용, 링크, 이미지 등 서식
- **글자수 카운트**: GUIDE_v3.md의 3,300자 기준 확인 가능
- **글 관리**: 수정/삭제/발행 상태 변경, 고유 URL 복사

---

## 구글 시트 컬럼

| 컬럼 | 필드 | 설명 |
|------|------|------|
| A | id | 타임스탬프 자동생성 |
| B | title | 제목 |
| C | slug | URL 슬러그 |
| D | category | K-POP분석/중국시장/산업트렌드/재무분석/칼럼 |
| E | summary | 요약 |
| F | content | 본문 HTML |
| G | tags | 태그 |
| H | author | 작성자 |
| I | created_at | 작성일 |
| J | updated_at | 수정일 |
| K | status | draft/published |
| L | thumbnail | 썸네일 URL |
| M | seo_keywords | SEO 키워드 |
| N | view_count | 조회수 |
