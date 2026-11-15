"""Coach rules (Task 10 engine): deterministic focus and plan. The model may only write one line,
and that line passes grounded() or is replaced by a template (CLAUDE.md rule 1)."""
from __future__ import annotations

from dr.grounding import grounded
from dr.llm import complete
from dr.package import RunLog, RunPlan

WEIGHTS = {"off_route": 1.5, "hesitate": 1.0, "hint": 1.0, "bump": 0.5}
WRONG = 2.0
DRILLS = ("repeat", "approach", "slow")


def tally(log: RunLog, n_segments: int) -> list[float]:
    t = [0.0] * n_segments

    def add(seg: int, w: float) -> None:
        if 0 <= seg < n_segments:
            t[seg] += w

    for q in log.quiz:
        if not q.correct:
            add(q.seg, WRONG)
    for e in log.events:
        if e.kind in WEIGHTS:
            add(e.seg, WEIGHTS[e.kind])
    return t


def choose_focus(log: RunLog, n_segments: int) -> int:
    t = tally(log, n_segments)
    m = max(t, default=0.0)
    return -1 if m <= 0 else t.index(m)


def make_plan(focus: int, drill: str = "repeat") -> RunPlan:
    if focus < 0:
        return RunPlan(start_segment=0, repeat_segment=None, extra_cues=False, speech_rate=1.0)
    back = 2 if drill == "approach" else 1
    return RunPlan(start_segment=max(0, focus - back), repeat_segment=focus, extra_cues=True,
                   speech_rate=0.8 if drill == "slow" else 0.9)


def template_line(focus: int, plan: RunPlan) -> str:
    if focus < 0:
        return "No mistakes this time. Run it again at the same pace."
    return (f"Let's practise stretch {focus + 1} again. "
            f"The next run starts at stretch {plan.start_segment + 1}.")


def coach_line(log: RunLog, focus: int, plan: RunPlan, allowed: set[float] | None = None) -> str:
    """One model sentence if it is grounded, else the template."""
    tpl = template_line(focus, plan)
    if focus < 0:
        return tpl
    ok = {float(focus + 1), float(plan.start_segment + 1)} | (allowed or set())
    kinds = sorted({e.kind for e in log.events if e.seg == focus} |
                   ({"wrong answer"} if any(not q.correct and q.seg == focus for q in log.quiz) else set()))
    text = complete(
        "You coach a blind visitor rehearsing a route by sound. Write ONE short sentence (under 120 characters) "
        "telling them what to practise. Use only the stretch numbers given. Never invent distances or step counts.",
        f"Practise stretch {focus + 1} (errors: {', '.join(kinds) or 'none'}). The next run starts at stretch "
        f"{plan.start_segment + 1}.", max_tokens=80)
    text = " ".join(text.split())
    if text and len(text) <= 160 and grounded(text, ok):
        return text
    return tpl


def coach(log: RunLog, n_segments: int, allowed: set[float] | None = None) -> dict:
    focus = choose_focus(log, n_segments)
    plan = make_plan(focus)
    return {"plan": plan.model_dump(), "focus_segment": focus, "line": coach_line(log, focus, plan, allowed)}
