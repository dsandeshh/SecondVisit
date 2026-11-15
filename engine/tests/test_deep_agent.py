"""Offline tests for the SecondVisit deep agent. No network, no API key, no dr.* engine.

Run: pytest -q test_deep_agent.py
In the repo (engine/tests/test_deep_agent.py) change the import to `from dr.agents import deep_agent as da`.

Scripted fake chat models (langchain_core GenericFakeChatModel) drive the orchestrator and each
subagent through real deepagents machinery: write_todos, the task tool, the virtual filesystem,
interrupt and resume, Command file updates, and stream events.
"""
from __future__ import annotations

import json
import uuid

import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage
from langgraph.types import Command

try:
    from dr.agents import deep_agent as da
except ImportError:
    raise


# ---------------------------------------------------------------- fakes
class Scripted(GenericFakeChatModel):
    """Fake chat model that accepts bind_tools and replays a fixed list of AI messages."""

    def bind_tools(self, tools, **kwargs):
        return self


def ai(text: str = "", *calls: tuple[str, dict]) -> AIMessage:
    return AIMessage(content=text, tool_calls=[
        {"name": n, "args": a, "id": f"call_{uuid.uuid4().hex[:8]}"} for n, a in calls])


def scripted(*msgs: AIMessage) -> Scripted:
    return Scripted(messages=iter(list(msgs)))


SEGMENTS = [
    {"id": "s0", "start": [0.5, 6.0], "end": [0.5, 10.9], "heading_deg": 0.0, "length_m": 4.9, "steps": 7,
     "wall_side": "left", "open_m": 0.0, "landmarks_passed": [], "turn_after": "right", "turn_deg": 90.0,
     "instruction": "Facing into the building. Walk 7 steps, wall on your left."},
    {"id": "s1", "start": [0.5, 10.9], "end": [9.6, 10.9], "heading_deg": 90.0, "length_m": 9.1, "steps": 13,
     "wall_side": "left", "open_m": 1.0, "landmarks_passed": ["pillar"], "turn_after": "none", "turn_deg": 0.0,
     "instruction": "Turn right to 3 o'clock. Walk 13 steps, wall on your left, passing the pillar."},
    {"id": "s2", "start": [9.6, 10.9], "end": [17.9, 10.9], "heading_deg": 90.0, "length_m": 8.3, "steps": 12,
     "wall_side": "left", "open_m": 0.0, "landmarks_passed": [], "turn_after": "none", "turn_deg": 0.0,
     "instruction": "Walk 12 steps, wall on your left. The Reception desk is at 2 o'clock, about 2 steps."},
]


class FakeEngine:
    """Implements the Engine protocol on a tiny fixture. Records calls."""

    def __init__(self):
        self.calls: list[tuple] = []

    def resolve(self, name):
        self.calls.append(("resolve", name))
        if "nowhere" in name.lower():
            raise LookupError("no match")
        return {"building_id": "fixture", "property": None, "floor": "1", "suite": None,
                "matterport_id": None, "lat": 40.35, "lon": -74.65, "source": "directory"}

    def package(self, building_id):
        if building_id != "fixture":
            raise FileNotFoundError(building_id)
        return {"version": 1, "id": "fixture", "name": "Lobby fixture", "source": "matterport", "model_id": None,
                "generated_at": "2026-11-14T20:00:00Z", "notes": ["pillar position paced, not measured"],
                "entrances": [{"id": "ent_w", "label": "West door", "pos": [0.5, 6.0], "heading_deg": 90}],
                "landmarks": [
                    {"id": "desk", "kind": "desk", "label": "Reception desk", "pos": [18.5, 10.8], "confidence": 1.0, "fixed": True},
                    {"id": "desk_clinic", "kind": "desk", "label": "Clinic reception", "pos": [18.5, 1.2], "confidence": 1.0, "fixed": True},
                    {"id": "pillar", "kind": "pillar", "label": "pillar", "pos": [10, 6], "confidence": 0.5, "fixed": True}],
                "routes": [{"id": "ent_w__desk", "from": "ent_w", "to": "desk", "path": [],
                            "segments": SEGMENTS, "score": {"total": 71.4, "parts": {}}}],
                "arrival": None, "grid": {}, "rooms": [], "doors": [], "sim": {}}

    def build_route(self, building_id, from_id, to_id, clearance_m, drop_specks_m2):
        self.calls.append(("build_route", to_id, clearance_m, drop_specks_m2))
        if to_id == "desk_clinic" and clearance_m >= 0.35 and drop_specks_m2 == 0:
            raise da.NoRoute(f"no route from (0.5, 6.0) to (18.5, 1.2)")
        parts = {"length_m": 22.3, "wall_share": 0.82, "open_m": 1.0, "turns": 1, "decisions": 1,
                 "hazards": 0, "landmarks_per_10m": 0.45}
        return {"id": f"{from_id}__{to_id}", "from": from_id, "to": to_id, "path": [[0.5, 6.0]],
                "segments": [dict(s) for s in SEGMENTS], "score": {"total": 71.4, "parts": parts}}

    def simulate(self, building_id, route, runs):
        self.calls.append(("simulate", runs))
        return {"runs": runs, "arrival_rate": 0.64, "hotspots": [{"pos": [9.6, 10.9], "segment": 1, "near": "pillar", "share": 0.41}]}

    def tally(self, run_log, n):
        t = [0.0] * n
        w = {"off_route": 1.5, "hesitate": 1.0, "bump": 0.5}
        for e in run_log.get("events", []):
            if e["kind"] in w and 0 <= e["seg"] < n:
                t[e["seg"]] += w[e["kind"]]
        for q in run_log.get("quiz", []):
            if not q["correct"] and 0 <= q["seg"] < n:
                t[q["seg"]] += 2.0
        return t

    def make_plan(self, focus, drill="repeat"):
        if focus < 0:
            return {"start_segment": 0, "repeat_segment": None, "extra_cues": False, "speech_rate": 1.0}
        start = max(0, focus - (2 if drill == "approach" else 1))
        return {"start_segment": start, "repeat_segment": focus, "extra_cues": True,
                "speech_rate": 0.8 if drill == "slow" else 0.9}

    def layout_candidates(self, building_id, desk_id, n):
        return [{"pos": [2.0, 11.0], "score": 84.2, "arrival_rate": 0.88},
                {"pos": [6.0, 11.0], "score": 79.0, "arrival_rate": 0.8}][:n]

    def evaluate_layout(self, building_id, desk, fixes):
        bonus = 3.0 * len(fixes)
        if list(desk) == [18.5, 10.8]:
            return {"score": 61.0, "arrival_rate": 0.62, "open_m": 7.5, "turns": 3, "route": {"segments": SEGMENTS}}
        return {"score": 84.2 + bonus, "arrival_rate": 0.88, "open_m": 1.2, "turns": 1, "route": {"segments": SEGMENTS}}

    def grounded(self, text, allowed):
        from dr.grounding import grounded
        return grounded(text, allowed)

    def landmark_review(self, building_id):
        return {"landmarks": [{"id": l["id"], "kind": l["kind"], "label": l["label"], "confidence": l["confidence"],
                               "fixed": l["fixed"], "source": "ai"} for l in self.package(building_id)["landmarks"]]}

    def fix_between(self, building_id, kind, a_id, b_id):
        pts = {"ent_w": [0.5, 6.0], "pillar": [10, 6], "desk": [18.5, 10.8]}
        if a_id not in pts or b_id not in pts:
            raise KeyError(f"unknown landmark id {a_id if a_id not in pts else b_id}")
        return {"kind": kind, "path": [pts[a_id], pts[b_id]]}


RUN_LOG = {"route_id": "ent_w__desk",
           "events": [{"t": 1, "seg": 0, "kind": "start", "pos": [0.5, 6]},
                      {"t": 9, "seg": 1, "kind": "off_route", "pos": [6, 8]},
                      {"t": 14, "seg": 2, "kind": "bump", "pos": [12, 11]}],
           "quiz": [{"q": "Which way do you turn after the first wall?", "seg": 1, "correct": False},
                    {"q": "How many steps to the desk?", "seg": 2, "correct": True}]}


@pytest.fixture
def ws():
    return da.open_workspace(str(uuid.uuid4()), FakeEngine())


# ---------------------------------------------------------------- tools, called directly
def test_inspect_writes_dossier_with_uncertainty(ws):
    p, files = da.t_inspect_building(ws, "fixture")
    assert p["ok"] and "/building_dossier.md" in files
    text = " ".join(p["uncertainty"])
    assert "Matterport scan" in text and "no aerial arrival" in text and "confidence" in text and "pillar" in text
    assert "possibly" not in text.lower()


def test_no_route_offers_bounded_retries(ws):
    p, _ = da.t_plan_route(ws, "fixture", "ent_w", "desk_clinic")
    assert p["ok"] is False and p["error"] == "no_route"
    assert {"clearance_m": 0.3, "drop_specks_m2": 0.0} in p["next_options"]
    ok, files = da.t_plan_route(ws, "fixture", "ent_w", "desk_clinic", clearance_m=0.30)
    assert ok["ok"] and ok["relaxed"]["is_relaxed"] and any(f.startswith("/rehearsal/route_") for f in files)
    # the model cannot push clearance below the floor
    low, _ = da.t_plan_route(ws, "fixture", "ent_w", "desk", clearance_m=0.05)
    assert ws.routes[low["route_id"]]["relaxed"]["clearance_m"] == da.MIN_CLEARANCE_M


def test_set_plan_overrides_non_max_focus(ws):
    r, _ = da.t_plan_route(ws, "fixture", "ent_w", "desk")
    ws.run_logs["L9"] = RUN_LOG
    p, files = da.t_set_plan(ws, "L9", r["route_id"], 2, "approach", "Nice work.")
    assert p["focus_segment"] == 1 and p["notes"] and "overridden" in p["notes"][0]
    plan = json.loads(files["/rehearsal/rehearsal_plan.json"])
    assert plan["run_plan"]["start_segment"] == 0 and plan["run_plan"]["repeat_segment"] == 1


def test_coach_line_with_invented_number_is_replaced(ws):
    r, _ = da.t_plan_route(ws, "fixture", "ent_w", "desk")
    ws.run_logs["L9"] = RUN_LOG
    p, _ = da.t_set_plan(ws, "L9", r["route_id"], 1, "repeat", "Only 5 steps before the turn!")
    assert "5 steps" not in p["line"] and any("template" in n for n in p["notes"])
    p2, _ = da.t_set_plan(ws, "L9", r["route_id"], 1, "repeat", "Walk the 13 steps past the pillar again.")
    assert p2["line"].startswith("Walk the 13 steps")


def test_layout_round_strips_invented_numbers_and_tracks_best(ws):
    da.t_inspect_building(ws, "fixture")
    c, _ = da.t_layout_candidates(ws, "fixture", "desk", 2)
    assert c["current"]["score"] == 61.0
    e, _ = da.t_evaluate_layout(ws, "fixture", c["candidates"][0]["candidate_id"],
                                [{"kind": "tactile_strip", "from_id": "ent_w", "to_id": "pillar"}])
    assert e["score"] == pytest.approx(87.2)
    bad, _ = da.t_evaluate_layout(ws, "fixture", c["candidates"][0]["candidate_id"], [{"kind": "ramp", "from_id": "a", "to_id": "b"}])
    assert bad["ok"] is False
    _, files = da.t_record_round(ws, e["eval_id"], "Strip from the door", "Arrival rises to 97 percent.")
    assert "97" not in files["/venue/layout_report.md"]
    assert da.best_eval(ws)["eval_id"] == e["eval_id"]


def test_model_from_env_prefixes_bare_anthropic_id(monkeypatch):
    monkeypatch.setenv("DR_MODEL", "claude-haiku-5-5")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-not-used")
    m = da.model_from_env("DR_MODEL")
    assert type(m).__name__ == "ChatAnthropic" and m.model == "claude-haiku-5-5"
    monkeypatch.setenv("DR_MODEL", "openai:gpt-x")
    assert da.model_from_env("DR_MODEL") == "openai:gpt-x"


# ---------------------------------------------------------------- agent construction
def test_build_agent_smoke():
    agent = da.build_agent(model=scripted(ai("hi")), sub_model=scripted(ai("hi")))
    assert agent.name == "secondvisit"
    names = {s["name"] for s in da.SUBAGENTS_SPEC}
    assert names == {"site_investigator", "annotator", "route_planner", "coach", "layout_advisor"}
    # every engine facing tool belongs to exactly one subagent
    assert set(da.TOOL_OWNER) == {"resolve_place", "inspect_building", "review_landmarks", "plan_route", "simulate_route",
                                  "get_errors", "set_plan", "layout_candidates", "evaluate_layout", "record_round"}


# ---------------------------------------------------------------- full run with scripted models
def visitor_models():
    orch = scripted(
        ai("", ("write_todos", {"todos": [
            {"content": "Find building and destination", "status": "in_progress"},
            {"content": "Plan and stress test route", "status": "pending"},
            {"content": "Finish", "status": "pending"}]})),
        ai("", ("task", {"subagent_type": "site_investigator",
                         "description": "Visitor: appointment at the clinic in the lobby fixture. Find building and destination."})),
        ai("", ("ask_visitor", {"question": "Two reception desks match. Which one is yours?",
                                "option_ids": ["desk", "desk_clinic"]})),
        ai("", ("task", {"subagent_type": "route_planner",
                         "description": "building fixture, from ent_w to desk_clinic"})),
        ai("", ("read_file", {"file_path": "/building_dossier.md"})),
        ai("", ("finalize", {"kind": "rehearsal", "building_id": "fixture", "route_id": "r1",
                             "message": "Your route is ready and 99 percent safe."})),
        ai("Done."),
    )
    subs = {
        "site_investigator": scripted(
            ai("", ("resolve_place", {"name": "the clinic in the lobby fixture"})),
            ai("", ("inspect_building", {"building_id": "fixture"})),
            ai("", ("edit_file", {"file_path": "/building_dossier.md", "old_string": "## Agent notes\n",
                                  "new_string": "## Agent notes\nTwo desks match 'clinic'; the pillar is uncertain.\n"})),
            ai("AMBIGUOUS desk, desk_clinic. building_id fixture, entrance ent_w.")),
        "route_planner": scripted(
            ai("", ("plan_route", {"building_id": "fixture", "from_id": "ent_w", "to_id": "desk_clinic"})),
            ai("", ("plan_route", {"building_id": "fixture", "from_id": "ent_w", "to_id": "desk_clinic", "clearance_m": 0.3})),
            ai("", ("simulate_route", {"route_id": "r1", "runs": 100})),
            ai("route_id r1, relaxed, weakest segment 1.")),
        "coach": scripted(ai("unused")),
        "layout_advisor": scripted(ai("unused")),
        "annotator": scripted(ai("unused")),
    }
    return orch, subs


def collect(agent, inp, cfg):
    events = []
    mapper = __import__("dr.agents.api_stream", fromlist=["x"]).TraceMapper() if _has_api() else None
    for part in agent.stream(inp, cfg, stream_mode=["updates", "custom"], subgraphs=True, version="v2"):
        events.extend(mapper.map(part) if mapper else [part])
    return events


def _has_api():
    try:
        from dr.agents import api_stream  # noqa: F401
        return True
    except ImportError:
        return False


def test_visitor_run_asks_retries_and_grounds_numbers():
    orch, subs = visitor_models()
    engine = FakeEngine()
    tid = str(uuid.uuid4())
    ws = da.open_workspace(tid, engine)
    agent = da.build_agent(model=orch, sub_model=subs)
    cfg = {"configurable": {"thread_id": tid}}

    ev1 = collect(agent, da.initial_input(ws, "I have an appointment at the clinic in the lobby fixture"), cfg)
    kinds1 = [e["type"] for e in ev1]
    assert "todos" in kinds1 and "delegate" in kinds1 and kinds1[-1] == "question"
    assert ev1[-1]["options"][1] == {"id": "desk_clinic", "label": "Clinic reception"}

    ev2 = collect(agent, Command(resume="desk_clinic"), cfg)
    calls = [c for c in engine.calls if c[0] == "build_route"]
    assert calls[0][2] == 0.35 and calls[1][2] == 0.3          # retried with a relaxed clearance
    assert any(e["type"] == "tool_result" and e["tool"] == "plan_route" and not e["ok"] for e in ev2)

    state = agent.get_state(cfg).values
    assert {"/building_dossier.md", "/rehearsal/route_r1.json"} <= set(state["files"])
    assert "Two desks match" in state["files"]["/building_dossier.md"]["content"]
    assert ws.final["kind"] == "rehearsal" and ws.final["route"]["to"] == "desk_clinic"
    assert ws.final["sim"]["arrival_rate"] == 0.64                 # number from code
    assert "99" not in ws.final["message"]                          # invented number dropped
    assert any("Matterport scan" in u for u in ws.final["uncertainty"])


def test_coach_run_through_agent_adapts_plan():
    tid = str(uuid.uuid4())
    ws = da.open_workspace(tid, FakeEngine())
    r, _ = da.t_plan_route(ws, "fixture", "ent_w", "desk")
    rid = r["route_id"]
    inp = da.initial_input(ws, "Coach the visitor after their run.", RUN_LOG, rid)
    lid = next(iter(ws.run_logs))
    orch = scripted(
        ai("", ("task", {"subagent_type": "coach", "description": f"run_log_id {lid}, route_id {rid}"})),
        ai("", ("finalize", {"kind": "rehearsal", "building_id": "fixture", "route_id": rid, "plan_id": "p1"})),
        ai("ok"))
    coach = scripted(
        ai("", ("get_errors", {"run_log_id": lid, "route_id": rid})),
        ai("", ("set_plan", {"run_log_id": lid, "route_id": rid, "focus_segment": 1, "drill": "approach",
                             "line": "Let's practise the right turn at the end of the wall again."})),
        ai("", ("write_file", {"file_path": "/coach_notes.md", "content": "Went off route after the first wall.\nApproach drill: start earlier."})),
        ai("plan p1, focus 1"))
    subs = {n: scripted(ai("unused")) for n in ("site_investigator", "annotator", "route_planner", "layout_advisor")} | {"coach": coach}
    agent = da.build_agent(model=orch, sub_model=subs)
    cfg = {"configurable": {"thread_id": tid}}
    agent.invoke(inp, cfg)
    plan = ws.final["coach"]
    assert plan["focus_segment"] == 1 and plan["drill"] == "approach"
    assert plan["plan"]["start_segment"] == 0 and plan["plan"]["repeat_segment"] == 1
    files = agent.get_state(cfg).values["files"]
    assert "/coach_notes.md" in files and "/rehearsal/rehearsal_plan.json" in files and "/input/run_log.json" in files


# ---------------------------------------------------------------- scripted fallback
def test_scripted_fallback_visitor_and_venue(ws):
    events = []
    out = da.run_scripted(ws, "appointment at the lobby fixture", events.append)
    assert out["kind"] == "rehearsal" and out["sim"]["arrival_rate"] == 0.64
    assert [e["tool"] for e in events if e["type"] == "tool_call"] == ["resolve_place", "inspect_building", "plan_route", "simulate_route"]
    ws2 = da.open_workspace(str(uuid.uuid4()), FakeEngine())
    out2 = da.run_scripted(ws2, "where should our reception go", lambda e: None, building_hint="fixture")
    assert out2["kind"] == "layout" and out2["report"]["best"]["score"] > out2["report"]["current"]["score"]


# ---------------------------------------------------------------- SSE endpoint
def test_sse_endpoint_falls_back_when_model_fails(tmp_path, monkeypatch):
    fastapi = pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient
    from dr.agents import api_stream

    class Boom:
        async def astream(self, *a, **k):
            raise RuntimeError("overloaded_error 529")
            yield  # pragma: no cover

    monkeypatch.setattr(api_stream, "TRACE_DIR", tmp_path)
    api_stream.set_test_doubles(agent=Boom(), engine=FakeEngine())
    app = fastapi.FastAPI()
    app.include_router(api_stream.router)
    client = TestClient(app)
    with client.stream("POST", "/api/agent", json={"text": "appointment at the lobby fixture"}) as r:
        body = "".join(r.iter_text())
    events = [json.loads(line[6:]) for line in body.splitlines() if line.startswith("data: ")]
    kinds = [e["type"] for e in events]
    assert kinds[0] == "start" and "fallback" in kinds and kinds[-1] == "final"
    assert events[-1]["result"]["mode"] == "scripted"
    assert list(tmp_path.glob("*.jsonl"))                              # recorded for replay
    name = next(tmp_path.glob("*.jsonl")).name
    with client.stream("GET", f"/api/agent/replay?name={name}&speed=100") as r:
        replay = "".join(r.iter_text())
    assert '"mode": "replay"' in replay and '"final"' in replay
    api_stream.set_test_doubles(None, None)


def test_sse_endpoint_streams_real_agent_events(tmp_path, monkeypatch):
    fastapi = pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient
    from dr.agents import api_stream

    orch, subs = visitor_models()
    monkeypatch.setattr(api_stream, "TRACE_DIR", tmp_path)
    api_stream.set_test_doubles(agent=da.build_agent(model=orch, sub_model=subs), engine=FakeEngine())
    app = fastapi.FastAPI()
    app.include_router(api_stream.router)
    client = TestClient(app)
    with client.stream("POST", "/api/agent", json={"text": "appointment at the clinic"}) as r:
        ev = [json.loads(l[6:]) for l in "".join(r.iter_text()).splitlines() if l.startswith("data: ")]
    q = ev[-1]
    assert q["type"] == "question" and q["thread_id"]
    with client.stream("POST", "/api/agent/resume", json={"thread_id": q["thread_id"], "answer": "desk_clinic"}) as r:
        ev2 = [json.loads(l[6:]) for l in "".join(r.iter_text()).splitlines() if l.startswith("data: ")]
    agents = {e.get("agent") for e in ev2 if e["type"] in ("tool_call", "tool_result")}
    assert "route_planner" in agents
    assert ev2[-1]["type"] == "final" and ev2[-1]["result"]["route"]["to"] == "desk_clinic"
    api_stream.set_test_doubles(None, None)


def test_venue_question_returns_layout_report():
    tid = str(uuid.uuid4())
    ws = da.open_workspace(tid, FakeEngine())
    orch = scripted(
        ai("", ("task", {"subagent_type": "site_investigator", "description": "venue: lobby fixture, current desk"})),
        ai("", ("task", {"subagent_type": "layout_advisor", "description": "building fixture, current desk id desk"})),
        ai("", ("finalize", {"kind": "layout", "building_id": "fixture", "message": "Moving reception next to the west wall helps most."})),
        ai("ok"))
    site = scripted(ai("", ("inspect_building", {"building_id": "fixture"})), ai("building_id fixture, desk desk"))
    layout = scripted(
        ai("", ("layout_candidates", {"building_id": "fixture", "desk_id": "desk", "n": 2})),
        ai("", ("evaluate_layout", {"building_id": "fixture", "candidate_id": "c1"})),
        ai("", ("record_round", {"eval_id": "e1", "proposal": "Desk on the west wall", "critique": "Travellers still drift at the pillar."})),
        ai("", ("evaluate_layout", {"building_id": "fixture", "candidate_id": "c1",
                                    "fixes": [{"kind": "tactile_strip", "from_id": "ent_w", "to_id": "pillar"}]})),
        ai("", ("record_round", {"eval_id": "e2", "proposal": "Add a tactile strip from the door to the pillar", "critique": "Fewer travellers lost."})),
        ai("best e2"))
    subs = {"site_investigator": site, "layout_advisor": layout, "route_planner": scripted(ai("x")), "annotator": scripted(ai("x")), "coach": scripted(ai("x"))}
    agent = da.build_agent(model=orch, sub_model=subs)
    agent.invoke(da.initial_input(ws, "Where should our reception go?"), {"configurable": {"thread_id": tid}})
    rep = ws.final["report"]
    assert ws.final["kind"] == "layout"
    assert rep["current"]["score"] == 61.0 and rep["best"]["eval_id"] == "e2" and rep["best"]["fixes"][0]["kind"] == "tactile_strip"
    assert len(rep["rounds"]) == 2


# ---------------------------------------------------------------- real engine on the fixture (no model)
@pytest.fixture(scope="module")
def real():
    return da.DrEngine()


def test_dr_engine_visitor_scripted_on_fixture(real):
    ws = da.open_workspace(str(uuid.uuid4()), real)
    out = da.run_scripted(ws, "appointment at the fixture lobby", lambda e: None, building_hint="fixture")
    assert out["kind"] == "rehearsal" and out["route"]["segments"] and out["sim"]["runs"] >= 50
    assert out["route"]["segments"][0]["instruction"]
    assert "stub" in out["sim"]["label"] or out["sim"]["label"] == "simulated"
    assert "cells_b64" not in json.dumps(out)


def test_dr_engine_venue_scripted_on_fixture(real):
    ws = da.open_workspace(str(uuid.uuid4()), real)
    out = da.run_scripted(ws, "where should our reception go", lambda e: None, building_hint="fixture")
    assert out["kind"] == "layout" and out["report"]["current"] and out["report"]["best"]


def test_dr_engine_coach_and_grounding(real):
    ws = da.open_workspace(str(uuid.uuid4()), real)
    r, _ = da.t_plan_route(ws, "fixture", "ent_w", "desk")
    assert r["ok"]
    ws.run_logs["L1"] = {"events": [{"t": 1, "seg": 0, "kind": "hint", "pos": [0, 0]}], "quiz": []}
    p, _ = da.t_set_plan(ws, "L1", r["route_id"], 0, "approach", "Walk 777 steps again.")
    assert p["focus_segment"] == 0 and "777" not in p["line"]
    assert real.grounded("Go 7 steps", {7.0}) and not real.grounded("Go 8 steps", {7.0})


def test_resolve_offline_maps_sid(real):
    r = real.resolve("Medical Office Houston")
    assert r["building_id"] == "x37LjPx62VA"


def test_api_mounts_agent_router_scripted_mode(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from dr.agents import api_stream
    from dr.api import app

    monkeypatch.setattr(api_stream, "TRACE_DIR", tmp_path)
    api_stream.set_test_doubles(agent=None, engine=da.DrEngine())
    try:
        with TestClient(app).stream("POST", "/api/agent", json={
                "text": "where should our reception go", "building_id": "fixture", "mode": "scripted"}) as r:
            ev = [json.loads(l[6:]) for l in "".join(r.iter_text()).splitlines() if l.startswith("data: ")]
    finally:
        api_stream.set_test_doubles(None, None)
    assert ev[0]["type"] == "start" and ev[-1]["type"] == "final"
    assert ev[-1]["result"]["mode"] == "scripted" and ev[-1]["result"]["kind"] == "layout"


def test_named_replays_prefer_clinic_then_fixture_and_404_when_missing(tmp_path, monkeypatch):
    fastapi = pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient
    from dr.agents import api_stream

    monkeypatch.setattr(api_stream, "TRACE_DIR", tmp_path)
    app = fastapi.FastAPI()
    app.include_router(api_stream.router)
    client = TestClient(app)
    line = lambda t: json.dumps({"t": 0.0, "event": {"type": t}}) + "\n"
    (tmp_path / "replay-visitor-fixture.jsonl").write_text(line("start") + line("final"))
    assert client.get("/api/agent/replays").json() == {"visitor": "replay-visitor-fixture.jsonl", "venue": None}
    (tmp_path / "replay-visitor-clinic.jsonl").write_text(line("start") + line("thought") + line("final"))
    assert client.get("/api/agent/replays").json()["visitor"] == "replay-visitor-clinic.jsonl"
    body = client.get("/api/agent/replay?name=visitor&speed=100").text
    assert '"recorded": "replay-visitor-clinic.jsonl"' in body and '"thought"' in body
    assert client.get("/api/agent/replay?name=venue").status_code == 404
    assert client.get("/api/agent/replay?name=../../etc/passwd").status_code == 404
