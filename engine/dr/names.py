"""Spoken short names (1 to 4 words) derived by code from annotator labels. The full label is kept.

"possibly" is NOT part of the name: `is_possible(lm)` (confidence < 0.6) is a separate flag the app
prefixes at speech time (the clip "possibly" exists in voice_lines).
"""
from __future__ import annotations

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


def fill_spoken(landmarks: list[Landmark]) -> None:
    """Set `spoken` where it is not already set (a HAND value wins). `label` is never changed."""
    for lm in landmarks:
        if not lm.spoken:
            lm.spoken = spoken_name(lm.label, lm.kind)
