// GLSL for the photo projection (?view=proj). Injected into the scan's own MeshStandardMaterial with onBeforeCompile,
// so lighting, the emissive lift and the 2 m clipping plane stay exactly as in the baked view; only the texel changes.
// The maths mirrors panoproj.ts (tested there): panoToGL (svG), projConf / projBlend (stages c and d).
import * as THREE from "three";
import { PROJ } from "./panoproj";

/** Panos bound at once: one colour samplerCube and one distance samplerCube each (12 units), plus the baked map,
 *  plus the sun's shadow map = 14 of WebGL's guaranteed 16. */
export const PROJ_SLOTS = 6;
/** b: nearest pano only, no occlusion. c: the best pano with line of sight and facing the surface. d: blend up to 3. */
export type ProjStage = "b" | "c" | "d";
/** Distances in the depth cubes are stored as metres / DEPTH_SCALE (half float), cleared to 1 (= nothing for 100 m). */
export const DEPTH_SCALE = 100;
/** Distance cube face size: 512 px per 90 degrees, about 0.18 degrees per texel (half float RGBA, 12.6 MB a pano). */
export const DEPTH_PX = 512;
/** Silhouette guard radius: 4 depth texels (radians, as a tangent offset of a unit direction). */
export const EDGE_RAD = 4 * (Math.PI / 2) / DEPTH_PX;

export type ProjUniforms = {
  svPos: { value: THREE.Vector3[] };
  svG: { value: THREE.Matrix3[] };
  svOn: { value: number[] };
  [cube: `svCube${number}` | `svDepth${number}`]: { value: THREE.Texture | null };
};

export function projUniforms(k = PROJ_SLOTS): ProjUniforms {
  const u = {
    svPos: { value: Array.from({ length: k }, () => new THREE.Vector3()) },
    svG: { value: Array.from({ length: k }, () => new THREE.Matrix3()) },
    svOn: { value: new Array(k).fill(0) },
  } as ProjUniforms;
  for (let i = 0; i < k; i++) { u[`svCube${i}`] = { value: null }; u[`svDepth${i}`] = { value: null }; }
  return u;
}

const f = (x: number) => x.toFixed(4);

/** Fragment helpers. Cube samplers can only be indexed by constants, so per slot code is unrolled here in JS. */
export function fragHead(k: number, stage: ProjStage): string {
  const decl = Array.from({ length: k }, (_, i) => `uniform samplerCube svCube${i};\nuniform samplerCube svDepth${i};`).join("\n");
  const pick = Array.from({ length: k }, (_, i) => `  if (i == ${i}) return textureGrad(svCube${i}, g, gx, gy);`).join("\n");
  // stage b: nearest bound pano, no line of sight test
  const nearest = `
  int best = -1; float bd = 1e9;
  for (int i = 0; i < SV_K; i++) { float d = distance(P, svPos[i]); if (svOn[i] > 0.5 && d < bd) { bd = d; best = i; } }
  int b = max(best, 0);
  vec3 g = svG[b] * (P - svPos[b]);
  vec3 gx = dFdx(g), gy = dFdy(g);                 // before any branch: derivatives need uniform control flow
  if (best < 0 || !svHorizon(g)) return baked;
  alpha = 1.0;
  return svSample(best, g, gx, gy);`;
  // stages c, d: every slot scored (conf = line of sight x facing x range, w = conf / (d^2 + 0.25)), top CAP blended
  const slot = (i: number) => `
  {
    vec3 pp = svPos[${i}];
    vec3 g = svG[${i}] * (P - pp);
    vec3 gx = dFdx(g), gy = dFdy(g);
    vec3 toP = pp - P; float d = length(toP);
    float facing = dot(N, toP / max(d, 1e-4));
    // the pano's distance cube is in three coordinates: plan (x, y, z) -> three (x, z, -y)
    vec3 fromPanoW = vec3(-toP.x, -toP.z, toP.y);
    float stored = textureLod(svDepth${i}, fromPanoW, 0.0).r * ${f(DEPTH_SCALE)};
    // silhouette guard: near a depth jump (an edge as the pano saw it) the mesh and the photo disagree by a few
    // centimetres, so the photo there often shows what is behind the edge (dark streaks). Trust neither side of it.
    vec3 dn = normalize(fromPanoW), t1 = normalize(cross(dn, abs(dn.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), t2 = cross(dn, t1);
    float e0 = textureLod(svDepth${i}, dn + SV_EDGE * t1, 0.0).r, e1 = textureLod(svDepth${i}, dn - SV_EDGE * t1, 0.0).r;
    float e2 = textureLod(svDepth${i}, dn + SV_EDGE * t2, 0.0).r, e3 = textureLod(svDepth${i}, dn - SV_EDGE * t2, 0.0).r;
    float jump = (max(max(e0, e1), max(e2, e3)) - min(min(e0, e1), min(e2, e3))) * ${f(DEPTH_SCALE)};
    bool seen = svOn[${i}] > 0.5 && svHorizon(g) && d <= stored + 0.06 + 0.03 * d && jump < 0.25 + 0.08 * d;
    col[${i}] = textureGrad(svCube${i}, g, gx, gy);
    // photo consistency: blurred photo vs blurred baked colour (low frequencies the baked texture gets right)
    float lumDiff = abs(svLuma(textureLod(svCube${i}, g, SV_BLUR_CUBE).rgb) - bakedBlurL);
    float conf = seen ? smoothstep(${f(PROJ.FACING_LO)}, ${f(PROJ.FACING_HI)}, facing) * (1.0 - smoothstep(${f(PROJ.FADE_M)}, ${f(PROJ.MAX_M)}, d))
      * (1.0 - smoothstep(${f(PROJ.AGREE_LO)}, ${f(PROJ.AGREE_HI)}, lumDiff)) : 0.0;
    cf[${i}] = conf; w[${i}] = conf / (d * d + 0.25);
  }`;
  const blend = `
  // surface normal from screen derivatives (the GLB has no normals), turned toward the viewer
  vec3 Pw = vSvW;
  vec3 Nw = normalize(cross(dFdx(Pw), dFdy(Pw)));
  if (dot(Nw, cameraPosition - Pw) < 0.0) Nw = -Nw;
  vec3 N = vec3(Nw.x, -Nw.z, Nw.y);
  float w[SV_K]; float cf[SV_K]; vec4 col[SV_K];
  float bakedBlurL = svLuma(bakedBlur.rgb);
${Array.from({ length: k }, (_, i) => slot(i)).join("\n")}
  // keep the SV_CAP strongest: slot i stays when fewer than SV_CAP slots beat it (ties broken by index)
  vec4 acc = vec4(0.0); float ws = 0.0; float best = 0.0;
  for (int i = 0; i < SV_K; i++) {
    int above = 0;
    for (int j = 0; j < SV_K; j++) if (w[j] > w[i] || (w[j] == w[i] && j < i)) above++;
    if (above < SV_CAP && w[i] > 0.0) { acc += w[i] * col[i]; ws += w[i]; best = max(best, cf[i]); }
  }
  if (ws <= 0.0) return baked;                     // nobody can see this point: the baked texel, never black
  alpha = best;
  return mix(baked, acc / ws, best);`;
  return `
#define SV_K ${k}
#define SV_CAP ${stage === "d" ? PROJ.CAP : 1}
#define SV_EDGE ${f(EDGE_RAD)}
// blur levels for the consistency check: cube mip 4 of 1024 px faces = 64 px per 90 degrees (~1.4 degrees a texel);
// baked mip 3 of the 2048 px atlas tiles = 8 x 8 texels (atlas charts are large enough not to bleed much)
#define SV_BLUR_CUBE 4.0
#define SV_BLUR_MAP 3.0
${decl}
uniform vec3 svPos[SV_K];
uniform mat3 svG[SV_K];
uniform float svOn[SV_K];
varying vec3 vSvW;
vec4 svSample(int i, vec3 g, vec3 gx, vec3 gy) {
${pick}
  return vec4(0.0);
}
// Only the four horizon faces are real photos (py / ny are grey placeholders). The GL y axis is the pano's up,
// so a lookup is usable when it is not mostly vertical; the 0.99 keeps linear filtering off the placeholder edge.
bool svHorizon(vec3 g) { return abs(g.y) < 0.99 * max(abs(g.x), abs(g.z)); }
// perceptual-ish luma of a linear colour (sqrt ~ sRGB), so the consistency threshold means the same in dark and light
float svLuma(vec3 c) { return sqrt(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0)); }
// The photo texel for this fragment, or the baked one wherever no bound pano gives a trustworthy texel.
// alpha: how much photo is in the result (0 = baked only), for the debug tint.
vec4 svProject(vec4 baked, vec4 bakedBlur, out float alpha) {
  vec3 P = vec3(vSvW.x, -vSvW.z, vSvW.y);          // three (x, y up, -z) -> plan (x, y, z up)
  alpha = 0.0;
${stage === "b" ? nearest : blend}
}
`;
}

/** Patch one scan material (it must have a map). Uniform objects are shared, so every material sees the same slots. */
export function patchMaterial(mat: THREE.MeshStandardMaterial, u: ProjUniforms, opts: { debug?: boolean; k?: number; stage?: ProjStage } = {}): void {
  const k = opts.k ?? PROJ_SLOTS, stage = opts.stage ?? "d";
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = "varying vec3 vSvW;\n" + shader.vertexShader.replace("#include <project_vertex>",
      "#include <project_vertex>\n  vSvW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + fragHead(k, stage))
      .replace("#include <map_fragment>", `
  float svAlpha;
  vec4 svTexel = svProject(texture2D(map, vMapUv), textureLod(map, vMapUv, SV_BLUR_MAP), svAlpha);
  ${opts.debug ? "svTexel.rgb = mix(svTexel.rgb, mix(vec3(0.9, 0.1, 0.1), vec3(0.1, 0.8, 0.2), svAlpha), 0.35);" : ""}
  diffuseColor *= svTexel;`)
      .replace("#include <emissivemap_fragment>", "totalEmissiveRadiance *= svTexel.rgb;");
  };
  mat.customProgramCacheKey = () => `svproj${k}${stage}${opts.debug ? "d" : ""}`;
  mat.needsUpdate = true;
}

/** Writes each fragment's distance from `uFrom` (three coordinates, / DEPTH_SCALE): the pano's line of sight cube. */
export function distanceMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uFrom: { value: new THREE.Vector3() } },
    vertexShader: `varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uFrom; varying vec3 vW;
void main() { gl_FragColor = vec4(distance(vW, uFrom) / ${f(DEPTH_SCALE)}, 0.0, 0.0, 1.0); }`,
    side: THREE.DoubleSide,
  });
}
