param(
    [ValidateSet('codex','claude','both')][string]$Agent = 'both',
    [string]$WebUrl = 'http://127.0.0.1:3210'
)
$ErrorActionPreference = 'Stop'
try {
    $skillNode = if ($env:MUSE_NODE) { $env:MUSE_NODE } else { (Get-Command node.exe -ErrorAction SilentlyContinue).Source }
    if (-not $skillNode) { $skillNode = "$env:ProgramFiles\nodejs\node.exe" }
    if (-not (Test-Path -LiteralPath $skillNode)) { throw 'Can cai Node.js 24 tro len truoc.' }
    & $skillNode (Join-Path $PSScriptRoot 'install-skills.mjs') --agent $Agent --url $WebUrl
    exit $LASTEXITCODE
} catch {
    Write-Host "LOI: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
