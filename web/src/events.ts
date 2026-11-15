// ONE EVENT BUS (CLAUDE.md rule 7). Every sound and every spoken line is published here as a `cue` message
// (review/agent5_interaction.md section 5). Audio, captions, the 3D sound ring and the observer all subscribe;
// none of them has its own logic for where a sound is or what it says.
import { azimuth } from "./audio/space";
import { clockHour } from "./clock";
import type { Vec2 } from "./types";
import { dist } from "./world";

export type CueKind = "sweep_item" | "cone" | "pick" | "pulse" | "waypoint" | "arrive" | "bump" | "where" | "room" |
  "door" | "callout" | "trail" | "guide" | "point"      // agent5 section 5
  | "say" | "sound";                                      // a spoken line, a non speech sound

export type BusName = "voice" | "cue" | "safety" | "ambient" | "footsteps";

export type Cue = {
  v: 1; t: "cue"; ts: number; kind: CueKind;
  at?: Vec2; id?: string; ids?: string[]; label?: string; deg?: number; hit_m?: number;
  /** say: the exact text spoken and shown, and the id of its clip (lines.ts). */
  text?: string; line?: string; pri?: number; seq?: number; prefix?: string;
  /** sound: recipe name and bus. */
  sound?: string; bus?: BusName;
};

export type Listener = { pos: Vec2; heading: number };

export class CueBus {
  /** Where the walker is: the ring and the caption direction read it, the audio listener is set from it. */
  listener: Listener = { pos: [0, 0], heading: 0 };
  private subs = new Set<(c: Cue) => void>();
  now: () => number = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  subscribe(fn: (c: Cue) => void): () => void { this.subs.add(fn); return () => { this.subs.delete(fn); }; }

  publish(c: Omit<Cue, "v" | "t" | "ts"> & { ts?: number }): Cue {
    const cue = { v: 1, t: "cue", ts: c.ts ?? this.now(), ...c } as Cue;
    for (const f of [...this.subs]) { try { f(cue); } catch { /* one subscriber must never stop the others */ } }
    return cue;
  }
}

/** Direction of a point from the walker, the same numbers for the ring, the caption and the panner. */
export type Polar = { az: number; clock: number; distM: number };
export function polar(l: Listener, at: Vec2): Polar {
  const az = azimuth(l.pos, l.heading, at); // (-180, 180], + right
  return { az, clock: clockHour(az), distM: dist(l.pos, at) };
}

/** Caption text with its direction: "Reception desk, 2 o'clock". The arrow is drawn from `az`. */
export function directionWords(p: Polar): string { return `${p.clock} o'clock`; }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** What the caption shows for a spoken line: the text itself, or "Possibly reception desk" with a prefix word. */
export function captionText(text: string, prefix?: string): string {
  return prefix ? `${cap(prefix)} ${lowerFirst(text)}` : text;
}

/** Where the ring draws a sound: true direction from the walker, true distance up to maxM. */
export function ringPoint(l: Listener, at: Vec2, maxM = 8): { az: number; distM: number; at: Vec2 } {
  const p = polar(l, at);
  if (p.distM <= maxM || p.distM === 0) return { az: p.az, distM: p.distM, at: [at[0], at[1]] };
  const k = maxM / p.distM;
  return { az: p.az, distM: maxM, at: [l.pos[0] + (at[0] - l.pos[0]) * k, l.pos[1] + (at[1] - l.pos[1]) * k] };
}

/** Short label the ring draws next to a flash. Only `say` and `sound` cues flash (the others have their own visuals). */
export function ringLabel(c: Cue): string | null {
  if (c.kind !== "say" && c.kind !== "sound") return null;
  const t = c.kind === "say" ? captionText(c.text ?? "", c.prefix) : (c.label ?? c.sound ?? "sound");
  return t.length > 24 ? t.slice(0, 23).trimEnd() + "\u2026" : t;
}
