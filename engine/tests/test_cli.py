import json
import shutil
from pathlib import Path

import numpy as np
import pytest

from dr import cli, pipeline
from dr.grid import OccGrid
from dr.package import BuildingPackage, Landmark

ROOT = Path(__file__).resolve().parents[2]


def test_build_fixture(tmp_path):
    out = tmp_path / "package.json"
    assert cli.main(["build", "--source", "fixture", "--out", str(out)]) == 0
    pkg = BuildingPackage.model_validate_json(out.read_text())
    assert len(pkg.routes) == 1
    r = pkg.routes[0]
    assert len(r.segments) >= 2 and all(s.instruction for s in r.segments)
    assert r.from_ == "ent_w" and r.to == "desk"
    assert any(k.startswith("segment:") for k in pkg.prov)


def test_sim_errors_clearly_when_absent(tmp_path):
    try:
        import dr.simulate  # noqa: F401
        pytest.skip("simulate present")
    except ImportError:
        pass
    with pytest.raises(SystemExit) as e:
        cli.main(["build", "--source", "fixture", "--out", str(tmp_path / "p.json"), "--sim", "5"])
    assert "simulate" in str(e.value)


def test_promote_fixed_landmarks():
    c = np.zeros((40, 40), np.uint8)
    c[10:14, 10:14] = 3   # under the fixed desk
    c[30:33, 30:33] = 3   # far away, stays movable
    g = OccGrid(c, 0.1, (0.0, 0.0))
    lm = [Landmark(id="d", kind="desk", label="Desk", pos=(1.2, 1.2), confidence=1, fixed=True),
          Landmark(id="s", kind="seating", label="Seats", pos=(3.15, 3.15), confidence=1, fixed=False)]
    g2 = pipeline.promote_fixed(g, lm)
    assert (g2.cells[10:14, 10:14] == 2).all() and (g2.cells[30:33, 30:33] == 3).all()


CLINIC = ROOT / "data" / "x37LjPx62VA"


@pytest.mark.skipif(not (CLINIC / "raw" / "rooms.json").exists(), reason="no cached clinic data")
def test_clinic_route_entrance_to_desk(tmp_path):
    web = tmp_path / "buildings"
    pkg = pipeline.build_package("x37LjPx62VA", web_root=web, arrival=False)
    assert pkg.routes and pkg.routes[0].from_ == "ent_main" and pkg.routes[0].to == "dest"
    g = OccGrid.from_b64(pkg.grid.cells_b64, pkg.grid.width, pkg.grid.height, pkg.grid.res, pkg.grid.origin)
    from shapely.geometry import Point, Polygon
    ns = [Polygon(r.polygon) for r in pkg.rooms if not r.scanned]
    assert ns
    for p in pkg.routes[0].path:
        assert not any(poly.contains(Point(p)) for poly in ns)
    assert (web / "x37LjPx62VA" / "floorplan.json").exists()
    assert (web / "x37LjPx62VA" / "floorplan.jpg").exists()


def test_sim_fixture_cli_labels_simulated(tmp_path):
    out = tmp_path / "p.json"
    assert cli.main(["build", "--source", "fixture", "--out", str(out), "--sim", "20"]) == 0
    import json
    d = json.loads(out.read_text())
    assert d["sim"][d["routes"][0]["id"]]["runs"] == 20
    assert any("simulated" in n for n in d["notes"])


def test_destination_landmark_id_from_overrides_is_routed(tmp_path):
    """overrides.json destination {landmark_id} (no desk in the building) is the route target."""
    FIX = ROOT / "data" / "fixtures" / "mp_square_room.json"
    raw = tmp_path / "sq" / "raw"
    raw.mkdir(parents=True)
    shutil.copy(FIX, raw / "rooms.json")
    (tmp_path / "sq" / "overrides.json").write_text(json.dumps({
        "entrance": {"id": "ent_main", "label": "Main entrance", "pos": [1, 1], "heading_deg": 90, "src": "calc"},
        "destination": {"landmark_id": "restroom_1"}}))
    lm = Landmark(id="restroom_1", kind="restroom", label="toilet", pos=(5, 3), confidence=0.47, fixed=True)
    (tmp_path / "sq" / "landmarks.json").write_text(json.dumps({"landmarks": [lm.model_dump(mode="json")]}))
    pkg = pipeline.build_package("sq", data_root=tmp_path, web_root=tmp_path / "web", arrival=False)
    assert pkg.routes[0].to == "restroom_1" and pkg.routes[0].from_ == "ent_main"
