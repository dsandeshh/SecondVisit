"""Spoken short names (1 to 4 words) derived by code from annotator labels. The full label is kept.

"possibly" is NOT part of the name: `is_possible(lm)` (confidence < 0.6) is a separate flag the app
prefixes at speech time (the clip "possibly" exists in voice_lines).
"""
from __future__ import annotations

import math
import re

from dr.package import Landmark

POSSIBLE_BELOW = 0.6
MAX_WORDS = 4

KIND_SINGULAR = {"desk": "desk", "elevator": "elevator", "stairs": "stairs", "door": "door", "glass_door": "glass door",
                 "seating": "chair", "restroom": "restroom", "sign": "sign", "pillar": "pillar",
                 "water": "water fountain", "other": "object"}
KIND_PLURAL = {"desk": "desks", "elevator": "elevators", "stairs": "stairs", "door": "doors", "glass_door": "glass doors",
               "seating": "chairs", "restroom": "restrooms", "sign": "signs", "pillar": "pillars",
               "water": "water fountains", "other": "objects", "chair": "chairs"}

# words that describe state, colour, material or shape rather than what the thing is
_DROP = {"closed", "open", "opened", "illuminated", "lit", "wooden", "wood", "laminate", "granite", "metal", "glossy",
         "white", "red", "grey", "gray", "black", "blue", "green", "brown", "dark", "light", "large", "small", "long",
         "short", "tall", "curved", "square", "round", "rounded", "partly", "partially", "a", "an", "the", "some",
         "speckled", "carpeted", "hinged", "mounted"}
_CUT = re.compile(r"\s+(?:with|on|above|below|beside|besides|at|mounted|leading|marked|reading|visible|hinged|"
                  r"partly|partially|along|near|next|under|over|in|into|to|of|from|behind|facing|hanging|outside|"
                  r"and|or|by|left|right|centre|center|upper|lower)\b.*$", re.I)


def _clean_words(text: str) -> list[str]:
    words = []
    for w in text.split():
        lw = w.lower()
        if lw in _DROP or re.fullmatch(r"(?:\w+-)?(?:shaped|look|laminate|finish|grain)", lw) or re.match(r"wood", lw):
            continue
        words.append(w)
    return words


def spoken_name(label: str, kind: str = "other") -> str:
    """Sentence case short name: parentheticals, state words and trailing detail removed."""
    s = re.sub(r"\([^)]*\)", " ", label or "")
    q = re.search(r"reading\s+['\"“]([^'\"”]+)['\"”]", s, re.I)
    if q:
        s = f"{q.group(1)} sign"
    s = re.sub(r"['\"“”]", "", s)
    s = re.sub(r"[;:,].*$", "", s)  # first clause only
    s = " ".join(s.split())
    s = _CUT.sub("", s) if len(s.split()) > 1 else s
    words = _clean_words(s)
    # "sign" words only make sense after a name ("Lab sign"); drop a lone trailing adjective chain
    words = [re.sub(r"[^\w'-]", "", w) for w in words]
    words = [w for w in words if w][:MAX_WORDS]
    text = " ".join(words).strip()
    if not text:
        text = KIND_SINGULAR.get(kind, "object")
    text = text.lower()
    return text[0].upper() + text[1:]


def plural(kind: str) -> str:
    return KIND_PLURAL.get(kind, KIND_PLURAL["other"])


def is_possible(lm: Landmark) -> bool:
    return lm.confidence < POSSIBLE_BELOW


NEAR_M = 4.0
MAX_DISAMBIG_WORDS = 5


def _disambiguate(group: list[Landmark], landmarks: list[Landmark], entrances, rooms) -> None:
    """Make equal spoken names unique, by code from geometry: nearest distinct fixed landmark ("Door by the
    sink counter"), else the room ("Door in the lab"), else an ordinal by distance from the entrance."""
    from shapely.geometry import Point, Polygon
    base = group[0].spoken or ""
    base_words = {w.lower() for w in base.split()}
    count: dict[str, int] = {}
    for m in landmarks:
        count[(m.spoken or "").lower()] = count.get((m.spoken or "").lower(), 0) + 1
    snap = {m.id: m.spoken for m in landmarks}  # names before any renumbering, so neighbours stay stable
    room_budget = MAX_DISAMBIG_WORDS - len(base.split()) - 2  # "by the" / "in the"
    cands: dict[str, str] = {}
    for lm in group:
        near = sorted((m for m in landmarks if m.fixed and snap[m.id] and m.spoken == snap[m.id]
                       and not base_words & {w.lower() for w in snap[m.id].split()}
                       and count[snap[m.id].lower()] == 1 and len(snap[m.id].split()) <= room_budget
                       and math.dist(m.pos, lm.pos) <= NEAR_M), key=lambda m: math.dist(m.pos, lm.pos))
        if near:
            cands[lm.id] = f"{base} by the {near[0].spoken.lower()}"
            continue
        for r in rooms or []:
            if r.label and len(r.label.split()) <= room_budget and Polygon(r.polygon).contains(Point(lm.pos)):
                cands[lm.id] = f"{base} in the {r.label.lower()}"
                break
    seen: dict[str, int] = {}
    for v in cands.values():
        seen[v.lower()] = seen.get(v.lower(), 0) + 1
    ref = entrances[0].pos if entrances else (0.0, 0.0)
    order = sorted(group, key=lambda m: (math.dist(m.pos, ref), m.id))
    for n, lm in enumerate(order, 1):
        c = cands.get(lm.id)
        lm.spoken = c if c and seen[c.lower()] == 1 else f"{base} {n}"


def fill_spoken(landmarks: list[Landmark], entrances=None, rooms=None) -> None:
    """Set `spoken` where it is not already set (a HAND value wins). `label` is never changed.
    Names shared by two or more landmarks are then made unique (<= 5 words); see _disambiguate."""
    fresh = []
    for lm in landmarks:
        if not lm.spoken:
            lm.spoken = spoken_name(lm.label, lm.kind)
            fresh.append(lm)
    groups: dict[str, list[Landmark]] = {}
    for lm in fresh:
        groups.setdefault(lm.spoken.lower(), []).append(lm)
    for g in groups.values():
        total = sum(1 for m in landmarks if (m.spoken or "").lower() == g[0].spoken.lower())
        if total >= 2:
            _disambiguate(g, landmarks, entrances, rooms)
