"""Run the annotator over cached face images with the Anthropic vision model (Task 3 step 6).

usage: python scripts/run_annotator.py SID   (from engine/; reads ../.env; model from DR_FAST_MODEL or DR_MODEL)
Every vision answer is cached in data/<sid>/vision_cache/<pano>_<face>.txt, so a rerun makes zero calls.
"""
from __future__ import annotations

import base64
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "engine"))

from dr import annotate as A  # noqa: E402
from dr.grid import OccGrid  # noqa: E402
from dr.mp_import import DATA, build_from_matterport, load_overrides, load_panos  # noqa: E402


def _env() -> None:
    p = ROOT / ".env"
    for line in p.read_text().splitlines() if p.exists() else []:
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"'))


def main(sid: str) -> int:
    _env()
    model = os.environ.get("DR_FAST_MODEL") or os.environ.get("DR_MODEL") or ""
    model = model.split(":", 1)[1] if model.startswith("anthropic:") else model
    d = DATA / sid
    cache = d / "vision_cache"
    cache.mkdir(exist_ok=True)
    pkg = build_from_matterport(sid)
    ov = load_overrides(sid)
    grid = OccGrid.from_b64(pkg.grid.cells_b64, pkg.grid.width, pkg.grid.height, pkg.grid.res, pkg.grid.origin)
    ann = A.Annotator(sid, grid, pkg.rooms, load_panos(sid), d / "raw" / "faces", d,
                      entrance=pkg.entrances[0] if pkg.entrances else None,
                      yaw0_deg=ov.face_yaw0_deg, clockwise=ov.faces_clockwise, budget=80,
                      pano_yaw=A.load_pano_yaws(d / "raw"))
    client, calls = None, 0
    for pid in ann.panos:
        for face in (1, 2, 3, 4):
            c = cache / f"{pid}_{face}.txt"
            if not c.exists():
                if client is None:
                    import anthropic
                    client = anthropic.Anthropic(timeout=60, max_retries=2)
                img = ann.look(pid, face)
                if isinstance(img, str):
                    print(img)
                    continue
                w = ann._width(pid, face, "furnished")
                msg = client.messages.create(model=model, max_tokens=700, messages=[
                    {"role": "user", "content": [img, {"type": "text", "text": A.vision_prompt(w)}]}])
                c.write_text("".join(b.text for b in msg.content if b.type == "text"))
                calls += 1
                time.sleep(0.3)
            else:
                ann.looks += 1
            ann.record(pid, face, c.read_text())
    ann.finish()
    print(f"vision calls this run: {calls}; looks {ann.looks}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1]))
