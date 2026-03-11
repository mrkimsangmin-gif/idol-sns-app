@echo off
REM Comeback MV Monitor - persistent loop mode
set GOOGLE_API_KEY=AIzaSyCUkUyUUYeFRzigs_57fWABYlrGX_CwuP8
set PYTHONIOENCODING=utf-8

cd /d "G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\07.youtube"
C:\Python314\python.exe comeback_monitor.py >> logs\comeback_monitor.log 2>&1
