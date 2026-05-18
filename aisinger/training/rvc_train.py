"""封装 RVC v2 官方训练流程为 5 步子进程调用。

参考脚本（RVC-WebUI 仓库内的标准路径）:
  1. infer/modules/train/preprocess.py
  2. infer/modules/train/extract/extract_f0_rmvpe.py
  3. infer/modules/train/extract_feature_print.py
  4. infer/modules/train/train.py
  5. infer/modules/train/train_index.py

每个实验在 RVC_DIR/logs/<exp_name>/ 下生成中间产物；
最终的 .pth 在 RVC_DIR/assets/weights/<exp_name>.pth，
.index 在 RVC_DIR/logs/<exp_name>/added_*.index。
"""

from __future__ import annotations

import random
import shutil
import subprocess
import re
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from ..config import ROOT, THIRD_PARTY_DIR
from .. import jobs

RVC_DIR = THIRD_PARTY_DIR / "Retrieval-based-Voice-Conversion-WebUI"
RVC_VENV = ROOT / ".venvs" / "rvc"
SR_HZ = 40000  # 40k 采样率（v2 主流）
F0_METHOD = "rmvpe"

_TRAIN_FATAL_PATTERNS = (
    re.compile(r"Process Process-\d+:", re.I),
    re.compile(r"Traceback \(most recent call last\):", re.I),
    re.compile(r"RuntimeError:", re.I),
    re.compile(r"Error executing job with overrides", re.I),
)


@dataclass
class TrainResult:
    pth_path: Path
    index_path: Path | None
    exp_dir: Path


def _check_repo() -> None:
    if not RVC_DIR.exists():
        raise RuntimeError(f"RVC repo not found at {RVC_DIR}. 先运行 scripts/bootstrap_mac.sh。")
    if not (RVC_VENV / "bin" / "python").exists():
        raise RuntimeError(
            f"RVC 隔离 venv 未创建: {RVC_VENV}\n请运行: ./scripts/bootstrap_rvc_venv.sh"
        )
    assets = RVC_DIR / "assets"
    needed = [
        assets / "hubert" / "hubert_base.pt",
        assets / "rmvpe" / "rmvpe.pt",
        assets / "pretrained_v2" / f"f0G{SR_HZ // 1000}k.pth",
        assets / "pretrained_v2" / f"f0D{SR_HZ // 1000}k.pth",
    ]
    missing = [str(p) for p in needed if not p.exists()]
    if missing:
        raise RuntimeError(
            "缺少 RVC 预训练权重，请先运行: ./scripts/fetch_rvc_assets.sh\n"
            "缺失:\n  " + "\n  ".join(missing)
        )


def _stage_samples(samples: list[Path], exp_dir: Path) -> Path:
    raw = exp_dir / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    for i, s in enumerate(samples):
        if not s.exists():
            raise FileNotFoundError(s)
        shutil.copy(s, raw / f"sample_{i:03d}{s.suffix}")
    return raw


def _prepare_train_files(exp_dir: Path, sr_label: str, if_f0: bool = True) -> Iterator[str]:
    """模拟 WebUI click_train 的前置准备：生成 filelist.txt 与 config.json。

    没这一步，train.py 第一行加载 config.json 就会 FileNotFoundError 而 exit 1。
    """
    exp_dir = exp_dir.resolve()
    gt_wavs_dir = exp_dir / "0_gt_wavs"
    feature_dir = exp_dir / "3_feature768"  # v2 = 768 维
    f0_dir = exp_dir / "2a_f0"
    f0nsf_dir = exp_dir / "2b-f0nsf"
    if not (gt_wavs_dir.exists() and feature_dir.exists()):
        raise RuntimeError(f"预处理产物缺失：{gt_wavs_dir} / {feature_dir}")

    gt_names = {p.stem for p in gt_wavs_dir.glob("*.wav")}
    feat_names = {p.stem for p in feature_dir.glob("*.npy")}
    common = gt_names & feat_names
    if if_f0:
        common &= {p.stem for p in f0_dir.glob("*.wav.npy")} | {
            p.name.split(".")[0] for p in f0_dir.glob("*.npy")
        }
        common &= {p.stem for p in f0nsf_dir.glob("*.wav.npy")} | {
            p.name.split(".")[0] for p in f0nsf_dir.glob("*.npy")
        }
    if not common:
        raise RuntimeError("预处理后没有可用片段（gt_wavs / feature 取交集为空）")

    spk_id = "0"
    fea_dim = "768"
    lines: list[str] = []
    for name in sorted(common):
        if if_f0:
            lines.append(
                f"{gt_wavs_dir}/{name}.wav|{feature_dir}/{name}.npy|"
                f"{f0_dir}/{name}.wav.npy|{f0nsf_dir}/{name}.wav.npy|{spk_id}"
            )
        else:
            lines.append(f"{gt_wavs_dir}/{name}.wav|{feature_dir}/{name}.npy|{spk_id}")

    # 追加两条 mute 兜底（与 WebUI 行为一致），路径需绝对
    mute_root = RVC_DIR / "logs" / "mute"
    for _ in range(2):
        if if_f0:
            lines.append(
                f"{mute_root}/0_gt_wavs/mute{sr_label}.wav|{mute_root}/3_feature{fea_dim}/mute.npy|"
                f"{mute_root}/2a_f0/mute.wav.npy|{mute_root}/2b-f0nsf/mute.wav.npy|{spk_id}"
            )
        else:
            lines.append(
                f"{mute_root}/0_gt_wavs/mute{sr_label}.wav|{mute_root}/3_feature{fea_dim}/mute.npy|{spk_id}"
            )

    random.shuffle(lines)
    (exp_dir / "filelist.txt").write_text("\n".join(lines))
    yield f"[3.5/5 prepare] 生成 filelist.txt · {len(lines)} 行（{len(common)} 真实 + 2 静音兜底）"

    # config.json：v2+40k 实际没有，WebUI 自动 fallback 到 v1/40k.json
    v2_candidate = RVC_DIR / "configs" / "v2" / f"{sr_label}.json"
    v1_candidate = RVC_DIR / "configs" / "v1" / f"{sr_label}.json"
    src = v2_candidate if v2_candidate.exists() else v1_candidate
    if not src.exists():
        raise RuntimeError(
            f"找不到 {sr_label} 对应的 RVC 配置文件: {v2_candidate} 或 {v1_candidate}"
        )
    shutil.copy(src, exp_dir / "config.json")
    yield f"[3.5/5 prepare] 复制 config.json ← {src.relative_to(RVC_DIR)}"


def _stream(
    cmd: list[str], cwd: Path, label: str, *, fail_on_log_error: bool = False
) -> Iterator[str]:
    yield from _stream_env(cmd, cwd, label, env=None, fail_on_log_error=fail_on_log_error)


def _stream_env(
    cmd: list[str],
    cwd: Path,
    label: str,
    env: dict[str, str] | None,
    *,
    fail_on_log_error: bool = False,
) -> Iterator[str]:
    yield f"[{label}] $ {' '.join(cmd)}"
    proc = subprocess.Popen(
        cmd,
        cwd=str(cwd),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=env,
    )
    assert proc.stdout is not None

    def terminate() -> None:
        if proc.poll() is None:
            proc.terminate()

    jobs.register_cancel_callback(terminate)
    fatal_lines: list[str] = []
    try:
        for line in proc.stdout:
            jobs.check_cancelled()
            text = line.rstrip()
            yield f"[{label}] {text}"
            if fail_on_log_error and any(p.search(text) for p in _TRAIN_FATAL_PATTERNS):
                fatal_lines.append(text)
        code = proc.wait()
        jobs.check_cancelled()
        if code != 0:
            raise RuntimeError(f"{label} 失败 (exit={code})")
        if fatal_lines:
            raise RuntimeError(f"{label} 子进程异常：{fatal_lines[-1]}")
    finally:
        jobs.unregister_cancel_callback(terminate)
        if proc.poll() is None:
            proc.terminate()


def train(
    exp_name: str,
    samples: list[Path],
    *,
    device: str = "mps",
    epochs: int = 20,
    batch_size: int = 4,
    save_every_epoch: int = 5,
) -> Iterator[str | TrainResult]:
    """生成器：依次产出日志字符串，最后产出 TrainResult。"""
    _check_repo()
    py = str(RVC_VENV / "bin" / "python")

    exp_dir = RVC_DIR / "logs" / exp_name
    if exp_dir.exists():
        shutil.rmtree(exp_dir)
    stale_weight = RVC_DIR / "assets" / "weights" / f"{exp_name}.pth"
    stale_weight.unlink(missing_ok=True)
    exp_dir.mkdir(parents=True, exist_ok=True)
    _stage_samples(samples, exp_dir)

    n_proc = "1" if device == "mps" else "4"  # MPS 下禁多进程
    rvc_device = "0" if device == "cuda" else ("mps" if device == "mps" else "cpu")

    # 1. preprocess: 切片 + 重采样到 SR_HZ
    yield from _stream(
        [
            py,
            "infer/modules/train/preprocess.py",
            str(exp_dir / "raw"),
            str(SR_HZ),
            n_proc,
            str(exp_dir),
            "False",
            "3.7",
        ],
        cwd=RVC_DIR,
        label="1/5 preprocess",
    )

    # 2. f0 提取（RMVPE）
    yield from _stream(
        [
            py,
            "infer/modules/train/extract/extract_f0_rmvpe.py",
            n_proc,
            "0",
            "0",
            str(exp_dir),
            "True",
        ],
        cwd=RVC_DIR,
        label="2/5 f0",
    )

    # 3. hubert 特征提取
    yield from _stream(
        [
            py,
            "infer/modules/train/extract_feature_print.py",
            rvc_device,
            "1",
            "0",
            "0",
            str(exp_dir),
            "v2",
            "True",
        ],
        cwd=RVC_DIR,
        label="3/5 feature",
    )

    # 3.5 train.py 需要的前置文件
    yield from _prepare_train_files(exp_dir, sr_label=f"{SR_HZ // 1000}k", if_f0=True)

    # 4. 训练主网络
    yield from _stream(
        [
            py,
            "infer/modules/train/train.py",
            "-e",
            exp_name,
            "-sr",
            f"{SR_HZ // 1000}k",
            "-f0",
            "1",
            "-bs",
            str(batch_size),
            "-g",
            "0",
            "-te",
            str(epochs),
            "-se",
            str(save_every_epoch),
            "-pg",
            f"assets/pretrained_v2/f0G{SR_HZ // 1000}k.pth",
            "-pd",
            f"assets/pretrained_v2/f0D{SR_HZ // 1000}k.pth",
            "-l",
            "0",
            "-c",
            "0",
            "-sw",
            "0",
            "-v",
            "v2",
        ],
        cwd=RVC_DIR,
        label="4/5 train",
        fail_on_log_error=True,
    )

    # 5. 构建 faiss index（macOS 分支没自带 train_index.py，用我们移植的版本）
    try:
        import os

        env = os.environ.copy()
        env["PYTHONPATH"] = f"{ROOT}{os.pathsep}{env.get('PYTHONPATH', '')}"
        yield from _stream_env(
            [py, "-m", "aisinger.training._rvc_build_index", exp_name, "v2"],
            cwd=RVC_DIR,
            label="5/5 index",
            env=env,
        )
    except RuntimeError as e:
        yield f"[5/5 index] 跳过：{e}"

    pth = RVC_DIR / "assets" / "weights" / f"{exp_name}.pth"
    if not pth.exists():
        raise RuntimeError(f"训练未生成最终音色权重: {pth}")
    index_files = sorted(exp_dir.glob("added_*.index"))
    yield TrainResult(
        pth_path=pth,
        index_path=index_files[0] if index_files else None,
        exp_dir=exp_dir,
    )
