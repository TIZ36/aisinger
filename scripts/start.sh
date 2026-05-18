#!/usr/bin/env bash
# 启动 aisinger Gradio 应用（前台）。日志写入 logs/app.log。
# 若已有实例在跑会拒绝启动 —— 用 ./scripts/restart.sh 重启。
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${AISINGER_PORT:-7860}"
PIDFILE=".aisinger.pid"
LOGFILE="logs/app.log"
mkdir -p logs

if [ ! -x .venv/bin/python ]; then
  echo "未找到 .venv，请先运行: ./scripts/setup.sh" >&2
  exit 1
fi

# 已在跑？
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  PID=$(cat "$PIDFILE")
  echo "已有实例在跑 (pid=$PID)。"
  echo "用 ./scripts/restart.sh 重启，或 ./scripts/stop.sh 停止。"
  exit 1
fi

# 端口占用？
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "端口 $PORT 被占用：" >&2
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN
  exit 1
fi

export PYTORCH_ENABLE_MPS_FALLBACK=1
export GRADIO_SERVER_PORT="$PORT"

MODE="${1:-fg}"
case "$MODE" in
  fg)
    echo "启动 aisinger (前台) → http://127.0.0.1:$PORT"
    exec .venv/bin/python app.py 2>&1 | tee -a "$LOGFILE"
    ;;
  bg)
    echo "启动 aisinger (后台) → http://127.0.0.1:$PORT"
    nohup .venv/bin/python app.py >>"$LOGFILE" 2>&1 &
    echo $! > "$PIDFILE"
    sleep 1
    if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "pid=$(cat $PIDFILE)  log=$LOGFILE"
    else
      echo "启动失败，查看 $LOGFILE"
      rm -f "$PIDFILE"
      exit 1
    fi
    ;;
  *)
    echo "用法: $0 [fg|bg]"; exit 1 ;;
esac
