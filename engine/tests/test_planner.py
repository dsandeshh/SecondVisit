import math

import numpy as np
import pytest

from dr.config import WALL_TRAIL_M
from dr.fixtures import lobby_fixture
from dr.grid import OccGrid
from dr.planner import (NoRouteError, Weights, approach_point, drop_specks, plan,
                        plan_with_ladder, shortest)


def _setup():
    g, ents, lms = lobby_fixture()
    start = ents[0].pos
    goal = approach_point(g, lms[0].pos)
    return g, start, goal, lms


def _open(d):
    return np.clip((d - WALL_TRAIL_M) / 1.5, 0, 1)


def _open_metres(g, path):
    d = g.wall_distance()
    total = 0.0
    for a, b in zip(path, path[1:]):
        if _open(d[g.world_to_cell(b)]) > 0.5:
            total += math.dist(a, b)
    return total


def test_approach_point_moves_desk_toward_free_space():
    g, _, goal, _ = _setup()
    assert math.dist(goal, (18.5, 10.2)) <= 0.1


def test_reaches_goal():
    g, start, goal, lms = _setup()
    path = plan(g, start, goal, lms)
    assert math.dist(path[-1], goal) <= 0.2
    assert math.dist(path[0], start) <= 0.2


def test_follows_walls():
    g, start, goal, lms = _setup()
    path = plan(g, start, goal, lms)
    d = g.wall_distance()
    near = [d[g.world_to_cell(p)] <= WALL_TRAIL_M + 0.1 for p in path]
    assert sum(near) / len(near) >= 0.6


def test_less_open_than_shortest():
    g, start, goal, lms = _setup()
    cane = _open_metres(g, plan(g, start, goal, lms))
    short = _open_metres(g, shortest(g, start, goal))
    assert short > 0
    assert cane < 0.5 * short


def _boxed_lobby():
    g, start, goal, lms = _setup()
    c = g.cells.copy()
    r0, c0 = g.world_to_cell((16.8, 9.2))
    c[r0:r0 + 2, c0:] = 1          # south side of the box, joins the east wall
    c[r0:, c0:c0 + 2] = 1          # west side, joins the north wall
    return OccGrid(c, g.res, g.origin), start, goal, lms


def test_no_route():
    g, start, goal, lms = _boxed_lobby()
    with pytest.raises(NoRouteError) as e:
        plan(g, start, goal, lms)
    msg = str(e.value)
    assert "(0.50, 6.00)" in msg and "(18.50, 10.20)" in msg


# Review Focus 3: the retry ladder lowers clearance to no less than 0.25 m and raises
# drop_specks_m2 to 0.10; a relaxed route is labelled; a closed box still fails.

def _two_rooms(door_m: float, speck: bool = False) -> OccGrid:
    """10 x 6 m, interior wall at x = 5 with a door of door_m centred at y = 3."""
    res = 0.1
    c = np.zeros((60, 100), dtype=np.uint8)
    c[:2, :] = 1
    c[-2:, :] = 1
    c[:, :2] = 1
    c[:, -2:] = 1
    c[:, 49:51] = 1
    n = round(door_m / res)
    lo = 30 - n // 2
    c[lo:lo + n, 49:51] = 0
    if speck:
        c[lo:lo + n, 49] = 3       # scan noise: a 0.1 m line closing the door
    return OccGrid(c, res, (0.0, 0.0))


def test_drop_specks_keeps_walls():
    g = _two_rooms(0.8, speck=True)
    c = g.cells.copy()
    c[10:12, 20:22] = 1            # a tiny wall stub
    c[40:42, 20:22] = 2            # a tiny fixed obstacle blob
    out = drop_specks(OccGrid(c, g.res, g.origin), 0.10).cells
    assert (out[10:12, 20:22] == 1).all()
    assert (out[40:42, 20:22] == 0).all()
    assert (out[:, 49] != 3).all()
    assert (out == 1).sum() == (c == 1).sum()


def test_ladder_drops_specks():
    g = _two_rooms(0.8, speck=True)
    s, t = (2.5, 3.0), (7.5, 3.0)
    with pytest.raises(NoRouteError):
        plan(g, s, t, [])
    r = plan_with_ladder(g, s, t, [])
    assert r.relaxed and r.weights.drop_specks_m2 == pytest.approx(0.10)
    assert math.dist(r.path[-1], t) <= 0.2


def test_ladder_lowers_clearance_not_below_025():
    g = _two_rooms(0.6)
    s, t = (2.5, 3.0), (7.5, 3.0)
    with pytest.raises(NoRouteError):
        plan(g, s, t, [])
    r = plan_with_ladder(g, s, t, [])
    assert r.relaxed and 0.25 <= r.weights.clearance_m < 0.35


def test_ladder_unrelaxed_when_route_exists():
    g, start, goal, lms = _setup()
    r = plan_with_ladder(g, start, goal, lms)
    assert not r.relaxed and r.weights == Weights()


def test_ladder_fails_on_closed_box():
    g = _two_rooms(0.3)            # too narrow even at 0.25 m clearance
    with pytest.raises(NoRouteError) as e:
        plan_with_ladder(g, (2.5, 3.0), (7.5, 3.0), [])
    assert "(2.50, 3.00)" in str(e.value) and "(7.50, 3.00)" in str(e.value)
