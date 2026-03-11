@echo off
REM YouTube Daily Collector - runs at 06:00 daily
set GOOGLE_API_KEY=AIzaSyCUkUyUUYeFRzigs_57fWABYlrGX_CwuP8
set PYTHONIOENCODING=utf-8

cd /d "G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\07.youtube"
C:\Python314\python.exe youtube_daily.py --days 30 >> logs\daily_%date:~0,4%%date:~5,2%%date:~8,2%.log 2>&1
