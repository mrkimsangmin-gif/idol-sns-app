const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1280, height: 900 } });
  
  // 1. 연간 차트
  console.log('=== 1. YEARLY CHART ===');
  const page1 = await context.newPage();
  await page1.goto('https://www.hanteochart.com/chart/album/yearly', { waitUntil: 'networkidle', timeout: 30000 });
  await page1.waitForTimeout(5000);
  await page1.screenshot({ path: 'C:/temp/hanteo_yearly.png', fullPage: false });
  
  const yearlyText = await page1.evaluate(() => document.body.innerText.substring(0, 3000));
  console.log(yearlyText.substring(0, 2000));
  
  // 2. 월간 차트
  console.log('\n=== 2. MONTHLY CHART ===');
  const page2 = await context.newPage();
  await page2.goto('https://www.hanteochart.com/chart/album/monthly', { waitUntil: 'networkidle', timeout: 30000 });
  await page2.waitForTimeout(5000);
  await page2.screenshot({ path: 'C:/temp/hanteo_monthly.png', fullPage: false });
  
  const monthlyText = await page2.evaluate(() => document.body.innerText.substring(0, 3000));
  console.log(monthlyText.substring(0, 2000));

  // 3. 주간 차트
  console.log('\n=== 3. WEEKLY CHART ===');
  const page3 = await context.newPage();
  await page3.goto('https://www.hanteochart.com/chart/album/weekly', { waitUntil: 'networkidle', timeout: 30000 });
  await page3.waitForTimeout(5000);
  await page3.screenshot({ path: 'C:/temp/hanteo_weekly.png', fullPage: false });
  
  const weeklyText = await page3.evaluate(() => document.body.innerText.substring(0, 3000));
  console.log(weeklyText.substring(0, 2000));
  
  await browser.close();
  console.log('\n=== DONE ===');
})();
