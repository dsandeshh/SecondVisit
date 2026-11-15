"""Task 15: arrival from Vexcel. Ortho image, human pins (HAND) and the spoken curb summary.

Offline except vexcel_ortho when no cached image exists. Pins come from overrides.json:
{"arrival": {"door_lat", "door_lon", "curb_lat", "curb_lon"}}. `confirmed` needs both.
Arrival.dropoff is [lat, lon] of the curb pin (Vec2 reused; no contract change).
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from datetime import date

from dr import probe
from dr.config import STEP_M
from dr.mp_client import ROOT
from dr.package import Arrival, Prov
from dr.probe import VexcelCoverageError, vexcel_ortho_body

__all__ = ["VexcelCoverageError", "vexcel_ortho", "vexcel_ortho_body", "arrival", "build", "ArrivalResult"]

SIDES = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"]
ORTHO_HALF_M = 30.0  # the cached raw/vexcel_ortho.jpg is a 60 m square
R_EARTH = 6_371_000.0
PIN_KEYS = ("door_lat", "door_lon", "curb_lat", "curb_lon")


def vexcel_ortho(lat: float, lon: float, half_m: float = 40, px: int = 1400, client=None) -> bytes:
    return probe.vexcel_ortho(lat, lon, half_m, px, client=client)


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


def _pins(overrides: dict | None) -> dict | None:
    a = (overrides or {}).get("arrival", overrides or {})
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


def build(sid: str, overrides: dict | None = None, data_dir=None, web_dir=None, fetch=None) -> ArrivalResult:
    """fetch(lat, lon) -> jpeg bytes, used only when raw/vexcel_ortho.jpg is not cached."""
    data = (data_dir or ROOT / "data") / sid
    raw = data / "raw"
    model = json.loads((raw / "basics.json").read_text())["model"]
    lat, lon = float(model["geolocation"]["lat"]), float(model["geolocation"]["long"])
    name, address = model.get("name") or "the building", (model.get("address") or {}).get("address") or ""
    at = date.today().isoformat()
    prov: dict[str, Prov] = {}

    cached = raw / "vexcel_ortho.jpg"
    img = cached.read_bytes() if cached.exists() else (fetch or vexcel_ortho)(lat, lon)
    out = (web_dir or ROOT / "web" / "public" / "buildings") / sid
    out.mkdir(parents=True, exist_ok=True)
    (out / "arrival.jpg").write_bytes(img)
    prov["arrival.image"] = Prov(src="vexcel", ref=f"ortho/extract 60 m square at {lat:.6f},{lon:.6f}", at=at)

    costar_p = raw / "costar.json"
    hint = _frontage_hint(json.loads(costar_p.read_text()), lat, lon) if costar_p.exists() else None
    pins = _pins(overrides)
    curb_m = summary = None
    if pins:
        side = side_from_bearing(bearing_deg(lat, lon, pins["door_lat"], pins["door_lon"]))
        curb_m = haversine_m(pins["curb_lat"], pins["curb_lon"], pins["door_lat"], pins["door_lon"])
        facing = bearing_deg(pins["curb_lat"], pins["curb_lon"], lat, lon)
        to_door = bearing_deg(pins["curb_lat"], pins["curb_lon"], pins["door_lat"], pins["door_lon"])
        summary = curb_summary(curb_m, clock_hour(to_door - facing))
        dropoff = [pins["curb_lat"], pins["curb_lon"]]
        prov["arrival.entrance_side"] = Prov(src="calc", ref="bearing model centre to door pin", at=at,
                                             inputs=["arrival.door_pin", "arrival.image"])
        prov["arrival.door_pin"] = Prov(src="hand", ref="overrides.json arrival.door_lat/door_lon", at=at)
        prov["arrival.dropoff"] = Prov(src="hand", ref="overrides.json arrival.curb_lat/curb_lon", at=at)
        prov["arrival.curb_to_door_m"] = Prov(src="calc", ref="haversine curb pin to door pin", at=at,
                                              inputs=["arrival.door_pin", "arrival.dropoff"])
    else:
        side = hint or "main"
        dropoff = [lat, lon]
        if hint:
            prov["arrival.entrance_side"] = Prov(src="costar", ref="propertyRetail.frontage[].footprint", at=at,
                                                 confidence=0.5)
    msg = f"Please drop me at the {side} entrance of {name}, {address}."
    arr = Arrival(lat=lat, lon=lon, entrance_side=side, dropoff=dropoff, driver_message=msg,
                  image_url=f"/buildings/{sid}/arrival.jpg", confirmed=pins is not None)
    return ArrivalResult(arr, curb_m, summary, prov)


def arrival(sid: str, overrides: dict | None = None, **kw) -> Arrival:
    return build(sid, overrides, **kw).arrival
