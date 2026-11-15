"""One-off export of the invented lobby fixture to web/public/buildings/fixture/package.json (ruling R1).

Run from engine/: .venv/bin/python scripts/export_fixture.py
Task 7 later regenerates the same file with routes.
"""
from __future__ import annotations

import json
from pathlib import Path

from dr.fixtures import lobby_fixture
from dr.package import BuildingPackage, Grid

OUT = Path(__file__).resolve().parents[2] / "web" / "public" / "buildings" / "fixture" / "package.json"


def build() -> BuildingPackage:
    g, ents, lms = lobby_fixture()
    h, w = g.cells.shape
    return BuildingPackage(
        id="fixture", name="Fixture lobby", source="fixture", model_id=None,
        generated_at="2026-11-14T00:00:00Z",
        grid=Grid(res=g.res, width=w, height=h, origin=g.origin, cells_b64=g.to_b64()),
        entrances=ents, landmarks=lms, routes=[], sim={},
        notes=["Invented 20 x 12 m lobby for tests; not a real building."],
        map_date="2026-11-14",
    )


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(build().model_dump(mode="json", by_alias=True), indent=1) + "\n")
    print(f"wrote {OUT}")
