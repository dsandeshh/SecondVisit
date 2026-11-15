"""Number grounding: every number a sentence speaks must come from an allowed set."""
from __future__ import annotations

import re
from collections.abc import Iterable

_NUM = re.compile(r"(?<![\w.])-?\d+(?:\.\d+)?")


def numbers_in(text: str) -> list[float]:
    return [float(m) for m in _NUM.findall(text)]


def grounded(text: str, allowed: Iterable[float]) -> bool:
    ok = {float(a) for a in allowed}
    return all(n in ok for n in numbers_in(text))
