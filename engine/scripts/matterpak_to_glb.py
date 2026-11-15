"""Convert a downloaded MatterPak OBJ (plus textures) to one GLB for the web 3D view.

    <venv>/bin/python scripts/matterpak_to_glb.py x37LjPx62VA [--max-mb 40] [--tex 1024]

Reads data/<sid>/raw/matterpak/<uuid>.obj and writes
web/public/buildings/<sid>/scan.glb plus scan.json (bounds and the frame note).

The mesh is in the Matterport model frame, which is our plan frame (CLAUDE.md rule 3): metres,
x right, y up on the plan, z up. We do NOT rotate or mirror; the web maps plan to three.js.
Needs trimesh and pillow, which are not engine dependencies: run it from a scratch venv.
Sponsor data: scan.glb is gitignored, never committed or published.
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]


def shrink_textures(scene: trimesh.Scene, max_px: int, quality: int) -> int:
    """Downscale every texture and keep it JPEG.

    trimesh re-encodes a texture as PNG unless its PIL `format` is JPEG, and `resize()` drops the
    format, so we round-trip through JPEG bytes. PNG here costs about 4x the file size.
    """
    seen, changed = set(), 0
    for geom in scene.geometry.values():
        mat = getattr(getattr(geom, "visual", None), "material", None)
        img = getattr(mat, "image", None)
        if img is None or id(img) in seen:
            continue
        seen.add(id(img))
        if max(img.size) > max_px:
            w, h = img.size
            scale = max_px / max(w, h)
            img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
        buf = io.BytesIO()
        img.convert("RGB").save(buf, format="JPEG", quality=quality, optimize=True)
        buf.seek(0)
        mat.image = Image.open(buf)
        mat.image.load()
        mat.image.format = "JPEG"
        changed += 1
    return changed


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("sid", nargs="?", default="x37LjPx62VA")
    ap.add_argument("--tex", type=int, default=1024, help="max texture pixels on the long side")
    ap.add_argument("--quality", type=int, default=80, help="JPEG quality for textures")
    ap.add_argument("--max-mb", type=float, default=40.0, help="warn above this GLB size")
    args = ap.parse_args()

    src_dir = ROOT / "data" / args.sid / "raw" / "matterpak"
    objs = sorted(src_dir.glob("*.obj"))
    if not objs:
        raise SystemExit(f"no .obj in {src_dir}; run scripts/fetch_matterpak.py first")
    obj = objs[0]
    print(f"loading {obj.name} ({obj.stat().st_size / 2**20:.0f} MB)")
    scene = trimesh.load(obj, process=False, force="scene")
    meshes = list(scene.geometry.values())
    faces = int(sum(len(m.faces) for m in meshes))
    verts = int(sum(len(m.vertices) for m in meshes))
    print(f"{len(meshes)} meshes, {faces} faces, {verts} vertices")

    changed = shrink_textures(scene, args.tex, args.quality)
    print(f"re-encoded {changed} textures: at most {args.tex}px, JPEG q{args.quality}")

    bounds = np.vstack([m.bounds for m in meshes])
    lo, hi = bounds.min(axis=0).tolist(), bounds.max(axis=0).tolist()

    out_dir = ROOT / "web" / "public" / "buildings" / args.sid
    out_dir.mkdir(parents=True, exist_ok=True)
    glb = out_dir / "scan.glb"
    glb.write_bytes(scene.export(file_type="glb"))
    size_mb = glb.stat().st_size / 2**20
    (out_dir / "scan.json").write_text(json.dumps({
        "source": "matterpak",
        "chip": "MP",
        "frame": "plan (Matterport model frame): metres, x right, y up, z up; not rotated or mirrored",
        "bounds_min": lo, "bounds_max": hi,
        "faces": faces, "vertices": verts, "texture_max_px": args.tex,
        "note": "Sponsor data. Gitignored: never commit or publish.",
    }, indent=1) + "\n")
    print(f"wrote {glb} ({size_mb:.1f} MB)")
    print(f"bounds x {lo[0]:.1f}..{hi[0]:.1f}  y {lo[1]:.1f}..{hi[1]:.1f}  z {lo[2]:.1f}..{hi[2]:.1f}")
    if size_mb > args.max_mb:
        print(f"WARNING: over {args.max_mb} MB; lower --tex or decimate before shipping", file=sys.stderr)


if __name__ == "__main__":
    main()
