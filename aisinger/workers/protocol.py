"""主进程 ↔ worker 子进程的 JSON-line 协议定义。

每条消息一行 JSON，UTF-8。worker 监听 stdin，向 stdout 写入响应。

请求示例（主→worker）:
    {"id": "1", "cmd": "ping"}
    {"id": "2", "cmd": "synthesize", "args": {...}}

响应示例（worker→主）:
    {"id": "1", "event": "result", "data": {"ok": true}}
    {"id": "2", "event": "log", "msg": "..."}
    {"id": "2", "event": "result", "data": {"out_path": "..."}}
    {"id": "2", "event": "error", "msg": "..."}
"""
from __future__ import annotations

import json
import sys
from typing import IO, Any


def write_msg(stream: IO[str], msg: dict[str, Any]) -> None:
    stream.write(json.dumps(msg, ensure_ascii=False) + "\n")
    stream.flush()


def read_msg(stream: IO[str]) -> dict[str, Any] | None:
    line = stream.readline()
    if not line:
        return None
    return json.loads(line)


def emit_log(req_id: str, msg: str) -> None:
    write_msg(sys.stdout, {"id": req_id, "event": "log", "msg": msg})


def emit_result(req_id: str, data: dict[str, Any]) -> None:
    write_msg(sys.stdout, {"id": req_id, "event": "result", "data": data})


def emit_error(req_id: str, msg: str) -> None:
    write_msg(sys.stdout, {"id": req_id, "event": "error", "msg": msg})
