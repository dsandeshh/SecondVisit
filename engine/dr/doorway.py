"""Doorway instructions (human decision, option 2). A route that passes through a gap of at most
DOOR_MAX_M between solid cells gets its own spoken line, computed from the geometry:
"In 6 steps, turn right through the doorway between the Reception counter and the glass wall."
The segment is split at the gap; the step count, the turn word and the names all come from code."""
from __future__ import annotations

import math
import re
from dataclasses import dataclass

from dr.config import STEP_M
from dr.grid import OccGrid, Vec2
from dr.package import Landmark, Segment
from dr.segments import LANDMARK_M, _pt_seg, _wrap180

DOOR_MAX_M = 1.2        # perpendicular free width that counts as a doorway
DOOR_RUN_MAX_M = 1.6    # a longer narrow stretch is a corridor, not a doorway
OPEN_MIN_M = 1.5        # the route must be wider than this before and after the gap
NAME_RADIUS_M = 3.0
_RAY_MAX = 2.0
_HEAD = re.compile(r"^(.*?)(Walk \d+ steps?)(.*)$", re.S)


@dataclass(frozen=True)
class Doorway:
    pos: Vec2
    width_m: float
    left_hit: Vec2
    right_hit: Vec2


def _solid(grid: OccGrid, x: float, y: float) -> bool:
    h, w = grid.cells.shape
    if not (0 <= (y - grid.origin[1]) / grid.res < h and 0 <= (x - grid.origin[0]) / grid.res < w):
        return True
    r, c = grid.world_to_cell((x, y))
    return bool(grid.cells[r, c])


def _ray(grid: OccGrid, p: Vec2, d: Vec2) -> float:
    t = 0.0
    while t < _RAY_MAX:
        t += 0.05
        if _solid(grid, p[0] + d[0] * t, p[1] + d[1] * t):
            return t
    return _RAY_MAX


def _resample(path: list[Vec2], step: float = 0.1) -> list[Vec2]:
    out: list[Vec2] = [tuple(path[0])]
    carry = 0.0
    for a, b in zip(path, path[1:]):
        L = math.dist(a, b)
        t = step - carry
        while t <= L:
            out.append((a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L))
            t += step
        carry = L - (t - step)
    return out


def find_doorways(path: list[Vec2], grid: OccGrid) -> list[Doorway]:
    pts = _resample([tuple(map(float, p)) for p in path])
    n = len(pts)
    if n < 20:
        return []
    k = 5  # tangent window, 0.5 m
    info: list[tuple[float, Vec2, Vec2]] = []
    def width(p: Vec2, a: Vec2, b: Vec2):
        L = math.dist(a, b) or 1.0
        fx, fy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        left, right = (-fy, fx), (fy, -fx)
        l, r = _ray(grid, p, left), _ray(grid, p, right)
        return (l + r if l < _RAY_MAX and r < _RAY_MAX else 99.0,
                (p[0] + left[0] * l, p[1] + left[1] * l), (p[0] + right[0] * r, p[1] + right[1] * r))

    for i, p in enumerate(pts):  # at a corner take the narrower of the incoming and outgoing directions
        info.append(min(width(p, pts[max(0, i - k)], p), width(p, p, pts[min(n - 1, i + k)]), key=lambda t: t[0]))
    out: list[Doorway] = []
    i = 0
    while i < n:
        if info[i][0] > DOOR_MAX_M:
            i += 1
            continue
        j = i
        while j + 1 < n and info[j + 1][0] <= DOOR_MAX_M:
            j += 1
        before, after = i - 8, j + 8
        if (before >= 0 and after < n and (j - i + 1) * 0.1 <= DOOR_RUN_MAX_M
                and info[before][0] > OPEN_MIN_M and info[after][0] > OPEN_MIN_M):
            m = min(info[x][0] for x in range(i, j + 1))
            mid = [x for x in range(i, j + 1) if info[x][0] <= m + 1e-9]
            c = mid[len(mid) // 2]
            if not out or math.dist(out[-1].pos, pts[c]) > 2.0:
                out.append(Doorway(pts[c], round(m, 2), info[c][1], info[c][2]))
        i = j + 1
    return out


def _name(lms: list[Landmark], hit: Vec2, skip: str | None = None) -> tuple[str, str | None]:
    best = None
    for lm in lms:
        if lm.fixed and lm.id != skip and lm.kind not in ("door", "glass_door"):
            d = math.dist(lm.pos, hit)
            if d <= NAME_RADIUS_M and (best is None or d < best[0]):
                best = (d, lm)
    return (f"the {best[1].spoken or best[1].label}", best[1].id) if best else ("the wall", None)


def door_turn(path: list[Vec2], door: Doorway) -> float:
    """Heading change through the doorway: path heading 1.5 m after minus 1.5 m before."""
    pts = _resample([tuple(map(float, p)) for p in path])
    i = min(range(len(pts)), key=lambda j: math.dist(pts[j], door.pos))
    a, b = pts[max(0, i - 15)], pts[min(len(pts) - 1, i + 15)]
    h = lambda u, v: math.degrees(math.atan2(v[0] - u[0], v[1] - u[1]))
    return _wrap180(h(door.pos, b) - h(a, door.pos))


def door_line(door: Doorway, steps: int, turn_deg: float, lms: list[Landmark]) -> str:
    left, lid = _name(lms, door.left_hit)
    right, rid = _name(lms, door.right_hit, skip=lid)
    kinds = {lm.id: lm.kind for lm in lms}
    if lid and rid and kinds[lid] == kinds[rid]:  # same kind both sides (two desks): one object and a wall, not two names
        right = "the wall"
    t = _wrap180(turn_deg)
    word = "go straight" if abs(t) < 20 else ("turn right" if t > 0 else "turn left")
    n = f"{steps} step" if steps == 1 else f"{steps} steps"
    return f"In {n}, {word} through the doorway between {left} and {right}."


def add_doorways(segs: list[Segment], path: list[Vec2], grid: OccGrid, lms: list[Landmark]) -> list[Segment]:
    """Split the segment that holds each doorway and write its line. Segment ids are renumbered s1..sN."""
    doors = find_doorways(path, grid)
    if not doors or not segs:
        return segs
    segs = list(segs)
    for door in doors:
        ds = [_pt_seg(door.pos, s.start, s.end) for s in segs]
        i = min(range(len(segs)), key=ds.__getitem__)
        s = segs[i]
        t_in = math.dist(s.start, door.pos)
        t_out = math.dist(door.pos, s.end)
        if ds[i] > 0.3 or "doorway" in s.instruction:
            continue
        m = _HEAD.match(s.instruction)
        head, tail = (m.group(1), m.group(3)) if m else ("", "")
        if t_out <= STEP_M:                       # the doorway is at the end of this segment
            line = head + door_line(door, s.steps, door_turn(path, door), lms)
            segs[i] = s.model_copy(update={"instruction": line})
            if i + 1 < len(segs):
                nxt = segs[i + 1]
                segs[i + 1] = nxt.model_copy(update={"instruction": _HEAD.sub(lambda mm: mm.group(2) + mm.group(3), nxt.instruction, 1)})
            continue
        if t_in <= STEP_M or t_in + t_out <= 0:   # at the start: the previous segment's end is the gap
            continue
        n1 = max(1, round(t_in / STEP_M))
        n2 = max(1, round(t_out / STEP_M))
        d = (round(door.pos[0], 3), round(door.pos[1], 3))
        p1 = [lm.id for lm in lms if _pt_seg(lm.pos, s.start, d) <= LANDMARK_M]
        p2 = [lm.id for lm in lms if _pt_seg(lm.pos, d, s.end) <= LANDMARK_M]
        a = s.model_copy(update={"end": d, "length_m": round(t_in, 2), "steps": n1, "landmarks_passed": p1,
                                 "turn_after": "none", "turn_deg": 0.0,
                                 "instruction": head + door_line(door, n1, door_turn(path, door), lms)})
        walk = f"Walk {n2} step{'' if n2 == 1 else 's'}"
        rest = tail if m else ""
        b = s.model_copy(update={"start": d, "length_m": round(t_out, 2), "steps": n2, "landmarks_passed": p2,
                                 "instruction": walk + rest})
        segs[i:i + 1] = [a, b]
    return [s.model_copy(update={"id": f"s{k + 1}"}) for k, s in enumerate(segs)]
