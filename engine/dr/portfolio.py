"""Task 20: headless portfolio ranking of Houston office and medical suites by navigability.

    python -m dr.portfolio --city Houston --n 20 --out web/public/portfolio.json
(Task 7's cli.py registers the same `main` as `python -m dr.cli portfolio`.)
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import numpy as np
from shapely.geometry import Polygon

from dr import probe, resolver
from dr.grid import OccGrid
from dr.mp_import import build_from_matterport
from dr.package import BuildingPackage, Entrance, PortfolioRow, Prov, Room

MEDICAL_WORDS = ("clinic", "medical", "doctor", "dental", "physician", "health", "surgery", "urgent care")
OFFICE_WORDS = ("office", "suite", "ste ", "ste.", "professional", "plaza", "tower", "center", "centre")
DEST_LABELS = ("reception", "lobby", "waiting")
TOUR = "https://my.matterport.com/show/?m="


class PortfolioSkip(Exception):
    """A model that cannot be scored; the message is the reason shown in the table."""


# ---------------------------------------------------------------- candidates

def _int(v) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def pick_candidates(index_csv: Path | str | None = None, city: str = "Houston", n: int = 20) -> list[dict]:
    path = Path(index_csv or probe.INDEX_CSV)
    out = []
    with path.open(newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if (r.get("segment") or "").strip().lower() != "commercial":
                continue
            if (r.get("city") or "").strip().lower() != city.strip().lower():
                continue
            if not (r.get("lat") or "").strip() or not (r.get("costar_property_id") or "").strip():
                continue
            if _int(r.get("room_count")) < 5 or _int(r.get("floor_count")) != 1:
                continue
            name = (r.get("name") or "").lower()
            med = any(w in name for w in MEDICAL_WORDS)
            if not (med or any(w in name for w in OFFICE_WORDS)):
                continue
            out.append((not med, -_int(r.get("pano_count")), r["sid"], r))
    out.sort(key=lambda t: t[:3])  # medical first, then richer scans, then sid for determinism
    return [t[3] for t in out[:n]]


# ---------------------------------------------------------------- light build

def _json(p: Path):
    return json.loads(p.read_text())


def _pano_labels(raw: Path) -> dict[str, tuple[str, tuple[float, float]]]:
    for name in ("rooms.json", "panos.json"):
        if (raw / name).exists():
            locs = (_json(raw / name).get("model") or {}).get("panoLocations") or []
            if locs:
                return {l["id"]: (str(l.get("label") or ""), (float(l["position"]["x"]), float(l["position"]["y"])))
                        for l in locs}
    return {}


def assumed_entrance_pano(raw: Path) -> tuple[str, tuple[float, float]] | None:
    """The pano with the lowest numeric label: scan order usually starts at the door."""
    panos = _pano_labels(raw)
    if not panos:
        return None
    numeric = [(int(lab), pid) for pid, (lab, _) in panos.items() if lab.strip().lstrip("-").isdigit()]
    pid = min(numeric)[1] if numeric else sorted(panos)[0]
    return pid, panos[pid][1]


def snap_free(grid: OccGrid, p: tuple[float, float]) -> tuple[float, float]:
    """Nearest free cell centre to p (so a room centroid is always walkable)."""
    free = np.argwhere(grid.cells == 0)
    if not len(free):
        return p
    r0, c0 = grid.world_to_cell(p)
    i = int(np.argmin((free[:, 0] - r0) ** 2 + (free[:, 1] - c0) ** 2))
    return grid.cell_to_world((int(free[i, 0]), int(free[i, 1])))


def pick_destination(rooms: list[Room]) -> Room | None:
    if not rooms:
        return None
    named = [r for r in rooms if any(w in r.label.lower() for w in DEST_LABELS)]
    return max(named or rooms, key=lambda r: (r.area_m2, r.id))


def room_centroid(room: Room) -> tuple[float, float]:
    c = Polygon(room.polygon).centroid
    return (c.x, c.y)


def build_light(sid: str, data_root: Path = probe.DATA, client=None) -> BuildingPackage:
    """Basics, rooms, panos only; grid, rooms, doors; assumed entrance. Raises PortfolioSkip with a reason."""
    probe.pull_light(sid, data_root, client)
    raw = Path(data_root) / sid / "raw"
    rooms_json = _json(raw / "rooms.json").get("model") or {}
    n_edges = sum(len(f.get("edges") or []) for f in rooms_json.get("floors") or [])
    if n_edges == 0:
        raise PortfolioSkip("no walls in the Matterport model")
    if not any(((r.get("classifications") or [{}])[0]).get("label") != "Void" for r in rooms_json.get("rooms") or []):
        raise PortfolioSkip("no rooms in the Matterport model")
    try:
        pkg = build_from_matterport(sid, data_root)
    except Exception as e:  # malformed geometry etc.: skip with the reason, never crash the batch
        raise PortfolioSkip(f"import failed ({type(e).__name__}: {str(e)[:100]})") from e
    if not pkg.rooms:
        raise PortfolioSkip("no usable room polygons")
    dest = pick_destination(pkg.rooms)
    grid = OccGrid.from_b64(pkg.grid.cells_b64, pkg.grid.width, pkg.grid.height, pkg.grid.res, pkg.grid.origin)
    dpos = snap_free(grid, room_centroid(dest))
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if not pkg.entrances:
        a = assumed_entrance_pano(raw)
        if a is None:
            raise PortfolioSkip("no panoramas, so no entrance can be assumed")
        pid, pos = a
        heading = math.degrees(math.atan2(dpos[0] - pos[0], dpos[1] - pos[1])) % 360
        pkg.entrances.append(Entrance(id="assumed", label="Entrance (assumed)", pos=pos, heading_deg=round(heading, 1)))
        pkg.prov["entrance:assumed"] = Prov(src="calc", ref=f"pano:{pid} (lowest numeric label)", at=now)
        pkg.notes.append("assumed entrance: the pano with the lowest numeric label")
    pkg.notes.append(f"destination: {dest.label} room {dest.id} centroid {dpos[0]:.2f},{dpos[1]:.2f}")
    pkg.prov["portfolio.destination"] = Prov(src="calc", ref=f"room:{dest.id}", at=now)
    return pkg


# ---------------------------------------------------------------- navigability

def _get(parts, key: str) -> float:
    return float(parts[key] if isinstance(parts, dict) else getattr(parts, key))


def navigability(pkg: BuildingPackage, build_s: float = 0.0, plan=None, segment=None, score_route=None) -> dict:
    """Score entrance to destination, plus mean wall_share and decisions to every room.
    plan, segment, score_route default to Tasks 4 and 5 (injected in tests)."""
    if plan is None:
        from dr.planner import plan
    if segment is None:
        from dr.segments import segment
    if score_route is None:
        from dr.score import score_route
    grid = OccGrid.from_b64(pkg.grid.cells_b64, pkg.grid.width, pkg.grid.height, pkg.grid.res, pkg.grid.origin)
    start = tuple(pkg.entrances[0].pos)
    dest = pick_destination(pkg.rooms)
    goal = snap_free(grid, room_centroid(dest))

    def run(g):
        path = plan(grid, start, g, pkg.landmarks)
        return score_route(segment(path, grid, pkg.landmarks), grid, pkg.landmarks)

    try:
        main = run(goal)
    except Exception as e:
        raise PortfolioSkip(f"no route from the entrance to the {dest.label} room ({type(e).__name__})") from e
    ws, dec = [_get(main["parts"], "wall_share")], [_get(main["parts"], "decisions")]
    for r in pkg.rooms:
        if r.id == dest.id:
            continue
        try:
            s = run(snap_free(grid, room_centroid(r)))
        except Exception:
            continue  # an unreachable side room does not sink the building
        ws.append(_get(s["parts"], "wall_share"))
        dec.append(_get(s["parts"], "decisions"))
    parts = {k: round(_get(main["parts"], k), 4) for k in
             ("length_m", "wall_share", "open_m", "turns", "decisions", "hazards", "landmarks_per_10m")}
    parts["mean_wall_share"] = round(sum(ws) / len(ws), 4)
    parts["mean_decisions"] = round(sum(dec) / len(dec), 4)
    parts["routes"] = float(len(ws))
    return {"total": round(float(main["total"]), 2), "parts": parts, "build_s": round(build_s, 2)}


# ---------------------------------------------------------------- batch

def _costar(pid: str) -> dict:
    try:
        rec = resolver.costar_record(pid)
    except Exception:
        return {}
    if not rec:
        return {}
    prop = {k: v for k, v in (rec.get("property") or {}).items() if isinstance(v, (str, int, float, bool))}
    return {"property": prop, "tenant_count": len(rec.get("tenants") or [])}


def run_portfolio(cands: list[dict], build: Callable = build_light, nav: Callable = navigability,
                  costar: Callable = _costar, log: Callable = lambda s: None) -> list[PortfolioRow]:
    rows: list[PortfolioRow] = []
    for c in cands:
        row = PortfolioRow(sid=c["sid"], name=c.get("name", ""), address=c.get("address", ""),
                           costar_property_id=c.get("costar_property_id", ""), tour_url=TOUR + c["sid"])
        row.costar = costar(row.costar_property_id) if row.costar_property_id else {}
        t0 = time.perf_counter()
        try:
            pkg = build(c["sid"])
            row.assumed_entrance = bool(pkg.entrances and pkg.entrances[0].id == "assumed")
            res = nav(pkg, build_s=time.perf_counter() - t0)
            row.total, row.parts, row.build_s = res["total"], res["parts"], res["build_s"]
        except PortfolioSkip as e:
            row.skipped = str(e)
        except Exception as e:  # one bad model never stops the batch
            row.skipped = f"error: {type(e).__name__}: {str(e)[:120]}"
        row.build_s = row.build_s or round(time.perf_counter() - t0, 2)
        log(f"{row.sid} {row.name[:30]:<30} {row.total if row.skipped is None else 'SKIP ' + row.skipped}")
        rows.append(row)
    scored = sorted((r for r in rows if r.skipped is None), key=lambda r: (-r.total, r.sid))
    for i, r in enumerate(scored, 1):
        r.rank = i
    return scored + [r for r in rows if r.skipped is not None]


def write_portfolio(rows: list[PortfolioRow], city: str, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    doc = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "city": city,
           "total_build_s": round(sum(r.build_s for r in rows), 1),
           "rows": [r.model_dump(mode="json") for r in rows]}
    out.write_text(json.dumps(doc, indent=1))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="dr.portfolio")
    ap.add_argument("--city", default="Houston")
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--out", default="web/public/portfolio.json")
    ap.add_argument("--index", default=None)
    a = ap.parse_args(argv)
    cands = pick_candidates(a.index, a.city, a.n)
    t0 = time.perf_counter()
    rows = run_portfolio(cands, log=print)
    out = Path(a.out)
    write_portfolio(rows, a.city, out if out.is_absolute() else probe.ROOT / out)
    print(f"{len(rows)} models, {sum(r.skipped is None for r in rows)} scored, {time.perf_counter() - t0:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
