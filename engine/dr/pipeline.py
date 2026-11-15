"""Package assembly (ruling R9): import, merge overrides and landmarks, plan, segment, write, score.

`build_package(sid, ...)` is called by the CLI and by Task 13's DrEngine. Offline: it reads only
`data/<sid>/raw/` and `data/<sid>/landmarks.json`; it never calls a sponsor API.
"""
from __future__ import annotations

import json
import math
import shutil
from dataclasses import replace
from pathlib import Path

import numpy as np
from scipy.ndimage import label

from dr import instructions
from dr.grid import OccGrid
from dr.mp_import import DATA, build_from_matterport, load_overrides
from dr.mp_client import ROOT
from dr.package import BuildingPackage, Entrance, Grid, Landmark, Prov, Route, Score
from dr.planner import NoRouteError, Weights, approach_point, plan_with_ladder
from dr.prov import ProvBuilder
from dr.score import score_route
from dr.segments import segment

WEB_BUILDINGS = ROOT / "web" / "public" / "buildings"
PROMOTE_M = 0.6  # code 3 blobs this close to a fixed landmark become fixed (2)


def _grid(pkg: BuildingPackage) -> OccGrid:
    g = pkg.grid
    return OccGrid.from_b64(g.cells_b64, g.width, g.height, g.res, g.origin)


def promote_fixed(grid: OccGrid, landmarks: list[Landmark]) -> OccGrid:
    """R13: movable (3) blobs within PROMOTE_M of a fixed landmark become fixed obstacles (2)."""
    g = OccGrid(grid.cells.copy(), grid.res, grid.origin)
    lab, _ = label(g.cells == 3, structure=np.ones((3, 3)))
    rr, cc = np.nonzero(g.cells == 3)
    if len(rr) == 0:
        return g
    xy = np.column_stack([g.origin[0] + (cc + 0.5) * g.res, g.origin[1] + (rr + 0.5) * g.res])
    hit: set[int] = set()
    for lm in landmarks:
        if lm.fixed:
            d = np.hypot(xy[:, 0] - lm.pos[0], xy[:, 1] - lm.pos[1])
            hit.update(int(x) for x in lab[rr[d <= PROMOTE_M], cc[d <= PROMOTE_M]])
    for i in hit:
        g.cells[lab == i] = 2
    return g


def merge_landmarks(pkg: BuildingPackage, sid: str, data_root: Path = DATA) -> None:
    """landmarks.json (Task 3), then overrides.json (R5): deleted ids, extras, destination."""
    now = ProvBuilder().at
    ov = load_overrides(sid, data_root)
    lms: dict[str, Landmark] = {}
    p = Path(data_root) / sid / "landmarks.json"
    if p.exists():
        d = json.loads(p.read_text())
        for x in d.get("landmarks", []):
            lm = Landmark.model_validate(x)
            lms[lm.id] = lm
        for k, v in (d.get("prov") or {}).items():
            pkg.prov[k] = Prov.model_validate(v)
        by = {r.id: r for r in pkg.rooms}
        for rid, r in (d.get("rooms") or {}).items():
            if rid in by and r.get("label"):
                by[rid].label = r["label"]
        pkg.notes.append(f"landmarks: {len(lms)} from the annotator")
    for lid in ov.deleted_landmark_ids:
        lms.pop(lid, None)
    for lm in ov.extra_landmarks:
        lms[lm.id] = lm
        pkg.prov[f"landmark:{lm.id}"] = Prov(src="hand", ref="overrides.json", at=now)
    dest = ov.destination_landmark()
    if dest is not None:
        lms[dest.id] = dest
        pkg.prov[f"landmark:{dest.id}"] = Prov(src="hand", ref="overrides.json destination", at=now)
    pkg.landmarks = list(lms.values())


def add_route(pkg: BuildingPackage, from_id: str | None = None, to_id: str | None = None,
              clearance: float | None = None, drop_specks: float | None = None) -> BuildingPackage:
    """Plan one route (default: first entrance to the first desk), segment, write, score. Mutates pkg."""
    grid = promote_fixed(_grid(pkg), pkg.landmarks)
    by_id: dict[str, tuple[float, float]] = {e.id: e.pos for e in pkg.entrances}
    by_id.update({lm.id: lm.pos for lm in pkg.landmarks})
    if from_id is None:
        if not pkg.entrances:
            raise SystemExit("no entrance: set one in data/<sid>/overrides.json (pick.html) or pass --from")
        from_id = pkg.entrances[0].id
    if to_id is None:
        desks = [lm for lm in pkg.landmarks if lm.kind == "desk"]
        if not desks:
            raise SystemExit("no desk landmark: set a destination in overrides.json or pass --to")
        to_id = desks[0].id
    for i in (from_id, to_id):
        if i not in by_id:
            raise SystemExit(f"unknown id {i!r}; known: {', '.join(sorted(by_id))}")
    w = Weights()
    if clearance is not None:
        w = replace(w, clearance_m=clearance)
    if drop_specks is not None:
        w = replace(w, drop_specks_m2=drop_specks)
    start, goal = by_id[from_id], approach_point(grid, by_id[to_id])
    try:
        pr = plan_with_ladder(grid, start, goal, pkg.landmarks, w)
    except NoRouteError as e:
        raise SystemExit(f"{e}. Try --clearance 0.25 --drop-specks 0.10") from e
    segs = instructions.write(segment(pr.path, grid, pkg.landmarks), pkg.landmarks, pkg.entrances,
                              dest=to_id if any(lm.id == to_id for lm in pkg.landmarks) else None)
    sc = score_route(segs, grid, pkg.landmarks)
    rid = f"{from_id}__{to_id}"
    pkg.routes = [Route(id=rid, **{"from": from_id}, to=to_id, path=pr.path, segments=segs,
                        score=Score(total=sc["total"], parts=sc["parts"]))]
    pkg.prov.update(instructions.prov_for(segs, pkg.generated_at))
    if pr.relaxed:
        pkg.notes.append(f"relaxed: route {rid} needed clearance {pr.weights.clearance_m} m, "
                         f"drop specks {pr.weights.drop_specks_m2} m2")
    return pkg


def run_sim(pkg: BuildingPackage, n: int) -> None:
    try:
        from dr import simulate
    except ImportError as e:
        raise SystemExit("--sim needs dr.simulate (Task 11), which is not on this branch yet") from e
    pkg.sim = simulate.simulate_package(pkg, n)  # Task 11 interface
    pkg.notes.append(f"simulated traveller: {n} runs per route; arrival rates are simulated, not measured")


def copy_floorplan(sid: str, web_root: Path | None = None, data_root: Path = DATA) -> list[str]:
    """R16: floorplan.jpg and floorplan.json to web/public/buildings/<sid>/ (gitignored)."""
    out = Path(web_root or WEB_BUILDINGS) / sid
    out.mkdir(parents=True, exist_ok=True)
    done = []
    for n in ("floorplan.jpg", "floorplan.json"):
        src = Path(data_root) / sid / "raw" / n
        if src.exists():
            shutil.copyfile(src, out / n)
            done.append(n)
    return done


def build_package(sid: str, from_id: str | None = None, to_id: str | None = None,
                  clearance: float | None = None, drop_specks: float | None = None, sim: int = 0,
                  data_root: Path = DATA, web_root: Path | None = None,
                  arrival: bool = True) -> BuildingPackage:
    pkg = build_from_matterport(sid, data_root)
    merge_landmarks(pkg, sid, data_root)
    if arrival:
        try:
            from dr import arrival as arr
            ov = load_overrides(sid, data_root).model_dump(mode="json")
            res = arr.build(sid, ov, data_dir=Path(data_root), web_dir=Path(web_root or WEB_BUILDINGS))
            pkg.arrival = res.arrival
            pkg.prov.update(res.prov)
            if res.geo_anchor is not None:
                pkg.frames.geo_anchor = res.geo_anchor
        except Exception as e:  # offline and optional: the route does not depend on it
            pkg.notes.append(f"arrival skipped: {type(e).__name__}: {str(e)[:80]}")
    add_route(pkg, from_id, to_id, clearance, drop_specks)
    if sim:
        run_sim(pkg, sim)
    missing = copy_floorplan(sid, web_root, data_root)
    if len(missing) < 2:
        pkg.notes.append("floor plan files missing: viewers show 'Floor plan not available'")
    return pkg


def fixture_package() -> BuildingPackage:
    from dr.fixtures import lobby_fixture
    g, ents, lms = lobby_fixture()
    h, w = g.cells.shape
    return BuildingPackage(
        id="fixture", name="Fixture lobby", source="fixture", model_id=None,
        generated_at="2026-11-14T00:00:00Z",
        grid=Grid(res=g.res, width=w, height=h, origin=g.origin, cells_b64=g.to_b64()),
        entrances=ents, landmarks=lms, notes=["Invented 20 x 12 m lobby for tests; not a real building."],
        map_date="2026-11-14")
