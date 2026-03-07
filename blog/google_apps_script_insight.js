// ============================================================
// 📌 Google Apps Script - 인사이트(Insight) CMS API
// ============================================================
// 
// [설치 방법]
// 1. Google Sheets 새로 만들기 (또는 기존 시트에 "인사이트" 시트 추가)
// 2. 확장 프로그램 → Apps Script
// 3. 이 코드를 붙여넣기
// 4. 배포 → 새 배포 → 웹 앱 → "모든 사용자(익명 포함)" 설정
// 5. 배포 URL 복사 → insight/index.html과 admin/insight.html에 입력
//
// [시트 구조 - "인사이트" 시트]
// A: id (자동생성 타임스탬프)
// B: title (제목)
// C: slug (URL용 영문 슬러그)
// D: category (카테고리: K-POP분석, 중국시장, 산업트렌드, 재무분석, 칼럼)
// E: summary (요약 2~3줄)
// F: content (본문 HTML)
// G: tags (태그, 콤마 구분)
// H: author (작성자)
// I: created_at (작성일 YYYY-MM-DD)
// J: updated_at (수정일)
// K: status (draft/published)
// L: thumbnail (썸네일 URL, 선택)
// M: seo_keywords (SEO 키워드, 콤마 구분)
// N: view_count (조회수)
// ============================================================

const SHEET_NAME = '인사이트';
const ADMIN_PASSWORD = 'aim2026!'; // 관리자 비밀번호 (변경 필수!)

/**
 * GET 요청 처리
 * ?action=list          → 글 목록 (published만)
 * ?action=get&id=xxx    → 글 상세
 * ?action=get&slug=xxx  → 슬러그로 글 조회
 * ?action=listAll&pw=xx → 관리자용 전체 목록 (draft 포함)
 * ?action=categories    → 카테고리 목록
 * ?action=view&id=xxx   → 조회수 +1 후 글 반환
 */
function doGet(e) {
  const action = e.parameter.action || 'list';
  let result;

  try {
    switch (action) {
      case 'list':
        result = getPublishedPosts(e.parameter);
        break;
      case 'get':
        result = getPost(e.parameter);
        break;
      case 'view':
        result = viewPost(e.parameter);
        break;
      case 'listAll':
        if (e.parameter.pw !== ADMIN_PASSWORD) {
          result = { error: '인증 실패' };
        } else {
          result = getAllPosts();
        }
        break;
      case 'categories':
        result = getCategories();
        break;
      default:
        result = { error: '알 수 없는 action' };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * POST 요청 처리 (글 작성/수정/삭제)
 */
function doPost(e) {
  let result;

  try {
    const data = JSON.parse(e.postData.contents);

    // 관리자 인증
    if (data.pw !== ADMIN_PASSWORD) {
      result = { error: '인증 실패' };
      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    switch (data.action) {
      case 'create':
        result = createPost(data);
        break;
      case 'update':
        result = updatePost(data);
        break;
      case 'delete':
        result = deletePost(data);
        break;
      case 'publish':
        result = publishPost(data);
        break;
      default:
        result = { error: '알 수 없는 action' };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// 데이터 읽기 함수
// ============================================================

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    // 헤더 설정
    sheet.getRange(1, 1, 1, 14).setValues([[
      'id', 'title', 'slug', 'category', 'summary', 'content',
      'tags', 'author', 'created_at', 'updated_at', 'status',
      'thumbnail', 'seo_keywords', 'view_count'
    ]]);
    sheet.getRange(1, 1, 1, 14).setFontWeight('bold');
  }
  return sheet;
}

function rowToPost(row, includeContent) {
  const post = {
    id: row[0],
    title: row[1],
    slug: row[2],
    category: row[3],
    summary: row[4],
    tags: row[6] ? row[6].split(',').map(t => t.trim()) : [],
    author: row[7],
    created_at: row[8],
    updated_at: row[9],
    status: row[10],
    thumbnail: row[11],
    seo_keywords: row[12] ? row[12].split(',').map(k => k.trim()) : [],
    view_count: parseInt(row[13]) || 0
  };
  if (includeContent !== false) {
    post.content = row[5];
  }
  return post;
}

/**
 * 공개된 글 목록 (본문 제외, 최신순)
 */
function getPublishedPosts(params) {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { posts: [], total: 0 };

  const data = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
  let posts = data
    .filter(row => row[10] === 'published')
    .map(row => rowToPost(row, false))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // 카테고리 필터
  if (params && params.category) {
    posts = posts.filter(p => p.category === params.category);
  }

  // 태그 필터
  if (params && params.tag) {
    posts = posts.filter(p => p.tags.includes(params.tag));
  }

  // 페이지네이션
  const page = parseInt(params?.page) || 1;
  const limit = parseInt(params?.limit) || 10;
  const start = (page - 1) * limit;
  const paged = posts.slice(start, start + limit);

  return {
    posts: paged,
    total: posts.length,
    page: page,
    totalPages: Math.ceil(posts.length / limit)
  };
}

/**
 * 글 상세 (id 또는 slug로 조회)
 */
function getPost(params) {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { error: '글을 찾을 수 없습니다' };

  const data = sheet.getRange(2, 1, lastRow - 1, 14).getValues();

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if ((params.id && row[0] == params.id) || (params.slug && row[2] === params.slug)) {
      return { post: rowToPost(row, true) };
    }
  }
  return { error: '글을 찾을 수 없습니다' };
}

/**
 * 조회수 +1 후 글 반환
 */
function viewPost(params) {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { error: '글을 찾을 수 없습니다' };

  const data = sheet.getRange(2, 1, lastRow - 1, 14).getValues();

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if ((params.id && row[0] == params.id) || (params.slug && row[2] === params.slug)) {
      // 조회수 업데이트 (N열 = 14번째)
      const currentCount = parseInt(row[13]) || 0;
      sheet.getRange(i + 2, 14).setValue(currentCount + 1);
      row[13] = currentCount + 1;
      return { post: rowToPost(row, true) };
    }
  }
  return { error: '글을 찾을 수 없습니다' };
}

/**
 * 관리자용 전체 목록
 */
function getAllPosts() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { posts: [], total: 0 };

  const data = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
  const posts = data
    .filter(row => row[0]) // 빈 행 제외
    .map(row => rowToPost(row, false))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return { posts, total: posts.length };
}

/**
 * 카테고리 목록 + 글 수
 */
function getCategories() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { categories: [] };

  const data = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
  const counts = {};
  data.filter(r => r[10] === 'published').forEach(row => {
    const cat = row[3];
    if (cat) counts[cat] = (counts[cat] || 0) + 1;
  });

  return {
    categories: Object.entries(counts).map(([name, count]) => ({ name, count }))
  };
}

// ============================================================
// 데이터 쓰기 함수
// ============================================================

/**
 * 새 글 작성
 */
function createPost(data) {
  const sheet = getSheet();
  const id = new Date().getTime().toString();
  const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const slug = data.slug || generateSlug(data.title);

  const newRow = [
    id,
    data.title,
    slug,
    data.category || '',
    data.summary || '',
    data.content || '',
    Array.isArray(data.tags) ? data.tags.join(', ') : (data.tags || ''),
    data.author || '아이엠콘텐츠',
    data.created_at || now,
    now,
    data.status || 'draft',
    data.thumbnail || '',
    Array.isArray(data.seo_keywords) ? data.seo_keywords.join(', ') : (data.seo_keywords || ''),
    0 // view_count
  ];

  sheet.appendRow(newRow);
  return { success: true, id: id, slug: slug, message: '글이 저장되었습니다' };
}

/**
 * 글 수정
 */
function updatePost(data) {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  const allData = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
  const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');

  for (let i = 0; i < allData.length; i++) {
    if (allData[i][0] == data.id) {
      const rowNum = i + 2;
      if (data.title !== undefined) sheet.getRange(rowNum, 2).setValue(data.title);
      if (data.slug !== undefined) sheet.getRange(rowNum, 3).setValue(data.slug);
      if (data.category !== undefined) sheet.getRange(rowNum, 4).setValue(data.category);
      if (data.summary !== undefined) sheet.getRange(rowNum, 5).setValue(data.summary);
      if (data.content !== undefined) sheet.getRange(rowNum, 6).setValue(data.content);
      if (data.tags !== undefined) {
        const tags = Array.isArray(data.tags) ? data.tags.join(', ') : data.tags;
        sheet.getRange(rowNum, 7).setValue(tags);
      }
      if (data.status !== undefined) sheet.getRange(rowNum, 11).setValue(data.status);
      if (data.thumbnail !== undefined) sheet.getRange(rowNum, 12).setValue(data.thumbnail);
      if (data.seo_keywords !== undefined) {
        const kw = Array.isArray(data.seo_keywords) ? data.seo_keywords.join(', ') : data.seo_keywords;
        sheet.getRange(rowNum, 13).setValue(kw);
      }
      sheet.getRange(rowNum, 10).setValue(now); // updated_at
      return { success: true, message: '글이 수정되었습니다' };
    }
  }
  return { error: '글을 찾을 수 없습니다' };
}

/**
 * 글 삭제
 */
function deletePost(data) {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  const allData = sheet.getRange(2, 1, lastRow - 1, 14).getValues();

  for (let i = 0; i < allData.length; i++) {
    if (allData[i][0] == data.id) {
      sheet.deleteRow(i + 2);
      return { success: true, message: '글이 삭제되었습니다' };
    }
  }
  return { error: '글을 찾을 수 없습니다' };
}

/**
 * 글 발행 (draft → published)
 */
function publishPost(data) {
  return updatePost({ ...data, status: 'published' });
}

// ============================================================
// 유틸리티
// ============================================================

/**
 * 한글 제목 → 영문 슬러그 생성
 * 예: "K-POP 아이돌의 중국 진출" → "kpop-idol-china-expansion-1707900000"
 */
function generateSlug(title) {
  // 영문/숫자만 남기고 나머지는 하이픈으로
  let slug = title
    .toLowerCase()
    .replace(/[가-힣]+/g, '') // 한글 제거
    .replace(/[^a-z0-9\s-]/g, '') // 특수문자 제거
    .replace(/\s+/g, '-') // 공백 → 하이픈
    .replace(/-+/g, '-') // 중복 하이픈 제거
    .replace(/^-|-$/g, ''); // 앞뒤 하이픈 제거

  // 슬러그가 너무 짧으면 타임스탬프 추가
  if (slug.length < 3) {
    slug = 'insight-' + Date.now();
  } else {
    slug = slug + '-' + Date.now().toString().slice(-6);
  }

  return slug;
}
