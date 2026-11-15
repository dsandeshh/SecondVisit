import json
import shutil
from pathlib import Path

import numpy as np
from scipy.ndimage import label

from dr.mp_import import (build_from_matterport, ensure_doors, load_overrides, load_panos,
                          obstacles_from_cloud, rasterize, rooms_from_graph, walls_from_graph)

FIX = Path(__file__).resolve().parents[2] / "data" / "fixtures" / "mp_square_room.json"


def square():
    return json.loads(FIX.read_text())


def two_rooms():
    """Rooms A (0..6 x 0..4) and B (6..10 x 0..4) with a solid shared wall at x = 6."""
    V = {"a": (0, 0), "b": (6, 0), "c": (10, 0), "d": (10, 4), "e": (6, 4), "f": (0, 4)}
    E = {"s1": "ab", "s2": "bc", "ee": "cd", "n2": "de", "n1": "ef", "w": "fa", "mid": "be"}
    return {"model": {
        "floors": [{"id": "f1", "label": "Floor 1", "sequence": 0,
                    "vertices": [{"id": k, "position": {"x": x, "y": y}} for k, (x, y) in V.items()],
                    "edges": [{"id": k, "type": "wall", "thickness": 0.12,
                               "vertices": [{"id": v[0]}, {"id": v[1]}]} for k, v in E.items()]}],
        "rooms": [
            {"id": "A", "floor": {"id": "f1"}, "classifications": [{"label": "Other", "confidence": 1}],
             "boundary": {"edges": [{"id": i} for i in ("s1", "mid", "n1", "w")]}},
            {"id": "B", "floor": {"id": "f1"}, "classifications": [{"label": "Other", "confidence": 1}],
             "boundary": {"edges": [{"id": i} for i in ("s2", "ee", "n2", "mid")]}},
        ],
        "panoLocations": [{"id": "pa", "label": "0", "position": {"x": 3, "y": 2, "z": 1.3}},
                          {"id": "pb", "label": "1", "position": {"x": 8, "y": 2, "z": 1.3}}],
    }}


def at(g, x, y):
    return int(g.cells[g.world_to_cell((x, y))])


def panos_of(rj):
    return {p["id"]: (p["position"]["x"], p["position"]["y"]) for p in rj["model"]["panoLocations"]}


def test_walls_rasterised():
    g = rasterize(walls_from_graph(square(), "f1"))
    assert at(g, 3, 4.0) == 1
    assert at(g, 3, 2) == 0


def test_room_area():
    rooms = rooms_from_graph(square(), "f1")
    assert len(rooms) == 1
    assert abs(rooms[0].area_m2 - 24) <= 0.5
    assert rooms[0].label == "Other"


def test_door_gap_open():
    g = rasterize(walls_from_graph(square(), "f1"))
    assert at(g, 3.0, 0.0) == 0


def test_carves_missing_door():
    rj = two_rooms()
    g = rasterize(walls_from_graph(rj, "f1"))
    rooms = rooms_from_graph(rj, "f1")
    panos = panos_of(rj)
    lab, _ = label(g.cells == 0)
    assert lab[g.world_to_cell(panos["pa"])] != lab[g.world_to_cell(panos["pb"])]
    g2, doors = ensure_doors(g, rooms, panos)
    lab, _ = label(g2.cells == 0)
    assert lab[g2.world_to_cell(panos["pa"])] == lab[g2.world_to_cell(panos["pb"])]
    assert len(doors) == 1
    d = doors[0]
    assert sorted(d.rooms) == ["A", "B"]
    assert abs(d.a[0] - 6) < 0.2 and abs(d.b[0] - 6) < 0.2
    assert abs(abs(d.a[1] - d.b[1]) - 0.9) < 0.05


def test_cloud_obstacle(tmp_path):
    rj = square()
    g = rasterize(walls_from_graph(rj, "f1"))
    panos = load_panos_from(rj)
    s = np.arange(0.01, 1.0, 0.04)
    xs, ys, zs = np.meshgrid(2.5 + s, 1.0 + s, 0.2 + s, indexing="ij")
    cube = np.c_[xs.ravel(), ys.ravel(), zs.ravel()]
    high = cube.copy()
    high[:, 0] -= 2.0
    high[:, 2] += 2.3  # z 2.5 to 3.5 at x 0.5 to 1.5: above the band
    pts = np.r_[cube, high]
    p = tmp_path / "cloud.xyz"
    np.savetxt(p, np.c_[pts, np.full((len(pts), 3), 128)], fmt="%.4f")
    g2 = obstacles_from_cloud(str(p), g, 0.0, panos)
    assert (g2.cells == 3).sum() > 20
    assert at(g2, 3.3, 1.3) == 3
    assert at(g2, 1.0, 1.5) == 0  # under the high points
    for r, c in zip(*np.nonzero(g2.cells == 3)):
        x, y = g2.cell_to_world((r, c))
        assert np.hypot(x - 3, y - 2) > 0.4


def load_panos_from(rj):
    return panos_of(rj)


def test_pano_never_in_wall():
    rj = square()
    rj["model"]["panoLocations"].append({"id": "p1", "label": "1",
                                         "position": {"x": 0.03, "y": 2.0, "z": 1.3}})
    g = rasterize(walls_from_graph(rj, "f1"))
    assert at(g, 0.03, 2.0) == 1
    g2, _ = ensure_doors(g, rooms_from_graph(rj, "f1"), panos_of(rj))
    for pos in panos_of(rj).values():
        assert at(g2, *pos) == 0


def test_overrides_missing_file_defaults(tmp_path):
    o = load_overrides("nosuch", data_root=tmp_path)
    assert o.entrance is None and o.destination is None
    assert o.extra_landmarks == [] and o.deleted_landmark_ids == []
    assert o.face_yaw0_deg == 0 and o.faces_clockwise is True and o.arrival is None


def test_overrides_destination_pos_becomes_landmark(tmp_path):
    (tmp_path / "s1").mkdir()
    (tmp_path / "s1" / "overrides.json").write_text(json.dumps({
        "entrance": {"id": "ent_main", "label": "Front door", "pos": [1, 2], "heading_deg": 90},
        "destination": {"pos": [5, 3], "label": "Reception"},
    }))
    o = load_overrides("s1", data_root=tmp_path)
    assert o.entrance.id == "ent_main"
    lm = o.destination_landmark()
    assert lm.id == "dest" and lm.kind == "desk" and lm.pos == (5, 3)


def test_build_from_fixture(tmp_path):
    raw = tmp_path / "sq" / "raw"
    raw.mkdir(parents=True)
    shutil.copy(FIX, raw / "rooms.json")
    (raw / "index_row.json").write_text(json.dumps({"name": "Square", "original_created": "2024-05-24"}))
    assert list(load_panos("sq", data_root=tmp_path)) == ["p0"]
    pkg = build_from_matterport("sq", data_root=tmp_path)
    assert pkg.source == "matterport" and pkg.model_id == "sq" and pkg.map_date == "2024-05-24"
    assert pkg.entrances == [] and any("overrides" in n for n in pkg.notes)
    assert pkg.prov["room:room_a"].src == "matterport"
    assert pkg.prov["room:room_a.label"].src == "matterport"
    assert all(f"door:{d.id}" in pkg.prov for d in pkg.doors)
    assert len(pkg.doors) == 1  # the south gap
