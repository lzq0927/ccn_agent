"""WebSocket endpoint for real-time updates."""

from __future__ import annotations

import asyncio
import json

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
