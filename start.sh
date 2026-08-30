#!/usr/bin/env bash
set -e

# Navigate to project root directory
cd "$(dirname "$0")"

# Free port 5001 if already occupied
PORT_PID=$(lsof -t -i:5001 2>/dev/null || true)
if [ -n "$PORT_PID" ]; then
  echo "🔄 Freeing port 5001 (PID $PORT_PID)..."
  kill -9 $PORT_PID 2>/dev/null || true
  sleep 0.5
fi

echo "⚡ Building React frontend..."
npm run build --prefix frontend

echo "🚀 Starting Flask backend & portal on http://localhost:5001..."
./venv/bin/python app.py
