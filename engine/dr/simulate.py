"""Simulated traveller (Task 11): Monte Carlo agents that follow the spoken route with human sized
errors. Every number it returns is simulated, not measured; the UI labels it so (hard rule 8).

Each agent walks each segment: a heading bias per segment, noise per step, a step count that is
miscounted by a fraction (larger when the instruction gives no step number), a cane that corrects
toward a 0.5 m wall offset within CANE_M of the stated wall side, and a bump that stops forward motion
for that step. At a segment end it turns by turn_deg plus noise. Lost = more than 3.0 m from the path.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass

import numpy as np

from dr.config import ARRIVE_M, CANE_M, STEP_M
from dr.grid import OccGrid, Vec2
from dr.package import BuildingPackage, Route, SimResult

LOST_M = 3.0
WALL_OFFSET_M = 0.5
_HAS_STEPS = re.compile(r"\b\d+\s+steps?\b", re.I)


@dataclass(frozen=True)
class ErrorModel:
    step_sd: float = 0.08
    heading_bias_sd: float = 6.0
    heading_noise_sd: float = 3.0
    count_sd_frac: float = 0.12
    vague_count_sd_frac: float = 0.35


def _dist_to_path(p: Vec2, path: list[Vec2]) -> float:
    best = math.inf
    for a, b in zip(path, path[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 == 0 else min(1.0, max(0.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
        best = min(best, math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy))
    return best


_SLIDE_CODES = (1, 2, 4)  # walls, fixed furniture, glass: a cane trails along these; code 5 never


def _blocked(grid: OccGrid, x: float, y: float) -> int | None:
    """None when free, else the cell code (-1 outside the grid)."""
    h, w = grid.cells.shape
    if not (0 <= (y - grid.origin[1]) / grid.res < h and 0 <= (x - grid.origin[0]) / grid.res < w):
        return -1
    r, c = grid.world_to_cell((x, y))
    v = int(grid.cells[r, c])
    return v or None


def slide_step(grid: OccGrid, pos: Vec2, step: float, heading_deg: float, target: Vec2) -> Vec2 | None:
    """A blocked step turns into a lateral deflection (+-45 then +-90 degrees, this step only), the way a cane
    user trails a wall. Keeps the free deflection that gets closest to `target`, and only if it makes progress.
    None when nothing helps (a bump stays a bump). Behaviour only: no error model constant is used."""
    here = math.dist(pos, target)
    for off in (45.0, 90.0):
        best = None
        for sgn in (1.0, -1.0):
            hd = math.radians(heading_deg + sgn * off)
            nx, ny = pos[0] + step * math.sin(hd), pos[1] + step * math.cos(hd)
            if _blocked(grid, nx, ny) is None:
                d = math.dist((nx, ny), target)
                if d < here and (best is None or d < best[0]):
                    best = (d, (nx, ny))
        if best:
            return best[1]
    return None


def simulate(grid: OccGrid, route: Route, runs: int = 300, seed: int = 0,
             err: ErrorModel = ErrorModel()) -> SimResult:
    rng = np.random.default_rng(seed)
    h, w = grid.cells.shape
    wd = grid.wall_distance()
    path = [tuple(p) for p in route.path]
    goal = path[-1]
    lost = np.zeros((h, w), dtype=np.uint16)
    arrived = 0
    for _ in range(runs):
        x, y = route.segments[0].start if route.segments else path[0]
        heading = route.segments[0].heading_deg + rng.normal(0, err.heading_noise_sd) \
            if route.segments else 0.0
        is_lost = False
        for seg in route.segments:
            sd = err.count_sd_frac if _HAS_STEPS.search(seg.instruction) else err.vague_count_sd_frac
            n = max(1, round(seg.steps * (1 + rng.normal(0, sd))))
            bias = rng.normal(0, err.heading_bias_sd)
            sgn = {"left": -1.0, "right": 1.0}.get(seg.wall_side, 0.0)
            for _ in range(n):
                if sgn:
                    r, c = _rc(grid, x, y, h, w)
                    d = wd[r, c]
                    if d <= CANE_M:      # cane on the stated wall: align with it, hold a 0.5 m offset
                        heading = seg.heading_deg + sgn * min(max((d - WALL_OFFSET_M) * 30.0, -15.0), 15.0)
                hd = math.radians(heading + bias + rng.normal(0, err.heading_noise_sd))
                step = max(0.1, STEP_M + rng.normal(0, err.step_sd))
                nx, ny = x + step * math.sin(hd), y + step * math.cos(hd)
                r, c = _rc(grid, nx, ny, h, w)
                bump = not (0 <= (ny - grid.origin[1]) / grid.res < h and
                            0 <= (nx - grid.origin[0]) / grid.res < w) or grid.cells[r, c] != 0
                if not bump:
                    x, y = nx, ny
                elif _blocked(grid, nx, ny) in _SLIDE_CODES:
                    sl = slide_step(grid, (x, y), step, math.degrees(hd), seg.end)
                    if sl:
                        x, y = sl
                if _dist_to_path((x, y), path) > LOST_M:
                    r, c = _rc(grid, x, y, h, w)
                    lost[r, c] += 1
                    is_lost = True
                    break
            if is_lost:
                break
            heading += seg.turn_deg + rng.normal(0, 10.0)
        if not is_lost and math.hypot(x - goal[0], y - goal[1]) <= ARRIVE_M:
            arrived += 1
    return SimResult(runs=runs, arrival_rate=arrived / runs if runs else 0.0,
                     lost_cells_b64=OccGrid(np.minimum(lost, 255), grid.res, grid.origin).to_b64())


def _rc(grid: OccGrid, x: float, y: float, h: int, w: int) -> tuple[int, int]:
    r, c = grid.world_to_cell((x, y))
    return min(max(r, 0), h - 1), min(max(c, 0), w - 1)


def simulate_package(pkg: BuildingPackage, runs: int = 300, seed: int = 0) -> dict[str, SimResult]:
    """One SimResult per route id (R9: pipeline.run_sim stores it in pkg.sim)."""
    from dr.pipeline import _grid, promote_fixed
    grid = promote_fixed(_grid(pkg), pkg.landmarks)
    return {r.id: simulate(grid, r, runs, seed) for r in pkg.routes}
