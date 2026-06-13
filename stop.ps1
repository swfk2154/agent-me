# agent-me Shutdown Script (Windows)
# Stop backend + frontend started by start.ps1

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-I($m)  { Write-Host "   $m" -ForegroundColor Gray }
function Write-O($m)  { Write-Host "   $m" -ForegroundColor Green }
function Write-W($m)  { Write-Host "   $m" -ForegroundColor Yellow }
function Write-E($m)  { Write-Host "   $m" -ForegroundColor Red }

Write-Host ""
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "  Stopping agent-me..." -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

$killed = @()
$failed = @()

# ---------- 1. Kill by PID file ----------

$pidFile = Join-Path $root "running_pids.txt"
if (Test-Path $pidFile) {
    $pids = @(Get-Content $pidFile | Where-Object { $_ -match '^\d+$' })
    foreach ($pid in $pids) {
        try {
            $proc = Get-Process -Id $pid -ErrorAction Stop
            $name = $proc.ProcessName
            Stop-Process -Id $pid -Force -ErrorAction Stop
            Write-O "Stopped $name (PID $pid)"
            $killed += $pid
        } catch {
            Write-W "PID $pid no longer running"
        }
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    Write-I "PID file removed"
}

# ---------- 2. Fallback: kill by port ----------

Start-Sleep -Seconds 1

function Kill-ByPort($port, $names) {
    $found = $false
    try {
        Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
            Where-Object { $_.State -eq "Listen" } |
            Select-Object -ExpandProperty OwningProcess -Unique |
            Where-Object { $_ -ne 0 } |
            ForEach-Object {
                try {
                    $proc = Get-Process -Id $_ -ErrorAction Stop
                    $pname = $proc.ProcessName.ToLower()
                    $isTarget = $names | Where-Object { $pname -like "*$_*" }
                    if ($isTarget) {
                        Stop-Process -Id $_ -Force -ErrorAction Stop
                        Write-O "Port $port freed ($pname, PID $_)"
                        $script:killed += $_
                        $found = $true
                    }
                } catch {
                    Write-W "Port $port process $_ cannot be killed"
                    $script:failed += $_
                }
            }
    } catch {}
    return $found
}

Write-Host ""; Write-Host "Checking ports..." -ForegroundColor Cyan

$backendKilled = Kill-ByPort 8000 @("python", "uvicorn")
$frontendKilled = Kill-ByPort 3000 @("node", "npm", "vite")

if (-not $backendKilled -and -not $frontendKilled -and $killed.Count -eq 0) {
    Write-I "No running agent-me processes found"
}

# ---------- 3. Verify ----------

Write-Host ""; Write-Host "Verifying..." -ForegroundColor Cyan
Start-Sleep -Seconds 2

$allClear = $true
foreach ($p in @(8000, 3000)) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $p -ErrorAction Stop |
                Where-Object { $_.State -eq "Listen" }
        if ($conn) {
            Write-E "Port $p still in use (PID $($conn.OwningProcess))"
            $allClear = $false
        } else {
            Write-O "Port $p is free"
        }
    } catch {
        Write-O "Port $p is free"
    }
}

# ---------- 4. Result ----------

Write-Host ""
Write-Host "==================================" -ForegroundColor Cyan
if ($allClear) {
    Write-O "agent-me stopped successfully"
} else {
    Write-W "Some ports are still in use"
    Write-I "Check Task Manager for remaining processes"
}
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press Enter to close this window..." -ForegroundColor Gray
Read-Host
