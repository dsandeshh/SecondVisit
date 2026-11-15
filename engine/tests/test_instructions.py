import json
import math
from pathlib import Path

import pytest

from dr import instructions as ins
from dr.instructions import clock_hour, numbers_match, write
from dr.fixtures import lobby_fixture
from dr.package import Segment


CASES = json.loads((Path(__file__).parents[2] / "data/fixtures/clock_cases.json").read_text())["cases"]


@pytest.mark.parametrize("c", CASES)
def test_clock(c):
    assert clock_hour(c["rel_deg"]) == c["hour"]


def test_grounded():
    from dr.grounding import grounded, numbers_in
    assert numbers_in("Walk 14 steps, 2.5 m") == [14, 2.5]
    assert grounded("Walk 14 steps", {14}) and not grounded("Walk 15 steps", [14])


def seg(i, a, b, heading, wall="left", lms=()):
    L = math.dist(a, b)
    return Segment(id=f"s{i}", start=a, end=b, heading_deg=heading, length_m=L,
                   steps=round(L / 0.7), wall_side=wall, open_m=2.0,
                   landmarks_passed=list(lms), turn_after="none", turn_deg=0, instruction="")


def lobby_segs():
    _, ents, lms = lobby_fixture()
    return [seg(1, (0.5, 6), (10, 6), 90, "none"),
            seg(2, (10, 6), (10, 10.8), 0, "right"),
            seg(3, (10, 10.8), (18.5, 10.8), 90, "left", ["desk"])], lms, ents


def test_templates_and_match():
    segs, lms, ents = lobby_segs()
    out = write(segs, lms, ents)
    assert out[0].instruction == "Facing into the building. Walk 14 steps."
    assert out[1].instruction.startswith("Turn left to 9 o'clock. Walk 7 steps, wall on your right.")
    assert "passing the Reception desk. The Reception desk is at" in out[2].instruction
    for s in out:
        assert numbers_match(s.instruction, s) and len(s.instruction) <= 160
    bad = out[0].instruction.replace("14", "15")
    assert not numbers_match(bad, out[0])


def test_low_confidence_is_spoken_the_same():
    segs, lms, ents = lobby_segs()
    lms[0] = lms[0].model_copy(update={"confidence": 0.5})
    text = write(segs, lms, ents)[2].instruction
    assert "passing the Reception desk" in text and "possibly" not in text.lower()


def test_smooth_rejects_drift(monkeypatch):
    segs, lms, ents = lobby_segs()
    base = write(segs, lms, ents)
    monkeypatch.setattr(ins.llm, "complete", lambda s, u, max_tokens=300: u.replace("14", "15"))
    assert [s.instruction for s in write(segs, lms, ents, smooth=True)] == [s.instruction for s in base]
    monkeypatch.setattr(ins.llm, "complete", lambda s, u, max_tokens=300: u.replace("Walk", "Go"))
    assert "Go" not in write(segs, lms, ents, smooth=True)[0].instruction  # no longer 'Walk N steps'
    monkeypatch.setattr(ins.llm, "complete",
                        lambda s, u, max_tokens=300: u.replace("Facing into", "Heading into"))
    assert write(segs, lms, ents, smooth=True)[0].instruction.startswith("Heading into")


def test_llm_failure_returns_empty(monkeypatch):
    from dr import llm
    monkeypatch.setenv("DR_FAST_MODEL", "x")
    monkeypatch.setattr("anthropic.Anthropic", lambda **k: (_ for _ in ()).throw(RuntimeError()))
    assert llm.complete("s", "u") == ""


def test_uses_spoken_name_without_confidence_word():
    segs, lms, ents = lobby_segs()
    lms[0] = lms[0].model_copy(update={"spoken": "Front desk", "confidence": 0.5})
    text = write(segs, lms, ents)[2].instruction
    assert "passing the Front desk" in text and "The Front desk is at" in text and "possibly" not in text.lower()
    assert "Reception" not in text


def test_first_line_turns_when_the_route_leaves_off_the_entrance_heading():
    """Office B: the entrance faces west (270) but the route first follows the wall south (180).
    "Facing into the building. Walk 3 steps" would walk the visitor west; say the turn first."""
    from dr.package import Entrance
    ent = [Entrance(id="ent_main", label="Main entrance", pos=(4.5, 0.0), heading_deg=270)]
    segs = [seg(1, (4.5, 0.0), (4.5, -2.1), 180), seg(2, (4.5, -2.1), (-3, -2.1), 270)]
    out = write(segs, [], ent)
    assert out[0].instruction == "Facing into the building. Turn left to 9 o'clock. Walk 3 steps, wall on your left."
    assert numbers_match(out[0].instruction, out[0])
    # aligned with the entrance (the clinic): unchanged
    segs[0] = seg(1, (4.5, 0.0), (2.4, 0.0), 270)
    assert write(segs, [], ent)[0].instruction.startswith("Facing into the building. Walk 3 steps")
