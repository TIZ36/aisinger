"""aisinger entrypoint — FastAPI + uvicorn."""
from __future__ import annotations

import os


def main():
    import uvicorn
    host = os.environ.get("AISINGER_HOST", "0.0.0.0")
    port = int(os.environ.get("GRADIO_SERVER_PORT", os.environ.get("AISINGER_PORT", 7860)))
    print(f"[aisinger] serving on http://{host}:{port}")
    uvicorn.run("aisinger.server:app", host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
