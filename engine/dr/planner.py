"""Cane friendly route planner: A* over (cell, heading octant) that prefers trailing walls.

Cell cost (plan Task 4): d = wall distance; cells with d < clearance_m (or any non free code) are
blocked. open = clip((d - WALL_TRAIL_M) / 1.5, 0, 1); hazard = glass or stairs within 1 m;
lm = a landmark within 1 m. cost = step_len * max(0.2, 1 + open_w*open + hazard_w*hazard - lm_w*lm),
plus turn_per_45 * octant change. The retry ladder (Review Focus 3) relaxes clearance and drops
small obstacle specks when no route exists.
"""
from __future__ import annotations

import heapq
import math
from dataclasses import dataclass, replace

import numpy as np
from scipy.ndimage import distance_transform_edt, label

from dr.config import WALL_TRAIL_M
from dr.grid import OccGrid, Vec2
from dr.package import Landmark

SNAP_M = 0.5        # start or goal may move this far to reach an unblocked cell
LADDER = ((0.35, 0.10), (0.30, 0.10), (0.25, 0.10))  # (clearance_m, drop_specks_m2) after the first try

# octant 0 = +y (north), clockwise, as heading_deg; moves as (drow, dcol)
_MOVES = ((1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1))


class NoRouteError(Exception):
    def __init__(self, start: Vec2, goal: Vec2, why: str = ""):
        self.start, self.goal = start, goal
        msg = f"No route from ({start[0]:.2f}, {start[1]:.2f}) to ({goal[0]:.2f}, {goal[1]:.2f})"
        super().__init__(msg + (f": {why}" if why else ""))


@dataclass(frozen=True)
class Weights:
    open: float = 3.0
    turn_per_45: float = 2.0
    hazard: float = 10.0
    landmark_bonus: float = 0.3
    clearance_m: float = 0.35
    drop_specks_m2: float = 0.0  # obstacle (code 2/3) blobs smaller than this are ignored; walls never


@dataclass(frozen=True)
class PlannedRoute:
    path: list[Vec2]
    relaxed: bool       # True when the ladder had to relax clearance or drop specks
    weights: Weights    # the weights that produced the path


def drop_specks(grid: OccGrid, max_area_m2: float) -> OccGrid:
    """Free connected blobs of obstacle codes 2 and 3 smaller than max_area_m2. Walls (1), glass (4)
    and stairs (5) are never removed."""
    if max_area_m2 <= 0:
        return grid
    cells = grid.cells.copy()
    lab, n = label(np.isin(cells, (2, 3)), structure=np.ones((3, 3)))
    if n:
        area = np.bincount(lab.ravel()) * grid.res ** 2
        small = area < max_area_m2
        small[0] = False
        cells[small[lab]] = 0
    return OccGrid(cells, grid.res, grid.origin)


def approach_point(grid: OccGrid, pos: Vec2, dist: float = 0.6) -> Vec2:
    """pos moved dist metres toward free space: straight away from the nearest non free cell (or, if
    pos sits on an obstacle, toward the nearest free cell). If that lands off free space, the one of
    16 directions landing furthest from walls."""
    h, w = grid.cells.shape
    r, c = grid.world_to_cell(pos)
    if 0 <= r < h and 0 <= c < w:
        inside = grid.cells[r, c] != 0
        mask = (grid.cells == 0) if inside else (grid.cells != 0)
        if mask.any():
            _, (ir, ic) = distance_transform_edt(~mask, return_indices=True)
            dr_, dc_ = int(ir[r, c]) - r, int(ic[r, c]) - c   # cell to cell, so the grid offset cancels
            v = (dc_, dr_) if inside else (-dc_, -dr_)
            n = math.hypot(*v)
            if n > 0:
                p = (pos[0] + dist * v[0] / n, pos[1] + dist * v[1] / n)
                pr, pc = grid.world_to_cell(p)
                if 0 <= pr < h and 0 <= pc < w and grid.cells[pr, pc] == 0:
                    return p
    d = grid.wall_distance()
    best, best_d = pos, -1.0
    for k in range(16):
        a = math.radians(k * 22.5)
        p = (pos[0] + dist * math.sin(a), pos[1] + dist * math.cos(a))
        r, c = grid.world_to_cell(p)
        if 0 <= r < h and 0 <= c < w and grid.cells[r, c] == 0 and d[r, c] > best_d:
            best, best_d = p, float(d[r, c])
    return best


def _blocked(grid: OccGrid, clearance_m: float) -> np.ndarray:
    return (grid.cells != 0) | (grid.wall_distance() < clearance_m)


def _snap(grid: OccGrid, blocked: np.ndarray, p: Vec2) -> tuple[int, int] | None:
    r, c = grid.world_to_cell(p)
    h, w = blocked.shape
    k = int(math.ceil(SNAP_M / grid.res))
    r0, r1, c0, c1 = max(r - k, 0), min(r + k + 1, h), max(c - k, 0), min(c + k + 1, w)
    if r0 >= r1 or c0 >= c1:
        return None
    rr, cc = np.mgrid[r0:r1, c0:c1]
    dd = (rr - r) ** 2 + (cc - c) ** 2
    ok = ~blocked[r0:r1, c0:c1] & (dd <= k * k)
    if not ok.any():
        return None
    i = np.argmin(np.where(ok, dd, np.iinfo(dd.dtype).max))
    return int(rr.flat[i]), int(cc.flat[i])


def _cell_factor(grid: OccGrid, landmarks: list[Landmark], w: Weights) -> np.ndarray:
    d = grid.wall_distance()
    openness = np.clip((d - WALL_TRAIL_M) / 1.5, 0, 1)
    haz_src = np.isin(grid.cells, (4, 5))
    hazard = (distance_transform_edt(~haz_src) * grid.res <= 1.0) if haz_src.any() \
        else np.zeros(d.shape, bool)
    lm = np.zeros(d.shape, bool)
    if landmarks:
        h, wd = d.shape
        xs = grid.origin[0] + (np.arange(wd) + 0.5) * grid.res
        ys = grid.origin[1] + (np.arange(h) + 0.5) * grid.res
        for l in landmarks:
            lm |= ((xs[None, :] - l.pos[0]) ** 2 + (ys[:, None] - l.pos[1]) ** 2) <= 1.0
    return np.maximum(0.2, 1 + w.open * openness + w.hazard * hazard - w.landmark_bonus * lm)


def _search(grid: OccGrid, start: Vec2, goal: Vec2, factor: np.ndarray | None,
            clearance_m: float, turn: float) -> list[Vec2]:
    blocked = _blocked(grid, clearance_m)
    s = _snap(grid, blocked, start)
    t = _snap(grid, blocked, goal)
    if s is None or t is None:
        raise NoRouteError(start, goal, ("start" if s is None else "goal") + " is blocked")
    h, w = blocked.shape
    res = grid.res
    free = (~blocked).ravel().tolist()
    fac = factor.ravel().tolist() if factor is not None else None
    hmin = (float(factor[~blocked].min()) if factor is not None else 1.0) * res
    tr, tc = t
    si, ti = s[0] * w + s[1], t[0] * w + t[1]
    steps = [(dr * w + dc, dr, dc, res * (math.sqrt(2) if dr and dc else 1.0)) for dr, dc in _MOVES]
    # state = cell * 9 + octant (8 = no heading yet)
    s0 = si * 9 + 8
    g = {s0: 0.0}
    prev: dict[int, int] = {}
    heap = [(0.0, 0.0, s0)]
    done = None
    while heap:
        _, gc, st = heapq.heappop(heap)
        if gc > g.get(st, math.inf):
            continue
        i, o = divmod(st, 9)
        if i == ti:
            done = st
            break
        r, c = divmod(i, w)
        for no, (di, dr, dc, ln) in enumerate(steps):
            nr, nc = r + dr, c + dc
            if not (0 <= nr < h and 0 <= nc < w):
                continue
            ni = i + di
            if not free[ni]:
                continue
            if dr and dc and not (free[i + dr * w] and free[i + dc]):
                continue  # no corner cutting
            cost = ln * (fac[ni] if fac is not None else 1.0)
            if o != 8 and turn:
                k = abs(no - o)
                cost += turn * min(k, 8 - k)
            ns = ni * 9 + no
            ng = gc + cost
            if ng < g.get(ns, math.inf):
                g[ns] = ng
                prev[ns] = st
                hh = hmin * math.hypot(nr - tr, nc - tc)
                heapq.heappush(heap, (ng + hh, ng, ns))
    if done is None:
        raise NoRouteError(start, goal, f"clearance {clearance_m:.2f} m")
    cells = [done // 9]
    st = done
    while st in prev:
        st = prev[st]
        cells.append(st // 9)
    return [grid.cell_to_world(divmod(i, w)) for i in reversed(cells)]


def plan(grid: OccGrid, start: Vec2, goal: Vec2, landmarks: list[Landmark],
         w: Weights = Weights()) -> list[Vec2]:
    """Cane friendly path of cell centres from start to goal. Raises NoRouteError."""
    g = drop_specks(grid, w.drop_specks_m2)
    return _search(g, start, goal, _cell_factor(g, landmarks, w), w.clearance_m, w.turn_per_45)


def shortest(grid: OccGrid, start: Vec2, goal: Vec2, w: Weights = Weights()) -> list[Vec2]:
    """Plain A* (step length only) with the same clearance."""
    g = drop_specks(grid, w.drop_specks_m2)
    return _search(g, start, goal, None, w.clearance_m, 0.0)


def plan_with_ladder(grid: OccGrid, start: Vec2, goal: Vec2, landmarks: list[Landmark],
                     w: Weights = Weights()) -> PlannedRoute:
    """plan(), then on NoRouteError retry with drop_specks_m2 0.10 and clearance 0.35, 0.30, 0.25 m
    (never below 0.25 m). A retried route is relaxed. Raises the last NoRouteError."""
    try:
        return PlannedRoute(plan(grid, start, goal, landmarks, w), False, w)
    except NoRouteError as e:
        err = e
    for clr, specks in LADDER:
        ww = replace(w, clearance_m=min(clr, w.clearance_m),
                     drop_specks_m2=max(specks, w.drop_specks_m2))
        if ww == w:
            continue
        try:
            return PlannedRoute(plan(grid, start, goal, landmarks, ww), True, ww)
        except NoRouteError as e:
            err = e
    raise err
