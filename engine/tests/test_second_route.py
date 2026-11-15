import pytest

from dr.mp_import import DATA

SID = "x37LjPx62VA"
pytestmark = pytest.mark.skipif(not (DATA / SID / "raw" / "rooms.json").exists(), reason="clinic cache not present")


def test_second_route_and_costar(tmp_path):
    from dr import pipeline
    pkg = pipeline.build_package(SID, web_root=tmp_path)
    assert [r.id for r in pkg.routes] == ["ent_main__dest", "ent_main__door_13"]
    r2 = pkg.routes[1]
    steps = sum(s.steps for s in r2.segments)
    assert 15 <= steps <= 25  # TRIAGE: best simulated arrival of the clinic doors (~45%, see overrides second_destination)
    fixed = {l for s in r2.segments for l in s.landmarks_passed if any(m.id == l and m.fixed for m in pkg.landmarks)}
    assert len(fixed) >= 3
    ids = [s.id for r in pkg.routes for s in r.segments]
    assert len(ids) == len(set(ids))  # prov keys stay unique
    assert pkg.costar["property"]["id"] and pkg.prov["costar"].src == "costar"
    assert pkg.costar["property"]["frontage"][0]["street"] == "Breton Ridge"
