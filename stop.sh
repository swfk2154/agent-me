#!/bin/bash
# agent-me Shutdown Script — macOS / Linux

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=================================="
echo "  Shutting down agent-me v2.1"
echo "=================================="

KILLED=false

# Kill by PID file first
PIDFILE="$SCRIPT_DIR/running_pids.txt"
if [ -f "$PIDFILE" ]; then
    while IFS= read -r pid; do
        pid=$(echo "$pid" | tr -d '[:space:]')
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" 2>/dev/null
            echo "  Killed PID $pid"
            KILLED=true
        fi
    done < "$PIDFILE"
    rm -f "$PIDFILE"
fi

# Fallback: kill by port
kill_port() {
    local port=$1
    # Try lsof (macOS / Linux)
    local pids=$(lsof -ti:$port 2>/dev/null)
    if [ -n "$pids" ]; then
        echo "$pids" | xargs kill -9 2>/dev/null
        echo "  Killed port $port"
        KILLED=true
        return
    fi
    # Try fuser (Linux)
    if command -v fuser >/dev/null 2>&1; then
        fuser -k $port/tcp >/dev/null 2>&1
        if [ $? -eq 0 ]; then
            echo "  Killed port $port"
            KILLED=true
            return
        fi
    fi
}

kill_port 8000
kill_port 3000

if [ "$KILLED" = false ]; then
    echo "  No running agent-me processes found"
else
    echo ""
    echo "  agent-me stopped"
fi

echo "=================================="
