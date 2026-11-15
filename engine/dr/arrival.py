"""Task 15: arrival from Vexcel. Ortho image, human pins (HAND) and the spoken curb summary.

Offline except vexcel_ortho when no cached image exists. Pins come from overrides.json:
{"arrival": {"door_lat", "door_lon", "curb_lat", "curb_lon"}}. `confirmed` needs both.
Arrival.dropoff is [lat, lon] of the curb pin (Vec2 reused). Contract additions (R6): curb_to_door_m,
dropoff_plan. entrance_side is a compass word, or "unknown" until a pin or CS frontage hint exists.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from datetime import date

from dr import geo, probe
from dr.config import STEP_M
from dr.mp_client import ROOT
from dr.grounding import grounded
from dr.package import Arrival, ArrivalCue, ArrivalOblique, ArrivalOrtho, GeoAnchor, Prov
from dr.prov import ProvBuilder
from dr.probe import VexcelCoverageError, vexcel_ortho_body

__all__ = ["VexcelCoverageError", "vexcel_ortho", "vexcel_ortho_body", "arrival", "build", "ArrivalResult"]

SIDES = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"]
ORTHO_HALF_M = 30.0  # one half side for fetch, pixel mapping and prov; the cached raw/vexcel_ortho.jpg is a 60 m square
R_EARTH = 6_371_000.0
PIN_KEYS = ("door_lat", "door_lon", "curb_lat", "curb_lon")


def vexcel_ortho(lat: float, lon: float, half_m: float | None = None, px: int = 1400, client=None) -> bytes:
    return probe.vexcel_ortho(lat, lon, ORTHO_HALF_M if half_m is None else half_m, px, client=client)


def bearing_deg(lat1, lon1, lat2, lon2) -> float:
    p1, p2, dl = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return math.degrees(math.atan2(y, x)) % 360


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * R_EARTH * math.asin(math.sqrt(a))


def side_from_bearing(deg: float) -> str:
    return SIDES[int(((deg % 360) + 22.5) // 45) % 8]


def clock_hour(rel_deg: float) -> int:
    rel = (rel_deg + 180) % 360 - 180
    return round(rel / 30) % 12 or 12


def px_to_latlon(x: float, y: float, lat: float, lon: float, half_m: float = ORTHO_HALF_M, px: int = 1400):
    """Pixel (x right, y down) in the ortho to lat, lon. For pick.html pin clicks."""
    m = 2 * half_m / px
    east, north = (x - px / 2) * m, (px / 2 - y) * m
    return lat + north / 111_320, lon + east / (111_320 * math.cos(math.radians(lat)))


def curb_summary(curb_to_door_m: float, hour: int) -> str:
    steps = max(1, round(curb_to_door_m / STEP_M))
    return f"From the drop off, the entrance is about {steps} steps {hour} o'clock."


@dataclass
class ArrivalResult:
    arrival: Arrival
    curb_to_door_m: float | None = None
    curb_summary: str | None = None
    prov: dict[str, Prov] = field(default_factory=dict)
    geo_anchor: GeoAnchor | None = None  # for BuildingPackage.frames.geo_anchor


def _pins(overrides: dict | None) -> dict | None:
    a = (overrides or {}).get("arrival", overrides or {}) or {}
    return {k: float(a[k]) for k in PIN_KEYS} if all(a.get(k) is not None for k in PIN_KEYS) else None


def _frontage_hint(costar: dict, lat: float, lon: float) -> str | None:
    fr = (((costar.get("property") or {}).get("propertyRetail") or {}).get("frontage")) or []
    fr = sorted(fr, key=lambda f: not f.get("isPrimaryFrontage"))
    for f in fr:
        pts = (((f.get("footprint") or {}).get("shape") or {}).get("coordinates")) or []
        if pts:
            mlon = sum(p[0] for p in pts) / len(pts)
            mlat = sum(p[1] for p in pts) / len(pts)
            return side_from_bearing(bearing_deg(lat, lon, mlat, mlon))
    return None


def building_outline(rooms) -> list[tuple[float, float]] | None:
    """The suite from the scan: union of the room polygons (plan metres), outer ring. Not the whole building."""
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    polys = [Polygon(r.polygon).buffer(0.05) for r in rooms if len(r.polygon) >= 3]
    if not polys:
        return None
    u = unary_union(polys)
    if u.geom_type == "MultiPolygon":
        u = max(u.geoms, key=lambda g: g.area)
    return [(round(x, 3), round(y, 3)) for x, y in u.exterior.coords]


def facade_bearing(overrides: dict | None, costar: dict | None) -> tuple[float, str, str] | None:
    """(compass bearing of the entrance facade edge, prov src, ref). HAND/calc line first, else CoStar frontage."""
    o = overrides or {}
    if o.get("facade_bearing_deg") is not None:
        return float(o["facade_bearing_deg"]), o.get("facade_bearing_src") or "hand", \
            o.get("facade_bearing_ref") or "overrides.json facade_bearing_deg"
    fr = ((((costar or {}).get("property") or {}).get("propertyRetail") or {}).get("frontage")) or []
    for f in sorted(fr, key=lambda f: not f.get("isPrimaryFrontage")):
        pts = (((f.get("footprint") or {}).get("shape") or {}).get("coordinates")) or []
        if len(pts) >= 2:
            return bearing_deg(pts[0][1], pts[0][0], pts[-1][1], pts[-1][0]), "costar", \
                "propertyRetail.frontage[].footprint LineString bearing"
    return None


def _vec(anchor: GeoAnchor, compass: float) -> tuple[float, float]:
    """Plan unit vector pointing along a compass bearing."""
    x, y = geo.enToPlan(anchor, math.sin(math.radians(compass)), math.cos(math.radians(compass)))
    return x - anchor.plan_pos[0], y - anchor.plan_pos[1]


def _wall_hit(curb, heading_vec, door, wall_dir):
    """Signed offset (m) along the entrance wall, from the door, where a ray from the curb meets the wall line."""
    px, py = curb[0] - door[0], curb[1] - door[1]
    hx, hy = heading_vec
    wx, wy = wall_dir
    den = hx * wy - hy * wx
    if abs(den) < 1e-9:
        return None
    t = (-px * wy + py * wx) / den  # curb + t*h = door + u*w
    u = (px + t * hx) * wx + (py + t * hy) * wy
    return (t, u) if t > 0 else None


DOOR_BEACON_LINE = "Press B to hear the door."   # B outdoors: the door beacon (web outdoor controller)


def curb_script(anchor: GeoAnchor, entrance, curb_plan, door_plan, ov: dict, side: str, costar: dict | None):
    """Lines 1 to 8 and recovery lines, computed from the geometry (agent6 4.1.6). Every line passes grounded()."""
    ov = ov or {}
    walk_vec = (math.cos(math.radians(90 - entrance.heading_deg)), math.sin(math.radians(90 - entrance.heading_deg)))
    ref = ov.get("reference_bearing_deg")
    ref_src = "hand"
    if ref is None:
        # facing the building, perpendicular to the facade; HAND when a human confirmed it
        ref, ref_src = geo.plan_bearing(anchor, *walk_vec), ("hand" if ov.get("reference_confirmed") else "calc")
    words = ov.get("reference_words") or ("facing the building" if ov.get("reference_bearing_deg") is None else "")
    dx, dy = door_plan[0] - curb_plan[0], door_plan[1] - curb_plan[1]
    walk_m = math.hypot(dx, dy)
    steps = max(1, round(walk_m / STEP_M))
    hour = geo.clockOf(geo.plan_bearing(anchor, dx, dy), ref)
    allowed: set[float] = {float(steps), float(hour)}
    lines: list[str] = []
    cues: list[ArrivalCue] = []
    recovery: list[str] = []
    at = date.today().isoformat()

    def prov(src, ref_text, conf=None):
        return Prov(src=src, ref=ref_text, at=at, confidence=conf)

    lines.append(f"You are at the drop off, on the {side} side of the building.")
    lines.append(f"Face the building{', ' + words.removeprefix('facing the building').strip() if words and words != 'facing the building' else ''}. "
                 f"The entrance is at {hour} o'clock, about {steps} steps.")
    lines.append(DOOR_BEACON_LINE)
    # traffic: the CoStar frontage line, relative to the reference (CS, simulated sound)
    traffic_rel = None
    fr = ((((costar or {}).get("property") or {}).get("propertyRetail") or {}).get("frontage")) or []
    for f in fr:
        pts = (((f.get("footprint") or {}).get("shape") or {}).get("coordinates")) or []
        if len(pts) >= 2:
            ends = [geo.geoToPlan(anchor, p[1], p[0]) for p in pts]
            (ax, ay), (bx, by) = ends[0], ends[-1]
            vx, vy = bx - ax, by - ay
            t = max(0.0, min(1.0, ((curb_plan[0] - ax) * vx + (curb_plan[1] - ay) * vy) / (vx * vx + vy * vy or 1)))
            nx, ny = ax + t * vx, ay + t * vy
            d = math.hypot(nx - curb_plan[0], ny - curb_plan[1])
            if d <= 60:
                traffic_rel = (geo.plan_bearing(anchor, nx - curb_plan[0], ny - curb_plan[1]) - ref + 540) % 360 - 180
                where = ("behind you" if abs(traffic_rel) >= 120 else "ahead of you" if abs(traffic_rel) <= 60
                         else "on your right" if traffic_rel > 0 else "on your left")
                street = f.get("streetName") if ov.get("street_confirmed") else None
                line = f"Traffic from {street or 'the street'} is {where}."
                lines.append(line)
                cues.append(ArrivalCue(id="traffic", kind="traffic", plan=[(round(nx, 2), round(ny, 2))],
                                       prov=prov("costar", "propertyRetail.frontage[] nearest point; sound simulated", 0.5), line=line))
                break
    lane = ov.get("crosses_drive_lane")
    if lane:
        lines.append("Before the entrance you reach a lane where cars drive. Stop, listen, then cross.")
    elif lane is None:
        lines.append("Listen for cars before you cross.")
    edge = {"flush": "The walkway is level with the aisle.",
            "curb_ramp": "A curb ramp takes you up onto the walkway.",
            "step_up": "There is a step up onto the walkway."}.get(
        ov.get("edge_type") or "unknown", "Feel for a change in the ground with your cane.")
    lines.append(edge)
    canopy = ov.get("canopy")
    if not canopy and (ov.get("arrival") or {}).get("canopy"):
        canopy = [[round(v, 3) for v in geo.geoToPlan(anchor, la, lo)] for lo, la in ov["arrival"]["canopy"]]
        ov = {**ov, "canopy": canopy}
    if canopy:
        lines.append("You are under the canopy now. The door is straight ahead.")
        cues.append(ArrivalCue(id="canopy", kind="canopy", plan=[tuple(p) for p in ov["canopy"]],
                               prov=prov("calc", "assumed: canopy traced by Claude from Vexcel imagery (overrides.json arrival.canopy)", 0.4)
                               if (ov.get("arrival") or {}).get("canopy") else prov("hand", "overrides.json canopy")))
    lines.append({"automatic_sliding": "The doors slide open by themselves.",
                  "automatic_swing": "The door opens by itself. Stand back from it as it swings.",
                  "push": "Push the door; the handle is on the right.",
                  "pull": "Pull the door; the handle is on the right."}.get(
        ov.get("door_type") or "unknown", "Find the door handle with your hand; the door may be heavy."))
    lines.append("You are inside. Your rehearsal continues from the entrance.")
    cues.append(ArrivalCue(id="door", kind="door", plan=[tuple(door_plan)], prov=prov("hand", "overrides.json arrival door pin")))

    # recovery: what would I hit if I turned wrong
    wall_dir = (-walk_vec[1], walk_vec[0])
    for sign in (-30, 30):
        h = _vec(anchor, ref + sign)
        hit = _wall_hit(curb_plan, h, door_plan, wall_dir)
        if hit and hit[0] < 40:
            off = hit[1]
            n = round(abs(off) / STEP_M)
            if n >= 1:
                # facing the wall, the door is to the right when it lies clockwise of the heading from the hit point
                to_door = (-off * wall_dir[0], -off * wall_dir[1])
                cross = walk_vec[0] * to_door[1] - walk_vec[1] * to_door[0]
                side_w = "left" if cross > 0 else "right"
                recovery.append(f"If you touch the building wall and find no door, trail the wall to your {side_w} "
                                f"about {n} steps to the entrance.")
                allowed.add(float(n))
    if traffic_rel is not None and abs(traffic_rel) >= 120:
        recovery.append("If the traffic sound is in front of you, you are facing the road. Turn around.")
        recovery.append("If you lose your way, stop and turn until the traffic is behind you, then walk toward the building.")
    lines = [x for x in lines if grounded(x, allowed)]
    recovery = [x for x in recovery if grounded(x, allowed)]
    return dict(lines=lines, recovery=recovery, cues=cues, steps=steps, clock=hour, walk_m=walk_m,
                canopy=canopy, reference_bearing_deg=ref, reference_words=words or None, ref_src=ref_src)


def ortho_corners(anchor: GeoAnchor, lat: float, lon: float):
    """The cached ortho was requested with vexcel_ortho_body(lat, lon, ORTHO_HALF_M); rebuild its WKT and map the
    SW, SE, NE, NW corners into the plan frame."""
    import re
    wkt = probe.vexcel_ortho_body(lat, lon, ORTHO_HALF_M)["wkt"]
    ring = [tuple(map(float, m.split())) for m in re.findall(r"(-?[\d.]+ -?[\d.]+)", wkt)][:4]  # (lon, lat)
    return wkt, [tuple(round(v, 3) for v in geo.geoToPlan(anchor, la, lo)) for lo, la in ring]


def build(sid: str, overrides: dict | None = None, data_dir=None, web_dir=None, fetch=None,
          entrance=None, outline=None) -> ArrivalResult:
    """fetch(lat, lon, half_m) -> jpeg bytes, used only when raw/vexcel_ortho.jpg is not cached."""
    data = (data_dir or ROOT / "data") / sid
    raw = data / "raw"
    model = json.loads((raw / "basics.json").read_text())["model"]
    lat, lon = float(model["geolocation"]["lat"]), float(model["geolocation"]["long"])
    name, address = model.get("name") or "the building", (model.get("address") or {}).get("address") or ""
    at = date.today().isoformat()
    pb = ProvBuilder(at)
    prov = pb.entries

    cached = raw / "vexcel_ortho.jpg"
    img = cached.read_bytes() if cached.exists() else (fetch or vexcel_ortho)(lat, lon, ORTHO_HALF_M)
    out = (web_dir or ROOT / "web" / "public" / "buildings") / sid
    out.mkdir(parents=True, exist_ok=True)
    (out / "arrival.jpg").write_bytes(img)
    pb.add("arrival.image", src="vexcel", ref=f"ortho/extract {2 * ORTHO_HALF_M:.0f} m square at {lat:.6f},{lon:.6f}")

    costar_p = raw / "costar.json"
    hint = _frontage_hint(json.loads(costar_p.read_text()), lat, lon) if costar_p.exists() else None
    pins = _pins(overrides)
    curb_m = summary = plan = None
    if pins:
        side = side_from_bearing(bearing_deg(lat, lon, pins["door_lat"], pins["door_lon"]))
        curb_m = haversine_m(pins["curb_lat"], pins["curb_lon"], pins["door_lat"], pins["door_lon"])
        facing = bearing_deg(pins["curb_lat"], pins["curb_lon"], lat, lon)
        to_door = bearing_deg(pins["curb_lat"], pins["curb_lon"], pins["door_lat"], pins["door_lon"])
        summary = curb_summary(curb_m, clock_hour(to_door - facing))
        dropoff = [pins["curb_lat"], pins["curb_lon"]]
        plan = [(pins["curb_lon"] - lon) * 111_320 * math.cos(math.radians(lat)), (pins["curb_lat"] - lat) * 111_320]
        pb.add("arrival.entrance_side", src="calc", ref="bearing model centre to door pin",
                                             inputs=["arrival.door_pin", "arrival.image"])
        pb.add("arrival.door_pin", src="hand", ref="overrides.json arrival.door_lat/door_lon")
        pb.add("arrival.dropoff", src="hand", ref="overrides.json arrival.curb_lat/curb_lon")
        pb.add("arrival.curb_to_door_m", src="calc", ref="haversine curb pin to door pin",
                                              inputs=["arrival.door_pin", "arrival.dropoff"])
    else:
        side = hint or "unknown"
        dropoff = [lat, lon]
        if hint:
            pb.add("arrival.entrance_side", src="costar", ref="propertyRetail.frontage[].footprint",
                                                 confidence=0.5)
    where = "the main" if side == "unknown" else f"the {side}"
    msg = f"Please drop me at {where} entrance of {name}, {address}."
    anchor = GeoAnchor(lat=lat, lon=lon, plan_pos=[0.0, 0.0], plan_north_deg=0.0)
    pb.add("frames.geo_anchor", src="calc", ref="assumed: model lat/lon at plan origin, plan north = true north", confidence=0.3)
    anchored = False
    fb = facade_bearing(overrides, json.loads(costar_p.read_text()) if costar_p.exists() else None)
    if pins and entrance is not None and fb is not None:
        door_en = (0.0, 0.0)
        probe_a = GeoAnchor(lat=pins["door_lat"], lon=pins["door_lon"], plan_pos=(0.0, 0.0), plan_north_deg=0.0)
        curb_en = geo.geoToEN(probe_a, pins["curb_lat"], pins["curb_lon"])
        t = geo.solve_north(entrance.pos, entrance.heading_deg, fb[0], curb_en, door_en)
        anchor = GeoAnchor(lat=pins["door_lat"], lon=pins["door_lon"], plan_pos=tuple(entrance.pos), plan_north_deg=round(t, 2))
        prov.pop("frames.geo_anchor", None)
        pb.add("frames.geo_anchor", src="calc", confidence=0.5, inputs=["arrival.door_pin", "arrival.dropoff"],
               ref=f"assumed until verified: plan_north_deg {t:.1f} = entrance wall alpha + facade bearing "
                   f"{fb[0]:.1f} ({fb[2]}); 180 degrees resolved by the curb pin in front of the entrance")
        curb_plan = list(geo.geoToPlan(anchor, pins["curb_lat"], pins["curb_lon"]))
        plan = curb_plan
        anchored = True
    extra: dict = {}
    if anchored:
        ov = overrides or {}
        costar = json.loads(costar_p.read_text()) if costar_p.exists() else None
        sc = curb_script(anchor, entrance, curb_plan, list(entrance.pos), ov, side, costar)
        wkt, corners = ortho_corners(anchor, lat, lon)
        (out / "arrival_ortho.json").write_text(json.dumps({"wkt": wkt, "srid": 4326, "half_m": ORTHO_HALF_M,
                                                            "corners_plan": corners}) + "\n")
        pb.add("arrival.curb", src="hand", ref="overrides.json arrival curb pin", inputs=["arrival.dropoff"])
        pb.add("arrival.door", src="hand", ref="overrides.json arrival door pin; plan position = entrance.pos")
        pb.add("arrival.walk_m", src="calc", ref="haversine curb pin to door pin", inputs=["arrival.curb", "arrival.door"])
        pb.add("arrival.clock", src="calc", ref=f"clock of door bearing relative to reference {sc['reference_bearing_deg']:.1f} "
               f"({'HAND' if sc['ref_src'] == 'hand' else 'assumed: perpendicular to the facade'})", inputs=["arrival.walk_m"])
        pb.add("arrival.ortho", src="vexcel", ref=f"ortho/extract {2 * ORTHO_HALF_M:.0f} m square, corners mapped by geo_anchor")
        if sc["canopy"]:
            pb.add("arrival.canopy", src="calc", confidence=0.4, ref="assumed: canopy traced by Claude from Vexcel imagery "
                   "(oblique-east cross-checked against the ortho); not human confirmed")
        for k, v in (("edge_type", "edge_type"), ("door_type", "door_type"), ("crosses_drive_lane", "crosses_drive_lane")):
            if ov.get(v) is not None:
                pb.add(f"arrival.{k}", src="hand", ref=f"overrides.json {v}")
        extra = dict(
            curb_plan=tuple(curb_plan), door_plan=tuple(entrance.pos), walk_m=sc["walk_m"], steps=sc["steps"],
            clock=sc["clock"], reference_bearing_deg=sc["reference_bearing_deg"], reference_words=sc["reference_words"],
            crosses_drive_lane=ov.get("crosses_drive_lane"), edge_type=ov.get("edge_type"),
            door_type=ov.get("door_type"), canopy_plan=[tuple(p) for p in sc["canopy"]] if sc["canopy"] else None,
            building_outline_plan=[tuple(p) for p in outline] if outline else None,
            ortho=ArrivalOrtho(url=f"/buildings/{sid}/arrival.jpg", wkt=wkt, corners_plan=corners),
            cues=sc["cues"], lines=sc["lines"], recovery=sc["recovery"])
        od = ov.get("oblique_dir")
        if od and (raw / f"oblique_{od}.png").exists():
            import shutil
            shutil.copyfile(raw / f"oblique_{od}.png", out / f"oblique_{od}.png")
            extra["oblique"] = ArrivalOblique(url=f"/buildings/{sid}/oblique_{od}.png", product_type=f"oblique-{od}",
                                              capture_date="2026-01")
            pb.add("arrival.oblique", src="vexcel", ref=f"oriented/extract oblique-{od}, 30 m buffer, crosshair at the door pin")
        if outline:
            pb.add("arrival.building_outline", src="matterport", ref="suite from the scan: union of room polygons, not the whole building")
    arr = Arrival(lat=lat, lon=lon, entrance_side=side, dropoff=dropoff, driver_message=msg,
                  image_url=f"/buildings/{sid}/arrival.jpg", confirmed=pins is not None,
                  curb_to_door_m=curb_m, dropoff_plan=plan, **extra)
    return ArrivalResult(arr, curb_m, summary, prov, anchor)


def arrival(sid: str, overrides: dict | None = None, **kw) -> Arrival:
    return build(sid, overrides, **kw).arrival
