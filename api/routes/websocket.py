"""WebSocket endpoint for real-time updates."""

from __future__ import annotations

import asyncio
import json
from typing import Callable

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

# Connected clients
_clients: list[WebSocket] = []


@router.websocket("/updates")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    _clients.append(websocket)

    # Also subscribe to message bus events
    try:
        while True:
            # Keep connection alive and receive any client messages
            data = await websocket.receive_text()
            # Client can send ping
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        _clients.remove(websocket)


async def broadcast_event(event: dict):
    """Broadcast an event to all connected WebSocket clients."""
    message = json.dumps(event, ensure_ascii=False, default=str)
    disconnected = []
    for client in _clients:
        try:
            await client.send_text(message)
        except Exception:
            disconnected.append(client)
    for client in disconnected:
        _clients.remove(client)


def make_ws_callback() -> Callable[[dict], None]:
    """构造一个同步 progress_callback,把 Agent 事件桥接到 WebSocket 客户端。

    Agent 的 _emit_progress 同步调用 progress_callback(无 await),故此处用
    get_running_loop().create_task 调度异步 broadcast_event。
    """

    def _callback(event: dict) -> None:
        try:
            asyncio.get_running_loop().create_task(broadcast_event(event))
        except RuntimeError:
            # 无运行中的事件循环(非异步上下文),静默丢弃
            pass

    return _callback
