
// ========================================
// 📊 세션 분석 (체류 시간, 이탈 추적)
// ========================================

let sessionStartTime = Date.now();
let lastInteractionTime = Date.now();

// 사용자 인터랙션 감지
['click', 'scroll', 'keypress'].forEach(eventType => {
    document.addEventListener(eventType, () => {
        lastInteractionTime = Date.now();
    }, { passive: true });
});

// 페이지 언로드 시 세션 종료 이벤트 전송
window.addEventListener('beforeunload', () => {
    const sessionDuration = Math.round((Date.now() - sessionStartTime) / 1000); // 초 단위
    const engagementTime = Math.round((lastInteractionTime - sessionStartTime) / 1000);
    
    trackEvent('session_end', {
        session_duration: sessionDuration,
        engagement_time: engagementTime,
        event_category: 'engagement'
    });
});

// 5분마다 하트비트 이벤트 (장시간 체류 감지)
setInterval(() => {
    const elapsed = Math.round((Date.now() - sessionStartTime) / 60000); // 분 단위
    if (elapsed > 0 && elapsed % 5 === 0) {
        trackEvent('heartbeat', {
            minutes_elapsed: elapsed,
            event_category: 'engagement'
        });
    }
}, 60000); // 1분마다 체크
