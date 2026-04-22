#!/bin/bash
echo "=========================================="
echo "      Smart Scheduler - Dev Starter"
echo "=========================================="

# Ensure we are in the script's directory
cd "$(dirname "$0")"

# Ensure docker and npm are in path for Mac local environments
export PATH="/Applications/Docker.app/Contents/Resources/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

# 1. Determine which docker compose command to use
if docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
    DOCKER_COMPOSE_CMD="docker-compose"
else
    echo "Error: Neither 'docker compose' nor 'docker-compose' found."
    echo "Please install Docker Desktop."
    exit 1
fi

echo "Using: $DOCKER_COMPOSE_CMD"

# 2. Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "Docker is not running. Attempting to start Docker Desktop..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        open -a Docker
    else
        echo "Please start Docker manually and run this script again."
        exit 1
    fi
    
    echo "Waiting for Docker to start... (this may take a minute)"
    # Wait loop
    count=0
    while ! docker info >/dev/null 2>&1; do
        sleep 5
        count=$((count+1))
        echo "Waiting for Docker... ($count/20)"
        if [ $count -ge 20 ]; then
            echo "Timed out waiting for Docker to respond. Please start it manually and try again."
            exit 1
        fi
    done
    echo "Docker is up and running!"
fi

echo "[1/3] Stopping old containers..."
$DOCKER_COMPOSE_CMD down

echo "[2/3] Starting Backend (Docker)..."
# Start backend in detached mode (-d)
$DOCKER_COMPOSE_CMD up --build -d api

echo "[3/3] Starting Frontend (Vite)..."
cd frontend
# Ensure dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install
fi

# Run the frontend
npm run dev
