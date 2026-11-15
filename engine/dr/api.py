"""FastAPI app. Later tasks append routers; keep edits additive."""
from __future__ import annotations

import json
import re
from collections import defaultdict

import os
from pathlib import Path

import os
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from dr.package import RunLog

from dr.package import RunLog

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _load_env() -> None:
    try:
        from dotenv import load_dotenv
        load_dotenv(Path(__file__).resolve().parents[2] / ".env")
    except Exception:
        pass


_load_env()


def _load_env() -> None:
    try:
        from dotenv import load_dotenv
        load_dotenv(Path(__file__).resolve().parents[2] / ".env")
    except Exception:
        pass


_load_env()


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


# --- Coach (Task 10 engine): RunLog in, RunPlan out. Rules decide; the model writes one grounded line. ---
class CoachRequest(RunLog):
    building_id: str = ""


def _route_segments(building_id: str, route_id: str) -> list[dict] | None:
    root = Path(os.environ.get("DR_BUILDINGS", Path(__file__).resolve().parents[2] / "web" / "public" / "buildings"))
    if not _SESSION_RE.match(building_id or ""):
        return None
    try:
        pkg = json.loads((root / building_id / "package.json").read_text())
        return next(r["segments"] for r in pkg["routes"] if r["id"] == route_id)
    except Exception:
        return None


@app.post("/api/coach")
def coach_endpoint(req: CoachRequest) -> dict:
    from dr.coach_rules import coach

    segs = _route_segments(req.building_id, req.route_id)
    if segs:
        n = len(segs)
        allowed = {float(v) for s in segs for k in ("steps", "length_m", "turn_deg") if (v := s.get(k)) is not None}
    else:
        n = max([e.seg for e in req.events] + [q.seg for q in req.quiz] + [0]) + 1
        allowed = set()
    return coach(req, n, allowed)


# --- Coach (Task 10 engine): RunLog in, RunPlan out. Rules decide; the model writes one grounded line. ---
class CoachRequest(RunLog):
    building_id: str = ""


def _route_segments(building_id: str, route_id: str) -> list[dict] | None:
    root = Path(os.environ.get("DR_BUILDINGS", Path(__file__).resolve().parents[2] / "web" / "public" / "buildings"))
    if not _SESSION_RE.match(building_id or ""):
        return None
    try:
        pkg = json.loads((root / building_id / "package.json").read_text())
        return next(r["segments"] for r in pkg["routes"] if r["id"] == route_id)
    except Exception:
        return None


@app.post("/api/coach")
def coach_endpoint(req: CoachRequest) -> dict:
    from dr.coach_rules import coach

    segs = _route_segments(req.building_id, req.route_id)
    if segs:
        n = len(segs)
        allowed = {float(v) for s in segs for k in ("steps", "length_m", "turn_deg") if (v := s.get(k)) is not None}
    else:
        n = max([e.seg for e in req.events] + [q.seg for q in req.quiz] + [0]) + 1
        allowed = set()
    return coach(req, n, allowed)


# --- Agent stream (Task 13): POST /api/agent, /api/agent/resume, GET /api/agent/replay, /share (R4) ---
from dr.agents.api_stream import router as agent_router  # noqa: E402  (after _load_env so DR_* are set)

app.include_router(agent_router)
