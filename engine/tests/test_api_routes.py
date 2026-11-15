"""api.py route hygiene: no (method, path) registered twice; every demo endpoint exists."""
from collections import Counter

from dr.api import app

DEMO_ROUTES = {
    ("GET", "/api/health"),
    ("GET", "/api/agent/replays"),
    ("GET", "/api/agent/replay"),
    ("POST", "/api/agent"),
    ("POST", "/api/coach"),
    ("GET", "/api/overrides/{sid}"),
    ("POST", "/api/overrides/{sid}/landmarks"),
    ("POST", "/api/tts"),
    ("WS", "/ws/obs/{session}"),
}


def _flat(routes):
    for r in routes:
        if hasattr(r, "original_router"):  # include_router wraps in newer FastAPI (no prefix used here)
            yield from _flat(r.original_router.routes)
        else:
            yield r


def _pairs():
    out = []
    for r in _flat(app.routes):
        path = getattr(r, "path", None)
        if path is None:
            continue
        methods = getattr(r, "methods", None) or {"WS"}
        out += [(m, path) for m in methods if m != "HEAD"]
    return out


def test_no_duplicate_routes():
    dups = [p for p, n in Counter(_pairs()).items() if n > 1]
    assert not dups, dups


def test_demo_endpoints_exist():
    assert DEMO_ROUTES <= set(_pairs())
