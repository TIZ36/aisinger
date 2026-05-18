#!/usr/bin/env bash
# 下载 RVC 训练 / 推理所需的预训练权重
set -euo pipefail

cd "$(dirname "$0")/.."

RVC_DIR="third_party/Retrieval-based-Voice-Conversion-WebUI"
if [ ! -d "$RVC_DIR" ]; then
  echo "!! 先运行 ./scripts/bootstrap_mac.sh 克隆 RVC 仓库"
  exit 1
fi

ASSETS="$RVC_DIR/assets"
mkdir -p "$ASSETS/hubert" "$ASSETS/rmvpe" "$ASSETS/pretrained_v2"

BASE="https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main"

fetch() {
  local url="$1" out="$2"
  if [ -f "$out" ]; then
    echo "✓ 已存在 $out"
    return
  fi
  echo ">> 下载 $out"
  curl -L --fail --retry 3 -o "$out" "$url"
}

fetch "$BASE/hubert_base.pt"             "$ASSETS/hubert/hubert_base.pt"
fetch "$BASE/rmvpe.pt"                   "$ASSETS/rmvpe/rmvpe.pt"
fetch "$BASE/pretrained_v2/f0G40k.pth"   "$ASSETS/pretrained_v2/f0G40k.pth"
fetch "$BASE/pretrained_v2/f0D40k.pth"   "$ASSETS/pretrained_v2/f0D40k.pth"

echo "✅ 完成"
