"""Task 14: free text to a Matterport model (fuzzy index search) and its CoStar record.

Offline by design: the index is a local CSV (DR_INDEX_CSV overrides the default) and CoStar comes from
the local kit zip via probe.costar_record. No network call is made here.
"""

from __future__ import annotations

import csv
import os
from pathlib import Path
from typing import TypedDict

from rapidfuzz import fuzz

from dr import probe
from dr.mp_client import ROOT
from dr.prov import ProvBuilder

MEDICAL_WORDS = ("clinic", "medical", "doctor", "dental", "physician")
MEDICAL_BOOST = 5.0
AMBIGUOUS_GAP = 5.0


class Candidate(TypedDict):
    sid: str
    name: str
    address: str
    city: str
    lat: float | None
    lon: float | None
    costar_property_id: str
    score: float


def _index_path() -> Path:
    p = Path(os.environ.get("DR_INDEX_CSV") or probe.INDEX_CSV)
    return p if p.is_absolute() else ROOT / p


def _f(v: str) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _load() -> list[dict]:
    with _index_path().open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def search_index(text: str, city: str | None = None, k: int = 5) -> list[Candidate]:
    out: list[Candidate] = []
    for r in _load():
        if city and (r.get("city") or "").strip().lower() != city.strip().lower():
            continue
        name, addr, c = (r.get("name") or ""), (r.get("address") or ""), (r.get("city") or "")
        score = fuzz.token_set_ratio(text.lower(), f"{name} {addr} {c}".lower())
        if any(w in name.lower() for w in MEDICAL_WORDS):
            score += MEDICAL_BOOST
        out.append({"sid": r["sid"], "name": name, "address": addr, "city": c,
                    "lat": _f(r.get("lat")), "lon": _f(r.get("lon")),
                    "costar_property_id": (r.get("costar_property_id") or "").strip(),
                    "score": float(score)})
    out.sort(key=lambda c: -c["score"])
    return out[:k]


def costar_record(property_id: str) -> dict | None:
    """CoStar property, tenancies, tenants and linked models from the local kit; None if unknown."""
    pid = str(property_id).strip()
    if not pid.isdigit():
        return None
    rec = probe.costar_record(int(pid))
    return rec if rec["property"] else None


def resolve(text: str) -> dict:
    cands = search_index(text)
    best = cands[0] if cands else None
    ambiguous = len(cands) > 1 and cands[0]["score"] - cands[1]["score"] <= AMBIGUOUS_GAP
    cs = costar_record(best["costar_property_id"]) if best and best["costar_property_id"] else None
    entries = {}
    if best:
        pb = ProvBuilder()
        pb.add("resolver.suite", "costar" if cs else "calc",
               f"models_index.csv rapidfuzz token_set_ratio" + (f"; costar:{best['costar_property_id']}" if cs else ""),
               confidence=min(1.0, best["score"] / 100))
        entries = pb.entries
    return {"best": best, "candidates": cands, "costar": cs, "ambiguous": ambiguous,
            "prov": {"source": "models_index.csv", "matcher": "rapidfuzz token_set_ratio",
                     "costar": "local kit" if cs else None},
            "prov_entries": entries}
