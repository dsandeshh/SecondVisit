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
    check(ins.prov_for(ins.write(segs, lms, ents)))


def _pkg(segs, lms, ents):
    from dr.package import Route, Score, ScoreParts
    g = lobby_fixture()[0]
    g = Grid(res=g.res, width=g.cells.shape[1], height=g.cells.shape[0], origin=g.origin, cells_b64=g.to_b64())
    sc = Score(total=1, parts=ScoreParts(length_m=1, wall_share=0, open_m=1, turns=0, decisions=0,
                                         hazards=0, landmarks_per_10m=0))
    route = Route(id="r", **{"from": "ent_w"}, to="desk", path=[s.start for s in segs], segments=segs, score=sc)
    return BuildingPackage(id="t", name="t", source="fixture", generated_at="now", grid=g,
                           landmarks=lms, entrances=ents, routes=[route])


def _full_pkg():
    segs, lms, ents = lobby_segs()
    out = ins.write(segs, lms, ents)
    pkg = _pkg(out, lms, ents)
    pkg.prov.update(ins.prov_for(out))
    return pkg


def test_every_spoken_number_has_a_prov_entry():
    """Task 7 re-runs P.missing_for_spoken on the real pipeline.build_package output."""
    pkg = _full_pkg()
    assert pkg.routes[0].segments[0].instruction
    assert P.missing_for_spoken(pkg) == []


def test_clock_prov_only_when_clock_is_spoken():
    pkg = _full_pkg()
    for s in pkg.routes[0].segments:
        assert (f"segment:{s.id}.clock" in pkg.prov) == ("o'clock" in s.instruction)


def test_checker_reports_dropped_entry_and_stray_numbers():
    pkg = _full_pkg()
    sid = pkg.routes[0].segments[0].id
    del pkg.prov[f"segment:{sid}.steps"]
    assert f"segment:{sid}.steps" in P.missing_for_spoken(pkg)
    pkg = _full_pkg()
    seg = pkg.routes[0].segments[0]
    seg.instruction = seg.instruction + " Take 3 elevators."
    assert any("unmapped spoken number 3" in m for m in P.missing_for_spoken(pkg))
    pkg = _full_pkg()
    last = pkg.routes[0].segments[-1]
    assert "o'clock" in last.instruction
    del pkg.prov[f"segment:{last.id}.clock"]
    assert f"segment:{last.id}.clock" in P.missing_for_spoken(pkg)
