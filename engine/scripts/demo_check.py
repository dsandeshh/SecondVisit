"""Offline demo check (Task 16). Run from engine/:  .venv/bin/python scripts/demo_check.py [--require-clinic]

Strips every model and sponsor credential from the environment, blocks outbound sockets, then:
builds and validates the fixture and clinic packages, and hits every demo endpoint through TestClient.
Exit 0 only if every check passes. The clinic is sponsor derived and local only: skipped with a loud
note when its cached data is absent, unless --require-clinic is given.
"""
from __future__ import annotations

import json
import os
import socket
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "engine"))
CLINIC = "x37LjPx62VA"
results: list[tuple[str, bool, str]] = []


def check(name: str, fn) -> None:
    try:
        detail = fn() or ""
        results.append((name, True, str(detail)))
    except Exception as e:  # noqa: BLE001
        results.append((name, False, f"{type(e).__name__}: {str(e)[:200]}"))
    r = results[-1]
    print(f"[{'ok' if r[1] else 'FAIL'}] {r[0]}" + (f"  {r[2]}" if r[2] else ""))


def go_offline() -> None:
    for k in ("ANTHROPIC_API_KEY", "DR_MODEL", "DR_FAST_MODEL", "MATTERPORT_API_KEY", "MATTERPORT_API_TOKEN",
              "VEXCEL_API_KEY", "COSTAR_API_KEY", "LANGSMITH_API_KEY", "LANGSMITH_TRACING"):
        os.environ.pop(k, None)
    os.environ["LANGCHAIN_TRACING_V2"] = "false"
    real = socket.socket.connect

    def guard(self, addr, *a, **k):
        if isinstance(addr, tuple) and addr and addr[0] not in ("127.0.0.1", "localhost", "::1"):
            raise OSError(f"demo_check: outbound connection to {addr[0]} blocked (the demo must work offline)")
        return real(self, addr, *a, **k)

    socket.socket.connect = guard  # type: ignore[method-assign]


def sse_events(resp) -> list[dict]:
    return [json.loads(l[6:]) for l in resp.text.splitlines() if l.startswith("data: ")]


def main() -> int:
    require_clinic = "--require-clinic" in sys.argv
    from fastapi.testclient import TestClient

    from dr import pipeline
    from dr.api import app  # loads .env, so strip credentials only after this import
    from dr.package import BuildingPackage

    go_offline()
    traces = ROOT / "traces"
    before = set(traces.glob("*.jsonl")) if traces.is_dir() else set()

    def route_ok(pkg: BuildingPackage) -> str:
        assert pkg.routes and pkg.routes[0].segments, "no route"
        assert pkg.routes[0].segments[0].instruction, "no instruction text"
        return f"{len(pkg.routes[0].segments)} segments, score {pkg.routes[0].score.total:.1f}"

    def fixture_build():
        pkg = pipeline.fixture_package()
        pipeline.add_route(pkg, None, None, None, None)
        BuildingPackage.model_validate(json.loads(pkg.model_dump_json(by_alias=True)))
        return route_ok(pkg)

    def committed(name: str):
        p = ROOT / "web" / "public" / "buildings" / name / "package.json"
        pkg = BuildingPackage.model_validate_json(p.read_text())
        return route_ok(pkg)

    def clinic_build():
        if not (ROOT / "data" / CLINIC / "raw" / "basics.json").exists():
            if require_clinic:
                raise RuntimeError("clinic cache missing: data/%s/raw" % CLINIC)
            return "SKIPPED (no local sponsor cache; clinic is local only)"
        with tempfile.TemporaryDirectory() as td:
            pkg = pipeline.build_package(CLINIC, web_root=Path(td))
        return route_ok(pkg)

    def clinic_committed():
        if not (ROOT / "web/public/buildings" / CLINIC / "package.json").exists():
            if require_clinic:
                raise RuntimeError("clinic package missing")
            return "SKIPPED (not built locally)"
        return committed(CLINIC)

    check("fixture package builds offline", fixture_build)
    check("committed fixture package validates", lambda: committed("fixture"))
    check("clinic package builds from cache", clinic_build)
    check("clinic package.json validates", clinic_committed)

    c = TestClient(app)

    def health():
        j = c.get("/api/health").json()
        assert j["ok"] is True and j["modes"]["agent"].startswith("scripted"), j
        assert j["modes"]["coach_line"].startswith("template"), j
        assert all(j["modes"]["replays"].values()), f"missing replay {j['modes']['replays']}"
        assert "fixture" in j["modes"]["packages"], "fixture package missing"
        return f"agent={j['modes']['agent']!r}; coach={j['modes']['coach_line']!r}"

    def replays():
        j = c.get("/api/agent/replays").json()
        assert j["visitor"] and j["venue"], j
        out = []
        for n in ("visitor", "venue"):
            ev = sse_events(c.get(f"/api/agent/replay?name={n}&speed=1000"))
            assert ev[0]["mode"] == "replay" and ev[-1]["type"] == "final", [e["type"] for e in ev][-3:]
            out.append(f"{n}:{len(ev)} events")
        assert c.get("/api/agent/replay?name=nope").status_code == 404
        return ", ".join(out)

    def scripted(text: str, bid: str, kind: str):
        ev = sse_events(c.post("/api/agent", json={"text": text, "building_id": bid, "mode": "scripted"}))
        assert ev[0]["mode"] == "scripted" and ev[-1]["type"] == "final", [e["type"] for e in ev]
        assert ev[-1]["result"]["mode"] == "scripted"
        return f"{len(ev)} events, kind={ev[-1]['result'].get('kind')}"

    def agent_no_model():
        """mode=agent with no model must fall back to scripted, labelled, never hang or 500."""
        r = c.post("/api/agent", json={"text": "appointment at the front desk", "building_id": "fixture"})
        assert r.status_code == 200
        ev = sse_events(r)
        types = [e["type"] for e in ev]
        assert "fallback" in types and types[-1] == "final", types
        assert ev[-1]["result"]["mode"] == "scripted"
        return "fallback then scripted final: " + next(e["reason"] for e in ev if e["type"] == "fallback")[:60]

    body = {"thread_id": "t", "route_id": "r", "building_id": "fixture",
            "events": [{"t": 0, "seg": 1, "kind": "hint", "pos": [0, 0]}], "quiz": [], "point": []}

    def coach():
        j = c.post("/api/coach", json=body).json()
        assert j["line"] and j["plan"]["repeat_segment"] == 1, j
        return f"template line: {j['line'][:50]!r}"

    def overrides():
        r = c.get(f"/api/overrides/{CLINIC}")
        assert r.status_code == 200 and "extra_landmarks" in r.json()
        assert c.get("/api/overrides/bad..id").status_code in (400, 404, 422)

    def relay():
        ok = '{"v":1,"t":"hello"}'
        with c.websocket_connect("/ws/obs/demo_check") as a, c.websocket_connect("/ws/obs/demo_check") as b:
            a.send_text(ok)
            assert b.receive_text() == ok

    def errors():
        assert c.post("/api/coach", json={}).status_code == 422
        assert c.post("/api/agent", json={}).status_code == 422
        assert c.post("/api/overrides/fixture/landmarks", json={"op": "zap"}).status_code == 422

    def web_assets():
        d = ROOT / "web"
        for f in ("index.html", "observer.html", "venue.html", "pick.html"):
            assert (d / f).exists(), f
        return "html entries present"

    def showcase_fallback():
        """Photo view needs internet: offline the SDK cannot load, so the page must be able to fall back to the scan."""
        d = ROOT / "web" / "src" / "showcase"
        load, idx = (d / "load.ts").read_text(), (d / "index.ts").read_text()
        assert "Photo view needs internet; showing the scan." in load, "fallback line missing"
        assert "SDK_TIMEOUT_MS = 8000" in load, "8 s timeout missing"
        assert "navigator.onLine === false" in idx and "onFail" in idx, "offline path does not call onFail"
        assert "static.matterport.com" in load and "my.matterport.com" in idx, "expected remote Showcase hosts (these are what fail offline)"
        return "offline -> onFail within 8 s, line: Photo view needs internet; showing the scan."

    check("GET /api/health reports modes (offline)", health)
    check("GET /api/agent/replay[s] plays both recordings", replays)
    check("POST /api/agent scripted visitor (fixture)", lambda: scripted("appointment at the front desk", "fixture", "rehearsal"))
    check("POST /api/agent scripted venue (fixture)", lambda: scripted("Where should our reception desk go?", "fixture", "layout"))
    check("POST /api/agent agent mode with no model falls back", agent_no_model)
    check("POST /api/coach template line", coach)
    check("GET /api/overrides", overrides)
    check("WS /ws/obs relay", relay)
    check("clear 4xx errors on bad input", errors)
    def clinic_panos():
        if not (ROOT / "data" / CLINIC / "raw" / "panos.json").exists():
            return "SKIPPED (no local sponsor cache)"
        d = json.loads((ROOT / "web/public/buildings" / CLINIC / "panos.json").read_text())
        assert d and all({"id", "position"} <= set(p) for p in d), "panos.json malformed"
        return f"{len(d)} panos"

    check("clinic panos.json exists and parses (photo view)", clinic_panos)
    check("web entry pages present", web_assets)
    check("Showcase photo view falls back offline", showcase_fallback)

    for f in (set(traces.glob("*.jsonl")) - before) if traces.is_dir() else ():
        f.unlink()  # traces written by this check's own runs
    bad = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(bad)}/{len(results)} checks passed")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
