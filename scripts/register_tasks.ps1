# register_tasks.ps1 — Windows Task Scheduler 자동 등록
# 실행: PowerShell -ExecutionPolicy Bypass -File scripts\register_tasks.ps1
# (관리자 권한 필요)

$ScriptsDir = "G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\scripts"

$tasks = @(
    @{
        Name    = "Pumit_DailyAnalyst"
        Bat     = "$ScriptsDir\run_daily_analyst.bat"
        Trigger = "매일 00:00"
        Time    = "00:00"
        Daily   = $true
    },
    @{
        Name    = "Pumit_TwitterCrawl"
        Bat     = "$ScriptsDir\run_twitter_crawl.bat"
        Trigger = "매일 01:00"
        Time    = "01:00"
        Daily   = $true
    },
    @{
        Name    = "Pumit_YouTubeAM"
        Bat     = "$ScriptsDir\run_youtube_engagement.bat"
        Trigger = "매일 10:00"
        Time    = "10:00"
        Daily   = $true
    },
    @{
        Name    = "Pumit_YouTubePM"
        Bat     = "$ScriptsDir\run_youtube_engagement.bat"
        Trigger = "매일 22:00"
        Time    = "22:00"
        Daily   = $true
    },
    @{
        Name    = "Pumit_IGTimestamp_Wed"
        Bat     = "$ScriptsDir\run_ig_timestamp.bat"
        Trigger = "매주 수요일 04:05"
        Time    = "04:05"
        Daily   = $false
        DayOfWeek = "Wednesday"
    },
    @{
        Name    = "Pumit_IGTimestamp_Sat"
        Bat     = "$ScriptsDir\run_ig_timestamp.bat"
        Trigger = "매주 토요일 04:05"
        Time    = "04:05"
        Daily   = $false
        DayOfWeek = "Saturday"
    }
)

foreach ($t in $tasks) {
    Write-Host "등록: $($t.Name) ($($t.Trigger))"

    # 기존 작업 제거 (업데이트)
    Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false -ErrorAction SilentlyContinue

    $action = New-ScheduledTaskAction -Execute $t.Bat

    if ($t.Daily) {
        $trigger = New-ScheduledTaskTrigger -Daily -At $t.Time
    } else {
        $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $t.DayOfWeek -At $t.Time
    }

    $settings = New-ScheduledTaskSettingsSet `
        -RunOnlyIfIdle:$false `
        -DisallowStartIfOnBatteries `
        -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit (New-TimeSpan -Hours 3)

    $principal = New-ScheduledTaskPrincipal `
        -UserId $env:USERNAME `
        -RunLevel Highest `
        -LogonType S4U

    Register-ScheduledTask `
        -TaskName $t.Name `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Force | Out-Null

    Write-Host "  ✅ 완료"
}

Write-Host ""
Write-Host "등록된 작업 목록:"
Get-ScheduledTask | Where-Object { $_.TaskName -like "Pumit_*" } |
    Select-Object TaskName, State | Format-Table -AutoSize

Write-Host ""
Write-Host "⚠️  ig_timestamp_fetch.py 첫 실행 (세션 저장) 필요:"
Write-Host "   C:\Python314\python.exe `"$ScriptsDir\..\08.instagram\ig_timestamp_fetch.py`" --login YOUR_IG_ID --save-session"
