"""agent6 4.1.1 tests: geo anchor transforms and the clinic curb to door frame (skips when the clinic cache is absent)."""
import json
import math
import random

import pytest
from shapely.geometry import Point, Polygon

from dr import arrival as A
from dr import geo
from dr.mp_import import DATA
from dr.package import GeoAnchor

SID = "x37LjPx62VA"
HAVE = (DATA / SID / "raw" / "rooms.json").exists() and (DATA / SID / "overrides.json").exists()
needs_clinic = pytest.mark.skipif(not HAVE, reason="clinic cache not present")


def test_roundtrip():
    rnd = random.Random(1)
    for mirror in (False, True):
        a = GeoAnchor(lat=29.9665, lon=-95.5395, plan_pos=(2.9, 0.1), plan_north_deg=243.1, mirror=mirror)
        for _ in range(50):
            x, y = a.plan_pos[0] + rnd.uniform(-100, 100), a.plan_pos[1] + rnd.uniform(-100, 100)
            x2, y2 = geo.geoToPlan(a, *geo.planToGeo(a, x, y))
            assert math.hypot(x - x2, y - y2) < 0.01


def test_north_and_east_directions():
    a = GeoAnchor(lat=30.0, lon=-95.0, plan_pos=(0, 0), plan_north_deg=90)  # north is plan +y
    x, y = geo.enToPlan(a, 0, 10)
    assert (round(x, 6), round(y, 6)) == (0, 10)
    x, y = geo.enToPlan(a, 10, 0)  # east is clockwise of north: plan +x
    assert (round(x, 6), round(y, 6)) == (10, 0)
    assert geo.clockOf(80, 63.1) == 1 and geo.clockOf(63.1, 63.1) == 12 and geo.clockOf(0, 90) == 9


def _clinic(web_dir):
    from dr.mp_import import build_from_matterport, load_overrides
    from dr.pipeline import merge_landmarks
    ov = load_overrides(SID)
    pkg = build_from_matterport(SID)
    res = A.build(SID, ov.model_dump(mode="json"), entrance=pkg.entrances[0], outline=A.building_outline(pkg.rooms), web_dir=web_dir)
    return ov, pkg, res


@needs_clinic
def test_door_is_anchor(tmp_path):
    ov, pkg, res = _clinic(tmp_path)
    a = res.geo_anchor
    x, y = geo.geoToPlan(a, ov.arrival.door_lat, ov.arrival.door_lon)
    assert math.hypot(x - pkg.entrances[0].pos[0], y - pkg.entrances[0].pos[1]) < 0.01


@needs_clinic
def test_curb_outside(tmp_path):
    ov, pkg, res = _clinic(tmp_path)
    a, p = res.geo_anchor, ov.arrival
    cx, cy = geo.geoToPlan(a, p.curb_lat, p.curb_lon)
    outline = Polygon(A.building_outline(pkg.rooms))
    assert not outline.contains(Point(cx, cy))
    # in front of the entrance: opposite the walking-in direction
    walk = math.radians(90 - pkg.entrances[0].heading_deg)
    ex, ey = pkg.entrances[0].pos
    assert (cx - ex) * math.cos(walk) + (cy - ey) * math.sin(walk) < 0
    hav = geo.haversine_m(p.curb_lat, p.curb_lon, p.door_lat, p.door_lon)
    assert math.hypot(cx - ex, cy - ey) == pytest.approx(hav, abs=0.05)
    assert 0 <= a.plan_north_deg < 360 and "assumed" in res.prov["frames.geo_anchor"].ref


@needs_clinic
def test_hand_description(tmp_path):
    """The computed script for the demo pins says about 11 steps and a o'clock consistent with the stored
    reference. If it ever disagrees with the human description, surface it in the trace (prov), not silently."""
    ov, pkg, res = _clinic(tmp_path)
    a = res.arrival
    assert a.steps == 11
    ref = a.reference_bearing_deg
    p = ov.arrival
    b = geo.bearing(*(geo.geoToEN(GeoAnchor(lat=p.curb_lat, lon=p.curb_lon, plan_pos=(0, 0), plan_north_deg=0),
                                  p.door_lat, p.door_lon)))
    assert a.clock == geo.clockOf(b, ref) == 1
    assert "1 o'clock" in a.lines[1] and "about 11 steps" in a.lines[1]
