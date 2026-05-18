# Windows Migration Plan

## Goal

Run the full AISinger application on a Windows machine with an NVIDIA GPU, while keeping the same product workflow:

- Create voices from singing samples.
- Train RVC voices with CUDA.
- Synthesize AI cover songs.
- View job progress, cancel jobs, and play generated results in the web UI.

The main reason for migrating is that RVC training and inference are much better supported on NVIDIA CUDA than on macOS MPS/CPU.

## Recommended Deployment

Use the Windows GPU machine as the primary runtime:

- Backend: Windows machine
- Frontend: Windows machine
- Browser access: Mac or Windows browser connects to the Windows host
- GPU: NVIDIA 5070 Ti via CUDA

Example access pattern:

```text
Mac browser -> http://<windows-ip>:3000
Frontend -> http://<windows-ip>:7860
Backend/RVC -> CUDA on Windows
```

This is simpler than running Mac as the controller and Windows as a remote worker. Remote worker mode can be added later.

## Current Mac-Specific Assumptions

The current codebase is not yet Windows-ready. Known assumptions:

- RVC Python path is hardcoded as `.venvs/rvc/bin/python`.
- Scripts are shell-based: `scripts/*.sh`.
- Runtime process operations use Unix concepts like `kill`.
- RVC Mac safety mode disables index and forces CPU to avoid MPS/faiss/libomp issues.
- Some logs and troubleshooting commands assume macOS tools.
- Local paths are mostly `pathlib`, but a full audit is still needed.

## Target Windows Stack

### System

- Windows 11
- NVIDIA Driver supporting the 5070 Ti
- CUDA-compatible PyTorch build
- Git for Windows
- PowerShell 7 recommended
- FFmpeg installed and available in `PATH`
- Node.js LTS
- pnpm
- Python 3.10.x

### Python Environments

Use two virtual environments, same as macOS:

```text
.venv/          main backend environment
.venvs/rvc/     isolated RVC environment
```

Windows executable paths:

```text
.venv/Scripts/python.exe
.venvs/rvc/Scripts/python.exe
```

### Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- pnpm

### Backend

- FastAPI
- Uvicorn
- SSE job progress
- Local filesystem storage under `data/`

### Audio/ML

- FFmpeg
- Demucs
- PyTorch CUDA
- RVC WebUI codebase
- faiss or faiss-cpu if supported on Windows
- pyworld
- librosa
- soundfile

## Code Changes Required

### 1. Cross-Platform Python Executable Resolution

Replace hardcoded RVC Python path.

Current pattern:

```python
RVC_PYTHON = THIRD_PARTY_DIR.parent / ".venvs" / "rvc" / "bin" / "python"
```

Target helper:

```python
def venv_python(venv_dir: Path) -> Path:
    if os.name == "nt":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python"
```

Apply to:

- `aisinger/adapters/rvc_adapter.py`
- `aisinger/training/rvc_train.py`
- Any other venv Python references

### 2. Device Strategy

Current Mac behavior forces safe CPU mode for RVC inference.

Windows target behavior:

- If CUDA is available: use `cuda` / GPU id `0`.
- Enable index for CUDA inference.
- Allow `rmvpe` by default on CUDA.
- Keep CPU safe mode only for non-CUDA environments.

Expected policy:

```text
cuda:
  train device: cuda / gpu 0
  infer device: cuda
  f0 method: rmvpe default
  index: enabled

mps/cpu:
  train/infer fallback
  infer index: disabled if needed
  f0 method: pm default
```

### 3. Startup Scripts

Add Windows scripts:

```text
scripts/bootstrap_windows.ps1
scripts/bootstrap_rvc_venv_windows.ps1
scripts/restart-server.ps1
scripts/start-frontend.ps1
```

The scripts should:

- Create `.venv`.
- Install backend dependencies.
- Create `.venvs/rvc`.
- Install RVC dependencies with CUDA PyTorch.
- Verify FFmpeg.
- Start backend on `0.0.0.0:7860`.
- Start frontend on `0.0.0.0:3000`.

### 4. Dependency Installation

Windows needs dedicated dependency verification.

Backend:

```powershell
py -3.10 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -U pip setuptools wheel
.\.venv\Scripts\python.exe -m pip install -e .
```

RVC:

```powershell
py -3.10 -m venv .venvs\rvc
.\.venvs\rvc\Scripts\python.exe -m pip install -U pip setuptools wheel
```

Install CUDA PyTorch according to the current official PyTorch command for the installed CUDA version.

Example placeholder:

```powershell
.\.venvs\rvc\Scripts\python.exe -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cuXXX
```

Then install RVC requirements. This may require pinning versions.

### 5. FFmpeg

Install FFmpeg using one of:

```powershell
winget install Gyan.FFmpeg
```

or manually add FFmpeg `bin` to `PATH`.

Verify:

```powershell
ffmpeg -version
ffprobe -version
```

### 6. RVC Assets

Ensure these exist:

```text
third_party/Retrieval-based-Voice-Conversion-WebUI/assets/hubert/hubert_base.pt
third_party/Retrieval-based-Voice-Conversion-WebUI/assets/rmvpe/rmvpe.pt
third_party/Retrieval-based-Voice-Conversion-WebUI/assets/pretrained_v2/f0G40k.pth
third_party/Retrieval-based-Voice-Conversion-WebUI/assets/pretrained_v2/f0D40k.pth
```

Create or adapt a Windows asset download script.

### 7. Job Cancellation

The current cancellation logic uses `proc.terminate()`, which is cross-platform for `subprocess.Popen`, but must be tested on Windows.

Verify:

- Cancel RVC training.
- Cancel Demucs separation.
- Cancel RVC inference.
- UI displays `cancelled`.
- No orphan Python process remains.

### 8. Frontend API Base URL

If frontend and backend run on different ports/hosts, configure the API base URL.

Current frontend calls relative paths like:

```text
/api/voices
/api/jobs
```

If Next.js proxies are not configured, add either:

- Next rewrites from frontend to backend
- `NEXT_PUBLIC_API_BASE_URL`

Recommended for Windows single-machine deployment:

```text
Frontend :3000 -> rewrite /api/* to Backend :7860
```

### 9. Path Handling Audit

Search for hardcoded Unix paths or shell assumptions:

```powershell
rg "bin/python|\.sh|kill |/tmp|tail -f|chmod|bash|zsh|mps|VECLIB|Scripts" .
```

Replace with cross-platform helpers where needed.

## Migration Execution Steps

### Step 1. Clone Repository

```powershell
git clone <repo-url> aisinger
cd aisinger
```

### Step 2. Install System Tools

Install:

- Python 3.10
- Node.js LTS
- pnpm
- Git
- FFmpeg
- NVIDIA driver

Verify:

```powershell
python --version
node --version
pnpm --version
ffmpeg -version
nvidia-smi
```

### Step 3. Create Backend Venv

```powershell
py -3.10 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -U pip setuptools wheel
.\.venv\Scripts\python.exe -m pip install -e .
```

### Step 4. Create RVC Venv

```powershell
py -3.10 -m venv .venvs\rvc
.\.venvs\rvc\Scripts\python.exe -m pip install -U pip setuptools wheel
```

Install CUDA PyTorch, then RVC dependencies.

### Step 5. Verify CUDA in RVC Venv

```powershell
.\.venvs\rvc\Scripts\python.exe - <<'PY'
import torch
print(torch.__version__)
print(torch.cuda.is_available())
print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else "no cuda")
PY
```

If PowerShell heredoc is inconvenient, create a temporary `check_cuda.py`.

Expected:

```text
True
NVIDIA GeForce RTX 5070 Ti
```

### Step 6. Install Frontend Dependencies

```powershell
cd frontend
pnpm install
pnpm exec tsc --noEmit
cd ..
```

### Step 7. Start Backend

```powershell
.\.venv\Scripts\python.exe app.py
```

Expected:

```text
http://127.0.0.1:7860
```

### Step 8. Start Frontend

```powershell
cd frontend
pnpm dev --hostname 0.0.0.0
```

Open:

```text
http://localhost:3000
```

From Mac:

```text
http://<windows-ip>:3000
```

## Validation Checklist

### Backend Health

```powershell
curl http://127.0.0.1:7860/api/voices
curl http://127.0.0.1:7860/api/tracks
curl http://127.0.0.1:7860/api/jobs
```

### Upload Track

- Upload a target song.
- Confirm it appears in `/tracks`.
- Confirm audio can play.

### Train Voice

- Upload 1 singing sample with accompaniment.
- Use `tier=mid`.
- Confirm Demucs separation progresses.
- Confirm RVC training uses CUDA.
- Confirm final model exists:

```text
data/voices/<voice_id>/model.pth
data/voices/<voice_id>/added.index
```

### Synthesize Song

- Select trained voice.
- Select target track.
- Use default CUDA settings.
- Confirm output appears in song history.
- Confirm audio plays.

### Cancel Jobs

- Start a training job and cancel it.
- Start a synthesis job and cancel it.
- Verify no orphan `python.exe` remains in Task Manager.

## Expected Improvements on Windows CUDA

- RVC training should be much faster than Mac CPU/MPS.
- RVC inference should avoid Mac MPS/CPU deadlocks.
- `rmvpe` should become usable by default.
- Index-based inference can be re-enabled for better timbre similarity.

## Risks

- 5070 Ti may require a recent CUDA/PyTorch build.
- RVC dependency versions may need pinning.
- `faiss` installation on Windows can be tricky.
- `pyworld` may need a compatible wheel or build tools.
- Demucs can be GPU-heavy and may compete with RVC if jobs overlap.
- Windows Defender may slow large model file IO unless project folders are excluded.

## First Windows Session Tasks

When continuing on Windows, do these first:

1. Verify `nvidia-smi`.
2. Verify CUDA PyTorch in `.venvs/rvc`.
3. Fix cross-platform RVC Python path helper.
4. Add Windows startup scripts.
5. Run backend smoke tests.
6. Train one short voice with `epochs=5`.
7. Synthesize one short target song.
8. Re-enable index inference on CUDA after basic synthesis succeeds.

## Future Remote Worker Mode

If Mac should remain the main controller later, add a Windows GPU worker:

```text
Mac Backend -> HTTP -> Windows GPU Worker -> artifacts -> Mac data/voices
```

Worker endpoints:

```text
POST /train
GET /jobs/{id}
POST /jobs/{id}/cancel
GET /jobs/{id}/artifacts
```

This is optional. Full Windows deployment should be completed first.
