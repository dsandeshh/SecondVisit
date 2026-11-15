"""Every string the app may speak that is known at build time (A7b engine half).

`add_voice_lines(pkg)` writes `pkg.voice_lines`: sorted unique `{text, id}`; id = sha1 of the text with
whitespace trimmed and collapsed to single spaces (case kept), first 12 hex chars. The web app hashes the
same way to find a pre-rendered clip.
"""
from __future__ import annotations

import hashlib

from dr import names
from dr.package import BuildingPackage, VoiceLine

KIND_WORDS = ["wall", "glass", "doorway", "wide doorway", "glass door", "door", "entrance", "exit", "obstacle",
              "stairs", "may move", "possibly"]

# Literal strings the web app passes to say()/prime() (grep of web/src; test_fixed_ui_lines_cover_web_literals
# fails if a new literal appears). Keep in step with the web.
FIXED_UI_LINES = [
    "Sound on.", "Recentred.", "Recentre needs motion. Use the turn buttons.",
    "No destination in this building.", "Stairs ahead.",
    "End of the summary. Press Space to hear it again from the start.",
    "Turn to face it, then press Space to confirm.",
    "Run 2 complete. Press Space to hear the summary, one stretch at a time.",
    "No route found in this building. Rehearse needs a route.",
    "Both runs are done. Press Space to hear the summary again.",
    "Press Space to hear the instruction again.",
    "Paused. Focus lost.", "Resumed.", "Starting.",
    "Sound paused. Press Space or tap to resume.",
    # engine.statusLine pieces and their joins
    "Sound did not start. Press Space or tap to try again.",
    "Motion on. Hold the phone flat, top edge forward. Turn your body to turn.",
    "Motion not available. Use the Step button and the arrow buttons.",
    "Motion not available, use the arrow keys.",
    # quiz answer options
    "On your left", "On your right", "No wall to follow", "Turn left", "Turn right", "No turn",
]
_SOUND = ["Sound on.", "Sound did not start. Press Space or tap to try again."]
_MOTION = ["Motion on. Hold the phone flat, top edge forward. Turn your body to turn.",
           "Motion not available. Use the Step button and the arrow buttons.",
           "Motion not available, use the arrow keys."]


def normalise(text: str) -> str:
    return " ".join(text.split())


def line_id(text: str) -> str:
    return hashlib.sha1(normalise(text).encode("utf-8")).hexdigest()[:12]


def collect(pkg: BuildingPackage) -> set[str]:
    out: set[str] = set(KIND_WORDS) | set(FIXED_UI_LINES) | set(names.KIND_PLURAL.values()) | set(names.KIND_SINGULAR.values())
    out |= {f"{s} {m}" for s in _SOUND for m in _MOTION}
    for lm in pkg.landmarks:
        sp = lm.spoken or names.spoken_name(lm.label, lm.kind)
        out.add(sp)
    for r in pkg.rooms:
        if r.label:
            out.add(r.label)
            out.add(f"You are entering the {r.label.lower()}.")
    for e in pkg.entrances:
        out.add(e.label)
    spoken = {lm.id: (lm.spoken or names.spoken_name(lm.label, lm.kind)) for lm in pkg.landmarks}
    for rt in pkg.routes:
        n = len(rt.segments)
        for i, s in enumerate(rt.segments):
            out.add(s.instruction)
            out.add(f"Stretch {i + 1}. {s.instruction}")
            out.add(f"About how many steps is stretch {i + 1} of {n}?")
            out.add(f"Which side is the wall on in stretch {i + 1}?")
            out.add(f"Which way do you turn after stretch {i + 1}?")
            for lid in s.landmarks_passed:
                if lid in spoken:
                    out.add(f"Passing the {spoken[lid].lower()}.")
        if rt.to in spoken:
            out.add(f"You have reached the {spoken[rt.to].lower()}.")
    out.add("You have reached the destination.")
    a = pkg.arrival
    if a:
        out |= set(a.lines) | set(a.recovery) | {c.line for c in a.cues if c.line}
    return {normalise(t) for t in out if t and t.strip()}


def add_voice_lines(pkg: BuildingPackage) -> None:
    pkg.voice_lines = [VoiceLine(text=t, id=line_id(t)) for t in sorted(collect(pkg))]
