import hashlib

import pytest

from dr import names, voice_lines
from dr.package import BuildingPackage, Entrance, Grid, Landmark, Room, Route, Score, Segment
from dr.pipeline import fixture_package


@pytest.mark.parametrize("label,spoken", [
    ("Exam Room 4 door (closed, with handle)", "Exam room 4 door"),
    ("L-shaped reception desk with laminate top and wood-look front", "Reception desk"),
    ("closed wooden door on left wall with lever handle", "Door"),
    ("illuminated red EXIT sign on ceiling", "Exit sign"),
    ("open doorway on left with dark frame", "Doorway"),
    ("wall sign reading 'PHYSICIAN' on the door", "Physician sign"),
    ("grey office chair on wheels, centre floor", "Office chair"),
    ("LAB door, biohazard, authorized personnel only", "Lab door"),
    ("sink with faucet", "Sink"),
    ("Water fountain", "Water fountain"),
    ("square column at left, beside the counter", "Column"),
    ("wall projection or column edge, right of centre", "Wall projection"),
])
def test_spoken_from_label(label, spoken):
    assert names.spoken_name(label, "other") == spoken


def test_spoken_bounds_and_fallback():
    s = names.spoken_name("very large extremely long thing name goes on and on", "other")
    assert 1 <= len(s.split()) <= 4
    assert names.spoken_name("(closed)", "desk") == "Desk"
    assert names.spoken_name("", "glass_door") == "Glass door"


def test_plurals_and_possibly_is_a_flag():
    assert names.plural("seating") == "chairs"
    assert names.plural("desk") == "desks"
    assert names.plural("stairs") == "stairs"
    lm = Landmark(id="a", kind="door", label="closed door", pos=(0, 0), confidence=0.4, fixed=True)
    assert names.is_possible(lm) and "possibly" not in names.spoken_name(lm.label, lm.kind).lower()
    assert not names.is_possible(lm.model_copy(update={"confidence": 0.6}))


def test_fill_spoken_keeps_label_and_hand_value():
    a = Landmark(id="a", kind="door", label="Exam Room 4 door (closed)", pos=(0, 0), confidence=0.5, fixed=True)
    b = Landmark(id="b", kind="desk", label="Front desk (long)", pos=(0, 0), confidence=0.9, fixed=True, spoken="Check in")
    names.fill_spoken([a, b])
    assert a.spoken == "Exam room 4 door" and a.label.startswith("Exam Room 4")
    assert b.spoken == "Check in"


def _pkg():
    pkg = fixture_package()
    seg = Segment(id="s1", start=(0, 0), end=(0, 5), heading_deg=0, length_m=5, steps=7, wall_side="left",
                  open_m=1, landmarks_passed=[], turn_after="none", turn_deg=0,
                  instruction="Facing into the building. Walk 7 steps.")
    pkg.routes = [Route(id="r", **{"from": "e"}, to="d", path=[(0, 0), (0, 5)], segments=[seg],
                        score=Score(total=1, parts=dict(length_m=1, wall_share=0, open_m=0, turns=0, decisions=0,
                                                       hazards=0, landmarks_per_10m=0)))]
    pkg.rooms = [Room(id="r1", label="Waiting room", polygon=[(0, 0), (1, 0), (1, 1)], area_m2=1)]
    return pkg


def test_voice_lines_contents_hash_unique():
    pkg = _pkg()
    names.fill_spoken(pkg.landmarks)
    voice_lines.add_voice_lines(pkg)
    texts = [v.text for v in pkg.voice_lines]
    assert texts == sorted(set(texts))
    assert "Facing into the building. Walk 7 steps." in texts
    assert "Waiting room" in texts and "may move" in texts and "possibly" in texts
    assert "wide doorway" in texts
    for lm in pkg.landmarks:
        assert lm.spoken in texts
    for t in voice_lines.FIXED_UI_LINES:
        assert t in texts
    ids = [v.id for v in pkg.voice_lines]
    assert len(ids) == len(set(ids))
    v = pkg.voice_lines[0]
    assert v.id == hashlib.sha1(" ".join(v.text.split()).encode()).hexdigest()[:12]


def test_hash_normalises_whitespace_and_is_stable():
    assert voice_lines.line_id("  Walk   7 steps. ") == voice_lines.line_id("Walk 7 steps.")
    assert voice_lines.line_id("Walk 7 steps.") == hashlib.sha1(b"Walk 7 steps.").hexdigest()[:12]
    assert voice_lines.line_id("Walk 7 steps.") != voice_lines.line_id("walk 7 steps.")


def test_fixed_ui_lines_cover_web_literals():
    import re
    from pathlib import Path
    src = (Path(__file__).resolve().parents[2] / "web" / "src")
    found = set()
    for p in src.rglob("*.ts"):
        if ".test." in p.name:
            continue
        for m in re.finditer(r"""(?:\.say|\bsay|\.prime)\(\s*"([^"$`]+)\"""", p.read_text()):
            found.add(m.group(1))
    assert found, "grep found nothing"
    missing = found - set(voice_lines.FIXED_UI_LINES)
    assert not missing, missing


def test_build_package_has_spoken_and_voice_lines(tmp_path):
    from dr.mp_import import DATA
    if not (DATA / "x37LjPx62VA" / "raw" / "rooms.json").exists():
        pytest.skip("clinic cache not present")
    from dr import pipeline
    pkg = pipeline.build_package("x37LjPx62VA", web_root=tmp_path)
    assert all(lm.spoken and len(lm.spoken.split()) <= 5 for lm in pkg.landmarks)
    texts = {v.text for v in pkg.voice_lines}
    assert len(texts) == len(pkg.voice_lines)
    for r in pkg.routes:
        assert all(s.instruction in texts for s in r.segments)


def _lm(i, label, pos, kind="door", fixed=True, conf=0.9):
    return Landmark(id=i, kind=kind, label=label, pos=pos, confidence=conf, fixed=fixed)


def test_disambiguate_by_nearest_fixed_landmark_then_ordinal():
    lms = [_lm("d1", "closed door", (0, 0)), _lm("d2", "closed door", (10, 0)), _lm("d3", "closed door", (20, 0)),
           _lm("s", "sink counter", (1, 0), kind="other"), _lm("r", "reception counter", (11, 0), kind="desk")]
    names.fill_spoken(lms, entrances=[Entrance(id="e", label="Main", pos=(0, 5), heading_deg=0)])
    sp = {l.id: l.spoken for l in lms}
    assert sp["d1"] == "Door by the sink counter"
    assert sp["d2"] == "Door by the reception counter"
    assert sp["d3"] == "Door 3"  # nothing near: ordinal by distance from the entrance
    assert len({v.lower() for v in sp.values()}) == len(sp)
    assert all(len(v.split()) <= 5 for v in sp.values())


def test_disambiguate_uses_room_then_ordinal_and_keeps_hand():
    from dr.package import Room
    rooms = [Room(id="r", label="Lab", polygon=[(-1, -1), (5, -1), (5, 5), (-1, 5)], area_m2=36)]
    lms = [_lm("a", "door", (0, 0)), _lm("b", "door", (30, 0)), _lm("c", "door", (60, 0), ), _lm("h", "door", (2, 2))]
    lms[3].spoken = "Back door"
    lms[3].fixed = False
    names.fill_spoken(lms, rooms=rooms, entrances=[Entrance(id="e", label="Main", pos=(100, 0), heading_deg=0)])
    sp = {l.id: l.spoken for l in lms}
    assert sp["h"] == "Back door"
    assert sp["a"] == "Door in the lab"
    assert sp["c"] == "Door 1" and sp["b"] == "Door 2"  # c is closer to the entrance


def test_line_id_golden_shared_with_web():
    """web/src/lines.test.ts reads the same file: the browser id must equal the engine id for every sample."""
    import json
    from pathlib import Path
    rows = json.loads((Path(__file__).parent / "line_id_golden.json").read_text(encoding="utf-8"))
    assert rows and all(voice_lines.line_id(r["text"]) == r["id"] for r in rows)
