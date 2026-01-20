/**
 * IndexedDB 유틸리티 모듈
 * 
 * 기능:
 * - SNS 데이터 영구 캐싱 (24시간 TTL)
 * - 아이돌 메타데이터 캐싱
 * - 자동 만료 및 정리
 * 
 * 버전: 1.0
 */

const DB_NAME = 'idol-sns-db';
const DB_VERSION = 2;
const STORE_SNS_DATA = 'sns_data';
const STORE_METADATA = 'metadata';
const STORE_MONTHS = 'months';
const STORE_LINKS = 'links';

// TTL 설정 (밀리초)
const TTL_SNS_DATA = 24 * 60 * 60 * 1000; // 24시간
const TTL_METADATA = 7 * 24 * 60 * 60 * 1000; // 7일
const TTL_MONTHS = 6 * 60 * 60 * 1000; // 6시간
const TTL_LINKS = 6 * 60 * 60 * 1000; // 6시간

/**
 * IndexedDB 초기화 및 연결
 * @returns {Promise<IDBDatabase>}
 */
async function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('❌ IndexedDB 열기 실패:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      console.log('✅ IndexedDB 연결 성공');
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      console.log('🔧 IndexedDB 스키마 업그레이드 중...');

      // SNS 데이터 스토어 생성
      if (!db.objectStoreNames.contains(STORE_SNS_DATA)) {
        const snsStore = db.createObjectStore(STORE_SNS_DATA, { keyPath: 'key' });
        snsStore.createIndex('timestamp', 'timestamp', { unique: false });
        console.log('✅ sns_data 스토어 생성 완료');
      }

      // 메타데이터 스토어 생성
      if (!db.objectStoreNames.contains(STORE_METADATA)) {
        const metaStore = db.createObjectStore(STORE_METADATA, { keyPath: 'key' });
        metaStore.createIndex('timestamp', 'timestamp', { unique: false });
        console.log('✅ metadata 스토어 생성 완료');
      }

      // 월 목록 스토어 생성
      if (!db.objectStoreNames.contains(STORE_MONTHS)) {
        const monthsStore = db.createObjectStore(STORE_MONTHS, { keyPath: 'key' });
        monthsStore.createIndex('timestamp', 'timestamp', { unique: false });
        console.log('✅ months 스토어 생성 완료');
      }

      // 링크 데이터 스토어 생성
      if (!db.objectStoreNames.contains(STORE_LINKS)) {
        const linksStore = db.createObjectStore(STORE_LINKS, { keyPath: 'key' });
        linksStore.createIndex('timestamp', 'timestamp', { unique: false });
        console.log('✅ links 스토어 생성 완료');
      }
    };
  });
}

/**
 * SNS 데이터 저장
 * @param {string} gender - 성별 (남자/여자)
 * @param {string} sns - SNS 종류
 * @param {string} month - 월 (yyyy-MM)
 * @param {Array} data - 아이돌 데이터 배열
 * @returns {Promise<void>}
 */
async function saveSnsData(gender, sns, month, data) {
  const db = await openDatabase();
  const key = `${gender}_${sns}_${month}`;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_SNS_DATA], 'readwrite');
    const store = transaction.objectStore(STORE_SNS_DATA);

    const record = {
      key,
      gender,
      sns,
      month,
      data,
      timestamp: Date.now(),
      ttl: TTL_SNS_DATA
    };

    const request = store.put(record);

    request.onsuccess = () => {
      console.log(`💾 IndexedDB 저장 성공: ${key} (${data.length}개 항목)`);
      resolve();
    };

    request.onerror = () => {
      console.error(`❌ IndexedDB 저장 실패: ${key}`, request.error);
      reject(request.error);
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * SNS 데이터 조회 (TTL 확인 포함)
 * @param {string} gender - 성별
 * @param {string} sns - SNS 종류
 * @param {string} month - 월
 * @returns {Promise<Array|null>} - 데이터 배열 또는 null (만료/없음)
 */
async function getSnsData(gender, sns, month) {
  const db = await openDatabase();
  const key = `${gender}_${sns}_${month}`;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_SNS_DATA], 'readonly');
    const store = transaction.objectStore(STORE_SNS_DATA);
    const request = store.get(key);

    request.onsuccess = () => {
      const record = request.result;

      if (!record) {
        console.log(`📭 IndexedDB 캐시 미스: ${key}`);
        resolve(null);
        return;
      }

      // TTL 확인
      const age = Date.now() - record.timestamp;
      if (age > record.ttl) {
        console.log(`⏰ IndexedDB 캐시 만료: ${key} (${Math.round(age / 3600000)}시간 경과)`);
        // 만료된 데이터 삭제
        deleteSnsData(gender, sns, month);
        resolve(null);
        return;
      }

      console.log(`⚡ IndexedDB 캐시 히트: ${key} (${record.data.length}개 항목)`);
      resolve(record.data);
    };

    request.onerror = () => {
      console.error(`❌ IndexedDB 조회 실패: ${key}`, request.error);
      reject(request.error);
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * SNS 데이터 삭제
 * @param {string} gender - 성별
 * @param {string} sns - SNS 종류
 * @param {string} month - 월
 * @returns {Promise<void>}
 */
async function deleteSnsData(gender, sns, month) {
  const db = await openDatabase();
  const key = `${gender}_${sns}_${month}`;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_SNS_DATA], 'readwrite');
    const store = transaction.objectStore(STORE_SNS_DATA);
    const request = store.delete(key);

    request.onsuccess = () => {
      console.log(`🗑️ IndexedDB 삭제 성공: ${key}`);
      resolve();
    };

    request.onerror = () => {
      console.error(`❌ IndexedDB 삭제 실패: ${key}`, request.error);
      reject(request.error);
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * 월 목록 저장
 * @param {string} gender - 성별
 * @param {string} sns - SNS 종류
 * @param {Array<string>} months - 월 목록
 * @returns {Promise<void>}
 */
async function saveMonths(gender, sns, months) {
  const db = await openDatabase();
  const key = `${gender}_${sns}`;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_MONTHS], 'readwrite');
    const store = transaction.objectStore(STORE_MONTHS);

    const record = {
      key,
      gender,
      sns,
      months,
      timestamp: Date.now(),
      ttl: TTL_MONTHS
    };

    const request = store.put(record);

    request.onsuccess = () => {
      console.log(`💾 월 목록 저장: ${key} (${months.length}개월)`);
      resolve();
    };

    request.onerror = () => {
      console.error(`❌ 월 목록 저장 실패: ${key}`, request.error);
      reject(request.error);
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * 월 목록 조회
 * @param {string} gender - 성별
 * @param {string} sns - SNS 종류
 * @returns {Promise<Array<string>|null>}
 */
async function getMonths(gender, sns) {
  const db = await openDatabase();
  const key = `${gender}_${sns}`;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_MONTHS], 'readonly');
    const store = transaction.objectStore(STORE_MONTHS);
    const request = store.get(key);

    request.onsuccess = () => {
      const record = request.result;

      if (!record) {
        console.log(`📭 월 목록 캐시 미스: ${key}`);
        resolve(null);
        return;
      }

      // TTL 확인
      const age = Date.now() - record.timestamp;
      if (age > record.ttl) {
        console.log(`⏰ 월 목록 캐시 만료: ${key}`);
        resolve(null);
        return;
      }

      console.log(`⚡ 월 목록 캐시 히트: ${key} (${record.months.length}개월)`);
      resolve(record.months);
    };

    request.onerror = () => {
      console.error(`❌ 월 목록 조회 실패: ${key}`, request.error);
      reject(request.error);
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * 메타데이터 저장
 * @param {string} name - 아이돌 이름
 * @param {string} gender - 성별
 * @param {Object} metadata - 메타데이터
 * @returns {Promise<void>}
 */
async function saveMetadata(name, gender, metadata) {
  const db = await openDatabase();
  const key = `${name}_${gender}`;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_METADATA], 'readwrite');
    const store = transaction.objectStore(STORE_METADATA);

    const record = {
      key,
      name,
      gender,
      metadata,
      timestamp: Date.now(),
      ttl: TTL_METADATA
    };

    const request = store.put(record);

    request.onsuccess = () => {
      console.log(`💾 메타데이터 저장: ${key}`);
      resolve();
    };

    request.onerror = () => {
      console.error(`❌ 메타데이터 저장 실패: ${key}`, request.error);
      reject(request.error);
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * 메타데이터 조회
 * @param {string} name - 아이돌 이름
 * @param {string} gender - 성별
 * @returns {Promise<Object|null>}
 */
async function getMetadata(name, gender) {
  const db = await openDatabase();
  const key = `${name}_${gender}`;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_METADATA], 'readonly');
    const store = transaction.objectStore(STORE_METADATA);
    const request = store.get(key);

    request.onsuccess = () => {
      const record = request.result;

      if (!record) {
        resolve(null);
        return;
      }

      // TTL 확인
      const age = Date.now() - record.timestamp;
      if (age > record.ttl) {
        console.log(`⏰ 메타데이터 만료: ${key}`);
        resolve(null);
        return;
      }

      console.log(`⚡ 메타데이터 히트: ${key}`);
      resolve(record.metadata);
    };

    request.onerror = () => {
      console.error(`❌ 메타데이터 조회 실패: ${key}`, request.error);
      reject(request.error);
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * 링크 데이터 저장
 * @param {Object} data - 링크 데이터
 * @returns {Promise<void>}
 */
async function saveLinksCache(data) {
  const db = await openDatabase();
  const key = 'kpop_links';

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_LINKS], 'readwrite');
    const store = transaction.objectStore(STORE_LINKS);

    const record = {
      key,
      data,
      timestamp: Date.now(),
      ttl: TTL_LINKS
    };

    const request = store.put(record);

    request.onsuccess = () => {
      console.log('💾 링크 캐시 저장 완료');
      resolve();
    };

    request.onerror = () => {
      console.error('❌ 링크 캐시 저장 실패:', request.error);
      reject(request.error);
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * 링크 데이터 조회
 * @returns {Promise<Object|null>}
 */
async function getLinksCache() {
  const db = await openDatabase();
  const key = 'kpop_links';

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_LINKS], 'readonly');
    const store = transaction.objectStore(STORE_LINKS);
    const request = store.get(key);

    request.onsuccess = () => {
      const record = request.result;

      if (!record) {
        console.log('📭 링크 캐시 미스');
        resolve(null);
        return;
      }

      // TTL 확인
      const age = Date.now() - record.timestamp;
      if (age > record.ttl) {
        console.log(`⏰ 링크 캐시 만료 (${Math.round(age / 3600000)}시간 경과)`);
        resolve(null);
        return;
      }

      console.log('⚡ 링크 캐시 히트!');
      resolve(record.data);
    };

    request.onerror = () => {
      console.error('❌ 링크 캐시 조회 실패:', request.error);
      reject(request.error);
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * 만료된 데이터 정리 (백그라운드 작업)
 * @returns {Promise<number>} - 삭제된 항목 수
 */
async function cleanupExpiredData() {
  const db = await openDatabase();
  let deletedCount = 0;

  console.log('🧹 만료된 캐시 정리 시작...');

  const stores = [STORE_SNS_DATA, STORE_METADATA, STORE_MONTHS, STORE_LINKS];

  for (const storeName of stores) {
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const index = store.index('timestamp');
    const request = index.openCursor();

    await new Promise((resolve) => {
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const record = cursor.value;
          const age = Date.now() - record.timestamp;

          if (age > record.ttl) {
            cursor.delete();
            deletedCount++;
            console.log(`🗑️ 만료 데이터 삭제: ${record.key}`);
          }

          cursor.continue();
        } else {
          resolve();
        }
      };
    });
  }

  db.close();
  console.log(`✅ 정리 완료: ${deletedCount}개 항목 삭제`);
  return deletedCount;
}

/**
 * 전체 캐시 초기화 (디버깅/테스트용)
 * @returns {Promise<void>}
 */
async function clearAllCache() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);

    request.onsuccess = () => {
      console.log('🗑️ IndexedDB 전체 삭제 완료');
      resolve();
    };

    request.onerror = () => {
      console.error('❌ IndexedDB 삭제 실패:', request.error);
      reject(request.error);
    };
  });
}

/**
 * 캐시 통계 조회
 * @returns {Promise<Object>} - 통계 정보
 */
async function getCacheStats() {
  const db = await openDatabase();
  const stats = {
    snsData: 0,
    metadata: 0,
    months: 0,
    totalSize: 0
  };

  const stores = [
    { name: STORE_SNS_DATA, key: 'snsData' },
    { name: STORE_METADATA, key: 'metadata' },
    { name: STORE_MONTHS, key: 'months' }
  ];

  for (const { name, key } of stores) {
    const transaction = db.transaction([name], 'readonly');
    const store = transaction.objectStore(name);
    const request = store.count();

    await new Promise((resolve) => {
      request.onsuccess = () => {
        stats[key] = request.result;
        resolve();
      };
    });
  }

  db.close();
  return stats;
}

// 페이지 로드 시 만료 데이터 자동 정리 (백그라운드)
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    // 10초 후 정리 시작 (초기 로딩 방해 방지)
    setTimeout(() => {
      cleanupExpiredData().catch(err => {
        console.error('캐시 정리 실패:', err);
      });
    }, 10000);
  });
}
