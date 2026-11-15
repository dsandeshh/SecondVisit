"""Turn a planned path into walkable Segments (Task 5)."""
from __future__ import annotations

import math

import numpy as np

from dr.config import STEP_M, WALL_TRAIL_M
from dr.grid import OccGrid, Vec2
from dr.package import Landmark, Segment

DP_TOL_M = 0.3
MERGE_DEG = 25.0
LANDMARK_M = 1.5
WALL_SHARE_MIN = 0.6
_WALL_CODES = (1, 2, 4)  # R17: never trail along movable furniture (3)


def heading(a: Vec2, b: Vec2) -> float:
    """0 = +y, clockwise, [0, 360)."""
    return math.degrees(math.atan2(b[0] - a[0], b[1] - a[1])) % 360.0


def _wrap180(d: float) -> float:
    return (d + 180.0) % 360.0 - 180.0


def _pt_seg(p: Vec2, a: Vec2, b: Vec2) -> float:
    ax, ay, bx, by = a[0], a[1], b[0], b[1]
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2))
    return math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy))


def douglas_peucker(pts: list[Vec2], tol: float) -> list[Vec2]:
    if len(pts) < 3:
        return list(pts)
    d = [_pt_seg(p, pts[0], pts[-1]) for p in pts[1:-1]]
    i = int(np.argmax(d))
    if d[i] <= tol:
        return [pts[0], pts[-1]]
    i += 1
    return douglas_peucker(pts[:i + 1], tol)[:-1] + douglas_peucker(pts[i:], tol)


def _merge_shallow(pts: list[Vec2]) -> list[Vec2]:
    pts = list(pts)
    changed = True
    while changed and len(pts) > 2:
        changed = False
        turns = [abs(_wrap180(heading(pts[i], pts[i + 1]) - heading(pts[i - 1], pts[i])))
                 for i in range(1, len(pts) - 1)]
        i = int(np.argmin(turns))
        if turns[i] < MERGE_DEG:
            del pts[i + 1]
            changed = True
    return pts


def _cell(grid: OccGrid, p: Vec2) -> int | None:
    r, c = grid.world_to_cell(p)
    if 0 <= r < grid.cells.shape[0] and 0 <= c < grid.cells.shape[1]:
        return int(grid.cells[r, c])
    return None


def _samples(a: Vec2, b: Vec2, step: float = 0.1) -> list[Vec2]:
    L = math.dist(a, b)
    n = max(1, int(math.ceil(L / step)))
    return [(a[0] + (b[0] - a[0]) * (i + 0.5) / n, a[1] + (b[1] - a[1]) * (i + 0.5) / n) for i in range(n)]


def _wall_side(grid: OccGrid, a: Vec2, b: Vec2, wd: np.ndarray) -> str:
    h = math.radians(heading(a, b))
    fwd = (math.sin(h), math.cos(h))
    right = (fwd[1], -fwd[0])
    reach = WALL_TRAIL_M + 0.1
    near = lt = rt = 0
    ss = _samples(a, b)
    for p in ss:
        r, c = grid.world_to_cell(p)
        inside = 0 <= r < wd.shape[0] and 0 <= c < wd.shape[1]
        if not (inside and wd[r, c] <= reach):
            continue
        near += 1
        for side, sgn in (("l", -1), ("r", 1)):
            hit = any(_cell(grid, (p[0] + sgn * right[0] * o, p[1] + sgn * right[1] * o)) in _WALL_CODES
                      for o in np.arange(0.1, reach + 1e-6, 0.1))
            if hit:
                if side == "l":
                    lt += 1
                else:
                    rt += 1
    if near / len(ss) < WALL_SHARE_MIN or max(lt, rt) == 0:
        return "none"
    return "left" if lt > rt else "right"


def segment(path: list[Vec2], grid: OccGrid, landmarks: list[Landmark]) -> list[Segment]:
    pts = [tuple(map(float, p)) for p in path]
    dedup = [pts[0]] if pts else []
    for p in pts[1:]:
        if math.dist(p, dedup[-1]) > 1e-9:
            dedup.append(p)
    if len(dedup) < 2:
        return []
    pts = _merge_shallow(douglas_peucker(dedup, DP_TOL_M))
    wd = grid.wall_distance()
    open_thr = WALL_TRAIL_M + 1.5 * 0.5  # same "open" cut as the planner (cost ramp midpoint)
    segs: list[Segment] = []
    for i, (a, b) in enumerate(zip(pts, pts[1:])):
        L = math.dist(a, b)
        ss = _samples(a, b)
        d = [wd[min(max(grid.world_to_cell(p)[0], 0), wd.shape[0] - 1),
                min(max(grid.world_to_cell(p)[1], 0), wd.shape[1] - 1)] for p in ss]
        open_m = L * sum(1 for x in d if x > open_thr) / len(ss)
        passed = [lm.id for lm in landmarks if _pt_seg(lm.pos, a, b) <= LANDMARK_M]
        if i + 1 < len(pts) - 1:
            td = _wrap180(heading(pts[i + 1], pts[i + 2]) - heading(a, b))
        else:
            td = 0.0
        segs.append(Segment(
            id=f"s{i + 1}", start=a, end=b, heading_deg=round(heading(a, b), 1), length_m=round(L, 2),
            steps=max(1, round(L / STEP_M)), wall_side=_wall_side(grid, a, b, wd),
            open_m=round(open_m, 2), landmarks_passed=passed,
            turn_after="none" if td == 0.0 and i + 1 >= len(pts) - 1 else ("right" if td > 0 else "left"),
            turn_deg=round(td, 1), instruction=""))
    return segs
