import pytest
from fastapi.testclient import TestClient

from dr.coach_rules import choose_focus, make_plan, tally
from dr.package import RunLog, RunPlan


def log(events=(), quiz=()):
    return RunLog.model_validate({"thread_id": "t", "route_id": "r", "events": [
        {"t": 0, "seg": s, "kind": k, "pos": [0, 0]} for s, k in events],
        "quiz": [{"q": "q", "seg": s, "correct": c} for s, c in quiz], "point": []})


def test_focus_on_failed_quiz():
    assert choose_focus(log(quiz=[(2, False), (0, True)]), 4) == 2


def test_weights_and_hint_counts_like_hesitate():
    assert tally(log([(0, "off_route"), (1, "hesitate"), (1, "hint"), (2, "bump")]), 3) == [1.5, 2.0, 0.5]


def test_ties_earlier_and_no_errors():
    assert choose_focus(log([(0, "hesitate"), (2, "hesitate")]), 3) == 0
    assert choose_focus(log(), 3) == -1


def test_plan_differs():
    assert make_plan(choose_focus(log(quiz=[(2, False)]), 4)) != make_plan(-1)


def test_approach_starts_two_earlier():
    assert make_plan(3, "approach").start_segment == 1
    assert make_plan(0, "approach").start_segment == 0
    assert make_plan(3, "slow").speech_rate == 0.8
    assert make_plan(3, "bogus") == make_plan(3)
    assert make_plan(-1) == RunPlan(start_segment=0, repeat_segment=None, extra_cues=False, speech_rate=1.0)
    p = make_plan(3)
    assert (p.start_segment, p.repeat_segment, p.extra_cues, p.speech_rate) == (2, 3, True, 0.9)


def test_hint_kind_accepted_by_model():
    assert log([(0, "hint")]).events[0].kind == "hint"


def _client():
    from dr.api import app
    return TestClient(app)


BODY = {"thread_id": "t", "route_id": "r", "building_id": "fixture",
        "events": [{"t": 0, "seg": 1, "kind": "hint", "pos": [0, 0]}], "quiz": [], "point": []}


def test_coach_endpoint_offline(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("DR_FAST_MODEL", raising=False)
    r = _client().post("/api/coach", json=BODY)
    assert r.status_code == 200
    j = r.json()
    assert j["focus_segment"] == 1 and j["plan"]["repeat_segment"] == 1 and j["line"]


def test_coach_line_grounded_or_template(monkeypatch):
    import dr.coach_rules as cr
    monkeypatch.setattr(cr, "complete", lambda *a, **k: "Walk 99 steps again.")
    j = _client().post("/api/coach", json=BODY).json()
    assert "99" not in j["line"]
    monkeypatch.setattr(cr, "complete", lambda *a, **k: "Let's practise that turn again.")
    j = _client().post("/api/coach", json=BODY).json()
    assert j["line"] == "Let's practise that turn again."
