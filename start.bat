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
    echo   或手动: cd frontend ^&^& npm install
    pause
    exit /b 1
)
echo [OK] 依赖检查通过
echo.

REM ---------- 4. Start backend ----------
echo 启动后端...

REM 确保日志目录存在
if not exist "%~dp0backend\storage\logs" mkdir "%~dp0backend\storage\logs"

REM 用 PowerShell 创建真正独立的进程（不绑定当前窗口）
powershell -Command "Start-Process -FilePath python -ArgumentList '-m uvicorn main:app --port 8000 --host 127.0.0.1' -WorkingDirectory '%~dp0backend' -WindowStyle Hidden -RedirectStandardOutput '%~dp0backend\storage\logs\backend.log' -RedirectStandardError '%~dp0backend\storage\logs\backend.log' -PassThru | Select-Object -ExpandProperty Id" > "%TEMP%\agent-me-backend-pid.txt" 2>&1
set /p BACKEND_PID=<"%TEMP%\agent-me-backend-pid.txt"
del "%TEMP%\agent-me-backend-pid.txt"
echo   后端 PID: %BACKEND_PID%

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

REM ---------- 5. Start frontend ----------
echo 启动前端...
powershell -Command "Start-Process -FilePath cmd -ArgumentList '/c cd /d \"%~dp0frontend\" && npm run dev' -WindowStyle Hidden -RedirectStandardOutput '%~dp0backend\storage\logs\frontend.log' -RedirectStandardError '%~dp0backend\storage\logs\frontend.log' -PassThru | Select-Object -ExpandProperty Id" > "%TEMP%\agent-me-frontend-pid.txt" 2>&1
set /p FRONTEND_PID=<"%TEMP%\agent-me-frontend-pid.txt"
del "%TEMP%\agent-me-frontend-pid.txt"
echo   前端 PID: %FRONTEND_PID%

REM ---------- 6. Save PIDs ----------
echo %BACKEND_PID% > "%PID_FILE%"
echo %FRONTEND_PID% >> "%PID_FILE%"
echo [OK] PIDs saved

REM ---------- 7. Done ----------
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
