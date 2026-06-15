@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title agent-me - 停止

echo ==================================
echo       停止 agent-me...
echo ==================================
echo.

REM ---------- 1. Kill by PID file ----------
set PID_FILE=%~dp0running_pids.txt
if exist "%PID_FILE%" (
    echo 通过 PID 文件停止...
    for /f "usebackq tokens=1" %%i in ("%PID_FILE%") do (
        taskkill /F /PID %%i >nul 2>&1 && echo [OK] 已停止 PID %%i
    )
    del "%PID_FILE%"
    timeout /t 1 /nobreak >nul
)

REM ---------- 2. Kill by port ----------
echo 检查端口...
for %%p in (8000 3000) do (
    for /f "tokens=5" %%i in ('netstat -ano ^| findstr ":%%p "') do (
        taskkill /F /PID %%i >nul 2>&1
    )
)

timeout /t 1 /nobreak >nul

REM ---------- 3. Verify ----------
echo.
echo 验证端口...
set all_clear=1
for %%p in (8000 3000) do (
    netstat -ano | findstr ":%%p " >nul && (
        echo [警告] 端口 %%p 仍在占用
        set all_clear=0
    ) || (
        echo [OK] 端口 %%p 空闲
    )
)

echo.
if !all_clear! equ 1 (
    echo agent-me 已停止
) else (
    echo 部分端口仍被占用，请手动检查任务管理器
)
echo ==================================
echo.
pause
endlocal
