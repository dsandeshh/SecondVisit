"""Annotator (Task 3): landmarks and room labels from panorama faces.

The model only labels what it sees in one 90 degree face (kind, pixel column, confidence, built in or loose,
and the room kind). Code turns the pixel column into a plan bearing (`face_bearing`), ray casts it on the
occupancy grid (`place`), assigns the pano to a room (`pano_room`), clusters observations (`merge`,
`merge_room_labels`) and decides fixed or movable (`fixed_check`).
"""
from __future__ import annotations

import base64
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, TypedDict, get_args

from shapely.geometry import LineString, Point, Polygon

from dr.grid import OccGrid
from dr.package import Entrance, Landmark, LandmarkKind, Room

Vec2 = tuple[float, float]

ROOM_KINDS = ["reception", "waiting", "exam", "office", "restroom", "corridor", "storage", "other"]
LANDMARK_KINDS = set(get_args(LandmarkKind))
FIXED_KINDS = {"desk", "door", "glass_door", "elevator", "stairs", "restroom", "pillar", "water"}
MOVABLE_KINDS = {"seating", "other"}
CLUSTER_M = 1.0
ROOM_SNAP_M = 0.3
ROUTE_NEAR_M = 3.0
LOOK_BUDGET = 60

VISION_PROMPT = (
    "This is one 90 degree view inside a medical office. (1) What kind of room is the camera standing in: "
    "reception, waiting, exam, office, restroom, corridor, storage or other? (2) List visible objects a blind "
    "visitor could use as landmarks or must avoid: desk (reception or check in), counter, door, glass_door, "
    "elevator, stairs, seating, restroom, sign, pillar, water, other. For each, say whether it is built in "
    "(fixed to the wall or floor) or loose. JSON only: {room: {label, confidence 0 to 1}, items: [{kind, label, "
    "x_px (horizontal centre in pixels, 0 to {w}), confidence 0 to 1, built_in true or false}]}."
)


def vision_prompt(width_px: int) -> str:
    return VISION_PROMPT.replace("{w}", str(width_px))


class Observation(TypedDict):
    pano_id: str
    face: int
    bearing_deg: float
    kind: str
    label: str
    confidence: float
    pos: Vec2
    built_in: bool


class RoomObs(TypedDict):
    room_id: str
    pano_id: str
    face: int
    label: str
    confidence: float


# ---------------------------------------------------------------- geometry

def face_bearing(face: int, x_px: float, width_px: int, yaw0_deg: float, clockwise: bool = True) -> float:
    """Plan bearing (0 = +y, clockwise) of pixel column x_px in horizon face 1 to 4."""
    step = 90.0 if clockwise else -90.0
    half = width_px / 2.0
    off = math.degrees(math.atan((x_px - half) / half))
    return (yaw0_deg + step * (face - 1) + off) % 360.0


def pano_yaw_deg(rotation: dict) -> float:
    """Yaw (degrees, counter clockwise about +z) of a pano's skybox from its Matterport rotation quaternion.

    Each pano's skybox is turned by its own rotation, so the plan bearing of face 1's centre for pano p is
    `face_yaw0_deg - pano_yaw_deg(p)`; face_yaw0_deg is the single constant the calibration step confirms.
    """
    return math.degrees(2.0 * math.atan2(float(rotation.get("z", 0.0)), float(rotation.get("w", 1.0))))


def load_pano_yaws(raw_dir: Path) -> dict[str, float]:
    """Per pano yaw from raw/pano_rotations.json (Model API `panoLocations { id rotation { x y z w } }`)."""
    p = Path(raw_dir) / "pano_rotations.json"
    if not p.exists():
        return {}
    locs = json.loads(p.read_text())["model"]["panoLocations"]
    return {q["id"]: pano_yaw_deg(q["rotation"]) for q in locs if q.get("rotation")}


def calibrate_yaw0(pano_pos: Vec2, face: int, x_px: float, width_px: int, target: Vec2,
                   clockwise: bool = True) -> float:
    """The yaw0 that makes `face_bearing` point from the pano at `target` (the human picked desk)."""
    b = math.degrees(math.atan2(target[0] - pano_pos[0], target[1] - pano_pos[1]))
    rest = face_bearing(face, x_px, width_px, 0.0, clockwise)
    return (b - rest) % 360.0


def place(grid: OccGrid, pano_pos: Vec2, bearing_deg: float, max_m: float = 12.0) -> Vec2 | None:
    """Ray cast; the point 0.3 m before the first non free cell, or None (left the grid or nothing in range)."""
    dx, dy = math.sin(math.radians(bearing_deg)), math.cos(math.radians(bearing_deg))
    step = grid.res / 2.0
    h, w = grid.cells.shape
    t = step
    while t <= max_m:
        r, c = grid.world_to_cell((pano_pos[0] + dx * t, pano_pos[1] + dy * t))
        if not (0 <= r < h and 0 <= c < w):
            return None
        if grid.cells[r, c] != 0:
            back = max(t - 0.3, 0.0)
            return (pano_pos[0] + dx * back, pano_pos[1] + dy * back)
        t += step
    return None


def _is_void(room: Room) -> bool:
    return room.label.strip().lower() == "void"


def pano_room(rooms: list[Room], pano_pos: Vec2) -> str | None:
    """The non Void room containing the pano, else the nearest within 0.3 m, else None."""
    pt = Point(pano_pos)
    best, best_d = None, ROOM_SNAP_M
    for room in rooms:
        if _is_void(room) or len(room.polygon) < 3:
            continue
        poly = Polygon(room.polygon)
        if poly.covers(pt):
            return room.id
        d = poly.distance(pt)
        if d <= best_d:
            best, best_d = room.id, d
    return best


# ---------------------------------------------------------------- parsing

def _clip01(v) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    if math.isnan(f):
        return 0.0
    return min(1.0, max(0.0, f))


def _as_bool(v) -> bool:
    if isinstance(v, str):
        return v.strip().lower() in ("true", "yes", "1", "built in", "built_in")
    return bool(v)


def _find_json(text: str) -> dict | None:
    dec = json.JSONDecoder()
    found: list[dict] = []
    for src in (text, re.sub(r'([{,]\s*)([A-Za-z_][A-Za-z_0-9]*)\s*:', r'\1"\2":', text)):
        for m in re.finditer(r"\{", src):
            try:
                obj, _ = dec.raw_decode(src[m.start():])
            except ValueError:
                continue
            if isinstance(obj, dict):
                if "items" in obj or "room" in obj:
                    return obj
                found.append(obj)
    return found[0] if found else None


def _salvage(text: str) -> dict | None:
    """A reply cut off by max_tokens: pull the room and every item that still has a kind and an x_px.
    A missing confidence becomes 0.5 (so it is shown as "possibly"); a missing built_in becomes false."""
    if '"items"' not in text:
        return None
    room = None
    m = re.search(r'"room"\s*:\s*\{[^{}]*?"label"\s*:\s*"([^"]*)"(?:[^{}]*?"confidence"\s*:\s*([\d.]+))?', text)
    if m:
        room = {"label": m.group(1), "confidence": m.group(2) or 0.5}
    items = []
    for chunk in re.split(r'(?=\{\s*"kind")', text):
        k = re.match(r'\{\s*"kind"\s*:\s*"([^"]*)"', chunk)
        x = re.search(r'"x_px"\s*:\s*"?([\d.]+)', chunk)
        if not (k and x):
            continue
        lab = re.search(r'"label"\s*:\s*"([^"]*)"', chunk)
        conf = re.search(r'"confidence"\s*:\s*([\d.]+)', chunk)
        built = re.search(r'"built_in"\s*:\s*(true|false)', chunk)
        items.append({"kind": k.group(1), "label": lab.group(1) if lab else "", "x_px": x.group(1),
                      "confidence": conf.group(1) if conf else 0.5, "built_in": built.group(1) if built else False})
    return {"room": room, "items": items} if (room or items) else None


def parse_vision(text: str) -> dict:
    """Tolerant parse of the vision answer: {room: {label, confidence} | None, items: [...]}."""
    empty = {"room": None, "items": []}
    obj = _find_json(text or "")
    if (obj is None or "items" not in obj) and '"items"' in (text or ""):
        obj = _salvage(text) or obj
    if obj is None:
        return empty
    room = None
    r = obj.get("room")
    if isinstance(r, dict) and r.get("label") is not None:
        label = str(r["label"]).strip().lower()
        room = {"label": label if label in ROOM_KINDS else "other", "confidence": _clip01(r.get("confidence"))}
    items = []
    raw_items = obj.get("items")
    for it in raw_items if isinstance(raw_items, list) else []:
        if not isinstance(it, dict):
            continue
        try:
            x_px = float(it.get("x_px"))
        except (TypeError, ValueError):
            continue
        if math.isnan(x_px):
            continue
        word = str(it.get("kind") or "other").strip().lower().replace(" ", "_")
        if word == "counter":
            kind = "desk"
        elif word in LANDMARK_KINDS:
            kind = word
        else:
            kind = "other"
        label = str(it.get("label") or "").strip() or word.replace("_", " ")
        items.append({"kind": kind, "label": label, "x_px": x_px,
                      "confidence": _clip01(it.get("confidence")),
                      "built_in": _as_bool(it.get("built_in", False))})
    return {"room": room, "items": items}


# ---------------------------------------------------------------- merging

def _clusters(obs: list[Observation]) -> list[tuple[str, list[Observation]]]:
    """Greedy clustering of same kind observations within 1.0 m of the cluster mean; ids kind_1, kind_2..."""
    groups: list[list[Observation]] = []
    for o in obs:
        best, best_d = None, CLUSTER_M
        for g in groups:
            if g[0]["kind"] != o["kind"]:
                continue
            mx = sum(p["pos"][0] for p in g) / len(g)
            my = sum(p["pos"][1] for p in g) / len(g)
            d = math.dist((mx, my), o["pos"])
            if d <= best_d:
                best, best_d = g, d
        if best is None:
            groups.append([o])
        else:
            best.append(o)
    counts: dict[str, int] = {}
    out = []
    for g in groups:
        k = g[0]["kind"]
        counts[k] = counts.get(k, 0) + 1
        out.append((f"{k}_{counts[k]}", g))
    return out


def _panos(g: list[Observation]) -> list[str]:
    return list(dict.fromkeys(o["pano_id"] for o in g))


def merge(obs: list[Observation]) -> list[Landmark]:
    """One Landmark per cluster; confidence = mean model confidence x min(1, panos_seen / 2)."""
    out = []
    for lid, g in _clusters(obs):
        n = len(g)
        conf = sum(o["confidence"] for o in g) / n * min(1.0, len(_panos(g)) / 2.0)
        best = max(g, key=lambda o: o["confidence"])
        out.append(Landmark(id=lid, kind=g[0]["kind"], label=best["label"],
                            pos=(sum(o["pos"][0] for o in g) / n, sum(o["pos"][1] for o in g) / n),
                            confidence=conf, fixed=g[0]["kind"] in FIXED_KINDS))
    return out


def fixed_detail(obs: list[Observation], defurnished_obs: list[Observation] | None) -> dict[str, dict]:
    """Per landmark id: {fixed, src, confidence}. The model may make a movable kind fixed, never the reverse."""
    out: dict[str, dict] = {}
    for lid, g in _clusters(obs):
        kind = g[0]["kind"]
        if defurnished_obs is not None:
            n = len(g)
            c = (sum(o["pos"][0] for o in g) / n, sum(o["pos"][1] for o in g) / n)
            seen = any(d["kind"] == kind and math.dist(d["pos"], c) <= CLUSTER_M for d in defurnished_obs)
            out[lid] = {"fixed": seen, "src": "matterport", "confidence": None}
        elif kind in FIXED_KINDS:
            out[lid] = {"fixed": True, "src": "calc", "confidence": None}
        else:
            built = [o for o in g if o["built_in"]]
            loose = [o for o in g if not o["built_in"]]
            if len(built) * 2 > len(g):
                out[lid] = {"fixed": True, "src": "ai",
                            "confidence": sum(o["confidence"] for o in built) / len(built)}
            else:
                out[lid] = {"fixed": False, "src": "ai",
                            "confidence": sum(o["confidence"] for o in loose) / len(loose)}
    return out


def fixed_check(obs: list[Observation], defurnished_obs: list[Observation] | None) -> dict[str, bool]:
    return {lid: d["fixed"] for lid, d in fixed_detail(obs, defurnished_obs).items()}


def merge_room_labels(obs: list[RoomObs]) -> dict[str, dict]:
    """Per room: majority label over panos (one vote each, its most confident face); ties by max confidence."""
    votes: dict[str, dict[str, RoomObs]] = {}
    for o in obs:
        per = votes.setdefault(o["room_id"], {})
        cur = per.get(o["pano_id"])
        if cur is None or o["confidence"] > cur["confidence"]:
            per[o["pano_id"]] = o
    out = {}
    for rid, per in votes.items():
        by_label: dict[str, list[RoomObs]] = {}
        for v in per.values():
            by_label.setdefault(v["label"], []).append(v)
        label, win = max(by_label.items(), key=lambda kv: (len(kv[1]), max(v["confidence"] for v in kv[1])))
        out[rid] = {"label": label, "confidence": sum(v["confidence"] for v in win) / len(win),
                    "panos": [v["pano_id"] for v in win]}
    return out


# ---------------------------------------------------------------- the annotator's tools

class Annotator:
    """Plain Python tools for the annotator subagent (Task 13 wires them): list_panos, look, record, finish."""

    def __init__(self, sid: str, grid: OccGrid, rooms: list[Room], panos: dict[str, Vec2], faces_dir: Path,
                 out_dir: Path, entrance: Entrance | None = None, routes: dict[str, list[Vec2]] | None = None,
                 yaw0_deg: float = 0.0, clockwise: bool = True, budget: int = LOOK_BUDGET,
                 defurnished_dir: Path | None = None, pano_yaw: dict[str, float] | None = None):
        self.sid, self.grid, self.rooms, self.panos = sid, grid, rooms, panos
        self.faces_dir, self.out_dir = Path(faces_dir), Path(out_dir)
        self.defurnished_dir = Path(defurnished_dir) if defurnished_dir else None
        self.entrance, self.routes = entrance, routes or {}
        self.yaw0, self.clockwise, self.budget = yaw0_deg, clockwise, budget
        self.pano_yaw = pano_yaw or {}
        self.looks = 0
        self.obs: list[Observation] = []
        self.defurnished_obs: list[Observation] = []
        self.room_obs: list[RoomObs] = []
        self.pano_rooms = {pid: pano_room(rooms, pos) for pid, pos in panos.items()}

    def yaw0_for(self, pano_id: str) -> float:
        """Bearing of face 1's centre for this pano: the calibrated constant minus the pano's own yaw."""
        return (self.yaw0 - self.pano_yaw.get(pano_id, 0.0)) % 360.0

    # list_panos ---------------------------------------------------------
    def list_panos(self, route_id: str | None = None) -> list[dict]:
        """Route corridor first (panos within 3 m of the route), then the rest by distance from the entrance."""
        ent = self.entrance.pos if self.entrance else None
        path = self.routes.get(route_id) if route_id else None
        line = LineString(path) if path and len(path) >= 2 else (Point(path[0]) if path else None)
        rows = []
        for pid, pos in self.panos.items():
            on = line is not None and line.distance(Point(pos)) <= ROUTE_NEAR_M
            d = math.dist(ent, pos) if ent else 0.0
            rows.append({"pano_id": pid, "pos": pos, "room_id": self.pano_rooms[pid], "on_route": on,
                         "dist_m": round(d, 1)})
        rows.sort(key=lambda r: (not r["on_route"], r["dist_m"]))
        return rows

    # look ---------------------------------------------------------------
    def _face_path(self, pano_id: str, face: int, view: str) -> Path | None:
        base = self.faces_dir if view == "furnished" else self.defurnished_dir
        if base is None:
            return None
        p = base / f"{pano_id}_{face}.jpg"
        return p if p.exists() else None

    def look(self, pano_id: str, face: int, view: str = "furnished") -> dict | str:
        """The cached face image as an image block, or an error string (budget, unknown pano, no view)."""
        if self.looks >= self.budget:
            return f"Error: look budget of {self.budget} spent. Call finish()."
        if pano_id not in self.panos or face not in (1, 2, 3, 4):
            return f"Error: no pano {pano_id!r} face {face!r}. Faces are 1 to 4."
        if view not in ("furnished", "defurnished"):
            return "Error: view must be 'furnished' or 'defurnished'."
        p = self._face_path(pano_id, face, view)
        if p is None:
            return f"Error: no {view} view cached for {pano_id} face {face}."
        self.looks += 1
        return {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                            "data": base64.b64encode(p.read_bytes()).decode("ascii")}}

    # record -------------------------------------------------------------
    def _width(self, pano_id: str, face: int, view: str) -> int:
        from PIL import Image
        p = self._face_path(pano_id, face, view)
        if p is None:
            return 2048
        with Image.open(p) as im:
            return im.width

    def record(self, pano_id: str, face: int, items_json: str, width_px: int | None = None,
               view: str = "furnished") -> str:
        if pano_id not in self.panos:
            return f"Error: no pano {pano_id!r}."
        parsed = parse_vision(items_json)
        w = width_px or self._width(pano_id, face, view)
        pos0 = self.panos[pano_id]
        target = self.obs if view == "furnished" else self.defurnished_obs
        placed, missed = 0, 0
        for it in parsed["items"]:
            b = face_bearing(face, it["x_px"], w, self.yaw0_for(pano_id), self.clockwise)
            p = place(self.grid, pos0, b)
            if p is None:
                missed += 1
                continue
            target.append(Observation(pano_id=pano_id, face=face, bearing_deg=round(b, 1), kind=it["kind"],
                                      label=it["label"], confidence=it["confidence"],
                                      pos=(round(p[0], 2), round(p[1], 2)), built_in=it["built_in"]))
            placed += 1
        room_note = ""
        rid = self.pano_rooms.get(pano_id)
        if parsed["room"] is not None and rid is not None and view == "furnished":
            self.room_obs.append(RoomObs(room_id=rid, pano_id=pano_id, face=face, **parsed["room"]))
            room_note = f" Room {rid}: {parsed['room']['label']}."
        return (f"Recorded {placed} landmark observations from {pano_id} face {face}"
                f"{f', {missed} not placed (no wall within 12 m)' if missed else ''}.{room_note}"
                f" Looks left: {self.budget - self.looks}.")

    # coverage -----------------------------------------------------------
    def status(self, route_id: str | None = None) -> dict:
        """What is still uncovered: route segments without a landmark within 1.5 m, rooms without an answer."""
        lms = merge(self.obs)
        segs_open = []
        path = self.routes.get(route_id) if route_id else None
        for i, (a, b) in enumerate(zip(path or [], (path or [])[1:])):
            seg = LineString([a, b])
            if not any(seg.distance(Point(lm.pos)) <= 1.5 for lm in lms):
                segs_open.append(i)
        answered = {o["room_id"] for o in self.room_obs}
        rooms_open = sorted({r for r in self.pano_rooms.values() if r is not None} - answered)
        return {"looks_left": self.budget - self.looks, "segments_without_landmark": segs_open,
                "rooms_without_label": rooms_open,
                "done": (not segs_open and not rooms_open) or self.looks >= self.budget}

    # finish -------------------------------------------------------------
    def finish(self) -> str:
        """Merge, label rooms, decide fixed; write landmarks.json (for the package builder) and landmarks.md."""
        at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        lms = merge(self.obs)
        fx = fixed_detail(self.obs, self.defurnished_obs if self.defurnished_obs else None)
        groups = dict(_clusters(self.obs))
        prov: dict[str, dict] = {}
        for lm in lms:
            d = fx[lm.id]
            lm.fixed = d["fixed"]
            ref = ",".join(f"pano:{p}" for p in _panos(groups[lm.id]))
            prov[f"landmark:{lm.id}"] = {"src": "ai", "ref": ref, "at": at, "confidence": round(lm.confidence, 3)}
            fp = {"src": d["src"], "ref": ref if d["src"] != "calc" else f"kind:{lm.kind}", "at": at}
            if d["confidence"] is not None:
                fp["confidence"] = round(d["confidence"], 3)
            prov[f"landmark:{lm.id}.fixed"] = fp
        labels = merge_room_labels(self.room_obs)
        for rid, r in labels.items():
            prov[f"room:{rid}.label"] = {"src": "ai", "ref": ",".join(f"pano:{p}" for p in r["panos"]),
                                         "at": at, "confidence": round(r["confidence"], 3)}
        data = {"sid": self.sid, "generated_at": at, "looks": self.looks, "yaw0_deg": self.yaw0,
                "faces_clockwise": self.clockwise,
                "landmarks": [lm.model_dump(mode="json") for lm in lms],
                "rooms": labels, "observations": self.obs, "room_observations": self.room_obs, "prov": prov}
        self.out_dir.mkdir(parents=True, exist_ok=True)
        (self.out_dir / "landmarks.json").write_text(json.dumps(data, indent=1))
        md = self._markdown(lms, fx, labels)
        (self.out_dir / "landmarks.md").write_text(md)
        return md

    def _markdown(self, lms: list[Landmark], fx: dict[str, dict], labels: dict[str, dict]) -> str:
        lines = [f"# Landmarks for {self.sid}", "",
                 f"{self.looks} looks of {self.budget}. Face yaw0 {self.yaw0} degrees, "
                 f"faces {'clockwise' if self.clockwise else 'counter clockwise'}.", "",
                 "## Rooms", "", "| room | label | confidence | panos |", "|---|---|---|---|"]
        for room in self.rooms:
            if _is_void(room):
                continue
            r = labels.get(room.id)
            if r:
                word = r["label"] if r["confidence"] >= 0.6 else f"possibly {r['label']}"
                lines.append(f"| {room.id} | {r['label']} | {r['confidence']:.2f} AI ({word}) | "
                             f"{', '.join(r['panos'])} |")
            else:
                lines.append(f"| {room.id} | {room.label} | MP | |")
        lines += ["", "## Landmarks", "", "| id | kind | label | x | y | confidence | fixed |",
                  "|---|---|---|---|---|---|---|"]
        for lm in lms:
            lines.append(f"| {lm.id} | {lm.kind} | {lm.label} | {lm.pos[0]:.2f} | {lm.pos[1]:.2f} | "
                         f"{lm.confidence:.2f} | {'yes' if lm.fixed else 'no'} ({fx[lm.id]['src']}) |")
        return "\n".join(lines) + "\n"


def see(ann: Annotator, pano_id: str, face: int, vision: Callable[[dict, str], str]) -> str:
    """Script helper (Step 6 without the agent): look, ask the vision function, record."""
    img = ann.look(pano_id, face)
    if isinstance(img, str):
        return img
    w = ann._width(pano_id, face, "furnished")
    return ann.record(pano_id, face, vision(img, vision_prompt(w)), width_px=w)
