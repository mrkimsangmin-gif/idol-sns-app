@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8

REM 매일 01:00 실행 — Twitter 전체 그룹 크롤
C:\Python314\python.exe "G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\09.twitter\crawl_all_groups.py"
