# agent-me Install Script (Windows PowerShell)
# Usage: .\install.ps1 [-UseMirror] [-UseVenv] [-FullInstall]

param(
    [switch]$UseMirror,
    [switch]$UseVenv,
    [switch]$FullInstall
)

$ErrorActionPreference = "Stop"
$startTime = Get-Date

function Write-Step($m)  { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Info($m)   { Write-Host "   $m" -ForegroundColor Gray }
function Write-Ok($m)     { Write-Host "   $m" -ForegroundColor Green }
function Write-Warn($m)   { Write-Host "   $m" -ForegroundColor Yellow }

function Test-Command($cmd) {
    return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

function Get-Version($cmd, $pattern) {
    $output = & $cmd --version 2>&1 | Select-Object -First 1
    if ($output -match $pattern) { return $matches[1] }
    return $null
}

# ==================== 0. Check npm ====================
$npmCmd = "npm"
try {
    $null = Get-Command "npm.cmd" -ErrorAction Stop
    $npmCmd = "npm.cmd"
} catch {
    try {
        $null = Get-Command "npm" -ErrorAction Stop
    } catch {
        Write-Host "`n[ERROR] npm not found. Please install Node.js 18+." -ForegroundColor Red
        Write-Host "Download: https://nodejs.org/" -ForegroundColor Cyan
        exit 1
    }
}

# ==================== 1. Environment check ====================
Write-Step "Checking environment"

if (-not (Test-Command "python")) {
    Write-Host "`n[ERROR] Python not found. Please install Python 3.10+." -ForegroundColor Red
    Write-Host "Download: https://www.python.org/downloads/" -ForegroundColor Cyan
    exit 1
}

$pyVersion = Get-Version "python" "(\d+\.\d+)"
if ([version]$pyVersion -lt [version]"3.10") {
    Write-Host "`n[ERROR] Python version $pyVersion too old, need 3.10+" -ForegroundColor Red
    exit 1
}
Write-Ok "Python $pyVersion"

if (-not (Test-Command "node")) {
    Write-Host "`n[ERROR] Node.js not found. Please install Node.js 18+." -ForegroundColor Red
    Write-Host "Download: https://nodejs.org/" -ForegroundColor Cyan
    exit 1
}

$nodeVersion = Get-Version "node" "v?(\d+)"
if ([int]$nodeVersion -lt 18) {
    Write-Host "`n[ERROR] Node.js version $nodeVersion too old, need 18+" -ForegroundColor Red
    exit 1
}
Write-Ok "Node.js $(node --version)"

# ==================== 2. Virtual env (optional) ====================
$pythonCmd = "python"
if ($UseVenv) {
    Write-Step "Creating virtual environment"
    if (-not (Test-Path ".venv")) {
        python -m venv .venv
    }
    & ".venv\Scripts\Activate.ps1"
    $pythonCmd = ".venv\Scripts\python"
    Write-Ok "Virtual env activated"
}

# ==================== 3. Set mirrors ====================
if ($UseMirror) {
    Write-Step "Setting up China mirrors"

    $pipConfigDir = "$env:APPDATA\pip"
    if (-not (Test-Path $pipConfigDir)) {
        New-Item -ItemType Directory -Path $pipConfigDir | Out-Null
    }
    @"
[global]
index-url = https://pypi.tuna.tsinghua.edu.cn/simple
trusted-host = pypi.tuna.tsinghua.edu.cn
"@ | Set-Content "$pipConfigDir\pip.ini" -Encoding UTF8
    Write-Ok "pip: Tsinghua mirror set"

    & $npmCmd config set registry https://registry.npmmirror.com
    Write-Ok "npm: Taobao mirror set"
} else {
    Write-Warn "Tip: if network is slow, re-run with -UseMirror"
}

# ==================== 4. Install backend ====================
Write-Step "Installing backend dependencies"

$reqFile = "requirements.txt"
if ($FullInstall) {
    $reqFile = "requirements-full.txt"
    Write-Warn "Full version ~400MB (ONNX instead of PyTorch), may take 3~8 min"
    Write-Info "If stuck >20 min, press Ctrl+C and retry with -UseMirror"
} else {
    Write-Info "Lightweight core ~50MB. For vector memory + file analysis, add -FullInstall"
}
Set-Location backend

Write-Info "Upgrading pip / setuptools / wheel..."
& $pythonCmd -m pip install --upgrade pip setuptools wheel 2>&1 | Out-Null
Write-Ok "Build tools updated"

$pipExtraArgs = @("--prefer-binary")
if ($UseMirror) {
    $pipExtraArgs += "-i"; $pipExtraArgs += "https://pypi.tuna.tsinghua.edu.cn/simple"
    $pipExtraArgs += "--trusted-host"; $pipExtraArgs += "pypi.tuna.tsinghua.edu.cn"
}

Write-Info "Installing Python packages..."
try {
    & $pythonCmd -m pip install -r $reqFile @pipExtraArgs
    if ($LASTEXITCODE -ne 0) { throw "pip install returned non-zero exit code" }
} catch {
    Write-Host "`n[ERROR] Backend install failed. Common causes:" -ForegroundColor Red
    Write-Host "  1. Unstable network (re-run with -UseMirror)" -ForegroundColor Yellow
    Write-Host "  2. Python not in PATH (reinstall with 'Add to PATH' checked)" -ForegroundColor Yellow
    Write-Host "  3. Insufficient disk space (need at least 3GB free)" -ForegroundColor Yellow
    exit 1
}

Write-Ok "Backend dependencies installed"
Set-Location ..

# ==================== 5. Install frontend ====================
Write-Step "Installing frontend dependencies"
Set-Location frontend

Write-Info "Installing Node packages..."
try {
    & $npmCmd install
    if ($LASTEXITCODE -ne 0) { throw "npm install returned non-zero exit code" }
} catch {
    Write-Host "`n[ERROR] Frontend install failed." -ForegroundColor Red
    Write-Host "  If you encounter PowerShell execution policy issues, use CMD:" -ForegroundColor Yellow
    Write-Host "    cd frontend" -ForegroundColor Cyan
    Write-Host "    npm.cmd install" -ForegroundColor Cyan
    exit 1
}

Write-Ok "Frontend dependencies installed"
Set-Location ..

# ==================== 6. Install CLI (optional) ====================
$installCli = Read-Host "`nInstall CLI tools? (y/N)"
if ($installCli -match "^[Yy]") {
    Write-Step "Installing CLI"
    Set-Location cli
    & $pythonCmd -m pip install -e . --prefer-binary
    Set-Location ..
    Write-Ok "CLI installed"
}

# ==================== 7. Done ====================
$elapsed = [math]::Round(((Get-Date) - $startTime).TotalSeconds)
Write-Step "Done"
Write-Ok "Time: ${elapsed} seconds"

Write-Host "`nStart:" -ForegroundColor Cyan
Write-Host "  .\start.ps1" -ForegroundColor White
Write-Host "`nStop:" -ForegroundColor Cyan
Write-Host "  .\stop.ps1" -ForegroundColor White
