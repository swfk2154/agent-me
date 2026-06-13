# agent-me Shutdown Script (Windows)
# 彻底关闭通过 start.ps1 启动的后端和前端服务

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Info($msg)  { Write-Host "   $msg" -ForegroundColor Gray }
function Write-Ok($msg)    { Write-Host "   $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "   $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "   $msg" -ForegroundColor Red }

Write-Host ""
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "  agent-me 正在关闭..." -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

$killed = @()
$failed = @()

# ---------- 1. 按 PID 文件精确关闭 ----------

$pidFile = Join-Path $root "running_pids.txt"
if (Test-Path $pidFile) {
    $pids = @(Get-Content $pidFile | Where-Object { $_ -match '^\d+$' })
    foreach ($pid in $pids) {
        try {
            $proc = Get-Process -Id $pid -ErrorAction Stop
            $name = $proc.ProcessName
            Stop-Process -Id $pid -Force -ErrorAction Stop
            Write-Ok "已关闭 $name (PID $pid)"
            $killed += $pid
        } catch {
            Write-Warn "PID $pid 已不存在或无法关闭"
        }
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    Write-Info "已删除 PID 文件"
}

# ---------- 2. 按端口回退清理（杀掉所有残余进程） ----------

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
                    # 只杀已知的服务进程，避免误杀
                    $isTarget = $names | Where-Object { $pname -like "*$_*" }
                    if ($isTarget) {
                        Stop-Process -Id $_ -Force -ErrorAction Stop
                        Write-Ok "端口 $port 已释放 ($pname, PID $_)"
                        $script:killed += $_
                        $found = $true
                    }
                } catch {
                    Write-Warn "端口 $port 进程 $_ 无法关闭"
                    $script:failed += $_
                }
            }
    } catch {}
    return $found
}

Write-Host ""
Write-Host "检查端口占用..." -ForegroundColor Cyan

# 后端端口 (python / uvicorn)
$backendKilled = Kill-ByPort 8000 @("python", "uvicorn")

# 前端端口 (node / npm / vite)
$frontendKilled = Kill-ByPort 3000 @("node", "npm", "vite")

if (-not $backendKilled -and -not $frontendKilled -and $killed.Count -eq 0) {
    Write-Info "没有检测到运行中的 agent-me 进程"
}

# ---------- 3. 验证端口是否已释放 ----------

Write-Host ""
Write-Host "验证关闭结果..." -ForegroundColor Cyan
Start-Sleep -Seconds 2

$allClear = $true
foreach ($p in @(8000, 3000)) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $p -ErrorAction Stop |
                Where-Object { $_.State -eq "Listen" }
        if ($conn) {
            Write-Err "端口 $p 仍被占用 (PID $($conn.OwningProcess))"
            $allClear = $false
        } else {
            Write-Ok "端口 $p 已释放"
        }
    } catch {
        Write-Ok "端口 $p 已释放"
    }
}

# ---------- 4. 显示结果，窗口保持打开 ----------

Write-Host ""
Write-Host "==================================" -ForegroundColor Cyan
if ($allClear) {
    Write-Ok "agent-me 已完全关闭"
} else {
    Write-Warn "部分端口仍被占用"
    Write-Info "请手动在任务管理器中结束对应进程"
}
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "按 Enter 键关闭此窗口..." -ForegroundColor Gray
Read-Host
