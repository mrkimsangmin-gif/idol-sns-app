@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8

REM ═══════════════════════════════════════════════════════
REM  TikTok Monthly Pipeline - Windows Task Scheduler
REM ═══════════════════════════════════════════════════════
REM
REM  스케줄 설정 방법:
REM  1. Win+R → taskschd.msc
REM  2. [작업 만들기]
REM     - 이름: TikTok Monthly Crawl
REM     - 트리거: 매월 1일 02:00
REM     - 동작: cmd /c "G:\내 드라이브\...\06.tiktok\tiktok_monthly_task.bat"
REM     - 조건: AC 전원, 컴퓨터 절전 해제
REM     - 설정: 24시간 초과 시 중지
REM
REM  전제 조건:
REM  - Samsung A32 (RF9R7042F3K) USB 연결, 화면 잠금 해제
REM  - ADB가 PATH에 있어야 함
REM ═══════════════════════════════════════════════════════

set PYTHON=C:\Python314\python.exe
set SCRIPT_DIR=G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\06.tiktok
set LOG_DIR=%SCRIPT_DIR%\logs

REM 로그 디렉토리 생성
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

REM 날짜 기반 로그 파일명
for /f "tokens=1-3 delims=/ " %%a in ('date /t') do set LOG_DATE=%%c%%a%%b
set LOG_FILE=%LOG_DIR%\monthly_%LOG_DATE%.log

echo [%date% %time%] ====== TikTok Monthly Pipeline Start ====== >> "%LOG_FILE%"

REM ADB 디바이스 확인
adb -s RF9R7042F3K shell echo ok >nul 2>&1
if errorlevel 1 (
    echo [%date% %time%] ERROR: Device RF9R7042F3K not connected >> "%LOG_FILE%"
    echo Device not connected. Connect A32 and retry.
    exit /b 1
)

echo [%date% %time%] Device connected. Starting pipeline... >> "%LOG_FILE%"

REM 파이프라인 실행
"%PYTHON%" "%SCRIPT_DIR%\tiktok_monthly.py" pipeline >> "%LOG_FILE%" 2>&1
set EXIT_CODE=%errorlevel%

echo [%date% %time%] Pipeline finished with exit code %EXIT_CODE% >> "%LOG_FILE%"
echo [%date% %time%] ====== TikTok Monthly Pipeline End ====== >> "%LOG_FILE%"

exit /b %EXIT_CODE%
