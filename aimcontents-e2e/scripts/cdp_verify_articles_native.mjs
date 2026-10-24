import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

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
  const cdpPort = 9444;
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

const urls = [
  { name: '우기 ((여자)아이들)', url: 'https://world.kbs.co.kr/service/contents_view.htm?lang=k&menu_cate=enternews&id=&board_seq=471574&page=1&board_code=' },
  { name: '데일리디렉션', url: 'https://v.daum.net/v/20260917164548494' },
  { name: '라이즈 (RIIZE)', url: 'https://biz.chosun.com/entertainment/enter_general/2026/09/14/GMZDOZJTGFTGCYLFMIYDQZLFME/' },
  { name: '리센느 (RESCENE)', url: 'https://www.yna.co.kr/view/AKR20260922067400005' },
  { name: '나우즈 (NOWZ)', url: 'https://news.jtbc.co.kr/article/NB12320304' }
];

async function verifyAll() {
  const { wsUrl } = await getOrLaunchChrome();
  const socket = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    socket.addEventListener('open', res);
    socket.addEventListener('error', rej);
  });
  const cdp = new CDPClient(socket);

  for (const item of urls) {
    console.log(`\n======================================================`);
    console.log(`🔍 [CDP 실시간 브라우저 검증] ${item.name}`);
    console.log(`URL: ${item.url}`);
    try {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Page.enable', {}, sessionId);
      await cdp.send('Runtime.enable', {}, sessionId);

      await cdp.send('Page.navigate', { url: item.url }, sessionId);
      await sleep(2500);

      const evalTitle = await cdp.send('Runtime.evaluate', { expression: 'document.title' }, sessionId);
      console.log(`📰 페이지 제목: ${evalTitle.result?.value}`);

      const evalText = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const text = document.body.innerText || '';
          const lines = text.split('\\n').map(l => l.trim()).filter(Boolean);
          const matched = lines.filter(l => 
            (l.includes('컴백') || l.includes('데뷔') || l.includes('발매') || l.includes('음반') || l.includes('팬미팅')) &&
            (l.includes('10월') || l.includes('11월') || l.includes('9월') || l.includes('일'))
          );
          return matched.slice(0, 3);
        })()`,
        returnByValue: true
      }, sessionId);

      const matchedLines = evalText.result?.value || [];
      console.log(`📌 기사 핵심 본문 검증:`);
      if (matchedLines.length > 0) {
        matchedLines.forEach((l, idx) => console.log(`   ${idx + 1}) ${l}`));
      } else {
        const fallbackText = await cdp.send('Runtime.evaluate', {
          expression: 'document.body.innerText.slice(0, 200)'
        }, sessionId);
        console.log(`   (요약): ${fallbackText.result?.value?.replace(/\\n/g, ' ')}`);
      }

      await cdp.send('Target.closeTarget', { targetId });
    } catch (e) {
      console.error(`❌ 에러: ${e.message}`);
    }
  }

  socket.close();
  console.log(`\n✅ 5개 기사 CDP 실시간 검증 완료`);
}

verifyAll();
