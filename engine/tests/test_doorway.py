import numpy as np

from dr.doorway import add_doorways, find_doorways
from dr.grid import OccGrid
from dr.grounding import grounded
from dr.instructions import write
from dr.package import Landmark
from dr.segments import segment


def _grid(gap=(4.55, 5.45)):
    g = np.zeros((100, 120), dtype=np.uint8)           # 10 m x 12 m at 0.1
    g[:, 49:52] = 1                                      # wall at x 4.9..5.2
    lo, hi = int(gap[0] * 10), int(gap[1] * 10)
    g[lo:hi, 49:52] = 0                                  # the gap
    return OccGrid(g, 0.1, (0.0, 0.0))


def _lms():
    return [Landmark(id="ctr", kind="desk", label="Reception counter", pos=(4.7, 6.4), confidence=0.9, fixed=True, spoken="reception counter"),
            Landmark(id="gl", kind="other", label="Glass wall", pos=(5.0, 3.6), confidence=0.9, fixed=True, spoken="glass wall")]


def test_find_doorway_in_narrow_gap():
    ds = find_doorways([(1.0, 5.0), (9.0, 5.0)], _grid())
    assert len(ds) == 1 and abs(ds[0].pos[0] - 5.05) < 0.4 and 0.8 <= ds[0].width_m <= 1.0


def test_wide_opening_is_not_a_doorway():
    assert find_doorways([(1.0, 5.0), (9.0, 5.0)], _grid(gap=(3.0, 7.0))) == []


def test_doorway_line_with_steps_turn_and_names():
    g, lms = _grid(), _lms()
    path = [(1.0, 5.0), (5.05, 5.0), (8.0, 2.0)]
    segs = write(segment(path, g, lms), lms, [])
    out = add_doorways(segs, path, g, lms)
    line = next(s.instruction for s in out if "doorway" in s.instruction)
    assert "In 6 steps, turn right through the doorway between the reception counter and the glass wall" in line
    assert grounded(line, [s.steps for s in out] + list(range(1, 13)))
    assert [s.id for s in out] == [f"s{i + 1}" for i in range(len(out))]


def test_straight_through_and_split_and_wall_fallback():
    g, lms = _grid(), []
    path = [(1.0, 5.0), (9.0, 5.0)]
    out = add_doorways(write(segment(path, g, lms), lms, []), path, g, lms)
    assert len(out) == 2
    assert out[0].instruction.endswith("go straight through the doorway between the wall and the wall.") or "between the wall and the wall" in out[0].instruction
    assert out[0].steps == round(out[0].length_m / 0.7) and out[1].instruction.startswith("Walk ")
    assert abs(out[0].end[0] - 5.05) < 0.4 and out[0].end == out[1].start
