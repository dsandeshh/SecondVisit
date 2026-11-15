"""SSE endpoints for the in app agent trace panel.

Place at engine/dr/agents/api_stream.py and mount in engine/dr/api.py:
    from dr.agents.api_stream import router as agent_router
    app.include_router(agent_router)

POST /api/agent         {text, building_id?, route_id?, run_log?, mode?: "agent"|"scripted"}
POST /api/agent/resume  {thread_id, answer}
GET  /api/agent/replay?name=<file>   replays a recorded trace (labelled as a replay)

Every response is text/event-stream. Each event is one JSON object on a `data:` line:
  start      {thread_id, mode}
  todos      {todos:[{content,status}]}
  delegate   {to, task}
  tool_call  {agent, tool, args}
  tool_result{agent, tool, ok, summary, files}
  file       {agent, path}
  thought    {agent, text}
  question   {thread_id, question, options:[{id,label}]}     (stream ends; client calls /resume)
  fallback   {reason}
  final      {result}                                         (numbers come from the Workspace)
  error      {message}
Events are also appended to $DR_TRACE_DIR/<thread_id>.jsonl so a good run can be replayed
when the venue Wi Fi dies.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.types import Command
from pydantic import BaseModel

from dr.agents import deep_agent as da

router = APIRouter()
TRACE_DIR = Path(os.environ.get("DR_TRACE_DIR") or Path(__file__).resolve().parents[3] / "traces")
AGENT_TIMEOUT_S = float(os.environ.get("DR_AGENT_TIMEOUT_S", "45"))
_AGENT = None
_ENGINE = None


def get_agent():
    global _AGENT
    if _AGENT is None:
        _AGENT = da.build_agent()
    return _AGENT


def get_engine():
    global _ENGINE
    if _ENGINE is None:
        _ENGINE = da.DrEngine()
    return _ENGINE


def set_test_doubles(agent=None, engine=None) -> None:
    global _AGENT, _ENGINE
    _AGENT, _ENGINE = agent, engine


class AgentRequest(BaseModel):
    text: str
    building_id: str | None = None
    route_id: str | None = None
    run_log: dict | None = None
    mode: str = "agent"
    thread_id: str | None = None


class ResumeRequest(BaseModel):
    thread_id: str
    answer: str


def sse(event: dict) -> str:
    return f"data: {json.dumps(event, default=str)}\n\n"


class TraceMapper:
    """Turns LangGraph v2 stream parts into trace panel events."""

    def __init__(self) -> None:
        self.pending: list[str] = []      # subagent names from task calls, in order
        self.ns_name: dict[str, str] = {}
        self.seen_files: set[tuple] = set()   # a subagent's files also arrive in the parent update

    def agent_for(self, ns: tuple) -> str:
        if not ns:
            return "orchestrator"
        key = ns[0]
        if key not in self.ns_name:
            self.ns_name[key] = self.pending.pop(0) if self.pending else "subagent"
        return self.ns_name[key]

    def map(self, part: dict) -> list[dict]:
        kind, ns, data = part["type"], tuple(part.get("ns") or ()), part["data"]
        if kind == "custom":
            return [data] if isinstance(data, dict) else []
        out: list[dict] = []
        if kind != "updates" or not isinstance(data, dict):
            return out
        who = self.agent_for(ns)
        for node, upd in data.items():
            if node == "__interrupt__":
                val = upd[0].value if upd else {}
                out.append({"type": "question", **(val if isinstance(val, dict) else {"question": str(val)})})
                continue
            if not isinstance(upd, dict):
                continue
            if upd.get("todos") and not ns:
                out.append({"type": "todos", "todos": upd["todos"]})
            for m in upd.get("messages", []) or []:
                if isinstance(m, AIMessage):
                    text = m.text if isinstance(getattr(m, "text", None), str) else str(m.content)
                    if text and text.strip():
                        out.append({"type": "thought", "agent": who, "text": text.strip()[:400]})
                    for c in m.tool_calls:
                        if c["name"] == "task":
                            to = c["args"].get("subagent_type", "subagent")
                            self.pending.append(to)
                            out.append({"type": "delegate", "to": to, "task": str(c["args"].get("description", ""))[:300]})
                        elif c["name"] != "write_todos":
                            out.append({"type": "tool_call", "agent": who, "tool": c["name"], "args": _short(c["args"])})
                elif isinstance(m, ToolMessage) and m.name in ("write_file", "edit_file"):
                    pass  # reported via files below
            for path, fd in (upd.get("files") or {}).items():
                key = (path, (fd or {}).get("modified_at"))
                if fd is not None and key not in self.seen_files:
                    self.seen_files.add(key)
                    out.append({"type": "file", "agent": who, "path": path})
        return out


def _short(args: dict) -> dict:
    return {k: (v if len(json.dumps(v, default=str)) < 120 else str(v)[:117] + "...") for k, v in args.items()}


async def _record(thread_id: str, events: AsyncIterator[dict]) -> AsyncIterator[str]:
    TRACE_DIR.mkdir(parents=True, exist_ok=True)
    t0 = time.monotonic()
    with open(TRACE_DIR / f"{thread_id}.jsonl", "a") as f:
        async for ev in events:
            f.write(json.dumps({"t": round(time.monotonic() - t0, 3), "event": ev}, default=str) + "\n")
            f.flush()
            yield sse(ev)


async def _agent_events(thread_id: str, inp: Any, req: AgentRequest | None) -> AsyncIterator[dict]:
    """Stream the deep agent; on any failure or timeout, run the scripted pipeline instead."""
    ws = da.get_workspace(thread_id)
    run_id = uuid.uuid4()  # becomes the LangSmith root run id, so /api/agent/share can find it
    ws.request.setdefault("ls_run_ids", []).append(str(run_id))
    cfg = {"configurable": {"thread_id": thread_id}, "recursion_limit": 120, "run_id": run_id,
           "run_name": "secondvisit", "metadata": {"app": "secondvisit", "thread_id": thread_id},
           "tags": ["secondvisit"]}
    mapper = TraceMapper()
    asked = False
    try:
        agent = get_agent()
        async with asyncio.timeout(AGENT_TIMEOUT_S):
            async for part in agent.astream(inp, cfg, stream_mode=["updates", "custom"],
                                            subgraphs=True, version="v2"):
                for ev in mapper.map(part):
                    if ev["type"] == "question":
                        asked = True
                        ev["thread_id"] = thread_id
                    yield ev
    except Exception as exc:  # API down, rate limited, timeout, bad tool call loop
        if ws.final is None and not asked and req is not None:
            yield {"type": "fallback", "reason": f"{type(exc).__name__}: {str(exc)[:160]}"}
            async for ev in _scripted_events(ws, req):
                yield ev
            return
        yield {"type": "error", "message": str(exc)[:200]}
        return
    if asked:
        return
    if ws.final is None:  # the model ended without finalize: build the answer from what exists
        last_route = next(reversed(ws.routes), None)
        last_plan = next(reversed(ws.plans), None)
        kind = "layout" if ws.rounds else ("rehearsal" if last_route else "unavailable")
        bid = next(iter(ws.buildings), None)
        ws.final = da.assemble_result(ws, kind, bid, last_route, last_plan, "")
    yield {"type": "final", "result": {**ws.final, "mode": "agent"}}


async def _scripted_events(ws, req: AgentRequest) -> AsyncIterator[dict]:
    q: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    lid = next(reversed(ws.run_logs), None)

    def work():
        try:
            da.run_scripted(ws, req.text, lambda e: loop.call_soon_threadsafe(q.put_nowait, e),
                            building_hint=req.building_id, run_log_id=lid, route_id=req.route_id)
        finally:
            loop.call_soon_threadsafe(q.put_nowait, None)

    fut = loop.run_in_executor(None, work)
    while (ev := await q.get()) is not None:
        yield ev
    await fut
    yield {"type": "final", "result": {**ws.final, "mode": "scripted"}}


@router.post("/api/agent")
async def run_agent(req: AgentRequest):
    thread_id = req.thread_id or str(uuid.uuid4())
    ws = da.open_workspace(thread_id, get_engine(), req.model_dump())
    route_id = None
    if req.route_id and req.building_id:
        # The web app already holds the precomputed route; register it so the coach can use it.
        pkg = ws.engine.package(req.building_id)
        ws.buildings[req.building_id] = pkg
        for r in pkg.get("routes", []):
            if r["id"] == req.route_id:
                route_id = ws.new_id("r")
                ws.routes[route_id] = {**r, "building_id": req.building_id}
    inp = da.initial_input(ws, req.text + (f"\nbuilding_id: {req.building_id}" if req.building_id else ""),
                           req.run_log, route_id)

    async def gen() -> AsyncIterator[dict]:
        yield {"type": "start", "thread_id": thread_id, "mode": req.mode}
        if req.mode == "scripted":
            async for ev in _scripted_events(ws, req):
                yield ev
        else:
            async for ev in _agent_events(thread_id, inp, req):
                yield ev

    return StreamingResponse(_record(thread_id, gen()), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/api/agent/resume")
async def resume_agent(req: ResumeRequest):
    async def gen() -> AsyncIterator[dict]:
        yield {"type": "start", "thread_id": req.thread_id, "mode": "agent", "resumed": True}
        async for ev in _agent_events(req.thread_id, Command(resume=req.answer), None):
            yield ev

    return StreamingResponse(_record(req.thread_id, gen()), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# Named replays for the demo: "visitor" and "venue". The clinic recording (sponsor derived, local only) is
# preferred; the committed fixture recording is the fallback, so a clean checkout still replays.
REPLAY_NAMES = {"visitor": ("replay-visitor-clinic.jsonl", "replay-visitor-fixture.jsonl"),
                "venue": ("replay-venue-clinic.jsonl", "replay-venue-fixture.jsonl")}


def resolve_replay(name: str) -> Path | None:
    cands = REPLAY_NAMES.get(name) or (Path(name).name,)
    return next((TRACE_DIR / c for c in cands if (TRACE_DIR / c).is_file()), None)


@router.get("/api/agent/replays")
async def replays():
    """Which named replays can play right now, and from which file."""
    return {k: (p.name if (p := resolve_replay(k)) else None) for k in REPLAY_NAMES}


@router.get("/api/agent/replay")
async def replay(name: str, speed: float = 1.0):
    """Replay a recorded run with its original timing. `name` is `visitor`, `venue` or a file in the trace
    folder. The start event says it is a replay; no model or sponsor call is made."""
    path = resolve_replay(name)
    if path is None:
        raise HTTPException(status_code=404, detail=f"no recorded trace named {name!r}")

    async def gen() -> AsyncIterator[str]:
        yield sse({"type": "start", "mode": "replay", "recorded": path.name})
        last = 0.0
        for line in path.read_text().splitlines():
            rec = json.loads(line)
            await asyncio.sleep(max(0.0, (rec["t"] - last) / max(speed, 0.1)))
            last = rec["t"]
            if rec["event"].get("type") != "start":
                yield sse(rec["event"])

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.get("/api/agent/share")
async def share(thread_id: str):
    """Public LangSmith link for the latest run of a thread (needs LANGSMITH_TRACING=true and
    LANGSMITH_API_KEY). Client.share_run is deprecated in favour of client.runs.share.create but
    still works until Jan 31 2027; the UI path is: open trace, Share, copy public link."""
    try:
        from langsmith import Client
        run_id = da.get_workspace(thread_id).request["ls_run_ids"][-1]
        url = await asyncio.to_thread(Client().share_run, run_id)
        return {"url": url}
    except Exception as exc:
        return {"url": None, "error": f"{type(exc).__name__}: {str(exc)[:160]}"}
