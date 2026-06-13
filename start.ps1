# agent-me Startup Script (Windows)
# 启动后端 + 前端，窗口保持打开，关闭窗口不影响后台服务

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ErrorActionPreference = "Stop"

function Write-Info($msg)  { Write-Host "   $msg" -ForegroundColor Gray }
function Write-Ok($msg)    { Write-Host "   $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "   $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "   $msg" -ForegroundColor Red }

Write-Host ""
Write-Host "=== agent-me v2.1 ===" -ForegroundColor Cyan
Write-Host ""

# ---------- 1. 环境检测 ----------

# Python：优先虚拟环境，其次全局
$pythonPath = $null
if (Test-Path "$root\.venv\Scripts\python.exe") {
    $pythonPath = "$root\.venv\Scripts\python.exe"
    Write-Info "使用虚拟环境 Python"
} elseif (Get-Command "python" -ErrorAction SilentlyContinue) {
    $pythonPath = "python"
    Write-Info "使用全局 Python"
} elseif (Get-Command "python3" -ErrorAction SilentlyContinue) {
    $pythonPath = "python3"
    Write-Info "使用全局 python3"
} else {
    Write-Err "未找到 Python。请先安装 Python 3.10+"
    Write-Info "下载地址: https://www.python.org/downloads/"
    Read-Host "`n按 Enter 键关闭"
    exit 1
}

# 检查 Python 版本
try {
    $pyVer = & $pythonPath --version 2>&1
    Write-Ok "$pyVer"
} catch {
    Write-Err "Python 路径无效: $pythonPath"
    Read-Host "`n按 Enter 键关闭"
    exit 1
}

# npm
$npmPath = $null
if (Get-Command "npm.cmd" -ErrorAction SilentlyContinue) {
    $npmPath = "npm.cmd"
} elseif (Get-Command "npm" -ErrorAction SilentlyContinue) {
    $npmPath = "npm"
} else {
    Write-Err "未找到 npm。请先安装 Node.js 18+"
    Write-Info "下载地址: https://nodejs.org/"
    Read-Host "`n按 Enter 键关闭"
    exit 1
}

try {
    $nodeVer = & node --version 2>&1
    Write-Ok "Node.js $nodeVer"
} catch {
    Write-Warn "无法检测 Node.js 版本"
}

# ---------- 2. 检查旧进程 ----------

$oldPids = @()
$pidFile = "$root\running_pids.txt"
if (Test-Path $pidFile) {
    $oldPids = @(Get-Content $pidFile | Where-Object { $_ -match '^\d+$' })
    if ($oldPids.Count -gt 0) {
        Write-Warn "检测到之前运行的进程，尝试关闭..."
        foreach ($pid in $oldPids) {
            try {
                Stop-Process -Id $pid -Force -ErrorAction Stop
                Write-Ok "已关闭旧进程 PID $pid"
            } catch {}
        }
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
}

# 检查端口占用
function Test-Port($port) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction Stop |
                Where-Object { $_.State -eq "Listen" } | Select-Object -First 1
        return $conn
    } catch { return $null }
}

foreach ($p in @(8000, 3000)) {
    if (Test-Port $p) {
        Write-Warn "端口 $p 被占用，尝试释放..."
        Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique |
            Where-Object { $_ -ne 0 } |
            ForEach-Object {
                try {
                    Stop-Process -Id $_ -Force -ErrorAction Stop
                    Write-Ok "已释放端口 $p (PID $_)"
                } catch {
                    Write-Err "无法释放端口 $p，请手动关闭占用该端口的程序"
                }
            }
        Start-Sleep -Seconds 1
    }
}

# ---------- 3. 启动后端 ----------

Write-Host ""
Write-Host "启动后端..." -ForegroundColor Cyan

try {
    $backend = Start-Process -FilePath $pythonPath `
        -ArgumentList "-m","uvicorn","main:app","--port","8000","--host","127.0.0.1" `
        -WorkingDirectory "$root\backend" `
        -WindowStyle Hidden `
        -PassThru
    Write-Ok "后端已启动  PID: $($backend.Id)  http://127.0.0.1:8000"
} catch {
    Write-Err "后端启动失败: $_"
    Read-Host "`n按 Enter 键关闭"
    exit 1
}

# 等待后端就绪
Write-Info "等待后端就绪..."
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/health" -TimeoutSec 2 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
    Start-Sleep -Milliseconds 500
}
if (-not $ready) {
    Write-Warn "后端启动较慢，继续启动前端..."
} else {
    Write-Ok "后端就绪"
}

# ---------- 4. 启动前端 ----------

Write-Host ""
Write-Host "启动前端..." -ForegroundColor Cyan

try {
    # 直接启动 npm，不用 cmd /c 包装，PID 就是 npm 本身
    $frontend = Start-Process -FilePath $npmPath `
        -ArgumentList "run","dev" `
        -WorkingDirectory "$root\frontend" `
        -WindowStyle Hidden `
        -PassThru
    Write-Ok "前端已启动  PID: $($frontend.Id)  http://127.0.0.1:3000"
} catch {
    Write-Err "前端启动失败: $_"
    # 后端已经在运行，尝试关闭
    try { Stop-Process -Id $backend.Id -Force } catch {}
    Read-Host "`n按 Enter 键关闭"
    exit 1
}

# ---------- 5. 保存 PID ----------

"$($backend.Id)`n$($frontend.Id)" | Out-File -FilePath $pidFile -Encoding utf8 -Force
Write-Info "PID 已保存到 running_pids.txt"

# ---------- 6. 显示信息，窗口保持打开 ----------

Write-Host ""
Write-Host "==================================" -ForegroundColor Cyan
Write-Ok "agent-me 已启动"
Write-Host ""
Write-Host "   后端:  http://127.0.0.1:8000" -ForegroundColor White
Write-Host "   前端:  http://127.0.0.1:3000" -ForegroundColor White
Write-Host ""
Write-Host "   关闭此窗口不会影响服务运行" -ForegroundColor Green
Write-Host "   停止服务请运行: .\stop.ps1" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

# 保持窗口打开，让用户自己关闭
# Start-Process 创建的进程独立于当前 PowerShell 会话，
# 关闭此窗口或按 Ctrl+C 都不会影响后台服务
Write-Host "窗口保持打开中，请手动关闭..." -ForegroundColor Gray
try {
    while ($true) { Start-Sleep -Seconds 1 }
} catch {
    # Ctrl+C 或关闭窗口 — 忽略，子进程不受影响
}
