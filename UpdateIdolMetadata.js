/**
 * idol_metadata 시트 업데이트
 * 최신 월(또는 지정 월) 시트에서 메타데이터 추출하여 UPSERT
 * 
 * @param {string} sourceSheetName - 소스 시트 이름 (null이면 최신 월 자동 선택)
 * @param {string} gender - "여자" 또는 "남자"
 */
function updateIdolMetadata(sourceSheetName = null, gender = "여자") {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 최신 월 시트 찾기
    if (!sourceSheetName) {
        const monthSheets = ss.getSheets()
            .map(s => s.getName())
            .filter(n => /^\d{4}$/.test(n))  // YYMM 형식
            .sort();

        if (monthSheets.length === 0) {
            throw new Error('월별 시트(YYMM)를 찾을 수 없습니다.');
        }

        sourceSheetName = monthSheets[monthSheets.length - 1]; // 최신 월
    }

    Logger.log(`메타데이터 소스: ${sourceSheetName} (${gender})`);

    const source = ss.getSheetByName(sourceSheetName);
    if (!source) {
        throw new Error(`시트 ${sourceSheetName}을 찾을 수 없습니다.`);
    }

    // idol_metadata 시트 준비
    let meta = ss.getSheetByName("idol_metadata");
    if (!meta) {
        meta = ss.insertSheet("idol_metadata");
        meta.getRange(1, 1, 1, 14).setValues([[
            "name", "group", "gender", "namu_wiki",
            "weibo_link", "weibo_superchat_link", "x_link", "bilibili_link",
            "youtube_link", "qqmusic_link", "spotify_link",
            "label", "debut_year", "note"
        ]]);
        Logger.log('idol_metadata 시트 생성');
    }

    // 기존 데이터 읽기 (UPSERT를 위해)
    const existingData = meta.getDataRange().getValues();
    const existingMap = {}; // name -> 행 번호

    existingData.slice(1).forEach((row, idx) => {
        const nameKey = `${row[0]}_${row[2]}`; // name_gender 조합으로 키 생성
        existingMap[nameKey] = idx + 2; // 행 번호 (2부터 시작)
    });

    // 소스 시트에서 데이터 읽기
    const sourceValues = source.getDataRange().getValues();
    if (sourceValues.length < 2) {
        throw new Error(`${sourceSheetName} 시트에 데이터가 없습니다.`);
    }

    const headers = sourceValues[0].map(h => String(h).trim().toLowerCase().replace(/\s+/g, '_'));

    // 컬럼 인덱스 찾기 함수
    const getIdx = (name) => {
        const normalized = name.toLowerCase().replace(/\s+/g, '_');
        return headers.findIndex(h => h === normalized || h.includes(normalized));
    };

    const iName = getIdx("name_korean");
    const iGroup = getIdx("name_english");
    const iNamuWiki = getIdx("namuwiki");
    const iWeiboLink = getIdx("weibo_link");
    const iWeiboSuperLink = getIdx("weibo_superchat_link");
    const iXLink = getIdx("x_link");
    const iBilibiliLink = getIdx("bilibili_link");
    const iYoutubeLink = getIdx("youtube_link");
    const iQQLink = getIdx("qqmusic_link");
    const iSpotifyLink = getIdx("spotify_link");
    const iLabel = getIdx("label");
    const iDebutYear = getIdx("debut_year");
    const iNote = getIdx("note");

    if (iName === -1) {
        throw new Error('Name_Korean 컬럼을 찾을 수 없습니다.');
    }

    // 데이터 추출
    const updates = [];
    const newRows = [];

    for (let r = 1; r < sourceValues.length; r++) {
        const row = sourceValues[r];
        const name = row[iName];

        if (!name || String(name).trim() === '') continue;

        const nameStr = String(name).trim();
        const nameKey = `${nameStr}_${gender}`;

        const metaRow = [
            nameStr,
            (iGroup !== -1 && row[iGroup]) ? String(row[iGroup]).trim() : "",
            gender,
            (iNamuWiki !== -1 && row[iNamuWiki]) ? String(row[iNamuWiki]).trim() : "",
            (iWeiboLink !== -1 && row[iWeiboLink]) ? String(row[iWeiboLink]).trim() : "",
            (iWeiboSuperLink !== -1 && row[iWeiboSuperLink]) ? String(row[iWeiboSuperLink]).trim() : "",
            (iXLink !== -1 && row[iXLink]) ? String(row[iXLink]).trim() : "",
            (iBilibiliLink !== -1 && row[iBilibiliLink]) ? String(row[iBilibiliLink]).trim() : "",
            (iYoutubeLink !== -1 && row[iYoutubeLink]) ? String(row[iYoutubeLink]).trim() : "",
            (iQQLink !== -1 && row[iQQLink]) ? String(row[iQQLink]).trim() : "",
            (iSpotifyLink !== -1 && row[iSpotifyLink]) ? String(row[iSpotifyLink]).trim() : "",
            (iLabel !== -1 && row[iLabel]) ? String(row[iLabel]).trim() : "",
            (iDebutYear !== -1 && row[iDebutYear]) ? String(row[iDebutYear]).trim() : "",
            (iNote !== -1 && row[iNote]) ? String(row[iNote]).trim() : ""
        ];

        if (existingMap[nameKey]) {
            // 업데이트 (기존 행 덮어쓰기)
            const rowNum = existingMap[nameKey];
            updates.push({ row: rowNum, data: metaRow });
        } else {
            // 신규 추가
            newRows.push(metaRow);
        }
    }

    // 업데이트 적용
    updates.forEach(u => {
        meta.getRange(u.row, 1, 1, 14).setValues([u.data]);
    });

    // 신규 행 추가
    if (newRows.length > 0) {
        const lastRow = meta.getLastRow();
        meta.getRange(lastRow + 1, 1, newRows.length, 14).setValues(newRows);
    }

    // 편의 기능
    meta.setFrozenRows(1);  // 헤더 고정

    // 필터 설정
    const existingFilter = meta.getFilter();
    if (existingFilter) {
        existingFilter.remove();
    }
    if (meta.getLastRow() > 1) {
        meta.getRange(1, 1, meta.getLastRow(), 14).createFilter();
    }

    Logger.log(`✅ 완료: ${updates.length}개 업데이트, ${newRows.length}개 신규 추가`);

    SpreadsheetApp.getUi().alert(
        '메타데이터 업데이트 완료',
        `소스: ${sourceSheetName}\n` +
        `성별: ${gender}\n` +
        `업데이트: ${updates.length}개\n` +
        `신규: ${newRows.length}개`,
        SpreadsheetApp.getUi().ButtonSet.OK
    );
}

/**
 * 여자 아이돌 메타데이터 업데이트 (메뉴용)
 */
function updateGirlMetadata() {
    updateIdolMetadata(null, "여자");
}

/**
 * 남자 아이돌 메타데이터 업데이트 (메뉴용)
 */
function updateBoyMetadata() {
    updateIdolMetadata(null, "남자");
}

/**
 * 메뉴에 버튼 추가
 * 스프레드시트 열 때마다 자동 실행
 */
function onOpen() {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu('📊 데이터 관리')
        .addItem('✨ 메타데이터 업데이트 (여자)', 'updateGirlMetadata')
        .addItem('✨ 메타데이터 업데이트 (남자)', 'updateBoyMetadata')
        .addSeparator()
        .addItem('📋 실행 로그 보기', 'showLogs')
        .addToUi();
}

/**
 * 실행 로그 확인
 */
function showLogs() {
    const logs = Logger.getLog();
    const ui = SpreadsheetApp.getUi();
    ui.alert('실행 로그', logs || '로그가 없습니다.', ui.ButtonSet.OK);
}
