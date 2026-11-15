import numpy as np

from dr.fixtures import lobby_fixture
from dr.grid import OccGrid
from dr.package import BuildingPackage, Grid


def test_b64_roundtrip():
    g, _, _ = lobby_fixture()
    h, w = g.cells.shape
    g2 = OccGrid.from_b64(g.to_b64(), w, h, g.res, g.origin)
    assert np.array_equal(g.cells, g2.cells)


def test_world_cell_roundtrip():
    g, _, _ = lobby_fixture()
    for p in [(0.5, 6.0), (18.5, 10.8), (10.01, 5.99), (3.33, 7.77)]:
        q = g.cell_to_world(g.world_to_cell(p))
        assert abs(q[0] - p[0]) <= g.res / 2 + 1e-9
        assert abs(q[1] - p[1]) <= g.res / 2 + 1e-9


def test_wall_distance():
    g, ents, lms = lobby_fixture()
    d = g.wall_distance()
    r, c = g.world_to_cell((3, 3))
    assert abs(d[r, c] - 2.8) <= 0.15
    r, c = g.world_to_cell((10, 6))
    assert d[r, c] == 0  # inside the pillar
    assert ents[0].id == "ent_w" and lms[0].id == "desk"
    # west gap is open
    r, c = g.world_to_cell((0.1, 6.0))
    assert g.cells[r, c] == 0


def test_package_json_roundtrip():
    g, ents, lms = lobby_fixture()
    h, w = g.cells.shape
    pkg = BuildingPackage(
        id="fixture", name="Lobby", source="fixture", model_id=None,
        generated_at="2026-11-14T00:00:00Z",
        grid=Grid(res=g.res, width=w, height=h, origin=g.origin, cells_b64=g.to_b64()),
        rooms=[], doors=[], landmarks=lms, entrances=ents, routes=[], sim={},
        arrival=None, notes=[],
    )
    back = BuildingPackage.model_validate_json(pkg.model_dump_json())
    assert back == pkg
    assert back.version == 1 and back.prov == {} and back.frames.geo_anchor is None


def test_route_serializes_from_key():
    from dr.package import Route, Score, ScoreParts
    r = Route(id="r", **{"from": "ent_w"}, to="desk", path=[(0, 0)], segments=[],
              score=Score(total=1, parts=ScoreParts(length_m=1, wall_share=0, open_m=0, turns=0,
                                                    decisions=0, hazards=0, landmarks_per_10m=0)))
    assert '"from":"ent_w"' in r.model_dump_json()
    assert Route.model_validate_json(r.model_dump_json()) == r
