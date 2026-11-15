import math

import numpy as np

from dr import layout
from dr.config import GRID_RES
from dr.fixtures import lobby_fixture
from dr.package import BuildingPackage, Grid, Landmark, SimResult


def test_candidates_keep_doors_clear():
    g, ents, _ = lobby_fixture()
    cs = layout.candidates(g, ents, n=40)
    assert cs
    wd = g.wall_distance()
    for p in cs:
        assert min(math.dist(p, e.pos) for e in ents) >= 1.2
        assert wd[g.world_to_cell(p)] <= 0.8 + 1e-6
        assert g.cells[g.world_to_cell(p)] == 0


def _fake_sim(grid, route, runs=100, seed=0):
    # arrival falls with open metres: deterministic stand-in for simulate()
    return SimResult(runs=runs, arrival_rate=max(0.0, 1 - 0.03 * route.score.parts.open_m),
                     lost_cells_b64="")


def _pkg(desk_pos):
    g, ents, lms = lobby_fixture()
    lm = lms[0].model_copy(update={"pos": desk_pos})
    return BuildingPackage(
        id="fx", name="fx", source="fixture", generated_at="t",
        grid=Grid(res=g.res, width=g.cells.shape[1], height=g.cells.shape[0], origin=g.origin,
                  cells_b64=g.to_b64()),
        landmarks=[lm], entrances=ents)


def test_advise_improves_fixture():
    rep = layout.advise(_pkg((10.0, 9.0)), "desk", sim_fn=_fake_sim)
    assert rep["best"]["score"] > rep["current"]["score"]
    assert rep["best"]["arrival_rate"] >= rep["current"]["arrival_rate"]
    assert rep["fixes"] == []
    assert rep["rounds"]


def test_report_numbers_from_code():
    rep = layout.advise(_pkg((10.0, 9.0)), "desk", sim_fn=_fake_sim)
    ev = layout.evaluate(*_args(rep), sim_fn=_fake_sim)
    assert rep["best"]["score"] == ev["score"]
    assert rep["best"]["arrival_label"].startswith("simulated")


def _args(rep):
    g, ents, lms = lobby_fixture()
    return g, ents, rep["best_pos"]


def test_fixes_change_grid_and_plan():
    g, ents, lms = lobby_fixture()
    seat = layout.fix_between((3.0, 3.0), (3.0, 5.0), "seating_edge")
    g2 = layout.apply_fixes(g, [seat])[0]
    assert g2.cells[g.world_to_cell((3.0, 4.0))] == 3
    assert g.cells[g.world_to_cell((3.0, 4.0))] == 0
    strip = layout.fix_between((1.0, 6.0), (18.0, 6.0), "tactile_strip")
    ev = layout.evaluate(g, ents, (18.5, 10.8), [strip], landmarks=[], sim_fn=_fake_sim)
    assert ev["route"].path
