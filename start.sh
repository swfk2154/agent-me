#!/bin/bash
# agent-me Startup Script — macOS / Linux

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== agent-me v2.1 ==="

mkdir -p backend/storage/logs

# Check if ports are occupied
check_port() {
    lsof -ti:$1 2>/dev/null | head -1
}

if [ -n "$(check_port 8000)" ]; then
    echo "Port 8000 is occupied. Run ./stop.sh first."
    exit 1
fi

if [ -n "$(check_port 3000)" ]; then
    echo "Port 3000 is occupied. Run ./stop.sh first."
    exit 1
fi

# Start backend
cd backend
nohup python3 -m uvicorn main:app --port 8000 > ../backend/storage/logs/backend.log 2>&1 &
BACKEND_PID=$!
echo "Backend  http://localhost:8000 (PID $BACKEND_PID)"

# Start frontend
cd ../frontend
nohup npm run dev > ../backend/storage/logs/frontend.log 2>&1 &
FRONTEND_PID=$!
echo "Frontend http://localhost:3000 (PID $FRONTEND_PID)"

# Save PIDs
echo -e "$BACKEND_PID\n$FRONTEND_PID" > "$SCRIPT_DIR/running_pids.txt"

echo "Stop: ./stop.sh"
echo "========================"
