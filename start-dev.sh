#!/bin/bash
echo "=========================================="
echo "      Smart Scheduler - Dev Starter"
echo "=========================================="

cd "$(dirname "$0")"

export PATH="/Applications/Docker.app/Contents/Resources/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

# Load .env so variables are available to this script too
if [ -f .env ]; then
    set -a; source .env; set +a
    echo "Loaded .env"
else
    echo "Warning: .env not found"
fi

export ENVIRONMENT=development
export FRONTEND_URL=http://localhost:5173

# Determine docker compose command
if docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
    DOCKER_COMPOSE_CMD="docker-compose"
else
    echo "Error: Docker not found. Please install Docker Desktop."
    exit 1
fi

# Ensure Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "Starting Docker Desktop..."
    open -a Docker
    count=0
    while ! docker info >/dev/null 2>&1; do
        sleep 5; count=$((count+1))
        echo "Waiting for Docker... ($count/20)"
        [ $count -ge 20 ] && echo "Timed out." && exit 1
    done
    echo "Docker is up!"
fi

echo "[1/2] Starting Backend (Docker)..."
$DOCKER_COMPOSE_CMD down
$DOCKER_COMPOSE_CMD up --build -d api

echo "[2/2] Starting Frontend (Vite)..."
cd frontend
[ ! -d "node_modules" ] && npm install
npm run dev
