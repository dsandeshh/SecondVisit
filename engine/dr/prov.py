"""Provenance helper (Task 19, R10): the one place that stamps `at` and validates `src` and key names."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import get_args

from dr.package import Prov, Source

SOURCES: tuple[str, ...] = get_args(Source)

# Documented fact-id patterns (contract comment in package.py / plan v2 additions).
KEY_PATTERNS = [re.compile(p) for p in (
    r"landmark:[\w-]+(\.fixed|\.label)?",
    r"room:[\w-]+(\.label)?",
    r"door:[\w-]+",
    r"entrance:[\w-]+",
    r"segment:[\w-]+\.(steps|clock)",
    r"arrival\.(image|entrance_side|door_pin|dropoff|curb_to_door_m)",
    r"arrival\.(curb|door|walk_m|clock|ortho|oblique|edge_type|door_type|crosses_drive_lane|building_outline|building_height_m)",
    r"arrival\.cue\.[\w-]+",
    r"frames\.geo_anchor",
    r"costar",
    r"grid(\.obstacles)?",
    r"map_date",
    r"portfolio\.destination",
    r"resolver\.suite",
)]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def valid_key(key: str) -> bool:
    return any(p.fullmatch(key) for p in KEY_PATTERNS)


def make(src: str, ref: str, at: str | None = None, inputs: list[str] | None = None,
         confidence: float | None = None) -> Prov:
    """Build a Prov: src must be a package.Source; `at` defaults to now; assumed facts must say so in ref."""
    if src not in SOURCES:
        raise ValueError(f"bad prov src {src!r}; expected one of {SOURCES}")
    return Prov(src=src, ref=ref, at=at or now_iso(), inputs=inputs, confidence=confidence)


class ProvBuilder:
    """Collects prov entries under validated keys, all stamped with one `at`."""

    def __init__(self, at: str | None = None):
        self.at = at or now_iso()
        self.entries: dict[str, Prov] = {}

    def add(self, key: str, src: str, ref: str, inputs: list[str] | None = None,
            confidence: float | None = None) -> Prov:
        if not valid_key(key):
            raise ValueError(f"undocumented prov key {key!r}")
        p = self.entries[key] = make(src, ref, self.at, inputs, confidence)
        return p


def missing_for_spoken(pkg) -> list[str]:
    """Spoken-number check for a BuildingPackage: every number in every route instruction must map to a
    field that has a prov entry. 'Walk N steps' -> segment:<id>.steps (and N must equal seg.steps);
    'N o'clock' -> segment:<id>.clock; any other number is reported as unmapped. Returns problems."""
    import re

    from dr.grounding import numbers_in
    out: list[str] = []
    for r in pkg.routes:
        for seg in r.segments:
            text, rest = seg.instruction, seg.instruction
            for m in re.finditer(r"[Ww]alk (\d+) steps?", text):
                if int(m.group(1)) != seg.steps:
                    out.append(f"segment:{seg.id}.steps value {m.group(1)} != {seg.steps}")
                if f"segment:{seg.id}.steps" not in pkg.prov:
                    out.append(f"segment:{seg.id}.steps")
            rest = re.sub(r"[Ww]alk \d+ steps?", "", rest)
            for m in re.finditer(r"(\d+) o'clock", rest):
                if f"segment:{seg.id}.clock" not in pkg.prov:
                    out.append(f"segment:{seg.id}.clock")
            rest = re.sub(r"\d+ o'clock", "", rest)
            out += [f"segment:{seg.id}: unmapped spoken number {n:g}" for n in numbers_in(rest)]
    return sorted(set(out))
