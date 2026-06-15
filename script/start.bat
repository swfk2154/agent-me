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
set PID_FILE=%~dp0..\running_pids.txt
if exist "%PID_FILE%" (
    echo 清理旧进程...
    for /f "usebackq tokens=1" %%i in ("%PID_FILE%") do (
        taskkill /F /PID %%i >nul 2>&1
    )
    del "%PID_FILE%"
)
REM 按端口补杀
for %%p in (8000 3000) do (
    for /f "tokens=5" %%i in ('netstat -ano ^| findstr ":%%p "') do (
        taskkill /F /PID %%i >nul 2>&1
    )
)
timeout /t 1 /nobreak >nul

REM ---------- 3. Check dependencies ----------
if not exist "%~dp0..\frontend\node_modules" (
    echo [错误] 前端依赖未安装，请先运行 install.bat
    echo   或手动: cd frontend ^&^& npm install
    pause
    exit /b 1
)
echo [OK] 依赖检查通过
echo.

REM ---------- 4. Start backend ----------
echo 启动后端...

REM 使用 pythonw.exe 启动，无窗口、不占任务栏
REM 运行日志输出到文件，不阻塞任何窗口
set BE_LOG=%~dp0..\backend\storage\logs\backend.log
if not exist "%~dp0..\backend\storage\logs" mkdir "%~dp0..\backend\storage\logs"

start "" /B python -m uvicorn main:app --port 8000 --host 127.0.0.1 > "%BE_LOG%" 2>&1

REM 等后端就绪
echo 等待后端就绪（首次启动约 15-20 秒）...
set ready=0
for /l %%i in (1,1,45) do (
    timeout /t 1 /nobreak >nul
    powershell -Command "try { (Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/health' -TimeoutSec 2).StatusCode -eq 200 } catch { $false }" >nul 2>&1
    if !errorlevel! equ 0 (
        set ready=1
        goto ready_done
    )
)
:ready_done
if %ready% equ 1 ( echo [OK] 后端就绪 ) else ( echo [警告] 后端可能未就绪，可查看日志: %BE_LOG% )

REM ---------- 5. Start frontend ----------
echo 启动前端...
set FE_LOG=%~dp0..\backend\storage\logs\frontend.log

REM 前端：用 start "" /MIN 极小化窗口，肉眼几乎看不到
start "agent-me" /MIN cmd /c "cd /d "%~dp0..\frontend" && npm run dev > "%FE_LOG%" 2>&1"

REM ---------- 6. Save PIDs ----------
REM 按端口号保存真实的进程 PID（不是 CMD 窗口 PID）
for /f "tokens=5" %%i in ('netstat -ano ^| findstr ":8000 "') do set BACKEND_PID=%%i
for /f "tokens=5" %%i in ('netstat -ano ^| findstr ":3000 "') do set FRONTEND_PID=%%i

set PID_FILE=%~dp0..\running_pids.txt
if defined BACKEND_PID echo %BACKEND_PID% > "%PID_FILE%"
if defined FRONTEND_PID echo %FRONTEND_PID% >> "%PID_FILE%"

REM ---------- 7. Done ----------
echo.
echo ==================================
echo   agent-me 启动完成
echo.
echo   后端: http://127.0.0.1:8000
echo   前端: http://127.0.0.1:3000
echo.
echo   后端已在后台静默运行（无窗口）
echo   前端窗口极小化在任务栏底部
echo.
echo   停止请运行: stop.bat
echo ==================================
echo.
pause
endlocal
