import re
from pathlib import Path

from dr import config

NAMES = ["STEP_M", "CANE_M", "GRID_RES", "WALL_TRAIL_M", "ARRIVE_M"]


def test_constants_values():
    assert (config.STEP_M, config.CANE_M, config.GRID_RES, config.WALL_TRAIL_M, config.ARRIVE_M) == (
        0.7, 1.2, 0.1, 0.6, 1.5)


def test_constants_match_web():
    ts = (Path(__file__).resolve().parents[2] / "web/src/config.ts").read_text()
    for name in NAMES:
        m = re.search(rf"export const {name}\s*=\s*([0-9.]+)", ts)
        assert m, f"{name} missing from web/src/config.ts"
        assert float(m.group(1)) == getattr(config, name), name


def test_tokens_copy_matches_root():
    root = Path(__file__).resolve().parents[2]
    assert (root / "web/src/styles/tokens.css").read_bytes() == (root / "web_tokens.css").read_bytes(), (
        "web/src/styles/tokens.css is stale: cp web_tokens.css web/src/styles/tokens.css")
