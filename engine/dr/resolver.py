"""Task 14: free text to a Matterport model (fuzzy index search) and its CoStar record.

Offline by design: the index is a local CSV (DR_INDEX_CSV overrides the default) and CoStar comes from
the local kit zip via probe.costar_record. No network call is made here.
"""

from __future__ import annotations

import csv
import json
import os
import re
import zipfile
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
    p = p if p.is_absolute() else ROOT / p
    if not p.exists():
        raise FileNotFoundError(f"sponsor index CSV not found at {p}; set DR_INDEX_CSV to its path")
    return p


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


def costar_lookup(property_id: str, sid: str | None = None) -> tuple[dict | None, str | None]:
    """(record, None) on success, (None, None) if unknown, (None, reason) if the kit is unusable."""
    pid = str(property_id).strip()
    if not pid.isdigit():
        return None, None
    cache = probe.DATA / sid / "raw" / "costar.json" if sid else None
    try:
        if cache and cache.exists():
            rec = json.loads(cache.read_text())
        else:
            rec = probe.costar_record(int(pid))
    except (OSError, RuntimeError, zipfile.BadZipFile, KeyError, ValueError) as e:
        return None, f"{type(e).__name__}: {str(e)[:80]}".replace(os.environ.get("COSTAR_ZIP_PASSWORD") or "\0", "***")
    return (rec if rec.get("property") else None), None


def costar_record(property_id: str, sid: str | None = None) -> dict | None:
    """CoStar property, tenancies, tenants and linked models (cache, else local kit); None if unknown or kit unavailable."""
    return costar_lookup(property_id, sid)[0]


def resolve(text: str) -> dict:
    cands = search_index(text)
    best = cands[0] if cands else None
    ambiguous = len(cands) > 1 and cands[0]["score"] - cands[1]["score"] <= AMBIGUOUS_GAP
    cs, why = costar_lookup(best["costar_property_id"], best["sid"]) if best and best["costar_property_id"] else (None, None)
    entries = {}
    if best:
        pb = ProvBuilder()
        pb.add("resolver.suite", "costar" if cs else "calc",
               "models_index.csv rapidfuzz token_set_ratio" + (f"; costar:{best['costar_property_id']}" if cs else "")
               + (f"; kit unavailable: {why}" if why else ""),
               confidence=min(1.0, best["score"] / 100))
        entries = pb.entries
    return {"best": best, "candidates": cands, "costar": cs, "ambiguous": ambiguous,
            "prov": {"source": "models_index.csv", "matcher": "rapidfuzz token_set_ratio",
                     "costar": "local kit" if cs else None},
            "prov_entries": entries}


# ---------------------------------------------------------------- tiers for the home address box

READY_MIN_SCORE = 60.0    # a built building this close (and the best match overall) opens
OUTDOOR_MIN_SCORE = 85.0  # an unbuilt model must match this well, and cover the words typed
COVER_MIN = 0.75          # share of the typed words found in the model's name, address or city
# Vexcel coverage for the hackathon keys (docs/APIS.md): Houston and Los Angeles metro boxes, (lat0, lat1, lon0, lon1)
COVERAGE = {"Houston": (29.4, 30.4, -96.0, -94.8), "Los Angeles": (33.6, 34.5, -118.8, -117.6)}
_STOP = {"the", "of", "at", "and", "in", "a", "an", "us", "usa"}


def coverage_city(c: dict) -> str | None:
    """Houston or Los Angeles when the model lies in that metro (position first, else its city text), else None."""
    lat, lon = c.get("lat"), c.get("lon")
    if lat is not None and lon is not None:
        for city, (a0, a1, o0, o1) in COVERAGE.items():
            if a0 <= lat <= a1 and o0 <= lon <= o1:
                return city
        return None
    town = re.sub(r"\s+", " ", (c.get("city") or "").strip().lower())
    for city in COVERAGE:
        if town.startswith(city.lower()):
            return city
    return None


def query_variants(q: str) -> list[str]:
    return list(dict.fromkeys([q, re.sub(r"\bFM[\s-]*(\d+)", r"FM-\1", q, flags=re.I), re.sub(r"[-,]", " ", q)]))


def ranked(q: str) -> list[Candidate]:
    """Every index row scored against the best of the query's spellings, best first."""
    best: dict[str, Candidate] = {}
    for v in query_variants(q):
        for c in search_index(v, k=1_000_000):
            if c["score"] > best.get(c["sid"], {"score": -1.0})["score"]:
                best[c["sid"]] = c
    return sorted(best.values(), key=lambda c: -c["score"])


def _words(t: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9]+", t.lower()) if w not in _STOP]


def covers(q: str, c: dict) -> bool:
    """The typed words are this model's: every number is in its text, and most words are."""
    toks = _words(q)
    have = set(_words(f"{c.get('name', '')} {c.get('address', '')} {c.get('city', '')}"))
    if not toks:
        return False
    if any(t.isdigit() and t not in have for t in toks):
        return False
    hit = sum(1 for t in toks if t in have or (not t.isdigit() and any(fuzz.ratio(t, h) >= 85 for h in have)))
    return hit / len(toks) >= COVER_MIN


def _tied(q: str, best: dict, rows: list[Candidate], ready: set[str]) -> bool:
    """Another building (a different address, not one of `ready`) matches the words as well: no single answer."""
    for c in rows:
        if c["sid"] == best["sid"] or c["sid"] in ready or (best["address"] and c["address"] == best["address"]):
            continue
        return best["score"] - c["score"] <= AMBIGUOUS_GAP and covers(q, c)
    return False


def tier(q: str, ready: set[str]) -> dict:
    """{"tier": "ready" | "outdoor" | "none", "best", "city", "candidates"}.

    ready: a building with a built package is the best match (score >= READY_MIN_SCORE).
    outdoor: the best match is a model with no package, in Houston or Los Angeles, matched well (score, the
    typed words and street number) and not tied with a different building.
    none: anything else (unknown, outside the two cities, or ambiguous)."""
    rows = ranked(q.strip()) if q.strip() else []
    out = {"tier": "none", "best": None, "city": None, "candidates": rows[:3]}
    if not rows:
        return out
    top = rows[0]
    r = next((c for c in rows if c["sid"] in ready), None)
    if r is not None and r["score"] >= READY_MIN_SCORE and r["score"] >= top["score"] and not _tied(q, r, rows, ready):
        return out | {"tier": "ready", "best": r, "city": coverage_city(r)}
    if top["sid"] in ready or top["score"] < OUTDOOR_MIN_SCORE or not covers(q, top) or _tied(q, top, rows, set()):
        return out
    city = coverage_city(top)
    if city is None:
        return out
    return out | {"tier": "outdoor", "best": top, "city": city}
