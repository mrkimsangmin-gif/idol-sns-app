/**
 * smoke_cdp_check.mjs
 * 
 * Chrome CDP(Chrome DevTools Protocol) 기반 초고속 무클릭 스모크 테스트 엔진
 * - 무거운 Playwright 러너 없이 2~3초 만에 핵심 페이지 렌더링 및 UI 무결성 검증
 * - 포트 9222가 열려있으면 즉시 연결, 없으면 경량 headless Chrome을 임시 구동하여 검증
 */

import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

class CDPClient extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.pending = new Map();
    this.nextId = 0;
    socket.addEventListener('message', event => {
      try {
        const message = JSON.parse(event.data);
        if (message.id) {
          const p = this.pending.get(message.id);
          if (!p) return;
          this.pending.delete(message.id);
          clearTimeout(p.timer);
          if (message.error) p.reject(new Error(`CDP ${message.error.code}: ${message.error.message}`));
          else p.resolve(message.result);
        } else {
          this.emit(message.method, message);
        }
      } catch {}
    });
    socket.addEventListener('close', () => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('cdp_closed'));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}, sessionId = undefined) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout:${method}`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getOrLaunchChrome() {
  try {
    const res = await fetch('http://127.0.0.1:9222/json/version', { signal: AbortSignal.timeout(1000) });
    if (res.ok) {
      const data = await res.json();
      return { wsUrl: data.webSocketDebuggerUrl, spawned: null };
    }
  } catch {}

  const chromePath = CHROME_PATHS.find(p => existsSync(p));
  if (!chromePath) {
    throw new Error('Chrome 실행 파일을 찾을 수 없습니다.');
  }

  console.log(`[CDP] 백그라운드 Chrome 기동 중... (${chromePath})`);
  const proc = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + process.env.TEMP + '\\chrome_cdp_e2e_profile'
  ], { stdio: 'ignore', detached: false });

  for (let i = 0; i < 20; i++) {
    await sleep(250);
    try {
      const res = await fetch('http://127.0.0.1:9222/json/version', { signal: AbortSignal.timeout(500) });
      if (res.ok) {
        const data = await res.json();
        return { wsUrl: data.webSocketDebuggerUrl, spawned: proc };
      }
    } catch {}
  }
  throw new Error('Chrome CDP 포트 9222 연결에 실패했습니다.');
}

async function runSmokeCheck() {
  const startTime = Date.now();
  console.log('====================================================');
  console.log('🚀 aimcontents.com CDP 초고속 스모크 테스트 시작');
  console.log('====================================================');

  const { wsUrl, spawned } = await getOrLaunchChrome();
  const socket = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    socket.addEventListener('open', res);
    socket.addEventListener('error', rej);
  });
  const cdp = new CDPClient(socket);

  try {
    // 새 탭 생성
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

    // Page 및 Runtime 활성화
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);

    console.log('[1/4] https://aimcontents.com 로드 중...');
    await cdp.send('Page.navigate', { url: 'https://aimcontents.com' }, sessionId);

    // DOM 렌더링 완료 대기 (최대 5초 폴링)
    let ready = false;
    for (let i = 0; i < 20; i++) {
      const evalRes = await cdp.send('Runtime.evaluate', {
        expression: 'document.readyState === "complete" && !!document.querySelector("h1, h2")'
      }, sessionId);
      if (evalRes.result?.value === true) {
        ready = true;
        break;
      }
      await sleep(200);
    }
    console.log(`[2/4] DOM 렌더링 준비 완료 (${ready ? '정상' : '타임아웃 경고'})`);

    console.log('[3/4] 주요 섹션 및 셀렉터 무결성 전수 검증 중...');
    const checks = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const results = [];
        
        // 1. 타이틀 검증
        const title = document.title;
        results.push({ name: '타이틀 존재', pass: !!title && title.length > 3, detail: title });

        // 2. 도우인 인기 챌린지 h2 검증
        const h2Elements = Array.from(document.querySelectorAll('h2'));
        const douyinH2 = h2Elements.find(el => el.textContent.includes('중국 도우인 인기 챌린지'));
        results.push({ name: '도우인 챌린지 H2 헤더', pass: !!douyinH2, detail: douyinH2 ? douyinH2.textContent.trim() : '미발견' });

        // 3. 도우인 바로가기 링크 검증
        const douyinLink = document.querySelector('a[href*="/douyin"]');
        results.push({ name: '도우인 상세 링크(a[href*=/douyin])', pass: !!douyinLink, detail: douyinLink ? douyinLink.textContent.trim() : '미발견' });

        // 4. 엔터테인먼트 채용정보 섹션 검증
        const jobH2 = h2Elements.find(el => el.textContent.includes('엔터테인먼트 채용정보'));
        results.push({ name: '채용정보 H2 헤더', pass: !!jobH2, detail: jobH2 ? jobH2.textContent.trim() : '미발견' });

        // 5. SNS 랭킹 섹션 (h1 및 genderDropdown) 검증
        const snsH1 = document.querySelector('h1')?.textContent.includes('SNS 팔로워 순위');
        const genderDropdown = !!document.querySelector('#genderDropdown');
        results.push({ name: 'SNS 팔로워 순위 H1 & 드롭다운', pass: snsH1 && genderDropdown, detail: snsH1 ? 'H1 & #genderDropdown 정상' : '미발견' });

        // 6. 전체 H2 개수
        results.push({ name: '전체 H2 섹션 개수', pass: h2Elements.length >= 3, detail: h2Elements.length + '개 발견' });

        return results;
      })()`
    }, sessionId);

    console.log('\n================ 검증 결과 요약 ================');
    let allPass = true;
    for (const item of checks.result.value) {
      const mark = item.pass ? '✅ PASS' : '❌ FAIL';
      if (!item.pass) allPass = false;
      console.log(`${mark} | ${item.name.padEnd(30)} : ${item.detail}`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('====================================================');
    if (allPass) {
      console.log(`🎉 [SUCCESS] 모든 스모크 테스트 통과 완료! (총 소요시간: ${duration}초)`);
    } else {
      console.error(`⚠️ [FAILED] 일부 검증 항목에 실패가 발견되었습니다. (총 소요시간: ${duration}초)`);
    }

    // 타겟 정리
    await cdp.send('Target.closeTarget', { targetId });
    socket.close();

    if (spawned) {
      spawned.kill();
    }

    return allPass;
  } catch (err) {
    console.error(`[CDP Error] ${err.message}`);
    socket.close();
    if (spawned) spawned.kill();
    return false;
  }
}

runSmokeCheck().then(success => {
  process.exit(success ? 0 : 1);
});
