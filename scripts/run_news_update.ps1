# IdolNewsUpdate: 엔터뉴스 수집 → news.json → git push → 오케스트레이터 헬스체크
# 정본(source of truth): 리포의 scripts/run_news_update.ps1 (버전관리됨)
# 호출 경로: 스케줄러 → C:\temp\run_news_update.bat → C:\temp\run_news_update.ps1(shim) → 이 파일
#   (.bat은 ASCII 경로만 호출 — cmd.exe가 한글 경로 '내 드라이브'를 못 다룸. 한글 경로 진입은 PowerShell이 담당)
# 작성: 2026-05-09 / 리포 이전·강화: 2026-05-21

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

# 리포 루트 = 이 스크립트(scripts/)의 부모 디렉터리 → PC/경로 독립적
$Repo     = Split-Path -Parent $PSScriptRoot
$Python   = 'C:\Python314\python.exe'
$Launcher = 'C:\scripts\pumit\launcher_orchestrator.py'
$LogDir   = 'C:\temp\news_update_logs'
$null = New-Item -ItemType Directory -Force -Path $LogDir

$LogFile = Join-Path $LogDir ("run_{0}.log" -f (Get-Date -Format 'yyyyMMdd'))

function Log {
    param([string]$Message)
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $line = "[$ts] $Message"
    Write-Host $line
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
}

try {
    # 0. 발행 브랜치 가드 + origin 동기화 (news.json 재생성 전, 트리가 비교적 깨끗할 때)
    #    이 리포는 GitHub Pages 발행용 작업본(origin/main 서빙)이다. main이 아닌
    #    브랜치에 체크아웃된 채 방치되면 자동 커밋이 main에 닿지 못해 사이트가
    #    조용히 멈춘다 (2026-05-18~21 사고: auto-update/20260518에 3일치 누적).
    #    실패는 모두 exit 1(loud) — 절반만 발행되는 상태를 만들지 않는다.
    Set-Location -LiteralPath $Repo
    $needsPush = $false
    $branch = (& git rev-parse --abbrev-ref HEAD).Trim()

    if ($branch -ne 'main') {
        Log ("경고: 발행 브랜치가 '$branch' (main 아님) → main으로 전환")
        & git checkout main
        if ($LASTEXITCODE -ne 0) { Log '경고: main 체크아웃 실패 (더티 트리 충돌 가능) — 발행 중단, 수동 확인 필요'; exit 1 }
        # 드리프트 동안 작업 브랜치에 쌓인 커밋(뉴스 외 전 섹션 데이터)을 main으로 끌어옴
        & git merge --ff-only $branch
        if ($LASTEXITCODE -ne 0) { Log ("경고: '{0}' -> main ff-merge 불가 (브랜치 분기) — 발행 중단, 수동 확인 필요" -f $branch); exit 1 }
        $needsPush = $true   # news 변경 여부와 무관하게 끌어온 커밋을 origin/main에 반영해야 함
    } else {
        Log '발행 브랜치 main 확인'
    }

    # 다른 자동화/수동 작업이 origin/main을 먼저 갱신했을 수 있으니 FF 동기화
    & git fetch origin main --quiet
    & git merge --ff-only origin/main
    if ($LASTEXITCODE -ne 0) { Log '경고: origin/main과 FF 동기화 실패 (로컬 분기) — 발행 중단, 수동 확인 필요'; exit 1 }

    # 1. 뉴스 수집 (update_news.py --archive)
    Log '뉴스 수집 시작'
    $script = Join-Path $Repo 'update_news.py'
    & $Python $script '--archive'
    if ($LASTEXITCODE -ne 0) {
        Log ("뉴스 수집 실패 (exit {0})" -f $LASTEXITCODE)
        exit 1
    }

    # 2. git add / commit
    Log 'Git 커밋 단계'
    Set-Location -LiteralPath $Repo

    & git add 'data/news.json'
    & git diff --cached --quiet 'data/news.json'
    if ($LASTEXITCODE -ne 0) {   # 0이 아니면 스테이징된 news 변경 있음
        $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
        & git commit -m "auto: 엔터뉴스 업데이트 $stamp"
        if ($LASTEXITCODE -ne 0) { Log ("git commit 실패 (exit {0})" -f $LASTEXITCODE); exit 1 }
        $needsPush = $true
    } else {
        Log 'news.json 변경 없음'
    }

    # 3. push — news 커밋 또는 (브랜치 끌어오기로) 로컬이 origin보다 앞설 때 반드시 발행
    if ($needsPush) {
        & git push origin main
        if ($LASTEXITCODE -ne 0) { Log ("git push 실패 (exit {0})" -f $LASTEXITCODE); exit 1 }
        Log 'GitHub Pages 반영 완료'
    } else {
        Log '반영할 변경 없음, push 스킵'
    }

    # 4. 오케스트레이터 헬스체크 (CommandLine으로 정확히 매칭)
    Log '오케스트레이터 상태 확인 중...'
    $running = Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -match 'launcher_orchestrator|orchestrator\.py' }

    if ($running) {
        $pidList = ($running | ForEach-Object { $_.ProcessId }) -join ','
        Log ("오케스트레이터 정상 실행 중 (PID {0})" -f $pidList)
    } else {
        Log '오케스트레이터 미실행 감지 — 재시작 중...'
        Start-Process -FilePath $Python -ArgumentList "`"$Launcher`"" -WindowStyle Hidden
        Log '오케스트레이터 재시작 완료'
    }

    exit 0
}
catch {
    Log ("예외 발생: {0}" -f $_)
    exit 1
}