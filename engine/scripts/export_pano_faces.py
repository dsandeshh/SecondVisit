"""Organise the cached panorama faces as cube maps for the web's photo projection (`?view=proj`).

    .venv/bin/python scripts/export_pano_faces.py x37LjPx62VA [--face-px 1024]

Reads data/<sid>/raw/faces/<pano>_<1..4>.jpg (the four horizon faces Task 3 cached), raw/panos.json
(full xyz) and raw/pano_rotations.json (quaternion), and writes, under web/public/buildings/<sid>/pano/:

- <pano>/{px,nx,py,ny,pz,nz}.jpg: an OpenGL cube map (three.js CubeTextureLoader order) in the pano's own
  frame. Matterport's horizon faces 1..4 run clockwise seen from above (overrides `faces_clockwise`), each
  image unmirrored with image x to the right. GL cube faces, looked up raw, run +X -> -Z -> -X -> +Z going
  right with +Y up, so face 1 = px, 2 = nz, 3 = nx, 4 = pz with no flips. The web maps a plan direction into
  this GL frame (web/src/three/panoproj.ts). Faces 0 (up) and 5 (down) are not cached, so py and ny are
  flat grey placeholders of the same size (a cube map needs six equal faces) and `real_faces` says so: the
  shader never takes colour from them, it falls back to the baked mesh texture there.
- index.json: per pano `pos` (plan frame xyz), `quat` (x, y, z, w), `yaw_deg` (annotate.pano_yaw_deg),
  plus the calibrated `face_yaw0_deg` from data/<sid>/overrides.json: face 1's centre has plan bearing
  `face_yaw0_deg - yaw_deg` (the calibration engine/dr/annotate.py uses for landmark bearings).

No network calls. Sponsor data: the output folder is gitignored, never commit or publish it.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "engine"))
from dr.annotate import pano_yaw_deg  # noqa: E402

# Matterport horizon face -> GL cube face name (see the module docstring).
FACE_TO_CUBE = {1: "px", 2: "nz", 3: "nx", 4: "pz"}
PLACEHOLDER = (128, 128, 128)


def export(raw: Path, out: Path, face_px: int, yaw0_deg: float, clockwise: bool, quality: int = 88) -> dict:
    if not clockwise:
        raise ValueError("faces_clockwise is false: the cube layout assumes faces 1 to 4 run clockwise")
    locs = json.loads((raw / "panos.json").read_text())["model"]["panoLocations"]
    rots = {q["id"]: q["rotation"] for q in json.loads((raw / "pano_rotations.json").read_text())["model"]["panoLocations"]
            if q.get("rotation")}
    out.mkdir(parents=True, exist_ok=True)
    grey = Image.new("RGB", (face_px, face_px), PLACEHOLDER)
    panos, skipped = [], []
    for loc in locs:
        pid, pos, rot = loc["id"], loc.get("position"), rots.get(loc["id"])
        src = {f: raw / "faces" / f"{pid}_{f}.jpg" for f in FACE_TO_CUBE}
        if pos is None or rot is None or not all(p.exists() for p in src.values()):
            skipped.append(pid)
            continue
        d = out / pid
        d.mkdir(exist_ok=True)
        for f, name in FACE_TO_CUBE.items():
            with Image.open(src[f]) as im:
                im.convert("RGB").resize((face_px, face_px), Image.LANCZOS).save(d / f"{name}.jpg", quality=quality)
        for name in ("py", "ny"):
            grey.save(d / f"{name}.jpg", quality=quality)
        panos.append({
            "id": pid,
            "pos": [float(pos["x"]), float(pos["y"]), float(pos["z"])],
            "quat": [float(rot.get(k, 0.0)) for k in ("x", "y", "z")] + [float(rot.get("w", 1.0))],
            "yaw_deg": round(pano_yaw_deg(rot), 4),
            "dir": f"pano/{pid}/",
            "real_faces": ["px", "nx", "pz", "nz"],
        })
    idx = {"face_px": face_px, "face_yaw0_deg": float(yaw0_deg), "faces_clockwise": True,
           "layout": "GL cube map per pano: face 1 = px, 2 = nz, 3 = nx, 4 = pz; py, ny grey placeholders",
           "panos": panos, "skipped": skipped,
           "note": "Sponsor data (Matterport panoramas). Gitignored: never commit or publish."}
    (out / "index.json").write_text(json.dumps(idx, indent=1))
    return idx


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("sid", nargs="?", default="x37LjPx62VA")
    ap.add_argument("--face-px", type=int, default=1024)
    a = ap.parse_args()
    raw = ROOT / "data" / a.sid / "raw"
    ov_path = ROOT / "data" / a.sid / "overrides.json"
    ov = json.loads(ov_path.read_text()) if ov_path.exists() else {}
    out = ROOT / "web" / "public" / "buildings" / a.sid / "pano"
    idx = export(raw, out, a.face_px, float(ov.get("face_yaw0_deg", 0.0)), bool(ov.get("faces_clockwise", True)))
    print(f"wrote {len(idx['panos'])} pano cube maps to {out} (skipped {len(idx['skipped'])}), face yaw0 {idx['face_yaw0_deg']}")


if __name__ == "__main__":
    main()
