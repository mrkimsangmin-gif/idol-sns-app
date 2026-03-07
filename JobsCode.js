// ========================================
// 💼 채용정보 API (Jobs) - Gemini AI 버전
// ========================================
// 
// 개선사항:
// - Gemini API를 통한 정확한 메타데이터 추출
// - 근무지, 마감일, 경력 정보 완벽 추출
// - HTML 구조 변경에도 안정적으로 동작
//
// 설정 방법:
// 1. Google AI Studio에서 API 키 발급: https://aistudio.google.com/apikey
// 2. 아래 GEMINI_API_KEY에 키 입력
// ========================================

const JOBS_SHEET_NAME = 'jobs';
const JOBS_CACHE_KEY = 'ENTER_JOBS_CACHE';
const JOBS_CACHE_DURATION = 6 * 60 * 60; // 6시간

// ⚠️ API 키 설정 (필수)
const GEMINI_API_KEY = 'AIzaSyB-9UFiTIO-bER3W4UFH6VNac8jWFfHS7I';

// 직무 카테고리 정의
const JOB_CATEGORIES = ['마케팅', '영상', '신인개발', '매니지먼트', '프로듀싱', '디자인', 'IT', '영업', '해외사업', '기타'];

/**
 * ========================================
 * 🤖 Gemini API를 통한 채용정보 추출
 * ========================================
 */

/**
 * Gemini API 호출
 */
function callGeminiAPI(prompt, maxTokens = 1024) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
        throw new Error('Gemini API 키가 설정되지 않았습니다. GEMINI_API_KEY를 설정하세요.');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_API_KEY}`;

    const payload = {
        contents: [{
            parts: [{ text: prompt }]
        }],
        generationConfig: {
            temperature: 0.1,
            maxOutputTokens: maxTokens,
            responseMimeType: "application/json"
        }
    };

    const options = {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();

    if (responseCode !== 200) {
        const errorText = response.getContentText();
        console.error('Gemini API 오류:', errorText);
        throw new Error(`Gemini API 오류: HTTP ${responseCode}`);
    }

    const result = JSON.parse(response.getContentText());

    if (result.candidates && result.candidates[0] && result.candidates[0].content) {
        const text = result.candidates[0].content.parts[0].text;
        try {
            return JSON.parse(text);
        } catch (e) {
            // JSON 파싱 실패 시 텍스트 그대로 반환
            return { raw: text };
        }
    }

    throw new Error('Gemini API 응답 형식 오류');
}

/**
 * HTML에서 채용정보 추출 (Gemini 사용)
 */
function extractJobInfoWithGemini(html, url) {
    // HTML이 너무 길면 필요한 부분만 추출
    const relevantHtml = extractRelevantHtml(html);

    // HTML 길이 검증
    if (!relevantHtml || relevantHtml.length < 200) {
        console.error('❌ 추출된 HTML이 너무 짧음:', relevantHtml ? relevantHtml.length : 0, '자');
        return {
            company: '(HTML부족)',
            position: '(HTML부족)',
            category: '기타',
            career: '무관',
            location: '',
            deadline: '',
            url: url,
            source: getSourceFromUrl(url),
            success: false,
            error: 'HTML 내용이 부족합니다'
        };
    }

    console.log(`📝 Gemini에 전달할 HTML: ${relevantHtml.length}자`);

    const prompt = `다음은 채용공고 웹페이지의 HTML입니다. 아래 정보를 정확하게 추출해서 JSON으로 반환하세요.

추출 항목:
1. company: 회사명만 (예: "JYP엔터테인먼트", "SM엔터테인먼트", "스타쉽엔터테인먼트")
2. position: 채용 포지션/직무명만 (회사명은 제외! 예: "글로벌 마케팅 담당자", "아티스트 매니저", "A&R")
3. category: 직무 카테고리 - 다음 중 하나로 분류: A&R, 마케팅, 매니지먼트, 콘텐츠제작, 디자인, 신인개발, 경영지원, IT, 기타
4. career: 경력 요건 - "신입", "경력", "신입·경력", "무관" 중 하나
5. location: 근무지 (시/구까지만! 예: "서울 강남구", "서울 성동구", "인천 서구")
6. deadline: 마감일 - "상시채용"이면 "상시채용", 날짜가 있으면 YYYY-MM-DD 형식

주의사항:
- 정보가 없으면 빈 문자열 ""로 반환
- position에서 회사명(국문/영문)은 반드시 제거. 예: "SM Entertainment 국내 플랫폼 담당자" → "국내 플랫폼 담당자"
- position에서 "[경력직]", "[신입]", "[채용]" 등 접두어 제거
- career가 "신입·경력", "신입/경력", "신입ㆍ경력"이면 "신입·경력"으로 통일
- career가 "경력무관"이면 "무관"
- location은 상세주소 제외, 시/구까지만 (예: "서울 강동구", "서울 성동구")
- deadline이 "~2/8(일)", "~02/08", "~1/31(토) 채용시 마감" 형식이면 날짜만 추출하여 "2026-02-08"로 변환
- deadline이 "상시채용", "상시모집"이면 "상시채용"으로 반환

HTML:
${relevantHtml}

JSON 형식으로만 응답하세요:
{"company": "", "position": "", "category": "", "career": "", "location": "", "deadline": ""}`;

    try {
        let result = callGeminiAPI(prompt);

        // 디버깅: Gemini 응답 확인
        console.log('🤖 Gemini 응답:', JSON.stringify(result));

        // 응답 검증
        if (!result) {
            throw new Error('Gemini 응답이 없습니다');
        }

        // 배열로 응답한 경우 첫 번째 요소 추출
        if (Array.isArray(result)) {
            console.log('📋 배열 응답 감지, 첫 번째 요소 사용');
            result = result[0] || {};
        }

        if (typeof result !== 'object') {
            throw new Error('Gemini 응답이 유효하지 않습니다: ' + JSON.stringify(result));
        }

        // raw 필드가 있으면 JSON 파싱 재시도
        if (result.raw) {
            console.log('⚠️ raw 응답 감지, 재파싱 시도');
            const jsonMatch = result.raw.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    const parsed = JSON.parse(jsonMatch[0]);
                    result = parsed;
                } catch (e) {
                    console.log('재파싱 실패:', e.message);
                }
            }
        }


        const extracted = {
            company: cleanCompanyName(result.company || ''),
            position: cleanPositionName(result.position || ''),
            category: result.category || '기타',
            career: normalizeCareer(result.career || '무관'),
            location: result.location || '',
            deadline: normalizeDeadline(result.deadline || ''),
            url: url,
            source: getSourceFromUrl(url),
            success: true
        };

        // 핵심 필드가 비어있으면 실패로 처리
        if (!extracted.company || extracted.company === '' || extracted.company === '(추출실패)') {
            console.log('⚠️ 회사명 추출 실패, Gemini 응답이 불완전함');
            extracted.success = false;
            extracted.error = '회사명 추출 실패';
        }

        return extracted;
    } catch (error) {
        console.error('Gemini 추출 실패:', error);
        return {
            company: '(추출실패)',
            position: '(추출실패)',
            category: '기타',
            career: '무관',
            location: '',
            deadline: '',
            url: url,
            source: getSourceFromUrl(url),
            success: false,
            error: error.message
        };
    }
}

/**
 * HTML에서 채용 관련 부분만 추출 (구조 변경에 강하도록 개선)
 */
function extractRelevantHtml(html) {
    if (!html) return "";

    // 스크립트, 스타일, 헤더, 푸터, 네비게이션 제거 (본문만 유지)
    let cleaned = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ' ')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, '');

    // body 태그 내용만 추출 (가능한 경우)
    const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
        cleaned = bodyMatch[1];
    }

    // 잡코리아: 채용정보 본문 영역 추출 시도 (여러 패턴)
    const jobkoreaPatterns = [
        /<div[^>]*class="[^"]*tbCol[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi,
        /<article[^>]*class="[^"]*artRead[^"]*"[^>]*>[\s\S]*?<\/article>/gi,
        /<div[^>]*class="[^"]*recruit-info[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
        /<table[^>]*class="[^"]*tbType[^"]*"[^>]*>[\s\S]*?<\/table>/gi
    ];

    let extracted = '';
    for (const pattern of jobkoreaPatterns) {
        const matches = cleaned.match(pattern);
        if (matches && matches.length > 0) {
            extracted += matches.join(' ');
        }
    }

    // 사람인: 채용정보 본문 영역 추출
    const saraminPatterns = [
        /<div[^>]*class="[^"]*jv_cont[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
        /<div[^>]*class="[^"]*wrap_jv_cont[^"]*"[^>]*>[\s\S]*?<\/div>/gi
    ];

    for (const pattern of saraminPatterns) {
        const matches = cleaned.match(pattern);
        if (matches && matches.length > 0) {
            extracted += matches.join(' ');
        }
    }

    // 추출된 내용이 충분하지 않으면 전체 본문 사용
    if (extracted.length < 500) {
        console.log('⚠️ 특정 섹션 추출 실패, 전체 본문 사용');
        extracted = cleaned;
    }

    // HTML 태그 간소화 (텍스트 위주로)
    extracted = extracted
        .replace(/<img[^>]*>/gi, '')
        .replace(/<input[^>]*>/gi, '')
        .replace(/\s+style="[^"]*"/gi, '')
        .replace(/\s+onclick="[^"]*"/gi, '')
        .replace(/\s+onmouseover="[^"]*"/gi, '')
        .replace(/\s+data-[a-z-]+="[^"]*"/gi, '')
        .replace(/\s+class="[^"]*"/gi, ' ')
        .replace(/\s+id="[^"]*"/gi, '');

    // 연속 공백 제거
    extracted = extracted.replace(/\s+/g, ' ').trim();

    // 최대 길이 제한 (약 12000자)
    if (extracted.length > 12000) {
        extracted = extracted.substring(0, 12000);
    }

    console.log(`📄 HTML 추출 길이: ${extracted.length}자`);
    return extracted;
}

/**
 * 회사명 정리
 */
function cleanCompanyName(name) {
    if (!name) return '';
    return name
        .replace(/^\(주\)\s*/i, '')
        .replace(/^㈜\s*/i, '')
        .replace(/^주식회사\s*/i, '')
        .replace(/\s*\(주\)$/i, '')
        .replace(/\s*㈜$/i, '')
        .replace(/&amp;/g, '&')
        .trim();
}

/**
 * 포지션명 정리
 */
function cleanPositionName(name) {
    if (!name) return '';
    return name
        .replace(/^\[경력직\]\s*/i, '')
        .replace(/^\[신입\]\s*/i, '')
        .replace(/^\[신입\/경력\]\s*/i, '')
        .replace(/\s*\|\s*잡코리아.*$/i, '')
        .replace(/\s*\|\s*사람인.*$/i, '')
        .replace(/\s*-\s*잡코리아.*$/i, '')
        .replace(/\s*-\s*사람인.*$/i, '')
        .replace(/&amp;/g, '&')
        .trim();
}

/**
 * 경력 요건 정규화
 */
function normalizeCareer(career) {
    if (!career) return '무관';
    const c = career.toString();

    // '신입·경력' 패턴 우선 처리
    if (c.includes('신입') && c.includes('경력')) return '신입·경력';
    if (c.includes('신입·경력') || c.includes('신입/경력') || c.includes('신입·경력')) return '신입·경력';

    // '무관' 패턴
    if (c.includes('경력무관') || c.includes('무관')) return '무관';

    // 단독 패턴
    if (c.includes('신입')) return '신입';
    if (c.includes('경력')) return '경력';

    return '무관';
}

/**
 * 마감일 정규화
 */
function normalizeDeadline(deadline) {
    if (!deadline) return '';

    // '상시채용'인 경우 '상시채용' 반환
    if (deadline.includes('상시') || (deadline.includes('채용시') && !deadline.match(/\d/))) {
        return '상시채용';
    }

    // YYYY-MM-DD 형식 확인
    if (/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
        return deadline;
    }

    // ~M/D(요일) 채용시 마감 형식 (예: ~1/31(토) 채용시 마감)
    const dateWithClose = deadline.match(/~?(\d{1,2})\/(\d{1,2})(?:\([^\)]*\))?.*채용시/);
    if (dateWithClose) {
        const month = dateWithClose[1].padStart(2, '0');
        const day = dateWithClose[2].padStart(2, '0');
        const year = new Date().getFullYear();
        return `${year}-${month}-${day}`;
    }

    // ~M/D(요일) 또는 ~MM/DD 형식 (예: ~2/8(일), ~02/08)
    const shortMatch = deadline.match(/~?(\d{1,2})\/(\d{1,2})(?:\([^\)]*\))?/);
    if (shortMatch) {
        const month = shortMatch[1].padStart(2, '0');
        const day = shortMatch[2].padStart(2, '0');
        const year = new Date().getFullYear();
        return `${year}-${month}-${day}`;
    }

    // YYYY.MM.DD 형식
    const dotMatch = deadline.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
    if (dotMatch) {
        return `${dotMatch[1]}-${dotMatch[2].padStart(2, '0')}-${dotMatch[3].padStart(2, '0')}`;
    }

    return '';
}

/**
 * URL에서 출처 판별
 */
function getSourceFromUrl(url) {
    if (!url) return '기타';
    const urlStr = url.toString();
    if (urlStr.includes('jobkorea.co.kr')) return '잡코리아';
    if (urlStr.includes('saramin.co.kr')) return '사람인';
    if (urlStr.includes('work.go.kr')) return '워크넷';
    return '기타';
}

/**
 * ========================================
 * 📋 메인 함수: URL에서 채용정보 추출 및 저장
 * ========================================
 */

/**
 * URL에서 채용정보 추출 (Gemini 사용)
 */
function extractJobMetadataWithAI(jobUrl) {
    // URL 유효성 체크
    if (!jobUrl || typeof jobUrl !== 'string' || !jobUrl.startsWith('http')) {
        console.error('유효하지 않은 URL:', jobUrl);
        return {
            company: '(URL오류)',
            position: '(URL오류)',
            category: '기타',
            career: '무관',
            location: '',
            deadline: '',
            url: jobUrl || '',
            source: '기타',
            success: false,
            error: '유효하지 않은 URL'
        };
    }

    try {
        const response = UrlFetchApp.fetch(jobUrl, {
            muteHttpExceptions: true,
            followRedirects: true,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
            }
        });

        if (response.getResponseCode() !== 200) {
            throw new Error(`HTTP ${response.getResponseCode()}`);
        }

        const html = response.getContentText();

        // 기본 메타 정보 먼저 추출 (fallback용)
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const ogTitleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i) ||
            html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:title"/i);
        const ogDescMatch = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i) ||
            html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:description"/i);

        const fallbackTitle = ogTitleMatch ? ogTitleMatch[1] : (titleMatch ? titleMatch[1] : '');
        const fallbackDesc = ogDescMatch ? ogDescMatch[1] : '';

        console.log(`📌 OG Title: ${fallbackTitle}`);
        console.log(`📌 OG Desc: ${fallbackDesc.substring(0, 100)}...`);

        // Gemini로 추출 시도
        let result = extractJobInfoWithGemini(html, jobUrl);

        // Gemini 실패 시 메타 태그 정보 활용
        if (!result.success || !result.company || result.company.includes('실패') || result.company.includes('부족')) {
            console.log('⚠️ Gemini 추출 실패, 메타 태그 fallback 사용');

            // 잡코리아 타이틀에서 회사명/포지션 추출: "포지션명 | 회사명 | 잡코리아"
            if (fallbackTitle && jobUrl.includes('jobkorea')) {
                const parts = fallbackTitle.split('|').map(p => p.trim());
                if (parts.length >= 2) {
                    result.position = cleanPositionName(parts[0]);
                    result.company = cleanCompanyName(parts[1].replace('잡코리아', '').trim());
                    if (result.company && result.position) {
                        result.success = true;
                    }
                }
            }

            // 사람인 타이틀에서 추출: "[회사명] 포지션명 - 사람인"
            if (fallbackTitle && jobUrl.includes('saramin')) {
                const bracketMatch = fallbackTitle.match(/\[([^\]]+)\]\s*(.+)/);
                if (bracketMatch) {
                    result.company = cleanCompanyName(bracketMatch[1]);
                    result.position = cleanPositionName(bracketMatch[2].replace(/\s*[-|].*사람인.*$/i, ''));
                    if (result.company && result.position) {
                        result.success = true;
                    }
                }
            }

            // description에서 추가 정보 추출 시도
            if (fallbackDesc) {
                const locMatch = fallbackDesc.match(/서울[^\s,]*/);
                if (locMatch && !result.location) result.location = locMatch[0];

                const deadlineMatch = fallbackDesc.match(/~\s*(\d{1,2}\/\d{1,2})/);
                if (deadlineMatch && !result.deadline) {
                    result.deadline = normalizeDeadline(deadlineMatch[1]);
                }
            }
        }

        return result;

    } catch (error) {
        console.error('페이지 로드 실패:', jobUrl, error);
        return {
            company: '(로드실패)',
            position: '(로드실패)',
            category: '기타',
            career: '무관',
            location: '',
            deadline: '',
            url: jobUrl,
            source: getSourceFromUrl(jobUrl),
            success: false,
            error: error.message
        };
    }
}

/**
 * URL만 입력된 행의 메타데이터 자동 채우기 (Gemini 버전)
 * 
 * 사용법:
 * 1. jobs 시트의 H열(url)에 채용공고 URL 입력
 * 2. 이 함수 실행
 */
function fillJobDataFromUrls() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(JOBS_SHEET_NAME);

    if (!sheet) {
        console.log('❌ jobs 시트가 없습니다.');
        return { status: 'error', message: 'jobs 시트가 없습니다.' };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
        console.log('ℹ️ 처리할 데이터가 없습니다.');
        return { status: 'info', message: '데이터가 없습니다.' };
    }

    const data = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
    let updatedCount = 0;
    let errorCount = 0;

    // 현재 최대 ID 찾기
    let maxId = 0;
    for (const row of data) {
        if (typeof row[0] === 'number' && row[0] > maxId) {
            maxId = row[0];
        }
    }

    console.log('🤖 Gemini AI로 채용정보 추출 시작...');

    // 이미 처리된 URL 추적 (중복 방지)
    const processedUrls = new Set();
    for (const row of data) {
        const url = row[7];
        const company = row[1];
        // 이미 회사명이 있는 URL은 처리된 것으로 간주
        if (url && company && company !== '' && company !== '(확인필요)' && company !== '(추출실패)') {
            processedUrls.add(url.toString().trim());
        }
    }

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const rowId = row[0];          // A열: id
        const url = row[7];            // H열: url
        const company = row[1];        // B열: company

        // URL은 있지만 회사명이 비어있는 행만 처리 (조건 단순화)
        const needsUpdate = url && url.toString().startsWith('http') &&
            (!company || company === '' || company === '(확인필요)' || company === '(추출실패)');

        if (needsUpdate) {
            // 이미 처리된 URL이면 건너뛰기
            const urlStr = url.toString().trim();
            if (processedUrls.has(urlStr)) {
                console.log(`⏭️ 중복 URL 건너뛰기 [${i + 2}]: ${urlStr.substring(0, 60)}...`);
                continue;
            }
            processedUrls.add(urlStr);

            console.log(`🔍 처리 중 [${i + 2}]: ${urlStr.substring(0, 60)}...`);

            const metadata = extractJobMetadataWithAI(url.toString());
            const rowNum = i + 2;

            if (metadata.success && metadata.company) {
                // ID가 없으면 생성
                if (!rowId) {
                    maxId++;
                    sheet.getRange(rowNum, 1).setValue(maxId);
                }

                // 모든 필드 업데이트 (Gemini 결과로 덮어쓰기)
                sheet.getRange(rowNum, 2).setValue(metadata.company);
                sheet.getRange(rowNum, 3).setValue(metadata.position);
                sheet.getRange(rowNum, 4).setValue(metadata.category);
                sheet.getRange(rowNum, 5).setValue(metadata.career);
                sheet.getRange(rowNum, 6).setValue(metadata.location);
                sheet.getRange(rowNum, 7).setValue(metadata.deadline);
                sheet.getRange(rowNum, 9).setValue(metadata.source);
                sheet.getRange(rowNum, 10).setValue('승인');
                sheet.getRange(rowNum, 11).setValue(new Date());

                console.log(`✅ ${metadata.company} | ${metadata.position} | ${metadata.location} | ${metadata.deadline}`);
                updatedCount++;
            } else {
                console.log(`❌ 실패: ${metadata.error || '데이터 추출 불가'}`);
                errorCount++;
            }


            // Rate limiting (Gemini API 제한 고려)
            Utilities.sleep(2000);
        }
    }

    if (updatedCount > 0) clearJobsCache();
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅ 완료: ${updatedCount}개 성공, ${errorCount}개 실패`);

    return { status: 'success', updated: updatedCount, errors: errorCount };
}

/**
 * 새 URL 추가 (Gemini 버전)
 */
function addJobFromUrl(jobUrl) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(JOBS_SHEET_NAME);

    if (!sheet) return { status: 'error', message: 'jobs 시트가 없습니다.' };

    const existingUrls = getExistingJobUrls(sheet);
    if (existingUrls.has(jobUrl)) {
        return { status: 'info', message: '이미 등록된 URL입니다.' };
    }

    console.log('🤖 Gemini AI로 채용정보 추출 중...');
    const metadata = extractJobMetadataWithAI(jobUrl);

    if (!metadata.success) {
        return { status: 'error', message: `추출 실패: ${metadata.error}` };
    }

    const lastRow = sheet.getLastRow();
    const lastId = lastRow > 1 ? sheet.getRange(lastRow, 1).getValue() : 0;

    const newRow = [
        lastId + 1,
        metadata.company,
        metadata.position,
        metadata.category,
        metadata.career,
        metadata.location,
        metadata.deadline,
        jobUrl,
        metadata.source,
        '승인',
        new Date(),
        ''
    ];

    sheet.appendRow(newRow);
    clearJobsCache();

    console.log(`✅ 추가됨: ${metadata.company} | ${metadata.position} | ${metadata.location} | ${metadata.deadline}`);
    return { status: 'success', data: metadata };
}

/**
 * 여러 URL 일괄 추가
 */
function addMultipleJobsFromUrls(urlArray) {
    const results = {
        success: 0,
        duplicate: 0,
        failed: 0,
        details: []
    };

    for (const url of urlArray) {
        const trimmedUrl = url.trim();
        if (!trimmedUrl || !trimmedUrl.startsWith('http')) continue;

        const result = addJobFromUrl(trimmedUrl);
        results.details.push({ url: trimmedUrl, result: result });

        if (result.status === 'success') results.success++;
        else if (result.status === 'info') results.duplicate++;
        else results.failed++;

        Utilities.sleep(2000);
    }

    console.log(`\n📊 일괄 추가 결과: 성공 ${results.success}, 중복 ${results.duplicate}, 실패 ${results.failed}`);
    return results;
}

/**
 * ========================================
 * 📊 데이터 조회 함수
 * ========================================
 */

/**
 * 승인된 채용공고 데이터 가져오기 (캐시 적용)
 */
function getJobsData() {
    const cache = CacheService.getScriptCache();
    const cached = cache.get(JOBS_CACHE_KEY);

    if (cached) {
        console.log('✅ 채용 캐시 히트');
        return JSON.parse(cached);
    }

    console.log('📡 채용 데이터 시트에서 로드');

    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheet = ss.getSheetByName(JOBS_SHEET_NAME);

        if (!sheet) {
            return { status: 'error', message: 'jobs 시트를 찾을 수 없습니다.' };
        }

        const lastRow = sheet.getLastRow();
        if (lastRow < 2) {
            return {
                status: 'success',
                data: [],
                categories: JOB_CATEGORIES,
                updatedAt: new Date().toISOString()
            };
        }

        const data = sheet.getRange(1, 1, lastRow, 12).getValues();
        const headers = data[0];

        const jobs = [];
        const now = new Date();
        const seenUrls = new Set(); // URL 중복 제거용

        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (!row[0] || !row[1] || !row[2]) continue;

            // URL 중복 제거 (같은 URL이면 첫 번째만 사용)
            const url = row[7];
            if (url && seenUrls.has(url.toString().trim())) {
                continue;
            }
            if (url) seenUrls.add(url.toString().trim());

            const item = {};
            headers.forEach((header, index) => {
                item[header] = row[index];
            });

            if (item.status !== '승인') continue;

            if (item.deadline) {
                const deadline = new Date(item.deadline);
                if (deadline < now) continue;

                const diffTime = deadline - now;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                item.dday = diffDays;
            }

            jobs.push(item);
        }

        // 마감일 기준 오름차순 정렬 (마감일이 가까운 것이 먼저, 상시채용은 맨 뒤)
        jobs.sort((a, b) => {
            // order 필드가 둘 다 있으면 order 우선
            if (a.order && b.order) return a.order - b.order;

            // 상시채용 여부 확인
            const aIsAlways = !a.deadline || a.deadline === '상시채용';
            const bIsAlways = !b.deadline || b.deadline === '상시채용';

            // 둘 다 상시채용이면 순서 유지
            if (aIsAlways && bIsAlways) return 0;
            // 상시채용은 뒤로
            if (aIsAlways) return 1;
            if (bIsAlways) return -1;

            // 둘 다 마감일이 있으면 오름차순 정렬 (가까운 마감일 먼저)
            return new Date(a.deadline) - new Date(b.deadline);
        });

        const result = {
            status: 'success',
            data: jobs,
            categories: JOB_CATEGORIES,
            updatedAt: new Date().toISOString()
        };

        cache.put(JOBS_CACHE_KEY, JSON.stringify(result), JOBS_CACHE_DURATION);

        return result;

    } catch (error) {
        console.error('채용 데이터 로드 오류:', error);
        return { status: 'error', message: error.toString() };
    }
}

/**
 * 채용 캐시 초기화
 */
function clearJobsCache() {
    const cache = CacheService.getScriptCache();
    cache.remove(JOBS_CACHE_KEY);
    console.log('✅ 채용 캐시 초기화 완료');
}

/**
 * 기존 등록된 URL 목록 가져오기
 */
function getExistingJobUrls(sheet) {
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return new Set();

    const urls = sheet.getRange(2, 8, lastRow - 1, 1).getValues();
    return new Set(urls.flat().filter(u => u));
}

/**
 * ========================================
 * 🔧 시트 관리 함수
 * ========================================
 */

/**
 * jobs 시트 초기화 (헤더만 생성)
 */
function initJobsSheet() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(JOBS_SHEET_NAME);

    if (sheet) {
        console.log('⚠️ jobs 시트가 이미 존재합니다.');
        return;
    }

    sheet = ss.insertSheet(JOBS_SHEET_NAME);
    const headers = ['id', 'company', 'position', 'category', 'career', 'location', 'deadline', 'url', 'source', 'status', 'createdAt', 'order'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

    // 열 너비 조정
    sheet.setColumnWidth(1, 50);   // id
    sheet.setColumnWidth(2, 150);  // company
    sheet.setColumnWidth(3, 250);  // position
    sheet.setColumnWidth(4, 100);  // category
    sheet.setColumnWidth(5, 80);   // career
    sheet.setColumnWidth(6, 150);  // location
    sheet.setColumnWidth(7, 100);  // deadline
    sheet.setColumnWidth(8, 300);  // url
    sheet.setColumnWidth(9, 80);   // source
    sheet.setColumnWidth(10, 80);  // status
    sheet.setColumnWidth(11, 150); // createdAt
    sheet.setColumnWidth(12, 50);  // order

    // 드롭다운 설정 (category)
    const categoryRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(JOB_CATEGORIES)
        .build();
    sheet.getRange('D2:D500').setDataValidation(categoryRule);

    // 드롭다운 설정 (career)
    const careerRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(['신입', '경력', '신입·경력', '무관'])
        .build();
    sheet.getRange('E2:E500').setDataValidation(careerRule);

    // 드롭다운 설정 (source)
    const sourceRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(['사람인', '잡코리아', '워크넷', '직접'])
        .build();
    sheet.getRange('I2:I500').setDataValidation(sourceRule);

    // 드롭다운 설정 (status)
    const statusRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(['승인', '만료'])
        .build();
    sheet.getRange('J2:J500').setDataValidation(statusRule);

    console.log('✅ jobs 시트 초기화 완료');
}

/**
 * ========================================
 * 🧪 테스트 함수
 * ========================================
 */

/**
 * Gemini API 연결 테스트
 */
function testGeminiConnection() {
    try {
        const result = callGeminiAPI('JSON으로 응답하세요: {"test": "success", "message": "Gemini API 연결 성공"}');
        console.log('✅ Gemini API 연결 성공:', JSON.stringify(result));
        return { status: 'success', result: result };
    } catch (error) {
        console.error('❌ Gemini API 연결 실패:', error.message);
        return { status: 'error', message: error.message };
    }
}

/**
 * 단일 URL 테스트
 */
function testExtractSingleUrl() {
    const testUrl = 'https://www.jobkorea.co.kr/Recruit/GI_Read/48460440';
    console.log('🧪 테스트 URL:', testUrl);

    const result = extractJobMetadataWithAI(testUrl);
    console.log('결과:', JSON.stringify(result, null, 2));
    return result;
}

/**
 * 불완전한 데이터 업데이트 테스트
 */
function testFillIncompleteData() {
    console.log('🧪 불완전한 데이터 업데이트 테스트 시작...');
    return fillJobDataFromUrls();
}
