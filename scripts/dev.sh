#!/usr/bin/env bash
# 同时启动 FastAPI (7860) 与 Next.js dev (3000)
# 浏览器打开 http://127.0.0.1:3000
set -euo pipefail
cd "$(dirname "$0")/.."

# 后端 (后台)
mkdir -p logs
./scripts/stop.sh >/dev/null 2>&1 || true
nohup .venv/bin/python app.py >> logs/app.log 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID > .aisinger.pid
echo "→ FastAPI  pid=$BACKEND_PID  http://127.0.0.1:7860"

cleanup() {
  echo "stopping backend ..."
  kill "$BACKEND_PID" 2>/dev/null || true
  rm -f .aisinger.pid
}
trap cleanup EXIT INT TERM

# 前端 (前台)
echo "→ Next.js  http://127.0.0.1:3000"
cd frontend && pnpm dev
