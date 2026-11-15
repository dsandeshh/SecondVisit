"""FastAPI app. Later tasks append routers; keep edits additive."""
from __future__ import annotations

import json
import re
from collections import defaultdict

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


# --- Observer relay (Task 17): rehearsal phone -> projector laptop, one way fan-out per session ---
_rooms: dict[str, set[WebSocket]] = defaultdict(set)


_SESSION_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _ok(msg: str) -> bool:
    try:
        d = json.loads(msg)
    except ValueError:
        return False
    return isinstance(d, dict) and d.get("v") == 1 and isinstance(d.get("t"), str)


@app.websocket("/ws/obs/{session}")
async def obs_relay(ws: WebSocket, session: str):
    if not _SESSION_RE.match(session):
        await ws.close(code=1008)
        return
    await ws.accept()
    _rooms[session].add(ws)
    try:
        while True:
            m = await ws.receive()
            if m.get("type") == "websocket.disconnect":
                break
            msg = m.get("text")
            if msg is None or len(msg) > 4096 or not _ok(msg):
                continue
            for peer in list(_rooms[session]):
                if peer is not ws:
                    try:
                        await peer.send_text(msg)
                    except Exception:
                        _rooms[session].discard(peer)
    except WebSocketDisconnect:
        pass
    finally:
        _rooms[session].discard(ws)
        if not _rooms[session]:
            _rooms.pop(session, None)
