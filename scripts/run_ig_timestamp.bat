@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8

REM ig_timestamp_fetch.py — A90 ig_crawler_a90.py와 병렬 실행 (수·토 04:05)
REM 세션 파일이 있으면 자동 재사용. 없으면 아래 주석 해제 후 1회 실행:
REM   C:\Python314\python.exe "...\ig_timestamp_fetch.py" --login YOUR_ID --save-session

C:\Python314\python.exe "G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\08.instagram\ig_timestamp_fetch.py"
