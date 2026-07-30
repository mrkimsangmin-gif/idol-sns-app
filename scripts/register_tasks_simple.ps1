$S = "G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\scripts"

function Add-DailyTask($Name, $Bat, $Time) {
    Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue
    $a = New-ScheduledTaskAction -Execute $Bat
    $t = New-ScheduledTaskTrigger -Daily -At $Time
    $s = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -DisallowStartIfOnBatteries
    Register-ScheduledTask -TaskName $Name -Action $a -Trigger $t -Settings $s -RunLevel Highest -Force | Out-Null
    Write-Host "OK: $Name ($Time 매일)"
}

function Add-WeeklyTask($Name, $Bat, $Time, $Day) {
    Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue
    $a = New-ScheduledTaskAction -Execute $Bat
    $t = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Day -At $Time
    $s = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -DisallowStartIfOnBatteries
    Register-ScheduledTask -TaskName $Name -Action $a -Trigger $t -Settings $s -RunLevel Highest -Force | Out-Null
    Write-Host "OK: $Name ($Day $Time)"
}

Add-DailyTask  "Pumit_DailyAnalyst"    "$S\run_daily_analyst.bat"     "00:00"
Add-DailyTask  "Pumit_TwitterCrawl"    "$S\run_twitter_crawl.bat"     "01:00"
Add-DailyTask  "Pumit_YouTubeAM"       "$S\run_youtube_engagement.bat" "10:00"
Add-DailyTask  "Pumit_YouTubePM"       "$S\run_youtube_engagement.bat" "22:00"
Add-WeeklyTask "Pumit_IGTimestamp_Wed" "$S\run_ig_timestamp.bat"      "04:05" "Wednesday"
Add-WeeklyTask "Pumit_IGTimestamp_Sat" "$S\run_ig_timestamp.bat"      "04:05" "Saturday"

Write-Host ""
Get-ScheduledTask | Where-Object { $_.TaskName -like "Pumit_*" } | Select-Object TaskName, State | Format-Table -AutoSize
