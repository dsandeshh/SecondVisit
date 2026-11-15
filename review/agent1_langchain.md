# SecondVisit on LangChain Deep Agents: architecture review and skeleton

Agent 1 (LangChain Deep Agents architect). Saturday 14 Nov 2026, about 20:30 ET.
Code: `/home/claude/secondvisit-review/langchain/` (deep_agent.py, api_stream.py, test_deep_agent.py, plan_amendment.md).

## 1. Verified API facts

Checked against the official docs, the GitHub README, PyPI, and the installed source of `deepagents 0.7.38`. Installed in the sandbox with `pip install --break-system-packages deepagents langchain-anthropic`. That pulled in langchain 1.5.0, langchain-core 1.8.0, langgraph 1.2.22, langchain-anthropic 1.7.10 and langsmith.

| Fact | Verified value | Source |
|---|---|---|
| Install | `pip install deepagents` or `uv add deepagents`. Latest is 0.7.38, released 2026-11-13. Needs Python >=3.11,<4. `langchain-anthropic` is already a declared dependency of deepagents 0.7.38 (`pip show`), so `pip install deepagents` alone is enough for Anthropic. | https://pypi.org/project/deepagents/ , https://docs.langchain.com/oss/python/deepagents/quickstart |
| Signature | `create_deep_agent(model=None, tools=None, *, system_prompt=None, middleware=(), subagents=None, skills=None, memory=None, permissions=None, backend=None, interrupt_on=None, response_format=None, state_schema=None, context_schema=None, checkpointer=None, store=None, debug=False, name=None, cache=None)`. The prompt argument is `system_prompt`. `instructions` was the old name and no longer exists. | `inspect.signature` on the installed package; https://reference.langchain.com/python/deepagents/ |
| Model | Either a `"provider:model"` string resolved through `init_chat_model`, for example `"anthropic:claude-sonnet-5"` in the docs, or a `BaseChatModel` instance such as `ChatAnthropic(...)`. `model=None` has been deprecated since 0.5.3. Current Anthropic ids: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` (fastest). | graph.py docstring; https://docs.langchain.com/oss/python/deepagents/overview ; https://platform.claude.com/docs/en/models/overview |
| Built in tools | `ls, read_file, write_file, edit_file, glob, grep, delete`, `execute` (works only with a sandbox backend), and `task` for subagents. **`write_todos` is NOT on by default since 0.7.0.** You must pass `middleware=[TodoListMiddleware()]` from `langchain.agents.middleware`. ChatGPT's suggestion and older tutorials assume it is built in. | CHANGELOG 0.7.0 "create_deep_agent no longer includes TodoListMiddleware by default": https://github.com/langchain-ai/deepagents/blob/main/libs/deepagents/CHANGELOG.md |
| Virtual FS | The default `StateBackend` keeps files in graph state under `files`, checkpointed per thread. **Files are shared both ways with isolated subagents.** Only `messages`, `todos` and a few private keys are excluded (`_EXCLUDED_STATE_KEYS` in middleware/subagents.py). Confirmed by test: a subagent's Command file write shows up in the parent's state. | installed source; test `test_visitor_run_asks_retries_and_grounds_numbers` |
| Subagent dict | Required: `name`, `description`. Optional: `system_prompt`, `tools` (inherits the parent's if omitted), `model` (string or instance), `middleware`, `interrupt_on`, `skills`, `permissions`, `response_format`, `mode` ("isolated" default or "fork", experimental). There is also `CompiledSubAgent {name, description, runnable}` and `AsyncSubAgent`. | https://docs.langchain.com/oss/python/deepagents/subagents ; `SubAgent` TypedDict |
| General purpose subagent | Added automatically. To disable it, register a `HarnessProfile(general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=False))` for the model's provider. The same profile's `excluded_tools` hides `execute/glob/grep`. Verified: the bound tool list became `ask_visitor, delete, edit_file, finalize, ls, read_file, task, write_file, write_todos`, and the task tool listed only our four subagents. | subagents docs; `register_harness_profile` docstring |
| Human in the loop | `interrupt_on={"tool": True or {"allowed_decisions": [...]}}` needs a checkpointer. Resume with `Command(resume={"decisions": [...]})`, where a decision is approve, edit, reject or respond. A tool can also call LangGraph `interrupt(payload)` directly, and `Command(resume=value)` becomes its return value. We use the direct `interrupt()` for the one ambiguous destination question. The interrupted tool body runs again from the top on resume, so it must not have side effects before `interrupt()`. | https://docs.langchain.com/oss/python/deepagents/human-in-the-loop |
| Streaming | `agent.stream/astream(inp, cfg, stream_mode=["updates","custom"], subgraphs=True, version="v2")` yields `{type, ns, data}`. `ns` is empty for the orchestrator and `("tools:<uuid>",)` inside a subagent. `get_stream_writer()` inside a tool emits `custom` events. Interrupts arrive as an `__interrupt__` update. There is also a newer typed API, `agent.stream_events(inp, version="v3")`, with `.messages`, `.tool_calls` and `.subagents` (supported since 0.6.0). I used v2 because I could test it end to end here. | https://docs.langchain.com/oss/python/langchain/streaming ; https://docs.langchain.com/oss/python/deepagents/event-streaming |
| Middleware for demo safety | `ModelCallLimitMiddleware(run_limit, exit_behavior="end")`, `ToolCallLimitMiddleware(tool_name, run_limit)`, `ModelFallbackMiddleware(first_model, *more)`, `ModelRetryMiddleware(max_retries)`. Anthropic prompt caching middleware is added unconditionally by create_deep_agent. | `inspect.signature`; graph.py docstring |
| LangSmith | `LANGSMITH_TRACING=true`, `LANGSMITH_API_KEY`, then `LANGSMITH_PROJECT` (project workspaces) or `LANGSMITH_AGENT_ID` + `LANGSMITH_AGENT_ENVIRONMENT` (agent workspaces). EU accounts also need `LANGSMITH_ENDPOINT`. Public link in the UI: open the trace, then Share in the more menu, then copy the link. Anyone with the link can view it without an account. In the SDK, `Client().share_run(run_id) -> url` still works but is deprecated in favour of `client.runs.share.create(run_id, session_id=, trace_id=)` and will be removed after Jan 31 2027. | https://docs.langchain.com/langsmith/observability-quickstart ; https://docs.langchain.com/langsmith/share-trace ; installed langsmith docstring |

**Not confirmed:** a live Anthropic call (no key in the sandbox) and a live LangSmith share. The sandbox proxy returns 403 for api.smith.langchain.com. Both code paths exist; run them once on a laptop.

**Corrections to ChatGPT's suggestion:** it installs `langchain-openai` and uses `openai:gpt-4.1`. Use Anthropic, from env. It also assumes planning is built in, but `write_todos` needs `TodoListMiddleware`. Its three subagents return free text. In this design they return ids, and the numbers live in code.

## 2. Architecture

```
POST /api/agent (SSE) ──► orchestrator "secondvisit"   model DR_MODEL (Sonnet class)
                          tools: write_todos, ask_visitor (interrupt), finalize, ls/read/write/edit_file, task
        ┌──────────────────┬──────────────┼───────────────┬──────────────────┐
  site_investigator   route_planner     coach          layout_advisor      all subagents: DR_FAST_MODEL (Haiku class)
  resolve_place       plan_route        get_errors     layout_candidates
  inspect_building    simulate_route    set_plan       evaluate_layout (max 6 calls)
                                                       record_round
        └──────── every tool = thin wrapper over DrEngine → dr.resolver / planner / segments / score /
                  instructions / simulate / coach_rules / layout. Results stored in a per thread Workspace.
```

| Subagent | Model decides | Code decides | Files (written by code unless noted) |
|---|---|---|---|
| site_investigator | Which resolver result to trust. Matching the visitor's words ("eye clinic", "reception") to a destination id. Whether the match is AMBIGUOUS. The plain note for this visitor. | Package contents, confidences, the list of missing layers (traced source, no Vexcel arrival, unconfirmed pin, landmarks below 0.6) | `/building_dossier.md` (provenance and uncertainty tables by code; "Agent notes" appended by the model with edit_file) |
| route_planner | Recovery after `no_route`, choosing one of the code offered rungs, at most twice. Which entrance to keep. What to flag when the arrival rate is below 0.7. | Path, segments, steps, clock hours, score, arrival rate, lost hotspots per segment. Retry bounds: clearance 0.35 down to 0.25, specks up to 0.1 m² | `/rehearsal/route_<id>.json` |
| coach | The drill (repeat, approach or slow) from the error kinds. One warm sentence. The reason, in `/coach_notes.md` (model written, words only) | Tallies, the maximum (a lower tally focus is overridden), the RunPlan fields, the template line when the model's line has a stray number | `/rehearsal/rehearsal_plan.json`, `/input/run_log.json` |
| layout_advisor | Which fix (tactile strip or seating edge) to try, between which two landmark ids, aimed at which hotspot. A critique. When to stop. | Candidate ranking, every score and rate, fix polylines, best eval selection, the round limit | `/venue/layout_report.md` |
| orchestrator | The todo plan, the delegation order, asking the one question, carrying on when data is missing, the final two sentences | `finalize` assembles the API result from the Workspace. The message is replaced if it has an ungrounded number | none |

**Where the agent beats a fixed script.** Each of these is covered by a passing offline test.
1. **Ambiguous destination.** Two desks match "the clinic". The site investigator reports AMBIGUOUS, the orchestrator calls `ask_visitor`, the SSE stream emits a `question` and ends, and `/api/agent/resume` continues on the same thread.
2. **No route.** The first `plan_route` fails. Code offers rungs, the planner retries with clearance 0.30, and the route is labelled relaxed, which tells the visitor that a door may be narrow.
3. **Missing data.** The traced map, the missing Vexcel arrival and the "possibly a pillar" landmark all flow into the dossier and into `final.uncertainty`.
4. **Coach adaptation.** An off route event plus a wrong turn answer on segment 1 gives the approach drill (start two segments earlier). A model that picks a lower tally segment is overridden.
5. **Layout loop.** Candidates, then evaluate, then a critique of the hotspots, then a fix (a strip from the door to the pillar), then evaluate again, then record. Code keeps the best, and an invented "97 percent" in a critique is removed.

**Design choices that avoid the "agents passing text" trap.** Subagents exchange ids and files, not prose: route_id, plan_id, eval_id, and the shared virtual filesystem. The final answer is assembled by code. So the LLM layer can be wrong about wording but never about geometry.

## 3. Demo risks and fixes (ranked)

1. **Latency.** A visitor intake run is about 14 model calls (orchestrator 5 or 6, investigator 3 or 4, planner 3 or 4). Expect 20 to 40 s with Sonnet plus Haiku. *Fixes:* Haiku class `DR_FAST_MODEL` for subagents. Prebuilt packages, so tools are fast lookups, and evaluate results come from the package's sim where possible. Stream the trace panel so the wait reads as work (todos tick, delegations, tool results, files appear). The coach never blocks: the web starts the next run with the deterministic plan immediately and swaps in the agent plan only if it lands first. `ModelCallLimitMiddleware(run_limit=14)`, `ChatAnthropic(timeout=25, max_retries=1)`, and the SSE `DR_AGENT_TIMEOUT_S=45` then trigger the scripted fallback.
2. **API failure or rate limit (429/529).** Any exception before `finalize` runs `run_scripted`. It calls the same tool functions in fixed order, emits the same event types, and its final result says `mode: scripted`, which is honest labelling under CLAUDE.md rule 7. Optional: `ModelFallbackMiddleware` from Sonnet to Haiku.
3. **Wi Fi at an 800 person venue.** Every stream is recorded to `traces/<thread>.jsonl`, and `GET /api/agent/replay` replays it with the original timing, labelled `mode: replay`. Record the JRR visitor and venue runs before 04:00. Tether to a phone hotspot for the live run. Fetch the LangSmith public link beforehand and put it on a slide or QR code.
4. **Numbers leaking from the LLM.** `grounded()` checks the coach line against the focus segment only, and checks the finalize message and layout critique against Workspace results. Failures fall back to templates. Tools clamp every parameter the model passes (clearance, runs, n, fix kinds, focus range). The API result never contains model generated numbers.
5. **Looping or nominal subagents, and cost.** `ToolCallLimitMiddleware` on evaluate_layout (6), a round cap of 3 in the prompt, the general purpose subagent disabled, and `execute/glob/grep` excluded (fewer tool tokens, so faster). Prompt caching is automatic for Anthropic. Cost per run is a few cents with a Haiku class model on the subagents. That is negligible, but cap the demo laptop's key with a spend limit.

Also flagged: **plan inconsistency.** The NoRouteError hint says "rerun with `--close-gaps`", but `close_gaps_m` is morphological closing, which seals gaps and cannot reopen a door. The amendment replaces the retry lever (smaller clearance, dropping noise specks) and keeps close gaps for filling glass holes.

## 4. Code written and what ran

| File | What it is |
|---|---|
| `langchain/deep_agent.py` | `Engine` protocol. `DrEngine`, an adapter over the plan's dr.* interfaces, imported lazily and untested because the engine does not exist yet. `Workspace` and `grounded()`. Tool implementations `t_*` shared by the agent and the fallback. LangChain `@tool` wrappers that return `Command(update={"files": ..., "messages": [...]})` and emit stream events. The four subagent specs, `build_agent()`, `model_from_env()` (adds `anthropic:` to a bare `DR_MODEL`) and `run_scripted()`. |
| `langchain/api_stream.py` | FastAPI router with `POST /api/agent` (SSE), `POST /api/agent/resume`, `GET /api/agent/replay` and `GET /api/agent/share` (LangSmith link). `TraceMapper` turns v2 stream parts into trace panel events, including subagent attribution and file events without duplicates. |
| `langchain/test_deep_agent.py` | 13 offline tests. Scripted `GenericFakeChatModel` subclasses (with `bind_tools` returning self) drive the real deepagents machinery: todos, the task tool, the virtual FS, interrupt and resume, Command file updates, and SSE through FastAPI TestClient. |
| `langchain/plan_amendment.md` | Replacement text for item 8, Tasks 10 (engine), 12 (agent loop) and 13. Also new constraints, the Review Focus fix, and the Claude Code prompt for person D. |

**Ran:** `pytest -q test_deep_agent.py` gives **13 passed in about 2 s**, offline, on Python 3.13, deepagents 0.7.38. Also confirmed with a `ChatAnthropic` instance and a dummy key: construction works, the tools are excluded, and the general purpose subagent is disabled.
**Not run:** a live model call, a live LangSmith share, and `DrEngine` against real `dr.*` modules.

## 5. What to show LangChain judges (60 s)

Type "appointment at the eye clinic in JRR". The trace panel shows the todo list, then delegate to site_investigator, then resolve, inspect and `building_dossier.md`, then the question "two desks match, which one?". Answer it. Then route_planner: plan_route no_route, retry relaxed, simulate 0.64, then final. After the blindfold run and the failed quiz, the coach switches to the approach drill and the plan file changes. Open the LangSmith public link to show the nested subagent runs.
