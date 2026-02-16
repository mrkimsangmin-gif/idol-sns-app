// ========================================
// 🌐 i18n (다국어) 코어 모듈
// ========================================
// 경량 다국어 지원 모듈 (~3KB)
// - localStorage 기반 언어 저장
// - data-i18n 속성으로 DOM 자동 번역
// - t(key, params) 함수로 동적 문자열 번역
// - languageChanged 커스텀 이벤트로 동적 콘텐츠 재렌더링

(function() {
    'use strict';

    // 지원 언어 목록
    const SUPPORTED_LANGS = ['ko', 'en'];
    // localStorage 키
    const STORAGE_KEY = 'aimcontents_lang';
    // 기본 언어
    const DEFAULT_LANG = 'ko';

    // 번역 데이터 캐시 { ko: {...}, en: {...} }
    let translations = {};
    // 현재 언어
    let currentLang = DEFAULT_LANG;
    // 초기화 완료 여부
    let initialized = false;

    /**
     * 초기화: localStorage에서 언어 복원 + JSON 로드
     * DOMContentLoaded에서 호출
     */
    async function init() {
        // localStorage에서 저장된 언어 복원
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && SUPPORTED_LANGS.includes(saved)) {
            currentLang = saved;
        }

        // html lang 속성 즉시 설정 (FOUC 방지)
        document.documentElement.lang = currentLang;

        // 번역 JSON 로드
        try {
            // 현재 언어 먼저 로드 (즉시 적용)
            await loadTranslation(currentLang);

            // DOM에 적용
            applyToDOM();

            // 토글 버튼 텍스트 업데이트
            updateToggleButton();

            initialized = true;

            // 다른 언어는 백그라운드에서 프리로드
            const otherLang = currentLang === 'ko' ? 'en' : 'ko';
            loadTranslation(otherLang).catch(() => {}); // 실패해도 무시
        } catch (error) {
            console.warn('i18n 초기화 실패:', error);
            initialized = true; // 실패해도 동작은 유지 (한국어 폴백)
        }
    }

    /**
     * 특정 언어의 번역 JSON 로드
     * @param {string} lang - 언어 코드 ('ko' | 'en')
     */
    async function loadTranslation(lang) {
        // 이미 로드된 경우 스킵
        if (translations[lang]) return;

        const response = await fetch(`./lang/${lang}.json`);
        if (!response.ok) throw new Error(`Failed to load ${lang}.json`);
        translations[lang] = await response.json();
    }

    /**
     * 번역 키로 문자열 조회
     * @param {string} key - 점 구분 키 (예: 'nav.ranking')
     * @param {Object} params - 보간 파라미터 (예: {month: '25년1월'})
     * @returns {string} 번역된 문자열 (키가 없으면 키 자체 반환)
     */
    function t(key, params) {
        const langData = translations[currentLang] || translations[DEFAULT_LANG];
        if (!langData) return key; // JSON 로드 전이면 키 반환

        // 점 구분 키 탐색 (예: 'nav.ranking' → langData.nav.ranking)
        const value = key.split('.').reduce((obj, k) => {
            return obj && typeof obj === 'object' ? obj[k] : undefined;
        }, langData);

        if (value === undefined) return key; // 키가 없으면 키 자체 반환

        // 파라미터 보간 (예: '{month}' → 실제 값)
        if (params && typeof value === 'string') {
            return value.replace(/\{(\w+)\}/g, (_, name) => {
                return params[name] !== undefined ? params[name] : `{${name}}`;
            });
        }

        return value;
    }

    /**
     * 언어 변경 + DOM 전체 업데이트
     * @param {string} lang - 변경할 언어 코드
     */
    async function setLang(lang) {
        if (!SUPPORTED_LANGS.includes(lang)) return;
        if (lang === currentLang) return;

        // 번역 데이터가 없으면 로드
        if (!translations[lang]) {
            try {
                await loadTranslation(lang);
            } catch (error) {
                console.warn(`${lang} 번역 로드 실패:`, error);
                return;
            }
        }

        currentLang = lang;

        // localStorage에 저장
        localStorage.setItem(STORAGE_KEY, lang);

        // html lang 속성 업데이트
        document.documentElement.lang = lang;

        // DOM 전체 업데이트
        applyToDOM();

        // 토글 버튼 텍스트 업데이트
        updateToggleButton();

        // 커스텀 이벤트 디스패치 (script.js에서 동적 콘텐츠 재렌더링)
        window.dispatchEvent(new CustomEvent('languageChanged', {
            detail: { lang: lang }
        }));
    }

    /**
     * 현재 언어 반환
     * @returns {string} 'ko' | 'en'
     */
    function getLang() {
        return currentLang;
    }

    /**
     * 한/영 토글
     */
    function toggle() {
        const newLang = currentLang === 'ko' ? 'en' : 'ko';
        setLang(newLang);
    }

    /**
     * data-i18n 속성 기반 DOM 일괄 업데이트
     * - data-i18n="key" → textContent 교체
     * - data-i18n-html="key" → innerHTML 교체 (아이콘 포함)
     * - data-i18n-placeholder="key" → placeholder 교체
     * - data-i18n-aria="key" → aria-label 교체
     */
    function applyToDOM() {
        // textContent 교체
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const translated = t(key);
            if (translated !== key) { // 키와 다를 때만 교체
                el.textContent = translated;
            }
        });

        // innerHTML 교체 (아이콘 포함 텍스트용)
        document.querySelectorAll('[data-i18n-html]').forEach(el => {
            const key = el.getAttribute('data-i18n-html');
            const translated = t(key);
            if (translated !== key) {
                el.innerHTML = translated;
            }
        });

        // placeholder 교체
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            const translated = t(key);
            if (translated !== key) {
                el.placeholder = translated;
            }
        });

        // aria-label 교체
        document.querySelectorAll('[data-i18n-aria]').forEach(el => {
            const key = el.getAttribute('data-i18n-aria');
            const translated = t(key);
            if (translated !== key) {
                el.setAttribute('aria-label', translated);
            }
        });
    }

    /**
     * 토글 버튼 텍스트 업데이트
     * 현재 ko면 'ENG' 표시, en이면 '한국어' 표시
     */
    function updateToggleButton() {
        const btn = document.getElementById('langToggle');
        if (btn) {
            btn.textContent = currentLang === 'ko' ? 'ENG' : '한국어';
        }
    }

    // 전역 객체로 노출
    window.i18n = {
        init: init,
        t: t,
        setLang: setLang,
        getLang: getLang,
        toggle: toggle,
        applyToDOM: applyToDOM
    };
})();
