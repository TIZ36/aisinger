#!/usr/bin/env bash
# 停止旧实例并以后台模式重启。默认后台；加 fg 可前台。
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-bg}"

./scripts/stop.sh
echo "----"
exec ./scripts/start.sh "$MODE"
