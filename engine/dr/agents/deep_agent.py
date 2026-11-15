"""SecondVisit deep agent (LangChain Deep Agents, verified against deepagents 0.7.38).

One orchestrator plus four specialised subagents. Every tool is a thin wrapper over the
deterministic engine in `dr.*` (docs/plan.md). The rule from CLAUDE.md holds here too:
geometry decides, models describe. Tools compute every number, store it in a per thread
Workspace, and write code generated files into the agent's virtual filesystem. The model
chooses which tool to call next, matches words to ids, decides how to recover from a failure,
asks the visitor when a choice is ambiguous, and writes short sentences. Numbers in any model
written sentence are checked against the Workspace before they reach a user.

Place this file at engine/dr/agents/deep_agent.py. It imports dr.* lazily inside DrEngine so the
agent can be built and tested before the engine exists (tests inject a FakeEngine).

Env:
  DR_MODEL       orchestrator model, e.g. "anthropic:claude-sonnet-5-5" (a bare id gets "anthropic:")
  DR_FAST_MODEL  subagent model, e.g. "anthropic:claude-haiku-5-5" (defaults to DR_MODEL)
  DR_BUILDINGS   folder with <id>/package.json (default ../web/public/buildings)
  LANGSMITH_TRACING=true, LANGSMITH_API_KEY, LANGSMITH_PROJECT=secondvisit  (optional tracing)
"""
from __future__ import annotations

import json
import math
import os
import re
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Protocol

from langchain.agents.middleware import (
    ModelCallLimitMiddleware,
    TodoListMiddleware,
    ToolCallLimitMiddleware,
)
from langchain.tools import ToolRuntime, tool
from langchain_core.messages import ToolMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.config import get_stream_writer
from langgraph.types import Command, interrupt

from deepagents import (
    GeneralPurposeSubagentProfile,
    HarnessProfile,
    create_deep_agent,
    register_harness_profile,
)
from deepagents.backends.utils import create_file_data

# Retry ladder for NoRouteError. The agent picks the rung; code enforces the bounds.
MIN_CLEARANCE_M = 0.25
DEFAULT_CLEARANCE_M = 0.35
MAX_SPECK_M2 = 0.10
MAX_LAYOUT_EVALS = 6
LOW_CONFIDENCE = 0.6


# ---------------------------------------------------------------------------
# Engine adapter: the only place that knows dr.* function names.
# ---------------------------------------------------------------------------
class NoRoute(Exception):
    """Raised by an Engine when the planner finds no route."""


class Engine(Protocol):
    def resolve(self, name: str) -> dict: ...
    def package(self, building_id: str) -> dict: ...
    def build_route(self, building_id: str, from_id: str, to_id: str,
                    clearance_m: float, drop_specks_m2: float) -> dict: ...
    def simulate(self, building_id: str, route: dict, runs: int) -> dict: ...
    def tally(self, run_log: dict, n_segments: int) -> list[float]: ...
    def make_plan(self, focus: int, drill: str) -> dict: ...
    def layout_candidates(self, building_id: str, desk_id: str, n: int) -> list[dict]: ...
    def evaluate_layout(self, building_id: str, desk: list[float], fixes: list[dict]) -> dict: ...
    def fix_between(self, building_id: str, kind: str, a_id: str, b_id: str) -> dict: ...
    def grounded(self, text: str, allowed: set[float]) -> bool: ...
    def landmark_review(self, building_id: str) -> dict: ...


class DrEngine:
    """The only class that imports dr.* (CLAUDE.md rule 1). Wraps the real engine modules.

    Package source order: <DR_BUILDINGS>/<id>/package.json, then the fixture, then an offline
    pipeline.build_package(sid) when raw sponsor data is cached. Simulation uses dr.simulate (Task 11)
    when present, else a labelled stub ("simulated (stub)")."""

    def __init__(self, buildings_dir: str | None = None):
        default = Path(__file__).resolve().parents[3] / "web" / "public" / "buildings"
        self.dir = Path(buildings_dir or os.environ.get("DR_BUILDINGS") or default)
        self._pkgs: dict[str, Any] = {}

    def _pkg(self, building_id: str):
        from dr.package import BuildingPackage
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", building_id or ""):
            raise FileNotFoundError(f"bad building id {building_id!r}")
        if building_id not in self._pkgs:
            f = self.dir / building_id / "package.json"
            if f.exists():
                pkg = BuildingPackage.model_validate_json(f.read_text())
            elif building_id == "fixture":
                from dr.pipeline import fixture_package
                pkg = fixture_package()
            else:
                from dr.pipeline import build_package
                try:
                    pkg = build_package(building_id)
                except SystemExit as exc:  # the CLI helpers exit instead of raising
                    raise FileNotFoundError(str(exc)) from exc
            self._pkgs[building_id] = pkg
        return self._pkgs[building_id]

    @staticmethod
    def _grid(pkg, drop_specks_m2: float = 0.0):
        from dr.grid import OccGrid
        from dr.pipeline import promote_fixed
        g = pkg.grid
        grid = promote_fixed(OccGrid.from_b64(g.cells_b64, g.width, g.height, g.res, tuple(g.origin)), pkg.landmarks)
        return grid

    def grounded(self, text: str, allowed: set[float]) -> bool:
        from dr.grounding import grounded
        return grounded(text, allowed)

    def resolve(self, name: str) -> dict:
        from dr.resolver import resolve
        r = resolve(name)
        best = r.get("best")
        if not best:
            raise LookupError("no building matches that name")
        return {"building_id": best["sid"], "name": best["name"], "address": best["address"],
                "costar_property_id": best["costar_property_id"] or None, "ambiguous": r["ambiguous"],
                "alternatives": [c["sid"] for c in r["candidates"][1:4]] if r["ambiguous"] else [],
                "source": "costar" if r.get("costar") else "directory"}

    def package(self, building_id: str) -> dict:
        d = self._pkg(building_id).model_dump(mode="json", by_alias=True)
        d["grid"] = {k: v for k, v in d["grid"].items() if k != "cells_b64"}  # never send the grid to a model
        return d

    def build_route(self, building_id, from_id, to_id, clearance_m, drop_specks_m2) -> dict:
        from dataclasses import replace
        from dr import instructions
        from dr.package import Route, Score
        from dr.planner import NoRouteError, Weights, approach_point, plan
        from dr.score import score_route
        from dr.segments import segment
        pkg = self._pkg(building_id)
        grid = self._grid(pkg)
        pts = {e.id: e.pos for e in pkg.entrances} | {l.id: l.pos for l in pkg.landmarks}
        for i in (from_id, to_id):
            if i not in pts:
                raise KeyError(i)
        w = replace(Weights(), clearance_m=clearance_m, drop_specks_m2=drop_specks_m2)
        try:
            path = plan(grid, tuple(pts[from_id]), approach_point(grid, pts[to_id]), pkg.landmarks, w)
        except NoRouteError as exc:
            raise NoRoute(str(exc)) from exc
        segs = instructions.write(segment(path, grid, pkg.landmarks), pkg.landmarks, pkg.entrances,
                                  dest=to_id if any(l.id == to_id for l in pkg.landmarks) else None)
        from dr.doorway import add_doorways
        segs = add_doorways(segs, path, grid, pkg.landmarks)
        sc = score_route(segs, grid, pkg.landmarks)
        route = Route(id=f"{from_id}__{to_id}", **{"from": from_id}, to=to_id, path=path, segments=segs,
                      score=Score(total=sc["total"], parts=sc["parts"]))
        return route.model_dump(mode="json", by_alias=True)

    def simulate(self, building_id, route, runs) -> dict:
        from dr.package import Route
        pkg = self._pkg(building_id)
        r = Route.model_validate(route)
        try:
            from dr.simulate import simulate
            res, label = simulate(self._grid(pkg), r, runs=runs, seed=0), "simulated"
        except ImportError:
            from dr.layout import _stub_sim
            res, label = _stub_sim(self._grid(pkg), r, runs=runs), "simulated (stub: Task 11 not present)"
        return {"runs": res.runs, "arrival_rate": round(res.arrival_rate, 3), "label": label,
                "hotspots": _hotspots(res.lost_cells_b64, pkg, route)}

    def tally(self, run_log, n_segments) -> list[float]:
        from dr.coach_rules import tally
        from dr.package import RunLog
        return tally(RunLog.model_validate({"thread_id": "agent", "route_id": "", **run_log}), n_segments)

    def make_plan(self, focus, drill) -> dict:
        from dr.coach_rules import make_plan
        return make_plan(focus, drill).model_dump()

    def layout_candidates(self, building_id, desk_id, n) -> list[dict]:
        from dr.layout import candidates, evaluate
        pkg = self._pkg(building_id)
        grid = self._grid(pkg)
        others = [l for l in pkg.landmarks if l.id != desk_id]
        # code ranking: cheap pre-rank by distance to the nearest entrance, then evaluate the top few
        pool = sorted(candidates(grid, pkg.entrances, n=40),
                      key=lambda p: min(math.dist(p, e.pos) for e in pkg.entrances))[: max(n, 3) * 2]
        scored = []
        for pos in pool:
            ev = evaluate(grid, pkg.entrances, pos, [], landmarks=others, runs=40)
            scored.append({"pos": [round(pos[0], 2), round(pos[1], 2)], "score": ev["score"],
                           "arrival_rate": ev["arrival_rate"], "label": ev["arrival_label"]})
        scored.sort(key=lambda c: (-c["score"], -c["arrival_rate"]))
        return scored[:n]

    def evaluate_layout(self, building_id, desk, fixes) -> dict:
        from dr.layout import evaluate
        pkg = self._pkg(building_id)
        ev = evaluate(self._grid(pkg), pkg.entrances, tuple(desk), fixes,
                      landmarks=[l for l in pkg.landmarks if math.dist(l.pos, desk) > 0.5])
        route = ev["route"].model_dump(mode="json", by_alias=True) if ev["route"] else {"segments": []}
        return {"score": ev["score"], "arrival_rate": ev["arrival_rate"], "label": ev["arrival_label"],
                "open_m": ev["open_m"], "turns": ev["turns"], "route": route}

    def fix_between(self, building_id, kind, a_id, b_id) -> dict:
        pkg = self._pkg(building_id)
        pts = {l.id: list(l.pos) for l in pkg.landmarks} | {e.id: list(e.pos) for e in pkg.entrances}
        if a_id not in pts or b_id not in pts:
            raise KeyError(f"unknown landmark id {a_id if a_id not in pts else b_id}")
        return {"kind": kind, "path": [pts[a_id], pts[b_id]]}

    def landmark_review(self, building_id: str) -> dict:
        """Annotator tool backing: what the vision annotator (offline, dr.annotate) produced."""
        pkg = self._pkg(building_id)
        rows = []
        for l in pkg.landmarks:
            pv = pkg.prov.get(f"landmark:{l.id}")
            rows.append({"id": l.id, "kind": l.kind, "label": l.label, "confidence": l.confidence,
                         "fixed": l.fixed, "source": pv.src if pv else None})
        return {"landmarks": rows}


def _hotspots(lost_b64: str, pkg, route: dict, k: int = 3) -> list[dict]:
    """Top k lost areas, each tied to the nearest segment index and landmark (code, not model)."""
    import base64
    import numpy as np
    from scipy import ndimage
    g = pkg.grid
    if not lost_b64:
        return []
    lost = np.frombuffer(base64.b64decode(lost_b64), dtype=np.uint8).reshape(g.height, g.width).astype(float)
    if lost.sum() == 0:
        return []
    smooth = ndimage.uniform_filter(lost, size=max(1, int(1.0 / g.res)))
    out = []
    for _ in range(k):
        r, c = np.unravel_index(int(smooth.argmax()), smooth.shape)
        if smooth[r, c] <= 0:
            break
        p = (g.origin[0] + (c + 0.5) * g.res, g.origin[1] + (r + 0.5) * g.res)
        seg_i = min(range(len(route["segments"])),
                    key=lambda i: _dist_to_seg(p, route["segments"][i]["start"], route["segments"][i]["end"]))
        lm = min(pkg.landmarks, key=lambda l: math.dist(p, l.pos)) if pkg.landmarks else None
        out.append({"pos": [round(float(p[0]), 1), round(float(p[1]), 1)], "segment": seg_i,
                    "near": lm.id if lm else None, "share": round(float(lost[max(0, r-5):r+6, max(0, c-5):c+6].sum() / lost.sum()), 2)})
        smooth[max(0, r-10):r+11, max(0, c-10):c+11] = 0
    return out


def _dist_to_seg(p, a, b) -> float:
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0.0 if L == 0 else max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L))
    return math.dist(p, (ax + t * dx, ay + t * dy))


# ---------------------------------------------------------------------------
# Workspace: the source of truth for every number the UI shows.
# ---------------------------------------------------------------------------
@dataclass
class Workspace:
    thread_id: str
    engine: Engine
    request: dict = field(default_factory=dict)
    buildings: dict[str, dict] = field(default_factory=dict)
    routes: dict[str, dict] = field(default_factory=dict)
    sims: dict[str, dict] = field(default_factory=dict)
    plans: dict[str, dict] = field(default_factory=dict)
    evals: dict[str, dict] = field(default_factory=dict)
    rounds: list[dict] = field(default_factory=list)
    run_logs: dict[str, dict] = field(default_factory=dict)
    answers: list[dict] = field(default_factory=list)
    final: dict | None = None
    counters: dict[str, int] = field(default_factory=dict)

    def new_id(self, prefix: str) -> str:
        self.counters[prefix] = self.counters.get(prefix, 0) + 1
        return f"{prefix}{self.counters[prefix]}"

    def numbers(self, scope: Any = None) -> set[float]:
        """Numbers a sentence may mention, in the spoken forms we accept. scope narrows the
        search to the objects the sentence is about (default: all results)."""
        return numbers_in(scope if scope is not None else
                          [self.routes, self.sims, self.plans, self.evals])


def numbers_in(obj: Any) -> set[float]:
    """Every number in obj plus its spoken forms (rounded to 1 decimal, percent for 0..1)."""
    found: set[float] = set()

    def add(x: float):
        found.update({float(x), round(float(x), 1), float(int(round(x)))})
        if 0 <= x <= 1:
            found.add(float(int(round(100 * x))))

    def walk(o):
        if isinstance(o, bool):
            return
        if isinstance(o, (int, float)):
            add(float(o))
        elif isinstance(o, str):
            for m in _NUM.findall(o):
                found.add(float(m))
        elif isinstance(o, dict):
            for v in o.values():
                walk(v)
        elif isinstance(o, (list, tuple)):
            for v in o:
                walk(v)

    walk(obj)
    return found


_NUM = re.compile(r"\d+(?:\.\d+)?")
_WORKSPACES: dict[str, Workspace] = {}
_LOCK = threading.Lock()


def open_workspace(thread_id: str, engine: Engine, request: dict | None = None) -> Workspace:
    with _LOCK:
        ws = _WORKSPACES.get(thread_id)
        if ws is None:
            ws = _WORKSPACES[thread_id] = Workspace(thread_id, engine)
        if request:
            ws.request = request
        return ws


def get_workspace(thread_id: str) -> Workspace:
    return _WORKSPACES[thread_id]


def grounded(text: str, ws: Workspace, scope: Any = None) -> bool:
    """True when every number in text exists in the workspace results, or in scope when given
    (CLAUDE.md rule 1, R7: the check itself is dr.grounding.grounded, reached through the engine)."""
    return ws.engine.grounded(text, ws.numbers(scope))


# ---------------------------------------------------------------------------
# Tool implementations: plain functions shared by the agent and the scripted fallback.
# Each returns (payload for the model, {path: file content} written by code).
# ---------------------------------------------------------------------------
Files = dict[str, str]


def t_resolve_place(ws: Workspace, name: str) -> tuple[dict, Files]:
    try:
        r = ws.engine.resolve(name)
    except Exception as exc:  # resolver offline or no match
        return {"ok": False, "error": f"resolve failed: {exc}",
                "hint": "ask the visitor for the building name or address"}, {}
    return {"ok": True, **r}, {}


def t_inspect_building(ws: Workspace, building_id: str) -> tuple[dict, Files]:
    try:
        pkg = ws.engine.package(building_id)
    except Exception as exc:
        return {"ok": False, "error": f"no package for {building_id}: {exc}"}, {}
    ws.buildings[building_id] = pkg
    lms = pkg.get("landmarks", [])
    low = [l["label"] for l in lms if l["confidence"] < LOW_CONFIDENCE]
    arrival = pkg.get("arrival")
    gaps = []
    if pkg["source"] == "fixture":
        gaps.append("invented fixture lobby, not a real building")
    elif pkg["source"] == "matterport":
        gaps.append("interior map is derived from a Matterport scan (MP), not surveyed")
    if arrival is None:
        gaps.append("no aerial arrival data: rehearsal starts at the door, not the curb")
    elif not arrival.get("confirmed"):
        gaps.append("entrance pin not confirmed by a person")
    if low:
        gaps.append("low confidence landmarks, shown as AI chips with their confidence: " + ", ".join(low))
    gaps += pkg.get("notes", [])
    summary = {
        "ok": True, "building_id": building_id, "name": pkg["name"], "source": pkg["source"],
        "entrances": [{"id": e["id"], "label": e["label"]} for e in pkg["entrances"]],
        "destinations": [{"id": l["id"], "kind": l["kind"], "label": l["label"],
                          "confidence": l["confidence"]} for l in lms],
        "has_arrival": arrival is not None,
        "precomputed_routes": [r["id"] for r in pkg.get("routes", [])],
        "uncertainty": gaps,
    }
    dossier = _dossier_md(pkg, summary)
    return summary, {"/building_dossier.md": dossier}


def _dossier_md(pkg: dict, s: dict) -> str:
    lines = [f"# Building dossier: {pkg['name']}", "",
             "Written by code from the BuildingPackage. The agent may append notes below the line.", "",
             "## Provenance", "| Layer | Status |", "|---|---|",
             f"| Interior | {pkg['source']} (model {pkg.get('model_id') or 'none'}) |",
             f"| Arrival (Vexcel) | {'confirmed' if (pkg.get('arrival') or {}).get('confirmed') else 'missing or unconfirmed'} |",
             f"| Directory | generated {pkg.get('generated_at', '?')} |", "",
             "## Destinations", "| id | kind | label | confidence |", "|---|---|---|---|"]
    lines += [f"| {d['id']} | {d['kind']} | {d['label']} | {d['confidence']:.2f} |" for d in s["destinations"]]
    lines += ["", "## Uncertainty"] + [f"- {g}" for g in s["uncertainty"]] + ["", "---", "## Agent notes", ""]
    return "\n".join(lines)


def t_review_landmarks(ws: Workspace, building_id: str) -> tuple[dict, Files]:
    """Annotator tool: report which landmarks the vision annotator found, how sure it was, and which
    a human confirmed (HAND). The vision pass itself (dr.annotate.Annotator) runs offline with a look
    budget; this tool reads its results and never invents a landmark."""
    try:
        rev = ws.engine.landmark_review(building_id)
    except Exception as exc:
        return {"ok": False, "error": f"no landmark data for {building_id}: {exc}"}, {}
    rows = rev["landmarks"]
    weak = [r for r in rows if r["confidence"] < LOW_CONFIDENCE and r.get("source") != "hand"]
    md = ["# Landmark review", "", "| id | kind | label | confidence | fixed | source |", "|---|---|---|---|---|---|"]
    md += [f"| {r['id']} | {r['kind']} | {r['label']} | {r['confidence']:.2f} | {r['fixed']} | {r.get('source') or '?'} |"
           for r in rows]
    md += ["", "Weak (below 0.6, AI chip shows the confidence): " + (", ".join(r["label"] for r in weak) or "none")]
    return ({"ok": True, "building_id": building_id, "landmarks": rows, "weak": [r["id"] for r in weak]},
            {"/annotations/landmark_review.md": "\n".join(md)})


def t_plan_route(ws: Workspace, building_id: str, from_id: str, to_id: str,
                 clearance_m: float = DEFAULT_CLEARANCE_M, drop_specks_m2: float = 0.0) -> tuple[dict, Files]:
    clearance_m = max(MIN_CLEARANCE_M, min(DEFAULT_CLEARANCE_M, float(clearance_m)))
    drop_specks_m2 = max(0.0, min(MAX_SPECK_M2, float(drop_specks_m2)))
    try:
        route = ws.engine.build_route(building_id, from_id, to_id, clearance_m, drop_specks_m2)
    except NoRoute as exc:
        rungs = []
        if clearance_m > MIN_CLEARANCE_M:
            rungs.append({"clearance_m": round(clearance_m - 0.05, 2), "drop_specks_m2": drop_specks_m2})
        if drop_specks_m2 < MAX_SPECK_M2:
            rungs.append({"clearance_m": clearance_m, "drop_specks_m2": MAX_SPECK_M2})
        return {"ok": False, "error": "no_route", "detail": str(exc), "next_options": rungs,
                "hint": "retry with one option, or tell the visitor no route was found"}, {}
    except KeyError as exc:
        return {"ok": False, "error": f"unknown id {exc}"}, {}
    rid = ws.new_id("r")
    route["relaxed"] = {"clearance_m": clearance_m, "drop_specks_m2": drop_specks_m2,
                        "is_relaxed": clearance_m < DEFAULT_CLEARANCE_M or drop_specks_m2 > 0}
    route["building_id"] = building_id
    ws.routes[rid] = route
    segs = route["segments"]
    payload = {"ok": True, "route_id": rid, "segments": len(segs),
               "score": round(route["score"]["total"], 1), "parts": route["score"]["parts"],
               "instructions": [s["instruction"] for s in segs], "relaxed": route["relaxed"]}
    return payload, {f"/rehearsal/route_{rid}.json": json.dumps(_public_route(route), indent=1)}


def _public_route(route: dict) -> dict:
    return {k: v for k, v in route.items() if k != "path"}


def t_simulate_route(ws: Workspace, route_id: str, runs: int = 100) -> tuple[dict, Files]:
    if route_id not in ws.routes:
        return {"ok": False, "error": f"unknown route {route_id}"}, {}
    runs = max(50, min(300, int(runs)))
    route = ws.routes[route_id]
    sim = ws.engine.simulate(route["building_id"], route, runs)
    ws.sims[route_id] = sim
    return {"ok": True, "route_id": route_id, **sim}, {}


def t_get_errors(ws: Workspace, run_log_id: str, route_id: str) -> tuple[dict, Files]:
    if run_log_id not in ws.run_logs or route_id not in ws.routes:
        return {"ok": False, "error": "unknown run_log_id or route_id"}, {}
    log = ws.run_logs[run_log_id]
    segs = ws.routes[route_id]["segments"]
    tallies = ws.engine.tally(log, len(segs))
    per_seg = []
    for i, s in enumerate(segs):
        kinds = [e["kind"] for e in log.get("events", []) if e.get("seg") == i and e["kind"] in ("off_route", "hesitate", "hint", "bump")]
        wrong = [q["q"] for q in log.get("quiz", []) if q.get("seg") == i and not q.get("correct")]
        per_seg.append({"segment": i, "tally": tallies[i], "events": kinds, "wrong_quiz": wrong,
                        "instruction": s["instruction"]})
    return {"ok": True, "max_tally": max(tallies) if tallies else 0, "segments": per_seg}, {}


DRILLS = ("repeat", "approach", "slow")


def t_set_plan(ws: Workspace, run_log_id: str, route_id: str, focus_segment: int,
               drill: str, line: str) -> tuple[dict, Files]:
    if route_id not in ws.routes or run_log_id not in ws.run_logs:
        return {"ok": False, "error": "unknown run_log_id or route_id"}, {}
    n = len(ws.routes[route_id]["segments"])
    tallies = ws.engine.tally(ws.run_logs[run_log_id], n)
    best = max(range(n), key=lambda i: (tallies[i], -i)) if tallies and max(tallies) > 0 else -1
    notes = []
    if not (-1 <= focus_segment < n):
        return {"ok": False, "error": f"focus_segment must be -1..{n - 1}"}, {}
    if focus_segment != best and (focus_segment == -1 or tallies[focus_segment] < tallies[best]):
        notes.append(f"overridden: segment {focus_segment} is not a maximum tally, using {best}")
        focus_segment = best
    if drill not in DRILLS:
        notes.append(f"unknown drill {drill!r}, using repeat")
        drill = "repeat"
    plan = ws.engine.make_plan(focus_segment, drill)
    pid = ws.new_id("p")
    ws.plans[pid] = {"route_id": route_id, "focus_segment": focus_segment, "drill": drill, "plan": plan}
    focus_scope = ws.routes[route_id]["segments"][focus_segment] if focus_segment >= 0 else []
    if not line or not grounded(line, ws, focus_scope) or len(line) > 160:
        notes.append("coach line replaced by template (empty, too long, or contained an unknown number)")
        line = _template_line(ws.routes[route_id], focus_segment)
    ws.plans[pid]["line"] = line
    rehearsal_plan = {"plan_id": pid, "route_id": route_id, "focus_segment": focus_segment,
                      "drill": drill, "run_plan": plan, "line": line}
    return ({"ok": True, "plan_id": pid, "focus_segment": focus_segment, "drill": drill,
             "line": line, "notes": notes},
            {"/rehearsal/rehearsal_plan.json": json.dumps(rehearsal_plan, indent=1)})


def _template_line(route: dict, focus: int) -> str:
    if focus < 0:
        return "That run was clean. Let's do the full route once more."
    seg = route["segments"][focus]
    turn = seg.get("turn_after", "none")
    return (f"Let's practise the {turn} turn at the end of that stretch again." if turn != "none"
            else "Let's practise that stretch again, counting steps out loud.")


def t_layout_candidates(ws: Workspace, building_id: str, desk_id: str, n: int = 5) -> tuple[dict, Files]:
    n = max(2, min(8, int(n)))
    cur = _current_eval(ws, building_id, desk_id)
    cands = ws.engine.layout_candidates(building_id, desk_id, n)
    out = []
    for c in cands:
        cid = ws.new_id("c")
        ws.evals[cid] = {"kind": "candidate", "pos": c["pos"], "score": c["score"],
                         "arrival_rate": c["arrival_rate"], "building_id": building_id}
        out.append({"candidate_id": cid, "pos": c["pos"], "score": round(c["score"], 1),
                    "arrival_rate": round(c["arrival_rate"], 2)})
    return {"ok": True, "current": _brief(cur), "candidates": out}, {}


def _current_eval(ws: Workspace, building_id: str, desk_id: str) -> dict:
    key = f"current:{building_id}:{desk_id}"
    if key not in ws.evals:
        pkg = ws.buildings.get(building_id) or ws.engine.package(building_id)
        ws.buildings[building_id] = pkg
        desk = next(l["pos"] for l in pkg["landmarks"] if l["id"] == desk_id)
        ev = ws.engine.evaluate_layout(building_id, desk, [])
        ws.evals[key] = {"kind": "current", "eval_id": key, "pos": desk, "fixes": [], **ev}
    return ws.evals[key]


def _brief(ev: dict) -> dict:
    return {k: (round(ev[k], 2) if isinstance(ev.get(k), float) else ev.get(k))
            for k in ("eval_id", "pos", "score", "arrival_rate", "open_m", "turns") if k in ev}


def t_evaluate_layout(ws: Workspace, building_id: str, candidate_id: str,
                      fixes: list[dict] | None = None) -> tuple[dict, Files]:
    if candidate_id not in ws.evals:
        return {"ok": False, "error": f"unknown candidate {candidate_id}"}, {}
    real_fixes = []
    for f in fixes or []:
        if f.get("kind") not in ("tactile_strip", "seating_edge"):
            return {"ok": False, "error": f"fix kind must be tactile_strip or seating_edge, got {f.get('kind')}"}, {}
        try:
            real_fixes.append(ws.engine.fix_between(building_id, f["kind"], f["from_id"], f["to_id"]))
        except KeyError as exc:
            return {"ok": False, "error": str(exc)}, {}
    pos = ws.evals[candidate_id]["pos"]
    ev = ws.engine.evaluate_layout(building_id, pos, real_fixes)
    eid = ws.new_id("e")
    ws.evals[eid] = {"kind": "eval", "eval_id": eid, "candidate_id": candidate_id, "pos": pos,
                     "fixes": real_fixes, "building_id": building_id, **ev}
    try:
        route = ev["route"]
        sim = ws.engine.simulate(building_id, route, 100)
        ws.evals[eid]["hotspots"] = sim.get("hotspots", [])
    except Exception:
        ws.evals[eid]["hotspots"] = []
    return {"ok": True, **_brief(ws.evals[eid]), "hotspots": ws.evals[eid]["hotspots"]}, {}


def t_record_round(ws: Workspace, eval_id: str, proposal: str, critique: str) -> tuple[dict, Files]:
    if eval_id not in ws.evals:
        return {"ok": False, "error": f"unknown eval {eval_id}"}, {}
    if not grounded(proposal + " " + critique, ws):
        critique = "(critique removed: it contained a number not produced by the simulator)"
    ws.rounds.append({"eval_id": eval_id, "proposal": proposal[:200], "critique": critique[:300]})
    return {"ok": True, "rounds": len(ws.rounds)}, {"/venue/layout_report.md": _layout_md(ws)}


def best_eval(ws: Workspace) -> dict | None:
    evs = [e for e in ws.evals.values() if e.get("kind") in ("eval", "current")]
    return max(evs, key=lambda e: (e["score"], e["arrival_rate"])) if evs else None


def _layout_md(ws: Workspace) -> str:
    cur = next((e for e in ws.evals.values() if e.get("kind") == "current"), None)
    best = best_eval(ws)
    lines = ["# Layout report", "", "Numbers from the simulator. Critiques from the agent.", "",
             "| | score | arrival rate | open m | turns |", "|---|---|---|---|---|"]
    for name, e in (("current", cur), ("best", best)):
        if e:
            lines.append(f"| {name} | {e['score']:.1f} | {e['arrival_rate']:.0%} | {e['open_m']:.1f} | {e['turns']} |")
    lines += ["", "## Rounds"]
    for i, r in enumerate(ws.rounds, 1):
        e = ws.evals[r["eval_id"]]
        lines.append(f"{i}. {r['proposal']} -> score {e['score']:.1f}, arrival {e['arrival_rate']:.0%}. {r['critique']}")
    return "\n".join(lines)


def t_finalize(ws: Workspace, kind: str, building_id: str | None, route_id: str | None = None,
               plan_id: str | None = None, message: str = "") -> tuple[dict, Files]:
    if kind not in ("rehearsal", "layout", "question", "unavailable"):
        return {"ok": False, "error": "kind must be rehearsal, layout, question or unavailable"}, {}
    if route_id and route_id not in ws.routes:
        return {"ok": False, "error": f"unknown route {route_id}"}, {}
    if not grounded(message, ws):
        message = "Here is your rehearsal." if kind == "rehearsal" else "Here is the layout report."
    ws.final = assemble_result(ws, kind, building_id, route_id, plan_id, message)
    return {"ok": True}, {}


def assemble_result(ws: Workspace, kind: str, building_id: str | None, route_id: str | None,
                    plan_id: str | None, message: str) -> dict:
    """The API response. Built by code from the workspace, never from model text."""
    out: dict[str, Any] = {"kind": kind, "building_id": building_id, "message": message}
    if route_id:
        r = ws.routes[route_id]
        out["route"] = r
        out["sim"] = ws.sims.get(route_id)
    if plan_id and plan_id in ws.plans:
        out["coach"] = ws.plans[plan_id]
    if kind == "layout":
        cur = next((e for e in ws.evals.values() if e.get("kind") == "current"), None)
        out["report"] = {"current": cur and _brief(cur), "best": (b := best_eval(ws)) and {**_brief(b), "fixes": b.get("fixes", [])},
                         "rounds": ws.rounds}
    if building_id and building_id in ws.buildings:
        out["uncertainty"] = t_inspect_building(ws, building_id)[0].get("uncertainty", [])
    return out


# ---------------------------------------------------------------------------
# LangChain tool wrappers. Each finds its workspace by thread id, emits trace events through
# the stream writer, and writes code generated files into the deep agent's virtual filesystem.
# ---------------------------------------------------------------------------
TOOL_OWNER: dict[str, str] = {}


def _ws(runtime: ToolRuntime) -> Workspace:
    return get_workspace(runtime.config["configurable"]["thread_id"])


def _emit(event: dict) -> None:
    try:
        get_stream_writer()(event)
    except Exception:
        pass  # not streaming (invoke) or outside a graph


def _reply(runtime: ToolRuntime, name: str, payload: dict, files: Files) -> Command:
    _emit({"type": "tool_result", "agent": TOOL_OWNER.get(name, "orchestrator"), "tool": name,
           "ok": payload.get("ok", True), "summary": _summary(payload),
           "files": sorted(files)})
    update: dict[str, Any] = {"messages": [ToolMessage(json.dumps(payload, default=str), tool_call_id=runtime.tool_call_id, name=name)]}
    if files:
        update["files"] = {p: create_file_data(c) for p, c in files.items()}
    return Command(update=update)


def _summary(p: dict) -> str:
    keys = ("error", "route_id", "score", "arrival_rate", "plan_id", "focus_segment", "eval_id", "building_id")
    return ", ".join(f"{k}={p[k]}" for k in keys if k in p)[:160]


@tool
def resolve_place(name: str, runtime: ToolRuntime) -> Command:
    """Find a building from a business, clinic or building name. Returns building_id, floor, suite and source (costar or directory)."""
    return _reply(runtime, "resolve_place", *t_resolve_place(_ws(runtime), name))


@tool
def inspect_building(building_id: str, runtime: ToolRuntime) -> Command:
    """Load a building package. Returns entrances, destinations with confidence, and what data is missing. Writes /building_dossier.md."""
    return _reply(runtime, "inspect_building", *t_inspect_building(_ws(runtime), building_id))


@tool
def review_landmarks(building_id: str, runtime: ToolRuntime) -> Command:
    """List the landmarks found in a building's panoramas with confidence, fixed or movable, and whether a human confirmed them. Writes /annotations/landmark_review.md."""
    return _reply(runtime, "review_landmarks", *t_review_landmarks(_ws(runtime), building_id))


@tool
def plan_route(building_id: str, from_id: str, to_id: str, runtime: ToolRuntime,
               clearance_m: float = DEFAULT_CLEARANCE_M, drop_specks_m2: float = 0.0) -> Command:
    """Plan a cane friendly route between an entrance id and a destination id. On no_route, returns next_options to retry with (smaller clearance_m or drop_specks_m2 to remove scan noise). Writes /rehearsal/route_<id>.json."""
    return _reply(runtime, "plan_route", *t_plan_route(_ws(runtime), building_id, from_id, to_id, clearance_m, drop_specks_m2))


@tool
def simulate_route(route_id: str, runtime: ToolRuntime, runs: int = 100) -> Command:
    """Send simulated cane travellers along a route. Returns arrival_rate and the segments where they get lost."""
    return _reply(runtime, "simulate_route", *t_simulate_route(_ws(runtime), route_id, runs))


@tool
def get_errors(run_log_id: str, route_id: str, runtime: ToolRuntime) -> Command:
    """Per segment error tallies from the visitor's last run and quiz, with the event kinds and wrong quiz questions."""
    return _reply(runtime, "get_errors", *t_get_errors(_ws(runtime), run_log_id, route_id))


@tool
def set_plan(run_log_id: str, route_id: str, focus_segment: int, drill: str, line: str,
             runtime: ToolRuntime) -> Command:
    """Rebuild the next run around one segment. drill: repeat (repeat the segment), approach (start two segments earlier), slow (slower speech, extra landmark cues). line: one encouraging sentence, no new numbers. Code rejects a focus that is not a maximum tally. Writes /rehearsal/rehearsal_plan.json."""
    return _reply(runtime, "set_plan", *t_set_plan(_ws(runtime), run_log_id, route_id, focus_segment, drill, line))


@tool
def layout_candidates(building_id: str, desk_id: str, runtime: ToolRuntime, n: int = 5) -> Command:
    """Score the current reception position and return the top n candidate desk positions, ranked by code."""
    return _reply(runtime, "layout_candidates", *t_layout_candidates(_ws(runtime), building_id, desk_id, n))


@tool
def evaluate_layout(building_id: str, candidate_id: str, runtime: ToolRuntime,
                    fixes: list[dict] | None = None) -> Command:
    """Simulate a candidate desk position with optional fixes. Each fix is {kind: tactile_strip|seating_edge, from_id, to_id} between two landmark or entrance ids. Returns score, arrival_rate and lost hotspots."""
    return _reply(runtime, "evaluate_layout", *t_evaluate_layout(_ws(runtime), building_id, candidate_id, fixes))


@tool
def record_round(eval_id: str, proposal: str, critique: str, runtime: ToolRuntime) -> Command:
    """Log one propose, simulate, critique round. Use words; numbers not produced by the simulator are removed. Writes /venue/layout_report.md."""
    return _reply(runtime, "record_round", *t_record_round(_ws(runtime), eval_id, proposal, critique))


@tool
def ask_visitor(question: str, option_ids: list[str], runtime: ToolRuntime) -> Command:
    """Ask the visitor ONE question when a choice is ambiguous (for example two desks match). option_ids must be destination or building ids you already saw. Pauses the run until they answer."""
    ws = _ws(runtime)
    labels = {}
    for b in ws.buildings.values():
        for l in b.get("landmarks", []):
            labels[l["id"]] = l["label"]
    options = [{"id": o, "label": labels.get(o, o)} for o in option_ids]
    # The API turns the interrupt into a "question" event; nothing is emitted here because the
    # tool body re-runs from the top when the graph resumes.
    answer = interrupt({"question": question, "options": options})
    ws.answers.append({"question": question, "answer": answer})
    valid = answer in option_ids
    return _reply(runtime, "ask_visitor", {"ok": valid, "answer": answer,
                  **({} if valid else {"error": "answer not among options"})}, {})


@tool
def finalize(kind: str, runtime: ToolRuntime, building_id: str | None = None, route_id: str | None = None,
             plan_id: str | None = None, message: str = "") -> Command:
    """Finish. kind: rehearsal, layout, question or unavailable. Pass the ids you produced. message: one or two plain sentences for the visitor or venue, stating any uncertainty."""
    return _reply(runtime, "finalize", *t_finalize(_ws(runtime), kind, building_id, route_id, plan_id, message))


# ---------------------------------------------------------------------------
# Agent definition
# ---------------------------------------------------------------------------
ORCHESTRATOR_PROMPT = """You are SecondVisit. Blind and low vision visitors rehearse a building by audio before a first visit; venues ask where reception should go.
You plan and delegate. You never invent a distance, step count, clock direction, score or rate: those come only from tools.
Start with write_todos (3 to 6 items). Then:
- Visitor request: delegate to site_investigator to find the building and destination, and to annotator when the dossier lists low confidence landmarks. If it reports AMBIGUOUS, call ask_visitor once with the option ids. Then delegate to route_planner. If a run_log_id is in the request, delegate to coach.
- Venue request: site_investigator, then layout_advisor.
- If data is missing, carry on with what exists and say what is missing (read /building_dossier.md).
Finish with finalize, passing the ids. Keep message to two short sentences without numbers. This is rehearsal, never a replacement for a cane, guide dog or mobility training."""

SUBAGENTS_SPEC = [
    {
        "name": "site_investigator",
        "description": "Finds the building for a name or address, loads its package, matches the visitor's words (for example 'reception', 'the eye clinic') to a destination id, and lists missing or uncertain data.",
        "system_prompt": """Find the building and the destination.
1. resolve_place with the name. If it fails, try the building name alone.
2. inspect_building on the building_id. This writes /building_dossier.md.
3. Match the visitor's words to destination ids by kind and label. If exactly one fits, report it. If two or more fit equally, start your answer with AMBIGUOUS and list the ids.
4. Append one or two sentences under 'Agent notes' in /building_dossier.md with edit_file about what is uncertain for THIS visitor.
Answer in at most 5 lines: building_id, entrance id, destination id (or AMBIGUOUS ids), missing data.""",
        "tools": [resolve_place, inspect_building],
    },
    {
        "name": "annotator",
        "description": "Reviews the landmarks the panorama annotator found for a building: which are weak (below 0.6 confidence), movable, or unconfirmed, and what a visitor should be told to treat as uncertain.",
        "system_prompt": """Review a building's landmarks for a rehearsal.
1. review_landmarks on the building_id. This writes /annotations/landmark_review.md.
2. Say which destinations are weak or movable, and which a person confirmed.
Answer in at most 3 lines. Never invent a landmark or a position; you only report what the tool returned.""",
        "tools": [review_landmarks],
    },
    {
        "name": "route_planner",
        "description": "Plans and stress tests the rehearsal route for a building_id, entrance id and destination id. Recovers from no_route, compares entrances, runs the simulated traveller.",
        "system_prompt": """Produce one rehearsal route.
1. plan_route. If ok is false with no_route, retry with ONE of next_options, at most twice. If a relaxed route is used, say the door may be narrow or the scan noisy.
2. If the building has more than one entrance, plan from each and keep the higher score.
3. simulate_route on the kept route. If arrival_rate is below 0.7, name the hotspot segments.
Answer in at most 4 lines: route_id, whether relaxed, the weakest segment index. Do not repeat numbers you were not given.""",
        "tools": [plan_route, simulate_route],
    },
    {
        "name": "coach",
        "description": "Reads the visitor's last run log and quiz for a route and rebuilds the next run around their weakest segment.",
        "system_prompt": """You coach a blind visitor between rehearsal runs.
1. get_errors. Find the segment with the highest tally.
2. Pick a drill from the error kinds: off_route or wrong turn answer -> approach; hesitate -> slow; wrong step or wall side answer, or bump -> repeat.
3. set_plan with that segment, drill and one warm sentence that names the landmark or turn, with no numbers.
4. Write /coach_notes.md: two lines, what went wrong and why you chose the drill.
Answer: plan_id and focus segment.""",
        "tools": [get_errors, set_plan],
    },
    {
        "name": "layout_advisor",
        "description": "For a venue: scores the current reception desk, tries better positions and fixes (tactile strip, seating edge) with the simulated traveller, and writes a layout report.",
        "system_prompt": """Find a reception position where simulated cane travellers get lost least.
1. layout_candidates for the building and current desk id.
2. Round 1: evaluate_layout the top candidate with no fixes. record_round with a proposal and a one sentence critique based on the hotspots.
3. Round 2 and 3: propose ONE fix aimed at the worst hotspot (a tactile_strip or seating_edge between two landmark ids near it), evaluate_layout, record_round. Stop early if a round does not improve.
4. Never more than 3 rounds. Answer with the best eval_id.""",
        "tools": [layout_candidates, evaluate_layout, record_round],
        "middleware_factory": lambda: [ToolCallLimitMiddleware(tool_name="evaluate_layout", run_limit=MAX_LAYOUT_EVALS)],
    },
]

for _s in SUBAGENTS_SPEC:
    for _t in _s["tools"]:
        TOOL_OWNER[_t.name] = _s["name"]


def model_from_env(var: str, fallback_var: str | None = None, *, timeout: float = 25.0, max_tokens: int = 1024):
    """Return a chat model for deepagents. DR_MODEL may be a bare Anthropic id (as llm.py uses)
    or a 'provider:model' string. Anthropic models are built as ChatAnthropic so timeout and
    retries are bounded for a live demo."""
    m = os.environ.get(var) or (os.environ.get(fallback_var) if fallback_var else None)
    if not m:
        raise RuntimeError(f"{var} is not set")
    if ":" not in m:
        m = f"anthropic:{m}"
    provider, name = m.split(":", 1)
    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(model=name, timeout=timeout, max_retries=1, max_tokens=max_tokens)
    return m


def _harness_for(model) -> None:
    """Drop the shell tool and the auto added general-purpose subagent for this model's provider,
    so the orchestrator can only delegate to our four specialists."""
    from deepagents._models import get_model_provider, resolve_model
    try:
        provider = get_model_provider(resolve_model(model))
    except Exception:
        provider = None
    if provider:
        register_harness_profile(provider, HarnessProfile(
            excluded_tools=frozenset({"execute", "glob", "grep"}),
            general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=False)))


def build_agent(model=None, sub_model=None, checkpointer=None):
    """Create the SecondVisit deep agent. model and sub_model may be chat model instances
    (tests pass fakes), sub_model may be a dict of subagent name to model, or None to read
    DR_MODEL and DR_FAST_MODEL."""
    model = model if model is not None else model_from_env("DR_MODEL")
    sub_model = sub_model if sub_model is not None else (
        model_from_env("DR_FAST_MODEL", "DR_MODEL", timeout=20, max_tokens=700)
        if (os.environ.get("DR_FAST_MODEL") or os.environ.get("DR_MODEL")) else model)
    _harness_for(model)
    subagents = []
    for s in SUBAGENTS_SPEC:
        spec = {k: v for k, v in s.items() if k != "middleware_factory"}
        spec["model"] = sub_model[s["name"]] if isinstance(sub_model, dict) else sub_model
        if "middleware_factory" in s:
            spec["middleware"] = s["middleware_factory"]()
        subagents.append(spec)
    return create_deep_agent(
        model=model,
        tools=[ask_visitor, finalize],
        system_prompt=ORCHESTRATOR_PROMPT,
        subagents=subagents,
        middleware=[TodoListMiddleware(), ModelCallLimitMiddleware(run_limit=14, exit_behavior="end")],
        checkpointer=checkpointer if checkpointer is not None else InMemorySaver(),
        name="secondvisit",
    )


def initial_input(ws: Workspace, text: str, run_log: dict | None = None,
                  route_id: str | None = None) -> dict:
    """First message plus input files the agent can read with read_file."""
    files = {}
    parts = [text]
    if run_log is not None:
        lid = ws.new_id("L")
        ws.run_logs[lid] = run_log
        files["/input/run_log.json"] = create_file_data(json.dumps(run_log, indent=1))
        parts.append(f"run_log_id: {lid}")
    if route_id:
        parts.append(f"route_id: {route_id}")
    return {"messages": [{"role": "user", "content": "\n".join(parts)}], "files": files}


# ---------------------------------------------------------------------------
# Scripted fallback: same tools, fixed order, no model. Used when the API is down or slow.
# ---------------------------------------------------------------------------
def run_scripted(ws: Workspace, text: str, emit: Callable[[dict], None], building_hint: str | None = None,
                 run_log_id: str | None = None, route_id: str | None = None) -> dict:
    def call(agent: str, fn, *args):
        name = fn.__name__[2:]
        emit({"type": "tool_call", "agent": agent, "tool": name, "args": [a for a in args if isinstance(a, (str, int, float))]})
        payload, files = fn(ws, *args)
        emit({"type": "tool_result", "agent": agent, "tool": name, "ok": payload.get("ok", True),
              "summary": _summary(payload), "files": sorted(files)})
        return payload

    venue = bool(re.search(r"\b(reception|layout|where should|venue|our)\b", text, re.I)) and "appointment" not in text.lower()
    bid = building_hint
    if not bid:
        r = call("site_investigator", t_resolve_place, text)
        bid = r.get("building_id") if r.get("ok") else None
    if not bid:
        ws.final = assemble_result(ws, "unavailable", None, None, None, "I could not find that building.")
        return ws.final
    info = call("site_investigator", t_inspect_building, bid)
    if not info.get("ok"):
        ws.final = assemble_result(ws, "unavailable", bid, None, None, "No map is available for that building yet.")
        return ws.final
    desks = [d for d in info["destinations"] if d["kind"] == "desk"] or info["destinations"]
    if venue:
        c = call("layout_advisor", t_layout_candidates, bid, desks[0]["id"], 3)
        for cand in c.get("candidates", [])[:2]:
            e = call("layout_advisor", t_evaluate_layout, bid, cand["candidate_id"], [])
            if e.get("ok"):
                t_record_round(ws, e["eval_id"], f"Move desk to {cand['candidate_id']}", "Scripted round, no critique.")
        ws.final = assemble_result(ws, "layout", bid, None, None, "Layout report (scripted fallback, agent offline).")
        return ws.final
    if route_id is None:
        ent = info["entrances"][0]["id"]
        p = call("route_planner", t_plan_route, bid, ent, desks[0]["id"])
        for rung in p.get("next_options", [])[:2]:
            if p.get("ok"):
                break
            p = call("route_planner", t_plan_route, bid, ent, desks[0]["id"], rung["clearance_m"], rung["drop_specks_m2"])
        if not p.get("ok"):
            ws.final = assemble_result(ws, "unavailable", bid, None, None, "No route found.")
            return ws.final
        route_id = p["route_id"]
        call("route_planner", t_simulate_route, route_id, 100)
    plan_id = None
    if run_log_id:
        errs = call("coach", t_get_errors, run_log_id, route_id)
        focus = max(errs["segments"], key=lambda s: (s["tally"], -s["segment"]))["segment"] if errs.get("max_tally") else -1
        sp = call("coach", t_set_plan, run_log_id, route_id, focus, "repeat", "")
        plan_id = sp.get("plan_id")
    ws.final = assemble_result(ws, "rehearsal", bid, route_id, plan_id, "Here is your rehearsal (scripted fallback).")
    return ws.final


if __name__ == "__main__":  # manual smoke run: python -m dr.agents.deep_agent "appointment at ..."
    import sys
    tid = str(uuid.uuid4())
    ws = open_workspace(tid, DrEngine())
    agent = build_agent()
    cfg = {"configurable": {"thread_id": tid}}
    for chunk in agent.stream(initial_input(ws, " ".join(sys.argv[1:]) or "appointment at JRR front desk"),
                              cfg, stream_mode=["updates", "custom"], subgraphs=True, version="v2"):
        if chunk["type"] == "custom":
            print(chunk["data"])
    print(json.dumps(ws.final, indent=1, default=str)[:3000])
