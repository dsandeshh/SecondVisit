"""Render every package voice_lines entry to web/public/buildings/<sid>/voice/<id>.wav (A7b, build time).

Run from engine/: .venv/bin/python scripts/prerender_voice.py <sid> [--voice af_heart] [--workers 3]
Skips files that exist, then writes voice/index.json {id: text}. Uses `node web/scripts/voice.mjs --render`.
The voice folder is gitignored (web/public/buildings/*/).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def render(text: str, voice: str, out: Path, timeout: int = 120) -> bool:
    tmp = out.with_name(f".{out.name}.part")
    subprocess.run(["node", str(ROOT / "web" / "scripts" / "voice.mjs"), "--render", text, voice, str(tmp)],
                   cwd=ROOT / "web", timeout=timeout, capture_output=True)
    if tmp.is_file() and tmp.stat().st_size > 0:
        tmp.replace(out)
        return True
    tmp.unlink(missing_ok=True)
    return False


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("sid")
    ap.add_argument("--voice", default=os.environ.get("SV_VOICE", "af_heart"))
    ap.add_argument("--workers", type=int, default=3)
    a = ap.parse_args(argv)
    bdir = ROOT / "web" / "public" / "buildings" / a.sid
    lines = json.loads((bdir / "package.json").read_text())["voice_lines"]
    vdir = bdir / "voice"
    vdir.mkdir(exist_ok=True)
    todo = [v for v in lines if not (vdir / f"{v['id']}.wav").exists()]
    t0 = time.time()
    with ThreadPoolExecutor(a.workers) as ex:
        ok = list(ex.map(lambda v: render(v["text"], a.voice, vdir / f"{v['id']}.wav"), todo))
    have = {v["id"]: v["text"] for v in lines if (vdir / f"{v['id']}.wav").exists()}
    (vdir / "index.json").write_text(json.dumps(have, indent=1, ensure_ascii=False))
    print(f"{a.sid} voice {a.voice}: {sum(ok)} rendered, {len(ok) - sum(ok)} failed, "
          f"{len(lines) - len(todo)} already there, {len(have)}/{len(lines)} in index, {time.time() - t0:.0f}s")
    return 0 if all(ok) else 1


if __name__ == "__main__":
    sys.exit(main())
