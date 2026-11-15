"""Provenance helper (Task 19, R10): the one place that stamps `at` and validates `src` and key names."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import get_args

from dr.package import Prov, Source

SOURCES: tuple[str, ...] = get_args(Source)

# Documented fact-id patterns (contract comment in package.py / plan v2 additions).
KEY_PATTERNS = [re.compile(p) for p in (
    r"landmark:[\w-]+(\.fixed)?",
    r"room:[\w-]+(\.label)?",
    r"door:[\w-]+",
    r"entrance:[\w-]+",
    r"segment:[\w-]+\.(steps|clock)",
    r"arrival\.(image|entrance_side|door_pin|dropoff|curb_to_door_m)",
    r"frames\.geo_anchor",
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
