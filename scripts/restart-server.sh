#!/usr/bin/env bash
# 重启 FastAPI 后端 (端口 7860, 后台)。
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${AISINGER_PORT:-7860}"
PIDFILE=".aisinger.pid"
LOG="logs/app.log"
mkdir -p logs

stop() {
  if [ -f "$PIDFILE" ]; then
    PID=$(cat "$PIDFILE")
    if kill -0 "$PID" 2>/dev/null; then
      echo "→ 停止旧 backend pid=$PID"
      kill "$PID" 2>/dev/null || true
      for _ in 1 2 3 4 5; do kill -0 "$PID" 2>/dev/null || break; sleep 1; done
      kill -9 "$PID" 2>/dev/null || true
    fi
    rm -f "$PIDFILE"
  fi
  # 兜底：清掉占着端口的残留进程
  if command -v lsof >/dev/null 2>&1; then
    PIDS=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
      echo "→ 清理 $PORT 占用: $PIDS"
      kill $PIDS 2>/dev/null || true; sleep 1
      kill -9 $PIDS 2>/dev/null || true
    fi
  fi
}

start() {
  if [ ! -x .venv/bin/python ]; then
    echo "未找到 .venv，请先运行: ./scripts/setup.sh" >&2
    exit 1
  fi
  export PYTORCH_ENABLE_MPS_FALLBACK=1
  export AISINGER_PORT="$PORT"
  nohup .venv/bin/python app.py >> "$LOG" 2>&1 &
  PID=$!
  echo "$PID" > "$PIDFILE"
  sleep 1
  if kill -0 "$PID" 2>/dev/null; then
    echo "✓ backend pid=$PID  http://127.0.0.1:$PORT  log=$LOG"
  else
    echo "启动失败，查看 $LOG" >&2
    rm -f "$PIDFILE"; exit 1
  fi
}

stop
start
