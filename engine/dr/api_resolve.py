"""GET /api/resolve?q=: the home address box. Runs dr.resolver offline (local index CSV, no network) and answers in
three tiers (resolver.tier):

- ready (200): a building with a package on disk; the app opens it.
- outdoor (200): a real Matterport model in Houston or Los Angeles with no built package; the app says
  NO_INDOOR_LINE and offers the built buildings. No sponsor call is made here.
- none (404): anything else; the app says NOT_AVAILABLE_LINE and offers the built buildings.
"""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from dr import resolver
from dr.voice_lines import NO_INDOOR_LINE, NOT_AVAILABLE_LINE

router = APIRouter()
MIN_SCORE = resolver.READY_MIN_SCORE
PROV = {"source": "models_index.csv", "matcher": "rapidfuzz token_set_ratio", "offline": True}


def _buildings() -> Path:
    return Path(os.environ.get("DR_BUILDINGS", Path(__file__).resolve().parents[2] / "web" / "public" / "buildings"))


def ready_sids() -> set[str]:
    return {p.parent.name for p in _buildings().glob("*/package.json")}


def _slim(c: dict) -> dict:
    return {k: c[k] for k in ("sid", "name", "address", "city", "score")}


@router.get("/api/resolve")
def api_resolve(q: str = ""):
    q = q.strip()
    if not q:
        return JSONResponse({"error": "empty"}, status_code=400)
    try:
        t = resolver.tier(q, ready_sids())
    except FileNotFoundError as e:
        return JSONResponse({"error": str(e)}, status_code=503)
    b = t["best"]
    if t["tier"] == "ready":
        return {"tier": "ready", "sid": b["sid"], "name": b["name"], "address": b["address"],
                "candidates": [_slim(c) for c in t["candidates"]], "prov": PROV}
    if t["tier"] == "outdoor":
        return {"tier": "outdoor", "sid": b["sid"], "name": b["name"], "address": b["address"], "city": t["city"],
                "lat": b["lat"], "lon": b["lon"], "message": NO_INDOOR_LINE, "prov": PROV}
    return JSONResponse({"error": "not_found", "tier": "none", "message": NOT_AVAILABLE_LINE, "candidates": []},
                        status_code=404)
