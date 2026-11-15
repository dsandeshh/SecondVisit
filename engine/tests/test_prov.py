"""Task 19 engine half: every producer's prov keys match the documented patterns and validate as Prov."""
import json
import socket
import zipfile

import pytest

from dr import arrival as A
from dr import instructions as ins
from dr import prov as P
from dr import resolver
from dr.fixtures import lobby_fixture
from dr.mp_import import build_from_matterport
from dr.package import BuildingPackage, Grid, Prov
from dr.portfolio import build_light
from tests.test_arrival import JPEG, _site
from tests.test_instructions import lobby_segs
from tests.test_portfolio import put
from tests.test_mp_import import two_rooms


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    monkeypatch.setenv("DR_OFFLINE", "1")
    monkeypatch.setenv("DR_INDEX_CSV", str(resolver.ROOT / "data" / "fixtures" / "index_small.csv"))

    def boom(*a, **k):
        raise AssertionError("network call")
    monkeypatch.setattr(socket, "create_connection", boom)


def check(prov: dict):
    assert prov
    for k, v in prov.items():
        assert P.valid_key(k), f"undocumented prov key {k}"
        Prov.model_validate(v.model_dump())
        assert v.src in P.SOURCES and v.at and v.ref


def test_builder_rejects_bad_src_and_key():
    pb = P.ProvBuilder("2026-01-01T00:00:00+00:00")
    with pytest.raises(ValueError):
        pb.add("room:a", "gps", "x")
    with pytest.raises(ValueError):
        pb.add("bogus:key", "calc", "x")
    assert pb.add("landmark:desk.fixed", "ai", "pano:3", confidence=0.7).at.startswith("2026")


def test_key_patterns_cover_r10():
    for k in ("landmark:desk", "landmark:desk.fixed", "room:r1.label", "segment:s2.steps", "door:d1",
              "arrival.entrance_side", "resolver.suite"):
        assert P.valid_key(k)
    assert not P.valid_key("landmark:desk.other")


def test_arrival_keys(tmp_path):
    kw = _site(tmp_path)
    check(A.build("S", {}, **kw).prov)
    lat, lon = 29.9666, -95.5394
    ov = {"arrival": {"door_lat": lat, "door_lon": lon + 1e-4, "curb_lat": lat - 1e-4, "curb_lon": lon + 1e-4}}
    r = A.build("S", ov, **kw)
    check(r.prov)
    assert r.prov["arrival.door_pin"].src == "hand"
    assert "assumed" in r.prov["frames.geo_anchor"].ref and r.prov["frames.geo_anchor"].confidence is not None


def test_portfolio_and_import_keys(tmp_path):
    put(tmp_path, "g", two_rooms())
    pkg = build_light("g", tmp_path)
    check(pkg.prov)
    assert "assumed" in pkg.prov["entrance:assumed"].ref and pkg.prov["entrance:assumed"].confidence is not None
    assert pkg.prov["portfolio.destination"].inputs


def test_resolver_suite_entry():
    r = resolver.resolve("suite 106")
    check(r["prov_entries"])
    assert 0 <= r["prov_entries"]["resolver.suite"].confidence <= 1


def test_instruction_prov_keys():
    segs, lms, ents = lobby_segs()
    check(ins.prov_for(segs, lms))


def _pkg(segs, lms, ents):
    g = lobby_fixture()[0]
    g = Grid(res=g.res, width=g.cells.shape[1], height=g.cells.shape[0], origin=g.origin, cells_b64=g.to_b64())
    return BuildingPackage(id="t", name="t", source="fixture", generated_at="now", grid=g,
                           landmarks=lms, entrances=ents)


def test_every_spoken_number_has_a_prov_entry():
    """Task 7 re-runs this on the real build via pipeline.build_package; here a hand built package."""
    import re
    segs, lms, ents = lobby_segs()
    out = ins.write(segs, lms, ents)
    pkg = _pkg(out, lms, ents)
    pkg.prov.update(ins.prov_for(out, lms))
    for s in out:
        for m in re.finditer(r"[Ww]alk (\d+) steps?", s.instruction):
            assert f"segment:{s.id}.steps" in pkg.prov, s.instruction
            assert int(m.group(1)) == s.steps
        if re.search(r"\d+ o'clock", s.instruction):
            assert f"segment:{s.id}.clock" in pkg.prov
        # no number outside walk-steps and clock hours
        rest = re.sub(r"[Ww]alk \d+ steps?|\d+ o'clock", "", s.instruction)
        assert not re.search(r"\d", rest)
