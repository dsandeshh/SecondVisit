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


def _modes() -> dict:
    """Which part of the demo runs live, from cache, or from a labelled fallback. No network calls."""
    from dr import mp_import
    from dr.agents import api_stream
    key = bool(os.environ.get("ANTHROPIC_API_KEY"))
    model = bool(os.environ.get("DR_MODEL")) and key
    fast = bool(os.environ.get("DR_FAST_MODEL")) and key
    root = Path(os.environ.get("DR_BUILDINGS", Path(__file__).resolve().parents[2] / "web" / "public" / "buildings"))
    pkgs = sorted(p.parent.name for p in root.glob("*/package.json")) if root.is_dir() else []
    cached = sorted(p.parent.parent.name for p in Path(mp_import.DATA).glob("*/raw/basics.json")) if Path(mp_import.DATA).is_dir() else []
    return {
        "agent": "live model (falls back to scripted after %ss)" % api_stream.AGENT_TIMEOUT_S if model else "scripted (no model configured)",
        "coach_line": "model, grounded, template on failure" if fast else "template (no fast model configured)",
        "replays": {k: (p.name if (p := api_stream.resolve_replay(k)) else None) for k in api_stream.REPLAY_NAMES},
        "packages": pkgs,
        "sponsor": "cached only (no live sponsor call during the demo)",
        "sponsor_cache": cached,
        "showcase": "optional, localhost only" + (" (SDK key set)" if os.environ.get("MATTERPORT_SDK_KEY") else ""),
    }


@app.get("/api/health")
def health() -> dict:
    try:
        return {"ok": True, "modes": _modes()}
    except Exception as exc:  # health must never fail the demo
        return {"ok": True, "modes": {}, "note": f"mode probe failed: {type(exc).__name__}"}


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


# --- Objects list edits (rehearsal screen): rename, remove or add a landmark in data/<sid>/overrides.json ---
from pydantic import BaseModel  # noqa: E402

from dr.package import Landmark  # noqa: E402
from fastapi import HTTPException  # noqa: E402


class LandmarkEdit(BaseModel):
    op: str  # rename | remove | add
    id: str | None = None
    label: str | None = None
    landmark: Landmark | None = None


def _overrides_path(sid: str) -> Path:
    from dr import mp_import
    if not _SESSION_RE.match(sid or ""):
        raise HTTPException(status_code=400, detail="bad building id")
    return Path(mp_import.DATA) / sid / "overrides.json"


def _read_overrides(path: Path) -> dict:
    return json.loads(path.read_text()) if path.exists() else {}


@app.get("/api/overrides/{sid}")
def get_overrides(sid: str) -> dict:
    d = _read_overrides(_overrides_path(sid))
    return {k: d.get(k, v) for k, v in (("extra_landmarks", []), ("deleted_landmark_ids", []), ("label_overrides", {}))}


@app.post("/api/overrides/{sid}/landmarks")
def edit_landmark(sid: str, edit: LandmarkEdit) -> dict:
    """Writes only data/<sid>/overrides.json (R5 plus label_overrides). The package picks the change up on its
    next build; nothing here touches sponsor data."""
    path = _overrides_path(sid)
    d = _read_overrides(path)
    extra = [x for x in d.get("extra_landmarks", [])]
    deleted = list(d.get("deleted_landmark_ids", []))
    labels = dict(d.get("label_overrides", {}))
    dest = d.get("destination") or {}
    if edit.op == "add":
        if edit.landmark is None:
            raise HTTPException(status_code=422, detail="landmark required")
        lm = edit.landmark
        extra = [x for x in extra if x.get("id") != lm.id] + [lm.model_dump(mode="json")]
        deleted = [x for x in deleted if x != lm.id]
    elif edit.op in ("rename", "remove"):
        if not edit.id:
            raise HTTPException(status_code=422, detail="id required")
        if edit.op == "rename":
            label = (edit.label or "").strip()
            if not label or len(label) > 60:
                raise HTTPException(status_code=422, detail="label must be 1 to 60 characters")
            labels[edit.id] = label
            for x in extra:
                if x.get("id") == edit.id:
                    x["label"] = label
            if edit.id == "dest" and dest:
                dest["label"] = label
        else:
            if edit.id == "dest" and dest:
                raise HTTPException(status_code=409, detail="the destination is set in overrides.destination (pick.html)")
            extra = [x for x in extra if x.get("id") != edit.id]
            if edit.id not in deleted:
                deleted.append(edit.id)
            labels.pop(edit.id, None)
    else:
        raise HTTPException(status_code=422, detail="op must be rename, remove or add")
    d.update(extra_landmarks=extra, deleted_landmark_ids=deleted, label_overrides=labels)
    if dest:
        d["destination"] = dest
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(d, indent=2) + "\n")
    return {"ok": True, "extra_landmarks": extra, "deleted_landmark_ids": deleted, "label_overrides": labels,
            "note": "saved to overrides.json; rebuild the package to re-plan the route"}


# --- Live voice lines (A7b): POST /api/tts renders one line with Kokoro (node web/scripts/voice.mjs) and caches it. ---
import subprocess
import uuid

from fastapi import HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

_ROOT = Path(__file__).resolve().parents[2]
TTS_CACHE = _ROOT / "data" / "tts_cache"
TTS_TIMEOUT_S = 10
_VOICE_RE = re.compile(r"^[a-z]{2}_[a-z0-9]{2,20}$")


class TtsRequest(BaseModel):
    text: str
    voice: str | None = None


@app.post("/api/tts")
def tts_endpoint(req: TtsRequest) -> FileResponse:
    from dr.voice_lines import line_id, normalise

    voice = req.voice or os.environ.get("SV_VOICE") or "af_heart"
    text = normalise(req.text)
    if not text or len(text) > 500 or not _VOICE_RE.match(voice):
        raise HTTPException(422, "text (1 to 500 chars) and a voice like af_heart are required")
    out = TTS_CACHE / voice / f"{line_id(text)}.wav"
    if not (out.is_file() and out.stat().st_size > 0):
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_name(f".{uuid.uuid4().hex}.wav")
        try:
            # the script ends by SIGKILL (onnxruntime aborts at exit), so judge by the file, not the exit code
            subprocess.run(["node", str(_ROOT / "web" / "scripts" / "voice.mjs"), "--render", text, voice, str(tmp)],
                           cwd=_ROOT / "web", timeout=TTS_TIMEOUT_S, capture_output=True)
            if not (tmp.is_file() and tmp.stat().st_size > 0):
                raise HTTPException(503, "voice render failed")
            tmp.replace(out)
        except (subprocess.TimeoutExpired, OSError) as exc:
            raise HTTPException(503, f"voice render unavailable: {type(exc).__name__}") from exc
        finally:
            tmp.unlink(missing_ok=True)
    return FileResponse(out, media_type="audio/wav")
