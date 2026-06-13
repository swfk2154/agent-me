# agent-me Shutdown Script
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "  Shutting down agent-me v2.1" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan

$killed = $false

# Kill by PID file first (direct child processes)
$pidfile = Join-Path $root "running_pids.txt"
if (Test-Path $pidfile) {
    Get-Content $pidfile | ForEach-Object {
        $p = $_.Trim()
        if ($p) {
            Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
            Write-Host "  Killed PID $p" -ForegroundColor Green
            $script:killed = $true
        }
    }
    Remove-Item $pidfile -Force
}

# Belt and suspenders: kill anything still on target ports
@(8000, 3000) | ForEach-Object {
    $port = $_
    Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        Where-Object { $_ -ne 0 } |
        ForEach-Object {
            Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
            if ($?) {
                Write-Host "  Killed port $port (PID $_)" -ForegroundColor Green
                $script:killed = $true
            }
        }
}

if (-not $killed) {
    Write-Host "  No running agent-me processes found" -ForegroundColor Yellow
}

Start-Sleep -Seconds 1

$left = @(8000, 3000) | ForEach-Object {
    Get-NetTCPConnection -LocalPort $_ -ErrorAction SilentlyContinue |
        Where-Object { $_.State -eq "Listen" }
}
if ($left.Count -eq 0) {
    Write-Host ""
    Write-Host "  agent-me stopped" -ForegroundColor Green
} else {
    Write-Host "  Warning: $($left.Count) port(s) still occupied" -ForegroundColor Red
}

Write-Host "==================================" -ForegroundColor Cyan
Start-Sleep -Seconds 2
