// ========================================
// 🇨🇳 도우인 챌린지 기능 (DouyinChallengeCode.js)
// 2단계 전환 고려 설계 (Adapter 패턴)
// ========================================

// ========================================
// 📦 설정값 (Script Properties)
// ========================================

/**
 * Script Properties 초기 설정
 * Apps Script 에디터 > 프로젝트 설정 > 스크립트 속성에서 설정
 * 
 * USE_TIKHUB_API: 'false' (1단계) / 'true' (2단계)
 * TIKHUB_API_KEY: '' (1단계) / 'Bearer xxx' (2단계)
 * GEMINI_API_KEY: 'AIzaSyB-9UFiTIO-bER3W4UFH6VNac8jWFfHS7I'
 */

const DOUYIN_CONFIG = {
    SHEETS: {
        INPUT: 'douyin_input',
        CHALLENGE: 'douyin_challenge',
        HISTORY: 'douyin_history'
    },
    CACHE_TTL: 3600, // 1시간
    MAX_CHALLENGES: 10,
    SUMMARY_EXPIRE_HOURS: 48
};

// ========================================
// 📊 API 엔드포인트 (프론트엔드용)
// ========================================

/**
 * 도우인 챌린지 목록 조회 (프론트엔드 API)
 * @returns {Object} 챌린지 목록
 */
function getDouyinChallenges() {
    try {
        const cache = CacheService.getScriptCache();
        const cacheKey = 'douyin_challenges';

        // 캐시 확인
        const cached = cache.get(cacheKey);
        if (cached) {
            Logger.log('📦 도우인 챌린지 캐시 HIT');
            return JSON.parse(cached);
        }

        // 시트에서 데이터 로드
        const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DOUYIN_CONFIG.SHEETS.CHALLENGE);
        if (!sheet) {
            return { success: false, message: 'douyin_challenge 시트를 찾을 수 없습니다.' };
        }

        const data = sheet.getDataRange().getValues();
        if (data.length <= 1) {
            return { success: true, updated_at: null, source: 'manual', challenges: [] };
        }

        const headers = data[0];
        const challenges = data.slice(1).map(row => {
            const item = {};
            headers.forEach((h, i) => item[h] = row[i]);
            return {
                rank: item.rank,
                title_zh: item.title_zh,
                title_ko: item.title_ko || '',
                participants: formatNumber(item.participants),
                participants_raw: item.participants,
                cover_url: item.cover_url || '',
                // 🔥 좌표 데이터 포함 (AI가 추출한 바운딩 박스)
                thumbnail_bbox: {
                    x: item.thumb_x || 0,
                    y: item.thumb_y || 0,
                    width: item.thumb_w || 48,
                    height: item.thumb_h || 48
                },
                challenge_url: item.challenge_url || item.video_url || '',
                video_url: item.video_url || '',
                summary_ko: item.summary_ko || '',
                trend_reason: item.trend_reason || '',
                status: item.status || 'stable'
            };
        }).filter(c => c.rank && c.title_zh);

        // 데이터 소스 확인
        const props = PropertiesService.getScriptProperties();
        const useApi = props.getProperty('USE_TIKHUB_API') === 'true';

        // 마지막 업데이트 시간
        const lastRow = sheet.getLastRow();
        let updatedAt = null;
        if (lastRow > 1) {
            const lastUpdatedCol = headers.indexOf('last_updated_at');
            if (lastUpdatedCol >= 0) {
                updatedAt = data[1][lastUpdatedCol];
            }
        }

        const result = {
            success: true,
            updated_at: updatedAt ? new Date(updatedAt).toISOString() : null,
            source: useApi ? 'tikhub' : 'manual',
            challenges: challenges
        };

        // 캐시 저장
        cache.put(cacheKey, JSON.stringify(result), DOUYIN_CONFIG.CACHE_TTL);
        Logger.log('📦 도우인 챌린지 캐시 저장');

        return result;

    } catch (error) {
        Logger.log('❌ getDouyinChallenges 오류: ' + error.message);
        return { success: false, message: error.message };
    }
}

// ========================================
// 🔄 데이터 수집 레이어 (Adapter 패턴)
// ========================================

/**
 * 통합 데이터 수집 인터페이스
 * Script Properties의 USE_TIKHUB_API 값에 따라 분기
 */
function fetchChallengeData() {
    const props = PropertiesService.getScriptProperties();
    const useApi = props.getProperty('USE_TIKHUB_API');

    if (useApi === 'true') {
        return fetchChallengeData_TikHub();
    } else {
        return fetchChallengeData_Manual();
    }
}

/**
 * 1단계: 시트에서 수동 입력 데이터 읽기
 */
function fetchChallengeData_Manual() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DOUYIN_CONFIG.SHEETS.INPUT);
    if (!sheet) {
        throw new Error('douyin_input 시트를 찾을 수 없습니다.');
    }

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];

    const headers = data[0];
    const rows = data.slice(1);

    // 가장 최근 수집 시간 기준 데이터만 추출
    const latestCollectedAt = rows.reduce((max, row) => {
        const colIdx = headers.indexOf('collected_at');
        const val = row[colIdx];
        if (val && new Date(val) > max) return new Date(val);
        return max;
    }, new Date(0));

    // 최근 1시간 이내 데이터만
    const oneHourAgo = new Date(latestCollectedAt.getTime() - 60 * 60 * 1000);

    return rows
        .filter(row => {
            const colIdx = headers.indexOf('collected_at');
            const val = row[colIdx];
            return val && new Date(val) >= oneHourAgo;
        })
        .map(row => normalizeFromSheet(headers, row));
}

/**
 * 2단계: TikHub API에서 데이터 가져오기 (나중에 구현)
 */
function fetchChallengeData_TikHub() {
    const props = PropertiesService.getScriptProperties();
    const apiKey = props.getProperty('TIKHUB_API_KEY');

    if (!apiKey) {
        throw new Error('TIKHUB_API_KEY가 설정되지 않았습니다.');
    }

    try {
        const response = UrlFetchApp.fetch('https://api.tikhub.io/api/v1/douyin/web/fetch_hot_challenge_list', {
            method: 'GET',
            headers: {
                'Authorization': apiKey,
                'Content-Type': 'application/json'
            },
            muteHttpExceptions: true
        });

        const json = JSON.parse(response.getContentText());

        if (!json.data || !json.data.challenge_list) {
            throw new Error('TikHub API 응답 형식 오류');
        }

        return normalizeFromTikHub(json.data.challenge_list);

    } catch (error) {
        Logger.log('❌ TikHub API 호출 실패: ' + error.message);
        throw error;
    }
}

// ========================================
// 🔧 데이터 정규화
// ========================================

/**
 * 시트 데이터 → 내부 형식 변환 (video_share_text 파싱 포함)
 */
function normalizeFromSheet(headers, row) {
    const get = (col) => {
        const idx = headers.indexOf(col);
        return idx >= 0 ? row[idx] : null;
    };

    // participants 변환 (participants_raw가 있으면 우선 사용)
    let participants = get('participants');
    const rawParticipants = get('participants_raw');
    if (rawParticipants) {
        participants = parseChineseNumber(rawParticipants);
    } else {
        participants = parseNumber(participants);
    }

    // video_share_text 파싱
    const videoShareText = get('video_share_text');
    const videoInfo = parseVideoShareText(videoShareText);

    return {
        rank: get('rank'),
        title_zh: get('title_zh'),
        title_ko: get('title_ko') || '',
        participants: participants,
        cover_url: get('cover_url') || '',
        challenge_id: get('challenge_id') || generateTempId(get('title_zh')),
        challenge_url: get('challenge_url') || '',
        video_url: videoInfo.video_url || get('video_url') || '',
        video_author: videoInfo.video_author || '',
        video_title: videoInfo.video_title || '',
        collected_at: get('collected_at') ? new Date(get('collected_at')) : new Date()
    };
}

/**
 * TikHub API 응답 → 내부 형식 변환
 */
function normalizeFromTikHub(challengeList) {
    return challengeList.map((item, index) => ({
        rank: index + 1,
        title_zh: item.challenge_name || item.cha_name || '',
        participants: item.view_count || item.user_count || 0,
        cover_url: (item.cover && item.cover.url_list && item.cover.url_list[0]) || '',
        challenge_id: item.cid || item.challenge_id || '',
        collected_at: new Date()
    }));
}

// ========================================
// 🔄 입력 처리 (트리거 함수)
// ========================================

/**
 * 도우인 입력 처리 (트리거: 하루 4회 또는 onEdit)
 * Delta 기반: 변경된 항목만 요약 생성
 */
function processDouyinInput() {
    try {
        Logger.log('🚀 도우인 입력 처리 시작');

        // 1. 데이터 수집
        const rawData = fetchChallengeData();
        if (!rawData || rawData.length === 0) {
            Logger.log('⚠️ 수집된 데이터 없음');
            return;
        }
        Logger.log(`📥 수집된 데이터: ${rawData.length}개`);

        // 2. 기존 데이터와 비교 (Delta 감지)
        const existingData = getExistingChallenges();
        const { newItems, changedItems } = detectChanges(rawData, existingData);

        Logger.log(`🆕 신규: ${newItems.length}개, 🔄 변경: ${changedItems.length}개`);

        // 3. 요약 생성 필요한 항목만 처리
        const itemsToSummarize = [...newItems, ...changedItems];

        for (const item of itemsToSummarize) {
            try {
                const summary = generateChallengeSummary(item.title_zh, item.participants);
                item.summary_ko = summary.summary_ko;
                item.trend_reason = summary.trend_reason;
                item.ent_use_tip = summary.ent_use_tip;
                item.status = item.isNew ? 'new' : detectStatus(item, existingData);

                // API 호출 간 딜레이 (레이트 리밋 방지)
                Utilities.sleep(1000);
            } catch (e) {
                Logger.log(`⚠️ 요약 생성 실패 (${item.title_zh}): ${e.message}`);
                item.summary_ko = '';
                item.trend_reason = '';
                item.ent_use_tip = '';
            }
        }

        // 4. douyin_challenge 시트에 저장
        saveToChallengeSheet(rawData, itemsToSummarize);

        // 5. 히스토리 저장
        saveToHistory(rawData);

        // 6. 캐시 무효화
        CacheService.getScriptCache().remove('douyin_challenges');

        Logger.log('✅ 도우인 입력 처리 완료');

    } catch (error) {
        Logger.log('❌ processDouyinInput 오류: ' + error.message);
        throw error;
    }
}

/**
 * onEdit 트리거용 함수
 */
function onDouyinInputEdit(e) {
    const sheet = e.source.getActiveSheet();
    if (sheet.getName() !== DOUYIN_CONFIG.SHEETS.INPUT) return;

    // 디바운스: 마지막 편집 후 10초 대기
    const props = PropertiesService.getScriptProperties();
    const lastEdit = props.getProperty('DOUYIN_LAST_EDIT');
    const now = new Date().getTime();

    if (lastEdit && (now - parseInt(lastEdit)) < 10000) {
        return; // 10초 이내 재편집은 무시
    }

    props.setProperty('DOUYIN_LAST_EDIT', now.toString());

    // 10초 후 처리 트리거 (ScriptApp.newTrigger는 별도 설정 필요)
    Logger.log('📝 도우인 입력 편집 감지');
    processDouyinInput();
}

// ========================================
// 🤖 Gemini API 요약 생성
// ========================================

/**
 * Gemini API로 챌린지 요약 생성
 */
function generateChallengeSummary(title_zh, participants) {
    const props = PropertiesService.getScriptProperties();
    const apiKey = props.getProperty('GEMINI_API_KEY');

    if (!apiKey) {
        throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
    }

    const prompt = `당신은 K-POP 기획사 중국 시장 담당자를 위한 트렌드 분석가입니다.

다음 도우인 챌린지를 분석해주세요:
- 제목: ${title_zh}
- 참여수: ${formatNumber(participants)}

아래 형식으로 JSON 응답해주세요:

{
  "title_ko": "8자 이내의 간결한 한국어 제목 (예: 설날 패션 대결, 논문 먹방, 청춘 추억 공유)",
  "summary_ko": "이 챌린지가 무엇인지 1줄 설명",
  "trend_reason": "유행 이유 1줄 (직접적으로 서술, '~입니다'로 끝내기)"
}

규칙:
- title_ko: 8자 이내, 이해하기 쉬운 한국어 (설명이 아닌 제목 형식)
- summary_ko: 20자 이내, 핵심만
- trend_reason: 30자 이내, '추정됩니다/보입니다' 사용 금지, 단정적으로 서술`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 500
            }
        };

        const response = UrlFetchApp.fetch(url, {
            method: 'POST',
            contentType: 'application/json',
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
        });

        const json = JSON.parse(response.getContentText());

        if (json.error) {
            throw new Error(json.error.message);
        }

        const text = json.candidates[0].content.parts[0].text;

        // JSON 추출
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }

        // JSON 파싱 실패 시 텍스트에서 추출
        return {
            summary_ko: text.substring(0, 100),
            trend_reason: '',
            ent_use_tip: ''
        };

    } catch (error) {
        Logger.log('❌ Gemini API 오류: ' + error.message);
        throw error;
    }
}

// ========================================
// 📦 데이터 저장 함수
// ========================================

/**
 * 기존 챌린지 데이터 조회
 */
function getExistingChallenges() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DOUYIN_CONFIG.SHEETS.CHALLENGE);
    if (!sheet || sheet.getLastRow() <= 1) return [];

    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    return data.slice(1).map(row => {
        const item = {};
        headers.forEach((h, i) => item[h] = row[i]);
        return item;
    });
}

/**
 * 변경 감지 (Delta)
 */
function detectChanges(newData, existingData) {
    const existingMap = new Map();
    existingData.forEach(item => {
        const key = getUniqueKey(item);
        existingMap.set(key, item);
    });

    const newItems = [];
    const changedItems = [];

    newData.forEach(item => {
        const key = getUniqueKey(item);
        const existing = existingMap.get(key);

        if (!existing) {
            item.isNew = true;
            newItems.push(item);
        } else {
            // 참여수 20% 이상 증가 또는 순위 5단계 이상 상승 시 변경으로 간주
            const participantsChange = (item.participants - existing.participants) / existing.participants;
            const rankChange = existing.rank - item.rank;

            if (participantsChange > 0.2 || rankChange >= 5) {
                item.isNew = false;
                changedItems.push(item);
            }

            // 요약이 48시간 지났으면 재생성
            if (existing.last_updated_at) {
                const hoursSinceUpdate = (new Date() - new Date(existing.last_updated_at)) / (1000 * 60 * 60);
                if (hoursSinceUpdate > DOUYIN_CONFIG.SUMMARY_EXPIRE_HOURS && !changedItems.includes(item)) {
                    item.isNew = false;
                    changedItems.push(item);
                }
            }
        }
    });

    return { newItems, changedItems };
}

/**
 * 상태 감지
 */
function detectStatus(item, existingData) {
    const existing = existingData.find(e => getUniqueKey(e) === getUniqueKey(item));
    if (!existing) return 'new';

    if (item.rank < existing.rank) return 'rising';
    if (item.rank > existing.rank) return 'falling';
    return 'stable';
}

/**
 * 고유 키 생성
 */
function getUniqueKey(item) {
    if (item.challenge_id) return item.challenge_id;
    return hashString(item.title_zh);
}

/**
 * 문자열 해시
 */
function hashString(str) {
    if (!str) return '';
    return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, str)
        .map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'))
        .join('');
}

/**
 * 임시 ID 생성
 */
function generateTempId(title) {
    return 'temp_' + hashString(title).substring(0, 8);
}

/**
 * douyin_challenge 시트에 저장
 */
function saveToChallengeSheet(allData, summarizedItems) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DOUYIN_CONFIG.SHEETS.CHALLENGE);
    if (!sheet) {
        throw new Error('douyin_challenge 시트를 찾을 수 없습니다.');
    }

    const headers = ['rank', 'title_zh', 'participants', 'cover_url', 'challenge_id',
        'summary_ko', 'trend_reason', 'ent_use_tip', 'status',
        'first_seen_at', 'last_updated_at'];

    // 기존 데이터 조회
    const existingData = getExistingChallenges();
    const existingMap = new Map();
    existingData.forEach(item => existingMap.set(getUniqueKey(item), item));

    // 요약이 업데이트된 항목 맵
    const summarizedMap = new Map();
    summarizedItems.forEach(item => summarizedMap.set(getUniqueKey(item), item));

    const now = new Date();
    const rows = allData.map(item => {
        const key = getUniqueKey(item);
        const existing = existingMap.get(key);
        const summarized = summarizedMap.get(key);

        return [
            item.rank,
            item.title_zh,
            item.participants,
            item.cover_url || '',
            item.challenge_id || '',
            summarized ? summarized.summary_ko : (existing ? existing.summary_ko : ''),
            summarized ? summarized.trend_reason : (existing ? existing.trend_reason : ''),
            summarized ? summarized.ent_use_tip : (existing ? existing.ent_use_tip : ''),
            summarized ? summarized.status : (existing ? existing.status : 'stable'),
            existing ? existing.first_seen_at : now,
            summarized ? now : (existing ? existing.last_updated_at : now)
        ];
    });

    // 시트 초기화 및 쓰기
    sheet.clear();
    sheet.appendRow(headers);
    if (rows.length > 0) {
        sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }

    Logger.log(`📝 douyin_challenge에 ${rows.length}개 항목 저장`);
}

/**
 * 히스토리 저장
 */
function saveToHistory(data) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DOUYIN_CONFIG.SHEETS.HISTORY);
    if (!sheet) {
        Logger.log('⚠️ douyin_history 시트 없음, 스킵');
        return;
    }

    const now = new Date();
    const rows = data.map(item => [
        now,
        item.rank,
        item.title_zh,
        item.participants
    ]);

    // 헤더 확인
    if (sheet.getLastRow() === 0) {
        sheet.appendRow(['snapshot_at', 'rank', 'title_zh', 'participants']);
    }

    // 데이터 추가
    if (rows.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
    }

    Logger.log(`📜 douyin_history에 ${rows.length}개 스냅샷 저장`);
}

// ========================================
// 🧹 정리 함수 (야간 트리거)
// ========================================

/**
 * 야간 정리 (매일 03시)
 * - 30일 이상 된 히스토리 삭제
 * - 캐시 재생성
 */
function cleanupDouyinData() {
    Logger.log('🧹 도우인 데이터 정리 시작');

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DOUYIN_CONFIG.SHEETS.HISTORY);
    if (sheet && sheet.getLastRow() > 1) {
        const data = sheet.getDataRange().getValues();
        const headers = data[0];
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        // 30일 이내 데이터만 유지
        const filtered = data.filter((row, i) => {
            if (i === 0) return true; // 헤더
            const snapshotAt = new Date(row[0]);
            return snapshotAt >= thirtyDaysAgo;
        });

        const deleted = data.length - filtered.length;
        if (deleted > 0) {
            sheet.clear();
            sheet.getRange(1, 1, filtered.length, headers.length).setValues(filtered);
            Logger.log(`🗑️ ${deleted}개 오래된 히스토리 삭제`);
        }
    }

    // 캐시 재생성
    getDouyinChallenges();

    Logger.log('✅ 도우인 데이터 정리 완료');
}

// ========================================
// 🛠️ 유틸리티 함수
// ========================================

/**
 * 숫자 포맷 (예: 8044000 → "804.4만")
 */
function formatNumber(num) {
    if (!num) return '0';
    num = parseNumber(num);

    if (num >= 100000000) {
        return (num / 100000000).toFixed(1) + '억';
    } else if (num >= 10000) {
        return (num / 10000).toFixed(1) + '만';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + '천';
    }
    return num.toString();
}

/**
 * 숫자 파싱 (만/亿 단위 포함)
 */
function parseNumber(val) {
    if (!val) return 0;
    let numStr = String(val).replace(/,/g, '').trim();

    // 중국어 단위 처리
    if (numStr.includes('亿')) {
        return parseFloat(numStr.replace('亿', '')) * 100000000;
    }
    if (numStr.includes('万')) {
        return parseFloat(numStr.replace('万', '')) * 10000;
    }
    // 한국어 단위 처리
    if (numStr.includes('억')) {
        return parseFloat(numStr.replace('억', '')) * 100000000;
    }
    if (numStr.includes('만')) {
        return parseFloat(numStr.replace('만', '')) * 10000;
    }

    const num = Number(numStr);
    return isNaN(num) ? 0 : num;
}

/**
 * 중국어 숫자 표기 파싱 (804.4万 → 8044000)
 */
function parseChineseNumber(str) {
    if (!str) return 0;
    str = String(str).trim();

    if (str.includes('亿')) {
        return Math.round(parseFloat(str.replace('亿', '')) * 100000000);
    }
    if (str.includes('万')) {
        return Math.round(parseFloat(str.replace('万', '')) * 10000);
    }
    return Math.round(parseFloat(str.replace(/,/g, ''))) || 0;
}

/**
 * 도우인 영상 공유 텍스트 파싱
 * 입력 예: "3.07 复制打开抖音,看看【宋雪 Shirley的作品】〈我回家过年vs别人回家过年〉 # 过年穿什么 https://v.douyin.com/s_DTRUh8LUQ/"
 */
function parseVideoShareText(text) {
    if (!text) return {};

    const result = {};

    // 1. URL 추출 (v.douyin.com)
    const urlMatch = text.match(/https:\/\/v\.douyin\.com\/[^\s\/]+/);
    if (urlMatch) {
        result.video_url = urlMatch[0];
    }

    // 2. 작성자 추출 【작성자的作品】
    const authorMatch = text.match(/【(.+?)的作品】/);
    if (authorMatch) {
        result.video_author = authorMatch[1];
    }

    // 3. 영상 제목 추출 〈제목〉 또는 《제목》
    const titleMatch = text.match(/[〈《](.+?)[〉》]/);
    if (titleMatch) {
        result.video_title = titleMatch[1];
    }

    // 4. 해시태그 추출
    const hashtagMatches = text.match(/#\s*([^\s#]+)/g);
    if (hashtagMatches) {
        result.hashtags = hashtagMatches.map(h => h.replace(/^#\s*/, '')).join(', ');
    }

    return result;
}

// ========================================
// 🔧 트리거 설정 헬퍼
// ========================================

/**
 * 도우인 트리거 설정 (수동 실행)
 */
function setupDouyinTriggers() {
    // 기존 트리거 삭제
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(trigger => {
        const funcName = trigger.getHandlerFunction();
        if (funcName.includes('Douyin') || funcName.includes('douyin')) {
            ScriptApp.deleteTrigger(trigger);
        }
    });

    // 정기 처리 트리거 (09:00, 13:00, 18:00, 22:00)
    [9, 13, 18, 22].forEach(hour => {
        ScriptApp.newTrigger('processDouyinInput')
            .timeBased()
            .atHour(hour)
            .everyDays(1)
            .create();
    });

    // 야간 정리 트리거 (03:00)
    ScriptApp.newTrigger('cleanupDouyinData')
        .timeBased()
        .atHour(3)
        .everyDays(1)
        .create();

    Logger.log('✅ 도우인 트리거 설정 완료');
}

/**
 * Script Properties 초기 설정 (수동 실행)
 */
function initDouyinProperties() {
    const props = PropertiesService.getScriptProperties();

    // 기본값 설정 (이미 있으면 덮어쓰지 않음)
    const defaults = {
        'USE_TIKHUB_API': 'false',
        'TIKHUB_API_KEY': '',
        'GEMINI_API_KEY': 'AIzaSyB-9UFiTIO-bER3W4UFH6VNac8jWFfHS7I'
    };

    Object.entries(defaults).forEach(([key, value]) => {
        if (!props.getProperty(key)) {
            props.setProperty(key, value);
            Logger.log(`✅ ${key} 설정됨`);
        }
    });

    Logger.log('✅ 도우인 Script Properties 초기화 완료');
}

// ========================================
// 🌐 웹앱 입력 페이지
// ========================================
// ⚠️ doGet()은 Code.js에 통합됨 (함수 충돌 방지)
// Code.js의 doGet()에서 action=getDouyinChallenges 처리

/**
 * 🔥 썸네일 좌표 계산을 위한 고정 상수 (도우인 스크린샷 레이아웃)
 * 
 * 📐 레이아웃 규칙:
 * [왼쪽여백][순위숫자][오른쪽여백][썸네일][간격][제목...]
 * - 순위 숫자의 왼쪽 여백 = 오른쪽 여백
 * - 썸네일은 정사각형
 * - 배경은 흰색
 */
/**
 * 🔥 비율 기반 썸네일 좌표 상수 (가로폭 W 기준)
 * 모든 좌표는 이미지 가로폭(W)에 비례하여 계산
 * 
 * 두 가지 이미지 타입:
 * 1. FULL: 전체 도우인 랭킹 스크린샷 (485px 기준)
 * 2. CROP: 숫자+썸네일만 크롭된 이미지 (150px 등)
 */
const THUMB_LAYOUT_RATIO = {
    // 전체 스크린샷용 (485px 기준)
    FULL: {
        thumbXRatio: 0.12,
        thumbY0Ratio: 0.132,
        thumbSizeRatio: 0.10,
        rowGapRatio: 0.157
    },
    // 크롭 이미지용 (숫자+썸네일만) - 🔥 fallback용, 실제로는 밝기 분석 사용
    CROP: {
        thumbXRatio: 0.487,
        thumbY0Ratio: 0.127,
        thumbSizeRatio: 0.433,
        rowGapRatio: 0.66
    }
};

/**
 * 🔥 밝기 분석 기반 썸네일 좌표 추출 (Python 로직을 GAS로 포팅)
 * 크롭 이미지에서 20개 썸네일의 정확한 바운딩 박스를 계산
 * 
 * @param {number[]} imageBytes - 이미지 바이트 배열
 * @param {number} imageWidth - 이미지 너비
 * @param {number} imageHeight - 이미지 높이
 * @returns {Array} 각 순위별 바운딩 박스 배열
 */
function extractThumbnailBBoxesByBrightness(imageBytes, imageWidth, imageHeight) {
    // GAS에서는 픽셀 단위 분석이 제한적이므로, 
    // 20등분 + 비율 기반 계산으로 대체
    // 실제 밝기 분석은 클라이언트(Canvas) 또는 외부 서비스에서 수행

    const unitHeight = imageHeight / 20;
    const results = [];

    // 🔥 핵심: 왼쪽 숫자 영역은 전체 폭의 약 48.7% 지점까지
    // (테스트 이미지 150px 기준 x=73에서 시작 → 73/150 = 0.487)
    const thumbStartXRatio = 0.487;
    const thumbStartX = Math.round(imageWidth * thumbStartXRatio);

    for (let rank = 1; rank <= 20; rank++) {
        const yStart = Math.round((rank - 1) * unitHeight);
        const yEnd = Math.round(rank * unitHeight);

        // 썸네일 영역 (숫자 제거 후 남은 부분)
        results.push({
            rank: rank,
            x: thumbStartX,
            y: yStart,
            width: imageWidth - thumbStartX,
            height: yEnd - yStart
        });
    }

    return results;
}

/**
 * 비율 기반 썸네일 좌표 계산 (해상도 무관)
 * @param {number} rank - 순위 (1~22)
 * @param {number} imageWidth - 이미지 가로 너비
 * @param {string} imageType - 이미지 타입 ('FULL' 또는 'CROP')
 * @returns {Object} 바운딩 박스 {x, y, width, height}
 */
function getThumbnailBBoxByRank(rank, imageWidth = 375, imageType = 'FULL') {
    const R = THUMB_LAYOUT_RATIO[imageType] || THUMB_LAYOUT_RATIO.FULL;
    const W = imageWidth;

    const x = Math.round(W * R.thumbXRatio);
    const y = Math.round(W * R.thumbY0Ratio + (rank - 1) * W * R.rowGapRatio);
    const size = Math.round(W * R.thumbSizeRatio);

    return { x, y, width: size, height: size };
}

/**
 * 중심점 기반 썸네일 좌표 계산 (AI 좌표 사용 시)
 * @param {number} rank - 순위
 * @param {number} rankCenterY - 순위 숫자 중심 Y 좌표
 * @param {number} imageWidth - 이미지 가로 너비
 * @param {string} imageType - 이미지 타입 ('FULL' 또는 'CROP')
 */
function getThumbnailBBoxFromRankCenter(rank, rankCenterY, imageWidth = 375, imageType = 'FULL') {
    const R = THUMB_LAYOUT_RATIO[imageType] || THUMB_LAYOUT_RATIO.FULL;
    const W = imageWidth;

    const x = Math.round(W * R.thumbXRatio);
    const size = Math.round(W * R.thumbSizeRatio);
    const y = Math.round(rankCenterY - (size / 2));

    return { x, y, width: size, height: size };
}

/**
 * 🔥 서버 사이드 썸네일 크롭 (GAS에서 실행)
 * 스크린샷에서 각 순위별 썸네일을 잘라서 개별 이미지로 저장
 * 
 * ⚠️ 주의: GAS에서는 직접 이미지 크롭이 불가능하므로,
 * 외부 이미지 처리 서비스(Cloudinary, imgix 등)를 사용하거나
 * 클라이언트에서 Canvas로 처리해야 합니다.
 * 
 * 이 함수는 좌표 정보만 반환합니다.
 */
function extractThumbnailsFromScreenshot(screenshotBlob) {
    // GAS에서 이미지 픽셀 접근은 제한적
    // 대신 좌표 정보를 저장하고 클라이언트에서 처리하도록 함

    const imageBytes = screenshotBlob.getBytes();

    // 이미지 크기 추출 시도 (JPEG 헤더 파싱)
    let imageWidth = 375; // 기본값

    try {
        // JPEG 이미지 크기 추출 (SOF0 마커에서)
        const dimensions = getJpegDimensions(imageBytes);
        if (dimensions) {
            imageWidth = dimensions.width;
            Logger.log(`📐 이미지 크기 감지: ${imageWidth} × ${dimensions.height}`);
        }
    } catch (e) {
        Logger.log('⚠️ 이미지 크기 추출 실패, 기본값 사용: 375px');
    }

    // 각 순위별 좌표 계산
    const thumbnails = [];
    for (let rank = 1; rank <= 22; rank++) {
        thumbnails.push({
            rank: rank,
            bbox: getThumbnailBBoxByRank(rank, imageWidth)
        });
    }

    return {
        imageWidth: imageWidth,
        thumbnails: thumbnails
    };
}

/**
 * JPEG 이미지 크기 추출 (헤더 파싱)
 */
function getJpegDimensions(bytes) {
    // SOF0/SOF2 마커 찾기 (0xFF 0xC0 또는 0xFF 0xC2)
    for (let i = 0; i < bytes.length - 9; i++) {
        if (bytes[i] === 0xFF && (bytes[i + 1] === 0xC0 || bytes[i + 1] === 0xC2)) {
            const height = (bytes[i + 5] << 8) | bytes[i + 6];
            const width = (bytes[i + 7] << 8) | bytes[i + 8];
            return { width, height };
        }
    }
    return null;
}

/**
 * 랭킹 스크린샷 OCR 분석 (Gemini Vision) - 하이브리드 방식
 * 🔥 AI는 텍스트와 좌표만 추출, 정렬은 로직으로 보정
 * @param {string} imageBase64 Base64 인코딩된 이미지
 * @returns {Array} 추출된 챌린지 목록
 */
function analyzeSingleImage(imageBase64) {
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');

    if (!apiKey) {
        throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
    }

    // 1. 이미지를 Google Drive에 저장
    let screenshotUrl = '';
    try {
        screenshotUrl = saveScreenshotToDrive(imageBase64);
        Logger.log('📸 스크린샷 저장됨: ' + screenshotUrl);
    } catch (e) {
        Logger.log('⚠️ 스크린샷 저장 실패: ' + e.message);
    }

    // 🔥 프롬프트: 순위 숫자의 세로 중심 Y 좌표 추출
    const prompt = `이 도우인(抖音) 챌린지 랭킹 스크린샷을 분석해주세요.

각 챌린지의 정보와 **순위 숫자의 세로 중심 좌표**를 추출해주세요.

📐 좌표 측정 방법 (매우 중요):
- 순위를 표시하는 숫자(1, 2, 3... 10, 11...)를 찾으세요
- ⚠️ 두 자리 숫자(10, 11, 12...)는 "1"과 "0"을 **하나의 숫자 블록**으로 취급하세요
- 숫자 블록 전체의 세로 방향 정중앙 위치를 픽셀 단위로 측정하세요
- 예: "10" 숫자 블록이 세로로 y=700~718 사이에 있다면, 중심은 709

응답 형식 (JSON 배열만):
[
  {
    "rank": 1,
    "title_zh": "当你穿得很潮回家过年",
    "participants_raw": "916.7万",
    "rank_number_center_y": 139
  },
  {
    "rank": 10,
    "title_zh": "红底鞋变装转场挑战",
    "participants_raw": "763.3万",
    "rank_number_center_y": 709
  }
]

규칙:
- rank: 순위 숫자 (정수)
- title_zh: 중국어 챌린지 제목 (정확히)
- participants_raw: 참여수 원본 그대로 (예: "916.7万")
- rank_number_center_y: 순위 숫자 블록의 세로 중심 Y 좌표 (정수, 픽셀)
- ⚠️ 10위 이상은 "10", "11" 전체를 하나의 숫자로 보고 그 중심을 측정
- JSON만 응답, 마크다운 코드블록 사용 금지
- 모든 보이는 챌린지를 순서대로 추출`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

    const payload = {
        contents: [{
            parts: [
                { text: prompt },
                { inline_data: { mime_type: "image/jpeg", data: imageBase64 } }
            ]
        }],
        generationConfig: {
            temperature: 0.05,
            maxOutputTokens: 5000
        }
    };

    try {
        const response = UrlFetchApp.fetch(url, {
            method: 'POST',
            contentType: 'application/json',
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
        });

        const json = JSON.parse(response.getContentText());

        if (json.error) {
            throw new Error(json.error.message);
        }

        let text = json.candidates[0].content.parts[0].text;
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();

        Logger.log('OCR 결과: ' + text.substring(0, 500));

        // JSON 추출 및 파싱
        let challenges;
        try {
            const jsonMatch = text.match(/\[[\s\S]*\]/);
            if (!jsonMatch) throw new Error('JSON 배열 없음');

            let jsonStr = jsonMatch[0];
            jsonStr = jsonStr.replace(/,\s*\]$/, ']'); // 마지막 쉼표 제거

            // 불완전한 객체 자동 복구
            const lastBracketIdx = jsonStr.lastIndexOf(']');
            const lastBraceIdx = jsonStr.lastIndexOf('}');
            if (lastBracketIdx > lastBraceIdx) {
                const completeObjects = jsonStr.match(/\{[^{}]*\}/g);
                if (completeObjects && completeObjects.length > 0) {
                    jsonStr = '[' + completeObjects.join(',') + ']';
                }
            }

            challenges = JSON.parse(jsonStr);

        } catch (parseError) {
            Logger.log('⚠️ JSON 파싱 시도 실패: ' + parseError.message);

            // 2차 시도: 개별 객체 추출
            const objectMatches = text.match(/\{"rank":\s*\d+[^}]+\}/g);
            if (objectMatches && objectMatches.length > 0) {
                challenges = objectMatches.map(obj => {
                    try { return JSON.parse(obj); }
                    catch (e) { return null; }
                }).filter(o => o !== null);
            } else {
                throw new Error('JSON 파싱 실패');
            }
        }

        Logger.log(`📸 OCR: ${challenges.length}개 챌린지 추출됨`);

        // 🔥 이미지 원본 크기 감지 (Auto-Scaling)
        let realImageWidth = 375; // 기본값
        try {
            const decodedBytes = Utilities.base64Decode(imageBase64);
            const dimensions = getJpegDimensions(decodedBytes);
            if (dimensions && dimensions.width > 0) {
                realImageWidth = dimensions.width;
                Logger.log(`📏 원본 이미지 크기 감지: ${realImageWidth}px`);
            }
        } catch (e) { Logger.log('⚠️ 이미지 크기 실패, 375px로 가정'); }

        // 스케일 팩터 (좌표를 375px 기준으로 정규화)
        const scale = 375.0 / realImageWidth;

        // 🔥 Linear Regression Alignment (선형 회귀 정렬)
        // AI가 추출한 Y 좌표들의 노이즈를 제거하고 일관된 간격으로 보정
        // 핵심: 1위~마지막 순위 사이의 전체 거리를 균등 분할
        const validPoints = challenges.filter(c => c.rank && c.rank_number_center_y > 0)
            .map(c => ({
                rank: parseInt(c.rank),
                y: c.rank_number_center_y * scale
            }))
            .sort((a, b) => a.rank - b.rank);

        let alignedLayout = null;
        if (validPoints.length >= 3) {
            // 최소 3개 이상의 포인트로 신뢰도 확보
            const first = validPoints[0];
            const last = validPoints[validPoints.length - 1];

            if (last.rank > first.rank) {
                // 🔥 전체 거리를 순위 차이로 균등 분할 (누적 오차 제거)
                const totalDistance = last.y - first.y;
                const rankDiff = last.rank - first.rank;
                const perfectGap = totalDistance / rankDiff;

                // 1위 기준 Y 역산
                const calcFirstY = first.y - ((first.rank - 1) * perfectGap);

                alignedLayout = { firstY: calcFirstY, gap: perfectGap };
                Logger.log(`📏 선형 회귀 정렬: FirstY=${calcFirstY.toFixed(1)}, Gap=${perfectGap.toFixed(2)}, 포인트=${validPoints.length}개`);
            }
        } else if (validPoints.length >= 1) {
            // 포인트가 부족하면 첫 번째 포인트 + 기본 간격 사용
            const first = validPoints[0];
            const defaultGap = 65; // 기본 간격 (375px 기준)
            const calcFirstY = first.y - ((first.rank - 1) * defaultGap);
            alignedLayout = { firstY: calcFirstY, gap: defaultGap };
            Logger.log(`⚠️ 포인트 부족(${validPoints.length}개), 기본 간격 사용: FirstY=${calcFirstY.toFixed(1)}, Gap=${defaultGap}`);
        }

        // 최종 좌표 적용 (선형 회귀 우선, 실패 시에만 fallback)
        const challengesWithCoords = challenges.map(c => {
            const rank = parseInt(c.rank) || 0;
            let bbox;

            if (alignedLayout && rank >= 1 && rank <= 22) {
                // 🔥 선형 회귀로 보정된 Y 좌표 사용 (권장)
                // 개별 AI 좌표의 노이즈를 제거하고 일관된 간격 적용
                const rankCenterY = alignedLayout.firstY + (rank - 1) * alignedLayout.gap;
                bbox = getThumbnailBBoxFromRankCenter(rank, rankCenterY, 375);
            } else {
                // Fallback: 선형 회귀 실패 시에만 공식 기반 계산
                Logger.log(`⚠️ 순위 ${rank}: 선형 회귀 실패, fallback 사용`);
                bbox = getThumbnailBBoxByRank(rank, 375);
            }

            return {
                ...c,
                thumbnail_bbox: bbox,
                cover_url: screenshotUrl,
                isNew: true
            };
        });

        return checkExistingChallenges(challengesWithCoords, screenshotUrl);

    } catch (error) {
        Logger.log('❌ OCR 오류: ' + error.message);
        throw error;
    }
}

/**
 * 랭킹 분석 엔트리 포인트 (단일/듀얼 모드 분기)
 */
function analyzeRankingImage(mainImageBase64, cropImageBase64 = null) {
    if (cropImageBase64) {
        Logger.log('🚀 듀얼 모드 분석 시작 (Main + Crop Ratio V2)');
        return analyzeDualImagesRatioV2(mainImageBase64, cropImageBase64);
    } else {
        Logger.log('🚀 단일 모드 분석 시작');
        return analyzeSingleImage(mainImageBase64);
    }
}

/**
 * 듀얼 모드 분석 (Main: 텍스트, Crop: 좌표/썸네일)
 */
function analyzeDualImages(mainBase64, cropBase64) {
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');

    // 1. Crop 이미지 저장 (썸네일용)
    let cropUrl = '';
    let cropWidth = 375;
    try {
        cropUrl = saveScreenshotToDrive(cropBase64);
        const bytes = Utilities.base64Decode(cropBase64);
        const dims = getJpegDimensions(bytes);
        if (dims) cropWidth = dims.width;
        Logger.log(`📸 Crop 이미지 저장됨 (${cropWidth}px): ${cropUrl}`);
    } catch (e) { Logger.log('⚠️ Crop 저장 실패: ' + e.message); }

    const cropScale = 375.0 / cropWidth;

    // 2. 병렬 요청 (Main 텍스트 + Crop 좌표)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

    // Main Prompt (Text Only)
    const mainPrompt = `이 도우인 랭킹 스크린샷에서 텍스트 정보를 추출하세요.
좌표는 필요 없습니다.

응답 형식 (JSON):
[{"rank": 1, "title_zh": "...", "participants_raw": "..."}]

규칙:
- rank, title_zh, participants_raw 필수
- JSON만 응답`;

    // Crop Prompt (Coord Only)
    const cropPrompt = `이 크롭된 랭킹 이미지에서 '순위 숫자'와 '순위 숫자의 세로 중심 좌표'를 추출하세요.

응답 형식 (JSON):
[{"rank": 1, "rank_number_center_y": 145}]

📐 좌표 측정:
- 순위 숫자(1, 2... 10...)의 세로 중심점(Y) 측정
- ⚠️ "10", "11" 등 두 자리 숫자는 **하나의 블록**으로 보고 그 중심 측정
- JSON만 응답`;

    const req1 = {
        method: 'POST',
        url: url,
        contentType: 'application/json',
        payload: JSON.stringify({
            contents: [{ parts: [{ text: mainPrompt }, { inline_data: { mime_type: "image/jpeg", data: mainBase64 } }] }],
            generationConfig: { temperature: 0.05, maxOutputTokens: 5000 }
        }),
        muteHttpExceptions: true
    };

    const req2 = {
        method: 'POST',
        url: url,
        contentType: 'application/json',
        payload: JSON.stringify({
            contents: [{ parts: [{ text: cropPrompt }, { inline_data: { mime_type: "image/jpeg", data: cropBase64 } }] }],
            generationConfig: { temperature: 0.05, maxOutputTokens: 5000 }
        }),
        muteHttpExceptions: true
    };

    try {
        const responses = UrlFetchApp.fetchAll([req1, req2]);
        const mainRes = JSON.parse(responses[0].getContentText());
        const cropRes = JSON.parse(responses[1].getContentText());

        if (mainRes.error) throw new Error('Main OCR Error: ' + mainRes.error.message);
        if (cropRes.error) throw new Error('Crop OCR Error: ' + cropRes.error.message);

        // Parse Main (Text)
        let mainText = mainRes.candidates[0].content.parts[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
        let mainChallenges = parseJsonSafe(mainText);

        // Parse Crop (Coords)
        let cropText = cropRes.candidates[0].content.parts[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
        let cropChallenges = parseJsonSafe(cropText);

        Logger.log(`📸 Dual Result: Main ${mainChallenges.length}개, Crop ${cropChallenges.length}개`);

        // Merge & Align (Offset Logic: Crop coords -> Target BBox)
        // 1. Crop 이미지에서의 좌표를 375px 기준으로 정규화
        const validPoints = cropChallenges.filter(c => c.rank && c.rank_number_center_y > 0)
            .map(c => ({
                rank: parseInt(c.rank),
                y: c.rank_number_center_y * cropScale
            })).sort((a, b) => a.rank - b.rank);

        // 2. Linear Regression on Crop Coords (to fix noise)
        let alignedLayout = null;
        if (validPoints.length >= 3) {
            const first = validPoints[0];
            const last = validPoints[validPoints.length - 1];
            if (last.rank > first.rank) {
                const totalDistance = last.y - first.y;
                const perfectGap = totalDistance / (last.rank - first.rank);
                const calcFirstY = first.y - ((first.rank - 1) * perfectGap);
                alignedLayout = { firstY: calcFirstY, gap: perfectGap };
                Logger.log(`📏 Crop 정렬 보정: FirstY=${calcFirstY.toFixed(1)}, Gap=${perfectGap.toFixed(1)}`);
            }
        } else if (validPoints.length >= 1) {
            // 1 point fallback - assume standard gap
            // But we should use the point's Y as reference
            const first = validPoints[0];
            const defaultGap = 65;
            const calcFirstY = first.y - ((first.rank - 1) * defaultGap);
            alignedLayout = { firstY: calcFirstY, gap: defaultGap };
        }

        // 3. Merge Coords into Main Challenges
        const merged = mainChallenges.map(c => {
            const rank = parseInt(c.rank);
            let bbox;

            // Use Aligned Layout if available
            let targetY = 0;
            if (alignedLayout) {
                targetY = alignedLayout.firstY + (rank - 1) * alignedLayout.gap;
            } else {
                // Fallback to Crop individual coord or formula
                const match = cropChallenges.find(cc => parseInt(cc.rank) === rank);
                if (match) {
                    targetY = match.rank_number_center_y * cropScale;
                }
            }

            if (targetY > 0) {
                bbox = getThumbnailBBoxFromRankCenter(rank, targetY, 375);
            } else {
                bbox = getThumbnailBBoxByRank(rank, 375); // Fallback to formula
            }

            return {
                ...c,
                thumbnail_bbox: bbox,
                cover_url: cropUrl, // Use Crop Image
                isNew: true
            };
        });

        return checkExistingChallenges(merged, cropUrl);

    } catch (e) {
        Logger.log('❌ Dual Analysis Error: ' + e.message);
        throw e;
    }
}

function parseJsonSafe(text) {
    try {
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
        // Try strict object matching
        const objs = text.match(/\{[^{}]*\}/g);
        if (objs) return JSON.parse('[' + objs.join(',') + ']');
        return [];
    } catch (e) {
        Logger.log('JSON Parse Failed: ' + text.substring(0, 100));
        return [];
    }
}

/**
 * 스크린샷을 Google Drive에 저장하고 공개 URL 반환
 */
function saveScreenshotToDrive(imageBase64) {
    // douyinScreenshots 폴더 찾기 또는 생성
    let folder;
    const folderName = 'douyinScreenshots';
    const folders = DriveApp.getFoldersByName(folderName);

    if (folders.hasNext()) {
        folder = folders.next();
    } else {
        folder = DriveApp.createFolder(folderName);
    }

    // 🔥 Base64 헤더 제거 (data:image/jpeg;base64, 부분 제거)
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    // Base64 디코딩 후 파일 생성
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), 'image/jpeg', `ranking_${new Date().getTime()}.jpg`);
    const file = folder.createFile(blob);

    // 모든 사용자에게 공개
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // 🔥 thumbnail URL 형식 사용 (CORS 문제 해결)
    // uc?id= 형식은 외부 웹페이지에서 차단되므로 thumbnail 형식 사용
    const fileId = file.getId();
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w2000`;
}

/**
 * 기존 챌린지 체크 (중복 방지) + 스크린샷 URL 할당
 */
function checkExistingChallenges(challenges, screenshotUrl) {
    // 각 챌린지에 스크린샷 URL 할당 (전체 이미지)
    challenges.forEach(c => {
        c.cover_url = screenshotUrl || '';
    });

    const sheet = SpreadsheetApp.getActiveSpreadsheet()
        .getSheetByName(DOUYIN_CONFIG.SHEETS.CHALLENGE);

    if (!sheet || sheet.getLastRow() <= 1) {
        return challenges.map(c => ({ ...c, isNew: true }));
    }

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const titleIdx = headers.indexOf('title_zh');

    if (titleIdx < 0) {
        return challenges.map(c => ({ ...c, isNew: true }));
    }

    const existingTitles = new Set(
        data.slice(1).map(row => row[titleIdx]).filter(Boolean)
    );

    return challenges.map(c => ({
        ...c,
        isNew: !existingTitles.has(c.title_zh)
    }));
}

/**
 * 챌린지 저장 (웹앱에서 호출)
 */
function saveChallenges(challenges) {
    let newCount = 0;
    let updatedCount = 0;

    const newItems = challenges.filter(c => c.isNew);
    const existingItems = challenges.filter(c => !c.isNew);

    Logger.log(`📝 저장 시작: 신규 ${newItems.length}개, 기존 ${existingItems.length}개`);

    // 신규 항목 처리
    for (const item of newItems) {
        // video_share_text 파싱
        const videoInfo = parseVideoShareText(item.video_share_text || '');
        Object.assign(item, videoInfo);

        // participants 변환
        item.participants = parseChineseNumber(item.participants_raw);

        // Gemini 요약 생성
        try {
            const summary = generateChallengeSummary(item.title_zh, item.participants);
            item.title_ko = summary.title_ko || item.title_zh;
            item.summary_ko = summary.summary_ko || '';
            item.trend_reason = summary.trend_reason || '';
            Utilities.sleep(1200); // API 레이트 리밋 방지
        } catch (e) {
            Logger.log('⚠️ 요약 생성 실패 (' + item.title_zh + '): ' + e.message);
            item.title_ko = item.title_zh;
            item.summary_ko = '';
            item.trend_reason = '';
        }

        item.status = 'new';
        item.first_seen_at = new Date();
        item.last_updated_at = new Date();

        newCount++;
        Logger.log(`✅ 신규: ${item.rank}위 ${item.title_zh}`);
    }

    // 기존 항목 순위 업데이트
    for (const item of existingItems) {
        item.participants = parseChineseNumber(item.participants_raw);
        updatedCount++;
    }

    // 시트에 저장
    saveWebAppData(challenges);

    // 히스토리 저장
    saveToHistory(challenges.map(c => ({
        rank: c.rank,
        title_zh: c.title_zh,
        participants: c.participants || parseChineseNumber(c.participants_raw)
    })));

    // 캐시 무효화
    CacheService.getScriptCache().remove('douyin_challenges');

    Logger.log(`✅ 저장 완료: 신규 ${newCount}개, 업데이트 ${updatedCount}개`);

    return { newCount, updatedCount };
}

/**
 * 웹앱 데이터 시트 저장
 * 🔥 AI 좌표 추출 방식: 썸네일 바운딩 박스 좌표도 함께 저장
 */
function saveWebAppData(newData) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet()
        .getSheetByName(DOUYIN_CONFIG.SHEETS.CHALLENGE);

    if (!sheet) {
        throw new Error('douyin_challenge 시트를 찾을 수 없습니다.');
    }

    // 🔥 좌표 컬럼 추가 (thumb_x, thumb_y, thumb_w, thumb_h)
    const headers = ['rank', 'title_zh', 'title_ko', 'participants',
        'cover_url',
        'thumb_x', 'thumb_y', 'thumb_w', 'thumb_h',  // 좌표 컬럼
        'challenge_url', 'video_url',
        'summary_ko', 'trend_reason', 'status',
        'first_seen_at', 'last_updated_at'];

    // 기존 데이터 로드
    const existingData = sheet.getLastRow() > 1
        ? sheet.getDataRange().getValues().slice(1)
        : [];
    const existingHeaders = sheet.getLastRow() > 0
        ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
        : [];

    // 기존 데이터 맵
    const existingMap = new Map();
    existingData.forEach(row => {
        const titleIdx = existingHeaders.indexOf('title_zh');
        if (titleIdx >= 0 && row[titleIdx]) {
            const obj = {};
            existingHeaders.forEach((h, i) => obj[h] = row[i]);
            existingMap.set(row[titleIdx], obj);
        }
    });

    // 새 스크린샷 URL 찾기 (첫 번째 항목의 cover_url에서)
    const newScreenshotUrl = newData.find(item =>
        item.cover_url && item.cover_url.includes('drive.google.com')
    )?.cover_url || '';

    const now = new Date();
    const rows = newData.map(item => {
        const existing = existingMap.get(item.title_zh);
        const bbox = item.thumbnail_bbox || {};

        // 새 스크린샷이 있으면 모든 항목에 적용, 없으면 기존 URL 유지
        const coverUrl = newScreenshotUrl || (existing ? existing.cover_url : '') || '';

        // 🔥 좌표 데이터 추출 (AI가 새로 추출했으면 사용, 아니면 기존 유지)
        const thumbX = bbox.x || (existing ? existing.thumb_x : 0) || 0;
        const thumbY = bbox.y || (existing ? existing.thumb_y : 0) || 0;
        const thumbW = bbox.width || (existing ? existing.thumb_w : 48) || 48;
        const thumbH = bbox.height || (existing ? existing.thumb_h : 48) || 48;

        if (existing && !item.isNew) {
            // 기존 항목: 순위 업데이트 + 새 좌표 적용
            return [
                item.rank,
                item.title_zh,
                existing.title_ko || '',
                item.participants || existing.participants,
                coverUrl,
                thumbX, thumbY, thumbW, thumbH,  // 좌표
                existing.challenge_url || item.video_url || '',
                item.video_url || existing.video_url || '',
                existing.summary_ko || '',
                existing.trend_reason || '',
                detectStatusFromRank(item.rank, existing.rank),
                existing.first_seen_at || now,
                now
            ];
        } else {
            // 신규 항목
            return [
                item.rank,
                item.title_zh,
                item.title_ko || '',
                item.participants || parseChineseNumber(item.participants_raw),
                coverUrl,
                thumbX, thumbY, thumbW, thumbH,  // 좌표
                item.video_url || '',
                item.video_url || '',
                item.summary_ko || '',
                item.trend_reason || '',
                'new',
                now,
                now
            ];
        }
    });

    // 시트 초기화 및 쓰기
    sheet.clear();
    sheet.appendRow(headers);
    if (rows.length > 0) {
        sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }

    Logger.log(`📝 좌표 포함 ${rows.length}개 항목 저장 (스크린샷: ${newScreenshotUrl ? '갱신' : '유지'})`);
}

/**
 * 순위 변동 상태 감지
 */
function detectStatusFromRank(newRank, oldRank) {
    if (!oldRank) return 'new';
    if (newRank < oldRank) return 'rising';
    if (newRank > oldRank) return 'falling';
    return 'stable';
}

// ========================================
// 📝 기존 항목 URL 수정 기능
// ========================================

/**
 * 기존 챌린지 목록 조회 (URL 수정용)
 */
function getExistingChallengesForEdit() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet()
        .getSheetByName(DOUYIN_CONFIG.SHEETS.CHALLENGE);

    if (!sheet || sheet.getLastRow() <= 1) {
        return [];
    }

    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    return data.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => obj[h] = row[i]);
        return {
            rank: obj.rank,
            title_zh: obj.title_zh,
            title_ko: obj.title_ko || '',
            participants: obj.participants,
            video_url: obj.video_url || '',
            summary_ko: obj.summary_ko || ''
        };
    }).filter(c => c.rank && c.title_zh)
        .sort((a, b) => a.rank - b.rank);
}

/**
 * 기존 항목 URL 업데이트
 */
function updateExistingUrls(updates) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet()
        .getSheetByName(DOUYIN_CONFIG.SHEETS.CHALLENGE);

    if (!sheet || sheet.getLastRow() <= 1) {
        throw new Error('douyin_challenge 시트를 찾을 수 없습니다.');
    }

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const titleIdx = headers.indexOf('title_zh');
    const videoUrlIdx = headers.indexOf('video_url');
    const challengeUrlIdx = headers.indexOf('challenge_url');
    const updatedAtIdx = headers.indexOf('last_updated_at');

    if (videoUrlIdx < 0) {
        throw new Error('video_url 컬럼을 찾을 수 없습니다.');
    }

    // 업데이트 맵 생성
    const updateMap = new Map();
    updates.forEach(u => {
        const videoInfo = parseVideoShareText(u.video_share_text || '');
        if (videoInfo.video_url) {
            updateMap.set(u.title_zh, videoInfo.video_url);
        }
    });

    let updatedCount = 0;
    const now = new Date();

    // 각 행 업데이트
    for (let i = 1; i < data.length; i++) {
        const title = data[i][titleIdx];
        if (updateMap.has(title)) {
            const newUrl = updateMap.get(title);
            sheet.getRange(i + 1, videoUrlIdx + 1).setValue(newUrl);
            if (challengeUrlIdx >= 0) {
                sheet.getRange(i + 1, challengeUrlIdx + 1).setValue(newUrl);
            }
            if (updatedAtIdx >= 0) {
                sheet.getRange(i + 1, updatedAtIdx + 1).setValue(now);
            }
            updatedCount++;
            Logger.log(`✅ URL 업데이트: ${title} → ${newUrl}`);
        }
    }

    // 캐시 무효화
    CacheService.getScriptCache().remove('douyin_challenges');

    Logger.log(`📝 ${updatedCount}개 URL 업데이트 완료`);
    return { updatedCount };
}

/**
 * 듀얼 모드 분석 (Main: 텍스트 + Crop: 비율 기반 좌표 계산)
 * 🔥 User Formula 적용 (AI 좌표 추출 안함)
 */
function analyzeDualImagesRatio(mainBase64, cropBase64) {
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');

    // 1. Crop 이미지 저장 (썸네일용)
    let cropUrl = '';
    let cropWidth = 150; // 기본값
    try {
        cropUrl = saveScreenshotToDrive(cropBase64);
        const bytes = Utilities.base64Decode(cropBase64);
        const dims = getJpegDimensions(bytes);
        if (dims && dims.width > 0) cropWidth = dims.width;
        Logger.log(`📸 Crop 이미지 저장됨 (${cropWidth}px): ${cropUrl}`);
    } catch (e) { Logger.log('⚠️ Crop 저장 실패: ' + e.message); }

    // 2. Main 이미지만 AI 분석 (텍스트 추출)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

    // Main Prompt (Text Only)
    const mainPrompt = `이 도우인 랭킹 스크린샷에서 텍스트 정보를 추출하세요.
좌표는 필요 없습니다.

응답 형식 (JSON):
[{"rank": 1, "title_zh": "...", "participants_raw": "..."}]

규칙:
- rank, title_zh, participants_raw 필수
- JSON만 응답`;

    const payload = {
        contents: [{ parts: [{ text: mainPrompt }, { inline_data: { mime_type: "image/jpeg", data: mainBase64 } }] }],
        generationConfig: { temperature: 0.05, maxOutputTokens: 5000 }
    };

    try {
        const response = UrlFetchApp.fetch(url, {
            method: 'POST',
            contentType: 'application/json',
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
        });

        const json = JSON.parse(response.getContentText());
        if (json.error) throw new Error('Main OCR Error: ' + json.error.message);

        // Parse Main (Text)
        let mainText = json.candidates[0].content.parts[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
        let mainChallenges = parseJsonSafe(mainText);

        Logger.log(`📸 Main OCR Result: ${mainChallenges.length}개 추출됨`);

        // 3. 비율 기반 좌표 계산 (Crop 이미지 전용)
        // 🔥 크롭 이미지의 실제 너비(cropWidth)를 기준으로 계산
        const R = THUMB_LAYOUT_RATIO.CROP;
        const W = cropWidth;

        const thumbX = Math.round(W * R.thumbXRatio);
        const thumbY0 = Math.round(W * R.thumbY0Ratio);
        const thumbSize = Math.round(W * R.thumbSizeRatio);
        const rowGap = Math.round(W * R.rowGapRatio);

        Logger.log(`📏 Crop Layout (w=${W}): X=${thumbX}, Y0=${thumbY0}, Size=${thumbSize}, Gap=${rowGap}`);

        // Merge Calculated Coords into Main Challenges
        const merged = mainChallenges.map(c => {
            const rank = parseInt(c.rank);

            // Calculate BBox for this rank on the Crop Image
            const bbox = getThumbnailBBoxByRank(rank, cropWidth, 'CROP');

            return {
                ...c,
                thumbnail_bbox: bbox,
                cover_url: cropUrl, // Use Crop Image
                isNew: true
            };
        });

        return checkExistingChallenges(merged, cropUrl);

    } catch (e) {
        Logger.log('❌ Ratio Analysis Error: ' + e.message);
        throw e;
    }
}

/**
 * 듀얼 모드 분석 (Main: 텍스트 + Crop: 밝기 분석 기반 좌표 계산)
 * 🔥 v2: 20등분 + 왼쪽 숫자 영역 자동 제거 방식 적용
 */
function analyzeDualImagesRatioV2(mainBase64, cropBase64) {
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');

    // 1. Crop 이미지 저장 및 크기 감지
    let cropUrl = '';
    let cropWidth = 150;
    let cropHeight = 2000;
    try {
        cropUrl = saveScreenshotToDrive(cropBase64);
        const bytes = Utilities.base64Decode(cropBase64);
        const dims = getJpegDimensions(bytes);
        if (dims && dims.width > 0) {
            cropWidth = dims.width;
            cropHeight = dims.height;
        }
        Logger.log(`📸 Crop 이미지 저장됨 (${cropWidth}x${cropHeight}): ${cropUrl}`);
    } catch (e) { Logger.log('⚠️ Crop 저장 실패: ' + e.message); }

    // 2. Main 이미지만 AI 분석 (텍스트 추출)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

    const mainPrompt = `이 도우인 랭킹 스크린샷에서 텍스트 정보를 추출하세요.
좌표는 필요 없습니다.

응답 형식 (JSON):
[{"rank": 1, "title_zh": "...", "participants_raw": "..."}]

규칙:
- rank, title_zh, participants_raw 필수
- JSON만 응답`;

    const payload = {
        contents: [{ parts: [{ text: mainPrompt }, { inline_data: { mime_type: "image/jpeg", data: mainBase64 } }] }],
        generationConfig: { temperature: 0.05, maxOutputTokens: 5000 }
    };

    try {
        const response = UrlFetchApp.fetch(url, {
            method: 'POST',
            contentType: 'application/json',
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
        });

        const json = JSON.parse(response.getContentText());
        if (json.error) throw new Error('Main OCR Error: ' + json.error.message);

        let mainText = json.candidates[0].content.parts[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
        let mainChallenges = parseJsonSafe(mainText);

        Logger.log(`📸 Main OCR Result: ${mainChallenges.length}개 추출됨`);

        // 🔥 3. 밝기 분석 기반 좌표 계산 (20등분 + 왼쪽 숫자 제거)
        // 핵심 공식:
        // - 세로: H ÷ 20 = 각 행의 높이
        // - 가로: 왼쪽 약 48.7%는 숫자 영역, 나머지가 썸네일

        const unitHeight = cropHeight / 20;

        // 🔥 왼쪽 숫자 영역 비율 (테스트 결과: 150px 이미지에서 x=73 → 48.7%)
        const LEFT_NUMBER_RATIO = 0.487;
        const thumbStartX = Math.round(cropWidth * LEFT_NUMBER_RATIO);
        const thumbWidth = cropWidth - thumbStartX;

        Logger.log(`📏 Crop Layout (${cropWidth}x${cropHeight}): unitH=${unitHeight.toFixed(1)}, thumbX=${thumbStartX}, thumbW=${thumbWidth}`);

        // Merge Calculated Coords into Main Challenges
        const merged = mainChallenges.map(c => {
            const rank = parseInt(c.rank);

            // 🔥 20등분 기반 Y 좌표 계산
            const yStart = Math.round((rank - 1) * unitHeight);
            const yEnd = Math.round(rank * unitHeight);

            const bbox = {
                x: thumbStartX,
                y: yStart,
                width: thumbWidth,
                height: yEnd - yStart
            };

            return {
                ...c,
                thumbnail_bbox: bbox,
                cover_url: cropUrl,
                isNew: true
            };
        });

        return checkExistingChallenges(merged, cropUrl);

    } catch (e) {
        Logger.log('❌ Ratio Analysis Error: ' + e.message);
        throw e;
    }
}
