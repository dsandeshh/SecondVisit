import json
import socket
from pathlib import Path

import pytest

from dr import portfolio
from dr.portfolio import PortfolioSkip, build_light, navigability, pick_candidates, run_portfolio
from tests.test_mp_import import two_rooms

FIX = Path(__file__).resolve().parents[2] / "data" / "fixtures"


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("network call")
    monkeypatch.setattr(socket, "create_connection", boom)


def put(root, sid, rooms_json):
    raw = root / sid / "raw"
    raw.mkdir(parents=True)
    (raw / "rooms.json").write_text(json.dumps(rooms_json))
    (raw / "basics.json").write_text(json.dumps({"model": {"id": sid}}))
    (raw / "panos.json").write_text(json.dumps({"model": {"panoLocations": [], "view": None}}))
    (raw / "index_row.json").write_text(json.dumps({"sid": sid, "name": f"Suite {sid}", "original_created": "2024-01-01"}))


@pytest.fixture
def root(tmp_path):
    a = two_rooms()  # pano labels "0" (x=3) and "1" (x=8)
    a["model"]["panoLocations"][0]["label"], a["model"]["panoLocations"][1]["label"] = "12", "3"
    put(tmp_path, "good1", a)
    put(tmp_path, "good2", two_rooms())
    nowalls = two_rooms()
    for f in nowalls["model"]["floors"]:
        f["edges"] = []
    put(tmp_path, "nowalls", nowalls)
    return tmp_path


def fake_nav(pkg, build_s=0.0):
    # deterministic: score by room count so the ranking is checkable
    return {"total": 50.0 + 10 * len(pkg.rooms) - (5 if pkg.id == "good2" else 0),
            "parts": {"mean_wall_share": 0.5}, "build_s": 0.01}


def test_assumed_entrance_is_lowest_numeric_label(root):
    pkg = build_light("good1", root)
    e = pkg.entrances[0]
    assert e.id == "assumed" and e.pos == (8.0, 2.0)  # pano labelled "3" beats "12"
    assert any("assumed entrance" in n for n in pkg.notes)


def test_ranking_deterministic_and_flags(root):
    cands = [{"sid": s, "name": s} for s in ("good2", "nowalls", "good1")]
    run = lambda: run_portfolio(cands, build=lambda sid: build_light(sid, root), nav=fake_nav, costar=lambda p: {})
    a, b = run(), run()
    assert [(r.sid, r.rank, r.total) for r in a] == [(r.sid, r.rank, r.total) for r in b]
    assert [r.sid for r in a] == ["good1", "good2", "nowalls"]
    assert [r.rank for r in a] == [1, 2, None]
    assert all(r.assumed_entrance for r in a[:2])


def test_model_without_walls_skipped_with_reason(root):
    with pytest.raises(PortfolioSkip, match="no walls"):
        build_light("nowalls", root)
    rows = run_portfolio([{"sid": "nowalls", "name": "x"}], build=lambda s: build_light(s, root), nav=fake_nav,
                         costar=lambda p: {})
    assert rows[0].skipped and "no walls" in rows[0].skipped and rows[0].total is None


def test_crash_in_builder_is_an_error_row():
    def bad(sid):
        raise KeyError("boom")
    r = run_portfolio([{"sid": "z", "name": "z"}], build=bad, nav=fake_nav, costar=lambda p: {})[0]
    assert r.error.startswith("KeyError") and r.skipped is None


def test_navigability_uses_injected_route_stack(root):
    pkg = build_light("good1", root)
    calls = []

    def plan(grid, a, b, lms):
        calls.append(b)
        return [a, b]

    out = navigability(pkg, build_s=1.5, plan=plan, segment=lambda p, g, l: p,
                       score_route=lambda s, g, l: {"total": 70.0, "parts": {
                           "length_m": 5, "wall_share": 0.6, "open_m": 1, "turns": 1, "decisions": 2,
                           "hazards": 0, "landmarks_per_10m": 0}})
    assert out["total"] == 70.0 and out["build_s"] == 1.5
    assert out["parts"]["mean_wall_share"] == 0.6 and len(calls) == 2  # destination plus the other room


def test_pick_candidates(tmp_path):
    hdr = "sid,name,segment,lat,lon,city,costar_property_id,pano_count,room_count,floor_count,ai_summary\n"
    rows = ["a,Downtown Office Suite,commercial,29.7,-95.4,Houston,1,9,6,1,yes",
            "b,Bayou Medical Clinic,commercial,29.7,-95.4,Houston,2,5,6,1,yes",
            "c,Small Clinic,commercial,29.7,-95.4,Houston,3,5,4,1,yes",
            "d,Tall Office,commercial,29.7,-95.4,Houston,4,5,6,2,yes",
            "e,Home Office,residential,29.7,-95.4,Houston,5,5,6,1,yes",
            "f,Dallas Office,commercial,32.7,-96.8,Dallas,6,5,6,1,yes",
            "g,Office NoId,commercial,29.7,-95.4,Houston,,5,6,1,yes"]
    p = tmp_path / "i.csv"
    p.write_text(hdr + "\n".join(rows) + "\n")
    assert [r["sid"] for r in pick_candidates(p, "Houston", 5)] == ["b", "a"]  # medical first


def test_interface_mismatch_is_an_error_row_not_a_skip(root):
    def bad_score(s, g, l):
        raise KeyError("parts")
    nav = lambda pkg, build_s=0.0: navigability(pkg, build_s, plan=lambda g, a, b, l: [a, b],
                                                segment=lambda p, g, l: p, score_route=bad_score)
    r = run_portfolio([{"sid": "good1", "name": "x"}], build=lambda s: build_light(s, root), nav=nav,
                      costar=lambda p: {})[0]
    assert r.error and r.error.startswith("KeyError") and r.skipped is None and r.total is None


def test_unreachable_side_room_counted_not_hidden(root):
    from dr.portfolio import NoRouteError
    pkg = build_light("good1", root)
    n = {"i": 0}

    def plan(g, a, b, l):
        n["i"] += 1
        if n["i"] == 2:
            raise NoRouteError("walled off")
        return [a, b]

    out = navigability(pkg, plan=plan, segment=lambda p, g, l: p,
                       score_route=lambda s, g, l: {"total": 60.0, "parts": {"wall_share": 0.5, "decisions": 1}})
    assert out["parts"]["routes_skipped"] == 1.0 and out["parts"]["routes"] == 1.0
