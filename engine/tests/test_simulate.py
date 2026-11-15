import math

import numpy as np

from dr import pipeline
from dr.grid import OccGrid
from dr.package import Segment
from dr.simulate import ErrorModel, simulate, simulate_package


def _route():
    pkg = pipeline.fixture_package()
    pipeline.add_route(pkg)
    g = pipeline.promote_fixed(pipeline._grid(pkg), pkg.landmarks)
    return pkg, g, pkg.routes[0]


def _vague(route, i):
    segs = list(route.segments)
    segs[i] = segs[i].model_copy(update={"instruction": "Keep going until you reach the doorway."})
    return route.model_copy(update={"segments": segs})


def test_deterministic():
    _, g, r = _route()
    a, b = simulate(g, r, 100, seed=3), simulate(g, r, 100, seed=3)
    assert a.arrival_rate == b.arrival_rate and a.lost_cells_b64 == b.lost_cells_b64
    assert a.runs == 100 and 0.0 <= a.arrival_rate <= 1.0


def test_perfect_walker_arrives():
    _, g, r = _route()
    assert simulate(g, r, 20, 0, ErrorModel(step_sd=0.0, heading_bias_sd=0.0, heading_noise_sd=0.0,
                                            count_sd_frac=0.0, vague_count_sd_frac=0.0)).arrival_rate > 0.9


def test_vague_lowers_arrival():
    _, g, r = _route()
    base = simulate(g, r, 300, seed=0).arrival_rate
    # the fixture's segment 2 is a one step jog, so take the segment whose step number matters most
    worst = min(simulate(g, _vague(r, i), 300, seed=0).arrival_rate for i in range(len(r.segments)))
    assert base - worst >= 0.15, (base, worst)


def test_lost_heatmap_peaks_near_vague_segment():
    _, g, r = _route()
    i = max(range(len(r.segments)),
            key=lambda k: base_drop(g, r, k))
    res = simulate(g, _vague(r, i), 300, seed=0)
    lost = OccGrid.from_b64(res.lost_cells_b64, g.cells.shape[1], g.cells.shape[0], g.res, g.origin).cells
    rr, cc = np.unravel_index(np.argmax(lost), lost.shape)
    peak = g.cell_to_world((int(rr), int(cc)))
    s = r.segments[i]
    nxt = r.segments[min(i + 1, len(r.segments) - 1)]
    near = min(_pt_seg(peak, a.start, a.end) for a in (s, nxt))
    assert near <= 3.5


def base_drop(g, r, k):
    return -simulate(g, _vague(r, k), 100, seed=0).arrival_rate


def _pt_seg(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dy * dy
    t = 0 if L2 == 0 else min(1, max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)


def test_simulate_package_keyed_by_route():
    pkg, _, r = _route()
    out = simulate_package(pkg, 20)
    assert set(out) == {r.id} and out[r.id].runs == 20
