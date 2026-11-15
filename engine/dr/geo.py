"""Geo anchor transforms (agent6 4.1.1). Mirror of web/src/geo/frame.ts.

plan_north_deg: direction of true north in the plan, degrees counterclockwise from plan +x.
plan_pos is the plan position of the anchor lat/lon. mirror=True flips east (plan y down images).
"""
from __future__ import annotations

import math

from dr.package import GeoAnchor

R = 6378137.0
D2R = math.pi / 180


def geoToEN(a: GeoAnchor, lat: float, lon: float) -> tuple[float, float]:
    return ((lon - a.lon) * D2R * R * math.cos(a.lat * D2R), (lat - a.lat) * D2R * R)


def enToPlan(a: GeoAnchor, e: float, n: float) -> tuple[float, float]:
    t, s = a.plan_north_deg * D2R, (-1 if a.mirror else 1)
    return (a.plan_pos[0] + s * e * math.sin(t) + n * math.cos(t),
            a.plan_pos[1] - s * e * math.cos(t) + n * math.sin(t))


def planToEN(a: GeoAnchor, x: float, y: float) -> tuple[float, float]:
    t, s = a.plan_north_deg * D2R, (-1 if a.mirror else 1)
    dx, dy = x - a.plan_pos[0], y - a.plan_pos[1]
    return (s * (dx * math.sin(t) - dy * math.cos(t)), dx * math.cos(t) + dy * math.sin(t))


def geoToPlan(a: GeoAnchor, lat: float, lon: float) -> tuple[float, float]:
    return enToPlan(a, *geoToEN(a, lat, lon))


def planToGeo(a: GeoAnchor, x: float, y: float) -> tuple[float, float]:
    e, n = planToEN(a, x, y)
    return (a.lat + n / (D2R * R), a.lon + e / (D2R * R * math.cos(a.lat * D2R)))


def bearing(e: float, n: float) -> float:
    """Compass bearing, clockwise from north, of an east/north offset."""
    return (math.atan2(e, n) / D2R + 360) % 360


def clockOf(bearing_target: float, bearing_facing: float) -> int:
    """12, 1 .. 11. Python round (half to even), as data/fixtures/clock_cases.json."""
    rel = (bearing_target - bearing_facing + 540) % 360 - 180
    return round(rel / 30) % 12 or 12


def plan_bearing(a: GeoAnchor, dx: float, dy: float) -> float:
    """Compass bearing of a plan vector (dx, dy)."""
    e, n = planToEN(GeoAnchor(lat=a.lat, lon=a.lon, plan_pos=(0.0, 0.0), plan_north_deg=a.plan_north_deg,
                              mirror=a.mirror), dx, dy)
    return bearing(e, n)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = lat1 * D2R, lat2 * D2R
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin((lon2 - lon1) * D2R / 2) ** 2
    return 2 * 6_371_000.0 * math.asin(math.sqrt(h))


def solve_north(door_plan, entrance_heading_deg: float, facade_bearing_deg: float,
                curb_en: tuple[float, float], door_en: tuple[float, float] = (0.0, 0.0)) -> float:
    """plan_north_deg = alpha + beta (agent6). alpha: entrance wall direction in plan (CCW from +x), beta:
    facade compass bearing. Two walls and a 180 degree edge ambiguity give four candidates; keep the one
    where the curb lands in front of the entrance (opposite the walking-in direction)."""
    walk = (90 - entrance_heading_deg) % 360  # plan angle of the walking-in direction
    ce, cn = curb_en[0] - door_en[0], curb_en[1] - door_en[1]
    wall = walk + 90  # entrance wall direction alpha; the wall's other direction is the same edge, 180 apart
    out = lambda t: -(lambda d: d[0] * math.cos(walk * D2R) + d[1] * math.sin(walk * D2R))(
        enToPlan(GeoAnchor(lat=0.0, lon=0.0, plan_pos=(0.0, 0.0), plan_north_deg=t), ce, cn))
    cands = [(wall + facade_bearing_deg) % 360, (wall + facade_bearing_deg + 180) % 360]
    return float(max(cands, key=out))
