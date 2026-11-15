"""FastAPI app. Later tasks append routers; keep edits additive."""
from __future__ import annotations

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


@app.websocket("/ws/obs/{session}")
async def obs_relay(ws: WebSocket, session: str):
    await ws.accept()
    _rooms[session].add(ws)
    try:
        while True:
            msg = await ws.receive_text()
            if len(msg) > 4096:
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
