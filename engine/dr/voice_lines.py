"""Every string the app may speak that is known at build time (A7b engine half).

`add_voice_lines(pkg)` writes `pkg.voice_lines`: sorted unique `{text, id}`; id = sha1 of the text with
whitespace trimmed and collapsed to single spaces (case kept), first 12 hex chars. The web app hashes the
same way to find a pre-rendered clip.
"""
from __future__ import annotations

import hashlib
import math

from dr import check_quiz, names
from dr.package import BuildingPackage, VoiceLine

KIND_WORDS = ["wall", "glass", "doorway", "wide doorway", "glass door", "door", "entrance", "exit", "obstacle",
              "stairs", "may move"]

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
    "Beacon off.", "Beacon is straight line, walls may be in the way.", "No places in this building.",
    "Nothing within 8 metres. Try E for ahead.", "door",
    # engine.statusLine pieces and their joins
    "Sound did not start. Press Space or tap to try again.",
    "Motion on. Hold the phone flat, top edge forward. Turn your body to turn.",
    "Motion not available. Use the Step button and the arrow buttons.",
    "Motion not available, use the arrow keys.",
    # quiz answer options
    "On your left", "On your right", "No wall to follow", "Turn left", "Turn right", "No turn",
    # step 5 (guided intro, pause, rate, pointing)
    "Press Up to take a step.",
    "Press Left or Right to turn.",
    "Press Q to hear what is around you.",
    "You're ready. Press Enter to start the rehearsal.",
    "Intro skipped. Press Enter to start the rehearsal.",
    "Try turning left or right, then step.",
    "Press Space to hear the instruction again, or W for where you are.",
    "Left the rehearsal. Press Enter on Explore to come back.",
    "Back in the rehearsal.",
    "Top bar.",
    "Rehearsal.",
    "Keys.",
    "Agent and data.",
    # page shell (stream 2): the line each page says on arrival, and the F6 parts
    "We are outside. Walk from the curb to the door.",
    "Check yourself. Point to the destination, then answer three questions.",
    "Here is how it went.",
    "How it was built. This page is for judges and companions.",
    "Controls.", "View.",
    "Paused. Press P to resume.",
    # key card on first entry inside (stream 2): spoken once, again on the question mark
    "Up walks. Left and Right turn. Enter starts the rehearsal. Q tells you what is around you. P pauses. The question mark brings this back.",
    "Fastest.",
    "Slowest.",
    "That's close.",
    "Not far off.",
    "Quite a way off.",
    "Arrows walk and turn. Tab: choose a place. Enter: go there. B: beacon on or off, in Rehearse a hint. X: back to Explore. Q: around me. E: ahead. W: where am I. Space: repeat. V: photo view. P: pause. K: these keys again.",
    # Showcase photo view fallback (web/src/showcase/load.ts FALLBACK_LINE)
    "Photo view needs internet; showing the scan.",
    # V toggles the photo view (web/src/app_v2.ts PHOTO_ON_LINE, PHOTO_OFF_LINE)
    "Photo view, the listing's own photos.", "Scan view.",
    # #/inside safe state after a setup error (web/src/app_v2.ts OOPS_LINE)
    "Something went wrong. Press Escape or F6 to move on.",
    # home address box tiers (web/src/home/home.ts, engine/dr/api_resolve.py): a known Houston or LA model with no
    # built package, then anything else; the building buttons follow both
    "No indoor scan yet for this building.",
    "This building is not available yet.",
    "Choose one of the buildings below.",
    # continuous beacon (stream D, audio redesign): B toggles it, Escape clears a chosen target
    "Beacon on.", "Target cleared.",
    # three leg demo (stream D): X or the summary button goes back to Explore (web session.ts explore())
    "Back to Explore.", "Already in Explore.",
    # Check yourself (C or the button, web/src/modes/check.ts; engine/dr/check_quiz.py makes the per-route lines)
    "Check yourself. Three quick questions.",
    "Three of three. You knew every turn. Walk the whole way again? Press Y or Enter.",
    "That stretch is done. Press C to check yourself again, or X for Explore.",
]
NO_INDOOR_LINE = "No indoor scan yet for this building."
NOT_AVAILABLE_LINE = "This building is not available yet."
CHOOSE_BELOW_LINE = "Choose one of the buildings below."
_SOUND = ["Sound on.", "Sound did not start. Press Space or tap to try again."]
_MOTION = ["Motion on. Hold the phone flat, top edge forward. Turn your body to turn.",
           "Motion not available. Use the Step button and the arrow buttons.",
           "Motion not available, use the arrow keys."]


def _hull(pts):
    p = sorted(set((float(x), float(y)) for x, y in pts))
    if len(p) < 3:
        return p
    def cr(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for q in p:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], q) <= 0: lo.pop()
        lo.append(q)
    for q in reversed(p):
        while len(up) >= 2 and cr(up[-2], up[-1], q) <= 0: up.pop()
        up.append(q)
    return lo[:-1] + up[:-1]


def room_size(polygon) -> tuple[float, float]:
    """Minimum-area bounding rectangle, long side first; mirrors web/src/modes/rooms.ts roomSize."""
    h = _hull(polygon)
    if len(h) < 3:
        return (0.0, 0.0)
    best, area = (0.0, 0.0), float("inf")
    for i, a in enumerate(h):
        b = h[(i + 1) % len(h)]
        l = math.hypot(b[0] - a[0], b[1] - a[1])
        if l == 0:
            continue
        ux, uy = (b[0] - a[0]) / l, (b[1] - a[1]) / l
        us = [(q[0] - a[0]) * ux + (q[1] - a[1]) * uy for q in h]
        vs = [-(q[0] - a[0]) * uy + (q[1] - a[1]) * ux for q in h]
        w, d = max(us) - min(us), max(vs) - min(vs)
        if w * d < area:
            area, best = w * d, (w, d)
    return best if best[0] >= best[1] else (best[1], best[0])


def _round(x: float) -> int:
    return math.floor(x + 0.5)  # JS Math.round


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
        out.add(f"Target set, {sp}.")                      # web interact.ts setTarget (Tab, then Enter)
        out.add(f"You have reached the {sp.lower()}.")     # web interact.ts arrivedLine (Explore arrival at a target)
        out.add(f"Heading to the {sp.lower()}.")           # web interact.ts headingLine (Tab auto-commit after 3 s)
    for r in pkg.rooms:
        if r.label:
            out.add(r.label)
            out.add(f"You are entering the {r.label.lower()}.")
            l, w = room_size(r.polygon)
            if l > 0:
                out.add(f"About {_round(l)} by {_round(w)} metres.")
                out.add(f"{r.label}, about {_round(l)} by {_round(w)} metres.")
    for e in pkg.entrances:
        out.add(e.label)
        out.add(f"Target set, {e.label}.")                 # the entrance is a Tab target too (web interact.ts places)
        out.add(f"You have reached the {e.label.lower()}.")
        out.add(f"Heading to the {e.label.lower()}.")
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
            out.add(f"Target cleared. Heading to {spoken[rt.to]}.")   # web interact.ts escape()
    out.add("You have reached the destination.")
    out |= check_quiz.lines(pkg)
    a = pkg.arrival
    if a:
        out |= set(a.lines) | set(a.recovery) | {c.line for c in a.cues if c.line}
    return {normalise(t) for t in out if t and t.strip()}


def add_voice_lines(pkg: BuildingPackage) -> None:
    pkg.voice_lines = [VoiceLine(text=t, id=line_id(t)) for t in sorted(collect(pkg))]
