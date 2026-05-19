#!/bin/bash
echo "=========================================="
echo "      Smart Scheduler - Dev Starter"
echo "=========================================="

cd "$(dirname "$0")"

# Load .env variables
if [ -f .env ]; then
    set -a
    source .env
    set +a
    echo "Loaded .env"
else
    echo "Warning: .env not found — backend may be missing credentials"
fi

# Override for local dev
export ENVIRONMENT=development
export FRONTEND_URL=http://localhost:5173

# Start backend with uvicorn in background
echo "[1/2] Starting Backend (uvicorn)..."
cd backend/api
uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!
cd ../..

echo "[2/2] Starting Frontend (Vite)..."
cd frontend
if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install
fi

npm run dev

# Kill backend when frontend exits
kill $BACKEND_PID 2>/dev/null
