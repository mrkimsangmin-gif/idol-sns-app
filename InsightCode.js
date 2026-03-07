// ============================================================
// 📌 인사이트(Insight) CMS API - 메인 프로젝트 통합 버전
// ============================================================
// doGet/doPost는 Code.js에서 라우팅하므로 여기에는 없음
// 시트: "인사이트" (idol_sns_master_database 스프레드시트 내)
// ============================================================

const INSIGHT_SHEET_NAME = '인사이트'; // 시트명
const INSIGHT_ADMIN_PASSWORD = 'aim2026!'; // 관리자 비밀번호

/**
 * 인사이트 시트 가져오기 (없으면 자동 생성)
 */
function getInsightSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(INSIGHT_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(INSIGHT_SHEET_NAME);
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

/**
 * 행 데이터를 게시글 객체로 변환
 */
function insightRowToPost(row, includeContent) {
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

// ============================================================
// GET 요청 핸들러
// ============================================================

/**
 * 인사이트 GET 요청 라우팅 (Code.js doGet에서 호출)
 */
function handleInsightGet(params) {
  const action = params.action || 'list';

  switch (action) {
    case 'insightList':
      return getInsightPublishedPosts(params);
    case 'insightGet':
      return getInsightPost(params);
    case 'insightView':
      return viewInsightPost(params);
    case 'insightListAll':
      // 관리자 인증
      if (params.pw !== INSIGHT_ADMIN_PASSWORD) {
        return { error: '인증 실패' };
      }
      return getAllInsightPosts();
    case 'insightCategories':
      return getInsightCategories();
    // 기존 admin 페이지 호환용 (action=listAll 등)
    case 'list':
      return getInsightPublishedPosts(params);
    case 'get':
      return getInsightPost(params);
    case 'view':
      return viewInsightPost(params);
    case 'listAll':
      if (params.pw !== INSIGHT_ADMIN_PASSWORD) {
        return { error: '인증 실패' };
      }
      return getAllInsightPosts();
    case 'categories':
      return getInsightCategories();
    default:
      return { error: '알 수 없는 insight action' };
  }
}

/**
 * 공개된 글 목록 (본문 제외, 최신순)
 */
function getInsightPublishedPosts(params) {
  const sheet = getInsightSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { posts: [], total: 0 };

  const data = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
  let posts = data
    .filter(row => row[10] === 'published')
    .map(row => insightRowToPost(row, false))
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
function getInsightPost(params) {
  const sheet = getInsightSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { error: '글을 찾을 수 없습니다' };

  const data = sheet.getRange(2, 1, lastRow - 1, 14).getValues();

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if ((params.id && row[0] == params.id) || (params.slug && row[2] === params.slug)) {
      return { post: insightRowToPost(row, true) };
    }
  }
  return { error: '글을 찾을 수 없습니다' };
}

/**
 * 조회수 +1 후 글 반환
 */
function viewInsightPost(params) {
  const sheet = getInsightSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { error: '글을 찾을 수 없습니다' };

  const data = sheet.getRange(2, 1, lastRow - 1, 14).getValues();

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if ((params.id && row[0] == params.id) || (params.slug && row[2] === params.slug)) {
      // 조회수 업데이트
      const currentCount = parseInt(row[13]) || 0;
      sheet.getRange(i + 2, 14).setValue(currentCount + 1);
      row[13] = currentCount + 1;
      return { post: insightRowToPost(row, true) };
    }
  }
  return { error: '글을 찾을 수 없습니다' };
}

/**
 * 관리자용 전체 목록
 */
function getAllInsightPosts() {
  const sheet = getInsightSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { posts: [], total: 0 };

  const data = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
  const posts = data
    .filter(row => row[0]) // 빈 행 제외
    .map(row => insightRowToPost(row, false))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return { posts, total: posts.length };
}

/**
 * 카테고리 목록 + 글 수
 */
function getInsightCategories() {
  const sheet = getInsightSheet();
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
// POST 요청 핸들러
// ============================================================

/**
 * 인사이트 POST 요청 라우팅 (Code.js doPost에서 호출)
 */
function handleInsightPost(data) {
  // 관리자 인증
  if (data.pw !== INSIGHT_ADMIN_PASSWORD) {
    return { error: '인증 실패' };
  }

  switch (data.action) {
    case 'create':
      return createInsightPost(data);
    case 'update':
      return updateInsightPost(data);
    case 'delete':
      return deleteInsightPost(data);
    case 'publish':
      return publishInsightPost(data);
    default:
      return { error: '알 수 없는 action' };
  }
}

/**
 * 새 글 작성
 */
function createInsightPost(data) {
  const sheet = getInsightSheet();
  const id = new Date().getTime().toString();
  const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const slug = data.slug || generateInsightSlug(data.title);

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
    0
  ];

  sheet.appendRow(newRow);
  return { success: true, id: id, slug: slug, message: '글이 저장되었습니다' };
}

/**
 * 글 수정
 */
function updateInsightPost(data) {
  const sheet = getInsightSheet();
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
      sheet.getRange(rowNum, 10).setValue(now);
      return { success: true, message: '글이 수정되었습니다' };
    }
  }
  return { error: '글을 찾을 수 없습니다' };
}

/**
 * 글 삭제
 */
function deleteInsightPost(data) {
  const sheet = getInsightSheet();
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
function publishInsightPost(data) {
  return updateInsightPost({ ...data, status: 'published' });
}

// ============================================================
// 정적 JSON 내보내기 (하이브리드 로딩용)
// ============================================================

/**
 * 인사이트 published 글 전체를 JSON 객체로 생성 (본문 포함)
 * 프론트엔드에서 정적 파일로 즉시 로딩하기 위한 데이터
 */
function generateInsightJSON() {
  const sheet = getInsightSheet(); // 인사이트 시트 가져오기
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { generated_at: '', total: 0, posts: [] }; // 데이터 없으면 빈 배열

  const data = sheet.getRange(2, 1, lastRow - 1, 14).getValues(); // 헤더 제외 전체 데이터
  const posts = data
    .filter(row => row[10] === 'published' && row[0]) // published 상태 + 빈 행 제외
    .map(row => insightRowToPost(row, true)) // 본문(content) 포함
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); // 최신순 정렬

  return {
    generated_at: Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'), // 생성 시각
    total: posts.length, // 총 글 수
    posts: posts // 글 배열
  };
}

/**
 * 인사이트 JSON을 이메일 첨부 발송
 * 실행: Apps Script 에디터에서 emailInsightJSON 선택 후 실행
 *       또는 스프레드시트 메뉴 > 📊 데이터 관리 > 📧 인사이트 JSON 이메일 발송
 */
function emailInsightJSON() {
  Logger.log('📧 인사이트 JSON 생성 시작...');

  const insightData = generateInsightJSON(); // JSON 객체 생성
  const insightJson = JSON.stringify(insightData, null, 2); // 보기 좋게 포맷팅

  // 이메일 발송 (기존 emailAllStaticFiles 패턴 동일)
  MailApp.sendEmail({
    to: 'mr.kimsangmin@gmail.com',
    subject: '[AIMCONTENTS] 인사이트 JSON 업데이트',
    body: `인사이트 정적 JSON 파일이 생성되었습니다.\n\n` +
      `📁 첨부 파일:\n` +
      `  insight-posts.json: ${insightJson.length.toLocaleString()} bytes (${insightData.total}개 글)\n\n` +
      `📋 업로드 절차:\n` +
      `  1. 첨부된 insight-posts.json 다운로드\n` +
      `  2. GitHub 저장소의 data/ 폴더에 업로드 (기존 파일 덮어쓰기)\n` +
      `  3. 사이트에서 인사이트 글 목록/상세 로딩 확인\n\n` +
      `생성 시간: ${insightData.generated_at}\n\n` +
      `GitHub: https://github.com/mrkimsangmin-gif/idol-sns-app/`,
    attachments: [
      Utilities.newBlob(insightJson, 'application/json', 'insight-posts.json') // JSON 파일 첨부
    ]
  });

  Logger.log(`✅ 인사이트 JSON 이메일 발송 완료 (${insightData.total}개 글, ${insightJson.length.toLocaleString()} bytes)`);
}

// ============================================================
// 유틸리티
// ============================================================

/**
 * 한글 제목 → 영문 슬러그 생성
 */
function generateInsightSlug(title) {
  let slug = title
    .toLowerCase()
    .replace(/[가-힣]+/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (slug.length < 3) {
    slug = 'insight-' + Date.now();
  } else {
    slug = slug + '-' + Date.now().toString().slice(-6);
  }

  return slug;
}
