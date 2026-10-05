import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
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
  const cdpPort = 9333;
  try {
    const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, { signal: AbortSignal.timeout(1000) });
    if (res.ok) {
      const data = await res.json();
      return { wsUrl: data.webSocketDebuggerUrl, pid: null };
    }
  } catch {}

  const chromePath = CHROME_PATHS.find(p => existsSync(p));
  if (!chromePath) throw new Error('Chrome 실행 파일을 찾을 수 없습니다.');

  const proc = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + process.env.TEMP + '\\chrome_cdp_profile_' + cdpPort
  ], { stdio: 'ignore', detached: true });
  proc.unref();

  for (let i = 0; i < 20; i++) {
    await sleep(250);
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, { signal: AbortSignal.timeout(500) });
      if (res.ok) {
        return { wsUrl: (await res.json()).webSocketDebuggerUrl, pid: proc.pid };
      }
    } catch {}
  }
  throw new Error(`Chrome CDP 연결 실패`);
}

async function verifyComebackPageLive() {
  console.log('====================================================');
  console.log('🌐 [CDP] /comeback/ 실서버 UI 렌더링 무결성 검증');
  console.log('====================================================');

  const { wsUrl } = await getOrLaunchChrome();
  const socket = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    socket.addEventListener('open', res);
    socket.addEventListener('error', rej);
  });
  const cdp = new CDPClient(socket);

  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);

    console.log('1. https://aimcontents.com/comeback/ 페이지 로드 중...');
    await cdp.send('Page.navigate', { url: 'https://aimcontents.com/comeback/' }, sessionId);
    await sleep(2500);

    // 캘린더 그리드 및 이벤트 배지 개수 검증
    const evalGrid = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const title = document.title;
        const badges = Array.from(document.querySelectorAll('.cal-event-badge')).map(b => b.innerText.trim());
        const cards = Array.from(document.querySelectorAll('.cal-summary-card')).map(c => c.innerText.trim().replace(/\\n/g, ' '));
        return { title, badgeCount: badges.length, badges: badges.slice(0, 5), cards: cards.slice(0, 5) };
      })()`,
      returnByValue: true
    }, sessionId);

    const res = evalGrid.result?.value;
    console.log(`✅ 페이지 타이틀: ${res.title}`);
    console.log(`✅ 렌더링된 컴백 배지 수: ${res.badgeCount}개`);
    console.log(`✅ 상위 컴백 배지: ${res.badges.join(', ')}`);
    console.log(`✅ 라인업 카드 예시: ${res.cards[0] || '없음'}`);

    // 모달 클릭 테스트 (첫 번째 배지 클릭 시 모달 열림 여부)
    console.log('\n2. 컴백 상세 모달(Modal) 인터랙션 클릭 시뮬레이션...');
    const evalModal = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const firstBadge = document.querySelector('.cal-event-badge');
        if (firstBadge) {
          firstBadge.click();
          return true;
        }
        return false;
      })()`
    }, sessionId);

    await sleep(1000);
    const evalModalVisible = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const modal = document.getElementById('calEventModal');
        const modalTitle = document.getElementById('calModalTitle')?.innerText || '';
        const modalBody = document.getElementById('calModalBody')?.innerText || '';
        const isShown = modal && modal.classList.contains('show');
        return { isShown, modalTitle, snippet: modalBody.slice(0, 100) };
      })()`,
      returnByValue: true
    }, sessionId);

    const mRes = evalModalVisible.result?.value;
    if (mRes.isShown) {
      console.log(`🎉 [PASS] 모달 정상 팝업: "${mRes.modalTitle}"`);
      console.log(`   내용 발췌: ${mRes.snippet.replace(/\\n/g, ' ')}`);
    } else {
      console.log(`⚠️ 모달 표시 상태 확인: ${JSON.stringify(mRes)}`);
    }

    await cdp.send('Target.closeTarget', { targetId });
  } catch (e) {
    console.error(`❌ 에러: ${e.message}`);
  } finally {
    socket.close();
  }
}

verifyComebackPageLive();
