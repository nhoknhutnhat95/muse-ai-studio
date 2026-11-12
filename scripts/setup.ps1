$ErrorActionPreference = 'Stop'
$studioRoot = Split-Path -Parent $PSScriptRoot
try {
    $studioNode = if ($env:MUSE_NODE) { $env:MUSE_NODE } else { (Get-Command node.exe -ErrorAction SilentlyContinue).Source }
    if (-not $studioNode) { $studioNode = "$env:ProgramFiles\nodejs\node.exe" }
    if (-not (Test-Path -LiteralPath $studioNode)) { throw 'Can cai Node.js 24 tro len truoc.' }
    & $studioNode (Join-Path $PSScriptRoot 'setup-runtime.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Cai runtime chua xong. Doc loi phia tren va chay lai Setup-Muse-Web.cmd.' }
    exit 0
} catch {
    Write-Host "LOI: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
