/**
 * Observer bus (one way: rehearsal -> observer).
 *
 * Rehearsal side (stream C, Task 9) usage, safe to call everywhere (no-op when the URL has no ?obs=):
 *   import { obs } from "../observer/bus";
 *   obs.publish({ v: 1, t: "say", ts: performance.now(), text, pri });   // at say, tap, step/turn, RunLog
 *   // events, quiz answer, point result, coach plan, run end. `hello` is re-sent every 2 s automatically.
 * `obs` is built from the page URL: `?obs=<session>` turns publishing on, `&relay=1` adds the WebSocket
 * relay (/ws/obs/<session>). Pose is throttled to 15 Hz inside publish. Nothing here ever throws.
 */
import { validMsg, type ObsMsg } from "./protocol";

export interface Bus {
  publish(m: ObsMsg): void;
  subscribe(fn: (m: ObsMsg) => void): () => void;
  close(): void;
}

const POSE_MIN_MS = 1000 / 15;
const WS_BACKLOG = 65536;

export function openBus(session: string, opts: { relay?: boolean } = {}): Bus {
  const subs = new Set<(m: ObsMsg) => void>();
  const emit = (m: ObsMsg) => validMsg(m) && subs.forEach((f) => { try { f(m); } catch { /* subscriber bug must not kill the bus */ } });

  let bc: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      bc = new BroadcastChannel("sv-obs-" + session);
      bc.onmessage = (e) => emit(e.data as ObsMsg);
    }
  } catch { bc = null; }

  let ws: WebSocket | null = null, closed = false, backoff = 1000, retry: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
    try {
      if (typeof WebSocket === "undefined" || typeof location === "undefined") return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const s = new WebSocket(`${proto}//${location.host}/ws/obs/${encodeURIComponent(session)}`);
      ws = s;
      s.onopen = () => { backoff = 1000; };
      s.onmessage = (e) => { try { emit(JSON.parse(String(e.data)) as ObsMsg); } catch { /* ignore junk */ } };
      s.onclose = () => {
        ws = null;
        if (closed) return;
        retry = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 4000);
      };
      s.onerror = () => { try { s.close(); } catch { /* */ } };
    } catch { ws = null; }
  };
  if (opts.relay) connect();

  let lastPose = -Infinity, lastHello: ObsMsg | null = null, helloTimer: ReturnType<typeof setInterval> | undefined;
  const send = (m: ObsMsg) => {
    try { bc?.postMessage(m); } catch { /* */ }
    try {
      if (ws && ws.readyState === 1 && !(m.t === "pose" && ws.bufferedAmount > WS_BACKLOG)) ws.send(JSON.stringify(m));
    } catch { /* */ }
  };

  return {
    publish(m) {
      if (closed) return;
      if (m.t === "pose") {
        const now = Date.now();
        if (now - lastPose < POSE_MIN_MS) return;
        lastPose = now;
      }
      if (m.t === "hello") {
        lastHello = m;
        helloTimer ??= setInterval(() => lastHello && send(lastHello), 2000);
      }
      send(m);
    },
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    close() {
      closed = true;
      clearInterval(helloTimer); clearTimeout(retry);
      try { bc?.close(); } catch { /* */ }
      try { ws?.close(); } catch { /* */ }
      subs.clear();
    },
  };
}

/** Page-level bus from the URL; a no-op bus when `?obs=` is absent. */
export function busFromUrl(search: string = typeof location === "undefined" ? "" : location.search): Bus {
  const q = new URLSearchParams(search), session = q.get("obs");
  if (!session) return { publish() {}, subscribe: () => () => {}, close() {} };
  return openBus(session, { relay: q.get("relay") === "1" });
}

export const obs: Bus = busFromUrl();
