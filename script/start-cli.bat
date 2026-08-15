@echo off
rem agent-me v3 — 启动 CLI 交互模式（双击即可）
cd /d "%~dp0\.."
echo.
echo  === agent-me v3 CLI ===
echo  - 首次使用请先运行: node src\cli.ts config set ^<provider^>
echo  - 例如: node src\cli.ts config set deepseek
echo.
node src\cli.ts chat
echo.
pause
