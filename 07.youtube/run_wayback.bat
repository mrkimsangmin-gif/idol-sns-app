@echo off
REM Wayback Machine MV Milestone Crawler - one-time full run
set PYTHONIOENCODING=utf-8

cd /d "G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\07.youtube"
C:\Python314\python.exe crawl_wayback_milestones.py --min-views 10000000 --resume >> logs\wayback_%date:~0,4%%date:~5,2%%date:~8,2%.log 2>&1
