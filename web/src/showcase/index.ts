// First person Matterport Showcase view (stream 1, web). Localhost only (CLAUDE.md): never from a tunnel.
//
// MOUNT CONTRACT (stream 2 calls this from the #/inside page):
//   const h = await mountShowcase({ host, pkg, world, bus, say, onReady, onFail });
//   host   HTMLElement, position relative, sized by the page. We append a `pointer-events:none` iframe (tabindex -1,
//          aria-hidden) and a HUD canvas. Keyboard focus stays on the page's stage; keys never reach the iframe.
//   pkg    BuildingPackage (model_id picks the tour, routes[0] drives the HUD arrows).
//   world  World (OccGrid; line of sight for the sweep chooser).
//   bus    CueBus (the HUD sound compass reads cues; we publish nothing, captions are the page's).
//   say    optional (text) => void; called once with FALLBACK_LINE if the photo view cannot start.
//   onReady optional () => void, once the SDK is connected, calibrated and the first sweep is shown.
//   (mountShowcase never rejects: on any failure it calls onFail once and resolves an inert handle, ready=false.)
//   onFail  optional (reason: string) => void, within 20 s if the SDK is not ready or we are offline. The page then
//           shows Overview (the GLB scan) and the line "Photo view needs internet; showing the scan.".
//   Optional extras: sdkKey (default import.meta.env.VITE_MATTERPORT_SDK_KEY), panos (default fetched from
//   /buildings/<id>/panos.json), route, safeBottom, safeTop (px kept clear of the page's buttons).
// Returns ShowcaseHandle:
//   setPose(planPos: [x, y], headingDeg: number)  call on every walker move or turn; the picture follows the walker.
//   enterAtEntrance(): Promise<{ pos: Vec2; heading: number }>   outdoor flow: show the entrance sweep facing into the
//          building; the page then places the walker at the returned pos/heading.
//   stop()  tear down iframe, HUD and subscriptions.   calibration: Calibration | null   ready: boolean
// onFail also fires if the connection is lost after a good start (the iframe is removed, setPose becomes a no-op, so
// the walker and audio are untouched); the page shows Overview. If onFail fired the handle is not usable.
import type { CueBus } from "../events";
import type { BuildingPackage, Route, Vec2 } from "../types";
import type { World } from "../world";
import { fitCalibration, headingToYaw, planToSdk, sdkToPlan, type Calibration, type PlanPoint } from "./calibrate";
import { chooseSweep, moveStyle, SweepFollower, type PlanSweep } from "./follow";
import { Hud, type CamPose } from "./hud";
import { FALLBACK_LINE, SDK_TIMEOUT_MS, connectSdk, withTimeout } from "./load";

export { FALLBACK_LINE } from "./load";
export type { Calibration } from "./calibrate";

export interface ShowcaseHandle {
  setPose(planPos: Vec2, headingDeg: number): void;
  enterAtEntrance(): Promise<{ pos: Vec2; heading: number }>;
  stop(): void;
  calibration: Calibration | null;
  ready: boolean;
  /** Diagnostics for the dev page: sweep moves done and the last move's duration in ms. */
  stats: { moves: number; lastMoveMs: number; sweeps: number; queued?: number };
  /** Dev only: every Sweep.moveTo we sent (id, transition, ms, jump metres, plan pos at send time). */
  moveLog?: { id: string; transition: string; ms: number; jumpM: number; t: number }[];
  /** Dev only: the last SDK camera pose. */
  pose(): CamPose | null;
  _sdk?: any;
}

export interface MountOptions {
  host: HTMLElement; pkg: BuildingPackage; world: World; bus: CueBus;
  say?: (text: string) => void; onReady?: () => void; onFail?: (reason: string) => void;
  sdkKey?: string; panos?: PlanPoint[]; route?: Route | null; safeBottom?: number; safeTop?: number;
}

const PITCH_DOWN = -10;
export const EMBED_PARAMS = "play=1&qs=1&help=0&hl=0&title=0";

async function loadPanos(pkg: BuildingPackage): Promise<PlanPoint[]> {
  const r = await fetch(`/buildings/${pkg.id}/panos.json`);
  if (!r.ok) throw new Error("panos.json missing");
  const j = (await r.json()) as { id: string; position: { x: number; y: number } }[];
  return j.map(p => ({ id: p.id, x: p.position.x, y: p.position.y }));
}

/** Stage diagnostics, only with ?dev=1 (same gate as the debug badge). Never logs the SDK key itself. */
const DEV = typeof location !== "undefined" && new URLSearchParams(location.search).get("dev") === "1";
const stage = (...a: unknown[]): void => { if (DEV) console.info("[showcase] stage", ...a); };
let mounts = 0;
const boxOf = (el: HTMLElement): string => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
  return `${Math.round(r.width)}x${Math.round(r.height)} display=${cs.display} visibility=${cs.visibility} hidden=${el.hidden}`; };

export async function mountShowcase(o: MountOptions): Promise<ShowcaseHandle> {
  mounts++;
  stage(`mountShowcase call #${mounts}`);
  if (mounts > 1) console.warn("[showcase] mountShowcase called", mounts, "times in this page");
  let failed = false;
  const notify = (reason: string): void => { // once only; never throws into the walker or the audio
    if (failed) return;
    failed = true;
    console.warn("[showcase] photo view failed:", reason);
    try { o.say?.(FALLBACK_LINE); } catch { /* the page still switches */ }
    try { o.onFail?.(reason); } catch { /* */ }
  };
  const inert: ShowcaseHandle = { calibration: null, ready: false, stats: { moves: 0, lastMoveMs: 0, sweeps: 0 }, pose: () => null,
    setPose: () => undefined, enterAtEntrance: async () => ({ pos: o.pkg.entrances[0]?.pos ?? [0, 0], heading: o.pkg.entrances[0]?.heading_deg ?? 0 }), stop: () => undefined };
  // Never rejects: the page learns through onFail, gets an inert handle, and shows Overview plus the calm note.
  const fail = (reason: string): ShowcaseHandle => { notify(reason); return inert; };
  const key = o.sdkKey ?? (import.meta as any).env?.VITE_MATTERPORT_SDK_KEY;
  if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return fail("Showcase SDK is allowed on localhost only");
  if (typeof navigator !== "undefined" && navigator.onLine === false) return fail("offline");
  stage(`key length ${key ? String(key).length : 0}`);
  if (!key) return fail("no SDK key");
  const sid = o.pkg.model_id;
  if (!sid) return fail("package has no Matterport model");

  const iframe = document.createElement("iframe");
  iframe.src = `https://my.matterport.com/show/?m=${sid}&${EMBED_PARAMS}&applicationKey=${encodeURIComponent(key)}`;
  iframe.tabIndex = -1; iframe.setAttribute("aria-hidden", "true"); iframe.allow = "fullscreen; xr-spatial-tracking";
  Object.assign(iframe.style, { position: "absolute", inset: "0", width: "100%", height: "100%", border: "0", pointerEvents: "none" });
  o.host.prepend(iframe);
  stage(`iframe created: iframe ${boxOf(iframe)}; host ${boxOf(o.host)}`);
  iframe.addEventListener("load", () => stage(`iframe load: iframe ${boxOf(iframe)}; host ${boxOf(o.host)}`), { once: true });
  const note = document.createElement("div"); // calm static text, no spinner
  note.textContent = "Loading photo view…"; note.setAttribute("role", "status");
  Object.assign(note.style, { position: "absolute", left: "0", right: "0", top: "45%", textAlign: "center", color: "#fff", font: "16px system-ui, sans-serif", pointerEvents: "none", textShadow: "0 1px 3px #000" });
  o.host.append(note);

  let sdk: any;
  let hud: Hud | null = null;
  let stopped = false;
  const subs: { cancel(): void }[] = [];
  const onOffline = (): void => { if (!stopped && !failed) { stop(); notify("connection lost"); } };
  const stop = (): void => { stopped = true; window.removeEventListener("offline", onOffline); subs.forEach(s => { try { s.cancel(); } catch { /* */ } }); hud?.destroy(); note.remove(); iframe.remove(); };

  window.addEventListener("offline", onOffline);
  try {
    sdk = await withTimeout((async () => {
      const s = await connectSdk(iframe, key, sid, stage);
      console.info("[showcase] SDK connected, app phase PLAYING");
      stage(`PLAYING reached: iframe ${boxOf(iframe)}`);
      return s;
    })(), SDK_TIMEOUT_MS, "Showcase SDK not connected/PLAYING within 20 s");
    const sweepMap = new Map<string, { position: { x: number; y: number; z: number }; enabled: boolean }>();
    await withTimeout(new Promise<void>(res => {
      subs.push(sdk.Sweep.data.subscribe({
        onCollectionUpdated(col: Record<string, any>) {
          sweepMap.clear();
          for (const k of Object.keys(col)) sweepMap.set(col[k].id ?? k, { position: col[k].position, enabled: col[k].enabled !== false });
          if (sweepMap.size) res();
        },
      }));
    }), SDK_TIMEOUT_MS, "Showcase sweeps not ready within 20 s");

    const panos = o.panos ?? await loadPanos(o.pkg);
    const cal = fitCalibration([...sweepMap].map(([id, s]) => ({ id, x: s.position.x, z: s.position.z })), panos);
    if (!cal || cal.meanErr > 0.1) throw new Error(`calibration failed (${cal ? (cal.meanErr * 100).toFixed(1) + " cm" : "no fit"})`);
    console.info("[showcase] calibration", { ...cal, rotDeg: +cal.rotDeg.toFixed(2), tx: +cal.tx.toFixed(3), ty: +cal.ty.toFixed(3),
      meanErrCm: +(cal.meanErr * 100).toFixed(2), maxErrCm: +(cal.maxErr * 100).toFixed(2) });

    const planSweeps = (): PlanSweep[] => [...sweepMap].map(([id, s]) => ({ id, enabled: s.enabled, plan: sdkToPlan(cal, s.position.x, s.position.z) }));
    const cached = planSweeps();
    let pose: CamPose | null = null;
    subs.push(sdk.Camera.pose.subscribe((p: CamPose) => { pose = p; hud?.setPose(p); }));

    const handle: ShowcaseHandle = {
      calibration: cal, ready: false, stats: { moves: 0, lastMoveMs: 0, sweeps: sweepMap.size },
      pose: () => pose, _sdk: sdk, setPose: () => undefined, enterAtEntrance: async () => ({ pos: [0, 0], heading: 0 }), stop,
    };
    let firstMove = true;
    const moveLog: NonNullable<ShowcaseHandle["moveLog"]> = [];
    handle.moveLog = moveLog;
    // Sweep.Transition in SDK 1.6.2 is Camera.TransitionType: INSTANT, FLY ("smoothly interpolate the camera to the
    // target"), FADEOUT, and experimental MOVEFADE/ORBIT. There is no INTERPOLATE member, so a walking step is a short
    // FLY between adjacent sweeps (what the viewer's own arrow keys do); a long jump or the entrance is a slower FLY.
    const follower = new SweepFollower(o.world, () => cached, async (id, h, info) => {
      if (firstMove) { firstMove = false; stage(`first Sweep.moveTo ${id}`); }
      const st = moveStyle(info.jumpM, info.first), transition = sdk.Sweep.Transition.FLY;
      moveLog.push({ id, transition: `${transition}${st.long ? " long" : " step"}`, ms: st.ms, jumpM: +info.jumpM.toFixed(2), t: Math.round(performance.now()) });
      stage(`Sweep.moveTo ${id} ${st.long ? "long" : "step"} ${transition} ${st.ms} ms jump ${info.jumpM.toFixed(2)} m`);
      await withTimeout(sdk.Sweep.moveTo(id, { rotation: { x: PITCH_DOWN, y: headingToYaw(cal, h) }, transition, transitionTime: st.ms }), 4000, "move stalled").catch(e => { if ((e as Error).message === "move stalled") onOffline(); throw e; });
      // turns made during the flight: settle on the walker's current heading
      void Promise.resolve(sdk.Camera.setRotation({ x: PITCH_DOWN, y: headingToYaw(cal, heading) }, { speed: 220 })).catch(() => undefined);
    });
    hud = new Hud({ host: o.host, pkg: o.pkg, world: o.world, bus: o.bus, route: o.route,
      toSdk: p => planToSdk(cal, p), safeBottom: o.safeBottom, safeTop: o.safeTop });
    if (pose) hud.setPose(pose);

    let pos: Vec2 = o.pkg.entrances[0]?.pos ?? [0, 0], heading = o.pkg.entrances[0]?.heading_deg ?? 0;
    let lastRot = 0, lastHeading = NaN;
    const follow = async (): Promise<void> => {
      if (stopped) return;
      await follower.update(pos, heading); // while a move is in flight this queues the newest pose (depth 1)
      handle.stats.moves = follower.moves; handle.stats.lastMoveMs = follower.lastMoveMs; handle.stats.queued = follower.queued;
    };
    handle.setPose = (p, h) => {
      if (stopped) return; // after a fallback the walker keeps going; we just stop drawing
      pos = p; heading = h; hud?.setWalker(p, h);
      void follow();
      const now = performance.now();
      if (!follower.busy && h !== lastHeading && now - lastRot > 90) {
        lastRot = now; lastHeading = h;
        void Promise.resolve(sdk.Camera.setRotation({ x: PITCH_DOWN, y: headingToYaw(cal, h) }, { speed: 220 })).catch(() => undefined);
      }
    };
    handle.enterAtEntrance = async () => {
      const ent = o.pkg.entrances[0];
      if (!ent) throw new Error("no entrance");
      // a few metres inside, along the entrance heading, so the sweep is indoors and looks into the building
      const inside: Vec2 = [ent.pos[0] + Math.sin(ent.heading_deg * Math.PI / 180) * 1.0, ent.pos[1] + Math.cos(ent.heading_deg * Math.PI / 180) * 1.0];
      if (!chooseSweep(o.world, cached, inside, null)) throw new Error("no sweep near the entrance");
      // Phase is already PLAYING here; a short retry only covers a move dropped by a late-settling transition.
      for (let i = 0; i < 5 && follower.current === null; i++) {
        heading = ent.heading_deg;
        await follower.update(inside, ent.heading_deg);
        if (follower.current === null) await new Promise(r => setTimeout(r, 350));
      }
      if (follower.current === null) throw new Error("entrance sweep not shown");
      pos = ent.pos; heading = ent.heading_deg; hud?.setWalker(pos, heading);
      return { pos: ent.pos, heading: ent.heading_deg };
    };

    // first picture: the entrance sweep, facing in
    await withTimeout(handle.enterAtEntrance(), SDK_TIMEOUT_MS, "Showcase first sweep not shown within 20 s");
    if (stopped || failed) throw new Error("lost during start");
    handle.ready = true; note.remove();
    if (DEV) (window as any).__showcase = handle; // dev only: probes spy on handle._sdk
    o.onReady?.();
    return handle;
  } catch (e) {
    stop();
    return fail(e instanceof Error ? e.message : String(e));
  }
}
