$action = New-ScheduledTaskAction -Execute "C:\Python314\python.exe" -Argument "G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\07.hanteo\comeback_weekly_email.py" -WorkingDirectory "G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app"
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 09:00AM
Register-ScheduledTask -TaskName "Comeback_Weekly_Report" -Action $action -Trigger $trigger -Description "K-POP 컴백/신보 주간 브리핑 이메일 자동 발송" -Force
Get-ScheduledTask -TaskName "Comeback_Weekly_Report" | Format-List TaskName, State
