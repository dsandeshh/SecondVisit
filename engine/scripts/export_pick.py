"""Export what pick.html needs into web/public/buildings/<sid>/ (gitignored: derived from sponsor data).

    cd engine && .venv/bin/python scripts/export_pick.py x37LjPx62VA

Writes pick.json (floor plan placement, panos, wall segments, current overrides), copies floorplan.jpg and
links the cached horizon faces as faces/<pano>_<1..4>.jpg.
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

from dr.annotate import load_pano_yaws

REPO = Path(__file__).resolve().parents[2]


def main(sid: str) -> Path:
    raw = REPO / "data" / sid / "raw"
    out = REPO / "web" / "public" / "buildings" / sid
    out.mkdir(parents=True, exist_ok=True)
    fp = json.loads((raw / "floorplan.json").read_text())
    shutil.copyfile(raw / "floorplan.jpg", out / "floorplan.jpg")
    yaws = load_pano_yaws(raw)  # each skybox has its own yaw; face 1 bearing = face_yaw0_deg - yaw
    panos = [{"id": p["id"], "label": p.get("label", ""), "pos": [p["position"]["x"], p["position"]["y"]],
              "yaw": round(yaws.get(p["id"], 0.0), 2)}
             for p in json.loads((raw / "panos.json").read_text())["model"]["panoLocations"]]
    walls = []
    for floor in json.loads((raw / "rooms.json").read_text())["model"]["floors"]:
        vs = {v["id"]: v["position"] for v in floor["vertices"]}
        for e in floor["edges"]:
            a, b = (vs[v["id"]] for v in e["vertices"])
            walls.append([a["x"], a["y"], b["x"], b["y"]])
    ov_p = REPO / "data" / sid / "overrides.json"
    pick = {"sid": sid, "floorplan": {"url": "floorplan.jpg", "width": fp["width"], "height": fp["height"],
                                      "resolution": fp["resolution"], "origin": [fp["origin"]["x"], fp["origin"]["y"]]},
            "panos": panos, "walls": walls, "face_px": 2048,
            "overrides": json.loads(ov_p.read_text()) if ov_p.exists() else {}}
    (out / "pick.json").write_text(json.dumps(pick))
    faces = out / "faces"
    if not faces.exists():
        faces.symlink_to((raw / "faces").resolve(), target_is_directory=True)
    return out


if __name__ == "__main__":
    print(main(sys.argv[1] if len(sys.argv) > 1 else "x37LjPx62VA"))
