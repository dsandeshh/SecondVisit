"""Layout advisor engine (Task 12): desk candidates, evaluation and a deterministic advise().

Geometry decides, models describe: every number here comes from code. The model loop (Task 13) calls
these functions as tools and may only add words, which must pass dr.grounding.grounded (R7).
segment/score/simulate are injectable (stream B's Task 5 and 11); when those modules are absent a
labelled stub is used and arrival rates read "simulated (stub)".
"""
from __future__ import annotations

import math
from typing import Callable, Literal, TypedDict

import numpy as np
from scipy.ndimage import distance_transform_edt

from dr.config import WALL_TRAIL_M
from dr.grid import OccGrid, Vec2
from dr.package import BuildingPackage, Entrance, Landmark, Route, Score, ScoreParts, SimResult
from dr.planner import NoRouteError, Weights, _cell_factor, _search, approach_point, plan_with_ladder

WALL_NEAR_M = 0.8
DOOR_CLEAR_M = 1.2
FRONT_CLEAR_M = 1.5
MIN_WALL_M = 0.3
SPACING_M = 1.0
RUNS = 100


class Fix(TypedDict):
    kind: Literal["tactile_strip", "seating_edge"]
    path: list[Vec2]


def fix_between(a: Vec2, b: Vec2, kind: Literal["tactile_strip", "seating_edge"]) -> Fix:
    """Polyline between two points (code converts landmark or wall ids to points)."""
    return {"kind": kind, "path": [tuple(a), tuple(b)]}


def _line_cells(grid: OccGrid, path: list[Vec2]) -> list[tuple[int, int]]:
    h, w = grid.cells.shape
    out = []
    for a, b in zip(path, path[1:]):
        n = max(1, int(math.dist(a, b) / (grid.res / 2)))
        for i in range(n + 1):
            t = i / n
            r, c = grid.world_to_cell((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
            if 0 <= r < h and 0 <= c < w:
                out.append((r, c))
    return out


def apply_fixes(grid: OccGrid, fixes: list[Fix]) -> tuple[OccGrid, np.ndarray]:
    """(grid with seating edges as code 3, boolean mask of tactile strip cells)."""
    cells = grid.cells.copy()
    strip = np.zeros(cells.shape, bool)
    for f in fixes:
        for r, c in _line_cells(grid, f["path"]):
            if f["kind"] == "seating_edge":
                if cells[r, c] == 0:
                    cells[r, c] = 3
            else:
                strip[r, c] = True
    return OccGrid(cells, grid.res, grid.origin), strip


def candidates(grid: OccGrid, entrances: list[Entrance], n: int = 40) -> list[Vec2]:
    """Free cells with a wall within 0.8 m, >= 1.2 m from any door, >= 1.5 m clear in front (the
    direction away from the nearest wall). Greedy 1 m spacing, row-major order, so deterministic."""
    cells = grid.cells
    h, w = cells.shape
    solid = np.isin(cells, (1, 2, 4))
    wd = grid.wall_distance()
    _, (ir, ic) = distance_transform_edt(~solid, return_indices=True)
    out: list[Vec2] = []
    for r, c in zip(*np.nonzero((cells == 0) & (wd <= WALL_NEAR_M) & (wd >= MIN_WALL_M))):
        p = grid.cell_to_world((int(r), int(c)))
        if any(math.dist(p, e.pos) < DOOR_CLEAR_M for e in entrances):
            continue
        dy, dx = r - ir[r, c], c - ic[r, c]
        nrm = math.hypot(dx, dy)
        if nrm == 0:
            continue
        ux, uy = dx / nrm, dy / nrm
        ok = True
        for k in range(1, int(FRONT_CLEAR_M / grid.res) + 1):
            rr, cc = int(round(r + uy * k)), int(round(c + ux * k))
            if not (0 <= rr < h and 0 <= cc < w) or cells[rr, cc] != 0:
                ok = False
                break
        if not ok or any(math.dist(p, q) < SPACING_M for q in out):
            continue
        out.append(p)
    if len(out) > n:  # thin evenly rather than keep only the first rows
        out = [out[int(i * len(out) / n)] for i in range(n)]
    return out


# ---- stubs used only when stream B's modules have not landed -------------------------------------

def _stub_score(path: list[Vec2], grid: OccGrid) -> Score:
    wd = grid.wall_distance()
    near = open_m = 0.0
    total_len = 0.0
    for a, b in zip(path, path[1:]):
        d = math.dist(a, b)
        total_len += d
        if wd[grid.world_to_cell(b)] <= WALL_TRAIL_M + 0.1:
            near += d
        else:
            open_m += d
    heads = [math.atan2(b[0] - a[0], b[1] - a[1]) for a, b in zip(path, path[1:]) if a != b]
    turns = sum(1 for x, y in zip(heads, heads[1:]) if abs(math.degrees(y - x)) % 360 > 25)
    share = near / total_len if total_len else 1.0
    total = 100 * (0.35 * share + 0.20 * (1 - min(open_m / 20, 1)) + 0.15 * (1 - min(turns / 10, 1))
                   + 0.30)
    return Score(total=total, parts=ScoreParts(length_m=total_len, wall_share=share, open_m=open_m,
                                               turns=turns, decisions=0, hazards=0,
                                               landmarks_per_10m=0))


def _stub_sim(grid: OccGrid, route: Route, runs: int = RUNS, seed: int = 0) -> SimResult:
    p = route.score.parts
    rate = max(0.0, min(1.0, 1 - 0.02 * p.open_m - 0.02 * p.turns))
    return SimResult(runs=runs, arrival_rate=rate, lost_cells_b64="")


def _defaults():
    try:
        from dr.score import score_route
        from dr.segments import segment
        seg_fn = segment
        score_fn = score_route
    except ImportError:
        seg_fn = score_fn = None
    try:
        from dr.simulate import simulate
        sim_fn, label = simulate, "simulated"
    except ImportError:
        sim_fn, label = _stub_sim, "simulated (stub)"
    return seg_fn, score_fn, sim_fn, label


def _plan(grid: OccGrid, strip: np.ndarray, start: Vec2, goal: Vec2, lms: list[Landmark]) -> list[Vec2]:
    if strip.any():
        w = Weights()
        f = _cell_factor(grid, lms, w)
        # a tactile strip is a trailable edge: treat its cells as open = 0, no hazard
        f[strip] = np.maximum(0.2, 1 - w.landmark_bonus)
        try:
            return _search(grid, start, goal, f, w.clearance_m, w.turn_per_45)
        except NoRouteError:
            pass
    return plan_with_ladder(grid, start, goal, lms).path


def evaluate(grid: OccGrid, entrances: list[Entrance], desk: Vec2, fixes: list[Fix] | None = None,
             *, landmarks: list[Landmark] | None = None, segment_fn=None, score_fn=None,
             sim_fn: Callable | None = None, runs: int = RUNS) -> dict:
    """Plan from every entrance to the desk, score and simulate; scores and rates are means.
    Returns {score, arrival_rate, arrival_label, desk, route (the first entrance's Route),
    routes, open_m, turns}. A route that cannot be planned counts as score 0, arrival 0."""
    d_seg, d_score, d_sim, label = _defaults()
    write = segment_fn is None and d_seg is not None   # default segmenter: write instructions like pipeline
    segment_fn, score_fn, sim_fn = segment_fn or d_seg, score_fn or d_score, sim_fn or d_sim
    if sim_fn is not d_sim:
        label = "simulated"
    g, strip = apply_fixes(grid, fixes or [])
    lms = [*(landmarks or []), Landmark(id="desk", kind="desk", label="Desk", pos=desk,
                                        confidence=1.0, fixed=False)]
    goal = approach_point(g, desk)
    scores, rates, routes = [], [], []
    for e in entrances:
        try:
            path = _plan(g, strip, e.pos, goal, lms)
        except NoRouteError:
            scores.append(0.0)
            rates.append(0.0)
            continue
        if segment_fn and score_fn:
            segs = segment_fn(path, g, lms)
            if write:  # the simulator's count error depends on "N steps" in the text, as in the CLI build
                from dr import instructions
                segs = instructions.write(segs, lms, entrances, dest="desk")
            sc = score_fn(segs, g, lms)
            score = Score(total=sc["total"], parts=ScoreParts(**sc["parts"]))
        else:
            segs, score = [], _stub_score(path, g)
        route = Route(id=f"{e.id}_to_desk", **{"from": e.id}, to="desk", path=path, segments=segs,
                      score=score)
        routes.append(route)
        scores.append(score.total)
        rates.append(sim_fn(g, route, runs=runs, seed=0).arrival_rate)
    n = max(len(entrances), 1)
    return {"score": sum(scores) / n, "arrival_rate": sum(rates) / n, "arrival_label": label,
            "desk": desk, "route": routes[0] if routes else None, "routes": routes,
            "open_m": float(np.mean([r.score.parts.open_m for r in routes])) if routes else 0.0,
            "turns": float(np.mean([r.score.parts.turns for r in routes])) if routes else 0.0}


def _key(ev: dict) -> tuple[float, float]:
    return (ev["score"], ev["arrival_rate"])


def advise(pkg: BuildingPackage, current_desk_id: str, top: int = 3, **kw) -> dict:
    """Deterministic fallback: evaluate the current desk and the top candidates (no fixes).
    Report = {current, best, best_pos, fixes: [], rounds: [{proposal, result, critique}]}."""
    g = OccGrid.from_b64(pkg.grid.cells_b64, pkg.grid.width, pkg.grid.height, pkg.grid.res,
                         pkg.grid.origin)
    desk = next(l for l in pkg.landmarks if l.id == current_desk_id)
    others = [l for l in pkg.landmarks if l.id != current_desk_id]
    ents = pkg.entrances
    cur = evaluate(g, ents, desk.pos, [], landmarks=others, **kw)
    pool = [p for p in candidates(g, ents) if math.dist(p, desk.pos) > 0.5]
    pool.sort(key=lambda p: sum(math.dist(p, e.pos) for e in ents))  # cheap code ranking: near doors
    best, rounds = cur, []
    for p in pool[:top]:
        ev = evaluate(g, ents, p, [], landmarks=others, **kw)
        rounds.append({"proposal": {"desk": p, "fixes": []}, "result": ev, "critique": ""})
        if _key(ev) > _key(best):
            best = ev
    return {"current": cur, "best": best, "best_pos": best["desk"], "fixes": [], "rounds": rounds}
