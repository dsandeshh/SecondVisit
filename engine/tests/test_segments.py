from dr.fixtures import lobby_fixture
from dr.planner import approach_point, plan, shortest
from dr.score import score_route
from dr.segments import segment


def test_l_route():
    g, _, lms = lobby_fixture()
    s = segment([(0, 0), (0, 7), (5.6, 7)], g, lms)
    assert len(s) == 2
    assert [x.steps for x in s] == [10, 8]
    assert s[0].turn_after == "right" and abs(s[0].turn_deg - 90) <= 5
    assert s[0].heading_deg == 0 and s[1].turn_after == "none" and s[1].instruction == ""


def test_dp_merges_shallow_turns():
    g, _, lms = lobby_fixture()
    s = segment([(2, 2), (2, 5), (2.3, 8), (2, 11)], g, lms)
    assert len(s) == 1


def test_score_range():
    g, ents, lms = lobby_fixture()
    goal = approach_point(g, lms[0].pos)
    res = []
    for p in (plan(g, ents[0].pos, goal, lms), shortest(g, ents[0].pos, goal)):
        sc = score_route(segment(p, g, lms), g, lms)
        assert 0 <= sc["total"] <= 100
        assert {"wall_share", "decisions", "length_m"} <= set(sc["parts"])
        res.append(sc["total"])
    assert res[0] > res[1]


def test_score_empty_and_parts():
    g, ents, lms = lobby_fixture()
    assert score_route([], g, lms)["total"] == 0.0
    goal = approach_point(g, lms[0].pos)
    segs = segment(plan(g, ents[0].pos, goal, lms), g, lms)
    sc = score_route(segs, g, lms)
    assert abs(sc["parts"]["length_m"] - sum(s.length_m for s in segs)) < 0.05
    assert sc["parts"]["turns"] == len(segs) - 1
    assert 0 <= sc["parts"]["wall_share"] <= 1


def test_wall_side_values_valid():
    g, ents, lms = lobby_fixture()
    goal = approach_point(g, lms[0].pos)
    for s in segment(plan(g, ents[0].pos, goal, lms), g, lms):
        assert s.wall_side in ("left", "right", "none")
        assert s.steps >= 1
