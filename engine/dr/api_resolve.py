"""GET /api/resolve?q=: the home address box. Runs dr.resolver offline (local index CSV, no network) over the
buildings that have a package on disk, so the answer is always something the app can open."""
from __future__ import annotations

import os
import re
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from dr import resolver

router = APIRouter()
MIN_SCORE = 60.0


def _buildings() -> Path:
    return Path(os.environ.get("DR_BUILDINGS", Path(__file__).resolve().parents[2] / "web" / "public" / "buildings"))


def _variants(q: str) -> list[str]:
    return list({q, re.sub(r"\bFM[\s-]*(\d+)", r"FM-\1", q, flags=re.I), re.sub(r"[-,]", " ", q)})


def resolve_ready(q: str, k: int = 3) -> list[dict]:
    ready = {p.parent.name for p in _buildings().glob("*/package.json")}
    best: dict[str, dict] = {}
    for v in _variants(q):
        for c in resolver.search_index(v, k=100000):
            if c["sid"] in ready and c["score"] > best.get(c["sid"], {"score": -1})["score"]:
                best[c["sid"]] = c
    return sorted(best.values(), key=lambda c: -c["score"])[:k]


@router.get("/api/resolve")
def api_resolve(q: str = ""):
    q = q.strip()
    if not q:
        return JSONResponse({"error": "empty"}, status_code=400)
    try:
        cands = resolve_ready(q)
    except FileNotFoundError as e:
        return JSONResponse({"error": str(e)}, status_code=503)
    if not cands or cands[0]["score"] < MIN_SCORE:
        return JSONResponse({"error": "not_found", "candidates": []}, status_code=404)
    slim = [{k: c[k] for k in ("sid", "name", "address", "city", "score")} for c in cands]
    return {"sid": cands[0]["sid"], "name": cands[0]["name"], "address": cands[0]["address"], "candidates": slim,
            "prov": {"source": "models_index.csv", "matcher": "rapidfuzz token_set_ratio", "offline": True}}
