"""Route score (Task 5). Returns {"total": float, "parts": {...}}."""
from __future__ import annotations

import math

import numpy as np

from dr.grid import OccGrid
from dr.package import Landmark, Segment

HAZARD_M = 0.6


def _free_dirs(grid: OccGrid, p, reach: float = 2.0) -> int:
    """Openings (runs of free rays) among 8 rays of 2 m."""
    free = []
    for k in range(8):
        h = math.radians(45 * k)
        ok = True
        for r in np.arange(0.2, reach + 1e-6, 0.2):
            rr, cc = grid.world_to_cell((p[0] + r * math.sin(h), p[1] + r * math.cos(h)))
            if not (0 <= rr < grid.cells.shape[0] and 0 <= cc < grid.cells.shape[1]) or grid.cells[rr, cc] != 0:
                ok = False
                break
        free.append(ok)
    if all(free):
        return 1
    return sum(1 for k in range(8) if free[k] and not free[k - 1])


def _near_hazard(grid: OccGrid, a, b) -> bool:
    rows, cols = np.nonzero(grid.cells == 5)
    if len(rows) == 0:
        return False
    pts = [grid.cell_to_world((int(r), int(c))) for r, c in zip(rows, cols)]
    from dr.segments import _pt_seg
    return any(_pt_seg(p, a, b) <= HAZARD_M for p in pts)


def score_route(segments: list[Segment], grid: OccGrid, landmarks: list[Landmark]) -> dict:
    L = sum(s.length_m for s in segments)
    if not segments or L <= 0:
        return {"total": 0.0, "parts": dict(length_m=0.0, wall_share=0.0, open_m=0.0, turns=0.0,
                                            decisions=0.0, hazards=0.0, landmarks_per_10m=0.0)}
    wall_share = sum(s.length_m for s in segments if s.wall_side != "none") / L
    open_m = sum(s.open_m for s in segments)
    turns = float(len(segments) - 1)
    decisions = float(sum(1 for s in segments[:-1] if _free_dirs(grid, s.end) >= 3))
    hazards = float(sum(1 for s in segments if _near_hazard(grid, s.start, s.end)))
    lm = len({i for s in segments for i in s.landmarks_passed})
    lp10 = lm / L * 10.0
    total = 100 * (0.35 * wall_share + 0.20 * (1 - min(open_m / 20, 1)) + 0.15 * (1 - min(turns / 10, 1))
                   + 0.10 * (1 - min(decisions / 8, 1)) + 0.10 * (1 - min(hazards / 3, 1))
                   + 0.10 * min(lp10 / 2, 1))
    parts = dict(length_m=round(L, 2), wall_share=wall_share, open_m=open_m, turns=turns,
                 decisions=decisions, hazards=hazards, landmarks_per_10m=lp10)
    return {"total": float(total), "parts": parts}
