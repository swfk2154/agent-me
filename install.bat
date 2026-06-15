@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title agent-me 安装

echo ==================================
echo    agent-me 一键安装脚本
echo ==================================
echo.

REM ==================== 参数解析 ====================
set USE_MIRROR=0
set USE_VENV=0
set FULL_INSTALL=0

:parse_args
if "%1"=="" goto check_env
if /i "%1"=="--mirror" set USE_MIRROR=1& shift & goto parse_args
if /i "%1"=="--full" set FULL_INSTALL=1& shift & goto parse_args
if /i "%1"=="--venv" set USE_VENV=1& shift & goto parse_args
if /i "%1"=="/?" goto help
if /i "%1"=="-h" goto help
if /i "%1"=="--help" goto help
echo 未知参数: %1
goto help

:help
echo 用法: install.bat [--mirror] [--venv] [--full]
echo.
echo   --mirror  使用国内镜像源加速（强烈推荐）
echo   --venv    使用 Python 虚拟环境
echo   --full    完整版（含向量记忆+文件分析，约 400MB）
echo.
echo 示例:
echo   install.bat --mirror                轻量版+国内镜像
echo   install.bat --full --mirror --venv  完整版+镜像+虚拟环境
pause
exit /b 0

REM ==================== 1. 环境检测 ====================
:check_env
echo [1/5] 检测运行环境...

python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Python。请安装 Python 3.10+
    pause
    exit /b 1
)
for /f "tokens=2" %%i in ('python --version 2^>^&1') do set pyver=%%i
echo   Python %pyver%

node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js。请安装 Node.js 18+
    pause
    exit /b 1
)
for /f "tokens=1" %%i in ('node --version') do set nodever=%%i
echo   Node.js %nodever%
echo.

REM ==================== 2. 虚拟环境 ====================
set PYTHON_CMD=python
if %USE_VENV% equ 1 (
    echo [2/5] 创建虚拟环境...
    if not exist ".venv" (
        python -m venv .venv
    )
    set PYTHON_CMD=%~dp0.venv\Scripts\python
    echo   虚拟环境已激活
) else (
    echo [2/5] 跳过虚拟环境（全局安装）
)
echo.

REM ==================== 3. 镜像源 ====================
if %USE_MIRROR% equ 1 (
    echo [3/5] 配置国内镜像源...
    REM pip 换清华源
    mkdir "%APPDATA%\pip" >nul 2>&1
    (
        echo [global]
        echo index-url = https://pypi.tuna.tsinghua.edu.cn/simple
        echo trusted-host = pypi.tuna.tsinghua.edu.cn
    ) > "%APPDATA%\pip\pip.ini"
    echo   pip: 清华镜像

    REM npm 换淘宝源
    call npm config set registry https://registry.npmmirror.com
    echo   npm: 淘宝镜像
) else (
    echo [3/5] 跳过镜像配置（网络慢时可加 --mirror）
)
echo.

REM ==================== 4. 安装后端 ====================
echo [4/5] 安装后端依赖...

if %FULL_INSTALL% equ 1 (
    set REQ_FILE=requirements-full.txt
    echo   完整版 ~400MB，首次安装 3~8 分钟属正常
) else (
    set REQ_FILE=requirements.txt
    echo   轻量版 ~50MB。如需完整版加 --full 参数
)

REM 进入 backend 目录
pushd "%~dp0backend"

echo   升级 pip/setuptools/wheel...
%PYTHON_CMD% -m pip install --upgrade pip setuptools wheel --quiet 2>nul

echo   安装 Python 包...
%PYTHON_CMD% -m pip install -r %REQ_FILE% --prefer-binary
if %errorlevel% neq 0 (
    popd
    echo [错误] 后端安装失败。
    echo   常见原因: 网络不稳定（加 --mirror）、磁盘空间不足
    pause
    exit /b 1
)
echo   后端依赖安装完成
popd
echo.

REM ==================== 5. 安装前端 ====================
echo [5/5] 安装前端依赖...

pushd "%~dp0frontend"
call npm install
if %errorlevel% neq 0 (
    popd
    echo [错误] 前端安装失败。请检查网络连接。
    echo   可尝试: cmd /c "cd frontend && npm install"
    pause
    exit /b 1
)
echo   前端依赖安装完成
popd
echo.

REM ==================== 完成 ====================
echo ==================================
echo   安装完成！
echo.
echo   启动: start.bat
echo   停止: stop.bat
echo ==================================
echo.
pause
endlocal
