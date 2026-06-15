@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title agent-me - 停止

echo ==================================
echo       停止 agent-me...
echo ==================================
echo.

REM ---------- 1. Kill by PID file ----------
set PID_FILE=%~dp0..\running_pids.txt
set killed=0
if exist "%PID_FILE%" (
    echo 通过 PID 文件停止...
    for /f "usebackq tokens=1" %%i in ("%PID_FILE%") do (
        taskkill /F /PID %%i >nul 2>&1
        if !errorlevel! equ 0 (
            set /a killed+=1
            echo [OK] 已停止 PID %%i
        )
    )
    del "%PID_FILE%"
    timeout /t 2 /nobreak >nul
)

REM ---------- 2. Kill by port ----------
echo 检查端口...
for %%p in (8000 3000) do (
    for /f "tokens=5" %%i in ('netstat -ano ^| findstr ":%%p "') do (
        taskkill /F /PID %%i >nul 2>&1 && (
            set /a killed+=1
            echo [OK] 已释放端口 %%p
        )
    )
)

timeout /t 2 /nobreak >nul

REM ---------- 3. Verify ----------
echo.
echo 验证端口...
set all_clear=1
for %%p in (8000 3000) do (
    netstat -ano | findstr ":%%p " >nul && (
        echo [警告] 端口 %%p 仍在占用，可用: netstat -ano ^| findstr ":%%p"
        set all_clear=0
    ) || (
        echo [OK] 端口 %%p 已释放
    )
)

echo.
if %all_clear% equ 1 (
    echo agent-me 已完全停止
) else (
    echo 部分端口仍被占用，请手动检查任务管理器
)
echo ==================================
echo.
if %killed% equ 0 (
    echo 未发现运行中的进程，可能已经停止
)
pause
endlocal
