#!/usr/bin/env bash
# 为 RVC 训练 / 推理创建隔离 venv，避免污染主 .venv（gradio/pydantic/numpy 等冲突）。
set -euo pipefail

cd "$(dirname "$0")/.."

RVC_DIR="third_party/Retrieval-based-Voice-Conversion-WebUI"
VENV_DIR=".venvs/rvc"

if [ ! -d "$RVC_DIR" ]; then
  echo "!! RVC 仓库不存在，先运行 ./scripts/bootstrap_mac.sh" >&2
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi

if [ ! -d "$VENV_DIR" ]; then
  echo ">> 创建隔离 venv: $VENV_DIR (Python 3.10, --seed)"
  uv venv --python 3.10 --seed "$VENV_DIR"
fi

PIP="$VENV_DIR/bin/pip"
uv pip install --python "$VENV_DIR/bin/python" --quiet "pip==24.0"

echo ">> 安装 RVC 依赖（隔离 venv）..."
"$PIP" install -r "$RVC_DIR/requirements.txt"
# requirements.txt 漏了 av（preprocess.py 需要）
"$PIP" install av
# requirements.txt 未 pin torch -> 装到 2.11，导致 fairseq ckpt 反序列化失败
# 钉到 2.3.1（MPS 可用 + fairseq 兼容）
"$PIP" install "torch==2.3.1" "torchaudio==2.3.1"

echo "✅ RVC 隔离环境就绪: $VENV_DIR"
