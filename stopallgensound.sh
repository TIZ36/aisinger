#!/usr/bin/env bash
# Stop all running voice-generation/training jobs and release their worker resources.
set -euo pipefail

cd "$(dirname "$0")"

API="${AISINGER_API:-http://127.0.0.1:7860}"
PY=".venv/bin/python"
if [ ! -x "$PY" ]; then
  PY="python3"
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

if ! curl -fsS "$API/api/jobs" -o "$tmp"; then
  echo "无法连接 aisinger 后端: $API" >&2
  echo "请先启动后端，或用 AISINGER_API=http://host:port 指定地址。" >&2
  exit 1
fi

mapfile -t JOB_IDS < <("$PY" - "$tmp" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as f:
    jobs = json.load(f)

for job in jobs:
    if job.get("kind") == "train" and job.get("status") == "running":
        print(job.get("id"))
PY
)

if [ "${#JOB_IDS[@]}" -eq 0 ]; then
  echo "没有正在生成音色的任务。"
  exit 0
fi

echo "准备停止 ${#JOB_IDS[@]} 个生成音色任务..."
for job_id in "${JOB_IDS[@]}"; do
  echo "→ cancel train job $job_id"
  curl -fsS -X POST "$API/api/jobs/$job_id/cancel" >/dev/null
done

echo "已发送停止请求。资源会在当前子进程退出后释放。"
