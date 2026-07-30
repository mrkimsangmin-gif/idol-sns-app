$S = "G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\scripts"

function Reg($Name, $Bat, $Trigger) {
    Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue
    $a = New-ScheduledTaskAction -Execute $Bat
    $s = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $Name -Action $a -Trigger $Trigger -Settings $s -RunLevel Highest -Force | Out-Null
    Write-Host "OK: $Name"
}

Reg "Pumit_DailyAnalyst"    "$S\run_daily_analyst.bat"      (New-ScheduledTaskTrigger -Daily -At "00:00")
Reg "Pumit_TwitterCrawl"    "$S\run_twitter_crawl.bat"      (New-ScheduledTaskTrigger -Daily -At "01:00")
Reg "Pumit_YouTubeAM"       "$S\run_youtube_engagement.bat" (New-ScheduledTaskTrigger -Daily -At "10:00")
Reg "Pumit_YouTubePM"       "$S\run_youtube_engagement.bat" (New-ScheduledTaskTrigger -Daily -At "22:00")
Reg "Pumit_IGTimestamp_Wed" "$S\run_ig_timestamp.bat"       (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Wednesday -At "04:05")
Reg "Pumit_IGTimestamp_Sat" "$S\run_ig_timestamp.bat"       (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Saturday  -At "04:05")

Write-Host ""
Get-ScheduledTask | Where-Object { $_.TaskName -like "Pumit_*" } | Select-Object TaskName, State | Format-Table -AutoSize
