@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title agent-me

echo ==================================
echo        agent-me v2.1
echo ==================================
echo.

REM ---------- 0. Check Python ----------
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Python。请安装 Python 3.10+
    echo 下载: https://www.python.org/downloads/
    pause
    exit /b 1
)
for /f "tokens=2" %%i in ('python --version 2^>^&1') do set pyver=%%i
echo [OK] Python %pyver%

REM ---------- 1. Check node ----------
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js。请安装 Node.js 18+
    pause
    exit /b 1
)
for /f "tokens=1" %%i in ('node --version') do set nodever=%%i
echo [OK] Node.js %nodever%
echo.

REM ---------- 2. Kill old processes ----------
set PID_FILE=%~dp0running_pids.txt
if exist "%PID_FILE%" (
    echo 清理旧进程...
    for /f "usebackq tokens=1" %%i in ("%PID_FILE%") do (
        taskkill /F /PID %%i >nul 2>&1
    )
    del "%PID_FILE%"
    timeout /t 1 /nobreak >nul
)

REM ---------- 3. Check dependencies ----------
if not exist "%~dp0frontend\node_modules" (
    echo [错误] 前端依赖未安装，请先运行 install.bat
    echo   或手动: cd frontend && npm install
    pause
    exit /b 1
)
echo [OK] 依赖检查通过
echo.

REM ---------- 4. Start backend ----------
echo 启动后端...

REM 确保日志目录存在
if not exist "%~dp0backend\storage\logs" mkdir "%~dp0backend\storage\logs"

start "agent-me-backend" /B python -m uvicorn main:app --port 8000 --host 127.0.0.1 > "%~dp0backend\storage\logs\backend.log" 2>&1

REM 等后端就绪
echo 等待后端就绪...
set ready=0
for /l %%i in (1,1,30) do (
    powershell -Command "try { (Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/health' -TimeoutSec 2).StatusCode -eq 200 } catch { $false }" >nul 2>&1
    if !errorlevel! equ 0 (
        set ready=1
        goto ready_done
    )
    timeout /t 1 /nobreak >nul
)
:ready_done
if %ready% equ 1 ( echo [OK] 后端就绪 ) else ( echo [警告] 后端可能未就绪 )

REM ---------- 4. Start frontend ----------
echo 启动前端...
start "agent-me-frontend" /B cmd /c "cd /d "%~dp0frontend" && npm run dev > "%~dp0backend\storage\logs\frontend.log" 2>&1"

REM ---------- 5. Done ----------
echo.
echo ==================================
echo   agent-me 已在后台启动
echo.
echo   后端: http://127.0.0.1:8000
echo   前端: http://127.0.0.1:3000
echo.
echo   关闭本窗口不会停止服务
echo   停止请运行: stop.bat
echo ==================================
echo.
pause
endlocal
