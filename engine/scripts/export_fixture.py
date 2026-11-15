"""One-off export of the invented lobby fixture to web/public/buildings/fixture/package.json (ruling R1).

Run from engine/: .venv/bin/python scripts/export_fixture.py
Task 7 later regenerates the same file with routes.
"""
from __future__ import annotations

import json
from pathlib import Path

from dr.fixtures import lobby_fixture
from dr.package import BuildingPackage, Grid, Route, Score, ScoreParts, Segment

OUT = Path(__file__).resolve().parents[2] / "web" / "public" / "buildings" / "fixture" / "package.json"


def _route() -> Route:
    """Hand written 3 stretch route (invented; Task 7 replaces it with a planned one)."""
    def seg(i, a, b, h, steps, wall, open_m, turn, deg, text):
        return Segment(id=f"s{i}", start=a, end=b, heading_deg=h, length_m=round(abs(b[0] - a[0]) + abs(b[1] - a[1]), 2),
                       steps=steps, wall_side=wall, open_m=open_m, landmarks_passed=[], turn_after=turn,
                       turn_deg=deg, instruction=text)
    segs = [
        seg(1, (0.5, 6.0), (8.0, 6.0), 90, 11, "none", 7.5, "left", 90,
            "Walk about 11 steps. Then turn left."),
        seg(2, (8.0, 6.0), (8.0, 10.8), 0, 7, "none", 4.8, "right", 90,
            "Walk about 7 steps. Then turn right."),
        seg(3, (8.0, 10.8), (17.5, 10.8), 90, 14, "left", 0.0, "none", 0,
            "Wall on your left. Walk about 14 steps to the reception desk."),
    ]
    path = [segs[0].start, segs[0].end, segs[1].end, segs[2].end]
    return Route(id="r1", **{"from": "ent_w"}, to="desk", path=path, segments=segs,
                 score=Score(total=60.0, parts=ScoreParts(length_m=21.8, wall_share=0.4, open_m=12.3, turns=2,
                                                           decisions=0, hazards=0, landmarks_per_10m=0.0)))


def build() -> BuildingPackage:
    g, ents, lms = lobby_fixture()
    h, w = g.cells.shape
    return BuildingPackage(
        id="fixture", name="Fixture lobby", source="fixture", model_id=None,
        generated_at="2026-11-14T00:00:00Z",
        grid=Grid(res=g.res, width=w, height=h, origin=g.origin, cells_b64=g.to_b64()),
        entrances=ents, landmarks=lms, routes=[_route()], sim={},
        notes=["Invented 20 x 12 m lobby for tests; not a real building. Route is hand written."],
        map_date="2026-11-14",
    )


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(build().model_dump(mode="json", by_alias=True), indent=1) + "\n")
    print(f"wrote {OUT}")
