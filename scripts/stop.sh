#!/usr/bin/env bash
# 停止当前后台运行的 aisinger 实例。
set -euo pipefail
cd "$(dirname "$0")/.."

PIDFILE=".aisinger.pid"
PORT="${AISINGER_PORT:-7860}"

stopped=0
if [ -f "$PIDFILE" ]; then
  PID=$(cat "$PIDFILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "停止 pid=$PID ..."
    kill "$PID" || true
    for i in 1 2 3 4 5; do
      kill -0 "$PID" 2>/dev/null || { stopped=1; break; }
      sleep 1
    done
    if [ "$stopped" = "0" ]; then
      echo "强制 kill -9 $PID"
      kill -9 "$PID" || true
    fi
  fi
  rm -f "$PIDFILE"
fi

# 兜底：清理还在监听端口的进程
if command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "清理仍占用 $PORT 的进程: $PIDS"
    kill $PIDS 2>/dev/null || true
    sleep 1
    kill -9 $PIDS 2>/dev/null || true
  fi
fi

echo "✓ 已停止"
