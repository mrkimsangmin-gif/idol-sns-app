import { chromium } from '@playwright/test';

const urls = [
  { name: '우기 ((여자)아이들)', url: 'https://world.kbs.co.kr/service/contents_view.htm?lang=k&menu_cate=enternews&id=&board_seq=471574&page=1&board_code=' },
  { name: '데일리디렉션', url: 'https://v.daum.net/v/20260917164548494' },
  { name: '라이즈 (RIIZE)', url: 'https://biz.chosun.com/entertainment/enter_general/2026/09/14/GMZDOZJTGFTGCYLFMIYDQZLFME/' },
  { name: '리센느 (RESCENE)', url: 'https://www.yna.co.kr/view/AKR20260922067400005' },
  { name: '나우즈 (NOWZ)', url: 'https://news.jtbc.co.kr/article/NB12320304' }
];

async function checkAll() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
  });

  for (const item of urls) {
    console.log(`\n========================================`);
    console.log(`[CDP 검증 시작] ${item.name}`);
    console.log(`URL: ${item.url}`);
    const page = await context.newPage();
    try {
      await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2000);
      const title = await page.title();
      console.log(`페이지 타이틀: ${title}`);

      // 본문 텍스트 추출 (컴백, 데뷔, 발매, 일자 등 키워드 포함 문장)
      const text = await page.evaluate(() => document.body.innerText || '');
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      
      const relevantLines = lines.filter(l => 
        (l.includes('컴백') || l.includes('데뷔') || l.includes('발매') || l.includes('앨범') || l.includes('팬미팅')) &&
        (l.includes('10월') || l.includes('11월') || l.includes('9월') || l.includes('일'))
      );

      console.log(`핵심 확인 문장 (상위 3건):`);
      if (relevantLines.length > 0) {
        relevantLines.slice(0, 3).forEach((line, idx) => {
          console.log(`  ${idx + 1}) ${line.slice(0, 100)}`);
        });
      } else {
        console.log(`  (본문 발췌): ${lines.slice(0, 5).join(' ').slice(0, 150)}`);
      }
    } catch (e) {
      console.error(`에러 발생: ${e.message}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();
}

checkAll();
