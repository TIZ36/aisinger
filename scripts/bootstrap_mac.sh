#!/usr/bin/env bash
# Mac (Apple Silicon) 一键引导
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v uv >/dev/null 2>&1; then
  echo ">> 安装 uv ..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "!! 未检测到 ffmpeg，请先执行: brew install ffmpeg"
  exit 1
fi

if [ ! -d .venv ]; then
  echo ">> 创建 venv (Python 3.10, --seed 携带 pip) ..."
  uv venv --python 3.10 --seed .venv
fi

echo ">> 安装主依赖 + mac extras ..."
# fairseq 仍需要旧版 pip 行为
uv pip install --python .venv/bin/python "pip==23.3.1"
uv pip install --python .venv/bin/python -e ".[mac]"

echo ">> 克隆 RVC (macOS 友好分支) ..."
mkdir -p third_party
if [ ! -d third_party/Retrieval-based-Voice-Conversion-WebUI ]; then
  git clone --depth 1 https://github.com/qingbo1011/RVC-WebUI-MacOS.git \
    third_party/Retrieval-based-Voice-Conversion-WebUI
fi

echo ""
echo "✅ 完成。启动:  .venv/bin/python app.py"
echo "   首次运行 RVC 推理前，请进入 third_party/Retrieval-based-Voice-Conversion-WebUI"
echo "   按其 README 下载预训练权重 (hubert_base.pt 等) 到 assets/。"
