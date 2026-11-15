"""Automatic entrance and destination pins for a building no human has reviewed yet.

    python -m dr.autopins SID      (run once before the annotator, once after it)

Writes into data/<sid>/overrides.json only what is missing; a human pin (pick.html) is never replaced.
Every value written here is `calc` (code over AI landmarks and the scan's own data) and says "assumed"
in its ref, never HAND (CLAUDE.md rule 8).

Rules, each checked on two buildings (the clinic, where a human confirmed the pins, and Office B):
- face_yaw0_deg 90, faces clockwise: the Matterport skybox convention once each pano's own yaw
  (raw/pano_rotations.json) is applied. The clinic's human calibration gave 90; Office B's centre column
  lands where this predicts.
- Entrance: Matterport scans start where the operator walks in, so the first scan (pano label "0", else
  the pano nearest the model origin) sits by the entrance. The entrance is the glass door (else door)
  landmark on the suite's outer wall nearest that first scan, facing that first scan (else the
  outline's inward normal). On the clinic this picks the human's door and heading 265 (human 270).
- Destination: the first kind a visitor most often comes for (desk, then restroom, then elevator), the
  most confident one at least MIN_DEST_M from the entrance.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

from shapely.geometry import LineString, Point, Polygon

from dr.package import Landmark, Room

Vec2 = tuple[float, float]
MP_FACE_YAW0_DEG = 90.0
ON_OUTLINE_M = 1.0   # a door landmark this close to the outer wall is an outside door
MIN_DEST_M = 3.0     # a destination closer to the entrance than this is no route
FACE_FIRST_SCAN_M = 8.0  # within this, the entrance faces the first scan (the operator's way in)
ENTRANCE_KINDS = ("glass_door", "door")
DEST_KINDS = ("desk", "restroom", "elevator")


def first_pano(panos: dict[str, dict]) -> Vec2 | None:
    """Position of the first scan: the lowest numeric pano label, else the pano nearest the model origin."""
    num = [(int(p["label"]), tuple(p["pos"])) for p in panos.values() if str(p.get("label", "")).isdigit()]
    if num:
        return min(num)[1]
    if not panos:
        return None
    return min((tuple(p["pos"]) for p in panos.values()), key=lambda q: math.hypot(*q))


def _outline(rooms: list[Room]) -> Polygon | None:
    from dr.arrival import building_outline
    ring = building_outline(rooms)
    return Polygon(ring) if ring and len(ring) >= 4 else None


def _inward_heading(poly: Polygon, p: Vec2) -> float:
    """Compass heading (0 = +y, clockwise) of the outline's inward normal at the edge nearest p."""
    cs = list(poly.exterior.coords)
    a, b = min(zip(cs, cs[1:]), key=lambda s: LineString(s).distance(Point(p)) if s[0] != s[1] else 1e9)
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / L, dx / L
    seg = LineString([a, b])
    f = seg.interpolate(seg.project(Point(p)))  # foot on the wall: test the side from there, not from p
    if not poly.contains(Point(f.x + 0.2 * nx, f.y + 0.2 * ny)):
        nx, ny = -nx, -ny
    return round(math.degrees(math.atan2(nx, ny)) % 360.0, 1)


def pick_entrance(landmarks: list[Landmark], rooms: list[Room], first: Vec2 | None) -> dict | None:
    poly = _outline(rooms)
    if poly is None:
        return None
    ring = poly.exterior
    for kind in ENTRANCE_KINDS:
        cands = [lm for lm in landmarks if lm.kind == kind and ring.distance(Point(lm.pos)) <= ON_OUTLINE_M]
        if not cands:
            continue
        key = (lambda lm: math.dist(lm.pos, first)) if first else (lambda lm: -lm.confidence)
        best = min(cands, key=key)
        if first and 0.3 < math.dist(best.pos, first) <= FACE_FIRST_SCAN_M:
            heading = round(math.degrees(math.atan2(first[0] - best.pos[0], first[1] - best.pos[1])) % 360.0, 1)
        else:
            heading = _inward_heading(poly, best.pos)
        return {"landmark_id": best.id, "pos": (round(best.pos[0], 2), round(best.pos[1], 2)),
                "heading_deg": heading, "confidence": best.confidence}
    return None


def pick_destination(landmarks: list[Landmark], entrance: Vec2) -> dict | None:
    for kind in DEST_KINDS:
        cands = [lm for lm in landmarks if lm.kind == kind and math.dist(lm.pos, entrance) >= MIN_DEST_M]
        if cands:
            best = max(cands, key=lambda lm: lm.confidence)
            return {"landmark_id": best.id, "kind": kind, "confidence": best.confidence}
    return None


def _panos(raw: Path) -> dict[str, dict]:
    p = raw / "panos.json"
    if not p.exists():
        return {}
    locs = json.loads(p.read_text())["model"].get("panoLocations") or []
    return {q["id"]: {"label": q.get("label", ""), "pos": (float(q["position"]["x"]), float(q["position"]["y"]))}
            for q in locs if q.get("position")}


def auto_overrides(sid: str, rooms: list[Room] | None = None, data_root: Path | None = None) -> dict:
    """Fill the missing face calibration, entrance and destination in data/<sid>/overrides.json; return it."""
    from dr.mp_import import DATA, build_from_matterport
    d = Path(data_root or DATA) / sid
    raw = d / "raw"
    p = d / "overrides.json"
    ov = json.loads(p.read_text()) if p.exists() else {}
    notes = dict(ov.get("auto_pins") or {})
    if "face_yaw0_deg" not in ov and (raw / "pano_rotations.json").exists():
        ov["face_yaw0_deg"], ov["faces_clockwise"] = MP_FACE_YAW0_DEG, True
        notes["face_yaw0_deg"] = ("calc: Matterport skybox convention with per pano yaw "
                                  "(human calibrated on the clinic); assumed for this model")
    lp = d / "landmarks.json"
    lms = [Landmark.model_validate(x) for x in json.loads(lp.read_text()).get("landmarks", [])] if lp.exists() else []
    if lms:
        if rooms is None:
            rooms = build_from_matterport(sid, Path(data_root or DATA)).rooms
        first = first_pano(_panos(raw))
        if not ov.get("entrance"):
            e = pick_entrance(lms, rooms, first)
            if e:
                ov["entrance"] = {"id": "ent_main", "label": "Main entrance", "pos": list(e["pos"]),
                                  "heading_deg": e["heading_deg"], "src": "calc",
                                  "ref": (f"assumed: {e['landmark_id']} (AI {e['confidence']:.2f}) on the outer wall "
                                          f"nearest the first scan; not confirmed by a human")}
                notes["entrance"] = ov["entrance"]["ref"]
        if not ov.get("destination") and ov.get("entrance"):
            t = pick_destination(lms, tuple(ov["entrance"]["pos"]))
            if t:
                ov["destination"] = {"landmark_id": t["landmark_id"]}
                notes["destination"] = (f"assumed: the most confident {t['kind']} landmark (AI {t['confidence']:.2f}), "
                                        f"no desk seen; not confirmed by a human" if t["kind"] != "desk" else
                                        f"assumed: the most confident desk landmark (AI {t['confidence']:.2f}); "
                                        f"not confirmed by a human")
    if notes:
        ov["auto_pins"] = notes
    d.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(ov, indent=2) + "\n")
    return ov


if __name__ == "__main__":
    print(json.dumps(auto_overrides(sys.argv[1]), indent=2))
