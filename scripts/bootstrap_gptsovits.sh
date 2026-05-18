#!/usr/bin/env bash
# 为高级档（GPT-SoVITS）准备隔离 venv 和预训练权重。
# 强烈建议在 NVIDIA CUDA 机器上跑；CPU/MPS 也能推理但很慢且部分算子可能 fallback。
set -euo pipefail

cd "$(dirname "$0")/.."

GPTSOVITS_DIR="third_party/GPT-SoVITS"
VENV_DIR=".venvs/gptsovits"

if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi

if [ ! -d "$GPTSOVITS_DIR" ]; then
  echo ">> 克隆 GPT-SoVITS ..."
  git clone --depth 1 https://github.com/RVC-Boss/GPT-SoVITS.git "$GPTSOVITS_DIR"
fi

if [ ! -d "$VENV_DIR" ]; then
  echo ">> 创建独立 venv: $VENV_DIR (Python 3.10, --seed)"
  uv venv --python 3.10 --seed "$VENV_DIR"
fi

echo ">> 安装 GPT-SoVITS 依赖（隔离 venv，不影响主环境）..."
PIP="$VENV_DIR/bin/pip"
uv pip install --python "$VENV_DIR/bin/python" --quiet "pip==24.0"

# torch：CUDA 优先；如无 CUDA 退到 CPU 轮子
if [ "${AISINGER_CUDA:-auto}" = "1" ] || nvidia-smi >/dev/null 2>&1; then
  echo ">> 检测到 NVIDIA，安装 CUDA torch ..."
  "$PIP" install torch==2.2.2 torchaudio==2.2.2 --index-url https://download.pytorch.org/whl/cu121
else
  echo ">> 未检测到 NVIDIA，安装 CPU torch（推理可用但慢）..."
  "$PIP" install torch==2.2.2 torchaudio==2.2.2
fi

"$PIP" install -r "$GPTSOVITS_DIR/requirements.txt"

echo ">> 下载 GPT-SoVITS 预训练权重 ..."
HF="https://huggingface.co/lj1995/GPT-SoVITS/resolve/main"
PRE="$GPTSOVITS_DIR/GPT_SoVITS/pretrained_models"
mkdir -p "$PRE"
fetch() {
  local url="$1" out="$2"
  if [ -f "$out" ]; then
    echo "✓ 已存在 $out"
    return
  fi
  echo ">> 下载 $(basename "$out")"
  curl -L --fail --retry 3 -o "$out" "$url"
}
# v2 默认底模（按 GPT-SoVITS 主分支命名）
fetch "$HF/s2G488k.pth"                       "$PRE/s2G488k.pth"
fetch "$HF/s2D488k.pth"                       "$PRE/s2D488k.pth"
fetch "$HF/s1bert25hz-2kh-longer-epoch=68e-step=50232.ckpt" \
      "$PRE/s1bert25hz-2kh-longer-epoch=68e-step=50232.ckpt"
# 中文 BERT
mkdir -p "$PRE/chinese-roberta-wwm-ext-large" "$PRE/chinese-hubert-base"
fetch "$HF/chinese-roberta-wwm-ext-large/pytorch_model.bin" \
      "$PRE/chinese-roberta-wwm-ext-large/pytorch_model.bin"
fetch "$HF/chinese-roberta-wwm-ext-large/config.json" \
      "$PRE/chinese-roberta-wwm-ext-large/config.json"
fetch "$HF/chinese-roberta-wwm-ext-large/tokenizer.json" \
      "$PRE/chinese-roberta-wwm-ext-large/tokenizer.json"
fetch "$HF/chinese-hubert-base/pytorch_model.bin" \
      "$PRE/chinese-hubert-base/pytorch_model.bin"
fetch "$HF/chinese-hubert-base/config.json" \
      "$PRE/chinese-hubert-base/config.json"
fetch "$HF/chinese-hubert-base/preprocessor_config.json" \
      "$PRE/chinese-hubert-base/preprocessor_config.json"

echo "✅ GPT-SoVITS 环境就绪。"
echo "   venv: $VENV_DIR"
echo "   repo: $GPTSOVITS_DIR"
