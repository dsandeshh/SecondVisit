from dr import arrival, geo
from dr.mp_import import Overrides
from dr.package import GeoAnchor


def _script(ov):
    a = GeoAnchor(lat=29.9665, lon=-95.5395, plan_pos=(2.9, 0.1), plan_north_deg=0.0)
    ent = type("E", (), {"pos": (2.9, 0.1), "heading_deg": 270.0})()
    curb = (2.9 + 8.0, 0.1)
    return arrival.curb_script(a, ent, curb, [2.9, 0.1], ov, "west", None)


def test_unknown_lane_edge_door_give_safe_lines():
    s = _script({})
    assert "Listen for cars before you cross." in s["lines"]
    assert "Feel for a change in the ground with your cane." in s["lines"]
    assert "Find the door handle with your hand; the door may be heavy." in s["lines"]


def test_known_lane_false_has_no_car_line():
    s = _script({"crosses_drive_lane": False})
    assert "Listen for cars before you cross." not in s["lines"]


def test_reference_confirmed_is_hand_and_canopy_lonlat_line():
    ov = Overrides.model_validate({"reference_confirmed": True, "arrival": {
        "door_lat": 29.9665, "door_lon": -95.5395, "curb_lat": 29.9665, "curb_lon": -95.5394,
        "canopy": [[-95.5395, 29.9665], [-95.5394, 29.9665], [-95.5394, 29.9666], [-95.5395, 29.9666]]}}).model_dump(mode="json")
    s = _script(ov)
    assert s["ref_src"] == "hand"
    assert "You are under the canopy now. The door is straight ahead." in s["lines"]
    assert len(s["cues"]) and any(c.kind == "canopy" and len(c.plan) == 4 for c in s["cues"])
