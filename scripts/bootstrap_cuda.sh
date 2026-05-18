#!/usr/bin/env bash
# CUDA 引导（用于高级档训练机器）
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi

if [ ! -d .venv ]; then
  uv venv --python 3.10 --seed .venv
fi
uv pip install --python .venv/bin/python "pip==23.3.1"
uv pip install --python .venv/bin/python -e ".[cuda]" --extra-index-url https://download.pytorch.org/whl/cu124

mkdir -p third_party
if [ ! -d third_party/GPT-SoVITS ]; then
  git clone --depth 1 https://github.com/RVC-Boss/GPT-SoVITS.git third_party/GPT-SoVITS
fi
if [ ! -d third_party/Retrieval-based-Voice-Conversion-WebUI ]; then
  git clone --depth 1 https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI.git \
    third_party/Retrieval-based-Voice-Conversion-WebUI
fi

echo "✅ 完成。启动: .venv/bin/python app.py"
