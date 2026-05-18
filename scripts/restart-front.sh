#!/usr/bin/env bash
# 重启 Next.js dev server (端口 3000, 后台)。
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${FRONT_PORT:-3000}"
PIDFILE=".next.pid"
LOG="logs/next.log"
mkdir -p logs

stop() {
  if [ -f "$PIDFILE" ]; then
    PID=$(cat "$PIDFILE")
    if kill -0 "$PID" 2>/dev/null; then
      echo "→ 停止旧 frontend pid=$PID"
      # next dev 用 pnpm 启动有子进程；杀进程组
      pkill -P "$PID" 2>/dev/null || true
      kill "$PID" 2>/dev/null || true
      for _ in 1 2 3 4 5; do kill -0 "$PID" 2>/dev/null || break; sleep 1; done
      kill -9 "$PID" 2>/dev/null || true
    fi
    rm -f "$PIDFILE"
  fi
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
  if [ ! -d frontend/node_modules ]; then
    echo "未安装 frontend 依赖。先运行: cd frontend && pnpm install" >&2
    exit 1
  fi
  ( cd frontend && nohup pnpm dev -p "$PORT" >> "../$LOG" 2>&1 & echo $! > "../$PIDFILE" )
  PID=$(cat "$PIDFILE")
  sleep 3
  if kill -0 "$PID" 2>/dev/null; then
    echo "✓ frontend pid=$PID  http://127.0.0.1:$PORT  log=$LOG"
  else
    echo "启动失败，查看 $LOG" >&2
    rm -f "$PIDFILE"; exit 1
  fi
}

stop
start
