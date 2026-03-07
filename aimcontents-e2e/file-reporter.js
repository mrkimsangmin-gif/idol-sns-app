/**
 * file-reporter.js
 * 테스트 결과를 JSON 파일로 기록하는 커스텀 Playwright 리포터
 * 이유: Windows bash 셸에서 playwright stdout 캡처 불가 → 파일로 우회
 */
const fs = require('fs');
const path = require('path');

class FileReporter {
  constructor(options) {
    this.outputFile = options && options.outputFile
      ? options.outputFile
      : path.join(__dirname, '..', 'qa', 'fg_browser_results.json');
    this.results = [];
    this.startTime = Date.now();
  }

  onBegin(config, suite) {
    this.totalTests = suite.allTests().length;
    console.log(`[FileReporter] 테스트 시작: ${this.totalTests}개`);
  }

  onTestEnd(test, result) {
    const entry = {
      title: test.title,
      status: result.status, // passed | failed | timedOut | skipped
      duration: result.duration,
      errors: result.errors.map(e => e.message || String(e)),
      stdout: result.stdout.map(s => s.text || '').join(''),
    };
    this.results.push(entry);
    const icon = result.status === 'passed' ? '✅' : '❌';
    console.log(`  ${icon} ${test.title} (${result.duration}ms)`);
    if (result.status !== 'passed') {
      result.errors.forEach(e => console.log(`     → ${(e.message || String(e)).substring(0, 200)}`));
    }
  }

  onEnd(result) {
    const passed = this.results.filter(r => r.status === 'passed').length;
    const failed = this.results.filter(r => r.status !== 'passed').length;
    const report = {
      generated_at: new Date().toISOString(),
      duration_ms: Date.now() - this.startTime,
      summary: { total: this.results.length, passed, failed },
      results: this.results,
    };
    // 파일 저장
    const outDir = path.dirname(this.outputFile);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(this.outputFile, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\n[FileReporter] 결과 저장: ${this.outputFile}`);
    console.log(`[FileReporter] 총합: ${passed}/${this.results.length} PASS`);
  }
}

module.exports = FileReporter;
