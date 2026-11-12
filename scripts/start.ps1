$ErrorActionPreference = 'Stop'
$studioRoot = Split-Path -Parent $PSScriptRoot
$studioUrl = 'http://127.0.0.1:3210'
$studioReady = $false
try { $studioReady = (Invoke-RestMethod -Uri "$studioUrl/api/health" -TimeoutSec 2).ok } catch {}
if (-not $studioReady) {
    $studioNode = (Get-Command node.exe).Source
    $studioData = Join-Path $studioRoot 'data'
    New-Item -ItemType Directory -Path $studioData -Force | Out-Null
    Start-Process -FilePath $studioNode -ArgumentList ('"' + (Join-Path $studioRoot 'server\index.mjs') + '"') -WorkingDirectory $studioRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $studioData 'server.log') -RedirectStandardError (Join-Path $studioData 'server-error.log') | Out-Null
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 250
        try { $studioReady = (Invoke-RestMethod -Uri "$studioUrl/api/health" -TimeoutSec 1).ok; if ($studioReady) { break } } catch {}
    }
}
if (-not $studioReady) { throw 'Không khởi động được Muse Web. Xem data/server-error.log.' }
Start-Process $studioUrl
