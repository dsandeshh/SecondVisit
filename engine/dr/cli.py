"""python -m dr.cli build|portfolio ... (R12)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _build(a: argparse.Namespace) -> int:
    from dr import pipeline
    if a.source == "fixture":
        pkg = pipeline.fixture_package()
        pipeline.add_route(pkg, a.from_id, a.to_id, a.clearance, a.drop_specks)
        if a.sim:
            pipeline.run_sim(pkg, a.sim)
        from dr import names, voice_lines
        names.fill_spoken(pkg.landmarks)
        voice_lines.add_voice_lines(pkg)
    else:
        if not a.model:
            raise SystemExit("--model SID is required for --source matterport")
        pkg = pipeline.build_package(a.model, a.from_id, a.to_id, a.clearance, a.drop_specks, a.sim,
                                     web_root=Path(a.out).resolve().parents[1], also_to=a.also_to)
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(pkg.model_dump(mode="json", by_alias=True), indent=1) + "\n")
    for r in pkg.routes:
        print(f"wrote {out}: route {r.id}, {len(r.segments)} segments, score {r.score.total:.1f}")
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv and argv[0] == "portfolio":
        from dr import portfolio
        return portfolio.main(argv[1:])
    ap = argparse.ArgumentParser(prog="dr.cli")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--source", choices=["matterport", "fixture"], required=True)
    b.add_argument("--model")
    b.add_argument("--in", dest="inp")
    b.add_argument("--out", required=True)
    b.add_argument("--from", dest="from_id")
    b.add_argument("--to", dest="to_id")
    b.add_argument("--also-to", dest="also_to", action="append", default=[],
                   help="plan a further route to this landmark id (repeatable); overrides second_destination also adds one")
    b.add_argument("--clearance", type=float, help="min wall distance in m (default 0.35, floor 0.25)")
    b.add_argument("--drop-specks", type=float, help="ignore obstacle blobs under this area in m2")
    b.add_argument("--sim", type=int, default=0)
    a = ap.parse_args(argv)
    return _build(a)


if __name__ == "__main__":
    raise SystemExit(main())
