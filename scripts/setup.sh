#!/usr/bin/env bash
# aisinger 一键安装：主 venv + RVC 仓库 + RVC 预训练权重，
# 可选 GPT-SoVITS（高级档）。
#
# 用法:
#   ./scripts/setup.sh                # 默认安装简易档 + 中等档
#   ./scripts/setup.sh --with-pro     # 同时安装高级档（GPT-SoVITS, 需独立 venv 与权重下载）
#   ./scripts/setup.sh --skip-rvc     # 仅简易档
#   ./scripts/setup.sh --cuda         # 强制 CUDA 路径（高级档默认走 CUDA）
set -euo pipefail

cd "$(dirname "$0")/.."

WITH_PRO=0
SKIP_RVC=0
FORCE_CUDA=0
for arg in "$@"; do
  case "$arg" in
    --with-pro) WITH_PRO=1 ;;
    --skip-rvc) SKIP_RVC=1 ;;
    --cuda)     FORCE_CUDA=1 ;;
    -h|--help)
      grep '^# ' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "未知参数: $arg" >&2; exit 1 ;;
  esac
done

log() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
ok() { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

OS="$(uname -s)"

# ---- 1. 系统依赖 ----
log "1/5 检查系统依赖"
if ! command -v ffmpeg >/dev/null 2>&1; then
  warn "未安装 ffmpeg"
  if [ "$OS" = "Darwin" ]; then
    echo "  请运行: brew install ffmpeg"
  else
    echo "  请运行: sudo apt install -y ffmpeg  (或对应发行版命令)"
  fi
  exit 1
fi
ok "ffmpeg: $(ffmpeg -version | head -1)"

if ! command -v git >/dev/null 2>&1; then
  echo "需要 git" >&2; exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "需要 curl" >&2; exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  warn "未安装 uv，开始安装"
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
fi
ok "uv: $(uv --version)"

# ---- 2. 主 venv ----
log "2/5 创建主 venv (.venv, Python 3.10)"
if [ ! -d .venv ]; then
  uv venv --python 3.10 --seed .venv
fi
PY=.venv/bin/python
# pin pip 23.3.1（fairseq 等老依赖需要旧版解析行为）
uv pip install --python "$PY" --quiet "pip==23.3.1"

EXTRA="mac"
EXTRA_INDEX=""
if [ "$FORCE_CUDA" = "1" ] || ( [ "$OS" != "Darwin" ] && command -v nvidia-smi >/dev/null 2>&1 ); then
  EXTRA="cuda"
  EXTRA_INDEX="https://download.pytorch.org/whl/cu124"
  ok "选择 CUDA 路径"
else
  ok "选择 Mac/CPU 路径"
fi

log "安装 aisinger[$EXTRA]"
if [ -n "$EXTRA_INDEX" ]; then
  uv pip install --python "$PY" -e ".[$EXTRA]" --extra-index-url "$EXTRA_INDEX"
else
  uv pip install --python "$PY" -e ".[$EXTRA]"
fi

# ---- 3. RVC（中等档）----
if [ "$SKIP_RVC" = "1" ]; then
  warn "--skip-rvc 已指定，跳过中等档"
else
  log "3/5 克隆 RVC 仓库（macOS 友好分支）"
  mkdir -p third_party
  if [ ! -d third_party/Retrieval-based-Voice-Conversion-WebUI ]; then
    git clone --depth 1 https://github.com/qingbo1011/RVC-WebUI-MacOS.git \
      third_party/Retrieval-based-Voice-Conversion-WebUI
  else
    ok "RVC 仓库已存在，跳过克隆"
  fi
  log "下载 RVC 预训练权重"
  ./scripts/fetch_rvc_assets.sh
  ok "RVC 准备就绪"
fi

# ---- 4. GPT-SoVITS（高级档）----
if [ "$WITH_PRO" = "1" ]; then
  log "4/5 安装高级档（GPT-SoVITS, 独立 venv）"
  if [ "$FORCE_CUDA" = "1" ]; then
    AISINGER_CUDA=1 ./scripts/bootstrap_gptsovits.sh
  else
    ./scripts/bootstrap_gptsovits.sh
  fi
  ok "GPT-SoVITS 准备就绪"
else
  log "4/5 跳过高级档（如需启用: 重新运行加 --with-pro）"
fi

# ---- 5. 完成 ----
log "5/5 完成"
ok "启动: ./scripts/start.sh"
ok "重启: ./scripts/restart.sh"
ok "Web UI 地址: http://127.0.0.1:7860"
