# agent-me Startup Script (Windows)
# Start backend + frontend. Window stays open; closing it won't stop services.

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ErrorActionPreference = "Stop"

function Write-I($m)  { Write-Host "   $m" -ForegroundColor Gray }
function Write-O($m)  { Write-Host "   $m" -ForegroundColor Green }
function Write-W($m)  { Write-Host "   $m" -ForegroundColor Yellow }
function Write-E($m)  { Write-Host "   $m" -ForegroundColor Red }

Write-Host ""
Write-Host "=== agent-me v2.2 ===" -ForegroundColor Cyan
Write-Host ""

# ---------- 1. Check Python & npm ----------

# Python: prefer venv, fallback to global
$pythonPath = $null
if (Test-Path "$root\.venv\Scripts\python.exe") {
    $pythonPath = "$root\.venv\Scripts\python.exe"
    Write-I "Using venv Python"
} elseif (Get-Command "python" -ErrorAction SilentlyContinue) {
    $pythonPath = "python"
    Write-I "Using global Python"
} elseif (Get-Command "python3" -ErrorAction SilentlyContinue) {
    $pythonPath = "python3"
    Write-I "Using global python3"
} else {
    Write-E "Python not found. Please install Python 3.10+"
    Write-I "Download: https://www.python.org/downloads/"
    Read-Host "`nPress Enter to close"
    exit 1
}

try {
    $pyVer = & $pythonPath --version 2>&1
    Write-O "$pyVer"
} catch {
    Write-E "Python path invalid: $pythonPath"
    Read-Host "`nPress Enter to close"
    exit 1
}

$npmPath = $null
if (Get-Command "npm.cmd" -ErrorAction SilentlyContinue) {
    $npmPath = "npm.cmd"
} elseif (Get-Command "npm" -ErrorAction SilentlyContinue) {
    $npmPath = "npm"
} else {
    Write-E "npm not found. Please install Node.js 18+"
    Write-I "Download: https://nodejs.org/"
    Read-Host "`nPress Enter to close"
    exit 1
}

try {
    $nodeVer = & node --version 2>&1
    Write-O "Node.js $nodeVer"
} catch {
    Write-W "Cannot detect Node.js version"
}

# ---------- 2. Kill old processes ----------

$oldPids = @()
$pidFile = "$root\running_pids.txt"
if (Test-Path $pidFile) {
    $oldPids = @(Get-Content $pidFile | Where-Object { $_ -match '^\d+$' })
    if ($oldPids.Count -gt 0) {
        Write-W "Cleaning up old processes..."
        foreach ($pid in $oldPids) {
            try {
                Stop-Process -Id $pid -Force -ErrorAction Stop
                Write-O "Killed old PID $pid"
            } catch {}
        }
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
}

function Test-Port($port) {
    try {
        return Get-NetTCPConnection -LocalPort $port -ErrorAction Stop |
               Where-Object { $_.State -eq "Listen" } | Select-Object -First 1
    } catch { return $null }
}

foreach ($p in @(8000, 3000)) {
    if (Test-Port $p) {
        Write-W "Port $p in use, releasing..."
        Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique |
            Where-Object { $_ -ne 0 } |
            ForEach-Object {
                try {
                    Stop-Process -Id $_ -Force -ErrorAction Stop
                    Write-O "Released port $p (PID $_)"
                } catch {
                    Write-E "Cannot release port $p. Close the program using it."
                }
            }
        Start-Sleep -Seconds 1
    }
}

# ---------- 3. Start backend ----------

Write-Host ""; Write-Host "Starting backend..." -ForegroundColor Cyan

try {
    $backend = Start-Process -FilePath $pythonPath `
        -ArgumentList "-m","uvicorn","main:app","--port","8000","--host","127.0.0.1" `
        -WorkingDirectory "$root\backend" `
        -WindowStyle Hidden `
        -PassThru
    Write-O "Backend started. PID: $($backend.Id)  http://127.0.0.1:8000"
} catch {
    Write-E "Backend start failed: $_"
    Read-Host "`nPress Enter to close"
    exit 1
}

Write-I "Waiting for backend..."
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/health" -TimeoutSec 2 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
    Start-Sleep -Milliseconds 500
}
if (-not $ready) {
    Write-W "Backend not ready yet, starting frontend anyway..."
} else {
    Write-O "Backend ready"
}

# ---------- 4. Start frontend ----------

Write-Host ""; Write-Host "Starting frontend..." -ForegroundColor Cyan

try {
    $frontend = Start-Process -FilePath $npmPath `
        -ArgumentList "run","dev" `
        -WorkingDirectory "$root\frontend" `
        -WindowStyle Hidden `
        -PassThru
    Write-O "Frontend started. PID: $($frontend.Id)  http://127.0.0.1:3000"
} catch {
    Write-E "Frontend start failed: $_"
    try { Stop-Process -Id $backend.Id -Force } catch {}
    Read-Host "`nPress Enter to close"
    exit 1
}

# ---------- 5. Save PIDs ----------

"$($backend.Id)`n$($frontend.Id)" | Out-File -FilePath $pidFile -Encoding utf8 -Force
Write-I "PIDs saved to running_pids.txt"

# ---------- 6. Show info, keep window open ----------

Write-Host ""
Write-Host "==================================" -ForegroundColor Cyan
Write-O "agent-me is running"
Write-Host ""
Write-Host "   Backend:  http://127.0.0.1:8000" -ForegroundColor White
Write-Host "   Frontend: http://127.0.0.1:3000" -ForegroundColor White
Write-Host ""
Write-Host "   Closing this window will NOT stop services." -ForegroundColor Green
Write-Host "   To stop: run .\stop.ps1" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Window stays open. Close it manually." -ForegroundColor Gray
try {
    while ($true) { Start-Sleep -Seconds 1 }
} catch {
    # Ctrl+C or window closed -- child processes keep running
}
