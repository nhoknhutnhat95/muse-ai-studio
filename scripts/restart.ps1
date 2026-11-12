param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
try {
    $restartRoot = Split-Path -Parent $PSScriptRoot
    $restartPort = 3210
    if ($env:MUSE_PORT -and (-not [int]::TryParse($env:MUSE_PORT, [ref]$restartPort) -or $restartPort -lt 1 -or $restartPort -gt 65535)) { throw 'MUSE_PORT khong hop le.' }
    $restartUrl = "http://127.0.0.1:$restartPort"
    $restartData = if ($env:MUSE_DATA_DIR) { $env:MUSE_DATA_DIR } else { Join-Path $restartRoot 'data' }
    if (-not [IO.Path]::IsPathRooted($restartData)) { $restartData = Join-Path $restartRoot $restartData }
    $restartLock = Join-Path $restartData 'studio.lock'
    if (Test-Path -LiteralPath $restartLock) {
        $restartOwner = Get-Content -LiteralPath $restartLock -Raw | ConvertFrom-Json
        if (-not ($restartOwner.pid -is [int]) -or $restartOwner.pid -le 0) { throw 'Studio lock khong hop le. Khong dung tien trinh.' }
        $restartProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($restartOwner.pid)"
        if ($restartProcess) {
            $restartEntry = Join-Path $restartRoot 'server\index.mjs'
            if ([IO.Path]::GetFileName($restartProcess.ExecutablePath) -ne 'node.exe' -or $restartProcess.CommandLine.Replace('/', '\') -notmatch [regex]::Escape($restartEntry)) { throw 'PID trong lock khong thuoc server cua thu muc nay. Khong dung tien trinh.' }
            $restartListener = Get-NetTCPConnection -State Listen -LocalPort $restartPort -ErrorAction SilentlyContinue | Where-Object OwningProcess -eq $restartOwner.pid
            if (-not $restartListener) { throw 'Server khong nghe tren cong da chon. Kiem tra MUSE_PORT truoc khi khoi dong lai.' }
            $restartProjects = Invoke-RestMethod "$restartUrl/api/projects" -TimeoutSec 10
            $restartMedia = Invoke-RestMethod "$restartUrl/api/media/jobs" -TimeoutSec 10
            $restartLogins = @()
            try { $restartLogins = (Invoke-RestMethod "$restartUrl/api/admin/account-login" -TimeoutSec 5).jobs }
            catch { if ([int]$_.Exception.Response.StatusCode -ne 404) { throw } }
            $restartBusy = @($restartProjects | ForEach-Object { $_.jobs } | Where-Object { $_.state -in @('queued','submitting','running','downloading') }).Count
            $restartBusy += @($restartMedia | Where-Object { $_.state -in @('queued','running','cancelling') }).Count
            $restartBusy += @($restartLogins | Where-Object { $_.state -in @('queued','running','cancelling') }).Count
            if ($restartBusy -gt 0) { throw 'Dang co tac vu hoac dang nhap chua xong. Hay doi hoan tat/huy tac vu truoc khi khoi dong lai.' }
            Stop-Process -Id $restartOwner.pid
            Wait-Process -Id $restartOwner.pid -Timeout 10 -ErrorAction SilentlyContinue
        }
    }
    & (Join-Path $PSScriptRoot 'start.ps1') -NoBrowser:$NoBrowser
    exit $LASTEXITCODE
} catch {
    Write-Host "LOI: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
