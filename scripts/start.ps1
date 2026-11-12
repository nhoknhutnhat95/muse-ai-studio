param([switch]$NoBrowser)

# ASCII messages also display correctly in Windows PowerShell 5.1 without a BOM.
$ErrorActionPreference = 'Stop'
$studioRoot = Split-Path -Parent $PSScriptRoot
$studioLog = $null

function Test-StudioReady {
    try {
        $health = Invoke-RestMethod -Uri "$studioUrl/api/health" -TimeoutSec 1
        return ($health.ok -eq $true -and $health.version -is [string])
    } catch { return $false }
}

try {
    $studioPort = 3210
    if ($env:MUSE_PORT -and (-not [int]::TryParse($env:MUSE_PORT, [ref]$studioPort) -or $studioPort -lt 1 -or $studioPort -gt 65535)) {
        throw 'MUSE_PORT phai la so tu 1 den 65535.'
    }
    $studioUrl = "http://127.0.0.1:$studioPort"
    $studioEntry = Join-Path $studioRoot 'server\index.mjs'
    if (-not (Test-Path -LiteralPath $studioEntry -PathType Leaf)) {
        throw 'Thieu server/index.mjs. Can clone hoac giai nen day du thu muc ma nguon.'
    }

    if (Test-StudioReady) {
        Write-Host "Muse Web da chay: $studioUrl"
    } else {
        $studioListeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
        if ($studioListeners | Where-Object { $_.Port -eq $studioPort }) {
            throw "Cong $studioPort dang duoc ung dung khac su dung hoac Muse chua san sang. Kiem tra ung dung do, hoac dat MUSE_PORT sang cong khac."
        }

        $studioNode = $null
        if ($env:MUSE_NODE) {
            if (-not (Test-Path -LiteralPath $env:MUSE_NODE -PathType Leaf)) {
                throw 'MUSE_NODE khong tro den file node.exe ton tai. Sua duong dan hoac bo bien MUSE_NODE.'
            }
            $studioNode = (Resolve-Path -LiteralPath $env:MUSE_NODE).Path
        } else {
            $studioCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($studioCommand) { $studioNode = $studioCommand.Source }
            # Explorer may still have the old PATH immediately after installing Node.
            if (-not $studioNode) {
                foreach ($candidate in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) {
                    if (Test-Path -LiteralPath $candidate -PathType Leaf) { $studioNode = $candidate; break }
                }
            }
        }
        if (-not $studioNode) {
            throw 'Chua tim thay Node.js. Cai Node.js LTS ban 24 tro len (Windows Installer .msi) tai https://nodejs.org/en/download, roi mo lai Start-Muse-Web.cmd.'
        }
        $studioVersion = & $studioNode --version
        if ($LASTEXITCODE -ne 0 -or "$studioVersion" -notmatch '^v(\d+)\.') { throw 'Khong chay duoc Node.js. Hay cai lai Node.js LTS ban 24 tro len.' }
        if ([int]$Matches[1] -lt 24) {
            throw "Node.js $studioVersion qua cu. Can ban 24 tro len. Cai Node.js LTS tai https://nodejs.org/en/download, roi mo lai Start-Muse-Web.cmd. Node hien tai: $studioNode"
        }
        & $studioNode --no-warnings -e "try { const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(':memory:'); db.close(); } catch { process.exit(1); }"
        if ($LASTEXITCODE -ne 0) { throw 'Node.js khong mo duoc SQLite. Cai lai Node.js LTS ban 24 tro len va kiem tra bien NODE_OPTIONS neu co.' }

        # Account login uses the pinned browser driver. Basic draft/media APIs can
        # still start offline if this optional first-run preparation fails.
        $studioLockfile = Join-Path $studioRoot 'package-lock.json'
        $studioBrowserDriver = Join-Path $studioRoot 'node_modules\playwright-core\package.json'
        if ((Test-Path -LiteralPath $studioLockfile) -and -not (Test-Path -LiteralPath $studioBrowserDriver)) {
            $studioNpmCli = Join-Path (Split-Path -Parent $studioNode) 'node_modules\npm\bin\npm-cli.js'
            if (Test-Path -LiteralPath $studioNpmCli) {
                Write-Host 'Dang cai thanh phan dang nhap tai khoan (lan dau can Internet)...'
                Push-Location -LiteralPath $studioRoot
                try {
                    $ErrorActionPreference = 'Continue'
                    & $studioNode $studioNpmCli ci --ignore-scripts --no-audit --no-fund --fetch-retries=0 --fetch-timeout=20000
                    if ($LASTEXITCODE -ne 0) { Write-Host 'Chua cai duoc thanh phan dang nhap. Web van mo; thu npm ci khi co Internet.' }
                } finally { $ErrorActionPreference = 'Stop'; Pop-Location }
            } else { Write-Host 'Can npm ci de dung dang nhap tai khoan. Ban Node portable hien tai chua co npm.' }
        }

        $studioData = if ($env:MUSE_DATA_DIR) { $env:MUSE_DATA_DIR } else { Join-Path $studioRoot 'data' }
        if (-not [System.IO.Path]::IsPathRooted($studioData)) { $studioData = Join-Path $studioRoot $studioData }
        $studioData = [System.IO.Path]::GetFullPath($studioData)
        New-Item -ItemType Directory -Path $studioData -Force | Out-Null
        $env:MUSE_DATA_DIR = $studioData
        $studioLog = Join-Path $studioData 'server-error.log'
        Write-Host "Dang khoi dong Muse Web voi Node.js $studioVersion..."
        $studioProcess = Start-Process -FilePath $studioNode -ArgumentList ('"' + $studioEntry + '"') -WorkingDirectory $studioRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $studioData 'server.log') -RedirectStandardError $studioLog -PassThru
        $studioTimer = [System.Diagnostics.Stopwatch]::StartNew()
        $studioReady = $false
        while ($studioTimer.Elapsed.TotalSeconds -lt 30) {
            if ($studioProcess.HasExited) { throw "May chu da dung (ma loi $($studioProcess.ExitCode))." }
            if (Test-StudioReady) { $studioReady = $true; break }
            Start-Sleep -Milliseconds 250
        }
        if (-not $studioReady) { throw "May chu chua san sang sau 30 giay (PID $($studioProcess.Id)). Kiem tra log truoc khi thu lai." }
        Write-Host "Muse Web san sang: $studioUrl"
    }
    Write-Host 'De tao anh/video, can mo Muse AI Studio va dang nhap tai khoan tren may nay.'
    if (-not $NoBrowser) {
        try { Start-Process $studioUrl }
        catch { Write-Host "Khong tu mo duoc trinh duyet. Hay mo thu cong: $studioUrl" }
    }
    exit 0
} catch {
    Write-Host ''
    Write-Host "LOI: $($_.Exception.Message)" -ForegroundColor Red
    if ($studioLog) { Write-Host "Log chi tiet: $studioLog" }
    exit 1
}
