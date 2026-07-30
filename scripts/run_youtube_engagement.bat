@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
REM API 키는 secrets.cmd에서 로드 (gitignore + 권한 제한)
call "%~dp0secrets.cmd" 2>nul || (
    echo [ERROR] secrets.cmd not found — set GOOGLE_API_KEY required
    exit /b 1
)

REM 매일 10:00 + 22:00 실행 (두 스케줄 모두 이 bat 파일 사용)
C:\Python314\python.exe "G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\07.youtube\youtube_engagement.py"
