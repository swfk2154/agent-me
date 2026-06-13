# agent-me 一键安装脚本 (Windows PowerShell)
# 功能：环境检测、镜像加速、零报错安装、进度显示

param(
    [switch]$UseMirror,
    [switch]$UseVenv,
    [switch]$FullInstall
)

$ErrorActionPreference = "Stop"
$startTime = Get-Date

function Write-Step($msg) {
    Write-Host "`n==> $msg" -ForegroundColor Cyan
}

function Write-Info($msg) {
    Write-Host "   $msg" -ForegroundColor Gray
}

function Write-Ok($msg) {
    Write-Host "   $msg" -ForegroundColor Green
}

function Write-Warn($msg) {
    Write-Host "   $msg" -ForegroundColor Yellow
}

function Test-Command($cmd) {
    return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

function Get-Version($cmd, $pattern) {
    $output = & $cmd --version 2>&1 | Select-Object -First 1
    if ($output -match $pattern) {
        return $matches[1]
    }
    return $null
}

# ==================== 0. 前置检查 ====================
# 检测 npm 在 PowerShell 中是否可用（避免 npm.ps1 执行策略问题）
$npmCmd = "npm"
try {
    $null = Get-Command "npm.cmd" -ErrorAction Stop
    $npmCmd = "npm.cmd"
} catch {
    try {
        $null = Get-Command "npm" -ErrorAction Stop
    } catch {
        Write-Host "`n[错误] 未找到 npm。请先安装 Node.js 18+。" -ForegroundColor Red
        Write-Host "下载地址：https://nodejs.org/" -ForegroundColor Cyan
        exit 1
    }
}

# ==================== 1. 环境检测 ====================
Write-Step "检测运行环境"

if (-not (Test-Command "python")) {
    Write-Host "`n[错误] 未找到 Python。请先安装 Python 3.10+。" -ForegroundColor Red
    Write-Host "下载地址：https://www.python.org/downloads/" -ForegroundColor Cyan
    exit 1
}

$pyVersion = Get-Version "python" "(\d+\.\d+)"
if ([version]$pyVersion -lt [version]"3.10") {
    Write-Host "`n[错误] Python 版本 $pyVersion 过低，需要 3.10+" -ForegroundColor Red
    exit 1
}
Write-Ok "Python $pyVersion"

if (-not (Test-Command "node")) {
    Write-Host "`n[错误] 未找到 Node.js。请先安装 Node.js 18+。" -ForegroundColor Red
    Write-Host "下载地址：https://nodejs.org/" -ForegroundColor Cyan
    exit 1
}

$nodeVersion = Get-Version "node" "v?(\d+)"
if ([int]$nodeVersion -lt 18) {
    Write-Host "`n[错误] Node.js 版本 $nodeVersion 过低，需要 18+" -ForegroundColor Red
    exit 1
}
Write-Ok "Node.js $(node --version)"

# ==================== 2. 虚拟环境 (可选) ====================
$pythonCmd = "python"
if ($UseVenv) {
    Write-Step "创建虚拟环境"
    if (-not (Test-Path ".venv")) {
        python -m venv .venv
    }
    & ".venv\Scripts\Activate.ps1"
    $pythonCmd = ".venv\Scripts\python"
    Write-Ok "已激活虚拟环境"
}

# ==================== 3. 配置镜像源 ====================
if ($UseMirror) {
    Write-Step "配置国内镜像源"

    # pip
    $pipConfigDir = "$env:APPDATA\pip"
    if (-not (Test-Path $pipConfigDir)) {
        New-Item -ItemType Directory -Path $pipConfigDir | Out-Null
    }
    @"
[global]
index-url = https://pypi.tuna.tsinghua.edu.cn/simple
trusted-host = pypi.tuna.tsinghua.edu.cn
"@ | Set-Content "$pipConfigDir\pip.ini" -Encoding UTF8
    Write-Ok "pip 已切换至清华镜像"

    # npm
    & $npmCmd config set registry https://registry.npmmirror.com
    Write-Ok "npm 已切换至淘宝镜像"
} else {
    Write-Warn "提示：国内网络较慢可加 -UseMirror 参数启用镜像加速"
}

# ==================== 4. 安装后端依赖 ====================
Write-Step "安装后端依赖"

$reqFile = "requirements.txt"
if ($FullInstall) {
    $reqFile = "requirements-full.txt"
    Write-Warn "完整版依赖约 400MB（ONNX 嵌入替代 PyTorch），首次安装可能需要 3~8 分钟"
    Write-Info "如果卡住超过 20 分钟，请检查网络或按 Ctrl+C 中断后加 -UseMirror 重试"
} else {
    Write-Info "安装轻量版核心依赖（约 50MB）。如需向量记忆 + 文件分析，加 -FullInstall 参数"
}
Set-Location backend

# 先升级 pip/setuptools/wheel，避免编译 C 扩展时失败
Write-Info "升级 pip / setuptools / wheel..."
& $pythonCmd -m pip install --upgrade pip setuptools wheel 2>&1 | Out-Null
Write-Ok "工具链已更新"

# 安装依赖：优先使用预编译 wheel，避免从源码编译（耗时且易失败）
$pipExtraArgs = @("--prefer-binary")
if ($UseMirror) {
    $pipExtraArgs += "-i"
    $pipExtraArgs += "https://pypi.tuna.tsinghua.edu.cn/simple"
    $pipExtraArgs += "--trusted-host"
    $pipExtraArgs += "pypi.tuna.tsinghua.edu.cn"
}

Write-Info "开始安装 Python 依赖..."
try {
    & $pythonCmd -m pip install -r $reqFile @pipExtraArgs
    if ($LASTEXITCODE -ne 0) { throw "pip install 返回非零退出码" }
} catch {
    Write-Host "`n[错误] 后端依赖安装失败。常见原因：" -ForegroundColor Red
    Write-Host "  1. 网络不稳定（国内建议加 -UseMirror 参数）" -ForegroundColor Yellow
    Write-Host "  2. Python 未勾选 'Add to PATH'（重装 Python 时勾选）" -ForegroundColor Yellow
    Write-Host "  3. 磁盘空间不足（需要至少 3GB 可用空间）" -ForegroundColor Yellow
    exit 1
}

Write-Ok "后端依赖安装完成"
Set-Location ..

# ==================== 5. 安装前端依赖 ====================
Write-Step "安装前端依赖"
Set-Location frontend

Write-Info "开始安装 Node 依赖..."
try {
    & $npmCmd install
    if ($LASTEXITCODE -ne 0) { throw "npm install 返回非零退出码" }
} catch {
    Write-Host "`n[错误] 前端依赖安装失败。" -ForegroundColor Red
    Write-Host "  如果在 PowerShell 中遇到执行策略问题，请改用 CMD 运行：" -ForegroundColor Yellow
    Write-Host "    cd frontend" -ForegroundColor Cyan
    Write-Host "    npm.cmd install" -ForegroundColor Cyan
    exit 1
}

Write-Ok "前端依赖安装完成"
Set-Location ..

# ==================== 6. 安装 CLI (可选) ====================
$installCli = Read-Host "`n是否安装 CLI 工具？(y/N)"
if ($installCli -match "^[Yy]") {
    Write-Step "安装 CLI 工具"
    Set-Location cli
    & $pythonCmd -m pip install -e . --prefer-binary
    Set-Location ..
    Write-Ok "CLI 安装完成"
}

# ==================== 7. 完成 ====================
$elapsed = [math]::Round(((Get-Date) - $startTime).TotalSeconds)
Write-Step "安装完成"
Write-Ok "总耗时: ${elapsed} 秒"

Write-Host "`n启动项目:" -ForegroundColor Cyan
Write-Host "  .\start.ps1" -ForegroundColor White
Write-Host "`n停止项目:" -ForegroundColor Cyan
Write-Host "  .\stop.ps1" -ForegroundColor White
