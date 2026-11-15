"""Check yourself quiz lines (mirror of web/src/modes/check.ts): every line the C quiz may speak, per route, so each
gets a pre-rendered clip. Code builds the questions from the route values; nothing here is a model sentence."""
from __future__ import annotations

from dr.package import BuildingPackage, Route

CHECK_START = "Check yourself. Three quick questions."
TURN_OPTS = ["Turn left", "Turn right", "Keep straight", "You arrive"]
SCORE = ["None this time, and that is fine.", "One of three. A good start.", "Two of three. Nice.", "Three of three."]
ALL_RIGHT = "Three of three. You knew every turn. Walk the whole way again? Press Y or Enter."
STRETCH_DONE = "That stretch is done. Press C to check yourself again, or X for Explore."
FIXED = [CHECK_START, ALL_RIGHT, STRETCH_DONE]


def _spoken(lm) -> str:
    return (lm.spoken or "").strip() or lm.label.strip()


def passed(pkg: BuildingPackage, route: Route, i: int) -> str | None:
    s = route.segments[i]
    by = {lm.id: _spoken(lm) for lm in pkg.landmarks}
    for lid in s.landmarks_passed:
        n = by.get(lid, "")
        if n and f"passing the {n}" in s.instruction:
            return n
    return None


def _step_opts(s: int) -> list[str]:
    v = [s, s + 4, s + 8, s + 12] if s <= 4 else [s - 4, s, s + 4, s + 8]
    return [str(x) for x in v]


def check_segs(n: int) -> list[int]:
    return [(k * (n - 1)) // 2 for k in range(3)]


def build_check(pkg: BuildingPackage, route: Route) -> list[dict]:
    n = len(route.segments)
    a, b, c = check_segs(n)
    out: list[dict] = []
    name = passed(pkg, route, a)
    if name:
        by = {lm.id: _spoken(lm) for lm in pkg.landmarks}
        names = sorted({_spoken(lm) for lm in pkg.landmarks})
        near = {by.get(i, "") for i in route.segments[a].landmarks_passed}
        others = [x for x in names if x and x != name and x not in route.segments[a].instruction and x not in near][:3]
        opts = sorted([name, *others])
        out.append({"seg": a, "q": f"In stretch {a + 1}, what do you walk past?", "options": opts, "answer": opts.index(name)})
    else:
        o = _step_opts(route.segments[a].steps)
        out.append({"seg": a, "q": f"About how many steps is stretch {a + 1}?", "options": o, "answer": o.index(str(route.segments[a].steps))})
    t = 3 if b == n - 1 else {"left": 0, "right": 1, "none": 2}[route.segments[b].turn_after]
    out.append({"seg": b, "q": f"At the end of stretch {b + 1}, what comes next?", "options": list(TURN_OPTS), "answer": t})
    o = _step_opts(route.segments[c].steps)
    out.append({"seg": c, "q": f"About how many steps is stretch {c + 1}?", "options": o, "answer": o.index(str(route.segments[c].steps))})
    return out


def question_line(k: int, q: dict) -> str:
    return f"Question {k + 1} of 3. {q['q']} " + " ".join(f"{i + 1}, {o}." for i, o in enumerate(q["options"]))


def answer_line(ok: bool, opt: str) -> str:
    return f"Yes, {opt}. Press Enter." if ok else f"It was {opt}. Press Enter."


def weak_line(pkg: BuildingPackage, route: Route, seg: int, correct: int) -> str:
    name = passed(pkg, route, seg)
    where = f"stretch {seg + 1}, past the {name.lower()}" if name else f"stretch {seg + 1}"
    return f"{SCORE[correct]} You were least sure about {where}. Practise that stretch? Press Y or Enter."


def lines(pkg: BuildingPackage) -> set[str]:
    out: set[str] = set(FIXED)
    for rt in pkg.routes:
        if not rt.segments:
            continue
        for k, q in enumerate(build_check(pkg, rt)):
            out.add(question_line(k, q))
            for o in q["options"]:
                out.add(answer_line(True, o))
                out.add(answer_line(False, o))
        for seg in range(len(rt.segments)):          # the coach may pick any stretch
            for correct in range(3):
                out.add(weak_line(pkg, rt, seg, correct))
    return out
