@echo off
rem agent-me v3 — 启动 Web 模式（双击即可，浏览器打开 http://127.0.0.1:8080）
cd /d "%~dp0\.."
if not exist web\dist\index.html (
    echo [agent-me] 首次运行，构建前端...
    call npm run build:web
)
echo.
echo  === agent-me v3 Web ===
echo  浏览器打开: http://127.0.0.1:8080
echo  Ctrl+C 停止服务
echo.
node src\cli.ts serve
echo.
pause
