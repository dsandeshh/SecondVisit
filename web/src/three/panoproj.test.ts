// Photo projection math (?view=proj): plan direction -> the pano's GL cube lookup, nearest pano choice, flag.
import { describe, expect, it } from "vitest";
import { applyMat3, glFace, nearestPanos, panoToGL, projOpts, projWanted, quatMat3, type ProjPano } from "./panoproj";

const pano = (id: string, pos: [number, number, number], yawDeg = 0, quat?: [number, number, number, number]): ProjPano => {
  const h = yawDeg * Math.PI / 360;
  return { id, pos, yaw_deg: yawDeg, quat: quat ?? [0, 0, Math.sin(h), Math.cos(h)], dir: `pano/${id}/`, real_faces: ["px", "nx", "pz", "nz"] };
};
const dirOf = (bearingDeg: number, elevDeg = 0): [number, number, number] => {
  const b = bearingDeg * Math.PI / 180, e = elevDeg * Math.PI / 180;
  return [Math.sin(b) * Math.cos(e), Math.cos(b) * Math.cos(e), Math.sin(e)];
};
// engine/dr/annotate.py face_bearing, clockwise: plan bearing of pixel column x in horizon face 1..4
const faceBearing = (face: number, x: number, w: number, yaw0: number) => (yaw0 + 90 * (face - 1) + Math.atan((x - w / 2) / (w / 2)) * 180 / Math.PI + 360) % 360;
const CUBE_OF_FACE: Record<number, string> = { 1: "px", 2: "nz", 3: "nx", 4: "pz" };

describe("glFace (OpenGL cube map face selection, spec table 3.21)", () => {
  it("picks the major axis and its s, t", () => {
    expect(glFace([1, 0, 0])).toEqual({ face: "px", s: 0.5, t: 0.5 });
    expect(glFace([0, 0, -1])).toEqual({ face: "nz", s: 0.5, t: 0.5 });
    const f = glFace([1, 0.5, -0.5]);   // +X: sc = -rz, tc = -ry
    expect(f.face).toBe("px"); expect(f.s).toBeCloseTo(0.75); expect(f.t).toBeCloseTo(0.25);
  });
});

describe("panoToGL: plan direction from the pano -> its cube map lookup", () => {
  it("with yaw 0 and the clinic's calibrated yaw0 90, face 1 (px) looks along plan +x (bearing 90)", () => {
    const G = panoToGL(pano("a", [0, 0, 1.3]), 90, "yaw");
    const c = glFace(applyMat3(G, dirOf(90)));
    expect(c.face).toBe("px"); expect(c.s).toBeCloseTo(0.5, 9); expect(c.t).toBeCloseTo(0.5, 9);
    expect(glFace(applyMat3(G, dirOf(180))).face).toBe("nz");   // face 2, clockwise
    expect(glFace(applyMat3(G, dirOf(270))).face).toBe("nx");
    expect(glFace(applyMat3(G, dirOf(0))).face).toBe("pz");
  });
  it("clockwise of a face centre is right in the image (s grows), above the horizon is up (t shrinks)", () => {
    const G = panoToGL(pano("a", [0, 0, 1.3]), 90, "yaw");
    const r = glFace(applyMat3(G, dirOf(100))), u = glFace(applyMat3(G, dirOf(90, 10)));
    expect(r.face).toBe("px"); expect(r.s).toBeGreaterThan(0.5); expect(r.t).toBeCloseTo(0.5);
    expect(u.face).toBe("px"); expect(u.t).toBeLessThan(0.5); expect(u.s).toBeCloseTo(0.5);
  });
  it("straight up and down land on py / ny (the placeholders)", () => {
    const G = panoToGL(pano("a", [0, 0, 1.3], 37), 90, "yaw");
    expect(glFace(applyMat3(G, [0, 0, 1])).face).toBe("py");
    expect(glFace(applyMat3(G, [0, 0, -1])).face).toBe("ny");
  });
  it("agrees with the engine's face_bearing for every face, pixel column and pano yaw (the landmark calibration)", () => {
    for (const yaw of [0, 33.3, -120, 171]) for (const yaw0 of [90, 12]) {
      const G = panoToGL(pano("a", [0, 0, 1.3], yaw), yaw0, "yaw");
      for (const face of [1, 2, 3, 4]) for (const x of [10, 512, 900]) {
        const f = glFace(applyMat3(G, dirOf(faceBearing(face, x, 1024, yaw0 - yaw))));
        expect(f.face).toBe(CUBE_OF_FACE[face]);
        expect(f.s * 1024).toBeCloseTo(x, 3);
        expect(f.t).toBeCloseTo(0.5, 6);
      }
    }
  });
  it("'quat' mode equals 'yaw' mode for a pure yaw quaternion, and applies a tilt when there is one", () => {
    const p = pano("a", [0, 0, 1.3], 40);
    const a = panoToGL(p, 90, "yaw"), b = panoToGL(p, 90, "quat");
    a.forEach((v, i) => expect(b[i]).toBeCloseTo(v, 9));
    const s = Math.sin(0.05 / 2), tilted = { ...p, quat: [s, 0, 0, Math.cos(0.05 / 2)] as [number, number, number, number] };
    const c = panoToGL(tilted, 90, "quat");
    expect(Math.max(...c.map((v, i) => Math.abs(v - panoToGL({ ...tilted, yaw_deg: 0 }, 90, "yaw")[i])))).toBeGreaterThan(0.01);
  });
  it("quatMat3 rotates +x by a 90 degree yaw onto +y", () => {
    const h = Math.PI / 4, v = applyMat3(quatMat3([0, 0, Math.sin(h), Math.cos(h)]), [1, 0, 0]);
    expect(v[0]).toBeCloseTo(0); expect(v[1]).toBeCloseTo(1); expect(v[2]).toBeCloseTo(0);
  });
});

describe("nearestPanos", () => {
  const ps = [pano("a", [0, 0, 1.3]), pano("b", [5, 0, 1.3]), pano("c", [1, 1, 1.3]), pano("d", [-9, 0, 1.3])];
  it("returns the k nearest by plan distance, nearest first", () => {
    expect(nearestPanos([0.9, 0.8], ps, 2).map(p => p.id)).toEqual(["c", "a"]);
    expect(nearestPanos([4, 0], ps, 10).map(p => p.id)).toEqual(["b", "c", "a", "d"]);
  });
});

describe("projWanted: ?view=proj, default off", () => {
  it("is on only for view=proj", () => {
    expect(projWanted("?view=proj")).toBe(true);
    expect(projWanted("?b=x&view=proj&dev=1")).toBe(true);
    expect(projWanted("")).toBe(false);
    expect(projWanted("?view=eye")).toBe(false);
  });
});

describe("projOpts", () => {
  it("defaults to the full quaternion and no debug tint", () => {
    expect(projOpts("?view=proj")).toEqual({ rot: "quat", debug: false });
    expect(projOpts("?view=proj&projrot=yaw&projdebug=1")).toEqual({ rot: "yaw", debug: true });
  });
});
