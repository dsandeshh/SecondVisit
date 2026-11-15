"""Automatic entrance and destination pins for a building no human has reviewed (dr.autopins)."""
import json

import pytest

from dr import autopins
from dr.package import Landmark, Room

# A 20 x 10 m suite: x 0..20, y 0..10. The scan started (pano "0") near the east wall.
ROOMS = [Room(id="big", label="Other", polygon=[(0, 0), (20, 0), (20, 10), (0, 10)], area_m2=200)]
PANOS = {"pA": {"label": "3", "pos": (5, 5)}, "p0": {"label": "0", "pos": (17, 4.2)},
         "pB": {"label": "1", "pos": (10, 5)}}


def lm(i, kind, pos, conf=0.5, fixed=True):
    return Landmark(id=i, kind=kind, label=i, pos=pos, confidence=conf, fixed=fixed)


def test_first_pano_is_label_zero():
    assert autopins.first_pano(PANOS) == (17, 4.2)


def test_first_pano_falls_back_to_model_origin():
    panos = {"a": {"label": "", "pos": (5, 5)}, "b": {"label": "x", "pos": (0.2, -0.1)}}
    assert autopins.first_pano(panos) == (0.2, -0.1)


def test_entrance_is_exterior_glass_door_nearest_first_scan():
    lms = [lm("glass_door_1", "glass_door", (10, 9.7), conf=0.9),   # north wall, far from the first scan
           lm("glass_door_2", "glass_door", (19.7, 4.2), conf=0.25),  # east wall, next to the first scan
           lm("door_1", "door", (19.7, 3.0), conf=0.9),
           lm("glass_door_3", "glass_door", (12, 5), conf=0.9)]       # mid room: not on the outline
    e = autopins.pick_entrance(lms, ROOMS, autopins.first_pano(PANOS))
    assert e["landmark_id"] == "glass_door_2"
    assert e["pos"] == pytest.approx((19.7, 4.2))
    assert e["heading_deg"] == pytest.approx(270)  # facing in, toward the first scan
    # the first scan off to one side: the heading still points at it (the operator's way in)
    e2 = autopins.pick_entrance(lms, ROOMS, (17, 1.5))
    assert e2["heading_deg"] == pytest.approx(225, abs=1)


def test_entrance_falls_back_to_plain_door_then_none():
    lms = [lm("door_1", "door", (0.3, 5)), lm("pillar_1", "pillar", (19.8, 4))]
    e = autopins.pick_entrance(lms, ROOMS, (17, 4))
    assert e["landmark_id"] == "door_1" and e["heading_deg"] == pytest.approx(90)
    assert autopins.pick_entrance([lm("pillar_1", "pillar", (19.8, 4))], ROOMS, (17, 4)) is None


def test_destination_prefers_desk_then_restroom():
    ent = (19.7, 4.2)
    lms = [lm("restroom_1", "restroom", (1, 1), conf=0.4), lm("pillar_1", "pillar", (10, 5), conf=0.9)]
    assert autopins.pick_destination(lms, ent)["landmark_id"] == "restroom_1"
    lms.append(lm("desk_1", "desk", (15, 5), conf=0.7))
    assert autopins.pick_destination(lms, ent)["landmark_id"] == "desk_1"


def test_destination_skips_landmarks_at_the_entrance_and_none_without_a_candidate():
    ent = (19.7, 4.2)
    lms = [lm("desk_1", "desk", (19, 4.5), conf=0.9), lm("restroom_1", "restroom", (2, 2), conf=0.3)]
    assert autopins.pick_destination(lms, ent)["landmark_id"] == "restroom_1"
    assert autopins.pick_destination([lm("pillar_1", "pillar", (2, 2))], ent) is None


def _seed(tmp_path, overrides=None, landmarks=True, rotations=True):
    d = tmp_path / "S"
    raw = d / "raw"
    raw.mkdir(parents=True)
    (raw / "panos.json").write_text(json.dumps({"model": {"panoLocations": [
        {"id": k, "label": v["label"], "position": {"x": v["pos"][0], "y": v["pos"][1], "z": 1.3}}
        for k, v in PANOS.items()]}}))
    if rotations:
        (raw / "pano_rotations.json").write_text(json.dumps({"model": {"panoLocations": []}}))
    if overrides is not None:
        (d / "overrides.json").write_text(json.dumps(overrides))
    if landmarks:
        (d / "landmarks.json").write_text(json.dumps({"landmarks": [
            lm("glass_door_2", "glass_door", (19.7, 4.2), conf=0.25).model_dump(mode="json"),
            lm("restroom_1", "restroom", (1, 1), conf=0.4).model_dump(mode="json")]}))
    return d


def test_auto_overrides_writes_calc_pins_and_keeps_human_ones(tmp_path):
    d = _seed(tmp_path, overrides={"faces_clockwise": True})
    ov = autopins.auto_overrides("S", rooms=ROOMS, data_root=tmp_path)
    assert ov["face_yaw0_deg"] == 90
    assert ov["entrance"]["src"] == "calc" and "assumed" in ov["entrance"]["ref"]
    assert ov["entrance"]["pos"] == pytest.approx([19.7, 4.2])
    assert ov["destination"] == {"landmark_id": "restroom_1"}
    assert "assumed" in ov["auto_pins"]["destination"]
    assert json.loads((d / "overrides.json").read_text()) == ov
    # a human pinned entrance and calibration are never replaced
    human = {"entrance": {"id": "ent_main", "label": "Main entrance", "pos": [19, 5], "heading_deg": 0},
             "face_yaw0_deg": 37}
    (d / "overrides.json").write_text(json.dumps(human))
    ov2 = autopins.auto_overrides("S", rooms=ROOMS, data_root=tmp_path)
    assert ov2["entrance"] == human["entrance"] and ov2["face_yaw0_deg"] == 37
    assert ov2["destination"] == {"landmark_id": "restroom_1"}


def test_auto_overrides_before_annotation_sets_only_the_face_yaw(tmp_path):
    _seed(tmp_path, landmarks=False)
    ov = autopins.auto_overrides("S", rooms=ROOMS, data_root=tmp_path)
    assert ov["face_yaw0_deg"] == 90 and "entrance" not in ov and "destination" not in ov
    _seed(tmp_path / "x", landmarks=False, rotations=False)
    assert "face_yaw0_deg" not in autopins.auto_overrides("S", rooms=ROOMS, data_root=tmp_path / "x")
