import math

import pytest

from dr import instructions as ins
from dr.instructions import clock_hour, numbers_match, write
from dr.fixtures import lobby_fixture
from dr.package import Segment


@pytest.mark.parametrize("deg,h", [(0, 12), (30, 1), (60, 2), (90, 3), (180, 6), (-90, 9),
                                   (-30, 11), (179, 6), (-180, 6), (350, 12)])
def test_clock(deg, h):
    assert clock_hour(deg) == h


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


def test_possibly():
    segs, lms, ents = lobby_segs()
    lms[0] = lms[0].model_copy(update={"confidence": 0.5})
    assert "passing possibly the Reception desk" in write(segs, lms, ents)[2].instruction


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
