# agent-me Startup Script
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "=== agent-me v2.1 ===" -ForegroundColor Cyan

# Kill old — only uvicorn (backend) and node/npm (frontend) to avoid collateral damage
function Stop-ProcessByPort {
    param([int]$Port, [string[]]$ProcessNames)
    Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        Where-Object { $_ -ne 0 } |
        ForEach-Object {
            try {
                $proc = Get-Process -Id $_ -ErrorAction Stop
                $name = $proc.ProcessName.ToLower()
                # Only kill known backend/frontend processes
                if ($ProcessNames | Where-Object { $name -like "*$_*" }) {
                    Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
                }
            } catch {}
        }
}

Stop-ProcessByPort -Port 8000 -ProcessNames @("uvicorn", "python")
Stop-ProcessByPort -Port 3000 -ProcessNames @("node", "npm", "vite")

# Start
$b = Start-Process -FilePath "uvicorn" -ArgumentList "main:app --port 8000" -WorkingDirectory "$root\backend" -WindowStyle Hidden -PassThru
$f = Start-Process -FilePath "cmd" -ArgumentList "/c npm run dev" -WorkingDirectory "$root\frontend" -WindowStyle Hidden -PassThru
"$($b.Id)`n$($f.Id)" | Out-File -FilePath "$root\running_pids.txt" -Encoding utf8

Write-Host "Backend  http://localhost:8000 (PID $($b.Id))"
Write-Host "Frontend http://localhost:3000 (PID $($f.Id))"
Write-Host "Stop: stop.ps1"
Write-Host "========================" -ForegroundColor Cyan
