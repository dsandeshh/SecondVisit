"""Task 2: Matterport wall graph, rooms, panos and point cloud to grid, rooms, doors and obstacles.

The model frame is the plan frame (metres, x right, y up). Nothing here rotates or mirrors.
Run `python -m dr.mp_import <sid>` to build and write `data/<sid>/grid_preview.png` (gitignored).
"""
from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Literal

import numpy as np
from pydantic import BaseModel, Field
from scipy.ndimage import label as cc_label
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Point, Polygon
from shapely import contains_xy
from shapely.ops import nearest_points, polygonize

from dr.config import GRID_RES
from dr.grid import OccGrid
from dr.mp_client import ROOT
from dr.package import BuildingPackage, Door, Entrance, Grid, Landmark, Prov, Room
from dr.prov import ProvBuilder

DATA = ROOT / "data"
Vec2 = tuple[float, float]
WallSeg = tuple[Vec2, Vec2, float, str]  # (a, b, thickness, type)

MIN_WALL_M = 0.10
DOOR_W_M = 0.9  # carved opening width
NEAR_SHARE_M = 0.4  # boundaries within this distance count as a shared wall
GAP_MIN_M, GAP_MAX_M = 0.6, 2.5  # wall end gaps in this range are doors
DIAG_MIN_DEG, DIAG_MAX_DEG = 5.0, 85.0
DOORWAY_MAX_M = 1.0  # an unscanned room's doorway must be this close to the walkable area
SOLID = (1, 2, 4, 5)  # not walkable for connectivity checks


def _is_door_type(t: str) -> bool:
    t = (t or "").lower()
    return "door" in t or "opening" in t


def _floor(rooms_json: dict, floor_id: str) -> dict:
    for f in rooms_json["model"]["floors"]:
        if f["id"] == floor_id:
            return f
    raise KeyError(f"floor {floor_id} not in rooms.json")


def _graph(rooms_json: dict, floor_id: str):
    f = _floor(rooms_json, floor_id)
    V = {v["id"]: (float(v["position"]["x"]), float(v["position"]["y"])) for v in f["vertices"]}
    E = {e["id"]: e for e in f["edges"]}
    return V, E


# ---------------------------------------------------------------- walls and grid

def _is_diagonal(a: Vec2, b: Vec2) -> bool:
    ang = math.degrees(math.atan2(abs(a[1] - b[1]), abs(a[0] - b[0])))
    return DIAG_MIN_DEG < ang < DIAG_MAX_DEG


def walls_from_graph(rooms_json: dict, floor_id: str, drop_diagonal: bool = False) -> list[WallSeg]:
    """`drop_diagonal` omits non axis aligned edges (scan artefacts that cut across rooms; the clinic)."""
    V, E = _graph(rooms_json, floor_id)
    out = []
    for e in E.values():
        a, b = (V[x["id"]] for x in e["vertices"])
        if drop_diagonal and _is_diagonal(a, b):
            continue
        out.append((a, b, float(e.get("thickness") or MIN_WALL_M), e.get("type") or "wall"))
    return out


def _band(grid: OccGrid, a: Vec2, b: Vec2, half_w: float, ext: float):
    """Row/col index arrays of cells whose centre lies in the band around a-b (square caps of `ext`)."""
    res, (ox, oy) = grid.res, grid.origin
    h, w = grid.cells.shape
    r = half_w + ext + res
    x0, x1 = min(a[0], b[0]) - r, max(a[0], b[0]) + r
    y0, y1 = min(a[1], b[1]) - r, max(a[1], b[1]) + r
    c0, c1 = max(0, int((x0 - ox) / res)), min(w, int((x1 - ox) / res) + 1)
    r0, r1 = max(0, int((y0 - oy) / res)), min(h, int((y1 - oy) / res) + 1)
    if c0 >= c1 or r0 >= r1:
        return np.array([], int), np.array([], int)
    rr, cc = np.mgrid[r0:r1, c0:c1]
    px, py = ox + (cc + 0.5) * res, oy + (rr + 0.5) * res
    d = np.array(b, float) - np.array(a, float)
    L = float(np.hypot(*d)) or 1e-9
    u = d / L
    along = (px - a[0]) * u[0] + (py - a[1]) * u[1]
    perp = np.abs(-(px - a[0]) * u[1] + (py - a[1]) * u[0])
    m = (along >= -ext) & (along <= L + ext) & (perp <= half_w)
    return rr[m], cc[m]


def rasterize(walls: list[WallSeg], res: float = GRID_RES, margin_m: float = 1.0) -> OccGrid:
    """Each wall edge becomes a band of width max(thickness, 0.10) (+ half a cell each side so thin
    diagonal walls never leak), code 1. Door or opening typed edges are left open."""
    pts = np.array([p for a, b, _, _ in walls for p in (a, b)], float)
    lo = np.floor((pts.min(0) - margin_m) / res) * res
    hi = pts.max(0) + margin_m
    w, h = (np.ceil((hi - lo) / res)).astype(int)
    g = OccGrid(np.zeros((h, w), np.uint8), res, (round(lo[0], 6), round(lo[1], 6)))
    for a, b, t, typ in walls:
        if _is_door_type(typ):
            continue
        tw = max(t, MIN_WALL_M)
        rr, cc = _band(g, a, b, tw / 2 + res / 2, tw / 2)
        g.cells[rr, cc] = 1
    return g


# ---------------------------------------------------------------- rooms

def _room_polygon(segs: list[tuple[Vec2, Vec2]]) -> Polygon | None:
    lines = [LineString([a, b]) for a, b in segs if a != b]
    polys = list(polygonize(lines))
    if not polys:
        # open boundary (a gap): close it by joining dangling ends pairwise, nearest first
        deg: dict[Vec2, int] = {}
        for a, b in segs:
            deg[a] = deg.get(a, 0) + 1
            deg[b] = deg.get(b, 0) + 1
        ends = [p for p, d in deg.items() if d == 1]
        while len(ends) >= 2:
            p = ends.pop(0)
            q = min(ends, key=lambda e: np.hypot(e[0] - p[0], e[1] - p[1]))
            ends.remove(q)
            lines.append(LineString([p, q]))
        polys = list(polygonize(lines))
    if not polys:
        return None
    return max(polys, key=lambda p: p.area)


def _room_segs(rm: dict, V: dict, E: dict) -> list[tuple[Vec2, Vec2]]:
    segs = []
    for be in rm["boundary"]["edges"]:
        e = E.get(be["id"])
        if e:
            a, b = (V[x["id"]] for x in e["vertices"])
            segs.append((a, b))
    return segs


def rooms_from_graph(rooms_json: dict, floor_id: str) -> list[Room]:
    V, E = _graph(rooms_json, floor_id)
    out = []
    for rm in rooms_json["model"].get("rooms", []):
        if (rm.get("floor") or {}).get("id", floor_id) != floor_id:
            continue
        cls = rm.get("classifications") or [{"label": "Other"}]
        lab = cls[0].get("label") or "Other"
        if lab == "Void":
            continue
        poly = _room_polygon(_room_segs(rm, V, E))
        if poly is None:
            continue
        area = (rm.get("dimensions") or {}).get("areaFloor") or poly.area
        coords = [(round(x, 4), round(y, 4)) for x, y in list(poly.exterior.coords)[:-1]]
        out.append(Room(id=rm["id"], label=lab, polygon=coords, area_m2=round(float(area), 3)))
    return out


def _poly(room: Room) -> Polygon:
    return Polygon(room.polygon)


def _rooms_at(rooms: list[Room], p: Vec2) -> list[str]:
    pt = Point(p)
    return [r.id for r in rooms if _poly(r).contains(pt)]


# ---------------------------------------------------------------- doors

def doors_from_graph(rooms_json: dict, floor_id: str, rooms: list[Room]) -> list[Door]:
    """Door or opening typed edges, plus gaps between dangling wall ends (mutual nearest, 0.6 to 2.5 m)."""
    V, E = _graph(rooms_json, floor_id)
    doors: list[Door] = []

    def add(a: Vec2, b: Vec2, kind: str):
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        d = np.array(b) - np.array(a)
        n = np.array([-d[1], d[0]]) / (np.hypot(*d) or 1)
        s1 = _rooms_at(rooms, tuple(mid + 0.3 * n))
        s2 = _rooms_at(rooms, tuple(mid - 0.3 * n))
        pair = [s1[0], s2[0]] if s1 and s2 and s1[0] != s2[0] else []
        doors.append(Door(id=f"door_{kind}_{len(doors)}", a=a, b=b, rooms=pair))

    deg: dict[str, int] = {}
    for e in E.values():
        if _is_door_type(e.get("type")):
            a, b = (V[x["id"]] for x in e["vertices"])
            add(a, b, "mp")
            continue
        for x in e["vertices"]:
            deg[x["id"]] = deg.get(x["id"], 0) + 1
    ends = [v for v, d in deg.items() if d == 1]

    def nearest(v):
        others = [u for u in ends if u != v]
        return min(others, key=lambda u: np.hypot(V[u][0] - V[v][0], V[u][1] - V[v][1])) if others else None

    seen = set()
    for v in ends:
        u = nearest(v)
        if u is None or nearest(u) != v or frozenset((u, v)) in seen:
            continue
        seen.add(frozenset((u, v)))
        if GAP_MIN_M <= np.hypot(V[u][0] - V[v][0], V[u][1] - V[v][1]) <= GAP_MAX_M:
            add(V[v], V[u], "gap")
    return doors


def _labels(grid: OccGrid) -> np.ndarray:
    lab, _ = cc_label(~np.isin(grid.cells, SOLID))
    return lab


def _carve(grid: OccGrid, centre: np.ndarray, u: np.ndarray, width: float, depth: float) -> None:
    a = centre - u * width / 2
    b = centre + u * width / 2
    rr, cc = _band(grid, tuple(a), tuple(b), depth / 2, 0.0)
    sel = np.isin(grid.cells[rr, cc], (1, 2, 4))
    grid.cells[rr[sel], cc[sel]] = 0


def _wall_piece_near(shared, q: Point) -> tuple[np.ndarray, np.ndarray] | None:
    """The straight sub-segment of `shared` nearest q, as (start, end)."""
    geoms = getattr(shared, "geoms", [shared])
    best = None
    for gm in geoms:
        if not isinstance(gm, LineString):
            continue
        cs = list(gm.coords)
        for p0, p1 in zip(cs, cs[1:]):
            s = LineString([p0, p1])
            if s.length < 1e-6:
                continue
            d = s.distance(q)
            if best is None or d < best[0]:
                best = (d, np.array(p0), np.array(p1))
    return None if best is None else (best[1], best[2])


def ensure_doors(grid: OccGrid, rooms: list[Room], panos: dict[str, Vec2]) -> tuple[OccGrid, list[Door]]:
    """Carve a 0.9 m opening between neighbouring rooms whose panos the grid does not connect."""
    g = OccGrid(grid.cells.copy(), grid.res, grid.origin)
    h, w = g.cells.shape
    for p in panos.values():  # a pano is a known walkable point
        r, c = g.world_to_cell(p)
        if 0 <= r < h and 0 <= c < w and g.cells[r, c] in SOLID:
            g.cells[r, c] = 0
    polys = {r.id: _poly(r) for r in rooms}
    in_room = {r.id: [p for p in panos.values() if polys[r.id].contains(Point(p))] for r in rooms}
    pairs = []
    ids = [r.id for r in rooms if in_room[r.id]]
    for i, ra in enumerate(ids):
        for rb in ids[i + 1:]:
            if polys[ra].distance(polys[rb]) > NEAR_SHARE_M:
                continue
            pa, pb = min(((x, y) for x in in_room[ra] for y in in_room[rb]),
                         key=lambda t: np.hypot(t[0][0] - t[1][0], t[0][1] - t[1][1]))
            pairs.append((np.hypot(pa[0] - pb[0], pa[1] - pb[1]), ra, rb, pa, pb))
    pairs.sort()
    doors: list[Door] = []
    for _, ra, rb, pa, pb in pairs:
        lab = _labels(g)
        if lab[g.world_to_cell(pa)] == lab[g.world_to_cell(pb)]:
            continue
        shared = polys[ra].boundary.intersection(polys[rb].buffer(NEAR_SHARE_M))
        if shared.is_empty:
            continue
        q = nearest_points(shared, LineString([pa, pb]))[0]
        piece = _wall_piece_near(shared, q)
        if piece is None:
            continue
        s0, s1 = piece
        L = float(np.hypot(*(s1 - s0)))
        u = (s1 - s0) / L
        t = float(np.dot(np.array(q.coords[0]) - s0, u))
        t = L / 2 if L <= DOOR_W_M else min(max(t, DOOR_W_M / 2), L - DOOR_W_M / 2)
        centre = s0 + u * t
        _carve(g, centre, u, DOOR_W_M, 0.6)
        a, b = centre - u * DOOR_W_M / 2, centre + u * DOOR_W_M / 2
        doors.append(Door(id=f"door_calc_{len(doors)}",
                          a=(round(a[0], 3), round(a[1], 3)), b=(round(b[0], 3), round(b[1], 3)),
                          rooms=sorted([ra, rb])))
    return g, doors


def mark_unscanned(grid: OccGrid, rooms: list[Room],
                   panos: dict[str, Vec2]) -> tuple[OccGrid, list[Room], list[Door]]:
    """Rooms the walkable area never reaches (no pano inside, no door) are "not scanned": carve a 0.9 m
    doorway where the room's boundary comes closest to the walkable area, then block the room interior
    (code 1) so no route can enter. The doorway notch stays visible on the walkable side."""
    g = OccGrid(grid.cells.copy(), grid.res, grid.origin)
    lost = disconnected_rooms(g, rooms, panos)
    ids = {r.id for r in lost}  # plus rooms with no pano inside (dropped wall edges can unseal them)
    lost += [r for r in rooms if r.id not in ids and not any(_poly(r).contains(Point(p)) for p in panos.values())]
    if not lost:
        return g, list(rooms), []
    lab = _labels(g)
    comps = [lab[g.world_to_cell(p)] for p in panos.values()]
    comps = [c for c in comps if c]
    main = max(set(comps), key=comps.count) if comps else 0
    rr, cc = np.nonzero(lab == main)
    tree = cKDTree(np.column_stack([g.origin[0] + (cc + 0.5) * g.res, g.origin[1] + (rr + 0.5) * g.res])) \
        if len(rr) else None
    lost_ids = {r.id for r in lost}
    doors: list[Door] = []
    for r in lost:
        poly = _poly(r)
        ring = poly.exterior
        if tree is None:
            continue
        samples = [ring.interpolate(t) for t in np.arange(0.0, ring.length, g.res)]
        dist, idx = tree.query([[q.x, q.y] for q in samples])
        k = int(np.argmin(dist))
        if dist[k] > DOORWAY_MAX_M:
            continue
        q = samples[k]
        cs = list(ring.coords)
        p0, p1 = min(zip(cs, cs[1:]), key=lambda s: LineString(s).distance(q))
        u = np.array(p1) - np.array(p0)
        u = u / (np.hypot(*u) or 1.0)
        L = float(np.hypot(p1[0] - p0[0], p1[1] - p0[1]))
        t = float(np.dot(np.array([q.x, q.y]) - np.array(p0), u))
        t = L / 2 if L <= DOOR_W_M else min(max(t, DOOR_W_M / 2), L - DOOR_W_M / 2)
        centre = np.array(p0) + u * t  # keep the doorway on the straight wall, off the corners
        _carve(g, centre, u, DOOR_W_M, 0.6)
        a, b = centre - u * DOOR_W_M / 2, centre + u * DOOR_W_M / 2
        nb = [i for i in _rooms_at(rooms, tuple(tree.data[int(idx[k])])) if i != r.id and i not in lost_ids]
        doors.append(Door(id=f"door_ns_{len(doors)}",
                          a=(round(a[0], 3), round(a[1], 3)), b=(round(b[0], 3), round(b[1], 3)),
                          rooms=sorted([r.id, nb[0]]) if nb else []))
    h, w = g.cells.shape
    for r in lost:
        x0, y0, x1, y1 = _poly(r).bounds
        r0, c0 = max(g.world_to_cell((x0, y0))[0], 0), max(g.world_to_cell((x0, y0))[1], 0)
        r1, c1 = min(g.world_to_cell((x1, y1))[0] + 1, h), min(g.world_to_cell((x1, y1))[1] + 1, w)
        if r0 >= r1 or c0 >= c1:
            continue
        ri, ci = np.mgrid[r0:r1, c0:c1]
        inside = contains_xy(_poly(r), g.origin[0] + (ci + 0.5) * g.res, g.origin[1] + (ri + 0.5) * g.res)
        sel = inside & np.isin(g.cells[ri, ci], (0, 3))
        g.cells[ri[sel], ci[sel]] = 1
    out = [r.model_copy(update={"scanned": False}) if r.id in lost_ids else r for r in rooms]
    return g, out, doors


def disconnected_rooms(grid: OccGrid, rooms: list[Room], panos: dict[str, Vec2]) -> list[Room]:
    """Rooms with no walkable cell in the component holding the most panos."""
    lab = _labels(grid)
    comps = [lab[grid.world_to_cell(p)] for p in panos.values()]
    comps = [c for c in comps if c]
    if not comps:
        return list(rooms)
    main = max(set(comps), key=comps.count)
    out = []
    for r in rooms:
        poly = _poly(r)
        x0, y0, x1, y1 = poly.bounds
        r0, c0 = grid.world_to_cell((x0, y0))
        r1, c1 = grid.world_to_cell((x1, y1))
        ok = False
        for rr in range(max(r0, 0), min(r1 + 1, lab.shape[0])):
            for cc in range(max(c0, 0), min(c1 + 1, lab.shape[1])):
                if lab[rr, cc] == main and poly.contains(Point(grid.cell_to_world((rr, cc)))):
                    ok = True
                    break
            if ok:
                break
        if not ok:
            out.append(r)
    return out


# ---------------------------------------------------------------- point cloud

@lru_cache(maxsize=2)
def _read_xyz(path: str) -> np.ndarray:
    a = np.fromfile(path, sep=" ")
    return a.reshape(-1, 6)[:, :3]


def floor_z_from_cloud(path: str, panos: dict[str, Vec2]) -> float:
    """2nd percentile of point z within 1 m (in plan) of any pano."""
    pts = _read_xyz(path)
    near = np.zeros(len(pts), bool)
    for x, y in panos.values():
        near |= (pts[:, 0] - x) ** 2 + (pts[:, 1] - y) ** 2 <= 1.0
    z = pts[near, 2] if near.any() else pts[:, 2]
    return float(np.percentile(z, 2))


def obstacles_from_cloud(path: str, grid: OccGrid, floor_z: float | None,
                         panos: dict[str, Vec2]) -> OccGrid:
    """Free cells, more than 0.15 m from a wall, holding at least 8 points between floor_z + 0.1 and
    floor_z + 1.8, become code 3 (movable). Blobs under 0.05 m2 are dropped; cells within 0.4 m of a
    pano stay free. floor_z None means compute it from the cloud around the panos."""
    if floor_z is None:
        floor_z = floor_z_from_cloud(path, panos)
    pts = _read_xyz(path)
    m = (pts[:, 2] >= floor_z + 0.1) & (pts[:, 2] <= floor_z + 1.8)
    p = pts[m]
    h, w = grid.cells.shape
    c = np.floor((p[:, 0] - grid.origin[0]) / grid.res).astype(int)
    r = np.floor((p[:, 1] - grid.origin[1]) / grid.res).astype(int)
    ok = (r >= 0) & (r < h) & (c >= 0) & (c < w)
    counts = np.bincount(r[ok] * w + c[ok], minlength=h * w).reshape(h, w)
    occ = (counts >= 8) & (grid.cells == 0) & (grid.wall_distance() > 0.15)
    rr, cc = np.mgrid[0:h, 0:w]
    cx, cy = grid.origin[0] + (cc + 0.5) * grid.res, grid.origin[1] + (rr + 0.5) * grid.res
    for x, y in panos.values():
        occ &= (cx - x) ** 2 + (cy - y) ** 2 > 0.4 ** 2
    lab, n = cc_label(occ, structure=np.ones((3, 3)))
    if n:
        sizes = np.bincount(lab.ravel()) * grid.res ** 2
        small = sizes < 0.05 - 1e-9
        small[0] = True
        occ &= ~small[lab]
    out = OccGrid(grid.cells.copy(), grid.res, grid.origin)
    out.cells[occ] = 3
    return out


# ---------------------------------------------------------------- overrides and panos

class OverrideEntrance(BaseModel):
    id: str = "entrance"
    label: str = "Entrance"
    pos: Vec2
    heading_deg: float


class OverrideDestination(BaseModel):
    landmark_id: str | None = None
    pos: Vec2 | None = None
    label: str | None = None


class ArrivalPins(BaseModel):
    door_lat: float
    door_lon: float
    curb_lat: float
    curb_lon: float


class Overrides(BaseModel):
    """data/<sid>/overrides.json (ruling R5). Every field optional; a missing file means defaults."""
    entrance: OverrideEntrance | None = None
    destination: OverrideDestination | None = None
    extra_landmarks: list[Landmark] = Field(default_factory=list)
    deleted_landmark_ids: list[str] = Field(default_factory=list)
    label_overrides: dict[str, str] = Field(default_factory=dict)  # landmark id -> new label (rename in the objects list)
    face_yaw0_deg: float = 0.0
    faces_clockwise: bool = True
    arrival: ArrivalPins | None = None
    drop_diagonal_walls: bool = False  # clinic: drop the diagonal scan artefact edges from the wall graph
    # curb to door (agent6 4.1.2 / 4.1.6); all optional, unknown stays unknown
    facade_bearing_deg: float | None = None  # compass bearing of the entrance facade edge (plan_north_deg = alpha + this)
    facade_bearing_src: Literal["hand", "calc", "vexcel", "costar"] | None = None
    facade_bearing_ref: str | None = None
    reference_bearing_deg: float | None = None  # compass bearing the person faces at the curb pin (HAND)
    reference_words: str | None = None  # "with the car beside you and the building ahead"
    edge_type: Literal["flush", "curb_ramp", "step_up", "unknown"] | None = None
    crosses_drive_lane: bool | None = None
    door_type: Literal["automatic_sliding", "automatic_swing", "push", "pull", "unknown"] | None = None
    canopy: list[Vec2] | None = None  # canopy polygon in plan metres (HAND)
    second_destination: OverrideDestination | None = None  # second demo route target (R5 extension)

    @property
    def destination_landmark_id(self) -> str | None:
        d = self.destination
        if d is None:
            return None
        return d.landmark_id or ("dest" if d.pos is not None else None)

    def destination_landmark(self) -> Landmark | None:
        """A destination given as a pos becomes landmark "dest", kind "desk"."""
        d = self.destination
        if d is None or d.pos is None:
            return None
        return Landmark(id="dest", kind="desk", label=d.label or "Destination", pos=d.pos,
                        confidence=1.0, fixed=True)


def second_destination(ov: "Overrides") -> tuple[str | None, Landmark | None]:
    """(landmark id, landmark to add) for the second demo route; a pos becomes landmark "dest2" (kind other)."""
    d = ov.second_destination
    if d is None:
        return None, None
    if d.landmark_id:
        return d.landmark_id, None
    if d.pos is not None:
        return "dest2", Landmark(id="dest2", kind="other", label=d.label or "Destination", pos=d.pos,
                                 confidence=1.0, fixed=True)
    return None, None


def load_overrides(sid: str, data_root: Path = DATA) -> Overrides:
    p = Path(data_root) / sid / "overrides.json"
    if not p.exists():
        return Overrides()
    return Overrides.model_validate(json.loads(p.read_text()))


def _raw(sid: str, data_root: Path) -> Path:
    return Path(data_root) / sid / "raw"


def load_panos(sid: str, data_root: Path = DATA) -> dict[str, Vec2]:
    """Pano id -> plan position. The clinic has one floor, so every pano belongs to it."""
    raw = _raw(sid, data_root)
    for name in ("rooms.json", "panos.json"):
        p = raw / name
        if p.exists():
            locs = json.loads(p.read_text())["model"].get("panoLocations") or []
            if locs:
                return {l["id"]: (float(l["position"]["x"]), float(l["position"]["y"])) for l in locs}
    return {}


# ---------------------------------------------------------------- package

def build_from_matterport(sid: str, data_root: Path = DATA) -> BuildingPackage:
    """Grid, rooms, doors and entrances (no routes, no landmarks) from the cached sponsor data."""
    raw = _raw(sid, data_root)
    rj = json.loads((raw / "rooms.json").read_text())
    idx = json.loads((raw / "index_row.json").read_text()) if (raw / "index_row.json").exists() else {}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    notes: list[str] = []
    floors = rj["model"]["floors"]
    floor_id = floors[0]["id"]
    if len(floors) > 1:
        notes.append(f"{len(floors)} floors; only the first ({floors[0].get('label')}) is imported")
    panos = load_panos(sid, data_root)

    ov = load_overrides(sid, data_root)
    walls = walls_from_graph(rj, floor_id, drop_diagonal=ov.drop_diagonal_walls)
    grid = rasterize(walls)
    rooms = rooms_from_graph(rj, floor_id)
    gap_doors = doors_from_graph(rj, floor_id, rooms)
    grid, carved = ensure_doors(grid, rooms, panos)
    grid, rooms, ns_doors = mark_unscanned(grid, rooms, panos)
    notes.append(f"doors carved by ensure_doors: {len(carved)}")
    carved = carved + ns_doors
    notes.append(f"rooms not scanned (doorway carved, interior blocked): {sum(not r.scanned for r in rooms)}"
                 f"; diagonal wall edges dropped: {ov.drop_diagonal_walls}")
    notes.append(f"walls: {len(walls)} edges, {int((grid.cells == 1).sum())} wall cells")
    notes.append(f"doors from the wall graph (gaps or door edges): {len(gap_doors)}")

    pb = ProvBuilder(now)
    prov = pb.entries
    cloud = raw / "cloud_sample.xyz"
    if cloud.exists() and panos:
        fz = floor_z_from_cloud(str(cloud), panos)
        grid = obstacles_from_cloud(str(cloud), grid, fz, panos)
        notes.append(f"obstacle cells (code 3, movable): {int((grid.cells == 3).sum())}; floor_z {fz:.2f} m")
        pb.add("grid.obstacles", src="calc", ref="obstacles_from_cloud",
                                      inputs=["matterport:cloud_sample.xyz"])
    else:
        notes.append("no point cloud sample: no obstacles")

    lost = disconnected_rooms(grid, [r for r in rooms if r.scanned], panos)
    if lost:
        notes.append("rooms not connected to the main walkable area: "
                     + ", ".join(f"{r.id} ({r.area_m2:.1f} m2)" for r in lost))

    entrances = []
    if ov.entrance:
        e = ov.entrance
        entrances.append(Entrance(id=e.id, label=e.label, pos=e.pos, heading_deg=e.heading_deg))
        pb.add(f"entrance:{e.id}", src="hand", ref="overrides.json")
    else:
        notes.append("no entrance: data/<sid>/overrides.json missing or has no entrance (set it in pick.html)")

    pb.add("grid", src="calc", ref="rasterize", inputs=["matterport:rooms.json#walls"])
    for r in rooms:
        pb.add(f"room:{r.id}", src="matterport", ref=f"rooms.json#{r.id}")
        pb.add(f"room:{r.id}.label", src="matterport", ref=f"rooms.json#{r.id}.classifications")
    for d in gap_doors:
        pb.add(f"door:{d.id}", src="matterport", ref="rooms.json#walls")
    for d in carved:
        pb.add(f"door:{d.id}", src="calc", ref="ensure_doors",
                                    inputs=[f"room:{x}" for x in d.rooms])
    map_date = idx.get("original_created", "")
    if map_date:
        pb.add("map_date", src="matterport", ref="index_row.json#original_created")

    h, w = grid.cells.shape
    return BuildingPackage(
        id=sid, name=idx.get("name") or sid, source="matterport", model_id=sid, generated_at=now,
        grid=Grid(res=grid.res, width=w, height=h, origin=grid.origin, cells_b64=grid.to_b64()),
        rooms=rooms, doors=gap_doors + carved, entrances=entrances, notes=notes, prov=prov,
        map_date=map_date)


# ---------------------------------------------------------------- preview (sponsor derived: never commit)

def save_preview(pkg: BuildingPackage, sid: str, data_root: Path = DATA, out: Path | None = None) -> Path:
    from PIL import Image, ImageDraw

    raw = _raw(sid, data_root)
    fp = json.loads((raw / "floorplan.json").read_text())
    img = Image.open(raw / "floorplan.jpg").convert("RGB")
    ppm = float(fp["resolution"])
    W, H = img.size
    fx0, fy0 = fp["origin"]["x"], fp["origin"]["y"]
    g = OccGrid.from_b64(pkg.grid.cells_b64, pkg.grid.width, pkg.grid.height, pkg.grid.res, pkg.grid.origin)
    gx0, gy0 = g.origin
    gx1, gy1 = gx0 + pkg.grid.width * g.res, gy0 + pkg.grid.height * g.res
    X0, Y0 = min(fx0, gx0), min(fy0, gy0)
    X1, Y1 = max(fx0 + W / ppm, gx1), max(fy0 + H / ppm, gy1)
    cw, ch = int(round((X1 - X0) * ppm)), int(round((Y1 - Y0) * ppm))

    def px(p):
        return ((p[0] - X0) * ppm, (Y1 - p[1]) * ppm)

    canvas = Image.new("RGB", (cw, ch), (255, 255, 255))
    canvas.paste(img, tuple(int(round(v)) for v in px((fx0, fy0 + H / ppm))))
    colours = {1: (220, 0, 0, 150), 2: (120, 0, 160, 170), 3: (255, 140, 0, 150), 4: (0, 160, 255, 150)}
    rgba = np.zeros((*g.cells.shape, 4), np.uint8)
    for code, col in colours.items():
        rgba[g.cells == code] = col
    ov = Image.fromarray(rgba[::-1], "RGBA")
    scale = g.res * ppm
    ov = ov.resize((int(round(ov.width * scale)), int(round(ov.height * scale))), Image.NEAREST)
    layer = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    layer.paste(ov, tuple(int(round(v)) for v in px((gx0, gy1))))
    canvas = Image.alpha_composite(canvas.convert("RGBA"), layer)
    d = ImageDraw.Draw(canvas)
    for r in pkg.rooms:
        d.line([px(p) for p in r.polygon + [r.polygon[0]]], fill=(0, 90, 255, 255), width=3)
        c = _poly(r).representative_point()
        d.text(px((c.x, c.y)), f"{r.id[:5]} {r.area_m2:.0f}", fill=(0, 60, 200, 255))
    for dr_ in pkg.doors:
        col = (0, 200, 0, 255) if dr_.id.startswith("door_calc") else (255, 160, 0, 255) if dr_.id.startswith("door_ns") else (0, 220, 255, 255)
        d.line([px(dr_.a), px(dr_.b)], fill=col, width=12)
    rj = json.loads((raw / "rooms.json").read_text())
    for l in rj["model"].get("panoLocations") or []:
        x, y = px((l["position"]["x"], l["position"]["y"]))
        d.ellipse([x - 12, y - 12, x + 12, y + 12], fill=(255, 0, 255, 255))
        d.text((x + 14, y - 14), l.get("label", ""), fill=(120, 0, 120, 255))
    out = Path(out) if out else Path(data_root) / sid / "grid_preview.png"
    canvas.convert("RGB").save(out)
    return out


def main(argv: list[str]) -> None:
    sid = argv[0] if argv else __import__("os").environ.get("DEMO_SID", "x37LjPx62VA")
    pkg = build_from_matterport(sid)
    out = save_preview(pkg, sid)
    print(f"preview: {out}")
    for n in pkg.notes:
        print(n)


if __name__ == "__main__":
    main(sys.argv[1:])
