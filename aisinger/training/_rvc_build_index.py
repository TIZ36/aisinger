"""Stand-alone faiss index builder.

By design runs inside `.venvs/rvc/bin/python` (where faiss/numpy/sklearn live).
Usage:
    .venvs/rvc/bin/python -m aisinger.training._rvc_build_index <exp_name> [v1|v2]
cwd 必须为 RVC_DIR（这样 `logs/<exp_name>` 路径对齐）。

逻辑移植自 infer-web.py::train_index。
"""
from __future__ import annotations

import os
import sys
import traceback

import numpy as np  # type: ignore


def main(exp_name: str, version: str = "v2") -> int:
    exp_dir = os.path.join("logs", exp_name)
    fea_dim = 768 if version != "v1" else 256
    feature_dir = os.path.join(exp_dir, f"3_feature{fea_dim}")
    if not os.path.isdir(feature_dir):
        print(f"[index] 特征目录不存在: {feature_dir}", file=sys.stderr)
        return 1
    names = sorted(os.listdir(feature_dir))
    if not names:
        print("[index] 没有任何特征文件，先跑 step 3", file=sys.stderr)
        return 1

    npys = [np.load(os.path.join(feature_dir, n)) for n in names]
    big_npy = np.concatenate(npys, 0)
    idx = np.arange(big_npy.shape[0]); np.random.shuffle(idx)
    big_npy = big_npy[idx]
    print(f"[index] features shape={big_npy.shape}", flush=True)

    if big_npy.shape[0] > 2e5:
        try:
            from sklearn.cluster import MiniBatchKMeans  # type: ignore
            print("[index] kmeans -> 10k centers", flush=True)
            big_npy = (
                MiniBatchKMeans(n_clusters=10000, verbose=False, batch_size=1024, init="random", compute_labels=False)
                .fit(big_npy)
                .cluster_centers_
            )
        except Exception:
            traceback.print_exc()

    np.save(os.path.join(exp_dir, "total_fea.npy"), big_npy)

    n_ivf = min(int(16 * np.sqrt(big_npy.shape[0])), big_npy.shape[0] // 39)
    n_ivf = max(1, n_ivf)
    print(f"[index] n_ivf={n_ivf}", flush=True)

    import faiss  # type: ignore
    index = faiss.index_factory(fea_dim, f"IVF{n_ivf},Flat")
    index_ivf = faiss.extract_index_ivf(index)
    index_ivf.nprobe = 1
    print("[index] training", flush=True)
    index.train(big_npy)
    trained_path = os.path.join(
        exp_dir, f"trained_IVF{n_ivf}_Flat_nprobe_{index_ivf.nprobe}_{exp_name}_{version}.index",
    )
    faiss.write_index(index, trained_path)

    print("[index] adding", flush=True)
    for i in range(0, big_npy.shape[0], 8192):
        index.add(big_npy[i:i + 8192])
    added_path = os.path.join(
        exp_dir, f"added_IVF{n_ivf}_Flat_nprobe_{index_ivf.nprobe}_{exp_name}_{version}.index",
    )
    faiss.write_index(index, added_path)
    print(f"[index] ✅ {os.path.basename(added_path)}", flush=True)
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: ... <exp_name> [v1|v2]", file=sys.stderr)
        sys.exit(2)
    exp = sys.argv[1]
    ver = sys.argv[2] if len(sys.argv) > 2 else "v2"
    sys.exit(main(exp, ver))
