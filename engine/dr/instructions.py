"""Template instruction writer. Step counts and clock directions only."""
from __future__ import annotations

import math
import re

from dr import llm
from dr.config import STEP_M
from dr.grounding import grounded
from dr.package import Entrance, Landmark, Prov, Segment
from dr.prov import ProvBuilder

MAX_LEN = 160
SMOOTH_SYSTEM = ("Rewrite for natural speech. Keep every number and every left, right and "
                 "o'clock exactly.")


def wrap180(deg: float) -> float:
    d = (deg + 180) % 360 - 180
    return 180.0 if d == -180 else d


def clock_hour(rel_deg: float) -> int:
    h = round(wrap180(rel_deg) / 30) % 12
    return h or 12


def _say(lm: Landmark) -> str:
    return lm.spoken or lm.label


def _clause(seg: Segment, lms: dict[str, Landmark], wall: bool = True, lm: bool = True) -> str:
    out = ""
    if wall and seg.wall_side != "none":
        out += f", wall on your {seg.wall_side}"
    if lm:
        for lid in seg.landmarks_passed:
            if lid in lms:
                p = "possibly " if lms[lid].confidence < 0.6 else ""
                out += f", passing {p}the {_say(lms[lid])}"
                break
    return out


def _steps(n: int) -> str:
    return f"{n} step" if n == 1 else f"{n} steps"


def _bearing(a, b) -> float:
    return math.degrees(math.atan2(b[0] - a[0], b[1] - a[1]))  # compass: 0 north, 90 east


def _line(seg, prev, lms, tail, wall=True, lm=True) -> str:
    head = ""
    if prev is None:
        head = "Facing into the building. "
    else:
        rel = wrap180(seg.heading_deg - prev.heading_deg)
        head = f"Turn {'right' if rel > 0 else 'left'} to {clock_hour(rel)} o'clock. "
    return f"{head}Walk {_steps(seg.steps)}{_clause(seg, lms, wall, lm)}{tail}."


def _fit(seg, prev, lms, tail) -> str:
    for wall, lm in ((True, True), (True, False), (False, False)):
        s = _line(seg, prev, lms, tail, wall, lm)
        if len(s) <= MAX_LEN:
            return s
    return s


def _nums(t: str) -> list[str]:
    return re.findall(r"\d+", t)


def _dirs(t: str) -> list[str]:
    return re.findall(r"\b(left|right)\b", t.lower())


def numbers_match(text: str, seg: Segment) -> bool:
    """'Walk N steps' equals seg.steps; every number is seg.steps or a clock hour 1-12 that
    appears as 'N o'clock'; at most 160 chars."""
    if len(text) > MAX_LEN:
        return False
    walk = re.findall(r"[Ww]alk (\d+) steps?", text)
    if len(walk) != 1 or int(walk[0]) != seg.steps:
        return False
    if not grounded(text, [seg.steps, *range(1, 13)]):
        return False
    rest = re.sub(r"[Ww]alk \d+ steps?", "", text)
    return all(re.search(rf"\b{n} o'clock", rest) for n in re.findall(r"\d+", rest))


def write(segments: list[Segment], landmarks: list[Landmark], entrances: list[Entrance],
          smooth: bool = False, dest: str | None = None) -> list[Segment]:
    lms = {lm.id: lm for lm in landmarks}
    out: list[Segment] = []
    for i, seg in enumerate(segments):
        prev = segments[i - 1] if i else None
        tail = ""
        if i == len(segments) - 1:
            d = lms.get(dest) if dest else None
            if d is None:
                for lid in reversed(seg.landmarks_passed):
                    if lid in lms:
                        d = lms[lid]
                        break
            if d is None and landmarks:
                d = min(landmarks, key=lambda m: math.dist(m.pos, seg.end))
            if d is not None:
                rel = wrap180(_bearing(seg.end, d.pos) - seg.heading_deg)
                tail = f". The {_say(d)} is at {clock_hour(rel)} o'clock"
        text = _fit(seg, prev, lms, tail)
        if smooth:
            s = llm.complete(SMOOTH_SYSTEM, text)
            if (s and numbers_match(s, seg) and _nums(s) == _nums(text)
                    and _dirs(s) == _dirs(text) and len(s) <= MAX_LEN):
                text = s
        out.append(seg.model_copy(update={"instruction": text}))
    return out



def prov_for(segments: list[Segment], at: str | None = None) -> dict[str, Prov]:
    """R10: prov for every number the written instructions speak. `.steps` is calc from the segment
    length; `.clock` is calc from headings and only emitted when the text speaks an o'clock hour.
    Task 7 merges these into the package."""
    pb = ProvBuilder(at)
    for seg in segments:
        ins = [f"segment:{seg.id}"] + [f"landmark:{l}" for l in seg.landmarks_passed]
        if re.search(r"\bWalk \d+ steps?", seg.instruction, re.I):
            pb.add(f"segment:{seg.id}.steps", "calc",
                   f"round(length_m {seg.length_m:.1f} / {STEP_M} m per step)", inputs=ins)
        if "o'clock" in seg.instruction:
            pb.add(f"segment:{seg.id}.clock", "calc",
                   "clock hour from heading change or landmark bearing", inputs=ins)
    return pb.entries
