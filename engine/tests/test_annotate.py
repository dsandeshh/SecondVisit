import json
import math
from pathlib import Path

import numpy as np
import pytest

from dr.annotate import (Annotator, calibrate_yaw0, face_bearing, fixed_check, fixed_detail, merge,
                         merge_room_labels, pano_room, parse_vision, place)
from dr import annotate
from dr.fixtures import lobby_fixture
from dr.grid import OccGrid
from dr.package import Room

REPO = Path(__file__).resolve().parents[2]


def _obs(pano, kind, pos, conf=0.8, built_in=False, face=1, label=None):
    return {"pano_id": pano, "face": face, "bearing_deg": 0.0, "kind": kind,
            "label": label or kind, "confidence": conf, "pos": pos, "built_in": built_in}


def test_face_bearing():
    assert face_bearing(1, 1024, 2048, 0) == pytest.approx(0)
    assert face_bearing(2, 1024, 2048, 0) == pytest.approx(90)
    assert face_bearing(1, 2048, 2048, 0) == pytest.approx(45)
    assert face_bearing(1, 0, 2048, 0) == pytest.approx(315)
    assert face_bearing(4, 1024, 2048, 30) == pytest.approx(300)
    # counter clockwise faces: face 2 sits 90 degrees to the left of face 1
    assert face_bearing(2, 1024, 2048, 0, clockwise=False) == pytest.approx(270)


def test_place_hits_wall():
    g, _, _ = lobby_fixture()
    p = place(g, (2.0, 3.0), 270)
    assert p is not None
    assert p[0] == pytest.approx(0.5, abs=0.1)
    assert p[1] == pytest.approx(3.0, abs=0.05)
    assert place(g, (2.0, 6.0), 270) is None  # escapes through the west door gap
    assert place(g, (10.0, 3.0), 0, max_m=1.0) is None  # nothing within range


def test_merge_clusters():
    obs = [_obs("p1", "desk", (5.0, 5.0), 0.9), _obs("p1", "desk", (5.4, 5.3), 0.6),
           _obs("p2", "desk", (5.2, 4.6), 0.75), _obs("p2", "door", (9.0, 9.0), 0.8)]
    lms = merge(obs)
    desks = [lm for lm in lms if lm.kind == "desk"]
    assert len(desks) == 1
    d = desks[0]
    assert d.confidence == pytest.approx((0.9 + 0.6 + 0.75) / 3)
    assert d.pos[0] == pytest.approx((5.0 + 5.4 + 5.2) / 3)
    door = [lm for lm in lms if lm.kind == "door"][0]
    assert door.confidence == pytest.approx(0.8 * 0.5)  # one pano only


def test_merge_second_pass_joins_drifted_clusters():
    # greedy pass leaves two door groups 0.8 m apart once the third sighting pulls one mean; they are one door
    obs = [_obs("p1", "door", (0.0, 0.0), 0.7), _obs("p2", "door", (1.05, 0.0), 0.9),
           _obs("p3", "door", (0.5, 0.0), 0.6), _obs("p3", "desk", (0.5, 0.0), 0.8)]
    lms = merge(obs)
    doors = [lm for lm in lms if lm.kind == "door"]
    assert len(doors) == 1 and doors[0].id == "door_1"
    assert len([lm for lm in lms if lm.kind == "desk"]) == 1   # other kinds never merge with it


def test_merge_drops_weak_other():
    obs = [_obs("p1", "other", (1.0, 1.0), 0.8),                                   # 1 pano: 0.4, dropped
           _obs("p1", "other", (5.0, 5.0), 0.6), _obs("p2", "other", (5.0, 5.0), 0.6),  # 0.6, kept
           _obs("p1", "door", (9.0, 9.0), 0.4)]                                    # not other: kept
    lms = merge(obs)
    assert sorted(lm.kind for lm in lms) == ["door", "other"]
    ids = {lid for lid, _ in annotate._clusters(obs)}
    assert ids == {lm.id for lm in lms}      # fixed_detail and prov use the same clusters


def test_parse_vision_tolerant():
    text = ('Sure, here is what I see:\n```json\n{"room": {"label": "lobby", "confidence": 1.7}, '
            '"items": [{"kind": "counter", "label": "check in counter", "x_px": 900, "confidence": 1.7}, '
            '{"kind": "plant", "label": "potted plant", "x_px": 100, "confidence": 0.4, "built_in": true}, '
            '{"kind": "door", "x_px": "1500", "confidence": -2}]}\n```\nHope that helps.')
    r = parse_vision(text)
    assert r["room"] == {"label": "other", "confidence": 1.0}
    a, b, c = r["items"]
    assert a["kind"] == "desk" and a["label"] == "check in counter" and a["confidence"] == 1.0
    assert a["built_in"] is False
    assert b["kind"] == "other" and b["built_in"] is True
    assert c["kind"] == "door" and c["x_px"] == 1500 and c["confidence"] == 0.0 and c["label"] == "door"
    r = parse_vision('{"items": [{"kind": "seating", "x_px": 10, "confidence": 0.5}]}')
    assert r["room"] is None and r["items"][0]["kind"] == "seating"
    assert parse_vision("I cannot see anything") == {"room": None, "items": []}
    assert parse_vision("{not json") == {"room": None, "items": []}
    r = parse_vision('{"room": {"label": "Exam", "confidence": 0.8}, "items": []}')
    assert r["room"] == {"label": "exam", "confidence": 0.8}


def test_parse_vision_salvages_truncated_reply():
    text = ('{"room": {"label": "reception", "confidence": 0.8}, "items": [{"kind": "door", "label": "d", '
            '"x_px": 100, "confidence": 0.9, "built_in": true}, {"kind": "desk", "label": "L-shaped desk", "x_px": 1166,')
    r = parse_vision(text)
    assert r["room"] == {"label": "reception", "confidence": 0.8}
    assert [i["kind"] for i in r["items"]] == ["door", "desk"]
    assert r["items"][0]["confidence"] == 0.9 and r["items"][1]["x_px"] == 1166 and r["items"][1]["confidence"] == 0.5


def test_fixed_check():
    furn = [_obs("p1", "desk", (5, 5)), _obs("p2", "desk", (5.2, 5)),
            _obs("p1", "seating", (2, 2)), _obs("p2", "seating", (2.1, 2))]
    defurn = [_obs("p1", "desk", (5.3, 5.2))]
    lms = merge(furn)
    ids = {lm.kind: lm.id for lm in lms}
    fx = fixed_check(furn, defurn)
    assert fx[ids["desk"]] is True and fx[ids["seating"]] is False
    det = fixed_detail(furn, defurn)
    assert det[ids["desk"]]["src"] == "matterport"

    obs = [_obs("p1", "desk", (5, 5), built_in=False), _obs("p2", "desk", (5.1, 5), built_in=False),
           _obs("p1", "door", (9, 1)), _obs("p1", "pillar", (1, 9)),
           _obs("p1", "seating", (2, 2)), _obs("p2", "seating", (2.1, 2)),
           _obs("p1", "seating", (12, 2), 0.7, built_in=True), _obs("p2", "seating", (12.1, 2), 0.9, built_in=True),
           _obs("p3", "seating", (12.2, 2), 0.5, built_in=False)]
    lms = merge(obs)
    det = fixed_detail(obs, None)
    by = {(lm.kind, round(lm.pos[0])): lm.id for lm in lms}
    assert det[by[("desk", 5)]] == {"fixed": True, "src": "calc", "confidence": None}
    assert det[by[("door", 9)]]["fixed"] is True
    assert det[by[("pillar", 1)]]["fixed"] is True
    assert det[by[("seating", 2)]]["fixed"] is False
    bench = det[by[("seating", 12)]]
    assert bench["fixed"] is True and bench["src"] == "ai"
    assert bench["confidence"] == pytest.approx(0.8)
    assert fixed_check(obs, None)[by[("desk", 5)]] is True


def _rooms():
    return [Room(id="a", label="Other", polygon=[(0, 0), (4, 0), (4, 4), (0, 4)], area_m2=16),
            Room(id="b", label="Other", polygon=[(5, 0), (9, 0), (9, 4), (5, 4)], area_m2=16),
            Room(id="v", label="Void", polygon=[(0, 5), (4, 5), (4, 9), (0, 9)], area_m2=16)]


def test_pano_room():
    rooms = _rooms()
    assert pano_room(rooms, (2, 2)) == "a"
    assert pano_room(rooms, (6, 1)) == "b"
    assert pano_room(rooms, (2, 7)) is None  # Void never
    assert pano_room(rooms, (4.2, 2)) == "a"  # 0.2 m outside a's boundary
    assert pano_room(rooms, (4.5, 2)) is None  # 0.5 m from both
    assert pano_room(rooms, (2, 4.2)) == "a"  # 0.2 m above a, 0.8 m below the Void room


def test_room_label_majority():
    obs = [{"room_id": "a", "pano_id": "p1", "face": 1, "label": "exam", "confidence": 0.6},
           {"room_id": "a", "pano_id": "p1", "face": 2, "label": "office", "confidence": 0.3},
           {"room_id": "a", "pano_id": "p2", "face": 1, "label": "exam", "confidence": 0.7},
           {"room_id": "a", "pano_id": "p3", "face": 3, "label": "office", "confidence": 0.9}]
    r = merge_room_labels(obs)
    assert r["a"]["label"] == "exam"
    assert r["a"]["confidence"] == pytest.approx(0.65)
    assert r["a"]["panos"] == ["p1", "p2"]
    tie = [{"room_id": "b", "pano_id": "p4", "face": 1, "label": "waiting", "confidence": 0.7},
           {"room_id": "b", "pano_id": "p5", "face": 1, "label": "reception", "confidence": 0.8}]
    r = merge_room_labels(tie)
    assert r["b"]["label"] == "reception" and r["b"]["confidence"] == pytest.approx(0.8)


def _annotator(tmp_path, **kw):
    from PIL import Image
    g, ents, _ = lobby_fixture()
    faces = tmp_path / "faces"
    faces.mkdir()
    for k in range(1, 5):
        Image.new("RGB", (64, 64), (k * 40, 0, 0)).save(faces / f"pA_{k}.jpg")
        Image.new("RGB", (64, 64), (0, k * 40, 0)).save(faces / f"pB_{k}.jpg")
    rooms = [Room(id="lobby", label="Other", polygon=[(0, 0), (20, 0), (20, 12), (0, 12)], area_m2=240)]
    return Annotator(sid="fixture", grid=g, rooms=rooms,
                     panos={"pA": (2.0, 3.0), "pB": (16.0, 9.0)}, faces_dir=faces,
                     out_dir=tmp_path / "out", entrance=ents[0], **kw)


def test_budget(tmp_path):
    a = _annotator(tmp_path)
    for i in range(60):
        r = a.look("pA", 1 + i % 4)
        assert isinstance(r, dict) and r["type"] == "image"
    r = a.look("pA", 1)
    assert isinstance(r, str) and "budget" in r.lower()
    assert isinstance(a.look("pZ", 1), str)


def test_look_defurnished_missing(tmp_path):
    a = _annotator(tmp_path)
    assert isinstance(a.look("pA", 1, view="defurnished"), str)


def test_record_and_finish(tmp_path):
    a = _annotator(tmp_path)
    # pA at (2, 3); face 4 centre (yaw0 0, clockwise) looks west at the wall
    a.record("pA", 4, json.dumps({"room": {"label": "waiting", "confidence": 0.9},
                                  "items": [{"kind": "door", "label": "door", "x_px": 1024,
                                             "confidence": 0.9, "built_in": True}]}), width_px=2048)
    a.record("pB", 4, json.dumps({"room": {"label": "waiting", "confidence": 0.7},
                                  "items": []}), width_px=2048)
    out = a.finish()
    data = json.loads((tmp_path / "out" / "landmarks.json").read_text())
    assert len(data["landmarks"]) == 1
    lm = data["landmarks"][0]
    assert lm["kind"] == "door" and lm["fixed"] is True
    assert lm["pos"][0] == pytest.approx(0.5, abs=0.1)
    assert data["rooms"]["lobby"]["label"] == "waiting"
    prov = data["prov"]
    assert prov[f"landmark:{lm['id']}"]["src"] == "ai"
    assert prov[f"landmark:{lm['id']}"]["ref"] == "pano:pA"
    assert prov[f"landmark:{lm['id']}.fixed"]["src"] == "calc"
    assert prov["room:lobby.label"]["ref"] == "pano:pA,pano:pB"
    assert "| lobby | waiting |" in out
    assert (tmp_path / "out" / "landmarks.md").exists()


def test_list_panos_route_first(tmp_path):
    a = _annotator(tmp_path, routes={"r1": [(14.0, 9.0), (18.0, 9.0)]})
    ids = [p["pano_id"] for p in a.list_panos("r1")]
    assert ids == ["pB", "pA"]
    ids = [p["pano_id"] for p in a.list_panos(None)]
    assert ids == ["pA", "pB"]  # by distance from the west entrance


def test_calibrated_desk_within_destination():
    """Review Focus 12 on the fixture: a desk seen in a face, after calibration, lands near the destination."""
    g, _, lms = lobby_fixture()
    cells = g.cells.copy()
    r0, c0 = g.world_to_cell((17.5, 10.3))
    r1, c1 = g.world_to_cell((19.5, 11.3))
    cells[r0:r1 + 1, c0:c1 + 1] = 2  # the desk as a fixed obstacle
    g = OccGrid(cells, g.res, g.origin)
    dest = lms[0].pos  # (18.5, 10.8): the destination pinned in pick.html
    pano = (10.0, 4.0)
    true_yaw0 = 37.0  # unknown to the annotator
    true_bearing = math.degrees(math.atan2(dest[0] - pano[0], dest[1] - pano[1])) % 360
    # which face and pixel column the human sees the desk in, given the true yaw0
    rel = (true_bearing - true_yaw0) % 360
    face = int(((rel + 45) % 360) // 90) + 1
    off = ((rel + 45) % 90) - 45
    x_px = 1024 + 1024 * math.tan(math.radians(off))
    yaw0 = calibrate_yaw0(pano, face, x_px, 2048, dest)
    assert yaw0 == pytest.approx(true_yaw0, abs=0.5)
    p = place(g, pano, face_bearing(face, x_px, 2048, yaw0))
    assert p is not None and math.dist(p, dest) <= 1.5
    # an uncalibrated yaw0 of 0 misses
    p0 = place(g, pano, face_bearing(face, x_px, 2048, 0.0))
    assert p0 is None or math.dist(p0, dest) > 1.5


def test_clinic_desk_near_destination():
    """Review Focus 12 on the clinic, once Step 6 has written landmarks.json and the human set a destination."""
    sid = "x37LjPx62VA"
    ov_p, lm_p = REPO / "data" / sid / "overrides.json", REPO / "data" / sid / "landmarks.json"
    if not (ov_p.exists() and lm_p.exists()):
        pytest.skip("needs the calibrated annotator run (Task 3 Steps 5 and 6)")
    dest = (json.loads(ov_p.read_text()).get("destination") or {}).get("pos")
    if dest is None:
        pytest.skip("overrides.json has no destination position")
    desks = [lm for lm in json.loads(lm_p.read_text())["landmarks"] if lm["kind"] == "desk"]
    assert desks and min(math.dist(lm["pos"], dest) for lm in desks) <= 1.5


def test_pano_yaw_from_rotation():
    from dr.annotate import pano_yaw_deg
    h = math.sqrt(0.5)
    assert pano_yaw_deg({"x": 0, "y": 0, "z": h, "w": h}) == pytest.approx(90)
    assert pano_yaw_deg({"x": 0, "y": 0, "z": 0, "w": 1}) == pytest.approx(0)
    # clinic pano "1": z -0.771, w 0.637 is about -100.9 degrees
    assert pano_yaw_deg({"x": -0.0007, "y": -0.0189, "z": -0.77098, "w": 0.63658}) == pytest.approx(-100.9, abs=0.2)


def test_record_uses_pano_yaw(tmp_path):
    # pA's skybox is turned 90 degrees counter clockwise: with face_yaw0_deg 0 its face 1 centre looks west
    a = _annotator(tmp_path, pano_yaw={"pA": 90.0})
    a.record("pA", 1, json.dumps({"items": [{"kind": "door", "x_px": 1024, "confidence": 0.9}]}), width_px=2048)
    assert a.obs[0]["bearing_deg"] == pytest.approx(270)
    assert a.obs[0]["pos"][0] == pytest.approx(0.5, abs=0.1)


def test_vision_prompt_does_not_assume_a_medical_office():
    """The same annotator runs on every building (the clinic, an empty office); the prompt names no type."""
    from dr.annotate import vision_prompt
    p = vision_prompt(2048)
    assert "medical office" not in p and "2048" in p and "glass_door" in p
