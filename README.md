# 🎤 aisinger — AI 歌手复刻

上传 1–5 段说话/歌唱样本 → 提取音色 → 用该音色合成新内容。对标 AI 孙燕姿 / AI 陶喆。

## 三档能力

| 档位 | 输入 | 输出 | 模型 | 硬件 |
|---|---|---|---|---|
| 简易 | 10s–1min 说话音频 | 用该音色读任意文字 | F5-TTS（零样本） | Mac CPU/MPS |
| 中等 | 1–5 首歌（带伴奏 OK） | 用该音色翻唱其他歌 | RVC v2 | Mac MPS（推理）/ CUDA（训练） |
| 高级 | 1–5 首歌 | 高质量翻唱 | GPT-SoVITS v3 | 必须 NVIDIA GPU |

## 快速开始（Mac, Apple Silicon）

```bash
brew install ffmpeg                    # 仅首次

./scripts/setup.sh                     # 一键安装（简易档 + 中等档）
./scripts/setup.sh --with-pro          # 同时安装高级档（GPT-SoVITS 独立 venv）

./scripts/start.sh                     # 前台启动
./scripts/start.sh bg                  # 后台启动（pid 写入 .aisinger.pid，log → logs/app.log）
./scripts/restart.sh                   # 停旧 + 重启（默认后台）
./scripts/restart.sh fg                # 停旧 + 前台重启
./scripts/stop.sh                      # 停止
# 浏览器打开 http://127.0.0.1:7860
```

`AISINGER_PORT=8080 ./scripts/start.sh bg` 可改端口。

## 当前状态（Phase 3）

- ✅ 共享预处理 pipeline（Demucs 分离 → 静音切片 → 降噪/响度归一化）
- ✅ 音色库 JSON 存储（增删查改）
- ✅ Gradio Web UI（档位下拉 + 音色库面板 + A/B 对比页）
- ✅ 简易档 F5-TTS 完整链路（创建音色 + 合成）
- ✅ 中等档 RVC：导入 + 从样本训练（5 步官方流程）+ 翻唱（含伴奏回混）
- ✅ 高级档 GPT-SoVITS：**独立 venv 隔离 worker** + 零样本合成
- ⏳ 高级档 GPT-SoVITS 微调流程（worker 已留接口）

### 启用各档

```bash
./scripts/bootstrap_mac.sh            # 必跑：主 venv + RVC 仓库
./scripts/fetch_rvc_assets.sh         # 中等档训练前：RVC 预训练权重
./scripts/bootstrap_gptsovits.sh      # 高级档：独立 venv + GPT-SoVITS 权重
```

### 架构：隔离 worker（高级档）

GPT-SoVITS 的依赖（pinned torch/transformers）与 RVC 冲突，因此跑在独立 venv：

```
[ 主 venv:Gradio ] --(stdin/stdout JSON)--> [ .venvs/gptsovits/python -m aisinger.workers.gptsovits_worker ]
```

JSON-line 协议定义见 `aisinger/workers/protocol.py`，worker 实现见 `aisinger/workers/gptsovits_worker.py`，
主进程包装见 `aisinger/adapters/gptsovits_adapter.py::GPTSoVITSWorker`。

## 目录结构

```
app.py                      # Gradio 入口
aisinger/
  config.py                 # 设备检测 + 路径常量
  preprocess/               # 共享预处理 pipeline
    pipeline.py             #   编排器
    separate.py             #   Demucs 人声分离
    slice.py                #   静音切片
    denoise.py              #   降噪 + 响度归一化
  adapters/
    base.py                 # VoiceCloneAdapter ABC
    f5tts_adapter.py        # 简易档
    rvc_adapter.py          # 中等档（含 train_voice 流式生成器）
    gptsovits_adapter.py    # 高级档（主进程侧 Popen worker）
  training/
    rvc_train.py            # RVC 5 步训练 wrapper
  workers/
    protocol.py             # JSON-line 协议
    gptsovits_worker.py     # 在 .venvs/gptsovits 内运行
  voicelib/                 # 音色库
  ui/                       # Gradio 组件（含 compare.py A/B 对比）
third_party/                # vendored RVC / GPT-SoVITS
data/                       # uploads / processed / voices
models/                     # 下载的预训练权重
scripts/                    # bootstrap_mac.sh / bootstrap_cuda.sh
```

## 端到端验证

- **预处理**：`python -c "from aisinger.preprocess.pipeline import process; from pathlib import Path; print(process(Path('test.mp3'), kind='song'))"` — 检查 `data/processed/<job>/` 下应有 `sep/`、`chunks/`、`manifest.json`。
- **简易档**：UI 上传 10 秒自己说话 → 合成"床前明月光" → 听感对照。
- **中等档**：从 huggingface 下载任意 RVC `.pth` → 导入 → 上传 30 秒人声 → 验证音色转换。

## 已知 Mac 注意事项

- 启动时已自动 `PYTORCH_ENABLE_MPS_FALLBACK=1`。
- RVC 在 MPS 上训练不稳定，Phase 1 仅推理；训练请走 CUDA 机器（Phase 2）。
- 装 fairseq 前必须 pin `pip==23.3.1`（bootstrap 已处理）。

## 版权与合规

仅供个人学习和创作使用。请勿使用未授权的他人声音进行商业用途或传播误导性内容。
# aisinger
